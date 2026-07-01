# AGENTS.md — LHC Worship Prep

## Source of Truth
**GitHub is the single source of truth.** All work must be committed and pushed before a session ends. Never leave changes only on disk.

## Agent Roles

| Agent | Role |
|-------|------|
| **Claude Code** | Primary architect and builder. Owns all major decisions on architecture, data model, and feature design. |
| **Codex** | Full secondary builder. May be used when Claude hits usage limits, or when help is needed with design, debugging, Supabase, app structure, or build issues. |

Both agents are authorised to work on:
- App structure and routing
- UI/UX design and components
- Supabase queries, RLS policies, and auth
- API routes and server actions
- Debugging build and runtime errors
- SQL migration files when database changes are needed

## Workflow Rules

### Branching
- All non-trivial work happens on a feature branch, not directly on `master`.
- Branch naming: `feature/<short-description>` or `fix/<short-description>`.
- Merge to `master` via PR or direct merge only when the feature is complete and tested.

### Commits
- Write clear, descriptive commit messages (what changed and why).
- Commit frequently — do not batch unrelated changes into one commit.

### Database / Supabase
- **Never make silent destructive database changes** (drop tables, remove columns, change column types).
- If a schema change is required:
  1. Create a SQL file in `migrations/` (named `YYYY-MM-DD_description.sql`).
  2. Explain what the migration does and why before running it.
  3. Run it in the Supabase SQL Editor manually after review.
- Do not enable or disable RLS, or modify existing policies, without explaining the security impact.

### Environment Variables
- Do not rename existing environment variables without explicit approval.
- Document any new variable in `.env.local.example` alongside the change that needs it.

### Vercel
- Do not change Vercel project settings, environment variables in the Vercel dashboard, or deployment targets without approval.

### End of Session
- Update `HANDOFF.md` to reflect what changed, what is unfinished, and any new risks or concerns.
- Push all commits before closing the session.

## Architecture Quick Reference
- **Frontend:** Monolithic `Index.html` (~18 000 lines) — all HTML, CSS, and JS in one file. `dist/index.html` is the built copy deployed to Vercel.
- **Backend:** Google Apps Script (`server.gs`) for legacy Google Sheets integration; Next.js API routes (`app/api/`) for newer Supabase-backed features.
- **Database:** Supabase (PostgreSQL). Tables listed in `HANDOFF.md`.
- **Deployment:** Vercel (Next.js). The `dist/` folder is the static build served in production.
- **Secondary app:** Vocal Hero practice game lives in a separate repo (`Vocal-Hero`) and is linked from the `practice-game/` route.
