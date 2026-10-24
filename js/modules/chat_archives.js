// --- 聊天存档与分支 ---

const CHAT_ARCHIVE_META_KEYS = new Set([
    'id', 'archives', 'activeArchiveId', 'isPinned', 'unreadCount',
    'realName', 'remarkName', 'name', 'avatar', 'folderId', 'folderIds'
]);

function cloneArchiveValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function createArchiveId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `archive_${crypto.randomUUID()}`;
    }
    return `archive_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentChatEntity() {
    if (!currentChatId || !currentChatType) return null;
    return currentChatType === 'private'
        ? db.characters.find(character => character.id === currentChatId)
        : db.groups.find(group => group.id === currentChatId);
}

function captureArchiveData(chat) {
    const data = {};
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) {
            data[key] = cloneArchiveValue(chat[key]);
        }
    });
    return data;
}

function getArchiveLatestTime(data) {
    const history = Array.isArray(data.history) ? data.history : [];
    const journals = Array.isArray(data.memoryJournals) ? data.memoryJournals : [];
    const lastMessage = history.length ? Number(history[history.length - 1].timestamp) || 0 : 0;
    const lastJournal = journals.reduce((latest, journal) => Math.max(latest, Number(journal.createdAt) || 0), 0);
    return Math.max(lastMessage, lastJournal);
}

function ensureChatArchives(chat) {
    if (!chat) return false;
    let changed = false;

    if (!Array.isArray(chat.archives) || chat.archives.length === 0) {
        const now = Date.now();
        const archive = {
            id: createArchiveId(),
            name: '主存档',
            createdAt: now,
            updatedAt: Math.max(getArchiveLatestTime(chat), now),
            origin: null,
            data: captureArchiveData(chat)
        };
        chat.archives = [archive];
        chat.activeArchiveId = archive.id;
        changed = true;
    }

    if (!chat.archives.some(archive => archive.id === chat.activeArchiveId)) {
        chat.activeArchiveId = chat.archives[0].id;
        changed = true;
    }

    // The active archive is already represented by the chat's top-level fields.
    // Older saves duplicated the full history/settings inside activeArchive.data.
    // Keep inactive archive snapshots, but discard this redundant active copy.
    const activeArchive = chat.archives.find(archive => archive.id === chat.activeArchiveId);
    if (activeArchive && activeArchive.data && Object.keys(activeArchive.data).length) {
        activeArchive.data = {};
        changed = true;
    }

    return changed;
}

function ensureAllChatArchives() {
    let changed = false;
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        if (ensureChatArchives(chat)) changed = true;
    });
    return changed;
}

function syncChatActiveArchive(chat, touch = false) {
    if (!chat) return;
    ensureChatArchives(chat);
    const archive = chat.archives.find(item => item.id === chat.activeArchiveId);
    if (!archive) return;

    const data = captureArchiveData(chat);
    const previousLatest = getArchiveLatestTime(archive.data || {});
    const nextLatest = getArchiveLatestTime(data);
    archive.data = data;
    if (touch || nextLatest !== previousLatest) {
        archive.updatedAt = Math.max(Date.now(), nextLatest);
    }
}

function syncAllActiveArchives() {
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        // The top-level chat record is canonical for the active archive.
        // Snapshot it only when leaving/switching/branching (those paths call
        // syncChatActiveArchive explicitly), not on every saveData() call.
        ensureChatArchives(chat);
    });
}

function applyArchiveData(chat, archive) {
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) delete chat[key];
    });
    Object.assign(chat, cloneArchiveValue(archive.data || {}));
    chat.activeArchiveId = archive.id;
}

function getActiveArchive(chat) {
    if (!chat) return null;
    ensureChatArchives(chat);
    return chat.archives.find(archive => archive.id === chat.activeArchiveId) || chat.archives[0];
}

function resetArchiveRuntime(data) {
    data.history = [];
    data.memoryJournals = [];
    data.callHistory = [];
    data.lastUserMessageTimestamp = null;
    data.status = '在线';
    data.peekData = {};
    data.gallery = [];

    if (data.statusPanel) {
        data.statusPanel.currentStatusRaw = '';
        data.statusPanel.currentStatusHtml = '';
        data.statusPanel.history = [];
    }
    if (data.autoReply) data.autoReply.lastTriggerTime = 0;
    if (data.privateSessions) data.privateSessions = {};
    if (data.gossipSessions) data.gossipSessions = {};
    return data;
}

function makeArchiveName(prefix) {
    const now = new Date();
    const date = `${now.getMonth() + 1}月${now.getDate()}日`;
    return `${prefix} · ${date}`;
}

async function createBlankArchive() {
    const chat = getCurrentChatEntity();
    if (!chat) return;
    syncChatActiveArchive(chat, true);

    const suggestedName = makeArchiveName('新存档');
    const name = prompt('存档名称', suggestedName);
    if (name === null) return;

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: null,
        // 当前存档的数据就在聊天对象本身上（active.data 会被清空，不能用它）
        data: resetArchiveRuntime(captureArchiveData(chat))
    };
    try {
        chat.archives.push(archive);
        await switchChatArchive(archive.id);
        showToast('新存档已创建');
    } catch (error) {
        console.error('[Archive] 创建存档失败:', error);
        chat.archives = chat.archives.filter(item => item.id !== archive.id);
        showToast('创建存档失败：' + (error && error.message ? error.message : '未知错误'));
    }
}

function journalBelongsToBranch(journal, includedMessageIds, cutoff) {
    if (journal.imported) return true;
    if (journal.startMessageId && journal.endMessageId) {
        return includedMessageIds.has(journal.startMessageId) && includedMessageIds.has(journal.endMessageId);
    }
    return journal.range && Number(journal.range.end) <= cutoff;
}

async function createBranchArchiveAtMessage(messageId) {
    const chat = getCurrentChatEntity();
    if (!chat || !Array.isArray(chat.history)) return;
    const branchIndex = chat.history.findIndex(message => message.id === messageId);
    if (branchIndex < 0) return;

    syncChatActiveArchive(chat, true);
    const sourceArchive = getActiveArchive(chat);
    const suggestedName = makeArchiveName('分支');
    const name = prompt('分支存档名称', suggestedName);
    if (name === null) return;

    // 当前存档的数据就在聊天对象本身上（sourceArchive.data 会被清空，不能用它）
    const data = captureArchiveData(chat);
    data.history = (data.history || []).slice(0, branchIndex + 1);
    const includedMessageIds = new Set(data.history.map(message => message.id));
    data.memoryJournals = (data.memoryJournals || []).filter(journal =>
        journalBelongsToBranch(journal, includedMessageIds, branchIndex + 1)
    );
    data.callHistory = (data.callHistory || []).filter(call => !call.timestamp || call.timestamp <= (data.history[branchIndex].timestamp || Infinity));
    data.lastUserMessageTimestamp = [...data.history].reverse().find(message => message.role === 'user')?.timestamp || null;

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: {
            archiveId: sourceArchive.id,
            archiveName: sourceArchive.name,
            messageId,
            createdAt: now
        },
        data
    };
    try {
        chat.archives.push(archive);
        await switchChatArchive(archive.id);
        showToast('分支存档已创建');
    } catch (error) {
        console.error('[Archive] 创建分支存档失败:', error);
        chat.archives = chat.archives.filter(item => item.id !== archive.id);
        showToast('创建分支失败：' + (error && error.message ? error.message : '未知错误'));
    }
}

async function switchChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.activeArchiveId === archiveId) {
        closeArchiveManager();
        return;
    }

    syncChatActiveArchive(chat, true);
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive) return;
    applyArchiveData(chat, archive);
    await saveData();
    closeArchiveManager();
    openChatRoom(currentChatId, currentChatType);
}

async function renameChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    const archive = chat?.archives.find(item => item.id === archiveId);
    if (!archive) return;
    const name = prompt('修改存档名称', archive.name);
    if (name === null || !name.trim()) return;
    archive.name = name.trim();
    archive.updatedAt = Date.now();
    await saveData();
    renderArchiveManager();
}

async function deleteChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.archives.length <= 1) {
        showToast('至少保留一个存档');
        return;
    }
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive || !confirm(`确定删除“${archive.name}”吗？该操作不可恢复。`)) return;

    if (chat.activeArchiveId === archiveId) {
        syncChatActiveArchive(chat, true);
        const fallback = chat.archives.find(item => item.id !== archiveId);
        chat.archives = chat.archives.filter(item => item.id !== archiveId);
        applyArchiveData(chat, fallback);
        await saveData();
        closeArchiveManager();
        openChatRoom(currentChatId, currentChatType);
        showToast('存档已删除');
        return;
    }

    chat.archives = chat.archives.filter(item => item.id !== archiveId);
    await saveData();
    renderArchiveManager();
    showToast('存档已删除');
}

function formatArchiveTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderArchiveManager() {
    const chat = getCurrentChatEntity();
    const list = document.getElementById('chat-archive-list');
    if (!chat || !list) return;
    syncChatActiveArchive(chat, false);

    list.innerHTML = chat.archives
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(archive => {
            const active = archive.id === chat.activeArchiveId;
            const activeData = active ? chat : (archive.data || {});
            const messageCount = activeData.history?.length || 0;
            const journalCount = activeData.memoryJournals?.length || 0;
            const origin = archive.origin ? `<div class="archive-origin">来自：${escapeHtml(archive.origin.archiveName || '其他存档')}</div>` : '';
            return `
                <article class="chat-archive-card ${active ? 'active' : ''}" data-archive-id="${archive.id}">
                    <div class="archive-card-main">
                        <div class="archive-name-row">
                            <strong>${escapeHtml(archive.name)}</strong>
                            ${active ? '<span class="archive-active-tag">当前</span>' : ''}
                        </div>
                        <div class="archive-meta">${messageCount} 条消息 · ${journalCount} 篇日记 · ${formatArchiveTime(archive.updatedAt)}</div>
                        ${origin}
                    </div>
                    <div class="archive-actions">
                        ${active ? '' : '<button type="button" data-action="switch">进入</button>'}
                        <button type="button" data-action="rename">改名</button>
                        <button type="button" data-action="delete" class="danger">删除</button>
                    </div>
                </article>`;
        }).join('');
}

function openArchiveManager() {
    const overlay = document.getElementById('chat-archive-overlay');
    if (!overlay) return;
    renderArchiveManager();
    overlay.classList.add('visible');
}

function closeArchiveManager() {
    document.getElementById('chat-archive-overlay')?.classList.remove('visible');
}

function injectArchiveUi() {
    if (!document.getElementById('chat-archive-overlay')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="chat-archive-overlay" class="chat-archive-overlay" aria-hidden="true">
                <section class="chat-archive-panel" role="dialog" aria-modal="true" aria-label="存档管理">
                    <header class="archive-panel-header">
                        <button type="button" id="close-chat-archives">‹</button>
                        <h2>存档管理</h2>
                        <button type="button" id="create-chat-archive">新建</button>
                    </header>
                    <p class="archive-help">新建存档会复用当前设置、人设和世界书绑定，但从空白聊天开始。</p>
                    <div id="chat-archive-list" class="chat-archive-list"></div>
                </section>
            </div>`);
    }

    const grids = document.querySelectorAll('#chat-expansion-panel .expansion-grid');
    const grid = grids[0];
    if (grid && !document.getElementById('chat-archives-btn')) {
        grid.insertAdjacentHTML('beforeend', `
            <div class="expansion-item" id="chat-archives-btn">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v4H4V4m1 6h14v10H5V10m4 2v2h6v-2H9z"/></svg>
                </div>
                <span class="expansion-item-name">存档</span>
            </div>
            <div class="expansion-item" id="pause-ai-btn" role="button" tabindex="0" aria-label="暂停回复调用">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 21C10.22 21 8.47991 20.4722 6.99987 19.4832C5.51983 18.4943 4.36628 17.0887 3.68509 15.4442C3.0039 13.7996 2.82567 11.99 3.17294 10.2442C3.5202 8.49836 4.37737 6.89472 5.63604 5.63604C6.89472 4.37737 8.49836 3.5202 10.2442 3.17294C11.99 2.82567 13.7996 3.0039 15.4442 3.68509C17.0887 4.36628 18.4943 5.51943 19.4832 6.99987C20.4722 8.47991 21 10.22 21 12C21 14.387 20.0518 16.6761 18.364 18.364C16.6761 20.0518 14.387 21 12 21ZM12 4.5C10.5166 4.5 9.0666 4.93987 7.83323 5.76398C6.59986 6.58809 5.63856 7.75943 5.07091 9.12988C4.50325 10.5003 4.35473 12.0083 4.64411 13.4632C4.9335 14.918 5.64781 16.2544 6.6967 17.3033C7.7456 18.3522 9.08197 19.0665 10.5368 19.3559C11.9917 19.6453 13.4997 19.4968 14.8701 18.9291C16.2406 18.3614 17.4119 17.4001 18.236 16.1668C19.0601 14.9334 19.5 13.4834 19.5 12C19.5 10.0109 18.7098 8.10323 17.3033 6.6967C15.8968 5.29018 13.9891 4.5 12 4.5Z"/>
                        <path d="M14.5 8H9.5C8.67157 8 8 8.67157 8 9.5V14.5C8 15.3284 8.67157 16 9.5 16H14.5C15.3284 16 16 15.3284 16 14.5V9.5C16 8.67157 15.3284 8 14.5 8Z"/>
                    </svg>
                </div>
                <span class="expansion-item-name">暂停</span>
            </div>`);

        // 不改变原有功能按钮的顺序：存档和暂停都放到原本隐藏的红包按钮之前，
        // 这样第二页原有可见按钮的位置完全不动，存档与暂停占用最后两个空位。
        const archiveBtn = document.getElementById('chat-archives-btn');
        const pauseBtn = document.getElementById('pause-ai-btn');
        const redPacketBtn = grid.querySelector('#red-packet-btn');
        if (archiveBtn && pauseBtn) {
            if (redPacketBtn) {
                grid.insertBefore(archiveBtn, redPacketBtn);
                grid.insertBefore(pauseBtn, redPacketBtn);
            } else {
                grid.appendChild(archiveBtn);
                grid.appendChild(pauseBtn);
            }
        }
    }
}

function setupChatArchiveSystem() {
    injectArchiveUi();
    document.getElementById('chat-archives-btn')?.addEventListener('click', openArchiveManager);
    document.getElementById('pause-ai-btn')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof stopAiReply === 'function') stopAiReply();
    });
    document.getElementById('close-chat-archives')?.addEventListener('click', closeArchiveManager);
    document.getElementById('create-chat-archive')?.addEventListener('click', createBlankArchive);
    document.getElementById('chat-archive-overlay')?.addEventListener('click', event => {
        if (event.target.id === 'chat-archive-overlay') closeArchiveManager();
    });
    document.getElementById('chat-archive-list')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        const card = event.target.closest('.chat-archive-card');
        if (!button || !card) return;
        const archiveId = card.dataset.archiveId;
        if (button.dataset.action === 'switch') switchChatArchive(archiveId);
        if (button.dataset.action === 'rename') renameChatArchive(archiveId);
        if (button.dataset.action === 'delete') deleteChatArchive(archiveId);
    });
}
