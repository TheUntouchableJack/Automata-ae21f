# Royalty Integration Status

Last verified: 2026-02-10

## External Services

### Stripe
| Component | Status | Notes |
|-----------|--------|-------|
| Webhook endpoint | ✅ Working | `/functions/v1/stripe-webhook` |
| Webhook secret | ✅ Set | `STRIPE_WEBHOOK_SECRET` in Supabase |
| Price IDs | ✅ Configured | Pro, Max, Royalty Pro tiers |
| Bundle prices | ✅ Configured | SMS ($15/100), Email ($10/5000) |

### Resend (Email)
| Component | Status | Notes |
|-----------|--------|-------|
| API key | ✅ Set | `RESEND_API_KEY` in Supabase |
| Webhook endpoint | ✅ Working | `/functions/v1/resend-webhook` |
| Webhook secret | ✅ Set | `RESEND_WEBHOOK_SECRET` in Supabase |
| Dashboard config | ✅ Done | Listening for 11 event types |
| Last successful event | 2026-02-09 | `email.delivered`, `email.sent` |

### Twilio (SMS)
| Component | Status | Notes |
|-----------|--------|-------|
| Account SID | ✅ Set | `TWILIO_ACCOUNT_SID` in Supabase |
| Auth token | ✅ Set | `TWILIO_AUTH_TOKEN` in Supabase |
| Phone number | ✅ Set | `TWILIO_PHONE_NUMBER` in Supabase |
| Voice webhook | ✅ Configured | `/functions/v1/twilio-webhook` |
| Messaging webhook | ✅ Configured | `/functions/v1/twilio-webhook` |

### Supabase
| Component | Status | Notes |
|-----------|--------|-------|
| Database | ✅ Working | All migrations applied |
| Edge Functions | ✅ Deployed | 15 functions active |
| Auth | ✅ Working | Email/password + magic link |
| Cron jobs | ✅ Running | autonomous runner, cleanup jobs |

## Edge Functions Deployed

| Function | Purpose | Last Deploy |
|----------|---------|-------------|
| automation-engine | Event triggers, scheduled automations | 2026-02-10 |
| royal-ai-prompt | AI assistant for business owners | 2026-02-10 |
| royal-ai-autonomous | Background action processor | 2026-02-08 |
| message-sender | Email/SMS/push delivery | 2026-02-08 |
| stripe-webhook | Payment events, dunning | 2026-02-10 |
| resend-webhook | Email delivery tracking | 2026-02-10 |
| twilio-webhook | SMS delivery tracking | 2026-02-10 |
| create-checkout-session | Stripe checkout | 2026-02-06 |
| create-portal-session | Stripe billing portal | 2026-02-06 |

## Database Triggers

| Trigger | Table | Fires |
|---------|-------|-------|
| automation_member_joined | app_members | INSERT |
| automation_visit | member_visits | INSERT |
| automation_points_redeemed | points_transactions | INSERT (redemption) |
| automation_tier_upgrade | app_members | UPDATE (tier change) |

## Cron Jobs (pg_cron)

| Job | Schedule | Purpose |
|-----|----------|---------|
| process-ai-action-queue | */5 * * * * | Autonomous action runner |
| process-scheduled-automations | 0 9 * * * | Birthday/anniversary automations |
| cleanup-ai-audit-logs | 0 3 * * * | Remove logs >90 days |
| expire-pending-actions | 0 * * * * | Expire unapproved actions |

## Known Issues

None currently.

## Verification Commands

```bash
# Check secrets are set
supabase secrets list | grep -E "STRIPE|RESEND|TWILIO"

# Check function logs
supabase functions logs stripe-webhook --tail
supabase functions logs resend-webhook --tail

# Check cron jobs (run in Supabase SQL editor)
SELECT * FROM cron_job_status;
```
