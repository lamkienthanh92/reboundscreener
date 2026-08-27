// scripts/fetch-screener-data.mjs
//
// Chạy 1 lần/ngày (qua GitHub Actions, xem .github/workflows/fetch-data.yml).
// Tải Ngày + Tuần (OHLC thật) cho toàn bộ cặp trong PAIRS từ Twelve Data,
// ghi ra data/screener-data.json. App React đọc file JSON tĩnh này thay vì
// gọi Twelve Data trực tiếp mỗi lần người dùng mở trang — nên rate-limit của
// Twelve Data không còn là vấn đề của người dùng cuối nữa, chỉ là vấn đề của
// job nền này (chạy chậm cỡ nào cũng được, không ai đứng chờ).
//
// Chạy thử ở máy local:
//   TWELVE_DATA_KEY=xxxx node scripts/fetch-screener-data.mjs
//
// Cần Node 18+ (có fetch() sẵn, không cần cài thêm gói nào).

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;
if (!TWELVE_DATA_KEY) {
  console.error("Thiếu biến môi trường TWELVE_DATA_KEY.");
  process.exit(1);
}

// ---- Danh sách cặp — PHẢI khớp với PAIRS trong App.js (base/quote/crypto) ----
const P = (base, quote, group) => ({
  key: (base + quote).toLowerCase(),
  label: `${base}/${quote}`,
  base,
  quote,
  group,
});
const PAIRS = [
  P("EUR", "USD", "Major"),
  P("GBP", "USD", "Major"),
  P("USD", "JPY", "Major"),
  P("USD", "CHF", "Major"),
  P("AUD", "USD", "Major"),
  P("NZD", "USD", "Major"),
  P("USD", "CAD", "Major"),
  P("EUR", "GBP", "Chéo"),
  P("EUR", "JPY", "Chéo"),
  P("GBP", "JPY", "Chéo"),
  P("EUR", "CHF", "Chéo"),
  P("EUR", "CAD", "Chéo"),
  P("EUR", "AUD", "Chéo"),
  P("AUD", "JPY", "Chéo"),
  P("CAD", "JPY", "Chéo"),
  P("GBP", "CAD", "Chéo"),
  P("AUD", "NZD", "Chéo"),
  P("USD", "NOK", "Hàng hóa/EM"),
  P("USD", "SEK", "Hàng hóa/EM"),
  P("USD", "ZAR", "Hàng hóa/EM"),
  P("USD", "MXN", "Hàng hóa/EM"),
  { key: "btcusdt", label: "BTC/USD", base: "BTC", quote: "USDT", group: "Crypto", crypto: true },
];
const tdSymbol = (cfg) => (cfg.crypto ? "BTC/USD" : cfg.label);

const TF_INTERVAL = { D: "1day", W: "1week" };
const TF_OUTSIZE = { D: 2500, W: 500 };

function parseTwelveBars(values) {
  return (values || [])
    .map((v) => ({
      t: Date.parse(v.datetime.replace(" ", "T") + "Z"),
      d: v.datetime,
      o: +v.open,
      h: +v.high,
      l: +v.low,
      c: +v.close,
    }))
    .filter(
      (b) =>
        Number.isFinite(b.t) &&
        Number.isFinite(b.o) &&
        Number.isFinite(b.h) &&
        Number.isFinite(b.l) &&
        Number.isFinite(b.c)
    )
    .sort((a, b) => a.t - b.t);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url) {
  const res = await fetch(url);
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  const rateLimited =
    res.status === 429 ||
    (j &&
      (j.code === 429 ||
        /run out of api credits|api rate limit/i.test(j.message || "")));
  if (rateLimited) {
    const err = new Error((j && j.message) || "Twelve Data rate limit (429)");
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  if (j == null) throw new Error("Phản hồi không phải JSON hợp lệ");
  return j;
}

// Tải 1 symbol/1 khung, tự lùi lại chờ khi đụng rate-limit (free: 8 credit/phút).
async function fetchOne(symbol, interval, outputsize) {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}&outputsize=${outputsize}&timezone=UTC&order=ASC&apikey=${TWELVE_DATA_KEY}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const j = await fetchJSON(url);
      if (j.status === "error" || j.code >= 400)
        throw new Error(j.message || `Twelve Data lỗi (${symbol} ${interval})`);
      if (!j.values || !j.values.length)
        throw new Error(`Không có dữ liệu cho ${symbol} ${interval}`);
      const bars = parseTwelveBars(j.values);
      if (bars.length < 30) throw new Error(`Chuỗi ${symbol} ${interval} quá ngắn`);
      return bars;
    } catch (e) {
      if (!e.rateLimited) throw e;
      const waitMs = 20000 + attempt * 20000;
      console.log(
        `  [rate-limit] ${symbol} ${interval} — chờ ${waitMs / 1000}s (lần ${attempt + 1}/4)…`
      );
      await sleep(waitMs);
    }
  }
  throw new Error(`${symbol} ${interval}: hết lượt thử vì rate-limit`);
}

async function main() {
  const store = { generatedAt: new Date().toISOString(), D: {}, W: {} };
  const failures = [];
  for (const tf of ["D", "W"]) {
    for (const cfg of PAIRS) {
      const symbol = tdSymbol(cfg);
      process.stdout.write(`Tải ${tf} — ${symbol}… `);
      try {
        const bars = await fetchOne(symbol, TF_INTERVAL[tf], TF_OUTSIZE[tf]);
        store[tf][symbol] = bars;
        console.log(`OK (${bars.length} nến)`);
      } catch (e) {
        console.log(`LỖI: ${e.message}`);
        failures.push(`${tf} ${symbol}: ${e.message}`);
      }
      // Free tier: 8 credit/phút ⇒ ~7.8s/request. Job nền, không ai đứng chờ nên cứ an toàn.
      await sleep(7800);
    }
  }

  const totalD = Object.keys(store.D).length;
  const totalW = Object.keys(store.W).length;
  if (totalD < PAIRS.length * 0.5) {
    console.error(
      `Quá nhiều cặp lỗi ở khung Ngày (${totalD}/${PAIRS.length}) — dừng, không ghi đè cache cũ.`
    );
    if (failures.length) console.error(failures.join("\n"));
    process.exit(1);
  }

  const fs = await import("node:fs/promises");
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile("data/screener-data.json", JSON.stringify(store));

  console.log(`\nXong: D=${totalD}/${PAIRS.length}, W=${totalW}/${PAIRS.length}`);
  if (failures.length) {
    console.log(`Có ${failures.length} lỗi (không chặn ghi file):\n` + failures.join("\n"));
  }
}

main().catch((e) => {
  console.error("Lỗi không xử lý được:", e);
  process.exit(1);
});
