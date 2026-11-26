// Chạy trong trang X (world MAIN) để đếm đúng số bài đăng / trả lời:
// nghe các lệnh CreateTweet / CreateNoteTweet mà chính X gửi lên máy chủ, chỉ tính lần đăng thành công,
// rồi báo cho content.js qua window.postMessage. Không đọc, không gửi gì ra ngoài.
(() => {
  if (window.__xcsHook) return;
  window.__xcsHook = true;
  const RE = /\/graphql\/[^/]+\/(CreateTweet|CreateNoteTweet)(\?|$)/;
  // Các lệnh X tải bài về (thông báo, chuỗi trả lời, dòng thời gian): đọc ra id -> chữ, bài cha, người đăng,
  // để biết một bình luận đang trả lời bài nào (vd bình luận dưới bài của chính bạn) và bài đó viết gì.
  const READ_RE =
    /\/graphql\/[^/]+\/(TweetDetail|NotificationsTimeline|HomeTimeline|HomeLatestTimeline|UserTweets|UserTweetsAndReplies|SearchTimeline|TweetResultByRestId|TweetResultsByRestIds)(\?|$)|\/2\/notifications\//;
  // Lệnh follow / bỏ follow mà X gửi khi bạn bấm nút Follow (ở trang cá nhân, thẻ hover, "Gợi ý theo dõi"...).
  const FOLLOW_RE = /\/i\/api\/1\.1\/friendships\/(create|destroy)\.json(\?|$)/;
  function reportFollow(url, responseText) {
    try {
      const m = String(url).match(FOLLOW_RE);
      const u = JSON.parse(responseText || "{}");
      if (!m || !u || (!u.id_str && !u.screen_name)) return; // X từ chối (quá giới hạn follow...)
      window.postMessage(
        { source: "xcs-hook", type: "follow", action: m[1] === "create" ? "follow" : "unfollow", user: u.screen_name || u.id_str },
        location.origin
      );
    } catch (_) {
      // dữ liệu lạ: bỏ qua
    }
  }
  // Hẹn giờ đăng: bài vừa hẹn (CreateScheduledTweet) và danh sách bài đang hẹn (FetchScheduledTweets),
  // để extension biết giờ hẹn muộn nhất và tự chọn giờ kế tiếp.
  const SCHED_RE = /\/graphql\/[^/]+\/(CreateScheduledTweet|FetchScheduledTweets)(\?|$)/;
  const toMs = (x) => {
    const n = Number(x);
    return n > 0 ? (n < 1e12 ? n * 1000 : n) : 0;
  };
  function reportSched(url, bodyText, responseText) {
    try {
      const m = String(url).match(SCHED_RE);
      const res = JSON.parse(responseText || "{}");
      if (!m || (res.errors && res.errors.length)) return;
      if (m[1] === "CreateScheduledTweet") {
        let v = null;
        try {
          v = JSON.parse(bodyText || "{}").variables || {};
        } catch (_) {
          v = {};
        }
        const at = toMs(v && v.execute_at);
        const text = String((v && v.post_tweet_request && v.post_tweet_request.status) || "").slice(0, 300);
        if (at) window.postMessage({ source: "xcs-hook", type: "sched", action: "created", items: [{ at, text }] }, location.origin);
        return;
      }
      // Danh sách đầy đủ bài đang hẹn (mỗi bài: scheduling_info.execute_at + tweet_create_request.status).
      const items = [];
      const walk = (o, d) => {
        if (!o || typeof o !== "object" || d > 40) return;
        if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1));
        const si = o.scheduling_info;
        if (si && si.execute_at != null) {
          const at = toMs(si.execute_at);
          const text = String((o.tweet_create_request && o.tweet_create_request.status) || "").slice(0, 300);
          if (at) items.push({ at, text });
          return;
        }
        if (o.execute_at != null && toMs(o.execute_at)) items.push({ at: toMs(o.execute_at), text: "" });
        for (const k in o) walk(o[k], d + 1);
      };
      walk(res.data, 0);
      window.postMessage({ source: "xcs-hook", type: "sched", action: "list", items }, location.origin);
    } catch (_) {
      // dữ liệu lạ: bỏ qua
    }
  }
  const clean = (t) => String(t || "").replace(/^(@\w+\s+)+/, "").replace(/\s*https:\/\/t\.co\/\w+\s*$/, "").trim().slice(0, 1000);
  function harvest(text) {
    try {
      const j = JSON.parse(text || "{}");
      const out = new Map();
      const g = j.globalObjects; // kiểu REST cũ của trang Thông báo
      if (g && g.tweets) {
        const users = {};
        for (const [id, u] of Object.entries(g.users || {})) users[id] = u.screen_name || "";
        for (const t of Object.values(g.tweets))
          out.set(t.id_str, { id: t.id_str, text: clean(t.full_text || t.text), replyTo: t.in_reply_to_status_id_str || "", user: users[t.user_id_str] || "" });
      }
      const walk = (o, depth) => {
        if (!o || typeof o !== "object" || depth > 80 || out.size > 600) return;
        if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
        if (o.rest_id && o.legacy && o.legacy.full_text != null) {
          const u = (o.core && o.core.user_results && o.core.user_results.result) || {};
          const note = o.note_tweet && o.note_tweet.note_tweet_results && o.note_tweet.note_tweet_results.result;
          out.set(String(o.rest_id), {
            id: String(o.rest_id),
            text: clean((note && note.text) || o.legacy.full_text),
            replyTo: o.legacy.in_reply_to_status_id_str || "",
            user: (u.core && u.core.screen_name) || (u.legacy && u.legacy.screen_name) || ""
          });
        }
        for (const k in o) walk(o[k], depth + 1);
      };
      walk(j.data, 0);
      if (out.size) window.postMessage({ source: "xcs-hook", type: "tweets", items: [...out.values()] }, location.origin);
    } catch (_) {
      // dữ liệu lạ: bỏ qua
    }
  }

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
      const replyTo = kind === "reply" ? String(v.reply.in_reply_to_tweet_id) : "";
      let r = ((d.create_tweet || d.notetweet_create || {}).tweet_results || {}).result || {};
      if (r.tweet) r = r.tweet; // TweetWithVisibilityResults
      const lg = r.legacy || {};
      const id = String(r.rest_id || lg.id_str || "");
      const media = ((lg.extended_entities || lg.entities || {}).media || []).map((m) => m.media_url_https).filter(Boolean).slice(0, 4);
      window.postMessage(
        { source: "xcs-hook", type: "tweet-created", kind, replyTo, id, media, text: String((v && v.tweet_text) || "").slice(0, 4000) },
        location.origin
      );
    } catch (_) {
      // dữ liệu lạ: bỏ qua, không ảnh hưởng X
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && (input.url || String(input));
    if (url && FOLLOW_RE.test(url)) {
      const fp = origFetch.apply(this, arguments);
      fp.then((r) => (r.ok ? r.clone().text() : null)).then((t) => t && reportFollow(url, t)).catch(() => {});
      return fp;
    }
    if (url && SCHED_RE.test(url)) {
      const sb =
        init && init.body != null
          ? Promise.resolve(typeof init.body === "string" ? init.body : null)
          : input && typeof input.clone === "function"
            ? input.clone().text().catch(() => null)
            : Promise.resolve(null);
      const sp = origFetch.apply(this, arguments);
      Promise.all([sb, sp.then((r) => (r.ok ? r.clone().text() : null))])
        .then(([b, t]) => t && reportSched(url, b, t))
        .catch(() => {});
      return sp;
    }
    if (url && READ_RE.test(url)) {
      const rp = origFetch.apply(this, arguments);
      rp.then((r) => (r.ok ? r.clone().text() : null)).then((t) => t && harvest(t)).catch(() => {});
      return rp;
    }
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
    if (this.__xcsUrl && FOLLOW_RE.test(String(this.__xcsUrl))) {
      const fu = String(this.__xcsUrl);
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        if (this.responseType === "" || this.responseType === "text") reportFollow(fu, this.responseText);
        else if (this.responseType === "json") reportFollow(fu, JSON.stringify(this.response));
      });
    }
    if (this.__xcsUrl && SCHED_RE.test(String(this.__xcsUrl))) {
      const su = String(this.__xcsUrl);
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        if (this.responseType === "" || this.responseType === "text") reportSched(su, body, this.responseText);
        else if (this.responseType === "json") reportSched(su, body, JSON.stringify(this.response));
      });
    }
    if (this.__xcsUrl && READ_RE.test(String(this.__xcsUrl))) {
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300) return;
        if (this.responseType === "" || this.responseType === "text") harvest(this.responseText);
        else if (this.responseType === "json") harvest(JSON.stringify(this.response));
      });
    }
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
