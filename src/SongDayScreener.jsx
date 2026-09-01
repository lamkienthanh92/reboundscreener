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

// Các cặp sàn của bạn không hỗ trợ — loại thẳng khỏi vòng quét, không hiển thị
// dù có tín hiệu hay không. Thêm/bớt mã ở đây theo đúng danh mục sàn của bạn
// (dùng đúng định dạng "XXX/YYY" như trong CATEGORY ở trên).
const EXCLUDED_SYMBOLS = ["USD/SEK", "USD/MXN", "USD/ZAR", "USD/NOK"];

const NMAX = 20; // đủ dài để cover các đợt hồi kéo dài nhiều ngày

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
// SMA thuần (dùng để làm đường tín hiệu MA10 cho RSI) — bỏ qua các phần tử null.
function sma(vals, period) {
  const out = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const win = vals.slice(Math.max(0, i - period + 1), i + 1).filter((v) => v !== null);
    if (win.length < period) continue;
    out[i] = win.reduce((a, b) => a + b, 0) / win.length;
  }
  return out;
}
// Heikin Ashi — nến trung bình làm mượt, đổi màu sớm/ổn định hơn nhiều so với
// chờ MACD cắt Signal. haClose>haOpen = nến xanh (tăng), ngược lại = đỏ (giảm).
function heikinAshi(bars) {
  const n = bars.length;
  const haOpen = new Array(n), haClose = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    haClose[i] = (b.o + b.h + b.l + b.c) / 4;
    haOpen[i] = i === 0 ? (b.o + b.c) / 2 : (haOpen[i - 1] + haClose[i - 1]) / 2;
  }
  return { haOpen, haClose };
}
function buildIndicators(bars) {
  const closes = bars.map((b) => b.c);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const rsiMa10 = sma(rsi14, 10);
  const { haOpen, haClose } = heikinAshi(bars);
  // Chỉ cần 1 trong 3 chỉ báo xác nhận là đủ (OR), không cần cả 3 đồng thuận (AND):
  // (1) Close vs EMA20, (2) RSI14 vs MA10 của chính nó (không phải mốc 50 cố định),
  // (3) màu nến Heikin Ashi (phản ứng nhanh hơn nhiều so với chờ MACD cắt Signal).
  const up = closes.map((c, i) =>
    c > ema20[i] || (rsi14[i] !== null && rsiMa10[i] !== null && rsi14[i] > rsiMa10[i]) || haClose[i] > haOpen[i]
  );
  const down = closes.map((c, i) =>
    c < ema20[i] || (rsi14[i] !== null && rsiMa10[i] !== null && rsi14[i] < rsiMa10[i]) || haClose[i] < haOpen[i]
  );
  return { up, down };
}
// Bản đầy đủ (trả nguyên chuỗi số, không rút gọn thành up/down) — dùng cho
// modal xem chart chi tiết, để hiển thị đúng giá trị EMA20/RSI14/MA10/HA thật.
function computeFullIndicators(bars) {
  const closes = bars.map((b) => b.c);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const rsiMa10 = sma(rsi14, 10);
  const { haOpen, haClose } = heikinAshi(bars);
  return { closes, ema20, rsi14, rsiMa10, haOpen, haClose };
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
function percentile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

// ============================================================================
// SÓNG ĐẨY & HỒI — định nghĩa theo đúng yêu cầu: KHÔNG dùng pivot 3-nến.
// "Sóng đẩy" = chuỗi NẾN CÙNG CHIỀU WEEKLY (≥2 nến liên tiếp — 1 nến ngược
// màu đơn lẻ xen giữa không tính là 1 chuỗi mới, chỉ là nhiễu). "Hồi" bắt đầu
// tính từ nến ngược chiều ĐẦU TIÊN ngay sau khi chuỗi đó kết thúc.
// - Đáy sóng đẩy: thấp nhất trong chuỗi, MỞ RỘNG bao gồm đáy của sóng ngược
//   chiều liền trước đó (nếu thấp hơn).
// - Đỉnh sóng đẩy: cao nhất trong chuỗi, MỞ RỘNG bao gồm đỉnh của nến đảo
//   chiều đầu tiên ngay sau chuỗi (nếu cao hơn — trường hợp nến đảo chiều có
//   wick vượt qua chuỗi trước khi đóng cửa ngược hướng).
// "streak" = số ngày kể từ ngày cuối cùng của chuỗi sóng đẩy đó.
// ============================================================================
const MAX_STREAK = 3; // chỉ chấp nhận hồi 1-3 ngày; từ 4 ngày trở đi loại bỏ hoàn toàn do nguy cơ đảo chiều

function matchesSide(D, i, side) {
  return side === "long" ? D[i].c > D[i].o : D[i].c < D[i].o;
}

function pullbackStateAt(D, idx, side) {
  // Hôm nay + hôm qua đều cùng chiều -> đang trong sóng đẩy, chưa hồi.
  if (matchesSide(D, idx, side) && idx > 0 && matchesSide(D, idx - 1, side)) return null;

  // Quét ngược tìm ngày cuối cùng của chuỗi sóng đẩy gần nhất (2 nến liên tiếp cùng chiều).
  let j = idx;
  while (j >= 1) {
    if (matchesSide(D, j, side) && matchesSide(D, j - 1, side)) break;
    j--;
  }
  if (j < 1) return null;
  const impulseEndIdx = j;
  const streak = idx - impulseEndIdx;
  if (streak < 1 || streak > MAX_STREAK) return null;

  // Mở rộng lùi để lấy trọn chuỗi (tìm điểm bắt đầu chuỗi).
  let impulseStartIdx = impulseEndIdx;
  while (impulseStartIdx - 1 >= 0 && matchesSide(D, impulseStartIdx - 1, side)) impulseStartIdx--;

  let impulseLow = Infinity, impulseHigh = -Infinity;
  for (let i = impulseStartIdx; i <= impulseEndIdx; i++) { impulseLow = Math.min(impulseLow, D[i].l); impulseHigh = Math.max(impulseHigh, D[i].h); }

  // Đáy: mở rộng bao gồm đáy của sóng ngược chiều liền trước impulseStartIdx (nếu thấp hơn).
  let base = impulseLow;
  const prevIdx = impulseStartIdx - 1;
  if (prevIdx >= 0 && !matchesSide(D, prevIdx, side)) {
    let k = prevIdx;
    while (k - 1 >= 0 && !matchesSide(D, k - 1, side)) k--;
    let prevWaveLow = Infinity;
    for (let i = k; i <= prevIdx; i++) prevWaveLow = Math.min(prevWaveLow, D[i].l);
    base = Math.min(base, prevWaveLow);
  }

  // Đỉnh: mở rộng bao gồm đỉnh của nến đảo chiều đầu tiên (nếu cao hơn).
  const firstReversalIdx = impulseEndIdx + 1;
  const peakVal = Math.max(impulseHigh, D[firstReversalIdx].h);

  const impulse = peakVal - base;
  if (impulse <= 0) return null;

  let curMin = Infinity, curMax = -Infinity;
  for (let i = firstReversalIdx; i <= idx; i++) { curMin = Math.min(curMin, D[i].l); curMax = Math.max(curMax, D[i].h); }
  const retr = (peakVal - curMin) / impulse;
  // extSoFar = mức mở rộng CAO NHẤT giá đã từng chạm tới (không chỉ giá đóng
  // cửa hôm nay) kể từ khi hồi bắt đầu — dùng để biết target đã bị "chạm"
  // thật chưa, kể cả khi giá đã lùi lại sau khi chạm.
  const extSoFar = (curMax - base) / impulse;

  return { side, streak, retr, extSoFar, impulse, base, peakVal, peakIdx: impulseEndIdx };
}

function getCurrentPullback(D, dUp, dDown, wUpM, wDownM) {
  const last = D.length - 1;
  // Daily chỉ cần ≥1/3 chỉ báo (EMA20/RSI14 vs MA10/Heikin Ashi) cùng chiều Weekly là đủ.
  let side = null;
  if (dUp[last] && wUpM[last]) side = "long";
  else if (dDown[last] && wDownM[last]) side = "short";
  if (!side) return null;
  const st = pullbackStateAt(D, last, side);
  if (!st) return null;
  return { ...st, entryDate: D[st.peakIdx + 1].d, lastDate: D[last].d, lastClose: D[last].c };
}

// ============================================================================
// BACKTEST: mẫu = NGÀY ĐẦU TIÊN rời sóng đẩy (streak===1 tại ngày đó, tức hôm
// trước chính là ngày cuối chuỗi). extByDay[m] = mức giá CỦA RIÊNG ngày (m+1)
// kể từ đó (KHÔNG cộng dồn/running-max) — tra thẳng bằng "streak-1" ra đúng
// vị trí hôm nay.
// ============================================================================
function runBacktest(D, dUp, dDown, wUpM, wDownM, side) {
  const extByDayRows = [];
  for (let i = 60; i < D.length; i++) {
    // Candidate: Daily (≥1/3 chỉ báo) VÀ Weekly (≥1/3 chỉ báo) cùng chiều —
    // khớp đúng điều kiện live ở trên.
    if (side === "long") { if (!(dUp[i] && wUpM[i])) continue; }
    else { if (!(dDown[i] && wDownM[i])) continue; }
    const st = pullbackStateAt(D, i, side);
    if (!st || st.streak !== 1) continue; // chỉ lấy ngày đầu tiên rời sóng đẩy
    if (i + NMAX - 1 >= D.length) continue;

    const extByDay = [];
    for (let k = 0; k < NMAX; k++) {
      const idx = i + k;
      // Giá trị CỦA RIÊNG ngày idx (Long: High, Short: Low) — không cộng dồn.
      extByDay.push(side === "long" ? (D[idx].h - st.base) / st.impulse : (st.base - D[idx].l) / st.impulse);
    }
    extByDayRows.push(extByDay);
  }

  // Target80ByDay[k] = mức mà 80% xác suất giá ĐANG Ở (đúng ngày đó, không
  // cộng dồn) qua (k+1) ngày kể từ sóng đẩy (percentile thứ 20).
  const target80ByDay = [];
  for (let k = 0; k < NMAX; k++) {
    const vals = extByDayRows.map((r) => r[k]);
    target80ByDay.push(vals.length ? percentile(vals, 20) : null);
  }
  let crossDay = null;
  for (let k = 0; k < NMAX; k++) { if (target80ByDay[k] !== null && target80ByDay[k] >= 1.0) { crossDay = k + 1; break; } }

  return { n: extByDayRows.length, target80ByDay, crossDay };
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
function PairCard({ item, open, onToggle, onInfo }) {
  const { sym, cp, bt } = item;
  const sideColor = cp.side === "long" ? C.long : C.short;
  const sideSoft = cp.side === "long" ? C.longSoft : C.shortSoft;
  const crossTxt = bt.crossDay ? `${bt.crossDay} ngày` : `chưa đạt trong ${NMAX} ngày`;

  // Hôm nay ứng với vị trí (streak-1) trong mảng target80ByDay (index 0 = ngày
  // 1 kể từ đỉnh/đáy). +1/+2/+3 ngày NỮA kể từ hôm nay = todayIdx+1, +2, +3.
  const todayIdx = cp.streak - 1;
  const offsets = [1, 2, 3];

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
          <button
            onClick={(e) => { e.stopPropagation(); onInfo(item); }}
            style={{
              width: 18, height: 18, borderRadius: "50%", border: `1px solid ${C.textFaint}`,
              background: "transparent", color: C.textFaint, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, flexShrink: 0,
            }}
            title="Xem chart Weekly + Daily"
          >
            !
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.textFaint, whiteSpace: "nowrap" }}>
            hồi <b style={{ color: C.textDim }}>{cp.streak}</b> ngày (từ đỉnh/đáy)
          </span>
          <ChevronDown size={14} color={C.textFaint} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
        </div>
      </div>

      <ImpulseScale retr={cp.retr} side={cp.side} />

      <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>
        Giá đóng cửa gần nhất: <b style={{ color: C.textDim }}>{fmtPrice(cp.lastClose, sym)}</b> · dựa trên{" "}
        <b style={{ color: C.textDim }}>{bt.n}</b> lần mẫu hình này từng xảy ra trong lịch sử {sym}
      </div>

      {/* TP 80% cho 1 / 2 / 3 ngày NỮA kể từ HÔM NAY (không phải từ lúc bắt đầu
          hồi) — vì đã đang hồi được {cp.streak} ngày rồi, mốc "2/3/4 ngày" cố
          định không còn đúng nghĩa. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 10 }}>
        {offsets.map((off) => {
          const idx = todayIdx + off;
          const ratio = idx < NMAX ? bt.target80ByDay[idx] : null;
          const price = ratioToPrice(ratio, cp);
          return (
            <div key={off} style={{ background: sideSoft, border: `1px solid ${sideColor}55`, borderRadius: 10, padding: "8px 9px", textAlign: "center" }}>
              <div style={{ fontSize: 9.5, color: C.textDim, letterSpacing: "0.02em" }}>TP 80% · +{off} ngày</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700, color: sideColor, marginTop: 3 }}>
                {ratio !== null ? fmtPrice(price, sym) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
        <span style={{ fontSize: 11.5, color: C.textDim }}>
          Đáy/đỉnh hồi chạm <b style={{ color: C.text }}>{fmtPct(cp.retr)}</b> biên độ sóng đẩy
        </span>
        <span style={{ fontSize: 11, color: C.textFaint }}>{open ? "thu gọn ▲" : "xem chi tiết ▾"}</span>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.borderSoft}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 14 }}>
            <StatBox k="Mẫu lịch sử (n)" v={bt.n} />
            <StatBox k="Ngày đạt lại 100%" v={crossTxt} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Ngày (từ đỉnh/đáy)</th>
                <th style={thStyle}>Target 80%</th>
                <th style={thStyle}>Giá TP (80%)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: NMAX }).map((_, k) => {
                const ratio = bt.target80ByDay[k];
                const priceV = ratioToPrice(ratio, cp);
                const isCur = k === todayIdx;
                return (
                  <tr key={k} style={{ background: isCur ? C.amberSoft : "transparent" }}>
                    <td style={tdStyleLeft}>N{k + 1}{isCur ? " (hôm nay)" : ""}</td>
                    <td style={{ ...tdStyle, color: isCur ? C.amber : C.text, fontWeight: isCur ? 700 : 400 }}>{fmtPct(ratio)}</td>
                    <td style={{ ...tdStyle, color: isCur ? C.amber : C.text, fontWeight: isCur ? 700 : 400 }}>{ratio !== null ? fmtPrice(priceV, sym) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11.5, color: C.textFaint, lineHeight: 1.55, marginTop: 10 }}>
            <b style={{ color: C.textDim }}>Đọc bảng:</b> mỗi dòng Nk là "qua k ngày kể từ ĐỈNH/ĐÁY gần nhất (không phải từ lúc màu nến đổi), 80% trường hợp
            trong lịch sử giá đã đạt tới mức này" — tính trên toàn bộ <b style={{ color: C.textDim }}>{bt.n}</b> lần cặp {sym} từng có D+W cùng chiều rồi rời
            đỉnh/đáy. Cột % theo thang 0–100%+ (100% = đỉnh/đáy cũ trước khi hồi); cột giá quy đổi sang giá thực dựa trên biên độ sóng đẩy hiện tại. Dòng nền
            vàng ("hôm nay") là vị trí hiện tại, ứng với đã hồi {cp.streak} ngày kể từ đỉnh/đáy.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT: mini candlestick chart (SVG thuần, không cần thư viện ngoài) —
// vẽ nến High/Low/Open/Close + đường EMA20 overlay + các đường tham chiếu
// (đáy/đỉnh sóng đẩy, mức TP) cho 1 timeframe.
// ============================================================================
function MiniCandleChart({ bars, ema20, width = 320, height = 150, refLines = [] }) {
  if (!bars || bars.length < 2) return null;
  const n = bars.length;
  const padL = 2, padR = 46, padT = 8, padB = 4; // padR rộng hơn để chừa chỗ ghi nhãn giá bên phải
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
  for (const v of ema20) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  for (const r of refLines) { if (r.value !== null && r.value !== undefined && isFinite(r.value)) { lo = Math.min(lo, r.value); hi = Math.max(hi, r.value); } }
  const pad2 = (hi - lo) * 0.04 || 1; // chừa lề trên/dưới 4% để nhãn không dính mép
  lo -= pad2; hi += pad2;
  const range = hi - lo || 1;
  const y = (v) => padT + (1 - (v - lo) / range) * plotH;
  const slot = plotW / n;
  const x = (i) => padL + i * slot + slot / 2;
  const candleW = Math.max(1.5, slot * 0.6);

  const emaPoints = ema20.map((v, i) => (v !== null ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
      {bars.map((b, i) => {
        const up = b.c >= b.o;
        const color = up ? C.long : C.short;
        const bodyTop = y(Math.max(b.o, b.c));
        const bodyBot = y(Math.min(b.o, b.c));
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={color} strokeWidth={1} />
            <rect x={x(i) - candleW / 2} y={bodyTop} width={candleW} height={Math.max(1, bodyBot - bodyTop)} fill={color} />
          </g>
        );
      })}
      {emaPoints && <polyline points={emaPoints} fill="none" stroke={C.amber} strokeWidth={1.3} opacity={0.85} />}
      {refLines.map((r, idx) => {
        if (r.value === null || r.value === undefined || !isFinite(r.value)) return null;
        const yy = y(r.value);
        return (
          <g key={idx}>
            <line x1={padL} x2={width - padR} y1={yy} y2={yy} stroke={r.color} strokeWidth={1} strokeDasharray={r.dash ? "3,3" : undefined} opacity={0.85} />
            <text x={width - padR + 4} y={yy + 3} fontSize={8.5} fontFamily="'JetBrains Mono', monospace" fill={r.color}>{r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================================
// COMPONENT: 1 dòng badge chỉ báo (EMA20 / RSI14 vs MA10 / Heikin Ashi) — cho biết chỉ báo
// này đang ủng hộ chiều nào, có khớp với side hiện tại không.
// ============================================================================
function IndicatorBadge({ label, valueText, matches }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 8px", borderRadius: 7, background: matches ? C.longSoft : C.bg,
      border: `1px solid ${matches ? C.long + "55" : C.borderSoft}`, marginBottom: 5,
    }}>
      <span style={{ fontSize: 10.5, color: C.textDim }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: matches ? C.long : C.textFaint, fontWeight: matches ? 700 : 400 }}>
        {valueText} {matches ? "✓" : ""}
      </span>
    </div>
  );
}

// ============================================================================
// COMPONENT: modal xem chi tiết Weekly + Daily kèm 3 chỉ báo + đường tham
// chiếu sóng đẩy (đáy/đỉnh, mức TP) — để kiểm chứng trực quan D+W có thật sự
// cùng chiều không, hồi đã tới đâu, và TP nên đặt ở đâu.
// ============================================================================
function DetailChartModal({ item, rawData, onClose }) {
  if (!item || !rawData) return null;
  const { sym, cp, bt } = item;
  const D = rawData.D[sym], W = rawData.W[sym];

  const dFull = computeFullIndicators(D);
  const wFull = computeFullIndicators(W);

  const NBARS_D = 45, NBARS_W = 26;
  const dSlice = D.slice(-NBARS_D);
  const wSlice = W.slice(-NBARS_W);
  const dEmaSlice = dFull.ema20.slice(-NBARS_D);
  const wEmaSlice = wFull.ema20.slice(-NBARS_W);

  const li = D.length - 1, wi = W.length - 1;
  const dClose = D[li].c, dEma = dFull.ema20[li], dRsi = dFull.rsi14[li], dRsiMa = dFull.rsiMa10[li], dHaO = dFull.haOpen[li], dHaC = dFull.haClose[li];
  const wClose = W[wi].c, wEma = wFull.ema20[wi], wRsi = wFull.rsi14[wi], wRsiMa = wFull.rsiMa10[wi], wHaO = wFull.haOpen[wi], wHaC = wFull.haClose[wi];

  const sideColor = cp.side === "long" ? C.long : C.short;
  const todayIdx = cp.streak - 1;

  // Đường tham chiếu vẽ đè lên chart DAILY: đáy/đỉnh sóng đẩy (gốc so sánh) +
  // 3 mức TP80 (+1/+2/+3 ngày kể từ hôm nay) — đúng những gì card đang hiển thị.
  const baseLabel = cp.side === "long" ? "đáy sóng đẩy" : "đỉnh sóng đẩy";
  const peakLabel = cp.side === "long" ? "đỉnh (đang hồi từ đây)" : "đáy (đang hồi từ đây)";
  const refLines = [
    { value: cp.base, color: C.textFaint, label: `0% ${baseLabel}`, dash: true },
    { value: cp.peakVal, color: C.amber, label: `100% ${peakLabel}`, dash: true },
  ];
  for (const off of [1, 2, 3]) {
    const idx = todayIdx + off;
    const ratio = idx < NMAX ? bt.target80ByDay[idx] : null;
    if (ratio === null) continue;
    refLines.push({ value: ratioToPrice(ratio, cp), color: sideColor, label: `TP +${off}d`, dash: false });
  }

  function Section({ title, bars, emaSlice, close, emaV, rsiV, rsiMaV, haO, haC, refLines: rl, height }) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{title}</div>
        <div style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "6px 4px 2px" }}>
          <MiniCandleChart bars={bars} ema20={emaSlice} refLines={rl || []} height={height} />
        </div>
        <div style={{ marginTop: 8 }}>
          <IndicatorBadge label={`Close (${close.toFixed(sym.includes("JPY") ? 3 : 5)}) vs EMA20 (${emaV.toFixed(sym.includes("JPY") ? 3 : 5)})`}
            valueText={close > emaV ? "Close > EMA20 (tăng)" : "Close < EMA20 (giảm)"} matches={true} />
          <IndicatorBadge label={`RSI14 (${rsiV.toFixed(1)}) vs MA10 (${rsiMaV !== null ? rsiMaV.toFixed(1) : "—"})`}
            valueText={rsiMaV !== null ? (rsiV > rsiMaV ? "RSI > MA10 (tăng)" : "RSI < MA10 (giảm)") : "chưa đủ dữ liệu"} matches={true} />
          <IndicatorBadge label="Heikin Ashi" valueText={haC > haO ? "Nến HA xanh (tăng)" : "Nến HA đỏ (giảm)"} matches={true} />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.panel, borderTop: `1px solid ${C.border}`, borderRadius: "18px 18px 0 0",
          width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", padding: "16px 16px 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>{sym}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 700, padding: "2.5px 7px", borderRadius: 5, background: cp.side === "long" ? C.longSoft : C.shortSoft, color: sideColor }}>
              {cp.side === "long" ? "LONG" : "SHORT"}
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Tóm tắt sóng đẩy hiện tại */}
        <div style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
            Sóng đẩy: <b style={{ color: C.text }}>{fmtPrice(cp.base, sym)}</b> ({baseLabel}) → <b style={{ color: C.text }}>{fmtPrice(cp.peakVal, sym)}</b> ({peakLabel}),
            đỉnh/đáy ngày <b style={{ color: C.text }}>{D[cp.peakIdx].d}</b>. Đang hồi <b style={{ color: C.amber }}>{cp.streak} ngày</b>, đã chạm{" "}
            <b style={{ color: C.amber }}>{fmtPct(cp.retr)}</b> biên độ. Giá đóng cửa gần nhất <b style={{ color: C.text }}>{fmtPrice(dClose, sym)}</b>.
          </div>
        </div>

        <Section title={`Daily (${NBARS_D} phiên gần nhất) — có vẽ sóng đẩy + TP`} bars={dSlice} emaSlice={dEmaSlice} close={dClose} emaV={dEma} rsiV={dRsi} rsiMaV={dRsiMa} haO={dHaO} haC={dHaC} refLines={refLines} height={170} />
        <Section title={`Weekly (${NBARS_W} tuần gần nhất)`} bars={wSlice} emaSlice={wEmaSlice} close={wClose} emaV={wEma} rsiV={wRsi} rsiMaV={wRsiMa} haO={wHaO} haC={wHaC} />

        <p style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.55, marginTop: 4 }}>
          App chỉ cần <b style={{ color: C.textDim }}>1 trong 3</b> chỉ báo (EMA20 / RSI14 so MA10 của chính nó / màu nến Heikin Ashi) đồng thuận trên <b style={{ color: C.textDim }}>cả 2 khung</b> (Daily
          &amp; Weekly) là đủ để xác nhận "cùng chiều". Trên chart Daily: đường vàng = EMA20, đường xám chấm chấm = đáy/đỉnh sóng đẩy (0%/100%), đường màu{" "}
          {cp.side === "long" ? "xanh" : "đỏ"} liền nét = các mức TP80 tương ứng thẻ "+1/+2/+3 ngày" trên card.
        </p>
      </div>
    </div>
  );
}

const thStyle = { padding: "6px 4px", textAlign: "right", borderBottom: `1px solid ${C.borderSoft}`, color: C.textFaint, fontWeight: 500, fontSize: 10, textTransform: "uppercase" };
const tdStyle = { padding: "6px 4px", textAlign: "right", borderBottom: `1px solid ${C.borderSoft}` };
const tdStyleLeft = { ...tdStyle, textAlign: "left", color: C.textDim };

// Card MỜ cho các cặp từng active hôm qua nhưng hôm nay không còn phù hợp —
// vẫn hiện trong đúng danh mục để có ngữ cảnh, nhưng giảm độ nổi bật rõ rệt
// so với các cặp đang active, kèm lý do cụ thể.
function ClosedCard({ w }) {
  const r = REASON_LABEL[w.reason];
  const clr = r.color === "long" ? C.long : r.color === "short" ? C.short : C.amber;
  return (
    <div style={{
      opacity: 0.45,
      background: C.panel,
      border: `1px solid ${C.borderSoft}`,
      borderRadius: 14,
      padding: "10px 14px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: C.textDim }}>{w.sym}</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, padding: "1.5px 6px", borderRadius: 4,
          background: "transparent", border: `1px solid ${C.textFaint}`, color: C.textFaint,
        }}>
          {w.side === "long" ? "LONG" : "SHORT"} hôm qua
        </span>
        <span style={{ marginLeft: "auto", fontSize: 14 }}>{r.icon}</span>
      </div>
      <div style={{ fontSize: 11, color: clr, marginTop: 4 }}>{r.text}</div>
    </div>
  );
}

function StatBox({ k, v }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, borderRadius: 9, padding: "8px 9px" }}>
      <div style={{ fontSize: 9.5, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace" }}>{k}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5, fontWeight: 700, marginTop: 3, color: C.text }}>{v}</div>
    </div>
  );
}

// ============================================================================
// SO SÁNH VỚI HÔM TRƯỚC — không lưu trữ gì cả. Vì đã có sẵn toàn bộ lịch sử
// OHLC, chỉ cần chạy LẠI đúng thuật toán trên dữ liệu cắt bớt 1 nến cuối
// (D.slice(0, -1)) để biết chính xác trạng thái "hôm qua" app từng hiển thị,
// rồi so trực tiếp với "hôm nay" — không cần localStorage, hoạt động ngay cả
// lần đầu mở trên thiết bị mới.
// ============================================================================
function analyzeSymbol(D, W) {
  const dInd = buildIndicators(D);
  const wInd = buildIndicators(W);
  const { outUp: wUpM, outDown: wDownM } = mapWeeklyToDaily(D, W, wInd.up, wInd.down);
  const cp = getCurrentPullback(D, dInd.up, dInd.down, wUpM, wDownM);
  if (!cp) return { cp: null, bt: null, valid: false };
  const bt = runBacktest(D, dInd.up, dInd.down, wUpM, wDownM, cp.side);
  // Kiểm tra target NGÀY MAI (vị trí streak trong mảng 0-based) đã bị giá
  // CHẠM TỚI chưa — dùng extSoFar (mức cao/thấp nhất giá ĐÃ TỪNG chạm kể từ
  // đỉnh/đáy), KHÔNG dùng giá đóng cửa cuối cùng. Nếu chỉ so giá đóng cửa,
  // trường hợp giá đã bật lên chạm target rồi lùi lại nhẹ sẽ bị tính nhầm là
  // "chưa đạt" và tiếp tục hiện — đúng bug đã gặp.
  const nextIdx = cp.streak; // todayIdx (streak-1) + 1
  const nextRatio = nextIdx < NMAX ? bt.target80ByDay[nextIdx] : null;
  let valid = true;
  if (nextRatio !== null) {
    valid = cp.extSoFar < nextRatio;
  }
  return { cp, bt, valid };
}

const REASON_LABEL = {
  flipped: { text: "Đảo chiều hoàn toàn (Long ↔ Short) — nên chốt ngay", color: "short", icon: "⛔" },
  ended: { text: "Hồi đã kết thúc / D+W không còn thẳng hàng", color: "amber", icon: "⚠" },
  tp_reached: { text: "Giá đã vượt TP80 (2 ngày) — có thể đã đạt mục tiêu", color: "long", icon: "✓" },
};

// ============================================================================
// MAIN APP
// ============================================================================
export default function SongDayScreener() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [items, setItems] = useState([]); // tín hiệu đang active hôm nay
  const [closedItems, setClosedItems] = useState([]); // từng active hôm qua, hôm nay không còn -> hiển thị mờ
  const [generatedAt, setGeneratedAt] = useState(null);
  const [totalScanned, setTotalScanned] = useState(0);
  const [tab, setTab] = useState("Tất cả");
  const [openSym, setOpenSym] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rawData, setRawData] = useState(null); // giữ nguyên raw.D/raw.W để mở modal chart chi tiết
  const [detailItem, setDetailItem] = useState(null); // item (sym+cp+bt) đang xem chart chi tiết (null = đóng)

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      setErrMsg("");
      try {
        const res = await fetch(DATA_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const raw = await res.json();
        const symbols = Object.keys(raw.D).filter((s) => !EXCLUDED_SYMBOLS.includes(s));
        const out = [];
        const closed = [];
        for (const sym of symbols) {
          const D = raw.D[sym], W = raw.W[sym];
          if (!D || !W || D.length < 121 || W.length < 60) continue;

          const today = analyzeSymbol(D, W);
          if (today.cp && today.valid) out.push({ sym, cp: today.cp, bt: today.bt });

          // "Hôm qua" = chạy lại ĐÚNG thuật toán trên dữ liệu cắt bớt 1 nến
          // cuối — không cần lưu trữ gì, tự tính lại được ngay mỗi lần load.
          const yesterday = analyzeSymbol(D.slice(0, D.length - 1), W);
          if (yesterday.cp && yesterday.valid) {
            const stillActiveSameSide = today.cp && today.valid && today.cp.side === yesterday.cp.side;
            if (!stillActiveSameSide) {
              let reason;
              if (today.cp && today.cp.side !== yesterday.cp.side) reason = "flipped";
              else if (today.cp && today.cp.side === yesterday.cp.side && !today.valid) reason = "tp_reached";
              else reason = "ended";
              closed.push({ sym, side: yesterday.cp.side, reason, lastClose: D[D.length - 1].c });
            }
          }
        }
        out.sort((a, b) => a.cp.streak - b.cp.streak);

        if (!cancelled) {
          setItems(out);
          setClosedItems(closed);
          setTotalScanned(symbols.length);
          setGeneratedAt(raw.generatedAt);
          setRawData(raw);
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

  // Gộp active + closed vào chung từng danh mục để hiển thị cùng lúc (active
  // rõ nét, closed làm mờ) — không tách banner riêng.
  const grouped = useMemo(() => {
    const activeFiltered = tab === "Tất cả" ? items : items.filter((x) => CATEGORY[x.sym] === tab);
    const closedFiltered = tab === "Tất cả" ? closedItems : closedItems.filter((x) => CATEGORY[x.sym] === tab);
    const byCat = {};
    for (const it of activeFiltered) {
      const c = CATEGORY[it.sym];
      (byCat[c] = byCat[c] || { active: [], closed: [] }).active.push(it);
    }
    for (const it of closedFiltered) {
      const c = CATEGORY[it.sym];
      (byCat[c] = byCat[c] || { active: [], closed: [] }).closed.push(it);
    }
    for (const c in byCat) byCat[c].active.sort((a, b) => a.cp.streak - b.cp.streak || b.cp.retr - a.cp.retr);
    return byCat;
  }, [items, closedItems, tab]);

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
            <b style={{ color: C.text }}>Daily &amp; Weekly cùng chiều</b> (chỉ cần 1 trong 3 chỉ báo: EMA20/RSI14 vs MA10/Heikin Ashi),{" "}
            <b style={{ color: C.text }}>nến hiện tại đang hồi ngược</b>, và <b style={{ color: C.text }}>target 80% (2 ngày) vẫn còn ở phía trước giá</b> —
            rồi tra lại xác
            suất lịch sử của chính cặp đó: hồi bao sâu, đạt lại target với xác suất 80% trong bao nhiêu ngày.
          </p>

          {status === "ready" && (
            <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: C.textFaint }}>
              <span><b style={{ color: C.textDim }}>{totalScanned}</b> cặp quét</span>
              <span><b style={{ color: C.textDim }}>{items.length}</b> cặp đang hồi thỏa điều kiện</span>
              <span>Nguồn: cache D/W GitHub Action, tự quét lúc 4:10 &amp; 7:10 sáng giờ VN mỗi ngày (Twelve Data)</span>
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

        {status === "ready" && items.length === 0 && closedItems.length === 0 && (
          <div style={{ border: `1px dashed ${C.border}`, borderRadius: 14, padding: "32px 20px", textAlign: "center", color: C.textDim, fontSize: 13.5, marginTop: 10 }}>
            Hiện <b style={{ color: C.text }}>không có cặp nào</b> thỏa điều kiện (Daily &amp; Weekly cùng chiều + đang hồi) lúc này. Quay lại sau — điều kiện
            được đánh giá lại mỗi lần dữ liệu D/W cập nhật.
          </div>
        )}

        {status === "ready" && (items.length > 0 || closedItems.length > 0) && catsToShow.map((c) => {
          const g = grouped[c] || { active: [], closed: [] };
          if (g.active.length === 0 && g.closed.length === 0) return null;
          return (
            <div key={c}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, margin: "18px 2px 8px" }}>
                {c} ({g.active.length}{g.closed.length > 0 ? ` +${g.closed.length} đã đóng` : ""})
              </div>
              {g.active.map((item) => (
                <PairCard key={item.sym} item={item} open={openSym === item.sym} onToggle={() => setOpenSym(openSym === item.sym ? null : item.sym)} onInfo={setDetailItem} />
              ))}
              {g.closed.map((w) => (
                <ClosedCard key={w.sym} w={w} />
              ))}
            </div>
          );
        })}

        {status === "ready" && (
          <div style={{ marginTop: 34, paddingTop: 16, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
            Phương pháp: Daily &amp; Weekly cùng chiều khi <b>≥1 trong 3</b> chỉ báo (Close so EMA20, RSI14 so MA10 của chính nó, màu nến Heikin Ashi) đồng thuận trên mỗi khung — không cần cả 3 cùng lúc,
            áp dụng như nhau cho cả Daily và Weekly. "Sóng đẩy" = chuỗi ≥2 nến liên tiếp cùng chiều Weekly; "Hồi" bắt đầu từ nến ngược chiều đầu tiên sau chuỗi đó,
            <b>chỉ chấp nhận 1-3 ngày</b> — từ 4 ngày trở đi loại bỏ hoàn toàn do nguy cơ đảo chiều. Target 80% = percentile 20 của phân phối mở rộng
            lũy kế trong lịch sử của chính từng cặp. Đây là thống kê mô tả quá khứ, không phải khuyến nghị đầu tư.
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

      {detailItem && <DetailChartModal item={detailItem} rawData={rawData} onClose={() => setDetailItem(null)} />}
    </div>
  );
}
