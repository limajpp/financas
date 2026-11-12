// Generates the app icons from assets/icon.svg: `node scripts/icons.mjs`. The PNGs are committed;
// run it again only when the SVG changes. Uses sharp, which Next installs as an optional
// dependency (no need to declare it: the script only runs by hand).
import { copyFile, mkdir } from "node:fs/promises";

import sharp from "sharp";

const source = "assets/icon.svg";
const outputs = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
];

await mkdir("public/icons", { recursive: true });
for (const [file, size] of outputs) {
  await sharp(source, { density: 300 }).resize(size, size).png().toFile(file);
  console.log(`${file} (${size}px)`);
}
await copyFile(source, "src/app/icon.svg");
console.log("src/app/icon.svg");
