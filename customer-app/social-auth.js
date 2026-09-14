/**
 * Social App — member accounts
 *
 * Supabase Auth (email + password) for customers of a white-label social app.
 * Deliberately separate from Royalty's PIN-based loyalty login: the social
 * features need a real auth.uid() so RLS can tell members apart when they post,
 * follow and delete content.
 *
 * IMPORTANT: signUp MUST pass user_type: 'app_member' in options.data.
 * handle_new_user() branches on it (migration 20260821000004). Without it, the
 * trigger treats the new user as a Royalty business owner — creating an
 * organization, making them its owner, enrolling them in SMB onboarding email,
 * and notifying the admin of a new signup.
 *
 * Exposes window.SocialAuth. Loaded before social.js.
 */
(function (global) {
    'use strict';

    /**
     * Snapshot of the URL as the page was OPENED — taken before any Supabase
     * client exists anywhere on the page.
     *
     * social-auth.js is loaded at social.html:1358 and social.js at :1361.
     * Classic scripts run in document order, so this IIFE has already finished
     * by the time createClient() is called. That is an HTML-spec guarantee,
     * which is the point: it does not depend on any reasoning about library
     * internals against a CDN build.
     *
     * Why snapshot at all: GoTrue delivers the recovery payload in the URL, and
     * supabase-js's detectSessionInUrl CONSUMES and then STRIPS it after an
     * awaited network round trip. Anything that reads window.location later is
     * racing that strip, and the race is decided by network latency — which is
     * why some testers got the New Password form and some silently landed on
     * the feed. social.js turns detectSessionInUrl off and reads from here.
     */
    const RECOVERY = (function snapshotLanding() {
        const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const q = new URLSearchParams(window.location.search);
        // Query first: the ?token_hash= form arrives there, the implicit tokens
        // arrive in the fragment, and nothing emits both.
        const pick = (k) => q.get(k) ?? h.get(k);
        return {
            accessToken: pick('access_token'),
            refreshToken: pick('refresh_token'),
            type: pick('type'),
            code: pick('code'),
            tokenHash: pick('token_hash'),
            error: pick('error'),
            errorCode: pick('error_code'),
            errorDesc: pick('error_description')
        };
    })();

    let client = null;
    let currentAppId = null;
    let currentMember = null;

    // ===== Validation =====

    // Deliberately permissive: this catches typos and obvious mistakes, and the
    // server remains the authority. Over-strict client regexes reject valid
    // addresses (plus-addressing, new TLDs, long subdomains).
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const PASSWORD_MIN = 8;

    function validateEmail(email) {
        if (!email) return 'Enter your email address';
        if (!EMAIL_RE.test(email.trim())) return 'That email address does not look right';
        return null;
    }

    /**
     * Complexity rules. Returns an error string, or null when acceptable.
     * Supabase enforces a minimum length server-side too, but the point of
     * checking here is to tell the user WHICH rule they missed.
     */
    function validatePassword(password) {
        if (!password) return 'Choose a password';
        if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
        if (!/[a-z]/.test(password)) return 'Include a lowercase letter';
        if (!/[A-Z]/.test(password)) return 'Include an uppercase letter';
        if (!/[0-9]/.test(password)) return 'Include a number';
        return null;
    }

    function validatePasswordMatch(password, confirmation) {
        if (!confirmation) return 'Re-enter your password';
        if (password !== confirmation) return 'Passwords do not match';
        return null;
    }

    /** 0–4, drives the strength meter. */
    function passwordStrength(password) {
        if (!password) return 0;
        let score = 0;
        if (password.length >= PASSWORD_MIN) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password) && password.length >= 12) score++;
        return score;
    }

    // ===== Phone =====

    // The North American Numbering Plan is the only dial code with a fixed
    // 10-digit national number, and the only one the (310) 555-0101 mask makes
    // sense for. Everywhere else, national number length varies (4 in Niue, 14
    // in parts of Austria), so the rule is a range, not an exact count.
    const NANP_DIAL = '1';
    const INTL_MIN_DIGITS = 4;
    const INTL_MAX_DIGITS = 14;

    /** Progressive US formatting: 3105550101 -> (310) 555-0101. +1 only. */
    function formatPhone(value) {
        const digits = (value || '').replace(/\D/g, '').slice(0, 10);
        if (digits.length === 0) return '';
        if (digits.length <= 3) return `(${digits}`;
        if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    /**
     * @param value  what the user typed, in any formatting
     * @param required   phone became required at signup (Aug 2026)
     * @param dial       calling code without '+', e.g. '1', '44', '212'.
     *                   Defaults to '1' so existing callers keep US rules.
     */
    function validatePhone(value, { required = false, dial = NANP_DIAL } = {}) {
        const digits = (value || '').replace(/\D/g, '');
        if (!digits) return required ? 'Enter your phone number' : null;

        if (String(dial) === NANP_DIAL) {
            if (digits.length !== 10) return 'Enter a 10-digit phone number';
            return null;
        }

        if (digits.length < INTL_MIN_DIGITS || digits.length > INTL_MAX_DIGITS) {
            return `Enter a phone number between ${INTL_MIN_DIGITS} and ${INTL_MAX_DIGITS} digits`;
        }
        return null;
    }

    /**
     * '+{dial}{digits}'. app_members.phone / customers.phone are plain TEXT, so
     * nothing forces a format — which is exactly why one has to be chosen and
     * stuck to. E.164 is the only representation that stays unambiguous once
     * members exist outside +1, and it is what Twilio expects when Royal AI
     * starts texting them.
     */
    function toE164(value, dial) {
        const digits = (value || '').replace(/\D/g, '');
        if (!digits) return null;
        const code = String(dial || NANP_DIAL).replace(/\D/g, '') || NANP_DIAL;
        return `+${code}${digits}`;
    }

    // ===== Error mapping =====

    // Supabase returns terse, sometimes generic messages. These are the cases
    // the SOW calls out by name, so they get purpose-written copy.
    function friendlyAuthError(error, context) {
        const raw = (error?.message || '').toLowerCase();

        if (raw.includes('already registered') ||
            raw.includes('already been registered') ||
            raw.includes('user already exists')) {
            return 'That email is already registered. Try logging in instead.';
        }
        if (raw.includes('invalid login credentials')) {
            // Supabase intentionally does not say which field was wrong, to
            // avoid confirming whether an account exists. Mirror that.
            return 'Email or password is incorrect.';
        }
        if (raw.includes('email not confirmed')) {
            return 'Confirm your email address first — check your inbox.';
        }
        if (raw.includes('invalid email') || raw.includes('unable to validate email')) {
            return 'That email address does not look right.';
        }
        if (raw.includes('password should be')) {
            return `Use at least ${PASSWORD_MIN} characters.`;
        }
        // Recovery-link failures. Left unmapped, GoTrue's own wording reaches
        // the user verbatim via the fallback at the bottom of this function —
        // a tester was shown the raw string "Auth session missing!" after
        // typing a new password behind a spent link.
        if (raw.includes('auth session missing') ||
            raw.includes('session_not_found') ||
            raw.includes('session from session_id claim in jwt does not exist')) {
            return 'That reset link is no longer valid. Request a new one and try again.';
        }
        if (raw.includes('token has expired or is invalid') ||
            raw.includes('otp_expired') ||
            raw.includes('email link is invalid')) {
            return 'That link has expired or has already been used. Request a new one.';
        }
        if (raw.includes('new password should be different') || raw.includes('same_password')) {
            return 'Choose a password different from your current one.';
        }
        if (raw.includes('reauthentication')) {
            return 'For security, log in again before changing your password.';
        }
        if (raw.includes('rate limit') || raw.includes('too many')) {
            return 'Too many attempts. Wait a minute and try again.';
        }
        if (raw.includes('failed to fetch') || raw.includes('network')) {
            return 'Connection problem. Check your signal and try again.';
        }

        return error?.message || `Could not ${context || 'complete that'}. Try again.`;
    }

    // ===== Session =====

    async function getSession() {
        if (!client) return null;
        const { data } = await client.auth.getSession();
        return data?.session || null;
    }

    async function isSignedIn() {
        return !!(await getSession());
    }

    /**
     * Loads (and caches) the app_members row for the signed-in user.
     * Returns null when signed out or not yet a member of this app.
     */
    async function loadMember({ force = false } = {}) {
        if (currentMember && !force) return currentMember;
        if (!client || !currentAppId) return null;
        if (!(await isSignedIn())) { currentMember = null; return null; }

        const { data, error } = await client.rpc('get_social_member', { p_app_id: currentAppId });
        if (error) {
            console.warn('Failed to load member:', error.message);
            return null;
        }
        currentMember = Array.isArray(data) ? (data[0] || null) : (data || null);
        return currentMember;
    }

    function getMember() {
        return currentMember;
    }

    // ===== Actions =====

    async function signUp({ email, password, confirmPassword, firstName, lastName, phone, dialCode, acceptedTerms }) {
        const problem =
            validateEmail(email) ||
            validatePassword(password) ||
            validatePasswordMatch(password, confirmPassword) ||
            validatePhone(phone, { required: true, dial: dialCode }) ||
            (!firstName?.trim() ? 'Enter your first name' : null) ||
            (!acceptedTerms ? 'Accept the Terms & Conditions to continue' : null);

        if (problem) return { ok: false, error: problem };

        // Goes through the social-signup edge function rather than
        // client.auth.signUp.
        //
        // "Confirm email" is ON for this Supabase project and is project-wide
        // with no per-app scoping — Royalty business-owner accounts carry
        // billing, so it stays on for them. client.auth.signUp therefore
        // returns NO session, which is why signing up used to dump you back at
        // the login form to wait for an email. Worse, a mistyped address (it
        // happens: jay+j@24hour.desgn) sent the confirmation into a void and
        // left an account that could never be logged into, with a login error
        // that just said "email or password is incorrect".
        //
        // The edge function creates the user with email_confirm: true, which
        // bypasses that setting for social-type apps ONLY, and refuses any app
        // whose app_type is not 'social'. Then we sign in normally below.
        let res;
        try {
            res = await fetch(`${global.__socialSupabaseUrl}/functions/v1/social-signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': global.__socialAnonKey,
                    'Authorization': `Bearer ${global.__socialAnonKey}`
                },
                body: JSON.stringify({
                    app_id: currentAppId,
                    email: email.trim(),
                    password,
                    first_name: firstName?.trim() || null,
                    last_name: lastName?.trim() || null
                })
            });
        } catch (e) {
            return { ok: false, error: 'Connection problem. Check your signal and try again.' };
        }

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.success === false) {
            // The function tags which input was wrong so the message lands on
            // that field rather than in the footer.
            return {
                ok: false,
                field: payload.field || null,
                error: payload.error || 'Could not create your account. Try again.'
            };
        }

        // The account exists and is confirmed, so this succeeds immediately —
        // no email round trip, no second visit to the login form.
        const { error: signInError } = await client.auth.signInWithPassword({
            email: email.trim(),
            password
        });

        if (signInError) {
            return { ok: false, error: friendlyAuthError(signInError, 'log in to your new account') };
        }

        const linked = await linkMembership({ firstName, lastName, phone, dialCode });
        if (!linked.ok) return linked;

        return { ok: true, needsConfirmation: false };
    }

    async function signIn({ email, password }) {
        const problem = validateEmail(email) || (!password ? 'Enter your password' : null);
        if (problem) return { ok: false, error: problem };

        const { error } = await client.auth.signInWithPassword({
            email: email.trim(),
            password
        });

        if (error) return { ok: false, error: friendlyAuthError(error, 'log in') };

        // Idempotent — also adopts a pre-existing PIN-era member with this email.
        const linked = await linkMembership({});
        if (!linked.ok) return linked;

        return { ok: true };
    }

    /** Creates or refreshes the app_members row for the signed-in user. */
    async function linkMembership({ firstName, lastName, phone, dialCode }) {
        const { data, error } = await client.rpc('social_member_signup', {
            p_app_id: currentAppId,
            p_first_name: firstName?.trim() || null,
            p_last_name: lastName?.trim() || null,
            // E.164, not bare digits. social_member_signup writes this straight
            // into app_members.phone and customers.phone, and bare digits from
            // two different countries can collide into the same string.
            p_phone: toE164(phone, dialCode)
        });

        if (error) {
            // app_members has UNIQUE(app_id, phone) (customer-apps-migration.sql:149).
            // A number already registered in this app raises 23505, which is a
            // field problem the user can fix — not the generic "could not finish
            // setting up your account" the default mapping would produce.
            if (error.code === '23505' || /duplicate key|app_members_phone_unique/i.test(error.message || '')) {
                return {
                    ok: false,
                    field: 'phone',
                    error: 'That phone number is already registered in this app.'
                };
            }
            return { ok: false, error: friendlyAuthError(error, 'finish setting up your account') };
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.success === false) {
            return { ok: false, error: row.error_message || 'Could not finish setting up your account.' };
        }

        await loadMember({ force: true });
        return { ok: true };
    }

    async function signOut() {
        currentMember = null;
        try {
            await client.auth.signOut();
        } catch (e) {
            console.warn('Sign out failed:', e);
        }
    }

    async function requestPasswordReset(email) {
        const problem = validateEmail(email);
        if (problem) return { ok: false, error: problem };

        // Land back on this app. Deliberately NO #reset-password marker: GoTrue
        // REPLACES the fragment with its own payload, so a marker we put there
        // can never survive the round trip (measured against live GoTrue — an
        // invalid token sent to `…/social#reset-password` came back redirected
        // to `…/social#error=access_denied&error_code=otp_expired&…`). Which
        // view opens is decided from the auth payload instead, by
        // handleRecoveryLink().
        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;

        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });

        // Never reveal whether the address exists — that would turn this form
        // into an account-enumeration oracle.
        if (error && !/rate limit|too many/i.test(error.message || '')) {
            if (/redirect|invalid.*url/i.test(error.message || '')) {
                // Swallowing this one silently is how a rejected redirect_to
                // comes to look exactly like a successful send: the user is
                // told the link is on its way and no email ever arrives. An
                // origin that is not in Supabase Auth → URL Configuration →
                // Redirect URLs lands here (measured: localhost is not
                // allow-listed on this project).
                console.error(
                    `Password reset REDIRECT REJECTED for ${redirectTo} — no email was sent, ` +
                    `but the user was told one was. Add this URL to Supabase Auth → ` +
                    `URL Configuration → Redirect URLs.`,
                    error
                );
            } else {
                console.warn('Password reset error:', error.message);
            }
        }
        if (error && /rate limit|too many/i.test(error.message || '')) {
            return { ok: false, error: friendlyAuthError(error, 'send the reset email') };
        }

        return { ok: true };
    }

    async function updatePassword({ password, confirmPassword }) {
        const problem =
            validatePassword(password) ||
            validatePasswordMatch(password, confirmPassword);
        if (problem) return { ok: false, error: problem };

        // Gate on a live session before calling updateUser, mirroring
        // deleteAccount() below. A spent or expired recovery link leaves no
        // session at all, and updateUser() then fails with GoTrue's own
        // "Auth session missing!" — which is exactly the raw string a tester
        // was shown. The CODE is what matters to the caller: it swaps the view
        // to the "request a new link" panel rather than printing library text.
        const session = await getSession();
        if (!session) {
            return {
                ok: false,
                code: 'no_session',
                // One place owns this copy; pass the message GoTrue would have
                // produced so the mapping stays in friendlyAuthError().
                error: friendlyAuthError({ message: 'Auth session missing!' }, 'update your password')
            };
        }

        const { error } = await client.auth.updateUser({ password });
        if (error) return { ok: false, error: friendlyAuthError(error, 'update your password') };

        return { ok: true };
    }

    /**
     * Full account deletion. The RPC clears the app-side data; the edge function
     * removes the auth.users row (service role only). An account you can still
     * log into has not been deleted, so both halves have to succeed.
     */
    async function deleteAccount() {
        const session = await getSession();
        if (!session) return { ok: false, error: 'You are not logged in.' };

        const { data, error } = await client.rpc('delete_social_member_data', { p_app_id: currentAppId });
        if (error) return { ok: false, error: friendlyAuthError(error, 'delete your account') };

        const row = Array.isArray(data) ? data[0] : data;
        if (row && row.success === false) {
            return { ok: false, error: row.error_message || 'Could not delete your account.' };
        }

        try {
            const res = await fetch(`${global.__socialSupabaseUrl}/functions/v1/delete-social-account`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ app_id: currentAppId })
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                return {
                    ok: false,
                    error: body.error || 'Your data was removed but the login could not be deleted. Contact support.'
                };
            }
        } catch (e) {
            return {
                ok: false,
                error: 'Your data was removed but the login could not be deleted. Contact support.'
            };
        }

        currentMember = null;
        await signOut();
        return { ok: true };
    }

    // ===== Password recovery landing =====

    // Everything GoTrue can put on the URL for an auth redirect. Scrubbed
    // together so a refresh cannot replay a one-shot payload, and so a spent
    // token is not left sitting in the address bar to be pasted or shared.
    const RECOVERY_PARAMS = [
        'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type',
        'provider_token', 'provider_refresh_token',
        'type', 'code', 'token_hash',
        'error', 'error_code', 'error_description'
    ];

    /**
     * Strips the auth payload from the address bar, keeping every other query
     * param — `?slug=` is how the app finds itself when it is not reached
     * through the /a/{slug} rewrite, so a blanket `pathname`-only replace would
     * break that entry point.
     */
    function scrubRecoveryUrl() {
        try {
            const q = new URLSearchParams(window.location.search);
            RECOVERY_PARAMS.forEach(k => q.delete(k));
            const search = q.toString();
            history.replaceState(null, '', window.location.pathname + (search ? `?${search}` : ''));
        } catch (e) {
            // replaceState is unavailable in a few embedded webviews. The URL
            // staying dirty is cosmetic; failing the recovery over it is not.
            console.warn('Could not clear the recovery URL:', e);
        }
    }

    /**
     * The single owner of every password-recovery landing.
     *
     * Reads the snapshot taken at module load (see RECOVERY at the top of this
     * file) rather than window.location, so it cannot lose a race with
     * supabase-js's own URL detector.
     *
     * Returns a discriminated result, never English:
     *   ready      — a recovery session is live; show the New Password form
     *   expired    — the link was spent or timed out; offer a new one
     *   failed     — a payload was present but could not be exchanged
     *   signed-in  — the link established a session but was not a recovery link
     *   none       — an ordinary page load
     *
     * The caller maps those onto i18n copy. Nothing user-facing lives here.
     */
    async function handleRecoveryLink() {
        if (!client) return { status: 'none' };

        try {
            // GoTrue REPLACES the fragment when verify fails, so by the time the
            // browser gets here there is no token left to exchange — the error
            // IS the entire payload. This is a common path, not an edge case:
            // recovery tokens are single-use and mail scanners and link
            // prefetchers routinely burn them before the human clicks.
            if (RECOVERY.error || RECOVERY.errorCode) {
                scrubRecoveryUrl();
                return {
                    status: 'expired',
                    code: RECOVERY.errorCode || RECOVERY.error,
                    detail: RECOVERY.errorDesc
                };
            }

            // The implicit flow — what this project emits today.
            if (RECOVERY.accessToken && RECOVERY.refreshToken) {
                const { error } = await client.auth.setSession({
                    access_token: RECOVERY.accessToken,
                    refresh_token: RECOVERY.refreshToken
                });
                scrubRecoveryUrl();
                if (error) return { status: 'failed', code: error.code || null, detail: error.message };
                // A recovery link carries type=recovery; anything else that
                // hands us a session is just a sign-in and must not pop the
                // password form at someone who did not ask for it.
                return { status: RECOVERY.type === 'recovery' ? 'ready' : 'signed-in' };
            }

            // PKCE. Unreachable while flowType stays implicit (see the comment
            // on createClient in social.js), kept so flipping that is a one-line
            // change. `?code=` carries no type, but recovery is the only
            // URL-delivered auth this app has — there is no OAuth and no magic
            // link anywhere in customer-app/.
            if (RECOVERY.code) {
                const { error } = await client.auth.exchangeCodeForSession(RECOVERY.code);
                scrubRecoveryUrl();
                if (error) return { status: 'failed', code: error.code || null, detail: error.message };
                return { status: 'ready' };
            }

            // ?token_hash=…&type=recovery — verification done by the client.
            // Not emitted by this project today; it is the branch the
            // credential-free e2e can drive, since a token_hash can be minted
            // by an admin call without sending any mail.
            if (RECOVERY.tokenHash && RECOVERY.type === 'recovery') {
                const { error } = await client.auth.verifyOtp({
                    token_hash: RECOVERY.tokenHash,
                    type: 'recovery'
                });
                scrubRecoveryUrl();
                if (error) {
                    // Here the failure comes back as an error object rather than
                    // a redirect, so spent-vs-broken has to be told apart from
                    // the message.
                    const raw = (error.message || '').toLowerCase();
                    const spent = /expired|invalid/.test(raw);
                    return {
                        status: spent ? 'expired' : 'failed',
                        code: error.code || null,
                        detail: error.message
                    };
                }
                return { status: 'ready' };
            }

            return { status: 'none' };
        } catch (e) {
            // This runs un-awaited at module scope in social.js, so an escaping
            // rejection would surface as an unhandled error with no recovery
            // path. Degrade to the "request a new link" panel instead.
            console.error('Recovery link handling failed:', e);
            scrubRecoveryUrl();
            return { status: 'failed', code: null, detail: e?.message || String(e) };
        }
    }

    /**
     * Deprecated, kept for ONE release.
     *
     * Removing the export outright would make a cached v13 social.html paired
     * with this file throw inside setupAuthListeners() — taking every auth
     * listener on the page down with it, not just recovery. Returning false is
     * the safe reading for old callers: the overlay stays shut.
     */
    function isRecoveryRedirect() {
        return false;
    }

    // ===== Init =====

    /**
     * Attaches the Supabase client and nothing else.
     *
     * init() below needs appId, which is only known after the customer_apps
     * fetch resolves — but recovery must not wait on a network round trip it
     * has no use for. This lets social.js bind the client the moment it is
     * created. init() assigns `client` again; both are idempotent.
     */
    function bindClient(supabaseClient) {
        client = supabaseClient;
    }

    function init({ supabaseClient, appId, appSlug, supabaseUrl, supabaseAnonKey }) {
        client = supabaseClient;
        currentAppId = appId;
        global.__socialAppSlug = appSlug;
        global.__socialSupabaseUrl = supabaseUrl;
        // Needed as the bearer for the social-signup edge function, which is
        // called before any session exists.
        global.__socialAnonKey = supabaseAnonKey;
    }

    global.SocialAuth = {
        init, bindClient,
        // session
        getSession, isSignedIn, loadMember, getMember,
        // actions
        signUp, signIn, signOut, linkMembership,
        requestPasswordReset, updatePassword, deleteAccount,
        // password recovery
        handleRecoveryLink,
        // helpers
        validateEmail, validatePassword, validatePasswordMatch, validatePhone,
        passwordStrength, formatPhone, toE164, friendlyAuthError,
        // deprecated — remove once v13 HTML has aged out of every PWA cache
        isRecoveryRedirect,
        PASSWORD_MIN, NANP_DIAL
    };
})(window);
