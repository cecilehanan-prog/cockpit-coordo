// Ancien service worker de l'appli installée sur github.io : il se retire tout seul
// et vide son cache, pour que l'adresse renvoie bien vers https://cockpit-coordo.netlify.app/
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://cockpit-coordo.netlify.app/');
})()));
