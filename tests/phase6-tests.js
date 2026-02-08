#!/usr/bin/env node
/**
 * Phase 6 Verification Tests
 * Tests for Royal AI User Education Features
 */

const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

// Test results tracking
const results = { passed: 0, failed: 0, tests: [] };

function log(message, type = 'info') {
  const prefix = type === 'pass' ? '✓' : type === 'fail' ? '✗' : '→';
  console.log(`${prefix} ${message}`);
}

function test(name, passed, details = '') {
  results.tests.push({ name, passed, details });
  if (passed) {
    results.passed++;
    log(`${name}`, 'pass');
  } else {
    results.failed++;
    log(`${name}: ${details}`, 'fail');
  }
}

// ============================================================================
// Test 1: Global FAQ Table Exists
// ============================================================================
async function testGlobalFaqTable() {
  log('\n=== Testing Global FAQ Table ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/global_faq?select=id,question,category&limit=10`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  test('global_faq table accessible', response.status === 200,
       response.status !== 200 ? `Status: ${response.status}` : '');

  if (response.status === 200) {
    const data = await response.json();
    test('FAQ entries seeded', Array.isArray(data) && data.length >= 8,
         `Found ${data?.length || 0} entries`);

    // Check for Royal AI category
    const royalAiFaqs = data.filter(f => f.category === 'royal-ai');
    test('Royal AI FAQ entries present', royalAiFaqs.length >= 8,
         `Found ${royalAiFaqs.length} Royal AI FAQs`);
  }
}

// ============================================================================
// Test 2: Global KB Table Exists
// ============================================================================
async function testGlobalKbTable() {
  log('\n=== Testing Global Knowledge Base ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/global_kb?select=id,title,slug,category&limit=10`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  test('global_kb table accessible', response.status === 200,
       response.status !== 200 ? `Status: ${response.status}` : '');

  if (response.status === 200) {
    const data = await response.json();
    test('KB articles seeded', Array.isArray(data) && data.length >= 6,
         `Found ${data?.length || 0} articles`);

    // Check for expected slugs
    const expectedSlugs = [
      'getting-started-royal-ai',
      'teaching-royal-ai',
      'understanding-confidence-scores',
      'auto-pilot-mode',
      'royal-ai-research',
      'reviewing-ai-actions'
    ];

    const slugsFound = data.map(a => a.slug);
    for (const slug of expectedSlugs) {
      test(`KB article: ${slug}`, slugsFound.includes(slug),
           !slugsFound.includes(slug) ? 'Not found' : '');
    }
  }
}

// ============================================================================
// Test 3: Coaching Triggers Table Exists
// ============================================================================
async function testCoachingTriggersTable() {
  log('\n=== Testing Coaching Triggers ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/coaching_triggers?select=id,trigger_event,title&limit=20`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  test('coaching_triggers table accessible', response.status === 200,
       response.status !== 200 ? `Status: ${response.status}` : '');

  if (response.status === 200) {
    const data = await response.json();
    test('Coaching triggers seeded', Array.isArray(data) && data.length >= 8,
         `Found ${data?.length || 0} triggers`);

    // Check for expected triggers
    const expectedTriggers = [
      'first_intelligence_visit',
      'discovery_questions_5',
      'first_action_queued',
      'auto_pilot_enabled',
      'first_auto_action',
      'outcome_measured'
    ];

    const triggersFound = data.map(t => t.trigger_event);
    for (const trigger of expectedTriggers) {
      test(`Coaching trigger: ${trigger}`, triggersFound.includes(trigger),
           !triggersFound.includes(trigger) ? 'Not found' : '');
    }
  }
}

// ============================================================================
// Test 4: User Coaching Progress Table
// ============================================================================
async function testUserCoachingProgressTable() {
  log('\n=== Testing User Coaching Progress ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/user_coaching_progress?select=user_id,trigger_event&limit=1`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  test('user_coaching_progress table accessible', response.status === 200,
       response.status !== 200 ? `Status: ${response.status}` : '');
}

// ============================================================================
// Test 5: FAQ Content Quality
// ============================================================================
async function testFaqContentQuality() {
  log('\n=== Testing FAQ Content Quality ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/global_faq?select=question,answer,category`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (response.status === 200) {
    const data = await response.json();

    // Check content quality
    for (const faq of data.slice(0, 5)) {
      const hasMarkdown = faq.answer.includes('**') || faq.answer.includes('•') || faq.answer.includes('#');
      test(`FAQ "${faq.question.slice(0, 30)}..." has formatted content`, hasMarkdown || faq.answer.length > 100, '');
    }

    // Check for action-related FAQ
    const actionFaq = data.find(f => f.question.toLowerCase().includes('action'));
    test('FAQ covers AI actions', !!actionFaq, 'Should explain how to review/approve actions');
  }
}

// ============================================================================
// Test 6: KB Article Content Quality
// ============================================================================
async function testKbContentQuality() {
  log('\n=== Testing KB Article Content Quality ===');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/global_kb?select=title,content,slug`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (response.status === 200) {
    const data = await response.json();

    for (const article of data) {
      // Check for proper headings
      const hasHeadings = article.content.includes('# ') || article.content.includes('## ');
      test(`KB "${article.title}" has headings`, hasHeadings, '');

      // Check for sufficient content
      const wordCount = article.content.split(/\s+/).length;
      test(`KB "${article.title}" has substantial content (${wordCount} words)`, wordCount >= 100, '');
    }
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          PHASE 6 VERIFICATION TESTS                       ║');
  console.log('║          Royal AI User Education                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Run all tests
  await testGlobalFaqTable();
  await testGlobalKbTable();
  await testCoachingTriggersTable();
  await testUserCoachingProgressTable();
  await testFaqContentQuality();
  await testKbContentQuality();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(60));

  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`  ✗ ${t.name}: ${t.details}`);
    });
  }

  console.log('\n📋 Phase 6 Implementation Summary:');
  console.log('   • 8 FAQ entries for Royal AI features');
  console.log('   • 6 Knowledge Base articles (guides)');
  console.log('   • 8 Coaching triggers for contextual help');
  console.log('   • User progress tracking for show-once coaching');
  console.log('   • Content formatted with markdown');

  return results.failed === 0;
}

// Run
runTests().then(success => {
  process.exit(success ? 0 : 1);
});
