"""Scoring and rating engine for the school feedback platform (reference implementation, stdlib only).

Pipeline
--------
  flow()              -> which questions a given respondent sees (role, grade, answers, teacher assignment)
  score_respondent()  -> item scores 0..100, dimension scores, teacher scores, derived context, quality flags
  apply_quality()     -> duration filter (needs medians over the wave) and final respondent weights
  aggregate()         -> unit results (class / school / region / system / teacher): role-combined means,
                         empirical-Bayes shrinkage, 90% intervals, pillars, index with bootstrap CI,
                         rank range, tier, absolute band, indicators, equity gaps, k-anonymity suppression

Everything that is a policy choice lives in questionnaire.json -> params, not in this file.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))


# =============================================================================== questionnaire
def load_questionnaire(path: str | None = None) -> dict:
    with open(path or os.path.join(HERE, "questionnaire.json"), encoding="utf-8") as f:
        q = json.load(f)
    q["_by_id"] = {it["id"]: it for it in q["items"]}
    q["_derived_by_id"] = {d["id"]: d for d in q["derived"]}
    return q


def stage_of(q: dict, grade: int) -> str:
    for st, (lo, hi) in q["params"]["stages"].items():
        if lo <= grade <= hi:
            return st
    raise ValueError(f"grade out of range: {grade}")


def is_young(q: dict, role: str, grade: int) -> bool:
    lo, hi = q["params"]["young_student_grades"]
    return role == "student" and lo <= grade <= hi


def _h(*parts) -> float:
    """Deterministic pseudo-random number in [0,1) from strings (used for sampling and assignment)."""
    d = hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()
    return int(d[:12], 16) / float(16 ** 12)


def variant(q: dict, it: dict, role: str, grade: int) -> dict:
    """Resolved view of an item for a respondent: text, options, score spec, type."""
    young = is_young(q, role, grade)
    y = it.get("young") if young else None
    text = (y or {}).get("text") or it["text"].get(role) or it["text"].get("parent")
    scale = (y or {}).get("scale") or it.get("scale")
    options = (y or {}).get("options") or (q["scales"][scale] if scale else it.get("options"))
    if y and "options" not in y and "scale" not in y:
        options = it.get("options") or (q["scales"][it["scale"]] if it.get("scale") else None)
    score = (y or {}).get("score", it.get("score"))
    v = {"id": it["id"], "text": text, "options": options, "score": score,
         "type": (y or {}).get("type", it["type"]), "dimension": it.get("dimension"),
         "weight": it.get("weight", 1.0), "aspect": it.get("aspect"), "module": it["module"]}
    if it.get("rows"):
        v["rows"] = it["rows"]   # grid: each row is answered on its own id (e.g. SC01_S / SC01_V)
    return v


def applies(q: dict, it: dict, role: str, grade: int) -> bool:
    if role not in it["roles"]:
        return False
    lo, hi = it.get("grades_by_role", {}).get(role, it["grades"])
    if not (lo <= grade <= hi):
        return False
    if is_young(q, role, grade) and "young" not in it:
        return False
    text = it["text"].get(role)
    return bool(text) or bool(it.get("young"))


# =============================================================================== condition DSL
def eval_cond(cond: dict | None, answers: dict, ctx: dict) -> bool:
    """{"q": id, "op": in|not_in|eq|gte|lte|answered, "v": ...} | {"ctx": key, ...} | {"all": [...]} | {"any": [...]} | {"not": c}"""
    if not cond:
        return True
    if "all" in cond:
        return all(eval_cond(c, answers, ctx) for c in cond["all"])
    if "any" in cond:
        return any(eval_cond(c, answers, ctx) for c in cond["any"])
    if "not" in cond:
        return not eval_cond(cond["not"], answers, ctx)
    val = answers.get(cond["q"]) if "q" in cond else ctx.get(cond["ctx"])
    op, v = cond["op"], cond.get("v")
    if op == "answered":
        return val is not None and val != [] and val != ""
    if val is None:
        return False
    vals = val if isinstance(val, list) else [val]
    if op == "in":
        return any(x in v for x in vals)
    if op == "not_in":
        return all(x not in v for x in vals)
    if op == "eq":
        return val == v
    if op == "gte":
        return val >= v
    if op == "lte":
        return val <= v
    raise ValueError(f"unknown op {op}")


# =============================================================================== teacher assignment
def assign_teachers(q: dict, token: str, role: str, class_teachers: list[dict], rating_counts: dict | None = None,
                    grade: int | None = None) -> list[dict]:
    """Which teachers a respondent rates.

    Parent  -> class teacher only.
    Student in the short (grade 4) form -> class teacher only.
    Student -> class teacher + k others, taken from the least-rated teachers so far (balances coverage),
               deterministic per token so the form re-renders identically.
    class_teachers: [{"teacher_id","name","subject","is_class_teacher"}]
    """
    p = q["params"]["teacher_assignment"]
    head = [t for t in class_teachers if t.get("is_class_teacher")]
    if role == "parent" or (grade is not None and is_young(q, role, grade)):
        return head[:1]
    others = [t for t in class_teachers if not t.get("is_class_teacher")]
    counts = rating_counts or {}
    rng = random.Random(int(_h("assign", token) * 1e12))
    chosen = []
    pool = others[:]
    for _ in range(min(p["extra_teachers"], len(pool))):
        # least-rated teachers first, ties broken by the token's seeded random draw
        least = min(counts.get(t["teacher_id"], 0) for t in pool)
        cands = [i for i, t in enumerate(pool) if counts.get(t["teacher_id"], 0) == least]
        chosen.append(pool.pop(cands[rng.randrange(len(cands))]))
    return (head[:1] if p["always_class_teacher"] else []) + chosen


# =============================================================================== flow
def flow(q: dict, ctx: dict, answers: dict | None = None, teachers: list[dict] | None = None) -> list[dict]:
    """Ordered list of questions to show.

    ctx: {"role","grade","token"} (+ anything conditions read). answers: current answers (for branching).
    teachers: output of assign_teachers(); TC items are repeated per teacher with id "TC01@<teacher_id>".
    """
    role, grade = ctx["role"], ctx["grade"]
    if role == "student" and grade < q["params"]["student_min_grade"]:
        raise ValueError("Учениците от I–III клас не попълват анкета; попълва родителят.")
    answers = answers or {}
    full_ctx = dict(ctx, stage=stage_of(q, grade), young=is_young(q, role, grade))
    out = []
    for mod in q["modules"]:
        rate = mod.get("sampling_rate")
        if rate is not None and _h("sample", ctx.get("token", ""), mod["id"]) >= rate:
            continue
        mod_items = [it for it in q["items"] if it["module"] == mod["id"] and applies(q, it, role, grade)]
        if mod.get("repeat") == "teacher":
            for t in teachers or []:
                for it in mod_items:
                    v = variant(q, it, role, grade)
                    v["text"] = v["text"].replace("{teacher}", t.get("name") or t.get("subject") or "учителят")
                    v["id"] = f'{it["id"]}@{t["teacher_id"]}'
                    v["teacher_id"] = t["teacher_id"]
                    out.append(v)
            continue
        for it in mod_items:
            if eval_cond(it.get("show_if"), answers, full_ctx):
                out.append(variant(q, it, role, grade))
    return out


# =============================================================================== item scoring
def norm_score(q: dict, norm: str, value_minutes_or_hours: float, grade: int) -> float:
    n = q["params"]["norms"]
    if norm in ("homework_weekday", "homework_weekend"):
        hw = n["homework_weekday"]
        N = min(hw["minutes_per_grade"] * grade, hw["cap_minutes"])
        if norm == "homework_weekend":
            N *= n["homework_weekend"]["multiple_of_weekday_norm"]
            zero = n["homework_weekend"]["zero_at_multiple"]
        else:
            zero = hw["zero_at_multiple"]
        m = value_minutes_or_hours
        if m <= N:
            return 100.0
        if m >= zero * N:
            return 0.0
        return 100.0 * (1 - (m - N) / ((zero - 1) * N))
    if norm == "sleep":
        s = n["sleep"]
        need = s["min_hours_by_grade"]["1-6"] if grade <= 6 else s["min_hours_by_grade"]["7-12"]
        h = value_minutes_or_hours
        return max(0.0, min(100.0, 100.0 - s["points_lost_per_hour"] * max(0.0, need - h)))
    raise ValueError(norm)


def item_score(q: dict, v: dict, value, grade: int):
    spec = v.get("score")
    if spec is None or value is None or isinstance(value, (list, str)):
        return None
    k = spec["kind"]
    if k == "likert":
        n = len(v["options"])
        s = 100.0 * value / (n - 1)
        return s if spec.get("polarity", 1) > 0 else 100.0 - s
    if k == "map":
        return spec["values"][value]
    if k == "norm":
        return norm_score(q, spec["norm"], spec["minutes"][value], grade)
    raise ValueError(k)


def grade_band(q: dict, role: str, grade: int, answers: dict):
    """Unified 1..5 (5 = strongest) from whichever grade question this respondent saw."""
    bands = []
    for qid in ("PR02A", "PR02B_BEL", "PR02B_MAT", "PR02C_BEL", "PR02C_MAT"):
        a = answers.get(qid)
        it = q["_by_id"].get(qid)   # older banks asked per subject; the current one asks the overall success
        if a is None or it is None or not applies(q, it, role, grade):
            continue
        if is_young(q, role, grade):
            mapping = [5, 4, 3, 2, None]
        else:
            mapping = [5, 4, 3, 2, 1, None]
        if a < len(mapping) and mapping[a] is not None:
            bands.append(mapping[a])
    return round(sum(bands) / len(bands)) if bands else None


# =============================================================================== respondent scoring
def score_respondent(q: dict, resp: dict) -> dict:
    role, grade = resp["role"], resp["grade"]
    answers = resp.get("answers", {})
    teachers = [{"teacher_id": t["teacher_id"], "name": t.get("name", "")} for t in resp.get("teachers", [])]
    visible = flow(q, {"role": role, "grade": grade, "token": resp.get("token_hash", "")}, answers, teachers)
    items, per_dim = {}, defaultdict(list)          # dim -> [(score|None, weight)]
    tc = defaultdict(lambda: {"aspects": {}, "scores": []})
    t_answers = {t["teacher_id"]: t.get("answers", {}) for t in resp.get("teachers", [])}
    for v in visible:
        if v["type"] in ("notice", "text") or v.get("dimension") is None:
            continue
        if "teacher_id" in v:
            base = v["id"].split("@")[0]
            val = t_answers.get(v["teacher_id"], {}).get(base)
            s = item_score(q, v, val, grade)
            if s is not None:
                tc[v["teacher_id"]]["aspects"][v["aspect"]] = s
                tc[v["teacher_id"]]["scores"].append(s)
            continue
        val = answers.get(v["id"])
        s = item_score(q, v, val, grade)
        items[v["id"]] = s
        # "Не знам"-type options score None and do not count as applicable
        not_applicable = val is not None and s is None
        if not not_applicable:
            per_dim[v["dimension"]].append((s, v["weight"]))
    # derived items
    for d in q["derived"]:
        if d["kind"] == "sleep_from_hours":
            hours = _sleep_hours(answers, q)
            if hours is None:
                per_dim[d["dimension"]].append((None, d["weight"]))
                continue
            s = norm_score(q, "sleep", hours, grade)
            items[d["id"]] = s
            per_dim[d["dimension"]].append((s, d["weight"]))
        elif d["kind"] == "tutoring_to_keep_up":
            t = answers.get("PR04")
            if t is None:
                continue
            reasons = answers.get("PR05") or []
            keep_up = t == 2 and any(r in d["keep_up_options"] for r in reasons)
            s = d["score"]["true"] if keep_up else d["score"]["false"]
            items[d["id"]] = s
            per_dim[d["dimension"]].append((s, d["weight"]))
    cov = q["params"]["coverage"]
    dims = {}
    for dim, lst in per_dim.items():
        answered = [(s, w) for s, w in lst if s is not None]
        need = max(cov["min_items"], math.ceil(cov["min_share"] * len(lst)))
        if answered and len(answered) >= need:
            dims[dim] = sum(s * w for s, w in answered) / sum(w for _, w in answered)
    teacher_scores = {tid: {"score": sum(x["scores"]) / len(x["scores"]), "aspects": x["aspects"]}
                      for tid, x in tc.items() if x["scores"]}
    if teacher_scores:
        dims["TC"] = sum(t["score"] for t in teacher_scores.values()) / len(teacher_scores)
    ctx = {
        "gender": {0: "boy", 1: "girl"}.get(answers.get("PR01")),
        "grade_band": grade_band(q, role, grade, answers),
        "tutoring": answers.get("PR04"),
        "indicators": _indicators(answers, role, grade, q),
    }
    return {"id": resp.get("id"), "role": role, "grade": grade, "stage": stage_of(q, grade), "young": is_young(q, role, grade),
            "unit": {k: resp.get(k) for k in ("region_id", "school_id", "class_id")},
            "mode": resp.get("mode", "closed"), "duration_s": resp.get("duration_s"),
            "items": items, "dims": dims, "teachers": teacher_scores, "ctx": ctx,
            "flags": _quality_flags(q, resp, visible), "answers_vector": _answer_vector(answers)}


def _indicators(a: dict, role: str, grade: int, q: dict) -> dict:
    """Binary indicators (None = not asked / unknown)."""
    young = is_young(q, role, grade)
    ind = {
        "tutoring_regular": None if a.get("PR04") is None else int(a["PR04"] == 2),
        "tutoring_keep_up": None if a.get("PR04") is None else int(a["PR04"] == 2 and any(r in (0, 1) for r in (a.get("PR05") or []))),
        "vacation_tasks": None if a.get("WL03") in (None, 3) else int(a["WL03"] in (1, 2)),
        "behaviour_note": None if a.get("CD02") is None else int(a["CD02"] > 0),
        "labelled_aggression_disputed": None if a.get("CD06") in (None, 3) else int(a["CD06"] in (1, 2)),
        "recess_removed": None if a.get("CD08") in (None, 3) else int(a["CD08"] in (1, 2)),
        "bullying_repeated": None if a.get("SF01") is None else int(a["SF01"] >= (2 if young else 2)),
        # weekly or more often in school weeks (SC01); the short grade-4 form asks WB01 instead
        "psychosomatic_often": int(a["SC01_S"] >= 2) if isinstance(a.get("SC01_S"), int)
        else (None if a.get("WB01") is None else int(a["WB01"] >= (2 if young else 3))),
        # HP00 is a checklist; the "how often" follow-up (HP01, HP03) decides "every week"
        "shouting_weekly": _weekly(a, 0, "HP01"),
        "threats_weekly": _weekly(a, 1, "HP03"),
        "class_punishment": _ticked(a, 2),
        "sent_out": _ticked(a, 3),
        "grade_as_punishment": _ticked(a, 4),
        "physical_force": _ticked(a, 5),
    }
    ind.update(_wellbeing(a, q))
    ind["school_worse"] = _school_worse(a, q)
    ind["sleep_short"] = _sleep_short(a, q, grade)
    ind["homework_over_norm"] = _homework_over(a, q, role, grade)
    return ind


def _ticked(a: dict, opt: int):
    v = a.get("HP00")
    return None if not isinstance(v, list) else int(opt in v)


def _weekly(a: dict, opt: int, follow_up: str):
    t = _ticked(a, opt)
    if t != 1:
        return t
    f = a.get(follow_up)
    return None if not isinstance(f, int) else int(f >= 1)   # month3: 1 = almost every week


def _wellbeing(a: dict, q: dict) -> dict:
    """WHO-5 raw score 0..100 = 4 x sum of (5 - answer index); only when all five items are answered."""
    vals = [a.get(f"WH0{i}") for i in range(1, 6)]
    if not all(isinstance(v, int) for v in vals):
        return {"low_wellbeing": None, "very_low_wellbeing": None}
    raw = 4 * sum(5 - v for v in vals)
    p = q["params"]["who5"]
    return {"low_wellbeing": int(raw <= p["low"]), "very_low_wellbeing": int(raw <= p["very_low"])}


def _school_worse(a: dict, q: dict):
    """Same child, two periods: symptoms at least `worse_steps` more frequent in school weeks than in the vacation."""
    c = q["params"]["contrast"]
    pairs = [(a.get(f"{s}_S"), a.get(f"{s}_V")) for s in c["symptoms"]]
    pairs = [(x, y) for x, y in pairs if isinstance(x, int) and isinstance(y, int)]
    if len(pairs) < c["worse_min_symptoms"]:
        return None
    return int(sum(1 for x, y in pairs if x - y >= c["worse_steps"]) >= c["worse_min_symptoms"])


def _sleep_hours(a: dict, q: dict):
    """Hours slept on school nights, from the school-weeks row of SC06."""
    d = next((x for x in q["derived"] if x["kind"] == "sleep_from_hours"), None)
    v = a.get(d["from"]) if d else None
    return d["hours"][v] if isinstance(v, int) and v < len(d["hours"]) else None


def _sleep_short(a: dict, q: dict, grade: int):
    hours = _sleep_hours(a, q)
    if hours is None:
        return None
    need = q["params"]["norms"]["sleep"]["min_hours_by_grade"]["1-6" if grade <= 6 else "7-12"]
    return int(hours < need)


def _homework_over(a: dict, q: dict, role: str, grade: int):
    v = a.get("WL01")
    if not isinstance(v, int):
        return None
    spec = variant(q, q["_by_id"]["WL01"], role, grade).get("score") or {}
    mins = spec.get("minutes") or []
    if v >= len(mins) or mins[v] is None:
        return None
    hw = q["params"]["norms"]["homework_weekday"]
    norm = min(hw["minutes_per_grade"] * grade, hw["cap_minutes"])
    return int(mins[v] > q["params"]["homework_over_multiple"] * norm)


def _answer_vector(a: dict) -> str:
    return json.dumps({k: a[k] for k in sorted(a) if not isinstance(a[k], str)}, sort_keys=True)


def _quality_flags(q: dict, resp: dict, visible: list[dict]) -> list[str]:
    a = resp.get("answers", {})
    flags = []
    qp = q["params"]["quality"]
    lik = [(v, a.get(v["id"])) for v in visible
           if v.get("score") and v["score"]["kind"] == "likert" and a.get(v["id"]) is not None]
    if len(lik) >= qp["straightline_min_items"] and not is_young(q, resp["role"], resp["grade"]):
        idx = {val for _, val in lik}
        pols = {v["score"].get("polarity", 1) for v, _ in lik}
        if len(idx) == 1 and len(pols) == 2:
            flags.append("straightline")
    if a.get("QC01") is not None and a["QC01"] != 1:
        flags.append("attention_failed")
    if a.get("WL01") == 0 and a.get("WL07") == 4:
        flags.append("inconsistent_workload")
    return flags


# =============================================================================== quality weights
def apply_quality(q: dict, scored: list[dict]) -> list[dict]:
    """Adds 'weight' (0, 0.5, 1 ...) and 'excluded_reason'. Duration rule uses medians per (role, young)."""
    qp = q["params"]["quality"]
    by_form = defaultdict(list)
    for r in scored:
        if r["duration_s"] is not None:
            by_form[(r["role"], r["young"])].append(r["duration_s"])
    med = {k: sorted(v)[len(v) // 2] for k, v in by_form.items() if v}
    for r in scored:
        w, why = 1.0, None
        d = r["duration_s"]
        m = med.get((r["role"], r["young"]))
        if d is not None and (d < qp["min_seconds"] or (m and d < qp["exclude_below_median_share"] * m)):
            w, why = 0.0, "too_fast"
        elif "straightline" in r["flags"]:
            w, why = 0.0, "straightline"
        else:
            if d is not None and m and d < qp["flag_below_median_share"] * m:
                w *= qp["flag_weight"]
            if "attention_failed" in r["flags"] or "inconsistent_workload" in r["flags"]:
                w *= qp["flag_weight"]
        if r["mode"] == "open":
            w *= qp["open_mode_weight"]
        r["weight"], r["excluded_reason"] = w, why
    return scored


# =============================================================================== statistics helpers
def _wstats(xs: list[float], ws: list[float]):
    """Weighted mean, variance, effective n (Kish), raw n. Winsorises 5/95% when n >= 20."""
    pairs = [(x, w) for x, w in zip(xs, ws) if w > 0 and x is not None]
    n = len(pairs)
    if n == 0:
        return None
    if n >= 20:
        srt = sorted(x for x, _ in pairs)
        lo, hi = srt[int(0.05 * (n - 1))], srt[int(math.ceil(0.95 * (n - 1)))]
        pairs = [(min(max(x, lo), hi), w) for x, w in pairs]
    sw = sum(w for _, w in pairs)
    mu = sum(x * w for x, w in pairs) / sw
    var = sum(w * (x - mu) ** 2 for x, w in pairs) / sw * (n / (n - 1) if n > 1 else 1.0)
    n_eff = sw ** 2 / sum(w * w for _, w in pairs)
    return {"mean": mu, "var": max(var, 1.0), "n_eff": n_eff, "n": n}


def _combine_roles(q: dict, dim: str, per_role: dict, stage: str, k_role: int, level: str):
    """Role-weighted mean and sampling variance over roles that pass k-anonymity."""
    rw = dict(q["dimensions"][dim]["role_weights"])
    if stage == "I":
        rw["student"] *= q["params"]["young_student_weight_factor"]
    use = {r: s for r, s in per_role.items() if s and s["n"] >= k_role and rw.get(r, 0) > 0}
    if level == "teacher":
        kt = q["params"]["k_anonymity"]["teacher_min_students"]
        if "student" in per_role and per_role["student"] and per_role["student"]["n"] < kt:
            use.pop("student", None)
    if not use:
        return None
    tot = sum(rw[r] for r in use)
    mu = sum(rw[r] / tot * s["mean"] for r, s in use.items())
    var = sum((rw[r] / tot) ** 2 * s["var"] / s["n_eff"] for r, s in use.items())
    return {"mean": mu, "var": var, "roles": {r: {"n": s["n"], "mean": round(s["mean"], 1)} for r, s in use.items()},
            "n": sum(s["n"] for s in use.values())}


LEVEL_KEY = {"class": "class_id", "school": "school_id", "region": "region_id", "system": None}
PARENT_LEVEL = {"class": "school", "school": "region", "region": "system", "teacher": "school", "system": None}


def _unit_of(r: dict, level: str):
    k = LEVEL_KEY[level]
    return "BG" if k is None else r["unit"][k]


def _dominant_stage(rs: list[dict]) -> str:
    c = defaultdict(int)
    for r in rs:
        c[r["stage"]] += 1
    return max(c, key=c.get)


def _raw_unit_dims(q: dict, rs: list[dict], level: str) -> dict:
    """dim -> combined raw stats for one unit (no shrinkage)."""
    k = q["params"]["k_anonymity"]["role_cell"]
    stage = _dominant_stage(rs)
    out = {}
    for dim in q["dimensions"]:
        per_role = {}
        for role in ("parent", "student"):
            xs = [r["dims"].get(dim) for r in rs if r["role"] == role]
            ws = [r["weight"] for r in rs if r["role"] == role]
            per_role[role] = _wstats(xs, ws)
        c = _combine_roles(q, dim, per_role, stage, k, level)
        if c:
            out[dim] = c
    return out


def _teacher_records(scored: list[dict]) -> list[dict]:
    """Explode respondent-teacher ratings into pseudo-respondents for the teacher level."""
    out = []
    for r in scored:
        for tid, t in r["teachers"].items():
            out.append({**r, "unit": {**r["unit"], "teacher_id": tid}, "dims": {"TC": t["score"]},
                        "aspects": t["aspects"]})
    return out


def _index_from(q: dict, dims: dict) -> tuple[dict, float | None]:
    pill = {}
    for pid in q["pillars"]:
        vals = [dims[d] for d, meta in q["dimensions"].items() if meta["pillar"] == pid and d in dims]
        if vals:
            pill[pid] = sum(vals) / len(vals)
    if len(pill) < len(q["pillars"]):
        return pill, None
    tw = sum(q["pillars"][p]["weight"] for p in pill)
    return pill, sum(q["pillars"][p]["weight"] * v for p, v in pill.items()) / tw


def _band(q: dict, x):
    if x is None:
        return None
    for thr, label in q["params"]["absolute_bands"]:
        if x >= thr:
            return label
    return q["params"]["absolute_bands"][-1][1]


# =============================================================================== aggregation
def aggregate(q: dict, scored: list[dict], level: str, *, seed: int = 1, bootstrap: bool = True,
              class_sizes: dict | None = None) -> dict:
    """Unit results for one level. scored must have passed apply_quality().

    class_sizes: optional {class_id: number of students}. Enables the participation checks:
    more responses of one role than students -> publication blocked; participation < 30% -> low representativeness.
    """
    P = q["params"]
    z = P["interval_z"]
    if level == "teacher":
        recs = _teacher_records(scored)
        key = lambda r: r["unit"]["teacher_id"]
        parent_key = lambda r: r["unit"]["school_id"]
        parent_recs = recs
        parent_level_name = "school"
    else:
        recs = scored
        key = lambda r: _unit_of(r, level)
        pl = PARENT_LEVEL[level]
        parent_key = (lambda r: _unit_of(r, pl)) if pl else None
        parent_recs = scored
        parent_level_name = pl
    groups = defaultdict(list)
    submitted = defaultdict(lambda: defaultdict(int))   # all submissions, incl. excluded ones (for impossible counts)
    for r in recs:
        submitted[key(r)][r["role"]] += 1
        if r["weight"] > 0:
            groups[key(r)].append(r)
    parent_of = {}
    for r in recs:
        if parent_key:
            parent_of[key(r)] = parent_key(r)

    raw = {u: _raw_unit_dims(q, rs, level) for u, rs in groups.items()}

    # reference means = raw means of the parent unit (pooled)
    ref = {}
    if parent_key:
        pgroups = defaultdict(list)
        for r in parent_recs:
            if r["weight"] > 0:
                pgroups[parent_key(r)].append(r)
        ref = {p: _raw_unit_dims(q, rs, parent_level_name if level != "teacher" else "teacher") for p, rs in pgroups.items()}

    # between-unit variance per dimension (method of moments)
    sp = P["shrinkage"]
    tau2 = {}
    for dim in q["dimensions"]:
        ms = [raw[u][dim]["mean"] for u in raw if dim in raw[u]]
        vs = [raw[u][dim]["var"] for u in raw if dim in raw[u]]
        if len(ms) >= sp["min_units_for_tau2"]:
            mbar = sum(ms) / len(ms)
            between = sum((m - mbar) ** 2 for m in ms) / (len(ms) - 1)
            tau2[dim] = max(sp["tau2_floor"], between - sum(vs) / len(vs))
        else:
            tau2[dim] = sp["default_tau2"]

    results = {}
    for u, rs in groups.items():
        dims_out, theta, Bs, refs = {}, {}, {}, {}
        for dim, st in raw[u].items():
            m_ref = None
            if parent_key and parent_of.get(u) in ref and dim in ref[parent_of[u]]:
                m_ref = ref[parent_of[u]][dim]["mean"]
            if m_ref is None:
                B, th, post_var = 1.0, st["mean"], st["var"]
            else:
                B = tau2[dim] / (tau2[dim] + st["var"])
                th = B * st["mean"] + (1 - B) * m_ref
                post_var = B * st["var"]
            se = math.sqrt(post_var)
            theta[dim], Bs[dim], refs[dim] = th, B, m_ref
            dims_out[dim] = {"raw": round(st["mean"], 1), "score": round(th, 1), "se": round(se, 2),
                             "lo": round(th - z * se, 1), "hi": round(th + z * se, 1), "n": st["n"],
                             "roles": st["roles"], "shrink_B": round(B, 3), "band": _band(q, th)}
        pillars, index = _index_from(q, theta)
        res = {"unit_id": u, "level": level, "parent_id": parent_of.get(u), "stage": _dominant_stage(rs),
               "n_respondents": {"parent": sum(1 for r in rs if r["role"] == "parent"),
                                 "student": sum(1 for r in rs if r["role"] == "student")},
               "dimensions": dims_out, "pillars": {k: round(v, 1) for k, v in pillars.items()},
               "index": None if index is None else {"score": round(index, 1)}, "_theta": theta, "_B": Bs, "_ref": refs}
        if level == "teacher":
            res["aspects"] = _teacher_aspects(rs, q)
        else:
            res["indicators"] = _unit_indicators(rs, q)
            res["equity"] = equity_gaps(q, rs)
        if class_sizes and level in ("class", "school", "region", "system"):
            _participation(res, rs, level, class_sizes, submitted[u])
        total = sum(res["n_respondents"].values())
        if total < P["k_anonymity"]["unit_min"] or not dims_out:
            res = {"unit_id": u, "level": level, "suppressed": True, "reason": "k_anonymity",
                   "stage": res["stage"], "n_respondents": res["n_respondents"]}
        results[u] = res

    if bootstrap:
        _bootstrap_index(q, groups, results, level, seed)
    _tiers(q, results, by_stage=level in ("class", "teacher"))
    for res in results.values():
        for k in ("_theta", "_B", "_ref"):
            res.pop(k, None)
    return results


def _participation(res: dict, rs: list[dict], level: str, class_sizes: dict, submitted: dict):
    """Participation per role (valid responses / roster) and a publication block when submissions exceed the roster."""
    classes = {r["unit"]["class_id"] for r in rs}
    size = sum(class_sizes.get(c, 0) for c in classes)
    if not size:
        return
    out = {}
    for role in ("parent", "student"):
        n = res["n_respondents"][role]
        if n:
            out[role] = round(n / size, 2)
    res["participation"] = out
    if level == "class" and any(submitted.get(role, 0) > size for role in ("parent", "student")):
        res["publish_blocked"] = "more_responses_than_students"
    elif out and max(out.values()) < 0.3:
        res["representativeness"] = "low"


def _teacher_aspects(rs: list[dict], q: dict) -> dict:
    agg = defaultdict(list)
    for r in rs:
        for a, s in r.get("aspects", {}).items():
            agg[a].append((s, r["weight"]))
    out = {}
    for a, lst in agg.items():
        st = _wstats([s for s, _ in lst], [w for _, w in lst])
        if st and st["n"] >= q["params"]["k_anonymity"]["teacher_min_students"]:
            out[a] = {"mean": round(st["mean"], 1), "n": st["n"]}
    return out


def _unit_indicators(rs: list[dict], q: dict) -> dict:
    k = q["params"]["k_anonymity"]["role_cell"]
    keys = rs[0]["ctx"]["indicators"].keys() if rs else []
    out = {}
    for key in keys:
        vals = [(r["ctx"]["indicators"][key], r["weight"]) for r in rs if r["ctx"]["indicators"].get(key) is not None]
        if len(vals) >= k:
            sw = sum(w for _, w in vals)
            out[key] = {"share": round(sum(v * w for v, w in vals) / sw, 3), "n": len(vals)}
    return out


def equity_gaps(q: dict, rs: list[dict]) -> list[dict]:
    """Gender and grade-band gaps per dimension, shown only when every cell passes k-anonymity."""
    P = q["params"]
    kc, kmin = P["k_anonymity"]["subgroup_cell"], P["k_anonymity"]["subgroup_unit_min"]
    if len(rs) < kmin:
        return []
    splits = {
        "gender": (lambda r: r["ctx"]["gender"], "boy", "girl"),
        "grades": (lambda r: None if r["ctx"]["grade_band"] is None else ("strong" if r["ctx"]["grade_band"] >= 4 else "struggling" if r["ctx"]["grade_band"] <= 2 else None), "strong", "struggling"),
    }
    out = []
    for name, (f, a, b) in splits.items():
        for dim in q["dimensions"]:
            ga = [(r["dims"][dim], r["weight"]) for r in rs if f(r) == a and dim in r["dims"]]
            gb = [(r["dims"][dim], r["weight"]) for r in rs if f(r) == b and dim in r["dims"]]
            if len(ga) < kc or len(gb) < kc:
                continue
            sa, sb = _wstats(*zip(*ga)), _wstats(*zip(*gb))
            gap = sa["mean"] - sb["mean"]
            se = math.sqrt(sa["var"] / sa["n_eff"] + sb["var"] / sb["n_eff"])
            flagged = abs(gap) >= P["equity"]["flag_gap"] and abs(gap) > P["equity"]["z"] * se
            out.append({"split": name, "dimension": dim, "group_a": a, "group_b": b, "mean_a": round(sa["mean"], 1),
                        "mean_b": round(sb["mean"], 1), "gap": round(gap, 1), "se": round(se, 2),
                        "n_a": sa["n"], "n_b": sb["n"], "flagged": bool(flagged)})
    return out


def _bootstrap_index(q: dict, groups: dict, results: dict, level: str, seed: int):
    """Percentile CI for the index (resampling respondents within unit and role) + joint rank ranges."""
    reps = q["params"]["bootstrap_reps"]
    rng = random.Random(seed)
    draws = {}
    for u, rs in groups.items():
        res = results[u]
        if res.get("suppressed") or res.get("index") is None:
            continue
        by_role = defaultdict(list)
        for r in rs:
            by_role[r["role"]].append(r)
        d = []
        for _ in range(reps):
            sample = []
            for role, lst in by_role.items():
                sample += [lst[rng.randrange(len(lst))] for _ in lst]
            rawb = _raw_unit_dims(q, sample, level)
            th = {}
            for dim, st in rawb.items():
                B, m = res["_B"].get(dim, 1.0), res["_ref"].get(dim)
                th[dim] = st["mean"] if m is None else B * st["mean"] + (1 - B) * m
            _, idx = _index_from(q, th)
            if idx is not None:
                d.append(idx)
        if len(d) >= reps * 0.8:
            d.sort()
            res["index"]["lo"] = round(d[int(0.05 * (len(d) - 1))], 1)
            res["index"]["hi"] = round(d[int(0.95 * (len(d) - 1))], 1)
            draws[u] = d
    # joint rank ranges (draw j of each unit is independent; rank within each j)
    if len(draws) >= 2:
        units = list(draws)
        L = min(len(v) for v in draws.values())
        shuffled = {u: rng.sample(draws[u], L) for u in units}
        ranks = defaultdict(list)
        for j in range(L):
            order = sorted(units, key=lambda u: -shuffled[u][j])
            for pos, u in enumerate(order, 1):
                ranks[u].append(pos)
        for u, rk in ranks.items():
            rk.sort()
            results[u]["index"]["rank_range"] = [rk[int(0.05 * (L - 1))], rk[int(0.95 * (L - 1))]]
            results[u]["index"]["of"] = len(units)


def _tiers(q: dict, results: dict, by_stage: bool = False):
    """Classes and teachers are compared only with units of the same stage; schools and regions with all."""
    if by_stage:
        groups = defaultdict(dict)
        for u, r in results.items():
            groups[r.get("stage")][u] = r
        for g in groups.values():
            _tiers(q, g, by_stage=False)
        return
    tp = q["params"]["tiers"]
    vals = [r["index"]["score"] for r in results.values() if not r.get("suppressed") and r.get("index")]
    if len(vals) < 2:
        return
    m = sum(vals) / len(vals)
    sd = math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))
    delta = max(tp["delta_min"], tp["delta_share_of_sd"] * sd)
    for r in results.values():
        if r.get("suppressed") or not r.get("index"):
            continue
        ix = r["index"]
        lo, hi, th = ix.get("lo"), ix.get("hi"), ix["score"]
        if lo is None or hi - lo > tp["max_ci_width"]:
            t = "na"
        elif lo > m + delta:
            t = "2" if th > m + 3 * delta else "1"
        elif hi < m - delta:
            t = "-2" if th < m - 3 * delta else "-1"
        else:
            t = "0"
        ix["tier"] = tp["labels"][t]
        ix["tier_code"] = t
        ix["reference_mean"] = round(m, 1)
        ix["band"] = _band(q, th)


# =============================================================================== campaign detection
def detect_campaigns(scored: list[dict], level: str = "class", share: float = 0.2, min_dupes: int = 5) -> list[dict]:
    """Units where many responses share an identical answer vector (copy-paste / coordinated filling)."""
    groups = defaultdict(list)
    for r in scored:
        groups[_unit_of(r, level)].append(r["answers_vector"])
    out = []
    for u, vecs in groups.items():
        c = defaultdict(int)
        for v in vecs:
            c[v] += 1
        top = max(c.values())
        if top >= min_dupes and top / len(vecs) >= share:
            out.append({"unit_id": u, "level": level, "identical": top, "of": len(vecs)})
    return out


# =============================================================================== simulation
def simulate(q: dict, *, regions=3, schools_per_region=6, classes_per_school=4, class_size=20,
             participation=0.65, seed=7, campaign_class=True, speeders=0.03):
    """Synthetic wave with known latent quality per school/class/teacher. Returns (responses, truth, rosters)."""
    rng = random.Random(seed)
    responses, truth, rosters = [], {"school": {}, "teacher": {}}, {}
    rid = 0
    subjects = ["БЕЛ", "Математика", "Английски език", "История", "Биология", "Физика", "ФВС", "Музика"]
    for ri in range(regions):
        region = f"R{ri+1}"
        for si in range(schools_per_region):
            school = f"{region}-S{si+1}"
            q_s = rng.gauss(0, 1)
            truth["school"][school] = q_s
            teachers = [{"teacher_id": f"{school}-T{i+1}", "name": f"Учител {i+1}", "subject": subjects[i % len(subjects)]}
                        for i in range(9)]
            for t in teachers:
                truth["teacher"][t["teacher_id"]] = q_s * 0.5 + rng.gauss(0, 0.9)
            grades = sorted(rng.sample(range(1, 13), classes_per_school))
            for ci, g in enumerate(grades):
                cls = f"{school}-C{g}"
                q_c = q_s + rng.gauss(0, 0.5)
                ct = teachers[ci % len(teachers)]
                class_teachers = [dict(ct, is_class_teacher=True)] + [dict(t, is_class_teacher=False) for t in teachers if t is not ct][:6]
                rosters[cls] = class_teachers
                counts = defaultdict(int)
                roles = ["parent"] + (["student"] if g >= q["params"]["student_min_grade"] else [])
                for _ in range(class_size):
                    child_latent = q_c + rng.gauss(0, 0.8)
                    gender = rng.choice([0, 1])
                    for role in roles:
                        if rng.random() > participation:
                            continue
                        rid += 1
                        token = f"tok{rid}"
                        assigned = assign_teachers(q, token, role, class_teachers, counts, grade=g)
                        for t in assigned:
                            counts[t["teacher_id"]] += 1
                        ans = _sim_answers(q, rng, role, g, child_latent + rng.gauss(0, 0.4), gender, token)
                        tans = []
                        for t in assigned:
                            lat = truth["teacher"][t["teacher_id"]] + rng.gauss(0, 0.7)
                            ta = {}
                            for v in flow(q, {"role": role, "grade": g, "token": token}, ans, [t]):
                                base = v["id"].split("@")[0]
                                ta[base] = _pick(q, v, 60 + 15 * lat + rng.gauss(0, 8), g)
                            tans.append({"teacher_id": t["teacher_id"], "name": t["name"], "answers": ta})
                        dur = max(30, rng.gauss(420 if role == "parent" else 360, 90))
                        if rng.random() < speeders:
                            dur = rng.uniform(20, 70)
                        responses.append({"id": f"r{rid}", "token_hash": token, "mode": "closed", "role": role, "grade": g,
                                          "region_id": region, "school_id": school, "class_id": cls, "duration_s": round(dur),
                                          "answers": ans, "teachers": tans})
    if campaign_class:
        target = responses[0]
        for i in range(12):
            clone = json.loads(json.dumps(target))
            clone["id"] = f"camp{i}"
            clone["token_hash"] = f"camp{i}"
            for k in clone["answers"]:
                if isinstance(clone["answers"][k], int):
                    clone["answers"][k] = 0
            responses.append(clone)
    truth["class_sizes"] = {c: class_size for c in rosters}
    return responses, truth, rosters


def _pick(q: dict, v: dict, target: float, grade: int):
    """Option whose score is closest to target (inverts the scoring rule)."""
    if not v.get("options"):
        return None
    best, bd = 0, 1e9
    for i in range(len(v["options"])):
        s = item_score(q, v, i, grade)
        if s is None:
            continue
        d = abs(s - target)
        if d < bd:
            best, bd = i, d
    return best


def _sim_grid(ans: dict, v: dict, rng: random.Random, latent: float, grade: int):
    """School weeks vs vacation: the vacation level is the child's own; a weak school adds symptoms and cuts sleep."""
    s_id, v_id = v["rows"][0]["id"], v["rows"][1]["id"]
    n = len(v["options"])
    clamp = lambda x: int(min(n - 1, max(0, round(x))))
    if v["id"] == "SC06":
        vac = clamp(3 + rng.gauss(0, 0.7) - (grade - 6) / 6)
        ans[v_id], ans[s_id] = vac, clamp(vac - max(0.0, 0.6 + (grade - 4) / 5 - 0.6 * latent + rng.gauss(0, 0.6)))
    else:
        vac = clamp(0.8 + rng.gauss(0, 0.7))
        ans[v_id], ans[s_id] = vac, clamp(vac + max(0.0, 0.3 - 0.8 * latent + rng.gauss(0, 0.6)))


def _sim_rare(ans: dict, v: dict, rng: random.Random, latent: float):
    """Harmful practices are rare events, more frequent where the school climate is poor."""
    if v["id"] == "HP00":
        # base rate of each practice, rising where the climate is poor
        base = [0.08, 0.07, 0.12, 0.12, 0.05, 0.01]
        ticked = [k for k, b in enumerate(base) if rng.random() < b + max(0.0, -latent) * b * 1.5]
        ans[v["id"]] = ticked or [6]
    else:
        ans[v["id"]] = int(min(2, max(0, round(-0.6 - 0.7 * latent + rng.gauss(0, 0.7)))))


def _sim_answers(q: dict, rng: random.Random, role: str, grade: int, latent: float, gender: int, token: str) -> dict:
    ans = {}
    for _ in range(3):  # iterate so that conditional questions see their parents' answers
        for v in flow(q, {"role": role, "grade": grade, "token": token}, ans, []):
            if v["id"] in ans or v["type"] in ("notice", "text") or (v["type"] == "grid" and v["rows"][0]["id"] in ans):
                continue
            if v["id"] == "PR01":
                ans[v["id"]] = gender
            elif v["id"].startswith("PR02"):
                n = len(v["options"])
                ans[v["id"]] = int(min(n - 2, max(0, round(1.5 - latent + rng.gauss(0, 0.8)))))
            elif v["id"] == "PR04":
                ans[v["id"]] = 2 if latent < -0.8 and rng.random() < 0.7 else rng.choice([0, 0, 0, 1])
            elif v["id"] == "PR05":
                ans[v["id"]] = [0] if latent < 0 else [4]
            elif v["id"] == "QC01":
                ans[v["id"]] = 1 if rng.random() > 0.05 else 3
            elif v["module"] == "HP":
                _sim_rare(ans, v, rng, latent)
            elif v["type"] == "multi":
                ans[v["id"]] = [rng.randrange(len(v["options"]))]
            elif v["type"] == "grid":
                _sim_grid(ans, v, rng, latent, grade)
            elif v.get("score"):
                ans[v["id"]] = _pick(q, v, 62 + 14 * latent + rng.gauss(0, 12), grade)
            elif v.get("options"):
                if v["id"] == "SL01":
                    ans[v["id"]] = int(min(7, max(0, round(2 + (grade - 4) / 3 - latent * 0.8 + rng.gauss(0, 0.8)))))
                elif v["id"] == "SL02":
                    ans[v["id"]] = int(min(4, max(0, round(2 + rng.gauss(0, 0.8)))))
                elif v["id"] == "CD02":
                    ans[v["id"]] = int(min(3, max(0, round(-latent * 0.8 + rng.gauss(0, 0.8)))))
                else:
                    ans[v["id"]] = rng.randrange(len(v["options"]))
    return ans


def run_wave(q: dict, responses: list[dict], levels=("class", "school", "region", "system", "teacher"), seed=1,
             class_sizes: dict | None = None) -> dict:
    scored = apply_quality(q, [score_respondent(q, r) for r in responses])
    out = {"meta": {"responses": len(responses), "included": sum(1 for s in scored if s["weight"] > 0),
                    "excluded": defaultdict(int), "questionnaire_version": q["version"]},
           "campaign_alerts": detect_campaigns(scored)}
    for s in scored:
        if s["excluded_reason"]:
            out["meta"]["excluded"][s["excluded_reason"]] += 1
    out["meta"]["excluded"] = dict(out["meta"]["excluded"])
    for lv in levels:
        out[lv] = aggregate(q, scored, lv, seed=seed, class_sizes=class_sizes)
    return out


if __name__ == "__main__":
    q = load_questionnaire()
    resp, truth, _ = simulate(q)
    res = run_wave(q, resp)
    sch = res["school"]
    xs = [(truth["school"][u], r["index"]["score"]) for u, r in sch.items() if not r.get("suppressed") and r.get("index")]
    n = len(xs)
    mx, my = sum(x for x, _ in xs) / n, sum(y for _, y in xs) / n
    cor = sum((x - mx) * (y - my) for x, y in xs) / math.sqrt(sum((x - mx) ** 2 for x, _ in xs) * sum((y - my) ** 2 for _, y in xs))
    print(json.dumps(res["meta"], ensure_ascii=False))
    print("campaign alerts:", res["campaign_alerts"])
    print(f"schools: {n}, correlation(true quality, index) = {cor:.2f}")
    for u, r in sorted(sch.items(), key=lambda kv: -(kv[1].get("index") or {}).get("score", 0))[:5]:
        print(u, r["index"])
