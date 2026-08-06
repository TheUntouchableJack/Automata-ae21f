// Supabase Edge Function: verify-domain
// Confirms domain ownership + provisioning state for a connected custom domain:
//   1. Verifies the caller owns the org (organization_members)
//   2. Confirms the TXT ownership record via DNS-over-HTTPS
//   3. Polls Netlify SSL state for the site
//   4. Advances domain_status: pending_dns -> verifying -> provisioning -> live
//      (sets domain_verified_at) or -> error (sets domain_error)
//
// Verified via verify_jwt=true in config.toml (Authorization JWT required).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NETLIFY_SITE_ID = Deno.env.get('NETLIFY_SITE_ID') ?? 'be00a05a-2ec6-4a7a-814c-6908cca86501'
const NETLIFY_API_TOKEN = Deno.env.get('NETLIFY_API_TOKEN') ?? ''

const allowedOrigins = ['https://royaltyapp.ai', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Look up TXT records via Google DNS-over-HTTPS (works inside the edge runtime).
async function txtRecords(name: string): Promise<string[]> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Answer || [])
      .filter((a: { type: number }) => a.type === 16)
      .map((a: { data: string }) => (a.data || '').replace(/^"|"$/g, '').replace(/""/g, ''));
  } catch {
    return [];
  }
}

async function netlifySslLive(): Promise<boolean> {
  if (!NETLIFY_API_TOKEN) return false;
  try {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}`, {
      headers: { Authorization: `Bearer ${NETLIFY_API_TOKEN}` },
    });
    if (!res.ok) return false;
    const site = await res.json();
    // ssl:true + a provisioned cert means aliases are served over HTTPS.
    return site.ssl === true && !!(site.ssl_url || site.published_deploy?.ssl_url);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization header' }, 401, corsHeaders);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: 'Invalid token' }, 401, corsHeaders);

    const { appId } = await req.json();
    if (!appId) return json({ error: 'appId is required' }, 400, corsHeaders);

    const { data: app, error: appError } = await supabase
      .from('customer_apps')
      .select('id, organization_id, custom_domain, domain_status, domain_verification_token')
      .eq('id', appId)
      .is('deleted_at', null)
      .single();
    if (appError || !app) return json({ error: 'App not found' }, 404, corsHeaders);

    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', app.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied' }, 403, corsHeaders);

    if (!app.custom_domain || !app.domain_verification_token) {
      return json({ error: 'No custom domain to verify.' }, 400, corsHeaders);
    }

    // 1. Ownership: TXT record present?
    const records = await txtRecords(`_royalty-verify.${app.custom_domain}`);
    const ownershipOk = records.includes(app.domain_verification_token);

    let status = app.domain_status as string;
    let domainError: string | null = null;
    let verifiedAt: string | null = null;

    if (!ownershipOk) {
      status = 'pending_dns';
      domainError = 'TXT verification record not found yet. DNS can take a few minutes to propagate.';
    } else {
      // 2. Ownership confirmed — check SSL provisioning.
      const sslLive = await netlifySslLive();
      if (sslLive) {
        status = 'live';
        verifiedAt = new Date().toISOString();
      } else {
        status = 'provisioning';
        domainError = null;
      }
    }

    const { error: updateError } = await supabase
      .from('customer_apps')
      .update({
        domain_status: status,
        domain_error: domainError,
        ...(verifiedAt ? { domain_verified_at: verifiedAt } : {}),
      })
      .eq('id', appId);
    if (updateError) return json({ error: 'Failed to update status.', detail: updateError.message }, 500, corsHeaders);

    return json({
      success: true,
      domain: app.custom_domain,
      status,
      ownership_verified: ownershipOk,
      message: domainError,
    }, 200, corsHeaders);

  } catch (error) {
    return json({ error: 'Unexpected error', detail: String(error) }, 500, getCorsHeaders(req));
  }
});
