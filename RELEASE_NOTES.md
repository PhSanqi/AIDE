# AIDE v0.1.0

## 中文

首个公开预览版本，重点是把多个 AI coding 能力放进一个本地、可恢复、可验证的开发入口。

主要内容：

- 本地管理页面：Conversations、Tasks、Models & Accounts、Harnesses & Modes、Routing、Settings；
- Codex Native Harness：账号状态、模型目录、reasoning effort、Direct Task 模型选择；
- Direct / Decompose / Crossfire 三种任务模式；
- Task / Attempt 生命周期、Pending Interaction、Steer、Cancel、Recovery；
- Git worktree 隔离、diff/test/evidence 和语义验证；
- Ubuntu + Windows 共用一套代码；
- Linux / Windows 独立 Release 安装包；
- Linux / Windows 各提供 Standard 和 Full 两种包；Full 包内置 Node.js/npm，但不捆绑 Harness；
- Full 包固定内置并校验 Node.js 22.23.2；Harness 安装说明单独放在 `HARNESS_SETUP.md`；
- `aide <project>` 启动入口和 `aide doctor` 环境检查。

当前为早期预览版本。Node.js 22+、Git 和 Codex CLI 仍需预先安装。

## English

The first public preview of AIDE, focused on a local, recoverable, and verifiable workflow for AI-assisted software development.

Highlights:

- local management UI for Conversations, Tasks, Models & Accounts, Harnesses & Modes, Routing, and Settings;
- native Codex account/model/reasoning-effort integration;
- Direct, Decompose, and Crossfire modes;
- Task/Attempt lifecycle controls, Pending Interactions, Steer, Cancel, and Recovery;
- Git worktree isolation plus diff/test/evidence and semantic verification;
- one codebase for Ubuntu and Windows;
- separate Linux and Windows release packages;
- both Standard and Full packages for Linux and Windows; Full packages bundle Node.js/npm but not a Harness;
- Full packages bundle verified Node.js 22.23.2; Harness setup stays separate in `HARNESS_SETUP_EN.md`;
- `aide <project>` launcher and `aide doctor` host checks.

This is an early preview. Node.js 22+, Git, and Codex CLI remain host prerequisites.
