"use strict";

const prefix = "wawtech-2026-organizer-";
const cacheName = prefix + "2";
const assets = [
  "./index.html", "./style.css", "./agenda.js", "./route.js", "./app.js",
  "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"
];
const home = new URL("./index.html", self.registration.scope).href;
const cacheable = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    assets.map(path => new Request(path, { cache: "reload" }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(prefix) && name !== cacheName)
    .map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  const key = request.mode === "navigate" ? home : request.url;
  if (!cacheable.has(key)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const saved = await cache.match(key);
    if (saved) return saved;
    return fetch(request);
  }));
});
