#!/usr/bin/env node
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCodexCommand, defaultDshCommand, nativeCommandSpec } from "../src/platform/runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "start", ...args] = process.argv.slice(2);

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { windowsHide: process.platform === "win32", stdio: "ignore", ...options });
    child.once("error", (error) => resolveRun({ ok: false, error: error.message }));
    child.once("exit", (code) => resolveRun({ ok: code === 0, code }));
  });
}

async function doctor() {
  const codex = nativeCommandSpec(process.env.AIDE_CODEX_COMMAND ?? defaultCodexCommand(), ["app-server", "--help"]);
  const dsh = nativeCommandSpec(process.env.AIDE_DSH_COMMAND ?? defaultDshCommand(), ["--version"]);
  const checks = {
    node: Number(process.versions.node.split(".")[0]) >= 22,
    git: (await run("git", ["--version"])).ok,
  };
  const harnesses = {
    codex: (await run(codex.command, codex.args)).ok,
    dsh: (await run(dsh.command, dsh.args)).ok,
  };
  const ready = Object.values(checks).every(Boolean) && Object.values(harnesses).some(Boolean);
  console.log(JSON.stringify({
    aide: "0.1.0",
    platform: process.platform,
    node: { version: process.version, executable: process.execPath },
    checks,
    harnesses,
    ready,
    harness_setup: "HARNESS_SETUP.md / HARNESS_SETUP_EN.md",
  }, null, 2));
  if (!ready) process.exitCode = 1;
}

async function openBrowser(url) {
  const launch = process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : ["xdg-open", [url]];
  const child = spawn(launch[0], launch[1], { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {});
  child.unref();
}

async function waitForService(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}

async function start() {
  const noOpen = args.includes("--no-open");
  const projectArg = args.find((arg) => arg !== "--no-open") ?? process.cwd();
  const project = resolve(projectArg);
  const info = await stat(project).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Project directory does not exist: ${project}`);
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("AIDE requires Node.js 22 or newer.");

  const host = process.env.AIDE_CONTROL_HOST ?? "127.0.0.1";
  const port = process.env.AIDE_CONTROL_PORT ?? "8711";
  const url = `http://${host}:${port}`;
  const child = spawn(process.execPath, [resolve(root, "scripts/aide-service.mjs")], {
    cwd: root,
    env: { ...process.env, AIDE_PROJECT_ROOT: project },
    stdio: "inherit",
  });
  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  if (!noOpen && await waitForService(url)) await openBrowser(url);
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
  });
  process.exitCode = code;
}

if (command === "doctor") await doctor();
else if (command === "start") await start();
else {
  args.unshift(command);
  await start();
}
