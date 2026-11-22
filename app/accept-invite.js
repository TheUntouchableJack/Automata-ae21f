// ===== Accept a staff invitation (/app/accept-invite.html?token=…) =====
//
// Plan cool-anything-here-wiggly-valiant, item 4; SQL in 20261122000006_org_invitations_accept.sql.
//   get_org_invitation(token)    → what to show (org, role, invited email, inviter), anon-callable
//   accept_org_invitation(token) → joins the org; signed in, confirmed, the invited address only
//
// Not signed in: create an account for the invited email (user_type 'staff', so handle_new_user
// creates no org of their own) or sign in. Prod requires email confirmation, so a new account
// confirms through /app/login.html, whose firstRunDestination() sends a staff user without a
// membership back here (the token rides in their user metadata), and this page accepts.
(function () {
    'use strict';

    const TOKEN_RE = /^[A-Za-z0-9-]{20,100}$/;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    let invite = null;

    const $ = (id) => document.getElementById(id);
    const SECTIONS = ['create-form', 'signin-form', 'join-section', 'wrong-section', 'check-email-section', 'joined-section'];

    // window.I18n with {placeholders}; English fallback when a key is missing.
    function tr(key, fallback, vars) {
        let s = window.I18n?.t ? window.I18n.t(`acceptInvite.${key}`, vars || {}) : null;
        if (!s || s === `acceptInvite.${key}`) {
            s = fallback.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
        }
        return s;
    }

    function show(id) {
        SECTIONS.forEach((s) => { const el = $(s); if (el) el.hidden = s !== id; });
    }

    function setError(text) {
        const el = $('invite-error');
        el.textContent = text || '';
        el.hidden = !text;
    }

    function setTitle(title, subtitle) {
        $('invite-title').removeAttribute('data-i18n');
        $('invite-title').textContent = title;
        const sub = $('invite-subtitle');
        sub.textContent = subtitle || '';
        sub.hidden = !subtitle;
    }

    function busy(btn, on) {
        if (!btn) return;
        btn.disabled = on;
        btn.classList.toggle('btn-loading', on);
    }

    function orgName() { return invite?.org_name || 'Royalty'; }
    function roleText() {
        return invite?.role === 'admin' ? tr('roleAdmin', 'an admin') : tr('roleMember', 'a team member');
    }

    // A dead end: no form, just why.
    function showStatus(status) {
        show(null);
        const org = orgName();
        const messages = {
            invalid: tr('invalid', "This invitation link isn't valid. Ask the person who invited you to send it again."),
            expired: tr('expired', 'This invitation has expired. Ask {org} to send it again.', { org }),
            cancelled: tr('cancelled', 'This invitation was cancelled.'),
            accepted: tr('used', 'This invitation has already been used.'),
            used: tr('used', 'This invitation has already been used.'),
            error: tr('error', 'Something went wrong. Please try again.'),
        };
        setTitle(invite?.org_name ? tr('title', 'Join {org}', { org }) : 'Royalty', '');
        setError(messages[status] || messages.error);
    }

    function landingFor(role) {
        return role === 'admin' ? '/app/dashboard.html' : '/app/counter.html';
    }

    async function accept(btn) {
        setError('');
        busy(btn, true);
        try {
            const { data, error } = await db.rpc('accept_org_invitation', { p_token: token });
            if (error) throw error;
            if (data?.success) {
                show('joined-section');
                $('joined-section').textContent = tr('joined', "You're in! Taking you to {org}…", { org: data.org_name || orgName() });
                // The workspace mode is cached per user; a new membership may change it.
                if (window.AppWorkspace?.clear) window.AppWorkspace.clear();
                setTimeout(() => { window.location.href = landingFor(data.role); }, 1200);
                return;
            }
            const code = data?.code || 'error';
            if (code === 'wrong_account') return wrongAccount(null, data.invited_email);
            if (code === 'has_org') {
                setError(tr('hasOrg', '{invited} already runs its own business on Royalty. Ask {org} to invite a different email address.',
                    { invited: data.invited_email || invite.email, org: orgName() }));
                return;
            }
            if (code === 'email_unconfirmed') {
                setError(tr('unconfirmed', 'Confirm your email first: open the link we sent you, then come back.'));
                return;
            }
            showStatus(code);
        } catch (e) {
            console.error('[accept-invite] accept failed:', e);
            setError(tr('error', 'Something went wrong. Please try again.'));
        } finally {
            busy(btn, false);
        }
    }

    function wrongAccount(user, invited) {
        show('wrong-section');
        $('wrong-text').textContent = tr('wrongAccount',
            'This invitation is for {invited}. Sign out, then sign in or create an account with that email.',
            { invited: invited || invite.email });
    }

    function signedIn(user, autoAccept) {
        const mine = String(user.email || '').trim().toLowerCase();
        const theirs = String(invite.email || '').trim().toLowerCase();
        if (mine !== theirs) return wrongAccount(user, invite.email);

        show('join-section');
        $('signed-in-as').textContent = tr('signedInAs', 'Signed in as {email}.', { email: user.email });
        const joinBtn = $('join-btn');
        joinBtn.textContent = tr('joinBtn', 'Join {org}', { org: orgName() });
        joinBtn.onclick = () => accept(joinBtn);
        // They signed up from THIS invite (or just signed in to join): no second click.
        if (autoAccept || user.user_metadata?.invite_token === token) accept(joinBtn);
    }

    function friendlyAuthError(err) {
        const msg = String(err?.message || '');
        if (/already registered|already exists/i.test(msg)) return tr('alreadyRegistered', 'This email already has an account. Sign in instead.');
        if (/invalid login credentials/i.test(msg)) return msg;
        if (/email not confirmed/i.test(msg)) return tr('unconfirmed', 'Confirm your email first: open the link we sent you, then come back.');
        return msg || tr('error', 'Something went wrong. Please try again.');
    }

    async function onCreate(e) {
        e.preventDefault();
        setError('');
        const first = $('first-name').value.trim();
        const last = $('last-name').value.trim();
        const password = $('create-password').value;
        if (!first) { $('first-name').focus(); return; }
        if (password.length < 8) { setError(tr('passwordShort', 'Use at least 8 characters.')); return; }

        const btn = $('create-btn');
        busy(btn, true);
        try {
            const { data, error } = await db.auth.signUp({
                email: invite.email,
                password,
                options: {
                    data: { first_name: first, last_name: last, user_type: 'staff', invite_token: token },
                    emailRedirectTo: window.location.origin + '/app/login.html',
                },
            });
            if (error) throw error;
            // An existing address comes back as a user with no identities (Supabase hides it).
            if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                show('signin-form');
                setError(tr('alreadyRegistered', 'This email already has an account. Sign in instead.'));
                return;
            }
            if (data?.session?.user) return signedIn(data.session.user, true);
            show('check-email-section');
            $('check-email-text').textContent = tr('checkEmail',
                'We sent a confirmation link to {email}. Open it to finish joining {org}.', { email: invite.email, org: orgName() });
        } catch (err) {
            console.error('[accept-invite] sign-up failed:', err);
            if (/already registered|already exists/i.test(String(err?.message || ''))) show('signin-form');
            setError(friendlyAuthError(err));
        } finally {
            busy(btn, false);
        }
    }

    async function onSignIn(e) {
        e.preventDefault();
        setError('');
        const password = $('signin-password').value;
        if (!password) { $('signin-password').focus(); return; }
        const btn = $('signin-btn');
        busy(btn, true);
        try {
            const { data, error } = await db.auth.signInWithPassword({ email: invite.email, password });
            if (error) throw error;
            busy(btn, false);
            signedIn(data.user, true);
        } catch (err) {
            console.error('[accept-invite] sign-in failed:', err);
            setError(friendlyAuthError(err));
            busy(btn, false);
        }
    }

    async function init() {
        if (!TOKEN_RE.test(token)) return showStatus('invalid');
        try {
            const { data, error } = await db.rpc('get_org_invitation', { p_token: token });
            if (error) throw error;
            invite = data || { status: 'invalid' };
        } catch (e) {
            console.error('[accept-invite] lookup failed:', e);
            return showStatus('error');
        }
        if (invite.status !== 'pending') return showStatus(invite.status);

        const inviter = invite.inviter_name || invite.org_name || 'Royalty';
        setTitle(tr('title', 'Join {org}', { org: orgName() }),
            tr('subtitle', '{inviter} invited you to join {org} on Royalty as {role}.', { inviter, org: orgName(), role: roleText() }));
        $('create-email').value = invite.email;
        $('signin-email').value = invite.email;

        $('create-form').addEventListener('submit', onCreate);
        $('signin-form').addEventListener('submit', onSignIn);
        $('to-signin').addEventListener('click', () => { setError(''); show('signin-form'); });
        $('to-create').addEventListener('click', () => { setError(''); show('create-form'); });
        $('signout-btn').addEventListener('click', async () => {
            try { await db.auth.signOut(); } catch (e) { /* signed out anyway */ }
            window.location.reload();
        });

        const { data: { session } } = await db.auth.getSession();
        if (session?.user) return signedIn(session.user, false);
        show('create-form');
    }

    // The dynamic text is built in JS, so wait for the translations (i18n:ready), at most 1.5 s.
    function translationsReady() {
        const loaded = () => window.I18n?.t && window.I18n.t('acceptInvite.checking') !== 'acceptInvite.checking';
        if (loaded()) return Promise.resolve();
        return new Promise((resolve) => {
            window.addEventListener('i18n:ready', resolve, { once: true });
            setTimeout(resolve, 1500);
        });
    }

    // Exposed for tests only.
    window.__acceptInvite = { init, tr, landingFor };

    const start = () => translationsReady().then(init);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
