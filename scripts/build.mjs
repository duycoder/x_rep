// Đóng gói extension thành zip trong thư mục release/.
// VERSION=1.0.7 npm run build  -> ghi đè version trong manifest của bản zip (file gốc không đổi).
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FILES = [
  "manifest.json", "background.js", "content.js", "templates.js",
  "options.html", "options.js", "popup.html", "popup.js",
  "studio.html", "studio.js", "studio-core.js", "imagekit.js", "xhook.js", "postopts.js",
  "fbhook.js", "fbsave.js", "thhook.js", "thsave.js", "fbdata.html", "fbdata.js", "pager.js", "tabs.js",
];
const DIRS = ["icons"];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (process.env.VERSION) manifest.version = process.env.VERSION;

const zip = new AdmZip();
for (const f of FILES) {
  if (f === "manifest.json") zip.addFile(f, Buffer.from(JSON.stringify(manifest, null, 2)));
  else zip.addLocalFile(path.join(root, f));
}
for (const d of DIRS) zip.addLocalFolder(path.join(root, d), d);

const out = path.join(root, "release");
fs.mkdirSync(out, { recursive: true });
zip.writeZip(path.join(out, `x-comment-extension-v${manifest.version}.zip`));
zip.writeZip(path.join(out, "latest.zip"));
console.log(`Built release/x-comment-extension-v${manifest.version}.zip`);
