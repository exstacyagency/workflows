#!/usr/bin/env bash
set -euo pipefail

kill_pid() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
    fi
    rm -f "$pid_file"
  fi
}

kill_pid /tmp/e2e_worker.pid
kill_pid /tmp/e2e_server.pid
