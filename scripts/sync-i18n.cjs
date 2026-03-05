/**
 * Sync missing i18n keys from en.json to all other locale files.
 * Usage: node scripts/sync-i18n.cjs
 */
const fs = require('fs');
const path = require('path');

const i18nDir = path.join(__dirname, '..', 'i18n');
const enPath = path.join(i18nDir, 'en.json');
const source = JSON.parse(fs.readFileSync(enPath, 'utf8'));

const locales = ['ar', 'de', 'es', 'fr', 'it', 'pt', 'zh'];

function flattenKeys(obj, prefix) {
    prefix = prefix || '';
    const result = [];
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            result.push(...flattenKeys(v, prefix + k + '.'));
        } else {
            result.push([prefix + k, v]);
        }
    }
    return result;
}

function setNestedKey(obj, key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    let target = obj;
    for (const p of parts) {
        if (!target[p] || typeof target[p] !== 'object') {
            target[p] = {};
        }
        target = target[p];
    }
    if (!(last in target)) {
        target[last] = value;
        return true;
    }
    return false;
}

const sourceKeys = flattenKeys(source);

for (const locale of locales) {
    const filePath = path.join(i18nDir, locale + '.json');
    const target = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let added = 0;

    for (const [key, value] of sourceKeys) {
        const parts = key.split('.');
        let existing = target;
        for (const p of parts) {
            if (existing && typeof existing === 'object' && p in existing) {
                existing = existing[p];
            } else {
                existing = undefined;
                break;
            }
        }
        if (existing === undefined) {
            setNestedKey(target, key, value);
            added++;
        }
    }

    if (added) {
        fs.writeFileSync(filePath, JSON.stringify(target, null, 4) + '\n');
        console.log(locale + '.json: +' + added + ' keys');
    } else {
        console.log(locale + '.json: up to date');
    }
}

console.log('Done.');
