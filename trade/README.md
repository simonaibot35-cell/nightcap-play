# 交易紀錄

個人用嘅美股交易紀錄網站。純靜態網頁，唔使 build，直接放 GitHub Pages 就用得。

- **總覽**：本金、1R、open heat、資金曲線、未平倉倉位（open risk 同浮動 R）
- **倉位計算**：入代號、入市價、止蝕價，自動計買幾多股，同時記低入市原因
- **交易紀錄**：每單已平倉交易嘅 R 值同犯錯標籤
- **分析**：3D 策略 × 信心、資金曲線同回撤、勝率、每單 R 值、月曆、按策略分、犯錯成本

## 計法

| 項目 | 計法 |
|---|---|
| 本金 | 起始本金 + 入金出金 + 已平倉盈虧（唔計未平倉嘅浮動盈虧） |
| 1R | 當前本金 × 1% |
| 建議股數 | （1R × 今單風險）÷（入市價 − 止蝕價），向下取整 |
| Open risk | 而家打中止蝕會賺蝕幾多 R：−1R 紅、0R 灰、+1R 綠 |
| Open heat | 所有持倉仲有風險嗰部分加埋，預設上限 5R |
| 交易結果 | 已平倉盈虧 ÷ 開倉嗰陣嘅 1R 金額 |

## 開嚟用

合併去 GitHub Pages 用緊嘅 branch 之後，網址係 `https://<你嘅用戶名>.github.io/nightcap-play/trade/`。
手機用瀏覽器打開，再「加到主畫面」就可以當 app 用。

本機試：

```sh
python3 -m http.server 8000   # 喺 repo 根目錄行
# 開 http://localhost:8000/trade/
```

## 資料存喺邊

預設只存喺呢部機嘅瀏覽器（localStorage）。清除瀏覽器資料就會冇咗，所以記得定期去「設定 → 備份 → 匯出 JSON」。

### 手機同電腦同步（Supabase，可選）

1. 去 supabase.com 開一個免費 project。
2. 喺 SQL Editor 行一次下面呢段：

   ```sql
   create table public.trade_state (
     user_id uuid primary key references auth.users on delete cascade,
     data jsonb not null,
     updated_at timestamptz not null default now()
   );
   alter table public.trade_state enable row level security;
   create policy "own row" on public.trade_state
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

3. 喺 Project Settings → API 抄低 **Project URL** 同 **anon public key**。
4. 喺網站「設定 → 雲端同步」填 URL、anon key、email 同密碼，第一次撳「註冊」，之後每部機撳「登入」。

登入之後每次改動會自動上載，另一部機打開就會攞到最新嘅版本。兩部機同時改嘅話，以最後改嗰個為準。
URL 同 key 只存喺你部機，唔會寫入 repo。

### 即時報價（Finnhub，可選）

去 finnhub.io 免費註冊，將 API key 貼去「設定 → 即時報價」。美股交易時段內，持倉每 30 秒更新一次現價。
唔設定嘅話，可以撳入持倉手動入現價。

## 開發

```sh
node --test trade/tests/*.test.mjs
```

- `js/calc.js`：所有計算（純函數，有測試）
- `js/store.js`：資料同 localStorage
- `js/quotes.js`：Finnhub 報價
- `js/sync.js`：Supabase 同步
- `js/views.js`、`js/charts.js`：畫面同圖表
- `js/app.js`：路由同所有操作

## 未做

- 富途 CSV 匯入：要有一份真實嘅匯出檔做樣本先寫得準。
- 圖表截圖上載。
