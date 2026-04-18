import {
    parseXctsk,
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

const DEFAULT_TASK_WINDOW_SECONDS = 2 * 60 * 60;

export type ScoringPilotInput<TMeta> = {
    name: string;
    track: TrackPoint[];
    meta: TMeta;
};

export type ScoredPilotEntry<TMeta> = {
    meta: TMeta;
    pilot: PilotResult;
};

export type ScoredTaskMetadata = {
    waypoints: number;
    startTimes: number[];
    essDistance: number;
    goalLegDistance: number;
    taskStartTime: number;
    taskFinishTime: number;
};

export type ScoreTaskInputsOptions<TMeta> = {
    rawTask: XCTask;
    task?: Task;
    pilots: ScoringPilotInput<TMeta>[];
    modality?: AircraftClass;
    pilotsPresent?: number;
    formulaOverrides?: Partial<FormulaConfig>;
};

export type ScoreTaskInputsResult<TMeta> = {
    rawTask: XCTask;
    task: Task;
    modality: AircraftClass;
    formula: FormulaConfig;
    result: GapResult;
    taskMetadata: ScoredTaskMetadata;
    pilotEntries: ScoredPilotEntry<TMeta>[];
    rankedPilotEntries: ScoredPilotEntry<TMeta>[];
};

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

function comparePilotEntries<TMeta>(
    a: ScoredPilotEntry<TMeta>,
    b: ScoredPilotEntry<TMeta>,
): number {
    const aES = a.pilot.score.ess > 0 && a.pilot.score.sss > 0 ? a.pilot.score.ess : Number.POSITIVE_INFINITY;
    const bES = b.pilot.score.ess > 0 && b.pilot.score.sss > 0 ? b.pilot.score.ess : Number.POSITIVE_INFINITY;

    if (aES !== bES) {
        return aES - bES;
    }

    return b.pilot.score.distance - a.pilot.score.distance;
}

function createFormula(
    modality: AircraftClass,
    formulaOverrides?: Partial<FormulaConfig>,
): FormulaConfig {
    return normalizeFormulaConfig(modality, formulaOverrides);
}

export function scoreTaskInputs<TMeta>({
    rawTask,
    task: providedTask,
    pilots,
    modality = "PG",
    pilotsPresent,
    formulaOverrides,
}: ScoreTaskInputsOptions<TMeta>): ScoreTaskInputsResult<TMeta> {
    if (pilots.length === 0) {
        throw new Error("At least one track is required.");
    }

    const task = providedTask ?? parseXctsk(rawTask);
    const formula = createFormula(modality, formulaOverrides);

    if (task.startTimes.length === 0) {
        throw new Error("Task does not contain any SSS start gates.");
    }

    let taskStartTime = Math.min(...task.startTimes);
    const essDistance = computeESSDistance(task);
    const goalLegDistance = computeGoalLegDistance(task);
    const lcType = selectLCType(formula);

    const pilotEntries = pilots.map(({ name, track, meta }) => {
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
            meta,
            pilot: {
                name,
                score,
                leadingCoeff,
                lcSnapshots: snapshots,
            },
        };
    });

    const pilotResults = pilotEntries.map((entry) => entry.pilot);
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
        task,
        pilotResults,
        formula,
        essDistance,
        taskStartTime,
        taskFinishTime,
        pilotsPresent,
    );

    return {
        rawTask,
        task,
        modality,
        formula,
        result,
        taskMetadata: {
            waypoints: task.waypoints.length,
            startTimes: task.startTimes,
            essDistance,
            goalLegDistance,
            taskStartTime,
            taskFinishTime,
        },
        pilotEntries,
        rankedPilotEntries: [...pilotEntries].sort(comparePilotEntries),
    };
}

export type { ScoreResult };
