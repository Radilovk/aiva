"""Builds questionnaire.json — the single source of truth for the survey.

Run:  python build_questionnaire.py   ->  writes questionnaire.json next to this file.

Conventions
-----------
roles     : "parent" | "student"
grades    : [min, max] school grade (1..12) the item applies to
stage     : I = 1-4, II = 5-7, III = 8-12 (derived from grade)
young     : student form for grade 4 (short, 3-point scales). Students in grades 1-3 do not fill a form.
score     : how an answer becomes 0..100 (None = context item, not scored)
show_if   : condition DSL, see engine.eval_cond
"""
import json, os

SCALES = {
    "freq5":  ["Никога", "Рядко", "Понякога", "Често", "Почти всеки ден"],
    "agree5": ["Изобщо не", "По-скоро не", "Отчасти", "По-скоро да", "Напълно"],
    "kid3_freq":  ["🙂 Никога", "😐 Понякога", "🙁 Често"],
    "kid3_agree": ["🙁 Не", "😐 Отчасти", "🙂 Да"],
    "yes_partly_no": ["Да", "Отчасти", "Не"],
    "one_to_five": ["1", "2", "3", "4", "5"],
    # WHO-5 Well-Being Index (Topp et al. 2015), answer 0 = best ("all of the time")
    "who5": ["През цялото време", "През повечето време", "Повече от половината време", "По-малко от половината време", "Понякога", "Никога"],
    # concrete behaviour counts for the last month – facts, not opinions
    "month4": ["Нито веднъж", "1–2 пъти", "Почти всяка седмица", "Почти всеки ден"],
    # HBSC Symptom Checklist frequencies, from rare to daily
    "hbsc5": ["Рядко или никога", "Около веднъж месечно", "Около веднъж седмично", "Няколко пъти седмично", "Почти всеки ден"],
    "sleep_hours": ["Под 7 часа", "7–8 часа", "8–9 часа", "9–10 часа", "Над 10 часа"],
}
MONTH4 = {"kind": "map", "values": [100, 60, 20, 0]}
# rows of a "grid" item share the scale; each row is answered on its own id
SCHOOL_VS_VACATION = [{"suffix": "_S", "label": "Когато има училище"}, {"suffix": "_V", "label": "През ваканцията"}]

ALL = [1, 12]
LIKERT_POS = {"kind": "likert", "polarity": 1}
LIKERT_NEG = {"kind": "likert", "polarity": -1}


def item(id, module, dim, text, *, roles=("parent", "student"), grades=ALL, scale=None, options=None,
         type="single", score=None, show_if=None, young=None, weight=1.0, core=True, aspect=None,
         repeat=None, hint=None, optional=True, notice=None, rows=None):
    it = {"id": id, "module": module, "dimension": dim, "roles": list(roles), "grades": list(grades),
          "type": type, "text": text, "weight": weight, "core": core, "optional": optional}
    if scale: it["scale"] = scale
    if options: it["options"] = options
    if score is not None: it["score"] = score
    if show_if: it["show_if"] = show_if
    if young: it["young"] = young
    if aspect: it["aspect"] = aspect
    if repeat: it["repeat"] = repeat
    if hint: it["hint"] = hint
    if notice: it["notice"] = notice
    if rows: it["rows"] = [{"id": id + r["suffix"], "label": r["label"]} for r in rows]
    return it


def T(parent, student=None):
    """Role-specific wording. student=None -> same as parent."""
    return {"parent": parent, "student": student or parent}


def q_in(qid, values):  return {"q": qid, "op": "in", "v": values}
def q_not(qid, values): return {"q": qid, "op": "not_in", "v": values}
def answered(qid):      return {"q": qid, "op": "answered"}
def grade(op, v):       return {"ctx": "grade", "op": op, "v": v}


items = []

# ---------------------------------------------------------------- PR: профил (не се оценява)
items += [
    item("PR01", "PR", None, T("Детето е:", "Ти си:"),
         options=["Момче", "Момиче", "Предпочитам да не казвам"],
         young={"text": "Ти си:", "options": ["Момче", "Момиче", "Не искам да кажа"]}),
    # Оценки: динамично по клас (Наредба № 11: I клас – обща качествена оценка; II–III – качествени по предмет)
    item("PR02A", "PR", None, T("Каква оценка получава обикновено детето?"), roles=["parent"], grades=[1, 1],
         options=["Отличен (звезда)", "Много добър (сърце)", "Добър (усмивка)", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02B_BEL", "PR", None, T("Каква оценка получава обикновено детето по български език и литература?"), roles=["parent"], grades=[2, 3],
         options=["Отличен", "Много добър", "Добър", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02B_MAT", "PR", None, T("Каква оценка получава обикновено детето по математика?"), roles=["parent"], grades=[2, 3],
         options=["Отличен", "Много добър", "Добър", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02C_BEL", "PR", None, T("Какви оценки получава обикновено детето по български език и литература?", "Какви оценки получаваш обикновено по български език и литература?"),
         grades=[4, 12], options=["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "Предимно 3 и 4", "Има и двойки", "Не знам / не искам да кажа"],
         young={"text": "Какви оценки получаваш обикновено по български език?", "options": ["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "По-ниски", "Не знам"]},
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02C_MAT", "PR", None, T("Какви оценки получава обикновено детето по математика?", "Какви оценки получаваш обикновено по математика?"),
         grades=[4, 12], options=["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "Предимно 3 и 4", "Има и слаби (2)", "Не знам / не искам да кажа"],
         young={"text": "Какви оценки получаваш обикновено по математика?", "options": ["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "По-ниски", "Не знам"]},
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR03", "PR", None, T("Остава ли детето в училище следобед на занималня (ЦОУД)?"),
         grades=[1, 7], options=["Да", "Не", "Понякога"], roles=["parent"]),
    item("PR04", "PR", None, T("Ходи ли детето на частни уроци по училищни предмети?", "Ходиш ли на частни уроци по училищни предмети?"),
         options=["Не", "Понякога", "Редовно (поне веднъж седмично)"]),
    item("PR05", "PR", None, T("Защо ходи на частни уроци?", "Защо ходиш на частни уроци?"), type="multi",
         options=["За да се справя с уроците и домашните", "За да навакса пропуснатото",
                  "За контролни и изпитвания", "За НВО или кандидатстване", "За състезания или по интерес", "Друго"],
         show_if=q_in("PR04", [1, 2])),
]

# ---------------------------------------------------------------- WL: натоварване
HW_DAY_OPTS = ["Под 15 мин", "15–30 мин", "30–45 мин", "45–60 мин", "60–90 мин", "90–120 мин", "2–3 часа", "Над 3 часа"]
HW_DAY_MIN = [10, 22.5, 37.5, 52.5, 75, 105, 150, 200]
HW_WE_OPTS = ["Нищо", "До 30 мин", "30–60 мин", "1–2 часа", "2–3 часа", "3–5 часа", "Над 5 часа"]
HW_WE_MIN = [0, 15, 45, 90, 150, 240, 330]
items += [
    item("WL01", "WL", "WL", T("Колко време отделя детето за домашни в обикновен учебен ден (заедно със занималнята)?",
                                "Колко време отделяш за домашни и учене в обикновен учебен ден?"),
         options=HW_DAY_OPTS, score={"kind": "norm", "norm": "homework_weekday", "minutes": HW_DAY_MIN}, weight=2.0,
         young={"text": "Колко време пишеш домашни след училище?", "options": ["Малко (под половин час)", "Около час", "Много (над час)"],
                "score": {"kind": "norm", "norm": "homework_weekday", "minutes": [20, 60, 100]}}),
    item("WL02", "WL", "WL", T("Колко време учи детето за училище през уикенда (събота и неделя общо)?",
                                "Колко време учиш за училище през уикенда (събота и неделя общо)?"),
         options=HW_WE_OPTS, score={"kind": "norm", "norm": "homework_weekend", "minutes": HW_WE_MIN}, weight=1.5),
    item("WL03", "WL", "WL", T("Имаше ли детето писмени задачи за последната ваканция?", "Имаше ли писмени задачи за последната ваканция?"),
         options=["Не", "Малко", "Много", "Не помня"], score={"kind": "map", "values": [100, 50, 0, None]}),
    item("WL04", "WL", "WL", T("Колко често се налага да обяснявате урока или да седите до детето, за да си напише домашните?",
                                "Колко често ти трябва помощ от възрастен, за да си напишеш домашните?"),
         grades=[1, 9], scale="freq5", score=LIKERT_NEG),
    item("WL05", "WL", "WL", T("Колко домашни има детето за възрастта си?", "Домашните ти са:"),
         options=["Твърде малко", "Колкото трябва", "Малко много", "Твърде много"], score={"kind": "map", "values": [75, 100, 50, 0]}),
    item("WL06", "WL", "WL", T("Колко контролни и класни има детето в най-натоварената седмица?",
                                "Колко контролни и класни имаш в най-натоварената седмица?"),
         grades=[5, 12], options=["0–1", "2", "3", "4 или повече"], score={"kind": "map", "values": [100, 75, 35, 0]}),
    item("WL07", "WL", "WL", T("Колко често домашните водят до напрежение или скандали вкъщи?",
                                "Колко често се изнервяш заради домашните?"),
         scale="freq5", score=LIKERT_NEG,
         young={"text": "Ядосваш ли се или плачеш заради домашните?", "scale": "kid3_freq", "score": LIKERT_NEG}),
]

# ---------------------------------------------------------------- SL: сън и свободно време
BED_OPTS = ["Преди 20:30", "20:30–21:00", "21:00–21:30", "21:30–22:00", "22:00–22:30", "22:30–23:00", "23:00–24:00", "След 24:00"]
BED_H = [20.25, 20.75, 21.25, 21.75, 22.25, 22.75, 23.5, 24.5]
WAKE_OPTS = ["Преди 6:00", "6:00–6:30", "6:30–7:00", "7:00–7:30", "След 7:30"]
WAKE_H = [5.75, 6.25, 6.75, 7.25, 7.75]
items += [
    item("SL01", "SL", None, T("В колко часа заспива обикновено детето в учебни дни?", "В колко часа заспиваш обикновено в учебни дни?"),
         options=BED_OPTS, hint=f"hours={BED_H}"),
    item("SL02", "SL", None, T("В колко часа става детето в учебни дни?", "В колко часа ставаш в учебни дни?"),
         options=WAKE_OPTS, hint=f"hours={WAKE_H}"),
    item("SL03", "SL", "SL", T("Случва ли се детето да си ляга по-късно заради домашни?", "Случва ли се да си лягаш по-късно заради домашни?"),
         options=["Никога", "Рядко", "Понякога", "Често"], score={"kind": "map", "values": [100, 70, 35, 0]}),
    item("SL04", "SL", "SL", T("Колко свободно време има детето в учебен ден – за игра или занимания по избор, без екрани и уроци?",
                                "Колко свободно време имаш в учебен ден за неща, които избираш ти – без телефон, компютър и уроци?"),
         options=["Под 30 мин", "30–60 мин", "1–2 часа", "Над 2 часа"], score={"kind": "map", "values": [0, 40, 80, 100]},
         young={"text": "Имаш ли време да играеш след училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SL05", "SL", "SL", T("В колко дни от седмицата детето се движи поне час – спорт, игри навън?",
                                "В колко дни от седмицата се движиш поне час – спорт, игри навън?"),
         options=["0–1", "2–3", "4–5", "6–7"], score={"kind": "map", "values": [0, 40, 75, 100]}),
    item("SL06", "SL", "SL", T("Отказвало ли се е детето от спорт, изкуство, приятели или време със семейството заради уроци и домашни?",
                                "Отказвал/а ли си се от спорт, приятели или хоби заради уроци и домашни?"),
         options=["Не", "Да, понякога", "Да, редовно"], score={"kind": "map", "values": [100, 50, 0]}),
]
DERIVED = [
    {"id": "SL_SLEEP", "dimension": "SL", "kind": "sleep_hours", "from": ["SL01", "SL02"],
     "bed_hours": BED_H, "wake_hours": WAKE_H, "score": {"kind": "norm", "norm": "sleep"}, "weight": 2.0},
    {"id": "SU_TUT", "dimension": "SU", "kind": "tutoring_to_keep_up", "from": ["PR04", "PR05"],
     "keep_up_options": [0, 1], "score": {"kind": "map_bool", "true": 0, "false": 100}, "weight": 0.5},
]

# ---------------------------------------------------------------- WB: благополучие
items += [
    # only the short grade-4 form: everyone else answers SC01 (school weeks vs vacation)
    item("WB01", "WB", "WB", T("", "Боли ли те глава или корем, когато имаш училище?"), roles=["student"], grades=[4, 4],
         scale="freq5", score=LIKERT_NEG, young={"text": "Боли ли те глава или корем, когато имаш училище?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("WB02", "WB", "WB", T("Колко често детето не иска да ходи на училище или е притеснено сутрин?", "Колко често не ти се ходи на училище или си притеснен/а сутрин?"),
         scale="freq5", score=LIKERT_NEG, young={"text": "Тъжен/тъжна или притеснен/а ли си сутрин преди училище?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("WB04", "WB", "WB", T("Колко често детето разказва с радост за нещо от училище?", "Колко често в училище научаваш неща, които ти харесват?"),
         scale="freq5", score=LIKERT_POS, young={"text": "Харесва ли ти да учиш нови неща в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("WB06", "WB", "WB", T("", "Чувствам се приет/а в класа."), roles=["student"], scale="agree5", score=LIKERT_POS,
         young={"text": "Имаш ли приятели в класа?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("WB07", "WB", "WB", T("Детето е под силен натиск заради оценките.", "Чувствам силен натиск заради оценките."),
         grades=[3, 12], scale="agree5", score=LIKERT_NEG),
]

# ---------------------------------------------------------------- TQ: качество на преподаването (класът като цяло)
items += [
    item("TQ01", "TQ", "TQ", T("Детето разбира повечето уроци в час и не се налага да ги учим отново вкъщи.",
                                "Повечето учители обясняват така, че разбирам."),
         scale="agree5", score=LIKERT_POS, young={"text": "Разбираш ли какво обяснява учителката?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TQ02", "TQ", "TQ", T("Детето разказва с интерес за часовете.", "Часовете са интересни и участвам активно."),
         scale="agree5", score=LIKERT_POS, young={"text": "Интересно ли ти е в час?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TQ03", "TQ", "TQ", T("Получавам ясна информация какво детето знае и какво да подобри.", "Когато сгреша, учителите ми показват как да се поправя."),
         scale="agree5", score=LIKERT_POS),
    item("TQ04", "TQ", "TQ", T("Изискванията са съобразени с възрастта на детето.", "Задачите в час са по силите ми – нито твърде лесни, нито непосилни."),
         scale="agree5", score=LIKERT_POS),
    item("TQ05", "TQ", "TQ", T("Колко често се налага вкъщи да обяснявате урок, който не е обяснен в час?", "Колко често учиш новите уроци вкъщи, защото не са обяснени в час?"),
         scale="freq5", score=LIKERT_NEG, weight=1.5),
]

# ---------------------------------------------------------------- TC: учител (повтаря се за всеки определен учител)
TC_REPEAT = "teacher"
items += [
    item("TC01", "TC", "TC", T("Класният ръководител се отнася с уважение към детето и към мен.", "{teacher} се отнася с уважение към учениците."),
         scale="agree5", score=LIKERT_POS, aspect="respect", repeat=TC_REPEAT, grades=[4, 12],
         young={"text": "{teacher} държи ли се мило с децата?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TC02", "TC", "TC", T("", "{teacher} обяснява ясно, а ако не разбера – обяснява по друг начин."),
         roles=["student"], scale="agree5", score=LIKERT_POS, aspect="clarity", repeat=TC_REPEAT, grades=[4, 12],
         young={"text": "{teacher} обяснява ли така, че да разбереш?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TC05", "TC", "TC", T("", "{teacher} оценява справедливо и казва предварително какво се изисква."), roles=["student"],
         scale="agree5", score=LIKERT_POS, aspect="fair_assessment", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC06", "TC", "TC", T("", "В часа на {teacher} има ред, без да се крещи или унижава."), roles=["student"],
         scale="agree5", score=LIKERT_POS, aspect="climate", repeat=TC_REPEAT, grades=[4, 4],
         young={"text": "Вика ли {teacher} на децата?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("TC10", "TC", "TC", T("", "През последния месец колко често {teacher} вика на ученици?"), roles=["student"],
         scale="month4", score=MONTH4, aspect="no_shouting", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC11", "TC", "TC", T("", "През последния месец колко често {teacher} се подиграва с грешките или оценките на ученици пред класа?"),
         roles=["student"], scale="month4", score=MONTH4, aspect="no_humiliation", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC08", "TC", "TC", T("Класният ръководител отговаря бързо и ясно на въпросите ми."), roles=["parent"],
         scale="agree5", score=LIKERT_POS, aspect="parent_communication", repeat=TC_REPEAT),
    item("TC09", "TC", "TC", T("Когато има проблем, класният ръководител го описва конкретно и предлага решение, а не само се оплаква."),
         roles=["parent"], scale="agree5", score=LIKERT_POS, aspect="parent_communication", repeat=TC_REPEAT),
]
# Parent-version TC01 applies from grade 1 (rated teacher = класен ръководител / начален учител)
for it in items:
    if it["id"] == "TC01":
        it["grades_by_role"] = {"parent": [1, 12], "student": [4, 12]}

# ---------------------------------------------------------------- WH: WHO-5 (валидиран индекс на благополучие, ученици 5–12 клас)
WHO = "През последните две седмици колко често "
items += [
    item("WH01", "WH", "WB", T("", WHO + "беше весел/а и в добро настроение?"), roles=["student"], grades=[5, 12], scale="who5", score=LIKERT_NEG),
    item("WH02", "WH", "WB", T("", WHO + "беше спокоен/спокойна и отпуснат/а?"), roles=["student"], grades=[5, 12], scale="who5", score=LIKERT_NEG),
    item("WH03", "WH", "WB", T("", WHO + "беше бодър/бодра и пълен/пълна с енергия?"), roles=["student"], grades=[5, 12], scale="who5", score=LIKERT_NEG),
    item("WH04", "WH", "WB", T("", WHO + "се събуждаше свеж/а и отпочинал/а?"), roles=["student"], grades=[5, 12], scale="who5", score=LIKERT_NEG),
    item("WH05", "WH", "WB", T("", WHO + "правеше неща, които са ти интересни?"), roles=["student"], grades=[5, 12], scale="who5", score=LIKERT_NEG),
]

# ---------------------------------------------------------------- SC: учебно време срещу ваканция (същото дете, два периода)
# The within-child contrast separates what the school period does from what the family or the child brings:
# a symptom that is frequent in school weeks and rare in the vacation is linked to school.
items += [
    item("SC01", "SC", None, T("Колко често детето има главоболие или болки в корема?", "Колко често те боли глава или корем?"), scale="hbsc5", type="grid", rows=SCHOOL_VS_VACATION),
    item("SC03", "SC", None, T("Колко често детето заспива трудно?", "Колко често заспиваш трудно?"), scale="hbsc5", type="grid", rows=SCHOOL_VS_VACATION),
    item("SC04", "SC", None, T("Колко често детето е в лошо настроение, раздразнено или тъжно?", "Колко често си в лошо настроение, раздразнен/а или тъжен/тъжна?"),
         scale="hbsc5", type="grid", rows=SCHOOL_VS_VACATION),
    item("SC06", "SC", None, T("Колко часа спи детето на нощ?", "Колко часа спиш на нощ?"), scale="sleep_hours", type="grid", rows=SCHOOL_VS_VACATION),
]

# ---------------------------------------------------------------- HP: практики с доказан вреден ефект (факти за последния месец)
items += [
    item("HP01", "HP", "CD", T("Колко пъти през последния месец детето е разказвало, че учител вика на ученици?",
                               "Колко пъти през последния месец учител е викал на ученици в класа ти?"),
         scale="month4", score=MONTH4, weight=1.5),
    item("HP02", "HP", "CD", T("Колко пъти през последния месец целият клас е бил наказан заради един или няколко ученици?"),
         scale="month4", score=MONTH4),
    item("HP03", "HP", "CD", T("Колко пъти през последния месец учител е заплашвал с двойка или наказание, за да има тишина?"),
         scale="month4", score=MONTH4),
    item("HP04", "HP", "CD", T("Колко пъти през последния месец детето е било отстранено от час?",
                               "Колко пъти през последния месец ученици са били отстранявани от час?"),
         scale="month4", score=MONTH4),
    item("HP05", "HP", "SF", T("През последния месец детето казвало ли е, че възрастен в училище е ударил, дръпнал грубо или блъснал дете?",
                               "През последния месец виждал/а ли си възрастен в училище да удари, да дръпне грубо или да блъсне ученик?"),
         options=["Не", "Да, веднъж", "Да, повече от веднъж", "Не знам"], score={"kind": "map", "values": [100, 0, 0, None]}, weight=2.0),
    item("HP06", "HP", "CD", T("Тази година случвало ли се е учител да постави на детето по-ниска оценка заради поведение, а не заради знания?",
                               "Тази година случвало ли се е учител да ти постави по-ниска оценка заради поведение, а не заради знанията ти?"),
         options=["Не", "Да", "Не знам"], score={"kind": "map", "values": [100, 0, None]}),
]
for it in items:
    if it["module"] == "HP":
        it.pop("grades_by_role", None)
        it["grades_by_role"] = {"parent": [1, 12], "student": [4, 12]}

# ---------------------------------------------------------------- SU: подкрепа и справедливост
items += [
    item("SU01", "SU", "SU", T("Когато детето изостане, училището предлага помощ (консултации, допълнителни часове).",
                                "Когато не разбирам нещо, в училище ми помагат."),
         scale="agree5", score=LIKERT_POS, young={"text": "Ако не разбереш нещо, помагат ли ти в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SU02", "SU", "SU", T("Учителите се отнасят еднакво справедливо към всички деца в класа.", "Учителите се отнасят еднакво справедливо към всички ученици."),
         scale="agree5", score=LIKERT_POS),
    item("SU03", "SU", "SU", T("Детето би се справило с училището без помощ от родител или частен учител.",
                                "Мога да се справям с училището без частни уроци."),
         scale="yes_partly_no", score={"kind": "map", "values": [100, 50, 0]}),
]

# ---------------------------------------------------------------- CD: климат и дисциплина
items += [
    item("CD01", "CD", "CD", T("Правилата в класа са ясни и се прилагат еднакво към всички.", "Правилата в класа са ясни и важат еднакво за всички."),
         scale="agree5", score=LIKERT_POS, young={"text": "Ясно ли ти е какви са правилата в класа?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("CD02", "CD", None, T("Колко бележки или съобщения за поведението на детето получихте през последния месец?"),
         roles=["parent"], options=["Нито една", "1", "2–3", "4 или повече"]),
    item("CD03", "CD", None, T("За какво се отнасяха?"), roles=["parent"], type="multi",
         options=["Игра или гонене", "Закачки или бутане по време на игра", "Говорене или смях в час", "Бавно или неохотно изпълнение на задача",
                  "Спор с друго дете", "Удар или нараняване нарочно", "Друго"], show_if=q_in("CD02", [1, 2, 3])),
    item("CD04", "CD", "CD", T("Описваше ли се конкретно какво се е случило (кога, какво, кой е видял)?"), roles=["parent"],
         options=["Да", "Отчасти", "Не"], score={"kind": "map", "values": [100, 50, 0]}, show_if=q_in("CD02", [1, 2, 3])),
    item("CD05", "CD", None, T("Поведението беше ли наречено „агресия“, „насилие“ или „тормоз“?"), roles=["parent"],
         options=["Да", "Не"], show_if=q_in("CD02", [1, 2, 3])),
    item("CD06", "CD", "CD", T("Според вас така ли беше наистина?"), roles=["parent"],
         options=["Напълно", "Отчасти", "Не", "Не знам"], score={"kind": "map", "values": [100, 50, 0, None]}, show_if=q_in("CD05", [0])),
    item("CD08", "CD", "CD", T("Случвало ли се е детето да бъде лишено от междучасие или игра навън като наказание?",
                                "Случвало ли се е да те лишат от междучасие или игра навън като наказание?"),
         grades=[1, 7], options=["Никога", "Веднъж", "Повече от веднъж", "Не знам"], score={"kind": "map", "values": [100, 40, 0, None]}),
    item("CD09", "CD", "CD", T("Колко често детето разказва, че учител го е засрамил пред класа?", "Колко често учители коментират грешките или оценките на ученици пред класа по унизителен начин?"),
         scale="freq5", score=LIKERT_NEG, weight=1.5, young={"text": "Срамува ли те учител пред другите деца?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("CD10", "CD", "CD", T("", "Колко често обикновената игра в междучасието (гонене, закачки) се наказва като агресия?"),
         roles=["student"], grades=[4, 9], scale="freq5", score=LIKERT_NEG,
         young={"text": "Наказват ли децата, когато просто играят и се гонят?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("CD11", "CD", "CD", T("", "Мога да кажа мнението си на учител, без да се страхувам."), roles=["student"], scale="agree5", score=LIKERT_POS,
         young={"text": "Можеш ли да кажеш на учителката, когато не си съгласен/съгласна?", "scale": "kid3_agree", "score": LIKERT_POS}),
]

# ---------------------------------------------------------------- SF: безопасност
items += [
    item("SF01", "SF", "SF", T("През последния месец детето казвало ли е, че други деца нарочно и многократно го обиждат, удрят или изолират?",
                                "През последния месец случвало ли се е други деца нарочно и многократно да те обиждат, удрят или изолират?"),
         options=["Не", "1–2 пъти", "Няколко пъти", "Почти всяка седмица"], score={"kind": "map", "values": [100, 60, 20, 0]}, weight=1.5,
         young={"text": "Случва ли се други деца да те обиждат или удрят?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("SF02", "SF", "SF", T("Когато сте казали на училището, реагираха ли както трябва?", "Когато си казал/а на възрастен в училище, помогна ли ти?"),
         options=["Не сме / не съм казвал(а)", "Да", "Отчасти", "Не"], score={"kind": "map", "values": [None, 100, 50, 0]},
         show_if=q_in("SF01", [1, 2, 3])),
    item("SF03", "SF", "SF", T("Детето се чувства в безопасност в училище.", "Чувствам се в безопасност в училище."),
         scale="agree5", score=LIKERT_POS, young={"text": "Чувстваш ли се спокойно и в безопасност в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SF90", "SF", None, T("", "Ако някой те наранява или ти е тежко, можеш да говориш с възрастен, на когото имаш доверие, или да се обадиш безплатно на Националната телефонна линия за деца 116 111."),
         roles=["student"], type="notice", show_if={"any": [q_in("SF01", [2, 3]), q_in("WB02", [4])]}),
]

# ---------------------------------------------------------------- CP: комуникация и партньорство
items += [
    item("CP01", "CP", "CP", T("Получавам навреме информацията, която ми е нужна (оценки, събития, промени)."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP02", "CP", "CP", T("Мога да не се съглася с учител или с директора, без това да се отрази на детето."), roles=["parent"],
         scale="yes_partly_no", score={"kind": "map", "values": [100, 50, 0]}, weight=1.5),
    item("CP03", "CP", "CP", T("Съобщенията от училището са учтиви и конкретни."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP04", "CP", "CP", T("Мнението на родителите се взема предвид при решения, които засягат децата."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP05", "CP", "CP", T("", "Учителите ни питат какво мислим (например за начина на работа или за домашните)."), roles=["student"],
         grades=[5, 12], scale="agree5", score=LIKERT_POS),
]

# ---------------------------------------------------------------- SY: система (планирано попълване от 50% от анкетираните)
items += [
    item("SY01", "SY", "SY", T("Учебният материал е съобразен с възрастта на детето.", "Материалът е толкова, че може да се научи в училище."),
         scale="agree5", score=LIKERT_POS),
    item("SY02", "SY", "SY", T("Учебниците са разбираеми за детето без допълнителна помощ.", "Учебниците са разбираеми без допълнителна помощ."),
         scale="agree5", score=LIKERT_POS),
    item("SY03", "SY", "SY", T("Подготовката за НВО създава прекалено много стрес.",
                                "Подготовката за НВО или матурите ми създава прекалено много стрес."),
         grades=[4, 12], scale="agree5", score=LIKERT_NEG),
    item("SY04", "SY", "SY", T("Учебният ден (продължителност, смени, разписание) е подходящ за възрастта на детето.",
                                "Учебният ден (продължителност, смени, разписание) е разумен."), scale="agree5", score=LIKERT_POS),
    item("SY05", "SY", "SY", T("Училището подготвя децата за реалния живот.", "Това, което уча, ще ми е полезно в живота."),
         scale="agree5", score=LIKERT_POS),
]

# ---------------------------------------------------------------- OT: свободни отговори
items += [
    item("OT01", "OT", None, T("Какво цените най-много в училището?", "Какво ти харесва най-много в училището?"), type="text"),
    item("OT02", "OT", None, T("Какво бихте променили в училище?", "Какво би променил/а в училище?"), type="text",
         young={"text": "Какво би искал/а да е различно в училище?", "type": "text"}),
    item("OT03", "OT", None, T("Искате ли да опишете конкретен случай? Моля, без имена на деца и учители.",
                                "Искаш ли да разкажеш за конкретен случай? Моля, без имена."), type="text"),
]

MODULES = [
    {"id": "PR", "title": "Профил", "scored": False},
    {"id": "WL", "title": "Натоварване", "scored": True},
    {"id": "SL", "title": "Сън и свободно време", "scored": True},
    {"id": "WB", "title": "Благополучие", "scored": True},
    {"id": "WH", "title": "Последните две седмици", "scored": True},
    {"id": "SC", "title": "Учебно време и ваканция", "scored": False},
    {"id": "TQ", "title": "Преподаване в класа", "scored": True},
    {"id": "TC", "title": "Учители", "scored": True, "repeat": "teacher"},
    {"id": "SU", "title": "Подкрепа и справедливост", "scored": True},
    {"id": "CD", "title": "Климат и дисциплина", "scored": True},
    {"id": "SF", "title": "Безопасност", "scored": True},
    {"id": "HP", "title": "Какво се случва в час", "scored": True},
    {"id": "CP", "title": "Комуникация", "scored": True},
    {"id": "SY", "title": "Образователната система", "scored": True, "sampling_rate": 0.5},
    {"id": "OT", "title": "Вашите думи", "scored": False},
]

DIMENSIONS = {
    "WL": {"name": "Натоварване", "pillar": "A", "role_weights": {"parent": 0.5, "student": 0.5}},
    "SL": {"name": "Сън и свободно време", "pillar": "A", "role_weights": {"parent": 0.5, "student": 0.5}},
    "WB": {"name": "Благополучие", "pillar": "A", "role_weights": {"parent": 0.5, "student": 0.5}},
    "TQ": {"name": "Качество на преподаването", "pillar": "B", "role_weights": {"parent": 0.3, "student": 0.7}},
    "TC": {"name": "Учители", "pillar": "B", "role_weights": {"parent": 0.2, "student": 0.8}},
    "SU": {"name": "Подкрепа и справедливост", "pillar": "B", "role_weights": {"parent": 0.5, "student": 0.5}},
    "CD": {"name": "Климат и дисциплина", "pillar": "C", "role_weights": {"parent": 0.5, "student": 0.5}},
    "SF": {"name": "Безопасност", "pillar": "C", "role_weights": {"parent": 0.4, "student": 0.6}},
    "CP": {"name": "Комуникация и партньорство", "pillar": "C", "role_weights": {"parent": 0.8, "student": 0.2}},
    "SY": {"name": "Образователна система", "pillar": "SYS", "role_weights": {"parent": 0.5, "student": 0.5}},
}
PILLARS = {
    "A": {"name": "Баланс и благополучие", "weight": 0.35},
    "B": {"name": "Учене и преподаване", "weight": 0.35},
    "C": {"name": "Среда и отношения", "weight": 0.30},
}

# Indicators: binary per respondent (engine._indicators). Each has the evidence for why it matters.
INDICATORS = {
    "low_wellbeing": {"label": "Ниско благополучие (WHO-5 ≤ 50)", "roles": ["student"],
                      "evidence": "Утвърден въпросник на СЗО. Резултат до 50 показва риск от депресия – добре е детето да поговори със специалист.",
                      "sources": ["Topp и др., 2015"]},
    "very_low_wellbeing": {"label": "Много ниско благополучие (WHO-5 ≤ 28)", "roles": ["student"],
                           "evidence": "Резултат до 28 е сериозен признак за депресия.", "sources": ["Topp и др., 2015"]},
    "school_worse": {"label": "По-зле в учебно време, отколкото във ваканция", "roles": ["parent", "student"],
                     "evidence": "Едно и също дете се сравнява със себе си, така че разликата идва от учебния период, а не от семейството.",
                     "sources": ["Въпросник за симптоми на HBSC"]},
    "psychosomatic_often": {"label": "Главоболие или болки в корема поне веднъж седмично", "roles": ["parent", "student"],
                            "evidence": "Честите болки без медицинска причина са ранен признак на стрес.", "sources": ["HBSC, СЗО"]},
    "sleep_short": {"label": "Спи по-малко от препоръчаното за възрастта", "roles": ["parent", "student"],
                    "evidence": "Недоспиването влошава вниманието и настроението и увеличава риска от наднормено тегло.", "sources": ["AASM, 2016"]},
    "homework_over_norm": {"label": "Домашни много над нормата за класа", "roles": ["parent", "student"],
                           "evidence": "Над „10 минути на клас“ ползата за ученето намалява, а стресът и скандалите вкъщи растат.", "sources": ["Cooper и др., 2006"]},
    "bullying_repeated": {"label": "Тормоз от други деца", "roles": ["parent", "student"],
                          "evidence": "Тормоз два-три пъти месечно и по-често удвоява риска от тревожност и депресия.", "sources": ["HBSC; Moore и др., 2017"]},
    "shouting_weekly": {"label": "Учители викат на ученици всяка седмица", "roles": ["parent", "student"],
                        "evidence": "Децата, на които учителите редовно викат, имат повече емоционални и поведенчески проблеми.",
                        "sources": ["Brendgen и др., 2006"]},
    "class_punishment": {"label": "Наказание на целия клас заради един или няколко", "roles": ["parent", "student"],
                         "evidence": "Колективното наказание наказва и невинните и разрушава доверието.", "sources": []},
    "threats_weekly": {"label": "Заплахи с двойка или наказание всяка седмица", "roles": ["parent", "student"],
                       "evidence": "Редът чрез страх намалява желанието за учене и засилва тревожността.", "sources": ["Reeve, 2009"]},
    "sent_out": {"label": "Отстраняване от час", "roles": ["parent", "student"],
                 "evidence": "Отстраняването е позволена мярка, но когато е често, детето губи учебно време.", "sources": []},
    "physical_force": {"label": "Възрастен е ударил, дръпнал или блъснал дете", "roles": ["parent", "student"],
                       "evidence": "Физическото наказание на дете е недопустимо. Всяко такова съобщение трябва да се провери.", "sources": []},
    "grade_as_punishment": {"label": "По-ниска оценка заради поведение", "roles": ["parent", "student"],
                            "evidence": "Оценката трябва да показва знанията. Когато се използва като наказание, губи смисъла си.", "sources": []},
    "recess_removed": {"label": "Отнето междучасие като наказание", "roles": ["parent", "student"],
                       "evidence": "Педиатрите съветват междучасието да не се отнема като наказание – децата имат нужда от движение и почивка.",
                       "sources": ["Американска академия по педиатрия, 2013"]},
    "labelled_aggression_disputed": {"label": "Игра, наречена „агресия“, с което родителят не е съгласен", "roles": ["parent"],
                                     "evidence": "Обичайната игра, наречена агресия, води до наказания без основание.", "sources": []},
}

# Signals: when a unit's rate is clearly above the national rate (same wave, same stage). Two-sided protection:
# enough respondents, a meaningful size, and statistical certainty (Wilson 95% lower bound above the reference).
#   rate   : share of respondents with the indicator
#   count  : at least min_count independent reports AND share >= abs_min (rare, serious events)
#   contrast: school-weeks minus vacation symptom score, lower bound above min_delta points
SIGNALS = [
    {"id": "physical_force", "indicator": "physical_force", "kind": "count", "levels": ["class", "school"], "min_count": 3, "abs_min": 0.10, "severity": "high"},
    {"id": "shouting", "indicator": "shouting_weekly", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.20},
    {"id": "teacher_shouting", "indicator": "teacher_shouting", "kind": "rate", "levels": ["teacher"], "min_n": 10, "rr": 1.5, "abs_min": 0.25},
    {"id": "teacher_humiliation", "indicator": "teacher_humiliation", "kind": "rate", "levels": ["teacher"], "min_n": 10, "rr": 1.5, "abs_min": 0.20},
    {"id": "bullying", "indicator": "bullying_repeated", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.15},
    {"id": "low_wellbeing", "indicator": "low_wellbeing", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.30},
    {"id": "school_effect", "kind": "contrast", "levels": ["class", "school"], "min_n": 10, "min_delta": 10.0},
    {"id": "sleep", "indicator": "sleep_short", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.3, "abs_min": 0.40},
    {"id": "homework", "indicator": "homework_over_norm", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.30},
    {"id": "class_punishment", "indicator": "class_punishment", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.30},
    {"id": "threats", "indicator": "threats_weekly", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.20},
    {"id": "grade_as_punishment", "indicator": "grade_as_punishment", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.15},
    {"id": "recess", "indicator": "recess_removed", "kind": "rate", "levels": ["class", "school"], "min_n": 10, "rr": 1.5, "abs_min": 0.20},
]
TEACHER_INDICATORS = {
    "teacher_shouting": {"label": "Учителят вика на ученици всяка седмица", "aspect": "no_shouting",
                         "evidence": INDICATORS["shouting_weekly"]["evidence"], "sources": INDICATORS["shouting_weekly"]["sources"]},
    "teacher_humiliation": {"label": "Учителят се подиграва с грешките на ученици всяка седмица", "aspect": "no_humiliation",
                            "evidence": "Публичното засрамване от учител води до тревожност, отказ от училище и по-слаб успех.",
                            "sources": ["Brendgen и др., 2006"]},
}

# Policy parameters (calibrate after the pilot; published with every release)
PARAMS = {
    "stages": {"I": [1, 4], "II": [5, 7], "III": [8, 12]},
    "student_min_grade": 4,
    "young_student_grades": [4, 4],
    "young_student_weight_factor": 0.5,
    "norms": {
        "homework_weekday": {"minutes_per_grade": 10, "cap_minutes": 120, "zero_at_multiple": 3.0,
                             "source": "Ориентир „10 минути на клас“ (Cooper; NEA/PTA) – препоръка, не норма"},
        "homework_weekend": {"multiple_of_weekday_norm": 1.0, "zero_at_multiple": 4.0,
                             "source": "Параметър на модела – подлежи на калибриране"},
        "sleep": {"min_hours_by_grade": {"1-6": 9, "7-12": 8}, "points_lost_per_hour": 40,
                  "source": "AASM 2016: 6–12 г. 9–12 ч; 13–18 г. 8–10 ч"},
    },
    "coverage": {"min_share": 0.5, "min_items": 1},
    "k_anonymity": {"role_cell": 5, "unit_min": 5, "teacher_min_students": 10, "subgroup_cell": 5,
                    "subgroup_unit_min": 20, "free_text_min": 10},
    "quality": {"min_seconds": 90, "exclude_below_median_share": 0.3, "flag_below_median_share": 0.5,
                "straightline_min_items": 8, "flag_weight": 0.5, "open_mode_weight": 0.5},
    "shrinkage": {"default_tau2": 64.0, "min_units_for_tau2": 10, "tau2_floor": 4.0},
    "interval_z": 1.645,
    "bootstrap_reps": 400,
    "tiers": {"delta_share_of_sd": 0.25, "delta_min": 3.0, "max_ci_width": 20.0,
              "labels": {"2": "Значително над средното", "1": "Над средното", "0": "Около средното",
                         "-1": "Под средното", "-2": "Значително под средното", "na": "Недостатъчно данни"}},
    "absolute_bands": [[80, "Добро"], [60, "Приемливо"], [40, "Тревожно"], [0, "Критично"]],
    "teacher_assignment": {"always_class_teacher": True, "extra_teachers": 2},
    "equity": {"flag_gap": 10.0, "z": 1.96},
    "grade_bands": {"5": "силни", "4": "силни", "3": "средни", "2": "затрудняващи се", "1": "затрудняващи се"},
    "who5": {"low": 50, "very_low": 28, "source": "Topp et al. 2015, Psychother Psychosom – WHO-5: ≤50 ниско благополучие, ≤28 вероятна депресия (скрининг, не диагноза)"},
    "homework_over_multiple": 1.5,
    "contrast": {"symptoms": ["SC01", "SC03", "SC04"], "sleep": "SC06",
                 "sleep_midpoints": [6.5, 7.5, 8.5, 9.5, 10.5], "worse_steps": 1, "worse_min_symptoms": 2},
    "signals": SIGNALS,
}

doc = {"version": "2.0.0", "language": "bg", "scales": SCALES, "modules": MODULES, "dimensions": DIMENSIONS,
       "pillars": PILLARS, "params": PARAMS, "items": items, "derived": DERIVED,
       "indicators": INDICATORS, "teacher_indicators": TEACHER_INDICATORS}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "questionnaire.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} items, {len(DERIVED)} derived -> {out}")
