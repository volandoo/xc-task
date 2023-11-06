import { Task, Waypoint } from "./types";

type XCTask = {
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
};

export var parseXctsk = function (text: string): Task {
  var task = JSON.parse(text) as XCTask;

  const waypoints = task.turnpoints.map((t, i) => {
    const goal = i === task.turnpoints.length - 1;
    const ess = i === task.turnpoints.length - 2;
    const point: Waypoint = {
      radius: t.radius,
      type:
        t.type === "TAKEOFF" || i === 0
          ? "takeoff"
          : i === 1
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

  let startTime = 0;
  const time = task.sss?.timeGates[0].replace("Z", "");
  if (time) {
    const parts = time.split(":");
    startTime = new Date()
      .setUTCHours(
        parseInt(parts[0]),
        parseInt(parts[1]),
        parseInt(parts[2]),
        0
      )
      .valueOf();
  }
  return {
    waypoints,
    startTime,
  };
};
