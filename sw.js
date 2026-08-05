const CACHE_NAME = 'bibliopen-v1';

// Ativa o Service Worker imediatamente
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    return self.clients.claim();
});

// Estratégia simples de rede para não quebrar a sincronização do seu CSV
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});