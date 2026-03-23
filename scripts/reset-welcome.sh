#!/bin/bash
# Reset welcome_progress for test account so the banner shows again.
# Usage: npm run reset-welcome  (or bash scripts/reset-welcome.sh)

cd "$(dirname "$0")/.."

TOKEN=$(supabase projects api-keys --project-ref vhpmmfhfwnpmavytoomd 2>/dev/null | grep service_role | awk '{print $NF}')

if [ -z "$TOKEN" ]; then
    echo "Error: Could not get service role key. Are you logged in to Supabase CLI?"
    exit 1
fi

curl -s -X PATCH \
    "https://vhpmmfhfwnpmavytoomd.supabase.co/rest/v1/profiles?email=eq.jay@24hour.design" \
    -H "apikey: $TOKEN" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d '{"welcome_progress": null}' \
    -w "\n"

echo "welcome_progress reset for jay@24hour.design"
