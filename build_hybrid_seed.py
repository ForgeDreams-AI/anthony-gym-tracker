import json, pathlib, subprocess

p = pathlib.Path.home() / "workspace/anthony-gym-tracker/seed-routine.json"
# Always archive from the committed v1 seed, never from the working file
# (re-running this script must not archive v2 into its own history).
old = json.loads(subprocess.run(
    ["git", "-C", str(p.parent), "show", "HEAD:seed-routine.json"],
    capture_output=True, text=True, check=True).stdout)
assert old["program"]["version"] == "v1", old["program"]["version"]

def ex(name, sets, mn, mx, inc=5.0, kind="main", template="standard", note=None, warm=2):
    e = {"name": name, "target_sets": sets, "min_reps": mn, "max_reps": mx,
         "current_weight": None, "increment": inc, "kind": kind, "template": template,
         "warmup_sets": warm, "warmup_pct": 60, "warmup_reps": 5, "exact_sets": True}
    if note: e["note"] = note
    return e

# HYBRID (Anthony's call 2026-10-20): boss's 6-day structure and philosophy —
# every muscle 2x/week, traditional up top, athletic below, his set counts and
# RPE caps — blended with Anthony's own lifts from his ChatGPT-built 6-day
# (Flat DB Press, Hack Squat, Seated DB Press, shrugs/face pulls, calf + ab
# finishers). Sources: boss screenshots + Anthony's screenshots, both 2026-10-20.
workouts = [
  {"key": "upper-a", "name": "Day 1 — Push", "emphasis": "Upper-Chest Emphasis", "exercises": [
    ex("Incline Smith Press", 4, 6, 8),
    ex("Flat DB Press", 3, 8, 10),
    ex("Machine Chest Press", 2, 10, 12),
    ex("Incline DB Fly", 3, 10, 15, 2.5, "accessory"),
    ex("Cable Lateral Raise", 4, 12, 15, 2.5, "accessory"),
    ex("Overhead Rope Triceps Extension", 3, 10, 12, 2.5, "accessory"),
    ex("Cable Pushdown", 3, 12, 15, 2.5, "accessory"),
  ]},
  {"key": "upper-b", "name": "Day 2 — Pull", "emphasis": "Thickness Emphasis", "exercises": [
    ex("Chest-Supported T-Bar Row", 4, 8, 10),
    ex("Weighted Pull-Ups", 4, 6, 8),
    ex("Seated Cable Row", 3, 10, 12),
    ex("Neutral-Grip Pulldown", 3, 12, 12),
    ex("Reverse Pec Deck", 4, 12, 15, 2.5, "accessory"),
    ex("EZ-Bar Curl", 4, 8, 10),
    ex("Incline DB Curl", 3, 10, 12, 2.5, "accessory"),
  ]},
  {"key": "lower-power", "name": "Day 3 — Lower", "emphasis": "Power + Strength", "exercises": [
    ex("Box Jump", 3, 3, 3, 0.0, "main", "power", "Maximum explosiveness", 0),
    ex("Clean Pull OR Clean Shrug", 4, 3, 3, 5.0, "main", "power", "RPE 6–8 · explosive", 0),
    ex("Barbell Back Squat", 3, 5, 6, 5.0, "main", "standard", "RPE 7–8"),
    ex("Hack Squat", 3, 8, 10),
    ex("Romanian Deadlift", 3, 6, 8, 10.0, "main", "standard", "RPE 6–7"),
    ex("Standing Calf Raise", 4, 12, 15, 5.0, "accessory", "standard", "Moderate-heavy"),
    ex("Hanging Leg Raises", 3, 15, 15, 0.0, "accessory", "standard", None, 0),
  ]},
  {"key": "upper-c", "name": "Day 4 — Push", "emphasis": "Delt + Arms Emphasis", "exercises": [
    ex("Seated DB Shoulder Press", 4, 8, 10),
    ex("Incline Machine Press", 3, 10, 12),
    ex("DB Lateral Raise", 4, 10, 15, 2.5, "accessory"),
    ex("Machine Lateral Raise", 3, 15, 20, 2.5, "accessory"),
    ex("Bent-Over DB Rear-Delt Fly", 3, 12, 15, 2.5, "accessory"),
    ex("Pec Deck Fly", 2, 12, 15, 2.5, "accessory"),
    ex("EZ-Bar Skull Crusher", 3, 8, 12, 2.5, "accessory"),
    ex("Straight-Bar Triceps Pushdown", 3, 12, 15, 2.5, "accessory"),
  ]},
  {"key": "day-5-pull", "name": "Day 5 — Pull", "emphasis": "Lat/Width + Biceps", "exercises": [
    ex("Plate-Loaded Iso-Lateral Pulldown", 4, 8, 10),
    ex("Single-Arm Lat Pulldown", 3, 10, 12, 2.5, "main", "standard", "reps per side"),
    ex("Single-Arm DB Row", 3, 10, 10, 5.0, "main", "standard", "reps per side"),
    ex("Cable Lateral Raise", 3, 15, 20, 2.5, "accessory"),
    ex("Dumbbell Shrugs", 3, 12, 15, 5.0, "accessory"),
    ex("Face Pulls", 3, 15, 15, 2.5, "accessory"),
    ex("Preacher Curl", 3, 8, 10, 2.5, "accessory"),
    ex("Hammer Curl", 3, 10, 12, 2.5, "accessory"),
  ]},
  {"key": "lower-explosive", "name": "Day 6 — Lower", "emphasis": "Light Athletic", "exercises": [
    ex("Snatch Shrug", 3, 3, 3, 5.0, "main", "power", "RPE ~6 · FAST", 0),
    ex("Reverse Lunge", 2, 6, 6, 5.0, "main", "standard", "RPE 6–7 · reps per leg"),
    ex("DB Lateral Lunge", 3, 6, 8, 5.0, "main", "standard", "Controlled/athletic · reps per side"),
    ex("Seated Leg Curl", 3, 10, 12, 5.0, "accessory"),
    ex("Stiff-Leg Deadlift", 2, 8, 10, 10.0, "main", "standard", "RPE 6–7"),
    ex("Copenhagen Plank", 2, 20, 30, 0.0, "accessory", "standard", "sec/side · Controlled", 0),
    ex("Seated Calf Raise", 3, 15, 20, 5.0, "accessory"),
    ex("Cable Crunch", 3, 20, 20, 5.0, "accessory", "standard", None, 0),
  ]},
]

# Archive v1 in full (from the outgoing seed), newest first, then the old v0 entry.
v1_workouts = []
for w in old["workouts"]:
    v1_workouts.append({
        "key": w["key"], "name": w["name"], "emphasis": w.get("emphasis", ""),
        "exercises": [
            {"name": x["name"], "target_sets": x["target_sets"], "min_reps": x["min_reps"],
             "max_reps": x["max_reps"], "current_weight": x.get("current_weight"),
             "increment": x["increment"], "kind": x.get("kind", "main"),
             "template": x.get("template", "standard"), "headline": bool(x.get("headline"))}
            for x in w["exercises"]
        ],
    })
history = [{
    "version": old["program"]["version"], "updated": old["program"]["updated"],
    "note": old["program"]["note"], "workouts": v1_workouts,
}] + old["program"].get("history", [])

new = {
  "workouts": workouts,
  "program": {
    "name": "6-Day Hybrid — Boss × Mine",
    "version": "v2",
    "updated": "2026-10-21",
    "note": "Built 2026-10-20 at Anthony's call: a MIX of his boss's program and his own. Boss's structure wins — 6 days, Push/Pull/Lower twice through, every muscle 2x a week, traditional lifting up top, athletic work below, his set counts and RPE caps. Anthony's lifts stay where they fit: Flat DB Press, Hack Squat, Seated DB Press, shrugs + face pulls, and his calf/ab finishers. Judgment calls: Bulgarian split squat held out (glutes are covered by squat/RDL/stiff-leg/lunges — easy add-back), Neutral-Grip Pulldown moved to Day 2 (his pick), Wide-Grip Pulldown dropped on Day 5 (iso-lateral pulldown covers it). Set counts are exact; weights carry over by exercise name, even across days.",
    "history": history,
  },
}
p.write_text(json.dumps(new, indent=1, ensure_ascii=False))
print("wrote", p, "workouts:", [w["name"] for w in workouts])
print("exercises per day:", [len(w["exercises"]) for w in workouts])
print("history versions:", [h["version"] for h in history])
