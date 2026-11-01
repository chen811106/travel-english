# 旅遊英文開口說（PWA）

給英文初學者（約國小程度）的旅遊英文口說練習。

- 5 個場景：餐廳、機場、問路、飯店、購物，每個場景分成 3～4 個情境，另有「🎲 綜合練習」
- 每個情境 5 個步驟：聽 → 跟讀 → 句型 → 聽懂 → 實戰（對方問、你用英文回答）
- 同一句話有多種說法，跟讀時說哪一種都算對

## 檔案結構

```
travel-english/
├── index.html             # 入口頁（只有外框，畫面由 app.js 產生）
├── manifest.webmanifest   # PWA 設定（名稱、圖示、主題色）
├── sw.js                  # Service Worker：離線快取
├── css/style.css          # 樣式（手機優先、大按鈕）
├── js/
│   ├── app.js             # 路由與四個分頁的畫面邏輯
│   ├── speech.js          # 語音播放（speechSynthesis）＋語音辨識（SpeechRecognition）
│   ├── score.js           # 跟讀評分：逐字比對、0–100 分
│   └── storage.js         # 學習進度（localStorage）
├── data/
│   ├── scenes.json        # 場景清單（首頁卡片）
│   ├── restaurant.json    # 餐廳：入座、點餐、問推薦、結帳
│   ├── airport.json       # 機場：報到、安檢、入境審查
│   ├── directions.json    # 問路：問怎麼走、搭地鐵公車、搭計程車
│   ├── hotel.json         # 飯店：入住、需要幫忙、退房
│   └── shopping.json      # 購物：找東西、試穿、結帳付款
└── icons/                 # App 圖示
```

## 本機測試

瀏覽器不允許 `file://` 讀取 JSON，所以**不能直接雙擊 index.html**，要開一個本機伺服器：

```bash
cd travel-english
python3 -m http.server 8000      # 或：npx serve .
```

然後用 **Chrome** 打開 http://localhost:8000 。
（localhost 被當成安全連線，所以麥克風和離線功能都能用。）

## 課程資料格式

每個場景檔有多個 `situations`（情境），每個情境包含：

```jsonc
{
  "id": "order", "title": "點餐", "emoji": "📝", "desc": "說明",
  "roles": { "staff": { "name": "店員", "emoji": "🧑‍🍳" } },   // 可省略，預設用場景的 roles
  "dialogue": [   // 對話（聽、跟讀用）
    { "role": "customer", "en": "Can I have a coke?", "zh": "中文", "alts": ["其他說法1", "其他說法2"] }
  ],
  "patterns": [   // 句型卡，{} 是空格
    { "template": "Can I have {}?", "zh": "我可以要{}嗎？", "alts": ["Could I get {}?"], "tip": "提示",
      "options": [ { "en": "a coke", "zh": "一杯可樂" } ] }
  ],
  "questions": [  // 聽懂、實戰用：對方的問句（alts＝其他問法）＋ 3 個中文選項 ＋ 可以怎麼回答
    { "en": "Anything else?", "alts": ["Is that all?"], "choices": ["還需要別的嗎？", "好吃嗎？", "你要坐哪裡？"], "answer": 0,
      "replies": [ { "en": "No, that's all.", "zh": "不用，這樣就好。", "alts": ["That's it, thanks."] } ] }
  ]
}
```

## 新增場景

1. 照上面的格式新增，例如 `data/beach.json`
2. 在 `data/scenes.json` 加一筆（`available: true`、`file: "data/beach.json"`）
3. 在 `sw.js` 的 `APP_FILES` 加上新檔名，並把 `CACHE_VERSION` 的數字加 1

## 注意事項

- **語音辨識**：Android Chrome、iPhone Safari（iOS 14.5+）、電腦版 Chrome/Edge 可用；Firefox 不支援（會顯示中文提示，改成「我已跟著唸完」按鈕）。
  講話時唸對的字會即時變綠，講完停一下自動結束；8 秒沒聽到聲音會問要不要再試一次。
  Chrome 的語音辨識是送到 Google 伺服器處理的，**離線時無法評分**；其他功能（聽、句型、聽懂對方）離線都能用。
- **語音播放**：使用手機內建的英文語音，音色依裝置而不同。
- 麥克風只能在 `https://` 或 `localhost` 下使用。
