import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom for browser-like environment
    environment: 'jsdom',

    // Global test setup
    globals: true,

    // Test file patterns
    include: ['tests/**/*.test.js'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['app/**/*.js'],
      exclude: [
        'app/auth.js',           // Contains Supabase credentials
        'app/*-library.js',      // Static data files
        'app/onboarding-*.js',   // Complex state management
      ]
    },

    // Setup files
    setupFiles: ['./tests/setup.js']
  }
});
