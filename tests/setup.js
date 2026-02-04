/**
 * Vitest Test Setup
 * Global mocks and utilities for testing Royalty
 */

import { vi } from 'vitest';

// Mock Supabase client
globalThis.supabase = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
  })),
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn(),
    signOut: vi.fn(),
  }
};

// Mock auth functions
globalThis.requireAuth = vi.fn().mockResolvedValue({ id: 'test-user-id', email: 'test@example.com' });
globalThis.signOut = vi.fn().mockResolvedValue(undefined);
globalThis.getUserProfile = vi.fn().mockResolvedValue({
  id: 'test-user-id',
  first_name: 'Test',
  last_name: 'User',
  email: 'test@example.com'
});
globalThis.getOrgLimits = vi.fn().mockReturnValue({
  name: 'Free',
  projects: 3,
  automations: 10,
  customers: 500
});

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: vi.fn((key) => localStorageMock.store[key] || null),
  setItem: vi.fn((key, value) => { localStorageMock.store[key] = value; }),
  removeItem: vi.fn((key) => { delete localStorageMock.store[key]; }),
  clear: vi.fn(() => { localStorageMock.store = {}; })
};
globalThis.localStorage = localStorageMock;

// Mock window.location
delete window.location;
window.location = {
  href: '',
  pathname: '/app/dashboard.html',
  search: '',
  hash: '',
  assign: vi.fn(),
  replace: vi.fn()
};

// Mock console to reduce test noise (optional)
// globalThis.console = {
//   ...console,
//   log: vi.fn(),
//   warn: vi.fn(),
//   error: vi.fn()
// };

// Helper to reset all mocks between tests
export function resetMocks() {
  vi.clearAllMocks();
  localStorageMock.store = {};
}
