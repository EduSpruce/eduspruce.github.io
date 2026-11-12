/* EduSpruce · service worker
   - notificações (obrigatório no iPhone/iPad: só um service worker pode mostrá-las)
   - abre a secção certa ao tocar numa notificação
   - abre sempre a versão mais recente da app quando há internet; a cópia guardada só serve sem rede (nunca corre uma versão antiga com internet)
   - os módulos da ligação à base de dados (esm/) ficam guardados por versão: a app abre sem esperar pela rede
   Não guarda dados de alunos: esses estão na base de dados, na conta do professor. */
const CACHE='eduspruce-app-v5';
const APP=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
/* versao.json nunca é guardado: é por ele que a app sabe que há versão nova */
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const K=await caches.keys();await Promise.all(K.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})())});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(/eduspruce-config\.json$/.test(u.pathname))return; /* sempre da rede */
  if(/\/esm\/[^/]+\.m?js$/.test(u.pathname)){
    /* módulos: cada endereço (com a versão) nunca muda → serve o guardado; se não houver, vai à rede e guarda (e arruma as versões antigas do mesmo ficheiro) */
    e.respondWith((async()=>{const c=await caches.open(CACHE);const x=await c.match(r);if(x)return x;
      const res=await fetch(r);if(res.ok){try{await c.put(r,res.clone());const K=await c.keys();await Promise.all(K.filter(k=>{const ku=new URL(k.url);return ku.pathname===u.pathname&&ku.search!==u.search}).map(k=>c.delete(k)))}catch(_){}}return res})());return}
  if(r.mode==='navigate'||APP.some(p=>u.pathname.endsWith(p.replace('./','/')))){
    /* v0.940 · primeiro a rede (versão mais recente); só sem internet (ou rede muito lenta, 6 s) usa a cópia guardada */
    const chave=r.mode==='navigate'&&/\/(index\.html)?$/.test(u.pathname)?'./':r;
    e.respondWith((async()=>{/* pedido novo, com um carimbo no endereço: nem o navegador nem a rede de distribuição devolvem uma página antiga */
      const fresco=()=>{if(r.mode!=='navigate'&&!/\/(index\.html)?$/.test(u.pathname))return fetch(r,{cache:'no-store'});const f=new URL(u.href);f.searchParams.set('_v',Date.now().toString(36));return fetch(f.href,{cache:'no-store',credentials:'same-origin',redirect:'follow'})};
      try{const res=await Promise.race([fresco(),new Promise((_,ko)=>setTimeout(()=>ko(new Error('lento')),8000))]);
        if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(chave,cp)).catch(()=>{})}return res}
      catch(_){const x=await caches.match(chave);if(x)return x;return fetch(r)}})())}});
self.addEventListener('notificationclick',e=>{e.notification.close();const d=e.notification.data||{};const v=d.v||'inicio',t=d.t||'';
  e.waitUntil((async()=>{const L=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const c of L){try{await c.focus();c.postMessage({es:'ir',v,t});return}catch(_){}}
    await self.clients.openWindow('./?ir='+encodeURIComponent(v)+(t?'&t='+encodeURIComponent(t):''))})())});
