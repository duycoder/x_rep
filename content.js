// Content script cho x.com
// - Thêm nút "Gợi ý" vào thanh hành động của mỗi bài.
// - Bấm nút: mở bảng gợi ý, chọn/sửa một câu, bấm "Điền vào trả lời".
// - Extension chỉ mở ô trả lời và điền chữ. Bạn tự bấm "Trả lời" và tự thả tim.
// - Phím tắt (khi không gõ chữ): Alt+J bài tiếp, Alt+K bài trước, Alt+G gợi ý cho bài đang xem.
(() => {
  if (window.__xcsLoaded) return;
  window.__xcsLoaded = true;

  const BTN_ATTR = "data-xcs-btn";
  let currentArticle = null;

  // ---------- Đọc dữ liệu bài ----------
  function getTweetInfo(article) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const hasMedia = !!article.querySelector(
      '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
    );
    // Link ảnh (và ảnh bìa video) của bài, tối đa 4. Lấy cỡ "small" cho nhẹ.
    const images = [];
    article.querySelectorAll('[data-testid="tweetPhoto"] img, video[poster]').forEach((el) => {
      const raw = el.tagName === "VIDEO" ? el.poster : el.src;
      if (!raw || !raw.startsWith("https://pbs.twimg.com/")) return;
      // Bỏ qua ảnh nằm trong bài được trích dẫn lồng bên trong.
      if (el.closest("article") !== article) return;
      try {
        const u = new URL(raw);
        if (u.pathname.startsWith("/media/")) u.searchParams.set("name", "small");
        if (!images.includes(u.href)) images.push(u.href);
      } catch (_) {
        // link lạ thì bỏ qua
      }
    });
    const id = tweetIdOf(article);
    return {
      text: textEl ? textEl.innerText : "",
      author: nameEl ? nameEl.innerText.split("\n").slice(0, 2).join(" ") : "",
      hasMedia,
      images: images.slice(0, 4),
      id,
      ...ownCtx(id, article)
    };
  }

  // ---------- Bình luận dưới bài của chính bạn ----------
  // xhook.js gửi sang các bài X vừa tải: id -> { text, replyTo (id bài cha), user (tên @ người đăng) }.
  const tweetMap = new Map();
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-hook" || m.type !== "tweets" || !Array.isArray(m.items)) return;
    for (const t of m.items) {
      if (!t || !t.id) continue;
      const old = tweetMap.get(t.id);
      tweetMap.delete(t.id);
      tweetMap.set(t.id, { ...old, ...t, text: t.text || (old && old.text) || "" });
    }
    while (tweetMap.size > 5000) tweetMap.delete(tweetMap.keys().next().value);
  });
  // Tên @ của bạn: đọc từ thanh bên của X (nhiều chỗ, vì X hay đổi giao diện), nhớ lại để lần sau khỏi tìm.
  let myHandleCache = "";
  try {
    chrome.storage.local.get({ myHandle: "" }, (r) => (myHandleCache = myHandleCache || r.myHandle || ""));
  } catch (_) {
    // extension vừa tải lại
  }
  function myHandle() {
    let h = "";
    const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (a) h = (a.getAttribute("href") || "").replace(/^\//, "");
    if (!h) {
      const av = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]');
      if (av) h = av.getAttribute("data-testid").replace("UserAvatar-Container-", "");
    }
    if (!h) {
      const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      h = ((sw && sw.innerText.match(/@(\w{1,15})/)) || [])[1] || "";
    }
    h = h.toLowerCase();
    if (h && h !== myHandleCache) {
      myHandleCache = h;
      try {
        chrome.storage.local.set({ myHandle: h });
      } catch (_) {
        // extension vừa tải lại
      }
    }
    return h || myHandleCache;
  }
  function tweetIdOf(article) {
    const a = article && article.querySelector('a[href*="/status/"] time')?.closest("a");
    return (a && (a.getAttribute("href").match(/\/status\/(\d+)/) || [])[1]) || "";
  }
  // Bài (id) này có phải bình luận dưới bài của bạn không, và bài của bạn viết gì.
  function ownCtx(id, article) {
    const me = myHandle();
    if (!me) return { onMyPost: false, myPost: "", myPostId: "" };
    const t = id && tweetMap.get(id);
    if (t && (t.user || "").toLowerCase() === me) return { onMyPost: false, myPost: "", myPostId: "" }; // bài của chính bạn
    const parent = t && t.replyTo ? tweetMap.get(t.replyTo) : null;
    if (parent) {
      const mine = (parent.user || "").toLowerCase() === me;
      return { onMyPost: mine, myPost: mine ? parent.text || "" : "", myPostId: mine ? parent.id : "" };
    }
    // Chưa có dữ liệu bài cha: dòng "Đang trả lời @bạn" trong bài.
    let mine = false;
    if (article) {
      const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
      const author = ((authorLink && authorLink.getAttribute("href")) || "").replace(/^\//, "").toLowerCase();
      const text = article.querySelector('[data-testid="tweetText"]');
      mine =
        author !== me &&
        [...article.querySelectorAll(`a[href]`)].some(
          (a) => a.getAttribute("href").toLowerCase() === `/${me}` && !(text && text.contains(a)) && !a.closest('[data-testid="User-Name"]')
        );
    }
    return { onMyPost: mine, myPost: "", myPostId: (mine && t && t.replyTo) || "" };
  }

  // ---------- Nút trong thanh hành động ----------
  function makeButton(article) {
    const btn = document.createElement("button");
    btn.setAttribute(BTN_ATTR, "1");
    btn.type = "button";
    btn.title = "Gợi ý bình luận";
    btn.textContent = "💬 Gợi ý";
    Object.assign(btn.style, {
      border: "1px solid rgba(29,155,240,.5)",
      background: "transparent",
      color: "rgb(29,155,240)",
      borderRadius: "999px",
      padding: "2px 10px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      alignSelf: "center",
      marginLeft: "4px",
      whiteSpace: "nowrap",
      fontFamily: "inherit"
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(article);
    });
    return btn;
  }

  function injectButtons(root = document) {
    root.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
      if (article.querySelector(`[${BTN_ATTR}]`)) return;
      const group = article.querySelector('[role="group"]');
      if (!group) return;
      group.appendChild(makeButton(article));
    });
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(() => injectButtons(), 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  injectButtons();

  // ---------- Bảng gợi ý (Shadow DOM để không đụng CSS của X) ----------
  const host = document.createElement("div");
  host.id = "xcs-host";
  host.style.all = "initial";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  // Các nhóm lựa chọn của bảng Gợi ý bài đăng (postopts.js).
  const POST_GROUPS = self.XCSPostOpts.GROUPS;
  const groupsHtml = (gs) =>
    gs.map((g) => `<label>${g.label} <span class="opt-none">${g.none}</span></label><div class="chips" data-k="${g.key}"></div>`).join("");
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; right: 20px; top: 50%; transform: translateY(-50%); z-index: 2147483647;
        width: 380px; max-width: calc(100vw - 32px); max-height: 85vh; overflow: auto;
        background: #fff; color: #0f1419; border: 1px solid #cfd9de; border-radius: 16px;
        box-shadow: 0 8px 28px rgba(0,0,0,.18); font: 14px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        display: none;
      }
      @media (prefers-color-scheme: dark) {
        .panel { background: #15202b; color: #e7e9ea; border-color: #38444d; }
        textarea { background: #1e2732 !important; color: #e7e9ea !important; border-color: #38444d !important; }
        .preview { background: #1e2732 !important; }
      }
      .panel.open { display: block; }
      header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 6px; }
      header b { font-size: 15px; }
      .x { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; }
      .body { padding: 0 14px 14px; }
      .preview { font-size: 12px; opacity: .8; background: #f7f9f9; border-radius: 10px; padding: 8px; margin-bottom: 10px;
        max-height: 45vh; overflow-y: auto; white-space: pre-wrap; } /* hiện đủ bài, bài rất dài thì cuộn trong khung */
      .note { font-size: 12px; color: #b45309; margin: 6px 0; }
      .src { font-size: 11px; opacity: .65; margin-bottom: 6px; }
      .item { margin-bottom: 10px; }
      .ctx { font-size: 12px; margin: -2px 0 8px; padding: 6px 8px; border-radius: 8px; background: rgba(29,155,240,.1); }
      .past:not(:empty) { border-top: 1px dashed rgba(127,127,127,.4); margin-top: 6px; padding-top: 8px; }
      .pastmeta { font-size: 11px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 2px 0 3px; }
      .hint { font-size: 11px; opacity: .7; margin: -2px 0 6px; }
      textarea { width: 100%; box-sizing: border-box; border: 1px solid #cfd9de; border-radius: 10px; padding: 8px;
        font: inherit; resize: vertical; min-height: 44px; background: #fff; color: #0f1419; }
      .row { display: flex; gap: 6px; margin-top: 4px; }
      button.act { border: 0; border-radius: 999px; padding: 6px 12px; font: 600 13px/1 inherit; cursor: pointer; }
      .primary { background: #1d9bf0; color: #fff; }
      .ghost { background: transparent; color: #1d9bf0; border: 1px solid #1d9bf0 !important; }
      .hint { display: flex; gap: 6px; margin: 8px 0; }
      .hint input { flex: 1; border: 1px solid #cfd9de; border-radius: 999px; padding: 6px 10px; font: inherit;
        background: transparent; color: inherit; }
      .loading { padding: 12px 0; opacity: .75; }
      .foot { font-size: 11px; opacity: .65; margin-top: 8px; }
      .foot a { color: #1d9bf0; cursor: pointer; }
      .postform { display: none; margin-bottom: 4px; }
      .panel.post { width: 680px; max-height: 90vh; } /* bảng bài đăng nhiều nhóm lựa chọn: rộng hơn để chip xếp gọn */
      .panel.post .postform { display: block; }
      .panel:not(.post) .cpjson, .panel:not(.post) .pjson { display: none; } /* chỉ bảng Gợi ý bài đăng */
      .pjson { width: 100%; box-sizing: border-box; height: 160px; margin: 6px 0; font: 11px/1.4 Consolas, monospace; border-radius: 8px; padding: 6px; }
      .panel.post .preview { display: none; }
      .postform label { display: block; font-size: 12px; font-weight: 600; margin: 6px 0 3px; }
      .postform .opt-none { font-weight: 400; opacity: .6; font-size: 11px; margin-left: 4px; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip { border: 1px solid rgba(29,155,240,.5); background: transparent; color: inherit; border-radius: 999px;
        padding: 4px 10px; font: 13px/1.25 inherit; cursor: pointer; max-width: 100%; text-align: left;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chip:hover { background: rgba(29,155,240,.08); }
      .chip.on { background: #1d9bf0; border-color: #1d9bf0; color: #fff; }
      .chips .empty { font-size: 12px; opacity: .6; }
      .chips .empty a { color: #1d9bf0; cursor: pointer; }
      .chip.add { border-style: dashed; opacity: .75; padding: 4px 9px; }
      .chip.add:hover { opacity: 1; }
      .chips input.addin { flex: 1 1 140px; min-width: 120px; border: 1px solid #1d9bf0; border-radius: 999px; padding: 4px 10px;
        font: 13px/1.25 inherit; background: transparent; color: inherit; outline: none; }
      .postform .now { font-size: 11px; opacity: .65; margin-top: 2px; }
      .pmode { margin-bottom: 6px; }
      .fbnote { display: none; font-size: 12px; opacity: .8; margin: 4px 0 6px; }
      .panel.fbmode .fbnote { display: block; }
      .panel.fbmode .pgroups { display: none; }
      .moreopts { margin-top: 8px; border-top: 1px dashed rgba(127,127,127,.4); padding-top: 6px; }
      .moreopts summary { cursor: pointer; font-size: 12px; font-weight: 600; color: #1d9bf0; list-style: none; }
      .moreopts summary::-webkit-details-marker { display: none; }
      .moreopts .morecnt { font-weight: 400; opacity: .75; color: inherit; }
      .imgbar { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
      .imgbar .lbl { font-size: 11px; opacity: .6; margin-right: 2px; }
      button.mini { border: 1px solid rgba(127,127,127,.45); background: transparent; color: inherit; border-radius: 999px;
        padding: 3px 9px; font: 12px/1.2 inherit; cursor: pointer; }
      button.mini:hover { border-color: #1d9bf0; color: #1d9bf0; }
      .imgbox:empty { display: none; }
      .imgbox { margin-top: 6px; }
      .pick { position: relative; }
      .pick img { width: 100%; max-height: 240px; object-fit: cover; border-radius: 10px; display: block; }
      .pick .rm { position: absolute; top: 6px; right: 6px; border: 0; border-radius: 999px; width: 26px; height: 26px;
        background: rgba(0,0,0,.65); color: #fff; cursor: pointer; font-size: 14px; }
      .pick .redo { position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,.65); color: #fff; border: 0; }
      .credit { font-size: 11px; opacity: .65; margin-top: 2px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
      .grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; cursor: pointer; display: block; }
      .grid img:hover { outline: 2px solid #1d9bf0; }
      .qrow { display: flex; gap: 4px; margin-bottom: 5px; }
      .qrow input { flex: 1; border: 1px solid #cfd9de; border-radius: 999px; padding: 4px 10px; font: 12px inherit;
        background: transparent; color: inherit; }
      .wait { font-size: 12px; opacity: .7; padding: 6px 0; }
      .len { font-size: 11px; opacity: .6; margin-left: auto; align-self: center; }
      .len.over { color: #f4212e; opacity: 1; }
      .dock .stats { margin: 0 8px 8px; border: 1px solid rgba(127,127,127,.3); border-radius: 10px; padding: 4px 8px; font-size: 12px; }
      .stats table { width: 100%; border-collapse: collapse; }
      .stats th, .stats td { padding: 2px 4px; text-align: right; white-space: nowrap; }
      .stats th { font-weight: 600; opacity: .6; font-size: 11px; }
      .stats th:first-child, .stats td:first-child { text-align: left; }
      .stats td.today { font-weight: 700; color: #1d9bf0; }
      .dock { position: fixed; z-index: 2147483646; right: 16px; top: 70px; background: #fff; color: #0f1419;
        border: 1px solid #cfd9de; border-radius: 14px; box-shadow: 0 4px 14px rgba(0,0,0,.15);
        font: 13px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; cursor: grab; user-select: none; touch-action: none; }
      .dock .pill { padding: 6px 8px 6px 11px; white-space: nowrap; display: flex; align-items: center; gap: 10px; }
      .dock .newpost { margin-left: auto; border: 0; border-radius: 999px; background: #1d9bf0; color: #fff; cursor: pointer;
        font: 600 12px/1 inherit; padding: 6px 10px; }
      .dock .newpost:hover { filter: brightness(1.1); }
      .dock .last { font-size: 11px; opacity: .65; margin-top: 4px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dock .fix { margin-top: 4px; border: 0; background: transparent; color: #1d9bf0; cursor: pointer; font: 11px inherit; padding: 0; }
      .dock .pill b { color: #1d9bf0; }
      .dock .stats { margin: 0 8px 8px; cursor: default; }
      @media (prefers-color-scheme: dark) { .dock { background: #15202b; color: #e7e9ea; border-color: #38444d; } }
    </style>
    <div class="dock" title="Kéo để dời chỗ"><div class="pill"></div><div class="stats"></div></div>
    <div class="panel" role="dialog" aria-label="Gợi ý bình luận">
      <header><b class="title">Gợi ý bình luận</b><button class="x" title="Đóng (Esc)">✕</button></header>
      <div class="body">
        <div class="preview"></div>
        <div class="postform">
          <div class="pmode chips">
            <button type="button" class="chip pm" data-m="opts" title="Viết theo con người, chủ đề, giọng... bạn chọn bên dưới">🎛 Theo lựa chọn</button>
            <button type="button" class="chip pm" data-m="fb" title="Chỉ học từ bài page Facebook đã lưu, bỏ qua mọi lựa chọn">📘 Phong cách page Facebook</button>
          </div>
          <div class="fbnote"></div>
          <div class="pgroups">
          ${groupsHtml(POST_GROUPS.filter((g) => !g.more))}
          <details class="moreopts"><summary>⚙ Thêm tuỳ chọn <span class="morecnt"></span></summary>${groupsHtml(POST_GROUPS.filter((g) => g.more))}</details>
          </div>
          <div class="now"></div>
        </div>
        <div class="hint">
          <input placeholder="Thêm ý (vd: hỏi về giá, giọng hài hơn)..." />
          <button class="act ghost regen">Tạo lại</button>
          <button class="act ghost cpjson" title="Sao chép toàn bộ prompt (quy tắc + lựa chọn + bài) dạng JSON để dán sang AI khác">📋 Prompt JSON</button>
        </div>
        <textarea class="pjson" readonly hidden></textarea>
        <div class="content"></div>
        <div class="foot">Bạn tự đọc lại, tự bấm Trả lời và Thích trên X. · <a class="opt">Cài đặt</a></div>
      </div>
    </div>`;

  const panel = shadow.querySelector(".panel");

  // ---------- Đếm bài đăng / trả lời theo ngày giờ Việt Nam (UTC+7) ----------
  // Kho "activity": { "2026-11-21": { post, reply, post_ai, reply_ai } }. Đếm mọi lần bạn bấm Đăng/Trả lời trên X.
  const escapeHtml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const vnDay = (ts = Date.now()) => new Date(ts + 7 * 3600e3).toISOString().slice(0, 10);
  function statsTable(activity) {
    const day = (i) => activity[vnDay(Date.now() - i * 86400e3)] || {};
    const sum = (k, n) => Array.from({ length: n }, (_, i) => day(i)[k] || 0).reduce((a, b) => a + b, 0);
    const row = (label, k) => `<tr><td>${label}</td><td class="today">${day(0)[k] || 0}</td><td>${day(1)[k] || 0}</td><td>${sum(k, 7)}</td></tr>`;
    return `<table><tr><th>Giờ VN</th><th>Hôm nay</th><th>Hôm qua</th><th>7 ngày</th></tr>
      ${row("📝 Bài đăng", "post")}${row("💬 Trả lời", "reply")}${row("➕ Follow", "follow")}${row("➖ Bỏ follow", "unfollow")}
      <tr><td title="Số lần bạn đăng câu lấy từ gợi ý của extension">🤖 Dùng gợi ý</td><td class="today">${(day(0).post_ai || 0) + (day(0).reply_ai || 0)}</td><td>${(day(1).post_ai || 0) + (day(1).reply_ai || 0)}</td><td>${sum("post_ai", 7) + sum("reply_ai", 7)}</td></tr></table>`;
  }
  // Bảng đếm luôn hiện ở góc trên bên phải trang X; kéo để dời chỗ (nhớ vị trí, kho "dockPos").
  const dock = shadow.querySelector(".dock");
  const dockPill = dock.querySelector(".pill");
  const dockStats = dock.querySelector(".stats");
  function renderDock() {
    chrome.storage.local.get({ activity: {}, activityLast: null, dockPos: { x: null, y: null } }, ({ activity, activityLast: last, dockPos: dockState }) => {
      const t = activity[vnDay()] || {};
      dockPill.innerHTML = `<span>Hôm nay: 📝 <b>${t.post || 0}</b> bài · 💬 <b>${t.reply || 0}</b> trả lời · ➕ <b>${t.follow || 0}</b> follow</span><button class="newpost" title="Viết bài mới (Alt+P)">✍️ Gợi ý bài</button>`;
      const hm = (ts) => new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      dockStats.innerHTML =
        statsTable(activity) +
        `<div class="last">${last ? `Gần nhất: ${last.kind === "reply" ? "💬 trả lời" : "📝 bài"} ${hm(last.at)}${last.ai ? " (gợi ý)" : ""} · “${escapeHtml(last.text)}”` : "Chưa đếm được lần đăng nào từ lúc bật"}</div>` +
        `<button class="fix" title="Sửa số hôm nay cho khớp X Analytics">✎ Sửa số hôm nay</button>`;
      if (dockState.x != null) {
        // Cửa sổ nhỏ lại thì kéo ô về trong màn hình.
        const x = Math.max(0, Math.min(innerWidth - 80, dockState.x));
        const y = Math.max(0, Math.min(innerHeight - 40, dockState.y));
        Object.assign(dock.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
      }
    });
  }
  let drag = null;
  dock.addEventListener("click", (e) => {
    if (e.target.closest(".newpost")) openPostPanel(null);
    if (e.target.closest(".fix")) {
      chrome.storage.local.get({ activity: {} }, ({ activity }) => {
        const d = vnDay();
        const rec = (activity[d] = activity[d] || { post: 0, reply: 0, post_ai: 0, reply_ai: 0 });
        const p = prompt("Số BÀI ĐĂNG hôm nay (giờ VN):", rec.post || 0);
        if (p === null) return;
        const r = prompt("Số TRẢ LỜI hôm nay (giờ VN):", rec.reply || 0);
        if (r === null) return;
        rec.post = Math.max(0, parseInt(p, 10) || 0);
        rec.reply = Math.max(0, parseInt(r, 10) || 0);
        chrome.storage.local.set({ activity });
      });
    }
  });
  dock.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return; // bấm nút, không phải kéo
    const r = dock.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    dock.setPointerCapture(e.pointerId);
  });
  dock.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
    if (!drag.moved) return;
    const x = Math.max(0, Math.min(innerWidth - dock.offsetWidth, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(innerHeight - dock.offsetHeight, e.clientY - drag.dy));
    Object.assign(dock.style, { left: `${x}px`, top: `${y}px`, right: "auto", cursor: "grabbing" });
  });
  dock.addEventListener("pointerup", () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    dock.style.cursor = "";
    if (!moved) return;
    const r = dock.getBoundingClientRect();
    chrome.storage.local.set({ dockPos: { x: Math.round(r.left), y: Math.round(r.top) } });
  });
  renderDock();
  const dockTimer = setInterval(() => {
    if (!chrome.runtime?.id) return clearInterval(dockTimer); // extension vừa tải lại: trang cũ thôi cập nhật
    renderDock(); // qua 0h giờ VN thì tự sang ngày mới
  }, 60e3);
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.activity || ch.dockPos || ch.activityLast) renderDock();
  });
  // Đếm theo lệnh đăng bài thật của X (xhook.js nghe CreateTweet, chỉ báo khi đăng thành công).
  // Cú bấm nút chỉ dùng để biết lần đăng đó có lấy câu gợi ý của extension không.
  // sendCtx: lúc bấm đăng, câu gợi ý đang chờ (nếu có) để biết lần đăng này có dùng gợi ý không.
  let sendCtx = null;
  function trackSend() {
    sendCtx = pending && Date.now() - pending.at < 30 * 60e3 ? { ...pending, at: Date.now() } : null;
    pending = null;
  }
  // Bài bạn vừa bấm nút trả lời (để lưu cặp "bài → câu trả lời" cả khi bạn tự gõ, không dùng gợi ý).
  let replyTarget = null;
  const statusId = (article) => {
    const a = article.querySelector('a[href*="/status/"] time')?.closest("a");
    return (a && (a.getAttribute("href").match(/\/status\/(\d+)/) || [])[1]) || "";
  };
  document.addEventListener(
    "click",
    (e) => {
      const art = e.target.closest && e.target.closest('[data-testid="reply"]')?.closest("article");
      if (art) replyTarget = { ...getTweetInfo(art), id: statusId(art), at: Date.now() };
    },
    true
  );
  function findTweet(id) {
    if (id && replyTarget && replyTarget.id === id) return replyTarget;
    if (id) {
      for (const a of document.querySelectorAll(`a[href*="/status/${id}"]`)) {
        const art = a.closest("article");
        if (art && statusId(art) === id) return getTweetInfo(art);
      }
    }
    // Trang chi tiết bài: ô trả lời nằm ngay dưới bài chính.
    if (id && location.pathname.includes(`/status/${id}`)) {
      const art = document.querySelector('article[tabindex="-1"]') || document.querySelector("article");
      if (art) return getTweetInfo(art);
    }
    return { text: "", author: "" };
  }
  // Lưu lại mọi bài đăng / câu trả lời bạn đăng thành công (để học giọng và huấn luyện model riêng).
  function saveSent(kind, m, ctx) {
    const text = String(m.text || "").trim();
    if (!text) return;
    if (kind === "post") {
      chrome.runtime.sendMessage({ type: "xcs-save-post", topic: (ctx && ctx.topic) || "", text, suggested: (ctx && ctx.suggested) || "", id: m.id || "", myImages: m.media || [] });
      if (ctx && ctx.studioId) chrome.runtime.sendMessage({ type: "studio-published", postId: ctx.studioId });
      return;
    }
    const src = ctx && ctx.post != null ? { text: ctx.post, author: ctx.author, images: ctx.images, onMyPost: ctx.onMyPost, myPost: ctx.myPost, myPostId: ctx.myPostId } : findTweet(m.replyTo);
    // Biết chắc bài cha (đã tải về) thì theo dữ liệu đó, không thì theo lúc bấm trả lời.
    const cmt = m.replyTo && tweetMap.get(m.replyTo);
    const known = !!(cmt && cmt.replyTo && tweetMap.get(cmt.replyTo));
    const own = known ? ownCtx(m.replyTo) : {};
    const onMyPost = known ? own.onMyPost : !!src.onMyPost;
    chrome.runtime.sendMessage({
      onMyPost,
      myPost: onMyPost ? own.myPost || src.myPost || "" : "",
      myPostId: onMyPost ? own.myPostId || src.myPostId || "" : "",
      type: "xcs-save-example",
      post: String(src.text || "").slice(0, 600),
      author: src.author || "",
      reply: text.replace(/\s+/g, " "),
      suggested: (ctx && ctx.suggested) || "",
      replyTo: m.replyTo || "",
      images: src.images || [],
      id: m.id || "",
      myImages: m.media || []
    });
  }
  // ---------- Hẹn giờ đăng ----------
  // Nhớ các bài đã hẹn (schedList: [{at, text}]) từ chính X: lúc bạn bấm Schedule thành công,
  // và lúc X tải trang "Scheduled posts" (danh sách đầy đủ: thay hẳn, nên bài bạn xoá/sửa giờ cũng được cập nhật).
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-hook" || m.type !== "sched" || !Array.isArray(m.items)) return;
    try {
      chrome.storage.local.get({ schedList: [] }, ({ schedList }) => {
        const now = Date.now();
        let list = m.action === "list" ? m.items : [...schedList, ...m.items];
        const seen = new Set();
        list = list
          .filter((x) => x && x.at > now && !seen.has(x.at) && seen.add(x.at))
          .sort((a, b) => a.at - b.at)
          .slice(0, 200);
        chrome.storage.local.set({ schedList: list });
      });
    } catch (_) {
      // extension vừa tải lại
    }
  });

  // Giờ hẹn kế tiếp: sớm nhất có thể (ít nhất 15 phút từ bây giờ, tròn 5 phút) mà cách MỌI bài đã hẹn
  // ít nhất gapMin phút (mặc định 60). Vd đã hẹn 13:30 → không chọn 13:22 hay 13:40; chỗ trống giữa hai bài vẫn dùng được.
  function nextSlot(list, gapMin) {
    const step = 5 * 60e3;
    const gap = gapMin * 60e3;
    const up = (t) => Math.ceil(t / step) * step;
    const ats = list.map((x) => x.at).sort((a, b) => a - b);
    let at = up(Date.now() + 15 * 60e3);
    for (let guard = 0; guard < 500; guard++) {
      const clash = ats.find((s) => Math.abs(at - s) < gap);
      if (clash == null) break;
      at = up(clash + gap);
    }
    return new Date(at);
  }

  // Chọn một ô <select> của React: đặt giá trị bằng setter gốc rồi báo "change" để X cập nhật.
  function setSelect(sel, want, byIndex) {
    const opts = [...sel.options].filter((o) => o.value !== "");
    const o = byIndex != null ? opts[byIndex] : opts.find((x) => Number(x.value) === want);
    if (!o) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, o.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // Nhận ra từng ô theo các lựa chọn bên trong (không phụ thuộc ngôn ngữ giao diện X).
  function scheduleSelects(dlg) {
    const out = {};
    const twelves = [];
    for (const s of dlg.querySelectorAll("select")) {
      const vals = [...s.options].map((o) => o.value).filter((v) => v !== "");
      if (vals.length === 2) out.ampm = s;
      else if (vals.length >= 55) out.minute = s;
      else if (vals.some((v) => /^\d{4}$/.test(v))) out.year = s;
      else if (vals.length >= 28 && vals.length <= 31) out.day = s;
      else if (vals.length >= 23 && vals.length <= 24) out.hour24 = s;
      else if (vals.length === 12) twelves.push(s);
    }
    out.month = twelves[0]; // ô ngày nằm trước ô giờ
    if (twelves[1]) out.hour = twelves[1];
    return out;
  }

  // Mở khung soạn bài thường (nút Post bên trái), điền bài, rồi mở bảng Schedule trong chính khung đó.
  async function runScheduled(p) {
    const newBtn = await waitFor(() => document.querySelector('[data-testid="SideNav_NewTweet_Button"]'), 15000);
    if (!newBtn) return toast("Không thấy nút Post của X để mở khung soạn bài.");
    newBtn.click();
    const box = await waitFor(() => document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]'), 8000);
    if (!box) return toast("Không mở được khung soạn bài.");
    await new Promise((r) => setTimeout(r, 300));
    if (!(await insertText(box, p.text))) {
      await navigator.clipboard.writeText(p.text).catch(() => {});
      toast("Chưa điền được bài: đã sao chép, bấm vào ô soạn rồi Ctrl+V.");
    }
    await new Promise((r) => setTimeout(r, 300));
    const btn = await waitFor(() => document.querySelector('[role="dialog"] [data-testid="scheduleOption"]'), 8000);
    if (!btn) return toast("Không thấy nút Hẹn giờ của X: bấm biểu tượng lịch trong khung soạn bài.");
    btn.click();
    const dlg = await waitFor(() => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelectorAll("select").length >= 5), 8000);
    if (!dlg) return toast("Không mở được bảng Hẹn giờ của X.");
    const { schedList = [], schedGapMin = 60 } = await chrome.storage.local.get({ schedList: [], schedGapMin: 60 });
    const at = nextSlot(schedList.filter((x) => x.at > Date.now()), schedGapMin);
    const h = at.getHours();
    // Năm → tháng → ngày trước (số ngày phụ thuộc tháng); mỗi bước tìm lại ô vì X vẽ lại.
    const steps = [
      ["year", at.getFullYear()],
      ["month", at.getMonth() + 1],
      ["day", at.getDate()],
      ["hour24", h],
      ["hour", h % 12 || 12],
      ["minute", at.getMinutes()],
      ["ampm", null, h < 12 ? 0 : 1]
    ];
    let ok = true;
    for (const [k, v, idx] of steps) {
      const s = scheduleSelects(dlg)[k];
      if (!s) continue;
      if (!setSelect(s, v, idx)) ok = false;
      await new Promise((r) => setTimeout(r, 120));
    }
    const when = at.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    toast(ok ? `⏰ Đã chọn ${when}. Kiểm tra rồi bấm Confirm, sau đó Schedule.` : `Chọn giờ chưa trọn (${when}): kiểm tra lại các ô.`);
  }

  try {
    chrome.storage.local.get({ schedPending: null }, ({ schedPending: p }) => {
      if (!p || Date.now() - p.ts > 120e3 || location.pathname !== "/home") return;
      chrome.storage.local.remove("schedPending");
      runScheduled(p).catch((e) => toast(`Hẹn giờ lỗi: ${e.message}`));
    });
  } catch (_) {
    // extension vừa tải lại
  }

  // Đếm follow / bỏ follow theo ngày giờ VN. Ghi lần lượt (bấm follow liền tay nhiều người không bị mất số).
  let followQ = Promise.resolve();
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-hook" || m.type !== "follow") return;
    const k = m.action === "unfollow" ? "unfollow" : "follow";
    followQ = followQ.then(
      () =>
        new Promise((done) => {
          try {
            chrome.storage.local.get({ activity: {} }, ({ activity }) => {
              const d = vnDay();
              const rec = (activity[d] = activity[d] || { post: 0, reply: 0, post_ai: 0, reply_ai: 0 });
              rec[k] = (rec[k] || 0) + 1;
              const list = new Set(rec.followed || []); // ai đã follow hôm nay (bỏ follow thì gỡ ra)
              if (k === "follow") list.add(m.user);
              else list.delete(m.user);
              rec.followed = [...list].slice(-1000);
              chrome.storage.local.set({ activity }, done);
            });
          } catch (_) {
            done(); // extension vừa tải lại
          }
        })
    );
  });
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-hook" || m.type !== "tweet-created") return;
    const kind = m.kind === "reply" ? "reply" : "post";
    const ctx = sendCtx && (sendCtx.kind === "post" ? "post" : "reply") === kind && Date.now() - sendCtx.at < 60e3 ? sendCtx : null;
    if (ctx) sendCtx = null;
    const ai = !!ctx;
    try {
      saveSent(kind, m, ctx);
    } catch (_) {
      // extension vừa tải lại
    }
    try {
      chrome.storage.local.get({ activity: {} }, ({ activity }) => {
        const d = vnDay();
        const rec = (activity[d] = activity[d] || { post: 0, reply: 0, post_ai: 0, reply_ai: 0 });
        rec[kind] = (rec[kind] || 0) + 1;
        if (ai) rec[`${kind}_ai`] = (rec[`${kind}_ai`] || 0) + 1;
        for (const k of Object.keys(activity)) if (k < vnDay(Date.now() - 90 * 86400e3)) delete activity[k];
        chrome.storage.local.set({ activity, activityLast: { kind, ai, at: Date.now(), text: String(m.text || "").slice(0, 60) } });
      });
    } catch (_) {
      // extension vừa tải lại
    }
  });
  const preview = shadow.querySelector(".preview");
  const contentBox = shadow.querySelector(".content");
  const hintInput = shadow.querySelector(".hint input");
  const regenBtn = shadow.querySelector(".regen");
  const titleEl = shadow.querySelector(".title");
  const footEl = shadow.querySelector(".foot");
  // Lựa chọn đang bật của bảng bài đăng: nhóm chọn một = chuỗi ("" = không chọn), nhóm chọn nhiều = mảng.
  let postSel = {};
  const GROUP = Object.fromEntries(POST_GROUPS.map((g) => [g.key, g]));
  const selOn = (k, v) => (GROUP[k].multi ? (postSel[k] || []).includes(v) : postSel[k] === v);
  const nowEl = shadow.querySelector(".postform .now");
  // Chế độ "post": viết bài đăng mới. POST_KEY thay cho currentArticle để các hàm dùng chung biết bảng đang mở.
  const POST_KEY = { post: true };
  const isPostMode = () => currentArticle === POST_KEY;
  const regen = () => currentArticle && (isPostMode() ? loadPosts() : loadSuggestions(currentArticle));
  shadow.querySelector(".x").addEventListener("click", closePanel);
  regenBtn.addEventListener("click", regen);
  // 📋 Prompt JSON: cùng prompt extension gửi cho AI, để dán sang ChatGPT / Gemini / AI khác.
  const pjsonBox = shadow.querySelector(".pjson");
  shadow.querySelector(".cpjson").addEventListener("click", () => {
    if (!currentArticle) return;
    const msg = isPostMode()
      ? fbStyle
        ? { type: "xcs-build-prompt", mode: "post", fbStyle: true, text: "", extraHint: hintInput.value.trim() }
        : { type: "xcs-build-prompt", mode: "post", ...postSel, text: postSel.topic, extraHint: hintInput.value.trim() }
      : { type: "xcs-build-prompt", ...getTweetInfo(currentArticle), extraHint: hintInput.value.trim() };
    try {
      chrome.runtime.sendMessage(msg, async (res) => {
        if (!res || res.error) return toast(`Không tạo được prompt: ${(res && res.error) || "lỗi"}`);
        const text = JSON.stringify(res.prompt, null, 2);
        pjsonBox.value = text;
        try {
          await navigator.clipboard.writeText(text);
          pjsonBox.hidden = true;
          toast("Đã sao chép prompt JSON, dán vào AI khác là dùng được");
        } catch (_) {
          // trình duyệt không cho chép: hiện ra để bạn tự chép
          pjsonBox.hidden = false;
          pjsonBox.focus();
          pjsonBox.select();
          toast("Bấm Ctrl+C để chép prompt JSON");
        }
      });
    } catch (_) {
      toast("Extension vừa được tải lại, bấm F5 trang X");
    }
  });
  hintInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") regen();
  });
  shadow.querySelector(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "xcs-open-options" }));

  function closePanel() {
    panel.classList.remove("open");
    currentArticle = null;
  }

  function setMode(post) {
    panel.classList.toggle("post", post);
    titleEl.textContent = post ? "Gợi ý bài đăng" : "Gợi ý bình luận";
    panel.setAttribute("aria-label", titleEl.textContent);
    regenBtn.textContent = post ? "Tạo bài" : "Tạo lại";
    hintInput.placeholder = post ? "Thêm ý (vd: hài hơn, có 1 câu hỏi, viết tiếng Anh)..." : "Thêm ý (vd: hỏi về giá, giọng hài hơn)...";
    footEl.firstChild.textContent = post ? "Bạn tự đọc lại và tự bấm Đăng trên X. · " : "Bạn tự đọc lại, tự bấm Trả lời và Thích trên X. · ";
    placePanel();
  }

  // Bảng Gợi ý bình luận nằm đè lên cột bên phải của X (Relevant people, What's happening...), ngay dưới ô tìm kiếm:
  // không che bài và ô trả lời ở giữa, dễ theo dõi. Cửa sổ hẹp (X ẩn cột phải) hoặc bảng Gợi ý bài đăng thì giữ chỗ cũ.
  function placePanel() {
    const st = panel.style;
    const side = panel.classList.contains("post") ? null : document.querySelector('[data-testid="sidebarColumn"]');
    const r = side && side.getBoundingClientRect();
    if (!r || r.width < 280 || r.left < 0 || r.left + 280 > innerWidth) {
      st.left = st.right = st.top = st.width = st.maxHeight = st.transform = "";
      return;
    }
    const sr = side.querySelector('form[role="search"]')?.getBoundingClientRect();
    const top = sr && sr.bottom > 0 && sr.bottom < 160 ? sr.bottom + 10 : 60;
    st.left = `${Math.round(r.left)}px`;
    st.right = "auto";
    st.top = `${Math.round(top)}px`;
    st.transform = "none";
    st.width = `${Math.round(Math.min(Math.max(r.width, 320), 420, innerWidth - r.left - 12))}px`;
    st.maxHeight = `${Math.round(innerHeight - top - 12)}px`;
  }
  window.addEventListener("resize", () => panel.classList.contains("open") && placePanel());

  function openPanel(article) {
    setMode(false);
    currentArticle = article;
    const info = getTweetInfo(article);
    preview.textContent = (info.author ? info.author + "\n" : "") + (info.text || "(bài không có chữ)");
    hintInput.value = "";
    panel.classList.add("open");
    placePanel();
    loadSuggestions(article);
  }

  // ---------- Gợi ý bài đăng mới ----------
  let postComposerHint = null; // thanh công cụ của ô đăng bài mà bạn bấm nút, để điền đúng ô đó
  function nowLabel() {
    const d = new Date();
    return `Bây giờ: ${d.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric" })}, ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  // Chế độ "Phong cách page Facebook": tách hẳn khỏi các lựa chọn của bảng, chỉ học từ bài page đã lưu.
  let fbStyle = false;
  function setFbStyle(on) {
    fbStyle = !!on;
    panel.classList.toggle("fbmode", fbStyle);
    shadow.querySelectorAll(".pm").forEach((b) => b.classList.toggle("on", (b.dataset.m === "fb") === fbStyle));
    hintInput.placeholder = fbStyle
      ? "Ý / chủ đề muốn viết (tuỳ chọn, vd: tiền bạc và tình bạn)..."
      : "Thêm ý (vd: hài hơn, có 1 câu hỏi, viết tiếng Anh)...";
    if (!fbStyle) return;
    const note = shadow.querySelector(".fbnote");
    note.textContent = "Đang đếm bài mẫu...";
    chrome.runtime.sendMessage({ type: "fb-stats" }, (r) => {
      if (chrome.runtime.lastError || !r) return (note.textContent = "");
      const st = r.st || {};
      note.textContent = r.total
        ? `Chỉ học từ bài page Facebook đã lưu (${st.train || 0} bài đã duyệt, ${st.new || 0} chờ duyệt), bỏ qua mọi lựa chọn khác. Gõ ý vào ô bên dưới hoặc để trống cho AI tự chọn.`
        : "Chưa lưu bài Facebook nào: mở page trên Facebook và lướt để lưu bài trước.";
    });
  }
  function openPostPanel(toolbar) {
    if (!chrome.runtime?.id) return toast("Extension vừa được cập nhật. Bấm F5 tải lại trang X.");
    postComposerHint = toolbar || null;
    setMode(true);
    currentArticle = POST_KEY;
    hintInput.value = "";
    contentBox.innerHTML = '<div class="hint" style="display:block;opacity:.7">Bấm chọn rồi bấm <b>Tạo bài</b>.</div>';
    nowEl.textContent = nowLabel() + " (luôn gửi kèm cho AI)";
    const want = { persona: "", postSel: null, postSpecV3: false, postMoreOpen: false, postFbStyle: false };
    POST_GROUPS.forEach((g) => (want[g.store] = null));
    chrome.storage.local.get(want, (s) => {
      const lines = (v) => [...new Set(String(v || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
      const lists = {};
      const save = {};
      for (const g of POST_GROUPS) {
        let list;
        if (s[g.store] == null) {
          // Chưa từng chỉnh: hiện sẵn các lựa chọn mặc định (con người thì thêm ô "Bạn là ai?" nếu có).
          list = g.key === "persona" && s.persona.trim() ? [s.persona.replace(/\r?\n/g, " ").trim(), ...g.presets] : [...g.presets];
          save[g.store] = list.join("\n");
        } else {
          list = lines(s[g.store]);
          // Cập nhật lên bộ lựa chọn mới (một lần): thêm mục mới vào nhóm cũ, giữ nguyên mục bạn đã có.
          if (!s.postSpecV3) {
            const merged = [...list, ...g.presets.filter((v) => !list.includes(v))];
            if (merged.length !== list.length) save[g.store] = merged.join("\n");
            list = merged;
          }
        }
        lists[g.key] = list;
      }
      save.postSpecV3 = true;
      chrome.storage.local.set(save);
      // Giữ lựa chọn lần trước nếu vẫn còn trong danh sách.
      const prev = s.postSel || {};
      postSel = {};
      for (const g of POST_GROUPS) {
        const pv = [].concat(prev[g.key] || []).filter((v) => lists[g.key].includes(v));
        postSel[g.key] = g.multi ? pv : pv[0] || "";
      }
      for (const g of POST_GROUPS) renderChips(g.key, lists[g.key]);
      const det = shadow.querySelector(".moreopts");
      det.open = !!s.postMoreOpen;
      det.ontoggle = () => chrome.storage.local.set({ postMoreOpen: det.open });
      updateMoreCount();
      shadow.querySelectorAll(".pm").forEach((b) => {
        b.onclick = () => {
          setFbStyle(b.dataset.m === "fb");
          chrome.storage.local.set({ postFbStyle: fbStyle });
        };
      });
      setFbStyle(s.postFbStyle);
      panel.classList.add("open");
    });
  }
  // Số lựa chọn đang bật trong mục "Thêm tuỳ chọn" (để biết khi nó đang thu gọn).
  function updateMoreCount() {
    const n = POST_GROUPS.filter((g) => g.more).reduce((a, g) => a + (g.multi ? (postSel[g.key] || []).length : postSel[g.key] ? 1 : 0), 0);
    shadow.querySelector(".morecnt").textContent = n ? `· đang chọn ${n}` : "(tâm trạng, giọng, mục tiêu, mở đầu, CTA, độ dài, ngôn ngữ, ảnh)";
  }

  const ADD_PH = { persona: "vd: dev 30 tuổi, xưng mình", style: "vd: Tâm sự đêm khuya", topic: "vd: chạy bộ", place: "vd: Đà Lạt", when: "vd: sáng thứ Hai mưa", mood: "vd: háo hức" };
  function renderChips(k, items) {
    const box = shadow.querySelector(`.chips[data-k="${k}"]`);
    box.innerHTML = "";
    items.forEach((v) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "chip" + (selOn(k, v) ? " on" : "");
      c.textContent = v;
      c.title = `${v}\n(chuột phải để bỏ khỏi bảng)`;
      c.addEventListener("click", () => {
        if (GROUP[k].multi) {
          const cur = postSel[k] || [];
          postSel[k] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
        } else postSel[k] = postSel[k] === v ? "" : v; // bấm lại để bỏ chọn
        box.querySelectorAll(".chip:not(.add)").forEach((x) => x.classList.toggle("on", selOn(k, x.textContent)));
        updateMoreCount();
        chrome.storage.local.set({ postSel });
      });
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (confirm(`Bỏ "${v}" khỏi bảng? (Vẫn còn trong Cài đặt, tick lại lúc nào cũng được)`)) saveChipList(k, items.filter((x) => x !== v), v, false);
      });
      box.appendChild(c);
    });
    // Nút ＋: gõ lựa chọn mới ngay tại đây, Enter để lưu và chọn luôn.
    const add = document.createElement("button");
    add.type = "button";
    add.className = "chip add";
    add.textContent = items.length ? "＋" : "＋ Thêm lựa chọn";
    add.title = "Thêm lựa chọn mới (tự lưu vào Cài đặt)";
    add.addEventListener("click", () => {
      const inp = document.createElement("input");
      inp.className = "addin";
      inp.placeholder = ADD_PH[k] || "Gõ rồi Enter";
      add.replaceWith(inp);
      inp.focus();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = inp.value.replace(/\s+/g, " ").trim();
        if (save && v) {
          if (GROUP[k].multi) postSel[k] = [...new Set([...(postSel[k] || []), v])];
          else postSel[k] = v;
          saveChipList(k, items.includes(v) ? items : [...items, v], v, true);
        } else renderChips(k, items);
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation(); // không để phím tắt của X ăn mất phím
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      });
      inp.addEventListener("blur", () => finish(true));
    });
    box.appendChild(add);
  }
  // Lưu danh sách đã tick của nhóm k; mục mới thì thêm vào kho chung để trang Cài đặt cũng thấy.
  function saveChipList(k, list, v, added) {
    const key = GROUP[k].store;
    if (!added) {
      if (GROUP[k].multi) postSel[k] = (postSel[k] || []).filter((x) => x !== v);
      else if (postSel[k] === v) postSel[k] = "";
    }
    renderChips(k, list);
    updateMoreCount();
    chrome.storage.local.get({ postPool: {} }, ({ postPool }) => {
      if (added && postPool[key] && !postPool[key].includes(v)) postPool[key] = [...postPool[key], v];
      chrome.storage.local.set({ [key]: list.join("\n"), postPool, postSel }, () => {
        if (chrome.runtime.lastError) toast(`Không lưu được: ${chrome.runtime.lastError.message}`);
      });
    });
  }

  function loadPosts() {
    chrome.storage.local.set({ postSel });
    nowEl.textContent = nowLabel() + " (luôn gửi kèm cho AI)";
    startRequest(
      POST_KEY,
      fbStyle
        ? { type: "xcs-suggest", mode: "post", fbStyle: true, text: "", extraHint: hintInput.value.trim() }
        : { type: "xcs-suggest", mode: "post", ...postSel, text: postSel.topic, extraHint: hintInput.value.trim() },
      "Đang viết bài"
    );
  }

  // Ô soạn bài mà nút "Gợi ý bài" nằm cạnh có phải ô trả lời không (không gắn nút vào ô trả lời).
  function isReplyToolbar(toolbar) {
    const dialog = toolbar.closest('[role="dialog"]');
    if (dialog)
      return (
        !!dialog.querySelector('article[data-testid="tweet"]') ||
        /reply|trả lời/i.test(dialog.querySelector(".public-DraftEditorPlaceholder-inner")?.textContent || "") ||
        !!(replyTarget && Date.now() - replyTarget.at < 5000)
      );
    return /\/status\//.test(location.pathname);
  }
  function injectPostButtons() {
    document.querySelectorAll('[data-testid="toolBar"]').forEach((tb) => {
      const old = tb.querySelector("[data-xcs-post]");
      if (old && isReplyToolbar(tb)) old.remove(); // gắn nhầm vào ô trả lời lúc X chưa vẽ xong
      if (old || isReplyToolbar(tb)) return;
      const b = document.createElement("button");
      b.setAttribute("data-xcs-post", "1");
      b.type = "button";
      b.title = "Gợi ý bài đăng theo chủ đề, thời điểm, con người, địa điểm (Alt+P)";
      b.textContent = "✍️ Gợi ý bài";
      Object.assign(b.style, {
        border: "1px solid rgba(29,155,240,.5)", background: "transparent", color: "rgb(29,155,240)", borderRadius: "999px",
        padding: "2px 10px", fontSize: "13px", fontWeight: "600", cursor: "pointer", alignSelf: "center",
        margin: "0 6px", whiteSpace: "nowrap", fontFamily: "inherit"
      });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPostPanel(tb);
      });
      (tb.firstElementChild || tb).appendChild(b);
    });
  }
  const postObserver = new MutationObserver(() => {
    clearTimeout(postObserver._t);
    postObserver._t = setTimeout(injectPostButtons, 300);
  });
  postObserver.observe(document.body, { childList: true, subtree: true });
  injectPostButtons();
  // Nút "Viết bài" trong cửa sổ nhỏ của extension.
  chrome.runtime.onMessage.addListener((m, _s, sendResponse) => {
    if (m && m.type === "xcs-open-post") openPostPanel(null);
    // Content Studio nhờ điền bài (chữ + ảnh) vào ô đăng bài. Bạn tự bấm Đăng.
    if (m && m.type === "xcs-fill-post") {
      postComposerHint = null;
      fillPost(m.text, m.img).then((ok) => {
        if (ok) pending = { kind: "post", topic: "", suggested: m.text, studioId: m.studioId, at: Date.now() };
        sendResponse({ ok: !!ok });
      });
      return true;
    }
  });

  // Tìm ô đăng bài mới (không phải ô trả lời) để điền.
  async function findPostComposer() {
    const near = postComposerHint && postComposerHint.isConnected ? postComposerHint : null;
    if (near) {
      for (let el = near; el && el !== document.body; el = el.parentElement) {
        const ta = el.querySelector('[data-testid="tweetTextarea_0"]');
        if (ta) return ta;
      }
    }
    const dlg = document.querySelector('[role="dialog"]');
    if (dlg && !dlg.querySelector('article[data-testid="tweet"]')) {
      const ta = dlg.querySelector('[data-testid="tweetTextarea_0"]');
      if (ta) return ta;
    }
    if (location.pathname === "/home") {
      const ta = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (ta) return ta;
    }
    const newBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
    if (newBtn) {
      newBtn.click();
      return waitFor(() => document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]'), 3000);
    }
    return null;
  }

  // Trả về true khi đã điền được chữ vào ô đăng bài.
  async function fillPost(text, img) {
    if (!text.trim()) return false;
    if (img && img.credit) text = `${text.trim()}\n\n${img.credit}`; // ảnh CC BY phải ghi tác giả
    const composer = await findPostComposer();
    if (!composer) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Không tìm thấy ô đăng bài. Đã sao chép chữ, bạn mở ô đăng bài rồi Ctrl+V.");
      return false;
    }
    await new Promise((r) => setTimeout(r, 150));
    if (!(await insertText(composer, text))) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Chưa điền được tự động. Đã sao chép, bạn bấm vào ô đăng bài rồi Ctrl+V.");
      return false;
    }
    if (img && !(await attachImage(composer, img))) {
      toast("Đã điền chữ. Chưa gắn được ảnh: ảnh đã được chép, bấm vào ô đăng bài rồi Ctrl+V.");
      return true;
    }
    closePanel();
    toast(img ? "Đã điền chữ + ảnh. Đọc lại rồi tự bấm Đăng nhé." : "Đã điền. Đọc lại rồi tự bấm Đăng nhé.");
    return true;
  }

  let currentReq = null;
  let loadingText = "";
  let loadingTimer = null;
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === "xcs-progress" && m.reqId === currentReq) {
      loadingText = m.text;
      const l = contentBox.querySelector(".loading");
      if (l) l.textContent = `${m.text}...`;
    }
  });

  function loadSuggestions(article) {
    const info = getTweetInfo(article);
    startRequest(article, { type: "xcs-suggest", ...info, extraHint: hintInput.value.trim() }, "Đang nghĩ câu bình luận");
    loadPast(article, info);
  }

  // Gửi yêu cầu gợi ý về nền, hiện dòng chờ, rồi vẽ kết quả. article = bài đang trả lời, hoặc POST_KEY khi viết bài mới.
  function startRequest(article, payload, label) {
    contentBox.innerHTML = `<div class="ai"><div class="loading">${label}...</div></div>`;
    if (article !== POST_KEY) contentBox.appendChild(Object.assign(document.createElement("div"), { className: "past" }));
    // Dòng trạng thái: đang hỏi bên nào + đã chờ bao lâu.
    const reqId = String(Date.now()) + Math.random();
    currentReq = reqId;
    loadingText = label;
    const t0 = Date.now();
    clearInterval(loadingTimer);
    const tick = () => {
      const l = contentBox.querySelector(".loading");
      if (!l || currentReq !== reqId) return clearInterval(loadingTimer);
      l.textContent = `${loadingText}... ${Math.round((Date.now() - t0) / 1000)}s`;
    };
    loadingTimer = setInterval(tick, 1000);
    // Extension vừa được tải lại mà trang X chưa F5: script cũ mất kết nối, gửi gì cũng không tới.
    const stale = () => {
      clearInterval(loadingTimer);
      const box = contentBox.querySelector(".ai") || contentBox;
      box.innerHTML = "";
      const n = document.createElement("div");
      n.className = "note";
      n.textContent = "Extension vừa được cập nhật. Bấm F5 tải lại trang X rồi thử lại.";
      box.appendChild(n);
    };
    if (!chrome.runtime?.id) return stale();
    try {
    chrome.runtime.sendMessage(
      { ...payload, reqId },
      (res) => {
        if (currentReq === reqId) clearInterval(loadingTimer);
        if (article !== currentArticle || currentReq !== reqId) return;
        if (chrome.runtime.lastError || !res) {
          const box = contentBox.querySelector(".ai") || contentBox;
          box.innerHTML = "";
          const n = document.createElement("div");
          n.className = "note";
          n.textContent = "Không kết nối được extension. Hãy tải lại trang X.";
          box.appendChild(n);
          return;
        }
        renderSuggestions(res, article);
      }
    );
    } catch (_) {
      stale();
    }
  }

  // Hiện các câu bạn từng đăng cho bài giống (lấy từ kho đã lưu, không gọi AI).
  function loadPast(article, info) {
    chrome.runtime.sendMessage({ type: "xcs-similar", text: info.text }, (res) => {
      if (chrome.runtime.lastError || !res || !res.items || !res.items.length) return;
      if (article !== currentArticle) return;
      const box = contentBox.querySelector(".past");
      if (!box) return;
      box.innerHTML = "";
      const h = document.createElement("div");
      h.className = "src";
      h.textContent = "Câu bạn từng đăng cho bài giống";
      box.appendChild(h);
      const warn = document.createElement("div");
      warn.className = "hint";
      warn.textContent = "Nên sửa vài chữ trước khi đăng: X dễ coi câu lặp y nguyên là spam.";
      box.appendChild(warn);
      res.items.forEach((it) => {
        const meta = document.createElement("div");
        meta.className = "pastmeta";
        meta.textContent = `Bài cũ (giống ${it.sim}%): ${it.post.replace(/\s+/g, " ")}`;
        meta.title = it.post;
        box.appendChild(meta);
        box.appendChild(makeItem(article, it.reply));
      });
    });
  }

  // Một ô câu gợi ý + nút Điền / Sao chép.
  function makeItem(article, text, imgDesc) {
    const item = document.createElement("div");
    item.className = "item";
    const post = article === POST_KEY;
    item.img = null; // ảnh đã chọn cho bài này: { dataUrl, credit }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.rows = post ? 4 : 2;
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    const row = document.createElement("div");
    row.className = "row";
    const use = document.createElement("button");
    use.className = "act primary";
    use.textContent = post ? "Điền vào ô đăng bài" : "Điền vào trả lời";
    use.addEventListener("click", () => {
      rememberPending(article, ta.value);
      post ? fillPost(ta.value, item.img) : fillReply(article, ta.value);
    });
    const copy = document.createElement("button");
    copy.className = "act ghost";
    copy.textContent = "Sao chép";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(ta.value).catch(() => {});
      rememberPending(article, ta.value);
      copy.textContent = "Đã chép";
      setTimeout(() => (copy.textContent = "Sao chép"), 1200);
    });
    row.append(use, copy);
    if (post) {
      // Đếm ký tự gần đúng (X giới hạn 280 với tài khoản thường).
      const len = document.createElement("span");
      len.className = "len";
      const upd = () => {
        const n = [...ta.value].length;
        len.textContent = `${n}/280`;
        len.classList.toggle("over", n > 280);
      };
      ta.addEventListener("input", upd);
      upd();
      row.append(len);
      // Chọn "không ảnh" thì thôi hiện công cụ ảnh.
      item.append(ta, row, ...(postSel.image === "không ảnh" ? [] : imageTools(item, ta, imgDesc)));
      return item;
    }
    item.append(ta, row);
    return item;
  }

  // ---------- Ảnh minh hoạ cho bài đăng ----------
  const ask = (m) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(m, (r) =>
          resolve(chrome.runtime.lastError ? { error: "Mất kết nối extension, bấm F5 tải lại trang X" } : r || { error: "Không có phản hồi" })
        );
      } catch (_) {
        resolve({ error: "Extension vừa được cập nhật, bấm F5 tải lại trang X" });
      }
    });

  function imageTools(item, ta, imgDesc) {
    const bar = document.createElement("div");
    bar.className = "imgbar";
    bar.innerHTML = '<span class="lbl">Ảnh:</span>';
    const box = document.createElement("div");
    box.className = "imgbox";
    const btn = (label, title, fn) => {
      const b = document.createElement("button");
      b.className = "mini";
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      bar.appendChild(b);
    };
    // imgDesc dạng "từ khoá | mô tả" (AI viết). Vẽ thì dùng cả câu, tìm thì dùng từ khoá.
    const [kwPart, descPart] = String(imgDesc || "").includes("|") ? imgDesc.split("|").map((x) => x.trim()) : ["", String(imgDesc || "").trim()];
    const imgStyle = self.XCSPostOpts.IMAGE_STYLE_EN[postSel.image] || "";
    const desc = () => [[kwPart, descPart].filter(Boolean).join(", ") || ta.value, imgStyle].filter(Boolean).join(", ");
    const KW_STOP = new Set(("a an the of on in at with and or to for from by into over under near behind beside while is are sitting standing " +
      "looking holding drinking relaxing walking reading listening wearing focus shot close-up closeup background blurred warm soft natural " +
      "lighting light style photo image scene view young old man woman person people his her their its cozy beautiful").split(" "));
    const keywords = () =>
      kwPart ||
      descPart.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !KW_STOP.has(w)).slice(0, 3).join(" ");
    const wait = (t) => (box.innerHTML = `<div class="wait">${t}</div>`);
    const fail = (e) => (box.innerHTML = `<div class="note">${e}</div>`);

    // Hiện ảnh đã chọn + nút bỏ ảnh (+ nút làm lại nếu có).
    const show = (dataUrl, credit, redoLabel, redo) => {
      item.img = { dataUrl, credit: credit || "" };
      box.innerHTML = "";
      const p = document.createElement("div");
      p.className = "pick";
      const im = document.createElement("img");
      im.src = dataUrl;
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.title = "Bỏ ảnh";
      rm.textContent = "✕";
      rm.addEventListener("click", () => {
        item.img = null;
        box.innerHTML = "";
      });
      p.append(im, rm);
      if (redo) {
        const r = document.createElement("button");
        r.className = "mini redo";
        r.textContent = redoLabel;
        r.addEventListener("click", redo);
        p.append(r);
      }
      box.appendChild(p);
      if (credit) {
        const c = document.createElement("div");
        c.className = "credit";
        c.textContent = `Ảnh cần ghi nguồn, sẽ tự thêm vào cuối bài: ${credit}`;
        box.appendChild(c);
      }
    };

    let palette = Math.floor(Math.random() * QUOTE_PALETTES.length);
    const doQuote = () => {
      palette = (palette + 1) % QUOTE_PALETTES.length;
      show(quoteCard(ta.value, palette), "", "🎨 Đổi màu", doQuote);
    };
    const doAi = async () => {
      wait("Đang vẽ ảnh... (10–60 giây, máy vẽ miễn phí phải xếp hàng)");
      const r = await ask({ type: "xcs-image", kind: "ai", prompt: desc() });
      if (r.error) return fail(`Không vẽ được: ${r.error}`);
      show(r.dataUrl, "", "🔄 Vẽ lại", doAi);
    };
    const doSearch = async (q) => {
      q = typeof q === "string" ? q : keywords();
      box.innerHTML = "";
      const qr = document.createElement("div");
      qr.className = "qrow";
      const inp = document.createElement("input");
      inp.value = q;
      inp.placeholder = "Từ khoá tiếng Anh, vd: iced coffee";
      const go = document.createElement("button");
      go.className = "mini";
      go.textContent = "Tìm";
      const run = () => doSearch(inp.value.trim());
      go.addEventListener("click", run);
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") run();
      });
      qr.append(inp, go);
      const res = document.createElement("div");
      res.innerHTML = '<div class="wait">Đang tìm ảnh trên Openverse...</div>';
      box.append(qr, res);
      if (!q) return (res.innerHTML = '<div class="wait">Gõ từ khoá rồi bấm Tìm.</div>');
      const r = await ask({ type: "xcs-image", kind: "search", q });
      if (r.error) return (res.innerHTML = `<div class="note">${r.error}</div>`);
      if (!r.items.length) return (res.innerHTML = '<div class="wait">Không có ảnh nào, thử từ khoá khác (tiếng Anh, ngắn).</div>');
      res.innerHTML = '<div class="grid"></div><div class="credit">Bấm vào ảnh để chọn. Ảnh Creative Commons từ Openverse.</div>';
      r.items.forEach((it) => {
        const im = document.createElement("img");
        im.src = it.thumbData;
        im.title = it.credit || "Không cần ghi nguồn (CC0 / public domain)";
        im.addEventListener("click", async () => {
          wait("Đang tải ảnh cỡ lớn...");
          const f = await ask({ type: "xcs-image", kind: "fetch", id: it.id });
          // Không tải được bản lớn thì dùng tạm ảnh nhỏ.
          show(f.dataUrl || it.thumbData, it.credit, "🔎 Chọn ảnh khác", () => doSearch(q));
        });
        res.querySelector(".grid").appendChild(im);
      });
    };
    btn("🖋 Ảnh chữ", "Ảnh nền màu + câu chữ lớn, vẽ ngay trên máy", doQuote);
    btn("🎨 AI vẽ", "AI vẽ ảnh minh hoạ theo bài (Pollinations, miễn phí)", doAi);
    btn("🔎 Tìm ảnh", "Tìm ảnh Creative Commons trên mạng (Openverse)", doSearch);
    return [bar, box];
  }

  // Ảnh chữ (quote card): vẽ trong imagekit.js, dùng chung với trang Studio.
  const { quoteCard, QUOTE_PALETTES } = self.XCSImage;

  // Đưa ảnh vào ô đăng bài của X: qua nút chọn file, không được thì giả lập dán ảnh.
  async function attachImage(composer, img) {
    // Tự giải mã data URL (không dùng fetch, CSP của X không cho fetch "data:").
    const [head, b64] = img.dataUrl.split(",");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: (head.match(/^data:([^;]+)/) || [])[1] || "image/png" });
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const file = new File([blob], `anh-minh-hoa.${ext}`, { type: blob.type || "image/png" });
    let scope = composer;
    let input = null;
    for (let el = composer; el && el !== document.body && !input; el = el.parentElement) {
      input = el.querySelector('input[data-testid="fileInput"]');
      scope = el;
    }
    const attached = () => scope.querySelector('[data-testid="attachments"] img, [data-testid="attachments"] [style*="background-image"]');
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (await waitFor(attached, 4000)) return true;
    }
    try {
      const target = composer.querySelector('[contenteditable="true"]') || composer;
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      if (await waitFor(attached, 4000)) return true;
    } catch (_) {
      // không giả lập dán được
    }
    // Cuối cùng: chép ảnh vào bộ nhớ tạm (clipboard chỉ nhận PNG) để bạn tự Ctrl+V.
    try {
      const png = blob.type === "image/png" ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch (_) {
      // bỏ qua
    }
    return false;
  }
  async function toPng(blob) {
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement("canvas");
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    return new Promise((r) => cv.toBlob(r, "image/png"));
  }

  function renderSuggestions(res, article) {
    const box = contentBox.querySelector(".ai") || contentBox;
    box.innerHTML = "";
    const src = document.createElement("div");
    src.className = "src";
    const post = article === POST_KEY;
    src.textContent = res.source === "ai" ? `Gợi ý bởi ${res.provider || "AI"}${res.model ? " · " + res.model : ""}${res.imageCount ? ` · đã xem ${res.imageCount} ảnh` : ""}${res.route ? ` · ${res.route}` : ""}` : post ? "" : "Câu mẫu có sẵn";
    box.appendChild(src);
    if (res.context) {
      const c = document.createElement("div");
      c.className = "ctx";
      c.textContent = post ? `Góc viết: ${res.context}` : `AI hiểu bài: ${res.context}`;
      c.title = post ? "Muốn góc khác thì gõ thêm ý rồi bấm Tạo bài" : "Nếu AI hiểu sai, gõ thêm ý vào ô phía trên rồi bấm Tạo lại";
      box.appendChild(c);
    }
    if (res.note) {
      const n = document.createElement("div");
      n.className = "note";
      n.textContent = res.note;
      box.appendChild(n);
    }
    res.suggestions.forEach((s, i) => box.appendChild(makeItem(article, s, (res.images || [])[i])));
  }

  // ---------- Điền chữ vào ô trả lời (không bấm gửi) ----------
  function waitFor(selectorFn, timeout = 4000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        const el = selectorFn();
        if (el) return resolve(el);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(tick, 120);
      })();
    });
  }

  function findComposer() {
    const dialog = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]');
    if (dialog) return dialog;
    return document.querySelector('[data-testid="tweetTextarea_0"]');
  }

  async function insertText(editor, text) {
    const target = editor.querySelector('[contenteditable="true"]') || editor;
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const has = () => norm(target.innerText).includes(norm(text).slice(0, 15));
    const isEmpty = () => norm(target.innerText) === "";

    const waitHas = async () => {
      // Draft.js vẽ lại chậm một chút: chờ rồi mới kiểm tra.
      for (let i = 0; i < 8; i++) {
        await sleep(80);
        if (has()) return true;
      }
      return false;
    };

    target.focus();
    await sleep(50);
    // Ô đã có chữ thì chọn hết để câu mới thay thế, không bị dồn khi bấm Điền nhiều lần.
    if (!isEmpty()) {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {
        // không chọn được thì điền tiếp vào cuối
      }
    }

    // Cách 1: giả lập dán. X (Draft.js) tự chèn chữ và chặn trình duyệt chèn thêm, nên không bị lặp.
    // (execCommand("insertText") trên X bị chèn 2 lần: Draft.js chèn 1 lần + trình duyệt chèn 1 lần.)
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {
      // trình duyệt không cho tạo sự kiện dán, chuyển sang cách 2
    }
    if (await waitHas()) return true;

    // Cách 2: chỉ dùng execCommand khi ô vẫn trống.
    if (!isEmpty()) return true;
    try {
      document.execCommand("insertText", false, text);
    } catch (_) {
      // bỏ qua, báo lỗi ở dưới
    }
    return waitHas();
  }

  // ---------- Học từ câu bạn thật sự đăng ----------
  // Khi bạn bấm Điền/Sao chép, nhớ bài + câu gợi ý. Khi bạn bấm nút Reply của X,
  // đọc chữ cuối cùng trong ô trả lời (đã sửa hay chưa) rồi lưu lại làm ví dụ cho lần sau.
  let pending = null;
  function rememberPending(article, suggested) {
    if (article === POST_KEY) {
      pending = { kind: "post", topic: postSel.topic, suggested, at: Date.now() };
      return;
    }
    const info = getTweetInfo(article);
    pending = {
      post: (info.text || "").slice(0, 600), author: info.author, images: info.images || [], suggested, at: Date.now(),
      onMyPost: info.onMyPost, myPost: info.myPost, myPostId: info.myPostId
    };
  }
  // Bắt cú bấm nút Reply/Post của X (chạy trước X để còn đọc được chữ trong ô).
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest && e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      if (btn) {
        trackSend();
      }
    },
    true
  );
  // Ctrl+Enter / Cmd+Enter trong ô trả lời cũng là đăng.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.closest?.('[data-testid="tweetTextarea_0"]')) {
        trackSend();
      }
    },
    true
  );

  async function fillReply(article, text) {
    if (!text.trim()) return;
    let composer = null;
    // Trang chi tiết bài có sẵn ô trả lời ngay dưới, còn trên dòng thời gian phải bấm nút Trả lời.
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      quickSkipUntil = Date.now() + 5000; // đã có câu từ bảng gợi ý, dải gợi ý nhanh khỏi gọi AI lần nữa
      replyBtn.click();
      composer = await waitFor(() => document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]'), 2500);
    }
    if (!composer) composer = await waitFor(findComposer, 1500);
    if (!composer) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Không tìm thấy ô trả lời. Đã sao chép câu, bạn bấm Trả lời rồi Ctrl+V.");
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
    const ok = await insertText(composer, text);
    if (!ok) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Chưa điền được tự động. Đã sao chép, bạn bấm vào ô trả lời rồi Ctrl+V.");
    } else {
      closePanel();
      toast("Đã điền. Đọc lại rồi tự bấm Trả lời nhé.");
    }
  }

  // ---------- Dải gợi ý nhanh ngay dưới ô trả lời của X ----------
  // Bấm nút Trả lời của X: dưới khung trả lời hiện vài câu ngắn có emoji, bấm một câu là điền vào ô (Alt+1..5).
  // Bạn vẫn tự sửa và tự bấm Trả lời.
  const quickStyle = document.createElement("style");
  quickStyle.textContent = `
    .quick { position: fixed; z-index: 2147483646; display: none; box-sizing: border-box;
      background: #fff; color: #0f1419; border: 1px solid #cfd9de; border-radius: 16px; padding: 8px 10px 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); font: 14px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .quick.dark { background: #15202b; color: #e7e9ea; border-color: #38444d; }
    .quick.open { display: block; }
    .quick .qh { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: .7; margin-bottom: 6px; }
    .quick .qh span { flex: 1; }
    .quick .qh button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 14px; padding: 0 4px; }
    .quick .qlist { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .quick .qi { text-align: left; border: 1px solid rgba(29,155,240,.35); background: rgba(29,155,240,.06); color: inherit;
      border-radius: 12px; padding: 7px 10px; cursor: pointer; font: inherit; display: flex; gap: 8px; }
    .quick .qi:hover { background: rgba(29,155,240,.16); }
    .quick .qi.on { border-color: #1d9bf0; background: rgba(29,155,240,.22); }
    .quick .qi b { color: #1d9bf0; font-size: 12px; min-width: 12px; }
    .quick .qwait, .quick .qnote { font-size: 13px; opacity: .75; padding: 4px 2px; }
    .quick .qctx { font-size: 12px; opacity: .75; margin: -2px 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .quick .qctx:empty { display: none; }
    .quick .qgo { border: 1px solid #1d9bf0; color: #1d9bf0; background: transparent; border-radius: 999px; padding: 4px 12px;
      cursor: pointer; font: inherit; font-weight: 600; }
  `;
  const quick = document.createElement("div");
  quick.className = "quick";
  quick.innerHTML = `<div class="qh"><span>💬 Gợi ý nhanh · bấm để điền (Alt+1..5)</span>
    <button class="qre" title="Gợi ý câu khác">↻</button><button class="qx" title="Ẩn">✕</button></div>
    <div class="qctx"></div><div class="qlist"></div>`;
  shadow.append(quickStyle, quick);
  const qList = quick.querySelector(".qlist");
  const quickCache = new Map(); // bài -> các câu đã gợi ý (mở lại cùng bài thì khỏi gọi AI)
  let quickSkipUntil = 0;
  let quickCur = null; // { ta, art, key, hidden, req }
  // Không cho nút trong dải lấy mất con trỏ khỏi ô trả lời của X.
  quick.addEventListener("mousedown", (e) => e.preventDefault());

  function replyDialog() {
    for (const dlg of document.querySelectorAll('[role="dialog"]')) {
      const ta = dlg.querySelector('[data-testid="tweetTextarea_0"]');
      const art = dlg.querySelector('article[data-testid="tweet"]');
      if (ta && art) return { ta, art };
    }
    return null;
  }
  // Khung trắng của cửa sổ trả lời: tổ tiên lớn nhất của ô soạn có nền đặc (không trong suốt) và hẹp hơn màn hình.
  // (Lớp phủ xám của X có nền mờ, các lớp bọc ngoài trong suốt nên không bị chọn nhầm.)
  function dialogBox(ta) {
    let box = null;
    for (let el = ta.parentElement; el && el !== document.body; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.9) break;
      const bg = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (bg && (bg.length < 4 || Number(bg[3]) === 1) && r.height > 80) box = el;
    }
    return (box || ta).getBoundingClientRect();
  }
  // Dải gợi ý: ngay dưới khung trả lời, rộng 1/3 màn hình, canh giữa theo khung.
  function placeQuick() {
    if (!quickCur) return;
    const r = dialogBox(quickCur.ta);
    const w = Math.min(innerWidth - 16, Math.max(360, Math.round(innerWidth / 3)));
    const left = Math.max(8, Math.min(innerWidth - w - 8, Math.round(r.left + r.width / 2 - w / 2)));
    quick.style.left = `${left}px`;
    quick.style.width = `${w}px`;
    let top = r.bottom + 8;
    if (innerHeight - top < 140) top = Math.max(8, innerHeight - 140); // khung trả lời cao gần hết màn hình
    quick.style.top = `${top}px`;
    qList.style.maxHeight = `${Math.max(80, innerHeight - top - 52)}px`;
    const bg = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
    quick.classList.toggle("dark", bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11 < 128);
  }
  function quickRender(list, note) {
    qList.innerHTML = "";
    if (note) qList.append(Object.assign(document.createElement("div"), { className: "qnote", textContent: note }));
    list.forEach((text, i) => {
      const b = document.createElement("button");
      b.className = "qi";
      b.innerHTML = `<b>${i + 1}</b><span></span>`;
      b.lastChild.textContent = text;
      b.addEventListener("click", () => quickPick(i));
      qList.appendChild(b);
    });
  }
  // Thông tin bài đang trả lời: bản trong cửa sổ trả lời của X thiếu dòng "Đang trả lời @...",
  // nên lấy thêm từ thẻ bài bạn vừa bấm nút Trả lời (trên trang Thông báo / dòng thời gian).
  const normT = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 60);
  function quickInfo(cur) {
    const base = getTweetInfo(cur.art);
    const t = cur.tgt;
    if (!t || (base.text && t.text && normT(base.text) !== normT(t.text))) return base;
    return {
      ...base,
      text: base.text || t.text,
      author: base.author || t.author,
      images: base.images.length ? base.images : t.images || [],
      hasMedia: base.hasMedia || t.hasMedia,
      id: base.id || t.id,
      onMyPost: base.onMyPost || t.onMyPost,
      myPost: base.myPost || t.myPost,
      myPostId: base.myPostId || t.myPostId
    };
  }
  async function quickPick(i) {
    const b = qList.querySelectorAll(".qi")[i];
    if (!b || !quickCur) return;
    const text = b.lastChild.textContent;
    qList.querySelectorAll(".qi").forEach((x) => x.classList.toggle("on", x === b));
    rememberPending(quickCur.art, text);
    const info = quickInfo(quickCur);
    if (pending) Object.assign(pending, { post: (info.text || "").slice(0, 600), author: info.author, onMyPost: info.onMyPost, myPost: info.myPost, myPostId: info.myPostId });
    if (!(await insertText(quickCur.ta, text))) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Chưa điền được. Đã sao chép, bấm vào ô trả lời rồi Ctrl+V.");
    }
  }
  // Dòng tiêu đề + dòng "đang trả lời ai" của dải, vẽ lại cho mỗi cửa sổ trả lời (không để sót của lần trước).
  function quickHeader(info, by) {
    quick.querySelector(".qh span").textContent =
      (info.onMyPost ? "💬 Đáp bình luận dưới bài của bạn" : "💬 Gợi ý nhanh") + (by ? ` · ${by}` : "") + " · Alt+1..5";
    const who = (info.author.match(/^[^@\n]+/) || [""])[0].trim() || info.author;
    const ctxEl = quick.querySelector(".qctx");
    ctxEl.textContent = info.onMyPost
      ? `Bài của bạn: "${normT(info.myPost) || "(chưa đọc được)"}" → ${who}: "${normT(info.text)}"`
      : `Trả lời ${who}: "${normT(info.text) || "(bài không có chữ)"}"`;
    ctxEl.title = (info.myPost ? `Bài của bạn:\n${info.myPost}\n\n` : "") + `${info.author}:\n${info.text}`;
  }
  function quickLoad(force) {
    const cur = quickCur;
    if (!cur) return;
    const info = quickInfo(cur);
    quickHeader(info, "");
    if (!force && quickCache.has(cur.key)) return quickRender(quickCache.get(cur.key));
    if (!chrome.runtime?.id) return quickRender([], "Extension vừa được cập nhật. Bấm F5 trang X.");
    const t0 = Date.now();
    qList.innerHTML = `<div class="qwait">Đang nghĩ câu trả lời...</div>`;
    const timer = setInterval(() => {
      const w = qList.querySelector(".qwait");
      if (!w || quickCur !== cur) return clearInterval(timer);
      w.textContent = `Đang nghĩ câu trả lời... ${Math.round((Date.now() - t0) / 1000)}s`;
    }, 1000);
    const reqId = "q" + Date.now() + Math.random();
    cur.req = reqId;
    try {
      chrome.runtime.sendMessage({ type: "xcs-suggest", quick: true, reqId, ...info }, (res) => {
        clearInterval(timer);
        if (quickCur !== cur || cur.req !== reqId) return;
        if (chrome.runtime.lastError || !res) return quickRender([], "Không kết nối được extension. Tải lại trang X.");
        const list = res.suggestions || [];
        if (list.length && res.source === "ai") quickCache.set(cur.key, list);
        quickHeader(info, res.source === "ai" ? `${res.provider || "AI"}${res.model ? " · " + res.model : ""}` : "câu mẫu");
        quickRender(list, res.source === "ai" ? "" : res.note);
        placeQuick();
      });
    } catch (_) {
      clearInterval(timer);
      quickRender([], "Extension vừa được cập nhật. Bấm F5 trang X.");
    }
  }
  quick.querySelector(".qre").addEventListener("click", () => quickLoad(true));
  quick.querySelector(".qx").addEventListener("click", () => {
    if (quickCur) quickCur.hidden = true;
    quick.classList.remove("open");
  });
  const quickTimer = setInterval(() => {
    if (!chrome.runtime?.id) {
      // Extension vừa tải lại: trang cũ mất kết nối, dải gợi ý không hiện được nữa.
      // Đừng im lặng: lần tới mở cửa sổ trả lời thì nhắc F5.
      clearInterval(quickTimer);
      const warn = setInterval(() => {
        if (!replyDialog()) return;
        clearInterval(warn);
        toast("Extension vừa được cập nhật nên chưa có gợi ý: bấm F5 tải lại trang X.");
      }, 1000);
      return;
    }
    const d = replyDialog();
    if (!d) {
      quickCur = null;
      return quick.classList.remove("open");
    }
    if (!quickCur || quickCur.ta !== d.ta) {
      const info = getTweetInfo(d.art);
      const tgt = replyTarget && Date.now() - replyTarget.at < 10000 ? replyTarget : null;
      const cur = (quickCur = { ...d, tgt, key: `${info.author}\n${info.text}\n${(info.images || []).join(" ")}`, hidden: false });
      chrome.storage.local.get({ quickReply: true }, ({ quickReply }) => {
        if (!quickReply || quickCur !== cur) return;
        // Câu đã được điền từ bảng "💬 Gợi ý": không hiện dải nữa (bạn đã chọn câu rồi).
        if (Date.now() < quickSkipUntil) {
          cur.hidden = true;
          return quick.classList.remove("open");
        }
        quick.classList.add("open");
        quickLoad(false);
        placeQuick();
      });
      return;
    }
    if (!quickCur.hidden && quick.classList.contains("open")) placeQuick();
  }, 300);
  // Alt+1..5: chọn câu trong dải gợi ý nhanh (cả khi đang gõ trong ô trả lời).
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !quickCur || !quick.classList.contains("open")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 5 && qList.querySelectorAll(".qi")[n - 1]) {
        e.preventDefault();
        e.stopPropagation();
        quickPick(n - 1);
      }
    },
    true
  );

  // ---------- Thông báo nhỏ ----------
  const toastEl = document.createElement("div");
  toastEl.setAttribute(
    "style",
    "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1d9bf0;color:#fff;" +
      "padding:8px 14px;border-radius:999px;font:13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.2);display:none;max-width:90vw;text-align:center;"
  );
  shadow.appendChild(toastEl);
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => (toastEl.style.display = "none"), 3200);
  }

  // ---------- Phím tắt chuyển bài thủ công ----------
  function isTyping(e) {
    const t = e.composedPath()[0];
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function articlesSorted() {
    return Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  }

  function articleAtTop() {
    const list = articlesSorted();
    return list.find((a) => a.getBoundingClientRect().bottom > 80) || list[0];
  }

  function scrollToArticle(dir) {
    const list = articlesSorted();
    const offset = 70; // chiều cao thanh tiêu đề của X
    if (dir > 0) {
      const next = list.find((a) => a.getBoundingClientRect().top > offset + 5);
      if (next) window.scrollBy({ top: next.getBoundingClientRect().top - offset, behavior: "smooth" });
    } else {
      const prev = list.filter((a) => a.getBoundingClientRect().top < offset - 5).pop();
      if (prev) window.scrollBy({ top: prev.getBoundingClientRect().top - offset, behavior: "smooth" });
    }
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && panel.classList.contains("open")) {
        closePanel();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || isTyping(e)) return;
      const k = e.code;
      if (k === "KeyJ") {
        e.preventDefault();
        scrollToArticle(1);
      } else if (k === "KeyK") {
        e.preventDefault();
        scrollToArticle(-1);
      } else if (k === "KeyP") {
        e.preventDefault();
        openPostPanel(null);
      } else if (k === "KeyG") {
        e.preventDefault();
        const a = articleAtTop();
        if (a) openPanel(a);
      }
    },
    true
  );
})();

// Mở X thì nhờ nền nạp sẵn model Ollama (nếu đang dùng), lần Gợi ý đầu đỡ chậm.
try { chrome.runtime.sendMessage({ type: "xcs-warm" }); } catch (_) {}
