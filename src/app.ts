import task5 from "../fixtures/task5.json";
import createTask, { WayPoint } from "./task";

type WP = {
  type?: string;
  radius: number;
  waypoint: { lat: number; lon: number };
};
const main = () => {
  const start = Date.now();
  const turnpoints = task5.turnpoints.map((t: WP, i) => {
    const goal = i === task5.turnpoints.length - 1;
    const ess = i === task5.turnpoints.length - 2;
    const point: WayPoint = {
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

  console.log("");
  console.log("");
  console.log("");
  const processed = createTask(turnpoints);
  // console.log(processed.distance);
  // console.log(processed.distances);
  // console.log(processed.fastWaypoints);
  console.log(JSON.stringify(processed.geojson, null, 2));
  console.log(Date.now() - start);
};

main();
