#!/usr/bin/env bash
#
# Runs the live ViibeView password-recovery suite against Royalty PRODUCTION.
#
# ⚠️ THIS CHANGES A REAL PASSWORD. e2e/flows/viibeview-reset.spec.js mints a
# genuine recovery link for VIIBEVIEW_TEST_EMAIL, sets a new password through
# the real form, and restores VIIBEVIEW_TEST_PASSWORD in afterAll. Read that
# file's header before running it — the restore is what keeps .env true.
#
# ⚠️ It also INVALIDATES any recovery token previously issued for that user.
#
# playwright.config.js deliberately does not load .env — a spec that reads
# secrets off disk is a surprise in CI (e2e/security/client-workspace-live.spec.js:8-10).
# This script is the explicit opt-in: it reads the three credentials by name and
# nothing else, and passes them to this one command.
#
# ⚠️ Do NOT `source .env` here. PAHKIE_PASSWORD contains an unbalanced single
# quote, so `. ./.env` dies with "unexpected EOF while looking for matching `''"
# and takes the whole run with it. Reading keys by name also means this cannot
# accidentally export an unrelated secret into the test process.
set -euo pipefail

cd "$(dirname "$0")/.."

read_env() {
    # cut -f2- keeps '=' inside the value; tr strips a CRLF tail.
    grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

VIIBEVIEW_TEST_EMAIL="$(read_env VIIBEVIEW_TEST_EMAIL)"
VIIBEVIEW_TEST_PASSWORD="$(read_env VIIBEVIEW_TEST_PASSWORD)"
SUPABASE_SERVICE_ROLE_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY)"

# Fail loudly rather than running a suite that skips every test. A green report
# over two tests that never minted a link is worse than no report.
if [ -z "$VIIBEVIEW_TEST_EMAIL" ] || [ -z "$VIIBEVIEW_TEST_PASSWORD" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    cat >&2 <<'EOF'
ERROR: VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD / SUPABASE_SERVICE_ROLE_KEY
are not all set in .env

These tests drive a REAL password reset against Royalty production, so they need
a real account and the service role key (to mint a recovery link WITHOUT sending
mail, and to put the password back afterwards).

  1. Open /a/viibeview/social -> Profile -> Create Account
     (use a throwaway address you control)
  2. Add to .env (already gitignored):
       VIIBEVIEW_TEST_EMAIL=you+viibeview@example.com
       VIIBEVIEW_TEST_PASSWORD=...
       SUPABASE_SERVICE_ROLE_KEY=...

Then re-run: npm run test:viibeview:reset:live
EOF
    exit 1
fi

# VIIBEVIEW_TEST_PASSWORD is the value the suite restores to. If it is already
# wrong, the restore "succeeds" into a password nobody knows — so prove it works
# BEFORE changing anything. This is cheap and it is the difference between a
# failed run and a locked-out test account.
SUPABASE_URL="https://vhpmmfhfwnpmavytoomd.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk"

precheck_status=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    --data-binary "$(VIIBEVIEW_TEST_EMAIL="$VIIBEVIEW_TEST_EMAIL" \
                     VIIBEVIEW_TEST_PASSWORD="$VIIBEVIEW_TEST_PASSWORD" \
                     node -e 'process.stdout.write(JSON.stringify({email:process.env.VIIBEVIEW_TEST_EMAIL,password:process.env.VIIBEVIEW_TEST_PASSWORD}))')")

if [ "$precheck_status" != "200" ]; then
    cat >&2 <<EOF
ERROR: VIIBEVIEW_TEST_PASSWORD does not currently work for $VIIBEVIEW_TEST_EMAIL
       (sign-in returned HTTP $precheck_status)

Refusing to run. This suite CHANGES the password and then restores it to that
value — restoring to a password that was already wrong would leave the account
on a password nobody has. Fix .env first.
EOF
    exit 1
fi

echo "✓ VIIBEVIEW_TEST_PASSWORD verified against production — safe to proceed"

export VIIBEVIEW_TEST_EMAIL VIIBEVIEW_TEST_PASSWORD SUPABASE_SERVICE_ROLE_KEY
exec npx playwright test e2e/flows/viibeview-reset.spec.js "$@"
