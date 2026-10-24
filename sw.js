// UwU Service Worker：安装缓存保持原样，并增加 Web Push 后台通知。
self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
});

self.addEventListener('fetch', (event) => {
  // This basic service worker doesn't intercept any requests.
  // It just lets the browser handle them as usual.
  return;
});

// 页面（backend_adapter.js）把「Cloudflare 后台是否开启」写在这个 Cache 里。
async function readBackendState() {
  try {
    const cache = await caches.open('uwu-backend-flag');
    const response = await cache.match('/__uwu_backend_state');
    return response ? await response.json() : null;
  } catch (error) {
    return null;
  }
}

// 订阅是按「每条推送都会给用户可见反馈」建立的。收到推送却不显示通知，
// iOS 在宽限期后会直接吊销订阅（表现为过几天突然收不到通知，重开 UwU 又好了）。
// 所以页面已经自己处理、或后台功能已关闭的推送，也要先弹一条静音通知再立刻收掉。
async function showAndDismiss(title, tagBase) {
  try {
    const tag = `${tagBase}-${Date.now()}`;
    await self.registration.showNotification(title, { tag, silent: true, body: '' });
    const list = await self.registration.getNotifications({ tag });
    list.forEach(n => n.close());
  } catch (error) {}
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'UwU', body: event.data ? event.data.text() : '收到一条新消息' };
  }

  const title = payload.title || 'UwU';
  event.waitUntil((async () => {
    // 未开启 Cloudflare 后台时，不显示任何后台推送；并通知 Worker 停止继续排程。
    // 读不到状态标记（旧版本、被清除）时保持原行为，不影响正常使用。
    const backendState = await readBackendState();
    if (backendState && backendState.enabled === false) {
      if (backendState.url && backendState.token && backendState.userId) {
        try {
          await fetch(`${backendState.url}/v1/backend/disable`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${backendState.token}`
            },
            body: JSON.stringify({ userId: backendState.userId })
          });
        } catch (error) {}
      }
      await showAndDismiss(title, 'uwu-disabled');
      return;
    }

    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const foregroundClient = clientList.find(client => client.visibilityState === 'visible');
    // 失败提醒（kind: 'error'）一律正常弹出，不交给页面静默处理。
    if (foregroundClient && payload.kind !== 'error') {
      // UwU handles foreground alerts in-page. A Web Push must not create a
      // second, OS-level notification while the app is already visible.
      // 但 iOS 等系统可能把已被挂起的页面仍标记为 visible，页面根本收不到消息，
      // 这时通知会被吞掉。所以要求页面回执确认；1.5 秒内没回执就照常弹系统通知。
      const handled = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 1500);
        try {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
          foregroundClient.postMessage({ type: 'uwu-backend-push', chatId: payload.chatId || '' }, [channel.port2]);
        } catch (error) {
          clearTimeout(timer);
          resolve(false);
        }
      });
      if (handled) {
        await showAndDismiss(title, 'uwu-handled');
        return;
      }
    }

  const options = {
    body: payload.body || '收到一条新消息',
    icon: payload.icon || undefined,
    badge: payload.badge || undefined,
    tag: payload.tag || `uwu-${Date.now()}`,
    renotify: payload.renotify !== false,
    data: {
      url: payload.url || './',
      chatId: payload.chatId || '',
      chatType: payload.chatType || 'private'
    }
  };

    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || './';
  event.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL(targetUrl, self.location.origin);
    url.searchParams.set('backendNotification', '1');
    if (data.chatId) {
      url.searchParams.set('chatId', data.chatId);
      url.searchParams.set('chatType', data.chatType || 'private');
    }
    for (const client of clientList) {
      if ('focus' in client) {
        try { await client.navigate(url.href); } catch (error) {}
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url.href);
  })());
});
