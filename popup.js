chrome.storage.local.get(
  {
    provider: "gemini", geminiKey: "", geminiModel: "gemini-flash-latest",
    groqKey: "", groqModel: "qwen/qwen3.8-27b", apiKey: "", model: "claude-haiku-5-5", ollamaModel: "gemma3:4b", hybridCloud: "groq"
  },
  (s) => {
    const P = {
      gemini: ["Gemini", s.geminiKey, s.geminiModel],
      groq: ["Groq", s.groqKey, s.groqModel],
      claude: ["Claude", s.apiKey, s.model],
      ollama: ["Ollama", "local", s.ollamaModel],
      hybrid: ["Kết hợp", "local", `Ollama + ${s.hybridCloud === "gemini" ? "Gemini" : "Groq"}`]
    };
    const [name, key, model] = P[s.provider] || P.gemini;
    document.getElementById("st").textContent = key
      ? `Đang dùng AI: ${name} · ${model}`
      : `Chưa có ${name} API key, đang dùng câu mẫu.`;
  }
);
document.getElementById("opt").addEventListener("click", () => chrome.runtime.openOptionsPage());

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
