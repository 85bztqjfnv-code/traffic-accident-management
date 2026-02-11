# 部署至 Vercel 指南

Vercel 是一個非常強大且直覺的開發平台，非常適合您的交通開發者助手前端。

## 方法一：使用 Vercel CLI (命令列)

如果您習慣在終端機操作：

1. **安裝 Vercel CLI**：
   ```bash
   npm install -g vercel
   ```

2. **登入並部署**：
   在專案根目錄執行：
   ```bash
   vercel login
   ```
   接著執行：
   ```bash
   vercel
   ```
   (一路按 Enter 即可完成部署)

## 方法二：透過 GitHub 連結 (推薦)

這可以實現「推送到 GitHub 即自動修改」：

1. 將程式碼推送到您的 **GitHub 儲存庫**。
2. 前往 [Vercel 官網](https://vercel.com/)。
3. 點選 **"Add New" > "Project"**。
4. 連結您的 GitHub 帳號並選擇該儲存庫。
5. **Framework Preset** 設定為 "Other" (或自動偵測為 Static)。
6. 點選 **"Deploy"**。

## 優點：
- **速度極快**：全球 CDN 加速。
- **預覽功能**：每次推送都會生成一個獨立的預覽網址。
- **免費額度高**：個人開發使用完全免費。

部署完成後，請記得將產生的 **Vercel 網址** 更新回 Google Apps Script 的 `readSettings` 或前端相關配置（如果有硬編碼網址的話）。
