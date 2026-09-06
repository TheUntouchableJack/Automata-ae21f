/**
 * Tests for executeAwardPoints in automation-engine/index.ts.
 *
 * total_points_earned is a LIFETIME counter. It used to be written as
 * `points_balance + points`, which silently rewrites it downward for anyone
 * who has ever redeemed -- and lifetime total drives tier calculation. The
 * first award after a redemption is the only observable symptom, so that is
 * what these tests pin.
 *
 * These tests read the real source file rather than reproducing the function,
 * because a local copy would keep passing if the shipped code regressed. The
 * update payload is extracted and evaluated, so the assertions run against the
 * expressions that actually deploy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(here, '../../supabase/functions/automation-engine/index.ts');
const source = readFileSync(SOURCE_PATH, 'utf8');

/**
 * Pull the object literal out of the `.update({ ... })` call inside
 * executeAwardPoints and turn it into a function of (member, points).
 */
function extractAwardPointsUpdate() {
  const fnStart = source.indexOf('async function executeAwardPoints(');
  if (fnStart === -1) throw new Error('executeAwardPoints not found in ' + SOURCE_PATH);
  const fnEnd = source.indexOf('\nasync function ', fnStart + 1);
  const body = source.slice(fnStart, fnEnd === -1 ? source.length : fnEnd);

  const updateAt = body.indexOf('.update({');
  if (updateAt === -1) throw new Error('no .update({ ... }) call inside executeAwardPoints');
  const objStart = body.indexOf('{', updateAt);
  let depth = 0;
  let objEnd = -1;
  for (let i = objStart; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) { objEnd = i; break; }
    }
  }
  if (objEnd === -1) throw new Error('unbalanced update payload in executeAwardPoints');
  const literal = body.slice(objStart, objEnd + 1);

  // Guard against a vacuous pass: if the slice lost either key, every
  // assertion below would read `undefined` and quietly agree with itself.
  if (!literal.includes('points_balance')) throw new Error('extracted payload has no points_balance: ' + literal);
  if (!literal.includes('total_points_earned')) throw new Error('extracted payload has no total_points_earned: ' + literal);

  // eslint-disable-next-line no-new-func
  return { literal, apply: new Function('member', 'points', `return (${literal});`) };
}

const { literal, apply } = extractAwardPointsUpdate();

describe('automation-engine — executeAwardPoints payload', () => {
  it('declares total_points_earned on the Member interface', () => {
    // Without this the fix does not type-check: member.total_points_earned
    // becomes TS2339 and deno check gains an error.
    const iface = source.slice(source.indexOf('interface Member {'), source.indexOf('}', source.indexOf('interface Member {')));
    expect(iface).toContain('interface Member');
    expect(iface).toMatch(/total_points_earned\s*:\s*number/);
  });

  it('derives lifetime total from itself, never from the balance', () => {
    expect(literal).toMatch(/total_points_earned:\s*\(member\.total_points_earned/);
    expect(literal).not.toMatch(/total_points_earned:\s*\(?member\.points_balance/);
  });

  it('increments both counters by exactly the award', () => {
    const member = { points_balance: 250, total_points_earned: 400 };
    const next = apply(member, 50);
    expect(next.points_balance).toBe(300);
    expect(next.total_points_earned).toBe(450);
  });

  it('keeps lifetime total monotonic across award -> redeem -> award', () => {
    // The whole test. The first award passes even with the bug; only the award
    // that follows a redemption tells the two implementations apart.
    let member = { points_balance: 0, total_points_earned: 0 };

    member = { ...member, ...apply(member, 100) };
    expect(member).toEqual({ points_balance: 100, total_points_earned: 100 });

    // Redeem 80 -- balance drops, lifetime total must not.
    member = { ...member, points_balance: member.points_balance - 80 };
    expect(member.points_balance).toBe(20);
    expect(member.total_points_earned).toBe(100);

    const before = member.total_points_earned;
    member = { ...member, ...apply(member, 30) };

    expect(member.total_points_earned).toBe(130); // old code wrote 20 + 30 = 50
    expect(member.total_points_earned).toBeGreaterThan(before);
    expect(member.total_points_earned).toBeGreaterThanOrEqual(member.points_balance);
  });

  it('treats a null lifetime total as zero rather than NaN', () => {
    // Rows predating the column backfill can carry NULL.
    const next = apply({ points_balance: 10, total_points_earned: null }, 25);
    expect(next.total_points_earned).toBe(25);
    expect(Number.isNaN(next.total_points_earned)).toBe(false);
  });
});
