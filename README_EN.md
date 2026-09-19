# AIDE

**Agentic Integrated Development Engine**

> @HarnessRouter · @Tutti — one local entry for Native Harnesses, task state, model selection, verification, and recovery.

[中文](./README.md)

AIDE is a local-first orchestration tool for AI-assisted software development. It brings Native Harnesses, model selection, task execution, Git workspaces, verification, recovery, and a management UI into one workflow.

It is not a new IDE and it does not try to replace native agents such as Codex or DSH. AIDE coordinates them so a development task can move from intake to execution, verification, recovery, and durable results.

## Features

- **Unified management UI** for Conversations, Tasks, execution state, and results.
- **Multiple Native Harnesses** with Codex supported today and a DSH integration path available.
- **Model and reasoning-effort selection** from the live Codex model catalog for supported Direct tasks.
- **Three task modes**: Direct, Decompose, and Crossfire.
- **Task lifecycle controls** including start, status, Steer, Cancel, Pending Interactions, and explicit Recovery.
- **Git-isolated workspaces** using worktrees with diff, test, and landing evidence.
- **Execution verification** combining mechanical checks, semantic review, and step-level verification.
- **Routing history** for actual target/model choices, outcomes, and observe-only shadow advice.
- **Account and model management** using native Codex account/login/model APIs, including browser login, Device Code, write-only API keys, and model discovery.
- **Ubuntu + Windows** from one codebase, with platform-specific launcher, state-path, and process-tree mechanics kept below the shared orchestration layer.

## What AIDE Is Good For

AIDE is designed for individual developers and compact engineering workflows that use AI coding agents, for example:

- assigning routine and difficult work to different models;
- keeping a durable Task/Attempt history for one repository;
- recovering after a terminal disconnect, process failure, or interrupted agent run;
- checking diffs, tests, verification, and runtime evidence before accepting work;
- using the same orchestration workflow on Ubuntu and Windows.

## Installation

The easiest path is to download the platform package from GitHub Releases:

- `AIDE-*-linux-x64.tar.gz`
- `AIDE-*-windows-x64.zip`
- `AIDE-*-linux-x64-full.tar.gz` (bundled Node.js/npm)
- `AIDE-*-windows-x64-full.zip` (bundled Node.js/npm)

**Standard packages** are smaller and require Node.js 22+ on the host. **Full packages** bundle Node.js/npm for a more direct install. Neither package bundles or silently installs Codex, DSH, or another Harness.

On Linux, extract it and run:

```bash
./install.sh
aide /path/to/your/project
```

On Windows, extract it and run in PowerShell:

```powershell
.\install.ps1
aide C:\path\to\your\project
```

The installer does not automatically install a Harness. Standard packages require Node.js 22+ on the host; Full packages bundle Node.js 22.23.2/npm. Both require Git and at least one supported Harness. See [HARNESS_SETUP_EN.md](./HARNESS_SETUP_EN.md) for installation and detection instructions.

You can also skip installation and run `./aide` or `aide.cmd` directly from the extracted package.

## Requirements

Requirements:

- Git;
- at least one supported Harness: Codex is recommended, while DSH is also available;
- Node.js 22+ for Standard packages only.

Full packages already include Node.js 22.23.2/npm, so Full-package users do not need to install Node.js separately.

## Run from Source

After cloning the repository:

```bash
npm test
npm run smoke:platform
npm run service
```

Open:

```text
http://127.0.0.1:8711/
```

`smoke:platform` is non-generative. It checks Git, the state directory, Service Lease behavior, Codex app-server access, and platform runtime capabilities without sending a model task.

## Management UI

The current UI includes:

- **Conversations** — create and manage development tasks;
- **Tasks** — inspect Task, Attempt, and runtime state;
- **Models & Accounts** — inspect Codex accounts, models, and reasoning effort;
- **Harnesses & Modes** — inspect available Harnesses and native modes;
- **Routing** — inspect actual routing history;
- **Settings** — inspect local service configuration.

For the next task, a Conversation can select:

```text
Strategy -> Target -> Model -> Effort -> AIDE Mode
```

## AIDE Modes

### Direct

Runs a task on one qualified execution target. Exact model/reasoning-effort selection is primarily intended for this mode today.

### Decompose

Creates ordered steps with explicit verification criteria, executes them through a qualified Harness, and verifies the step conditions before closure.

### Crossfire

Uses multiple independent planning results before execution. It is intended for harder tasks and consumes additional model calls.

## Codex Accounts and Models

AIDE uses the native Codex app-server account and model APIs.

The management UI supports:

- ChatGPT browser login;
- Device Code login;
- write-only API key input;
- logout;
- exact model discovery;
- supported reasoning-effort values for each model.

API keys are treated as write-only values and are not echoed back in the management UI.

## Platform Support

### Ubuntu

Ubuntu is the primary development and real-runtime validation platform.

Default state root:

```text
~/.local/state/aide/
```

### Windows

Windows uses the same AIDE codebase rather than a separate Windows edition.

Default state root:

```text
%LOCALAPPDATA%\AIDE\state\
```

Windows supports the same Task launch, cancellation, and interrupted-run recovery workflow as Ubuntu.

## Common Configuration

Most users only need these variables:

| Variable | Purpose |
| --- | --- |
| `AIDE_PROJECT_ROOT` | Project directory AIDE should operate on |
| `AIDE_CONTROL_HOST` | Control-service bind address |
| `AIDE_CONTROL_PORT` | Control-service port, default `8711` |
| `AIDE_CONTROL_TOKEN` | Bearer token required for non-loopback binding |
| `AIDE_STATE_DIR` | Override the default state root |
| `AIDE_CODEX_COMMAND` | Override the Codex executable |
| `AIDE_DSH_COMMAND` | Override the DSH executable |
| `AIDE_EXECUTION_STRATEGY` | Set the default execution strategy |

## Validation

```bash
npm test
npm run smoke:platform
npm run smoke:intake
```

Some advanced smoke commands perform real model calls and require an explicit `AIDE_ALLOW_MODEL_CALL=1`. Normal tests and `smoke:platform` do not intentionally consume model quota.

## Project Status

AIDE is still in early development. The current focus is a reliable local AI coding workflow rather than a multi-tenant or cloud collaboration platform.
