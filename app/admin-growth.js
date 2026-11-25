// ===== Super Admin → Growth tab =====
//
// One screen for the numbers that matter while iterating on growth:
//   traffic (PostHog, read server-side by the admin-growth-traffic edge function)
//   + sign-ups → activation → paid (the database, admin_growth_metrics()).
// Internal and test orgs (organizations.is_internal) are left out unless the
// "Include internal" box is ticked.
//
// The two halves can't be joined person by person: marketing pages are
// cookieless (one id per visitor per day) and /app is identified. So the funnel
// shows them as two blocks with a divider, each with its own 100%.
//
// Exposes window.AdminGrowth only (CLAUDE.md rule 6: every script shares one
// global scope). English only, like the rest of admin.html.
(function () {
    'use strict';

    const PERIODS = { '7': 7, '30': 30, '90': 90, 'all': null };

    // Milestones in order. Keys match admin_growth_metrics().
    const MILESTONES = [
        { key: 'account', label: 'Account created', next: null },
        { key: 'confirmed', label: 'Confirmed email', next: 'Confirm email' },
        { key: 'came_back', label: 'Came back (next day or later)', next: 'Come back' },
        { key: 'has_rewards', label: 'Has a reward', next: 'Add a reward' },
        { key: 'first_customer', label: 'First customer', next: 'First customer' },
        { key: 'activated', label: 'Activated (5 customers + a check-in)', next: 'Activate' },
        { key: 'paid', label: 'Paid', next: 'Upgrade' }
    ];

    const state = {
        days: 30,
        includeInternal: false,
        seq: 0,
        loadedKey: null,
        db: null,
        traffic: null,
        trafficError: null,
        charts: []
    };

    // ----- helpers -----
    const $ = (id) => document.getElementById(id);
    const esc = (s) => (window.AppUtils && AppUtils.escapeHtml ? AppUtils.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);
    const fmt = (v) => num(v).toLocaleString('en-US');
    const money = (v) => '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function pct(part, whole) {
        part = num(part); whole = num(whole);
        if (!whole) return null;
        const p = (part / whole) * 100;
        return p >= 10 || p === 0 ? Math.round(p) + '%' : p.toFixed(1) + '%';
    }

    function relDate(iso) {
        if (!iso) return 'Never';
        const d = new Date(iso);
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + 'd ago';
        if (days < 30) return Math.floor(days / 7) + 'w ago';
        if (days < 365) return Math.floor(days / 30) + 'mo ago';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function shortDate(isoDay) {
        const d = new Date(isoDay + 'T00:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    function cssVar(name, fallback) {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v || fallback;
        } catch (e) {
            return fallback;
        }
    }

    function periodLabel() {
        return state.days ? 'last ' + state.days + ' days' : 'all time';
    }

    // "↑ 3 vs 2 the 30 days before" — counts, never a bare %, because at today's
    // volume one sign-up is a 50% swing.
    function delta(cur, prev) {
        if (prev === null || prev === undefined) return '<span class="growth-delta">' + esc(periodLabel()) + '</span>';
        cur = num(cur); prev = num(prev);
        const diff = cur - prev;
        const arrow = diff > 0 ? '<span class="growth-arrow up" aria-hidden="true">▲</span>'
            : diff < 0 ? '<span class="growth-arrow down" aria-hidden="true">▼</span>'
            : '<span class="growth-arrow flat" aria-hidden="true">●</span>';
        const word = diff > 0 ? 'up ' + fmt(diff) : diff < 0 ? 'down ' + fmt(-diff) : 'same';
        return '<span class="growth-delta">' + arrow + esc(word) + ' vs ' + fmt(prev) + ' the ' + state.days + ' days before</span>';
    }

    // ----- data -----
    async function fetchTraffic(days) {
        const session = typeof getValidSession === 'function'
            ? await getValidSession()
            : (await supabase.auth.getSession()).data.session;
        if (!session) throw new Error('Not signed in');
        const res = await fetch(supabase.supabaseUrl + '/functions/v1/admin-growth-traffic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ days: days })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        return body;
    }

    async function load(force) {
        const key = state.days + ':' + state.includeInternal;
        if (!force && state.loadedKey === key && state.db) return;
        const seq = ++state.seq;
        setLoading(true);

        const [dbRes, trRes] = await Promise.allSettled([
            supabase.rpc('admin_growth_metrics', { p_days: state.days, p_include_internal: state.includeInternal }),
            fetchTraffic(state.days)
        ]);
        if (seq !== state.seq) return; // a newer period was picked meanwhile

        setLoading(false);
        if (dbRes.status === 'rejected' || dbRes.value.error || !dbRes.value.data) {
            const err = dbRes.status === 'rejected' ? dbRes.reason : dbRes.value.error;
            console.error('admin_growth_metrics failed:', err);
            $('growth-error').textContent = 'Could not load growth metrics: ' + ((err && err.message) || 'no data') + '.';
            $('growth-error').style.display = 'block';
            return;
        }
        $('growth-error').style.display = 'none';
        state.db = dbRes.value.data;
        state.traffic = trRes.status === 'fulfilled' ? trRes.value : null;
        state.trafficError = trRes.status === 'rejected' ? ((trRes.reason && trRes.reason.message) || 'failed') : null;
        state.loadedKey = key;
        render(state.db, state.traffic, state.trafficError);
    }

    function setLoading(on) {
        const el = $('growth-loading');
        if (el) el.style.display = on ? 'flex' : 'none';
        const body = $('growth-body');
        if (body) body.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    // ----- render -----
    function trafficConnected(tr) {
        return !!(tr && tr.connected);
    }

    function render(db, tr, trErr) {
        destroyCharts();
        const k = db.kpis || {};
        const cur = k.cur || {};
        const prev = k.prev || null;
        const connected = trafficConnected(tr);

        $('growth-window').textContent = (db.window && db.window.days
            ? 'Last ' + db.window.days + ' days: ' + shortDate(db.window.from) + ' – ' + shortDate(db.window.to) + ' (UTC, today so far)'
            : 'All time since ' + shortDate(db.window.from) + ' (UTC)')
            + ' · updated ' + new Date(db.window.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        $('growth-internal-count').textContent = '(' + fmt(k.internal_orgs) + ')';

        // Traffic status line
        const status = $('growth-traffic-status');
        if (!connected) {
            status.style.display = 'block';
            status.textContent = trErr
                ? 'Traffic unavailable: ' + trErr + '. The database numbers below are complete.'
                : 'Traffic not connected: the POSTHOG_PERSONAL_API_KEY secret is not set. The database numbers below are complete.';
        } else if (tr.errors && tr.errors.length) {
            status.style.display = 'block';
            status.textContent = 'Some traffic numbers failed to load (' + tr.errors.length + '): ' + tr.errors[0];
        } else {
            status.style.display = 'none';
        }

        renderKpis(db, tr);
        renderTrafficCharts(db, tr);
        renderFunnel(db, tr);
        renderSources(db, tr);
        renderCohorts(db);
        renderRecent(db);
        renderNetwork(db);
        renderDailyTable(db, tr);
    }

    function tile(label, value, sub, extra) {
        return '<div class="growth-kpi">'
            + '<div class="growth-kpi-label">' + esc(label) + '</div>'
            + '<div class="growth-kpi-value">' + value + '</div>'
            + (sub ? '<div class="growth-kpi-sub">' + sub + '</div>' : '')
            + (extra ? '<div class="growth-kpi-sub">' + extra + '</div>' : '')
            + '</div>';
    }

    function renderKpis(db, tr) {
        const k = db.kpis || {};
        const cur = k.cur || {};
        const prev = k.prev || null;
        const connected = trafficConnected(tr);
        const visitors = connected && tr.totals ? tr.totals.cur.visitors : null;
        const prevVisitors = connected && tr.totals && tr.totals.prev ? tr.totals.prev.visitors : null;
        const conv = visitors ? pct(cur.signups, visitors) : null;
        const tiers = k.paid_by_tier || {};
        const tierText = Object.keys(tiers).sort().map((t) => fmt(tiers[t]) + ' ' + esc(t)).join(' · ');

        $('growth-kpis').innerHTML = [
            tile('Visitors', connected ? fmt(visitors) : '—',
                connected ? (state.days ? delta(visitors, prevVisitors) : '<span class="growth-delta">' + esc(periodLabel()) + '</span>') : '<span class="growth-delta">Traffic not connected</span>',
                '<span class="growth-note">daily uniques, summed</span>'),
            tile('Sign-ups', fmt(cur.signups), delta(cur.signups, prev && prev.signups)),
            tile('Visit → sign-up', conv || '—',
                '<span class="growth-delta">' + (visitors ? fmt(cur.signups) + ' of ' + fmt(visitors) + ' visitors' : 'needs traffic') + '</span>'),
            tile('First customer', fmt(cur.first_customer), delta(cur.first_customer, prev && prev.first_customer),
                '<span class="growth-note">businesses that got theirs this period</span>'),
            tile('Activated', fmt(cur.activated), delta(cur.activated, prev && prev.activated),
                '<span class="growth-note">5 customers + a check-in</span>'),
            tile('Paid', fmt(cur.paid), delta(cur.paid, prev && prev.paid),
                '<span class="growth-note">' + fmt(cur.churned) + ' churned this period</span>'),
            tile('Est. MRR', money(k.est_mrr),
                '<span class="growth-delta">' + fmt(k.paid_total) + ' paid now' + (tierText ? ': ' + tierText : '') + '</span>',
                '<span class="growth-note">monthly list price per tier</span>'),
            tile('Active businesses', fmt(k.active_7d),
                '<span class="growth-delta">of ' + fmt(k.orgs_total) + ', last 7 days</span>',
                '<span class="growth-note">owner opened the dashboard or a customer checked in</span>')
        ].join('');
    }

    function chartBase(seriesName, color, labels, values, height) {
        const muted = cssVar('--color-text-muted', '#94a3b8');
        const border = cssVar('--color-border', '#e2e8f0');
        const long = labels.length > 90;
        return {
            chart: {
                type: long ? 'line' : 'bar',
                height: height || 200,
                toolbar: { show: false },
                zoom: { enabled: false },
                animations: { enabled: false },
                fontFamily: 'inherit'
            },
            series: [{ name: seriesName, data: values }],
            colors: [color],
            stroke: long ? { width: 2, curve: 'straight' } : { width: 0 },
            plotOptions: { bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '70%' } },
            dataLabels: { enabled: false },
            legend: { show: false },
            xaxis: {
                categories: labels,
                labels: { style: { colors: muted, fontSize: '11px' }, rotate: 0, hideOverlappingLabels: true },
                axisBorder: { show: false },
                axisTicks: { show: false },
                tickAmount: Math.min(labels.length, 7)
            },
            yaxis: {
                min: 0,
                forceNiceScale: true,
                labels: { style: { colors: muted, fontSize: '11px' }, formatter: (v) => Math.round(v).toLocaleString('en-US') }
            },
            grid: { borderColor: border, strokeDashArray: 4, xaxis: { lines: { show: false } } },
            tooltip: { shared: false, intersect: false, y: { formatter: (v) => fmt(v) } },
            states: { hover: { filter: { type: 'darken', value: 0.85 } } }
        };
    }

    function drawChart(id, options) {
        const el = $(id);
        if (!el) return;
        el.innerHTML = '';
        if (typeof ApexCharts === 'undefined') {
            el.innerHTML = '<p class="growth-empty">Chart library did not load. The numbers are in the table below.</p>';
            return;
        }
        const chart = new ApexCharts(el, options);
        chart.render();
        state.charts.push(chart);
    }

    function destroyCharts() {
        state.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } });
        state.charts = [];
    }

    function renderTrafficCharts(db, tr) {
        const primary = cssVar('--color-primary', '#7c3aed');
        const days = db.daily || [];
        const labels = days.map((d) => shortDate(d.date));
        drawChart('growth-chart-signups', chartBase('Sign-ups', primary, labels, days.map((d) => num(d.signups))));

        if (trafficConnected(tr) && tr.daily) {
            // The traffic function returns at most 365 days; line its days up with the database's.
            const byDay = {};
            tr.daily.forEach((d) => { byDay[d.date] = d; });
            drawChart('growth-chart-visitors', chartBase('Visitors', primary, labels,
                days.map((d) => (byDay[d.date] ? num(byDay[d.date].visitors) : 0))));
        } else {
            $('growth-chart-visitors').innerHTML = '<p class="growth-empty">Traffic not connected.</p>';
        }
    }

    function funnelRow(label, count, first, prevCount, note) {
        const width = first ? Math.max(0, Math.min(100, (num(count) / num(first)) * 100)) : 0;
        const ofPrev = prevCount === null ? null : pct(count, prevCount);
        return '<div class="growth-funnel-row">'
            + '<div class="growth-funnel-label">' + esc(label) + (note ? ' <span class="growth-note">' + esc(note) + '</span>' : '') + '</div>'
            + '<div class="growth-funnel-bar"><span style="width:' + width.toFixed(1) + '%"></span></div>'
            + '<div class="growth-funnel-count">' + fmt(count) + '</div>'
            + '<div class="growth-funnel-pct">' + (ofPrev === null ? '' : esc(ofPrev) + ' of previous') + '</div>'
            + '</div>';
    }

    function renderFunnel(db, tr) {
        const f = db.funnel || {};
        let html = '';
        if (trafficConnected(tr) && tr.hero && tr.totals) {
            const v = tr.totals.cur.visitors;
            const h = tr.hero;
            html += '<div class="growth-funnel-block"><div class="growth-funnel-head">Marketing site '
                + '<span class="growth-note">PostHog · same-day, one visitor id · the homepage builder only</span></div>'
                + funnelRow('Visitors', v, v, null)
                + funnelRow('Started a prompt', h.started, v, v)
                + funnelRow('Preview built', h.preview, v, h.started, h.ai_succeeded + ' by AI, the rest by the template fallback')
                + funnelRow('Clicked sign-up', h.clicked_signup, v, h.preview)
                + '</div>';
        } else {
            html += '<div class="growth-funnel-block"><div class="growth-funnel-head">Marketing site</div>'
                + '<p class="growth-empty">Traffic not connected.</p></div>';
        }
        html += '<div class="growth-funnel-divider" role="separator"><span>Database: the businesses that signed up in this period'
            + ' (can\'t be joined to the visitors above, person by person)</span></div>';
        html += '<div class="growth-funnel-block">';
        let prevCount = null;
        MILESTONES.forEach((m) => {
            html += funnelRow(m.label, f[m.key], f.account, prevCount);
            prevCount = f[m.key];
        });
        html += '</div>';
        $('growth-funnel').innerHTML = html;
    }

    function listTable(headers, rows, emptyText) {
        if (!rows.length) return '<p class="growth-empty">' + esc(emptyText) + '</p>';
        return '<table class="growth-table"><thead><tr>' + headers.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('')
            + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>').join('')
            + '</tbody></table>';
    }

    function renderSources(db, tr) {
        const connected = trafficConnected(tr);
        $('growth-sources-traffic').innerHTML = connected
            ? listTable(['Referring site', 'Visitors'], (tr.sources || []).map((s) => [esc(s.domain === '$direct' ? 'Direct / typed' : s.domain), fmt(s.visitors)]), 'No entries yet.')
              + '<h4 class="growth-subhead">Campaigns (utm tags)</h4>'
              + listTable(['Source / campaign', 'Visitors'], (tr.utm || []).map((u) => [esc(u.source + (u.campaign ? ' / ' + u.campaign : '')), fmt(u.visitors)]), 'No utm-tagged visits.')
              + '<h4 class="growth-subhead">Landing pages</h4>'
              + listTable(['Page', 'Visitors'], (tr.landing || []).map((l) => [esc(l.path), fmt(l.visitors)]), 'No entries yet.')
            : '<p class="growth-empty">Traffic not connected.</p>';

        const sources = db.sources || [];
        $('growth-sources-signups').innerHTML = listTable(['Source', 'Sign-ups', 'First customer', 'Activated', 'Paid'],
            sources.map((s) => [esc(s.source === 'direct' ? 'Direct / typed' : s.source), fmt(s.signups), fmt(s.first_customer), fmt(s.activated), fmt(s.paid)]),
            'No sign-ups in this period.')
            + (sources.some((s) => s.source === 'unknown')
                ? '<p class="growth-note growth-footnote">unknown: signed up before sources were recorded (2026-11-25), or the visitor opted out of analytics.</p>'
                : '');
    }

    function renderCohorts(db) {
        const rows = db.cohorts || [];
        const steps = MILESTONES.slice(1);
        let html = '<table class="growth-table growth-cohorts"><thead><tr><th>Signup week</th><th class="num">Sign-ups</th>'
            + steps.map((m) => '<th class="num">' + esc(m.label.replace(/ \(.*\)$/, '')) + '</th>').join('')
            + '</tr></thead><tbody>';
        rows.forEach((c) => {
            html += '<tr><td>' + esc(shortDate(c.week)) + '</td><td class="num">' + fmt(c.signups) + '</td>';
            steps.forEach((m) => {
                if (!num(c.signups)) { html += '<td class="num growth-cell-empty">–</td>'; return; }
                const share = num(c[m.key]) / num(c.signups);
                html += '<td class="num growth-cell" style="--share:' + Math.round(share * 100) + '%">'
                    + esc(pct(c[m.key], c.signups)) + ' <span class="growth-note">(' + fmt(c[m.key]) + ')</span></td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        $('growth-cohorts').innerHTML = html;
    }

    function stuckLabel(r) {
        if (!r.stuck_at) return '<span class="growth-done">Paid' + (r.tier ? ' · ' + esc(r.tier) : '') + '</span>';
        const m = MILESTONES.find((x) => x.key === r.stuck_at);
        return '<span class="growth-stuck">' + esc(m ? m.next : r.stuck_at) + '</span>';
    }

    function sourceCell(r) {
        const s = r.source || {};
        const label = r.source_label === 'unknown' ? 'unknown' : r.source_label;
        const bits = [];
        if (s.utm_campaign) bits.push(s.utm_campaign);
        if (s.landing) bits.push('landed ' + s.landing);
        if (s.via_hero) bits.push('via builder');
        if (s.plan) bits.push('plan ' + s.plan);
        return esc(label) + (bits.length ? '<div class="growth-note">' + esc(bits.join(' · ')) + '</div>' : '');
    }

    function renderRecent(db) {
        const rows = db.recent_signups || [];
        if (!rows.length) { $('growth-recent').innerHTML = '<p class="growth-empty">No sign-ups yet.</p>'; return; }
        $('growth-recent').innerHTML = '<table class="growth-table growth-recent"><thead><tr>'
            + '<th>Business</th><th>Created</th><th>Source</th><th>Stuck at</th><th class="num">Customers</th><th class="num">Check-ins</th><th>Last seen</th><th></th>'
            + '</tr></thead><tbody>'
            + rows.map((r) => '<tr data-org-id="' + esc(r.id) + '" data-org-name="' + esc(r.name || '') + '" class="growth-recent-row">'
                + '<td><div class="growth-org">' + esc(r.name || 'Unnamed')
                + (r.is_internal ? ' <span class="plan-badge internal">Internal</span>' : '') + '</div>'
                + '<div class="growth-note">' + esc(r.owner_email || 'no owner') + (r.confirmed ? '' : ' · unconfirmed') + '</div></td>'
                + '<td>' + esc(relDate(r.created_at)) + '</td>'
                + '<td>' + sourceCell(r) + '</td>'
                + '<td>' + stuckLabel(r) + '</td>'
                + '<td class="num">' + fmt(r.members) + '</td>'
                + '<td class="num">' + fmt(r.checkins) + '</td>'
                + '<td>' + esc(relDate(r.last_seen)) + '</td>'
                + '<td><div class="row-actions" style="opacity:1">'
                + '<button type="button" class="action-btn" data-growth-action="detail" title="Details" aria-label="Details">'
                + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>'
                + '<button type="button" class="action-btn view-as" data-growth-action="view-as" title="View as this org" aria-label="View as this org">'
                + '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg></button>'
                + '</div></td></tr>').join('')
            + '</tbody></table>';
    }

    function renderNetwork(db) {
        const k = db.kpis || {};
        const cur = k.cur || {};
        const prev = k.prev || null;
        const primary = cssVar('--color-primary', '#7c3aed');
        const days = db.daily || [];
        const labels = days.map((d) => shortDate(d.date));
        const items = [
            ['new_members', 'New customers', 'growth-chart-members'],
            ['checkins', 'Check-ins', 'growth-chart-checkins'],
            ['redemptions', 'Rewards redeemed', 'growth-chart-redemptions']
        ];
        items.forEach(([key, label, chartId]) => {
            const head = $(chartId + '-head');
            if (head) head.innerHTML = '<span class="growth-network-label">' + esc(label) + '</span> <strong>' + fmt(cur[key]) + '</strong> ' + delta(cur[key], prev && prev[key]);
            drawChart(chartId, chartBase(label, primary, labels, days.map((d) => num(d[key])), 150));
        });
    }

    function renderDailyTable(db, tr) {
        const byDay = {};
        if (trafficConnected(tr) && tr.daily) tr.daily.forEach((d) => { byDay[d.date] = d; });
        const rows = (db.daily || []).slice().reverse().map((d) => [
            esc(d.date),
            trafficConnected(tr) ? fmt(byDay[d.date] ? byDay[d.date].visitors : 0) : '—',
            trafficConnected(tr) ? fmt(byDay[d.date] ? byDay[d.date].signup_page : 0) : '—',
            fmt(d.signups), fmt(d.paid), fmt(d.new_members), fmt(d.checkins), fmt(d.redemptions)
        ]);
        $('growth-daily-table').innerHTML = listTable(
            ['Day (UTC)', 'Visitors', 'Signup page', 'Sign-ups', 'Paid', 'New customers', 'Check-ins', 'Redeemed'], rows, 'No days.');
    }

    // ----- events -----
    function bind() {
        document.querySelectorAll('[data-growth-period]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const p = btn.getAttribute('data-growth-period');
                if (!(p in PERIODS)) return;
                state.days = PERIODS[p];
                document.querySelectorAll('[data-growth-period]').forEach((b) => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                load();
            });
        });
        const inc = $('growth-include-internal');
        if (inc) inc.addEventListener('change', () => { state.includeInternal = inc.checked; load(); });
        const refresh = $('growth-refresh');
        if (refresh) refresh.addEventListener('click', () => load(true));

        // Recent sign-ups: reuse the Orgs tab's handlers (admin.js).
        const recent = $('growth-recent');
        if (recent) recent.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-org-id]');
            if (!row) return;
            const id = row.getAttribute('data-org-id');
            const name = row.getAttribute('data-org-name');
            const action = e.target.closest('[data-growth-action]');
            if (action && action.getAttribute('data-growth-action') === 'view-as') {
                if (typeof window.viewAsOrg === 'function') window.viewAsOrg(id, name);
            } else if (typeof window.openOrgDetail === 'function') {
                window.openOrgDetail(id);
            }
        });
    }

    let bound = false;
    function init() {
        if (!bound) { bind(); bound = true; }
        return load();
    }

    // Called when an org is marked or unmarked internal on the Orgs tab.
    function invalidate() {
        state.loadedKey = null;
    }

    window.AdminGrowth = { init, load, invalidate, render, _state: state };
})();
