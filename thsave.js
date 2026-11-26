// Nút "⬇ Tải video" ở góc trên phải mỗi video trên Threads.
// Link MP4 do thhook.js (trong trang) bắt được, theo mã bài; video thuộc bài nào thì tìm link /post/CODE gần nhất.
(() => {
  const vids = new Map(); // code -> [{ url, h }]
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-th" || m.type !== "videos" || !Array.isArray(m.items)) return;
    for (const it of m.items) if (it && it.code && Array.isArray(it.videos) && it.videos.length) vids.set(it.code, it.videos);
  });
  window.postMessage({ source: "xcs-th-ask" }, location.origin);

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .vd { position: fixed; display: none; padding: 5px 10px; border-radius: 999px; border: 0; background: rgba(0,0,0,.62);
      color: #fff; font: 600 12px/1.2 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; cursor: pointer; white-space: nowrap; }
    .vd:hover { background: rgba(0,0,0,.82); }
    .vd.done { background: #00875a; }
  </style>`;
  document.documentElement.appendChild(host);

  // Bài chứa video: tổ tiên gần nhất có link /post/CODE (bài trích dẫn nằm trong bài khác thì gặp mã của nó trước).
  function postOf(video) {
    let el = video.parentElement;
    for (let d = 0; el && d < 30; d++, el = el.parentElement) {
      const found = [];
      for (const a of el.querySelectorAll('a[href*="/post/"]')) {
        const m = a.getAttribute("href").match(/\/@([\w.]+)\/post\/([\w-]+)/);
        if (m && !found.some((f) => f.code === m[2])) found.push({ user: m[1], code: m[2] });
      }
      if (found.length) return { el, ...(found.find((f) => vids.has(f.code)) || found[0]) };
    }
    const m = location.pathname.match(/\/@([\w.]+)\/post\/([\w-]+)/); // trang một bài
    return m ? { el: document.body, user: m[1], code: m[2] } : null;
  }

  const btns = new Map(); // <video> -> nút
  function findVideos() {
    for (const v of document.querySelectorAll("video")) {
      if (btns.has(v)) continue;
      const b = document.createElement("button");
      b.className = "vd";
      b.textContent = "⬇ Tải video";
      b.title = "Tải video này về máy (MP4)";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        download(v, b);
      });
      root.appendChild(b);
      btns.set(v, b);
    }
  }
  function place() {
    for (const [v, b] of btns) {
      if (!v.isConnected) {
        b.remove();
        btns.delete(v);
        continue;
      }
      const r = v.getBoundingClientRect();
      if (r.width < 120 || r.height < 90 || r.bottom < 40 || r.top > innerHeight - 30) {
        b.style.display = "none";
        continue;
      }
      b.style.display = "block";
      b.style.left = `${Math.max(4, Math.min(innerWidth, r.right) - (b.offsetWidth || 90) - 8)}px`;
      b.style.top = `${Math.max(8, r.top + 8)}px`;
    }
  }

  function pick(v, p) {
    const list = vids.get(p.code);
    if (!list) return null;
    if (list.length === 1) return list[0];
    // Bài nhiều video (băng chuyền): khớp theo link đang phát, không thì theo thứ tự video trong bài.
    const src = v.currentSrc || v.src || "";
    const path = (u) => u.split("?")[0];
    const same = list.find((x) => !src.startsWith("blob:") && path(x.url) === path(src));
    if (same) return same;
    const inPost = [...p.el.querySelectorAll("video")];
    return list[Math.max(0, inPost.indexOf(v))] || list[0];
  }

  async function download(v, b) {
    let p = postOf(v);
    if (p && !vids.has(p.code)) {
      window.postMessage({ source: "xcs-th-ask" }, location.origin);
      await new Promise((r) => setTimeout(r, 600));
      p = postOf(v);
    }
    const item = p && pick(v, p);
    if (!item) {
      b.textContent = "Chưa có link: mở bài này rồi thử lại";
      setTimeout(() => (b.textContent = "⬇ Tải video"), 4000);
      return;
    }
    const n = (vids.get(p.code) || []).indexOf(item);
    const name = `${p.user}_${p.code}${n > 0 ? `_${n + 1}` : ""}`.replace(/[^\w.-]/g, "_");
    b.textContent = "Đang tải...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "fb-download-video", url: item.url, filename: `threads-video/${name}.mp4` });
      if (res && res.ok) {
        b.textContent = "✓ Đã tải";
        b.classList.add("done");
      } else b.textContent = `Lỗi: ${(res && res.error) || "không tải được"}`;
    } catch (_) {
      b.textContent = "Extension vừa cập nhật: F5 trang này";
    }
  }

  let queued = false;
  const tick = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!chrome.runtime?.id) return; // extension đã tải lại: để trang cũ yên
      findVideos();
      place();
    });
  };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("scroll", tick, { passive: true, capture: true });
  addEventListener("resize", tick);
  setInterval(tick, 1000);
  tick();
})();
