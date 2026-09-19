import assert from "node:assert/strict";
import test from "node:test";
import { defaultCodexCommand, defaultDshCommand, defaultStateBase, defaultStateRoot, localProcessTreeAlive, nativeCommandSpec, terminateProcessTree } from "../src/platform/runtime.js";

test("platform runtime chooses native Codex command and state roots without forking AIDE core", () => {
  assert.equal(defaultCodexCommand({ platform: "linux" }), "/usr/lib/chatgpt/resources/codex");
  assert.equal(defaultCodexCommand({ platform: "win32" }), "codex.cmd");
  assert.equal(defaultDshCommand({ platform: "linux" }), "dsh");
  assert.equal(defaultDshCommand({ platform: "win32" }), "dsh.cmd");
  assert.equal(defaultStateBase({ platform: "linux", home: "/home/test", env: {} }), "/home/test/.local/state/aide");
  assert.match(defaultStateBase({ platform: "win32", home: "C:\\Users\\test", env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" } }), /AppData[\\/]Local[\\/]AIDE[\\/]state$/);
  assert.equal(defaultStateRoot("abc", { platform: "linux", home: "/home/test", env: {} }), "/home/test/.local/state/aide/abc");
  assert.match(defaultStateRoot("abc", { platform: "win32", home: "C:\\Users\\test", env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" } }), /AppData[\\/]Local[\\/]AIDE[\\/]state[\\/]abc$/);
});

test("Windows command shims use cmd.exe without changing native executable launches", () => {
  assert.deepEqual(nativeCommandSpec("codex.cmd", ["app-server", "--stdio"], { platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } }), {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "codex.cmd", "app-server", "--stdio"],
  });
  assert.deepEqual(nativeCommandSpec("codex.exe", ["--version"], { platform: "win32", env: {} }), { command: "codex.exe", args: ["--version"] });
  assert.deepEqual(nativeCommandSpec("/usr/bin/codex", ["--version"], { platform: "linux", env: {} }), { command: "/usr/bin/codex", args: ["--version"] });
});

test("Windows process-tree probe treats any surviving root/descendant as live and exit code 3 as quiescent", async () => {
  const calls = [];
  assert.equal(await localProcessTreeAlive(123, {
    platform: "win32",
    exec: async (...args) => { calls.push(args); return { stdout: "" }; },
  }), true);
  assert.equal(calls[0][0], "powershell.exe");
  assert.match(calls[0][1].join(" "), /Get-CimInstance Win32_Process/);

  assert.equal(await localProcessTreeAlive(123, {
    platform: "win32",
    exec: async () => { throw Object.assign(new Error("not alive"), { code: 3 }); },
  }), false);
});

test("Windows cancellation requests native whole-tree termination", () => {
  const calls = [];
  assert.equal(terminateProcessTree(456, {
    platform: "win32",
    run: (...args) => { calls.push(args); return { status: 0 }; },
  }), true);
  assert.deepEqual(calls[0].slice(0, 2), ["taskkill.exe", ["/PID", "456", "/T", "/F"]]);
});
