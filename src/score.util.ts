import { TaskScore, TaskScorer, TrackPoint } from "./score";
import processTask from "./task";
import { Task } from "./types";

export const scoreTask = (task: Task, locs: TrackPoint[]): TaskScore => {
    const processed = processTask(task.waypoints);

    const wpts = task.waypoints.map((tp) => ({
        lat: tp.latLng.lat,
        lon: tp.latLng.lon,
        rad: tp.radius,
    }))
    const distances = processed.distances;
    const locations = locs.map((loc) => ({
        lat: loc.lat,
        lon: loc.lon,
        time: loc.time < 1600000000000 ? loc.time * 1000 : loc.time,
    }))
    const scorer = new TaskScorer(wpts, distances, locations);
    return scorer.results();
};
