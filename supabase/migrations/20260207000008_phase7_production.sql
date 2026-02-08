-- Migration: Phase 7 - Production Hardening
-- Translations, enhanced auditing, and organization preferences

-- ============================================================================
-- 1. TRANSLATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    locale TEXT NOT NULL,           -- 'en', 'es', 'fr', etc.
    namespace TEXT NOT NULL,        -- 'coaching', 'faq', 'discovery', 'errors', 'actions', 'ui'
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(locale, namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_translations_locale ON translations(locale, namespace);

-- ============================================================================
-- 2. ORGANIZATION LOCALE PREFERENCE
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'organizations'
                   AND column_name = 'preferred_locale') THEN
        ALTER TABLE organizations ADD COLUMN preferred_locale TEXT DEFAULT 'en';
    END IF;
END $$;

-- ============================================================================
-- 3. AUDIT LOG RETENTION POLICY (auto-expire old entries)
-- ============================================================================

-- Add expires_at column for automatic cleanup
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'ai_audit_log'
                   AND column_name = 'expires_at') THEN
        ALTER TABLE ai_audit_log ADD COLUMN expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_expires ON ai_audit_log(expires_at);

-- ============================================================================
-- 4. CLEANUP FUNCTION FOR OLD RATE LIMITS
-- ============================================================================

DROP FUNCTION IF EXISTS cleanup_old_rate_limits();
CREATE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_rate_limits
    WHERE window_start < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. CLEANUP FUNCTION FOR EXPIRED AUDIT LOGS
-- ============================================================================

DROP FUNCTION IF EXISTS cleanup_expired_audit_logs();
CREATE FUNCTION cleanup_expired_audit_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_audit_log
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. AUDIT SUMMARY VIEW FOR COMPLIANCE
-- ============================================================================

CREATE OR REPLACE VIEW audit_summary AS
SELECT
    organization_id,
    date_trunc('day', created_at) AS day,
    action_category,
    COUNT(*) AS total_actions,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
    SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited,
    SUM(CASE WHEN pii_detected THEN 1 ELSE 0 END) AS pii_incidents,
    SUM(CASE WHEN auto_executed THEN 1 ELSE 0 END) AS auto_executed,
    AVG(duration_ms)::INTEGER AS avg_duration_ms
FROM ai_audit_log
GROUP BY organization_id, date_trunc('day', created_at), action_category;

-- ============================================================================
-- 7. SEED ENGLISH TRANSLATIONS (Coaching Messages)
-- ============================================================================

INSERT INTO translations (locale, namespace, key, value) VALUES
-- Coaching messages
('en', 'coaching', 'first_intelligence_visit.title', 'Welcome to Royal AI!'),
('en', 'coaching', 'first_intelligence_visit.message', 'I''m your intelligent business advisor. Let''s start by learning about your business. What''s your biggest challenge right now?'),
('en', 'coaching', 'discovery_questions_5.title', 'I''m Learning!'),
('en', 'coaching', 'discovery_questions_5.message', 'Nice! I''m starting to understand your business better. The more we talk, the better my suggestions become.'),
('en', 'coaching', 'first_action_queued.title', 'Action Ready for Review'),
('en', 'coaching', 'first_action_queued.message', 'I''ve prepared an action for you. Review it below - you can approve, edit, or dismiss it.'),
('en', 'coaching', 'auto_pilot_enabled.title', 'Auto-Pilot Active'),
('en', 'coaching', 'auto_pilot_enabled.message', 'Auto-pilot is ON. I''ll only auto-execute when I''m 70%+ confident. You can always intervene or adjust settings.'),
('en', 'coaching', 'first_auto_action.title', 'First Autonomous Action!'),
('en', 'coaching', 'first_auto_action.message', 'I just took my first autonomous action! Check back in 24 hours to see how it performed.'),
('en', 'coaching', 'outcome_measured.title', 'Results Are In'),
('en', 'coaching', 'outcome_measured.message', 'I measured the outcome of a recent action. Check the Action History to see what we learned!'),
('en', 'coaching', 'competitor_research_done.title', 'Competitor Intel Ready'),
('en', 'coaching', 'competitor_research_done.message', 'I''ve gathered intelligence on your competitors. Ask me about their strategies or how to differentiate.'),
('en', 'coaching', 'knowledge_milestone_10.title', 'Growing Knowledge Base'),
('en', 'coaching', 'knowledge_milestone_10.message', 'I now know 10+ facts about your business! My recommendations are getting more personalized.'),

-- Error messages
('en', 'errors', 'rate_limited', 'You''ve reached the limit for this action. Please try again in {{retry_after}} seconds.'),
('en', 'errors', 'tool_failed', 'Sorry, I couldn''t complete that action. Please try again.'),
('en', 'errors', 'validation_failed', 'Some information was missing or invalid. Please check and try again.'),
('en', 'errors', 'ai_unavailable', 'I''m having trouble connecting right now. Your request has been saved and I''ll try again shortly.'),
('en', 'errors', 'action_rejected', 'This action was rejected. Review the details and try a different approach.'),

-- Action confirmations
('en', 'actions', 'announcement_created', 'Announcement created and will be posted to your app.'),
('en', 'actions', 'message_sent', 'Message sent to {{count}} customers.'),
('en', 'actions', 'promotion_started', 'Flash promotion is now live for {{hours}} hours.'),
('en', 'actions', 'points_awarded', 'Awarded {{points}} bonus points to {{count}} members.'),
('en', 'actions', 'automation_enabled', '{{type}} automation is now enabled.'),
('en', 'actions', 'automation_disabled', '{{type}} automation has been disabled.'),
('en', 'actions', 'knowledge_saved', 'Got it! I''ll remember that about your {{category}}.'),

-- UI labels
('en', 'ui', 'pending_actions', 'Pending Actions'),
('en', 'ui', 'action_history', 'Action History'),
('en', 'ui', 'approve', 'Approve'),
('en', 'ui', 'reject', 'Reject'),
('en', 'ui', 'confidence', 'Confidence'),
('en', 'ui', 'auto_pilot', 'Auto-Pilot'),
('en', 'ui', 'review_mode', 'Review Mode'),
('en', 'ui', 'success', 'Success'),
('en', 'ui', 'failed', 'Failed'),
('en', 'ui', 'pending', 'Pending')

ON CONFLICT (locale, namespace, key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- ============================================================================
-- 8. SPANISH TRANSLATIONS
-- ============================================================================

INSERT INTO translations (locale, namespace, key, value) VALUES
-- Coaching messages
('es', 'coaching', 'first_intelligence_visit.title', '¡Bienvenido a Royal AI!'),
('es', 'coaching', 'first_intelligence_visit.message', 'Soy tu asesor de negocios inteligente. Comencemos aprendiendo sobre tu negocio. ¿Cuál es tu mayor desafío ahora mismo?'),
('es', 'coaching', 'discovery_questions_5.title', '¡Estoy Aprendiendo!'),
('es', 'coaching', 'discovery_questions_5.message', '¡Genial! Estoy empezando a entender mejor tu negocio. Cuanto más hablemos, mejores serán mis sugerencias.'),
('es', 'coaching', 'first_action_queued.title', 'Acción Lista para Revisar'),
('es', 'coaching', 'first_action_queued.message', 'He preparado una acción para ti. Revísala abajo - puedes aprobarla, editarla o descartarla.'),
('es', 'coaching', 'auto_pilot_enabled.title', 'Piloto Automático Activo'),
('es', 'coaching', 'auto_pilot_enabled.message', 'El piloto automático está ENCENDIDO. Solo ejecutaré automáticamente cuando tenga 70%+ de confianza.'),
('es', 'coaching', 'first_auto_action.title', '¡Primera Acción Autónoma!'),
('es', 'coaching', 'first_auto_action.message', '¡Acabo de tomar mi primera acción autónoma! Vuelve en 24 horas para ver cómo funcionó.'),

-- Error messages
('es', 'errors', 'rate_limited', 'Has alcanzado el límite para esta acción. Intenta de nuevo en {{retry_after}} segundos.'),
('es', 'errors', 'tool_failed', 'Lo siento, no pude completar esa acción. Por favor intenta de nuevo.'),
('es', 'errors', 'validation_failed', 'Faltaba información o era inválida. Por favor revisa e intenta de nuevo.'),
('es', 'errors', 'ai_unavailable', 'Tengo problemas para conectarme ahora. Tu solicitud se guardó y lo intentaré de nuevo pronto.'),

-- Action confirmations
('es', 'actions', 'announcement_created', 'Anuncio creado y será publicado en tu app.'),
('es', 'actions', 'message_sent', 'Mensaje enviado a {{count}} clientes.'),
('es', 'actions', 'promotion_started', 'La promoción flash está activa por {{hours}} horas.'),
('es', 'actions', 'points_awarded', 'Se otorgaron {{points}} puntos bonus a {{count}} miembros.'),
('es', 'actions', 'knowledge_saved', '¡Entendido! Recordaré eso sobre tu {{category}}.'),

-- UI labels
('es', 'ui', 'pending_actions', 'Acciones Pendientes'),
('es', 'ui', 'action_history', 'Historial de Acciones'),
('es', 'ui', 'approve', 'Aprobar'),
('es', 'ui', 'reject', 'Rechazar'),
('es', 'ui', 'confidence', 'Confianza'),
('es', 'ui', 'auto_pilot', 'Piloto Automático'),
('es', 'ui', 'review_mode', 'Modo Revisión')

ON CONFLICT (locale, namespace, key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- ============================================================================
-- 9. RLS FOR TRANSLATIONS (public read)
-- ============================================================================

ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read translations" ON translations
    FOR SELECT USING (true);

-- ============================================================================
-- 10. COMMENTS
-- ============================================================================

COMMENT ON TABLE translations IS 'Internationalization strings for all UI and coaching content';
COMMENT ON VIEW audit_summary IS 'Aggregated audit statistics for compliance reporting';
COMMENT ON FUNCTION cleanup_old_rate_limits IS 'Remove rate limit entries older than 7 days';
COMMENT ON FUNCTION cleanup_expired_audit_logs IS 'Remove audit logs past their retention period';
