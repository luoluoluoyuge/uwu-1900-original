// --- 聊天辅助功能模块 ---

// 辅助功能
function setupVoiceMessageSystem() {
    const voiceMessageBtn = document.getElementById('voice-message-btn');
    const sendVoiceForm = document.getElementById('send-voice-form');
    const sendVoiceModal = document.getElementById('send-voice-modal');
    const voiceDurationPreview = document.getElementById('voice-duration-preview');
    const voiceTextInput = document.getElementById('voice-text-input');

    voiceMessageBtn.addEventListener('click', () => {
        sendVoiceForm.reset();
        voiceDurationPreview.textContent = '0"';
        sendVoiceModal.classList.add('visible');
    });
    sendVoiceForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyVoiceMessage(voiceTextInput.value.trim());
    });
}

function sendMyVoiceMessage(text) {
    if (!text) return;
    document.getElementById('send-voice-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}的语音：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        chat.history.push(message);
        addMessageBubble(message, currentChatId, currentChatType);
        saveData();
        renderChatList();
    }, 100);
}

function setupPhotoVideoSystem() {
    const photoVideoBtn = document.getElementById('photo-video-btn');
    const sendPvForm = document.getElementById('send-pv-form');
    const sendPvModal = document.getElementById('send-pv-modal');
    const pvTextInput = document.getElementById('pv-text-input');

    photoVideoBtn.addEventListener('click', () => {
        sendPvForm.reset();
        sendPvModal.classList.add('visible');
    });
    sendPvForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyPhotoVideo(pvTextInput.value.trim());
    });
}

function sendMyPhotoVideo(text) {
    if (!text) return;
    document.getElementById('send-pv-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}发来的照片\/视频：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        chat.history.push(message);
        addMessageBubble(message, currentChatId, currentChatType);
        saveData();
        renderChatList();
    }, 100);
}

function setupImageRecognition() {
    const imageRecognitionBtn = document.getElementById('image-recognition-btn');
    const imageUploadInput = document.getElementById('image-upload-input');

    imageRecognitionBtn.addEventListener('click', () => {
        imageUploadInput.click();
    });
    imageUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {
                    quality: 0.8,
                    maxWidth: 1024,
                    maxHeight: 1024
                });
                sendImageForRecognition(compressedUrl);
            } catch (error) {
                console.error('Image compression failed:', error);
                showToast('图片处理失败，请重试');
            } finally {
                e.target.value = null;
            }
        }
    });
}

async function sendImageForRecognition(base64Data) {
    if (!base64Data || isGenerating) return;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
    const textPrompt = `[${myName}发来了一张图片：]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: base64Data,
        parts: [{type: 'text', text: textPrompt}, {type: 'image', data: base64Data}],
        timestamp: Date.now(),
    };
    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

function setupWalletSystem() {
    const walletBtn = document.getElementById('wallet-btn');
    const sendTransferForm = document.getElementById('send-transfer-form');
    const sendTransferModal = document.getElementById('send-transfer-modal');
    const transferAmountInput = document.getElementById('transfer-amount-input');
    const transferRemarkInput = document.getElementById('transfer-remark-input');
    const acceptTransferBtn = document.getElementById('accept-transfer-btn');
    const returnTransferBtn = document.getElementById('return-transfer-btn');

    walletBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendTransferForm.reset();
            sendTransferModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            // currentGroupAction 应该在 group_chat.js 或全局定义
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'transfer';
            }
            renderGroupRecipientSelectionList('转账给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendTransferForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = transferAmountInput.value;
        const remark = transferRemarkInput.value.trim();
        if (amount > 0) {
            sendMyTransfer(amount, remark);
        } else {
            showToast('请输入有效的金额');
        }
    });
    acceptTransferBtn.addEventListener('click', () => respondToTransfer('received'));
    returnTransferBtn.addEventListener('click', () => respondToTransfer('returned'));
}

function sendMyTransfer(amount, remark) {
    document.getElementById('send-transfer-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (currentChatType === 'private') {
            const content = `[${chat.myName}给你转账：${amount}元；备注：${remark}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                transferStatus: 'pending'
            };
            chat.history.push(message);
            addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (typeof currentGroupAction !== 'undefined' && currentGroupAction.recipients) {
                currentGroupAction.recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 转账：${amount}元；备注：${remark}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        chat.history.push(message);
                        addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        saveData();
        renderChatList();
    }, 100);
}

function handleReceivedTransferClick(messageId) {
    currentTransferMessageId = messageId;
    document.getElementById('receive-transfer-actionsheet').classList.add('visible');
}

async function respondToTransfer(action) {
    if (!currentTransferMessageId) return;
    const character = db.characters.find(c => c.id === currentChatId);
    const message = character.history.find(m => m.id === currentTransferMessageId);
    if (message) {
        message.transferStatus = action;
        const cardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${currentTransferMessageId}"] .transfer-card`);
        if (cardOnScreen) {
            cardOnScreen.classList.remove('received', 'returned');
            cardOnScreen.classList.add(action);
            cardOnScreen.querySelector('.transfer-status').textContent = action === 'received' ? '已收款' : '已退回';
            cardOnScreen.style.cursor = 'default';
        }
        let contextMessageContent = (action === 'received') ? `[${character.myName}接收${character.realName}的转账]` : `[${character.myName}退回${character.realName}的转账]`;
        const contextMessage = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: contextMessageContent,
            parts: [{type: 'text', text: contextMessageContent}],
            timestamp: Date.now()
        };
        character.history.push(contextMessage);
        await saveData();
        renderChatList();
    }
    document.getElementById('receive-transfer-actionsheet').classList.remove('visible');
    currentTransferMessageId = null;
}

function setupGiftSystem() {
    const giftBtn = document.getElementById('gift-btn');
    const sendGiftForm = document.getElementById('send-gift-form');
    const sendGiftModal = document.getElementById('send-gift-modal');
    const giftDescriptionInput = document.getElementById('gift-description-input');

    giftBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendGiftForm.reset();
            sendGiftModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'gift';
            }
            renderGroupRecipientSelectionList('送礼物给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendGiftForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyGift(giftDescriptionInput.value.trim());
    });
}

function sendMyGift(description) {
    if (!description) return;
    document.getElementById('send-gift-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

        if (currentChatType === 'private') {
            const content = `[${chat.myName}送来的礼物：${description}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                giftStatus: 'sent'
            };
            chat.history.push(message);
            addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (typeof currentGroupAction !== 'undefined' && currentGroupAction.recipients) {
                currentGroupAction.recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 送来了礼物：${description}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        chat.history.push(message);
                        addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        saveData();
        renderChatList();
    }, 100);
}

// --- 转发聊天记录弹窗逻辑 ---
window.showForwardedChatModal = function(chatContent, charName) {
    const modal = document.getElementById('forwarded-chat-modal');
    const titleEl = document.getElementById('forwarded-chat-modal-title');
    const contentEl = document.getElementById('forwarded-chat-content');
    const closeBtn = document.getElementById('close-forwarded-chat-btn');
    
    if (!modal || !titleEl || !contentEl) return;
    
    titleEl.textContent = `${charName}的聊天记录`;
    
    // 解析聊天记录内容
    const lines = chatContent.split('\n').filter(line => line.trim() !== '');
    let html = '';
    
    lines.forEach(line => {
        // 尝试匹配 "名字：内容" 或 "名字: 内容"
        const match = line.match(/^([^：:]+)[：:]([\s\S]+)$/);
        if (match) {
            const name = match[1].trim();
            const text = match[2].trim();
            
            // 简单的左右区分逻辑：如果名字是当前角色，放右边，否则放左边
            const isSelf = name === charName;
            
            html += `
                <div style="display: flex; flex-direction: column; align-items: ${isSelf ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                    <span style="font-size: 12px; color: #888; margin-bottom: 4px; margin-${isSelf ? 'right' : 'left'}: 4px;">${name}</span>
                    <div style="background: ${isSelf ? 'var(--primary-color)' : '#fff'}; color: ${isSelf ? '#fff' : '#333'}; padding: 8px 12px; border-radius: 12px; border-${isSelf ? 'top-right' : 'top-left'}-radius: 4px; max-width: 85%; word-wrap: break-word; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        ${DOMPurify.sanitize(text)}
                    </div>
                </div>
            `;
        } else {
            // 如果没有匹配到名字，作为系统提示或居中显示
            html += `<div style="text-align: center; font-size: 12px; color: #aaa; margin: 8px 0;">${DOMPurify.sanitize(line)}</div>`;
        }
    });
    
    contentEl.innerHTML = html;
    modal.classList.add('visible');
    
    // 绑定关闭事件
    const closeModal = () => {
        modal.classList.remove('visible');
        closeBtn.removeEventListener('click', closeModal);
    };
    closeBtn.addEventListener('click', closeModal);
};

function setupTimeSkipSystem() {
    const timeSkipBtn = document.getElementById('time-skip-btn');
    const timeSkipModal = document.getElementById('time-skip-modal');
    const timeSkipForm = document.getElementById('time-skip-form');
    const timeSkipInput = document.getElementById('time-skip-input');

    timeSkipBtn.addEventListener('click', () => {
        timeSkipForm.reset();
        timeSkipModal.classList.add('visible');
    });
    timeSkipModal.addEventListener('click', (e) => {
        if (e.target === timeSkipModal) timeSkipModal.classList.remove('visible');
    });
    timeSkipForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendTimeSkipMessage(timeSkipInput.value.trim());
    });
}

// ---------- 拍一拍 ----------
// 双击聊天里 TA 的头像 = 拍一拍。聊天里显示一行居中小字，同时给 AI 一条看不见的上下文，下次请求时 TA 就知道被拍了。
function setupPatSystem() {
    const area = document.getElementById('message-area');
    if (!area) return;
    let lastTapTime = 0;
    let lastTapTarget = null;
    area.addEventListener('click', (e) => {
        const img = e.target && e.target.closest ? e.target.closest('img.message-avatar') : null;
        if (!img) return;
        if (typeof isDebugMode !== 'undefined' && isDebugMode) return;
        const wrapper = img.closest('.message-wrapper');
        // 只有点 TA（收到的消息）的头像才会拍 TA
        if (!wrapper || !wrapper.classList.contains('received')) return;
        const now = Date.now();
        if (lastTapTarget === img && now - lastTapTime < 450) {
            lastTapTime = 0;
            lastTapTarget = null;
            sendPatMessage(img);
        } else {
            lastTapTime = now;
            lastTapTarget = img;
        }
    });
}

async function sendPatMessage(avatarEl) {
    if (typeof currentChatType === 'undefined' || currentChatType !== 'private') return;
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.patEnabled) return;

    if (avatarEl) {
        avatarEl.classList.remove('pat-shake');
        void avatarEl.offsetWidth;
        avatarEl.classList.add('pat-shake');
        setTimeout(() => avatarEl.classList.remove('pat-shake'), 600);
    }
    if (typeof triggerHapticFeedback === 'function') triggerHapticFeedback('light');

    const charName = chat.remarkName || chat.realName || chat.name;
    const charSuffix = (chat.patCharSuffix === undefined) ? '的脑袋' : (chat.patCharSuffix || '');
    const myName = chat.myName || '我';
    const now = Date.now();
    const visualMessage = {
        id: `msg_visual_${now}`,
        role: 'system',
        content: `[system-display:我拍了拍 ${charName}${charSuffix}]`,
        parts: [],
        timestamp: now
    };
    const contextText = `[system: ${myName}拍了拍你${charSuffix}。这是微信式的“拍一拍”小互动，可以回应，也可以用 [${chat.realName}拍了拍${myName}] 拍回去。]`;
    const contextMessage = {
        id: `msg_context_${now}`,
        role: 'user',
        content: contextText,
        parts: [{type: 'text', text: contextText}],
        timestamp: now
    };
    chat.history.push(visualMessage, contextMessage);
    addMessageBubble(visualMessage, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

async function sendTimeSkipMessage(text) {
    if (!text) return;
    document.getElementById('time-skip-modal').classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    const visualMessage = {
        id: `msg_visual_${Date.now()}`,
        role: 'system',
        content: `[system-display:${text}]`,
        parts: [],
        timestamp: Date.now()
    };
    const contextMessage = {
        id: `msg_context_${Date.now()}`,
        role: 'user',
        content: `[system: ${text}]`,
        parts: [{type: 'text', text: `[system: ${text}]`}],
        timestamp: Date.now()
    };
    if (currentChatType === 'group') {
        contextMessage.senderId = 'user_me';
        visualMessage.senderId = 'user_me';
    }

    chat.history.push(visualMessage, contextMessage);
    addMessageBubble(visualMessage, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

const AudioManager = {
    _audio: null,
    
    get audio() {
        if (!this._audio) {
            this._audio = new Audio();
            this._audio.addEventListener('ended', () => {
                // 可选：播放结束后的清理工作
            });
            this._audio.addEventListener('error', (e) => {
                console.warn('Audio Object Error:', e);
            });
        }
        return this._audio;
    },

    play(source) {
        if (!source) return;
        const a = this.audio;
        
        // 如果当前正在播放且源相同，可以重置进度（打断重播）
        // 如果源不同，直接切换
        try {
            a.src = source;
            a.volume = 1.0; 
            a.currentTime = 0;
            
            const p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch(e => {
                    // 忽略 AbortError (被新的播放打断是正常的)
                    if (e.name !== 'AbortError') {
                        console.warn('播放提示音失败:', e);
                    }
                });
            }
        } catch (e) {
            console.warn('音频播放异常:', e);
        }
    },

    // 预热/解锁音频对象（用于在没有发送音效时获取播放权限）
    unlock() {
        if (db.globalReceiveSound) {
            const a = this.audio;
            // 记录当前状态
            const originalSrc = a.src;
            
            // 切换到接收音效进行预热
            if (!a.src || a.src !== db.globalReceiveSound) {
                 a.src = db.globalReceiveSound;
            }
            
            a.volume = 0; // 静音
            const p = a.play();
            if (p) {
                p.then(() => {
                    a.pause();
                    a.currentTime = 0;
                    a.volume = 1; 
                }).catch(e => {
                    // 预热失败也不影响流程
                    a.volume = 1;
                });
            }
        }
    }
};

function playSound(source) {
    AudioManager.play(source);
}


// ---------- 投票 ----------
// 投票消息 = 一条带 vote 字段的普通消息（卡片显示）。双方都可以投票、追加选项（不能删除选项）。
// 投票动作会写一条 AI 能看到的上下文，AI 的动作用固定格式的指令回传（见 chat_ai.js 的 handleAiVoteItem）。
const VOTE_MAX_OPTIONS = 12;

function escapeVoteHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function cleanVoteText(text, max) {
    return String(text == null ? '' : text).replace(/[\[\]\r\n|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function getVoteChat() {
    if (typeof currentChatType === 'undefined' || currentChatType !== 'private') return null;
    return db.characters.find(c => c.id === currentChatId) || null;
}

function voteCharName(chat) {
    return chat.remarkName || chat.realName || chat.name || 'TA';
}

function createVoteObject(creator, title, optionTexts) {
    const seen = new Set();
    const options = [];
    optionTexts.forEach(t => {
        const text = cleanVoteText(t, 150);
        if (!text || seen.has(text) || options.length >= VOTE_MAX_OPTIONS) return;
        seen.add(text);
        options.push({ id: `opt_${Date.now().toString(36)}_${options.length}`, text, by: creator, voters: [] });
    });
    return { title: cleanVoteText(title, 160), creator, options };
}

// 把 AI 一次写的多个选项拆开（顿号/逗号/竖线/斜杠），但「…」里的翻译内部不拆；只去掉整体包着的引号
function splitVoteOptionTexts(text) {
    const out = [];
    let cur = '', depth = 0;
    for (const ch of String(text || '')) {
        if (ch === '「') depth++;
        if (ch === '」' && depth > 0) depth--;
        if (depth === 0 && /[、,，|｜\/]/.test(ch)) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out.map(t => t.trim().replace(/^[“"『「]([^「」]*)[”"』」]$/, '$1')).filter(Boolean);
}

function voteTextKeys(text) {
    const raw = String(text == null ? '' : text).trim();
    const m = raw.match(/^([\s\S]*?)\s*「([^「」]*)」?\s*$/);
    const keys = [raw];
    if (m) { if (m[1].trim()) keys.push(m[1].trim()); if (m[2].trim()) keys.push(m[2].trim()); }
    return keys;
}

function findVoteOption(vote, text) {
    const t = cleanVoteText(text, 200).replace(/^[“"『「]([^「」]*)[”"』」]$/, '$1');
    if (!t) return null;
    const tk = voteTextKeys(t);
    return vote.options.find(o => voteTextKeys(o.text).some(k => tk.includes(k)))
        || vote.options.find(o => voteTextKeys(o.text).some(k => tk.some(x => k.includes(x) || x.includes(k))))
        || null;
}

// 找投票消息：给了标题就按标题找（最近的优先），找不到再退回到最新的一个投票
function findVoteMessage(chat, title) {
    const polls = chat.history.filter(m => m && m.vote);
    if (polls.length === 0) return null;
    const t = cleanVoteText(title, 200);
    if (t) {
        for (let i = polls.length - 1; i >= 0; i--) {
            const pt = polls[i].vote.title;
            if (pt === t || pt.includes(t) || t.includes(pt)) return polls[i];
        }
    }
    return polls[polls.length - 1];
}

function setVoteChoice(vote, who, optionId) {
    vote.options.forEach(o => { o.voters = o.voters.filter(v => v !== who); });
    const opt = vote.options.find(o => o.id === optionId);
    if (opt) opt.voters.push(who);
    return opt;
}

function addVoteOption(vote, who, text) {
    const clean = cleanVoteText(text, 150);
    if (!clean) return { ok: false, reason: 'empty' };
    if (vote.options.some(o => o.text === clean)) return { ok: false, reason: 'dup' };
    if (vote.options.length >= VOTE_MAX_OPTIONS) return { ok: false, reason: 'max' };
    const opt = { id: `opt_${Date.now().toString(36)}_${vote.options.length}_${Math.random().toString(36).slice(2, 5)}`, text: clean, by: who, voters: [] };
    vote.options.push(opt);
    return { ok: true, option: opt };
}

// 解析 AI 的投票动作（选择 / 添加选项），兼容简繁体、引号和“在…中/为…”等不同写法，不要求标题一定写对。
function parseAiVoteAction(raw) {
    const c = String(raw || '').trim();
    const q = '[“"「『]';
    const qe = '[”"」』]';
    let m = c.match(new RegExp(`^\\[([^\\[\\]：:]{1,60}?)(?:在|向|给|為|为)?(?:投票\\s*(?:${q}([^\\[\\]]*?)${qe})?)?\\s*[中里裡]?\\s*(?:添加|新增|增加|加)了?(?:一个|个)?[选選][项項][：:]\\s*([^\\[\\]]+?)\\s*\\]$`));
    if (m) return { kind: 'add', name: m[1].trim(), title: (m[2] || '').trim(), text: m[3] };
    m = c.match(new RegExp(`^\\[([^\\[\\]：:]{1,60}?)(?:在|向|给|為|为)?投票\\s*(?:${q}([^\\[\\]]*?)${qe})?\\s*[中里裡]?\\s*(?:选择了|選擇了|选了|選了|投了|投给了|投給了|选择|投给)[：:]\\s*([^\\[\\]]+?)\\s*\\]$`));
    if (m) return { kind: 'choose', name: m[1].trim(), title: (m[2] || '').trim(), text: m[3] };
    m = c.match(/^\[([^\[\]：:]{1,60}?)(?:投票|投了票)[：:]\s*([^\[\]]+?)\s*\]$/);
    if (m) return { kind: 'choose', name: m[1].trim(), title: '', text: m[2] };
    return null;
}

function renderVoteCardBody(message, chat) {
    const vote = message.vote;
    const charName = voteCharName(chat);
    const creatorName = vote.creator === 'user' ? '我' : charName;
    const voterTotal = new Set(vote.options.flatMap(o => o.voters)).size;
    const optionsHtml = vote.options.map(o => {
        const mine = o.voters.includes('user');
        const chips = o.voters.map(v => `<span class="vote-voter-chip">${v === 'user' ? '我' : escapeVoteHtml(charName)}</span>`).join('');
        return `<div class="vote-option${mine ? ' selected' : ''}" data-vote-option="${escapeVoteHtml(o.id)}">
            <span class="vote-check"></span>
            <span class="vote-option-text">${qnBilingualHtml(o.text, chat, 'full')}</span>
            <span class="vote-option-voters">${chips}</span>
        </div>`;
    }).join('');
    return `<div class="vote-card-head">
            <svg class="vote-card-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 22q-.825 0-1.412-.587T3 20v-4.55l2.75-3.125l1.425 1.425l-2 2.25h13.65l-1.95-2.2l1.425-1.425L21 15.45V20q0 .825-.587 1.413T19 22zm5.6-7.6l-3.475-3.525Q6.55 10.3 6.55 9.45t.575-1.425l4.9-4.9q.575-.575 1.425-.575t1.425.575L18.4 6.6q.575.575.588 1.412t-.563 1.413l-5 5q-.575.575-1.412.563T10.6 14.4M17 8l-3.55-3.5L8.5 9.45l3.55 3.5z"/></svg>
            <div class="vote-card-headtext">
                <div class="vote-card-title">${qnBilingualHtml(vote.title, chat, 'card')}</div>
                <div class="vote-card-sub">${escapeVoteHtml(creatorName)}发起的投票 · ${voterTotal}人已投</div>
            </div>
        </div>
        <div class="vote-options">${optionsHtml}</div>
        <div class="vote-add-row"><button type="button" class="vote-add-btn" data-vote-add="1">＋ 添加选项</button></div>`;
}

// 把投票卡片的内容刷新到已有的气泡里（不动时间戳等其它部分）
function refreshVoteCard(messageId) {
    const chat = getVoteChat();
    if (!chat) return;
    const message = chat.history.find(m => m.id === messageId);
    if (!message || !message.vote) return;
    const area = document.getElementById('message-area');
    const body = area && area.querySelector(`.message-wrapper[data-id="${messageId}"] .vote-card-body`);
    if (body) body.innerHTML = renderVoteCardBody(message, chat);
}

function pushVoteContext(chat, text) {
    const now = Date.now();
    const content = `[system: ${text}]`;
    chat.history.push({
        id: `msg_context_${now}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
        timestamp: now
    });
}

async function sendMyVote(title, optionTexts) {
    const chat = getVoteChat();
    if (!chat) return;
    const vote = createVoteObject('user', title, optionTexts);
    if (!vote.title || vote.options.length < 2) {
        showToast('请填写标题，并至少两个选项');
        return;
    }
    const myName = chat.myName || '我';
    const content = `[${myName}发起了投票：${vote.title}|${vote.options.map(o => o.text).join('|')}]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
        timestamp: Date.now(),
        vote
    };
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

function openVoteComposer() {
    const chat = getVoteChat();
    if (!chat) {
        showToast('投票目前只支持私聊');
        return;
    }
    const modal = document.getElementById('vote-compose-modal');
    if (!modal) return;
    document.getElementById('vote-compose-title').value = '';
    const list = document.getElementById('vote-compose-options');
    list.innerHTML = '';
    addVoteComposeRow('');
    addVoteComposeRow('');
    modal.classList.add('visible');
    try { if (typeof showPanel === 'function') showPanel('none'); } catch (err) { /* 面板未初始化时忽略 */ }
}

function addVoteComposeRow(value) {
    const list = document.getElementById('vote-compose-options');
    if (!list || list.children.length >= VOTE_MAX_OPTIONS) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vote-compose-option';
    input.maxLength = 30;
    input.autocomplete = 'off';
    input.placeholder = `选项 ${list.children.length + 1}`;
    input.value = value || '';
    list.appendChild(input);
}

function injectVoteUi() {
    if (!document.getElementById('vote-compose-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="vote-compose-modal" class="modal-overlay">
                <div class="modal-window">
                    <h3>发起投票</h3>
                    <form id="vote-compose-form">
                        <div class="form-group">
                            <label for="vote-compose-title">标题</label>
                            <input type="text" id="vote-compose-title" maxlength="40" autocomplete="off" placeholder="例如：今晚吃什么？" required>
                        </div>
                        <div class="form-group">
                            <label>选项（至少两个，发出后双方都只能增加、不能删除）</label>
                            <div id="vote-compose-options" style="display:flex; flex-direction:column; gap:8px;"></div>
                            <button type="button" id="vote-compose-add" class="btn btn-small btn-secondary" style="margin:8px 0 0;">＋ 添加选项</button>
                        </div>
                        <button type="submit" class="btn btn-primary">发起</button>
                    </form>
                </div>
            </div>`);
    }
    const grid = document.querySelector('#chat-expansion-panel .expansion-grid');
    if (grid && !document.getElementById('vote-btn')) {
        grid.insertAdjacentHTML('beforeend', `
            <div class="expansion-item" id="vote-btn">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 22q-.825 0-1.412-.587T3 20v-4.55l2.75-3.125l1.425 1.425l-2 2.25h13.65l-1.95-2.2l1.425-1.425L21 15.45V20q0 .825-.587 1.413T19 22zm5.6-7.6l-3.475-3.525Q6.55 10.3 6.55 9.45t.575-1.425l4.9-4.9q.575-.575 1.425-.575t1.425.575L18.4 6.6q.575.575.588 1.412t-.563 1.413l-5 5q-.575.575-1.412.563T10.6 14.4M17 8l-3.55-3.5L8.5 9.45l3.55 3.5z"/></svg>
                </div>
                <span class="expansion-item-name">投票</span>
            </div>`);
        // 和存档/暂停一样，放在原本隐藏的红包按钮之前，不改变其它按钮的位置
        const voteBtn = document.getElementById('vote-btn');
        const redPacketBtn = grid.querySelector('#red-packet-btn');
        if (voteBtn && redPacketBtn) grid.insertBefore(voteBtn, redPacketBtn);
    }
}

function setupVoteSystem() {
    injectVoteUi();
    document.getElementById('vote-btn')?.addEventListener('click', openVoteComposer);
    const modal = document.getElementById('vote-compose-modal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('visible'); });
    document.getElementById('vote-compose-add')?.addEventListener('click', () => addVoteComposeRow(''));
    document.getElementById('vote-compose-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('vote-compose-title').value;
        const options = Array.from(document.querySelectorAll('#vote-compose-options .vote-compose-option')).map(i => i.value).filter(v => v.trim());
        const uniq = new Set(options.map(v => cleanVoteText(v, 30)).filter(Boolean));
        if (!cleanVoteText(title, 40) || uniq.size < 2) {
            showToast('请填写标题，并至少两个不同的选项');
            return;
        }
        modal.classList.remove('visible');
        await sendMyVote(title, options);
    });

    const area = document.getElementById('message-area');
    area?.addEventListener('click', async (e) => {
        if (typeof isDebugMode !== 'undefined' && isDebugMode) return;
        if (typeof isInMultiSelectMode !== 'undefined' && isInMultiSelectMode) return;
        const card = e.target.closest && e.target.closest('.vote-card');
        if (!card) return;
        const wrapper = card.closest('.message-wrapper');
        const chat = getVoteChat();
        if (!wrapper || !chat) return;
        const message = chat.history.find(m => m.id === wrapper.dataset.id);
        if (!message || !message.vote) return;
        const vote = message.vote;
        const myName = chat.myName || '我';

        const optionEl = e.target.closest('.vote-option');
        if (optionEl) {
            const optionId = optionEl.dataset.voteOption;
            const opt = vote.options.find(o => o.id === optionId);
            if (!opt) return;
            if (typeof triggerHapticFeedback === 'function') triggerHapticFeedback('light');
            if (opt.voters.includes('user')) {
                opt.voters = opt.voters.filter(v => v !== 'user');
                pushVoteContext(chat, `${myName}取消了在投票“${vote.title}”中对「${opt.text}」的选择`);
            } else {
                setVoteChoice(vote, 'user', optionId);
                pushVoteContext(chat, `${myName}在投票“${vote.title}”中选择了「${opt.text}」`);
            }
            refreshVoteCard(message.id);
            await saveData();
            return;
        }

        if (e.target.closest('.vote-add-btn')) {
            const row = card.querySelector('.vote-add-row');
            if (!row) return;
            row.innerHTML = `<input type="text" class="vote-add-input" maxlength="30" autocomplete="off" placeholder="输入新选项"><button type="button" class="vote-add-confirm">添加</button>`;
            row.querySelector('input').focus();
            return;
        }

        if (e.target.closest('.vote-add-confirm')) {
            const input = card.querySelector('.vote-add-input');
            const res = addVoteOption(vote, 'user', input ? input.value : '');
            if (!res.ok) {
                showToast(res.reason === 'dup' ? '已经有这个选项了' : (res.reason === 'max' ? `最多 ${VOTE_MAX_OPTIONS} 个选项` : '请输入选项内容'));
                return;
            }
            pushVoteContext(chat, `${myName}在投票“${vote.title}”中添加了选项「${res.option.text}」`);
            refreshVoteCard(message.id);
            await saveData();
        }
    });
    // 点“添加选项”后，如果又点了别处（不小心点到），输入框恢复成原来的按钮
    document.addEventListener('click', (e) => {
        if (!e.target.isConnected) return; // 刚被替换掉的“添加选项”按钮本身
        document.querySelectorAll('.vote-add-row .vote-add-input').forEach(input => {
            const row = input.closest('.vote-add-row');
            if (row && !row.contains(e.target)) {
                row.innerHTML = '<button type="button" class="vote-add-btn" data-vote-add="1">＋ 添加选项</button>';
            }
        });
    });
    area?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('vote-add-input')) {
            e.preventDefault();
            e.target.closest('.vote-card')?.querySelector('.vote-add-confirm')?.click();
        }
    });
}


// ---------- 问卷 ----------
// 问卷 = 一条带 qn 字段的消息（卡片）。双方各自填写文字答案，都提交后才一起揭晓。
// 草稿保存在角色上（char.questionnaireDrafts），可以随时发到聊天。
const QN_MAX_QUESTIONS = 12;

function cleanQnText(text, max) {
    return String(text == null ? '' : text).replace(/[\[\]\r\n|｜]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanQnAnswer(text) {
    return String(text == null ? '' : text).replace(/[\[\]|｜]/g, ' ').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

// 双语：AI 在双语模式下会写成 “外语原文「中文翻译」”，这里把它拆开显示
function qnSplitBilingual(text, chat) {
    const raw = String(text == null ? '' : text);
    if (!chat || !chat.bilingualModeEnabled) return { orig: raw, tr: '' };
    const m = raw.match(/^([\s\S]*?)\s*「([^「」]*)」?\s*$/);
    if (!m || !m[1].trim() || !m[2].trim()) return { orig: raw, tr: '' };
    return { orig: m[1].trim(), tr: m[2].trim() };
}

// mode: 'card' 按聊天里“翻译显示样式”（默认样式需点一下才展开）；'full' 一律显示翻译
function qnHasTr(text, chat) { return !!qnSplitBilingual(text, chat).tr; }

function qnBilingualHtml(text, chat, mode) {
    const { orig, tr } = qnSplitBilingual(text, chat);
    if (!tr) return escapeVoteHtml(orig);
    const style = (chat && chat.bilingualBubbleStyle) || 'under';
    const hidden = mode === 'card' && style === 'under';
    return `<span class="qn-bi${hidden ? ' qn-bi-collapsed' : ''}"><span class="qn-bi-orig">${escapeVoteHtml(orig)}</span><span class="qn-bi-tr">${escapeVoteHtml(tr)}</span></span>`;
}

function createQnObject(creator, title, questionTexts, mode) {
    const questions = [];
    questionTexts.forEach(t => {
        const text = cleanQnText(t, 160);
        if (text && questions.length < QN_MAX_QUESTIONS) questions.push({ text, user: '', char: '' });
    });
    return { title: cleanQnText(title, 80), creator, mode: mode === 'one' ? 'one' : 'two', questions, submitted: { user: false, char: false }, revealed: false };
}

// 这份问卷需要谁来填：双向 = 两个人；单向 = 只有收到问卷的一方
function qnNeeds(qn, who) {
    if (qn.mode === 'one') return (qn.creator === 'user' ? 'char' : 'user') === who;
    return true;
}

function findQnMessage(chat, title, who) {
    const list = chat.history.filter(m => m && m.qn);
    if (list.length === 0) return null;
    const t = cleanQnText(title, 120);
    const open = who ? list.filter(m => qnNeeds(m.qn, who) && !m.qn.submitted[who]) : list;
    const pool = open.length > 0 ? open : list;
    if (t) {
        for (let i = pool.length - 1; i >= 0; i--) {
            const pt = pool[i].qn.title;
            if (pt === t || pt.includes(t) || t.includes(pt)) return pool[i];
        }
    }
    return pool[pool.length - 1];
}

function parseAiQnStart(raw) {
    const m = String(raw || '').trim().match(/^\[([^\[\]：:]{1,40}?)[发發]起了?([单單双雙]向)?[问問]卷[：:]\s*([^\[\]]+?)\s*\]$/);
    if (!m) return null;
    const parts = m[3].split(/[|｜]/).map(s => s.trim()).filter(Boolean);
    return { name: m[1].trim(), mode: (m[2] && /[单單]/.test(m[2])) ? 'one' : 'two', title: parts[0] || '', questions: parts.slice(1) };
}

function parseAiQnAnswer(raw) {
    const q = '[“"「『]';
    const qe = '[”"」』]';
    const m = String(raw || '').trim().match(new RegExp(`^\\[([^\\[\\]：:]{1,40}?)(?:回答了?|填写了?|填寫了?|作答了?|完成了)[问問]卷\\s*(?:${q}([^\\[\\]]*?)${qe})?\\s*[：:]\\s*([^\\[\\]]+?)\\s*\\]$`));
    if (!m) return null;
    return { name: m[1].trim(), title: (m[2] || '').trim(), answers: m[3].split(/[|｜]/).map(s => s.trim()) };
}

// 把 AI 的答案按题号写进去；数量对不上就按顺序尽量对，多的丢掉、少的留空（留空的会显示“（未回答）”）
function applyAiQnAnswers(qnMsg, answers) {
    const qs = qnMsg.qn.questions;
    qs.forEach((qItem, i) => { qItem.char = cleanQnAnswer((answers[i] || '').replace(/^[（(]?\d+[)）.、:：]\s*/, '')); });
    qnMsg.qn.submitted.char = true;
}

function qnPushContext(chat, text) {
    const now = Date.now();
    const content = `[system: ${text}]`;
    chat.history.push({
        id: `msg_context_${now}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
        timestamp: now
    });
}

// 双方都交了 -> 揭晓，并给 AI 一条看不见的上下文，方便它接着聊
function qnMaybeReveal(chat, qnMsg) {
    const qn = qnMsg.qn;
    if (qn.revealed) return false;
    if (qnNeeds(qn, 'user') && !qn.submitted.user) return false;
    if (qnNeeds(qn, 'char') && !qn.submitted.char) return false;
    qn.revealed = true;
    // 问卷填完（揭晓）后，对应的草稿自动删除；已完成的问卷可以在“已完成的问卷”里回看
    if (qn.draftId && Array.isArray(chat.questionnaireDrafts)) {
        chat.questionnaireDrafts = chat.questionnaireDrafts.filter(d => d.id !== qn.draftId);
    }
    const myName = chat.myName || '我';
    const lines = qn.questions.map((item, i) => {
        const parts = [];
        if (qnNeeds(qn, 'user')) parts.push(`${myName}：${item.user || '（未回答）'}`);
        if (qnNeeds(qn, 'char')) parts.push(`你：${item.char || '（未回答）'}`);
        return `第${i + 1}题「${item.text}」${parts.join('；')}`;
    }).join(' ');
    qnPushContext(chat, `问卷“${qn.title}”已揭晓。${lines}`);
    return true;
}

function renderQnCardBody(message, chat) {
    const qn = message.qn;
    const modeText = qn.mode === 'one' ? '单向问卷' : '双向问卷';
    let action;
    if (qn.revealed) {
        action = '<button type="button" class="qn-action" data-qn-act="view">查看答案</button>';
    } else if (qnNeeds(qn, 'user') && !qn.submitted.user) {
        action = '<button type="button" class="qn-action" data-qn-act="fill">去填写</button>';
    } else if (qnNeeds(qn, 'user')) {
        action = '<button type="button" class="qn-action qn-waiting" data-qn-act="none" disabled>已提交，等 TA 回答</button>';
    } else {
        // 单向问卷、我发出的：不需要我填，只等对方
        action = '<button type="button" class="qn-action qn-waiting" data-qn-act="none" disabled>等 TA 回答</button>';
    }
    return `<div class="vote-card-head">
            <svg class="vote-card-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h6.525q.5 0 .75.313t.25.687t-.262.688T11.5 5H5v14h14v-6.525q0-.5.313-.75t.687-.25t.688.25t.312.75V19q0 .825-.587 1.413T19 21zm4-7v-2.425q0-.4.15-.763t.425-.637l8.6-8.6q.3-.3.675-.45t.75-.15q.4 0 .763.15t.662.45L22.425 3q.275.3.425.663T23 4.4t-.137.738t-.438.662l-8.6 8.6q-.275.275-.637.438t-.763.162H10q-.425 0-.712-.288T9 14m12.025-9.6l-1.4-1.4zM11 13h1.4l5.8-5.8l-.7-.7l-.725-.7L11 11.575zm6.5-6.5l-.725-.7zl.7.7z"/></svg>
            <div class="vote-card-headtext">
                <div class="vote-card-title">${qnBilingualHtml(qn.title, chat, 'card')}</div>
                <div class="vote-card-sub">${modeText} · ${qn.questions.length}题</div>
            </div>
        </div>
        <div class="qn-action-row">${action}</div>`;
}

function refreshQnCard(messageId) {
    const chat = getVoteChat();
    if (!chat) return;
    const message = chat.history.find(m => m.id === messageId);
    if (!message || !message.qn) return;
    const area = document.getElementById('message-area');
    const body = area && area.querySelector(`.message-wrapper[data-id="${messageId}"] .qn-card-body`);
    if (body) body.innerHTML = renderQnCardBody(message, chat);
}

async function sendQuestionnaire(draft) {
    const chat = getVoteChat();
    if (!chat) return false;
    const qn = createQnObject('user', draft.title, draft.questions, draft.mode);
    qn.draftId = draft.id || null;
    if (!qn.title || qn.questions.length < 1) {
        showToast('请填写标题，并至少一道题');
        return false;
    }
    const myName = chat.myName || '我';
    const content = `[${myName}发起了${qn.mode === 'one' ? '单向' : '双向'}问卷：${qn.title}|${qn.questions.map(x => x.text).join('|')}]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        parts: [{ type: 'text', text: content }],
        timestamp: Date.now(),
        qn
    };
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveData();
    renderChatList();
    return true;
}

// ---- 草稿管理 / 编辑 ----
let qnEditingDraftId = null;

function qnGetDrafts(chat) {
    if (!Array.isArray(chat.questionnaireDrafts)) chat.questionnaireDrafts = [];
    return chat.questionnaireDrafts;
}

function renderQnManager() {
    const chat = getVoteChat();
    const list = document.getElementById('qn-draft-list');
    const doneBox = document.getElementById('qn-done-list');
    if (!chat || !list) return;
    const drafts = qnGetDrafts(chat);
    if (drafts.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#999; font-size:13px; padding:18px 0;">还没有问卷草稿，点“新建问卷”写一份吧</div>';
    } else {
        list.innerHTML = drafts.map(d => `<div class="qn-draft-item" data-draft-id="${escapeVoteHtml(d.id)}">
            <div class="qn-draft-info"><div class="qn-draft-title">${escapeVoteHtml(d.title || '（无标题）')}</div><div class="qn-draft-sub">${d.mode === 'one' ? '单向' : '双向'} · ${d.questions.length} 道题</div></div>
            <div class="qn-draft-actions">
                <button type="button" data-qn-draft-act="send">发送</button>
                <button type="button" data-qn-draft-act="edit">编辑</button>
                <button type="button" data-qn-draft-act="delete">删除</button>
            </div>
        </div>`).join('');
    }
    if (doneBox) {
        const done = chat.history.filter(m => m && m.qn && m.qn.revealed).reverse();
        if (done.length === 0) {
            doneBox.innerHTML = '';
        } else {
            const fmt = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
            doneBox.innerHTML = '<div class="qn-section-title">已完成的问卷（点一下查看当时的答案，长按可删除）</div>' + done.map(m => `<div class="qn-done-item" data-qn-msg-id="${escapeVoteHtml(m.id)}">
                <div class="qn-draft-info"><div class="qn-draft-title">${escapeVoteHtml(m.qn.title)}</div><div class="qn-draft-sub">${m.qn.mode === 'one' ? '单向' : '双向'} · ${m.qn.questions.length} 道题 · ${fmt(m.timestamp)}</div></div>
                <span class="qn-done-arrow">›</span>
                <button type="button" class="qn-done-del" data-qn-del="1">删除</button>
            </div>`).join('');
        }
    }
}

function openQnManager() {
    if (!getVoteChat()) {
        showToast('问卷目前只支持私聊');
        return;
    }
    renderQnManager();
    document.getElementById('qn-manager-modal')?.classList.add('visible');
    try { if (typeof showPanel === 'function') showPanel('none'); } catch (err) { /* 面板未初始化时忽略 */ }
}

function addQnEditorRow(value) {
    const wrap = document.getElementById('qn-editor-questions');
    if (!wrap || wrap.children.length >= QN_MAX_QUESTIONS) return;
    const row = document.createElement('div');
    row.className = 'qn-editor-row';
    row.innerHTML = `<input type="text" class="qn-editor-q" maxlength="80" autocomplete="off" placeholder="第 ${wrap.children.length + 1} 题"><button type="button" class="qn-editor-del" aria-label="删除这一题">×</button>`;
    row.querySelector('input').value = value || '';
    wrap.appendChild(row);
}

function renumberQnEditorRows() {
    document.querySelectorAll('#qn-editor-questions .qn-editor-q').forEach((input, i) => { input.placeholder = `第 ${i + 1} 题`; });
}

function openQnEditor(draftId) {
    const chat = getVoteChat();
    if (!chat) return;
    qnEditingDraftId = draftId || null;
    const draft = draftId ? qnGetDrafts(chat).find(d => d.id === draftId) : null;
    document.getElementById('qn-editor-title').value = draft ? draft.title : '';
    const modeValue = draft && draft.mode === 'one' ? 'one' : 'two';
    document.querySelectorAll('input[name="qn-editor-mode"]').forEach(r => { r.checked = (r.value === modeValue); });
    const wrap = document.getElementById('qn-editor-questions');
    wrap.innerHTML = '';
    const qs = draft && draft.questions.length ? draft.questions : [''];
    qs.forEach(q => addQnEditorRow(q));
    document.getElementById('qn-manager-modal')?.classList.remove('visible');
    document.getElementById('qn-editor-modal')?.classList.add('visible');
}

function readQnEditor() {
    const title = cleanQnText(document.getElementById('qn-editor-title').value, 40);
    const questions = Array.from(document.querySelectorAll('#qn-editor-questions .qn-editor-q')).map(i => cleanQnText(i.value, 80)).filter(Boolean);
    const checked = document.querySelector('input[name="qn-editor-mode"]:checked');
    return { title, questions, mode: checked && checked.value === 'one' ? 'one' : 'two' };
}

async function saveQnDraftFromEditor() {
    const chat = getVoteChat();
    if (!chat) return null;
    const data = readQnEditor();
    if (!data.title) { showToast('请先写问卷标题'); return null; }
    if (data.questions.length < 1) { showToast('至少写一道题'); return null; }
    const drafts = qnGetDrafts(chat);
    let draft = qnEditingDraftId ? drafts.find(d => d.id === qnEditingDraftId) : null;
    if (!draft) {
        draft = { id: `qnd_${Date.now().toString(36)}`, title: '', questions: [], updatedAt: 0 };
        drafts.unshift(draft);
        qnEditingDraftId = draft.id;
    }
    draft.title = data.title;
    draft.questions = data.questions;
    draft.mode = data.mode;
    draft.updatedAt = Date.now();
    await saveData();
    return draft;
}

// ---- 作答 / 查看 ----
let qnAnsweringMessageId = null;

function openQnAnswer(messageId) {
    const chat = getVoteChat();
    const message = chat && chat.history.find(m => m.id === messageId);
    if (!message || !message.qn || message.qn.submitted.user) return;
    qnAnsweringMessageId = messageId;
    document.getElementById('qn-answer-title').innerHTML = qnBilingualHtml(message.qn.title, chat, 'full');
    document.getElementById('qn-answer-list').innerHTML = message.qn.questions.map((item, i) => `<div class="form-group">
            <label class="qn-q-label${qnHasTr(item.text, chat) ? ' qn-has-tr' : ''}"><span class="qn-q-num">${i + 1}.</span> <span class="qn-q-body">${qnBilingualHtml(item.text, chat, 'full')}</span></label>
            <textarea class="qn-answer-input" rows="2" maxlength="300" placeholder="写下你的回答"></textarea>
        </div>`).join('');
    document.getElementById('qn-answer-modal')?.classList.add('visible');
}

async function submitQnAnswers() {
    const chat = getVoteChat();
    const message = chat && chat.history.find(m => m.id === qnAnsweringMessageId);
    if (!message || !message.qn) return;
    const inputs = Array.from(document.querySelectorAll('#qn-answer-list .qn-answer-input'));
    const answers = inputs.map(i => cleanQnAnswer(i.value));
    if (answers.some(a => !a)) { showToast('还有题目没填写哦'); return; }
    message.qn.questions.forEach((item, i) => { item.user = answers[i]; });
    message.qn.submitted.user = true;
    document.getElementById('qn-answer-modal')?.classList.remove('visible');
    if (message.qn.mode !== 'one') qnPushContext(chat, `${chat.myName || '我'}已提交问卷“${message.qn.title}”的答案（等双方都交了才会揭晓，此时先不要透露或猜测对方的答案）`);
    const revealed = qnMaybeReveal(chat, message);
    refreshQnCard(message.id);
    await saveData();
    if (revealed) showToast('问卷已揭晓');
}

function openQnResult(messageId) {
    const chat = getVoteChat();
    const message = chat && chat.history.find(m => m.id === messageId);
    if (!message || !message.qn) return;
    const charName = voteCharName(chat);
    document.getElementById('qn-result-title').innerHTML = qnBilingualHtml(message.qn.title, chat, 'full');
    document.getElementById('qn-result-list').innerHTML = message.qn.questions.map((item, i) => `<div class="qn-result-item">
            <div class="qn-result-q qn-q-label${qnHasTr(item.text, chat) ? ' qn-has-tr' : ''}"><span class="qn-q-num">${i + 1}.</span> <span class="qn-q-body">${qnBilingualHtml(item.text, chat, 'full')}</span></div>
            ${qnNeeds(message.qn, 'user') ? `<div class="qn-result-a${qnHasTr(item.user, chat) ? ' qn-has-tr' : ''}"><span class="qn-who">我</span>${escapeVoteHtml(item.user || '（未回答）')}</div>` : ''}
            ${qnNeeds(message.qn, 'char') ? `<div class="qn-result-a${qnHasTr(item.char, chat) ? ' qn-has-tr' : ''}"><span class="qn-who">${escapeVoteHtml(charName)}</span>${item.char ? qnBilingualHtml(item.char, chat, 'full') : '（未回答）'}</div>` : ''}
        </div>`).join('');
    document.getElementById('qn-result-modal')?.classList.add('visible');
}

function injectQnUi() {
    if (!document.getElementById('qn-manager-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="qn-manager-modal" class="modal-overlay">
                <div class="modal-window" style="max-height:85vh; overflow-y:auto;">
                    <h3>问卷</h3>
                    <div id="qn-draft-list"></div>
                    <button type="button" id="qn-new-btn" class="btn btn-primary" style="margin-top:12px;">新建问卷</button>
                    <div id="qn-done-list"></div>
                </div>
            </div>
            <div id="qn-editor-modal" class="modal-overlay">
                <div class="modal-window" style="max-height:88vh; overflow-y:auto;">
                    <h3>编辑问卷</h3>
                    <div class="form-group">
                        <label for="qn-editor-title">标题</label>
                        <input type="text" id="qn-editor-title" maxlength="40" autocomplete="off" placeholder="例如：情侣默契小问卷">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <div class="qn-mode-row">
                            <label class="qn-mode-opt"><input type="radio" name="qn-editor-mode" value="two" checked><span><b>双向</b><small>两人都填了才揭晓</small></span></label>
                            <label class="qn-mode-opt"><input type="radio" name="qn-editor-mode" value="one"><span><b>单向</b><small>对方填完就揭晓</small></span></label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>问题（用文字回答）</label>
                        <div style="font-size:12px; color:#999; margin:-2px 0 8px; line-height:1.5;">可以在输入框内一次粘贴多道题（每行一题），会自动填入。最多 12 道题。</div>
                        <div id="qn-editor-questions" style="display:flex; flex-direction:column; gap:8px;"></div>
                        <button type="button" id="qn-editor-add" class="btn btn-small btn-secondary" style="margin:8px 0 0;">＋ 添加问题</button>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" id="qn-editor-save" class="btn btn-neutral" style="flex:1;">保存草稿</button>
                        <button type="button" id="qn-editor-send" class="btn btn-primary" style="flex:1;">发送到聊天</button>
                    </div>
                </div>
            </div>
            <div id="qn-answer-modal" class="modal-overlay">
                <div class="modal-window" style="max-height:88vh; overflow-y:auto;">
                    <h3 id="qn-answer-title">问卷</h3>
                    <div id="qn-answer-list"></div>
                    <button type="button" id="qn-answer-submit" class="btn btn-primary">提交</button>
                </div>
            </div>
            <div id="qn-result-modal" class="modal-overlay">
                <div class="modal-window" style="max-height:88vh; overflow-y:auto;">
                    <h3 id="qn-result-title">问卷</h3>
                    <div id="qn-result-list"></div>
                </div>
            </div>`);
    }
    const grid = document.querySelector('#chat-expansion-panel .expansion-grid');
    if (grid && !document.getElementById('qn-btn')) {
        grid.insertAdjacentHTML('beforeend', `
            <div class="expansion-item" id="qn-btn">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h6.525q.5 0 .75.313t.25.687t-.262.688T11.5 5H5v14h14v-6.525q0-.5.313-.75t.687-.25t.688.25t.312.75V19q0 .825-.587 1.413T19 21zm4-7v-2.425q0-.4.15-.763t.425-.637l8.6-8.6q.3-.3.675-.45t.75-.15q.4 0 .763.15t.662.45L22.425 3q.275.3.425.663T23 4.4t-.137.738t-.438.662l-8.6 8.6q-.275.275-.637.438t-.763.162H10q-.425 0-.712-.288T9 14m12.025-9.6l-1.4-1.4zM11 13h1.4l5.8-5.8l-.7-.7l-.725-.7L11 11.575zm6.5-6.5l-.725-.7zl.7.7z"/></svg>
                </div>
                <span class="expansion-item-name">问卷</span>
            </div>`);
        const qnBtn = document.getElementById('qn-btn');
        const redPacketBtn = grid.querySelector('#red-packet-btn');
        if (qnBtn && redPacketBtn) grid.insertBefore(qnBtn, redPacketBtn);
    }
}

function setupQuestionnaireSystem() {
    injectQnUi();
    document.getElementById('qn-btn')?.addEventListener('click', openQnManager);
    ['qn-manager-modal', 'qn-editor-modal', 'qn-answer-modal', 'qn-result-modal'].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('visible'); });
    });
    document.getElementById('qn-new-btn')?.addEventListener('click', () => openQnEditor(null));
    document.getElementById('qn-editor-add')?.addEventListener('click', () => addQnEditorRow(''));
    // 一次粘贴多道题：每行一题，自动去掉“1.”“1、”“Q1：”“①”“-”等序号，并自动补足输入框
    document.getElementById('qn-editor-questions')?.addEventListener('paste', (e) => {
        const input = e.target.closest && e.target.closest('.qn-editor-q');
        if (!input) return;
        const raw = (e.clipboardData && e.clipboardData.getData('text')) || '';
        const lines = raw.split(/\r?\n/)
            .map(l => l.replace(/^\s*(?:[（(]?\d{1,3}[)）]|\d{1,3}\s*[.、．:：）)]|[Qq]\s*\d{1,3}\s*[.、．:：）)]?|第\s*\d{1,3}\s*[题題问問]\s*[.、．:：]?|[①-⑳]|[-*•·▪●]\s)\s*/, '').trim())
            .filter(Boolean);
        if (lines.length < 2) return; // 单行粘贴按原样处理
        e.preventDefault();
        const wrap = document.getElementById('qn-editor-questions');
        let rows = Array.from(wrap.querySelectorAll('.qn-editor-row'));
        const startIdx = rows.indexOf(input.closest('.qn-editor-row'));
        let at = input.value.trim() ? startIdx + 1 : startIdx; // 当前格有内容就从下一格开始填
        let added = 0, skipped = 0;
        for (const text of lines) {
            let row = wrap.querySelectorAll('.qn-editor-row')[at];
            if (!row) {
                if (wrap.children.length >= QN_MAX_QUESTIONS) { skipped++; continue; }
                addQnEditorRow('');
                row = wrap.querySelectorAll('.qn-editor-row')[at];
            }
            const q = row.querySelector('.qn-editor-q');
            if (q.value.trim() && at !== startIdx) {
                // 后面已有内容的格子不覆盖：在其前面插入新行
                if (wrap.children.length >= QN_MAX_QUESTIONS) { skipped++; continue; }
                addQnEditorRow('');
                const fresh = wrap.lastElementChild;
                wrap.insertBefore(fresh, row);
                row = fresh;
            }
            row.querySelector('.qn-editor-q').value = text.slice(0, 80);
            at++; added++;
        }
        renumberQnEditorRows();
        showToast(skipped ? `已填入 ${added} 道题，最多 ${QN_MAX_QUESTIONS} 道，其余 ${skipped} 道没有加入` : `已自动填入 ${added} 道题`);
    });
    document.getElementById('qn-editor-questions')?.addEventListener('click', (e) => {
        const del = e.target.closest('.qn-editor-del');
        if (!del) return;
        const wrap = document.getElementById('qn-editor-questions');
        if (wrap.children.length <= 1) return;
        del.closest('.qn-editor-row')?.remove();
        renumberQnEditorRows();
    });
    document.getElementById('qn-editor-save')?.addEventListener('click', async () => {
        const draft = await saveQnDraftFromEditor();
        if (!draft) return;
        document.getElementById('qn-editor-modal').classList.remove('visible');
        renderQnManager();
        document.getElementById('qn-manager-modal').classList.add('visible');
        showToast('草稿已保存');
    });
    document.getElementById('qn-editor-send')?.addEventListener('click', async () => {
        const draft = await saveQnDraftFromEditor();
        if (!draft) return;
        document.getElementById('qn-editor-modal').classList.remove('visible');
        if (await sendQuestionnaire(draft)) showToast('问卷已发送');
    });
    document.getElementById('qn-draft-list')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-qn-draft-act]');
        const item = e.target.closest('.qn-draft-item');
        const chat = getVoteChat();
        if (!btn || !item || !chat) return;
        const drafts = qnGetDrafts(chat);
        const draft = drafts.find(d => d.id === item.dataset.draftId);
        if (!draft) return;
        const act = btn.dataset.qnDraftAct;
        if (act === 'edit') openQnEditor(draft.id);
        if (act === 'send') {
            document.getElementById('qn-manager-modal').classList.remove('visible');
            if (await sendQuestionnaire(draft)) showToast('问卷已发送');
        }
        if (act === 'delete') {
            if (!confirm(`删除草稿“${draft.title || '无标题'}”？（已发到聊天里的问卷不受影响）`)) return;
            chat.questionnaireDrafts = drafts.filter(d => d.id !== draft.id);
            await saveData();
            renderQnManager();
        }
    });
    // 已完成的问卷：点一下查看答案；长按出现“删除”
    const doneList = document.getElementById('qn-done-list');
    let qnPressTimer = null;
    let qnLongPressed = false;
    const qnClearPress = () => { clearTimeout(qnPressTimer); qnPressTimer = null; };
    const qnStartPress = (e) => {
        const item = e.target.closest && e.target.closest('.qn-done-item');
        if (!item || e.target.closest('.qn-done-del')) return;
        qnLongPressed = false;
        qnClearPress();
        qnPressTimer = setTimeout(() => {
            qnLongPressed = true;
            doneList.querySelectorAll('.qn-done-item.show-del').forEach(el => { if (el !== item) el.classList.remove('show-del'); });
            item.classList.add('show-del');
        }, 550);
    };
    doneList?.addEventListener('touchstart', qnStartPress, { passive: true });
    doneList?.addEventListener('mousedown', qnStartPress);
    ['touchend', 'touchmove', 'touchcancel', 'mouseup', 'mouseleave'].forEach(ev => doneList?.addEventListener(ev, qnClearPress, { passive: true }));
    doneList?.addEventListener('contextmenu', (e) => { if (e.target.closest('.qn-done-item')) e.preventDefault(); });
    doneList?.addEventListener('click', async (e) => {
        const item = e.target.closest('.qn-done-item');
        if (!item) return;
        if (qnLongPressed) { qnLongPressed = false; return; }
        if (e.target.closest('.qn-done-del')) {
            const chat = getVoteChat();
            if (!chat) return;
            const msg = chat.history.find(m => m.id === item.dataset.qnMsgId);
            if (!msg || !msg.qn) return;
            if (!confirm(`删除问卷“${msg.qn.title || '无标题'}”？聊天里的这张问卷卡片和已保存的答案会一起删除。`)) return;
            chat.history = chat.history.filter(m => m.id !== msg.id);
            await saveData();
            renderQnManager();
            if (typeof renderMessages === 'function') renderMessages(false, false);
            if (typeof renderChatList === 'function') renderChatList();
            showToast('问卷已删除');
            return;
        }
        if (item.classList.contains('show-del')) { item.classList.remove('show-del'); return; }
        openQnResult(item.dataset.qnMsgId);
    });
    document.getElementById('qn-answer-submit')?.addEventListener('click', submitQnAnswers);

    const area = document.getElementById('message-area');
    area?.addEventListener('click', (e) => {
        if (typeof isDebugMode !== 'undefined' && isDebugMode) return;
        if (typeof isInMultiSelectMode !== 'undefined' && isInMultiSelectMode) return;
        const bi = e.target.closest && e.target.closest('.vote-card-title .qn-bi');
        if (bi) { bi.classList.toggle('qn-bi-collapsed'); return; }
        const btn = e.target.closest && e.target.closest('.qn-card .qn-action');
        if (!btn || btn.disabled) return;
        const wrapper = btn.closest('.message-wrapper');
        if (!wrapper) return;
        if (btn.dataset.qnAct === 'fill') openQnAnswer(wrapper.dataset.id);
        if (btn.dataset.qnAct === 'view') openQnResult(wrapper.dataset.id);
    });
}
