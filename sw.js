// =====================================================================
// SERVICE WORKER — Painel D Coração Home (app instalável / PWA)
// - Guarda a "casca" do app (HTML, ícones, bibliotecas do Firebase) para abrir
//   rápido e funcionar mesmo sem internet (os dados continuam vindo do Firebase).
// - O HTML é sempre buscado na internet primeiro: quando você publica uma versão
//   nova, ela aparece na próxima abertura (a cópia guardada só é usada offline).
// - Mostra as notificações de mensagem no Android (lá o navegador só permite
//   notificação através do service worker) e abre a conversa ao tocar nela.
// - Recebe notificações push (Firebase Cloud Messaging) mesmo com o app FECHADO.
// - NÃO mexe nas requisições do Firestore/login (essas passam direto).
// Ao mudar este arquivo, troque a VERSAO para os aparelhos atualizarem o cache.
// =====================================================================
const VERSAO = '2026-10-14-v5';
const CACHE = 'painel-dc-' + VERSAO;
const BASE = self.registration.scope;               // ex.: https://dcoracaohome.netlify.app/
const CASCA = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/badge-96.png']
  .map(p => new URL(p, BASE).href);
const FIREBASE_JS = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js', 'firebase-messaging-compat.js']
  .map(f => 'https://www.gstatic.com/firebasejs/10.7.1/' + f);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CASCA.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    // scripts de outro domínio (sem CORS) são guardados como resposta "opaca"
    await Promise.all(FIREBASE_JS.map(u => fetch(new Request(u, { mode: 'no-cors' }))
      .then(r => (r && (r.ok || r.type === 'opaque')) ? cache.put(u, r) : null).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('painel-dc-') && k !== CACHE).map(k => caches.delete(k)));
    if(self.registration.navigationPreload){ try{ await self.registration.navigationPreload.enable(); }catch(e){} }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // abrir o app (página): internet primeiro, cópia guardada se estiver offline
  if(req.mode === 'navigate' && req.url.startsWith(BASE)){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try{
        const pre = event.preloadResponse ? await event.preloadResponse : null;
        const res = pre || await fetch(req);
        if(res && res.ok){
          // resposta que veio de redirecionamento não pode ser reaproveitada direto numa navegação
          const copia = res.redirected
            ? new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
            : res.clone();
          cache.put(BASE, copia);
        }
        return res;
      }catch(err){
        return (await cache.match(BASE)) || (await cache.match(req, { ignoreSearch: true })) ||
          new Response('<h1 style="font-family:sans-serif">Sem internet</h1><p style="font-family:sans-serif">Abra o painel uma vez com internet para ele funcionar offline.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  const mesmoSite = url.origin === self.location.origin;
  const firebaseJs = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if(!(mesmoSite || firebaseJs)) return;              // Firestore, login, planilhas etc.: passa direto
  if(mesmoSite && url.pathname.endsWith('/sw.js')) return;

  // ícones, manifesto e bibliotecas: usa a cópia e atualiza em segundo plano
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: mesmoSite });
    const rede = fetch(req).then(res => {
      if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if(hit){ event.waitUntil(rede); return hit; }
    return (await rede) || Response.error();
  })());
});

// ---------------------------------------------------------------------
// PUSH (Firebase Cloud Messaging): chega mesmo com o app fechado.
// O servidor (Apps Script) manda uma mensagem só com "data"; quem monta o
// aviso aqui é o service worker. Toda mensagem push PRECISA mostrar um aviso
// (regra do iPhone/Safari), por isso só deixamos de mostrar quando o painel
// já está aberto e em foco no Android/PC (lá o app mostra o próprio aviso).
// ---------------------------------------------------------------------
self.addEventListener('push', event => {
  let d = {};
  try{
    const j = event.data ? event.data.json() : {};
    d = (j && (j.data || (j.notification && Object.assign({}, j.notification, j.data)))) || j || {};
  }catch(e){
    try{ d = { body: event.data.text() }; }catch(_){ d = {}; }
  }
  const titulo = d.title || 'D Coração Home';
  const opts = {
    body: d.body || 'Você tem uma nova mensagem',
    tag: d.convId ? 'conv-' + d.convId : 'dc-aviso',
    renotify: true,
    icon: new URL('./icons/icon-192.png', BASE).href,
    badge: new URL('./icons/badge-96.png', BASE).href,
    data: { convId: d.convId || null, section: d.section || null }
  };
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const emFoco = janelas.some(w => w.visibilityState === 'visible' && w.focused);
    const ios = /iPhone|iPad|iPod/.test((self.navigator && self.navigator.userAgent) || '');
    if(emFoco && !ios) return;
    await self.registration.showNotification(titulo, opts);
  })());
});

// toque na notificação: abre/foca o app e vai direto para a conversa
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const c of janelas){
      if(c.url.startsWith(BASE)){
        try{ await c.focus(); }catch(e){}
        c.postMessage({ type: 'abrir', convId: data.convId || null, section: data.section || null });
        return;
      }
    }
    const destino = new URL(data.convId ? './?conv=' + encodeURIComponent(data.convId) : './', BASE).href;
    await self.clients.openWindow(destino);
  })());
});

self.addEventListener('message', event => {
  if(event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});
