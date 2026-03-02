# Lite core files

Minimal versions of the official workspace bootstrap files from `docs/reference/templates/`. They keep the **required** behavior from the OpenClaw docs but stay short (~1–2k tokens total instead of ~11k).

## What the official repo says

- **AGENTS.md** — Operating instructions. **Required**: session-start ritual (read SOUL.md, USER.md, memory files before responding), memory policy (write to files; no mental notes), safety rules, pointer to TOOLS.md. See `docs/reference/AGENTS.default.md` and `docs/reference/templates/AGENTS.md`.
- **TOOLS.md** — **Does not** control which tools exist (system prompt does). It’s for *your* setup: SSH hosts, device names, TTS voice, etc. See `docs/reference/templates/TOOLS.md`.
- **SOUL.md** — Persona, tone, boundaries. Required: identity/vibe; tell the user if you change it. See `docs/reference/templates/SOUL.md`.
- **IDENTITY.md** — Name, creature, vibe, emoji (optional avatar). Filled in during first run. See `docs/reference/templates/IDENTITY.md`.
- **USER.md** — Who the human is; how to address them; optional timezone/notes. See `docs/reference/templates/USER.md`.
- **HEARTBEAT.md** — Empty = skip heartbeat checks. Add a short checklist for periodic checks; agent replies `HEARTBEAT_OK` when nothing to do. See `docs/reference/templates/HEARTBEAT.md`.
- **BOOTSTRAP.md** — One-time first-run ritual; delete after completing. See `docs/reference/templates/BOOTSTRAP.md`.
- **MEMORY.md** — Long-term memory; main session only. Use memory_search on this + memory/*.md. See memory docs and system prompt.

## Seed into container

From repo root:

```bash
for f in scripts/lite-core-files/*.md; do name=$(basename "$f"); docker cp "$f" liteclaw:/home/node/.openclaw/workspace/"$name"; done
```

Or create-only (skip if file exists): run `./scripts/seed-lite-core-files.sh`.
