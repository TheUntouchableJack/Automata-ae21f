import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Root directory
  root: '.',

  // Public assets directory
  publicDir: 'public',

  // Build configuration
  build: {
    // Output directory
    outDir: 'dist',

    // No source maps in production (prevents exposing source code)
    sourcemap: false,

    // Minify for production
    minify: 'esbuild',

    // Rollup options for multi-page app
    rollupOptions: {
      input: {
        // Main pages
        main: resolve(__dirname, 'index.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        estimate: resolve(__dirname, 'estimate.html'),

        // Error pages
        error404: resolve(__dirname, '404.html'),
        error500: resolve(__dirname, '500.html'),

        // App pages
        login: resolve(__dirname, 'app/login.html'),
        signup: resolve(__dirname, 'app/signup.html'),
        forgotPassword: resolve(__dirname, 'app/forgot-password.html'),
        resetPassword: resolve(__dirname, 'app/reset-password.html'),
        dashboard: resolve(__dirname, 'app/dashboard.html'),
        project: resolve(__dirname, 'app/project.html'),
        customers: resolve(__dirname, 'app/customers.html'),
        automations: resolve(__dirname, 'app/automations.html'),
        automation: resolve(__dirname, 'app/automation.html'),
        settings: resolve(__dirname, 'app/settings.html'),
        redeem: resolve(__dirname, 'app/redeem.html'),
        roadmap: resolve(__dirname, 'app/roadmap.html'),
        featureRequests: resolve(__dirname, 'app/feature-requests.html'),
        outgoing: resolve(__dirname, 'app/outgoing.html'),
        apps: resolve(__dirname, 'app/apps.html'),
        appBuilder: resolve(__dirname, 'app/app-builder.html'),
        intelligence: resolve(__dirname, 'app/intelligence.html'),
        upgrade: resolve(__dirname, 'app/upgrade.html'),

        // Admin venues page
        venues: resolve(__dirname, 'app/venues.html'),

        // Customer-facing app
        customerAppLanding: resolve(__dirname, 'customer-app/index.html'),
        customerApp: resolve(__dirname, 'customer-app/app.html'),
        customerAppSocial: resolve(__dirname, 'customer-app/social.html'),
      },

      output: {
        // Chunk naming
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',

        // Manual chunks for better caching
        manualChunks: {
          // Vendor chunk for external libraries
          vendor: [],
          // Isolate Three.js — only loaded on intelligence page
          three: ['three'],
        },
      },
    },

    // Target modern browsers
    target: 'es2020',

    // CSS code splitting
    cssCodeSplit: true,
  },

  // Dev server configuration
  server: {
    port: 5173,
    open: false,
    cors: true,
    // Handle /a/{slug} routes for customer app
    proxy: {},
  },

  // Plugin to rewrite /a/* routes to customer app
  plugins: [
    {
      name: 'customer-app-rewrite',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Extract slug from /a/{slug} pattern
          const match = req.url && req.url.match(/^\/a\/([^\/\?]+)(\/app|\/social|\/checkin)?\/?(\?.*)?$/);
          if (match) {
            const slug = match[1];
            const subPath = match[2];
            const queryString = match[3] || '';

            // Rewrite to customer app with slug as query param
            let targetPage = 'index.html';
            let extraParams = '';
            if (subPath === '/app') targetPage = 'app.html';
            else if (subPath === '/social') targetPage = 'social.html';
            else if (subPath === '/checkin') { targetPage = 'app.html'; extraParams = '&action=checkin'; }
            const separator = queryString ? '&' : '?';
            req.url = `/customer-app/${targetPage}${queryString}${separator}slug=${slug}${extraParams}`;
          }
          next();
        });
      },
    },
  ],

  // Preview server (for testing production build)
  preview: {
    port: 4173,
  },

  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      '@app': resolve(__dirname, './app'),
      '@i18n': resolve(__dirname, './i18n'),
    },
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [],
    exclude: [],
  },
});
