import { db } from '$lib/db';
import type { GPXFile } from 'gpx';
import { writable, get } from 'svelte/store';
export const syncBusy = writable(false);
export const syncError = writable('');
let versions = new Map<string, number>();
const tombstones = new Map<string, number>();
let refreshing = false;
let initialized = false;
// The server list's ETag, kept only while `versions` and the editor database match it.
let validator: string | null = null;

async function snapshot(force = false) {
    // Recovery never trusts a validator: it always reloads the full server state.
    const sent = !force && initialized ? validator : null;
    const response = await fetch('/api/gpx', {
        cache: 'no-store',
        headers: sent ? { 'If-None-Match': sent } : {},
        signal: AbortSignal.timeout(15000),
    });
    if (response.status === 304) {
        if (sent && response.headers.get('ETag') === sent) return;
        validator = null;
        throw new Error('Serveur indisponible.');
    }
    if (!response.ok) throw new Error('Serveur indisponible.');
    // JSON transport turns GPX Date fields into strings; the editor expects Dates.
    const { files } = JSON.parse(await response.text(), (key, value) => {
        if (key !== 'time') return value;
        if (typeof value !== 'string') return undefined;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    });
    const changed =
        force ||
        !initialized ||
        files.length !== versions.size ||
        files.some((f: any) => versions.get(f.id) !== f.version);
    if (!changed) {
        validator = response.headers.get('ETag');
        return;
    }
    validator = null;
    // Dexie key-path inference recurses through GPXTreeNode.children.
    // @ts-ignore
    await db.transaction('rw', db.files, db.fileids, db.patches, db.settings, async () => {
        await db.files.clear();
        await db.fileids.clear();
        await db.patches.clear();
        await db.settings.put(-1, 'patchIndex');
        for (const item of files) {
            item.file._data = { ...item.file._data, serverVersion: item.version };
            await db.files.put(item.file, item.id);
            await db.fileids.put(item.id, item.id);
        }
    });
    versions = new Map(files.map((f: any) => [f.id, f.version]));
    initialized = true;
    validator = response.headers.get('ETag');
}
export async function refreshServer() {
    if (get(syncBusy) || refreshing) return;
    refreshing = true;
    syncBusy.set(true);
    try {
        await snapshot();
        syncError.set('');
    } catch {
        syncError.set('Serveur indisponible. Réessai automatique.');
    } finally {
        refreshing = false;
        syncBusy.set(false);
    }
}
export async function saveServer(
    files: GPXFile[],
    deleted: string[],
    expected: Map<string, number>,
    commit: (versions: Map<string, number>) => Promise<unknown>
) {
    if (get(syncBusy) || !initialized) {
        syncError.set('Synchronisation en cours. Réessayez.');
        return false;
    }
    syncBusy.set(true);
    try {
        const changes = [
            ...files.map((file) => ({
                id: file._data.id,
                version: expected.get(file._data.id) ?? tombstones.get(file._data.id) ?? null,
                file,
            })),
            ...deleted.map((id) => ({ id, version: expected.get(id) ?? null, file: null })),
        ];
        if (!changes.length) return true;
        // Saved versions change the list; the next poll fetches its new validator.
        validator = null;
        const response = await fetch('/api/gpx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ changes }),
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
            throw new Error(
                response.status === 409
                    ? 'Trace modifiée ailleurs. Réessayez votre modification.'
                    : 'Enregistrement impossible. Réessayez.'
            );
        const result = await response.json();
        for (const item of result.files) {
            if (item.deleted) {
                versions.delete(item.id);
                tombstones.set(item.id, item.version);
            } else {
                versions.set(item.id, item.version);
                tombstones.delete(item.id);
            }
        }
        await commit(versions);
        syncError.set('');
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Enregistrement impossible.';
        try {
            await snapshot(true);
        } catch {
            initialized = false;
            validator = null;
        }
        syncError.set(message);
        return false;
    } finally {
        syncBusy.set(false);
    }
}
export function startServerSync() {
    const interval = setInterval(refreshServer, 3000);
    const unload = (event: BeforeUnloadEvent) => {
        if (get(syncBusy)) {
            event.preventDefault();
            event.returnValue = '';
        }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
        clearInterval(interval);
        window.removeEventListener('beforeunload', unload);
    };
}
