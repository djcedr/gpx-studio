<script lang="ts">
    import { selection } from '$lib/logic/selection';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { fileActionManager } from '$lib/logic/file-action-manager';
    import { ListTrackItem } from '$lib/components/file-list/file-list';
    import { currentTool, Tool } from '$lib/components/toolbar/tools';
    import { settings } from '$lib/logic/settings';
    import { Track, type GPXFile } from 'gpx';

    let file = $state<GPXFile>();
    let busy = $state(false);
    let error = $state('');
    const id = $derived($selection.getSelected()[0]?.getFileId());
    $effect(() => {
        const state = id && $fileStateCollection.get(id);
        if (!state) { file = undefined; return; }
        return state.subscribe(value => { file = value?.file; });
    });
    const choices = [ ['points', 'Numéros'], ['straight', 'Vol d’oiseau'], ['routed', 'Sentiers'], ['personal', 'Ma trace'] ];
    const active = $derived(file?.trk.find(track => !track._data.hidden)?.desc?.replace('raquettes:', '') ?? 'points');

    async function choose(mode: string) {
        if (!id || !file || busy) return;
        const fileId = id;
        const source = file;
        busy = true; error = '';
        try {
            let track = source.trk.find(track => track.desc === `raquettes:${mode}`);
            if (mode !== 'points' && !track) {
                if (mode !== 'personal' && source.wpt.length < 2) throw new Error('Deux points minimum.');
                let points = source.wpt.map(point => [point.attributes.lon, point.attributes.lat]);
                if (mode === 'routed') {
                    const response = await fetch('/api/gpx/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({points}), signal: AbortSignal.timeout(35000) });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.message ?? 'Routage indisponible.');
                    points = data.points;
                }
                track = new Track({ name: choices.find(choice => choice[0] === mode)?.[1], desc: `raquettes:${mode}`, type: source.trk[0]?.type ?? 'walking', trkseg: [{ trkpt: mode === 'personal' ? [] : points.map(([lon, lat, ele]) => ({ attributes: { lon, lat }, ...(ele === undefined ? {} : {ele}) })) }] });
            }
            await fileActionManager.applyToFile(fileId, draft => {
                if (JSON.stringify(draft.wpt.map(p => p.attributes)) !== JSON.stringify(source.wpt.map(p => p.attributes))) throw new Error('Points modifiés ailleurs. Réessayez.');
                if (track && !draft.trk.some(item => item.desc === track!.desc)) draft.replaceTracks(draft.trk.length, draft.trk.length - 1, [track!]);
                draft.trk.forEach(item => item.setHidden(mode === 'points' || item.desc !== `raquettes:${mode}`));
                draft.setHiddenWaypoints(false);
            });
            const updated = fileStateCollection.getFile(fileId);
            const index = updated?.trk.findIndex(item => item.desc === `raquettes:${mode}`) ?? -1;
            if (index >= 0) selection.selectItem(new ListTrackItem(fileId, index));
            else selection.selectFile(fileId);
            if (mode === 'personal') { settings.routing.set(false); currentTool.set(Tool.ROUTING); }
            else currentTool.set(null);
        } catch (e) { error = e instanceof Error ? e.message : 'Enregistrement impossible.'; }
        finally { busy = false; }
    }
</script>

{#if file?.wpt.length}
    <div class="absolute bottom-12 left-2 right-2 z-30 flex flex-col items-start gap-1 pointer-events-none">
        {#if error}<p role="alert" class="bg-background text-destructive rounded px-2 py-1 pointer-events-auto">{error}</p>{/if}
        <div aria-label="Versions de la balade" class="flex max-w-full overflow-x-auto rounded-md border bg-background p-1 shadow-sm pointer-events-auto">
            {#each choices as [mode, label]}
                <button type="button" aria-pressed={active === mode} disabled={busy} onclick={() => choose(mode)} class="shrink-0 rounded px-2 py-2 text-xs disabled:opacity-50 {active === mode ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}">{label}</button>
            {/each}
        </div>
    </div>
{/if}
