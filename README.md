# Sóng Đẩy — Bộ lọc hồi kỹ thuật D+W

App React (Vite) quét 22 cặp FX/crypto, lọc ra những cặp đang **Daily & Weekly
cùng chiều xu hướng** (EMA50 + RSI14 + MACD) **và** nến hiện tại đang hồi
ngược màu — rồi backtest lại chính lịch sử của từng cặp đó để trả lời:
hồi bao sâu, và với xác suất 80% giá sẽ đạt lại target ở mức nào, trong bao
nhiêu ngày.

## Chạy thử ngay (cách nhanh nhất)

App đọc dữ liệu D+W trực tiếp từ file JSON cache công khai trên GitHub
(`raw.githubusercontent.com/lamkienthanh92/fx-cmt-app/main/data/screener-data.json`,
repo `fx-cmt-app` gốc của bạn). Nghĩa là **không cần cấu hình gì thêm** — chỉ cần:

```bash
npm install
npm run dev
```

Mở `http://localhost:5173`, app tự fetch JSON và tính toán ngay trong trình
duyệt (không cần backend riêng).

## Cấu trúc

```
src/
  main.jsx              # entry point
  SongDayScreener.jsx    # toàn bộ logic + UI (indicators, backtest, mapping table)
scripts/
  fetch-screener-data.mjs  # (tuỳ chọn) script tải OHLC từ Twelve Data
.github/workflows/
  fetch-data.yml          # (tuỳ chọn) GitHub Action tự refresh data hàng ngày
data/
  screener-data.json      # (tuỳ chọn) cache tĩnh nếu bạn muốn tự host riêng
```

## Muốn tự host data riêng (không phụ thuộc repo gốc)?

Nếu bạn tách app này ra thành repo độc lập và muốn nó tự fetch/host dữ liệu
của chính nó (không phụ thuộc `fx-cmt-app` gốc nữa):

1. Push repo này lên GitHub (nên để public để `raw.githubusercontent.com`
   không cần token).
2. Thêm secret `TWELVE_DATA_KEY` (API key Twelve Data) ở
   Settings → Secrets and variables → Actions.
3. Bật Actions, chạy thử thủ công tab **Actions** → workflow "Fetch screener
   data (Daily + Weekly OHLC)" → **Run workflow** — lần này sẽ tạo
   `data/screener-data.json` lần đầu. Từ đó workflow tự chạy **mỗi ngày lúc
   5:00 sáng giờ Việt Nam** (cron `"0 22 * * *"` UTC, xem
   `.github/workflows/fetch-data.yml`) — đổi giờ tại dòng `cron` nếu muốn giờ
   khác.
4. Sửa hằng số `DATA_URL` ở đầu file `src/SongDayScreener.jsx`, trỏ về đúng
   repo/branch của bạn:

   ```js
   const DATA_URL =
     "https://raw.githubusercontent.com/<username>/<repo>/main/data/screener-data.json";
   ```

Nếu bỏ qua bước này, app vẫn chạy bình thường — chỉ là đang đọc chung data
với repo gốc `fx-cmt-app`.

## Phương pháp tính (tóm tắt)

- **Xu hướng D/W**: chỉ cần **1 trong 3** chỉ báo xác nhận là đủ (không cần
  cả 3 đồng thuận cùng lúc):
  - Close so với EMA50, hoặc
  - RSI14 > 50 (tăng) / < 50 (giảm), hoặc
  - MACD(12,26,9) cùng chiều so với đường Signal.
- **"Hồi"**: chuỗi nến ngược màu liên tiếp tính từ ngày nến đảo chiều gần
  nhất trong xu hướng đang xác nhận.
- **Sóng đẩy (impulse)**: đo từ swing-pivot 3-nến gần nhất tới đỉnh/đáy ngay
  trước khi hồi.
- **Bucket độ sâu hồi**: `<10% / 10-20% / 20-30% / 30-40% / 40-50% / ≥50%`
  biên độ sóng đẩy.
- **Target 80%**: percentile thứ 20 của phân phối mức mở rộng lũy kế
  (0% = đáy sóng đẩy, 100% = đỉnh/đáy cũ trước khi hồi), tính riêng theo
  từng bucket, từng cặp, từng chiều Long/Short — dựa trên **toàn bộ lịch sử
  ~2500 phiên** (khoảng 9-10 năm) của chính cặp đó.
- **Giá TP thực tế**: mỗi card hiển thị thẳng ô "TP xác suất 80% ngay tại
  thời điểm hiện tại" quy đổi từ % thang sóng đẩy sang **giá cụ thể** (dựa
  trên đáy/đỉnh sóng đẩy + biên độ hiện tại của chính cặp đó), không chỉ số
  % trừu tượng. Bảng chi tiết (bấm vào card) liệt kê giá TP80 cho từng ngày
  N1–N10 kể từ lúc bắt đầu hồi.

Đây là công cụ thống kê mô tả dữ liệu quá khứ, **không phải khuyến nghị đầu
tư**.

## Build production

```bash
npm run build   # -> dist/
npm run preview # xem thử bản build
```

Deploy lên Netlify: đã có sẵn `netlify.toml` (build command `npm run build`,
publish `dist`).
