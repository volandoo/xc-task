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
    sss?: {
        type: string;
        direction: string;
        timeGates: string[];
    };
    goal?: {
        type: "LINE" | "CYLINDER";
    };
};

export const parseXctsk = function (xctask: string | XCTask): Task {

    const task = typeof xctask === "string" ? JSON.parse(xctask) as XCTask : xctask;

    const waypoints = task.turnpoints.map((t, i) => {
        const goal = i === task.turnpoints.length - 1;
        const ess = i === task.turnpoints.length - 2;
        const point: Waypoint = {
            radius: t.radius || 400,
            type:
                t.type === "TAKEOFF" || i === 0
                    ? "takeoff"
                    : t.type === "SSS" || i === 1
                        ? "start"
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
        const timeString = time.replace("Z", "");
        if (timeString) {
            const parts = time.split(":");
            startTimes.push(
                Math.floor(
                    new Date().setUTCHours(
                        parseInt(parts[0]),
                        parseInt(parts[1]),
                        parseInt(parts[2]), 0
                    ).valueOf() / 1000
                )

            );
        }
    }
    return {
        waypoints,
        startTimes,
        goalType: task.goal?.type === "LINE" ? "line" : "cylinder",
    };
};

