// --- 系统级通知 ---
// 使用浏览器原生 Notification API，在后台/非当前聊天收到新消息时显示系统通知。
(function () {
    'use strict';

    const TEST_TITLE = 'UwU 系统通知测试';
    const TEST_BODY = '如果你能看到这条弹窗，说明当前浏览器可以正常使用系统级通知。';
    let lastNotifiedMessageId = '';

    function isSupported() {
        return typeof window !== 'undefined' && 'Notification' in window;
    }

    async function requestPermission() {
        if (!isSupported()) return 'unsupported';
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        try {
            return await Notification.requestPermission();
        } catch (error) {
            console.warn('[SystemNotification] requestPermission failed:', error);
            return 'denied';
        }
    }

    function cleanMessageContent(content, message, chatId, chatType) {
        let text = String(content == null ? '' : content);

        // 先按聊天气泡实际显示逻辑，剥掉“某某的消息：……”这层包装。
        // 如果先跑状态栏正则，某些状态栏正则会把整条原始消息一起匹配掉，
        // 最后只剩“收到一条新消息”的兜底文字。
        const wrappedMatch = text.match(/^\[[^\]]*?(?:的消息|的语音|发送的表情包|发来的照片\/视频)[：:]([\s\S]*?)\]$/);
        if (wrappedMatch && wrappedMatch[1]) {
            text = wrappedMatch[1].trim();
        } else {
            const privateWrappedMatch = text.match(/^\[[^\]]*?的消息[：:]([\s\S]*)\]$/);
            if (privateWrappedMatch && privateWrappedMatch[1]) {
                text = privateWrappedMatch[1].trim();
            }
        }

        // 状态栏内容只用于更新状态栏，不应出现在系统通知正文里。
        // 顺序与聊天渲染保持一致：先取真正显示的消息文本，再移除状态栏片段。
        let statusRegexSource = '';
        let statusRegexFlags = 'gs';
        if (message && message.statusSnapshot && message.statusSnapshot.regex) {
            statusRegexSource = message.statusSnapshot.regex;
        } else if (chatType === 'private' && chatId && typeof db !== 'undefined' && Array.isArray(db.characters)) {
            const char = db.characters.find(item => item.id === chatId);
            if (char && char.statusPanel && char.statusPanel.enabled && char.statusPanel.regexPattern) {
                statusRegexSource = char.statusPanel.regexPattern;
            }
        }

        if (statusRegexSource) {
            try {
                const matchParts = statusRegexSource.match(/^\/(.*?)\/([a-z]*)$/);
                if (matchParts) {
                    statusRegexSource = matchParts[1];
                    statusRegexFlags = matchParts[2] || 'gs';
                    if (!statusRegexFlags.includes('g')) statusRegexFlags += 'g';
                    if (!statusRegexFlags.includes('s')) statusRegexFlags += 's';
                } else {
                    statusRegexFlags = 'gs';
                }
                text = text.replace(new RegExp(statusRegexSource, statusRegexFlags), '').trim();
            } catch (error) {
                console.warn('[SystemNotification] status regex clean failed:', error);
            }
        }

        text = text
            .replace(/<[^>]*>/g, ' ')
            .replace(/\[([^^\]]*?)的消息[：:]([\s\S]*?)\]/g, '$2')
            .replace(/^\[(?:Private|Private-End):[\s\S]*?\]$/i, '')
            .replace(/\[发送时间:.*?\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) text = '收到一条新消息';
        return text.length > 180 ? `${text.slice(0, 177)}…` : text;
    }

    function syncTestButtonVisibility(enabled) {
        const testItem = document.getElementById('system-notification-test-item');
        if (testItem) testItem.style.display = enabled ? '' : 'none';
    }

    function getSenderName(message, chat, chatType) {
        if (chatType === 'private') {
            return (chat && (chat.realName || chat.name)) || '新消息';
        }

        if (chat && Array.isArray(chat.members) && message && message.senderId) {
            const sender = chat.members.find(member => member.id === message.senderId);
            if (sender) return sender.groupNickname || sender.realName || '新消息';
        }

        const match = String(message && message.content || '').match(/^\[(.*?)的(?:消息|语音|表情包|照片\/视频)[：:]/);
        return match && match[1] ? match[1] : ((chat && (chat.name || chat.groupName)) || '新消息');
    }

    function getAvatar(message, chat, chatType) {
        if (chatType === 'private' && chat) return chat.avatar || chat.avatarUrl || '';
        if (chatType === 'group' && chat && Array.isArray(chat.members) && message && message.senderId) {
            const sender = chat.members.find(member => member.id === message.senderId);
            return sender && (sender.avatar || sender.avatarUrl) || chat.avatar || chat.avatarUrl || '';
        }
        return chat && (chat.avatar || chat.avatarUrl) || '';
    }

    function isPageForeground() {
        return !document.hidden && document.visibilityState === 'visible';
    }

    function shouldNotify(chatId, chatType) {
        // System notifications are for background delivery only. Foreground
        // messages are handled by UwU's in-app UI, regardless of backend mode.
        return !isPageForeground();
    }

    function createNotification(title, body, options) {
        if (isPageForeground() && !(options && options.allowForeground)) return null;
        if (!isSupported() || Notification.permission !== 'granted') return null;
        try {
            const notification = new Notification(title, {
                body,
                icon: options && options.icon ? options.icon : undefined,
                tag: options && options.tag ? options.tag : `uwu-message-${Date.now()}`,
                renotify: true,
                silent: false
            });
            if (options && typeof options.onClick === 'function') {
                notification.onclick = options.onClick;
            }
            return notification;
        } catch (error) {
            console.warn('[SystemNotification] create notification failed:', error);
            return null;
        }
    }

    async function test() {
        if (!isSupported()) {
            if (typeof showToast === 'function') showToast('当前浏览器不支持系统级通知');
            return false;
        }

        const permission = await requestPermission();
        if (permission !== 'granted') {
            if (permission === 'denied') {
                showToast('系统通知权限被拒绝，请到浏览器的网站权限中允许通知');
            } else {
                showToast('尚未获得系统通知权限');
            }
            return false;
        }

        try {
            // Mobile Chrome may expose Notification.permission but reject the
            // page-level `new Notification()` constructor. Persistent
            // notifications through the active Service Worker work in PWAs.
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                if (typeof registration.showNotification === 'function') {
                    await registration.showNotification(TEST_TITLE, {
                        body: TEST_BODY,
                        tag: 'uwu-system-notification-test',
                        renotify: false,
                        data: { url: location.href }
                    });
                    showToast('测试通知已发送，请查看系统弹窗');
                    return true;
                }
            }

            // Fallback for browsers that support only non-persistent page notifications.
            const notification = createNotification(TEST_TITLE, TEST_BODY, {
                tag: 'uwu-system-notification-test',
                allowForeground: true
            });
            if (!notification) throw new Error('当前浏览器未提供可用的通知显示 API');
            showToast('测试通知已发送，请查看系统弹窗');
            return true;
        } catch (error) {
            console.warn('[SystemNotification] test notification failed:', error);
            showToast(`系统通知创建失败：${error.message || error}`);
            return false;
        }
    }

    async function enableFromUserAction() {
        if (!isSupported()) {
            showToast('当前浏览器不支持系统级通知');
            return false;
        }
        const permission = await requestPermission();
        if (permission !== 'granted') {
            showToast(permission === 'denied'
                ? '系统通知权限被拒绝，请到浏览器的网站权限中允许通知'
                : '未获得系统通知权限');
            return false;
        }
        return true;
    }

    function notifyIncomingMessage(message, chat, chatId, chatType) {
        if (window.__uwuSuppressSystemNotifications) return;
        if (!db.apiSettings || !db.apiSettings.systemNotificationEnabled) return;
        if (!message || message.role !== 'assistant' || message.isThinking) return;
        // Group parsing can represent the user's own message with role=assistant;
        // never alert for messages explicitly attributed to the local user.
        if (message.senderId === 'user_me') return;
        // 状态栏更新是给状态栏本身使用的，不属于聊天消息，因此绝对不发送系统通知。
        // 这样最后一条状态栏内容不会再变成“收到一条新消息”的通知。
        if (message.isStatusUpdate || message.statusSnapshot || /更新状态(?:为)?|状态更新|状态栏|状态面板|<\/?thinking>/i.test(String(message.originalContent || message.content || ''))) return;
        if (!shouldNotify(chatId, chatType)) return;
        if (message.id && message.id === lastNotifiedMessageId) return;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

        const messageId = message.id || `${chatId}-${message.timestamp || Date.now()}`;
        lastNotifiedMessageId = messageId;

        const title = getSenderName(message, chat, chatType);
        const body = cleanMessageContent(message.originalContent || message.content, message, chatId, chatType);
        const icon = getAvatar(message, chat, chatType);
        const notification = createNotification(title, body, {
            icon,
            tag: `uwu-chat-${chatType}-${chatId}`,
            onClick: function () {
                try {
                    window.focus();
                    if (typeof openChatRoom === 'function') openChatRoom(chatId, chatType);
                    this.close();
                } catch (error) {
                    console.warn('[SystemNotification] notification click failed:', error);
                }
            }
        });

        if (!notification) lastNotifiedMessageId = '';
    }

    function init() {
        const toggle = document.getElementById('system-notification-switch');
        const testButton = document.getElementById('test-system-notification-btn');
        if (!toggle || !testButton || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';

        toggle.checked = !!(db.apiSettings && db.apiSettings.systemNotificationEnabled);
        syncTestButtonVisibility(toggle.checked);

        toggle.addEventListener('change', async event => {
            const enabled = event.target.checked;
            if (enabled) {
                const granted = await enableFromUserAction();
                if (!granted) {
                    event.target.checked = false;
                    db.apiSettings = db.apiSettings || {};
                    db.apiSettings.systemNotificationEnabled = false;
                    await saveData();
                    return;
                }
            }

            db.apiSettings = db.apiSettings || {};
            db.apiSettings.systemNotificationEnabled = enabled;
            syncTestButtonVisibility(enabled);
            await saveData();
            showToast(enabled ? '系统级通知已开启' : '系统级通知已关闭');
        });

        testButton.addEventListener('click', test);
    }

    window.SystemNotificationManager = {
        init,
        test,
        requestPermission,
        notifyIncomingMessage,
        isSupported
    };
})();
