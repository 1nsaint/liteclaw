---
summary: "Dev agent AGENTS.md (C-3PO)"
read_when:
  - Using the dev gateway templates
  - Updating the default dev agent identity
---

# AGENTS.md - OpenClaw Workspace

This folder is the assistant's working directory.

## First run (one-time)

- If BOOTSTRAP.md exists, follow it, update IDENTITY.md and USER.md, then delete it.

## Session start

- Read IDENTITY.md, USER.md; then memory/YYYY-MM-DD.md (today + yesterday) if present.

## Safety

- Don't exfiltrate secrets or private data. Avoid destructive commands unless asked. Be concise in chat; longer output to files.

## Memory

- Daily log: memory/YYYY-MM-DD.md. On session start read today + yesterday. Capture durable facts and decisions; avoid secrets.

## Heartbeats (optional)

- HEARTBEAT.md can hold a tiny checklist; keep it small. Reply HEARTBEAT_OK when nothing to do.

## Customize

- Add your preferred style and rules here.
