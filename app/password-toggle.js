// ===== Show/hide password toggle =====
//
// Added after a real login failure that took several minutes to diagnose: the
// account's email and its password spell "vibe" with a different number of i's
// (pahkie@viibeview.com / VibeView'26!), and with the field masked there was no
// way to tell a typo from a genuinely wrong credential. GoTrue answers both
// with the same "Invalid login credentials".
//
// Applies itself to EVERY input[type="password"] on the page rather than being
// wired up per field, so login, signup, reset-password and settings all get it
// from one script tag — and so does any password field added later.
//
// Deliberately wraps only the <input>, not its .form-field parent: signup.html
// and reset-password.html both have a .password-strength meter as the input's
// next sibling, and re-parenting the whole field would move the input out from
// under the CSS that positions it.
(function (global) {
    'use strict';

    var STYLE_ID = 'password-toggle-styles';
    var WRAPPER_CLASS = 'password-field';

    var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

    var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>' +
        '<line x1="1" y1="1" x2="23" y2="23"></line></svg>';

    // Injected rather than added to styles.css because the four pages that need
    // this style their inputs three different ways (login.html inline,
    // settings.css .form-group, the auth-card .form-field). Scoping everything
    // to .password-field keeps it from leaking into any of them.
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.' + WRAPPER_CLASS + ' { position: relative; display: block; }',
            // Keep the typed value clear of the button at every field width.
            '.' + WRAPPER_CLASS + ' > input { width: 100%; padding-right: 44px; }',
            '.' + WRAPPER_CLASS + '-btn {',
            '  position: absolute; top: 0; bottom: 0; right: 0;',
            '  display: flex; align-items: center; justify-content: center;',
            '  width: 44px; padding: 0; margin: 0;',
            '  background: none; border: none; cursor: pointer;',
            '  color: var(--color-text-muted); line-height: 0;',
            '}',
            '.' + WRAPPER_CLASS + '-btn:hover { color: var(--color-text); }',
            '.' + WRAPPER_CLASS + '-btn:focus-visible {',
            '  outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: var(--radius-md);',
            '}',
            '.' + WRAPPER_CLASS + '-btn svg { width: 18px; height: 18px; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // login.html, signup.html and reset-password.html load i18n.js but NOT
    // utils.js, so AppUtils.tr may not exist here — fall back to t() directly,
    // repeating its one gotcha: t()'s second argument is a replacements map,
    // not a fallback, so a missing key comes back as the key itself.
    function label(key, fallback) {
        if (global.AppUtils && typeof global.AppUtils.tr === 'function') {
            return global.AppUtils.tr(key, fallback);
        }
        if (typeof global.t === 'function') {
            var value = global.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function attach(input) {
        if (!input || input.dataset.passwordToggle === 'on') return;
        if (input.type !== 'password') return;
        input.dataset.passwordToggle = 'on';

        injectStyles();

        var wrapper = document.createElement('span');
        wrapper.className = WRAPPER_CLASS;
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        var btn = document.createElement('button');
        // type="button" is load-bearing: the default is "submit", which inside
        // these forms would fire a login attempt on every click.
        btn.type = 'button';
        btn.className = WRAPPER_CLASS + '-btn';
        btn.tabIndex = -1;   // Tab should go straight from password to Sign In.
        btn.innerHTML = EYE;
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-controls', input.id || '');
        btn.setAttribute('aria-label', label('auth.showPassword', 'Show password'));
        btn.title = btn.getAttribute('aria-label');
        wrapper.appendChild(btn);

        btn.addEventListener('click', function () {
            var reveal = input.type === 'password';
            input.type = reveal ? 'text' : 'password';
            btn.innerHTML = reveal ? EYE_OFF : EYE;
            btn.setAttribute('aria-pressed', String(reveal));
            var text = reveal
                ? label('auth.hidePassword', 'Hide password')
                : label('auth.showPassword', 'Show password');
            btn.setAttribute('aria-label', text);
            btn.title = text;

            // Keep the caret where it was; refocusing sends it to position 0 in
            // Safari otherwise.
            var start = input.selectionStart;
            var end = input.selectionEnd;
            input.focus();
            try { input.setSelectionRange(start, end); } catch (e) { /* not all types support it */ }
        });

        return btn;
    }

    function attachAll(root) {
        var scope = root || document;
        var inputs = scope.querySelectorAll('input[type="password"]');
        for (var i = 0; i < inputs.length; i++) attach(inputs[i]);
        return inputs.length;
    }

    // Re-label in place when the user switches language mid-page.
    function relabel() {
        var btns = document.querySelectorAll('.' + WRAPPER_CLASS + '-btn');
        for (var i = 0; i < btns.length; i++) {
            var pressed = btns[i].getAttribute('aria-pressed') === 'true';
            var text = pressed
                ? label('auth.hidePassword', 'Hide password')
                : label('auth.showPassword', 'Show password');
            btns[i].setAttribute('aria-label', text);
            btns[i].title = text;
        }
    }

    global.PasswordToggle = { attach: attach, attachAll: attachAll, relabel: relabel };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { attachAll(); });
    } else {
        attachAll();
    }

    global.addEventListener('i18n:changed', relabel);
})(typeof window !== 'undefined' ? window : globalThis);
