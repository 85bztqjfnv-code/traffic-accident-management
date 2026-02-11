交通事故案件管理系統 (Traffic Case Management System)
=====================================================

這是一個基於網頁技術 (HTML5/JS) 與 Google 雲端整合的案件管理平台。

### 📁 檔案結構說明
1. index.html       - 系統主程式 (請勿直接點擊，需透過伺服器開啟)
2. styles/          - 介面樣式檔案
3. scripts/         - 系統功能程式碼
4. GOOGLE_SCRIPT.js -【重要】後端部署程式碼 (Google Apps Script)
5. start_server.sh  - 啟動系統的小工具 (Mac專用)

---

### 🚀 如何啟動系統 (Mac 簡易版)
由於瀏覽器安全性限制，本系統無法直接點擊 index.html 執行。

1. 在此資料夾中找到 `點我啟動系統.command` 檔案。
2. 雙擊該檔案。
3. 系統將自動開啟終端機視窗並啟動瀏覽器進入系統。
4. 使用完畢後，關閉終端機視窗即可。

(若無法執行，請嘗試右鍵點擊該檔案 > 開啟 > 確認執行)

---

### ☁️ 如何連結您的 Google雲端 (啟用同步與上傳功能)
本系統預設為單機示範模式。若要將資料與圖片儲存到您的 Google Drive，請執行以下設定：

1. 前往 Google Drive，建立一個新的 Google Sheet。
2. 點選「擴充功能」>「Apps Script」。
3. 將本資料夾中的 `GOOGLE_SCRIPT.js` 內容完整複製貼上。
4. 儲存並執行一次 `doGet` 函式以核准權限。
5. 點選「部署 (Deploy)」>「新增部署 (New deployment)」>「網頁應用程式 (Web app)」。
   - 執行身分：我 (Me)
   - 存取權：任何人 (Anyone)
6. 複製取得的網址 (Web App URL)。
7. 回到本系統，進入「設定」頁面，將網址貼入「雲端伺服器連線」欄位並儲存。

---
版本：2.1
開發者：Antigravity
