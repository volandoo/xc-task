import * as turf from "@turf/turf";
import { Task, TrackPoint, Waypoint, LatLng } from "./types";

// TOLERANCE adds 0.1% buffer to waypoint radius to account for GPS inaccuracy
const TOLERANCE = 0.001;
const SSS_INDEX = 1;

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


    if (step.visitedCount < sssIndex + 1) {
        // Determine SSS waypoint type by checking if next waypoint radius is outside SSS radius
        // If next waypoint radius is outside SSS radius, then SSS is "exit" type
        // If next waypoint radius is inside SSS radius, then SSS is "enter" type
        const sssWaypoint = task.waypoints[sssIndex];

        if (sssIndex + 1 < task.waypoints.length) {
            const nextWaypoint = task.waypoints[sssIndex + 1];
            const distanceToNext = distanceBetweenWaypoints(sssWaypoint, nextWaypoint);

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
            wasInsideSSS = isInside(track[step.trackIndex], task.waypoints[sssIndex]);
        }
    }


    // STEP 1: Find starting point - first track point inside the first waypoint
    if (step.visitedCount === 0) {
        for (let i = 0; i < track.length; i++) {
            if (isInside(track[i], task.waypoints[0])) {
                step.visitedCount = 1; // Mark first waypoint as visited
                step.isInsideNext = isInside(track[i], task.waypoints[1]); // Set state to outside waypoint since its the first waypoint
                step.trackIndex = i; // Record position in track
                step.waypoints[0] = copyTrackPoint(track[i]); // Store entry point
                // Check if this starting point is also inside SSS
                if (isInside(track[i], task.waypoints[sssIndex])) {
                    wasInsideSSS = true;
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
            const isCurrentlyInsideSSS = isInside(point, task.waypoints[sssIndex]);

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

            wasInsideSSS = isCurrentlyInsideSSS;
        }

        // Stop if all waypoints have been completed
        if (step.visitedCount >= task.waypoints.length) {
            continue; // Continue to track SSS touches even after task completion
        }

        if (step.isInsideNext) {
            // STEP 2A: Currently inside the next waypoint - look for exit to mark as completed
            if (isOutside(point, task.waypoints[step.visitedCount])) {
                step.waypoints[step.visitedCount] = copyTrackPoint(point); // Store exit point
                step.visitedCount++; // Mark waypoint as completed
                if (step.visitedCount >= task.waypoints.length) {
                    break;
                }
                step.isInsideNext = isInside(point, task.waypoints[step.visitedCount]);
            }
        } else {
            // STEP 2B: Currently outside the next waypoint - look for entry into next waypoint
            if (isInside(point, task.waypoints[step.visitedCount])) {
                step.waypoints[step.visitedCount] = copyTrackPoint(point); // Store entry point
                step.visitedCount++; // Mark waypoint as completed
                if (step.visitedCount >= task.waypoints.length) {
                    break;
                }
                step.isInsideNext = isInside(point, task.waypoints[step.visitedCount]);
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

// isInside checks if a track point is within a waypoint's radius (with tolerance)
function isInside(trackPoint: TrackPoint, wayPoint: Waypoint): boolean {
    return distance(trackPoint, wayPoint) <= wayPoint.radius * (1 + TOLERANCE);
}

// isOutside checks if a track point is outside a waypoint's radius (with tolerance)
function isOutside(trackPoint: TrackPoint, wayPoint: Waypoint): boolean {
    return distance(trackPoint, wayPoint) > wayPoint.radius * (1 + TOLERANCE);
}

// distance calculates the great-circle distance between two geographic points using Haversine formula
function distance(trackPoint: TrackPoint, wayPoint: Waypoint): number {
    const from = turf.point([trackPoint.latLng.lon, trackPoint.latLng.lat]);
    const to = turf.point([wayPoint.latLng.lon, wayPoint.latLng.lat]);
    return turf.distance(from, to, { units: "meters" }); // Returns distance in meters
}

// distanceBetweenWaypoints calculates the distance between two waypoints
function distanceBetweenWaypoints(wp1: Waypoint, wp2: Waypoint): number {
    const from = turf.point([wp1.latLng.lon, wp1.latLng.lat]);
    const to = turf.point([wp2.latLng.lon, wp2.latLng.lat]);
    return turf.distance(from, to, { units: "meters" }); // Returns distance in meters
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

