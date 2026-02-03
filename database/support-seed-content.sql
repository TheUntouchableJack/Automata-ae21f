-- =====================================================
-- SUPPORT SYSTEM - Multilingual Seed Content Function
-- Run this after support-system-migration.sql
-- Creates default FAQs and KB articles in all 8 languages
-- =====================================================

-- =====================================================
-- 1. FUNCTION: Seed Default FAQs for an App
-- Call: SELECT seed_support_faqs('app_id', 'org_id', 'en');
-- Supported languages: en, es, fr, de, it, pt, zh, ar
-- =====================================================

CREATE OR REPLACE FUNCTION seed_support_faqs(
    p_app_id UUID,
    p_org_id UUID,
    p_language TEXT DEFAULT 'en'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Check if FAQs already exist for this app
    IF EXISTS (SELECT 1 FROM faq_items WHERE app_id = p_app_id LIMIT 1) THEN
        RETURN 0; -- Already has FAQs, don't overwrite
    END IF;

    -- ===== GETTING STARTED FAQs =====
    IF p_language = 'en' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'How do I earn points?', 'Earn points every time you visit! Simply check in when you arrive - scan our QR code or use the check-in button in the app. You''ll earn points for each visit, plus bonus points for streaks and milestones.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'How do I check my points balance?', 'Your current points balance is displayed at the top of the home screen. Tap on it to see your complete points history and recent transactions.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'What are the membership tiers?', 'We have 4 tiers based on your total points earned: Bronze (0+ pts), Silver (500+ pts), Gold (1,500+ pts), and Platinum (5,000+ pts). Higher tiers unlock exclusive rewards!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'How do I redeem a reward?', 'Go to the Rewards tab, browse available rewards, and tap the one you want. Hit "Redeem" to generate your code, then show it to our staff. Rewards must be used within 7 days.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'Do my points expire?', 'Your points don''t expire as long as you remain active in our program. Stay engaged by visiting us and your points will always be there!', 'points', 20, true),
        (p_app_id, p_org_id, 'How do streak bonuses work?', 'Visit us multiple days in a row to build a streak! The longer your streak, the bigger your bonus points. Keep the momentum going for maximum rewards!', 'points', 21, true),
        (p_app_id, p_org_id, 'I forgot my PIN. What do I do?', 'On the login screen, tap "Forgot PIN?" and enter your email. We''ll send you a link to reset your PIN. Check your spam folder if you don''t see it.', 'account', 30, true),
        (p_app_id, p_org_id, 'How do I refer a friend?', 'Share your unique referral code from the Profile tab! When your friend joins and makes their first visit, you''ll both earn bonus points.', 'account', 31, true),
        (p_app_id, p_org_id, 'How do I contact support?', 'Tap the Help tab and use our chat to get instant answers, or submit a support request. We typically respond within a few hours.', 'general', 40, true);

    ELSIF p_language = 'es' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, '¿Cómo gano puntos?', '¡Gana puntos cada vez que nos visitas! Simplemente regístrate cuando llegues - escanea nuestro código QR o usa el botón de check-in en la app. Ganarás puntos por cada visita, más bonos por rachas y logros.', 'getting_started', 1, true),
        (p_app_id, p_org_id, '¿Cómo veo mi saldo de puntos?', 'Tu saldo de puntos actual se muestra en la parte superior de la pantalla principal. Tócalo para ver tu historial completo de puntos y transacciones recientes.', 'getting_started', 2, true),
        (p_app_id, p_org_id, '¿Cuáles son los niveles de membresía?', 'Tenemos 4 niveles según tus puntos totales: Bronce (0+ pts), Plata (500+ pts), Oro (1.500+ pts) y Platino (5.000+ pts). ¡Los niveles más altos desbloquean recompensas exclusivas!', 'getting_started', 3, true),
        (p_app_id, p_org_id, '¿Cómo canjeo una recompensa?', 'Ve a la pestaña Recompensas, explora las disponibles y toca la que quieras. Presiona "Canjear" para generar tu código, luego muéstralo a nuestro personal. Las recompensas deben usarse en 7 días.', 'rewards', 10, true),
        (p_app_id, p_org_id, '¿Mis puntos expiran?', '¡Tus puntos no expiran mientras permanezcas activo en nuestro programa! Sigue visitándonos y tus puntos siempre estarán ahí.', 'points', 20, true),
        (p_app_id, p_org_id, '¿Cómo funcionan los bonos por racha?', '¡Visítanos varios días seguidos para construir una racha! Cuanto más larga sea tu racha, más puntos de bonificación. ¡Mantén el impulso para máximas recompensas!', 'points', 21, true),
        (p_app_id, p_org_id, 'Olvidé mi PIN. ¿Qué hago?', 'En la pantalla de inicio de sesión, toca "¿Olvidaste tu PIN?" e ingresa tu email. Te enviaremos un enlace para restablecerlo. Revisa tu carpeta de spam si no lo ves.', 'account', 30, true),
        (p_app_id, p_org_id, '¿Cómo refiero a un amigo?', '¡Comparte tu código de referido desde la pestaña Perfil! Cuando tu amigo se una y haga su primera visita, ambos ganarán puntos de bonificación.', 'account', 31, true),
        (p_app_id, p_org_id, '¿Cómo contacto a soporte?', 'Toca la pestaña Ayuda y usa nuestro chat para respuestas instantáneas, o envía una solicitud de soporte. Normalmente respondemos en pocas horas.', 'general', 40, true);

    ELSIF p_language = 'fr' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'Comment gagner des points?', 'Gagnez des points à chaque visite! Enregistrez-vous simplement à votre arrivée - scannez notre code QR ou utilisez le bouton check-in dans l''app. Vous gagnerez des points pour chaque visite, plus des bonus pour les séries et les étapes.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'Comment voir mon solde de points?', 'Votre solde de points actuel est affiché en haut de l''écran d''accueil. Appuyez dessus pour voir votre historique complet et vos transactions récentes.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'Quels sont les niveaux d''adhésion?', 'Nous avons 4 niveaux basés sur vos points totaux: Bronze (0+ pts), Argent (500+ pts), Or (1 500+ pts) et Platine (5 000+ pts). Les niveaux supérieurs débloquent des récompenses exclusives!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'Comment échanger une récompense?', 'Allez dans l''onglet Récompenses, parcourez les disponibles et appuyez sur celle que vous voulez. Appuyez sur "Échanger" pour générer votre code, puis montrez-le à notre personnel. À utiliser sous 7 jours.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'Mes points expirent-ils?', 'Vos points n''expirent pas tant que vous restez actif dans notre programme! Continuez à nous rendre visite et vos points seront toujours là.', 'points', 20, true),
        (p_app_id, p_org_id, 'Comment fonctionnent les bonus de série?', 'Visitez-nous plusieurs jours de suite pour construire une série! Plus votre série est longue, plus vos points bonus sont élevés. Gardez l''élan pour des récompenses maximales!', 'points', 21, true),
        (p_app_id, p_org_id, 'J''ai oublié mon PIN. Que faire?', 'Sur l''écran de connexion, appuyez sur "PIN oublié?" et entrez votre email. Nous vous enverrons un lien pour le réinitialiser. Vérifiez vos spams si vous ne le voyez pas.', 'account', 30, true),
        (p_app_id, p_org_id, 'Comment parrainer un ami?', 'Partagez votre code de parrainage unique depuis l''onglet Profil! Quand votre ami rejoint et fait sa première visite, vous gagnerez tous les deux des points bonus.', 'account', 31, true),
        (p_app_id, p_org_id, 'Comment contacter le support?', 'Appuyez sur l''onglet Aide et utilisez notre chat pour des réponses instantanées, ou soumettez une demande de support. Nous répondons généralement en quelques heures.', 'general', 40, true);

    ELSIF p_language = 'de' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'Wie sammle ich Punkte?', 'Sammeln Sie bei jedem Besuch Punkte! Checken Sie einfach ein, wenn Sie ankommen - scannen Sie unseren QR-Code oder nutzen Sie den Check-in-Button in der App. Sie erhalten Punkte für jeden Besuch, plus Bonuspunkte für Serien und Meilensteine.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'Wie sehe ich meinen Punktestand?', 'Ihr aktueller Punktestand wird oben auf dem Startbildschirm angezeigt. Tippen Sie darauf, um Ihre vollständige Punktehistorie und letzte Transaktionen zu sehen.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'Was sind die Mitgliedschaftsstufen?', 'Wir haben 4 Stufen basierend auf Ihren Gesamtpunkten: Bronze (0+ Pkt), Silber (500+ Pkt), Gold (1.500+ Pkt) und Platin (5.000+ Pkt). Höhere Stufen schalten exklusive Prämien frei!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'Wie löse ich eine Prämie ein?', 'Gehen Sie zum Tab Prämien, durchsuchen Sie die verfügbaren und tippen Sie auf die gewünschte. Tippen Sie auf "Einlösen" um Ihren Code zu generieren, dann zeigen Sie ihn unserem Personal. Prämien müssen innerhalb von 7 Tagen genutzt werden.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'Verfallen meine Punkte?', 'Ihre Punkte verfallen nicht, solange Sie in unserem Programm aktiv bleiben! Besuchen Sie uns weiterhin und Ihre Punkte werden immer da sein.', 'points', 20, true),
        (p_app_id, p_org_id, 'Wie funktionieren Serienbonus?', 'Besuchen Sie uns mehrere Tage hintereinander, um eine Serie aufzubauen! Je länger Ihre Serie, desto größer Ihre Bonuspunkte. Halten Sie das Momentum für maximale Prämien!', 'points', 21, true),
        (p_app_id, p_org_id, 'Ich habe meine PIN vergessen. Was tun?', 'Auf dem Anmeldebildschirm tippen Sie auf "PIN vergessen?" und geben Sie Ihre E-Mail ein. Wir senden Ihnen einen Link zum Zurücksetzen. Prüfen Sie Ihren Spam-Ordner, falls Sie ihn nicht sehen.', 'account', 30, true),
        (p_app_id, p_org_id, 'Wie empfehle ich einen Freund?', 'Teilen Sie Ihren einzigartigen Empfehlungscode aus dem Profil-Tab! Wenn Ihr Freund beitritt und seinen ersten Besuch macht, erhalten Sie beide Bonuspunkte.', 'account', 31, true),
        (p_app_id, p_org_id, 'Wie kontaktiere ich den Support?', 'Tippen Sie auf den Hilfe-Tab und nutzen Sie unseren Chat für sofortige Antworten, oder senden Sie eine Supportanfrage. Wir antworten normalerweise innerhalb weniger Stunden.', 'general', 40, true);

    ELSIF p_language = 'it' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'Come guadagno punti?', 'Guadagna punti ogni volta che ci visiti! Registrati semplicemente al tuo arrivo - scansiona il nostro codice QR o usa il pulsante check-in nell''app. Guadagnerai punti per ogni visita, più bonus per serie e traguardi.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'Come vedo il mio saldo punti?', 'Il tuo saldo punti attuale è mostrato in cima alla schermata principale. Toccalo per vedere la cronologia completa dei punti e le transazioni recenti.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'Quali sono i livelli di membership?', 'Abbiamo 4 livelli basati sui punti totali: Bronzo (0+ pts), Argento (500+ pts), Oro (1.500+ pts) e Platino (5.000+ pts). I livelli più alti sbloccano premi esclusivi!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'Come riscatto un premio?', 'Vai alla scheda Premi, sfoglia quelli disponibili e tocca quello che vuoi. Premi "Riscatta" per generare il tuo codice, poi mostralo al nostro staff. I premi devono essere usati entro 7 giorni.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'I miei punti scadono?', 'I tuoi punti non scadono finché rimani attivo nel nostro programma! Continua a visitarci e i tuoi punti saranno sempre lì.', 'points', 20, true),
        (p_app_id, p_org_id, 'Come funzionano i bonus serie?', 'Visitaci più giorni di fila per costruire una serie! Più lunga è la tua serie, più grandi sono i tuoi punti bonus. Mantieni lo slancio per premi massimi!', 'points', 21, true),
        (p_app_id, p_org_id, 'Ho dimenticato il PIN. Cosa faccio?', 'Nella schermata di login, tocca "PIN dimenticato?" e inserisci la tua email. Ti invieremo un link per reimpostarlo. Controlla la cartella spam se non lo vedi.', 'account', 30, true),
        (p_app_id, p_org_id, 'Come invito un amico?', 'Condividi il tuo codice referral unico dalla scheda Profilo! Quando il tuo amico si unisce e fa la prima visita, entrambi guadagnerete punti bonus.', 'account', 31, true),
        (p_app_id, p_org_id, 'Come contatto il supporto?', 'Tocca la scheda Aiuto e usa la nostra chat per risposte immediate, o invia una richiesta di supporto. Rispondiamo solitamente entro poche ore.', 'general', 40, true);

    ELSIF p_language = 'pt' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'Como ganho pontos?', 'Ganhe pontos toda vez que nos visitar! Simplesmente faça check-in ao chegar - escaneie nosso código QR ou use o botão de check-in no app. Você ganhará pontos por cada visita, mais bônus por sequências e marcos.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'Como vejo meu saldo de pontos?', 'Seu saldo de pontos atual é mostrado no topo da tela inicial. Toque nele para ver seu histórico completo de pontos e transações recentes.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'Quais são os níveis de membership?', 'Temos 4 níveis baseados nos seus pontos totais: Bronze (0+ pts), Prata (500+ pts), Ouro (1.500+ pts) e Platina (5.000+ pts). Níveis mais altos desbloqueiam recompensas exclusivas!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'Como resgato uma recompensa?', 'Vá para a aba Recompensas, navegue pelas disponíveis e toque na que você quer. Pressione "Resgatar" para gerar seu código, depois mostre-o ao nosso staff. Recompensas devem ser usadas em 7 dias.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'Meus pontos expiram?', 'Seus pontos não expiram enquanto você permanecer ativo em nosso programa! Continue nos visitando e seus pontos sempre estarão lá.', 'points', 20, true),
        (p_app_id, p_org_id, 'Como funcionam os bônus de sequência?', 'Visite-nos vários dias seguidos para construir uma sequência! Quanto mais longa sua sequência, maiores seus pontos de bônus. Mantenha o ritmo para recompensas máximas!', 'points', 21, true),
        (p_app_id, p_org_id, 'Esqueci meu PIN. O que faço?', 'Na tela de login, toque em "Esqueceu o PIN?" e digite seu email. Enviaremos um link para redefinir. Verifique sua pasta de spam se não encontrar.', 'account', 30, true),
        (p_app_id, p_org_id, 'Como indico um amigo?', 'Compartilhe seu código de indicação único na aba Perfil! Quando seu amigo entrar e fizer sua primeira visita, vocês dois ganharão pontos de bônus.', 'account', 31, true),
        (p_app_id, p_org_id, 'Como contato o suporte?', 'Toque na aba Ajuda e use nosso chat para respostas instantâneas, ou envie uma solicitação de suporte. Normalmente respondemos em poucas horas.', 'general', 40, true);

    ELSIF p_language = 'zh' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, '如何赚取积分？', '每次光临都能赚取积分！到达时只需签到 - 扫描我们的二维码或使用应用中的签到按钮。每次访问都能获得积分，还有连续签到和里程碑奖励！', 'getting_started', 1, true),
        (p_app_id, p_org_id, '如何查看积分余额？', '您当前的积分余额显示在主屏幕顶部。点击它可以查看完整的积分历史和最近交易记录。', 'getting_started', 2, true),
        (p_app_id, p_org_id, '会员等级有哪些？', '我们有4个等级：铜牌（0+积分）、银牌（500+积分）、金牌（1,500+积分）和白金（5,000+积分）。更高等级可解锁专属奖励！', 'getting_started', 3, true),
        (p_app_id, p_org_id, '如何兑换奖励？', '进入奖励页面，浏览可用奖励并点击您想要的。点击"兑换"生成您的代码，然后向我们的员工出示。奖励必须在7天内使用。', 'rewards', 10, true),
        (p_app_id, p_org_id, '积分会过期吗？', '只要您在我们的计划中保持活跃，积分就不会过期！继续光临，您的积分永远都在。', 'points', 20, true),
        (p_app_id, p_org_id, '连续签到奖励如何运作？', '连续多天光临可以建立连续签到记录！连续天数越长，奖励积分越多。保持势头获得最大奖励！', 'points', 21, true),
        (p_app_id, p_org_id, '忘记PIN码怎么办？', '在登录屏幕，点击"忘记PIN码？"并输入您的邮箱。我们将发送重置链接。如果没看到邮件，请检查垃圾邮件文件夹。', 'account', 30, true),
        (p_app_id, p_org_id, '如何推荐朋友？', '在个人资料页面分享您的专属推荐码！当朋友加入并首次访问时，你们双方都将获得奖励积分。', 'account', 31, true),
        (p_app_id, p_org_id, '如何联系客服？', '点击帮助页面使用我们的聊天功能获得即时回答，或提交支持请求。我们通常在几小时内回复。', 'general', 40, true);

    ELSIF p_language = 'ar' THEN
        INSERT INTO faq_items (app_id, organization_id, question, answer, category, display_order, is_active) VALUES
        (p_app_id, p_org_id, 'كيف أكسب النقاط؟', 'اكسب نقاطاً في كل زيارة! سجّل حضورك عند وصولك - امسح رمز QR أو استخدم زر تسجيل الدخول في التطبيق. ستكسب نقاطاً لكل زيارة، بالإضافة إلى مكافآت للسلاسل والإنجازات.', 'getting_started', 1, true),
        (p_app_id, p_org_id, 'كيف أرى رصيد نقاطي؟', 'يُعرض رصيد نقاطك الحالي في أعلى الشاشة الرئيسية. اضغط عليه لرؤية سجل النقاط الكامل والمعاملات الأخيرة.', 'getting_started', 2, true),
        (p_app_id, p_org_id, 'ما هي مستويات العضوية؟', 'لدينا 4 مستويات بناءً على إجمالي نقاطك: برونزي (0+ نقطة)، فضي (500+ نقطة)، ذهبي (1,500+ نقطة)، وبلاتيني (5,000+ نقطة). المستويات الأعلى تفتح مكافآت حصرية!', 'getting_started', 3, true),
        (p_app_id, p_org_id, 'كيف أستبدل مكافأة؟', 'اذهب إلى تبويب المكافآت، تصفح المتاح واضغط على ما تريده. اضغط "استبدال" لإنشاء رمزك، ثم أظهره لموظفينا. يجب استخدام المكافآت خلال 7 أيام.', 'rewards', 10, true),
        (p_app_id, p_org_id, 'هل تنتهي صلاحية نقاطي؟', 'نقاطك لا تنتهي صلاحيتها طالما بقيت نشطاً في برنامجنا! استمر في زيارتنا ونقاطك ستبقى دائماً موجودة.', 'points', 20, true),
        (p_app_id, p_org_id, 'كيف تعمل مكافآت السلسلة؟', 'زرنا عدة أيام متتالية لبناء سلسلة! كلما طالت سلسلتك، زادت نقاط المكافأة. حافظ على الزخم لمكافآت قصوى!', 'points', 21, true),
        (p_app_id, p_org_id, 'نسيت رمز PIN. ماذا أفعل؟', 'في شاشة تسجيل الدخول، اضغط على "نسيت PIN؟" وأدخل بريدك الإلكتروني. سنرسل رابط إعادة التعيين. تحقق من مجلد البريد المزعج إذا لم تجده.', 'account', 30, true),
        (p_app_id, p_org_id, 'كيف أحيل صديقاً؟', 'شارك رمز الإحالة الخاص بك من تبويب الملف الشخصي! عندما ينضم صديقك ويقوم بأول زيارة، ستكسبان كلاكما نقاط مكافأة.', 'account', 31, true),
        (p_app_id, p_org_id, 'كيف أتواصل مع الدعم؟', 'اضغط على تبويب المساعدة واستخدم الدردشة للحصول على إجابات فورية، أو أرسل طلب دعم. نرد عادةً خلال ساعات قليلة.', 'general', 40, true);

    ELSE
        -- Default to English
        RETURN seed_support_faqs(p_app_id, p_org_id, 'en');
    END IF;

    SELECT COUNT(*) INTO v_count FROM faq_items WHERE app_id = p_app_id;
    RETURN v_count;
END;
$$;

-- =====================================================
-- 2. FUNCTION: Seed Default KB Articles for an App
-- Call: SELECT seed_support_kb_articles('app_id', 'org_id', 'en');
-- =====================================================

CREATE OR REPLACE FUNCTION seed_support_kb_articles(
    p_app_id UUID,
    p_org_id UUID,
    p_language TEXT DEFAULT 'en'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
    v_title TEXT;
    v_slug TEXT;
    v_content TEXT;
    v_excerpt TEXT;
BEGIN
    -- Check if KB articles already exist for this app
    IF EXISTS (SELECT 1 FROM knowledgebase_articles WHERE app_id = p_app_id LIMIT 1) THEN
        RETURN 0;
    END IF;

    -- ===== WELCOME ARTICLE =====
    IF p_language = 'en' THEN
        v_title := 'Welcome to Our Loyalty Program';
        v_excerpt := 'Everything you need to know to start earning rewards with our loyalty program.';
        v_content := '# Welcome to Our Loyalty Program!

We''re excited to have you join our loyalty program. Here''s everything you need to know to start earning rewards.

## How It Works

**1. Check In When You Visit**
Every time you visit, check in using our app to earn points. It''s quick and easy!

**2. Earn Points**
You''ll earn points for every visit. Plus, you can earn bonus points for:
- Maintaining visit streaks
- Reaching milestones
- Referring friends
- Special promotions

**3. Redeem Rewards**
Use your points to claim amazing rewards - from small perks to premium experiences. Browse the Rewards tab to see what''s available.

**4. Level Up**
As you earn more points, you''ll unlock higher membership tiers with exclusive benefits.

## Getting Started Checklist

- Create your account
- Complete your profile
- Make your first check-in
- Browse available rewards
- Share your referral code with friends

## Need Help?

Our AI assistant is available 24/7 to answer your questions. Just tap the Help tab and start chatting!

Happy earning!';

    ELSIF p_language = 'es' THEN
        v_title := 'Bienvenido a Nuestro Programa de Lealtad';
        v_excerpt := 'Todo lo que necesitas saber para comenzar a ganar recompensas con nuestro programa de lealtad.';
        v_content := '# ¡Bienvenido a Nuestro Programa de Lealtad!

Estamos emocionados de que te unas a nuestro programa de lealtad. Aquí está todo lo que necesitas saber para comenzar a ganar recompensas.

## Cómo Funciona

**1. Regístrate Cuando Visites**
Cada vez que nos visites, regístrate usando nuestra app para ganar puntos. ¡Es rápido y fácil!

**2. Gana Puntos**
Ganarás puntos por cada visita. Además, puedes ganar puntos extra por:
- Mantener rachas de visitas
- Alcanzar hitos
- Referir amigos
- Promociones especiales

**3. Canjea Recompensas**
Usa tus puntos para reclamar increíbles recompensas - desde pequeños beneficios hasta experiencias premium. Explora la pestaña Recompensas para ver qué está disponible.

**4. Sube de Nivel**
A medida que ganes más puntos, desbloquearás niveles de membresía más altos con beneficios exclusivos.

## Lista de Inicio

- Crea tu cuenta
- Completa tu perfil
- Haz tu primer check-in
- Explora las recompensas disponibles
- Comparte tu código de referido con amigos

## ¿Necesitas Ayuda?

Nuestro asistente de IA está disponible 24/7 para responder tus preguntas. ¡Solo toca la pestaña Ayuda y comienza a chatear!

¡Feliz acumulación de puntos!';

    ELSIF p_language = 'fr' THEN
        v_title := 'Bienvenue dans Notre Programme de Fidélité';
        v_excerpt := 'Tout ce que vous devez savoir pour commencer à gagner des récompenses avec notre programme de fidélité.';
        v_content := '# Bienvenue dans Notre Programme de Fidélité!

Nous sommes ravis que vous rejoigniez notre programme de fidélité. Voici tout ce que vous devez savoir pour commencer à gagner des récompenses.

## Comment Ça Marche

**1. Enregistrez-vous à Chaque Visite**
Chaque fois que vous nous rendez visite, enregistrez-vous avec notre app pour gagner des points. C''est rapide et facile!

**2. Gagnez des Points**
Vous gagnerez des points pour chaque visite. De plus, vous pouvez gagner des points bonus pour:
- Maintenir des séries de visites
- Atteindre des étapes
- Parrainer des amis
- Promotions spéciales

**3. Échangez des Récompenses**
Utilisez vos points pour réclamer d''incroyables récompenses - des petits avantages aux expériences premium. Parcourez l''onglet Récompenses pour voir ce qui est disponible.

**4. Montez en Niveau**
Au fur et à mesure que vous gagnez plus de points, vous débloquerez des niveaux d''adhésion supérieurs avec des avantages exclusifs.

## Liste de Démarrage

- Créez votre compte
- Complétez votre profil
- Faites votre premier enregistrement
- Parcourez les récompenses disponibles
- Partagez votre code de parrainage avec des amis

## Besoin d''Aide?

Notre assistant IA est disponible 24h/24 et 7j/7 pour répondre à vos questions. Appuyez simplement sur l''onglet Aide et commencez à discuter!

Bonne accumulation de points!';

    ELSIF p_language = 'de' THEN
        v_title := 'Willkommen in Unserem Treueprogramm';
        v_excerpt := 'Alles, was Sie wissen müssen, um mit unserem Treueprogramm Prämien zu sammeln.';
        v_content := '# Willkommen in Unserem Treueprogramm!

Wir freuen uns, dass Sie unserem Treueprogramm beitreten. Hier ist alles, was Sie wissen müssen, um Prämien zu sammeln.

## So Funktioniert Es

**1. Checken Sie Bei Jedem Besuch Ein**
Jedes Mal, wenn Sie uns besuchen, checken Sie mit unserer App ein, um Punkte zu sammeln. Es ist schnell und einfach!

**2. Sammeln Sie Punkte**
Sie erhalten Punkte für jeden Besuch. Außerdem können Sie Bonuspunkte sammeln für:
- Besuchsserien
- Erreichen von Meilensteinen
- Freunde werben
- Sonderaktionen

**3. Lösen Sie Prämien Ein**
Verwenden Sie Ihre Punkte, um tolle Prämien einzulösen - von kleinen Vorteilen bis zu Premium-Erlebnissen. Durchsuchen Sie den Tab Prämien, um zu sehen, was verfügbar ist.

**4. Steigen Sie Auf**
Je mehr Punkte Sie sammeln, desto höhere Mitgliedschaftsstufen mit exklusiven Vorteilen schalten Sie frei.

## Erste-Schritte-Checkliste

- Erstellen Sie Ihr Konto
- Vervollständigen Sie Ihr Profil
- Machen Sie Ihren ersten Check-in
- Durchsuchen Sie verfügbare Prämien
- Teilen Sie Ihren Empfehlungscode mit Freunden

## Brauchen Sie Hilfe?

Unser KI-Assistent steht Ihnen rund um die Uhr zur Verfügung. Tippen Sie einfach auf den Hilfe-Tab und starten Sie einen Chat!

Viel Spaß beim Punkte sammeln!';

    ELSIF p_language = 'it' THEN
        v_title := 'Benvenuto nel Nostro Programma Fedeltà';
        v_excerpt := 'Tutto quello che devi sapere per iniziare a guadagnare premi con il nostro programma fedeltà.';
        v_content := '# Benvenuto nel Nostro Programma Fedeltà!

Siamo entusiasti che tu ti unisca al nostro programma fedeltà. Ecco tutto ciò che devi sapere per iniziare a guadagnare premi.

## Come Funziona

**1. Registrati Quando Visiti**
Ogni volta che ci visiti, registrati usando la nostra app per guadagnare punti. È veloce e facile!

**2. Guadagna Punti**
Guadagnerai punti per ogni visita. Inoltre, puoi guadagnare punti bonus per:
- Mantenere serie di visite
- Raggiungere traguardi
- Invitare amici
- Promozioni speciali

**3. Riscatta Premi**
Usa i tuoi punti per reclamare fantastici premi - da piccoli vantaggi a esperienze premium. Sfoglia la scheda Premi per vedere cosa è disponibile.

**4. Sali di Livello**
Man mano che guadagni più punti, sbloccherai livelli di membership più alti con benefici esclusivi.

## Checklist di Avvio

- Crea il tuo account
- Completa il tuo profilo
- Fai il tuo primo check-in
- Sfoglia i premi disponibili
- Condividi il tuo codice referral con gli amici

## Hai Bisogno di Aiuto?

Il nostro assistente AI è disponibile 24/7 per rispondere alle tue domande. Basta toccare la scheda Aiuto e iniziare a chattare!

Buon accumulo punti!';

    ELSIF p_language = 'pt' THEN
        v_title := 'Bem-vindo ao Nosso Programa de Fidelidade';
        v_excerpt := 'Tudo o que você precisa saber para começar a ganhar recompensas com nosso programa de fidelidade.';
        v_content := '# Bem-vindo ao Nosso Programa de Fidelidade!

Estamos animados por você se juntar ao nosso programa de fidelidade. Aqui está tudo o que você precisa saber para começar a ganhar recompensas.

## Como Funciona

**1. Faça Check-in Quando Visitar**
Toda vez que nos visitar, faça check-in usando nosso app para ganhar pontos. É rápido e fácil!

**2. Ganhe Pontos**
Você ganhará pontos por cada visita. Além disso, pode ganhar pontos bônus por:
- Manter sequências de visitas
- Alcançar marcos
- Indicar amigos
- Promoções especiais

**3. Resgate Recompensas**
Use seus pontos para resgatar recompensas incríveis - de pequenas vantagens a experiências premium. Navegue pela aba Recompensas para ver o que está disponível.

**4. Suba de Nível**
À medida que ganha mais pontos, você desbloqueará níveis mais altos de membership com benefícios exclusivos.

## Checklist de Início

- Crie sua conta
- Complete seu perfil
- Faça seu primeiro check-in
- Navegue pelas recompensas disponíveis
- Compartilhe seu código de indicação com amigos

## Precisa de Ajuda?

Nosso assistente de IA está disponível 24/7 para responder suas perguntas. Basta tocar na aba Ajuda e começar a conversar!

Bom acúmulo de pontos!';

    ELSIF p_language = 'zh' THEN
        v_title := '欢迎加入我们的会员计划';
        v_excerpt := '了解如何通过我们的会员计划赚取奖励的一切信息。';
        v_content := '# 欢迎加入我们的会员计划！

我们很高兴您加入我们的会员计划。以下是您开始赚取奖励所需了解的一切。

## 运作方式

**1. 每次访问时签到**
每次光临时，使用我们的应用签到即可赚取积分。快速又简单！

**2. 赚取积分**
每次访问都能获得积分。此外，您还可以通过以下方式获得奖励积分：
- 保持访问连续性
- 达到里程碑
- 推荐朋友
- 特别促销活动

**3. 兑换奖励**
使用积分兑换精彩奖励 - 从小福利到高级体验。浏览奖励页面查看可用奖励。

**4. 升级**
随着积分增加，您将解锁更高会员等级和专属福利。

## 入门清单

- 创建账户
- 完善个人资料
- 完成首次签到
- 浏览可用奖励
- 与朋友分享您的推荐码

## 需要帮助？

我们的AI助手全天候为您服务。只需点击帮助页面开始对话！

祝您积分多多！';

    ELSIF p_language = 'ar' THEN
        v_title := 'مرحباً بك في برنامج الولاء';
        v_excerpt := 'كل ما تحتاج معرفته لبدء كسب المكافآت مع برنامج الولاء الخاص بنا.';
        v_content := '# مرحباً بك في برنامج الولاء!

نحن متحمسون لانضمامك إلى برنامج الولاء الخاص بنا. إليك كل ما تحتاج معرفته لبدء كسب المكافآت.

## كيف يعمل

**1. سجّل حضورك عند الزيارة**
في كل مرة تزورنا، سجّل حضورك باستخدام تطبيقنا لكسب النقاط. إنه سريع وسهل!

**2. اكسب النقاط**
ستكسب نقاطاً لكل زيارة. بالإضافة إلى ذلك، يمكنك كسب نقاط إضافية من خلال:
- الحفاظ على سلاسل الزيارات
- الوصول إلى الإنجازات
- إحالة الأصدقاء
- العروض الترويجية الخاصة

**3. استبدل المكافآت**
استخدم نقاطك للحصول على مكافآت رائعة - من المزايا الصغيرة إلى التجارب المميزة. تصفح تبويب المكافآت لرؤية المتاح.

**4. ارتقِ بمستواك**
كلما كسبت المزيد من النقاط، ستفتح مستويات عضوية أعلى مع مزايا حصرية.

## قائمة البدء

- أنشئ حسابك
- أكمل ملفك الشخصي
- قم بأول تسجيل حضور
- تصفح المكافآت المتاحة
- شارك رمز الإحالة مع الأصدقاء

## تحتاج مساعدة؟

مساعدنا الذكي متاح على مدار الساعة للإجابة على أسئلتك. فقط اضغط على تبويب المساعدة وابدأ المحادثة!

كسب سعيد!';

    ELSE
        RETURN seed_support_kb_articles(p_app_id, p_org_id, 'en');
    END IF;

    v_slug := 'welcome-to-loyalty-program';

    INSERT INTO knowledgebase_articles (
        app_id, organization_id, title, slug, content, excerpt,
        category, tags, is_published, is_featured, display_order
    ) VALUES (
        p_app_id, p_org_id, v_title, v_slug, v_content, v_excerpt,
        'getting_started',
        ARRAY['welcome', 'getting started', 'overview'],
        true, true, 1
    );

    SELECT COUNT(*) INTO v_count FROM knowledgebase_articles WHERE app_id = p_app_id;
    RETURN v_count;
END;
$$;

-- =====================================================
-- 3. FUNCTION: Seed All Default Support Content
-- Call: SELECT seed_all_support_content('app_id', 'org_id', 'en');
-- =====================================================

CREATE OR REPLACE FUNCTION seed_all_support_content(
    p_app_id UUID,
    p_org_id UUID,
    p_language TEXT DEFAULT 'en'
)
RETURNS TABLE(faqs_created INTEGER, articles_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_faqs INTEGER;
    v_articles INTEGER;
BEGIN
    SELECT seed_support_faqs(p_app_id, p_org_id, p_language) INTO v_faqs;
    SELECT seed_support_kb_articles(p_app_id, p_org_id, p_language) INTO v_articles;

    RETURN QUERY SELECT v_faqs, v_articles;
END;
$$;

-- =====================================================
-- 4. TRIGGER: Auto-seed content when support_settings created
-- Uses the customer_app's primary language setting
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_seed_support_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_language TEXT := 'en';
BEGIN
    -- Try to get the app's primary language from settings
    SELECT COALESCE(
        (SELECT settings->>'primary_language' FROM customer_apps WHERE id = NEW.app_id),
        'en'
    ) INTO v_language;

    -- Validate language is supported
    IF v_language NOT IN ('en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar') THEN
        v_language := 'en';
    END IF;

    -- Seed content in the app's language
    PERFORM seed_all_support_content(NEW.app_id, NEW.organization_id, v_language);
    RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS seed_support_content_on_settings ON support_settings;
CREATE TRIGGER seed_support_content_on_settings
    AFTER INSERT ON support_settings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_seed_support_content();

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================
--
-- Seed content in a specific language:
-- SELECT seed_all_support_content('app-id', 'org-id', 'es');  -- Spanish
-- SELECT seed_all_support_content('app-id', 'org-id', 'fr');  -- French
-- SELECT seed_all_support_content('app-id', 'org-id', 'de');  -- German
-- SELECT seed_all_support_content('app-id', 'org-id', 'it');  -- Italian
-- SELECT seed_all_support_content('app-id', 'org-id', 'pt');  -- Portuguese
-- SELECT seed_all_support_content('app-id', 'org-id', 'zh');  -- Chinese
-- SELECT seed_all_support_content('app-id', 'org-id', 'ar');  -- Arabic
--
-- The trigger will automatically seed content when support_settings
-- is created, using the app's primary_language setting.
-- =====================================================
