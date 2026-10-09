/* Anthony Gym Tracker — Apps Script backend.
   Sheet brain for the GitHub Pages front end. All actions are GET requests:
   ?action=dashboard | startWorkout | logSet | finishWorkout | updateExercise
         | createWorkout | deleteWorkout
   Tabs: Workouts, Exercises, Sessions, Sets, Meta. */

var SHEET_ID = '11WC4mY2jfFiv4Q139nX67qxI9RhgrFmkMmcSAMCzJNo';
var TZ = 'America/Phoenix';

var HEADERS = {
  Workouts: ['id', 'key', 'name', 'emphasis', 'position', 'custom'],
  Exercises: ['id', 'workout_id', 'name', 'target_sets', 'min_reps', 'max_reps',
              'current_weight', 'increment', 'position', 'last_adjustment'],
  Sessions: ['id', 'workout_id', 'started_at', 'completed_at'],
  Sets: ['session_id', 'exercise_id', 'set_number', 'weight', 'reps'],
  Meta: ['key', 'value']
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'dashboard';
  try {
    if (action === 'dashboard') return json({ ok: true, initialized: true, data: dashboard() });
    if (action === 'startWorkout') return json({ ok: true, session_id: startWorkout(num(p.workout_id)) });
    if (action === 'logSet') {
      logSet(num(p.session_id), num(p.exercise_id), num(p.set_number), numOrNull(p.weight), numOrNull(p.reps));
      return json({ ok: true });
    }
    if (action === 'finishWorkout') return json({ ok: true, adjustments: finishWorkout(num(p.session_id)) });
    if (action === 'updateExercise') {
      updateExercise(num(p.exercise_id), numOrNull(p.current_weight), num(p.increment));
      return json({ ok: true });
    }
    if (action === 'createWorkout') {
      return json({ ok: true, workout_id: createWorkout(p.name, p.emphasis, p.exercises) });
    }
    if (action === 'deleteWorkout') {
      deleteWorkout(num(p.workout_id));
      return json({ ok: true });
    }
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- sheet helpers ---------- */

function sheet(name) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.appendRow(HEADERS[name]);
    s.setFrozenRows(1);
  }
  return s;
}

function num(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

/* Rows as objects keyed by header. `where` filters. */
function readAll(name, where) {
  var vals = sheet(name).getDataRange().getValues();
  if (vals.length < 2) return [];
  var head = vals[0].map(String);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {};
    for (var j = 0; j < head.length; j++) o[head[j]] = vals[i][j];
    o._row = i + 1;
    if (!where || where(o)) out.push(o);
  }
  return out;
}

function nextId(name) {
  var rows = readAll(name);
  var mx = 0;
  rows.forEach(function (r) { var n = Number(r.id); if (n > mx) mx = n; });
  return mx + 1;
}

function appendRowObj(name, obj) {
  var head = HEADERS[name];
  sheet(name).appendRow(head.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  }));
}

function setCell(name, row, colName, value) {
  var idx = HEADERS[name].indexOf(colName) + 1;
  sheet(name).getRange(row, idx).setValue(value === null || value === undefined ? '' : value);
}

function deleteRowById(name, id) {
  var rows = readAll(name, function (r) { return Number(r.id) === Number(id); });
  var s = sheet(name);
  rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { s.deleteRow(r._row); });
}

function getMeta(key) {
  var rows = readAll('Meta', function (r) { return String(r.key) === key; });
  return rows.length ? rows[0].value : '';
}

function setMeta(key, value) {
  var rows = readAll('Meta', function (r) { return String(r.key) === key; });
  if (rows.length) setCell('Meta', rows[0]._row, 'value', value);
  else appendRowObj('Meta', { key: key, value: value });
}

function nowIso() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayShort() {
  return Utilities.formatDate(new Date(), TZ, 'MMM d');
}

/* ---------- actions ---------- */

function getWorkouts() {
  var ws = readAll('Workouts').sort(function (a, b) { return Number(a.position) - Number(b.position); });
  var exs = readAll('Exercises');
  return ws.map(function (w) {
    var wid = Number(w.id);
    var list = exs.filter(function (x) { return Number(x.workout_id) === wid; })
      .sort(function (a, b) { return Number(a.position) - Number(b.position); })
      .map(function (x) {
        return {
          id: Number(x.id), workout_id: wid, name: String(x.name),
          target_sets: Number(x.target_sets), min_reps: Number(x.min_reps), max_reps: Number(x.max_reps),
          current_weight: x.current_weight === '' ? null : Number(x.current_weight),
          increment: Number(x.increment), position: Number(x.position),
          last_adjustment: String(x.last_adjustment || '')
        };
      });
    return {
      id: wid, key: String(w.key), name: String(w.name), emphasis: String(w.emphasis || ''),
      position: Number(w.position), custom: Number(w.custom) === 1, exercises: list
    };
  });
}

function openSession() {
  var rows = readAll('Sessions', function (r) { return !r.completed_at; });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return Number(b.id) - Number(a.id); });
  return rows[0];
}

function dashboard() {
  var workouts = getWorkouts();
  var os = openSession();
  var active = null;
  if (os) {
    var sid = Number(os.id);
    var sets = readAll('Sets', function (r) { return Number(r.session_id) === sid; })
      .map(function (r) {
        return {
          exercise_id: Number(r.exercise_id), set_number: Number(r.set_number),
          weight: r.weight === '' ? null : Number(r.weight),
          reps: r.reps === '' ? null : Number(r.reps)
        };
      });
    active = { id: sid, workout_id: Number(os.workout_id), started_at: String(os.started_at), sets: sets };
  }
  var wname = {};
  workouts.forEach(function (w) { wname[w.id] = w.name; });
  var history = readAll('Sessions', function (r) { return !!r.completed_at; })
    .sort(function (a, b) { return Number(b.id) - Number(a.id); })
    .slice(0, 60)
    .map(function (s) {
      var sid = Number(s.id);
      var sets = readAll('Sets', function (r) { return Number(r.session_id) === sid; });
      var done = 0, vol = 0;
      sets.forEach(function (r) {
        var rp = Number(r.reps) || 0, wt = Number(r.weight) || 0;
        if (rp > 0) { done++; vol += wt * rp; }
      });
      return {
        id: sid, workout_name: wname[Number(s.workout_id)] || 'Workout',
        completed_at: String(s.completed_at), completed_sets: done, volume: Math.round(vol)
      };
    });
  var nxt = Number(getMeta('next_workout_id')) || (workouts.length ? workouts[0].id : 0);
  return { workouts: workouts, next_workout_id: nxt, active_session: active, history: history };
}

function startWorkout(workoutId) {
  if (!workoutId) throw new Error('workout_id required');
  // Abandon any already-open session (and its sets) — one live workout at a time.
  var os = openSession();
  if (os) {
    var oldId = Number(os.id);
    var s = sheet('Sets');
    readAll('Sets', function (r) { return Number(r.session_id) === oldId; })
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (r) { s.deleteRow(r._row); });
    deleteRowById('Sessions', oldId);
  }
  var id = nextId('Sessions');
  appendRowObj('Sessions', { id: id, workout_id: workoutId, started_at: nowIso(), completed_at: '' });
  return id;
}

function logSet(sessionId, exerciseId, setNumber, weight, reps) {
  if (!sessionId || !exerciseId || !setNumber) throw new Error('session_id, exercise_id, set_number required');
  var rows = readAll('Sets', function (r) {
    return Number(r.session_id) === sessionId && Number(r.exercise_id) === exerciseId && Number(r.set_number) === setNumber;
  });
  if (rows.length) {
    setCell('Sets', rows[0]._row, 'weight', weight);
    setCell('Sets', rows[0]._row, 'reps', reps);
  } else {
    appendRowObj('Sets', { session_id: sessionId, exercise_id: exerciseId, set_number: setNumber, weight: weight, reps: reps });
  }
}

/* Progression rule: hit the TOP of the rep range on every working set
   -> working weight goes up by the increment next session. */
function finishWorkout(sessionId) {
  var rows = readAll('Sessions', function (r) { return Number(r.id) === Number(sessionId); });
  if (!rows.length) throw new Error('session not found');
  var s = rows[0];
  var wid = Number(s.workout_id);
  var exercises = readAll('Exercises', function (x) { return Number(x.workout_id) === wid; });
  var allSets = readAll('Sets', function (r) { return Number(r.session_id) === Number(sessionId); });
  var adjustments = 0;
  exercises.forEach(function (x) {
    var xid = Number(x.id), target = Number(x.target_sets), mx = Number(x.max_reps);
    var logged = allSets.filter(function (r) {
      return Number(r.exercise_id) === xid && (Number(r.reps) || 0) > 0;
    });
    if (target > 0 && logged.length >= target &&
        logged.every(function (r) { return (Number(r.reps) || 0) >= mx; })) {
      var inc = Number(x.increment) || 0;
      var cur = x.current_weight === '' ? 0 : Number(x.current_weight);
      setCell('Exercises', x._row, 'current_weight', cur + inc);
      setCell('Exercises', x._row, 'last_adjustment', '+' + inc + ' lb · ' + todayShort());
      adjustments++;
    }
  });
  setCell('Sessions', s._row, 'completed_at', nowIso());
  // Advance the rotation.
  var workouts = getWorkouts();
  var pos = 0;
  workouts.forEach(function (w) { if (w.id === wid) pos = w.position; });
  var next = null;
  workouts.forEach(function (w) { if (w.position > pos && (!next || w.position < next.position)) next = w; });
  if (!next && workouts.length) next = workouts[0];
  if (next) setMeta('next_workout_id', next.id);
  return adjustments;
}

function updateExercise(exerciseId, currentWeight, increment) {
  var rows = readAll('Exercises', function (r) { return Number(r.id) === Number(exerciseId); });
  if (!rows.length) throw new Error('exercise not found');
  setCell('Exercises', rows[0]._row, 'current_weight', currentWeight);
  setCell('Exercises', rows[0]._row, 'increment', increment || 0);
}

function createWorkout(name, emphasis, exercisesJson) {
  name = String(name || '').trim();
  if (!name) throw new Error('workout name required');
  var list;
  try { list = JSON.parse(exercisesJson || '[]'); } catch (e) { throw new Error('bad exercises payload'); }
  if (!list.length) throw new Error('add at least one exercise');
  var workouts = readAll('Workouts');
  var maxPos = 0;
  workouts.forEach(function (w) { var p = Number(w.position); if (p > maxPos) maxPos = p; });
  var wid = nextId('Workouts');
  appendRowObj('Workouts', {
    id: wid, key: 'custom-' + wid, name: name, emphasis: String(emphasis || ''),
    position: maxPos + 1, custom: 1
  });
  var eid = nextId('Exercises');
  list.forEach(function (ex, i) {
    appendRowObj('Exercises', {
      id: eid + i, workout_id: wid, name: String(ex.name || 'Exercise').slice(0, 80),
      target_sets: Math.max(1, Math.min(12, Number(ex.target_sets) || 3)),
      min_reps: Math.max(1, Number(ex.min_reps) || 8),
      max_reps: Math.max(Number(ex.min_reps) || 8, Number(ex.max_reps) || 12),
      current_weight: numOrNull(ex.current_weight),
      increment: Number(ex.increment) || 5,
      position: i + 1, last_adjustment: ''
    });
  });
  return wid;
}

function deleteWorkout(workoutId) {
  var rows = readAll('Workouts', function (r) { return Number(r.id) === Number(workoutId); });
  if (!rows.length) throw new Error('workout not found');
  if (Number(rows[0].custom) !== 1) throw new Error('only custom workouts can be deleted');
  var s = sheet('Exercises');
  readAll('Exercises', function (x) { return Number(x.workout_id) === Number(workoutId); })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (x) { s.deleteRow(x._row); });
  var ss = sheet('Sessions');
  var sessIds = {};
  readAll('Sessions', function (r) { return Number(r.workout_id) === Number(workoutId); })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (r) { sessIds[Number(r.id)] = 1; ss.deleteRow(r._row); });
  var st = sheet('Sets');
  readAll('Sets', function (r) { return !!sessIds[Number(r.session_id)]; })
    .sort(function (a, b) { return b._row - a._row; })
    .forEach(function (r) { st.deleteRow(r._row); });
  deleteRowById('Workouts', workoutId);
  if (Number(getMeta('next_workout_id')) === Number(workoutId)) {
    var rest = getWorkouts();
    setMeta('next_workout_id', rest.length ? rest[0].id : '');
  }
}
