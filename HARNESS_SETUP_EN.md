# Harness Setup and Detection

AIDE **does not automatically install, update, or replace Native Harnesses**. Both Standard and Full packages install AIDE itself; Full packages additionally bundle a Node.js/npm runtime.

After installation, run:

```bash
aide doctor
```

It checks Git, Codex, and DSH separately. At least one supported Harness is required to execute AI Tasks.

## Codex

Codex is currently the most extensively validated Harness in AIDE.

Official Linux installer:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Official Windows installer:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

You can also install Codex through npm:

```bash
npm install -g @openai/codex
```

Verify it with:

```bash
codex --version
aide doctor
```

You can run `codex` once to sign in with ChatGPT, or use the native Codex login controls in AIDE's `Models & Accounts` page.

## DeepSeek Harness (DSH)

DSH is still evolving rapidly. Its official quick-start command is:

```bash
npx @deepseek-ai/dsh web
```

AIDE needs a persistent `dsh` command. For AIDE usage, a global npm installation is one option:

```bash
npm install -g @deepseek-ai/dsh
dsh --version
aide doctor
```

If you run DSH from a source checkout or custom wrapper, point AIDE at it with:

```text
AIDE_DSH_COMMAND=<your dsh launcher>
```

## Full Package

The `runtime/node/` directory in a Full package is AIDE's bundled Node.js/npm runtime. Harnesses remain user-selected and separately installed, so AIDE does not pin their account, version, or update policy.

If `aide doctor` reports `git: false`, install Git first. If both `codex` and `dsh` are `false`, install at least one Harness using the instructions above.
