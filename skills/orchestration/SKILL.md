---
name: orchestration
description: >-
  Use Orca orchestration for structured multi-agent coordination: threaded
  messages, blocking ask/reply flows, task dispatch, worker_done/escalation
  waits, task DAGs, decision gates, coordinator loops, or decomposing work
  across agents. Use `orca-cli` instead for ordinary terminal control,
  lightweight terminal prompts, shell commands, Orca worktree management,
  reading or waiting on terminals, and automation of the browser embedded inside
  Orca. Use Computer Use for browser windows, webviews, Orca app UI, or desktop
  UI outside Orca's embedded browser.
---

# Orca Inter-Agent Orchestration

Use this skill when coordination state matters. For lightweight terminal prompts or basic worktree/terminal/built-in-browser control, use `orca-cli`.

## When To Use

- Send/reply/ask between agent terminals with persistent messages.
- Dispatch structured tasks to workers and wait for `worker_done` or `escalation`.
- Track task DAGs with dependencies.
- Run coordinator loops or decision gates.

## Preconditions

- `orca status --json` should show a running runtime.
- `orca` must be on PATH (`orca-ide` on Linux).
- The orchestration experimental feature must be enabled in Settings > Experimental.
- `orca orchestration` commands are RPC calls to the running Orca runtime.

## Ownership

Orchestration messages and tasks are runtime-global. Completion authority comes from the active dispatch context: `taskId` + `dispatchId` + assignee handle.

Classify inherited context before sending lifecycle messages:

- Coordinated subtask: a live coordinator owns the DAG and waits on this dispatch. Follow the preamble exactly, including `worker_done`, heartbeat/status, `ask`, and `escalation`.
- Full handoff: the original actor delegated ownership and is not monitoring. Finish in the current session. Create a new coordinator only when the user asks or you deliberately decompose fresh subtasks; if spawning workers, use your current-worktree coordinator handle and a selector such as `--worktree active`.

If unclear, inspect orchestration state before sending lifecycle messages:

```bash
orca orchestration task-list --json
orca terminal list --json
# If inherited context includes a task id:
orca orchestration dispatch-show --task <task_id> --json
```

## Messaging

```bash
orca orchestration send --to <handle|@group> --subject <text> [--from <handle>] [--body <text>] [--type <type>] [--priority <level>] [--thread-id <id>] [--payload <json>] [--json]
orca orchestration check [--terminal <handle>] [--unread] [--types <type,...>] [--inject] [--wait] [--timeout-ms <n>] [--json]
orca orchestration reply --id <msg_id> --body <text> [--from <handle>] [--json]
orca orchestration ask --to <handle> --question <text> [--options <csv>] [--timeout-ms <n>] [--from <handle>] [--json]
orca orchestration inbox [--limit <n>] [--json]
```

Rules:

- Omit `--from` unless impersonating another terminal; Orca auto-resolves it from the current terminal.
- Use `check --wait --types worker_done,escalation --timeout-ms <n>` instead of sleep/poll loops.
- Use `ask` when a worker needs a blocking answer from the coordinator; it waits for the reply and returns the answer directly.
- `check --wait` returns one message at a time. If N workers may finish together, loop N times and dispatch newly ready tasks after each completion.
- Group addresses include `@all`, `@idle`, `@claude`, `@codex`, `@opencode`, `@gemini`, and `@worktree:<id>`.
- Message types include `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, and `decision_gate`.

## Tasks And Dispatch

```bash
orca orchestration task-create --spec <text> [--deps <json_array>] [--parent <task_id>] [--json]
orca orchestration task-list [--status <status>] [--ready] [--json]
orca orchestration task-update --id <task_id> --status <status> [--result <json>] [--json]
orca orchestration dispatch --task <task_id> --to <handle> [--from <handle>] [--inject] [--json]
orca orchestration dispatch-show --task <task_id> [--json]
```

Task statuses: `pending`, `ready`, `dispatched`, `completed`, `failed`, `blocked`.

Dispatch rules:

- `--inject` sends the task spec plus preamble into a recognized agent CLI so it can report `worker_done`.
- If the target is a bare shell, omit `--inject`, dispatch for tracking if needed, then send the prompt manually with `orca terminal send --terminal <handle> --text <prompt> --enter --json`.
- After 3 consecutive failures on one task, the dispatch context circuit-breaks and the task is marked failed.

## Gates And Coordinator

```bash
orca orchestration gate-create --task <task_id> --question <text> [--options <json_array>] [--json]
orca orchestration gate-resolve --id <gate_id> --resolution <text> [--json]
orca orchestration gate-list [--task <task_id>] [--status <status>] [--json]
orca orchestration run --spec <text> [--from <handle>] [--poll-interval-ms <n>] [--max-concurrent <n>] [--worktree <selector>] [--json]
orca orchestration run-stop [--json]
orca orchestration reset [--all] [--tasks] [--messages] [--json]
```

`run` returns immediately with a run ID. Query progress with `task-list`. `reset --tasks` clears tasks, dispatch contexts, gates, and coordinator runs while preserving messages; `reset --all` also clears messages.

## Worker Terminals

Preferred for a new worker workspace:

```bash
orca worktree create --name <task-name> --agent codex --json
orca worktree create --name <task-name> --agent codex --prompt "<direct prompt>" --json
```

Omit `--repo` only when running inside an Orca-managed worktree; otherwise pass `--repo <selector>`. `--agent` reveals the new worktree and launches the selected agent in its first terminal, so do not create a separate startup terminal. Use `--prompt` for direct untracked worker prompts; omit it for tracked task dispatch so `dispatch --inject` owns the task preamble. Use `--setup run|skip|inherit` when setup behavior matters, and `--no-parent` for independent work.

Other terminal commands coordinators often need:

```bash
orca terminal list [--worktree <selector>] [--json]
orca terminal create [--worktree <selector>] [--title <text>] [--command <cmd>] [--json]
orca terminal split --terminal <handle> [--direction horizontal|vertical] [--command <cmd>] [--json]
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms <n> --json
orca terminal read --terminal <handle> --json
orca terminal send --terminal <handle> --text <text> --enter --json
```

If an older CLI rejects `worktree create --agent`, create the worktree normally, then run `orca terminal create --worktree <selector> --command "codex" --json` or `--command "claude"`.

Wait for `tui-idle` before dispatching. Always pass `--timeout-ms`; real coding tasks can take 15-60 minutes. If `check --wait` times out with no `worker_done` or `escalation`, fall back to `terminal wait --for tui-idle`, then `terminal read`.

## Agent Guidance

- Workers with a valid live preamble should send `worker_done` exactly once to the owning coordinator. Include the dispatch payload when the preamble provides one.
- Send heartbeat/status for long tasks when the preamble asks for it.
- If blocked, use `ask` for a blocking coordinator answer or send `escalation` when ownership is valid.
- Treat preambles inherited through terminal history or full handoffs as stale unless the current prompt explicitly keeps that coordinator in the loop.
- Coordinators should use `task-list --ready` as external memory, dispatch parallel waves, and avoid dependency chains deeper than 3-4 steps.
- Prefer inter-worktree workers for parallel implementation; use split panes in one worktree only for complementary tasks that will not edit the same files.

## Example

```bash
orca worktree create --name login-css-worker --agent claude --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration task-create --spec "Fix the login button CSS" --json
orca orchestration dispatch --task <task_id> --to <handle> --inject --json
orca orchestration check --wait --types worker_done,escalation --timeout-ms 300000 --json
```

## Next Action

Confirm Orca status unless already checked, then choose the coordination action: `check`/`inbox`/`reply`/`ask` for messaging, `task-list`/`dispatch-show` for inherited ownership, or `task-create` for new DAG work.
