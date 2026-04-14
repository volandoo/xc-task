import type { ScoreResult, Task, TrackPoint } from "xc-task";
import type { AircraftClass, FormulaConfig, LCSnapshot, LCType } from "./types";
import { getTracksStats, processTask } from "xc-task";

function getSSSIndex(task: Task): number {
    for (let i = 0; i < task.waypoints.length; i++) {
        if (task.waypoints[i].type === "sss") {
            return i;
        }
    }
    return 1;
}

function getESSIndex(task: Task): number {
    for (let i = 0; i < task.waypoints.length; i++) {
        if (task.waypoints[i].type === "ess") {
            return i;
        }
    }
    return task.waypoints.length - 1;
}

/**
 * Determines which LC formula to use based on formula config.
 */
export function selectLCType(formula: FormulaConfig): LCType {
    if (
        (formula.class === "pwc" || formula.class === "gap" ||
            formula.class === "ozgap" || formula.class === "ggap") &&
        formula.version > 2022
    ) {
        return "modern";
    }
    return "classic";
}

/**
 * Computes the ESS distance (start-of-speed-section to end-of-speed-section)
 * by solving the task from SSS to ESS.
 */
export function computeESSDistance(task: Task): number {
    const sssIdx = getSSSIndex(task);
    const essIdx = getESSIndex(task);

    const ssWaypoints = task.waypoints.slice(sssIdx, essIdx + 1);
    if (ssWaypoints.length < 2) return 0;

    const result = processTask(ssWaypoints, "cylinder", false);
    return result.distance;
}

/**
 * Computes the goal leg distance (ESS to goal).
 */
export function computeGoalLegDistance(task: Task): number {
    const essIdx = getESSIndex(task);
    const goalWaypoints = task.waypoints.slice(essIdx);
    if (goalWaypoints.length < 2) return 0;

    const result = processTask(goalWaypoints, task.goalType, false);
    return result.distance;
}

/**
 * Runs track verification and collects the distance-time series needed for LC.
 * Returns the ScoreResult plus the LC snapshots.
 */
export function scoreTrackWithLC(
    track: TrackPoint[],
    task: Task,
    essDistance: number,
    goalLegDistance: number,
    progressInterval: number = 5,
): { score: ScoreResult; snapshots: LCSnapshot[] } {
    const snapshots: LCSnapshot[] = [];
    let started = false;

    const addSSSStartSnapshot = (sssCrossing: number) => {
        if (started || sssCrossing <= 0) {
            return;
        }
        snapshots.push({
            time: sssCrossing,
            distance: 0,
            toESS: essDistance,
        });
        started = true;
    };

    const score = getTracksStats(track, task, {
        interval: progressInterval,
        callback: (step) => {
            if (step.sssCrossing <= 0) {
                return;
            }
            addSSSStartSnapshot(step.sssCrossing);
            const toESS = Math.max(0, step.togoal - goalLegDistance);
            snapshots.push({
                time: step.tsSeconds,
                distance: step.distance,
                toESS,
            });
        },
    });

    // Add final point for pilots who actually started the speed section.
    if (score.sssCrossing > 0) {
        addSSSStartSnapshot(score.sssCrossing);
        const finalToESS = Math.max(0, score.togoal - goalLegDistance);
        const last = snapshots[snapshots.length - 1];
        if (!last || last.time !== score.tsSeconds || last.distance !== score.distance || last.toESS !== finalToESS) {
            snapshots.push({
                time: score.tsSeconds,
                distance: score.distance,
                toESS: finalToESS,
            });
        }
    }

    return { score, snapshots };
}

// ─── GAP 2025 Leading Weight Functions (PG) ────────────────────────────────

/**
 * weightRising(v) = (1 - 10^(9*v - 9))^5
 */
function weightRising(v: number): number {
    return Math.pow(1 - Math.pow(10, 9 * v - 9), 5);
}

/**
 * weightFalling(v) = (1 - 10^(-3*v))^2
 */
function weightFalling(v: number): number {
    return Math.pow(1 - Math.pow(10, -3 * v), 2);
}

/**
 * weight(v) = weightRising(1 - v) * weightFalling(1 - v)
 * where v is the "done" fraction (0 = at SSS, 1 = at ESS)
 */
function weightFunction(v: number): number {
    return weightRising(1 - v) * weightFalling(1 - v);
}

/**
 * Numerically integrate weight(x) from a to b using Simpson's rule.
 * The weight function has smooth curves so Simpson's gives good accuracy.
 */
function integrateWeight(a: number, b: number, steps: number = 20): number {
    if (a >= b) return 0;

    const n = steps % 2 === 0 ? steps : steps + 1; // Simpson's needs even steps
    const h = (b - a) / n;
    let sum = weightFunction(a) + weightFunction(b);

    for (let i = 1; i < n; i++) {
        const x = a + i * h;
        sum += weightFunction(x) * (i % 2 === 0 ? 2 : 4);
    }

    return (h / 3) * sum;
}

// ─── done(p): fraction of speed section completed ──────────────────────────

/**
 * done(p) = 1 - minToESS(p) / speedSectionDistance
 * Converts remaining distance to ESS into a "done" fraction (0..1)
 */
function done(minToESS: number, ssDistance: number): number {
    if (ssDistance <= 0) return 0;
    return 1 - minToESS / ssDistance;
}

// ─── Main LC computation (GAP 2025) ────────────────────────────────────────

/**
 * Computes the leading coefficient per GAP 2025 spec (Section 12.3.1).
 *
 * HG:
 *   leadingArea = Σ (minToESS(tp_{i-1})² - minToESS(tp_i)²) * taskTime(tp_i)
 *   missingArea = maxTime * minToESS(bestTrackPoint)²
 *   LC = (leadingArea + missingArea) / (1800 * speedSectionDistance²)
 *
 * PG:
 *   leadingArea = Σ minToESS(tp_i) * taskTime(tp_i) * ∫[done(tp_{i-1})..done(tp_i)] weight(x) dx
 *   missingArea = minToESS(bestTrackPoint) * maxTime * ∫[done(bestTrackPoint)..1] weight(x) dx
 *   LC = (leadingArea + missingArea) / (1800 * speedSectionDistance)
 *
 * Distances in km, times in seconds from firstTaskStartTime.
 */
export function computeLeadingCoeff(
    snapshots: LCSnapshot[],
    essDistance: number,
    taskStartTime: number,
    taskFinishTime: number,
    pilotSSTime: number,
    lcType: LCType,
    aircraftClass: AircraftClass,
): number {
    if (snapshots.length < 2 || essDistance <= 0) return 0;

    // Convert essDistance to km for LC calculation (GAP 2025 uses km)
    const ssDistKm = essDistance / 1000;

    let area = 0;
    // minToESS tracks the best (minimum) remaining distance to ESS seen so far
    // It starts at speedSectionDistance and only decreases (never "goes back")
    let minToESSPrev = ssDistKm; // minToESS(tp_0) = speedSectionDistance

    // maxTime for missingArea: will be set by caller via taskFinishTime
    const maxTime = taskFinishTime - taskStartTime;

    for (let i = 1; i < snapshots.length; i++) {
        const curr = snapshots[i];

        // minToESS: minimum of previous minToESS and current distToESS
        const distToESSKm = Math.max(0, curr.toESS / 1000);
        const minToESSCurr = Math.min(minToESSPrev, distToESSKm);

        // taskTime = min(trackpoint.time, taskDeadline) - firstTaskStartTime
        const taskTime = Math.min(curr.time, taskFinishTime) - taskStartTime;

        // Only accumulate when pilot actually advances (minToESS decreases)
        if (minToESSCurr < minToESSPrev) {
            if (lcType === "classic") {
                area += taskTime * (minToESSPrev - minToESSCurr);
            } else if (aircraftClass === "HG") {
                // HG: (minToESS(tp_{i-1})² - minToESS(tp_i)²) * taskTime(tp_i)
                area += (minToESSPrev * minToESSPrev - minToESSCurr * minToESSCurr) * taskTime;
            } else {
                // PG: minToESS(tp_i) * taskTime(tp_i) * ∫[done(tp_{i-1})..done(tp_i)] weight(x) dx
                const donePrev = done(minToESSPrev, ssDistKm);
                const doneCurr = done(minToESSCurr, ssDistKm);
                const weightIntegral = integrateWeight(donePrev, doneCurr);
                area += minToESSCurr * taskTime * weightIntegral;
            }
        }

        minToESSPrev = minToESSCurr;
    }

    // missingArea: penalty for remaining distance not covered
    const bestMinToESS = minToESSPrev; // final best remaining distance

    if (lcType === "classic") {
        area += bestMinToESS * maxTime;
    } else if (aircraftClass === "HG") {
        // missingArea = maxTime * minToESS(bestTrackPoint)²
        area += maxTime * bestMinToESS * bestMinToESS;
    } else {
        // PG: minToESS(bestTrackPoint) * maxTime * ∫[done(bestTrackPoint)..1] weight(x) dx
        const doneBest = done(bestMinToESS, ssDistKm);
        const weightIntegral = integrateWeight(doneBest, 1);
        area += bestMinToESS * maxTime * weightIntegral;
    }

    // Normalize
    if (lcType === "classic") {
        return area / 1800 / ssDistKm;
    } else if (aircraftClass === "HG") {
        // HG: LC = (leadingArea + missingArea) / (1800 * speedSectionDistance²)
        return area / (1800 * ssDistKm * ssDistKm);
    } else {
        // PG: LC = (leadingArea + missingArea) / (1800 * speedSectionDistance)
        return area / (1800 * ssDistKm);
    }
}

/**
 * Adjusts a pilot's leading coefficient when they didn't make ESS.
 * Per GAP 2025: maxTime = min(max(lastOutlandingTime, lastESStime), taskDeadline)
 * The LC is recomputed with the correct maxTime rather than adjusted post-hoc.
 * This function is kept for backwards compatibility but now just triggers a
 * full recompute with the correct maxTime.
 */
export function adjustLCForNonGoal(
    _lc: number,
    remainingToESS: number,
    essDistance: number,
    taskStartTime: number,
    taskFinishTime: number,
    lastArrivalTime: number,
    lcType: LCType,
    aircraftClass: AircraftClass,
    snapshots?: LCSnapshot[],
): number {
    if (!snapshots || snapshots.length < 2) return _lc;

    // Recompute with maxTime = lastArrivalTime (the correct end time for non-goal pilots)
    const maxTime = Math.min(
        Math.max(lastArrivalTime),
        taskFinishTime,
    );

    return computeLeadingCoeff(
        snapshots, essDistance, taskStartTime, maxTime,
        taskStartTime, // pilotSSTime doesn't affect the new formula
        lcType, aircraftClass,
    );
}
