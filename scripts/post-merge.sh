#!/bin/bash
# Replit post-merge hook — runs after a task-agent branch is merged.
# Delegates to the general-purpose setup script.
set -e
bash "$(dirname "$0")/setup.sh"
