#!/usr/bin/env bash
# Generate, upload and republish the "email" frame for every article that has one.
cd "$(dirname "$0")/../.."
LOG=".mockups/email-frames.log"
: > "$LOG"
for d in scripts/blog/*/; do
  slug=$(basename "$d")
  [ -f "$d/frames.json" ] || continue
  grep -q '"key": "email"' "$d/frames.json" || continue
  echo "=== $slug ===" | tee -a "$LOG"
  node scripts/gen_blog_frames.mjs "$slug" --only email --force 2>&1 | tee -a "$LOG"
  if [ -f ".mockups/blog-$slug/email.jpg" ]; then
    node scripts/gen_blog_frames.mjs "$slug" --upload-existing 2>&1 | tail -2 | tee -a "$LOG"
    node scripts/publish_post.mjs "$slug" 2>&1 | tail -3 | tee -a "$LOG"
  else
    echo "!! no email.jpg for $slug, skipped publish" | tee -a "$LOG"
  fi
done
echo "ALL DONE" | tee -a "$LOG"
