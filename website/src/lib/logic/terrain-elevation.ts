import { TrackPoint, distance, type Coordinates } from 'gpx';

export async function terrainElevation(points: Coordinates[]): Promise<number[]> {
    const elevations: number[] = [];
    for (let offset = 0; offset < points.length; offset += 5000) {
        const batch = points.slice(offset, offset + 5000);
        const response = await fetch('/api/gpx/elevation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: batch.map(p => [p.lon, p.lat]) }),
            signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'Altimétrie IGN indisponible.');
        if (!Array.isArray(data.elevations) || data.elevations.length !== batch.length || !data.elevations.every((z: unknown) => typeof z === 'number' && Number.isFinite(z) && z >= -12000 && z <= 10000)) throw new Error('Altimétrie IGN invalide.');
        elevations.push(...data.elevations);
    }
    return elevations;
}

export function sampleTerrain(points: TrackPoint[]): TrackPoint[] {
    const sampled: TrackPoint[] = [];
    for (let i = 0; i < points.length; i++) {
        if (i) {
            const a = points[i - 1].attributes, b = points[i].attributes;
            const count = Math.ceil(distance(a, b) / 25);
            if (sampled.length + count > 20000) throw new Error('Trace trop longue pour le calcul altimétrique.');
            for (let j = 1; j < count; j++) {
                const fraction = j / count;
                sampled.push(new TrackPoint({ attributes: {lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction}, _data: {anchor: false} }));
            }
        }
        sampled.push(points[i].clone());
    }
    return sampled;
}

export async function withTerrainElevation(points: TrackPoint[]): Promise<TrackPoint[]> {
    const sampled = sampleTerrain(points);
    const elevations = await terrainElevation(sampled.map(p => p.attributes));
    sampled.forEach((point, index) => { point.ele = elevations[index]; });
    return sampled;
}
