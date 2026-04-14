<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Notes

- This app is a server-side GAP scoring tool under `tools/gap-scoring`.
- The upload UI is only a frontend shell. Real scoring happens in `app/api/score/route.ts`.
- GAP logic lives in `lib/scoring/*`.
- The app imports shared task-processing primitives from the local `xc-task` package dependency.
- Keep the UI flat and utilitarian. Avoid decorative hero patterns or marketing-style styling.
- Archive debug logging must stay behind `DEBUG=1`. Do not add unconditional logging of uploaded filenames.
- Preserve support for editable GAP parameters stored in localStorage and sent to the backend as `formulaOverrides`.
