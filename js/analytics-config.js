// ===== PostHog key — THE ONLY FILE YOU NEED TO EDIT =====
//
// 1. Go to https://us.posthog.com  (US cloud — the proxy in netlify.toml and
//    privacy.html both assume US; an EU project would need both changed)
// 2. Settings → Project → Project API key
// 3. Paste it below, replacing phc_REPLACE_ME
//
// That's it. Nothing else to configure.
//
// This key is PUBLIC by design — it ships in client-side JavaScript on every
// page and is safe to commit. It only allows writing events, never reading
// them. Do NOT paste a Personal API key here (those start with phx_ and can
// read your whole project) — that one is a real secret.
//
// Until this is set, js/analytics.js no-ops cleanly: no requests, no errors,
// nothing breaks. So a half-finished setup is safe to deploy.

window.POSTHOG_TOKEN = 'phc_niz3zdVpynWBKzm4TpbHSUC5f9NVSpCz2iHzBTDWDaHy';
