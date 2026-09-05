// Pure Warframe relic maths ported 1:1 from the WarframeCompanion C# core
// (RefinementOdds, BulkRelicSimulator, CoFarmCalculator). No React, no IPC — the
// UI components feed it drop data + prices and render the results.

export type Rarity = "Common" | "Uncommon" | "Rare";
export type Refinement = "Intact" | "Exceptional" | "Flawless" | "Radiant";
export const REFINEMENTS: Refinement[] = ["Intact", "Exceptional", "Flawless", "Radiant"];

export interface Reward { itemName: string; rarity: Rarity }
export interface Relic { tier: string; name: string; fullName: string; rewards: Reward[] }

// ── Refinement odds (a relic always has 3 Common, 2 Uncommon, 1 Rare) ──────────
const ODDS: Record<Refinement, Record<Rarity, number>> = {
  Intact:      { Common: 25.33, Uncommon: 11, Rare: 2 },
  Exceptional: { Common: 23.33, Uncommon: 13, Rare: 4 },
  Flawless:    { Common: 20.0,  Uncommon: 17, Rare: 6 },
  Radiant:     { Common: 16.67, Uncommon: 20, Rare: 10 },
};

export function chanceOf(ref: Refinement, rar: Rarity): number { return ODDS[ref][rar]; }

export function traceCost(ref: Refinement): number {
  return ref === "Exceptional" ? 25 : ref === "Flawless" ? 50 : ref === "Radiant" ? 100 : 0;
}

/** Best refinement per rarity by gain-per-trace: Common→Intact, Uncommon→Flawless, Rare→Radiant. */
export function bestFor(rar: Rarity): Refinement {
  const intact = chanceOf("Intact", rar);
  let best: Refinement = "Intact";
  let bestScore = 0;
  let bestChance = intact;
  const eps = 1e-9;
  for (const r of ["Exceptional", "Flawless", "Radiant"] as Refinement[]) {
    const cost = traceCost(r);
    if (cost <= 0) continue;
    const c = chanceOf(r, rar);
    const s = (c - intact) / cost;
    if (s > bestScore + eps || (Math.abs(s - bestScore) <= eps && c > bestChance)) {
      best = r; bestScore = s; bestChance = c;
    }
  }
  return best;
}

/** Rarity from a drop chance — matches RelicHelper (more reliable than the WFCD string). */
export function chanceToRarity(chance: number): Rarity {
  if (chance >= 15) return "Common";
  if (chance >= 5) return "Uncommon";
  return "Rare";
}

/** "Banshee Prime Chassis Blueprint" → "Banshee Prime"; null for non-set rewards. */
export function setNameOf(part: string): string | null {
  const i = part.indexOf(" Prime");
  if (i <= 0) return null;
  return part.slice(0, i + 6);
}

// ── Deterministic RNG (so a fixed seed reproduces results, like C# new Random(1)) ─
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Parse FrameForge's get_drop_data into Relic[] ──────────────────────────────
export function parseRelics(raw: any): Relic[] {
  const arr: any[] = Array.isArray(raw?.relics) ? raw.relics : [];
  const out: Relic[] = [];
  const seen = new Set<string>();
  for (const r of arr) {
    const tier: string = r.tier ?? "";
    const relicName: string = r.relicName ?? r.name ?? "";
    if (!relicName) continue;
    const fullName = tier ? `${tier} ${relicName}` : relicName;
    if (seen.has(fullName)) continue;
    const rewards: Reward[] = (Array.isArray(r.rewards) ? r.rewards : [])
      .map((x: any) => {
        const chance = Number(x.chance ?? 0);
        const itemName = String(x.itemName ?? x.item_name ?? x.name ?? "Unknown");
        return { itemName, rarity: chanceToRarity(chance) };
      })
      .filter((x: Reward) => x.itemName !== "Unknown");
    if (rewards.length === 0) continue;
    seen.add(fullName);
    out.push({ tier, name: relicName, fullName, rewards });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  Bulk single-relic simulator (port of BulkRelicSimulator)
// ════════════════════════════════════════════════════════════════════════════

export interface RewardValue { wanted: boolean; plat: number; ducats: number; keepScore: number }
export interface BulkTally { reward: Reward; count: number; wanted: boolean; platEach: number; ducatsEach: number }
export interface BulkResult {
  refinement: Refinement; squadSize: number; relics: number; missions: number;
  tallies: BulkTally[]; totalPlat: number; totalDucats: number; tracesSpent: number;
}

export function simulateBulk(
  relic: Relic, refinement: Refinement, squadSize: number, relics: number,
  valueOf: (r: Reward) => RewardValue, rand: () => number,
): BulkResult {
  const n = Math.max(1, Math.min(4, squadSize));
  relics = Math.max(0, relics);
  const missions = Math.floor((relics * 4) / n);

  const rewards = relic.rewards;
  const count = rewards.length;
  const wanted: boolean[] = [], plat: number[] = [], ducats: number[] = [], score: number[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const v = valueOf(rewards[i]);
    wanted[i] = v.wanted;
    plat[i] = Math.max(0, v.plat);
    ducats[i] = Math.max(0, v.ducats);
    score[i] = v.keepScore;
    total += chanceOf(refinement, rewards[i].rarity);
    cumulative[i] = total;
  }

  const counts = new Array<number>(count).fill(0);
  if (total > 0 && count > 0) {
    for (let m = 0; m < missions; m++) {
      let bestIdx = -1, bestScore = -Infinity;
      for (let j = 0; j < n; j++) {
        const roll = rand() * total;
        let idx = 0;
        while (idx < count - 1 && roll > cumulative[idx]) idx++;
        if (score[idx] > bestScore) { bestScore = score[idx]; bestIdx = idx; }
      }
      if (bestIdx >= 0) counts[bestIdx]++;
    }
  }

  let totalPlat = 0, totalDucats = 0;
  const indexed: { tally: BulkTally; score: number }[] = [];
  for (let i = 0; i < count; i++) {
    indexed.push({ tally: { reward: rewards[i], count: counts[i], wanted: wanted[i], platEach: plat[i], ducatsEach: ducats[i] }, score: score[i] });
    if (wanted[i]) totalPlat += counts[i] * plat[i];
    else totalDucats += counts[i] * ducats[i];
  }
  indexed.sort((a, b) => b.score - a.score);

  return {
    refinement, squadSize: n, relics, missions,
    tallies: indexed.map(x => x.tally),
    totalPlat, totalDucats,
    tracesSpent: relics * traceCost(refinement),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Multi-set co-farm planner (port of CoFarmCalculator)
// ════════════════════════════════════════════════════════════════════════════

export interface CoFarmCandidate { relicName: string; chance: number }
export interface CoFarmPart {
  partName: string; setName: string; rarity: Rarity; relic: string; target: number;
  candidates: CoFarmCandidate[];
}
export interface CoFarmRelic {
  relicName: string; refinement: Refinement; squadSize: number;
  relicsNeeded: number; missions: number; traces: number; covered: boolean;
}
export interface CoFarmPlan {
  squadSize: number; autoRefinement: boolean;
  relics: CoFarmRelic[]; parts: CoFarmPart[];
  totalRelics: number; totalTraces: number; totalMissions: number;
  totalRelicsMedian: number; totalRelicsP25: number; totalRelicsP75: number; totalRelicsP90: number;
  totalMissionsMedian: number; totalMissionsP90: number;
}

export interface CoFarmOptions {
  squadSize: number;
  refinement: Refinement;
  autoRefinement: boolean;
  relicOverrides?: Record<string, string>;      // part → relic full name
  refinementOverrides?: Record<string, Refinement>; // relic → refinement
  squadOverrides?: Record<string, number>;      // relic → squad n
  ownedParts?: Record<string, number>;          // part → owned count
  trials?: number;
  seed?: number;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const s = [...values].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const SQUAD_TOTAL = 4;

export function coFarmPlan(
  relics: Relic[], setTargets: Record<string, number>, opts: CoFarmOptions,
): CoFarmPlan {
  const n = Math.max(1, Math.min(4, opts.squadSize));
  const trials = Math.max(1, opts.trials ?? 60);
  const rand = mulberry32(opts.seed ?? 1);
  const owned = opts.ownedParts ?? {};
  const relicOverrides = opts.relicOverrides ?? {};
  const refinementOverrides = opts.refinementOverrides ?? {};
  const squadOverrides = opts.squadOverrides ?? {};

  const empty: CoFarmPlan = {
    squadSize: n, autoRefinement: opts.autoRefinement, relics: [], parts: [],
    totalRelics: 0, totalTraces: 0, totalMissions: 0,
    totalRelicsMedian: 0, totalRelicsP25: 0, totalRelicsP75: 0, totalRelicsP90: 0,
    totalMissionsMedian: 0, totalMissionsP90: 0,
  };

  // 1) Wanted parts (target minus owned).
  const target: Record<string, number> = {};
  const partSet: Record<string, string> = {};
  for (const relic of relics) {
    for (const rw of relic.rewards) {
      const set = setNameOf(rw.itemName);
      if (!set) continue;
      const t = setTargets[set];
      if (!t || t <= 0) continue;
      const have = Math.max(0, owned[rw.itemName] ?? 0);
      const remaining = t - have;
      if (remaining <= 0) continue;
      target[rw.itemName] = remaining;
      partSet[rw.itemName] = set;
    }
  }
  const parts = Object.keys(target);
  if (parts.length === 0) return empty;

  // 2) Relics carrying any wanted part.
  const relevant: Relic[] = [];
  const seen = new Set<string>();
  for (const r of relics)
    if (r.rewards.some(w => target[w.itemName] !== undefined) && !seen.has(r.fullName)) {
      seen.add(r.fullName); relevant.push(r);
    }

  // 3) Per relic: squad share, refinement, sampling distribution.
  const refs: Refinement[] = [], nOf: number[] = [], cum: number[][] = [], totals: number[] = [];
  for (let ri = 0; ri < relevant.length; ri++) {
    const relic = relevant[ri];
    const name = relic.fullName;
    nOf[ri] = squadOverrides[name] != null ? Math.max(1, Math.min(4, squadOverrides[name])) : n;
    if (refinementOverrides[name]) refs[ri] = refinementOverrides[name];
    else if (opts.autoRefinement) {
      let maxRar: Rarity = "Common";
      for (const w of relic.rewards)
        if (target[w.itemName] !== undefined && rarRank(w.rarity) > rarRank(maxRar)) maxRar = w.rarity;
      refs[ri] = bestFor(maxRar);
    } else refs[ri] = opts.refinement;

    const c: number[] = []; let run = 0;
    for (let i = 0; i < relic.rewards.length; i++) { run += chanceOf(refs[ri], relic.rewards[i].rarity); c[i] = run; }
    cum[ri] = c; totals[ri] = run;
  }

  const hitInRelic = (part: string, ri: number): number => {
    for (const w of relevant[ri].rewards)
      if (w.itemName === part) return 1 - Math.pow(1 - chanceOf(refs[ri], w.rarity) / 100, nOf[ri]);
    return 0;
  };
  const rarityInRelic = (part: string, ri: number): Rarity => {
    for (const w of relevant[ri].rewards) if (w.itemName === part) return w.rarity;
    return "Common";
  };

  // 4) Per part: candidates + chosen relic.
  const candidates: Record<string, CoFarmCandidate[]> = {};
  const assignedIdx: Record<string, number> = {};
  const assignedHit: Record<string, number> = {};
  const assignedRarity: Record<string, Rarity> = {};
  for (const part of parts) {
    const idxs = relevant
      .map((_, ri) => ri)
      .filter(ri => relevant[ri].rewards.some(w => w.itemName === part))
      .sort((a, b) => hitInRelic(part, b) - hitInRelic(part, a));

    candidates[part] = idxs.map(ri => ({
      relicName: relevant[ri].fullName,
      chance: chanceOf(refs[ri], rarityInRelic(part, ri)),
    }));

    let chosen = idxs[0];
    const want = relicOverrides[part];
    if (want) { const m = idxs.find(ri => relevant[ri].fullName === want); if (m != null) chosen = m; }
    assignedIdx[part] = chosen;
    assignedHit[part] = Math.max(hitInRelic(part, chosen), 1e-9);
    assignedRarity[part] = rarityInRelic(part, chosen);
  }

  // 5) Monte-Carlo.
  const avgMissions = new Array<number>(relevant.length).fill(0);
  const trialMissions: number[][] = [];
  let cap = 0;
  for (const p of parts) cap += Math.ceil(target[p] / assignedHit[p]);
  cap = Math.max(cap * 8, 100000);

  for (let trial = 0; trial < trials; trial++) {
    const remaining: Record<string, number> = { ...target };
    const missions = new Array<number>(relevant.length).fill(0);
    let left = parts.length;
    let guard = 0;
    while (left > 0 && guard++ < cap) {
      let bottleneck: string | null = null, worst = -1;
      for (const p of parts) {
        const rem = remaining[p];
        if (rem <= 0) continue;
        const s = rem / assignedHit[p];
        if (s > worst) { worst = s; bottleneck = p; }
      }
      if (bottleneck === null) break;
      const ri = assignedIdx[bottleneck];
      missions[ri]++;
      const rw = relevant[ri].rewards, c = cum[ri], tot = totals[ri];
      let keep: string | null = null, keepScore = -1;
      for (let j = 0; j < nOf[ri]; j++) {
        const roll = rand() * tot;
        let idx = 0;
        while (idx < c.length - 1 && roll > c[idx]) idx++;
        const nm = rw[idx].itemName;
        const rem = remaining[nm];
        if (rem !== undefined && rem > 0) {
          const s = rem / assignedHit[nm];
          if (s > keepScore) { keepScore = s; keep = nm; }
        }
      }
      if (keep !== null && --remaining[keep] === 0) left--;
    }
    for (let ri = 0; ri < relevant.length; ri++) avgMissions[ri] += missions[ri];
    trialMissions[trial] = missions;
  }
  for (let ri = 0; ri < relevant.length; ri++) avgMissions[ri] /= trials;

  // 6) Build plan.
  const totalMissions = avgMissions.reduce((a, b) => a + b, 0);
  const relicPlans: CoFarmRelic[] = [];
  const coveredOf = new Array<boolean>(relevant.length).fill(false);
  for (let ri = 0; ri < relevant.length; ri++) {
    const m = avgMissions[ri];
    if (m <= 0) continue;
    const relicsNeeded = (m * nOf[ri]) / SQUAD_TOTAL;
    const covered = totalMissions > 0 && m / totalMissions < 0.02;
    coveredOf[ri] = covered;
    relicPlans.push({
      relicName: relevant[ri].fullName, refinement: refs[ri], squadSize: nOf[ri],
      relicsNeeded, missions: m, traces: Math.ceil(relicsNeeded) * traceCost(refs[ri]), covered,
    });
  }
  relicPlans.sort((a, b) => b.relicsNeeded - a.relicsNeeded);

  const trialRelicTotals: number[] = [], trialMissionTotals: number[] = [];
  for (let t = 0; t < trials; t++) {
    const mm = trialMissions[t]; let relicSum = 0, missionSum = 0;
    for (let ri = 0; ri < relevant.length; ri++) {
      if (coveredOf[ri]) continue;
      relicSum += (mm[ri] * nOf[ri]) / SQUAD_TOTAL;
      missionSum += mm[ri];
    }
    trialRelicTotals[t] = relicSum; trialMissionTotals[t] = missionSum;
  }

  const partPlans: CoFarmPart[] = parts
    .map(p => ({
      partName: p, setName: partSet[p], rarity: assignedRarity[p],
      relic: relevant[assignedIdx[p]].fullName, target: target[p], candidates: candidates[p],
    }))
    .sort((a, b) => a.setName.localeCompare(b.setName) || rarRank(b.rarity) - rarRank(a.rarity));

  const farmed = relicPlans.filter(r => !r.covered);
  return {
    squadSize: n, autoRefinement: opts.autoRefinement, relics: relicPlans, parts: partPlans,
    totalRelics: farmed.reduce((a, r) => a + r.relicsNeeded, 0),
    totalTraces: farmed.reduce((a, r) => a + r.traces, 0),
    totalMissions: farmed.reduce((a, r) => a + r.missions, 0),
    totalRelicsMedian: percentile(trialRelicTotals, 0.5),
    totalRelicsP25: percentile(trialRelicTotals, 0.25),
    totalRelicsP75: percentile(trialRelicTotals, 0.75),
    totalRelicsP90: percentile(trialRelicTotals, 0.9),
    totalMissionsMedian: percentile(trialMissionTotals, 0.5),
    totalMissionsP90: percentile(trialMissionTotals, 0.9),
  };
}

function rarRank(r: Rarity): number { return r === "Rare" ? 2 : r === "Uncommon" ? 1 : 0; }
