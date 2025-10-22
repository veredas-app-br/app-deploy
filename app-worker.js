// -----------------------------------------------------------------------------
// PWA
// -----------------------------------------------------------------------------
const cacheName = "app-" + "db7b7fe13bdb11353b27511070379f0740e3c808";
const tilesCacheName = "osm-tiles-v1";
const TILE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const resourcesToCache = ["/app-deploy/web/leaflet.js","/app-deploy/web/leaflet.css","/app-deploy/web/icon.svg","/app-deploy/web/daisyui.css","/app-deploy/web/app.wasm","/app-deploy/web/animations.css","/app-deploy/wasm_exec.js","/app-deploy/manifest.webmanifest","/app-deploy/app.js","/app-deploy/app.css","/app-deploy"];

self.addEventListener("install", async (event) => {
  try {
    console.log("installing app worker db7b7fe13bdb11353b27511070379f0740e3c808");
    await installWorker();
    await self.skipWaiting();
  } catch (error) {
    console.error("error during installation:", error);
  }
});

async function installWorker() {
  const cache = await caches.open(cacheName);
  await cache.addAll(resourcesToCache);
}

self.addEventListener("activate", async (event) => {
  try {
    await deletePreviousCaches();
    await cleanupOldTiles();
    await self.clients.claim();
    console.log("app worker db7b7fe13bdb11353b27511070379f0740e3c808 is activated");
  } catch (error) {
    console.error("error during activation:", error);
  }
});

async function deletePreviousCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.map(async (key) => {
      if (key !== cacheName && key !== tilesCacheName) {
        try {
          console.log("deleting", key, "cache");
          await caches.delete(key);
        } catch (err) {
          console.error("deleting", key, "cache failed:", err);
        }
      }
    })
  );
}

// -----------------------------------------------------------------------------
// Tile Cache Strategy
// -----------------------------------------------------------------------------
const OSM_TILE_PATTERN = /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/;

function isTileRequest(url) {
  return OSM_TILE_PATTERN.test(url);
}

async function isCachedTileValid(cachedResponse) {
  const cachedDate = cachedResponse.headers.get('sw-cached-date');
  if (!cachedDate) {
    return false;
  }
  
  const cacheAge = Date.now() - parseInt(cachedDate);
  return cacheAge < TILE_CACHE_DURATION;
}

async function handleTileRequest(request) {
  const cache = await caches.open(tilesCacheName);
  const cachedResponse = await cache.match(request);
  
  // If we have a valid cached tile, return it
  if (cachedResponse && await isCachedTileValid(cachedResponse)) {
    console.log('Serving tile from cache:', request.url);
    return cachedResponse;
  }
  
  // Try to fetch from network
  try {
    console.log('Fetching tile from network:', request.url);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Clone the response before caching
      const responseToCache = networkResponse.clone();
      
      // Add cache date header
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cached-date', Date.now().toString());
      
      const cachedResponseWithDate = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      // Cache the new tile
      await cache.put(request, cachedResponseWithDate);
      console.log('Tile cached:', request.url);
      
      return networkResponse;
    }
    
    // Network fetch failed, but if we have expired cache, serve it anyway
    if (cachedResponse) {
      console.log('Network failed, serving expired cache:', request.url);
      return cachedResponse;
    }
    
    return networkResponse;
  } catch (error) {
    // Network error, serve expired cache if available
    if (cachedResponse) {
      console.log('Network error, serving expired cache:', request.url);
      return cachedResponse;
    }
    
    // No cache available, return error
    console.error('Failed to fetch tile:', request.url, error);
    return new Response('Tile not available', { status: 503 });
  }
}

async function cleanupOldTiles() {
  const cache = await caches.open(tilesCacheName);
  const requests = await cache.keys();
  const now = Date.now();
  
  let cleanedCount = 0;
  for (const request of requests) {
    const response = await cache.match(request);
    if (response) {
      const cachedDate = response.headers.get('sw-cached-date');
      if (cachedDate) {
        const cacheAge = now - parseInt(cachedDate);
        // Remove tiles older than 30 days
        if (cacheAge > 30 * 24 * 60 * 60 * 1000) {
          await cache.delete(request);
          cleanedCount++;
        }
      }
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} old tiles`);
  }
}

// -----------------------------------------------------------------------------
// Fetch Handler
// -----------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  
  // Handle tile requests with special caching strategy
  if (isTileRequest(url)) {
    event.respondWith(handleTileRequest(event.request));
  } else {
    // Handle app resources with standard caching
    event.respondWith(fetchWithCache(event.request));
  }
});

async function fetchWithCache(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  return await fetch(request);
}

// -----------------------------------------------------------------------------
// Push Notifications
// -----------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  if (!event.data || !event.data.text()) {
    return;
  }

  const notification = JSON.parse(event.data.text());
  if (!notification) {
    return;
  }

  const title = notification.title;
  delete notification.title;

  if (!notification.data) {
    notification.data = {};
  }
  let actions = [];
  for (let i in notification.actions) {
    const action = notification.actions[i];

    actions.push({
      action: action.action,
      path: action.path,
    });

    delete action.path;
  }
  notification.data.goapp = {
    path: notification.path,
    actions: actions,
  };
  delete notification.path;

  event.waitUntil(self.registration.showNotification(title, notification));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notification = event.notification;
  let path = notification.data.goapp.path;

  for (let i in notification.data.goapp.actions) {
    const action = notification.data.goapp.actions[i];
    if (action.action === event.action) {
      path = action.path;
      break;
    }
  }

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
      })
      .then((clientList) => {
        for (var i = 0; i < clientList.length; i++) {
          let client = clientList[i];
          if ("focus" in client) {
            client.focus();
            client.postMessage({
              goapp: {
                type: "notification",
                path: path,
              },
            });
            return;
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(path);
        }
      })
  );
});