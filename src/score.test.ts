
import fs from "fs";
import path from "path";
import { getTracksStats, Task } from "./main";
import { parseXctsk } from "./parse";

const formatTime = (time: number) => {
    const date = new Date(time * 1000);
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const seconds = date.getUTCSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
};

const parseFile = (filename: string) => {
    const json = fs.readFileSync(path.join(__dirname, "fixtures", filename), "utf-8");
    const content = JSON.parse(json);
    return content.map((point: { lat: number, lon: number, time: number; }) => {
        const original = new Date(point.time > 1000000000000 ? point.time : point.time * 1000);
        const today = new Date();
        today.setUTCHours(original.getUTCHours(), original.getUTCMinutes(), original.getUTCSeconds(), 0);
        return {
            latLng: {
                lat: point.lat,
                lon: point.lon,
            },
            time: today.valueOf() / 1000,
        };
    });
};

describe("getTracksStats integration", () => {
    let taskEnterCylinderOnly: Task;
    let taskEnterAndExitCylinder: Task;

    beforeAll(() => {
        let taskPath = path.join(__dirname, "fixtures", "task_enter.xctsk");
        let taskJson = fs.readFileSync(taskPath, "utf-8");
        taskEnterCylinderOnly = parseXctsk(taskJson);

        taskPath = path.join(__dirname, "fixtures", "task_exit.xctsk");
        taskJson = fs.readFileSync(taskPath, "utf-8");
        taskEnterAndExitCylinder = parseXctsk(taskJson);
    });

    it("scores goal_enter.json track against task_enter.xctsk", () => {
        const goal = parseFile("goal_enter.json");
        const result = getTracksStats(goal, taskEnterCylinderOnly);

        expect(formatTime(result.sss)).toBe("09:00:00");
        expect(formatTime(result.ess)).toBe("16:06:12");
        expect(formatTime(result.goal)).toBe("16:08:44");
        expect(result.distance).toBe(122344);

        expect(formatTime(result.wpts[0].time)).toBe("11:36:14");
        expect(formatTime(result.wpts[1].time)).toBe("13:00:07");
        expect(formatTime(result.wpts[2].time)).toBe("13:18:13");
        expect(formatTime(result.wpts[3].time)).toBe("15:02:22");
        expect(formatTime(result.wpts[4].time)).toBe("16:06:12");
        expect(formatTime(result.wpts[5].time)).toBe("16:08:44");

        expect(result.togoal).toBe(0);
        expect(result.wpts.length).toBe(taskEnterCylinderOnly.waypoints.length);
        expect(result.wpts.length).toBe(6);
    });

    it("scores not_goal_enter.json track against task_enter.xctsk", () => {
        const not_goal = parseFile("not_goal_enter.json");
        const result = getTracksStats(not_goal, taskEnterCylinderOnly);

        expect(formatTime(result.sss)).toBe("09:00:00");
        expect(result.ess).toBe(-1);
        expect(result.goal).toBe(-1);
        expect(result.distance).toBe(50971);

        expect(formatTime(result.wpts[0].time)).toBe("12:07:57");
        expect(formatTime(result.wpts[1].time)).toBe("13:03:33");
        expect(formatTime(result.wpts[2].time)).toBe("13:25:14");

        expect(result.wpts[3]).toBeUndefined();
        expect(result.wpts[4]).toBeUndefined();
        expect(result.wpts[5]).toBeUndefined();

        expect(result.wpts.length).toBeLessThan(taskEnterCylinderOnly.waypoints.length);
        expect(result.wpts.length).toBe(3);
    });

    it("scores goal_exit.json track against task_exit.xctsk", () => {
        const goal = parseFile("goal_exit.json");
        const result = getTracksStats(goal, taskEnterAndExitCylinder);

        expect(formatTime(result.sss)).toBe("09:00:00");
        expect(formatTime(result.ess)).toBe("14:41:52");
        expect(formatTime(result.goal)).toBe("14:44:02");
        expect(result.distance).toBe(70537);

        expect(formatTime(result.wpts[0].time)).toBe("11:37:29");
        expect(formatTime(result.wpts[1].time)).toBe("12:30:11");
        expect(formatTime(result.wpts[2].time)).toBe("12:59:50");
        expect(formatTime(result.wpts[3].time)).toBe("13:25:31");
        expect(formatTime(result.wpts[4].time)).toBe("13:42:04");
        expect(formatTime(result.wpts[5].time)).toBe("14:10:21");
        expect(formatTime(result.wpts[6].time)).toBe("14:24:06");
        expect(formatTime(result.wpts[7].time)).toBe("14:41:52");
        expect(formatTime(result.wpts[8].time)).toBe("14:44:02");

        expect(result.togoal).toBe(0);
        expect(result.wpts.length).toBe(taskEnterAndExitCylinder.waypoints.length);
        expect(result.wpts.length).toBe(9);
    });

    it("test callback with interval", () => {
        const goal = parseFile("goal_exit.json");
        let i = 0;
        const scores = getTracksStats(goal, taskEnterAndExitCylinder, {
            callback: (score) => {
                i++;
            },
            interval: 60,
        });
        expect(scores.wpts.length).toBe(taskEnterAndExitCylinder.waypoints.length);
        expect(scores.wpts.length).toBe(9);
    });

    it("test callback without interval", () => {
        const goal = parseFile("goal_exit.json");
        let i = 0;
        const distances: number[] = [];
        const togoals: number[] = [];
        getTracksStats(goal, taskEnterAndExitCylinder, {
            callback: (score) => {
                distances.push(score.distance);
                togoals.push(score.togoal);
                i++;
            },
            interval: 30,
        });
        expect(i).toBe(373);
        expect(distances.length).toBe(373);
        expect(togoals.length).toBe(373);
    });
});
