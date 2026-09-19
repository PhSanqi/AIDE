import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseDir = join(root, "release");
const cacheDir = join(root, ".release-cache");
const nodeVersion = "22.23.2";

async function trackedFiles() {
  const { stdout } = await execFile("git", ["-C", root, "ls-files", "-z"], { encoding: "buffer" });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

async function stage(name, platform) {
  const dir = join(releaseDir, name);
  await mkdir(dir, { recursive: true });
  for (const path of await trackedFiles()) {
    if (path.startsWith("test/") || path === ".gitattributes" || path === ".gitignore" || path === "scripts/build-release.mjs") continue;
    if (platform === "linux" && (path.endsWith(".cmd") || path.endsWith(".ps1"))) continue;
    if (platform === "windows" && (path === "aide" || path.endsWith(".sh"))) continue;
    const source = join(root, path);
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if (platform === "linux") {
    await chmod(join(dir, "aide"), 0o755);
    await chmod(join(dir, "install.sh"), 0o755);
    await chmod(join(dir, "bin/aide.mjs"), 0o755);
  }
  return dir;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function download(url, path) {
  try { await readFile(path); return; } catch {}
  await mkdir(dirname(path), { recursive: true });
  await execFile("curl", ["--fail", "--location", "--silent", "--show-error", "--output", path, url]);
}

async function ensureNodeArchive(filename) {
  const base = `https://nodejs.org/dist/v${nodeVersion}`;
  const archive = join(cacheDir, filename);
  const sumsPath = join(cacheDir, `SHASUMS256-${nodeVersion}.txt`);
  await Promise.all([
    download(`${base}/${filename}`, archive),
    download(`${base}/SHASUMS256.txt`, sumsPath),
  ]);
  const expected = (await readFile(sumsPath, "utf8"))
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === filename)?.[0];
  if (!expected) throw new Error(`No Node checksum found for ${filename}.`);
  const actual = await sha256(archive);
  if (actual !== expected) throw new Error(`Node checksum mismatch for ${filename}.`);
  return archive;
}

async function bundleNode(targetDir, platform) {
  const filename = platform === "linux"
    ? `node-v${nodeVersion}-linux-x64.tar.xz`
    : `node-v${nodeVersion}-win-x64.zip`;
  const archive = await ensureNodeArchive(filename);
  const unpack = join(cacheDir, `unpack-${platform}-${nodeVersion}`);
  const sourceName = platform === "linux" ? `node-v${nodeVersion}-linux-x64` : `node-v${nodeVersion}-win-x64`;
  await rm(unpack, { recursive: true, force: true });
  await mkdir(unpack, { recursive: true });
  if (platform === "linux") await execFile("tar", ["-xJf", archive, "-C", unpack]);
  else await execFile("unzip", ["-q", archive, "-d", unpack]);
  const runtimeDir = join(targetDir, "runtime", "node");
  await mkdir(dirname(runtimeDir), { recursive: true });
  await cp(join(unpack, sourceName), runtimeDir, { recursive: true });
  await writeFile(join(targetDir, "RUNTIME_INFO.txt"), [
    `Bundled runtime: Node.js v${nodeVersion} x64`,
    `Source: https://nodejs.org/dist/v${nodeVersion}/${filename}`,
    "Checksum verified against the official Node.js SHASUMS256.txt.",
    "Native Harnesses are not bundled.",
    "",
  ].join("\n"));
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const linuxName = `AIDE-${version}-linux-x64`;
const windowsName = `AIDE-${version}-windows-x64`;
const linuxFullName = `AIDE-${version}-linux-x64-full`;
const windowsFullName = `AIDE-${version}-windows-x64-full`;
const linuxDir = await stage(linuxName, "linux");
const windowsDir = await stage(windowsName, "windows");
const linuxFullDir = join(releaseDir, linuxFullName);
const windowsFullDir = join(releaseDir, windowsFullName);
await cp(linuxDir, linuxFullDir, { recursive: true });
await cp(windowsDir, windowsFullDir, { recursive: true });
await Promise.all([bundleNode(linuxFullDir, "linux"), bundleNode(windowsFullDir, "windows")]);

const linuxArchive = join(releaseDir, `${linuxName}.tar.gz`);
const windowsArchive = join(releaseDir, `${windowsName}.zip`);
const linuxFullArchive = join(releaseDir, `${linuxFullName}.tar.gz`);
const windowsFullArchive = join(releaseDir, `${windowsFullName}.zip`);
await execFile("tar", ["-C", releaseDir, "-czf", linuxArchive, linuxName]);
await execFile("zip", ["-q", "-r", windowsArchive, windowsName], { cwd: releaseDir });
await execFile("tar", ["-C", releaseDir, "-czf", linuxFullArchive, linuxFullName]);
await execFile("zip", ["-q", "-r", windowsFullArchive, windowsFullName], { cwd: releaseDir });

const sums = [linuxArchive, windowsArchive, linuxFullArchive, windowsFullArchive];
await writeFile(join(releaseDir, "SHA256SUMS.txt"), `${(await Promise.all(sums.map(async (path) => `${await sha256(path)}  ${basename(path)}`))).join("\n")}\n`);
await cp(join(root, "RELEASE_NOTES.md"), join(releaseDir, "RELEASE_NOTES.md"));

console.log(JSON.stringify({
  version,
  bundled_node: nodeVersion,
  assets: sums.map((path) => basename(path)),
  checksums: "SHA256SUMS.txt",
}, null, 2));
