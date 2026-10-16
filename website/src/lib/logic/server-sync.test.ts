// Run from website/ after npm ci: node --test src/lib/logic/server-sync.test.ts
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const lib = new URL('../', import.meta.url);
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith('$lib/'))
            return next(new URL(`${specifier.slice(5)}.ts`, lib).href, context);
        return next(specifier, context);
    },
});
const { db } = await import('$lib/db');
const { get } = await import('svelte/store');
const files: any = db.files;

type Trace = { id: string; version: number; file: any };
const trace = (id: string, version: number, name = id): Trace => ({
    id,
    version,
    file: {
        metadata: { name },
        wpt: [],
        trk: [
            {
                trkseg: [
                    {
                        trkpt: [
                            { attributes: { lat: 46, lon: 6 }, time: '2026-10-16T10:00:00.000Z' },
                        ],
                    },
                ],
            },
        ],
        _data: { id },
    },
});

// A scripted /api/gpx: strong ETags over ordered ids/versions, 304 only for a matching validator.
function server(list: Trace[]) {
    const requests: { method: string; validator: string | null; cache?: RequestCache }[] = [];
    const queue: (() => Response)[] = [];
    const etag = () => `"t-${list.map((f) => `${f.id}.${f.version}`).join('+')}"`;
    let reads = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        const validator = new Headers(init.headers).get('If-None-Match');
        requests.push({ method, validator, cache: init.cache });
        const scripted = queue.shift();
        if (scripted) return scripted();
        if (method === 'POST') {
            const result = [];
            for (const change of JSON.parse(init.body as string).changes) {
                const index = list.findIndex((f) => f.id === change.id);
                if ((list[index]?.version ?? null) !== change.version)
                    return new Response('', { status: 409 });
                const version = (change.version ?? 0) + 1;
                const next = { id: change.id, version, file: change.file };
                if (!change.file) list.splice(index, 1);
                else if (index < 0) list.push(next);
                else list[index] = next;
                result.push({ id: change.id, version, deleted: !change.file });
            }
            return Response.json({ files: result });
        }
        if (validator === etag())
            return new Response(null, { status: 304, headers: { ETag: etag() } });
        const response = new Response(JSON.stringify({ files: list, test: true }), {
            headers: { ETag: etag() },
        });
        const text = response.text.bind(response);
        response.text = () => {
            reads++;
            return text();
        };
        return response;
    }) as typeof fetch;
    return {
        requests,
        queue,
        etag,
        reads: () => reads,
        set: (next: Trace[]) => {
            list = next;
        },
        validators: () => requests.map((r) => r.validator),
    };
}
let loaded = 0;
// Fresh module state (versions, tombstones, validator) per test, over the shared volatile db.
const fresh = async () => import(`./server-sync.ts?case=${++loaded}`);
const names = async () =>
    (await files.toArray()).map((f: any) => [f._data.id, f._data.serverVersion, f.metadata.name]);
const down = (): Response => {
    throw new TypeError('fetch failed');
};

test('polls revalidate after a successful snapshot and 304 is never parsed', async () => {
    const remote = server([trace('a', 1), trace('b', 2)]);
    const sync = await fresh();
    await sync.refreshServer();
    assert.deepEqual(await names(), [
        ['a', 1, 'a'],
        ['b', 2, 'b'],
    ]);
    assert.ok((await files.get('a')).trk[0].trkseg[0].trkpt[0].time instanceof Date);
    await db.patches.put({ patch: [], inversePatch: [], index: 0 }, 0);
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators(), [null, remote.etag(), remote.etag()]);
    assert.ok(remote.requests.every((r) => r.cache === 'no-store'));
    assert.equal(remote.reads(), 1);
    assert.equal(await db.patches.count(), 1, 'an unchanged poll keeps the undo stack');
    assert.equal(get(sync.syncError), '');
    const before = remote.etag();
    remote.set([trace('a', 1), trace('b', 3, 'b2')]);
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators().slice(-2), [before, remote.etag()]);
    assert.deepEqual(await names(), [
        ['a', 1, 'a'],
        ['b', 3, 'b2'],
    ]);
    assert.equal(remote.reads(), 2);
});

test('unsolicited or mismatched 304 is rejected and the next poll is unconditional', async () => {
    const remote = server([trace('a', 1)]);
    const sync = await fresh();
    remote.queue.push(() => new Response(null, { status: 304, headers: { ETag: '"x"' } }));
    await sync.refreshServer();
    assert.equal(get(sync.syncError), 'Serveur indisponible. Réessai automatique.');
    await sync.refreshServer();
    assert.equal(get(sync.syncError), '');
    remote.queue.push(() => new Response(null, { status: 304, headers: { ETag: '"other"' } }));
    await sync.refreshServer();
    assert.equal(get(sync.syncError), 'Serveur indisponible. Réessai automatique.');
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators(), [null, null, remote.etag(), null, remote.etag()]);
    assert.deepEqual(await names(), [['a', 1, 'a']]);
});

test('saves and conflict recovery reload unconditionally before revalidating', async () => {
    const remote = server([trace('a', 1), trace('b', 1)]);
    const sync = await fresh();
    await sync.refreshServer();
    const mine = { ...trace('a', 1).file, metadata: { name: 'mine' } };
    const commit = async (versions: Map<string, number>) => {
        await files.put(
            { ...mine, _data: { ...mine._data, serverVersion: versions.get('a') } },
            'a'
        );
    };
    assert.equal(
        await sync.saveServer(
            [mine],
            [],
            new Map([
                ['a', 1],
                ['b', 1],
            ]),
            commit
        ),
        true
    );
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators().slice(1), [null, null, remote.etag()]);
    assert.deepEqual(await names(), [
        ['a', 2, 'mine'],
        ['b', 1, 'b'],
    ]);
    remote.set([trace('a', 2, 'mine'), trace('b', 2, 'theirs')]);
    const losing = { ...trace('b', 1).file, metadata: { name: 'losing' } };
    assert.equal(await sync.saveServer([losing], [], new Map([['b', 1]]), commit), false);
    assert.equal(get(sync.syncError), 'Trace modifiée ailleurs. Réessayez votre modification.');
    assert.deepEqual(
        remote.requests.slice(-2).map((r) => [r.method, r.validator]),
        [
            ['POST', null],
            ['GET', null],
        ]
    );
    assert.deepEqual(await names(), [
        ['a', 2, 'mine'],
        ['b', 2, 'theirs'],
    ]);
    await sync.refreshServer();
    assert.equal(remote.validators().at(-1), remote.etag());
});

test('failed recovery and failed editor transactions never keep a validator', async () => {
    const remote = server([trace('a', 1)]);
    const sync = await fresh();
    await sync.refreshServer();
    remote.queue.push(down, down);
    const edit = { ...trace('a', 1).file, metadata: { name: 'offline' } };
    const noop = async () => {};
    assert.equal(await sync.saveServer([edit], [], new Map([['a', 1]]), noop), false);
    assert.equal(await sync.saveServer([edit], [], new Map([['a', 1]]), noop), false);
    assert.equal(get(sync.syncError), 'Synchronisation en cours. Réessayez.');
    await sync.refreshServer();
    assert.deepEqual(
        remote.requests.slice(-3).map((r) => [r.method, r.validator]),
        [
            ['POST', null],
            ['GET', null],
            ['GET', null],
        ]
    );
    assert.deepEqual(await names(), [['a', 1, 'a']]);
    const before = remote.etag();
    remote.set([trace('a', 2, 'theirs')]);
    const put = files.put;
    files.put = async () => {
        throw new Error('editor transaction failed');
    };
    try {
        await sync.refreshServer();
    } finally {
        files.put = put;
    }
    assert.equal(get(sync.syncError), 'Serveur indisponible. Réessai automatique.');
    assert.deepEqual(await names(), [['a', 1, 'a']], 'the failed transaction rolled back');
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators().slice(-3), [before, null, remote.etag()]);
    assert.deepEqual(await names(), [['a', 2, 'theirs']]);
});

test('servers without validators keep the full unconditional poll', async () => {
    const remote = server([trace('a', 1)]);
    const sync = await fresh();
    const plain = () => Response.json({ files: [trace('a', 1)], test: true });
    remote.queue.push(plain, plain);
    await sync.refreshServer();
    await sync.refreshServer();
    await sync.refreshServer();
    assert.deepEqual(remote.validators(), [null, null, null]);
    assert.equal(get(sync.syncError), '');
});
