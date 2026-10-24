// --- 主程序入口 (js/main.js) ---

// 注册 Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

let backendMessageSyncPromise = null;
async function syncBackendMessages(force = false, allowInAppNotifications = false) {
    if (typeof isGenerating !== 'undefined' && isGenerating) return;
    if ((!force && !window.UwUBackendAdapter?.isCloudflareEnabled()) || backendMessageSyncPromise) return backendMessageSyncPromise;
    backendMessageSyncPromise = (async () => {
        try {
            const pulled = await window.UwUBackendAdapter.pullMessages(force);
            let changed = false;
            const ackIds = [];
            for (const msg of (pulled.messages || [])) {
                const target = msg.chatType === 'group'
                    ? db.groups.find(g => g.id === msg.chatId)
                    : db.characters.find(c => c.id === msg.chatId);
                if (!target) continue;
                if (!target.history) target.history = [];
                if (target.history.some(item => item.id === msg.id || item.backendJobId === msg.id)) {
                    // 内存里已经有这条（可能上次保存失败了）：这次再存一次，存成功后才确认，避免丢消息。
                    ackIds.push(msg.id); changed = true; continue;
                }
                // 这条回复正被任务轮询那边处理，交给它，不重复显示（它处理完会自己确认）。
                if (!window.UwUBackendAdapter.claimJob(msg.id)) continue;
                try {
                const beforeCount = target.history.length;
                const beforeIds = new Set(target.history.map(item => item.id));
                if (msg.role === 'assistant' && typeof handleAiReplyContent === 'function') {
                    // Parse queued output with UwU's normal CoT/action/message
                    // handling instead of inserting the raw model response.
                    let replyContent = String(msg.content || '');
                    if (db.cotSettings?.enabled && replyContent.includes('</thinking>') && !replyContent.trim().startsWith('<thinking>')) {
                        replyContent = `<thinking>${replyContent}`;
                    }
                    const previousToastSuppression = window.__uwuSuppressInAppNotifications;
                    const previousSystemSuppression = window.__uwuSuppressSystemNotifications;
                    window.__uwuSuppressInAppNotifications = !allowInAppNotifications;
                    // 这条消息是 Worker 发来的，Worker 已经为它推送过系统通知了；
                    // UwU 本地不能再弹一次，否则同一条消息会出现两组通知（标题还不一样）。
                    window.__uwuSuppressSystemNotifications = true;
                    // handleAiReplyContent 里面会保存数据；iOS 偶尔让保存失败。失败时消息其实已经在内存里了，
                    // 必须照样给它们打上后台标记，否则下一次同步会当成新消息再加一遍（表现为同一条消息发两次）。
                    let replyError = null;
                    try {
                        await handleAiReplyContent(replyContent, target, msg.chatId, msg.chatType || 'private', true);
                    } catch (error) {
                        replyError = error;
                    } finally {
                        window.__uwuSuppressInAppNotifications = previousToastSuppression;
                        window.__uwuSuppressSystemNotifications = previousSystemSuppression;
                    }
                    // 按 id 找出新增消息（而不是按位置）：处理过程中旧的思维链消息可能被清理，位置会错位。
                    const newItems = target.history.filter(item => !beforeIds.has(item.id));
                    // 本地解析会用「现在」当时间戳；改回后台生成这条消息的时间，
                    // 这样 12:00 的消息 12:10 才点开通知也仍显示 12:00。
                    window.UwUBackendAdapter.alignTimestamps(newItems, msg.timestamp);
                    for (const item of newItems) item.backendJobId = msg.id;
                    if (target.history.length === beforeCount && !replyError) {
                        target.history.push({ id: msg.id, role: 'assistant', content: msg.content || '', timestamp: msg.timestamp || Date.now(), backendJobId: msg.id });
                    }
                    // 时间改回后，聊天列表要马上刷新，不然列表还停留在「现在」的时间。
                    if (typeof renderChatList === 'function') renderChatList();
                    if (replyError) {
                        // 一条都没加进去就失败了：不能确认，抛出去让服务器保留，下次再来。
                        if (!newItems.length) throw replyError;
                        changed = true; ackIds.push(msg.id); continue;
                    }
                } else {
                    target.history.push({ id: msg.id, role: msg.role || 'assistant', content: msg.content || '', timestamp: msg.timestamp || Date.now(), backendJobId: msg.id });
                }
                changed = true;
                ackIds.push(msg.id);
                } finally {
                    window.UwUBackendAdapter.releaseJob(msg.id);
                }
            }
            if (changed) {
                await saveData();
                if (typeof renderChatList === 'function') renderChatList();
                const activeChat = (typeof currentChatType !== 'undefined' && currentChatType === 'group')
                    ? db.groups.find(g => g.id === currentChatId)
                    : db.characters.find(c => c.id === currentChatId);
                if (activeChat && typeof renderMessages === 'function') renderMessages(false, true);
            }
            // Acknowledge only after IndexedDB save succeeds. If iOS interrupts
            // the local transaction, the server retains these messages to retry.
            if (ackIds.length) await window.UwUBackendAdapter.ackMessages(ackIds);
        } catch (error) {
            console.warn('[UwUBackend] 同步后台消息失败：', error);
            // 保存失败时列表也要按内存里的最新状态刷新，时间不能停在处理消息那一刻。
            try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) {}
        }
    })().finally(() => { backendMessageSyncPromise = null; });
    return backendMessageSyncPromise;
}
window.syncBackendMessages = syncBackendMessages;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'uwu-backend-push') {
            // 回执给 Service Worker，表示页面活着并会自己处理提醒；没回执它就会弹系统通知。
            try { event.ports && event.ports[0] && event.ports[0].postMessage('ok'); } catch (e) {}
            syncBackendMessages(false, true);
        }
    });
}

const init = async () => {
    await loadData();
    if (window.UwUBackendAdapter && window.UwUBackendAdapter.isCloudflareEnabled()) {
        await syncBackendMessages();
    }
    if (typeof ensureAllChatArchives === 'function') {
        const archivesMigrated = ensureAllChatArchives();
        if (archivesMigrated) await saveData();
    }
    if (!db.homeWidgetSettings || !db.homeWidgetSettings.topLeft) {
        db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
    }

    // 全局点击事件委托
    document.body.addEventListener('click', (e) => {
        // 全局点击触感反馈
        // if (e.target.closest('button, .btn, .action-btn, .nav-item, .icon-btn, .list-item, input[type="checkbox"], input[type="radio"], .back-btn')) {
        //     triggerHapticFeedback('light');
        // }

        if (e.target.closest('.context-menu')) {
            e.stopPropagation();
            return;
        }
        removeContextMenu();

        const backBtn = e.target.closest('.back-btn');
        if (backBtn) {
            const target = backBtn.getAttribute('data-target');
            if (target) {
                e.preventDefault();
                switchScreen(target);
            }
        }

        const openOverlay = document.querySelector('.modal-overlay.visible, .action-sheet-overlay.visible');
        if (openOverlay && e.target === openOverlay) {
            openOverlay.classList.remove('visible');
        }
    });

    // 导航栏跳转
    document.body.addEventListener('click', e => {
        const navLink = e.target.closest('.app-icon[data-target]');
        if (navLink) {
            e.preventDefault();
            const target = navLink.getAttribute('data-target');
            if (target === 'music-screen' || target === 'diary-screen' || target === 'piggy-bank-screen') {
                showToast('该应用正在开发中，敬请期待！');
                return;
            }
            switchScreen(target);
        }
    });

    // 定时任务
    updateClock();
    setInterval(updateClock, 30000);
    setInterval(checkAutoReply, 60000);
    
    // 检查备份提醒
    setTimeout(checkBackupReminder, 5000); // 启动后延迟5秒检查
    setInterval(checkBackupReminder, 3600000); // 每小时检查一次

    // 应用全局设置
    await loadAllCustomFonts();
    
    if (db.fontUrl && db.fontUrl.startsWith('CustomFont_')) {
        applyGlobalFont(db.fontUrl, true);
    } else {
        applyGlobalFont(db.fontUrl, false);
    }
    
    applyGlobalCss(db.globalCss);
    applyFontSize(db.fontSizeScale || 1.0);
    if (typeof applyThemeSettings === 'function') applyThemeSettings();

    // 初始化各个模块
    setupGlobalRescueGesture(); // 全局救援手势
    setupHomeScreen();
    if (typeof renderConsoleLogs === 'function') renderConsoleLogs();
    setupChatListScreen();
    setupContactsScreen();
    setupBottomNavigation();
    setupAddCharModal();
    if (typeof setupStUnlock === 'function') setupStUnlock();
    if (typeof injectChatRoomHtml === 'function') injectChatRoomHtml();
    setupChatRoom();
    if (typeof setupAirDropPanelBtn === 'function') setupAirDropPanelBtn();
    if (typeof injectChatSettingsHtml === 'function') injectChatSettingsHtml();
    if (typeof injectGroupSettingsHtml === 'function') injectGroupSettingsHtml();
    setupChatSettings();
    if (typeof setupChatArchiveSystem === 'function') setupChatArchiveSystem();
    setupApiSettingsApp();
    setupWallpaperApp();
    await setupStickerSystem();
    setupPresetFeatures();
    setupVoiceMessageSystem();
    setupPhotoVideoSystem();
    setupImageRecognition();
    setupWalletSystem();
    setupGiftSystem();
    setupTimeSkipSystem();
    setupPatSystem();
    setupVoteSystem();
    setupQuestionnaireSystem();
    setupGalleryManagement();
    try { setupCommunityModule(); } catch(e) { console.error("setupCommunityModule failed:", e); }
    
    // 错误处理包裹的模块初始化
    try { setupWorldBookApp(); } catch(e) { console.error("setupWorldBookApp failed:", e); }
    try { setupGroupChatSystem(); } catch(e) { console.error("setupGroupChatSystem failed:", e); }
    try { setupCustomizeApp(); } catch(e) { console.error("setupCustomizeApp failed:", e); }
    try { setupTutorialApp(); } catch(e) { console.error("setupTutorialApp failed:", e); }
    
    try { checkForUpdates(); } catch(e) { console.error("checkForUpdates failed:", e); }
    try { setupPeekFeature(); } catch(e) { console.error("setupPeekFeature failed:", e); }
    try { setupMemoryJournalScreen(); } catch(e) { console.error("setupMemoryJournalScreen failed:", e); }
    try { setupDeleteHistoryChunk(); } catch(e) { console.error("setupDeleteHistoryChunk failed:", e); }
    try { setupStorageAnalysisScreen(); } catch(e) { console.error("setupStorageAnalysisScreen failed:", e); }
    try { setupCleanImageCache(); } catch(e) { console.error("setupCleanImageCache failed:", e); }
    try { setupInsWidgetAvatarModal(); } catch(e) { console.error("setupInsWidgetAvatarModal failed:", e); }
    try { setupHeartPhotoModal(); } catch(e) { console.error("setupHeartPhotoModal failed:", e); }
    try { setupMoreCardBgModal(); } catch(e) { console.error("setupMoreCardBgModal failed:", e); }
    if (typeof setupShopSystem === 'function') { try { setupShopSystem(); } catch(e) { console.error("setupShopSystem failed:", e); } }
    if (window.BatteryInteraction) { try { window.BatteryInteraction.init(); } catch(e) { console.error("BatteryInteraction failed:", e); } }
    if (typeof initMoreMenu === 'function') { try { initMoreMenu(); } catch(e) { console.error("initMoreMenu failed:", e); } }
    if (typeof setupPhoneScreen === 'function') { try { setupPhoneScreen(); } catch(e) { console.error("setupPhoneScreen failed:", e); } }
    if (typeof initCotSettings === 'function') { try { initCotSettings(); } catch(e) { console.error("initCotSettings failed:", e); } }
    if (window.VideoCallModule) { try { window.VideoCallModule.init(); } catch(e) { console.error("VideoCallModule failed:", e); } }
    if (typeof initDrawingWorkshop === 'function') { try { initDrawingWorkshop(); } catch(e) { console.error("initDrawingWorkshop failed:", e); } }

    // 全局事件绑定
    const delWBBtn = document.getElementById('delete-selected-world-books-btn');
    if(delWBBtn) delWBBtn.addEventListener('click', deleteSelectedWorldBooks);
    
    const cancelWBBtn = document.getElementById('cancel-wb-multi-select-btn');
    if(cancelWBBtn) cancelWBBtn.addEventListener('click', exitWorldBookMultiSelectMode);
    
    if(window.GitHubMgr) {
        window.GitHubMgr.init();
    }

    // 自动尝试拉取模型列表
    if (window.fetchAndPopulateModels && db.apiSettings && db.apiSettings.url && db.apiSettings.key) {
        // 稍微延迟一点，确保 API 设置 DOM 已加载
        setTimeout(() => {
            window.fetchAndPopulateModels(true);
        }, 1000);
    }

    // 检查并请求持久化存储 (抗系统清理)
    if (typeof checkAndRequestPersistence === 'function') {
        setTimeout(checkAndRequestPersistence, 2000); // 延迟一点，避免与初始化逻辑冲突
    }
};

async function checkBackupReminder() {
    if (!db.backupReminderSettings || !db.backupReminderSettings.enabled) return;

    const now = Date.now();
    const lastTime = db.backupReminderSettings.lastReminderTime || 0;
    const intervalDays = db.backupReminderSettings.interval || 3;
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;

    if (now - lastTime > intervalMs) {
        // 延迟一点弹出，避免刚进应用太突兀
        if (confirm(`【备份提醒】\n检测到您已有 ${intervalDays} 天未进行手动备份，是否立即下载备份文件以防数据丢失？`)) {
            if (window.triggerManualBackup) {
                await window.triggerManualBackup();
            }
        } else {
            // 用户点否，也更新时间，进入下一个周期
            db.backupReminderSettings.lastReminderTime = now;
            await saveData();
        }
    }
}

async function checkAutoReply() {
    // 开启 Cloudflare 后台时，主动消息统一由云端 Worker 发送；
    // UwU 本地不再重复触发，否则同一个时间点会收到两条主动消息。
    if (window.UwUBackendAdapter?.isCloudflareEnabled?.()) return;
    const now = Date.now();
    for (const char of db.characters) {
        if (char.autoReply && char.autoReply.enabled) {
            // 安静时段内不主动发消息
            if (window.UwUBackendAdapter?.isQuietNow?.(char.autoReply.quietHours, now)) continue;
            const intervalMs = (char.autoReply.interval || 60) * 60 * 1000;
            const lastTriggerTime = char.autoReply.lastTriggerTime || 0;
            
            // 检查上次触发时间
            if (now - lastTriggerTime < intervalMs) continue;

            let lastMsgTime = 0;
            if (char.history && char.history.length > 0) {
                lastMsgTime = char.history[char.history.length - 1].timestamp;
            } else {
                // 如果没有历史记录，暂不触发，或者可以设置为创建时间
                continue;
            }

            // 检查无操作时间 (最后一条消息到现在的时间)
            if (now - lastMsgTime > intervalMs) {
                console.log(`Auto-reply triggered for ${char.remarkName}`);
                char.autoReply.lastTriggerTime = now;
                await saveData(); // 先保存触发时间，防止重复触发
                await getAiReply(char.id, 'private', true);
            }
        }
    }
}

// === 主入口 ===
document.addEventListener('DOMContentLoaded', () => {
    initDatabase();
    init().then(() => {
        const launchUrl = new URL(location.href);
        if (launchUrl.searchParams.get('backendNotification') === '1') {
            // 只有开启 Cloudflare 后台时才去拉取后台消息；未开启时只打开聊天室。
            // 用 Promise.resolve 包一层：syncBackendMessages 在某些情况下会返回 undefined。
            const backendOn = !!window.UwUBackendAdapter?.isCloudflareEnabled?.();
            Promise.resolve(backendOn ? syncBackendMessages(true) : null).finally(() => {
                const chatId = launchUrl.searchParams.get('chatId');
                const chatType = launchUrl.searchParams.get('chatType') || 'private';
                if (chatId && typeof openChatRoom === 'function') openChatRoom(chatId, chatType);
                launchUrl.searchParams.delete('backendNotification');
                history.replaceState({}, '', launchUrl.href);
            });
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') syncBackendMessages();
        });
        window.addEventListener('pageshow', () => syncBackendMessages());
        if (window.KeepAliveManager) {
            // 音频保活仍按原设置运行；Cloudflare 模式不会强制启动音频。
            window.KeepAliveManager.init(Boolean(db.apiSettings && db.apiSettings.keepAliveEnabled));
        }
        if (window.UwUBackendAdapter) {
            window.UwUBackendAdapter.init();
        }
    });
});

// === 全局救援手势 / 快速 API 手势 ===
let globalRescueClickCount = 0;
let globalRescueLastClickTime = 0;
let quickApiClickCount = 0;
let quickApiLastClickTime = 0;

function setupGlobalRescueGesture() {
    const CLICK_TIMEOUT = 400;
    document.addEventListener('click', () => {
        const now = Date.now();
        if (now - quickApiLastClickTime < CLICK_TIMEOUT) quickApiClickCount++; else quickApiClickCount = 1;
        quickApiLastClickTime = now;
        if (quickApiClickCount === 3) {
            if (typeof window.isQuickApiSettingsEnabled === 'function' && window.isQuickApiSettingsEnabled()) {
                console.log('[GlobalGesture] Triggering quick API panel!');
                if (typeof window.openQuickApiSettingsPanel === 'function') window.openQuickApiSettingsPanel();
            }
            quickApiClickCount = 0;
        }
        if (now - globalRescueLastClickTime < CLICK_TIMEOUT) globalRescueClickCount++; else globalRescueClickCount = 1;
        globalRescueLastClickTime = now;
        if (globalRescueClickCount === 5) {
            console.log('[GlobalGesture] Triggering rescue panel!');
            showGlobalRescuePanel();
            globalRescueClickCount = 0;
        }
    }, true);
}

function showGlobalRescuePanel() {
    // 防止重复创建
    if (document.getElementById('global-rescue-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'global-rescue-panel';
    panel.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 999999;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
    `;

    panel.innerHTML = `
        <div style="background: #fff; width: 85%; max-width: 320px; border-radius: 16px; padding: 25px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
            <div style="width: 60px; height: 60px; background: #ffebee; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
                <svg style="width: 32px; height: 32px; color: #d32f2f;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </div>
            <h3 style="margin: 0 0 10px; color: #333; font-size: 18px;">全局样式救援</h3>
            <p style="margin: 0 0 20px; color: #666; font-size: 14px; line-height: 1.5;">
                检测到您快速点击了五次屏幕。<br>
                如果因为错误的全局 CSS 导致界面错乱，您可以在这里一键清空。
            </p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="rescue-clear-btn" style="background: #d32f2f; color: #fff; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">清空全局 CSS</button>
                <button id="rescue-cancel-btn" style="background: #f5f5f5; color: #666; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    document.getElementById('rescue-clear-btn').onclick = async () => {
        if (confirm('确定要清空全局 CSS 吗？此操作不可撤销。')) {
            db.globalCss = '';
            await saveData();
            applyGlobalCss('');
            // 更新设置页面的文本框（如果存在）
            const textarea = document.getElementById('global-beautification-css');
            if (textarea) textarea.value = '';
            
            showToast('全局 CSS 已清空，界面应已恢复正常。');
            panel.remove();
        }
    };

    document.getElementById('rescue-cancel-btn').onclick = () => {
        panel.remove();
    };
}
