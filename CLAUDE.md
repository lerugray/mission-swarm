# MissionSwarm — Claude Code pointer

When you open a session in this repo, start here:

1. **Read `README.md` first.** Scope, architecture, explicit v1
   non-goals. The README is the single source of truth on what
   this tool is and isn't.

2. **Task queue + mission context live in the private GeneralStaff
   companion repo**, not here. On Ray's machines, resolve:

   - Mission (why this project exists, scope boundaries):
     `github.com/lerugray/generalstaff-private` →
     `state/mission-swarm/MISSION.md`
     Locally: `C:\Users\rweiss\Documents\Dev Work\private-generalstaff\state\mission-swarm\MISSION.md`

   - Task queue (what to build next, priorities):
     Same repo, `state/mission-swarm/tasks.json`
     Also mirrored into public GS working tree at
     `C:\Users\rweiss\Documents\Dev Work\generalstaff\state\mission-swarm\tasks.json`
     via `sync-state.sh pull`.

   - Fleet CLI view (what's bot-pickable vs interactive):
     `cd ../generalstaff && bun src/cli.ts todo --project=mission-swarm`

3. **Marking tasks done.** Use the GeneralStaff CLI from the
   `generalstaff/` directory:
   ```bash
   bun src/cli.ts task done --project=mission-swarm --task=ms-00X
   ```
   Then run `sync-state.sh push` to carry the change back to the
   private repo. Do NOT line-edit `tasks.json` directly — the CLI
   is the canonical write path.

4. **Current state: v0.0.0 scaffold.** Only the skeleton (README,
   package.json, tsconfig, stub src/index.ts) exists. Real work
   starts with ms-001 (data model design). Work through tasks in
   priority order unless a specific direction is given.

5. **Stack conventions.** TypeScript strict mode, Bun runtime.
   Verify via `bun test && bun x tsc --noEmit`. All simulation
   outputs go to `simulations/<run-id>/` (gitignored). Audience
   profile templates go under `audiences/` (tracked). No external
   database dependencies; persist state as JSON files.

6. **Out of scope.** See README.md §"What it is not" — do not
   graduate features from the out-of-scope list without explicit
   Ray approval. Default is to stay small.
