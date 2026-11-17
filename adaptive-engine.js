/*!
 * MBTI Adaptive Engine — Stage 4 (v0.1.0, PROVISIONAL / UNCALIBRATED)
 *
 * What this is
 *   A deterministic, side-effect-free item-selection + scoring + stopping module.
 *   No DOM, no network, no Date, no Math.random, no LLM. Same (bank, config, seed, answers)
 *   always gives the same next item and the same result.
 *
 * What this is NOT
 *   Not IRT. The bank has no calibrated difficulty/discrimination (all null), so none are used or invented.
 *   The measurement model below is a transparent classical Bayesian-mean model whose constants
 *   (priorSD, noiseSD, evidence table) are PROVISIONAL ENGINE SETTINGS, not estimated from data.
 *   "pCorrect"/"confidence" are internal indicators of this provisional model, NOT scientific confidence.
 *
 * Model (per dichotomy d, first letter = positive direction)
 *   answer level L in {20,50,75,100}  ->  ordinal evidence e(L) in [-1,1]   (config.evidence; equal-rank spacing is an assumption)
 *   directed observation  x = scoring_direction * e(L)       (+ => first letter, e.g. E)
 *   latent theta_d ~ N(0, priorSD^2);   x_i = theta_d + N(0, noiseSD^2)
 *   posterior mean mu = (sum x / noiseSD^2) / precision,  precision = 1/priorSD^2 + n/noiseSD^2,  sd = precision^-0.5
 *   pCorrect = Phi(|mu| / sd)   = internal probability that the sign (letter) is right under this model
 *
 * Selection (deterministic)
 *   1. warm-up: every dichotomy gets `warmupPerDichotomy` items first (fewest answered, then EI,SN,TF,JP order)
 *   2. then the dichotomy with the lowest |mu|/sd (largest remaining sign uncertainty)
 *   3. facet inside it with the fewest answered items (coverage), then the pole with fewer answers (balance)
 *   4. a content (behaviour) is asked at most `maxContentRepeat` times — wording variants of the same behaviour are NOT independent items
 *   5. variant of the content: prefer unused scenario, then template not used in last N, then seeded hash order
 *
 * Stopping
 *   Evaluated only at config.checkpoints (default 20,40,60,80,100,120) and never before minItems.
 *   Stop when every dichotomy has pCorrect >= stopProb AND >= minPerDichotomyToStop answers AND >= minFacetsCoveredToStop facets.
 *   Hard stop at maxItems. Also stops (honestly flagged) when the bank has no eligible item left.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MbtiAdaptive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENGINE_VERSION = 'engine-0.1.0-provisional';
  var DICH = ['EI', 'SN', 'TF', 'JP'];

  var DEFAULTS = {
    minItems: 20,
    maxItems: 120,
    checkpoints: [20, 40, 60, 80, 100, 120],
    // ordinal evidence per answer level (PROVISIONAL assumption: equal-rank spacing, 50% is NOT neutral)
    evidence: { '20': -1, '50': -1 / 3, '75': 1 / 3, '100': 1 },
    priorSD: 0.5,
    noiseSD: 0.7,
    stopProb: 0.95,
    moderateProb: 0.8,
    warmupPerDichotomy: 3,
    minPerDichotomyToStop: 4,
    minFacetsCoveredToStop: 3,
    minFacetItemsToReport: 3,
    maxContentRepeat: 1,
    recentTemplateWindow: 3,
    // production: only items that are approved AND active. includeDraft is for tests/simulation only.
    includeDraft: false
  };

  function cfgOf(user) {
    var c = {}, k;
    for (k in DEFAULTS) c[k] = DEFAULTS[k];
    if (user) for (k in user) c[k] = user[k];
    if (user && user.evidence) { c.evidence = {}; for (k in DEFAULTS.evidence) c.evidence[k] = DEFAULTS.evidence[k]; for (k in user.evidence) c.evidence[k] = user.evidence[k]; }
    validateConfig(c);
    return c;
  }
  function validateConfig(c) {
    if (!(c.minItems >= 1 && c.maxItems >= c.minItems)) throw new Error('config: need 1 <= minItems <= maxItems');
    if (c.minItems < 20 && !c.allowBelow20) throw new Error('config: minItems must be >= 20 (project rule)');
    if (c.maxItems > 120) throw new Error('config: maxItems must be <= 120 (project rule)');
    if (!(c.maxContentRepeat >= 1)) throw new Error('config: maxContentRepeat >= 1');
    var lv = Object.keys(c.evidence);
    if (lv.sort().join() !== ['100', '20', '50', '75'].sort().join()) throw new Error('config: evidence must define exactly the 4 levels 20/50/75/100');
    var e = [c.evidence['20'], c.evidence['50'], c.evidence['75'], c.evidence['100']];
    for (var i = 1; i < 4; i++) if (!(e[i] > e[i - 1])) throw new Error('config: evidence must be strictly increasing (ordinal)');
  }
  function fingerprint(c) {
    return hash32(JSON.stringify([c.minItems, c.maxItems, c.checkpoints, c.evidence, c.priorSD, c.noiseSD, c.stopProb, c.warmupPerDichotomy,
      c.minPerDichotomyToStop, c.minFacetsCoveredToStop, c.maxContentRepeat, c.recentTemplateWindow, c.includeDraft])).toString(16);
  }

  // ---------- deterministic helpers ----------
  function hash32(s) { // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function erf(x) { // Abramowitz-Stegun 7.1.26, |err| < 1.5e-7
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  // ---------- bank preparation ----------
  function prepareBank(bank, userCfg) {
    var cfg = cfgOf(userCfg);
    if (!bank || !bank.items || !bank.contents || !bank.facets) throw new Error('bank: missing items/contents/facets');
    var contents = {}, facets = {}, byContent = {}, byId = {}, facetOrder = {};
    bank.facets.forEach(function (f, i) { facets[f.facet_id] = f; facetOrder[f.facet_id] = i; });
    bank.contents.forEach(function (c) {
      if (c.scoring_direction !== 1 && c.scoring_direction !== -1) throw new Error('bank: bad scoring_direction ' + c.content_id);
      if (!facets[c.facet_id] || DICH.indexOf(c.dichotomy) < 0) throw new Error('bank: bad facet/dichotomy ' + c.content_id);
      contents[c.content_id] = c; byContent[c.content_id] = [];
    });
    bank.items.forEach(function (it) {
      if (!contents[it.content_id]) throw new Error('bank: item with unknown content ' + it.item_id);
      if (byId[it.item_id]) throw new Error('bank: duplicate item_id ' + it.item_id);
      byId[it.item_id] = it;
      var ok = cfg.includeDraft || (it.active_status === 'active' && it.review_status === 'approved');
      if (ok) byContent[it.content_id].push(it);
    });
    Object.keys(byContent).forEach(function (k) { byContent[k].sort(function (a, b) { return a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0; }); });
    var facetsOfD = {}; DICH.forEach(function (d) { facetsOfD[d] = []; });
    bank.facets.forEach(function (f) { facetsOfD[f.dichotomy].push(f.facet_id); });
    var contentsOfFacet = {};
    bank.contents.forEach(function (c) { (contentsOfFacet[c.facet_id] = contentsOfFacet[c.facet_id] || []).push(c.content_id); });
    Object.keys(contentsOfFacet).forEach(function (f) { contentsOfFacet[f].sort(); });
    return { bank: bank, cfgFingerprint: fingerprint(cfg), contents: contents, facets: facets, facetOrder: facetOrder, facetsOfD: facetsOfD,
      contentsOfFacet: contentsOfFacet, byContent: byContent, byId: byId, bankVersion: bank.bank_version };
  }

  function itemText(P, item) {
    var b = P.bank;
    return b.scenarios[item.scenario] + '، ' + b.templates[item.wording_template] + ': ' + P.contents[item.content_id].behavior_text;
  }

  /** Maximum test length this bank can actually deliver under the config (honest cap, not the nominal 120). */
  function capacity(P, userCfg) {
    var cfg = cfgOf(userCfg), n = 0;
    Object.keys(P.byContent).forEach(function (k) { n += Math.min(cfg.maxContentRepeat, P.byContent[k].length); });
    return Math.min(n, cfg.maxItems);
  }

  // ---------- session state (plain JSON; fully replayable) ----------
  function newSession(P, seed, userCfg) {
    var cfg = cfgOf(userCfg);
    if (seed === undefined || seed === null || seed === '') throw new Error('newSession: seed required');
    return { engine_version: ENGINE_VERSION, bank_version: P.bankVersion, config_fp: fingerprint(cfg), seed: String(seed), answers: [] };
  }
  function checkState(P, st, cfg) {
    if (!st || st.engine_version !== ENGINE_VERSION) throw new Error('state: engine version mismatch');
    if (st.bank_version !== P.bankVersion) throw new Error('state: bank version mismatch');
    if (st.config_fp !== fingerprint(cfg)) throw new Error('state: config mismatch');
  }

  // ---------- analysis ----------
  function evidenceOf(cfg, level) {
    var e = typeof level === 'number' ? cfg.evidence[String(level)] : undefined;
    if (e === undefined) throw new Error('invalid answer level: ' + level + ' (allowed 20,50,75,100)');
    return e;
  }
  function analyze(P, st, userCfg) {
    var cfg = cfgOf(userCfg); checkState(P, st, cfg);
    var A = { n: st.answers.length, d: {}, facet: {}, contentCount: {}, scenarioUsed: {}, templates: [], lastPole: {}, answered: {} };
    DICH.forEach(function (d) {
      A.d[d] = { n: 0, sumX: 0, poleN: {}, facetsSeen: {}, lastPole: null };
    });
    st.answers.forEach(function (a) {
      var it = P.byId[a.item_id]; if (!it) throw new Error('state: unknown item ' + a.item_id);
      var c = P.contents[it.content_id], x = c.scoring_direction * evidenceOf(cfg, a.level), D = A.d[c.dichotomy];
      D.n++; D.sumX += x; D.poleN[c.measured_pole] = (D.poleN[c.measured_pole] || 0) + 1; D.facetsSeen[c.facet_id] = 1; D.lastPole = c.measured_pole;
      var F = A.facet[c.facet_id] = A.facet[c.facet_id] || { n: 0, sumX: 0 };
      F.n++; F.sumX += x;
      A.contentCount[c.content_id] = (A.contentCount[c.content_id] || 0) + 1;
      A.scenarioUsed[it.scenario] = 1; A.templates.push(it.wording_template); A.answered[it.item_id] = 1;
    });
    var p0 = 1 / (cfg.priorSD * cfg.priorSD), s2 = cfg.noiseSD * cfg.noiseSD;
    DICH.forEach(function (d) {
      var D = A.d[d], prec = p0 + D.n / s2;
      D.precision = prec; D.sd = Math.sqrt(1 / prec); D.mu = (D.sumX / s2) / prec;
      D.z = Math.abs(D.mu) / D.sd; D.pCorrect = Phi(D.z);
      D.info = D.n / s2; D.facetsCovered = Object.keys(D.facetsSeen).length;
    });
    return A;
  }

  function availableContentIds(P, A, cfg, facetId) {
    return P.contentsOfFacet[facetId].filter(function (cid) {
      var used = A.contentCount[cid] || 0;
      if (used >= cfg.maxContentRepeat) return false;
      return P.byContent[cid].some(function (it) { return !A.answered[it.item_id]; });
    });
  }
  function availableInDichotomy(P, A, cfg, d) {
    var out = [];
    P.facetsOfD[d].forEach(function (f) { availableContentIds(P, A, cfg, f).forEach(function (c) { out.push(c); }); });
    return out;
  }

  function criterionMet(A, cfg) {
    return DICH.every(function (d) {
      var D = A.d[d];
      return D.pCorrect >= cfg.stopProb && D.n >= cfg.minPerDichotomyToStop && D.facetsCovered >= cfg.minFacetsCoveredToStop;
    });
  }

  /** Stop decision for the current state. */
  function stopStatus(P, st, userCfg, A) {
    var cfg = cfgOf(userCfg); A = A || analyze(P, st, cfg);
    var n = A.n;
    if (n >= cfg.maxItems) return { stop: true, reason: 'max_items' };
    var avail = DICH.some(function (d) { return availableInDichotomy(P, A, cfg, d).length > 0; });
    if (!avail) return { stop: true, reason: n === 0 ? 'no_eligible_items' : 'bank_exhausted', below_min_items: n < cfg.minItems };
    if (n >= cfg.minItems && cfg.checkpoints.indexOf(n) >= 0 && criterionMet(A, cfg)) return { stop: true, reason: 'confident' };
    return { stop: false };
  }

  /** Next item (or the stop reason). `reason` explains WHY this item was chosen (for the UI's "why this question"). */
  function nextItem(P, st, userCfg) {
    var cfg = cfgOf(userCfg), A = analyze(P, st, cfg), ss = stopStatus(P, st, cfg, A);
    if (ss.stop) return { done: true, stop_reason: ss.reason, below_min_items: !!ss.below_min_items, answered: A.n };

    // 1) dichotomy
    var cand = DICH.filter(function (d) { return availableInDichotomy(P, A, cfg, d).length > 0; });
    var phase, chosenD;
    var warm = cand.filter(function (d) { return A.d[d].n < cfg.warmupPerDichotomy; });
    if (warm.length) {
      phase = 'warmup';
      chosenD = warm.slice().sort(function (a, b) { return A.d[a].n - A.d[b].n || DICH.indexOf(a) - DICH.indexOf(b); })[0];
    } else {
      phase = 'adaptive';
      chosenD = cand.slice().sort(function (a, b) { return (A.d[a].z - A.d[b].z) || (A.d[a].n - A.d[b].n) || (DICH.indexOf(a) - DICH.indexOf(b)); })[0];
    }
    var D = A.d[chosenD];
    // 2) facet: fewest answered, then order
    var facs = P.facetsOfD[chosenD].filter(function (f) { return availableContentIds(P, A, cfg, f).length > 0; });
    var chosenF = facs.slice().sort(function (a, b) {
      return ((A.facet[a] || { n: 0 }).n - (A.facet[b] || { n: 0 }).n) || (P.facetOrder[a] - P.facetOrder[b]);
    })[0];
    // 3) content (pole balance, then alternate from last pole, then order)
    var conts = availableContentIds(P, A, cfg, chosenF);
    var chosenC = conts.slice().sort(function (a, b) {
      var pa = P.contents[a].measured_pole, pb = P.contents[b].measured_pole;
      var da = (D.poleN[pa] || 0) - (D.poleN[pb] || 0); if (da) return da;
      if (D.lastPole && pa !== pb) return pa === D.lastPole ? 1 : -1;
      return a < b ? -1 : 1;
    })[0];
    // 4) variant
    var recent = A.templates.slice(-cfg.recentTemplateWindow);
    var variants = P.byContent[chosenC].filter(function (it) { return !A.answered[it.item_id]; });
    var best = null, bestKey = null;
    variants.forEach(function (it) {
      var key = [A.scenarioUsed[it.scenario] ? 1 : 0, recent.indexOf(it.wording_template) >= 0 ? 1 : 0, hash32(st.seed + '|' + it.item_id)];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && (key[2] < bestKey[2] || (key[2] === bestKey[2] && it.item_id < best.item_id)))))) { best = it; bestKey = key; }
    });
    var c = P.contents[chosenC];
    return {
      done: false, item: best, text: itemText(P, best), index: A.n + 1,
      reason: { phase: phase, dichotomy: chosenD, facet_id: chosenF, content_id: chosenC, measured_pole: c.measured_pole,
        why: phase === 'warmup' ? 'coverage: this dichotomy has too few answers yet' : 'largest remaining uncertainty among the four dichotomies' },
      progress: progress(P, A, cfg)
    };
  }

  /** Honest progress: never promises a final number. Gives a lower bound and a hard upper bound only. */
  function progress(P, A, cfg) {
    var cap = 0; Object.keys(P.byContent).forEach(function (k) { cap += Math.min(cfg.maxContentRepeat, P.byContent[k].length); });
    return { answered: A.n, at_least: Math.max(cfg.minItems, A.n), at_most: Math.min(cfg.maxItems, cap), next_checkpoint: nextCheckpoint(cfg, A.n) };
  }
  function nextCheckpoint(cfg, n) { for (var i = 0; i < cfg.checkpoints.length; i++) if (cfg.checkpoints[i] > n && cfg.checkpoints[i] >= cfg.minItems) return cfg.checkpoints[i]; return null; }

  /** Record an answer. Only the item currently served is accepted; exact repeat is idempotent; conflicting repeat is rejected. */
  function submitAnswer(P, st, itemId, level, userCfg) {
    var cfg = cfgOf(userCfg); evidenceOf(cfg, level);
    var prev = st.answers.filter(function (a) { return a.item_id === itemId; })[0];
    if (prev) { if (prev.level === level) return st; throw new Error('item already answered with a different level; use changeLastAnswer'); }
    var nx = nextItem(P, st, cfg);
    if (nx.done) throw new Error('session finished: ' + nx.stop_reason);
    if (nx.item.item_id !== itemId) throw new Error('unexpected item: expected ' + nx.item.item_id);
    return { engine_version: st.engine_version, bank_version: st.bank_version, config_fp: st.config_fp, seed: st.seed,
      answers: st.answers.concat([{ item_id: itemId, level: level }]) };
  }
  /** Back/undo: drop the last answer (the path re-derives deterministically). */
  function undoLast(st) {
    if (!st.answers.length) return st;
    return { engine_version: st.engine_version, bank_version: st.bank_version, config_fp: st.config_fp, seed: st.seed, answers: st.answers.slice(0, -1) };
  }
  /** Change only the most recent answer (changing an older one would change the adaptive path, so it is not allowed). */
  function changeLastAnswer(P, st, level, userCfg) {
    var cfg = cfgOf(userCfg); evidenceOf(cfg, level);
    if (!st.answers.length) throw new Error('no answer to change');
    var last = st.answers[st.answers.length - 1], base = undoLast(st);
    return submitAnswer(P, base, last.item_id, level, cfg);
  }

  function confLabel(p, cfg) { return p >= cfg.stopProb ? 'clear' : p >= cfg.moderateProb ? 'moderate' : 'low'; }

  /** Result. Separates: letter/score, confidence indicator, measurement uncertainty, information, coverage, precision, stopping. */
  function finalResult(P, st, userCfg) {
    var cfg = cfgOf(userCfg), A = analyze(P, st, cfg), ss = stopStatus(P, st, cfg, A);
    var pairs = { EI: ['E', 'I'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P'] };
    var type = '', dich = [];
    DICH.forEach(function (d) {
      var D = A.d[d], tie = D.mu === 0, letter = D.mu > 0 ? pairs[d][0] : pairs[d][1];
      type += letter;
      var nContents = 0;
      P.facetsOfD[d].forEach(function (f) { P.contentsOfFacet[f].forEach(function (c) { nContents += Math.min(cfg.maxContentRepeat, P.byContent[c].length); }); });
      dich.push({
        dichotomy: d, letter: letter, tie: tie, direction: D.mu > 0 ? 'first' : 'second',
        score_mu: D.mu,                         // posterior mean of directed evidence in [-1,1] (provisional scale)
        measurement_sd: D.sd,                   // measurement uncertainty (provisional model)
        confidence_indicator: D.pCorrect,       // internal indicator ONLY — not validated confidence
        confidence_label: tie ? 'low' : confLabel(D.pCorrect, cfg),
        information: D.info, precision: D.precision,
        answered: D.n, available: nContents, info_ratio: nContents ? D.n / nContents : 0, // share of this dichotomy's behaviours actually asked
        facets_covered: D.facetsCovered, facets_total: P.facetsOfD[d].length,
        coverage_ratio: D.facetsCovered / P.facetsOfD[d].length
      });
    });
    var uncertainD = dich.filter(function (x) { return x.confidence_label === 'low'; });
    var alternatives = [];
    (function () { // other types reachable by flipping only the uncertain dichotomies, nearest first
      var k = uncertainD.length, i, j, flips, t;
      for (i = 1; i < (1 << k); i++) {
        flips = []; t = dich.map(function (x) { return x.letter; });
        for (j = 0; j < k; j++) if (i & (1 << j)) { var di = DICH.indexOf(uncertainD[j].dichotomy); t[di] = pairs[uncertainD[j].dichotomy][t[di] === pairs[uncertainD[j].dichotomy][0] ? 1 : 0]; flips.push(uncertainD[j].dichotomy); }
        alternatives.push({ type: t.join(''), flipped: flips, closeness: flips.reduce(function (a, d) { return a + uncertainD.filter(function (u) { return u.dichotomy === d; })[0].confidence_indicator; }, 0) / flips.length });
      }
      alternatives.sort(function (a, b) { return a.flipped.length - b.flipped.length || b.closeness - a.closeness || (a.type < b.type ? -1 : 1); });
      alternatives = alternatives.slice(0, 3);
    })();
    var facets = P.bank.facets.map(function (f) {
      var F = A.facet[f.facet_id] || { n: 0, sumX: 0 };
      if (F.n < cfg.minFacetItemsToReport) return { facet_id: f.facet_id, status: 'unknown', label: 'هێشتا نادیار', answered: F.n };
      return { facet_id: f.facet_id, status: 'estimated_provisional', answered: F.n, mean_directed_evidence: F.sumX / F.n };
    });
    return {
      engine_version: ENGINE_VERSION, bank_version: P.bankVersion, finished: ss.stop, stop_reason: ss.stop ? ss.reason : null,
      below_min_items: A.n < cfg.minItems, answered: A.n, type: A.n ? type : null, dichotomies: dich, facets: facets,
      type_status: !A.n ? 'no_answers' : (uncertainD.length ? 'some_uncertain' : 'all_clear'), alternatives: alternatives,
      type_method: 'letter = sign of posterior mean per dichotomy (mu>0 first letter, else second); tie (mu==0) -> second letter and flagged low; label from internal indicator, not validated',
      result_schema: 2,
      uncertain_dichotomies: dich.filter(function (x) { return x.confidence_label === 'low' || x.tie; }).map(function (x) { return x.dichotomy; }),
      calibration: 'uncalibrated', note: 'Provisional internal indicators; not validated reliability/validity.'
    };
  }

  return {
    ENGINE_VERSION: ENGINE_VERSION, DEFAULTS: DEFAULTS, DICH: DICH,
    prepareBank: prepareBank, newSession: newSession, nextItem: nextItem, submitAnswer: submitAnswer, undoLast: undoLast,
    changeLastAnswer: changeLastAnswer, finalResult: finalResult, stopStatus: stopStatus, analyze: analyze, capacity: capacity, itemText: itemText,
    _internal: { hash32: hash32, Phi: Phi, cfgOf: cfgOf }
  };
});
