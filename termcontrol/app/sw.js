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
