// Chạy trong trang Facebook (world MAIN, lúc trang vừa bắt đầu tải).
// Facebook gửi link MP4 của từng video (có cả tiếng) trong dữ liệu trang và trong các phản hồi /api/graphql/:
//   videoDeliveryResponseResult: { id, progressive_urls: [{ progressive_url, metadata: { quality: "HD" | "SD" } }] }
// Bắt lấy rồi báo cho fbsave.js (nút "⬇ Tải video") qua window.postMessage.
(() => {
  const seen = new Map(); // id -> "hd|sd" đã báo, khỏi báo lại
  function walk(o, out, d) {
    if (!o || typeof o !== "object" || d > 120) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, out, d + 1);
      return;
    }
    if (Array.isArray(o.progressive_urls) && o.id) {
      const v = { id: String(o.id), hd: "", sd: "" };
      for (const p of o.progressive_urls) {
        if (!p || !p.progressive_url || p.failure_reason) continue;
        const q = String((p.metadata && p.metadata.quality) || "").toUpperCase();
        if (q === "HD") v.hd = p.progressive_url;
        else if (!v.sd) v.sd = p.progressive_url;
      }
      if (v.hd || v.sd) out.push(v);
      return;
    }
    for (const k in o) walk(o[k], out, d + 1);
  }
  function report(items) {
    const fresh = items.filter((v) => {
      const sig = `${v.hd}|${v.sd}`;
      if (seen.get(v.id) === sig) return false;
      seen.set(v.id, sig);
      return true;
    });
    if (fresh.length) window.postMessage({ source: "xcs-fb", type: "videos", items: fresh }, location.origin);
  }
  // Phản hồi có thể là nhiều khối JSON nối nhau theo dòng, đôi khi mở đầu bằng "for (;;);".
  function scanText(text) {
    if (!text || text.indexOf("progressive_urls") === -1) return;
    const out = [];
    for (const line of text.replace(/^for \(;;\);/, "").split("\n")) {
      if (line.indexOf("progressive_urls") === -1) continue;
      try {
        walk(JSON.parse(line), out, 0);
      } catch (_) {
        // dòng không phải JSON
      }
    }
    report(out);
  }
  // Dữ liệu có sẵn trong trang (bài / reel mở thẳng bằng đường link).
  function scanInline(all) {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (s.__xcsSeen && all !== true) continue;
      s.__xcsSeen = true;
      scanText(s.textContent);
    }
  }
  document.addEventListener("DOMContentLoaded", scanInline);
  addEventListener("load", scanInline);
  // fbsave.js vừa khởi động (hoặc extension vừa tải lại) thì xin gửi lại toàn bộ.
  addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "xcs-fb-ask") return;
    seen.clear();
    scanInline(true); // fbsave.js khởi động sau lần đọc đầu: đọc lại cả các khối đã đọc
  });

  const GQL = /\/api\/graphql\/?(\?|$)/;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xcsFbUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__xcsFbUrl && GQL.test(String(this.__xcsFbUrl))) {
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
