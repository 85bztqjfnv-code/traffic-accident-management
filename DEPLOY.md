# 部署指南 (Deployment Guide)

您可以輕鬆將此「交通事故案件管理平台」部署為 Web App，讓團隊透過網址隨時存取。

這是一個純靜態網站 (Single Page Application)，無需複雜的伺服器設定。

## 方法一：使用 Vercel (推薦，速度最快)

Vercel 是目前最流行的免費靜態網站託管服務。

1.  註冊/登入 [Vercel](https://vercel.com/) (可用 GitHub 帳號)。
2.  安裝 Vercel CLI (如果您有 Node.js): `npm i -g vercel`
    *   或者直接在 Vercel 網頁後台點擊 "Add New Project"。
3.  **手動部署 (最簡單)**:
    *   將整個 `traffic-accident-management` 資料夾打包成 ZIP。
    *   或者安裝 Vercel CLI 後，在終端機輸入 `vercel` 並一路按 Enter。
4.  **連結 GitHub (最專業)**:
    *   將此專案上傳到您的 GitHub Repo。
    *   在 Vercel 後台選擇 "Import Project" 並選取該 Repo。
    *   Vercel 會自動偵測並部署，每次 Push code 都會自動更新。

Web 設定：
*   **Framework Preset**: Other (或 None)
*   **Root Directory**: `./` (預設)

## 方法二：使用 Netlify

1.  註冊 [Netlify](https://www.netlify.com/)。
2.  登入後，直接將 `traffic-accident-management` 資料夾 **拖曳 (Drag & Drop)** 到 Netlify 的 "Sites" 頁面中。
3.  幾秒後就會生成一個公開網址 (例如 `https://law-case-system.netlify.app`)。

## 重要：關於資料儲存

本系統目前採用 **Hybrid 模式**：
1.  **本地快取**: 資料會儲存在瀏覽器的 `localStorage` 中。這意味著如果您換了一台電腦或瀏覽器，資料**不會**同步。
2.  **雲端備份 (Google Sheets)**:
    *   請務必在系統的「設定」頁面中，填入您的 **Google Apps Script Web App URL**。
    *   設定完成後，點擊「儲存案件」時，資料會自動同步發送到您的 Google Sheet。
    *   **注意**: 部署到新網址後，請記得去「設定」頁面重新輸入一次 URL (因為 localStorage 也是跟著網域跑的)。

## Web App 設定 (PWA)

為了讓手機體驗更好，建議將網頁「加入主畫面」：
*   **iOS (Safari)**: 點擊分享按鈕 -> 「加入主畫面」。
*   **Android (Chrome)**: 點擊選單 -> 「安裝應用程式」或「加入主畫面」。
