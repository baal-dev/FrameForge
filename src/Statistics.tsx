import Reports from "./Reports";
import ItemReport from "./ItemReport";
import FarmStats from "./FarmStats";
import "./Statistics.css";

interface CatItem { unique_name: string; name: string }

interface Props {
  tab: "trade" | "item" | "farm";
  onTabChange: (t: "trade" | "item" | "farm") => void;
  dateRange: number | "all";
  onDateRangeChange: (r: number | "all") => void;
  clockFormat: "auto" | "12h" | "24h";
  systemLocale: string;
  catalog: CatItem[];
}

export default function Statistics({ tab, onTabChange, dateRange, onDateRangeChange, clockFormat, systemLocale, catalog }: Props) {
  return (
    <div className="statistics">
      <div className="stat-sub-tabs">
        <button className={tab === "trade" ? "active" : ""} onClick={() => onTabChange("trade")}>
          Trade Report
        </button>
        <button className={tab === "item" ? "active" : ""} onClick={() => onTabChange("item")}>
          Item Report
        </button>
        <button className={tab === "farm" ? "active" : ""} onClick={() => onTabChange("farm")}>
          Farm Stats
        </button>
      </div>
      {tab === "trade" && <Reports dateRange={dateRange} onDateRangeChange={onDateRangeChange} clockFormat={clockFormat} systemLocale={systemLocale} />}
      {tab === "item" && <ItemReport />}
      {tab === "farm" && <FarmStats catalog={catalog} dateRange={dateRange} onDateRangeChange={onDateRangeChange} />}
    </div>
  );
}
