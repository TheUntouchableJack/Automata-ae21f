// Firebase Cloud Messaging — must be first in service worker
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCtCO-WrPRsNhHA_YHrlZB5yUhH41FRwwo",
    projectId: "royalty-rewards-23f4f",
    messagingSenderId: "238839427409",
    appId: "1:238839427409:web:a69d43d4a404f814872370"
});

const fcmMessaging = firebase.messaging();

// Handle background push notifications (app not in foreground)
fcmMessaging.onBackgroundMessage((payload) => {
    console.log('[SW] Background message:', payload);
    if (payload.data && !payload.notification) {
        const title = payload.data.title || 'Royalty Rewards';
        const options = {
            body: payload.data.body || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag: payload.data.tag || 'royalty-notification',
            data: { url: payload.data.url || '/customer-app/app.html' }
        };
        self.registration.showNotification(title, options);
    }
});

/**
 * Royalty Customer App Service Worker
 * Provides offline support and caching for the PWA
 */

// ⚠️ Bump this generation on every client release. The fetch handler serves
// cache-first keyed on the FULL URL, so a returning PWA user keeps the old
// social.js/social.css until the cache name changes and the old caches are
// evicted — a ?v= bump in the HTML alone is not enough once the HTML itself is
// cached.
const CACHE_NAME = 'royalty-rewards-v10';
const STATIC_CACHE = 'royalty-static-v10';
const DYNAMIC_CACHE = 'royalty-dynamic-v10';

// Static assets to cache on install.
//
// ⚠️ cache.addAll() is ALL-OR-NOTHING: one 404 in this list rejects the whole
// install and the service worker never activates. Every entry must exist.
//
// The social app precached /customer-app/manifest.json — the LOYALTY manifest,
// which describes a different app entirely ("Royalty Rewards", start_url
// app.html, "Scan to Earn" shortcuts). ViibeView's own manifest is the one the
// page links to and the one worth having offline.
const STATIC_ASSETS = [
    '/customer-app/app.html',
    '/customer-app/app.css',
    // '/customer-app/app.js' was removed on 2026-09-04: no HTML ever loaded it,
    // and it was the only caller of several RPCs revoked in 20260904000005,
    // which made it read like live code in a caller search. Deleting the file
    // and this line MUST happen together — see the all-or-nothing note above.
    '/customer-app/social.html',
    '/customer-app/social.css',
    '/customer-app/social.js',
    '/customer-app/manifest.json',
    '/customer-app/viibeview-manifest.json',
    '/customer-app/index.html'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Static assets cached');
                return self.skipWaiting();
            })
            .catch(err => {
                console.error('[SW] Failed to cache static assets:', err);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
                        .map(name => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Service worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip Supabase API calls - always go to network
    if (url.hostname.includes('supabase')) {
        return;
    }

    // Skip anything not served by this origin — Google Fonts, jsDelivr, tiles.
    //
    // Not an optimisation: re-issuing a cross-origin request through fetch()
    // CHANGES WHICH CSP DIRECTIVE GOVERNS IT. A <link rel="stylesheet"> to
    // fonts.googleapis.com is checked against style-src, which allows it; the
    // same URL fetched from inside a service worker is checked against
    // connect-src, which does not list it. So this handler took a request the
    // page was allowed to make and turned it into one the browser refused —
    // "Refused to connect because it violates the document's Content Security
    // Policy" — and then the .catch() below returned an uncached undefined,
    // which is the "Failed to convert value to 'Response'" TypeError.
    //
    // Returning without calling respondWith() hands the request back to the
    // browser untouched, which is what should have happened all along.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Handle navigation requests (HTML pages)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Clone and cache successful responses
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(DYNAMIC_CACHE)
                            .then(cache => cache.put(request, responseClone));
                    }
                    return response;
                })
                .catch(() => {
                    // Offline - serve from cache or the matching app shell.
                    //
                    // Two bugs lived here. The shell was hardcoded to
                    // app.html — the LOYALTY app — so a social-app URL fell
                    // back to a completely different product's markup. And
                    // caches.match() resolves undefined on a miss, so
                    // respondWith(undefined) threw "Failed to convert value to
                    // 'Response'" instead of degrading. Every branch now ends
                    // in a real Response.
                    const shell = url.pathname.includes('social')
                        ? '/customer-app/social.html'
                        : '/customer-app/app.html';

                    return caches.match(request)
                        .then(cachedResponse => cachedResponse || caches.match(shell))
                        .then(shellResponse => shellResponse || offlineResponse());
                })
        );
        return;
    }

    // Handle static assets (CSS, JS, images)
    if (isStaticAsset(url.pathname)) {
        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {
                    if (cachedResponse) {
                        // Return cached version, but also fetch update in background
                        fetchAndCache(request, STATIC_CACHE);
                        return cachedResponse;
                    }
                    return fetchAndCache(request, STATIC_CACHE);
                })
        );
        return;
    }

    // Default: network first, cache fallback
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(DYNAMIC_CACHE)
                        .then(cache => cache.put(request, responseClone));
                }
                return response;
            })
            .catch(() =>
                // Same undefined-is-not-a-Response trap as the navigation
                // branch: a cache miss here used to reject the FetchEvent.
                caches.match(request).then(cached => cached || offlineResponse())
            )
    );
});

// Last resort when the network is gone and nothing is cached. respondWith()
// requires a Response — handing it undefined throws a TypeError that surfaces
// as an unhandled rejection and leaves the request failed rather than degraded.
function offlineResponse() {
    return new Response('', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain' }
    });
}

// Helper: Check if URL is a static asset
function isStaticAsset(pathname) {
    return /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)$/.test(pathname);
}

// Helper: Fetch and cache a request.
// Never rejects: a rejected promise handed to respondWith() fails the request
// outright instead of degrading, which is how an offline CSS file used to take
// the whole response down.
function fetchAndCache(request, cacheName) {
    return fetch(request)
        .then(response => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(cacheName)
                    .then(cache => cache.put(request, responseClone));
            }
            return response;
        })
        .catch(() => caches.match(request).then(cached => cached || offlineResponse()));
}

// Handle push notifications (future feature)
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag || 'default',
        data: {
            url: data.url || '/customer-app/app.html'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Royalty Rewards', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const url = event.notification.data?.url || '/customer-app/app.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Focus existing window if available
                for (const client of windowClients) {
                    if (client.url.includes('/customer-app/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Background sync for offline actions (future feature)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-points') {
        event.waitUntil(syncPendingPoints());
    }
});

// Sync pending points transactions when back online
async function syncPendingPoints() {
    // Future: Sync offline point transactions
    console.log('[SW] Syncing pending points transactions');
}
