import processTask from "./task";
import { travelTask, getSSSIndex, getESSIndex, CurrentStep } from "./traveler";
import { Task, TrackPoint, Waypoint } from "./types";

export type ScoreResult = {
    elapsed: number;
    ess: number;
    sss: number;
    sssCrossing: number;
    goal: number;
    speed: number;
    distance: number;
    togoal: number;
    tsSeconds: number;
    wpts: TrackPoint[];
};

/**
 * Calculates the distance from a track point to the goal through the remaining waypoints
 */
function toGoal(point: TrackPoint, task: Task, step: CurrentStep): number {
    // Create a task starting from the current point through the remaining waypoints
    const waypoints: Waypoint[] = [
        {
            latLng: point.latLng,
            radius: 1,
        },
    ];

    // Add all remaining waypoints from the current position
    for (let i = step.visitedCount; i < task.waypoints.length; i++) {
        waypoints.push(task.waypoints[i]);
    }

    // Solve the task to get the distance to goal
    const result = processTask(waypoints, task.goalType, false);
    return result.distance;
}

/**
 * Calculates statistics for a track against a task
 * Tracks the pilot's onProgress, distance covered, and timing information
 */
export function getTracksStats(track: TrackPoint[], task: Task, onProgress?: {
    callback: (step: ScoreResult) => void,
    interval: number,
}): ScoreResult {
    // Solve the full task to get the total distance
    const taskResult = processTask(task.waypoints, task.goalType, false);

    const progress: ScoreResult[] = [];
    const sssIndex = getSSSIndex(task);
    const essIndex = getESSIndex(task);

    // Travel through the task and calculate distances at intervals
    const lastStep = travelTask({
        task,
        track,
        step: undefined,
        onProgress: onProgress ? (step: CurrentStep) => {

            // Don't track distances before SSS
            if (step.trackIndex < sssIndex) {
                return;
            }

            const res = calculateScore({
                togoal: progress.length > 0 ? progress[progress.length - 1].togoal : Number.MAX_VALUE,
                track, task, step, essIndex, sssIndex, taskResult
            });
            progress.push(res);
            onProgress.callback(res);

        } : undefined,
        onProgressInterval: onProgress ? onProgress.interval : 0,
    });


    const result = calculateScore({
        togoal: progress.length > 0 ? progress[progress.length - 1].togoal : Number.MAX_VALUE,
        track, task, step: lastStep, essIndex, sssIndex, taskResult
    });
    return {
        ...result,
        distance: Math.round(result.distance),
        togoal: Math.round(result.togoal)
    };
}

const calculateScore = ({ track, task, step, essIndex, sssIndex, taskResult, togoal }: {
    togoal: number,
    track: TrackPoint[],
    task: Task,
    step: CurrentStep,
    essIndex: number,
    sssIndex: number,
    taskResult: { distance: number; },
}) => {

    const result: ScoreResult = {
        elapsed: 0,
        ess: -1,
        sss: -1,
        sssCrossing: -1,
        goal: -1,
        speed: 0,
        wpts: [],
        distance: 0,
        togoal: togoal,
        tsSeconds: track[step.trackIndex].time,
    };

    // Check if pilot reached goal
    if (step.visitedCount === task.waypoints.length) {
        // Pilot is in goal, update the last entry        
        result.ess = step.waypoints[essIndex].time;
        result.goal = track[step.trackIndex].time;
        result.distance = Math.round(taskResult.distance);
        result.togoal = 0;
    } else {
        const to = toGoal(track[step.trackIndex], task, step);
        result.ess = -1;
        result.togoal = togoal < to ? togoal : to;
        result.distance = Math.round(taskResult.distance - result.togoal);
    }

    // Calculate SSS time
    result.wpts = step.waypoints;
    if (step.waypoints.length > sssIndex) {
        result.sssCrossing = step.waypoints[sssIndex].time;
    }
    let startTime = task.startTimes[0];
    if (task.startTimes.length > 1 && step.waypoints.length > sssIndex) {
        // Find the latest gate time that the pilot passed after.
        for (const time of task.startTimes) {
            if (step.waypoints[sssIndex].time > time) {
                startTime = time;
            }
        }
        result.sss = startTime;
    } else {
        result.sss = startTime;
    }

    // Calculate elapsed time
    if (result.ess > -1 && result.sss > -1) {
        // Completed the task: time from SSS to ESS
        result.elapsed = result.ess - result.sss;
    } else if (result.sss > -1) {
        // Started but didn't finish: time from SSS to end of track
        result.elapsed = track[track.length - 1].time - result.sss;
    } else {
        result.elapsed = 0;
    }
    // Calculate speed (km/h) only if we have distance data and elapsed time
    if (result.elapsed > 0) {
        // Convert distance from meters to km, time from seconds to hours
        result.speed = result.distance / (result.elapsed / 3600);
    } else {
        result.speed = 0;
    }

    return result;
};
