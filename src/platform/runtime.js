import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export function defaultCodexCommand({ platform = process.platform } = {}) {
  return platform === "win32" ? "codex.cmd" : "/usr/lib/chatgpt/resources/codex";
}

export function defaultDshCommand({ platform = process.platform } = {}) {
  return platform === "win32" ? "dsh.cmd" : "dsh";
}

export function nativeCommandSpec(command, args = [], { platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function defaultStateBase({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  return platform === "win32"
    ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "AIDE", "state")
    : join(home, ".local", "state", "aide");
}

export function defaultStateRoot(projectKey, options = {}) {
  if (typeof projectKey !== "string" || projectKey.length === 0) throw new TypeError("projectKey is required.");
  return join(defaultStateBase(options), projectKey);
}

export async function localProcessTreeAlive(rootPid, { platform = process.platform, exec = execFile } = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return false;
  if (platform !== "win32") {
    try { process.kill(-rootPid, 0); return true; }
    catch (error) {
      if (error?.code === "ESRCH") return false;
      if (error?.code === "EPERM") return true;
      throw error;
    }
  }

  const script = [
    `$root=${rootPid}`,
    "$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId",
    "$seen=@{}",
    "$queue=New-Object System.Collections.Generic.Queue[int]",
    "$queue.Enqueue($root)",
    "$alive=$false",
    "while($queue.Count -gt 0){$p=$queue.Dequeue(); if($seen.ContainsKey($p)){continue}; $seen[$p]=$true; if($all | Where-Object {$_.ProcessId -eq $p}){$alive=$true}; foreach($c in ($all | Where-Object {$_.ParentProcessId -eq $p})){$alive=$true; $queue.Enqueue([int]$c.ProcessId)}}",
    "if($alive){exit 0}else{exit 3}",
  ].join("; ");
  try {
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5_000 });
    return true;
  } catch (error) {
    if (error?.code === 3 || error?.exitCode === 3) return false;
    if (error?.code === "ENOENT") throw Object.assign(new Error("PowerShell is required for Windows process-tree recovery fencing."), { code: "WINDOWS_PROCESS_TREE_PROBE_UNAVAILABLE" });
    if (error?.code === 3 || error?.status === 3) return false;
    throw error;
  }
}

export function terminateProcessTree(rootPid, { platform = process.platform, run = spawnSync } = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return false;
  if (platform !== "win32") {
    try { process.kill(-rootPid, "SIGTERM"); return true; }
    catch (error) { if (error?.code === "ESRCH") return false; throw error; }
  }
  const result = run("taskkill.exe", ["/PID", String(rootPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  if (result?.error) throw result.error;
  return result?.status === 0;
}
