/**
 * Royalty Customer App Service Worker
 * Provides offline support and caching for the PWA
 */

const CACHE_NAME = 'royalty-rewards-v2';
const STATIC_CACHE = 'royalty-static-v2';
const DYNAMIC_CACHE = 'royalty-dynamic-v2';

// Static assets to cache on install
const STATIC_ASSETS = [
    '/customer-app/app.html',
    '/customer-app/app.css',
    '/customer-app/app.js',
    '/customer-app/social.html',
    '/customer-app/social.css',
    '/customer-app/social.js',
    '/customer-app/manifest.json',
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
                    // Offline - serve from cache or offline page
                    return caches.match(request)
                        .then(cachedResponse => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            // Return the app shell for any unmatched navigation
                            return caches.match('/customer-app/app.html');
                        });
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
            .catch(() => {
                return caches.match(request);
            })
    );
});

// Helper: Check if URL is a static asset
function isStaticAsset(pathname) {
    return /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)$/.test(pathname);
}

// Helper: Fetch and cache a request
function fetchAndCache(request, cacheName) {
    return fetch(request)
        .then(response => {
            if (response.ok) {
                const responseClone = response.clone();
                caches.open(cacheName)
                    .then(cache => cache.put(request, responseClone));
            }
            return response;
        });
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
