// ===== MFA (Multi-Factor Authentication) =====
// TOTP + Email OTP + Trusted Device
// Requires auth.js (window.supabase / db) to be loaded first.

// ── Constants ──────────────────────────────────────────────────────────────
const MFA_DEVICE_TOKEN_KEY  = 'royalty_device_token';
const MFA_PENDING_RETURN    = 'royalty_mfa_return';   // URL to return to after verify
const MFA_PENDING_METHOD    = 'royalty_mfa_method';   // 'email' or 'totp'

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * SHA-256 hash a string via Web Crypto API.
 * @param {string} str
 * @returns {Promise<string>} hex digest
 */
async function mfaHashToken(str) {
    const enc    = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Get (or create) a stable device token stored in localStorage.
 * @returns {string} UUID token
 */
function mfaGetDeviceToken() {
    let token = localStorage.getItem(MFA_DEVICE_TOKEN_KEY);
    if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem(MFA_DEVICE_TOKEN_KEY, token);
    }
    return token;
}

/**
 * Build a human-readable device label from the user-agent.
 * @returns {string} e.g. "Chrome on macOS"
 */
function mfaGetDeviceLabel() {
    const ua = navigator.userAgent;
    let browser = 'Browser';
    let os      = 'Unknown OS';

    if (/Edg\//.test(ua))            browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua))    browser = 'Chrome';
    else if (/Firefox\//.test(ua))   browser = 'Firefox';
    else if (/Safari\//.test(ua))    browser = 'Safari';

    if (/Windows/.test(ua))          os = 'Windows';
    else if (/Macintosh/.test(ua))   os = 'macOS';
    else if (/Linux/.test(ua))       os = 'Linux';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Android/.test(ua))     os = 'Android';

    return `${browser} on ${os}`;
}

// ── Trusted Device ─────────────────────────────────────────────────────────

/**
 * Check if the current device is in the trusted_devices table.
 * Silently returns false on any error (fail open = MFA prompt shown).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function mfaCheckTrustedDevice(userId) {
    try {
        const token = mfaGetDeviceToken();
        const hash  = await mfaHashToken(token);
        const { data, error } = await db
            .from('trusted_devices')
            .select('id, expires_at')
            .eq('user_id', userId)
            .eq('device_token_hash', hash)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
        if (error || !data) return false;

        // Bump last_seen_at
        await db
            .from('trusted_devices')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', data.id);

        return true;
    } catch (e) {
        console.warn('mfaCheckTrustedDevice error:', e);
        return false;
    }
}

/**
 * Register the current device as trusted for 30 days.
 * @param {string} userId
 * @returns {Promise<boolean>} success
 */
async function mfaTrustDevice(userId) {
    try {
        const token = mfaGetDeviceToken();
        const hash  = await mfaHashToken(token);
        const label = mfaGetDeviceLabel();

        // Upsert (in case same device was previously trusted and expired)
        const { error } = await db.from('trusted_devices').upsert({
            user_id:           userId,
            device_token_hash: hash,
            device_label:      label,
            last_seen_at:      new Date().toISOString(),
            expires_at:        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'user_id,device_token_hash' });

        return !error;
    } catch (e) {
        console.warn('mfaTrustDevice error:', e);
        return false;
    }
}

/**
 * List all trusted devices for a user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function mfaListTrustedDevices(userId) {
    const { data, error } = await db
        .from('trusted_devices')
        .select('id, device_label, last_seen_at, expires_at, created_at')
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('last_seen_at', { ascending: false });

    if (error) {
        console.error('mfaListTrustedDevices error:', error);
        return [];
    }
    return data || [];
}

/**
 * Revoke a trusted device by ID.
 * @param {string} deviceId
 * @returns {Promise<boolean>}
 */
async function mfaRevokeTrustedDevice(deviceId) {
    const { error } = await db
        .from('trusted_devices')
        .delete()
        .eq('id', deviceId);
    return !error;
}

/**
 * Revoke ALL trusted devices for a user (e.g., on password change).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function mfaRevokeAllTrustedDevices(userId) {
    const { error } = await db
        .from('trusted_devices')
        .delete()
        .eq('user_id', userId);
    localStorage.removeItem(MFA_DEVICE_TOKEN_KEY);
    return !error;
}

// ── Supabase MFA Factor Management (TOTP) ──────────────────────────────────

/**
 * List enrolled MFA factors.
 * @returns {Promise<{totp: Array, phone: Array}>}
 */
async function mfaListFactors() {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) {
        console.error('mfaListFactors error:', error);
        return { totp: [], phone: [] };
    }
    return {
        totp:  data.totp  || [],
        phone: data.phone || [],
    };
}

/**
 * Start TOTP enrollment. Returns QR code URI + secret for display.
 * @param {string} [issuer='Royalty']
 * @returns {Promise<{factorId: string, qrCode: string, secret: string}|null>}
 */
async function mfaEnrollTotp(issuer = 'Royalty') {
    const { data, error } = await db.auth.mfa.enroll({
        factorType: 'totp',
        issuer,
    });
    if (error) {
        console.error('mfaEnrollTotp error:', error);
        return null;
    }
    return {
        factorId: data.id,
        qrCode:   data.totp.qr_code,
        secret:   data.totp.secret,
    };
}

/**
 * Confirm TOTP enrollment by verifying the first code from the authenticator app.
 * @param {string} factorId
 * @param {string} code 6-digit TOTP code
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function mfaConfirmTotpEnrollment(factorId, code) {
    // Create a challenge first
    const { data: challengeData, error: challengeErr } = await db.auth.mfa.challenge({ factorId });
    if (challengeErr) return { success: false, error: challengeErr.message };

    // Verify the code
    const { error: verifyErr } = await db.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.replace(/\s/g, ''),
    });
    if (verifyErr) return { success: false, error: verifyErr.message };

    // Mark MFA as enabled in profile
    const user = await getCurrentUser();
    if (user) {
        const { data: profile } = await db.from('profiles').select('mfa_methods').eq('id', user.id).single();
        const methods = profile?.mfa_methods || [];
        if (!methods.includes('totp')) methods.push('totp');
        await db.from('profiles').update({ mfa_enabled: true, mfa_methods: methods }).eq('id', user.id);
    }

    return { success: true };
}

/**
 * Unenroll (remove) a TOTP factor.
 * @param {string} factorId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function mfaUnenroll(factorId) {
    const { error } = await db.auth.mfa.unenroll({ factorId });
    if (error) return { success: false, error: error.message };

    // Update profile — check if any MFA methods remain
    const user = await getCurrentUser();
    if (user) {
        const { totp } = await mfaListFactors();
        const { data: profile } = await db.from('profiles').select('mfa_methods').eq('id', user.id).single();
        const methods = (profile?.mfa_methods || []).filter(m => m !== 'totp');
        if (totp.length === 0 && !methods.includes('totp')) {
            // Remove totp from methods; keep email if still enrolled
            await db.from('profiles').update({
                mfa_enabled: methods.length > 0,
                mfa_methods: methods
            }).eq('id', user.id);
        }
    }

    return { success: true };
}

// ── Email OTP ──────────────────────────────────────────────────────────────

/**
 * Call the mfa-email-otp edge function.
 * @param {string} action  'send' | 'verify' | 'enroll' | 'unenroll'
 * @param {object} [body]  Request body (for verify: { code })
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function mfaEmailOtpCall(action, body = {}) {
    try {
        const session = await getValidSession();
        if (!session) return { ok: false, error: 'Not authenticated' };

        const url = `${SUPABASE_URL}/functions/v1/mfa-email-otp/${action}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
            return { ok: false, error: data.error || `Request failed (${response.status})` };
        }

        return { ok: true, data };
    } catch (e) {
        console.error('mfaEmailOtpCall error:', e);
        return { ok: false, error: e.message };
    }
}

/**
 * Send a 6-digit code to the user's email.
 * @returns {Promise<{ok: boolean, email?: string, error?: string}>}
 */
async function mfaSendEmailCode() {
    const result = await mfaEmailOtpCall('send');
    if (result.ok) {
        return { ok: true, email: result.data.email };
    }
    return { ok: false, error: result.error };
}

/**
 * Verify a 6-digit email code.
 * @param {string} code
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function mfaVerifyEmailCode(code) {
    const result = await mfaEmailOtpCall('verify', { code });
    return { ok: result.ok, error: result.error };
}

/**
 * Enroll (enable) email MFA for the current user.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function mfaEnrollEmail() {
    return await mfaEmailOtpCall('enroll');
}

/**
 * Unenroll (disable) email MFA for the current user.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function mfaUnenrollEmail() {
    return await mfaEmailOtpCall('unenroll');
}

/**
 * Check if the current user has email MFA enabled (from profile).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function mfaHasEmailMfa(userId) {
    try {
        const { data, error } = await db
            .from('profiles')
            .select('mfa_methods')
            .eq('id', userId)
            .single();
        if (error || !data) return false;
        return (data.mfa_methods || []).includes('email');
    } catch {
        return false;
    }
}

// ── MFA Challenge & Verify (TOTP login flow) ──────────────────────────────

/**
 * Challenge + verify a TOTP factor in one call.
 * Used on the mfa-challenge.html page.
 * @param {string} factorId
 * @param {string} code
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function mfaChallengeAndVerify(factorId, code) {
    const { data: challengeData, error: challengeErr } = await db.auth.mfa.challenge({ factorId });
    if (challengeErr) return { success: false, error: challengeErr.message };

    const { error: verifyErr } = await db.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code.replace(/\s/g, ''),
    });
    if (verifyErr) return { success: false, error: verifyErr.message };

    return { success: true };
}

// ── Post-Login MFA Gate ────────────────────────────────────────────────────

/**
 * Called immediately after a successful password sign-in.
 * Checks if MFA is required (email OTP or TOTP) and either passes through
 * or redirects to the challenge page.
 *
 * Priority: Email OTP (default) > TOTP (advanced)
 *
 * Returns true  → MFA satisfied, caller may proceed with login.
 * Returns false → Redirecting to challenge page; caller should stop.
 *
 * @param {object} user  Supabase user object from signInWithPassword
 * @param {string} [returnUrl='/app/dashboard.html']
 * @returns {Promise<boolean>}
 */
async function mfaGate(user, returnUrl = '/app/dashboard.html') {
    try {
        // Check if device is trusted first (skips all MFA)
        const trusted = await mfaCheckTrustedDevice(user.id);
        if (trusted) return true;

        // Check email MFA (custom, profile-based)
        const hasEmailMfa = await mfaHasEmailMfa(user.id);
        if (hasEmailMfa) {
            // Send email code automatically
            const sendResult = await mfaSendEmailCode();
            if (!sendResult.ok) {
                console.warn('mfaGate: failed to send email code, allowing login:', sendResult.error);
                return true; // fail open if email send fails
            }

            sessionStorage.setItem(MFA_PENDING_RETURN, returnUrl);
            sessionStorage.setItem(MFA_PENDING_METHOD, 'email');
            window.location.href = '/app/mfa-challenge.html';
            return false;
        }

        // Check TOTP MFA (Supabase native AAL)
        const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) {
            console.warn('mfaGate: could not get AAL, skipping MFA check:', error);
            return true; // fail open
        }

        if (data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') {
            return true; // No TOTP required or already satisfied
        }

        // TOTP required — redirect to challenge page
        sessionStorage.setItem(MFA_PENDING_RETURN, returnUrl);
        sessionStorage.setItem(MFA_PENDING_METHOD, 'totp');
        window.location.href = '/app/mfa-challenge.html';
        return false;
    } catch (e) {
        console.warn('mfaGate error:', e);
        return true; // fail open
    }
}
