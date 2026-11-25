/**
 * Super Admin → Edit Plan modal (2026-11-25, after the Growth tab round).
 *
 * Before: the tiers were Pro / Max only, and every save stored all seven feature toggles as
 * overrides, set to the OLD plan's defaults, so moving an org Free → Growth pinned Free's features
 * (no autonomous mode, learning, fatigue protection or metrics). "Clear Overrides" switched every feature off, and admin_update_organization_plan
 * read an empty override as "keep", so overrides could never be cleared.
 *
 * Runs the REAL app/plan-limits.js and app/admin.js against the REAL modal markup of app/admin.html.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const HTML = read('app/admin.html')
const MODAL = HTML.slice(HTML.indexOf('<!-- Plan Override Modal -->'), HTML.indexOf('<!-- Impersonation Banner'))

const FREE = { id: 'org-free', name: 'Free Org', plan_type: 'free', subscription_tier: null, plan_limits_override: null }
const PINNED = { id: 'org-pinned', name: 'Pinned', plan_type: 'free', subscription_tier: null, plan_limits_override: { members: 500, autonomous_mode: true } }
const GROWTH = { id: 'org-growth', name: 'Growth Org', plan_type: 'subscription', subscription_tier: 'growth', plan_limits_override: null }

const $ = (id) => document.getElementById(id)
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const quick = (plan) => click(document.querySelector(`.plan-quickset-btn[data-plan="${plan}"]`))
const lastPlanCall = () => supabase.rpc.mock.calls.filter((c) => c[0] === 'admin_update_organization_plan').pop()

beforeAll(() => {
  window.AppUtils = { escapeHtml: (s) => String(s) }
  window.showToast = vi.fn()
  window.eval(read('app/plan-limits.js'))
  // One eval for admin.js and its test hooks: a script's top-level let/const stay private to the
  // eval that ran it, so the hooks must live in the same one.
  window.eval(read('app/admin.js') + `
    window.__admin = {
      setOrgs: (list) => { allOrganizations = list; },
      save: () => savePlanOverride(),
      build: buildPlanOverrides,
      bindModal: () => {
        document.querySelectorAll('.plan-quickset-btn').forEach(btn => btn.addEventListener('click', () => {
          const plan = btn.dataset.plan;
          document.getElementById('override-plan-type').value = plan === 'free' ? 'free' : 'subscription';
          document.getElementById('override-sub-tier').value = plan === 'free' ? '' : plan;
          onModalPlanChange();
        }));
        document.getElementById('override-plan-type').addEventListener('change', onModalPlanChange);
        document.getElementById('override-sub-tier').addEventListener('change', onModalPlanChange);
        document.getElementById('plan-clear-override').addEventListener('click', clearPlanOverrides);
      }
    };
    loadOrganizations = async () => {};
  `)
})

beforeEach(() => {
  document.body.innerHTML = MODAL + '<div id="orgs-container"></div><div id="orgs-empty-state"></div>'
  supabase.rpc.mockReset()
  supabase.rpc.mockResolvedValue({ data: [], error: null })
  window.showToast.mockClear()
  window.__admin.setOrgs(JSON.parse(JSON.stringify([FREE, PINNED, GROWTH])))
  // The modal's own handlers (as setupEventListeners() binds them, without the rest of the page).
  window.__admin.bindModal()
})

describe('Edit Plan modal: tiers', () => {
  it('offers Free / Starter / Growth / Scale, with Pro and Max only as legacy tiers', () => {
    expect([...document.querySelectorAll('.plan-quickset-btn')].map((b) => b.dataset.plan)).toEqual(['free', 'starter', 'growth', 'scale'])
    const tiers = [...$('override-sub-tier').options].map((o) => o.value)
    expect(tiers).toEqual(['', 'starter', 'growth', 'scale', 'pro', 'max'])
    expect($('override-sub-tier').querySelector('optgroup[label="Legacy"]').children).toHaveLength(2)
  })

  it('the quick-set button for the org\'s current plan is highlighted', () => {
    window.openPlanOverride(GROWTH.id)
    expect(document.querySelector('.plan-quickset-btn.active').dataset.plan).toBe('growth')
  })
})

describe('Edit Plan modal: what gets saved', () => {
  it('Free → Growth saves no overrides: Growth\'s own features apply (they used to be pinned to Free\'s)', async () => {
    window.openPlanOverride(FREE.id)
    expect($('override-autonomous').checked).toBe(false) // Free has no autonomous mode
    quick('growth')
    expect($('override-autonomous').checked).toBe(true) // the toggles follow the new plan
    expect($('override-attribution').checked).toBe(false) // Growth has no visit attribution
    await window.__admin.save()
    const [, args] = lastPlanCall()
    expect(args).toEqual({ p_org_id: FREE.id, p_plan_type: 'subscription', p_subscription_tier: 'growth', p_plan_limits_override: {} })
  })

  it('a toggle that differs from the plan is the only override saved', async () => {
    window.openPlanOverride(GROWTH.id)
    $('override-royal-chat').checked = false
    await window.__admin.save()
    expect(lastPlanCall()[1].p_plan_limits_override).toEqual({ royal_chat: false })
  })

  it('numbers typed in are saved; empty ones are not', async () => {
    window.openPlanOverride(GROWTH.id)
    $('override-sms').value = '250'
    await window.__admin.save()
    expect(lastPlanCall()[1].p_plan_limits_override).toEqual({ sms_monthly: 250 })
  })

  it('opening shows the stored overrides; Clear Overrides goes back to the plan exactly and saves {}', async () => {
    window.openPlanOverride(PINNED.id)
    expect($('override-members').value).toBe('500')
    expect($('override-autonomous').checked).toBe(true)
    click($('plan-clear-override'))
    expect($('override-members').value).toBe('')
    expect($('override-autonomous').checked).toBe(false) // Free's own value
    expect($('override-royal-chat').checked).toBe(true) // and not "everything off"
    await window.__admin.save()
    expect(lastPlanCall()[1].p_plan_limits_override).toEqual({})
  })

  it('Free sends no tier', async () => {
    window.openPlanOverride(GROWTH.id)
    quick('free')
    await window.__admin.save()
    expect(lastPlanCall()[1]).toMatchObject({ p_plan_type: 'free', p_subscription_tier: null })
  })

  it('a subscription with no tier is not saved', async () => {
    window.openPlanOverride(FREE.id)
    $('override-plan-type').value = 'subscription'
    $('override-plan-type').dispatchEvent(new Event('change'))
    await window.__admin.save()
    expect(lastPlanCall()).toBeUndefined()
    expect(window.showToast).toHaveBeenCalledWith('Pick a tier for a subscription', 'error')
  })
})

describe('buildPlanOverrides', () => {
  it('keeps differences only', () => {
    const build = window.__admin.build
    expect(build({ royal_chat: true, white_label: false }, { members: '', sms_monthly: '0' }, { royal_chat: true, white_label: true }))
      .toEqual({ sms_monthly: 0, white_label: true })
    expect(build({}, { members: 'abc' }, {})).toEqual({})
  })
})

describe('admin_update_organization_plan / the billing guard migration', () => {
  const SQL = read('supabase/migrations/20261125000002_billing_guard_admin_plan_impersonation.sql').replace(/--[^\n]*/g, '')

  it('{} clears the overrides, NULL keeps them, and only a subscription keeps a tier', () => {
    expect(SQL).toMatch(/WHEN p_plan_limits_override IS NULL THEN o\.plan_limits_override\s+WHEN p_plan_limits_override = '\{\}'::jsonb THEN NULL/)
    expect(SQL).toMatch(/WHEN COALESCE\(p_plan_type, o\.plan_type\) = 'subscription'\s+THEN COALESCE\(p_subscription_tier, o\.subscription_tier\)\s+ELSE NULL/)
    expect(SQL).toMatch(/NOT IN \('starter', 'growth', 'scale', 'pro', 'max'\)/)
  })

  it('billing columns are guarded against browser roles on insert and update', () => {
    expect(SQL).toMatch(/CREATE TRIGGER organizations_guard_billing\s+BEFORE INSERT OR UPDATE ON public\.organizations/)
    expect(SQL).toMatch(/IF current_user NOT IN \('anon', 'authenticated'\) THEN\s+RETURN NEW;/)
    for (const col of ['plan_type', 'subscription_tier', 'subscription_status', 'stripe_customer_id', 'plan_limits_override', 'has_royalty_pro', 'is_lifetime', 'appsumo_tier']) {
      expect(SQL).toContain(`'${col}'`)
    }
    // The browser's legitimate writes are NOT in the guarded list.
    const guarded = SQL.slice(SQL.indexOf('c_cols CONSTANT TEXT[] := ARRAY['), SQL.indexOf('];', SQL.indexOf('c_cols CONSTANT')))
    expect(guarded).toContain("'plan_type'")
    for (const col of ['name', 'settings', 'ai_auto_execute_enabled', 'ai_daily_action_limit', 'monthly_revenue', 'last_active_at']) {
      expect(guarded).not.toContain(`'${col}'`)
    }
  })

  it('credit and usage writers become service_role only, every overload', () => {
    expect(SQL).toMatch(/p\.proname IN \('add_messaging_credits', 'increment_email_usage', 'increment_sms_usage'\)/)
    for (const role of ['PUBLIC', 'anon', 'authenticated']) expect(SQL).toContain(`REVOKE ALL ON FUNCTION %s FROM ${role}`)
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION %s TO service_role')
  })

  it('"view as" leaves an existing membership alone', () => {
    expect(SQL).toMatch(/ON CONFLICT \(organization_id, user_id\) DO NOTHING;/)
    expect(SQL).not.toMatch(/DO UPDATE SET is_impersonating/)
  })

  it('recreated admin RPCs: definer, search_path, admin check, three-line footer', () => {
    for (const [fn, args] of [['admin_update_organization_plan', 'UUID, TEXT, TEXT, JSONB'], ['admin_start_impersonation', 'UUID']]) {
      const body = SQL.slice(SQL.indexOf(`FUNCTION public.${fn}(`), SQL.indexOf('$$;', SQL.indexOf(`FUNCTION public.${fn}(`)))
      expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/)
      expect(body).toMatch(/profiles\.is_admin = true/)
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn}(${args}) FROM PUBLIC;`)
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn}(${args}) FROM anon;`)
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(${args}) TO authenticated;`)
    }
  })

  it('writes no email address or domain (the deploy repo is public)', () => {
    const raw = read('supabase/migrations/20261125000002_billing_guard_admin_plan_impersonation.sql')
    expect(raw).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i)
  })
})
