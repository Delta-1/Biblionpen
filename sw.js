const CACHE_NAME = 'bibliopen-v2';

// Ativa o Service Worker imediatamente
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Limpa caches de versões anteriores, senão o site velho fica preso no
    // navegador de quem já usou.
    event.waitUntil(
        caches.keys()
            .then((nomes) => Promise.all(
                nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Só mexemos no que é NOSSO e só em GET.
    //
    // A busca conversa com catálogos de fora (Gutendex, Internet Archive,
    // Wikisource, Open Library). Passar essas chamadas por aqui não traz
    // benefício nenhum e cria dois problemas: soma uma camada a cada busca e,
    // quando a rede falha, o `caches.match` devolve `undefined` — e responder
    // `undefined` transforma uma falha de rede comum num erro opaco, sem
    // mensagem, do lado de quem está buscando.
    const mesmaOrigem = new URL(req.url).origin === self.location.origin;
    if (req.method !== 'GET' || !mesmaOrigem) return;

    // Rede primeiro, cache como rede de segurança — e desta vez o cache é
    // realmente preenchido, que é o que faltava para o site abrir offline.
    event.respondWith(
        fetch(req)
            .then((resp) => {
                if (resp && resp.ok) {
                    const copia = resp.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {});
                }
                return resp;
            })
            .catch(() => caches.match(req).then((achado) => achado || caches.match('./index.html')))
    );
});
