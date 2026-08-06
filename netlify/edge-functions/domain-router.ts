// Custom-Domain / Subdomain -> Customer App router (Netlify Edge Function).
//
// When a bare custom domain (theirbusiness.com) or a *.royaltyapp.ai subdomain
// hits the site, there is no ?slug in the URL. This function maps the incoming
// Host -> app via the get_app_by_domain RPC and rewrites to the right
// customer-app page, reusing the exact server-side-rewrite pattern the app
// already uses for /a/{slug} — so none of the existing ?slug= code changes.
//
// First-party hosts (royaltyapp.ai, *.netlify.app, localhost), asset requests,
// and the owner dashboard (/app/*) early-return untouched so marketing + the
// dashboard stay fast.

import type { Context } from "https://edge.netlify.app/";

// Public anon key — identical to the value already shipped in the client bundle.
// Read from env when present, fall back to the known public constants.
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? "https://vhpmmfhfwnpmavytoomd.supabase.co";
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk";

// First-party hosts that must never be routed to a customer app.
const FIRST_PARTY_HOSTS = new Set([
  "royaltyapp.ai",
  "www.royaltyapp.ai",
  "localhost",
]);

// Static asset extensions — let Netlify serve these directly.
const ASSET_RE =
  /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|json|txt|xml|webmanifest|mp4|webm|pdf)$/i;

// host -> resolved app, cached in-memory (per edge instance) with a short TTL.
type Resolved = { slug: string; appType: string } | null;
const cache = new Map<string, { value: Resolved; expires: number }>();
const TTL_MS = 120_000; // 2 minutes

function isFirstParty(host: string): boolean {
  if (FIRST_PARTY_HOSTS.has(host)) return true;
  if (host.endsWith(".netlify.app")) return true;
  if (host.endsWith(".localhost") || host.startsWith("localhost:")) return true;
  return false;
}

async function resolveHost(host: string): Promise<Resolved> {
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.expires > now) return hit.value;

  let value: Resolved = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_app_by_domain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_host: host }),
    });
    if (res.ok) {
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.slug) {
        value = { slug: row.slug, appType: row.app_type || "loyalty" };
      }
    }
  } catch (_e) {
    value = null; // network/RPC failure -> treat as unresolved (falls through to 404)
  }

  cache.set(host, { value, expires: now + TTL_MS });
  return value;
}

// Map app_type + path suffix -> customer-app page + extra query (mirrors netlify.toml).
function targetFor(appType: string, pathname: string): { page: string; extra: string } {
  const p = pathname.replace(/\/+$/, ""); // trim trailing slash
  if (p.endsWith("/checkin")) return { page: "app.html", extra: "&action=checkin" };
  if (p.endsWith("/app")) return { page: "app.html", extra: "" };
  if (p.endsWith("/social")) return { page: "social.html", extra: "" };
  // Bare host: social apps land on the social feed, everything else on the signup landing.
  if (appType === "social") return { page: "social.html", extra: "" };
  return { page: "index.html", extra: "" };
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const host = (req.headers.get("host") || url.hostname).toLowerCase();
  const pathname = url.pathname;

  // 1. Early-return for first-party hosts, assets, and the owner dashboard.
  if (
    isFirstParty(host) ||
    ASSET_RE.test(pathname) ||
    pathname.startsWith("/app/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/customer-app/") ||
    pathname.startsWith("/.netlify/")
  ) {
    return context.next();
  }

  // 2. Resolve Host -> app.
  const resolved = await resolveHost(host);
  if (!resolved) {
    // Unknown custom host — serve the 404 page rather than leaking marketing.
    return new Response(null, {
      status: 302,
      headers: { Location: "/404.html" },
    });
  }

  // 3. Rewrite to the correct customer-app page, preserving the path suffix.
  const { page, extra } = targetFor(resolved.appType, pathname);
  const target = new URL(
    `/customer-app/${page}?slug=${encodeURIComponent(resolved.slug)}${extra}`,
    url.origin,
  );
  return context.rewrite(target);
}

export const config = { path: "/*" };
