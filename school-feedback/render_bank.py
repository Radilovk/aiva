"""Renders questionnaire.json as a Markdown question bank (used for the documentation tab)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
q = json.load(open(os.path.join(HERE, "questionnaire.json"), encoding="utf-8"))
S = q["scales"]


def opts(it):
    if it["type"] == "text": return "свободен текст"
    if it["type"] == "notice": return "съобщение"
    o = it.get("options") or (S[it["scale"]] if it.get("scale") else None)
    rows = f'два отговора ({" · ".join(r["label"].lower() for r in it["rows"])}): ' if it.get("rows") else ""
    return rows + (" / ".join(o) if o else "")


def scoring(it):
    s = it.get("score")
    if not s:
        if it["id"].startswith("PR02"): return "контекст → оценъчна група 1–5"
        if it["id"] == "QC01": return "проверка за внимание (очаква „Рядко“)"
        return "контекст"
    k = s["kind"]
    if k == "likert": return "0–100, " + ("обратна" if s.get("polarity", 1) < 0 else "права")
    if k == "map": return "точки: " + " / ".join("–" if v is None else str(v) for v in s["values"])
    if k == "norm":
        return {"homework_weekday": "спрямо нормата за класа (10 мин × клас)", "homework_weekend": "спрямо нормата за уикенда"}[s["norm"]]


def rng(a, b): return f"{a} клас" if a == b else f"{a}–{b} клас"


def cond(it):
    parts = []
    gbr = it.get("grades_by_role")
    if gbr: parts.append("; ".join(f'{"Р" if r == "parent" else "У"}: {rng(a, b)}' for r, (a, b) in gbr.items()))
    elif it["grades"] != [1, 12]: parts.append(rng(*it["grades"]))
    c = it.get("show_if")
    if c:
        def fmt(c):
            if "any" in c: return " или ".join(fmt(x) for x in c["any"])
            if "all" in c: return " и ".join(fmt(x) for x in c["all"])
            return f'{c["q"]} ∈ {{{", ".join(str(v) for v in c["v"])}}}'
        parts.append("ако " + fmt(c))
    if it.get("young"): parts.append("има детска версия")
    return "; ".join(parts) or "винаги"


def main(out=sys.stdout):
    mods = {m["id"]: m["title"] for m in q["modules"]}
    dims = q["dimensions"]
    esc = lambda x: x.replace("|", "/")
    w = lambda s="": print(s, file=out)
    w("# Въпросна банка\n")
    w(f"Пълният списък от {len(q['items'])} въпроса във версия {q['version']}, генериран автоматично от questionnaire.json. "
      "Отговорите са номерирани от 0 в реда, в който са изброени. „Кога“ показва класовете и условията; „Р“ = родител, „У“ = ученик.")
    cur = None
    for it in q["items"]:
        m = it["module"]
        if m != cur:
            cur = m
            title = mods[m] + (f" ({m})" if m in dims else "")
            w(f"\n## {title}\n")
            w("| ID | Родител | Ученик | Отговори | Изчисление | Кога |")
            w("| --- | --- | --- | --- | --- | --- |")
        tp = it["text"].get("parent", "") if "parent" in it["roles"] else ""
        ts = it["text"].get("student", "") if "student" in it["roles"] else ""
        tp, ts = (tp or "–").replace("{teacher}", "[учителят]"), (ts or "–").replace("{teacher}", "[учителят]")
        w(f'| {it["id"]} | {esc(tp)} | {esc(ts)} | {esc(opts(it))} | {scoring(it)} | {esc(cond(it))} |')
    w("\n## Изчислени показатели\n")
    w("| ID | Измерение | Как се изчислява |\n| --- | --- | --- |")
    w("| SL_SLEEP | SL | Часове сън = 24 − час на заспиване (SL01) + час на ставане (SL02); 100 точки при поне 9 ч (I–VI клас) или 8 ч (VII–XII), −40 точки за всеки липсващ час; тегло 2 |")
    w("| SU_TUT | SU | Редовни частни уроци (PR04 = 2) с причина „за да се справя“ или „за да навакса“ (PR05) → 0 точки, иначе 100; тегло 0,5 |")
    w("\n## Детска версия (IV клас)\n")
    w("| ID | Въпрос | Отговори |\n| --- | --- | --- |")
    for it in q["items"]:
        y = it.get("young")
        if not y or "student" not in it["roles"]: continue
        o = y.get("options") or (S[y["scale"]] if y.get("scale") else (it.get("options") or (S[it["scale"]] if it.get("scale") else [])))
        t = y.get("text", "").replace("{teacher}", "[учителят]")
        w(f'| {it["id"]} | {t} | {" / ".join(o) if y.get("type") != "text" else "свободен текст"} |')


if __name__ == "__main__":
    main()
