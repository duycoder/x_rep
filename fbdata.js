// Trang "Dữ liệu bài viết": xem bài Facebook đã lưu, kiểm tra trùng, sửa, đưa vào dữ liệu train.
const $ = (id) => document.getElementById(id);
const STATUS = { new: "Chờ duyệt", train: "Đã vào train", dup: "Trùng", skip: "Bỏ qua" };
const PAGE_SIZE = 20;
let items = [];
let filter = "new";
let pageNo = 0; // trang đang xem (từ 0)
const selected = new Set();
const edits = {}; // id -> chữ đã sửa (gửi kèm khi đưa vào train)

const send = (msg) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r));
    } catch (_) {
      resolve(null);
    }
  });
const st = (p) => p.status || "new";
const fmt = (ts) => new Date(ts).toLocaleString("vi-VN", { hour12: false });
const say = (t) => ($("msg").textContent = t);

async function load() {
  const r = await send({ type: "fb-list" });
  items = ((r && r.items) || []).slice().reverse(); // mới nhất trước
  const pages = [...new Set(items.map((p) => p.page))].sort();
  const sel = $("page");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Mọi page</option>' + pages.map((p) => `<option></option>`).join("");
  pages.forEach((p, i) => {
    sel.options[i + 1].value = p;
    sel.options[i + 1].textContent = p.replace(/^id:/, "");
  });
  sel.value = pages.includes(cur) ? cur : "";
  for (const id of [...selected]) if (!items.some((p) => p.id === id)) selected.delete(id);
  render();
}

function visible() {
  const q = $("q").value.trim().toLowerCase();
  const page = $("page").value;
  return items.filter(
    (p) => (filter === "all" || st(p) === filter) && (!page || p.page === page) && (!q || p.text.toLowerCase().includes(q))
  );
}

function render() {
  const c = { new: 0, train: 0, dup: 0, skip: 0 };
  items.forEach((p) => c[st(p)]++);
  $("stats").textContent =
    `${items.length} bài đã lưu · ${c.new} chờ duyệt · ${c.train} đã vào train · ${c.dup} trùng · ${c.skip} bỏ qua` +
    (selected.size ? ` · đang chọn ${selected.size}` : "");
  ["approve", "skip", "back", "del"].forEach((id) => ($(id).disabled = !selected.size));

  const list = visible();
  const box = $("list");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<div class="empty">${items.length ? "Không có bài nào ở mục này." : "Chưa có bài nào. Mở page Facebook (trong Cài đặt) rồi lướt xuống để lưu."}</div>`;
  }
  const byId = new Map(items.map((p) => [p.id, p]));
  const go = (n) => {
    pageNo = n;
    render();
    scrollTo(0, 0);
  };
  pageNo = renderPager($("pagerTop"), list.length, pageNo, PAGE_SIZE, go);
  renderPager($("pagerBot"), list.length, pageNo, PAGE_SIZE, go);
  list.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE).forEach((p) => box.appendChild(card(p, byId)));
}

function card(p, byId) {
  const s = st(p);
  const el = document.createElement("div");
  el.className = "card" + (selected.has(p.id) ? " sel" : "");

  const meta = document.createElement("div");
  meta.className = "meta";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selected.has(p.id);
  cb.addEventListener("change", () => {
    cb.checked ? selected.add(p.id) : selected.delete(p.id);
    el.classList.toggle("sel", cb.checked);
    render();
  });
  const chip = Object.assign(document.createElement("span"), { className: `chip ${s}`, textContent: STATUS[s] });
  meta.append(cb, chip);
  const info = document.createElement("span");
  const text = edits[p.id] ?? p.text;
  info.textContent = `${p.page.replace(/^id:/, "")} · lưu ${fmt(p.ts)} · ${text.length} ký tự`;
  meta.appendChild(info);
  if (p.url) {
    const a = Object.assign(document.createElement("a"), { href: p.url, target: "_blank", rel: "noopener", textContent: "Mở bài" });
    meta.appendChild(a);
  }
  el.appendChild(meta);

  if (s === "dup") {
    const d = document.createElement("div");
    d.className = "dupinfo";
    const orig = byId.get(p.dupOf);
    d.textContent = `Giống ${p.sim || "?"}% một bài ${orig ? `(${STATUS[st(orig)].toLowerCase()})` : "đã có"}:`;
    if (orig) d.appendChild(Object.assign(document.createElement("span"), { className: "orig", textContent: orig.text.replace(/\s+/g, " ") }));
    el.appendChild(d);
  }

  if (s === "train") {
    el.appendChild(Object.assign(document.createElement("div"), { className: "text", textContent: p.train ? p.train.assistant : p.text }));
  } else {
    // Chưa vào train: sửa được (bỏ đoạn quảng cáo, chữ thừa) trước khi đưa vào.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.rows = Math.min(12, Math.max(3, Math.ceil(text.length / 90)));
    ta.addEventListener("input", () => {
      if (ta.value === p.text) delete edits[p.id];
      else edits[p.id] = ta.value;
    });
    el.appendChild(ta);
  }

  // Định dạng sẽ đưa vào file train (một dòng JSONL).
  const det = document.createElement("details");
  det.appendChild(Object.assign(document.createElement("summary"), { textContent: "Định dạng train" }));
  const pre = document.createElement("pre");
  det.appendChild(pre);
  det.addEventListener("toggle", async () => {
    if (!det.open) return;
    const t = p.train || (await send({ type: "fb-preview", text: edits[p.id] ?? p.text }));
    pre.textContent = t
      ? JSON.stringify({ messages: [{ role: "user", content: t.user }, { role: "assistant", content: t.assistant }] }, null, 2)
      : "Không xem trước được.";
  });
  el.appendChild(det);
  return el;
}

// ---------- nút ----------
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  filter = b.dataset.f;
  pageNo = 0;
  selected.clear();
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
$("page").addEventListener("change", () => ((pageNo = 0), render()));
$("q").addEventListener("input", () => ((pageNo = 0), render()));
$("selAll").addEventListener("click", () => {
  const list = visible().slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE); // chọn hết trong trang đang xem
  const all = list.every((p) => selected.has(p.id));
  list.forEach((p) => (all ? selected.delete(p.id) : selected.add(p.id)));
  render();
});

$("dupBtn").addEventListener("click", async () => {
  say("Đang kiểm tra trùng...");
  const r = await send({ type: "fb-dupcheck" });
  await load();
  say(r ? `Xong: ${r.dup} bài trùng, ${r.fresh} bài chờ duyệt không trùng.` : "Lỗi khi kiểm tra trùng.");
});

$("approve").addEventListener("click", async () => {
  const ids = [...selected];
  say(`Đang đưa ${ids.length} bài vào dữ liệu train...`);
  const e = {};
  ids.forEach((id) => edits[id] != null && (e[id] = edits[id]));
  const r = await send({ type: "fb-approve", ids, edits: e });
  if (!r || r.error) return say(`Lỗi: ${(r && r.error) || "không rõ"}`);
  ids.forEach((id) => delete edits[id]);
  selected.clear();
  await load();
  say(
    `Đã đưa ${r.added} bài vào dữ liệu train.` +
      (r.dup ? ` ${r.dup} bài trùng nên bỏ qua.` : "") +
      (r.short ? ` ${r.short} bài quá ngắn sau khi làm sạch.` : "") +
      " Vào Cài đặt → Xuất dữ liệu huấn luyện để lấy file train."
  );
});

async function setStatus(status, label) {
  const ids = [...selected];
  await send({ type: "fb-set-status", ids, status });
  selected.clear();
  await load();
  say(`${label} ${ids.length} bài.`);
}
$("skip").addEventListener("click", () => setStatus("skip", "Đã bỏ qua"));
$("back").addEventListener("click", () => setStatus("new", "Đã đưa về chờ duyệt"));
$("del").addEventListener("click", async () => {
  if (!confirm(`Xoá hẳn ${selected.size} bài khỏi dữ liệu? (File trên ổ D: vẫn giữ.)`)) return;
  const ids = [...selected];
  await send({ type: "fb-delete", ids });
  selected.clear();
  await load();
  say(`Đã xoá ${ids.length} bài.`);
});

// Bài mới được lưu (đang lướt Facebook ở tab khác) thì tự cập nhật.
let reloadT = null;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.fbPosts) return;
  clearTimeout(reloadT);
  reloadT = setTimeout(load, 600);
});
load();
