// ===== Automations Page — Projects Module =====
// Project-based automation management: load, CRUD, creation modal, templates, icons.
// State variables (allAutomations, allProjects, etc.) are in automations.js.

// ===== Load Projects =====
async function loadProjects() {
    if (!currentOrganization) return;

    try {
        const { data: projects, error } = await supabase
            .from('projects')
            .select('id, name, industry')
            .eq('organization_id', currentOrganization.id)
            .order('name');

        if (error) throw error;

        allProjects = projects || [];

        // Populate project dropdowns
        populateProjectDropdowns();
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function populateProjectDropdowns() {
    const scratchSelect = document.getElementById('scratch-project');
    const templateSelect = document.getElementById('template-project');

    const options = allProjects.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');

    if (scratchSelect) {
        scratchSelect.innerHTML = '<option value="">Select a project</option>' + options;
    }
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">Select a project</option>' + options;
    }
}

// ===== Load Automations =====
/** Load project-based automations from the automations table for the current org. */
async function loadAutomations() {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('automations-grid');
    const emptyState = document.getElementById('empty-state');

    if (!currentOrganization) {
        loading.innerHTML = '<p style="color: var(--color-error);">No organization found.</p>';
        return;
    }

    try {
        // Load automations for the organization via projects (exclude soft-deleted)
        // Limit to 1000 to prevent unbounded queries at scale
        const { data: automations, error } = await supabase
            .from('automations')
            .select(`
                *,
                projects!inner (
                    id,
                    name,
                    industry,
                    organization_id
                )
            `)
            .eq('projects.organization_id', currentOrganization.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1000);

        if (error) throw error;

        allAutomations = automations || [];

        loading.style.display = 'none';
        updateCounts();
        renderAutomations();

    } catch (error) {
        console.error('Error loading automations:', error);
        loading.innerHTML = '<p style="color: var(--color-error);">Error loading automations.</p>';
    }
}

function getAutomationIcon(automation) {
    // Use the icon field if available, otherwise fall back to type-based icon
    if (automation.icon && typeof getIconSvg === 'function') {
        return getIconSvg(automation.icon);
    }

    // Fallback to type-based icons
    const icons = {
        'blog_generation': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M8 9H16M8 13H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`,
        'email': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M3 7L12 13L21 7" stroke="currentColor" stroke-width="2"/>
        </svg>`,
        'workflow': `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="6" r="3" stroke="currentColor" stroke-width="2"/>
            <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
            <circle cx="18" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
            <path d="M12 9V12M12 12L6 15M12 12L18 15" stroke="currentColor" stroke-width="2"/>
        </svg>`
    };
    return icons[automation.type] || icons['blog_generation'];
}

function formatFrequency(freq) {
    const frequencies = {
        'daily': 'Daily',
        'weekly': 'Weekly',
        'monthly': 'Monthly'
    };
    return frequencies[freq] || freq || 'Manual';
}

function formatType(type) {
    const types = {
        'blog_generation': 'Blog Generation',
        'email': 'Email',
        'workflow': 'Workflow'
    };
    return types[type] || type || 'Automation';
}

// ===== Archive Automation =====
async function archiveAutomation(id) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ is_archived: true })
            .eq('id', id);

        if (error) throw error;

        // Update local data
        const automation = allAutomations.find(a => a.id === id);
        if (automation) automation.is_archived = true;

        updateCounts();
        renderAutomations();

    } catch (error) {
        console.error('Error archiving automation:', error);
        showToast('Error archiving automation', 'error');
    }
}

window.archiveAutomation = archiveAutomation;

// ===== Restore Automation =====
async function restoreAutomation(id) {
    try {
        const { error } = await supabase
            .from('automations')
            .update({ is_archived: false })
            .eq('id', id);

        if (error) throw error;

        // Update local data
        const automation = allAutomations.find(a => a.id === id);
        if (automation) automation.is_archived = false;

        updateCounts();
        renderAutomations();
        celebrate({ intensity: 'subtle' });

    } catch (error) {
        console.error('Error restoring automation:', error);
        showToast('Error restoring automation', 'error');
    }
}

window.restoreAutomation = restoreAutomation;

// ===== Delete Automation (Soft Delete with 1-hour Undo) =====
function deleteAutomation(id, name) {
    // Get automation data before deleting (for potential restore)
    const automation = allAutomations.find(a => a.id === id);

    DangerModal.show({
        title: 'Delete Automation',
        itemName: name,
        warningText: 'This automation will be deleted. You can undo this within 1 hour.',
        confirmPhrase: 'DELETE THIS AUTOMATION',
        confirmButtonText: 'Delete Automation',
        onConfirm: async () => {
            try {
                // Soft delete - sets deleted_at timestamp
                const result = await SoftDelete.delete('automations', id, {
                    userId: currentUser?.id
                });

                if (!result.success) {
                    throw new Error(result.error);
                }

                // Remove from local data
                allAutomations = allAutomations.filter(a => a.id !== id);
                updateCounts();
                renderAutomations();

                // Show undo toast
                UndoToast.show({
                    message: `"${name}" deleted`,
                    entityType: 'automations',
                    entityId: id,
                    entityName: name,
                    onUndo: async (restoredData) => {
                        // Add back to local data and re-render
                        if (restoredData) {
                            allAutomations.push(restoredData);
                        } else if (automation) {
                            allAutomations.push(automation);
                        }
                        updateCounts();
                        renderAutomations();
                    }
                });

            } catch (error) {
                console.error('Error deleting automation:', error);
                alert(window.t ? window.t('errors.deletingAutomation') : 'Error deleting automation. Please try again.');
            }
        }
    });
}

window.deleteAutomation = deleteAutomation;

// ===== Creation Modal Functions =====
function openCreationModal() {
    showChoosePathStep();
    document.getElementById('create-automation-modal').classList.add('active');
}

function closeCreationModal() {
    document.getElementById('create-automation-modal').classList.remove('active');
    resetCreationModal();
}

function resetCreationModal() {
    // Reset forms
    document.getElementById('create-scratch-form')?.reset();
    document.getElementById('create-template-form')?.reset();

    // Reset icon
    selectedIcon = 'workflow';
    updateIconPreview();

    // Hide icon picker
    const iconPicker = document.getElementById('scratch-icon-picker');
    if (iconPicker) iconPicker.style.display = 'none';

    // Reset template selection
    selectedTemplateId = null;
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
}

function showChoosePathStep() {
    document.getElementById('step-choose-path').style.display = 'block';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'none';
}

function showFromScratchStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'block';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'none';
    document.getElementById('scratch-name')?.focus();
}

function showFromTemplateStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'block';
    document.getElementById('step-customize-template').style.display = 'none';
}

function showCustomizeTemplateStep() {
    document.getElementById('step-choose-path').style.display = 'none';
    document.getElementById('step-from-scratch').style.display = 'none';
    document.getElementById('step-from-template').style.display = 'none';
    document.getElementById('step-customize-template').style.display = 'block';
}

// ===== Icon Functions =====
function handleIconDetection() {
    const name = document.getElementById('scratch-name')?.value || '';
    const description = document.getElementById('scratch-description')?.value || '';

    if (name || description) {
        selectedIcon = detectIcon(name, description);
        updateIconPreview();
        document.getElementById('scratch-icon').value = selectedIcon;
    }
}

function updateIconPreview() {
    const preview = document.getElementById('scratch-icon-preview');
    if (preview && typeof getIconSvg === 'function') {
        preview.innerHTML = getIconSvg(selectedIcon);
    }

    // Update picker selection
    document.querySelectorAll('.icon-picker-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.icon === selectedIcon);
    });
}

function toggleIconPicker() {
    const picker = document.getElementById('scratch-icon-picker');
    if (picker) {
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    }
}

function populateIconPicker() {
    const picker = document.getElementById('scratch-icon-picker');
    if (!picker || typeof getAllIcons !== 'function') return;

    const icons = getAllIcons();
    picker.innerHTML = icons.map(icon => `
        <div class="icon-picker-item ${icon.key === selectedIcon ? 'selected' : ''}"
             data-icon="${icon.key}"
             title="${icon.name}"
             onclick="selectIcon('${icon.key}')">
            ${icon.svg}
        </div>
    `).join('');
}

function selectIcon(iconKey) {
    selectedIcon = iconKey;
    document.getElementById('scratch-icon').value = iconKey;
    updateIconPreview();
    toggleIconPicker();
}

window.selectIcon = selectIcon;

// ===== Templates Functions =====
function populateTemplatesGrid() {
    const grid = document.getElementById('templates-grid');
    if (!grid || typeof getAllTemplates !== 'function') return;

    const templates = getAllTemplates();
    grid.innerHTML = templates.map(template => `
        <div class="template-card" data-template-id="${template.id}" onclick="selectTemplate('${template.id}')">
            <div class="template-card-icon">
                ${typeof getIconSvg === 'function' ? getIconSvg(template.icon) : ''}
            </div>
            <div class="template-card-name">${escapeHtml(template.name)}</div>
            <div class="template-card-desc">${escapeHtml(template.description)}</div>
            <div class="template-card-meta">
                <span class="template-meta-badge">${template.type}</span>
                <span class="template-meta-badge">${template.frequency}</span>
            </div>
        </div>
    `).join('');
}

function selectTemplate(templateId) {
    selectedTemplateId = templateId;

    // Update selection UI
    document.querySelectorAll('.template-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.templateId === templateId);
    });

    // Get template details
    const template = typeof getTemplateById === 'function' ? getTemplateById(templateId) : null;
    if (!template) return;

    // Populate customize form
    document.getElementById('template-id').value = template.id;
    document.getElementById('template-name').value = template.name;
    document.getElementById('template-type').value = template.type;
    document.getElementById('template-frequency').value = template.frequency;
    document.getElementById('template-icon').value = template.icon;
    document.getElementById('template-description').value = template.description;

    // Set target segment
    const segmentSelect = document.getElementById('template-segment');
    if (segmentSelect && template.targetSegment) {
        if (template.targetSegment === 'all' || template.targetSegment === 'project') {
            segmentSelect.value = template.targetSegment;
        } else {
            segmentSelect.value = 'all';
        }
    }

    // Update preview
    document.getElementById('template-preview-icon').innerHTML =
        typeof getIconSvg === 'function' ? getIconSvg(template.icon) : '';
    document.getElementById('template-preview-name').textContent = template.name;
    document.getElementById('template-preview-desc').textContent = template.description;

    // Show customize step
    showCustomizeTemplateStep();
}

window.selectTemplate = selectTemplate;

// ===== Create Automation Handlers =====
async function handleCreateFromScratch(e) {
    e.preventDefault();

    // Prevent double-submit
    if (isSubmitting) return;
    isSubmitting = true;

    const btn = document.getElementById('create-scratch-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const projectId = document.getElementById('scratch-project').value;
    const name = document.getElementById('scratch-name').value.trim();
    const description = document.getElementById('scratch-description').value.trim();
    const type = document.getElementById('scratch-type').value;
    const frequency = document.getElementById('scratch-frequency').value;
    const targetSegment = document.getElementById('scratch-segment').value;
    const icon = document.getElementById('scratch-icon').value || 'workflow';

    try {
        const { data, error } = await supabase
            .from('automations')
            .insert([{
                project_id: projectId,
                name,
                description,
                type,
                frequency,
                icon,
                target_segment: targetSegment,
                is_active: false,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Celebrate and redirect
        if (typeof celebrate === 'function') celebrate();
        btn.textContent = 'Created!';

        setTimeout(() => {
            window.location.href = `/app/automation.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating automation:', error);
        alert(window.t ? window.t('errors.creatingAutomation') : 'Error creating automation. Please try again.');
        btn.disabled = false;
        btn.textContent = originalText;
        isSubmitting = false;  // Reset guard on error
    }
}

async function handleCreateFromTemplate(e) {
    e.preventDefault();

    // Prevent double-submit
    if (isSubmitting) return;
    isSubmitting = true;

    const btn = document.getElementById('create-template-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const projectId = document.getElementById('template-project').value;
    const name = document.getElementById('template-name').value.trim();
    const description = document.getElementById('template-description').value;
    const type = document.getElementById('template-type').value;
    const frequency = document.getElementById('template-frequency').value;
    const icon = document.getElementById('template-icon').value;
    const templateId = document.getElementById('template-id').value;
    const targetSegment = document.getElementById('template-segment').value;

    try {
        const { data, error } = await supabase
            .from('automations')
            .insert([{
                project_id: projectId,
                name,
                description,
                type,
                frequency,
                icon,
                template_id: templateId,
                target_segment: targetSegment,
                is_active: false,
                settings: {}
            }])
            .select()
            .single();

        if (error) throw error;

        // Celebrate and redirect
        if (typeof celebrate === 'function') celebrate();
        btn.textContent = 'Created!';

        setTimeout(() => {
            window.location.href = `/app/automation.html#${data.id}`;
        }, 800);

    } catch (error) {
        console.error('Error creating automation:', error);
        alert(window.t ? window.t('errors.creatingAutomation') : 'Error creating automation. Please try again.');
        btn.disabled = false;
        btn.textContent = originalText;
        isSubmitting = false;  // Reset guard on error
    }
}
