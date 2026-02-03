/**
 * Soft Delete Utility
 * Enables 1-hour recovery window for deleted items
 *
 * Usage:
 *   // Soft delete an item
 *   const result = await SoftDelete.delete('projects', projectId);
 *   if (result.success) {
 *       UndoToast.show({ ... }); // Show undo option
 *   }
 *
 *   // Restore an item
 *   await SoftDelete.restore('projects', projectId);
 */

// Recovery window duration in milliseconds (1 hour)
const SOFT_DELETE_RECOVERY_WINDOW_MS = 60 * 60 * 1000;

// Supported entity types
const SOFT_DELETE_ENTITY_TYPES = {
    projects: { table: 'projects', nameField: 'name' },
    automations: { table: 'automations', nameField: 'name' },
    customers: { table: 'customers', nameField: 'first_name' }, // customers use first_name/last_name
    blog_posts: { table: 'blog_posts', nameField: 'title' },
    project_customers: { table: 'project_customers', nameField: null }
};

window.SoftDelete = {
    /**
     * Soft delete an item (sets deleted_at timestamp)
     * @param {string} entityType - Type of entity (projects, automations, customers, blog_posts)
     * @param {string} id - UUID of the item to delete
     * @param {object} options - Optional { userId, itemData }
     * @returns {Promise<{success: boolean, error?: string, deletedAt?: string}>}
     */
    async delete(entityType, id, options = {}) {
        const config = SOFT_DELETE_ENTITY_TYPES[entityType];
        if (!config) {
            return { success: false, error: `Unknown entity type: ${entityType}` };
        }

        const { userId } = options;
        const deletedAt = new Date().toISOString();

        const updateData = {
            deleted_at: deletedAt
        };

        // Add deleted_by if userId provided
        if (userId) {
            updateData.deleted_by = userId;
        }

        const { error } = await supabase
            .from(config.table)
            .update(updateData)
            .eq('id', id)
            .is('deleted_at', null); // Only delete if not already deleted

        if (error) {
            console.error(`[SoftDelete] Failed to delete ${entityType}:`, error);
            return { success: false, error: error.message };
        }

        return { success: true, deletedAt };
    },

    /**
     * Restore a soft-deleted item within the recovery window
     * @param {string} entityType - Type of entity
     * @param {string} id - UUID of the item to restore
     * @returns {Promise<{success: boolean, error?: string, data?: object}>}
     */
    async restore(entityType, id) {
        const config = SOFT_DELETE_ENTITY_TYPES[entityType];
        if (!config) {
            return { success: false, error: `Unknown entity type: ${entityType}` };
        }

        // First check if item exists and is within recovery window
        const { data: item, error: fetchError } = await supabase
            .from(config.table)
            .select('*')
            .eq('id', id)
            .not('deleted_at', 'is', null)
            .single();

        if (fetchError || !item) {
            return { success: false, error: 'Item not found or not deleted' };
        }

        // Check if within recovery window
        const deletedAt = new Date(item.deleted_at);
        const now = new Date();
        const timeSinceDelete = now - deletedAt;

        if (timeSinceDelete > SOFT_DELETE_RECOVERY_WINDOW_MS) {
            return {
                success: false,
                error: 'Recovery window expired (1 hour limit)'
            };
        }

        // Restore the item
        const { data, error } = await supabase
            .from(config.table)
            .update({ deleted_at: null, deleted_by: null })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error(`[SoftDelete] Failed to restore ${entityType}:`, error);
            return { success: false, error: error.message };
        }

        return { success: true, data };
    },

    /**
     * Permanently delete an item (bypasses soft delete)
     * Use with caution - typically only called by cleanup processes
     * @param {string} entityType - Type of entity
     * @param {string} id - UUID of the item to permanently delete
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async permanentDelete(entityType, id) {
        const config = SOFT_DELETE_ENTITY_TYPES[entityType];
        if (!config) {
            return { success: false, error: `Unknown entity type: ${entityType}` };
        }

        const { error } = await supabase
            .from(config.table)
            .delete()
            .eq('id', id);

        if (error) {
            console.error(`[SoftDelete] Failed to permanently delete ${entityType}:`, error);
            return { success: false, error: error.message };
        }

        return { success: true };
    },

    /**
     * Get all recoverable items for an organization
     * @param {string} organizationId - Organization UUID
     * @returns {Promise<{success: boolean, items?: array, error?: string}>}
     */
    async getRecoverableItems(organizationId) {
        const cutoff = new Date(Date.now() - SOFT_DELETE_RECOVERY_WINDOW_MS).toISOString();
        const items = [];

        // Tables with direct organization_id
        const directOrgTables = ['projects', 'customers'];

        for (const type of directOrgTables) {
            const config = SOFT_DELETE_ENTITY_TYPES[type];
            const { data, error } = await supabase
                .from(config.table)
                .select('id, deleted_at, deleted_by, organization_id, ' + (config.nameField || 'id'))
                .eq('organization_id', organizationId)
                .not('deleted_at', 'is', null)
                .gte('deleted_at', cutoff);

            if (!error && data) {
                items.push(...data.map(item => ({
                    ...item,
                    entityType: type,
                    entityName: config.nameField ? item[config.nameField] : item.id,
                    timeRemaining: this.getTimeRemaining(item.deleted_at)
                })));
            }
        }

        // Automations - join through projects
        const { data: automations, error: autoError } = await supabase
            .from('automations')
            .select('id, deleted_at, deleted_by, name, project_id, projects!inner(organization_id)')
            .eq('projects.organization_id', organizationId)
            .not('deleted_at', 'is', null)
            .gte('deleted_at', cutoff);

        if (!autoError && automations) {
            items.push(...automations.map(item => ({
                id: item.id,
                deleted_at: item.deleted_at,
                deleted_by: item.deleted_by,
                organization_id: item.projects?.organization_id,
                entityType: 'automations',
                entityName: item.name,
                timeRemaining: this.getTimeRemaining(item.deleted_at)
            })));
        }

        // Sort by deleted_at (most recent first)
        items.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

        return { success: true, items };
    },

    /**
     * Check if an item is within the recovery window
     * @param {string} deletedAt - ISO timestamp of deletion
     * @returns {boolean}
     */
    isRecoverable(deletedAt) {
        if (!deletedAt) return false;
        const timeSinceDelete = Date.now() - new Date(deletedAt).getTime();
        return timeSinceDelete <= SOFT_DELETE_RECOVERY_WINDOW_MS;
    },

    /**
     * Get time remaining in recovery window
     * @param {string} deletedAt - ISO timestamp of deletion
     * @returns {{minutes: number, seconds: number, formatted: string, expired: boolean}}
     */
    getTimeRemaining(deletedAt) {
        if (!deletedAt) return { minutes: 0, seconds: 0, formatted: '0:00', expired: true };

        const deletedTime = new Date(deletedAt).getTime();
        const expiresAt = deletedTime + SOFT_DELETE_RECOVERY_WINDOW_MS;
        const remaining = expiresAt - Date.now();

        if (remaining <= 0) {
            return { minutes: 0, seconds: 0, formatted: '0:00', expired: true };
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        return {
            minutes,
            seconds,
            formatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
            expired: false
        };
    },

    /**
     * Recovery window duration in milliseconds
     */
    RECOVERY_WINDOW_MS: SOFT_DELETE_RECOVERY_WINDOW_MS
};
