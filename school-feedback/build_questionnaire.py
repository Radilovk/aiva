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
}

ALL = [1, 12]
LIKERT_POS = {"kind": "likert", "polarity": 1}
LIKERT_NEG = {"kind": "likert", "polarity": -1}


def item(id, module, dim, text, *, roles=("parent", "student"), grades=ALL, scale=None, options=None,
         type="single", score=None, show_if=None, young=None, weight=1.0, core=True, aspect=None,
         repeat=None, hint=None, optional=True, notice=None):
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
         options=["Момче", "Момиче", "Предпочитам да не посоча"],
         young={"text": "Ти си:", "options": ["Момче", "Момиче", "Не искам да кажа"]}),
    # Оценки: динамично по клас (Наредба № 11: I клас – обща качествена оценка; II–III – качествени по предмет)
    item("PR02A", "PR", None, T("Каква е обичайната оценка на детето в I клас?"), roles=["parent"], grades=[1, 1],
         options=["Отличен (звезда)", "Много добър (сърце)", "Добър (усмивка)", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02B_BEL", "PR", None, T("Обичайна оценка по български език и литература:"), roles=["parent"], grades=[2, 3],
         options=["Отличен", "Много добър", "Добър", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02B_MAT", "PR", None, T("Обичайна оценка по математика:"), roles=["parent"], grades=[2, 3],
         options=["Отличен", "Много добър", "Добър", "Задоволителен", "Незадоволителен", "Не знам"],
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02C_BEL", "PR", None, T("Обичайни оценки по български език и литература:", "Обичайните ти оценки по български език и литература:"),
         grades=[4, 12], options=["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "Предимно 3 и 4", "Има и слаби (2)", "Не знам / не искам да кажа"],
         young={"text": "Какви оценки получаваш обикновено по български език?", "options": ["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "По-ниски", "Не знам"]},
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR02C_MAT", "PR", None, T("Обичайни оценки по математика:", "Обичайните ти оценки по математика:"),
         grades=[4, 12], options=["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "Предимно 3 и 4", "Има и слаби (2)", "Не знам / не искам да кажа"],
         young={"text": "Какви оценки получаваш обикновено по математика?", "options": ["Предимно 6", "Предимно 5 и 6", "Предимно 4 и 5", "По-ниски", "Не знам"]},
         hint="derived:grade_band=[5,4,3,2,1,null]"),
    item("PR03", "PR", None, T("Детето посещава ли целодневна организация (ЦОУД)?", "Оставаш ли в училище следобед на занималня (ЦОУД)?"),
         grades=[1, 7], options=["Да", "Не", "Понякога"], roles=["parent"]),
    item("PR04", "PR", None, T("Ползва ли детето частни уроци по предмети от училищната програма?", "Ходиш ли на частни уроци по училищни предмети?"),
         options=["Не", "Да, понякога", "Да, редовно (поне веднъж седмично)"]),
    item("PR05", "PR", None, T("Основна причина за частните уроци:", "Защо ходиш на частни уроци?"), type="multi",
         options=["За да се справя с текущия материал или домашните", "За да навакса изоставане",
                  "За подготовка за контролни и изпитвания", "За подготовка за изпит за прием (НВО, кандидатстване)",
                  "За развитие извън програмата (състезания, интереси)", "Друго"],
         show_if=q_in("PR04", [1, 2])),
    item("PR06", "PR", None, T("По кои предмети?"), type="multi",
         options=["Български език и литература", "Математика", "Чужд език", "Природни науки", "Друг"],
         show_if=q_in("PR04", [1, 2])),
    item("PR07", "PR", None, T("Детето получава ли допълнителна подкрепа в училище (ресурсен учител, логопед, психолог)?"),
         roles=["parent"], options=["Да", "Не", "Не знам", "Предпочитам да не посоча"]),
]

# ---------------------------------------------------------------- WL: натоварване
HW_DAY_OPTS = ["Под 15 мин", "15–30 мин", "30–45 мин", "45–60 мин", "60–90 мин", "90–120 мин", "2–3 часа", "Над 3 часа"]
HW_DAY_MIN = [10, 22.5, 37.5, 52.5, 75, 105, 150, 200]
HW_WE_OPTS = ["Нищо", "До 30 мин", "30–60 мин", "1–2 часа", "2–3 часа", "3–5 часа", "Над 5 часа"]
HW_WE_MIN = [0, 15, 45, 90, 150, 240, 330]
items += [
    item("WL01", "WL", "WL", T("Колко време средно отделя детето за домашни в делничен ден (след училище/ЦОУД)?",
                                "Колко време средно учиш и пишеш домашни в делничен ден?"),
         options=HW_DAY_OPTS, score={"kind": "norm", "norm": "homework_weekday", "minutes": HW_DAY_MIN}, weight=2.0,
         young={"text": "Колко време пишеш домашни след училище?", "options": ["Малко (под половин час)", "Около час", "Много (над час)"],
                "score": {"kind": "norm", "norm": "homework_weekday", "minutes": [20, 60, 100]}}),
    item("WL02", "WL", "WL", T("Колко време общо отделя детето за училищни задачи през събота и неделя?",
                                "Колко време общо учиш за училище през събота и неделя?"),
         options=HW_WE_OPTS, score={"kind": "norm", "norm": "homework_weekend", "minutes": HW_WE_MIN}, weight=1.5),
    item("WL03", "WL", "WL", T("През последната ваканция имаше ли детето писмени задачи?", "През последната ваканция имаше ли писмени задачи?"),
         options=["Не", "Да, малко", "Да, много", "Не помня"], score={"kind": "map", "values": [100, 50, 0, None]}),
    item("WL04", "WL", "WL", T("Колко често е нужно родител да обяснява материала или да седи до детето, за да довърши домашните?",
                                "Колко често ти трябва помощ от възрастен, за да довършиш домашните?"),
         grades=[1, 9], scale="freq5", score=LIKERT_NEG),
    item("WL05", "WL", "WL", T("Как оценявате общия обем на домашните за възрастта на детето?", "Обемът на домашните е:"),
         options=["Твърде малък", "Подходящ", "Малко голям", "Твърде голям"], score={"kind": "map", "values": [75, 100, 50, 0]}),
    item("WL06", "WL", "WL", T("Колко контролни, класни и тестове има детето най-много в една седмица?",
                                "Колко контролни, класни и тестове имаш най-много в една седмица?"),
         grades=[5, 12], options=["0–1", "2", "3", "4 или повече"], score={"kind": "map", "values": [100, 75, 35, 0]}),
    item("WL07", "WL", "WL", T("Колко често домашните водят до напрежение или конфликт вкъщи?",
                                "Колко често се чувстваш напрегнат/а заради домашните?"),
         scale="freq5", score=LIKERT_NEG,
         young={"text": "Ядосваш ли се или плачеш заради домашните?", "scale": "kid3_freq", "score": LIKERT_NEG}),
]

# ---------------------------------------------------------------- SL: сън и свободно време
BED_OPTS = ["Преди 20:30", "20:30–21:00", "21:00–21:30", "21:30–22:00", "22:00–22:30", "22:30–23:00", "23:00–24:00", "След 24:00"]
BED_H = [20.25, 20.75, 21.25, 21.75, 22.25, 22.75, 23.5, 24.5]
WAKE_OPTS = ["Преди 6:00", "6:00–6:30", "6:30–7:00", "7:00–7:30", "След 7:30"]
WAKE_H = [5.75, 6.25, 6.75, 7.25, 7.75]
items += [
    item("SL01", "SL", None, T("В делничен ден в колко часа обикновено заспива детето?", "В делничен ден в колко часа обикновено заспиваш?"),
         options=BED_OPTS, hint=f"hours={BED_H}"),
    item("SL02", "SL", None, T("В колко часа обикновено става детето в учебен ден?", "В колко часа ставаш в учебен ден?"),
         options=WAKE_OPTS, hint=f"hours={WAKE_H}"),
    item("SL03", "SL", "SL", T("Случва ли се лягането да се отлага заради домашни?", "Случва ли се да лягаш по-късно заради домашни?"),
         options=["Никога", "Рядко", "Понякога", "Често"], score={"kind": "map", "values": [100, 70, 35, 0]}),
    item("SL04", "SL", "SL", T("Колко свободно време има детето в делничен ден (игра или занимания по свой избор, без екрани и без уроци)?",
                                "Колко свободно време имаш в делничен ден за неща по твой избор (без екрани и уроци)?"),
         options=["Под 30 мин", "30–60 мин", "1–2 часа", "Над 2 часа"], score={"kind": "map", "values": [0, 40, 80, 100]},
         young={"text": "Имаш ли време да играеш след училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SL05", "SL", "SL", T("В колко дни от седмицата детето се движи активно поне 1 час (спорт, игри навън)?",
                                "В колко дни от седмицата се движиш активно поне 1 час?"),
         options=["0–1", "2–3", "4–5", "6–7"], score={"kind": "map", "values": [0, 40, 75, 100]}),
    item("SL06", "SL", "SL", T("Отказали ли сте занимание (спорт, изкуство, приятели, семейно време) заради училищни задачи?",
                                "Отказвал/а ли си занимание (спорт, приятели, хоби) заради училищни задачи?"),
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
    item("WB01", "WB", "WB", T("Детето се оплаква от главоболие или коремна болка в учебни дни.", "Боли ме глава или корем в учебни дни."),
         scale="freq5", score=LIKERT_NEG, young={"text": "Боли ли те глава или корем, когато имаш училище?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("WB02", "WB", "WB", T("Детето не иска да ходи на училище или е тревожно сутрин.", "Не ми се ходи на училище или сутрин съм тревожен/тревожна."),
         scale="freq5", score=LIKERT_NEG, young={"text": "Тъжен/тъжна или притеснен/а ли си сутрин преди училище?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("WB03", "WB", "WB", T("Детето изглежда уморено, раздразнително или безразлично след училище.", "След училище съм изтощен/а или раздразнен/а."),
         scale="freq5", score=LIKERT_NEG),
    item("WB04", "WB", "WB", T("Детето говори с радост за нещо, научено или преживяно в училище.", "Научавам в училище неща, които ми харесват."),
         scale="freq5", score=LIKERT_POS, young={"text": "Харесва ли ти да учиш нови неща в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("WB05", "WB", "WB", T("Отношението на детето към ученето в момента е:", "Отношението ми към ученето в момента е:"),
         options=["С желание", "Неутрално", "С нежелание", "С отказ"], score={"kind": "map", "values": [100, 66, 33, 0]}),
    item("WB06", "WB", "WB", T("", "Чувствам се част от класа и училището."), roles=["student"], scale="agree5", score=LIKERT_POS,
         young={"text": "Имаш ли приятели в класа?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("WB07", "WB", "WB", T("Детето е под силен натиск заради оценките.", "Чувствам се под силен натиск заради оценките."),
         grades=[3, 12], scale="agree5", score=LIKERT_NEG),
]

# ---------------------------------------------------------------- TQ: качество на преподаването (класът като цяло)
items += [
    item("TQ01", "TQ", "TQ", T("Детето разбира повечето обяснения в час, без да се налага да го учим наново вкъщи.",
                                "Повечето учители обясняват така, че да разбера."),
         scale="agree5", score=LIKERT_POS, young={"text": "Разбираш ли какво обяснява учителката?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TQ02", "TQ", "TQ", T("Детето разказва за интересни неща от часовете.", "В часовете е интересно и участвам активно."),
         scale="agree5", score=LIKERT_POS, young={"text": "Интересно ли ти е в час?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TQ03", "TQ", "TQ", T("Получавам ясна информация какво детето знае и какво да подобри.", "Когато сгреша, учителите ми показват как да се поправя."),
         scale="agree5", score=LIKERT_POS),
    item("TQ04", "TQ", "TQ", T("Изискванията са съобразени с възрастта на детето.", "Задачите в час са по силите ми – нито прекалено лесни, нито невъзможни."),
         scale="agree5", score=LIKERT_POS),
    item("TQ05", "TQ", "TQ", T("Налага се вкъщи да преподаваме материал, който не е обяснен в час.", "Голяма част от новия материал реално го уча вкъщи, а не в час."),
         scale="freq5", score=LIKERT_NEG, weight=1.5),
]

# ---------------------------------------------------------------- TC: учител (повтаря се за всеки определен учител)
TC_REPEAT = "teacher"
items += [
    item("TC01", "TC", "TC", T("Класният ръководител се отнася с уважение към детето и към мен.", "{teacher} се отнася с уважение към всички ученици."),
         scale="agree5", score=LIKERT_POS, aspect="respect", repeat=TC_REPEAT, grades=[4, 12],
         young={"text": "{teacher} държи ли се мило с децата?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TC02", "TC", "TC", T("", "{teacher} обяснява ясно; ако не разбера, обяснява по друг начин."),
         roles=["student"], scale="agree5", score=LIKERT_POS, aspect="clarity", repeat=TC_REPEAT, grades=[4, 12],
         young={"text": "{teacher} обяснява ли така, че да разбереш?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("TC03", "TC", "TC", T("", "Часовете на {teacher} са интересни."), roles=["student"], scale="agree5", score=LIKERT_POS,
         aspect="engagement", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC04", "TC", "TC", T("", "{teacher} ми казва какво правя добре и какво да подобря."), roles=["student"], scale="agree5",
         score=LIKERT_POS, aspect="feedback", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC05", "TC", "TC", T("", "{teacher} оценява справедливо и предварително е ясно какво се изисква."), roles=["student"],
         scale="agree5", score=LIKERT_POS, aspect="fair_assessment", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC06", "TC", "TC", T("", "В часа на {teacher} има ред, без да се крещи или унижава."), roles=["student"],
         scale="agree5", score=LIKERT_POS, aspect="climate", repeat=TC_REPEAT, grades=[4, 12],
         young={"text": "Вика ли {teacher} на децата?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("TC07", "TC", "TC", T("", "Домашните и изпитванията на {teacher} са в разумен обем."), roles=["student"], scale="agree5",
         score=LIKERT_POS, aspect="workload", repeat=TC_REPEAT, grades=[5, 12]),
    item("TC08", "TC", "TC", T("Класният ръководител отговаря навреме и по същество на въпросите ми."), roles=["parent"],
         scale="agree5", score=LIKERT_POS, aspect="parent_communication", repeat=TC_REPEAT),
    item("TC09", "TC", "TC", T("Съобщенията на класния ръководител за проблеми са конкретни и предлагат решение, а не само оплакване."),
         roles=["parent"], scale="agree5", score=LIKERT_POS, aspect="parent_communication", repeat=TC_REPEAT),
]
# Parent-version TC01 applies from grade 1 (rated teacher = класен ръководител / начален учител)
for it in items:
    if it["id"] == "TC01":
        it["grades_by_role"] = {"parent": [1, 12], "student": [4, 12]}

# ---------------------------------------------------------------- SU: подкрепа и справедливост
items += [
    item("SU01", "SU", "SU", T("Когато детето изостане, училището предлага помощ (консултации, допълнителни часове).",
                                "Когато не разбирам нещо, мога да получа помощ в училище."),
         scale="agree5", score=LIKERT_POS, young={"text": "Ако не разбереш нещо, помагат ли ти в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SU02", "SU", "SU", T("Към всички деца в класа се отнасят еднакво справедливо.", "Учителите се отнасят еднакво справедливо към всички ученици."),
         scale="agree5", score=LIKERT_POS),
    item("SU03", "SU", "SU", T("Без допълнителна помощ (от родител или частен учител) детето би се справило с изискванията на училището.",
                                "Мога да се справя с изискванията на училището без частни уроци."),
         scale="yes_partly_no", score={"kind": "map", "values": [100, 50, 0]}),
]

# ---------------------------------------------------------------- CD: климат и дисциплина
items += [
    item("CD01", "CD", "CD", T("Правилата в класа са ясни и се прилагат еднакво към всички.", "Правилата в класа са ясни и важат еднакво за всички."),
         scale="agree5", score=LIKERT_POS, young={"text": "Ясно ли ти е какви са правилата в класа?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("CD02", "CD", None, T("През последните 4 седмици колко пъти сте получили бележка или съобщение за поведението на детето?"),
         roles=["parent"], options=["Нито веднъж", "1", "2–3", "4 или повече"]),
    item("CD03", "CD", None, T("Какво е описвало съобщението?"), roles=["parent"], type="multi",
         options=["Игра или гонене", "Бутане или закачки по време на игра", "Разговор или смях в час", "Нежелание или бавно изпълнение на задача",
                  "Спор с дете", "Удар или нараняване с намерение", "Друго"], show_if=q_in("CD02", [1, 2, 3])),
    item("CD04", "CD", "CD", T("Съобщението съдържаше ли конкретно описание (кога, какво точно, кой е видял)?"), roles=["parent"],
         options=["Да", "Отчасти", "Не"], score={"kind": "map", "values": [100, 50, 0]}, show_if=q_in("CD02", [1, 2, 3])),
    item("CD05", "CD", None, T("Поведението беше ли наречено „агресия“, „насилие“ или „тормоз“?"), roles=["parent"],
         options=["Да", "Не"], show_if=q_in("CD02", [1, 2, 3])),
    item("CD06", "CD", "CD", T("Според Вас това определение отговаряше ли на случилото се?"), roles=["parent"],
         options=["Напълно", "Отчасти", "Не", "Не знам"], score={"kind": "map", "values": [100, 50, 0, None]}, show_if=q_in("CD05", [0])),
    item("CD07", "CD", "CD", T("Поискано ли Ви е да „коригирате“ поведението вкъщи, без училището да предложи своя мярка?"), roles=["parent"],
         options=["Да", "Не"], score={"kind": "map", "values": [0, 100]}, show_if=q_in("CD02", [1, 2, 3])),
    item("CD08", "CD", "CD", T("Детето лишавано ли е от междучасие, игра навън или занимание като наказание?",
                                "Случвало ли се е да те лишат от междучасие или игра навън като наказание?"),
         grades=[1, 7], options=["Никога", "Веднъж", "Повече от веднъж", "Не знам"], score={"kind": "map", "values": [100, 40, 0, None]}),
    item("CD09", "CD", "CD", T("Детето споделя, че е било засрамено пред класа от учител.", "Учители коментират пред класа оценките или грешките на ученици по унизителен начин."),
         scale="freq5", score=LIKERT_NEG, weight=1.5, young={"text": "Срамува ли те учител пред другите деца?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("CD10", "CD", "CD", T("", "Нормалната игра през междучасието (гонене, закачки) се наказва като агресия."),
         roles=["student"], grades=[4, 9], scale="freq5", score=LIKERT_NEG,
         young={"text": "Наказват ли децата, когато просто играят и се гонят?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("CD11", "CD", "CD", T("", "Мога да кажа мнението си на учител, без да се страхувам."), roles=["student"], scale="agree5", score=LIKERT_POS,
         young={"text": "Можеш ли да кажеш на учителката, когато не си съгласен/съгласна?", "scale": "kid3_agree", "score": LIKERT_POS}),
]

# ---------------------------------------------------------------- SF: безопасност
items += [
    item("SF01", "SF", "SF", T("През последния месец детето споделяло ли е, че други деца многократно го обиждат, удрят или изключват нарочно?",
                                "През последния месец случвало ли се е някой в училище многократно да те обижда, удря или изключва нарочно?"),
         options=["Не", "Веднъж-два пъти", "Няколко пъти", "Почти всяка седмица"], score={"kind": "map", "values": [100, 60, 20, 0]}, weight=1.5,
         young={"text": "Случва ли се други деца да те обиждат или удрят?", "scale": "kid3_freq", "score": LIKERT_NEG}),
    item("SF02", "SF", "SF", T("Когато сте сигнализирали училището, реагира ли адекватно?", "Когато си казал/а на възрастен в училище, той помогна ли?"),
         options=["Не сме казвали / не съм казвал(а)", "Да", "Отчасти", "Не"], score={"kind": "map", "values": [None, 100, 50, 0]},
         show_if=q_in("SF01", [1, 2, 3])),
    item("SF03", "SF", "SF", T("Детето се чувства в безопасност в училище.", "Чувствам се в безопасност в училище."),
         scale="agree5", score=LIKERT_POS, young={"text": "Чувстваш ли се спокойно и в безопасност в училище?", "scale": "kid3_agree", "score": LIKERT_POS}),
    item("SF90", "SF", None, T("", "Ако някой те наранява или ти е тежко, можеш да говориш с възрастен, на когото имаш доверие, или да се обадиш безплатно на Националната телефонна линия за деца 116 111."),
         roles=["student"], type="notice", show_if={"any": [q_in("SF01", [2, 3]), q_in("WB02", [4])]}),
]

# ---------------------------------------------------------------- CP: комуникация и партньорство
items += [
    item("CP01", "CP", "CP", T("Получавам навреме информацията, която ми е нужна (оценки, събития, промени)."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP02", "CP", "CP", T("Мога да изразя несъгласие с учител или ръководството без последици за детето."), roles=["parent"],
         scale="yes_partly_no", score={"kind": "map", "values": [100, 50, 0]}, weight=1.5),
    item("CP03", "CP", "CP", T("Съобщенията от училището са с уважителен тон и са конкретни."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP04", "CP", "CP", T("Мнението на родителите се взема предвид при решения, които засягат децата."), roles=["parent"], scale="agree5", score=LIKERT_POS),
    item("CP05", "CP", "CP", T("", "Учителите ни питат за мнението ни (например за начина на работа или за обема на задачите)."), roles=["student"],
         grades=[5, 12], scale="agree5", score=LIKERT_POS),
]

# ---------------------------------------------------------------- SY: система (планирано попълване от 50% от анкетираните)
items += [
    item("SY01", "SY", "SY", T("Учебните програми са с обем, съобразен с възрастта на детето.", "Учебният материал е с обем, който може да се научи в рамките на училището."),
         scale="agree5", score=LIKERT_POS),
    item("SY02", "SY", "SY", T("Учебниците са разбираеми за детето без допълнителна помощ.", "Учебниците са разбираеми без допълнителна помощ."),
         scale="agree5", score=LIKERT_POS),
    item("SY03", "SY", "SY", T("Подготовката за националното външно оценяване (НВО) създава прекомерен стрес.",
                                "Подготовката за НВО / матурите създава прекомерен стрес."),
         grades=[4, 12], scale="agree5", score=LIKERT_NEG),
    item("SY04", "SY", "SY", T("Учебният ден (продължителност, смени, разписание) е подходящ за възрастта.",
                                "Учебният ден (продължителност, смени, разписание) е разумен."), scale="agree5", score=LIKERT_POS),
    item("SY05", "SY", "SY", T("Училищната система подготвя децата за реалния живот.", "Това, което уча, ще ми бъде полезно в живота."),
         scale="agree5", score=LIKERT_POS),
]

# ---------------------------------------------------------------- QC: проверка за внимание
items += [
    item("QC01", "QC", None, T("За да покажете, че четете внимателно, изберете „Рядко“.", "За да покажеш, че четеш внимателно, избери „Рядко“."),
         grades=[8, 12], scale="freq5", hint="attention_check:expected=1",
         roles=["parent", "student"]),
]
for it in items:
    if it["id"] == "QC01":
        it["grades_by_role"] = {"parent": [1, 12], "student": [8, 12]}

# ---------------------------------------------------------------- OT: свободни отговори
items += [
    item("OT01", "OT", None, T("Кое цените най-много в училището?", "Какво ти харесва най-много в училището?"), type="text"),
    item("OT02", "OT", None, T("Какво бихте променили, за да е по-добър балансът между учене, почивка и семейство?",
                                "Какво би променил/а в училище?"), type="text",
         young={"text": "Какво би искал/а да е различно в училище?", "type": "text"}),
    item("OT03", "OT", None, T("Искате ли да опишете конкретна ситуация? Моля, без имена на деца и учители.",
                                "Искаш ли да разкажеш за конкретна ситуация? Моля, без имена."), type="text"),
]

MODULES = [
    {"id": "PR", "title": "Профил", "scored": False},
    {"id": "WL", "title": "Натоварване", "scored": True},
    {"id": "SL", "title": "Сън и свободно време", "scored": True},
    {"id": "WB", "title": "Благополучие", "scored": True},
    {"id": "TQ", "title": "Преподаване в класа", "scored": True},
    {"id": "TC", "title": "Учители", "scored": True, "repeat": "teacher"},
    {"id": "SU", "title": "Подкрепа и справедливост", "scored": True},
    {"id": "CD", "title": "Климат и дисциплина", "scored": True},
    {"id": "SF", "title": "Безопасност", "scored": True},
    {"id": "QC", "title": "Проверка", "scored": False},
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
}

doc = {"version": "1.0.0", "language": "bg", "scales": SCALES, "modules": MODULES, "dimensions": DIMENSIONS,
       "pillars": PILLARS, "params": PARAMS, "items": items, "derived": DERIVED}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "questionnaire.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} items, {len(DERIVED)} derived -> {out}")
