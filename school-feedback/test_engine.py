"""Run:  python -m unittest -v test_engine"""
import math
import unittest

import engine as E

Q = E.load_questionnaire()
Q["params"]["bootstrap_reps"] = 120


def ids(items):
    return [v["id"] for v in items]


class Flow(unittest.TestCase):
    def test_grade_question_is_dynamic(self):
        p1 = ids(E.flow(Q, {"role": "parent", "grade": 1, "token": "a"}))
        p2 = ids(E.flow(Q, {"role": "parent", "grade": 2, "token": "a"}))
        p6 = ids(E.flow(Q, {"role": "parent", "grade": 6, "token": "a"}))
        self.assertIn("PR02A", p1)
        self.assertNotIn("PR02B_BEL", p1)
        self.assertIn("PR02B_BEL", p2)
        self.assertNotIn("PR02C_BEL", p2)
        self.assertIn("PR02C_BEL", p6)
        self.assertNotIn("PR02A", p6)

    def test_gender_asked_to_both_roles(self):
        self.assertIn("PR01", ids(E.flow(Q, {"role": "parent", "grade": 3, "token": "a"})))
        self.assertIn("PR01", ids(E.flow(Q, {"role": "student", "grade": 9, "token": "a"})))

    def test_students_below_grade_4_cannot_fill(self):
        with self.assertRaises(ValueError):
            E.flow(Q, {"role": "student", "grade": 3, "token": "a"})

    def test_young_student_gets_short_form_with_3_point_scales(self):
        f = E.flow(Q, {"role": "student", "grade": 4, "token": "a"})
        full = E.flow(Q, {"role": "student", "grade": 8, "token": "a"})
        self.assertLess(len(f), len(full) * 0.7)
        wb01 = next(v for v in f if v["id"] == "WB01")
        self.assertEqual(len(wb01["options"]), 3)

    def test_conditional_followups(self):
        base = {"role": "parent", "grade": 5, "token": "a"}
        self.assertNotIn("PR05", ids(E.flow(Q, base, {"PR04": 0})))
        self.assertIn("PR05", ids(E.flow(Q, base, {"PR04": 2})))
        self.assertNotIn("CD06", ids(E.flow(Q, base, {"CD02": 2, "CD05": 1})))
        self.assertIn("CD06", ids(E.flow(Q, base, {"CD02": 2, "CD05": 0})))

    def test_help_notice_for_student_reporting_bullying(self):
        st = {"role": "student", "grade": 7, "token": "a"}
        self.assertIn("SF90", ids(E.flow(Q, st, {"SF01": 3})))
        self.assertNotIn("SF90", ids(E.flow(Q, st, {"SF01": 0})))
        self.assertNotIn("SF90", ids(E.flow(Q, {"role": "parent", "grade": 7, "token": "a"}, {"SF01": 3})))

    def test_system_module_planned_missingness_about_half(self):
        n = sum("SY01" in ids(E.flow(Q, {"role": "parent", "grade": 5, "token": f"t{i}"})) for i in range(1000))
        self.assertTrue(400 < n < 600, n)

    def test_teacher_items_repeat_per_assigned_teacher(self):
        roster = [{"teacher_id": "T1", "name": "г-жа А", "is_class_teacher": True}] + \
                 [{"teacher_id": f"T{i}", "name": f"У{i}", "is_class_teacher": False} for i in range(2, 8)]
        st = E.assign_teachers(Q, "tokX", "student", roster)
        self.assertEqual(st[0]["teacher_id"], "T1")
        self.assertEqual(len(st), 2)   # class teacher + one more
        self.assertEqual(st, E.assign_teachers(Q, "tokX", "student", roster))  # deterministic
        pa = E.assign_teachers(Q, "tokX", "parent", roster)
        self.assertEqual([t["teacher_id"] for t in pa], ["T1"])
        young = E.assign_teachers(Q, "tokX", "student", roster, grade=4)
        self.assertEqual([t["teacher_id"] for t in young], ["T1"])
        f = E.flow(Q, {"role": "student", "grade": 8, "token": "tokX"}, {}, st)
        tc = [v for v in f if v["id"].startswith("TC")]
        self.assertEqual(len(tc), 2 * 4)   # respect, clarity + 2 behaviour counts (TC10, TC11)
        self.assertTrue(any("г-жа А" in v["text"] for v in tc))

    def test_balanced_assignment_spreads_ratings(self):
        roster = [{"teacher_id": "H", "is_class_teacher": True}] + [{"teacher_id": f"S{i}", "is_class_teacher": False} for i in range(6)]
        counts = {}
        for i in range(60):
            for t in E.assign_teachers(Q, f"k{i}", "student", roster, counts)[1:]:
                counts[t["teacher_id"]] = counts.get(t["teacher_id"], 0) + 1
        self.assertLessEqual(max(counts.values()) - min(counts.values()), 4, counts)


class Scoring(unittest.TestCase):
    def test_likert_and_reverse(self):
        v = E.variant(Q, Q["_by_id"]["WB04"], "parent", 5)
        self.assertEqual(E.item_score(Q, v, 4, 5), 100)
        self.assertEqual(E.item_score(Q, v, 0, 5), 0)
        v = E.variant(Q, Q["_by_id"]["WB02"], "parent", 5)
        self.assertEqual(E.item_score(Q, v, 0, 5), 100)
        self.assertEqual(E.item_score(Q, v, 4, 5), 0)

    def test_homework_norm_depends_on_grade(self):
        # 52.5 min: grade 2 (norm 20) -> 100*(1-32.5/40); grade 6 (norm 60) -> 100
        self.assertAlmostEqual(E.norm_score(Q, "homework_weekday", 52.5, 2), 18.75)
        self.assertEqual(E.norm_score(Q, "homework_weekday", 52.5, 6), 100)
        self.assertEqual(E.norm_score(Q, "homework_weekday", 75, 2), 0)
        self.assertEqual(E.norm_score(Q, "homework_weekday", 120, 12), 100)  # capped norm 120

    def test_sleep_norm_by_age(self):
        self.assertEqual(E.norm_score(Q, "sleep", 9.0, 3), 100)
        self.assertEqual(E.norm_score(Q, "sleep", 8.0, 3), 60)
        self.assertEqual(E.norm_score(Q, "sleep", 8.0, 9), 100)

    def test_dont_know_does_not_hurt_coverage(self):
        r = {"role": "parent", "grade": 5, "answers": {"CD02": 1, "CD05": 0, "CD06": 3, "CD01": 4, "CD04": 0, "CD08": 0, "CD09": 0,
                                                   "HP01": 0, "HP02": 0, "HP03": 0, "HP04": 0, "HP06": 0}}
        s = E.score_respondent(Q, r)
        self.assertIn("CD", s["dims"])
        self.assertIsNone(s["items"]["CD06"])

    def test_dimension_needs_half_of_items(self):
        r = {"role": "parent", "grade": 5, "answers": {"TQ01": 0}}   # 1 of 2 core items, the sampled ones count when shown
        self.assertIn("TQ", E.score_respondent(Q, r)["dims"])
        r = {"role": "parent", "grade": 5, "answers": {"CP01": 0}}   # 1 of 3
        self.assertNotIn("CP", E.score_respondent(Q, r)["dims"])

    def test_derived_sleep_and_tutoring(self):
        r = {"role": "parent", "grade": 2, "answers": {"SC06_S": 4, "PR04": 2, "PR05": [0]}}
        s = E.score_respondent(Q, r)
        self.assertEqual(s["items"]["SL_SLEEP"], 100)    # over 10 h on school nights
        self.assertEqual(s["items"]["SU_TUT"], 0)
        self.assertEqual(s["ctx"]["indicators"]["tutoring_keep_up"], 1)
        short = E.score_respondent(Q, {"role": "parent", "grade": 2, "answers": {"SC06_S": 1}})
        self.assertEqual(short["ctx"]["indicators"]["sleep_short"], 1)   # 7–8 h at 7–8 years

    def test_grade_band_unified_across_scales(self):
        s1 = E.score_respondent(Q, {"role": "parent", "grade": 2, "answers": {"PR02B_BEL": 1}})
        s2 = E.score_respondent(Q, {"role": "parent", "grade": 8, "answers": {"PR02C_BEL": 1}})
        self.assertEqual(s1["ctx"]["grade_band"], 4)
        self.assertEqual(s2["ctx"]["grade_band"], 4)

    def test_practices_checklist(self):
        s = E.score_respondent(Q, {"role": "student", "grade": 7, "answers": {"HP00": [0, 5], "HP01": 1}})["ctx"]["indicators"]
        self.assertEqual((s["shouting_weekly"], s["physical_force"], s["class_punishment"]), (1, 1, 0))
        s = E.score_respondent(Q, {"role": "student", "grade": 7, "answers": {"HP00": [6]}})["ctx"]["indicators"]
        self.assertEqual((s["shouting_weekly"], s["physical_force"]), (0, 0))
        f = ids(E.flow(Q, {"role": "student", "grade": 7, "token": "a"}, {"HP00": [2]}))
        self.assertIn("HP02", f)
        self.assertNotIn("HP01", f)

    def test_quality_flags(self):
        a = {k: 0 for k in ("WL07", "WB02", "WB04", "WB07", "TQ01", "TQ02", "TQ03", "TQ04", "TQ05", "SU01", "SU02", "CD01", "CD09", "CP01", "CP04")}
        s = E.score_respondent(Q, {"role": "parent", "grade": 5, "answers": a})
        self.assertIn("straightline", s["flags"])
        s = E.score_respondent(Q, {"role": "parent", "grade": 5, "answers": {"QC01": 4}})
        self.assertIn("attention_failed", s["flags"])


class Aggregation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resp, cls.truth, _ = E.simulate(Q, regions=2, schools_per_region=6, seed=11)
        cls.res = E.run_wave(Q, cls.resp, class_sizes=cls.truth["class_sizes"])

    def test_index_tracks_true_quality(self):
        sch = self.res["school"]
        xs = [(self.truth["school"][u], r["index"]["score"]) for u, r in sch.items() if r.get("index")]
        n = len(xs)
        mx, my = sum(x for x, _ in xs) / n, sum(y for _, y in xs) / n
        cor = sum((x - mx) * (y - my) for x, y in xs) / math.sqrt(sum((x - mx) ** 2 for x, _ in xs) * sum((y - my) ** 2 for _, y in xs))
        self.assertGreater(cor, 0.8)

    def test_intervals_contain_score_and_tiers_assigned(self):
        for r in self.res["school"].values():
            ix = r["index"]
            self.assertLessEqual(ix["lo"], ix["score"] + 0.5)
            self.assertGreaterEqual(ix["hi"], ix["score"] - 0.5)
            self.assertIn("tier", ix)
            lo, hi = ix["rank_range"]
            self.assertLessEqual(lo, hi)

    def test_campaign_detected_and_speeders_excluded(self):
        self.assertTrue(self.res["campaign_alerts"])
        self.assertGreater(self.res["meta"]["excluded"].get("too_fast", 0), 0)

    def test_participation_and_impossible_counts(self):
        blocked = [u for u, r in self.res["class"].items() if r.get("publish_blocked")]
        self.assertEqual(len(blocked), 1)          # the injected campaign class has 26 parent rows for 20 students
        some = next(r for r in self.res["school"].values() if r.get("participation"))
        self.assertLessEqual(max(some["participation"].values()), 1.0)

    def test_teacher_suppressed_below_10_students(self):
        for r in self.res["teacher"].values():
            if r.get("suppressed"):
                continue
            roles = r["dimensions"]["TC"]["roles"]
            if "student" in roles:
                self.assertGreaterEqual(roles["student"]["n"], 10)

    def test_role_cells_below_k_not_used(self):
        for r in self.res["class"].values():
            if r.get("suppressed"):
                continue
            for d in r["dimensions"].values():
                for role in d["roles"].values():
                    self.assertGreaterEqual(role["n"], 5)

    def test_small_units_shrink_more(self):
        sc = [E.score_respondent(Q, r) for r in self.resp]
        E.apply_quality(Q, sc)
        school = sc[0]["unit"]["school_id"]
        big = [s for s in sc if s["unit"]["school_id"] == school]
        small = big[:12]
        for s in small:
            s["unit"] = dict(s["unit"], school_id="TINY")
        res = E.aggregate(Q, sc, "school", bootstrap=False)
        self.assertLess(res["TINY"]["dimensions"]["WB"]["shrink_B"], res[school]["dimensions"]["WB"]["shrink_B"] + 1e-9)

    def test_equity_only_with_enough_cases(self):
        for r in self.res["school"].values():
            for g in r.get("equity", []):
                self.assertGreaterEqual(g["n_a"], 5)
                self.assertGreaterEqual(g["n_b"], 5)


if __name__ == "__main__":
    unittest.main()
