import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeUpdaterManifest,
  validateUpdaterRelease,
  writeHashLedger,
} from "./validate-updater-release.mjs";

const TAG = "v2.0.6";
const REPOSITORY = "yuxino/viva";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "viva-updater-release-"));
  const mac = "Viva_2.0.6_aarch64.app.tar.gz";
  const windows = "Viva_2.0.6_x64-setup.exe";
  const signatures = { [mac]: "bWFjLXNpZw==", [windows]: "d2luLXNpZw==" };
  for (const [name, signature] of Object.entries(signatures)) {
    writeFileSync(join(directory, name), `artifact:${name}`);
    writeFileSync(join(directory, `${name}.sig`), signature);
  }
  writeFileSync(join(directory, "Viva_2.0.6_aarch64.dmg"), "dmg");
  const manifest = {
    version: "2.0.6",
    notes: "Signed updater bootstrap.",
    pub_date: "2026-09-02T05:00:00Z",
    platforms: {
      "darwin-aarch64": {
        url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/${mac}`,
        signature: signatures[mac],
      },
      "windows-x86_64": {
        url: `https://github.com/${REPOSITORY}/releases/download/${TAG}/${windows}`,
        signature: signatures[windows],
      },
    },
  };
  writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
  return { directory, manifest };
}

test("accepts complete metadata and invokes cryptographic verification for each target", () => {
  const { directory } = fixture();
  const verified = [];
  const result = validateUpdaterRelease({
    directory,
    tag: TAG,
    repository: REPOSITORY,
    verifySignature: ({ target }) => verified.push(target),
  });
  assert.deepEqual(verified.sort(), ["darwin-aarch64", "windows-x86_64"]);
  assert.equal(result.hashes.length, 6);
});

test("normalizes Tauri Action installer-specific aliases to the two supported targets", () => {
  const { directory, manifest } = fixture();
  manifest.platforms["darwin-aarch64"].url =
    "https://api.github.com/repos/yuxino/viva/releases/assets/100";
  manifest.platforms["windows-x86_64"].url =
    "https://api.github.com/repos/yuxino/viva/releases/assets/200";
  manifest.platforms["darwin-aarch64-app"] = manifest.platforms["darwin-aarch64"];
  manifest.platforms["windows-x86_64-nsis"] = manifest.platforms["windows-x86_64"];
  writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));

  normalizeUpdaterManifest({ directory, repository: REPOSITORY, tag: TAG });

  const normalized = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  assert.deepEqual(Object.keys(normalized.platforms), [
    "darwin-aarch64",
    "windows-x86_64",
  ]);
  assert.equal(
    normalized.platforms["darwin-aarch64"].url,
    `https://github.com/${REPOSITORY}/releases/download/${TAG}/Viva_2.0.6_aarch64.app.tar.gz`,
  );
  assert.equal(
    normalized.platforms["windows-x86_64"].url,
    `https://github.com/${REPOSITORY}/releases/download/${TAG}/Viva_2.0.6_x64-setup.exe`,
  );
  assert.doesNotThrow(() =>
    validateUpdaterRelease({ directory, tag: TAG, repository: REPOSITORY }),
  );
});

for (const [name, mutate, expected] of [
  ["wrong version", (manifest) => { manifest.version = "2.0.5"; }, /version/],
  ["unsafe URL", (manifest) => { manifest.platforms["darwin-aarch64"].url = "http://github.com/yuxino/viva/releases/download/v2.0.6/file"; }, /HTTPS/],
  ["wrong tag URL", (manifest) => { manifest.platforms["darwin-aarch64"].url = manifest.platforms["darwin-aarch64"].url.replace(TAG, "v2.0.5"); }, /does not target/],
  ["empty signature", (manifest) => { manifest.platforms["darwin-aarch64"].signature = ""; }, /empty updater signature/],
  ["missing architecture", (manifest) => { delete manifest.platforms["windows-x86_64"]; }, /targets must be exactly/],
  ["duplicate updater asset", (manifest) => { manifest.platforms["windows-x86_64"].url = manifest.platforms["darwin-aarch64"].url; }, /same asset/],
]) {
  test(`rejects ${name}`, () => {
    const { directory, manifest } = fixture();
    mutate(manifest);
    writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
    assert.throws(
      () => validateUpdaterRelease({ directory, tag: TAG, repository: REPOSITORY }),
      expected,
    );
  });
}

test("rejects a manifest signature that differs from the detached signature", () => {
  const { directory, manifest } = fixture();
  manifest.platforms["darwin-aarch64"].signature = "d3Jvbmc=";
  writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
  assert.throws(
    () => validateUpdaterRelease({ directory, tag: TAG, repository: REPOSITORY }),
    /does not match/,
  );
});

test("fails closed when cryptographic verification rejects an artifact", () => {
  const { directory } = fixture();
  assert.throws(
    () =>
      validateUpdaterRelease({
        directory,
        tag: TAG,
        repository: REPOSITORY,
        verifySignature: () => {
          throw new Error("bad signature");
        },
      }),
    /bad signature/,
  );
});

test("writes a stable SHA-256 ledger for every validated asset", () => {
  const { directory } = fixture();
  const result = validateUpdaterRelease({ directory, tag: TAG, repository: REPOSITORY });
  const output = join(directory, "SHA256SUMS.txt");
  writeHashLedger(output, result.hashes);
  const ledger = readFileSync(output, "utf8");
  assert.match(ledger, /^[a-f0-9]{64}  latest\.json$/m);
  assert.equal(ledger.trim().split("\n").length, result.files.length);
});
