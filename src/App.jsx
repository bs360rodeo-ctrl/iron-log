import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus, X, Trash2, ChevronLeft, ChevronRight, Save, ClipboardList, Timer,
  Play, Pause, RotateCcw, Home, BarChart3, CalendarDays, Flame, Trophy,
  TrendingUp, TrendingDown,
} from "lucide-react";

// ---- Storage (localStorage / この端末のブラウザ内に保存) --------------------
// 記録はこの端末のブラウザに保存されます。同じ端末で開けば残ります。
// ※ ブラウザのデータを消すと記録も消えます（別端末とは同期しません）。
const KEY = "sheets:all";
async function load() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
async function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); }
  catch (e) { console.error("保存に失敗しました", e); }
}

// 目標体重（アプリ全体の設定として別キーに保存）
const TKEY = "settings:targetWeight";
function loadTarget() {
  try { const v = localStorage.getItem(TKEY); return v ? Number(v) : ""; }
  catch { return ""; }
}
function saveTarget(v) {
  try { localStorage.setItem(TKEY, String(v)); } catch {}
}

// ---- Constants -------------------------------------------------------------
const PARTS = ["胸", "背中", "肩", "腕", "脚", "腹", "全身"];
const MAX_EX = 8;
const MAX_SET = 5;
const SETS = [1, 2, 3, 4, 5];

const todayStr = () => new Date().toISOString().slice(0, 10);
const wd = (d) => ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
const fmtDate = (s) => {
  const d = new Date(s + "T00:00:00");
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月 ${d.getDate()}日（${wd(d)}）`;
};
const fmtShort = (s) => {
  const d = new Date(s + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}（${wd(d)}）`;
};
// "YYYY-MM-DD"（ローカル日付）
const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const emptyCell = () => ({ w: "", r: "" });
const emptyEx = () => ({ name: "", rest: 90, sets: Array.from({ length: MAX_SET }, emptyCell) });
const newSheet = () => ({
  id: Date.now().toString(),
  date: todayStr(),
  part: "胸",
  goal: "",
  start: "",
  end: "",
  place: "",
  weight: "",
  exercises: [emptyEx()],
});

const sheetVolume = (sheet) =>
  sheet.exercises.reduce(
    (t, ex) => t + ex.sets.reduce((u, c) => u + (Number(c.w) || 0) * (Number(c.r) || 0), 0),
    0
  );

// ===========================================================================
// 集計ロジック（モチベ・分析で使用）
// ===========================================================================

// 今日まで続いている連続記録日数（中1日の休みまでは途切れない）
function calcStreak(sheets, today = todayStr()) {
  const days = new Set(sheets.map((s) => s.date));
  if (days.size === 0) return 0;
  const ONE = 86400000;
  const base = new Date(today + "T00:00:00");

  // 起点：今日→昨日→一昨日 の順に、記録のある最初の日を探す
  let cursor = null;
  for (let back = 0; back <= 2; back++) {
    const d = new Date(base.getTime() - back * ONE);
    if (days.has(ymd(d))) { cursor = d; break; }
  }
  if (!cursor) return 0; // 直近3日に記録なし → 連続0

  // 最古の記録日（遡りすぎ防止用）
  const oldest = Math.min(...[...days].map((k) => new Date(k + "T00:00:00").getTime()));

  // 記録日は加算、空き1日は飛び越えて継続、2日連続の空きで終了
  let count = 0, gap = 0;
  let d = cursor;
  while (d.getTime() >= oldest - ONE) {
    if (days.has(ymd(d))) { count++; gap = 0; }
    else { gap++; if (gap >= 2) break; }
    d = new Date(d.getTime() - ONE);
  }
  return count;
}

// 月キー "YYYY-MM"
const monthKey = (dateStr) => dateStr.slice(0, 7);
const thisMonthKey = () => todayStr().slice(0, 7);
const prevMonthKey = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const fmtMonthShort = (ym) => `${Number(ym.slice(5, 7))}月`;

function monthVolume(sheets, ym) {
  return sheets
    .filter((s) => monthKey(s.date) === ym)
    .reduce((t, s) => t + sheetVolume(s), 0);
}

// 直近 n ヶ月の月キー（古い→新しい）
function recentMonths(n) {
  const arr = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    arr.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return arr;
}

// 自己ベスト：種目ごとに最大重量と推定1RM（Epley式）
function personalBests(sheets) {
  const map = {};
  for (const s of sheets) {
    for (const ex of s.exercises) {
      const name = ex.name.trim();
      if (!name) continue;
      for (const c of ex.sets) {
        const w = Number(c.w) || 0;
        const r = Number(c.r) || 0;
        if (w <= 0 || r <= 0) continue;
        const e1rm = w * (1 + r / 30); // Epley
        if (!map[name]) map[name] = { name, maxW: 0, maxWReps: 0, e1rm: 0, date: s.date };
        if (w > map[name].maxW) { map[name].maxW = w; map[name].maxWReps = r; map[name].date = s.date; }
        if (e1rm > map[name].e1rm) map[name].e1rm = e1rm;
      }
    }
  }
  return Object.values(map).sort((a, b) => b.e1rm - a.e1rm);
}

// 体重の推移（直近 limit 件、同じ日は後勝ち、古い→新しい順）
function weightSeries(sheets, limit = 14) {
  const byDate = {};
  for (const s of sheets) {
    const w = Number(s.weight);
    if (w > 0) byDate[s.date] = w;
  }
  return Object.keys(byDate).sort().map((date) => ({ date, w: byDate[date] })).slice(-limit);
}

// 応援メッセージ
function motivationMsg(streak, trainedToday, sessions) {
  if (sessions === 0) return "最初の1枚を書こう。すべてはそこから始まる。";
  if (trainedToday) {
    if (streak >= 7) return `${streak}日連続。もう完全に習慣だ。`;
    if (streak >= 3) return "今日もやった。積み上がってる。";
    return "今日もお疲れさま。えらい。";
  }
  if (streak >= 1) return `連続${streak}日。今日もう1日、積み上げる？`;
  return "間が空いてもいい。今日また始めればリセットされる。";
}

// ===========================================================================
export default function App() {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // sheet object or null
  const [tab, setTab] = useState("home");        // home | analysis | record | calendar | motivation
  const [targetWeight, setTargetWeight] = useState("");

  useEffect(() => {
    load().then((s) => { setSheets(s); setLoading(false); });
    setTargetWeight(loadTarget());
  }, []);

  const changeTarget = (v) => { setTargetWeight(v); saveTarget(v); };

  const persist = (next) => { setSheets(next); save(next); };

  const commit = (sheet) => {
    const exists = sheets.some((s) => s.id === sheet.id);
    const next = exists
      ? sheets.map((s) => (s.id === sheet.id ? sheet : s))
      : [sheet, ...sheets];
    next.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    persist(next);
    setEditing(null);
  };

  const remove = (id) => { persist(sheets.filter((s) => s.id !== id)); setEditing(null); };

  const startNew = () => setEditing(newSheet());
  const open = (s) => setEditing(s);

  // 編集中はタブを隠してフルスクリーン
  if (!loading && editing) {
    return (
      <div style={S.root}>
        <style>{CSS}</style>
        <SheetEditor
          initial={editing}
          onBack={() => setEditing(null)}
          onSave={commit}
          onDelete={remove}
        />
      </div>
    );
  }

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {loading ? (
        <div style={S.empty}>読み込み中…</div>
      ) : (
        <>
          {tab === "home" && <HomeTab sheets={sheets} onNew={startNew} goRecord={() => setTab("record")} goMotivation={() => setTab("motivation")} />}
          {tab === "analysis" && <AnalysisTab sheets={sheets} target={targetWeight} onChangeTarget={changeTarget} />}
          {tab === "record" && <SheetList sheets={sheets} onNew={startNew} onOpen={open} />}
          {tab === "calendar" && <CalendarTab sheets={sheets} onOpen={open} />}
          {tab === "motivation" && <MotivationTab sheets={sheets} />}
          <TabBar tab={tab} setTab={setTab} />
        </>
      )}
    </div>
  );
}

// ---- Bottom Tab Bar --------------------------------------------------------
const TABS = [
  { id: "home", label: "ホーム", Icon: Home },
  { id: "analysis", label: "分析", Icon: BarChart3 },
  { id: "record", label: "記録", Icon: ClipboardList },
  { id: "calendar", label: "カレンダー", Icon: CalendarDays },
  { id: "motivation", label: "モチベ", Icon: Flame },
];

function TabBar({ tab, setTab }) {
  return (
    <nav style={S.tabBar}>
      {TABS.map(({ id, label, Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            className="tabitem"
            style={{ ...S.tabItem, ...(active ? S.tabItemActive : {}) }}
            onClick={() => setTab(id)}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={active ? 2.5 : 2} />
            <span style={S.tabLabel}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---- Home Tab --------------------------------------------------------------
function HomeTab({ sheets, onNew, goRecord, goMotivation }) {
  const streak = useMemo(() => calcStreak(sheets), [sheets]);
  const thisVol = useMemo(() => monthVolume(sheets, thisMonthKey()), [sheets]);
  const sessions = sheets.length;
  const trainedToday = useMemo(() => sheets.some((s) => s.date === todayStr()), [sheets]);

  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <ClipboardList size={24} color={accent} strokeWidth={2.3} />
          <h1 style={S.h1}>IRON LOG</h1>
        </div>
        <p style={S.sub}>厚板ダイエットクラブ。今日も一枚、刻もう。</p>
      </header>

      <main style={S.main}>
        {/* 今日のステータス */}
        <div style={S.todayCard}>
          <span style={S.todayLabel}>{fmtDate(todayStr())}</span>
          <span style={S.todayStatus}>
            {trainedToday ? "今日はもう記録済み。お疲れさま。" : "今日はまだ記録がありません。"}
          </span>
          <button className="primary" style={S.primaryBtn} onClick={onNew}>
            <Plus size={20} strokeWidth={2.6} /> 今日の記録をはじめる
          </button>
        </div>

        {/* スタッツ3枚 */}
        <div style={S.statRow}>
          <button className="stattile" style={S.statTile} onClick={goMotivation}>
            <Flame size={18} color={accent} />
            <span style={S.statNum}>{streak}</span>
            <span style={S.statLbl}>連続日数</span>
          </button>
          <button className="stattile" style={S.statTile} onClick={goRecord}>
            <ClipboardList size={18} color={accent} />
            <span style={S.statNum}>{sessions}</span>
            <span style={S.statLbl}>総セッション</span>
          </button>
          <div style={S.statTile}>
            <BarChart3 size={18} color={accent} />
            <span style={{ ...S.statNum, fontSize: 20 }}>{thisVol.toLocaleString()}</span>
            <span style={S.statLbl}>今月のkg</span>
          </div>
        </div>

        {/* 直近の記録 */}
        <h2 style={S.sectionTitle}>最近の記録</h2>
        {sheets.length === 0 ? (
          <div style={S.empty}>まだ記録がありません。<br />最初の1枚を書きにいこう。</div>
        ) : (
          sheets.slice(0, 3).map((s) => <RecentRow key={s.id} sheet={s} onClick={goRecord} />)
        )}
      </main>
    </>
  );
}

function RecentRow({ sheet, onClick }) {
  const filled = sheet.exercises.filter((e) => e.name.trim()).length;
  return (
    <button className="sheetcard" style={S.recentRow} onClick={onClick}>
      <span style={S.scPart}>{sheet.part}</span>
      <span style={S.recentDate}>{fmtShort(sheet.date)}</span>
      <span style={S.recentMeta}>{filled}種目</span>
      <span style={S.recentVol}>{sheetVolume(sheet).toLocaleString()} kg</span>
      <ChevronRight size={16} color={inkFaint} />
    </button>
  );
}

// ---- Analysis Tab ----------------------------------------------------------
function AnalysisTab({ sheets, target, onChangeTarget }) {
  const tm = thisMonthKey();
  const pm = prevMonthKey(tm);
  const thisVol = useMemo(() => monthVolume(sheets, tm), [sheets, tm]);
  const prevVol = useMemo(() => monthVolume(sheets, pm), [sheets, pm]);

  const diff = thisVol - prevVol;
  const pct = prevVol > 0 ? Math.round((diff / prevVol) * 100) : null;
  const up = diff >= 0;

  const months = useMemo(() => recentMonths(6), []);
  const series = useMemo(
    () => months.map((m) => ({ m, v: monthVolume(sheets, m) })),
    [sheets, months]
  );
  const max = Math.max(1, ...series.map((d) => d.v));
  const wseries = useMemo(() => weightSeries(sheets), [sheets]);

  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <BarChart3 size={22} color={accent} strokeWidth={2.3} />
          <h1 style={S.h1}>分析</h1>
        </div>
        <p style={S.sub}>積み上げたボリュームを振り返る。</p>
      </header>

      <main style={S.main}>
        {/* 今月の総ボリューム + 前月比 */}
        <div style={S.bigCard}>
          <span style={S.bigLabel}>今月の総ボリューム</span>
          <span style={S.bigNum}>{thisVol.toLocaleString()}<span style={S.bigUnit}> kg</span></span>
          <div style={{ ...S.diffBadge, color: up ? "#5FD08A" : "#E06C5A", background: up ? "rgba(95,208,138,.12)" : "rgba(224,108,90,.12)" }}>
            {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            {pct === null
              ? "前月の記録なし"
              : `前月比 ${up ? "+" : ""}${pct}%（${up ? "+" : ""}${diff.toLocaleString()} kg）`}
          </div>
        </div>

        {/* 6ヶ月グラフ */}
        <h2 style={S.sectionTitle}>月別ボリューム（直近6ヶ月）</h2>
        <div style={S.chartCard}>
          <div style={S.chart}>
            {series.map(({ m, v }) => {
              const h = (v / max) * 100;
              const isThis = m === tm;
              return (
                <div key={m} style={S.chartCol}>
                  <span style={S.chartVal}>{v > 0 ? Math.round(v / 1000) + "k" : ""}</span>
                  <div style={S.chartBarTrack}>
                    <div
                      style={{
                        ...S.chartBar,
                        height: `${Math.max(v > 0 ? 4 : 0, h)}%`,
                        background: isThis ? accent : "#3A3F49",
                      }}
                    />
                  </div>
                  <span style={{ ...S.chartXLabel, color: isThis ? accent : inkFaint }}>
                    {fmtMonthShort(m)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 体重の推移 */}
        <h2 style={S.sectionTitle}>体重の推移</h2>
        <div style={S.chartCard}>
          <div style={S.targetRow}>
            <span style={S.targetLabel}>目標体重</span>
            <input type="number" inputMode="decimal" style={S.targetInput}
              value={target ?? ""} onChange={(e) => onChangeTarget(e.target.value)}
              placeholder="未設定" />
            <span style={S.targetUnit}>kg</span>
          </div>
          <WeightChart data={wseries} target={Number(target) || 0} />
        </div>

        {sheets.length === 0 && (
          <div style={S.empty}>記録がたまると、ここにグラフが育っていきます。</div>
        )}
      </main>
    </>
  );
}

// ---- Weight line chart (自前SVG) -------------------------------------------
function WeightChart({ data, target = 0 }) {
  if (data.length === 0) {
    return <div style={S.empty}>体重を入力すると、<br />ここに推移グラフが出ます。</div>;
  }
  const W = 320, H = 150, padL = 34, padR = 12, padTop = 16, padBot = 26;
  const ws = data.map((d) => d.w);
  const pool = target > 0 ? [...ws, target] : ws; // 目標も範囲に含めて線を見せる
  let min = Math.min(...pool), max = Math.max(...pool);
  if (max - min < 1) { min -= 1; max += 1; }
  const range = max - min;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBot;
  const X = (i) => data.length === 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW;
  const Y = (w) => padTop + (1 - (w - min) / range) * innerH;
  const line = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.w).toFixed(1)}`).join(" ");
  const first = data[0], latest = data[data.length - 1];
  const diff = +(latest.w - first.w).toFixed(1);
  const dirUp = diff > 0;
  const mmLabel = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const toGo = target > 0 ? +(latest.w - target).toFixed(1) : null; // +なら目標まで減らす
  const reached = toGo !== null && toGo <= 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: accentBright, lineHeight: 1 }}>
          {latest.w}<span style={{ fontSize: 14, fontWeight: 800, color: inkSoft }}> kg</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: inkSoft }}>最新</span>
        {toGo !== null && (
          <span style={{ fontSize: 12.5, fontWeight: 800, color: reached ? "#5FD08A" : accent }}>
            {reached ? "目標達成！" : `目標まであと ${Math.abs(toGo)} kg`}
          </span>
        )}
        {data.length > 1 && (
          <span style={{
            marginLeft: "auto", fontSize: 12.5, fontWeight: 800,
            color: diff === 0 ? inkSoft : dirUp ? "#E06C5A" : "#5FD08A",
          }}>
            最初から {dirUp ? "+" : ""}{diff} kg
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <text x={padL - 6} y={Y(max) + 4} textAnchor="end" fontSize="10" fill={inkFaint}>{Math.round(max)}</text>
        <text x={padL - 6} y={Y(min) + 4} textAnchor="end" fontSize="10" fill={inkFaint}>{Math.round(min)}</text>
        <line x1={padL} y1={Y(max)} x2={W - padR} y2={Y(max)} stroke={border} strokeWidth="1" strokeDasharray="3 3" />
        <line x1={padL} y1={Y(min)} x2={W - padR} y2={Y(min)} stroke={border} strokeWidth="1" strokeDasharray="3 3" />
        {target > 0 && (
          <>
            <line x1={padL} y1={Y(target)} x2={W - padR} y2={Y(target)} stroke="#5FD08A" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={W - padR} y={Y(target) - 4} textAnchor="end" fontSize="10" fontWeight="700" fill="#5FD08A">目標 {target}</text>
          </>
        )}
        {data.length > 1 && (
          <polyline points={line} fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {data.map((d, i) => (
          <circle key={i} cx={X(i)} cy={Y(d.w)} r={i === data.length - 1 ? 4 : 3}
            fill={i === data.length - 1 ? accentBright : accent} />
        ))}
        <text x={X(0)} y={H - 8} textAnchor="start" fontSize="10" fill={inkFaint}>{mmLabel(first.date)}</text>
        {data.length > 1 && (
          <text x={X(data.length - 1)} y={H - 8} textAnchor="end" fontSize="10" fill={inkFaint}>{mmLabel(latest.date)}</text>
        )}
      </svg>
    </div>
  );
}

// ---- Calendar Tab ----------------------------------------------------------
function CalendarTab({ sheets, onOpen }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  // 日付 -> その日のシート配列
  const byDate = useMemo(() => {
    const m = {};
    for (const s of sheets) (m[s.date] ||= []).push(s);
    return m;
  }, [sheets]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-11
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const recordedThisMonth = Object.keys(byDate).filter(
    (k) => Number(k.slice(0, 4)) === year && Number(k.slice(5, 7)) === month + 1
  ).length;

  const go = (delta) => {
    const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setCursor(d);
  };

  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <CalendarDays size={22} color={accent} strokeWidth={2.3} />
          <h1 style={S.h1}>カレンダー</h1>
        </div>
        <p style={S.sub}>やった日が、地図になる。</p>
      </header>

      <main style={S.main}>
        <div style={S.calNav}>
          <button className="iconbtn" style={S.calNavBtn} onClick={() => go(-1)} aria-label="前の月">
            <ChevronLeft size={20} />
          </button>
          <span style={S.calTitle}>{year}年 {month + 1}月</span>
          <button className="iconbtn" style={S.calNavBtn} onClick={() => go(1)} aria-label="次の月">
            <ChevronRight size={20} />
          </button>
        </div>
        <div style={S.calCount}>この月の記録：{recordedThisMonth}日</div>

        <div style={S.calGrid}>
          {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
            <div key={w} style={{ ...S.calDow, color: i === 0 ? "#E06C5A" : i === 6 ? "#6FA8DC" : inkSoft }}>{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} style={S.calCell} />;
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const recs = byDate[ds];
            const isToday = ds === todayStr();
            return (
              <button
                key={ds}
                className={recs ? "calday" : ""}
                style={{
                  ...S.calCell,
                  ...S.calDay,
                  ...(recs ? S.calDayDone : {}),
                  ...(isToday ? S.calDayToday : {}),
                  cursor: recs ? "pointer" : "default",
                }}
                onClick={() => recs && onOpen(recs[0])}
                disabled={!recs}
              >
                <span style={S.calDayNum}>{d}</span>
                {recs && <span style={S.calDot} />}
              </button>
            );
          })}
        </div>
      </main>
    </>
  );
}

// ---- Motivation Tab --------------------------------------------------------
function MotivationTab({ sheets }) {
  const streak = useMemo(() => calcStreak(sheets), [sheets]);
  const sessions = sheets.length;
  const trainedToday = useMemo(() => sheets.some((s) => s.date === todayStr()), [sheets]);
  const bests = useMemo(() => personalBests(sheets), [sheets]);
  const msg = motivationMsg(streak, trainedToday, sessions);

  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <Flame size={22} color={accent} strokeWidth={2.3} />
          <h1 style={S.h1}>モチベーション</h1>
        </div>
        <p style={S.sub}>続けてることは、ちゃんと残ってる。</p>
      </header>

      <main style={S.main}>
        {/* 連続記録日数 */}
        <div style={S.streakCard}>
          <Flame size={34} color={accent} strokeWidth={2.2} />
          <div style={S.streakNumWrap}>
            <span style={S.streakNum}>{streak}</span>
            <span style={S.streakUnit}>日連続</span>
          </div>
          <span style={S.streakSub}>
            {streak === 0 ? "今日からまた積み上げよう" : trainedToday ? "今日もクリア" : "今日やれば、まだ伸ばせる"}
          </span>
        </div>

        {/* 応援メッセージ */}
        <div style={S.msgCard}>
          <span style={S.msgQuote}>“</span>
          <span style={S.msgText}>{msg}</span>
        </div>

        {/* 自己ベスト */}
        <h2 style={S.sectionTitle}><Trophy size={16} color={accent} style={{ verticalAlign: "-2px", marginRight: 6 }} />自己ベスト</h2>
        {bests.length === 0 ? (
          <div style={S.empty}>種目名・重量・回数を記録すると、<br />ここに自己ベストが並びます。</div>
        ) : (
          <div style={S.bestList}>
            {bests.slice(0, 8).map((b, i) => (
              <div key={b.name} style={S.bestRow}>
                <span style={S.bestRank}>{i + 1}</span>
                <div style={S.bestInfo}>
                  <span style={S.bestName}>{b.name}</span>
                  <span style={S.bestSub}>最高 {b.maxW}kg × {b.maxWReps}回</span>
                </div>
                <div style={S.bestRm}>
                  <span style={S.bestRmNum}>{Math.round(b.e1rm)}</span>
                  <span style={S.bestRmLbl}>推定1RM</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={S.bestNote}>※ 推定1RM＝重量×(1+回数÷30)（Epley式）。実測ではなく目安です。</p>
      </main>
    </>
  );
}

// ---- List ------------------------------------------------------------------
function SheetList({ sheets, onNew, onOpen }) {
  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <ClipboardList size={24} color={accent} strokeWidth={2.3} />
          <h1 style={S.h1}>トレーニング記録</h1>
        </div>
        <p style={S.sub}>厚板ダイエットクラブ。部位ごとに、その日の重さを刻む。</p>
      </header>

      <main style={S.main}>
        <button className="primary" style={S.primaryBtn} onClick={onNew}>
          <Plus size={20} strokeWidth={2.6} /> 今日の記録をはじめる　やるぞー！
        </button>

        {sheets.length === 0 ? (
          <div style={S.empty}>まだ記録がありません。<br />最初の1枚を書きにいこう。</div>
        ) : (
          sheets.map((s) => {
            const filled = s.exercises.filter((e) => e.name.trim()).length;
            return (
              <button key={s.id} className="sheetcard" style={S.sheetCard} onClick={() => onOpen(s)}>
                <div style={S.scTop}>
                  <span style={S.scPart}>{s.part}</span>
                  <span style={S.scDate}>{fmtShort(s.date)}</span>
                </div>
                <div style={S.scMeta}>
                  <span>{filled} 種目</span>
                  <span style={S.scDot}>・</span>
                  <span style={S.scVol}>{sheetVolume(s).toLocaleString()} kg</span>
                  {s.place && <><span style={S.scDot}>・</span><span>{s.place}</span></>}
                </div>
                {s.goal && <div style={S.scGoal}>目標：{s.goal}</div>}
              </button>
            );
          })
        )}
      </main>
    </>
  );
}

// ---- Rest Timer ------------------------------------------------------------
// Alarm + tick sounds via WebAudio (no external assets).
function useAlarm() {
  const ctxRef = useRef(null);

  const getCtx = useCallback(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = ctxRef.current || (ctxRef.current = new Ctx());
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }, []);

  // Call on a user gesture (timer start) so audio is unlocked for later playback.
  const prime = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    // silent blip to satisfy autoplay policies
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.01);
  }, [getCtx]);

  // One short beep at a given time/frequency.
  const tone = useCallback((ctx, at, freq, dur, peak) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at); o.stop(at + dur + 0.02);
  }, []);

  // Completion alarm: several loud beep clusters so it's hard to miss in a gym.
  const alarm = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // 4 clusters, each 3 rising beeps
    for (let cl = 0; cl < 4; cl++) {
      const base = t0 + cl * 0.6;
      tone(ctx, base, 880, 0.13, 0.6);
      tone(ctx, base + 0.16, 1100, 0.13, 0.6);
      tone(ctx, base + 0.32, 1320, 0.18, 0.65);
    }
  }, [getCtx, tone]);

  return { alarm, prime };
}

function useRestTimer() {
  const [total, setTotal] = useState(0);   // seconds the timer was started with
  const [left, setLeft] = useState(0);      // seconds remaining
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const deadlineRef = useRef(0);
  const { alarm, prime } = useAlarm();
  const firedRef = useRef(false);

  const start = useCallback((seconds, exLabel) => {
    prime(); // unlock audio on this user gesture
    setTotal(seconds);
    setLeft(seconds);
    setLabel(exLabel || "");
    setOpen(true);
    setRunning(true);
    firedRef.current = false;
    deadlineRef.current = Date.now() + seconds * 1000;
  }, [prime]);

  const pause = useCallback(() => {
    setRunning(false);
  }, []);

  const resume = useCallback(() => {
    setRunning((r) => {
      if (r) return r;
      deadlineRef.current = Date.now() + left * 1000;
      return true;
    });
  }, [left]);

  const reset = useCallback(() => {
    setLeft(total);
    setRunning(false);
    firedRef.current = false;
  }, [total]);

  const add = useCallback((delta) => {
    setLeft((l) => {
      const nl = Math.max(0, l + delta);
      if (running) deadlineRef.current = Date.now() + nl * 1000;
      firedRef.current = nl > 0 ? false : firedRef.current;
      return nl;
    });
  }, [running]);

  const close = useCallback(() => { setOpen(false); setRunning(false); }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const rem = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setLeft(rem);
      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        setRunning(false);
        alarm();
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, alarm]);

  return { total, left, running, open, label, start, pause, resume, reset, add, close, alarm };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---- Affiliate (休憩中に表示する広告) --------------------------------------
// ▼ ここをあなたのアフィリエイトリンクに差し替えてください。
//   url   … 各ASP(Amazon/楽天/A8/もしも等)で発行した「あなた専用リンク」
//   img   … 商品画像URL（各ASPの規約に沿ったものを使用）
//   tag   … カード左上の小ラベル
//   match … この商品を出したい種目名のキーワード（部分一致）。
//           空配列 [] のものは「どの種目でも出せる汎用商品」として扱われます。
const AD_PRODUCTS = [
  {
    id: "grip",
    tag: "ギア",
    name: "ALLOUT パワーグリップ プロ",
    note: "ベンチ・デッドの握力サポートに",
    price: "¥2,980",
    img: "https://m.media-amazon.com/images/I/71mH4T1p9eL._AC_UL320_.jpg",
    url: "https://amzn.to/3QMX8Kl",
    match: ["ベンチ", "デッド", "ベントオーバー", "ラットプル", "懸垂", "ロウ"],
  },
  {
    id: "belt",
    tag: "ギア",
    name: "トレーニングベルト",
    note: "スクワット・デッドの腰を守る",
    price: "¥２,990",
    img: "https://m.media-amazon.com/images/I/81MdajZiKrL._AC_UL640_QL65_.jpg",
    url: "https://amzn.to/4ge89Pl",
    match: ["スクワット", "デッド", "ショルダープレス", "レッグプレス"],
  },
  {
    id: "strap",
    tag: "ギア",
    name: "ゴールドジム(GOLD'S GYM) 耐久性 元祖リストストラップ",
    note: "懸垂・ラットプルの引く力に",
    price: "¥1,980",
    img: "https://m.media-amazon.com/images/I/71Qab6cZ9eL._AC_UL320_.jpg",
    url: "https://example.com/your-affiliate-link-strap",
    match: ["懸垂", "ラットプル", "デッド", "ロウ", "シュラッグ"],
  },
  {
    id: "sleeve",
    tag: "ギア",
    name: "ニースリーブ",
    note: "スクワットで膝をサポート",
    price: "¥５,980",
    img: "https://m.media-amazon.com/images/I/71e5UWYYYyL._AC_UL640_QL65_.jpg",
    url: "https://amzn.to/4fVrxAq",
    match: ["スクワット", "レッグ", "ランジ"],
  },
  {
    id: "protein",
    tag: "プロテイン",
    name: "ホエイエクスプロージョン プロテイン 3kgプロテイン 1kg",
    note: "トレ後30分のゴールデンタイムに",
    price: "¥11,780",
    img: "https://m.media-amazon.com/images/I/71hE82611-L._AC_UL320_.jpg",
    url: "https://amzn.to/4oDwkc1",
    match: [], // 汎用
  },
  {
    id: "eaa",
    tag: "EAA",
    name: "EAA 必須アミノ酸",
    note: "ジャックス JAKS EAA 600g EAA8,500mg配合",
    price: "¥3,480",
    img: "https://m.media-amazon.com/images/I/71EsFJbFLwL._AC_UL320_.jpg",
    url: "https://amzn.to/4uGhBhL",
    match: [], // 汎用
  },

];

// クリック数を控えめに記録（後で人気商品が分かる）
async function logAdClick(id) {
  try {
    const k = "ad:clicks";
    const raw = localStorage.getItem(k);
    const map = raw ? JSON.parse(raw) : {};
    map[id] = (map[id] || 0) + 1;
    localStorage.setItem(k, JSON.stringify(map));
  } catch { /* 記録に失敗しても表示は妨げない */ }
}

// 種目名に合う商品を優先して1つ選ぶ。
// 1) 種目名にキーワードが一致する商品があればその中からランダム
// 2) 無ければ汎用商品(match:[])からランダム
// 3) それも無ければ全商品からランダム
function pickAd(exerciseName = "") {
  const name = exerciseName || "";
  const matched = AD_PRODUCTS.filter(
    (p) => p.match.length > 0 && p.match.some((kw) => name.includes(kw))
  );
  const pool = matched.length > 0
    ? matched
    : AD_PRODUCTS.filter((p) => p.match.length === 0);
  const fallback = pool.length > 0 ? pool : AD_PRODUCTS;
  return fallback[Math.floor(Math.random() * fallback.length)];
}

function RestAdCard({ product, onClose }) {
  if (!product) return null;
  return (
    <div style={S.adCard}>
      <div style={S.adHead}>
        <span style={S.adPr}>PR</span>
        <span style={S.adTag}>休憩中におすすめ</span>
        <button style={S.adClose} onClick={onClose} aria-label="広告を閉じる"><X size={15} /></button>
      </div>
      <a
        href={product.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        onClick={() => logAdClick(product.id)}
        style={S.adBody}
        className="adbody"
      >
        <div style={S.adThumb}>
          {product.img
            ? <img src={product.img} alt="" style={S.adImg} />
            : <span style={S.adThumbText}>{product.tag}</span>}
        </div>
        <div style={S.adInfo}>
          <span style={S.adName}>{product.name}</span>
          <span style={S.adNote}>{product.note}</span>
          <span style={S.adPrice}>{product.price}</span>
        </div>
        <span style={S.adCta}>見る</span>
      </a>
    </div>
  );
}

// ---- Rest timer bar --------------------------------------------------------
function RestTimerBar({ t }) {
  const [ad, setAd] = useState(null);
  const [adClosed, setAdClosed] = useState(false);

  // 休憩を開始するたびに、その種目に合う広告を選び直す
  useEffect(() => {
    if (t.open && t.running) {
      setAd(pickAd(t.label));
      setAdClosed(false);
    }
  }, [t.open, t.total]); // 休憩開始（total がセットされる）でリフレッシュ

  if (!t.open) return null;
  const done = t.left <= 0;
  const pct = t.total > 0 ? (t.left / t.total) * 100 : 0;
  // 広告は「休憩中（カウントダウン中）」だけ。終わったら引っ込めて記録に集中させる
  const showAd = !done && !adClosed && ad;

  return (
    <div style={S.timerWrap}>
      {showAd && <RestAdCard product={ad} onClose={() => setAdClosed(true)} />}
      <div style={S.timerCard}>
        <div style={{ ...S.timerProgress, width: `${pct}%`, background: done ? accent : "#3A3F49" }} />
        <div style={S.timerInner}>
          <div style={S.timerLeftCol}>
            <span style={S.timerLabel}>{done ? "休憩おわり" : "休憩中"}{t.label ? ` ・ ${t.label}` : ""}</span>
            <span style={{ ...S.timerClock, color: done ? accent : ink }}>{mmss(t.left)}</span>
          </div>
          <div style={S.timerBtns}>
            <button className="tbtn" style={S.tBtn} onClick={() => t.add(-15)} aria-label="15秒減らす">-15</button>
            <button className="tbtn" style={S.tBtn} onClick={() => t.add(15)} aria-label="15秒増やす">+15</button>
            {t.running ? (
              <button className="tbtn" style={S.tMain} onClick={t.pause} aria-label="一時停止"><Pause size={18} /></button>
            ) : done ? (
              <>
                <button className="tbtn" style={S.tBtn} onClick={t.reset} aria-label="リセット"><RotateCcw size={16} /></button>
                <button className="tbtn" style={S.tMain} onClick={t.alarm} aria-label="もう一度鳴らす"><Play size={18} /></button>
              </>
            ) : (
              <button className="tbtn" style={S.tMain} onClick={t.resume} aria-label="再開"><Play size={18} /></button>
            )}
            <button className="tbtn" style={S.tClose} onClick={t.close} aria-label="閉じる"><X size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Editor ----------------------------------------------------------------
function SheetEditor({ initial, onBack, onSave, onDelete }) {
  const [sheet, setSheet] = useState(initial);
  const set = (k, v) => setSheet((s) => ({ ...s, [k]: v }));

  const setEx = (i, k, v) =>
    setSheet((s) => ({
      ...s,
      exercises: s.exercises.map((e, j) => (j === i ? { ...e, [k]: v } : e)),
    }));

  const setCell = (ei, si, k, v) =>
    setSheet((s) => ({
      ...s,
      exercises: s.exercises.map((e, j) =>
        j === ei
          ? { ...e, sets: e.sets.map((c, m) => (m === si ? { ...c, [k]: v } : c)) }
          : e
      ),
    }));

  const addEx = () =>
    setSheet((s) =>
      s.exercises.length >= MAX_EX ? s : { ...s, exercises: [...s.exercises, emptyEx()] }
    );

  const delEx = (i) =>
    setSheet((s) => ({
      ...s,
      exercises: s.exercises.length > 1 ? s.exercises.filter((_, j) => j !== i) : s.exercises,
    }));

  const vol = useMemo(() => sheetVolume(sheet), [sheet]);
  const timer = useRestTimer();

  return (
    <>
      <header style={S.editHeader}>
        <button onClick={onBack} className="iconbtn" style={S.backBtn} aria-label="戻る">
          <ChevronLeft size={22} />
        </button>
        <span style={S.editTitle}>記録シート</span>
        <button onClick={() => onSave(sheet)} className="primary" style={S.saveBtn}>
          <Save size={16} /> 保存
        </button>
      </header>

      <main style={S.main}>
        {/* meta block — mirrors the paper header */}
        <div style={S.metaCard}>
          <div style={S.partTab}>
            <span style={S.partTabLabel}>部位</span>
            <div style={S.partChips}>
              {PARTS.map((p) => (
                <button
                  key={p}
                  className="chip"
                  style={{ ...S.chip, ...(sheet.part === p ? S.chipActive : {}) }}
                  onClick={() => set("part", p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <Field label="今日の目標">
            <input style={S.input} value={sheet.goal}
              onChange={(e) => set("goal", e.target.value)}
              placeholder="例：ベンチ80kgを5回" />
          </Field>

          <Field label="日付">
            <input type="date" style={S.input} value={sheet.date}
              onChange={(e) => set("date", e.target.value)} />
            <div style={S.dateEcho}>{fmtDate(sheet.date)}</div>
          </Field>

          <div style={S.row2}>
            <Field label="時間">
              <div style={S.timeRow}>
                <input type="time" style={S.timeInput} value={sheet.start}
                  onChange={(e) => set("start", e.target.value)} />
                <span style={S.tilde}>〜</span>
                <input type="time" style={S.timeInput} value={sheet.end}
                  onChange={(e) => set("end", e.target.value)} />
              </div>
            </Field>
            <Field label="場所">
              <input style={S.input} value={sheet.place}
                onChange={(e) => set("place", e.target.value)}
                placeholder="例：市民ジム" />
            </Field>
          </div>

          <Field label="体重 (kg)">
            <input type="number" inputMode="decimal" style={S.input}
              value={sheet.weight ?? ""}
              onChange={(e) => set("weight", e.target.value)}
              placeholder="例：72.5" />
          </Field>
        </div>

        {/* exercise grid — one block per 種目, columns = sets */}
        {sheet.exercises.map((ex, ei) => (
          <div key={ei} style={S.exCard}>
            <div style={S.exHead}>
              <span style={S.exNum}>{ei + 1}</span>
              <input
                style={S.exName}
                value={ex.name}
                onChange={(e) => setEx(ei, "name", e.target.value)}
                placeholder="種目名"
              />
              <button onClick={() => delEx(ei)} className="iconbtn" style={S.exDel} aria-label="種目を削除">
                <Trash2 size={16} />
              </button>
            </div>

            <div style={S.restRow}>
              <Timer size={15} color="#A8A498" />
              <span style={S.restLabel}>セット間の休憩</span>
              <div style={S.restChips}>
                {[60, 90, 120, 180].map((sec) => (
                  <button
                    key={sec}
                    className="restchip"
                    style={{ ...S.restChip, ...(ex.rest === sec ? S.restChipActive : {}) }}
                    onClick={() => setEx(ei, "rest", sec)}
                  >
                    {sec < 60 ? `${sec}秒` : `${sec / 60}分`}
                  </button>
                ))}
              </div>
              <button
                className="reststart"
                style={S.restStart}
                onClick={() => timer.start(ex.rest, ex.name || `種目${ei + 1}`)}
              >
                <Play size={13} strokeWidth={2.6} /> 休憩開始
              </button>
            </div>

            <div style={S.setGrid}>
              {ex.sets.map((c, si) => (
                <div key={si} style={S.setBox}>
                  <button
                    className="setlbl"
                    style={S.setBoxLbl}
                    onClick={() => timer.start(ex.rest, ex.name || `種目${ei + 1}`)}
                    title="このセット後の休憩を開始"
                  >
                    {si + 1}set
                  </button>
                  <div style={S.cellRow}>
                    <input
                      style={S.cellInput} type="number" inputMode="decimal"
                      value={c.w} onChange={(e) => setCell(ei, si, "w", e.target.value)}
                      placeholder="kg" />
                    <span style={S.cellX}>×</span>
                    <input
                      style={S.cellInput} type="number" inputMode="numeric"
                      value={c.r} onChange={(e) => setCell(ei, si, "r", e.target.value)}
                      placeholder="回" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {sheet.exercises.length < MAX_EX && (
          <button onClick={addEx} className="addex" style={S.addExBtn}>
            <Plus size={17} /> 種目を追加（{sheet.exercises.length}/{MAX_EX}）
          </button>
        )}

        <div style={S.volBar}>
          <span>総ボリューム</span>
          <span style={S.volNum}>{vol.toLocaleString()} kg</span>
        </div>

        <button onClick={() => onDelete(sheet.id)} className="delsheet" style={S.delSheetBtn}>
          このシートを削除
        </button>
      </main>

      <RestTimerBar t={timer} />
    </>
  );
}

function Field({ label, children }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

// ---- Styles ----------------------------------------------------------------
const CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
.primary, .iconbtn, .chip, .sheetcard, .addex, .delsheet, .tabitem, .stattile { transition: filter .12s, background .12s, transform .08s, color .12s, border-color .12s; }
.primary:hover { filter: brightness(1.07); }
.primary:active { transform: scale(.985); }
.sheetcard:hover { border-color: #3A3F49 !important; }
.sheetcard:active { transform: scale(.99); }
.stattile:hover { border-color: #3A3F49 !important; }
.chip:hover { border-color: #FF6B3D !important; }
.addex:hover { border-color: #FF6B3D !important; color: #FF6B3D !important; }
.iconbtn:hover { color: #FF6B3D !important; }
.delsheet:hover { color: #C0392B !important; }
.restchip:hover { border-color: #FF6B3D !important; }
.reststart:hover { filter: brightness(1.08); }
.setlbl:hover { background: #2A2E36 !important; color: #FF6B3D !important; }
.tbtn:hover { border-color: #FF6B3D !important; }
.tabitem:active { transform: scale(.94); }
.calday:hover { border-color: #FF6B3D !important; }
.adbody:hover { background: #23262E; }
input::placeholder { color: #6F6B61; }
input:focus-visible, button:focus-visible { outline: 2px solid #FF6B3D; outline-offset: 2px; }
input[type=number]::-webkit-outer-spin-button,
input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
input[type=number] { -moz-appearance: textfield; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

// ---- Dark palette ----------------------------------------------------------
const accent = "#FF6B3D";       // orange accent (kept, slightly brighter for dark bg)
const accentBright = "#FF8B5E"; // emphasis numerals
const bg = "#15171C";           // page background
const surface = "#1E2128";      // cards / blocks
const surfaceAlt = "#262A33";   // header strips inside cards
const surfaceInput = "#0F1115"; // input fields
const border = "#33373F";       // strong borders / frame
const borderSoft = "#2A2E36";   // subtle dividers
const ink = "#ECEAE4";          // primary text
const inkSoft = "#A8A498";      // secondary text
const inkFaint = "#6F6B61";     // tertiary / placeholders

// legacy aliases mapped onto the dark tokens so existing styles keep working
const paper = bg;
const line = border;

const S = {
  root: {
    minHeight: "100vh", background: paper, color: ink,
    fontFamily: "'Noto Sans JP', system-ui, sans-serif",
    maxWidth: 460, margin: "0 auto", paddingBottom: 40,
  },
  header: { padding: "26px 20px 16px" },
  headTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  brandRow: { display: "flex", alignItems: "center", gap: 10 },
  logoutBtn: {
    display: "flex", alignItems: "center", gap: 5, padding: "6px 11px",
    borderRadius: 4, border: "1px solid #33373F", background: "transparent",
    color: "#A8A498", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    flexShrink: 0,
  },
  acct: { margin: "6px 0 0", fontSize: 11.5, color: "#6F6B61", fontWeight: 600 },
  h1: { margin: 0, fontSize: 21, fontWeight: 900, letterSpacing: "0.04em" },
  sub: { margin: "8px 0 0", fontSize: 12.5, color: inkSoft, lineHeight: 1.6 },

  main: { padding: "0 16px 96px" },

  primaryBtn: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 15, border: "none", borderRadius: 4, background: accent,
    color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer",
    marginBottom: 18, fontFamily: "inherit", letterSpacing: "0.03em",
  },
  empty: { textAlign: "center", color: inkFaint, padding: "40px 20px", lineHeight: 1.8, fontSize: 14 },

  sectionTitle: {
    fontSize: 13, fontWeight: 800, color: inkSoft, letterSpacing: "0.05em",
    margin: "22px 0 10px",
  },

  // --- Home ---
  todayCard: {
    background: surface, border: `1.5px solid ${line}`, borderRadius: 8,
    padding: 18, marginTop: 16, marginBottom: 16,
    display: "flex", flexDirection: "column", gap: 6,
    boxShadow: "0 2px 8px rgba(0,0,0,.35)",
  },
  todayLabel: { fontSize: 12, fontWeight: 700, color: inkSoft },
  todayStatus: { fontSize: 15, fontWeight: 700, color: ink, marginBottom: 8 },
  statRow: { display: "flex", gap: 10, marginBottom: 4 },
  statTile: {
    flex: 1, background: surface, border: `1px solid ${borderSoft}`, borderRadius: 8,
    padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center",
    gap: 4, cursor: "pointer", fontFamily: "inherit",
  },
  statNum: { fontSize: 24, fontWeight: 900, color: ink, lineHeight: 1.1 },
  statLbl: { fontSize: 11, fontWeight: 700, color: inkSoft },
  recentRow: {
    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    background: surface, border: `1px solid ${borderSoft}`, borderRadius: 6,
    padding: "11px 13px", marginBottom: 8, cursor: "pointer", fontFamily: "inherit",
  },
  recentDate: { fontSize: 14, fontWeight: 700, color: ink },
  recentMeta: { fontSize: 12, color: inkSoft },
  recentVol: { marginLeft: "auto", fontSize: 13, fontWeight: 800, color: accent },

  // --- Analysis ---
  bigCard: {
    background: surface, border: `1.5px solid ${line}`, borderRadius: 8,
    padding: 20, marginTop: 16, display: "flex", flexDirection: "column", gap: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,.35)",
  },
  bigLabel: { fontSize: 12.5, fontWeight: 700, color: inkSoft },
  bigNum: { fontSize: 40, fontWeight: 900, color: accentBright, lineHeight: 1, letterSpacing: "0.01em" },
  bigUnit: { fontSize: 18, fontWeight: 800, color: inkSoft },
  diffBadge: {
    alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5,
    padding: "5px 11px", borderRadius: 20, fontSize: 12.5, fontWeight: 800, marginTop: 2,
  },
  chartCard: {
    background: surface, border: `1px solid ${borderSoft}`, borderRadius: 8, padding: "18px 12px 10px",
  },
  chart: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6, height: 160 },
  chartCol: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%" },
  chartVal: { fontSize: 10.5, fontWeight: 700, color: inkSoft, height: 14 },
  chartBarTrack: { flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" },
  chartBar: { width: "70%", maxWidth: 34, borderRadius: "4px 4px 0 0", transition: "height .4s ease" },
  chartXLabel: { fontSize: 11, fontWeight: 700 },

  targetRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  targetLabel: { fontSize: 12.5, fontWeight: 800, color: inkSoft },
  targetInput: {
    width: 90, padding: "7px 10px", borderRadius: 6, border: `1px solid ${border}`,
    background: surfaceInput, color: ink, fontSize: 15, fontWeight: 700, fontFamily: "inherit",
  },
  targetUnit: { fontSize: 13, fontWeight: 700, color: inkSoft },

  // --- Calendar ---
  calNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 4 },
  calNavBtn: { background: surface, border: `1px solid ${borderSoft}`, borderRadius: 6, color: ink, cursor: "pointer", padding: 7, display: "flex" },
  calTitle: { fontSize: 17, fontWeight: 900, letterSpacing: "0.03em" },
  calCount: { fontSize: 12, fontWeight: 700, color: inkSoft, textAlign: "center", marginBottom: 12 },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 },
  calDow: { textAlign: "center", fontSize: 11, fontWeight: 800, padding: "2px 0" },
  calCell: { aspectRatio: "1 / 1" },
  calDay: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3, background: surface, border: `1px solid ${borderSoft}`, borderRadius: 6,
    color: inkSoft, fontFamily: "inherit", padding: 0,
  },
  calDayDone: { background: "rgba(255,107,61,.12)", borderColor: accent, color: ink },
  calDayToday: { boxShadow: `inset 0 0 0 2px ${accentBright}` },
  calDayNum: { fontSize: 13, fontWeight: 700 },
  calDot: { width: 5, height: 5, borderRadius: "50%", background: accent },

  // --- Motivation ---
  streakCard: {
    background: surface, border: `1.5px solid ${line}`, borderRadius: 10,
    padding: "22px 20px", marginTop: 16, display: "flex", flexDirection: "column",
    alignItems: "center", gap: 6, boxShadow: "0 2px 10px rgba(0,0,0,.35)",
  },
  streakNumWrap: { display: "flex", alignItems: "baseline", gap: 6 },
  streakNum: { fontSize: 56, fontWeight: 900, color: accentBright, lineHeight: 1 },
  streakUnit: { fontSize: 18, fontWeight: 800, color: inkSoft },
  streakSub: { fontSize: 13, fontWeight: 700, color: inkSoft },
  msgCard: {
    background: surfaceAlt, border: `1px solid ${borderSoft}`, borderRadius: 8,
    padding: "16px 18px", marginTop: 14, position: "relative",
    display: "flex", alignItems: "center", gap: 10,
  },
  msgQuote: { fontSize: 32, fontWeight: 900, color: accent, lineHeight: 0.6, alignSelf: "flex-start" },
  msgText: { fontSize: 14.5, fontWeight: 700, color: ink, lineHeight: 1.6 },
  bestList: { display: "flex", flexDirection: "column", gap: 8 },
  bestRow: {
    display: "flex", alignItems: "center", gap: 12, background: surface,
    border: `1px solid ${borderSoft}`, borderRadius: 8, padding: "11px 14px",
  },
  bestRank: {
    width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: surfaceAlt,
    color: accentBright, fontSize: 12, fontWeight: 900,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  bestInfo: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  bestName: { fontSize: 15, fontWeight: 800, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  bestSub: { fontSize: 12, color: inkSoft },
  bestRm: { display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1 },
  bestRmNum: { fontSize: 20, fontWeight: 900, color: accent },
  bestRmLbl: { fontSize: 10, fontWeight: 700, color: inkFaint },
  bestNote: { fontSize: 11, color: inkFaint, marginTop: 12, lineHeight: 1.6 },

  // --- Tab bar ---
  tabBar: {
    position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 460, margin: "0 auto",
    height: 62, background: "rgba(30,33,40,.96)", backdropFilter: "blur(8px)",
    borderTop: `1px solid ${border}`, display: "flex", zIndex: 50,
  },
  tabItem: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 3, background: "transparent", border: "none",
    color: inkFaint, cursor: "pointer", fontFamily: "inherit", paddingTop: 2,
  },
  tabItemActive: { color: accent },
  tabLabel: { fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" },

  sheetCard: {
    display: "block", width: "100%", textAlign: "left", background: surface,
    border: `1px solid #2A2E36`, borderRadius: 4, padding: "14px 16px",
    marginBottom: 10, cursor: "pointer", fontFamily: "inherit",
  },
  scTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  scPart: {
    background: accent, color: "#fff", fontWeight: 800, fontSize: 13,
    padding: "2px 11px", borderRadius: 3, letterSpacing: "0.05em",
  },
  scDate: { fontWeight: 700, fontSize: 15, color: ink },
  scMeta: { display: "flex", alignItems: "center", fontSize: 12.5, color: inkSoft },
  scDot: { margin: "0 2px", color: inkFaint },
  scVol: { color: accent, fontWeight: 700 },
  scGoal: { marginTop: 7, fontSize: 12, color: inkSoft, borderTop: "1px dashed #2A2E36", paddingTop: 7 },

  editHeader: {
    display: "flex", alignItems: "center", gap: 10, padding: "14px 14px",
    position: "sticky", top: 0, background: paper, zIndex: 10,
    borderBottom: `1px solid #2A2E36`,
  },
  backBtn: { background: "none", border: "none", color: ink, cursor: "pointer", padding: 4, display: "flex" },
  editTitle: { flex: 1, fontWeight: 800, fontSize: 16, letterSpacing: "0.04em" },
  saveBtn: {
    display: "flex", alignItems: "center", gap: 6, padding: "9px 16px",
    border: "none", borderRadius: 4, background: accent, color: "#fff",
    fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit",
  },

  metaCard: {
    background: surface, border: `1.5px solid ${line}`, borderRadius: 4,
    padding: 16, margin: "16px 0", boxShadow: "0 2px 8px rgba(0,0,0,.35)",
  },
  partTab: { marginBottom: 16 },
  partTabLabel: { fontSize: 12, fontWeight: 800, color: ink, display: "block", marginBottom: 8 },
  partChips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    padding: "6px 13px", borderRadius: 3, border: `1px solid #33373F`,
    background: "transparent", color: inkSoft, fontSize: 13, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  chipActive: { background: accent, borderColor: accent, color: "#fff" },

  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: inkSoft, marginBottom: 6 },
  input: {
    width: "100%", padding: "10px 12px", borderRadius: 3,
    border: `1px solid #33373F`, background: surfaceInput, color: ink,
    fontSize: 15, fontFamily: "inherit",
  },
  dateEcho: { marginTop: 6, fontSize: 12.5, color: inkSoft, fontWeight: 600 },
  row2: { display: "flex", gap: 12 },
  timeRow: { display: "flex", alignItems: "center", gap: 6 },
  timeInput: {
    flex: 1, minWidth: 0, padding: "10px 8px", borderRadius: 3,
    border: `1px solid #33373F`, background: surfaceInput, color: ink,
    fontSize: 14, fontFamily: "inherit",
  },
  tilde: { color: inkFaint, fontSize: 13 },

  exCard: {
    background: surface, border: `1.5px solid ${line}`, borderRadius: 4,
    marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,.35)",
  },
  exHead: {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
    borderBottom: `1px solid ${line}`, background: surfaceAlt,
  },
  exNum: {
    width: 24, height: 24, flexShrink: 0, borderRadius: 3, background: accent,
    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 800,
  },
  exName: {
    flex: 1, minWidth: 0, border: "none", background: "transparent",
    fontSize: 16, fontWeight: 800, color: ink, fontFamily: "inherit", padding: "4px 0",
  },
  exDel: { background: "none", border: "none", color: inkFaint, cursor: "pointer", padding: 4, display: "flex" },

  setGrid: {
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
  },
  setBox: {
    padding: "9px 6px", borderRight: `1px solid #2A2E36`,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
  },
  setBoxLbl: {
    fontSize: 10.5, fontWeight: 700, color: inkFaint, letterSpacing: "0.02em",
    background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "1px 4px",
    borderRadius: 3,
  },
  cellRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%" },
  cellInput: {
    width: "100%", padding: "7px 2px", borderRadius: 3, border: `1px solid #33373F`,
    background: surfaceInput, color: ink, fontSize: 14, fontWeight: 700,
    fontFamily: "inherit", textAlign: "center", minWidth: 0,
  },
  cellX: { fontSize: 11, color: inkFaint, lineHeight: 1 },

  addExBtn: {
    width: "100%", padding: 13, borderRadius: 4, border: `1.5px dashed #3A3F49`,
    background: "transparent", color: inkSoft, fontSize: 14, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", display: "flex",
    alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 18,
  },
  volBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "15px 18px", background: surfaceAlt, color: ink, borderRadius: 4,
    border: `1px solid ${border}`,
    fontSize: 14, fontWeight: 700, marginBottom: 20, letterSpacing: "0.03em",
  },
  volNum: { fontSize: 22, fontWeight: 900, color: accentBright },

  delSheetBtn: {
    width: "100%", padding: 12, background: "transparent", border: "none",
    color: inkFaint, fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 3,
  },

  // rest setting row
  restRow: {
    display: "flex", alignItems: "center", gap: 7, padding: "9px 12px",
    borderBottom: `1px solid #2A2E36`, background: surfaceAlt, flexWrap: "wrap",
  },
  restLabel: { fontSize: 12, fontWeight: 700, color: inkSoft },
  restChips: { display: "flex", gap: 4 },
  restChip: {
    padding: "4px 9px", borderRadius: 3, border: "1px solid #33373F",
    background: surfaceInput, color: inkSoft, fontSize: 11.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  restChipActive: { background: accent, borderColor: accent, color: "#fff" },
  restStart: {
    marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
    padding: "5px 11px", borderRadius: 3, border: "none", background: accent,
    color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
  },

  // floating timer bar
  timerWrap: {
    position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 60,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    padding: "0 12px 14px", pointerEvents: "none",
  },

  // --- 休憩中の広告カード ---
  adCard: {
    width: "100%", maxWidth: 436, background: surface,
    border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden",
    boxShadow: "0 6px 20px rgba(0,0,0,.35)", pointerEvents: "auto",
  },
  adHead: {
    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
    borderBottom: `1px solid ${borderSoft}`, background: surfaceAlt,
  },
  adPr: {
    fontSize: 10, fontWeight: 800, color: "#fff", background: "#6F6B61",
    padding: "1px 6px", borderRadius: 3, letterSpacing: "0.06em",
  },
  adTag: { fontSize: 11.5, fontWeight: 700, color: inkSoft },
  adClose: {
    marginLeft: "auto", background: "none", border: "none", color: inkFaint,
    cursor: "pointer", padding: 2, display: "flex",
  },
  adBody: {
    display: "flex", alignItems: "center", gap: 12, padding: "11px 12px",
    textDecoration: "none", cursor: "pointer",
  },
  adThumb: {
    width: 52, height: 52, flexShrink: 0, borderRadius: 6, background: surfaceInput,
    border: `1px solid ${border}`, display: "flex", alignItems: "center",
    justifyContent: "center", overflow: "hidden",
  },
  adImg: { width: "100%", height: "100%", objectFit: "cover" },
  adThumbText: { fontSize: 11, fontWeight: 700, color: inkFaint },
  adInfo: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  adName: { fontSize: 14, fontWeight: 800, color: ink, lineHeight: 1.3 },
  adNote: { fontSize: 11.5, color: inkSoft, lineHeight: 1.4 },
  adPrice: { fontSize: 13, fontWeight: 800, color: accentBright, marginTop: 2 },
  adCta: {
    flexShrink: 0, padding: "8px 14px", borderRadius: 6, background: accent,
    color: "#fff", fontSize: 13, fontWeight: 800,
  },
  timerCard: {
    width: "100%", maxWidth: 436, background: surface,
    border: `1.5px solid ${line}`, borderRadius: 8, overflow: "hidden",
    position: "relative", boxShadow: "0 6px 20px rgba(43,42,38,.22)",
    pointerEvents: "auto",
  },
  timerProgress: {
    position: "absolute", top: 0, left: 0, bottom: 0, opacity: 0.22,
    transition: "width 1s linear",
  },
  timerInner: {
    position: "relative", display: "flex", alignItems: "center",
    justifyContent: "space-between", padding: "10px 12px", gap: 10,
  },
  timerLeftCol: { display: "flex", flexDirection: "column", lineHeight: 1.15 },
  timerLabel: { fontSize: 11, fontWeight: 700, color: inkSoft },
  timerClock: { fontSize: 30, fontWeight: 900, fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" },
  timerBtns: { display: "flex", alignItems: "center", gap: 6 },
  tBtn: {
    minWidth: 38, height: 38, borderRadius: 6, border: "1px solid #33373F",
    background: surfaceInput, color: ink, fontSize: 12, fontWeight: 800,
    cursor: "pointer", fontFamily: "inherit", display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  tMain: {
    width: 42, height: 38, borderRadius: 6, border: "none", background: accent,
    color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  tClose: {
    width: 38, height: 38, borderRadius: 6, border: "none", background: "transparent",
    color: inkFaint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
};
