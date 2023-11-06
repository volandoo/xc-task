export type LatLng = {
  lat: number;
  lon: number;
};

export type Waypoint = {
  latLng: LatLng;
  radius: number;
  type?: "takeoff" | "start" | "ess" | "goal" | "turn";
};

export type Task = {
  waypoints: Waypoint[];
  startTime: number; // timestamp utc
};
