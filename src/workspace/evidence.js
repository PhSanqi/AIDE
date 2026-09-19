import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_TEXT_BYTES = 64 * 1024;

function resolveContained(root, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0 || isAbsolute(candidate)) throw new TypeError("Evidence path must be a non-empty relative path.");
  const full = resolve(root, candidate);
  const rel = relative(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Object.assign(new Error("Evidence path escapes the workspace."), { code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE" });
  return { full, path: rel.split(sep).join("/") };
}

export async function collectFileEvidence({ cwd, paths, allowMissing = false } = {}) {
  if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("Evidence cwd is required.");
  if (!Array.isArray(paths) || paths.length === 0) throw new TypeError("At least one evidence path is required.");
  const root = resolve(cwd);
  const realRoot = await realpath(root);
  const files = [];

  for (const candidate of [...new Set(paths)].sort()) {
    const target = resolveContained(root, candidate);
    let info;
    try {
      info = await lstat(target.full);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error(`Evidence target is not a regular file: ${target.path}`), { code: "EVIDENCE_NOT_REGULAR_FILE" });
    const realTarget = await realpath(target.full);
    const realRelative = relative(realRoot, realTarget);
    if (realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw Object.assign(new Error("Evidence target resolves outside the workspace."), { code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE" });
    if (info.size > MAX_TEXT_BYTES) throw Object.assign(new Error(`Evidence file is too large: ${target.path}`), { code: "EVIDENCE_FILE_TOO_LARGE" });
    const bytes = await readFile(target.full);
    files.push({
      path: target.path,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      text: bytes.toString("utf8"),
    });
  }

  return { workspace: root, files };
}
