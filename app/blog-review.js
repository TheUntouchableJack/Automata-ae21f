/**
 * Blog Review — In-app HUMAN_EDIT editor for Royalty SEO drafts.
 * Admin-only page. Fetches draft articles from Supabase, renders
 * HUMAN_EDIT markers as interactive suggestion cards.
 */

(async function BlogReview() {
    // ── Auth guard ────────────────────────────────────────────────────────────
    const session = await requireAuth();
    if (!session) return;

    const adminCheck = await isAdmin();
    if (!adminCheck) {
        window.location.href = '/app/dashboard.html';
        return;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    let allArticles = [];
    let currentArticle = null;
    let currentContent = '';   // live content with markers replaced as user accepts
    let pendingMarkerCount = 0;

    const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const listView   = document.getElementById('br-list-view');
    const editorView = document.getElementById('br-editor-view');
    const listContent = document.getElementById('br-list-content');
    const subtitle   = document.getElementById('br-subtitle');
    const editorTitle = document.getElementById('br-editor-title');
    const editorBody  = document.getElementById('br-editor-body');
    const progressText = document.getElementById('br-progress-text');
    const saveStatus  = document.getElementById('br-save-status');
    const saveBtn     = document.getElementById('br-save-btn');
    const publishBtn  = document.getElementById('br-publish-btn');
    const backBtn     = document.getElementById('br-back-btn');
    const toast       = document.getElementById('br-toast');

    // ── Init sidebar ─────────────────────────────────────────────────────────
    const { data: { user } } = await db.auth.getUser();
    const { data: profile } = await db.from('profiles')
        .select('first_name, last_name, is_admin')
        .eq('id', user.id)
        .single();

    const { data: orgMember } = await db.from('organization_members')
        .select('organizations(name)')
        .eq('user_id', user.id)
        .limit(1)
        .single();

    AppSidebar.init({
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email,
        email: user.email,
        isAdmin: profile?.is_admin === true,
        organization: { name: orgMember?.organizations?.name || 'Royalty' }
    });

    // Start badge polling (admin only)
    AppSidebar.startBlogReviewPolling();

    // ── Load article list ─────────────────────────────────────────────────────
    async function loadArticles() {
        const { data, error } = await db.rpc('get_draft_articles_for_review');
        if (error) {
            listContent.innerHTML = `<div class="br-empty">Error loading articles: ${escapeHtml(error.message)}</div>`;
            return;
        }
        allArticles = data || [];
        renderList();
    }

    function renderList() {
        const count = allArticles.length;
        subtitle.textContent = count === 0
            ? 'No articles pending review'
            : `${count} article${count !== 1 ? 's' : ''} pending review`;

        if (count === 0) {
            listContent.innerHTML = `<div class="br-empty" data-i18n="blogReview.noArticles">No articles pending review</div>`;
            return;
        }

        // Parse edit counts from content
        const rows = allArticles.map(a => {
            const markers = countMarkers(a.content || '');
            const score = parseOverallScore(a.content || '');
            return { article: a, markers, score };
        });

        const tableHTML = `
            <div class="br-table">
                <div class="br-table-row br-table-head">
                    <div>Article</div>
                    <div>Category</div>
                    <div>Edits</div>
                    <div>Action</div>
                </div>
                ${rows.map(({ article, markers, score }) => `
                    <div class="br-table-row">
                        <div>
                            <div class="br-article-title">${escapeHtml(article.title)}</div>
                            <div class="br-article-slug">${escapeHtml(article.slug)}</div>
                        </div>
                        <div>
                            <span class="br-tag br-tag-draft">${escapeHtml(article.primary_topic || 'Draft')}</span>
                        </div>
                        <div>
                            <span class="br-score ${scoreClass(score)}">${markers} left</span>
                        </div>
                        <div>
                            <button class="btn btn-primary" style="font-size:0.8rem;padding:5px 12px;"
                                    onclick="BlogReview_openArticle('${article.id}')">
                                Review
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        listContent.innerHTML = tableHTML;
    }

    // ── Open article in editor ────────────────────────────────────────────────
    window.BlogReview_openArticle = function(articleId) {
        currentArticle = allArticles.find(a => a.id === articleId);
        if (!currentArticle) return;

        currentContent = currentArticle.content || '';
        editorTitle.textContent = currentArticle.title;
        saveStatus.textContent = '';
        saveStatus.classList.remove('saved');

        listView.style.display = 'none';
        editorView.style.display = 'block';

        renderEditor();
    };

    backBtn.addEventListener('click', () => {
        editorView.style.display = 'none';
        listView.style.display = 'block';
        loadArticles(); // refresh counts
    });

    // ── Editor rendering ──────────────────────────────────────────────────────
    function renderEditor() {
        pendingMarkerCount = 0;
        const segments = splitContent(currentContent);
        const html = segments.map((seg, i) => {
            if (seg.type === 'text') {
                return `<div class="br-markdown-segment" data-seg="${i}">${renderMarkdown(seg.value)}</div>`;
            } else {
                pendingMarkerCount++;
                return renderEditCard(seg, i);
            }
        }).join('');

        editorBody.innerHTML = html;
        updateProgress();
        attachCardListeners();
    }

    // Split content into alternating text / HUMAN_EDIT segments
    function splitContent(content) {
        // Remove REVIEW_CHECKLIST block (top of file metadata)
        const cleaned = content.replace(/<!--\s*REVIEW_CHECKLIST[\s\S]*?-->/gi, '').trimStart();
        const parts = cleaned.split(/(<!--\s*HUMAN_EDIT[\s\S]*?-->)/gi);
        return parts.map((part, i) => {
            if (/^<!--\s*HUMAN_EDIT/i.test(part)) {
                return { type: 'marker', value: part, ...parseMarker(part) };
            }
            return { type: 'text', value: part };
        }).filter(s => s.value.trim());
    }

    function parseMarker(raw) {
        const get = (key) => {
            const m = raw.match(new RegExp(`${key}:\\s*"([\\s\\S]*?)"(?:\\s*\\n|$)`, 'i'))
                || raw.match(new RegExp(`${key}:\\s*([^\\n"]+)`, 'i'));
            return m ? m[1].trim() : '';
        };
        return {
            markerType:     get('type'),
            prompt:         get('prompt'),
            suggestion:     get('suggestion'),
            humanness_score: parseFloat(get('humanness_score')) || 0,
            note:           get('note'),
        };
    }

    function renderEditCard(seg, idx) {
        const score = seg.humanness_score;
        const scoreLabel = score < 0.4 ? 'Must rewrite' : score < 0.7 ? 'Edit heavily' : 'Light edit';
        const scoreColorClass = score < 0.4 ? 'br-edit-card-score-low' : score < 0.7 ? 'br-edit-card-score-mid' : 'br-edit-card-score-ok';

        return `
            <div class="br-edit-card" id="card-${idx}" data-seg="${idx}" data-type="${escapeHtml(seg.markerType)}" data-pending="true">
                <div class="br-edit-card-header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    NEEDS EDIT
                    <span class="br-edit-card-type">${escapeHtml(seg.markerType || 'edit')}</span>
                    <span class="br-edit-card-score ${scoreColorClass}">Score: ${score.toFixed(2)} — ${scoreLabel}</span>
                </div>
                <div class="br-edit-card-body">
                    ${seg.prompt ? `<div class="br-edit-prompt">${escapeHtml(seg.prompt)}</div>` : ''}
                    <div class="br-suggestion-label">Claude's suggestion</div>
                    <div class="br-suggestion-text" id="suggestion-${idx}">${escapeHtml(seg.suggestion)}</div>
                    <textarea class="br-custom-input" id="custom-${idx}" placeholder="Or type your own replacement..."></textarea>
                    <div class="br-card-actions">
                        <button class="br-btn br-btn-accept" data-action="accept" data-seg="${idx}" data-i18n="blogReview.accept">
                            ✓ Accept
                        </button>
                        <button class="br-btn br-btn-regenerate" data-action="regenerate" data-seg="${idx}" data-i18n="blogReview.regenerate">
                            ↺ Regenerate
                        </button>
                        <button class="br-btn br-btn-custom" data-action="custom" data-seg="${idx}">
                            ✎ Use mine
                        </button>
                        <button class="br-btn br-btn-skip" data-action="skip" data-seg="${idx}" data-i18n="blogReview.skip">
                            ✕ Skip
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Minimal markdown → HTML (handles the common patterns in our drafts)
    function renderMarkdown(md) {
        if (!md.trim()) return '';

        // Escape HTML first
        let html = escapeHtml(md);

        // Tables
        html = html.replace(/(?:^|\n)((?:\|.+\|\n)+)/gm, (_, table) => {
            const rows = table.trim().split('\n').filter(r => r.trim());
            let tableHtml = '<table>';
            rows.forEach((row, i) => {
                if (/^\s*\|[-:| ]+\|\s*$/.test(row)) return; // separator row
                const cells = row.split('|').filter((_, ci) => ci > 0 && ci < row.split('|').length - 1);
                const tag = i === 0 ? 'th' : 'td';
                tableHtml += `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
            });
            return tableHtml + '</table>';
        });

        // Headers
        html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, text) => {
            const level = hashes.length;
            return `<h${level}>${text}</h${level}>`;
        });

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Horizontal rules
        html = html.replace(/^---+$/gm, '<hr>');

        // Unordered lists (basic)
        html = html.replace(/^([*-])\s+(.+)$/gm, '<li>$2</li>');
        html = html.replace(/(<li>[\s\S]+?<\/li>)(?=\n[^<]|$)/g, '<ul>$1</ul>');

        // Paragraphs
        html = html.replace(/\n\n+/g, '</p><p>');
        if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<table') && !html.startsWith('<hr')) {
            html = `<p>${html}</p>`;
        }

        return html;
    }

    // ── Card action listeners ─────────────────────────────────────────────────
    function attachCardListeners() {
        editorBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const segIdx = btn.dataset.seg;
            const card = document.getElementById(`card-${segIdx}`);
            const suggestionEl = document.getElementById(`suggestion-${segIdx}`);
            const customInput = document.getElementById(`custom-${segIdx}`);

            if (action === 'accept') {
                acceptCard(card, segIdx, suggestionEl.textContent);
            } else if (action === 'regenerate') {
                await regenerateCard(card, segIdx, btn);
            } else if (action === 'custom') {
                // Toggle custom input
                if (customInput.style.display === 'none' || !customInput.style.display) {
                    customInput.style.display = 'block';
                    customInput.focus();
                    btn.textContent = '✓ Use this';
                    btn.dataset.action = 'accept-custom';
                } else {
                    customInput.style.display = 'none';
                    btn.textContent = '✎ Use mine';
                    btn.dataset.action = 'custom';
                }
            } else if (action === 'accept-custom') {
                const text = customInput.value.trim();
                if (text) {
                    acceptCard(card, segIdx, text);
                } else {
                    showToast('Please enter your replacement text first.');
                }
            } else if (action === 'skip') {
                skipCard(card, segIdx);
            }
        });
    }

    function acceptCard(card, segIdx, replacementText) {
        // Replace the HUMAN_EDIT marker in currentContent with the accepted text
        const segments = splitContent(currentContent);
        let seg = segments.find((s, i) => i.toString() === segIdx.toString() && s.type === 'marker');

        // Find and replace the raw marker comment in currentContent
        // We rebuild content by substituting the marker
        currentContent = replaceMarkerInContent(currentContent, parseInt(segIdx), replacementText);

        // Update card UI
        card.classList.remove('br-edit-card');
        card.style.border = '2px solid var(--color-success, #10b981)';
        card.style.background = 'var(--color-success-bg, #d1fae5)';
        card.style.borderRadius = 'var(--radius-lg)';
        card.style.padding = '12px 16px';
        card.style.margin = '12px 0';
        card.dataset.pending = 'false';

        // Show accepted replacement inline
        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem;font-weight:600;color:var(--color-success,#10b981);margin-bottom:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Accepted
            </div>
            <div style="font-size:0.9rem;color:var(--color-text)">${escapeHtml(replacementText)}</div>
        `;

        pendingMarkerCount--;
        updateProgress();
    }

    function skipCard(card, segIdx) {
        card.dataset.pending = 'false';
        card.style.opacity = '0.5';
        const header = card.querySelector('.br-edit-card-header');
        if (header) header.style.background = 'var(--color-text-muted)';
        const actions = card.querySelector('.br-card-actions');
        if (actions) actions.style.display = 'none';
        pendingMarkerCount--;
        updateProgress();
        showToast('Skipped — this section stays as-is. You can still publish.');
    }

    async function regenerateCard(card, segIdx, triggerBtn) {
        const suggestionEl = document.getElementById(`suggestion-${segIdx}`);
        const segments = splitContent(currentContent);
        const seg = segments.filter(s => s.type === 'marker')[
            // Count which marker index this is
            Array.from(editorBody.querySelectorAll('.br-edit-card')).indexOf(card)
        ] || {};

        const markerType = card.dataset.type;
        const prompt = card.querySelector('.br-edit-prompt')?.textContent || '';

        // Disable buttons, show loading
        card.querySelectorAll('.br-btn').forEach(b => b.disabled = true);
        suggestionEl.classList.add('loading');
        suggestionEl.textContent = 'Generating new suggestion...';

        try {
            const session = await getValidSession();
            const resp = await fetch(
                `${SUPABASE_URL}/functions/v1/blog-humanize`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        marker_type: markerType,
                        prompt: prompt,
                        article_title: currentArticle?.title,
                        article_context: '',
                    }),
                }
            );

            if (!resp.ok) throw new Error(`${resp.status}`);
            const result = await resp.json();

            if (result.suggestion) {
                suggestionEl.textContent = result.suggestion;
                suggestionEl.classList.remove('loading');

                // Update score display
                const scoreEl = card.querySelector('.br-edit-card-score');
                if (scoreEl && result.humanness_score) {
                    const s = result.humanness_score;
                    const label = s < 0.4 ? 'Must rewrite' : s < 0.7 ? 'Edit heavily' : 'Light edit';
                    scoreEl.textContent = `Score: ${s.toFixed(2)} — ${label}`;
                }
            } else {
                throw new Error(result.error || 'Empty response');
            }
        } catch (err) {
            suggestionEl.classList.remove('loading');
            suggestionEl.textContent = '(Regeneration failed — using original suggestion)';
            console.error('Regenerate error:', err);
            showToast('Regeneration failed. Please try again.');
        }

        card.querySelectorAll('.br-btn').forEach(b => b.disabled = false);
    }

    // ── Content manipulation ──────────────────────────────────────────────────
    // Replace the Nth HUMAN_EDIT marker in content with replacementText
    function replaceMarkerInContent(content, targetSegmentIdx, replacementText) {
        // We need to find the targetSegmentIdx-th HUMAN_EDIT comment and replace it
        // Strategy: iterate through content splitting on markers, counting all segments
        const markerRe = /<!--\s*HUMAN_EDIT[\s\S]*?-->/gi;
        let markerCount = 0;
        let result = content;

        // Count how many marker segments come before this one in the full segment list
        const allSegments = content.replace(/<!--\s*REVIEW_CHECKLIST[\s\S]*?-->/gi, '').split(/(<!--\s*HUMAN_EDIT[\s\S]*?-->)/gi);
        let markerSeenCount = 0;
        let targetMarkerText = null;

        for (const part of allSegments) {
            if (/^<!--\s*HUMAN_EDIT/i.test(part)) {
                // This is a marker. Figure out which segment index it corresponds to
                // (we need the overall segment index which includes text segments)
                if (markerSeenCount === targetSegmentIdx - Math.floor(targetSegmentIdx / 2)) {
                    targetMarkerText = part;
                    break;
                }
                markerSeenCount++;
            }
        }

        // Simpler approach: collect all markers in order and replace the one at the right position
        const allMarkers = [...content.matchAll(/<!--\s*HUMAN_EDIT[\s\S]*?-->/gi)];
        // Find which marker index this card corresponds to by counting cards before it
        const cardEls = Array.from(editorBody.querySelectorAll('[data-seg]'));
        const cardEl = cardEls.find(el => el.dataset.seg === targetSegmentIdx.toString());
        const cardsBefore = cardEl ? Array.from(editorBody.querySelectorAll('[data-seg]'))
            .filter(el => parseInt(el.dataset.seg) < parseInt(targetSegmentIdx) && el.classList.contains('br-edit-card') || el.querySelector('.br-edit-card-header'))
            .length : 0;

        // Use DOM-based count: how many br-edit-card data-seg values are < targetSegmentIdx
        let markerIdx = 0;
        const editorCards = editorBody.querySelectorAll('[data-pending]');
        for (const c of editorCards) {
            if (parseInt(c.dataset.seg) < parseInt(targetSegmentIdx)) {
                markerIdx++;
            }
        }

        if (allMarkers[markerIdx]) {
            const matchedMarker = allMarkers[markerIdx][0];
            result = content.replace(matchedMarker, replacementText);
        }

        return result;
    }

    // Count remaining HUMAN_EDIT markers in content
    function countMarkers(content) {
        const matches = content.match(/<!--\s*HUMAN_EDIT[\s\S]*?-->/gi);
        return matches ? matches.length : 0;
    }

    function parseOverallScore(content) {
        const m = content.match(/overall_humanness_score:\s*([\d.]+)/i);
        return m ? parseFloat(m[1]) : 0;
    }

    function scoreClass(score) {
        if (score < 0.4) return 'br-score-low';
        if (score < 0.7) return 'br-score-mid';
        return 'br-score-high';
    }

    // ── Progress tracking ─────────────────────────────────────────────────────
    function updateProgress() {
        const remaining = editorBody.querySelectorAll('[data-pending="true"]').length;
        pendingMarkerCount = remaining;

        if (remaining === 0) {
            progressText.textContent = 'All edits resolved ✓';
            progressText.style.color = 'var(--color-success, #10b981)';
            publishBtn.disabled = false;
            publishBtn.title = '';
        } else {
            progressText.textContent = `${remaining} edit${remaining !== 1 ? 's' : ''} remaining`;
            progressText.style.color = 'var(--color-text-muted)';
            publishBtn.disabled = true;
            publishBtn.title = 'Resolve all edits before publishing';
        }
    }

    // ── Save & Publish ────────────────────────────────────────────────────────
    saveBtn.addEventListener('click', () => saveDraft('draft'));
    publishBtn.addEventListener('click', () => {
        if (pendingMarkerCount === 0) saveDraft('published');
    });

    async function saveDraft(status) {
        saveBtn.disabled = true;
        publishBtn.disabled = true;
        saveStatus.textContent = 'Saving...';
        saveStatus.classList.remove('saved');

        try {
            const { data, error } = await db.rpc('update_draft_article', {
                p_article_id: currentArticle.id,
                p_content: currentContent,
                p_status: status,
            });

            if (error) throw error;

            if (status === 'published') {
                showToast('Published! Article is now live on the blog.');
                saveStatus.textContent = 'Published ✓';
                saveStatus.classList.add('saved');
                // After short delay, go back to list
                setTimeout(() => {
                    editorView.style.display = 'none';
                    listView.style.display = 'block';
                    loadArticles();
                }, 1500);
            } else {
                saveStatus.textContent = 'Saved ✓';
                saveStatus.classList.add('saved');
                showToast('Draft saved.');
                setTimeout(() => {
                    saveStatus.textContent = '';
                    saveStatus.classList.remove('saved');
                }, 3000);
            }

            // Update local article cache
            const idx = allArticles.findIndex(a => a.id === currentArticle.id);
            if (idx >= 0) {
                allArticles[idx].content = currentContent;
                allArticles[idx].status = status;
            }
        } catch (err) {
            console.error('Save error:', err);
            saveStatus.textContent = 'Save failed';
            showToast('Save failed. Please try again.');
        }

        saveBtn.disabled = false;
        if (pendingMarkerCount === 0) publishBtn.disabled = false;
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    let toastTimer;
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ── Start ─────────────────────────────────────────────────────────────────
    await loadArticles();

})();
