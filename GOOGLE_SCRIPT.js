/**
 * Google Apps Script for Traffic Accident Management (Full Sync Mode)
 * Updated Features: Cloud Auth, Settings Sync
 * 
 * Instructions:
 * 1. Open your Google Sheet
 * 2. Extensions > Apps Script
 * 3. Paste this code
 * 4. Run 'doGet' once to grant permissions
 * 5. Deploy > New Deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy the URL to your App's settings
 */

var SHEET_NAME = "Cases";
var SETTINGS_SHEET_NAME = "Settings";
var REMINDERS_SHEET_NAME = "Reminders"; // New
var LOG_SHEET_NAME = "DebugLog";

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var lock = LockService.getScriptLock();
    // Wait for up to 30 seconds for other processes to finish.
    lock.tryLock(30000);

    try {
        // --- TELEGRAM WEBHOOK HANDLING ---
        if (e.postData && e.postData.contents) {
            var contents = JSON.parse(e.postData.contents);
            var tgMsg = contents.message || contents.callback_query; // 支援文字與按鈕

            if (tgMsg) {
                var messageObj = contents.callback_query ? contents.callback_query.message : contents.message;
                var text = contents.callback_query ? contents.callback_query.data : (contents.message ? contents.message.text : "");
                var msgId = (contents.callback_query ? "cb_" + contents.callback_query.id : "msg_" + contents.message.message_id);

                var props = PropertiesService.getScriptProperties();

                // 1. 極限去重 (使用 PropertiesService 檢查是否處理過)
                if (props.getProperty(msgId)) {
                    return ContentService.createTextOutput("ok");
                }
                // 標記為處理中，並防止併發
                props.setProperty(msgId, "true");

                // 統一格式傳入處理
                var response = handleTelegramMessage({
                    text: text,
                    chat: messageObj.chat,
                    from: contents.callback_query ? contents.callback_query.from : contents.message.from,
                    isCallback: !!contents.callback_query
                });

                // 2. 如果是按鈕點擊，回覆 Telegram 通知已收到 (消除手機轉圈圈)
                if (contents.callback_query) {
                    answerCallbackQuery(contents.callback_query.id);
                }

                return response;
            }
        }

        var action = e.parameter.action;

        // --- LOGIN ACTION ---
        if (action === 'login') {
            return handleLogin(e);
        }

        // --- GET DATA ---
        if (e.postData === undefined || action === 'get') {
            var cases = readCases();
            var settings = readSettings();
            var reminders = readReminders();

            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                data: JSON.stringify({
                    cases: cases,
                    settings: settings,
                    reminders: reminders
                })
            })).setMimeType(ContentService.MimeType.JSON);
        }

        // --- SAVE DATA (POST) ---
        var payload = JSON.parse(e.postData.contents);
        var responseData = { status: 'success' };

        // 1. Save Cases
        if (payload.cases && Array.isArray(payload.cases)) {
            saveCases(payload.cases);
        }

        // 2. Save Settings
        if (payload.settings) {
            saveSettings(payload.settings);
        }

        // 3. Process Uploads (New Feature)
        if (payload.uploads && Array.isArray(payload.uploads) && payload.uploads.length > 0) {
            responseData.uploadedLinks = processUploads(payload.uploads);
        }

        // 4. Save Reminders (New)
        if (payload.reminders && Array.isArray(payload.reminders)) {
            saveReminders(payload.reminders);
        }

        return ContentService.createTextOutput(JSON.stringify(responseData))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: err.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    } finally {
        lock.releaseLock();
    }
}

// --- FILE UPLOAD LOGIC ---
function processUploads(uploads) {
    var links = {};
    var folder = getDriveFolder();

    uploads.forEach(function (file) {
        try {
            var decoded = Utilities.base64Decode(file.base64);
            var blob = Utilities.newBlob(decoded, file.mimeType, file.fileName);
            var driveFile = folder.createFile(blob);

            // Set Public View Permission
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

            // Return the View URL
            links[file.tempId] = driveFile.getUrl();
        } catch (e) {
            links[file.tempId] = null; // Mark failed
        }
    });
    return links;
}

// --- TELEGRAM NOTIFICATION ---
function sendTelegramNotification(message, forcedChatId) {
    var settings = readSettings();
    var token = settings.telegramToken;
    var chatId = forcedChatId || settings.telegramChatId;

    if (!token || !chatId) return;

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var payload = {
        "chat_id": chatId,
        "text": message,
        "parse_mode": "HTML",
        "reply_markup": {
            "inline_keyboard": [
                [
                    { "text": "📅 今日行程", "callback_data": "/today" },
                    { "text": "📊 本週匯總", "callback_data": "/summary" }
                ],
                [
                    { "text": "🔔 待辦提醒", "callback_data": "/reminders" }
                ]
            ]
        }
    };

    var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
    };

    UrlFetchApp.fetch(url, options);
}

// 處理 Telegram 傳入訊息
function handleTelegramMessage(message) {
    var text = message.text || "";
    var chatId = message.chat.id;
    var settings = readSettings();

    // 紀錄日誌
    var logText = "From: " + (message.from.username || message.from.id) +
        " | Chat: " + chatId + " (" + message.chat.type + ")";
    logDebug("Command: " + text, logText);

    if (text === '/summary') {
        var res = sendWeeklySummary(chatId);
        if (res && res.success) {
            sendTelegramNotification("✅ 已手動觸發每週匯總報表。", chatId);
            resetTelegramConfiguration(true); // 僅重置快取，不刪 Webhook
        }
    } else if (text === '/today') {
        var res = sendTodayItinerary(chatId);
        if (res && res.success) resetTelegramConfiguration(true);
    } else if (text === '/reminders') {
        var res = sendPendingReminders(chatId);
        if (res && res.success) resetTelegramConfiguration(true);
    } else if (text === '/start') {
        var roomType = (message.chat.type === 'private' ? "私訊" : "群組/頻道");
        sendTelegramNotification("<b>🤖 交通開發者助手已啟動</b>\n\n目前對話類型：<b>" + roomType + "</b>\n\n您可以使用下方按鈕操作：", chatId);
    }

    return ContentService.createTextOutput("ok");
}

function logDebug(action, details) {
    try {
        var sheet = getSheet(LOG_SHEET_NAME);
        sheet.appendRow([new Date(), action, details]);
        // 只保留最近 100 筆
        if (sheet.getLastRow() > 105) {
            sheet.deleteRows(2, 5);
        }
    } catch (e) { }
}

// 直接傳送通知 (不檢查 settings.chatId，用於診斷)
function sendTelegramNotificationDirect(targetChatId, message) {
    var settings = readSettings();
    var token = settings.telegramToken;
    if (!token) return;

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var payload = {
        "chat_id": targetChatId,
        "text": message,
        "parse_mode": "HTML"
    };
    UrlFetchApp.fetch(url, {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
    });
}

// 回覆按鈕點擊 (消除手機轉圈圈)
function answerCallbackQuery(callbackQueryId) {
    var settings = readSettings();
    var token = settings.telegramToken;
    if (!token) return;

    var url = "https://api.telegram.org/bot" + token + "/answerCallbackQuery";
    var payload = {
        "callback_query_id": callbackQueryId
    };
    UrlFetchApp.fetch(url, {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
    });
}

// 取得今日行程
function sendTodayItinerary(forcedChatId) {
    var cases = readCases();
    var now = new Date();
    var start = new Date(now); start.setHours(0, 0, 0, 0);
    var end = new Date(now); end.setHours(23, 59, 59, 999);

    var events = [];
    cases.forEach(function (c) {
        if (c.itinerary) {
            c.itinerary.forEach(function (ev) {
                var t = new Date(ev.time);
                if (t >= start && t <= end) {
                    events.push({ time: t, event: ev.event, client: c.clientName });
                }
            });
        }
    });

    if (events.length === 0) {
        sendTelegramNotification("☕ 今日尚無安排行程。", forcedChatId);
        return { success: true };
    }

    var msg = "<b>📅 今日行程清單</b>\n\n";
    events.sort((a, b) => a.time - b.time).forEach(function (ev) {
        msg += "• " + Utilities.formatDate(ev.time, "GMT+8", "HH:mm") + " - " + ev.client + "：" + ev.event + "\n";
    });
    sendTelegramNotification(msg, forcedChatId);
    return { success: true };
}

// 取得待辦提醒
function sendPendingReminders(forcedChatId) {
    var reminders = readReminders();
    var pending = reminders.filter(r => !r.notified);

    if (pending.length === 0) {
        sendTelegramNotification("✨ 目前沒有尚未通知的提醒。", forcedChatId);
        return { success: true };
    }

    var msg = "<b>📝 待辦提醒清單</b>\n\n";
    pending.forEach(function (r, i) {
        msg += (i + 1) + ". " + (r.caseTitle || "無標題") + "\n";
        msg += "   時間: " + new Date(r.time).toLocaleString('zh-TW') + "\n";
    });
    sendTelegramNotification(msg, forcedChatId);
    return { success: true };
}

// 重置機器人 (指向深度重置)
function resetBot() {
    return resetTelegramConfiguration();
}

// 相容舊有名稱
function forceResetSystem() {
    return resetTelegramConfiguration();
}

// 診斷系統狀態 (手動執行此函式)
function checkSystemStatus() {
    var results = [];

    // 1. 檢查表格權限
    try {
        var sheet = getSheet(LOG_SHEET_NAME);
        sheet.appendRow([new Date(), "Status Check", "Checking write access..."]);
        results.push("✅ 表格寫入權限：正常 (DebugLog 已更新)");
    } catch (e) {
        results.push("❌ 表格寫入權限：失敗 (" + e.toString() + ")");
    }

    // 2. 檢查設定
    var settings = readSettings();
    results.push("ℹ️ Token 設定：" + (settings.telegramToken ? "已設定 (末四碼 " + settings.telegramToken.slice(-4) + ")" : "未設定"));
    results.push("ℹ️ Chat ID 設定：" + (settings.telegramChatId ? "已設定 (" + settings.telegramChatId + ")" : "未設定"));

    // 3. 檢查 Webhook 狀態 (向 Telegram 查詢)
    if (settings.telegramToken) {
        try {
            var url = "https://api.telegram.org/bot" + settings.telegramToken + "/getWebhookInfo";
            var res = UrlFetchApp.fetch(url, { "muteHttpExceptions": true });
            var info = JSON.parse(res.getContentText());
            results.push("🤖 Telegram Webhook 狀態：" + (info.ok ? "成功" : "失敗"));
            if (info.result) {
                results.push("🔗 目前連結網址：" + (info.result.url || "無"));
                results.push("🔴 等待中訊息數：" + info.result.pending_update_count);
                if (info.result.last_error_message) {
                    results.push("⚠️ 最後錯誤訊息：" + info.result.last_error_message);
                }
            }
        } catch (e) {
            results.push("❌ Telegram API 連線失敗：" + e.toString());
        }
    } else {
        results.push("⚠️ 無法檢查 Webhook：未設定 Token");
    }

    var finalReport = "<b>📋 系統診斷報告</b>\n\n" + results.join("\n");
    Logger.log(finalReport.replace(/<[^>]*>/g, "")); // 去除 HTML 標籤後記錄在 GAS Logger
    return finalReport;
}

// 設定 Webhook (自動偵測網址)
function setWebhook() {
    var settings = readSettings();
    var token = settings.telegramToken;
    if (!token) return "錯誤：未設定 Bot Token";

    // 自動獲取當前 Web App 的部署網址
    var url = ScriptApp.getService().getUrl();
    if (!url || url.indexOf('exec') === -1) {
        // 如果自動偵測失敗，才使用備用網址 (您目前使用的網址)
        url = "https://script.google.com/macros/s/AKfycby-OfsuILpWBmwk3opzdvYk3SWguUWbTcWGZL5PFTxaXb2LqbaD5rzxokH29YXZXEjyzA/exec";
    }

    var tgUrl = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + url;

    var res = UrlFetchApp.fetch(tgUrl);
    var resJson = JSON.parse(res.getContentText());

    if (resJson.ok) {
        return "✅ Webhook 設置成功！目前連結至：" + url;
    } else {
        return "❌ Webhook 設置失敗：" + resJson.description;
    }
}

// 取得狀態的中文名稱
function getStatusName(status) {
    var mapping = {
        'New': '新案',
        'Waiting': '等待中',
        'Processing': '處理中',
        'Litigation': '訴訟中',
        'Mediation': '調解中',
        'Settled': '已和解',
        'Judgement': '已判決',
        'Completed': '已結案'
    };
    return mapping[status] || status;
}

// --- REMINDER LOGIC ---
function setupTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === 'checkReminders') {
            ScriptApp.deleteTrigger(triggers[i]);
        }
    }
    ScriptApp.newTrigger('checkReminders')
        .timeBased()
        .everyMinutes(5)
        .create();

    // 每週檢核一次處理中案件匯總 (每週一早上 9 點)
    ScriptApp.newTrigger('sendWeeklySummary')
        .timeBased()
        .onWeekDay(ScriptApp.WeekDay.MONDAY)
        .atHour(9)
        .create();
}

function sendWeeklySummary(forcedChatId) {
    var cases = readCases();
    var now = new Date();

    // 1. Processing Cases
    var processingCases = cases.filter(function (c) {
        return c.status === 'Processing';
    });

    // 2. Weekly Itinerary (Monday to Sunday)
    var today = new Date();
    var day = today.getDay(); // 0 (Sun) to 6 (Sat)
    var diffToMon = (day === 0 ? -6 : 1 - day);
    var monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);

    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    var weeklyEvents = [];
    cases.forEach(function (c) {
        if (c.itinerary && Array.isArray(c.itinerary)) {
            c.itinerary.forEach(function (ev) {
                var evTime = new Date(ev.time);
                if (evTime >= monday && evTime <= sunday) {
                    weeklyEvents.push({
                        time: evTime,
                        event: ev.event,
                        client: c.clientName || "未命名"
                    });
                }
            });
        }
    });
    weeklyEvents.sort(function (a, b) { return a.time - b.time; });

    if (processingCases.length === 0 && weeklyEvents.length === 0) return;

    var msg = "<b>🗓️ 本週案件進度與行程匯總</b>\n\n";

    if (processingCases.length > 0) {
        msg += "<b>案件進度 (處理中)：</b>\n";
        processingCases.forEach(function (c, i) {
            msg += (i + 1) + ". " + (c.clientName || "未命名") + " (" + (c.plate || "無") + ")\n";
        });
        msg += "\n";
    }

    if (weeklyEvents.length > 0) {
        msg += "<b>本週重要行程：</b>\n";
        weeklyEvents.forEach(function (ev, i) {
            var dateStr = Utilities.formatDate(ev.time, "GMT+8", "MM/dd (E) HH:mm");
            msg += "• " + dateStr + " - " + ev.client + "：" + ev.event + "\n";
        });
        msg += "\n";
    }

    msg += "祝您本週工作順利！";
    sendTelegramNotification(msg, forcedChatId);
    return { success: true };
}

function checkReminders() {
    var now = new Date();
    var cases = readCases();
    var reminders = readReminders();
    var remindersUpdated = false;
    var casesUpdated = false;

    // 1. 檢查自定義提醒 (舊有邏輯)
    reminders.forEach(function (r) {
        if (!r.notified && new Date(r.time) <= now) {
            var msg = "<b>🔔 自定義提醒</b>\n\n" +
                "詳情: " + (r.caseTitle || "無標題") + "\n" +
                "時間: " + new Date(r.time).toLocaleString('zh-TW') + "\n" +
                "內容: " + (r.note || "無");
            sendTelegramNotification(msg);
            r.notified = true;
            remindersUpdated = true;
        }
    });

    // 2. 檢查案件行程與多階段通知
    cases.forEach(function (c) {
        if (c.itinerary && Array.isArray(c.itinerary)) {
            c.itinerary.forEach(function (ev) {
                var evTime = new Date(ev.time);
                var diffMs = evTime - now;
                var diffDays = diffMs / (1000 * 60 * 60 * 24);
                var diffHours = diffMs / (1000 * 60 * 60);

                if (!ev.notified) ev.notified = [];

                var triggerStage = null;
                var stageLabel = "";

                // A. 3天前
                if (diffDays <= 3 && diffDays > 2.9 && ev.notified.indexOf('3d') === -1) {
                    triggerStage = '3d';
                    stageLabel = "三天前提醒";
                }
                // B. 1天前
                else if (diffDays <= 1 && diffDays > 0.9 && ev.notified.indexOf('1d') === -1) {
                    triggerStage = '1d';
                    stageLabel = "一天前提醒";
                }
                // C. 當公早上 (8:00 - 9:00 AM)
                else if (diffDays <= 0.5 && now.getHours() === 8 && ev.notified.indexOf('morning') === -1) {
                    // Ensure it's the same day
                    if (now.getDate() === evTime.getDate() && now.getMonth() === evTime.getMonth()) {
                        triggerStage = 'morning';
                        stageLabel = "今日行程提醒";
                    }
                }
                // D. 4小時前
                else if (diffHours <= 4 && diffHours > 3.9 && ev.notified.indexOf('4h') === -1) {
                    triggerStage = '4h';
                    stageLabel = "四小時後即將開始";
                }

                if (triggerStage) {
                    var msg = "<b>🗓️ 行程階段通知 [" + stageLabel + "]</b>\n\n" +
                        "案件: " + (c.clientName || "未命名") + "\n" +
                        "事件: <b>" + ev.event + "</b>\n" +
                        "時間: " + evTime.toLocaleString('zh-TW') + "\n" +
                        "地點: " + (ev.location || "未註明") + "\n" +
                        "備註: " + (ev.note || "無");
                    sendTelegramNotification(msg);
                    ev.notified.push(triggerStage);
                    casesUpdated = true;
                }
            });
        }

        // 3. 檢查事故滿 30 日提醒
        if (c.date && (c.status === 'Waiting' || c.status === 'New')) {
            var accidentDate = new Date(c.date);
            var diffDays30 = Math.floor((now - accidentDate) / (1000 * 60 * 60 * 24));

            if (diffDays30 >= 30) {
                var oldStatus = c.status;
                c.status = 'Processing';
                if (!c.history) c.history = [];
                c.history.unshift({
                    date: now.toLocaleString('zh-TW'),
                    content: "系統自動通知：事故已滿 30 日，已可申請初步分析研判表，狀態由「" + oldStatus + "」自動轉為「處理中」。",
                    type: 'system'
                });

                var msg = "<b>⚠️ 事故滿 30 日提醒</b>\n\n" +
                    "案件: " + (c.clientName || "未命名") + " (" + (c.plate || "無") + ")\n" +
                    "詳情: 事故發生已滿 30 日，請申請初判表並更新案件。";
                sendTelegramNotification(msg);
                casesUpdated = true;
            }
        }
    });

    if (remindersUpdated) saveReminders(reminders);
    if (casesUpdated) saveCasesSilently(cases);

    // 定期掃描完畢後僅清理快取，不刷 Webhook (避免過度頻繁觸發 Telegram API)
    resetTelegramConfiguration(true);
}

// 靜默儲存 (不觸發狀態異動通知)
function saveCasesSilently(newCases) {
    var sheet = getSheet(SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
    if (newCases.length === 0) return;
    var rows = newCases.map(function (c) {
        return [c.id, c.date, c.clientName || '', c.plate || '', c.status || 'Waiting', JSON.stringify(c), new Date().toISOString()];
    });
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// 測試所有通知功能
function testAllNotifications() {
    var settings = readSettings();
    if (!settings.telegramToken || !settings.telegramChatId) {
        Logger.log("請先在系統設定中設定 Telegram Token 與 Chat ID");
        return "錯誤：未設定 Telegram";
    }

    sendTelegramNotification("<b>🧪 系統通知測試中...</b>");

    // 1. 測試一般訊息
    sendTelegramNotification("1. 基礎連線測試：成功");

    // 2. 測試狀態異動
    var msgStatus = "<b>🔄 測試：案件進度異動</b>\n\n案件: 測試小明\n狀態更新: 等待中 ➡️ <b>處理中</b>";
    sendTelegramNotification(msgStatus);

    // 3. 測試行程通知
    var msgItin = "<b>🗓️ 測試：行程通知 [三天前]</b>\n\n案件: 測試小王\n事件: 測試調解會\n時間: 2026/02/14 10:00\n地點: 測試地點";
    sendTelegramNotification(msgItin);

    // 4. 測試 30 日提醒
    var msg30 = "<b>⚠️ 測試：事故滿 30 日提醒</b>\n\n案件: 測試案件\n詳情: 事故發生已滿 30 日，請申請初判表。";
    sendTelegramNotification(msg30);

    return "測試通知已發送至 Telegram，請查收。";
}

function readReminders() {
    var sheet = getSheet(REMINDERS_SHEET_NAME);
    var val = sheet.getRange(1, 1).getValue();
    if (val && typeof val === 'string' && val.startsWith('[')) {
        try { return JSON.parse(val); } catch (e) { return []; }
    }
    return [];
}

function saveReminders(reminders) {
    var sheet = getSheet(REMINDERS_SHEET_NAME);
    sheet.clear();
    sheet.getRange(1, 1).setValue(JSON.stringify(reminders));
}

function getDriveFolder() {
    var folderName = "TrafficCaseFiles";
    var folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder(folderName);
}

// --- LOGIN LOGIC ---
function handleLogin(e) {
    var u = e.parameter.u;
    var p = e.parameter.p;

    // Read users from Settings
    var settings = readSettings();
    var users = settings.users || [];

    // Fallback: Default Admin if NO users defined at all
    if (users.length === 0) {
        if (u === 'admin' && p === 'admin') {
            return ContentService.createTextOutput(JSON.stringify({ status: 'success', msg: 'Default Admin' })).setMimeType(ContentService.MimeType.JSON);
        } else {
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'No users defined (Default: admin/admin)' })).setMimeType(ContentService.MimeType.JSON);
        }
    }

    // Verify
    var valid = users.some(function (user) {
        return user.u === u && user.p === p;
    });

    if (valid) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
    } else {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Invalid credentials' })).setMimeType(ContentService.MimeType.JSON);
    }
}

// --- SHEET HELPERS ---
function getSheet(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        if (name === SHEET_NAME) {
            sheet.appendRow(["ID", "Date", "Name", "Plate", "Status", "JSON", "LastUpdated"]);
            sheet.setFrozenRows(1);
        }
    }
    return sheet;
}

// --- CASES I/O ---
function readCases() {
    var sheet = getSheet(SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var range = sheet.getRange(2, 1, lastRow - 1, 7); // Read 7 cols
    var values = range.getValues();
    var cases = [];

    for (var i = 0; i < values.length; i++) {
        var jsonStr = values[i][5]; // Col F (Index 5)
        if (jsonStr && jsonStr.startsWith("{")) {
            try {
                cases.push(JSON.parse(jsonStr));
            } catch (e) { }
        }
    }
    return cases;
}

function saveCases(newCases) {
    var sheet = getSheet(SHEET_NAME);
    var oldCases = readCases(); // 讀取舊資料用於比對

    // 狀態異動檢測
    newCases.forEach(function (nc) {
        var oc = oldCases.find(function (o) { return o.id === nc.id; });
        if (oc && oc.status !== nc.status) {
            var oldName = getStatusName(oc.status);
            var newName = getStatusName(nc.status);
            var msg = "<b>🔄 案件進度異動通知</b>\n\n" +
                "案件: " + (nc.clientName || "未命名") + " (" + (nc.plate || "無") + ")\n" +
                "狀態更新: <code>" + oldName + "</code> ➡️ <b>" + newName + "</b>\n" +
                "更新時間: " + new Date().toLocaleString('zh-TW');
            sendTelegramNotification(msg);
        }
    });

    // 清除舊資料並寫入新資料
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }

    if (newCases.length === 0) return;

    var rows = newCases.map(function (c) {
        return [
            c.id,
            c.date,
            c.clientName || '',
            c.plate || '',
            c.status || 'Waiting',
            JSON.stringify(c),
            new Date().toISOString()
        ];
    });

    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// --- SETTINGS I/O ---
function readSettings() {
    var sheet = getSheet(SETTINGS_SHEET_NAME);
    // Assuming settings is just one big JSON cell at A1 (simple)
    // Or we can assume row 1 is simple value.
    // Let's rely on reading A1.
    var val = sheet.getRange(1, 1).getValue();
    if (val && typeof val === 'string' && val.startsWith('{')) {
        try { return JSON.parse(val); } catch (e) { return {}; }
    }
    return {};
}

function saveSettings(settings) {
    var sheet = getSheet(SETTINGS_SHEET_NAME);
    sheet.clear();
    // Save as one big JSON string in cell A1. Efficient enough for small config.
    sheet.getRange(1, 1).setValue(JSON.stringify(settings));
}

// 重新重置 Telegram 連線 (全清空後重新連接)
function resetTelegramConfiguration(softReset) {
    var settings = readSettings();
    var token = settings.telegramToken;
    if (!token) return "❌ 錯誤：未設定 Bot Token";

    // 1. 清除快取 (始終執行)
    CacheService.getScriptCache().removeAll(['cases', 'settings', 'reminders']);

    if (!softReset) {
        // 只有深度重置才刪除 Webhook 與所有屬性 (包含去重標誌)
        deleteWebhook();
        PropertiesService.getScriptProperties().deleteAllProperties();
        Utilities.sleep(1000);
        setWebhook();
        logDebug("Deep Reset", "Webhook re-synced and all properties cleared.");
        return "✅ 系統深度重置並重新設定 Webhook。";
    }

    // 軟重置：僅清除最近 100 筆去重標誌以外的屬性 (目前先保留去重，僅清快取)
    logDebug("Soft Reset", "Cache cleared.");
    return "✅ 快取已清理。";
}

// 刪除 Webhook (手動執行此函式)
function deleteWebhook() {
    var settings = readSettings();
    var token = settings.telegramToken;
    if (!token) return "❌ 錯誤：未設定 Bot Token";

    var url = "https://api.telegram.org/bot" + token + "/deleteWebhook?drop_pending_updates=true";
    var res = UrlFetchApp.fetch(url, { "muteHttpExceptions": true });
    var resJson = JSON.parse(res.getContentText());

    if (resJson.ok) {
        return "✅ Webhook 已成功刪除。";
    } else {
        return "❌ 刪除 Webhook 失敗：" + resJson.description;
    }
}
