#!/usr/bin/env bash
# E2E smoke test using playwright-cli.
#
# Usage:
#   pnpm e2e:cli              (dev server must be running on localhost:3000)
#
# This script demonstrates the playwright-cli workflow that coding agents
# (Claude Code, Copilot, etc.) can use for exploratory testing. Each command
# is a simple shell invocation — no test framework required.
#
# Agents can copy and adapt individual commands from this script for ad-hoc
# exploratory testing:
#   npx playwright-cli open http://localhost:3000
#   npx playwright-cli snapshot
#   npx playwright-cli screenshot
#   npx playwright-cli click <ref>
#   npx playwright-cli close

set -euo pipefail

CLI="npx playwright-cli"
BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

cleanup() { $CLI close 2>/dev/null || true; }
trap cleanup EXIT

echo "=== Diagram Workspace E2E (playwright-cli) ==="

# --- Open browser and navigate ---
echo ""
echo "--- Opening browser at $BASE_URL ---"
$CLI open "$BASE_URL" 2>&1

# Wait for SPA redirect: / → /diagram → /diagram/:id
sleep 5

# --- Take snapshot and verify page loaded ---
echo ""
echo "--- Verifying workspace loaded ---"
SNAPSHOT=$($CLI snapshot 2>&1)
echo "$SNAPSHOT"

if echo "$SNAPSHOT" | grep -q "/diagram/"; then
  pass "App redirected to /diagram/:id"
else
  fail "App did not redirect to diagram URL"
fi

if echo "$SNAPSHOT" | grep -q "Page Title: Diagram App"; then
  pass "Page title is 'Diagram App'"
else
  fail "Unexpected page title"
fi

# --- Screenshot for visual verification ---
echo ""
echo "--- Taking screenshot ---"
$CLI screenshot 2>&1

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
