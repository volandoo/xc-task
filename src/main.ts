import { parseXctsk, XCTask } from "./parse";
import { getTracksStats, ScoreResult } from "./score";
import processTask from "./task";
import { LatLng, Result, Task, Waypoint } from "./types";
import fs from "fs";

export { LatLng, parseXctsk, processTask, Result, Task, getTracksStats, ScoreResult, Waypoint, XCTask };

// const task = fs.readFileSync(process.argv[2], "utf-8");
// const result = processTask(parseXctsk(task).waypoints, "cylinder", true);
// console.log(JSON.stringify(result.geojson, null, 2));


