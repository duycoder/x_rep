// Chạy trong trang X (world MAIN) để đếm đúng số bài đăng / trả lời:
// nghe các lệnh CreateTweet / CreateNoteTweet mà chính X gửi lên máy chủ, chỉ tính lần đăng thành công,
// rồi báo cho content.js qua window.postMessage. Không đọc, không gửi gì ra ngoài.
(() => {
  if (window.__xcsHook) return;
  window.__xcsHook = true;
  const RE = /\/graphql\/[^/]+\/(CreateTweet|CreateNoteTweet)(\?|$)/;

  function report(bodyText, responseText) {
    try {
      const body = typeof bodyText === "string" ? JSON.parse(bodyText) : null;
      const v = body && (body.variables || {});
      const res = JSON.parse(responseText || "{}");
      if (res.errors && res.errors.length) return; // X từ chối (trùng bài, quá giới hạn...)
      const d = res.data || {};
      if (!d.create_tweet && !d.notetweet_create) return;
      const kind = v && v.reply && v.reply.in_reply_to_tweet_id ? "reply" : "post";
      console.debug("[X Gợi Ý] đếm:", kind, (v && v.tweet_text) || "");
      window.postMessage({ source: "xcs-hook", type: "tweet-created", kind, text: String((v && v.tweet_text) || "").slice(0, 500) }, location.origin);
    } catch (_) {
      // dữ liệu lạ: bỏ qua, không ảnh hưởng X
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && (input.url || String(input));
    if (!url || !RE.test(url)) return origFetch.apply(this, arguments);
    // Nội dung gửi đi có thể nằm trong init.body hoặc trong chính Request: đọc bản sao trước khi X gửi.
    const bodyP =
      init && init.body != null
        ? Promise.resolve(typeof init.body === "string" ? init.body : null)
        : input && typeof input.clone === "function"
          ? input.clone().text().catch(() => null)
          : Promise.resolve(null);
    const p = origFetch.apply(this, arguments);
    Promise.all([bodyP, p.then((r) => (r.ok ? r.clone().text() : null))])
      .then(([body, t]) => t && report(body, t))
      .catch(() => {});
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xcsUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__xcsUrl && RE.test(String(this.__xcsUrl))) {
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        if (this.responseType === "" || this.responseType === "text") report(body, this.responseText);
        else if (this.responseType === "json") report(body, JSON.stringify(this.response));
      });
    }
    return origSend.apply(this, arguments);
  };
})();
