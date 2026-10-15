# Anthony Gym Tracker

Mobile-first gym log — a faithful web port of Anthony's Gym Tracker artifact, backed by a Google Sheet via Apps Script.

- **Train** — next-in-rotation hero, live workout logger with set-by-set lb/reps inputs, auto-progression (hit the top of every rep range → working weight bumps by the increment next session).
- **History** — session rows with set counts and lifted volume.
- **Program** — Load Control: per-exercise working weight + increment settings.
- **Create** — build custom workouts (name, emphasis, exercises with sets/reps/weight/increment, reorder/remove); they join the rotation.

## Set structure

Every exercise runs **2 warm-up sets × 5 reps @ 60%** of the working weight (rounded down to the nearest 2.5 lb; no warm-up load shown for bodyweight moves), then **2 working sets to technical failure** capped at the top of the rep range. Warm-ups are display-only — they never move the weight. Auto-bump judges only the working sets: both hit max reps → weight goes up by the increment.

`seed-routine.json` holds the starter program: Upper A (chest/tris) → Lower Power → Upper B (back thickness/rear delts) → Lower Explosive → Upper C (shoulders/core).

## Backend

`Code.gs` is the Apps Script web app. Deploy steps:

1. Open the Google Sheet **Anthony Gym Tracker**.
2. Extensions → Apps Script → delete the default file → paste in `Code.gs` (SHEET_ID is already set).
3. Deploy → New deployment → type **Web app**, Execute as **Me**, Who has access **Anyone** → Deploy.
4. Copy the `/exec` URL into `API_URL` at the top of `app.js`, commit, push.

Sheet tabs: `Workouts`, `Exercises`, `Sessions`, `Sets`, `Meta`.
