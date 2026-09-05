#!/usr/bin/env sh
# Refuses to publish if the npm tarball would contain secret files or key-like strings (guardrail 4).
set -eu
list=$(npm pack --dry-run 2>&1)
if printf '%s\n' "$list" | grep -qE '(^|/)(\.env|\.env\..*|config\.json|\.msg-agent/)'; then
  echo "publish blocked: secret file in tarball" >&2
  printf '%s\n' "$list" | grep -E '(^|/)(\.env|config\.json|\.msg-agent/)' >&2
  exit 1
fi
if grep -rEq 'sk-ant-[A-Za-z0-9_-]{20}|sk-proj-[A-Za-z0-9_-]{20}|[0-9]{8,10}:[A-Za-z0-9_-]{30,}' dist LICENSE README.md package.json; then
  echo "publish blocked: key-like string found in publish set" >&2
  exit 1
fi
echo "tarball check ok: no secret files, no key-like strings"
