## Gap Scoring

Server-side GAP scoring tool built with Next.js and Flowbite React.

The app accepts a single `.zip` upload containing:
- exactly one `.xctsk` task file
- one or more `.igc` track files

All scoring happens on the backend in `/api/score`. The UI only uploads the archive, lets the user adjust GAP parameters, and renders results.

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
