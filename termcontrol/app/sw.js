// TermControl phone notifications (TF-096 part 7). A push carries no text; it
// wakes this worker, which asks the signed-in bridge what to show.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let note = null;
    try {
      const response = await fetch('/api/push/latest', { credentials: 'include', cache: 'no-store' });
      if (response.ok) note = (await response.json()).note;
    } catch { /* show a plain notice instead */ }
    await self.registration.showNotification(note?.title || 'TermControl', {
      body: note?.body || 'A bot has something for you.',
      tag: note?.id || 'termcontrol',
      data: { url: note?.url || '/' },
      icon: '/app/icon-192.png',
      badge: '/app/icon-192.png',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      if ('focus' in tab) { await tab.focus(); if ('navigate' in tab) await tab.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});

// Share to TermControl (TF-096, Noam 2026-10-19: "maybe add TermFleet as a Share option?").
// Android's Share sheet posts the picture to /share. The worker keeps it in a local
// cache (never sent anywhere) and opens the app, which asks which chat gets it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    let kept = 0;
    try {
      const form = await event.request.formData();
      const cache = await caches.open('share-inbox');
      for (const file of form.getAll('image')) {
        if (!file || typeof file === 'string' || !String(file.type).startsWith('image/')) continue;
        await cache.put(new Request(`/shared/${Date.now()}-${kept++}`), new Response(file, { headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name || 'shared picture') } }));
      }
    } catch { kept = 0; }
    return Response.redirect(`/?share=${kept}`, 303);
  })());
});
