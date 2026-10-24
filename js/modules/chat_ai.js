// --- AI 交互模块 ---

let activeAiAbortController = null;
// 暂停按钮：回复已经收完、正在一条条显示时，也要能中途停下来（abort 只能中断网络请求）。
let aiStopGeneration = 0;
let aiDisplayingReply = false;

const HUMAN_RUN_PROMPT = `<角色活人运转>\n## [PSYCHOLOGY: HEXACO-SCHEMA-ACT]\n> Personality: HEXACO-driven, dynamic traits, inner conflicts required \n> Filter: schema-bias drives emotion; no pure reaction allowed \n> Attachment: secure/insecure logic must govern intimacy  \n> If-Then Behavior: situation-dependent activation of traits only  \n---\n    ## [VITALITY]\n+inconsistency +emoflux +splitmotifs +microreact +minddrift\n---\n## [TRAJECTORY-COHERENCE]\n> Role maintains an identity narrative = coherent over time  \n> No mood/goal switch without contradiction resolution \n> Every action must protect or challenge self-concept  \n> Interrupts = inner conflict or narrative clash  \n> Output = filtered through “who I am” logic\n</角色活人运转>`;

// AI 交互逻辑
async function getAiReply(chatId, chatType, isBackground = false) {
    if (isGenerating && !isBackground) return; 
    
    if (!isBackground) {
        if (db.globalSendSound) {
            playSound(db.globalSendSound);
        } else {
            AudioManager.unlock();
        }
    }

    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    // 记录本次请求的发起时间：回复成功后，据此判断角色「看到」了哪些用户动态。
    window.__aiReqStart = window.__aiReqStart || {};
    window.__aiReqStart[chatId] = Date.now();

    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings, // 继承全局设置（如 streamEnabled 等）
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider,
                temperatureEnabled: preset.data.temperatureEnabled !== undefined ? preset.data.temperatureEnabled : db.apiSettings.temperatureEnabled,
                temperature: preset.data.temperature !== undefined ? preset.data.temperature : db.apiSettings.temperature
            };
        }
    }

    // 自动消息（主动消息）可以改用副 API，节省主 API 额度；没勾选就保持原样。
    if (isBackground) apiConfig = resolveAuxiliaryApiConfig('autoMessage', apiConfig);

    let {url, key, model, provider, streamEnabled} = apiConfig;
    const cloudflareBackendEnabled = window.UwUBackendAdapter && window.UwUBackendAdapter.isCloudflareEnabled();
    if (!url || !key || !model) {
        // Cloudflare 模式由 Worker 持有真正的 AI API 配置，前端可以不填写本地 API。
        if (!cloudflareBackendEnabled) {
            if (!isBackground) {
                showToast('请先在“api”应用中完成设置！');
                switchScreen('api-settings-screen');
            }
            return;
        }
        provider = provider || 'newapi';
        streamEnabled = false;
    }

    // 确保 BLOCKED_API_DOMAINS 存在
    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (url && blockedDomains.some(domain => url.includes(domain))) {
        if (!isBackground) showToast('当前 API 站点已被屏蔽，无法发送消息！');
        return;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    let claimedBackendJobId = '';
    let aiAbortController = null;
    if (!isBackground) {
        isGenerating = true;
        aiAbortController = new AbortController();
        activeAiAbortController = aiAbortController;
        getReplyBtn.disabled = true;
        regenerateBtn.disabled = true;
        const typingName = chatType === 'private' ? chat.remarkName : chat.name;
        typingIndicator.textContent = `“${typingName}”正在输入中...`;
        typingIndicator.style.display = 'block';
        messageArea.scrollTop = messageArea.scrollHeight;
    }

    try {
        let systemPrompt, requestBody;
        if (chatType === 'private') {
            systemPrompt = generatePrivateSystemPrompt(chat);
        } else {
            // generateGroupSystemPrompt 应该在 group_chat.js 中定义
            if (typeof generateGroupSystemPrompt === 'function') {
                systemPrompt = generateGroupSystemPrompt(chat);
            } else {
                systemPrompt = "Group chat system prompt not available.";
            }
        }

        let historySlice = chat.history.slice(-chat.maxMemory);
        
        // 使用工具函数进行过滤（包含深度克隆、屏蔽过滤、双语修正、状态栏剔除）
        historySlice = filterHistoryForAI(chat, historySlice);
        // 【新增】过滤掉不应进入上下文的消息（如思考过程、被撤回的消息标记等）
        historySlice = historySlice.filter(m => !m.isContextDisabled);
        
        // 【双重保险】再次过滤掉内容匹配 <thinking> 的消息，防止 isContextDisabled 属性丢失
        historySlice = historySlice.filter(m => {
            if (m.isThinking) return false;
            if (m.content && typeof m.content === 'string' && m.content.trim().startsWith('<thinking>')) return false;
            return true;
        });

        // 检查系统提示词中是否包含聊天记录占位符
        const hasHistoryPlaceholder = systemPrompt.includes('【动态插入: 聊天记录】');
        
        if (!hasHistoryPlaceholder) {
            // 如果没有占位符（如默认的 UwU 版本），则将提示语加在末尾
            systemPrompt += "\n\n以下为当前聊天记录：\n";
        }

        if (provider === 'gemini') {
            let lastMsgTimeForAI = 0;
            let lastTimeMarkerForAI = 0;
            const contents = historySlice.map(msg => {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                
                let prefix = '';
                const currentMsgTime = msg.timestamp;
                const timeDiff = currentMsgTime - lastMsgTimeForAI;
                const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();
               
               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                   
                   prefix = `[system: ${timeStr}]`;
                   
                   if (db.apiSettings && db.apiSettings.timePerceptionEnabled && timeDiff > 30 * 60 * 1000 && lastMsgTimeForAI !== 0) {
                       prefix += `\n[system: 距离上次互动已过去 ${formatTimeGap(timeDiff)}。话题可能已中断，请自然地开启新话题或对时间流逝做出反应。]`;
                   }
                   
                   prefix += '\n';
                   lastTimeMarkerForAI = currentMsgTime;
               }
                lastMsgTimeForAI = currentMsgTime;

                let parts;
                if (msg.parts && msg.parts.length > 0) {
                    parts = msg.parts.map(p => {
                        if (p.type === 'text' || p.type === 'html') {
                            return {text: p.text};
                        } else if (p.type === 'image') {
                            const match = p.data.match(/^data:(image\/(.+));base64,(.*)$/);
                            if (match) {
                                return {inline_data: {mime_type: match[1], data: match[3]}};
                            }
                        }
                        return null;
                    }).filter(p => p);
                } else {
                    parts = [{text: msg.content}];
                }

                if (prefix) {
                    if (parts.length > 0 && parts[0].text) {
                        parts[0].text = prefix + parts[0].text;
                    } else {
                        parts.unshift({text: prefix});
                    }
                }

                return {role, parts};
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserEndIndex = -1;
            for (let i = contents.length - 1; i >= 0; i--) {
                if (contents[i].role === 'user') {
                    lastUserEndIndex = i;
                    break;
                }
            }
            if (lastUserEndIndex !== -1) {
                let firstUserStartIndex = lastUserEndIndex;
                while (firstUserStartIndex > 0 && contents[firstUserStartIndex - 1].role === 'user') {
                    firstUserStartIndex--;
                }
                
                let firstParts = contents[firstUserStartIndex].parts;
                if (firstParts.length > 0 && firstParts[0].text !== undefined) {
                    firstParts[0].text = "<user_input>\n" + firstParts[0].text;
                } else {
                    firstParts.unshift({text: "<user_input>\n"});
                }
                
                let lastParts = contents[lastUserEndIndex].parts;
                if (lastParts.length > 0 && lastParts[lastParts.length - 1].text !== undefined) {
                    lastParts[lastParts.length - 1].text += "\n</user_input>";
                } else {
                    lastParts.push({text: "\n</user_input>"});
                }
            }

            if (isBackground) {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：距离上次互动已有一段时间。请以${chat.realName}的身份主动发起新话题，或自然地延续之前的对话。]` }]
                });
            } else if (historySlice.length > 0 && historySlice[historySlice.length - 1].role === 'assistant') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]` }]
                });
            }

            // 如果有占位符，在 Gemini 模式下，我们将聊天记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 提取除了最后一条用户消息之外的所有历史记录
                let historyContents = [];
                let lastUserContent = null;
                
                if (contents.length > 0) {
                    // 找到最后一条用户消息
                    let lastUserIndex = -1;
                    for (let i = contents.length - 1; i >= 0; i--) {
                        if (contents[i].role === 'user') {
                            lastUserIndex = i;
                            break;
                        }
                    }
                    
                    if (lastUserIndex !== -1) {
                        historyContents = contents.slice(0, lastUserIndex);
                        lastUserContent = contents.slice(lastUserIndex); // 包含最后一条用户消息及其后的系统通知等
                    } else {
                        historyContents = contents;
                    }
                }

                historyContents.forEach(c => {
                    const roleName = c.role === 'model' ? chat.realName : chat.myName;
                    const text = c.parts.map(p => p.text || '').join('');
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                });
                historyTextForPlaceholder += "</chat_history>";
                systemPrompt = systemPrompt.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                
                // 清空原有的 contents，只保留最后一条用户消息
                if (lastUserContent) {
                    contents = lastUserContent;
                } else {
                    contents = [];
                }
            }

            requestBody = {
                contents: contents,
                system_instruction: {parts: [{text: systemPrompt}]},
                generationConfig: {
                    temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
                }
            };
        } else {
            const messages = [{role: 'system', content: systemPrompt}];
            
            const pushOrMergeMessage = (role, content) => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage && lastMessage.role === role && role !== 'system') {
                    if (typeof lastMessage.content === 'string' && typeof content === 'string') {
                        lastMessage.content += '\n' + content;
                    } else {
                        let lastContentArr = Array.isArray(lastMessage.content) ? lastMessage.content : [{type: 'text', text: lastMessage.content}];
                        let newContentArr = Array.isArray(content) ? content : [{type: 'text', text: content}];
                        
                        const lastItem = lastContentArr[lastContentArr.length - 1];
                        const firstNewItem = newContentArr[0];
                        
                        if (lastItem.type === 'text' && firstNewItem.type === 'text') {
                            lastItem.text += '\n' + firstNewItem.text;
                            lastContentArr = lastContentArr.concat(newContentArr.slice(1));
                        } else {
                            if (lastItem.type === 'text') {
                                lastItem.text += '\n';
                            } else {
                                lastContentArr.push({type: 'text', text: '\n'});
                            }
                            lastContentArr = lastContentArr.concat(newContentArr);
                        }
                        lastMessage.content = lastContentArr;
                    }
                } else {
                    messages.push({role: role, content: content});
                }
            };

            let lastTimeMarkerForAI = 0;
            
            historySlice.forEach(msg => {
               let content;
               let prefix = '';
               
               const currentMsgTime = msg.timestamp;
               const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();
               
               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                   prefix = `[system: ${timeStr}]\n`;
                   lastTimeMarkerForAI = currentMsgTime;
               }

               if (msg.role === 'user' && msg.quote) {
                   const replyTextMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                   const replyText = replyTextMatch ? replyTextMatch[1] : msg.content;
                   
                   content = `${prefix}[${chat.myName}引用“${msg.quote.content}”并回复：${replyText}]`;
                   pushOrMergeMessage('user', content);

               } else {
                   if (msg.parts && msg.parts.length > 0) {
                       let prefixAdded = false;
                       
                       content = msg.parts.map(p => {
                           if (p.type === 'text' || p.type === 'html') {
                               const textContent = (!prefixAdded) ? (prefix + p.text) : p.text;
                               prefixAdded = true;
                               return {type: 'text', text: textContent};
                           } else if (p.type === 'image') {
                               return {type: 'image_url', image_url: {url: p.data}};
                           }
                           return null;
                       }).filter(p => p);
                   } else {
                       content = prefix + msg.content;
                   }
                   
                   pushOrMergeMessage(msg.role, content);
               }
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    lastUserIndex = i;
                    break;
                }
            }
            if (lastUserIndex !== -1) {
                let msg = messages[lastUserIndex];
                if (typeof msg.content === 'string') {
                    msg.content = "<user_input>\n" + msg.content + "\n</user_input>";
                } else if (Array.isArray(msg.content)) {
                    msg.content.unshift({type: 'text', text: "<user_input>\n"});
                    msg.content.push({type: 'text', text: "\n</user_input>"});
                }
            }

            // 如果有占位符，将 messages 数组中的历史记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 找到最后一条用户消息的索引
                let lastUserIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') {
                        lastUserIndex = i;
                        break;
                    }
                }

                // 提取历史记录（跳过第一个 system 消息，且不包含最后一条用户消息）
                const endIndex = lastUserIndex !== -1 ? lastUserIndex : messages.length;
                for (let i = 1; i < endIndex; i++) {
                    const msg = messages[i];
                    const roleName = msg.role === 'assistant' ? chat.realName : chat.myName;
                    let text = '';
                    if (typeof msg.content === 'string') {
                        text = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        text = msg.content.map(p => p.text || '').join('');
                    }
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                }
                historyTextForPlaceholder += "</chat_history>";
                
                // 替换 system 消息中的占位符
                if (messages.length > 0 && messages[0].role === 'system') {
                    messages[0].content = messages[0].content.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                }

                // 清空原有的历史记录，只保留 system 消息和最后一条用户消息
                if (lastUserIndex !== -1) {
                    const systemMsg = messages[0];
                    const lastUserMsgs = messages.slice(lastUserIndex);
                    messages.length = 0; // 清空数组
                    messages.push(systemMsg, ...lastUserMsgs);
                } else {
                    // 如果没有用户消息，只保留 system 消息
                    messages.splice(1);
                }
            }

            // === 【第三步：处理后台通知与 CoT 序列】 ===
            
            // 1. 如果是后台消息，先插入系统通知（作为任务输入）
            if (isBackground) {
                pushOrMergeMessage('user', `[系统通知：我已有一段时间没有和你互动了，请以${chat.realName}的身份主动地延续之前的对话或发起新话题，或对时间流逝做出反应。]`);
            } else if (historySlice.length > 0 && historySlice[historySlice.length - 1].role === 'assistant') {
                pushOrMergeMessage('user', `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]`);
            }

            // 2. 插入 CoT 序列（无论前台后台，只要开启就插入）
            const cotEnabled = db.cotSettings && db.cotSettings.enabled;
            
            if (cotEnabled) {
                let cotInstruction = '';
                // 优先使用角色专属 CoT 预设
                let activePresetId = 'default';
                if (chat.exclusiveCotPreset) {
                    activePresetId = chat.exclusiveCotPreset;
                } else if (db.cotSettings && db.cotSettings.activePresetId) {
                    activePresetId = db.cotSettings.activePresetId;
                }
                const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
                
                if (preset && preset.items) {
                    cotInstruction = preset.items
                        .filter(item => item.enabled)
                        .map(item => item.content)
                        .join('\n\n');
                }

                if (cotInstruction) {
                    // 1. 插入后置指令
                    messages.push({
                        role: 'system', // 或者 'user'
                        content: cotInstruction
                    });

                    // 2. 插入触发器
                    pushOrMergeMessage('user', '[incipere]');

                    // 3. 插入 Prefill (预填/强塞)
                    const prefillEnabled = db.cotSettings.prefillEnabled !== false;
                    if (prefillEnabled) {
                        pushOrMergeMessage('assistant', '<thinking>');
                    }
                }
            }

            requestBody = {
                model: model, 
                messages: messages, 
                stream: streamEnabled,
                temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
            };
        }
        
        // 格式化打印日志
        let logText = "========== [发送给 AI 的请求内容] ==========\n";
        if (requestBody.messages) {
            requestBody.messages.forEach(msg => {
                logText += `【${msg.role}】:\n`;
                if (typeof msg.content === 'string') {
                    logText += msg.content + "\n\n";
                } else if (Array.isArray(msg.content)) {
                    let textContent = "";
                    msg.content.forEach(part => {
                        if (part.type === 'text') {
                            textContent += part.text;
                        } else if (part.type === 'image_url') {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                    logText += textContent + "\n\n";
                }
            });
        } else if (requestBody.contents) {
            if (requestBody.system_instruction && requestBody.system_instruction.parts) {
                logText += `【system】:\n`;
                requestBody.system_instruction.parts.forEach(part => {
                    logText += (part.text || "") + "\n";
                });
                logText += "\n";
            }
            requestBody.contents.forEach(c => {
                logText += `【${c.role}】:\n`;
                let textContent = "";
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text !== undefined) {
                            textContent += part.text;
                        } else if (part.inline_data) {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                }
                logText += textContent + "\n\n";
            });
        }
        logText += "============================================";
        console.log(logText);

        if (cloudflareBackendEnabled) {
            try {
                const autoReply = chatType === 'private' && chat.autoReply ? {
                    enabled: !!chat.autoReply.enabled,
                    interval: Number(chat.autoReply.interval || 60),
                    lastTriggerTime: Number(chat.autoReply.lastTriggerTime || 0),
                    quietHours: chat.autoReply.quietHours && chat.autoReply.quietHours.enabled ? {
                        enabled: true,
                        start: chat.autoReply.quietHours.start || '00:00',
                        end: chat.autoReply.quietHours.end || '08:00',
                        timezone: chat.autoReply.quietHours.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
                    } : { enabled: false }
                } : { enabled: false };
                await window.UwUBackendAdapter.syncChatState({
                    chatId, chatType, realName: chat.realName || chat.name || '',
                    remarkName: chatType === 'private' ? (chat.remarkName || chat.realName || '') : (chat.name || ''),
                    chatStatusRegex: chatType === 'private' && chat.statusPanel?.enabled ? (chat.statusPanel.regexPattern || '') : '',
                    myName: chat.myName || '用户',
                    requestBody, autoReply
                });
            } catch (syncError) {
                console.warn('[UwUBackend] 同步聊天状态失败：', syncError);
            }
        }
        let response;
        let backendFailure = null;
        if (cloudflareBackendEnabled) {
            try {
                response = await window.UwUBackendAdapter.fetchAI({
                    requestBody, chatId, chatType,
                    chatName: chatType === 'private' ? (chat.remarkName || chat.realName || chat.name || '') : (chat.name || chat.realName || ''),
                    chatStatusRegex: chatType === 'private' && chat.statusPanel?.enabled ? (chat.statusPanel.regexPattern || '') : '',
                    isBackground,
                    signal: aiAbortController ? aiAbortController.signal : undefined
                });
                // Worker 第一版返回普通 JSON，即使用户保留了流式开关也不改变本地模式。
                streamEnabled = false;
            } catch (backendError) {
                console.warn('[UwUBackend] 后台 AI 请求失败，回退本地 API：', backendError);
                backendFailure = backendError;
                if (!isBackground && url && key && model) {
                    const errorName = backendError && backendError.name ? String(backendError.name) : 'Error';
                    const errorMessage = backendError && backendError.message ? String(backendError.message) : String(backendError || '未知错误');
                    showToast(`后台服务暂时不可用，已回退本地 API：${errorName}：${errorMessage}`);
                }
                response = null;
            }
        }

        if (!response && (!url || !key || !model)) {
            throw backendFailure || new Error('Cloudflare 后台服务不可用，且未配置本地 API');
        }

        if (!response) {
            const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
            const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`
            };
            response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                ...(aiAbortController ? { signal: aiAbortController.signal } : {})
            });
        }
        if (!response.ok) {
            const error = new Error(`API Error: ${response.status} ${await response.text()}`);
            error.response = response;
            throw error;
        }

        const backendJobId = response.headers?.get('X-UwU-Job-Id') || '';
        // 认领这条后台回复；若通知同步那边正在处理同一条，这里就不再重复显示。
        const jobClaimed = !backendJobId || window.UwUBackendAdapter.claimJob(backendJobId);
        if (backendJobId && jobClaimed) claimedBackendJobId = backendJobId;
        const alreadyPulledFromBackend = backendJobId && (!jobClaimed || chat.history?.some(item => item.id === backendJobId || item.backendJobId === backendJobId));
        const replyBeforeIds = new Set((chat.history || []).map(item => item.id));
        
        if (alreadyPulledFromBackend) {
            console.log('[UwUBackend] 后台回复已在恢复时同步，跳过重复显示。');
        } else if (streamEnabled) {
            await processStream(response, chat, provider, chatId, chatType, isBackground);
        } else {
            let result;
            try {
                result = await response.json();
                console.log('【API完整响应数据】:', result);
            } catch (e) {
                const text = await response.text();
                console.error("Failed to parse JSON:", text);
                throw new Error(`API返回了非JSON格式数据 (可能是网页HTML)。请检查API地址是否正确。原始内容开头: ${text.substring(0, 50)}...`);
            }

            let fullResponse = "";
            if (provider === 'gemini') {
                fullResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                fullResponse = result.choices[0].message.content;
            }
            
            // === 【补丁：把被吃掉的开头补回来】 ===
            // 仅在 CoT 开启且检测到闭合标签时补全
            const cotEnabled = db.cotSettings && db.cotSettings.enabled;
            // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
            if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
                 if (fullResponse.includes('</thinking>')) {
                     fullResponse = '<thinking>' + fullResponse;
                 }
            }
            // ===================================
            
            
            // Queue replies were generated while the app was suspended; replay all
            // parsed messages immediately when the app returns to the foreground.
            // 后台任务的回复，Worker 完成时已经推送过系统通知，本地不再重复弹。
            const previousSystemSuppression = window.__uwuSuppressSystemNotifications;
            if (backendJobId) window.__uwuSuppressSystemNotifications = true;
            try {
                await handleAiReplyContent(fullResponse, chat, chatId, chatType, isBackground || !!backendJobId);
            } finally {
                window.__uwuSuppressSystemNotifications = previousSystemSuppression;
            }
        }
        if (backendJobId && jobClaimed) {
            const newReplyItems = (chat.history || []).filter(item => !replyBeforeIds.has(item.id));
            for (const item of newReplyItems) item.backendJobId = backendJobId;
            // App 被切到后台时，回复其实早就生成了；时间戳要用后台完成的时间，
            // 而不是切回 App 之后本地处理的时间。
            const completedAt = Number(response.headers?.get('X-UwU-Job-Completed-At'));
            const shift = window.UwUBackendAdapter.alignTimestamps(newReplyItems, completedAt);
            if (shift && Math.abs(shift) > 1000 && currentChatId === chatId && typeof renderMessages === 'function') {
                renderMessages(false, true);
            }
            // 时间改回后台完成的时间后，聊天列表也要刷新，否则列表一直显示「切回来」的时间，要重开 App 才对。
            if (shift && typeof renderChatList === 'function') renderChatList();
            await saveData();
            await window.UwUBackendAdapter.ackAIJob(backendJobId);
        }

    } catch (error) {
        if (error && error.name === 'AbortError') {
            if (!isBackground) showToast('已停止本次回复调用');
        } else if (!isBackground) {
            showApiError(error);
        } else {
            console.error("Background Auto-Reply Error:", error);
        }
    } finally {
        if (claimedBackendJobId) window.UwUBackendAdapter.releaseJob(claimedBackendJobId);
        if (!isBackground) {
            aiDisplayingReply = false;
            if (activeAiAbortController === aiAbortController) activeAiAbortController = null;
            isGenerating = false;
            getReplyBtn.disabled = false;
            regenerateBtn.disabled = false;
            typingIndicator.style.display = 'none';
            if (window.syncBackendMessages) setTimeout(() => window.syncBackendMessages(), 0);
        }
        if (typeof maybeAutoSummarizeJournal === 'function') {
            setTimeout(() => { maybeAutoSummarizeJournal(chatId, chatType).catch(err => console.error(err)); }, 300);
        }
    }
}

// 停止当前前台 AI 调用，不选中文字，也不影响其他功能。
function stopAiReply() {
    // 回复已经收完、正在逐条显示：让显示循环停下，剩余消息丢弃
    if (aiDisplayingReply) {
        aiStopGeneration++;
        aiDisplayingReply = false;
        showToast('已停止，剩余消息不再显示');
        return true;
    }
    if (activeAiAbortController) {
        activeAiAbortController.abort();
        return true;
    }
    if (isGenerating) {
        isGenerating = false;
        if (typeof getReplyBtn !== 'undefined' && getReplyBtn) getReplyBtn.disabled = false;
        if (typeof regenerateBtn !== 'undefined' && regenerateBtn) regenerateBtn.disabled = false;
        if (typeof typingIndicator !== 'undefined' && typingIndicator) typingIndicator.style.display = 'none';
        showToast('已停止本次回复调用');
        return true;
    }
    showToast('当前没有正在进行的回复调用');
    return false;
}

async function processStream(response, chat, apiType, targetChatId, targetChatType, isBackground = false) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let fullResponse = "", accumulatedChunk = "";
    for (; ;) {
        const {done, value} = await reader.read();
        if (done) break;
        accumulatedChunk += decoder.decode(value, {stream: true});
        if (apiType === "openai" || apiType === "deepseek" || apiType === "claude" || apiType === "newapi") {
            const parts = accumulatedChunk.split("\n\n");
            accumulatedChunk = parts.pop();
            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.substring(6);
                    if (data.trim() !== "[DONE]") {
                        try {
                            fullResponse += JSON.parse(data).choices[0].delta?.content || "";
                        } catch (e) { 
                        }
                    }
                }
            }
        }
    }
    if (apiType === "gemini") {
        try {
            const parsedStream = JSON.parse(accumulatedChunk);
            fullResponse = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
        } catch (e) {
            console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
            if (!isBackground) showToast("解析Gemini响应失败");
            return;
        }
    }
    // === 【补丁：补全流式输出时丢失的开头标签】 ===
        // === 【补丁：补全流式输出时丢失的开头标签】 ===
    // 无论前台后台，只要是CoT开启且被预填吃掉了开头，都要补回来
    const cotEnabled = db.cotSettings && db.cotSettings.enabled;
    // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
    if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
         // 这里判断：如果内容里有闭合的 </thinking> 但开头没有 <thinking>，说明开头被 Prefill 吃掉了
         if (fullResponse.includes('</thinking>')) {
             fullResponse = '<thinking>' + fullResponse;
         }
    }

    // ===================
    await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground);
}

// 引用消息：在最近的聊天记录里找被引用的那条原消息。
function findQuotedOriginalMessage(chat, quotedText) {
    const quoted = String(quotedText || '').trim();
    if (!quoted || !chat || !Array.isArray(chat.history)) return null;
    const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[，。！？、；：,.!?;:~～…“”"'’‘「」『』（）()\[\]【】—\-]/g, '').toLowerCase();
    const textOf = (m) => {
        let t = String(m.content || '');
        const wrapped = t.match(/^\[.*?(?:的消息|：)[：:]?([\s\S]*)\]$/);
        const inner = t.match(/\[.*?的消息：([\s\S]+?)\]/);
        if (inner) t = inner[1];
        else if (wrapped && wrapped[1]) t = wrapped[1];
        return t.replace(/\[发送时间:.*?\]$/, '').trim();
    };
    const recent = chat.history.filter(m => !m.isThinking && m.role !== 'system').slice(-60).reverse();
    const users = recent.filter(m => m.role === 'user');
    const assistants = recent.filter(m => m.role === 'assistant');
    const nq = norm(quoted);

    for (const pool of [users, assistants]) {
        // 1 精确
        let hit = pool.find(m => textOf(m) === quoted);
        if (hit) return hit;
        // 2 去掉标点空白后相等
        hit = pool.find(m => nq && norm(textOf(m)) === nq);
        if (hit) return hit;
        // 3 互相包含
        if (nq.length >= 2) {
            hit = pool.find(m => { const nt = norm(textOf(m)); return nt && (nt.includes(nq) || (nt.length >= 4 && nq.includes(nt))); });
            if (hit) return hit;
        }
    }
    // 4 字符重合度（简繁体混用时多数字符仍相同）
    if (nq.length >= 4) {
        let best = null, bestScore = 0.7;
        for (const m of [...users, ...assistants]) {
            const nt = norm(textOf(m));
            if (!nt) continue;
            const pool = nt.split('');
            let matched = 0;
            for (const ch of nq) {
                const i = pool.indexOf(ch);
                if (i !== -1) { matched++; pool.splice(i, 1); }
            }
            const score = matched / Math.max(nq.length, 1);
            if (score >= bestScore && matched / Math.max(nt.length, 1) >= 0.4) { best = m; bestScore = score; }
        }
        if (best) return best;
    }
    return null;
}

async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
    const rawResponse = fullResponse;
    if (fullResponse && targetChatType === 'private' && typeof markUserMomentsSeen === 'function') {
        try { markUserMomentsSeen(chat, (window.__aiReqStart || {})[targetChatId]); } catch (e) { console.warn(e); }
    }
    if (fullResponse) {
        // 1. 移除 [incipere] 标签
        fullResponse = fullResponse.replace(/\[incipere\]/g, "");

        // 2. 捕获并分离 <thinking> 内容
        const lastThinkingIndex = fullResponse.lastIndexOf('</thinking>');
        if (lastThinkingIndex !== -1) {
            // 截取从开头到最后一个 </thinking> 的所有内容（包括标签本身）
            const thinkingContent = fullResponse.substring(0, lastThinkingIndex + 11); // 11 是 '</thinking>'.length
            
            // 创建思考过程消息对象
            const thinkingMsg = {
                id: `msg_${Date.now()}_${Math.random()}`,
                role: 'assistant',
                content: thinkingContent,
                timestamp: Date.now(),
                isThinking: true,
                isContextDisabled: true // 【关键】标记为不进入上下文
            };
            
            // 存入历史记录
            chat.history.push(thinkingMsg);

            // 【新增】清理旧的思维链消息，仅保留最近 50 条
            const maxThinkingMsgs = 50;
            let thinkingCount = 0;
            const idsToRemove = new Set();
            // 从后往前遍历，保留最近的 50 个，其他的标记为待删除
            for (let i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].isThinking) {
                    thinkingCount++;
                    if (thinkingCount > maxThinkingMsgs) {
                        idsToRemove.add(chat.history[i].id);
                    }
                }
            }
            if (idsToRemove.size > 0) {
                chat.history = chat.history.filter(m => !idsToRemove.has(m.id));
            }
            
            // 添加到界面气泡（由于 regex 设置，会被隐藏，仅 Debug 模式可见）
            addMessageBubble(thinkingMsg, targetChatId, targetChatType);
            
            // 从即将显示的文本中移除思考内容
            fullResponse = fullResponse.substring(lastThinkingIndex + 11);
        }

        // --- 朋友圈指令解析 ---
        const momentPostWithImageRegex = /\[(.*?)\s*发布了一条带图动态[：:](.*?)\|([\s\S]+?)\]/;
        const momentPostRegex = /\[(.*?)\s*发布了一条动态[：:]([\s\S]+?)\]/;
        const momentCommentRegex = /\[(.*?)\s*(?:评论了|回复了)\s*(.*?)(?:(?:的|在)动态["“'‘](.*?)["”'’])?(?:下的评论)?[：:]\s*([\s\S]+?)\]/;
        const momentLikeRegex = /^\[(.*?)\s*点赞了\s*(.*?)的动态(?:[：:]|["“'‘])\s*([\s\S]*?)["”'’]?\s*\]$/;
        const momentSignatureRegex = /\[(.*?)\s*更新了个性签名[：:]([\s\S]+?)\]/;

        let momentPostWithImageMatch, momentPostMatch, momentCommentMatch, momentSignatureMatch, momentLikeMatch;
        
        let messagesToProcess = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        let remainingMessages = [];

        for (const item of messagesToProcess) {
            const content = item.content.trim();
            momentPostWithImageMatch = content.match(momentPostWithImageRegex);
            momentPostMatch = content.match(momentPostRegex);
            momentCommentMatch = content.match(momentCommentRegex);
            momentSignatureMatch = content.match(momentSignatureRegex);
            momentLikeMatch = (momentCommentMatch || momentPostMatch || momentPostWithImageMatch) ? null : content.match(momentLikeRegex);

            let isMomentAction = false;
            let momentCmdContent = content;

            if (momentPostWithImageMatch) {
                isMomentAction = true;
                const author = momentPostWithImageMatch[1].trim();
                const imageDesc = momentPostWithImageMatch[2].trim();
                const momentContent = momentPostWithImageMatch[3].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    imageDescription: imageDesc, // 保存图片描述
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                chat.history.push(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            }
            else if (momentPostMatch && !momentPostWithImageMatch) { // 确保不重复匹配
                isMomentAction = true;
                const author = momentPostMatch[1].trim();
                const momentContent = momentPostMatch[2].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                chat.history.push(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            } 
            else if (momentLikeMatch) {
                isMomentAction = true;
                const liker = momentLikeMatch[1].trim() || chat.realName;
                const likedOn = momentLikeMatch[2].trim();
                const likeSnippet = (momentLikeMatch[3] || '').replace(/\.{2,}$|…+$/, '').trim();
                momentCmdContent = `[${liker}点赞了${likedOn}的动态：${likeSnippet || '…'}]`; // 统一成带冒号的格式，确保聊天里隐藏
                if (chat.moments && chat.moments.length > 0) {
                    const myNames = [chat.myName, '我', '你', '{{user}}'].filter(Boolean);
                    const targetIsMe = myNames.includes(likedOn);
                    const sorted = [...chat.moments].sort((a, b) => b.timestamp - a.timestamp);
                    let targetMoment = likeSnippet ? chat.moments.find(m => String(m.content || '').replace(/\s+/g, ' ').includes(likeSnippet)) : null;
                    if (!targetMoment) targetMoment = (targetIsMe ? sorted.find(m => m.isUser) : sorted.find(m => !m.isUser)) || null;
                    if (targetMoment) {
                        if (!targetMoment.likes) targetMoment.likes = [];
                        if (!targetMoment.likes.includes(liker)) {
                            targetMoment.likes.push(liker);
                            if (targetMoment.isUser) {
                                const likeNotice = {
                                    id: `msg_${Date.now()}_${Math.random()}`,
                                    role: 'system',
                                    content: `[system-display:${liker}赞了您的动态]`,
                                    timestamp: Date.now(),
                                    isContextDisabled: true
                                };
                                chat.history.push(likeNotice);
                                addMessageBubble(likeNotice, targetChatId, targetChatType);
                            }
                            if (document.getElementById('moments-screen').classList.contains('active')) renderMomentsScreen();
                        }
                    }
                }
            }
            else if (momentCommentMatch) {
                isMomentAction = true;
                const commenter = momentCommentMatch[1].trim();
                const commentedOn = momentCommentMatch[2].trim();
                const momentSnippet = momentCommentMatch[3] ? momentCommentMatch[3].trim() : null;
                const commentContent = momentCommentMatch[4].trim();

                if (chat.moments && chat.moments.length > 0) {
                    const isReplyToComment = content.includes('回复了') && content.includes('下的评论');
                    // 被评论的是用户自己（我 / 你 / 用户名）吗？
                    const myNames = [chat.myName, '我', '你', '{{user}}'].filter(Boolean);
                    const targetIsMe = myNames.includes(commentedOn);
                    let targetMoment = null;
                    if (momentSnippet) {
                        targetMoment = chat.moments.find(m => m.content.includes(momentSnippet));
                    }
                    if (!targetMoment) {
                        // 没有匹配到缩略内容：优先找被评论者本人最新的一条动态
                        const sorted = [...chat.moments].sort((a, b) => b.timestamp - a.timestamp);
                        targetMoment = (!isReplyToComment && targetIsMe ? sorted.find(m => m.isUser) : null)
                            || (!isReplyToComment && !targetIsMe ? sorted.find(m => !m.isUser) : null)
                            || sorted[0];
                    }

                    if (targetMoment) {
                        if (!targetMoment.comments) targetMoment.comments = [];
                        const newComment = {
                            id: `comment_${Date.now()}`,
                            author: commenter,
                            content: commentContent,
                            timestamp: Date.now()
                        };
                        if (targetMoment.isUser) {
                            // 评论用户自己的动态：直接评论显示「名字: 内容」，只有回复某条评论时才显示「A 回复 B」。
                            if (isReplyToComment) newComment.replyTo = commentedOn;
                        } else if (isReplyToComment || (commentedOn !== chat.realName && commentedOn !== '自己')) {
                            newComment.replyTo = commentedOn;
                        }
                        targetMoment.comments.push(newComment);

                        let notifyText = null;
                        if (targetMoment.isUser) {
                            notifyText = isReplyToComment
                                ? `[system-display:${commenter}回复了您的评论]`
                                : `[system-display:${commenter}评论了您的动态]`;
                        } else if (commentedOn === chat.myName || commentedOn === '你') {
                            notifyText = `[system-display:您在${chat.realName}的动态下的评论被回复了]`;
                        }
                        if (notifyText) {
                            const notificationMsg = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'system',
                                content: notifyText,
                                timestamp: Date.now(),
                                isContextDisabled: true
                            };
                            chat.history.push(notificationMsg);
                            addMessageBubble(notificationMsg, targetChatId, targetChatType);
                        }
                    }
                }
            }
            else if (momentSignatureMatch) {
                isMomentAction = true;
                const newSignature = momentSignatureMatch[2].trim();
                chat.momentsSignature = newSignature;
                
                if (document.getElementById('moments-screen').classList.contains('active')) {
                    renderMomentsScreen();
                }
            }

            if (isMomentAction) {
                const originalCmdMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: momentCmdContent,
                    timestamp: Date.now(),
                    isContextDisabled: false
                };
                chat.history.push(originalCmdMsg);
                addMessageBubble(originalCmdMsg, targetChatId, targetChatType);
            } else {
                remainingMessages.push(item);
            }
        }
        
        fullResponse = remainingMessages.map(item => item.content).join('\n');
        // --- 朋友圈指令解析结束 ---

        // --- 红包结算逻辑 ---
        const redPacketMsg = chat.history.find(m => m.type === 'red-packet' && !m.isRevealed);
        if (redPacketMsg) {
            redPacketMsg.isRevealed = true;
            // 触发重新渲染红包消息
            setTimeout(() => {
                if (currentChatId === chat.id) {
                    renderMessages(false, false);
                }
            }, 500);
        }

        if (db.globalReceiveSound) {
            playSound(db.globalReceiveSound);
        }
        // ... 后续代码保持不变 ...
        console.log('【AI原始返回内容】:', rawResponse);
        let cleanedResponse = fullResponse.replace(/^\[system:[\s\S]*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        const trimmedResponse = cleanedResponse.trim();
        let messages;

        if (trimmedResponse.startsWith('<') && trimmedResponse.endsWith('>')) {
            messages = [{ type: 'html', content: trimmedResponse }];
        } else {
            messages = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        }

        let firstMessageProcessed = false;
        const stopGenAtStart = aiStopGeneration;
        if (!isBackground) aiDisplayingReply = true;

        for (const item of messages) {
            // 点了暂停：剩下的消息不再显示
            if (!isBackground && aiStopGeneration !== stopGenAtStart) break;
            // 自动剔除不存在的表情包
            const stickerRegex = /\[(?:.*?的)?表情包：(.+?)\]/i;
            const stickerMatch = item.content.match(stickerRegex);
            if (stickerMatch) {
                const stickerName = stickerMatch[1].trim();
                const groups = (chat.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                let targetSticker = null;
                
                // 1. 优先在绑定分组中查找
                if (groups.length > 0) {
                    targetSticker = db.myStickers.find(s => groups.includes(s.group) && s.name === stickerName);
                }
                
                // 2. 兜底在所有表情包中查找
                if (!targetSticker) {
                    targetSticker = db.myStickers.find(s => s.name === stickerName);
                }
                
                // 3. 如果完全找不到，则剔除该消息
                if (!targetSticker) {
                    console.log(`[Auto-Filter] 剔除不存在的表情包: ${stickerName}`);
                    continue; 
                }
            }

            // --- 自动隔空投送检测 ---
            const photoRegex = /\[(.*?)发来的照片\/视频：(.*?)\]/;
            const photoMatch = item.content.match(photoRegex);
            if (photoMatch && chat.autoAirDropEnabled) {
                // 延迟一点触发，确保消息已经渲染
                setTimeout(() => {
                    if (typeof receiveAirDropPhoto === 'function') {
                        // 找到刚插入的这条消息的 ID
                        const targetMsg = chat.history[chat.history.length - 1];
                        if (targetMsg) {
                            receiveAirDropPhoto(targetMsg.id, true);
                        }
                    }
                }, 500);
            }

            // --- 视频/语音通话邀请检测 ---
            const callInviteRegex = /\[(.*?)向(.*?)发起了(视频|语音)通话\]/;
            const callInviteMatch = item.content.match(callInviteRegex);
            if (callInviteMatch) {
                const type = callInviteMatch[3] === '视频' ? 'video' : 'voice';
                // 触发来电界面
                if (window.VideoCallModule && typeof window.VideoCallModule.receiveCall === 'function') {
                    window.VideoCallModule.receiveCall(type);
                }
                // 不将此消息显示为普通气泡，或者显示为系统通知
                // 这里选择显示为系统通知样式的消息
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system', // 使用 system 角色
                    content: item.content.trim(),
                    timestamp: Date.now()
                };
                chat.history.push(message);
                addMessageBubble(message, targetChatId, targetChatType);
                if (window.SystemNotificationManager) {
                    window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                }
                continue; // 跳过后续处理
            }

            if (targetChatType === 'private') {
                const char = db.characters.find(c => c.id === targetChatId);
                if (char && char.statusPanel && char.statusPanel.enabled && char.statusPanel.regexPattern) {
                    try {
                        let pattern = char.statusPanel.regexPattern;
                        let flags = 'gs'; 

                        const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                        if (matchParts) {
                            pattern = matchParts[1];
                            flags = matchParts[2] || 'gs';
                            if (!flags.includes('s')) flags += 's';
                        }

                    const regex = new RegExp(pattern, flags);
                    const match = regex.exec(item.content);
                    
                    if (match) {
                        const rawStatus = match[0];
                        
                        let html = char.statusPanel.replacePattern;
                        
                            // 使用正则一次性查找模板中的 $数字 并替换
    html = html.replace(/\$(\d+)/g, (fullMatch, groupIndex) => {
        const index = parseInt(groupIndex, 10);
        // 如果捕获组存在，则返回对应内容；否则保持原样
        return (match[index] !== undefined) ? match[index] : fullMatch;
    });


                        // Save to history
                        if (!char.statusPanel.history) char.statusPanel.history = [];
                        
                        // Add new status to the beginning
                        char.statusPanel.history.unshift({
                            raw: rawStatus,
                            html: html,
                            timestamp: Date.now()
                        });

                        // Keep only last 20 items
                        if (char.statusPanel.history.length > 20) {
                            char.statusPanel.history = char.statusPanel.history.slice(0, 20);
                        }

                        char.statusPanel.currentStatusRaw = rawStatus;
                        char.statusPanel.currentStatusHtml = html;
                        
                        item.isStatusUpdate = true;
                        item.statusSnapshot = {
                            regex: pattern,
                            replacePattern: char.statusPanel.replacePattern
                        };
                        }
                    } catch (e) {
                        console.error("状态栏正则解析错误:", e);
                    }
                }
            }

            // 如果是后台模式，跳过延迟，直接处理
            if (!isBackground) {
                const delay = firstMessageProcessed ? (900 + Math.random() * 1300) : (400 + Math.random() * 400);
                await new Promise(resolve => setTimeout(resolve, delay));
                // 等待期间点了暂停：这一条也不显示了
                if (aiStopGeneration !== stopGenAtStart) break;
                
                // 如果开启了多条消息提示音，且不是第一条消息（第一条已由系统默认逻辑播放），则播放提示音
                if (firstMessageProcessed && db.multiMsgSoundEnabled && db.globalReceiveSound) {
                    playSound(db.globalReceiveSound);
                }
            }
            firstMessageProcessed = true;

            // --- 问卷（仅私聊）：发起 / 回答 ---
            if (targetChatType === 'private' && typeof createQnObject === 'function') {
                const aiQnStart = parseAiQnStart(item.content);
                if (aiQnStart) {
                    const qn = createQnObject('char', aiQnStart.title, aiQnStart.questions, aiQnStart.mode);
                    if (qn.title && qn.questions.length >= 1) {
                        const qnContent = `[${aiQnStart.name}发起了${qn.mode === 'one' ? '单向' : '双向'}问卷：${qn.title}|${qn.questions.map(x => x.text).join('|')}]`;
                        const qnMessage = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: qnContent,
                            parts: [{type: 'text', text: qnContent}],
                            timestamp: Date.now(),
                            qn
                        };
                        chat.history.push(qnMessage);
                        addMessageBubble(qnMessage, targetChatId, targetChatType);
                    }
                    continue;
                }
                const aiQnAns = parseAiQnAnswer(item.content);
                if (aiQnAns) {
                    const qnMsg = findQnMessage(chat, aiQnAns.title, 'char');
                    if (qnMsg && qnNeeds(qnMsg.qn, 'char') && !qnMsg.qn.submitted.char) {
                        applyAiQnAnswers(qnMsg, aiQnAns.answers);
                        // 内容里保留答案（AI 自己的上下文要用），聊天里只显示“已回答”一行小字
                        const ansContent = `[${aiQnAns.name}回答了问卷“${qnMsg.qn.title}”：${qnMsg.qn.questions.map(x => x.char || '（未回答）').join('|')}]`;
                        const ansMessage = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: ansContent,
                            parts: [{type: 'text', text: ansContent}],
                            timestamp: Date.now()
                        };
                        chat.history.push(ansMessage);
                        addMessageBubble(ansMessage, targetChatId, targetChatType);
                        qnMaybeReveal(chat, qnMsg);
                        if (currentChatId === targetChatId) refreshQnCard(qnMsg.id);
                    } else {
                        console.warn('[Questionnaire] 找不到待回答的问卷，或已回答过:', item.content);
                    }
                    continue;
                }
            }

            // --- 投票（仅私聊）：发起 / 选择 / 添加选项 ---
            if (targetChatType === 'private' && typeof createVoteObject === 'function') {
                const aiVoteStart = item.content.trim().match(/^\[([^\[\]：:]{1,40}?)[发發]起了?投票[：:]\s*([^\[\]]+?)\s*\]$/);
                if (aiVoteStart) {
                    const parts = aiVoteStart[2].split(/[|｜]/).map(s => s.trim()).filter(Boolean);
                    const vote = createVoteObject('char', parts[0] || '', parts.slice(1));
                    if (vote.title && vote.options.length >= 2) {
                        const voteContent = `[${aiVoteStart[1]}发起了投票：${vote.title}|${vote.options.map(o => o.text).join('|')}]`;
                        const voteMessage = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: voteContent,
                            parts: [{type: 'text', text: voteContent}],
                            timestamp: Date.now(),
                            vote
                        };
                        chat.history.push(voteMessage);
                        addMessageBubble(voteMessage, targetChatId, targetChatType);
                    }
                    continue;
                }
                const aiVoteAct = parseAiVoteAction(item.content);
                if (aiVoteAct) {
                    const pollMsg = findVoteMessage(chat, aiVoteAct.title);
                    if (pollMsg) {
                        const doneTexts = [];
                        if (aiVoteAct.kind === 'choose') {
                            const opt = findVoteOption(pollMsg.vote, aiVoteAct.text);
                            if (opt) { setVoteChoice(pollMsg.vote, 'char', opt.id); doneTexts.push(opt.text); }
                        } else {
                            // 一次可能写了多个选项（用顿号/逗号/竖线隔开）
                            splitVoteOptionTexts(aiVoteAct.text).forEach(t => {
                                const res = addVoteOption(pollMsg.vote, 'char', t);
                                if (res.ok) doneTexts.push(res.option.text);
                            });
                        }
                        if (doneTexts.length > 0) {
                            const verb = aiVoteAct.kind === 'choose' ? '选择了' : '添加了选项';
                            const actContent = `[${aiVoteAct.name}在投票“${pollMsg.vote.title}”中${verb}：${doneTexts.join('、')}]`;
                            const actMessage = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'assistant',
                                content: actContent,
                                parts: [{type: 'text', text: actContent}],
                                timestamp: Date.now()
                            };
                            chat.history.push(actMessage);
                            addMessageBubble(actMessage, targetChatId, targetChatType);
                            if (currentChatId === targetChatId) refreshVoteCard(pollMsg.id);
                        } else {
                            console.warn('[Vote] AI 的投票动作没有生效（选项不存在/已存在/已满）:', item.content);
                        }
                    } else {
                        console.warn('[Vote] 找不到可操作的投票:', item.content);
                    }
                    continue;
                }
            }

            // --- 拍一拍 / 修改拍一拍后缀（仅私聊） ---
            if (targetChatType === 'private') {
                const patSuffixCmd = item.content.match(/\[[^\[\]]*?更新了?拍一拍后缀为[：:]\s*([^\[\]]*?)\s*\]/);
                if (patSuffixCmd && chat.patEnabled && chat.patAiSuffix) {
                    chat.patCharSuffix = patSuffixCmd[1].trim().slice(0, 20);
                }
                const aiPatMatch = item.content.trim().match(/^\[([^\[\]：:]{1,40}?)拍了拍([^\[\]：:]{1,40}?)(?:[：:]([^\[\]]{0,30}))?\]$/);
                if (aiPatMatch) {
                    if (!chat.patEnabled) continue; // 没开拍一拍：丢掉
                    // 后缀以用户设置的“我的后缀”为准，AI 自己写的会被忽略
                    const mySuffix = chat.patMySuffix || '';
                    const patContent = `[${aiPatMatch[1]}拍了拍${aiPatMatch[2]}${mySuffix ? '：' + mySuffix : ''}]`;
                    const patMessage = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: patContent,
                        parts: [{type: 'text', text: patContent}],
                        timestamp: Date.now()
                    };
                    chat.history.push(patMessage);
                    addMessageBubble(patMessage, targetChatId, targetChatType);
                    continue;
                }
            }

            const aiWithdrawRegex = /\[(.*?)撤回了一条消息：([\s\S]*?)\]/;
            const aiWithdrawRegexEn = /\[(?:system:\s*)?(.*?) withdrew a message\. Original: ([\s\S]*?)\]/;
            
            const withdrawMatch = item.content.match(aiWithdrawRegex) || item.content.match(aiWithdrawRegexEn);

            if (withdrawMatch) {
                const characterName = withdrawMatch[1];
                const originalContent = withdrawMatch[2].trim();

                // --- 【新增兜底机制】检查上一条消息是否为重复输出 ---
                if (chat.history.length > 0) {
                    const lastMsg = chat.history[chat.history.length - 1];
                    // 提取上一条消息的纯文本内容（剥离包装标签）
                    let lastMsgPureContent = lastMsg.content;
                    const textMatch = lastMsg.content.match(/\[.*?的消息[：:]([\s\S]+?)\]/);
                    if (textMatch) {
                        lastMsgPureContent = textMatch[1].trim();
                    } else {
                        lastMsgPureContent = lastMsgPureContent.trim();
                    }

                    // 检查内容是否匹配且发送者一致
                    const isSameContent = (lastMsgPureContent === originalContent);
                    let isSameSender = false;
                    if (targetChatType === 'private') {
                        isSameSender = (lastMsg.role === 'assistant');
                    } else {
                        const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                        isSameSender = (sender && lastMsg.senderId === sender.id);
                    }

                    if (isSameContent && isSameSender) {
                        console.log(`[Withdraw-Fallback] 检测到重复输出，移除上一条消息: ${lastMsg.id}`);
                        chat.history.pop(); // 从历史记录移除
                        // 从 DOM 移除
                        const lastMsgEl = messageArea.querySelector(`.message-wrapper[data-id="${lastMsg.id}"]`);
                        if (lastMsgEl) lastMsgEl.remove();
                    }
                }
                // ----------------------------------------------

                const normalContent = `[${characterName}的消息：${originalContent}]`;
                
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: normalContent,
                    parts: [{type: 'text', text: normalContent}],
                    timestamp: Date.now(),
                    originalContent: originalContent, 
                    isWithdrawn: false 
                };

                if (targetChatType === 'group') {
                    const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                    if (sender) {
                        message.senderId = sender.id;
                    }
                }

                chat.history.push(message);
                addMessageBubble(message, targetChatId, targetChatType);
                if (window.SystemNotificationManager) {
                    window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                }
                
                setTimeout(async () => {
                    message.isWithdrawn = true;
                    message.content = `[${characterName}撤回了一条消息：${originalContent}]`;
                    
                    await saveData();
                    
                    if ((targetChatType === 'private' && currentChatId === chat.id) || 
                        (targetChatType === 'group' && currentChatId === chat.id)) {
                         renderMessages(false, true);
                    }
                }, 2000);

                continue; 
            }

            if (targetChatType === 'private') {
                const character = chat;
                const myName = character.myName;

                // 兼容简/繁体写法（并/並、回复/回覆/回復）、冒号和引号的变体，名字不强求和设定完全一致。
                const aiQuoteRegex = /\[[^\[\]：:]*?引用\s*[“"「『]([\s\S]*?)[”"」』]\s*[并並]?\s*(?:回复|回覆|回復)\s*[：:]\s*([\s\S]*?)\]/;
                const aiQuoteMatch = item.content.match(aiQuoteRegex);

                if (aiQuoteMatch) {
                    const quotedText = aiQuoteMatch[1];
                    const replyText = aiQuoteMatch[2];

                    // 找被引用的原消息：先精确匹配，再宽松匹配（模型常常改动标点、简繁体或只引用一部分）。
                    const originalMessage = findQuotedOriginalMessage(chat, quotedText);

                    // 找不到原消息也照样显示引用样式，只是不关联到具体某条消息。
                    {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot,
                            quote: {
                                messageId: originalMessage ? originalMessage.id : null,
                                senderId: (originalMessage && originalMessage.role === 'assistant') ? character.id : 'user_me',
                                content: quotedText
                            }
                        };
                        chat.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                        if (window.SystemNotificationManager) {
                            window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                        }
                    }
                } else {
                    const receivedTransferRegex = new RegExp(`\\[${character.realName}的转账：.*?元；备注：.*?\\]`);
                    const giftRegex = new RegExp(`\\[${character.realName}送来的礼物：.*?\\]`);

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        isStatusUpdate: item.isStatusUpdate,
                        statusSnapshot: item.statusSnapshot
                    };

                    if (receivedTransferRegex.test(message.content)) {
                        message.transferStatus = 'pending';
                    } else if (giftRegex.test(message.content)) {
                        message.giftStatus = 'sent';
                    }

                    chat.history.push(message);
                    addMessageBubble(message, targetChatId, targetChatType);
                if (window.SystemNotificationManager) {
                    window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                }
                }

            } else if (targetChatType === 'group') {
                const group = chat;
                
                // --- 私聊通知 (不拦截) ---
                if (group.allowGossip && typeof handleGossipMessage === 'function') {
                    handleGossipMessage(group, item.content);
                }

                // 优先检查是否为私聊消息
                const privateRegex = /^\[Private: (.*?) -> (.*?): ([\s\S]+?)\]$/;
                const privateEndRegex = /^\[Private-End: (.*?) -> (.*?)\]$/;
                
                if (privateRegex.test(item.content) || privateEndRegex.test(item.content)) {
                    const match = item.content.match(privateRegex) || item.content.match(privateEndRegex);
                    let senderId = 'unknown';
                    
                    if (match) {
                        const senderName = match[1];
                        // 尝试匹配发送者
                        if (senderName === group.me.nickname) {
                            senderId = 'user_me';
                        } else {
                            const sender = group.members.find(m => m.realName === senderName || m.groupNickname === senderName);
                            if (sender) senderId = sender.id;
                        }
                    }

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        senderId: senderId
                    };
                    group.history.push(message);
                    addMessageBubble(message, targetChatId, targetChatType);
                if (window.SystemNotificationManager) {
                    window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                }
                    continue; // 私聊消息处理完毕，跳过后续普通消息匹配
                }

                const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账：([\d.,]+)元；备注：(.*?)\]/;
                const transferMatch = item.content.match(groupTransferRegex);

                const r = /\[(.*?)((?:的消息|的语音|发送的表情包|发来的照片\/视频))：/;
                const nameMatch = item.content.match(r);
                
                if (transferMatch) {
                    const senderName = transferMatch[1];
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id,
                            transferStatus: 'pending'
                        };
                        group.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                        if (window.SystemNotificationManager) {
                            window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                        }
                    }
                } else if (nameMatch || item.char) {
                    const senderName = item.char || (nameMatch[1]);
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    console.log(sender)
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id
                        };
                        group.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                        if (window.SystemNotificationManager) {
                            window.SystemNotificationManager.notifyIncomingMessage(message, chat, targetChatId, targetChatType);
                        }
                    }
                }
            }
        }

        await saveData();
        renderChatList();

        // 触发独立的电量检查（不阻塞主流程）
        if (window.BatteryInteraction && typeof window.BatteryInteraction.triggerIndependentCheck === 'function') {
            window.BatteryInteraction.triggerIndependentCheck(chat);
        }
    }
}

async function handleRegenerate() {
    if (isGenerating) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    const lastUserMessageIndex = chat.history.map(m => m.role).lastIndexOf('user');

    if (lastUserMessageIndex === -1 || lastUserMessageIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    const originalLength = chat.history.length;
    chat.history.splice(lastUserMessageIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }
    
    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    await saveData();
    
    currentPage = 1; 
    renderMessages(false, true); 

    await getAiReply(currentChatId, currentChatType);
}
