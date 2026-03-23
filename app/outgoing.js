// ===== Campaign Manager (Outgoing) =====
// Displays message batches grouped by automation with filtering, stats, and actions.

const OutgoingManager = (function () {
    let campaigns = [];
    let summary = {};
    let currentOrgId = null;
    let currentFilters = { channel: null, status: 'upcoming', days: 30 };
    let selectedBatch = null;
    let searchQuery = '';
    let sortBy = 'date';
    let countdownInterval = null;
    let isSuperAdmin = false;
    let selectedOrgId = null; // null = all orgs (admin only)
    let allOrgs = [];

    // ── i18n helper ─────────────────────────────────────────────────
    function t(key, fallback) {
        if (typeof I18n !== 'undefined' && I18n.t) {
            const val = I18n.t(key);
            return (val && !val.startsWith('outgoing.')) ? val : fallback;
        }
        return fallback;
    }

    // ── Init ─────────────────────────────────────────────────────────
    async function init(orgId, isAdmin) {
        currentOrgId = orgId;
        isSuperAdmin = isAdmin === true;
        selectedOrgId = isSuperAdmin ? null : orgId; // admin defaults to all orgs
        renderSkeleton();
        if (isSuperAdmin) await loadOrganizations();
        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
        bindFilterEvents();
        startCountdownTimer();
    }

    // ── Data Loading ─────────────────────────────────────────────────
    async function loadSummary() {
        const params = { p_days: currentFilters.days };
        if (selectedOrgId) params.p_organization_id = selectedOrgId;
        const { data, error } = await db.rpc('get_outgoing_summary', params);
        if (error) {
            console.error('loadSummary error:', error);
            summary = {};
            return;
        }
        summary = data?.[0] || data || {};
    }

    async function loadCampaigns() {
        const params = {
            p_days: currentFilters.days,
            p_limit: 50,
            p_offset: 0
        };
        if (selectedOrgId) params.p_organization_id = selectedOrgId;
        if (currentFilters.channel) params.p_channel = currentFilters.channel;
        if (currentFilters.status) params.p_status = currentFilters.status;

        const { data, error } = await db.rpc('get_outgoing_campaigns', params);
        if (error) {
            console.error('loadCampaigns error:', error);
            campaigns = [];
            return;
        }
        campaigns = data || [];
    }

    async function loadOrganizations() {
        const { data, error } = await db.rpc('get_all_organization_names');
        if (error) {
            console.error('loadOrganizations error:', error);
            allOrgs = [];
            return;
        }
        allOrgs = data || [];
        renderOrgFilter();
    }

    function renderOrgFilter() {
        const filtersBar = document.querySelector('.filters-bar');
        if (!filtersBar || !isSuperAdmin) return;

        // Remove existing org filter if present
        const existing = document.getElementById('filter-org');
        if (existing) existing.remove();

        const select = document.createElement('select');
        select.className = 'filter-select';
        select.id = 'filter-org';

        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = t('outgoing.allCompanies', 'All Companies');
        select.appendChild(allOpt);

        allOrgs.forEach(org => {
            const opt = document.createElement('option');
            opt.value = org.id;
            opt.textContent = org.name;
            if (selectedOrgId === org.id) opt.selected = true;
            select.appendChild(opt);
        });

        // Insert as first filter
        filtersBar.insertBefore(select, filtersBar.firstChild);

        select.addEventListener('change', async () => {
            selectedOrgId = select.value || null;
            renderSkeleton();
            await Promise.all([loadSummary(), loadCampaigns()]);
            renderAll();
        });
    }

    async function loadRecipients(batchId) {
        const { data, error } = await db
            .from('message_recipients')
            .select('id, member_id, channel, status, error_message, sent_at, delivered_at, app_members(email, first_name, last_name)')
            .eq('batch_id', batchId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('loadRecipients error:', error);
            return [];
        }
        return data || [];
    }

    // ── Filtering & Sorting ─────────────────────────────────────────
    function getFilteredCampaigns() {
        let filtered = campaigns;

        // Client-side search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(c =>
                (c.subject || '').toLowerCase().includes(q) ||
                (c.body || '').toLowerCase().includes(q) ||
                (c.automation_name || '').toLowerCase().includes(q)
            );
        }

        // Sort
        if (sortBy === 'recipients') {
            filtered = [...filtered].sort((a, b) => (b.total_recipients || 0) - (a.total_recipients || 0));
        } else if (sortBy === 'open_rate') {
            const openRate = c => c.delivered > 0 ? c.opened / c.delivered : 0;
            filtered = [...filtered].sort((a, b) => openRate(b) - openRate(a));
        }
        // 'date' is the default sort from the RPC

        return filtered;
    }

    // ── Countdown ───────────────────────────────────────────────────
    function formatCountdown(isoDate) {
        if (!isoDate) return '';
        const diff = new Date(isoDate) - Date.now();
        if (diff <= 0) return t('outgoing.sendingSoon', 'Sending soon');
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        if (days > 0) return `${t('outgoing.sendsIn', 'Sends in')} ${days}d ${hours}h`;
        if (hours > 0) return `${t('outgoing.sendsIn', 'Sends in')} ${hours}h ${mins}m`;
        return `${t('outgoing.sendsIn', 'Sends in')} ${mins}m`;
    }

    function startCountdownTimer() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            document.querySelectorAll('[data-countdown]').forEach(el => {
                el.textContent = formatCountdown(el.dataset.countdown);
            });
        }, 60000);
    }

    // ── Render ───────────────────────────────────────────────────────
    function renderSkeleton() {
        const container = document.getElementById('outgoing-content');
        container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>${t('outgoing.loading', 'Loading campaigns...')}</span></div>`;
    }

    function renderAll() {
        renderSummary();
        renderCampaignList();
    }

    function renderSummary() {
        const s = summary;
        const totalSent = Number(s.total_sent || 0);
        const delivered = Number(s.total_delivered || 0);
        const opened = Number(s.total_opened || 0);
        const clicked = Number(s.total_clicked || 0);

        const deliveredPct = totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0;
        const openedPct = delivered > 0 ? Math.round((opened / delivered) * 100) : 0;
        const clickedPct = opened > 0 ? Math.round((clicked / opened) * 100) : 0;

        document.getElementById('summary-cards').innerHTML = `
            <div class="summary-card">
                <div class="summary-card-label">${t('outgoing.totalSent', 'Total Sent')}</div>
                <div class="summary-card-value">${formatNum(totalSent)}</div>
                <div class="summary-card-sub">${t('outgoing.lastDays', 'Last {days} days').replace('{days}', currentFilters.days)}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">${t('outgoing.delivered', 'Delivered')}</div>
                <div class="summary-card-value">${formatNum(delivered)}</div>
                <div class="summary-card-sub">${deliveredPct}% ${t('outgoing.ofSent', 'of sent')}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">${t('outgoing.opened', 'Opened')}</div>
                <div class="summary-card-value">${formatNum(opened)}</div>
                <div class="summary-card-sub">${openedPct}% ${t('outgoing.openRate', 'open rate')}</div>
            </div>
            <div class="summary-card">
                <div class="summary-card-label">${t('outgoing.clicked', 'Clicked')}</div>
                <div class="summary-card-value">${formatNum(clicked)}</div>
                <div class="summary-card-sub">${clickedPct}% ${t('outgoing.clickRate', 'click rate')}</div>
            </div>
        `;
    }

    function renderCampaignList() {
        const container = document.getElementById('outgoing-content');
        const filtered = getFilteredCampaigns();

        if (campaigns.length === 0) {
            container.innerHTML = `
                <div class="outgoing-empty">
                    <div class="outgoing-empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/>
                        </svg>
                    </div>
                    <h3>${t('outgoing.emptyTitle', 'No campaigns yet')}</h3>
                    <p>${t('outgoing.emptyDesc', 'Royal AI will create campaigns as your automations run. Check your automations to get started.')}</p>
                    <a href="/app/automations.html">${t('outgoing.viewAutomations', 'View Automations')} &rarr;</a>
                </div>
            `;
            return;
        }

        if (filtered.length === 0 && (searchQuery || currentFilters.channel || currentFilters.status)) {
            container.innerHTML = `
                <div class="outgoing-empty">
                    <div class="outgoing-empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                        </svg>
                    </div>
                    <h3>${t('outgoing.noResults', 'No campaigns match your filters')}</h3>
                    <p>${t('outgoing.noResultsDesc', 'Try adjusting your search or filters to find what you\'re looking for.')}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `<div class="campaign-list">${filtered.map(renderCampaignCard).join('')}</div>`;
    }

    function renderCampaignCard(c) {
        const channelLabel = { email: 'Email', sms: 'SMS', push: 'Push', in_app: 'In-App' }[c.channel] || c.channel;
        const statusLabel = formatStatus(c.status);
        const dateStr = formatDate(c.sent_at || c.scheduled_for || c.created_at);
        const subjectText = escapeHtml(c.subject || c.body?.slice(0, 60) || 'No subject');

        const automationLink = c.automation_name
            ? `<a class="campaign-automation-link" href="/app/automation.html?id=${c.automation_id}" onclick="event.stopPropagation()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                ${escapeHtml(c.automation_name)}
                <span class="campaign-category-badge">${escapeHtml(c.automation_category || '')}</span>
               </a>`
            : '';

        // Countdown for scheduled campaigns
        const countdown = c.status === 'scheduled' && c.scheduled_for
            ? `<span class="campaign-countdown" data-countdown="${c.scheduled_for}">${formatCountdown(c.scheduled_for)}</span>`
            : '';

        // Pause/resume button on card
        const canPauseCard = ['scheduled', 'sending'].includes(c.status);
        const canResumeCard = c.status === 'paused';
        let cardAction = '';
        if (canPauseCard) {
            cardAction = `<button class="btn-card-action btn-card-pause" onclick="event.stopPropagation(); OutgoingManager.pauseBatch('${c.batch_id}')" title="${t('outgoing.pause', 'Pause')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            </button>`;
        } else if (canResumeCard) {
            cardAction = `<button class="btn-card-action btn-card-resume" onclick="event.stopPropagation(); OutgoingManager.resumeBatch('${c.batch_id}')" title="${t('outgoing.resume', 'Resume')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>`;
        }

        return `
            <div class="campaign-card" onclick="OutgoingManager.openDetail('${c.batch_id}')">
                <div class="campaign-card-header">
                    <div class="campaign-card-title">
                        <div class="channel-icon ${c.channel}">
                            ${channelIcon(c.channel)}
                        </div>
                        <div style="min-width:0">
                            <div class="campaign-subject">${subjectText}</div>
                            <div class="campaign-meta">${isSuperAdmin && !selectedOrgId && c.org_name ? '<strong>' + escapeHtml(c.org_name) + '</strong> &middot; ' : ''}${channelLabel} &middot; ${dateStr} &middot; ${c.total_recipients || 0} ${t('outgoing.recipients', 'recipients')}${countdown ? ' &middot; ' + countdown : ''}</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        ${cardAction}
                        <div class="campaign-status ${c.status}">${statusLabel}</div>
                    </div>
                </div>
                ${automationLink}
                <div class="campaign-stats">
                    <div class="campaign-stat">
                        <span class="campaign-stat-value">${formatNum(c.delivered || 0)}</span>
                        <span class="campaign-stat-label">${t('outgoing.delivered', 'Delivered')}</span>
                    </div>
                    <div class="campaign-stat">
                        <span class="campaign-stat-value">${formatNum(c.opened || 0)}</span>
                        <span class="campaign-stat-label">${t('outgoing.opened', 'Opened')}</span>
                    </div>
                    <div class="campaign-stat">
                        <span class="campaign-stat-value">${formatNum(c.clicked || 0)}</span>
                        <span class="campaign-stat-label">${t('outgoing.clicked', 'Clicked')}</span>
                    </div>
                    <div class="campaign-stat">
                        <span class="campaign-stat-value">${formatNum(c.bounced || 0)}</span>
                        <span class="campaign-stat-label">${t('outgoing.bounced', 'Bounced')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Detail Modal ─────────────────────────────────────────────────
    async function openDetail(batchId) {
        selectedBatch = campaigns.find(c => c.batch_id === batchId);
        if (!selectedBatch) return;

        const modal = document.getElementById('detail-modal');
        const content = document.getElementById('detail-modal-body');

        // Show modal with loading
        modal.classList.add('open');
        content.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>${t('outgoing.loadingDetail', 'Loading details...')}</span></div>`;

        // Load recipients
        const recipients = await loadRecipients(batchId);
        renderDetailContent(selectedBatch, recipients);
    }

    function renderDetailContent(batch, recipients) {
        const content = document.getElementById('detail-modal-body');
        const channelLabel = { email: 'Email', sms: 'SMS', push: 'Push', in_app: 'In-App' }[batch.channel] || batch.channel;
        const dateStr = formatDate(batch.sent_at || batch.scheduled_for || batch.created_at);

        const bodyPreview = batch.body
            ? batch.body.replace(/<[^>]+>/g, '').slice(0, 500)
            : '';

        const canPause = batch.automation_id && batch.automation_enabled !== false;
        const canCancel = ['scheduled', 'draft'].includes(batch.status);
        const isEditable = ['draft', 'scheduled', 'paused'].includes(batch.status);

        // Segment editing
        const segmentOptions = ['all', 'new', 'active', 'at_risk', 'vip', 'custom'];
        const segmentSelect = isEditable
            ? `<div class="modal-section">
                <div class="modal-section-title">${t('outgoing.audience', 'Audience Segment')}</div>
                <select class="filter-select" id="modal-segment-select" style="min-width:180px">
                    ${segmentOptions.map(s => `<option value="${s}" ${batch.segment === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>`).join('')}
                </select>
                <button class="btn-sm btn-segment-inactive" style="margin-left:8px" id="modal-segment-save" data-batch-id="${batch.batch_id}">${t('outgoing.save', 'Save')}</button>
               </div>`
            : (batch.segment ? `<div class="modal-section">
                <div class="modal-section-title">${t('outgoing.audience', 'Audience Segment')}</div>
                <span style="font-size:14px;color:var(--color-text)">${batch.segment.charAt(0).toUpperCase() + batch.segment.slice(1).replace('_', ' ')}</span>
               </div>` : '');

        content.innerHTML = `
            <div class="modal-header">
                <div style="flex:1;min-width:0">
                    ${isEditable
                        ? `<div class="editable-subject" id="modal-subject-wrap">
                            <h2 class="editable-field" id="modal-subject" contenteditable="true" spellcheck="false">${escapeHtml(batch.subject || 'Campaign')}</h2>
                            <span class="edit-hint">${t('outgoing.clickToEdit', 'Click to edit')}</span>
                           </div>`
                        : `<h2>${escapeHtml(batch.subject || 'Campaign')}</h2>`
                    }
                    <div style="font-size:13px;color:var(--color-text-muted);margin-top:4px">${channelLabel} &middot; ${dateStr} &middot; <span class="campaign-status ${batch.status}" style="display:inline;padding:2px 8px">${formatStatus(batch.status)}</span></div>
                </div>
                <button class="modal-close" onclick="OutgoingManager.closeDetail()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>

            ${batch.automation_name ? `
            <div class="modal-section">
                <div class="modal-section-title">${t('outgoing.automation', 'Automation')}</div>
                <a class="campaign-automation-link" href="/app/automation.html?id=${batch.automation_id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    ${escapeHtml(batch.automation_name)}
                    <span class="campaign-category-badge">${escapeHtml(batch.automation_category || '')}</span>
                </a>
            </div>
            ` : ''}

            ${bodyPreview || isEditable ? `
            <div class="modal-section" id="message-preview-section">
                <div class="modal-section-title" style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('outgoing.messagePreview', 'Message Preview')}</span>
                    <div style="display:flex;gap:6px">
                        ${batch.channel === 'email' ? `<button class="btn-sm" id="btn-email-preview" onclick="OutgoingManager.toggleEmailPreview('${batch.batch_id}')">${t('outgoing.previewEmail', 'Preview Email')}</button>` : ''}
                        ${isEditable ? `<button class="btn-sm" id="btn-edit-msg" onclick="OutgoingManager.toggleEditMessage()">${t('outgoing.edit', 'Edit')}</button>` : ''}
                    </div>
                </div>
                <div id="message-preview-content">
                    <div class="modal-preview" id="msg-preview-text">${escapeHtml(bodyPreview)}</div>
                </div>
            </div>
            ` : ''}

            ${segmentSelect}

            <div class="modal-section">
                <div class="modal-section-title">${t('outgoing.deliveryStats', 'Delivery Stats')}</div>
                <div class="modal-stats-grid">
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.total_recipients || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.recipients', 'Recipients')}</div>
                    </div>
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.delivered || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.delivered', 'Delivered')}</div>
                    </div>
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.opened || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.opened', 'Opened')}</div>
                    </div>
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.clicked || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.clicked', 'Clicked')}</div>
                    </div>
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.bounced || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.bounced', 'Bounced')}</div>
                    </div>
                    <div class="modal-stat-card">
                        <div class="modal-stat-value">${formatNum(batch.unsubscribed || 0)}</div>
                        <div class="modal-stat-label">${t('outgoing.unsubscribed', 'Unsubscribed')}</div>
                    </div>
                </div>
            </div>

            ${recipients.length > 0 ? `
            <div class="modal-section">
                <div class="modal-section-title">${t('outgoing.recipientList', 'Recipients')} (${recipients.length})</div>
                <div class="modal-recipients-list">
                    ${recipients.map(r => {
                        const member = r.app_members;
                        const name = member ? [member.first_name, member.last_name].filter(Boolean).join(' ') : '';
                        const email = member?.email || 'Unknown';
                        return `
                            <div class="recipient-row">
                                <div>
                                    <span class="recipient-email">${escapeHtml(name || email)}</span>
                                    ${name ? `<span style="font-size:12px;color:var(--color-text-muted);margin-left:8px">${escapeHtml(email)}</span>` : ''}
                                </div>
                                <span class="recipient-status ${r.status}">${r.status}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            ` : ''}

            ${['draft', 'paused'].includes(batch.status) ? (() => {
                const suggestion = getNextSuggestedTime();
                const prefilledValue = batch.scheduled_for ? new Date(batch.scheduled_for).toISOString().slice(0, 16) : suggestion.value;
                const isPaused = batch.status === 'paused';
                const scheduleAction = isPaused ? `OutgoingManager.scheduleAndResume('${batch.batch_id}')` : `OutgoingManager.scheduleDraft('${batch.batch_id}')`;
                const scheduleLabel = isPaused ? t('outgoing.scheduleAndResume', 'Schedule & Resume') : t('outgoing.schedule', 'Schedule');
                return `
            <div class="modal-section">
                <div class="modal-section-title">${t('outgoing.scheduledFor', 'Schedule For')}</div>
                <div style="display:flex;gap:8px;align-items:center">
                    <input type="datetime-local" id="modal-schedule-input" class="filter-select" style="min-width:220px"
                        value="${prefilledValue}"
                        min="${new Date().toISOString().slice(0, 16)}">
                    <button class="btn-sm btn-save-active" onclick="${scheduleAction}">${scheduleLabel}</button>
                </div>
                <div class="royal-suggestion">
                    <span class="royal-suggestion-icon">👑</span>
                    <span class="royal-suggestion-text">${suggestion.label} — ${t('outgoing.highestOpenRates', 'highest open rates')}</span>
                    <button class="btn-sm" onclick="OutgoingManager.useSuggestion()">${t('outgoing.useSuggestion', 'Use suggestion')}</button>
                </div>
            </div>`;
            })() : ''}

            <div class="modal-actions">
                ${canPause ? `<button class="btn btn-outline" onclick="OutgoingManager.toggleAutomation('${batch.automation_id}', ${!batch.automation_enabled})">${batch.automation_enabled ? t('outgoing.pauseAutomation', 'Pause Automation') : t('outgoing.resumeAutomation', 'Resume Automation')}</button>` : ''}
                ${canCancel ? `<button class="btn btn-danger" onclick="OutgoingManager.cancelBatch('${batch.batch_id}')">${t('outgoing.cancelBatch', 'Cancel')}</button>` : ''}
                ${batch.status === 'paused' ? `<button class="btn btn-primary" onclick="OutgoingManager.resumeBatch('${batch.batch_id}'); OutgoingManager.closeDetail()">${t('outgoing.resume', 'Resume')}</button>` : ''}
            </div>
        `;

        // Bind segment change detection
        bindSegmentUI();
    }

    function bindSegmentUI() {
        const select = document.getElementById('modal-segment-select');
        const saveBtn = document.getElementById('modal-segment-save');
        if (!select || !saveBtn) return;

        const originalSegment = select.value;

        select.addEventListener('change', () => {
            if (select.value !== originalSegment) {
                saveBtn.classList.remove('btn-segment-inactive');
                saveBtn.classList.add('btn-save-active');
            } else {
                saveBtn.classList.add('btn-segment-inactive');
                saveBtn.classList.remove('btn-save-active');
            }
        });

        saveBtn.addEventListener('click', () => {
            const batchId = saveBtn.dataset.batchId;
            if (batchId) saveSegment(batchId);
        });
    }

    function closeDetail() {
        document.getElementById('detail-modal').classList.remove('open');
        selectedBatch = null;
    }

    // ── Edit Message ────────────────────────────────────────────────
    function toggleEditMessage() {
        if (!selectedBatch) return;
        const container = document.getElementById('message-preview-content');
        const btn = document.getElementById('btn-edit-msg');

        if (container.querySelector('textarea')) {
            // Save mode
            saveMessage();
            return;
        }

        // Switch to edit mode
        const body = selectedBatch.body || '';
        container.innerHTML = `<textarea class="modal-edit-textarea" id="msg-edit-textarea">${escapeHtml(body)}</textarea>`;
        btn.textContent = t('outgoing.save', 'Save');
        btn.classList.add('btn-save-active');
    }

    async function saveMessage() {
        if (!selectedBatch) return;
        const textarea = document.getElementById('msg-edit-textarea');
        const subjectEl = document.getElementById('modal-subject');
        const btn = document.getElementById('btn-edit-msg');

        const newBody = textarea ? textarea.value : selectedBatch.body;
        const newSubject = subjectEl ? subjectEl.textContent.trim() : selectedBatch.subject;

        const update = { body: newBody };
        if (selectedBatch.channel === 'email' && newSubject) {
            update.subject = newSubject;
        }

        const { error } = await db
            .from('app_message_batches')
            .update(update)
            .eq('id', selectedBatch.batch_id);

        if (error) {
            alert('Failed to save: ' + error.message);
            return;
        }

        // Update local data
        selectedBatch.body = newBody;
        if (update.subject) selectedBatch.subject = newSubject;

        // Switch back to preview mode
        const container = document.getElementById('message-preview-content');
        const preview = newBody.replace(/<[^>]+>/g, '').slice(0, 500);
        container.innerHTML = `<div class="modal-preview" id="msg-preview-text">${escapeHtml(preview)}</div>`;
        btn.textContent = t('outgoing.edit', 'Edit');
        btn.classList.remove('btn-save-active');

        // Update campaign list card
        renderCampaignList();
    }

    // ── Email Preview ───────────────────────────────────────────────
    function toggleEmailPreview(batchId) {
        if (!selectedBatch) return;
        const container = document.getElementById('message-preview-content');
        const btn = document.getElementById('btn-email-preview');
        const isPreview = container.querySelector('.email-preview-frame');

        if (isPreview) {
            // Switch back to raw
            const preview = (selectedBatch.body || '').replace(/<[^>]+>/g, '').slice(0, 500);
            container.innerHTML = `<div class="modal-preview" id="msg-preview-text">${escapeHtml(preview)}</div>`;
            btn.textContent = t('outgoing.previewEmail', 'Preview Email');
            return;
        }

        // Show email preview
        const body = escapeHtml(selectedBatch.body || '');
        const subject = escapeHtml(selectedBatch.subject || 'Campaign');
        container.innerHTML = `
            <div class="email-preview-frame">
                <div class="email-preview-header">
                    <div class="email-preview-logo">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2">
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                        </svg>
                        <span style="font-weight:600;color:var(--color-primary)">Royalty</span>
                    </div>
                    <div class="email-preview-subject">${subject}</div>
                </div>
                <div class="email-preview-body">${body.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>
                <div class="email-preview-footer">
                    <p>Sent via Royalty &middot; <a href="#">Unsubscribe</a></p>
                </div>
            </div>
        `;
        btn.textContent = t('outgoing.showRaw', 'Show Raw');
    }

    // ── Save Segment ────────────────────────────────────────────────
    async function saveSegment(batchId) {
        const select = document.getElementById('modal-segment-select');
        if (!select) return;

        const { error } = await db
            .from('app_message_batches')
            .update({ segment: select.value })
            .eq('id', batchId);

        if (error) {
            alert('Failed to save segment: ' + error.message);
            return;
        }

        // Update local
        const c = campaigns.find(x => x.batch_id === batchId);
        if (c) c.segment = select.value;
        if (selectedBatch) selectedBatch.segment = select.value;

        // Show success banner
        const section = select.closest('.modal-section');
        if (section) {
            const existing = section.querySelector('.segment-save-banner');
            if (existing) existing.remove();
            const banner = document.createElement('div');
            banner.className = 'segment-save-banner';
            banner.textContent = '✓ ' + t('outgoing.segmentSaved', 'Segment saved');
            section.prepend(banner);
            setTimeout(() => banner.remove(), 2500);
        }

        // Confetti
        if (typeof celebrateSubtle === 'function') {
            celebrateSubtle();
        }

        // Reset button to inactive
        const saveBtn = document.getElementById('modal-segment-save');
        if (saveBtn) {
            saveBtn.classList.add('btn-segment-inactive');
            saveBtn.classList.remove('btn-save-active');
        }
    }

    // ── Actions ──────────────────────────────────────────────────────
    async function pauseBatch(batchId) {
        const { error } = await db
            .from('app_message_batches')
            .update({ status: 'paused' })
            .eq('id', batchId)
            .in('status', ['scheduled', 'sending']);

        if (error) {
            alert('Failed to pause: ' + error.message);
            return;
        }

        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    async function resumeBatch(batchId) {
        const { error } = await db
            .from('app_message_batches')
            .update({ status: 'scheduled' })
            .eq('id', batchId)
            .eq('status', 'paused');

        if (error) {
            alert('Failed to resume: ' + error.message);
            return;
        }

        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    async function toggleAutomation(automationId, enable) {
        const action = enable ? 'resume' : 'pause';
        if (!confirm(t(`outgoing.confirm${enable ? 'Resume' : 'Pause'}`, `Are you sure you want to ${action} this automation?`))) return;

        const update = { is_enabled: enable };
        if (!enable) {
            update.paused_at = new Date().toISOString();
            update.pause_reason = 'manual_pause';
        } else {
            update.paused_at = null;
            update.pause_reason = null;
        }

        const { error } = await db
            .from('automation_definitions')
            .update(update)
            .eq('id', automationId);

        if (error) {
            alert('Failed to update automation: ' + error.message);
            return;
        }

        closeDetail();
        await loadCampaigns();
        renderCampaignList();
    }

    async function cancelBatch(batchId) {
        if (!confirm(t('outgoing.confirmCancel', 'Cancel this campaign? This cannot be undone.'))) return;

        const { error } = await db
            .from('app_message_batches')
            .update({ status: 'cancelled' })
            .eq('id', batchId)
            .in('status', ['scheduled', 'draft']);

        if (error) {
            alert('Failed to cancel: ' + error.message);
            return;
        }

        closeDetail();
        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    async function pauseAllAutomations() {
        if (!confirm(t('outgoing.confirmPauseAll', 'Pause ALL automations? No automated campaigns will run until you resume them.'))) return;

        const { error } = await db
            .from('automation_definitions')
            .update({ is_enabled: false, paused_at: new Date().toISOString(), pause_reason: 'manual_pause_all' })
            .eq('organization_id', currentOrgId)
            .eq('is_enabled', true);

        if (error) {
            alert('Failed: ' + error.message);
            return;
        }

        await loadCampaigns();
        renderCampaignList();
    }

    async function resumeAllAutomations() {
        if (!confirm(t('outgoing.confirmResumeAll', 'Resume ALL paused automations?'))) return;

        const { error } = await db
            .from('automation_definitions')
            .update({ is_enabled: true, paused_at: null, pause_reason: null })
            .eq('organization_id', currentOrgId)
            .eq('is_enabled', false)
            .eq('pause_reason', 'manual_pause_all');

        if (error) {
            alert('Failed: ' + error.message);
            return;
        }

        await loadCampaigns();
        renderCampaignList();
    }

    // ── Filters ──────────────────────────────────────────────────────
    function bindFilterEvents() {
        const channelEl = document.getElementById('filter-channel');
        const statusEl = document.getElementById('filter-status');
        const daysEl = document.getElementById('filter-days');
        const searchEl = document.getElementById('filter-search');
        const sortEl = document.getElementById('filter-sort');

        if (channelEl) channelEl.addEventListener('change', applyFilters);
        if (statusEl) statusEl.addEventListener('change', applyFilters);
        if (daysEl) daysEl.addEventListener('change', applyFilters);
        if (searchEl) searchEl.addEventListener('input', applySearch);
        if (sortEl) sortEl.addEventListener('change', applySort);
    }

    async function applyFilters() {
        currentFilters.channel = document.getElementById('filter-channel')?.value || null;
        currentFilters.status = document.getElementById('filter-status')?.value || null;
        currentFilters.days = parseInt(document.getElementById('filter-days')?.value || '30', 10);

        renderSkeleton();
        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    function applySearch() {
        searchQuery = document.getElementById('filter-search')?.value || '';
        renderCampaignList();
    }

    function applySort() {
        sortBy = document.getElementById('filter-sort')?.value || 'date';
        renderCampaignList();
    }

    // ── Helpers ──────────────────────────────────────────────────────
    function getNextSuggestedTime() {
        const now = new Date();
        const day = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        let target = new Date(now);

        // Find next Tuesday (2) or Thursday (4)
        if ((day === 2 || day === 4) && now.getHours() < 10) {
            // Today is Tue/Thu and before 10 AM — use today
        } else {
            // Advance to next Tue or Thu
            const daysUntilTue = (2 - day + 7) % 7 || 7;
            const daysUntilThu = (4 - day + 7) % 7 || 7;
            const daysToAdd = Math.min(daysUntilTue, daysUntilThu);
            target.setDate(target.getDate() + daysToAdd);
        }

        target.setHours(10, 0, 0, 0);
        const dayName = target.toLocaleDateString(undefined, { weekday: 'long' });
        const label = `${dayName} 10:00 AM`;
        const pad = n => String(n).padStart(2, '0');
        const value = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T10:00`;

        return { date: target, label, value };
    }

    function useSuggestion() {
        const input = document.getElementById('modal-schedule-input');
        if (input) {
            input.value = getNextSuggestedTime().value;
        }
    }

    function formatNum(n) {
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(n);
    }

    function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatStatus(status) {
        const map = {
            draft: t('outgoing.statusDraft', 'Draft'),
            scheduled: t('outgoing.statusScheduled', 'Scheduled'),
            sending: t('outgoing.statusSending', 'Sending'),
            sent: t('outgoing.statusSent', 'Sent'),
            partially_sent: t('outgoing.statusPartial', 'Partial'),
            failed: t('outgoing.statusFailed', 'Failed'),
            paused: t('outgoing.statusPaused', 'Paused'),
            cancelled: t('outgoing.statusCancelled', 'Cancelled'),
        };
        return map[status] || status;
    }

    function channelIcon(channel) {
        const icons = {
            email: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
            sms: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
            push: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
            in_app: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        };
        return icons[channel] || icons.email;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Schedule Draft ─────────────────────────────────────────────────
    async function scheduleDraft(batchId) {
        const input = document.getElementById('modal-schedule-input');
        if (!input || !input.value) {
            alert('Please select a date and time.');
            return;
        }

        const scheduledFor = new Date(input.value).toISOString();
        const { error } = await db
            .from('app_message_batches')
            .update({ status: 'scheduled', scheduled_for: scheduledFor })
            .eq('id', batchId)
            .eq('status', 'draft');

        if (error) {
            alert('Failed to schedule: ' + error.message);
            return;
        }

        closeDetail();
        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    async function scheduleAndResume(batchId) {
        const input = document.getElementById('modal-schedule-input');
        if (!input || !input.value) {
            alert('Please select a date and time.');
            return;
        }

        const scheduledFor = new Date(input.value).toISOString();
        const { error } = await db
            .from('app_message_batches')
            .update({ status: 'scheduled', scheduled_for: scheduledFor })
            .eq('id', batchId)
            .eq('status', 'paused');

        if (error) {
            alert('Failed to schedule: ' + error.message);
            return;
        }

        closeDetail();
        await Promise.all([loadSummary(), loadCampaigns()]);
        renderAll();
    }

    // ── Public API ───────────────────────────────────────────────────
    return {
        init,
        openDetail,
        closeDetail,
        toggleAutomation,
        cancelBatch,
        pauseBatch,
        resumeBatch,
        pauseAllAutomations,
        resumeAllAutomations,
        toggleEditMessage,
        toggleEmailPreview,
        saveSegment,
        scheduleDraft,
        scheduleAndResume,
        useSuggestion,
    };
})();
