#!/bin/bash
# General-purpose setup script.
#
# Works on Replit (called by post-merge.sh after task-agent merges)
# and locally (run after git clone or git pull to sync deps and DB schema).
#
# Usage:
#   bash scripts/setup.sh
set -e

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile

echo "→ Pushing DB schema..."
pnpm --filter @workspace/db run push

echo "✓ Setup complete."
