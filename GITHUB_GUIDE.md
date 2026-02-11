# 將專案上傳至 GitHub 並連結 Vercel

由於您的系統目前沒有安裝 Node.js (找不到 `npm`)，最穩定的方法是透過 GitHub 連結 Vercel。

## 第一步：在 GitHub 上建立儲存庫 (Repository)

1. 登入您的 [GitHub](https://github.com/) 帳號。
2. 點選右上角的 **"+" > "New repository"**。
3. 設定 Repository name (例如：`traffic-accident-management`)。
4. 選擇 **Public** 或 **Private** 皆可。
5. **不要** 勾選 "Initialize this repository with a README" 等選項。
6. 點選 **"Create repository"**。

## 第二步：在 Mac 上將程式碼推送到 GitHub

開啟您的終端機，依序輸入以下指令：

1. **進入專案目錄**：
   ```bash
   cd /Users/linyoucheng/.gemini/antigravity/scratch/traffic-accident-management
   ```

2. **初始化 Git 並提交**：
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Vercel deployment"
   ```

3. **設定分支與遠端地址** (請將 `YOUR_USERNAME` 和 `REPO_NAME` 替換成您的實際資料)：
   ```bash
   git branch -M main
   git remote add origin https://github.com/您的帳號/您的儲存庫名稱.git
   ```

4. **推送程式碼**：
   ```bash
   git push -u origin main
   ```

## 第三步：在 Vercel 連結 GitHub

1. 前往 [Vercel 儀表板](https://vercel.com/dashboard)。
2. 點選 **"Add New..." > "Project"**。
3. 在 "Import Git Repository" 找到您剛建立的 GitHub 專案，點選 **"Import"**。
4. 檢查設定（通常預設為 "Other" 或 "Static Site" 即可）。
5. 點選 **"Deploy"**。

---

**優點**：以後只要您修改本地檔案並執行 `git push`，Vercel 就會**自動更新**您的網站，不需要再跑任何上傳指令！
