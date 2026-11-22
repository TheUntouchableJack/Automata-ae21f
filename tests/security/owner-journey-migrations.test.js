/**
 * Owner journey, items 5 and 6 plus the check-in trigger (plan cool-anything-here-wiggly-valiant, 2026-11-22).
 *
 *   20261122000004  trigger_automation_visit() assigned fields of an unassigned RECORD, so every
 *                   insert into member_visits failed (55000) and no check-in ever worked in prod.
 *   20261122000005  free plan = 250 customers (was 50 in the DB, 250 in the UI); member_redeem_reward
 *                   refuses points_cost < 1; the dashboard no longer seeds a 0-point reward.
 *
 * Behaviour is tested on PGlite against the REAL February trigger and member-limit functions:
 * ~/Documents/Design Benches/royalty-owner-journey-2026-11-22/pglite/run.mjs (42 checks; the bug
 * reproduced before the fix; 5 mutants caught). These pin the shape so a later edit can't quietly
 * undo it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const M4 = read('supabase/migrations/20261122000004_fix_visit_automation_trigger.sql')
const M5 = read('supabase/migrations/20261122000005_free_cap_250_no_free_rewards.sql')
const B1A = read('supabase/migrations/20261122000002_member_sessions_checkin.sql')
const DASH = read('app/dashboard.js')

const fnBody = (sql, name) => {
  const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION (public\\.)?${name}\\([\\s\\S]*?\\n\\$\\$[^\\n]*;\\n`))
  if (!m) throw new Error(`${name} not found`)
  return m[0]
}

describe('20261122000004: the visit trigger', () => {
  const fn = fnBody(M4, 'trigger_automation_visit')

  it('declares no RECORD and assigns no record field', () => {
    expect(fn).not.toMatch(/\bRECORD\b/)
    expect(fn).not.toMatch(/INTO[^;]*\bv_\w+\.\w+/)
    expect(fn).toMatch(/INTO v_org_id, v_tier, v_visit_count, v_streak/)
  })

  it('an error in the automation hook is a WARNING, never a lost visit', () => {
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/)
    expect(fn.indexOf('EXCEPTION WHEN OTHERS')).toBeGreaterThan(fn.indexOf('PERFORM net.http_post'))
    expect(fn.trim().endsWith('$$;')).toBe(true)
    expect(fn.trim()).toMatch(/END;\s+RETURN NEW;\s+END;\s+\$\$;$/)
  })

  it('keeps the same event body', () => {
    for (const k of ["'event_name', 'visit'", "'visit_count', COALESCE(v_visit_count, 0) + 1", "'points_awarded', NEW.points_awarded",
      "'streak_bonus', NEW.streak_bonus", "'milestone_bonus', NEW.milestone_bonus", '/functions/v1/automation-engine']) {
      expect(fn).toContain(k)
    }
  })

  it('replaces in place: no DROP, no new trigger', () => {
    expect(M4).not.toMatch(/DROP (FUNCTION|TRIGGER)/i)
    expect(M4).not.toMatch(/CREATE TRIGGER/i)
  })
})

describe('20261122000005: free cap and free rewards', () => {
  it('free (and unknown org) = 250; paid tiers unchanged', () => {
    const fn = fnBody(M5, 'get_org_member_limit')
    expect(fn.match(/RETURN 250;/g)).toHaveLength(2)
    expect(fn).not.toMatch(/RETURN 50;/)
    for (const n of ['RETURN 500;', 'RETURN 2000;', 'RETURN -1;']) expect(fn).toContain(n)
    expect(fn).toMatch(/plan_limits_override \? 'members'/)
  })

  it('member_redeem_reward refuses points_cost < 1, right after the reward lookup', () => {
    const fn = fnBody(M5, 'member_redeem_reward')
    const guard = fn.indexOf('IF coalesce(v_reward.points_cost, 0) < 1 THEN')
    expect(guard).toBeGreaterThan(fn.indexOf("'Reward not found or inactive'"))
    expect(guard).toBeLessThan(fn.indexOf('INSERT INTO reward_redemptions'))
  })

  it("member_redeem_reward is otherwise B1a's, line for line", () => {
    const now = fnBody(M5, 'member_redeem_reward').split('\n')
    const b1a = fnBody(B1A, 'member_redeem_reward').split('\n')
    const start = now.findIndex((l) => l.includes('A reward that costs nothing'))
    expect(start).toBeGreaterThan(0)
    // The guard is 6 lines: 2 comment lines, IF, RETURN QUERY, RETURN, END IF.
    expect(now.slice(start + 2, start + 6)).toEqual([
      '    IF coalesce(v_reward.points_cost, 0) < 1 THEN',
      "        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'This reward is not available yet.'::TEXT;",
      '        RETURN;',
      '    END IF;',
    ])
    expect([...now.slice(0, start), ...now.slice(start + 6)]).toEqual(b1a)
  })
})

describe('dashboard: no 0-point default reward', () => {
  it('seedDefaultRewards seeds nothing under 1 point', () => {
    const seed = DASH.match(/async function seedDefaultRewards\(appId\)[\s\S]*?\n}\n/)[0]
    const costs = [...seed.matchAll(/points_cost: (\d+)/g)].map((m) => Number(m[1]))
    expect(costs.length).toBeGreaterThan(0)
    expect(Math.min(...costs)).toBeGreaterThanOrEqual(1)
    expect(seed).not.toContain("name: 'Birthday Bonus'")
  })

  it('the rewards form refuses 0 points', () => {
    expect(read('app/rewards.html')).toContain('<input type="number" id="reward-points" required min="1"')
  })
})

describe('dashboard: customer cap warning', () => {
  // Run memberCapState from the real source.
  const src = DASH.match(/function memberCapState\(result\) \{[\s\S]*?\n}\n/)[0]
  // eslint-disable-next-line no-new-func
  const memberCapState = new Function(`${src}; return memberCapState;`)()

  it('warns from 80% of the cap and says full at the cap', () => {
    expect(memberCapState({ current: 199, limit: 250 })).toBeNull()
    expect(memberCapState({ current: 200, limit: 250 })).toEqual({ level: 'near', current: 200, limit: 250 })
    expect(memberCapState({ current: 249, limit: 250 }).level).toBe('near')
    expect(memberCapState({ current: 250, limit: 250 })).toEqual({ level: 'full', current: 250, limit: 250 })
    expect(memberCapState({ current: 400, limit: 250 }).level).toBe('full')
  })

  it('never warns on unlimited, on a broken answer or on nothing', () => {
    expect(memberCapState({ current: 9999, limit: -1 })).toBeNull()
    expect(memberCapState({ current: 1, limit: 0 })).toBeNull()
    expect(memberCapState({ allowed: true })).toBeNull()
    expect(memberCapState(null)).toBeNull()
  })

  it('reads the cap join_app enforces (check_member_limit), and is wired into the page', () => {
    expect(DASH).toContain("supabase.rpc('check_member_limit', { p_org_id: currentOrganization.id })")
    expect(DASH).toMatch(/await loadDashboardSummary\(\);\s+\/\/[^\n]*\n\s+loadMemberCapWarning\(\);/)
    const html = read('app/dashboard.html')
    for (const id of ['member-cap-warning', 'member-cap-warning-title', 'member-cap-warning-desc']) expect(html).toContain(`id="${id}"`)
    expect(html).toMatch(/id="member-cap-warning"[^>]*hidden/)
  })
})
