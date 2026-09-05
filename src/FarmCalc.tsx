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

interface Props {
  inventory: Record<string, InventoryItem>;
}

export default function FarmCalc({ inventory }: Props) {
  const [relics, setRelics] = useState<Relic[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [targetText, setTargetText] = useState("100");
  const [refinement, setRefinement] = useState<Refinement>("Radiant");
  const [auto, setAuto] = useState(true);
  const [squad, setSquad] = useState(4);
  const [minutes, setMinutes] = useState("3.5");
  const [subtractOwned, setSubtractOwned] = useState(true);

  const [relicOverrides, setRelicOverrides] = useState<Record<string, string>>({});
  const [refineOverrides, setRefineOverrides] = useState<Record<string, Refinement>>({});
  const [squadOverrides, setSquadOverrides] = useState<Record<string, number>>({});

  useEffect(() => { invoke<any>("get_drop_data").then(d => setRelics(parseRelics(d))).catch(() => {}); }, []);

  const allSets = useMemo(() => {
    const s = new Set<string>();
    for (const r of relics) for (const w of r.rewards) { const n = setNameOf(w.itemName); if (n) s.add(n); }
    return [...s].sort();
  }, [relics]);

  const shownSets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allSets.filter(s => s.toLowerCase().includes(q)) : allSets;
  }, [allSets, search]);

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

  const plan = useMemo(() => {
    const target = Math.max(1, Math.min(1000000, parseInt(targetText) || 0));
    const setTargets: Record<string, number> = {};
    for (const s of chosen) setTargets[s] = target;
    if (Object.keys(setTargets).length === 0) return null;
    return coFarmPlan(relics, setTargets, {
      squadSize: squad, refinement, autoRefinement: auto,
      relicOverrides, refinementOverrides: refineOverrides, squadOverrides,
      ownedParts, trials: 60, seed: 1,
    });
  }, [relics, chosen, targetText, squad, refinement, auto, relicOverrides, refineOverrides, squadOverrides, ownedParts]);

  const mins = (() => { const v = parseFloat(minutes); return v > 0 ? v : 3.5; })();
  const ceil = (n: number) => Math.ceil(n).toLocaleString();

  return (
    <div className="wfs wfs-split">
      <div className="wfs-sets">
        <input className="wfs-input" placeholder="Filter sets…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="wfs-setlist">
          {shownSets.map(s => (
            <label key={s} className="wfs-check">
              <input type="checkbox" checked={chosen.has(s)}
                onChange={() => setChosen(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; })} />
              <span>{s}</span>
            </label>
          ))}
          {shownSets.length === 0 && <div className="wfs-empty">{relics.length === 0 ? "Open the Relics tab once to load drop data." : "No sets match."}</div>}
        </div>
      </div>

      <div className="wfs-main">
        <div className="wfs-controls">
          <label className="wfs-field"><span>Of each set</span>
            <input className="wfs-input wfs-narrow" value={targetText} onChange={e => setTargetText(e.target.value)} /></label>
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
        </div>

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
            </div>

            <div className="wfs-subhead">Relics to farm</div>
            <div className="wfs-table">
              <div className="wfs-row wfs-head">
                <span className="wfs-c-name">Relic</span>
                <span className="wfs-c-sel">Refine</span>
                <span className="wfs-c-sel">Squad</span>
                <span className="wfs-c-num">Relics</span>
                <span className="wfs-c-num">Missions</span>
                <span className="wfs-c-num">Traces</span>
              </div>
              {plan.relics.map(r => (
                <div className="wfs-row" key={r.relicName}>
                  <span className="wfs-c-name">{r.relicName}</span>
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
              ))}
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
