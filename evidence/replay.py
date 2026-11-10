#!/usr/bin/env python3
"""Read-only verification of our own frozen artifact and saved model predictions."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
import joblib
import lightgbm as lgb
from catboost import CatBoostClassifier
root=Path("frozen/experiment-out").resolve()
manifest=root/"SHA256SUMS"
assert manifest.is_file(),"Frozen manifest missing"
checked=0
for line in manifest.read_text().splitlines():
    digest,relative=line.split("  ",1)
    path=(root/relative).resolve()
    assert root in path.parents and path.is_file(),"Unsafe or missing archive entry"
    assert hashlib.sha256(path.read_bytes()).hexdigest()==digest,"Artifact file digest mismatch: "+relative
    checked+=1
sys.path.insert(0,str(Path("frozen/research").resolve()))
import compare_long_history as study
data_path=root/"dataset.json"
data=json.loads(data_path.read_bytes())
calendar_path=Path("frozen/research/calendar.json")
calendar=json.loads(calendar_path.read_bytes())
p,rows,grid=study.validate(data,calendar)
report=json.loads((root/"training/report.json").read_bytes())
assert report["datasetByteSha256"]==hashlib.sha256(data_path.read_bytes()).hexdigest()
assert report["calendarByteSha256"]==hashlib.sha256(calendar_path.read_bytes()).hexdigest()
assert report["baseCodeSha256"]==hashlib.sha256(Path(study.base.__file__).read_bytes()).hexdigest()
assert report["approved"] is False and report["winner"] is None
records=[json.loads(x) for x in (root/"training/predictions.jsonl").read_text().splitlines()]
by_id={x["id"]:x for x in records};assert len(by_id)==len(records)
replays=[];quarters={}
for regime in study.REGIMES:
    split,_,_=study.partition(rows,regime,p);dev=split["development"];x=study.base.matrix(dev)
    folder=root/"training"/regime/"models"
    quarters[regime]={}
    for name in study.base.MODEL_NAMES:
        if name=="logistic":
            model=joblib.load(folder/"logistic.joblib")
            raw=study.base.predict(model,x)
        elif name=="lightgbm":
            model=lgb.Booster(model_file=str(folder/"lightgbm.txt"))
            raw=study.base.check_probabilities(model.predict(x),len(dev))
        else:
            model=CatBoostClassifier()
            model.load_model(str(folder/"catboost.cbm"))
            raw=study.base.predict(model,x)
        saved_raw=np.asarray([by_id[r["id"]]["forecasts"][regime]["models"][name]["rawProbability"] for r in dev])
        saved_cal=np.asarray([by_id[r["id"]]["forecasts"][regime]["models"][name]["researchProbability"] for r in dev])
        calibrator_path=folder/(name+"-calibrator.joblib")
        cal=study.base.predict(joblib.load(calibrator_path),study.base.logit(raw)) if calibrator_path.exists() else raw
        raw_diff=float(np.max(np.abs(raw-saved_raw)))
        cal_diff=float(np.max(np.abs(cal-saved_cal)))
        assert raw_diff<=1e-10 and cal_diff<=1e-10,"Saved prediction mismatch"
        replays.append({"regime":regime,"model":name,"rows":len(dev),"maxRawDifference":raw_diff,"maxCalibratedDifference":cal_diff})
        m=report["regimes"][regime]["models"][name]
        scopes={}
        for scope,v in m["scopes"].items():
            scopes[scope]={"calibrationBins":v["scores"]["calibrationBins"],
                "rawBrier":v["rawScores"]["brier"],"calibratedBrier":v["scores"]["brier"],
                "quarters":[{"quarter":q["quarter"],"signals":q["signalStockDays"],"dates":q["signalDates"],
                    "assumed30bps":q["costScenarios"][1]["dailyEqualWeightMeanAssumedPriceReturn"],
                    "sampleExcess30bps":q["costScenarios"][1]["sameDateAllReadableSampleExcess"],
                    "lowExcursion":q["singleStockFiveSessionLowExcursion"]}
                    for q in v["selection"]["quarters"]]}
        quarters[regime][name]=scopes
summary={"status":"saved_predictions_reproduced","sourceRun":42733142406,"manifestFilesVerified":checked,
    "predictionRows":len(records),"replays":replays,"quarters":quarters,
    "artifactDatasetSha256":report["datasetByteSha256"],"coreCohortHash":report["coreCohortHash"],
    "notes":["Own frozen artifact only; saved inference reproduced, not a fresh retrain or final-test evaluation.",
             "Regimes change training cutoffs and calibration ranges; descriptive configuration comparison only."]}
Path("evidence-output").mkdir(exist_ok=False)
Path("evidence-output/replay.json").write_text(json.dumps(summary,ensure_ascii=False,allow_nan=False,indent=2))
print("FROZEN_REPLAY_SUMMARY "+json.dumps(summary,ensure_ascii=False,allow_nan=False))
