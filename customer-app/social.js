/**
 * Social Venue Discovery App
 * Customer-facing app for discovering venues via map + video feed
 */

// ===== Config =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg2MjQzNTEsImV4cCI6MjA1NDIwMDM1MX0.K1C2Ij0a-sN4mhGhN5S8P4JlONsOxMKEajr7t7Gfjng';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== State =====
let currentApp = null;
let appSlug = null;
let venues = [];
let feedItems = [];
let feedOffset = 0;
let feedLoading = false;
let feedHasMore = true;
let activeCategory = null;
let activeTab = 'feed';
let userLocation = null;
let map = null;
let markers = [];
let selectedVenueId = null;
let searchTimeout = null;

const FEED_PAGE_SIZE = 20;

// ===== Initialization =====
async function init() {
    // Get slug from URL
    const params = new URLSearchParams(window.location.search);
    appSlug = params.get('slug');

    if (!appSlug) {
        showEmptyState('App not found');
        return;
    }

    try {
        // Load app data
        const { data: app, error } = await supabaseClient
            .from('customer_apps')
            .select('*')
            .eq('slug', appSlug)
            .eq('is_active', true)
            .maybeSingle();

        if (error || !app) {
            showEmptyState('App not found');
            return;
        }

        currentApp = app;
        applyBranding(app);
        document.title = `${app.name} - Discover`;

        // Request geolocation
        requestLocation();

        // Load venues for map
        await loadVenues();

        // Load initial feed
        await loadFeed();

        // Setup event listeners
        setupEventListeners();

    } catch (err) {
        console.error('Init error:', err);
        showEmptyState('Something went wrong');
    }
}

// ===== Branding =====
function applyBranding(app) {
    const branding = app.branding || {};
    const primary = branding.primary_color || '#6366f1';
    const secondary = branding.secondary_color || '#1e293b';

    document.documentElement.style.setProperty('--app-primary', primary);
    document.documentElement.style.setProperty('--app-secondary', secondary);

    // Header
    const appName = document.getElementById('header-app-name');
    const appLogo = document.getElementById('header-logo-img');
    const logoFallback = document.getElementById('header-logo-fallback');
    if (appName) appName.textContent = app.name;
    if (appLogo && branding.logo_url) {
        appLogo.src = branding.logo_url;
        appLogo.style.display = 'block';
        if (logoFallback) logoFallback.style.display = 'none';
    }
}

// ===== Geolocation =====
function requestLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            // Re-render feed with distances
            renderFeed();
            // Center map if it's initialized
            if (map && activeTab === 'map') {
                map.setView([userLocation.lat, userLocation.lng], 13);
            }
        },
        (err) => {
            console.warn('Geolocation denied:', err.message);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
}

// ===== Venues =====
async function loadVenues() {
    if (!currentApp) return;

    const { data, error } = await supabaseClient.rpc('get_venues_for_map', {
        p_app_id: currentApp.id
    });

    if (error) {
        console.error('Failed to load venues:', error);
        return;
    }

    venues = data || [];
}

function getVenueById(id) {
    return venues.find(v => v.id === id);
}

// ===== Feed =====
async function loadFeed(append = false) {
    if (feedLoading || (!append && !feedHasMore)) return;
    feedLoading = true;

    if (!append) {
        feedOffset = 0;
        feedItems = [];
        feedHasMore = true;
    }

    showFeedLoading(true);

    const { data, error } = await supabaseClient.rpc('get_venue_feed', {
        p_app_id: currentApp.id,
        p_category: activeCategory,
        p_limit: FEED_PAGE_SIZE,
        p_offset: feedOffset
    });

    feedLoading = false;
    showFeedLoading(false);

    if (error) {
        console.error('Failed to load feed:', error);
        return;
    }

    if (!data || data.length < FEED_PAGE_SIZE) {
        feedHasMore = false;
    }

    if (append) {
        feedItems = [...feedItems, ...data];
    } else {
        feedItems = data || [];
    }

    feedOffset += (data || []).length;
    renderFeed();
}

function renderFeed() {
    const container = document.getElementById('feed-container');
    const emptyState = document.getElementById('feed-empty');
    if (!container) return;

    if (feedItems.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = feedItems.map(item => {
        const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, item.venue_latitude, item.venue_longitude) : null;
        const distanceText = distance !== null ? `(${distance < 1 ? (distance * 5280).toFixed(0) + ' ft' : distance.toFixed(1) + ' mi'} away)` : '';
        const locationText = [item.venue_city, item.venue_state].filter(Boolean).join(', ');
        const isVideo = item.media_type === 'video';
        const profileImg = getVenueById(item.venue_id)?.profile_image_url;

        return `
            <div class="feed-card" data-media-id="${item.id}" data-venue-id="${item.venue_id}">
                <div class="feed-card-header">
                    <div class="feed-venue-info" onclick="openVenueSheet('${item.venue_id}')">
                        <div class="venue-avatar">
                            ${profileImg ? `<img src="${profileImg}" alt="">` : `<div class="venue-avatar-placeholder">${(item.venue_name || '?')[0]}</div>`}
                        </div>
                        <div class="venue-meta">
                            <div class="venue-handle">${item.venue_handle ? '@' + escapeHtml(item.venue_handle) : escapeHtml(item.venue_name)}</div>
                            <div class="venue-location">${escapeHtml(locationText)} ${distanceText}</div>
                        </div>
                    </div>
                    <button class="feed-more-btn" onclick="showVenueOptions('${item.venue_id}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                </div>
                <div class="feed-media" onclick="toggleVideoPlay(this)">
                    ${isVideo ? `
                        <video src="${item.url}" poster="${item.thumbnail_url || ''}" playsinline muted preload="none" loop></video>
                        <div class="video-play-btn">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                        ${item.duration_seconds ? `<span class="video-duration">${formatDuration(item.duration_seconds)}</span>` : ''}
                    ` : `
                        <img src="${item.url}" alt="${escapeHtml(item.caption || '')}" loading="lazy">
                    `}
                </div>
                ${item.caption ? `<div class="feed-caption"><strong>${escapeHtml(item.venue_name)}</strong> ${escapeHtml(item.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // Setup intersection observer for video autoplay
    setupVideoObserver();
}

function showFeedLoading(show) {
    const shimmer = document.getElementById('feed-shimmer');
    if (shimmer) shimmer.style.display = show ? 'block' : 'none';
}

// ===== Map =====
function initMap() {
    if (map) return; // Already initialized

    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) return;

    const center = userLocation
        ? [userLocation.lat, userLocation.lng]
        : venues.length > 0
            ? [venues[0].latitude, venues[0].longitude]
            : [34.0195, -118.4912]; // Default: Santa Monica

    map = L.map('map-container', {
        zoomControl: false,
        attributionControl: false
    }).setView(center, 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    // Add attribution in a less intrusive way
    L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('&copy; <a href="https://openstreetmap.org">OSM</a>')
        .addTo(map);

    renderMapPins();
}

function renderMapPins() {
    if (!map) return;

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const filteredVenues = activeCategory
        ? venues.filter(v => v.category === activeCategory)
        : venues;

    filteredVenues.forEach((venue, index) => {
        if (!venue.latitude || !venue.longitude) return;

        const pinNumber = index + 1;
        const icon = L.divIcon({
            className: 'map-pin-wrapper',
            html: `<div class="map-pin ${venue.is_featured ? 'featured' : ''}">${pinNumber}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([venue.latitude, venue.longitude], { icon })
            .addTo(map)
            .on('click', () => selectVenueOnMap(venue));

        markers.push(marker);
    });

    // Fit bounds if we have venues
    if (filteredVenues.length > 0) {
        const bounds = L.latLngBounds(filteredVenues.map(v => [v.latitude, v.longitude]));
        if (!userLocation) {
            map.fitBounds(bounds, { padding: [40, 40] });
        }
    }
}

function selectVenueOnMap(venue) {
    selectedVenueId = venue.id;
    const card = document.getElementById('venue-card-bottom');
    if (!card) return;

    const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
    const distanceText = distance !== null ? ` &middot; ${distance.toFixed(1)} mi` : '';

    card.innerHTML = `
        <div class="venue-bottom-card" onclick="openVenueSheet('${venue.id}')">
            <div class="venue-bottom-thumb">
                ${venue.cover_image_url
                    ? `<img src="${venue.cover_image_url}" alt="">`
                    : `<div class="venue-bottom-thumb-placeholder">${(venue.name || '?')[0]}</div>`}
            </div>
            <div class="venue-bottom-info">
                <div class="venue-bottom-name">${escapeHtml(venue.name)}</div>
                <div class="venue-bottom-address">${escapeHtml([venue.city, venue.state].filter(Boolean).join(', '))}${distanceText}</div>
                <div class="venue-bottom-rating">
                    ${renderStars(venue.average_rating || 0)}
                    <span class="venue-rating-text">${venue.average_rating || 0}</span>
                    ${venue.review_count ? `<span class="venue-review-count">&middot; ${venue.review_count} Reviews</span>` : ''}
                </div>
            </div>
        </div>
    `;
    card.classList.add('visible');
}

function centerOnMe() {
    if (!map || !userLocation) {
        // Request location again
        requestLocation();
        return;
    }
    map.setView([userLocation.lat, userLocation.lng], 14, { animate: true });
}

// ===== Search =====
function handleSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }

    const q = query.toLowerCase();
    const results = venues.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.handle && v.handle.toLowerCase().includes(q)) ||
        (v.category && v.category.toLowerCase().includes(q)) ||
        (v.city && v.city.toLowerCase().includes(q))
    );

    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">No venues found</div>';
        return;
    }

    resultsContainer.innerHTML = results.map(venue => {
        const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
        const distanceText = distance !== null ? `${distance.toFixed(1)} mi` : '';

        return `
            <div class="search-result-card" onclick="goToVenueOnMap('${venue.id}')">
                <div class="search-result-thumb">
                    ${venue.profile_image_url
                        ? `<img src="${venue.profile_image_url}" alt="">`
                        : `<div class="search-result-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="search-result-info">
                    <div class="search-result-name">${escapeHtml(venue.name)}</div>
                    <div class="search-result-meta">
                        <span class="search-result-category">${escapeHtml(venue.category || '')}</span>
                        ${distanceText ? `<span class="search-result-distance">${distanceText}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function goToVenueOnMap(venueId) {
    const venue = getVenueById(venueId);
    if (!venue) return;

    switchTab('map');
    setTimeout(() => {
        if (map && venue.latitude && venue.longitude) {
            map.setView([venue.latitude, venue.longitude], 15, { animate: true });
            selectVenueOnMap(venue);
        }
    }, 300);
}

// ===== Venue Detail Sheet =====
async function openVenueSheet(venueId) {
    const sheet = document.getElementById('venue-sheet');
    const backdrop = document.getElementById('venue-sheet-backdrop');
    if (!sheet || !backdrop) return;

    // Load full venue detail
    const { data, error } = await supabaseClient.rpc('get_venue_detail', { p_venue_id: venueId });
    if (error || !data || data.length === 0) {
        console.error('Failed to load venue detail:', error);
        return;
    }

    const venue = data[0];

    // Load venue media
    const { data: media } = await supabaseClient
        .from('venue_media')
        .select('id, url, thumbnail_url, media_type, caption')
        .eq('venue_id', venueId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(12);

    const sheetContent = document.getElementById('venue-sheet-content');
    if (!sheetContent) return;

    const distance = userLocation && venue.latitude ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
    const mapsUrl = venue.address_line1 ? `https://maps.google.com/?q=${encodeURIComponent([venue.address_line1, venue.city, venue.state].filter(Boolean).join(', '))}` : null;

    sheetContent.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-header">
            <div class="sheet-venue-identity">
                <div class="sheet-venue-avatar">
                    ${venue.profile_image_url ? `<img src="${venue.profile_image_url}" alt="">` : `<div class="sheet-avatar-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div>
                    <h2 class="sheet-venue-name">${escapeHtml(venue.name)}</h2>
                    ${venue.handle ? `<div class="sheet-venue-handle">@${escapeHtml(venue.handle)}</div>` : ''}
                </div>
            </div>
            <button class="sheet-close-btn" onclick="closeVenueSheet()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>

        <div class="sheet-rating">
            ${renderStars(venue.average_rating || 0)}
            <span class="sheet-rating-text">${venue.average_rating || 0}</span>
            ${venue.review_count ? `<span class="sheet-review-count">${venue.review_count} reviews</span>` : ''}
            ${distance !== null ? `<span class="sheet-distance">&middot; ${distance.toFixed(1)} mi away</span>` : ''}
        </div>

        ${venue.cover_image_url ? `<img class="sheet-cover" src="${venue.cover_image_url}" alt="">` : ''}

        ${venue.description ? `<p class="sheet-description">${escapeHtml(venue.description)}</p>` : ''}

        <div class="sheet-details">
            ${venue.address_line1 ? `
                <div class="sheet-detail-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <div>
                        <div>${escapeHtml(venue.address_line1)}</div>
                        <div class="sheet-detail-sub">${escapeHtml([venue.city, venue.state, venue.postal_code].filter(Boolean).join(', '))}</div>
                    </div>
                    ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" class="sheet-directions-btn">Directions</a>` : ''}
                </div>
            ` : ''}
            ${venue.phone ? `
                <a href="tel:${venue.phone}" class="sheet-detail-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span>${escapeHtml(venue.phone)}</span>
                </a>
            ` : ''}
            ${venue.website ? `
                <a href="${venue.website}" target="_blank" class="sheet-detail-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    <span>${escapeHtml(venue.website)}</span>
                </a>
            ` : ''}
            ${venue.instagram_handle ? `
                <a href="https://instagram.com/${venue.instagram_handle}" target="_blank" class="sheet-detail-row">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
                    <span>@${escapeHtml(venue.instagram_handle)}</span>
                </a>
            ` : ''}
        </div>

        ${venue.tags && venue.tags.length > 0 ? `
            <div class="sheet-tags">
                ${venue.tags.map(t => `<span class="sheet-tag">${escapeHtml(t)}</span>`).join('')}
            </div>
        ` : ''}

        ${media && media.length > 0 ? `
            <div class="sheet-media-section">
                <h3 class="sheet-section-title">Media</h3>
                <div class="sheet-media-grid">
                    ${media.map(m => `
                        <div class="sheet-media-item" onclick="playMediaFromSheet('${m.url}', '${m.media_type}')">
                            <img src="${m.thumbnail_url || m.url}" alt="${escapeHtml(m.caption || '')}">
                            ${m.media_type === 'video' ? '<div class="sheet-media-play"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>' : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `;

    sheet.classList.add('visible');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeVenueSheet() {
    const sheet = document.getElementById('venue-sheet');
    const backdrop = document.getElementById('venue-sheet-backdrop');
    if (sheet) sheet.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.style.overflow = '';
}

function playMediaFromSheet(url, type) {
    if (type === 'video') {
        // Open video in a simple fullscreen overlay
        const overlay = document.createElement('div');
        overlay.className = 'video-fullscreen-overlay';
        overlay.innerHTML = `
            <video src="${url}" autoplay playsinline controls></video>
            <button class="video-fullscreen-close" onclick="this.parentElement.remove()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2"/></svg>
            </button>
        `;
        document.body.appendChild(overlay);
    }
}

// ===== Tab Navigation =====
function switchTab(tabId) {
    activeTab = tabId;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Update views
    document.querySelectorAll('.tab-view').forEach(view => {
        view.classList.toggle('active', view.id === `tab-${tabId}`);
    });

    // Initialize map on first visit
    if (tabId === 'map' && !map) {
        setTimeout(() => initMap(), 100);
    }

    // Invalidate map size when switching to map tab
    if (tabId === 'map' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// ===== Category Filter =====
function setCategory(category) {
    activeCategory = category || null;

    // Update pill active state
    document.querySelectorAll('.pill').forEach(pill => {
        const pillCat = pill.dataset.category || null;
        pill.classList.toggle('active', pillCat === activeCategory);
    });

    // Reload feed with new category
    loadFeed(false);

    // Update map pins if map is visible
    if (map) renderMapPins();
}

// ===== Video Handling =====
function toggleVideoPlay(mediaEl) {
    const video = mediaEl.querySelector('video');
    if (!video) return;

    const playBtn = mediaEl.querySelector('.video-play-btn');

    if (video.paused) {
        // Pause all other videos
        document.querySelectorAll('.feed-media video').forEach(v => {
            if (v !== video) { v.pause(); v.muted = true; }
        });
        video.play();
        video.muted = false;
        if (playBtn) playBtn.style.display = 'none';
    } else {
        video.pause();
        if (playBtn) playBtn.style.display = 'flex';
    }
}

function setupVideoObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;

            if (entry.isIntersecting) {
                video.play().catch(() => {});
            } else {
                video.pause();
                video.muted = true;
                const playBtn = entry.target.querySelector('.video-play-btn');
                if (playBtn) playBtn.style.display = 'flex';
            }
        });
    }, { threshold: 0.6 });

    document.querySelectorAll('.feed-media').forEach(el => {
        if (el.querySelector('video')) observer.observe(el);
    });
}

// ===== Infinite Scroll =====
function setupInfiniteScroll() {
    const feedView = document.getElementById('tab-feed');
    if (!feedView) return;

    window.addEventListener('scroll', () => {
        if (activeTab !== 'feed' || feedLoading || !feedHasMore) return;

        const scrollBottom = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;

        if (docHeight - scrollBottom < 400) {
            loadFeed(true);
        }
    });
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Bottom nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = e.currentTarget.dataset.tab;
            if (tab) switchTab(tab);
        });
    });

    // Category pills
    document.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
            setCategory(pill.dataset.category || null);
        });
    });

    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => handleSearch(e.target.value.trim()), 300);
        });
    }

    // Map search input
    const mapSearchInput = document.getElementById('map-search-input');
    if (mapSearchInput) {
        mapSearchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => handleMapSearch(e.target.value.trim()), 300);
        });
    }

    // Center on me button
    const centerBtn = document.getElementById('center-on-me-btn');
    if (centerBtn) {
        centerBtn.addEventListener('click', centerOnMe);
    }

    // Venue sheet backdrop close
    const backdrop = document.getElementById('venue-sheet-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', closeVenueSheet);
    }

    // Infinite scroll
    setupInfiniteScroll();
}

function handleMapSearch(query) {
    const dropdown = document.getElementById('map-search-results');
    if (!dropdown) return;

    if (!query || query.length < 2) {
        dropdown.classList.remove('visible');
        return;
    }

    const q = query.toLowerCase();
    const results = venues.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.handle && v.handle.toLowerCase().includes(q)) ||
        (v.category && v.category.toLowerCase().includes(q))
    ).slice(0, 5);

    if (results.length === 0) {
        dropdown.classList.remove('visible');
        return;
    }

    dropdown.innerHTML = results.map(v => `
        <div class="map-search-result" onclick="goToVenueOnMap('${v.id}'); document.getElementById('map-search-results').classList.remove('visible');">
            <span class="map-search-name">${escapeHtml(v.name)}</span>
            <span class="map-search-category">${escapeHtml(v.category || '')}</span>
        </div>
    `).join('');

    dropdown.classList.add('visible');
}

function showVenueOptions(venueId) {
    // For now, just open the venue sheet
    openVenueSheet(venueId);
}

// ===== Utility Functions =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function calcDistance(lat1, lon1, lat2, lon2) {
    // Haversine formula — returns distance in miles
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    let html = '';
    for (let i = 0; i < full; i++) html += '<span class="star full">&#9733;</span>';
    if (half) html += '<span class="star half">&#9733;</span>';
    for (let i = 0; i < empty; i++) html += '<span class="star empty">&#9734;</span>';
    return html;
}

function showEmptyState(msg) {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;color:#64748b;">
            <div style="text-align:center;padding:20px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px;display:block;color:#94a3b8;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
                <p>${msg}</p>
            </div>
        </div>
    `;
}

// ===== Start =====
document.addEventListener('DOMContentLoaded', init);
