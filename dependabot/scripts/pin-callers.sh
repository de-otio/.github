#!/usr/bin/env bash
# Fill the __PIN_SHA__ placeholder in the per-repo caller patches and files.
#
# The reusable workflows refuse any `scripts-ref` that is not a full commit SHA,
# and the callers pin `de-otio/.github/...@<SHA>` to the same SHA. The caller
# drafts carry the placeholder until this repo's PR is merged; then run
#
#   dependabot/scripts/pin-callers.sh <merged-commit-sha> <patch-dir-or-file>...
#
# Each directory is searched recursively (every regular file that contains the
# placeholder is rewritten in place); each file is rewritten directly.
# Exit: 0 filled (or nothing to fill), 1 bad SHA or a placeholder left behind,
# 2 usage error.
set -euo pipefail

PLACEHOLDER='__PIN_SHA__'

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <40-char-lowercase-commit-sha> <path>..." >&2
  exit 2
fi

sha="$1"
shift
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "pin-callers: '$sha' is not a 40-character lowercase commit SHA" >&2
  exit 1
fi

files=()
for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done \
      < <(grep -rl --null --binary-files=without-match -- "$PLACEHOLDER" "$target" || true)
  elif [ -f "$target" ]; then
    files+=("$target")
  else
    echo "pin-callers: no such file or directory: $target" >&2
    exit 2
  fi
done

filled=0
for f in "${files[@]+"${files[@]}"}"; do
  if grep -q -- "$PLACEHOLDER" "$f"; then
    # The SHA is validated above, so it is safe inside the replacement.
    perl -pi -e "s/\Q$PLACEHOLDER\E/$sha/g" "$f"
    filled=$((filled + 1))
  fi
  if grep -q -- "$PLACEHOLDER" "$f"; then
    echo "pin-callers: placeholder still present in $f" >&2
    exit 1
  fi
done
echo "pin-callers: filled $filled file(s) with $sha"
