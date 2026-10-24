// --- 聊天设置与管理逻辑 ---

function setupChatSettings() {
    if (typeof injectChatSettingsHtml === 'function') {
        injectChatSettingsHtml();
    }

    const themeSelect = document.getElementById('setting-theme-color');
    themeSelect.innerHTML = '';
    Object.keys(colorThemes).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = colorThemes[key].name;
        themeSelect.appendChild(option);
    });
    
    document.getElementById('chat-settings-btn').addEventListener('click', () => {
        if (currentChatType === 'private') {
            loadSettingsToSidebar();
            switchScreen('chat-settings-screen');
        } else if (currentChatType === 'group') {
            loadGroupSettingsToSidebar();
            switchScreen('group-settings-screen');
        }
    });

    const moreSettingsBtn = document.getElementById('more-settings-btn');
    if (moreSettingsBtn) {
        moreSettingsBtn.addEventListener('click', () => {
            switchScreen('api-settings-screen');
        });
    }
    
    document.querySelector('.phone-screen').addEventListener('click', e => {
        const openSidebar = document.querySelector('.settings-sidebar.open');
        if (openSidebar && !openSidebar.contains(e.target) && !e.target.closest('.action-btn') && !e.target.closest('.modal-overlay') && !e.target.closest('.action-sheet-overlay')) {
            openSidebar.classList.remove('open');
        }
    });

    document.getElementById('chat-settings-form').addEventListener('submit', e => {
        e.preventDefault();
        saveSettingsFromSidebar();
    });

    // --- Tab 切换逻辑 ---
    // 仅选择聊天设置和群聊设置中的 Tab，排除 CoT 设置
    const tabs = document.querySelectorAll('#chat-settings-screen .settings-tab-item, #group-settings-screen .settings-tab-item');
    const contents = document.querySelectorAll('.settings-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有 active 类
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // 添加当前 active 类
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            if (targetId) {
                const targetEl = document.getElementById(targetId);
                if (targetEl) targetEl.classList.add('active');
            }
        });
    });
    
    const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
        customCssTextarea = document.getElementById('setting-custom-bubble-css'),
        resetCustomCssBtn = document.getElementById('reset-custom-bubble-css-btn'),
        privatePreviewBox = document.getElementById('private-bubble-css-preview');

    // 初始化私聊 CSS 搜索替换工具栏
    initTextareaSearchReplace('private-css-toolbar', 'setting-custom-bubble-css');
        
    useCustomCssCheckbox.addEventListener('change', (e) => {
        triggerHapticFeedback('light');
        customCssTextarea.disabled = !e.target.checked;
        const char = db.characters.find(c => c.id === currentChatId);
        if (char) {
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, customCssTextarea.value, !e.target.checked, theme);
        }
    });
    
    customCssTextarea.addEventListener('input', (e) => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (char && useCustomCssCheckbox.checked) {
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, e.target.value, false, theme);
        }
    });
    
    resetCustomCssBtn.addEventListener('click', () => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (char) {
            customCssTextarea.value = '';
            useCustomCssCheckbox.checked = false;
            customCssTextarea.disabled = true;
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, '', true, theme);
            showToast('样式已重置为默认');
        }
    });
    
    document.getElementById('setting-char-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                document.getElementById('setting-char-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('头像压缩失败，请重试');
            }
        }
    });
    
    document.getElementById('setting-my-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                document.getElementById('setting-my-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('头像压缩失败，请重试');
            }
        }
    });
    
    document.getElementById('setting-chat-bg-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                try {
                    const compressedUrl = await compressImage(file, {
                        quality: 0.85,
                        maxWidth: 1080,
                        maxHeight: 1920
                    });
                    char.chatBg = compressedUrl;
                    chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                    await saveData();
                    showToast('聊天背景已更换');
                } catch (error) {
                    showToast('背景压缩失败，请重试');
                }
            }
        }
    });

    const resetChatBgBtn = document.getElementById('reset-chat-bg-btn');
    if (resetChatBgBtn) {
        resetChatBgBtn.addEventListener('click', async () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                char.chatBg = '';
                const chatRoomScreen = document.getElementById('chat-room-screen');
                if (chatRoomScreen) chatRoomScreen.style.backgroundImage = '';
                await saveData();
                showToast('聊天背景已恢复默认');
            }
        });
    }
    
    document.getElementById('clear-chat-history-btn').addEventListener('click', async () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        if (confirm(`你确定要清空与“${character.remarkName}”的所有聊天记录吗？这个操作是不可恢复的！`)) {
            character.history = [];
            character.status = '在线'; 
            await saveData();
            renderMessages(false, true);
            renderChatList();
            if (currentChatId === character.id) {
                document.getElementById('chat-room-status-text').textContent = '在线';
            }
            showToast('聊天记录已清空');
        }
    });
    
    document.getElementById('link-world-book-btn').addEventListener('click', () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        openWorldBookSelector(character.worldBookIds || []);
    });

    document.getElementById('link-group-world-book-btn').addEventListener('click', () => {
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        openWorldBookSelector(group.worldBookIds || []);
    });

    document.getElementById('save-world-book-selection-btn').addEventListener('click', async () => {
        const selectedIds = Array.from(tempSelectedWbIds);
        if (currentChatType === 'private') {
            const character = db.characters.find(c => c.id === currentChatId);
            if (character) character.worldBookIds = selectedIds;
            renderBoundWorldBooks('private', character.worldBookIds);
        } else if (currentChatType === 'group') {
            const group = db.groups.find(g => g.id === currentChatId);
            if (group) group.worldBookIds = selectedIds;
            renderBoundWorldBooks('group', group.worldBookIds);
        }
        await saveData();
        closeWorldBookSelector();
        showToast('世界书关联已更新');
    });

    const replyCountSwitch = document.getElementById('setting-reply-count-enabled');
    if (replyCountSwitch) {
        replyCountSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-reply-count-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    const stickerMatchSwitch = document.getElementById('setting-sticker-match-enabled');
    const stickerMatchPosition = document.getElementById('setting-sticker-match-position');
    const stickerMatchPositionContainer = document.getElementById('setting-sticker-match-position-container');
    const stickerMatchPositionValue = document.getElementById('setting-sticker-match-position-value');
    const stickerMatchPositionReset = document.getElementById('setting-sticker-match-position-reset');
    const STICKER_MATCH_POSITION_DEFAULT = 0;
    const updateStickerMatchPositionUI = (enabled, value) => {
        const position = Math.min(220, Math.max(-100, parseInt(value, 10) || STICKER_MATCH_POSITION_DEFAULT));
        if (stickerMatchPositionContainer) stickerMatchPositionContainer.style.display = enabled ? 'flex' : 'none';
        if (stickerMatchPosition) stickerMatchPosition.value = position;
        if (stickerMatchPositionValue) stickerMatchPositionValue.textContent = String(position);
    };
    const patSwitchEl = document.getElementById('setting-pat-enabled');
    if (patSwitchEl) {
        patSwitchEl.addEventListener('change', (ev) => {
            const c = document.getElementById('setting-pat-container');
            if (c) c.style.display = ev.target.checked ? 'flex' : 'none';
        });
    }
    if (stickerMatchSwitch) {
        stickerMatchSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            updateStickerMatchPositionUI(e.target.checked, stickerMatchPosition ? stickerMatchPosition.value : STICKER_MATCH_POSITION_DEFAULT);
        });
    }
    if (stickerMatchPosition) {
        stickerMatchPosition.addEventListener('input', (e) => {
            if (stickerMatchPositionValue) stickerMatchPositionValue.textContent = e.target.value;
            if (typeof window.refreshStickerMatchPopup === 'function') window.refreshStickerMatchPopup();
        });
    }
    if (stickerMatchPositionReset) {
        stickerMatchPositionReset.addEventListener('click', () => {
            triggerHapticFeedback('light');
            updateStickerMatchPositionUI(!!stickerMatchSwitch?.checked, STICKER_MATCH_POSITION_DEFAULT);
            if (typeof window.refreshStickerMatchPopup === 'function') window.refreshStickerMatchPopup();
        });
    }

    // 专属模型开关逻辑 (私聊)
    const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
    if (exclusiveApiSwitch) {
        exclusiveApiSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-exclusive-api-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // 专属模型开关逻辑 (群聊)
    const groupExclusiveApiSwitch = document.getElementById('setting-group-exclusive-api-enabled');
    if (groupExclusiveApiSwitch) {
        groupExclusiveApiSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-group-exclusive-api-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // --- Feature Control Center Logic ---
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        const featureId = card.dataset.feature;
        
        // Handle card click to toggle checkbox
        card.addEventListener('click', (e) => {
            // Prevent double toggling if clicking directly on the switch
            if (e.target.tagName !== 'INPUT' && !e.target.classList.contains('kkt-slider')) {
                checkbox.checked = !checkbox.checked;
                // Manually dispatch change event
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        // Handle checkbox change
        checkbox.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const isChecked = e.target.checked;
            
            // Update card visual state
            if (isChecked) {
                card.classList.add('is-on');
            } else {
                card.classList.remove('is-on');
            }

            // Handle specific feature panels
            if (featureId === 'status') {
                const panel = document.getElementById('status-panel-settings-container');
                if (panel) {
                    if (isChecked) {
                        panel.classList.add('open');
                    } else {
                        panel.classList.remove('open');
                    }
                }
            } else if (featureId === 'auto-reply') {
                const panel = document.getElementById('auto-reply-settings-container');
                if (panel) {
                    if (isChecked) {
                        panel.classList.add('open');
                    } else {
                        panel.classList.remove('open');
                    }
                }
            }
        });
    });
}

function renderBoundWorldBooks(type, worldBookIds) {
    const wrapperId = type === 'private' ? 'private-bound-worldbooks-wrapper' : 'group-bound-worldbooks-wrapper';
    const toggleId = type === 'private' ? 'private-bound-worldbooks-toggle' : 'group-bound-worldbooks-toggle';
    const containerId = type === 'private' ? 'private-bound-worldbooks-container' : 'group-bound-worldbooks-container';
    const listId = type === 'private' ? 'private-bound-worldbooks-list' : 'group-bound-worldbooks-list';
    const countId = type === 'private' ? 'private-bound-count' : 'group-bound-count';
    
    const wrapper = document.getElementById(wrapperId);
    const toggle = document.getElementById(toggleId);
    const container = document.getElementById(containerId);
    const list = document.getElementById(listId);
    const countSpan = document.getElementById(countId);
    
    if (!wrapper || !list) return;

    if (!worldBookIds || worldBookIds.length === 0) {
        wrapper.style.display = 'none';
        return;
    }

    wrapper.style.display = 'block';
    if (countSpan) countSpan.textContent = worldBookIds.length;
    list.innerHTML = '';

    // 绑定折叠/展开事件 (确保只绑定一次)
    if (toggle && !toggle.dataset.bound) {
        toggle.dataset.bound = 'true';
        toggle.addEventListener('click', () => {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
            const svg = toggle.querySelector('svg');
            if (svg) {
                svg.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });
    }

    worldBookIds.forEach(id => {
        const wb = db.worldBooks.find(b => b.id === id);
        if (wb) {
            const card = document.createElement('div');
            // 使用内联样式实现下划线、紧凑、灰色文字
            card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #666;';
            card.innerHTML = `
                <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${wb.name}</span>
                <button class="bound-wb-unbind-btn" data-id="${id}" style="background: none; border: none; color: #999; font-size: 12px; padding: 2px 6px; cursor: pointer;">解绑</button>
            `;
            
            card.querySelector('.bound-wb-unbind-btn').addEventListener('click', async (e) => {
                e.preventDefault();
                const targetId = e.target.dataset.id;
                if (type === 'private') {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (char) {
                        char.worldBookIds = char.worldBookIds.filter(i => i !== targetId);
                        renderBoundWorldBooks('private', char.worldBookIds);
                    }
                } else {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (group) {
                        group.worldBookIds = group.worldBookIds.filter(i => i !== targetId);
                        renderBoundWorldBooks('group', group.worldBookIds);
                    }
                }
                await saveData();
                showToast('已解绑世界书');
            });
            
            list.appendChild(card);
        }
    });
}

function loadSettingsToSidebar() {
    const e = db.characters.find(e => e.id === currentChatId);
    if (e) {
        document.getElementById('setting-char-avatar-preview').src = e.avatar;
        renderBoundWorldBooks('private', e.worldBookIds || []);
        const nameDisplay = document.getElementById('setting-char-name-display');
        if(nameDisplay) nameDisplay.textContent = e.remarkName;
        document.getElementById('setting-char-realname').value = e.realName || '';
        document.getElementById('setting-char-remark').value = e.remarkName;
        document.getElementById('setting-char-persona').value = e.persona;
        
        const stickerGroupsContainer = document.getElementById('setting-char-sticker-groups-container');
        stickerGroupsContainer.innerHTML = '';
        
        const allGroups = [...new Set(db.myStickers.map(s => s.group || '未分类'))].filter(g => g);
        const charGroups = (e.stickerGroups || '').split(/[,，]/).map(s => s.trim());

        if (allGroups.length === 0) {
            stickerGroupsContainer.innerHTML = '<span style="color:#999; font-size:12px;">暂无表情包分组，请先在表情包管理中添加。</span>';
        } else {
            allGroups.forEach(group => {
                const tag = document.createElement('div');
                tag.className = 'sticker-group-tag';
                if (charGroups.includes(group)) {
                    tag.classList.add('selected');
                }
                tag.textContent = group;
                tag.dataset.group = group;
                
                tag.addEventListener('click', () => {
                    tag.classList.toggle('selected');
                });
                
                stickerGroupsContainer.appendChild(tag);
            });
        }
        
        document.getElementById('setting-my-avatar-preview').src = e.myAvatar;
        document.getElementById('setting-my-name').value = e.myName;
        document.getElementById('setting-my-remark-name').value = e.myRemarkName || '';
        document.getElementById('setting-my-persona').value = e.myPersona;
        document.getElementById('setting-theme-color').value = e.theme || 'white_pink';
        document.getElementById('setting-max-memory').value = e.maxMemory;
        
        document.getElementById('setting-reply-count-enabled').checked = e.replyCountEnabled || false;
        const replyCountContainer = document.getElementById('setting-reply-count-container');
        if (replyCountContainer) {
            replyCountContainer.style.display = e.replyCountEnabled ? 'flex' : 'none';
        }
        document.getElementById('setting-reply-count-min').value = e.replyCountMin || 3;
        document.getElementById('setting-reply-count-max').value = e.replyCountMax || 8;

        const stickerMatchSwitch = document.getElementById('setting-sticker-match-enabled');
        const stickerMatchPosition = document.getElementById('setting-sticker-match-position');
        const stickerMatchPositionContainer = document.getElementById('setting-sticker-match-position-container');
        const stickerMatchPositionValue = document.getElementById('setting-sticker-match-position-value');
        const stickerMatchEnabled = e.stickerMatchEnabled || false;
        const stickerMatchPositionValueNum = Math.min(220, Math.max(-100, parseInt(e.stickerMatchPosition, 10) || 0));
        if (stickerMatchSwitch) stickerMatchSwitch.checked = stickerMatchEnabled;
        if (stickerMatchPosition) stickerMatchPosition.value = stickerMatchPositionValueNum;
        if (stickerMatchPositionContainer) stickerMatchPositionContainer.style.display = stickerMatchEnabled ? 'flex' : 'none';
        if (stickerMatchPositionValue) stickerMatchPositionValue.textContent = stickerMatchPositionValueNum;

        const patSwitch = document.getElementById('setting-pat-enabled');
        const patEnabled = !!e.patEnabled;
        if (patSwitch) patSwitch.checked = patEnabled;
        const patContainer = document.getElementById('setting-pat-container');
        if (patContainer) patContainer.style.display = patEnabled ? 'flex' : 'none';
        const patMy = document.getElementById('setting-pat-my-suffix');
        if (patMy) patMy.value = e.patMySuffix || '';
        const patChar = document.getElementById('setting-pat-char-suffix');
        if (patChar) patChar.value = (e.patCharSuffix === undefined) ? '的脑袋' : e.patCharSuffix;
        const patAi = document.getElementById('setting-pat-ai-suffix');
        if (patAi) patAi.checked = !!e.patAiSuffix;

        // 专属模型
        const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
        const exclusiveApiContainer = document.getElementById('setting-exclusive-api-container');
        const exclusiveApiPresetSelect = document.getElementById('setting-exclusive-api-preset-select');
        
        if (exclusiveApiSwitch && exclusiveApiContainer && exclusiveApiPresetSelect) {
            exclusiveApiSwitch.checked = e.exclusiveApiEnabled || false;
            exclusiveApiContainer.style.display = e.exclusiveApiEnabled ? 'flex' : 'none';
            
            // 填充预设列表
            exclusiveApiPresetSelect.innerHTML = '<option value="">请选择预设</option>';
            const presets = db.apiPresets || [];
            presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                exclusiveApiPresetSelect.appendChild(opt);
            });
            
            exclusiveApiPresetSelect.value = e.exclusiveApiPreset || '';
        }

        // 专属提示词版本
        const exclusivePromptVersionSelect = document.getElementById('setting-exclusive-prompt-version');
        if (exclusivePromptVersionSelect) {
            exclusivePromptVersionSelect.value = e.exclusivePromptVersion || '';
        }

        // 专属思维链预设
        const exclusiveCotPresetSelect = document.getElementById('setting-exclusive-cot-preset');
        if (exclusiveCotPresetSelect) {
            exclusiveCotPresetSelect.innerHTML = '<option value="">跟随全局</option>';
            if (db.cotPresets && db.cotPresets.length > 0) {
                db.cotPresets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    exclusiveCotPresetSelect.appendChild(opt);
                });
            }
            exclusiveCotPresetSelect.value = e.exclusiveCotPreset || '';
        }

        // 专属绘图提示词预设
        const exclusiveWorkshopPresetSelect = document.getElementById('setting-exclusive-workshop-preset');
        if (exclusiveWorkshopPresetSelect) {
            exclusiveWorkshopPresetSelect.innerHTML = '<option value="">跟随全局</option>';
            if (db.workshopPromptPresets && db.workshopPromptPresets.length > 0) {
                db.workshopPromptPresets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    exclusiveWorkshopPresetSelect.appendChild(opt);
                });
            }
            exclusiveWorkshopPresetSelect.value = e.exclusiveWorkshopPromptPreset || '';
        }

        document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;
        document.getElementById('setting-bilingual-style').value = e.bilingualBubbleStyle || 'under';
        // 「翻译显示样式」只有开启双语聊天模式时才有用，关闭时收起。
        const bilingualStyleContainer = document.getElementById('setting-bilingual-style-container');
        const bilingualModeSwitch = document.getElementById('setting-bilingual-mode');
        if (bilingualStyleContainer) {
            bilingualStyleContainer.style.display = bilingualModeSwitch.checked ? 'flex' : 'none';
            if (bilingualModeSwitch.dataset.styleToggleBound !== 'true') {
                bilingualModeSwitch.dataset.styleToggleBound = 'true';
                bilingualModeSwitch.addEventListener('change', () => {
                    bilingualStyleContainer.style.display = bilingualModeSwitch.checked ? 'flex' : 'none';
                });
            }
        }
        
        document.getElementById('setting-avatar-mode').value = e.avatarMode || 'full';
        const avatarRadius = e.avatarRadius !== undefined ? e.avatarRadius : 50;
        document.getElementById('setting-avatar-radius').value = avatarRadius;
        document.getElementById('setting-avatar-radius-value').textContent = `${avatarRadius}%`;
        
        const radiusSlider = document.getElementById('setting-avatar-radius');
        const radiusValue = document.getElementById('setting-avatar-radius-value');
        radiusSlider.oninput = () => {
            radiusValue.textContent = `${radiusSlider.value}%`;
        };

        document.getElementById('setting-bubble-blur').checked = e.bubbleBlurEnabled !== false; 

        document.getElementById('setting-title-layout').value = e.titleLayout || 'left';
        document.getElementById('setting-show-timestamp').checked = e.showTimestamp || false;
        document.getElementById('setting-timestamp-style').value = e.timestampStyle || 'bubble';
        document.getElementById('setting-show-status').checked = e.showStatus !== false;
        document.getElementById('setting-show-status-update-msg').checked = e.showStatusUpdateMsg || false;

        const sp = e.statusPanel || {};
        const statusCheckbox = document.getElementById('setting-status-panel-enabled');
        statusCheckbox.checked = sp.enabled || false;
        document.getElementById('setting-status-prompt-suffix').value = sp.promptSuffix || '';
        document.getElementById('setting-status-regex').value = sp.regexPattern || '';
        document.getElementById('setting-status-replace').value = sp.replacePattern || '';
        document.getElementById('setting-status-history-limit').value = sp.historyLimit !== undefined ? sp.historyLimit : 3;
        
        // Trigger change to update card UI and panel
        statusCheckbox.dispatchEvent(new Event('change'));

        const shopCheckbox = document.getElementById('setting-shop-interaction-enabled');
        shopCheckbox.checked = e.shopInteractionEnabled !== false;
        shopCheckbox.dispatchEvent(new Event('change'));

        const momentsCheckbox = document.getElementById('setting-moments-enabled');
        momentsCheckbox.checked = e.momentsEnabled !== false;
        momentsCheckbox.dispatchEvent(new Event('change'));

        const callCheckbox = document.getElementById('setting-video-call-enabled');
        callCheckbox.checked = e.videoCallEnabled || false;
        callCheckbox.dispatchEvent(new Event('change'));

        const ar = e.autoReply || {};
        const autoReplyCheckbox = document.getElementById('setting-auto-reply-enabled');
        autoReplyCheckbox.checked = ar.enabled || false;
        document.getElementById('setting-auto-reply-interval').value = ar.interval || 60;
        autoReplyCheckbox.dispatchEvent(new Event('change'));
        {
            const qh = ar.quietHours || {};
            const qhEnabled = document.getElementById('setting-quiet-hours-enabled');
            qhEnabled.checked = !!qh.enabled;
            document.getElementById('setting-quiet-hours-start').value = qh.start || '00:00';
            document.getElementById('setting-quiet-hours-end').value = qh.end || '08:00';
            const tzSel = document.getElementById('setting-quiet-hours-tz');
            const tzVal = qh.timezone || '';
            if (tzVal && !Array.from(tzSel.options).some(o => o.value === tzVal)) {
                tzSel.appendChild(new Option(tzVal, tzVal));
            }
            tzSel.value = tzVal;
            const qhDetail = document.getElementById('quiet-hours-detail');
            qhDetail.style.display = qhEnabled.checked ? '' : 'none';
            qhEnabled.onchange = () => { qhDetail.style.display = qhEnabled.checked ? '' : 'none'; };
        }

        const autoAirdropCheckbox = document.getElementById('setting-auto-airdrop-enabled');
        if (autoAirdropCheckbox) {
            autoAirdropCheckbox.checked = e.autoAirDropEnabled || false;
            autoAirdropCheckbox.dispatchEvent(new Event('change'));
        }

        const galleryCheckbox = document.getElementById('setting-use-real-gallery');
        galleryCheckbox.checked = e.useRealGallery || false;
        galleryCheckbox.dispatchEvent(new Event('change'));

        const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
            customCssTextarea = document.getElementById('setting-custom-bubble-css'),
            privatePreviewBox = document.getElementById('private-bubble-css-preview');
        useCustomCssCheckbox.checked = e.useCustomBubbleCss || false;
        customCssTextarea.value = e.customBubbleCss || '';
        customCssTextarea.disabled = !useCustomCssCheckbox.checked;
        const theme = colorThemes[e.theme || 'white_pink'];
        updateBubbleCssPreview(privatePreviewBox, e.customBubbleCss, !e.useCustomBubbleCss, theme);
        populateBubblePresetSelect('bubble-preset-select');
        populateMyPersonaSelect();
        if (typeof populateStatusBarPresetSelect === 'function') {
            populateStatusBarPresetSelect();
        }
    }
}

/**
 * 初始化文本框搜索替换工具栏
 * @param {string} toolbarId 工具栏容器 ID
 * @param {string} textareaId 目标文本框 ID
 */
function initTextareaSearchReplace(toolbarId, textareaId) {
    const toolbar = document.getElementById(toolbarId);
    const textarea = document.getElementById(textareaId);
    if (!toolbar || !textarea) return;

    const toggleBtn = toolbar.querySelector('.toolbar-toggle-btn');
    const mainBox = toolbar.querySelector('.toolbar-main-box');
    const searchInput = toolbar.querySelector('.toolbar-search-input');
    const matchCountSpan = toolbar.querySelector('.toolbar-match-count');
    const prevBtn = toolbar.querySelector('.toolbar-prev-btn');
    const nextBtn = toolbar.querySelector('.toolbar-next-btn');
    const expandReplaceBtn = toolbar.querySelector('.toolbar-expand-replace-btn');
    const replaceRow = toolbar.querySelector('.toolbar-replace-row');
    const replaceInput = toolbar.querySelector('.toolbar-replace-input');
    const replaceBtn = toolbar.querySelector('.toolbar-replace-btn');
    const replaceAllBtn = toolbar.querySelector('.toolbar-replace-all-btn');

    let matches = [];
    let currentMatchIndex = -1;

    // 只保留一个当前匹配项的高亮框。
    // 不再复制整份代码，因此不会出现重影、加粗或颜色变深的问题。
    const highlightWrap = document.createElement('div');
    highlightWrap.className = 'textarea-highlight-wrap';
    const currentHighlight = document.createElement('div');
    currentHighlight.className = 'textarea-current-match-highlight';
    highlightWrap.appendChild(currentHighlight);
    textarea.parentNode.insertBefore(highlightWrap, textarea);
    highlightWrap.appendChild(textarea);

    // 隐藏测量层：使用与 textarea 完全相同的字体、内距和换行规则，
    // 精确计算当前搜索结果在文本框里的位置。
    const measure = document.createElement('div');
    measure.className = 'textarea-search-measure';
    const measurePrefix = document.createElement('span');
    const measureHit = document.createElement('span');
    measure.appendChild(measurePrefix);
    measure.appendChild(measureHit);
    document.body.appendChild(measure);

    const syncMeasureStyle = () => {
        const cs = getComputedStyle(textarea);
        const props = [
            'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
            'letterSpacing', 'textTransform', 'textIndent', 'textAlign',
            'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap',
            'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'
        ];
        props.forEach(prop => {
            measure.style[prop] = cs[prop];
        });
        measure.style.width = `${textarea.clientWidth}px`;
        measure.style.minHeight = `${textarea.clientHeight}px`;
        measure.style.margin = '0';
        measure.style.border = '0';
    };

    function hideCurrentHighlight() {
        currentHighlight.style.display = 'none';
        highlightWrap.classList.remove('is-searching');
    }

    function updateCurrentHighlight() {
        const query = searchInput.value;
        if (!query || matches.length === 0 || currentMatchIndex < 0 || currentMatchIndex >= matches.length) {
            hideCurrentHighlight();
            return;
        }

        syncMeasureStyle();
        const content = textarea.value;
        const start = matches[currentMatchIndex];
        const end = start + query.length;

        measurePrefix.textContent = content.slice(0, start);
        measureHit.textContent = content.slice(start, end);

        // 强制浏览器完成测量。
        const measureRect = measure.getBoundingClientRect();
        const hitRect = measureHit.getBoundingClientRect();
        const textareaRect = textarea.getBoundingClientRect();
        const wrapRect = highlightWrap.getBoundingClientRect();

        const left = (hitRect.left - measureRect.left)
            + (textareaRect.left - wrapRect.left)
            - textarea.scrollLeft;
        const top = (hitRect.top - measureRect.top)
            + (textareaRect.top - wrapRect.top)
            - textarea.scrollTop;

        currentHighlight.style.left = `${left}px`;
        currentHighlight.style.top = `${top}px`;
        currentHighlight.style.width = `${Math.max(hitRect.width, 2)}px`;
        currentHighlight.style.height = `${Math.max(hitRect.height, parseFloat(getComputedStyle(textarea).lineHeight) || 20)}px`;
        currentHighlight.style.display = 'block';
        highlightWrap.classList.add('is-searching');
    }

    textarea.addEventListener('scroll', updateCurrentHighlight);
    window.addEventListener('resize', updateCurrentHighlight);

    // 1. 折叠/展开逻辑
    toggleBtn.addEventListener('click', () => {
        const isHidden = mainBox.style.display === 'none';
        mainBox.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            searchInput.focus();
            performSearch();
        } else {
            hideCurrentHighlight();
        }
    });

    expandReplaceBtn.addEventListener('click', () => {
        const isHidden = replaceRow.style.display === 'none';
        replaceRow.style.display = isHidden ? 'flex' : 'none';
        expandReplaceBtn.classList.toggle('open', isHidden);
        if (isHidden) replaceInput.focus();
    });

    // 2. 搜索逻辑
    function performSearch() {
        const query = searchInput.value;
        const content = textarea.value;
        matches = [];
        currentMatchIndex = -1;

        if (query) {
            let pos = content.indexOf(query);
            while (pos !== -1) {
                matches.push(pos);
                pos = content.indexOf(query, pos + 1);
            }
        }

        if (matches.length > 0) {
            currentMatchIndex = 0;
            matchCountSpan.textContent = `1/${matches.length}`;
            revealCurrentMatch(false);
        } else {
            matchCountSpan.textContent = '0/0';
            hideCurrentHighlight();
        }
    }

    function updateUI() {
        if (matches.length > 0) {
            if (currentMatchIndex === -1) currentMatchIndex = 0;
            matchCountSpan.textContent = `${currentMatchIndex + 1}/${matches.length}`;
            updateCurrentHighlight();
        } else {
            matchCountSpan.textContent = '0/0';
            hideCurrentHighlight();
        }
    }

    function revealCurrentMatch(shouldFocus = true) {
        if (currentMatchIndex < 0 || currentMatchIndex >= matches.length) return;

        const start = matches[currentMatchIndex];
        const end = start + searchInput.value.length;

        // 不再调用 focus / setSelectionRange。
        // 当前结果只显示自定义浅蓝色高亮，不产生原生文字选取，
        // 这样切换上一個/下一個时不会弹出输入键盘，也不会出现原生选区。

        // 用测量层得到当前结果所在的实际行数，再把它滚到可见区域。
        syncMeasureStyle();
        measurePrefix.textContent = textarea.value.slice(0, start);
        measureHit.textContent = textarea.value.slice(start, end);
        const measureRect = measure.getBoundingClientRect();
        const hitRect = measureHit.getBoundingClientRect();
        const hitTop = hitRect.top - measureRect.top;
        const hitHeight = Math.max(hitRect.height, parseFloat(getComputedStyle(textarea).lineHeight) || 20);
        const targetTop = Math.max(0, hitTop - textarea.clientHeight / 2 + hitHeight / 2);
        textarea.scrollTop = targetTop;

        updateUI();
    }

    searchInput.addEventListener('input', performSearch);

    prevBtn.addEventListener('click', () => {
        if (matches.length === 0) return;
        currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
        revealCurrentMatch(true);
    });

    nextBtn.addEventListener('click', () => {
        if (matches.length === 0) return;
        currentMatchIndex = (currentMatchIndex + 1) % matches.length;
        revealCurrentMatch(true);
    });

    // 3. 替换逻辑
    replaceBtn.addEventListener('click', () => {
        if (currentMatchIndex === -1 || matches.length === 0) return;

        const query = searchInput.value;
        const replacement = replaceInput.value;
        const start = matches[currentMatchIndex];
        const end = start + query.length;

        const content = textarea.value;
        textarea.value = content.substring(0, start) + replacement + content.substring(end);

        // 触发 input 事件以更新预览
        textarea.dispatchEvent(new Event('input'));

        performSearch();
        if (matches.length > 0) {
            currentMatchIndex = Math.min(currentMatchIndex, matches.length - 1);
            revealCurrentMatch(true);
        }
        triggerHapticFeedback('light');
    });

    replaceAllBtn.addEventListener('click', () => {
        const query = searchInput.value;
        if (!query) return;

        const replacement = replaceInput.value;
        const content = textarea.value;
        const newContent = content.split(query).join(replacement);

        if (content === newContent) {
            showToast('未找到匹配内容');
            return;
        }

        textarea.value = newContent;
        textarea.dispatchEvent(new Event('input'));
        performSearch();
        showToast('全部替换完成');
        triggerHapticFeedback('medium');
    });

    // 监听文本框手动修改
    textarea.addEventListener('input', () => {
        if (mainBox.style.display !== 'none') {
            performSearch();
        }
    });
}

async function saveSettingsFromSidebar() {
    const e = db.characters.find(e => e.id === currentChatId);
    if (e) {
        e.avatar = document.getElementById('setting-char-avatar-preview').src;
        
        const oldRealName = e.realName;
        const newRealName = document.getElementById('setting-char-realname').value.trim();
        
        if (oldRealName && newRealName && oldRealName !== newRealName) {
            // 清洗历史记录中的旧真名
            const nameRegex = new RegExp(oldRealName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (e.history && e.history.length > 0) {
                e.history.forEach(msg => {
                    if (msg.content) {
                        msg.content = msg.content.replace(nameRegex, newRealName);
                    }
                });
            }
            e.realName = newRealName;
            showToast(`真名已从“${oldRealName}”修改为“${newRealName}”，历史记录已同步清洗`);
        } else if (newRealName) {
            e.realName = newRealName;
        }

        e.remarkName = document.getElementById('setting-char-remark').value;
        e.persona = document.getElementById('setting-char-persona').value;
        
        const selectedGroups = Array.from(document.querySelectorAll('#setting-char-sticker-groups-container .sticker-group-tag.selected'))
            .map(tag => tag.dataset.group)
            .join(',');
        e.stickerGroups = selectedGroups;

        e.myAvatar = document.getElementById('setting-my-avatar-preview').src;
        e.myName = document.getElementById('setting-my-name').value;
        e.myRemarkName = document.getElementById('setting-my-remark-name').value.trim();
        e.myPersona = document.getElementById('setting-my-persona').value;
        e.theme = document.getElementById('setting-theme-color').value;
        e.maxMemory = document.getElementById('setting-max-memory').value;
        e.replyCountEnabled = document.getElementById('setting-reply-count-enabled').checked;
        e.replyCountMin = parseInt(document.getElementById('setting-reply-count-min').value, 10) || 3;
        e.replyCountMax = parseInt(document.getElementById('setting-reply-count-max').value, 10) || 8;
        e.stickerMatchEnabled = document.getElementById('setting-sticker-match-enabled')?.checked || false;
        e.stickerMatchPosition = Math.min(220, Math.max(-100, parseInt(document.getElementById('setting-sticker-match-position')?.value, 10) || 0));
        e.patEnabled = document.getElementById('setting-pat-enabled')?.checked || false;
        e.patMySuffix = (document.getElementById('setting-pat-my-suffix')?.value || '').trim().slice(0, 20);
        e.patCharSuffix = (document.getElementById('setting-pat-char-suffix')?.value || '').trim().slice(0, 20);
        e.patAiSuffix = document.getElementById('setting-pat-ai-suffix')?.checked || false;
        
        const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
        if (exclusiveApiSwitch) {
            e.exclusiveApiEnabled = exclusiveApiSwitch.checked;
            e.exclusiveApiPreset = document.getElementById('setting-exclusive-api-preset-select').value;
        }

        const exclusivePromptVersionSelect = document.getElementById('setting-exclusive-prompt-version');
        if (exclusivePromptVersionSelect) {
            e.exclusivePromptVersion = exclusivePromptVersionSelect.value;
        }

        const exclusiveCotPresetSelect = document.getElementById('setting-exclusive-cot-preset');
        if (exclusiveCotPresetSelect) {
            e.exclusiveCotPreset = exclusiveCotPresetSelect.value;
        }

        const exclusiveWorkshopPresetSelect = document.getElementById('setting-exclusive-workshop-preset');
        if (exclusiveWorkshopPresetSelect) {
            e.exclusiveWorkshopPromptPreset = exclusiveWorkshopPresetSelect.value;
        }

        e.useCustomBubbleCss = document.getElementById('setting-use-custom-css').checked;
        e.customBubbleCss = document.getElementById('setting-custom-bubble-css').value;
        e.bilingualModeEnabled = document.getElementById('setting-bilingual-mode').checked;
        e.bilingualBubbleStyle = document.getElementById('setting-bilingual-style').value;
        
        e.avatarMode = document.getElementById('setting-avatar-mode').value;
        e.avatarRadius = parseInt(document.getElementById('setting-avatar-radius').value, 10);

        e.bubbleBlurEnabled = document.getElementById('setting-bubble-blur').checked;
        const chatScreen = document.getElementById('chat-room-screen');
        if (e.bubbleBlurEnabled) {
            chatScreen.classList.remove('disable-blur');
        } else {
            chatScreen.classList.add('disable-blur');
        }

        e.titleLayout = document.getElementById('setting-title-layout').value;
        const header = document.getElementById('chat-room-header-default');
        if (e.titleLayout === 'center') {
            header.classList.add('title-centered');
        } else {
            header.classList.remove('title-centered');
        }

        e.showTimestamp = document.getElementById('setting-show-timestamp').checked;
        
        if (e.showTimestamp) {
            chatScreen.classList.add('show-timestamp');
        } else {
            chatScreen.classList.remove('show-timestamp');
        }
        chatScreen.classList.remove('timestamp-side');

        e.timestampStyle = document.getElementById('setting-timestamp-style').value;
        chatScreen.classList.remove('timestamp-style-bubble', 'timestamp-style-avatar');
        chatScreen.classList.add(`timestamp-style-${e.timestampStyle || 'bubble'}`);

        e.showStatus = document.getElementById('setting-show-status').checked;
        const subtitle = document.getElementById('chat-room-subtitle');
        if (subtitle) {
            subtitle.style.display = e.showStatus ? 'flex' : 'none';
        }

        e.showStatusUpdateMsg = document.getElementById('setting-show-status-update-msg').checked;

        if (!e.statusPanel) e.statusPanel = {};
        e.statusPanel.enabled = document.getElementById('setting-status-panel-enabled').checked;
        e.statusPanel.promptSuffix = document.getElementById('setting-status-prompt-suffix').value;
        e.statusPanel.regexPattern = document.getElementById('setting-status-regex').value;
        e.statusPanel.replacePattern = document.getElementById('setting-status-replace').value;
        const historyLimitInput = parseInt(document.getElementById('setting-status-history-limit').value, 10);
        e.statusPanel.historyLimit = isNaN(historyLimitInput) ? 3 : historyLimitInput;

        e.shopInteractionEnabled = document.getElementById('setting-shop-interaction-enabled').checked;

        e.momentsEnabled = document.getElementById('setting-moments-enabled').checked;

        e.videoCallEnabled = document.getElementById('setting-video-call-enabled').checked;

        const previousAutoReplyEnabled = !!(e.autoReply && e.autoReply.enabled);
        const previousAutoReplyInterval = Number((e.autoReply && e.autoReply.interval) || 60);
        if (!e.autoReply) e.autoReply = {};
        e.autoReply.enabled = document.getElementById('setting-auto-reply-enabled').checked;
        const autoReplyIntervalInput = parseInt(document.getElementById('setting-auto-reply-interval').value, 10);
        e.autoReply.interval = isNaN(autoReplyIntervalInput) ? 60 : autoReplyIntervalInput;
        const previousQuietHours = JSON.stringify(e.autoReply.quietHours || null);
        e.autoReply.quietHours = {
            enabled: document.getElementById('setting-quiet-hours-enabled').checked,
            start: document.getElementById('setting-quiet-hours-start').value || '00:00',
            end: document.getElementById('setting-quiet-hours-end').value || '08:00',
            timezone: document.getElementById('setting-quiet-hours-tz').value || ''
        };
        const autoReplyChanged = previousAutoReplyEnabled !== !!e.autoReply.enabled
            || previousAutoReplyInterval !== Number(e.autoReply.interval || 60)
            || previousQuietHours !== JSON.stringify(e.autoReply.quietHours);

        const autoAirdropCheckbox = document.getElementById('setting-auto-airdrop-enabled');
        if (autoAirdropCheckbox) {
            e.autoAirDropEnabled = autoAirdropCheckbox.checked;
        }

        e.useRealGallery = document.getElementById('setting-use-real-gallery').checked;

        await saveData();
        showToast('设置已保存！');
        // 开了 Cloudflare 后台时，自动消息的开关/间隔要马上同步到 Worker，
        // 否则 Worker 会按旧设置继续发主动消息。
        if (autoReplyChanged && window.UwUBackendAdapter?.isCloudflareEnabled?.()) {
            try {
                await window.UwUBackendAdapter.syncAutoReplySettings(e);
            } catch (syncError) {
                showToast(`自动消息设置未能同步到云端：${syncError.message}。下次打开 UwU 会自动重试。`);
            }
        }
        chatRoomTitle.textContent = e.remarkName;
        renderChatList();
        // updateCustomBubbleStyle(currentChatId, e.customBubbleCss, e.useCustomBubbleCss); // 移除实时应用以防污染设置页
        currentPage = 1;
        renderMessages(false, true);
    }
}

// 备份提示
function promptForBackupIfNeeded(triggerType) {
    if (triggerType === 'history_milestone') {
        showToast('uwu提醒您：记得备份噢');
    }
}

// 重新计算并更新角色状态
function recalculateChatStatus(chat) {
    if (!chat || !chat.history) return;
    
    // 仅针对私聊且非群聊
    // 注意：虽然函数参数叫 chat，但在调用处需确保是 private 类型或者在这里判断
    // 由于群聊没有状态栏，这里主要针对 private
    // 但为了通用性，我们可以检查 chat.realName 是否存在
    
    if (!chat.realName) return; // 简单判断，群聊通常没有单人的 realName 用于状态更新（群聊逻辑不同）

    const updateStatusRegex = new RegExp(`\\[${chat.realName}更新状态为：(.*?)\\]`);
    let foundStatus = '在线'; // 默认状态

    // 倒序遍历历史记录
    for (let i = chat.history.length - 1; i >= 0; i--) {
        const msg = chat.history[i];
        // 忽略被撤回的消息
        if (msg.isWithdrawn) continue;

        const match = msg.content.match(updateStatusRegex);
        if (match) {
            foundStatus = match[1];
            break; // 找到最近的一个状态，停止遍历
        }
    }

    // 更新状态
    chat.status = foundStatus;
    
    // 如果当前正在该聊天室，实时更新 UI
    if (currentChatId === chat.id) {
        const statusTextEl = document.getElementById('chat-room-status-text');
        if (statusTextEl) {
            statusTextEl.textContent = foundStatus;
        }
    }
}
