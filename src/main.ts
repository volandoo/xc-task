import { parseXctsk, XCTask } from "./parse";
import { TaskScore, TaskScorer, TrackPoint } from "./score";
import processTask from "./task";
import { LatLng, Waypoint, Task, Result } from "./types";

const scoreTask = (task: Task, locs: TrackPoint[]): TaskScore => {
    const processed = processTask(task.waypoints);
    const scorer = new TaskScorer(
        task.waypoints.map((tp) => ({
            lat: tp.latLng.lat,
            lon: tp.latLng.lon,
            rad: tp.radius,
        })),
        processed.distances,
        locs
    );
    return scorer.results();
};

export {Task, Result, TaskScorer, TaskScore, XCTask, processTask, parseXctsk, LatLng, Waypoint, scoreTask };
