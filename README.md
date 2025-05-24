# xc-task

A set of small utility functions for hang gliding and paragliding scoring, used by the Volandoo platform.

This library provides tools to process flight tracks, evaluate waypoints, and calculate scores for XC (cross-country) tasks, such as those used in competitions.

## Features
- Detects when a pilot enters and exits turnpoint cylinders (waypoints)
- Calculates distances left to goal
- Records times for reaching each waypoint
- Designed for use with GPS track logs (IGC, etc.)

## Installation

```
npm install xc-task
```

## Basic Usage

```typescript
import { scoreTask, Task, TrackPoint } from 'xc-task';

// Define waypoints (lat, lon, radius in meters)
const waypoints = [
  { latLng: { lat: 45.0, lon: 7.0 }, radius: 400, type: 'start' },
  { latLng: { lat: 45.1, lon: 7.1 }, radius: 400, type: 'turn' },
  { latLng: { lat: 45.2, lon: 7.2 }, radius: 400, type: 'goal' },
];

// Create a Task object
const task: Task = {
  waypoints,
  startTime: 0, // optional, can be 0 if not used
  goalType: 'cylinder', // or 'line' for goal line
};

// Track points (from a GPS log)
const track: TrackPoint[] = [
  { lat: 45.0, lon: 7.0, time: 1000 },
  { lat: 45.05, lon: 7.05, time: 1100 },
  { lat: 45.1, lon: 7.1, time: 1200 },
  { lat: 45.2, lon: 7.2, time: 1300 },
];

const result = scoreTask(task, track);

console.log(result);
// {
//   goal: <time when goal reached>,
//   ess: <time when last turnpoint reached>,
//   togoal: <distance left to goal>,
//   wpts: [ ...track points at each waypoint... ]
// }
```

## Notes
- All coordinates are in WGS84 (latitude, longitude in decimal degrees).
- Radii and distances are in meters.
- The library is intended for use in Node.js or TypeScript projects.

## License
LGPL-2.1-or-later
