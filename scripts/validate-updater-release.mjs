import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REQUIRED_UPDATE_TARGETS = ["darwin-aarch64", "windows-x86_64"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedVersion(value) {
  return String(value).trim().replace(/^v/i, "");
}

function releaseFiles(directory) {
  return readdirSync(directory)
    .filter((name) => statSync(join(directory, name)).isFile())
    .sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateSourceVersion(sourceRoot, tag) {
  const expectedVersion = normalizedVersion(tag);
  invariant(/^\d+\.\d+\.\d+$/.test(expectedVersion), `invalid release tag: ${tag}`);

  const packageVersion = JSON.parse(
    readFileSync(join(sourceRoot, "package.json"), "utf8"),
  ).version;
  const tauriVersion = JSON.parse(
    readFileSync(join(sourceRoot, "src-tauri/tauri.conf.json"), "utf8"),
  ).version;
  const cargo = readFileSync(join(sourceRoot, "src-tauri/Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  for (const [label, version] of [
    ["package.json", packageVersion],
    ["tauri.conf.json", tauriVersion],
    ["Cargo.toml", cargoVersion],
  ]) {
    invariant(version === expectedVersion, `${label} version ${version} does not match ${tag}`);
  }
  invariant(
    existsSync(join(sourceRoot, `docs/release-notes-v${expectedVersion}.md`)),
    `missing release notes for v${expectedVersion}`,
  );
  return expectedVersion;
}

export function normalizeUpdaterManifest({ directory, repository, tag }) {
  const path = join(directory, "latest.json");
  invariant(existsSync(path), "latest.json is missing");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const platforms = manifest.platforms;
  invariant(platforms && typeof platforms === "object", "latest.json platforms are missing");
  const files = releaseFiles(directory);
  manifest.platforms = Object.fromEntries(
    REQUIRED_UPDATE_TARGETS.map((target) => {
      const entry = platforms[target];
      invariant(entry, `missing updater entry for ${target}`);
      invariant(typeof entry.signature === "string" && entry.signature.trim(), `empty updater signature for ${target}`);
      const candidates = files.filter((name) => {
        const correctBundle = target === "darwin-aarch64"
          ? name.endsWith(".app.tar.gz")
          : name.endsWith("-setup.exe");
        return correctBundle && files.includes(`${name}.sig`) &&
          readFileSync(join(directory, `${name}.sig`), "utf8").trim() === entry.signature.trim();
      });
      invariant(candidates.length === 1, `could not bind ${target} to exactly one signed updater asset`);
      return [target, {
        signature: entry.signature,
        url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(candidates[0])}`,
      }];
    }),
  );
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function validateUpdaterRelease({
  directory,
  tag,
  repository,
  verifySignature = () => undefined,
}) {
  const expectedVersion = normalizedVersion(tag);
  const files = releaseFiles(directory);
  const foldedNames = files.map((name) => name.toLocaleLowerCase("en-US"));
  invariant(new Set(foldedNames).size === files.length, "release asset names are not unique");
  invariant(files.includes("latest.json"), "latest.json is missing");

  const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  invariant(normalizedVersion(manifest.version) === expectedVersion, "latest.json version does not match the tag");
  invariant(typeof manifest.notes === "string" && manifest.notes.trim(), "latest.json release notes are empty");
  invariant(
    typeof manifest.pub_date === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(manifest.pub_date) &&
      Number.isFinite(Date.parse(manifest.pub_date)),
    "latest.json pub_date is not RFC 3339",
  );

  const targets = Object.keys(manifest.platforms ?? {}).sort();
  invariant(
    JSON.stringify(targets) === JSON.stringify([...REQUIRED_UPDATE_TARGETS].sort()),
    `latest.json targets must be exactly ${REQUIRED_UPDATE_TARGETS.join(", ")}`,
  );

  const expectedPrefix = `/${repository}/releases/download/${tag}/`;
  const updaterAssets = new Set();
  const signatureAssets = new Set();
  for (const target of REQUIRED_UPDATE_TARGETS) {
    const entry = manifest.platforms[target];
    invariant(entry && typeof entry === "object", `missing updater entry for ${target}`);
    invariant(typeof entry.url === "string", `missing updater URL for ${target}`);
    const url = new URL(entry.url);
    invariant(url.protocol === "https:", `updater URL for ${target} is not HTTPS`);
    invariant(url.hostname === "github.com" && !url.port && !url.username && !url.password, `updater URL for ${target} is not on github.com`);
    invariant(decodeURIComponent(url.pathname).startsWith(expectedPrefix), `updater URL for ${target} does not target ${tag}`);
    const assetName = basename(decodeURIComponent(url.pathname));
    invariant(assetName && files.includes(assetName), `updater asset for ${target} is missing: ${assetName}`);
    invariant(!updaterAssets.has(assetName), "multiple updater targets reference the same asset");
    updaterAssets.add(assetName);
    if (target === "darwin-aarch64") {
      invariant(assetName.endsWith(".app.tar.gz"), "macOS updater must be an app tarball");
    } else {
      invariant(assetName.endsWith("-setup.exe"), "Windows updater must be the NSIS installer");
    }

    invariant(typeof entry.signature === "string" && entry.signature.trim(), `empty updater signature for ${target}`);
    const signatureName = `${assetName}.sig`;
    invariant(files.includes(signatureName), `signature asset is missing: ${signatureName}`);
    invariant(readFileSync(join(directory, signatureName), "utf8").trim() === entry.signature.trim(), `latest.json signature does not match ${signatureName}`);
    signatureAssets.add(signatureName);
    verifySignature({
      artifactPath: join(directory, assetName),
      signaturePath: join(directory, signatureName),
      target,
    });
  }

  const detachedSignatures = files.filter((name) => name.endsWith(".sig"));
  invariant(
    detachedSignatures.every((name) => signatureAssets.has(name)),
    "release contains an updater signature not referenced by latest.json",
  );
  invariant(files.some((name) => name.endsWith("_aarch64.dmg")), "macOS arm64 DMG is missing");
  invariant(files.some((name) => name.endsWith("-setup.exe")), "Windows x64 NSIS installer is missing");

  const hashes = files
    .filter((name) => name !== "SHA256SUMS.txt")
    .map((name) => `${sha256(join(directory, name))}  ${name}`);
  return { files, hashes, manifest };
}

export function writeHashLedger(path, hashes) {
  writeFileSync(path, `${hashes.join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
}

export async function checkPublicRelease({ manifest, repository, files }) {
  const publicManifestUrl = `https://github.com/${repository}/releases/latest/download/latest.json`;
  const urls = new Set([
    publicManifestUrl,
    ...Object.values(manifest.platforms).map((entry) => entry.url),
    ...files
      .filter((name) => name !== "SHA256SUMS.txt")
      .map((name) => `https://github.com/${repository}/releases/download/v${normalizedVersion(manifest.version)}/${encodeURIComponent(name)}`),
    `https://github.com/${repository}/releases/download/v${normalizedVersion(manifest.version)}/SHA256SUMS.txt`,
  ]);
  for (const url of urls) {
    let available = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (response.ok) {
        available = true;
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
    invariant(available, `release asset is not publicly available: ${url}`);
  }
  const publicManifestResponse = await fetch(publicManifestUrl, { redirect: "follow" });
  invariant(publicManifestResponse.ok, "public latest.json could not be downloaded");
  const publicManifest = await publicManifestResponse.json();
  invariant(
    JSON.stringify(publicManifest) === JSON.stringify(manifest),
    "public latest.json differs from the validated release metadata",
  );
}

function argumentsFromCommandLine(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    invariant(name && value, `invalid command line near ${values[index] ?? "end"}`);
    options[name] = value;
  }
  return options;
}

async function main() {
  const options = argumentsFromCommandLine(process.argv.slice(2));
  const sourceRoot = resolve(options["source-root"] ?? ".");
  const tag = options.tag;
  invariant(tag, "--tag is required");
  validateSourceVersion(sourceRoot, tag);
  if (!options.directory) return;

  const directory = resolve(options.directory);
  const repository = options.repository;
  invariant(repository, "--repository is required when --directory is set");
  if (options.normalize === "true") {
    normalizeUpdaterManifest({ directory, repository, tag });
  }
  const tauriConfig = JSON.parse(
    readFileSync(join(sourceRoot, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const publicKey = tauriConfig.plugins?.updater?.pubkey;
  invariant(typeof publicKey === "string" && publicKey, "updater public key is missing");
  const verifierManifest = join(sourceRoot, "tools/updater-verifier/Cargo.toml");
  const result = validateUpdaterRelease({
    directory,
    tag,
    repository,
    verifySignature: ({ artifactPath, signaturePath }) => {
      const verification = spawnSync(
        "cargo",
        [
          "run",
          "--quiet",
          "--locked",
          "--manifest-path",
          verifierManifest,
          "--",
          publicKey,
          signaturePath,
          artifactPath,
        ],
        { encoding: "utf8" },
      );
      invariant(
        verification.status === 0,
        verification.stderr.trim() || `signature verification failed for ${basename(artifactPath)}`,
      );
    },
  });
  if (options["hash-output"]) {
    writeHashLedger(resolve(options["hash-output"]), result.hashes);
  }
  if (options["check-public"] === "true") {
    await checkPublicRelease({
      files: result.files,
      manifest: result.manifest,
      repository,
    });
  }
  console.log(`Validated Viva ${result.manifest.version}: ${result.files.length} assets, ${REQUIRED_UPDATE_TARGETS.length} signed updater targets.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
