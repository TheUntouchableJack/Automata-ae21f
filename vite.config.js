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
        publicRoadmap: resolve(__dirname, 'roadmap.html'),

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
        // --- Dev parity for the Netlify domain-router edge function ---
        // Public anon creds (same values shipped in the client bundle).
        const DEV_SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
        const DEV_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';
        const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|json|txt|xml|webmanifest|mp4|webm|pdf)$/i;
        const hostCache = new Map(); // host -> {slug, appType} | null

        async function resolveHostToApp(host) {
          if (hostCache.has(host)) return hostCache.get(host);
          let value = null;
          try {
            const res = await fetch(`${DEV_SUPABASE_URL}/rest/v1/rpc/get_app_by_domain`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: DEV_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${DEV_SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({ p_host: host }),
            });
            if (res.ok) {
              const rows = await res.json();
              const row = Array.isArray(rows) ? rows[0] : rows;
              if (row && row.slug) value = { slug: row.slug, appType: row.app_type || 'loyalty' };
            }
          } catch (_e) {
            value = null;
          }
          hostCache.set(host, value);
          return value;
        }

        function targetFor(appType, pathname) {
          const p = (pathname || '/').replace(/\/+$/, '');
          if (p.endsWith('/checkin')) return { page: 'app.html', extra: '&action=checkin' };
          if (p.endsWith('/app')) return { page: 'app.html', extra: '' };
          if (p.endsWith('/social')) return { page: 'social.html', extra: '' };
          if (appType === 'social') return { page: 'social.html', extra: '' };
          return { page: 'index.html', extra: '' };
        }

        // Host-based rewrite: simulate a custom domain via ?host= override or a
        // <label>.localhost hostname, resolved through the same RPC as prod.
        server.middlewares.use(async (req, res, next) => {
          const urlObj = new URL(req.url, 'http://localhost');
          const pathname = urlObj.pathname;
          const hostOverride = urlObj.searchParams.get('host');
          const hostHeader = (req.headers.host || '').split(':')[0];
          const simulatedHost = hostOverride
            || (hostHeader.endsWith('.localhost') && hostHeader !== 'localhost' ? hostHeader : null);

          if (
            simulatedHost &&
            !ASSET_RE.test(pathname) &&
            !pathname.startsWith('/customer-app/') &&
            !pathname.startsWith('/app/') &&
            !pathname.startsWith('/@') &&
            !pathname.startsWith('/node_modules/') &&
            !pathname.startsWith('/src/')
          ) {
            const resolved = await resolveHostToApp(simulatedHost);
            if (resolved) {
              const { page, extra } = targetFor(resolved.appType, pathname);
              // Preserve the ?host override so internal nav keeps simulating the domain.
              const keepHost = hostOverride ? `&host=${encodeURIComponent(hostOverride)}` : '';
              req.url = `/customer-app/${page}?slug=${encodeURIComponent(resolved.slug)}${extra}${keepHost}`;
              return next();
            }
          }
          next();
        });

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

          // Rewrite /blog/{slug} → /blog/post.html?slug={slug}
          const blogMatch = req.url && req.url.match(/^\/blog\/([^\/\?]+)\/?(\?.*)?$/);
          if (blogMatch && blogMatch[1] !== 'index.html' && blogMatch[1] !== 'post.html' && !blogMatch[1].includes('.')) {
            const slug = blogMatch[1];
            const queryString = blogMatch[2] || '';
            const separator = queryString ? '&' : '?';
            req.url = `/blog/post.html${queryString}${separator}slug=${slug}`;
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
