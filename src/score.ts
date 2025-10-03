import * as turf from "@turf/turf";
import { Task } from "./types";
import processTask from "./task";

export type TrackPoint = {
    lat: number;
    lon: number;
    time: number;
};

type WayPoint = {
    lat: number;
    lon: number;
    rad: number;
};

type CurrentStep = {
    next: number;
    inside: boolean;
    wpts: TrackPoint[];
};

export type TaskScore = {
    goal: number;
    ess: number;
    togoal: number;
    wpts: TrackPoint[];
};

export class TaskScorer {
    private track: TrackPoint[];
    private waypoints: WayPoint[];
    private optimalWpts: Omit<WayPoint, "rad">[];
    private currentStep: CurrentStep;
    private distances: number[];
    private tolerance: number = 0.001; // percentage of waypoint radius to consider as inside, 1 = 100%

    constructor(task: Task, track: TrackPoint[], tolerance: number = 0) {

        // check if time is in seconds, otherwise convert to milliseconds
        if (track[0].time < 1600000000000) {
            track = track.map((t) => ({
                ...t,
                time: t.time * 1000,
            }));
        }
        const processed = processTask(task.waypoints);
        const waypoints = task.waypoints.map((tp) => ({
            lat: tp.latLng.lat,
            lon: tp.latLng.lon,
            rad: tp.radius,
        }));
        const distances = processed.distances;
        const optimalWpts = processed.waypoints;

        this.waypoints = waypoints;
        this.track = track;
        this.distances = distances;
        this.currentStep = { next: 0, inside: true, wpts: [] };
        this.optimalWpts = optimalWpts;
        this.tolerance = tolerance;
    }

    /**
     * Processes the track points against the task waypoints to determine if and when
     * the pilot completed each turnpoint, and optionally calls a callback with scoring updates.
     *
     * The function operates as follows:
     * 1. Validates that there are at least 3 waypoints to form a valid task.
     * 2. Searches for the first track point inside the start cylinder (first waypoint).
     *    - If not found, scoring cannot proceed and returns false.
     * 3. Records this entry and sets up the next waypoint to check.
     * 4. Iterates through the remaining track points, starting after the entry point:
     *    - If currently inside a waypoint, checks for exit (transition to outside).
     *    - If currently outside, checks for entry (transition to inside).
     *    - Each transition (entry/exit) advances to the next waypoint and records the point.
     *    - Optionally, at a specified interval, calls the onCalculated callback with the current score and point.
     * 5. Stops processing if all waypoints are completed or the track ends.
     * 6. At the end, optionally calls the onCalculated callback one last time with the final score.
     *
     * @param params.onCalculated Optional callback called with the current score and track point at intervals.
     * @param params.calculatedInterval Interval (in track points) at which to call onCalculated (default: 30).
     * @returns boolean - true if task was processed successfully, false if invalid or not completed.
     */
    process(params: {
        onCalculated?: (score: TaskScore, point: TrackPoint) => void;
        calculatedInterval?: number;
    }) {
        // If there are fewer than 3 waypoints, scoring cannot proceed
        if (this.waypoints.length < 3) {
            return false;
        }

        let firstInside = false;
        let startIndex = 0;
        // Find the first point in the track that is inside the first waypoint
        for (let i = 0; i < this.track.length; i++) {
            if (this.isInside(this.track[i], this.waypoints[0])) {
                firstInside = true;
                startIndex = i;
                break;
            }
        }

        // If no point in the track is inside the first waypoint, scoring cannot proceed
        if (!firstInside) {
            return false;
        }

        // Set the next waypoint to check
        if (!this.moveToNext(this.track[startIndex])) {
            return false;
        }

        // Iterate through the track starting from the first point inside the first waypoint
        for (let i = startIndex + 1; i < this.track.length; i++) {
            const point = this.track[i];
            const next = this.waypoints[this.currentStep.next];

            // If there are no more waypoints, break
            if (next == null) break;

            // If currently inside a waypoint, check if the point is now outside the next waypoint
            if (this.currentStep.inside) {
                if (this.isOutside(point, next)) {
                    // Move to the next step if possible, otherwise break
                    if (!this.moveToNext(point)) break;
                }
            } else {
                // If currently outside, check if the point is now inside the next waypoint
                if (this.isInside(point, next)) {
                    // Move to the next step if possible, otherwise break
                    if (!this.moveToNext(point)) break;
                }
            }
            if (params.onCalculated && i % (params.calculatedInterval ?? 30) === 0) {
                const curr = this.currentStep.next;
                params.onCalculated(this.calculateScore(point), point);
                this.currentStep.next = curr;
            }
        }

        if (params.onCalculated) {
            params.onCalculated(this.calculateScore(), this.track[this.track.length - 1]);
        }
        // If all logic passes, return true
        return true;
    }

    calculateScore(point?: Omit<TrackPoint, "time">) {
        const togoal = this.distanceLeft(point ?? this.track[this.track.length - 1]);
        return {
            goal: this.currentStep.wpts[this.waypoints.length - 1]?.time || 0,
            ess: this.currentStep.wpts[this.waypoints.length - 2]?.time || 0,
            togoal: Math.round(togoal),
            wpts: this.currentStep.wpts,
        };
    }

    results() {
        if (!this.process({})) {
            return {
                goal: 0,
                ess: 0,
                togoal: this.distances.reduce((acc, cur) => acc + cur, 0),
                wpts: [],
            };
        }
        return this.calculateScore();
    }

    private moveToNext(point: TrackPoint) {
        this.currentStep.wpts.push(point);
        this.currentStep.next++;
        if (!this.waypoints[this.currentStep.next]) {
            return false;
        }
        this.currentStep.inside = this.isInside(point, this.waypoints[this.currentStep.next]);
        return true;
    }

    // TODO: This will not work well when pilot lands inside an exit-waypoint
    private distanceLeft(point: Omit<TrackPoint, "time">) {
        // use the next optimal waypoint for distance calculation
        let waypoint = this.optimalWpts[this.currentStep.next];
        let distance = 0;
        while (waypoint != null) {
            distance += this.distance(point, waypoint);
            point = waypoint;
            waypoint = this.optimalWpts[this.currentStep.next++];
        }
        return distance;
    }

    private distance(trackPoint: Omit<TrackPoint, "time"> | TrackPoint, wayPoint: Omit<WayPoint, "rad"> | WayPoint) {
        return turf.distance([trackPoint.lon, trackPoint.lat], [wayPoint.lon, wayPoint.lat], { units: "meters" });
    }

    private isInside(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return this.distance(trackPoint, wayPoint) <= wayPoint.rad * (1 + this.tolerance);
    }

    private isOutside(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return this.distance(trackPoint, wayPoint) > wayPoint.rad * (1 + this.tolerance);
    }
}
