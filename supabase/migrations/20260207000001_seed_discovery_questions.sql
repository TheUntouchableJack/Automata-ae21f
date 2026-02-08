-- Migration: Seed Discovery Questions
-- 50+ questions across 10 domains for Royal AI to learn about businesses

-- ============================================================================
-- REVENUE DOMAIN (10 questions)
-- Understanding how the business makes money
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('revenue', 95, 'What''s your average transaction value?', 'Helps me calculate promotion ROI and suggest appropriate discount levels', 'avg_ticket', NULL),
('revenue', 90, 'What''s your approximate monthly revenue?', 'Lets me benchmark your performance and suggest realistic growth targets', NULL, NULL),
('revenue', 85, 'What are your best-selling products or services?', 'Helps me identify what to feature in promotions and loyalty rewards', NULL, NULL),
('revenue', 80, 'What percentage of revenue comes from repeat customers vs new customers?', 'Helps me balance retention vs acquisition strategies', NULL, NULL),
('revenue', 75, 'Do you have any revenue from subscriptions, memberships, or recurring purchases?', 'Understanding your revenue model helps me suggest the right loyalty structure', 'revenue_model', NULL),
('revenue', 70, 'What''s your busiest day of the week for sales?', 'Helps me time promotions for maximum impact', NULL, NULL),
('revenue', 65, 'Which months are your strongest and weakest for revenue?', 'Lets me plan seasonal strategies and prepare for slow periods', NULL, NULL),
('revenue', 60, 'What''s your revenue goal for the next quarter?', 'Gives me a target to help you work towards', NULL, NULL),
('revenue', 55, 'Have you raised prices in the last year? How did customers respond?', 'Helps me understand your pricing power and customer price sensitivity', 'price_positioning', NULL),
('revenue', 50, 'Do you offer gift cards or store credit? How popular are they?', 'Gift cards can be powerful loyalty tools - I can suggest strategies', NULL, NULL);

-- ============================================================================
-- COSTS DOMAIN (8 questions)
-- Understanding cost structure and margins
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('costs', 92, 'What''s your product or food cost as a percentage of sales?', 'Ensures any discounts I suggest still keep you profitable', 'food_cost_pct', ARRAY['restaurant']),
('costs', 92, 'What''s your cost of goods sold as a percentage of sales?', 'Ensures any discounts I suggest still keep you profitable', 'gross_margin_pct', ARRAY['retail', 'service']),
('costs', 88, 'What percentage of revenue goes to labor/payroll?', 'Helps me understand your margin structure and break-even point', 'labor_cost_pct', NULL),
('costs', 82, 'What''s your rent as a percentage of revenue?', 'Location costs affect how aggressive we can be with promotions', 'rent_pct', NULL),
('costs', 78, 'What does it cost you to acquire a new customer (marketing, discounts, etc.)?', 'Helps me calculate the ROI of retention vs acquisition efforts', NULL, NULL),
('costs', 72, 'What''s your biggest unexpected expense in a typical month?', 'Helps me understand cash flow pressures and timing of promotions', NULL, NULL),
('costs', 68, 'Do you have any major equipment or expenses coming up?', 'Lets me factor in timing for when to push vs conserve', NULL, NULL),
('costs', 62, 'What''s your approximate break-even point (daily or monthly)?', 'Critical for understanding how much cushion you have', 'break_even_daily', NULL);

-- ============================================================================
-- CUSTOMERS DOMAIN (8 questions)
-- Understanding who buys and why
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('customers', 93, 'Describe your ideal customer - who loves what you do most?', 'Helps me target messaging and rewards to attract more of your best customers', 'ideal_customer_description', NULL),
('customers', 88, 'What age range are most of your customers?', 'Different ages respond to different messaging and channels', 'primary_age_range', NULL),
('customers', 83, 'What brings customers back for repeat visits?', 'Understanding this helps me reinforce your natural strengths', NULL, NULL),
('customers', 78, 'Why do customers choose you over competitors?', 'Your competitive edge should be central to our loyalty messaging', 'competitive_advantage', NULL),
('customers', 73, 'What''s the most common complaint or frustration from customers?', 'Addressing pain points can dramatically improve retention', NULL, NULL),
('customers', 68, 'How often does your typical customer visit?', 'Helps me set appropriate visit frequency goals', 'customer_frequency', NULL),
('customers', 63, 'Do you have any VIP or whale customers? What makes them special?', 'Understanding your best customers helps me find more like them', NULL, NULL),
('customers', 58, 'Have you noticed any customers you''ve lost recently? Any idea why?', 'Churn patterns help me build better win-back strategies', NULL, NULL);

-- ============================================================================
-- COMPETITION DOMAIN (6 questions)
-- Understanding the competitive landscape
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('competition', 91, 'Who are your top 3 competitors? What do they do well?', 'I can research them and help you differentiate', 'primary_competitors', NULL),
('competition', 84, 'Do any competitors have loyalty programs? What do they offer?', 'Helps me suggest how to make yours stand out', NULL, NULL),
('competition', 77, 'What do you do better than anyone else nearby?', 'Your unique strengths should be at the heart of your loyalty program', 'unique_selling_points', NULL),
('competition', 70, 'Have you lost any customers to competitors? What attracted them away?', 'Understanding competitive threats helps me build defenses', NULL, NULL),
('competition', 63, 'Is there anything competitors do that you wish you could do?', 'Sometimes loyalty programs can bridge capability gaps', NULL, NULL),
('competition', 56, 'How do your prices compare to competitors?', 'Price positioning affects how we structure rewards and promotions', 'price_positioning', NULL);

-- ============================================================================
-- OPERATIONS DOMAIN (6 questions)
-- Understanding day-to-day business operations
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('operations', 89, 'What are your busiest and slowest hours?', 'Helps me time promotions to either boost slow times or maximize busy ones', 'peak_hours', NULL),
('operations', 82, 'What are your slowest days or times that you''d like to fill?', 'These are perfect targets for loyalty promotions', 'slow_periods', NULL),
('operations', 75, 'How many staff do you typically have working?', 'Affects what kind of promotions are operationally feasible', 'staff_count', NULL),
('operations', 68, 'What''s the biggest operational headache in your day-to-day?', 'Sometimes loyalty programs can help smooth operational issues', NULL, NULL),
('operations', 61, 'Do you have capacity to handle more customers, or are you near max?', 'Important for knowing whether to focus on volume vs value', NULL, NULL),
('operations', 54, 'How many hours a week do you personally work in the business?', 'Helps me understand your bandwidth for reviewing AI suggestions', 'owner_hours_weekly', NULL);

-- ============================================================================
-- GROWTH DOMAIN (6 questions)
-- Understanding growth goals and opportunities
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('growth', 94, 'Where do you want your business to be in 12 months?', 'Aligns all my suggestions with your actual goals', 'growth_goals', NULL),
('growth', 87, 'What would success look like for you by the end of this year?', 'Gives me a clear target to help you work towards', 'success_vision', NULL),
('growth', 80, 'What''s the biggest obstacle to your growth right now?', 'I''ll focus suggestions on removing your specific blockers', 'biggest_challenge', NULL),
('growth', 73, 'Are you interested in expanding - new location, franchise, online?', 'Helps me think long-term in my suggestions', 'expansion_interest', NULL),
('growth', 66, 'What stage would you say your business is at? Startup, growing, established?', 'Different stages need different strategies', 'current_stage', NULL),
('growth', 59, 'Is there a revenue or customer number that would feel like a major milestone?', 'I love helping celebrate milestones - let''s set some targets', NULL, NULL);

-- ============================================================================
-- MARKETING DOMAIN (6 questions)
-- Understanding current marketing efforts
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('marketing', 86, 'Where do most of your new customers come from?', 'Helps me understand which channels to reinforce', NULL, NULL),
('marketing', 79, 'What marketing have you tried that worked really well?', 'I''ll build on what''s already working for you', NULL, NULL),
('marketing', 72, 'What marketing have you tried that didn''t work?', 'I''ll avoid wasting your time on approaches that don''t fit', NULL, NULL),
('marketing', 65, 'Do you use social media? Which platforms?', 'Affects how we can promote your loyalty program', NULL, NULL),
('marketing', 58, 'Do you collect customer email addresses or phone numbers?', 'Direct communication is powerful for loyalty - let''s maximize it', NULL, NULL),
('marketing', 51, 'Have you ever run a promotion or special offer? How did it go?', 'Past promotion performance helps me suggest what might work', NULL, NULL);

-- ============================================================================
-- TEAM DOMAIN (5 questions)
-- Understanding the team dynamics
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('team', 81, 'Do you have key employees that would be hard to replace?', 'Staff retention affects customer relationships - I should know key players', NULL, NULL),
('team', 74, 'What''s your biggest staffing challenge?', 'Happy staff = happy customers. I can help with employee-facing features', NULL, NULL),
('team', 67, 'Does your team help promote your loyalty program to customers?', 'Staff buy-in is crucial for program success', NULL, NULL),
('team', 60, 'Is there anything you wish you could delegate but can''t?', 'Maybe my autonomous features can take something off your plate', NULL, NULL),
('team', 53, 'Do you have a manager or key person who handles marketing?', 'Knowing who to tailor communications for helps me be more useful', NULL, NULL);

-- ============================================================================
-- FINANCES DOMAIN (5 questions)
-- Understanding cash flow and financial health
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('finances', 83, 'How would you describe your cash flow situation?', 'Affects timing and aggression of promotions I suggest', NULL, NULL),
('finances', 76, 'Are there times of year when cash is tight?', 'I''ll avoid suggesting expensive initiatives during tough times', NULL, NULL),
('finances', 69, 'Do you have a budget set aside for marketing and promotions?', 'Helps me suggest ideas that fit your budget constraints', NULL, NULL),
('finances', 62, 'What''s your approach to discounting - do it often, rarely, or never?', 'Matching your philosophy ensures my suggestions feel right', NULL, NULL),
('finances', 55, 'Are there any major financial milestones coming up? Loan payoff, equipment purchase?', 'Context about big picture helps me prioritize suggestions', NULL, NULL);

-- ============================================================================
-- PERSONAL DOMAIN (6 questions)
-- Understanding the owner as a person
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('personal', 96, 'What keeps you up at night about the business?', 'Your biggest worry should be my biggest focus', NULL, NULL),
('personal', 85, 'Why did you start this business?', 'Understanding your motivation helps me give advice that fits your values', NULL, NULL),
('personal', 78, 'What would you do with more free time if the business ran itself?', 'Knowing your personal goals helps me prioritize automation', NULL, NULL),
('personal', 71, 'Is there anything about the business you''d like to enjoy more?', 'Work should be fulfilling - let me help make it better', NULL, NULL),
('personal', 64, 'How do you prefer to learn about new business ideas - reading, videos, trying things?', 'Helps me share information in ways that work for you', NULL, NULL),
('personal', 57, 'What''s a business decision you''re proud of?', 'Your wins tell me what kind of risks pay off for you', NULL, NULL);

-- ============================================================================
-- LOCATION DOMAIN (5 questions)
-- Understanding the physical location
-- ============================================================================
INSERT INTO discovery_questions (domain, priority, question, why_asking, maps_to_field, business_types) VALUES
('operations', 84, 'What kind of area is your business in - downtown, suburban, mall?', 'Location type affects foot traffic patterns and customer behavior', 'location_type', NULL),
('operations', 77, 'How would you describe foot traffic near your location?', 'Helps me understand walk-in vs destination dynamics', 'foot_traffic_level', NULL),
('operations', 70, 'What''s parking like for your customers?', 'Parking affects visit frequency and customer convenience', 'parking_situation', NULL),
('operations', 63, 'Are there any big businesses or anchors nearby that bring traffic?', 'Nearby anchors can be leveraged for cross-promotion', 'nearby_anchors', NULL),
('operations', 56, 'Is your location a strength or something you work around?', 'Location constraints affect what strategies will work', NULL, NULL);

-- Update the minimum profile completeness for advanced questions
UPDATE discovery_questions
SET min_profile_completeness = 30
WHERE priority < 60;

UPDATE discovery_questions
SET min_profile_completeness = 50
WHERE priority < 50;
