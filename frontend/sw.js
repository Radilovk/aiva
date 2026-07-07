/**
 * AIVA Service Worker — offline caching + push notifications
 */
const CACHE_NAME = 'aiva-v8';
const ASSETS = [
  '/index.html',
  '/settings.html',
  '/privacy.html',
  '/admin.html',
  '/config.js',
  '/settings.js',
  '/lib/i18n.js',
  '/lib/i18n-extended.js',
  '/lib/i18n-privacy.js',
  '/lib/voices.js',
  '/lib/appOnboarding.js',
  '/app.js',
  '/admin.js',
  '/local-scheduler.js',
  '/lib/icsUtils.js',
  '/lib/geminilive.js',
  '/lib/mediaUtils.js',
  '/audio-processors/capture.worklet.js',
  '/audio-processors/playback.worklet.js',
  '/lib/deviceCalendar.js',
  '/lib/nativeCalendar.js',
  '/lib/calendarCrud.js',
  '/lib/calendarSync.js',
  '/lib/calendarOnboarding.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install — pre-cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and API requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  let data = { title: 'KAYA', body: 'You have a reminder', tag: 'aiva-reminder' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'aiva-reminder',
      data: data,
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'done', title: 'Done ✓' },
      ],
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = event.notification.data?.task_id;

  if (event.action === 'done' && taskId) {
    const apiBase = self.location.origin.includes('localhost')
      ? 'https://aiva.radilov-k.workers.dev'
      : self.location.origin;
    event.waitUntil(
      fetch(`${apiBase}/api/tasks/${taskId}/done`, { method: 'PATCH' })
    );
    return;
  }

  if (event.action === 'snooze' && taskId) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'aiva:snooze', taskId, minutes: 10 });
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow('/index.html');
      })
    );
    return;
  }

  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('index.html') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow('/index.html');
    })
  );
});

// Handle snooze messages from SW notification actions
self.addEventListener('message', (event) => {
  if (event.data?.type === 'aiva:snooze') {
    // Forwarded to main app via postMessage on client
  }
});
