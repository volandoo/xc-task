import {
    parseXctsk,
    type TrackPoint,
    type XCTask,
} from "xc-task";
import { scoreTaskInputs } from "./scoreTaskInputs";
import { type AircraftClass, type FormulaConfig } from "./types";

export type JsonTrackPoint = {
    lat: number;
    lon: number;
    alt: number;
    time: number;
};

export type JsonTrackInput = {
    pilot_id: string;
    pilot_name: string;
    points: JsonTrackPoint[];
};

export type ScoreJsonOptions = {
    task: XCTask;
    tracks: JsonTrackInput[];
    modality?: AircraftClass;
    pilotsPresent?: number;
    formulaOverrides?: Partial<FormulaConfig>;
};

export type PublicPilotScore = {
    pilot_id: string;
    pilot_name: string;
    distance: number;
    distance_points: number;
    speed_points: number;
    leading_points: number;
    arrival_points: number;
    penalty: number;
    total: number;
    ess_time: number;
    sss_time: number;
    sss_crossing: number;
    elapsed_time: number;
    place: number;
    goal_made: boolean;
    to_goal: number;
    ts_seconds: number;
    leading_coeff: number;
};

function normalizeTrackPoints(points: JsonTrackPoint[]): TrackPoint[] {
    return points
        .slice()
        .sort((a, b) => a.time - b.time)
        .map((point) => ({
            latLng: {
                lat: point.lat,
                lon: point.lon,
            },
            time: point.time,
        }));
}

export function scoreJsonTracks({
    task: rawTask,
    tracks,
    modality = "PG",
    pilotsPresent,
    formulaOverrides,
}: ScoreJsonOptions): PublicPilotScore[] {
    const scored = scoreTaskInputs({
        rawTask,
        task: parseXctsk(rawTask),
        modality,
        pilotsPresent,
        formulaOverrides,
        pilots: tracks
        .slice()
        .sort((a, b) => a.pilot_name.localeCompare(b.pilot_name) || a.pilot_id.localeCompare(b.pilot_id))
        .map((track) => ({
            name: track.pilot_name,
            track: normalizeTrackPoints(track.points),
            meta: {
                pilot_id: track.pilot_id,
                pilot_name: track.pilot_name,
            },
        })),
    });

    return scored.rankedPilotEntries.map((entry, index) => {
        const score = scored.result.scores[index];

        return {
            pilot_id: entry.meta.pilot_id,
            pilot_name: entry.meta.pilot_name,
            distance: score.distance,
            distance_points: score.distancePoints,
            speed_points: score.speedPoints,
            leading_points: score.leadingPoints,
            arrival_points: score.arrivalPoints,
            penalty: score.penalty,
            total: score.total,
            ess_time: score.esTime,
            sss_time: score.ssTime,
            sss_crossing: entry.pilot.score.sssCrossing,
            elapsed_time: score.time,
            place: score.place,
            goal_made: score.goalMade,
            to_goal: entry.pilot.score.togoal,
            ts_seconds: entry.pilot.score.tsSeconds,
            leading_coeff: entry.pilot.leadingCoeff,
        };
    });
}
