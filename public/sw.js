// Service Worker mínimo — existe apenas para o app atender aos critérios de
// PWA instalável. Não faz cache offline.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

// O handler precisa EXISTIR (critério de instalabilidade), mas NÃO deve
// chamar respondWith: sem isso o browser trata cada requisição normalmente.
// A versão anterior fazia `event.respondWith(fetch(event.request))`, um
// pass-through que roteava TODAS as requisições pela thread do SW sem
// nenhum ganho — custo extra no mobile e quebra de requisições Range
// (vídeo/áudio da landing passam a ser baixados inteiros).
self.addEventListener('fetch', () => {})
