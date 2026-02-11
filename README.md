# 交通事故案件管理平台 (Traffic Accident Management System)

這是一個用於管理交通事故案件的 Web 應用程式，支援本地資料儲存與 Google Sheets 雲端同步。

## 快速開始

### 方法 1：直接開啟 (僅本地功能)
直接用瀏覽器開啟 `index.html`。
*   **優點**：簡單，無需任何設定。
*   **限制**：由於瀏覽器安全限制 (CORS)，**雲端同步功能可能會失效** (出現 403 錯誤)。您的資料只會儲存在目前的瀏覽器中。

### 方法 2：使用本地伺服器 (推薦，支援完整功能)
使用 Python 內建的 HTTP 伺服器來執行應用程式。

1.  開啟終端機 (Terminal)。
2.  執行啟動腳本：
    ```bash
    ./start_server.sh
    ```
    (或者執行 `python3 -m http.server 8000`)
3.  在瀏覽器開啟：[http://localhost:8000](http://localhost:8000)

## 功能特色
*   **儀表板**：概覽案件統計與最近案件。
*   **新增案件**：詳細記錄事故資訊。
*   **案件列表**：搜尋與檢視所有案件。
*   **雲端同步**：與 Google Apps Script (Google Sheets) 整合。

## 雲端設定
若要啟用雲端同步，請在「設定」頁面輸入您的 Google Apps Script URL。
