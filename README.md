# Anthony Gym Tracker

Mobile-first gym log — a faithful web port of Anthony's Gym Tracker artifact, backed by a Google Sheet via Apps Script.

- **Train** — next-in-rotation hero, live workout logger with set-by-set lb/reps inputs, auto-progression (hit the top of every rep range → working weight bumps by the increment next session).
- **History** — session rows with set counts and lifted volume.
- **Program** — Load Control: per-exercise working weight + increment settings.
- **Create** — build custom workouts (name, emphasis, exercises with sets/reps/weight/increment, reorder/remove); they join the rotation.

## Backend

`Code.gs` is the Apps Script web app. Deploy steps:

1. Open the Google Sheet **Anthony Gym Tracker**.
2. Extensions → Apps Script → delete the default file → paste in `Code.gs` (SHEET_ID is already set).
3. Deploy → New deployment → type **Web app**, Execute as **Me**, Who has access **Anyone** → Deploy.
4. Copy the `/exec` URL into `API_URL` at the top of `app.js`, commit, push.

Sheet tabs: `Workouts`, `Exercises`, `Sessions`, `Sets`, `Meta`.
