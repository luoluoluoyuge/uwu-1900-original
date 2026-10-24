// --- UwU 后台服务适配层 ---
// 负责把「音频保活」与「Cloudflare/Web Push 后台模式」解耦。
// 默认仍使用原来的音频保活，不会自动改变现有用户行为。
(function () {
    const USER_ID_KEY = 'uwu_backend_user_id';

    function getSettings() {
        if (!db.apiSettings) db.apiSettings = {};
        return db.apiSettings;
    }

    function getMode() {
        return getSettings().backendMode || 'audio';
    }

    function getBaseUrl() {
        return String(getSettings().backendUrl || '').trim().replace(/\/$/, '');
    }

    function getToken() {
        return String(getSettings().backendToken || '').trim();
    }

    function getUserId() {
        const settings = getSettings();
        if (settings.backendUserId) return settings.backendUserId;
        try {
            let id = localStorage.getItem(USER_ID_KEY);
            if (!id) {
                id = `uwu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
                localStorage.setItem(USER_ID_KEY, id);
            }
            settings.backendUserId = id;
            return id;
        } catch (error) {
            const id = `uwu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            settings.backendUserId = id;
            return id;
        }
    }

    function getAISettings() {
        const settings = getSettings();
        return {
            provider: String(settings.provider || 'newapi'),
            url: String(settings.url || '').trim(),
            key: String(settings.key || '').trim(),
            model: String(settings.model || '').trim()
        };
    }

    function isCloudflareEnabled() {
        return getMode() === 'cloudflare' && !!getBaseUrl();
    }

    async function request(path, options = {}) {
        const baseUrl = getBaseUrl();
        if (!baseUrl) throw new Error('尚未填写后台服务地址');
        const token = getToken();
        if (!token) throw new Error('后台访问 Token 为必填项；请在 Cloudflare 设置 BACKEND_TOKEN，并在此填写相同的值');
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        headers.Authorization = `Bearer ${token}`;
        const targetUrl = `${baseUrl}${path}`;
        let response;
        try {
            response = await fetch(targetUrl, {
                ...options,
                headers,
                body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
            });
        } catch (error) {
            const name = error && error.name ? String(error.name) : 'Error';
            const message = error && error.message ? String(error.message) : String(error || '未知网络错误');
            const diagnostic = new Error(`后台请求失败 [${name}] ${message}（${targetUrl}）`);
            diagnostic.name = name;
            diagnostic.cause = error;
            throw diagnostic;
        }
        if (!response.ok) {
            let detail = '';
            try {
                detail = await response.text();
            } catch (error) {
                detail = '无法读取服务器错误内容';
            }
            throw new Error(`后台服务 ${response.status}: ${detail || response.statusText || '服务器返回错误'}`);
        }
        return response;
    }

    async function testConnection() {
        const response = await request('/v1/health', { method: 'GET' });
        const data = await response.json();
        return data;
    }

    // 主动消息运行状态（下次时间、上次成功、最近失败原因），用来排查「为什么没收到」。
    async function getStatus() {
        const response = await request(`/v1/status?userId=${encodeURIComponent(getUserId())}`, { method: 'GET' });
        return response.json();
    }

    async function testPushNotification() {
        const response = await request('/v1/push/test', {
            method: 'POST',
            // Push subscriptions are stored per backendUserId (Durable Object).
            // Include the same ID used by /v1/push/register, or the Worker will
            // route this test to the default user's empty subscription list.
            body: { userId: getUserId(), title: 'UwU 后台通知测试', body: '如果你看到这条系统通知，后台 Push 已送达。', url: location.origin }
        });
        return response.json();
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
    }

    async function registerPush(userInitiated = false) {
        if (!isCloudflareEnabled()) throw new Error('请先选择 Cloudflare 后台模式并填写服务地址');
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            throw new Error('当前浏览器不支持 Web Push；iPhone 请先把 UwU 添加到主屏幕。');
        }
        if (!('Notification' in window)) throw new Error('当前浏览器不支持系统通知');
        if (Notification.permission !== 'granted') {
            if (!userInitiated) throw new Error('需要点击“注册后台通知”后授权通知');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('系统通知权限未开启');
        }

        const configResponse = await request('/v1/push/config', { method: 'GET' });
        const config = await configResponse.json();
        if (!config.publicKey) throw new Error('后台服务没有提供 VAPID 公钥');

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const expectedApplicationServerKey = urlBase64ToUint8Array(config.publicKey);

        // A browser may keep a subscription created with an older VAPID key.
        // Apple Push returns HTTP 400 (VapidPkHashMismatch) for that case.
        // Rotate the local subscription when its stored applicationServerKey
        // does not match the key currently configured on the Worker.
        if (subscription) {
            const currentKey = subscription.options?.applicationServerKey;
            const currentBytes = currentKey ? new Uint8Array(currentKey) : null;
            const keysMatch = currentBytes &&
                currentBytes.length === expectedApplicationServerKey.length &&
                currentBytes.every((byte, index) => byte === expectedApplicationServerKey[index]);
            if (!keysMatch) {
                await subscription.unsubscribe();
                subscription = null;
            }
        }

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: expectedApplicationServerKey
            });
        }

        await request('/v1/push/register', {
            method: 'POST',
            body: {
                userId: getUserId(),
                subscription: subscription.toJSON(),
                appUrl: location.origin,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            }
        });

        getSettings().backendPushEnabled = true;
        await saveData();
        return subscription;
    }

    async function syncAISettings() {
        if (!isCloudflareEnabled()) return { skipped: true };
        const ai = getAISettings();
        if (!ai.url || !ai.key || !ai.model) throw new Error('请先在 UwU 中完整设置 AI API 地址、密钥和模型');
        // 自动消息使用副 API 时，把副 API 一起同步给 Worker；否则传 null，让 Worker 改回用主 API。
        const sec = getSettings().secondary;
        const useSecondary = !!(sec && sec.enabled && sec.routes && sec.routes.autoMessage && sec.url && sec.key && sec.model);
        const proactiveAiConfig = useSecondary
            ? { provider: String(sec.provider || 'newapi'), url: String(sec.url).trim(), key: String(sec.key).trim(), model: String(sec.model).trim() }
            : null;
        return (await request('/v1/ai/config', {
            method: 'POST',
            body: { userId: getUserId(), aiConfig: ai, proactiveAiConfig }
        })).json();
    }

    async function syncChatState(payload) {
        if (!isCloudflareEnabled()) return { skipped: true };
        return (await request('/v1/sync', {
            method: 'POST',
            body: {
                userId: getUserId(),
                aiConfig: getAISettings(),
                ...payload
            }
        })).json();
    }

    // 安静时段：判断 now 是否落在 [start, end) 内（按指定时区，空=设备时区；start>end 表示跨天）。
    function toMinutes(text, fallback) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
        return m ? (Number(m[1]) * 60 + Number(m[2])) : fallback;
    }
    function deviceTimeZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
    }
    function isQuietNow(qh, now) {
        if (!qh || !qh.enabled) return false;
        const start = toMinutes(qh.start, 0);
        const end = toMinutes(qh.end, 480);
        if (start === end) return false;
        let minutes;
        try {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: qh.timezone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(new Date(now || Date.now()));
            const h = Number(parts.find(p => p.type === 'hour').value);
            const mi = Number(parts.find(p => p.type === 'minute').value);
            minutes = h * 60 + mi;
        } catch (e) {
            const d = new Date(now || Date.now());
            minutes = d.getHours() * 60 + d.getMinutes();
        }
        return start < end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end);
    }

    // 某个私聊的自动回复设置（开关、间隔）同步到 Worker 用的内容。
    function autoReplyPayload(chat) {
        const ar = chat.autoReply || {};
        return {
            chatId: chat.id,
            chatType: 'private',
            realName: chat.realName || '',
            remarkName: chat.remarkName || chat.realName || '',
            chatStatusRegex: chat.statusPanel?.enabled ? (chat.statusPanel.regexPattern || '') : '',
            myName: chat.myName || '用户',
            autoReply: {
                enabled: !!ar.enabled,
                interval: Number(ar.interval || 60),
                lastTriggerTime: Number(ar.lastTriggerTime || 0),
                quietHours: ar.quietHours && ar.quietHours.enabled ? {
                    enabled: true,
                    start: ar.quietHours.start || '00:00',
                    end: ar.quietHours.end || '08:00',
                    timezone: ar.quietHours.timezone || deviceTimeZone()
                } : { enabled: false }
            }
        };
    }

    // 修改自动回复设置后立刻同步，避免 Worker 还按旧设置继续发主动消息。
    // 失败时在聊天上打标记，下次启动自动重试。
    async function syncAutoReplySettings(chat) {
        if (!isCloudflareEnabled() || !chat) return { skipped: true };
        try {
            const result = await syncChatState(autoReplyPayload(chat));
            if (chat.autoReplySyncPending) {
                delete chat.autoReplySyncPending;
                await saveData();
            }
            return result;
        } catch (error) {
            chat.autoReplySyncPending = true;
            await saveData();
            throw error;
        }
    }

    // 聊天被删除后，通知 Worker 停止这个聊天的主动消息。失败时记下来，下次启动重试。
    async function stopDeletedChat(chat) {
        if (!isCloudflareEnabled() || !chat) return { skipped: true };
        const info = {
            id: chat.id,
            realName: chat.realName || '',
            remarkName: chat.remarkName || '',
            myName: chat.myName || '用户'
        };
        try {
            return await syncChatState({
                chatId: info.id, chatType: 'private', realName: info.realName,
                remarkName: info.remarkName, myName: info.myName, autoReply: { enabled: false }
            });
        } catch (error) {
            const settings = getSettings();
            settings.backendPendingChatStops = (settings.backendPendingChatStops || [])
                .filter(item => item.id !== info.id).concat(info);
            await saveData();
            throw error;
        }
    }

    // 启动时补发之前没同步成功的自动回复设置 / 已删除聊天的停止指令。
    async function flushPendingChatSync() {
        for (const chat of (db.characters || [])) {
            if (!chat.autoReplySyncPending) continue;
            try { await syncAutoReplySettings(chat); }
            catch (error) { console.warn('[UwUBackend] 补发自动回复设置失败，下次启动再试:', error); }
        }
        const settings = getSettings();
        const stops = Array.isArray(settings.backendPendingChatStops) ? settings.backendPendingChatStops : [];
        if (!stops.length) return;
        const remaining = [];
        for (const info of stops) {
            try {
                await syncChatState({
                    chatId: info.id, chatType: 'private', realName: info.realName,
                    remarkName: info.remarkName, myName: info.myName, autoReply: { enabled: false }
                });
            } catch (error) {
                remaining.push(info);
            }
        }
        settings.backendPendingChatStops = remaining;
        await saveData();
    }

    async function pullMessages(force = false) {
        if (!force && !isCloudflareEnabled()) return { messages: [] };
        return (await request(`/v1/messages/pull?userId=${encodeURIComponent(getUserId())}`, { method: 'GET' })).json();
    }

    async function ackMessages(ids) {
        if (!isCloudflareEnabled() || !Array.isArray(ids) || !ids.length) return { skipped: true };
        return (await request('/v1/messages/ack', {
            method: 'POST', body: { userId: getUserId(), ids }
        })).json();
    }

    async function syncProactiveSettings(chats) {
        if (!isCloudflareEnabled()) return { skipped: true };
        return (await request('/v1/proactive/sync', {
            method: 'POST',
            body: {
                userId: getUserId(),
                chats
            }
        })).json();
    }

    // 本地解析后台回复时，消息时间戳会是「现在」；这里把这一批新消息整体平移到
    // 后台实际生成它们的时间，保持先后顺序。返回平移的毫秒数（0 表示没有改动）。
    function alignTimestamps(items, serverTimestamp) {
        const serverTs = Math.min(Number(serverTimestamp), Date.now());
        if (!Array.isArray(items) || !items.length || !Number.isFinite(serverTs) || serverTs <= 0) return 0;
        // 以这批消息里最早的时间为基准整体平移，保持它们之间的先后间隔。
        const stamps = items.map(item => Number(item.timestamp)).filter(Number.isFinite);
        if (!stamps.length) return 0;
        const firstTs = Math.min(...stamps);
        const shift = serverTs - firstTs;
        if (!shift) return 0;
        for (const item of items) {
            const ts = Number(item.timestamp);
            if (Number.isFinite(ts)) item.timestamp = ts + shift;
        }
        return shift;
    }

    // 通知 Worker 停止所有主动消息排程。即使本机已切到「关闭」也可使用，
    // 这样可以清掉之前遗留在雲端的排程。
    async function disableRemote(userId) {
        if (!getBaseUrl() || !getToken()) return { skipped: true };
        return (await request('/v1/backend/disable', {
            method: 'POST',
            body: { userId: userId || getUserId() }
        })).json();
    }

    async function stopBackendTasks() {
        return disableRemote();
    }

    // 把「Cloudflare 后台是否开启」写进 Cache Storage，Service Worker 收到推送时据此判断。
    // 关闭时一并存下 Worker 地址，让 SW 在收到遗留推送时可以自己通知 Worker 停止。
    const FLAG_CACHE = 'uwu-backend-flag';
    const FLAG_URL = '/__uwu_backend_state';
    async function publishState() {
        try {
            if (!('caches' in window)) return;
            const settings = getSettings();
            const payload = isCloudflareEnabled()
                ? { enabled: true }
                : { enabled: false, url: getBaseUrl(), token: getToken(), userId: settings.backendUserId || '' };
            const cache = await caches.open(FLAG_CACHE);
            await cache.put(FLAG_URL, new Response(JSON.stringify(payload), {
                headers: { 'Content-Type': 'application/json' }
            }));
        } catch (error) {
            console.warn('[UwUBackend] 写入后台状态标记失败:', error);
        }
    }

    // 本机是关闭状态、但雲端还没确认停止时（例如关闭当下没网络、清除数据、还原备份），
    // 启动时补发一次停止指令。确认成功后不再重复。
    async function reconcileRemote() {
        if (isCloudflareEnabled()) return;
        const settings = getSettings();
        if (settings.backendStopConfirmed === true) return;
        if (!getBaseUrl() || !getToken()) return;
        let userId = settings.backendUserId || '';
        if (!userId) {
            try { userId = localStorage.getItem(USER_ID_KEY) || ''; } catch (error) { userId = ''; }
        }
        if (!userId) return;
        try {
            await disableRemote(userId);
            settings.backendStopConfirmed = true;
            await saveData();
        } catch (error) {
            console.warn('[UwUBackend] 补发停止后台排程失败，下次启动再试:', error);
        }
    }

    // 用户点「停止」后通知 Worker 取消任务，否则 Worker 仍会完成并把回复推送/补发回来。
    // 失败会重试几次；请求还没送达时 Worker 会留下“已取消”标记，任务之后到达也会被丢弃。
    async function cancelAIJob(jobId) {
        if (!jobId || !isCloudflareEnabled()) return;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                await request(`/v1/ai/jobs/${encodeURIComponent(jobId)}?action=cancel`, {
                    method: 'POST', body: { userId: getUserId() }, keepalive: true
                });
                return;
            } catch (error) {
                console.warn('[UwUBackend] 取消后台任务失败，稍后重试：', error);
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    async function fetchAI(options) {
        const jobId = `uwu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        try {
            return await fetchAIJob({ ...options, jobId });
        } catch (error) {
            if (error?.name === 'AbortError' || options?.signal?.aborted) cancelAIJob(jobId);
            throw error;
        }
    }

    async function fetchAIJob({ requestBody, chatId, chatType, chatName, chatStatusRegex, isBackground, signal, jobId }) {
        if (!isCloudflareEnabled()) return null;
        // Queue 接收后立即返回 jobId；AI 生成由 Worker Queue 在服务器端完成。
        const safeBody = JSON.parse(JSON.stringify(requestBody));
        safeBody.stream = false;
        const submit = async () => request('/v1/ai/submit', {
            method: 'POST',
            signal,
            body: {
                jobId,
                userId: getUserId(),
                chatId,
                chatType,
                chatName: String(chatName || '').slice(0, 120),
                chatStatusRegex: String(chatStatusRegex || '').slice(0, 500),
                isBackground: !!isBackground,
                appUrl: location.origin,
                aiConfig: getAISettings(),
                requestBody: safeBody
            }
        });
        let accepted;
        let submitError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await submit();
                accepted = await response.json();
                break;
            } catch (error) {
                submitError = error;
                if (signal?.aborted) throw error;
                if (error?.name !== 'TypeError') throw error;
                if (document.visibilityState === 'hidden') await waitForVisible(signal);
                else if (attempt < 2) await delay(800 * (attempt + 1), signal);
            }
        }
        if (!accepted?.jobId) throw submitError || new Error('后台没有确认接收 AI 任务');
        if (!isBackground && typeof showToast === 'function') showToast('后台已接收回复任务；可以暂时切到后台');

        let transientRetries = 0;
        while (true) {
            if (signal?.aborted) throw new DOMException('已停止本次回复', 'AbortError');
            if (document.visibilityState === 'hidden') await waitForVisible(signal);
            try {
                const statusResponse = await request(`/v1/ai/jobs/${encodeURIComponent(jobId)}?userId=${encodeURIComponent(getUserId())}`, { method: 'GET', signal });
                const statusData = await statusResponse.json();
                const job = statusData.job;
                transientRetries = 0;
                if (job?.status === 'failed') throw new Error(job.error || '后台 AI 任务失败');
                if (job?.status === 'completed' && job.response) {
                    return new Response(JSON.stringify(job.response), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-UwU-Job-Id': jobId,
                            // 后台实际完成回复的时间；App 在后台被挂起时，本地处理会晚于它。
                            'X-UwU-Job-Completed-At': String(job.updatedAt || '')
                        }
                    });
                }
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                if (document.visibilityState === 'hidden') await waitForVisible(signal);
                else if (error?.name === 'TypeError' && transientRetries++ < 5) await delay(900 * transientRetries, signal);
                else throw error;
            }
            await delay(1800, signal);
        }
    }

    function waitForVisible(signal) {
        if (document.visibilityState !== 'hidden') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                document.removeEventListener('visibilitychange', onVisible);
                signal?.removeEventListener('abort', onAbort);
            };
            const onVisible = () => { if (document.visibilityState !== 'hidden') { cleanup(); resolve(); } };
            const onAbort = () => { cleanup(); reject(new DOMException('已停止本次回复', 'AbortError')); };
            document.addEventListener('visibilitychange', onVisible);
            signal?.addEventListener('abort', onAbort, { once: true });
            onVisible();
        });
    }

    function delay(ms, signal) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
            const onAbort = () => { clearTimeout(timer); reject(new DOMException('已停止本次回复', 'AbortError')); };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    // 同一条后台回复可能同时被「通知同步」和「任务轮询」两条路径处理；
    // 谁先认领谁处理，另一边跳过，避免回复被显示两次。
    const claimedJobs = new Set();
    function claimJob(jobId) {
        if (!jobId) return true;
        if (claimedJobs.has(jobId)) return false;
        claimedJobs.add(jobId);
        return true;
    }
    function releaseJob(jobId) {
        if (jobId) claimedJobs.delete(jobId);
    }

    async function ackAIJob(jobId) {
        if (!jobId || !isCloudflareEnabled()) return;
        try {
            await request(`/v1/ai/jobs/${encodeURIComponent(jobId)}?action=ack`, {
                method: 'POST', body: { userId: getUserId() }
            });
        } catch (error) {
            console.warn('[UwUBackend] AI 回覆同步確認失敗，稍後可由消息拉取补回：', error);
        }
    }

    async function init() {
        await publishState();
        if (!isCloudflareEnabled()) {
            await reconcileRemote();
            return;
        }
        if (getSettings().backendPushEnabled && Notification.permission === 'granted') {
            try { await registerPush(false); } catch (error) { console.warn('[UwUBackend] 自动恢复 Push 失败:', error); }
        }
        await flushPendingChatSync();
    }

    window.UwUBackendAdapter = {
        isQuietNow,
        getMode,
        getBaseUrl,
        getUserId,
        isCloudflareEnabled,
        testConnection,
        getStatus,
        testPushNotification,
        registerPush,
        syncAISettings,
        syncChatState,
        syncAutoReplySettings,
        stopDeletedChat,
        syncProactiveSettings,
        stopBackendTasks,
        publishState,
        alignTimestamps,
        pullMessages,
        ackMessages,
        fetchAI,
        ackAIJob,
        cancelAIJob,
        claimJob,
        releaseJob,
        init
    };
})();
