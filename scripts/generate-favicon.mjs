import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const indigo = '#4f46e5';

function svg(size) {
  // WISE mark: purple mirrored trapezoids on transparent background
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <polygon fill="${indigo}" points="9.6,5.8 14.15,5.8 14.15,26.2 4.4,26.2"/>
  <polygon fill="${indigo}" points="17.85,5.8 22.4,5.8 27.6,26.2 17.85,26.2"/>
</svg>`;
}

function pngToIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  const parts = [];
  for (const buf of pngBuffers) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    entries.push({ w: w >= 256 ? 0 : w, h: h >= 256 ? 0 : h, size: buf.length, offset });
    parts.push(buf);
    offset += buf.length;
  }
  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);
  let eoff = 6;
  for (const e of entries) {
    out.writeUInt8(e.w, eoff);
    eoff++;
    out.writeUInt8(e.h, eoff);
    eoff++;
    out.writeUInt8(0, eoff);
    eoff++;
    out.writeUInt8(0, eoff);
    eoff++;
    out.writeUInt16LE(1, eoff);
    eoff += 2;
    out.writeUInt16LE(32, eoff);
    eoff += 2;
    out.writeUInt32LE(e.size, eoff);
    eoff += 4;
    out.writeUInt32LE(e.offset, eoff);
    eoff += 4;
  }
  let poff = headerSize;
  for (const p of parts) {
    p.copy(out, poff);
    poff += p.length;
  }
  return out;
}

const appDir = path.join('src', 'app');
const publicDir = 'public';
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

fs.writeFileSync(path.join(appDir, 'icon.svg'), svg(32));
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg(32));

const png16 = await sharp(Buffer.from(svg(32))).resize(16, 16).png().toBuffer();
const png32 = await sharp(Buffer.from(svg(32))).resize(32, 32).png().toBuffer();

await sharp(png32).toFile(path.join(appDir, 'icon.png'));
await sharp(Buffer.from(svg(32))).resize(180, 180).png().toFile(path.join(appDir, 'apple-icon.png'));
await sharp(png32).toFile(path.join(publicDir, 'favicon-32.png'));
await sharp(png16).toFile(path.join(publicDir, 'favicon-16.png'));
await sharp(Buffer.from(svg(32))).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));
await sharp(Buffer.from(svg(32))).resize(512, 512).png().toFile(path.join(publicDir, 'icon-512.png'));

const ico = pngToIco([png16, png32]);
fs.writeFileSync(path.join(appDir, 'favicon.ico'), ico);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), ico);

console.log('favicon assets written');
