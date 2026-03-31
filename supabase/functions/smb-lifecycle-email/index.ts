// Supabase Edge Function: smb-lifecycle-email
// Sends branded lifecycle emails to SMB owners (welcome, onboarding, milestones, win-back).
// Called from:
//   - handle_new_user() trigger via pg_net (welcome email on signup)
//   - royalty-self-growth nightly loop (onboarding drip, milestones, win-back)
//
// Service-role only — no browser calls.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FROM_EMAIL = 'Royal <royal@royaltyapp.ai>'

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

interface TemplateData {
  firstName?: string
  orgName?: string
  [key: string]: unknown
}

function getEmailTemplate(type: string, data: TemplateData): { subject: string; html: string; preheader: string } {
  const name = data.firstName || 'there'

  switch (type) {
    case 'welcome':
      return {
        subject: `Welcome to Royalty, ${name}!`,
        preheader: 'Your AI-powered loyalty program is ready to launch',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Welcome to Royalty, ${name}!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            You just joined the only loyalty platform where AI runs the program for you.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Here's what happens next: describe your business, and Royal (your AI assistant) will build your loyalty program in 60 seconds. Your customers earn points, unlock rewards, and keep coming back.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/dashboard.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);
                      letter-spacing:0.2px;">
              Go to Your Dashboard
            </a>
          </div>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            Questions? Just chat with Royal in your dashboard — it knows your business.
          </p>
        `
      }

    case 'onboarding_create_app':
      return {
        subject: `${name}, your loyalty app is one click away`,
        preheader: 'Create your branded loyalty program in 60 seconds',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Ready to launch your loyalty program?</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — most owners create their loyalty app within the first day. Here's how simple it is:
          </p>
          <ol style="font-size:15px;color:#52525b;line-height:1.8;margin:0 0 24px;padding-left:20px;">
            <li>Open the App Builder</li>
            <li>Describe your business in a sentence</li>
            <li>Royal creates your branded loyalty program — rewards, tiers, and all</li>
          </ol>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            It takes about 60 seconds. Your customers get a QR code to start earning points immediately.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/apps.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Create Your Loyalty App
            </a>
          </div>
        `
      }

    case 'onboarding_meet_royal':
      return {
        subject: `Meet Royal — your AI loyalty assistant`,
        preheader: 'Royal can run your loyalty program while you run your business',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">You have an AI assistant. Have you met?</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — Royal is your AI loyalty assistant. It lives in the Intelligence tab of your dashboard and can:
          </p>
          <ul style="font-size:15px;color:#52525b;line-height:1.8;margin:0 0 24px;padding-left:20px;">
            <li>Suggest the best automations for your business</li>
            <li>Draft customer messages and campaigns</li>
            <li>Spot at-risk customers before they churn</li>
            <li>Answer any question about your loyalty program</li>
          </ul>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Try asking: <em>"What automations should I turn on first?"</em>
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/intelligence.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Chat with Royal
            </a>
          </div>
        `
      }

    case 'onboarding_add_customers':
      return {
        subject: `Time to get your first customers earning points`,
        preheader: 'Share your QR code or link — customers sign up in seconds',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Your loyalty program needs customers!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — your loyalty app is ready, now let's get people in. Here are 3 ways:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0 24px;">
            <tr>
              <td style="padding:12px 16px;background:#f8f5ff;border-radius:8px;margin-bottom:8px;">
                <strong style="color:#7c3aed;">1. QR Code at checkout</strong><br>
                <span style="font-size:14px;color:#52525b;">Print it, stick it by the register. Customers scan to join.</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#f8f5ff;border-radius:8px;">
                <strong style="color:#7c3aed;">2. Share your link</strong><br>
                <span style="font-size:14px;color:#52525b;">Text or email your signup link to existing customers.</span>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px 16px;background:#f8f5ff;border-radius:8px;">
                <strong style="color:#7c3aed;">3. Import a list</strong><br>
                <span style="font-size:14px;color:#52525b;">Have a customer list? Import them from the Customers page.</span>
              </td>
            </tr>
          </table>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/customers.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Add Your First Customers
            </a>
          </div>
        `
      }

    case 'onboarding_checkin':
      return {
        subject: `How's your loyalty program going, ${name}?`,
        preheader: 'Quick check-in from Royal — anything we can help with?',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;letter-spacing:-0.3px;">Two weeks in — how's it going?</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — it's been about two weeks since you joined Royalty. Just checking in.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Whether you're fully set up or still exploring, Royal is here to help. You can ask it anything — from "how do I set up birthday rewards?" to "what's working for businesses like mine?"
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            If something's not working or you need a hand, just reply to this email. A real human (Jay, our founder) reads every reply.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/intelligence.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Open Your Dashboard
            </a>
          </div>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            P.S. — If you have ideas for how Royalty could work better for your business, we'd love to hear them on our <a href="https://royaltyapp.ai/app/roadmap.html" style="color:#7c3aed;text-decoration:none;">roadmap page</a>.
          </p>
        `
      }

    case 'milestone_first_customer':
      return {
        subject: `${name}, your first customer just joined!`,
        preheader: 'Your loyalty program is officially live',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">Your first customer is here!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Hey ${name} — someone just signed up for your loyalty program. That's a real person choosing to come back to your business. This is how it starts.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Now share your QR code with more customers. Every scan is another regular in the making.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/dashboard.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              View Your Dashboard
            </a>
          </div>
        `
      }

    case 'milestone_10_customers':
      return {
        subject: `10 customers and counting!`,
        preheader: 'Your loyalty program is gaining traction',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">10 customers in your program!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Hey ${name} — you've hit double digits. 10 customers are now earning points and building a habit of coming back to your business.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Pro tip: Turn on some automations to keep them engaged automatically. Royal can suggest the best ones for your business.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/automations.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Set Up Automations
            </a>
          </div>
        `
      }

    case 'milestone_50_customers':
      return {
        subject: `50 customers — you're building something real`,
        preheader: 'Your community is growing fast',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">50 customers strong!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Hey ${name} — 50 people have chosen to be part of your loyalty program. That's not a list, that's a community.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            At this size, your automations really start to shine. Birthday rewards, win-back campaigns, and streak bonuses are driving repeat visits without you lifting a finger.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/intelligence.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              See Your Intelligence Feed
            </a>
          </div>
        `
      }

    case 'milestone_first_redemption':
      return {
        subject: `Your first reward was just redeemed!`,
        preheader: 'A customer cashed in their points — the loop is working',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">Someone just redeemed a reward!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Hey ${name} — a customer earned enough points and redeemed a reward at your business. That's the loyalty loop working: visit → earn → redeem → visit again.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Check your dashboard to see which rewards are most popular and adjust your catalog.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/dashboard.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              View Redemption Details
            </a>
          </div>
        `
      }

    case 'upgrade_nudge_members':
      return {
        subject: `You're growing fast — time to level up?`,
        preheader: `You've used ${data.usagePercent || 80}% of your member limit`,
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">Your program is growing!</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — you've used <strong>${data.usagePercent || 80}%</strong> of your member limit on your current plan. That's a good problem to have.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Upgrading unlocks more members, more email sends, and advanced features like autonomous AI mode and visit attribution.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/organization.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              View Upgrade Options
            </a>
          </div>
        `
      }

    case 'upgrade_nudge_emails':
      return {
        subject: `Running low on email sends this month`,
        preheader: `You've used ${data.usagePercent || 80}% of your monthly email limit`,
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">Email limit heads-up</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — you've used <strong>${data.usagePercent || 80}%</strong> of your monthly email sends. Your automations and campaigns are doing their job!
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            To keep your emails flowing, consider upgrading your plan or adding an email bundle.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/organization.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              View Plans & Bundles
            </a>
          </div>
        `
      }

    case 'winback_sorry':
      return {
        subject: `We're sorry to see you go, ${name}`,
        preheader: 'Your loyalty program is still here if you change your mind',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">We're sorry to see you go</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — we noticed your subscription has ended. We understand — sometimes the timing isn't right.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Here's what you'll lose access to:
          </p>
          <ul style="font-size:15px;color:#52525b;line-height:1.8;margin:0 0 24px;padding-left:20px;">
            <li>Automated email & SMS campaigns to your customers</li>
            <li>Royal AI managing your loyalty program</li>
            <li>Performance analytics and visit tracking</li>
            <li>Birthday, win-back, and streak automations</li>
          </ul>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Your loyalty program data is safe — we'll keep it for 90 days in case you want to come back.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/organization.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Reactivate Your Plan
            </a>
          </div>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            If there's something we could have done better, reply to this email. Jay (our founder) reads every response.
          </p>
        `
      }

    case 'winback_miss_you':
      return {
        subject: `Your customers are still out there, ${name}`,
        preheader: 'Your loyalty program members are waiting',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">Your customers are still out there</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Hey ${name} — it's been about a week since your plan ended. Your loyalty program members are still in the system, but without active automations, they're not getting the nudges that keep them coming back.
          </p>
          ${data.memberCount ? `
          <div style="background:#f8f5ff;border-radius:12px;padding:20px 24px;margin:0 0 24px;text-align:center;">
            <div style="font-size:32px;font-weight:700;color:#7c3aed;">${data.memberCount}</div>
            <div style="font-size:14px;color:#52525b;">customers in your program</div>
          </div>` : ''}
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            Every day without automations is a missed opportunity to bring a regular back. Reactivate and pick up right where you left off — your data, rewards, and customer relationships are all intact.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/organization.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Reactivate Your Plan
            </a>
          </div>
        `
      }

    case 'winback_offer':
      return {
        subject: `Come back to Royalty — we'd love to have you`,
        preheader: 'Your loyalty program is ready to restart',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">One more thing, ${name}</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            It's been about a month since you left. We've been improving Royalty every day — new features, better AI, faster automation.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            If you're open to giving it another try, your program is still here. All your customers, rewards, and settings are exactly as you left them. One click and you're back.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://royaltyapp.ai/app/organization.html"
               style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 36px;
                      border-radius:10px;font-size:15px;font-weight:600;
                      text-decoration:none;box-shadow:0 2px 8px rgba(124,58,237,0.3);">
              Restart Your Program
            </a>
          </div>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            This is the last email we'll send about this. No hard feelings either way — we're rooting for your business.
          </p>
        `
      }

    case 'testimonial_request':
      return {
        subject: `${name}, would you share your Royalty story?`,
        preheader: 'Your success could inspire other local businesses',
        html: `
          <h1 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 12px;">You've built something impressive</h1>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Hey ${name} — your loyalty program has crossed <strong>${data.memberCount || '100'}+ customers</strong>. That puts you in the top tier of businesses on Royalty.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            We'd love to feature your story. A quick quote about how Royalty has helped your business would mean a lot — and it helps other local businesses discover what's possible.
          </p>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 8px;">
            Just reply to this email with:
          </p>
          <ul style="font-size:15px;color:#52525b;line-height:1.8;margin:0 0 24px;padding-left:20px;">
            <li>A sentence or two about your experience with Royalty</li>
            <li>Your name and business name (for attribution)</li>
          </ul>
          <p style="font-size:15px;color:#52525b;line-height:1.6;margin:0 0 24px;">
            That's it — no forms, no calls. Just hit reply.
          </p>
          <p style="font-size:13px;color:#a1a1aa;line-height:1.5;margin:0;">
            No pressure at all. We appreciate you either way.
          </p>
        `
      }

    default:
      return {
        subject: 'A message from Royalty',
        preheader: '',
        html: `<p>Hello ${name},</p><p>You have a new message from Royalty.</p>`
      }
  }
}

// ============================================================================
// SEND EMAIL
// ============================================================================

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    console.log('[stub] Would send lifecycle email to', to, '—', subject)
    return { success: true, messageId: 'stub-' + Date.now() }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    })

    const data = await response.json()
    if (!response.ok) {
      return { success: false, error: `Resend ${response.status}: ${data.message || JSON.stringify(data)}` }
    }
    return { success: true, messageId: data.id }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const { type, email, first_name, org_name, user_id } = body as {
      type: string
      email: string
      first_name?: string
      org_name?: string
      user_id?: string
    }

    if (!type || !email) {
      return new Response(JSON.stringify({ error: 'type and email are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check unsubscribe preferences
    if (user_id) {
      const { data: prefs } = await supabase
        .from('smb_email_preferences')
        .select('unsubscribed_all, unsubscribed_categories')
        .eq('user_id', user_id)
        .single()

      if (prefs?.unsubscribed_all) {
        console.log(`Skipping ${type} email for ${email} — unsubscribed`)
        return new Response(JSON.stringify({ success: true, skipped: true, reason: 'unsubscribed' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Check category-level unsubscribe
      const category = type === 'welcome' ? 'onboarding' : type
      if (prefs?.unsubscribed_categories?.includes(category)) {
        console.log(`Skipping ${type} email for ${email} — unsubscribed from ${category}`)
        return new Response(JSON.stringify({ success: true, skipped: true, reason: `unsubscribed:${category}` }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Generate template
    const template = getEmailTemplate(type, { firstName: first_name, orgName: org_name })

    // Build unsubscribe URL
    const unsubscribeUrl = user_id
      ? `https://royaltyapp.ai/app/settings.html?unsubscribe=${user_id}`
      : undefined

    // Wrap in branded template
    const html = wrapEmail(template.html, {
      preheader: template.preheader,
      unsubscribeUrl,
    })

    // Send
    const result = await sendEmail(email, template.subject, html)

    // Log to self_growth_log
    await supabase.from('self_growth_log').insert({
      action_type: 'lifecycle_email_sent',
      description: `Sent ${type} email to ${email}`,
      status: result.success ? 'completed' : 'failed',
      metadata: {
        type,
        email,
        user_id,
        resend_id: result.messageId,
        error: result.error,
      }
    })

    if (!result.success) {
      console.error(`Failed to send ${type} email to ${email}:`, result.error)
    }

    return new Response(JSON.stringify({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('smb-lifecycle-email error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
