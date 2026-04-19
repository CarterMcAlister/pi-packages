# `@carter-mcalister/pi-rlm`

RLM-first extension for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

This package now exposes two distinct surfaces:

- `rlm` / `/rlm` — a true recursive language model surface with planner, worker, and synthesizer nodes
- `rlm_task` / `/rlm-task` — named reusable RLM workflows backed by Ax agents

## What it is for

Use `rlm` for open-ended tasks that may benefit from recursive decomposition:

- repo architecture analysis
- risk reviews
- broad planning tasks
- multi-part investigations
- synthesis across several subproblems

Use `rlm_task` for repeatable rubric-driven workflows:

- incident reviews
- RFC / design review checks
- long-document analysis
- manager-ready summaries with evidence

## Install

```bash
pi install npm:@carter-mcalister/pi-rlm
```

For local development in this monorepo:

```bash
pi install /absolute/path/to/pi-packages/packages/pi-rlm
```

## Recursive Tool

The `rlm` tool and `/rlm` command support:

- `op: "start"` — start a recursive run
- `op: "status"` — inspect a run or recent runs
- `op: "wait"` — wait for a run to finish
- `op: "cancel"` — cancel a running job

Example:

```text
rlm({
  task: "Analyze the reliability risks in this repo",
  mode: "auto",
  maxDepth: 2,
  maxNodes: 12,
  maxBranching: 3
})
```

Async example:

```text
rlm({ task: "Review this architecture", async: true })
rlm({ op: "status" })
rlm({ op: "wait", id: "<run-id>" })
```

Command example:

```text
/rlm "Analyze the reliability risks in this repo" --maxDepth 2
/rlm "Summarize this repo" --async
/rlm-list
```

## Seeing What RLM Is Doing

Use `/rlm-list` to browse running and completed runs.

- It opens a native Pi selection list.
- Selecting a running run shows current status and recent activity.
- Selecting a completed run shows the final result and artifacts.

Both sync run output and completed run summaries include a `Recent Activity` section so you can see the planner and child-node progress without opening the artifact files.

Artifacts are written under:

```text
/tmp/pi-rlm-runs/<runId>/
```

## Named Workflow Surface

### Slash commands

```text
/rlm-task list
/rlm-task show incident-review
/rlm-task run incident-review --file docs/incidents/checkout.md --audience "engineering managers"
/rlm-task doctor
```

### Tool calls

```text
rlm_task({ task: "incident-review", inputs: { file: "docs/incidents/checkout.md", audience: "engineering managers" } })
```

## Built-in workflows

- `incident-review`
- `rfc-quality-check`

## Project-local workflows

Add local workflow definitions under:

```text
.pi/rlm/tasks/*.ts
```

## Design approach

This package is RLM-first:

- public surfaces talk about RLM workflows and recursive runs
- bundled workflows center `agent(...)` and RLM runtime behavior
- Ax is the implementation layer, not the package identity

The bundled workflows follow current Ax guidance:

- use `agent(...)` rather than manual `new AxAgent(...)`
- default to `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }`
- use `AxJSRuntime()` deliberately for long-context, stateful analysis
- keep `mode: 'simple'` unless recursive delegated sub-agents are actually needed

## Development

```bash
mise install
bun install
bun run --filter @carter-mcalister/pi-rlm check
```
