import type { Task } from "xc-task";
import type {
    FormulaConfig, PilotResult, TaskTotals, DayQuality,
    PointsAvailable, PilotScore, GapResult,
} from "./types";
import { selectLCType, adjustLCForNonGoal } from "./leadingCoeff";

// ─── Task Totals ────────────────────────────────────────────────────────────

export function computeTaskTotals(
    pilots: PilotResult[],
    formula: FormulaConfig,
    essDistance: number,
    pilotsPresent?: number,
): TaskTotals {
    const launched = pilots.filter(p => p.score.distance > 0 || p.score.sss > 0).length;
    const goalPilots = pilots.filter(p => p.score.goal > 0);
    const essPilots = pilots.filter(p => p.score.ess > 0 && p.score.sss > 0 && p.score.ess > p.score.sss);

    const distances = pilots
        .filter(p => p.score.distance > 0)
        .map(p => Math.max(p.score.distance, formula.minDist));

    const totalDist = distances.reduce((s, d) => s + d, 0);
    const maxDist = Math.max(formula.minDist, ...distances);

    const esTimes = essPilots.map(p => p.score.ess - p.score.sss).filter(t => t > 0);
    esTimes.sort((a, b) => a - b);
    const fastest = esTimes.length > 0 ? esTimes[0] : 0;

    const esTimestamps = essPilots.map(p => p.score.ess).filter(t => t > 0);
    const firstArrival = esTimestamps.length > 0 ? Math.min(...esTimestamps) : 0;
    const lastArrival = esTimestamps.length > 0 ? Math.max(...esTimestamps) : 0;

    // Min leading coefficient (among ESS pilots if any, otherwise all)
    const coeffSource = essPilots.length > 0 ? essPilots : pilots;
    const validCoeffs = coeffSource.map(p => p.leadingCoeff).filter(c => c > 0);
    const minCoeff = validCoeffs.length > 0 ? Math.min(...validCoeffs) : 0;

    // Median distance
    const sorted = [...distances].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length === 0 ? 0 :
        sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    const avgDist = sorted.length > 0 ? totalDist / sorted.length : 0;

    // Standard deviation
    const variance = sorted.length > 0
        ? sorted.reduce((s, d) => s + (d - avgDist) ** 2, 0) / sorted.length
        : 0;
    const stdDev = Math.sqrt(variance);

    // Distance spread for difficulty calculation: landed-out pilots only, in 100m buckets.
    // Per GAP 2025 12.1.1, pilots in goal are excluded and distances below minDist
    // are counted at the minimum distance bucket.
    const spreadMap = new Map<number, number>();
    for (const d of pilots
        .filter(p => p.score.distance > 0 && p.score.goal <= 0)
        .map(p => Math.max(p.score.distance, formula.minDist))) {
        const bucket = Math.floor(d / 100);
        spreadMap.set(bucket, (spreadMap.get(bucket) || 0) + 1);
    }
    const distSpread = Array.from(spreadMap.entries())
        .map(([distance, count]) => ({ distance, count }))
        .sort((a, b) => a.distance - b.distance);

    return {
        pilots: pilotsPresent ?? pilots.length,
        launched,
        goal: goalPilots.length,
        ess: essPilots.length,
        maxDist,
        totalDist,
        fastest,
        firstArrival,
        lastArrival,
        minCoeff,
        median,
        avgDist,
        stdDev,
        distSpread,
    };
}

// ─── Day Quality ────────────────────────────────────────────────────────────

export function computeDayQuality(
    totals: TaskTotals,
    formula: FormulaConfig,
): DayQuality {
    if (totals.pilots === 0) {
        return { launch: 0, distance: 0, time: 0.1, stopped: 1, overall: 0 };
    }

    // Launch validity
    const xLaunch = totals.launched / (totals.pilots * formula.nominalLaunch);
    let launch = 0.028 * xLaunch + 2.917 * xLaunch ** 2 - 1.944 * xLaunch ** 3;
    launch = Math.max(0, Math.min(1, launch));

    // Distance validity
    let distance: number;
    const mdist = (formula.nominalGoal / 100) * (totals.maxDist - formula.nominalDistance);
    const nomDistArea = totals.launched * (
        (1 + formula.nominalGoal / 100) * (formula.nominalDistance - formula.minDist) +
        Math.max(0, mdist)
    ) / 2;

    distance = nomDistArea > 0
        ? (totals.totalDist - totals.launched * formula.minDist) / nomDistArea
        : 0;
    distance = Math.max(0, Math.min(1, distance));

    // Time validity
    let time: number;
    if (totals.ess > 0) {
        const xTime = totals.fastest / formula.nominalTime;
        if (xTime < 1) {
            time = -0.271 + 2.912 * xTime - 2.098 * xTime ** 2 + 0.457 * xTime ** 3;
        } else {
            time = 1;
        }
    } else {
        const xTime = totals.maxDist / formula.nominalDistance;
        if (xTime < 1) {
            time = -0.271 + 2.912 * xTime - 2.098 * xTime ** 2 + 0.457 * xTime ** 3;
        } else {
            time = 1;
        }
    }
    time = Math.max(0, Math.min(1, time));

    const overall = launch * distance * time;

    return { launch, distance, time, stopped: 1, overall };
}

// ─── Points Weight ──────────────────────────────────────────────────────────

export function computePointsAvailable(
    totals: TaskTotals,
    formula: FormulaConfig,
    quality: number,
): PointsAvailable {
    const goalRatio = totals.launched > 0 ? totals.goal / totals.launched : 0;

    let distWeight: number;
    if (formula.weightDist === "post2014") {
        distWeight = 0.9 - 1.665 * goalRatio + 1.713 * goalRatio ** 2 - 0.587 * goalRatio ** 3;
    } else {
        distWeight = 1 - 0.8 * Math.sqrt(goalRatio);
    }

    // GAP 2025 Section 11: Points allocation using LeadingTimeRatio
    let leadingWeight: number;
    let arrivalWeight: number;

    if (goalRatio === 0) {
        // Nobody in goal: leading gets all non-distance points, no time/arrival
        leadingWeight = 1 - distWeight;
        arrivalWeight = 0;
    } else {
        leadingWeight = (1 - distWeight) * formula.leadingTimeRatio;
        if (formula.arrival === "off") {
            arrivalWeight = 0;
        } else {
            // HG: ArrivalWeight = (1 - DistanceWeight) * 12.5%
            arrivalWeight = (1 - distWeight) * 0.125;
        }
    }

    const timeWeight = 1 - distWeight - leadingWeight - arrivalWeight;

    // Nobody at ESS: no time or arrival points
    const noESS = totals.ess === 0;

    // Round available points to 1 decimal place (matching CIVL reference implementation)
    return {
        distance: round1(1000 * quality * distWeight),
        speed: noESS ? 0 : round1(1000 * quality * timeWeight),
        leading: round1(1000 * quality * leadingWeight),
        arrival: noESS ? 0 : round1(1000 * quality * arrivalWeight),
    };
}

// ─── Distance Difficulty ────────────────────────────────────────────────────

/**
 * GAP 2025 Section 12.1.1: Difficulty calculation (HG only, not PG).
 * Returns DiffScore array indexed by 100m slots.
 */
function computeKmDifficulty(
    totals: TaskTotals,
    formula: FormulaConfig,
): number[] {
    // Distances in meters, buckets are 100m slots
    const maxBucket = Math.floor(totals.maxDist / 100);

    // Step 1: Count pilots landed in each 100m slot (only landed-out pilots)
    const pilotsLanded: number[] = new Array(maxBucket + 1).fill(0);
    for (const { distance, count } of totals.distSpread) {
        if (distance <= maxBucket) {
            pilotsLanded[distance] += count;
        }
    }

    // Step 2: Compute LookAheadDist
    const nlo = totals.launched - totals.goal;
    let lookahead = formula.diffDist * 10; // default in 100m units
    if (formula.diffRamp === "flexible" && nlo > 0) {
        lookahead = Math.max(30, Math.round((30 * totals.maxDist) / (1000 * nlo)));
    }

    // Step 3: Compute difficulty per slot (look ahead)
    const difficulty: number[] = new Array(maxBucket + 1).fill(0);
    for (let i = 0; i <= maxBucket; i++) {
        const jMax = Math.min(i + lookahead, maxBucket);
        for (let j = i; j <= jMax; j++) {
            difficulty[i] += pilotsLanded[j];
        }
    }

    // Step 4: SumOfDifficulty and RelativeDifficulty
    let sumOfDifficulty = 0;
    for (let i = 0; i <= maxBucket; i++) {
        sumOfDifficulty += difficulty[i];
    }

    // Step 5: DiffScore = cumulative sum of RelativeDifficulty
    const diffScore: number[] = new Array(maxBucket + 2).fill(0);
    if (sumOfDifficulty > 0) {
        let cumulative = 0;
        for (let i = 0; i <= maxBucket; i++) {
            cumulative += difficulty[i] / (2 * sumOfDifficulty);
            diffScore[i] = cumulative;
        }
    }
    // Slots beyond maxDist get 0.5
    diffScore[maxBucket + 1] = 0.5;

    return diffScore;
}

// ─── Per-Pilot Scoring ──────────────────────────────────────────────────────

function pilotDistancePoints(
    pil: PilotResult,
    totals: TaskTotals,
    formula: FormulaConfig,
    Adistance: number,
    diffScore?: number[],
): number {
    const dist = Math.max(pil.score.distance, formula.minDist);

    if (formula.aircraftClass === "PG") {
        // GAP 2025: PG uses simple linear distance points (no difficulty)
        return Adistance * (dist / totals.maxDist);
    }

    // HG: LinearFraction + DifficultyFraction with linear interpolation
    if (!diffScore) return Adistance * (dist / totals.maxDist);

    const linearFraction = dist / (2 * totals.maxDist);

    // Linear interpolation in difficulty score (GAP 2025 Section 12.1.1)
    // iDist10 = int(Distance * 10) — but our buckets are 100m, distances in meters
    const bucket = Math.floor(dist / 100);
    const frac = (dist / 100) - bucket;
    const d0 = bucket < diffScore.length ? diffScore[bucket] : 0.5;
    const d1 = (bucket + 1) < diffScore.length ? diffScore[bucket + 1] : 0.5;
    const difficultyFraction = d0 + (d1 - d0) * frac;

    return Adistance * (linearFraction + difficultyFraction);
}

function pilotSpeedPoints(
    pil: PilotResult,
    totals: TaskTotals,
    formula: FormulaConfig,
    Aspeed: number,
): number {
    const time = pil.score.ess > 0 && pil.score.sss > 0
        ? pil.score.ess - pil.score.sss
        : 0;

    if (time <= 0 || totals.fastest <= 0) return 0;

    let points: number;
    if (formula.speedCalc === "extended") {
        points = Aspeed * (1 - ((time - totals.fastest) / 3600 / Math.sqrt(totals.fastest / 1800)) ** (2 / 3));
    } else {
        points = Aspeed * (1 - ((time - totals.fastest) / 3600 / Math.sqrt(totals.fastest / 3600)) ** (5 / 6));
    }

    return Math.max(0, isNaN(points) ? 0 : points);
}

function pilotLeadingPoints(
    pil: PilotResult,
    totals: TaskTotals,
    Astart: number,
): number {
    if (pil.leadingCoeff <= 0 || totals.minCoeff <= 0) return 0;

    if (pil.leadingCoeff <= totals.minCoeff) {
        return Astart;
    }

    const points = Astart * (1 - ((pil.leadingCoeff - totals.minCoeff) / Math.sqrt(totals.minCoeff)) ** (2 / 3));
    return Math.max(0, isNaN(points) ? 0 : points);
}

function pilotArrivalPoints(
    pil: PilotResult,
    totals: TaskTotals,
    formula: FormulaConfig,
    Aarrival: number,
    place: number,
): number {
    const time = pil.score.ess > 0 && pil.score.sss > 0
        ? pil.score.ess - pil.score.sss
        : 0;

    if (time <= 0) return 0;

    let x: number;
    if (formula.arrival === "timed") {
        const timeAfter = pil.score.ess - totals.firstArrival;
        x = 1 - timeAfter / (90 * 60);
    } else {
        // Place-based
        if (totals.ess <= 0) return 0;
        x = 1 - (place - 1) / totals.ess;
    }

    const points = Aarrival * (0.2 + 0.037 * x + 0.13 * x ** 2 + 0.633 * x ** 3);
    return Math.max(0, isNaN(points) ? 0 : points);
}

// ─── Main Scoring Pipeline ──────────────────────────────────────────────────

export function scoreTask(
    task: Task,
    pilots: PilotResult[],
    formula: FormulaConfig,
    essDistance: number,
    taskStartTime: number,
    taskFinishTime: number,
    pilotsPresent?: number,
): GapResult {
    const lcType = selectLCType(formula);

    // GAP 2025: maxTime = min(max(lastOutlandingTime, lastESStime), taskDeadline)
    // Recompute LC for non-goal pilots with the correct maxTime
    const lastESSTime = pilots
        .filter(p => p.score.ess > 0)
        .reduce((max, p) => Math.max(max, p.score.ess), 0);
    const lastOutlandingTime = pilots
        .filter(p => p.score.ess <= 0 && p.score.sss > 0)
        .reduce((max, p) => Math.max(max, p.score.tsSeconds), 0);
    const maxTime = Math.min(
        Math.max(lastOutlandingTime, lastESSTime),
        taskFinishTime,
    );

    for (const pil of pilots) {
        const hasStarted = pil.score.sss > 0;
        const madeESS = pil.score.ess > 0 && pil.score.ess > pil.score.sss;

        if (hasStarted && !madeESS) {
            pil.leadingCoeff = adjustLCForNonGoal(
                pil.leadingCoeff,
                Math.max(0, essDistance - pil.score.distance),
                essDistance,
                taskStartTime,
                taskFinishTime,
                maxTime,
                lcType,
                formula.aircraftClass,
                pil.lcSnapshots,
            );
        }
    }

    const totals = computeTaskTotals(pilots, formula, essDistance, pilotsPresent);
    const quality = computeDayQuality(totals, formula);
    const available = computePointsAvailable(totals, formula, quality.overall);

    // Pre-compute difficulty score once (HG only)
    const diffScore = formula.aircraftClass !== "PG"
        ? computeKmDifficulty(totals, formula) : undefined;

    // Order pilots: ESS pilots by ES time, then non-ESS by distance desc
    const ordered = [...pilots].sort((a, b) => {
        const aES = a.score.ess > 0 && a.score.sss > 0 ? a.score.ess : Infinity;
        const bES = b.score.ess > 0 && b.score.sss > 0 ? b.score.ess : Infinity;
        if (aES !== bES) return aES - bES;
        return b.score.distance - a.score.distance;
    });

    // Assign places (same ES time = same place)
    let lastES = -1;
    let lastPlace = -1;
    const scores: PilotScore[] = ordered.map((pil, idx) => {
        const es = pil.score.ess > 0 ? pil.score.ess : 0;
        const place = es === lastES ? lastPlace : idx + 1;
        lastES = es;
        lastPlace = place;

        const dist = pilotDistancePoints(pil, totals, formula, available.distance, diffScore);
        const speed = pilotSpeedPoints(pil, totals, formula, available.speed);
        const leading = pilotLeadingPoints(pil, totals, available.leading);
        const arrival = pilotArrivalPoints(pil, totals, formula, available.arrival, place);
        const total = dist + speed + leading + arrival;

        const time = pil.score.ess > 0 && pil.score.sss > 0
            ? pil.score.ess - pil.score.sss : 0;

        return {
            name: pil.name,
            distance: pil.score.distance,
            distancePoints: round1(dist),
            speedPoints: round1(speed),
            leadingPoints: round1(leading),
            arrivalPoints: round1(arrival),
            penalty: 0,
            total: round1(total),
            esTime: pil.score.ess,
            ssTime: pil.score.sss,
            time,
            place,
            goalMade: pil.score.goal > 0,
        };
    });

    // Re-sort by total descending for final ranking
    scores.sort((a, b) => b.total - a.total);

    return { formula, quality, available, totals, scores };
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
