/**
 * Internationalization (i18n) Utilities
 * Phase 7: Production Hardening
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'ja' | 'ko' | 'zh';
export type Namespace = 'coaching' | 'faq' | 'discovery' | 'errors' | 'actions' | 'ui';

const DEFAULT_LOCALE: Locale = 'en';

// In-memory cache for translations
const translationCache: Map<string, Record<string, string>> = new Map();
const CACHE_TTL_MS = 300000; // 5 minutes
const cacheTimestamps: Map<string, number> = new Map();

// Get cache key
function getCacheKey(locale: Locale, namespace: Namespace): string {
  return `${locale}:${namespace}`;
}

// Check if cache is still valid
function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL_MS;
}

// Load translations from database
export async function loadTranslations(
  supabase: SupabaseClient,
  locale: Locale,
  namespace: Namespace
): Promise<Record<string, string>> {
  const cacheKey = getCacheKey(locale, namespace);

  // Check cache first
  if (isCacheValid(cacheKey)) {
    return translationCache.get(cacheKey) ?? {};
  }

  try {
    const { data, error } = await supabase
      .from('translations')
      .select('key, value')
      .eq('locale', locale)
      .eq('namespace', namespace);

    if (error) {
      console.error('Translation load error:', error);
      // Fall back to English if available
      if (locale !== DEFAULT_LOCALE) {
        return loadTranslations(supabase, DEFAULT_LOCALE, namespace);
      }
      return {};
    }

    const translations: Record<string, string> = {};
    for (const row of data ?? []) {
      translations[row.key] = row.value;
    }

    // Update cache
    translationCache.set(cacheKey, translations);
    cacheTimestamps.set(cacheKey, Date.now());

    return translations;
  } catch (err) {
    console.error('Translation exception:', err);
    return {};
  }
}

// Translate a single key
export async function translate(
  supabase: SupabaseClient,
  locale: Locale,
  namespace: Namespace,
  key: string,
  interpolations?: Record<string, string | number>
): Promise<string> {
  const translations = await loadTranslations(supabase, locale, namespace);
  let value = translations[key];

  // Fall back to English if not found
  if (!value && locale !== DEFAULT_LOCALE) {
    const enTranslations = await loadTranslations(supabase, DEFAULT_LOCALE, namespace);
    value = enTranslations[key];
  }

  // Return key if translation not found
  if (!value) {
    console.warn(`Missing translation: ${namespace}.${key} (${locale})`);
    return key;
  }

  // Interpolate values
  if (interpolations) {
    for (const [k, v] of Object.entries(interpolations)) {
      value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }

  return value;
}

// Batch translate multiple keys
export async function translateBatch(
  supabase: SupabaseClient,
  locale: Locale,
  namespace: Namespace,
  keys: string[]
): Promise<Record<string, string>> {
  const translations = await loadTranslations(supabase, locale, namespace);
  const result: Record<string, string> = {};

  for (const key of keys) {
    result[key] = translations[key] ?? key;
  }

  return result;
}

// Get organization's preferred locale
export async function getOrgLocale(
  supabase: SupabaseClient,
  orgId: string
): Promise<Locale> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('preferred_locale')
      .eq('id', orgId)
      .single();

    if (error || !data?.preferred_locale) {
      return DEFAULT_LOCALE;
    }

    return data.preferred_locale as Locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// Format number for locale
export function formatNumber(value: number, locale: Locale): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-BR',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN'
  };

  return new Intl.NumberFormat(localeMap[locale]).format(value);
}

// Format currency for locale
export function formatCurrency(value: number, locale: Locale, currency = 'USD'): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-BR',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN'
  };

  return new Intl.NumberFormat(localeMap[locale], {
    style: 'currency',
    currency
  }).format(value);
}

// Format date for locale
export function formatDate(date: Date, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-BR',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN'
  };

  return new Intl.DateTimeFormat(localeMap[locale], options ?? {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

// Format relative time (e.g., "2 hours ago")
export function formatRelativeTime(date: Date, locale: Locale): string {
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-BR',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN'
  };

  const rtf = new Intl.RelativeTimeFormat(localeMap[locale], { numeric: 'auto' });
  const now = new Date();
  const diffSeconds = Math.floor((date.getTime() - now.getTime()) / 1000);

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, 'second');
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }
  const diffDays = Math.floor(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return rtf.format(diffDays, 'day');
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, 'month');
  }
  const diffYears = Math.floor(diffMonths / 12);
  return rtf.format(diffYears, 'year');
}

// Clear translation cache (call when translations are updated)
export function clearTranslationCache(): void {
  translationCache.clear();
  cacheTimestamps.clear();
}
