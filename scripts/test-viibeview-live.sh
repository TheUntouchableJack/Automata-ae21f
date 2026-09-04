#!/usr/bin/env bash
#
# Runs the signed-in ViibeView member suite against Royalty PRODUCTION.
#
# playwright.config.js deliberately does not load .env — a spec that reads
# secrets off disk is a surprise in CI (e2e/security/client-workspace-live.spec.js:8-10).
# This script is the explicit opt-in: it reads the two credentials and nothing
# else, and passes them to this one command.
#
# ⚠️ Do NOT `source .env` here. PAHKIE_PASSWORD contains an unbalanced single
# quote, so `. ./.env` dies with "unexpected EOF while looking for matching `''"
# and takes the whole run with it. Reading the two keys by name also means this
# cannot accidentally export an unrelated secret into the test process.
set -euo pipefail

cd "$(dirname "$0")/.."

read_env() {
    # cut -f2- keeps '=' inside the value; tr strips a CRLF tail.
    grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

VIIBEVIEW_TEST_EMAIL="$(read_env VIIBEVIEW_TEST_EMAIL)"
VIIBEVIEW_TEST_PASSWORD="$(read_env VIIBEVIEW_TEST_PASSWORD)"

# Fail loudly rather than running a suite that skips every test. A green report
# over five tests that never signed in is worse than no report.
if [ -z "$VIIBEVIEW_TEST_EMAIL" ] || [ -z "$VIIBEVIEW_TEST_PASSWORD" ]; then
    cat >&2 <<'EOF'
ERROR: VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD are not both set in .env

These tests drive a REAL ViibeView member against Royalty production, so they
need a real account. Create one once, by hand:

  1. Open /a/viibeview/social -> Profile -> Create Account
     (use a throwaway address you control)
  2. Add to .env (already gitignored):
       VIIBEVIEW_TEST_EMAIL=you+viibeview@example.com
       VIIBEVIEW_TEST_PASSWORD=...

Then re-run: npm run test:viibeview:live
EOF
    exit 1
fi

export VIIBEVIEW_TEST_EMAIL VIIBEVIEW_TEST_PASSWORD
exec npx playwright test e2e/flows/viibeview-member.spec.js "$@"
