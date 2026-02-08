// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

// Initialize Supabase client
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Make client available globally for other scripts
window.supabase = db;

// ===== Auth Helper Functions =====

/**
 * Get the current authenticated user
 * @returns {Promise<object|null>} User object or null
 */
async function getCurrentUser() {
    if (!db) {
        console.error('Supabase not initialized');
        return null;
    }

    const { data: { user }, error } = await db.auth.getUser();
    if (error) {
        console.error('Error getting user:', error);
        return null;
    }
    return user;
}

/**
 * Get the current session
 * @returns {Promise<object|null>} Session object or null
 */
async function getSession() {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) {
        console.error('Error getting session:', error);
        return null;
    }
    return session;
}

/**
 * Get a valid session with non-expired access token
 * Auto-refreshes if token is expired or about to expire (within 60 seconds)
 * @returns {Promise<object|null>} Valid session object or null
 */
async function getValidSession() {
    let { data: { session }, error } = await db.auth.getSession();

    if (error || !session) {
        return null;
    }

    // Check if token is expired or about to expire (within 60 seconds)
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 60;

    if (session.expires_at && session.expires_at < now + bufferSeconds) {
        const { data: refreshData, error: refreshError } = await db.auth.refreshSession();

        if (refreshError || !refreshData?.session) {
            return null;
        }

        session = refreshData.session;
    }

    return session;
}

/**
 * Sign in with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: object|null}>}
 */
async function signIn(email, password) {
    if (!db) {
        return { user: null, error: { message: 'Supabase not initialized. Please refresh the page.' } };
    }

    // ===== RATE LIMITING =====
    // 5 login attempts per 15 minutes per email
    try {
        const { data: allowed, error: rlError } = await db.rpc('check_and_record_rate_limit', {
            p_identifier: email.toLowerCase(),
            p_action_type: 'login',
            p_max_attempts: 5,
            p_window_minutes: 15
        });

        if (!rlError && allowed === false) {
            return {
                user: null,
                error: { message: 'Too many login attempts. Please wait 15 minutes and try again.' }
            };
        }
    } catch (e) {
        console.warn('Rate limit check failed, continuing:', e);
    }

    const { data, error } = await db.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        return { user: null, error };
    }

    return { user: data.user, error: null };
}

/**
 * Sign up with email and password
 * @param {string} email
 * @param {string} password
 * @param {string} firstName
 * @param {string} lastName
 * @returns {Promise<{user: object|null, error: object|null}>}
 */
async function signUp(email, password, firstName, lastName) {
    // ===== RATE LIMITING =====
    // 10 signup attempts per hour per email
    try {
        const { data: allowed, error: rlError } = await db.rpc('check_and_record_rate_limit', {
            p_identifier: email.toLowerCase(),
            p_action_type: 'signup',
            p_max_attempts: 10,
            p_window_minutes: 60
        });

        if (!rlError && allowed === false) {
            return {
                user: null,
                error: { message: 'Too many signup attempts. Please wait an hour and try again.' }
            };
        }
    } catch (e) {
        console.warn('Rate limit check failed, continuing:', e);
    }

    const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
            data: {
                first_name: firstName,
                last_name: lastName
            },
            emailRedirectTo: window.location.origin + '/app/login.html'
        }
    });

    if (error) {
        return { user: null, error };
    }

    return { user: data.user, error: null };
}

/**
 * Sign out the current user
 * @returns {Promise<{error: object|null}>}
 */
async function signOut() {
    const { error } = await db.auth.signOut();
    if (!error) {
        window.location.href = '/app/login.html';
    }
    return { error };
}

/**
 * Get user profile from profiles table
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getUserProfile(userId) {
    const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }

    return data;
}

/**
 * Check if user is admin
 * @returns {Promise<boolean>}
 */
async function isAdmin() {
    const user = await getCurrentUser();
    if (!user) return false;

    const profile = await getUserProfile(user.id);
    return profile?.is_admin || false;
}

/**
 * Require authentication - redirect to login if not authenticated
 * @returns {Promise<object|null>} User object or null (if redirecting)
 */
async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = '/app/login.html';
        return null;
    }
    return user;
}

/**
 * Redirect authenticated users away from login/signup pages
 */
async function redirectIfAuthenticated() {
    const user = await getCurrentUser();
    if (user) {
        // Check if this is a new signup with onboarding data
        const hasOnboarding = localStorage.getItem('royalty_onboarding');
        if (hasOnboarding) {
            window.location.href = '/app/intelligence.html?firstLogin=true';
        } else {
            window.location.href = '/app/dashboard.html';
        }
    }
}

// ===== Auth State Change Listener =====
if (db) {
    db.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            // Clear any cached data
            localStorage.removeItem('royalty_user_profile');
        }
    });

    // Handle PKCE code exchange on page load (for email confirmation redirects)
    // This runs once when auth.js loads to process any pending auth codes
    (async function handleAuthCodeOnLoad() {
        const urlParams = new URLSearchParams(window.location.search);
        const authCode = urlParams.get('code');

        // Only process if we have a code and haven't already processed it
        if (authCode && !sessionStorage.getItem('auth_code_processed')) {
            sessionStorage.setItem('auth_code_processed', 'true');

            try {
                const { data, error } = await db.auth.exchangeCodeForSession(authCode);

                if (error) {
                    console.error('Auth code exchange error:', error);
                    sessionStorage.removeItem('auth_code_processed');
                } else {
                    // Clean the URL to remove the code
                    const cleanUrl = window.location.pathname + window.location.hash;
                    window.history.replaceState({}, '', cleanUrl);

                    // Check if this is a new signup with onboarding data
                    const hasOnboarding = localStorage.getItem('royalty_onboarding');
                    if (hasOnboarding) {
                        // New user from landing page - go to Intelligence to build their app
                        window.location.href = '/app/intelligence.html?firstLogin=true';
                    } else if (!window.location.pathname.includes('login.html')) {
                        // Returning user - go to dashboard
                        window.location.href = '/app/dashboard.html';
                    }
                }
            } catch (err) {
                console.error('Failed to exchange auth code:', err);
                sessionStorage.removeItem('auth_code_processed');
            }

            // Clear the processed flag after a delay
            setTimeout(() => {
                sessionStorage.removeItem('auth_code_processed');
            }, 5000);
        }
    })();
}
