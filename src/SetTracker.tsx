import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InventoryItem } from "./App";
import { HelpTip } from "./HelpTip";
import "./SetTracker.css";

// Set parts come from the relic drop tables (same source RelicHelper uses): every
// tradeable Prime part is a relic reward, so grouping rewards by set name gives each
// set's full part list — including the main blueprint — without recipe-tree guesswork.
interface DropReward { itemName?: string; item_name?: string; name?: string; }
interface DropRelic { rewards?: DropReward[] }

/** "Banshee Prime Chassis Blueprint" → "Banshee Prime". Returns null for non-set
 * rewards (Forma) and the old leading-"Prime" founder weapons we don't track. */
function setNameOf(part: string): string | null {
  const i = part.indexOf(" Prime");
  if (i <= 0) return null;
  return part.slice(0, i + 6); // include " Prime"
}

interface SetRow {
  key: string;
  name: string;          // set name, e.g. "Banshee Prime"
  built: boolean;        // the finished item is owned / mastered
  parts: { name: string; short: string; owned: number }[];
  ownedParts: number;
  totalParts: number;
  pct: number;
}

type SortMode = "closest" | "name" | "least";

interface Props {
  inventory: Record<string, InventoryItem>;
}

export default function SetTracker({ inventory }: Props) {
  const [rawRelics, setRawRelics] = useState<DropRelic[]>([]);
  const [catalog, setCatalog] = useState<{ unique_name: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hideComplete, setHideComplete] = useState(false);
  const [onlyStarted, setOnlyStarted] = useState(false);
  const [sort, setSort] = useState<SortMode>("closest");
  const [pinned, setPinned] = useState<string[]>(() => {
    try { const s = localStorage.getItem("ff-pinned-sets"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem("ff-pinned-sets", JSON.stringify(pinned)); } catch { /* ignore */ } }, [pinned]);
  const togglePin = (name: string) =>
    setPinned(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));

  useEffect(() => {
    invoke<{ unique_name: string; name: string }[]>("get_all_items").then(setCatalog).catch(() => {});
    invoke<any>("get_drop_data")
      .then(d => setRawRelics(Array.isArray(d?.relics) ? d.relics : []))
      .catch(() => setRawRelics([]))
      .finally(() => setLoading(false));
  }, []);

  // Lower-cased display name → unique_name, so a drop-table part name resolves to the
  // catalog item and we can read its owned quantity by unique_name (robust to the
  // inventory being keyed differently than the drop-table spelling).
  const nameToUnique = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalog) if (c.name) m.set(c.name.toLowerCase(), c.unique_name);
    return m;
  }, [catalog]);

  const ownedOf = (partName: string): number => {
    const uq = nameToUnique.get(partName.toLowerCase());
    const it: InventoryItem | undefined = (uq ? inventory[uq] : undefined) ?? inventory[partName];
    return it?.quantity ?? 0;
  };

  const rows = useMemo<SetRow[]>(() => {
    // set name → distinct part names
    const sets = new Map<string, Set<string>>();
    for (const relic of rawRelics) {
      for (const rw of relic.rewards ?? []) {
        const part = rw.itemName ?? rw.item_name ?? rw.name;
        if (!part) continue;
        const set = setNameOf(part);
        if (!set) continue;
        if (!sets.has(set)) sets.set(set, new Set());
        sets.get(set)!.add(part);
      }
    }

    const out: SetRow[] = [];
    for (const [set, partNames] of sets) {
      const parts = [...partNames].map(name => ({
        name,
        short: shortPart(name),
        owned: ownedOf(name),
      }));
      parts.sort((a, b) => a.short.localeCompare(b.short));

      // "Built" = the finished frame/weapon is in the inventory or mastered.
      const rootUq = nameToUnique.get(set.toLowerCase());
      const root: InventoryItem | undefined = (rootUq ? inventory[rootUq] : undefined) ?? inventory[set];
      const built = (root?.quantity ?? 0) > 0 || (root?.mastery_rank ?? 0) > 0;

      const ownedParts = built ? parts.length : parts.filter(p => p.owned > 0).length;
      const totalParts = parts.length;
      const pct = built ? 100 : totalParts > 0 ? Math.round((ownedParts / totalParts) * 100) : 0;

      out.push({ key: set, name: set, built, parts, ownedParts, totalParts, pct });
    }
    return out;
  }, [rawRelics, inventory, nameToUnique]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (q) r = r.filter(x => x.name.toLowerCase().includes(q));
    if (hideComplete) r = r.filter(x => x.pct < 100);
    if (onlyStarted) r = r.filter(x => x.ownedParts > 0 && x.pct < 100);
    const sorted = [...r];
    if (sort === "closest") sorted.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
    else if (sort === "least") sorted.sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [rows, search, hideComplete, onlyStarted, sort]);

  const complete = rows.filter(r => r.pct === 100).length;
  const pinnedRows = pinned
    .map(name => rows.find(r => r.name === name))
    .filter((r): r is SetRow => r !== undefined);

  return (
    <div className="settrk-wrap">
      {pinnedRows.length > 0 && (
        <aside className="settrk-pinned">
          <div className="settrk-pinned-head">📌 Farming ({pinnedRows.length})</div>
          {pinnedRows.map(row => (
            <div key={row.key} className={`settrk-pin${row.pct === 100 ? " done" : ""}`}>
              <div className="settrk-pin-top">
                <span className="settrk-pin-name" title={row.name}>{row.name}</span>
                <span className="settrk-pin-pct">{row.pct}%</span>
                <button className="settrk-pin-x" onClick={() => togglePin(row.name)} title="Unpin">×</button>
              </div>
              <div className="settrk-bar"><div className="settrk-bar-fill" style={{ width: `${row.pct}%` }} /></div>
              <div className="settrk-parts">
                {row.parts.map((p, i) => (
                  <span key={i} className={`settrk-part ${p.owned > 0 ? "have" : "missing"}`}
                    title={`${p.name} — ${p.owned > 0 ? `owned ×${p.owned}` : "missing"}`}>
                    {p.short}{p.owned > 1 ? ` ×${p.owned}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </aside>
      )}
      <div className="settrk">
      <div className="settrk-toolbar">
        <input
          className="settrk-search"
          placeholder="Search sets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className={`settrk-chip ${onlyStarted ? "on" : ""}`} onClick={() => setOnlyStarted(v => !v)}>In progress</button>
        <button className={`settrk-chip ${hideComplete ? "on" : ""}`} onClick={() => setHideComplete(v => !v)}>Hide complete</button>
        <span className="settrk-sep" />
        <span className="settrk-lbl">Sort:</span>
        <button className={`settrk-chip ${sort === "closest" ? "on" : ""}`} onClick={() => setSort("closest")}>Closest to done</button>
        <button className={`settrk-chip ${sort === "least" ? "on" : ""}`} onClick={() => setSort("least")}>Least owned</button>
        <button className={`settrk-chip ${sort === "name" ? "on" : ""}`} onClick={() => setSort("name")}>A–Z</button>
        <HelpTip items={[
          { swatch: "rgba(63,185,80,0.6)", label: "Owned", desc: "You hold at least one (the blueprint you get from a relic)." },
          { swatch: "rgba(255,255,255,0.15)", label: "Missing", desc: "Not in your inventory yet." },
          { icon: "✓", label: "Built", desc: "The finished item is in your inventory or already mastered — set counts as complete." },
        ]} />
        <span className="settrk-summary">{complete}/{rows.length} sets complete</span>
      </div>

      {loading ? (
        <div className="settrk-empty">Loading drop data…</div>
      ) : filtered.length === 0 ? (
        <div className="settrk-empty">{rows.length === 0 ? "No drop data — open the Relics tab once to load it." : "No sets match."}</div>
      ) : (
        <div className="settrk-grid">
          {filtered.map(row => (
            <div key={row.key} className={`settrk-card${row.pct === 100 ? " done" : ""}`}>
              <div className="settrk-card-head">
                <div className="settrk-card-title">
                  <span className="settrk-name">{row.name}</span>
                  <span className="settrk-sub">{row.built ? "Built ✓" : `${row.ownedParts}/${row.totalParts} parts`}</span>
                </div>
                <button className={`settrk-pinbtn${pinned.includes(row.name) ? " on" : ""}`}
                  onClick={() => togglePin(row.name)}
                  title={pinned.includes(row.name) ? "Unpin from side" : "Pin to side"}>📌</button>
                <span className="settrk-pct">{row.pct}%</span>
              </div>
              <div className="settrk-bar"><div className="settrk-bar-fill" style={{ width: `${row.pct}%` }} /></div>
              <div className="settrk-parts">
                {row.parts.map((p, i) => (
                  <span
                    key={i}
                    className={`settrk-part ${p.owned > 0 ? "have" : "missing"}`}
                    title={`${p.name} — ${p.owned > 0 ? `owned ×${p.owned}` : "missing"}`}
                  >
                    {p.short}{p.owned > 1 ? ` ×${p.owned}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

/** "Banshee Prime Chassis Blueprint" → "Chassis"; "Banshee Prime Blueprint" → "Blueprint". */
function shortPart(name: string): string {
  const slot = name.match(/(Neuroptics|Chassis|Systems|Barrel|Receiver|Stock|Blade|Handle|Link|Grip|String|Ornament|Gauntlet|Wings|Harness|Boot|Head|Pouch|Upper Limb|Lower Limb|Limb|Guard|Disc|Carapace|Cerebrum|Chain|Band|Buckle|Collar|Blueprint)/i);
  return slot ? slot[1] : name.replace(/\bPrime\b/gi, "").trim();
}
