// --- API 设置与预设管理逻辑 ---

function setupApiSettingsApp() {
    const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
        a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
        r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
            newapi: '',
            deepseek: 'https://api.deepseek.com',
            claude: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com'
        };
    db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
    if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
    if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; } 
    const quickApiSwitch = document.getElementById('quick-api-settings-switch');
    if (quickApiSwitch) quickApiSwitch.checked = !!(db.apiSettings && db.apiSettings.quickApiSettingsEnabled);

    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');
    const tempValue = document.getElementById('temperature-value');

    if (tempEnabledSwitch) {
        if (db.apiSettings && typeof db.apiSettings.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = db.apiSettings.temperatureEnabled;
        } else {
            tempEnabledSwitch.checked = true;
        }
        if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        tempEnabledSwitch.addEventListener('change', (event) => {
            if (tempSlider) tempSlider.disabled = !event.target.checked;
        });
    }

    if (tempSlider && tempValue) {
        const savedTemp = (db.apiSettings && db.apiSettings.temperature !== undefined)
            ? db.apiSettings.temperature
            : 1.0;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;
        tempSlider.addEventListener('input', (event) => {
            tempValue.textContent = event.target.value;
        });
    }

    // 持续运行增强：保留原有音频保活，并把设置开关重新接回 KeepAliveManager。
    const keepAliveSwitch = document.getElementById('keep-alive-switch');
    if (keepAliveSwitch) {
        keepAliveSwitch.checked = !!(db.apiSettings && db.apiSettings.keepAliveEnabled);
        if (keepAliveSwitch.dataset.listenerBound !== 'true') {
            keepAliveSwitch.dataset.listenerBound = 'true';
            keepAliveSwitch.addEventListener('change', async (event) => {
                const enabled = !!event.target.checked;
                db.apiSettings = db.apiSettings || {};
                db.apiSettings.keepAliveEnabled = enabled;
                await saveData();
                if (window.KeepAliveManager) {
                    try {
                        await window.KeepAliveManager.setEnabled(enabled, { userInitiated: true });
                    } catch (error) {
                        console.error('[KeepAlive] 切换失败:', error);
                        showToast(`持续运行增强${enabled ? '启动' : '关闭'}失败：${error.message || error}`);
                    }
                }
            });
        }
    }
    
    if (window.SystemNotificationManager) {
        window.SystemNotificationManager.init();
    }

    // Cloudflare 后台消息服务：与上方的持续运行增强完全独立。
    const backendModeSwitch = document.getElementById('backend-mode-switch');
    const backendConfigPanel = document.getElementById('backend-config-panel');
    const backendUrlInput = document.getElementById('backend-url-input');
    const backendTokenInput = document.getElementById('backend-token-input');
    const backendTestBtn = document.getElementById('backend-test-btn');
    const backendPushBtn = document.getElementById('backend-push-btn');
    const backendPushTestBtn = document.getElementById('backend-push-test-btn');
    const backendStatus = document.getElementById('backend-status');
    const backendTutorialBtn = document.getElementById('backend-tutorial-btn');
    const backendTutorialModal = document.getElementById('backend-tutorial-modal');
    const backendTutorialClose = document.getElementById('backend-tutorial-close');

    function getBackendConfigError() {
        const url = backendUrlInput?.value.trim() || '';
        const token = backendTokenInput?.value.trim() || '';
        if (!url) return '请先填写 Cloudflare Worker 地址';
        if (!token) return '后台访问 Token 为必填项；请先在 Cloudflare 设置 BACKEND_TOKEN';
        return '';
    }

    function syncBackendUi() {
        const enabled = !!backendModeSwitch?.checked;
        if (backendConfigPanel) backendConfigPanel.style.display = enabled ? '' : 'none';
        if (backendUrlInput) backendUrlInput.value = (db.apiSettings && db.apiSettings.backendUrl) || '';
        if (backendTokenInput) backendTokenInput.value = (db.apiSettings && db.apiSettings.backendToken) || '';
        if (backendUrlInput) backendUrlInput.required = enabled;
        if (backendTokenInput) backendTokenInput.required = enabled;
        if (backendStatus) backendStatus.style.display = enabled ? '' : 'none';
    }

    async function refreshBackendConnectionStatus() {
        if (!backendModeSwitch?.checked || !db.apiSettings?.backendUrl || !backendStatus) return;
        const configError = getBackendConfigError();
        if (configError) {
            backendStatus.textContent = configError;
            return;
        }
        backendStatus.textContent = '正在检查后台连接…';
        try {
            const result = await window.UwUBackendAdapter.testConnection();
            backendStatus.textContent = `已连接 · ${result.version || 'UwU Backend'}`;
        } catch (error) {
            backendStatus.textContent = `连接失败：${error.message}`;
        }
    }

    if (backendModeSwitch) {
        backendModeSwitch.checked = (db.apiSettings && db.apiSettings.backendMode === 'cloudflare');
        syncBackendUi();
        refreshBackendConnectionStatus();
        backendModeSwitch.addEventListener('change', async () => {
            const enabling = backendModeSwitch.checked;
            let stopWarning = '';
            let stopConfirmed = false;
            if (!enabling) {
                try {
                    await window.UwUBackendAdapter?.stopBackendTasks?.();
                    stopConfirmed = true;
                } catch (error) {
                    stopWarning = `本机已关闭，但云端停止排程未确认：${error.message}。下次打开 UwU 会自动重试。`;
                }
            }
            db.apiSettings = db.apiSettings || {};
            db.apiSettings.backendMode = enabling ? 'cloudflare' : 'off';
            // 记录雲端是否已确认停止；未确认时，下次启动会自动补发停止指令。
            db.apiSettings.backendStopConfirmed = enabling ? false : stopConfirmed;
            await saveData();
            await window.UwUBackendAdapter?.publishState?.();
            syncBackendUi();
            if (!enabling && stopWarning) showToast(stopWarning);
            if (enabling) {
                const configError = getBackendConfigError();
                if (configError) {
                    if (backendStatus) backendStatus.textContent = configError;
                    showToast(configError);
                    return;
                }
                refreshBackendConnectionStatus();
                try {
                    if (window.UwUBackendAdapter?.syncAISettings) await window.UwUBackendAdapter.syncAISettings();
                } catch (error) {
                    console.warn('[UwUBackend] AI 设置同步失败：', error);
                }
                showToast('Cloudflare 后台消息服务已开启；建议与上方持续运行增强择一使用');
            }
        });
    }
    if (backendUrlInput) backendUrlInput.addEventListener('input', () => { db.apiSettings.backendUrl = backendUrlInput.value.trim(); });
    if (backendTokenInput) backendTokenInput.addEventListener('input', () => { db.apiSettings.backendToken = backendTokenInput.value.trim(); });
    if (backendTestBtn) backendTestBtn.addEventListener('click', async () => {
        try {
            const configError = getBackendConfigError();
            if (configError) throw new Error(configError);
            db.apiSettings.backendUrl = backendUrlInput.value.trim();
            db.apiSettings.backendToken = backendTokenInput.value.trim();
            await saveData();
            await refreshBackendConnectionStatus();
            if (backendStatus?.textContent.startsWith('已连接')) {
                showToast('后台连接成功');
                // 顺便显示主动消息的运行状态，方便排查没收到的原因。
                try {
                    const st = await window.UwUBackendAdapter.getStatus();
                    const fmt = t => t ? new Date(t).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无';
                    const lines = (st.chats || []).map(c => {
                        let line = `「${c.name}」每 ${c.intervalMin} 分钟 · 下次约 ${fmt(c.nextDueAt)}${c.quietNow ? '（现在是安静时段）' : ''} · 上次成功 ${fmt(c.lastOkAt)}`;
                        if (c.lastNotifiedCount) line += `\n  上次发出 ${c.lastNotifiedCount} 条通知：${c.lastNotified.join(' / ')}`;
                        if (!c.hasChatBody) line += '\n  ⚠ 后台还没有这个聊天的内容：请先在 UwU 里正常聊一次';
                        if (c.lastError) line += `\n  ⚠ ${fmt(c.lastError.at)} 失败：${c.lastError.message}`;
                        return line;
                    });
                    const head = `已连接 · 模型 ${st.proactiveModel || '未设置'}${st.usingProactiveApi ? '（自动消息副 API）' : ''} · 推送设备 ${st.subscriptions}`;
                    backendStatus.style.whiteSpace = 'pre-wrap';
                    backendStatus.textContent = lines.length ? `${head}\n${lines.join('\n')}` : `${head}\n没有开启主动消息的聊天`;
                } catch (statusError) {
                    // 旧版 Worker 没有状态接口，忽略即可。
                }
                return;
            }
            throw new Error(backendStatus?.textContent.replace(/^连接失败：/, '') || '无法连接后台');
        } catch (error) {
            if (backendStatus) backendStatus.textContent = `连接失败：${error.message}`;
            showToast(`后台连接失败：${error.message}`);
        }
    });
    if (backendPushBtn) backendPushBtn.addEventListener('click', async () => {
        try {
            const configError = getBackendConfigError();
            if (configError) throw new Error(configError);
            db.apiSettings.backendUrl = backendUrlInput.value.trim();
            db.apiSettings.backendToken = backendTokenInput.value.trim();
            await saveData();
            await window.UwUBackendAdapter.registerPush(true);
            if (backendStatus) backendStatus.textContent = '后台通知已注册';
            showToast('后台通知注册成功');
        } catch (error) {
            if (backendStatus) backendStatus.textContent = `注册失败：${error.message}`;
            showToast(`后台通知注册失败：${error.message}`);
        }
    });
    if (backendPushTestBtn) backendPushTestBtn.addEventListener('click', async () => {
        try {
            const configError = getBackendConfigError();
            if (configError) throw new Error(configError);
            db.apiSettings.backendUrl = backendUrlInput.value.trim();
            db.apiSettings.backendToken = backendTokenInput.value.trim();
            await saveData();
            if (!db.apiSettings.backendPushEnabled || Notification.permission !== 'granted') {
                throw new Error('请先点击「注册后台通知」并允许 iOS 通知');
            }
            const result = await window.UwUBackendAdapter.testPushNotification();
            showToast(`Worker 已送出测试通知（${result.sent || 1} 台设备）；请检查 iPhone 通知横幅或通知中心`);
        } catch (error) {
            showToast(`测试通知失败：${error.message}`);
        }
    });
    if (backendTutorialBtn && backendTutorialModal) {
        backendTutorialBtn.addEventListener('click', () => { backendTutorialModal.style.display = 'flex'; });
    }
    if (backendTutorialClose && backendTutorialModal) {
        backendTutorialClose.addEventListener('click', () => { backendTutorialModal.style.display = 'none'; });
        backendTutorialModal.addEventListener('click', (event) => {
            if (event.target === backendTutorialModal) backendTutorialModal.style.display = 'none';
        });
    }

    // 提取为全局函数以便复用
    window.fetchAndPopulateModels = async (showToastFlag = true) => {
        const provider = n.value;
        let apiUrl = r.value.trim();
        const apiKey = s.value.trim();
        const modelSelect = a;
        const fetchBtn = t;

        if (!apiUrl || !apiKey) {
            if (showToastFlag) showToast('请先填写API地址和密钥！');
            return;
        }

        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            if (showToastFlag) showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }

        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;

        if (fetchBtn) {
            fetchBtn.classList.add('loading');
            fetchBtn.disabled = true;
        }

        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }

            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }

            // 保留当前选中的值（如果仍在列表中）
            const currentVal = modelSelect.value;
            
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                // 尝试恢复之前的选择，或者使用设置中的值
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.apiSettings && db.apiSettings.model && models.includes(db.apiSettings.model)) {
                    modelSelect.value = db.apiSettings.model;
                }
                
                if (showToastFlag) showToast('模型列表拉取成功！');
            } else {
                modelSelect.innerHTML = '<option value="">未找到任何模型</option>';
                if (showToastFlag) showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            if (showToastFlag) {
                showApiError(err);
                modelSelect.innerHTML = '<option value="">拉取失败</option>';
            }
        } finally {
            if (fetchBtn) {
                fetchBtn.classList.remove('loading');
                fetchBtn.disabled = false;
            }
        }
    };

    t.addEventListener('click', () => window.fetchAndPopulateModels(true));
    e.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value) return showToast('请选择模型后保存！');
        if (document.getElementById('backend-mode-switch')?.checked) {
            const backendUrl = document.getElementById('backend-url-input')?.value.trim() || '';
            const backendToken = document.getElementById('backend-token-input')?.value.trim() || '';
            if (!backendUrl) return showToast('请先填写 Cloudflare Worker 地址！');
            if (!backendToken) return showToast('后台访问 Token 为必填项；请先在 Cloudflare 设置 BACKEND_TOKEN！');
        }
        if (BLOCKED_API_DOMAINS.some(domain => r.value.includes(domain))) {
            return showToast('该 API 站点已被屏蔽，无法保存！');
        }
        const secondary = readSecondaryApiSettings();
        if (secondary.enabled && (!secondary.url || !secondary.key || !secondary.model)) {
            return showToast('请完整填写副 API 地址、密钥和模型！');
        }
        if (secondary.enabled && BLOCKED_API_DOMAINS.some(domain => secondary.url.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法保存！');
        }
        db.apiSettings = {
            provider: n.value,
            url: r.value,
            key: s.value,
            model: a.value,
            timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
            streamEnabled: document.getElementById('stream-switch').checked, 
            keepAliveEnabled: document.getElementById('keep-alive-switch') ? document.getElementById('keep-alive-switch').checked : false,
            systemNotificationEnabled: document.getElementById('system-notification-switch') ? document.getElementById('system-notification-switch').checked : false,
            backendMode: document.getElementById('backend-mode-switch')?.checked ? 'cloudflare' : 'off',
            backendUrl: document.getElementById('backend-url-input') ? document.getElementById('backend-url-input').value.trim() : (db.apiSettings.backendUrl || ''),
            backendToken: document.getElementById('backend-token-input') ? document.getElementById('backend-token-input').value.trim() : (db.apiSettings.backendToken || ''),
            backendPushEnabled: !!db.apiSettings.backendPushEnabled,
            backendUserId: db.apiSettings.backendUserId || '',
            backendStopConfirmed: db.apiSettings.backendStopConfirmed,
            backendPendingChatStops: db.apiSettings.backendPendingChatStops,
            temperatureEnabled: document.getElementById('temperature-enabled-switch').checked,
            temperature: parseFloat(document.getElementById('temperature-slider').value),
            quickApiSettingsEnabled: !!document.getElementById('quick-api-settings-switch')?.checked,
            secondary
        };
        await saveData();
        await window.UwUBackendAdapter?.publishState?.();
        if (window.UwUBackendAdapter?.isCloudflareEnabled?.() && window.UwUBackendAdapter?.syncAISettings) {
            try { await window.UwUBackendAdapter.syncAISettings(); }
            catch (error) { console.warn('[UwUBackend] AI 设置同步失败：', error); }
        }
        showToast('API设置已保存！')
    })

    // 初始化副 API 面板：未开启时保持收起，与原来的交互一致。
    setupSecondaryApiSettings();
}

function getDefaultSecondaryApiRoutes() {
    return {
        callReply: false,
        callSummary: false,
        journal: false,
        peek: false,
        shop: false,
        batteryReminder: false,
        autoMessage: false
    };
}

function readSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const routes = getDefaultSecondaryApiRoutes();

    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        routes[input.dataset.secondaryRoute] = input.checked;
    });

    return {
        enabled: Boolean(enabledEl && enabledEl.checked),
        provider: providerEl ? providerEl.value : 'newapi',
        url: urlEl ? urlEl.value.trim().replace(/\/$/, '') : '',
        key: keyEl ? keyEl.value.trim() : '',
        model: modelEl ? modelEl.value : '',
        routes
    };
}

function setupSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const panel = document.getElementById('secondary-api-panel');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const fetchBtn = document.getElementById('secondary-fetch-models-btn');
    if (!enabledEl || !panel || !providerEl || !urlEl || !keyEl || !modelEl || !fetchBtn) return;

    const secondary = (db.apiSettings && db.apiSettings.secondary) || {};
    const providerUrls = {
        newapi: '',
        deepseek: 'https://api.deepseek.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com'
    };

    enabledEl.checked = Boolean(secondary.enabled);
    providerEl.value = secondary.provider || 'newapi';
    urlEl.value = secondary.url || '';
    keyEl.value = secondary.key || '';
    if (secondary.model) {
        modelEl.innerHTML = '';
        const savedModelOption = document.createElement('option');
        savedModelOption.value = secondary.model;
        savedModelOption.textContent = secondary.model;
        modelEl.appendChild(savedModelOption);
    }
    const savedRoutes = { ...getDefaultSecondaryApiRoutes(), ...(secondary.routes || {}) };
    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        input.checked = Boolean(savedRoutes[input.dataset.secondaryRoute]);
    });

    const updatePanelState = () => {
        panel.style.display = enabledEl.checked ? 'block' : 'none';
    };
    updatePanelState();

    if (enabledEl.dataset.listenerBound === 'true') return;
    enabledEl.dataset.listenerBound = 'true';
    enabledEl.addEventListener('change', updatePanelState);

    // 开关 / 「自动消息」勾选一变，立刻保存并同步给 Worker，不必再按「保存」。
    // 关闭、或取消勾选时一定同步（Worker 随即不再使用副 API）；开启时要填完整才同步。
    const autoSyncSecondary = async () => {
        try {
            const sec = readSecondaryApiSettings();
            const complete = sec.url && sec.key && sec.model;
            if (sec.enabled && !complete) return;
            db.apiSettings = { ...(db.apiSettings || {}), secondary: sec };
            await saveData();
            if (window.UwUBackendAdapter?.isCloudflareEnabled?.() && window.UwUBackendAdapter?.syncAISettings) {
                await window.UwUBackendAdapter.syncAISettings();
                showToast(sec.enabled && sec.routes.autoMessage ? '已同步：自动消息使用副 API' : '已同步：自动消息使用主 API');
            }
        } catch (error) {
            console.warn('[UwUBackend] 副 API 自动同步失败：', error);
        }
    };
    enabledEl.addEventListener('change', autoSyncSecondary);
    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        input.addEventListener('change', autoSyncSecondary);
    });
    providerEl.addEventListener('change', () => {
        urlEl.value = providerUrls[providerEl.value] || '';
        modelEl.innerHTML = '<option value="">请重新拉取模型</option>';
    });
    fetchBtn.addEventListener('click', async () => {
        let apiUrl = urlEl.value.trim().replace(/\/$/, '');
        const apiKey = keyEl.value.trim();
        const provider = providerEl.value;
        if (!apiUrl || !apiKey) return showToast('请先填写副 API 地址和密钥！');
        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法使用！');
        }

        const endpoint = provider === 'gemini'
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}`
            : `${apiUrl}/v1/models`;
        fetchBtn.disabled = true;
        fetchBtn.classList.add('loading');
        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }
            const data = await response.json();
            const models = provider === 'gemini'
                ? (data.models || []).map(item => item.name.replace('models/', ''))
                : (data.data || []).map(item => item.id);
            modelEl.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelEl.appendChild(option);
            });
            if (!models.length) modelEl.innerHTML = '<option value="">未找到任何模型</option>';
            showToast(models.length ? '副 API 模型列表拉取成功！' : '未找到任何模型');
        } catch (error) {
            showApiError(error);
            modelEl.innerHTML = '<option value="">拉取失败</option>';
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.classList.remove('loading');
        }
    });
}

// --- 预设管理 ---
function _getApiPresets() {
    return db.apiPresets || [];
}

function _createApiPresetId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'api_preset_' + window.crypto.randomUUID();
    }
    return 'api_preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function _normalizeApiPresets(arr) {
    const usedIds = new Set();
    return (Array.isArray(arr) ? arr : []).map(preset => {
        const normalized = preset && typeof preset === 'object' ? preset : {};
        if (!normalized.id || usedIds.has(normalized.id)) {
            normalized.id = _createApiPresetId();
        }
        usedIds.add(normalized.id);
        return normalized;
    });
}

function _saveApiPresets(arr) {
    db.apiPresets = _normalizeApiPresets(arr);
    saveData();
    window.dispatchEvent(new CustomEvent('api-presets-updated'));
}

function populateApiSelect() {
    const sel = document.getElementById('api-preset-select');
    if (!sel) return;
    const needsMigration = _getApiPresets().some(p => !p || !p.id);
    const presets = _normalizeApiPresets(_getApiPresets());
    db.apiPresets = presets;
    if (needsMigration) saveData();
    sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
    presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
    });
}

function saveCurrentApiAsPreset() {
    const apiKeyEl = document.querySelector('#api-key');
    const apiUrlEl = document.querySelector('#api-url');
    const providerEl = document.querySelector('#api-provider');
    const modelEl = document.querySelector('#api-model');
    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');

    const data = {
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        apiUrl: apiUrlEl ? apiUrlEl.value : '',
        provider: providerEl ? providerEl.value : '',
        model: modelEl ? modelEl.value : '',
        temperatureEnabled: tempEnabledSwitch ? tempEnabledSwitch.checked : false,
        temperature: tempSlider ? parseFloat(tempSlider.value) : 1.0
    };
    
    let name = prompt('为该 API 预设填写名称（会覆盖同名预设）：');
    if (!name) return;
    const presets = _getApiPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = {id: idx >= 0 ? presets[idx].id : _createApiPresetId(), name: name, data: data};
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveApiPresets(presets);
    populateApiSelect();
    showToast('API 预设已保存');
}

async function applyApiPreset(name) {
    const presets = _getApiPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    try {
        const apiKeyEl = document.querySelector('#api-key');
        const apiUrlEl = document.querySelector('#api-url');
        const providerEl = document.querySelector('#api-provider');
        const modelEl = document.querySelector('#api-model');
        const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
        const tempSlider = document.getElementById('temperature-slider');
        const tempValue = document.getElementById('temperature-value');

        if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
        if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
        if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
        if (modelEl && p.data && typeof p.data.model !== 'undefined') {
            modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
            modelEl.value = p.data.model;
        }
        if (tempEnabledSwitch && p.data && typeof p.data.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = p.data.temperatureEnabled;
            if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        }
        if (tempSlider && p.data && typeof p.data.temperature !== 'undefined') {
            tempSlider.value = p.data.temperature;
            if (tempValue) tempValue.textContent = p.data.temperature;
        }

        showToast('已应用 API 预设');
    } catch(e) {
        console.error('applyApiPreset error', e);
    }
}

function openApiManageModal() {
    const modal = document.getElementById('api-presets-modal');
    const list = document.getElementById('api-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getApiPresets();
    if (!presets.length) {
        list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    }
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 6px';
        row.style.borderBottom = '1px solid #f6f6f6';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.innerHTML = '<div style="font-weight:600;">'+p.name+'</div><div style="font-size:12px;color:#666;margin-top:4px;">' + (p.data && p.data.provider ? ('提供者：'+p.data.provider) : '') + '</div>';

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyApiPreset(p.name); modal.style.display='none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getApiPresets();
            all[idx].name = newName;
            _saveApiPresets(all);
            openApiManageModal();
            populateApiSelect();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.textContent = '删除';
        delBtn.onclick = function(){ if(!confirm('确定删除 "'+p.name+'" ?')) return; const all=_getApiPresets(); all.splice(idx,1); _saveApiPresets(all); openApiManageModal(); populateApiSelect(); };

        btns.appendChild(applyBtn); btns.appendChild(renameBtn); btns.appendChild(delBtn);

        row.appendChild(left); row.appendChild(btns);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function exportApiPresets() {
    const presets = _getApiPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function importApiPresets() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = function(e){
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(){ try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else alert('文件格式不正确'); } catch(e){ alert('导入失败：'+e.message); } };
        r.readAsText(f);
    };
    inp.click();
}


// === 快速 API 设置 ===
function isQuickApiSettingsEnabled() {
    return !!(db && db.apiSettings && db.apiSettings.quickApiSettingsEnabled);
}

function _quickApiSetField(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = value;
    return el;
}

function _quickApiFillPresetList(select) {
    if (!select) return;
    const presets = _getApiPresets();
    const current = select.value;
    select.innerHTML = '<option value="">— 选择已保存的 API 预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
    if (presets.some(p => p.name === current)) select.value = current;
}

function _quickApiFillModelOptions(models, selected) {
    const select = document.getElementById('quick-api-model');
    if (!select) return;
    select.innerHTML = '';
    const list = Array.isArray(models) ? models : [];
    if (!list.length) {
        const opt = document.createElement('option');
        opt.value = selected || '';
        opt.textContent = selected || '请先拉取模型';
        select.appendChild(opt);
        return;
    }
    list.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        select.appendChild(opt);
    });
    if (selected && list.includes(selected)) select.value = selected;
}

function _quickApiSyncFromMainForm() {
    _quickApiSetField('quick-api-provider', document.getElementById('api-provider')?.value || 'newapi');
    _quickApiSetField('quick-api-url', document.getElementById('api-url')?.value || '');
    _quickApiSetField('quick-api-key', document.getElementById('api-key')?.value || '');
    const mainModel = document.getElementById('api-model');
    const models = mainModel ? Array.from(mainModel.options).map(o => o.value).filter(Boolean) : [];
    _quickApiFillModelOptions(models, mainModel?.value || db.apiSettings?.model || '');
}

function _quickApiSyncToMainForm() {
    const provider = document.getElementById('quick-api-provider');
    const url = document.getElementById('quick-api-url');
    const key = document.getElementById('quick-api-key');
    const model = document.getElementById('quick-api-model');
    _quickApiSetField('api-provider', provider?.value || 'newapi');
    _quickApiSetField('api-url', url?.value || '');
    _quickApiSetField('api-key', key?.value || '');
    const mainModel = document.getElementById('api-model');
    if (mainModel) {
        mainModel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = model?.value || '';
        opt.textContent = model?.value || '未选择模型';
        mainModel.appendChild(opt);
        mainModel.value = model?.value || '';
    }
}

async function saveQuickApiSettings() {
    const provider = document.getElementById('quick-api-provider')?.value || 'newapi';
    const url = (document.getElementById('quick-api-url')?.value || '').trim();
    const key = (document.getElementById('quick-api-key')?.value || '').trim();
    const model = document.getElementById('quick-api-model')?.value || '';
    if (!url || !key || !model) return showToast('请填写 API 地址、密钥并选择模型');
    if (typeof BLOCKED_API_DOMAINS !== 'undefined' && BLOCKED_API_DOMAINS.some(domain => url.includes(domain))) {
        return showToast('该 API 站点已被屏蔽，无法使用！');
    }
    _quickApiSyncToMainForm();
    db.apiSettings = {
        ...(db.apiSettings || {}),
        provider, url, key, model,
        temperatureEnabled: document.getElementById('temperature-enabled-switch')?.checked ?? db.apiSettings?.temperatureEnabled ?? true,
        temperature: parseFloat(document.getElementById('temperature-slider')?.value ?? db.apiSettings?.temperature ?? 1.0),
        quickApiSettingsEnabled: true
    };
    await saveData();
    if (window.UwUBackendAdapter?.isCloudflareEnabled?.() && window.UwUBackendAdapter?.syncAISettings) {
        try { await window.UwUBackendAdapter.syncAISettings(); }
        catch (error) { console.warn('[UwUBackend] 快速 API 切换后同步失败：', error); }
    }
    showToast('API 已快速切换并保存');
    const modal = document.getElementById('quick-api-settings-modal');
    if (modal) modal.style.display = 'none';
}

function applyQuickApiPresetToPanel(name) {
    const p = _getApiPresets().find(x => x.name === name);
    if (!p || !p.data) return;
    _quickApiSetField('quick-api-provider', p.data.provider || 'newapi');
    _quickApiSetField('quick-api-url', p.data.apiUrl || '');
    _quickApiSetField('quick-api-key', p.data.apiKey || '');
    _quickApiFillModelOptions(p.data.model ? [p.data.model] : [], p.data.model || '');
}

async function quickApiFetchModels() {
    const provider = document.getElementById('quick-api-provider')?.value || 'newapi';
    const url = (document.getElementById('quick-api-url')?.value || '').trim();
    const key = (document.getElementById('quick-api-key')?.value || '').trim();
    if (!url || !key) return showToast('请先填写 API 地址和密钥');
    if (typeof BLOCKED_API_DOMAINS !== 'undefined' && BLOCKED_API_DOMAINS.some(domain => url.includes(domain))) return showToast('该 API 站点已被屏蔽，无法使用！');
    const btn = document.getElementById('quick-api-fetch-models');
    if (btn) { btn.disabled = true; btn.textContent = '拉取中…'; }
    try {
        const cleanUrl = url.replace(/\/$/, '');
        const endpoint = provider === 'gemini' ? `${cleanUrl}/v1beta/models?key=${getRandomValue(key)}` : `${cleanUrl}/v1/models`;
        const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${key}` };
        const response = await fetch(endpoint, { method: 'GET', headers });
        if (!response.ok) throw new Error(`网络响应错误: ${response.status}`);
        const data = await response.json();
        const models = provider !== 'gemini'
            ? (Array.isArray(data.data) ? data.data.map(x => x.id).filter(Boolean) : [])
            : (Array.isArray(data.models) ? data.models.map(x => String(x.name || '').replace(/^models\//, '')).filter(Boolean) : []);
        _quickApiFillModelOptions(models, document.getElementById('quick-api-model')?.value || db.apiSettings?.model || '');
        showToast(models.length ? `已拉取 ${models.length} 个模型` : '未找到任何模型');
    } catch (err) {
        console.error('quickApiFetchModels error', err);
        if (typeof showApiError === 'function') showApiError(err); else showToast('模型拉取失败');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '拉取'; }
    }
}

function openQuickApiSettingsPanel() {
    if (!isQuickApiSettingsEnabled()) return;
    const modal = document.getElementById('quick-api-settings-modal');
    if (!modal) return;
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.style.display = 'flex';
    _quickApiSyncFromMainForm();
    _quickApiFillPresetList(document.getElementById('quick-api-preset-select'));
}

window.openQuickApiSettingsPanel = openQuickApiSettingsPanel;
window.isQuickApiSettingsEnabled = isQuickApiSettingsEnabled;

function setupQuickApiSettingsUI() {
    const sw = document.getElementById('quick-api-settings-switch');
    if (sw) {
        sw.checked = !!(db.apiSettings && db.apiSettings.quickApiSettingsEnabled);
        sw.addEventListener('change', async e => {
            db.apiSettings = db.apiSettings || {};
            db.apiSettings.quickApiSettingsEnabled = !!e.target.checked;
            await saveData();
            showToast(e.target.checked ? '三击快速 API 设置已开启' : '三击快速 API 设置已关闭');
        });
    }
    const presetSelect = document.getElementById('quick-api-preset-select');
    if (presetSelect) presetSelect.addEventListener('change', e => applyQuickApiPresetToPanel(e.target.value));
    const fetchBtn = document.getElementById('quick-api-fetch-models');
    if (fetchBtn) fetchBtn.addEventListener('click', quickApiFetchModels);
    const applyBtn = document.getElementById('quick-api-apply');
    if (applyBtn) applyBtn.addEventListener('click', saveQuickApiSettings);
    const closeBtn = document.getElementById('quick-api-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { const m=document.getElementById('quick-api-settings-modal'); if(m)m.style.display='none'; });
    const modal = document.getElementById('quick-api-settings-modal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.style.display='none'; });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupQuickApiSettingsUI);
else setupQuickApiSettingsUI();

// ---------- 模型列表搜索 ----------
// 拉取模型后可能有几百个，下拉框里不好找。模型旁边有一个放大镜图标，点一下展开搜索框：
// 输入关键字（多个词用空格隔开，需全部命中）就只显示匹配的模型。
// 选好模型、或搜索框清空后点到别处，搜索框会自动收起；当前已选的模型始终保留在列表里，搜索不会改掉它。
const MODEL_SEARCH_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.9536 14.9458L21 21M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"/></svg>';

function attachModelSearch(select, { rowFactory, placeToggle, minCount = 1 } = {}) {
    if (!select || select.dataset.modelSearchBound === 'true') return null;
    select.dataset.modelSearchBound = 'true';

    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.placeholder = '搜索模型…';
    input.className = 'model-search-input';
    const row = rowFactory(input);
    row.style.display = 'none';

    // 放大镜按钮：图标大小 24、颜色与其它设置项图标一致（主题色）。
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'model-search-toggle';
    toggle.title = '搜索模型';
    toggle.setAttribute('aria-label', '搜索模型');
    toggle.innerHTML = MODEL_SEARCH_ICON;
    toggle.style.cssText = 'display:none;align-items:center;justify-content:center;flex:0 0 auto;width:24px;height:24px;padding:0;margin:0 0 0 8px;border:none;background:none;cursor:pointer;color:var(--primary-color, #007AFF);vertical-align:middle;';
    placeToggle(toggle);

    let allModels = [];
    let filtering = false;
    let open = false;

    const readModels = () => Array.from(select.options).map(o => o.value).filter(Boolean);

    const rebuild = (list, keep) => {
        filtering = true;
        select.innerHTML = '';
        const add = (value, text, disabled) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            if (disabled) opt.disabled = true;
            select.appendChild(opt);
        };
        // 已选模型不在匹配结果里时，也保留在列表最前面，避免保存时丢失。
        if (keep && !list.includes(keep)) add(keep, `${keep}（当前）`);
        list.forEach(model => add(model, model));
        if (!list.length) add('', '没有匹配的模型', true);
        if (keep) select.value = keep;
        observer.takeRecords();
        filtering = false;
    };

    const apply = () => {
        const keep = select.value;
        const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) { rebuild(allModels, keep); return; }
        rebuild(allModels.filter(model => {
            const text = model.toLowerCase();
            return words.every(word => text.includes(word));
        }), keep);
    };

    const setOpen = (next, focus) => {
        open = next;
        row.style.display = next ? '' : 'none';
        toggle.setAttribute('aria-expanded', String(next));
        if (next) {
            if (focus) input.focus();
        } else if (input.value) {
            // 收起时恢复完整列表，保持当前选择。
            input.value = '';
            apply();
        }
    };

    const refresh = () => {
        allModels = readModels();
        const enough = allModels.length >= minCount;
        toggle.style.display = enough ? 'inline-flex' : 'none';
        input.placeholder = enough ? `搜索模型（共 ${allModels.length} 个）` : '搜索模型…';
        if (!enough) setOpen(false);
    };

    // 其它代码（拉取模型、读取已保存设置）重写下拉框时，同步一份完整列表。
    const observer = new MutationObserver(() => {
        if (filtering) return;
        input.value = '';
        refresh();
    });
    observer.observe(select, { childList: true });

    toggle.addEventListener('click', () => setOpen(!open, true));
    input.addEventListener('input', apply);
    // 搜索框在表单里，按回车不能提交表单，只收起键盘。
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    });
    // 没输入内容就点到别处：自动收起。有内容时保留，方便接着去下拉框里选。
    input.addEventListener('blur', () => {
        setTimeout(() => { if (open && !input.value.trim() && document.activeElement !== input) setOpen(false); }, 200);
    });
    // 选好模型后自动收起。
    select.addEventListener('change', () => setOpen(false));
    refresh();
    return { input, row, toggle, refresh };
}

function initModelSearchBoxes() {
    // 设置列表里的「搜索」行：main 行左边有图标列，这里也放一个同样大小颜色的放大镜，标题才能与上一行对齐。
    const makeKktRow = (title, withIcon) => (input) => {
        const row = document.createElement('div');
        row.className = 'kkt-item';
        row.innerHTML = `${withIcon ? `<div class="kkt-item-icon">${MODEL_SEARCH_ICON}</div>` : ''}<div class="kkt-item-content" style="flex:0 0 auto;"><div class="kkt-item-title">${title}</div></div><div class="kkt-item-control" style="flex:1;min-width:0;margin-left:12px;"></div>`;
        input.style.cssText = 'width:100%;min-width:0;text-align:right;border:none;background:transparent;font-size:14px;outline:none;color:inherit;';
        row.querySelector('.kkt-item-control').appendChild(input);
        return row;
    };
    // 放大镜按钮放在该行标题文字后面，不占用右侧下拉框 / 拉取按钮的位置，也不会把它们挤变形。
    const placeAfterTitle = (select) => (btn) => {
        const title = select.closest('.kkt-item').querySelector('.kkt-item-title');
        if (!title) { select.parentElement.appendChild(btn); return; }
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        btn.style.margin = '0 0 0 8px';
        title.appendChild(btn);
    };

    // 主 API：放在上一行「模型列表」的「拉取」按钮左边（那一行右边有空位），
    // 「选择模型」这一行保持原样，不会被挤成多行。
    const placeBesideFetch = (btn) => {
        const fetchBtn = document.getElementById('fetch-models-btn');
        if (fetchBtn && fetchBtn.parentElement) {
            btn.style.margin = '0 10px 0 0';
            btn.style.verticalAlign = 'middle';
            fetchBtn.parentElement.insertBefore(btn, fetchBtn);
        } else {
            placeAfterTitle(document.getElementById('api-model'))(btn);
        }
    };

    const main = document.getElementById('api-model');
    if (main && main.closest('.kkt-item')) {
        const handle = attachModelSearch(main, { rowFactory: makeKktRow('搜索模型', true), placeToggle: placeBesideFetch });
        if (handle) main.closest('.kkt-item').insertAdjacentElement('afterend', handle.row);
    }

    const secondary = document.getElementById('secondary-api-model');
    if (secondary && secondary.closest('.kkt-item')) {
        const handle = attachModelSearch(secondary, { rowFactory: makeKktRow('搜索副 API 模型', false), placeToggle: placeAfterTitle(secondary) });
        if (handle) secondary.closest('.kkt-item').insertAdjacentElement('afterend', handle.row);
    }

    const quick = document.getElementById('quick-api-model');
    if (quick && quick.closest('.quick-api-model-row')) {
        const rowEl = quick.closest('.quick-api-model-row');
        // 模型行是「标签 | 下拉框 | 拉取」三列网格，多一个图标按钮就加一列，并与下拉框、拉取按钮同高（38px）。
        if (!document.getElementById('model-search-quick-style')) {
            const style = document.createElement('style');
            style.id = 'model-search-quick-style';
            style.textContent = `
                .quick-api-model-row.has-model-search { grid-template-columns: 72px minmax(0, 1fr) auto auto; }
                @media (max-width: 420px) { .quick-api-model-row.has-model-search { grid-template-columns: 64px minmax(0, 1fr) auto auto; } }
                .quick-api-model-row .model-search-toggle { width: 38px !important; height: 38px !important; margin: 0 !important; border: 1px solid #e0e0e0 !important; border-radius: 9px !important; background: #fff !important; box-sizing: border-box; }`;
            document.head.appendChild(style);
        }
        rowEl.classList.add('has-model-search');
        const handle = attachModelSearch(quick, {
            rowFactory: (input) => {
                const row = document.createElement('div');
                row.className = 'quick-api-field-row';
                const label = document.createElement('label');
                label.textContent = '搜索';
                row.appendChild(label);
                row.appendChild(input);
                return row;
            },
            placeToggle: (btn) => {
                // 放在「拉取」按钮之前，即下拉框与拉取之间
                const fetchBtn = rowEl.querySelector('button');
                rowEl.insertBefore(btn, fetchBtn || null);
            }
        });
        if (handle) rowEl.insertAdjacentElement('afterend', handle.row);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModelSearchBoxes);
} else {
    initModelSearchBoxes();
}
