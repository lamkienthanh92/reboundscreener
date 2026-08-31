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
const EXCLUDED_SYMBOLS = ["USD/SEK", "USD/MXN"];

const NMAX = 20; // đủ dài để cover các đợt hồi kéo dài nhiều ngày
const LOOKBACK = 40;
const PIVWIN = 3;

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
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const { line, signal } = macd(closes);
  // Chỉ cần 1 trong 3 chỉ báo xác nhận là đủ (OR), không cần cả 3 đồng thuận (AND) như trước.
  const up = closes.map((c, i) =>
    c > ema20[i] || (rsi14[i] !== null && rsi14[i] > 50) || line[i] > signal[i]
  );
  const down = closes.map((c, i) =>
    c < ema20[i] || (rsi14[i] !== null && rsi14[i] < 50) || line[i] < signal[i]
  );
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
// TRẠNG THÁI HỒI tại 1 ngày bất kỳ (idx) — đỉnh/đáy = PIVOT 3-NẾN GẦN NHẤT
// (đã có sẵn trong lowIdx/highIdx), KHÔNG dùng cửa sổ N-ngày cố định. Cách này
// tránh 2 lỗi: (1) màu nến ngược xen giữa làm reset streak về 1 dù giá vẫn xa
// đỉnh; (2) cửa sổ cố định bắt nhầm đỉnh cũ trước 1 cú sập mạnh làm mốc, gây
// streak/retracement vô lý (300%+, hàng chục ngày) khi giá đã lập đỉnh MỚI gần
// hơn (thấp hơn) sau cú sập. "streak" = số ngày kể từ pivot gần nhất đó.
// ============================================================================
const MAX_STREAK = 15; // hồi quá 15 ngày không còn là pullback ngắn hạn nữa

function pullbackStateAt(D, idx, lowIdx, highIdx, side) {
  if (side === "long") {
    const priorHighs = highIdx.filter((p) => p < idx);
    if (!priorHighs.length) return null;
    const peakIdx = priorHighs[priorHighs.length - 1];
    const peakVal = D[peakIdx].h;
    const streak = idx - peakIdx;
    if (streak > MAX_STREAK) return null;
    const priorLows = lowIdx.filter((p) => p < peakIdx && p >= peakIdx - LOOKBACK);
    if (!priorLows.length) return null;
    const pIdx = priorLows[priorLows.length - 1];
    if (peakIdx - 1 <= pIdx) return null;
    const plow = D[pIdx].l;
    const impulse = peakVal - plow;
    if (impulse <= 0) return null;
    let curMin = Infinity;
    for (let j = peakIdx + 1; j <= idx; j++) curMin = Math.min(curMin, D[j].l);
    const retr = (peakVal - curMin) / impulse;
    return { side, streak, retr, impulse, base: plow, peakIdx, peakVal };
  } else {
    const priorLows = lowIdx.filter((p) => p < idx);
    if (!priorLows.length) return null;
    const troughIdx = priorLows[priorLows.length - 1];
    const troughVal = D[troughIdx].l;
    const streak = idx - troughIdx;
    if (streak > MAX_STREAK) return null;
    const priorHighs = highIdx.filter((p) => p < troughIdx && p >= troughIdx - LOOKBACK);
    if (!priorHighs.length) return null;
    const pIdx = priorHighs[priorHighs.length - 1];
    if (troughIdx - 1 <= pIdx) return null;
    const phigh = D[pIdx].h;
    const impulse = phigh - troughVal;
    if (impulse <= 0) return null;
    let curMax = -Infinity;
    for (let j = troughIdx + 1; j <= idx; j++) curMax = Math.max(curMax, D[j].h);
    const retr = (curMax - troughVal) / impulse;
    return { side, streak, retr, impulse, base: phigh, peakIdx: troughIdx, peakVal: troughVal };
  }
}

function getCurrentPullback(D, dUp, dDown, wUpM, wDownM, lowIdx, highIdx) {
  const last = D.length - 1;
  let side = null;
  if (dUp[last] && wUpM[last]) side = "long";
  else if (dDown[last] && wDownM[last]) side = "short";
  if (!side) return null;
  const st = pullbackStateAt(D, last, lowIdx, highIdx, side);
  if (!st) return null;
  return { ...st, entryDate: D[st.peakIdx + 1].d, lastDate: D[last].d, lastClose: D[last].c };
}

// ============================================================================
// BACKTEST: mẫu = NGÀY ĐẦU TIÊN rời đỉnh/đáy (streak===1 tại ngày đó, tức hôm
// trước chính là đỉnh/đáy). extByDay[m] = mức mở rộng lũy kế qua (m+1) ngày kể
// từ đỉnh/đáy đó — nên tra thẳng bằng "streak-1" là ra đúng vị trí hôm nay,
// "streak" là vị trí ngày mai, v.v. Không chia bucket, không giả định streak=1.
// ============================================================================
function runBacktest(D, dUp, dDown, wUpM, wDownM, lowIdx, highIdx, side) {
  const extByDayRows = [];
  for (let i = 60; i < D.length; i++) {
    if (side === "long") { if (!(dUp[i] && wUpM[i])) continue; }
    else { if (!(dDown[i] && wDownM[i])) continue; }
    const st = pullbackStateAt(D, i, lowIdx, highIdx, side);
    if (!st || st.streak !== 1) continue; // chỉ lấy ngày đầu tiên rời đỉnh/đáy
    if (i + NMAX - 1 >= D.length) continue;

    const extByDay = [];
    let cumMin = D[i].l, cumMax = D[i].h;
    extByDay.push(side === "long" ? (cumMax - st.base) / st.impulse : (st.base - cumMin) / st.impulse);
    for (let k = 1; k < NMAX; k++) {
      const idx = i + k;
      cumMin = Math.min(cumMin, D[idx].l);
      cumMax = Math.max(cumMax, D[idx].h);
      extByDay.push(side === "long" ? (cumMax - st.base) / st.impulse : (st.base - cumMin) / st.impulse);
    }
    extByDayRows.push(extByDay);
  }

  // Target80ByDay[m] = mức mà 80% xác suất giá ĐÃ đạt tới qua (m+1) ngày kể từ
  // đỉnh/đáy (percentile thứ 20, vì "đạt >= V với xác suất 80%" <=> V = pct20).
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
function PairCard({ item, open, onToggle }) {
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
  const { lowIdx, highIdx } = findPivots(D, PIVWIN);
  const cp = getCurrentPullback(D, dInd.up, dInd.down, wUpM, wDownM, lowIdx, highIdx);
  if (!cp) return { cp: null, bt: null, valid: false };
  const bt = runBacktest(D, dInd.up, dInd.down, wUpM, wDownM, lowIdx, highIdx, cp.side);
  // Kiểm tra target NGÀY MAI (1 ngày kể từ HÔM NAY, tức vị trí streak trong
  // mảng 0-based) đã bị giá vượt qua chưa — dùng đúng vị trí hiện tại (streak)
  // thay vì cố định "ngày 2" như trước, vì streak giờ có thể là bất kỳ số nào.
  const nextIdx = cp.streak; // todayIdx (streak-1) + 1
  const nextRatio = nextIdx < NMAX ? bt.target80ByDay[nextIdx] : null;
  let valid = true;
  if (nextRatio !== null) {
    const nextPrice = ratioToPrice(nextRatio, cp);
    const alreadyPassed = cp.side === "long" ? nextPrice <= cp.lastClose : nextPrice >= cp.lastClose;
    valid = !alreadyPassed;
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
            <b style={{ color: C.text }}>Daily &amp; Weekly cùng chiều</b> (chỉ cần 1 trong 3 chỉ báo: EMA20/RSI14/MACD),{" "}
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
                <PairCard key={item.sym} item={item} open={openSym === item.sym} onToggle={() => setOpenSym(openSym === item.sym ? null : item.sym)} />
              ))}
              {g.closed.map((w) => (
                <ClosedCard key={w.sym} w={w} />
              ))}
            </div>
          );
        })}

        {status === "ready" && (
          <div style={{ marginTop: 34, paddingTop: 16, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
            Phương pháp: xu hướng D/W xác nhận khi <b>≥1 trong 3</b> chỉ báo đồng thuận (Close so EMA20, RSI14 &gt;/&lt; 50, MACD(12,26,9) cắt Signal) — không cần
            cả 3 cùng lúc; "hồi" = số ngày kể từ ĐỈNH/ĐÁY pivot 3-nến gần nhất (không phải đếm nến ngược màu liên tiếp, tối đa 15 ngày mới còn tính là hồi ngắn hạn);
            biên độ sóng đẩy đo từ swing-pivot 3-nến gần nhất tới đỉnh/đáy trước khi hồi. Target 80% = percentile 20 của phân phối mở rộng lũy kế trong lịch sử
            của chính từng cặp, theo từng mức hồi đã chạm. Đây là thống kê mô tả quá khứ, không phải khuyến nghị đầu tư.
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}
