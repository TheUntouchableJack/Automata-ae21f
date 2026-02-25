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

        // Error pages
        error404: resolve(__dirname, '404.html'),
        error500: resolve(__dirname, '500.html'),

        // App pages
        login: resolve(__dirname, 'app/login.html'),
        signup: resolve(__dirname, 'app/signup.html'),
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

        // Customer-facing app
        customerAppLanding: resolve(__dirname, 'customer-app/index.html'),
        customerApp: resolve(__dirname, 'customer-app/app.html'),
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
          const match = req.url && req.url.match(/^\/a\/([^\/\?]+)(\/app)?\/?(\?.*)?$/);
          if (match) {
            const slug = match[1];
            const isAppPage = match[2] === '/app';
            const queryString = match[3] || '';

            // Rewrite to customer app with slug as query param
            const targetPage = isAppPage ? 'app.html' : 'index.html';
            const separator = queryString ? '&' : '?';
            req.url = `/customer-app/${targetPage}${queryString}${separator}slug=${slug}`;
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
