import type { ScoreResult } from "xc-task";

/** Aircraft class — affects leading coefficient curve shape */
export type AircraftClass = "PG" | "HG";

/** GAP formula variant */
export type GapVariant = "gap" | "pwc" | "ozgap" | "ggap";

/** Which leading coefficient formula to use */
export type LCType = "classic" | "modern";

/** Formula configuration — all the knobs that control GAP scoring */
export type FormulaConfig = {
    class: GapVariant;
    version: number;
    aircraftClass: AircraftClass;

    // Nominal parameters
    nominalLaunch: number;   // e.g. 0.96
    nominalDistance: number;  // meters, e.g. 30000
    nominalTime: number;     // seconds, e.g. 5400 (1.5h)
    nominalGoal: number;     // percentage, e.g. 20

    // Minimum distance (meters) — pilots below this get this distance
    minDist: number;         // e.g. 5000

    // Leading-Time-Ratio: portion of non-distance points allocated to leading (0..0.26)
    // Default: PG 26%, HG 17.5%
    leadingTimeRatio: number;

    // Distance weight formula: "pre2014" or "post2014"
    weightDist: "pre2014" | "post2014";

    // Distance scoring: linear fraction (0-1), rest is difficulty-based
    linearDist: number;      // e.g. 0.5

    // Difficulty calculation: "lo" (landed-out only) or "all"
    diffCalc: "lo" | "all";

    // Difficulty lookahead distance in 100m units
    diffDist: number;        // e.g. 5 (= 500m)
    diffRamp: "fixed" | "flexible";

    // Speed calc variant
    speedCalc: "normal" | "extended";

    // Arrival scoring: "place" | "timed" | "off"
    arrival: "place" | "timed" | "off";

    // Departure/leading scoring: "leadout" | "off"
    departure: "leadout" | "off";
};

/** A snapshot of (time, remaining distance to ESS) for leading coefficient */
export type LCSnapshot = {
    time: number;        // unix timestamp (seconds)
    distance: number;    // along-task distance flown (meters)
    toESS: number;       // remaining distance to ESS (meters)
};

/** Per-pilot result after track verification + LC computation */
export type PilotResult = {
    name: string;
    score: ScoreResult;
    leadingCoeff: number;    // normalized LC
    lcSnapshots: LCSnapshot[]; // raw distance-time series (for debugging)
};

/** Aggregated task statistics computed from all pilots */
export type TaskTotals = {
    pilots: number;
    launched: number;
    goal: number;
    ess: number;
    maxDist: number;
    totalDist: number;
    fastest: number;        // seconds (best SS-ESS time)
    firstArrival: number;   // timestamp
    lastArrival: number;    // timestamp
    minCoeff: number;
    median: number;
    avgDist: number;
    stdDev: number;
    distSpread: { distance: number; count: number }[];
};

/** Day quality factors */
export type DayQuality = {
    launch: number;
    distance: number;
    time: number;
    stopped: number;
    overall: number;
};

/** Points available in each category */
export type PointsAvailable = {
    distance: number;
    speed: number;
    leading: number;
    arrival: number;
};

/** Final scored result for a pilot */
export type PilotScore = {
    name: string;
    distance: number;       // meters flown
    distancePoints: number;
    speedPoints: number;
    leadingPoints: number;
    arrivalPoints: number;
    penalty: number;
    total: number;
    esTime: number;         // ESS timestamp
    ssTime: number;         // SS timestamp
    time: number;           // SS-ESS seconds
    place: number;
    goalMade: boolean;
};

/** Full GAP task result */
export type GapResult = {
    formula: FormulaConfig;
    quality: DayQuality;
    available: PointsAvailable;
    totals: TaskTotals;
    scores: PilotScore[];
};

/** Default GAP formula for PG competitions */
export const DEFAULT_PG_FORMULA: FormulaConfig = {
    class: "gap",
    version: 2025,
    aircraftClass: "PG",
    nominalLaunch: 0.96,   // GAP 2025: fixed at 96%
    nominalDistance: 30000,
    nominalTime: 5400,
    nominalGoal: 30,       // GAP 2025: fixed at 30%
    minDist: 5000,
    leadingTimeRatio: 0.26, // GAP 2025 PG default: 26%
    weightDist: "post2014",
    linearDist: 0.5,
    diffCalc: "lo",
    diffDist: 5,
    diffRamp: "flexible",
    speedCalc: "normal",
    arrival: "off",         // GAP 2025 PG: no arrival points
    departure: "leadout",
};

/** Default GAP formula for HG competitions */
export const DEFAULT_HG_FORMULA: FormulaConfig = {
    class: "gap",
    version: 2025,
    aircraftClass: "HG",
    nominalLaunch: 0.96,
    nominalDistance: 30000,
    nominalTime: 5400,
    nominalGoal: 30,
    minDist: 5000,
    leadingTimeRatio: 0.175, // GAP 2025 HG default: 17.5%
    weightDist: "post2014",
    linearDist: 0.5,
    diffCalc: "lo",
    diffDist: 5,
    diffRamp: "flexible",
    speedCalc: "normal",
    arrival: "place",        // GAP 2025 HG: place-based arrival points
    departure: "leadout",
};
