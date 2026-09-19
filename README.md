# AIDE

**Agentic Integrated Development Engine**

> @HarnessRouter · @Tutti — 把 Native Harness、任务状态、模型选择、执行验证和恢复统一到一个本地开发入口。

[English](./README_EN.md)

AIDE 是一个本地优先的 AI 开发编排工具。它把多个 Native Harness、模型选择、任务执行、Git 工作区、验证、恢复和管理界面放进一套统一工作流中。

它不是新的 IDE，也不试图替代 Codex、DSH 等原生 Agent。AIDE 负责把它们组织起来，让一次开发任务从“发起”一直走到“执行、验证、恢复、记录结果”。

## 主要功能

- **统一管理页面**：在浏览器中创建 Conversation、发送 Task、查看执行状态和结果。
- **多 Harness 调度**：当前支持 Codex，并预留 DSH Native Harness 接入路径。
- **模型与推理强度选择**：读取 Codex 原生模型目录，并在受支持的 Direct Task 中选择具体 model / reasoning effort。
- **三种任务模式**：Direct、Decompose、Crossfire。
- **任务生命周期管理**：支持启动、状态跟踪、Steer、Cancel、Pending Interaction 和显式 Recovery。
- **Git 隔离工作区**：任务可以在独立 worktree 中执行，保留 diff、测试和落地证据。
- **执行验证**：机械验证、语义验证和分步 verification 可以共同决定 Task 是否完成。
- **路由历史**：查看真实 target/model 路由、执行结果和 shadow advice，不让观测逻辑偷偷改变当前路由。
- **账号与模型管理**：Codex 支持原生账号状态、ChatGPT 登录、Device Code、write-only API Key 和模型目录读取。
- **Ubuntu + Windows**：一套代码支持两个平台；Ubuntu 是主力开发平台，Windows 使用对应的 launcher、状态目录和进程树管理机制。

## 当前适合做什么

AIDE 适合个人开发者或小型开发流程，用一个入口管理 AI coding agents，例如：

- 让不同模型承担普通实现、复杂实现、规划和 review；
- 对一个代码库持续发起任务，并保留 Task/Attempt 状态；
- 在 Agent 退出、终端断开或任务中断后恢复工作；
- 在真正合并代码前检查 diff、测试、验证结果和运行证据；
- 在 Ubuntu 和 Windows 上保持同一套开发编排方式。

## 安装

推荐直接下载 GitHub Releases 中与你的平台对应的压缩包：

- `AIDE-*-linux-x64.tar.gz`
- `AIDE-*-windows-x64.zip`
- `AIDE-*-linux-x64-full.tar.gz`（内置 Node.js/npm）
- `AIDE-*-windows-x64-full.zip`（内置 Node.js/npm）

**Standard 包**更小，需要宿主机已经安装 Node.js 22+。**Full 包**自带 Node.js/npm，适合直接解压安装；两种包都不会捆绑 Codex、DSH 等 Harness，也不会自动修改 Harness 版本。

Linux 解压后：

```bash
./install.sh
aide /path/to/your/project
```

Windows 解压后，在 PowerShell 中：

```powershell
.\install.ps1
aide C:\path\to\your\project
```

安装器不会自动安装 Harness。Standard 包需要宿主机提供 Node.js 22+；Full 包已经内置 Node.js 22.23.2/npm。两种包都需要 Git 和至少一个受支持 Harness。Harness 安装和检测见 [HARNESS_SETUP.md](./HARNESS_SETUP.md)。

也可以不安装，直接在解压目录运行 `./aide` 或 `aide.cmd`。

## 环境要求

需要准备：

- Git；
- 至少一个受支持 Harness：推荐 Codex；也可以使用 DSH；
- Standard 包额外需要 Node.js 22 或更高版本。

Full 包已经包含 Node.js 22.23.2/npm，因此 Full 包用户不需要另外安装 Node.js。

## 从源码运行

克隆仓库后进入目录：

```bash
npm test
npm run smoke:platform
npm run service
```

然后打开：

```text
http://127.0.0.1:8711/
```

`smoke:platform` 不会发送模型任务，可用于检查当前系统上的 Git、状态目录、Service Lease、Codex app-server 和平台运行能力。

## 管理页面

当前包含：

- **Conversations**：创建和管理对话式开发任务；
- **Tasks**：查看 Task、Attempt 和运行状态；
- **Models & Accounts**：查看 Codex 账号、模型与 reasoning effort；
- **Harnesses & Modes**：查看可用 Harness 和 Native mode；
- **Routing**：查看真实路由历史；
- **Settings**：查看当前本地服务配置。

在 Conversation 中可以为下一次 Task 选择：

```text
Strategy -> Target -> Model -> Effort -> AIDE Mode
```

## AIDE Mode

### Direct

直接选择一个合格的执行目标完成任务。当前 exact model / reasoning effort 选择主要用于这个模式。

### Decompose

先生成有明确目标和 verification 条件的分步计划，再由执行 Harness 完成，并在结束后验证各步骤。

### Crossfire

使用多个独立规划结果进行交叉比较，再进入执行流程。适合复杂任务，但会增加模型调用。

## Codex 账号与模型

AIDE 使用 Codex 原生 app-server 接口读取账号状态和模型目录。

管理页支持：

- ChatGPT 浏览器登录；
- Device Code 登录；
- API Key 写入；
- Logout；
- exact model 列表；
- 每个模型支持的 reasoning effort。

API Key 按 write-only 处理，不会在管理页面中回显。

## 平台说明

### Ubuntu

Ubuntu 是当前主要开发和真实运行验证平台。

默认状态目录：

```text
~/.local/state/aide/
```

### Windows

Windows 使用同一套 AIDE 代码，不维护单独的 Windows 版本。

默认状态目录：

```text
%LOCALAPPDATA%\AIDE\state\
```

Windows 支持与 Ubuntu 一致的 Task 启动、Cancel 和异常退出后的恢复流程。

## 常用配置

通常只需要以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `AIDE_PROJECT_ROOT` | 指定要操作的项目目录 |
| `AIDE_CONTROL_HOST` | 控制服务监听地址 |
| `AIDE_CONTROL_PORT` | 控制服务端口，默认 `8711` |
| `AIDE_CONTROL_TOKEN` | 非 loopback 监听时使用的 Bearer Token |
| `AIDE_STATE_DIR` | 覆盖默认状态目录 |
| `AIDE_CODEX_COMMAND` | 覆盖 Codex 可执行文件 |
| `AIDE_DSH_COMMAND` | 覆盖 DSH 可执行文件 |
| `AIDE_EXECUTION_STRATEGY` | 设置默认 execution strategy |

## 验证

```bash
npm test
npm run smoke:platform
npm run smoke:intake
```

部分高级 smoke 会真正调用模型，并要求显式设置 `AIDE_ALLOW_MODEL_CALL=1`。普通测试和 `smoke:platform` 不会主动消耗模型额度。

## 项目状态

AIDE 仍处于早期开发阶段。当前重点是把本地 AI coding workflow 做稳定，而不是提供大型团队、多租户或云端协作平台。
