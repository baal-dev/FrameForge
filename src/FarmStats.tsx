import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./FarmStats.css";

interface RelicRun {
  id: number;
  timestamp: string; // RFC3339
  era: string;       // Lith / Meso / Neo / Axi / Requiem / ?
  item_path: string;
  item_name: string;
}

interface CatItem { unique_name: string; name: string }

interface Props {
  catalog: CatItem[];
  dateRange: number | "all";
  onDateRangeChange: (r: number | "all") => void;
}

const RANGES: { label: string; value: number | "all" }[] = [
  { label: "Today", value: 1 },
  { label: "7 Days", value: 7 },
  { label: "30 Days", value: 30 },
  { label: "All Time", value: "all" },
];

const ERA_ORDER = ["Lith", "Meso", "Neo", "Axi", "Requiem", "?"];
const ERA_COLOR: Record<string, string> = {
  Lith: "#c8a06a", Meso: "#b7c0c9", Neo: "#e3c341", Axi: "#e06c4f",
  Requiem: "#9b7fd4", "?": "#8b949e",
};

/** Prettify a leaf like "MiragePrimeBlueprint" → "Mirage Prime Blueprint". */
function prettifyLeaf(leaf: string): string {
  return leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export default function FarmStats({ catalog, dateRange, onDateRangeChange }: Props) {
  const [runs, setRuns] = useState<RelicRun[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    invoke<RelicRun[]>("get_relic_runs")
      .then(r => { setRuns(r); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(reload, []);

  // path → display name from the catalog, for nice reward labels.
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalog) if (c.unique_name) m.set(c.unique_name, c.name);
    return (r: RelicRun) => m.get(r.item_path) ?? prettifyLeaf(r.item_name);
  }, [catalog]);

  const filtered = useMemo(() => {
    if (dateRange === "all") return runs;
    const cutoff = Date.now() - dateRange * 86_400_000;
    return runs.filter(r => new Date(r.timestamp).getTime() >= cutoff);
  }, [runs, dateRange]);

  const stats = useMemo(() => {
    const byEra = new Map<string, number>();
    const byItem = new Map<string, number>();
    let forma = 0;
    for (const r of filtered) {
      byEra.set(r.era, (byEra.get(r.era) ?? 0) + 1);
      const label = nameOf(r);
      const isForma = /forma/i.test(label);
      if (isForma) forma++;
      byItem.set(label, (byItem.get(label) ?? 0) + 1);
    }
    const eraRows = ERA_ORDER
      .filter(e => (byEra.get(e) ?? 0) > 0)
      .map(e => ({ era: e, count: byEra.get(e) ?? 0 }));
    const maxEra = Math.max(1, ...eraRows.map(r => r.count));
    const topItems = [...byItem.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    const primeParts = filtered.length - forma;
    return {
      total: filtered.length,
      forma,
      primeParts,
      distinct: byItem.size,
      eraRows,
      maxEra,
      topItems,
    };
  }, [filtered, nameOf]);

  // Per-day activity for the last 14 days (within the current range).
  const activity = useMemo(() => {
    const days = 14;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const buckets: { key: string; label: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      buckets.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        count: 0,
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const r of filtered) {
      const key = new Date(r.timestamp).toISOString().slice(0, 10);
      const i = idx.get(key);
      if (i != null) buckets[i].count++;
    }
    const max = Math.max(1, ...buckets.map(b => b.count));
    return { buckets, max };
  }, [filtered]);

  if (loading) return <div className="fst-empty">Loading…</div>;

  return (
    <div className="fst">
      <div className="fst-range-row">
        <span className="fst-range-label">Period:</span>
        {RANGES.map(r => (
          <button key={String(r.value)}
            className={`fst-range-btn ${dateRange === r.value ? "fst-range-active" : ""}`}
            onClick={() => onDateRangeChange(r.value)}>
            {r.label}
          </button>
        ))}
        <span style={{ marginLeft: "auto" }} />
        {runs.length > 0 && (
          <button className="fst-range-btn" title="Delete all recorded relic runs"
            onClick={async () => {
              if (!confirm("Clear all recorded relic runs? This cannot be undone.")) return;
              await invoke("clear_relic_runs").catch(() => {});
              reload();
            }}>Clear</button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="fst-empty">
          No relics tracked yet. Open relic reward screens in-game with the overlay
          enabled and your opened relics will be counted here.
        </div>
      ) : (
        <>
          <div className="fst-tiles">
            <div className="fst-tile">
              <span className="fst-tile-num">{stats.total}</span>
              <span className="fst-tile-lbl">Relics Opened</span>
            </div>
            <div className="fst-tile">
              <span className="fst-tile-num">{stats.primeParts}</span>
              <span className="fst-tile-lbl">Prime Parts</span>
            </div>
            <div className="fst-tile">
              <span className="fst-tile-num">{stats.forma}</span>
              <span className="fst-tile-lbl">Forma</span>
            </div>
            <div className="fst-tile">
              <span className="fst-tile-num">{stats.distinct}</span>
              <span className="fst-tile-lbl">Distinct Rewards</span>
            </div>
          </div>

          <div className="fst-cols">
            <section className="fst-card">
              <div className="fst-card-title">Relics by Era</div>
              {stats.eraRows.length === 0 ? (
                <div className="fst-mini-empty">No data in this period.</div>
              ) : stats.eraRows.map(row => (
                <div key={row.era} className="fst-bar-row">
                  <span className="fst-bar-lbl">{row.era === "?" ? "Unknown" : row.era}</span>
                  <div className="fst-bar-track">
                    <div className="fst-bar-fill" style={{
                      width: `${(row.count / stats.maxEra) * 100}%`,
                      background: ERA_COLOR[row.era] ?? "#388bfd",
                    }} />
                  </div>
                  <span className="fst-bar-num">{row.count}</span>
                </div>
              ))}
            </section>

            <section className="fst-card">
              <div className="fst-card-title">Last 14 Days</div>
              <div className="fst-spark">
                {activity.buckets.map(b => (
                  <div key={b.key} className="fst-spark-col" title={`${b.key}: ${b.count}`}>
                    <div className="fst-spark-bar" style={{
                      height: `${Math.max(2, (b.count / activity.max) * 100)}%`,
                      opacity: b.count === 0 ? 0.25 : 1,
                    }} />
                    <span className="fst-spark-lbl">{b.label[0]}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="fst-card">
            <div className="fst-card-title">Top Rewards</div>
            {stats.topItems.slice(0, 20).map(it => (
              <div key={it.label} className="fst-item-row">
                <span className="fst-item-name">{it.label}</span>
                <span className="fst-item-count">{it.count}×</span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
