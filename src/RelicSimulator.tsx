import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  parseRelics, simulateBulk, mulberry32, REFINEMENTS,
  type Relic, type Refinement, type Reward, type RewardValue,
} from "./warframeSim";
import "./warframeSim.css";

const CDN = (n?: string) => (n ? `https://cdn.warframestat.us/img/${n}` : undefined);
const wfmNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const SQUADS: { label: string; n: number }[] = [
  { label: "1b1", n: 1 }, { label: "2b2", n: 2 }, { label: "4b4 — radshare", n: 4 },
];

interface CatalogItem { unique_name: string; name: string; ducats?: number | null; image_name?: string }

// ── Presets & auto-persist ─────────────────────────────────────────────────
// The simulator config is saved to localStorage so it survives leaving the page
// (LAST_KEY) and can be stored under a name to switch between setups (PRESETS_KEY).
interface SimState {
  relicName: string;
  refinement: Refinement;
  squad: number;
  count: string;
  minutes: string;
  valueBy: "plat" | "ducats";
  dumped: string[];
}
interface SimPreset extends SimState { name: string }

const PRESETS_KEY = "ff-relicsim-presets";
const LAST_KEY = "ff-relicsim-last";

function loadPresets(): SimPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function savePresets(list: SimPreset[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}
function loadLast(): SimState | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) as SimState : null;
  } catch { return null; }
}

export default function RelicSimulator() {
  const [relics, setRelics] = useState<Relic[]>([]);
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [ducats, setDucats] = useState<Map<string, number>>(new Map());
  const [icons, setIcons] = useState<Map<string, string>>(new Map());

  const [query, setQuery] = useState("");
  const [relicName, setRelicName] = useState<string>("");
  const [refinement, setRefinement] = useState<Refinement>("Radiant");
  const [squad, setSquad] = useState(2);
  const [count, setCount] = useState("250");
  const [minutes, setMinutes] = useState("3.5");
  const [valueBy, setValueBy] = useState<"plat" | "ducats">("plat");
  const [dumped, setDumped] = useState<Set<string>>(new Set());

  // Preset / persistence state.
  const [presets, setPresets] = useState<SimPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const snapshot = (): SimState => ({
    relicName, refinement, squad, count, minutes, valueBy, dumped: [...dumped],
  });
  const applyState = (s: SimState) => {
    setRelicName(s.relicName ?? "");
    setQuery(s.relicName ?? "");
    setRefinement(s.refinement ?? "Radiant");
    setSquad(s.squad ?? 2);
    setCount(s.count ?? "250");
    setMinutes(s.minutes ?? "3.5");
    setValueBy(s.valueBy ?? "plat");
    setDumped(new Set(s.dumped ?? []));
  };

  // Restore the last working state once, before auto-persist starts.
  useEffect(() => {
    const last = loadLast();
    if (last) applyState(last);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-persist so the setup survives leaving the page.
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(LAST_KEY, JSON.stringify(snapshot())); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, relicName, refinement, squad, count, minutes, valueBy, dumped]);

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const entry: SimPreset = { name, ...snapshot() };
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

  useEffect(() => {
    invoke<any>("get_drop_data").then(d => setRelics(parseRelics(d))).catch(() => {});
    invoke<CatalogItem[]>("get_all_items").then(items => {
      const dm = new Map<string, number>(), im = new Map<string, string>();
      for (const it of items) {
        if (it.ducats != null) dm.set(it.name, it.ducats);
        if (it.image_name) im.set(it.name, it.image_name);
      }
      setDucats(dm); setIcons(im);
    }).catch(() => {});
    invoke<{ item_name: string; url_name: string }[]>("fetch_wfm_items").then(items => {
      const lookup = new Map<string, string>();
      for (const w of items) lookup.set(wfmNorm(w.item_name), w.url_name);
      invoke<Record<string, number | null>>("wfm_get_cached_prices").then(raw => {
        const m = new Map<string, number>();
        for (const [slug, p] of Object.entries(raw)) if (p != null) m.set(slug, p);
        const byName = new Map<string, number>();
        for (const [norm, slug] of lookup) { const p = m.get(slug); if (p != null) byName.set(norm, p); }
        setPrices(byName);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const platOf = (name: string) => prices.get(wfmNorm(name)) ?? 0;
  const ducatOf = (name: string) => ducats.get(name) ?? 0;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return relics
      .filter(r => !q || r.fullName.toLowerCase().includes(q))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 60);
  }, [relics, query]);

  const relic = useMemo(() => relics.find(r => r.fullName === relicName) ?? null, [relics, relicName]);

  const result = useMemo(() => {
    if (!relic) return null;
    const nRelics = Math.max(0, Math.min(100000, parseInt(count) || 0));
    const valueOf = (r: Reward): RewardValue => {
      const plat = platOf(r.itemName), duc = ducatOf(r.itemName);
      const isDump = dumped.has(r.itemName);
      const metric = valueBy === "plat" ? plat : duc;
      return { wanted: !isDump, plat, ducats: duc, keepScore: isDump ? -1 : metric };
    };
    return simulateBulk(relic, refinement, squad, nRelics, valueOf, mulberry32(1));
  }, [relic, refinement, squad, count, valueBy, dumped, prices, ducats]);

  const mins = (() => { const v = parseFloat(minutes); return v > 0 ? v : 3.5; })();
  const hours = result ? (result.missions * mins) / 60 : 0;
  const platPerHour = hours > 0 && result ? Math.round(result.totalPlat / hours) : 0;

  return (
    <div className="wfs">
      <div className="wfs-presetbar">
        <span className="wfs-preset-lbl">Preset</span>
        <select className="wfs-input wfs-preset-sel"
          value={presets.some(p => p.name === presetName) ? presetName : ""}
          onChange={e => { if (e.target.value) loadPreset(e.target.value); }}>
          <option value="">— choose —</option>
          {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <input className="wfs-input wfs-preset-name" placeholder="Name (e.g. Saryn Radshare)"
          value={presetName} onChange={e => setPresetName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") savePreset(); }} />
        <button className="wfs-chip on" onClick={savePreset} disabled={!presetName.trim()}
          title="Save the current relic + settings under this name (overwrites if it exists)">Save</button>
        {presets.some(p => p.name === presetName.trim()) && (
          <button className="wfs-chip" onClick={() => deletePreset(presetName.trim())}
            title="Delete this preset">Delete</button>
        )}
      </div>
      <div className="wfs-controls">
        <label className="wfs-field wfs-grow">
          <span>Relic</span>
          <input list="wfs-relic-list" className="wfs-input" placeholder="Search a relic (e.g. Lith K5)…"
            value={query} onChange={e => { setQuery(e.target.value); const hit = relics.find(r => r.fullName.toLowerCase() === e.target.value.toLowerCase()); if (hit) setRelicName(hit.fullName); }} />
          <datalist id="wfs-relic-list">{matches.map(r => <option key={r.fullName} value={r.fullName} />)}</datalist>
        </label>
        <label className="wfs-field"><span>Refinement</span>
          <select className="wfs-input" value={refinement} onChange={e => setRefinement(e.target.value as Refinement)}>
            {REFINEMENTS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="wfs-field"><span>Squad</span>
          <select className="wfs-input" value={squad} onChange={e => setSquad(parseInt(e.target.value))}>
            {SQUADS.map(s => <option key={s.n} value={s.n}>{s.label}</option>)}
          </select>
        </label>
        <label className="wfs-field"><span>Relics</span>
          <input className="wfs-input wfs-narrow" value={count} onChange={e => setCount(e.target.value)} />
        </label>
        <label className="wfs-field"><span>Min / mission</span>
          <input className="wfs-input wfs-narrow" value={minutes} onChange={e => setMinutes(e.target.value)} />
        </label>
        <label className="wfs-field"><span>Value by</span>
          <select className="wfs-input" value={valueBy} onChange={e => setValueBy(e.target.value as "plat" | "ducats")}>
            <option value="plat">Part price</option>
            <option value="ducats">Ducats</option>
          </select>
        </label>
      </div>

      {!relic ? (
        <div className="wfs-empty">{relics.length === 0 ? "Open the Relics tab once to load drop data." : "Pick a relic to simulate."}</div>
      ) : !result ? null : (
        <>
          <div className="wfs-summary">
            {relic.fullName} · {refinement} · {SQUADS.find(s => s.n === squad)?.label} —{" "}
            <b>{result.missions.toLocaleString()}</b> rewards from <b>{result.relics.toLocaleString()}</b> relics
          </div>

          <div className="wfs-totals">
            <div className="wfs-stat"><span>Platinum</span><b className="green">{Math.round(result.totalPlat).toLocaleString()} p</b></div>
            <div className="wfs-stat"><span>Ducats (dumped)</span><b className="cyan">{Math.round(result.totalDucats).toLocaleString()} d</b></div>
            <div className="wfs-stat"><span>Traces</span><b className="cyan">{result.tracesSpent.toLocaleString()}</b></div>
            <div className="wfs-stat"><span>Time</span><b>{fmtDuration(result.missions * mins)}</b></div>
            <div className="wfs-stat"><span>Plat / hour</span><b>{platPerHour.toLocaleString()}</b></div>
            <div className="wfs-stat"><span>Plat / relic</span><b>{(result.relics > 0 ? result.totalPlat / result.relics : 0).toFixed(1)}</b></div>
            <div className="wfs-stat"><span>Trace eff. (traces/plat)</span><b>{(result.totalPlat > 0 ? result.tracesSpent / result.totalPlat : 0).toFixed(2)}</b></div>
          </div>

          <div className="wfs-table">
            <div className="wfs-row wfs-head">
              <span className="wfs-c-img" />
              <span className="wfs-c-name">Reward</span>
              <span className="wfs-c-rar">Rarity</span>
              <span className="wfs-c-num">Kept</span>
              <span className="wfs-c-num">Each</span>
              <span className="wfs-c-num">Worth</span>
              <span className="wfs-c-keep">Keep</span>
            </div>
            {result.tallies.map((t, i) => {
              const isDump = dumped.has(t.reward.itemName);
              const worth = isDump ? `${(t.count * t.ducatsEach).toLocaleString()} d` : `${Math.round(t.count * t.platEach).toLocaleString()} p`;
              const each = isDump ? `${t.ducatsEach} d` : `${t.platEach} p`;
              return (
                <div className={`wfs-row${isDump ? " wfs-dumped" : ""}`} key={i}>
                  <span className="wfs-c-img">{icons.get(t.reward.itemName) && <img src={CDN(icons.get(t.reward.itemName))} alt="" loading="lazy" />}</span>
                  <span className="wfs-c-name">{t.reward.itemName}</span>
                  <span className={`wfs-c-rar rar-${t.reward.rarity.toLowerCase()}`}>{t.reward.rarity}</span>
                  <span className="wfs-c-num"><b>{t.count.toLocaleString()}</b></span>
                  <span className="wfs-c-num">{each}</span>
                  <span className="wfs-c-num">{worth}</span>
                  <span className="wfs-c-keep">
                    <button className={`wfs-chip ${isDump ? "" : "on"}`}
                      onClick={() => setDumped(prev => { const s = new Set(prev); if (s.has(t.reward.itemName)) s.delete(t.reward.itemName); else s.add(t.reward.itemName); return s; })}>
                      {isDump ? "Dump" : "Keep"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="wfs-note">Kept = one reward per mission, keeping the best of the {squad} shared drops by value. "Dump" counts a reward as ducats instead of platinum.</div>
        </>
      )}
    </div>
  );
}

function fmtDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60), m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
