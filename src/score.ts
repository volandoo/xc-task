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

    constructor(task: Task, track: TrackPoint[]) {
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
    }

    /**
     * Processes the track points against the task waypoints to determine if and when
     * the pilot completed each turnpoint.
     *
     * The function works by:
     * 1. Checking if there are enough waypoints (minimum 3) to form a valid task.
     * 2. Finding the first point where the pilot enters the start cylinder.
     * 3. Records this entry using moveToNext().
     * 4. Iterates through the remaining track points, starting after the entry point, to detect:
     *    - When the pilot exits a cylinder (if currently inside)
     *    - When the pilot enters a cylinder (if currently outside)
     *    - Each transition is recorded using moveToNext().
     * 5. Stops processing if all waypoints are completed or the track ends.
     *
     * @returns boolean - true if task was processed successfully, false if invalid
     */
    process(params: {
        onCalculated?: (score: TaskScore, point: TrackPoint) => void;
        callbackInterval?: number;
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
            if (params.onCalculated && i % (params.callbackInterval ?? 30) === 0) {
                const curr = this.currentStep.next;
                params.onCalculated(this.calculateScore(), point);
                this.currentStep.next = curr;
            }
        }

        if (params.onCalculated) {
            params.onCalculated(this.calculateScore(), this.track[this.track.length - 1]);
        }
        // If all logic passes, return true
        return true;
    }

    calculateScore() {
        const togoal = this.distanceLeft();
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
    private distanceLeft() {
        let point = this.track[this.track.length - 1] as Omit<TrackPoint, "time">;
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
        return this.distance(trackPoint, wayPoint) <= wayPoint.rad;
    }

    private isOutside(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return this.distance(trackPoint, wayPoint) > wayPoint.rad;
    }
}
