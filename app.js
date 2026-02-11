/**
 * Traffic Accident Case Management Platform
 * Vanilla JS Implementation
 */

const App = {
    // Expose self for inline handlers (module scope fix)
    exposeGlobal() {
        window.App = this;
    },

    // UI Utility: Toast Notification
    showToast(title, message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon">
                ${type === 'success' ? '<i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i>' :
                type === 'error' ? '<i class="fa-solid fa-circle-xmark" style="color:var(--color-danger)"></i>' :
                    type === 'warning' ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--color-warning)"></i>' :
                        '<i class="fa-solid fa-circle-info" style="color:var(--color-accent)"></i>'}
            </div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
        `;

        if (type === 'success') SoundManager.playSuccess();
        else if (type === 'error') SoundManager.playError();
        else SoundManager.playNotification();

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    },

    addNotification(notif) {
        if (!this.data.settings.notifications) this.data.settings.notifications = [];

        notif.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        notif.read = false;
        notif.timestamp = notif.timestamp || new Date().toISOString();

        this.data.settings.notifications.unshift(notif);
        if (this.data.settings.notifications.length > 50) this.data.settings.notifications.pop();

        this.data.save();
        this.updateBadge();

        this.showToast('新通知', notif.title, 'info');
    },

    updateBadge() {
        const notifs = (this.data.settings && this.data.settings.notifications) || [];
        const count = notifs.filter(n => !n.read).length;
        const badge = document.getElementById('nav-badge-count');
        const dot = document.getElementById('nav-badge-dot');

        if (badge && dot) {
            if (count > 0) {
                badge.innerText = count > 99 ? '99+' : count.toString();
                badge.style.display = 'inline-block';
                dot.style.display = 'block';
            } else {
                badge.style.display = 'none';
                dot.style.display = 'none';
            }
        }
    },

    // Reminder Helpers
    async addReminder() {
        const type = document.getElementById('new-rem-type').value;
        const caseId = document.getElementById('new-rem-case').value;
        const note = document.getElementById('new-rem-desc').value.trim();
        const time = document.getElementById('new-rem-time').value;

        if (!time) {
            this.showToast('錯誤', '請填寫時間', 'error');
            return;
        }

        let caseTitle = note || '無標題';
        if (caseId) {
            const c = this.data.getCase(caseId);
            if (c) {
                // If there's a case, the title is usually the client name + plate
                caseTitle = `${c.clientName} (${c.plate || '無車牌'})`;
            }
        }

        const newRem = { type, caseTitle, note, time, notified: false, caseId };
        this.data.reminders.push(newRem);
        this.showToast('成功', '提醒已加入', 'success');

        await this.data.syncToCloud();
        this.router.handleRoute(); // Refresh
    },

    async deleteReminder(time) {
        if (!confirm('確定要刪除此提醒嗎？')) return;
        this.data.reminders = this.data.reminders.filter(r => r.time !== time);
        await this.data.syncToCloud();
        this.router.handleRoute(); // Refresh
    },

    async saveTelegramSettings() {
        const token = document.getElementById('tg-token').value.trim();
        const chatId = document.getElementById('tg-chatid').value.trim();

        this.data.settings.telegramToken = token;
        this.data.settings.telegramChatId = chatId;

        this.showToast('成功', 'Telegram 設定已儲存', 'success');
        await this.data.syncToCloud();
    },

    // State
    data: {
        cases: [],
        reminders: [], // New
        pendingUploads: {}, // Map<caseId, Array<{tempId, file, fileName, mimeType}>>
        settings: {
            cloudScriptUrl: 'https://script.google.com/macros/s/AKfycbzAMYLKl6G5IY4bFuGTESy8Er-SUoEaIla3jFcTusKNYsHfmVMYKPHJFNmUUS2X2UcNXA/exec'
        },
        load() {
            try {
                // Cloud-First: Start with empty, wait for sync
                this.cases = [];

                const storedSettings = localStorage.getItem('traffic_settings');
                if (storedSettings) {
                    const parsed = JSON.parse(storedSettings);
                    this.settings = { ...this.settings, ...parsed };
                }

                // FORCE OVERRIDE URL (User requested hardcode)
                this.settings.cloudScriptUrl = 'https://script.google.com/macros/s/AKfycbxiVXB6OU9p34CZLe3ArkNSV868fTaH9GEi12JY5KdJa1YYZhJ9_IxtmNolukNgiXVT/exec';

            } catch (e) {
                console.error('Settings corrupted', e);
            }
        },
        checkReminders() {
            const today = new Date();
            let updateCount = 0;
            const REMINDER_DAYS = 30;

            this.cases.forEach(c => {
                if (!c.date || c.status === 'Completed' || c.status === 'Settled' || c.status === 'Judgement') return;

                // Only act if status is 'Waiting' (or legacy 'New'/'Processing' if we want strictly Waiting?)
                // User requirement: "When 30 days passed... auto change status to Processing"
                // Assuming this applies if it's currently 'Waiting'. If it's already 'Litigation', we shouldn't downgrade.
                // Let's assume it applies to 'Waiting' or 'New'.

                const targetStatus = 'Waiting'; // The status that triggers upgrade
                if (c.status !== 'Waiting' && c.status !== 'New') return;

                const accidentDate = new Date(c.date);
                const diffTime = today - accidentDate;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays >= REMINDER_DAYS) {
                    // Logic: Auto update status
                    const oldStatus = c.status;
                    c.status = 'Processing'; // Auto move to Processing

                    // Add history
                    c.history.unshift({
                        date: new Date().toLocaleString('zh-TW'),
                        content: `系統自動通知：事故已滿${REMINDER_DAYS}日，已可申請初步分析研判表，狀態由「${oldStatus}」自動轉為「處理中」。`,
                        type: 'system'
                    });

                    // Trigger UI Notification
                    // We use setTimeout to ensure UI is ready or spaced out
                    // Add Notification
                    const title = `案件 ${c.clientName} 事故滿30日`;
                    const msg = `案件編號 ${c.plate} 事故發生已滿${REMINDER_DAYS}日，請申請初判表。`;
                    App.addNotification({
                        type: 'alert',
                        title: title,
                        message: msg,
                        caseId: c.id,
                        timestamp: new Date().toISOString()
                    });

                    updateCount++;
                }
            });

            if (updateCount > 0) {
                this.save();
                console.log(`[System] Auto-updated ${updateCount} cases due to 30-day rule.`);
            }
        },
        seed() {
            this.cases = [
                {
                    id: 'C001',
                    date: '2023-10-01',
                    clientName: '範例案件-王大明',
                    plate: 'ABC-1234',
                    status: 'Processing',
                    type: 'A2',
                    history: [{ date: '2023-10-01 10:00', content: '案件建立', type: 'system' }],
                    attachments: []
                }
            ];
            this.save();
        },
        save() {
            localStorage.setItem('traffic_cases', JSON.stringify(this.cases));
            localStorage.setItem('traffic_settings', JSON.stringify(this.settings));
            this.syncToCloud();
        },
        saveSettings(newSettings) {
            this.settings = { ...this.settings, ...newSettings };
            this.save();
        },
        // New: Manual Upload Logic
        // New: Manual Upload Logic
        async uploadPendingFiles(currentEditingCase = null) {
            const pendingCaseIds = Object.keys(this.pendingUploads);
            if (pendingCaseIds.length === 0) return { success: true, count: 0 };

            let totalUploaded = 0;
            let filePromises = [];

            pendingCaseIds.forEach(caseId => {
                this.pendingUploads[caseId].forEach(item => {
                    filePromises.push(new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            resolve({
                                id: item.tempId,
                                tempId: item.tempId,
                                fileName: item.fileName,
                                mimeType: item.mimeType,
                                base64: reader.result.split(',')[1]
                            });
                        };
                        reader.readAsDataURL(item.file);
                    }));
                });
            });

            if (filePromises.length === 0) return { success: true, count: 0 };

            try {
                const uploads = await Promise.all(filePromises);

                const payload = {
                    cases: [], // No case updates, just files
                    uploads: uploads,
                    timestamp: new Date().toISOString()
                };

                const response = await fetch(this.settings.cloudScriptUrl, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                });

                const respJson = await response.json();
                console.log('Upload response:', respJson);

                if (respJson.status === 'success' && respJson.uploadedLinks) {
                    const links = respJson.uploadedLinks;

                    // Helper to update attachments
                    const updateAttachments = (attachments) => {
                        if (!attachments) return;
                        attachments.forEach(att => {
                            if (att.tempId && links[att.tempId]) {
                                att.url = links[att.tempId];
                                delete att.tempId;
                                totalUploaded++;
                            }
                        });
                    };

                    // 1. Update Global Cases
                    this.cases.forEach(c => updateAttachments(c.attachments));

                    // 2. Update Current Editing Case (if different object reference)
                    if (currentEditingCase) {
                        updateAttachments(currentEditingCase.attachments);
                    }

                    // Clear Pending

                    // Clear Pending
                    this.pendingUploads = {};
                    this.save(); // Save the new URLs to local storage
                    return { success: true, count: totalUploaded };
                }
            } catch (e) {
                console.error('Manual upload failed', e);
                throw e; // Bubble up for UI handling
            }
            return { success: false };
        },

        async downloadFromCloud(isAuto = false) {
            if (!this.settings.cloudScriptUrl) return;
            try {
                if (!isAuto) App.showToast('同步中', '正在下載雲端資料...', 'info');

                const response = await fetch(this.settings.cloudScriptUrl + '?action=get');
                const data = await response.json();

                if (data.status === 'success' && data.data) {
                    const cloudData = JSON.parse(data.data);

                    if (cloudData.cases && Array.isArray(cloudData.cases)) {
                        this.cases = cloudData.cases;
                    }

                    if (cloudData.reminders && Array.isArray(cloudData.reminders)) {
                        this.reminders = cloudData.reminders;
                    }

                    if (cloudData.settings) {
                        const currentUrl = this.settings.cloudScriptUrl;
                        this.settings = { ...this.settings, ...cloudData.settings };
                        if (currentUrl) this.settings.cloudScriptUrl = currentUrl;
                    }

                    // Save to local cache just in case
                    localStorage.setItem('traffic_cases', JSON.stringify(this.cases));

                    // Refresh View
                    if (App.router) App.router.handleRoute();

                    // Check Reminders immediately after load
                    this.checkReminders();

                    if (!isAuto) App.showToast('同步完成', '資料已更新', 'success');
                } else {
                    if (!isAuto) App.showToast('同步提醒', '雲端尚無資料', 'warning');
                }
            } catch (e) {
                console.error('Download failed', e);
                if (!isAuto) App.showToast('同步錯誤', '無法連線至雲端: ' + e.message, 'error');
            }
        },

        async syncToCloud() {
            if (!this.settings.cloudScriptUrl) return;

            try {
                // Sync textual data only (files should be uploaded manually now)
                const payload = {
                    cases: this.cases,
                    reminders: this.reminders,
                    settings: this.settings,
                    uploads: [],
                    password: this.settings.appPassword, // Include password for security check
                    timestamp: new Date().toISOString()
                };

                const response = await fetch(this.settings.cloudScriptUrl, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                });

                const respJson = await response.json();
                console.log('Synced to cloud. Response:', respJson);

                if (respJson.status !== 'success') {
                    console.warn('Cloud sync reported non-success status:', respJson);
                }

            } catch (e) {
                console.error('Cloud sync failed', e);
                // Don't toast on auto-sync to avoid annoyance, unless critical
            }
        },
        addCase(newCase) {
            newCase.history = [
                { date: new Date().toLocaleString('zh-TW'), content: '案件建立', type: 'system' },
                ...(newCase.history || [])
            ];
            newCase.attachments = newCase.attachments || [];
            this.cases.unshift(newCase);
            this.save();
        },
        updateCase(updatedCase) {
            const index = this.cases.findIndex(c => c.id === updatedCase.id);
            if (index !== -1) {
                const oldCase = this.cases[index];
                updatedCase.history = updatedCase.history || oldCase.history;
                updatedCase.attachments = updatedCase.attachments || oldCase.attachments;
                this.cases[index] = updatedCase;
                this.save();
            }
        },
        deleteCase(id) {
            if (confirm('確定要刪除案件 ' + id + ' 嗎？此動作無法復原。')) {
                this.cases = this.cases.filter(c => c.id !== id);
                this.save();
                App.views.renderCaseList(document.getElementById('content-area')); // Refresh list
                App.showToast('刪除成功', '案件已刪除', 'success');
            }
        },
        queueUpload(caseId, file) {
            if (!this.pendingUploads[caseId]) {
                this.pendingUploads[caseId] = [];
            }
            const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            this.pendingUploads[caseId].push({
                tempId: tempId,
                file: file,
                fileName: file.name,
                mimeType: file.type
            });
            return tempId;
        },
        getCase(id) {
            return this.cases.find(c => c.id === id);
        }
    },

    // Router
    router: {
        init() {
            window.addEventListener('hashchange', () => this.handleRoute());
            this.handleRoute(); // Initial load

            // Start App when DOM is ready
            document.addEventListener('DOMContentLoaded', () => {
                // Expose App to global scope efficiently
                window.App = App;
                App.init();
            });            // Highlight nav
            window.addEventListener('hashchange', () => {
                const hash = window.location.hash || '#dashboard';
                document.querySelectorAll('.nav-item').forEach(el => {
                    const href = el.getAttribute('href');
                    if (href === hash || (hash.startsWith(href) && href !== '#dashboard')) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
            });
        },
        handleRoute() {
            try {
                const hash = window.location.hash || '#dashboard';
                const content = document.getElementById('content-area');
                if (!content) return; // Guard

                const [base, query] = hash.split('?');

                if (base === '#dashboard') {
                    App.views.renderDashboard(content);
                } else if (base === '#cases') {
                    App.views.renderCaseList(content);
                } else if (base === '#new-case') {
                    App.views.renderCaseForm(content);
                } else if (base === '#notifications') {
                    App.views.renderNotifications(content);
                } else if (base === '#reminders') {
                    App.views.renderReminders(content);
                } else if (base === '#insurance-info') {
                    App.views.renderInsuranceInfo(content);
                } else if (base === '#settings') {
                    App.views.renderSettings(content);
                } else if (base === '#edit-case') {
                    const id = query ? query.replace('id=', '') : '';
                    const caseData = App.data.getCase(id);
                    if (caseData) {
                        App.views.renderCaseForm(content, caseData);
                    } else {
                        window.location.hash = '#cases';
                    }
                } else {
                    window.location.hash = '#dashboard';
                }
            } catch (e) {
                console.error('Router Error:', e);
                document.getElementById('content-area').innerHTML = `<div style="padding:2rem; color:red;">頁面載入錯誤，請重新整理。</div>`;
            }
        }
    },

    // Views
    views: {
        renderNotifications(container) {
            document.getElementById('page-title').textContent = '通知中心 (Notifications)';

            const notifs = App.data.settings.notifications || [];

            container.innerHTML = `
                <div class="card" style="max-width: 800px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid #eee;">
                        <span style="font-weight:500; display:flex; align-items:center;">
                             <i class="fa-solid fa-bell" style="margin-right:8px; color:#64748b;"></i>
                             未讀通知: <span style="color:#e11d48; margin-left:4px; font-weight:bold;">${notifs.filter(n => !n.read).length}</span>
                        </span>
                        ${notifs.length > 0 ? `
                        <button class="btn btn-sm btn-ghost" id="markAllReadBtn">
                            <i class="fa-solid fa-check-double"></i> 全部標示為已讀
                        </button>` : ''}
                    </div>
                    
                    <div class="notification-list">
                        ${notifs.length === 0 ?
                    `<div style="text-align:center; padding:3rem; color:#94a3b8;">
                                <i class="fa-regular fa-bell-slash fa-3x" style="margin-bottom:1rem; opacity:0.5;"></i>
                                <div>目前沒有新通知</div>
                             </div>`
                    : notifs.map(n => `
                                <div class="notification-item" style="padding:1rem; border-bottom:1px solid #f1f5f9; display:flex; gap:12px; background:${n.read ? 'transparent' : '#fff1f2'}; border-radius:6px; margin-bottom:4px;">
                                    <div style="padding-top:4px;">
                                        ${n.type === 'alert' ? '<i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i>' : '<i class="fa-solid fa-circle-info" style="color:#3b82f6"></i>'}
                                    </div>
                                    <div style="flex:1">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                            <strong style="color:${n.read ? '#64748b' : '#0f172a'};">${n.title}</strong>
                                            <span class="text-xs text-muted">${new Date(n.timestamp).toLocaleString('zh-TW')}</span>
                                        </div>
                                        <div class="text-sm" style="color:#475569;">${n.message}</div>
                                        ${n.caseId ? `<a href="#edit-case?id=${n.caseId}" class="btn btn-xs btn-outline-primary" style="margin-top:8px; display:inline-block;">查看案件</a>` : ''}
                                    </div>
                                </div>
                            `).join('')
                }
                    </div>
                </div>
            `;

            // Mark all read handler
            const btn = document.getElementById('markAllReadBtn');
            if (btn) {
                btn.onclick = () => {
                    App.data.settings.notifications.forEach(n => n.read = true);
                    App.data.save();
                    App.updateBadge();
                    App.views.renderNotifications(container); // Re-render
                };
            }
        },

        renderReminders(container) {
            document.getElementById('page-title').textContent = '提醒管理 (Reminders)';
            const rems = App.data.reminders || [];
            const cases = App.data.cases || [];

            container.innerHTML = `
                <div class="card" style="margin-bottom: 2rem;">
                    <h3 class="section-title-sm"><i class="fa-solid fa-plus"></i> 新增提醒事項</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 1rem;">
                        <div class="form-group">
                            <label class="form-label">類型</label>
                            <select id="new-rem-type" class="form-input">
                                <option value="調解">調解</option>
                                <option value="和解">和解</option>
                                <option value="開庭">開庭</option>
                                <option value="晤談">晤談</option>
                                <option value="其他">其他</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">綁定案件 (限未結案)</label>
                            <select id="new-rem-case" class="form-input">
                                <option value="">-- 無綁定案件 --</option>
                                ${cases.filter(c => !['Completed', 'Settled', 'Judgement'].includes(c.status))
                    .map(c => `<option value="${c.id}">${c.clientName} (${c.plate || '無車牌'})</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">提醒備註 / 詳情</label>
                            <input type="text" id="new-rem-desc" class="form-input" placeholder="例如：準備和解書">
                        </div>
                        <div class="form-group">
                            <label class="form-label">時間</label>
                            <input type="datetime-local" id="new-rem-time" class="form-input">
                        </div>
                        <div class="form-group" style="display: flex; align-items: flex-end;">
                            <button class="btn btn-primary btn-block" onclick="App.addReminder()">
                                <i class="fa-solid fa-plus"></i> 加入
                            </button>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <h3 class="section-title-sm"><i class="fa-solid fa-list-check"></i> 提醒清單</h3>
                    <div style="margin-top: 1rem;">
                        ${rems.length === 0 ?
                    '<div style="text-align:center; padding:2rem; color:#94a3b8;">目前無設定提醒</div>' :
                    `<table class="data-table">
                                <thead>
                                    <tr>
                                        <th>類型</th>
                                        <th>提醒內容 / 綁定案件</th>
                                        <th>時間</th>
                                        <th>狀態</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rems.sort((a, b) => new Date(a.time) - new Date(b.time)).map(r => `
                                        <tr>
                                            <td><span class="badge" style="background:#f1f5f9; color:#475569;">${r.type}</span></td>
                                            <td>
                                                <div style="font-weight: 600;">${r.caseTitle}</div>
                                                ${r.note ? `<div class="text-sm" style="color:#64748b; margin-top:2px;">${r.note}</div>` : ''}
                                                ${r.caseId ? `
                                                    <div style="margin-top:4px;">
                                                        <a href="#edit-case?id=${r.caseId}" class="text-xs" style="color:var(--color-primary); text-decoration:underline;">
                                                            <i class="fa-solid fa-link"></i> 前往關聯案件
                                                        </a>
                                                    </div>
                                                ` : ''}
                                            </td>
                                            <td>${new Date(r.time).toLocaleString('zh-TW')}</td>
                                            <td>
                                                ${r.notified ?
                            '<span class="badge badge-success">已通知</span>' :
                            '<span class="badge" style="background:#fff7ed; color:#c2410c;">待命</span>'}
                                            </td>
                                            <td>
                                                <button class="btn-icon-danger" onclick="App.deleteReminder('${r.time}')">
                                                    <i class="fa-solid fa-trash"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>`
                }
                    </div>
                </div>
            `;
        },

        renderInsuranceInfo(container) {
            document.getElementById('page-title').textContent = '強制險與理賠資訊 (Insurance Reference)';
            container.innerHTML = `
                <div class="card">
                    <div style="margin-bottom:1.5rem; border-bottom:1px solid #eee; padding-bottom:1rem;">
                        <h2 style="color:#00479D; margin-bottom:0.5rem; font-size:1.5rem;">強制汽車責任保險給付標準</h2>
                        <p class="text-muted">本頁面提供強制險理賠項目、額度上限及應備文件清單，供案件處理時參考。</p>
                    </div>

                    <!-- Layout Grid -->
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap:30px;">
                        
                        <!-- Col 1: Medical -->
                        <div>
                            <h3 class="section-title-sm" style="color:#15803d; border-left:4px solid #15803d; padding-left:10px; margin-bottom:15px; font-weight:600;">
                                <i class="fa-solid fa-user-doctor"></i> 傷害醫療費用 (上限20萬)
                            </h3>
                            <div class="info-block" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:1.2rem;">
                                <p style="font-size:0.9rem; color:#444; margin-bottom:1.5rem; line-height:1.6;">
                                    強制險的 20 萬醫療理賠，並不是定額給付 (不是直接給你 20 萬)，也不算一般實支實付，而是 <strong style="color:#059669;">分項目理賠，總計理賠最高 20 萬元</strong>，理賠內容包括：
                                </p>

                                <div class="insurance-group" style="margin-bottom:1.2rem;">
                                    <h4 style="font-size:1rem; font-weight:bold; color:#166534; margin-bottom:4px; display:flex; justify-content:space-between;">
                                        (一) 急救費用 <span style="color:#d97706;">不限額</span>
                                    </h4>
                                    <p style="font-size:0.85rem; color:#666; margin:0 0 0 1rem;">例如搜救費、隨車醫護人員等費用</p>
                                </div>

                                <div class="insurance-group" style="margin-bottom:1.2rem;">
                                    <h4 style="font-size:1rem; font-weight:bold; color:#166534; margin-bottom:8px;">(二) 診療費用</h4>
                                    <div style="font-size:0.9rem; padding-left:1rem;">
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #bbf7d0; padding-bottom:2px;">
                                            <span>自行負擔之醫療費用</span>
                                            <span style="color:#d97706; font-weight:bold;">不限額</span>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #bbf7d0; padding-bottom:2px;">
                                            <span>病房費差額</span>
                                            <span style="color:#d97706; font-weight:bold;">每日最高 1500 元</span>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #bbf7d0; padding-bottom:2px;">
                                            <span>膳食費</span>
                                            <span style="color:#d97706; font-weight:bold;">每日最高 180 元</span>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #bbf7d0; padding-bottom:2px;">
                                            <span>非健保給付醫材</span>
                                            <span style="color:#d97706; font-weight:bold;">最高 2 萬 元</span>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; border-bottom:1px dashed #bbf7d0; padding-bottom:2px;">
                                            <span>義肢義齒義眼材料及裝設費</span>
                                            <span style="color:#d97706; font-weight:bold;">1~5 萬 元</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="insurance-group" style="margin-bottom:1.2rem;">
                                    <h4 style="font-size:1rem; font-weight:bold; color:#166534; margin-bottom:4px; display:flex; justify-content:space-between;">
                                        (三) 接送費用 <span style="color:#d97706;">最高 2 萬 元</span>
                                    </h4>
                                    <p style="font-size:0.85rem; color:#666; margin:0 0 0 1rem;">受害者往返醫院、轉診或出院等交通費</p>
                                </div>

                                <div class="insurance-group">
                                    <h4 style="font-size:1rem; font-weight:bold; color:#166534; margin-bottom:4px; display:flex; justify-content:space-between;">
                                        (四) 看護費用 <span style="color:#d97706;">每日最高 1200 元</span>
                                    </h4>
                                    <p style="font-size:0.85rem; color:#666; margin:0 0 0 1rem;">受害者住院期間雇請看護費用</p>
                                </div>
                            </div>
                        </div>

                        <!-- Col 2: Death/Disability & Docs -->
                        <div>
                            <h3 class="section-title-sm" style="color:#c2410c; border-left:4px solid #c2410c; padding-left:10px; margin-bottom:15px; font-weight:600;">
                                <i class="fa-solid fa-wheelchair"></i> 失能與死亡給付 (最高200萬)
                            </h3>
                            <div class="info-block" style="background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:1.2rem; margin-bottom:25px;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #fed7aa;">
                                    <span style="font-weight:600;"><i class="fa-solid fa-skull" style="margin-right:8px;"></i> 死亡給付</span>
                                    <strong style="color:#c2410c; font-size:1.1rem;">定額 200 萬元</strong>
                                </div>
                                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                                    <span style="font-weight:600;"><i class="fa-brands fa-accessible-icon" style="margin-right:8px;"></i> 失能給付 (1-15級)</span>
                                    <strong style="color:#c2410c; font-size:1.1rem;">5萬 ~ 200 萬元</strong>
                                </div>
                                <p style="font-size:0.85rem; color:#9a3412; margin-top:10px; line-height:1.5; background:#ffedd5; padding:10px; border-radius:6px;">
                                    <i class="fa-solid fa-circle-info"></i> 註：第一級失能為 200 萬元，第15級為 5 萬元。認定標準依「強制險失能給付標準表」辦理。
                                </p>
                            </div>

                            <h3 class="section-title-sm" style="color:#1d4ed8; border-left:4px solid #1d4ed8; padding-left:10px; margin-bottom:15px; font-weight:600;">
                                <i class="fa-solid fa-file-contract"></i> 理賠應備文件 Checklist
                            </h3>
                            <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:1.2rem;">
                                <ul class="check-list" style="list-style:none; padding:0; margin:0;">
                                    <li style="margin-bottom:12px; display:flex; align-items:flex-start; gap:10px; font-size:0.95rem;">
                                        <i class="fa-solid fa-square-check" style="color:#3b82f6; margin-top:3px;"></i> 
                                        <span><strong>理賠申請書</strong><br><small style="color:#64748b;">(由保險公司提供，需由申請人親筆簽名)</small></span>
                                    </li>
                                    <li style="margin-bottom:12px; display:flex; align-items:flex-start; gap:10px; font-size:0.95rem;">
                                        <i class="fa-solid fa-square-check" style="color:#3b82f6; margin-top:3px;"></i> 
                                        <span><strong>交通事故證明文件</strong><br><small style="color:#64748b;">(登記聯單 / 初判表 / 現場圖)</small></span>
                                    </li>
                                    <li style="margin-bottom:12px; display:flex; align-items:flex-start; gap:10px; font-size:0.95rem;">
                                        <i class="fa-solid fa-square-check" style="color:#3b82f6; margin-top:3px;"></i> 
                                        <span><strong>診斷證明書</strong><br><small style="color:#64748b;">(正本，需註明需人看護或休養天數)</small></span>
                                    </li>
                                    <li style="margin-bottom:12px; display:flex; align-items:flex-start; gap:10px; font-size:0.95rem;">
                                        <i class="fa-solid fa-square-check" style="color:#3b82f6; margin-top:3px;"></i> 
                                        <span><strong>醫療費用收據</strong><br><small style="color:#64748b;">(正本，或加蓋院章之副本影本)</small></span>
                                    </li>
                                    <li style="display:flex; align-items:flex-start; gap:10px; font-size:0.95rem;">
                                        <i class="fa-solid fa-square-check" style="color:#3b82f6; margin-top:3px;"></i> 
                                        <span><strong>身分證 / 駕照 / 行照 影本</strong></span>
                                    </li>
                                </ul>
                            </div>
                        </div>

                    </div>

                    <!-- Useful Links -->
                    <div style="margin-top:30px; border-top:1px solid #eee; padding-top:20px;">
                        <h4 style="margin-bottom:15px; font-size:1rem; color:#475569;">常用外部查詢連結</h4>
                        <div style="display:flex; gap:12px; flex-wrap:wrap;">
                            <a href="https://www.cali.org.tw/" target="_blank" class="btn" style="background:white; border:1px solid #ccc; color:#333; display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-earth-americas" style="color:#00479D;"></i> 強制汽車責任保險費率表
                            </a>
                            <a href="https://www.tii.org.tw/" target="_blank" class="btn" style="background:white; border:1px solid #ccc; color:#333; display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-building-columns" style="color:#00479D;"></i> 保發中心資料庫
                            </a>
                            <a href="https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=G0390060" target="_blank" class="btn" style="background:white; border:1px solid #ccc; color:#333; display:flex; align-items:center; gap:6px;">
                                <i class="fa-solid fa-gavel" style="color:#00479D;"></i> 給付標準法規全文
                            </a>
                        </div>
                    </div>
                </div>
            `;
        },

        renderSettings(container) {
            document.getElementById('page-title').textContent = '系統設定 (Settings)';
            container.innerHTML = `
                <div class="card" style="max-width: 600px;">
                    <div class="form-section">
                        <h3 class="form-title">雲端伺服器連線</h3>
                        <div style="display:flex; align-items:center; margin-bottom:1rem;">
                            <span class="badge badge-success" style="margin-right:8px;"><i class="fa-solid fa-link"></i> 已連線</span>
                            <span class="text-sm text-muted">連線至專屬 Google Apps Script 服務</span>
                        </div>
                        <div style="background:#f8fafc; padding:1rem; border-radius:6px; border:1px solid #e2e8f0;">
                            <label class="text-xs text-muted" style="display:block; margin-bottom:4px;">API Endpoint (ReadOnly)</label>
                            <div style="font-family:monospace; font-size:0.75rem; word-break:break-all; color:#475569; user-select:all;">
                                ${App.data.settings.cloudScriptUrl}
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-title">Telegram 機器人通知</h3>
                        <p class="text-muted text-sm" style="margin-bottom: 1rem;">用於發送自動提醒通知。</p>
                        <div class="form-group">
                            <label class="form-label">Bot Token</label>
                            <input type="password" id="tg-token" class="form-input" placeholder="貼上 Bot Token" value="${App.data.settings.telegramToken || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Chat ID</label>
                            <input type="text" id="tg-chatid" class="form-input" placeholder="貼上 Chat ID" value="${App.data.settings.telegramChatId || ''}">
                        </div>
                        <button class="btn btn-primary" onclick="App.saveTelegramSettings()">
                            <i class="fa-solid fa-save"></i> 儲存 Telegram 設定
                        </button>
                    </div>

                    <div class="form-section">
                        <h3 class="form-title">帳號管理</h3>
                        <div id="userList" style="margin-bottom: 1.5rem; border: 1px solid #eee; border-radius: 8px;">
                            <!-- Users -->
                        </div>
                        <form id="addUserForm" style="background:#f8fafc; padding:1rem; border-radius:8px;">
                            <h4 class="text-sm text-muted" style="margin-bottom:1rem;">新增使用者</h4>
                            <div style="display: flex; gap: 10px; align-items: flex-end;">
                                <div style="flex:1">
                                    <label class="form-label">帳號</label>
                                    <input type="text" name="newUsername" class="form-input" required placeholder="User1">
                                </div>
                                <div style="flex:1">
                                    <label class="form-label">密碼</label>
                                    <input type="text" name="newPassword" class="form-input" required placeholder="***">
                                </div>
                                <button type="submit" class="btn btn-secondary" style="border:1px solid #cbd5e1"><i class="fa-solid fa-plus"></i> 新增</button>
                            </div>
                        </form>
                    </div>

                    <div class="form-section">
                        <h3 class="form-title">系統功能測試</h3>
                        <button class="btn btn-ghost" onclick="App.showToast('測試通知', '這是一則測試通知，確認系統運作正常。', 'info')">
                            <i class="fa-regular fa-bell"></i> 發送測試通知
                        </button>
                    </div>
                </div>
            `;

            // Render Users
            const renderUsers = () => {
                const list = document.getElementById('userList');
                const users = App.data.settings.users || [];
                if (users.length === 0) {
                    list.innerHTML = '<div style="padding:1rem; text-align:center; color:#999;">無其他使用者</div>';
                    return;
                }
                list.innerHTML = users.map(u => `
                    <div style="padding: 0.8rem 1rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 500;">${u.u}</div>
                            <div style="font-size: 0.8rem; color: #999;">管理員權限</div>
                        </div>
                        ${u.u !== 'admin' ? `
                            <button type="button" class="btn-icon-danger" onclick="App.removeUser('${u.u}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : '<span class="badge">系統預設</span>'}
                    </div>
                `).join('');
            };
            renderUsers();

            // Add User Form
            document.getElementById('addUserForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const u = formData.get('newUsername').trim();
                const p = formData.get('newPassword').trim();
                if (u && p) {
                    const exists = (App.data.settings.users || []).find(user => user.u === u);
                    if (exists) {
                        App.showToast('錯誤', '使用者已存在', 'error');
                        return;
                    }
                    App.addUser(u, p);
                    e.target.reset();
                    renderUsers();
                }
            });
        },

        /* User Management Logic - Invalid Block
        const renderUserList = () => {
            const listEl = document.getElementById('userList');
            if (!listEl) return;
    
            const customUsers = App.data.settings.users || [];
            // Admin is always there but stored separately or hardcoded
    
            let html = '';
    
            // If no custom users, show hint about default admin
            if (customUsers.length === 0) {
                html += `
                        <div style="padding: 10px; background:#fff1f2; border-radius:6px; margin-bottom:10px;">
                             <div style="display:flex; align-items:center; color:#e11d48;">
                                <i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>
                                <strong>目前使用預設管理員</strong> 
                             </div>
                             <div class="text-sm text-muted" style="margin-top:4px;">帳號: admin / 密碼: admin</div>
                             <div class="text-sm" style="color:#e11d48; margin-top:4px; font-weight:500;">請盡快新增帳號以關閉此預設入口。</div>
                        </div>
                    `;
            } else {
                // Show Admin (System) header only? No, maybe just list all users.
                // Let's just list custom users.
            }
    
            customUsers.forEach((u, idx) => {
                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px; border-bottom: 1px solid #eee;">
                        <div>
                             <i class="fa-solid fa-user" style="margin-right:8px; color:#94a3b8"></i>
                             <strong>${u.u}</strong>
                        </div>
                        <button class="btn btn-ghost btn-sm" style="color:var(--color-danger)" onclick="App.removeUser('${u.u}')">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    `;
            });
    
            listEl.innerHTML = html;
        };
    
        renderUserList();
    
            document.getElementById('addUserForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const u = formData.get('newUsername').trim();
            const p = formData.get('newPassword').trim();
    
            if (u && p) {
                if (u === 'admin') {
                    App.showToast('錯誤', '不能使用 admin 作為帳號', 'error');
                    return;
                }
                App.addUser(u, p);
                e.target.reset();
                renderUserList();
            }
        });
    
        // Expose render for re-render after delete
        App._renderUserList = renderUserList;
    },
    
    */
        renderDashboard(container) {
            document.getElementById('page-title').textContent = '儀表板 (Dashboard)';
            const stats = {
                total: App.data.cases.length,
                processing: App.data.cases.filter(c => c.status === 'Processing').length,
                completed: App.data.cases.filter(c => c.status === 'Completed').length
            };

            container.innerHTML = `
                <div class="grid-dashboard">
                    <div class="card stat-card">
                        <span class="stat-label">總案件數</span>
                        <span class="stat-value">${stats.total}</span>
                    </div>
                    <div class="card stat-card">
                        <span class="stat-label">處理中</span>
                        <span class="stat-value" style="color: var(--color-warning)">${stats.processing}</span>
                    </div>
                    <div class="card stat-card">
                        <span class="stat-label">已結案</span>
                        <span class="stat-value" style="color: var(--color-success)">${stats.completed}</span>
                    </div>
                </div>

                <div class="form-section">
                    <h3 class="form-title">常用連結 (Quick Links)</h3>
                    <div class="link-grid">
                         <div class="quick-link-card" onclick="window.open('https://www.nanshanlife.com.tw', '_blank')">
                            <div class="quick-link-icon"><i class="fa-solid fa-building-shield"></i></div>
                            <span>南山人壽</span>
                        </div>
                        <div class="quick-link-card" onclick="window.open('https://www.nanshangeneral.com.tw/?tabTitle=個人保險', '_blank')">
                            <div class="quick-link-icon"><i class="fa-solid fa-briefcase"></i></div>
                            <span>南山產物</span>
                        </div>
                        <div class="quick-link-card" onclick="window.open('https://tm2.npa.gov.tw/NM105-505ClientRWD2/TM02A01Q_01.jsp', '_blank')">
                            <div class="quick-link-icon"><i class="fa-solid fa-gavel"></i></div>
                            <span>交通事故資料申請</span>
                        </div>
                        <div class="quick-link-card" onclick="window.open('https://maps.google.com', '_blank')">
                            <div class="quick-link-icon"><i class="fa-solid fa-map-location-dot"></i></div>
                            <span>Google Maps</span>
                        </div>
                        <div class="quick-link-card" onclick="window.open('https://www.mvdis.gov.tw', '_blank')">
                            <div class="quick-link-icon"><i class="fa-solid fa-car"></i></div>
                            <span>監理服務網</span>
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3 class="form-title" style="margin-bottom:0; border:none;">最近案件</h3>
                        <a href="#cases" class="btn btn-ghost">查看全部</a>
                    </div>
                    ${App.views.generateCaseTableHTML(App.data.cases.slice(0, 5))}
                </div>
            `;
        },

        renderCaseList(container) {
            document.getElementById('page-title').textContent = '案件列表';

            // Filter UI
            container.innerHTML = `
                <div style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: center;">
                    <!-- Status Tabs -->
                    <div class="btn-group" style="display: flex; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 6px;">
                        <button class="btn btn-sm filter-tab active" data-status="all" style="background:white; color:#000; box-shadow:0 1px 2px rgba(0,0,0,0.05);">全部</button>
                        <button class="btn btn-sm filter-tab" data-status="processing" style="background:transparent; color:#666;">處理中</button>
                        <button class="btn btn-sm filter-tab" data-status="completed" style="background:transparent; color:#666;">已結案</button>
                    </div>

                    <!-- Search Box -->
                    <div style="position: relative; width: 100%; max-width: 320px;">
                        <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #999; font-size: 0.9rem;"></i>
                        <input type="text" id="caseSearchInput" placeholder="搜尋姓名、車牌或單號..." 
                               style="width: 100%; padding: 0.6rem 1rem 0.6rem 2.4rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.9rem; transition: all 0.2s; background:white;">
                    </div>
                </div>
                
                <div id="case-table-wrapper" class="card" style="box-shadow:none; border:none; padding:0; background:transparent;">
                    <!-- Table injected here -->
                </div>
            `;

            // Filter State & Logic
            let filterState = {
                status: 'all',
                query: ''
            };

            const applyFilters = () => {
                let filtered = App.data.cases || [];

                // 1. Status Filter
                if (filterState.status !== 'all') {
                    if (filterState.status === 'processing') {
                        filtered = filtered.filter(c => ['Processing', 'Litigation', 'Waiting', 'New'].includes(c.status) || !c.status);
                    } else if (filterState.status === 'completed') {
                        filtered = filtered.filter(c => ['Completed', 'Settled', 'Judgement'].includes(c.status));
                    }
                }

                // 2. Search Filter
                const q = filterState.query.toLowerCase();
                if (q) {
                    filtered = filtered.filter(c =>
                        (c.clientName && c.clientName.toLowerCase().includes(q)) ||
                        (c.plate && c.plate.toLowerCase().includes(q)) ||
                        (c.id && c.id.toLowerCase().includes(q))
                    );
                }

                // Sorting: Newest first
                filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

                document.getElementById('case-table-wrapper').innerHTML = this.generateCaseTableHTML(filtered);
            };

            // Bind Events
            const searchInput = document.getElementById('caseSearchInput');
            // Add focus effect manually since it's inline style
            searchInput.addEventListener('focus', (e) => e.target.style.borderColor = '#000');
            searchInput.addEventListener('blur', (e) => e.target.style.borderColor = '#e2e8f0');

            searchInput.addEventListener('input', (e) => {
                filterState.query = e.target.value.trim();
                applyFilters();
            });

            const tabs = document.querySelectorAll('.filter-tab');
            tabs.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Update UI
                    tabs.forEach(t => {
                        t.classList.remove('active');
                        t.style.background = 'transparent';
                        t.style.color = '#666';
                        t.style.boxShadow = 'none';
                    });
                    btn.classList.add('active');
                    btn.style.background = 'white';
                    btn.style.color = '#000';
                    btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';

                    // Update State
                    filterState.status = btn.dataset.status;
                    applyFilters();
                });
            });

            // Initial Render
            applyFilters();
        },

        generateCaseTableHTML(cases) {
            if (cases.length === 0) return '<div class="text-muted" style="padding:1rem;">暫無案件記錄</div>';

            const statusMap = {
                'Waiting': { label: '等待中', class: 'status-new' },
                'Processing': { label: '處理中', class: 'status-processing' },
                'Litigation': { label: '法訴中', class: 'status-processing' },
                'Settled': { label: '和解結案', class: 'status-completed' },
                'Judgement': { label: '判決結案', class: 'status-completed' },
                'Completed': { label: '已結案', class: 'status-completed' }
            };

            const rows = cases.map(c => {
                const status = statusMap[c.status] || { label: c.status || 'Unknown', class: 'status-new' };
                return `
                <tr>
                    <td><span style="font-family:monospace; font-weight:500;">${c.id}</span></td>
                    <td>${c.date}</td>
                    <td style="font-weight:500;">${c.clientName}</td>
                    <td>${c.plate}</td>
                    <td>${c.type || '-'}</td>
                    <td>
                        <span class="status-badge ${status.class}">
                            ${status.label}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex; gap:0.5rem;">
                            <button class="btn-icon" onclick="window.location.hash='#edit-case?id=${c.id}'" title="編輯">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                            <button class="btn-icon" onclick="App.data.deleteCase('${c.id}')" title="刪除">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `}).join('');

            return `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>日期</th>
                                <th>客戶姓名</th>
                                <th>車牌</th>
                                <th>類型</th>
                                <th>狀態</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            `;
        },

        renderCaseForm(container, caseData = null) {
            const isEdit = !!caseData;
            document.getElementById('page-title').textContent = isEdit ? '案件詳情與編輯' : '新增案件';

            // Default Values
            const data = caseData ? JSON.parse(JSON.stringify(caseData)) : {
                id: 'C' + Date.now(),
                date: new Date().toISOString().split('T')[0],
                time: '12:00',
                location: '',
                unit: '',
                type: 'A3',
                clientName: '',
                clientPhone: '',
                plate: '',
                opposingName: '',
                opposingPhone: '',
                opposingPlate: '',
                opposingHasCompulsory: 'false',
                opposingCompulsoryCompany: '',
                opposingHasVoluntary: 'false',
                opposingVoluntaryCompany: '',
                opposingVoluntaryContact: '',
                opposingVoluntaryClaimNum: '',
                opposingVoluntaryPhone: '',
                isNanshan: false,
                selfClaimNum: '',
                selfContactUnit: '',
                selfContactName: '',
                selfContactPhone: '',
                selfContactMail: '',
                selfHasVoluntary: 'false',
                selfVoluntaryCompany: '',
                selfVoluntaryClaimNum: '',
                selfVoluntaryUnit: '',
                selfVoluntaryContact: '',
                selfVoluntaryPhone: '',
                selfVoluntaryMail: '',
                status: 'Waiting',
                history: [],
                attachments: [],
                claims: {
                    medical: 0,
                    nursing_days: 0,
                    nursing_rate: 1200,
                    transport: 0,
                    salary: 0,
                    car_repair: 0,
                    mental: 0,
                    other: 0,
                    liability: 0
                },
                itinerary: []
            };

            // Ensure arrays exist and string boolean safety
            if (!data.history) data.history = [];
            if (!data.attachments) data.attachments = [];
            if (typeof data.opposingHasCompulsory !== 'string') data.opposingHasCompulsory = String(!!data.opposingHasCompulsory);
            if (typeof data.opposingHasVoluntary !== 'string') data.opposingHasVoluntary = String(!!data.opposingHasVoluntary);
            if (typeof data.selfHasVoluntary !== 'string') data.selfHasVoluntary = String(!!data.selfHasVoluntary);

            // --- Feature: Visual Timeline Logic ---
            const steps = [
                { label: '受理/等待中', match: ['Waiting', 'New'] },
                { label: '處理中/法訴中', match: ['Processing', 'Litigation'] },
                { label: '結案', match: ['Settled', 'Judgement', 'Completed'] }
            ];

            let activeIndex = 0;
            const currentStatus = data.status || 'Waiting';

            // Determine active index
            for (let i = 0; i < steps.length; i++) {
                if (steps[i].match.includes(currentStatus)) {
                    activeIndex = i;
                    break;
                }
            }
            // Fallback: If map failed but status implies completed
            if (['Settled', 'Judgement', 'Completed'].includes(currentStatus)) activeIndex = 2;

            const timelineHTML = `
                <div class="timeline-wrapper">
                    <div class="timeline-track"></div>
                    <div class="step-track-fill" style="width: ${activeIndex * 50}%"></div>
                    <div class="timeline-steps">
                        ${steps.map((s, i) => {
                let statusClass = '';
                if (i < activeIndex) statusClass = 'completed';
                else if (i === activeIndex) statusClass = 'active';
                return `
                                <div class="step-item ${statusClass}">
                                    <div class="step-circle"></div>
                                    <span class="step-label">${s.label}</span>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;

            container.innerHTML = `
                <!-- Print / Export Action -->
                <div style="display: flex; justify-content: flex-end; margin-bottom: 1rem;" class="no-print">
                    <button type="button" class="btn" style="background:white; border:1px solid #e2e8f0; color:#333;" onclick="App.printCase(App.data.getCase('${data.id}'))">
                        <i class="fa-solid fa-print" style="margin-right:8px;"></i> 列印案件表
                    </button>
                    ${isEdit ? `
                    <button type="button" class="btn btn-primary" onclick="window.location.hash='#new-case'" style="margin-left:1rem;">
                        <i class="fa-solid fa-plus"></i> 新增另一案
                    </button>` : ''}
                </div>

                ${isEdit ? timelineHTML : ''}

                <form id="caseForm">
                    <!-- Tabs Header -->
                    <div class="tabs-header no-print" style="display:flex; gap:20px; border-bottom:1px solid #e2e8f0; margin-bottom:20px;">
                         <div class="tab-btn active" data-target="tab-basic" style="padding:10px 0; border-bottom:3px solid var(--color-primary); color:var(--color-primary); font-weight:600; cursor:pointer;">
                            案件基本資料
                         </div>
                         <div class="tab-btn" data-target="tab-calc" style="padding:10px 0; border-bottom:3px solid transparent; color:#64748b; cursor:pointer;">
                            <i class="fa-solid fa-calculator"></i> 求償金額試算
                         </div>
                         <div class="tab-btn" data-target="tab-itinerary" style="padding:10px 0; border-bottom:3px solid transparent; color:#64748b; cursor:pointer;">
                            <i class="fa-solid fa-calendar-check"></i> 行程管理
                         </div>
                    </div>

                    <div id="tab-basic" class="tab-content" style="display:block;">
                    <!-- Head: Status Panel -->
                    <div style="margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between;">
                        <div class="card" style="padding: 1rem 1.5rem; margin-bottom: 0; display:flex; align-items:center; gap: 1rem;">
                            <span class="text-secondary" style="font-weight:600;">案件狀態</span>
                            <select name="status" class="form-select" style="min-width: 160px; border-color: var(--color-accent);">
                                <option value="Waiting" ${data.status === 'Waiting' ? 'selected' : ''}>等待中</option>
                                <option value="Processing" ${data.status === 'Processing' ? 'selected' : ''}>處理中</option>
                                <option value="Litigation" ${data.status === 'Litigation' ? 'selected' : ''}>法訴中</option>
                                <option value="Settled" ${data.status === 'Settled' ? 'selected' : ''}>和解結案</option>
                                <option value="Judgement" ${data.status === 'Judgement' ? 'selected' : ''}>判決結案</option>
                            </select>
                        </div>
                        <div class="text-muted text-sm" style="background:rgba(0,0,0,0.05); padding:0.5rem 1rem; border-radius:20px;">
                            <i class="fa-solid fa-hashtag"></i> ${data.id}
                        </div>
                    </div>

                    <!-- Main Grid Layout -->
                    <div class="form-grid-layout">
                        <!-- Left Column: Case Details -->
                        <div>
                             <!-- Accident Info -->
                             <!-- 1. Accident -->
                            <div class="card">
                                <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-regular fa-calendar-days" style="margin-right:8px; color:var(--color-primary);"></i> 事故基本資訊</h3>
                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label class="form-label">事故日期</label>
                                        <input type="date" name="date" class="form-input" value="${data.date}" required>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">事故時間</label>
                                        <input type="time" name="time" class="form-input" value="${data.time}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">事故類型</label>
                                        <select name="type" class="form-select">
                                            <option value="A1" ${data.type === 'A1' ? 'selected' : ''}>A1 (人員死亡)</option>
                                            <option value="A2" ${data.type === 'A2' ? 'selected' : ''}>A2 (人員受傷)</option>
                                            <option value="A3" ${data.type === 'A3' ? 'selected' : ''}>A3 (單純財損)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-grid-2">
                                    <div class="form-group">
                                        <label class="form-label">事故地點</label>
                                        <input type="text" name="location" class="form-input" value="${data.location}" placeholder="地點...">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">處理單位</label>
                                        <input type="text" name="unit" class="form-input" value="${data.unit}">
                                    </div>
                                </div>
                            </div>

                            <!-- Client Info -->
                            <!-- 2. Client -->
                            <div class="card">
                                <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-solid fa-user" style="margin-right:8px; color:var(--color-primary);"></i> 我方 (客戶)</h3>
                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label class="form-label">客戶姓名</label>
                                        <input type="text" name="clientName" class="form-input" value="${data.clientName}" required placeholder="請輸入姓名">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">聯絡電話</label>
                                        <input type="tel" name="clientPhone" class="form-input" value="${data.clientPhone}" placeholder="09xx-xxx-xxx">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">車牌號碼</label>
                                        <input type="text" name="plate" class="form-input" value="${data.plate}" placeholder="ABC-1234">
                                    </div>
                                </div>
                            </div>

                             <!-- 3. Insurance -->
                            <div class="card">
                                <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-solid fa-shield-halved" style="margin-right:8px; color:var(--color-primary);"></i> 保險理賠資訊</h3>
                                
                                <div style="margin-bottom: 1.5rem; padding: 1rem; background: var(--color-bg-app); border-radius: 8px;">
                                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight: 500;">
                                        <input type="checkbox" name="isNanshan" id="isNanshanCheck" ${data.isNanshan ? 'checked' : ''} style="width:1.2rem; height:1.2rem;">
                                        <span class="custom-checkbox-label" style="font-size:1rem;">案件是否為南山保戶</span>
                                    </label>
                                </div>

                                <!-- Yes: NanShan -->
                                <div id="nanshanFields" style="display: ${data.isNanshan ? 'block' : 'none'}; border-left: 3px solid var(--color-accent); padding-left: 1.5rem; margin-bottom: 2rem;">
                                    <h4 class="text-sm" style="color:var(--color-accent); font-weight:700; margin-bottom:1rem;">南山理賠專區</h4>
                                    <div class="form-grid-2">
                                        <div class="form-group">
                                            <label class="form-label">理賠案件編號</label>
                                            <input type="text" name="selfClaimNum" class="form-input" value="${data.selfClaimNum || ''}">
                                        </div>
                                         <div class="form-group">
                                            <label class="form-label">所屬單位</label>
                                            <input type="text" name="selfContactUnit" class="form-input" value="${data.selfContactUnit || ''}">
                                        </div>
                                    </div>
                                    <div class="form-grid-2">
                                        <div class="form-group">
                                            <label class="form-label">經辦姓名</label>
                                            <input type="text" name="selfContactName" class="form-input" value="${data.selfContactName || ''}">
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label">經辦電話</label>
                                            <input type="tel" name="selfContactPhone" class="form-input" value="${data.selfContactPhone || ''}">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">經辦 Email</label>
                                        <input type="email" name="selfContactMail" class="form-input" value="${data.selfContactMail || ''}">
                                    </div>
                                </div>

                                <!-- No: Other Insurance -->
                                <div id="nonNanshanFields" style="display: ${!data.isNanshan ? 'block' : 'none'};">
                                    <div class="form-group">
                                        <label class="form-label">是否投保任意險 (他家保險)</label>
                                        <select name="selfHasVoluntary" id="selfVolSelect" class="form-select">
                                            <option value="false" ${data.selfHasVoluntary === 'false' ? 'selected' : ''}>否</option>
                                            <option value="true" ${data.selfHasVoluntary === 'true' ? 'selected' : ''}>是 (他家保險)</option>
                                        </select>
                                    </div>

                                    <div id="selfVolFields" style="display: ${data.selfHasVoluntary === 'true' ? 'block' : 'none'}; background: #F8FAFC; padding: 1.5rem; border-radius: 8px; margin-top:1rem;">
                                         <div class="form-group">
                                            <label class="form-label">投保保險公司</label>
                                            <input type="text" name="selfVoluntaryCompany" class="form-input" value="${data.selfVoluntaryCompany || ''}">
                                        </div>
                                        <div class="form-grid-2">
                                            <div class="form-group">
                                                <label class="form-label">理賠案件編號</label>
                                                <input type="text" name="selfVoluntaryClaimNum" class="form-input" value="${data.selfVoluntaryClaimNum || ''}">
                                            </div>
                                             <div class="form-group">
                                                <label class="form-label">所屬單位</label>
                                                <input type="text" name="selfVoluntaryUnit" class="form-input" value="${data.selfVoluntaryUnit || ''}">
                                            </div>
                                        </div>
                                        <div class="form-grid-2">
                                            <div class="form-group">
                                                <label class="form-label">經辦姓名</label>
                                                <input type="text" name="selfVoluntaryContact" class="form-input" value="${data.selfVoluntaryContact || ''}">
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">經辦電話</label>
                                                <input type="tel" name="selfVoluntaryPhone" class="form-input" value="${data.selfVoluntaryPhone || ''}">
                                            </div>
                                        </div>
                                        <div class="form-group">
                                            <label class="form-label">經辦 Email</label>
                                            <input type="email" name="selfVoluntaryMail" class="form-input" value="${data.selfVoluntaryMail || ''}">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Opposing Info & Insurance -->
                            <!-- 4. Opposing -->
                            <div class="card">
                                <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-solid fa-user-injured" style="margin-right:8px; color:var(--color-primary);"></i> 對造 (對方)</h3>
                                <div class="form-grid-3">
                                    <div class="form-group">
                                        <label class="form-label">對造姓名</label>
                                        <input type="text" name="opposingName" class="form-input" value="${data.opposingName}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">聯絡電話</label>
                                        <input type="tel" name="opposingPhone" class="form-input" value="${data.opposingPhone}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">車牌號碼</label>
                                        <input type="text" name="opposingPlate" class="form-input" value="${data.opposingPlate}">
                                    </div>
                                </div>

                                <div class="form-divider" style="margin: 2rem 0; border-top: 1px dashed #e2e8f0;"></div>
                                
                                <div class="form-grid-2">
                                    <div>
                                        <div class="form-group">
                                            <label class="form-label">強制險</label>
                                            <select name="opposingHasCompulsory" id="oppHasCompSelect" class="form-select">
                                                <option value="false" ${data.opposingHasCompulsory === 'false' ? 'selected' : ''}>否 / 不清楚</option>
                                                <option value="true" ${data.opposingHasCompulsory === 'true' ? 'selected' : ''}>是</option>
                                            </select>
                                        </div>
                                        <div id="oppCompField" style="display: ${data.opposingHasCompulsory === 'true' ? 'block' : 'none'}; margin-top:1rem;">
                                            <div class="form-group">
                                                <label class="form-label">強制險保險公司</label>
                                                <input type="text" name="opposingCompulsoryCompany" class="form-input" value="${data.opposingCompulsoryCompany || ''}">
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="form-group">
                                            <label class="form-label">任意險 (第三人)</label>
                                            <select name="opposingHasVoluntary" id="oppVolSelect" class="form-select">
                                                <option value="false" ${data.opposingHasVoluntary === 'false' ? 'selected' : ''}>否 / 不清楚</option>
                                                <option value="true" ${data.opposingHasVoluntary === 'true' ? 'selected' : ''}>是</option>
                                            </select>
                                        </div>
                                        <div id="oppVolFields" style="display: ${data.opposingHasVoluntary === 'true' ? 'block' : 'none'}; background: #F8FAFC; padding: 1rem; border-radius: 8px; margin-top:1rem;">
                                            <div class="form-group">
                                                <label class="form-label">任意險保險公司</label>
                                                <input type="text" name="opposingVoluntaryCompany" class="form-input" value="${data.opposingVoluntaryCompany || ''}">
                                            </div>
                                            <div class="form-group">
                                                <label class="form-label">理賠經辦/案號</label>
                                                <input type="text" name="opposingVoluntaryContact" class="form-input" value="${data.opposingVoluntaryContact || ''}" placeholder="經辦姓名或案號">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Right Column: Attachments & History -->
                        <div>
                             <!-- Attachments -->
                            <div class="card" style="min-height: 250px;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <h3 class="text-h2" style="font-size: 1.25rem;"><i class="fa-solid fa-paperclip" style="margin-right:8px; color:var(--color-primary);"></i> 案件附件</h3>
                                    <!-- Upload All Action -->
                                    <div id="uploadActionContainer"></div> 
                                </div>
                                
                                <div class="file-upload-area" id="dropArea" style="margin-top: 1.5rem; padding: 2rem;">
                                    <i class="fa-solid fa-cloud-arrow-up fa-2x" style="color:var(--color-primary); margin-bottom:1rem;"></i>
                                    <p class="text-sm">拖曳檔案至此 或 <span style="color:var(--color-accent); font-weight:600;">點擊上傳</span></p>
                                    <input type="file" multiple style="display:none;" id="fileInput">
                                </div>
                                <div id="attachmentList" class="attachment-list" style="margin-top: 1.5rem;"></div>
                            </div>
                            
                             </div> <!-- End Left/Right Col Grid -->
                         </div> <!-- End form-grid-layout -->
                    </div> <!-- End tab-basic -->

                    <!-- Calculator Tab -->
                    <div id="tab-calc" class="tab-content" style="display:none;">
                         <div class="card">
                            <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-solid fa-calculator" style="margin-right:8px; color:var(--color-primary);"></i> 求償金額試算明細</h3>
                            
                            <div style="overflow-x:auto;">
                                <table class="table" style="width:100%; border-collapse: collapse; font-size:0.9rem;">
                                    <thead>
                                        <tr style="background:#f8fafc; text-align:left; color:#64748b;">
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:15%;">類別</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:22%;">項目</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:12%;">單價</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:8%;">單位</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:8%;">數量</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:15%; text-align:right;">小計</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:15%;">備註</th>
                                            <th style="width:50px; border-bottom:2px solid #e2e8f0;"></th>
                                        </tr>
                                    </thead>
                                    <tbody id="claimTableBody">
                                        <!-- Dynamic Rows -->
                                    </tbody>
                                </table>
                            </div>
                            
                            <button type="button" id="addClaimBtn" class="btn btn-outline-primary btn-sm" style="margin-top:1rem;">
                                <i class="fa-solid fa-plus"></i> 新增項目
                            </button>

                            <hr style="margin: 20px 0; border:0; border-top:1px dashed #cbd5e1;">

                            <div style="background:#f1f5f9; padding:1.5rem; border-radius:8px;">
                                <div class="form-group" style="max-width:300px; margin-bottom:1rem;">
                                    <label class="form-label" style="font-weight:700; color:#b91c1c;">對造肇責比例 (%)</label>
                                    <input type="number" name="claims_liability" id="claimLiabilityInput" class="form-input" value="${data.claims?.liability || 0}" max="100" style="font-weight:bold; color:#b91c1c;">
                                </div>
                                
                                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:20px;">
                                    <div>
                                        <div class="text-sm text-muted">總損失金額 (未扣折)</div>
                                        <div style="font-size:1.5rem; font-weight:600; color:#475569;" id="calc-total-loss">0</div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div class="text-sm text-muted">建議求償金額 (扣除肇責後)</div>
                                        <div style="font-size:2rem; font-weight:800; color:var(--color-primary);" id="calc-final-amount">0</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Itinerary Tab -->
                    <div id="tab-itinerary" class="tab-content" style="display:none;">
                        <div class="card">
                            <h3 class="text-h2" style="font-size: 1.25rem; margin-bottom: 1.5rem;"><i class="fa-solid fa-calendar-day" style="margin-right:8px; color:var(--color-primary);"></i> 行程與事件管理</h3>
                            
                            <div style="background:#f8fafc; padding:1.5rem; border-radius:8px; margin-bottom: 2rem;">
                                <div class="form-grid-2">
                                    <div class="form-group">
                                        <label class="form-label">事件名稱</label>
                                        <input type="text" id="new-item-event" class="form-input" placeholder="例如：第二次調解會">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label">時間</label>
                                        <input type="datetime-local" id="new-item-time" class="form-input">
                                    </div>
                                </div>
                                <div class="form-group" style="margin-top:10px;">
                                    <label class="form-label">地點</label>
                                    <input type="text" id="new-item-location" class="form-input" placeholder="例如：板橋區調解委員會">
                                </div>
                                <div class="form-group" style="margin-top:10px;">
                                    <label class="form-label">備註</label>
                                    <input type="text" id="new-item-note" class="form-input" placeholder="備註細節...">
                                </div>
                                <div style="margin-top:1.5rem; text-align:right;">
                                    <button type="button" class="btn btn-primary" onclick="App.views.addItineraryItem()">
                                        <i class="fa-solid fa-plus"></i> 新增行程
                                    </button>
                                </div>
                            </div>

                            <div style="overflow-x:auto;">
                                <table class="table" style="width:100%; border-collapse: collapse; font-size:0.9rem;">
                                    <thead>
                                        <tr style="background:#f8fafc; text-align:left; color:#64748b;">
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:20%;">時間</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:20%;">事件</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:25%;">地點</th>
                                            <th style="padding:10px; border-bottom:2px solid #e2e8f0; width:25%;">備註</th>
                                            <th style="width:50px; border-bottom:2px solid #e2e8f0;"></th>
                                        </tr>
                                    </thead>
                                    <tbody id="itineraryTableBody">
                                        <!-- Dynamic Rows -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- Full-width History at the bottom -->
                    ${isEdit ? `
                    <div class="card" style="margin-top: 2rem; min-height: 600px; display:flex; flex-direction:column;">
                        <h3 class="text-h2" style="font-size: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #eee;">
                            <i class="fa-solid fa-comments" style="margin-right:8px; color:var(--color-primary);"></i> 案件處理進度與留言板
                        </h3>
                        
                        <div style="display:flex; gap: 12px; margin-top: 2rem; margin-bottom: 2rem; align-items: flex-end;">
                            <textarea id="newNoteInput" class="form-input" placeholder="輸入新的處理進度、備註或留言..." style="flex:1; height: 44px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; resize: none; line-height: 26px;"></textarea>
                            <button type="button" id="addNoteBtn" class="btn btn-primary" style="padding: 0 1.5rem; height: 44px; border-radius: 6px;">
                                <i class="fa-solid fa-paper-plane" style="margin-right: 6px;"></i> 發送
                            </button>
                        </div>

                        <div class="timeline" id="timelinelog" style="flex:1; overflow-y:visible; padding-left: 40px;"></div>
                    </div>
                    ` : ''}

                    <div style="display:flex; justify-content:flex-end; gap:1rem; padding: 2rem 0; position: sticky; bottom: 0; background: linear-gradient(to top, var(--color-bg-app) 92%, transparent); z-index: 20; padding-bottom: 2rem;">
                        <button type="button" class="btn btn-ghost" onclick="window.location.hash='#cases'" style="background:white; border:1px solid #E2E8F0;">取消</button>
                        <button type="submit" class="btn btn-primary" style="padding: 0.75rem 4rem; font-size:1rem; box-shadow: var(--shadow-float);">
                            <i class="fa-solid fa-save"></i> 儲存
                        </button>
                    </div>
                </form>
            `;

            // --- Render Logic ---

            // --- Tab & Calc Logic ---
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const target = btn.dataset.target;
                    document.querySelectorAll('.tab-btn').forEach(b => {
                        b.classList.remove('active');
                        b.style.borderColor = 'transparent';
                        b.style.color = '#64748b';
                    });
                    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

                    btn.classList.add('active');
                    btn.style.borderColor = 'var(--color-primary)';
                    btn.style.color = 'var(--color-primary)';
                    document.getElementById(target).style.display = 'block';
                });
            });

            // --- Dynamic Table Logic ---
            // Use local variable to track items state
            let items = Array.isArray(data.claims?.items) ? JSON.parse(JSON.stringify(data.claims.items)) : [];

            // Migration: Check for legacy format
            if (items.length === 0 && data.claims && (data.claims.medical > 0 || data.claims.salary > 0)) {
                const map = {
                    medical: '醫療費用 (舊)', salary: '薪資損失 (舊)', car_repair: '車損 (舊)',
                    mental: '精神慰撫 (舊)', other: '其他 (舊)', transport: '交通 (舊)'
                };
                Object.keys(map).forEach(k => {
                    if (data.claims[k] > 0) {
                        items.push({
                            id: Date.now() + Math.random(),
                            type: '財損',
                            name: map[k],
                            price: data.claims[k],
                            unit: '元',
                            count: 1,
                            total: data.claims[k],
                            note: '自動遷移'
                        });
                    }
                });
            }

            const tableBody = document.getElementById('claimTableBody');
            const liabilityInput = document.getElementById('claimLiabilityInput');

            // Render Function
            const renderRows = () => {
                if (!tableBody) return;
                tableBody.innerHTML = items.map((item, idx) => `
                    <tr>
                        <td>
                            <select class="form-select" style="padding:4px;" onchange="App.views.updateCompItem(${idx}, 'type', this.value)">
                                <option value="財損" ${item.type === '財損' ? 'selected' : ''}>財損</option>
                                <option value="體傷" ${item.type === '體傷' ? 'selected' : ''}>體傷</option>
                            </select>
                        </td>
                        <td><input type="text" class="form-input" style="padding:4px;" value="${item.name || ''}" onchange="App.views.updateCompItem(${idx}, 'name', this.value)"></td>
                        <td><input type="number" class="form-input" style="padding:4px;" value="${item.price || 0}" onchange="App.views.updateCompItem(${idx}, 'price', parseFloat(this.value))"></td>
                        <td><input type="text" class="form-input" style="padding:4px;" value="${item.unit || '式'}" onchange="App.views.updateCompItem(${idx}, 'unit', this.value)"></td>
                        <td><input type="number" class="form-input" style="padding:4px;" value="${item.count || 1}" onchange="App.views.updateCompItem(${idx}, 'count', parseFloat(this.value))"></td>
                        <td style="text-align:right; font-weight:bold; padding-right:1rem; vertical-align:middle;">${parseInt(item.total).toLocaleString()}</td>
                        <td><input type="text" class="form-input" style="padding:4px;" value="${item.note || ''}" onchange="App.views.updateCompItem(${idx}, 'note', this.value)"></td>
                        <td style="vertical-align:middle;"><button type="button" class="btn-icon-danger" onclick="App.views.deleteCompItem(${idx})"><i class="fa-solid fa-trash"></i></button></td>
                    </tr>
                `).join('');
                calculateTotal();
            };

            const calculateTotal = () => {
                const total = items.reduce((sum, item) => sum + (item.total || 0), 0);
                const liability = parseFloat(liabilityInput?.value || 0);
                const final = Math.round(total * (liability / 100));

                const tEl = document.getElementById('calc-total-loss');
                const fEl = document.getElementById('calc-final-amount');
                if (tEl) tEl.textContent = total.toLocaleString();
                if (fEl) fEl.textContent = final.toLocaleString();
            };

            // Helpers (Global attachment to support inline events)
            App.views.updateCompItem = (idx, field, value) => {
                items[idx][field] = value;
                if (field === 'price' || field === 'count') {
                    items[idx].total = (items[idx].price || 0) * (items[idx].count || 0);
                }
                renderRows();
            };
            App.views.deleteCompItem = (idx) => {
                if (confirm('確定刪除此項目？')) {
                    items.splice(idx, 1);
                    renderRows();
                }
            };

            // Bind Add Button
            const addBtn = document.getElementById('addClaimBtn');
            if (addBtn) {
                addBtn.onclick = () => {
                    items.push({ type: '財損', name: '', price: 0, unit: '式', count: 1, total: 0, note: '' });
                    renderRows();
                };
            }
            if (liabilityInput) {
                liabilityInput.oninput = calculateTotal;
            }

            // 1. Itinerary Logic
            let itinerary = Array.isArray(data.itinerary) ? JSON.parse(JSON.stringify(data.itinerary)) : [];
            const itinBody = document.getElementById('itineraryTableBody');

            const renderItinRows = () => {
                if (!itinBody) return;
                itinBody.innerHTML = itinerary.sort((a, b) => new Date(a.time) - new Date(b.time)).map((item, idx) => `
                    <tr>
                        <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${new Date(item.time).toLocaleString('zh-TW')}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f5f9; font-weight:600;">${item.event}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f5f9;">${item.location || '-'}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f5f9; color:#64748b;">${item.note || '-'}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f5f9; text-align:center;">
                            <button type="button" class="btn-icon-danger" onclick="App.views.deleteItineraryItem(${idx})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `).join('');
            };

            App.views.addItineraryItem = () => {
                const event = document.getElementById('new-item-event').value.trim();
                const time = document.getElementById('new-item-time').value;
                const location = document.getElementById('new-item-location').value.trim();
                const note = document.getElementById('new-item-note').value.trim();

                if (!event || !time) {
                    App.showToast('錯誤', '請填寫事件名稱與時間', 'error');
                    return;
                }

                itinerary.push({ event, time, location, note, notified: [] });
                renderItinRows();

                // Clear inputs
                document.getElementById('new-item-event').value = '';
                document.getElementById('new-item-time').value = '';
                document.getElementById('new-item-location').value = '';
                document.getElementById('new-item-note').value = '';
                App.showToast('成功', '行程已加入', 'success');
            };

            App.views.deleteItineraryItem = (idx) => {
                if (confirm('確定刪除此行程？')) {
                    itinerary.splice(idx, 1);
                    renderItinRows();
                }
            };

            renderRows();
            renderItinRows();

            // 1. Render Attachments
            const renderAttachments = () => {
                const list = document.getElementById('attachmentList');
                if (!list) return; // Robustness

                // Check if any files need upload
                const hasPending = data.attachments.some(f => !f.url);

                if (data.attachments.length === 0) {
                    list.innerHTML = '<div class="text-sm text-muted" style="text-align:center;">暫無附件</div>';
                    return;
                }

                let html = '';

                // Batch Upload Button (Only if pending files exist)
                if (hasPending) {
                    html += `
                        <div style="margin-bottom: 1rem; text-align: right;">
                            <button type="button" id="uploadAllBtn" class="btn btn-primary" style="font-size: 0.85rem; padding: 0.4rem 1rem;">
                                <i class="fa-solid fa-cloud-arrow-up"></i> 上傳未同步檔案
                            </button>
                        </div>
                    `;
                }

                html += data.attachments.map((file, idx) => `
                    <div class="attachment-item">
                        <div class="attachment-info">
                            <i class="fa-solid ${file.type.includes('image') ? 'fa-file-image' : 'fa-file-pdf'}"></i>
                            <div>
                                <div style="font-weight:500; display:flex; align-items:center;">
                                    <button type="button" class="btn-icon" onclick="App.views.currentCaseHandlers.renameAttachment(${idx})" style="width:24px; height:24px; font-size:12px; margin-right:6px;" title="修改檔名"><i class="fa-solid fa-pen"></i></button>
                                    ${file.url ? `<a href="${file.url}" target="_blank" style="text-decoration:none; color:inherit;">${file.name}</a>` : file.name}
                                </div>
                                <div class="text-muted" style="font-size:0.75rem;">
                                    ${file.date} ${file.url ? '<span style="color:var(--color-success); margin-left:5px;"><i class="fa-solid fa-check"></i> 已同步</span>' : '<span style="color:var(--color-warning); margin-left:5px;"><i class="fa-solid fa-circle-exclamation"></i> 待上傳</span>'}
                                </div>
                            </div>
                        </div>
                        <button type="button" class="btn-icon-danger" data-remove-idx="${idx}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `).join('');

                list.innerHTML = html;

                // Bind Remove Handlers
                list.querySelectorAll('[data-remove-idx]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const idx = parseInt(btn.dataset.removeIdx);
                        if (confirm('確定刪除此附件記錄？')) {
                            data.attachments.splice(idx, 1);
                            renderAttachments();
                        }
                    });
                });

                // Bind Upload Handler
                const uploadBtn = document.getElementById('uploadAllBtn');
                if (uploadBtn) {
                    uploadBtn.addEventListener('click', async () => {
                        const originalText = uploadBtn.innerHTML;
                        uploadBtn.disabled = true;
                        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...';

                        try {
                            // Pass current local 'data' so it gets updated in real-time
                            const result = await App.data.uploadPendingFiles(data);
                            if (result.success) {
                                App.showToast('上傳成功', '成功上傳 ' + result.count + ' 個檔案', 'success');
                                renderAttachments(); // Re-render to show links
                            } else {
                                App.showToast('上傳失敗', '請檢查網路或系統設定', 'error');
                            }
                        } catch (e) {
                            App.showToast('上傳錯誤', e.message, 'error');
                        } finally {
                            if (uploadBtn) {
                                uploadBtn.disabled = false;
                                uploadBtn.innerHTML = originalText;
                            }
                        }
                    });
                }
            };

            // 2. Render Timeline
            // Store handlers globally so onclick works
            App.views.currentCaseHandlers = {
                deleteNote: (index) => {
                    if (confirm('確定要刪除這條紀錄嗎？')) {
                        data.history.splice(index, 1);
                        renderTimeline();
                    }
                },
                editNote: (index) => {
                    const item = data.history[index];
                    const newContent = prompt('編輯內容：', item.content);
                    if (newContent !== null) {
                        item.content = newContent;
                        item.date = new Date().toLocaleString('zh-TW') + ' (已編輯)';
                        renderTimeline();
                    }
                },
                renameAttachment: (index) => {
                    const file = data.attachments[index];
                    const newName = prompt('請輸入新的檔案名稱：', file.name);
                    if (newName && newName.trim() !== '') {
                        file.name = newName.trim();
                        renderAttachments();
                    }
                }
            };

            // 2. Render Timeline
            const renderTimeline = () => {
                const list = document.getElementById('timelinelog');
                if (!list) return;
                if (data.history.length === 0) {
                    list.innerHTML = '<div class="text-sm text-muted" style="padding-left:1rem;">尚無紀錄</div>';
                    return;
                }

                // Render directly from data.history to keep index sync
                // Assuming unshift is used, index 0 is newest. 
                list.innerHTML = data.history.map((item, index) => `
                    <div class="timeline-item">
                        <div class="timeline-dot"></div>
                        <div class="timeline-content">
                            <div class="timeline-date" style="display:flex; justify-content:space-between; align-items:center;">
                                <span>${item.date}</span>
                                <div class="no-print">
                                     <button type="button" class="btn-icon" style="width:24px; height:24px; font-size:12px;" onclick="App.views.currentCaseHandlers.editNote(${index})" title="編輯"><i class="fa-solid fa-pen"></i></button>
                                     <button type="button" class="btn-icon" style="width:24px; height:24px; font-size:12px; color:#ef4444;" onclick="App.views.currentCaseHandlers.deleteNote(${index})" title="刪除"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </div>
                            <div style="white-space: pre-wrap;">${item.content}</div>
                        </div>
                    </div>
                `).join('');
            };

            renderAttachments();
            renderTimeline();

            // --- Event Bindings ---

            // Dynamic Insurance Logic
            const toggleDisplay = (id, show) => {
                const el = document.getElementById(id);
                if (el) el.style.display = show ? 'block' : 'none';
            };

            const oppHasCompSelect = document.getElementById('oppHasCompSelect');
            oppHasCompSelect.addEventListener('change', (e) => {
                toggleDisplay('oppCompField', e.target.value === 'true');
            });

            const oppVolSelect = document.getElementById('oppVolSelect');
            oppVolSelect.addEventListener('change', (e) => {
                toggleDisplay('oppVolFields', e.target.value === 'true');
            });

            const isNanshanCheck = document.getElementById('isNanshanCheck');
            const selfVolSelect = document.getElementById('selfVolSelect');

            const updateSelfInsuranceUI = () => {
                const isNS = isNanshanCheck.checked;
                toggleDisplay('nanshanFields', isNS);
                toggleDisplay('nonNanshanFields', !isNS);
                if (!isNS) {
                    toggleDisplay('selfVolFields', selfVolSelect.value === 'true');
                }
            };
            isNanshanCheck.addEventListener('change', updateSelfInsuranceUI);

            selfVolSelect.addEventListener('change', (e) => {
                toggleDisplay('selfVolFields', e.target.value === 'true');
            });

            // Initial UI Sync (if editing)
            updateSelfInsuranceUI();


            // File Upload
            const dropArea = document.getElementById('dropArea');
            const fileInput = document.getElementById('fileInput');
            dropArea.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const files = Array.from(e.target.files);
                files.forEach(f => {
                    // Queue for upload to GAS on Save
                    const tempId = App.data.queueUpload(data.id, f);

                    data.attachments.push({
                        name: f.name,
                        type: f.type || 'unknown',
                        size: (f.size / 1024).toFixed(1) + ' KB',
                        date: new Date().toISOString().split('T')[0],
                        tempId: tempId, // Link to queued file
                        url: null       // No URL yet
                    });
                });
                renderAttachments();
            });

            // Add Note
            const addNoteBtn = document.getElementById('addNoteBtn');
            const newNoteInput = document.getElementById('newNoteInput');
            if (addNoteBtn && newNoteInput) {
                const addNote = () => {
                    const val = newNoteInput.value.trim();
                    if (!val) return;
                    data.history.unshift({
                        date: new Date().toLocaleString('zh-TW'),
                        content: val,
                        type: 'note'
                    });
                    newNoteInput.value = '';
                    renderTimeline();
                };
                addNoteBtn.addEventListener('click', addNote);
                newNoteInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });
            }

            // Form Submit
            const form = document.getElementById('caseForm');
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(form);

                // Update basic fields
                const rawData = Object.fromEntries(formData.entries());
                // If it is edit mode, keep original arrays, else new arrays
                const finalData = { ...data, ...rawData };

                // Dynamic Claims
                const liability = parseFloat(formData.get('claims_liability')) || 0;
                // Cleanup
                delete rawData.claims_liability;

                finalData.claims = {
                    liability: liability,
                    items: items
                };
                finalData.itinerary = itinerary;

                // Old logic removed
                /*
                Object.keys(rawData).forEach(key => {
                    if (key.startsWith('claims_')) {
                       // ...
                    }
                });
                */
                finalData.isNanshan = formData.get('isNanshan') === 'on';

                // Re-assign to newData
                const newData = finalData;

                if (isEdit) {
                    App.data.updateCase(newData);
                } else {
                    App.data.addCase(newData);
                }

                App.showToast('儲存成功', '案件資料已更新', 'success');
                window.location.hash = '#cases';
            });
        }
    },

    addUser(u, p) {
        if (!this.data.settings.users) this.data.settings.users = [];
        // Check duplicate
        if (this.data.settings.users.find(user => user.u === u)) {
            App.showToast('錯誤', '使用者已存在', 'error');
            return;
        }
        this.data.settings.users.push({ u, p });
        this.data.save(); // Save settings to local

        // Re-render list if exposed
        if (this._renderUserList) this._renderUserList();

        App.showToast('成功', '使用者已新增', 'success');

        // Trigger Sync immediately to backup user data
        this.data.syncToCloud();
    },

    removeUser(username) {
        if (confirm(`確定要刪除使用者 ${username} 嗎？`)) {
            if (!this.data.settings.users) return;
            this.data.settings.users = this.data.settings.users.filter(u => u.u !== username);
            this.data.save();

            if (this._renderUserList) this._renderUserList();

            App.showToast('刪除成功', '使用者已移除', 'success');

            // Trigger Sync
            this.data.syncToCloud();
        }
    },

    printCase(data) {
        // 1. Set Custom Document Title for PDF Filename
        const originalTitle = document.title;
        document.title = `${data.clientName}交通事故資料表`;

        // Status Logic for Print
        const steps = [
            { label: '受理/等待中', match: ['Waiting', 'New'] },
            { label: '處理中/法訴中', match: ['Processing', 'Litigation'] },
            { label: '結案', match: ['Settled', 'Judgement', 'Completed'] }
        ];
        let stepHTML = steps.map(s => {
            const isActive = s.match.includes(data.status || 'Waiting') || (s.label === '結案' && ['Settled', 'Judgement', 'Completed'].includes(data.status));
            return `<span class="print-step ${isActive ? 'active' : ''}">${s.label}</span>`;
        }).join(' <span style="color:#ccc">→</span> ');

        // --- CALC LOGIC START ---
        const items = (data.claims && data.claims.items) ? data.claims.items : [];
        const total = items.reduce((sum, i) => sum + (i.total || 0), 0);
        const liability = data.claims ? (data.claims.liability || 0) : 0;
        const final = Math.round(total * (liability / 100));

        const claimRows = items.length === 0
            ? '<tr><td colspan="7" style="text-align:center;color:#777;">無資料</td></tr>'
            : items.map(i => `
            <tr>
                <td>${i.type}</td>
                <td>${i.name}</td>
                <td>${parseInt(i.price || 0).toLocaleString()}</td>
                <td>${i.unit}</td>
                <td>${i.count}</td>
                <td style="text-align:right;">${parseInt(i.total || 0).toLocaleString()}</td>
                <td>${i.note || ''}</td>
            </tr>
        `).join('');
        // --- CALC LOGIC END ---

        const html = `
            <div class="report-container">
                <style>
                    /* Print specific overrides */
                    @media print {
                        @page { margin: 8mm; size: auto; } /* Optimized margins */
                        html, body { margin: 0; padding: 0; width: 100%; }
                        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        
                        .report-container { width: 100% !important; max-width: 100% !important; margin: 0; padding: 0; }
                        .report-header { margin-top: 0; }
                        
                        .comparison-table th, .comparison-table td { padding: 4px 6px; font-size: 9pt; }
                        .info-item { margin-bottom: 4px; }
                        .report-section { margin-bottom: 12px; page-break-inside: avoid; }
                        
                        /* Fix table overflow */
                        table { width: 100% !important; table-layout: fixed; }
                        td, th { word-wrap: break-word; overflow-wrap: break-word; }
                        
                        /* Hide things */
                        button, .no-print { display: none !important; }
                    }
                    
                    /* Add Table CSS */
                    .claim-table { width: 100%; border-collapse: collapse; font-size: 0.85em; margin-top: 10px; table-layout: fixed; }
                    .claim-table th, .claim-table td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; vertical-align: middle; word-wrap: break-word; }
                    .claim-table th { background: #f1f5f9; font-weight: 600; color: #475569; }
                    .total-box { float: right; width: 220px; margin-top: 12px; padding: 8px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; page-break-inside: avoid; box-shadow: none; }
                </style>
                <div class="report-header">
                    <div>
                        <div class="report-title">交通事故案件資料表</div>
                        <div style="font-size:12px; margin-top:5px; color:#666;">Traffic Accident Case Data</div>
                    </div>
                    <div class="report-meta">
                        <div>列印日期: ${new Date().toISOString().split('T')[0]}</div>
                        <div>案件編號: <strong>${data.id}</strong></div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">目前進度狀態</div>
                    <div class="print-timeline">
                        ${stepHTML}
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">事故基本資訊</div>
                    <div class="info-grid">
                        <div class="info-item"><span class="info-label">事故日期</span> <span class="info-value">${data.date}</span></div>
                        <div class="info-item"><span class="info-label">事故時間</span> <span class="info-value">${data.time || '--:--'}</span></div>
                        <div class="info-item"><span class="info-label">事故地點</span> <span class="info-value">${data.location || '未填寫'}</span></div>
                        <div class="info-item"><span class="info-label">處理單位</span> <span class="info-value">${data.unit || '未填寫'}</span></div>
                        <div class="info-item"><span class="info-label">事故類型</span> <span class="info-value">${data.type || 'A3'}</span></div>
                        <div class="info-item"><span class="info-label">車牌號碼</span> <span class="info-value">${data.plate}</span></div>
                        <div class="info-item"><span class="info-label">客戶姓名</span> <span class="info-value">${data.clientName}</span></div>
                        <div class="info-item"><span class="info-label">聯絡電話</span> <span class="info-value">${data.clientPhone}</span></div>
                    </div>
                </div>

                <div class="report-section">
                    <div class="report-section-title">聯絡資訊與保險資訊</div>
                    <table class="comparison-table">
                        <thead>
                            <tr>
                                <th width="15%">項目</th>
                                <th width="42%">我方資訊 (Self)</th>
                                <th width="42%">對方資訊 (Opposing)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>駕駛/聯絡人</td>
                                <td>${data.clientName || ''} <br><span style="font-size:9pt;color:#666">${data.clientPhone || ''}</span></td>
                                <td>${data.opposingName || ''} <br><span style="font-size:9pt;color:#666">${data.opposingPhone || ''}</span></td>
                            </tr>
                            <tr>
                                <td>車牌</td>
                                <td>${data.plate}</td>
                                <td>${data.opposingPlate || '-'}</td>
                            </tr>
                            <tr>
                                <td>強制險</td>
                                <td>-</td>
                                <td>
                                    ${data.opposingHasCompulsory === 'true' ? '有' : '無'}
                                    ${data.opposingCompulsoryCompany ? `(${data.opposingCompulsoryCompany})` : ''}
                                </td>
                            </tr>
                            <tr>
                                <td>任意險</td>
                                <td>
                                    ${data.selfHasVoluntary === 'true' ? '有' : '無'}
                                    ${data.selfVoluntaryCompany ? `<br>${data.selfVoluntaryCompany}` : ''}
                                </td>
                                <td>
                                    ${data.opposingHasVoluntary === 'true' ? '有' : '無'}
                                    ${data.opposingVoluntaryCompany ? `<br>${data.opposingVoluntaryCompany}` : ''}
                                </td>
                            </tr>
                            <tr>
                                <td>理賠承辦 / 案號</td>
                                <td>
                                    ${data.isNanshan ?
                `<strong>(南山)</strong><br>案號: ${data.selfClaimNum || '-'}<br>承辦: ${data.selfContactName || '-'}` :
                data.selfHasVoluntary === 'true' ?
                    `案號: ${data.selfVoluntaryClaimNum || '-'}<br>承辦: ${data.selfVoluntaryContact || '-'}` :
                    '-'}
                                </td>
                                <td>
                                    ${data.opposingHasVoluntary === 'true' ?
                `${data.opposingVoluntaryContact || '-'}` :
                '-'}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- NEW CLAIM SECTION -->
                <div class="report-section">
                    <div class="report-section-title">求償金額試算 (Claims)</div>
                    <table class="claim-table">
                        <thead>
                            <tr>
                                <th width="10%">類別</th>
                                <th width="25%">項目</th>
                                <th width="12%">單價</th>
                                <th width="8%">單位</th>
                                <th width="8%">數量</th>
                                <th width="15%" style="text-align:right;">小計</th>
                                <th>備註</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${claimRows}
                        </tbody>
                    </table>
                    
                    <div class="total-box">
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span>總損失金額:</span>
                            <strong>${total.toLocaleString()}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                            <span>對造肇責比例:</span>
                            <strong>${liability}%</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; border-top:1px solid #ccc; padding-top:5px; margin-top:5px; font-size:1.2em;">
                            <span>建議求償:</span>
                            <strong style="color:#00479D">${final.toLocaleString()} 元</strong>
                        </div>
                    </div>
                    <div style="clear:both;"></div>
                </div>

                ${data.history.length > 0 ? `
                <div class="report-section">
                    <div class="report-section-title">處理紀錄</div>
                    <div class="history-log">
                        ${data.history.map(h => `
                            <div class="history-row">
                                <div class="history-date">${h.date.split(' ')[0]}</div>
                                <div style="flex:1;">${h.content}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}

                <div class="report-footer">
                    系統產⽣報表。列印時間: ${new Date().toLocaleString('zh-TW')}
                </div>
            </div>
        `;

        const printArea = document.getElementById('print-area');
        if (printArea) {
            printArea.innerHTML = html;
            setTimeout(() => {
                window.print();
                document.title = originalTitle;
            }, 500);
        } else {
            // Fallback
            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
            win.print();
        }
    },

    async init() {
        this.exposeGlobal(); // Ensure global access immediately

        if (this.isInitialized) return;
        this.isInitialized = true;

        this.checkLogin();
        // Cloud-first: load will init empty data
        this.data.load();
        this.router.init();
        this.initAutoLogout();
        this.initSidebar();

        // Login Form Binding
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                this.handleLogin(formData.get('username'), formData.get('password'));
            });
        }

        // Auto Download from Cloud if Logged In
        if (sessionStorage.getItem('traffic_user')) {
            // Show Loading Overlay
            const spinner = document.createElement('div');
            spinner.id = 'app-loading-overlay';
            spinner.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.95);z-index:9999;display:flex;justify-content:center;align-items:center;flex-direction:column;';
            spinner.innerHTML = '<i class="fa-solid fa-cloud-arrow-down fa-bounce fa-2x" style="color:#0f172a;margin-bottom:1rem;"></i><div style="color:#333;font-weight:500;">正在從雲端同步資料...</div><div class="text-muted text-xs" style="margin-top:0.5rem">請稍候</div>';
            document.body.appendChild(spinner);

            // Force Download
            try {
                await this.data.downloadFromCloud(true);
            } catch (e) {
                console.error(e);
            } finally {
                if (spinner) spinner.remove();
            }
        }
    },

    checkLogin() {
        const userStr = sessionStorage.getItem('traffic_user');
        const loginView = document.getElementById('login-view');
        const appView = document.getElementById('app-view');

        if (!userStr) {
            // Not logged in
            if (loginView) loginView.style.display = 'block';
            if (appView) appView.style.display = 'none';
        } else {
            // Logged in
            if (loginView) loginView.style.display = 'none';
            if (appView) {
                appView.style.display = 'flex';
            }

            this.currentUser = JSON.parse(userStr);

            // Update Profile UI
            const profileImg = document.querySelector('.user-profile img');
            const profileName = document.getElementById('currentUserDisplay');

            if (profileImg && this.currentUser.username) {
                profileImg.src = `https://ui-avatars.com/api/?name=${this.currentUser.username}&background=00479D&color=fff`;
            }
            if (profileName && this.currentUser.username) {
                profileName.textContent = this.currentUser.username;
            }
        }
    },

    async handleLogin(username, password) {
        const btn = document.querySelector('#loginForm button');
        const originalText = btn ? btn.innerHTML : 'Login';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 驗證中...';
        }

        try {
            let isAuthenticated = false;
            let isDefaultAdmin = false;
            let validUsers = App.data.settings.users || [];

            // 1. Check for Initial Setup (No users defined locally or cloud URL unknown)
            if (validUsers.length === 0 && !App.data.settings.cloudScriptUrl) {
                if (username === 'admin' && password === 'admin') {
                    isAuthenticated = true;
                    isDefaultAdmin = true;
                }
            } else {
                // 2. Try Cloud Auth (Priority)
                if (App.data.settings.cloudScriptUrl) {
                    try {
                        const targetUrl = App.data.settings.cloudScriptUrl + (App.data.settings.cloudScriptUrl.includes('?') ? '&' : '?') + 'action=login&u=' + encodeURIComponent(username) + '&p=' + encodeURIComponent(password);
                        const response = await fetch(targetUrl);
                        const resData = await response.json();

                        if (resData.status === 'success') {
                            isAuthenticated = true;
                        } else {
                            // Explicit cloud denial
                            throw new Error('雲端驗證失敗: ' + (resData.message || '帳號密碼錯誤'));
                        }
                    } catch (e) {
                        // Network error or Script error logic
                        console.warn('Cloud login skipped/failed:', e);
                        // If network fails, DO WE FALLBACK? 
                        // User requested "Verified against cloud". But if offline?
                        // Let's fallback to local cache check if strictly network error
                        if (e.message.includes('fetch') || e.message.includes('Failed to fetch')) {
                            App.showToast('連線警告', '無法連接雲端，嘗試離線登入', 'warning');
                            const user = validUsers.find(u => u.u === username && u.p === password);
                            if (user) isAuthenticated = true;
                        } else {
                            throw e; // Rethrow explicit auth errors
                        }
                    }
                } else {
                    // No Cloud URL yet, check local
                    const user = validUsers.find(u => u.u === username && u.p === password);
                    if (user) isAuthenticated = true;
                }
            }

            if (isAuthenticated) {
                sessionStorage.setItem('traffic_user', JSON.stringify({ username }));
                this.checkLogin();
                App.showToast('登入成功', '歡迎回來 ' + username, 'success');

                // Auto Load Data
                setTimeout(() => {
                    App.data.downloadFromCloud(true);
                }, 500);

                // Security Prompt
                if (isDefaultAdmin && username === 'admin') {
                    setTimeout(() => {
                        if (confirm('安全警告：您目前使用預設帳號 (admin/admin)。\n\n為了防止資料外洩，請立即前往「設定」頁面建立新的專屬帳號。\n建立新帳號後，預設 admin 將自動失效。\n\n是否現在前往設定？')) {
                            window.location.hash = '#settings';
                        }
                    }, 800);
                }
            } else {
                throw new Error('帳號或密碼錯誤');
            }

        } catch (err) {
            App.showToast('登入失敗', err.message || '驗證失敗', 'error');
            const pwInput = document.querySelector('#loginForm input[type="password"]');
            if (pwInput) pwInput.value = '';
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    },

    logout() {
        sessionStorage.removeItem('traffic_user');
        window.location.reload();
    },

    _removed_printCase(c) {
        if (!c) return;
        const width = 900;
        const height = 800;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        const win = window.open('', '_blank', `width=${width},height=${height},top=${top},left=${left}`);

        const items = (c.claims && c.claims.items) ? c.claims.items : [];
        const total = items.reduce((sum, i) => sum + (i.total || 0), 0);
        const liability = c.claims ? (c.claims.liability || 0) : 0;
        const final = Math.round(total * (liability / 100));

        const claimRows = items.length === 0
            ? '<tr><td colspan="7" style="text-align:center;color:#777;">無資料</td></tr>'
            : items.map(i => `
            <tr>
                <td>${i.type}</td>
                <td>${i.name}</td>
                <td>${parseInt(i.price || 0).toLocaleString()}</td>
                <td>${i.unit}</td>
                <td>${i.count}</td>
                <td style="text-align:right;">${parseInt(i.total || 0).toLocaleString()}</td>
                <td>${i.note || ''}</td>
            </tr>
        `).join('');

        win.document.write(`
            <html>
            <head>
                <title>案件報表 - ${c.clientName}</title>
                <style>
                    body { font-family: "Microsoft JhengHei", sans-serif; padding: 40px; color: #333; line-height:1.5; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #333; padding-bottom: 15px; }
                    h1 { margin:0 0 10px 0; font-size:1.8em; }
                    .meta { color:#555; font-size:0.9em; }
                    .section { margin-bottom: 30px; }
                    .section-title { font-weight: bold; border-left: 5px solid #00479D; padding-left: 10px; margin-bottom: 12px; font-size: 1.1em; background:#f8fafc; padding:8px 10px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 0.9em; }
                    th, td { border: 1px solid #ddd; padding: 10px 12px; text-align: left; }
                    th { background: #f1f5f9; font-weight:600; color:#475569; }
                    .total-box { float: right; width: 320px; padding: 15px; border: 2px solid #cbd5e1; background:#f8fafc; border-radius:4px; }
                    .row { display:flex; justify-content:space-between; margin-bottom:5px; }
                    .final { border-top:2px solid #94a3b8; margin-top:10px; padding-top:10px; font-size:1.2em; font-weight:bold; color:#00479D; }
                    @media print {
                        body { padding:0; }
                        .no-print { display:none; }
                        .section-title { -webkit-print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>交通事故案件紀錄表</h1>
                    <div class="meta">案件編號: ${c.id} &nbsp;|&nbsp; 事故日期: ${c.date}</div>
                </div>

                <div class="section">
                    <div class="section-title">一、基本資料</div>
                    <table>
                        <tr>
                            <th width="15%">保戶姓名</th>
                            <td width="35%">${c.clientName}</td>
                            <th width="15%">車牌號碼</th>
                            <td width="35%">${c.plate}</td>
                        </tr>
                        <tr>
                            <th>事故時間</th>
                            <td>${c.time || ''}</td>
                            <th>事故地點</th>
                            <td>${c.location}</td>
                        </tr>
                         <tr>
                            <th>事故類型</th>
                            <td>${c.type}</td>
                            <th>處理單位</th>
                            <td>${c.unit}</td>
                        </tr>
                    </table>
                </div>

                <div class="section">
                    <div class="section-title">二、對造資料</div>
                    <table>
                        <tr>
                            <th width="15%">對造姓名</th>
                            <td width="35%">${c.opposingName || '-'}</td>
                            <th width="15%">對造車牌</th>
                            <td width="35%">${c.opposingPlate || '-'}</td>
                        </tr>
                        <tr>
                            <th>強制險</th>
                            <td>${c.opposingHasCompulsory === 'true' ? '有 (' + c.opposingCompulsoryCompany + ')' : '無'}</td>
                            <th>任意險</th>
                            <td>${c.opposingHasVoluntary === 'true' ? '有 (' + c.opposingVoluntaryCompany + ')' : '無'}</td>
                        </tr>
                    </table>
                </div>

                <div class="section">
                    <div class="section-title">三、求償金額試算 (Claims)</div>
                    <table>
                        <thead>
                            <tr>
                                <th width="10%">類別</th>
                                <th width="25%">項目</th>
                                <th width="12%">單價</th>
                                <th width="8%">單位</th>
                                <th width="8%">數量</th>
                                <th width="15%" style="text-align:right;">小計</th>
                                <th>備註</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${claimRows}
                        </tbody>
                    </table>
                    
                    <div class="total-box">
                        <div class="row">
                            <span>總損失金額 (Total):</span>
                            <strong>${total.toLocaleString()}</strong>
                        </div>
                        <div class="row">
                            <span>對造肇責比例 (Liability):</span>
                            <strong>${liability}%</strong>
                        </div>
                        <div class="row final">
                            <span>建議求償金額:</span>
                            <span>${final.toLocaleString()} 元</span>
                        </div>
                    </div>
                    <div style="clear:both;"></div>
                </div>
                
                <div class="section" style="margin-top:40px; page-break-inside:avoid;">
                    <div class="section-title">四、案件歷程 (History)</div>
                    <table style="border:none;">
                        ${c.history.map(h => `
                            <tr>
                                <td width="160" style="border:none; border-bottom:1px solid #eee; color:#666;">${h.date}</td>
                                <td style="border:none; border-bottom:1px solid #eee;">${h.content}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                
                <div style="margin-top:50px; text-align:center; font-size:0.8em; color:#999; border-top:1px solid #eee; padding-top:10px;">
                    Generated by Traffic Accident Management System
                </div>
                <script>
                    setTimeout(() => { window.print(); }, 500);
                </script>
            </body>
            </html>
        `);
        win.document.close();
    },

    initSidebar() {
        const toggleBtn = document.getElementById('sidebarToggle');
        const sidebar = document.querySelector('.sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });
        }
    },

    initAutoLogout() {
        let timeout;
        const IDLE_LIMIT = 15 * 60 * 1000; // 15 Minutes

        const resetTimer = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (sessionStorage.getItem('traffic_user')) {
                    alert('系統提示：因閒置超過15分鐘，為保護資料安全已自動登出。');
                    App.logout();
                }
            }, IDLE_LIMIT);
        };

        window.onload = resetTimer;
        document.onmousemove = resetTimer;
        document.onkeypress = resetTimer;
        document.ontouchstart = resetTimer;
        document.onclick = resetTimer;

        resetTimer();
    }
};

// Start App
document.addEventListener('DOMContentLoaded', () => {
    window.App = App; // Double ensure global
    App.init();
});
