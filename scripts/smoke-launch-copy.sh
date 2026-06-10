#!/usr/bin/env bash
# smoke-launch-copy.sh
#
# PURPOSE: Pre-flight any hammerstein.ai launch copy before it ships.
#   Feed a draft post or announcement into the wargamer (or other) audience
#   swarm, run 3 rounds with 8 personas, then summarize. Quick gut-check for
#   copy that will face an AI-skeptical, hype-averse community.
#
# METRIC: >=1 accepted revision per post on the next 3 posts, or this dies.
#   "Accepted revision" = copy changes made after reviewing swarm output.
#
# KILL-CONDITION: No known consumer or measurable metric within two weeks of
#   first commit -> delete this script and audiences/wargamer.json, per the
#   7B's dispatch order 2026-06-10, see
#   hammerstein-model/experiments/project-work-2026-06-10/.
#
# USAGE: ./scripts/smoke-launch-copy.sh <copy-file.md> [audience]
#   Default audience: wargamer
#   Pass DRY_RUN=1 (or --dry-run as first positional before the file) to run
#   with the canned mock provider — exercises the full wiring with no API calls.
#
# EXAMPLES:
#   ./scripts/smoke-launch-copy.sh docs/launch-posts/hacker-news.md
#   ./scripts/smoke-launch-copy.sh docs/launch-posts/hacker-news.md tech-dev
#   DRY_RUN=1 ./scripts/smoke-launch-copy.sh /tmp/sample-copy.md wargamer
#   ./scripts/smoke-launch-copy.sh --dry-run /tmp/sample-copy.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── flag parsing ────────────────────────────────────────────────────────────

DRY_RUN="${DRY_RUN:-}"
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)         POSITIONAL+=("$arg") ;;
  esac
done

COPY_FILE="${POSITIONAL[0]:-}"
AUDIENCE="${POSITIONAL[1]:-wargamer}"

if [[ -z "$COPY_FILE" ]]; then
  echo "Usage: $0 [--dry-run] <copy-file.md> [audience]" >&2
  echo "  Default audience: wargamer" >&2
  echo "  DRY_RUN=1 or --dry-run: mock provider, no API calls" >&2
  exit 1
fi

if [[ ! -f "$COPY_FILE" ]]; then
  echo "Error: copy file not found: $COPY_FILE" >&2
  exit 1
fi

# ── run ─────────────────────────────────────────────────────────────────────

DRY_FLAG=""
if [[ -n "$DRY_RUN" ]]; then
  DRY_FLAG="--dry-run"
fi

echo "[smoke-launch-copy] input:    $COPY_FILE"
echo "[smoke-launch-copy] audience: $AUDIENCE"
echo "[smoke-launch-copy] rounds:   3  personas: 8${DRY_FLAG:+  (dry-run)}"
echo ""

# Run the simulation — streaming to stderr, capture sim-id from stderr output
SIM_OUTPUT=$( \
  bun "$REPO_ROOT/src/index.ts" \
    "$COPY_FILE" \
    --audience "$AUDIENCE" \
    --rounds 3 \
    --personas 8 \
    $DRY_FLAG \
    2>&1 1>/dev/null \
)

echo "$SIM_OUTPUT"

# Extract sim-id from stderr line: "starting sim <id> ·"
SIM_ID=$(echo "$SIM_OUTPUT" | grep -oE 'starting sim [^ ]+' | awk '{print $3}' | head -1)

if [[ -z "$SIM_ID" ]]; then
  echo "" >&2
  echo "[smoke-launch-copy] ERROR: could not detect simulation id from output above." >&2
  exit 1
fi

SIMS_DIR="${MISSIONSWARM_SIMS_DIR:-$REPO_ROOT/simulations}"
SIM_DIR="$SIMS_DIR/$SIM_ID"

echo ""
echo "[smoke-launch-copy] simulation complete → $SIM_DIR"
echo ""

# ── summarize ───────────────────────────────────────────────────────────────

echo "[smoke-launch-copy] generating summary..."

bun "$REPO_ROOT/src/index.ts" summarize "$SIM_DIR" \
  $DRY_FLAG \
  --stdout 2>&1

SUMMARY_PATH="$SIM_DIR/summary.md"

echo ""
echo "[smoke-launch-copy] outputs:"
echo "  simulation dir: $SIM_DIR"
echo "  summary:        $SUMMARY_PATH"
echo ""
echo "[smoke-launch-copy] done."
