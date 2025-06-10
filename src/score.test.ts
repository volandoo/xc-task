// @jest-environment node
import fs from "fs";
import path from "path";
import { Task, TaskScorer } from "./main";
import { parseXctsk } from "./parse";

const formatTime = (time: number) => {
    const date = new Date(time);
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const seconds = date.getUTCSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
};

const parseFile = (filename: string) => {
    const json = fs.readFileSync(path.join(__dirname, "fixtures", filename), "utf-8");
    return JSON.parse(json);
};

describe("TaskScorer integration", () => {
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
        const result = new TaskScorer(taskEnterCylinderOnly, goal).results();

        expect(formatTime(result.ess)).toBe("16:06:12");
        expect(formatTime(result.goal)).toBe("16:08:44");

        expect(formatTime(result.wpts[0].time)).toBe("11:36:14");
        expect(formatTime(result.wpts[1].time)).toBe("11:42:55");
        expect(formatTime(result.wpts[2].time)).toBe("13:18:14");
        expect(formatTime(result.wpts[3].time)).toBe("15:02:18");
        expect(formatTime(result.wpts[4].time)).toBe("16:06:12");
        expect(formatTime(result.wpts[5].time)).toBe("16:08:44");

        expect(result.togoal).toBe(0);
        expect(result.wpts.length).toBe(taskEnterCylinderOnly.waypoints.length);
        expect(result.wpts.length).toBe(6);
    });

    it("scores not_goal_enter.json track against task_enter.xctsk", () => {
        const not_goal = parseFile("not_goal_enter.json");
        const result = new TaskScorer(taskEnterCylinderOnly, not_goal).results();

        expect(result.ess).toBe(0);
        expect(result.goal).toBe(0);

        expect(formatTime(result.wpts[0].time)).toBe("12:07:57");
        expect(formatTime(result.wpts[1].time)).toBe("12:19:56");
        expect(formatTime(result.wpts[2].time)).toBe("13:25:15");

        expect(result.wpts[3]).toBeUndefined();
        expect(result.wpts[4]).toBeUndefined();
        expect(result.wpts[5]).toBeUndefined();

        expect(result.togoal).toBe(71395);
        expect(result.wpts.length).toBeLessThan(taskEnterCylinderOnly.waypoints.length);
        expect(result.wpts.length).toBe(3);
    });

    it("scores goal_exit.json track against task_exit.xctsk", () => {
        const goal = parseFile("goal_exit.json");
        const result = new TaskScorer(taskEnterAndExitCylinder, goal).results();

        expect(formatTime(result.ess)).toBe("14:41:53");
        expect(formatTime(result.goal)).toBe("14:44:02");

        expect(formatTime(result.wpts[0].time)).toBe("11:37:29");
        expect(formatTime(result.wpts[1].time)).toBe("11:38:47");
        expect(formatTime(result.wpts[2].time)).toBe("12:59:50");
        expect(formatTime(result.wpts[3].time)).toBe("13:25:31");
        expect(formatTime(result.wpts[4].time)).toBe("13:41:52");
        expect(formatTime(result.wpts[5].time)).toBe("14:10:21");
        expect(formatTime(result.wpts[6].time)).toBe("14:24:06");
        expect(formatTime(result.wpts[7].time)).toBe("14:41:53");
        expect(formatTime(result.wpts[8].time)).toBe("14:44:02");

        expect(result.togoal).toBe(0);
        expect(result.wpts.length).toBe(taskEnterAndExitCylinder.waypoints.length);
        expect(result.wpts.length).toBe(9);
    });

    it("test callback with interval", () => {
        const goal = parseFile("goal_exit.json");
        const scorer = new TaskScorer(taskEnterAndExitCylinder, goal);
        const count = 187;
        let i = 0;
        scorer.process({
            onCalculated: (score, point) => {
                i++;
            },
            callbackInterval: 60,
        });
        expect(i).toBe(count);
    });

    it("test callback without interval", () => {
        const goal = parseFile("goal_exit.json");
        const scorer = new TaskScorer(taskEnterAndExitCylinder, goal);
        const count = 374;
        let i = 0;
        scorer.process({
            onCalculated: (score, point) => {
                i++;
            },
        });
        expect(i).toBe(count);
    });
});
