// ── Sunno Service Worker ──
// Caches app shell for offline support. WebLLM model files are cached by the library itself.

const CACHE_NAME = "sunno-v12";
const APP_SHELL = [
    "/",
    "/index.html",
    "/styles.css",
    "/app.js",
    "/capabilities.js",
    "/listener-prompt.js",
    "/safety.js",
    "/local-storage.js",
    "/edge-llm.js",
    "/edge-tts.js",
    "/ambient.js",
    "/manifest.json",
    "/assets/icon-192.png",
    "/assets/icon-512.png",
];

// Install: cache app shell
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_SHELL);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME && !key.includes("webllm") && !key.includes("mlc"))
                    .map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API calls
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Skip WebSocket and API requests
    if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/api/")) {
        return;
    }

    // Skip WebLLM model downloads (let the library handle caching)
    if (url.hostname.includes("huggingface") || url.hostname.includes("cdn.jsdelivr") || url.hostname.includes("esm.run")) {
        return;
    }

    // Cache Google Fonts on first fetch (for offline support)
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => cached || new Response("", { status: 503 }));
            })
        );
        return;
    }

    // Cache-first for app shell assets, with offline fallback
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // Offline fallback: serve cached index.html for navigation requests
                if (event.request.mode === "navigate") {
                    return caches.match("/index.html");
                }
                return new Response("", { status: 503 });
            });
        })
    );
});
