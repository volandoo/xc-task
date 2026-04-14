import * as turf from "@turf/turf";
import { Task, TrackPoint, Waypoint, LatLng } from "./types";

// TOLERANCE adds 0.1% buffer to waypoint radius to account for GPS inaccuracy
const TOLERANCE = 0.001;

// TravelWaypoint represents a waypoint entry point with timestamp
export type TravelWaypoint = {
    latLng: LatLng;
    time: number;
};

// CurrentStep holds the current state of the task completion process
export type CurrentStep = {
    visitedCount: number; // Number of waypoints successfully completed
    isInsideNext: boolean; // Whether currently inside a waypoint
    trackIndex: number; // Current position in GPS track
    waypoints: TrackPoint[]; // Track points where waypoints were entered
};

export function getSSSIndex(task: Task): number {
    for (let i = 0; i < task.waypoints.length; i++) {
        if (task.waypoints[i].type === "sss") {
            return i;
        }
    }
    return 1;
}

export function getESSIndex(task: Task): number {
    for (let i = 0; i < task.waypoints.length; i++) {
        if (task.waypoints[i].type === "ess") {
            return i;
        }
    }
    return task.waypoints.length - 1;
}

// TravelTask processes a GPS track against a flight task to determine completion progress
export function travelTask({
    task,
    track,
    step,
    onProgress,
    onProgressInterval
}: {
    task: Task,
    track: TrackPoint[],
    step?: CurrentStep,
    onProgress?: (step: CurrentStep) => void,
    onProgressInterval?: number;
}): CurrentStep {
    // Initialize step state if not provided
    if (!step) {
        step = {
            visitedCount: 0,
            isInsideNext: false,
            trackIndex: 0,
            waypoints: new Array(task.waypoints.length).fill(null).map(() => ({
                latLng: { lat: 0, lon: 0 },
                time: 0
            }))
        };
    }

    // Require minimum 3 waypoints for valid task
    if (task.waypoints.length < 3) {
        return step;
    }

    // Find the SSS waypoint index
    const sssIndex = getSSSIndex(task);
    let wasInsideSSS = false;
    let sssType = "";
    const useFirstSSSEntryTime = task.useFirstSSSEntryTime === true;


    if (step.visitedCount < sssIndex + 1) {
        // Determine SSS waypoint type by checking if next waypoint radius is outside SSS radius
        // If next waypoint radius is outside SSS radius, then SSS is "exit" type
        // If next waypoint radius is inside SSS radius, then SSS is "enter" type
        const sssWaypoint = task.waypoints[sssIndex];

        if (sssIndex + 1 < task.waypoints.length) {
            const nextWaypoint = task.waypoints[sssIndex + 1];
            const distanceToNext = vincentyDistance(sssWaypoint.latLng, nextWaypoint.latLng);

            // If the next waypoint radius is outside the SSS radius, SSS is an "exit" waypoint
            // If the next waypoint radius is inside the SSS radius, SSS is an "enter" waypoint
            if (distanceToNext + nextWaypoint.radius > sssWaypoint.radius) {
                sssType = "exit";
            } else {
                sssType = "enter";
            }
        }

        // Track whether we were inside SSS on the previous point
        if (step.trackIndex > 0 && step.trackIndex < track.length) {
            wasInsideSSS = isInsideMixed(track[step.trackIndex], task.waypoints[sssIndex]);
        }
    }


    // STEP 1: Find starting point - first track point inside the first waypoint
    if (step.visitedCount === 0) {
        for (let i = 0; i < track.length; i++) {
            if (isInsideMixed(track[i], task.waypoints[0])) {
                step.visitedCount = 1; // Mark first waypoint as visited
                step.isInsideNext = isInsideMixed(track[i], task.waypoints[1]); // Set state to outside waypoint since its the first waypoint
                step.trackIndex = i; // Record position in track
                step.waypoints[0] = copyTrackPoint(track[i]); // Store entry point
                // Check if this starting point is also inside SSS
                if (isInsideMixed(track[i], task.waypoints[sssIndex])) {
                    wasInsideSSS = true;
                    if (useFirstSSSEntryTime && !step.waypoints[sssIndex]?.time) {
                        step.waypoints[sssIndex] = copyTrackPoint(track[i]);
                    }
                }
                break;
            }
        }
    }

    // Exit if no valid starting point found
    if (step.visitedCount === 0) {
        return step;
    }

    // STEP 2: Process remaining track points to complete waypoint sequence
    for (let i = step.trackIndex + 1; i < track.length; i++) {
        const point = track[i];
        step.trackIndex = i;

        // Only check for SSS waypoint touches if we haven't passed it yet
        // Stop tracking SSS once we've visited the waypoint after SSS
        if (step.visitedCount <= sssIndex + 1 && sssType !== "") {
            const isCurrentlyInsideSSS = isInsideMixed(point, task.waypoints[sssIndex]);
            const hasRecordedSSSTime = Boolean(step.waypoints[sssIndex]?.time);

            if (useFirstSSSEntryTime) {
                if (isCurrentlyInsideSSS && !wasInsideSSS && !hasRecordedSSSTime) {
                    step.waypoints[sssIndex] = copyTrackPoint(point);
                }
            } else {
                switch (sssType) {
                    case "enter":
                        // For "enter" type: track when pilot enters (outside -> inside)
                        if (isCurrentlyInsideSSS && !wasInsideSSS) {
                            step.waypoints[sssIndex] = copyTrackPoint(point); // Store the last entry point
                        }
                        break;
                    case "exit":
                        // For "exit" type: track when pilot exits (inside -> outside)
                        if (!isCurrentlyInsideSSS && wasInsideSSS) {
                            step.waypoints[sssIndex] = copyTrackPoint(point); // Store the last exit point
                        }
                        break;
                }
            }

            wasInsideSSS = isCurrentlyInsideSSS;
        }

        // Stop if all waypoints have been completed
        if (step.visitedCount >= task.waypoints.length) {
            continue; // Continue to track SSS touches even after task completion
        }

        if (step.isInsideNext) {
            // STEP 2A: Currently inside the next waypoint - look for exit to mark as completed
            if (isOutsideMixed(point, task.waypoints[step.visitedCount])) {
                step.waypoints[step.visitedCount] = copyTrackPoint(point); // Store exit point
                step.visitedCount++; // Mark waypoint as completed
                if (step.visitedCount >= task.waypoints.length) {
                    break;
                }
                step.isInsideNext = isInsideMixed(point, task.waypoints[step.visitedCount]);
            }
        } else {
            // STEP 2B: Currently outside the next waypoint - look for entry into next waypoint
            if (isInsideMixed(point, task.waypoints[step.visitedCount])) {
                step.waypoints[step.visitedCount] = copyTrackPoint(point); // Store entry point
                step.visitedCount++; // Mark waypoint as completed
                if (step.visitedCount >= task.waypoints.length) {
                    break;
                }
                step.isInsideNext = isInsideMixed(point, task.waypoints[step.visitedCount]);
            }
        }

        if (onProgressInterval && onProgress && i % onProgressInterval === 0) {
            onProgress(step);
        }
    }

    // remove any 0,0 waypoints
    step.waypoints = removeZeroWaypoints(step.waypoints);

    // Return updated step state with completion progress
    return step;
}

function removeZeroWaypoints(waypoints: TrackPoint[]): TrackPoint[] {
    return waypoints.filter(
        (waypoint) => waypoint.latLng.lat !== 0 && waypoint.latLng.lon !== 0
    );
}

export function geoJson(step: CurrentStep): turf.Feature[] {
    const features: turf.Feature[] = [];
    for (let i = 0; i < step.waypoints.length; i++) {
        const point = step.waypoints[i];
        const feature = turf.point([point.latLng.lon, point.latLng.lat], {
            type: "point",
            name: "Point",
            color: "red",
            index: i,
            time: new Date(point.time * 1000).toISOString()
        });
        features.push(feature);
    }
    return features;
}

// copyTrackPoint creates a copy of a track point
function copyTrackPoint(point: TrackPoint): TrackPoint {
    return {
        latLng: {
            lat: point.latLng.lat,
            lon: point.latLng.lon
        },
        time: point.time
    };
}

const BOUNDARY_TOLERANCE = 0.025;
const EARTH_RADIUS_MEAN = 6371000.0;
const EARTH_RADIUS_WGS84_MAJOR_AXIS = 6378137.0;
const INVERSE_FLATTENING = 298.257223563;
const DIRECT_FLATTENING = 1.0 / INVERSE_FLATTENING;
const EARTH_RADIUS_WGS84_MINOR_AXIS = (1.0 - DIRECT_FLATTENING) * EARTH_RADIUS_WGS84_MAJOR_AXIS;
const EPSILON = 1e-12;
const MAX_ITERATIONS = 100;

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180.0);
}

function equirectangularDistance(point1: LatLng, point2: LatLng): number {
    const lat1 = toRadians(point1.lat);
    const lat2 = toRadians(point2.lat);
    const lon1 = toRadians(point1.lon);
    const lon2 = toRadians(point2.lon);

    const x = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2);
    const y = lat2 - lat1;

    return EARTH_RADIUS_MEAN * Math.sqrt(x * x + y * y);
}

function vincentyDistance(point1: LatLng, point2: LatLng): number {
    if (point1.lat === point2.lat && point1.lon === point2.lon) {
        return 0.0;
    }

    const lat1 = toRadians(point1.lat);
    const lat2 = toRadians(point2.lat);
    const lon1 = toRadians(point1.lon);
    const lon2 = toRadians(point2.lon);

    const a = EARTH_RADIUS_WGS84_MAJOR_AXIS;
    const b = EARTH_RADIUS_WGS84_MINOR_AXIS;
    const f = DIRECT_FLATTENING;
    const aSqMinusBSqOverBSq = (a * a - b * b) / (b * b);

    const L = lon2 - lon1;
    const U1 = Math.atan((1.0 - f) * Math.tan(lat1));
    const U2 = Math.atan((1.0 - f) * Math.tan(lat2));
    const cosU1 = Math.cos(U1);
    const cosU2 = Math.cos(U2);
    const sinU1 = Math.sin(U1);
    const sinU2 = Math.sin(U2);
    const cosU1cosU2 = cosU1 * cosU2;
    const sinU1sinU2 = sinU1 * sinU2;

    let lambda = L;
    let sigma = 0.0;
    let sinSigma = 0.0;
    let cosSigma = 0.0;
    let cosSqAlpha = 0.0;
    let cos2SM = 0.0;
    let sinAlpha = 0.0;
    let deltaSigma = 0.0;
    let A = 0.0;
    let lambdaOrig: number;
    let iterLimit = MAX_ITERATIONS;

    do {
        lambdaOrig = lambda;
        const cosLambda = Math.cos(lambda);
        const sinLambda = Math.sin(lambda);
        const t1 = cosU2 * sinLambda;
        const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
        const sinSqSigma = t1 * t1 + t2 * t2;
        sinSigma = Math.sqrt(sinSqSigma);
        cosSigma = sinU1sinU2 + cosU1cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);

        sinAlpha = sinSigma === 0 ? 0.0 : (cosU1cosU2 * sinLambda) / sinSigma;
        cosSqAlpha = 1.0 - sinAlpha * sinAlpha;
        cos2SM = cosSqAlpha === 0.0 ? 0.0 : cosSigma - 2.0 * sinU1sinU2 / cosSqAlpha;

        const uSquared = cosSqAlpha * aSqMinusBSqOverBSq;
        A = 1 + (uSquared / 16384.0) * (4096.0 + uSquared * (-768.0 + uSquared * (320.0 - 175.0 * uSquared)));
        const B = (uSquared / 1024.0) * (256.0 + uSquared * (-128.0 + uSquared * (74.0 - 47.0 * uSquared)));
        const C = (f / 16.0) * cosSqAlpha * (4.0 + f * (4.0 - 3.0 * cosSqAlpha));
        const cos2SMSq = cos2SM * cos2SM;
        deltaSigma = B * sinSigma *
            (cos2SM + (B / 4.0) * (cosSigma * (-1.0 + 2.0 * cos2SMSq) -
                (B / 6.0) * cos2SM * (-3.0 + 4.0 * sinSigma * sinSigma) * (-3.0 + 4.0 * cos2SMSq)));

        lambda = L + (1.0 - C) * f * sinAlpha *
            (sigma + C * sinSigma * (cos2SM + C * cosSigma * (-1.0 + 2.0 * cos2SMSq)));
    } while (Math.abs((lambda - lambdaOrig) / lambda) > EPSILON && --iterLimit > 0);

    return b * A * (sigma - deltaSigma);
}

function isInsideMixed(trackPoint: TrackPoint, wayPoint: Waypoint): boolean {
    const radiusWithTolerance = wayPoint.radius * (1 + TOLERANCE);
    const fastDistance = equirectangularDistance(trackPoint.latLng, wayPoint.latLng);
    const lowerBoundary = radiusWithTolerance * (1 - BOUNDARY_TOLERANCE);
    const upperBoundary = radiusWithTolerance * (1 + BOUNDARY_TOLERANCE);

    if (fastDistance < lowerBoundary || fastDistance > upperBoundary) {
        return fastDistance <= radiusWithTolerance;
    }

    const preciseDistance = vincentyDistance(trackPoint.latLng, wayPoint.latLng);
    return preciseDistance <= radiusWithTolerance;
}

function isOutsideMixed(trackPoint: TrackPoint, wayPoint: Waypoint): boolean {
    const radiusWithTolerance = wayPoint.radius * (1 + TOLERANCE);
    const fastDistance = equirectangularDistance(trackPoint.latLng, wayPoint.latLng);
    const lowerBoundary = radiusWithTolerance * (1 - BOUNDARY_TOLERANCE);
    const upperBoundary = radiusWithTolerance * (1 + BOUNDARY_TOLERANCE);

    if (fastDistance < lowerBoundary || fastDistance > upperBoundary) {
        return fastDistance > radiusWithTolerance;
    }

    const preciseDistance = vincentyDistance(trackPoint.latLng, wayPoint.latLng);
    return preciseDistance > radiusWithTolerance;
}
