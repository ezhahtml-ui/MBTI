'use strict';
// run: node --test engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const E = require('./adaptive-engine.js');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'question-bank.v1-draft.json'), 'utf8'));

const DRAFT = { includeDraft: true };
const REP3 = { includeDraft: true, maxContentRepeat: 3 };

// pick the level that gives directed evidence of the requested sign for the item just served
function levelFor(P, item, wantPositive, cfg) {
  const dir = P.contents[item.content_id].scoring_direction;
  const e = E.DEFAULTS.evidence;
  const strong = wantPositive ? (dir > 0 ? 100 : 20) : (dir > 0 ? 20 : 100);
  const weak = wantPositive ? (dir > 0 ? 75 : 50) : (dir > 0 ? 50 : 75);
  return { strong, weak };
}
function run(P, cfg, seed, chooser, limit = 1000) {
  let st = E.newSession(P, seed, cfg), seq = [];
  for (let i = 0; i < limit; i++) {
    const nx = E.nextItem(P, st, cfg);
    if (nx.done) return { st, seq, stop: nx };
    const lvl = chooser(nx, P, seq.length);
    st = E.submitAnswer(P, st, nx.item.item_id, lvl, cfg);
    seq.push(nx);
  }
  throw new Error('did not terminate');
}
const allStrongFirst = (nx, P) => levelFor(P, nx.item, true).strong;

test('bank text rebuild matches text_hash for all 3000 items', () => {
  const P = E.prepareBank(bank, DRAFT);
  let bad = 0;
  for (const it of bank.items) {
    const h = crypto.createHash('sha256').update(E.itemText(P, it)).digest('hex').slice(0, 16);
    if (h !== it.text_hash) bad++;
  }
  assert.equal(bad, 0);
});

test('production mode: draft/pending bank has ZERO eligible items -> engine refuses to serve', () => {
  const P = E.prepareBank(bank, {});
  assert.equal(E.capacity(P, {}), 0);
  const st = E.newSession(P, 'x', {});
  const nx = E.nextItem(P, st, {});
  assert.equal(nx.done, true);
  assert.equal(nx.stop_reason, 'no_eligible_items');
});

test('capacity is honest: 40 with maxContentRepeat=1, 120 with 3', () => {
  assert.equal(E.capacity(E.prepareBank(bank, DRAFT), DRAFT), 40);
  assert.equal(E.capacity(E.prepareBank(bank, REP3), REP3), 120);
});

test('Phi sanity', () => {
  const { Phi } = E._internal;
  assert.ok(Math.abs(Phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(Phi(1.645) - 0.95) < 1e-3);
  assert.ok(Math.abs(Phi(-1.96) - 0.025) < 1e-3);
});

test('deterministic: same seed + answers => identical sequence; replay from answers matches', () => {
  const P = E.prepareBank(bank, DRAFT);
  const ch = (nx, P, i) => [20, 50, 75, 100][(i * 7 + 3) % 4];
  const a = run(P, DRAFT, 'seed-A', ch), b = run(P, DRAFT, 'seed-A', ch);
  assert.deepEqual(a.seq.map(s => s.item.item_id), b.seq.map(s => s.item.item_id));
  assert.deepEqual(E.finalResult(P, a.st, DRAFT), E.finalResult(P, b.st, DRAFT));
  // replay: rebuild state from the answer log only
  let st = E.newSession(P, 'seed-A', DRAFT);
  for (const s of a.st.answers) { assert.equal(E.nextItem(P, st, DRAFT).item.item_id, s.item_id); st = E.submitAnswer(P, st, s.item_id, s.level, DRAFT); }
  assert.deepEqual(st, a.st);
});

test('different seeds => different wording variants (users do not all see identical items)', () => {
  const P = E.prepareBank(bank, DRAFT);
  const ids = s => new Set(run(P, DRAFT, s, allStrongFirst).seq.map(x => x.item.item_id));
  const A = ids('u1'), B = ids('u2'), C = ids('u3');
  const overlap = (X, Y) => [...X].filter(i => Y.has(i)).length / Math.max(X.size, Y.size);
  assert.ok(overlap(A, B) < 0.5 && overlap(A, C) < 0.5, 'item overlap too high');
});

test('no repeated item_id; content repeat limit respected (1 and 3)', () => {
  for (const cfg of [DRAFT, REP3]) {
    const P = E.prepareBank(bank, cfg);
    const r = run(P, cfg, 's', (nx, P, i) => [20, 50, 75, 100][i % 4]);
    const ids = r.seq.map(s => s.item.item_id), cc = {};
    assert.equal(new Set(ids).size, ids.length);
    r.seq.forEach(s => cc[s.item.content_id] = (cc[s.item.content_id] || 0) + 1);
    assert.ok(Math.max(...Object.values(cc)) <= (cfg.maxContentRepeat || 1));
  }
});

test('all four dichotomies are evaluated: each has >= warm-up answers within first 12 items', () => {
  const P = E.prepareBank(bank, DRAFT);
  const r = run(P, DRAFT, 'w', allStrongFirst);
  const first12 = r.seq.slice(0, 12).map(s => s.reason.dichotomy);
  for (const d of E.DICH) assert.equal(first12.filter(x => x === d).length, 3);
});

test('decisive respondent: stops at checkpoint 20 as "confident", never earlier', () => {
  const P = E.prepareBank(bank, DRAFT);
  const r = run(P, DRAFT, 'c', allStrongFirst);
  assert.equal(r.stop.stop_reason, 'confident');
  assert.equal(r.seq.length, 20);
  const res = E.finalResult(P, r.st, DRAFT);
  assert.equal(res.type, 'ESTJ');
  assert.ok(res.dichotomies.every(d => d.confidence_label === 'clear'));
});

test('stop is only evaluated at checkpoints (a decisive state at n=21 does not stop at 21)', () => {
  const P = E.prepareBank(bank, DRAFT);
  const cfg = Object.assign({}, DRAFT, { checkpoints: [20, 40] });
  const r = run(P, cfg, 'c2', allStrongFirst);
  assert.equal(r.seq.length, 20);
  const cfg2 = Object.assign({}, DRAFT, { checkpoints: [40] });
  const r2 = run(P, cfg2, 'c2', allStrongFirst);
  assert.equal(r2.seq.length, 40); // criterion met earlier but not a checkpoint; bank exhausted at 40
});

// ambiguous respondent: alternates the sign of directed evidence per dichotomy using weak levels
function ambiguous() {
  const cnt = {};
  return (nx, P) => {
    const d = nx.reason.dichotomy; cnt[d] = (cnt[d] || 0) + 1;
    return levelFor(P, nx.item, cnt[d] % 2 === 0).weak;
  };
}
test('ambiguous respondent never gets false confidence; bank-limited run ends "bank_exhausted" at 40 and flags uncertainty', () => {
  const P = E.prepareBank(bank, DRAFT);
  const r = run(P, DRAFT, 'a', ambiguous());
  assert.equal(r.seq.length, 40);
  assert.equal(r.stop.stop_reason, 'bank_exhausted');
  const res = E.finalResult(P, r.st, DRAFT);
  assert.ok(res.uncertain_dichotomies.length > 0);
});

test('hard cap: never more than 120 (needs repeat=3 to reach it), stop_reason max_items', () => {
  const P = E.prepareBank(bank, REP3);
  const r = run(P, REP3, 'm', ambiguous());
  assert.equal(r.seq.length, 120);
  assert.equal(r.stop.stop_reason, 'max_items');
  assert.throws(() => E.submitAnswer(P, r.st, 'Q0001', 100, REP3), /finished|already|unexpected/);
});

test('config rules: minItems<20, maxItems>120, 5 answer levels, non-monotone evidence are rejected', () => {
  assert.throws(() => E.prepareBank(bank, { minItems: 10 }), /minItems/);
  assert.throws(() => E.prepareBank(bank, { maxItems: 121 }), /maxItems/);
  assert.throws(() => E.prepareBank(bank, { evidence: { '0': 0 } }), /exactly the 4 levels/);
  assert.throws(() => E.prepareBank(bank, { evidence: { '50': -2 } }), /increasing/);
});

test('answer validation: invalid levels, strings, wrong item, duplicate/conflict', () => {
  const P = E.prepareBank(bank, DRAFT);
  let st = E.newSession(P, 'v', DRAFT);
  const nx = E.nextItem(P, st, DRAFT), id = nx.item.item_id;
  for (const bad of [0, 60, 10, 101, -1, null, undefined, NaN, '100', '75']) assert.throws(() => E.submitAnswer(P, st, id, bad, DRAFT), /invalid answer level/);
  assert.throws(() => E.submitAnswer(P, st, 'Q9999', 100, DRAFT), /unexpected item/);
  const s1 = E.submitAnswer(P, st, id, 75, DRAFT);
  assert.equal(st.answers.length, 0, 'input state must not be mutated');
  assert.strictEqual(E.submitAnswer(P, s1, id, 75, DRAFT), s1, 'double click is idempotent');
  assert.throws(() => E.submitAnswer(P, s1, id, 100, DRAFT), /different level/);
});

test('undo / change last answer re-derive the same path as answering directly', () => {
  const P = E.prepareBank(bank, DRAFT);
  let st = E.newSession(P, 'u', DRAFT);
  for (let i = 0; i < 6; i++) { const n = E.nextItem(P, st, DRAFT); st = E.submitAnswer(P, st, n.item.item_id, 100, DRAFT); }
  const changed = E.changeLastAnswer(P, st, 20, DRAFT);
  let ref = E.newSession(P, 'u', DRAFT);
  for (let i = 0; i < 6; i++) { const n = E.nextItem(P, ref, DRAFT); ref = E.submitAnswer(P, ref, n.item.item_id, i === 5 ? 20 : 100, DRAFT); }
  assert.deepEqual(changed, ref);
  assert.equal(E.undoLast(st).answers.length, 5);
});

test('stale state (other bank version / config) is rejected, not silently misread', () => {
  const P = E.prepareBank(bank, DRAFT);
  const st = E.newSession(P, 'z', DRAFT);
  assert.throws(() => E.nextItem(P, st, REP3), /config mismatch/);
  assert.throws(() => E.nextItem(P, Object.assign({}, st, { bank_version: 'v2' }), DRAFT), /bank version/);
});

test('facets stay "unknown" (هێشتا نادیار) without enough items; appear only with repeat>1 and >=3 items', () => {
  const P1 = E.prepareBank(bank, DRAFT);
  const r1 = run(P1, DRAFT, 'f', ambiguous());
  assert.ok(E.finalResult(P1, r1.st, DRAFT).facets.every(f => f.status === 'unknown' && f.label === 'هێشتا نادیار'));
  const P3 = E.prepareBank(bank, REP3);
  const r3 = run(P3, REP3, 'f', ambiguous());
  const f3 = E.finalResult(P3, r3.st, REP3).facets;
  assert.ok(f3.some(f => f.status === 'estimated_provisional'));
  assert.ok(f3.filter(f => f.status === 'estimated_provisional').every(f => f.answered >= 3));
});

test('result separates score / confidence / uncertainty / information / coverage and marks calibration as uncalibrated', () => {
  const P = E.prepareBank(bank, DRAFT);
  const res = E.finalResult(P, run(P, DRAFT, 'q', allStrongFirst).st, DRAFT);
  const d = res.dichotomies[0];
  for (const k of ['score_mu', 'measurement_sd', 'confidence_indicator', 'confidence_label', 'information', 'precision', 'coverage_ratio', 'answered']) assert.ok(k in d, k);
  assert.equal(res.calibration, 'uncalibrated');
});

test('PRODUCTION (no includeDraft) with the owner-approved v1 bank: serves items, capacity 40, finishes', () => {
  const b2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'question-bank.v1.json'), 'utf8'));
  const P = E.prepareBank(b2, {});
  assert.equal(E.capacity(P, {}), 40);
  const r = run(P, {}, 'prod', (nx, P) => levelFor(P, nx.item, true).strong);
  assert.equal(r.seq.length, 20); assert.equal(r.stop.stop_reason, 'confident');
});

// ---------------- Stage 6: scoring / type determination ----------------
const ALL16 = []; for (const a of 'EI') for (const b of 'SN') for (const c of 'TF') for (const d of 'JP') ALL16.push(a + b + c + d);
test('stage6: every one of the 16 types is reachable and reported as all_clear', () => {
  const P = E.prepareBank(bank, DRAFT);
  for (const target of ALL16) {
    const r = run(P, DRAFT, 't-' + target, (nx, P) => {
      const di = E.DICH.indexOf(nx.reason.dichotomy), pos = target[di] === nx.reason.dichotomy[0];
      return levelFor(P, nx.item, pos).strong;
    });
    const res = E.finalResult(P, r.st, DRAFT);
    assert.equal(res.type, target); assert.equal(res.type_status, 'all_clear'); assert.deepEqual(res.alternatives, []);
    res.dichotomies.forEach((d, i) => { assert.equal(d.letter, target[i]); assert.ok(d.info_ratio > 0 && d.info_ratio <= 1); assert.ok(d.answered <= d.available); });
  }
});
test('stage6: no answers -> type is null (never an invented type)', () => {
  const P = E.prepareBank(bank, DRAFT), res = E.finalResult(P, E.newSession(P, 'n', DRAFT), DRAFT);
  assert.equal(res.type, null); assert.equal(res.type_status, 'no_answers');
});
test('stage6: exact tie (mu==0) -> second letter, flagged low and listed uncertain', () => {
  const P = E.prepareBank(bank, DRAFT);
  let st = E.newSession(P, 'tie', DRAFT), got = 0;
  const flip = {};
  while (got < 8) { // two answers of opposite directed sign for the first dichotomy chosen each time is not controllable; build by search
    const nx = E.nextItem(P, st, DRAFT), d = nx.reason.dichotomy; flip[d] = (flip[d] || 0) + 1;
    st = E.submitAnswer(P, st, nx.item.item_id, levelFor(P, nx.item, flip[d] % 2 === 1).weak, DRAFT); got++;
  }
  const res = E.finalResult(P, st, DRAFT);
  res.dichotomies.filter(d => Math.abs(d.score_mu) < 1e-12).forEach(d => { assert.equal(d.tie, true); assert.equal(d.confidence_label, 'low'); assert.equal(d.letter, d.dichotomy[1]); assert.ok(res.uncertain_dichotomies.includes(d.dichotomy)); });
  assert.ok(res.dichotomies.some(d => d.tie), 'expected at least one exact tie in this construction');
});
test('stage6: alternatives only flip uncertain dichotomies, are distinct from main type, max 3, nearest first', () => {
  const P = E.prepareBank(bank, DRAFT);
  const r = run(P, DRAFT, 'alt', ambiguous()), res = E.finalResult(P, r.st, DRAFT);
  assert.ok(res.uncertain_dichotomies.length > 0 && res.alternatives.length > 0 && res.alternatives.length <= 3);
  for (const a of res.alternatives) {
    assert.notEqual(a.type, res.type);
    a.type.split('').forEach((ch, i) => { if (ch !== res.type[i]) assert.ok(res.uncertain_dichotomies.includes(E.DICH[i])); });
  }
  for (let i = 1; i < res.alternatives.length; i++) assert.ok(res.alternatives[i - 1].flipped.length <= res.alternatives[i].flipped.length);
});
test('stage6: facets never shown as measured without enough items; calibration flagged; result separates score/confidence/info', () => {
  const P = E.prepareBank(bank, DRAFT), res = E.finalResult(P, run(P, DRAFT, 'f6', ambiguous()).st, DRAFT);
  assert.ok(res.facets.every(f => f.status === 'unknown')); assert.equal(res.calibration, 'uncalibrated'); assert.equal(res.result_schema, 2);
  assert.ok(res.dichotomies.every(d => 'score_mu' in d && 'confidence_label' in d && 'info_ratio' in d && 'measurement_sd' in d));
});
