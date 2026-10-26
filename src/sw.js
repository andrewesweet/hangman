/* Keeps the game playable offline. The build writes the CACHE line above from a hash of
   these files, so changing any of them makes the next online visit install a fresh copy. */
const FILES = ["play.html", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
const URLS = new Set(FILES.map(f => new URL(f, self.location).href));

self.addEventListener("install", event => {
  /* "reload" skips the HTTP cache, so a new version never stores an older copy of a file. */
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(f => new Request(f, {cache: "reload"}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("hangman-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Cache first for the game's own files, whatever the query (play.html?skin=a); everything else is left to the network. */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  url.search = url.hash = "";
  if (event.request.method !== "GET" || !URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE)
    .then(cache => cache.match(url.href))
    .then(hit => hit || fetch(event.request)));
});
