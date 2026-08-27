import React, { useEffect, useMemo, useState } from "react";
import { Loader2, ChevronDown, RefreshCw, AlertTriangle } from "lucide-react";

// ============================================================================
// CONFIG
// ============================================================================
const DATA_URL =
  "https://raw.githubusercontent.com/lamkienthanh92/fx-cmt-app/main/data/screener-data.json";

const CATEGORY = {
  "EUR/USD": "Chính", "GBP/USD": "Chính", "USD/JPY": "Chính", "USD/CHF": "Chính",
  "AUD/USD": "Chính", "NZD/USD": "Chính", "USD/CAD": "Chính",
  "EUR/GBP": "Chéo", "EUR/JPY": "Chéo", "GBP/JPY": "Chéo", "EUR/CHF": "Chéo",
  "EUR/CAD": "Chéo", "EUR/AUD": "Chéo", "AUD/JPY": "Chéo", "CAD/JPY": "Chéo",
  "GBP/CAD": "Chéo", "AUD/NZD": "Chéo",
  "USD/NOK": "Phụ", "USD/SEK": "Phụ", "USD/ZAR": "Phụ", "USD/MXN": "Phụ",
  "BTC/USD": "Crypto/Hàng hóa",
};
const CAT_ORDER = ["Chính", "Chéo", "Phụ", "Crypto/Hàng hóa"];

const NMAX = 10;
const LOOKBACK = 40;
const PIVWIN = 3;
const BINS = [-1, 0.1, 0.2, 0.3, 0.4, 0.5, 1e9];
const LABELS = ["<10%", "10-20%", "20-30%", "30-40%", "40-50%", ">=50%"];

function bucketOf(v) {
  for (let k = 0; k < BINS.length - 1; k++) if (v >= BINS[k] && v < BINS[k + 1]) return LABELS[k];
  return LABELS[LABELS.length - 1];
}

// ============================================================================
// INDICATORS
// ============================================================================
function ema(vals, period) {
  const k = 2 / (period + 1);
  const out = new Array(vals.length).fill(null);
  let prev = vals[0];
  out[0] = prev;
  for (let i = 1; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(vals, period = 14) {
  const n = vals.length;
  const out = new Array(n).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < n; i++) {
    const diff = vals[i] - vals[i - 1];
    const gain = Math.max(diff, 0), loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain / period; avgLoss += loss / period;
      if (i === period) { const rs = avgGain / avgLoss; out[i] = 100 - 100 / (1 + rs); }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}
function macd(vals, fast = 12, slow = 26, sig = 9) {
  const eF = ema(vals, fast), eS = ema(vals, slow);
  const line = vals.map((_, i) => eF[i] - eS[i]);
  const signal = ema(line, sig);
  return { line, signal };
}
function buildIndicators(bars) {
  const closes = bars.map((b) => b.c);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const { line, signal } = macd(closes);
  const up = closes.map((c, i) => c > ema50[i] && rsi14[i] !== null && rsi14[i] > 50 && line[i] > signal[i]);
  const down = closes.map((c, i) => c < ema50[i] && rsi14[i] !== null && rsi14[i] < 50 && line[i] < signal[i]);
  return { up, down };
}
function mapWeeklyToDaily(dBars, wBars, wUp, wDown) {
  const outUp = new Array(dBars.length).fill(false);
  const outDown = new Array(dBars.length).fill(false);
  const shift = 3 * 24 * 3600 * 1000;
  const wShifted = wBars.map((b) => b.t + shift);
  let wi = -1;
  for (let i = 0; i < dBars.length; i++) {
    const dt = dBars[i].t;
    while (wi + 1 < wBars.length && wShifted[wi + 1] <= dt) wi++;
    if (wi >= 0) { outUp[i] = wUp[wi]; outDown[i] = wDown[wi]; }
  }
  return { outUp, outDown };
}
function findPivots(bars, win) {
  const lowIdx = [], highIdx = [];
  for (let i = win; i < bars.length - win; i++) {
    let isLow = true, isHigh = true;
    const lo = bars[i].l, hi = bars[i].h;
    for (let j = i - win; j <= i + win; j++) {
      if (bars[j].l < lo) isLow = false;
      if (bars[j].h > hi) isHigh = false;
    }
    if (isLow) lowIdx.push(i);
    if (isHigh) highIdx.push(i);
  }
  return { lowIdx, highIdx };
}
function percentile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

// ============================================================================
// BACKTEST: historical bucket -> target80-by-day mapping, per symbol+side
// ============================================================================
function runBacktest(D, dUp, dDown, wUpM, wDownM, lowIdx, highIdx, side) {
  const cand = [];
  for (let i = 0; i < D.length; i++) {
    if (side === "long") { if (dUp[i] && wUpM[i] && D[i].c < D[i].o) cand.push(i); }
    else { if (dDown[i] && wDownM[i] && D[i].c > D[i].o) cand.push(i); }
  }
  const pivArr = side === "long" ? lowIdx : highIdx;
  const rows = [];
  for (const i of cand) {
    let pIdx = -1;
    for (let p = pivArr.length - 1; p >= 0; p--) {
      if (pivArr[p] < i && pivArr[p] >= i - LOOKBACK) { pIdx = pivArr[p]; break; }
      if (pivArr[p] < i - LOOKBACK) break;
    }
    if (pIdx === -1) continue;
    if (i - 1 <= pIdx) continue;
    if (i + NMAX >= D.length) continue;

    let impulse, base;
    if (side === "long") {
      const plow = D[pIdx].l;
      let peak = -Infinity;
      for (let j = pIdx; j < i; j++) peak = Math.max(peak, D[j].h);
      impulse = peak - plow;
      if (impulse <= 0) continue;
      base = { plow, peak };
    } else {
      const phigh = D[pIdx].h;
      let trough = Infinity;
      for (let j = pIdx; j < i; j++) trough = Math.min(trough, D[j].l);
      impulse = phigh - trough;
      if (impulse <= 0) continue;
      base = { phigh, trough };
    }

    const extByDay = [];
    let cumMin = D[i].l, cumMax = D[i].h;
    for (let k = 1; k <= NMAX; k++) {
      const idx = i + k;
      cumMin = Math.min(cumMin, D[idx].l);
      cumMax = Math.max(cumMax, D[idx].h);
      extByDay.push(side === "long" ? (cumMax - base.plow) / impulse : (base.phigh - cumMin) / impulse);
    }

    let finalRetr;
    if (side === "long") {
      let finalMin = Infinity;
      for (let k = 0; k <= NMAX; k++) finalMin = Math.min(finalMin, D[i + k].l);
      finalRetr = (base.peak - finalMin) / impulse;
    } else {
      let finalMax = -Infinity;
      for (let k = 0; k <= NMAX; k++) finalMax = Math.max(finalMax, D[i + k].h);
      finalRetr = (finalMax - base.trough) / impulse;
    }
    rows.push({ finalRetr, extByDay });
  }

  const buckets = {};
  for (const l of LABELS) buckets[l] = [];
  for (const r of rows) buckets[bucketOf(r.finalRetr)].push(r);

  const table = {};
  for (const l of LABELS) {
    const arr = buckets[l];
    const perDay = [];
    for (let k = 0; k < NMAX; k++) {
      const vals = arr.map((r) => r.extByDay[k]);
      perDay.push(vals.length ? percentile(vals, 20) : null);
    }
    let crossDay = null;
    for (let k = 0; k < NMAX; k++) { if (perDay[k] !== null && perDay[k] >= 1.0) { crossDay = k + 1; break; } }
    table[l] = { n: arr.length, freq: rows.length ? arr.length / rows.length : 0, target80ByDay: perDay, crossDay };
  }

  // Bảng gộp TOÀN BỘ mẫu (không chia bucket) — dùng làm phương án dự phòng khi
  // 1 bucket cụ thể quá ít mẫu / thiếu dữ liệu ở ngày đó, để luôn tra ra được
  // 1 con số target80 cụ thể thay vì để trống.
  const overallPerDay = [];
  for (let k = 0; k < NMAX; k++) {
    const vals = rows.map((r) => r.extByDay[k]);
    overallPerDay.push(vals.length ? percentile(vals, 20) : null);
  }
  let overallCrossDay = null;
  for (let k = 0; k < NMAX; k++) { if (overallPerDay[k] !== null && overallPerDay[k] >= 1.0) { overallCrossDay = k + 1; break; } }
  const overall = { n: rows.length, target80ByDay: overallPerDay, crossDay: overallCrossDay };

  return { nTotal: rows.length, table, overall };
}

// Số mẫu tối thiểu để tin vào con số riêng của 1 bucket. Dưới ngưỡng này (hoặc
// khi đúng ngày đó không có dữ liệu), hàm sẽ mở rộng tìm sang bucket lân cận
// gần nhất, rồi mới rơi về bảng gộp toàn bộ mẫu — luôn trả ra 1 giá trị cụ thể
// nếu cặp đó có dù chỉ 1 mẫu lịch sử hợp lệ ở phía Long/Short đang xét.
const MIN_SAMPLES = 5;

function resolveTarget80(bt, retr, dayIdx) {
  const bucket = bucketOf(retr);
  const bIdx = LABELS.indexOf(bucket);

  const direct = bt.table[bucket];
  if (direct && direct.n >= MIN_SAMPLES && direct.target80ByDay[dayIdx] !== null) {
    return { ratio: direct.target80ByDay[dayIdx], source: "bucket", label: bucket, n: direct.n };
  }

  // mở rộng ra bucket lân cận gần nhất theo khoảng cách trên thang độ sâu hồi
  const order = LABELS
    .map((l, i) => ({ l, i, dist: Math.abs(i - bIdx) }))
    .filter((x) => x.l !== bucket)
    .sort((a, b) => a.dist - b.dist);
  for (const { l } of order) {
    const t = bt.table[l];
    if (t && t.n >= MIN_SAMPLES && t.target80ByDay[dayIdx] !== null) {
      return { ratio: t.target80ByDay[dayIdx], source: "neighbor", label: l, n: t.n };
    }
  }

  // rơi về bảng gộp toàn bộ mẫu lịch sử (không chia bucket)
  if (bt.overall && bt.overall.target80ByDay[dayIdx] !== null) {
    return { ratio: bt.overall.target80ByDay[dayIdx], source: "overall", label: "toàn bộ mẫu", n: bt.overall.n };
  }

  return { ratio: null, source: "none", label: null, n: 0 };
}

// ============================================================================
// LIVE current-pullback state
// ============================================================================
function getCurrentPullback(D, dUp, dDown, wUpM, wDownM, lowIdx, highIdx) {
  const last = D.length - 1;
  let side = null;
  if (dUp[last] && wUpM[last] && D[last].c < D[last].o) side = "long";
  else if (dDown[last] && wDownM[last] && D[last].c > D[last].o) side = "short";
  if (!side) return null;

  let streak = 0, idx = last;
  while (idx >= 0) {
    const isOpp = side === "long" ? D[idx].c < D[idx].o : D[idx].c > D[idx].o;
    if (!isOpp) break;
    streak++; idx--;
  }
  const streakStart = last - streak + 1;
  const pivArr = side === "long" ? lowIdx : highIdx;
  let pIdx = -1;
  for (let p = pivArr.length - 1; p >= 0; p--) { if (pivArr[p] < streakStart) { pIdx = pivArr[p]; break; } }
  if (pIdx === -1) return null;
  if (streakStart - 1 <= pIdx) return null;

  if (side === "long") {
    const plow = D[pIdx].l;
    let peak = -Infinity;
    for (let j = pIdx; j < streakStart; j++) peak = Math.max(peak, D[j].h);
    const impulse = peak - plow;
    if (impulse <= 0) return null;
    let curMin = Infinity;
    for (let j = streakStart; j <= last; j++) curMin = Math.min(curMin, D[j].l);
    const retr = (peak - curMin) / impulse;
    return {
      side, streak, retr, impulse,
      base: plow, // ratio 0% -> giá này (dùng để quy target% ra giá thực)
      entryDate: D[streakStart].d, lastDate: D[last].d, lastClose: D[last].c,
    };
  } else {
    const phigh = D[pIdx].h;
    let trough = Infinity;
    for (let j = pIdx; j < streakStart; j++) trough = Math.min(trough, D[j].l);
    const impulse = phigh - trough;
    if (impulse <= 0) return null;
    let curMax = -Infinity;
    for (let j = streakStart; j <= last; j++) curMax = Math.max(curMax, D[j].h);
    const retr = (curMax - trough) / impulse;
    return {
      side, streak, retr, impulse,
      base: phigh, // ratio 0% -> giá này (short đi từ đỉnh xuống nên base là đỉnh)
      entryDate: D[streakStart].d, lastDate: D[last].d, lastClose: D[last].c,
    };
  }
}

// Quy đổi 1 mức target% (thang impulse) ra GIÁ THỰC, theo đúng chiều Long/Short.
// Long:  giá = base(đáy sóng đẩy) + ratio * impulse   (ratio tăng -> giá tăng)
// Short: giá = base(đỉnh sóng đẩy) - ratio * impulse  (ratio tăng -> giá giảm)
function ratioToPrice(ratio, cp) {
  if (ratio === null || ratio === undefined) return null;
  return cp.side === "long" ? cp.base + ratio * cp.impulse : cp.base - ratio * cp.impulse;
}
function priceDecimals(sym) {
  if (sym.includes("JPY")) return 3;
  if (sym.includes("BTC")) return 1;
  return 5;
}
function fmtPrice(v, sym) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toFixed(priceDecimals(sym));
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================
const fmtPct = (v) => (v === null || v === undefined ? "—" : (v * 100).toFixed(1) + "%");
const fmtPct0 = (v) => (v === null || v === undefined ? "—" : (v * 100).toFixed(0) + "%");

// ============================================================================
// STYLE TOKENS
// ============================================================================
const C = {
  bg: "#090c10",
  panel: "#10151b",
  panel2: "#141a21",
  border: "#202932",
  borderSoft: "#1a2129",
  text: "#e7edf3",
  textDim: "#92a0ac",
  textFaint: "#5c6771",
  long: "#34d1a3",
  longSoft: "rgba(52,209,163,0.12)",
  short: "#ff7a90",
  shortSoft: "rgba(255,122,144,0.12)",
  amber: "#f2b544",
  amberSoft: "rgba(242,181,68,0.12)",
};

// ============================================================================
// COMPONENT: pullback scale bar (signature visual)
// ============================================================================
function ImpulseScale({ retr, side }) {
  const clamp = Math.max(0, Math.min(1, retr));
  const pct = clamp * 100;
  const overflow = retr > 1;
  const color = side === "long" ? C.long : C.short;
  return (
    <div style={{ margin: "12px 0 8px" }}>
      <div style={{ position: "relative", height: 8, borderRadius: 5, background: C.borderSoft }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct + "%", borderRadius: 5, background: `linear-gradient(90deg, ${color}33, ${color})` }} />
        <div style={{ position: "absolute", top: -3, left: pct + "%", width: 2, height: 14, background: C.textFaint }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: C.textFaint }}>
        <span>0% (đáy sóng)</span>
        <span>{overflow ? "phá gốc (" + fmtPct0(retr) + ")" : fmtPct0(retr) + " hồi"}</span>
        <span>100% (đỉnh cũ)</span>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: one pair card
// ============================================================================
function PairCard({ item, open, onToggle }) {
  const { sym, cp, bt } = item;
  const bucket = bucketOf(cp.retr);
  const bd = bt.table[bucket];
  const curDayIdx = Math.min(NMAX - 1, cp.streak);

  const resolved = resolveTarget80(bt, cp.retr, curDayIdx);
  const quickTargetPrice = ratioToPrice(resolved.ratio, cp);
  const crossTxt = bd && bd.crossDay ? `${bd.crossDay} ngày` : `chưa đạt trong ${NMAX} ngày`;
  const sideColor = cp.side === "long" ? C.long : C.short;
  const sideSoft = cp.side === "long" ? C.longSoft : C.shortSoft;

  const sourceNote = {
    bucket: null,
    neighbor: `ước tính từ bucket lân cận "${resolved.label}" (bucket "${bucket}" chỉ có ${bd ? bd.n : 0} mẫu, dưới ngưỡng tin cậy ${MIN_SAMPLES})`,
    overall: `ước tính từ toàn bộ ${resolved.n} mẫu lịch sử của ${sym} (không tách theo mức hồi cụ thể, do dữ liệu riêng bucket "${bucket}" quá mỏng)`,
    none: `chưa đủ dữ liệu lịch sử cho ${sym} theo chiều ${cp.side === "long" ? "Long" : "Short"}`,
  }[resolved.source];

  return (
    <div
      onClick={onToggle}
      style={{
        background: open ? C.panel2 : C.panel,
        border: `1px solid ${open ? C.border : C.borderSoft}`,
        borderRadius: 14,
        padding: "14px 14px 12px",
        marginBottom: 10,
        cursor: "pointer",
        transition: "border-color .15s ease, background .15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>{sym}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 700, padding: "2.5px 7px", borderRadius: 5, letterSpacing: "0.03em", background: sideSoft, color: sideColor }}>
            {cp.side === "long" ? "LONG" : "SHORT"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.textFaint, whiteSpace: "nowrap" }}>
            hồi <b style={{ color: C.textDim }}>{cp.streak}</b> ngày
          </span>
          <ChevronDown size={14} color={C.textFaint} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
        </div>
      </div>

      <ImpulseScale retr={cp.retr} side={cp.side} />

      <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>
        Giá đóng cửa gần nhất: <b style={{ color: C.textDim }}>{fmtPrice(cp.lastClose, sym)}</b>
      </div>

      {/* TP 80% ngay lúc này — con số quan trọng nhất của card, luôn ghi ra 1 giá trị cụ thể */}
      <div style={{
        marginTop: 10, padding: "10px 11px", borderRadius: 10,
        background: sideSoft, border: `1px solid ${sideColor}55`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.02em" }}>
              TP xác suất 80% <b style={{ color: C.text }}>ngay tại thời điểm hiện tại</b> (đã hồi {cp.streak} ngày)
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: sideColor, marginTop: 2 }}>
              {resolved.ratio !== null ? fmtPrice(quickTargetPrice, sym) : "chưa đủ dữ liệu"}
            </div>
          </div>
          {resolved.ratio !== null && (
            <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.textFaint }}>
              {fmtPct(resolved.ratio)}<br />thang sóng đẩy
            </div>
          )}
        </div>
        {sourceNote && (
          <div style={{ fontSize: 9.5, color: C.textFaint, marginTop: 6, lineHeight: 1.4 }}>⚠ {sourceNote}</div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
        <span style={{ fontSize: 11.5, color: C.textDim }}>
          Bucket lịch sử <b style={{ color: C.text }}>{bucket}</b> · n={bd ? bd.n : 0} · tần suất {bd ? fmtPct0(bd.freq) : "—"}
        </span>
        <span style={{ fontSize: 11, color: C.textFaint }}>{open ? "thu gọn ▲" : "xem chi tiết ▾"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.borderSoft}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
            <StatBox k="Đáy/đỉnh hồi chạm" v={fmtPct(cp.retr)} />
            <StatBox k="Mẫu lịch sử (n)" v={bd ? bd.n : 0} />
            <StatBox k="Ngày đạt lại 100%" v={crossTxt} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Ngày (từ lúc hồi)</th>
                <th style={thStyle}>Target 80%</th>
                <th style={thStyle}>Giá TP (80%)</th>
                <th style={thStyle}>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: NMAX }).map((_, k) => {
                const r = resolveTarget80(bt, cp.retr, k);
                const priceV = ratioToPrice(r.ratio, cp);
                const isCur = k + 1 === Math.min(NMAX, cp.streak + 1);
                const srcTag = { bucket: "bucket", neighbor: "lân cận", overall: "gộp", none: "—" }[r.source];
                return (
                  <tr key={k} style={{ background: isCur ? C.amberSoft : "transparent" }}>
                    <td style={tdStyleLeft}>N{k + 1}</td>
                    <td style={{ ...tdStyle, color: isCur ? C.amber : C.text, fontWeight: isCur ? 700 : 400 }}>{fmtPct(r.ratio)}</td>
                    <td style={{ ...tdStyle, color: isCur ? C.amber : C.text, fontWeight: isCur ? 700 : 400 }}>{r.ratio !== null ? fmtPrice(priceV, sym) : "—"}</td>
                    <td style={{ ...tdStyle, color: C.textFaint, fontSize: 10 }}>{srcTag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginTop: 10 }}>
            <b style={{ color: C.textDim }}>Đọc bảng:</b> cột % là target theo thang 0–100%+ (100% = đỉnh/đáy cũ trước khi hồi); cột giá quy đổi trực tiếp sang
            giá thực dựa trên biên độ sóng đẩy hiện tại của {sym}. Cột "Nguồn" cho biết số liệu ngày đó lấy từ đúng bucket "{bucket}" (n={bd ? bd.n : 0}), hay
            phải mở rộng sang bucket lân cận / gộp toàn bộ mẫu vì bucket riêng quá ít dữ liệu (dưới {MIN_SAMPLES} mẫu). Dòng vàng là mốc ngày hiện tại (đã hồi{" "}
            {cp.streak} ngày) — đúng bằng ô "TP xác suất 80%" ở khung phía trên.
          </p>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: "6px 4px", textAlign: "right", borderBottom: `1px solid ${C.borderSoft}`, color: C.textFaint, fontWeight: 500, fontSize: 10, textTransform: "uppercase" };
const tdStyle = { padding: "6px 4px", textAlign: "right", borderBottom: `1px solid ${C.borderSoft}` };
const tdStyleLeft = { ...tdStyle, textAlign: "left", color: C.textDim };

function StatBox({ k, v }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, borderRadius: 9, padding: "8px 9px" }}>
      <div style={{ fontSize: 9.5, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace" }}>{k}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5, fontWeight: 700, marginTop: 3, color: C.text }}>{v}</div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================
export default function SongDayScreener() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [totalScanned, setTotalScanned] = useState(0);
  const [tab, setTab] = useState("Tất cả");
  const [openSym, setOpenSym] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setErrMsg("");
      try {
        const res = await fetch(DATA_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const raw = await res.json();
        const symbols = Object.keys(raw.D);
        const out = [];
        for (const sym of symbols) {
          const D = raw.D[sym], W = raw.W[sym];
          if (!D || !W || D.length < 120 || W.length < 60) continue;
          const dInd = buildIndicators(D);
          const wInd = buildIndicators(W);
          const { outUp: wUpM, outDown: wDownM } = mapWeeklyToDaily(D, W, wInd.up, wInd.down);
          const { lowIdx, highIdx } = findPivots(D, PIVWIN);
          const cp = getCurrentPullback(D, dInd.up, dInd.down, wUpM, wDownM, lowIdx, highIdx);
          if (!cp) continue;
          const bt = runBacktest(D, dInd.up, dInd.down, wUpM, wDownM, lowIdx, highIdx, cp.side);
          out.push({ sym, cp, bt });
        }
        out.sort((a, b) => a.cp.streak - b.cp.streak);
        if (!cancelled) {
          setItems(out);
          setTotalScanned(symbols.length);
          setGeneratedAt(raw.generatedAt);
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelled) { setStatus("error"); setErrMsg(e.message || String(e)); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const counts = useMemo(() => {
    const c = { "Tất cả": items.length };
    for (const cat of CAT_ORDER) c[cat] = items.filter((x) => CATEGORY[x.sym] === cat).length;
    return c;
  }, [items]);

  const grouped = useMemo(() => {
    const filtered = tab === "Tất cả" ? items : items.filter((x) => CATEGORY[x.sym] === tab);
    const byCat = {};
    for (const it of filtered) { const c = CATEGORY[it.sym]; (byCat[c] = byCat[c] || []).push(it); }
    for (const c in byCat) byCat[c].sort((a, b) => a.cp.streak - b.cp.streak || b.cp.retr - a.cp.retr);
    return byCat;
  }, [items, tab]);

  const catsToShow = tab === "Tất cả" ? CAT_ORDER.filter((c) => grouped[c]) : [tab];

  return (
    <div style={{
      minHeight: "100%",
      background: `radial-gradient(1200px 700px at 10% -10%, #101820 0%, ${C.bg} 55%), radial-gradient(900px 600px at 100% 0%, #0d1420 0%, ${C.bg} 60%), ${C.bg}`,
      color: C.text,
      fontFamily: "'Inter', -apple-system, sans-serif",
      padding: "20px 16px 60px",
    }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* header */}
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint, display: "flex", alignItems: "center", gap: 8 }}>
            {status === "loading" && <Loader2 size={12} color={C.amber} style={{ animation: "spin 1s linear infinite" }} />}
            {status === "ready" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.long, boxShadow: `0 0 8px ${C.long}` }} />}
            {status === "error" && <AlertTriangle size={12} color={C.short} />}
            <span>
              {status === "loading" && "Đang tải dữ liệu D+W…"}
              {status === "ready" && generatedAt && `Dữ liệu D+W cập nhật lúc ${new Date(generatedAt).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" })}`}
              {status === "error" && "Không tải được dữ liệu"}
            </span>
            {status !== "loading" && (
              <button onClick={() => setReloadKey((k) => k + 1)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.textFaint, display: "flex", alignItems: "center" }}>
                <RefreshCw size={12} />
              </button>
            )}
          </div>

          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em", margin: "6px 0 4px" }}>Sóng Đẩy</h1>
          <p style={{ color: C.textDim, fontSize: 13.5, lineHeight: 1.5, maxWidth: "56ch", margin: 0 }}>
            Quét <b style={{ color: C.text }}>22 cặp</b> (chính, chéo, phụ, crypto) tìm những cặp đang{" "}
            <b style={{ color: C.text }}>Daily &amp; Weekly cùng chiều</b> và <b style={{ color: C.text }}>nến hiện tại đang hồi ngược</b> — rồi tra lại xác
            suất lịch sử của chính cặp đó: hồi bao sâu, đạt lại target với xác suất 80% trong bao nhiêu ngày.
          </p>

          {status === "ready" && (
            <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: C.textFaint }}>
              <span><b style={{ color: C.textDim }}>{totalScanned}</b> cặp quét</span>
              <span><b style={{ color: C.textDim }}>{items.length}</b> cặp đang hồi thỏa điều kiện</span>
              <span>Nguồn: cache D/W GitHub Action, tự quét lúc 5:00 sáng giờ VN mỗi ngày (Twelve Data)</span>
            </div>
          )}
        </header>

        {/* tabs */}
        {status === "ready" && (
          <div style={{ display: "flex", gap: 6, margin: "18px 0 14px", overflowX: "auto", paddingBottom: 2 }}>
            {["Tất cả", ...CAT_ORDER].map((c) => (
              <div
                key={c}
                onClick={() => setTab(c)}
                style={{
                  flex: "0 0 auto",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600,
                  padding: "7px 13px", borderRadius: 999,
                  border: `1px solid ${tab === c ? C.text : C.border}`,
                  background: tab === c ? C.text : C.panel,
                  color: tab === c ? "#0a0d10" : C.textDim,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {c} <span style={{ opacity: 0.55, marginLeft: 4 }}>{counts[c] || 0}</span>
              </div>
            ))}
          </div>
        )}

        {/* body */}
        {status === "loading" && (
          <div>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 92, borderRadius: 14, marginBottom: 10, background: C.panel, border: `1px solid ${C.borderSoft}`, opacity: 0.6 }} />
            ))}
          </div>
        )}

        {status === "error" && (
          <div style={{ border: `1px solid ${C.short}`, background: C.shortSoft, borderRadius: 14, padding: 16, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            Không thể tải <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, background: "rgba(0,0,0,.25)", padding: "1px 5px", borderRadius: 4 }}>screener-data.json</code> từ GitHub ({errMsg}).
            Có thể do mạng hoặc CORS bị chặn trong môi trường xem trước — thử mở lại hoặc bấm nút làm mới ở trên.
          </div>
        )}

        {status === "ready" && items.length === 0 && (
          <div style={{ border: `1px dashed ${C.border}`, borderRadius: 14, padding: "32px 20px", textAlign: "center", color: C.textDim, fontSize: 13.5, marginTop: 10 }}>
            Hiện <b style={{ color: C.text }}>không có cặp nào</b> thỏa điều kiện (Daily &amp; Weekly cùng chiều + đang hồi) lúc này. Quay lại sau — điều kiện
            được đánh giá lại mỗi lần dữ liệu D/W cập nhật.
          </div>
        )}

        {status === "ready" && items.length > 0 && catsToShow.map((c) => (
          <div key={c}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, margin: "18px 2px 8px" }}>
              {c} ({grouped[c].length})
            </div>
            {grouped[c].map((item) => (
              <PairCard key={item.sym} item={item} open={openSym === item.sym} onToggle={() => setOpenSym(openSym === item.sym ? null : item.sym)} />
            ))}
          </div>
        ))}

        {status === "ready" && (
          <div style={{ marginTop: 34, paddingTop: 16, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
            Phương pháp: xu hướng D/W xác nhận bằng Close so EMA50, RSI14 và MACD(12,26,9); "hồi" là chuỗi nến ngược màu liên tiếp kể từ nến đảo chiều gần nhất;
            biên độ sóng đẩy đo từ swing-pivot 3-nến gần nhất tới đỉnh/đáy trước khi hồi. Target 80% = percentile 20 của phân phối mở rộng lũy kế trong lịch sử
            của chính từng cặp, theo từng mức hồi đã chạm. Đây là thống kê mô tả quá khứ, không phải khuyến nghị đầu tư.
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}
