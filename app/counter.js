// ===== Counter: staff check a reward code and give the reward (plan royalty-in-store-loop B2) =====
//
// lookup_redemption / fulfill_redemption (migration 20261122000003) decide everything: the
// caller must belong to the org that owns the code's app, a code is given once (row lock),
// expired and cancelled codes refuse. This page only shows the answer.
// Every value from the database is written with textContent.

let counterUser = null;
let counterOrg = null;
let counterApp = null;
let counterLastCode = null;
let counterStream = null;
let counterScanning = false;
let counterDetector = null;

function counterT(key, fallback, replacements) {
    const fill = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => (replacements && replacements[k] !== undefined ? replacements[k] : m));
    if (typeof i18n !== 'undefined' && i18n.t) {
        const v = i18n.t(key, replacements || {});
        if (v && v !== key) return v;
    }
    return fill(fallback);
}

// Letters and digits only, upper case. A scanned QR may carry a prefix or URL: keep the last part.
function counterNormalize(raw) {
    const last = String(raw || '').trim().split(/[\/:?#=]/).filter(Boolean).pop() || '';
    return last.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function counterDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function initCounter() {
    counterUser = await requireAuth();
    if (!counterUser) return;

    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(counterUser.id, counterUser.email),
        AppUtils.loadOrganization(supabase, counterUser.id)
    ]);
    counterOrg = orgData.organization;

    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: counterUser.email,
            organization: counterOrg,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    if (counterOrg) {
        const { data } = await supabase
            .from('customer_apps')
            .select('id, name, slug')
            .eq('organization_id', counterOrg.id)
            .is('deleted_at', null)
            .or('app_type.is.null,app_type.neq.social')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        counterApp = data || null;
    }
    if (!counterApp) document.getElementById('counter-no-app').style.display = 'block';

    document.getElementById('counter-form').addEventListener('submit', (e) => {
        e.preventDefault();
        counterLookup(document.getElementById('counter-code').value);
    });
    document.getElementById('counter-give-btn').addEventListener('click', counterGive);
    document.getElementById('counter-scan-btn').addEventListener('click', counterStartScan);
    document.getElementById('counter-stop-btn').addEventListener('click', counterStopScan);
    document.getElementById('counter-code').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    });

    await counterRefreshSummary();
    document.getElementById('counter-code').focus();
}

async function counterRefreshSummary() {
    if (!counterApp) return;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data, error } = await supabase.rpc('counter_summary', { p_app_id: counterApp.id, p_since: since.toISOString() });
    if (error || !data?.allowed) return;
    document.getElementById('counter-given-today').textContent = Number(data.given_since || 0).toLocaleString();
    document.getElementById('counter-waiting').textContent = Number(data.waiting || 0).toLocaleString();
}

async function counterLookup(raw) {
    const code = counterNormalize(raw);
    document.getElementById('counter-code').value = code;
    if (!code) return;
    counterLastCode = code;
    const btn = document.getElementById('counter-lookup-btn');
    btn.disabled = true;
    try {
        const { data, error } = await supabase.rpc('lookup_redemption', { p_code: code });
        if (error) throw error;
        counterRender(data);
    } catch (e) {
        console.error('lookup_redemption failed:', e);
        counterRender({ result: 'error' });
    } finally {
        btn.disabled = false;
    }
}

async function counterGive() {
    if (!counterLastCode) return;
    const btn = document.getElementById('counter-give-btn');
    btn.disabled = true;
    try {
        const { data, error } = await supabase.rpc('fulfill_redemption', { p_code: counterLastCode });
        if (error) throw error;
        counterRender(data);
        if (data?.result === 'given_now') {
            await counterRefreshSummary();
            const input = document.getElementById('counter-code');
            input.value = '';
            input.focus();
        }
    } catch (e) {
        console.error('fulfill_redemption failed:', e);
        counterRender({ result: 'error' });
    } finally {
        btn.disabled = false;
    }
}

function counterRender(v) {
    const box = document.getElementById('counter-result');
    const status = document.getElementById('counter-status');
    const name = document.getElementById('counter-reward-name');
    const customer = document.getElementById('counter-customer');
    const dates = document.getElementById('counter-dates');
    const extra = document.getElementById('counter-extra');
    const give = document.getElementById('counter-give-btn');
    const result = v?.result || 'error';

    const hasReward = ['ready', 'given_now', 'given', 'expired', 'cancelled'].includes(result);
    name.textContent = hasReward ? (v.reward_name || '') : '';
    customer.textContent = hasReward
        ? counterT('counter.forCustomer', 'For {name}', { name: v.member_first_name || '' }) + (v.points_spent ? ` · ${counterT('counter.points', '{points} points', { points: v.points_spent })}` : '')
        : '';
    dates.textContent = hasReward
        ? [v.redeemed_at ? counterT('counter.redeemedOn', 'Redeemed {date}', { date: counterDate(v.redeemed_at) }) : '',
           v.expires_at && result !== 'given' && result !== 'given_now' ? counterT('counter.useBy', 'Use by {date}', { date: counterDate(v.expires_at) }) : '']
            .filter(Boolean).join(' · ')
        : '';
    extra.textContent = '';

    const states = {
        ready:          ['ok',   counterT('counter.ready', 'Ready to give')],
        given_now:      ['ok',   counterT('counter.givenNow', 'Reward given')],
        given:          ['warn', counterT('counter.alreadyGiven', 'Already given')],
        expired:        ['bad',  counterT('counter.expired', 'This code has expired')],
        cancelled:      ['bad',  counterT('counter.cancelled', 'This code was cancelled')],
        not_found:      ['bad',  counterT('counter.notFound', 'No reward has this code. Check the letters and try again.')],
        other_business: ['bad',  counterT('counter.otherBusiness', 'This code is for another business.')],
        not_signed_in:  ['bad',  counterT('counter.signedOut', 'Your session ended. Sign in again.')],
        error:          ['bad',  counterT('counter.error', 'Something went wrong. Try again.')]
    };
    const [tone, label] = states[result] || states.error;
    status.className = `counter-status ${tone}`;
    status.textContent = label;

    if (result === 'given' && v.fulfilled_at) {
        extra.textContent = v.fulfilled_by_name
            ? counterT('counter.givenByOn', 'Given {date} by {name}', { date: counterDate(v.fulfilled_at), name: v.fulfilled_by_name })
            : counterT('counter.givenOn', 'Given {date}', { date: counterDate(v.fulfilled_at) });
    }

    give.style.display = result === 'ready' ? '' : 'none';
    box.classList.add('active');
}

// ===== Camera: BarcodeDetector where the browser has it, jsQR otherwise =====
async function counterStartScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
        counterRender({ result: 'error' });
        document.getElementById('counter-status').textContent = counterT('counter.noCamera', "This device can't use the camera here. Type the code instead.");
        return;
    }
    try {
        counterStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) {
        console.warn('Camera refused:', e);
        counterRender({ result: 'error' });
        document.getElementById('counter-status').textContent = counterT('counter.noCamera', "This device can't use the camera here. Type the code instead.");
        return;
    }
    const video = document.getElementById('counter-video');
    video.srcObject = counterStream;
    await video.play();
    document.getElementById('counter-scanner').classList.add('active');
    counterScanning = true;
    if ('BarcodeDetector' in window) {
        try { counterDetector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { counterDetector = null; }
    }
    requestAnimationFrame(counterScanTick);
}

function counterStopScan() {
    counterScanning = false;
    if (counterStream) counterStream.getTracks().forEach((t) => t.stop());
    counterStream = null;
    document.getElementById('counter-scanner').classList.remove('active');
}

const counterCanvas = document.createElement('canvas');
async function counterScanTick() {
    if (!counterScanning) return;
    const video = document.getElementById('counter-video');
    let text = null;
    try {
        if (counterDetector) {
            const codes = await counterDetector.detect(video);
            if (codes.length) text = codes[0].rawValue;
        } else if (typeof jsQR === 'function' && video.videoWidth) {
            counterCanvas.width = video.videoWidth;
            counterCanvas.height = video.videoHeight;
            const ctx = counterCanvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, counterCanvas.width, counterCanvas.height);
            const found = jsQR(img.data, img.width, img.height);
            if (found) text = found.data;
        }
    } catch (_) { /* keep scanning */ }
    if (text) {
        counterStopScan();
        counterLookup(text);
        return;
    }
    requestAnimationFrame(counterScanTick);
}

document.addEventListener('DOMContentLoaded', initCounter);
