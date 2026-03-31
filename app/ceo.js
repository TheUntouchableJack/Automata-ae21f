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

    // CEO chat thread persistence
    let ceoCeoThreadId = null;
    let ceoCeoOrgId    = null;
    let ceoCeoUserId   = null;

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
        churnSection:   () => document.getElementById('ceo-churn-section'),
        churnList:      () => document.getElementById('ceo-churn-list'),
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
            ceoCeoUserId = session.user?.id || null;
        }

        // Resolve org for chat thread persistence
        if (ceoCeoUserId) {
            try {
                const { data: membership } = await window.supabase
                    .from('organization_members')
                    .select('organization_id')
                    .eq('user_id', ceoCeoUserId)
                    .limit(1)
                    .single();
                if (membership) ceoCeoOrgId = membership.organization_id;
            } catch (_) { /* non-fatal */ }
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
        initChatFab();
        loadCeoThread(); // fire-and-forget — restores last CEO chat thread
    });

    async function loadAll() {
        await Promise.allSettled([
            loadConfig(),
            loadBriefingAndBrief(),
            loadPlatformOutreach(),
            loadContentStrategy(),
            loadContentProposals(),
            loadPendingTasks(),
            loadRoyalTasks(),
            loadOutreachQueue(),
            loadChurnAlerts(),
            loadRecentLog(),
        ]);
    }

    async function loadBriefingAndBrief() {
        await loadBriefing();
        // After numbers are in, generate the AI brief (non-blocking)
        const grid = els.briefingGrid();
        const briefingCards = grid ? grid.querySelectorAll('.ceo-briefing-card') : [];
        // Extract metrics from already-rendered cards (or re-read from last known values)
        // Use module-level cache set during loadBriefing
        generateBrief(_lastBriefingMetrics || {});
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
            const [outreachRes, logRes, draftsRes, paidOrgsRes, trialOrgsRes, totalOrgsRes] = await Promise.all([
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
                window.supabase
                    .from('organizations')
                    .select('id', { count: 'exact', head: true }),
            ]);

            const outreachCount = outreachRes.count || 0;
            const draftsCount   = draftsRes.count || 0;
            const paidOrgs      = paidOrgsRes.count || 0;
            const trialOrgs     = trialOrgsRes.count || 0;
            const totalOrgs     = totalOrgsRes.count || 0;
            const mrrDisplay    = paidOrgs === 0 ? '$0' : `${paidOrgs} paid`;
            const mrrSub        = paidOrgs === 0 ? '0 paid subscriptions' : `${paidOrgs} active subscriber${paidOrgs !== 1 ? 's' : ''}`;

            grid.innerHTML = `
                ${briefingCard('MRR', mrrDisplay, mrrSub, paidOrgs > 0 ? 'positive' : '')}
                ${briefingCard('Total Customers', totalOrgs, totalOrgs === 1 ? '1 business on Royalty' : `${totalOrgs} businesses on Royalty`, totalOrgs > 0 ? 'positive' : '')}
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

            // Cache metrics for the brief generator
            _lastBriefingMetrics = {
                mrr: mrrDisplay,
                trials: trialOrgs,
                totalOrgs,
                drafts: draftsCount,
                outreach: outreachCount,
            };
        } catch (e) {
            console.error('[ceo] loadBriefing error:', e);
            grid.innerHTML = briefingCard('Status', 'Error', 'Could not load briefing data', '');
        }
    }

    let _lastBriefingMetrics = null;

    function briefingCard(label, value, sub, modifier) {
        const question = {
            'MRR':              "What's our MRR this month?",
            'Total Customers':  "Give me the state of the company.",
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

    // ── Content Strategy Platforms ─────────────────────────────────────
    const CONTENT_PLATFORMS = [
        {
            channel: 'blog',
            label: 'Blog',
            icon: '✍',
            iconBg: '#ede9fe',
            iconColor: '#7c3aed',
            active: true,
            description: 'Long-form articles for SEO and brand authority',
        },
        {
            channel: 'newsletter',
            label: 'Newsletter',
            icon: '📧',
            iconBg: '#dbeafe',
            iconColor: '#1d4ed8',
            active: true,
            description: 'Email digest sent to newsletter subscribers',
        },
        {
            channel: 'x_post',
            label: 'X / Twitter',
            icon: '𝕏',
            iconBg: '#f3f4f6',
            iconColor: '#111827',
            active: false,
            description: 'Repurpose blog posts as threads for SMB owners',
        },
        {
            channel: 'linkedin',
            label: 'LinkedIn',
            icon: 'in',
            iconBg: '#dbeafe',
            iconColor: '#1d4ed8',
            active: false,
            description: 'Thought leadership posts for local business operators',
        },
        {
            channel: 'blogger',
            label: 'Blogger',
            icon: '📝',
            iconBg: '#fff3e0',
            iconColor: '#f57c00',
            active: false,
            description: 'Repurpose articles on Blogger for SEO reach',
        },
        {
            channel: 'medium',
            label: 'Medium',
            icon: 'M',
            iconBg: '#f3f4f6',
            iconColor: '#111827',
            active: false,
            description: 'Cross-post articles to Medium for wider audience',
        },
        {
            channel: 'quora',
            label: 'Quora',
            icon: 'Q',
            iconBg: '#fce8e8',
            iconColor: '#b92b27',
            active: false,
            description: 'Answer SMB questions with thought leadership content',
        },
    ];

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

    // ── Content Strategy ───────────────────────────────────────────────
    async function loadContentStrategy() {
        const grid  = document.getElementById('ceo-content-platform-grid');
        const queue = document.getElementById('ceo-content-queue-list');
        try {
            const [articlesRes, topicsRes] = await Promise.all([
                window.supabase
                    .from('newsletter_articles')
                    .select('title, status, created_at, published_at, slug')
                    .order('created_at', { ascending: false }),
                window.supabase
                    .from('seo_topics')
                    .select('keyword, status')
                    .eq('status', 'queued'),
            ]);

            const articles = articlesRes.data || [];
            const topics   = topicsRes.data  || [];

            const published = articles.filter(a => a.status === 'published');
            const drafts    = articles.filter(a => a.status === 'draft');
            const pending   = articles.filter(a => a.status === 'pending_review');

            if (grid) {
                grid.innerHTML = CONTENT_PLATFORMS.map(p =>
                    renderContentPlatformCard(p, published, drafts, pending, topics)
                ).join('');
            }

            if (queue) {
                const queueItems = [...pending, ...drafts].slice(0, 10);
                queue.innerHTML = queueItems.length
                    ? queueItems.map(a => renderContentQueueItem(a)).join('')
                    : '<div class="ceo-empty">No drafts in queue — content pipeline is clear.</div>';
            }
        } catch (e) {
            console.error('[ceo] loadContentStrategy error:', e);
        }
    }

    function renderContentPlatformCard(platform, published, drafts, pending, topics) {
        const active = platform.active;

        if (!active) {
            return `
            <div class="ceo-platform-card ceo-platform-card--inactive">
                <div class="ceo-platform-card-header">
                    <div class="ceo-platform-card-name">
                        <div class="ceo-platform-icon" style="background:${escapeHtml(platform.iconBg)};color:${escapeHtml(platform.iconColor)}">${escapeHtml(platform.icon)}</div>
                        ${escapeHtml(platform.label)}
                    </div>
                    <span class="ceo-platform-badge ceo-platform-badge--soon">Soon</span>
                </div>
                <div class="ceo-platform-desc">${escapeHtml(platform.description)}</div>
            </div>`;
        }

        // Both blog + newsletter draw from newsletter_articles for now
        const pub   = published.length;
        const draft = drafts.length + pending.length;
        const total = pub + draft;
        const pct   = total > 0 ? Math.round((pub / total) * 100) : 0;

        const lastPub = published[0]?.published_at || published[0]?.created_at;
        const lastPubLabel = lastPub ? formatRelativeTime(lastPub) : '—';

        const topicsCount = topics.length;

        return `
        <div class="ceo-platform-card">
            <div class="ceo-platform-card-header">
                <div class="ceo-platform-card-name">
                    <div class="ceo-platform-icon" style="background:${escapeHtml(platform.iconBg)};color:${escapeHtml(platform.iconColor)}">${escapeHtml(platform.icon)}</div>
                    ${escapeHtml(platform.label)}
                </div>
                <span class="ceo-platform-badge ceo-platform-badge--active">Active</span>
            </div>
            <div class="ceo-platform-metrics">
                <div>
                    <div class="ceo-platform-metric-label">Published</div>
                    <div class="ceo-platform-metric-value">${pub}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">In Queue</div>
                    <div class="ceo-platform-metric-value">${draft}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">Topics Ready</div>
                    <div class="ceo-platform-metric-value${topicsCount === 0 ? ' ceo-platform-metric-value--muted' : ''}">${topicsCount}</div>
                </div>
                <div>
                    <div class="ceo-platform-metric-label">Last Published</div>
                    <div class="ceo-platform-metric-value ceo-platform-metric-value--muted" style="font-size:0.8rem">${escapeHtml(lastPubLabel)}</div>
                </div>
            </div>
            <div class="ceo-platform-progress"><div class="ceo-platform-progress-fill" style="width:${pct}%"></div></div>
            <div class="ceo-platform-desc">${pct}% of pipeline published${total === 0 ? ' — no content yet' : ''}</div>
        </div>`;
    }

    function renderContentQueueItem(article) {
        const statusLabel = article.status === 'pending_review' ? 'Pending Review' : 'Draft';
        const badgeClass  = article.status === 'pending_review' ? 'ceo-platform-badge--pending' : 'ceo-platform-badge--soon';
        const age = formatRelativeTime(article.created_at);
        return `
        <div class="ceo-content-queue-item">
            <span class="ceo-content-queue-title">${escapeHtml(article.title || 'Untitled')}</span>
            <span class="ceo-platform-badge ${badgeClass}">${statusLabel}</span>
            <span class="ceo-content-queue-meta">${escapeHtml(age)}</span>
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
                <div class="ceo-task-content">
                    <div class="ceo-task-title">${formatActionType(task.action_type)}</div>
                    <div class="ceo-task-desc">${escapeHtml(task.description)}</div>
                </div>
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

    // ── Churn Risk Alerts ─────────────────────────────────────────────
    async function loadChurnAlerts() {
        try {
            const { data, error } = await window.supabase
                .from('organizations')
                .select('id, name, slug, plan_type, churn_risk_score, last_active_at, churn_risk_updated_at')
                .gte('churn_risk_score', 40)
                .order('churn_risk_score', { ascending: false })
                .limit(20);

            if (error) throw error;
            renderChurnAlerts(data || []);
        } catch (e) {
            console.error('[ceo] loadChurnAlerts error:', e);
        }
    }

    function renderChurnAlerts(orgs) {
        const section = els.churnSection();
        const list = els.churnList();
        if (!section || !list) return;

        if (orgs.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        list.innerHTML = orgs.map(org => {
            const riskLevel = org.churn_risk_score >= 70 ? 'high' : 'medium';
            const riskColor = riskLevel === 'high' ? '#ef4444' : '#f59e0b';
            const lastActive = org.last_active_at
                ? formatRelativeTime(org.last_active_at)
                : 'Never';

            return `
                <div class="ceo-outreach-item" style="border-left:3px solid ${riskColor};">
                    <div class="ceo-outreach-item-header">
                        <span class="ceo-outreach-item-to">${escapeHtml(org.name)}</span>
                        <span class="ceo-outreach-item-channel" style="background:${riskColor};color:white;padding:2px 8px;border-radius:4px;font-size:11px;">${org.churn_risk_score}/100 ${riskLevel}</span>
                    </div>
                    <div class="ceo-outreach-item-preview" style="font-size:13px;color:#71717a;">
                        Plan: ${escapeHtml(org.plan_type || 'free')} · Last active: ${lastActive}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── Content Proposals (queue_blog_draft approvals) ────────────────
    async function loadContentProposals() {
        try {
            const { data, error } = await window.supabase
                .from('content_queue')
                .select('id, action_type, title, topic, outline, rationale, created_at')
                .eq('status', 'draft')
                .order('created_at', { ascending: false })
                .limit(20);
            if (error) throw error;
            renderContentProposals(data || []);
        } catch (e) {
            console.error('[ceo] loadContentProposals error:', e);
        }
    }

    function renderContentProposals(items) {
        const section = document.getElementById('ceo-content-proposals-section');
        const list    = document.getElementById('ceo-content-proposals-list');
        if (!section || !list) return;
        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        list.innerHTML = items.map(item => `
            <div class="ceo-outreach-item" data-id="${escapeHtml(item.id)}">
                <div class="ceo-outreach-item-header">
                    <span class="ceo-outreach-item-channel">${escapeHtml((item.action_type || '').replace('_', ' '))}</span>
                    <span class="ceo-outreach-item-to">${escapeHtml(item.title)}</span>
                </div>
                ${item.topic ? `<div class="ceo-outreach-item-subject">Topic: ${escapeHtml(item.topic)}</div>` : ''}
                ${item.outline ? `<div class="ceo-outreach-item-preview">${escapeHtml(item.outline)}</div>` : ''}
                <div class="ceo-outreach-item-preview" style="font-style:italic">Royal: ${escapeHtml(item.rationale)}</div>
                <div class="ceo-outreach-item-actions">
                    <button class="ceo-task-btn ceo-task-btn--approve" onclick="ceoDashboard.approveContentProposal('${escapeHtml(item.id)}', ${JSON.stringify({ title: item.title, topic: item.topic }).replace(/"/g, '&quot;')}, this)">Approve & Generate</button>
                    <button class="ceo-task-btn" onclick="ceoDashboard.rejectContentProposal('${escapeHtml(item.id)}', this)">Reject</button>
                </div>
            </div>
        `).join('');
    }

    async function approveContentProposal(id, item, btn) {
        if (btn) btn.disabled = true;
        try {
            await window.supabase.from('content_queue').update({ status: 'approved' }).eq('id', id);
            // Trigger article generation via edge function
            const session = typeof getValidSession === 'function' ? await getValidSession() : null;
            const token   = session?.access_token;
            fetch(`${CEO_FUNCTIONS_URL}/royal-ai-prompt`, {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    mode: 'ceo',
                    messages: [{
                        role: 'user',
                        content: `Generate the approved blog article now. Title: "${item.title}". Topic/keyword: "${item.topic || item.title}". Use trigger_article_generation tool.`,
                    }],
                    context: { growth_status: ceoCurrentStatus },
                }),
            }); // fire-and-forget
            // Remove from UI
            document.querySelector(`[data-id="${id}"]`)?.remove();
            const list = document.getElementById('ceo-content-proposals-list');
            if (list && !list.children.length) document.getElementById('ceo-content-proposals-section').style.display = 'none';
            showToast('Generating article — check Blog Review shortly');
        } catch (e) {
            console.error('[ceo] approveContentProposal error:', e);
            showToast('Failed to approve', 'error');
            if (btn) btn.disabled = false;
        }
    }

    async function rejectContentProposal(id, btn) {
        if (btn) btn.disabled = true;
        try {
            await window.supabase.from('content_queue').update({ status: 'rejected' }).eq('id', id);
            document.querySelector(`[data-id="${id}"]`)?.remove();
            const list = document.getElementById('ceo-content-proposals-list');
            if (list && !list.children.length) document.getElementById('ceo-content-proposals-section').style.display = 'none';
        } catch (e) {
            console.error('[ceo] rejectContentProposal error:', e);
            if (btn) btn.disabled = false;
        }
    }

    // ── Recent Activity Log ────────────────────────────────────────────
    async function loadRecentLog() {
        try {
            const { data, error } = await window.supabase
                .from('self_growth_log')
                .select('id, action_type, description, status, created_at, metadata')
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

        list.innerHTML = items.map(item => {
            let badge = '';
            if (item.action_type === 'outreach_sent' && item.metadata) {
                const rid = item.metadata.resend_id;
                if (!rid) badge = '<span class="ceo-log-confirm ceo-log-confirm--fail">send failed</span>';
                else if (rid.startsWith('stub_')) badge = '<span class="ceo-log-confirm ceo-log-confirm--stub">stub — not sent</span>';
                else badge = '<span class="ceo-log-confirm ceo-log-confirm--ok">✓ Resend accepted</span>';
            }
            return `
            <div class="ceo-log-item ceo-log-item--${item.status}">
                <span class="ceo-log-item-type">${escapeHtml(item.action_type)}</span>
                <span class="ceo-log-item-desc">${escapeHtml(item.description)}${badge ? ' ' + badge : ''}</span>
                <span class="ceo-log-item-time">${formatRelativeTime(item.created_at)}</span>
            </div>`;
        }).join('');

        // Update bell badge with unread count
        const lastRead = parseInt(localStorage.getItem('ceo-activity-last-read') || '0');
        const newCount = items.filter(i => new Date(i.created_at).getTime() > lastRead).length;
        _updateActivityBadge(newCount);
    }

    // ── Activity Bell / Drawer ─────────────────────────────────────────
    function toggleActivityDrawer() {
        const overlay = document.getElementById('ceo-activity-overlay');
        if (!overlay) return;
        if (overlay.classList.contains('open')) {
            overlay.classList.remove('open');
        } else {
            overlay.classList.add('open');
            _markActivityRead();
        }
    }

    function closeActivityDrawer(e) {
        if (e && e.target !== document.getElementById('ceo-activity-overlay')) return;
        const overlay = document.getElementById('ceo-activity-overlay');
        if (overlay) overlay.classList.remove('open');
    }

    function _markActivityRead() {
        localStorage.setItem('ceo-activity-last-read', Date.now());
        _updateActivityBadge(0);
    }

    function _updateActivityBadge(count) {
        const badge = document.getElementById('ceo-bell-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    // ── Chat FAB ───────────────────────────────────────────────────────
    function openChat() {
        const chatThread = document.getElementById('ceo-chat-thread');
        const chatInput  = document.getElementById('ceo-chat-input');
        if (chatThread) chatThread.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => { if (chatInput) chatInput.focus(); }, 400);
    }

    function initChatFab() {
        const fab         = document.getElementById('ceo-chat-fab');
        const chatSection = document.getElementById('ceo-chat-thread');
        if (!fab || !chatSection) return;
        fab.classList.add('visible');
        new IntersectionObserver(([e]) => {
            fab.classList.toggle('visible', !e.isIntersecting);
        }, { threshold: 0.5 }).observe(chatSection);
    }

    // ── Royal Brief ────────────────────────────────────────────────────
    async function generateBrief(metrics) {
        const el = document.getElementById('ceo-brief-text');
        if (!el) return;
        el.textContent = 'Generating briefing…';
        el.classList.remove('loaded');
        try {
            const session = await getValidSession();
            if (!session) return;
            const res = await fetch(`${SUPABASE_URL}/functions/v1/royal-ai-prompt`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mode: 'ceo',
                    brief_mode: true,
                    messages: [{
                        role: 'user',
                        content: `Morning brief for Royalty (royaltyapp.ai), an AI loyalty platform for SMBs.

Live data:
- MRR: ${metrics.mrr} (paid Royalty subscriptions)
- Total customers: ${metrics.totalOrgs} (businesses using Royalty)
- New trials: ${metrics.trials} (signups in last 30 days, not yet paying)
- Blog drafts: ${metrics.drafts} (articles in newsletter_articles — blog is ALREADY LIVE at royaltyapp.ai/blog, drafts just need review + publishing)
- Outreach queued: ${metrics.outreach} (emails/SMS awaiting approval in outreach queue)

Give me a 2-3 sentence brief on the state of the business and one specific, actionable next step. Be direct. Do not suggest building infrastructure that already exists.`,
                    }],
                }),
            });
            const data = await res.json();
            if (data.content) {
                el.textContent = data.content;
                el.classList.add('loaded');
            } else {
                el.textContent = 'Brief unavailable — ask Royal directly in the chat below.';
            }
        } catch (e) {
            console.error('[ceo] generateBrief error:', e);
            el.textContent = 'Brief unavailable — ask Royal directly in the chat below.';
        }
    }

    function refreshBrief() {
        loadBriefing();
    }

    // ── Royal Tasks Panel ──────────────────────────────────────────────
    let _royalTasksData = [];
    let _royalTasksTab  = 'active';

    async function loadRoyalTasks() {
        try {
            const { data, error } = await window.supabase
                .from('royal_tasks')
                .select('id, title, description, status, blocker_type, blocker_description, created_at, resolved_at')
                .in('status', ['active', 'blocked', 'complete'])
                .order('created_at', { ascending: false })
                .limit(50);
            if (error) throw error;
            _royalTasksData = data || [];
            _updateTasksBadge(_royalTasksData.filter(t => t.status === 'blocked').length);
            renderTasksTab(_royalTasksTab);
        } catch (e) {
            console.error('[ceo] loadRoyalTasks error:', e);
        }
    }

    function _updateTasksBadge(count) {
        const badge = document.getElementById('ceo-tasks-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }

    function renderTasksTab(tab) {
        _royalTasksTab = tab;
        // Update tab button states
        ['active', 'blocked', 'done'].forEach(t => {
            const btn = document.getElementById(`ceo-tasks-tab-${t}`);
            if (btn) btn.classList.toggle('active', t === tab);
        });

        const body = document.getElementById('ceo-tasks-drawer-body');
        if (!body) return;

        const statusFilter = tab === 'done' ? 'complete' : tab;
        const items = _royalTasksData.filter(t => t.status === statusFilter);

        if (items.length === 0) {
            const msgs = { active: 'No active tasks.', blocked: 'No blockers — Royal is unblocked.', done: 'No completed tasks yet.' };
            body.innerHTML = `<div class="ceo-empty">${msgs[tab]}</div>`;
            return;
        }

        body.innerHTML = items.map(t => renderRoyalTaskItem(t)).join('');
    }

    function renderRoyalTaskItem(task) {
        const timeAgo = formatRelativeTime(task.created_at);
        const isBlocked = task.status === 'blocked';
        const isDone = task.status === 'complete';
        const blockerChip = isBlocked && task.blocker_type
            ? `<span class="ceo-blocker-chip">${escapeHtml(task.blocker_type.replace('_', ' '))}</span>`
            : '';
        const resolveBtn = isBlocked
            ? `<button class="ceo-task-resolve-btn" onclick="ceoDashboard.showResolveForm('${escapeHtml(task.id)}')">Resolve</button>`
            : '';
        const resolveForm = `<div class="ceo-task-resolve-form" id="ceo-resolve-form-${escapeHtml(task.id)}" style="display:none">
            <input class="ceo-task-resolve-input" id="ceo-resolve-input-${escapeHtml(task.id)}" placeholder="How did you resolve this?" />
            <button class="ceo-task-resolve-submit" onclick="ceoDashboard.resolveBlocker('${escapeHtml(task.id)}')">Done</button>
        </div>`;

        return `<div class="ceo-task-item${isBlocked ? ' ceo-task-item--blocked' : ''}${isDone ? ' ceo-task-item--complete' : ''}" id="ceo-task-item-${escapeHtml(task.id)}">
            <div class="ceo-task-item-title">${escapeHtml(task.title)}</div>
            ${task.description ? `<div class="ceo-task-item-desc">${escapeHtml(task.description)}</div>` : ''}
            ${isBlocked && task.blocker_description ? `<div class="ceo-task-item-desc" style="color:#b91c1c">${escapeHtml(task.blocker_description)}</div>` : ''}
            <div class="ceo-task-item-meta">
                ${blockerChip}
                <span class="ceo-task-item-time">${timeAgo}</span>
                ${resolveBtn}
            </div>
            ${isBlocked ? resolveForm : ''}
        </div>`;
    }

    function showResolveForm(taskId) {
        const form = document.getElementById(`ceo-resolve-form-${taskId}`);
        if (form) {
            form.style.display = 'flex';
            const input = document.getElementById(`ceo-resolve-input-${taskId}`);
            if (input) input.focus();
        }
    }

    async function resolveBlocker(taskId) {
        const input = document.getElementById(`ceo-resolve-input-${taskId}`);
        const resolution = input ? input.value.trim() : '';
        if (!resolution) return;
        try {
            const { error } = await window.supabase
                .from('royal_tasks')
                .update({ status: 'complete', resolution, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', taskId);
            if (error) throw error;
            // Update local data
            const task = _royalTasksData?.find(t => t.id === taskId);
            _royalTasksData = _royalTasksData.map(t => t.id === taskId ? { ...t, status: 'complete', resolution } : t);
            _updateTasksBadge(_royalTasksData.filter(t => t.status === 'blocked').length);
            renderTasksTab(_royalTasksTab);
            closeTasksDrawer();
            // Inject resolution into CEO chat so Royal can continue the task
            const contextMessage = `Blocker resolved: "${task?.title || 'Task'}"\n\nWhat you were blocked on: ${task?.blocker_description || ''}\n\nMy answer: ${resolution}\n\nPlease continue with this task or tell me what you'll do next.`;
            const chatEl = els.chatThread();
            if (chatEl) chatEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            await sendMessageText(contextMessage);
        } catch (e) {
            console.error('[ceo] resolveBlocker error:', e);
            showToast('Failed to resolve task', 'error');
        }
    }

    // Programmatic message send — used by resolveBlocker and other internal callers
    async function sendMessageText(text) {
        if (!text || ceoIsTyping) return;
        const send = els.chatSend();
        const empty = els.chatEmpty();
        if (empty) empty.style.display = 'none';
        appendMessage('jay', text);
        ceoChatHistory.push({ role: 'user', content: text });
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
                    context:  { growth_status: ceoCurrentStatus },
                }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data  = await response.json();
            const reply = data.content || data.message || data.response || 'Royal had no response.';
            if (loadingEl) {
                loadingEl.querySelector('.ceo-msg-bubble').textContent = '';
                renderMarkdownText(loadingEl.querySelector('.ceo-msg-bubble'), reply);
            }
            ceoChatHistory.push({ role: 'assistant', content: reply });
            saveCeoMessage(text, reply);
            ceoChatHistory = ceoChatHistory.slice(-20);
        } catch (e) {
            console.error('[ceo] sendMessageText error:', e);
            if (loadingEl) loadingEl.querySelector('.ceo-msg-bubble').textContent = 'Royal encountered an error.';
        } finally {
            ceoIsTyping = false;
            if (send) send.disabled = false;
        }
    }

    function toggleTasksDrawer() {
        const overlay = document.getElementById('ceo-tasks-overlay');
        if (!overlay) return;
        if (overlay.classList.contains('open')) {
            overlay.classList.remove('open');
        } else {
            overlay.classList.add('open');
            renderTasksTab(_royalTasksTab);
        }
    }

    function closeTasksDrawer(e) {
        if (e && e.target !== document.getElementById('ceo-tasks-overlay')) return;
        const overlay = document.getElementById('ceo-tasks-overlay');
        if (overlay) overlay.classList.remove('open');
    }

    function switchTasksTab(tab) {
        renderTasksTab(tab);
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
        const chatWrapper = document.querySelector('.ceo-chat-wrapper');
        if (chatWrapper) chatWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            saveCeoMessage(text, reply); // fire-and-forget — persist to DB
            ceoChatHistory = ceoChatHistory.slice(-20); // trim context window
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
    function formatActionType(type) {
        return (type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

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

    // ── CEO Chat Thread Persistence ────────────────────────────────────

    async function loadCeoThread() {
        if (!ceoCeoUserId) return;
        try {
            const { data: threads } = await window.supabase
                .from('ai_threads')
                .select('id')
                .eq('user_id', ceoCeoUserId)
                .eq('mode', 'ceo')
                .eq('is_active', true)
                .order('updated_at', { ascending: false })
                .limit(1);
            if (threads?.length) {
                ceoCeoThreadId = threads[0].id;
                await loadCeoThreadMessages(ceoCeoThreadId);
            }
        } catch (e) {
            console.warn('[ceo] loadCeoThread failed:', e);
        }
    }

    async function loadCeoThreadMessages(threadId) {
        try {
            const { data: msgs } = await window.supabase
                .from('ai_prompts')
                .select('prompt_text, response, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true });
            if (!msgs?.length) return;
            const empty = els.chatEmpty();
            if (empty) empty.style.display = 'none';
            msgs.forEach(m => {
                appendMessage('jay', m.prompt_text);
                if (m.response?.message) appendMessage('royal', m.response.message);
                ceoChatHistory.push({ role: 'user', content: m.prompt_text });
                ceoChatHistory.push({ role: 'assistant', content: m.response?.message || '' });
            });
            ceoChatHistory = ceoChatHistory.slice(-20);
            const thread = els.chatThread();
            if (thread) thread.scrollTop = thread.scrollHeight;
        } catch (e) {
            console.warn('[ceo] loadCeoThreadMessages failed:', e);
        }
    }

    async function saveCeoMessage(userText, assistantReply) {
        if (!ceoCeoOrgId || !ceoCeoUserId) return;
        try {
            if (!ceoCeoThreadId) {
                const title = userText.slice(0, 60) + (userText.length > 60 ? '…' : '');
                const { data: thread } = await window.supabase
                    .from('ai_threads')
                    .insert({ organization_id: ceoCeoOrgId, user_id: ceoCeoUserId, mode: 'ceo', title })
                    .select('id').single();
                ceoCeoThreadId = thread?.id;
            }
            if (!ceoCeoThreadId) return;
            await window.supabase.from('ai_prompts').insert({
                organization_id: ceoCeoOrgId,
                user_id:         ceoCeoUserId,
                session_id:      ceoCeoThreadId,
                thread_id:       ceoCeoThreadId,
                mode:            'ceo',
                prompt_text:     userText,
                response:        { message: assistantReply },
            });
        } catch (e) {
            console.warn('[ceo] saveCeoMessage failed:', e);
        }
    }

    function newCeoThread() {
        ceoCeoThreadId = null;
        ceoChatHistory = [];
        const thread = els.chatThread();
        if (thread) thread.innerHTML = '';
        const empty = els.chatEmpty();
        if (empty) empty.style.display = '';
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
        toggleActivityDrawer,
        closeActivityDrawer,
        openChat,
        refreshBrief,
        toggleTasksDrawer,
        closeTasksDrawer,
        switchTasksTab,
        showResolveForm,
        resolveBlocker,
        newCeoThread,
        approveContentProposal,
        rejectContentProposal,
    };

})();
