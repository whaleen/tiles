# Agent Inbox

This project has an in-app feedback/request inbox for bugs, feature requests, UI notes, chores, and questions submitted while using tiles.

## Storage

Adapter: `tauri-jsonl`

During dev, records are appended to:

```text
.agent/inbox/feedback.jsonl
```

You can override the directory used by the Tauri command with:

```bash
TILES_AGENT_INBOX_DIR=/path/to/inbox pnpm dev
```

Packaged builds write to the app data directory under `agent-inbox/`.

## Submit records

Run the app and press:

```text
⌘/
```

The modal captures the active tab, selected project, workspace path, app version, URL, and typed request.

## Read records

From the app, press `⌘/` and open the Inbox tab to see active local work items.

From the terminal:

```bash
jq -c 'select(.status == "new" or .status == "planned" or .status == "accepted" or .status == "in_progress")' .agent/inbox/feedback.jsonl
```

If `feedback.jsonl` does not exist yet, no feedback has been submitted.

## Watch live records during dev

```bash
touch .agent/inbox/feedback.jsonl
tail -f .agent/inbox/feedback.jsonl
```

## Update records

From the app Inbox tab, records can be edited, deleted, copied as agent prompts, promoted to issue prompts, or marked `planned`, `accepted`, `done`, or `wontfix`. `accepted` means the attached plan is approved for implementation.

The Tauri commands rewrite `feedback.jsonl` for edits/status updates/deletes. Agents should not delete records unless the user asks. When handling a record, mention the record ID in commits, PRs, or issue notes.

## Agent workflow

1. Review `status: new` records before/while planning.
2. Group duplicates. Ask for clarification only if a record is genuinely ambiguous.
3. **Plan → write → then respond.** When planning a record, write the plan into the `plan` field, set `status: planned`, update `updatedAt`, and append an `agentNotes` entry — before or in the same response where the plan is described in chat. The record must be updated the moment the user sees the plan. Never describe a plan in chat and leave the record unupdated.
4. The user reviews the plan in the app UI and marks it `accepted` there. Do not ask for verbal approval in chat.
5. When a record is `accepted`, implement it: set `in_progress`, do the work, mark `done` with an `agentNotes` summary.
6. Convert larger records to issues/PRDs when asked.
7. Preserve original user text in `body`.
