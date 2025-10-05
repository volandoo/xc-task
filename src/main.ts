import { parseXctsk, XCTask } from "./parse";
import { TaskScore, TaskScorer } from "./score";
import processTask from "./task";
import { LatLng, Result, Task, Waypoint } from "./types";
import fs from "fs";

export { LatLng, parseXctsk, processTask, Result, Task, TaskScore, TaskScorer, Waypoint, XCTask };

const task = fs.readFileSync(process.argv[2], "utf-8");
const result = processTask(parseXctsk(task).waypoints, "cylinder", true);
console.log(JSON.stringify(result.geojson, null, 2));


