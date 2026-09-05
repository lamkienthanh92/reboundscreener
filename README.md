# Sóng Đẩy — Bộ lọc hồi kỹ thuật (Daily / Weekly độc lập)

App React (Vite) quét 18 cặp FX/crypto (22 cặp gốc, trừ 4 cặp sàn không hỗ
trợ: USD/SEK, USD/MXN, USD/ZAR, USD/NOK). **Daily và Weekly là 2 hệ thống
hoàn toàn độc lập** (không còn yêu cầu 2 khung phải cùng chiều) — mỗi khung tự
xác định xu hướng bằng **Williams %R(21) so với MA13 của chính nó**, tìm nến
ngược chiều trong xu hướng đó (streak 1-3 kỳ), rồi backtest lại chính lịch sử
của từng cặp để trả lời: trong N kỳ tới, 80% trường hợp quá khứ giá đã đạt
tới mức nào. Weekly chỉ được tính **sau khi tuần đã đóng** (không dùng nến
tuần còn đang hình thành).

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
   4:10 và 7:10 sáng giờ Việt Nam** (2 dòng `cron`: `"10 21 * * *"` và
   `"10 0 * * *"` UTC, xem `.github/workflows/fetch-data.yml`) — sửa/thêm
   dòng `cron` nếu muốn đổi giờ hoặc số lần chạy.
4. Sửa hằng số `DATA_URL` ở đầu file `src/SongDayScreener.jsx`, trỏ về đúng
   repo/branch của bạn:

   ```js
   const DATA_URL =
     "https://raw.githubusercontent.com/<username>/<repo>/main/data/screener-data.json";
   ```

Nếu bỏ qua bước này, app vẫn chạy bình thường — chỉ là đang đọc chung data
với repo gốc `fx-cmt-app`.

## Phương pháp tính (tóm tắt)

- **Xu hướng**: chỉ **1 chỉ báo duy nhất** — Williams %R(21) so với MA13 của
  chính nó. WR &gt; MA13(WR) = tăng, WR &lt; MA13(WR) = giảm. Tính **độc lập**
  trên Daily và trên Weekly — không còn yêu cầu 2 khung phải cùng chiều.
- **Daily / Weekly độc lập**: đây là 2 hệ thống tách biệt hoàn toàn, mỗi khung
  tự chạy toàn bộ pipeline (xu hướng → sóng đẩy → hồi → backtest → TP80) trên
  chính dữ liệu của khung đó. Weekly chỉ được tính khi tuần đã đóng (kiểm tra
  qua `getCompletedWeeklyBars` — nếu tuần cuối trong dữ liệu chưa đủ 6 ngày kể
  từ nến daily gần nhất, bỏ tuần đó, dùng tuần liền trước).
- **Sóng đẩy**: chuỗi **≥2 nến liên tiếp cùng chiều xu hướng của khung đó**
  (1 nến ngược màu đơn lẻ xen giữa không tính là chuỗi mới, chỉ là nhiễu). Đáy
  sóng đẩy mở rộng bao gồm đáy của sóng ngược chiều liền trước (nếu thấp hơn);
  đỉnh sóng đẩy mở rộng bao gồm đỉnh của nến đảo chiều đầu tiên ngay sau chuỗi
  (nếu cao hơn — trường hợp wick vượt lên trước khi đóng cửa ngược hướng).
- **"Hồi"**: số kỳ (ngày hoặc tuần, tùy khung) kể từ kỳ cuối cùng của chuỗi
  sóng đẩy đó. **Chỉ chấp nhận 1-3 kỳ** — từ kỳ thứ 4 trở đi loại bỏ hoàn toàn
  do nguy cơ đảo chiều.
- **Target 80%**: với mỗi cặp + mỗi chiều + mỗi khung, gộp **toàn bộ lịch sử**
  các lần từng khớp đúng mẫu hình (xu hướng đúng rồi rời sóng đẩy), rồi với
  mỗi mốc N kỳ kể từ lúc bắt đầu hồi (N1…N20), tính percentile thứ 20 của giá
  **đúng kỳ đó** (không cộng dồn/running-max — tránh bị "mắc kẹt" ở mức cao do
  kỳ đầu tiên còn gần đỉnh). Percentile 20 tương đương: **80% số lần trong
  lịch sử, giá đã đạt tới mức này trong N kỳ đó**.
- **Giá TP thực tế**: mỗi card hiển thị thẳng 3 ô TP80 cho **+1 / +2 / +3 kỳ**
  kể từ hiện tại, quy đổi từ % thang sóng đẩy sang **giá cụ thể**. Bấm vào
  card để xem đầy đủ N1–N20.

- **Lọc target đã lỡ**: tự động ẩn các cặp mà giá hiện tại đã vượt qua TP80
  (2 ngày) rồi — Long thì TP phải cao hơn giá hiện tại, Short thì TP phải
  thấp hơn; nếu không, mục tiêu đã nằm phía sau giá, không còn ý nghĩa để
  canh lệnh.
- **So sánh với ngày quét trước**: mỗi lần mở app, so danh sách tín hiệu hôm
  nay với lần quét gần nhất trước đó (lưu trong `localStorage` của trình
  duyệt, giữ 14 ngày gần nhất). Nếu 1 cặp từng xuất hiện hôm trước nhưng hôm
  nay không còn đủ điều kiện nữa, app cảnh báo rõ lý do:
  - **⛔ Đảo chiều hoàn toàn** (Long ↔ Short) — nên chốt ngay.
  - **⚠ Hồi đã kết thúc / D+W không còn thẳng hàng** — xu hướng có dấu hiệu
    yếu đi, nên xem lại.
  - **✓ Giá đã vượt TP80 (2 ngày)** — tín hiệu tốt, có thể đã đạt mục tiêu.

  Lưu ý: vì dùng `localStorage`, việc so sánh chỉ hoạt động trên **cùng 1
  trình duyệt/thiết bị** — mở app trên máy khác lần đầu sẽ chưa có dữ liệu
  hôm trước để so.

Đây là công cụ thống kê mô tả dữ liệu quá khứ, **không phải khuyến nghị đầu
tư**.

## Build production

```bash
npm run build   # -> dist/
npm run preview # xem thử bản build
```

Deploy lên Netlify: đã có sẵn `netlify.toml` (build command `npm run build`,
publish `dist`).
