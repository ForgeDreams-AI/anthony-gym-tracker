"use strict";
/* Anthony Gym Tracker — on-device by default (localStorage). Set API_URL to an
   Apps Script /exec URL to use a Google Sheet backend instead. */
var API_URL = "";

/* ---------------- state ---------------- */
var D = null;            // dashboard payload
var tab = "train";
var openProgram = 0;     // program accordion open workout id
var draftName = "", draftEmphasis = "";
var draftExercises = []; // {name, sets, min, max, weight, inc}

/* ---------------- helpers ---------------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function el(html) {
  var t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function prettyDate(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function formatWeight(v) { return v === null || v === undefined ? "Set weight" : v + " lb"; }
function toast(msg) {
  var t = el('<button class="toast">' + esc(msg) + '<span>×</span></button>');
  t.addEventListener("click", function () { t.remove(); });
  $("toast-root").appendChild(t);
  setTimeout(function () { if (t.parentNode) t.remove(); }, 6000);
}

/* ---------------- API ----------------
   Sheet mode: set API_URL to your Apps Script /exec URL.
   Local mode (default, empty API_URL): everything runs on-device in
   localStorage — one link works for everyone, no accounts, no setup. */
function api(action, params) {
  if (API_URL) return apiSheet(action, params);
  params = params || {};
  if (!LocalApi[action]) return Promise.reject(new Error("Unknown action: " + action));
  try {
    return LocalApi[action](params);
  } catch (e) {
    return Promise.reject(e);
  }
}
function apiSheet(action, params) {
  params = params || {};
  params.action = action;
  var qs = Object.keys(params).map(function (k) {
    var v = params[k];
    return encodeURIComponent(k) + "=" + encodeURIComponent(v == null ? "" : v);
  }).join("&");
  return fetch(API_URL + "?" + qs).then(function (res) {
    if (!res.ok) throw new Error("Network error (" + res.status + ")");
    return res.json();
  }).then(function (d) {
    if (!d || d.ok === false) throw new Error((d && d.error) || "Server error");
    return d;
  });
}
function refresh() {
  return api("dashboard").then(function (d) { D = d.data; });
}

/* ---------------- local backend (on-device, localStorage) ---------------- */
var LS_DB = "ght_db_v1";
function lsGet(k, fb) {
  try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
  catch (e) { return fb; }
}
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

var Local = {
  db: null,
  load: function () { this.db = lsGet(LS_DB, null); return this.db; },
  save: function () { lsSet(LS_DB, this.db); },
  nextId: function (arr) {
    var mx = 0;
    arr.forEach(function (r) { if (r.id > mx) mx = r.id; });
    return mx + 1;
  },
  findExercise: function (eid) {
    var found = null;
    this.db.workouts.forEach(function (w) {
      w.exercises.forEach(function (x) { if (x.id === Number(eid)) found = x; });
    });
    return found;
  },
  findWorkout: function (wid) {
    var found = null;
    this.db.workouts.forEach(function (w) { if (w.id === Number(wid)) found = w; });
    return found;
  },
  sortedWorkouts: function () {
    return this.db.workouts.slice().sort(function (a, b) { return a.position - b.position; });
  },
  openSession: function () {
    var open = null;
    this.db.sessions.forEach(function (s) { if (!s.completed_at && (!open || s.id > open.id)) open = s; });
    return open;
  },
  seed: function (seed) {
    var db = { workouts: [], sessions: [], sets: [], meta: {} };
    var wid = 1, eid = 1;
    seed.workouts.forEach(function (w, wi) {
      var exs = w.exercises.map(function (x, xi) {
        return {
          id: eid++, workout_id: wid, name: x.name,
          target_sets: x.target_sets, min_reps: x.min_reps, max_reps: x.max_reps,
          current_weight: (x.current_weight == null ? null : x.current_weight),
          increment: x.increment, position: xi + 1, last_adjustment: "",
          warmup_sets: (x.warmup_sets == null ? 2 : x.warmup_sets),
          warmup_pct: (x.warmup_pct == null ? 60 : x.warmup_pct),
          warmup_reps: (x.warmup_reps == null ? 5 : x.warmup_reps),
          sessions_since_bump: 0
        };
      });
      db.workouts.push({
        id: wid, key: w.key, name: w.name, emphasis: w.emphasis,
        position: wi + 1, custom: 0, exercises: exs
      });
      wid++;
    });
    db.meta.next_workout_id = db.workouts.length ? db.workouts[0].id : 0;
    this.db = db;
    this.save();
    return db;
  }
};

var LocalApi = {
  dashboard: function () {
    var db = Local.db;
    var workouts = Local.sortedWorkouts();
    var open = Local.openSession();
    var active = null;
    if (open) {
      active = {
        id: open.id, workout_id: open.workout_id, started_at: open.started_at,
        sets: db.sets.filter(function (r) { return r.session_id === open.id; }).map(function (r) {
          return { exercise_id: r.exercise_id, set_number: r.set_number, weight: r.weight, reps: r.reps };
        })
      };
    }
    var wname = {};
    workouts.forEach(function (w) { wname[w.id] = w.name; });
    var history = db.sessions.filter(function (s) { return !!s.completed_at; })
      .sort(function (a, b) { return b.id - a.id; }).slice(0, 60).map(function (s) {
        var done = 0, vol = 0;
        db.sets.forEach(function (r) {
          if (r.session_id === s.id && (r.reps || 0) > 0) { done++; vol += (r.weight || 0) * (r.reps || 0); }
        });
        return { id: s.id, workout_name: wname[s.workout_id] || "Workout", completed_at: s.completed_at, completed_sets: done, volume: Math.round(vol) };
      });
    return Promise.resolve({ ok: true, data: {
      workouts: workouts,
      next_workout_id: db.meta.next_workout_id || (workouts[0] && workouts[0].id) || 0,
      active_session: active,
      history: history
    }});
  },
  startWorkout: function (p) {
    var db = Local.db;
    var open = Local.openSession();
    if (open) {
      db.sets = db.sets.filter(function (r) { return r.session_id !== open.id; });
      db.sessions = db.sessions.filter(function (s) { return s.id !== open.id; });
    }
    var id = Local.nextId(db.sessions);
    db.sessions.push({ id: id, workout_id: Number(p.workout_id), started_at: new Date().toISOString(), completed_at: "" });
    Local.save();
    return Promise.resolve({ ok: true, session_id: id });
  },
  logSet: function (p) {
    var db = Local.db;
    var sid = Number(p.session_id), eid = Number(p.exercise_id), sn = Number(p.set_number);
    var found = null;
    db.sets.forEach(function (r) {
      if (r.session_id === sid && r.exercise_id === eid && r.set_number === sn) found = r;
    });
    var w = (p.weight === "" || p.weight == null) ? null : Number(p.weight);
    var rp = (p.reps === "" || p.reps == null) ? null : Number(p.reps);
    if (found) { found.weight = w; found.reps = rp; }
    else db.sets.push({ session_id: sid, exercise_id: eid, set_number: sn, weight: w, reps: rp });
    Local.save();
    return Promise.resolve({ ok: true });
  },
  finishWorkout: function (p) {
    var db = Local.db, sid = Number(p.session_id), adj = 0;
    var sess = null;
    db.sessions.forEach(function (s) { if (s.id === sid) sess = s; });
    if (!sess) return Promise.reject(new Error("Session not found"));
    var w = Local.findWorkout(sess.workout_id);
    if (!w) return Promise.reject(new Error("Workout not found"));
    w.exercises.forEach(function (x) {
      var logged = db.sets.filter(function (r) { return r.session_id === sid && r.exercise_id === x.id && (r.reps || 0) > 0; });
      var hit = x.target_sets > 0 && logged.length >= x.target_sets &&
        logged.every(function (r) { return (r.reps || 0) >= x.max_reps; });
      if (hit) {
        x.current_weight = (x.current_weight || 0) + (x.increment || 0);
        x.last_adjustment = "+" + (x.increment || 0) + " lb";
        x.sessions_since_bump = 0;
        adj++;
      } else {
        x.sessions_since_bump = (x.sessions_since_bump || 0) + 1;
        x.last_adjustment = (x.current_weight == null ? "—" : x.current_weight + " lb") + " · hold";
      }
    });
    sess.completed_at = new Date().toISOString();
    var sorted = Local.sortedWorkouts(), idx = -1;
    sorted.forEach(function (x, i) { if (x.id === w.id) idx = i; });
    var next = sorted[(idx + 1) % sorted.length];
    if (next) db.meta.next_workout_id = next.id;
    Local.save();
    return Promise.resolve({ ok: true, adjustments: adj });
  },
  updateExercise: function (p) {
    var x = Local.findExercise(p.exercise_id);
    if (!x) return Promise.reject(new Error("Exercise not found"));
    x.current_weight = (p.current_weight === "" || p.current_weight == null) ? null : Number(p.current_weight);
    x.increment = Number(p.increment) || 0;
    Local.save();
    return Promise.resolve({ ok: true });
  },
  createWorkout: function (p) {
    var db = Local.db;
    var list = [];
    try { list = JSON.parse(p.exercises || "[]"); } catch (e) { list = []; }
    if (!list.length) return Promise.reject(new Error("Add at least one exercise"));
    var wid = Local.nextId(db.workouts);
    var maxPos = 0;
    db.workouts.forEach(function (w) { if (w.position > maxPos) maxPos = w.position; });
    var eid = Local.nextId(db.workouts.reduce(function (a, w) { return a.concat(w.exercises); }, []));
    var exs = list.map(function (ex, i) {
      return {
        id: eid + i, workout_id: wid, name: String(ex.name || "Exercise").slice(0, 80),
        target_sets: Math.max(1, Math.min(12, Number(ex.target_sets) || 3)),
        min_reps: Math.max(1, Number(ex.min_reps) || 8),
        max_reps: Math.max(Number(ex.min_reps) || 8, Number(ex.max_reps) || 12),
        current_weight: (ex.current_weight === "" || ex.current_weight == null) ? null : Number(ex.current_weight),
        increment: Number(ex.increment) || 5,
        position: i + 1, last_adjustment: "",
        warmup_sets: 2, warmup_pct: 60, warmup_reps: 5,
        sessions_since_bump: 0
      };
    });
    db.workouts.push({
      id: wid, key: "custom-" + wid, name: String(p.name || "Custom").slice(0, 60),
      emphasis: String(p.emphasis || "").slice(0, 80), position: maxPos + 1, custom: 1, exercises: exs
    });
    Local.save();
    return Promise.resolve({ ok: true, workout_id: wid });
  },
  deleteWorkout: function (p) {
    var db = Local.db, wid = Number(p.workout_id);
    var w = Local.findWorkout(wid);
    if (!w) return Promise.reject(new Error("Workout not found"));
    var eids = {};
    w.exercises.forEach(function (x) { eids[x.id] = 1; });
    var sids = {};
    db.sessions.forEach(function (s) { if (s.workout_id === wid) sids[s.id] = 1; });
    db.workouts = db.workouts.filter(function (x) { return x.id !== wid; });
    db.sessions = db.sessions.filter(function (s) { return s.workout_id !== wid; });
    db.sets = db.sets.filter(function (r) { return !sids[r.session_id]; });
    var sorted = Local.sortedWorkouts();
    if (db.meta.next_workout_id === wid) db.meta.next_workout_id = sorted.length ? sorted[0].id : 0;
    Local.save();
    return Promise.resolve({ ok: true });
  }
};

/* ---------------- nav ---------------- */
function setTab(t) {
  tab = t;
  document.querySelectorAll(".bottom-nav button").forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-tab") === t);
  });
  render();
  window.scrollTo(0, 0);
}

/* ---------------- Train: home ---------------- */
function trainHome() {
  var next = null, other = null;
  D.workouts.forEach(function (w) {
    if (w.id === D.next_workout_id) next = w;
    else if (!other) other = w;
  });
  if (!next) next = D.workouts[0];
  if (!next) return emptyState("—", "Loading your routine.", "Your workout rotation will be ready in a moment.");
  var totalSets = next.exercises.reduce(function (s, e) { return s + e.target_sets; }, 0);

  var s = el("<section></section>");
  var hero = el(
    '<div class="next-hero">' +
      '<div class="hero-metal">NEXT IN ROTATION</div>' +
      "<h1>" + esc(next.name) + "</h1>" +
      '<p class="hero-emphasis">' + esc(next.emphasis) + "</p>" +
      '<div class="hero-stats"><div><strong>' + next.exercises.length + "</strong><span>moves</span></div>" +
      "<div><strong>" + totalSets + "</strong><span>working sets</span></div></div>" +
      '<button class="primary-button primary-button--light">Start ' + esc(next.name) + "</button>" +
    "</div>"
  );
  hero.querySelector("button").addEventListener("click", function () { startWorkout(next.id); });
  s.appendChild(hero);

  var nudge = checkinNudge();
  if (nudge) s.appendChild(nudge);

  var head = el(
    '<div class="section-heading"><div><span>THE WORK</span><h2>Today\u2019s order</h2></div>' +
    "<p>Last working loads are ready.</p></div>"
  );
  s.appendChild(head);

  var list = el('<div class="preview-list"></div>');
  next.exercises.forEach(function (e, i) {
    list.appendChild(el(
      '<div class="preview-row">' +
        '<span class="preview-index">' + String(i + 1).padStart(2, "0") + "</span>" +
        "<div><strong>" + esc(e.name) + "</strong><span>" + e.target_sets + " × " + e.min_reps + "\u2013" + e.max_reps + "</span></div>" +
        '<div class="preview-weight"><strong>' + (e.current_weight === null ? "—" : esc(e.current_weight)) + "</strong><span>" +
        (e.current_weight === null ? "set lb" : "lb") + "</span></div>" +
      "</div>"
    ));
  });
  s.appendChild(list);

  if (other) {
    var alt = el(
      '<button class="alternate-button"><span>Need the other day?</span><strong>Start ' + esc(other.name) + " →</strong></button>"
    );
    alt.addEventListener("click", function () { startWorkout(other.id); });
    s.appendChild(alt);
  }
  return s;
}

function startWorkout(workoutId) {
  api("startWorkout", { workout_id: workoutId })
    .then(refresh).then(render)
    .catch(function (err) { toast("Couldn\u2019t start: " + err.message); });
}

/* ---------------- Train: active logger ---------------- */
function findSavedSet(active, exerciseId, setNumber) {
  for (var i = 0; i < active.sets.length; i++) {
    var s = active.sets[i];
    if (s.exercise_id === exerciseId && s.set_number === setNumber) return s;
  }
  return null;
}
function upsertLocalSet(active, exerciseId, setNumber, weight, reps) {
  var s = findSavedSet(active, exerciseId, setNumber);
  if (s) { s.weight = weight; s.reps = reps; }
  else active.sets.push({ exercise_id: exerciseId, set_number: setNumber, weight: weight, reps: reps });
}

function warmupRowEl(n, weight, reps) {
  return el(
    '<div class="set-row set-row--warmup">' +
      '<div class="set-number">W' + n + "</div>" +
      '<div class="warmup-static"><strong>' + weight + "</strong><span>lb</span></div>" +
      '<div class="warmup-static"><strong>' + reps + "</strong><span>reps</span></div>" +
      '<div class="save-state">WARM-UP</div>' +
    "</div>"
  );
}

function setRowEl(active, exercise, setNumber, onProgress) {
  var saved = findSavedSet(active, exercise.id, setNumber);
  var weight = saved && saved.weight != null ? String(saved.weight)
    : (exercise.current_weight != null ? String(exercise.current_weight) : "");
  var reps = saved && saved.reps != null ? String(saved.reps) : "";
  var saving = false, lastSent = weight + "|" + reps;

  var row = el(
    '<div class="set-row">' +
      '<div class="set-number">' + setNumber + "</div>" +
      '<label class="field-label"><span>lb</span><input aria-label="' + esc(exercise.name) + " set " + setNumber +
        '" inputmode="decimal" type="number" min="0" step="2.5" placeholder="\u2014"></label>' +
      '<label class="field-label"><span>reps</span><input aria-label="' + esc(exercise.name) + " set " + setNumber +
        ' reps" inputmode="numeric" type="number" min="0" max="100" placeholder="\u2014"></label>' +
      '<div class="save-state"></div>' +
    "</div>"
  );
  var wInput = row.querySelectorAll("input")[0];
  var rInput = row.querySelectorAll("input")[1];
  var numEl = row.querySelector(".set-number");
  var stateEl = row.querySelector(".save-state");
  wInput.value = weight;
  rInput.value = reps;

  function paint() {
    var done = reps !== "" && Number(reps) > 0;
    row.classList.toggle("set-row--done", done);
    numEl.textContent = done ? "✓" : setNumber;
    stateEl.innerHTML = saving ? '<span class="spinner" aria-label="Saving"></span>' : (done ? "LOGGED" : "");
  }
  function save() {
    weight = wInput.value;
    reps = rInput.value;
    var key = weight + "|" + reps;
    paint();
    if (key === lastSent) return;
    if (weight === "" && reps === "") return;
    lastSent = key;
    saving = true; paint();
    api("logSet", {
      session_id: active.id, exercise_id: exercise.id, set_number: setNumber,
      weight: weight === "" ? "" : Number(weight), reps: reps === "" ? "" : Number(reps)
    }).then(function () {
      upsertLocalSet(active, exercise.id, setNumber,
        weight === "" ? null : Number(weight), reps === "" ? null : Number(reps));
      saving = false; paint(); onProgress();
    }).catch(function () { saving = false; paint(); });
  }
  wInput.addEventListener("blur", save);
  rInput.addEventListener("blur", save);
  paint();
  return row;
}

function workoutLogger() {
  var active = D.active_session;
  var workout = null;
  D.workouts.forEach(function (w) { if (w.id === active.workout_id) workout = w; });
  if (!workout) return trainHome();

  var total = workout.exercises.reduce(function (s, e) { return s + e.target_sets; }, 0);
  var s = el("<section class='workout-live'></section>");
  var hero = el(
    '<div class="live-hero"><div><span class="live-dot"></span><span>IN PROGRESS</span>' +
      "<h1>" + esc(workout.name) + "</h1><p>" + esc(workout.emphasis) + "</p></div>" +
      '<div class="set-progress"><strong>0</strong><span>/' + total + " sets</span></div></div>"
  );
  s.appendChild(hero);
  var progStrong = hero.querySelector(".set-progress strong");
  function updateProgress() {
    var done = active.sets.filter(function (x) { return (x.reps || 0) > 0; }).length;
    progStrong.textContent = done;
  }

  var stack = el('<div class="exercise-stack"></div>');
  workout.exercises.forEach(function (e, i) {
    var card = el(
      '<article class="exercise-log"><div class="exercise-head">' +
        '<div class="exercise-index">' + String(i + 1).padStart(2, "0") + "</div>" +
        '<div class="exercise-title"><h2>' + esc(e.name) + "</h2><p>" + e.target_sets + " × " + e.min_reps + "\u2013" + e.max_reps + "</p></div>" +
        '<div class="working-weight"><strong>' + esc(formatWeight(e.current_weight)) + "</strong><span>" + esc(e.last_adjustment || "") + "</span></div>" +
      "</div>" +
      '<div class="set-headings"><span>SET</span><span>WEIGHT</span><span>REPS</span><span></span></div></article>'
    );
    /* Warm-up sets render first (display-only, never logged): 2 × 5 @ 60%,
       rounded down to the nearest 2.5 lb. No warm-up load for bodyweight. */
    var wSets = (e.warmup_sets == null ? 2 : e.warmup_sets);
    var wPct = (e.warmup_pct == null ? 60 : e.warmup_pct);
    var wReps = (e.warmup_reps == null ? 5 : e.warmup_reps);
    if (wSets > 0 && e.current_weight != null && e.current_weight > 0) {
      var wLb = Math.floor((e.current_weight * wPct / 100) / 2.5) * 2.5;
      for (var w = 1; w <= wSets; w++) card.appendChild(warmupRowEl(w, wLb, wReps));
    }
    for (var n = 1; n <= e.target_sets; n++) {
      card.appendChild(setRowEl(active, e, n, updateProgress));
    }
    stack.appendChild(card);
  });
  s.appendChild(stack);
  updateProgress();

  var dock = el(
    '<div class="finish-dock"><p>Hit the top of every rep range and next session\u2019s load goes up automatically.</p>' +
    '<button class="primary-button">Finish workout</button></div>'
  );
  dock.querySelector("button").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = "Finishing\u2026";
    api("finishWorkout", { session_id: active.id }).then(function (d) {
      var a = d.adjustments || 0;
      toast(a > 0
        ? a + " load" + (a === 1 ? "" : "s") + " moved up for next time."
        : "Workout saved. Keep building reps next time.");
      return refresh();
    }).then(function () { setTab("train"); })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = "Finish workout";
      var err = el('<p class="error-text">Couldn\u2019t finish. Your logged sets are still saved.</p>');
      dock.appendChild(err);
    });
  });
  s.appendChild(dock);
  return s;
}

/* ---------------- History ---------------- */
function historyView() {
  if (!D.history.length) {
    return emptyState("00", "Your work starts here.",
      "Finish a workout and it\u2019ll appear here with set count and total lifted volume.");
  }
  var s = el(
    '<section class="page-section"><div class="page-title"><span>TRAINING LOG</span><h1>Built, set by set.</h1>' +
    "<p>" + D.history.length + " recent sessions</p></div>" +
    '<div class="history-list"></div></section>'
  );
  var list = s.querySelector(".history-list");
  D.history.forEach(function (h, i) {
    list.appendChild(el(
      '<article class="history-row">' +
        '<div class="history-number">' + String(D.history.length - i).padStart(2, "0") + "</div>" +
        '<div class="history-main"><strong>' + esc(h.workout_name) + "</strong><span>" + esc(prettyDate(h.completed_at)) + "</span></div>" +
        '<div class="history-metric"><strong>' + h.completed_sets + "</strong><span>sets</span></div>" +
        '<div class="history-metric"><strong>' + Number(h.volume).toLocaleString() + "</strong><span>lb vol.</span></div>" +
      "</article>"
    ));
  });
  return s;
}

/* ---------------- Program ---------------- */
function exerciseSetting(e) {
  var row = el(
    '<div class="setting-row">' +
      '<div class="setting-name"><strong>' + esc(e.name) + "</strong><span>" + e.target_sets + " × " + e.min_reps + "\u2013" + e.max_reps + "</span></div>" +
      '<label><span>Working lb</span><input aria-label="' + esc(e.name) + ' working weight" type="number" inputmode="decimal" min="0" step="2.5" placeholder="\u2014"></label>' +
      '<label><span>Add lb</span><input aria-label="' + esc(e.name) + ' progression increment" type="number" inputmode="decimal" min="0" step="2.5"></label>' +
      '<button aria-label="Save ' + esc(e.name) + ' settings">Save</button>' +
    "</div>"
  );
  var inputs = row.querySelectorAll("input");
  inputs[0].value = e.current_weight == null ? "" : e.current_weight;
  inputs[1].value = e.increment;
  row.querySelector("button").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = "\u2026";
    api("updateExercise", {
      exercise_id: e.id,
      current_weight: inputs[0].value === "" ? "" : Number(inputs[0].value),
      increment: Number(inputs[1].value || 0)
    }).then(refresh).then(function () {
      btn.disabled = false;
      btn.textContent = "Save";
      render();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = "Save";
      toast("Couldn\u2019t save: " + err.message);
    });
  });
  return row;
}

function programView() {
  if (!openProgram && D.workouts.length) openProgram = D.workouts[0].id;
  var s = el(
    '<section class="page-section"><div class="page-title"><span>LOAD CONTROL</span><h1>Simple progression.</h1>' +
    "<p>Hit the top of the range on every set: add the listed increment next time. Miss it: hold the load and beat your reps.</p></div>" +
    '<div class="rule-strip"><strong>Top of range across all sets</strong><span>\u2192 automatic increase</span></div></section>'
  );
  D.workouts.forEach(function (w) {
    var block = el('<div class="program-block"></div>');
    var head = el('<div class="program-blockhead"></div>');
    var toggle = el(
      '<button class="program-toggle" aria-expanded="' + (openProgram === w.id) + '">' +
        "<div><strong>" + esc(w.name) + (w.custom ? ' <span style="color:var(--accent)">· custom</span>' : "") + "</strong><span>" + esc(w.emphasis) + "</span></div>" +
        "<span>" + (openProgram === w.id ? "\u2212" : "+") + "</span>" +
      "</button>"
    );
    toggle.addEventListener("click", function () {
      openProgram = openProgram === w.id ? 0 : w.id;
      render();
    });
    head.appendChild(toggle);
    block.appendChild(head);
    if (openProgram === w.id) {
      var list = el('<div class="setting-list"></div>');
      w.exercises.forEach(function (e) { list.appendChild(exerciseSetting(e)); });
      block.appendChild(list);
      if (w.custom) {
        var del = el('<button class="program-delete">Delete this workout</button>');
        del.addEventListener("click", function () {
          if (!confirm("Delete \u201c" + w.name + "\u201d and its history?")) return;
          api("deleteWorkout", { workout_id: w.id }).then(refresh).then(function () {
            openProgram = 0;
            toast("Workout deleted.");
            render();
          }).catch(function (err) { toast("Couldn\u2019t delete: " + err.message); });
        });
        block.appendChild(del);
      }
    }
    s.appendChild(block);
  });
  return s;
}

/* ---------------- Create ---------------- */
function blankExercise() {
  return { name: "", sets: 3, min: 8, max: 12, weight: "", inc: 5 };
}
function builderCard(ex, i) {
  var card = el(
    '<div class="builder-card"><div class="builder-head"><strong>EXERCISE ' + String(i + 1).padStart(2, "0") + "</strong>" +
    '<div class="builder-actions"><button type="button" data-a="up" aria-label="Move up">↑</button>' +
    '<button type="button" data-a="down" aria-label="Move down">↓</button>' +
    '<button type="button" data-a="del" class="danger" aria-label="Remove">×</button></div></div>' +
    '<div class="builder-grid">' +
      '<label class="wide"><span>Exercise name</span><input data-f="name" placeholder="e.g. Barbell Curl"></label>' +
      '<label><span>Sets</span><input data-f="sets" type="number" inputmode="numeric" min="1" max="12"></label>' +
      '<label><span>Min reps</span><input data-f="min" type="number" inputmode="numeric" min="1"></label>' +
      '<label><span>Max reps</span><input data-f="max" type="number" inputmode="numeric" min="1"></label>' +
      '<label><span>Start weight (lb)</span><input data-f="weight" type="number" inputmode="decimal" min="0" step="2.5" placeholder="\u2014"></label>' +
      '<label><span>Add lb each bump</span><input data-f="inc" type="number" inputmode="decimal" min="0" step="2.5"></label>' +
    "</div></div>"
  );
  card.querySelectorAll("input").forEach(function (inp) {
    var f = inp.getAttribute("data-f");
    inp.value = ex[f];
    inp.addEventListener("input", function () { ex[f] = inp.value; });
  });
  card.querySelectorAll(".builder-actions button").forEach(function (b) {
    b.addEventListener("click", function () {
      var a = b.getAttribute("data-a");
      if (a === "del") draftExercises.splice(i, 1);
      else if (a === "up" && i > 0) { var t = draftExercises[i - 1]; draftExercises[i - 1] = draftExercises[i]; draftExercises[i] = t; }
      else if (a === "down" && i < draftExercises.length - 1) { var u = draftExercises[i + 1]; draftExercises[i + 1] = draftExercises[i]; draftExercises[i] = u; }
      render();
    });
  });
  return card;
}

function createView() {
  var s = el(
    '<section class="page-section"><div class="page-title"><span>BUILD YOUR OWN</span><h1>Custom workout.</h1>' +
    "<p>Name it, add your exercises, and it joins the rotation on the Train tab with the same auto-progression.</p></div>" +
    '<div class="create-form"></div></section>'
  );
  var form = s.querySelector(".create-form");

  var nameF = el('<label class="create-field"><span>Workout name</span><input placeholder="e.g. Push Day"></label>');
  var nameI = nameF.querySelector("input");
  nameI.value = draftName;
  nameI.addEventListener("input", function () { draftName = nameI.value; });
  var empF = el('<label class="create-field"><span>Emphasis line</span><input placeholder="e.g. Chest / shoulders / triceps"></label>');
  var empI = empF.querySelector("input");
  empI.value = draftEmphasis;
  empI.addEventListener("input", function () { draftEmphasis = empI.value; });
  form.appendChild(nameF);
  form.appendChild(empF);

  draftExercises.forEach(function (ex, i) { form.appendChild(builderCard(ex, i)); });

  var add = el('<button type="button" class="add-exercise">+ Add exercise</button>');
  add.addEventListener("click", function () { draftExercises.push(blankExercise()); render(); });
  form.appendChild(add);

  var save = el('<div class="create-save"><button class="primary-button">Save workout</button></div>');
  save.querySelector("button").addEventListener("click", function () {
    var btn = this;
    var name = draftName.trim();
    if (!name) { toast("Give your workout a name first."); return; }
    var list = [];
    for (var i = 0; i < draftExercises.length; i++) {
      var ex = draftExercises[i];
      if (!String(ex.name).trim()) { toast("Exercise " + (i + 1) + " needs a name."); return; }
      list.push({
        name: String(ex.name).trim(),
        target_sets: Math.max(1, parseInt(ex.sets, 10) || 3),
        min_reps: Math.max(1, parseInt(ex.min, 10) || 8),
        max_reps: Math.max(parseInt(ex.min, 10) || 8, parseInt(ex.max, 10) || 12),
        current_weight: ex.weight === "" ? "" : Number(ex.weight),
        increment: Number(ex.inc) || 5
      });
    }
    if (!list.length) { toast("Add at least one exercise."); return; }
    btn.disabled = true;
    api("createWorkout", { name: name, emphasis: draftEmphasis.trim(), exercises: JSON.stringify(list) })
      .then(refresh)
      .then(function () {
        draftName = ""; draftEmphasis = ""; draftExercises = [];
        toast("\u201c" + name + "\u201d joined your rotation.");
        setTab("train");
      })
      .catch(function (err) { btn.disabled = false; toast("Couldn\u2019t save: " + err.message); });
  });
  form.appendChild(save);
  return s;
}

/* ---------------- profile + measurements (always on-device) ---------------- */
var LS_PROFILE = "ght_profile_v1";
var LS_MEAS = "ght_meas_v1";
var LS_ONBOARD = "ght_onboarded_v1";

var TAPE_FIELDS = [
  { k: "weight", label: "Body weight", unit: "lb" },
  { k: "neck", label: "Neck", unit: "in" },
  { k: "shoulders", label: "Shoulders", unit: "in" },
  { k: "chest", label: "Chest", unit: "in" },
  { k: "waist", label: "Waist (navel)", unit: "in" },
  { k: "hips", label: "Hips", unit: "in" },
  { k: "arm", label: "Arm (flexed)", unit: "in" },
  { k: "thigh", label: "Thigh", unit: "in" }
];
var GOAL_LABELS = { build: "Build muscle", lean: "Get lean", strong: "Get stronger" };

function getProfile() { return lsGet(LS_PROFILE, null); }
function saveProfile(p) { lsSet(LS_PROFILE, p); }
function getMeas() {
  return lsGet(LS_MEAS, []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}
function latestMeas() { var m = getMeas(); return m.length ? m[m.length - 1] : null; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function fmtDate(dstr) {
  var p = String(dstr).split("-");
  return p.length === 3 ? Number(p[1]) + "/" + Number(p[2]) + "/" + p[0] : dstr;
}
function daysUntil(dstr) {
  return Math.round((new Date(dstr + "T12:00:00").getTime() - Date.now()) / 864e5);
}
function fmtDelta(v, unit) {
  if (v == null || isNaN(v) || v === 0) return "";
  var s = (v > 0 ? "+" : "") + (Math.round(v * 4) / 4);
  return " (" + s + " " + unit + ")";
}

/* ---------------- onboarding ---------------- */
var OB = { step: 1, stats: {}, goal: null, deadline: "" };

function showOnboarding() {
  document.body.classList.add("onboarding");
  OB = { step: 1, stats: {}, goal: null, deadline: "" };
  renderOnboard();
}
function renderOnboard() {
  var main = $("main");
  main.innerHTML = "";
  main.appendChild(onboardingView());
  window.scrollTo(0, 0);
}
function obShell(title, sub) {
  var s = el('<section class="page-section ob"></section>');
  s.appendChild(el('<div class="ob-kicker">SETUP</div>'));
  s.appendChild(el("<h1>" + esc(title) + "</h1>"));
  if (sub) s.appendChild(el('<p class="ob-sub">' + esc(sub) + "</p>"));
  return s;
}
function measInputs(values) {
  values = values || {};
  var wrap = el('<div class="meas-grid"></div>');
  TAPE_FIELDS.forEach(function (f) {
    var lab = el('<label class="field-label meas-field"><span>' + f.unit + "</span></label>");
    var inp = document.createElement("input");
    inp.type = "number"; inp.step = "0.25"; inp.min = "0";
    inp.placeholder = f.label;
    inp.setAttribute("aria-label", f.label);
    if (values[f.k] != null && values[f.k] !== "") inp.value = values[f.k];
    inp.dataset.key = f.k;
    lab.insertBefore(inp, lab.firstChild);
    var cap = el('<div class="meas-cap">' + esc(f.label) + "</div>");
    var cell = el('<div class="meas-cell"></div>');
    cell.appendChild(lab); cell.appendChild(cap);
    wrap.appendChild(cell);
  });
  return wrap;
}
function readMeasInputs(root) {
  var out = {};
  root.querySelectorAll("input[data-key]").forEach(function (inp) {
    var v = inp.value.trim();
    if (v !== "" && !isNaN(Number(v))) out[inp.dataset.key] = Number(v);
  });
  return out;
}
function onboardingView() {
  var s;
  if (OB.step === 1) {
    s = obShell("Where are you starting from?", "Log what you've got — weight and tape measurements. Skip anything you don't have.");
    var grid = measInputs(OB.stats);
    s.appendChild(grid);
    var row = el('<div class="ob-row"></div>');
    var skip = el('<button class="ghost-button">Skip</button>');
    skip.addEventListener("click", function () { OB.step = 2; renderOnboard(); });
    var next = el('<button class="primary-button">Continue</button>');
    next.addEventListener("click", function () { OB.stats = readMeasInputs(grid); OB.step = 2; renderOnboard(); });
    row.appendChild(skip); row.appendChild(next);
    s.appendChild(row);
  } else if (OB.step === 2) {
    s = obShell("What's the goal?", "This tunes your coach notes — what to watch and when to push.");
    var goals = el('<div class="goal-picks"></div>');
    [["build", "Build muscle", "Get bigger — size first."],
     ["lean", "Get lean", "Drop fat, keep the muscle."],
     ["strong", "Get stronger", "Move bigger numbers."]].forEach(function (g) {
      var b = el('<button class="goal-pick' + (OB.goal === g[0] ? " selected" : "") + '"><strong>' + g[1] + "</strong><span>" + g[2] + "</span></button>");
      b.addEventListener("click", function () { OB.goal = g[0]; renderOnboard(); });
      goals.appendChild(b);
    });
    s.appendChild(goals);
    var dl = el('<div class="deadline-row"></div>');
    dl.appendChild(el('<label for="ob-deadline">Deadline <em>(optional — wedding, event, summer)</em></label>'));
    var dinp = el('<input id="ob-deadline" type="date">');
    if (OB.deadline) dinp.value = OB.deadline;
    dl.appendChild(dinp);
    s.appendChild(dl);
    var start = el('<button class="primary-button">Start training</button>');
    start.addEventListener("click", function () {
      if (!OB.goal) { toast("Pick a goal to continue."); return; }
      OB.deadline = dinp.value || "";
      saveProfile({ goal: OB.goal, deadline: OB.deadline, created_at: new Date().toISOString() });
      var keys = Object.keys(OB.stats);
      if (keys.length) {
        var m = { id: 1, date: todayStr() };
        keys.forEach(function (k) { m[k] = OB.stats[k]; });
        lsSet(LS_MEAS, [m]);
      }
      lsSet(LS_ONBOARD, true);
      document.body.classList.remove("onboarding");
      setTab("train");
      toast("You're in. Let's work.");
    });
    s.appendChild(start);
  }
  return s;
}
function finishOnboardingGate() {
  return !!lsGet(LS_ONBOARD, false);
}

/* ---------------- coach analysis ---------------- */
function coachInsights() {
  var out = [];
  var profile = getProfile();
  var goal = profile && profile.goal;
  var meas = getMeas();
  var weekAgo = Date.now() - 7 * 864e5;

  /* 1 — consistency: sessions finished in the last 7 days */
  var recent = (D.history || []).filter(function (h) {
    return new Date(h.completed_at).getTime() >= weekAgo;
  });
  if (recent.length === 0) {
    out.push({ tone: "warn", title: "No workouts logged in 7 days",
      body: "Consistency beats everything else. Even a short session keeps the streak alive — get one in today." });
  } else if (recent.length < 3) {
    out.push({ tone: "info", title: recent.length + (recent.length === 1 ? " workout" : " workouts") + " this week",
      body: "You're moving. Three or more sessions a week is where real progress compounds." });
  } else {
    out.push({ tone: "good", title: "Solid week — " + recent.length + " sessions",
      body: "This is the pace that builds physiques. Keep stacking weeks like this." });
  }

  /* 2 — plateaus: main lifts with no bump in 4+ sessions (on-device only) */
  var stalled = [];
  if (!API_URL && Local.db) {
    Local.sortedWorkouts().forEach(function (w) {
      w.exercises.slice(0, 3).forEach(function (x) {
        if (x.current_weight && (x.sessions_since_bump || 0) >= 4) stalled.push(x);
      });
    });
  }
  stalled.slice(0, 3).forEach(function (x) {
    out.push({ tone: "warn", title: x.name + " has stalled",
      body: "No weight bump in " + x.sessions_since_bump + " sessions. Check sleep and food first — then try adding one rep per set before forcing the weight up." });
  });

  /* 3 — measurements vs goal (needs two check-ins) */
  if (meas.length >= 2 && goal) {
    var a = meas[meas.length - 2], b = meas[meas.length - 1];
    var dWaist = (b.waist || 0) - (a.waist || 0);
    var dChest = (b.chest || 0) - (a.chest || 0);
    var dArm = (b.arm || 0) - (a.arm || 0);
    var dWt = (b.weight || 0) - (a.weight || 0);
    var muscle = (dChest + dArm) / 2;
    if (goal === "build") {
      if (dWaist > 0.5 && muscle < dWaist) {
        out.push({ tone: "warn", title: "Waist outpacing muscle",
          body: "Waist is up " + dWaist.toFixed(2) + " in while muscle barely moved. Trim the surplus a little — smaller portions, same protein." });
      } else if (muscle > 0 && dWaist <= 0.25) {
        out.push({ tone: "good", title: "Textbook lean bulk",
          body: "Muscle up, waist steady. Whatever you're eating and lifting — don't change a thing." });
      }
    } else if (goal === "lean") {
      if (dWt < 0 && dWaist < 0) {
        out.push({ tone: "good", title: "Cut is working",
          body: "Weight and waist both down. Hold the course." });
      } else if (dWt >= 0.5) {
        out.push({ tone: "warn", title: "Scale moving the wrong way",
          body: "Weight is up on a cut. Tighten up tracking for a week before changing anything drastic." });
      }
      if (stalled.length >= 2) {
        out.push({ tone: "info", title: "Strength dipping on the cut?",
          body: "A couple of lifts have stalled. That's normal while leaning out — but if it spreads, the deficit may be too steep." });
      }
    } else if (goal === "strong" && !stalled.length && recent.length >= 3) {
      out.push({ tone: "good", title: "Numbers climbing",
        body: "Lifts are moving and you're showing up. That's the whole game for strength." });
    }
  } else if (!meas.length || meas.length < 2) {
    out.push({ tone: "info", title: "Log a second check-in to unlock trends",
      body: "One check-in is a snapshot — two is a trend. Your next weekly check-in turns on the full analysis." });
  }
  return out.slice(0, 4);
}

/* ---------------- Body tab ---------------- */
function pageTitle(kicker, title) {
  return el('<div class="page-title"><span>' + esc(kicker) + "</span><h1>" + esc(title) + "</h1></div>");
}
function goalCard() {
  var p = getProfile();
  var card = el('<div class="goal-card"></div>');
  if (!p) {
    card.appendChild(el('<p class="dim">No goal set yet.</p>'));
  } else {
    var label = GOAL_LABELS[p.goal] || p.goal;
    var dl = "";
    if (p.deadline) {
      var left = daysUntil(p.deadline);
      dl = left >= 0 ? " · " + left + " days left" : " · deadline passed";
    }
    card.appendChild(el('<div class="goal-card-top"><span class="goal-badge">' + esc(label) + "</span>" +
      (p.deadline ? '<span class="goal-deadline">' + esc(fmtDate(p.deadline)) + dl + "</span>" : "") + "</div>"));
  }
  var edit = el('<button class="ghost-button goal-edit">Edit goal</button>');
  edit.addEventListener("click", function () {
    var cur = getProfile() || {};
    var wrap = el('<div class="goal-form"></div>');
    var sel = el('<select aria-label="Goal"></select>');
    Object.keys(GOAL_LABELS).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = GOAL_LABELS[k];
      if (cur.goal === k) o.selected = true;
      sel.appendChild(o);
    });
    var dinp = el('<input type="date" aria-label="Deadline">');
    if (cur.deadline) dinp.value = cur.deadline;
    var save = el('<button class="primary-button">Save</button>');
    save.addEventListener("click", function () {
      saveProfile({ goal: sel.value, deadline: dinp.value || "", created_at: cur.created_at || new Date().toISOString() });
      render(); toast("Goal updated.");
    });
    wrap.appendChild(sel); wrap.appendChild(dinp); wrap.appendChild(save);
    card.innerHTML = "";
    card.appendChild(wrap);
  });
  card.appendChild(edit);
  return card;
}

function insightsCard() {
  var card = el('<div class="insights"></div>');
  card.appendChild(el('<h3>Coach notes</h3>'));
  coachInsights().forEach(function (ins) {
    var d = el('<div class="insight insight--' + ins.tone + '"><strong>' + esc(ins.title) + "</strong><p>" + esc(ins.body) + "</p></div>");
    card.appendChild(d);
  });
  return card;
}

function checkinForm() {
  var s = el('<div class="checkin"></div>');
  s.appendChild(el("<h3>Weekly check-in</h3>"));
  s.appendChild(el('<p class="dim">Same conditions each time — morning, before food. Takes 60 seconds.</p>'));
  var latest = latestMeas() || {};
  var dateRow = el('<div class="checkin-date"></div>');
  var dinp = el('<input type="date" aria-label="Check-in date">');
  dinp.value = todayStr();
  dateRow.appendChild(el("<span>Date</span>"));
  dateRow.appendChild(dinp);
  s.appendChild(dateRow);
  var grid = measInputs(latest);
  s.appendChild(grid);
  var save = el('<button class="primary-button">Save check-in</button>');
  save.addEventListener("click", function () {
    var vals = readMeasInputs(grid);
    if (!Object.keys(vals).length) { toast("Add at least one number."); return; }
    var all = getMeas();
    var id = 1;
    all.forEach(function (m) { if (m.id >= id) id = m.id + 1; });
    var entry = { id: id, date: dinp.value || todayStr() };
    Object.keys(vals).forEach(function (k) { entry[k] = vals[k]; });
    all.push(entry);
    all.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    lsSet(LS_MEAS, all);
    render();
    toast("Check-in saved.");
  });
  s.appendChild(save);
  return s;
}

function measHistory() {
  var all = getMeas();
  var s = el('<div class="meas-history"></div>');
  s.appendChild(el("<h3>History</h3>"));
  if (!all.length) {
    s.appendChild(el('<p class="dim">No check-ins yet — your first one is above.</p>'));
    return s;
  }
  for (var i = all.length - 1; i >= 0; i--) {
    var m = all[i], prev = all[i - 1];
    var bits = [];
    TAPE_FIELDS.forEach(function (f) {
      if (m[f.k] == null) return;
      var d = prev && prev[f.k] != null ? fmtDelta(m[f.k] - prev[f.k], f.unit) : "";
      bits.push('<span class="mh-bit"><strong>' + m[f.k] + "</strong> " + f.unit + " " + esc(f.label) + esc(d) + "</span>");
    });
    var row = el('<div class="mh-row"><div class="mh-date">' + esc(fmtDate(m.date)) + "</div><div>" + bits.join("") + "</div></div>");
    s.appendChild(row);
  }
  return s;
}

function bodyView() {
  var s = el('<section class="page-section"></section>');
  s.appendChild(pageTitle("BODY", "Check-ins, measurements, and what they're telling you."));
  s.appendChild(goalCard());
  s.appendChild(insightsCard());
  s.appendChild(checkinForm());
  s.appendChild(measHistory());
  return s;
}

/* ---------------- weekly check-in nudge ---------------- */
function checkinNudge() {
  var m = latestMeas();
  var due = !m || (Date.now() - new Date(m.date + "T12:00:00").getTime()) > 7 * 864e5;
  if (!due) return null;
  var n = el('<div class="checkin-nudge"><div><strong>Weekly check-in due</strong><span>Log your weight + measurements — 60 seconds.</span></div></div>');
  var b = el('<button class="primary-button nudge-btn">Log it</button>');
  b.addEventListener("click", function () { setTab("body"); });
  n.appendChild(b);
  return n;
}

/* ---------------- misc views ---------------- */
function emptyState(mark, h1, p) {
  return el('<div class="content-empty"><span>' + esc(mark) + "</span><h1>" + esc(h1) + "</h1><p>" + esc(p) + "</p></div>");
}
function errorState() {
  var s = el('<div class="content-empty"><span>!</span><h1>Couldn\u2019t load the log.</h1></div>');
  var b = el('<button class="primary-button" style="max-width:220px;margin-top:18px">Try again</button>');
  b.addEventListener("click", boot);
  s.appendChild(b);
  return s;
}

/* ---------------- render + boot ---------------- */
function render() {
  var main = $("main");
  main.innerHTML = "";
  var v;
  if (tab === "train") v = D.active_session ? workoutLogger() : trainHome();
  else if (tab === "body") v = bodyView();
  else if (tab === "history") v = historyView();
  else if (tab === "program") v = programView();
  else v = createView();
  main.appendChild(v);
}

function boot() {
  $("main").appendChild(emptyState("—", "Loading your routine.", "Your workout rotation will be ready in a moment."));
  var prep;
  if (!API_URL && !Local.load()) {
    prep = fetch("seed-routine.json").then(function (r) {
      if (!r.ok) throw new Error("seed failed");
      return r.json();
    }).then(function (seed) { Local.seed(seed); });
  } else {
    prep = Promise.resolve();
    if (!API_URL) Local.load();
  }
  prep.then(refresh).then(function () {
    if (!finishOnboardingGate()) { showOnboarding(); return; }
    render();
  }).catch(function () {
    var main = $("main");
    main.innerHTML = "";
    main.appendChild(errorState());
  });
}

document.querySelectorAll(".bottom-nav button").forEach(function (b) {
  b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
});
document.addEventListener("DOMContentLoaded", boot);
