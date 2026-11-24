// Chương trình nhỏ ghi bài đăng / câu trả lời ra ổ đĩa cho extension (Native Messaging).
// Brave tự chạy nó mỗi lần cần lưu rồi tắt, không cần mở sẵn. Không có hộp thoại "Save as".
// Nhận: { root, dir, files: [{ name, text }], images: [{ name, url }] }  →  trả về { ok, dir } hoặc { ok: false, error }
const fs = require("fs");
const path = require("path");

const clean = (s) =>
  String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80);

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([len, body]));
}

async function handle(msg) {
  const root = String(msg.root || "");
  if (!path.isAbsolute(root)) throw new Error(`Thư mục lưu phải là đường dẫn đầy đủ, vd D:\\MMO\\X-data (đang là "${root}")`);
  const parts = String(msg.dir || "").split(/[\\/]/).map(clean).filter(Boolean);
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of msg.files || []) fs.writeFileSync(path.join(dir, clean(f.name)), String(f.text || ""), "utf8");
  for (const im of msg.images || []) {
    const url = String(im.url || "");
    if (!/^https:\/\/(pbs|video)\.twimg\.com\//.test(url)) continue;
    try {
      const res = await fetch(url);
      if (res.ok) fs.writeFileSync(path.join(dir, clean(im.name)), Buffer.from(await res.arrayBuffer()));
    } catch (_) {
      // ảnh lỗi thì bỏ qua, chữ vẫn được lưu
    }
  }
  return { ok: true, dir };
}

// Đọc đúng một tin nhắn: 4 byte độ dài + JSON.
let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (buf.length < 4) return;
  const n = buf.readUInt32LE(0);
  if (buf.length < 4 + n) return;
  const msg = JSON.parse(buf.slice(4, 4 + n).toString("utf8"));
  buf = Buffer.alloc(0);
  handle(msg)
    .then(send, (e) => send({ ok: false, error: e.message }))
    .finally(() => setTimeout(() => process.exit(0), 50));
});
