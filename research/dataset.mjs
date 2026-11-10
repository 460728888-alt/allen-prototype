import crypto from 'node:crypto';

const finite = x => typeof x === 'number' && Number.isFinite(x);
const ensure = (x, message) => { if (!x) throw Error(message); };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const hash = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const dateAt = n => new Date(n * 1000 + 8 * 3600000).toISOString().slice(0, 10);
const valid = b => b && b.complete !== false && ['open','high','low','close'].every(k => finite(b[k]) && b[k] > 0)
  && b.high >= Math.max(b.open,b.close,b.low) && b.low <= Math.min(b.open,b.close,b.high);

export function assertProtocol(p) {
  ensure(p && p.requestFrom === '2024-01-01' && p.requestThrough === '2025-12-31'
    && p.sealedTestFrom === '2026-01-01', 'sealed_test_window_must_not_be_requested');
  ensure(p.approved === false && p.probabilitiesEnabled === false && p.winner === null, 'isolated_unapproved_experiment_only');
  ensure(p.trainEnd === '2024-08-30' && p.calibrationFrom === '2024-09-09'
    && p.calibrationThrough === '2024-12-31' && p.developmentFrom === '2025-01-09'
    && p.developmentThrough === '2025-12-31', 'fixed_time_partitions_required');
  ensure(p.historySessions === 61 && p.horizonSessions === 5 && p.selectionThreshold === .6
    && p.target === 'next_open_to_fifth_close_gross_up', 'fixed_target_and_windows_required');
  ensure(JSON.stringify(p.featureNames) === JSON.stringify(['ret5','ret20','ret60','aboveMa20','aboveMa60','ma20Slope5','drawdown20','range5vs20','volume5vs20','realizedVol20']), 'fixed_features_required');
  ensure(Array.isArray(p.universe) && p.universe.length === 32 && new Set(p.universe.map(x => x.symbol)).size === 32, 'fixed_unique_32_stock_universe_required');
  ensure(p.universe.every(x => /^\d{6}\.(SZ|SS)$/.test(x.symbol)) && !p.universe.some(x => x.symbol === p.benchmark), 'invalid_universe');
  return p;
}

export function buildSessions(calendar, p) {
  assertProtocol(p);
  ensure(calendar.validFrom <= p.requestFrom && calendar.validThrough >= p.requestThrough
    && JSON.stringify(calendar.weekendClosed) === '[0,6]', 'reviewed_calendar_coverage_missing');
  ensure([2024,2025].every(y => calendar.years.some(x => x.year === y && x.closures.length && x.sources.length)), 'reviewed_calendar_year_missing');
  const closures = calendar.years.flatMap(x => x.closures);
  const out = [];
  for (let n = Date.parse(p.requestFrom + 'T00:00:00Z'); n <= Date.parse(p.requestThrough + 'T00:00:00Z'); n += 86400000) {
    const d = new Date(n), s = d.toISOString().slice(0,10);
    if (![0,6].includes(d.getUTCDay()) && !closures.some(([a,b]) => s >= a && s <= b)) out.push(s);
  }
  ensure(out.length > 450 && out.every(x => x < p.sealedTestFrom), 'invalid_session_calendar');
  return out;
}

export function parseProvider(result, symbol, p) {
  assertProtocol(p);
  ensure(result?.meta?.symbol === symbol, 'provider_symbol_mismatch');
  ensure(Array.isArray(result.timestamp) && result.indicators?.quote?.[0], 'provider_history_missing');
  const q = result.indicators.quote[0], adj = result.indicators.adjclose?.[0]?.adjclose, seen = new Set(), rows = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const time = result.timestamp[i]; ensure(finite(time) && time > 0, 'invalid_timestamp');
    const date = dateAt(time);
    ensure(date >= p.requestFrom && date <= p.requestThrough && date < p.sealedTestFrom, 'provider_returned_sealed_or_outside_dates');
    ensure(!seen.has(date), 'duplicate_session'); seen.add(date);
    const close = q.close?.[i], adjusted = adj?.[i];
    rows.push({date,open:q.open?.[i] ?? null,high:q.high?.[i] ?? null,low:q.low?.[i] ?? null,
      close:close ?? null,volume:q.volume?.[i] ?? null,
      adjustmentFactor:finite(close) && close > 0 && finite(adjusted) && adjusted > 0 ? adjusted / close : null});
  }
  rows.sort((a,b) => a.date.localeCompare(b.date));
  const actions = [];
  for (const [type, values] of Object.entries(result.events || {})) {
    if (!['dividends','splits','capitalGains'].includes(type)) continue;
    for (const event of Object.values(values || {})) {
      ensure(finite(event.date), 'corporate_action_date_missing');
      const date = dateAt(event.date);
      ensure(date < p.sealedTestFrom, 'sealed_corporate_action_returned');
      if (date >= p.requestFrom && date <= p.requestThrough) actions.push({type,date});
    }
  }
  ensure(rows.length, 'empty_history');
  return {symbol,rows,actions};
}

export function featuresAt(series, date, sessions) {
  ensure(date < '2026-01-01', 'sealed_test_forbidden');
  const end = sessions.indexOf(date); ensure(end >= 60, 'history_too_short');
  const dates = sessions.slice(end - 60, end + 1), lookup = new Map(series.rows.map(x => [x.date,x]));
  ensure(lookup.size === series.rows.length, 'duplicate_session');
  const raw = dates.map(d => lookup.get(d));
  ensure(raw.every(valid), 'missing_or_invalid_history_price');
  ensure(raw.every(x => finite(x.volume) && x.volume > 0), 'missing_or_invalid_history_volume');
  ensure(raw.every(x => finite(x.adjustmentFactor) && x.adjustmentFactor > 0), 'missing_adjustment_factor');
  ensure(!(series.actions || []).some(x => x.type === 'splits' && x.date >= dates[0] && x.date <= date), 'split_volume_basis_unverified');
  const anchor = raw.at(-1).adjustmentFactor;
  const rows = raw.map(r => ({...r,...Object.fromEntries(['open','high','low','close'].map(k => [k,r[k] * r.adjustmentFactor / anchor]))}));
  const c = rows.map(x => x.close), last = c[60], tail20 = rows.slice(-20), tail5 = rows.slice(-5);
  const ma20 = mean(c.slice(-20)), ma60 = mean(c.slice(-60)), previousMa20 = mean(c.slice(36,56));
  const range = rs => (Math.max(...rs.map(x => x.high)) - Math.min(...rs.map(x => x.low))) / mean(rs.map(x => x.close));
  ensure(range(tail20) > 0, 'zero_price_range');
  const returns = c.slice(41).map((v,i) => v / c[i+40] - 1), rmean = mean(returns);
  const values = [last/c[55]-1,last/c[40]-1,last/c[0]-1,last/ma20-1,last/ma60-1,
    ma20/previousMa20-1,last/Math.max(...tail20.map(x=>x.high))-1,range(tail5)/range(tail20),
    mean(tail5.map(x=>x.volume))/mean(tail20.map(x=>x.volume)),Math.sqrt(mean(returns.map(x=>(x-rmean)**2)))];
  ensure(values.every(finite), 'nonfinite_feature');
  return {features:values,simpleTrend:last > ma20 && ma20 > ma60,featureHash:hash(rows),dataThrough:date};
}

function outcome(series, benchmark, dates) {
  const get = s => { const m = new Map(s.rows.map(x=>[x.date,x])); return dates.map(d=>m.get(d)); };
  const rows = get(series);
  ensure(rows.every(valid) && rows.every(x=>finite(x.volume) && x.volume > 0), 'future_price_or_volume_missing');
  ensure(!(series.actions || []).some(x=>x.date >= dates[0] && x.date <= dates.at(-1)), 'label_window_corporate_action');
  const rawReturn = rows.at(-1).close/rows[0].open-1;
  let benchmarkReturn = null;
  if (benchmark) {
    const b = get(benchmark);
    if (b.every(valid) && !(benchmark.actions || []).some(x=>x.date >= dates[0] && x.date <= dates.at(-1)))
      benchmarkReturn = b.at(-1).close/b[0].open-1;
  }
  ensure(finite(rawReturn) && rawReturn > -1, 'invalid_price_label');
  return {rawReturn,benchmarkReturn,entryDate:dates[0],entryPrice:rows[0].open,exitPrice:rows.at(-1).close};
}

export function buildDataset({protocol,calendar,series,downloads=[],rawHashes={},sourceCommit=null}) {
  assertProtocol(protocol);
  ensure(Array.isArray(series) && new Set(series.map(x=>x.symbol)).size === series.length, 'duplicate_source_symbol');
  ensure(series.every(s=>s.rows.every(x=>x.date >= protocol.requestFrom && x.date <= protocol.requestThrough)), 'sealed_or_outside_source_rows');
  ensure(series.some(x=>protocol.universe.some(u=>u.symbol===x.symbol)), 'unable_to_judge_all_stock_requests_failed');
  const sessions = buildSessions(calendar,protocol), lookup = new Map(series.map(x=>[x.symbol,x])), benchmark = lookup.get(protocol.benchmark);
  const rows=[], exclusions=[], counts={};
  const excluded = x => { exclusions.push(x); counts[x.reason]=(counts[x.reason]||0)+1; };
  for (const {symbol} of [...protocol.universe].sort((a,b)=>a.symbol.localeCompare(b.symbol))) {
    const s = lookup.get(symbol);
    for (let i=0;i<sessions.length;i++) {
      const date=sessions[i], dates=sessions.slice(i+1,i+6), base={id:symbol+'@'+date,symbol,date,labelThrough:dates.at(-1)??null};
      if (!s) { excluded({...base,reason:'source_unavailable'}); continue; }
      if (dates.length!==5) { excluded({...base,reason:'future_horizon_incomplete'}); continue; }
      try {
        const f=featuresAt(s,date,sessions), y=outcome(s,benchmark,dates);
        rows.push({...base,...f,...y,execution:'unknown_no_verified_tradability',actualTradingReturn:null});
      } catch(e) { excluded({...base,reason:String(e.message)}); }
    }
  }
  ensure(rows.length > 0, 'unable_to_judge_no_valid_training_labels');
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol));
  return {schemaVersion:1,protocol,sourceCommit,reconstructedAt:new Date().toISOString(),protocolHash:hash(protocol),
    calendarHash:hash(calendar),rawHashes,downloads,rows,exclusions,exclusionReasons:counts,
    coverage:{requestedStocks:protocol.universe.length,receivedStocks:protocol.universe.filter(x=>lookup.has(x.symbol)).length,
      failedStocks:protocol.universe.filter(x=>!lookup.has(x.symbol)).length,eligibleStockDays:sessions.length*protocol.universe.length,
      readableLabels:rows.length,benchmarkPairedLabels:rows.filter(x=>finite(x.benchmarkReturn)).length},
    priceScaleIndependentlyVerified:false,universePointInTime:false,approved:false,probabilitiesEnabled:false};
}
