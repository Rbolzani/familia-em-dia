// Service Worker mínimo — existe apenas para o app atender aos critérios de
// PWA instalável. Não faz cache offline.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

// v2 — SEM handler de fetch.
//
// O handler existia porque a instalabilidade do PWA exigia um. O Chrome
// REMOVEU essa exigência (v108 no celular, v112 no desktop) justamente porque
// virou teatro: sites passaram a registrar handlers vazios só para cumprir o
// critério, piorando a performance sem entregar nada offline.
//
// Removido aqui porque o OCR falhava no celular com "Failed to fetch" — erro
// de camada de rede, antes de chegar ao servidor. Um service worker que
// intercepta requisições é o primeiro suspeito nesse cenário: aparelhos que
// instalaram o PWA quando o handler era `respondWith(fetch(event.request))`
// podem continuar rodando aquela versão, e um pass-through daquele tipo
// quebra POST com corpo grande.
//
// Sem handler de fetch, o navegador não roteia nada pelo service worker.
// A instalação pelo menu continua funcionando.
//
// ⚠️ Mudar o conteúdo deste arquivo é o que faz o navegador atualizar o
// service worker. Se precisar forçar de novo, altere este comentário.
