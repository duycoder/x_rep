// Chạy trong trang Threads (world MAIN, lúc trang vừa bắt đầu tải).
// Mỗi bài Threads có mã "code" (giống /@ten/post/CODE); video của bài nằm trong
//   video_versions: [{ height, url }]   (url là file MP4 có tiếng trên *.fbcdn.net)
// Có sẵn trong dữ liệu trang và trong phản hồi graphql khi cuộn. Bắt lấy rồi báo cho thsave.js.
(() => {
  const seen = new Map(); // code -> chuỗi link đã báo
  function walk(o, out, code, d) {
    if (!o || typeof o !== "object" || d > 150) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, out, code, d + 1);
      return;
    }
    if (typeof o.code === "string" && /^[\w-]{6,}$/.test(o.code) && (o.pk || o.id)) code = o.code;
    if (Array.isArray(o.video_versions) && o.video_versions.length && code) {
      let best = null;
      for (const v of o.video_versions) if (v && v.url && (!best || (v.height || 0) > (best.height || 0))) best = v;
      if (best) {
        const list = out.get(code) || [];
        const key = String(o.pk || o.id || best.url);
        if (!list.some((x) => x.key === key)) list.push({ key, url: best.url, h: best.height || 0 });
        out.set(code, list);
      }
    }
    for (const k in o) if (k !== "video_versions") walk(o[k], out, code, d + 1);
  }
  function report(out) {
    const items = [];
    for (const [code, list] of out) {
      const sig = list.map((x) => x.url).join("|");
      if (seen.get(code) === sig) continue;
      seen.set(code, sig);
      items.push({ code, videos: list.map(({ url, h }) => ({ url, h })) });
    }
    if (items.length) window.postMessage({ source: "xcs-th", type: "videos", items }, location.origin);
  }
  function scanText(text) {
    if (!text || text.indexOf("video_versions") === -1) return;
    const out = new Map();
    for (const line of text.replace(/^for \(;;\);/, "").split("\n")) {
      if (line.indexOf("video_versions") === -1) continue;
      try {
        walk(JSON.parse(line), out, "", 0);
      } catch (_) {
        // dòng không phải JSON
      }
    }
    report(out);
  }
  function scanInline(all) {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (s.__xcsSeen && all !== true) continue;
      s.__xcsSeen = true;
      scanText(s.textContent);
    }
  }
  document.addEventListener("DOMContentLoaded", scanInline);
  addEventListener("load", scanInline);
  addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "xcs-th-ask") return;
    seen.clear();
    scanInline(true);
  });

  const GQL = /\/graphql(\/|\?|$)/;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xcsThUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__xcsThUrl && GQL.test(String(this.__xcsThUrl))) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") scanText(this.responseText);
        } catch (_) {
          // bỏ qua
        }
      });
    }
    return origSend.apply(this, arguments);
  };
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && (input.url || String(input));
      if (url && GQL.test(url)) p.then((r) => (r.ok ? r.clone().text() : "")).then(scanText).catch(() => {});
    } catch (_) {
      // bỏ qua
    }
    return p;
  };
})();
