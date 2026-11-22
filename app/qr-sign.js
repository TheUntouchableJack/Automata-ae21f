// ===== RoyaltyQR: the program's QR code and its printable counter sign =====
//
// Needs qrcode-generator@1.4.4 (global `qrcode`), loaded before this file:
//   <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
// NOT qrcode@1.5.3/build/qrcode.min.js: that path 404s, which is why the dashboard and the builder
// used to fall back to a 72/220 px image from api.qrserver.com (and why "Download" saved that).
//
// The QR is drawn on a canvas here, so nothing depends on a third-party image loading:
//   - canvas(text, minPx): integer module size, 4-module quiet zone (the spec minimum);
//   - downloadPng(text, filename): at least 1024 px, sharp enough to print at any sign size;
//   - printSign(opts): a one-page counter sign (logo, name, colours, "Scan every visit to earn
//     points", the QR, the URL), printed from a print-only block of THIS page, not a popup, and
//     only once its images have decoded. The old popup printed before its QR image had loaded,
//     which gave a blank sign.
(function (global) {
    'use strict';

    const QUIET_MODULES = 4;
    const DARK = '#111827';
    const LIGHT = '#ffffff';
    const DOWNLOAD_PX = 1024;
    const SIGN_ID = 'royalty-print-sign';
    const STYLE_ID = 'royalty-print-sign-style';
    const IMAGE_WAIT_MS = 4000;

    function available() {
        return typeof global.qrcode === 'function';
    }

    // Type 0 = the smallest version that fits; 'M' = 15% error correction.
    function encode(text) {
        const qr = global.qrcode(0, 'M');
        qr.addData(String(text));
        qr.make();
        return qr;
    }

    function canvas(text, minPx) {
        const qr = encode(text);
        const count = qr.getModuleCount();
        const total = count + QUIET_MODULES * 2;
        const scale = Math.max(1, Math.ceil((minPx || 288) / total));
        const size = scale * total;

        const c = global.document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = LIGHT;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = DARK;
        for (let row = 0; row < count; row++) {
            for (let col = 0; col < count; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect((col + QUIET_MODULES) * scale, (row + QUIET_MODULES) * scale, scale, scale);
                }
            }
        }
        return c;
    }

    function downloadPng(text, filename) {
        const c = canvas(text, DOWNLOAD_PX);
        const link = global.document.createElement('a');
        link.download = filename || 'qr-code.png';
        link.href = c.toDataURL('image/png');
        global.document.body.appendChild(link);
        link.click();
        link.remove();
        return c;
    }

    // ----- the sign -----

    function safeColor(value, fallback) {
        const v = String(value || '').trim();
        return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
    }

    // Black or white text, whichever reads on the band colour.
    function inkFor(hex) {
        let h = hex.slice(1);
        if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum > 0.4 ? '#111827' : '#ffffff';
    }

    function safeImageUrl(value) {
        const v = String(value || '').trim();
        return /^https:\/\//i.test(v) ? v : null;
    }

    function el(tag, className, text) {
        const node = global.document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    // Builds the sign's DOM (no HTML strings: the name and URLs are owner data).
    // opts: { name, logoUrl, color, qrText, displayUrl, headline, sub, orVisit, powered }
    function buildSign(opts) {
        const color = safeColor(opts.color, '#7c3aed');
        const root = el('div');
        root.id = SIGN_ID;

        const page = el('div', 'rps-page');
        const band = el('div', 'rps-band');
        band.style.background = color;
        band.style.color = inkFor(color);

        const logo = el('div', 'rps-logo');
        const initial = (String(opts.name || 'R').trim().charAt(0) || 'R').toUpperCase();
        const logoUrl = safeImageUrl(opts.logoUrl);
        if (logoUrl) {
            const img = el('img');
            img.alt = '';
            img.setAttribute('src', logoUrl);
            img.dataset.fallback = initial;
            logo.appendChild(img);
        } else {
            logo.textContent = initial;
        }
        band.appendChild(logo);
        band.appendChild(el('div', 'rps-name', opts.name || ''));
        page.appendChild(band);

        const body = el('div', 'rps-body');
        body.appendChild(el('div', 'rps-headline', opts.headline || 'Scan every visit to earn points'));
        if (opts.sub) body.appendChild(el('div', 'rps-sub', opts.sub));
        const qrImg = el('img', 'rps-qr');
        qrImg.alt = 'QR code';
        qrImg.setAttribute('src', canvas(opts.qrText, DOWNLOAD_PX).toDataURL('image/png'));
        body.appendChild(qrImg);
        if (opts.displayUrl) {
            const url = el('div', 'rps-url');
            if (opts.orVisit) url.appendChild(el('span', 'rps-url-label', opts.orVisit));
            url.appendChild(el('span', 'rps-url-text', opts.displayUrl));
            body.appendChild(url);
        }
        page.appendChild(body);
        page.appendChild(el('div', 'rps-foot', opts.powered || 'Powered by Royalty'));
        root.appendChild(page);
        return root;
    }

    const SIGN_CSS = `
#${SIGN_ID} { display: none; }
@media print {
  @page { size: auto; margin: 10mm; }
  body > *:not(#${SIGN_ID}) { display: none !important; }
  html, body { background: #fff !important; }
  #${SIGN_ID} { display: block !important; }
}
#${SIGN_ID} .rps-page { width: 100%; max-width: 180mm; margin: 0 auto; border: 2px solid #e5e7eb; border-radius: 6mm;
  overflow: hidden; font-family: 'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111827;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; break-inside: avoid; page-break-inside: avoid; }
#${SIGN_ID} .rps-band { display: flex; align-items: center; gap: 6mm; padding: 8mm 10mm; }
#${SIGN_ID} .rps-logo { width: 22mm; height: 22mm; border-radius: 5mm; background: #fff; color: #111827; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 12mm; font-weight: 800; overflow: hidden; }
#${SIGN_ID} .rps-logo img { width: 100%; height: 100%; object-fit: contain; }
#${SIGN_ID} .rps-name { font-size: 11mm; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
#${SIGN_ID} .rps-body { padding: 8mm 10mm 4mm; text-align: center; }
#${SIGN_ID} .rps-headline { font-size: 10mm; font-weight: 800; line-height: 1.15; }
#${SIGN_ID} .rps-sub { font-size: 5mm; color: #4b5563; margin-top: 2mm; }
#${SIGN_ID} .rps-qr { display: block; width: 110mm; height: 110mm; margin: 7mm auto 5mm; image-rendering: pixelated; }
#${SIGN_ID} .rps-url { font-size: 4.6mm; color: #374151; }
#${SIGN_ID} .rps-url-label { margin-right: 2mm; color: #6b7280; }
#${SIGN_ID} .rps-url-text { font-weight: 700; overflow-wrap: anywhere; }
#${SIGN_ID} .rps-foot { text-align: center; font-size: 3.4mm; color: #9ca3af; padding: 3mm 0 6mm; }
`;

    function ensureStyle() {
        if (global.document.getElementById(STYLE_ID)) return;
        const style = el('style');
        style.id = STYLE_ID;
        style.textContent = SIGN_CSS;
        global.document.head.appendChild(style);
    }

    function removeSign() {
        const old = global.document.getElementById(SIGN_ID);
        if (old) old.remove();
    }

    // Resolves when every image has loaded or failed, or after a cap. A logo that fails is
    // replaced by the initial, so the sign never prints a broken-image box.
    function imagesReady(root, capMs) {
        const imgs = Array.from(root.querySelectorAll('img'));
        const each = imgs.map((img) => new Promise((resolve) => {
            const done = () => {
                if (!(img.naturalWidth > 0) && img.dataset.fallback) {
                    img.parentElement.textContent = img.dataset.fallback;
                }
                resolve();
            };
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        }));
        const cap = new Promise((resolve) => global.setTimeout(resolve, capMs));
        return Promise.race([Promise.all(each), cap]);
    }

    // The sign's words, in the owner's language (window.I18n, i18n/*.json "qrSign"), English otherwise.
    const TEXT = {
        headline: 'Scan every visit to earn points',
        sub: 'Join free in seconds. Your points add up to rewards.',
        orVisit: 'Or visit',
        powered: 'Powered by Royalty'
    };
    function texts() {
        const out = {};
        for (const k of Object.keys(TEXT)) {
            const key = `qrSign.${k}`;
            const v = global.I18n?.t ? global.I18n.t(key) : null;
            out[k] = (typeof v === 'string' && v && v !== key) ? v : TEXT[k];
        }
        return out;
    }

    async function printSign(opts) {
        ensureStyle();
        removeSign();
        const root = buildSign({ ...texts(), ...opts });
        global.document.body.appendChild(root);
        await imagesReady(root, IMAGE_WAIT_MS);
        global.addEventListener('afterprint', removeSign, { once: true });
        global.print();
        return root;
    }

    global.RoyaltyQR = { available, canvas, downloadPng, printSign, buildSign, imagesReady, safeColor, inkFor, texts, DOWNLOAD_PX };
})(window);
