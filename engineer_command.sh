#!/usr/bin/env bash
# mission-swarm — autonomous engineering bot launcher (ms-010)
#
# Usage: bash engineer_command.sh [budget_minutes]
#
# Invoked by GeneralStaff's dispatcher. Creates a git worktree at
# .bot-worktree on branch bot/work, installs Bun deps, runs claude -p
# inside it, exits. Cleanup + verification handled by dispatcher.
#
# SCAFFOLD ONLY — bot cycles remain inert until Ray adds the
# mission-swarm entry to projects.yaml AND flips at least one task's
# interactive_only flag to false in state/mission-swarm/tasks.json.

set -euo pipefail

BUDGET_MINUTES="${1:-30}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
WORKTREE_DIR="$PROJECT_ROOT/.bot-worktree"
BRANCH="${GENERALSTAFF_BOT_BRANCH:-bot/work}"

echo "=== mission-swarm Bot Launcher ==="
echo "Budget: ${BUDGET_MINUTES} min"
echo "Project root: $PROJECT_ROOT"
echo "Worktree: $WORKTREE_DIR"
echo "Branch: $BRANCH"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================="

if ! git -C "$PROJECT_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "Creating branch $BRANCH from main..."
  git -C "$PROJECT_ROOT" branch "$BRANCH" main
fi

git -C "$PROJECT_ROOT" worktree prune 2>/dev/null || true

if [ -d "$WORKTREE_DIR" ]; then
  echo "Stale worktree found — removing..."
  git -C "$PROJECT_ROOT" worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
fi

echo "Creating worktree at $WORKTREE_DIR on $BRANCH..."
git -C "$PROJECT_ROOT" worktree add "$WORKTREE_DIR" "$BRANCH"

echo "Installing Bun deps in worktree..."
cd "$WORKTREE_DIR"
bun install --silent 2>&1 | tail -3 || {
  echo "bun install failed — bot cycle will likely fail verification"
}

echo ""
echo "Launching autonomous claude -p in worktree..."
echo ""

claude -p "You are an autonomous engineering bot working on mission-swarm — a swarm-reaction simulation engine (TypeScript, Bun). Given an input event + an audience profile + persona count + round count, the simulation generates personas that react in rounds, emitting per-persona text + stance/interest deltas per round. Your job is extending test coverage, fixing narrow bugs when real-world runs surface regressions, and adding infrastructure helpers.

## Your environment
Git worktree on $BRANCH at $WORKTREE_DIR. Bun deps installed. Do NOT touch the main working tree.

## Your task
Read \$GENERALSTAFF_ROOT/state/mission-swarm/tasks.json. Pick highest-priority pending task that is NOT interactive_only. Skip any task flagged interactive_only: true. Work on exactly that task.

## What you can do
- Add tests under tests/ (Bun test style — see tests/simulation.test.ts + tests/summary.test.ts for the established pattern).
- Add new modules under src/ that don't modify the hands_off files.
- Narrow bug fixes in src/ when a test discovers a real regression — keep diffs tight, document the fix in the commit body.
- Extend CLI subcommands in src/index.ts when a task calls for it.
- Commit with a message starting with the task id (e.g. 'ms-012: <summary>').
- Mark task done via GS CLI:

    bun \"\$GENERALSTAFF_ROOT/src/cli.ts\" task done --project=mission-swarm --task=<task-id>

## What you must NOT do
- Modify any file listed in hands_off.yaml OR in GeneralStaff's projects.yaml hands_off for mission-swarm:
  - README.md, CLAUDE.md, MISSION.md (voice-bearing prose)
  - audiences/ (audience profiles — taste work)
  - src/summary.ts (contains SUMMARY_SYSTEM_PROMPT — voice)
  - src/personas.ts (contains persona-generation prompt — voice)
  - src/types.ts (foundational type design — extensions need Ray)
  - docs/ (design docs — Ray's authorship)
  - engineer_command.sh, hands_off.yaml (your own scaffold)
  - package.json, tsconfig.json, .gitignore, .claude/
- Invent new audience profiles. If a task requires new audience voice work, abandon with a note — that's interactive-only.
- Change the simulation engine's core shape (Promise.all parallelism per round, 3-round sliding-window default) without a clear task directive.
- Break any existing test — run 'bun x tsc --noEmit && bun test' before commit.

## Verification gate
bun x tsc --noEmit && bun test. Tests run in ~0.5s on the existing suite. All 22+ tests must pass.

## Style
TypeScript strict. Match existing module structure — each src/*.ts has a header comment explaining what the module does + why. Test files use 'describe' + 'test' + 'expect' from bun:test. Commit messages: imperative, lowercase task-id prefix. Co-Authored-By: Claude trailer.

## Budget
${BUDGET_MINUTES} min total. Stop before expiring. One task per invocation — dispatcher starts a fresh cycle for the next.
" \
  --allowedTools "Read,Write,Edit,Bash,Grep,Glob" \
  --dangerously-skip-permissions \
  --mcp-config '{"mcpServers":{}}' \
  --strict-mcp-config \
  --output-format text

echo ""
echo "Bot finished. Exit code: $?"
echo "Ended: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
