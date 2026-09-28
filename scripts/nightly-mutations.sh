#!/usr/bin/env bash
#
# The newest finished nightly mutation run on main, as one JSON object, for
# highdesert-status's `mutations` line (.github/workflows/mutations.yml).
#
#   {databaseId, conclusion, createdAt, headSha, url, mutationCheck: [...]}
#
# `mutationCheck` is the conclusion of the "Mutation check" step in each shard,
# which is what tells "a mutation survived" apart from "the run broke before it
# checked anything". Prints {} when there has never been a nightly run; exits
# non-zero when GitHub cannot be read.
set -o pipefail
GH="${HD_GH:-gh}"
REPO="${HD_REPO:-jackson-jpeg/High-Desert}"

runs="$("$GH" run list -R "$REPO" --workflow mutations.yml --event schedule --branch main \
  --status completed --limit 1 --json databaseId,conclusion,createdAt,headSha,url)" || exit 1
id="$(jq -r '.[0].databaseId // empty' <<<"$runs")" || exit 1
if [[ -z "$id" ]]; then
  echo '{}'
  exit 0
fi
jobs="$("$GH" run view "$id" -R "$REPO" --json jobs)" || exit 1
jq -c -n --argjson r "$(jq '.[0]' <<<"$runs")" --argjson j "$jobs" \
  '$r + {mutationCheck: [$j.jobs[] | .steps[]? | select(.name == "Mutation check") | .conclusion]}'
