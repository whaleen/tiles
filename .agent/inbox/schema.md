# Agent Inbox Schema

Each record describes one user-submitted app feedback/request item.

## Fields

- `id`: unique record ID, usually `fb_<epoch_ms>_<process_id>`
- `kind`: `bug`, `feature`, `ui`, `chore`, `question`, or `other`
- `status`: lifecycle state
- `title`: optional summary
- `body`: original user text; never overwrite destructively
- `plan`: optional concrete plan/acceptance criteria; `accepted` means this plan is approved
- `app`: app/project name, normally `tiles`
- `environment`: `dev` or `production`
- `route`: app tab/page when submitted
- `url`: full WebView URL when available
- `context`: project-specific JSON context
- `createdAt`: ISO-8601 timestamp from the frontend
- `updatedAt`: ISO-8601 timestamp from the frontend
- `createdBy`: optional user/session identifier
- `comments`: plan revision thread — array of `{ id, from: "user"|"agent", body, createdAt }`. Both user and agent post here during plan negotiation. Cleared on compact.
- `agentNotes`: append-only array of `{ at, body }` entries; survives compact
- `linkedIssue`: optional issue/PR URL or tracker ID

## Status lifecycle

- `new`: submitted, not yet acted on
- `planned`: agent has drafted a plan; awaiting user approval
- `accepted`: attached plan is approved to implement
- `in_progress`: being worked on
- `done`: implemented/resolved
- `wontfix`: intentionally declined

## Example

```json
{
  "id": "fb_1779627600000_12345",
  "kind": "ui",
  "status": "new",
  "title": "Make delete safer",
  "body": "The delete button should ask for confirmation.",
  "plan": "Add a confirmation dialog before deleting media.",
  "app": "tiles",
  "environment": "dev",
  "route": "/library/demo",
  "url": "http://localhost:5173/",
  "context": {
    "activeTab": "library",
    "project": "demo",
    "workspace": "/Users/josh/Movies/tiles",
    "appVersion": "0.1.4"
  },
  "createdAt": "2026-05-24T13:00:00.000Z",
  "updatedAt": "2026-05-24T13:00:00.000Z",
  "createdBy": null,
  "agentNotes": [],
  "linkedIssue": null
}
```
