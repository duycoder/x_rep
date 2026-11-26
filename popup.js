chrome.storage.local.get(
  {
    provider: "gemini", geminiKey: "", geminiModel: "gemini-flash-latest",
    groqKey: "", groqModel: "qwen/qwen3.8-27b", openaiKey: "", openaiModel: "gpt-5-mini", apiKey: "", model: "claude-haiku-5-5", ollamaModel: "gemma3:4b", hybridCloud: "groq"
  },
  (s) => {
    const P = {
      gemini: ["Gemini", s.geminiKey, s.geminiModel],
      groq: ["Groq", s.groqKey, s.groqModel],
      openai: ["ChatGPT", s.openaiKey, s.openaiModel],
      claude: ["Claude", s.apiKey, s.model],
      ollama: ["Ollama", "local", s.ollamaModel],
      hybrid: ["Kết hợp", "local", `Ollama + ${{ gemini: "Gemini", openai: "ChatGPT" }[s.hybridCloud] || "Groq"}`]
    };
    const [name, key, model] = P[s.provider] || P.gemini;
    document.getElementById("st").textContent = key
      ? `Đang dùng AI: ${name} · ${model}`
      : `Chưa có ${name} API key, đang dùng câu mẫu.`;
  }
);
document.getElementById("opt").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Content Studio: trang riêng của extension (khám phá → cơ hội → ý tưởng → bản nháp + phê bình → ảnh → duyệt).
document.getElementById("studio").addEventListener("click", async () => {
  const url = chrome.runtime.getURL("studio.html");
  const [tab] = await chrome.tabs.query({ url });
  if (tab) await chrome.tabs.update(tab.id, { active: true });
  else await chrome.tabs.create({ url });
  window.close();
});
chrome.storage.local.get({ studioPosts: [] }, ({ studioPosts }) => {
  const n = studioPosts.filter((p) => p.status === "PendingReview").length;
  if (n) document.getElementById("pend").textContent = `· ${n} bài chờ duyệt`;
});

// Mở bảng gợi ý bài đăng trên tab X đang mở; tab hiện tại không phải X thì mở X.
document.getElementById("post").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    if (!tab) throw new Error();
    await chrome.tabs.sendMessage(tab.id, { type: "xcs-open-post" });
    window.close();
  } catch (_) {
    const btn = document.getElementById("post");
    btn.textContent = "Mở x.com rồi bấm lại (hoặc Alt+P trên X)";
  }
});

// Bên nào đang nghỉ vì hết lượt thì báo luôn.
chrome.storage.local.get({ cooldowns: {} }, ({ cooldowns }) => {
  const now = Date.now();
  const lines = Object.entries(cooldowns)
    .filter(([, c]) => c.until > now)
    .map(([k, c]) => {
      const d = new Date(c.until);
      const t = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      return `⏸ ${k.split(":")[0] === "groq" ? "Groq" : k.split(":")[0] === "gemini" ? "Gemini" : k} (${k.split(":").slice(1).join(":")}): ${c.reason}, gọi lại lúc ${t}`;
    });
  if (lines.length) {
    const el = document.createElement("div");
    el.className = "st";
    el.style.color = "#b45309";
    el.textContent = lines.join("\n");
    el.style.whiteSpace = "pre-line";
    document.getElementById("st").after(el);
  }
});

// Bảng số bài đăng / trả lời theo ngày giờ Việt Nam (content.js đếm mỗi lần bạn bấm Đăng/Trả lời trên X).
const vnDay = (ts = Date.now()) => new Date(ts + 7 * 3600e3).toISOString().slice(0, 10);
chrome.storage.local.get({ activity: {} }, ({ activity }) => {
  const day = (i) => activity[vnDay(Date.now() - i * 86400e3)] || {};
  const sum = (k) => Array.from({ length: 7 }, (_, i) => day(i)[k] || 0).reduce((a, b) => a + b, 0);
  const row = (label, f, w) => `<tr><td>${label}</td><td class="today">${f(day(0))}</td><td>${f(day(1))}</td><td>${w}</td></tr>`;
  document.getElementById("stats").innerHTML = `<table><tr><th>Giờ VN</th><th>Hôm nay</th><th>Hôm qua</th><th>7 ngày</th></tr>
    ${row("📝 Bài đăng", (d) => d.post || 0, sum("post"))}
    ${row("💬 Trả lời", (d) => d.reply || 0, sum("reply"))}
    ${row("➕ Follow", (d) => d.follow || 0, sum("follow"))}
    ${row("➖ Bỏ follow", (d) => d.unfollow || 0, sum("unfollow"))}
    ${row("🤖 Dùng gợi ý", (d) => (d.post_ai || 0) + (d.reply_ai || 0), sum("post_ai") + sum("reply_ai"))}</table>`;
});
