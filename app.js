"use strict";
/* Anthony Gym Tracker — static front end, Google Sheet brain via Apps Script.
   SET THIS to the Apps Script web-app /exec URL after deploying Code.gs. */
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

/* ---------------- API ---------------- */
function api(action, params) {
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
  if (!next) return emptyState("—", "Loading your routine.", "Your Upper A / Upper B rotation will be ready in a moment.");
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
  else if (tab === "history") v = historyView();
  else if (tab === "program") v = programView();
  else v = createView();
  main.appendChild(v);
}

function boot() {
  if (!API_URL) {
    $("main").appendChild(emptyState("!", "Not connected yet.", "Add your Apps Script web-app URL to API_URL in app.js, then reload."));
    return;
  }
  $("main").appendChild(emptyState("—", "Loading your routine.", "Your Upper A / Upper B rotation will be ready in a moment."));
  refresh().then(function () {
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
