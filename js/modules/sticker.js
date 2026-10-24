// --- 表情包管理 (js/modules/sticker.js) ---

async function setupStickerSystem() {
    const stickerMenuBtn = document.getElementById('sticker-menu-btn');
    const stickerMenuActionSheet = document.getElementById('sticker-menu-actionsheet');
    const stickerCategoryBar = document.getElementById('sticker-category-bar');
    
    const menuMultiSelectBtn = document.getElementById('menu-multi-select-btn');
    const menuBatchImportBtn = document.getElementById('menu-batch-import-btn');
    const menuAddNewBtn = document.getElementById('menu-add-new-btn');
    const menuCancelBtn = document.getElementById('menu-cancel-btn');

    const deleteSelectedStickersBtn = document.getElementById('delete-selected-stickers-btn');
    const moveStickerGroupBtn = document.getElementById('move-sticker-group-btn');
    const stickerManageBar = document.getElementById('sticker-manage-bar');
    const selectAllStickersBtn = document.getElementById('select-all-stickers-btn');

    const moveStickerModal = document.getElementById('move-sticker-modal');
    const moveTargetGroupInput = document.getElementById('move-target-group-input');
    const confirmMoveStickerBtn = document.getElementById('confirm-move-sticker-btn');
    const cancelMoveStickerBtn = document.getElementById('cancel-move-sticker-btn');
    const existingGroupsList = document.getElementById('existing-groups-list');

    const batchAddStickerModal = document.getElementById('batch-add-sticker-modal');
    const batchAddStickerForm = document.getElementById('batch-add-sticker-form');
    const stickerUrlsTextarea = document.getElementById('sticker-urls-textarea');
    const batchStickerGroupInput = document.getElementById('batch-sticker-group');
    const stickerBatchFileInput = document.getElementById('sticker-batch-file');
    const exportStickerTxtBtn = document.getElementById('export-sticker-txt-btn');
    const addStickerModal = document.getElementById('add-sticker-modal');
    const addStickerForm = document.getElementById('add-sticker-form');
    const stickerNameInput = document.getElementById('sticker-name');
    const stickerGroupInput = document.getElementById('sticker-group');
    const stickerEditIdInput = document.getElementById('sticker-edit-id');
    const stickerPreview = document.getElementById('sticker-preview');
    const stickerUrlInput = document.getElementById('sticker-url-input');
    const stickerFileUpload = document.getElementById('sticker-file-upload');
    const addStickerModalTitle = document.getElementById('add-sticker-modal-title');

    stickerMenuBtn.addEventListener('click', () => {
        if (isStickerManageMode) {
            exitStickerManageMode();
        } else {
            stickerMenuActionSheet.classList.add('visible');
        }
    });

    menuCancelBtn.addEventListener('click', () => stickerMenuActionSheet.classList.remove('visible'));

    menuMultiSelectBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        enterStickerManageMode();
    });

    function enterStickerManageMode() {
        isStickerManageMode = true;
        stickerManageBar.style.display = 'block';
        
        stickerMenuBtn.innerHTML = '<span style="font-size:14px; font-weight:bold; color:var(--primary-color);">完成</span>';
        selectedStickerIds.clear();
        updateStickerSelectCount();
        renderStickerGrid(); 
    }

    function exitStickerManageMode() {
        isStickerManageMode = false;
        stickerManageBar.style.display = 'none';
        
        stickerMenuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" /></svg>';
        selectedStickerIds.clear();
        renderStickerGrid();
    }

    function updateStickerSelectCount() {
        const count = selectedStickerIds.size;
        document.getElementById('sticker-select-count').textContent = `已选 ${count} 项`;
        deleteSelectedStickersBtn.disabled = count === 0;
        moveStickerGroupBtn.disabled = count === 0;
    }

    menuBatchImportBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        batchAddStickerModal.classList.add('visible');
        stickerUrlsTextarea.value = '';
        batchStickerGroupInput.value = '';
    });

    menuAddNewBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        addStickerModalTitle.textContent = '添加新表情';
        addStickerForm.reset();
        stickerEditIdInput.value = '';
        stickerPreview.innerHTML = '<span>预览</span>';
        stickerUrlInput.disabled = false;
        addStickerModal.classList.add('visible');
    });

    selectAllStickersBtn.addEventListener('click', () => {
        let stickersToSelect = [];
        
        if (currentStickerCategory === 'recent') {
            stickersToSelect = [...db.myStickers]
                .sort((a, b) => (b.lastUsedTime || 0) - (a.lastUsedTime || 0))
                .slice(0, 20);
        } else if (currentStickerCategory === 'all') {
            stickersToSelect = [...db.myStickers];
        } else if (currentStickerCategory === 'ungrouped') {
            stickersToSelect = db.myStickers.filter(s => !s.group);
        } else {
            stickersToSelect = db.myStickers.filter(s => s.group === currentStickerCategory);
        }

        stickersToSelect.forEach(s => selectedStickerIds.add(s.id));
        
        updateStickerSelectCount();
        renderStickerGrid();
        showToast(`已全选当前分组 ${stickersToSelect.length} 个表情`);
    });

    deleteSelectedStickersBtn.addEventListener('click', async () => {
        if (selectedStickerIds.size === 0) return;
        if (confirm(`确定要删除这 ${selectedStickerIds.size} 个表情吗？`)) {
            const idsToDelete = Array.from(selectedStickerIds);

            await dexieDB.myStickers.bulkDelete(idsToDelete);

            db.myStickers = db.myStickers.filter(s => !selectedStickerIds.has(s.id));
            
            await saveData();
            
            showToast('表情已彻底删除');
            exitStickerManageMode();
        }
    });

    moveStickerGroupBtn.addEventListener('click', () => {
        existingGroupsList.innerHTML = '';
        const groups = [...new Set(db.myStickers.map(s => s.group).filter(g => g))];
        groups.forEach(g => {
            const option = document.createElement('option');
            option.value = g;
            existingGroupsList.appendChild(option);
        });
        
        moveTargetGroupInput.value = '';
        moveStickerModal.classList.add('visible');
    });

    cancelMoveStickerBtn.addEventListener('click', () => moveStickerModal.classList.remove('visible'));

    confirmMoveStickerBtn.addEventListener('click', async () => {
        const newGroup = moveTargetGroupInput.value.trim();
        
        db.myStickers.forEach(s => {
            if (selectedStickerIds.has(s.id)) {
                s.group = newGroup;
            }
        });
        
        await saveData();
        showToast('分组已更新');
        moveStickerModal.classList.remove('visible');
        exitStickerManageMode();
        renderStickerCategories(); 
        renderStickerGrid();
    });

    stickerCategoryBar.addEventListener('click', (e) => {
        const item = e.target.closest('.sticker-category-item');
        if (item) {
            currentStickerCategory = item.dataset.category;
            renderStickerCategories(); 
            renderStickerGrid(); 
        }
    });

    // 管理模式下长按分组名称可直接重命名。
    let categoryLongPressTimer = null;
    let categoryLongPressTriggered = false;
    const startCategoryLongPress = (e) => {
        const item = e.target.closest('.sticker-category-item');
        if (!item || !isStickerManageMode) return;
        const category = item.dataset.category;
        if (['recent', 'all', 'ungrouped'].includes(category)) return;

        categoryLongPressTriggered = false;
        clearTimeout(categoryLongPressTimer);
        categoryLongPressTimer = setTimeout(async () => {
            categoryLongPressTriggered = true;
            const oldName = category;
            const newName = prompt('修改分组名称', oldName);
            if (newName === null) return;
            const trimmedName = newName.trim();
            if (!trimmedName || trimmedName === oldName) return;
            if (db.myStickers.some(s => s.group === trimmedName)) {
                showToast('该分组名称已存在');
                return;
            }

            db.myStickers.forEach(sticker => {
                if (sticker.group === oldName) sticker.group = trimmedName;
            });
            if (currentStickerCategory === oldName) currentStickerCategory = trimmedName;
            await saveData();
            renderStickerCategories();
            renderStickerGrid();
            showToast('分组名称已修改');
        }, 600);
    };
    const cancelCategoryLongPress = () => {
        clearTimeout(categoryLongPressTimer);
        categoryLongPressTimer = null;
    };
    stickerCategoryBar.addEventListener('pointerdown', startCategoryLongPress);
    stickerCategoryBar.addEventListener('pointerup', cancelCategoryLongPress);
    stickerCategoryBar.addEventListener('pointerleave', cancelCategoryLongPress);
    stickerCategoryBar.addEventListener('pointercancel', cancelCategoryLongPress);
    stickerCategoryBar.addEventListener('click', (e) => {
        if (categoryLongPressTriggered) {
            categoryLongPressTriggered = false;
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    batchAddStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textInput = stickerUrlsTextarea.value.trim();
        const groupName = batchStickerGroupInput.value.trim();
        if (!textInput) return showToast('请输入数据');
        const lines = textInput.split('\n');
        const newStickers = [];
        for (const line of lines) {
            let trimmedLine = line.trim().replace('：', ':');
            if (!trimmedLine) continue;
            const colonIndex = trimmedLine.indexOf(':');
            if (colonIndex <= 0) continue;
            const name = trimmedLine.substring(0, colonIndex).trim();
            const url = trimmedLine.substring(colonIndex + 1).trim();
            if (name && url.startsWith('http')) {
                newStickers.push({
                    id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: name,
                    data: url,
                    group: groupName,
                    lastUsedTime: Date.now() 
                });
            }
        }
        if (newStickers.length > 0) {
            db.myStickers.push(...newStickers);
            await saveData();
            batchAddStickerModal.classList.remove('visible');
            showToast(`导入 ${newStickers.length} 个表情`);
            renderStickerCategories();
            renderStickerGrid();
        } else {
            showToast('格式错误');
        }
    });

    addStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = stickerNameInput.value.trim();
        const group = stickerGroupInput.value.trim();
        const id = stickerEditIdInput.value;
        const previewImg = stickerPreview.querySelector('img');
        const data = previewImg ? previewImg.src : null;
        if (!name || !data) return showToast('请填写完整');
        
        const stickerData = { name, data, group, lastUsedTime: Date.now() };
        
        if (id) {
            const index = db.myStickers.findIndex(s => s.id === id);
            if (index > -1) db.myStickers[index] = { ...db.myStickers[index], ...stickerData };
        } else {
            stickerData.id = `sticker_${Date.now()}`;
            db.myStickers.push(stickerData);
        }
        await saveData();
        addStickerModal.classList.remove('visible');
        showToast('保存成功');
        renderStickerCategories();
        renderStickerGrid();
    });
    
    stickerUrlInput.addEventListener('input', (e) => {
        stickerPreview.innerHTML = `<img src="${e.target.value}" alt="预览">`;
        stickerFileUpload.value = '';
    });
    stickerFileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 200, maxHeight: 200});
                stickerPreview.innerHTML = `<img src="${compressedUrl}" alt="预览">`;
                stickerUrlInput.value = '';
                stickerUrlInput.disabled = true;
            } catch (error) {
                showToast('压缩失败');
            }
        }
    });

    // 从 TXT / Word 批量导入：读取文件内容，整理成“名称:URL”逐行格式，
    // 并自动使用文件名作为本批次分组名称。
    if (stickerBatchFileInput) {
        stickerBatchFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                let rawText = '';
                if (/\.docx$/i.test(file.name)) {
                    if (typeof mammoth === 'undefined') {
                        throw new Error('Word 解析库未加载');
                    }
                    const buffer = await file.arrayBuffer();
                    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
                    rawText = result.value || '';
                } else {
                    rawText = await file.text();
                }

                const normalizedLines = rawText
                    .replace(/\r\n?/g, '\n')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                        const colonIndex = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('：');
                        if (colonIndex <= 0) return null;
                        const name = line.substring(0, colonIndex).trim();
                        const url = line.substring(colonIndex + 1).trim();
                        if (!name || !/^https?:\/\//i.test(url)) return null;
                        return `${name}:${url}`;
                    })
                    .filter(Boolean);

                stickerUrlsTextarea.value = normalizedLines.join('\n');
                const groupName = file.name.replace(/\.(txt|docx)$/i, '').trim();
                batchStickerGroupInput.value = groupName;

                if (!normalizedLines.length) {
                    showToast('文件中没有找到有效的“名称:URL”数据');
                } else {
                    showToast(`已读取 ${normalizedLines.length} 条表情数据`);
                }
            } catch (error) {
                console.error('批量导入文件失败:', error);
                showToast('文件读取失败，请使用 TXT 或 DOCX 文件');
            } finally {
                e.target.value = '';
            }
        });
    }

    // 导出当前管理分组为 TXT，仅保留“描述:URL”。
    if (exportStickerTxtBtn) {
        exportStickerTxtBtn.addEventListener('click', () => {
            let stickers = [];
            let fileName = '表情包';

            if (currentStickerCategory === 'recent') {
                stickers = [...db.myStickers]
                    .sort((a, b) => (b.lastUsedTime || 0) - (a.lastUsedTime || 0))
                    .slice(0, 20);
                fileName = '最近使用表情包';
            } else if (currentStickerCategory === 'all') {
                stickers = [...db.myStickers];
                fileName = '全部表情包';
            } else if (currentStickerCategory === 'ungrouped') {
                stickers = db.myStickers.filter(s => !s.group);
                fileName = '未分类表情包';
            } else {
                stickers = db.myStickers.filter(s => s.group === currentStickerCategory);
                fileName = currentStickerCategory || '表情包';
            }

            const lines = stickers
                .filter(s => s && s.name && s.data)
                .map(s => `${s.name}:${s.data}`);

            if (!lines.length) {
                showToast('当前分组没有可导出的表情');
                return;
            }

            const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileName}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showToast(`已导出 ${lines.length} 个表情`);
        });
    }

    const stickerToggleBtn = document.getElementById('sticker-toggle-btn');
    setupStickerMatchInput();

    stickerToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const msgInput = document.getElementById('message-input');
        const isKeyboardOpen = (document.activeElement === msgInput);
        
        if (msgInput) msgInput.blur(); // 强制收起键盘

        if (isKeyboardOpen) {
             // 键盘 -> 面板：无动画
             showPanel('sticker', true);
        } else {
            if (chatExpansionPanel.classList.contains('visible') && panelStickerArea.style.display !== 'none') {
                showPanel('none'); // 面板 -> 关闭：默认有动画
            } else {
                // 关闭 -> 面板 或 面板(功能) -> 面板(表情)：默认有动画
                showPanel('sticker');
            }
        }
    });
}

function setupStickerMatchInput() {
    const input = document.getElementById('message-input');
    const popup = document.getElementById('sticker-match-popup');
    const list = document.getElementById('sticker-match-list');
    if (!input || !popup || !list) return;

    const normalize = (value) => String(value || '')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[「」『』【】\[\]()（）{}]/g, '');

    const hide = () => {
        popup.classList.remove('visible');
        popup.setAttribute('aria-hidden', 'true');
    };

    const getCurrentChat = () => {
        if (!currentChatId) return null;
        return currentChatType === 'private'
            ? db.characters.find(c => c.id === currentChatId)
            : db.groups.find(g => g.id === currentChatId);
    };

    const renderMatches = () => {
        const chat = getCurrentChat();
        if (!chat || !chat.stickerMatchEnabled) {
            hide();
            return;
        }

        const raw = input.value.trim();
        const query = normalize(raw);
        if (!query || !Array.isArray(db.myStickers) || db.myStickers.length === 0) {
            hide();
            return;
        }

        const matches = db.myStickers
            .map(sticker => {
                const name = normalize(sticker.name);
                if (!name) return null;
                let score = 0;
                if (name === query) score = 100;
                else if (name.startsWith(query)) score = 80;
                else if (name.includes(query)) score = 60;
                else if (query.includes(name)) score = 50;
                else return null;
                return { sticker, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || String(a.sticker.name).localeCompare(String(b.sticker.name), 'zh-CN'))
            .slice(0, 8)
            .map(item => item.sticker);

        if (!matches.length) {
            hide();
            return;
        }

        list.innerHTML = '';
        matches.forEach(sticker => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'sticker-match-item';
            item.innerHTML = `<img src="${sticker.data}" alt=""><span>${sticker.name}</span>`;
            item.addEventListener('mousedown', (e) => e.preventDefault());
            item.addEventListener('click', async () => {
                await sendSticker(sticker);
                input.value = '';
                hide();
            });
            list.appendChild(item);
        });

        // 这里调节的是弹窗的上下位置，不是弹窗本身的大小。
        // 正数向上移动，负数向下移动；默认值为 0。
        const positionSource = document.getElementById('setting-sticker-match-position');
        const position = Math.min(220, Math.max(-100, parseInt(positionSource?.value, 10) || parseInt(chat.stickerMatchPosition, 10) || 0));
        popup.style.bottom = `calc(100% + ${position}px)`;
        popup.classList.add('visible');
        popup.setAttribute('aria-hidden', 'false');
    };

    input.addEventListener('input', renderMatches);
    input.addEventListener('focus', () => {
        if (input.value.trim()) renderMatches();
    });
    input.addEventListener('blur', () => {
        setTimeout(hide, 160);
    });

    // 切换聊天后，输入框内容或设置可能发生变化。
    document.addEventListener('chat-screen-updated', renderMatches);
    window.refreshStickerMatchPopup = renderMatches;
}

function renderStickerCategories() {
    const bar = document.getElementById('sticker-category-bar');
    bar.innerHTML = '';

    const groups = [...new Set(db.myStickers.map(s => s.group).filter(g => g))];
    
    const categories = [
        { id: 'recent', name: '最近使用' },
        { id: 'all', name: '全部' },
        ...groups.map(g => ({ id: g, name: g })),
        { id: 'ungrouped', name: '未分类' }
    ];

    categories.forEach(cat => {
        const item = document.createElement('div');
        item.className = `sticker-category-item ${currentStickerCategory === cat.id ? 'active' : ''}`;
        item.textContent = cat.name;
        item.dataset.category = cat.id;
        bar.appendChild(item);
    });
}

function renderStickerGrid() {
    const container = document.getElementById('sticker-grid-container');
    container.innerHTML = '';

    let stickersToShow = [];

    if (currentStickerCategory === 'recent') {
        stickersToShow = [...db.myStickers]
            .sort((a, b) => (b.lastUsedTime || 0) - (a.lastUsedTime || 0))
            .slice(0, 20);
        if (stickersToShow.length === 0) {
            container.innerHTML = '<p style="color:#aaa; text-align:center; grid-column:1/-1; padding:20px;">还没有使用过表情包哦</p>';
            return;
        }
    } else if (currentStickerCategory === 'all') {
        stickersToShow = [...db.myStickers];
    } else if (currentStickerCategory === 'ungrouped') {
        stickersToShow = db.myStickers.filter(s => !s.group);
    } else {
        stickersToShow = db.myStickers.filter(s => s.group === currentStickerCategory);
    }

    if (stickersToShow.length === 0) {
        container.innerHTML = '<p style="color:#aaa; text-align:center; grid-column:1/-1; padding:20px;">该分组下没有表情</p>';
        return;
    }

    stickersToShow.forEach(sticker => {
        const item = document.createElement('div');
        item.className = 'sticker-item';
        
        if (isStickerManageMode) {
            item.classList.add('is-managing');
            if (selectedStickerIds.has(sticker.id)) {
                item.classList.add('is-selected');
            }
        }
        
        item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span style="font-size:10px; margin-top:4px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; text-align:center;">${sticker.name}</span>`;

        item.addEventListener('click', () => {
            if (isStickerManageMode) {
                if (selectedStickerIds.has(sticker.id)) {
                    selectedStickerIds.delete(sticker.id);
                    item.classList.remove('is-selected');
                } else {
                    selectedStickerIds.add(sticker.id);
                    item.classList.add('is-selected');
                }
                const count = selectedStickerIds.size;
                document.getElementById('sticker-select-count').textContent = `已选 ${count} 项`;
                document.getElementById('delete-selected-stickers-btn').disabled = count === 0;
                document.getElementById('move-sticker-group-btn').disabled = count === 0;
            } else {
                sendSticker(sticker);
            }
        });

        container.appendChild(item);
    });
}

function handleStickerLongPress(stickerId) {
    if (isStickerManageMode) return;
    clearTimeout(longPressTimer);
    currentStickerActionTarget = stickerId;
    document.getElementById('sticker-actionsheet').classList.add('visible');
}

async function sendSticker(sticker) {
    const dbSticker = db.myStickers.find(s => s.id === sticker.id);
    if (dbSticker) {
        dbSticker.lastUsedTime = Date.now();
    }

    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
    
    const messageContentForAI = `[${myName}发送的表情包：${sticker.name}]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContentForAI,
        parts: [{type: 'text', text: messageContentForAI}],
        timestamp: Date.now(),
        stickerData: sticker.data 
    };
    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    
    await saveData(); 
    renderChatList();
    
    showPanel('none');
}
