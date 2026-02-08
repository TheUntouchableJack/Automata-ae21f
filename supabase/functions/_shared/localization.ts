// Shared Localization Utilities
// Timezone-aware scheduling, currency formatting, and locale handling

// ============================================================================
// TYPES
// ============================================================================

export interface MemberLocale {
  locale: string        // 'en', 'es', 'fr', etc.
  timezone: string      // 'America/New_York', 'Europe/London', etc.
  currency: string      // 'USD', 'EUR', 'GBP', etc.
  country_code?: string // 'US', 'GB', 'DE', etc.
  quiet_hours?: {
    start: string       // '22:00'
    end: string         // '08:00'
  }
}

export interface FormattedMessage {
  subject?: string
  title?: string
  body: string
}

// ============================================================================
// TIMEZONE UTILITIES
// ============================================================================

/**
 * Get current time in a specific timezone
 */
export function getTimeInTimezone(timezone: string): Date {
  const now = new Date()
  // Create a date string in the target timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }

  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now)
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00'

  return new Date(
    parseInt(getPart('year')),
    parseInt(getPart('month')) - 1,
    parseInt(getPart('day')),
    parseInt(getPart('hour')),
    parseInt(getPart('minute')),
    parseInt(getPart('second'))
  )
}

/**
 * Check if current time is within quiet hours for a member
 */
export function isQuietHours(member: MemberLocale): boolean {
  if (!member.quiet_hours) return false

  const { start, end } = member.quiet_hours
  const memberTime = getTimeInTimezone(member.timezone || 'America/New_York')
  const currentMinutes = memberTime.getHours() * 60 + memberTime.getMinutes()

  const [startHour, startMin] = start.split(':').map(Number)
  const [endHour, endMin] = end.split(':').map(Number)
  const startMinutes = startHour * 60 + startMin
  const endMinutes = endHour * 60 + endMin

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

/**
 * Get optimal send time for a member (respects quiet hours)
 */
export function getOptimalSendTime(
  member: MemberLocale,
  preferredHour: number = 10
): Date {
  const memberTime = getTimeInTimezone(member.timezone || 'America/New_York')
  let sendTime = new Date(memberTime)

  // Set to preferred hour
  sendTime.setHours(preferredHour, 0, 0, 0)

  // Respect quiet hours
  if (member.quiet_hours) {
    const [quietEnd] = member.quiet_hours.end.split(':').map(Number)
    const sendHour = sendTime.getHours()
    const [quietStart] = member.quiet_hours.start.split(':').map(Number)

    // If send time is in quiet hours, move to after quiet hours
    if (quietStart > quietEnd) {
      // Overnight quiet hours
      if (sendHour >= quietStart || sendHour < quietEnd) {
        sendTime.setHours(quietEnd + 1, 0, 0, 0)
      }
    } else {
      if (sendHour >= quietStart && sendHour < quietEnd) {
        sendTime.setHours(quietEnd + 1, 0, 0, 0)
      }
    }
  }

  // If time has passed today, schedule for tomorrow
  if (sendTime < memberTime) {
    sendTime.setDate(sendTime.getDate() + 1)
  }

  return sendTime
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

/**
 * Format currency for a member's locale
 */
export function formatCurrency(
  amount: number,
  member: MemberLocale
): string {
  const locale = member.locale || 'en'
  const currency = member.currency || 'USD'

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency
    }).format(amount)
  } catch {
    // Fallback for unsupported locales
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Format points for a member's locale
 */
export function formatPoints(
  points: number,
  member: MemberLocale
): string {
  const locale = member.locale || 'en'

  try {
    const formatted = new Intl.NumberFormat(locale).format(points)
    return `${formatted} points`
  } catch {
    return `${points} points`
  }
}

/**
 * Format date for a member's locale and timezone
 */
export function formatDate(
  date: Date,
  member: MemberLocale,
  style: 'short' | 'medium' | 'long' = 'medium'
): string {
  const locale = member.locale || 'en'
  const timezone = member.timezone || 'America/New_York'

  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    dateStyle: style
  }

  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}

/**
 * Format relative time (e.g., "2 days ago", "in 3 hours")
 */
export function formatRelativeTime(
  date: Date,
  member: MemberLocale
): string {
  const locale = member.locale || 'en'
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

    if (Math.abs(diffDays) < 1) {
      const diffHours = Math.round(diffMs / (1000 * 60 * 60))
      if (Math.abs(diffHours) < 1) {
        const diffMinutes = Math.round(diffMs / (1000 * 60))
        return rtf.format(diffMinutes, 'minute')
      }
      return rtf.format(diffHours, 'hour')
    }

    return rtf.format(diffDays, 'day')
  } catch {
    return `${Math.abs(diffDays)} days ${diffDays < 0 ? 'ago' : 'from now'}`
  }
}

// ============================================================================
// NAME FORMATTING
// ============================================================================

/**
 * Format name according to cultural conventions
 */
export function formatName(
  firstName: string | null,
  lastName: string | null,
  member: MemberLocale
): string {
  const first = firstName || ''
  const last = lastName || ''

  // Asian name order (family name first)
  const asianLocales = ['ja', 'ko', 'zh', 'vi']
  if (asianLocales.includes(member.locale)) {
    return `${last}${first}`.trim() || 'Friend'
  }

  // Western name order
  return `${first} ${last}`.trim() || 'Friend'
}

/**
 * Get appropriate greeting based on locale
 */
export function getGreeting(member: MemberLocale): string {
  const greetings: Record<string, string> = {
    en: 'Hi',
    es: 'Hola',
    fr: 'Bonjour',
    de: 'Hallo',
    it: 'Ciao',
    pt: 'Olá',
    ja: 'こんにちは',
    ko: '안녕하세요',
    zh: '您好',
    ar: 'مرحبا'
  }

  return greetings[member.locale] || greetings.en
}

/**
 * Get appropriate formal salutation based on locale
 */
export function getFormalSalutation(
  firstName: string | null,
  lastName: string | null,
  member: MemberLocale
): string {
  const salutations: Record<string, (f: string, l: string) => string> = {
    en: (f, l) => `Dear ${f || l || 'Customer'}`,
    es: (f, l) => `Estimado/a ${f || l || 'Cliente'}`,
    fr: (f, l) => `Cher/Chère ${f || l || 'Client'}`,
    de: (f, l) => `Sehr geehrte/r ${f || l || 'Kunde'}`,
    ja: (f, l) => `${l || f || 'お客'}様`,
    ko: (f, l) => `${l || f || '고객'}님`
  }

  const formatter = salutations[member.locale] || salutations.en
  return formatter(firstName || '', lastName || '')
}

// ============================================================================
// MESSAGE INTERPOLATION
// ============================================================================

/**
 * Interpolate template variables with member-specific values
 */
export function interpolateMessage(
  template: FormattedMessage,
  member: MemberLocale,
  variables: Record<string, string | number>
): FormattedMessage {
  const interpolate = (text: string | undefined): string | undefined => {
    if (!text) return text

    let result = text

    // Standard variable replacement
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      result = result.replace(regex, String(value))
    }

    // Special formatting for currency
    result = result.replace(/\{\{currency:(\d+(?:\.\d+)?)\}\}/g, (_, amount) => {
      return formatCurrency(parseFloat(amount), member)
    })

    // Special formatting for points
    result = result.replace(/\{\{points:(\d+)\}\}/g, (_, points) => {
      return formatPoints(parseInt(points), member)
    })

    // Greeting
    result = result.replace(/\{\{greeting\}\}/g, getGreeting(member))

    return result
  }

  return {
    subject: interpolate(template.subject),
    title: interpolate(template.title),
    body: interpolate(template.body)!
  }
}

// ============================================================================
// SUPPORTED LOCALES
// ============================================================================

export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English', native: 'English', rtl: false },
  { code: 'es', name: 'Spanish', native: 'Español', rtl: false },
  { code: 'fr', name: 'French', native: 'Français', rtl: false },
  { code: 'de', name: 'German', native: 'Deutsch', rtl: false },
  { code: 'it', name: 'Italian', native: 'Italiano', rtl: false },
  { code: 'pt', name: 'Portuguese', native: 'Português', rtl: false },
  { code: 'ja', name: 'Japanese', native: '日本語', rtl: false },
  { code: 'ko', name: 'Korean', native: '한국어', rtl: false },
  { code: 'zh', name: 'Chinese', native: '中文', rtl: false },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true }
] as const

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]['code']

/**
 * Get locale info by code
 */
export function getLocaleInfo(code: string) {
  return SUPPORTED_LOCALES.find(l => l.code === code) || SUPPORTED_LOCALES[0]
}
