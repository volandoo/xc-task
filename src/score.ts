import * as turf from "@turf/turf";

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
    private task: WayPoint[];
    private track: TrackPoint[];
    private currentStep: CurrentStep;
    private distances: number[];

    constructor(task: WayPoint[], distances: number[], track: TrackPoint[]) {
        this.task = task;
        this.track = track;
        this.distances = distances;
        this.currentStep = {
            next: 0,
            inside: true,
            wpts: [],
        };
    }

    private process() {
        if (this.task.length < 3) {
            return false;
        }
        // check if the first point is inside the first waypoint,
        // otherwise return false
        if (!this.isInside(this.track[0], this.task[0])) {
            return false;
        }
        // check if we're inside the next waypoint
        if (this.isInside(this.track[0], this.task[1])) {
            this.currentStep.inside = true;
        } else {
            this.currentStep.inside = false;
        }
        this.currentStep.next = 1;
        for (let i = 0; i < this.track.length; i++) {
            const point = this.track[i];
            const next = this.task[this.currentStep.next];
            if (next == null) break;
            if (this.currentStep.inside) {
                if (this.isOutside(point, next)) {
                    if (!this.moveToNext(point)) break;
                }
            } else {
                if (this.isInside(point, next)) {
                    if (!this.moveToNext(point)) break;
                }
            }
        }

        return true;
    }

    results() {
        if (!this.process()) {
            return {
                goal: 0,
                ess: 0,
                togoal: this.distances.reduce((acc, cur) => acc + cur, 0),
                wpts: [],
            };
        }
        const togoal = this.distanceLeft();
        return {
            goal: this.currentStep.wpts[this.task.length - 1]?.time || 0,
            ess: this.currentStep.wpts[this.task.length - 2]?.time || 0,
            togoal,
            wpts: this.currentStep.wpts,
        };
    }

    private moveToNext(point: TrackPoint) {
        this.currentStep.wpts.push({
            time: point.time,
            lat: point.lat,
            lon: point.lon,
        });
        this.currentStep.next++;
        if (!this.task[this.currentStep.next]) return false;
        this.currentStep.inside = this.isInside(point, this.task[this.currentStep.next]);
        return true;
    }

    private distanceLeft() {
        const point = this.track[this.track.length - 1];
        const waypoint = this.task[this.currentStep.next];
        if (!waypoint) return 0;
        const toNext = this.distance(point, waypoint) - waypoint.rad;
        const dists = this.distances.slice(this.currentStep.next);
        const distancesLeft = dists.reduce((acc, cur) => acc + cur, 0);
        return toNext + distancesLeft;
    }

    private distance(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return turf.distance([trackPoint.lon, trackPoint.lat], [wayPoint.lon, wayPoint.lat], { units: "meters" });
    }

    private isInside(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return this.distance(trackPoint, wayPoint) <= wayPoint.rad;
    }

    private isOutside(trackPoint: TrackPoint, wayPoint: WayPoint) {
        return this.distance(trackPoint, wayPoint) > wayPoint.rad;
    }
}

