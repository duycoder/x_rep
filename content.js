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
    return {
      text: textEl ? textEl.innerText : "",
      author: nameEl ? nameEl.innerText.split("\n").slice(0, 2).join(" ") : "",
      hasMedia,
      images: images.slice(0, 4)
    };
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
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        width: 380px; max-width: calc(100vw - 32px); max-height: 75vh; overflow: auto;
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
        max-height: 70px; overflow: hidden; white-space: pre-wrap; }
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
    </style>
    <div class="panel" role="dialog" aria-label="Gợi ý bình luận">
      <header><b>Gợi ý bình luận</b><button class="x" title="Đóng (Esc)">✕</button></header>
      <div class="body">
        <div class="preview"></div>
        <div class="hint">
          <input placeholder="Thêm ý (vd: hỏi về giá, giọng hài hơn)..." />
          <button class="act ghost regen">Tạo lại</button>
        </div>
        <div class="content"></div>
        <div class="foot">Bạn tự đọc lại, tự bấm Trả lời và Thích trên X. · <a class="opt">Cài đặt</a></div>
      </div>
    </div>`;

  const panel = shadow.querySelector(".panel");
  const preview = shadow.querySelector(".preview");
  const contentBox = shadow.querySelector(".content");
  const hintInput = shadow.querySelector(".hint input");
  shadow.querySelector(".x").addEventListener("click", closePanel);
  shadow.querySelector(".regen").addEventListener("click", () => currentArticle && loadSuggestions(currentArticle));
  hintInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && currentArticle) loadSuggestions(currentArticle);
  });
  shadow.querySelector(".opt").addEventListener("click", () => chrome.runtime.sendMessage({ type: "xcs-open-options" }));

  function closePanel() {
    panel.classList.remove("open");
    currentArticle = null;
  }

  function openPanel(article) {
    currentArticle = article;
    const info = getTweetInfo(article);
    preview.textContent = (info.author ? info.author + "\n" : "") + (info.text || "(bài không có chữ)");
    hintInput.value = "";
    panel.classList.add("open");
    loadSuggestions(article);
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
    contentBox.innerHTML = '<div class="ai"><div class="loading">Đang nghĩ câu bình luận...</div></div><div class="past"></div>';
    loadPast(article, info);
    // Dòng trạng thái: đang hỏi bên nào + đã chờ bao lâu.
    const reqId = String(Date.now()) + Math.random();
    currentReq = reqId;
    loadingText = "Đang nghĩ câu bình luận";
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
      { type: "xcs-suggest", ...info, reqId, extraHint: hintInput.value.trim() },
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
  function makeItem(article, text) {
    const item = document.createElement("div");
    item.className = "item";
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.rows = 2;
    ta.addEventListener("keydown", (e) => e.stopPropagation());
    const row = document.createElement("div");
    row.className = "row";
    const use = document.createElement("button");
    use.className = "act primary";
    use.textContent = "Điền vào trả lời";
    use.addEventListener("click", () => {
      rememberPending(article, ta.value);
      fillReply(article, ta.value);
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
    item.append(ta, row);
    return item;
  }

  function renderSuggestions(res, article) {
    const box = contentBox.querySelector(".ai") || contentBox;
    box.innerHTML = "";
    const src = document.createElement("div");
    src.className = "src";
    src.textContent = res.source === "ai" ? `Gợi ý bởi ${res.provider || "AI"}${res.model ? " · " + res.model : ""}${res.imageCount ? ` · đã xem ${res.imageCount} ảnh` : ""}${res.route ? ` · ${res.route}` : ""}` : "Câu mẫu có sẵn";
    box.appendChild(src);
    if (res.context) {
      const c = document.createElement("div");
      c.className = "ctx";
      c.textContent = `AI hiểu bài: ${res.context}`;
      c.title = "Nếu AI hiểu sai, gõ thêm ý vào ô phía trên rồi bấm Tạo lại";
      box.appendChild(c);
    }
    if (res.note) {
      const n = document.createElement("div");
      n.className = "note";
      n.textContent = res.note;
      box.appendChild(n);
    }
    res.suggestions.forEach((s) => box.appendChild(makeItem(article, s)));
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
    const info = getTweetInfo(article);
    pending = { post: (info.text || "").slice(0, 600), author: info.author, suggested, at: Date.now() };
  }
  function savePosted() {
    if (!pending || Date.now() - pending.at > 30 * 60 * 1000) return;
    const composer = findComposer();
    const target = composer && (composer.querySelector('[contenteditable="true"]') || composer);
    const reply = target ? target.innerText.replace(/\s+/g, " ").trim() : "";
    if (!reply) return;
    chrome.runtime.sendMessage({ type: "xcs-save-example", ...pending, reply });
    pending = null;
  }
  // Bắt cú bấm nút Reply/Post của X (chạy trước X để còn đọc được chữ trong ô).
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest && e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')) savePosted();
    },
    true
  );
  // Ctrl+Enter / Cmd+Enter trong ô trả lời cũng là đăng.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.closest?.('[data-testid="tweetTextarea_0"]')) savePosted();
    },
    true
  );

  async function fillReply(article, text) {
    if (!text.trim()) return;
    let composer = null;
    // Trang chi tiết bài có sẵn ô trả lời ngay dưới, còn trên dòng thời gian phải bấm nút Trả lời.
    const replyBtn = article.querySelector('[data-testid="reply"]');
    if (replyBtn) {
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
