// Supabase Edge Function: connect-domain
// Attaches a client's custom domain to their customer app:
//   1. Verifies the caller owns the org (organization_members)
//   2. Re-checks white-label server-side (never trusts the client)
//   3. Adds the domain as a Netlify domain alias + requests SSL
//   4. Sets domain_status='pending_dns' + a TXT verification token
//   5. Returns the DNS records (CNAME + TXT) for the client to add
//
// Verified via verify_jwt=true in config.toml (Authorization JWT required).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Netlify site the customer apps are served from.
const NETLIFY_SITE_ID = Deno.env.get('NETLIFY_SITE_ID') ?? 'be00a05a-2ec6-4a7a-814c-6908cca86501'
const NETLIFY_API_TOKEN = Deno.env.get('NETLIFY_API_TOKEN') ?? ''
// CNAME target clients point their domain at (Netlify serves the alias here).
const CNAME_TARGET = Deno.env.get('NETLIFY_CNAME_TARGET') ?? 'automata-jay.netlify.app'

const allowedOrigins = ['https://royaltyapp.ai', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function normalizeDomain(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

// theirbusiness.com -> valid registrable host (label.label, no scheme/path)
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
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

    const { appId, domain } = await req.json();
    if (!appId || !domain) return json({ error: 'appId and domain are required' }, 400, corsHeaders);

    const customDomain = normalizeDomain(domain);
    if (!DOMAIN_RE.test(customDomain)) {
      return json({ error: 'Enter a valid domain like theirbusiness.com (no https:// or path).' }, 400, corsHeaders);
    }
    if (customDomain.endsWith('.royaltyapp.ai') || customDomain === 'royaltyapp.ai') {
      return json({ error: 'That domain is reserved.' }, 400, corsHeaders);
    }

    // Load app + verify caller is a member of the owning org.
    const { data: app, error: appError } = await supabase
      .from('customer_apps')
      .select('id, organization_id, custom_domain')
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

    // Server-side white-label re-check (don't trust the client's disabled state).
    const { data: isWhiteLabel } = await supabase.rpc('org_has_white_label', { p_org_id: app.organization_id });
    if (isWhiteLabel !== true) {
      return json({ error: 'Custom domains require a white-label plan (Scale or Royalty Pro).' }, 403, corsHeaders);
    }

    // Domain uniqueness across apps (partial unique index also enforces this).
    const { data: clash } = await supabase
      .from('customer_apps')
      .select('id')
      .eq('custom_domain', customDomain)
      .neq('id', appId)
      .maybeSingle();
    if (clash) return json({ error: 'That domain is already connected to another app.' }, 409, corsHeaders);

    // Attach the domain as a Netlify alias + request SSL.
    if (!NETLIFY_API_TOKEN) {
      return json({ error: 'Domain provisioning is not configured (missing NETLIFY_API_TOKEN).' }, 500, corsHeaders);
    }
    const netlifyHeaders = {
      Authorization: `Bearer ${NETLIFY_API_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // Fetch current aliases, append ours (idempotent), PATCH the site.
    const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}`, { headers: netlifyHeaders });
    if (!siteRes.ok) {
      return json({ error: `Netlify site lookup failed (${siteRes.status}).` }, 502, corsHeaders);
    }
    const site = await siteRes.json();
    const aliases: string[] = Array.isArray(site.domain_aliases) ? site.domain_aliases : [];
    if (!aliases.includes(customDomain)) {
      const patchRes = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}`, {
        method: 'PATCH',
        headers: netlifyHeaders,
        body: JSON.stringify({ domain_aliases: [...aliases, customDomain] }),
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        return json({ error: `Netlify could not add the domain (${patchRes.status}).`, detail }, 502, corsHeaders);
      }
    }
    // Kick off SSL provisioning (best-effort; verify-domain polls the state).
    await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}/ssl`, {
      method: 'POST',
      headers: netlifyHeaders,
    }).catch(() => {});

    const verificationToken = crypto.randomUUID().replace(/-/g, '');

    const { error: updateError } = await supabase
      .from('customer_apps')
      .update({
        custom_domain: customDomain,
        domain_status: 'pending_dns',
        domain_verification_token: verificationToken,
        domain_verified_at: null,
        domain_error: null,
      })
      .eq('id', appId);
    if (updateError) {
      if ((updateError as { code?: string }).code === '23505') {
        return json({ error: 'That domain is already connected to another app.' }, 409, corsHeaders);
      }
      return json({ error: 'Failed to save domain.', detail: updateError.message }, 500, corsHeaders);
    }

    // DNS records the client must add at their registrar.
    return json({
      success: true,
      domain: customDomain,
      status: 'pending_dns',
      dns_records: [
        { type: 'CNAME', host: customDomain, value: CNAME_TARGET, note: 'Points your domain at your app.' },
        { type: 'TXT', host: `_royalty-verify.${customDomain}`, value: verificationToken, note: 'Proves you own the domain.' },
      ],
    }, 200, corsHeaders);

  } catch (error) {
    return json({ error: 'Unexpected error', detail: String(error) }, 500, getCorsHeaders(req));
  }
});
