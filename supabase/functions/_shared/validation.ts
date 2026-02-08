/**
 * Input Validation and Sanitization Utilities
 * Phase 7: Security Hardening
 */

// XSS-safe string sanitization
export function sanitizeString(input: unknown): string {
  if (typeof input !== 'string') {
    return String(input ?? '');
  }
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Strip HTML tags entirely
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

// Validate UUID format
export function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Validate and sanitize tool input parameters
export interface ToolInputValidation {
  valid: boolean;
  sanitized: Record<string, unknown>;
  errors: string[];
}

export function validateToolInput(
  toolName: string,
  params: Record<string, unknown>
): ToolInputValidation {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};

  // Tool-specific validation rules
  const rules: Record<string, Record<string, { type: string; required?: boolean; maxLength?: number }>> = {
    create_announcement: {
      title: { type: 'string', required: true, maxLength: 200 },
      body: { type: 'string', required: true, maxLength: 2000 },
      priority: { type: 'string', required: false },
      schedule_for: { type: 'string', required: false }
    },
    send_targeted_message: {
      segment: { type: 'string', required: true },
      subject: { type: 'string', required: true, maxLength: 200 },
      body: { type: 'string', required: true, maxLength: 5000 },
      filter_tier: { type: 'string', required: false }
    },
    create_flash_promotion: {
      name: { type: 'string', required: true, maxLength: 100 },
      multiplier: { type: 'number', required: true },
      duration_hours: { type: 'number', required: true }
    },
    award_bonus_points: {
      points: { type: 'number', required: true },
      reason: { type: 'string', required: true, maxLength: 500 },
      segment: { type: 'string', required: false },
      member_id: { type: 'string', required: false }
    },
    enable_automation: {
      automation_type: { type: 'string', required: true },
      enable: { type: 'boolean', required: true }
    },
    save_knowledge: {
      layer: { type: 'string', required: true },
      category: { type: 'string', required: true },
      fact: { type: 'string', required: true, maxLength: 2000 }
    }
  };

  const toolRules = rules[toolName];
  if (!toolRules) {
    // Unknown tool - pass through with basic sanitization
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else {
        sanitized[key] = value;
      }
    }
    return { valid: true, sanitized, errors };
  }

  // Validate each parameter
  for (const [paramName, rule] of Object.entries(toolRules)) {
    const value = params[paramName];

    // Required check
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required parameter: ${paramName}`);
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    // Type check
    if (rule.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`Parameter ${paramName} must be a string`);
        continue;
      }
      // Length check
      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push(`Parameter ${paramName} exceeds max length of ${rule.maxLength}`);
        continue;
      }
      // Sanitize and store
      sanitized[paramName] = sanitizeString(value);
    } else if (rule.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (isNaN(num)) {
        errors.push(`Parameter ${paramName} must be a number`);
        continue;
      }
      sanitized[paramName] = num;
    } else if (rule.type === 'boolean') {
      sanitized[paramName] = Boolean(value);
    }
  }

  return {
    valid: errors.length === 0,
    sanitized,
    errors
  };
}

// Detect potential PII in text
export function detectPII(text: string): { hasPII: boolean; types: string[] } {
  const patterns: Record<string, RegExp> = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g
  };

  const foundTypes: string[] = [];

  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      foundTypes.push(type);
    }
  }

  return {
    hasPII: foundTypes.length > 0,
    types: foundTypes
  };
}

// Sanitize web search results
export function sanitizeSearchResult(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  const allowedFields = ['title', 'snippet', 'url', 'source', 'date'];

  for (const field of allowedFields) {
    const value = (result as Record<string, unknown>)[field];
    if (typeof value === 'string') {
      sanitized[field] = stripHtml(value);
    }
  }

  return sanitized;
}

// Validate prompt injection attempts
export function detectPromptInjection(text: string): { suspicious: boolean; patterns: string[] } {
  const suspiciousPatterns = [
    { name: 'system_override', pattern: /ignore (previous|all|prior) instructions/i },
    { name: 'role_switch', pattern: /you are now|pretend to be|act as/i },
    { name: 'jailbreak', pattern: /DAN|do anything now|jailbreak/i },
    { name: 'instruction_leak', pattern: /show (me )?(your|the) (system )?prompt/i },
    { name: 'base64_injection', pattern: /[A-Za-z0-9+/]{50,}={0,2}/ },
    { name: 'unicode_abuse', pattern: /[\u200B-\u200F\u2028-\u202F\uFEFF]/ }
  ];

  const detected: string[] = [];

  for (const { name, pattern } of suspiciousPatterns) {
    if (pattern.test(text)) {
      detected.push(name);
    }
  }

  return {
    suspicious: detected.length > 0,
    patterns: detected
  };
}
