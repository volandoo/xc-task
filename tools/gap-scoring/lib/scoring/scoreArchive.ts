import IGCParser from "igc-parser";
import {
    parseXctsk,
    processTask,
    type ScoreResult,
    type Task,
    type TrackPoint,
    type XCTask,
} from "xc-task";
import { scoreTask } from "./gap";
import {
    computeESSDistance,
    computeGoalLegDistance,
    computeLeadingCoeff,
    scoreTrackWithLC,
    selectLCType,
} from "./leadingCoeff";
import {
    type AircraftClass,
    type FormulaConfig,
    type GapResult,
    normalizeFormulaConfig,
    type PilotResult,
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

const DEFAULT_TASK_WINDOW_SECONDS = 2 * 60 * 60;

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

function floorToMinuteBoundary(unixSeconds: number, minuteStep: number): number {
    const step = minuteStep * 60;
    return Math.floor(unixSeconds / step) * step;
}

function inferRaceStartGates(
    declaredStartTimes: number[],
    pilots: PilotResult[],
): number[] {
    const crossings = pilots
        .map((pilot) => pilot.score.sssCrossing)
        .filter((time) => time > 0)
        .sort((a, b) => a - b);

    if (declaredStartTimes.length < 2 || crossings.length === 0) {
        return declaredStartTimes;
    }

    const firstCrossing = crossings[0];
    const filtered = declaredStartTimes
        .filter((gate) => gate <= firstCrossing + 10 * 60)
        .filter((gate) => crossings.some((crossing) => crossing >= gate && crossing - gate <= 10 * 60));

    const gates = (filtered.length > 0 ? filtered : [declaredStartTimes[declaredStartTimes.length - 1]])
        .sort((a, b) => a - b);

    while (true) {
        const lastGate = gates[gates.length - 1];
        const laterCrossings = crossings.filter((crossing) => crossing >= lastGate + 15 * 60);
        if (laterCrossings.length < 2) {
            break;
        }

        const inferredGate = floorToMinuteBoundary(laterCrossings[0], 5);
        if (inferredGate <= lastGate) {
            break;
        }
        gates.push(inferredGate);
    }

    return gates;
}

function createFormula(
    modality: AircraftClass,
    formulaOverrides?: Partial<FormulaConfig>,
): FormulaConfig {
    return normalizeFormulaConfig(modality, formulaOverrides);
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

    const formula = createFormula(modality, formulaOverrides);
    const rawTask = JSON.parse(taskFile.content) as XCTask;
    const task = parseXctsk(taskFile.content);

    if (task.startTimes.length === 0) {
        throw new Error(`Task file "${taskFile.name}" does not contain any SSS start gates.`);
    }

    let taskStartTime = Math.min(...task.startTimes);
    const essDistance = computeESSDistance(task);
    const goalLegDistance = computeGoalLegDistance(task);
    const lcType = selectLCType(formula);

    const pilotResults: PilotResult[] = igcFiles
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((igcFile) => {
            const { name, track } = parseIgcContent(igcFile, taskStartTime);
            const { score, snapshots } = scoreTrackWithLC(track, task, essDistance, goalLegDistance);

            if (score.sss > 0 && score.sss < taskStartTime) {
                score.sss = taskStartTime;
            }

            const pilotSSTime = score.sss > 0 ? score.sss : taskStartTime;
            const leadingCoeff = computeLeadingCoeff(
                snapshots,
                essDistance,
                taskStartTime,
                taskStartTime + DEFAULT_TASK_WINDOW_SECONDS,
                pilotSSTime,
                lcType,
                formula.aircraftClass,
            );

            return {
                name,
                score,
                leadingCoeff,
                lcSnapshots: snapshots,
            };
        });

    const inferredStartTimes = inferRaceStartGates(task.startTimes, pilotResults);
    const hasInferredStartGateChanges = inferredStartTimes.length !== task.startTimes.length ||
        inferredStartTimes.some((time, index) => time !== task.startTimes[index]);

    if (hasInferredStartGateChanges) {
        task.startTimes = inferredStartTimes;
        taskStartTime = Math.min(...inferredStartTimes);

        for (const pilot of pilotResults) {
            const crossing = pilot.score.sssCrossing;
            if (crossing <= 0) {
                continue;
            }

            let scoredStart = inferredStartTimes[0];
            for (const gate of inferredStartTimes) {
                if (crossing > gate) {
                    scoredStart = gate;
                }
            }

            pilot.score.sss = scoredStart;
        }
    }

    const lastESSTime = pilotResults
        .map((pilot) => pilot.score.ess)
        .filter((time) => time > 0)
        .reduce((max, time) => Math.max(max, time), 0);

    const lastOutlandingTime = pilotResults
        .filter((pilot) => pilot.score.ess <= 0 && pilot.score.sss > 0)
        .reduce((max, pilot) => Math.max(max, pilot.score.tsSeconds), 0);

    const taskFinishTime = Math.max(lastOutlandingTime, lastESSTime) || taskStartTime + DEFAULT_TASK_WINDOW_SECONDS;

    for (const pilot of pilotResults) {
        const pilotSSTime = pilot.score.sss > 0 ? pilot.score.sss : taskStartTime;
        pilot.leadingCoeff = computeLeadingCoeff(
            pilot.lcSnapshots,
            essDistance,
            taskStartTime,
            taskFinishTime,
            pilotSSTime,
            lcType,
            formula.aircraftClass,
        );
    }

    const result = scoreTask(
        task as Task,
        pilotResults,
        formula,
        essDistance,
        taskStartTime,
        taskFinishTime,
        pilotsPresent,
    );

    const taskMetadata: ScoreArchiveResult["task"] = {
        waypoints: task.waypoints.length,
        startTimes: task.startTimes,
        essDistance,
        goalLegDistance,
        taskStartTime,
        taskFinishTime,
    };

    return {
        archive: {
            taskFileName: taskFile.name,
            igcFileNames: igcFiles.map((file) => file.name).sort((a, b) => a.localeCompare(b)),
        },
        task: taskMetadata,
        modality,
        result,
        pilots: pilotResults.map((pilot) => ({
            name: pilot.name,
            score: pilot.score,
            leadingCoeff: pilot.leadingCoeff,
        })),
        taskDefinition: rawTask.turnpoints?.length ? buildTaskDefinition(rawTask, task) : undefined,
        taskStatistics: buildTaskStatistics(result, taskMetadata),
        formulaSettings: buildFormulaSettings(formula),
    };
}
