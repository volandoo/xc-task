import IGCParser from "igc-parser";
import {
    parseXctsk,
    processTask,
    type Task,
    type TrackPoint,
    type XCTask,
} from "xc-task";
import { scoreTaskInputs, type ScoreResult } from "./scoreTaskInputs";
import {
    type AircraftClass,
    type FormulaConfig,
    type GapResult,
} from "./types";

export type ArchiveFile = {
    name: string;
    content: string;
};

export type ScoreArchiveOptions = {
    taskFile: ArchiveFile;
    igcFiles: ArchiveFile[];
    modality?: AircraftClass;
    pilotsPresent?: number;
    formulaOverrides?: Partial<FormulaConfig>;
};

export type PilotBreakdown = {
    name: string;
    score: ScoreResult;
    leadingCoeff: number;
};

export type TaskDefinitionRow = {
    index: number;
    label: string;
    name?: string;
    radiusMeters?: number;
    legDistanceKm?: number;
    cumulativeDistanceKm?: number;
    coordinates?: string;
    altitudeMeters?: number;
};

export type MetaRow = {
    param: string;
    value: string | number | boolean;
};

export type ScoreArchiveResult = {
    archive: {
        taskFileName: string;
        igcFileNames: string[];
    };
    task: {
        waypoints: number;
        startTimes: number[];
        essDistance: number;
        goalLegDistance: number;
        taskStartTime: number;
        taskFinishTime: number;
    };
    modality: AircraftClass;
    result: GapResult;
    pilots: PilotBreakdown[];
    taskDefinition?: TaskDefinitionRow[];
    taskStatistics?: MetaRow[];
    formulaSettings?: MetaRow[];
};

function toUtcMidnight(unixSeconds: number): number {
    const date = new Date(unixSeconds * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function basenameWithoutExtension(filename: string): string {
    const parts = filename.split(/[\\/]/);
    const base = parts[parts.length - 1] || filename;
    return base.replace(/\.[^.]+$/, "");
}

function parseIgcContent(
    file: ArchiveFile,
    referenceUnixSeconds: number,
): { name: string; track: TrackPoint[] } {
    const igc = IGCParser.parse(file.content, { lenient: true });
    const name = igc.pilot?.trim() || basenameWithoutExtension(file.name);

    const referenceMidnight = toUtcMidnight(referenceUnixSeconds);
    const flightDate = new Date(igc.date);
    const flightMidnight = Date.UTC(
        flightDate.getUTCFullYear(),
        flightDate.getUTCMonth(),
        flightDate.getUTCDate(),
    );
    const offsetMs = referenceMidnight - flightMidnight;

    const track: TrackPoint[] = igc.fixes
        .filter((fix) => fix.valid)
        .map((fix) => ({
            latLng: { lat: fix.latitude, lon: fix.longitude },
            time: Math.floor((fix.timestamp + offsetMs) / 1000),
        }));

    if (track.length === 0) {
        throw new Error(`IGC file "${file.name}" does not contain any valid fixes.`);
    }

    return { name, track };
}

function formatCoordinates(lat: number, lon: number): string {
    return `Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}`;
}

function waypointLabel(task: Task, index: number): string {
    const waypoint = task.waypoints[index];
    const number = index + 1;

    if (waypoint.type === "sss") {
        return `${number}SS`;
    }
    if (waypoint.type === "ess") {
        return `${number}ES`;
    }
    return String(number);
}

function buildTaskDefinition(rawTask: XCTask, task: Task): TaskDefinitionRow[] {
    const solvedTask = processTask(task.waypoints, task.goalType, false);
    let cumulativeDistance = 0;

    return rawTask.turnpoints.map((turnpoint, index) => {
        const legDistanceMeters = index === 0 ? 0 : (solvedTask.distances[index - 1] ?? 0);
        cumulativeDistance += legDistanceMeters;

        return {
            index: index + 1,
            label: waypointLabel(task, index),
            name: turnpoint.waypoint.name || turnpoint.waypoint.description || undefined,
            radiusMeters: turnpoint.radius || undefined,
            legDistanceKm: index === 0 ? 0 : Number((legDistanceMeters / 1000).toFixed(3)),
            cumulativeDistanceKm: Number((cumulativeDistance / 1000).toFixed(3)),
            coordinates: formatCoordinates(turnpoint.waypoint.lat, turnpoint.waypoint.lon),
            altitudeMeters: turnpoint.waypoint.altSmoothed || undefined,
        };
    });
}

function buildTaskStatistics(result: GapResult, task: ScoreArchiveResult["task"]): MetaRow[] {
    const goalRatio = result.totals.launched > 0 ? result.totals.goal / result.totals.launched : 0;
    const leadingWeight = result.quality.overall > 0 ? result.available.leading / (1000 * result.quality.overall) : 0;
    const arrivalWeight = result.quality.overall > 0 ? result.available.arrival / (1000 * result.quality.overall) : 0;
    const timeWeight = result.quality.overall > 0 ? result.available.speed / (1000 * result.quality.overall) : 0;
    const distanceWeight = result.quality.overall > 0 ? result.available.distance / (1000 * result.quality.overall) : 0;

    return [
        { param: "task_distance_km", value: Number((task.goalLegDistance / 1000 + task.essDistance / 1000).toFixed(3)) },
        { param: "ss_distance_km", value: Number((task.essDistance / 1000).toFixed(3)) },
        { param: "goal_leg_km", value: Number((task.goalLegDistance / 1000).toFixed(3)) },
        { param: "no_of_pilots_present", value: result.totals.pilots },
        { param: "no_of_pilots_flying", value: result.totals.launched },
        { param: "no_of_pilots_reaching_es", value: result.totals.ess },
        { param: "no_of_pilots_reaching_goal", value: result.totals.goal },
        { param: "best_dist_km", value: Number((result.totals.maxDist / 1000).toFixed(3)) },
        { param: "best_time", value: result.totals.fastest > 0 ? result.totals.fastest : "—" },
        { param: "goalratio", value: Number(goalRatio.toFixed(4)) },
        { param: "distance_weight", value: Number(distanceWeight.toFixed(4)) },
        { param: "time_weight", value: Number(timeWeight.toFixed(4)) },
        { param: "leading_weight", value: Number(leadingWeight.toFixed(4)) },
        { param: "arrival_weight", value: Number(arrivalWeight.toFixed(4)) },
        { param: "available_points_distance", value: result.available.distance },
        { param: "available_points_time", value: result.available.speed },
        { param: "available_points_leading", value: result.available.leading },
        { param: "available_points_arrival", value: result.available.arrival },
        { param: "launch_validity", value: Number(result.quality.launch.toFixed(4)) },
        { param: "distance_validity", value: Number(result.quality.distance.toFixed(4)) },
        { param: "time_validity", value: Number(result.quality.time.toFixed(4)) },
        { param: "day_quality", value: Number(result.quality.overall.toFixed(4)) },
    ];
}

function buildFormulaSettings(formula: FormulaConfig): MetaRow[] {
    return Object.entries(formula).map(([param, value]) => ({ param, value }));
}

export function scoreArchive({
    taskFile,
    igcFiles,
    modality = "PG",
    pilotsPresent,
    formulaOverrides,
}: ScoreArchiveOptions): ScoreArchiveResult {
    if (igcFiles.length === 0) {
        throw new Error("The archive must contain at least one IGC file.");
    }
    const rawTask = JSON.parse(taskFile.content) as XCTask;
    const task = parseXctsk(rawTask);

    if (task.startTimes.length === 0) {
        throw new Error(`Task file "${taskFile.name}" does not contain any SSS start gates.`);
    }

    const taskStartTime = Math.min(...task.startTimes);
    const scored = scoreTaskInputs({
        rawTask,
        task,
        modality,
        pilotsPresent,
        formulaOverrides,
        pilots: igcFiles
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((igcFile) => {
            const { name, track } = parseIgcContent(igcFile, taskStartTime);
            return {
                name,
                track,
                meta: null,
            };
        }),
    });

    return {
        archive: {
            taskFileName: taskFile.name,
            igcFileNames: igcFiles.map((file) => file.name).sort((a, b) => a.localeCompare(b)),
        },
        task: scored.taskMetadata,
        modality: scored.modality,
        result: scored.result,
        pilots: scored.pilotEntries.map((entry) => ({
            name: entry.pilot.name,
            score: entry.pilot.score,
            leadingCoeff: entry.pilot.leadingCoeff,
        })),
        taskDefinition: rawTask.turnpoints?.length ? buildTaskDefinition(rawTask, scored.task) : undefined,
        taskStatistics: buildTaskStatistics(scored.result, scored.taskMetadata),
        formulaSettings: buildFormulaSettings(scored.formula),
    };
}
