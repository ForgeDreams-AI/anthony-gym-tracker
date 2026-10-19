"use strict";
/* Anthony Gym Tracker — on-device by default (localStorage). Set API_URL to an
   Apps Script /exec URL to use a Google Sheet backend instead. */
var API_URL = "";

/* ---------------- state ---------------- */
var D = null;            // dashboard payload
var tab = "home";
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
  try {
    var v = localStorage.getItem(k);
    if (v == null) return fb;
    try { return JSON.parse(v); } catch (e) { return v; }
  }
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
    var db = { workouts: [], sessions: [], sets: [], meta: {}, program: seedProgram(seed) };
    var wid = 1, eid = 1;
    seed.workouts.forEach(function (w, wi) {
      var exs = w.exercises.map(function (x, xi) {
        return {
          id: eid++, workout_id: wid, name: x.name,
          target_sets: x.target_sets, min_reps: x.min_reps, max_reps: x.max_reps,
          current_weight: (x.current_weight == null ? null : x.current_weight),
          increment: x.increment, position: xi + 1, last_adjustment: "",
          kind: (x.kind === "accessory" ? "accessory" : "main"),
          template: (x.template === "power" ? "power" : "standard"),
          headline: (x.headline === true),
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

/* ---------------- Versioned program ("what Anthony is doing now") ----------------
   The seed ships a program object {name, version, updated, note, history[]}.
   Every boot compares the seed's program version to the stored one; when the
   seed is newer, exercises merge by name (working weights ALWAYS preserved),
   removed moves are retired (history keeps resolving), and the seed's own
   history becomes the program history. */
function seedProgram(seed) {
  var p = (seed && seed.program) || {};
  return {
    name: p.name || "My split",
    version: p.version || "2026-10",
    updated: p.updated || "",
    note: p.note || "",
    history: (p.history || []).slice()
  };
}
function normName(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function activeExercises(w) { return (w.exercises || []).filter(function (x) { return !x.retired; }); }

function applyProgramUpdate(seed) {
  var db = Local.db;
  var newP = seedProgram(seed);
  if (db.program && db.program.version === newP.version) return false;
  var eidMax = 0;
  db.workouts.forEach(function (w) {
    w.exercises.forEach(function (x) { if (x.id > eidMax) eidMax = x.id; });
  });
  seed.workouts.forEach(function (sw, wi) {
    var w = null;
    db.workouts.forEach(function (c) { if (c.key === sw.key) w = c; });
    if (!w) {
      w = { id: Local.nextId(db.workouts), key: sw.key, name: sw.name, emphasis: sw.emphasis, position: wi + 1, custom: 0, exercises: [] };
      db.workouts.push(w);
    } else {
      w.name = sw.name; w.emphasis = sw.emphasis; w.position = wi + 1;
    }
    var seen = {};
    sw.exercises.forEach(function (sx, xi) {
      var nm = normName(sx.name);
      var ex = null;
      w.exercises.forEach(function (c) { if (normName(c.name) === nm) ex = c; });
      if (ex) {
        ex.target_sets = sx.target_sets; ex.min_reps = sx.min_reps; ex.max_reps = sx.max_reps;
        ex.increment = sx.increment;
        ex.kind = (sx.kind === "accessory" ? "accessory" : "main");
        ex.template = (sx.template === "power" ? "power" : "standard");
        ex.headline = (sx.headline === true);
        ex.warmup_sets = (sx.warmup_sets == null ? 2 : sx.warmup_sets);
        ex.warmup_pct = (sx.warmup_pct == null ? 60 : sx.warmup_pct);
        ex.warmup_reps = (sx.warmup_reps == null ? 5 : sx.warmup_reps);
        ex.retired = 0; ex.position = xi + 1;
      } else {
        eidMax++;
        w.exercises.push({
          id: eidMax, workout_id: w.id, name: sx.name,
          target_sets: sx.target_sets, min_reps: sx.min_reps, max_reps: sx.max_reps,
          current_weight: (sx.current_weight == null ? null : sx.current_weight),
          increment: sx.increment, position: xi + 1, last_adjustment: "",
          kind: (sx.kind === "accessory" ? "accessory" : "main"),
          template: (sx.template === "power" ? "power" : "standard"),
          headline: (sx.headline === true),
          warmup_sets: (sx.warmup_sets == null ? 2 : sx.warmup_sets),
          warmup_pct: (sx.warmup_pct == null ? 60 : sx.warmup_pct),
          warmup_reps: (sx.warmup_reps == null ? 5 : sx.warmup_reps),
          sessions_since_bump: 0, retired: 0
        });
      }
      seen[nm] = true;
    });
    w.exercises.forEach(function (x) { if (!seen[normName(x.name)]) x.retired = 1; });
  });
  db.program = newP;
  Local.save();
  return true;
}

function maybeApplyProgramUpdate() {
  if (API_URL || !Local.db) return Promise.resolve(false);
  return fetch("seed-routine.json").then(function (r) { return r.ok ? r.json() : null; })
    .then(function (seed) {
      if (!seed || !seed.program) return false;
      if (!Local.db.program) { Local.db.program = seedProgram(seed); Local.save(); return false; }
      if (Local.db.program.version === seed.program.version) return false;
      var ok = applyProgramUpdate(seed);
      if (ok) toast("Program updated to " + seed.program.version + " — your working weights carried over.");
      return ok;
    }).catch(function () { return false; });
}

function programLabel() {
  var p = (Local.db && Local.db.program) || { name: "My split", version: "", updated: "" };
  var bits = [p.name];
  if (p.version) bits.push(vlabel(p.version));
  if (p.updated) bits.push("updated " + p.updated);
  return bits.join(" · ");
}
/* Version labels are plain "v1", "v2", ... — never double the v. */
function vlabel(v) {
  v = String(v == null ? "" : v);
  return v.charAt(0).toLowerCase() === "v" ? v : "v" + v;
}
function fullWorkoutSnapshot() {
  return Local.sortedWorkouts().filter(function (w) { return !w.custom; }).map(function (w) {
    return {
      key: w.key, name: w.name, emphasis: w.emphasis,
      exercises: activeExercises(w).map(function (x) {
        return {
          name: x.name, target_sets: x.target_sets, min_reps: x.min_reps, max_reps: x.max_reps,
          current_weight: x.current_weight, increment: x.increment,
          kind: x.kind, template: x.template, headline: !!x.headline
        };
      })
    };
  });
}

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
    /* Baseline day: no completed session for this workout yet. Establish each
       exercise's working weight from the heaviest set logged — no auto-bump. */
    var baselineW = true;
    db.sessions.forEach(function (s) { if (s.workout_id === w.id && s.completed_at) baselineW = false; });
    w.exercises.forEach(function (x) {
      var logged = db.sets.filter(function (r) { return r.session_id === sid && r.exercise_id === x.id && (r.reps || 0) > 0; });
      if (baselineW) {
        var top = null;
        logged.forEach(function (r) { if (r.weight != null && (top == null || r.weight > top)) top = r.weight; });
        x.current_weight = top;
        x.last_adjustment = top == null ? "—" : "baseline " + top + " lb";
        x.sessions_since_bump = 0;
        return;
      }
      /* Progression judges every rendered working set — the headline lift's
         third set counts too. */
      var expected = workingSets(x, w, false);
      var hit = expected > 0 && logged.length >= expected &&
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
        kind: "main", template: "standard",
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

/* ---------------- Home dashboard ----------------
   Landing tab: welcome, the 10K treadmill challenge, current workout,
   goal timeline, and weight trend — all from on-device data. */
var LS_10K = "ght_10k_v1";
var TREADMILL_TIMER_URL = "https://muse.ai/s/treadmill-timer-xoxb6axmxqavwog";
function get10k() { return lsGet(LS_10K, []); }
function save10k(a) { lsSet(LS_10K, a); }

/* ---------------- waist-to-height target ----------------
   Keep waist under half your height. One number to remember. */
function waistTarget(heightIn) {
  if (heightIn == null || heightIn <= 0) return null;
  return Math.round(heightIn * 0.5 * 10) / 10;
}
function waistRatio(waistIn, heightIn) {
  if (waistIn == null || heightIn == null || heightIn <= 0) return null;
  return waistIn / heightIn;
}

function dayGreeting() {
  var h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dashStat(value, label) {
  return '<div class="dash-stat"><strong>' + esc(String(value)) + "</strong><span>" + esc(label) + "</span></div>";
}

function challengeCard() {
  var card = el('<div class="dash-card"></div>');
  card.appendChild(el('<div class="dash-kicker">CHALLENGE</div><h2>10K Steps in an Hour</h2>' +
    '<p class="dim">Treadmill · 6 × 10-minute blocks. Log every attempt — completions are what count.</p>'));
  var atts = get10k().slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  var done = atts.filter(function (a) { return a.completed; }).length;
  var last = atts.length ? atts[atts.length - 1] : null;
  card.appendChild(el('<div class="dash-stats">' +
    dashStat(atts.length, "attempts") + dashStat(done, "completed") +
    dashStat(last ? fmtDate(last.date) : "—", "last try") + "</div>"));

  var btnRow = el('<div class="dash-actions"></div>');
  var timerLink = el('<a class="ghost-button" href="' + TREADMILL_TIMER_URL + '" target="_blank" rel="noopener">Open treadmill timer</a>');
  btnRow.appendChild(timerLink);
  var logBtn = el('<button class="primary-button">Log attempt</button>');
  btnRow.appendChild(logBtn);
  card.appendChild(btnRow);

  var form = el('<div class="challenge-form" hidden></div>');
  var dRow = el('<div class="cf-row"></div>');
  var dinp = el('<input type="date" aria-label="Attempt date">');
  dinp.value = todayStr();
  dRow.appendChild(el("<span>Date</span>")); dRow.appendChild(dinp);
  form.appendChild(dRow);
  var rRow = el('<div class="cf-row"></div>');
  var sel = el('<select aria-label="Result"><option value="yes">Completed the hour</option><option value="no">Attempted — didn\u2019t finish</option></select>');
  rRow.appendChild(el("<span>Result</span>")); rRow.appendChild(sel);
  form.appendChild(rRow);
  var sRow = el('<div class="cf-row"></div>');
  var sinp = el('<input type="number" inputmode="numeric" min="0" placeholder="e.g. 10250" aria-label="Steps">');
  sRow.appendChild(el("<span>Steps</span>")); sRow.appendChild(sinp);
  form.appendChild(sRow);
  var nRow = el('<div class="cf-row"></div>');
  var ninp = el('<input type="text" placeholder="How\u2019d it feel? (optional)" aria-label="Note">');
  nRow.appendChild(el("<span>Note</span>")); nRow.appendChild(ninp);
  form.appendChild(nRow);
  var fBtns = el('<div class="dash-actions"></div>');
  var save = el('<button class="primary-button">Save</button>');
  var cancel = el('<button class="ghost-button">Cancel</button>');
  fBtns.appendChild(save); fBtns.appendChild(cancel);
  form.appendChild(fBtns);
  card.appendChild(form);
  logBtn.addEventListener("click", function () { form.hidden = !form.hidden; });
  cancel.addEventListener("click", function () { form.hidden = true; });
  save.addEventListener("click", function () {
    if (!dinp.value) { toast("Pick a date."); return; }
    var steps = sinp.value.trim() === "" ? null : Math.max(0, parseInt(sinp.value, 10) || 0);
    var all = get10k();
    all.push({ id: Date.now(), date: dinp.value, completed: sel.value === "yes", steps: steps, note: ninp.value.trim() });
    save10k(all);
    toast("Attempt logged. Nice work.");
    render();
  });

  if (atts.length) {
    var list = el('<div class="challenge-list"></div>');
    atts.slice(-4).reverse().forEach(function (a) {
      list.appendChild(el('<div class="challenge-row"><span>' + esc(fmtDate(a.date)) + "</span>" +
        '<strong class="' + (a.completed ? "done" : "tried") + '">' + (a.completed ? "Completed" : "Attempted") + "</strong>" +
        "<span>" + (a.steps != null ? esc(String(a.steps)) + " steps" : "") + "</span></div>"));
    });
    card.appendChild(list);
  }
  return card;
}

function nextWorkoutCard() {
  var next = null;
  D.workouts.forEach(function (w) { if (w.id === D.next_workout_id) next = w; });
  if (!next) next = D.workouts[0];
  var card = el('<div class="dash-card"></div>');
  card.appendChild(el('<div class="dash-kicker">TRAINING</div>'));
  if (!next) {
    card.appendChild(el('<p class="dim">No workouts yet.</p>'));
    return card;
  }
  if (D.active_session) {
    card.appendChild(el("<h2>Workout in progress</h2>" + '<p class="dim">Pick up right where you left off.</p>'));
    var rb = el('<button class="primary-button">Resume workout</button>');
    rb.addEventListener("click", function () { setTab("train"); });
    card.appendChild(rb);
    return card;
  }
  var baselineNext = isBaselineWorkout(next);
  var n = 0;
  next.exercises.forEach(function (e) { n += workingSets(e, next, baselineNext); });
  card.appendChild(el("<h2>" + esc(next.name) + "</h2>" +
    '<p class="dim">' + esc(next.emphasis || "") + " · " + next.exercises.length + " moves · " + n +
    (baselineNext ? " sets — first time, find your weights" : " working sets") + "</p>"));
  var sb = el('<button class="primary-button">Start ' + esc(next.name) + "</button>");
  sb.addEventListener("click", function () {
    sb.disabled = true;
    startWorkout(next.id).then(function () { setTab("train"); });
  });
  var vb = el('<button class="ghost-button">Preview</button>');
  vb.addEventListener("click", function () { setTab("train"); });
  var row = el('<div class="dash-actions"></div>');
  row.appendChild(sb); row.appendChild(vb);
  card.appendChild(row);
  return card;
}

function goalTimelineCard() {
  var card = el('<div class="dash-card"></div>');
  card.appendChild(el('<div class="dash-kicker">GOAL TIMELINE</div>'));
  var p = getProfile();
  if (!p || !p.goal) {
    card.appendChild(el("<h2>No goal set yet</h2>" + '<p class="dim">Set a goal and deadline on the Body tab — your timeline lives here.</p>'));
    var sb = el('<button class="ghost-button">Set goal</button>');
    sb.addEventListener("click", function () { setTab("body"); });
    card.appendChild(sb);
    return card;
  }
  var label = GOAL_LABELS[p.goal] || p.goal;
  var sub = "", bar = "";
  if (p.deadline) {
    var left = daysUntil(p.deadline);
    sub = esc(fmtDate(p.deadline)) + " · " + (left >= 0 ? left + " days left" : "deadline passed");
    if (p.created_at && left >= 0) {
      var t0 = new Date(p.created_at).getTime();
      var t1 = new Date(p.deadline + "T12:00:00").getTime();
      var pct = Math.max(0, Math.min(100, Math.round((Date.now() - t0) / Math.max(1, t1 - t0) * 100)));
      bar = '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<p class="dim">' + pct + "% of the timeline used</p>";
    }
  } else {
    sub = "No deadline set.";
  }
  card.appendChild(el("<h2>" + esc(label) + "</h2>" + '<p class="dim">' + sub + "</p>" + bar));
  return card;
}

function waistCard() {
  var card = el('<div class="dash-card"></div>');
  card.appendChild(el('<div class="dash-kicker">WAIST TARGET</div>'));
  var m = latestMeas() || {};
  var h = m.height, w = m.waist;
  if (h == null || w == null) {
    card.appendChild(el("<h2>—</h2>" + '<p class="dim">Add your height and waist on the Body tab — your target is half your height.</p>'));
    var sb = el('<button class="ghost-button">Add measurements</button>');
    sb.addEventListener("click", function () { setTab("body"); });
    card.appendChild(sb);
    return card;
  }
  var target = waistTarget(h);
  var ratio = waistRatio(w, h);
  var pct = Math.round(ratio * 100);
  var over = ratio >= 0.5;
  card.appendChild(el('<div class="weight-big"><strong>' + esc(String(w)) + '</strong><span>in · target ' + esc(String(target)) + ' in</span></div>' +
    '<p class="dim">Waist is ' + pct + "% of height — " + (over ? "over the line" : "under the line") + "</p>" +
    '<div class="progress-track"><div class="progress-fill" style="width:' + Math.min(100, pct) + "%;" + (over ? "background:#e8c547;" : "") + '"></div></div>'));
  if (over) {
    card.appendChild(el('<p class="dim" style="margin-top:10px">Over half your height — 2–3 treadmill 10K sessions a week moves this fastest.</p>'));
  }
  return card;
}

function weightCard() {
  var card = el('<div class="dash-card"></div>');
  card.appendChild(el('<div class="dash-kicker">WEIGHT</div>'));
  var ms = getMeas().filter(function (m) { return m.weight != null; });
  if (!ms.length) {
    card.appendChild(el("<h2>—</h2>" + '<p class="dim">Log a check-in on the Body tab — your trend lives here.</p>'));
  } else {
    var first = ms[0], lastM = ms[ms.length - 1];
    var dTxt;
    if (ms.length < 2) {
      dTxt = "first weigh-in";
    } else {
      var d = Math.round((lastM.weight - first.weight) * 10) / 10;
      dTxt = (d > 0 ? "+" : "") + d + " lb since " + fmtDate(first.date);
    }
    var extra = "";
    var prof = getProfile();
    var tw = prof && prof.target_weight !== "" && prof.target_weight != null ? Number(prof.target_weight) : null;
    if (tw && tw > 0) {
      var toGo = Math.round((lastM.weight - tw) * 10) / 10;
      if (toGo > 0) {
        extra = '<p class="dim">' + esc(String(toGo)) + " lb to target (" + esc(String(tw)) + " lb)</p>";
        if (first.weight !== tw) {
          var tpct = Math.max(0, Math.min(100, Math.round((first.weight - lastM.weight) / (first.weight - tw) * 100)));
          extra += '<div class="progress-track"><div class="progress-fill" style="width:' + tpct + '%"></div></div>';
        }
      } else {
        extra = '<p class="dim">Target hit — ' + esc(String(tw)) + " lb.</p>";
      }
    }
    card.appendChild(el('<div class="weight-big"><strong>' + esc(String(lastM.weight)) + "</strong><span>lb</span></div>" +
      '<p class="dim">' + esc(dTxt) + " · " + esc(fmtDate(lastM.date)) + "</p>" + extra));
  }
  var b = el('<button class="ghost-button">Weigh in</button>');
  b.addEventListener("click", function () { setTab("body"); });
  card.appendChild(b);
  return card;
}

function homeView() {
  var s = el('<section class="page-section"></section>');
  var name = (lsGet(LS_USER_NAME, "") || "").trim();
  s.appendChild(el('<div class="dash-hero"><span class="hero-metal">HOME</span><h1>' +
    esc(dayGreeting() + (name ? ", " + name : "")) + ".</h1>" +
    "<p>" + esc(fmtDate(todayStr())) + "</p></div>"));
  var grid = el('<div class="dash-grid"></div>');
  grid.appendChild(challengeCard());
  grid.appendChild(nextWorkoutCard());
  grid.appendChild(goalTimelineCard());
  grid.appendChild(waistCard());
  grid.appendChild(weightCard());
  s.appendChild(grid);
  var nudge = checkinNudge();
  if (nudge) s.appendChild(nudge);
  return s;
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
  var baselineNext = isBaselineWorkout(next);
  var nextExs = activeExercises(next);
  var setsForNext = function (e) { return workingSets(e, next, baselineNext); };
  var totalSets = nextExs.reduce(function (s, e) { return s + setsForNext(e); }, 0);
  var prog = (Local.db && Local.db.program) || null;

  var s = el("<section></section>");
  var hero = el(
    '<div class="next-hero">' +
      '<div class="hero-metal">' + esc((prog ? prog.name : "My split").toUpperCase()) + (prog && prog.version ? " · " + esc(vlabel(prog.version).toUpperCase()) : "") + "</div>" +
      "<h1>" + esc(next.name) + "</h1>" +
      '<p class="hero-emphasis">' + esc(next.emphasis) + (prog && prog.updated ? ' <span class="hero-updated">· split updated ' + esc(prog.updated) + "</span>" : "") + "</p>" +
      '<div class="hero-stats"><div><strong>' + nextExs.length + "</strong><span>moves</span></div>" +
      "<div><strong>" + totalSets + "</strong><span>" + (baselineNext ? "sets" : "working sets") + "</span></div></div>" +
      '<button class="primary-button primary-button--light">Start ' + esc(next.name) + "</button>" +
    "</div>"
  );
  hero.querySelector("button").addEventListener("click", function () { startWorkout(next.id); });
  s.appendChild(hero);

  var nudge = checkinNudge();
  if (nudge) s.appendChild(nudge);
  var rnudge = reportNudge();
  if (rnudge) s.appendChild(rnudge);

  var head = el(
    '<div class="section-heading"><div><span>THE WORK</span><h2>Today\u2019s order</h2></div>' +
    "<p>" + (baselineNext ? "First time — plain sets to find your weights." : "Last working loads are ready.") + "</p></div>"
  );
  s.appendChild(head);

  var list = el('<div class="preview-list"></div>');
  nextExs.forEach(function (e, i) {
    list.appendChild(el(
      '<div class="preview-row">' +
        '<span class="preview-index">' + String(i + 1).padStart(2, "0") + "</span>" +
        "<div><strong>" + esc(e.name) + "</strong><span>" + setsForNext(e) + " × " + e.min_reps + "\u2013" + e.max_reps + "</span></div>" +
        '<div class="preview-weight"><strong>' + (baselineNext || e.current_weight === null ? "—" : esc(e.current_weight)) + "</strong><span>" +
        (baselineNext ? "you'll set" : (e.current_weight === null ? "set lb" : "lb")) + "</span></div>" +
      "</div>"
    ));
  });
  s.appendChild(list);

  /* Full split picker — every day of the current program, tappable. */
  var pickHead = el(
    '<div class="section-heading"><div><span>THE SPLIT</span><h2>Pick your day</h2></div>' +
    "<p>" + esc(programLabel()) + "</p></div>"
  );
  s.appendChild(pickHead);
  var pickList = el('<div class="preview-list"></div>');
  Local.sortedWorkouts().forEach(function (w, i) {
    var isNext = w.id === next.id;
    var wExs = activeExercises(w);
    var row = el(
      '<button class="preview-row day-pick' + (isNext ? " day-pick--next" : "") + '">' +
        '<span class="preview-index">' + String(i + 1).padStart(2, "0") + "</span>" +
        "<div><strong>" + esc(w.name) + (w.custom ? ' <span class="custom-tag">custom</span>' : "") + (isNext ? ' <span class="next-tag">next</span>' : "") + "</strong><span>" + esc(w.emphasis || "") + "</span></div>" +
        '<div class="preview-weight"><strong>' + wExs.length + "</strong><span>moves</span></div>" +
      "</button>"
    );
    row.addEventListener("click", function () { startWorkout(w.id); });
    pickList.appendChild(row);
  });
  s.appendChild(pickList);
  return s;
}

function startWorkout(workoutId) {
  return api("startWorkout", { workout_id: workoutId })
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

function setRowEl(active, exercise, setNumber, onProgress, blankWeight) {
  var saved = findSavedSet(active, exercise.id, setNumber);
  var weight = saved && saved.weight != null ? String(saved.weight)
    : (blankWeight || exercise.current_weight == null ? "" : String(exercise.current_weight));
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

/* ---------------- baseline day ----------------
   First time a workout day is done on this device (no completed session for
   it yet), keep it old-school: no warm-up rows, no working-set structure —
   just plain sets so the user can find their weights. Main lifts get 3 sets,
   accessory lifts get 2. Finishing a baseline day establishes each exercise's
   working weight from the heaviest set logged. */
function exerciseKind(e) { return e.kind === "accessory" ? "accessory" : "main"; }
function baselineSets(e) { return exerciseKind(e) === "accessory" ? 2 : 3; }

/* ---------------- headline lift ----------------
   Research verdict: two hard working sets are legitimate for strength but
   lean for hypertrophy — the day's headline compound gets a third working
   set. Flagged explicitly in seed data; for custom workouts or older saved
   data with no flags, the first standard main lift headlines — unless the
   day is power-emphasis, where the power work already runs higher set
   counts and plays by its own rules. */
function isHeadline(e, workout) {
  if (!workout || e.template === "power" || exerciseKind(e) !== "main") return false;
  var flagged = false, isIt = false;
  workout.exercises.forEach(function (x) {
    if (x.headline === true) { flagged = true; if (x.id === e.id) isIt = true; }
  });
  if (flagged) return isIt;
  var hasPower = workout.exercises.some(function (x) { return x.template === "power"; });
  if (hasPower) return false;
  for (var i = 0; i < workout.exercises.length; i++) {
    var x = workout.exercises[i];
    if (exerciseKind(x) === "main" && x.template !== "power") return x.id === e.id;
  }
  return false;
}
/* Working-set count for one exercise on a training day. Baseline day keeps
   the plain 3/2 logging; power-template lifts keep their own set counts;
   the headline lift gets +1 working set per the research. */
function workingSets(e, workout, baseline) {
  if (baseline) return baselineSets(e);
  if (e.template === "power") return e.target_sets;
  if (isHeadline(e, workout)) return e.target_sets + 1;
  return e.target_sets;
}
function isBaselineWorkout(workout) {
  if (!workout || !Local.db) return false;
  var done = false;
  Local.db.sessions.forEach(function (s) {
    if (s.workout_id === workout.id && s.completed_at) done = true;
  });
  return !done;
}

function workoutLogger() {
  var active = D.active_session;
  var workout = null;
  D.workouts.forEach(function (w) { if (w.id === active.workout_id) workout = w; });
  if (!workout) return trainHome();

  var baseline = isBaselineWorkout(workout);
  var setsFor = function (e) { return workingSets(e, workout, baseline); };
  var liveExs = activeExercises(workout);
  var total = liveExs.reduce(function (s, e) { return s + setsFor(e); }, 0);
  var s = el("<section class='workout-live'></section>");
  var hero = el(
    '<div class="live-hero"><div><span class="live-dot"></span><span>' + (baseline ? "BASELINE DAY — FIND YOUR WEIGHTS" : "IN PROGRESS") + "</span>" +
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
  var seenMain = false; /* first main lift of the day gets full warm-ups; later mains get one feeler */
  liveExs.forEach(function (e, i) {
    var card = el(
      '<article class="exercise-log"><div class="exercise-head">' +
        '<div class="exercise-index">' + String(i + 1).padStart(2, "0") + "</div>" +
        '<div class="exercise-title"><h2>' + esc(e.name) + "</h2><p>" + setsFor(e) + " × " + e.min_reps + "\u2013" + e.max_reps + (e.template === "power" ? " · power (fresh reps, full rest — not to failure)" : ((!baseline && isHeadline(e, workout)) ? " · headline lift" : "")) + "</p></div>" +
        '<div class="working-weight"><strong>' + esc(formatWeight(e.current_weight)) + "</strong><span>" + esc(e.last_adjustment || "") + "</span></div>" +
      "</div>" +
      '<div class="set-headings"><span>SET</span><span>WEIGHT</span><span>REPS</span><span></span></div></article>'
    );
    /* Warm-up sets render first (display-only, never logged): 2 × 5 @ 60%,
       rounded down to the nearest 2.5 lb. No warm-up load for bodyweight.
       Skipped entirely on baseline day and for power-template lifts (cleans,
       jumps warm up their own way). Accessory lifts skip them too — one feeler
       is plenty once you're warm. Only the day's first main lift gets the full
       ramp; later main lifts get a single feeler set. */
    var isPower = e.template === "power";
    var wSets = (e.warmup_sets == null ? 2 : e.warmup_sets);
    var wPct = (e.warmup_pct == null ? 60 : e.warmup_pct);
    var wReps = (e.warmup_reps == null ? 5 : e.warmup_reps);
    if (!baseline && !isPower && exerciseKind(e) === "main" && wSets > 0 && e.current_weight != null && e.current_weight > 0) {
      var nW = seenMain ? 1 : wSets;
      var wLb = Math.floor((e.current_weight * wPct / 100) / 2.5) * 2.5;
      for (var w = 1; w <= nW; w++) card.appendChild(warmupRowEl(w, wLb, wReps));
    }
    if (exerciseKind(e) === "main") seenMain = true;
    for (var n = 1; n <= setsFor(e); n++) {
      card.appendChild(setRowEl(active, e, n, updateProgress, baseline));
    }
    stack.appendChild(card);
  });
  s.appendChild(stack);
  updateProgress();

  var dock = el(
    '<div class="finish-dock"><p>' + (baseline
      ? "First time through — log what you lift and your working weights get set for next time."
      : "Hit the top of every rep range and next session\u2019s load goes up automatically.") + "</p>" +
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
function exerciseSetting(e, workout) {
  var row = el(
    '<div class="setting-row">' +
      '<div class="setting-name"><strong>' + esc(e.name) + "</strong><span>" + e.target_sets + " × " + e.min_reps + "\u2013" + e.max_reps + (isHeadline(e, workout) ? " · headline +1 set" : "") + "</span></div>" +
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
  var prog = (Local.db && Local.db.program) || { name: "My split", version: "", updated: "", note: "", history: [] };
  var s = el(
    '<section class="page-section"><div class="page-title"><span>LOAD CONTROL</span><h1>Simple progression.</h1>' +
    "<p>Hit the top of the range on every set: add the listed increment next time. Miss it: hold the load and beat your reps.</p></div>" +
    '<div class="rule-strip"><strong>Top of range across all sets</strong><span>\u2192 automatic increase</span></div>' +
    '<div class="program-card"><div class="program-card__meta"><span>WHAT I\u2019M DOING NOW</span></div>' +
    "<h2>" + esc(prog.name) + "</h2>" +
    "<p>" + esc([prog.version ? vlabel(prog.version) : "", prog.updated ? "updated " + prog.updated : ""].filter(Boolean).join(" · ")) + "</p>" +
    (prog.note ? "<p class=\"program-card__note\">" + esc(prog.note) + "</p>" : "") +
    "</div></section>"
  );
  /* Version history — every program change, newest first. */
  if (prog.history && prog.history.length) {
    var hHead = el('<div class="section-heading"><div><span>ARCHIVE</span><h2>Past versions</h2></div><p>What the split used to look like.</p></div>');
    s.appendChild(hHead);
    var hList = el('<div class="program-history"></div>');
    prog.history.forEach(function (h) {
      var moves = [];
      var full = h.workouts || [];
      if (full.length) {
        full.forEach(function (w) {
          var exLines = (w.exercises || []).map(function (x) {
            var det = x.target_sets + " × " + x.min_reps + "\u2013" + x.max_reps +
              (x.current_weight == null ? "" : " @ " + x.current_weight + " lb") +
              (x.headline ? " · headline" : "");
            return esc(x.name) + " — " + esc(det);
          });
          moves.push("<div><strong>" + esc(w.name) + "</strong><span>" + exLines.join("<br>") + "</span></div>");
        });
      } else {
        (h.snapshot || []).forEach(function (w) {
          moves.push("<div><strong>" + esc(w.name) + "</strong><span>" + esc((w.exercises || []).join(" · ")) + "</span></div>");
        });
      }
      hList.appendChild(el(
        '<div class="history-entry"><div class="history-entry__head"><strong>' + esc(vlabel(h.version)) + "</strong><span>" + esc(h.updated || "") + "</span></div>" +
        (h.note ? '<p class="history-entry__note">' + esc(h.note) + "</p>" : "") +
        '<div class="history-entry__moves">' + moves.join("") + "</div></div>"
      ));
    });
    s.appendChild(hList);
  }
  var wHead = el('<div class="section-heading"><div><span>CURRENT</span><h2>This version\u2019s workouts</h2></div><p>Tap a day to adjust its loads.</p></div>');
  s.appendChild(wHead);
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
      activeExercises(w).forEach(function (e) { list.appendChild(exerciseSetting(e, w)); });
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
  { k: "height", label: "Height", unit: "in" },
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
  OB = { step: 1, stats: {}, goal: null, deadline: "", name: "", tweight: "" };
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
    s = obShell("The basics", "Four numbers and your name — that's all we need to set your targets.");
    var form = el('<div class="ob-simple"></div>');
    function obField(label, unit, opts) {
      opts = opts || {};
      var lab = el('<label class="ob-field"><span>' + esc(label) + (unit ? " (" + esc(unit) + ")" : "") + "</span></label>");
      var inp = document.createElement("input");
      if (opts.text) { inp.type = "text"; } else { inp.type = "number"; inp.step = "0.25"; inp.min = "0"; inp.inputMode = "decimal"; }
      if (opts.placeholder) inp.placeholder = opts.placeholder;
      inp.value = opts.value || "";
      inp.setAttribute("aria-label", label);
      lab.appendChild(inp);
      form.appendChild(lab);
      return inp;
    }
    var nameI = obField("Your name", "", { text: true, value: OB.name, placeholder: "e.g. Alex" });
    var hI = obField("Height", "in", { value: OB.stats.height || "", placeholder: "e.g. 72" });
    var wI = obField("Weight", "lb", { value: OB.stats.weight || "", placeholder: "e.g. 195" });
    var waI = obField("Waist at navel", "in", { value: OB.stats.waist || "", placeholder: "e.g. 34" });
    var twI = obField("Target weight", "lb", { value: OB.tweight, placeholder: "optional" });
    s.appendChild(form);
    s.appendChild(el('<p class="ob-sub">Waist target is simple: keep it under half your height. At 72" tall, that\u2019s 36".</p>'));
    var row = el('<div class="ob-row"></div>');
    var next = el('<button class="primary-button">Continue</button>');
    next.addEventListener("click", function () {
      OB.name = nameI.value.trim();
      OB.stats = {};
      if (hI.value.trim() !== "" && !isNaN(Number(hI.value))) OB.stats.height = Number(hI.value);
      if (wI.value.trim() !== "" && !isNaN(Number(wI.value))) OB.stats.weight = Number(wI.value);
      if (waI.value.trim() !== "" && !isNaN(Number(waI.value))) OB.stats.waist = Number(waI.value);
      OB.tweight = (twI.value.trim() === "" || isNaN(Number(twI.value))) ? "" : Number(twI.value);
      OB.step = 2; renderOnboard();
    });
    row.appendChild(next);
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
    var row2 = el('<div class="ob-row"></div>');
    var back = el('<button class="ghost-button">Back</button>');
    back.addEventListener("click", function () { OB.deadline = dinp.value || ""; OB.step = 1; renderOnboard(); });
    var start = el('<button class="primary-button">Start training</button>');
    start.addEventListener("click", function () {
      if (!OB.goal) { toast("Pick a goal to continue."); return; }
      OB.deadline = dinp.value || "";
      if (OB.name) lsSet(LS_USER_NAME, OB.name);
      saveProfile({ goal: OB.goal, deadline: OB.deadline, target_weight: OB.tweight || "", created_at: new Date().toISOString() });
      var keys = Object.keys(OB.stats);
      if (keys.length) {
        var m = { id: 1, date: todayStr() };
        keys.forEach(function (k) { m[k] = OB.stats[k]; });
        lsSet(LS_MEAS, [m]);
      }
      lsSet(LS_ONBOARD, true);
      document.body.classList.remove("onboarding");
      setTab("home");
      toast("You're in. Let's work.");
    });
    row2.appendChild(back);
    row2.appendChild(start);
    s.appendChild(row2);
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

  /* 1b — waist-to-height: keep waist under half your height */
  var lm = latestMeas() || {};
  var wr = waistRatio(lm.waist, lm.height);
  if (wr != null) {
    if (wr >= 0.5) {
      out.push({ tone: "warn", title: "Waist over half your height",
        body: "Waist is " + Math.round(wr * 100) + "% of height — target is under 50%. 2–3 treadmill 10K sessions a week plus steady lifting moves this fastest." });
    } else if (wr >= 0.45) {
      out.push({ tone: "info", title: "Waist nearing the line",
        body: "Waist is " + Math.round(wr * 100) + "% of height. Under 50% is the target — keep it there." });
    }
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
    if ((x.sessions_since_bump || 0) >= 6) return; /* 6+ gets the deload tweak card instead */
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

/* ---------------- suggested program tweaks ---------------- */
var LS_TWEAKS_DISMISSED = "ght_tweaks_dismissed_v1";
function dismissedTweaks() { return lsGet(LS_TWEAKS_DISMISSED, []); }
function dismissTweak(id) {
  var d = dismissedTweaks();
  if (d.indexOf(id) < 0) { d.push(id); lsSet(LS_TWEAKS_DISMISSED, d); }
}
function exerciseExists(part) {
  var found = false;
  Local.db.workouts.forEach(function (w) {
    w.exercises.forEach(function (x) {
      if (x.name.toLowerCase().indexOf(part.toLowerCase()) >= 0) found = true;
    });
  });
  return found;
}
function findWorkoutFor(matchWords) {
  var workouts = Local.sortedWorkouts(), i, j, k;
  for (i = 0; i < workouts.length; i++) {
    for (j = 0; j < workouts[i].exercises.length; j++) {
      var nm = workouts[i].exercises[j].name.toLowerCase();
      for (k = 0; k < matchWords.length; k++) {
        if (nm.indexOf(matchWords[k]) >= 0) return workouts[i];
      }
    }
  }
  return workouts[0] || null;
}
function addExerciseTo(w, spec) {
  if (!w) return;
  var db = Local.db;
  var eid = Local.nextId(db.workouts.reduce(function (acc, x) { return acc.concat(x.exercises); }, []));
  w.exercises.push({
    id: eid, workout_id: w.id, name: spec.name,
    target_sets: spec.target_sets, min_reps: spec.min_reps, max_reps: spec.max_reps,
    current_weight: null, increment: spec.increment,
    position: w.exercises.length + 1, last_adjustment: "",
    kind: (spec.kind === "accessory" ? "accessory" : "main"),
    template: (spec.template === "power" ? "power" : "standard"),
    warmup_sets: 2, warmup_pct: 60, warmup_reps: 5, sessions_since_bump: 0
  });
  Local.save();
}
function tweakSuggestions() {
  var out = [];
  if (API_URL || !Local.db) return out;
  var dismissed = dismissedTweaks();
  function add(t) {
    if (dismissed.indexOf(t.id) < 0) out.push(t);
  }
  var profile = getProfile();
  var goal = profile && profile.goal;
  var meas = getMeas();

  /* lagging muscle groups (build goal, 3+ check-ins) */
  if (goal === "build" && meas.length >= 3) {
    var a = meas[meas.length - 3], b = meas[meas.length - 1];
    function delta(k) {
      if (a[k] == null || b[k] == null) return null;
      return b[k] - a[k];
    }
    var dChest = delta("chest"), dArm = delta("arm");
    if (dChest != null && dArm != null && dChest >= 0.25 && dArm <= 0 && !exerciseExists("hammer")) {
      add({
        id: "lag-arm-" + b.id,
        title: "Arms lagging behind chest",
        body: "Chest +" + dChest.toFixed(2) + " in lately, arms flat. Add a hammer curl for brachialis size.",
        cta: "Add Hammer Curl",
        apply: function () { addExerciseTo(findWorkoutFor(["curl"]), { name: "Hammer Curl", target_sets: 2, min_reps: 10, max_reps: 15, increment: 2.5 }); }
      });
    }
    if (dChest != null && dArm != null && dArm >= 0.25 && dChest <= 0 && !exerciseExists("fly")) {
      add({
        id: "lag-chest-" + b.id,
        title: "Chest lagging behind arms",
        body: "Arms +" + dArm.toFixed(2) + " in lately, chest flat. Add an incline fly for upper-chest stretch.",
        cta: "Add Incline DB Fly",
        apply: function () { addExerciseTo(findWorkoutFor(["bench", "press", "dip"]), { name: "Incline DB Fly", target_sets: 2, min_reps: 10, max_reps: 15, increment: 2.5 }); }
      });
    }
  }

  /* deload for long-stalled main lifts */
  Local.sortedWorkouts().forEach(function (w) {
    w.exercises.slice(0, 3).forEach(function (x) {
      if (x.current_weight && (x.sessions_since_bump || 0) >= 6) {
        var exId = x.id, ssb = x.sessions_since_bump, cw = x.current_weight;
        var nw = Math.floor(cw * 0.9 / 2.5) * 2.5;
        add({
          id: "deload-" + exId + "-" + ssb,
          title: "Deload " + x.name + "?",
          body: "No bump in " + ssb + " sessions. Drop 10% (" + cw + " → " + nw + " lb) and climb back — most stalls break this way.",
          cta: "Apply deload",
          apply: function () {
            var lx = Local.findExercise(exId);
            if (!lx || !lx.current_weight) return;
            var w2 = Math.floor(lx.current_weight * 0.9 / 2.5) * 2.5;
            lx.current_weight = w2;
            lx.sessions_since_bump = 0;
            lx.last_adjustment = "deload → " + w2 + " lb";
            Local.save();
          }
        });
      }
    });
  });

  return out.slice(0, 3);
}
function tweaksCard() {
  var tweaks = tweakSuggestions();
  if (!tweaks.length) return null;
  var card = el('<div class="tweaks"></div>');
  card.appendChild(el("<h3>Suggested tweaks</h3>"));
  tweaks.forEach(function (t) {
    var d = el('<div class="tweak"><strong>' + esc(t.title) + "</strong><p>" + esc(t.body) + "</p></div>");
    var row = el('<div class="mh-actions"></div>');
    var apply = el('<button class="mh-link mh-save">' + esc(t.cta) + "</button>");
    apply.addEventListener("click", function () {
      t.apply();
      dismissTweak(t.id);
      render();
      toast("Program updated.");
    });
    var no = el('<button class="mh-link">Dismiss</button>');
    no.addEventListener("click", function () { dismissTweak(t.id); render(); });
    row.appendChild(apply);
    row.appendChild(no);
    d.appendChild(row);
    card.appendChild(d);
  });
  return card;
}

/* ---------------- accountability ---------------- */
var LS_PARTNERS = "ght_partners_v1";
var LS_LAST_REPORT = "ght_report_sent_v1";
var LS_USER_NAME = "ght_user_name_v1";
function getPartners() { return lsGet(LS_PARTNERS, []); }

function reportData() {
  var good = [], bad = [];
  var weekAgo = Date.now() - 7 * 864e5;
  var recent = (D.history || []).filter(function (h) { return new Date(h.completed_at).getTime() >= weekAgo; });
  if (recent.length === 0) bad.push("No workouts logged in the last 7 days");
  else if (recent.length < 3) {
    good.push(recent.length + (recent.length === 1 ? " workout" : " workouts") + " logged this week");
    bad.push("Under 3 sessions — consistency is the goal");
  } else {
    good.push(recent.length + " training sessions this week");
  }
  var bumped = [], stalled = [];
  (D.workouts || []).forEach(function (w) {
    w.exercises.forEach(function (x) {
      if (x.last_adjustment && x.last_adjustment.charAt(0) === "+") bumped.push(x.name + " up to " + x.current_weight + " lb");
      if (!API_URL && x.current_weight && (x.sessions_since_bump || 0) >= 4) stalled.push({ name: x.name, n: x.sessions_since_bump });
    });
  });
  bumped.slice(0, 3).forEach(function (b) { good.push(b); });
  stalled.slice(0, 3).forEach(function (s) { bad.push(s.name + " stalled " + s.n + " sessions"); });
  var meas = getMeas(), m = latestMeas();
  if (m) {
    var days = Math.round((Date.now() - new Date(m.date + "T12:00:00").getTime()) / 864e5);
    if (days > 10) bad.push("No measurement check-in for " + days + " days");
    else good.push("Measurement check-in up to date");
    if (meas.length >= 2) {
      var a = meas[meas.length - 2], b2 = meas[meas.length - 1], bits = [];
      ["weight", "chest", "waist", "arm", "thigh"].forEach(function (k) {
        if (a[k] != null && b2[k] != null && b2[k] !== a[k]) {
          var f = null;
          TAPE_FIELDS.forEach(function (x) { if (x.k === k) f = x; });
          bits.push(f.label + " " + (b2[k] > a[k] ? "+" : "") + (Math.round((b2[k] - a[k]) * 4) / 4) + " " + f.unit);
        }
      });
      if (bits.length) good.push("Measurements: " + bits.join(", "));
    }
  } else {
    bad.push("No measurements logged yet");
  }
  return { good: good, bad: bad };
}

function buildReportText() {
  var partners = getPartners();
  var profile = getProfile();
  var userName = lsGet(LS_USER_NAME, "").trim() || "your friend";
  var goal = profile && profile.goal ? GOAL_LABELS[profile.goal] : "not set";
  var r = reportData();
  var lines = [];
  lines.push("Hi " + (partners.length ? partners[0].name : "there") + ",");
  lines.push("");
  lines.push("Here's " + userName + "'s training week:");
  lines.push("");
  lines.push("GOAL: " + goal);
  lines.push("");
  lines.push("THE GOOD");
  if (r.good.length) r.good.forEach(function (g) { lines.push("\u2022 " + g); });
  else lines.push("\u2022 Nothing logged yet — week one starts now.");
  lines.push("");
  lines.push("NEEDS WORK");
  if (r.bad.length) r.bad.forEach(function (b) { lines.push("\u2022 " + b); });
  else lines.push("\u2022 Nothing — clean week.");
  lines.push("");
  lines.push("\u2014 sent from Gym Tracker");
  return { subject: userName + "'s weekly training report", body: lines.join("\n") };
}

function sendReport() {
  var partners = getPartners();
  if (!partners.length) { toast("Add someone first."); return; }
  var r = buildReportText();
  var to = partners.map(function (p) { return encodeURIComponent(p.email); }).join(",");
  lsSet(LS_LAST_REPORT, new Date().toISOString());
  window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent(r.subject) + "&body=" + encodeURIComponent(r.body);
}

function accountabilityCard() {
  var card = el('<div class="account"></div>');
  card.appendChild(el("<h3>Accountability</h3>"));
  card.appendChild(el('<p class="dim">Add someone who gets your weekly report — the good and the bad.</p>'));
  var nameRow = el('<div class="account-row"></div>');
  nameRow.appendChild(el("<span>Your name</span>"));
  var nameInp = document.createElement("input");
  nameInp.type = "text"; nameInp.placeholder = "For the report";
  nameInp.setAttribute("aria-label", "Your name");
  nameInp.value = lsGet(LS_USER_NAME, "");
  nameInp.addEventListener("change", function () { lsSet(LS_USER_NAME, nameInp.value.trim()); });
  nameRow.appendChild(nameInp);
  card.appendChild(nameRow);
  var partners = getPartners();
  partners.forEach(function (p) {
    var row = el('<div class="partner-row"><div><strong>' + esc(p.name) + "</strong><span>" + esc(p.email) + "</span></div></div>");
    var rm = el('<button class="mh-link mh-danger">Remove</button>');
    rm.addEventListener("click", function () {
      lsSet(LS_PARTNERS, getPartners().filter(function (x) { return x.id !== p.id; }));
      render();
      toast("Partner removed.");
    });
    row.appendChild(rm);
    card.appendChild(row);
  });
  var form = el('<div class="partner-form"></div>');
  var nInp = document.createElement("input");
  nInp.type = "text"; nInp.placeholder = "Their name"; nInp.setAttribute("aria-label", "Partner name");
  var eInp = document.createElement("input");
  eInp.type = "email"; eInp.placeholder = "Their email"; eInp.setAttribute("aria-label", "Partner email");
  var addB = el('<button class="primary-button">Hold me accountable</button>');
  addB.addEventListener("click", function () {
    var nm = nInp.value.trim(), em = eInp.value.trim();
    if (!nm || em.indexOf("@") < 0) { toast("Add a name and a valid email."); return; }
    var all = getPartners(), id = 1;
    all.forEach(function (x) { if (x.id >= id) id = x.id + 1; });
    all.push({ id: id, name: nm, email: em });
    lsSet(LS_PARTNERS, all);
    render();
    toast("Accountability partner added.");
  });
  form.appendChild(nInp); form.appendChild(eInp); form.appendChild(addB);
  card.appendChild(form);
  if (partners.length) {
    var last = lsGet(LS_LAST_REPORT, null);
    var sendB = el('<button class="primary-button account-send">Send weekly report</button>');
    sendB.addEventListener("click", sendReport);
    card.appendChild(sendB);
    if (last) card.appendChild(el('<p class="dim last-sent">Last sent ' + esc(fmtDate(last.slice(0, 10))) + "</p>"));
  }
  return card;
}

function reportNudge() {
  var partners = getPartners();
  if (!partners.length) return null;
  var last = lsGet(LS_LAST_REPORT, null);
  var due = !last || (Date.now() - new Date(last).getTime()) > 7 * 864e5;
  if (!due) return null;
  var n = el('<div class="checkin-nudge"><div><strong>Accountability report due</strong><span>Send ' +
    esc(partners[0].name) + " your week — good and bad.</span></div></div>");
  var b = el('<button class="primary-button nudge-btn">Send it</button>');
  b.addEventListener("click", function () { setTab("body"); });
  n.appendChild(b);
  return n;
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
    s.appendChild(measRow(all[i], all[i - 1]));
  }
  return s;
}

function measRow(m, prev) {
  var row = el('<div class="mh-row"></div>');
  row.appendChild(el('<div class="mh-date">' + esc(fmtDate(m.date)) + "</div>"));
  var bits = [];
  TAPE_FIELDS.forEach(function (f) {
    if (m[f.k] == null) return;
    var d = prev && prev[f.k] != null ? fmtDelta(m[f.k] - prev[f.k], f.unit) : "";
    bits.push('<span class="mh-bit"><strong>' + m[f.k] + "</strong> " + f.unit + " " + esc(f.label) + esc(d) + "</span>");
  });
  row.appendChild(el("<div>" + bits.join("") + "</div>"));
  var actions = el('<div class="mh-actions"></div>');
  var editB = el('<button class="mh-link">Edit</button>');
  editB.addEventListener("click", function () { editMeasRow(m, row); });
  var delB = el('<button class="mh-link mh-danger">Delete</button>');
  delB.addEventListener("click", function () {
    if (delB.dataset.armed) {
      lsSet(LS_MEAS, getMeas().filter(function (x) { return x.id !== m.id; }));
      render();
      toast("Check-in deleted.");
    } else {
      delB.dataset.armed = "1";
      delB.textContent = "Tap again to delete";
      setTimeout(function () {
        if (delB.isConnected) { delete delB.dataset.armed; delB.textContent = "Delete"; }
      }, 3000);
    }
  });
  actions.appendChild(editB);
  actions.appendChild(delB);
  row.appendChild(actions);
  return row;
}

function editMeasRow(m, row) {
  row.innerHTML = "";
  row.appendChild(el('<div class="mh-date">' + esc(fmtDate(m.date)) + " — editing</div>"));
  var form = el('<div class="mh-edit"></div>');
  var inputs = {};
  TAPE_FIELDS.forEach(function (f) {
    if (m[f.k] == null) return;
    var lab = el('<label class="mh-edit-field"><span>' + esc(f.label) + " (" + f.unit + ")</span></label>");
    var inp = document.createElement("input");
    inp.type = "number"; inp.step = "0.25"; inp.min = "0"; inp.value = m[f.k];
    inputs[f.k] = inp;
    lab.appendChild(inp);
    form.appendChild(lab);
  });
  row.appendChild(form);
  var btns = el('<div class="mh-actions"></div>');
  var save = el('<button class="mh-link mh-save">Save</button>');
  save.addEventListener("click", function () {
    var vals = {};
    Object.keys(inputs).forEach(function (k) {
      var v = inputs[k].value.trim();
      if (v !== "" && !isNaN(Number(v))) vals[k] = Number(v);
    });
    var updated = getMeas().map(function (x) {
      if (x.id !== m.id) return x;
      var nx = { id: x.id, date: x.date };
      Object.keys(vals).forEach(function (k) { nx[k] = vals[k]; });
      return nx;
    });
    lsSet(LS_MEAS, updated);
    render();
    toast("Check-in updated.");
  });
  var cancel = el('<button class="mh-link">Cancel</button>');
  cancel.addEventListener("click", render);
  btns.appendChild(save);
  btns.appendChild(cancel);
  row.appendChild(btns);
}

function bodyView() {
  var s = el('<section class="page-section"></section>');
  s.appendChild(pageTitle("BODY", "Check-ins, measurements, and what they're telling you."));
  s.appendChild(goalCard());
  var tc = tweaksCard();
  if (tc) s.appendChild(tc);
  s.appendChild(insightsCard());
  s.appendChild(checkinForm());
  s.appendChild(accountabilityCard());
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
  if (tab === "home") v = homeView();
  else if (tab === "train") v = D.active_session ? workoutLogger() : trainHome();
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
  prep.then(refresh).then(function () { return maybeApplyProgramUpdate(); }).then(function () {
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
