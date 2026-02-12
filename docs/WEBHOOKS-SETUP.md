# External Service Setup Guide

This document covers webhook configuration and product setup for all external services that integrate with Royalty.

---

## 0. Stripe Products & Prices

**Status:** Subscription tiers configured, bundles need creation

### Creating Bundle Products in Stripe Dashboard

1. Go to https://dashboard.stripe.com/products
2. Click "Add product"

**SMS Bundle ($15 for 100 credits):**
- Name: "SMS Credits - 100 Pack"
- Description: "100 SMS message credits for your Royalty app"
- Pricing: One-time, $15.00
- Copy the Price ID (starts with `price_`)

**Email Bundle ($10 for 5,000 credits):**
- Name: "Email Credits - 5000 Pack"
- Description: "5,000 email credits for your Royalty app"
- Pricing: One-time, $10.00
- Copy the Price ID (starts with `price_`)

### Add Price IDs to Code

Update `supabase/functions/create-checkout-session/index.ts`:

```typescript
const PRICES: Record<string, string> = {
  // ... existing prices ...

  // Add these with your actual price IDs:
  sms_bundle_100: 'price_YOUR_SMS_PRICE_ID',
  email_bundle_5000: 'price_YOUR_EMAIL_PRICE_ID',
}
```

### Current Subscription Tiers

| Tier | Monthly | Annual | Price ID (Monthly) |
|------|---------|--------|-------------------|
| Pro | $299/mo | $239/mo | `price_1SyfQDGNy14i1og8tkBn6MF7` |
| Max | $599/mo | $479/mo | `price_1SyfQEGNy14i1og80NnddnzC` |
| Royalty Pro (add-on) | $49/mo | - | `price_1SyfQGGNy14i1og8jvmoWMxo` |

---

## Overview

| Service | Webhook Endpoint | Purpose |
|---------|------------------|---------|
| Stripe | `/functions/v1/stripe-webhook` | Payment events, subscription changes |
| Resend | `/functions/v1/resend-webhook` | Email delivery status (opened, clicked, bounced) |
| Twilio | `/functions/v1/twilio-webhook` | SMS delivery status |

---

## 1. Stripe Webhooks

**Status:** Configured

### Dashboard Setup

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter endpoint URL:
   ```
   https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
5. Copy the Signing secret (starts with `whsec_`)

### Add Secret to Supabase

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Upgrades org to new tier, adds bundle credits |
| `customer.subscription.updated` | Updates tier, tracks scheduled cancellations |
| `customer.subscription.deleted` | Downgrades org to free tier |
| `invoice.payment_failed` | Sets `past_due`, sends dunning email |
| `invoice.payment_succeeded` | Resets to `active` status |

---

## 2. Resend Webhooks

**Status:** Needs Dashboard Configuration

### Dashboard Setup

1. Go to https://resend.com/webhooks
2. Click "Add webhook"
3. Enter endpoint URL:
   ```
   https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/resend-webhook
   ```
4. Enable events:
   - `email.delivered`
   - `email.opened`
   - `email.clicked`
   - `email.bounced`
   - `email.complained`
5. Copy the Signing secret

### Add Secret to Supabase

```bash
supabase secrets set RESEND_WEBHOOK_SECRET=xxxxx
```

### Signature Verification

Resend uses Svix for webhook signing. The function verifies signatures using:

```typescript
// Verify using Svix library
const wh = new Webhook(RESEND_WEBHOOK_SECRET)
wh.verify(rawBody, {
  "svix-id": request.headers.get("svix-id"),
  "svix-timestamp": request.headers.get("svix-timestamp"),
  "svix-signature": request.headers.get("svix-signature")
})
```

### Events Handled

| Event | Action |
|-------|--------|
| `email.delivered` | Updates message_recipients, logs event |
| `email.opened` | Updates batch stats, logs event |
| `email.clicked` | Updates batch stats, logs click URL |
| `email.bounced` | Marks recipient failed, may pause automation |
| `email.complained` | Marks as spam, opts out member |

---

## 3. Twilio Webhooks

**Status:** Needs Dashboard Configuration

### Dashboard Setup

1. Go to https://console.twilio.com
2. Navigate to Phone Numbers → Manage → Active Numbers
3. Click your phone number
4. Under "Messaging Configuration":
   - Set "A MESSAGE COMES IN" webhook to:
     ```
     https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/twilio-webhook
     ```
   - Method: POST
5. Under "Status Callback URL":
   ```
   https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/twilio-webhook
   ```

### Secrets Already Configured

```bash
# These should already be set for SMS sending
supabase secrets list | grep TWILIO
```

If not:
```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxxx
supabase secrets set TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

### Signature Verification

Twilio uses HMAC-SHA1 signature verification:

```typescript
// Build validation URL
const url = `${SUPABASE_URL}/functions/v1/twilio-webhook`

// Verify signature
const signature = crypto.subtle.sign(
  "HMAC",
  key,
  encoder.encode(url + sortedParams)
)
```

### Events Handled

| Status | Action |
|--------|--------|
| `delivered` | Updates message_recipients, logs event |
| `sent` | Updates status |
| `failed` | Marks recipient failed, logs error code |
| `undelivered` | Marks as undeliverable |

---

## 4. Testing Webhooks Locally

### Using Stripe CLI

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
```

### Using ngrok for Resend/Twilio

```bash
# Install ngrok
brew install ngrok

# Forward to local Supabase
ngrok http 54321

# Use the ngrok URL in Resend/Twilio dashboard for testing
# e.g., https://abc123.ngrok.io/functions/v1/resend-webhook
```

---

## 5. Deploying Webhook Functions

```bash
cd Automata

# Deploy all webhook handlers
supabase functions deploy stripe-webhook
supabase functions deploy resend-webhook
supabase functions deploy twilio-webhook
```

---

## 6. Troubleshooting

### Webhook Not Receiving Events

1. Check function logs:
   ```bash
   supabase functions logs stripe-webhook --tail
   ```

2. Verify secrets are set:
   ```bash
   supabase secrets list
   ```

3. Test endpoint manually:
   ```bash
   curl -X POST https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/stripe-webhook \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

### Signature Verification Failing

- Ensure you're using the **raw request body** (not parsed JSON)
- Check timestamp isn't too old (webhooks expire after 5 minutes)
- Verify the secret matches the one in the external dashboard

### Duplicate Events

All webhook handlers check `processed_webhook_events` table:
```sql
SELECT * FROM processed_webhook_events
WHERE event_id = 'evt_xxxxx';
```

---

## 7. Security Considerations

1. **Always verify signatures** - Never trust webhook payloads without verification
2. **Use HTTPS only** - All Supabase Edge Functions are HTTPS by default
3. **Idempotency** - All handlers skip duplicate events
4. **Rate limiting** - Supabase handles this at the edge
5. **Fail gracefully** - Return 200 even on processing errors to prevent retries
