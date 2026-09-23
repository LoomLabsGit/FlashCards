// Retainiac service worker: lets the app open and run with no connection.
//  - The app page and its small static files are saved on first visit. The
//    page is always fetched fresh when online, so a new deploy shows up on the
//    next load; the saved copy is only used when the network isn't there.
//  - Libraries, fonts and pack pictures from the CDNs are saved the first time
//    they're used (or when "Download for offline" fetches a pack's pictures).
//  - /api/* and the Supabase sync calls are never touched.
const SHELL = "retainiac-shell-v1";      // same-origin files
const ASSETS = "retainiac-assets-v1";    // cross-origin files; also holds downloaded pack pictures, so it's never version-bumped away
const SHELL_FILES = ["./", "manifest.webmanifest", "favicon.svg", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
const CDN_LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
];
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com", "flagcdn.com"];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    const assets = await caches.open(ASSETS);
    // A CDN hiccup shouldn't stop the app itself from installing.
    await Promise.all(CDN_LIBS.map(async (url) => {
      try {
        const r = await fetch(url, { mode: "cors", credentials: "omit" });
        if (r.ok) await assets.put(url, r);
      } catch (e) { /* fetched on first use instead */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, ASSETS];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.indexOf("retainiac-") === 0 && keep.indexOf(n) === -1).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function navigate(request) {
  const cache = await caches.open(SHELL);
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  try {
    const resp = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    if (resp.ok && !resp.redirected) cache.put(key, resp.clone());
    return resp;
  } catch (e) {
    return (await cache.match(key, { ignoreVary: true })) || (await cache.match("./", { ignoreVary: true })) || Response.error();
  }
}

async function sameOrigin(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  const refresh = fetch(request).then((resp) => {
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  });
  if (cached) { refresh.catch(() => {}); return cached; }
  return refresh;
}

async function cdn(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached) return cached;
  try {
    // CORS mode so what's stored is a normal, readable response (opaque ones
    // count as several MB each against storage quota).
    const resp = await fetch(request.url, { mode: "cors", credentials: "omit" });
    if (resp.ok) cache.put(request.url, resp.clone());
    return resp;
  } catch (e) {
    return fetch(request).catch(() => Response.error());
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf("/api/") === 0) return;
    event.respondWith(request.mode === "navigate" ? navigate(request) : sameOrigin(request));
  } else if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cdn(request));
  }
});
