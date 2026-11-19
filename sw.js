// Ancien service worker de l'appli installée sur github.io : il se retire tout seul et vide son cache.
// (19/11 : il ne renvoie plus vers Netlify, puisque l'appli est de nouveau servie ici.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
})()));
