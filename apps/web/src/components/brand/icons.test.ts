import { readFileSync } from 'node:fs';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { MARK_PATH } from './logo';

const appFile = (name: string) =>
  readFileSync(new URL(`../../app/${name}`, import.meta.url));

function readIcoImages(ico: Buffer) {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + 16 * index;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);

    return {
      size: ico.readUInt8(entry),
      data: ico.subarray(offset, offset + length),
    };
  });
}

async function pixelAt(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;

  return [...data.subarray(offset, offset + 3)];
}

const GLYPH = [11, 13, 16];
const TILE = [110, 168, 254];

describe('app icons', () => {
  it('use the same symbol as the app', () => {
    expect(appFile('icon.svg').toString()).toContain(MARK_PATH);
  });

  it('include every favicon size', () => {
    const images = readIcoImages(appFile('favicon.ico'));

    expect(images.map(({ size }) => size)).toEqual([16, 32, 48]);
  });

  it('keep the symbol distinct at 16px', async () => {
    const [{ data } = { data: Buffer.alloc(0) }] = readIcoImages(
      appFile('favicon.ico'),
    );

    await expect(pixelAt(data, 4, 8)).resolves.toEqual(GLYPH); // stem
    await expect(pixelAt(data, 7, 8)).resolves.toEqual(TILE); // gap
    await expect(pixelAt(data, 9, 8)).resolves.toEqual(GLYPH); // node
    await expect(pixelAt(data, 9, 6)).resolves.toEqual(TILE); // gap
    await expect(pixelAt(data, 9, 3)).resolves.toEqual(GLYPH); // top arm
  });

  it('provide an opaque Apple touch icon', async () => {
    const image = sharp(appFile('apple-icon.png'));
    const { width, height } = await image.metadata();
    const { isOpaque } = await image.stats();

    expect([width, height]).toEqual([180, 180]);
    expect(isOpaque).toBe(true);
  });
});
