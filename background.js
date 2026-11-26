// Service worker: gọi AI (Gemini hoặc Claude) để tạo gợi ý bình luận.
// Không tự đăng, không tự thích. Chỉ trả về chữ cho người dùng chọn.
importScripts("templates.js", "studio-core.js"); // studio-core: Content Studio (ngữ cảnh → chủ đề → bài → ảnh)

const API_URL = "https://api.anthropic.com/v1/messages";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULTS = {
  provider: "gemini", // gemini | groq | claude
  groqKey: "",
  groqModel: "qwen/qwen3.8-27b",
  groqVisionModels: [],
  openaiKey: "", // ChatGPT (OpenAI API, trả phí theo lượng dùng)
  openaiModel: "gpt-5-mini",
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
  learn: true,
  saveToDisk: true, // lưu từng bài / câu trả lời ra ổ đĩa (native/xcs_saver.cjs)
  diskFolder: "D:\\MMO\\X-data"
};

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

// ---------- Học từ bình luận đã đăng ----------
const HISTORY_MAX = 5000; // giữ nhiều để có dữ liệu huấn luyện model riêng

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
function pickExamples(history, postText, k = 6, onMyPost = false) {
  if (!history.length) return [];
  const cur = words(postText || "");
  const n = history.length;
  const scored = history.map((h, i) => {
    const w = words(h.post);
    let inter = 0;
    w.forEach((x) => cur.has(x) && inter++);
    const sim = inter / (Math.sqrt(w.size * cur.size) || 1);
    return { h, score: sim + (h.edited ? 0.15 : 0) + (0.1 * i) / n + (!!h.onMyPost === !!onMyPost ? 0.3 : 0) };
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

// Dải gợi ý nhanh dưới ô trả lời: câu nào cũng có emoji, số lượng 1-3 cái khác nhau cho giống người gõ thật.
const QUICK_EMOJI = [
  [/haha|hihi|kk|=\)\)|cười|hài|lầy|vl|xỉu/i, "😂"],
  [/ngon|thèm|đói|(^|\s)ăn(\s|$)|món|lẩu|ốc|bún|phở|cơm/i, "🤤"],
  [/đẹp|xinh|cute|dễ thương|yêu|thích quá|mê/i, "😍"],
  [/buồn|tiếc|thương|khóc|mệt|đau/i, "🥺"],
  [/chill|nghỉ|ngủ|nằm|thư giãn/i, "😌"],
  [/\?\s*$/, "👀"],
  [/chúc|cố lên|giỏi|đỉnh|xịn|tuyệt/i, "🔥"]
];
const QUICK_DEFAULT = ["😆", "🥰", "👍", "😂", "🤭"];
// Câu hỏi trong bình luận (thường ở cuối): có dấu "?" hoặc kết thúc bằng từ hỏi tiếng Việt. Trả về câu hỏi, không có thì "".
const Q_END = /(gì|sao|nào|đâu|chưa|không|ko|hông|hok|hả|nhỉ|ai|mấy|bao giờ|bao nhiêu|thế nào|ra sao)(\s+(vậy|vậy ta|thế|ta|nhỉ|ạ|đó|z|dị|vại|nè|hả))?\s*[.!…~]*$/i;
function questionOf(comment) {
  const parts = String(comment || "")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (/\?/.test(parts[i]) || Q_END.test(parts[i])) return parts[i];
  return "";
}
// Chủ bài đáp bình luận: bỏ emoji AI tự gắn, giữ câu đúng độ dài, thiếu thì bù bằng câu đáp quen thuộc.
// Bình luận thường: câu đáp ngắn 1-4 chữ ("Dạ vâng ạ", "Hihi"). Bình luận có câu hỏi: phải trả lời thật, 2-14 chữ.
const OWN_POOL = ["Dạ vâng ạ", "Hihi", "Được thui", "Chuẩn luôn", "Cảm ơn nha", "Hehe", "Ok nhé", "Đúng rồi á", "Nhất trí", "Haha thật"];
const OWN_POOL_Q = ["Hihi bí mật nha", "Để mình nghĩ đã nè", "Chắc nằm nhà chill thôi á"];
function ownPool(comment) {
  return [...(questionOf(comment) ? OWN_POOL_Q : OWN_POOL)].sort(() => Math.random() - 0.5);
}
function shortOwnReplies(list, comment, count) {
  const strip = (t) => String(t || "").replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]+$/u, "").trim();
  const q = !!questionOf(comment);
  const [lo, hi] = q ? [2, 14] : [1, 4];
  const out = [];
  for (const t of list.map(strip)) {
    const n = t.split(/\s+/).filter(Boolean).length;
    if (q && n <= 3 && /^(dạ|vâng|ok|hi|he|ha|chuẩn|đúng|cảm ơn|được|nhất trí)/i.test(t)) continue; // đáp cho có, không trả lời câu hỏi
    if (n >= lo && n <= hi && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  if (q && out.length) return out.slice(0, count); // câu trả lời thật của AI, không bù câu chung chung
  for (const t of ownPool(comment)) if (out.length < count && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out.slice(0, count);
}

function quickEmoji(text, i, emojis, light) {
  // Đáp bình luận dưới bài của mình: câu rất ngắn, chỉ nửa số câu có emoji, mỗi câu 1 cái ("Hihi" thì để nguyên).
  if (light && (i % 2 === 1 || /^(hi|he|ha|kk)+$/i.test(text.replace(/[^\p{L}]/gu, "")))) return text;
  const raw = String((emojis || [])[i] || "").match(ONE_EMOJI_RE);
  if (!raw && ONE_EMOJI_RE.test(text)) return text; // câu đã tự có emoji
  const base = text.replace(/[\s\p{Extended_Pictographic}️‍\p{Emoji_Modifier}]+$/u, "").trim();
  const e = raw ? raw[0] : (QUICK_EMOJI.find(([re]) => re.test(base)) || [0, QUICK_DEFAULT[i % QUICK_DEFAULT.length]])[1];
  const n = light ? 1 : [1, 3, 2, 1, 3][i % 5];
  return `${base} ${e.repeat(n)}`;
}

function examplesBlock(examples) {
  if (!examples || !examples.length) return "";
  const lines = examples.map((e) =>
    e.onMyPost
      ? `- Bình luận dưới bài của chính họ${e.myPost ? ` (bài: "${e.myPost.replace(/\s+/g, " ").slice(0, 80)}")` : ""}: "${e.post.replace(/\s+/g, " ").slice(0, 140)}"\n  Người dùng đáp: "${e.reply}"`
      : `- Bài: "${e.post.replace(/\s+/g, " ").slice(0, 140)}"\n  Người dùng đã đăng: "${e.reply}"`
  );
  return [
    "",
    "BÌNH LUẬN THẬT người dùng này đã đăng trước đây (đây là giọng của họ). Bắt chước độ dài, cách xưng hô, từ ngữ, cách dùng emoji và dấu câu của họ. Không chép lại nguyên câu, không nhắc tới các bài cũ.",
    ...lines,
    ""
  ].join("\n");
}

// Chữ bài cha của một bình luận (vd bài của bạn mà người ta bình luận), lấy từ dịch vụ nhúng bài công khai của X.
// Dùng khi trang X chưa tải bài cha. Nhớ lại theo id để khỏi hỏi lại.
const parentCache = new Map();
async function parentText(commentId) {
  const id = String(commentId || "");
  if (!/^\d{5,25}$/.test(id)) return "";
  if (parentCache.has(id)) return parentCache.get(id);
  let text = "";
  try {
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`);
    if (r.ok) {
      const j = await r.json();
      const p = j.parent || {};
      text = String((p.note_tweet && p.note_tweet.text) || p.text || "")
        .replace(/^(@\w+\s+)+/, "")
        .replace(/\s*https:\/\/t\.co\/\w+\s*$/, "")
        .trim()
        .slice(0, 1000);
    }
  } catch (_) {
    // không lấy được thì thôi
  }
  parentCache.set(id, text);
  if (parentCache.size > 500) parentCache.delete(parentCache.keys().next().value);
  return text;
}

async function saveExample(msg) {
  const reply = String(msg.reply || "").trim();
  if (!reply) return;
  let imageDesc = "";
  try {
    const st = await getSettings();
    if (st.sendImages && Array.isArray(msg.images) && msg.images.length) imageDesc = await describeImages(msg.images, st, { local: false });
  } catch (_) {
    // không mô tả được thì thôi
  }
  const { history = [] } = await chrome.storage.local.get({ history: [] });
  const onMyPost = !!msg.onMyPost;
  let myPost = onMyPost ? String(msg.myPost || "") : "";
  if (onMyPost && !myPost && msg.myPostId) {
    // Chưa đọc được chữ bài của bạn trên trang: tìm trong các bài bạn đã đăng (đã lưu).
    const { postHistory = [] } = await chrome.storage.local.get({ postHistory: [] });
    myPost = (postHistory.find((p) => p.id && p.id === String(msg.myPostId)) || {}).text || "";
  }
  if (onMyPost && !myPost && msg.replyTo) myPost = await parentText(msg.replyTo);
  const urls = (a) => (Array.isArray(a) ? a : []).filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)).slice(0, 4);
  history.push({
    images: urls(msg.images),
    imageDesc,
    myImages: urls(msg.myImages),
    id: String(msg.id || ""),
    post: String(msg.post || "").slice(0, 600),
    author: msg.author || "",
    reply: reply.slice(0, 500),
    suggested: msg.suggested || "",
    own: !msg.suggested, // bạn tự gõ, không dùng gợi ý
    edited: !!msg.suggested && reply.replace(/\s+/g, " ") !== String(msg.suggested || "").replace(/\s+/g, " ").trim(),
    replyTo: String(msg.replyTo || ""),
    onMyPost, // trả lời bình luận dưới bài của chính bạn
    myPost: myPost.slice(0, 600),
    myPostId: onMyPost ? String(msg.myPostId || "") : "",
    ts: Date.now()
  });
  await chrome.storage.local.set({ history: history.slice(-HISTORY_MAX) });
  saveToDisk("reply", history[history.length - 1]);
}

// ---------- Bài của các page Facebook bạn chọn (fbsave.js lưu lúc bạn lướt) ----------
// Dùng làm mẫu phong cách khi gợi ý bài đăng và làm dữ liệu huấn luyện kiểu "viết bài theo phong cách page hay".
const FB_MAX = 5000;
const fbHash = (t) => {
  let h = 2166136261;
  for (const ch of String(t).replace(/\s+/g, " ").trim()) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
};
let fbQueue = Promise.resolve(); // ghi lần lượt, không mất bài khi nhiều bài tới cùng lúc
function saveFbPost(msg) {
  const job = fbQueue.then(async () => {
    const text = String(msg.text || "").trim().slice(0, 5000);
    const { fbPosts = [] } = await chrome.storage.local.get({ fbPosts: [] });
    if (text.length < 20) return { added: false, total: fbPosts.length };
    const id = fbHash(text);
    if (fbPosts.some((p) => p.id === id)) return { added: false, total: fbPosts.length };
    const it = { id, page: String(msg.page || ""), text, url: String(msg.url || ""), ts: Date.now(), status: "new" };
    fbPosts.push(it);
    await chrome.storage.local.set({ fbPosts: fbPosts.slice(-FB_MAX) });
    fbToDisk(it);
    return { added: true, total: Math.min(fbPosts.length, FB_MAX) };
  });
  fbQueue = job.catch(() => {});
  return job;
}
// D:\MMO\X-data\fb\<page>\<ngày> <giờ> <mã>.txt
// ---------- Kho bài Facebook: xem, kiểm tra trùng, đưa vào dữ liệu train ----------
// status: "new" (chờ duyệt) | "train" (đã vào dữ liệu train, có sẵn p.train đúng định dạng) | "dup" (trùng) | "skip" (bỏ)
const fbStatus = (p) => p.status || "new";
// Chữ để so trùng: thường, bỏ link, emoji, dấu câu, khoảng trắng thừa.
const fbNorm = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const fbShingles = (t) => {
  const w = fbNorm(t).split(" ").filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  if (!out.size && w.length) out.add(w.join(" "));
  return out;
};
// Độ giống: phần chung / bài ngắn hơn (bắt được cả bản bị cắt "Xem thêm" với bản đầy đủ).
function fbSim(a, b) {
  if (!a.size || !b.size) return 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  s.forEach((x) => l.has(x) && inter++);
  return inter / s.size;
}
const FB_DUP_SIM = 0.8;
// Kiểm tra trùng cho các bài chờ duyệt: so với bài đã vào train và các bài chờ duyệt lưu trước nó.
// Trong hai bài trùng nhau, giữ bản dài hơn (thường là bản đầy đủ).
function fbDupCheck(fbPosts) {
  const kept = fbPosts.filter((p) => fbStatus(p) === "train").map((p) => ({ p, sh: fbShingles(p.train ? p.train.assistant : p.text) }));
  let dups = 0;
  for (const p of fbPosts) {
    const st = fbStatus(p);
    if (st !== "new" && st !== "dup") continue;
    const sh = fbShingles(p.text);
    let best = null;
    for (const k of kept) {
      const sim = fbSim(sh, k.sh);
      if (sim >= FB_DUP_SIM && (!best || sim > best.sim)) best = { k, sim };
    }
    if (best && fbStatus(best.k.p) === "new" && p.text.length > best.k.p.text.length) {
      // bản này dài hơn bản chờ duyệt kia: bản kia mới là bản trùng
      Object.assign(best.k.p, { status: "dup", dupOf: p.id, sim: Math.round(best.sim * 100) });
      best.k.p = p;
      best.k.sh = sh;
      Object.assign(p, { status: "new", dupOf: "", sim: 0 });
      dups++;
    } else if (best) {
      Object.assign(p, { status: "dup", dupOf: best.k.p.id, sim: Math.round(best.sim * 100) });
      dups++;
    } else {
      Object.assign(p, { status: "new", dupOf: "", sim: 0 });
      kept.push({ p, sh });
    }
  }
  return dups;
}
// Làm sạch trước khi đưa vào train: bỏ link, dòng toàn hashtag ở cuối, chữ "Xem bản dịch", dòng trống thừa.
function fbClean(t) {
  let s = String(t || "")
    .replace(/\r/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]*(xem bản dịch|see translation|… xem thêm|\.\.\. xem thêm|xem thêm|see more|ẩn bớt|see less)[ \t]*$/gim, "");
  const lines = s.split("\n").map((x) => x.replace(/[ \t]+/g, " ").trim());
  while (lines.length && (!lines[lines.length - 1] || /^(#\S+\s*)+$/.test(lines[lines.length - 1]))) lines.pop();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// Đưa các bài (ids) vào dữ liệu train: kiểm tra trùng lần nữa, làm sạch, lưu sẵn đúng định dạng {user, assistant}.
async function fbApprove(ids, edits) {
  const job = fbQueue.then(async () => {
    const { fbPosts = [] } = await chrome.storage.local.get({ fbPosts: [] });
    const want = new Set(ids || []);
    for (const p of fbPosts) if (edits && edits[p.id] != null) p.text = String(edits[p.id]).trim();
    fbDupCheck(fbPosts);
    const res = { added: 0, dup: 0, short: 0 };
    const trainSh = fbPosts.filter((p) => fbStatus(p) === "train").map((p) => fbShingles(p.train.assistant));
    for (const p of fbPosts) {
      if (!want.has(p.id) || fbStatus(p) === "train") continue;
      if (fbStatus(p) === "dup") {
        res.dup++;
        continue;
      }
      const clean = fbClean(p.text).slice(0, 1500);
      if (clean.length < 40) {
        res.short++;
        continue;
      }
      const sh = fbShingles(clean);
      if (trainSh.some((x) => fbSim(sh, x) >= FB_DUP_SIM)) {
        res.dup++;
        continue;
      }
      p.status = "train";
      p.train = { user: fbPrompt(clean), assistant: clean };
      p.trainAt = Date.now();
      trainSh.push(sh);
      res.added++;
    }
    await chrome.storage.local.set({ fbPosts });
    return res;
  });
  fbQueue = job.catch(() => {});
  return job;
}
async function fbUpdate(ids, patchFn) {
  const job = fbQueue.then(async () => {
    const { fbPosts = [] } = await chrome.storage.local.get({ fbPosts: [] });
    const want = new Set(ids || []);
    const out = patchFn(fbPosts, want);
    await chrome.storage.local.set({ fbPosts: out });
    return { ok: true, total: out.length };
  });
  fbQueue = job.catch(() => {});
  return job;
}

async function fbToDisk(it) {
  try {
    const s = await getSettings();
    if (!s.saveToDisk) return;
    const { day, time, file } = vnStamp(it.ts);
    const lines = [`Page: ${it.page}`, `Lưu lúc: ${day} ${time} (giờ VN)`, it.url ? `Link: ${it.url}` : "", "", it.text].filter((x, i) => x || i > 2);
    await chrome.runtime.sendNativeMessage(SAVER, {
      root: /^([A-Za-z]:[\\/]|\\\\)/.test(s.diskFolder || "") ? s.diskFolder : DEFAULTS.diskFolder,
      dir: `fb/${safeName(it.page.replace(/^id:/, "id-"))}`,
      files: [{ name: `${day} ${file} ${it.id}.txt`, text: "\ufeff" + lines.join("\r\n") + "\r\n" }],
      images: []
    });
  } catch (e) {
    console.warn("[X Gợi Ý] lưu bài Facebook ra máy lỗi:", e.message);
  }
}
// Chọn vài bài mẫu hợp chủ đề (giống chữ nhất), thêm vài bài ngẫu nhiên cho đa dạng.
function pickStylePosts(fbPosts, topic, k = 3, minLen = 40) {
  const ok = (fbPosts || []).filter((p) => p.text && p.text.length >= minLen && !["dup", "skip"].includes(fbStatus(p)));
  const approved = ok.filter((p) => fbStatus(p) === "train");
  const list = approved.length >= k ? approved : ok;
  if (!list.length) return [];
  const cur = words(topic || "");
  const scored = list.map((p) => {
    const w = words(p.text.slice(0, 600));
    let inter = 0;
    w.forEach((x) => cur.has(x) && inter++);
    return { p, score: inter / (Math.sqrt(w.size * cur.size) || 1) + Math.random() * 0.05 };
  });
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, Math.max(1, k - 1)).map((x) => x.p);
  while (out.length < Math.min(k, list.length)) {
    const r = list[Math.floor(Math.random() * list.length)];
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

// Bài mẫu page cho bảng Gợi ý bài. Chế độ "Phong cách page Facebook": nhiều mẫu hơn (8), lấy cả câu nói ngắn,
// chọn theo ý bạn gõ; bài dài nên cho model viết dài hơn.
async function stylePostsFor(msg) {
  const { fbPosts = [] } = await chrome.storage.local.get({ fbPosts: [] });
  if (!msg.fbStyle) return pickStylePosts(fbPosts, msg.topic || msg.text);
  msg.length = "chuyện dài"; // chỉ để nới giới hạn độ dài trả về
  return pickStylePosts(fbPosts, msg.extraHint || "", 8, 15);
}

// ---------- Lưu từng bài / câu trả lời ra máy: D:\MMO\X-data\<ngày>\<giờ> ...\ ----------
// Ghi qua chương trình nhỏ native/xcs_saver.cjs (Native Messaging): ghi thẳng ra ổ đĩa, không có hộp thoại "Save as".
const safeName = (x) =>
  String(x || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).replace(/[. ]+$/, "");
const vnStamp = (ts) => {
  const iso = new Date(ts + 7 * 3600e3).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 19), file: iso.slice(11, 19).replace(/:/g, "-") };
};
// Ảnh của X: lấy bản to nhất thay vì bản nhỏ đang hiện.
function bigImg(u) {
  try {
    const x = new URL(u);
    if (x.pathname.startsWith("/media/")) {
      const fmt = x.searchParams.get("format") || (x.pathname.match(/\.(jpe?g|png|webp)$/i) || [])[1] || "jpg";
      return { url: `${x.origin}${x.pathname.replace(/\.(jpe?g|png|webp)$/i, "")}?format=${fmt}&name=large`, ext: fmt.replace("jpeg", "jpg") };
    }
    return { url: x.href, ext: (x.pathname.match(/\.(jpe?g|png|webp)$/i) || [, "jpg"])[1].replace("jpeg", "jpg") };
  } catch (_) {
    return { url: u, ext: "jpg" };
  }
}
const SAVER = "com.xcs.saver";
async function saveToDisk(kind, it) {
  try {
    const s = await getSettings();
    if (!s.saveToDisk || !it) return;
    const { day, time, file } = vnStamp(it.ts || Date.now());
    const handle = kind === "reply" ? ((it.author || "").match(/@\w+/) || [""])[0] : "";
    const lines = [`Thời gian: ${day} ${time} (giờ VN)`];
    if (kind === "reply") {
      if (it.replyTo) lines.push(`Bài gốc: https://x.com/i/status/${it.replyTo}`);
      if (it.id) lines.push(`Câu trả lời của tôi: https://x.com/i/status/${it.id}`);
      if (it.onMyPost) {
        if (it.myPostId) lines.push(`Bài của tôi: https://x.com/i/status/${it.myPostId}`);
        lines.push("", "--- Bài của tôi ---", it.myPost || "(không lấy được chữ bài của tôi)");
      }
      lines.push("", `--- ${it.onMyPost ? "Bình luận" : "Bài"} của ${it.author || "(không rõ)"} ---`, it.post || "(không lấy được chữ của bài)");
      if (it.imageDesc) lines.push(`(Ảnh: ${it.imageDesc})`);
      lines.push("", "--- Tôi trả lời ---", it.reply);
    } else {
      if (it.id) lines.push(`Link: https://x.com/i/status/${it.id}`);
      if (it.topic) lines.push(`Chủ đề: ${it.topic}`);
      lines.push("", "--- Bài tôi đăng ---", it.text);
    }
    if (it.suggested && it.suggested !== (it.reply || it.text)) lines.push("", "--- Gợi ý AI ban đầu ---", it.suggested);
    const images = [
      ...(it.images || []).map((u, i) => ({ u, name: `anh-bai-${i + 1}` })),
      ...(it.myImages || []).map((u, i) => ({ u, name: `anh-cua-toi-${i + 1}` }))
    ].map(({ u, name }) => {
      const b = bigImg(u);
      return { url: b.url, name: `${name}.${b.ext}` };
    });
    const res = await chrome.runtime.sendNativeMessage(SAVER, {
      root: /^([A-Za-z]:[\\/]|\\\\)/.test(s.diskFolder || "") ? s.diskFolder : DEFAULTS.diskFolder, // tên cũ kiểu "X-data" thì dùng mặc định
      dir: `${day}/${file} ${kind === "reply" ? (it.onMyPost ? "tra-loi-binh-luan" : "tra-loi") : "bai-dang"}${handle ? " " + safeName(handle) : ""}`,
      files: [
        { name: "noi-dung.txt", text: "\ufeff" + lines.join("\r\n") + "\r\n" }, // BOM để Notepad nhận đúng tiếng Việt
        { name: "info.json", text: JSON.stringify({ kind, ...it, time: `${day} ${time}` }, null, 2) }
      ],
      images
    });
    if (!res || !res.ok) throw new Error((res && res.error) || "không rõ lỗi");
    chrome.storage.local.set({ diskSave: { ok: true, at: Date.now(), dir: res.dir } });
  } catch (e) {
    const msg = /not found|host/i.test(e.message)
      ? "Chưa cài chương trình lưu. Chạy: powershell -ExecutionPolicy Bypass -File native\\cai-dat.ps1 (trong thư mục extension)"
      : e.message;
    console.warn("[X Gợi Ý] lưu ra máy lỗi:", e.message);
    chrome.storage.local.set({ diskSave: { ok: false, at: Date.now(), error: msg } });
  }
}

// ---------- Viết bài đăng mới (theo chủ đề, thời điểm, con người, địa điểm) ----------
const POST_HISTORY_MAX = 5000;
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
  const item = {
    text: text.slice(0, 4000),
    topic: String(msg.topic || "").slice(0, 200),
    suggested: String(msg.suggested || "").slice(0, 4000),
    id: String(msg.id || ""),
    myImages: (Array.isArray(msg.myImages) ? msg.myImages : []).filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)).slice(0, 4),
    ts: Date.now()
  };
  postHistory.push(item);
  await chrome.storage.local.set({ postHistory: postHistory.slice(-POST_HISTORY_MAX) });
  saveToDisk("post", item);
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

// Độ dài, mục tiêu, CTA... (nhóm "Thêm tuỳ chọn" trên bảng) → chỉ dẫn cụ thể cho AI.
const POST_LENGTH = {
  "một câu": "MỘT câu duy nhất, gọn, đắt.",
  "ngắn (2–3 câu)": "2–3 câu ngắn, dưới 200 ký tự.",
  "vừa (4–6 câu)": "4–6 câu, dưới 280 ký tự.",
  "chuyện dài": "một câu chuyện dài 5–10 câu, xuống dòng cho dễ đọc (bài dài hơn 280 ký tự cần tài khoản X Premium)."
};
const POST_CTA = {
  "không kêu gọi": "KHÔNG kết bằng câu hỏi hay lời kêu gọi nào. Để bài tự khiến người ta muốn trả lời.",
  "hỏi ý kiến": "Kết bằng một câu hỏi xin ý kiến người đọc, tự nhiên, cụ thể.",
  "mời kể chuyện riêng": "Kết bằng lời mời người đọc kể trải nghiệm của chính họ.",
  "chọn A hay B": "Kết bằng câu hỏi cho chọn A hay B (hai lựa chọn cụ thể).",
  "tag một người bạn": "Kết bằng lời rủ tag một người bạn hợp với bài (nhẹ nhàng, không ép).",
  "đồng ý hay không?": "Kết bằng câu hỏi người đọc đồng ý hay không."
};
const POST_LANG = {
  "tiếng Việt": "Viết bằng tiếng Việt.",
  "tiếng Anh": "Write in natural, casual English.",
  "song ngữ Việt – Anh": "Viết song ngữ: tiếng Việt trước, rồi bản tiếng Anh ngắn ở dòng dưới (cả bài vẫn gọn)."
};
const POST_IMAGE_EN = {
  "minh hoạ điện ảnh": "cinematic illustration",
  anime: "anime style illustration",
  "hoạt hình 3D": "3D cartoon render",
  "ảnh chụp chân thực": "realistic photography",
  meme: "meme style image",
  "tranh tối giản": "minimalist artwork"
};
const joinSel = (v) => [].concat(v || []).map((x) => String(x).trim()).filter(Boolean).join(", ");

function buildPostPrompt(args) {
  const { style, extraHint, settings } = args;
  const persona = joinSel(args.persona);
  const topic = joinSel(args.topic);
  const place = joinSel(args.place);
  const when = joinSel(args.when);
  const mood = joinSel(args.mood);
  const tone = joinSel(args.tone);
  const goal = joinSel(args.goal);
  const hook = joinSel(args.hook);
  const strategy = joinSel(args.strategy);
  const cta = joinSel(args.cta);
  const length = joinSel(args.length);
  const langSel = joinSel(args.lang);
  const image = joinSel(args.image);
  const styleName = joinSel(style);
  const styleRule = styleName
    ? `KIỂU BÀI: "${styleName}". ${POST_STYLES[styleName] || "Viết đúng kiểu này."} Cả ${settings.count} bài đều theo kiểu này, khác nhau về ý và góc nhìn, không bài nào mở đầu giống bài khác.`
    : `Viết đúng ${settings.count} bài, mỗi bài một kiểu khác nhau, chọn trong: life quote; triết lý; lời khuyên từ trải nghiệm; câu hỏi tương tác; kể chuyện ngắn; hài hước; quan điểm (hot take); danh sách 3 điều. Không bài nào mở đầu giống bài khác.`;
  const lang = POST_LANG[langSel] || (settings.language === "en" ? "Write in English." : "Viết bằng tiếng Việt (trừ khi yêu cầu thêm bảo viết tiếng Anh).");
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
        ...(settings.samples || []).slice(0, 10).map((x) => `• ${x}`)
      ]
    : [];
  const past = (settings.pastPosts || []).slice(-8);
  const longPost = length === "chuyện dài";
  const noImage = image === "không ảnh";
  const system = [
    "Bạn là bộ gợi ý bài đăng X (Twitter) cho một người dùng. Bạn viết BÀI ĐĂNG MỚI của chính họ (không phải bình luận). Họ sẽ tự đọc, sửa và tự bấm đăng.",
    "",
    "QUY TẮC CHUNG:",
    "1. Dùng ngày, giờ hiện tại để hiểu bối cảnh (sáng thì không chúc ngủ ngon, thứ Hai khác tối thứ Bảy, khuya khác giờ tan làm).",
    "2. Kết hợp các lựa chọn bên dưới một cách TỰ NHIÊN, không nhồi cho đủ. Lựa chọn nào trống thì tự quyết theo ngữ cảnh hiện tại (giờ, ngày, con người).",
    "3. KHÔNG viết câu động lực chung chung (\"hãy luôn cố gắng\", \"cuộc sống là...\", \"tràn đầy năng lượng\").",
    "4. Ưu tiên trải nghiệm người thật, đời thường, có chi tiết cụ thể (tên món, góc phố, con số nhỏ) để người đọc thấy mình trong đó. Câu dán được cho bất kỳ ai ở bất kỳ đâu là câu hỏng.",
    "5. Câu mở đầu phải khiến người lướt nhanh dừng lại.",
    "6. Móc kéo tương tác phải tự nhiên, không gượng, không xin like/follow/share.",
    "7. Ít emoji: tối đa 1 mỗi bài, nhiều bài không cần.",
    "8. Không lặp lại các bài đã đăng hay các ý quá quen.",
    "9. Không có lựa chọn nào thì tự gợi ý thông minh theo ngữ cảnh hiện tại.",
    "10. Viết như người đang trò chuyện trên X, KHÔNG giống quảng cáo hay bài PR.",
    "",
    "ĐÚNG VAI: viết đúng con người được chọn (tuổi, nghề, gia đình, tính cách, cách xưng hô). Không bịa thêm thông tin cá nhân quan trọng (nghề, gia đình, thu nhập) không có trong \"Con người tôi\". Địa điểm: dùng chi tiết đời thường của nơi đó, KHÔNG bịa tin tức, sự kiện, số liệu, thời tiết cụ thể của hôm nay (trừ khi thời điểm được chọn là \"ngày mưa\").",
    "",
    styleRule,
    "",
    "CÁCH VIẾT:",
    longPost ? `- Độ dài: ${POST_LENGTH[length]}` : `- Mỗi bài DƯỚI 270 ký tự (giới hạn của X). Độ dài: ${POST_LENGTH[length] || "ngắn hoặc vừa (1–4 câu), các bài dài ngắn khác nhau."}`,
    `- Giọng: ${tone || "chân thật, kiểu trò chuyện"}${settings.tone ? ` (giọng chung của người dùng: ${settings.tone})` : ""}.`,
    mood ? `- Tâm trạng của người viết: ${mood}. Để tâm trạng thấm vào câu chữ, không cần nói thẳng ra.` : "- Tâm trạng: tự chọn cho hợp giờ giấc và hoàn cảnh.",
    `- Mục tiêu: ${goal || "tăng lượt trả lời"}.`,
    hook ? `- Câu mở đầu theo kiểu: ${hook}.` : "- Câu mở đầu: chọn kiểu hợp ngữ cảnh (câu hỏi, thú nhận, câu bất ngờ, tình huống ai cũng gặp...), mỗi bài một kiểu.",
    strategy ? `- Cách kéo tương tác: ${strategy}.` : "",
    `- Kết bài: ${POST_CTA[cta] || "nếu hợp thì kết bằng một câu hỏi tự nhiên, dễ trả lời (không hỏi chung chung \"mọi người nghĩ sao\")."}`,
    "- Bài đăng có thể chỉ có chữ: KHÔNG viết như đang chỉ vào ảnh (\"cái này\", \"nhìn nè\", \"view này\"), mọi thứ phải nói rõ bằng chữ.",
    "- Không tag @tài khoản nào. Không hashtag (trừ khi yêu cầu thêm bảo có), không link.",
    "- Không viết về chính trị, tôn giáo, chuyện gây thù ghét. Không nói xấu người hay thương hiệu cụ thể. Ý kiến gây tranh cãi chỉ ở mức chuyện đời thường.",
    lang,
    ...habit,
    past.length ? "\nBÀI NGƯỜI DÙNG ĐÃ ĐĂNG TRƯỚC ĐÂY (bắt giọng, KHÔNG lặp lại ý):\n" + past.map((x) => `• ${x.text.replace(/\s+/g, " ")}`).join("\n") : "",
    (settings.stylePosts || []).length
      ? "\nBÀI MẪU TỪ PAGE VIẾT HAY mà người dùng thích. Học cách mở bài gây tò mò, nhịp câu, cách kể chi tiết đời thường, cách kết. TUYỆT ĐỐI KHÔNG chép câu chữ, ý hay câu chuyện của họ; bài viết ra vẫn là giọng và chuyện của người dùng:\n" +
        settings.stylePosts.map((x) => `• ${x.text.replace(/\s+/g, " ").slice(0, 450)}`).join("\n")
      : "",
    "",
    'Chỉ trả về JSON đúng dạng {"context": "...", "suggestions": ["...", "..."], "images": ["...", "..."]}, không thêm chữ nào khác.',
    'Trong đó "context" là MỘT câu ngắn tiếng Việt nói góc viết bạn chọn, ví dụ: "10 giờ tối thứ Sáu ở Hà Nội, dân văn phòng mệt nhưng chưa muốn ngủ, mở bằng lời thú nhận + hỏi A/B".',
    noImage
      ? '"images": mảng cùng độ dài với "suggestions", mỗi phần tử là chuỗi rỗng "" (người dùng không cần ảnh).'
      : `"images": mảng cùng độ dài với "suggestions", mỗi phần tử là ẢNH MINH HOẠ cho bài tương ứng, viết bằng TIẾNG ANH theo dạng "từ khoá | mô tả": từ khoá là 2–3 từ tên vật/cảnh chính để tìm ảnh, mô tả 8–15 từ là một cảnh cụ thể có không khí${POST_IMAGE_EN[image] ? `, phong cách ${POST_IMAGE_EN[image]}` : ""}, không có chữ trong ảnh, không có người nổi tiếng.`,
    noImage ? "" : 'Ví dụ: "iced coffee | iced milk coffee on a wooden balcony table, rainy Hanoi street below, warm evening light".'
  ]
    .filter((x) => x !== "")
    .join("\n");
  const user = [
    `Thời điểm hiện tại: ${nowContext()}`,
    // Con người chọn trên bảng; không chọn thì lấy ô "Bạn là ai?" trong Cài đặt.
    `Con người tôi: ${persona || String(settings.persona || "").trim() || "(không chọn: viết như một người bình thường, hợp ngữ cảnh)"}`,
    `Kiểu bài: ${styleName || "(trộn nhiều kiểu)"}`,
    `Chủ đề: ${topic || "(để bạn chọn theo ngữ cảnh)"}`,
    `Địa điểm: ${place || "(không chọn: đừng nhắc địa điểm cụ thể)"}`,
    when ? `Thời điểm / hoàn cảnh muốn viết: ${when}` : "",
    mood ? `Tâm trạng: ${mood}` : "",
    tone ? `Giọng viết: ${tone}` : "",
    goal ? `Mục tiêu: ${goal}` : "",
    hook ? `Câu mở đầu: ${hook}` : "",
    strategy ? `Cách kéo tương tác: ${strategy}` : "",
    cta ? `Kết bài (CTA): ${cta}` : "",
    length ? `Độ dài: ${length}` : "",
    langSel ? `Ngôn ngữ: ${langSel}` : "",
    image ? `Kiểu ảnh: ${image}` : "",
    extraHint ? `Yêu cầu thêm: ${extraHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

// Chế độ "Phong cách page Facebook": tách hẳn khỏi các lựa chọn của bảng (con người, chủ đề, giọng, cách gõ của bạn...).
// Chỉ học từ các bài page Facebook đã lưu (ưu tiên bài đã duyệt vào train). Ô "Thêm ý" = ý / chủ đề muốn viết (tuỳ chọn).
function buildFbStylePrompt(args) {
  const { settings, extraHint } = args;
  const ex = settings.stylePosts || [];
  const system = [
    `Bạn chuyển giọng văn của một page Facebook viết hay thành BÀI ĐĂNG X (Twitter) MỚI. Viết đúng ${settings.count} bài.`,
    "MỤC TIÊU SỐ 1: được hiển thị trên timeline X nhiều nhất có thể (organic impressions). Mọi quy tắc khác phục vụ mục tiêu này.",
    "",
    "HỌC TỪ BÀI MẪU: giọng, cách xưng hô, nhịp câu, cách kể, mức dùng emoji. Nhưng viết cho X: vào thẳng ý, gọn hơn bài Facebook.",
    "",
    "CÁCH VIẾT ĐỂ ĐƯỢC HIỂN THỊ NHIỀU:",
    "1. CÂU MỞ ĐẦU là quan trọng nhất: phải giữ được người đang lướt ngay từ câu đầu. Vào thẳng một nhận định bất ngờ, một khoảnh khắc cụ thể, hoặc một sự thật ai cũng từng gặp. Không chào, không dẫn dắt, không mở bài dài.",
    "2. KHOẢNG TÒ MÒ: khoảng 200 ký tự đầu (phần X hiện trước nút \"Hiện thêm\") phải khiến người ta muốn đọc tiếp: hé ra điều sắp nói nhưng chưa nói hết. Ý đắt nhất để ở sau, không giải thích hết ngay câu đầu.",
    "3. CHỦ ĐỀ RỘNG, GẦN GŨI: chuyện thường ngày ai cũng thấy mình trong đó (đi làm, tiền lương, gia đình, bạn bè, tuổi tác, sức khoẻ, thói quen). Tránh chủ đề ngách chỉ một nhóm nhỏ hiểu.",
    "4. ĐÚNG THỜI ĐIỂM: nếu tự nhiên thì gắn với thời điểm hiện tại (ngày trong tuần, mùa, dịp lễ, cuối tháng...). Không gượng ép.",
    "5. ĐOẠN NGẮN: mỗi đoạn 1–2 câu, xuống dòng giữa các đoạn để đọc lướt trên điện thoại. Không có đoạn nào là một khối chữ dài.",
    "6. ĐỘ DÀI: phần lớn bài 40–150 chữ. Được có 1 bài thật ngắn (1–3 câu, dưới 280 ký tự) nếu câu đó đủ mạnh.",
    "7. GIỌNG NGƯỜI THẬT, KHÔNG GIỐNG AI VIẾT: câu có độ dài khác nhau, có chi tiết cụ thể, có cảm xúc thật. Không dùng các mở bài, kết bài sáo kiểu \"Trong cuộc sống hối hả\", \"Hãy nhớ rằng\", \"Bài học rút ra là\", \"Cuộc sống mà\". Không liệt kê 1-2-3 đều tăm tắp, không emoji đầu mỗi dòng.",
    "",
    "TRÁNH (làm giảm lượt hiển thị hoặc bị coi là câu tương tác):",
    "- Câu hỏi gượng ép ở cuối (\"Bạn nghĩ sao?\", \"Bạn có đồng ý không?\", \"Còn bạn thì sao?\"). Chỉ hỏi khi câu hỏi là một phần tự nhiên của câu chuyện.",
    "- Câu xin tương tác: \"Like nếu...\", \"Share cho...\", \"Comment 1...\", \"Tag người...\", \"Lưu lại kẻo trôi\", \"Follow để...\".",
    "- Hashtag, link, tag tên người.",
    "",
    "QUY TẮC NỘI DUNG:",
    "- TUYỆT ĐỐI KHÔNG chép câu chữ, ý chính hay câu chuyện của bài mẫu. Ý mới, ví dụ mới, câu mới.",
    "- Không bịa tin tức, số liệu, tên bệnh viện, tên người thật, kết quả nghiên cứu. Không viết kiểu \"Theo báo...\".",
    "- Không chính trị, tôn giáo, thù ghét; không nói xấu người hay thương hiệu cụ thể.",
    "- Mỗi bài một ý và một kiểu câu mở đầu khác nhau.",
    "",
    ex.length
      ? `BÀI MẪU CỦA PAGE (${ex.length} bài):\n` + ex.map((x, i) => `--- Bài ${i + 1} ---\n${x.text.trim().slice(0, 900)}`).join("\n")
      : "(Chưa có bài mẫu: viết kiểu page truyền cảm hứng, tư duy sống, giọng chín chắn, gần gũi.)",
    "",
    'Chỉ trả về JSON đúng dạng {"context": "...", "suggestions": ["...", "..."], "images": ["...", "..."]}, không thêm chữ nào khác.',
    '"context": MỘT câu ngắn tiếng Việt nói các ý bạn chọn và câu mở đầu dùng chiêu gì để giữ người lướt. "images": mảng cùng độ dài, mỗi phần tử là ảnh minh hoạ bằng TIẾNG ANH dạng "từ khoá | mô tả 8-15 từ", không có chữ trong ảnh.'
  ].join("\n");
  const user = [
    `Thời điểm hiện tại: ${nowContext()}`,
    extraHint ? `Ý / chủ đề muốn viết: ${extraHint}` : "Ý / chủ đề: bạn tự chọn, hợp với page và thời điểm hiện tại."
  ].join("\n");
  return { system, user };
}

function buildPrompt(args) {
  if (args.mode === "raw") return { system: args.system, user: args.user }; // Content Studio tự viết prompt
  if (args.mode === "post" && args.fbStyle) return buildFbStylePrompt(args);
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
    args.onMyPost
      ? [
          "ĐÂY LÀ BÌNH LUẬN DƯỚI BÀI CỦA CHÍNH NGƯỜI DÙNG. Người dùng là chủ bài, đáp lại người bình luận (khác hẳn đi bình luận bài người khác).",
          ...(questionOf(text)
            ? [
                `Người bình luận ĐANG HỎI chủ bài: "${questionOf(text)}"`,
                "Chủ bài phải TRẢ LỜI THẬT câu hỏi đó, như đang nói chuyện với bạn: 3-12 chữ, nói cụ thể mình làm gì / nghĩ gì, có thể thêm hihi, haha, nè, á cho tự nhiên. Có thể hỏi lại ngắn ở cuối.",
                "Ví dụ: hỏi \"tối nay bạn làm gì để sạc pin vậy?\" → \"Nằm cày phim với ăn vặt thôi á\", \"Đi ngủ sớm cho khỏe hihi\", \"Ra quán cà phê ngồi chill nè, còn bạn?\".",
                "KHÔNG đáp kiểu \"Dạ vâng ạ\", \"Hihi\", \"Chuẩn luôn\" vì như vậy là không trả lời câu hỏi. Mỗi gợi ý là một câu trả lời khác nhau."
              ]
            : [
                "Người bình luận chỉ chia sẻ / đồng tình, không hỏi gì: chủ bài đáp RẤT NGẮN, 1-4 chữ, kiểu đáp lời, đồng ý, cười, dạ vâng, cảm ơn. Không kể chuyện của mình, không giảng giải, không lặp lại ý người ta.",
                "Ví dụ đúng giọng: \"Dạ vâng ạ\", \"Ok nhé\", \"Hihi\", \"Hehe\", \"Được thui\", \"Chuẩn luôn\", \"Đúng rồi á\", \"Cảm ơn nha\", \"Dạ đúng ạ\", \"Chuẩn bài\", \"Haha thật\", \"Nhất trí\". Mỗi gợi ý một kiểu khác nhau, có câu chỉ là tiếng cười."
              ]),
          "Bài gốc của người dùng:",
          "<<<",
          args.myPost && args.myPost.trim() ? args.myPost.trim() : "(không lấy được chữ của bài gốc)",
          ">>>",
          "Bình luận cần đáp lại:"
        ].join("\n")
      : "Nội dung bài:",
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

// ---------- ChatGPT (OpenAI API) ----------
// Cần API key ở platform.openai.com (trả phí theo lượng dùng, tách riêng với gói ChatGPT Plus).
const openaiSeesImages = (model) => /gpt-(4o|4\.1|5)|^o[34]|chatgpt/i.test(model || "");
async function callOpenAI(payload, settings) {
  const model = settings.openaiModel || DEFAULTS.openaiModel;
  const imgs = openaiSeesImages(model) ? payload.imgs || [] : [];
  const { system, user } = buildPrompt({ ...payload, settings, imageCount: imgs.length });
  const content = imgs.length
    ? [{ type: "text", text: user }, ...imgs.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}`, detail: "low" } }))]
    : user;
  const reasoning = /^(gpt-5|o\d)/i.test(model); // model có "suy nghĩ": tắt bớt cho nhanh, không cho chỉnh temperature
  const req = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content }
    ],
    // Model suy nghĩ tính cả phần suy nghĩ vào giới hạn này, nên để rộng.
    max_completion_tokens: (payload.mode === "raw" ? payload.maxTokens || 2000 : payload.mode === "post" ? (payload.length === "chuyện dài" ? 3200 : 1800) : 1024) + (reasoning ? 2000 : 0),
    response_format: { type: "json_object" }
  };
  if (reasoning) req.reasoning_effort = "minimal";
  else req.temperature = 1;
  let res, data;
  for (let i = 0; i < 4; i++) {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: settings.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.openaiKey}` },
      body: JSON.stringify(req)
    });
    data = await res.json().catch(() => ({}));
    const msg = String(data.error?.message || "");
    // Model mới / cũ nhận tham số khác nhau: đổi cho hợp rồi gọi lại.
    if (res.status === 400 && req.reasoning_effort && /reasoning|minimal/i.test(msg)) {
      if (req.reasoning_effort === "minimal") req.reasoning_effort = "none";
      else delete req.reasoning_effort;
      continue;
    }
    if (res.status === 400 && "temperature" in req && /temperature/i.test(msg)) {
      delete req.temperature;
      continue;
    }
    if (res.status === 400 && req.response_format && /response_format|json/i.test(msg)) {
      delete req.response_format;
      continue;
    }
    if ((res.status === 503 || res.status === 500) && i < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    break;
  }
  if (!res.ok) {
    const msg = String(data.error?.message || "");
    if (res.status === 401) throw new Error("API key sai hoặc đã bị xoá");
    if (res.status === 429) {
      if (/quota|billing/i.test(msg)) {
        await setCooldown(`openai:${model}`, 3600e3, "hết tiền trong tài khoản API");
        throw new Error("tài khoản API hết tiền / chưa nạp (platform.openai.com → Billing)");
      }
      const wait = Number(res.headers?.get?.("retry-after")) || 20;
      await setCooldown(`openai:${model}`, wait * 1000, "quá nhiều yêu cầu");
      throw new Error(`quá nhiều yêu cầu, thử lại sau ${Math.ceil(wait)} giây`);
    }
    if (res.status === 404) throw new Error(`không có model ${model}, vào Cài đặt bấm Tải danh sách model rồi chọn lại`);
    throw new Error(`${msg || `HTTP ${res.status}`}`);
  }
  const text = String(data.choices?.[0]?.message?.content || "");
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
    max_tokens: payload.mode === "raw" ? payload.maxTokens || 2000 : payload.mode === "post" ? (payload.length === "chuyện dài" ? 3200 : 1800) : 1024 // bài đăng + mô tả ảnh dài hơn bình luận
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
        messages: [], // danh sách rỗng = Ollama chỉ nạp model vào bộ nhớ, không có prompt giả nào
        stream: false,
        keep_alive: OLLAMA_KEEP
      })
    }).catch(() => {});
    return;
  }
  const st = await ollamaStyle(settings);
  settings.samples = st.samples;
  settings.profile = st.profile;
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
      think: false, // model có suy nghĩ (Qwen 3.5, Gemma 4): tắt cho nhanh
      keep_alive: OLLAMA_KEEP,
      options: { ...OLLAMA_OPTS, num_predict: 1 }
    })
  }).catch(() => {});
}
// Cách gõ (câu mẫu + thống kê) gửi cho Ollama được "chụp" lại và giữ nguyên 12 giờ.
// Nếu mỗi câu bạn vừa đăng làm phần system đổi đi, Ollama phải đọc lại toàn bộ ~2000 token mỗi lần (chậm ~10 giây).
// Giữ nguyên thì Ollama dùng lại bộ nhớ đệm, chỉ phải đọc phần bài mới.
const STYLE_SNAP_MS = 12 * 3600e3;
async function ollamaStyle(settings) {
  const { ollamaStyleSnap: snap } = await chrome.storage.local.get({ ollamaStyleSnap: null });
  const key = `${settings.learn ? 1 : 0}|${String(settings.styleSamples || "").length}`;
  if (snap && snap.key === key && Date.now() - snap.at < STYLE_SNAP_MS) return snap;
  const { history = [] } = settings.learn ? await chrome.storage.local.get({ history: [] }) : {};
  const all = styleSamples(settings, settings.learn ? history : []);
  const fresh = { key, at: Date.now(), samples: all.slice(0, 8), profile: styleProfile(all) };
  await chrome.storage.local.set({ ollamaStyleSnap: fresh });
  return fresh;
}

async function callOllama(payload, settings) {
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const imgs = settings.ollamaVision && settings.ollamaImages ? payload.imgs || [] : [];
  // Model nhỏ chạy CPU: gửi ít câu mẫu / ví dụ hơn cho nhanh.
  // stablePrompt: phần system giữ y nguyên giữa các lần gọi, Ollama chỉ phải đọc lại phần bài mới.
  const st = payload.mode === "raw" ? null : await ollamaStyle(settings);
  const lite = { ...settings, stablePrompt: true, examples: (settings.examples || []).slice(0, 2), samples: st ? st.samples : [], profile: st ? st.profile : settings.profile };
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
        think: false, // model có suy nghĩ (Qwen 3.5, Gemma 4): tắt cho nhanh
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
            ? {
                ...OLLAMA_OPTS,
                num_predict: payload.length === "chuyện dài" ? 2400 : 1000,
                // Giữ 4096 như bình luận khi đủ chỗ (đổi num_ctx là Ollama phải nạp lại model), chỉ tăng khi prompt quá dài.
                num_ctx: payload.length === "chuyện dài" || (system.length + user.length) / 2.5 + 1000 > 3900 ? 8192 : OLLAMA_OPTS.num_ctx
              }
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
function tunedPrompt(post, author, imageDesc, own) {
  const p = String(post || "").replace(/\s+/g, " ").trim().slice(0, 600);
  const img = String(imageDesc || "").trim();
  if (own && own.onMyPost) {
    // Kiểu riêng cho "đáp lại bình luận dưới bài của tôi": model học cách làm chủ bài nói chuyện với người bình luận.
    const mp = String(own.myPost || "").replace(/\s+/g, " ").trim().slice(0, 400);
    return `Đáp lại bình luận dưới bài của tôi theo giọng của tôi.\nBài của tôi: ${mp || "(không rõ)"}\nNgười bình luận: ${author || "(không rõ)"}\nBình luận: ${p || "(không có chữ)"}${img ? `\nẢnh: ${img}` : ""}`;
  }
  return `Viết 1 bình luận trả lời bài X này theo giọng của tôi.\nTác giả: ${author || "(không rõ)"}\nBài: ${p || "(bài không có chữ)"}${img ? `\nẢnh: ${img}` : ""}`;
}
// Kiểu thứ ba cho model riêng: viết bài đăng theo phong cách page hay. "Ý mở đầu" là câu đầu của bài,
// model học cách từ một ý mở đầu viết thành cả bài theo nhịp, cách kể của page đó.
function fbPrompt(text) {
  const first = String(text).split(/(?<=[.!?…])\s+|\n+/)[0] || "";
  const hook = first.split(/\s+/).slice(0, 15).join(" ");
  return `Viết bài đăng mạng xã hội theo phong cách page viết hay.\nÝ mở đầu: ${hook}`;
}
// Chỉ bài đã được duyệt vào train (bấm "Đưa vào dữ liệu train" trong trang Dữ liệu bài viết).
function fbTrainLines(fbPosts) {
  return (fbPosts || [])
    .filter((p) => fbStatus(p) === "train" && p.train)
    .map((p) =>
      JSON.stringify({
        messages: [
          { role: "user", content: p.train.user },
          { role: "assistant", content: fbClean(p.train.assistant) } // làm sạch lại lúc xuất (bài cũ còn dính chữ "Ẩn bớt" của nút Facebook)
        ]
      })
    );
}
// Dữ liệu huấn luyện: mỗi dòng một cặp bài -> câu bạn đã đăng (định dạng JSONL).
function trainLines(history) {
  return (history || [])
    .filter((h) => h.reply && String(h.reply).trim() && (String(h.post || "").trim() || h.imageDesc))
    .map((h) =>
      JSON.stringify({
        messages: [
          { role: "user", content: tunedPrompt(h.post, h.author, h.imageDesc, h) },
          { role: "assistant", content: String(h.reply).trim() }
        ]
      })
    );
}

// ---------- Mô tả ảnh cho model riêng (xcs- không xem được ảnh) ----------
// Một model xem được ảnh viết 1 câu mô tả, model riêng đọc câu đó cùng chữ của bài.
// Câu mô tả được nhớ lại (theo link ảnh) và lưu kèm câu trả lời để lần huấn luyện sau model học cả phản ứng với ảnh.
const DESC_PROMPT =
  "Mô tả ảnh bằng MỘT câu tiếng Việt ngắn (tối đa 25 từ): trong ảnh có gì (người, vật, món ăn, con vật, nơi chốn, chữ viết trong ảnh, màu sắc, không khí). Chỉ mô tả, không bình luận, không mở đầu bằng \"Ảnh\" hay \"Bức ảnh\".";
const imgKey = (urls) =>
  (urls || [])
    .slice(0, 4)
    .map((u) => {
      try {
        const x = new URL(u);
        return x.origin + x.pathname;
      } catch (_) {
        return String(u || "");
      }
    })
    .join("|");
const descMem = new Map();
async function cachedDesc(urls) {
  const key = imgKey(urls);
  if (!key) return "";
  if (descMem.has(key)) return descMem.get(key);
  const { imgDesc = {} } = await chrome.storage.local.get({ imgDesc: {} });
  return (imgDesc[key] && imgDesc[key].d) || "";
}
async function rememberDesc(urls, d) {
  const key = imgKey(urls);
  descMem.set(key, d);
  const { imgDesc = {} } = await chrome.storage.local.get({ imgDesc: {} });
  imgDesc[key] = { d, at: Date.now() };
  const keys = Object.keys(imgDesc);
  if (keys.length > 1500) keys.sort((a, b) => imgDesc[a].at - imgDesc[b].at).slice(0, keys.length - 1500).forEach((k) => delete imgDesc[k]);
  await chrome.storage.local.set({ imgDesc });
}
const cleanDesc = (t) =>
  String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\s+/g, " ").replace(/^["“']|["”']$/g, "").trim().slice(0, 300);
async function describeGroq(imgs, settings) {
  if (!settings.groqKey) return "";
  const vis = settings.groqVisionModels || [];
  const model = groqSeesImages(settings.groqModel, settings)
    ? settings.groqModel
    : vis.find((m) => /scout|maverick/i.test(m)) || vis[0] || "meta-llama/llama-4-scout-17b-16e-instruct";
  if (await getCooldown(`groq:${model}`)) return "";
  const req = {
    model,
    max_tokens: 120,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: DESC_PROMPT }, ...imgs.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))]
      }
    ]
  };
  if (/qwen3/i.test(model)) req.reasoning_effort = "none";
  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", authorization: `Bearer ${settings.groqKey}` },
    body: JSON.stringify(req)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Groq HTTP ${res.status}`);
  return cleanDesc(data.choices?.[0]?.message?.content);
}
async function describeOllama(imgs, settings) {
  const list = (settings.ollamaModelList || []).filter((m) => m && m.vision && !TUNED_RE.test(m.id || ""));
  const model = (list.find((m) => /^gemma3:4b/.test(m.id)) || list[0] || {}).id;
  if (!model) return "";
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(90000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: OLLAMA_KEEP,
      messages: [{ role: "user", content: DESC_PROMPT, images: imgs.map((im) => im.data) }],
      options: { temperature: 0.3, num_predict: 80, num_ctx: OLLAMA_OPTS.num_ctx }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ollama HTTP ${res.status}`);
  return cleanDesc(data.message?.content);
}
// local: cho phép dùng model trên máy khi Groq không được (chậm hơn, phải đổi model).
async function describeImages(urls, settings, { local = true } = {}) {
  urls = (urls || []).filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)).slice(0, 4);
  if (!urls.length) return "";
  const hit = await cachedDesc(urls);
  if (hit) return hit;
  const imgs = await loadImages(urls);
  if (!imgs.length) return "";
  let d = "";
  try {
    d = await describeGroq(imgs, settings);
  } catch (e) {
    console.warn("[X Gợi Ý] Groq không mô tả được ảnh:", e.message);
  }
  if (!d && local) {
    try {
      d = await describeOllama(imgs, settings);
    } catch (e) {
      console.warn("[X Gợi Ý] Ollama không mô tả được ảnh:", e.message);
    }
  }
  if (d) await rememberDesc(urls, d);
  return d;
}

function ollamaBaseModel(s) {
  const ids = (s.ollamaModelList || []).map((m) => m.id || m.name || m).filter((id) => typeof id === "string" && !TUNED_RE.test(id));
  return ids.find((id) => /^gemma3:4b/.test(id)) || ids[0] || "";
}

// ---------- Prompt dạng JSON để dán sang AI khác (ChatGPT, Gemini web...) ----------
// Giống hệt prompt extension gửi cho AI trên mạng: cùng quy tắc, cùng câu mẫu giọng bạn, cùng lựa chọn.
const POST_PARAM_KEYS = ["persona", "style", "topic", "place", "when", "mood", "tone", "goal", "hook", "strategy", "cta", "length", "lang", "image"];
async function buildPromptJson(msg) {
  const settings = await getSettings();
  const isPost = msg.mode === "post";
  const { history = [] } = settings.learn ? await chrome.storage.local.get({ history: [] }) : {};
  if (settings.learn && !isPost) settings.examples = pickExamples(history, msg.text, 4, msg.onMyPost);
  if (isPost) settings.pastPosts = (await chrome.storage.local.get({ postHistory: [] })).postHistory;
  if (isPost) settings.stylePosts = await stylePostsFor(msg);
  settings.samples = styleSamples(settings, settings.learn ? history : []);
  settings.profile = styleProfile(settings.samples);
  settings.count = Math.min(5, Math.max(3, Number(settings.count) || 4));
  const images = (msg.images || []).map((u) => bigImg(u).url);
  const imageDesc = isPost ? "" : await cachedDesc(msg.images);
  // Ảnh: đưa link trong "images" (AI khác mở link, hoặc bạn đính kèm ảnh) nên dặn AI là có ảnh để xem.
  const { system, user } = buildPrompt({ ...msg, settings, imageCount: isPost ? 0 : images.length });
  const lines = (t) => String(t || "").split("\n").map((x) => x.trimEnd()).filter((x, i, a) => x || (a[i - 1] && a[i - 1].trim()));
  const params = msg.fbStyle
    ? { mode: "Phong cách page Facebook (bỏ qua mọi lựa chọn khác)" }
    : isPost
    ? Object.fromEntries(POST_PARAM_KEYS.map((k) => [k, msg[k]]).filter(([, v]) => (Array.isArray(v) ? v.length : v)))
    : { author: msg.author || "", post: msg.text || "", has_media: !!msg.hasMedia };
  if (msg.extraHint) params.extra_request = msg.extraHint;
  params.count = settings.count;
  params.language = isPost ? params.lang || "tiếng Việt" : settings.language;
  if (!isPost) params.tone = settings.tone;
  return {
    task: isPost ? "Viết gợi ý bài đăng X (Twitter)" : "Viết gợi ý bình luận trả lời một bài X (Twitter)",
    how_to_use: isPost
      ? "Làm theo system_instructions như lời dặn hệ thống, dùng user_message làm yêu cầu. Chỉ trả về chữ của các bài viết theo output_format."
      : "Làm theo system_instructions như lời dặn hệ thống, dùng user_message làm yêu cầu. Trả về đúng JSON mà system_instructions yêu cầu." +
        (images.length ? " Nếu xem được ảnh thì mở các link trong images (hoặc người dùng sẽ đính kèm ảnh)." : ""),
    params,
    ...(images.length ? { images } : {}),
    ...(imageDesc ? { image_description: imageDesc } : {}),
    // Bài đăng dán sang AI chat: bỏ phần "chỉ trả JSON" + ảnh (dành cho extension), chỉ xin chữ của bài.
    system_instructions: isPost
      ? lines(system).filter((l) => !/^(Chỉ trả về JSON|Trong đó "context"|"images":|Ví dụ: "[^"]*\|)/.test(l))
      : lines(system),
    ...(isPost
      ? {
          output_format: [
            `Chỉ trả về đúng ${settings.count} bài viết, sẵn để copy đăng lên X.`,
            'Giữa hai bài là một dòng chỉ có "---".',
            "Không đánh số, không tiêu đề, không ngoặc kép, không mô tả ảnh, không giải thích, không JSON, không câu hỏi lại người dùng.",
            'Nếu người dùng nhắn "viết thêm" thì viết thêm bài mới khác hẳn các bài trước, cùng yêu cầu và cùng cách trình bày.'
          ]
        }
      : {}),
    user_message: lines(user)
  };
}

async function callOllamaTuned(payload, settings) {
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const content = tunedPrompt(payload.text, payload.author, payload.imageDesc, payload);
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
          think: false, // model có suy nghĩ (Qwen 3.5, Gemma 4): tắt cho nhanh
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
  out.context = "model riêng đã học giọng bạn" + (payload.imageDesc ? ` · ảnh: ${payload.imageDesc}` : "");
  return out;
}

// Chế độ "Phong cách page Facebook" với model riêng (xcs-): dùng đúng định dạng lúc huấn luyện
// ("Viết bài đăng... Ý mở đầu: ..."). Ý mở đầu lấy từ ô "Thêm ý"; để trống thì bốc ngẫu nhiên vài câu mở.
const FB_HOOKS = [
  "Người trưởng thành là người",
  "Tiền bạc không mua được",
  "Có những lúc ta phải học cách",
  "Đừng bao giờ so sánh mình với",
  "Sống tử tế không có nghĩa là",
  "Người càng giỏi thì càng",
  "Hạnh phúc đôi khi chỉ là",
  "Muốn giữ một mối quan hệ lâu dài",
  "Thời gian là thứ công bằng nhất",
  "Cha mẹ không cần con cái giàu",
  "Thành công không đến từ may mắn",
  "Im lặng đôi khi là câu trả lời",
  "Người khôn ngoan không tranh cãi",
  "Tuổi trẻ chỉ có một lần",
  "Đọc sách không làm bạn giàu ngay",
  "Ai rồi cũng phải học cách buông bỏ",
  "Lòng tốt cũng cần có giới hạn",
  "Bản lĩnh của một người thể hiện ở",
  // Chuyện thường ngày ai cũng gặp: dễ được hiển thị rộng trên X
  "Lương về được ba ngày thì",
  "Hồi nhỏ mình cứ nghĩ",
  "Đi làm mấy năm mới hiểu",
  "Cuối tuần chỉ muốn",
  "Có một kiểu mệt mà ngủ bao nhiêu cũng không hết",
  "Điều mình tiếc nhất tuổi 20 là"
];
function shuffled(a) {
  return a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
}
// Gọt bài đăng (chuyển từ phong cách page Facebook) cho hợp X: bỏ hashtag, câu xin tương tác,
// câu hỏi gượng ép ở cuối; tách đoạn dài thành đoạn 1–2 câu cho dễ đọc lướt.
const BAIT_RE =
  /^\W{0,4}(hãy\s+)?(like|share|chia sẻ|comment|cmt|bình luận|tag|thả tim|follow|theo dõi|lưu lại|gõ\s*["“]?\d)\b.{0,80}(nếu|để|ngay|cho (bạn|người)|bên dưới|nhé|nha|kẻo)/i;
const FORCED_Q_RE = /^\W{0,4}(còn )?(các )?bạn (nghĩ|thấy) (sao|thế nào)|^\W{0,4}bạn có (đồng ý|đồng tình|như vậy|giống mình)|^\W{0,4}còn (các )?bạn( thì)? (sao|thế nào)/i;
function forX(text) {
  const src = String(text || "");
  let lines = src
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1") // hashtag
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""));
  lines = lines.filter((l) => !(l.trim().length < 120 && BAIT_RE.test(l.trim())));
  // Câu hỏi gượng ép nằm riêng ở dòng cuối
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.length < 70 && /\?\s*\W*$/.test(l) && FORCED_Q_RE.test(l)) lines.splice(i, 1);
    break;
  }
  const paras = lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paras) {
    const sents = p.match(/[^.!?…\n]+[.!?…]+["”']?|[^.!?…\n]+$/g) || [p];
    if (p.includes("\n") || p.length <= 220 || sents.length <= 2) {
      out.push(p);
      continue;
    }
    for (let i = 0; i < sents.length; i += 2) out.push(sents.slice(i, i + 2).join(" ").replace(/\s+/g, " ").trim());
  }
  const res = out.join("\n\n").trim();
  return res.length >= 15 ? res : src.trim();
}
// Model nhỏ đôi khi viết lan man không dừng: bỏ chữ nút Facebook, cắt ở cuối câu, tối đa ~1200 ký tự.
function tidyFbPost(t, cut) {
  let s = fbClean(String(t || "").replace(/<end_of_turn>[\s\S]*$/, ""));
  if (s.length > 1200) {
    const paras = s.split(/\n\n+/);
    let acc = "";
    for (const p of paras) {
      if (acc && (acc + "\n\n" + p).length > 1200) break;
      acc = acc ? acc + "\n\n" + p : p;
    }
    s = acc.length > 1200 ? acc.slice(0, 1200) : acc;
    cut = true;
  }
  if (cut) {
    const end = Math.max(s.lastIndexOf("."), s.lastIndexOf("!"), s.lastIndexOf("?"), s.lastIndexOf("…"));
    if (end > s.length * 0.4) s = s.slice(0, end + 1);
  }
  return s.trim();
}
async function callOllamaFbPost(payload, settings) {
  const base = (settings.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, "");
  const idea = String(payload.extraHint || "").trim();
  const hooks = idea ? Array(settings.count).fill(idea) : shuffled(FB_HOOKS).slice(0, settings.count);
  const out = [];
  for (let i = 0; i < hooks.length; i++) {
    let res;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: "POST",
        signal: settings.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages: [{ role: "user", content: `Viết bài đăng mạng xã hội theo phong cách page viết hay.\nÝ mở đầu: ${hooks[i]}` }],
          stream: false,
          keep_alive: OLLAMA_KEEP,
          options: { ...TUNED_OPTS, num_predict: 600, num_ctx: 2048, repeat_penalty: 1.15, seed: Math.floor(Math.random() * 1e9) }
        })
      });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Đã huỷ vì bạn mở gợi ý bài khác");
      throw new Error("Không kết nối được Ollama. Kiểm tra Ollama đang chạy");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const t = tidyFbPost(data.message?.content, data.done_reason === "length");
    if (t.length >= 15 && !out.includes(t)) out.push(t);
  }
  if (!out.length) throw new Error("Model riêng không viết được bài.");
  out.context = `model riêng đã học từ page · ý mở đầu: ${idea || "ngẫu nhiên"}`;
  out.images = [];
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
  if (id === "openai") return `openai:${settings.openaiModel || DEFAULTS.openaiModel}`;
  if (id === "gemini") return `gemini:${settings.geminiModel || DEFAULTS.geminiModel}`;
  return id;
}

const PROMPT_TOKENS = 3500; // ước lượng token mỗi lần bấm Gợi ý (chữ + phần dành cho câu trả lời)

// ---------- Chọn nhà cung cấp và gọi ----------
const PROVIDER_INFO = {
  gemini: { name: "Gemini", key: (s) => s.geminiKey, model: (s) => s.geminiModel, call: (p, s) => callGemini(p, s) },
  groq: { name: "Groq", key: (s) => s.groqKey, model: (s) => s.groqModel, call: (p, s) => callGroq(p, s) },
  openai: { name: "ChatGPT", key: (s) => s.openaiKey, model: (s) => s.openaiModel || DEFAULTS.openaiModel, call: (p, s) => callOpenAI(p, s) },
  claude: { name: "Claude", key: (s) => s.apiKey, model: (s) => s.model, call: (p, s) => callClaude(p, s) },
  ollama: {
    name: "Ollama",
    key: () => "local",
    // Model thật sự dùng: model riêng (xcs-) chỉ viết câu trả lời, bài đăng / Studio dùng model thường.
    model: (s, p) =>
      isTuned(s) && p && !(p.mode === "post" && p.fbStyle) && (p.mode === "post" || p.mode === "raw" || (p.onMyPost && !s.ownTrained))
        ? ollamaBaseModel(s) || s.ollamaModel
        : s.ollamaModel,
    call: (p, s) => {
      if (!isTuned(s)) return callOllama(p, s);
      // Model riêng đã học bài page Facebook: chế độ "Phong cách page Facebook" gọi thẳng model riêng.
      if (p.mode === "post" && p.fbStyle) return callOllamaFbPost(p, s);
      // Model riêng chưa học kiểu "đáp bình luận dưới bài của mình": dùng model thường với prompt đầy đủ (có ví dụ giọng chủ bài).
      if (p.onMyPost && !s.ownTrained && ollamaBaseModel(s)) return callOllama(p, { ...s, ollamaModel: ollamaBaseModel(s) });
      if (p.mode !== "post" && p.mode !== "raw") {
        return (async () => {
          const imageDesc = s.sendImages ? await describeImages(p.images, s) : "";
          return callOllamaTuned({ ...p, imageDesc }, s);
        })();
      }
      // Model riêng (xcs-) chỉ học viết câu trả lời ngắn: bài đăng / Content Studio dùng model thường trên máy.
      const base = ollamaBaseModel(s);
      if (!base) throw new Error("Model riêng chỉ viết được câu trả lời. Tải thêm một model thường (vd: ollama pull gemma3:4b) để viết bài.");
      return callOllama(p, { ...s, ollamaModel: base });
    }
  }
};

function seesImages(id, settings) {
  if (!settings.sendImages) return false;
  if (id === "groq") return groqSeesImages(settings.groqModel, settings);
  if (id === "openai") return openaiSeesImages(settings.openaiModel || DEFAULTS.openaiModel);
  if (id === "ollama") return !isTuned(settings) && !!(settings.ollamaVision && settings.ollamaImages);
  return true;
}

async function runProvider(id, msg, settings) {
  const p = PROVIDER_INFO[id];
  const imgs = seesImages(id, settings) ? await loadImages(msg.images) : [];
  const suggestions = await p.call({ ...msg, imgs }, settings);
  return { provider: p.name, model: p.model(settings, msg) || "", imageCount: imgs.length, suggestions, context: suggestions.context || "", emojis: suggestions.emojis || [], images: suggestions.images || [] };
}

// Chế độ Kết hợp: bài "quen" (đã có đủ câu bạn từng đăng cho bài giống vậy) thì để model trên máy viết theo các ví dụ đó.
// Bài "lạ" thì hỏi model trên mạng (viết hay hơn). Câu bạn đăng sau đó được lưu lại, lần sau bài giống vậy sẽ thành "quen".
const OWN_TRAINED_MIN = 150; // số câu "đáp bình luận dưới bài của mình" cần có trước khi tin model riêng (sau khi huấn luyện lại)
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

// ---------- Tạo bài viết cho X từ một bài Facebook hay ----------
// Cùng giọng, cùng hướng ý với bài gốc nhưng viết lại bằng chữ mới, ngắn gọn cho X, có emoji.
const FBX_GOALS = {
  impress: { label: "Thêm nhiều lượt hiển thị", emoji: "🔥", rule: "Câu mở đầu thật mạnh, chạm đúng điều rất nhiều người đang nghĩ mà chưa nói ra. Câu ngắn, nhịp nhanh, đọc lướt 2 giây là hiểu." },
  talk: { label: "Bắt đầu cuộc trò chuyện", emoji: "💬", rule: "Kết bằng MỘT câu hỏi mở thật, dễ trả lời, ai cũng có trải nghiệm riêng để kể. Không hỏi chung chung kiểu 'bạn nghĩ sao?'." },
  think: { label: "Khiến người ta suy nghĩ", emoji: "🤔", rule: "Lật lại một điều quen thuộc, nói ra một sự thật giản dị mà sâu. Câu cuối để lại khoảng lặng cho người đọc tự ngẫm." },
  share: { label: "Khiến người ta đăng lại", emoji: "🔁", rule: "Viết thành câu 'đáng trích dẫn' mà người đọc muốn đăng lại để nói thay lòng mình: đúng với số đông, ấm áp hoặc tỉnh táo, không gây tranh cãi." },
  stop: { label: "Không thể bỏ qua", emoji: "⚡", rule: "Câu đầu gây bất ngờ hoặc nói thẳng một điều hơi trái tai nhưng đúng. Dùng tương phản (không phải A, mà là B) hoặc một hình ảnh đời thường rất cụ thể." }
};
const FBX_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "object",
      properties: { main_idea: { type: "string" }, tone: { type: "string" }, audience: { type: "string" }, hook: { type: "string" } },
      required: ["main_idea", "tone", "audience", "hook"]
    },
    posts: {
      type: "array",
      items: { type: "object", properties: { goal: { type: "string" }, text: { type: "string" }, why: { type: "string" } }, required: ["goal", "text", "why"] },
      minItems: 1
    }
  },
  required: ["analysis", "posts"]
};
// Độ dài theo cách X đếm (gần đúng): emoji tính 2, ký tự khác tính 1.
const xLen = (t) => [...String(t)].reduce((n, c) => n + (EMOJI_RE.test(c) ? 2 : 1), 0);
// Tỉ lệ cụm 4 chữ trùng với bài gốc: cao = chép gần nguyên văn.
function copyRatio(a, src) {
  const grams = (t) => {
    const w = String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
    const s = new Set();
    for (let i = 0; i + 3 < w.length; i++) s.add(w.slice(i, i + 4).join(" "));
    return s;
  };
  const g = grams(a);
  if (!g.size) return 0;
  const s = grams(src);
  let n = 0;
  g.forEach((x) => s.has(x) && n++);
  return n / g.size;
}

function buildFbxPrompt(msg, pastPosts) {
  const goals = (msg.goals || []).filter((g) => FBX_GOALS[g]);
  if (!goals.length) goals.push("think");
  const per = msg.only ? 1 : goals.length === 1 ? 3 : goals.length === 2 ? 2 : 1;
  const mine = (pastPosts || []).slice(-4).map((p) => `- ${String(p.text).replace(/\s+/g, " ").slice(0, 280)}`);
  const system = [
    "Bạn là người viết nội dung cho X (Twitter) rất giỏi, viết tiếng Việt tự nhiên như người thật.",
    "Bạn nhận một bài Facebook hay. Việc của bạn: viết bài MỚI cho X, giữ đúng giọng và đúng hướng ý của bài gốc, nhưng bằng câu chữ của riêng mình.",
    "",
    "BƯỚC 1, phân tích bài gốc: ý chính là gì, giọng ra sao (ấm áp, tỉnh táo, thẳng thắn, hài hước...), viết cho ai, điều gì khiến bài gốc hay.",
    "BƯỚC 2, viết bài cho X theo mục tiêu được giao.",
    "",
    "QUY TẮC:",
    "1. KHÔNG chép: không được trùng quá 4 chữ liền với bài gốc. Cùng ý, khác lời.",
    "2. Đơn giản, dễ hiểu ngay, nhưng KHÔNG nông cạn: phải có một ý đáng giá, đúng và có ích với hầu hết mọi người.",
    "3. Ngắn: tối đa 240 ký tự. 1-4 câu, có thể xuống dòng giữa các câu cho dễ đọc.",
    "4. Có emoji: 1-3 emoji đặt đúng chỗ, hợp cảm xúc của câu (không rải emoji vô nghĩa, không đặt emoji giữa từ).",
    "5. Không hashtag (tối đa 1 nếu thật cần), không link, không gắn tên ai, không nhắc tới Facebook hay bài gốc.",
    "6. Không bịa tin tức, số liệu, lời khuyên y khoa; không chính trị, không công kích ai.",
    "7. Mỗi bài một cách mở đầu khác nhau.",
    "",
    'Chỉ trả về JSON đúng dạng: {"analysis":{"main_idea":"...","tone":"...","audience":"...","hook":"..."},"posts":[{"goal":"<mã mục tiêu>","text":"<bài cho X>","why":"<1 câu: vì sao bài này đạt mục tiêu>"}]}',
    "Các trường trong analysis viết ngắn (dưới 20 chữ mỗi trường)."
  ].join("\n");
  const user = [
    msg.page ? `Page đăng bài gốc: ${msg.page}` : "",
    "BÀI GỐC (Facebook):",
    String(msg.text || "").slice(0, 3000),
    "",
    "MỤC TIÊU (viết đúng số bài cho mỗi mục tiêu, trường goal ghi đúng mã):",
    ...goals.map((g) => `- ${g} (${FBX_GOALS[g].label}): ${per} bài. ${FBX_GOALS[g].rule}`),
    mine.length ? ["", "Vài bài X tôi từng đăng (học giọng của tôi, không chép):", ...mine].join("\n") : "",
    msg.hint ? `\nGhi chú thêm của tôi: ${String(msg.hint).slice(0, 300)}` : "",
    msg.avoid?.length ? `\nĐã có các bài dưới đây, viết KHÁC hẳn (khác mở đầu, khác cách nói):\n${msg.avoid.map((x) => `- ${String(x).slice(0, 280)}`).join("\n")}` : ""
  ].filter(Boolean).join("\n");
  return { system, user, goals };
}

function fbxOrder(settings) {
  const clouds = ["groq", "gemini", "openai", "claude"].filter((x) => PROVIDER_INFO[x].key(settings));
  const main = settings.provider === "hybrid" ? settings.hybridCloud || "groq" : settings.provider;
  const order = PROVIDER_INFO[main] && main !== "ollama" && PROVIDER_INFO[main].key(settings) ? [main] : [];
  order.push(...clouds.filter((x) => !order.includes(x)));
  // Phân tích + viết bài mới là việc khó: ưu tiên AI trên mạng, Ollama trên máy làm dự phòng (hoặc làm chính nếu chọn Ollama).
  if (settings.provider === "ollama") return ["ollama", ...order];
  if (settings.provider === "hybrid" || (settings.ollamaModelList || []).length) order.push("ollama");
  return order;
}

const fbxRunning = new Map(); // tab -> AbortController
async function makeFbx(msg, tabId) {
  if (fbxRunning.has(tabId)) fbxRunning.get(tabId).abort();
  const ctrl = new AbortController();
  fbxRunning.set(tabId, ctrl);
  const progress = (text) => tabId != null && chrome.tabs.sendMessage(tabId, { type: "fbx-progress", reqId: msg.reqId, text }).catch(() => {});
  try {
    const settings = await getSettings();
    settings.signal = ctrl.signal;
    const { postHistory = [] } = await chrome.storage.local.get({ postHistory: [] });
    const { system, user, goals } = buildFbxPrompt(msg, postHistory);
    const order = fbxOrder(settings);
    if (!order.length) return { error: "Chưa có AI nào dùng được. Vào Cài đặt → 🤖 AI để thêm key (Groq miễn phí) hoặc bật Ollama." };
    const errors = [];
    for (const id of order) {
      if (ctrl.signal.aborted) return { cancelled: true };
      const nm = PROVIDER_INFO[id].name;
      const cd = await getCooldown(cooldownKey(id, settings));
      if (cd) {
        errors.push(`${nm}: ${cd.reason}`);
        continue;
      }
      progress(`${errors.length ? `${errors[errors.length - 1]} → ` : ""}Đang nhờ ${nm}${id === "ollama" ? " trên máy (khoảng 30-60 giây)" : ""} phân tích và viết`);
      try {
        const r = await PROVIDER_INFO[id].call({ mode: "raw", system, user, maxTokens: 1500, schema: FBX_SCHEMA }, settings);
        if (ctrl.signal.aborted) return { cancelled: true };
        const j = parseJsonLoose(r.raw);
        const posts = (j.posts || [])
          .map((p) => {
            let text = String(p.text || "").replace(/^["“”']+|["“”']+$/g, "").replace(/\n{3,}/g, "\n\n").trim();
            const goal = FBX_GOALS[p.goal] ? p.goal : msg.only || goals[0];
            if (text && !EMOJI_RE.test(text)) text += ` ${FBX_GOALS[goal].emoji}`;
            return { goal, text, why: String(p.why || "").trim(), len: xLen(text), copied: copyRatio(text, msg.text) > 0.35 };
          })
          .filter((p) => p.text.length >= 15);
        if (!posts.length) throw new Error("AI trả về bài rỗng");
        return { analysis: j.analysis || {}, posts, provider: nm, model: PROVIDER_INFO[id].model(settings, { mode: "raw" }) || "" };
      } catch (e) {
        if (ctrl.signal.aborted) return { cancelled: true };
        errors.push(`${nm}: ${e.message}`);
      }
    }
    return { error: `Không viết được (${errors.join(" | ")})` };
  } finally {
    if (fbxRunning.get(tabId) === ctrl) fbxRunning.delete(tabId);
  }
}

// Bài bạn chọn (chép / đăng lên X): lưu lại cùng bài gốc, sau này dùng để dạy model.
async function saveFbxPick(msg) {
  const { fbxPicks = [] } = await chrome.storage.local.get({ fbxPicks: [] });
  fbxPicks.push({
    ts: Date.now(),
    page: String(msg.page || ""),
    url: String(msg.url || ""),
    source: String(msg.source || "").slice(0, 5000),
    goal: String(msg.goal || ""),
    suggested: String(msg.suggested || "").slice(0, 1000),
    text: String(msg.text || "").slice(0, 1000),
    action: msg.action === "post" ? "post" : "copy"
  });
  await chrome.storage.local.set({ fbxPicks: fbxPicks.slice(-1000) });
}

// Mỗi tab chỉ chạy một lần gợi ý: mở bài khác thì huỷ lần cũ.
const running = new Map();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "xcs-build-prompt") {
    buildPromptJson(msg)
      .then((prompt) => sendResponse({ prompt }))
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }
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
      if (!isPost && msg.onMyPost && !msg.myPost && msg.id) {
        progress("Đang đọc bài gốc của bạn");
        msg.myPost = await parentText(msg.id);
      }
      const { history = [] } = settings.learn ? await chrome.storage.local.get({ history: [] }) : {};
      if (settings.learn && !isPost) settings.examples = pickExamples(history, msg.text, 4, msg.onMyPost);
      if (isPost) settings.pastPosts = (await chrome.storage.local.get({ postHistory: [] })).postHistory;
      if (isPost) settings.stylePosts = await stylePostsFor(msg);
      settings.ownTrained = (history || []).filter((h) => h.onMyPost).length >= OWN_TRAINED_MIN;
      settings.samples = styleSamples(settings, settings.learn ? history : []);
      settings.profile = styleProfile(settings.samples);
      const count = Math.min(5, Math.max(3, Number(settings.count) || 4));
      settings.count = count;
      if (msg.quick && !isPost && msg.onMyPost) {
        settings.emojiTail = "auto";
        msg.extraHint = [
          msg.extraHint,
          questionOf(msg.text)
            ? "Người ta đang hỏi: trả lời thật câu hỏi, 3-12 chữ, giọng nói chuyện thân mật"
            : "Đáp kiểu chủ bài: 1-4 chữ, dạ vâng / ok / hihi / được thui, không câu dài"
        ].filter(Boolean).join(". ");
      } else if (msg.quick && !isPost) {
        settings.emojiTail = "auto"; // xin AI chọn emoji cho từng câu (dải gợi ý nhanh luôn có emoji)
        msg.extraHint = [
          msg.extraHint,
          "Viết như người thật gõ vội trên điện thoại: ngắn (3-15 chữ), tự nhiên, thân mật, có thể viết thường, từ lóng nhẹ. Mỗi câu một ý khác nhau",
          "Câu nào cũng phải đáp đúng vào điều người kia vừa nói, không nói về ảnh nếu bài không có ảnh"
        ].filter(Boolean).join(". ");
      }
      // Câu mẫu có sẵn chỉ hợp với bình luận; bài đăng thì không có câu mẫu.
      const fallback = () => {
        if (isPost) return [];
        if (msg.onMyPost) {
          const pick = ownPool(msg.text).slice(0, count);
          return msg.quick ? pick.map((x, i) => quickEmoji(x, i, null, true)) : pick;
        }
        const t = self.XCSTemplates.templateSuggestions({ text: msg.text, hasMedia: msg.hasMedia, count, language: settings.language });
        return msg.quick ? t.map((x, i) => quickEmoji(x, i)) : t;
      };
      const noteTail = isPost ? "" : " Đang dùng câu mẫu.";

      // Thứ tự thử các nhà cung cấp.
      let order;
      let route = "";
      if (settings.provider === "hybrid") {
        const cloud = settings.hybridCloud || "groq";
        const hasCloudKey = !!PROVIDER_INFO[cloud].key(settings);
        const similar = settings.learn && !isPost ? countSimilar(history || [], msg.text) : 0;
        const ownLearned = (history || []).filter((h) => h.onMyPost).length;
        if (!hasCloudKey) {
          order = ["ollama"];
          route = `chưa có ${PROVIDER_INFO[cloud].name} key nên dùng máy`;
        } else if (isPost && msg.fbStyle && isTuned(settings)) {
          order = ["ollama", cloud];
          route = "phong cách page Facebook: dùng model riêng đã học từ page";
        } else if (msg.onMyPost && isTuned(settings) && ownLearned < OWN_TRAINED_MIN) {
          // Model riêng chưa được dạy kiểu "đáp bình luận dưới bài của mình": để bên trên mạng viết.
          order = [cloud, "ollama"];
          route = `bình luận dưới bài của bạn (mới có ${ownLearned} câu mẫu, chưa đủ để model riêng học)`;
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
        order = [id, ...["groq", "gemini", "openai", "claude"].filter((x) => x !== id && PROVIDER_INFO[x].key(settings))];
        // Model riêng chưa học kiểu "đáp bình luận dưới bài của mình": có key bên trên mạng thì để bên đó viết trước.
        if (id === "ollama" && msg.onMyPost && isTuned(settings) && order.length > 1 &&
            (history || []).filter((h) => h.onMyPost).length < OWN_TRAINED_MIN) order = [...order.slice(1), "ollama"];
        // Đã cài Ollama (có model trong danh sách) thì dùng làm dự phòng cuối cùng.
        if (id !== "ollama" && settings.ollamaFallback && (settings.ollamaModelList || []).length) order.push("ollama");
        // Phong cách page Facebook: đã có model riêng (xcs-) thì để nó viết trước, bên trên mạng làm dự phòng.
        if (isPost && msg.fbStyle && isTuned(settings) && (settings.ollamaModelList || []).length) order = ["ollama", ...order.filter((x) => x !== "ollama")];
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
            if (msg.fbStyle) out = out.map(forX); // chuyển từ page Facebook sang X: gọt cho được hiển thị nhiều
            if (!out.length) throw new Error("Model trả về bài rỗng");
          } else out = r.suggestions.map((x) => applyStyle(x, settings.profile));
          if (!isPost && msg.onMyPost) out = shortOwnReplies(out, msg.text, count);
          if (settings.capitalize) out = out.map(capFirst);
          if (!isPost && msg.quick) out = out.map((x, i) => quickEmoji(x, i, r.emojis, msg.onMyPost));
          else if (!isPost) out = out.map((x, i) => addEmojiTail(x, i, r.emojis, settings));
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
  if (msg && msg.type === "fbx-make") {
    makeFbx(msg, _sender.tab?.id).then(sendResponse, (e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }
  if (msg && msg.type === "fbx-cancel") {
    const c = fbxRunning.get(_sender.tab?.id);
    if (c) c.abort();
    return false;
  }
  if (msg && msg.type === "fbx-pick") {
    saveFbxPick(msg).then(() => sendResponse({ ok: true }), () => sendResponse(null));
    return true;
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
  if (msg && msg.type === "fb-save-post") {
    saveFbPost(msg).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg && msg.type === "fb-download-video") {
    // Link MP4 của Facebook (fbcdn) đã ký sẵn, tải thẳng vào thư mục Downloads/facebook-video/.
    let ok = false;
    try {
      ok = /^https:\/\/[\w.-]+\.fbcdn\.net\//.test(new URL(msg.url).origin + "/");
    } catch (_) {}
    if (!ok) {
      sendResponse({ ok: false, error: "link không phải video Facebook" });
      return;
    }
    chrome.downloads
      // saveAs:false: không hỏi chỗ lưu (kể cả khi trình duyệt bật "hỏi nơi lưu mỗi tệp")
      .download({ url: msg.url, filename: msg.filename, conflictAction: "uniquify", saveAs: false })
      .then((id) => sendResponse({ ok: true, id }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === "fb-list") {
    chrome.storage.local.get({ fbPosts: [] }).then(({ fbPosts }) => sendResponse({ items: fbPosts }));
    return true;
  }
  if (msg && msg.type === "fb-dupcheck") {
    fbUpdate([], (list) => {
      fbDupCheck(list);
      return list;
    }).then(async () => {
      const { fbPosts = [] } = await chrome.storage.local.get({ fbPosts: [] });
      sendResponse({ dup: fbPosts.filter((p) => fbStatus(p) === "dup").length, fresh: fbPosts.filter((p) => fbStatus(p) === "new").length });
    });
    return true;
  }
  if (msg && msg.type === "fb-approve") {
    fbApprove(msg.ids, msg.edits).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg && msg.type === "fb-set-status") {
    fbUpdate(msg.ids, (list, want) =>
      list.map((p) => (want.has(p.id) ? { ...p, status: msg.status, ...(msg.status === "new" ? { train: undefined, dupOf: "", sim: 0 } : {}) } : p))
    ).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "fb-delete") {
    fbUpdate(msg.ids, (list, want) => list.filter((p) => !want.has(p.id))).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "fb-preview") {
    const clean = fbClean(msg.text).slice(0, 1500);
    sendResponse({ user: fbPrompt(clean), assistant: clean });
    return;
  }
  if (msg && msg.type === "fb-open-data") {
    chrome.tabs.create({ url: chrome.runtime.getURL("fbdata.html") });
    return;
  }
  if (msg && msg.type === "fb-stats") {
    chrome.storage.local.get({ fbPosts: [] }).then(({ fbPosts }) => {
      const by = {};
      fbPosts.forEach((p) => (by[p.page] = (by[p.page] || 0) + 1));
      const st = { new: 0, train: 0, dup: 0, skip: 0 };
      fbPosts.forEach((p) => st[fbStatus(p)]++);
      sendResponse({ total: fbPosts.length, by, st });
    });
    return true;
  }
  if (msg && msg.type === "fb-clear") {
    chrome.storage.local.set({ fbPosts: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === "xcs-train-data") {
    // scope: "all" (mặc định), "x" (chỉ trả lời trên X), "fb" (chỉ bài page Facebook), "count" (chỉ đếm).
    chrome.storage.local.get({ history: [], fbPosts: [], fbTrain: true }).then(({ history, fbPosts, fbTrain }) => {
      const scope = msg.scope || "all";
      const ownLines = trainLines((history || []).filter((h) => h.onMyPost));
      const replies = trainLines(history);
      const fbAll = fbTrainLines(fbPosts);
      const counts = {
        replies: replies.length - ownLines.length,
        own: ownLines.length,
        fb: fbAll.length,
        fbWaiting: (fbPosts || []).filter((p) => fbStatus(p) === "new").length
      };
      if (scope === "count") return sendResponse({ lines: [], counts });
      const x = scope === "fb" ? [] : replies;
      const fb = scope === "x" || (scope === "all" && !fbTrain) ? [] : fbAll;
      sendResponse({ lines: [...x, ...fb], counts: { ...counts, replies: x.length ? counts.replies : 0, own: x.length ? counts.own : 0, fb: fb.length } });
    });
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
