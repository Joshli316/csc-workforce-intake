#!/usr/bin/env bash
# Build a curated dist/ directory and deploy to Cloudflare Pages.
# `wrangler pages deploy` does not honor .gitignore, so we whitelist
# exactly the files served to clients — anything not listed below stays
# out of production (node_modules, verify/, apps-script/, dev docs).
set -euo pipefail

DIST="dist"
PROJECT="csc-workforce-intake"
BRANCH="main"

PROD_FILES=(
  index.html
  404.html
  styles.css
  script.js
  _headers
  robots.txt
  sitemap.xml
)

rm -rf "$DIST"
mkdir -p "$DIST"

for f in "${PROD_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "✗ missing required file: $f" >&2
    exit 1
  fi
  cp "$f" "$DIST/"
done

echo "→ deploying $(ls -1 "$DIST" | wc -l | tr -d ' ') files from $DIST/"
npx wrangler pages deploy "$DIST" \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-dirty=true
