import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitWorkspaceManager } from "../src/workspace/git-workspace.js";

const execFile = promisify(execFileCallback);

async function git(root, ...args) {
  return execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", root, ...args]);
}

async function cleanRepo() {
  const root = await mkdtemp(join(tmpdir(), "aide-workspace-git-"));
  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["init", root]);
  await git(root, "config", "user.name", "AIDE Test");
  await git(root, "config", "user.email", "aide@example.invalid");
  await writeFile(join(root, "tracked.txt"), "base\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return root;
}

test("GitWorkspaceManager lands tracked and new files from an isolated worktree", async () => {
  const project = await cleanRepo();
  const manager = new GitWorkspaceManager({ worktreeRoot: join(project, "..", `${basename(project)}-worktrees`) });
  const allocated = await manager.allocate({ projectRoot: project });

  await writeFile(join(allocated.path, "tracked.txt"), "changed\n");
  await writeFile(join(allocated.path, "new.txt"), "new\n");
  const landing = await manager.land({ path: allocated.path, projectRoot: project });

  assert.equal((await readFile(join(project, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n"), "changed\n");
  assert.equal((await readFile(join(project, "new.txt"), "utf8")).replace(/\r\n/g, "\n"), "new\n");
  assert.ok(landing.patch_bytes > 0);
  assert.match(landing.patch_sha256, /^[0-9a-f]{64}$/);
  await manager.discard({ path: allocated.path, projectRoot: project });
  await assert.rejects(stat(allocated.path), (error) => error.code === "ENOENT");
});

test("GitWorkspaceManager refuses isolation when the project workspace is dirty", async () => {
  const project = await cleanRepo();
  await writeFile(join(project, "tracked.txt"), "dirty\n");
  const manager = new GitWorkspaceManager();
  await assert.rejects(manager.allocate({ projectRoot: project }), (error) => error.code === "WORKSPACE_PROJECT_DIRTY");
});
