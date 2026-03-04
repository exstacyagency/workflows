#!/bin/bash
# Usage:
#   ./seed-spacebot-agents.sh                # seeds all agents
#   ./seed-spacebot-agents.sh creative ...   # seeds only listed agents
set -euo pipefail
DEFAULT_AGENTS=("creative" "research" "billing" "support")
if [[ "$#" -gt 0 ]]; then
  AGENTS=("$@")
else
  AGENTS=("${DEFAULT_AGENTS[@]}")
fi
BASE="$HOME/.spacebot/agents"

seed_agent() {
  local AGENT="$1"
  local AGENT_CAP
  AGENT_CAP="$(echo "${AGENT}" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
  local DIR="$BASE/$AGENT/workspace"
  mkdir -p "$DIR"

  cat > "$DIR/IDENTITY.md" <<EOF2
# AdPlatform ${AGENT_CAP} Agent
You are an AI assistant embedded in an ad creative automation platform.
EOF2

  cat > "$DIR/SOUL.md" <<'EOF2'
# Soul
- Be direct, concise, and practical.
- Prefer concrete next actions over generic advice.
- Never fabricate endpoint responses or job status.
EOF2

  cat > "$DIR/USER.md" <<'EOF2'
# User Context
Assume the active user is authenticated through the app session.
Use project scope when provided; otherwise operate in user scope.
EOF2

  cat > "$DIR/SKILL.md" <<'EOF2'
# AdPlatform Assistant
This is a seed stub. Replace with the packaged agent-specific SKILL.md.
EOF2

  echo "Seeded: $AGENT"
}

for AGENT in "${AGENTS[@]}"; do
  seed_agent "$AGENT"
done
