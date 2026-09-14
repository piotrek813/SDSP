/*
 * make-ico.mjs — renders favicon.svg at every tray/icon size and assembles a
 * proper Windows .ico (BMP frames, 32-bit BGRA) that both Explorer and the
 * systray LoadImage API accept.
 * Run: node tools/make-ico.mjs   (needs Chromium, writes server/assets/icon.ico)
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(root, "favicon.svg");
const outPath = path.join(root, "server", "assets", "icon.ico");

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setContent(`<html><body style="margin:0;background:transparent"></body></html>`);
const svgText = fs.readFileSync(svgPath, "utf8");

const frames = [];
for (const size of SIZES) {
  const b64 = await page.evaluate(async (size, svgText) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    // chunked base64 (spread would blow the arg limit at 256px)
    let bin = "";
    for (let i = 0; i < d.length; i += 8192) {
      bin += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
    }
    return btoa(bin);
  }, size, svgText);
  frames.push({ size, rgba: Buffer.from(b64, "base64") });
}
await browser.close();

// ICO assembly: BITMAPINFOHEADER + bottom-up BGRA (XOR) + opaque AND mask
function bmpFrame(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);      // XOR + AND heights
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const si = src + x * 4;
      const di = (y * size + x) * 4;
      xor[di] = rgba[si + 2];       // B
      xor[di + 1] = rgba[si + 1];   // G
      xor[di + 2] = rgba[si];       // R
      xor[di + 3] = rgba[si + 3];   // A
    }
  }
  const andRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(andRow * size); // fully opaque
  return Buffer.concat([header, xor, and]);
}

frames.sort((a, b) => a.size - b.size);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);              // icon type
header.writeUInt16LE(frames.length, 4);
const entries = [];
const blobs = [];
let offset = 6 + 16 * frames.length;
for (const f of frames) {
  const data = bmpFrame(f.rgba, f.size);
  const e = Buffer.alloc(16);
  const b = f.size >= 256 ? 0 : f.size;
  e.writeUInt8(b, 0); e.writeUInt8(b, 1);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(e);
  blobs.push(data);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...blobs]));
console.log(`wrote ${outPath} (${frames.length} sizes: ${frames.map(f => f.size).join(", ")})`);
