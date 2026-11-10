#!/usr/bin/env python3
"""Isolated five-session development experiment; never promotes a live model."""
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
import hashlib
from importlib import metadata
import json
import math
from pathlib import Path
import platform
import sys

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "ret5", "ret20", "ret60", "aboveMa20", "aboveMa60", "ma20Slope5",
    "drawdown20", "range5vs20", "volume5vs20", "realizedVol20",
]
SPLIT = {
    "trainEnd": "2024-08-30", "calibrationFrom": "2024-09-09",
    "calibrationThrough": "2024-12-31", "developmentFrom": "2025-01-09",
    "developmentThrough": "2025-12-31",
}
MODEL_NAMES = ["logistic", "lightgbm", "catboost"]

def require(condition, message):
    if not condition:
        raise ValueError(message)

def finite(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))

def valid_date(value):
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False

def mean(values):
    return float(np.mean(values)) if len(values) else None

def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2,
                               allow_nan=False) + "\n", encoding="utf-8")

def environment():
    versions = {}
    for package in ["numpy", "scikit-learn", "lightgbm", "catboost", "joblib"]:
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    return {"python": platform.python_version(), "packages": versions}

def validate_dataset(data):
    p = data.get("protocol")
    require(isinstance(p, dict), "protocol missing")
    require(isinstance(p.get("id"), str) and p["id"], "protocol.id missing")
    require(p.get("target") == "next_open_to_fifth_close_gross_up",
            "target must remain next_open_to_fifth_close_gross_up")
    require(p.get("approved") is False and p.get("probabilitiesEnabled") is False
            and p.get("winner") is None, "unapproved isolated protocol required")
    require(p.get("requestFrom") == "2024-01-01" and p.get("requestThrough") == "2025-12-31"
            and p.get("sealedTestFrom") == "2026-01-01", "2026 must remain sealed")
    require(p.get("historySessions") == 61 and p.get("horizonSessions") == 5,
            "fixed 61-session features and five-session target required")
    require(p.get("selectionThreshold") == 0.6, "fixed threshold must be 0.6")
    require(p.get("seed") == 20261110, "fixed seed must be 20261110")
    require(p.get("featureNames") == FEATURES, "fixed feature order required")
    for key, value in SPLIT.items():
        require(p.get(key) == value, f"frozen split mismatch: {key}")
    rows = data.get("rows")
    require(isinstance(rows, list) and rows, "no usable dataset rows")
    ids, keys = set(), set()
    for r in rows:
        require(isinstance(r, dict), "row must be an object")
        require(isinstance(r.get("id"), str) and r["id"], "row id missing")
        require(r["id"] not in ids, "duplicate row id")
        require(isinstance(r.get("symbol"), str) and r["symbol"], "row symbol missing")
        require(valid_date(r.get("date")) and valid_date(r.get("labelThrough")), "invalid row dates")
        require("2024-01-01" <= r["date"] < r["labelThrough"] <= "2025-12-31",
                "2026 is sealed; input dates must remain in 2024-2025")
        key = (r["symbol"], r["date"])
        require(key not in keys, "duplicate symbol/date row")
        features = r.get("features")
        require(isinstance(features, list) and len(features) == len(FEATURES)
                and all(finite(x) for x in features), f"missing/nonfinite feature: {r['id']}")
        require(finite(r.get("rawReturn")) and r["rawReturn"] > -1, f"invalid raw return: {r['id']}")
        benchmark = r.get("benchmarkReturn")
        require(benchmark is None or finite(benchmark) and benchmark > -1, "invalid benchmark return")
        require(isinstance(r.get("simpleTrend"), bool), "simpleTrend must be an explicit boolean")
        ids.add(r["id"]); keys.add(key)
    return p, sorted(rows, key=lambda r: (r["date"], r["symbol"], r["id"]))

def partition_rows(rows):
    split = {"train": [], "calibration": [], "development": [], "purged": [], "embargo_or_outside": []}
    ledger = []
    for r in rows:
        d, through = r["date"], r["labelThrough"]
        if d <= SPLIT["trainEnd"]:
            part = "train" if through <= SPLIT["trainEnd"] else "purged"
        elif SPLIT["calibrationFrom"] <= d <= SPLIT["calibrationThrough"]:
            part = "calibration" if through <= SPLIT["calibrationThrough"] else "purged"
        elif SPLIT["developmentFrom"] <= d <= SPLIT["developmentThrough"]:
            part = "development" if through <= SPLIT["developmentThrough"] else "purged"
        else:
            part = "embargo_or_outside"
        split[part].append(r)
        ledger.append({k: r[k] for k in ["id", "symbol", "date", "labelThrough"]} | {"partition": part})
    return split, ledger

def date_weights(rows):
    require(bool(rows), "cannot weight an empty sample")
    counts = Counter(r["date"] for r in rows)
    raw = np.array([1.0 / counts[r["date"]] for r in rows], dtype=float)
    return raw * len(rows) / raw.sum()

def matrix(rows):
    return np.asarray([r["features"] for r in rows], dtype=float)

def labels(rows):
    return np.asarray([int(r["rawReturn"] > 0) for r in rows], dtype=int)

def check_probabilities(values, n):
    a = np.asarray(values, dtype=float)
    require(a.shape == (n,) and np.isfinite(a).all() and (a >= 0).all() and (a <= 1).all(),
            "model returned missing or invalid probabilities")
    return a

def predict(model, x):
    a = np.asarray(model.predict_proba(x), dtype=float)
    require(a.shape == (len(x), 2), "unexpected predict_proba dimensions")
    return check_probabilities(a[:, 1], len(x))

def logit(values):
    p = np.clip(np.asarray(values, dtype=float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p)).reshape(-1, 1)

def probability_scores(rows, probabilities):
    p = check_probabilities(probabilities, len(rows))
    y, w = labels(rows), date_weights(rows)
    clipped = np.clip(p, 1e-12, 1 - 1e-12)
    average = lambda a: float(np.average(a, weights=w))
    bins = []
    for i in range(5):
        mask = (p >= i / 5) & ((p < (i + 1) / 5) if i < 4 else p <= 1)
        count = int(mask.sum())
        bins.append({
            "low": i / 5, "high": (i + 1) / 5, "stockDays": count,
            "dateEqualWeightMass": float(w[mask].sum() / w.sum()),
            "meanProbability": float(np.average(p[mask], weights=w[mask])) if count else None,
            "observedGrossUpFraction": float(np.average(y[mask], weights=w[mask])) if count else None,
        })
    return {
        "stockDays": len(rows), "distinctDates": len({r["date"] for r in rows}),
        "weighting": "equal_date_then_equal_stock_within_date",
        "brier": average((p - y) ** 2),
        "logLoss": average(-(y * np.log(clipped) + (1 - y) * np.log(1 - clipped))),
        "rocAuc": float(roc_auc_score(y, p, sample_weight=w)) if len(np.unique(y)) == 2 else None,
        "classificationAccuracyAtHalf": average((p >= 0.5) == y),
        "accuracyMeaning": "gross price direction classification, not trade win rate",
        "calibrationBins": bins,
    }

def assumed_return(raw_return, bps):
    half_cost = bps / 20000
    return (1 + raw_return) * (1 - half_cost) / (1 + half_cost) - 1

def selection_summary(all_rows, selected):
    daily_all, daily_selected = defaultdict(list), defaultdict(list)
    for r in all_rows:
        daily_all[r["date"]].append(r)
    for r in selected:
        daily_selected[r["date"]].append(r)
    paired_stock_days = sum(r["benchmarkReturn"] is not None for r in selected)
    scenarios = []
    for bps in [0, 30, 60]:
        values, sample_excess, index_excess = [], [], []
        for d in sorted(daily_selected):
            rows = daily_selected[d]
            net = mean([assumed_return(r["rawReturn"], bps) for r in rows])
            baseline = mean([assumed_return(r["rawReturn"], bps) for r in daily_all[d]])
            values.append(net); sample_excess.append(net - baseline)
            comparable = [r for r in rows if r["benchmarkReturn"] is not None]
            if comparable:
                index_excess.append(mean([assumed_return(r["rawReturn"], bps)
                                          - assumed_return(r["benchmarkReturn"], bps) for r in comparable]))
        scenarios.append({
            "roundTripBps": bps, "executable": False,
            "dailyEqualWeightMeanAssumedPriceReturn": mean(values),
            "sameDateAllReadableSampleExcess": mean(sample_excess),
            "sameDateIndexScenarioExcess": mean(index_excess),
            "indexComparableDates": len(index_excess),
            "indexComparableStockDays": paired_stock_days,
        })
    return {
        "eligibleStockDays": len(all_rows), "signalStockDays": len(selected),
        "signalDates": len(daily_selected), "signalSymbols": len({r["symbol"] for r in selected}),
        "selectedFraction": len(selected) / len(all_rows) if all_rows else None,
        "noSignalFraction": 1 - len(selected) / len(all_rows) if all_rows else None,
        "stockDayGrossPositivePriceFraction": mean([int(r["rawReturn"] > 0) for r in selected]),
        "dailyEqualWeightGrossPositivePriceFraction": mean([
            mean([int(r["rawReturn"] > 0) for r in group]) for group in daily_selected.values()]),
        "costScenarios": scenarios,
        "actualTradingReturn": None, "portfolioMaxDrawdown": None, "targetBeforeStop": None,
    }

def selection_with_quarters(rows, selected):
    summary = selection_summary(rows, selected)
    summary["quarters"] = []
    for q in range(1, 5):
        in_q = lambda r: (int(r["date"][5:7]) - 1) // 3 + 1 == q
        summary["quarters"].append({"quarter": q,
            **selection_summary([r for r in rows if in_q(r)], [r for r in selected if in_q(r)])})
    return summary

def build_model(name, seed):
    if name == "logistic":
        return Pipeline([("scale", StandardScaler()),
            ("classifier", LogisticRegression(C=1, max_iter=1000, random_state=seed))])
    if name == "lightgbm":
        from lightgbm import LGBMClassifier
        return LGBMClassifier(n_estimators=80, num_leaves=7, max_depth=3,
            min_child_samples=100, learning_rate=0.05, random_state=seed, n_jobs=2,
            verbosity=-1, deterministic=True, force_col_wise=True)
    if name == "catboost":
        from catboost import CatBoostClassifier
        return CatBoostClassifier(iterations=80, depth=3, l2_leaf_reg=10,
            learning_rate=0.05, loss_function="Logloss", random_seed=seed,
            thread_count=2, allow_writing_files=False, verbose=False)
    raise ValueError("unknown model")

def fit_and_evaluate(name, train, calibration, development, out, seed):
    model = build_model(name, seed)
    x, y, w = matrix(train), labels(train), date_weights(train)
    if name == "logistic":
        model.fit(x, y, scale__sample_weight=w, classifier__sample_weight=w)
    else:
        model.fit(x, y, sample_weight=w)
    raw = predict(model, matrix(development))
    calibrated, calibrator = raw.copy(), None
    calibration_info = {"rows": len(calibration),
        "distinctDates": len({r["date"] for r in calibration}), "state": "uncalibrated_insufficient_classes"}
    if calibration and len(np.unique(labels(calibration))) == 2:
        cp = predict(model, matrix(calibration))
        calibrator = LogisticRegression(C=1, max_iter=1000, random_state=seed)
        calibrator.fit(logit(cp), labels(calibration), sample_weight=date_weights(calibration))
        calibrated = predict(calibrator, logit(raw))
        calibration_info["state"] = "sigmoid_fit_only_on_2024_calibration"
    model_dir = out / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    if name == "catboost":
        model.save_model(str(model_dir / "catboost.cbm"))
    elif name == "lightgbm":
        model.booster_.save_model(str(model_dir / "lightgbm.txt"))
    else:
        joblib.dump(model, model_dir / "logistic.joblib")
    if calibrator is not None:
        joblib.dump(calibrator, model_dir / f"{name}-calibrator.joblib")
    selected = [r for r, p in zip(development, calibrated) if p >= 0.6]
    result = {"status": "research_only", "predictedStockDays": len(development),
        "abstainedStockDays": 0, "unpredictedFractionOnReadableRows": 0.0,
        "calibration": calibration_info, "rawScores": probability_scores(development, raw),
        "scores": probability_scores(development, calibrated), "selectionThreshold": 0.6,
        "selection": selection_with_quarters(development, selected)}
    return result, raw, calibrated

def run(dataset_path, out):
    require(not out.exists(), "refusing to overwrite an existing training output directory")
    out.mkdir(parents=True)
    write_json(out / "environment.json", environment())
    input_bytes = dataset_path.read_bytes()
    data = json.loads(input_bytes)
    p, rows = validate_dataset(data)
    split, ledger = partition_rows(rows)
    write_json(out / "split-ledger.json", ledger)
    train, calibration, dev = (split[k] for k in ["train", "calibration", "development"])
    require(train and len(np.unique(labels(train))) == 2, "training requires usable rows and both target classes")
    require(dev, "no usable development rows")
    w = date_weights(train)
    constant = float(np.average(labels(train), weights=w))
    baseline_p = np.full(len(dev), constant, dtype=float)
    predictions = [{
        **{k: r[k] for k in ["id", "symbol", "date", "labelThrough", "rawReturn", "benchmarkReturn", "simpleTrend"]},
        "grossUpLabel": int(r["rawReturn"] > 0), "provenance": "reconstructed_development",
        "approved": False, "probabilitiesEnabled": False,
        "forecasts": {"constant": {"rawProbability": constant, "researchProbability": constant}},
    } for r in dev]
    models = {}
    for name in MODEL_NAMES:
        try:
            result, raw, calibrated = fit_and_evaluate(name, train, calibration, dev, out, p["seed"])
            models[name] = result
            for record, a, b in zip(predictions, raw, calibrated):
                record["forecasts"][name] = {"rawProbability": float(a), "researchProbability": float(b)}
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            models[name] = {"status": "failed", "error": message, "predictedStockDays": 0,
                "abstainedStockDays": len(dev), "unpredictedFractionOnReadableRows": 1.0}
            for record in predictions:
                record["forecasts"][name] = {"rawProbability": None, "researchProbability": None, "reason": message}
    with (out / "predictions.jsonl").open("w", encoding="utf-8") as handle:
        for record in predictions:
            handle.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    successful = sum(m["status"] != "failed" for m in models.values())
    canonical = json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    report = {
        "version": "five-session-development-training-1", "generatedAt": utc_now(), "protocolId": p["id"],
        "status": "exploratory_development_only" if successful else "all_candidate_training_failed",
        "approved": False, "probabilitiesEnabled": False, "selectedModel": None,
        "winner": None, "finalTestOpened": False,
        "datasetByteSha256": hashlib.sha256(input_bytes).hexdigest(),
        "canonicalProtocolSha256": hashlib.sha256(canonical).hexdigest(),
        "builderRecordedProtocolHash": data.get("protocolHash"), "calendarHash": data.get("calendarHash"),
        "rawHashes": data.get("rawHashes"), "downloads": data.get("downloads"),
        "coverage": data.get("coverage"), "upstreamExclusionReasons": data.get("exclusionReasons"),
        "counts": {k: len(v) for k, v in split.items()}, "split": SPLIT,
        "featureNames": FEATURES, "seed": p["seed"], "target": p["target"],
        "targetDefinition": "next session open to fifth session close gross price up",
        "outperformProbability": None, "targetBeforeStopProbability": None,
        "weighting": "equal_date_then_equal_stock_within_date",
        "constantBaseline": {"trainOnlyProbability": constant, "scores": probability_scores(dev, baseline_p),
            "selection": selection_with_quarters(dev, [r for r in dev if constant >= 0.6])},
        "allReadableBaseline": selection_with_quarters(dev, dev),
        "simpleTrendRule": {"kind": "fixed_rule_not_probability",
            "selection": selection_with_quarters(dev, [r for r in dev if r["simpleTrend"]])},
        "models": models, "actualTradingReturn": None, "portfolioMaxDrawdown": None,
        "limitations": [
            "2025 is previously inspected development data, not a sealed final test.",
            "2026 is not requested, read or evaluated by this program.",
            "Current fixed stock list has survivorship and selection bias.",
            "Historical data are reconstructed and may have been revised.",
            "Provider adjustment and historical quote scale are not independently verified.",
            "Overlapping stock-days are dependent; row count is not independent sample size.",
            "Scores describe gross price direction, not trading win rate.",
            "Threshold 0.6 and model parameters are fixed; no model winner is selected.",
            "Costs are symmetric proportional scenarios, not verified executable trades.",
            "No verified fills, limit-board exits, suspension handling or stop execution.",
            "No capital allocation or portfolio drawdown simulation is performed.",
            "Development results alone cannot approve live probabilities or superiority.",
        ],
    }
    write_json(out / "models" / "constant.json", {"probability": constant,
        "trainedThrough": SPLIT["trainEnd"], "target": p["target"], "approved": False})
    write_json(out / "report.json", report)
    return 0 if successful else 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path); parser.add_argument("out", type=Path)
    args = parser.parse_args()
    try:
        return run(args.dataset, args.out)
    except Exception as error:
        # Never overwrite an existing report when a directory guard rejected a retry.
        if not (args.out / "report.json").exists():
            args.out.mkdir(parents=True, exist_ok=True)
            write_json(args.out / "report.json", {"status": "unable_to_train",
                "error": f"{type(error).__name__}: {error}", "approved": False,
                "probabilitiesEnabled": False, "selectedModel": None,
                "finalTestOpened": False, "generatedAt": utc_now()})
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
