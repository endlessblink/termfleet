#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERMINAL_WORKSPACE_PERF_MODE=dev "$SCRIPT_DIR/verify-tauri-performance.sh"
