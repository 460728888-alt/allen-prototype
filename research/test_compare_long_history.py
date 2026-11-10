import copy
from datetime import date, timedelta
import unittest
import compare_long_history as study

def fixture():
    sessions,d=[],date(2020,1,1)
    while d<=date(2025,12,31):
        if d.weekday()<5:sessions.append(d.isoformat())
        d+=timedelta(days=1)
    symbols=[f"TEST{i:03d}" for i in range(240)]
    p={"id":study.PROTOCOL_ID,"approved":False,"probabilitiesEnabled":False,"winner":None,
       "requestFrom":"2020-01-01","requestThrough":"2025-12-31","sealedTestFrom":"2026-01-01",
       "target":"next_open_to_fifth_close_gross_up","featureNames":study.base.FEATURES,
       "historySessions":61,"horizonSessions":5,"selectionThreshold":.6,"seed":study.SEED,
       "shortWarmupFrom":[d for d in sessions if d.startswith("2024-")][60],
       "coreSymbols":symbols[:32],"universe":[{"symbol":s} for s in symbols]}
    return p,{"validFrom":"2020-01-01","validThrough":"2025-12-31","sessions":sessions}
def row(symbol,d,calendar,ret=.02,adverse=-.1):
    through=calendar["sessions"][calendar["sessions"].index(d)+5]
    return {"id":f"{symbol}/{d}","symbol":symbol,"date":d,"labelThrough":through,
            "features":[.1]*10,"rawReturn":ret,"benchmarkReturn":.01,
            "adversePriceExcursion":adverse,"simpleTrend":True}
class LongHistoryTests(unittest.TestCase):
    def test_all_regimes_share_exact_core_cohort(self):
        p,cal=fixture()
        rows=[row("TEST000","2025-01-09",cal),row("TEST031","2025-01-10",cal),row("TEST032","2025-01-10",cal)]
        expected=[r["id"] for r in rows if r["symbol"] in p["coreSymbols"]]
        for regime in study.REGIMES:
            split,_,_=study.partition(rows,regime,p)
            self.assertEqual([r["id"] for r in split["development"] if r["symbol"] in p["coreSymbols"]],expected)
        self.assertEqual(len(study.partition(rows,"long_expanded",p)[0]["development"]),3)
    def test_sparse_bootstrap_has_no_fabricated_interval(self):
        _,cal=fixture();grid=[d for d in cal["sessions"] if d.startswith("2025-")][:40]
        r=study.bootstrap({d:.01 for d in grid[:19]},grid)
        self.assertEqual(r["state"],"insufficient_signal_dates")
        self.assertIsNone(r["low"]);self.assertIsNone(r["high"]);self.assertEqual(r["replicates"],0)
    def test_2026_is_rejected(self):
        p,cal=fixture();r=row("TEST000","2025-01-09",cal)
        r["date"],r["labelThrough"]="2026-01-02","2026-01-09"
        with self.assertRaisesRegex(ValueError,"sealed"):study.validate({"protocol":p,"rows":[r]},cal)
    def test_training_and_calibration_labels_are_purged(self):
        p,cal=fixture()
        split,_,_=study.partition([row("TEST000","2023-12-29",cal),row("TEST000","2024-12-27",cal)],"long_core",p)
        self.assertEqual(len(split["purged"]),2);self.assertFalse(split["train"]);self.assertFalse(split["calibration"])
    def test_short_warmup_cannot_use_late_2023_to_add_early_2024_rows(self):
        p,cal=fixture();r=row("TEST000","2024-02-01",cal)
        split,_,_=study.partition([r],"short_core",p)
        self.assertFalse(split["train"]);self.assertEqual(len(split["outside_regime"]),1)
    def test_low_excursion_is_not_portfolio_drawdown(self):
        _,cal=fixture();r=study.low_excursion([row("TEST000","2025-01-09",cal,adverse=-.2)])
        self.assertEqual(r["worstObserved"],-.2);self.assertEqual(r["stockDayP05"],-.2)
        self.assertIsNone(r["portfolioMaxDrawdown"]);self.assertIsNone(r["actualTradingReturn"])
    def test_pairing_needs_common_dates_and_uses_same_draws(self):
        _,cal=fixture();grid=[d for d in cal["sessions"] if d.startswith("2025-")][:60]
        a={bps:{"price":{d:.02 for d in grid[:30]}} for bps in [0,30,60]}
        b={bps:{"price":{d:.01 for d in grid[20:50]}} for bps in [0,30,60]}
        r=study.paired_comparison(a,b,grid);self.assertEqual(r["commonSignalDates"],10)
        self.assertIsNone(r["costScenarios"][1]["meanAssumedPriceReturnDifference"])
        b=copy.deepcopy(a)
        for values in b.values():values["price"]={d:.01 for d in grid[:30]}
        s=study.paired_comparison(a,b,grid)["costScenarios"][1]
        self.assertAlmostEqual(s["meanAssumedPriceReturnDifference"],.01)
        self.assertAlmostEqual(s["uncertainty"]["low"],.01)
        self.assertAlmostEqual(s["uncertainty"]["high"],.01)
        self.assertEqual(study.bootstrap_indices(len(grid)).tolist(),study.bootstrap_indices(len(grid)).tolist())
    def test_brier_changes_are_date_weighted_on_identical_rows(self):
        _,cal=fixture();rows=[row("TEST000","2025-01-09",cal),row("TEST001","2025-01-09",cal),row("TEST000","2025-01-10",cal)]
        result=study.daily_brier(rows,[.8,.6,.5])
        self.assertAlmostEqual(result["2025-01-09"],(.04+.16)/2)
        self.assertAlmostEqual(result["2025-01-10"],.25)
if __name__=="__main__":unittest.main()
