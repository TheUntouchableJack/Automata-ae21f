// =====================================================
// AUDIT LOG UTILITY
// Centralized logging for tracking user actions
// =====================================================

const AuditLog = (function() {
    'use strict';

    // Entity type constants
    const ENTITY_TYPES = {
        PROJECT: 'project',
        AUTOMATION: 'automation',
        CUSTOMER: 'customer',
        TEAM_MEMBER: 'team_member',
        TEAM_INVITE: 'team_invite',
        SETTINGS: 'settings'
    };

    // Action constants
    const ACTIONS = {
        CREATE: 'create',
        UPDATE: 'update',
        DELETE: 'delete',
        ACTIVATE: 'activate',
        DEACTIVATE: 'deactivate',
        INVITE: 'invite',
        REMOVE: 'remove',
        ROLE_CHANGE: 'role_change',
        CANCEL: 'cancel'
    };

    /**
     * Log an audit event
     * @param {Object} params
     * @param {string} params.organizationId - Organization UUID
     * @param {string} params.entityType - Type of entity (use ENTITY_TYPES)
     * @param {string} params.entityId - UUID of affected entity (optional)
     * @param {string} params.entityName - Display name of entity
     * @param {string} params.action - Action performed (use ACTIONS)
     * @param {Object} params.previousData - State before change (optional)
     * @param {Object} params.newData - State after change (optional)
     * @param {Object} params.changesSummary - Summary of field changes (optional)
     * @returns {Promise<{data, error}>}
     */
    async function log(params) {
        try {
            // Get current user info
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                console.error('AuditLog: No authenticated user');
                return { data: null, error: new Error('No authenticated user') };
            }

            // Get user profile for name
            const { data: profile } = await supabase
                .from('profiles')
                .select('first_name, last_name, email')
                .eq('id', user.id)
                .single();

            const userName = profile
                ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
                : null;
            const userEmail = profile?.email || user.email;

            const logEntry = {
                organization_id: params.organizationId,
                user_id: user.id,
                user_email: userEmail,
                user_name: userName || null,
                entity_type: params.entityType,
                entity_id: params.entityId || null,
                entity_name: params.entityName || null,
                action: params.action,
                previous_data: params.previousData || null,
                new_data: params.newData || null,
                changes_summary: params.changesSummary || null
            };

            const { data, error } = await supabase
                .from('audit_logs')
                .insert([logEntry])
                .select()
                .single();

            if (error) {
                console.error('AuditLog: Error logging event:', error);
            }

            return { data, error };

        } catch (err) {
            console.error('AuditLog: Unexpected error:', err);
            return { data: null, error: err };
        }
    }

    /**
     * Calculate changes summary between two objects
     * @param {Object} previous - Previous state
     * @param {Object} current - Current state
     * @param {Array<string>} fieldsToTrack - Fields to compare
     * @returns {Object|null} Changes summary or null if no changes
     */
    function calculateChanges(previous, current, fieldsToTrack) {
        const changes = {};

        fieldsToTrack.forEach(field => {
            const oldVal = previous?.[field];
            const newVal = current?.[field];

            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                changes[field] = { old: oldVal, new: newVal };
            }
        });

        return Object.keys(changes).length > 0 ? changes : null;
    }

    // =====================================================
    // CONVENIENCE METHODS
    // =====================================================

    // --- Projects ---

    async function logProjectCreate(organizationId, project) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.PROJECT,
            entityId: project.id,
            entityName: project.name,
            action: ACTIONS.CREATE,
            newData: project
        });
    }

    async function logProjectUpdate(organizationId, projectId, projectName, previousData, newData, fieldsChanged) {
        const changesSummary = calculateChanges(previousData, newData, fieldsChanged);
        return log({
            organizationId,
            entityType: ENTITY_TYPES.PROJECT,
            entityId: projectId,
            entityName: projectName,
            action: ACTIONS.UPDATE,
            previousData,
            newData,
            changesSummary
        });
    }

    async function logProjectDelete(organizationId, project) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.PROJECT,
            entityId: project.id,
            entityName: project.name,
            action: ACTIONS.DELETE,
            previousData: project
        });
    }

    // --- Automations ---

    async function logAutomationCreate(organizationId, automation) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.AUTOMATION,
            entityId: automation.id,
            entityName: automation.name,
            action: ACTIONS.CREATE,
            newData: automation
        });
    }

    async function logAutomationUpdate(organizationId, automationId, automationName, previousData, newData, fieldsChanged) {
        const changesSummary = calculateChanges(previousData, newData, fieldsChanged);
        return log({
            organizationId,
            entityType: ENTITY_TYPES.AUTOMATION,
            entityId: automationId,
            entityName: automationName,
            action: ACTIONS.UPDATE,
            previousData,
            newData,
            changesSummary
        });
    }

    async function logAutomationToggle(organizationId, automationId, automationName, isActive) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.AUTOMATION,
            entityId: automationId,
            entityName: automationName,
            action: isActive ? ACTIONS.ACTIVATE : ACTIONS.DEACTIVATE,
            changesSummary: { is_active: { old: !isActive, new: isActive } }
        });
    }

    async function logAutomationDelete(organizationId, automation) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.AUTOMATION,
            entityId: automation.id,
            entityName: automation.name,
            action: ACTIONS.DELETE,
            previousData: automation
        });
    }

    // --- Customers ---

    async function logCustomerCreate(organizationId, customer) {
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email;
        return log({
            organizationId,
            entityType: ENTITY_TYPES.CUSTOMER,
            entityId: customer.id,
            entityName: name,
            action: ACTIONS.CREATE,
            newData: customer
        });
    }

    async function logCustomerUpdate(organizationId, customerId, customerName, previousData, newData, fieldsChanged) {
        const changesSummary = calculateChanges(previousData, newData, fieldsChanged);
        return log({
            organizationId,
            entityType: ENTITY_TYPES.CUSTOMER,
            entityId: customerId,
            entityName: customerName,
            action: ACTIONS.UPDATE,
            previousData,
            newData,
            changesSummary
        });
    }

    async function logCustomerDelete(organizationId, customer) {
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email;
        return log({
            organizationId,
            entityType: ENTITY_TYPES.CUSTOMER,
            entityId: customer.id,
            entityName: name,
            action: ACTIONS.DELETE,
            previousData: customer
        });
    }

    async function logCustomerBulkImport(organizationId, count, filename) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.CUSTOMER,
            entityName: `${count} customers from ${filename}`,
            action: ACTIONS.CREATE,
            newData: { import_count: count, filename }
        });
    }

    // --- Team ---

    async function logTeamInvite(organizationId, email, role) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.TEAM_INVITE,
            entityName: email,
            action: ACTIONS.INVITE,
            newData: { email, role }
        });
    }

    async function logTeamInviteCancel(organizationId, email) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.TEAM_INVITE,
            entityName: email,
            action: ACTIONS.CANCEL,
            previousData: { email }
        });
    }

    async function logTeamRoleChange(organizationId, memberId, memberName, oldRole, newRole) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.TEAM_MEMBER,
            entityId: memberId,
            entityName: memberName,
            action: ACTIONS.ROLE_CHANGE,
            changesSummary: { role: { old: oldRole, new: newRole } }
        });
    }

    async function logTeamRemove(organizationId, memberId, memberData) {
        return log({
            organizationId,
            entityType: ENTITY_TYPES.TEAM_MEMBER,
            entityId: memberId,
            entityName: memberData.name || memberData.email,
            action: ACTIONS.REMOVE,
            previousData: memberData
        });
    }

    // --- Settings ---

    async function logSettingsUpdate(organizationId, section, previousData, newData, fieldsChanged) {
        const changesSummary = calculateChanges(previousData, newData, fieldsChanged);
        return log({
            organizationId,
            entityType: ENTITY_TYPES.SETTINGS,
            entityName: section,
            action: ACTIONS.UPDATE,
            previousData,
            newData,
            changesSummary
        });
    }

    // Public API
    return {
        ENTITY_TYPES,
        ACTIONS,
        log,
        calculateChanges,
        // Projects
        logProjectCreate,
        logProjectUpdate,
        logProjectDelete,
        // Automations
        logAutomationCreate,
        logAutomationUpdate,
        logAutomationToggle,
        logAutomationDelete,
        // Customers
        logCustomerCreate,
        logCustomerUpdate,
        logCustomerDelete,
        logCustomerBulkImport,
        // Team
        logTeamInvite,
        logTeamInviteCancel,
        logTeamRoleChange,
        logTeamRemove,
        // Settings
        logSettingsUpdate
    };
})();
