#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 4 ]]; then
  echo "usage: $0 <run-id> <artifact-prefix> <expected-count> <destination>" >&2
  exit 64
fi

run_id="$1"
prefix="$2"
expected="$3"
destination="$4"

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

[[ "$run_id" =~ ^[0-9]+$ ]] || { echo "invalid run id: $run_id" >&2; exit 65; }
[[ "$expected" =~ ^[0-9]+$ ]] || { echo "invalid expected count: $expected" >&2; exit 65; }
[[ "$prefix" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid artifact prefix: $prefix" >&2; exit 65; }

rm -rf "$destination"
mkdir -p "$destination"

list_file="$(mktemp)"
zip_file="$(mktemp --suffix=.zip)"
cleanup(){ rm -f "$list_file" "$zip_file"; }
trap cleanup EXIT

gh api --method GET --paginate \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100" \
  --jq ".artifacts[] | select(.expired == false and (.name | startswith(\"${prefix}\"))) | \"\\(.id) \\(.name)\"" \
  > "$list_file"

count="$(wc -l < "$list_file" | tr -d ' ')"
unique_ids="$(awk '{print $1}' "$list_file" | sort -u | wc -l | tr -d ' ')"
unique_names="$(awk '{print $2}' "$list_file" | sort -u | wc -l | tr -d ' ')"

if [[ "$count" != "$expected" || "$unique_ids" != "$expected" || "$unique_names" != "$expected" ]]; then
  echo "artifact gate failed: expected=$expected count=$count unique_ids=$unique_ids unique_names=$unique_names prefix=$prefix run=$run_id" >&2
  exit 66
fi

while read -r artifact_id artifact_name; do
  [[ "$artifact_id" =~ ^[0-9]+$ ]] || { echo "invalid artifact id: $artifact_id" >&2; exit 67; }
  [[ "$artifact_name" == "$prefix"* ]] || { echo "unexpected artifact name: $artifact_name" >&2; exit 67; }
  [[ "$artifact_name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "unsafe artifact name: $artifact_name" >&2; exit 67; }

  dest="$destination/$artifact_name"
  mkdir -p "$dest"

  curl -L --fail --silent --show-error \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip" \
    -o "$zip_file"

  unzip -oq "$zip_file" -d "$dest"
done < "$list_file"

downloaded_dirs="$(find "$destination" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [[ "$downloaded_dirs" != "$expected" ]]; then
  echo "download gate failed: expected=$expected downloaded_dirs=$downloaded_dirs" >&2
  exit 68
fi

echo "downloaded $downloaded_dirs artifact(s) with prefix $prefix from run $run_id"
