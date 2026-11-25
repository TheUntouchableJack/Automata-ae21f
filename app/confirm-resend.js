/**
 * Resend the sign-up confirmation email (plan abstract-gliding-hellman, Phase 5, 2026-11-25).
 *
 * The confirm-email step had no way back: nowhere could an owner ask for the email again, and an
 * expired link landed on a bare login form. signup.html ("Check your inbox") and login.html
 * ("Email not confirmed", "That link expired") both wire a Resend button through this.
 *
 * Email confirmation stays on (Turnstile is never checked server-side). Supabase allows one email
 * per address per 60 s, so the button cools down for 60 s after each send.
 *
 * window.ConfirmResend: attach, isRateLimited, COOLDOWN_S. No other globals.
 */
(function () {
    'use strict';

    var COOLDOWN_S = 60;

    function t(key, fallback, vars) {
        var out = fallback;
        try {
            var v = window.I18n && window.I18n.t ? window.I18n.t(key, vars || {}) : null;
            if (v && v !== key) out = v;
        } catch (e) { /* English fallback */ }
        if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
        return out;
    }

    /** Supabase's per-address limit ("only request this after 60 seconds") or the project-wide one. */
    function isRateLimited(err) {
        if (!err) return false;
        if (err.status === 429 || err.code === 'over_email_send_rate_limit') return true;
        return /rate limit|security purposes|too many/i.test(String(err.message || ''));
    }

    function track(name, props) {
        try {
            if (typeof royaltyWhenAnalytics === 'function') royaltyWhenAnalytics(function (A) { A.track(name, props); });
        } catch (e) { /* analytics never breaks the page */ }
    }

    /**
     * Wire a Resend button. opts:
     *   button, status (an element for the result line), getEmail() → string,
     *   source ('signup' | 'login' | 'login_expired'), startCooled (true right after a send).
     * Returns { send } (the click handler, for tests).
     */
    function attach(opts) {
        var btn = opts.button;
        var status = opts.status;
        var until = 0;
        var timer = null;

        function setStatus(text, kind) {
            if (!status) return;
            status.textContent = text || '';
            status.className = 'confirm-resend-status' + (kind ? ' is-' + kind : '');
            status.hidden = !text;
        }

        function idleLabel() { return t('auth.resendEmail', 'Resend email'); }

        function tick() {
            var left = Math.ceil((until - Date.now()) / 1000);
            if (left > 0) {
                btn.disabled = true;
                btn.textContent = t('auth.resendWait', 'Resend in {seconds}s', { seconds: left });
                return;
            }
            clearInterval(timer);
            timer = null;
            btn.disabled = false;
            btn.textContent = idleLabel();
        }

        function cooldown() {
            until = Date.now() + COOLDOWN_S * 1000;
            if (timer) clearInterval(timer);
            timer = setInterval(tick, 1000);
            tick();
        }

        async function send() {
            if (btn.disabled) return 'busy';
            var email = String((opts.getEmail && opts.getEmail()) || '').trim();
            if (!email) {
                setStatus(t('auth.enterEmailFirst', 'Enter your email above first.'), 'error');
                return 'no_email';
            }
            var db = window.supabase;
            if (!db || !db.auth || typeof db.auth.resend !== 'function') {
                setStatus(t('auth.resendFailed', 'We couldn’t send the email. Please try again.'), 'error');
                return 'failed';
            }
            btn.disabled = true;
            btn.textContent = t('auth.resending', 'Sending…');
            setStatus('', null);
            try {
                var res = await db.auth.resend({
                    type: 'signup',
                    email: email,
                    options: { emailRedirectTo: window.location.origin + '/app/login.html' },
                });
                if (res && res.error) throw res.error;
                setStatus(t('auth.resent', 'Sent! Check your inbox, and your spam folder.'), 'ok');
                track('confirm_email_resent', { source: opts.source || 'unknown' });
                cooldown();
                return 'sent';
            } catch (err) {
                if (isRateLimited(err)) {
                    setStatus(t('auth.resendTooMany', 'We just sent one. Please wait a minute, then try again.'), 'error');
                    cooldown();
                    return 'rate_limited';
                }
                console.error('[ConfirmResend] resend failed:', err);
                setStatus(t('auth.resendFailed', 'We couldn’t send the email. Please try again.'), 'error');
                btn.disabled = false;
                btn.textContent = idleLabel();
                return 'failed';
            }
        }

        btn.type = 'button';
        btn.textContent = idleLabel();
        btn.addEventListener('click', send);
        window.addEventListener('i18n:changed', function () { if (!timer && !btn.disabled) btn.textContent = idleLabel(); });
        if (opts.startCooled) cooldown();
        return { send: send };
    }

    window.ConfirmResend = { attach: attach, isRateLimited: isRateLimited, COOLDOWN_S: COOLDOWN_S };
})();
