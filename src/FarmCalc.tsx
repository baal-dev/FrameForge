import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InventoryItem } from "./App";
import {
  parseRelics, coFarmPlan, setNameOf, REFINEMENTS,
  type Relic, type Refinement,
} from "./warframeSim";
import "./warframeSim.css";

const SQUADS: { label: string; n: number }[] = [
  { label: "1b1", n: 1 }, { label: "2b2", n: 2 }, { label: "4b4", n: 4 },
];
const wfmNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const REFINEMENT_SUFFIXES = ["intact", "exceptional", "flawless", "radiant"];

interface RelicCatItem { unique_name: string; name: string; category: string }

// ── Presets & auto-persist ─────────────────────────────────────────────────
// The Farm Calc config is serialised to localStorage so it survives navigating
// away (LAST_KEY = the working state) and can be saved under a name to switch
// between farms — e.g. "Banshee Mirage" vs "Hydroid" (PRESETS_KEY).
interface FarmState {
  chosen: string[];
  targets: Record<string, number>;
  targetText: string;
  refinement: Refinement;
  auto: boolean;
  squad: number;
  minutes: string;
  subtractOwned: boolean;
  onlyAvailable: boolean;
  availableText: string;
  relicOverrides: Record<string, string>;
  refineOverrides: Record<string, Refinement>;
  squadOverrides: Record<string, number>;
}
interface FarmPreset extends FarmState { name: string }

const PRESETS_KEY = "ff-farmcalc-presets";
const LAST_KEY = "ff-farmcalc-last";

function loadPresets(): FarmPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function savePresets(list: FarmPreset[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}
function loadLast(): FarmState | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) as FarmState : null;
  } catch { return null; }
}

interface Props {
  inventory: Record<string, InventoryItem>;
}

export default function FarmCalc({ inventory }: Props) {
  const [relics, setRelics] = useState<Relic[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [targetText, setTargetText] = useState("100");
  const [targets, setTargets] = useState<Record<string, number>>({}); // per-set target
  const [refinement, setRefinement] = useState<Refinement>("Radiant");
  const [auto, setAuto] = useState(true);
  const [squad, setSquad] = useState(4);
  const [minutes, setMinutes] = useState("3.5");
  const [subtractOwned, setSubtractOwned] = useState(true);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [availableText, setAvailableText] = useState("");

  const [relicOverrides, setRelicOverrides] = useState<Record<string, string>>({});
  const [refineOverrides, setRefineOverrides] = useState<Record<string, Refinement>>({});
  const [squadOverrides, setSquadOverrides] = useState<Record<string, number>>({});

  const [prices, setPrices] = useState<Map<string, number>>(new Map());

  // Preset / persistence state.
  const [presets, setPresets] = useState<FarmPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Gather the current config into a serialisable snapshot.
  const snapshot = (): FarmState => ({
    chosen: [...chosen], targets, targetText, refinement, auto, squad, minutes,
    subtractOwned, onlyAvailable, availableText,
    relicOverrides, refineOverrides, squadOverrides,
  });
  // Apply a saved snapshot back onto the live state.
  const applyState = (s: FarmState) => {
    setChosen(new Set(s.chosen ?? []));
    setTargets(s.targets ?? {});
    setTargetText(s.targetText ?? "100");
    setRefinement(s.refinement ?? "Radiant");
    setAuto(s.auto ?? true);
    setSquad(s.squad ?? 4);
    setMinutes(s.minutes ?? "3.5");
    setSubtractOwned(s.subtractOwned ?? true);
    setOnlyAvailable(s.onlyAvailable ?? false);
    setAvailableText(s.availableText ?? "");
    setRelicOverrides(s.relicOverrides ?? {});
    setRefineOverrides(s.refineOverrides ?? {});
    setSquadOverrides(s.squadOverrides ?? {});
  };

  // Relic catalog (per-refinement entries like "Meso V13 Radiant") so we can show
  // how many of each relic you already own, summed across refinements.
  const [relicCatalog, setRelicCatalog] = useState<Map<string, RelicCatItem>>(new Map());

  useEffect(() => { invoke<any>("get_drop_data").then(d => setRelics(parseRelics(d))).catch(() => {}); }, []);

  useEffect(() => {
    invoke<RelicCatItem[]>("get_all_items").then(items => {
      const m = new Map<string, RelicCatItem>();
      for (const i of items) if (i.category === "Relics") m.set(i.name.toLowerCase(), i);
      setRelicCatalog(m);
    }).catch(() => {});
  }, []);

  // Total owned relics of a given "<Tier> <Name>" (e.g. "Meso V13") across all four
  // refinement tiers, read live from inventory.
  const ownedRelicCount = (fullName: string): number => {
    const base = fullName.toLowerCase();
    let total = 0;
    for (const ref of REFINEMENT_SUFFIXES) {
      const cat = relicCatalog.get(`${base} ${ref}`);
      if (cat) total += inventory[cat.unique_name]?.quantity ?? 0;
    }
    return total;
  };

  // Restore the last working state once, before we start auto-persisting.
  useEffect(() => {
    const last = loadLast();
    if (last) applyState(last);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-persist the working state so it survives leaving the page.
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(LAST_KEY, JSON.stringify(snapshot())); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, chosen, targets, targetText, refinement, auto, squad, minutes,
      subtractOwned, onlyAvailable, availableText, relicOverrides, refineOverrides, squadOverrides]);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const entry: FarmPreset = { name, ...snapshot() };
    setPresets(prev => {
      const next = [...prev.filter(p => p.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
      savePresets(next);
      return next;
    });
  };
  const loadPreset = (name: string) => {
    const p = presets.find(x => x.name === name);
    if (p) { applyState(p); setPresetName(name); }
  };
  const deletePreset = (name: string) => {
    setPresets(prev => { const next = prev.filter(p => p.name !== name); savePresets(next); return next; });
    setPresetName(cur => (cur === name ? "" : cur));
  };

  // warframe.market prices keyed by normalized name (for "<Set> Set" plat value).
  useEffect(() => {
    invoke<{ item_name: string; url_name: string }[]>("fetch_wfm_items").then(items => {
      const lookup = new Map<string, string>();
      for (const w of items) lookup.set(wfmNorm(w.item_name), w.url_name);
      invoke<Record<string, number | null>>("wfm_get_cached_prices").then(raw => {
        const bySlug = new Map<string, number>();
        for (const [slug, p] of Object.entries(raw)) if (p != null) bySlug.set(slug, p);
        const byName = new Map<string, number>();
        for (const [norm, slug] of lookup) { const p = bySlug.get(slug); if (p != null) byName.set(norm, p); }
        setPrices(byName);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const setPriceOf = (setName: string): number => prices.get(wfmNorm(`${setName} Set`)) ?? 0;

  const allSets = useMemo(() => {
    const s = new Set<string>();
    for (const r of relics) for (const w of r.rewards) { const n = setNameOf(w.itemName); if (n) s.add(n); }
    return [...s].sort();
  }, [relics]);

  const shownSets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allSets.filter(s => s.toLowerCase().includes(q)) : allSets;
  }, [allSets, search]);

  const defaultTarget = Math.max(1, Math.min(1000000, parseInt(targetText) || 100));
  const toggleSet = (s: string) => {
    setChosen(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
    setTargets(prev => (prev[s] != null ? prev : { ...prev, [s]: defaultTarget }));
  };

  const ownedOf = (name: string): number => inventory[name]?.quantity ?? 0;

  const ownedParts = useMemo(() => {
    if (!subtractOwned) return {};
    const o: Record<string, number> = {};
    for (const r of relics) for (const w of r.rewards) {
      const set = setNameOf(w.itemName);
      if (set && chosen.has(set)) { const q = ownedOf(w.itemName); if (q > 0) o[w.itemName] = q; }
    }
    return o;
  }, [relics, chosen, subtractOwned, inventory]);

  // Parse the pasted Resurgence — trade-chat "[Lith K5 Relic]" links or one per line.
  const availableRelics = useMemo(() => {
    if (!onlyAvailable) return undefined;
    const brackets = [...availableText.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    const tokens = brackets.length ? brackets : availableText.split(/[\n,;]+/);
    const out: string[] = [];
    for (const raw of tokens) {
      const name = raw.trim().replace(/\s*relic\s*$/i, "").trim();
      if (name) out.push(name);
    }
    return out.length ? out : undefined;
  }, [onlyAvailable, availableText]);

  const plan = useMemo(() => {
    const setTargets: Record<string, number> = {};
    for (const s of chosen) setTargets[s] = Math.max(1, Math.min(1000000, targets[s] ?? defaultTarget));
    if (Object.keys(setTargets).length === 0) return null;
    return coFarmPlan(relics, setTargets, {
      squadSize: squad, refinement, autoRefinement: auto,
      relicOverrides, refinementOverrides: refineOverrides, squadOverrides,
      ownedParts, availableRelics, trials: 60, seed: 1,
    });
  }, [relics, chosen, targets, defaultTarget, squad, refinement, auto, relicOverrides, refineOverrides, squadOverrides, ownedParts, availableRelics]);

  const mins = (() => { const v = parseFloat(minutes); return v > 0 ? v : 3.5; })();
  const ceil = (n: number) => Math.ceil(n).toLocaleString();

  // warframe.market sell value of the sets you're farming: set price × its target.
  const setValueRows = [...chosen].sort().map(s => {
    const unit = setPriceOf(s);
    const tgt = targets[s] ?? defaultTarget;
    return { set: s, unit, tgt, total: unit * tgt };
  });
  const grandSetValue = setValueRows.reduce((a, r) => a + r.total, 0);
  const anySetPrice = setValueRows.some(r => r.unit > 0);

  return (
    <div className="wfs wfs-split">
      <div className="wfs-sets">
        <input className="wfs-input" placeholder="Filter sets…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="wfs-setlist">
          {shownSets.map(s => (
            <div key={s} className="wfs-setrow">
              <label className="wfs-check wfs-setrow-check">
                <input type="checkbox" checked={chosen.has(s)} onChange={() => toggleSet(s)} />
                <span>{s}</span>
              </label>
              {chosen.has(s) && (
                <input className="wfs-input wfs-settarget" type="number" min={1}
                  title={`How many ${s} sets you want`}
                  value={targets[s] ?? defaultTarget}
                  onChange={e => setTargets(prev => ({ ...prev, [s]: Math.max(1, parseInt(e.target.value) || 1) }))} />
              )}
            </div>
          ))}
          {shownSets.length === 0 && <div className="wfs-empty">{relics.length === 0 ? "Open the Relics tab once to load drop data." : "No sets match."}</div>}
        </div>
      </div>

      <div className="wfs-main">
        <div className="wfs-presetbar">
          <span className="wfs-preset-lbl">Preset</span>
          <select className="wfs-input wfs-preset-sel"
            value={presets.some(p => p.name === presetName) ? presetName : ""}
            onChange={e => { if (e.target.value) loadPreset(e.target.value); }}>
            <option value="">— choose —</option>
            {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <input className="wfs-input wfs-preset-name" placeholder="Name (e.g. Banshee Mirage)"
            value={presetName} onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") savePreset(); }} />
          <button className="wfs-chip on" onClick={savePreset} disabled={!presetName.trim()}
            title="Save the current selection under this name (overwrites if it exists)">Save</button>
          {presets.some(p => p.name === presetName.trim()) && (
            <button className="wfs-chip" onClick={() => deletePreset(presetName.trim())}
              title="Delete this preset">Delete</button>
          )}
        </div>
        <div className="wfs-controls">
          <label className="wfs-field"><span>Default per set</span>
            <input className="wfs-input wfs-narrow" value={targetText} onChange={e => setTargetText(e.target.value)}
              title="Applied to a set when you first tick it — change any set's number in the list on the left." /></label>
          <label className="wfs-field"><span>Refinement</span>
            <select className="wfs-input" value={refinement} disabled={auto} onChange={e => setRefinement(e.target.value as Refinement)}>
              {REFINEMENTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select></label>
          <label className="wfs-check wfs-inline"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /><span>Auto (best per relic)</span></label>
          <label className="wfs-field"><span>Squad</span>
            <select className="wfs-input" value={squad} onChange={e => setSquad(parseInt(e.target.value))}>
              {SQUADS.map(s => <option key={s.n} value={s.n}>{s.label}</option>)}
            </select></label>
          <label className="wfs-field"><span>Min / mission</span>
            <input className="wfs-input wfs-narrow" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
          <label className="wfs-check wfs-inline"><input type="checkbox" checked={subtractOwned} onChange={e => setSubtractOwned(e.target.checked)} /><span>Subtract owned (inventory)</span></label>
          <label className="wfs-check wfs-inline"><input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} /><span>Available relics only</span></label>
        </div>

        {onlyAvailable && (
          <div className="wfs-avail">
            <span className="wfs-avail-lbl">Paste the current Resurgence — trade-chat [links] or one relic per line:</span>
            <textarea className="wfs-input wfs-textarea" value={availableText} onChange={e => setAvailableText(e.target.value)}
              placeholder="[Lith K5 Relic][Lith M7 Relic][Meso E5 Relic][Neo B6 Relic][Axi H5 Relic][Axi A12 Relic]" />
          </div>
        )}

        {!plan ? (
          <div className="wfs-empty">Tick one or more sets on the left.</div>
        ) : (
          <>
            <div className="wfs-totals">
              <div className="wfs-stat">
                <span>Total relics (avg)</span>
                <b className="green">{ceil(plan.totalRelics)}</b>
                {plan.totalRelicsP90 > 0 && <small>typical {ceil(plan.totalRelicsP25)}–{ceil(plan.totalRelicsP75)} · safe {ceil(plan.totalRelicsP90)}</small>}
              </div>
              <div className="wfs-stat"><span>Total traces</span><b className="cyan">{Math.round(plan.totalTraces).toLocaleString()}</b></div>
              <div className="wfs-stat">
                <span>Est. time</span>
                <b>{fmtDuration(plan.totalMissions * mins)}</b>
                {plan.totalMissionsP90 > 0 && <small>safe {fmtDuration(plan.totalMissionsP90 * mins)}</small>}
              </div>
              {anySetPrice && (
                <div className="wfs-stat">
                  <span>Sell value (all sets)</span>
                  <b className="green">{Math.round(grandSetValue).toLocaleString()} p</b>
                  <small>at warframe.market set prices</small>
                </div>
              )}
            </div>

            <div className="wfs-subhead">Set value (warframe.market)</div>
            <div className="wfs-table">
              <div className="wfs-row wfs-head">
                <span className="wfs-c-name">Set</span>
                <span className="wfs-c-num">Set price</span>
                <span className="wfs-c-num">Sets</span>
                <span className="wfs-c-num">Total plat</span>
              </div>
              {setValueRows.map(r => (
                <div className="wfs-row" key={r.set}>
                  <span className="wfs-c-name">{r.set}</span>
                  <span className="wfs-c-num">{r.unit > 0 ? `${r.unit} p` : "—"}</span>
                  <span className="wfs-c-num">{r.tgt}</span>
                  <span className="wfs-c-num green">{r.unit > 0 ? `${Math.round(r.total).toLocaleString()} p` : "—"}</span>
                </div>
              ))}
              <div className="wfs-row">
                <span className="wfs-c-name"><b>Total</b></span>
                <span className="wfs-c-num" />
                <span className="wfs-c-num" />
                <span className="wfs-c-num green"><b>{Math.round(grandSetValue).toLocaleString()} p</b></span>
              </div>
            </div>
            {!anySetPrice && <div className="wfs-note">Set prices not loaded yet — open the Market tab once so warframe.market prices are cached.</div>}

            <div className="wfs-subhead">Relics to farm</div>
            <div className="wfs-table">
              <div className="wfs-row wfs-head">
                <span className="wfs-c-name">Relic</span>
                <span className="wfs-c-num">Have</span>
                <span className="wfs-c-sel">Refine</span>
                <span className="wfs-c-sel">Squad</span>
                <span className="wfs-c-num">Relics</span>
                <span className="wfs-c-num">Missions</span>
                <span className="wfs-c-num">Traces</span>
              </div>
              {plan.relics.map(r => {
                const have = ownedRelicCount(r.relicName);
                return (
                <div className="wfs-row" key={r.relicName}>
                  <span className="wfs-c-name">{r.relicName}</span>
                  <span className="wfs-c-num" title="Relics you own (all refinements)">
                    {have > 0 ? have : <span className="wfs-covered">0</span>}
                  </span>
                  <span className="wfs-c-sel">
                    <select className="wfs-input wfs-mini" value={refineOverrides[r.relicName] ?? r.refinement}
                      onChange={e => setRefineOverrides(p => ({ ...p, [r.relicName]: e.target.value as Refinement }))}>
                      {REFINEMENTS.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </span>
                  <span className="wfs-c-sel">
                    <select className="wfs-input wfs-mini" value={squadOverrides[r.relicName] ?? r.squadSize}
                      onChange={e => setSquadOverrides(p => ({ ...p, [r.relicName]: parseInt(e.target.value) }))}>
                      {SQUADS.map(x => <option key={x.n} value={x.n}>{x.label}</option>)}
                    </select>
                  </span>
                  <span className="wfs-c-num">{r.covered ? <i className="wfs-covered">covered</i> : <b className="green">{ceil(r.relicsNeeded)}</b>}</span>
                  <span className="wfs-c-num">{r.covered ? "—" : ceil(r.missions)}</span>
                  <span className="wfs-c-num cyan">{r.covered ? "—" : Math.round(r.traces).toLocaleString()}</span>
                </div>
                );
              })}
            </div>

            <div className="wfs-subhead">Parts covered</div>
            <div className="wfs-table">
              <div className="wfs-row wfs-head">
                <span className="wfs-c-name">Part</span>
                <span className="wfs-c-set">Set</span>
                <span className="wfs-c-sel wfs-wide">Relic</span>
                <span className="wfs-c-rar">Rarity</span>
                <span className="wfs-c-num">Have</span>
                <span className="wfs-c-num">Need</span>
              </div>
              {plan.parts.map(p => (
                <div className="wfs-row" key={p.partName}>
                  <span className="wfs-c-name">{p.partName}</span>
                  <span className="wfs-c-set">{p.setName}</span>
                  <span className="wfs-c-sel wfs-wide">
                    <select className="wfs-input wfs-mini" value={relicOverrides[p.partName] ?? p.relic}
                      onChange={e => setRelicOverrides(prev => ({ ...prev, [p.partName]: e.target.value }))}>
                      {p.candidates.map(c => <option key={c.relicName} value={c.relicName}>{c.relicName} — {c.chance.toFixed(1)}%</option>)}
                    </select>
                  </span>
                  <span className={`wfs-c-rar rar-${p.rarity.toLowerCase()}`}>{p.rarity}</span>
                  <span className="wfs-c-num">{ownedOf(p.partName)}</span>
                  <span className="wfs-c-num green">{p.target}</span>
                </div>
              ))}
            </div>
            <div className="wfs-note">
              "Have" is read live from your inventory (toggle "Subtract owned" off to plan full sets). Shared relics are planned together — a relic whose parts all drop as byproducts of others shows "covered". Typical = 25th–75th percentile, safe = 90th (enough in ~9 of 10 runs).
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function fmtDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60), m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
