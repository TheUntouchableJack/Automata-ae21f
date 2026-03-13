/**
 * CEO Dashboard — Royalty Self-Growth
 *
 * Dormant by default. Nothing runs until Jay hits Start.
 * This page is the board view: Royal reports, Jay reviews.
 *
 * Status model:
 *   stopped  — cron disabled entirely
 *   paused   — cron fires, observes + generates plan, skips all execution
 *   running  — full autonomy
 */
;(function () {
    'use strict';

    // ── Supabase client (shared via auth.js) ───────────────────────────
    // auth.js exposes window.supabase + requireAuth + getValidSession

    // SUPABASE_URL and SUPABASE_ANON_KEY are declared as consts in auth.js (same global scope)
    const CEO_FUNCTIONS_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1';

    // ── State ──────────────────────────────────────────────────────────
    let ceoChatHistory = [];
    let ceoCurrentStatus = 'stopped';
    let ceoIsTyping = false;

    // ── DOM refs ───────────────────────────────────────────────────────
    const els = {
        statusDot:      () => document.getElementById('ceo-status-dot'),
        statusLabel:    () => document.getElementById('ceo-status-label'),
        lastRun:        () => document.getElementById('ceo-last-run'),
        btnRunning:     () => document.getElementById('ceo-btn-running'),
        btnPaused:      () => document.getElementById('ceo-btn-paused'),
        btnStopped:     () => document.getElementById('ceo-btn-stopped'),
        briefingGrid:   () => document.getElementById('ceo-briefing-grid'),
        taskSection:    () => document.getElementById('ceo-task-queue-section'),
        taskList:       () => document.getElementById('ceo-task-list'),
        taskCount:      () => document.getElementById('ceo-task-count'),
        outreachSection:() => document.getElementById('ceo-outreach-section'),
        outreachList:   () => document.getElementById('ceo-outreach-list'),
        chatThread:     () => document.getElementById('ceo-chat-thread'),
        chatEmpty:      () => document.getElementById('ceo-chat-empty'),
        chatInput:      () => document.getElementById('ceo-chat-input'),
        chatSend:       () => document.getElementById('ceo-chat-send'),
        logList:        () => document.getElementById('ceo-log-list'),
    };

    // ── Boot ───────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        // auth.js requireAuth redirects to /app/login.html if not authed
        if (typeof requireAuth === 'function') {
            const session = await requireAuth();
            if (!session) return;
        }

        // Auto-grow textarea
        const input = els.chatInput();
        if (input) {
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ceoDashboard.sendMessage();
                }
            });
        }

        await loadAll();
    });

    async function loadAll() {
        await Promise.allSettled([
            loadConfig(),
            loadBriefing(),
            loadPlatformOutreach(),
            loadPendingTasks(),
            loadOutreachQueue(),
            loadRecentLog(),
        ]);
    }

    // ── Config / Status ────────────────────────────────────────────────
    async function loadConfig() {
        try {
            const { data, error } = await window.supabase
                .from('self_growth_config')
                .select('status, updated_at, updated_by')
                .limit(1)
                .single();

            if (error) throw error;
            applyStatus(data.status, data.updated_at);
        } catch (e) {
            console.error('[ceo] loadConfig error:', e);
            applyStatus('stopped', null);
        }
    }

    function applyStatus(status, updatedAt) {
        ceoCurrentStatus = status;

        const dot   = els.statusDot();
        const label = els.statusLabel();
        const lastRun = els.lastRun();

        // Dot colour
        dot.className = 'ceo-status-dot';
        dot.classList.add(`ceo-status-dot--${status}`);

        // Label
        const labels = { running: 'Running', paused: 'Paused', stopped: 'Stopped' };
        label.textContent = labels[status] || status;

        // Last updated
        if (updatedAt && lastRun) {
            lastRun.textContent = `Last updated ${formatRelativeTime(updatedAt)}`;
        }

        // Button active states (preserve per-button type class)
        const typeClass = { running: 'ceo-ctrl-btn--running', paused: 'ceo-ctrl-btn--pause', stopped: 'ceo-ctrl-btn--stop' };
        const btns = { running: els.btnRunning(), paused: els.btnPaused(), stopped: els.btnStopped() };
        Object.entries(btns).forEach(([s, btn]) => {
            if (!btn) return;
            btn.className = `ceo-ctrl-btn ${typeClass[s]}`;
            if (s === status) btn.classList.add(`ceo-ctrl-btn--active-${s}`);
        });

        // Show task queue section if paused or pending tasks
        refreshTaskSectionVisibility();
    }

    // ── Briefing Cards ─────────────────────────────────────────────────
    async function loadBriefing() {
        const grid = els.briefingGrid();
        if (!grid) return;

        // Load live data
        try {
            const [outreachRes, logRes, draftsRes, paidOrgsRes, trialOrgsRes] = await Promise.all([
                window.supabase
                    .from('outreach_queue')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', 'draft'),
                window.supabase
                    .from('self_growth_log')
                    .select('revenue_delta_cents')
                    .gte('created_at', startOfToday())
                    .not('revenue_delta_cents', 'is', null),
                window.supabase
                    .from('newsletter_articles')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', 'draft'),
                window.supabase
                    .from('organizations')
                    .select('id', { count: 'exact', head: true })
                    .eq('subscription_status', 'active'),
                window.supabase
                    .from('organizations')
                    .select('id', { count: 'exact', head: true })
                    .gte('created_at', thirtyDaysAgo())
                    .neq('subscription_status', 'active'),
            ]);

            const outreachCount = outreachRes.count || 0;
            const draftsCount   = draftsRes.count || 0;
            const paidOrgs      = paidOrgsRes.count || 0;
            const trialOrgs     = trialOrgsRes.count || 0;
            const mrrDisplay    = paidOrgs === 0 ? '$0' : `${paidOrgs} paid`;
            const mrrSub        = paidOrgs === 0 ? '0 paid subscriptions' : `${paidOrgs} active subscriber${paidOrgs !== 1 ? 's' : ''}`;

            grid.innerHTML = `
                ${briefingCard('MRR', mrrDisplay, mrrSub, paidOrgs > 0 ? 'positive' : '')}
                ${briefingCard('New Trials', trialOrgs, trialOrgs > 0 ? 'in the last 30 days' : 'no new signups', '')}
                ${briefingCard('Drafts Ready', draftsCount, draftsCount > 0 ? 'articles need review' : 'queue is clear', draftsCount > 3 ? 'warning' : '')}
                ${briefingCard('Outreach Queued', outreachCount, outreachCount > 0 ? 'awaiting approval' : 'nothing queued', outreachCount > 0 ? 'warning' : '')}
            `;

            // Cards fire suggested questions when clicked
            grid.querySelectorAll('.ceo-briefing-card').forEach(card => {
                card.addEventListener('click', () => {
                    const question = card.dataset.question;
                    if (question) ceoDashboard.fireChatQuestion(question);
                });
            });
        } catch (e) {
            console.error('[ceo] loadBriefing error:', e);
            grid.innerHTML = briefingCard('Status', 'Error', 'Could not load briefing data', '');
        }
    }

    function briefingCard(label, value, sub, modifier) {
        const question = {
            'MRR':              "What's our MRR this month?",
            'New Trials':       "Who hasn't activated their trial?",
            'Drafts Ready':     "What should I publish this week?",
            'Outreach Queued':  "Review my outreach drafts",
        }[label] || '';

        return `
            <div class="ceo-briefing-card" data-question="${escapeHtml(question)}" title="${question ? 'Click to ask Royal' : ''}">
                <div class="ceo-briefing-card-label">${escapeHtml(label)}</div>
                <div class="ceo-briefing-card-value${modifier ? ` ceo-briefing-card-value--${modifier}` : ''}">${escapeHtml(String(value))}</div>
                <div class="ceo-briefing-card-sub">${escapeHtml(sub)}</div>
            </div>
        `;
    }

    // ── Platform Outreach Overview ─────────────────────────────────────
    const OUTREACH_PLATFORMS = [
        {
            channel: 'email',
            label: 'Email',
            icon: '✉',
            iconBg: '#ede9fe',
            iconColor: '#7c3aed',
            active: true,
            description: 'Trial activation and win-back emails via Resend',
        },
        {
            channel: 'x_reply',
            label: 'X / Twitter',
            icon: '𝕏',
            iconBg: '#f3f4f6',
            iconColor: '#111827',
            active: false,
            description: 'Replies to SMB owners posting about retention, churn, or loyalty',
        },
        {
            channel: 'linkedin',
            label: 'LinkedIn',
            icon: 'in',
            iconBg: '#dbeafe',
            iconColor: '#1d4ed8',
            active: false,
            description: 'Direct messages to SMB owners and local business operators',
        },
        {
            channel: 'reddit',
            label: 'Reddit',
            icon: 'r/',
            iconBg: '#fff7ed',
            iconColor: '#ea580c',
            active: false,
            description: 'Helpful replies in r/smallbusiness, r/entrepreneur, r/restaurantowners',
        },
    ];

    async function loadPlatformOutreach() {
        const grid = document.getElementById('ceo-platform-grid');
        if (!grid) return;
        try {
            const { data, error } = await window.supabase
                .from('outreach_queue')
                .select('channel, status, outcome');
            if (error) throw error;

            // Aggregate counts per channel
            const stats = {};
            for (const row of (data || [])) {
                const ch = row.channel || 'email';
                if (!stats[ch]) stats[ch] = { sent: 0, drafted: 0, bounced: 0, rejected: 0, replied: 0, activated: 0 };
                if (row.status === 'sent')     stats[ch].sent++;
                if (row.status === 'draft' || row.status === 'approved') stats[ch].drafted++;
                if (row.status === 'bounced')  stats[ch].bounced++;
                if (row.status === 'rejected') stats[ch].rejected++;
                // Outcome parsing — look for keywords written by send-approved-outreach
                const outcome = (row.outcome || '').toLowerCase();
                if (outcome.includes('replied') || outcome.includes('reply')) stats[ch].replied++;
                if (outcome.includes('activated') || outcome.includes('activation')) stats[ch].activated++;
            }

            grid.innerHTML = OUTREACH_PLATFORMS.map(p => renderPlatformCard(p, stats[p.channel] || null)).join('');
        } catch (e) {
            console.error('[ceo] loadPlatformOutreach error:', e);
        }
    }

    function renderPlatformCard(platform, s) {
        const active = platform.active;
        const sent     = s ? s.sent     : 0;
        const drafted  = s ? s.drafted  : 0;
        const bounced  = s ? s.bounced  : 0;
        const total    = sent + drafted;
        const pct      = total > 0 ? Math.round((sent / total) * 100) : 0;
        const responseRate = (s && s.sent > 0 && s.replied > 0) ? Math.round((s.replied / s.sent) * 100) + '%' : '—';
        const closeRate    = (s && s.sent > 0 && s.activated > 0) ? Math.round((s.activated / s.sent) * 100) + '%' : '—';

        return `
        <div class="ceo-platform-card${active ? '' : ' ceo-platform-card--inactive'}">
            <div class="ceo-platform-card-header">
                <div class="ceo-platform-card-name">
                    <div class="ceo-platform-icon" style="background:${escapeHtml(platform.iconBg)};color:${escapeHtml(platform.iconColor)}">${escapeHtml(platform.icon)}</div>
                    ${escapeHtml(platform.label)}
                </div>
                <span class="ceo-platform-badge ceo-platform-badge--${active ? 'active' : 'soon'}">${active ? 'Active' : 'Soon'}</span>
            </div>
            ${active ? `
            <div class="ceo-platform-metrics">
                <div>
                    <div class="ceo-platform-metric-label">Sent</div>
                    <div class="ceo-platform-metric-value">${sent}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">Pending</div>
                    <div class="ceo-platform-metric-value">${drafted}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">Response rate</div>
                    <div class="ceo-platform-metric-value${responseRate === '—' ? ' ceo-platform-metric-value--muted' : ''}">${escapeHtml(responseRate)}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">Close rate</div>
                    <div class="ceo-platform-metric-value${closeRate === '—' ? ' ceo-platform-metric-value--muted' : ''}">${escapeHtml(closeRate)}</div>
                </div>
            </div>
            ${bounced > 0 ? `<div class="ceo-platform-desc" style="color:#ef4444">${bounced} bounce${bounced !== 1 ? 's' : ''}</div>` : ''}
            <div class="ceo-platform-progress"><div class="ceo-platform-progress-fill" style="width:${pct}%"></div></div>
            <div class="ceo-platform-desc">${pct}% of pipeline sent${total === 0 ? ' — no outreach yet' : ''}</div>
            ` : `
            <div class="ceo-platform-desc">${escapeHtml(platform.description)}</div>
            `}
        </div>`;
    }

    // ── Pending Task Queue ─────────────────────────────────────────────
    async function loadPendingTasks() {
        try {
            const { data, error } = await window.supabase
                .from('self_growth_log')
                .select('id, action_type, description, created_at')
                .eq('status', 'pending_approval')
                .order('created_at', { ascending: true })
                .limit(50);

            if (error) throw error;
            renderTaskQueue(data || []);
        } catch (e) {
            console.error('[ceo] loadPendingTasks error:', e);
        }
    }

    function renderTaskQueue(tasks) {
        const list    = els.taskList();
        const counter = els.taskCount();
        if (!list) return;

        if (counter) {
            counter.textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''} pending`;
        }

        if (tasks.length === 0) {
            list.innerHTML = '<div class="ceo-task-queue-empty">No pending tasks — Royal is clear to run (or nothing has generated yet)</div>';
            refreshTaskSectionVisibility(0);
            return;
        }

        list.innerHTML = tasks.map(task => `
            <div class="ceo-task-row" data-id="${task.id}">
                <span class="ceo-task-type">${escapeHtml(task.action_type)}</span>
                <span class="ceo-task-text">${escapeHtml(task.description)}</span>
                <div class="ceo-task-actions">
                    <button class="ceo-task-btn ceo-task-btn--approve" onclick="ceoDashboard.approveTask('${task.id}', this)">Approve</button>
                    <button class="ceo-task-btn ceo-task-btn--skip" onclick="ceoDashboard.skipTask('${task.id}', this)">Skip</button>
                </div>
            </div>
        `).join('');

        refreshTaskSectionVisibility(tasks.length);
    }

    function refreshTaskSectionVisibility(count) {
        const section = els.taskSection();
        if (!section) return;
        // Show task queue if paused OR there are pending tasks
        const show = ceoCurrentStatus === 'paused' || (count !== undefined ? count > 0 : true);
        section.style.display = show ? 'block' : 'none';
    }

    // ── Outreach Queue ─────────────────────────────────────────────────
    async function loadOutreachQueue() {
        try {
            const { data, error } = await window.supabase
                .from('outreach_queue')
                .select('id, target_email, target_name, channel, subject, body_text, veto_window_ends, created_at')
                .eq('status', 'draft')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;
            renderOutreachQueue(data || []);
        } catch (e) {
            console.error('[ceo] loadOutreachQueue error:', e);
        }
    }

    function renderOutreachQueue(items) {
        const section = els.outreachSection();
        const list    = els.outreachList();
        if (!section || !list) return;

        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = items.map(item => {
            const vetoEnd = item.veto_window_ends ? new Date(item.veto_window_ends) : null;
            const vetoLabel = vetoEnd
                ? (vetoEnd > new Date() ? `Veto window closes ${formatRelativeTime(item.veto_window_ends)}` : 'Veto window passed')
                : '';

            return `
                <div class="ceo-outreach-item" data-id="${item.id}">
                    <div class="ceo-outreach-item-header">
                        <span class="ceo-outreach-item-to">${escapeHtml(item.target_name || item.target_email)}</span>
                        <span class="ceo-outreach-item-channel">${escapeHtml(item.channel)}</span>
                        <span class="ceo-outreach-item-veto">${escapeHtml(vetoLabel)}</span>
                    </div>
                    ${item.subject ? `<div class="ceo-outreach-item-subject">${escapeHtml(item.subject)}</div>` : ''}
                    <div class="ceo-outreach-item-preview">${escapeHtml(item.body_text || '')}</div>
                    <div class="ceo-outreach-item-actions">
                        <button class="ceo-task-btn ceo-task-btn--approve" onclick="ceoDashboard.approveOutreach('${item.id}', this)">Approve & Send</button>
                        <button class="ceo-task-btn" onclick="ceoDashboard.rejectOutreach('${item.id}', this)">Reject</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── Recent Activity Log ────────────────────────────────────────────
    async function loadRecentLog() {
        try {
            const { data, error } = await window.supabase
                .from('self_growth_log')
                .select('id, action_type, description, status, created_at')
                .not('status', 'eq', 'pending_approval')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;
            renderRecentLog(data || []);
        } catch (e) {
            console.error('[ceo] loadRecentLog error:', e);
        }
    }

    function renderRecentLog(items) {
        const list = els.logList();
        if (!list) return;

        if (items.length === 0) {
            list.innerHTML = '<div class="ceo-empty">No activity yet — Royal hasn\'t run yet.</div>';
            return;
        }

        list.innerHTML = items.map(item => `
            <div class="ceo-log-item ceo-log-item--${item.status}">
                <span class="ceo-log-item-type">${escapeHtml(item.action_type)}</span>
                <span class="ceo-log-item-desc">${escapeHtml(item.description)}</span>
                <span class="ceo-log-item-time">${formatRelativeTime(item.created_at)}</span>
            </div>
        `).join('');
    }

    // ── Set Autonomy Status ────────────────────────────────────────────
    async function setStatus(newStatus) {
        if (newStatus === ceoCurrentStatus) return;

        // Disable buttons while saving
        ['running', 'paused', 'stopped'].forEach(s => {
            const btn = document.getElementById(`ceo-btn-${s}`);
            if (btn) btn.disabled = true;
        });

        try {
            // Single-row table — update without a WHERE clause (service role is blocked, use RLS policy)
            const { error } = await window.supabase
                .from('self_growth_config')
                .update({ status: newStatus, updated_by: 'jay' })
                .neq('status', '__never__'); // update all rows (singleton table)

            if (error) throw error;

            applyStatus(newStatus, new Date().toISOString());
            showToast(`Status set to ${newStatus}`, 'success');

            // If switching to paused, show task queue section
            if (newStatus === 'paused') {
                const section = els.taskSection();
                if (section) section.style.display = 'block';
            }
        } catch (e) {
            console.error('[ceo] setStatus error:', e);
            showToast('Failed to update status', 'error');
        } finally {
            ['running', 'paused', 'stopped'].forEach(s => {
                const btn = document.getElementById(`ceo-btn-${s}`);
                if (btn) btn.disabled = false;
            });
        }
    }

    // ── Task Actions ───────────────────────────────────────────────────
    async function approveTask(id, btn) {
        await updateTaskStatus(id, 'approved', btn);
    }

    async function skipTask(id, btn) {
        await updateTaskStatus(id, 'skipped', btn);
    }

    async function updateTaskStatus(id, status, btn) {
        if (btn) { btn.disabled = true; btn.textContent = '…'; }

        try {
            const { error } = await window.supabase
                .from('self_growth_log')
                .update({ status })
                .eq('id', id);

            if (error) throw error;

            // Remove row from UI
            const row = document.querySelector(`.ceo-task-row[data-id="${id}"]`);
            if (row) row.remove();

            // Update count
            const remaining = document.querySelectorAll('.ceo-task-row').length;
            const counter = els.taskCount();
            if (counter) counter.textContent = `${remaining} task${remaining !== 1 ? 's' : ''} pending`;

            if (remaining === 0) {
                const list = els.taskList();
                if (list) list.innerHTML = '<div class="ceo-task-queue-empty">All tasks reviewed</div>';
            }

            showToast(status === 'approved' ? 'Task approved' : 'Task skipped');
        } catch (e) {
            console.error('[ceo] updateTaskStatus error:', e);
            showToast('Failed to update task', 'error');
            if (btn) { btn.disabled = false; btn.textContent = status === 'approved' ? 'Approve' : 'Skip'; }
        }
    }

    async function approveAllTasks() {
        const rows = document.querySelectorAll('.ceo-task-row');
        for (const row of rows) {
            const id = row.dataset.id;
            if (id) await updateTaskStatus(id, 'approved', null);
        }
    }

    async function skipAllTasks() {
        const rows = document.querySelectorAll('.ceo-task-row');
        for (const row of rows) {
            const id = row.dataset.id;
            if (id) await updateTaskStatus(id, 'skipped', null);
        }
    }

    // ── Outreach Actions ───────────────────────────────────────────────
    async function approveOutreach(id, btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        try {
            // Update DB status first
            const { error } = await window.supabase
                .from('outreach_queue')
                .update({ status: 'approved', approved_by: 'jay' })
                .eq('id', id);

            if (error) throw error;

            // Immediately trigger send (don't wait for cron)
            const session = await getValidSession();
            const sendRes = await fetch(`${CEO_FUNCTIONS_URL}/send-approved-outreach`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ outreach_id: id }),
            });

            const result = sendRes.ok ? await sendRes.json() : null;
            const sent = result?.success;

            const item = document.querySelector(`.ceo-outreach-item[data-id="${id}"]`);
            if (item) item.remove();

            showToast(sent ? 'Email sent!' : 'Approved — will send shortly', 'success');

            const remaining = document.querySelectorAll('.ceo-outreach-item').length;
            if (remaining === 0) {
                const section = els.outreachSection();
                if (section) section.style.display = 'none';
            }
        } catch (e) {
            console.error('[ceo] approveOutreach error:', e);
            showToast('Failed to approve outreach', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Approve & Send'; }
        }
    }

    async function rejectOutreach(id, btn) {
        await updateOutreachStatus(id, 'rejected', btn, 'Outreach rejected');
    }

    async function updateOutreachStatus(id, status, btn, message) {
        if (btn) { btn.disabled = true; btn.textContent = '…'; }

        try {
            const { error } = await window.supabase
                .from('outreach_queue')
                .update({ status, approved_by: 'jay' })
                .eq('id', id);

            if (error) throw error;

            const item = document.querySelector(`.ceo-outreach-item[data-id="${id}"]`);
            if (item) item.remove();

            showToast(message, 'success');

            const remaining = document.querySelectorAll('.ceo-outreach-item').length;
            if (remaining === 0) {
                const section = els.outreachSection();
                if (section) section.style.display = 'none';
            }
        } catch (e) {
            console.error('[ceo] updateOutreachStatus error:', e);
            showToast('Failed to update outreach', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Approve & Send'; }
        }
    }

    // ── Chat ───────────────────────────────────────────────────────────
    function sendSuggested(btn) {
        const question = btn.textContent.trim();
        fireChatQuestion(question);
    }

    function fireChatQuestion(question) {
        const input = els.chatInput();
        if (input) input.value = question;
        sendMessage();
    }

    async function sendMessage() {
        const input = els.chatInput();
        const send  = els.chatSend();
        if (!input || ceoIsTyping) return;

        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';

        // Hide empty state
        const empty = els.chatEmpty();
        if (empty) empty.style.display = 'none';

        // Append user message
        appendMessage('jay', text);
        ceoChatHistory.push({ role: 'user', content: text });

        // Show loading
        ceoIsTyping = true;
        if (send) send.disabled = true;
        const loadingEl = appendMessage('royal', '…', true);

        try {
            const session = typeof getValidSession === 'function' ? await getValidSession() : null;
            const token   = session?.access_token;

            const response = await fetch(`${CEO_FUNCTIONS_URL}/royal-ai-prompt`, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    mode:     'ceo',
                    messages: ceoChatHistory,
                    context:  {
                        growth_status: ceoCurrentStatus,
                    },
                }),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(err || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const reply = data.content || data.message || data.response || 'Royal had no response.';

            // Update loading bubble → real response
            if (loadingEl) {
                loadingEl.querySelector('.ceo-msg-bubble').textContent = '';
                renderMarkdownText(loadingEl.querySelector('.ceo-msg-bubble'), reply);
            }

            ceoChatHistory.push({ role: 'assistant', content: reply });
        } catch (e) {
            console.error('[ceo] chat error:', e);
            if (loadingEl) {
                loadingEl.querySelector('.ceo-msg-bubble').textContent =
                    'Royal encountered an error. Please try again.';
            }
        } finally {
            ceoIsTyping = false;
            if (send) send.disabled = false;
        }
    }

    function appendMessage(role, text, isLoading = false) {
        const thread = els.chatThread();
        if (!thread) return null;

        const isJay = role === 'jay';
        const el = document.createElement('div');
        el.className = `ceo-msg${isJay ? ' ceo-msg--jay' : ''}`;

        const initials = isJay ? 'J' : 'R';

        el.innerHTML = `
            <div class="ceo-msg-avatar">${initials}</div>
            <div class="ceo-msg-bubble">${isLoading ? '<div class="ceo-typing-dots"><span></span><span></span><span></span></div>' : escapeHtml(text)}</div>
        `;

        thread.appendChild(el);
        thread.scrollTop = thread.scrollHeight;
        return el;
    }

    // Minimal markdown: bold, inline code, newlines
    function renderMarkdownText(el, text) {
        // Escape then apply minimal markdown
        let html = escapeHtml(text);
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\n/g, '<br>');
        el.innerHTML = html;
    }

    // ── Utilities ──────────────────────────────────────────────────────
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function startOfToday() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }

    function thirtyDaysAgo() {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString();
    }

    function formatRelativeTime(iso) {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins < 1)   return 'just now';
        if (mins < 60)  return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7)   return `${days}d ago`;
        return new Date(iso).toLocaleDateString();
    }

    let ceoToastTimeout;
    function showToast(message, type = '') {
        if (ceoToastTimeout) clearTimeout(ceoToastTimeout);
        const existing = document.querySelector('.ceo-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `ceo-toast${type ? ` ceo-toast--${type}` : ''}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        ceoToastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ── Public API ─────────────────────────────────────────────────────
    window.ceoDashboard = {
        setStatus,
        approveTask,
        skipTask,
        approveAllTasks,
        skipAllTasks,
        approveOutreach,
        rejectOutreach,
        sendMessage,
        sendSuggested,
        fireChatQuestion,
    };

})();
