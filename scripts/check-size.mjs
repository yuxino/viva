import { readdir, readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const DIST_BUDGET_BYTES = 1024 * 1024;
const RENDERER_GZIP_BUDGET_BYTES = 300 * 1024;
const distRoot = new URL("../dist/", import.meta.url);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(new URL(`${entry.name}/`, directory))));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
}

function kibibytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const files = await collectFiles(distRoot);
if (files.length === 0) throw new Error("dist is empty; run pnpm build first");

let distBytes = 0;
let rendererGzipBytes = 0;
for (const file of files) {
  const fileStats = await stat(file);
  distBytes += fileStats.size;
  if (/\.(?:css|js)$/u.test(file.pathname)) {
    rendererGzipBytes += gzipSync(await readFile(file), { level: 9 }).byteLength;
  }
}

console.log(
  `Renderer JavaScript + CSS: ${kibibytes(rendererGzipBytes)} gzip / ${kibibytes(RENDERER_GZIP_BUDGET_BYTES)} budget`,
);
console.log(
  `Complete dist: ${kibibytes(distBytes)} / ${kibibytes(DIST_BUDGET_BYTES)} budget`,
);

const failures = [];
if (rendererGzipBytes > RENDERER_GZIP_BUDGET_BYTES) {
  failures.push("renderer gzip budget exceeded");
}
if (distBytes > DIST_BUDGET_BYTES) failures.push("dist budget exceeded");
if (failures.length) {
  console.error(failures.join("; "));
  process.exitCode = 1;
}
