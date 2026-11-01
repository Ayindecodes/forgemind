import { readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

const appDir = new URL('../src/app/', import.meta.url);
const icon = await readFile(new URL('icon.svg', appDir), 'utf8');

// Renders at the exact target size, because downscaling would blur the pixel grid.
const render = (svg, size) =>
  sharp(
    Buffer.from(svg.replace('<svg ', `<svg width="${size}" height="${size}" `)),
  )
    .png()
    .toBuffer();

function encodeIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize + entrySize * images.length);

  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;

  images.forEach(({ size, data }, index) => {
    const entry = headerSize + entrySize * index;

    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);

    offset += data.length;
  });

  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const images = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await render(icon, size) })),
);

await writeFile(new URL('favicon.ico', appDir), encodeIco(images));

// iOS applies its own corner mask and shows transparent pixels as black.
await writeFile(
  new URL('apple-icon.png', appDir),
  await render(icon.replace(' rx="3"', ''), 180),
);
