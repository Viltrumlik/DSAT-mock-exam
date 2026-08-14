/* Service worker: push display and click-through, and nothing else.

   Deliberately has no fetch handler. A worker that intercepts fetch owns the app's caching
   story, and this one exists only so the browser has somewhere to deliver a push — adding
   caching here would make every deploy a cache-invalidation problem for no benefit.

   NOTE for deploys: nginx caches *.js for 30 days. This file needs an exact
   `location = /sw.js` block with `Cache-Control: no-cache`, or a broken worker is
   un-updatable for a month. */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "MasterSAT", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "MasterSAT", {
      body: payload.body || "",
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: payload.url || "/", id: payload.id },
      // Same tag collapses repeats on the device, mirroring the server's dedupe_key.
      tag: payload.category || "general",
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab rather than opening a second one — a student tapping three
      // notifications should not end up with three copies of the app.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
