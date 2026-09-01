# Sóng Đẩy — Bộ lọc hồi kỹ thuật D+W

Apps React (Vite) quét 18 cặp FX/crypto (22 cặp gốc, trừ 4 cặp sàn không hỗ
trợ: USD/SEK, USD/MXN, USD/ZAR, USD/NOK), lọc ra những cặp đang **Daily &
Weekly cùng chiều xu hướng** (≥1 trong 3 chỉ báo: EMA20 / RSI14 so MA10 / màu
nến Heikin Ashi) **và** đang hồi đúng 1-3 ngày kể từ đỉnh/đáy gần nhất — rồi
backtest lại chính lịch sử của từng cặp đó để trả lời: trong N ngày tới, 80%
trường hợp trong quá khứ giá đã đạt tới mức nào.

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

- **Xu hướng D/W**: chỉ cần **1 trong 3** chỉ báo xác nhận là đủ (không cần
  cả 3 đồng thuận cùng lúc), áp dụng như nhau cho cả Daily và Weekly:
  - Close so với EMA20, hoặc
  - RSI14 so với **MA10 của chính nó** (không dùng mốc 50 cố định — RSI trên/
    dưới MA10 phản ánh đúng động lượng đang đổi chiều hơn), hoặc
  - Màu nến **Heikin Ashi** (HA Close > HA Open = tăng) — phản ứng nhanh hơn
    nhiều so với chờ MACD cắt Signal.
- **"Hồi"**: số ngày kể từ **đỉnh/đáy pivot 3-nến gần nhất** (không phải đếm
  chuỗi nến ngược màu liên tiếp — 1 nến ngược màu xen giữa không làm reset về
  1 ngày nữa). **Chỉ chấp nhận 1-3 ngày** — từ 4 ngày trở đi loại bỏ hoàn toàn
  do nguy cơ đảo chiều.
- **Sóng đẩy (impulse)**: đo từ pivot low/high (nếu Long/Short) liền trước đó
  tới đỉnh/đáy vừa xác định ở trên.
- **Target 80%**: với mỗi cặp + mỗi chiều Long/Short, gộp **toàn bộ lịch sử**
  các lần từng khớp đúng mẫu hình này (D+W cùng chiều rồi hồi — thường vài
  trăm lần trên ~9-10 năm dữ liệu), rồi với mỗi mốc N ngày kể từ lúc bắt đầu
  hồi (N1…N10), tính percentile thứ 20 của giá **đúng ngày đó** (không cộng dồn/
  running-max — tránh bị "mắc kẹt" ở mức cao do ngày đầu tiên còn gần đỉnh).
  Percentile
  20 tương đương: **80% số lần trong lịch sử, giá đã đạt tới mức này trong N
  ngày đó** — đúng câu hỏi gốc "trong N ngày, 80% trường hợp giá đạt đến
  ngưỡng nào". Không tách nhỏ theo mức hồi sâu/nông hiện tại — dùng chung 1
  con số cho mỗi N, tính trên toàn bộ mẫu, cho chắc cỡ mẫu đủ lớn.
- **Giá TP thực tế**: mỗi card hiển thị thẳng 3 ô TP80 cho **2 / 3 / 4 ngày**,
  quy đổi từ % thang sóng đẩy sang **giá cụ thể** (dựa trên đáy/đỉnh sóng đẩy
  hiện tại của chính cặp đó), không chỉ số % trừu tượng. Bấm vào card để xem
  đầy đủ N1–N10.
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
