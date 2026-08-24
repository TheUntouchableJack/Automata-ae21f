// ===== My App — scoped preview + branding =====
//
// The client-workspace counterpart to apps.html / app-builder.html, and
// deliberately NOT either of those:
//
//   apps.html        lists every app in the org. A client shares the owner's
//                    org, so that's the owner's whole portfolio.
//   app-builder.html is a 6-step wizard that can change app_type, features and
//                    settings — far past "a few branding fields".
//
// This page is scoped to the caller's own social app and PATCHes a whitelist:
// the app's `name` (a top-level column, not a branding key) plus the three
// branding keys it can actually edit — primary_color, secondary_color,
// logo_url. See BRANDING_KEYS below for why splash_video_url is excluded.
//
// Two things it deliberately does NOT expose:
//
//   logo_fit       read only by customer-app/index.html — the join page, not
//                  the social app. Inert here.
//   business_info  never renders ANYWHERE. app-builder.js:847 writes it to
//                  branding.business_info while customer-app/index.html:2283
//                  reads a top-level currentApp.business_info, and
//                  get_app_by_slug returns no such column. That's a real
//                  pre-existing bug; surfacing a field that silently does
//                  nothing is worse than omitting it.
//
// splash_video_url IS read by the social app (social.js:339-340) but nothing
// in the codebase writes it, and it has no UI anywhere. Worth adding later —
// out of scope for this pass.

let currentUser = null;
let currentOrganization = null;
let currentApp = null;

// The exact set applyBranding() (customer-app/social.js:292-344) consumes and
// this page writes. The full branding vocabulary is primary_color,
// secondary_color, logo_url and splash_video_url — the last is read by
// social.js:337-343 but has no writer anywhere in the repo and no UI, so it is
// not in the patch set.
//
// Anything not in here is not sent, so a stray DOM node can never widen the
// patch — the failure mode getAppData() has, where it rebuilds the whole row
// from the DOM across all six wizard steps.
const BRANDING_KEYS = ['primary_color', 'secondary_color', 'logo_url'];

const MAX_NAME_LENGTH = 60;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Same bucket the builder uses: app-logos, created in
// 20260224000002_app_logos_storage.sql — public, 2MB, path scoped
// {org_id}/{app_id}/.
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// The bucket's own mime list includes image/svg+xml, but it is a PUBLIC bucket
// with no sanitisation, so an uploaded SVG is a stored-XSS primitive served
// from our origin. Not offered here.
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

async function initMyApp() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    if (!currentOrganization?.id) {
        return showUnavailable(AppUtils.tr('myApp.noOrg', 'No organization is linked to this account yet.'));
    }

    const app = await resolveSocialApp();
    if (!app) {
        return showUnavailable(AppUtils.tr('myApp.noApp', "There's no app set up on this account yet."));
    }
    currentApp = app;

    renderApp();
    setupEventListeners();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('my-app-content').style.display = '';
}

// Scoped to the caller's own social app — the resolveSocialAppId() pattern
// already in venues.html.
async function resolveSocialApp() {
    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('id, name, slug, app_type, branding, is_published, is_active')
            .eq('organization_id', currentOrganization.id)
            .eq('app_type', 'social')
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (!error && data) return data;
        if (error) console.error('Failed to resolve social app:', error);
    } catch (e) {
        console.error('Failed to resolve social app:', e);
    }
    return null;
}

function showUnavailable(message) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('my-app-unavailable-message');
    if (el && message) {
        el.textContent = message;
        el.removeAttribute('data-i18n');
    }
    document.getElementById('my-app-unavailable').style.display = '';
}

// ===== Render =====

function renderApp() {
    const branding = currentApp.branding || {};

    document.getElementById('app-name-subtitle').textContent = currentApp.name || '';
    document.getElementById('field-name').value = currentApp.name || '';
    document.getElementById('field-primary').value = normalizeHex(branding.primary_color, '#7C3AED');
    document.getElementById('field-primary-text').value = document.getElementById('field-primary').value;
    document.getElementById('field-secondary').value = normalizeHex(branding.secondary_color, '#EC4899');
    document.getElementById('field-secondary-text').value = document.getElementById('field-secondary').value;

    renderLogoPreview(branding.logo_url);
    renderLinks();
    renderSplash();
}

// <input type="color"> silently coerces anything it doesn't understand to
// #000000, which would turn a bad stored value into a real black on first save.
function normalizeHex(value, fallback) {
    return (typeof value === 'string' && HEX_RE.test(value.trim())) ? value.trim().toLowerCase() : fallback;
}

function renderLogoPreview(url) {
    const preview = document.getElementById('logo-preview');
    if (url) {
        preview.innerHTML = `<img src="${AppUtils.escapeHtml(url)}" alt="">`;
    } else {
        preview.innerHTML = `<span class="logo-preview-empty" data-i18n="myApp.noLogo">${AppUtils.tr('myApp.noLogo', 'No logo yet')}</span>`;
    }
    document.getElementById('logo-remove-btn').style.display = url ? '' : 'none';
}

// There is no preview mode for social apps.
//
// ?preview=true is handled only by customer-app/index.html + app.js. social.js
// has none, and its load query (social.js:238-242) hard-requires
// is_active AND is_published. The loyalty preview path gets around RLS via
// preview_app_by_id() (SECURITY DEFINER, granted to anon, app_id as a de-facto
// token) — there is no social equivalent.
//
// That's workable here only because the app is already published: the live URL
// IS the preview. If it ever gets unpublished, both links break with no
// fallback — so show the publish state rather than a dead link.
function renderLinks() {
    const live = document.getElementById('link-live');
    const join = document.getElementById('link-join');
    const status = document.getElementById('publish-status');
    const linksBlock = document.getElementById('links-block');

    const published = isPublished();

    if (!published) {
        linksBlock.style.display = 'none';
        status.className = 'publish-pill publish-pill--draft';
        status.textContent = AppUtils.tr('myApp.notPublished', 'Not published yet');
        renderPreviewTargets(false);
        return;
    }

    status.className = 'publish-pill publish-pill--live';
    status.textContent = AppUtils.tr('myApp.published', 'Live');
    linksBlock.style.display = '';

    live.href = liveAppPath();
    live.textContent = `${window.location.origin}${liveAppPath()}`;
    join.href = joinPath();
    join.textContent = `${window.location.origin}${joinPath()}`;

    renderPreviewTargets(true);
}

function isPublished() {
    return currentApp.is_published === true && currentApp.is_active === true;
}

// /a/:slug is a 200 rewrite to the JOIN page (netlify.toml:346-365), which is
// why it reads "Join". The app itself is /a/:slug/social. Both get shown, each
// labelled for what it actually is.
//
// Every dashboard.js equivalent is loyalty-shaped and must not be copied: its
// launch button points at /a/{slug} (the join page) and its QR at
// /a/{slug}/checkin, a loyalty-only Netlify route with no social equivalent.
function joinPath() {
    return `/a/${currentApp.slug || ''}`;
}

function liveAppPath() {
    const suffix = currentApp.app_type === 'social' ? '/social' : '';
    return `${joinPath()}${suffix}`;
}

// ===== Preview panel =====
//
// A deliberately small, social-specific renderer rather than an extraction from
// dashboard.js: that version is loyalty-shaped throughout and its functions are
// file-scoped globals bound to currentApp / allApps / loadMemberGrowthChart /
// loadRecentActivity. Parameterising it would mean editing dashboard.js — the
// owner's main page — for a change that never touches it. Unifying the two is a
// reasonable later refactor.

// Mirrors what the visitor actually sees at /a/{slug}/social before signing in
// (customer-app/social.js:292-344 + social.css:2013-2090):
//
//   secondary_color  the splash backdrop, under the fixed dark scrim
//   primary_color    the logo tile and the primary button
//   logo_url         the tile's image, falling back to the name's first letter
//   name             the headline
//
// Reads the FORM, not currentApp, so unsaved edits show immediately.
function renderSplash() {
    const splash = document.getElementById('preview-splash');
    if (!splash) return;

    const name = document.getElementById('field-name').value.trim() || AppUtils.tr('myApp.previewUnnamed', 'Your app');
    const primary = normalizeHex(document.getElementById('field-primary').value, '#7c3aed');
    const secondary = normalizeHex(document.getElementById('field-secondary').value, '#1e293b');
    const logoUrl = currentApp.branding?.logo_url || null;

    splash.style.backgroundColor = secondary;
    splash.style.setProperty('--splash-primary', primary);

    const logo = document.getElementById('preview-splash-logo');
    logo.innerHTML = logoUrl
        ? `<img src="${AppUtils.escapeHtml(logoUrl)}" alt="">`
        : `<span>${AppUtils.escapeHtml(name.charAt(0).toUpperCase())}</span>`;

    document.getElementById('preview-splash-name').textContent = name;
    // social.html:297 — the visitor-facing tagline, not the loyalty dashboard's
    // hardcoded "Rewards Program".
    document.getElementById('preview-splash-subtitle').textContent =
        AppUtils.tr('social.splashTagline', 'See what tonight looks like.');
    document.getElementById('preview-splash-btn').textContent =
        AppUtils.tr('social.createAccount', 'Create Account');
}

// The QR, the URL line and the launch link only mean anything once the app is
// live. There is no social preview mode to fall back to — social.js's load
// query hard-requires is_active AND is_published — so when it isn't published
// the panel keeps the splash and drops the rest, and the draft pill says why.
function renderPreviewTargets(published) {
    const footer = document.getElementById('preview-footer');
    const qrSection = document.getElementById('preview-qr-section');

    if (!published) {
        footer.style.display = 'none';
        qrSection.style.display = 'none';
        return;
    }

    const url = `${window.location.origin}${liveAppPath()}`;
    const urlDisplay = document.getElementById('preview-url-display');
    urlDisplay.textContent = url;
    urlDisplay.title = url;

    const launch = document.getElementById('preview-launch-btn');
    launch.href = liveAppPath();

    footer.style.display = '';
    generateQR(url, qrSection);
}

// The panel shows the QR at 72px (dashboard.css:1845-1862) but the same canvas
// is what "Download QR" saves, so render well above display size and let CSS
// scale it down. 4 modules of quiet zone is the spec minimum — without it many
// scanners won't lock on.
const QR_RENDER_PX = 288;
const QR_QUIET_MODULES = 4;
const QR_DARK = '#1e293b';
const QR_LIGHT = '#ffffff';

// qrcode-generator is a third-party script. If it never loaded, `qrcode` is
// undefined — hide the block rather than throwing, and rather than falling back
// to a second external service the way dashboard.js does. A silently missing QR
// is recoverable; a broken page isn't.
function generateQR(url, qrSection) {
    const container = document.getElementById('preview-qr-code');
    if (typeof qrcode !== 'function') {
        console.warn('QR library unavailable; hiding the QR block.');
        qrSection.style.display = 'none';
        return;
    }

    try {
        // Type 0 auto-selects the smallest version that fits; 'M' is the
        // standard 15% error-correction level.
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();

        container.innerHTML = '';
        container.appendChild(drawQRCanvas(qr));
        qrSection.style.display = '';
    } catch (e) {
        console.error('QR generation failed:', e);
        qrSection.style.display = 'none';
    }
}

function drawQRCanvas(qr) {
    const count = qr.getModuleCount();
    const total = count + QR_QUIET_MODULES * 2;
    // Integer module size, so no module lands on a half pixel.
    const scale = Math.max(1, Math.ceil(QR_RENDER_PX / total));
    const size = scale * total;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = QR_LIGHT;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = QR_DARK;
    for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect((col + QR_QUIET_MODULES) * scale, (row + QR_QUIET_MODULES) * scale, scale, scale);
            }
        }
    }
    return canvas;
}

function downloadQR() {
    const canvas = document.querySelector('#preview-qr-code canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${currentApp.slug || 'app'}-qr-code.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

async function copyLiveUrl() {
    const url = `${window.location.origin}${liveAppPath()}`;
    try {
        await navigator.clipboard.writeText(url);
        showToast(AppUtils.tr('myApp.copied', 'Link copied'), 'success');
    } catch (e) {
        // Insecure context, or the permission was denied. Don't claim success.
        console.warn('Clipboard write failed:', e);
        showToast(AppUtils.tr('myApp.copyFailed', 'Could not copy the link. Select it and copy manually.'), 'error');
    }
}

// ===== Save =====

function readForm() {
    return {
        name: document.getElementById('field-name').value.trim(),
        primary_color: document.getElementById('field-primary').value.trim().toLowerCase(),
        secondary_color: document.getElementById('field-secondary').value.trim().toLowerCase()
    };
}

// There is no CHECK on the branding column, no length limit on name, and the
// builder's hex `pattern` attributes aren't inside a <form> so they never fire.
// Validate here rather than assuming.
function validate(form) {
    if (!form.name) return AppUtils.tr('myApp.errNameRequired', 'App name is required.');
    if (form.name.length > MAX_NAME_LENGTH) {
        return AppUtils.tr('myApp.errNameLong', 'App name must be {max} characters or fewer.', { max: MAX_NAME_LENGTH });
    }
    if (!HEX_RE.test(form.primary_color)) return AppUtils.tr('myApp.errHex', 'Colors must be a 6-digit hex value like #7C3AED.');
    if (!HEX_RE.test(form.secondary_color)) return AppUtils.tr('myApp.errHex', 'Colors must be a 6-digit hex value like #7C3AED.');
    return null;
}

// Merge onto the STORED branding blob, not a rebuilt one, and only for keys in
// BRANDING_KEYS. Everything else on the row — slug, app_type, organization_id,
// project_id, is_published, is_active and the whole domain set — is never sent.
function brandingPatch(overrides) {
    const merged = Object.assign({}, currentApp.branding || {});
    BRANDING_KEYS.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(overrides, k)) merged[k] = overrides[k];
    });
    return merged;
}

async function persist(patch) {
    const { data, error } = await supabase
        .from('customer_apps')
        .update(patch)
        .eq('id', currentApp.id)
        .eq('organization_id', currentOrganization.id)
        .select('id, name, slug, app_type, branding, is_published, is_active')
        .single();

    if (error) throw error;
    currentApp = data;
    return data;
}

async function saveMyApp() {
    const btn = document.getElementById('save-btn');
    const form = readForm();

    const invalid = validate(form);
    if (invalid) {
        showToast(invalid, 'error');
        return;
    }

    btn.disabled = true;
    try {
        await persist({
            name: form.name,
            branding: brandingPatch({
                primary_color: form.primary_color,
                secondary_color: form.secondary_color
            })
        });
        renderApp();
        showToast(AppUtils.tr('myApp.saved', 'Changes saved'), 'success');
    } catch (err) {
        console.error('Failed to save app:', err);
        showToast(AppUtils.tr('myApp.saveFailed', 'Could not save your changes. Please try again.'), 'error');
    } finally {
        btn.disabled = false;
    }
}

// ===== Logo =====
//
// Upload AND persist in one action. The builder's handleLogoUpload() stashes
// the URL in memory and relies on a later saveApp(), so a reload before saving
// orphans the uploaded object in the bucket forever.
async function handleLogoFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > LOGO_MAX_BYTES) {
        showToast(AppUtils.tr('myApp.errLogoSize', 'Logo must be less than 2MB.'), 'error');
        return;
    }
    if (!LOGO_MIME_TYPES.includes(file.type)) {
        showToast(AppUtils.tr('myApp.errLogoType', 'Logo must be a PNG, JPEG, GIF or WebP image.'), 'error');
        return;
    }

    const btn = document.getElementById('logo-upload-btn');
    btn.disabled = true;

    const previous = currentApp.branding?.logo_url || null;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filePath = `${currentOrganization.id}/${currentApp.id}/${Date.now()}-logo.${ext}`;

    try {
        const { error: uploadError } = await supabase.storage
            .from('app-logos')
            .upload(filePath, file);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('app-logos').getPublicUrl(filePath);

        await persist({ branding: brandingPatch({ logo_url: urlData.publicUrl }) });

        // Only now is the old object unreferenced. Best-effort: a failure here
        // leaves a stray file, which is strictly better than deleting the one
        // the row still points at.
        await removeStoredLogo(previous);

        renderApp();
        showToast(AppUtils.tr('myApp.logoSaved', 'Logo updated'), 'success');
    } catch (err) {
        console.error('Failed to upload logo:', err);
        showToast(AppUtils.tr('myApp.errLogoUpload', 'Could not upload that logo. Please try again.'), 'error');
    } finally {
        btn.disabled = false;
    }
}

async function removeLogo() {
    const previous = currentApp.branding?.logo_url || null;
    if (!previous) return;

    try {
        await persist({ branding: brandingPatch({ logo_url: null }) });
        await removeStoredLogo(previous);
        renderApp();
        showToast(AppUtils.tr('myApp.logoRemoved', 'Logo removed'), 'success');
    } catch (err) {
        console.error('Failed to remove logo:', err);
        showToast(AppUtils.tr('myApp.saveFailed', 'Could not save your changes. Please try again.'), 'error');
    }
}

async function removeStoredLogo(url) {
    if (!url) return;
    const parts = String(url).split('/app-logos/');
    if (parts.length < 2) return;
    try {
        await supabase.storage.from('app-logos').remove([parts[1]]);
    } catch (e) {
        // Stray object in a public bucket; not worth failing the save over.
        console.warn('Could not delete previous logo:', e);
    }
}

// ===== Events =====

function setupEventListeners() {
    document.getElementById('save-btn').addEventListener('click', saveMyApp);
    document.getElementById('logo-input').addEventListener('change', handleLogoFile);
    document.getElementById('logo-upload-btn').addEventListener('click', () => {
        document.getElementById('logo-input').click();
    });
    document.getElementById('logo-remove-btn').addEventListener('click', removeLogo);
    document.getElementById('preview-download-qr-btn').addEventListener('click', downloadQR);
    document.getElementById('preview-copy-url-btn').addEventListener('click', copyLiveUrl);

    // `input`, not `change`: the splash has to repaint as he drags the colour
    // picker and types the name, before anything is saved. Same binding
    // updateBrandPreview() uses in app-builder.js:679-701.
    document.getElementById('field-name').addEventListener('input', renderSplash);

    // Keep each colour's swatch and its hex text field in step. The text field
    // exists because <input type="color"> gives no way to read or paste a hex.
    [['primary', 'field-primary'], ['secondary', 'field-secondary']].forEach(([, id]) => {
        const swatch = document.getElementById(id);
        const text = document.getElementById(id + '-text');
        swatch.addEventListener('input', () => {
            text.value = swatch.value.toLowerCase();
            renderSplash();
        });
        text.addEventListener('change', () => {
            const v = text.value.trim();
            if (HEX_RE.test(v)) {
                swatch.value = v.toLowerCase();
                text.value = v.toLowerCase();
                renderSplash();
            } else {
                // Don't let a typo silently become #000000 on save.
                text.value = swatch.value.toLowerCase();
                showToast(AppUtils.tr('myApp.errHex', 'Colors must be a 6-digit hex value like #7C3AED.'), 'error');
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initMyApp);
