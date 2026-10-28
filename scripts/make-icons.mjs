// Rasterises public/icon.svg into the PNG sizes the PWA manifest needs.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url));
for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)));
  console.log(`icon-${size}.png`);
}
