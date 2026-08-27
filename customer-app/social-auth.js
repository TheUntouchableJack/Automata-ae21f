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

        // Land back on this app, in the reset view, so the recovery session is
        // picked up where the user can actually set a new password.
        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}#reset-password`;

        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });

        // Never reveal whether the address exists — that would turn this form
        // into an account-enumeration oracle.
        if (error && !/rate limit|too many/i.test(error.message || '')) {
            console.warn('Password reset error:', error.message);
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

    /** True when the page was opened from a password-recovery email link. */
    function isRecoveryRedirect() {
        return window.location.hash.includes('reset-password') ||
               window.location.hash.includes('type=recovery');
    }

    // ===== Init =====

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
        init,
        // session
        getSession, isSignedIn, loadMember, getMember,
        // actions
        signUp, signIn, signOut, linkMembership,
        requestPasswordReset, updatePassword, deleteAccount,
        // helpers
        validateEmail, validatePassword, validatePasswordMatch, validatePhone,
        passwordStrength, formatPhone, toE164, friendlyAuthError, isRecoveryRedirect,
        PASSWORD_MIN, NANP_DIAL
    };
})(window);
