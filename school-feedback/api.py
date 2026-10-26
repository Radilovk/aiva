"""Reference HTTP API for the school feedback platform (Python stdlib only).

Run a demo with simulated data:
    python api.py --demo            # http://127.0.0.1:8080, prints demo API keys

Design rules
------------
* Respondents never authenticate as persons. A one-time anonymous code (closed mode) fixes school, class,
  grade and role; the server stores only its SHA-256 hash and marks it used.
* Raw responses never leave the server. Every read endpoint returns aggregates produced by engine.py,
  already filtered by k-anonymity, and further filtered by the caller's scope.
* Scopes (header X-API-Key):
    public        system, region, school
    researcher    + class (no teacher level)
    school_admin  + class and teacher units of ONE school
    teacher       ONLY own teacher unit
    admin         everything + issue codes + compute waves
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import threading
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import engine as E

Q = E.load_questionnaire()
LEVELS = ("system", "region", "school", "class", "teacher")
LOCK = threading.Lock()


# =============================================================================== storage (in memory; swap for a DB)
class Store:
    def __init__(self):
        self.codes: dict[str, dict] = {}          # sha256(code) -> {class_id, school_id, region_id, grade, role, used}
        self.rosters: dict[str, list] = {}        # class_id -> [{teacher_id, name, subject, is_class_teacher}]
        self.class_sizes: dict[str, int] = {}
        self.responses: dict[str, list] = defaultdict(list)   # wave -> responses (engine input format)
        self.results: dict[str, dict] = {}        # wave -> engine.run_wave output (+ themes)
        self.rating_counts: dict[str, int] = defaultdict(int)
        self.keys: dict[str, dict] = {}           # api key -> {scope, school_id?, teacher_id?}


S = Store()


def h(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


# =============================================================================== free-text themes (redacted)
EMAIL = re.compile(r"\S+@\S+")
PHONE = re.compile(r"\+?\d[\d\s\-]{6,}\d")
HONORIFIC = re.compile(r"\b(г-жа|г-н|госпожа|господин|учителката|учителят)\s+[А-ЯЁЍ][а-яёѝ]+", re.I)
CAPWORD = re.compile(r"(?<![.!?]\s)(?<!^)\b[А-Я][а-я]{2,}\b")
THEMES = {
    "обем на домашните": ["домашн", "задачи", "натовар", "много за пис"],
    "уикенд и ваканции": ["уикенд", "събота", "неделя", "ваканци"],
    "дисциплина и наказания": ["наказ", "агрес", "бележк", "забележк", "крещ", "вик"],
    "сън и умора": ["сън", "спи", "умор", "изтощ", "късно"],
    "уважение и отношение": ["уважен", "униж", "засрам", "отношени"],
    "комуникация с родителите": ["комуникац", "родителск", "информ", "отговар", "среща"],
    "качество на преподаването": ["обясн", "преподав", "разбир", "интерес"],
    "тормоз и безопасност": ["тормоз", "обижд", "удря", "бият", "безопас"],
    "положително": ["харесв", "доволн", "благодар", "прекрас", "добр"],
}


def redact(text: str) -> str:
    t = EMAIL.sub("[имейл]", text)
    t = PHONE.sub("[телефон]", t)
    t = HONORIFIC.sub(lambda m: m.group(1) + " [име]", t)
    return CAPWORD.sub("[име]", t)


def themes_for(responses: list[dict]) -> dict:
    counts = defaultdict(int)
    n = 0
    for r in responses:
        texts = [r["answers"].get(k) for k in ("OT01", "OT02", "OT03") if isinstance(r["answers"].get(k), str)]
        if not texts:
            continue
        n += 1
        low = redact(" ".join(texts)).lower()
        for theme, stems in THEMES.items():
            if any(s in low for s in stems):
                counts[theme] += 1
    return {"respondents_with_text": n, "themes": dict(sorted(counts.items(), key=lambda kv: -kv[1]))}


# =============================================================================== scope filtering
def can_see(key: dict, level: str, unit: dict) -> bool:
    sc = key["scope"]
    if sc == "admin":
        return True
    if sc == "teacher":
        return level == "teacher" and unit.get("unit_id") == key.get("teacher_id")
    if level in ("system", "region", "school"):
        return True
    if sc == "researcher":
        return level == "class"
    if sc == "school_admin":
        if level == "class":
            return unit.get("parent_id") == key.get("school_id")
        if level == "teacher":
            return unit.get("parent_id") == key.get("school_id")
    return False


def public_view(level: str, unit: dict) -> dict:
    """What leaves the server: no internal fields, and blocked units are withheld."""
    if unit.get("publish_blocked"):
        return {"unit_id": unit["unit_id"], "level": level, "withheld": unit["publish_blocked"]}
    return unit


# =============================================================================== HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "SchoolFeedback/1.0"

    def log_message(self, *a):  # no IP logging
        pass

    # ---------------------------------------------------------------- helpers
    def _send(self, code: int, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 256 * 1024:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def _key(self) -> dict:
        return S.keys.get(self.headers.get("X-API-Key", ""), {"scope": "public"})

    def _wave(self, qs) -> str | None:
        w = (qs.get("wave") or [None])[0]
        if w:
            return w
        return list(S.results)[-1] if S.results else None   # most recently computed

    # ---------------------------------------------------------------- routes
    def do_GET(self):
        try:
            u = urlparse(self.path)
            parts = [p for p in u.path.split("/") if p]
            qs = parse_qs(u.query)
            key = self._key()
            if parts == ["v1", "questionnaire"]:
                return self._send(200, {k: v for k, v in Q.items() if not k.startswith("_")})
            if parts == ["v1", "methodology"]:
                return self._send(200, {"version": Q["version"], "dimensions": Q["dimensions"], "pillars": Q["pillars"],
                                        "params": Q["params"], "notes": METHOD_NOTES})
            if parts == ["v1", "waves"]:
                return self._send(200, {"waves": list(S.results), "meta": {w: r["meta"] for w, r in S.results.items()}})
            wave = self._wave(qs)
            if wave is None or wave not in S.results:
                return self._send(404, {"error": "no computed wave"})
            res = S.results[wave]
            if parts == ["v1", "units"]:
                level = (qs.get("level") or ["school"])[0]
                if level not in LEVELS:
                    return self._send(400, {"error": "bad level"})
                tier = (qs.get("tier") or [None])[0]
                items = [public_view(level, x) for x in res[level].values()
                         if can_see(key, level, x) and not x.get("suppressed")]
                if tier:
                    items = [x for x in items if (x.get("index") or {}).get("tier_code") == tier]
                items.sort(key=lambda x: -((x.get("index") or {}).get("score") or 0))
                return self._send(200, {"wave": wave, "level": level, "count": len(items),
                                        "units": [_summary(x) for x in items]})
            if len(parts) >= 4 and parts[:2] == ["v1", "units"]:
                level, uid = parts[2], parts[3]
                unit = res.get(level, {}).get(uid)
                if not unit or not can_see(key, level, unit):
                    return self._send(404, {"error": "not found or not permitted"})
                if len(parts) == 4:
                    return self._send(200, {"wave": wave, **public_view(level, unit)})
                if parts[4] == "equity":
                    return self._send(200, {"wave": wave, "unit_id": uid, "equity": unit.get("equity", [])})
                if parts[4] == "themes":
                    th = res.get("themes", {}).get(level, {}).get(uid)
                    if not th or th["respondents_with_text"] < Q["params"]["k_anonymity"]["free_text_min"]:
                        return self._send(200, {"unit_id": uid, "themes": {}, "note": "below free-text threshold"})
                    return self._send(200, {"wave": wave, "unit_id": uid, **th})
                if parts[4] == "trend":
                    out = []
                    for w in S.results:
                        x = S.results[w].get(level, {}).get(uid)
                        if x and can_see(key, level, x) and not x.get("suppressed"):
                            out.append({"wave": w, "index": x.get("index"),
                                        "dimensions": {d: v["score"] for d, v in x.get("dimensions", {}).items()}})
                    return self._send(200, {"unit_id": uid, "trend": out})
            if parts == ["v1", "compare"]:
                level = (qs.get("level") or ["school"])[0]
                a, b = (qs.get("a") or [None])[0], (qs.get("b") or [None])[0]
                ua, ub = res.get(level, {}).get(a), res.get(level, {}).get(b or "")
                if b in (None, "", "reference"):
                    ub = None
                if not ua or not can_see(key, level, ua):
                    return self._send(404, {"error": "unit a not found or not permitted"})
                if ub is not None and not can_see(key, level, ub):
                    return self._send(404, {"error": "unit b not permitted"})
                return self._send(200, compare(level, ua, ub, res))
            return self._send(404, {"error": "unknown route"})
        except Exception as ex:  # pragma: no cover
            return self._send(500, {"error": str(ex)})

    def do_POST(self):
        try:
            u = urlparse(self.path)
            parts = [p for p in u.path.split("/") if p]
            key = self._key()
            body = self._body()
            if parts == ["v1", "codes"]:
                if key["scope"] != "admin":
                    return self._send(403, {"error": "admin only"})
                return self._send(201, issue_codes(body))
            if parts == ["v1", "session"]:
                return self._send(*start_session(body))
            if parts == ["v1", "flow"]:
                return self._send(*next_questions(body))
            if parts == ["v1", "responses"]:
                return self._send(*submit(body))
            if len(parts) == 4 and parts[:2] == ["v1", "waves"] and parts[3] == "compute":
                if key["scope"] != "admin":
                    return self._send(403, {"error": "admin only"})
                return self._send(200, compute(parts[2]))
            return self._send(404, {"error": "unknown route"})
        except (ValueError, KeyError) as ex:
            return self._send(400, {"error": str(ex)})


def _summary(x: dict) -> dict:
    if x.get("withheld"):
        return x
    return {"unit_id": x["unit_id"], "parent_id": x.get("parent_id"), "stage": x.get("stage"),
            "n_respondents": x.get("n_respondents"), "index": x.get("index"), "pillars": x.get("pillars"),
            "representativeness": x.get("representativeness", "ok")}


# =============================================================================== actions
def issue_codes(body: dict) -> dict:
    """Admin: one code per student and per parent for a class. Plain codes are returned ONCE, only hashes are kept."""
    need = ("class_id", "school_id", "region_id", "grade")
    for k in need:
        if k not in body:
            raise ValueError(f"missing {k}")
    out = {"parent": [], "student": []}
    grade = int(body["grade"])
    with LOCK:
        if body.get("roster"):
            S.rosters[body["class_id"]] = body["roster"]
        if body.get("class_size"):
            S.class_sizes[body["class_id"]] = int(body["class_size"])
        for role in ("parent", "student"):
            n = int(body.get(f"n_{role}", 0))
            if role == "student" and grade < Q["params"]["student_min_grade"]:
                n = 0
            for _ in range(n):
                code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
                S.codes[h(code)] = {"class_id": body["class_id"], "school_id": body["school_id"],
                                    "region_id": body["region_id"], "grade": grade, "role": role, "used": False,
                                    "wave": body.get("wave", "current")}
                out[role].append(code)
    return out


def _code_ctx(code: str):
    rec = S.codes.get(h(code or ""))
    if not rec:
        return None, (404, {"error": "unknown code"})
    if rec["used"]:
        return None, (409, {"error": "code already used"})
    return rec, None


def _teachers_for(code: str, rec: dict) -> list[dict]:
    roster = S.rosters.get(rec["class_id"], [])
    return E.assign_teachers(Q, h(code), rec["role"], roster, S.rating_counts, grade=rec["grade"])


def start_session(body: dict):
    rec, err = _code_ctx(body.get("code"))
    if err:
        return err
    teachers = _teachers_for(body["code"], rec)
    ctx = {"role": rec["role"], "grade": rec["grade"], "token": h(body["code"])}
    return 200, {"role": rec["role"], "grade": rec["grade"], "stage": E.stage_of(Q, rec["grade"]),
                 "young_form": E.is_young(Q, rec["role"], rec["grade"]),
                 "teachers": [{"teacher_id": t["teacher_id"], "name": t.get("name")} for t in teachers],
                 "questions": E.flow(Q, ctx, {}, teachers)}


def next_questions(body: dict):
    rec, err = _code_ctx(body.get("code"))
    if err:
        return err
    teachers = _teachers_for(body["code"], rec)
    ctx = {"role": rec["role"], "grade": rec["grade"], "token": h(body["code"])}
    return 200, {"questions": E.flow(Q, ctx, body.get("answers") or {}, teachers)}


def submit(body: dict):
    with LOCK:
        rec, err = _code_ctx(body.get("code"))
        if err:
            return err
        teachers = _teachers_for(body["code"], rec)
        allowed = {t["teacher_id"]: t for t in teachers}
        tans = [{"teacher_id": tid, "name": allowed[tid].get("name", ""), "answers": a}
                for tid, a in (body.get("teacher_answers") or {}).items() if tid in allowed]
        resp = {"id": secrets.token_hex(8), "token_hash": h(body["code"]), "mode": "closed", "role": rec["role"],
                "grade": rec["grade"], "region_id": rec["region_id"], "school_id": rec["school_id"],
                "class_id": rec["class_id"], "duration_s": body.get("duration_s"),
                "answers": body.get("answers") or {}, "teachers": tans}
        E.score_respondent(Q, resp)  # validates the shape; raises on garbage
        S.responses[rec["wave"]].append(resp)
        rec["used"] = True
        for t in tans:
            S.rating_counts[t["teacher_id"]] += 1
    return 201, {"status": "recorded"}


def compute(wave: str) -> dict:
    resp = S.responses.get(wave, [])
    if not resp:
        raise ValueError("no responses for wave")
    res = E.run_wave(Q, resp, class_sizes=S.class_sizes or None)
    by = defaultdict(lambda: defaultdict(list))
    for r in resp:
        by["school"][r["school_id"]].append(r)
        by["region"][r["region_id"]].append(r)
        by["system"]["BG"].append(r)
    res["themes"] = {lv: {u: themes_for(rs) for u, rs in d.items()} for lv, d in by.items()}
    S.results[wave] = res
    return {"wave": wave, "meta": res["meta"], "campaign_alerts": res["campaign_alerts"]}


def compare(level: str, a: dict, b: dict | None, res: dict) -> dict:
    """Dimension-by-dimension difference with a crude significance flag (non-overlapping 90% intervals)."""
    ref = b or res["system"].get("BG")
    rows = []
    for d, va in a.get("dimensions", {}).items():
        vb = (ref or {}).get("dimensions", {}).get(d)
        if not vb:
            continue
        rows.append({"dimension": d, "name": Q["dimensions"][d]["name"], "a": va["score"], "b": vb["score"],
                     "diff": round(va["score"] - vb["score"], 1),
                     "clear_difference": va["lo"] > vb["hi"] or va["hi"] < vb["lo"]})
    return {"a": a["unit_id"], "b": (b or {}).get("unit_id", "system"), "rows": rows,
            "index": {"a": a.get("index"), "b": (ref or {}).get("index")}}


METHOD_NOTES = [
    "Scores are 0-100 per dimension; higher is better for children and families.",
    "Unit scores are empirical-Bayes estimates shrunk toward the parent level; small units move more.",
    "Intervals are 90%. Tiers compare the interval with the mean of the same level (classes and teachers within stage).",
    "Reported grades are context only: schools grade their own pupils, so grades are not comparable between schools.",
    "Teacher results are private to the teacher and the school director.",
    "Correlation is not causation: an association between workload and wellbeing does not prove which causes which.",
]


# =============================================================================== demo
def seed_demo(waves=("2026-spring", "2026-autumn")):
    for i, w in enumerate(waves):
        resp, truth, rosters = E.simulate(Q, regions=3, schools_per_region=5, seed=7 + i, campaign_class=(i == 1))
        S.responses[w] = resp
        S.rosters.update(rosters)
        S.class_sizes.update(truth["class_sizes"])
        compute(w)
    S.keys = {"demo-public": {"scope": "public"}, "demo-researcher": {"scope": "researcher"},
              "demo-school": {"scope": "school_admin", "school_id": "R1-S1"},
              "demo-teacher": {"scope": "teacher", "teacher_id": "R1-S1-T1"}, "demo-admin": {"scope": "admin"}}
    return S.keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--demo", action="store_true", help="seed two simulated waves and demo API keys")
    a = ap.parse_args()
    if a.demo:
        Q["params"]["bootstrap_reps"] = 150
        keys = seed_demo()
        print("demo keys:", ", ".join(keys))
        roster = next((r for c, r in S.rosters.items() if c.startswith("R1-S1-")), [])
        for grade, cls in ((6, "R1-S1-DEMO6"), (4, "R1-S1-DEMO4")):
            codes = issue_codes({"wave": "demo", "class_id": cls, "school_id": "R1-S1", "region_id": "R1",
                                 "grade": grade, "n_parent": 3, "n_student": 3, "class_size": 25, "roster": roster})
            print(f"demo codes, grade {grade}: parent {', '.join(codes['parent'])}; "
                  f"student {', '.join(codes['student'])}")
    print(f"listening on http://{a.host}:{a.port}")
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
