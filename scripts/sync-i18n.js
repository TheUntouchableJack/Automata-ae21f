#!/usr/bin/env node
/**
 * Sync missing translation keys from en.json to all other language files
 * Copies English text as fallback for missing keys
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(__dirname, '..', 'i18n');

// Get all keys from an object recursively
function getAllKeys(obj, prefix = '') {
    let keys = [];
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            keys = keys.concat(getAllKeys(obj[key], fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

// Get value at a nested key path
function getNestedValue(obj, keyPath) {
    return keyPath.split('.').reduce((o, k) => (o || {})[k], obj);
}

// Set value at a nested key path
function setNestedValue(obj, keyPath, value) {
    const keys = keyPath.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

// Main sync function
function syncTranslations() {
    // Load English (source of truth)
    const enPath = join(i18nDir, 'en.json');
    const enData = JSON.parse(readFileSync(enPath, 'utf8'));
    const enKeys = getAllKeys(enData);

    console.log(`Source (en.json): ${enKeys.length} keys\n`);

    // Get all other language files
    const langFiles = readdirSync(i18nDir)
        .filter(f => f.endsWith('.json') && f !== 'en.json');

    let totalAdded = 0;

    for (const langFile of langFiles) {
        const langPath = join(i18nDir, langFile);
        const langData = JSON.parse(readFileSync(langPath, 'utf8'));
        const langKeys = getAllKeys(langData);

        // Find missing keys
        const missingKeys = enKeys.filter(k => !langKeys.includes(k));

        if (missingKeys.length > 0) {
            console.log(`${langFile}: Adding ${missingKeys.length} missing keys`);

            // Add missing keys with English fallback
            for (const key of missingKeys) {
                const enValue = getNestedValue(enData, key);
                setNestedValue(langData, key, enValue);
            }

            // Write back
            writeFileSync(langPath, JSON.stringify(langData, null, 4) + '\n', 'utf8');
            totalAdded += missingKeys.length;

            // Show first few missing keys
            if (missingKeys.length <= 10) {
                missingKeys.forEach(k => console.log(`  + ${k}`));
            } else {
                missingKeys.slice(0, 5).forEach(k => console.log(`  + ${k}`));
                console.log(`  ... and ${missingKeys.length - 5} more`);
            }
        } else {
            console.log(`${langFile}: All keys present`);
        }
        console.log();
    }

    console.log(`\nTotal: Added ${totalAdded} keys across ${langFiles.length} files`);
}

syncTranslations();
