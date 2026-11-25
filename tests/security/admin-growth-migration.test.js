/**
 * 20261125000001_admin_growth_metrics.sql (plan can-we-enhance-our-breezy-flute, 2026-11-25).
 *
 * Behaviour is tested on PGlite against a seeded copy of the prod shape, with mutants:
 *   ~/Documents/Design Benches/royalty-growth-analytics-2026-11-25/pglite/run.mjs (69 checks)
 *   ~/Documents/Design Benches/royalty-growth-analytics-2026-11-25/pglite/mut.mjs (15/15 caught)
 * These pin the shape: every function locked to authenticated super admins, the internal filter,
 * no email or domain in a file that ships to the PUBLIC deploy repo.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/20261125000001_admin_growth_metrics.sql'), 'utf8')
// Comments stripped, so a rule can't be satisfied by a comment that mentions it.
const CODE = SQL.replace(/--[^\n]*/g, '')

function fnBody(name) {
  const start = CODE.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`))
  expect(start, `${name} is created`).toBeGreaterThan(-1)
  const end = CODE.indexOf('$$;', CODE.indexOf('AS $$', start))
  return CODE.slice(start, end)
}

const RPCS = [
  ['admin_set_org_internal', 'UUID, BOOLEAN'],
  ['admin_growth_metrics', 'INT, BOOLEAN'],
  ['admin_get_all_organizations', ''],
  ['update_org_activity', 'UUID'],
]
const ADMIN_FNS = ['admin_set_org_internal', 'admin_growth_metrics', 'admin_get_all_organizations']

describe('admin growth migration: lock-down', () => {
  it.each(RPCS)('%s is SECURITY DEFINER with search_path = public', (name) => {
    const body = fnBody(name)
    expect(body).toMatch(/SECURITY DEFINER/)
    expect(body).toMatch(/SET search_path = public/)
  })

  it.each(ADMIN_FNS)('%s checks profiles.is_admin for auth.uid() before anything else', (name) => {
    const body = fnBody(name)
    const check = body.indexOf('profiles.is_admin = true')
    expect(check).toBeGreaterThan(-1)
    expect(body.indexOf('profiles.id = auth.uid()')).toBeGreaterThan(-1)
    expect(body.indexOf("RAISE EXCEPTION 'Unauthorized: super admin required'")).toBeGreaterThan(check)
    // nothing is read or written before the check
    const firstWork = body.search(/\b(UPDATE organizations|WITH\s*\n|RETURN QUERY)/)
    expect(firstWork).toBeGreaterThan(check)
  })

  it.each(RPCS)('%s has the three-line grant footer (PUBLIC, anon, then authenticated)', (name, args) => {
    const sig = `public.${name}(${args})`
    expect(CODE).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`)
    expect(CODE).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`)
    expect(CODE).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`)
    expect(CODE).not.toMatch(new RegExp(`GRANT [^;]*${name.replace(/_/g, '_')}[^;]*TO (anon|PUBLIC)`))
  })

  it('update_org_activity only moves last_active_at for a real (not impersonating) member', () => {
    const body = fnBody('update_org_activity')
    expect(body).toMatch(/om\.user_id = auth\.uid\(\)/)
    expect(body).toMatch(/NOT COALESCE\(om\.is_impersonating, false\)/)
  })

  it('browser roles cannot set is_internal (guard trigger on insert and update)', () => {
    expect(CODE).toMatch(/CREATE TRIGGER organizations_guard_is_internal\s+BEFORE INSERT OR UPDATE OF is_internal ON public\.organizations/)
    expect(fnBody('organizations_guard_is_internal')).toMatch(/current_user IN \('anon', 'authenticated'\)/)
  })

  it('admin_get_all_organizations is DROPped before it is recreated (its return type changes)', () => {
    const drop = CODE.indexOf('DROP FUNCTION IF EXISTS public.admin_get_all_organizations();')
    const create = CODE.indexOf('CREATE FUNCTION public.admin_get_all_organizations()')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })
})

describe('admin growth migration: what it counts', () => {
  const growth = () => fnBody('admin_growth_metrics')

  it('leaves internal orgs out unless asked', () => {
    expect(growth()).toMatch(/WHERE v_inc OR NOT org\.is_internal/)
  })

  it('ignores deleted apps and members, cancelled redemptions and the org\'s own team', () => {
    const g = growth()
    expect(g).toMatch(/WHERE ca\.deleted_at IS NULL/)
    expect(g).toMatch(/WHERE m\.deleted_at IS NULL/)
    expect(g).toMatch(/<> 'cancelled'/)
    expect(g).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM team t/)
    expect(g).toMatch(/NOT COALESCE\(om\.is_impersonating, false\)/)
  })

  it('"has rewards" reads app_rewards, never is_published (every new app is auto-published)', () => {
    expect(growth()).not.toMatch(/is_published/)
    expect(growth()).toMatch(/FROM app_rewards x/)
  })

  it('paid = an active or trialing subscription', () => {
    expect(growth()).toMatch(/f\.plan_type = 'subscription' AND f\.subscription_status IN \('active', 'trialing'\)/)
  })

  it('the backfill runs once, when the column is first added', () => {
    expect(CODE).toMatch(/backfill skipped/)
    expect(CODE).toMatch(/RETURN;\s+END IF;\s+ALTER TABLE public\.organizations ADD COLUMN is_internal/)
  })
})

describe('admin growth migration: public repo hygiene', () => {
  it('writes no email address or domain', () => {
    expect(SQL).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i)
    expect(SQL).not.toMatch(/24hour|royaltyapp\.ai|gmail/i)
  })
})
