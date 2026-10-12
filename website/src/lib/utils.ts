import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { base } from '$app/paths';
import { languages } from '$lib/languages';
import { TrackPoint, Waypoint, type Coordinates, crossarcDistance, distance, GPXFile } from 'gpx';
import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import { terrainElevation } from '$lib/logic/terrain-elevation';
import type { GPXStatisticsTree } from '$lib/logic/statistics-tree';
import { ListTrackSegmentItem } from '$lib/components/file-list/file-list';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function getClosestLinePoint(
    points: TrackPoint[],
    point: TrackPoint | Coordinates,
    details: any = {}
): TrackPoint {
    let closest = points[0];
    let closestDist = Number.MAX_VALUE;
    for (let i = 0; i < points.length - 1; i++) {
        let dist = crossarcDistance(points[i], points[i + 1], point);
        if (dist < closestDist) {
            closestDist = dist;
            if (distance(points[i], point) <= distance(points[i + 1], point)) {
                closest = points[i];
                details['before'] = true;
                details['index'] = i;
            } else {
                closest = points[i + 1];
                details['before'] = false;
                details['index'] = i + 1;
            }
        }
    }
    details['distance'] = closestDist;
    return closest;
}

export function getClosestTrackSegments(
    file: GPXFile,
    statistics: GPXStatisticsTree,
    point: Coordinates
): [number, number][] {
    let segmentBoundsDistances: [number, number, number][] = [];
    file.forEachSegment((segment, trackIndex, segmentIndex) => {
        let segmentStatistics = statistics.getStatisticsFor(
            new ListTrackSegmentItem(file._data.id, trackIndex, segmentIndex)
        );
        let segmentBounds = segmentStatistics.global.bounds;
        let northEast = segmentBounds.northEast;
        let southWest = segmentBounds.southWest;
        let bounds = new LngLatBounds(southWest, northEast);
        if (bounds.contains(point)) {
            segmentBoundsDistances.push([0, trackIndex, segmentIndex]);
        } else {
            let northWest: Coordinates = { lat: northEast.lat, lon: southWest.lon };
            let southEast: Coordinates = { lat: southWest.lat, lon: northEast.lon };
            let distanceToBounds = Math.min(
                crossarcDistance(northWest, northEast, point),
                crossarcDistance(northEast, southEast, point),
                crossarcDistance(southEast, southWest, point),
                crossarcDistance(southWest, northWest, point)
            );
            segmentBoundsDistances.push([distanceToBounds, trackIndex, segmentIndex]);
        }
    });
    segmentBoundsDistances.sort((a, b) => a[0] - b[0]);

    let closest: { distance: number; indices: [number, number][] } = {
        distance: Number.MAX_VALUE,
        indices: [],
    };
    for (let s = 0; s < segmentBoundsDistances.length; s++) {
        if (segmentBoundsDistances[s][0] > closest.distance) {
            break;
        }
        const segment = file.getSegment(segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]);
        segment.trkpt.forEach((pt) => {
            let dist = distance(pt.getCoordinates(), point);
            if (dist < closest.distance) {
                closest.distance = dist;
                closest.indices = [[segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]]];
            } else if (dist === closest.distance) {
                closest.indices.push([segmentBoundsDistances[s][1], segmentBoundsDistances[s][2]]);
            }
        });
    }

    return closest.indices;
}

export function getElevation(points: (TrackPoint | Waypoint | Coordinates)[]): Promise<number[]> {
    return terrainElevation(points.map(point => point instanceof TrackPoint || point instanceof Waypoint ? point.getCoordinates() : point));
}

export function loadSVGIcon(map: MapLibreMap, id: string, svg: string, size: number = 100) {
    if (!map.hasImage(id)) {
        let icon = new Image(size, size);
        icon.onload = () => {
            if (!map.hasImage(id)) {
                map.addImage(id, icon);
            }
        };
        icon.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    }
}

export function isMac() {
    return navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
}

export function isSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function getURLForLanguage(lang: string, path: string): string {
    let newPath = path.replace(base, '');

    let languageInPath = newPath.split('/')[1];
    if (!languages.hasOwnProperty(languageInPath)) {
        languageInPath = 'en';
    }

    if (newPath === '/' && lang !== 'en') {
        newPath = '';
    }

    if (languageInPath === 'en') {
        if (lang === 'en') {
            return `${base}${newPath}`;
        } else {
            return `${base}/${lang}${newPath}`;
        }
    } else {
        if (lang === 'en') {
            newPath = newPath.replace(`/${languageInPath}`, '');
            return newPath === '' ? `${base}/` : `${base}${newPath}`;
        } else {
            newPath = newPath.replace(`/${languageInPath}`, `/${lang}`);
            return `${base}${newPath}`;
        }
    }
}
