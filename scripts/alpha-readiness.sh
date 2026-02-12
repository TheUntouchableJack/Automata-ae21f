#!/bin/bash

# Royalty Alpha Readiness Check
# Run this before starting alpha testing with real users

set -e

echo "========================================"
echo "  ROYALTY ALPHA READINESS CHECK"
echo "  $(date)"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0
WARNINGS=0

check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1"
        ((FAILED++))
    fi
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# -----------------------------------------
echo "1. CHECKING SUPABASE CLI..."
# -----------------------------------------
command -v supabase >/dev/null 2>&1
check "Supabase CLI installed"

# -----------------------------------------
echo ""
echo "2. CHECKING EDGE FUNCTIONS..."
# -----------------------------------------
cd "$(dirname "$0")/.."

FUNCTIONS=$(supabase functions list 2>&1 | grep -c "ACTIVE" || true)
if [ "$FUNCTIONS" -ge 10 ]; then
    echo -e "${GREEN}✓${NC} $FUNCTIONS Edge Functions deployed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Only $FUNCTIONS Edge Functions active (need 10+)"
    ((FAILED++))
fi

# Check critical functions
echo "   Checking critical functions..."
CRITICAL_FUNCTIONS="stripe-webhook resend-webhook twilio-webhook automation-engine royal-ai-prompt message-sender create-checkout-session"
for func in $CRITICAL_FUNCTIONS; do
    if supabase functions list 2>&1 | grep -q "$func.*ACTIVE"; then
        echo -e "   ${GREEN}✓${NC} $func"
    else
        echo -e "   ${RED}✗${NC} $func NOT FOUND or inactive"
        ((FAILED++))
    fi
done

# -----------------------------------------
echo ""
echo "3. CHECKING SECRETS..."
# -----------------------------------------
SECRETS=$(supabase secrets list 2>&1)

for secret in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY RESEND_WEBHOOK_SECRET TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_PHONE_NUMBER; do
    if echo "$SECRETS" | grep -q "$secret"; then
        echo -e "${GREEN}✓${NC} $secret is set"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $secret is MISSING"
        ((FAILED++))
    fi
done

# -----------------------------------------
echo ""
echo "4. CHECKING LOCAL DEPENDENCIES..."
# -----------------------------------------
if [ -f "package.json" ]; then
    check "package.json exists"
else
    echo -e "${RED}✗${NC} package.json not found"
    ((FAILED++))
fi

if [ -d "node_modules" ]; then
    check "node_modules exists"
else
    warn "node_modules not found - run 'npm install'"
fi

# -----------------------------------------
echo ""
echo "5. CHECKING PLAYWRIGHT..."
# -----------------------------------------
if [ -f "playwright.config.js" ]; then
    check "Playwright config exists"
else
    warn "playwright.config.js not found"
fi

if npx playwright --version >/dev/null 2>&1; then
    check "Playwright installed"
else
    warn "Playwright not installed - run 'npx playwright install'"
fi

# -----------------------------------------
echo ""
echo "6. CHECKING MIGRATIONS..."
# -----------------------------------------
MIGRATIONS=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
echo -e "${GREEN}✓${NC} Found $MIGRATIONS migration files"

# Check for critical migrations
if ls supabase/migrations/*automation_triggers*.sql 1>/dev/null 2>&1; then
    check "Automation triggers migration exists"
else
    warn "Automation triggers migration not found"
fi

if ls supabase/migrations/*payment_failure*.sql 1>/dev/null 2>&1; then
    check "Payment failure tracking migration exists"
else
    warn "Payment failure tracking migration not found"
fi

# -----------------------------------------
echo ""
echo "7. CHECKING DOCUMENTATION..."
# -----------------------------------------
if [ -f "docs/INTEGRATION-STATUS.md" ]; then
    check "INTEGRATION-STATUS.md exists"
else
    warn "INTEGRATION-STATUS.md not found"
fi

if [ -f "docs/WEBHOOKS-SETUP.md" ]; then
    check "WEBHOOKS-SETUP.md exists"
else
    warn "WEBHOOKS-SETUP.md not found"
fi

if [ -f "docs/SECURITY-SETUP.md" ]; then
    check "SECURITY-SETUP.md exists"
else
    warn "SECURITY-SETUP.md not found"
fi

# -----------------------------------------
echo ""
echo "========================================"
echo "  SUMMARY"
echo "========================================"
echo -e "${GREEN}Passed:${NC}   $PASSED"
echo -e "${RED}Failed:${NC}   $FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ READY FOR ALPHA TESTING${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run 'npm run dev' to start the app"
    echo "  2. Create a test business account"
    echo "  3. Run 'npm run test:alpha' for automated E2E tests"
    echo "  4. Use Stripe CLI for webhook testing:"
    echo "     stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook"
    exit 0
else
    echo -e "${RED}✗ NOT READY - Fix $FAILED issues first${NC}"
    exit 1
fi
