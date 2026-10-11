# tools fork

Hosted by [tools](https://github.com/djcedr/tools) at `/gpx`; the static editor lives at `/studio/fr/app`.

GPX files are persisted exclusively by the tools server, in SQLite on a durable Docker volume. Dexie uses a private `fake-indexeddb` factory in RAM for the editor's reactive state and undo stack. Browser IndexedDB receives no files. Reloads load the server's state; offline editing is deliberately unavailable. Theme preferences may remain in localStorage.

`GET /api/gpx` returns `{ files: [{ id, version, file }] }`. `POST /api/gpx` accepts `{ changes: [{ id, version, file }] }`, where a null version creates a new UUID and a null file deletes one. Each batch is atomic. The server returns updated versions, or 409 on any stale version. Deleted IDs keep tombstones. A conflict reloads server state and clears the local undo stack; it never silently overwrites another client. The editor polls every three seconds.

The host also provides `POST /api/gpx/export` to turn Raquettes coordinates into a shared track. Walking and running both use GraphHopper's `foot` routing; the GPX activity distinguishes them. Straight tracks preserve point order without routing.

Build: `npm ci --prefix gpx`, then `npm ci --prefix website`, then `PUBLIC_MAPTILER_KEY='' BASE_PATH=/studio npx vite build` from `website/` (or use the tools Dockerfile). No MapTiler account is needed for the default OpenStreetMap layer. Upstream's MIT license remains in LICENSE.
