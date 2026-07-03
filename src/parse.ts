import { Task, Waypoint } from "./types";

export type XCTask = {
    turnpoints: {
        waypoint: {
            name: string;
            description: string;
            lat: number;
            lon: number;
            altSmoothed: number;
        };
        radius: number;
        type: string;
    }[];
    sss: {
        type: string;
        direction: string;
        timeGates: string[];
    };
    goal?: {
        type: "LINE" | "CYLINDER";
    };
};

function parseStartGateTime(time: string): number {
    const normalized = time.trim().replace(/Z$/, "");
    const match = normalized.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
        throw new Error(`Invalid SSS time gate "${time}". Expected HH:MM, HH:MM:SS, HH:MMZ, or HH:MM:SSZ.`);
    }

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const seconds = Number.parseInt(match[3] ?? "0", 10);

    if (
        Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds) ||
        hours > 23 || minutes > 59 || seconds > 59
    ) {
        throw new Error(`Invalid SSS time gate "${time}".`);
    }

    return Math.floor(
        new Date().setUTCHours(hours, minutes, seconds, 0).valueOf() / 1000,
    );
}

export const parseXctsk = function (xctask: string | XCTask): Task {

    const task = typeof xctask === "string" ? JSON.parse(xctask) as XCTask : xctask;

    if (!task.sss || task.sss.timeGates.length === 0) {
        throw new Error("Task must include at least one SSS time gate.");
    }

    const waypoints = task.turnpoints.map((t, i) => {
        const goal = i === task.turnpoints.length - 1;
        const ess = i === task.turnpoints.length - 2;
        const point: Waypoint = {
            radius: t.radius || 400,
            type:
                t.type === "TAKEOFF" || i === 0
                    ? "takeoff"
                    : t.type === "SSS" || i === 1
                        ? "sss"
                        : t.type === "ESS" || ess
                            ? "ess"
                            : t.type === "GOAL" || goal
                                ? "goal"
                                : "turn",
            latLng: { lat: t.waypoint.lat, lon: t.waypoint.lon },
        };
        return point;
    });

    const startTimes = [];
    for (const time of task.sss.timeGates) {
        const timeString = time.trim();
        if (timeString) {
            startTimes.push(parseStartGateTime(timeString));
        }
    }
    return {
        waypoints,
        startTimes: startTimes.sort((a, b) => a - b),
        goalType: task.goal?.type === "LINE" ? "line" : "cylinder",
    };
};
