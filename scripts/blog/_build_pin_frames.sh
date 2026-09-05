#!/usr/bin/env bash
# Generate the 2:3 "pin" scene for every article that has one (no upload; the
# poster composer uploads the finished poster instead).
cd "$(dirname "$0")/../.."
for d in scripts/blog/*/; do
  slug=$(basename "$d")
  [ -f "$d/frames.json" ] || continue
  grep -q '"key": "pin"' "$d/frames.json" || continue
  echo "=== $slug"
  node scripts/gen_blog_frames.mjs "$slug" --only pin --force 2>&1 | grep -E "pin …|failed"
done
echo "ALL DONE"
