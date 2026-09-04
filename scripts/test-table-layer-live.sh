#!/usr/bin/env bash
#
# Runs the signed-in app_members table-layer suite against Royalty PRODUCTION.
#
# playwright.config.js deliberately does not load .env — a spec that reads
# secrets off disk is a surprise in CI. This script is the explicit opt-in: it
# reads the two credentials and nothing else.
#
# ⚠️ Do NOT `source .env` here. PAHKIE_PASSWORD contains an unbalanced single
# quote, so `. ./.env` dies with "unexpected EOF while looking for matching `''"
# and takes the whole run with it.
#
# The suite is READ-ONLY IN EFFECT: every PATCH targets the nil UUID, so zero
# rows are touched whatever the grants say.
set -euo pipefail

cd "$(dirname "$0")/.."

read_env() {
    # cut -f2- keeps '=' inside the value; tr strips a CRLF tail.
    grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

VIIBEVIEW_TEST_EMAIL="$(read_env VIIBEVIEW_TEST_EMAIL)"
VIIBEVIEW_TEST_PASSWORD="$(read_env VIIBEVIEW_TEST_PASSWORD)"

# Fail loudly rather than running a suite that skips every test. A green report
# over twenty tests that never signed in is worse than no report — and this
# suite's whole job is to prove a permission boundary, which an unauthenticated
# run would "prove" for the wrong reason.
if [ -z "$VIIBEVIEW_TEST_EMAIL" ] || [ -z "$VIIBEVIEW_TEST_PASSWORD" ]; then
    cat >&2 <<'EOF'
ERROR: VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD are not both set in .env

This suite drives a REAL signed-in member against Royalty production to prove
that app_members is no longer writable from a client role. It needs a real
account:

  1. Open /a/viibeview/social -> Profile -> Create Account
     (use a throwaway address you control)
  2. Add to .env (already gitignored):
       VIIBEVIEW_TEST_EMAIL=you+viibeview@example.com
       VIIBEVIEW_TEST_PASSWORD=...

Then re-run: npm run test:table-layer:live

The anon half of this coverage needs no credentials and always runs:
  npx playwright test e2e/security/phase-a-anon-grants.spec.js
EOF
    exit 1
fi

export VIIBEVIEW_TEST_EMAIL VIIBEVIEW_TEST_PASSWORD
exec npx playwright test e2e/security/app-members-table-layer-live.spec.js "$@"
