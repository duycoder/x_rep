const DEFAULTS = {
  provider: "gemini",
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  groqKey: "",
  groqModel: "qwen/qwen3.8-27b",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  hybridCloud: "groq",
  apiKey: "",
  model: "claude-haiku-5-5",
  language: "auto",
  tone: "thân thiện, tự nhiên",
  count: 4,
  persona: "",
  styleSamples: "",
  emojiTail: "off",
  emojiFixed: "😂",
  emojiRepeat: 3,
  sendImages: true,
  ollamaFallback: true,
  ollamaImages: false,
  capitalize: true,
  learn: true,
  // Lựa chọn cho bảng Gợi ý bài đăng (mỗi dòng một cái): mặc định tick hết các mục có sẵn trong postopts.js.
  ...Object.fromEntries(self.XCSPostOpts.GROUPS.map((g) => [g.store, g.presets.join(String.fromCharCode(10))]))
};
const FIELDS = Object.keys(DEFAULTS);

// Đổ danh sách model Groq vào ô chọn. list: [{ id, vision }]
function fillGroqSelect(list, current) {
  const sel = document.getElementById("groqModel");
  sel.innerHTML = "";
  const items = [...list];
  // Model đã lưu mà không có trong danh sách (chưa tải, hoặc Groq đã bỏ) thì vẫn hiện để không mất lựa chọn.
  if (current && !items.some((m) => m.id === current)) items.unshift({ id: current, missing: list.length > 0 });
  items.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.missing
      ? `${m.id} (không còn trong danh sách, nên chọn model khác)`
      : m.vision === undefined
      ? m.id
      : `${m.vision ? "📷 " : ""}${m.id} · ${m.vision ? "xem được ảnh" : "chỉ đọc chữ"}`;
    sel.appendChild(o);
  });
  sel.value = current || (items[0] && items[0].id) || "";
}

// ---------- Danh sách tick cho Gợi ý bài đăng ----------
// Lưu 2 thứ: postX = các mục đã tick (mỗi dòng một mục, bảng trên X đọc cái này), postPool.postX = mọi mục để hiện checkbox.
const OLD_PRESETS = {
  postPersonas: ["dân văn phòng 28 tuổi, mê cà phê, hay đùa, xưng tui", "dev backend, thích AI và đầu tư dài hạn, viết gọn",
    "sinh viên năm 3, hay than deadline, xưng mình", "freelancer làm online, hay chia sẻ kinh nghiệm kiếm tiền"],
  postTopics: ["ăn vặt", "cà phê", "đi làm, deadline", "crypto", "kiếm tiền online", "du lịch", "tập gym, sức khoẻ", "bóng đá", "thời tiết", "kẹt xe"],
  postPlaces: ["Sài Gòn", "Quận 3, Sài Gòn", "Đà Nẵng", "Đà Lạt"],
  postTimes: ["sáng đầu tuần", "trưa nghỉ ở công ty", "cuối tháng hết tiền", "ngày lễ sắp tới"]
};
// Mục có sẵn của mỗi nhóm = bộ mới (postopts.js) + vài mục của bản cũ (hiện ra để tick, không tick sẵn).
const POST_PRESETS = Object.fromEntries(
  self.XCSPostOpts.GROUPS.map((g) => [g.store, [...g.presets, ...(OLD_PRESETS[g.store] || []).filter((v) => !g.presets.includes(v))]])
);
// Vẽ các danh sách tick theo postopts.js.
document.getElementById("postGroups").innerHTML = self.XCSPostOpts.GROUPS.map(
  (g) => `<label>${g.label}<small>${g.multi ? "Trên X chọn được nhiều cái. " : ""}Không chọn: ${g.none.replace(/^.*?= /, "")}.</small></label><div class="checklist" id="${g.store}"></div>`
).join("");
const lines = (v) => [...new Set(String(v || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];

function renderChecklist(box, all, checked) {
  box.innerHTML = '<div class="items"></div><div class="add"><input placeholder="Thêm lựa chọn..." /><button type="button" class="sec">＋ Thêm</button></div>';
  const items = box.querySelector(".items");
  const addItem = (v, on) => {
    if ([...items.querySelectorAll("input")].some((i) => i.value === v)) return;
    const lb = document.createElement("label");
    lb.className = "it";
    lb.title = v;
    lb.innerHTML = '<input type="checkbox" /><span></span><button type="button" class="del" title="Xoá">×</button>';
    const cb = lb.querySelector("input");
    cb.value = v;
    cb.checked = on;
    lb.querySelector("span").textContent = v;
    lb.querySelector(".del").addEventListener("click", (e) => {
      e.preventDefault();
      lb.remove();
      saveChecklists();
    });
    items.appendChild(lb);
  };
  all.forEach((v) => addItem(v, checked.includes(v)));
  const inp = box.querySelector(".add input");
  const add = () => {
    const v = inp.value.trim();
    if (!v) return;
    addItem(v, true); // mục tự thêm thì tick luôn
    saveChecklists();
    inp.value = "";
    inp.focus();
  };
  box.querySelector(".add button").addEventListener("click", add);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });
}

// Tick / thêm / xoá là lưu luôn, không cần bấm Lưu.
function saveChecklists() {
  chrome.storage.local.get({ postPool: {} }, ({ postPool }) => {
    const data = { postPool };
    document.querySelectorAll(".checklist").forEach((el) => {
      const { all, checked } = readChecklist(el);
      data[el.id] = checked.join("\n");
      postPool[el.id] = all;
    });
    chrome.storage.local.set(data);
  });
}
document.addEventListener("change", (e) => e.target.closest(".checklist .items") && saveChecklists());

function readChecklist(box) {
  const all = [...box.querySelectorAll(".items input")];
  return { all: all.map((i) => i.value), checked: all.filter((i) => i.checked).map((i) => i.value) };
}

chrome.storage.local.get({ ...DEFAULTS, groqModelList: [], ollamaModelList: [], postPool: {} }, (s) => {
  FIELDS.forEach((k) => {
    const el = document.getElementById(k);
    if (el && el.classList.contains("checklist")) {
      const checked = lines(s[k]);
      // Lần đầu: mục có sẵn + mục đã tick trước đây (từ bản cũ gõ tay).
      const base = s.postPool[k] || POST_PRESETS[k];
      const pool = [...base, ...checked.filter((v) => !base.includes(v))];
      return renderChecklist(el, pool, checked);
    }
    if (k === "groqModel") return fillGroqSelect(s.groqModelList, s.groqModel);
    if (k === "ollamaModel") return fillOllamaSelect(s.ollamaModelList, s.ollamaModel);
    if (el && el.type === "checkbox") el.checked = !!s[k];
    else if (el) el.value = s[k];
  });
  showProvider();
  // Có key mà chưa có danh sách thì tự tải luôn.
  if (s.provider === "groq" && s.groqKey && !s.groqModelList.length) loadGroqModels();
  // Luôn dò Ollama (nhanh, lỗi cũng không sao) để biết có dùng làm dự phòng được không.
  loadOllamaModels();
});

function showProvider() {
  const p = document.getElementById("provider").value;
  const cloud = document.getElementById("hybridCloud").value;
  const hy = p === "hybrid";
  document.getElementById("hybrid-box").hidden = !hy;
  document.getElementById("gemini-box").hidden = !(p === "gemini" || (hy && cloud === "gemini"));
  document.getElementById("groq-box").hidden = !(p === "groq" || (hy && cloud === "groq"));
  document.getElementById("ollama-box").hidden = !(p === "ollama" || hy);
  document.getElementById("claude-box").hidden = p !== "claude";
}

// Hỏi Groq xem key này dùng được những model chat nào.
document.getElementById("loadGroq").addEventListener("click", () => loadGroqModels());

async function loadGroqModels() {
  const st = document.getElementById("groqStatus");
  const key = document.getElementById("groqKey").value.trim();
  if (!key) { st.textContent = "Dán Groq API key trước đã."; return; }
  st.textContent = "Đang tải…";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    // Chỉ giữ model chat: nhận chữ, trả chữ. Bỏ model kiểm duyệt (guard), giọng nói, tiếng Ả Rập (allam).
    const skip = /guard|whisper|tts|embed|playai|orpheus|compound|allam/i;
    const has = (arr, v) => !Array.isArray(arr) || arr.includes(v);
    const models = (data.data || []).filter(
      (m) => m.active !== false && !skip.test(m.id) && has(m.input_modalities, "text") && has(m.output_modalities, "text")
    );
    const vision = models.filter((m) => (m.input_modalities || []).includes("image")).map((m) => m.id);
    const ids = models.map((m) => m.id).sort((a, b) => vision.includes(b) - vision.includes(a) || a.localeCompare(b));
    const list = ids.map((id) => ({ id, vision: vision.includes(id) }));
    chrome.storage.local.set({ groqVisionModels: vision, groqModelList: list });

    const sel = document.getElementById("groqModel");
    let pick = sel.value;
    if (!ids.includes(pick)) pick = vision[0] || ids.find((i) => /70b|120b/.test(i)) || ids[0];
    fillGroqSelect(list, pick);
    st.textContent =
      `Có ${ids.length} model chat` + (vision.length ? `, ${vision.length} model xem được ảnh` : "") + `. Chọn xong bấm Lưu.`;
  } catch (e) {
    st.textContent = `Lỗi: ${e.message}`;
  }
}
document.getElementById("provider").addEventListener("change", showProvider);

document.getElementById("save").addEventListener("click", () => {
  const data = { postPool: {} };
  FIELDS.forEach((k) => {
    const el = document.getElementById(k);
    if (el.classList.contains("checklist")) {
      const { all, checked } = readChecklist(el);
      data[k] = checked.join("\n");
      data.postPool[k] = all;
      return;
    }
    if (el.type === "checkbox") { data[k] = el.checked; return; }
    const v = el.value;
    data[k] = k === "count" || k === "emojiRepeat" ? Number(v) : ["apiKey", "geminiKey", "groqKey", "groqModel", "ollamaUrl"].includes(k) ? v.trim() : v;
  });
  chrome.storage.local.set(data, () => {
    const st = document.getElementById("status");
    st.textContent = "Đã lưu ✓";
    setTimeout(() => (st.textContent = ""), 1800);
  });
});

// ---------- Bình luận đã lưu ----------
let histClearArmed = false;
function renderHistory() {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    document.getElementById("histCount").textContent = `(${history.length} câu)`;
    const box = document.getElementById("histList");
    box.innerHTML = "";
    if (!history.length) {
      box.innerHTML = '<p class="note" style="margin-left:0">Chưa có. Bấm Điền rồi bấm Reply trên X là extension tự lưu.</p>';
      return;
    }
    history
      .map((h, i) => ({ h, i }))
      .reverse()
      .slice(0, 100)
      .forEach(({ h, i }) => {
        const d = document.createElement("div");
        d.className = "hist";
        const p = document.createElement("div");
        p.className = "p";
        p.textContent = `${h.author ? h.author + ": " : ""}${h.post || "(bài không có chữ)"}`;
        const r = document.createElement("div");
        r.className = "r";
        r.textContent = `→ ${h.reply}`;
        if (h.edited) {
          const t = document.createElement("span");
          t.className = "tag";
          t.textContent = "bạn đã sửa";
          r.appendChild(t);
        }
        const del = document.createElement("button");
        del.className = "sec";
        del.textContent = "Xoá";
        del.addEventListener("click", () => {
          chrome.storage.local.get({ history: [] }, ({ history: cur }) => {
            cur.splice(i, 1);
            chrome.storage.local.set({ history: cur }, renderHistory);
          });
        });
        d.append(p, r, del);
        box.appendChild(d);
      });
  });
}
document.getElementById("histClear").addEventListener("click", (e) => {
  // Bấm 2 lần để xoá, tránh lỡ tay.
  if (!histClearArmed) {
    histClearArmed = true;
    e.target.textContent = "Bấm lần nữa để xoá hết";
    setTimeout(() => {
      histClearArmed = false;
      e.target.textContent = "Xoá hết";
    }, 3000);
    return;
  }
  chrome.storage.local.set({ history: [] }, renderHistory);
  histClearArmed = false;
  e.target.textContent = "Xoá hết";
});
chrome.storage.onChanged.addListener((ch) => ch.history && renderHistory());
renderHistory();

// ---------- Ollama ----------
function fillOllamaSelect(list, current) {
  const sel = document.getElementById("ollamaModel");
  sel.innerHTML = "";
  const items = [...(list || [])];
  if (current && !items.some((m) => m.id === current)) items.unshift({ id: current, missing: items.length > 0 });
  items.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.missing
      ? `${m.id} (chưa tải, chạy: ollama pull ${m.id})`
      : `${m.vision ? "📷 " : ""}${m.id}${m.size ? ` · ${m.size}` : ""}`;
    sel.appendChild(o);
  });
  sel.value = current || (items[0] && items[0].id) || "";
}

async function loadOllamaModels() {
  const st = document.getElementById("ollamaStatus");
  const base = document.getElementById("ollamaUrl").value.trim().replace(/\/+$/, "") || "http://localhost:11434";
  st.textContent = "Đang kết nối…";
  try {
    const res = await fetch(`${base}/api/tags`);
    if (res.status === 403) throw new Error("Ollama chặn extension. Đặt OLLAMA_ORIGINS=chrome-extension://* rồi khởi động lại Ollama");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = [];
    for (const m of data.models || []) {
      if (/embed/i.test(m.name)) continue;
      let vision = false;
      try {
        const r = await fetch(`${base}/api/show`, { method: "POST", body: JSON.stringify({ model: m.name }) });
        const info = await r.json();
        vision = (info.capabilities || []).includes("vision");
      } catch (_) {
        // không đọc được thông tin thì coi như chỉ đọc chữ
      }
      list.push({ id: m.name, vision, size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : "" });
    }
    const sel = document.getElementById("ollamaModel");
    let pick = sel.value;
    if (!list.some((m) => m.id === pick)) pick = list[0] ? list[0].id : pick;
    fillOllamaSelect(list, pick);
    chrome.storage.local.set({ ollamaModelList: list });
    st.textContent = list.length
      ? `Kết nối được ✓ Có ${list.length} model. Chọn xong bấm Lưu.`
      : "Kết nối được ✓ nhưng chưa có model nào. Chạy: ollama pull gemma3:4b";
  } catch (e) {
    st.textContent = /Failed to fetch/i.test(e.message)
      ? "Không kết nối được. Ollama đã chạy chưa? (biểu tượng con lạc đà dưới khay hệ thống)"
      : `Lỗi: ${e.message}`;
  }
}
document.getElementById("loadOllama").addEventListener("click", () => loadOllamaModels());
document.getElementById("provider").addEventListener(
  "change",
  (e) => (e.target.value === "ollama" || e.target.value === "hybrid") && loadOllamaModels()
);
document.getElementById("hybridCloud").addEventListener("change", showProvider);

// Lưu luôn model nào xem được ảnh để background biết có gửi ảnh hay không.
document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.get({ ollamaModelList: [] }, ({ ollamaModelList }) => {
    const id = document.getElementById("ollamaModel").value;
    const m = ollamaModelList.find((x) => x.id === id);
    chrome.storage.local.set({ ollamaVision: !!(m && m.vision) });
  });
});

// Đếm số câu mẫu đang có.
function updateStyleInfo() {
  const n = document.getElementById("styleSamples").value.split(/\r?\n/).filter((l) => l.trim().length > 1).length;
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    const total = n + history.length;
    document.getElementById("styleInfo").textContent =
      `${n} câu dán + ${history.length} câu đã đăng = ${total} câu. ` +
      (total < 3 ? "Cần ít nhất 3 câu để bắt đầu học giọng." : total < 15 ? "Thêm tới 15 câu trở lên sẽ giống hơn." : "Đủ để bắt giọng ✓");
  });
}
document.getElementById("styleSamples").addEventListener("input", updateStyleInfo);
setTimeout(updateStyleInfo, 300);

// Ô emoji cố định chỉ hiện khi chọn "Luôn dùng 1 emoji cố định".
function showEmoji() {
  const mode = document.getElementById("emojiTail").value;
  document.getElementById("emojiFixed").hidden = mode !== "fixed";
  document.getElementById("emojiRepeat").hidden = mode === "off";
}
document.getElementById("emojiTail").addEventListener("change", showEmoji);
setTimeout(showEmoji, 200);

// Gửi 1 yêu cầu rất nhỏ tới Groq để xem giới hạn còn lại và lỗi thật (nếu có).
document.getElementById("testGroq").addEventListener("click", async () => {
  const out = document.getElementById("groqTest");
  const key = document.getElementById("groqKey").value.trim();
  const model = document.getElementById("groqModel").value;
  if (!key) { out.textContent = "Dán Groq API key trước đã."; return; }
  out.textContent = `Đang hỏi Groq với model ${model}…`;
  try {
    const t0 = Date.now();
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Trả lời đúng 1 chữ: ok" }], max_tokens: 20 })
    });
    const data = await res.json().catch(() => ({}));
    const h = (n) => res.headers.get(n) || "?";
    const lines = [
      `Kết quả: HTTP ${res.status} ${res.ok ? "✓ gọi được" : "✗ lỗi"} (${Date.now() - t0} ms)`,
      `Model: ${model}`,
      `Lượt gọi trong NGÀY: còn ${h("x-ratelimit-remaining-requests")} / ${h("x-ratelimit-limit-requests")} (hồi lại sau ${h("x-ratelimit-reset-requests")})`,
      `Token mỗi PHÚT: còn ${h("x-ratelimit-remaining-tokens")} / ${h("x-ratelimit-limit-tokens")} (hồi lại sau ${h("x-ratelimit-reset-tokens")})`,
      `Mỗi lần bấm Gợi ý tốn khoảng 3.300 token (cả phần chữ và phần dành cho câu trả lời), có ảnh thì nhiều hơn.`
    ];
    if (res.headers.get("retry-after")) lines.push(`Groq bảo chờ: ${res.headers.get("retry-after")} giây`);
    if (!res.ok) lines.push(`Lỗi Groq báo: ${data.error?.message || "(không có nội dung)"}`);
    out.textContent = lines.join("\n");
  } catch (e) {
    out.textContent = `Không gọi được Groq: ${e.message}`;
  }
});

// ---------- Xuất dữ liệu huấn luyện (xcs-train.jsonl) ----------
document.getElementById("exportTrain").addEventListener("click", () => {
  const st = document.getElementById("exportStatus");
  chrome.runtime.sendMessage({ type: "xcs-train-data" }, (res) => {
    const lines = (res && res.lines) || [];
    if (!lines.length) { st.textContent = "Chưa có câu nào để xuất."; return; }
    const blob = new Blob([lines.join("\n") + "\n"], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xcs-train.jsonl";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    st.textContent =
      `Đã xuất ${lines.length} câu.` +
      (lines.length < 200 ? ` Hơi ít, nên đợi tới khoảng 200 câu thì model mới học ra giọng.` : " Đủ để huấn luyện.");
  });
});
