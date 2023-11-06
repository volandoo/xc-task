import * as turf from "@turf/turf";
import { Geodesic, GeodesicLine } from "geographiclib-geodesic";
import proj4 from "proj4";
import { LatLng, Waypoint } from "./types";

type ShortPoint = {
  x: number;
  y: number;
};

type Point = ShortPoint & {
  radius: number;
  fx: number;
  fy: number;
};

const INT_MAX = Number.MAX_SAFE_INTEGER;

const geod = Geodesic.WGS84;

const checkStartDirection = (turnpoints: Waypoint[]) => {
  let startIndex = -1;
  for (let i = 0; i < turnpoints.length; i++) {
    if (turnpoints[i].type == "start") {
      startIndex = i;
      break;
    }
  }
  if (startIndex == -1 || startIndex == turnpoints.length - 1) {
    return;
  }
  const distance = computeDistanceBetweenLatLng(
    turnpoints[startIndex].latLng,
    turnpoints[startIndex + 1].latLng
  );
  if (distance > turnpoints[startIndex].radius) {
    // @ts-ignore
    turnpoints[startIndex].mode = "exit";
  } else {
    // @ts-ignore
    turnpoints[startIndex].mode = "entry";
  }
};

const recalcDistance = (waypoints: LatLng[]) => {
  const distances: number[] = [];
  if (waypoints.length > 1) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const distance = computeDistanceBetweenLatLng(
        waypoints[i],
        waypoints[i + 1]
      );
      distances.push(Math.round(distance));
    }
  }
  return distances;
};

const createPoint = (x: number, y: number, radius: number = 0): Point => {
  return { x: x, y: y, radius: radius, fx: x, fy: y };
};
const createPointFromCenter = (point: Point) => {
  return createPoint(point.x, point.y, point.radius);
};
const createPointFromFix = (point: Point) => {
  return createPoint(point.fx, point.fy, point.radius);
};

// Inputs:
// points - array of point objects
// esIndex - index of the ESS point, or -1
// line - goal line endpoints, or empty array
const getShortestPath = (
  points: Point[],
  esIndex: number,
  line: ShortPoint[]
) => {
  const tolerance = 1.0;
  let lastDistance = INT_MAX;
  let finished = false;
  const count = points.length;
  // opsCount is the number of operations allowed
  let opsCount = count * 10;
  while (!finished && opsCount-- > 0) {
    const distance = optimizePath(points, count, esIndex, line);
    // See if the difference between the last distance id
    // smaller than the tolerance
    finished = lastDistance - distance < tolerance;
    lastDistance = distance;
  }
  return lastDistance;
};

// Inputs:
// points - array of point objects
// count - number of points
// esIndex - index of the ESS point, or -1
// line - goal line endpoints, or empty array
const optimizePath = (
  points: Point[],
  count: number,
  esIndex: number,
  line: ShortPoint[]
) => {
  let distance = 0;
  const hasLine = line.length == 2;
  for (let index = 1; index < count; index++) {
    // Get the target cylinder c and its preceding and succeeding points
    const ret = getTargetPoints(points, count, index, esIndex);
    const c = ret[0];
    const a = ret[1];
    const b = ret[2];
    if (index == count - 1 && hasLine) {
      processLine(line, c, a);
    } else {
      processCylinder(c, a, b);
    }
    // Calculate the distance from A to the C fix point
    const legDistance = Math.hypot(a.x - c.fx, a.y - c.fy);
    distance += legDistance;
  }
  return distance;
};

// Inputs:
// points - array of point objects
// count - number of points
// index - index of the target cylinder (from 1 upwards)
// esIndex - index of the ESS point, or -1
const getTargetPoints = (
  points: Point[],
  count: number,
  index: number,
  esIndex: number
) => {
  // Set point C to the target cylinder
  const c = points[index];
  // Create point A using the fix from the previous point
  const a = createPointFromFix(points[index - 1]);
  // Create point B using the fix from the next point
  // (use point C center for the lastPoint and esIndex).
  let b: Point;
  if (index == count - 1 || index == esIndex) {
    b = createPointFromCenter(c);
  } else {
    b = createPointFromFix(points[index + 1]);
  }
  return [c, a, b];
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
const processCylinder = (c: Point, a: Point, b: Point) => {
  let distAC: number;
  let distBC: number;
  let distAB: number;
  let distCtoAB: number;
  const ret = getRelativeDistances(c, a, b);
  distAC = ret[0];
  distBC = ret[1];
  distAB = ret[2];
  distCtoAB = ret[3];
  if (distAB == 0.0) {
    // A and B are the same point: project the point on the circle
    projectOnCircle(c, a.x, a.y, distAC);
  } else if (pointOnCircle(c, a, b, distAC, distBC, distAB, distCtoAB)) {
    // A or B are on the circle: the fix has been calculated
    return;
  } else if (distCtoAB < c.radius) {
    // AB segment intersects the circle, but is not tangent to it
    if (distAC < c.radius && distBC < c.radius) {
      // A and B are inside the circle
      setReflection(c, a, b);
    } else if (
      (distAC < c.radius && distBC > c.radius) ||
      (distAC > c.radius && distBC < c.radius)
    ) {
      // One point inside, one point outside the circle
      setIntersection1(c, a, b, distAB);
    } else if (distAC > c.radius && distBC > c.radius) {
      // A and B are outside the circle
      setIntersection2(c, a, b, distAB);
    }
  } else {
    // A and B are outside the circle and the AB segment is
    // either tangent to it or or does not intersect it
    setReflection(c, a, b);
  }
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
const getRelativeDistances = (c: Point, a: Point, b: Point) => {
  // Calculate distances AC, BC and AB
  const distAC = Math.hypot(a.x - c.x, a.y - c.y);
  const distBC = Math.hypot(b.x - c.x, b.y - c.y);
  const len2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const distAB = Math.sqrt(len2);

  let distCtoAB: number;
  // Find the shortest distance from C to the AB line segment
  if (len2 == 0.0) {
    // A and B are the same point
    distCtoAB = distAC;
  } else {
    const t = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / len2;
    if (t < 0.0) {
      // Beyond the A end of the AB segment
      distCtoAB = distAC;
    } else if (t > 1.0) {
      // Beyond the B end of the AB segment
      distCtoAB = distBC;
    } else {
      // On the AB segment
      const cpx = t * (b.x - a.x) + a.x;
      const cpy = t * (b.y - a.y) + a.y;
      distCtoAB = Math.hypot(cpx - c.x, cpy - c.y);
    }
  }
  return [distAC, distBC, distAB, distCtoAB];
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
const getIntersectionPoints = (
  c: Point,
  a: Point,
  b: Point,
  distAB: number
) => {
  // Find e, which is on the AB line perpendicular to c center
  const dx = (b.x - a.x) / distAB;
  const dy = (b.y - a.y) / distAB;
  const t2 = dx * (c.x - a.x) + dy * (c.y - a.y);
  const ex = t2 * dx + a.x;
  const ey = t2 * dy + a.y;
  // Calculate the intersection points, s1 and s2
  const dt2 = c.radius ** 2 - (ex - c.x) ** 2 - (ey - c.y) ** 2;
  const dt = dt2 > 0 ? Math.sqrt(dt2) : 0;
  const s1x = (t2 - dt) * dx + a.x;
  const s1y = (t2 - dt) * dy + a.y;
  const s2x = (t2 + dt) * dx + a.x;
  const s2y = (t2 + dt) * dy + a.y;
  return [createPoint(s1x, s1y), createPoint(s2x, s2y), createPoint(ex, ey)];
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
// Distances between the points
const pointOnCircle = (
  c: Point,
  a: Point,
  b: Point,
  distAC: number,
  distBC: number,
  distAB: number,
  distCtoAB: number
) => {
  if (Math.abs(distAC - c.radius) < 0.0001) {
    // A on the circle (perhaps B as well): use A position
    c.fx = a.x;
    c.fy = a.y;
    return true;
  }
  if (Math.abs(distBC - c.radius) < 0.0001) {
    // B on the circle
    if (distCtoAB < c.radius && distAC > c.radius) {
      // AB segment intersects the circle and A is outside it
      setIntersection2(c, a, b, distAB);
    } else {
      // Use B position
      c.fx = b.x;
      c.fy = b.y;
    }
    return true;
  }
  return false;
};

// Inputs:
// c - the circle
// x, y - coordinates of the point to project
// len - line segment length, from c to the point
const projectOnCircle = (c: Point, x: number, y: number, len: number) => {
  if (len == 0.0) {
    // The default direction is eastwards (90 degrees)
    c.fx = c.radius + c.x;
    c.fy = c.y;
  } else {
    c.fx = (c.radius * (x - c.x)) / len + c.x;
    c.fy = (c.radius * (y - c.y)) / len + c.y;
  }
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
const setIntersection1 = (c: Point, a: Point, b: Point, distAB: number) => {
  // Get the intersection points (s1, s2)
  const ret = getIntersectionPoints(c, a, b, distAB);
  const s1 = ret[0];
  const s2 = ret[1];
  const as1 = Math.hypot(a.x - s1.x, a.y - s1.y);
  const bs1 = Math.hypot(b.x - s1.x, b.y - s1.y);
  // Find the intersection lying between points a and b
  if (Math.abs(as1 + bs1 - distAB) < 0.0001) {
    c.fx = s1.x;
    c.fy = s1.y;
  } else {
    c.fx = s2.x;
    c.fy = s2.y;
  }
};

// Inputs:
// c, a, b - target cylinder, previous point, next point
// distAB - AB line segment length
const setIntersection2 = (c: Point, a: Point, b: Point, distAB: number) => {
  // Get the intersection points (s1, s2) and midpoint (e)
  const ret = getIntersectionPoints(c, a, b, distAB);
  const s1 = ret[0];
  const s2 = ret[1];
  const e = ret[2];
  const as1 = Math.hypot(a.x - s1.x, a.y - s1.y);
  const es1 = Math.hypot(e.x - s1.x, e.y - s1.y);
  const ae = Math.hypot(a.x - e.x, a.y - e.y);
  // Find the intersection between points a and e
  if (Math.abs(as1 + es1 - ae) < 0.0001) {
    c.fx = s1.x;
    c.fy = s1.y;
  } else {
    c.fx = s2.x;
    c.fy = s2.y;
  }
};

// Inputs:
// c, a, b - target circle, previous point, next point
const setReflection = (c: Point, a: Point, b: Point) => {
  // The lengths of the adjacent triangle sides (af, bf) are
  // proportional to the lengths of the cut AB segments (ak, bk)
  const af = Math.hypot(a.x - c.fx, a.y - c.fy);
  const bf = Math.hypot(b.x - c.fx, b.y - c.fy);
  const t = af / (af + bf);
  // Calculate point k on the AB segment
  const kx = t * (b.x - a.x) + a.x;
  const ky = t * (b.y - a.y) + a.y;
  const kc = Math.hypot(kx - c.x, ky - c.y);
  // Project k on to the radius of c
  projectOnCircle(c, kx, ky, kc);
};

// Inputs:
// line - array of goal line endpoints
// c, a - target (goal), previous point
const processLine = (line: ShortPoint[], c: Point, a: Point) => {
  const g1 = line[0];
  const g2 = line[1];
  const len2 = (g1.x - g2.x) ** 2 + (g1.y - g2.y) ** 2;
  if (len2 == 0.0) {
    // Error trapping: g1 and g2 are the same point
    c.fx = g1.x;
    c.fy = g1.y;
  } else {
    const t =
      ((a.x - g1.x) * (g2.x - g1.x) + (a.y - g1.y) * (g2.y - g1.y)) / len2;
    if (t < 0.0) {
      // Beyond the g1 end of the line segment
      c.fx = g1.x;
      c.fy = g1.y;
    } else if (t > 1.0) {
      // Beyond the g2 end of the line segment
      c.fx = g2.x;
      c.fy = g2.y;
    } else {
      // Projection falls on the line segment
      c.fx = t * (g2.x - g1.x) + g1.x;
      c.fy = t * (g2.y - g1.y) + g1.y;
    }
  }
};

const getUtmZoneFromPosition = (lon: number, lat: number) => {
  return (Math.floor((lon + 180) / 6) % 60) + 1;
};

const degrees2utm = (lon: number, lat: number, zone: number) => {
  const utm = "+proj=utm +zone=" + zone;
  const wgs84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";
  return proj4(wgs84, utm, [lon, lat]);
};

const computeHeading = (latLng1: LatLng, latLng2: LatLng) => {
  return geod.Inverse(latLng1.lat, latLng1.lon, latLng2.lat, latLng2.lon).azi1;
};

const computeOffset = (
  latLng1: LatLng,
  radius: number,
  heading: number
): LatLng => {
  let gl = new GeodesicLine.GeodesicLine(
    geod,
    latLng1.lat,
    latLng1.lon,
    heading
  );
  let p = gl.GenPosition(false, radius);
  return { lat: p.lat2, lon: p.lon2 };
};

const utm2degress = (x: number, y: number, zone: number) => {
  const utm = "+proj=utm +zone=" + zone;
  const wgs84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";
  return proj4(utm, wgs84, [x, y]);
};

const computeDistanceBetweenLatLng = (wpt1: LatLng, wpt2: LatLng) => {
  return geod.Inverse(wpt1.lat, wpt1.lon, wpt2.lat, wpt2.lon).s12;
};

const createCircle = (lat: number, lon: number, rad: number) => {
  const center = [lat, lon];
  const options = { steps: 64, units: "meters" as turf.Units };
  return turf.circle(center, rad, options).geometry;
};

const createCylinders = (waypoints: Waypoint[]): turf.Feature[] => {
  return waypoints.map((waypoint, index) => {
    const color =
      waypoint.type === "takeoff"
        ? "#204d74"
        : waypoint.type === "start"
        ? "#ac2925"
        : waypoint.type === "ess"
        ? "#ac2925"
        : waypoint.type === "goal"
        ? "#398439"
        : "#269abc";
    return {
      type: "Feature",
      properties: {
        type: "circle",
        name: `Waypoint ${index}`,
        stroke: color,
        fill: color,
        "fill-opacity": 0.35,
        "stroke-opacity": 0.8,
        "stroke-width": 1,
      },
      geometry: createCircle(
        waypoint.latLng.lon,
        waypoint.latLng.lat,
        waypoint.radius
      ),
    };
  });
};

const createLine = (waypoints: LatLng[]): turf.Feature => {
  return {
    type: "Feature",
    properties: {
      type: "line",
      name: "Line Feature 1",
      stroke: "#204d74",
      "stroke-width": 1,
    },
    geometry: {
      type: "LineString",
      coordinates: waypoints.map((t) => [t.lon, t.lat]),
    },
  };
};

type Result = {
  geojson: turf.FeatureCollection;
  distance: number;
  distances: number[];
  waypoints: LatLng[];
};
const optimizeTask = (turnpoints: Waypoint[]): Result => {
  const waypoints: LatLng[] = [];

  checkStartDirection(turnpoints);

  let zone = 33; // just default if not valid turnpoits yet
  if (turnpoints.length > 0) {
    zone = getUtmZoneFromPosition(
      turnpoints[0].latLng.lon,
      turnpoints[0].latLng.lat
    );
  }

  let es = turnpoints.length - 1;
  let ss = 1;
  let g = turnpoints.length - 1;
  for (let i = 0; i < turnpoints.length; i++) {
    if (turnpoints[i].type == "ess") {
      es = i;
    }
    if (turnpoints[i].type == "start") {
      ss = i;
    }
    if (turnpoints[i].type == "goal") {
      g = i;
    }
  }

  const points: Point[] = [];
  for (let i = 0; i < turnpoints.length; i++) {
    const p = degrees2utm(
      turnpoints[i].latLng.lon,
      turnpoints[i].latLng.lat,
      zone
    );
    points.push(createPoint(p[0], p[1], turnpoints[i].radius));
  }

  const goalLine: ShortPoint[] = [];
  if (
    g > 0 &&
    turnpoints[g].type == "goal" /* && turnpoints[g].goalType == "line" */
  ) {
    let i = g - 1;
    let pastTurnpoint = turnpoints[g - 1];
    while (i > 0 && pastTurnpoint.latLng == turnpoints[g].latLng) {
      i--;
      pastTurnpoint = turnpoints[i];
    }

    let lastLegHeading = computeHeading(
      pastTurnpoint.latLng,
      turnpoints[g].latLng
    );
    if (lastLegHeading < 0) lastLegHeading += 360;
    // Add 90° to this heading to have a perpendicular.
    let heading = lastLegHeading + 90;
    // Getting a first point 50m further.
    const firstPoint = computeOffset(
      turnpoints[g].latLng,
      turnpoints[g].radius,
      heading
    );

    // Reversing the heading.
    heading += 180;
    // And now completing the line with a point 100m further.
    const secondPoint = computeOffset(
      firstPoint,
      2 * turnpoints[g].radius,
      heading
    );

    const p1 = degrees2utm(firstPoint.lon, firstPoint.lat, zone);
    const p2 = degrees2utm(secondPoint.lon, secondPoint.lat, zone);

    goalLine.push({ x: p1[0], y: p1[1] });
    goalLine.push({ x: p2[0], y: p2[1] });
  }

  const distance = getShortestPath(points, es, goalLine);

  for (let i = 0; i < turnpoints.length; i++) {
    const fl = utm2degress(points[i].fx, points[i].fy, zone);
    waypoints.push({ lat: fl[1], lon: fl[0] });
  }

  const distances = recalcDistance(waypoints);

  return {
    geojson: {
      type: "FeatureCollection",
      features: [createLine(waypoints), ...createCylinders(turnpoints)],
    },
    distance,
    distances,
    waypoints,
  };
};

export default optimizeTask;
