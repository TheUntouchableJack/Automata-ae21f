// ===== Cookie Consent Module =====
// GDPR-compliant cookie consent banner
// Blocks analytics until user consents

const CookieConsent = (function() {
    'use strict';

    const CONSENT_KEY = 'royalty_cookie_consent';
    const CONSENT_VERSION = '1'; // Increment to re-prompt users

    // Check if user has already made a choice
    function hasConsent() {
        const consent = localStorage.getItem(CONSENT_KEY);
        if (!consent) return null;
        try {
            const parsed = JSON.parse(consent);
            if (parsed.version !== CONSENT_VERSION) return null;
            return parsed.accepted;
        } catch {
            return null;
        }
    }

    // Save consent choice
    function saveConsent(accepted) {
        localStorage.setItem(CONSENT_KEY, JSON.stringify({
            accepted: accepted,
            timestamp: new Date().toISOString(),
            version: CONSENT_VERSION
        }));
    }

    // Load analytics scripts (only called after consent)
    function loadAnalytics() {
        // Google Analytics
        if (window.GA_MEASUREMENT_ID) {
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://www.googletagmanager.com/gtag/js?id=${window.GA_MEASUREMENT_ID}`;
            document.head.appendChild(script);

            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', window.GA_MEASUREMENT_ID, {
                anonymize_ip: true // Privacy enhancement
            });
        }
    }

    // Create and show the banner
    function showBanner() {
        // Don't show if already decided
        if (hasConsent() !== null) {
            if (hasConsent()) loadAnalytics();
            return;
        }

        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.innerHTML = `
            <div class="cookie-consent-content">
                <div class="cookie-consent-text">
                    <strong>We value your privacy</strong>
                    <p>We use cookies to analyze site traffic and improve your experience.
                    <a href="/privacy.html" target="_blank">Learn more</a></p>
                </div>
                <div class="cookie-consent-buttons">
                    <button id="cookie-reject" class="cookie-btn cookie-btn-secondary">Reject</button>
                    <button id="cookie-accept" class="cookie-btn cookie-btn-primary">Accept</button>
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #cookie-consent-banner {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: #1a1a2e;
                border-top: 1px solid rgba(212, 175, 55, 0.2);
                padding: 1rem;
                z-index: 10000;
                animation: slideUp 0.3s ease-out;
            }
            @keyframes slideUp {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .cookie-consent-content {
                max-width: 1200px;
                margin: 0 auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1.5rem;
                flex-wrap: wrap;
            }
            .cookie-consent-text {
                flex: 1;
                min-width: 250px;
                color: #e0e0e0;
                font-size: 0.9rem;
            }
            .cookie-consent-text strong {
                color: #fff;
                display: block;
                margin-bottom: 0.25rem;
            }
            .cookie-consent-text p {
                margin: 0;
                opacity: 0.8;
            }
            .cookie-consent-text a {
                color: #d4af37;
                text-decoration: underline;
            }
            .cookie-consent-buttons {
                display: flex;
                gap: 0.75rem;
                flex-shrink: 0;
            }
            .cookie-btn {
                padding: 0.625rem 1.25rem;
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                border: none;
                transition: all 0.2s;
            }
            .cookie-btn-primary {
                background: linear-gradient(135deg, #d4af37, #f4d03f);
                color: #000;
            }
            .cookie-btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);
            }
            .cookie-btn-secondary {
                background: transparent;
                color: #a0a0b0;
                border: 1px solid #333;
            }
            .cookie-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.05);
                color: #fff;
            }
            @media (max-width: 600px) {
                .cookie-consent-content {
                    flex-direction: column;
                    text-align: center;
                }
                .cookie-consent-buttons {
                    width: 100%;
                    justify-content: center;
                }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(banner);

        // Event listeners
        document.getElementById('cookie-accept').addEventListener('click', function() {
            saveConsent(true);
            loadAnalytics();
            banner.remove();
        });

        document.getElementById('cookie-reject').addEventListener('click', function() {
            saveConsent(false);
            banner.remove();
        });
    }

    // Initialize on DOM ready
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showBanner);
        } else {
            showBanner();
        }
    }

    // Public API
    return {
        init: init,
        hasConsent: hasConsent,
        showBanner: showBanner
    };
})();

// Auto-initialize
CookieConsent.init();
