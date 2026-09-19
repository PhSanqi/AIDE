# Harness 安装与检测

AIDE **不会自动安装、更新或替换 Harness**。Standard 和 Full 发布包都只负责 AIDE 本身；Full 包额外自带 Node.js/npm 运行时。

安装完成后先运行：

```bash
aide doctor
```

它会分别检测 Git、Codex 和 DSH。AIDE 至少需要一个可用 Harness 才能执行 AI Task。

## Codex

Codex 是当前 AIDE 验证最完整的 Harness。

Linux 官方安装方式：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Windows 官方安装方式：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

也可以使用 npm：

```bash
npm install -g @openai/codex
```

安装后检查：

```bash
codex --version
aide doctor
```

首次使用可以直接运行 `codex` 完成 ChatGPT 登录；AIDE 的 `Models & Accounts` 页面也支持 Codex 原生登录流程。

## DeepSeek Harness (DSH)

DSH 当前仍处于快速迭代阶段。官方项目的快速启动方式是：

```bash
npx @deepseek-ai/dsh web
```

AIDE 需要一个可直接执行的 `dsh` 命令，因此用于 AIDE 时可以安装为全局命令：

```bash
npm install -g @deepseek-ai/dsh
dsh --version
aide doctor
```

如果你使用 DSH 源码版本，也可以设置：

```text
AIDE_DSH_COMMAND=<你的 dsh 启动命令>
```

## Full 包说明

Full 包中的 `runtime/node/` 是 AIDE 自带的 Node.js/npm 运行时，用来避免单独安装 Node.js。Harness 本身仍由用户选择和安装，AIDE 不会把 Codex、DSH 的账号、版本或更新策略绑死在发布包中。

如果 `aide doctor` 显示：

```text
git: false
```

请先安装 Git；如果 `codex` 和 `dsh` 都为 `false`，请按上面任一 Harness 的说明完成安装。
