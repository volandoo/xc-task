import * as turf from "@turf/turf";

export type LatLng = {
    lat: number;
    lon: number;
};

export type Waypoint = {
    latLng: LatLng;
    radius: number;
    type?: "takeoff" | "start" | "sss" | "ess" | "goal" | "turn";
};

export type TrackPoint = {
    latLng: LatLng;
    time: number; // timestamp in seconds
};

export type Task = {
    waypoints: Waypoint[];
    startTimes: number[]; // timestamp utc
    goalType: "line" | "cylinder";
    useFirstSSSEntryTime?: boolean;
};

export type Result = {
    geojson: turf.FeatureCollection | null;
    distance: number;
    distances: number[];
    waypoints: LatLng[];
};
