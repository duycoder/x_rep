// Content script cho facebook.com
// - Mỗi bài (bảng tin, nhóm, trang) có nút "💾 Lưu bài" nổi ở khoảng trống bên phải bài, gần góc dưới.
// - Nút "✨ Tạo bài viết cho X" ngay trên: AI phân tích bài rồi viết bài mới cho X (cùng giọng, cùng ý, có emoji).
// - Bài của các page bạn chọn (Cài đặt → "Page Facebook để học") được tự lưu khi hiện ra, kể cả trên bảng tin.
// Không tự cuộn, không gửi gì lên Facebook. Chỉ bấm "Xem thêm" của bài để lấy đủ chữ.
// Bài đã lưu nằm ở "Chờ duyệt" trong trang Dữ liệu bài viết (bấm huy hiệu 💾 góc dưới bên trái).
(() => {
  if (window.__xcsFb) return;
  window.__xcsFb = true;

  // "nguoibl", "https://www.facebook.com/nguoibl", "profile.php?id=123" -> "nguoibl" / "id:123"
  const norm = (x) => {
    const s = String(x || "").trim().replace(/^https?:\/\/(www\.|web\.|m\.)?facebook\.com\//i, "");
    const id = (s.match(/profile\.php\?id=(\d+)/i) || [])[1];
    return id ? `id:${id}` : s.replace(/[/?#].*$/, "").toLowerCase();
  };
  let pages = [];
  let enabled = true;
  let autoBottom = true; // tự lưu mọi bài khi bạn cuộn tới đáy bài (đã đọc hết)
  const load = () =>
    chrome.storage.local.get({ fbPages: "nguoibl", fbSave: true, fbAutoBottom: true }, (s) => {
      enabled = !!s.fbSave;
      autoBottom = enabled && !!s.fbAutoBottom;
      pages = String(s.fbPages).split(/[\s,]+/).map(norm).filter(Boolean);
      scan();
    });
  const curPage = () => {
    const seg = (location.pathname.split("/")[1] || "").toLowerCase();
    const key = seg === "profile.php" ? `id:${new URLSearchParams(location.search).get("id") || ""}` : seg;
    return pages.includes(key) ? key : "";
  };

  // Phần chữ của bài (không phải bình luận).
  const MSG_SEL = '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]';
  const MORE_RE = /^(xem thêm|see more)$/i;
  const NOT_PAGE = new Set(["groups", "watch", "stories", "photo", "photo.php", "permalink.php", "story.php", "reel", "events", "hashtag", "people"]);
  const sent = new Set();
  let saved = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Huy hiệu góc dưới bên trái (bấm để mở trang Dữ liệu bài viết) ----------
  const badge = document.createElement("div");
  badge.setAttribute(
    "style",
    "position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#1d9bf0;color:#fff;padding:6px 12px;border-radius:999px;" +
      "font:13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.2);display:none;cursor:pointer"
  );
  badge.title = "Bấm để xem dữ liệu bài viết, kiểm tra trùng và đưa vào dữ liệu train";
  badge.addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({ type: "fb-open-data" });
    } catch (_) {
      // extension vừa tải lại
    }
  });
  document.documentElement.appendChild(badge);
  const showBadge = (total) => {
    badge.textContent = `💾 Đã lưu ${saved} bài mới lần này${total != null ? ` · tổng ${total}` : ""} · 📋 Xem dữ liệu`;
    badge.style.display = "block";
  };

  // ---------- Đọc một bài ----------
  // Chữ nằm trong một bình luận? Lưu ý khung bài có thể bọc chính thẻ article của bài:
  // article đó KHÔNG phải bình luận (lỗi cũ: coi cả bài là bình luận nên báo "không có chữ").
  const CMT_LABEL = /bình luận|comment|trả lời|reply|phản hồi/i;
  const inComment = (el, post) => {
    const art = el.closest('[role="article"]');
    if (!art || art === post || !post.contains(art)) return false;
    if (CMT_LABEL.test(art.getAttribute("aria-label") || "")) return true;
    const outer = art.parentElement && art.parentElement.closest('[role="article"]');
    return !!outer && post.contains(outer); // article lồng trong article khác của bài = bình luận
  };
  // Phần chữ chính của bài. Bài nền màu (chữ to giữa khung) không có thẻ story_message: lấy khối chữ dài nhất ngoài bình luận.
  function textEl(post) {
    const msg = [...post.querySelectorAll(MSG_SEL)].find((el) => !inComment(el, post) && !(el.parentElement && el.parentElement.closest(MSG_SEL)));
    if (msg) return msg;
    let best = null;
    let bestLen = 0;
    post.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach((el) => {
      if (inComment(el, post) || el.closest('h2, h3, h4, a, [role="button"], [contenteditable="true"], [data-ad-rendering-role="profile_name"]')) return;
      const n = el.innerText.trim().length;
      if (n > bestLen) {
        best = el;
        bestLen = n;
      }
    });
    if (bestLen >= 20) return best;
    // Bài chữ trên nền màu (chữ to giữa khung): chữ không nằm trong thẻ dir="auto" và có khi nằm trong link/nút.
    // Lấy khối chữ dài nhất mà không chứa tên người đăng, nút, bình luận hay ô nhập.
    const BLOCK_OUT = '[data-ad-rendering-role="profile_name"], h2, h3, h4, [role="button"], [role="article"], [contenteditable="true"], [role="textbox"], img';
    post.querySelectorAll("div, span").forEach((el) => {
      if (inComment(el, post) || el.querySelector(BLOCK_OUT) || el.closest('h2, h3, h4, [contenteditable="true"], [data-ad-rendering-role="profile_name"]')) return;
      const t = el.innerText.trim();
      if (!/\s/.test(t) || /^[\d.,\sKkMTr]+$/.test(t)) return; // bỏ số đếm lượt thích...
      if (/^(bình luận dưới tên|viết bình luận|xem thêm bình luận|comment as|write a comment|view more comments)/i.test(t)) return; // chữ của ô bình luận
      if (t.length > bestLen) {
        best = el;
        bestLen = t.length;
      }
    });
    return bestLen >= 20 ? best : null;
  }
  async function readText(post) {
    let el = textEl(post);
    if (!el) return "";
    const more = [...el.querySelectorAll('[role="button"]')].find((b) => MORE_RE.test(b.innerText.trim()));
    if (more) {
      more.click(); // lấy đủ chữ của bài bị cắt
      await sleep(500);
      el = textEl(post) || el;
    }
    // bỏ chữ của nút "Ẩn bớt" / "See less" hiện ra sau khi bấm "Xem thêm"
    return el.innerText.replace(/[ \t]*(ẩn bớt|see less)[ \t]*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  // Người / page đăng bài: tên trong link ở đầu bài.
  function authorOf(post) {
    const a = [...post.querySelectorAll('[data-ad-rendering-role="profile_name"] a, h2 a, h3 a, h4 a')].find((x) => !inComment(x, post));
    if (!a) return { slug: "", name: "" };
    const name = a.innerText.trim();
    let slug = "";
    try {
      const u = new URL(a.href, location.origin);
      const seg = (u.pathname.split("/")[1] || "").toLowerCase();
      if (seg === "profile.php") slug = `id:${u.searchParams.get("id") || ""}`;
      else if (seg && !NOT_PAGE.has(seg)) slug = seg;
    } catch (_) {
      // link lạ
    }
    return { slug, name };
  }
  function postLink(post) {
    const a = post.querySelector('a[href*="/posts/"], a[href*="/videos/"], a[href*="story_fbid="], a[href*="/permalink/"]');
    if (!a) return "";
    try {
      const u = new URL(a.href, location.origin);
      const keep = ["story_fbid", "id", "fbid", "v"];
      [...u.searchParams.keys()].forEach((k) => keep.includes(k) || u.searchParams.delete(k));
      return u.href;
    } catch (_) {
      return "";
    }
  }

  // ---------- Lưu ----------
  function save(page, text, url) {
    return new Promise((resolve) => {
      if (!chrome.runtime?.id) return resolve(null);
      try {
        chrome.runtime.sendMessage({ type: "fb-save-post", page, text, url }, (res) => {
          if (chrome.runtime.lastError || !res) return resolve(null);
          if (res.added) saved++;
          showBadge(res.total);
          resolve(res);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }
  async function savePost(post, btn) {
    const text = await readText(post);
    const { slug, name } = authorOf(post);
    if (text.length < 20) {
      if (btn) setDone(btn, "Không đọc được chữ");
      return;
    }
    sent.add(text);
    const res = await save(slug || name || "khác", text, postLink(post));
    if (btn) setDone(btn, !res ? "Lỗi, F5 thử lại" : res.added ? "✓ Đã lưu" : "✓ Đã có");
  }

  // ---------- Tìm các bài trên trang ----------
  // Facebook hay đổi giao diện nên dò theo nhiều dấu hiệu: khung bài trên bảng tin, tên người đăng, phần chữ của bài.
  const SEEDS = ['[aria-posinset]', '[role="article"]', '[data-ad-rendering-role="profile_name"]', MSG_SEL];
  const COMMENT_RE = /bình luận|comment|trả lời|reply|phản hồi/i;
  // Khung chứa từ 2 bài trở lên (2 tên người đăng / 2 dấu bài) thì không phải một bài.
  // Lỗi cũ: lúc mới mở trang chỉ có 1 bài nên khung leo lên tận cả cột bảng tin, các bài tải sau nằm trong đó nên không có nút.
  const MARKS = ['[aria-posinset]', '[data-ad-rendering-role="profile_name"]'];
  function overgrown(el) {
    return MARKS.some((m) => [...el.querySelectorAll(m)].filter((x) => !inComment(x, el)).length > 1);
  }
  function cardOf(seed, sel) {
    let box = seed;
    for (let el = seed.parentElement, i = 0; el && el !== document.body && i < 40; el = el.parentElement, i++) {
      if (el.querySelectorAll(sel).length > 1 || el.getBoundingClientRect().width > 900 || overgrown(el)) break;
      box = el;
    }
    return box;
  }
  // Tin nhắn Messenger (khung chat nổi, trang /messages) cũng là role="article" nhưng nằm trong role="log":
  // không phải bài đăng, không gắn nút, không tự lưu (lỗi cũ: tin nhắn riêng bị lưu thành bài của page).
  const inChat = (el) => !!el.closest('[role="log"]') || /^\/(messages|t)\//.test(location.pathname);
  function findPosts() {
    // Gỡ khung đã đánh dấu nhầm (nay chứa nhiều bài, hoặc là tin nhắn chat) để tìm lại từng bài.
    document.querySelectorAll("[data-xcs-post]").forEach((card) => {
      if (!overgrown(card) && !inChat(card)) return;
      delete card.dataset.xcsPost;
      delete card.dataset.xcsAuto;
      const b = buttons.get(card);
      if (b) b.remove();
      buttons.delete(card);
    });
    for (const sel of SEEDS) {
      document.querySelectorAll(sel).forEach((seed) => {
        if (seed.closest("[data-xcs-post]") || inChat(seed)) return; // đã thuộc một bài / tin nhắn chat
        if (seed.matches('[role="article"]') && COMMENT_RE.test(seed.getAttribute("aria-label") || "")) return; // bình luận
        const card = cardOf(seed, sel);
        if (card.closest("[data-xcs-post]") || card.querySelector("[data-xcs-post]")) return;
        const r = card.getBoundingClientRect();
        if (r.width < 300 || r.height < 80) return;
        card.dataset.xcsPost = "1";
      });
    }
    return [...document.querySelectorAll("[data-xcs-post]")];
  }

  // ---------- Nút "💾 Lưu bài" nổi ở khoảng trống bên phải mỗi bài, gần góc dưới ----------
  const layerHost = document.createElement("div");
  layerHost.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646";
  document.documentElement.appendChild(layerHost);
  const layer = layerHost.attachShadow({ mode: "open" });
  layer.innerHTML = `<style>
    .b { position: fixed; display: none; padding: 6px 12px; border-radius: 999px; border: 1px solid #1d9bf0; background: #fff;
      color: #1d9bf0; font: 600 13px/1.2 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; cursor: pointer; white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .b:hover { background: #e8f5fe; }
    .b.done { border-color: #00875a; color: #00875a; }
    .b.busy { cursor: progress; opacity: .85; }
    .b.busy::before { content: ""; display: inline-block; width: 11px; height: 11px; margin: 0 6px -1px 0; border-radius: 50%;
      border: 2px solid currentColor; border-right-color: transparent; animation: xcsspin .7s linear infinite; }
    @keyframes xcsspin { to { transform: rotate(360deg); } }
    .w { position: fixed; z-index: 1; display: none; flex-direction: column; align-items: stretch; gap: 6px; }
    .w .b { position: static; display: block; text-align: center; }
    .xb { background: #0f1419; border-color: #0f1419; color: #fff; }
    .xb:hover { background: #272c30; }
    .vd { position: fixed; display: none; z-index: 2; padding: 5px 10px; border-radius: 999px; border: 0; background: rgba(0,0,0,.62);
      color: #fff; font: 600 12px/1.2 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; cursor: pointer; white-space: nowrap; }
    .vd:hover { background: rgba(0,0,0,.82); }
    .vd.done { background: #00875a; }

    /* ---------- Bảng "Tạo bài viết cho X" ---------- */
    .fx { --bg: #fff; --fg: #0f1419; --mut: #536471; --line: #e3e7ea; --soft: #f5f8fa; --acc: #1d9bf0; --ok: #00875a; --bad: #d4183d;
      position: fixed; top: 64px; right: 16px; width: 410px; max-width: calc(100vw - 32px); max-height: calc(100vh - 84px);
      z-index: 5; display: none; flex-direction: column; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,.25); font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; overflow: hidden; }
    .fx.on { display: flex; }
    @media (prefers-color-scheme: dark) {
      .fx { --bg: #1c1e21; --fg: #e7e9ea; --mut: #8b98a5; --line: #33363a; --soft: #24272b; }
    }
    .fx * { box-sizing: border-box; }
    .fx .hd { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .fx .hd b { flex: 1; font-size: 15px; }
    .fx .bd { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .fx .ft { padding: 10px 14px; border-top: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .fx .ft:empty { display: none; }
    .fx button { font: inherit; cursor: pointer; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
      padding: 6px 12px; font-weight: 600; font-size: 13px; }
    .fx button:hover:not(:disabled) { background: var(--soft); }
    .fx button:disabled { opacity: .5; cursor: default; }
    .fx button.pri { background: var(--acc); border-color: var(--acc); color: #fff; }
    .fx button.pri:hover:not(:disabled) { filter: brightness(1.08); background: var(--acc); }
    .fx button.dark { background: var(--fg); border-color: var(--fg); color: var(--bg); }
    .fx button.dark:hover:not(:disabled) { background: var(--fg); color: var(--bg); opacity: .82; }
    .fx button.ic { border: 0; padding: 4px 8px; font-size: 16px; }
    .fx .grow { flex: 1; }
    .fx .lbl { font-size: 12px; font-weight: 700; color: var(--mut); text-transform: uppercase; letter-spacing: .03em; }
    .fx .src { background: var(--soft); border-radius: 12px; padding: 10px 12px; white-space: pre-wrap; font-size: 13px; color: var(--mut);
      max-height: 7.5em; overflow: hidden; position: relative; cursor: pointer; }
    .fx .src.open { max-height: none; cursor: default; }
    .fx .src:not(.open)::after { content: "Xem hết ▾"; position: absolute; right: 8px; bottom: 6px; background: var(--soft);
      color: var(--acc); font-weight: 600; padding-left: 8px; }
    .fx .goals { display: flex; flex-direction: column; gap: 6px; }
    .fx .goal { display: flex; align-items: flex-start; gap: 10px; text-align: left; border-radius: 12px; padding: 9px 12px; font-weight: 500; }
    .fx .goal .e { font-size: 18px; line-height: 1.2; }
    .fx .goal small { display: block; color: var(--mut); font-weight: 400; font-size: 12px; margin-top: 1px; }
    .fx .goal.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, var(--bg)); }
    .fx .goal.on .t::after { content: " ✓"; color: var(--acc); }
    .fx input.hint { width: 100%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; }
    .fx .auds { display: flex; flex-wrap: wrap; gap: 6px; }
    .fx .aud { border-radius: 999px; padding: 5px 11px; font-weight: 500; font-size: 13px; }
    .fx .aud.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, var(--bg)); color: var(--acc); }
    .fx .note { font-size: 12px; color: var(--mut); }
    .fx .err { color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, var(--bg)); border-radius: 10px; padding: 10px 12px; font-size: 13px; }
    /* đang xử lý */
    .fx .proc { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 0 8px; }
    .fx .ring { width: 44px; height: 44px; border-radius: 50%; border: 4px solid var(--line); border-top-color: var(--acc); animation: xcsspin .9s linear infinite; }
    .fx .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; align-self: stretch; }
    .fx .steps li { display: flex; gap: 10px; align-items: center; color: var(--mut); }
    .fx .steps li::before { content: "○"; width: 18px; text-align: center; }
    .fx .steps li.done { color: var(--fg); }
    .fx .steps li.done::before { content: "✓"; color: var(--ok); font-weight: 700; }
    .fx .steps li.now { color: var(--fg); font-weight: 600; }
    .fx .steps li.now::before { content: ""; width: 12px; height: 12px; margin: 0 3px; border-radius: 50%; border: 2px solid var(--acc);
      border-right-color: transparent; animation: xcsspin .7s linear infinite; }
    .fx .prog { font-size: 12px; color: var(--mut); text-align: center; min-height: 1.4em; }
    /* kết quả */
    .fx .ana { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; background: var(--soft); border-radius: 12px; padding: 10px 12px; font-size: 13px; }
    .fx .ana span:nth-child(odd) { color: var(--mut); white-space: nowrap; }
    .fx .card { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .fx .card.busy { opacity: .55; pointer-events: none; }
    .fx .tag { font-size: 12px; font-weight: 700; color: var(--acc); }
    .fx textarea { width: 100%; border: 0; resize: none; background: transparent; color: var(--fg); font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      padding: 0; outline: none; overflow: hidden; }
    .fx .meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--mut); }
    .fx .meta .cnt.over { color: var(--bad); font-weight: 700; }
    .fx .why { font-size: 12px; color: var(--mut); font-style: italic; }
    .fx .warn { font-size: 12px; color: #b26b00; }
    .fx .img { font-size: 12px; color: var(--mut); }
    .fx .tips { font-size: 12px; color: #b26b00; }
    .fx .tips:empty { display: none; }
    .fx .acts { display: flex; gap: 6px; flex-wrap: wrap; }
    .fx .acts button { padding: 5px 10px; font-size: 12px; }
    .fx .ok { color: var(--ok); }
  </style>`;
  const buttons = new Map(); // khung bài -> cụm nút (Tạo bài cho X + Lưu bài)
  function buttonFor(post) {
    const old = buttons.get(post);
    if (old) return old.querySelector(".save");
    const w = document.createElement("div");
    w.className = "w";
    const x = document.createElement("button");
    x.className = "b xb";
    x.title = "Viết bài mới cho X: cùng giọng, cùng hướng ý với bài này, có emoji";
    x.textContent = "✨ Tạo bài viết cho X";
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFbx(post);
    });
    const b = document.createElement("button");
    b.className = "b save";
    b.title = "Lưu chữ của bài này để model học (vào mục Chờ duyệt)";
    b.textContent = "💾 Lưu bài";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDone(b, "Đang lưu...");
      savePost(post, b);
    });
    w.append(x, b);
    layer.appendChild(w);
    buttons.set(post, w);
    return b;
  }
  function setDone(b, text) {
    b.textContent = text;
    b.classList.toggle("done", /✓/.test(text));
    b.classList.toggle("busy", /^Đang/.test(text));
  }
  function place() {
    for (const [post, b] of buttons) {
      if (!post.isConnected) {
        b.remove();
        buttons.delete(post);
        continue;
      }
      const r = post.getBoundingClientRect();
      if (r.bottom < 40 || r.top > innerHeight - 40 || r.height < 80) {
        b.style.display = "none";
        continue;
      }
      b.style.display = "flex";
      const w = b.offsetWidth || 160;
      const h = (b.offsetHeight || 70) + 10;
      const roomRight = innerWidth - r.right > w + 16;
      b.style.left = `${roomRight ? r.right + 10 : r.right - w - 10}px`;
      // gần góc dưới của bài; bài cao hơn màn hình thì nút nằm ở đáy màn hình
      b.style.top = `${Math.max(Math.max(8, r.top), Math.min(r.bottom - h, innerHeight - h))}px`;
      // Bảng "Tạo bài viết cho X" đang mở: nút nào rơi vào vùng bảng thì ẩn, không đè lên bảng.
      if (fx.classList.contains("on")) {
        const p = fx.getBoundingClientRect();
        const bl = parseFloat(b.style.left);
        const bt = parseFloat(b.style.top);
        if (bl < p.right + 8 && bl + w > p.left - 8 && bt < p.bottom + 8 && bt + h > p.top - 8) b.style.display = "none";
      }
      // Cuộn tới đáy bài (đáy bài đã vào màn hình) = đã đọc hết: tự lưu.
      if (autoBottom && !post.dataset.xcsAuto && r.bottom <= innerHeight - 8 && r.bottom > 60) autoSave(post, b.querySelector(".save"));
    }
    placeVideos();
  }
  // ---------- Nút "⬇ Tải video" ở góc trên trái mỗi video (bài trên bảng tin, reel, trang video) ----------
  // Link MP4 do fbhook.js (trong trang) bắt được, theo id video; khung phát video có data-video-id.
  const vids = new Map(); // id -> { hd, sd }
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== "xcs-fb" || m.type !== "videos" || !Array.isArray(m.items)) return;
    for (const v of m.items) if (v && v.id) vids.set(String(v.id), { hd: v.hd || "", sd: v.sd || "" });
  });
  window.postMessage({ source: "xcs-fb-ask" }, location.origin); // xin lại các video đã có trước khi script này chạy
  const vbtns = new Map(); // khung video -> nút
  function findPlayers() {
    for (const el of document.querySelectorAll("[data-video-id]")) {
      if (vbtns.has(el) || inChat(el) || !el.dataset.videoId) continue;
      const b = document.createElement("button");
      b.className = "vd";
      b.textContent = "⬇ Tải video";
      b.title = "Tải video này về máy (MP4, HD nếu có)";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadVideo(el.dataset.videoId, b);
      });
      layer.appendChild(b);
      vbtns.set(el, b);
    }
  }
  function placeVideos() {
    for (const [el, b] of vbtns) {
      if (!el.isConnected) {
        b.remove();
        vbtns.delete(el);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 90 || r.bottom < 40 || r.top > innerHeight - 30) {
        b.style.display = "none";
        continue;
      }
      b.style.display = "block";
      // góc trên phải (góc trái có nút tắt tiếng của reel)
      b.style.left = `${Math.max(4, Math.min(innerWidth, r.right) - (b.offsetWidth || 90) - 8)}px`;
      b.style.top = `${Math.max(60, r.top + 8)}px`; // không đè thanh trên cùng của Facebook
    }
  }
  async function downloadVideo(id, b) {
    let v = vids.get(id);
    if (!v) {
      window.postMessage({ source: "xcs-fb-ask" }, location.origin);
      await new Promise((r) => setTimeout(r, 600));
      v = vids.get(id);
    }
    if (!v) {
      b.textContent = "Chưa có link: bấm phát video rồi thử lại";
      setTimeout(() => (b.textContent = "⬇ Tải video"), 4000);
      return;
    }
    const q = v.hd ? "HD" : "SD";
    const name = (curPage() || (location.pathname.match(/^\/([\w.]+)/) || [])[1] || "facebook").replace(/[^\w.-]/g, "_");
    b.textContent = "Đang tải...";
    try {
      const res = await chrome.runtime.sendMessage({ type: "fb-download-video", url: v.hd || v.sd, filename: `facebook-video/${name}_${id}_${q}.mp4` });
      if (res && res.ok) {
        b.textContent = `✓ Đã tải (${q})`;
        b.classList.add("done");
      } else b.textContent = `Lỗi: ${(res && res.error) || "không tải được"}`;
    } catch (_) {
      b.textContent = "Extension vừa cập nhật: F5 trang này";
    }
  }

  let placing = false;
  function schedulePlace() {
    if (placing) return;
    placing = true;
    requestAnimationFrame(() => {
      placing = false;
      place();
    });
  }
  addEventListener("scroll", schedulePlace, { passive: true, capture: true });
  addEventListener("resize", schedulePlace);

  // ---------- Bảng "Tạo bài viết cho X" ----------
  // Bước 1: chọn mục tiêu → Bước 2: AI phân tích bài và viết (màn hình đang xử lý) → Bước 3: chọn / sửa / viết lại / chép / đăng lên X.
  const GOALS = [
    ["impress", "🔥", "Thêm nhiều lượt hiển thị", "Mở đầu mạnh, đọc lướt là hiểu"],
    ["talk", "💬", "Bắt đầu cuộc trò chuyện", "Kết bằng câu hỏi ai cũng muốn trả lời"],
    ["think", "🤔", "Khiến người ta suy nghĩ", "Một sự thật giản dị mà sâu"],
    ["share", "🔁", "Khiến người ta đăng lại", "Câu đáng trích dẫn, nói thay lòng người đọc"],
    ["stop", "⚡", "Không thể bỏ qua", "Câu đầu bất ngờ, nói thẳng điều đúng"]
  ];
  const GOAL = Object.fromEntries(GOALS.map((g) => [g[0], g]));
  // Khán giả nhắm tới: Việt Nam viết tiếng Việt; các khu vực khác viết tiếng Anh theo văn hoá nơi đó.
  const AUDS = [
    // Windows không hiện cờ emoji (chỉ ra chữ "VN", "US"): dùng hình khác
    ["vn", "🏠", "Việt Nam"],
    ["global", "🌏", "Quốc tế"],
    ["us", "🗽", "Mỹ"],
    ["uk", "💂", "Anh / Úc"],
    ["in", "🪷", "Ấn Độ"],
    ["sea", "🌴", "Đông Nam Á"]
  ];
  const AUD = Object.fromEntries(AUDS.map((a) => [a[0], a]));
  const audNote = (k) => (k === "vn" ? "Viết tiếng Việt." : "Viết tiếng Anh theo cách nói và văn hoá nơi đó, không dịch từng chữ.");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const xLen = (t) => [...String(t)].reduce((n, c) => n + (/\p{Extended_Pictographic}/u.test(c) ? 2 : 1), 0);

  const fx = document.createElement("div");
  fx.className = "fx";
  fx.innerHTML = `<div class="hd"><b>✨ Tạo bài viết cho X</b><button class="ic" data-a="discard" title="Bỏ hết, đóng bảng">✕</button></div>
    <div class="bd"></div><div class="ft"></div>`;
  layer.appendChild(fx);
  const fxBody = fx.querySelector(".bd");
  const fxFoot = fx.querySelector(".ft");
  const S = { post: null, text: "", page: "", url: "", goals: ["think"], audience: "vn", hint: "", reqId: 0, res: null, timer: null, busy: false };
  try {
    chrome.storage.local.get({ fbxGoals: ["think"], fbxAudience: "vn" }, (s) => {
      if (Array.isArray(s.fbxGoals) && s.fbxGoals.length) S.goals = s.fbxGoals.filter((g) => GOAL[g]);
      if (AUD[s.fbxAudience]) S.audience = s.fbxAudience;
    });
  } catch (_) {
    // extension vừa tải lại
  }

  async function openFbx(post) {
    stopWork();
    S.post = post;
    S.res = null;
    S.text = "";
    fx.classList.add("on");
    schedulePlace();
    fxBody.innerHTML = `<div class="proc"><div class="ring"></div><div class="prog">Đang đọc bài...</div></div>`;
    fxFoot.innerHTML = "";
    const text = await readText(post);
    if (S.post !== post) return;
    if (text.length < 20) {
      fxBody.innerHTML = `<div class="err">Không đọc được chữ của bài này (bài chỉ có ảnh / video, hoặc chưa tải xong). Cuộn lại một chút rồi bấm lại.</div>`;
      fxFoot.innerHTML = `<button data-a="discard">Đóng</button>`;
      return;
    }
    const { slug, name } = authorOf(post);
    S.text = text;
    S.page = slug || name || "";
    S.url = postLink(post);
    // Lưu chữ gốc của bài để sau này dạy model (vào Chờ duyệt, trùng thì bỏ qua).
    if (!sent.has(text)) {
      sent.add(text);
      const w = buttons.get(post);
      save(S.page || "khác", text, S.url).then((res) => {
        if (res && w) setDone(w.querySelector(".save"), res.added ? "✓ Đã lưu" : "✓ Đã có");
      });
    }
    viewSetup();
  }

  function viewSetup() {
    S.res = null;
    fxBody.innerHTML = `
      <div><div class="lbl">Bài gốc${S.page ? ` · ${esc(S.page)}` : ""}</div></div>
      <div class="src" data-a="expand">${esc(S.text)}</div>
      <div class="lbl">Bạn muốn bài trên X làm được gì?</div>
      <div class="goals">${GOALS.map(([k, e, t, d]) => `<button class="goal${S.goals.includes(k) ? " on" : ""}" data-goal="${k}">
        <span class="e">${e}</span><span><span class="t">${t}</span><small>${d}</small></span></button>`).join("")}</div>
      <div class="note">Chọn 1 mục tiêu: 3 bài để chọn. Chọn nhiều: mỗi mục tiêu 1–2 bài.</div>
      <div class="lbl">Viết cho khán giả ở đâu?</div>
      <div class="auds">${AUDS.map(([k, e, t]) => `<button class="aud${S.audience === k ? " on" : ""}" data-aud="${k}">${e} ${t}</button>`).join("")}</div>
      <div class="note aud-note">${audNote(S.audience)}</div>
      <input class="hint" placeholder="Ghi chú thêm (không bắt buộc), vd: viết cho người trẻ mới đi làm" value="${esc(S.hint)}">`;
    fxFoot.innerHTML = `<button class="pri" data-a="go"${S.goals.length ? "" : " disabled"}>⚡ Phân tích & viết</button><span class="grow"></span><button data-a="discard">Bỏ</button>`;
  }

  function viewProcessing(label) {
    const t0 = Date.now();
    fxBody.innerHTML = `<div class="proc"><div class="ring"></div>
      <ul class="steps"><li class="done">Đọc bài gốc (${S.text.length} ký tự)</li><li class="now">Phân tích ý chính, giọng văn, người đọc</li>
      <li>${esc(label)}</li><li>Kiểm tra độ dài, emoji, không chép bài gốc</li></ul>
      <div class="prog">Đang bắt đầu...</div></div>`;
    fxFoot.innerHTML = `<span class="note grow" data-el="clock">0 giây</span><button data-a="cancel">Huỷ</button>`;
    const li = fxBody.querySelectorAll(".steps li");
    clearInterval(S.timer);
    S.timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      const c = fxFoot.querySelector('[data-el="clock"]');
      if (c) c.textContent = `${s} giây`;
      // Một lần gọi AI làm cả phân tích lẫn viết: chuyển bước theo thời gian cho dễ theo dõi.
      if (s === 4 && li[1]) {
        li[1].className = "done";
        li[2].className = "now";
      }
    }, 1000);
  }

  function setProgress(text) {
    const p = fxBody.querySelector(".prog");
    if (p) p.textContent = text;
  }

  function stopWork() {
    clearInterval(S.timer);
    S.reqId++;
    S.busy = false;
    try {
      chrome.runtime.sendMessage({ type: "fbx-cancel" });
    } catch (_) {
      // extension vừa tải lại
    }
  }

  function ask(extra) {
    const reqId = ++S.reqId;
    return new Promise((resolve) => {
      if (!chrome.runtime?.id) return resolve({ error: "Extension vừa được tải lại. Bấm F5 trang Facebook." });
      try {
        chrome.runtime.sendMessage(
          { type: "fbx-make", reqId, text: S.text, page: S.page, goals: S.goals, audience: S.audience, hint: S.hint, ...extra },
          (res) => {
            if (reqId !== S.reqId) return resolve(null); // đã huỷ / đã bấm lại
            resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : res || { error: "Không có phản hồi" });
          }
        );
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  }

  async function generate() {
    if (!S.goals.length) return;
    S.busy = true;
    viewProcessing(S.goals.length === 1 ? `Viết 3 bài "${GOAL[S.goals[0]][2]}"` : `Viết bài cho ${S.goals.length} mục tiêu`);
    const res = await ask({});
    if (!res) return;
    clearInterval(S.timer);
    S.busy = false;
    if (res.cancelled) return viewSetup();
    if (res.error) return viewError(res.error);
    const li = fxBody.querySelectorAll(".steps li");
    li.forEach((x) => (x.className = "done"));
    setProgress("Xong");
    S.res = res;
    setTimeout(() => S.res === res && viewResults(), 350);
  }

  function viewError(err) {
    fxBody.innerHTML = `<div class="err">${esc(err)}</div>`;
    fxFoot.innerHTML = `<button class="pri" data-a="go">Thử lại</button><button data-a="setup">Đổi mục tiêu</button><span class="grow"></span><button data-a="discard">Bỏ</button>`;
  }

  function cardHtml(p, i) {
    const g = GOAL[p.goal] || GOALS[2];
    return `<div class="card" data-i="${i}">
      <div class="tag">${g[1]} ${esc(g[2])}</div>
      <textarea rows="3" data-i="${i}">${esc(p.text)}</textarea>
      ${p.copied ? `<div class="warn">⚠ Hơi giống câu chữ bài gốc: sửa thêm hoặc bấm Viết lại</div>` : ""}
      ${p.why ? `<div class="why">${esc(p.why)}</div>` : ""}
      ${p.image ? `<div class="img">🖼 Ảnh nên dùng: ${esc(p.image)}</div>` : ""}
      <div class="tips"></div>
      <div class="meta"><span class="cnt"></span><span class="grow"></span><span class="ok" data-el="done"></span></div>
      <div class="acts"><button data-a="copy" data-i="${i}">📋 Chép</button><button class="dark" data-a="post" data-i="${i}">𝕏 Đăng lên X</button>
        <button data-a="sched" data-i="${i}" title="Mở X, điền bài và tự chọn giờ hẹn kế tiếp">⏰ Hẹn giờ</button>
        <button data-a="redo" data-i="${i}">🔄 Viết lại</button></div></div>`;
  }

  function viewResults() {
    const { analysis: a = {}, posts, provider, model } = S.res;
    const row = (k, v) => (v ? `<span>${k}</span><span>${esc(v)}</span>` : "");
    fxBody.innerHTML = `
      <div class="ana">${row("💡 Ý chính", a.main_idea)}${row("🎭 Giọng", a.tone)}${row("👥 Viết cho", a.audience)}${row("✨ Điểm hay", a.hook)}</div>
      <div class="lbl">${posts.length} bài cho X · sửa trực tiếp trong khung</div>
      ${posts.map(cardHtml).join("")}
      <div class="note">Viết bởi ${esc(provider)}${model ? ` · ${esc(model)}` : ""}</div>`;
    fxBody.querySelectorAll("textarea").forEach(fit);
    fxFoot.innerHTML = `<button data-a="all">🔁 Viết lại tất cả</button><button data-a="setup">🎯 Đổi mục tiêu</button><span class="grow"></span><span class="sched-n"></span><label title="Mỗi bài hẹn giờ cách mọi bài đã hẹn ít nhất bao nhiêu phút">⏰ cách <input type="number" class="gap" min="5" max="1440" step="5" value="60" style="width:56px"> phút</label><button data-a="discard">🗑 Bỏ hết</button>`;
    try {
      chrome.storage.local.get({ schedGapMin: 60, schedList: [] }, ({ schedGapMin, schedList }) => {
        const g = fxFoot.querySelector("input.gap");
        if (g) g.value = schedGapMin;
        const list = schedList.filter((x) => x.at > Date.now());
        const n = fxFoot.querySelector(".sched-n");
        if (n && list.length) {
          n.textContent = `📅 ${list.length} bài đã hẹn`;
          n.title = list
            .map((x) => `${new Date(x.at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}  ${x.text.slice(0, 60)}`)
            .join("\n");
        }
      });
    } catch (_) {
      // extension vừa tải lại
    }
  }

  // Ô chữ tự cao theo nội dung + đếm ký tự theo cách X tính (280).
  function fit(ta) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    const card = ta.closest(".card");
    const n = xLen(ta.value.trim());
    const c = card.querySelector(".cnt");
    c.textContent = `${n}/280${n > 280 ? " · quá dài" : ""}`;
    c.classList.toggle("over", n > 280);
    card.querySelector('[data-a="post"]').disabled = n > 280 || !ta.value.trim();
    card.querySelector('[data-a="sched"]').disabled = n > 280 || !ta.value.trim();
    card.querySelector(".tips").textContent = tipsOf(ta.value);
  }

  // Soát nhanh theo công thức bài chạy tốt: mở đầu mạnh, kết bằng câu hỏi, gọn trên điện thoại.
  function tipsOf(t) {
    const lines = String(t).split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return "";
    const out = [];
    if (!/[?？]/.test(lines[lines.length - 1])) out.push("chưa kết bằng câu hỏi (câu hỏi cuối giúp có nhiều trả lời hơn)");
    if (/^(hôm nay (mình|tôi|tui) muốn chia sẻ|bạn có biết|cuộc sống là)/i.test(lines[0])) out.push("câu mở đầu yếu, nên đổi");
    if (xLen(lines[0]) > 140) out.push("dòng đầu hơi dài, nên tách cho dễ đọc");
    if ((t.match(/#\p{L}/gu) || []).length) out.push("nên bỏ hashtag");
    if ((t.match(/\p{Extended_Pictographic}/gu) || []).length > 3) out.push("hơi nhiều emoji");
    return out.length ? `💡 ${out.join(" · ")}` : "";
  }

  function textOf(i) {
    const ta = fxBody.querySelector(`textarea[data-i="${i}"]`);
    return ta ? ta.value.trim() : "";
  }

  function pick(i, action) {
    const p = S.res.posts[i];
    try {
      chrome.runtime.sendMessage({ type: "fbx-pick", action, page: S.page, url: S.url, source: S.text, goal: p.goal, audience: S.audience, suggested: p.text, text: textOf(i) });
    } catch (_) {
      // extension vừa tải lại: bỏ qua phần ghi lại
    }
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  function flash(i, msg) {
    const d = fxBody.querySelector(`.card[data-i="${i}"] [data-el="done"]`);
    if (!d) return;
    d.textContent = msg;
    setTimeout(() => d.textContent === msg && (d.textContent = ""), 2500);
  }

  async function redo(i) {
    if (S.busy) return;
    const card = fxBody.querySelector(`.card[data-i="${i}"]`);
    const goal = S.res.posts[i].goal;
    S.busy = true;
    card.classList.add("busy");
    card.querySelector('[data-a="redo"]').textContent = "Đang viết lại...";
    const res = await ask({ only: goal, goals: [goal], avoid: S.res.posts.map((p, k) => textOf(k) || p.text) });
    if (!res) return;
    S.busy = false;
    if (res.error || res.cancelled || !res.posts?.length) {
      card.classList.remove("busy");
      card.querySelector('[data-a="redo"]').textContent = "🔄 Viết lại";
      flash(i, res.error ? "Lỗi, thử lại" : "");
      return;
    }
    S.res.posts[i] = { ...res.posts[0], goal };
    const tmp = document.createElement("div");
    tmp.innerHTML = cardHtml(S.res.posts[i], i);
    card.replaceWith(tmp.firstElementChild);
    fit(fxBody.querySelector(`textarea[data-i="${i}"]`));
  }

  function close() {
    stopWork();
    S.post = null;
    S.res = null;
    fx.classList.remove("on");
    schedulePlace();
    fxBody.innerHTML = "";
    fxFoot.innerHTML = "";
  }

  // Gõ trong bảng không được kích hoạt phím tắt của Facebook (j, k, l, ...).
  ["keydown", "keyup", "keypress"].forEach((t) =>
    fx.addEventListener(t, (e) => {
      if (e.key === "Escape" && t === "keydown" && !S.busy) close();
      e.stopPropagation();
    })
  );
  fx.addEventListener("input", (e) => {
    if (e.target.matches("textarea")) fit(e.target);
    if (e.target.matches("input.hint")) S.hint = e.target.value;
    if (e.target.matches("input.gap")) {
      const v = Math.round(Number(e.target.value));
      if (v >= 5 && v <= 1440)
        try {
          chrome.storage.local.set({ schedGapMin: v });
        } catch (_) {
          // extension vừa tải lại
        }
    }
  });
  fx.addEventListener("click", async (e) => {
    const au = e.target.closest("[data-aud]");
    if (au && AUD[au.dataset.aud]) {
      S.audience = au.dataset.aud;
      fx.querySelectorAll("[data-aud]").forEach((x) => x.classList.toggle("on", x === au));
      const note = fx.querySelector(".aud-note");
      if (note) note.textContent = audNote(S.audience);
      try {
        chrome.storage.local.set({ fbxAudience: S.audience });
      } catch (_) {
        // extension vừa tải lại
      }
      return;
    }
    const g = e.target.closest("[data-goal]");
    if (g) {
      const k = g.dataset.goal;
      S.goals = S.goals.includes(k) ? S.goals.filter((x) => x !== k) : [...S.goals, k];
      g.classList.toggle("on", S.goals.includes(k));
      fxFoot.querySelector('[data-a="go"]').disabled = !S.goals.length;
      try {
        chrome.storage.local.set({ fbxGoals: S.goals });
      } catch (_) {
        // extension vừa tải lại
      }
      return;
    }
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.a) {
      case "expand":
        b.classList.add("open");
        break;
      case "go":
      case "all":
        generate();
        break;
      case "setup":
        stopWork();
        viewSetup();
        break;
      case "cancel":
        stopWork();
        viewSetup();
        break;
      case "discard":
        close();
        break;
      case "copy": {
        const t = textOf(i);
        if (t && (await copyText(t))) {
          flash(i, "✓ Đã chép");
          pick(i, "copy");
        }
        break;
      }
      case "post": {
        const t = textOf(i);
        if (!t) break;
        window.open(`https://x.com/intent/post?text=${encodeURIComponent(t)}`, "_blank", "noopener");
        flash(i, "✓ Đã mở X, bấm Đăng ở đó");
        pick(i, "post");
        break;
      }
      case "sched": {
        // Ghi bài chờ hẹn giờ; trang X (content.js) sẽ mở bảng Schedule và tự chọn giờ kế tiếp.
        const t = textOf(i);
        if (!t) break;
        try {
          await chrome.storage.local.set({ schedPending: { text: t, ts: Date.now() } });
        } catch (_) {
          flash(i, "Extension vừa cập nhật: F5 trang này");
          break;
        }
        // Mở trang chủ X (không dùng /intent/post: trang đó tải lại khung soạn sau khi Confirm nên mất giờ hẹn).
        window.open("https://x.com/home", "_blank", "noopener");
        flash(i, "✓ Đã mở X, đang chọn giờ hẹn");
        pick(i, "post");
        break;
      }
      case "redo":
        redo(i);
        break;
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fx.classList.contains("on") && !S.busy) close();
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === "fbx-progress" && m.reqId === S.reqId) setProgress(m.text);
  });

  // Tự lưu một bài (mỗi bài một lần).
  function autoSave(post, btn, page) {
    if (post.dataset.xcsAuto) return;
    post.dataset.xcsAuto = "1";
    setDone(btn, "Đang đọc bài..."); // nút hiện vòng xoay
    readText(post).then((text) => {
      if (text.length < 20) {
        // Chữ có thể chưa tải xong: vẫn xoay, tự thử lại tối đa 3 lần, cách nhau 3 giây.
        const tries = +(post.dataset.xcsTry || 0) + 1;
        post.dataset.xcsTry = tries;
        if (tries < 3 && post.isConnected) {
          setTimeout(() => {
            delete post.dataset.xcsAuto;
            autoSave(post, btn, page);
          }, 3000);
          return;
        }
        return setDone(btn, "💾 Lưu bài"); // thật sự không có chữ (chỉ link/ảnh): trả nút về để bấm tay nếu muốn
      }
      if (sent.has(text)) return setDone(btn, "✓ Đã có");
      sent.add(text);
      const { slug, name } = authorOf(post);
      save(page || slug || name || "khác", text, postLink(post)).then((res) => {
        if (res) return setDone(btn, res.added ? "✓ Đã tự lưu" : "✓ Đã có");
        sent.delete(text);
        delete post.dataset.xcsAuto; // lỗi: lần sau cuộn qua thử lại
        setDone(btn, "Lỗi, bấm để lưu lại");
      });
    });
  }

  function scan() {
    if (!chrome.runtime?.id) return;
    const here = curPage();
    if (here) showBadge();
    findPlayers();
    for (const post of findPosts()) {
      const btn = buttonFor(post);
      // Tự lưu bài của page trong danh sách (trên trang của page hoặc trên bảng tin).
      if (enabled && !post.dataset.xcsAuto) {
        const { slug } = authorOf(post);
        if (here || (slug && pages.includes(slug))) autoSave(post, btn, slug || here);
      }
    }
    place();
  }

  let t = null;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(scan, 800);
  }).observe(document.body, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && (c.fbPages || c.fbSave || c.fbAutoBottom)) load();
  });
  load();
})();
