// ===== "See it build" demo (homepage #social-proof) =====
// Replaced the invented testimonials on 2026-11-22. It shows three apps the real
// template generator builds from one sentence each, using the same two modules
// the hero uses (AppConfigFallback.build + AppPreviewCard.render), so what a
// visitor sees here is what the box at the top of the page gives them.
//
// The sentence shown is translated; the app is always built from the English
// sentence, because the generator's niche keywords are English.
(function () {
    const DEMOS = {
        coffee: { key: 'buildDemo.promptCoffee', prompt: 'I run a small coffee shop in Austin called Bean There. About 200 regulars, mostly morning commuters.' },
        barber: { key: 'buildDemo.promptBarber', prompt: 'Fade Factory is my barbershop in Queens. Three chairs, and most clients come back every few weeks.' },
        nails:  { key: 'buildDemo.promptNails',  prompt: 'We own a nail salon called Polished in Miami. Gel sets, pedicures and lots of repeat clients.' }
    };
    const ORDER = ['coffee', 'barber', 'nails'];
    const CYCLE_MS = 7000;
    const TYPE_MS = 22;

    function tr(key, fallback) {
        try {
            const v = window.I18n && I18n.t(key);
            if (v && v !== key) return v;
        } catch (e) { /* fall back to English */ }
        return fallback;
    }

    function init() {
        const root = document.getElementById('build-demo');
        const text = document.getElementById('build-demo-text');
        const mount = document.getElementById('build-demo-mount');
        if (!root || !text || !mount || !window.AppConfigFallback || !window.AppPreviewCard) return;

        const tabs = Array.from(root.querySelectorAll('[data-demo]'));
        let reduce = false;
        try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no matchMedia */ }

        let current = 0;
        let typing = null;
        let cycle = null;
        let userPicked = false;
        let started = false;

        function paint(demo) {
            let config = null;
            try {
                config = AppConfigFallback.build({
                    prompt: demo.prompt,
                    industry: '',
                    businessName: AppConfigFallback.guessName ? AppConfigFallback.guessName(demo.prompt) : ''
                });
            } catch (e) { config = null; }
            if (!config) return;
            mount.classList.remove('is-in');
            AppPreviewCard.render(mount, config, { showSourceNote: false });
            // Next frame, so the fade-in transition runs from the hidden state.
            requestAnimationFrame(() => mount.classList.add('is-in'));
        }

        function show(i) {
            current = (i + ORDER.length) % ORDER.length;
            const id = ORDER[current];
            const demo = DEMOS[id];
            tabs.forEach(tab => {
                const on = tab.dataset.demo === id;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            });
            const sentence = tr(demo.key, demo.prompt);
            root.querySelector('[role="tabpanel"]')?.setAttribute('aria-label', sentence);
            clearInterval(typing);
            typing = null;

            if (reduce) {
                text.textContent = sentence;
                paint(demo);
                return;
            }
            text.textContent = '';
            mount.classList.remove('is-in');
            let n = 0;
            typing = setInterval(() => {
                n += 2;
                text.textContent = sentence.slice(0, n);
                if (n >= sentence.length) {
                    clearInterval(typing);
                    typing = null;
                    paint(demo);
                }
            }, TYPE_MS);
        }

        function startCycle() {
            if (reduce || userPicked || cycle) return;
            cycle = setInterval(() => show(current + 1), CYCLE_MS);
        }
        function stopCycle() {
            clearInterval(cycle);
            cycle = null;
        }

        tabs.forEach((tab, i) => {
            tab.addEventListener('click', () => {
                userPicked = true;
                stopCycle();
                show(i);
                window.Analytics?.track('build_demo_picked', { demo: tab.dataset.demo });
            });
            tab.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].focus();
                tabs[next].click();
            });
        });

        // Start typing only once the section is on screen, and stop cycling when
        // it scrolls away, so it never animates where nobody is looking.
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                const onScreen = entries.some(en => en.isIntersecting);
                if (onScreen) {
                    if (!started) { started = true; show(0); }
                    startCycle();
                } else {
                    stopCycle();
                }
            }, { threshold: 0.3 });
            io.observe(root);
        } else {
            started = true;
            show(0);
        }

        window.addEventListener('i18n:changed', () => { if (started) show(current); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
