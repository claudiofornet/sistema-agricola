/* Guarda o aplicativo no aparelho para abrir sem internet.
 * Ao publicar uma versão nova dos arquivos, aumente o número abaixo. */
const VERSAO = 'agro-v1';
const ARQUIVOS = ['./', './index.html', './app.js', './config.js', './manifest.json',
  './lib/chart.umd.min.js', './lib/piexif.min.js', './icone-192.png', './icone-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* Arquivos do app: usa o que está guardado (abre na hora, mesmo offline)
 * e atualiza em segundo plano quando há internet. Chamadas ao Google não passam aqui. */
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSAO).then(async cache => {
    const guardado = await cache.match(e.request, { ignoreSearch: true });
    const rede = fetch(e.request).then(r => { if (r && r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (guardado) { e.waitUntil(rede); return guardado; }
    const r = await rede;
    return r || cache.match('./index.html');
  }));
});
