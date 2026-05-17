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

# Reverse-drift guard: warn if a deployable-looking file exists in the repo
# root but isn't in PROD_FILES. Catches "added new asset, forgot to whitelist."
shopt -s nullglob
ORPHANS=()
for f in *.html *.css *.js *.xml *.txt *.svg *.png *.json; do
  [[ -f "$f" ]] || continue
  printf '%s\n' "${PROD_FILES[@]}" | grep -qFx "$f" || ORPHANS+=("$f")
done
if (( ${#ORPHANS[@]} )); then
  echo "⚠ root files not in PROD_FILES (won't be deployed):" >&2
  printf '   %s\n' "${ORPHANS[@]}" >&2
fi
shopt -u nullglob

echo "→ deploying $(ls -1 "$DIST" | wc -l | tr -d ' ') files from $DIST/"
npx wrangler pages deploy "$DIST" \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-dirty=true
