/**
 * Social Venue Discovery App
 * Customer-facing app for discovering venues via map + video feed
 */

// ===== Config =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

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
let isOwner = false;
let ownerOrgId = null;
let selectedPostFile = null;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimerInterval = null;
let recordingStartTime = 0;
let venuePageVenueId = null;
let venuePageFeed = [];
let venuePageOffset = 0;
let venuePageHasMore = true;
let venuePageLoading = false;
let venuePageScrollHandler = null;

const FEED_PAGE_SIZE = 20;

// ===== Demo Venues (for preview when DB has no venues) =====
const DEMO_VENUES = [
    {
        id: 'demo-1',
        name: 'Skyline Rooftop Lounge',
        handle: 'skylinela',
        category: 'rooftop',
        latitude: 34.0195,
        longitude: -118.4912,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '1550 Ocean Ave',
        postal_code: '90401',
        average_rating: 4.6,
        review_count: 128,
        is_featured: true,
        description: 'Elevated cocktails with panoramic ocean views. Live DJ sets every Friday & Saturday.',
        tags: ['rooftop', 'cocktails', 'ocean view', 'live dj'],
        phone: '(310) 555-0101',
        website: 'https://example.com',
        hours: {
            monday: { open: '16:00', close: '00:00' },
            tuesday: { open: '16:00', close: '00:00' },
            wednesday: { open: '16:00', close: '00:00' },
            thursday: { open: '16:00', close: '01:00' },
            friday: { open: '15:00', close: '02:00' },
            saturday: { open: '12:00', close: '02:00' },
            sunday: { open: '12:00', close: '22:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-2',
        name: 'Velvet Underground',
        handle: 'velvetdtla',
        category: 'clubs',
        latitude: 34.0407,
        longitude: -118.2468,
        city: 'Los Angeles',
        state: 'CA',
        address_line1: '420 S Main St',
        postal_code: '90013',
        average_rating: 4.3,
        review_count: 256,
        description: 'Downtown LA\'s premier underground club. House & techno nights.',
        tags: ['club', 'techno', 'house music', 'downtown'],
        hours: {
            monday: null,
            tuesday: null,
            wednesday: { open: '21:00', close: '02:00' },
            thursday: { open: '21:00', close: '02:00' },
            friday: { open: '22:00', close: '04:00' },
            saturday: { open: '22:00', close: '04:00' },
            sunday: null
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-3',
        name: 'The Golden Bear',
        handle: 'goldenbear',
        category: 'bars',
        latitude: 34.0259,
        longitude: -118.4961,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '306 Santa Monica Blvd',
        postal_code: '90401',
        average_rating: 4.1,
        review_count: 89,
        description: 'Craft cocktails and local brews in a cozy neighborhood setting.',
        tags: ['craft cocktails', 'beer', 'casual'],
        hours: {
            monday: { open: '17:00', close: '00:00' },
            tuesday: { open: '17:00', close: '00:00' },
            wednesday: { open: '17:00', close: '00:00' },
            thursday: { open: '17:00', close: '01:00' },
            friday: { open: '16:00', close: '02:00' },
            saturday: { open: '14:00', close: '02:00' },
            sunday: { open: '14:00', close: '22:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-4',
        name: 'Nobu Malibu',
        handle: 'nobumalibu',
        category: 'restaurants',
        latitude: 34.0381,
        longitude: -118.6923,
        city: 'Malibu',
        state: 'CA',
        address_line1: '22706 Pacific Coast Hwy',
        postal_code: '90265',
        average_rating: 4.8,
        review_count: 412,
        is_featured: true,
        description: 'World-renowned Japanese cuisine with oceanfront dining.',
        tags: ['japanese', 'sushi', 'fine dining', 'oceanfront'],
        phone: '(310) 555-0104',
        website: 'https://example.com',
        hours: {
            monday: { open: '17:00', close: '22:00' },
            tuesday: { open: '17:00', close: '22:00' },
            wednesday: { open: '17:00', close: '22:00' },
            thursday: { open: '17:00', close: '22:00' },
            friday: { open: '17:00', close: '23:00' },
            saturday: { open: '12:00', close: '23:00' },
            sunday: { open: '12:00', close: '21:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    },
    {
        id: 'demo-5',
        name: 'Dusk Lounge',
        handle: 'dusklounge',
        category: 'lounges',
        latitude: 34.0093,
        longitude: -118.4974,
        city: 'Santa Monica',
        state: 'CA',
        address_line1: '2000 Main St',
        postal_code: '90405',
        average_rating: 4.4,
        review_count: 67,
        description: 'Ambient lounge with craft cocktails, hookah, and weekend live music.',
        tags: ['lounge', 'hookah', 'live music', 'cocktails'],
        hours: {
            monday: null,
            tuesday: { open: '18:00', close: '00:00' },
            wednesday: { open: '18:00', close: '00:00' },
            thursday: { open: '18:00', close: '01:00' },
            friday: { open: '17:00', close: '02:00' },
            saturday: { open: '17:00', close: '02:00' },
            sunday: { open: '16:00', close: '23:00' }
        },
        cover_image_url: null,
        profile_image_url: null,
        media_count: 0,
        is_active: true
    }
];

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
        document.title = `${app.name} - Social`;

        // Check if viewer is the business owner
        await checkOwnerAccess();

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
    if (appName) appName.textContent = 'Social App';
    if (appLogo && branding.logo_url) {
        appLogo.src = branding.logo_url;
        appLogo.style.display = 'block';
        if (logoFallback) logoFallback.style.display = 'none';
    }
}

// ===== Owner Access Check =====
async function checkOwnerAccess() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;

        // Check if this user is an org member for the current app's organization
        const { data: membership } = await supabaseClient
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', session.user.id)
            .eq('organization_id', currentApp.organization_id)
            .maybeSingle();

        if (membership) {
            isOwner = true;
            ownerOrgId = membership.organization_id;
            const postBtn = document.querySelector('.post-btn');
            if (postBtn) postBtn.style.display = '';
        }
    } catch (e) {
        // Not an owner — that's fine, button stays hidden
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
            showLocationBanner();
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
        showToast('Failed to load venues. Pull down to retry.');
        return;
    }

    venues = data || [];

    // Inject demo venues for preview if none loaded from DB
    if (venues.length === 0) {
        venues = DEMO_VENUES;
    }
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
        const locationParts = [item.venue_name, item.venue_city].filter(Boolean);
        const locationText = locationParts.join(', ');
        const isVideo = item.media_type === 'video';

        return `
            <div class="feed-card" data-media-id="${item.id}" data-venue-id="${item.venue_id}">
                <div class="feed-card-header">
                    <div class="feed-venue-info" onclick="openVenuePage('${item.venue_id}')">
                        <div class="venue-avatar">
                            <div class="venue-avatar-placeholder">A</div>
                        </div>
                        <div class="venue-meta">
                            <div class="venue-handle">@Admin</div>
                            <div class="venue-location">${escapeHtml(locationText)}</div>
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
                ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
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
    renderVenueSwimLane();
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

        const icon = L.divIcon({
            className: 'map-pin-wrapper',
            html: `<div class="map-pin ${venue.is_featured ? 'featured' : ''}"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const marker = L.marker([venue.latitude, venue.longitude], { icon })
            .addTo(map)
            .on('click', () => selectVenueOnMap(venue));

        markers.push(marker);
    });

    // Fit bounds if we have venues with valid coordinates
    const geoVenues = filteredVenues.filter(v => v.latitude && v.longitude);
    if (geoVenues.length > 0 && !userLocation) {
        const bounds = L.latLngBounds(geoVenues.map(v => [v.latitude, v.longitude]));
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

function selectVenueOnMap(venue) {
    selectedVenueId = venue.id;

    // Center map on selected venue
    if (map && venue.latitude && venue.longitude) {
        map.setView([venue.latitude, venue.longitude], map.getZoom(), { animate: true });
    }

    // Highlight the card in the swim lane and scroll to it
    const lane = document.getElementById('venue-swim-lane');
    if (!lane) return;

    lane.querySelectorAll('.swim-card').forEach(c => c.classList.remove('active'));
    const activeCard = lane.querySelector(`[data-venue-id="${venue.id}"]`);
    if (activeCard) {
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function renderVenueSwimLane() {
    const lane = document.getElementById('venue-swim-lane');
    if (!lane) return;

    const filteredVenues = activeCategory
        ? venues.filter(v => v.category === activeCategory)
        : venues;

    // Only show venues with coordinates
    const geoVenues = filteredVenues.filter(v => v.latitude && v.longitude);

    if (geoVenues.length === 0) {
        lane.innerHTML = '';
        return;
    }

    lane.innerHTML = geoVenues.map(venue => {
        const distance = userLocation ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude) : null;
        const distanceText = distance !== null ? ` &middot; ${distance.toFixed(1)} mi` : '';
        const isActive = venue.id === selectedVenueId;

        return `
            <div class="swim-card ${isActive ? 'active' : ''}" data-venue-id="${venue.id}" onclick="openVenuePage('${venue.id}')">
                <div class="swim-card-thumb">
                    ${venue.cover_image_url
                        ? `<img src="${venue.cover_image_url}" alt="">`
                        : `<div class="swim-card-thumb-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="swim-card-info">
                    <div class="swim-card-name">${escapeHtml(venue.name)}</div>
                    <div class="swim-card-address">${escapeHtml([venue.city, venue.state].filter(Boolean).join(', '))}${distanceText}</div>
                    <div class="swim-card-rating">
                        ${renderStars(venue.average_rating || 0)}
                        <span class="swim-card-rating-text">${venue.average_rating || 0}</span>
                        ${venue.review_count ? `<span class="swim-card-reviews">&middot; ${venue.review_count}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
        console.error('Failed to load venue detail:', error);
        return;
    }

    const venue = Array.isArray(data) ? data[0] : data;

    // Load venue media
    const { data: media, error: mediaError } = await supabaseClient
        .from('venue_media')
        .select('id, url, thumbnail_url, media_type, caption')
        .eq('venue_id', venueId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(12);

    if (mediaError) console.warn('Failed to load venue media:', mediaError);
    const safeMedia = media || [];

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

        ${safeMedia.length > 0 ? `
            <div class="sheet-media-section">
                <h3 class="sheet-section-title">Media</h3>
                <div class="sheet-media-grid">
                    ${safeMedia.map(m => `
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

// ===== Venue Location Page =====

async function openVenuePage(venueId) {
    const page = document.getElementById('venue-page');
    const backdrop = document.getElementById('venue-page-backdrop');
    if (!page || !backdrop) return;

    venuePageVenueId = venueId;
    venuePageFeed = [];
    venuePageOffset = 0;
    venuePageHasMore = true;
    venuePageLoading = false;

    // Close venue sheet if open
    closeVenueSheet();

    // Show page immediately (content loads inside)
    page.classList.add('visible');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Load venue detail (use local data for demo venues)
    let venue;
    const localVenue = getVenueById(venueId);
    if (localVenue && String(venueId).startsWith('demo-')) {
        venue = localVenue;
    } else {
        const { data, error } = await supabaseClient.rpc('get_venue_detail', { p_venue_id: venueId });
        if (error || !data || (Array.isArray(data) && data.length === 0)) {
            // Fallback to local venue data if RPC fails
            if (localVenue) {
                venue = localVenue;
            } else {
                console.error('Failed to load venue:', error);
                showToast('Could not load venue');
                closeVenuePage();
                return;
            }
        } else {
            venue = Array.isArray(data) ? data[0] : data;
        }
    }

    // Set header title
    const titleEl = document.getElementById('venue-page-title');
    if (titleEl) titleEl.textContent = venue.name;

    // Render hero
    const heroEl = document.getElementById('venue-page-hero');
    if (heroEl) {
        heroEl.innerHTML = venue.cover_image_url
            ? `<img src="${venue.cover_image_url}" alt="${escapeHtml(venue.name)}">`
            : `<div class="venue-page-hero-fallback">${(venue.name || '?')[0]}</div>`;
    }

    // Render identity
    const distance = userLocation && venue.latitude
        ? calcDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude)
        : null;
    const distanceText = distance !== null ? `${distance.toFixed(1)} mi away` : '';
    const locationParts = [venue.city, venue.state].filter(Boolean).join(', ');

    const identityEl = document.getElementById('venue-page-identity');
    if (identityEl) {
        identityEl.innerHTML = `
            <div class="venue-page-identity-row">
                <div class="venue-page-avatar">
                    ${venue.profile_image_url
                        ? `<img src="${venue.profile_image_url}" alt="">`
                        : `<div class="venue-page-avatar-placeholder">${(venue.name || '?')[0]}</div>`}
                </div>
                <div class="venue-page-name-block">
                    <h2 class="venue-page-name">${escapeHtml(venue.name)}</h2>
                    ${venue.handle ? `<div class="venue-page-handle">@${escapeHtml(venue.handle)}</div>` : ''}
                </div>
            </div>
            <div class="venue-page-meta">
                ${venue.average_rating ? `
                    <div class="venue-page-rating">
                        ${renderStars(venue.average_rating)}
                        <span>${venue.average_rating}</span>
                        ${venue.review_count ? `<span style="color:#94a3b8">(${venue.review_count})</span>` : ''}
                    </div>
                ` : ''}
                ${venue.category ? `<span class="venue-page-category">${escapeHtml(venue.category)}</span>` : ''}
                ${locationParts ? `
                    <span class="venue-page-location">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        ${escapeHtml(locationParts)} ${distanceText ? `&middot; ${distanceText}` : ''}
                    </span>
                ` : ''}
            </div>
        `;
    }

    // Render action buttons
    const actionsEl = document.getElementById('venue-page-actions');
    if (actionsEl) {
        let actions = '';
        // Navigate button (demo placeholder)
        actions += `<button class="venue-action-btn" onclick="showToast('Navigation coming soon')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Navigate
        </button>`;
        if (venue.address_line1) {
            const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent([venue.address_line1, venue.city, venue.state].filter(Boolean).join(', '))}`;
            actions += `<a class="venue-action-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Directions
            </a>`;
        }
        if (venue.phone) {
            actions += `<a class="venue-action-btn" href="tel:${venue.phone}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                Call
            </a>`;
        }
        if (venue.website) {
            actions += `<a class="venue-action-btn" href="${venue.website}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                Website
            </a>`;
        }
        if (venue.instagram_handle) {
            actions += `<a class="venue-action-btn" href="https://instagram.com/${venue.instagram_handle}" target="_blank" rel="noopener noreferrer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
                Instagram
            </a>`;
        }
        actionsEl.innerHTML = actions;
        actionsEl.style.display = actions ? 'flex' : 'none';
    }

    // Render address
    const addressEl = document.getElementById('venue-page-address');
    if (addressEl) {
        if (venue.address_line1) {
            const line2 = [venue.city, venue.state, venue.postal_code].filter(Boolean).join(', ');
            addressEl.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <div class="venue-page-address-text">
                    <div>${escapeHtml(venue.address_line1)}</div>
                    ${line2 ? `<div class="venue-page-address-line2">${escapeHtml(line2)}</div>` : ''}
                </div>
            `;
            addressEl.style.display = 'flex';
        } else {
            addressEl.style.display = 'none';
        }
    }

    // Render hours
    const hoursEl = document.getElementById('venue-page-hours');
    if (hoursEl) {
        if (venue.hours && typeof venue.hours === 'object' && Object.keys(venue.hours).length > 0) {
            const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            const today = dayNames[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

            let rows = '';
            dayNames.forEach(day => {
                const h = venue.hours[day];
                const isToday = day === today;
                let timeText = 'Closed';
                if (h) {
                    if (typeof h === 'string') {
                        timeText = h;
                    } else if (h.open && h.close) {
                        timeText = `${formatTime(h.open)} – ${formatTime(h.close)}`;
                    }
                }
                rows += `<tr class="${isToday ? 'today' : ''}"><td>${day}</td><td>${timeText}</td></tr>`;
            });

            hoursEl.innerHTML = `
                <h4 class="venue-page-hours-title">Hours</h4>
                <table class="venue-page-hours-table">${rows}</table>
            `;
            hoursEl.style.display = 'block';
        } else {
            hoursEl.style.display = 'none';
        }
    }

    // Render about
    const aboutEl = document.getElementById('venue-page-about');
    if (aboutEl) {
        let about = '';
        if (venue.description) {
            about += `<p class="venue-page-description">${escapeHtml(venue.description)}</p>`;
        }
        if (venue.tags && venue.tags.length > 0) {
            about += `<div class="venue-page-tags">${venue.tags.map(t => `<span class="venue-page-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        }
        aboutEl.innerHTML = about;
        aboutEl.style.display = about ? 'block' : 'none';
    }

    // Load venue feed
    await loadVenuePageFeed();

    // Setup infinite scroll
    const scrollEl = document.getElementById('venue-page-scroll');
    if (scrollEl) {
        venuePageScrollHandler = () => {
            if (venuePageLoading || !venuePageHasMore) return;
            const scrollBottom = scrollEl.scrollTop + scrollEl.clientHeight;
            if (scrollEl.scrollHeight - scrollBottom < 400) {
                loadVenuePageFeed(true);
            }
        };
        scrollEl.addEventListener('scroll', venuePageScrollHandler);
    }
}

async function loadVenuePageFeed(append = false) {
    if (venuePageLoading || !venuePageVenueId) return;
    venuePageLoading = true;

    if (!append) {
        venuePageOffset = 0;
        venuePageFeed = [];
        venuePageHasMore = true;
    }

    // Skip DB query for demo venues (not real UUIDs)
    if (String(venuePageVenueId).startsWith('demo-')) {
        venuePageLoading = false;
        venuePageHasMore = false;
        venuePageFeed = [];
        renderVenuePageFeed();
        return;
    }

    const loadingEl = document.getElementById('venue-page-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    const pageSize = 20;
    const { data, error } = await supabaseClient
        .from('venue_media')
        .select('id, url, thumbnail_url, media_type, caption, duration_seconds, created_at')
        .eq('venue_id', venuePageVenueId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .range(venuePageOffset, venuePageOffset + pageSize - 1);

    venuePageLoading = false;
    if (loadingEl) loadingEl.style.display = 'none';

    if (error) {
        console.error('Failed to load venue feed:', error);
        venuePageHasMore = false;
        return;
    }

    if (!data || data.length < pageSize) {
        venuePageHasMore = false;
    }

    if (append) {
        venuePageFeed = [...venuePageFeed, ...data];
    } else {
        venuePageFeed = data || [];
    }

    venuePageOffset += (data || []).length;
    renderVenuePageFeed();
}

function renderVenuePageFeed() {
    const container = document.getElementById('venue-page-feed');
    const emptyEl = document.getElementById('venue-page-empty');
    if (!container) return;

    if (venuePageFeed.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    container.innerHTML = venuePageFeed.map(item => {
        const isVideo = item.media_type === 'video';
        return `
            <div class="feed-card" data-media-id="${item.id}">
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
                ${item.caption ? `<div class="feed-caption">${escapeHtml(item.caption)}</div>` : ''}
            </div>
        `;
    }).join('');

    // Setup video autoplay observers for venue page feed
    setupVideoObserverIn(container);
}

function setupVideoObserverIn(container) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;
            if (entry.isIntersecting) {
                video.play().catch(() => {
                    const playBtn = entry.target.querySelector('.video-play-btn');
                    if (playBtn) playBtn.style.display = 'flex';
                });
            } else {
                video.pause();
                video.muted = true;
                const playBtn = entry.target.querySelector('.video-play-btn');
                if (playBtn) playBtn.style.display = 'flex';
            }
        });
    }, { threshold: 0.6 });

    container.querySelectorAll('.feed-media').forEach(el => {
        if (el.querySelector('video')) observer.observe(el);
    });
}

function closeVenuePage() {
    const page = document.getElementById('venue-page');
    const backdrop = document.getElementById('venue-page-backdrop');
    if (page) page.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.style.overflow = '';

    // Remove scroll listener
    const scrollEl = document.getElementById('venue-page-scroll');
    if (scrollEl && venuePageScrollHandler) {
        scrollEl.removeEventListener('scroll', venuePageScrollHandler);
        venuePageScrollHandler = null;
    }

    // Pause any playing videos in venue page
    const pageEl = document.getElementById('venue-page-feed');
    if (pageEl) {
        pageEl.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });
    }

    venuePageVenueId = null;
    venuePageFeed = [];
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

    // Initialize or refresh map when switching to map tab
    if (tabId === 'map') {
        requestAnimationFrame(() => {
            if (!map) initMap();
            else map.invalidateSize();
        });
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

    // Update map pins + swim lane if map is visible
    if (map) {
        renderMapPins();
        renderVenueSwimLane();
    }
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
                video.play().catch(() => {
                    // Autoplay blocked — show play button so user can tap to play
                    const playBtn = entry.target.querySelector('.video-play-btn');
                    if (playBtn) playBtn.style.display = 'flex';
                });
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

    // Venue page back + backdrop
    const venuePageBack = document.getElementById('venue-page-back');
    if (venuePageBack) {
        venuePageBack.addEventListener('click', closeVenuePage);
    }
    const venuePageBackdrop = document.getElementById('venue-page-backdrop');
    if (venuePageBackdrop) {
        venuePageBackdrop.addEventListener('click', closeVenuePage);
    }

    // Create post button + modal
    const postBtn = document.querySelector('.post-btn');
    if (postBtn) {
        postBtn.addEventListener('click', openCreatePost);
    }

    const postBackdrop = document.getElementById('create-post-backdrop');
    if (postBackdrop) {
        postBackdrop.addEventListener('click', closeCreatePost);
    }

    const postCancelBtn = document.getElementById('create-post-cancel');
    if (postCancelBtn) {
        postCancelBtn.addEventListener('click', closeCreatePost);
    }

    const postSubmitBtn = document.getElementById('create-post-submit');
    if (postSubmitBtn) {
        postSubmitBtn.addEventListener('click', submitPost);
    }

    // Camera: tap placeholder to start camera
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    if (uploadPlaceholder) {
        uploadPlaceholder.addEventListener('click', (e) => {
            e.stopPropagation();
            startCamera();
        });
    }

    // Record button: tap to start/stop recording
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) {
        recordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }

    // Retake button
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) {
        retakeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retakeRecording();
        });
    }

    const captionInput = document.getElementById('post-caption');
    if (captionInput) {
        captionInput.addEventListener('input', () => {
            const countEl = document.getElementById('caption-count');
            if (countEl) countEl.textContent = captionInput.value.length;
        });
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
        dropdown.innerHTML = '<div class="map-search-empty">No venues found</div>';
        dropdown.classList.add('visible');
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
    openVenuePage(venueId);
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

function formatTime(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return m ? `${hour12}:${m.toString().padStart(2, '0')} ${ampm}` : `${hour12} ${ampm}`;
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
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Outfit,sans-serif;color:#64748b;">
            <div style="text-align:center;padding:20px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px;display:block;color:#94a3b8;"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
                <p>${msg}</p>
            </div>
        </div>
    `;
}

// ===== Create Post =====

async function getOrCreateDefaultVenue() {
    // Use existing real venue if available (skip demo venues)
    const realVenues = venues.filter(v => !String(v.id).startsWith('demo-'));
    if (realVenues.length > 0) return realVenues[0];

    // Auto-create a "General" venue for the org
    const { data, error } = await supabaseClient
        .from('venues')
        .insert({
            name: 'General',
            slug: 'general-' + Date.now().toString(36),
            organization_id: ownerOrgId,
            app_id: currentApp.id,
            category: 'general',
            is_active: true,
            media_count: 0
        })
        .select()
        .single();

    if (error) throw new Error('Failed to create default venue: ' + error.message);

    // Add to local venues array so subsequent posts reuse it
    venues.push(data);
    return data;
}

function openCreatePost() {
    if (!isOwner) return;

    const modal = document.getElementById('create-post-modal');
    const backdrop = document.getElementById('create-post-backdrop');
    if (!modal || !backdrop) return;

    // Reset state
    selectedPostFile = null;
    recordedChunks = [];
    const caption = document.getElementById('post-caption');
    if (caption) caption.value = '';
    const countEl = document.getElementById('caption-count');
    if (countEl) countEl.textContent = '0';
    const preview = document.getElementById('upload-preview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    const placeholder = document.getElementById('upload-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.style.display = 'none';
    const controls = document.getElementById('recording-controls');
    if (controls) controls.style.display = 'none';
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'none';
    const uploadArea = document.getElementById('create-post-upload');
    if (uploadArea) uploadArea.classList.remove('camera-active');
    const submitBtn = document.getElementById('create-post-submit');
    if (submitBtn) submitBtn.disabled = true;
    const progress = document.getElementById('create-post-progress');
    if (progress) progress.style.display = 'none';
    const timer = document.getElementById('recording-timer');
    if (timer) { timer.textContent = '0:00'; timer.classList.remove('active'); }
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.remove('recording');

    modal.classList.add('visible');
    backdrop.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeCreatePost() {
    const modal = document.getElementById('create-post-modal');
    const backdrop = document.getElementById('create-post-backdrop');
    if (modal) modal.classList.remove('visible');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.style.overflow = '';
    selectedPostFile = null;
    recordedChunks = [];
    stopCamera();
}

// ===== Camera & Recording =====

async function startCamera() {
    if (cameraStream) return; // Already running

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Camera not supported on this device');
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        const viewfinder = document.getElementById('camera-viewfinder');
        if (viewfinder) {
            viewfinder.srcObject = cameraStream;
            viewfinder.style.display = 'block';
            await viewfinder.play();
        }

        const placeholder = document.getElementById('upload-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        const controls = document.getElementById('recording-controls');
        if (controls) controls.style.display = 'flex';

        const uploadArea = document.getElementById('create-post-upload');
        if (uploadArea) uploadArea.classList.add('camera-active');

    } catch (e) {
        if (e.name === 'NotAllowedError') {
            showToast('Camera access denied. Please allow camera access.');
        } else if (e.name === 'NotFoundError') {
            showToast('No camera found on this device');
        } else {
            showToast('Could not access camera');
            console.error('Camera error:', e);
        }
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.srcObject = null;
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
    mediaRecorder = null;
}

function startRecording() {
    if (!cameraStream) return;

    recordedChunks = [];

    // Pick supported mimeType
    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

    mediaRecorder = new MediaRecorder(cameraStream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        selectedPostFile = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });

        // Show preview
        showRecordingPreview(blob);
        updatePostSubmitState();
    };

    mediaRecorder.start(1000); // collect data every second
    recordingStartTime = Date.now();

    // Update UI
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.add('recording');
    const timer = document.getElementById('recording-timer');
    if (timer) timer.classList.add('active');

    // Start timer
    recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (timer) timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }, 500);
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    mediaRecorder.stop();
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;

    // Stop camera stream
    stopCamera();

    // Update UI
    const recordBtn = document.getElementById('record-btn');
    if (recordBtn) recordBtn.classList.remove('recording');
    const viewfinder = document.getElementById('camera-viewfinder');
    if (viewfinder) viewfinder.style.display = 'none';
    const controls = document.getElementById('recording-controls');
    if (controls) controls.style.display = 'none';
}

function showRecordingPreview(blob) {
    const preview = document.getElementById('upload-preview');
    if (!preview) return;

    preview.innerHTML = '';
    const video = document.createElement('video');
    video.src = URL.createObjectURL(blob);
    video.controls = true;
    video.playsInline = true;
    video.muted = false;
    preview.appendChild(video);
    preview.style.display = 'block';

    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'block';
}

function retakeRecording() {
    selectedPostFile = null;
    recordedChunks = [];

    const preview = document.getElementById('upload-preview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    const retakeBtn = document.getElementById('retake-btn');
    if (retakeBtn) retakeBtn.style.display = 'none';
    const timer = document.getElementById('recording-timer');
    if (timer) { timer.textContent = '0:00'; timer.classList.remove('active'); }

    updatePostSubmitState();
    startCamera();
}

function updatePostSubmitState() {
    const submitBtn = document.getElementById('create-post-submit');
    if (submitBtn) submitBtn.disabled = !selectedPostFile;
}

async function submitPost() {
    if (!selectedPostFile || !isOwner || !ownerOrgId) return;

    const submitBtn = document.getElementById('create-post-submit');
    const progress = document.getElementById('create-post-progress');
    const progressFill = document.getElementById('post-progress-fill');
    const progressText = document.getElementById('post-progress-text');

    if (submitBtn) submitBtn.disabled = true;
    if (progress) progress.style.display = 'block';
    if (progressFill) progressFill.style.width = '10%';
    if (progressText) progressText.textContent = 'Preparing...';

    try {
        // Get or create a default venue automatically
        const venue = await getOrCreateDefaultVenue();
        const venueId = venue.id;

        if (progressFill) progressFill.style.width = '20%';
        if (progressText) progressText.textContent = 'Uploading...';

        const timestamp = Date.now();
        const safeFilename = selectedPostFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${ownerOrgId}/${venueId}/${timestamp}-${safeFilename}`;

        if (progressFill) progressFill.style.width = '40%';

        const { error: uploadError } = await supabaseClient.storage
            .from('venue-media')
            .upload(path, selectedPostFile, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        if (progressFill) progressFill.style.width = '70%';
        if (progressText) progressText.textContent = 'Saving...';

        const { data: urlData } = supabaseClient.storage
            .from('venue-media')
            .getPublicUrl(path);

        const caption = document.getElementById('post-caption')?.value.trim() || null;

        const { error: insertError } = await supabaseClient
            .from('venue_media')
            .insert({
                venue_id: venueId,
                app_id: currentApp.id,
                url: urlData.publicUrl,
                media_type: 'video',
                caption: caption,
                status: 'approved',
                storage_path: path
            });

        if (insertError) throw insertError;

        // Increment media count on venue
        await supabaseClient
            .from('venues')
            .update({ media_count: (venue.media_count || 0) + 1 })
            .eq('id', venueId);

        if (progressFill) progressFill.style.width = '100%';
        if (progressText) progressText.textContent = 'Posted!';

        setTimeout(async () => {
            closeCreatePost();
            showToast('Post published!');
            // Small delay to ensure DB propagation, then reload + scroll to top
            await new Promise(r => setTimeout(r, 300));
            await loadFeed(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 500);

    } catch (err) {
        console.error('Post upload failed:', err);
        if (progressFill) progressFill.style.width = '0';
        if (progressText) progressText.textContent = 'Upload failed';
        showToast(err.message || 'Failed to post. Try again.');
        if (submitBtn) submitBtn.disabled = false;
    }
}

// ===== Location Banner =====
function showLocationBanner() {
    if (document.getElementById('location-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'location-banner';
    banner.style.cssText = 'position:fixed;top:56px;left:0;right:0;z-index:100;background:#fef3c7;color:#92400e;padding:8px 40px 8px 16px;font-size:12px;text-align:center;';
    banner.innerHTML = 'Enable location access for distance info <button onclick="this.parentElement.remove()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#92400e;font-size:18px;cursor:pointer;line-height:1;">&times;</button>';
    document.body.appendChild(banner);
}

// ===== Toast Notifications =====
function showToast(message) {
    const existing = document.querySelector('.social-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'social-toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:9999;opacity:0;transition:opacity 0.3s;max-width:90%;text-align:center;';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Start =====
document.addEventListener('DOMContentLoaded', init);
