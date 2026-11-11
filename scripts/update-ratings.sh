#!/usr/bin/env bash
# Pull today's Torvik ratings for men's and women's basketball, commit, push.
#
# Manual fallback for the daily GitHub workflows:  npm run ratings
# Fetches straight from Torvik, so run it from your own machine (Torvik
# returns 403 to GitHub's servers; the workflows go through /api/torvik).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --rebase --autostash origin main

npx tsx src/scripts/updateTeamsFromTorvik.ts
LEAGUE=ncaaw npx tsx src/scripts/updateTeamsFromTorvik.ts

git add src/data/ncaam/teams.csv src/data/ncaam/teamAliases.csv \
        src/data/ncaaw/teams.csv src/data/ncaaw/teamAliases.csv
if git diff --cached --quiet; then
  echo "Ratings unchanged — nothing to commit."
else
  git commit -m "chore: update Torvik ratings $(date +%Y-%m-%d) [skip ci]"
  git push origin main
  echo "✅ Ratings updated and pushed."
fi
