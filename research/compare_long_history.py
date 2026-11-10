#!/usr/bin/env python3
"""Fixed long-history development comparison. No promotion or final-test access."""
import argparse
from collections import defaultdict
from functools import lru_cache
import hashlib
from itertools import combinations
import json
from pathlib import Path
import sys

import numpy as np
import train_five_day as base

REGIMES = ["short_core", "long_core", "long_expanded"]
PROTOCOL_ID = "allen-long-history-development-20261110-v2"
DEV_FROM, DEV_THROUGH = "2025-01-09", "2025-12-31"
SEED, MIN_DATES, REPLICATES, BLOCK = 20261110, 20, 400, 10
require, finite, mean = base.require, base.finite, base.mean

def canonical_hash(value):
    content = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()

def validate(data, calendar):
    p = data.get("protocol")
    require(isinstance(p, dict) and p.get("id") == PROTOCOL_ID,
            "frozen long-history protocol required")
    require(p.get("approved") is False and p.get("probabilitiesEnabled") is False
            and p.get("winner") is None, "unapproved research protocol required")
    require(p.get("requestFrom") == "2020-01-01"
            and p.get("requestThrough") == DEV_THROUGH
            and p.get("sealedTestFrom") == "2026-01-01", "2026 must remain sealed")
    require(p.get("target") == "next_open_to_fifth_close_gross_up"
            and p.get("featureNames") == base.FEATURES, "fixed target and feature order required")
    require(p.get("historySessions") == 61 and p.get("horizonSessions") == 5
            and p.get("selectionThreshold") == 0.6 and p.get("seed") == SEED,
            "fixed 61/5 windows, threshold and seed required")
    sessions = calendar.get("sessions")
    require(isinstance(sessions, list) and sessions
            and all(base.valid_date(d) for d in sessions)
            and sessions == sorted(set(sessions)), "invalid calendar sessions")
    require(calendar.get("validFrom", "") <= "2020-01-01"
            and calendar.get("validThrough", "") >= DEV_THROUGH, "official calendar coverage missing")
    year_2024 = [d for d in sessions if d.startswith("2024-")]
    require(len(year_2024) >= 61 and p.get("shortWarmupFrom") == year_2024[60],
            "shortWarmupFrom must equal 2024 session number 61")
    universe = p.get("universe")
    require(isinstance(universe, list) and len(universe) == 240, "fixed 240-stock universe required")
    symbols = [x.get("symbol") if isinstance(x, dict) else x for x in universe]
    require(all(isinstance(s, str) and s for s in symbols)
            and len(set(symbols)) == 240, "duplicate/invalid universe symbol")
    core = p.get("coreSymbols")
    require(isinstance(core, list) and len(core) == 32
            and all(isinstance(s, str) for s in core)
            and len(set(core)) == 32 and set(core) <= set(symbols),
            "fixed 32-stock core must be part of the universe")
    rows, ids, keys = data.get("rows"), set(), set()
    require(isinstance(rows, list) and rows, "no readable dataset rows")
    position = {d: i for i, d in enumerate(sessions)}
    for r in rows:
        require(isinstance(r, dict), "invalid dataset row")
        require(isinstance(r.get("id"), str) and r["id"] and r["id"] not in ids, "missing/duplicate row ID")
        require(r.get("symbol") in symbols, "row outside frozen universe")
        d, through = r.get("date"), r.get("labelThrough")
        require(base.valid_date(d) and base.valid_date(through)
                and "2020-01-01" <= d < through <= DEV_THROUGH,
                "2026 is sealed; rows must stay within 2020-2025")
        require(d in position and position[d] + 5 < len(sessions)
                and sessions[position[d] + 5] == through, "labelThrough must be the fifth following official session")
        key = (r["symbol"], d)
        require(key not in keys, "duplicate symbol/date")
        f = r.get("features")
        require(isinstance(f, list) and len(f) == len(base.FEATURES) and all(finite(x) for x in f), "missing/nonfinite features")
        require(finite(r.get("rawReturn")) and r["rawReturn"] > -1, "invalid price return")
        b = r.get("benchmarkReturn")
        require(b is None or finite(b) and b > -1, "invalid benchmark return")
        adverse = r.get("adversePriceExcursion")
        require(finite(adverse) and -1 < adverse <= 0 and adverse <= r["rawReturn"] + 1e-12,
                "invalid future low excursion")
        require(isinstance(r.get("simpleTrend"), bool), "missing trend rule")
        ids.add(r["id"]); keys.add(key)
    rows = sorted(rows, key=lambda r: (r["date"], r["symbol"], r["id"]))
    grid = [d for i, d in enumerate(sessions) if DEV_FROM <= d <= DEV_THROUGH
            and i + 5 < len(sessions) and sessions[i + 5] <= DEV_THROUGH]
    require(grid, "no label-eligible development calendar")
    return p, rows, grid

def partition(rows, regime, p):
    require(regime in REGIMES, "unknown regime")
    core = set(p["coreSymbols"])
    short = regime == "short_core"
    train_from = p["shortWarmupFrom"] if short else "2020-01-01"
    train_end = "2024-08-30" if short else "2023-12-31"
    cal_from = "2024-09-09" if short else "2024-01-01"
    result = {"train": [], "calibration": [], "development": [], "purged": [], "outside_regime": []}
    ledger = []
    for r in rows:
        d, through = r["date"], r["labelThrough"]
        if regime != "long_expanded" and r["symbol"] not in core:
            part = "outside_regime"
        elif train_from <= d <= train_end:
            part = "train" if through <= train_end else "purged"
        elif cal_from <= d <= "2024-12-31":
            part = "calibration" if through <= "2024-12-31" else "purged"
        elif DEV_FROM <= d <= DEV_THROUGH:
            part = "development" if through <= DEV_THROUGH else "purged"
        else:
            part = "outside_regime"
        result[part].append(r)
        ledger.append({"regime": regime, "id": r["id"], "partition": part})
    boundaries = {"trainFrom": train_from, "trainThrough": train_end,
                  "calibrationFrom": cal_from, "calibrationThrough": "2024-12-31",
                  "developmentFrom": DEV_FROM, "developmentThrough": DEV_THROUGH}
    return result, ledger, boundaries

@lru_cache(maxsize=16)
def bootstrap_indices(n):
    require(n > 0, "empty bootstrap calendar")
    rng = np.random.default_rng(SEED)
    starts = rng.integers(0, n, size=(REPLICATES, (n + BLOCK - 1) // BLOCK))
    return ((starts[:, :, None] + np.arange(BLOCK)) % n).reshape(REPLICATES, -1)[:, :n]

def bootstrap(values, grid):
    require(set(values) <= set(grid) and all(finite(v) for v in values.values()), "invalid bootstrap values")
    result = {"state": "insufficient_signal_dates", "signalDates": len(values), "minimumDates": MIN_DATES,
              "low": None, "high": None, "replicates": 0, "blockSessions": BLOCK}
    if len(values) < MIN_DATES:
        return result
    vector = np.asarray([values.get(d, np.nan) for d in grid], dtype=float)
    draws = vector[bootstrap_indices(len(grid))]
    count = np.isfinite(draws).sum(axis=1)
    sampled = np.nansum(draws, axis=1)[count > 0] / count[count > 0]
    result.update({"state": "exploratory_circular_date_block_interval",
        "low": float(np.quantile(sampled, 0.025)), "high": float(np.quantile(sampled, 0.975)), "replicates": len(sampled)})
    return result

def daily_cost_maps(all_rows, selected):
    all_daily, chosen = defaultdict(list), defaultdict(list)
    all_ids = {r["id"] for r in all_rows}
    require(all(r["id"] in all_ids for r in selected), "selection outside its evaluation cohort")
    for r in all_rows:
        all_daily[r["date"]].append(r)
    for r in selected:
        chosen[r["date"]].append(r)
    result = {}
    for bps in [0, 30, 60]:
        prices, excess = {}, {}
        for d in sorted(chosen):
            prices[d] = mean([base.assumed_return(r["rawReturn"], bps) for r in chosen[d]])
            baseline = mean([base.assumed_return(r["rawReturn"], bps) for r in all_daily[d]])
            excess[d] = prices[d] - baseline
        result[bps] = {"price": prices, "sampleExcess": excess}
    return result

def low_excursion(rows):
    values = [r["adversePriceExcursion"] for r in rows]
    daily = defaultdict(list)
    for r in rows:
        daily[r["date"]].append(r["adversePriceExcursion"])
    return {"kind": "single_stock_five_session_low_relative_to_entry_open",
        "stockDays": len(values), "stockDayMean": mean(values),
        "stockDayP05": float(np.quantile(values, 0.05)) if values else None,
        "worstObserved": min(values) if values else None,
        "dateEqualMean": mean([mean(v) for v in daily.values()]),
        "portfolioMaxDrawdown": None, "actualTradingReturn": None}

def selection_summary(all_rows, selected, grid):
    result = base.selection_summary(all_rows, selected)
    maps = daily_cost_maps(all_rows, selected)
    for scenario in result["costScenarios"]:
        values = maps[scenario["roundTripBps"]]
        scenario["uncertainty"] = {"assumedPriceReturn": bootstrap(values["price"], grid),
                                  "sameDateSampleExcess": bootstrap(values["sampleExcess"], grid)}
    result["singleStockFiveSessionLowExcursion"] = low_excursion(selected)
    return result

def selection_with_quarters(rows, selected, grid):
    result = selection_summary(rows, selected, grid)
    result["quarters"] = []
    for q in range(1, 5):
        in_q = lambda d: (int(d[5:7]) - 1) // 3 + 1 == q
        result["quarters"].append({"quarter": q, **selection_summary(
            [r for r in rows if in_q(r["date"])], [r for r in selected if in_q(r["date"])],
            [d for d in grid if in_q(d)])})
    return result

def evaluate_scope(rows, raw, calibrated, grid):
    raw = base.check_probabilities(raw, len(rows))
    calibrated = base.check_probabilities(calibrated, len(rows))
    selected = [r for r, probability in zip(rows, calibrated) if probability >= 0.6]
    return {"cohortHash": canonical_hash([r["id"] for r in rows]), "predictedStockDays": len(rows),
        "abstainedStockDays": 0, "unpredictedFractionOnReadableRows": 0.0,
        "rawScores": base.probability_scores(rows, raw), "scores": base.probability_scores(rows, calibrated),
        "selectionThreshold": 0.6, "selection": selection_with_quarters(rows, selected, grid)}

def paired_comparison(a, b, grid):
    common = sorted(set(a[0]["price"]) & set(b[0]["price"]))
    enough = len(common) >= MIN_DATES
    result = {"state": "paired_common_dates" if enough else "insufficient_common_dates",
        "aSignalDates": len(a[0]["price"]), "bSignalDates": len(b[0]["price"]),
        "commonSignalDates": len(common), "minimumDates": MIN_DATES, "costScenarios": []}
    for bps in [0, 30, 60]:
        difference = {d: a[bps]["price"][d] - b[bps]["price"][d] for d in common}
        result["costScenarios"].append({"roundTripBps": bps,
            "meanAssumedPriceReturnDifference": mean(list(difference.values())) if enough else None,
            "uncertainty": bootstrap(difference, grid)})
    return result

def scope_baselines(rows, constant, grid):
    fixed = np.full(len(rows), constant, dtype=float) if constant is not None else None
    return {"cohortHash": canonical_hash([r["id"] for r in rows]),
        "allReadable": selection_with_quarters(rows, rows, grid),
        "simpleTrend": {"kind": "fixed_rule_not_probability", "selection": selection_with_quarters(
            rows, [r for r in rows if r["simpleTrend"]], grid)},
        "constant": evaluate_scope(rows, fixed, fixed, grid) if fixed is not None else
                    {"status": "unavailable_no_training_rows"}}

def concise_scope(scope):
    selection = scope["selection"]
    cost = selection["costScenarios"][1]
    return {"stockDays": scope["scores"]["stockDays"], "brier": scope["scores"]["brier"],
        "rocAuc": scope["scores"]["rocAuc"], "signalStockDays": selection["signalStockDays"],
        "signalDates": selection["signalDates"], "assumed30bps": cost["dailyEqualWeightMeanAssumedPriceReturn"],
        "sameDateSampleExcess30bps": cost["sameDateAllReadableSampleExcess"],
        "uncertainty30bps": cost["uncertainty"], "singleStockLowExcursion": selection["singleStockFiveSessionLowExcursion"]}

def daily_brier(rows, probabilities):
    grouped = defaultdict(list)
    for r,p in zip(rows,probabilities):
        grouped[r["date"]].append((float(p)-int(r["rawReturn"]>0))**2)
    return {d:mean(v) for d,v in grouped.items()}

def run(dataset_path, out, calendar_path):
    require(not out.exists(), "refusing to overwrite existing experiment output")
    out.mkdir(parents=True)
    input_bytes, calendar_bytes = dataset_path.read_bytes(), calendar_path.read_bytes()
    data, calendar = json.loads(input_bytes), json.loads(calendar_bytes)
    p, rows, grid = validate(data, calendar)
    base.write_json(out / "environment.json", base.environment())
    core = set(p["coreSymbols"])
    all_dev = [r for r in rows if DEV_FROM <= r["date"] <= DEV_THROUGH]
    common_core = [r for r in all_dev if r["symbol"] in core]
    require(common_core, "no shared readable core development cohort")
    common_ids = [r["id"] for r in common_core]
    predictions = {r["id"]: {
        **{k: r[k] for k in ["id", "symbol", "date", "labelThrough", "rawReturn",
                             "benchmarkReturn", "adversePriceExcursion", "simpleTrend"]},
        "grossUpLabel": int(r["rawReturn"] > 0), "approved": False,
        "probabilitiesEnabled": False, "forecasts": {}} for r in all_dev}
    regimes, compare_maps, brier_maps, successful = {}, {}, {}, 0
    with (out / "split-ledger.jsonl").open("w", encoding="utf-8") as ledger_file:
        for regime in REGIMES:
            split, ledger, boundaries = partition(rows, regime, p)
            for entry in ledger:
                ledger_file.write(json.dumps(entry, ensure_ascii=False) + "\n")
            train, calibration, dev = (split[k] for k in ["train", "calibration", "development"])
            require([r["id"] for r in dev if r["symbol"] in core] == common_ids,
                    "regimes must share the identical core evaluation cohort")
            core_index = [i for i, r in enumerate(dev) if r["symbol"] in core]
            scopes = {"core_common": core_index}
            if regime == "long_expanded":
                scopes["expanded_readable"] = list(range(len(dev)))
            constant = float(np.average(base.labels(train), weights=base.date_weights(train))) if train else None
            target = out / regime
            target.mkdir()
            baselines = {name: scope_baselines([dev[i] for i in idx], constant, grid) for name, idx in scopes.items()}
            models = {}
            dev_ids = {r["id"] for r in dev}
            for row_id, record in predictions.items():
                record["forecasts"][regime] = ({"state": "research_only", "constantProbability": constant,
                    "models": {}} if row_id in dev_ids else {"state": "outside_scope"})
            for name in base.MODEL_NAMES:
                try:
                    require(train and len(np.unique(base.labels(train))) == 2,
                            "training requires readable rows and both classes")
                    fitted, raw, calibrated = base.fit_and_evaluate(name, train, calibration, dev, target, SEED)
                    model_scopes = {scope: evaluate_scope([dev[i] for i in idx], raw[idx], calibrated[idx], grid)
                                    for scope, idx in scopes.items()}
                    models[name] = {"status": "research_only", "calibration": fitted["calibration"],
                        "trainedThrough": max(r["labelThrough"] for r in train),
                        "calibrationLabelThrough": max((r["labelThrough"] for r in calibration), default=None),
                        "scopes": model_scopes}
                    core_selected = [dev[i] for i in core_index if calibrated[i] >= 0.6]
                    compare_maps[f"{regime}/{name}"] = daily_cost_maps(common_core, core_selected)
                    brier_maps[f"{regime}/{name}"] = daily_brier(common_core,calibrated[core_index])
                    for r, a, b in zip(dev, raw, calibrated):
                        predictions[r["id"]]["forecasts"][regime]["models"][name] = {
                            "rawProbability": float(a), "researchProbability": float(b)}
                    successful += 1
                except Exception as error:
                    message = f"{type(error).__name__}: {error}"
                    models[name] = {"status": "failed", "error": message, "predictedStockDays": 0,
                                    "abstainedStockDays": len(dev)}
                    for r in dev:
                        predictions[r["id"]]["forecasts"][regime]["models"][name] = {
                            "rawProbability": None, "researchProbability": None, "reason": message}
            base.write_json(target / "models" / "constant.json", {
                "probability": constant, "approved": False, "boundaries": boundaries})
            regimes[regime] = {"counts": {k: len(v) for k, v in split.items()},
                               "boundaries": boundaries, "baselines": baselines, "models": models}
    with (out / "predictions.jsonl").open("w", encoding="utf-8") as handle:
        for record in predictions.values():
            handle.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    comparisons = [{"a": a, "b": b, **paired_comparison(compare_maps[a], compare_maps[b], grid)}
                   for a, b in combinations(compare_maps, 2)]
    brier_comparisons = []
    for name in base.MODEL_NAMES:
        for a,b in [("long_core","short_core"),("long_expanded","long_core"),("long_expanded","short_core")]:
            ka,kb=f"{a}/{name}",f"{b}/{name}"
            if ka not in brier_maps or kb not in brier_maps:
                brier_comparisons.append({"a":ka,"b":kb,"state":"candidate_failed","difference":None,"uncertainty":None})
                continue
            require(set(brier_maps[ka])==set(brier_maps[kb]),"Brier comparison dates must be identical")
            diff={d:brier_maps[ka][d]-brier_maps[kb][d] for d in brier_maps[ka]}
            brier_comparisons.append({"a":ka,"b":kb,"state":"paired_core_daily_brier",
                "difference":mean(list(diff.values())),"meaning":"negative means lower error on this same development cohort",
                "uncertainty":bootstrap(diff,grid)})
    report = {
        "version": "long-history-development-2", "generatedAt": base.utc_now(), "protocolId": p["id"],
        "approved": False, "probabilitiesEnabled": False, "winner": None, "selectedModel": None,
        "finalTestOpened": False,
        "status": "exploratory_development_only" if successful == 9 else
                  "partial_candidate_failure" if successful else "unable_to_train",
        "successfulCandidates": successful, "expectedCandidates": 9,
        "datasetByteSha256": hashlib.sha256(input_bytes).hexdigest(),
        "calendarByteSha256": hashlib.sha256(calendar_bytes).hexdigest(),
        "canonicalProtocolSha256": canonical_hash(p),
        "builderRecordedProtocolHash": data.get("protocolHash"),
        "baseCodeSha256": hashlib.sha256(Path(base.__file__).read_bytes()).hexdigest(),
        "coverage": data.get("coverage"), "downloads": data.get("downloads"), "rawHashes": data.get("rawHashes"),
        "upstreamExclusionReasons": data.get("exclusionReasons"),
        "coreCohortHash": canonical_hash(common_ids), "coreDevelopmentStockDays": len(common_core),
        "expandedDevelopmentStockDays": len(all_dev),
        "bootstrap": {"grid": grid, "seed": SEED, "blockSessions": BLOCK,
                      "replicates": REPLICATES, "minimumSignalDates": MIN_DATES, "missingDates": "NaN_not_zero"},
        "regimes": regimes, "pairedCoreComparisons": comparisons, "pairedCoreBrierDifferences": brier_comparisons,
        "actualTradingReturn": None, "portfolioMaxDrawdown": None, "targetBeforeStop": None,
        "limitations": [
            "2025 has already been inspected and remains development, not a final test.",
            "2026 daily bars were neither requested nor used for features, labels or evaluation.",
            "Fixed current-list stocks and deterministic expansion retain survivorship bias.",
            "Provider historical prices and adjustment scale are not independently verified.",
            "Longer history does not automatically establish better future performance.",
            "All models and the 0.6 threshold are fixed; no winner is selected.",
            "Overlapping stock-days are dependent; block intervals are exploratory.",
            "Intervals and many paired comparisons do not establish statistical significance.",
            "Costs are proportional price scenarios, with unverified fills, minimum commissions and taxes.",
            "Five-session lows describe single-stock paths, not portfolio drawdown.",
            "Gaps, limits and suspensions may prevent an assumed entry or exit.",
            "Neither actual trading returns nor target-before-stop probability are studied.",
        ],
    }
    base.write_json(out / "report.json", report)
    concise = {"status": report["status"], "successfulCandidates": successful,
        "coverage": report["coverage"], "coreCohortHash": report["coreCohortHash"],
        "coreDevelopmentStockDays": len(common_core), "expandedDevelopmentStockDays": len(all_dev),
        "pairedCoreBrierDifferences": brier_comparisons, "regimes": {}}
    for regime, result in regimes.items():
        concise["regimes"][regime] = {"counts": result["counts"], "models": {
            name: ({"status": model["status"], "scopes": {
                scope: concise_scope(value) for scope, value in model["scopes"].items()}}
                if model["status"] != "failed" else model) for name, model in result["models"].items()}}
    print("LONG_HISTORY_SUMMARY " + json.dumps(concise, ensure_ascii=False, allow_nan=False))
    return 0 if successful == 9 else 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path); parser.add_argument("out", type=Path)
    parser.add_argument("--calendar", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        print("refusing to overwrite existing experiment output", file=sys.stderr)
        return 1
    try:
        return run(args.dataset, args.out, args.calendar)
    except Exception as error:
        if not args.out.exists():
            args.out.mkdir(parents=True)
        if not (args.out / "report.json").exists():
            base.write_json(args.out / "report.json", {
                "status": "unable_to_compare", "error": f"{type(error).__name__}: {error}",
                "approved": False, "probabilitiesEnabled": False, "winner": None, "finalTestOpened": False})
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
