import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ServiceLease } from "../src/core/service-lease.js";
import { CodexAppServerAdapter } from "../src/execution/codex-app-server-adapter.js";
import { defaultStateRoot, localProcessTreeAlive, terminateProcessTree } from "../src/platform/runtime.js";
import { GitWorkspaceManager } from "../src/workspace/git-workspace.js";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "aide-platform-smoke-"));
const project = join(root, "project");
const leasePath = join(root, "service.lease");

try {
  const stateRoot = defaultStateRoot("platform-smoke");
  if (process.platform === "win32") assert.match(stateRoot, /AIDE[\\/]state[\\/]platform-smoke$/);
  else assert.match(stateRoot, /\.local[\\/]state[\\/]aide[\\/]platform-smoke$/);

  const lease = await ServiceLease.acquire({ leasePath, ttlMs: 5_000 });
  assert.equal((await lease.assertOwner()).pid, process.pid);
  await lease.release();

  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["init", project]);
  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", project, "config", "user.name", "AIDE Platform Smoke"]);
  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", project, "config", "user.email", "aide@example.invalid"]);
  await writeFile(join(project, "BASE.txt"), "base\n");
  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", project, "add", "."]);
  await execFile(process.env.AIDE_GIT_COMMAND ?? "git", ["-C", project, "commit", "-m", "base"]);
  const workspaces = new GitWorkspaceManager({ worktreeRoot: join(root, "worktrees") });
  const isolated = await workspaces.allocate({ projectRoot: project });
  await writeFile(join(isolated.path, "PLATFORM.txt"), `${process.platform}\n`);
  const landed = await workspaces.land({ path: isolated.path, projectRoot: project });
  assert.ok(landed.patch_bytes > 0);
  assert.equal((await readFile(join(project, "PLATFORM.txt"), "utf8")).replace(/\r\n/g, "\n"), `${process.platform}\n`);
  await workspaces.discard({ path: isolated.path, projectRoot: project });

  const codex = new CodexAppServerAdapter();
  const [probe, catalog] = await Promise.all([codex.probe(), codex.providerCatalog()]);
  assert.equal(probe.available, true, `Codex probe failed: ${probe.error_code ?? "unknown"}`);
  assert.ok(catalog.models.length > 0, "Codex model catalog is empty.");

  let windowsProcessTree = null;
  if (process.platform === "win32") {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "powershell.exe", "-NoProfile", "-Command", "Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 15'; Start-Sleep -Seconds 15"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    windowsProcessTree = await localProcessTreeAlive(child.pid);
    assert.equal(windowsProcessTree, true, "Windows descendant process tree was not detected after the launcher exited.");
    terminateProcessTree(child.pid);
    await new Promise((resolve) => child.once("exit", resolve));
  }

  console.log(JSON.stringify({
    platform: process.platform,
    state_root: stateRoot,
    service_lease: "pass",
    git_workspace: "pass",
    codex: {
      version: probe.version,
      model_count: catalog.models.length,
      account_connected: catalog.account.connected,
      collaboration_modes: catalog.collaboration_modes.map((mode) => mode.mode),
    },
    ...(windowsProcessTree === null ? {} : { windows_process_tree_fencing: "pass" }),
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
