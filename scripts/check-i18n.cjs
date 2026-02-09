#!/usr/bin/env node
/**
 * i18n Validation Script
 *
 * Compares all language files against en.json (source of truth)
 * and reports any missing or extra keys.
 *
 * Usage: node scripts/check-i18n.js
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'i18n');
const SOURCE_LANG = 'en';
const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];

// Extract all keys from a nested object (returns flat paths like "pricing.starter.name")
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

// Load a JSON file
function loadJson(lang) {
    const filePath = path.join(I18N_DIR, `${lang}.json`);
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        console.error(`Error loading ${lang}.json:`, err.message);
        return null;
    }
}

// Main validation
function validate() {
    console.log('i18n Validation Report');
    console.log('='.repeat(50));
    console.log(`Source: ${SOURCE_LANG}.json`);
    console.log(`Languages: ${LANGUAGES.join(', ')}`);
    console.log('');

    // Load source (English)
    const sourceData = loadJson(SOURCE_LANG);
    if (!sourceData) {
        console.error('Cannot load source language file. Aborting.');
        process.exit(1);
    }

    const sourceKeys = new Set(getAllKeys(sourceData));
    console.log(`Total keys in source: ${sourceKeys.size}`);
    console.log('');

    let hasErrors = false;
    const results = [];

    // Check each language
    for (const lang of LANGUAGES) {
        if (lang === SOURCE_LANG) continue;

        const langData = loadJson(lang);
        if (!langData) {
            results.push({ lang, status: 'ERROR', missing: [], extra: [] });
            hasErrors = true;
            continue;
        }

        const langKeys = new Set(getAllKeys(langData));

        // Find missing keys (in source but not in lang)
        const missing = [...sourceKeys].filter(k => !langKeys.has(k));

        // Find extra keys (in lang but not in source)
        const extra = [...langKeys].filter(k => !sourceKeys.has(k));

        if (missing.length > 0 || extra.length > 0) {
            hasErrors = true;
        }

        results.push({ lang, status: missing.length === 0 && extra.length === 0 ? 'OK' : 'ISSUES', missing, extra });
    }

    // Print results
    for (const result of results) {
        const statusIcon = result.status === 'OK' ? '\u2713' : '\u2717';
        console.log(`${statusIcon} ${result.lang}.json - ${result.status}`);

        if (result.missing.length > 0) {
            console.log(`  Missing ${result.missing.length} key(s):`);
            result.missing.slice(0, 10).forEach(k => console.log(`    - ${k}`));
            if (result.missing.length > 10) {
                console.log(`    ... and ${result.missing.length - 10} more`);
            }
        }

        if (result.extra.length > 0) {
            console.log(`  Extra ${result.extra.length} key(s) (not in source):`);
            result.extra.slice(0, 5).forEach(k => console.log(`    + ${k}`));
            if (result.extra.length > 5) {
                console.log(`    ... and ${result.extra.length - 5} more`);
            }
        }
        console.log('');
    }

    // Summary
    console.log('='.repeat(50));
    if (hasErrors) {
        console.log('RESULT: Issues found. Please update translations.');
        process.exit(1);
    } else {
        console.log('RESULT: All translations are in sync!');
        process.exit(0);
    }
}

validate();
