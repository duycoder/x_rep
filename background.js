// Service worker: gọi AI (Gemini hoặc Claude) để tạo gợi ý bình luận.
// Không tự đăng, không tự thích. Chỉ trả về chữ cho người dùng chọn.
importScripts("templates.js", "studio-core.js"); // studio-core: Content Studio (ngữ cảnh → chủ đề → bài → ảnh)

const API_URL = "https://api.anthropic.com/v1/messages";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULTS = {
  provider: "gemini", // gemini | groq | claude
  groqKey: "",
  groqModel: "qwen/qwen3.8-27b",
  groqVisionModels: [],
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  ollamaVision: false,
  ollamaModelList: [], // có model = đã cài Ollama
  ollamaFallback: true,
  ollamaImages: false, // gửi ảnh cho Ollama (rất chậm khi chạy bằng CPU) // các bên trên mạng lỗi thì dùng Ollama
  hybridCloud: "groq", // chế độ Kết hợp: bài lạ hỏi groq hoặc gemini // điền khi bấm "Tải danh sách model" trong Cài đặt
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  apiKey: "", // Claude API key
  model: "claude-haiku-5-5",
  language: "auto", // auto | vi | en
  tone: "thân thiện, tự nhiên",
  count: 4,
  persona: "",
  styleSamples: "",
  emojiTail: "off", // off | auto | fixed
  emojiFixed: "😂",
  emojiRepeat: 3,
  sendImages: true,
  capitalize: true,
  learn: true
};

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

// ---------- Học từ bình luận đã đăng ----------
const HISTORY_MAX = 300;

// Chữ chung chung, không nói lên chủ đề bài (bỏ khi so độ giống).
const STOP = new Set(
  ("mình tui tôi tao mày bạn anh em chị cô chú bác ông bà ae mn mọi người các những cả nhà cùng mời " +
    "nha nhé nè á ạ ơi hen nhỉ nhể ha à ừ ờ thôi luôn rồi đã đang sẽ vẫn cũng còn mới vừa lại nữa " +
    "là thì mà và với của cho có không ko k được bị này kia đó đấy ấy nào gì sao vậy thế như rất quá " +
    "lắm hơn nhất thật ghê nay hôm sáng trưa chiều tối ngày một hai ba vài nhiều ít đi đến về ra vào " +
    "lên xuống để khi nếu vì nên hay hoặc chưa bao giờ ai the a an and or of to in on for is are you i my we it this that")
    .split(" ")
);

// Từ khoá của một câu: âm tiết có nghĩa + cụm 2 âm tiết liền nhau (vd "bún mắm", "cà phê").
function words(s) {
  const syl = String(s || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+|@\w+|#/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out = new Set();
  for (let i = 0; i < syl.length; i++) {
    const a = syl[i];
    const b = syl[i + 1];
    if (!STOP.has(a) && a.length >= 2) out.add(a);
    if (b && !STOP.has(a) && !STOP.has(b)) out.add(a + " " + b);
  }
  return out;
}

// Chọn k ví dụ hợp nhất: giống chủ đề bài hiện tại, ưu tiên câu bạn đã tự sửa và câu gần đây.
function pickExamples(history, postText, k = 6) {
  if (!history.length) return [];
  const cur = words(postText || "");
  const n = history.length;
  const scored = history.map((h, i) => {
    const w = words(h.post);
    let inter = 0;
    w.forEach((x) => cur.has(x) && inter++);
    const sim = inter / (Math.sqrt(w.size * cur.size) || 1);
    return { h, score: sim + (h.edited ? 0.15 : 0) + (0.1 * i) / n };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, k - 2).map((x) => x.h);
  // Luôn kèm vài câu mới nhất để giữ đúng giọng hiện tại.
  for (let i = n - 1; i >= 0 && picked.length < k; i--) if (!picked.includes(history[i])) picked.push(history[i]);
  return picked;
}

// Câu bạn từng đăng cho các bài giống bài đang xem (để dùng lại ngay, không cần AI).
function similarPast(history, postText, k = 3) {
  const cur = words(postText);
  if (!cur.size) return [];
  const seen = new Set();
  return history
    .map((h, i) => {
      const w = words(h.post);
      let inter = 0;
      w.forEach((x) => cur.has(x) && inter++);
      return { h, i, sim: inter / (Math.sqrt(w.size * cur.size) || 1) };
    })
    .filter((x) => x.sim >= 0.25) // chỉ hiện khi bài thật sự giống
    .sort((a, b) => b.sim - a.sim || b.i - a.i)
    .filter((x) => {
      const key = x.h.reply.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, k)
    .map((x) => ({ post: x.h.post, reply: x.h.reply, ts: x.h.ts, sim: Math.round(x.sim * 100) }));
}

// ---------- Giọng văn của bạn ----------
// Lấy câu thật của bạn: câu mẫu bạn dán trong Cài đặt + câu bạn đã đăng qua extension.
function styleSamples(settings, history) {
  const pasted = String(settings.styleSamples || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);
  const posted = (history || []).map((h) => h.reply).filter(Boolean);
  const all = [...pasted, ...posted.reverse()];
  const seen = new Set();
  return all.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const FILLERS = ["á", "nè", "nha", "ghê", "luôn", "thiệt", "trời", "haha", "hihi", "kkk", "vậy", "ha", "hen", "ạ", "ơi", "ủa", "ê", "z", "j", "k", "ko", "hong", "hông", "dữ", "quá", "xỉu", "nhỉ", "nhể", "đó", "nữa", "chứ", "ta", "mà", "lun", "nhé", "vl", "vcl", "thế"];

// Rút thói quen gõ từ các câu thật.
function styleProfile(samples) {
  if (samples.length < 3) return null;
  const n = samples.length;
  const wc = samples.map((s) => s.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
  const firstLetter = samples.map((s) => (s.match(/\p{L}/u) || [""])[0]).filter(Boolean);
  const lowerStart = firstLetter.filter((c) => c === c.toLowerCase() && c !== c.toUpperCase()).length / (firstLetter.length || 1);
  const endDot = samples.filter((s) => /[.]$/.test(s.trim())).length / n;
  const endBang = samples.filter((s) => /[!]$/.test(s.trim())).length / n;
  const emoji = samples.filter((s) => EMOJI_RE.test(s)).length / n;
  const noAccent = samples.filter((s) => /[a-z]{3,}/i.test(s) && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(s)).length / n;
  const counts = {};
  samples.forEach((s) =>
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .forEach((w) => FILLERS.includes(w) && (counts[w] = (counts[w] || 0) + 1))
  );
  const fillers = Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
  return {
    n,
    medianWords: wc[Math.floor(n / 2)],
    maxWords: wc[Math.floor(n * 0.9)] || wc[n - 1],
    lowerStart,
    endDot,
    endBang,
    emoji,
    noAccent,
    fillers
  };
}

function styleBlock(samples, p, postText) {
  if (!p) return "";
  const pct = (x) => `${Math.round(x * 100)}%`;
  const rules = [
    `- Độ dài: thường khoảng ${p.medianWords} từ, hiếm khi quá ${p.maxWords} từ.`,
    p.lowerStart > 0.6 ? `- Hay viết thường chữ đầu câu (${pct(p.lowerStart)} số câu).` : p.lowerStart < 0.2 ? "- Viết hoa chữ đầu câu." : "",
    p.endDot < 0.15 ? "- Gần như KHÔNG BAO GIỜ đặt dấu chấm cuối câu." : "",
    p.endBang < 0.05 ? "- Không dùng dấu chấm than cuối câu." : "",
    p.emoji < 0.1 ? "- Gần như không dùng emoji." : `- Dùng emoji ở khoảng ${pct(p.emoji)} số câu.`,
    p.noAccent > 0.5 ? "- Hay gõ tiếng Việt KHÔNG DẤU." : "",
    p.fillers.length ? `- Từ đệm hay dùng: ${p.fillers.join(", ")} (chỉ dùng khi hợp, đừng câu nào cũng nhét vào).` : ""
  ].filter(Boolean);
  // Tối đa 20 câu: ưu tiên câu có chữ trùng chủ đề bài đang xem, phần còn lại lấy ngẫu nhiên.
  const cur = words(postText);
  const overlap = (s) => {
    let n = 0;
    words(s).forEach((w) => cur.has(w) && n++);
    return n;
  };
  const related = samples.filter((s) => overlap(s) > 0).sort((a, b) => overlap(b) - overlap(a)).slice(0, 6);
  const rest = samples.filter((s) => !related.includes(s));
  if (postText != null) rest.sort(() => Math.random() - 0.5); // null = giữ thứ tự cố định (Ollama dùng lại bộ nhớ đệm)
  const pick = [...related, ...rest].slice(0, 12);
  return [
    "",
    `CÁCH GÕ CỦA NGƯỜI DÙNG (rút từ ${p.n} câu họ thật sự viết). Áp dụng ở BƯỚC 3: bắt chước cách gõ (độ dài, viết hoa, dấu câu, emoji, từ đệm, kiểu câu).`,
    "KHÔNG bắt chước nội dung hay mức độ đùa giỡn của các câu này: nói gì, đùa nhiều hay ít, xưng hô ra sao là do bối cảnh bài ở BƯỚC 1 quyết định.",
    ...rules,
    "Một số câu thật của họ (chỉ để bắt giọng, KHÔNG chép lại, không lấy lại nội dung):",
    ...pick.map((s) => `• ${s}`),
    "Mục tiêu: câu của bạn đúng bối cảnh bài, và nếu trộn vào danh sách trên thì không ai nhận ra không phải người dùng viết.",
    ""
  ].join("\n");
}

// Chỉnh câu AI trả về cho khớp thói quen gõ (AI hay quên).
function applyStyle(s, p) {
  if (!p) return s;
  let out = s.trim();
  // Bỏ emoji trước, rồi mới xét dấu cuối câu (vd "đẹp quá! 😍" -> "đẹp quá!" -> "đẹp quá").
  if (p.emoji < 0.05) out = out.replace(/\s*\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, "").trim();
  if (p.endBang < 0.05) out = out.replace(/!+$/, "").trim();
  if (p.endDot < 0.15) out = out.replace(/(?<!\.)\.$/, "");
  return out || s;
}

// Gắn emoji lặp lại ở cuối câu, vd "đẹp xỉu 😍😍😍".
const ONE_EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*/u;
function addEmojiTail(text, i, emojis, settings) {
  if (!settings.emojiTail || settings.emojiTail === "off") return text;
  const raw = settings.emojiTail === "fixed" ? settings.emojiFixed : (emojis || [])[i];
  const m = String(raw || "").match(ONE_EMOJI_RE);
  if (!m) return text; // AI không chọn (vd bài buồn) thì để nguyên
  const n = Math.min(5, Math.max(1, Number(settings.emojiRepeat) || 3));
  // Bỏ emoji AI lỡ để sẵn ở cuối câu, tránh bị thành 4-5 cái.
  const base = text.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]+$/u, "").trim();
  return `${base} ${m[0].repeat(n)}`;
}

function examplesBlock(examples) {
  if (!examples || !examples.length) return "";
  const lines = examples.map(
    (e) => `- Bài: "${e.post.replace(/\s+/g, " ").slice(0, 140)}"\n  Người dùng đã đăng: "${e.reply}"`
  );
  return [
    "",
    "BÌNH LUẬN THẬT người dùng này đã đăng trước đây (đây là giọng của họ). Bắt chước độ dài, cách xưng hô, từ ngữ, cách dùng emoji và dấu câu của họ. Không chép lại nguyên câu, không nhắc tới các bài cũ.",
    ...lines,
    ""
  ].join("\n");
}

async function saveExample(msg) {
  const reply = String(msg.reply || "").trim();
  if (!reply) return;
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  history.push({
    post: String(msg.post || "").slice(0, 600),
    author: msg.author || "",
    reply: reply.slice(0, 500),
    suggested: msg.suggested || "",
    edited: reply.replace(/\s+/g, " ") !== String(msg.suggested || "").replace(/\s+/g, " ").trim(),
    ts: Date.now()
  });
  await chrome.storage.local.set({ history: history.slice(-HISTORY_MAX) });
}

// ---------- Viết bài đăng mới (theo chủ đề, thời điểm, con người, địa điểm) ----------
const POST_HISTORY_MAX = 100;
const POST_SCHEMA = {
  type: "object",
  properties: {
    context: { type: "string" },
    suggestions: { type: "array", items: { type: "string" }, minItems: 3 },
    images: { type: "array", items: { type: "string" } }
  },
  required: ["context", "suggestions", "images"]
};

async function savePost(msg) {
  const text = String(msg.text || "").trim();
  if (!text) return;
  const { postHistory = [] } = await chrome.storage.local.get({ postHistory: [] });
  postHistory.push({ text: text.slice(0, 1000), topic: String(msg.topic || "").slice(0, 200), ts: Date.now() });
  await chrome.storage.local.set({ postHistory: postHistory.slice(-POST_HISTORY_MAX) });
}

// Model nhỏ hay tự thêm hashtag, hoặc tách hashtag thành "bài" riêng: bỏ đi (trừ khi bạn xin hashtag).
// Trả về { posts, images } giữ đúng cặp bài ↔ mô tả ảnh sau khi lọc.
function cleanPosts(list, images, extraHint) {
  const wantTags = /hashtag|#/i.test(extraHint || "");
  const posts = [];
  const imgs = [];
  list.forEach((raw, i) => {
    let s = String(raw).trim();
    if (!wantTags) s = s.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "");
    s = s.replace(/(^|\s)@[\p{L}\p{N}_]+/gu, "$1").replace(/[ \t]{2,}/g, " ").trim(); // model nhỏ hay bịa @tài khoản
    if (s.replace(/[\s\p{P}\p{Extended_Pictographic}]/gu, "").length < 15) return;
    posts.push(s);
    imgs.push(String((images || [])[i] || "").trim());
  });
  return { posts, images: imgs };
}

// ---------- Ảnh minh hoạ cho bài đăng ----------
// "ai": vẽ bằng Pollinations (miễn phí, không key). "search": tìm ảnh giấy phép Creative Commons trên Openverse.
// "fetch": tải ảnh Openverse cỡ lớn. Trang X không cho tải ảnh từ chỗ khác nên nền tải giúp rồi trả về data URL.
const OPENVERSE = "https://api.openverse.org/v1/images/";
async function toDataUrl(res) {
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("Không phải ảnh");
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
async function getImage(url, ms = 90000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) {
    const e = new Error(res.status === 429 || res.status === 402 ? "Dịch vụ ảnh đang giới hạn lượt, thử lại sau ít phút" : `Lỗi tải ảnh (HTTP ${res.status})`);
    e.status = res.status;
    e.retryAfter = Number(res.headers.get("retry-after")) || 0;
    throw e;
  }
  return toDataUrl(res);
}
async function handleImage(msg) {
  if (msg.kind === "ai") {
    const prompt = String(msg.prompt || "").slice(0, 600) + (msg.styled ? "" : ", high quality photo, natural light, no text, no watermark");
    const W = Math.min(1600, Number(msg.width) || 1024);
    const H = Math.min(1600, Number(msg.height) || 1024);
    // Bản miễn phí chỉ cho ~1 ảnh mỗi 30 giây: quá nhanh thì trả 402/429 kèm Retry-After, chờ đúng chừng đó rồi gọi lại.
    // Quá tải (5xx) thì thử lại vài lần, mỗi lần một seed khác.
    let last;
    for (let i = 0; i < 4; i++) {
      const seed = Math.floor(Math.random() * 1e6);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${W}&height=${H}&nologo=true&seed=${seed}`;
      try {
        return { dataUrl: await getImage(url), credit: "" };
      } catch (e) {
        last = e;
        if ((e.status === 402 || e.status === 429) && e.retryAfter > 0 && e.retryAfter <= 90) {
          await new Promise((r) => setTimeout(r, (e.retryAfter + 1) * 1000));
          continue;
        }
        if (!(e.status >= 500)) break;
        await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
      }
    }
    throw new Error(last.status >= 500 ? "Máy vẽ miễn phí đang quá tải, thử lại sau ít phút hoặc dùng Ảnh chữ / Tìm ảnh" : last.message);
  }
  if (msg.kind === "search") {
    const q = encodeURIComponent(String(msg.q || "").slice(0, 120));
    // Ưu tiên ảnh không cần ghi nguồn (CC0, public domain); ít quá thì lấy thêm ảnh CC BY (phải ghi tác giả).
    const find = async (lic) => {
      const r = await fetch(`${OPENVERSE}?q=${q}&page_size=12&license=${lic}&mature=false`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`Openverse lỗi HTTP ${r.status}`);
      return (await r.json()).results || [];
    };
    // Trộn: ảnh không cần ghi nguồn xếp trước, rồi ảnh CC BY (thường là ảnh Flickr hiện đại, hợp chủ đề hơn).
    const [free, by] = await Promise.all([find("cc0,pdm"), find("by,by-sa").catch(() => [])]);
    const results = [...free.slice(0, 5), ...by.slice(0, 4), ...free.slice(5), ...by.slice(4)];
    const items = results.slice(0, 9).map((x) => ({
      id: x.id,
      thumb: `${OPENVERSE}${x.id}/thumb/`,
      credit: /^(cc0|pdm)$/.test(x.license) ? "" : `📷 ${x.creator || "không rõ tác giả"} (CC ${String(x.license).toUpperCase()})`
    }));
    // Tải sẵn ảnh nhỏ để hiện trên bảng.
    await Promise.all(items.map(async (it) => (it.thumbData = await getImage(it.thumb, 20000).catch(() => ""))));
    return { items: items.filter((it) => it.thumbData) };
  }
  if (msg.kind === "fetch") {
    if (!/^[0-9a-f-]{36}$/.test(String(msg.id))) throw new Error("Ảnh không hợp lệ");
    return { dataUrl: await getImage(`${OPENVERSE}${msg.id}/thumb/?full_size=true&compressed=false`, 30000) };
  }
  throw new Error("Loại ảnh không rõ");
}

// Kiểu bài chỉ có chữ mà vẫn kéo tương tác. Tên phải khớp danh sách có sẵn trong Cài đặt (options.js POST_PRESETS.postStyles).
// Kiểu tự thêm không có trong đây thì gửi nguyên tên cho AI.
const POST_STYLES = {
  "Life quote": "1–2 câu ngắn, súc tích, đọc xong muốn lưu lại hoặc chụp màn hình. Có hình ảnh cụ thể hoặc một nghịch lý, không sáo rỗng kiểu \"hãy luôn mỉm cười\". Không gắn tên tác giả, không bịa câu nói của người nổi tiếng.",
  "Triết lý": "Một suy ngẫm về đời, công việc, tiền, các mối quan hệ, rút ra từ trải nghiệm của chính con người tôi. Có một ý bất ngờ ở cuối, đọc xong người ta gật gù \"đúng thật\".",
  "Lời khuyên": "Một lời khuyên cụ thể, làm được ngay, nói như người từng trải (vd \"điều tui ước biết sớm hơn\"). Không bịa thành tích lớn, không giọng dạy đời.",
  "Câu hỏi tương tác": "Một câu hỏi trả lời được trong vài chữ hoặc chọn A/B, khơi người đọc kể chuyện của họ. Không hỏi chung chung \"mọi người nghĩ sao\". Có thể mở bằng câu trả lời của chính mình.",
  "Kể chuyện ngắn": "Một khoảnh khắc nhỏ đời thường, có cái kết bất ngờ hoặc buồn cười ở câu cuối.",
  "Hài hước": "Đùa về chuyện ai cũng từng gặp, đọc là thấy mình trong đó. Không đùa trên nỗi đau, ngoại hình hay nhóm người nào.",
  "Quan điểm (hot take)": "Một quan điểm hơi ngược số đông về chuyện đời thường/công việc/tiền, đủ để người ta muốn vào cãi, nhưng không xúc phạm ai, không chính trị, không tôn giáo.",
  "Danh sách 3 điều": "Mở bằng một dòng tiêu đề (vd \"3 thứ đáng tiền nhất tui mua năm nay:\"), rồi 3 ý, mỗi ý một dòng ngắn. Tổng vẫn dưới 270 ký tự."
};

// Mô tả thời điểm hiện tại cho AI: thứ, ngày, giờ, buổi.
function nowContext(d = new Date()) {
  const h = d.getHours();
  const buoi = h < 5 ? "khuya/rạng sáng" : h < 11 ? "buổi sáng" : h < 13 ? "buổi trưa" : h < 18 ? "buổi chiều" : h < 22 ? "buổi tối" : "khuya";
  const thu = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][d.getDay()];
  const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${thu}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}, ${hm} (${buoi})`;
}

function buildPostPrompt({ persona, style, topic, place, when, extraHint, settings }) {
  const styleName = String(style || "").trim();
  const styleRule = styleName
    ? `KIỂU BÀI: "${styleName}". ${POST_STYLES[styleName] || "Viết đúng kiểu này."} Cả ${settings.count} bài đều theo kiểu này, khác nhau về ý và góc nhìn, không bài nào mở đầu giống bài khác.`
    : `Viết đúng ${settings.count} bài, mỗi bài một kiểu khác nhau, chọn trong: life quote; suy ngẫm/triết lý; lời khuyên từ trải nghiệm; câu hỏi tương tác dễ trả lời; kể một khoảnh khắc nhỏ có cái kết; đùa nhẹ. Không bài nào mở đầu giống bài khác.`;
  const lang =
    settings.language === "en" ? "Write in English." : "Viết bằng tiếng Việt (trừ khi chủ đề hoặc yêu cầu thêm bảo viết tiếng Anh).";
  const p = settings.profile;
  const pct = (x) => `${Math.round(x * 100)}%`;
  // Thói quen gõ học từ bình luận của bạn. Bỏ quy tắc độ dài vì bài đăng dài hơn bình luận.
  const habit = p
    ? [
        "",
        `CÁCH GÕ CỦA NGƯỜI DÙNG (rút từ ${p.n} câu họ thật sự viết): bắt chước cách gõ, KHÔNG chép nội dung.`,
        p.lowerStart > 0.6 ? `- Hay viết thường chữ đầu câu (${pct(p.lowerStart)} số câu).` : "",
        p.endDot < 0.15 ? "- Hầu như không đặt dấu chấm cuối câu." : "",
        p.emoji < 0.1 ? "- Gần như không dùng emoji." : `- Dùng emoji ở khoảng ${pct(p.emoji)} số câu.`,
        p.noAccent > 0.5 ? "- Hay gõ tiếng Việt KHÔNG DẤU." : "",
        p.fillers.length ? `- Từ đệm hay dùng: ${p.fillers.join(", ")} (dùng khi hợp, đừng nhồi).` : "",
        "Vài câu thật của họ:",
        ...(settings.samples || []).slice(0, 10).map((s) => `• ${s}`)
      ]
    : [];
  const past = (settings.pastPosts || []).slice(-5);
  const system = [
    "Bạn giúp một người dùng X (Twitter) viết BÀI ĐĂNG MỚI của chính họ (không phải bình luận). Họ sẽ tự đọc, sửa và tự bấm đăng.",
    "",
    "MỤC TIÊU: bài chỉ có chữ nhưng khiến người đọc muốn thả tim, trả lời hoặc lưu lại. Dòng đầu phải bắt mắt (người lướt nhanh vẫn dừng lại), nói đúng điều nhiều người thấy mình trong đó. Được hỏi người đọc, nhưng không xin like/follow/share.",
    "",
    "DỮ LIỆU ĐẦU VÀO: con người họ (họ là ai), kiểu bài, chủ đề, địa điểm, thời điểm/dịp. Con người và chủ đề luôn phải khớp. Địa điểm và thời điểm: kể chuyện, đùa, hỏi đời thường thì nên dùng; life quote, triết lý, lời khuyên thì chỉ dùng khi tự nhiên, không cần nhắc.",
    "- Con người: viết đúng vai, góc nhìn, nghề, sở thích, cách xưng hô của họ. Không bịa thêm thông tin cá nhân quan trọng (nghề, gia đình, thu nhập) mà họ không cho.",
    "- Thời điểm: hợp với giờ và ngày (sáng thì không chúc ngủ ngon, thứ Hai khác cuối tuần). Nếu ngày gần một dịp lễ quen thuộc ở nơi họ sống và hợp chủ đề thì có thể nhắc, không thì thôi.",
    "- Địa điểm: dùng chi tiết đời thường hợp với nơi đó (món ăn, đường phố, nhịp sống, khí hậu theo mùa). KHÔNG bịa tin tức, sự kiện, số liệu, thời tiết cụ thể của hôm nay.",
    "- Chủ đề: bám vào đó. Chủ đề trống thì tự chọn chuyện đời thường hợp với con người + thời điểm + địa điểm.",
    "",
    styleRule,
    "",
    "CÁCH VIẾT:",
    "- Mỗi bài DƯỚI 270 ký tự (giới hạn của X). Độ dài khác nhau: có bài 1 câu, có bài 2–4 câu.",
    "- Bài đăng CHỈ CÓ CHỮ, không kèm ảnh/video: KHÔNG viết như đang chỉ vào ảnh (\"cái này\", \"nhìn nè\", \"view này\", \"món này\", \"áo này\"), không giả vờ đang xem video/ảnh của ai. Người đọc chỉ thấy chữ, nên mọi thứ phải nói rõ bằng chữ (\"tô cơm tấm sườn bì chả ở đầu hẻm\" chứ không phải \"món này\").",
    "- Nghe như người thật tự gõ trên điện thoại, có chi tiết cụ thể (tên món, góc phố, con số nhỏ đời thường). Câu dán được cho bất kỳ ai ở bất kỳ đâu là câu hỏng.",
    "- Tránh sáo rỗng: \"Chào buổi sáng cả nhà\", \"Chúc mọi người một ngày tốt lành\", \"tràn đầy năng lượng\", \"Cuộc sống là...\", \"Hãy luôn...\".",
    "- Không tag @tài khoản nào. Không hashtag (trừ khi yêu cầu thêm bảo có), không link, không xin like/follow/share, không quảng cáo.",
    "- Tối đa 1–2 emoji mỗi bài, nhiều bài không cần emoji.",
    "- Không viết về chính trị, tôn giáo, chuyện gây thù ghét. Không nói xấu người hay thương hiệu cụ thể.",
    lang,
    `Giọng văn: ${settings.tone}.`,
    ...habit,
    past.length ? "\nBÀI NGƯỜI DÙNG ĐÃ ĐĂNG TRƯỚC ĐÂY (bắt giọng, KHÔNG lặp lại ý):\n" + past.map((x) => `• ${x.text.replace(/\s+/g, " ")}`).join("\n") : "",
    "",
    'Chỉ trả về JSON đúng dạng {"context": "...", "suggestions": ["...", "..."]}, không thêm chữ nào khác.',
    'Trong đó "context" là MỘT câu ngắn tiếng Việt nói góc viết bạn chọn, ví dụ: "Chiều thứ Ba ở Sài Gòn, dân văn phòng thèm ăn vặt, viết kiểu kể chuyện + hỏi follower".',
    'Thêm trường "images": mảng cùng độ dài với "suggestions", mỗi phần tử là ẢNH MINH HOẠ cho bài tương ứng, viết bằng TIẾNG ANH theo dạng "từ khoá | mô tả": từ khoá là 2–3 từ tên vật/cảnh chính để tìm ảnh (danh từ, không có a/the), mô tả 8–15 từ là một cảnh cụ thể có không khí, không có chữ trong ảnh, không có người nổi tiếng.',
    'Ví dụ: "iced coffee | iced milk coffee on a wooden table, rainy Saigon street outside, warm light", "office desk night | messy office desk at night with laptop glow and cold coffee".',
    "Bài vẫn phải tự đứng được khi không có ảnh (ảnh chỉ là minh hoạ)."
  ]
    .filter((x) => x !== "")
    .join("\n");
  const user = [
    // Con người chọn trên bảng; không chọn thì lấy ô "Bạn là ai?" trong Cài đặt.
    `Con người tôi: ${String(persona || settings.persona || "").trim() || "(không nói, viết như một người bình thường)"}`,
    `Kiểu bài: ${styleName || "(trộn nhiều kiểu)"}`,
    `Chủ đề: ${String(topic || "").trim() || "(để bạn chọn)"}`,
    `Địa điểm: ${String(place || "").trim() || "(không nói, đừng nhắc địa điểm cụ thể)"}`,
    `Thời điểm hiện tại: ${nowContext()}`,
    when && String(when).trim() ? `Thời điểm/dịp muốn viết: ${String(when).trim()}` : "",
    extraHint ? `Yêu cầu thêm: ${extraHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

function buildPrompt(args) {
  if (args.mode === "raw") return { system: args.system, user: args.user }; // Content Studio tự viết prompt
  if (args.mode === "post") return buildPostPrompt(args);
  const { text, author, hasMedia, settings, extraHint, imageCount = 0 } = args;
  const langRule =
    settings.language === "vi"
      ? "Viết bằng tiếng Việt."
      : settings.language === "en"
      ? "Write in English."
      : "Viết cùng ngôn ngữ với bài đăng (bài tiếng Việt thì trả lời tiếng Việt, bài tiếng Anh thì tiếng Anh).";

  const system = [
    "Bạn giúp một người dùng X (Twitter) nghĩ ra bình luận trả lời bài đăng.",
    "Người dùng sẽ tự đọc, sửa và tự bấm đăng. Bạn chỉ gợi ý.",
    "",
    "LÀM THEO 3 BƯỚC:",
    "BƯỚC 1, hiểu bối cảnh (quan trọng nhất): bài nói về chuyện gì; người đăng đang vui, buồn, mệt, tự hào, bức xúc hay chỉ chia sẻ; họ muốn gì (khoe, hỏi ý kiến, than thở, kể chuyện, quảng bá, chúc); người đăng là cá nhân hay thương hiệu/KOL; người bình luận là người lạ nên thân thiện nhưng không suồng sã quá mức.",
    "BƯỚC 2, chọn cách phản ứng hợp bối cảnh: bài vui thì đùa được; bài khoe thì khen đúng thứ họ khoe; bài hỏi thì trả lời hoặc góp ý thật; bài than thì đồng cảm trước, đùa sau (hoặc không đùa).",
    "Bài buồn, nghiêm túc (mất người thân, bệnh, tai nạn, thiên tai, chuyện riêng khó khăn): KHÔNG đùa, không từ lóng lầy, không emoji vui, chỉ hỏi thăm, động viên ngắn gọn, chân thành. Điều này đứng trên mọi quy tắc về giọng văn.",
    "BƯỚC 3, viết bằng cách gõ của người dùng (xem phần CÁCH GÕ bên dưới nếu có).",
    `Viết đúng ${settings.count} gợi ý, mỗi câu một kiểu phản ứng khác nhau (ví dụ: bắt một chi tiết cụ thể trong bài, hỏi lại một điều tò mò thật, kể nhanh trải nghiệm của mình, đùa nhẹ). Không gợi ý nào được mở đầu giống gợi ý khác.`,
    "",
    "CÁCH VIẾT CHUNG: câu phải nghe như một người thật đang lướt X gõ vội bằng điện thoại, không phải văn viết. (Nếu có phần CÁCH GÕ CỦA NGƯỜI DÙNG bên dưới thì theo phần đó khi hai bên khác nhau.)",
    "- Bám vào MỘT chi tiết cụ thể trong bài (món ăn, con số, tên, câu chữ đặc biệt). Câu dán được vào bất kỳ bài nào khác là câu hỏng.",
    "- Ngắn: phần lớn 4 đến 15 từ, độ dài các câu khác nhau. Không cần viết thành câu hoàn chỉnh.",
    "- Không nhắc lại hay tóm tắt nội dung bài. Không chào hỏi, không chúc chung chung (\"Chúc mọi người...\", \"Chào buổi sáng!\") trừ khi đáp lại bằng một ý riêng.",
    `- Tiếng Việt: dùng khẩu ngữ tự nhiên (nha, nè, á, ghê, trời ơi, thiệt, luôn, haha, kkk), xưng \"mình\" hoặc \"tui\", gọi người đăng là \"bạn\" hoặc \"bà/ông\" khi bài thân mật. ${settings.capitalize ? "Viết hoa chữ cái đầu câu và tên riêng như bình thường" : "Có thể viết thường chữ đầu câu"}, không cần dấu chấm cuối câu. Đừng nhồi nhiều từ lóng vào một câu.`,
    "- Tránh từ ngữ văn viết, sáo rỗng: \"Đúng là\", \"Thật tuyệt vời\", \"Quả thật\", \"Bài viết rất hay\", \"Cảm ơn bạn đã chia sẻ\", \"tràn đầy năng lượng\", \"hoàn toàn đồng ý\".",
    settings.capitalize
      ? "- Tiếng Anh: casual, normal sentence capitalization, contractions, no corporate tone, no \"Great post!\" / \"So true!\"."
      : "- Tiếng Anh: casual, lowercase is fine, contractions, no corporate tone, no \"Great post!\" / \"So true!\".",
    imageCount
      ? "- Có ảnh đính kèm: nhìn kỹ ảnh và bắt chi tiết cụ thể trong ảnh (món gì, ở đâu, màu sắc, đồ vật, chữ trong ảnh) kết hợp với chữ trong bài. Đừng mô tả lại cả bức ảnh, chỉ phản ứng như người vừa lướt thấy. Câu hỏi lại phải là điều bài chưa trả lời và người thật sẽ tò mò."
      : "- Bạn không xem được ảnh. Đừng hỏi hay khen chi tiết trong ảnh mà bài không nói tới (\"cà phê này có gì đặc biệt\", \"ảnh đẹp quá\"). Câu hỏi lại phải là điều bài chưa trả lời và người thật sẽ tò mò.",
    "- Tối đa một emoji, phần lớn câu không cần emoji. Không hashtag, không link, không kêu gọi follow, không xin tương tác, không quảng cáo.",
    "",
    // Ví dụ chung chỉ cần khi chưa có câu thật của người dùng (đỡ tốn token).
    ...(settings.profile
      ? []
      : [
          "Ví dụ, bài: \"Hậu quả của việc xem mukbang Hàn Quốc buổi sáng sớm là đây. May mà tủ có đủ nguyên liệu\"",
          "Câu dở: \"Đúng là xem mukbang buổi sáng làm mình muốn nấu liền luôn.\" / \"Món ăn trông thật hấp dẫn!\"",
          "Câu tốt: \"7h sáng mà làm nguyên mâm vậy hả trời\" / \"tủ lạnh nhà bà xịn ghê, nhà tui mở ra toàn nước lọc\" / \"công thức đâu share với 😭\"",
          "Ví dụ, bài: \"Good morning Tuesday X family! Chúc mọi người một ngày làm việc vui vẻ\"",
          "Câu dở: \"Chào buổi sáng! Chúc mọi người tràn đầy năng lượng.\"",
          "Câu tốt: \"thứ 3 rồi mà tui tưởng mới thứ 2 á\" / \"dậy sớm ngắm bình minh luôn hả, ngưỡng mộ ghê\" / \"gm, cà phê chưa ngấm nên chưa vui nổi\""
        ]),
    "",
    "Luôn lịch sự. Không nhận xét về cơ thể, ngoại hình gợi dục hay đời tư của người đăng. Với ảnh selfie hoặc ảnh người, chỉ khen chung chung về ảnh, phong cách, không khí, hoặc đáp lại nội dung chữ.",
    "Không bịa số liệu hay sự kiện. Nếu bài nói về chủ đề nhạy cảm (chính trị, tôn giáo, tai nạn), giữ trung lập và tôn trọng.",
    langRule,
    `Giọng văn: ${settings.tone}.`,
    settings.stablePrompt ? "" : examplesBlock(settings.examples),
    styleBlock(settings.samples || [], settings.profile, settings.stablePrompt ? null : text),
    settings.persona ? `Thông tin về người bình luận (dùng khi hợp lý, đừng nhắc lộ liễu): ${settings.persona}` : "",
    'Chỉ trả về JSON đúng dạng {"context": "...", "suggestions": ["...", "..."]}, không thêm chữ nào khác.',
    'Trong đó "context" là MỘT câu ngắn tiếng Việt ghi kết quả BƯỚC 1 và 2, ví dụ: "Khoe vườn rau nhà trồng, không khí vui, nên khen + hỏi han kiểu hàng xóm".',
    settings.emojiTail === "auto"
      ? 'Thêm trường "emojis": mảng cùng độ dài với "suggestions", mỗi phần tử là ĐÚNG MỘT emoji hợp với cảm xúc của câu tương ứng (vd câu đùa 😂, câu khen 😍, câu cảm động 🥹, câu hỏi tò mò 👀, câu đồng tình 👍). Bài buồn, nghiêm túc thì dùng 🙏 hoặc 🤍, hoặc chuỗi rỗng "". Câu trong "suggestions" KHÔNG tự chứa emoji ở cuối (extension tự gắn).'
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    settings.stablePrompt ? examplesBlock(settings.examples).trim() : "",
    `Tác giả: ${author || "(không rõ)"}`,
    imageCount
      ? `Bài có ${imageCount} ảnh, đính kèm bên dưới (ảnh bìa nếu là video).`
      : `Bài có ảnh/video: ${hasMedia ? "có (bạn không xem được ảnh, chỉ đọc được chữ)" : "không"}`,
    "Nội dung bài:",
    "<<<",
    text && text.trim() ? text.trim() : "(bài không có chữ)",
    ">>>",
    extraHint ? `Yêu cầu thêm của người dùng: ${extraHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

// Tải ảnh của bài về dạng base64 để gửi cho AI. Ảnh nào lỗi thì bỏ qua.
async function loadImages(urls) {
  const out = [];
  for (const url of (urls || []).slice(0, 4)) {
    try {
      if (!url.startsWith("https://pbs.twimg.com/")) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) continue;
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push({ mime, data: btoa(bin) });
    } catch (_) {
      // ảnh lỗi thì gợi ý chỉ dựa vào chữ
    }
  }
  return out;
}

// Model Groq nào đọc được ảnh (đoán theo tên).
// Model Groq nào đọc được ảnh: ưu tiên danh sách lấy từ Groq (input_modalities có "image"), không có thì đoán theo tên.
const groqSeesImages = (model, settings) =>
  (settings?.groqVisionModels || []).includes(model) || /llama-4|vision|scout|maverick|qwen3\.[5-9]|-vl/i.test(model || "");

// Viết hoa chữ cái đầu tiên (bỏ qua emoji, dấu ngoặc ở đầu câu).
function capFirst(s) {
  return s.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, pre, ch) => pre + ch.toLocaleUpperCase("vi"));
}

function parseSuggestions(raw, count) {
  if (!raw) return [];
  let jsonText = raw.trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start !== -1 && end > start) jsonText = jsonText.slice(start, end + 1);
  try {
    const obj = JSON.parse(jsonText);
    if (Array.isArray(obj.suggestions)) {
      const list = obj.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, count);
      if (obj.context) list.context = String(obj.context).slice(0, 200);
      if (Array.isArray(obj.emojis)) list.emojis = obj.emojis.map((e) => String(e || "").trim());
      if (Array.isArray(obj.images)) list.images = obj.images.map((e) => String(e || "").trim());
      return list;
    }
  } catch (_) {
    // rơi xuống tách theo dòng
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").replace(/^"|"$/g, "").trim())
    .filter((l) => l.length > 1 && !l.startsWith("{") && !l.startsWith("}"))
    .slice(0, count);
}

async function callClaude(payload, settings) {
  const imgs = payload.imgs || [];
  const { system, user } = buildPrompt({ ...payload, settings, imageCount: imgs.length });
  const content = imgs.length
    ? [
        ...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })),
        { type: "text", text: user }
      ]
    : user;
  const body = {
    model: settings.model || DEFAULTS.model,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content }],
    // Câu ngắn, không cần suy nghĩ sâu: effort thấp cho nhanh và rẻ.
    output_config: { effort: "low" },
    // Nếu bộ lọc an toàn từ chối, máy chủ tự chuyển sang model dự phòng.
    fallbacks: "default"
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data.stop_reason === "refusal") {
    throw new Error("Model từ chối gợi ý cho bài này.");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (payload.mode === "raw") return { raw: text };
  const list = parseSuggestions(text, settings.count);
  if (!list.length) throw new Error("Không đọc được gợi ý từ phản hồi.");
  return list;
}

async function callGemini(payload, settings) {
  const imgs = payload.imgs || [];
  const { system, user } = buildPrompt({ ...payload, settings, imageCount: imgs.length });
  const main = settings.geminiModel || DEFAULTS.geminiModel;
  const other = main === "gemini-flash-lite-latest" ? "gemini-flash-latest" : "gemini-flash-lite-latest";
  // Gemini miễn phí hay báo 503 (quá tải) hoặc 500: thử lại model chính, rồi chuyển sang model còn lại.
  const attempts = [main, main, other];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [...imgs.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })), { text: user }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 1.1 }
  });

  let res, data;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200 * i));
    res = await fetch(`${GEMINI_URL}/${encodeURIComponent(attempts[i])}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": settings.geminiKey },
      body
    });
    data = await res.json().catch(() => ({}));
    if (res.status !== 503 && res.status !== 500) break;
  }

  if (!res.ok) {
    if (res.status === 503 || res.status === 500) throw new Error("Máy chủ Gemini đang quá tải, bấm Gợi ý lại sau ít giây");
    if (res.status === 429) {
      const delay = (data.error?.details || []).map((d) => d.retryDelay).find(Boolean);
      const perDay = /per ?day|PerDay/i.test(JSON.stringify(data.error || {}));
      await setCooldown(
        `gemini:${main}`,
        parseDur(delay) || (perDay ? 3600e3 : 60e3),
        perDay ? "hết lượt trong ngày" : "hết lượt của phút này"
      );
      throw new Error("Hết lượt miễn phí của Gemini, thử lại sau ít phút");
    }
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error("Gemini chặn bài này vì lý do an toàn.");
  }
  const cand = (data.candidates || [])[0] || {};
  if (cand.finishReason === "SAFETY") throw new Error("Gemini chặn bài này vì lý do an toàn.");
  const text = ((cand.content && cand.content.parts) || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("\n");
  if (payload.mode === "raw") return { raw: text };
  const list = parseSuggestions(text, settings.count);
  if (!list.length) throw new Error("Không đọc được gợi ý từ phản hồi.");
  return list;
}

async function callGroq(payload, settings) {
  const model = settings.groqModel || DEFAULTS.groqModel;
  const imgs = groqSeesImages(model, settings) ? payload.imgs || [] : [];
  const { system, user } = buildPrompt({ ...payload, settings, imageCount: imgs.length });
  const content = imgs.length
    ? [
        { type: "text", text: user },
        ...imgs.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))
      ]
    : user;
  const req = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content }
    ],
    temperature: 1,
    // Groq tính giới hạn token/phút gồm cả phần dành sẵn cho câu trả lời, nên để vừa đủ.
    max_tokens: payload.mode === "raw" ? payload.maxTokens || 2000 : payload.mode === "post" ? 1800 : 1024 // bài đăng + mô tả ảnh dài hơn bình luận
  };
  // Tắt / giảm phần "suy nghĩ" của model có suy nghĩ: đỡ tốn token và nhanh hơn.
  if (/qwen3/i.test(model)) req.reasoning_effort = "none";
  else if (/gpt-oss/i.test(model)) req.reasoning_effort = "low";

  let res, data;
  for (let i = 0; i < 3; i++) {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.groqKey}` },
      body: JSON.stringify(req)
    });
    data = await res.json().catch(() => ({}));
    const msg = String(data.error?.message || "");
    // Model không nhận tham số reasoning_effort: bỏ đi rồi gọi lại.
    if (res.status === 400 && req.reasoning_effort && /reasoning/i.test(msg)) {
      delete req.reasoning_effort;
      continue;
    }
    // Quá tải: chờ chút rồi gọi lại.
    if ((res.status === 503 || res.status === 500) && i < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    // Hết lượt nhưng Groq bảo chờ ít giây: chờ rồi gọi lại một lần.
    const wait = Number(res.headers?.get?.("retry-after"));
    if (res.status === 429 && i === 0 && wait > 0 && wait <= 12) {
      await new Promise((r) => setTimeout(r, wait * 1000 + 300));
      continue;
    }
    break;
  }

  const hdr = (n) => res.headers?.get?.(n);
  const ckey = `groq:${model}`;
  if (res.ok) {
    // Còn lượt nhưng sắp hết: nghỉ luôn tới giờ hồi, khỏi gọi rồi mới bị từ chối.
    if (hdr("x-ratelimit-remaining-requests") === "0") {
      await setCooldown(ckey, parseDur(hdr("x-ratelimit-reset-requests")), "hết lượt trong ngày");
    } else if (Number(hdr("x-ratelimit-remaining-tokens")) < PROMPT_TOKENS) {
      await setCooldown(ckey, parseDur(hdr("x-ratelimit-reset-tokens")), "hết token của phút này");
    }
  }

  if (!res.ok) {
    if (res.status === 429) {
      const msg = String(data.error?.message || "");
      const wait = Number(hdr("retry-after"));
      const isDay = /per day|\(RPD\)|\(TPD\)/i.test(msg);
      const resetMs = isDay
        ? parseDur(hdr("x-ratelimit-reset-requests")) || wait * 1000
        : wait * 1000 || parseDur(hdr("x-ratelimit-reset-tokens"));
      await setCooldown(ckey, resetMs || 60e3, isDay ? "hết lượt trong ngày" : "hết lượt của phút này");
      const kind = /per day|\(RPD\)|\(TPD\)/i.test(msg)
        ? "hết lượt trong NGÀY"
        : /tokens per minute|\(TPM\)/i.test(msg)
        ? "quá số token mỗi phút"
        : /requests per minute|\(RPM\)/i.test(msg)
        ? "bấm quá nhiều lần mỗi phút"
        : "hết lượt miễn phí";
      const after = wait > 0 ? (wait >= 120 ? `, thử lại sau khoảng ${Math.round(wait / 60)} phút` : `, thử lại sau ${Math.ceil(wait)} giây`) : "";
      const e = new Error(`${kind} cho model ${model}${after}`);
      e.rateLimited = true;
      throw e;
    }
    if (res.status === 503 || res.status === 500) throw new Error("Máy chủ Groq đang quá tải, bấm Gợi ý lại sau ít giây");
    if (res.status === 404 || data.error?.code === "model_not_found") {
      throw new Error("Model Groq không còn tồn tại, vào Cài đặt bấm Tải danh sách model rồi chọn lại");
    }
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  // Một số model (Qwen, DeepSeek) in phần suy nghĩ trong <think>...</think>, bỏ đi.
  const text = String(data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  if (payload.mode === "raw") return { raw: text };
  const list = parseSuggestions(text, settings.count);
  if (!list.length) throw new Error("Không đọc được gợi ý từ phản hồi.");
  return list;
}

// ---------- Ollama: model chạy ngay trên máy bạn ----------
const OLLAMA_KEEP = "4h";
// Phải giống hệt nhau giữa lần nạp sẵn và lần gọi thật, khác là Ollama nạp lại model.
const OLLAMA_OPTS = { temperature: 1, num_predict: 400, num_ctx: 4096 };

// Nạp sẵn model + đọc trước phần system khi bạn mở X, để lần bấm Gợi ý đầu tiên khỏi phải chờ.
let lastWarm = 0;
async function warmOllama() {
  if (Date.now() - lastWarm < 10 * 60e3) return; // tối đa 10 phút một lần
  const settings = await getSettings();
  const useOllama =
    settings.provider === "ollama" || settings.provider === "hybrid" ||
    (settings.ollamaFallback && (settings.ollamaModelList || []).length && settings.provider !== "claude");
  if (!useOllama || !(settings.ollamaModelList || []).length) return;
  lastWarm = Date.now();
  const base0 = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  if (isTuned(settings)) {
    fetch(`${base0}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        messages: [{ role: "user", content: tunedPrompt("", "") }],
        stream: false,
        keep_alive: OLLAMA_KEEP,
        options: { ...TUNED_OPTS, num_predict: 1 }
      })
    }).catch(() => {});
    return;
  }
  const { history = [] } = settings.learn ? await chrome.storage.local.get({ history: [] }) : {};
  settings.samples = styleSamples(settings, settings.learn ? history : []).slice(0, 8);
  settings.profile = styleProfile(styleSamples(settings, settings.learn ? history : []));
  settings.count = Math.min(5, Math.max(3, Number(settings.count) || 4));
  const { system } = buildPrompt({ text: "", settings: { ...settings, stablePrompt: true, examples: [] } });
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel || DEFAULTS.ollamaModel,
      messages: [{ role: "system", content: system }, { role: "user", content: "ok" }],
      stream: false,
      keep_alive: OLLAMA_KEEP,
      options: { ...OLLAMA_OPTS, num_predict: 1 }
    })
  }).catch(() => {});
}
async function callOllama(payload, settings) {
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const imgs = settings.ollamaVision && settings.ollamaImages ? payload.imgs || [] : [];
  // Model nhỏ chạy CPU: gửi ít câu mẫu / ví dụ hơn cho nhanh.
  // stablePrompt: phần system giữ y nguyên giữa các lần gọi, Ollama chỉ phải đọc lại phần bài mới.
  const lite = { ...settings, stablePrompt: true, examples: (settings.examples || []).slice(0, 2), samples: (settings.samples || []).slice(0, 8) };
  const { system, user } = buildPrompt({ ...payload, settings: lite, imageCount: imgs.length });
  const userMsg = { role: "user", content: user };
  if (imgs.length) userMsg.images = imgs.map((im) => im.data);

  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      signal: settings.signal, // mở gợi ý bài khác thì huỷ lần gọi này, tránh dồn hàng
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel || DEFAULTS.ollamaModel,
        messages: [{ role: "system", content: system }, userMsg],
        stream: false,
        // Bài đăng: đưa khuôn JSON cụ thể, model nhỏ chỉ được bảo "json" hay trả về {} rỗng.
        format: payload.mode === "raw" ? payload.schema || "json" : payload.mode === "post" ? POST_SCHEMA : "json",
        keep_alive: OLLAMA_KEEP, // giữ model trong RAM cho lần sau nhanh hơn
        options:
          payload.mode === "raw"
            ? {
                ...OLLAMA_OPTS,
                temperature: 0.8,
                num_predict: payload.maxTokens || 1500,
                // Studio gửi prompt dài: cửa sổ ngữ cảnh phải chứa đủ cả đầu vào lẫn đầu ra, không thì JSON bị cắt cụt.
                num_ctx: Math.min(16384, Math.max(4096, Math.ceil(((payload.system || "").length + (payload.user || "").length) / 2.5) + (payload.maxTokens || 1500) + 512))
              }
            : payload.mode === "post"
            ? { ...OLLAMA_OPTS, num_predict: 1000 } // bài đăng dài hơn bình luận
            : OLLAMA_OPTS
      })
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Đã huỷ vì bạn mở gợi ý bài khác");
    throw new Error("Không kết nối được Ollama. Kiểm tra Ollama đang chạy (biểu tượng con lạc đà dưới khay hệ thống)");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403) throw new Error("Ollama chặn extension. Đặt biến OLLAMA_ORIGINS=chrome-extension://* rồi khởi động lại Ollama");
    if (res.status === 404) throw new Error(`Chưa có model "${settings.ollamaModel}". Chạy: ollama pull ${settings.ollamaModel}`);
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const text = String(data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  if (payload.mode === "raw") return { raw: text };
  const list = parseSuggestions(text, settings.count);
  if (!list.length) throw new Error("Không đọc được gợi ý từ phản hồi.");
  return list;
}

// ---------- Model đã huấn luyện riêng (tên bắt đầu bằng "xcs-") ----------
// Model đã học giọng bạn nên chỉ cần prompt ngắn, giống hệt lúc huấn luyện. Prompt ngắn = chạy nhanh.
const TUNED_RE = /^xcs-/i;
const TUNED_OPTS = { temperature: 1, top_p: 0.95, num_predict: 48, num_ctx: 1024 }; // câu bình luận ngắn, 48 token là đủ
function isTuned(settings) {
  return TUNED_RE.test(settings.ollamaModel || "");
}
function tunedPrompt(post, author) {
  const p = String(post || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return `Viết 1 bình luận trả lời bài X này theo giọng của tôi.\nTác giả: ${author || "(không rõ)"}\nBài: ${p || "(bài không có chữ)"}`;
}
// Dữ liệu huấn luyện: mỗi dòng một cặp bài -> câu bạn đã đăng (định dạng JSONL).
function trainLines(history) {
  return (history || [])
    .filter((h) => h.reply && String(h.reply).trim())
    .map((h) =>
      JSON.stringify({
        messages: [
          { role: "user", content: tunedPrompt(h.post, h.author) },
          { role: "assistant", content: String(h.reply).trim() }
        ]
      })
    );
}

async function callOllamaTuned(payload, settings) {
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const content = tunedPrompt(payload.text, payload.author);
  const out = [];
  // Mỗi lần gọi ra 1 câu. Prompt giống nhau nên từ lần 2 Ollama không phải đọc lại, chỉ tốn phần viết.
  for (let i = 0; i < settings.count * 2 && out.length < settings.count; i++) {
    let res;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: "POST",
        signal: settings.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages: [{ role: "user", content }],
          stream: false,
          keep_alive: OLLAMA_KEEP,
          options: { ...TUNED_OPTS, seed: Math.floor(Math.random() * 1e9) }
        })
      });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Đã huỷ vì bạn mở gợi ý bài khác");
      throw new Error("Không kết nối được Ollama. Kiểm tra Ollama đang chạy");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const t = String(data.message?.content || "").trim().split("\n")[0].replace(/^["“']|["”']$/g, "").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  if (!out.length) throw new Error("Model riêng không trả lời được.");
  out.context = "model riêng đã học giọng bạn";
  return out;
}

// ---------- Nghỉ khi hết lượt: nhớ giờ hồi lượt, tới giờ mới gọi lại ----------
// Đọc thời gian kiểu Groq: "3h12m5.2s", "38s", "1m2.5s", "450ms".
function parseDur(s) {
  if (!s) return 0;
  const str = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str) * 1000; // số giây trần
  let ms = 0;
  for (const [, n, u] of str.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    ms += Number(n) * { h: 3600e3, m: 60e3, s: 1e3, ms: 1 }[u];
  }
  return ms;
}

async function getCooldown(key) {
  const { cooldowns = {} } = await chrome.storage.local.get({ cooldowns: {} });
  const c = cooldowns[key];
  return c && c.until > Date.now() ? c : null;
}

async function setCooldown(key, ms, reason) {
  if (!(ms > 0)) return;
  const { cooldowns = {} } = await chrome.storage.local.get({ cooldowns: {} });
  for (const k of Object.keys(cooldowns)) if (cooldowns[k].until <= Date.now()) delete cooldowns[k];
  cooldowns[key] = { until: Date.now() + ms + 1000, reason };
  await chrome.storage.local.set({ cooldowns });
}

function clockTime(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hm : `${hm} ngày ${d.getDate()}/${d.getMonth() + 1}`;
}

// Khoá nghỉ của từng nhà cung cấp (Groq, Gemini tính theo từng model vì mỗi model có giới hạn riêng).
function cooldownKey(id, settings) {
  if (id === "groq") return `groq:${settings.groqModel || DEFAULTS.groqModel}`;
  if (id === "gemini") return `gemini:${settings.geminiModel || DEFAULTS.geminiModel}`;
  return id;
}

const PROMPT_TOKENS = 3500; // ước lượng token mỗi lần bấm Gợi ý (chữ + phần dành cho câu trả lời)

// ---------- Chọn nhà cung cấp và gọi ----------
const PROVIDER_INFO = {
  gemini: { name: "Gemini", key: (s) => s.geminiKey, model: (s) => s.geminiModel, call: (p, s) => callGemini(p, s) },
  groq: { name: "Groq", key: (s) => s.groqKey, model: (s) => s.groqModel, call: (p, s) => callGroq(p, s) },
  claude: { name: "Claude", key: (s) => s.apiKey, model: (s) => s.model, call: (p, s) => callClaude(p, s) },
  ollama: { name: "Ollama", key: () => "local", model: (s) => s.ollamaModel, call: (p, s) => (isTuned(s) && p.mode !== "post" && p.mode !== "raw" ? callOllamaTuned(p, s) : callOllama(p, s)) }
};

function seesImages(id, settings) {
  if (!settings.sendImages) return false;
  if (id === "groq") return groqSeesImages(settings.groqModel, settings);
  if (id === "ollama") return !isTuned(settings) && !!(settings.ollamaVision && settings.ollamaImages);
  return true;
}

async function runProvider(id, msg, settings) {
  const p = PROVIDER_INFO[id];
  const imgs = seesImages(id, settings) ? await loadImages(msg.images) : [];
  const suggestions = await p.call({ ...msg, imgs }, settings);
  return { provider: p.name, model: p.model(settings) || "", imageCount: imgs.length, suggestions, context: suggestions.context || "", emojis: suggestions.emojis || [], images: suggestions.images || [] };
}

// Chế độ Kết hợp: bài "quen" (đã có đủ câu bạn từng đăng cho bài giống vậy) thì để model trên máy viết theo các ví dụ đó.
// Bài "lạ" thì hỏi model trên mạng (viết hay hơn). Câu bạn đăng sau đó được lưu lại, lần sau bài giống vậy sẽ thành "quen".
const SIM_MIN = 0.3; // độ giống chữ tối thiểu để tính là "bài giống"
const FAMILIAR_MIN = 2; // cần ít nhất ngần này bài giống thì mới giao cho model trên máy

function countSimilar(history, postText) {
  const cur = words(postText);
  if (!cur.size) return 0;
  let n = 0;
  for (const h of history) {
    const w = words(h.post);
    let inter = 0;
    w.forEach((x) => cur.has(x) && inter++);
    if (inter / (Math.sqrt(w.size * cur.size) || 1) >= SIM_MIN) n++;
  }
  return n;
}

// Mỗi tab chỉ chạy một lần gợi ý: mở bài khác thì huỷ lần cũ.
const running = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "xcs-suggest") {
    const tabId = _sender.tab?.id;
    if (tabId != null && running.has(tabId)) running.get(tabId).abort();
    const ctrl = new AbortController();
    if (tabId != null) running.set(tabId, ctrl);
    // Gửi dòng trạng thái về bảng gợi ý (đang hỏi bên nào).
    const progress = (text) => {
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "xcs-progress", reqId: msg.reqId, text }).catch(() => {});
    };
    (async () => {
      const settings = await getSettings();
      settings.signal = ctrl.signal;
      const isPost = msg.mode === "post";
      const { history = [] } = settings.learn ? await chrome.storage.local.get({ history: [] }) : {};
      if (settings.learn && !isPost) settings.examples = pickExamples(history, msg.text, 4);
      if (isPost) settings.pastPosts = (await chrome.storage.local.get({ postHistory: [] })).postHistory;
      settings.samples = styleSamples(settings, settings.learn ? history : []);
      settings.profile = styleProfile(settings.samples);
      const count = Math.min(5, Math.max(3, Number(settings.count) || 4));
      settings.count = count;
      // Câu mẫu có sẵn chỉ hợp với bình luận; bài đăng thì không có câu mẫu.
      const fallback = () =>
        isPost
          ? []
          : self.XCSTemplates.templateSuggestions({
              text: msg.text,
              hasMedia: msg.hasMedia,
              count,
              language: settings.language
            });
      const noteTail = isPost ? "" : " Đang dùng câu mẫu.";

      // Thứ tự thử các nhà cung cấp.
      let order;
      let route = "";
      if (settings.provider === "hybrid") {
        const cloud = settings.hybridCloud || "groq";
        const hasCloudKey = !!PROVIDER_INFO[cloud].key(settings);
        const similar = settings.learn && !isPost ? countSimilar(history || [], msg.text) : 0;
        if (!hasCloudKey) {
          order = ["ollama"];
          route = `chưa có ${PROVIDER_INFO[cloud].name} key nên dùng máy`;
        } else if (similar >= FAMILIAR_MIN) {
          order = ["ollama", cloud];
          route = `bài quen, có ${similar} bài giống`;
        } else {
          order = [cloud, "ollama"];
          route = similar ? `bài lạ, mới có ${similar} bài giống` : "bài lạ, chưa có bài giống";
        }
      } else {
        const id = PROVIDER_INFO[settings.provider] ? settings.provider : "gemini";
        if (!PROVIDER_INFO[id].key(settings)) {
          sendResponse({
            source: "template",
            suggestions: fallback(),
            note: `Chưa có ${PROVIDER_INFO[id].name} API key.${noteTail}`
          });
          return;
        }
        // Bên chính lỗi (hết lượt, quá tải...) thì tự thử các bên trên mạng khác đã có key.
        order = [id, ...["groq", "gemini", "claude"].filter((x) => x !== id && PROVIDER_INFO[x].key(settings))];
        // Đã cài Ollama (có model trong danh sách) thì dùng làm dự phòng cuối cùng.
        if (id !== "ollama" && settings.ollamaFallback && (settings.ollamaModelList || []).length) order.push("ollama");
        route = "";
      }

      const errors = [];
      for (let i = 0; i < order.length; i++) {
        if (ctrl.signal.aborted) return;
        const nm = PROVIDER_INFO[order[i]].name;
        const cd = await getCooldown(cooldownKey(order[i], settings));
        if (cd) {
          errors.push(`${nm}: ${cd.reason}, nghỉ tới ${clockTime(cd.until)}`);
          continue; // không gọi, chuyển luôn sang bên sau
        }
        const prev = errors.length ? `${errors[errors.length - 1].split(",")[0]} → hỏi ` : "Đang hỏi ";
        progress(order[i] === "ollama" ? `${prev}${nm} trên máy (khoảng 20 giây)` : `${prev}${nm}`);
        try {
          const r = await runProvider(order[i], msg, settings);
          let out;
          if (isPost) {
            const c = cleanPosts(r.suggestions, r.images, msg.extraHint);
            out = c.posts;
            r.images = c.images;
            if (!out.length) throw new Error("Model trả về bài rỗng");
          } else out = r.suggestions.map((x) => applyStyle(x, settings.profile));
          if (settings.capitalize) out = out.map(capFirst);
          if (!isPost) out = out.map((x, i) => addEmojiTail(x, i, r.emojis, settings));
          const why = i > 0 ? [route, `${errors.join("; ")} → chuyển sang ${PROVIDER_INFO[order[i]].name}`].filter(Boolean).join("; ") : route;
          sendResponse({ source: "ai", ...r, suggestions: out, route: why });
          return;
        } catch (e) {
          errors.push(`${PROVIDER_INFO[order[i]].name}: ${e.message}`);
        }
      }
      sendResponse({
        source: "template",
        suggestions: fallback(),
        note: `Lỗi gọi AI (${errors.join(" | ")}).${noteTail}`
      });
    })().finally(() => {
      if (tabId != null && running.get(tabId) === ctrl) running.delete(tabId);
    });
    return true; // giữ kênh để trả lời bất đồng bộ
  }
  if (msg && msg.type === "xcs-similar") {
    chrome.storage.local.get({ history: [] }).then(({ history }) => sendResponse({ items: similarPast(history, msg.text) }));
    return true;
  }
  if (msg && msg.type === "xcs-save-example") {
    saveExample(msg);
    return;
  }
  if (msg && msg.type === "xcs-image") {
    handleImage(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }
  if (msg && msg.type === "xcs-save-post") {
    savePost(msg);
    return;
  }
  if (msg && msg.type === "xcs-train-data") {
    chrome.storage.local.get({ history: [] }).then(({ history }) => sendResponse({ lines: trainLines(history) }));
    return true;
  }
  if (msg && msg.type === "xcs-warm") {
    warmOllama();
    return;
  }
  if (msg && msg.type === "xcs-open-options") {
    chrome.runtime.openOptionsPage();
  }
});
