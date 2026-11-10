import copy
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import train_five_day as t

PROTOCOL = json.loads((Path(__file__).parent / "protocol.json").read_text())

def row(i=0, day="2024-06-03", through="2024-06-10", ret=.01, benchmark=.005):
    return {"id":f"S{i}@{day}", "symbol":f"S{i}", "date":day, "labelThrough":through,
            "features":[i*.01+j*.005 for j in range(10)], "rawReturn":ret,
            "benchmarkReturn":benchmark, "simpleTrend":i % 2 == 0}

class TrainingGuards(unittest.TestCase):
    def test_boundaries_purge_labels_instead_of_moving_them(self):
        rows = [
            row(0,"2024-08-23","2024-08-30"),
            row(1,"2024-08-29","2024-09-05"),
            row(2,"2024-09-02","2024-09-09"),
            row(3,"2024-09-09","2024-09-19"),
            row(4,"2024-12-30","2025-01-07"),
            row(5,"2025-01-02","2025-01-09"),
            row(6,"2025-01-09","2025-01-16"),
        ]
        split, ledger = t.partition_rows(rows)
        self.assertEqual([r["id"] for r in split["train"]], [rows[0]["id"]])
        self.assertEqual(len(split["purged"]),2)
        self.assertEqual(len(split["embargo_or_outside"]),2)
        self.assertEqual(len(split["calibration"]),1)
        self.assertEqual(len(split["development"]),1)
        self.assertEqual(len(ledger),len(rows))

    def test_sealed_year_and_nan_features_are_hard_rejected(self):
        for bad in [row(0,"2025-12-30","2026-01-07"), row()]:
            if bad["date"] < "2025":
                bad["features"][0] = float("nan")
            with self.assertRaises(ValueError):
                t.validate_dataset({"protocol":PROTOCOL,"rows":[bad]})

    def test_fixed_protocol_and_unique_rows(self):
        bad=copy.deepcopy(PROTOCOL);bad["selectionThreshold"]=.55
        with self.assertRaises(ValueError):
            t.validate_dataset({"protocol":bad,"rows":[row()]})
        with self.assertRaises(ValueError):
            t.validate_dataset({"protocol":PROTOCOL,"rows":[row(),row()]})
        p,rows=t.validate_dataset({"protocol":PROTOCOL,"rows":[row(2),row(1)]})
        self.assertEqual(rows[0]["symbol"],"S1")

    def test_equal_date_weights_do_not_overweight_crowded_day(self):
        a=row(1);b=row(2);c=row(3,"2024-06-04","2024-06-11")
        w=t.date_weights([a,b,c]); self.assertAlmostEqual(w[0]+w[1],w[2])
        self.assertAlmostEqual(float(w.sum()),3)

    def test_cost_is_applied_once_and_never_changes_gross_label(self):
        a=row(ret=.001)
        self.assertEqual(t.labels([a]).tolist(),[1])
        self.assertLess(t.assumed_return(a["rawReturn"],30),0)
        self.assertAlmostEqual(t.assumed_return(.1,30),1.1*.9985/1.0015-1)

    def test_no_signals_remain_null_not_zero_returns(self):
        r=t.selection_summary([row()],[])
        self.assertEqual(r["signalStockDays"],0)
        self.assertIsNone(r["costScenarios"][0]["dailyEqualWeightMeanAssumedPriceReturn"])
        self.assertIsNone(r["portfolioMaxDrawdown"])
        self.assertEqual(r["noSignalFraction"],1)

    def test_index_excess_uses_identical_paired_subset(self):
        a=row(1,ret=.8,benchmark=None);b=row(2,ret=.02,benchmark=.01)
        s=t.selection_summary([a,b],[a,b])["costScenarios"][0]
        self.assertAlmostEqual(s["sameDateIndexScenarioExcess"],.01)
        self.assertEqual(s["indexComparableStockDays"],1)
        self.assertEqual(s["indexComparableDates"],1)

    def test_bins_are_explicit_and_json_cannot_hide_nonfinite(self):
        rows=[row(1,ret=-.01),row(2,ret=.01)]
        scores=t.probability_scores(rows,np.array([.1,.9]))
        self.assertEqual(scores["classificationAccuracyAtHalf"],1)
        self.assertIsNone(scores["calibrationBins"][2]["meanProbability"])
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                t.write_json(Path(d)/"bad.json",{"x":float("nan")})

    def test_development_outcomes_never_fit_or_calibrate_model(self):
        train=[row(i,ret=.02 if i%3 else -.01) for i in range(60)]
        cal=[row(i+100,"2024-10-09","2024-10-16",.01 if i%2 else -.01) for i in range(30)]
        dev=[row(i+200,"2025-02-10","2025-02-17",.02 if i%2 else -.02) for i in range(10)]
        changed=copy.deepcopy(dev)
        for r in changed:
            r["rawReturn"]=-r["rawReturn"]
        with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
            r1,raw1,p1=t.fit_and_evaluate("logistic",train,cal,dev,Path(a),20261110)
            r2,raw2,p2=t.fit_and_evaluate("logistic",train,cal,changed,Path(b),20261110)
            np.testing.assert_array_equal(raw1,raw2);np.testing.assert_array_equal(p1,p2)
            self.assertEqual(r1["calibration"]["state"],"sigmoid_fit_only_on_2024_calibration")

if __name__ == "__main__":
    unittest.main()
