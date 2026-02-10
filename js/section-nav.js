/* ============================================
   Royalty — Section Navigation
   Side dots, keyboard nav, section counter
   ============================================ */

let currentSectionIndex = 0;
let sectionMap = [];

// Detect which page we're on and set section map
function initSectionMap() {
    const path = window.location.pathname;

    if (path.includes('pricing')) {
        sectionMap = [
            { id: 'pricing-hero', label: 'Overview' },
            { id: 'pricing-cards', label: 'Plans' },
            { id: 'comparison', label: 'Compare' },
            { id: 'appsumo', label: 'AppSumo' },
            { id: 'royalty-pro', label: 'Royalty Pro' },
            { id: 'faq', label: 'FAQ' }
        ];
    } else {
        // Landing page
        sectionMap = [
            { id: 'hero', label: 'Home' },
            { id: 'features', label: 'Features' },
            { id: 'how-it-works', label: 'How It Works' },
            { id: 'automations', label: 'Automations' },
            { id: 'social-proof', label: 'Results' },
            { id: 'pricing', label: 'Pricing' },
            { id: 'cta', label: 'Get Started' }
        ];
    }
}

// Build side navigation dots
function initSideNav() {
    const nav = document.getElementById('sideNav');
    if (!nav) return;

    // Only include visible sections
    const visibleSections = sectionMap.filter(s => {
        const el = document.getElementById(s.id);
        return el && el.offsetParent !== null;
    });

    nav.innerHTML = visibleSections.map(s => `
        <div class="nav-dot" data-section="${s.id}">
            <span class="nav-label">${s.label}</span>
        </div>
    `).join('');

    nav.querySelectorAll('.nav-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const section = document.getElementById(dot.dataset.section);
            if (section) section.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// Update active nav dot on scroll
function updateNav() {
    const dots = document.querySelectorAll('.nav-dot');
    const sections = sectionMap.map(s => document.getElementById(s.id)).filter(Boolean);
    let current = '';

    sections.forEach(section => {
        if (section.offsetParent === null) return;
        const rect = section.getBoundingClientRect();
        if (rect.top <= window.innerHeight / 3) {
            current = section.getAttribute('id');
        }
    });

    dots.forEach(dot => {
        dot.classList.toggle('active', dot.dataset.section === current);
    });

    // Update current section index
    const visibleSections = sectionMap.filter(s => {
        const el = document.getElementById(s.id);
        return el && el.offsetParent !== null;
    });
    currentSectionIndex = Math.max(0, visibleSections.findIndex(s => s.id === current));

    // Update section counter
    const counter = document.getElementById('sectionCounter');
    if (counter && visibleSections.length > 0) {
        counter.textContent = `${currentSectionIndex + 1} / ${visibleSections.length}`;
    }
}

// Navigate to section by index
function navigateToSection(index) {
    const visibleSections = sectionMap.filter(s => {
        const el = document.getElementById(s.id);
        return el && el.offsetParent !== null;
    });

    const clamped = Math.max(0, Math.min(index, visibleSections.length - 1));
    const section = document.getElementById(visibleSections[clamped].id);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
        currentSectionIndex = clamped;
    }
}

// Keyboard navigation
function initKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        // Skip if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;

        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                navigateToSection(currentSectionIndex + 1);
                break;

            case 'ArrowLeft':
                e.preventDefault();
                navigateToSection(currentSectionIndex - 1);
                break;

            case 'Home':
                e.preventDefault();
                navigateToSection(0);
                break;

            case 'End':
                e.preventDefault();
                navigateToSection(99);
                break;
        }
    });
}

// Throttle utility
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Initialize navigation
function initSectionNav() {
    initSectionMap();
    initSideNav();
    initKeyboardNav();
    window.addEventListener('scroll', throttle(updateNav, 16));
    updateNav();

    // Show side nav after a short delay (let page render)
    setTimeout(() => {
        const nav = document.getElementById('sideNav');
        if (nav) nav.style.display = 'flex';
    }, 500);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSectionNav);
} else {
    initSectionNav();
}
