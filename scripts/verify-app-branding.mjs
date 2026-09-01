#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = join(repoRoot, "src-tauri", "icons");
const expectedName = process.argv[2];

function fail(message) {
  throw new Error(message);
}

if (!expectedName) fail("expected product name argument is required");

function decodePngAlpha(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) fail(`${label}: not a PNG`);

  let offset = 8;
  let header;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) fail(`${label}: truncated ${type} chunk`);
    if (type === "IHDR") {
      header = {
        width: buffer.readUInt32BE(start),
        height: buffer.readUInt32BE(start + 4),
        depth: buffer[start + 8],
        colorType: buffer[start + 9],
        interlace: buffer[start + 12],
      };
    } else if (type === "IDAT") {
      compressed.push(buffer.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }

  if (!header || header.width !== header.height || header.width === 0) {
    fail(`${label}: icon must be a non-empty square`);
  }
  if (header.depth !== 8 || ![4, 6].includes(header.colorType) || header.interlace !== 0) {
    fail(`${label}: expected non-interlaced 8-bit PNG with alpha`);
  }

  const bytesPerPixel = header.colorType === 6 ? 4 : 2;
  const stride = header.width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  if (filtered.length !== (stride + 1) * header.height) {
    fail(`${label}: unexpected image data length`);
  }

  const alpha = new Uint8Array(header.width * header.height);
  let input = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = filtered[input];
    input += 1;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const encoded = filtered[input];
      input += 1;
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = above;
      else if (filter === 3) prediction = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        prediction =
          leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
            ? left
            : aboveDistance <= upperLeftDistance
              ? above
              : upperLeft;
      } else if (filter !== 0) {
        fail(`${label}: unsupported PNG filter ${filter}`);
      }
      row[x] = (encoded + prediction) & 0xff;
    }
    for (let x = 0; x < header.width; x += 1) {
      alpha[y * header.width + x] = row[x * bytesPerPixel + bytesPerPixel - 1];
    }
    previous = row;
  }

  return { size: header.width, alpha };
}

function verifyRoundedAlpha(decoded, label) {
  const { size, alpha } = decoded;
  const corners = [0, size - 1, size * (size - 1), size * size - 1];
  if (corners.some((index) => alpha[index] > 8)) {
    fail(`${label}: all four corners must be transparent`);
  }

  let transparent = 0;
  let translucent = 0;
  let opaque = 0;
  for (const value of alpha) {
    if (value <= 8) transparent += 1;
    else if (value === 255) opaque += 1;
    else translucent += 1;
  }
  const minimumTransparentRatio = size < 32 ? 0.01 : 0.05;
  if (transparent / alpha.length < minimumTransparentRatio) {
    fail(`${label}: transparent padding is too small`);
  }
  if (opaque / alpha.length < 0.35) fail(`${label}: visible icon is unexpectedly sparse`);
  if (translucent === 0) fail(`${label}: anti-aliased rounded edge is missing`);

  const sample = (x, y) => {
    const pixelX = Math.round((size - 1) * x);
    const pixelY = Math.round((size - 1) * y);
    return alpha[pixelY * size + pixelX];
  };
  if (size >= 32) {
    for (const [x, y] of [
      [0.04, 0.04],
      [0.96, 0.04],
      [0.96, 0.96],
      [0.04, 0.96],
    ]) {
      if (sample(x, y) > 128) fail(`${label}: rounded corner remains opaque`);
    }
  }
  if (sample(0.5, 0.5) < 250) fail(`${label}: center must remain opaque`);
}

function verifyPng(path, label, expectedSize) {
  const decoded = decodePngAlpha(readFileSync(path), label);
  if (expectedSize && decoded.size !== expectedSize) {
    fail(`${label}: expected ${expectedSize}x${expectedSize}, got ${decoded.size}x${decoded.size}`);
  }
  verifyRoundedAlpha(decoded, label);
  return decoded.size;
}

function verifyIco(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    fail("icon.ico: invalid header");
  }
  const count = buffer.readUInt16LE(4);
  const sizes = new Set();
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = buffer[entry] || 256;
    const height = buffer[entry + 1] || 256;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (width !== height || offset + length > buffer.length) {
      fail("icon.ico: invalid image entry");
    }
    const decoded = decodePngAlpha(buffer.subarray(offset, offset + length), `icon.ico:${width}`);
    if (decoded.size !== width) fail(`icon.ico:${width}: payload size mismatch`);
    verifyRoundedAlpha(decoded, `icon.ico:${width}`);
    sizes.add(width);
  }
  for (const size of [16, 24, 32, 48, 64, 256]) {
    if (!sizes.has(size)) fail(`icon.ico: missing ${size}x${size} representation`);
  }
}

const config = JSON.parse(readFileSync(join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const windowsConfig = JSON.parse(
  readFileSync(join(repoRoot, "src-tauri", "tauri.windows.conf.json"), "utf8"),
);
if (config.productName !== expectedName) {
  fail(`tauri.conf.json: productName must be ${expectedName}`);
}
if (windowsConfig.mainBinaryName !== expectedName) {
  fail(`tauri.windows.conf.json: mainBinaryName must be ${expectedName}`);
}
const windowTitle = windowsConfig.app?.windows?.[0]?.title ?? config.app?.windows?.[0]?.title;
if (windowTitle !== expectedName) {
  fail(`Windows title must be ${expectedName}`);
}
const nsis = windowsConfig.bundle?.windows?.nsis;
if (windowsConfig.bundle?.targets !== "nsis" && !windowsConfig.bundle?.targets?.includes?.("nsis")) {
  fail("tauri.windows.conf.json: Windows bundle target must include nsis");
}
if (nsis?.installMode !== "currentUser") {
  fail("tauri.windows.conf.json: NSIS installMode must be currentUser");
}
if (!config.bundle?.icon?.includes("icons/icon.ico")) {
  fail("tauri.conf.json: bundle.icon must include icons/icon.ico");
}

verifyPng(join(iconDir, "app-icon-source.png"), "app-icon-source.png");
verifyPng(join(iconDir, "32x32.png"), "32x32.png", 32);
verifyPng(join(iconDir, "128x128.png"), "128x128.png", 128);
verifyPng(join(iconDir, "128x128@2x.png"), "128x128@2x.png", 256);
verifyIco(join(iconDir, "icon.ico"));

console.log(
  `Windows branding verified for ${expectedName}: capitalized product identity, current-user NSIS, and transparent rounded PNG/ICO assets.`,
);
