// Generates every icon the site needs from the one master SVG (`public/icons/jobsentinel.svg`).
// Run after editing the master: `pnpm --filter @jobsentinel/web icons`. Outputs are committed, so
// builds never depend on this script or on native image libraries.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => path.join(root, ...p);
const master = await readFile(out('public/icons/jobsentinel.svg'), 'utf8');

// The tile has transparent corners. Platforms that apply their own mask (iOS home screen, Android
// "maskable") need the background to reach the edges, or the corners show as black.
const fullBleed = master
  .replace(
    /<clipPath id="tileClip">[\s\S]*?<\/clipPath>/,
    '<clipPath id="tileClip"><rect width="512" height="512"/></clipPath>',
  )
  .replace(/<rect x="17\.5"[^>]*\/>/, '')
  .replace(
    /<rect x="16" y="16" width="480" height="480" fill="url\(#tile\)"\/>/,
    '<rect width="512" height="512" fill="url(#tile)"/>',
  );

const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

/** A .ico holding PNG images, which every current browser and Windows accept. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // width (0 means 256)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

/** Link-preview card (Open Graph): the icon beside the name and what the product does. */
function openGraphSvg(iconDataUri) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.5" r="0.45">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.55"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <image href="${iconDataUri}" x="110" y="165" width="300" height="300"/>
  <text x="470" y="285" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="78" font-weight="700" fill="#ffffff">JobSentinel AI</text>
  <text x="472" y="355" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="34" fill="#c7d2fe">Verified fresher jobs, matched to your resume.</text>
  <text x="472" y="415" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="26" fill="#a5b4fc">Discover · Verify · Match · Alert</text>
</svg>`;
}

const [i16, i32, i48] = await Promise.all([png(master, 16), png(master, 32), png(master, 48)]);
const icon512 = await png(master, 512);

await Promise.all([
  writeFile(out('app/icon.svg'), master),
  writeFile(
    out('app/favicon.ico'),
    ico([
      { size: 16, data: i16 },
      { size: 32, data: i32 },
      { size: 48, data: i48 },
    ]),
  ),
  writeFile(out('app/apple-icon.png'), await png(fullBleed, 180)),
  writeFile(out('public/icons/icon-192.png'), await png(master, 192)),
  writeFile(out('public/icons/icon-512.png'), icon512),
  writeFile(out('public/icons/icon-maskable-512.png'), await png(fullBleed, 512)),
  writeFile(
    out('app/opengraph-image.png'),
    await sharp(Buffer.from(openGraphSvg(`data:image/png;base64,${icon512.toString('base64')}`)))
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ),
]);
console.log(
  'icons written: app/{icon.svg,favicon.ico,apple-icon.png,opengraph-image.png}, public/icons/*.png',
);
