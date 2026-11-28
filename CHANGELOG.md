# Changelog

Append-only log of changes made by coding agents in this repository.

## Policy

- Newest entries go on top, directly under this header.
- Existing entries are never edited, reordered, or deleted. A correction is a new
  entry that names the ID it corrects.
- IDs are stable and date-sequenced: `YYYY-MM-DD-NN`. Link to an entry with
  `CHANGELOG.md#YYYY-MM-DD-NN-title`.
- One entry per task, not per file. Read-only work gets no entry.
- Repository changes only. Global config outside the repo stays out of the log.

## [2026-11-28-02] Agent hardened and changelog protocol added

- **Scope:** `.opencode/agents/sleek-dev.md`, `CHANGELOG.md`
- **Changed:** Rewrote the agent as a senior doctrine with a decision ladder,
  verification gate, delegation economics, and this append-only changelog rule.
  Created `CHANGELOG.md`.
- **Why:** Make the default agent's judgment explicit and keep an auditable,
  undeletable trail of every change it makes.
- **Verified:** Frontmatter parses as `mode: primary`; no TypeScript changed, so
  repo gates were not run.
- **Risk:** Low. Revert the two files to remove the changelog protocol.

## [2026-11-28-01] Default agent switched to sleek-dev

- **Scope:** `opencode.json`, `.opencode/agents/sleek-dev.md`
- **Changed:** Set `default_agent` to `sleek-dev` and created the project-local
  primary agent with repo rules, verification commands, and a delegation map.
- **Why:** Every new session should start with a project-aware engineer instead
  of the prototype agent.
- **Verified:** `opencode.json` parses; the agent file exists with a description
  and `mode: primary`.
- **Risk:** Low. Restore `default_agent` to `prototype` to roll back.
