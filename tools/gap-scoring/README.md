## Gap Scoring

Server-side GAP scoring tool built with Next.js and Flowbite React.

The app accepts a single `.zip` upload containing:
- exactly one `.xctsk` task file
- one or more `.igc` track files

All scoring happens on the backend in `/api/score`. The UI only uploads the archive, lets the user adjust GAP parameters, and renders results.

## Public JSON API

The app also exposes a public JSON scoring endpoint at `/api/public-score`.

Authentication:
- Set `GAP_SCORING_PUBLIC_API_KEY` in the server environment.
- Send the same value in the `x-api-key` request header.

Request body:

```json
{
  "task": {
    "turnpoints": [
      {
        "waypoint": {
          "name": "TO",
          "description": "Takeoff",
          "lat": 41.123,
          "lon": 2.123,
          "altSmoothed": 1000
        },
        "radius": 400,
        "type": "takeoff"
      }
    ],
    "sss": {
      "type": "ENTER",
      "direction": "EXIT",
      "timeGates": ["13:00"]
    },
    "goal": {
      "type": "CYLINDER"
    }
  },
  "tracks": [
    {
      "pilot_name": "Pedro Enrique",
      "pilot_id": "12345",
      "points": [
        { "lat": 41.1, "lon": 2.1, "alt": 950, "time": 1713528000 }
      ]
    }
  ],
  "modality": "PG",
  "pilotsPresent": 10,
  "formulaOverrides": {
    "nominalDistance": 30000
  }
}
```

Notes:
- `task` must be raw `XCTask` JSON.
- Each track point must include `time` as Unix seconds.
- The response is an array of objects keyed by `pilot_id`.

## Local Development

Install dependencies in the root package and the app if needed, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Formula Settings

The `Advanced` button opens a modal with editable GAP parameters. Settings are:
- applied to the backend scorer on submit
- stored in `localStorage`
- saved separately for `PG` and `HG`

Defaults come from the ported GAP logic in `lib/scoring/types.ts`.

## Debug Logging

Archive-entry logging in `/api/score` is disabled by default. Enable it with:

```bash
DEBUG=1 npm run dev
```

## Build

```bash
npm run build
```

## Notes

- The app depends on the local `xc-task` package via `file:../..`.
- Common macOS zip noise such as `__MACOSX`, `._*`, and `.DS_Store` is ignored during archive parsing.
