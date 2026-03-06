// ===== Internationalization (i18n) Module =====
// Auto-detects browser language, supports manual override, persists preference

const I18n = (function() {
    // Supported languages with their native names (only fully translated languages)
    const SUPPORTED_LANGUAGES = {
        'en': { name: 'English', native: 'English', flag: '🇺🇸' },
        'es': { name: 'Spanish', native: 'Español', flag: '🇪🇸' },
        'fr': { name: 'French', native: 'Français', flag: '🇫🇷' },
        'de': { name: 'German', native: 'Deutsch', flag: '🇩🇪' },
        'it': { name: 'Italian', native: 'Italiano', flag: '🇮🇹' },
        'pt': { name: 'Portuguese', native: 'Português', flag: '🇧🇷' },
        'zh': { name: 'Chinese', native: '中文', flag: '🇨🇳' },
        'ar': { name: 'Arabic', native: 'العربية', flag: '🇸🇦', rtl: true }
    };

    const DEFAULT_LANGUAGE = 'en';
    const STORAGE_KEY = 'royalty_language';

    let currentLanguage = DEFAULT_LANGUAGE;
    let translations = {};
    let fallbackTranslations = {};
    let isInitialized = false;

    // Get the base path for translation files
    function getBasePath() {
        const path = window.location.pathname;
        if (path.includes('/app/') || path.includes('/blog/') || path.includes('/automations/')) {
            return '../i18n/';
        }
        return './i18n/';
    }

    // Detect browser language
    function detectBrowserLanguage() {
        const browserLang = navigator.language || navigator.userLanguage;
        const shortLang = browserLang.split('-')[0].toLowerCase();

        if (SUPPORTED_LANGUAGES[shortLang]) {
            return shortLang;
        }
        return DEFAULT_LANGUAGE;
    }

    // Get stored language preference
    function getStoredLanguage() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    // Store language preference
    function storeLanguage(lang) {
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (e) {
            console.warn('Could not store language preference');
        }
    }

    // Translation file version - increment when translations change
    const TRANSLATION_VERSION = 7;

    // Load translation file
    async function loadTranslations(lang) {
        const basePath = getBasePath();
        try {
            const response = await fetch(`${basePath}${lang}.json?v=${TRANSLATION_VERSION}`);
            if (!response.ok) {
                throw new Error(`Failed to load ${lang}.json`);
            }
            return await response.json();
        } catch (error) {
            console.warn(`Could not load translations for ${lang}, falling back to English`);
            if (lang !== DEFAULT_LANGUAGE) {
                return loadTranslations(DEFAULT_LANGUAGE);
            }
            return {};
        }
    }

    // Resolve a dotted key against a translation object
    function resolve(obj, keys) {
        let value = obj;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return null;
            }
        }
        return value;
    }

    // Get translation by key (supports nested keys like "nav.home")
    // Falls back to English when key is missing in current language
    function t(key, replacements = {}) {
        const keys = key.split('.');

        // Try current language first, then English fallback
        let value = resolve(translations, keys);
        if (value === null && fallbackTranslations !== translations) {
            value = resolve(fallbackTranslations, keys);
        }
        if (value === null) return key;

        // Handle replacements like {name}
        if (typeof value === 'string') {
            return value.replace(/\{(\w+)\}/g, (match, k) => {
                return replacements[k] !== undefined ? replacements[k] : match;
            });
        }

        return value;
    }

    // Apply translations to DOM elements with data-i18n attribute
    function applyTranslations() {
        // Handle regular text content translations
        document.querySelectorAll('[data-i18n]').forEach(element => {
            let key = element.getAttribute('data-i18n');
            let useHtml = false;

            if (key.startsWith('[html]')) {
                useHtml = true;
                key = key.substring(6);
            }

            const translation = t(key);

            if (translation !== key) {
                if (element.hasAttribute('data-i18n-attr')) {
                    // For attributes like title, aria-label, etc.
                    const attr = element.getAttribute('data-i18n-attr');
                    element.setAttribute(attr, translation);
                } else if (useHtml) {
                    element.innerHTML = translation;
                } else {
                    element.textContent = translation;
                }
            }
        });

        // Handle placeholder translations
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = t(key);

            if (translation !== key) {
                element.placeholder = translation;
            }
        });

        // Handle RTL languages
        const langInfo = SUPPORTED_LANGUAGES[currentLanguage];
        if (langInfo && langInfo.rtl) {
            document.documentElement.setAttribute('dir', 'rtl');
            document.body.classList.add('rtl');
        } else {
            document.documentElement.setAttribute('dir', 'ltr');
            document.body.classList.remove('rtl');
        }

        // Update html lang attribute
        document.documentElement.setAttribute('lang', currentLanguage);

        // Update language selector displays
        updateLanguageSelectors();
    }

    // Update all language selector buttons to show current language
    function updateLanguageSelectors() {
        document.querySelectorAll('.lang-selector-current').forEach(el => {
            el.textContent = currentLanguage.toUpperCase();
        });

        // Update active state on language options
        document.querySelectorAll('.lang-option').forEach(option => {
            const lang = option.getAttribute('data-lang');
            if (lang === currentLanguage) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
    }

    // Initialize i18n
    async function init() {
        if (isInitialized) return;

        // Determine language: stored > browser > default
        const storedLang = getStoredLanguage();
        const browserLang = detectBrowserLanguage();
        currentLanguage = storedLang || browserLang;

        // Load English as fallback, then current language
        fallbackTranslations = await loadTranslations(DEFAULT_LANGUAGE);
        if (currentLanguage !== DEFAULT_LANGUAGE) {
            translations = await loadTranslations(currentLanguage);
        } else {
            translations = fallbackTranslations;
        }

        // Apply translations
        applyTranslations();

        // Setup language selector dropdowns
        setupLanguageSelectors();

        isInitialized = true;

        // Dispatch event for other scripts
        window.dispatchEvent(new CustomEvent('i18n:ready', {
            detail: { language: currentLanguage }
        }));
    }

    // Change language
    async function setLanguage(lang) {
        if (!SUPPORTED_LANGUAGES[lang]) {
            console.warn(`Language ${lang} is not supported`);
            return;
        }

        if (lang === currentLanguage) return;

        currentLanguage = lang;
        storeLanguage(lang);
        if (lang === DEFAULT_LANGUAGE) {
            translations = fallbackTranslations;
        } else {
            translations = await loadTranslations(lang);
        }
        applyTranslations();

        // Close any open dropdowns
        document.querySelectorAll('.lang-dropdown.active').forEach(el => {
            el.classList.remove('active');
        });

        // Dispatch event
        window.dispatchEvent(new CustomEvent('i18n:changed', {
            detail: { language: lang }
        }));
    }

    // Setup language selector dropdowns
    function setupLanguageSelectors() {
        document.querySelectorAll('.lang-selector').forEach(selector => {
            const btn = selector.querySelector('.lang-selector-btn');
            const dropdown = selector.querySelector('.lang-dropdown');

            if (btn && dropdown) {
                // Toggle dropdown
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdown.classList.toggle('active');
                });

                // Handle language selection
                dropdown.querySelectorAll('.lang-option').forEach(option => {
                    option.addEventListener('click', (e) => {
                        e.preventDefault();
                        const lang = option.getAttribute('data-lang');
                        setLanguage(lang);
                    });
                });
            }
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            document.querySelectorAll('.lang-dropdown.active').forEach(el => {
                el.classList.remove('active');
            });
        });
    }

    // Create language selector HTML
    function createLanguageSelectorHTML(compact = true) {
        const options = Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => {
            const isActive = code === currentLanguage ? 'active' : '';
            if (compact) {
                return `<a href="#" class="lang-option ${isActive}" data-lang="${code}">${code.toUpperCase()}</a>`;
            }
            return `<a href="#" class="lang-option ${isActive}" data-lang="${code}">${info.native}</a>`;
        }).join('');

        return `
            <div class="lang-selector">
                <button class="lang-selector-btn" type="button" aria-label="Change language">
                    <span class="lang-selector-current">${currentLanguage.toUpperCase()}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <div class="lang-dropdown">
                    ${options}
                </div>
            </div>
        `;
    }

    // Public API
    return {
        init,
        t,
        setLanguage,
        getCurrentLanguage: () => currentLanguage,
        getSupportedLanguages: () => SUPPORTED_LANGUAGES,
        createLanguageSelectorHTML,
        applyTranslations
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => I18n.init());
} else {
    I18n.init();
}

// Make available globally
window.I18n = I18n;
window.t = I18n.t;
