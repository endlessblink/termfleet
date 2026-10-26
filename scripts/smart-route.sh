#!/usr/bin/env bash
# smart-route.sh — enforces model routing by task complexity
# Usage: smart-route.sh "<task description>" [--cwd DIR] [--req R-ID] [extra flags...]
#
# Classifies task → picks cheapest capable provider+model
# Based on SWE-bench data (Oct 2026):
#   Haiku 4.5: 73.3% SWE-bench, 41% Terminal-Bench (navigation only)
#   Sonnet 4.6: 79.6% SWE-bench (default for coding)
#   Opus 4.6: 80.8% SWE-bench (architecture/coordination)
#   Codex GPT-6.1 Sol: mechanical tasks from spec

set -euo pipefail

TASK="$1"
shift
TASK_LOWER=$(echo "$TASK" | tr '[:upper:]' '[:lower:]')

SIMPLE_PATTERNS="search|find file|grep|list|navigate|lookup|read|check status|format|lint"
MECHANICAL_PATTERNS="refactor|rebase|rename|test gen|write tests|add tests|boilerplate|migrate|scaffold|from spec|mechanical"
COMPLEX_PATTERNS="architect|security review|design system|coordinate|multi-file design|complex debug|plan|review pr"

classify() {
  if echo "$TASK_LOWER" | grep -qEi "$COMPLEX_PATTERNS"; then
    echo "complex"
  elif echo "$TASK_LOWER" | grep -qEi "$MECHANICAL_PATTERNS"; then
    echo "mechanical"
  elif echo "$TASK_LOWER" | grep -qEi "$SIMPLE_PATTERNS"; then
    echo "simple"
  else
    echo "standard"
  fi
}

LEVEL=$(classify)

case "$LEVEL" in
  simple)
    PROVIDER="claude"
    MODEL_NOTE="haiku (73.3% SWE-bench, fast+cheap, navigation-grade)"
    ;;
  mechanical)
    PROVIDER="codex"
    MODEL_NOTE="codex GPT-6.1 Sol (mechanical task from spec)"
    ;;
  complex)
    PROVIDER="claude"
    MODEL_NOTE="opus (80.8% SWE-bench, best for architecture)"
    ;;
  standard|*)
    PROVIDER="claude"
    MODEL_NOTE="sonnet (79.6% SWE-bench, sweet spot for coding)"
    ;;
esac

echo "╭─ Smart Route ─────────────────────────────╮"
echo "│ Level:    $LEVEL"
echo "│ Provider: $PROVIDER"
echo "│ Model:    $MODEL_NOTE"
echo "│ Task:     ${TASK:0:60}..."
echo "╰────────────────────────────────────────────╯"

exec termfleet-team start --provider "$PROVIDER" --task "$TASK" "$@"
