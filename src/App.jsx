import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Trash2, ChevronLeft, Save, ClipboardList, Timer, Play, Pause, RotateCcw } from "lucide-react";

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
  exercises: [emptyEx()],
});

const sheetVolume = (sheet) =>
  sheet.exercises.reduce(
    (t, ex) => t + ex.sets.reduce((u, c) => u + (Number(c.w) || 0) * (Number(c.r) || 0), 0),
    0
  );

// ===========================================================================
export default function App() {
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // sheet object or null

  useEffect(() => { load().then((s) => { setSheets(s); setLoading(false); }); }, []);

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

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {loading ? (
        <div style={S.empty}>読み込み中…</div>
      ) : editing ? (
        <SheetEditor
          initial={editing}
          onBack={() => setEditing(null)}
          onSave={commit}
          onDelete={remove}
        />
      ) : (
        <SheetList
          sheets={sheets}
          onNew={() => setEditing(newSheet())}
          onOpen={(s) => setEditing(s)}
        />
      )}
    </div>
  );
}

// ---- List ------------------------------------------------------------------
function SheetList({ sheets, onNew, onOpen }) {
  return (
    <>
      <header style={S.header}>
        <div style={S.brandRow}>
          <ClipboardList size={24} color="#FF6B3D" strokeWidth={2.3} />
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
.primary, .iconbtn, .chip, .sheetcard, .addex, .delsheet { transition: filter .12s, background .12s, transform .08s, color .12s, border-color .12s; }
.primary:hover { filter: brightness(1.07); }
.primary:active { transform: scale(.985); }
.sheetcard:hover { border-color: #3A3F49 !important; }
.sheetcard:active { transform: scale(.99); }
.chip:hover { border-color: #FF6B3D !important; }
.addex:hover { border-color: #FF6B3D !important; color: #FF6B3D !important; }
.iconbtn:hover { color: #FF6B3D !important; }
.delsheet:hover { color: #C0392B !important; }
.restchip:hover { border-color: #FF6B3D !important; }
.reststart:hover { filter: brightness(1.08); }
.setlbl:hover { background: #2A2E36 !important; color: #FF6B3D !important; }
.tbtn:hover { border-color: #FF6B3D !important; }
.logout:hover { border-color: #FF6B3D !important; color: #FF6B3D !important; }
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

  main: { padding: "0 16px 88px" },

  primaryBtn: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 15, border: "none", borderRadius: 4, background: accent,
    color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer",
    marginBottom: 18, fontFamily: "inherit", letterSpacing: "0.03em",
  },
  empty: { textAlign: "center", color: inkFaint, padding: "56px 20px", lineHeight: 1.8, fontSize: 14 },

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
