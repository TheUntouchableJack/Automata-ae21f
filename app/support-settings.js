// ===== Support Settings Page =====
let currentUser = null;
let currentOrganization = null;
let customerApps = [];
let selectedAppId = null;
let currentSettings = null;

async function initSupportSettings() {
    currentUser = await requireAuth();
    if (!currentUser) return;

    const [userInfo, orgData] = await Promise.all([
        AppUtils.loadUserInfo(currentUser.id, currentUser.email),
        AppUtils.loadOrganization(supabase, currentUser.id)
    ]);

    currentOrganization = orgData.organization;

    if (typeof AppSidebar !== 'undefined') {
        AppSidebar.init({
            name: userInfo.fullName,
            email: currentUser.email,
            organization: currentOrganization,
            role: orgData.role,
            isAdmin: userInfo.profile?.is_admin === true
        });
    }

    await loadCustomerApps();
    setupEventListeners();
}

// ===== Load Customer Apps =====
async function loadCustomerApps() {
    if (!currentOrganization) return;

    try {
        const { data, error } = await supabase
            .from('customer_apps')
            .select('id, name, slug')
            .eq('organization_id', currentOrganization.id)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;
        customerApps = data || [];

        const appSelect = document.getElementById('app-select');
        appSelect.innerHTML = '<option value="">Select an app...</option>' +
            customerApps.map(app => `<option value="${app.id}">${app.name}</option>`).join('');

        // Auto-select if only one app
        if (customerApps.length === 1) {
            appSelect.value = customerApps[0].id;
            selectedAppId = customerApps[0].id;
            await loadSettings();
        }
    } catch (error) {
        console.error('Error loading apps:', error);
        AppUtils.showToast('Error loading apps', 'error');
    }
}

// ===== Load Settings =====
async function loadSettings() {
    if (!selectedAppId) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('settings-content').style.display = 'none';
        document.getElementById('no-app-state').style.display = 'block';
        return;
    }

    document.getElementById('no-app-state').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('settings-content').style.display = 'none';

    try {
        // Load or create support settings for this app
        let { data, error } = await supabase
            .from('support_settings')
            .select('*')
            .eq('app_id', selectedAppId)
            .single();

        if (error && error.code === 'PGRST116') {
            // No settings exist yet, create default settings
            const { data: newSettings, error: createError } = await supabase
                .from('support_settings')
                .insert({
                    app_id: selectedAppId,
                    organization_id: currentOrganization.id,
                    ai_enabled: true,
                    ai_autonomy_mode: 'auto_pilot',
                    escalation_keywords: ['manager', 'refund', 'complaint', 'human', 'speak to someone'],
                    max_ai_turns: 5,
                    escalate_on_negative_sentiment: true,
                    escalate_on_low_confidence: true,
                    business_hours_enabled: false,
                    business_hours: {
                        weekday: { start: '09:00', end: '17:00' },
                        saturday: { start: '10:00', end: '14:00' },
                        sunday_closed: true
                    },
                    timezone: 'America/New_York',
                    after_hours_message: "Thanks for reaching out! Our team is currently offline, but our AI assistant is here to help. If you need human support, we'll get back to you during business hours.",
                    welcome_message: "Hi! I'm your AI assistant. I can help with questions about your points, rewards, and account. How can I help you today?"
                })
                .select()
                .single();

            if (createError) throw createError;
            data = newSettings;
        } else if (error) {
            throw error;
        }

        currentSettings = data;
        populateForm(data);

        document.getElementById('loading').style.display = 'none';
        document.getElementById('settings-content').style.display = 'block';

    } catch (error) {
        console.error('Error loading settings:', error);
        document.getElementById('loading').innerHTML = '<p style="color: var(--color-error);">Error loading settings</p>';
    }
}

// ===== Populate Form =====
function populateForm(settings) {
    // AI enabled
    document.getElementById('ai-enabled').checked = settings.ai_enabled;
    updateAISettingsVisibility(settings.ai_enabled);

    // Autonomy mode
    const autonomyRadio = document.querySelector(`input[name="autonomy-mode"][value="${settings.ai_autonomy_mode}"]`);
    if (autonomyRadio) autonomyRadio.checked = true;

    // Escalation settings
    document.getElementById('escalation-keywords').value =
        (settings.escalation_keywords || []).join(', ');
    document.getElementById('max-ai-turns').value = settings.max_ai_turns || 5;
    document.getElementById('escalate-negative-sentiment').checked = settings.escalate_on_negative_sentiment;
    document.getElementById('escalate-low-confidence').checked = settings.escalate_on_low_confidence;

    // Business hours
    document.getElementById('business-hours-enabled').checked = settings.business_hours_enabled;
    updateBusinessHoursVisibility(settings.business_hours_enabled);

    const hours = settings.business_hours || {};
    if (hours.weekday) {
        document.getElementById('weekday-start').value = hours.weekday.start || '09:00';
        document.getElementById('weekday-end').value = hours.weekday.end || '17:00';
    }
    if (hours.saturday) {
        document.getElementById('saturday-start').value = hours.saturday.start || '10:00';
        document.getElementById('saturday-end').value = hours.saturday.end || '14:00';
    }
    document.getElementById('sunday-closed').checked = hours.sunday_closed !== false;

    // Timezone
    document.getElementById('timezone').value = settings.timezone || 'America/New_York';

    // Messages
    document.getElementById('after-hours-message').value = settings.after_hours_message || '';
    document.getElementById('welcome-message').value = settings.welcome_message || '';
}

// ===== Update Visibility =====
function updateAISettingsVisibility(enabled) {
    const aiDependentCards = ['autonomy-card', 'escalation-card', 'hours-card', 'after-hours-card'];
    aiDependentCards.forEach(id => {
        const card = document.getElementById(id);
        if (card) {
            card.style.opacity = enabled ? '1' : '0.5';
            card.style.pointerEvents = enabled ? 'auto' : 'none';
        }
    });
}

function updateBusinessHoursVisibility(enabled) {
    const body = document.getElementById('business-hours-body');
    if (body) {
        body.style.display = enabled ? 'block' : 'none';
    }

    const afterHoursCard = document.getElementById('after-hours-card');
    if (afterHoursCard) {
        afterHoursCard.style.display = enabled ? 'block' : 'none';
    }
}

// ===== Save Settings =====
async function saveSettings() {
    if (!selectedAppId || !currentSettings) return;

    const saveBtn = document.getElementById('save-settings');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="loading-spinner" style="width: 16px; height: 16px;"></span> Saving...';

    try {
        // Gather form values
        const aiEnabled = document.getElementById('ai-enabled').checked;
        const autonomyMode = document.querySelector('input[name="autonomy-mode"]:checked')?.value || 'auto_pilot';

        const keywordsRaw = document.getElementById('escalation-keywords').value;
        const escalationKeywords = keywordsRaw
            .split(',')
            .map(k => k.trim().toLowerCase())
            .filter(k => k.length > 0);

        const maxAiTurns = parseInt(document.getElementById('max-ai-turns').value) || 5;
        const escalateNegative = document.getElementById('escalate-negative-sentiment').checked;
        const escalateLowConfidence = document.getElementById('escalate-low-confidence').checked;

        const businessHoursEnabled = document.getElementById('business-hours-enabled').checked;
        const businessHours = {
            weekday: {
                start: document.getElementById('weekday-start').value,
                end: document.getElementById('weekday-end').value
            },
            saturday: {
                start: document.getElementById('saturday-start').value,
                end: document.getElementById('saturday-end').value
            },
            sunday_closed: document.getElementById('sunday-closed').checked
        };

        const timezone = document.getElementById('timezone').value;
        const afterHoursMessage = document.getElementById('after-hours-message').value.trim();
        const welcomeMessage = document.getElementById('welcome-message').value.trim();

        // Update database
        const { error } = await supabase
            .from('support_settings')
            .update({
                ai_enabled: aiEnabled,
                ai_autonomy_mode: autonomyMode,
                escalation_keywords: escalationKeywords,
                max_ai_turns: maxAiTurns,
                escalate_on_negative_sentiment: escalateNegative,
                escalate_on_low_confidence: escalateLowConfidence,
                business_hours_enabled: businessHoursEnabled,
                business_hours: businessHours,
                timezone: timezone,
                after_hours_message: afterHoursMessage,
                welcome_message: welcomeMessage,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentSettings.id);

        if (error) throw error;

        AppUtils.showToast('Settings saved', 'success');

    } catch (error) {
        console.error('Error saving settings:', error);
        AppUtils.showToast('Error saving settings', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
    }
}

// ===== Setup Event Listeners =====
function setupEventListeners() {
    // App selector
    document.getElementById('app-select').addEventListener('change', async (e) => {
        selectedAppId = e.target.value || null;
        await loadSettings();
    });

    // AI enabled toggle
    document.getElementById('ai-enabled').addEventListener('change', (e) => {
        updateAISettingsVisibility(e.target.checked);
    });

    // Business hours toggle
    document.getElementById('business-hours-enabled').addEventListener('change', (e) => {
        updateBusinessHoursVisibility(e.target.checked);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', initSupportSettings);
