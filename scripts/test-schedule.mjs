// Thử tính năng "Hẹn giờ đăng" trên Brave thật, không đăng gì.
//   node scripts/test-schedule.mjs            (hỏi trước khi khởi động lại Brave)
//   node scripts/test-schedule.mjs --restart  (tự khởi động lại Brave nếu chưa bật cổng debug)
//   node scripts/test-schedule.mjs --keep     (để lại tab X sau khi thử, mặc định đóng tab)
// Các bước: nối Brave qua CDP → tải lại extension (lấy code mới) → ghi bài chờ hẹn (giống nút ⏰ trên Facebook)
// → mở x.com/home → kiểm tra giờ X điền đúng giờ kế tiếp → bấm Confirm (KHÔNG bấm Schedule) → kiểm tra bài còn nguyên.
import { spawn, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const PORT = Number(process.env.XCS_CDP_PORT || 9223);
const BRAVE = process.env.BRAVE_PATH || "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const EXT_NAME = "X Gợi Ý Bình Luận";
const TEST_TEXT = "[TEST hẹn giờ] bài thử, không đăng";
const args = new Set(process.argv.slice(2));
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  return ok;
};
const fail = (msg) => {
  console.log(`❌ ${msg}`);
  process.exit(1);
};

async function version() {
  try {
    return await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1500) })).json();
  } catch {
    return null;
  }
}
const targets = async () => (await fetch(`${base}/json/list`)).json();

// Một kết nối CDP nhỏ tới một target (tab / service worker).
async function attach(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) pend.get(d.id)(d);
  };
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (fn, ...a) => {
    const r = await send("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval error");
    return r.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// ---------- 1. Nối Brave ----------
async function ensureBrave() {
  if (await version()) return check("Brave có cổng debug " + PORT, true);
  let running = false;
  try {
    running = /brave\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq brave.exe"', { encoding: "utf8" }));
  } catch {}
  if (running) {
    let ok = args.has("--restart");
    if (!ok && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      ok = /^y/i.test(await rl.question("Brave đang mở nhưng chưa bật cổng debug. Đóng và mở lại (tab được khôi phục)? [y/N] "));
      rl.close();
    }
    if (!ok) fail("Brave chưa bật cổng debug. Chạy lại với --restart, hoặc tự mở Brave với --remote-debugging-port=" + PORT);
    execSync("taskkill /IM brave.exe /F", { stdio: "ignore" });
    await sleep(1500);
  }
  spawn(BRAVE, [`--remote-debugging-port=${PORT}`, "--restore-last-session"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 20 && !(await version()); i++) await sleep(1000);
  if (!(await version())) fail("Không mở được Brave với cổng debug " + PORT);
  check("Đã mở Brave với cổng debug " + PORT, true);
  await sleep(3000); // chờ extension khởi động
}

// ---------- 2. Mở một trang của extension (service worker MV3 hay ngủ, không tìm được) ----------
// ID của extension "Load unpacked" = sha256(đường dẫn thư mục, UTF-16LE) → 32 chữ a–p.
const ROOT = path.resolve(import.meta.dirname, "..").replace(/^[a-z]:/, (d) => d.toUpperCase());
const EXT_ID = process.env.XCS_EXT_ID ||
  [...crypto.createHash("sha256").update(Buffer.from(ROOT, "utf16le")).digest("hex").slice(0, 32)]
    .map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
async function findExt() {
  const t = await (await fetch(`${base}/json/new?chrome-extension://${EXT_ID}/popup.html`, { method: "PUT" })).json();
  await sleep(1200);
  const c = await attach(t);
  const name = await c.evaluate(() => chrome.runtime.getManifest().name).catch(() => null);
  const closeTab = async () => {
    c.close();
    await fetch(`${base}/json/close/${t.id}`).catch(() => {});
  };
  if (name === EXT_NAME) return { c, id: EXT_ID, closeTab };
  await closeTab();
  return null;
}

// Giống nextSlot() trong content.js
function nextSlot(list, gapMin, now) {
  const step = 5 * 60e3, gap = gapMin * 60e3, up = (t) => Math.ceil(t / step) * step;
  const ats = list.map((x) => x.at).sort((a, b) => a - b);
  let at = up(now + 15 * 60e3);
  for (let g = 0; g < 500; g++) {
    const clash = ats.find((s) => Math.abs(at - s) < gap);
    if (clash == null) break;
    at = up(clash + gap);
  }
  return new Date(at);
}
const sel = (d) => ({ month: String(d.getMonth() + 1), day: String(d.getDate()), year: String(d.getFullYear()), hour: String(d.getHours() % 12 || 12), minute: String(d.getMinutes()), ampm: d.getHours() < 12 ? "am" : "pm" });
const fmt = (d) => d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

// ---------- Chạy ----------
await ensureBrave();

let ext = await findExt();
if (!check("Extension đang chạy", !!ext, ext ? ext.id : `(${EXT_ID} chưa cài trong Brave? Load unpacked thư mục ${ROOT})`)) process.exit(1);
// Tải lại để chạy code mới nhất trong thư mục (trang popup tự đóng theo)
await ext.c.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50)).catch(() => {});
await ext.closeTab();
await sleep(2500);
ext = await findExt();
if (!check("Đã tải lại extension (code mới nhất)", !!ext)) process.exit(1);

const st = await ext.c.evaluate(async (text) => {
  const s = await chrome.storage.local.get({ schedList: [], schedGapMin: 60 });
  const now = Date.now();
  await chrome.storage.local.set({ schedPending: { text, ts: now } });
  return { ...s, now };
}, TEST_TEXT);
await ext.closeTab();
const list = st.schedList.filter((x) => x.at > st.now);
console.log(`   Bài đã hẹn: ${list.length ? list.map((x) => fmt(new Date(x.at))).join(", ") : "(không có)"} · cách ${st.schedGapMin} phút`);

const tab = await (await fetch(`${base}/json/new?https://x.com/home`, { method: "PUT" })).json();
const page = await attach(tab);
let report = null;
try {
  const state = await page.evaluate(async () => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (document.querySelector('[data-testid="loginButton"], [data-testid="login"]') || location.pathname === "/") return { loggedOut: true };
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.querySelectorAll("select").length >= 5);
      if (d) {
        await new Promise((r) => setTimeout(r, 1500)); // chờ extension chọn xong các ô
        const out = {};
        const twelves = [];
        for (const s of d.querySelectorAll("select")) {
          const vals = [...s.options].map((o) => o.value).filter((v) => v !== "");
          if (vals.length === 2) out.ampm = s.value;
          else if (vals.length >= 55) out.minute = s.value;
          else if (vals.some((v) => /^\d{4}$/.test(v))) out.year = s.value;
          else if (vals.length >= 28 && vals.length <= 31) out.day = s.value;
          else if (vals.length === 12) twelves.push(s.value);
        }
        out.month = twelves[0];
        out.hour = twelves[1];
        return { selects: out };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { timeout: true };
  });
  if (state.loggedOut) fail("Brave chưa đăng nhập X");
  if (!check("Mở được bảng Hẹn giờ của X", !!state.selects)) throw new Error("no dialog");

  // Giờ mong đợi: tính tại lúc ghi bài chờ và lúc kiểm tra (có thể vừa qua mốc 5 phút)
  const exp = [nextSlot(list, st.schedGapMin, st.now), nextSlot(list, st.schedGapMin, Date.now())];
  const got = state.selects;
  const same = (e) => Object.entries(sel(e)).every(([k, v]) => String(got[k]).toLowerCase() === v);
  const match = exp.find(same);
  check("Giờ hẹn đúng giờ kế tiếp", !!match, `X: ${got.day}/${got.month} ${got.hour}:${String(got.minute).padStart(2, "0")} ${got.ampm} · mong đợi: ${fmt(exp[0])}`);

  const after = await page.evaluate(async () => {
    const b =
      document.querySelector('[data-testid="scheduledConfirmationPrimaryAction"]') ||
      [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^(confirm|xác nhận)$/i.test(x.innerText.trim()));
    if (!b) return { noConfirm: true };
    b.click(); // Confirm chỉ quay về khung soạn, chưa hẹn gì
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const ta = [...document.querySelectorAll('[role="dialog"] [data-testid="tweetTextarea_0"]')][0];
      if (ta) return { text: ta.innerText.trim(), btn: (document.querySelector('[role="dialog"] [data-testid="tweetButton"]') || {}).innerText };
    }
    return { noComposer: true };
  });
  check("Bấm Confirm → bài còn nguyên trong khung soạn", after.text === TEST_TEXT, after.text != null ? `"${after.text}"` : JSON.stringify(after));
  check("Nút chính là Schedule (chưa đăng)", /schedule|lên lịch|hẹn/i.test(after.btn || ""), after.btn || "");
} catch (e) {
  if (e.message !== "no dialog") console.log("❌ Lỗi: " + e.message);
} finally {
  const shot = path.join(os.tmpdir(), `xcs-schedule-${Date.now()}.png`);
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    fs.writeFileSync(shot, Buffer.from(r.result.data, "base64"));
    console.log("   Ảnh: " + shot);
  }
  page.close();
  if (!args.has("--keep")) await fetch(`${base}/json/close/${tab.id}`).catch(() => {}); // đóng tab, bài thử không được lưu
  else console.log("   Để lại tab X: nhớ đóng và Discard, đừng bấm Schedule.");
}

const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `\n${bad} bước lỗi.` : "\nTất cả đều đạt. Không có bài nào được hẹn.");
process.exit(bad ? 1 : 0);
