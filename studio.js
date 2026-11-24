// Trang Content Studio (spec v2.1): Tổng quan · Khám phá · Ý tưởng · Bài viết · Kiến thức cá nhân · Định hướng · Nguồn · AI & chi phí · Cài đặt.
// Mọi thay đổi đều nhờ nền (studio-core.js) ghi, để không giẫm lên việc đang chạy nền.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const send = (m) =>
  new Promise((res) => chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: "Không có phản hồi" })));
const fmtTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const same = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return same ? hm : `${hm} ${d.getDate()}/${d.getMonth() + 1}`;
};
const ago = (ts) => {
  if (!ts) return "chưa lấy";
  const m = Math.round((Date.now() - ts) / 60e3);
  return m < 1 ? "vừa xong" : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`;
};
function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 3600);
}
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const usd = (n) => (n ? `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}` : "$0");
const clone = (x) => JSON.parse(JSON.stringify(x));

const STATUS_VI = {
  New: "Mới", Saved: "Đã lưu", Dismissed: "Bỏ qua", Explored: "Đã nghĩ ý tưởng", Drafted: "Đã viết nháp",
  PendingReview: "Chờ duyệt", Approved: "Đã duyệt", Rejected: "Bỏ", Filled: "Đã điền vào X", Published: "Đã đăng",
  Running: "Đang chạy", Succeeded: "Xong", Failed: "Lỗi", Skipped: "Bỏ qua", Cancelled: "Đã huỷ",
  active: "Đang dùng", paused: "Tạm dừng", archived: "Lưu trữ", suggested: "AI gợi ý"
};
const ORIGIN_VI = { user: "Bạn nhập", imported: "Bạn nhập từ file", derived: "Rút từ bài đã duyệt", inferred: "Suy đoán", external: "Nguồn ngoài" };
const TRUSTED = ["user", "imported", "derived"];
const TASK_VI = { discover: "Tìm cơ hội", ideate: "Nghĩ ý tưởng", write: "Viết nháp", critique: "Phê bình", rewrite: "Viết lại", test: "Thử AI" };
const PROVIDERS = { groq: "Groq", gemini: "Gemini", openai: "ChatGPT", claude: "Claude", ollama: "Ollama (trên máy)" };
const badge = (s, label) => `<span class="badge ${esc(s)}">${esc(label || STATUS_VI[s] || s)}</span>`;
const ring = (n, title = "") => {
  const v = Number(n) || 0;
  const c = v >= 75 ? "var(--ok)" : v >= 50 ? "var(--accent)" : "#f5a623";
  return `<div class="score" style="--s:${v};--c:${c}" title="${esc(title)}"><span>${v}</span></div>`;
};
const dirChips = (names) => (names || []).map((n) => `<span class="ref">🧭 ${esc(n)}</span>`).join("");
const evChips = (ev) =>
  (ev || []).map((e) => `<span class="ref" title="${esc(e.reliability || "")}">${esc(e.ref || "")} ${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)} · ${esc(e.source || "")}</span>`).join("");

// ---------- Trạng thái ----------
let M = {}; // thông tin tĩnh từ nền: adapters, platforms, dims, formats...
const S = { profile: {}, config: {}, sources: {}, directions: [], knowledge: [], snaps: {}, sessions: [], opps: [], ideas: [], posts: [], jobs: [], feedback: [], usage: [] };
const KEYS = {
  studioProfile: "profile", studioConfig: "config", studioSources: "sources", studioDirections: "directions", studioKnowledge: "knowledge",
  studioSnapshots: "snaps", studioSessions: "sessions", studioOpportunities: "opps", studioIdeas: "ideas", studioPosts: "posts",
  studioJobs: "jobs", studioFeedback: "feedback", studioUsage: "usage"
};
const MERGED = new Set(["profile", "config", "sources", "directions"]); // cần gộp giá trị mặc định ở nền
let AIS = {}; // khoá / model / cooldown của các nhà cung cấp
let tab = "dash";
const UI = { sessionId: null, ideaStatus: "New", ideaDir: "", ideaCross: false, ideaSort: "score", ideaOpp: null, draftFor: null, postStatus: "PendingReview", postQ: "", postDir: "", postPlatform: "", postSaved: false, postIdea: null, knCat: "" };

async function refreshState() {
  const st = await send({ type: "studio-state" });
  if (!st.ok) return toast(`Lỗi: ${st.error}`);
  for (const k of ["profile", "config", "sources", "directions"]) S[k] = st[k];
  M = st;
}
async function loadAiInfo() {
  AIS = await chrome.storage.local.get({ provider: "gemini", groqKey: "", geminiKey: "", apiKey: "", openaiKey: "", openaiModel: "gpt-5-mini", groqModel: "", geminiModel: "", ollamaModel: "", model: "", ollamaModelList: [], cooldowns: {} });
  const has = Object.keys(PROVIDERS).filter((id) => providerReady(id));
  $("#aiInfo").textContent = has.length ? `AI: ${has.map((id) => PROVIDERS[id].split(" ")[0]).join(" → ")}` : "AI: chưa cấu hình";
}
const providerReady = (id) => (id === "groq" ? !!AIS.groqKey : id === "openai" ? !!AIS.openaiKey : id === "gemini" ? !!AIS.geminiKey : id === "claude" ? !!AIS.apiKey : (AIS.ollamaModelList || []).length > 0 || AIS.provider === "ollama");
const providerModel = (id) => ({ groq: AIS.groqModel, openai: AIS.openaiModel, gemini: AIS.geminiModel, claude: AIS.model, ollama: AIS.ollamaModel })[id] || "";

async function load() {
  await refreshState();
  const r = await chrome.storage.local.get(Object.keys(KEYS).filter((k) => !MERGED.has(KEYS[k])));
  for (const [k, v] of Object.entries(KEYS)) if (!MERGED.has(v)) S[v] = r[k] ?? (v === "snaps" ? {} : []);
  await loadAiInfo();
}

// Nền lưu gì thì vẽ lại. Đang gõ thì chờ gõ xong mới vẽ lại.
let editing = false;
let dirty = false;
document.addEventListener("focusin", (e) => (editing = !!e.target.closest("input, textarea, select")));
document.addEventListener("focusout", () => {
  editing = false;
  if (dirty) {
    dirty = false;
    setTimeout(() => !editing && render(), 0);
  }
});
let mergeT = null;
// Những phần dữ liệu đã đổi kể từ lần vẽ trước: mỗi tab chỉ vẽ lại khi phần của nó đổi (không làm mất chữ đang gõ dở).
const changedKeys = new Set();
const touched = (...ks) => ks.some((k) => changedKeys.has(k));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  let hit = false;
  let needMerge = false;
  for (const [k, v] of Object.entries(KEYS)) {
    if (!(k in ch)) continue;
    hit = true;
    changedKeys.add(v);
    if (MERGED.has(v)) needMerge = true;
    else S[v] = ch[k].newValue ?? (v === "snaps" ? {} : []);
  }
  if (Object.keys(ch).some((k) => k.startsWith("studioImg:"))) (hit = true), changedKeys.add("img");
  if (["groqKey", "geminiKey", "apiKey", "openaiKey", "cooldowns", "ollamaModelList", "provider"].some((k) => k in ch)) loadAiInfo();
  if (!hit) return;
  const go = () => {
    renderJobBanner();
    if (editing) dirty = true;
    else render();
  };
  if (needMerge) {
    clearTimeout(mergeT);
    mergeT = setTimeout(() => refreshState().then(go), 50);
  } else go();
});

// ---------- Điều hướng ----------
$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) showTab(b.dataset.tab);
});
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto-tab]");
  if (!g) return;
  e.preventDefault();
  if (g.dataset.idea) UI.postIdea = g.dataset.idea;
  if (g.dataset.opp) UI.ideaOpp = g.dataset.opp;
  if (g.dataset.session) UI.sessionId = g.dataset.session;
  if (g.dataset.status) {
    if (g.dataset.gotoTab === "ideas") UI.ideaStatus = g.dataset.status;
    if (g.dataset.gotoTab === "posts") UI.postStatus = g.dataset.status;
  }
  showTab(g.dataset.gotoTab);
});
function showTab(t) {
  tab = t;
  $$("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  $$("main > section").forEach((s) => (s.hidden = s.id !== `tab-${t}`));
  render(true);
  window.scrollTo({ top: 0 });
  try { localStorage.setItem("studioTab", t); } catch (_) {}
}

function render(force) {
  const setN = (id, n) => {
    $(id).hidden = !n;
    $(id).textContent = n;
  };
  setN("#nOpps", S.opps.filter((o) => o.status === "New").length);
  setN("#nIdeas", S.ideas.filter((i) => i.status === "New").length);
  setN("#nPosts", S.posts.filter((p) => p.status === "PendingReview").length);
  setN("#nDirs", S.directions.filter((d) => d.status === "suggested").length);
  const r = { dash: renderDash, discover: renderDiscover, ideas: renderIdeas, posts: renderPosts, knowledge: renderKnowledge, directions: renderDirections, sources: renderSources, ai: renderAi, settings: renderSettings }[tab];
  if (r) r(force || changedKeys.size === 0);
  changedKeys.clear();
  renderJobBanner();
}

// ---------- Thanh tiến trình ----------
function renderJobBanner() {
  const el = $("#jobBanner");
  const j = S.jobs[0];
  const fresh = j && Date.now() - (j.completed_at || j.started_at) < 3 * 60e3;
  const running = j && j.status === "Running" && Date.now() - j.started_at < 30 * 60e3;
  $$("[data-needs-idle]").forEach((b) => (b.disabled = !!running));
  if (running) {
    el.className = "job on";
    el.innerHTML = `⏳ <b>${esc(j.label || "Đang chạy")}</b> <span>(${Math.round((Date.now() - j.started_at) / 1000)}s): ${esc(j.metadata?.step || "")}</span><span class="sp"></span><button class="b s bad" id="btnCancel">Huỷ</button>`;
    $("#btnCancel").onclick = () => send({ type: "studio-cancel" }).then(() => toast("Đang huỷ... (lần gọi AI đang chạy xong rồi mới dừng)"));
  } else if (fresh && (j.status === "Failed" || j.status === "Cancelled")) {
    el.className = "job on fail";
    el.innerHTML = `❌ ${esc(j.label || "")}: ${esc(j.error_message || STATUS_VI[j.status])}`;
  } else if (fresh && j.status === "Succeeded") {
    const m = j.metadata || {};
    el.className = "job on";
    el.innerHTML =
      j.job_type === "discover"
        ? `✅ Khám phá xong: ${m.opportunities || 0} cơ hội, ${m.ideas || 0} ý tưởng. <a href="#" data-goto-tab="ideas" data-status="New">Xem ý tưởng →</a>`
        : `✅ Đã viết ${m.posts || 0} bản nháp${m.images ? `, ${m.images} ảnh` : ""} cho "${esc(m.idea || "")}". <a href="#" data-goto-tab="posts" data-status="PendingReview">Xem bản nháp →</a>`;
    if (j.error_message) el.innerHTML += `<div class="warnbox" style="flex-basis:100%">Một phần lỗi: ${esc(j.error_message)}</div>`;
  } else if (fresh && j.status === "Skipped") {
    el.className = "job on";
    el.innerHTML = `⏭ Bỏ qua: ${esc(j.metadata?.note || "")}`;
  } else el.className = "job";
}
setInterval(() => S.jobs[0]?.status === "Running" && renderJobBanner(), 1000);

// ---------- Tính toán dùng chung ----------
const GOOD = ["Approved", "Filled", "Published"];
const ideaById = (id) => S.ideas.find((i) => i.id === id);
const oppById = (id) => S.opps.find((o) => o.id === id);
function rootOf(name) {
  const d = S.directions.find((x) => x.name === name);
  if (!d) return name;
  const p = d.parent_id && S.directions.find((x) => x.id === d.parent_id);
  return p ? p.name : d.name;
}
function usageCost(u) {
  const p = (S.config.prices || {})[u.pid] || { in: 0, out: 0 };
  return ((u.est_in || 0) * (Number(p.in) || 0) + (u.est_out || 0) * (Number(p.out) || 0)) / 1e6;
}
function dirDistribution() {
  const roots = S.directions.filter((d) => d.status === "active" && !d.parent_id);
  const cnt = {};
  let total = 0;
  S.posts.filter((p) => GOOD.includes(p.status)).forEach((p) => {
    const ds = [...new Set((ideaById(p.idea_id)?.directions || []).map(rootOf))];
    ds.forEach((d) => (cnt[d] = (cnt[d] || 0) + 1 / ds.length));
    if (ds.length) total++;
  });
  return roots.map((r) => ({ name: r.name, target: Number(r.share) || 0, actual: total ? Math.round(((cnt[r.name] || 0) / total) * 100) : 0 }));
}

// ---------- Tổng quan ----------
function ctxCard(title, snap, body) {
  const src = snap && !snap.error ? `${esc(snap.source)} · ${ago(snap.collected_at)} · tin cậy ${esc(snap.reliability)}` : "";
  const err = snap?.error ? `<div class="err">Lỗi: ${esc(snap.error)}</div>` : "";
  return `<div class="card"><h3>${title}</h3>${body || '<span class="muted small">Chưa có dữ liệu</span>'}${err}<div class="src">${src}</div></div>`;
}
const itemList = (items, n = 5) =>
  `<ul class="news">${(items || []).slice(0, n).map((it) => `<li>${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)} <span class="muted small">${esc(it.provider)}${it.extra ? ` · ${esc(it.extra)}` : ""}</span></li>`).join("")}</ul>`;
function renderDash() {
  $("#dashPos").innerHTML = `${esc(S.profile.positioning || "(chưa có)")} <a href="#" data-goto-tab="knowledge" class="small">sửa</a>`;
  const s = S.snaps || {};
  const w = s.weather?.content;
  const t = s.time?.content;
  const cal = s.calendar?.content;
  $("#ctxCards").innerHTML = [
    ctxCard("🕒 Thời gian", s.time, t ? `<b>${esc(t.text)}</b><div class="muted small">${esc(t.buoi)}${t.weekend ? " · cuối tuần" : ""}${t.end_of_month ? " · cuối tháng" : ""}</div>` : ""),
    ctxCard("🌤 Thời tiết", s.weather, w ? `<b style="font-size:22px">${esc(w.temp)}°C</b> <span>${esc(w.condition)}</span><div class="muted small">${esc(w.place)} · cảm giác ${esc(w.feels)}°C · ẩm ${esc(w.humidity)}%<br>Hôm nay ${esc(w.min)}–${esc(w.max)}°C · mưa 6h tới ${esc(w.rain_chance_6h)}%</div>` : ""),
    ctxCard("📅 Dịp sắp tới", s.calendar, cal ? (cal.upcoming.length ? `<ul class="news">${cal.upcoming.map((x) => `<li>${esc(x.name)} <span class="muted small">${x.days === 0 ? "hôm nay" : `${esc(x.date)} · còn ${x.days} ngày`}</span></li>`).join("")}</ul>` : '<span class="muted small">Không có dịp nào trong 14 ngày tới</span>') : ""),
    ctxCard("📰 Tin mới", s.news, s.news?.items?.length ? itemList(s.news.items) : ""),
    ctxCard("🟧 Hacker News", s.hn, s.hn?.items?.length ? itemList(s.hn.items) : ""),
    s.reddit?.items?.length || s.reddit?.error ? ctxCard("👥 Reddit", s.reddit, s.reddit?.items?.length ? itemList(s.reddit.items) : "") : ""
  ].join("");

  const good = S.posts.filter((p) => GOOD.includes(p.status));
  const decided = S.posts.filter((p) => p.status !== "PendingReview");
  const kept = S.ideas.filter((i) => ["Saved", "Drafted"].includes(i.status));
  const discoverJobs = S.jobs.filter((j) => j.job_type === "discover" && j.status === "Succeeded");
  const dropped = discoverJobs.reduce((a, j) => a + (j.metadata?.dropped?.length || 0), 0);
  const found = discoverJobs.reduce((a, j) => a + (j.metadata?.opportunities || 0), 0);
  const totalCost = S.usage.reduce((a, u) => a + usageCost(u), 0);
  const grounded = S.posts.filter((p) => (ideaById(p.idea_id)?.evidence || []).length).length;
  const stat = (n, l, tip = "") => `<div class="stat" title="${esc(tip)}"><b>${n}</b><span>${l}</span></div>`;
  $("#stats").innerHTML = [
    stat(S.ideas.filter((i) => i.status === "New").length, "Ý tưởng mới"),
    stat(S.posts.filter((p) => p.status === "PendingReview").length, "Bản nháp chờ duyệt"),
    stat(S.posts.filter((p) => p.status === "Published").length, "Đã đăng"),
    stat(pct(kept.length, S.ideas.length), "Ý tưởng được giữ", "Ý tưởng bạn lưu hoặc viết nháp / tổng ý tưởng. Chỉ số chính: agent có nghĩ ra thứ bạn muốn chia sẻ không."),
    stat(pct(good.length, decided.length), "Bản nháp được duyệt", "Trong các bản nháp bạn đã quyết"),
    stat(pct(good.filter((p) => p.edited).length, good.length), "Bài duyệt phải sửa tay", "Càng thấp nghĩa là AI viết càng đúng ý"),
    stat(pct(dropped, dropped + found), "Cơ hội bị loại vì trùng", "Tỉ lệ lặp chủ đề"),
    stat(pct(grounded, S.posts.length), "Bài có căn cứ nguồn"),
    stat(usd(discoverJobs.length ? totalCost / discoverJobs.length : 0), "Chi phí / phiên (ước tính)"),
    stat(usd(good.length ? totalCost / good.length : 0), "Chi phí / bài được duyệt")
  ].join("");

  const ideaRow = (i) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="badge">${i.score}</span> <a href="#" data-goto-tab="ideas" data-status="${i.status}">${esc(i.title)}</a> <span class="muted small">${esc(i.approach)}</span>${i.cross_domain ? ' <span class="badge cross">🔀</span>' : ""}</div>`;
  const topIdeas = S.ideas.filter((i) => i.status === "New").sort((a, b) => b.score - a.score).slice(0, 5);
  $("#dashIdeas").innerHTML = topIdeas.length ? topIdeas.map(ideaRow).join("") : '<div class="empty">Chưa có. Bấm <b>🔍 Khám phá nội dung</b>.</div>';
  const topOpps = S.opps.filter((o) => ["New", "Explored"].includes(o.status)).slice(0, 5);
  $("#dashOpps").innerHTML = topOpps.length
    ? topOpps.map((o) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="badge">${o.score}</span> <a href="#" data-goto-tab="discover" data-session="${esc(o.session_id)}">${esc(o.title)}</a> <span class="muted small">${esc((o.directions || []).join(", "))}</span></div>`).join("")
    : '<div class="empty">Chưa có cơ hội.</div>';
  const pv = (p) => `<div style="padding:5px 0;border-bottom:1px solid var(--line)"><a href="#" data-goto-tab="posts" data-status="${p.status}" style="color:inherit">${esc(String(p.content).slice(0, 140))}</a> <span class="muted small">${p.evaluation ? `· ${p.evaluation.overall} điểm` : ""} · ${fmtTime(p.created_at)}</span></div>`;
  const drafts = S.posts.filter((p) => p.status === "PendingReview").slice(0, 4);
  $("#dashDrafts").innerHTML = drafts.length ? drafts.map(pv).join("") : '<div class="empty">Không có bản nháp chờ duyệt.</div>';
  const pub = S.posts.filter((p) => p.status === "Published").sort((a, b) => (b.published_at || 0) - (a.published_at || 0)).slice(0, 4);
  $("#dashPublished").innerHTML = pub.length ? pub.map(pv).join("") : '<div class="empty">Chưa đăng bài nào qua Studio.</div>';
  const dist = dirDistribution();
  $("#dashDist").innerHTML = dist.length
    ? dist.map((d) => `<div class="distrow"><span>${esc(d.name)}</span><div class="distbar"><i style="width:${d.actual}%"></i>${d.target ? `<u style="left:${d.target}%"></u>` : ""}</div><span class="muted">${d.actual}% / ${d.target}%</span></div>`).join("")
    : '<div class="empty">Chưa có định hướng.</div>';
  const day = S.usage.filter((u) => u.at > Date.now() - 86400e3);
  const byP = {};
  day.forEach((u) => ((byP[u.provider] = byP[u.provider] || { n: 0, ok: 0 }), byP[u.provider].n++, u.ok && byP[u.provider].ok++));
  const cds = Object.entries(AIS.cooldowns || {}).filter(([, c]) => c.until > Date.now());
  $("#dashAi").innerHTML =
    (day.length ? `<div>${day.length} lần gọi · thành công ${pct(day.filter((u) => u.ok).length, day.length)} · ${day.filter((u) => u.fallback).length} lần chuyển bên</div>` : '<div class="muted">Chưa gọi AI hôm nay.</div>') +
    Object.entries(byP).map(([p, v]) => `<div class="small">${esc(p)}: ${v.n} lần, ${v.ok} thành công</div>`).join("") +
    cds.map(([k, c]) => `<div class="warnbox">⏸ ${esc(k)} nghỉ tới ${fmtTime(c.until)}: ${esc(c.reason)}</div>`).join("") +
    '<div style="margin-top:6px"><a href="#" data-goto-tab="ai" class="small">Chi tiết →</a></div>';
  $("#dashSessions").innerHTML = sessionRows(S.sessions.slice(0, 5)) || '<div class="empty">Chưa có phiên nào.</div>';
}
function sessionRows(list) {
  return list
    .map((s) => {
      const nO = S.opps.filter((o) => o.session_id === s.id).length;
      const nI = S.ideas.filter((i) => i.session_id === s.id).length;
      return `<div class="sess ${UI.sessionId === s.id && tab === "discover" ? "on" : ""}" data-goto-tab="discover" data-session="${esc(s.id)}">
        <div class="row"><b>${esc(M.entries?.[s.entry?.type || "discover"] || "Khám phá")}</b> ${badge(s.status)} <span class="sp"></span><span class="muted small">${fmtTime(s.created_at)}</span></div>
        <div class="muted small">${s.items?.length || 0} mục ngữ cảnh · ${nO} cơ hội · ${nI} ý tưởng${s.settings?.topic ? ` · "${esc(s.settings.topic)}"` : ""}${s.entry?.text ? ` · ${esc(String(s.entry.text).slice(0, 50))}` : ""}</div></div>`;
    })
    .join("");
}
$("#btnCollect").addEventListener("click", async (e) => {
  e.target.disabled = true;
  e.target.textContent = "Đang lấy...";
  const r = await send({ type: "studio-collect" });
  e.target.disabled = false;
  e.target.textContent = "🔄 Cập nhật";
  const errs = Object.entries(r.errors || {});
  toast(!r.ok ? `Lỗi: ${r.error}` : errs.length ? `Có nguồn lỗi: ${errs.map(([k, v]) => `${k}: ${v}`).join("; ")}` : "Đã cập nhật ngữ cảnh");
});
$("#btnQuickDiscover").dataset.needsIdle = "1";
$("#btnQuickDiscover").addEventListener("click", async () => {
  const r = await send({ type: "studio-discover", settings: {} });
  toast(r.ok ? "Bắt đầu khám phá (thường 30–90 giây), theo dõi ở thanh trên cùng" : `Lỗi: ${r.error}`);
});

// ---------- Khám phá ----------
let discoverFormBuilt = false;
function buildDiscoverForm() {
  const sd = S.config.session_defaults || {};
  const box = $("#discoverForm");
  const entries = Object.entries(M.entries || {});
  const active = S.directions.filter((d) => d.status === "active");
  const roots = active.filter((d) => !d.parent_id || !active.some((p) => p.id === d.parent_id));
  const dirOpts = active.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");
  const groups = {};
  Object.entries(M.adapters || {}).forEach(([k, a]) => (groups[a.group] = groups[a.group] || []).push([k, a]));
  box.innerHTML = `
    <div class="row"><h3 style="margin:0">Phiên khám phá mới</h3><span class="sp"></span><span class="note">Để trống là dùng mặc định. Không cần điền hết.</span></div>
    <div class="cols3">
      <div>
        <label class="f">Bắt đầu từ</label>
        <select id="dEntry">${entries.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <div id="dEntryBox"></div>
        <label class="f">Chủ đề / từ khoá <small>Tuỳ chọn</small></label><input id="dTopic" placeholder="vd: AI agent, đi làm mùa lạnh" />
        <label class="f">Yêu cầu thêm cho AI</label><textarea id="dInstr" rows="2" placeholder="vd: ưu tiên góc nhìn của dev đi làm, có chút hài"></textarea>
      </div>
      <div>
        <label class="f">Nguồn <small>Mặc định: các nguồn đang bật</small></label>
        <div id="dSources">${Object.entries(groups).map(([g, list]) => `<div class="small muted" style="margin-top:4px">${esc(M.groups?.[g] || g)}</div><div class="chips">${list.map(([k, a]) => `<label class="chip"><input type="checkbox" value="${k}" ${S.sources[k]?.enabled ? "checked" : ""} /> ${esc(a.name)}</label>`).join("")}</div>`).join("")}
          <div class="note" style="margin-top:4px">X / Twitter Trends chưa có (X không có API miễn phí).</div></div>
        <label class="f">Thời gian của tin</label>
        <select id="dHours"><option value="24">24 giờ qua</option><option value="72">3 ngày qua</option><option value="168">7 ngày qua</option><option value="0">Không giới hạn</option></select>
      </div>
      <div>
        <label class="f">Định hướng <small>Không chọn = tất cả đang bật</small></label>
        <div class="chips" id="dDirs">${roots.map((r) => `<label class="chip"><input type="checkbox" value="${esc(r.id)}" /> ${esc(r.name)}</label>${active.filter((c) => c.parent_id === r.id).map((c) => `<label class="chip sub"><input type="checkbox" value="${esc(c.id)}" /> ${esc(c.name)}</label>`).join("")}`).join("")}</div>
        <div class="two">
          <div><label class="f">Độ sâu</label><select id="dDepth"><option value="quick">Nhanh</option><option value="normal">Vừa</option><option value="deep">Sâu</option></select></div>
          <div><label class="f">Số cơ hội</label><input id="dOpps" type="number" min="2" max="10" /></div>
          <div><label class="f">Số ý tưởng</label><input id="dIdeas" type="number" min="2" max="12" /></div>
          <div><label class="f">Tránh</label><input id="dExclude" placeholder="vd: chính trị, crypto" /></div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:12px"><span class="sp"></span><button class="b p big" id="dStart" data-needs-idle="1">🔍 Bắt đầu khám phá</button></div>`;
  $("#dHours").value = String(sd.hours ?? 24);
  $("#dDepth").value = sd.depth || "normal";
  $("#dOpps").value = sd.opportunities || 5;
  $("#dIdeas").value = sd.ideas || 6;
  const entryBox = () => {
    const t = $("#dEntry").value;
    const ph = { topic: "Chủ đề bạn muốn khai thác", url: "https://... (bài báo, blog)", note: "Một ghi chú, suy nghĩ của bạn", project: "Dự án / trải nghiệm có thật bạn muốn kể", quote: "Câu trích dẫn, tên sách / phim / bài hát" }[t];
    if (t === "crossdomain")
      $("#dEntryBox").innerHTML = `<label class="f">Hai lĩnh vực muốn nối</label><div class="row"><select id="dX1" style="flex:1">${dirOpts}</select><span>+</span><select id="dX2" style="flex:1">${dirOpts}</select></div><input id="dX3" placeholder="hoặc gõ tự do: Cầu lông + Kỷ luật" style="margin-top:6px" />`;
    else if (ph) $("#dEntryBox").innerHTML = `<label class="f">Nội dung</label><textarea id="dEntryText" rows="3" placeholder="${esc(ph)}"></textarea>`;
    else $("#dEntryBox").innerHTML = t === "none" ? '<div class="note" style="margin-top:6px">Không đọc nguồn ngoài: chỉ dùng hồ sơ, kiến thức cá nhân và yêu cầu của bạn.</div>' : "";
    if (t === "crossdomain" && $("#dX2").options.length > 1) $("#dX2").selectedIndex = 1;
  };
  $("#dEntry").onchange = entryBox;
  entryBox();
  $("#dStart").onclick = startDiscovery;
  discoverFormBuilt = true;
}
async function startDiscovery() {
  const type = $("#dEntry").value;
  let text = $("#dEntryText")?.value.trim() || "";
  if (type === "crossdomain") text = $("#dX3").value.trim() || `${$("#dX1").value} + ${$("#dX2").value}`;
  if (["topic", "url", "note", "project", "quote"].includes(type) && !text) return toast("Điền nội dung cho điểm bắt đầu đã");
  if (type === "url") {
    let origin;
    try {
      origin = `${new URL(text).origin}/*`;
    } catch (_) {
      return toast("Link không hợp lệ");
    }
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has && !(await chrome.permissions.request({ origins: [origin] }).catch(() => false))) return toast("Cần cho phép extension đọc trang này");
  }
  const settings = {
    entry: { type, text },
    sources: $$("#dSources input:checked").map((x) => x.value),
    directions: $$("#dDirs input:checked").map((x) => x.value),
    topic: $("#dTopic").value.trim(),
    instruction: $("#dInstr").value.trim(),
    hours: Number($("#dHours").value),
    depth: $("#dDepth").value,
    opportunities: Number($("#dOpps").value),
    ideas: Number($("#dIdeas").value),
    exclude: $("#dExclude").value.trim()
  };
  const r = await send({ type: "studio-discover", settings });
  toast(r.ok ? "Bắt đầu khám phá, theo dõi ở thanh trên cùng" : `Lỗi: ${r.error}`);
  UI.sessionId = null;
}
function renderDiscover(force) {
  if (!discoverFormBuilt || (force && !editing)) buildDiscoverForm();
  if (!force && !touched("sessions", "opps", "ideas")) return;
  if (!UI.sessionId || !S.sessions.some((s) => s.id === UI.sessionId)) UI.sessionId = S.sessions[0]?.id || null;
  $("#sessionList").innerHTML = sessionRows(S.sessions) || '<div class="empty">Chưa có phiên nào.</div>';
  const s = S.sessions.find((x) => x.id === UI.sessionId);
  const box = $("#sessionDetail");
  if (!s) {
    box.innerHTML = '<div class="card empty">Chọn hoặc bắt đầu một phiên khám phá.</div>';
    return;
  }
  const opps = S.opps.filter((o) => o.session_id === s.id).sort((a, b) => b.score - a.score);
  const errs = Object.entries(s.collect_errors || {});
  const st = s.settings || {};
  box.innerHTML = `
    <div class="card">
      <div class="row"><h3 style="margin:0">${esc(M.entries?.[s.entry?.type || "discover"] || "Khám phá")}</h3> ${badge(s.status)}<span class="sp"></span><span class="muted small">${fmtTime(s.created_at)}${s.ai ? ` · ${esc(s.ai)}` : ""}</span></div>
      <div class="meta">Nguồn: ${esc((st.sources || []).map((k) => M.adapters?.[k]?.name || k).join(", "))} · độ sâu ${esc(st.depth || "")}${st.topic ? ` · chủ đề "${esc(st.topic)}"` : ""}${st.instruction ? ` · yêu cầu: ${esc(st.instruction)}` : ""}${s.entry?.text ? `<br>Điểm bắt đầu: ${esc(String(s.entry.text).slice(0, 300))}` : ""}</div>
      ${errs.map(([k, v]) => `<div class="err">${esc(M.adapters?.[k]?.name || k)}: ${esc(v)}</div>`).join("")}
      <details style="margin-top:8px"><summary>Xem ${s.items?.length || 0} mục ngữ cảnh đã thu thập</summary>
        <div class="table-wrap"><table class="ctxtable"><tbody>${(s.items || []).map((it) => `<tr><td>${esc(it.ref)}</td><td>${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}<div class="muted small">${esc(it.provider)}${it.published ? ` · ${ago(it.published)}` : ""}${it.extra ? ` · ${esc(it.extra)}` : ""} · ${esc(it.lang)} · tin cậy: ${esc(it.reliability)}</div></td></tr>`).join("")}</tbody></table></div>
      </details>
    </div>
    <h2>Cơ hội (${opps.length})</h2>
    <div class="list" id="oppList"></div>`;
  const list = $("#oppList");
  if (!opps.length) list.innerHTML = `<div class="card empty">${s.status === "Running" ? "Đang tìm cơ hội..." : "Phiên này không có cơ hội nào."}</div>`;
  opps.forEach((o) => list.appendChild(oppCard(o)));
}
const OPP_SC = { relevance: "Hợp bạn", freshness: "Mới, đúng lúc", originality: "Ít người nói", engagement: "Khơi phản hồi", confidence: "Bằng chứng" };
function oppCard(o) {
  const el = document.createElement("div");
  el.className = "card item";
  const nIdeas = S.ideas.filter((i) => i.opportunity_id === o.id).length;
  el.innerHTML = `
    <div class="hd">${ring(o.score, "Điểm cơ hội (trọng số chỉnh ở tab AI & chi phí)")}
      <div class="t"><h3>${esc(o.title)}</h3><div class="meta">${badge(o.status)} · ${nIdeas} ý tưởng</div><div class="refs">${dirChips(o.directions)}</div></div></div>
    <p><span class="lbl">Nguồn nói</span><br>${esc(o.summary)}</p>
    <p><span class="lbl">Vì sao đáng viết (AI diễn giải)</span><br>${esc(o.why)}</p>
    ${o.angles?.length ? `<div class="lbl">Góc khai thác</div><ul style="margin:2px 0 6px;padding-left:18px">${o.angles.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    <div class="refs">${evChips(o.evidence) || '<span class="ref">Không có bằng chứng từ nguồn: dựa trên hồ sơ của bạn</span>'}</div>
    <div class="scores">${Object.entries(o.scores || {}).map(([k, v]) => `<span>${esc(OPP_SC[k] || k)}: <b>${v}</b></span>`).join("")}</div>
    ${o.risks ? `<div class="warnbox" style="margin-top:6px">⚠ ${esc(o.risks)}</div>` : ""}
    <div class="row" style="margin-top:10px">
      <button class="b s p" data-a="more">💡 Thêm ý tưởng</button>
      ${nIdeas ? `<button class="b s" data-goto-tab="ideas" data-opp="${esc(o.id)}" data-status="all">Xem ${nIdeas} ý tưởng</button>` : ""}
      ${o.status !== "Saved" ? '<button class="b s ok" data-a="Saved">⭐ Lưu</button>' : ""}
      ${o.status !== "Dismissed" ? '<button class="b s bad" data-a="Dismissed">✖ Bỏ qua</button>' : ""}
    </div><div class="ibox"></div>`;
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    if (b.dataset.a === "more") return askIdeas($(".ibox", el), { oppId: o.id });
    const r = await send({ type: "studio-patch-opp", id: o.id, patch: { status: b.dataset.a } });
    if (!r.ok) toast(`Lỗi: ${r.error}`);
  });
  return el;
}
function askIdeas(box, target) {
  box.innerHTML = `<form class="inline"><div class="row"><input class="ins" placeholder="Hướng muốn thử (tuỳ chọn), vd: góc hài, nối với thể thao" style="flex:1" /><input class="n inl" type="number" min="2" max="6" value="4" style="width:60px" /><button class="b s p">Nghĩ ý tưởng</button><button type="button" class="b s x">✕</button></div></form>`;
  $(".x", box).onclick = () => (box.innerHTML = "");
  $("form", box).onsubmit = async (e) => {
    e.preventDefault();
    const b = $("button.p", box);
    b.disabled = true;
    b.textContent = "Đang nghĩ...";
    const r = await send({ type: "studio-more-ideas", ...target, instruction: $(".ins", box).value.trim(), n: Number($(".n", box).value) || 4 });
    box.innerHTML = "";
    toast(r.ok ? `Thêm ${r.count} ý tưởng (${r.ai}). Xem ở tab Ý tưởng.` : `Lỗi: ${r.error}`);
  };
  $(".ins", box).focus();
}

// ---------- Ý tưởng ----------
function filterBar(el, items, cur, onPick, extra = "") {
  el.innerHTML = items.map(([k, label, n]) => `<button data-k="${k}" class="${k === cur ? "on" : ""}">${esc(label)}${n != null ? ` (${n})` : ""}</button>`).join("") + extra;
  el.onclick = (e) => {
    const b = e.target.closest("button[data-k]");
    if (b) onPick(b.dataset.k);
  };
}
const dirSelect = (cur) => `<select class="fdir"><option value="">Mọi định hướng</option>${S.directions.filter((d) => d.status !== "suggested").map((d) => `<option ${d.name === cur ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>`;
function renderIdeas(force) {
  if (!force && !touched("ideas", "opps", "posts", "directions")) return;
  const base = S.ideas.filter((i) => !UI.ideaOpp || i.opportunity_id === UI.ideaOpp);
  const count = (s) => base.filter((i) => s === "all" || i.status === s).length;
  const opp = UI.ideaOpp && oppById(UI.ideaOpp);
  filterBar(
    $("#ideaFilters"),
    [["New", "Mới", count("New")], ["Saved", "Đã lưu", count("Saved")], ["Drafted", "Đã viết nháp", count("Drafted")], ["Dismissed", "Bỏ qua", count("Dismissed")], ["all", "Tất cả", count("all")]],
    UI.ideaStatus,
    (k) => ((UI.ideaStatus = k), renderIdeas(true)),
    ` ${dirSelect(UI.ideaDir)} <label class="chip"><input type="checkbox" class="fcross" ${UI.ideaCross ? "checked" : ""} /> 🔀 Kết nối lĩnh vực</label>
      <select class="fsort"><option value="score">Điểm cao trước</option><option value="time" ${UI.ideaSort === "time" ? "selected" : ""}>Mới nhất trước</option></select>
      ${opp ? `<span class="chip">Cơ hội: ${esc(opp.title.slice(0, 40))} <a href="#" class="xopp">✕</a></span>` : ""}`
  );
  const f = $("#ideaFilters");
  $(".fdir", f).onchange = (e) => ((UI.ideaDir = e.target.value), renderIdeas(true));
  $(".fcross", f).onchange = (e) => ((UI.ideaCross = e.target.checked), renderIdeas(true));
  $(".fsort", f).onchange = (e) => ((UI.ideaSort = e.target.value), renderIdeas(true));
  $(".xopp", f)?.addEventListener("click", (e) => (e.preventDefault(), (UI.ideaOpp = null), renderIdeas(true)));
  let list = base.filter((i) => (UI.ideaStatus === "all" || i.status === UI.ideaStatus) && (!UI.ideaDir || (i.directions || []).includes(UI.ideaDir) || (i.directions || []).map(rootOf).includes(UI.ideaDir)) && (!UI.ideaCross || i.cross_domain));
  list = list.sort((a, b) => (UI.ideaSort === "time" ? b.created_at - a.created_at : b.score - a.score));
  const box = $("#ideaList");
  box.innerHTML = list.length ? "" : '<div class="card empty">Không có ý tưởng nào ở mục này. Bắt đầu một phiên ở tab <b>Khám phá</b>.</div>';
  list.slice(0, 80).forEach((i) => box.appendChild(ideaCard(i)));
}
const IDEA_SC = { originality: "Mới lạ", relevance: "Hợp bạn", engagement: "Khơi phản hồi", authenticity: "Thật với bạn" };
function ideaCard(i) {
  const el = document.createElement("div");
  el.className = "card item";
  const opp = oppById(i.opportunity_id);
  const nPosts = S.posts.filter((p) => p.idea_id === i.id).length;
  el.innerHTML = `
    <div class="hd">${ring(i.score, "Điểm ý tưởng (trọng số chỉnh ở tab AI & chi phí)")}
      <div class="t"><h3>${esc(i.title)}</h3>
        <div class="meta">${badge(i.status)} ${i.approach ? `<span class="badge">${esc(i.approach)}</span>` : ""} ${i.cross_domain ? '<span class="badge cross">🔀 Kết nối lĩnh vực</span>' : ""} · ${fmtTime(i.created_at)}${opp ? ` · từ cơ hội "${esc(opp.title.slice(0, 50))}"` : ""}</div>
        <div class="refs">${dirChips(i.directions)}</div></div></div>
    ${i.hook ? `<div class="hook">${esc(i.hook)}</div>` : ""}
    <p>${esc(i.summary)}</p>
    ${i.rationale ? `<p class="small"><span class="lbl">Vì sao có thể hay</span><br>${esc(i.rationale)}</p>` : ""}
    <div class="refs">${evChips(i.evidence)}</div>
    <div class="scores">${Object.entries(i.scores || {}).map(([k, v]) => `<span>${esc(IDEA_SC[k] || k)}: <b>${v}</b></span>`).join("")}</div>
    ${i.risks ? `<div class="warnbox" style="margin-top:6px">⚠ ${esc(i.risks)}</div>` : ""}
    <div class="row" style="margin-top:10px">
      <button class="b s p" data-a="draft">✍ Viết bản nháp</button>
      ${nPosts ? `<button class="b s" data-goto-tab="posts" data-idea="${esc(i.id)}" data-status="all">Xem ${nPosts} bài</button>` : ""}
      <button class="b s" data-a="more">🔁 Phát triển tiếp</button>
      ${i.status !== "Saved" ? '<button class="b s ok" data-a="Saved">⭐ Lưu</button>' : ""}
      ${i.status !== "Dismissed" ? '<button class="b s bad" data-a="Dismissed">✖ Bỏ qua</button>' : ""}
    </div><div class="ibox"></div>`;
  const ibox = $(".ibox", el);
  if (UI.draftFor === i.id) draftForm(ibox, i);
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "draft") {
      UI.draftFor = UI.draftFor === i.id ? null : i.id;
      return UI.draftFor ? draftForm(ibox, i) : (ibox.innerHTML = "");
    }
    if (a === "more") return askIdeas(ibox, { ideaId: i.id });
    const r = await send({ type: "studio-patch-idea", id: i.id, patch: { status: a } });
    if (!r.ok) toast(`Lỗi: ${r.error}`);
  });
  return el;
}
function draftForm(box, idea) {
  const c = S.config;
  box.innerHTML = `<form class="inline">
    <div class="row">
      <label class="small">Số bản <input class="n inl" type="number" min="1" max="5" value="3" style="width:56px" /></label>
      <label class="small">Dạng <select class="fm inl">${Object.entries(M.formats || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
      <label class="small">Nền tảng <select class="pl inl">${Object.entries(M.platforms || {}).map(([k, v]) => `<option value="${k}" ${k === c.platform ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
    </div>
    <div class="small muted" style="margin:8px 0 4px">Giọng (không chọn = AI tự trộn)</div>
    <div class="chips">${(M.styles || []).map((s) => `<label class="chip"><input type="checkbox" value="${esc(s)}" /> ${esc(s)}</label>`).join("")}</div>
    <input class="ins" placeholder="Yêu cầu thêm (tuỳ chọn)" style="margin-top:8px" />
    <div class="row" style="margin-top:8px">
      <label class="chk small"><input type="checkbox" class="cr" checked /> Biên tập AI chấm + gợi ý bản sửa</label>
      <label class="chk small"><input type="checkbox" class="im" ${c.image_auto ? "checked" : ""} /> Tự vẽ ảnh cho bản đáng có ảnh</label>
      <span class="sp"></span><button class="b p s" data-needs-idle="1">Viết</button><button type="button" class="b s x">✕</button>
    </div></form>`;
  $(".x", box).onclick = () => ((UI.draftFor = null), (box.innerHTML = ""));
  $("form", box).onsubmit = async (e) => {
    e.preventDefault();
    const opts = {
      n: Number($(".n", box).value) || 3, format: $(".fm", box).value, platform: $(".pl", box).value,
      styles: $$(".chips input:checked", box).map((x) => x.value), instruction: $(".ins", box).value.trim(),
      critique: $(".cr", box).checked, images: $(".im", box).checked
    };
    const r = await send({ type: "studio-drafts", ideaId: idea.id, opts });
    if (!r.ok) return toast(`Lỗi: ${r.error}`);
    UI.draftFor = null;
    box.innerHTML = "";
    toast("Đang viết bản nháp, theo dõi ở thanh trên cùng");
  };
  renderJobBanner();
}

// ---------- Bài viết (Post Studio + thư viện) ----------
function renderPosts(force) {
  if (!force && !touched("posts", "ideas", "img")) return;
  const base = S.posts.filter((p) => !UI.postIdea || p.idea_id === UI.postIdea);
  const count = (s) => base.filter((p) => s === "all" || p.status === s).length;
  const idea = UI.postIdea && ideaById(UI.postIdea);
  filterBar(
    $("#postFilters"),
    [["PendingReview", "Chờ duyệt", count("PendingReview")], ["Approved", "Đã duyệt", count("Approved")], ["Filled", "Đã điền vào X", count("Filled")], ["Published", "Đã đăng", count("Published")], ["Rejected", "Bỏ", count("Rejected")], ["all", "Tất cả", count("all")]],
    UI.postStatus,
    (k) => ((UI.postStatus = k), renderPosts(true)),
    ` <input class="fq" placeholder="🔎 Tìm chữ" value="${esc(UI.postQ)}" /> ${dirSelect(UI.postDir)}
      <select class="fpl"><option value="">Mọi nền tảng</option>${Object.entries(M.platforms || {}).map(([k, v]) => `<option value="${k}" ${k === UI.postPlatform ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      <label class="chip"><input type="checkbox" class="fsv" ${UI.postSaved ? "checked" : ""} /> ⭐ Đã lưu</label>
      ${idea ? `<span class="chip">Ý tưởng: ${esc(idea.title.slice(0, 40))} <a href="#" class="xidea">✕</a></span>` : ""}
      <span class="sp"></span><button class="b s" data-k2="new">＋ Bài tự viết</button>`
  );
  const f = $("#postFilters");
  $(".fq", f).oninput = (e) => {
    UI.postQ = e.target.value;
    clearTimeout(f._t);
    f._t = setTimeout(renderPostList, 250);
  };
  $(".fdir", f).onchange = (e) => ((UI.postDir = e.target.value), renderPostList());
  $(".fpl", f).onchange = (e) => ((UI.postPlatform = e.target.value), renderPostList());
  $(".fsv", f).onchange = (e) => ((UI.postSaved = e.target.checked), renderPostList());
  $(".xidea", f)?.addEventListener("click", (e) => (e.preventDefault(), (UI.postIdea = null), renderPosts(true)));
  $("[data-k2=new]", f).onclick = newPostForm;
  renderPostList();
}
function renderPostList() {
  const q = UI.postQ.trim().toLowerCase();
  const list = S.posts.filter((p) => {
    if (UI.postIdea && p.idea_id !== UI.postIdea) return false;
    if (UI.postStatus !== "all" && p.status !== UI.postStatus) return false;
    if (UI.postSaved && !p.saved) return false;
    if (UI.postPlatform && (p.platform || "x") !== UI.postPlatform) return false;
    if (q && !String(p.content).toLowerCase().includes(q)) return false;
    if (UI.postDir) {
      const ds = ideaById(p.idea_id)?.directions || [];
      if (!ds.includes(UI.postDir) && !ds.map(rootOf).includes(UI.postDir)) return false;
    }
    return true;
  });
  const box = $("#postList");
  box.innerHTML = list.length ? "" : '<div class="empty card" style="grid-column:1/-1">Không có bài nào ở mục này.</div>';
  list.slice(0, 60).forEach((p) => box.appendChild(postCard(p)));
}
function newPostForm() {
  const box = $("#newPostBox");
  if (box.innerHTML) return (box.innerHTML = "");
  box.innerHTML = `<form class="inline" style="margin-bottom:12px"><div class="lbl">Bài tự viết, hoặc dán bài cũ để AI chấm / viết lại / chuyển thể</div>
    <textarea class="c" rows="4" placeholder="Nội dung bài. Thread: ngăn các phần bằng một dòng chỉ có ---"></textarea>
    <div class="row" style="margin-top:6px"><select class="pl inl">${Object.entries(M.platforms || {}).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")}</select><span class="sp"></span><button class="b p s">Thêm vào Studio</button><button type="button" class="b s x">✕</button></div></form>`;
  $(".x", box).onclick = () => (box.innerHTML = "");
  $("form", box).onsubmit = async (e) => {
    e.preventDefault();
    const r = await send({ type: "studio-new-post", content: $("textarea", box).value, platform: $(".pl", box).value });
    if (!r.ok) return toast(`Lỗi: ${r.error}`);
    box.innerHTML = "";
    UI.postStatus = "PendingReview";
    UI.postIdea = null;
    toast("Đã thêm. Bấm 🧐 Chấm để biên tập AI đánh giá.");
  };
}

const REWRITES = [
  ["", "✍ Sửa với AI..."],
  ["viết lại theo góc khác, hay hơn", "Viết lại"],
  ["mở rộng, đầy đặn hơn nhưng vẫn gọn", "Mở rộng"],
  ["ngắn hơn, tối đa 1–2 câu", "Ngắn hơn"],
  ["mở đầu cuốn hơn (hook mạnh hơn)", "Hook mạnh hơn"],
  ["đổi giọng: nghiêm túc, sâu sắc hơn", "Giọng nghiêm túc"],
  ["đổi giọng: đời thường, thân mật hơn", "Giọng đời thường"],
  ["thêm chút hài hước, vẫn tự nhiên", "Thêm hài hước"],
  ["cá nhân hơn: dùng trải nghiệm có thật nếu có, nếu không thì nói rõ góc nhìn riêng", "Cá nhân hơn"],
  ["thử phản biện chính lập luận của bài, rồi viết lại bản chặt chẽ hơn", "Phản biện lập luận"],
  ["kết bằng một câu hỏi dễ trả lời", "Thêm câu hỏi"],
  ["bỏ hết emoji", "Bỏ emoji"],
  ["__thread", "🧵 Chuyển thành thread"],
  ["__single", "Gộp thành một bài"],
  ["__alt", "＋ Thêm 2 bản khác cùng ý tưởng"]
];
const imgCache = new Map();
async function loadImg(id) {
  const key = `studioImg:${id}`;
  return (await chrome.storage.local.get(key))[key] || "";
}
const partsOf = (p) => (p.parts && p.parts.length ? p.parts : [p.content || ""]);
const splitParts = (s) => s.split(/\n\s*---\s*\n/);
function evalPanel(p) {
  const ev = p.evaluation;
  if (!ev) return `<div class="eval row"><span class="muted">Chưa chấm.</span><span class="sp"></span><button class="b s" data-a="critique">🧐 Chấm bản này</button></div>`;
  const flags = [ev.fabricated_experience ? '<div class="flag">⚠ Có vẻ kể trải nghiệm không nằm trong "Trải nghiệm có thật" của bạn</div>' : "", ...(ev.unsupported_claims || []).map((c) => `<div class="flag">⚠ Khẳng định chưa có căn cứ: ${esc(c)}</div>`)].join("");
  return `<details class="eval" ${p.status === "PendingReview" ? "open" : ""}>
    <summary><span class="top" style="display:inline-flex">${ring(ev.overall, "Điểm biên tập (không đảm bảo viral)")}<span style="margin-left:8px">${esc(ev.reasoning)}</span></span></summary>
    <div class="dims">${Object.entries(ev.scores || {}).map(([k, v]) => `<div class="dim"><span>${esc(M.dims?.[k] || k)}</span><i style="--v:${v};--c:${v >= 75 ? "var(--ok)" : v >= 50 ? "var(--accent)" : "#f5a623"}"></i><span>${v}</span></div>`).join("")}</div>
    ${flags}
    ${ev.issues?.length ? `<div class="lbl">Vấn đề</div><ul>${ev.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${ev.suggestions?.length ? `<div class="lbl">Gợi ý sửa</div><ul>${ev.suggestions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${ev.revision ? `<div class="lbl">Bản sửa gợi ý</div><div class="rev">${esc(ev.revision.join("\n---\n"))}</div>` : ""}
    <div class="row">${ev.revision ? '<button class="b s ok" data-a="revision">✔ Dùng bản sửa</button>' : ""}<button class="b s" data-a="improve">✨ Viết lại theo góp ý</button><button class="b s" data-a="critique">🧐 Chấm lại</button><span class="sp"></span><span class="muted small">${esc(ev.by || "")} · ${fmtTime(ev.at)}</span></div>
  </details>`;
}
function postCard(p) {
  const el = document.createElement("div");
  el.className = "post";
  el.dataset.id = p.id;
  const idea = ideaById(p.idea_id);
  const pf = M.platforms?.[p.platform || "x"] || { name: "X", limit: 280 };
  const isThread = partsOf(p).length > 1 || p.format === "thread";
  el.innerHTML = `
    ${idea ? `<div class="idearef">💡 <a href="#" data-goto-tab="ideas" data-status="all">${esc(idea.title)}</a>${idea.approach ? ` · ${esc(idea.approach)}` : ""}</div>` : p.manual ? '<div class="idearef">✍ Bài bạn tự viết</div>' : ""}
    <div class="ph"><span class="badge x">${esc(pf.name)}</span>${isThread ? `<span class="badge">🧵 ${partsOf(p).length} phần</span>` : ""}${p.post_type ? `<span class="badge">${esc(p.post_type)}</span>` : ""} ${badge(p.status)}
      <button class="b s ${p.saved ? "on" : ""}" data-a="save" title="Lưu vào thư viện">⭐</button>
      <button class="b s ${p.liked === true ? "on" : ""}" data-a="like" title="Thích">👍</button><button class="b s ${p.liked === false ? "on" : ""}" data-a="dislike" title="Không thích">👎</button>
      <span class="cnt"></span></div>
    <textarea class="c" rows="5"></textarea>
    ${isThread ? '<div class="note">Thread: các phần ngăn nhau bằng một dòng chỉ có ---</div>' : ""}
    ${evalPanel(p)}
    ${p.claims?.length ? `<details><summary>Khẳng định trong bài (${p.claims.length})</summary>${p.claims.map((c) => `<div class="small" style="margin:3px 0"><span class="badge ${esc(c.kind)}">${esc({ fact: "sự thật", opinion: "ý kiến", hypothesis: "giả thuyết" }[c.kind] || c.kind)}</span> ${esc(c.text)} ${c.ref ? `<span class="muted">[${esc(c.ref)}]</span>` : ""}</div>`).join("")}</details>` : ""}
    <div class="img"><div class="none">${p.needs_image === false ? "AI thấy bài này không cần ảnh" : "Chưa có ảnh"}</div></div>
    ${p.image_concepts?.length || p.image_reason ? `<div class="note">🖼 ${esc(p.image_reason || "")}${p.image_concepts?.length ? `<br>Ý tưởng ảnh: ${p.image_concepts.map(esc).join(" · ")}` : ""}</div>` : ""}
    <details><summary>Prompt ảnh · từ khoá: ${esc(p.image_keywords || "")}</summary><textarea class="ip" rows="3"></textarea></details>
    <div class="row">
      <button class="b s" data-a="ai">🎨 ${p.image ? "Vẽ lại" : "Vẽ ảnh AI"}</button>
      <button class="b s" data-a="quote">🖋 Ảnh chữ</button>
      <button class="b s" data-a="search">🔎 Tìm ảnh</button>
      <button class="b s" data-a="upload">⬆ Tải lên</button>
      ${p.image ? '<button class="b s" data-a="noimg">✕ Bỏ ảnh</button>' : ""}
      <input type="file" accept="image/*" hidden />
    </div>
    <div class="sbox"></div>
    <div class="row">
      ${p.status !== "Approved" ? '<button class="b s ok" data-a="approve">✔ Duyệt</button>' : ""}
      ${p.status !== "Rejected" ? '<button class="b s bad" data-a="reject">✖ Bỏ</button>' : ""}
      <select class="rw inl">${REWRITES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>
      <select class="ad inl"><option value="">↪ Chuyển thể cho...</option>${Object.entries(M.platforms || {}).filter(([k]) => k !== (p.platform || "x")).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")}</select>
    </div>
    <div class="row">
      ${(p.platform || "x") === "x" ? '<button class="b s p" data-a="fill">📤 Điền vào X</button>' : ""}
      <button class="b s" data-a="copy">⧉ Sao chép</button>
      <span class="sp"></span><button class="b s" data-a="del" title="Xoá hẳn bài này">Xoá</button>
    </div>
    ${p.versions?.length ? `<details><summary>Lịch sử sửa (${p.versions.length})</summary>${p.versions.map((v, i) => `<div style="border-top:1px solid var(--line);padding:4px 0"><div class="row"><span class="muted small">${fmtTime(v.at)} · trước khi: ${esc(v.reason)}</span><span class="sp"></span><button class="b s" data-a="restore" data-i="${i}">Khôi phục</button></div><div class="small" style="white-space:pre-wrap">${esc((v.parts || []).join("\n---\n").slice(0, 400))}</div></div>`).join("")}</details>` : ""}`;
  const ta = $("textarea.c", el);
  const ip = $("textarea.ip", el);
  ta.value = partsOf(p).join("\n---\n");
  ip.value = p.image_prompt || "";
  const cnt = $(".cnt", el);
  const upd = () => {
    const parts = splitParts(ta.value);
    const max = Math.max(...parts.map((x) => [...x.trim()].length));
    cnt.textContent = parts.length > 1 ? `dài nhất ${max}/${pf.limit}` : `${max}/${pf.limit}`;
    cnt.classList.toggle("over", max > pf.limit);
  };
  ta.addEventListener("input", upd);
  upd();
  const saveText = () => (ta.value !== partsOf(p).join("\n---\n") ? send({ type: "studio-patch-post", postId: p.id, patch: { content: ta.value } }) : Promise.resolve());
  ta.addEventListener("change", saveText);
  ip.addEventListener("change", () => send({ type: "studio-patch-post", postId: p.id, patch: { image_prompt: ip.value } }));

  const imgBox = $(".img", el);
  const showImg = (url) => {
    if (!url) return;
    imgBox.innerHTML = `<img alt="" />${p.image?.credit ? `<span class="cr">${esc(p.image.credit)}</span>` : ""}`;
    $("img", imgBox).src = url;
  };
  if (p.image) {
    const cached = imgCache.get(p.id);
    if (cached && cached.at === p.image.at) showImg(cached.url);
    else loadImg(p.id).then((url) => (imgCache.set(p.id, { url, at: p.image.at }), showImg(url)));
  }
  const fileIn = $("input[type=file]", el);
  fileIn.addEventListener("change", () => {
    const f = fileIn.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast("Ảnh lớn quá (tối đa 8MB)");
    const rd = new FileReader();
    rd.onload = () => setImage(p, rd.result, { source: "upload", credit: "" });
    rd.readAsDataURL(f);
  });
  let palette = Math.floor(Math.random() * self.XCSImage.QUOTE_PALETTES.length);

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    const busy = (t) => {
      b.disabled = true;
      const old = b.textContent;
      b.textContent = t;
      return () => ((b.disabled = false), (b.textContent = old));
    };
    const patch = (pt) => send({ type: "studio-patch-post", postId: p.id, patch: pt }).then((r) => !r.ok && toast(`Lỗi: ${r.error}`));
    if (a === "approve" || a === "reject") {
      await saveText();
      await patch({ status: a === "approve" ? "Approved" : "Rejected" });
    } else if (a === "save") await patch({ saved: !p.saved });
    else if (a === "like") await patch({ liked: p.liked === true ? null : true });
    else if (a === "dislike") await patch({ liked: p.liked === false ? null : false });
    else if (a === "critique" || a === "improve" || a === "revision") {
      await saveText();
      const done = busy(a === "critique" ? "Đang chấm..." : "Đang sửa...");
      const r =
        a === "critique"
          ? await send({ type: "studio-critique", postId: p.id })
          : a === "revision"
            ? await send({ type: "studio-apply-revision", postId: p.id })
            : await send({ type: "studio-rewrite", postId: p.id, instruction: "sửa theo đúng các góp ý của biên tập, giữ ý chính" });
      done();
      toast(r.ok ? (a === "critique" ? "Đã chấm" : "Đã sửa. Bấm 🧐 Chấm để chấm bản mới.") : `Lỗi: ${r.error}`);
    } else if (a === "ai") {
      const done = busy("Đang vẽ...");
      imgBox.innerHTML = '<div class="none">Đang vẽ ảnh (10–60 giây, máy vẽ miễn phí phải xếp hàng)...</div>';
      const r = await send({ type: "studio-image-ai", postId: p.id, prompt: ip.value });
      done();
      if (!r.ok) (toast(`Không vẽ được: ${r.error}`), render());
    } else if (a === "quote") {
      palette = (palette + 1) % self.XCSImage.QUOTE_PALETTES.length;
      await setImage(p, self.XCSImage.quoteCard(splitParts(ta.value)[0], palette), { source: "quote", credit: "" });
    } else if (a === "upload") fileIn.click();
    else if (a === "noimg") await send({ type: "studio-set-image", postId: p.id, dataUrl: null });
    else if (a === "search") searchUI(p, $(".sbox", el), p.image_keywords || "");
    else if (a === "fill") {
      await saveText();
      const done = busy("Đang mở X...");
      const r = await send({ type: "studio-fill", postId: p.id });
      done();
      if (r.ok && r.rest?.length) {
        await navigator.clipboard.writeText(r.rest.join("\n\n")).catch(() => {});
        toast(`Đã điền phần 1 vào X. ${r.rest.length} phần còn lại đã sao chép: bấm + trên X để thêm vào thread.`);
      } else toast(r.ok ? "Đã điền vào X. Sang tab X đọc lại rồi tự bấm Đăng." : `Lỗi: ${r.error || "không điền được"}`);
    } else if (a === "copy") {
      await navigator.clipboard.writeText(splitParts(ta.value).join("\n\n")).catch(() => {});
      toast("Đã sao chép");
    } else if (a === "restore") {
      const r = await send({ type: "studio-restore-version", postId: p.id, index: Number(b.dataset.i) });
      toast(r.ok ? "Đã khôi phục" : `Lỗi: ${r.error}`);
    } else if (a === "del") {
      if (confirm("Xoá hẳn bài này?")) await send({ type: "studio-delete-post", postId: p.id });
    }
  });
  $("select.rw", el).addEventListener("change", async (e) => {
    const v = e.target.value;
    if (!v) return;
    e.target.disabled = ta.disabled = true;
    await saveText();
    let r;
    if (v === "__alt") {
      if (!p.idea_id) r = { ok: false, error: "Bài tự viết không có ý tưởng gốc" };
      else r = await send({ type: "studio-drafts", ideaId: p.idea_id, opts: { n: 2, platform: p.platform, format: p.format === "thread" ? "thread" : "single" } });
    } else if (v === "__thread") r = await send({ type: "studio-rewrite", postId: p.id, instruction: "chuyển thành thread 3–6 phần, phần đầu là hook", format: "thread" });
    else if (v === "__single") r = await send({ type: "studio-rewrite", postId: p.id, instruction: "gộp thành một bài duy nhất, gọn", format: "single" });
    else r = await send({ type: "studio-rewrite", postId: p.id, instruction: v });
    e.target.disabled = ta.disabled = false;
    e.target.value = "";
    toast(r.ok ? (r.started ? "Đang viết thêm bản nháp..." : `Đã sửa (${r.ai})`) : `Lỗi: ${r.error}`);
  });
  $("select.ad", el).addEventListener("change", async (e) => {
    const pl = e.target.value;
    if (!pl) return;
    e.target.disabled = true;
    await saveText();
    const r = await send({ type: "studio-adapt", postId: p.id, platform: pl });
    e.target.disabled = false;
    e.target.value = "";
    toast(r.ok ? `Đã tạo bản cho ${M.platforms[pl].name} (Chờ duyệt)` : `Lỗi: ${r.error}`);
  });
  return el;
}
async function setImage(p, dataUrl, meta) {
  const r = await send({ type: "studio-set-image", postId: p.id, dataUrl, meta });
  if (!r.ok) toast(`Lỗi lưu ảnh: ${r.error}`);
}
function searchUI(p, box, q) {
  box.innerHTML = `<div class="row" style="margin-bottom:6px"><input class="q" placeholder="từ khoá tiếng Anh, vd: iced coffee" style="flex:1;padding:4px 10px" /><button class="b s go">Tìm</button><button class="b s x">✕</button></div><div class="res"></div>`;
  const inp = $(".q", box);
  inp.value = q;
  const res = $(".res", box);
  $(".x", box).onclick = () => (box.innerHTML = "");
  const run = async () => {
    const qq = inp.value.trim();
    if (!qq) return;
    res.innerHTML = '<div class="note">Đang tìm trên Openverse...</div>';
    const r = await send({ type: "xcs-image", kind: "search", q: qq });
    if (r.error) return (res.innerHTML = `<div class="err">${esc(r.error)}</div>`);
    if (!r.items?.length) return (res.innerHTML = '<div class="note">Không có ảnh nào, thử từ khoá ngắn hơn.</div>');
    res.innerHTML = '<div class="sgrid"></div><div class="note">Bấm ảnh để chọn. Ảnh CC BY sẽ tự ghi nguồn khi điền vào X.</div>';
    r.items.forEach((it) => {
      const im = document.createElement("img");
      im.src = it.thumbData;
      im.title = it.credit || "CC0 / public domain, không cần ghi nguồn";
      im.onclick = async () => {
        res.innerHTML = '<div class="note">Đang tải ảnh lớn...</div>';
        const f = await send({ type: "xcs-image", kind: "fetch", id: it.id });
        await setImage(p, f.dataUrl || it.thumbData, { source: "search", provider: "Openverse", credit: it.credit || "" });
        box.innerHTML = "";
      };
      $(".sgrid", res).appendChild(im);
    });
  };
  $(".go", box).onclick = run;
  inp.onkeydown = (e) => e.key === "Enter" && run();
  if (q) run();
}

// ---------- Kiến thức cá nhân ----------
const PF = ["display_name", "occupation", "age_range", "city", "positioning", "audience", "audience_interests", "tone", "language", "length", "emoji", "questions", "objectives", "engagement_style"];
function renderKnowledge(force) {
  if (force || touched("posts", "feedback")) renderPrefs();
  if (force || touched("knowledge")) renderKn();
  if (!force && (editing || !touched("profile"))) return;
  const p = S.profile;
  $("#profileCard").innerHTML = `
    <h3>👤 Bạn là ai</h3>
    <div class="two">
      <div><label class="f">Tên hiển thị</label><input id="p_display_name" /></div>
      <div><label class="f">Nghề</label><input id="p_occupation" placeholder="vd: dev backend" /></div>
      <div><label class="f">Độ tuổi (tuỳ chọn)</label><input id="p_age_range" /></div>
      <div><label class="f">Thành phố <small>Cho thời tiết, chỉ cần cấp thành phố</small></label><input id="p_city" /></div>
    </div>
    <label class="f">Định vị thương hiệu cá nhân <small>Điểm xuất phát, sửa lúc nào cũng được</small></label><textarea id="p_positioning" rows="2"></textarea>
    <div class="two">
      <div><label class="f">Người đọc mục tiêu</label><input id="p_audience" placeholder="dev trẻ, dân văn phòng" /></div>
      <div><label class="f">Họ quan tâm</label><input id="p_audience_interests" /></div>
    </div>
    <h3 style="margin-top:16px">✍️ Cách viết ưa thích</h3>
    <label class="f">Giọng văn</label><input id="p_tone" />
    <div class="two">
      <div><label class="f">Ngôn ngữ</label><select id="p_language"><option value="vi">Tiếng Việt</option><option value="en">English</option></select></div>
      <div><label class="f">Độ dài</label><select id="p_length"><option value="short">Ngắn</option><option value="medium">Vừa</option><option value="mixed">Trộn</option></select></div>
      <div><label class="f">Emoji</label><select id="p_emoji"><option>không</option><option>ít</option><option>vừa</option></select></div>
      <div><label class="f">&nbsp;</label><label class="chk"><input id="p_questions" type="checkbox" /> Cho đặt câu hỏi</label></div>
    </div>
    <label class="f">Mục tiêu</label><input id="p_objectives" />
    <label class="f">Cách khơi tương tác</label><input id="p_engagement_style" />
    <div class="row" style="margin-top:12px"><button class="b p" id="saveProfile">Lưu</button><span class="small muted" id="profileStatus"></span></div>`;
  for (const k of PF) {
    const el = $(`#p_${k}`);
    if (el.type === "checkbox") el.checked = !!p[k];
    else el.value = p[k] ?? "";
  }
  $("#saveProfile").onclick = saveProfile;
}
async function saveProfile() {
  const p = { ...S.profile };
  for (const k of PF) {
    const el = $(`#p_${k}`);
    p[k] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  const r = await send({ type: "studio-save", name: "profile", value: p });
  if (!r.ok) return toast(`Lỗi: ${r.error}`);
  if ((S.sources.weather?.city || "") !== p.city && !S.sources.weather?.manual) {
    await send({ type: "studio-save", name: "sources", value: { ...S.sources, weather: { ...(S.sources.weather || {}), city: p.city, lat: null, lon: null, label: "" } } });
  }
  $("#profileStatus").textContent = "Đã lưu ✓";
  setTimeout(() => ($("#profileStatus").textContent = ""), 2500);
}
async function renderPrefs() {
  const box = $("#prefsCard");
  const r = await send({ type: "studio-prefs" });
  if (!r.ok) return (box.innerHTML = `<h3>🧠 Đã học từ phản hồi</h3><div class="err">${esc(r.error)}</div>`);
  box.innerHTML = `<h3>🧠 Đã học từ phản hồi của bạn</h3>
    <div class="small muted">${r.approved} bài được duyệt/đăng/thích · ${r.rejected} bài bị bỏ · ${r.edits} lần bạn sửa tay</div>
    ${r.text ? `<div class="small" style="white-space:pre-wrap;margin-top:6px">${esc(r.text)}</div>` : '<div class="note" style="margin-top:6px">Chưa đủ dữ liệu. Cứ duyệt / bỏ / sửa / 👍 👎 các bản nháp, Studio sẽ tự rút ra xu hướng và đưa vào prompt.</div>'}
    <div class="note" style="margin-top:6px">Đây chỉ là xu hướng tham khảo, AI được dặn không bắt chước máy móc bài cũ. Điều bạn muốn AI nhớ chắc chắn thì thêm vào Kiến thức (mục "Cách viết ưa thích" hoặc "Chủ đề tránh").</div>`;
}
function renderKn() {
  const cats = M.kn_cats || {};
  const box = $("#knCard");
  const kn = S.knowledge;
  const shown = kn.filter((k) => !UI.knCat || k.category === UI.knCat);
  box.innerHTML = `
    <div class="row"><h3 style="margin:0">📚 Kiến thức cá nhân</h3><span class="sp"></span><select class="inl" id="knFilter"><option value="">Tất cả (${kn.length})</option>${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${UI.knCat === k ? "selected" : ""}>${esc(v)} (${kn.filter((x) => x.category === k).length})</option>`).join("")}</select></div>
    <form id="knAdd" class="inline">
      <div class="row"><select class="inl" id="knCat">${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${k === (UI.knCat || "experiences") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <select class="inl" id="knOrigin">${Object.entries(ORIGIN_VI).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <select class="inl" id="knConf"><option value="cao">tin chắc</option><option value="vừa">khá chắc</option><option value="thấp">chưa chắc</option></select></div>
      <textarea id="knText" rows="2" placeholder="Mỗi dòng một mục. vd: đi làm bằng xe máy / đang làm extension gợi ý bình luận / không bàn chính trị" style="margin-top:6px"></textarea>
      <div class="row" style="margin-top:6px"><span class="note">Nhiều dòng = nhiều mục.</span><span class="sp"></span><button class="b p s">＋ Thêm</button></div>
    </form>
    <div id="knList" style="margin-top:8px"></div>`;
  $("#knFilter").onchange = (e) => ((UI.knCat = e.target.value), renderKn());
  $("#knAdd").onsubmit = (e) => {
    e.preventDefault();
    const lines = $("#knText").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return;
    const now = Date.now();
    const add = lines.map((text) => ({ id: crypto.randomUUID(), category: $("#knCat").value, text, origin: $("#knOrigin").value, confidence: $("#knConf").value, active: true, created_at: now }));
    saveKn([...add, ...S.knowledge]);
  };
  const list = $("#knList");
  const groups = Object.keys(cats).filter((c) => shown.some((k) => k.category === c));
  list.innerHTML = groups.length
    ? groups.map((c) => `<div class="lbl" style="margin-top:10px">${esc(cats[c])}</div>${shown.filter((k) => k.category === c).map((k) => `
      <div class="kn ${k.active === false ? "off" : ""}" data-id="${esc(k.id)}">
        <input class="tx" value="${esc(k.text)}" />
        <div class="row"><select class="inl og">${Object.entries(ORIGIN_VI).map(([o, v]) => `<option value="${o}" ${o === k.origin ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
          <span class="badge o-${esc(k.origin)}" title="${TRUSTED.includes(k.origin) ? "AI coi là sự thật về bạn" : "AI KHÔNG coi là sự thật về bạn"}">${TRUSTED.includes(k.origin) ? "✓ thật" : "? chưa xác minh"}</span>
          <label class="chk small" title="Bỏ chọn để AI tạm không dùng"><input type="checkbox" class="ac" ${k.active !== false ? "checked" : ""} /></label>
          <button class="b s" data-del="1" title="Xoá">✕</button></div>
      </div>`).join("")}`).join("")
    : '<div class="empty">Chưa có gì. Thêm vài dòng về bạn: nghề, dự án đang làm, trải nghiệm có thật, quan điểm, chủ đề tránh.</div>';
  list.onchange = (e) => {
    const row = e.target.closest(".kn");
    if (!row) return;
    const all = clone(S.knowledge);
    const k = all.find((x) => x.id === row.dataset.id);
    if (!k) return;
    if (e.target.classList.contains("tx")) k.text = e.target.value.trim();
    if (e.target.classList.contains("og")) k.origin = e.target.value;
    if (e.target.classList.contains("ac")) k.active = e.target.checked;
    k.updated_at = Date.now();
    saveKn(all.filter((x) => x.text));
  };
  list.onclick = (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const id = b.closest(".kn").dataset.id;
    saveKn(S.knowledge.filter((x) => x.id !== id));
  };
}
async function saveKn(list) {
  S.knowledge = list;
  const r = await send({ type: "studio-save", name: "knowledge", value: list });
  if (!r.ok) toast(`Lỗi: ${r.error}`);
  editing = false;
  renderKn();
}

// ---------- Định hướng ----------
let dirDraft = null; // bản đang sửa
let dirDirty = false;
function renderDirections(force) {
  if (!force && !touched("directions")) return;
  if (!dirDraft || !dirDirty) dirDraft = clone(S.directions.filter((d) => d.status !== "suggested"));
  renderDirSuggest();
  if (!editing || force) drawDirTree();
}
function renderDirSuggest() {
  const sugg = S.directions.filter((d) => d.status === "suggested");
  const roots = S.directions.filter((d) => d.status !== "suggested" && d.status !== "archived" && !d.parent_id);
  const box = $("#dirSuggest");
  box.innerHTML = sugg.length
    ? `<div class="card" style="margin-bottom:12px"><h3>✨ AI gợi ý định hướng mới</h3><p class="note">AI thấy bạn hay quan tâm các mảng này. Không có gì thay đổi cho tới khi bạn chọn.</p>${sugg
        .map((d) => `<div class="dir" data-id="${esc(d.id)}"><div class="row"><b>${esc(d.name)}</b><span class="muted small">${esc(d.description)}</span></div>${d.reason ? `<div class="note">Vì sao: ${esc(d.reason)}</div>` : ""}
          <div class="row" style="margin-top:6px"><button class="b s ok" data-s="accept">✔ Thêm</button><button class="b s" data-s="temp">🧪 Thử tạm</button>
          <select class="inl mg"><option value="">⇢ Gộp vào...</option>${roots.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
          <button class="b s bad" data-s="drop">✖ Bỏ</button></div></div>`)
        .join("")}</div>`
    : "";
  const act = async (id, fn) => {
    const all = clone(S.directions);
    const d = all.find((x) => x.id === id);
    const r = await send({ type: "studio-save", name: "directions", value: fn(all, d) });
    if (!r.ok) toast(`Lỗi: ${r.error}`);
    if (!dirDirty) dirDraft = null;
    discoverFormBuilt = false;
  };
  box.onclick = (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    const id = b.closest(".dir").dataset.id;
    const s = b.dataset.s;
    if (s === "accept") act(id, (all, d) => ((d.status = "active"), all));
    if (s === "temp") act(id, (all, d) => ((d.status = "active"), (d.temporary = true), all));
    if (s === "drop") act(id, (all) => all.filter((x) => x.id !== id));
  };
  box.onchange = (e) => {
    if (!e.target.classList.contains("mg") || !e.target.value) return;
    const id = e.target.closest(".dir").dataset.id;
    act(id, (all, d) => {
      const t = all.find((x) => x.id === e.target.value);
      t.keywords = [t.keywords, d.name].filter(Boolean).join(", ");
      if (d.description) t.description = [t.description, d.description].filter(Boolean).join("; ");
      return all.filter((x) => x.id !== id);
    });
  };
}
function dirHtml(d, isRoot) {
  const kids = dirDraft.filter((c) => c.parent_id === d.id);
  const dist = isRoot ? dirDistribution().find((x) => x.name === d.name) : null;
  return `<div class="dir ${esc(d.status)}" data-id="${esc(d.id)}">
    <div class="dh"><input class="nm" value="${esc(d.name)}" placeholder="Tên định hướng" />
      <select class="inl st">${["active", "paused", "archived"].map((s) => `<option value="${s}" ${d.status === s ? "selected" : ""}>${STATUS_VI[s]}</option>`).join("")}</select>
      <label class="small muted" title="Tỉ lệ nhắm tới, chỉ để tham khảo">nhắm <input class="inl sh" type="number" min="0" max="100" value="${Number(d.share) || 0}" style="width:58px" />%</label>
      ${dist ? `<span class="small muted" title="Tỉ lệ thực tế trong bài đã duyệt/đăng">thực tế ${dist.actual}%</span>` : ""}
      ${d.temporary ? '<span class="badge suggested">thử tạm</span>' : ""}
      <button class="b s" data-d="more" title="Chi tiết">⋯</button>${isRoot ? '<button class="b s" data-d="child">＋ con</button>' : ""}<button class="b s" data-d="del" title="Xoá">✕</button></div>
    <div class="more" hidden>
      <div><label>Mô tả</label><input class="ds" value="${esc(d.description)}" /></div>
      <div><label>Từ khoá / chủ đề liên quan</label><input class="kw" value="${esc(d.keywords)}" /></div>
      <div><label>Tránh trong hướng này</label><input class="ex" value="${esc(d.exclude)}" /></div>
      <div><label>Kiến thức cá nhân liên quan</label><input class="kn2" value="${esc(d.knowledge || "")}" /></div>
      <div><label>Giọng ưa thích</label><input class="sy" value="${esc(d.styles)}" placeholder="vd: hài hước, thực tế" /></div>
      <div><label>Dạng bài ưa thích</label><input class="fm" value="${esc(d.formats)}" placeholder="vd: thread, câu hỏi" /></div>
      <div><label>Mức quan tâm (1–5)</label><input class="in" type="number" min="1" max="5" value="${Number(d.interest) || 3}" /></div>
      <div><label>Mức am hiểu (1–5)</label><input class="xp" type="number" min="1" max="5" value="${Number(d.expertise) || 3}" /></div>
      <div><label class="chk"><input type="checkbox" class="tp" ${d.temporary ? "checked" : ""} /> Chỉ thử tạm thời</label></div>
    </div>
    ${kids.length ? `<div class="kids">${kids.map((c) => dirHtml(c, false)).join("")}</div>` : ""}
  </div>`;
}
function dirSumText() {
  const roots = dirDraft.filter((d) => !d.parent_id || !dirDraft.some((p) => p.id === d.parent_id));
  const sum = roots.filter((r) => r.status === "active").reduce((a, r) => a + (Number(r.share) || 0), 0);
  $("#dirSum").textContent = `Tổng tỉ lệ nhắm (hướng chính): ${sum}%${dirDirty ? " · có thay đổi chưa lưu" : ""}`;
}
function drawDirTree() {
  const roots = dirDraft.filter((d) => !d.parent_id || !dirDraft.some((p) => p.id === d.parent_id));
  const box = $("#dirTree");
  box.innerHTML = roots.map((r) => dirHtml(r, true)).join("") || '<div class="empty">Chưa có định hướng nào.</div>';
  dirSumText();
  box.oninput = () => {
    dirDirty = true;
    readDirs();
    dirSumText();
  };
  box.onclick = (e) => {
    const b = e.target.closest("[data-d]");
    if (!b) return;
    const el = b.closest(".dir");
    const id = el.dataset.id;
    if (b.dataset.d === "more") return ($(":scope > .more", el).hidden = !$(":scope > .more", el).hidden);
    readDirs();
    if (b.dataset.d === "child") dirDraft.push(newDir(id));
    if (b.dataset.d === "del") {
      if (!confirm('Xoá định hướng này? (Hướng con sẽ thành hướng chính. Muốn giữ lại để xem sau thì chọn "Lưu trữ".)')) return;
      dirDraft = dirDraft.filter((d) => d.id !== id).map((d) => (d.parent_id === id ? { ...d, parent_id: null } : d));
    }
    dirDirty = true;
    drawDirTree();
  };
}
const newDir = (parent_id = null) => ({ id: crypto.randomUUID(), name: "", description: "", parent_id, keywords: "", exclude: "", interest: 3, expertise: 3, formats: "", styles: "", share: 0, status: "active", temporary: false, knowledge: "", sources: [], origin: "user", created_at: Date.now() });
function readDirs() {
  $$("#dirTree .dir").forEach((el) => {
    const d = dirDraft.find((x) => x.id === el.dataset.id);
    if (!d) return;
    const v = (c) => $(`:scope > .more .${c}`, el)?.value ?? "";
    d.name = $(":scope > .dh .nm", el).value.trim();
    d.status = $(":scope > .dh .st", el).value;
    d.share = Number($(":scope > .dh .sh", el).value) || 0;
    Object.assign(d, { description: v("ds"), keywords: v("kw"), exclude: v("ex"), knowledge: v("kn2"), styles: v("sy"), formats: v("fm"), interest: Number(v("in")) || 3, expertise: Number(v("xp")) || 3, temporary: !!$(":scope > .more .tp", el)?.checked });
  });
}
$("#addRootDir").onclick = () => {
  readDirs();
  dirDraft.push(newDir());
  dirDirty = true;
  drawDirTree();
  $(".nm", $$("#dirTree > .dir").pop())?.focus();
};
$("#saveDirs").onclick = async () => {
  readDirs();
  const clean = dirDraft.filter((d) => d.name);
  const sugg = S.directions.filter((d) => d.status === "suggested");
  const r = await send({ type: "studio-save", name: "directions", value: [...clean, ...sugg] });
  if (!r.ok) return toast(`Lỗi: ${r.error}`);
  dirDirty = false;
  dirDraft = null;
  discoverFormBuilt = false;
  toast("Đã lưu định hướng");
};

// ---------- Nguồn dữ liệu ----------
function renderSources(force) {
  if (!force && (editing || !touched("sources", "snaps"))) return;
  const box = $("#sourceCards");
  box.innerHTML = "";
  for (const [k, ad] of Object.entries(M.adapters || {})) {
    const src = S.sources[k] || { enabled: false };
    const sn = S.snaps[k];
    const el = document.createElement("div");
    el.className = "card";
    let cfg = "";
    if (k === "weather")
      cfg = `<label class="f">Thành phố</label><div class="row"><input class="city" style="flex:1" /><button class="b s" data-a="geo">Tìm</button><button class="b s" data-a="gps" title="Hỏi vị trí của trình duyệt">📍</button></div>
        <div class="note">${src.label ? `Đang dùng: ${esc(src.label)} (${Number(src.lat).toFixed(2)}, ${Number(src.lon).toFixed(2)})` : "Chưa có toạ độ"}</div>`;
    if (k === "news") cfg = `<label class="f">Nguồn RSS / Atom <small>Mỗi dòng một link</small></label><textarea class="feeds" rows="3"></textarea>`;
    if (k === "hn") cfg = `<label class="f">Điểm tối thiểu</label><input class="minp" type="number" min="0" />`;
    if (k === "github") cfg = `<label class="f">Ngôn ngữ lập trình <small>Để trống = mọi ngôn ngữ</small></label><input class="lang" placeholder="vd: python" />`;
    if (k === "reddit") cfg = `<label class="f">Subreddit <small>Cách nhau bằng dấu phẩy</small></label><input class="subs" />`;
    const filt = ["news", "hn", "github", "reddit"].includes(k)
      ? `<div class="two"><div><label class="f">Chỉ lấy mục có từ</label><input class="kw" placeholder="để trống = tất cả" /></div><div><label class="f">Bỏ mục có từ</label><input class="exw" /></div></div>
         <label class="f">Tối đa số mục</label><input class="lim" type="number" min="3" max="50" style="width:90px" />`
      : "";
    const h = sn?.health;
    const items = sn?.items || [];
    el.innerHTML = `
      <div class="row"><h3 style="margin:0">${esc(ad.name)}</h3><span class="badge">${esc(M.groups?.[ad.group] || ad.group)}</span><span class="sp"></span>
        <label class="chk small"><input type="checkbox" class="en" ${src.enabled ? "checked" : ""} /> Bật</label></div>
      <div class="note">${esc(ad.desc)}</div>
      ${cfg}${filt}
      ${k !== "weather" && (cfg || filt) ? '<button class="b s" data-a="save" style="margin-top:8px">Lưu cấu hình</button>' : ""}
      <div class="small" style="margin-top:8px">${sn?.error ? `<div class="err">Lỗi: ${esc(sn.error)}</div>` : ""}${items.length ? `${items.length} mục:<br>${items.slice(0, 3).map((n) => `• ${esc(String(n.title).slice(0, 110))}`).join("<br>")}` : sn?.error ? "" : '<span class="muted">Chưa lấy dữ liệu</span>'}</div>
      <div class="src">${h ? (h.ok ? `🟢 Ổn · lấy ${ago(h.at)} · ${h.count} mục` : `🔴 Lỗi ${ago(h.at)}`) : ""}${sn && !sn.error ? ` · hết hạn ${fmtTime(sn.expires_at)} · tin cậy ${esc(sn.reliability)}` : ""}</div>
      <button class="b s" data-a="test" style="margin-top:8px">Thử kết nối</button>`;
    const set = (sel, v) => $(sel, el) && ($(sel, el).value = v ?? "");
    set(".city", src.city || S.profile.city || "");
    set(".feeds", (src.feeds || []).join("\n"));
    set(".minp", src.min_points);
    set(".lang", src.language);
    set(".subs", src.subs);
    set(".kw", src.keywords);
    set(".exw", src.exclude);
    set(".lim", src.limit);
    const saveSrc = (patch) => send({ type: "studio-save", name: "sources", value: { ...S.sources, [k]: { ...src, ...patch } } }).then((r) => (r.ok ? true : (toast(`Lỗi: ${r.error}`), false)));
    $(".en", el).onchange = (e) => saveSrc({ enabled: e.target.checked }).then(() => (discoverFormBuilt = false));
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const a = b.dataset.a;
      if (a === "test") {
        b.textContent = "Đang thử...";
        const r = await send({ type: "studio-collect", only: [k] });
        toast(!r.ok ? `Lỗi: ${r.error}` : r.errors?.[k] ? `Lỗi: ${r.errors[k]}` : "Kết nối được ✓");
        renderSources(true);
      } else if (a === "geo") {
        const city = $(".city", el).value.trim();
        const r = await send({ type: "studio-geocode", city });
        if (!r.ok) return toast(r.error);
        await saveSrc({ city, lat: r.lat, lon: r.lon, label: r.label, manual: false });
        toast(`Đã chọn ${r.label}`);
      } else if (a === "gps") {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = Math.round(pos.coords.latitude * 100) / 100; // làm tròn ~1km
            const lon = Math.round(pos.coords.longitude * 100) / 100;
            await saveSrc({ lat, lon, label: "Vị trí hiện tại", manual: true });
            toast("Đã dùng vị trí hiện tại (làm tròn ~1km)");
          },
          (err) => toast(`Không lấy được vị trí: ${err.message}`),
          { timeout: 15000 }
        );
      } else if (a === "save") {
        const patch = {};
        if ($(".feeds", el)) {
          const feeds = $(".feeds", el).value.split(/\s+/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x));
          const origins = [...new Set(feeds.map((f) => `${new URL(f).origin}/*`))];
          if (origins.length && !(await chrome.permissions.contains({ origins })) && !(await chrome.permissions.request({ origins }).catch(() => false))) return toast("Cần cho phép extension đọc các trang RSS mới");
          patch.feeds = feeds;
        }
        if ($(".minp", el)) patch.min_points = Number($(".minp", el).value) || 0;
        if ($(".lang", el)) patch.language = $(".lang", el).value.trim();
        if ($(".subs", el)) patch.subs = $(".subs", el).value.trim();
        if ($(".kw", el)) Object.assign(patch, { keywords: $(".kw", el).value.trim(), exclude: $(".exw", el).value.trim(), limit: Number($(".lim", el).value) || 20 });
        if (await saveSrc(patch)) toast("Đã lưu");
      }
    });
    box.appendChild(el);
  }
  const x = document.createElement("div");
  x.className = "card";
  x.innerHTML = `<h3>𝕏 X / Twitter Trends</h3><div class="note">Chưa có: X không có API xu hướng miễn phí. Khi có quyền truy cập API, đây sẽ là một adapter mới mà không cần sửa bộ khám phá.</div>`;
  box.appendChild(x);
}

// ---------- AI & chi phí ----------
function renderAi(force) {
  if (!force && (editing || !touched("config", "usage", "jobs", "sessions"))) return;
  const c = S.config;
  $("#routingCard").innerHTML = `<h3>🧭 Định tuyến theo loại việc</h3>
    <p class="note">"Tự chọn" = Groq → Gemini → Claude → Ollama. Bên nào lỗi / hết lượt thì tự chuyển bên kế tiếp, lỗi tạm thời được thử lại 1 lần. Ollama trên máy hợp với gợi ý bình luận hơn là khám phá nội dung.</p>
    ${Object.entries(c.routing || {}).map(([t, v]) => `<div class="row" style="margin:6px 0"><span style="width:140px">${esc(TASK_VI[t] || t)}</span><select class="inl rt" data-t="${t}" style="flex:1"><option value="auto">Tự chọn</option>${Object.entries(PROVIDERS).map(([id, n]) => `<option value="${id}" ${v === id ? "selected" : ""} ${providerReady(id) ? "" : "disabled"}>${esc(n)}${providerReady(id) ? "" : " (chưa cấu hình)"}</option>`).join("")}</select></div>`).join("")}
    <div class="note">Phiên bản prompt: ${Object.entries(M.prompt_versions || {}).map(([k, v]) => `${esc(TASK_VI[k] || k)} ${esc(v)}`).join(" · ")}</div>`;
  $$("#routingCard .rt").forEach((s) => (s.onchange = () => saveConfig({ routing: { ...c.routing, [s.dataset.t]: s.value } })));
  const cds = AIS.cooldowns || {};
  $("#providerCard").innerHTML = `<h3>🔌 Nhà cung cấp</h3>
    <table><tbody>${Object.entries(PROVIDERS).map(([id, n]) => {
      const cd = Object.entries(cds).find(([k, v]) => k.startsWith(id) && v.until > Date.now());
      return `<tr><td><b>${esc(n)}</b><div class="muted small">${esc(providerModel(id) || "")}</div></td><td>${providerReady(id) ? "🟢 có" : "⚪ chưa cấu hình"}${cd ? `<div class="warnbox">⏸ nghỉ tới ${fmtTime(cd[1].until)}: ${esc(cd[1].reason)}</div>` : ""}</td><td class="num">${providerReady(id) ? `<button class="b s" data-test="${id}">Thử</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>
    <div class="note" style="margin-top:6px">Điền key / chọn model ở <a href="options.html#ai" target="_blank">Cài đặt extension</a>. Key chỉ nằm trên máy này và không có trong file xuất dữ liệu.</div>`;
  $$("#providerCard [data-test]").forEach((b) =>
    (b.onclick = async () => {
      b.textContent = "...";
      const r = await send({ type: "studio-test-ai", provider: b.dataset.test });
      b.textContent = "Thử";
      toast(r.ok ? `OK: ${r.ai} (${r.ms}ms)` : `Lỗi: ${r.error}`);
    })
  );

  const U = S.usage;
  const agg = (keyFn) => {
    const m = {};
    U.forEach((u) => {
      const a = (m[keyFn(u)] = m[keyFn(u)] || { n: 0, ok: 0, ms: 0, tin: 0, tout: 0, cost: 0, fb: 0 });
      a.n++;
      if (u.ok) a.ok++;
      a.ms += u.ms || 0;
      a.tin += u.est_in || 0;
      a.tout += u.est_out || 0;
      a.cost += usageCost(u);
      if (u.fallback) a.fb++;
    });
    return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
  };
  const aggTable = (rows, label) => `<div class="table-wrap"><table><thead><tr><th>${label}</th><th class="num">Lần</th><th class="num">OK</th><th class="num">TB</th><th class="num">Token vào/ra</th><th class="num">Chi phí</th></tr></thead><tbody>${rows.map(([k, a]) => `<tr><td>${esc(k)}${a.fb ? `<div class="muted small">${a.fb} lần là bên dự phòng</div>` : ""}</td><td class="num">${a.n}</td><td class="num">${pct(a.ok, a.n)}</td><td class="num">${(a.ms / a.n / 1000).toFixed(1)}s</td><td class="num">${Math.round(a.tin / 1000)}k / ${Math.round(a.tout / 1000)}k</td><td class="num">${usd(a.cost)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Chưa có</td></tr>'}</tbody></table></div>`;
  const sessCost = S.sessions.slice(0, 10).map((s) => {
    const us = U.filter((u) => u.session_id === s.id);
    return `<tr><td>${fmtTime(s.created_at)} · ${esc(M.entries?.[s.entry?.type || "discover"] || "")}</td><td class="num">${us.length}</td><td class="num">${Math.round(us.reduce((a, u) => a + (u.est_in || 0) + (u.est_out || 0), 0) / 1000)}k</td><td class="num">${usd(us.reduce((a, u) => a + usageCost(u), 0))}</td></tr>`;
  });
  $("#usageCard").innerHTML = `<h3>📊 Mức dùng AI (${U.length} lần gọi, giữ 90 ngày)</h3>
    <p class="note">Token là ước lượng theo độ dài chữ. Bản miễn phí có thể đổi hạn mức bất cứ lúc nào: đừng coi là không giới hạn.</p>
    <div class="cols"><div><div class="lbl">Theo AI</div>${aggTable(agg((u) => `${u.provider} · ${u.model}`), "AI")}</div><div><div class="lbl">Theo loại việc</div>${aggTable(agg((u) => TASK_VI[u.task] || u.task), "Việc")}</div></div>
    <div class="cols" style="margin-top:12px"><div><div class="lbl">Chi phí theo phiên khám phá</div><table><thead><tr><th>Phiên</th><th class="num">Lần gọi</th><th class="num">Token</th><th class="num">Chi phí</th></tr></thead><tbody>${sessCost.join("") || '<tr><td colspan="4" class="empty">Chưa có</td></tr>'}</tbody></table></div>
      <div><div class="lbl">Giá tham khảo (USD / 1 triệu token, tự sửa)</div><table><tbody>${Object.entries(c.prices || {}).map(([id, p]) => `<tr><td>${esc(PROVIDERS[id] || id)}</td><td>vào <input class="inl pin" data-id="${id}" type="number" step="0.01" min="0" value="${p.in}" style="width:80px" /></td><td>ra <input class="inl pout" data-id="${id}" type="number" step="0.01" min="0" value="${p.out}" style="width:80px" /></td></tr>`).join("")}</tbody></table></div></div>
    <details style="margin-top:12px"><summary>40 lần gọi gần nhất</summary><div class="table-wrap"><table><thead><tr><th>Lúc</th><th>Việc</th><th>AI</th><th>Kết quả</th><th class="num">Thời gian</th><th class="num">Token</th></tr></thead><tbody>${U.slice(0, 40).map((u) => `<tr><td>${fmtTime(u.at)}</td><td>${esc(TASK_VI[u.task] || u.task)}${u.label ? `<div class="muted small">${esc(u.label)}</div>` : ""}</td><td>${esc(u.provider)} · ${esc(u.model)}${u.fallback ? ' <span class="badge">dự phòng</span>' : ""}${u.retry ? ' <span class="badge">thử lại</span>' : ""}</td><td>${u.ok ? "✓" : `<span class="err">${esc(u.error || "lỗi")}</span>`}</td><td class="num">${((u.ms || 0) / 1000).toFixed(1)}s</td><td class="num">${u.est_in || 0}/${u.est_out || 0}</td></tr>`).join("")}</tbody></table></div></details>`;
  $("#usageCard").onchange = (e) => {
    if (!e.target.matches(".pin, .pout")) return;
    const prices = clone(c.prices);
    $$("#usageCard .pin").forEach((x) => (prices[x.dataset.id].in = Number(x.value) || 0));
    $$("#usageCard .pout").forEach((x) => (prices[x.dataset.id].out = Number(x.value) || 0));
    saveConfig({ prices });
  };

  const wrow = (key, title, labels) => `<div><div class="lbl">${title}</div>${Object.entries(c[key] || {}).map(([k, v]) => `<div class="row" style="margin:3px 0"><span style="flex:1" class="small">${esc(labels[k] || k)}</span><input class="inl w" data-g="${key}" data-k="${k}" type="number" min="0" max="100" value="${v}" style="width:70px" /></div>`).join("")}</div>`;
  $("#weightsCard").innerHTML = `<h3>⚖ Trọng số chấm điểm</h3><p class="note">Điểm tổng = trung bình có trọng số của các điểm thành phần. Đặt 0 để bỏ một tiêu chí. Điểm cao không đảm bảo bài sẽ viral.</p>
    <div class="cols3">${wrow("opp_weights", "Cơ hội", OPP_SC)}${wrow("idea_weights", "Ý tưởng", IDEA_SC)}${wrow("critic_weights", "Biên tập bản nháp", M.dims || {})}</div>`;
  $("#weightsCard").onchange = (e) => {
    if (!e.target.classList.contains("w")) return;
    const g = e.target.dataset.g;
    saveConfig({ [g]: { ...c[g], [e.target.dataset.k]: Number(e.target.value) || 0 } });
  };
  renderJobs();
}
async function saveConfig(patch) {
  const r = await send({ type: "studio-save", name: "config", value: { ...S.config, ...patch } });
  toast(r.ok ? "Đã lưu" : `Lỗi: ${r.error}`);
}
function renderJobs() {
  const rows = S.jobs.map((j) => {
    const dur = j.completed_at ? `${Math.round((j.completed_at - j.started_at) / 1000)}s` : "";
    const m = j.metadata || {};
    const result =
      j.status === "Succeeded"
        ? j.job_type === "discover"
          ? `${m.opportunities || 0} cơ hội, ${m.ideas || 0} ý tưởng${m.ai ? ` · ${esc(m.ai)}` : ""}${m.dropped?.length ? `<div class="note">Bỏ vì trùng: ${esc(m.dropped.join("; "))}</div>` : ""}`
          : `${m.posts || 0} bản nháp, ${m.images || 0} ảnh · ${esc(m.idea || "")}`
        : esc(m.step || m.note || "");
    return `<tr><td>${fmtTime(j.started_at)}</td><td>${esc(j.label || j.job_type)}<div class="muted small">${esc({ manual: "bấm tay", schedule: "theo lịch", retry: "chạy lại" }[j.trigger] || j.trigger)}</div></td>
      <td>${badge(j.status)}</td><td>${result}${j.error_message ? `<div class="${j.status === "Succeeded" ? "warnbox" : "err"}">${esc(j.error_message)}</div>` : ""}</td><td class="num">${dur}</td></tr>`;
  });
  $("#jobRows").innerHTML = rows.join("") || '<tr><td colspan="5" class="empty">Chưa chạy lần nào</td></tr>';
}

// ---------- Cài đặt ----------
function renderSettings(force) {
  if (!force && (editing || !touched("config"))) return;
  const c = S.config;
  const sd = c.session_defaults || {};
  $("#setGeneral").innerHTML = `<h3>⚙ Chung</h3>
    <label class="f">Nền tảng mặc định</label><select id="sPlatform">${Object.entries(M.platforms || {}).map(([k, v]) => `<option value="${k}" ${k === c.platform ? "selected" : ""}>${esc(v.name)} (tối đa ${v.limit} ký tự)</option>`).join("")}</select>
    <div class="lbl" style="margin-top:14px">Mặc định cho phiên khám phá</div>
    <div class="two">
      <div><label class="f">Độ sâu</label><select id="sDepth"><option value="quick">Nhanh</option><option value="normal">Vừa</option><option value="deep">Sâu</option></select></div>
      <div><label class="f">Thời gian của tin</label><select id="sHours"><option value="24">24 giờ</option><option value="72">3 ngày</option><option value="168">7 ngày</option><option value="0">Không giới hạn</option></select></div>
      <div><label class="f">Số cơ hội</label><input id="sOpps" type="number" min="2" max="10" /></div>
      <div><label class="f">Số ý tưởng</label><input id="sIdeas" type="number" min="2" max="12" /></div>
    </div>
    <div class="lbl" style="margin-top:14px">Ảnh</div>
    <label class="chk" style="margin-top:6px"><input id="sImgAuto" type="checkbox" /> Tự vẽ ảnh khi viết nháp (chỉ cho bản AI thấy đáng có ảnh)</label>
    <label class="f">Phong cách ảnh</label><input id="sImgStyle" />
    <label class="f">Khung ảnh</label><select id="sImgAspect"><option value="1:1">1:1 vuông</option><option value="4:5">4:5 dọc</option><option value="16:9">16:9 ngang</option></select>
    <p class="note">Ảnh AI vẽ bằng Pollinations (miễn phí, ~30 giây/ảnh, có dấu "pollinations.ai"). Mỗi bài còn có Ảnh chữ, Tìm ảnh (Openverse, có ghi nguồn) và Tải ảnh lên.</p>
    <div class="lbl" style="margin-top:14px">Khám phá theo lịch (tuỳ chọn)</div>
    <label class="chk" style="margin-top:6px"><input id="sSched" type="checkbox" /> Tự khám phá vào các giờ (chỉ tạo cơ hội + ý tưởng, không viết bài, không đăng)</label>
    <input id="sTimes" placeholder="07:00, 17:00" style="margin-top:6px" />
    <p class="note">Mặc định tắt: Studio chạy khi bạn bấm. Chrome phải đang mở. Phiên nào ngữ cảnh không đổi so với phiên trước thì tự bỏ qua.</p>
    <div class="row" style="margin-top:10px"><button class="b p" id="sSave">Lưu cài đặt</button></div>`;
  $("#sDepth").value = sd.depth || "normal";
  $("#sHours").value = String(sd.hours ?? 24);
  $("#sOpps").value = sd.opportunities || 5;
  $("#sIdeas").value = sd.ideas || 6;
  $("#sImgAuto").checked = !!c.image_auto;
  $("#sImgStyle").value = c.image_style || "";
  $("#sImgAspect").value = c.image_aspect || "1:1";
  $("#sSched").checked = !!c.schedule_enabled;
  $("#sTimes").value = (c.schedule_times || []).join(", ");
  $("#sSave").onclick = async () => {
    await saveConfig({
      platform: $("#sPlatform").value,
      session_defaults: { depth: $("#sDepth").value, hours: Number($("#sHours").value), opportunities: Number($("#sOpps").value) || 5, ideas: Number($("#sIdeas").value) || 6 },
      image_auto: $("#sImgAuto").checked, image_style: $("#sImgStyle").value.trim(), image_aspect: $("#sImgAspect").value,
      schedule_enabled: $("#sSched").checked,
      schedule_times: $("#sTimes").value.split(/[,\s]+/).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).map((x) => x.padStart(5, "0"))
    });
    discoverFormBuilt = false;
  };
  $("#setData").innerHTML = `<h3>🗄 Dữ liệu của bạn</h3>
    <p class="note">Mọi thứ của Studio nằm trong bộ nhớ của Chrome trên máy này. Chỉ phần chữ cần thiết được gửi tới AI bạn chọn khi chạy.</p>
    <label class="chk"><input type="checkbox" id="exImg" /> Kèm ảnh (file sẽ nặng)</label>
    <div class="row" style="margin-top:8px"><button class="b" id="btnExport">⬇ Xuất dữ liệu (JSON)</button><button class="b" id="btnImport">⬆ Nhập từ file</button><input type="file" id="importFile" accept="application/json" hidden /></div>
    <p class="note">File xuất có hồ sơ, kiến thức, định hướng, nguồn, cơ hội, ý tưởng, bài, phản hồi, nhật ký AI. Không có API key.</p>
    <div class="row" style="margin-top:14px"><button class="b" id="btnPrune">🧹 Dọn thứ cũ hơn 30 ngày</button><button class="b bad" id="btnWipe">Xoá toàn bộ dữ liệu Studio</button></div>
    <p class="note">Dọn: giữ lại bài đã duyệt / đăng / lưu và các ý tưởng, cơ hội gắn với chúng.</p>`;
  $("#btnExport").onclick = exportData;
  $("#btnImport").onclick = () => $("#importFile").click();
  $("#importFile").onchange = importData;
  $("#btnPrune").onclick = async () => {
    const r = await send({ type: "studio-prune" });
    toast(r.ok ? "Đã dọn" : `Lỗi: ${r.error}`);
  };
  $("#btnWipe").onclick = async () => {
    if (!confirm("Xoá TOÀN BỘ dữ liệu Content Studio (hồ sơ, kiến thức, ý tưởng, bài, ảnh...)? Không hoàn tác được. Nên Xuất dữ liệu trước.")) return;
    if (prompt("Gõ XOA để xác nhận") !== "XOA") return toast("Đã huỷ");
    const r = await send({ type: "studio-wipe" });
    toast(r.ok ? `Đã xoá ${r.removed} mục` : `Lỗi: ${r.error}`);
    if (r.ok) setTimeout(() => location.reload(), 800);
  };
}
async function exportData() {
  const all = await chrome.storage.local.get(null);
  const withImg = $("#exImg").checked;
  const data = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("studio") && (withImg || !k.startsWith("studioImg:"))));
  const blob = new Blob([JSON.stringify({ app: "content-studio", version: 2, exported_at: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `content-studio-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "content-studio" || !j.data) throw new Error("Không phải file xuất của Content Studio");
    const data = Object.fromEntries(Object.entries(j.data).filter(([k]) => k.startsWith("studio")));
    if ((await send({ type: "studio-busy" })).busy) throw new Error("Đang có việc chạy, đợi xong đã");
    if (!confirm(`Nhập ${Object.keys(data).length} mục? Dữ liệu cùng loại hiện có sẽ bị thay thế.`)) return;
    await chrome.storage.local.set(data);
    toast("Đã nhập dữ liệu");
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    toast(`Lỗi: ${err.message}`);
  }
}

// ---------- Khởi động ----------
(async () => {
  await load();
  let start = "dash";
  try { start = localStorage.getItem("studioTab") || "dash"; } catch (_) {}
  showTab($(`#nav [data-tab="${start}"]`) ? start : "dash");
  // Lần đầu mở: lấy ngữ cảnh luôn cho có cái xem.
  if (!S.snaps.weather && !S.snaps.news) $("#btnCollect").click();
})();
