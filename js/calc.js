/* ============================================================
   calc.js  —  計算をまとめたファイル
   ------------------------------------------------------------
   カロリー・平均・年齢などの計算式はすべてここに置きます。
   式を変えるときはこのファイルだけを直します。

   【重要】式を変更したら VERSION を上げてください。
   過去に保存した推定値が、どの式で計算されたものかを
   区別できるようにするためです。
   ============================================================ */

var App = App || {};

App.Calc = (function () {
  'use strict';

  /* 計算式のバージョン。式を変えたら必ず上げる
     1.1.0：有酸素のマシン表示カロリーを原値のまま扱う方式に変更
            （gross と明示された場合のみ安静時ぶんを差し引く）
            7日平均は7日分揃ったときのみ正式な平均として返す方式に変更
     1.2.0：7日平均の成立条件を「直近7日のうち minSamples 日以上」に変更（既定5日）
            集計期間を「今日から遡った7日」で固定（最後の測定日基準をやめた）
            前週比較 weekOverWeek() を追加（両期間とも minSamples 日以上のときだけ比較）
     1.3.0：1日ぶんをまとめて計算する dailySummary() を追加
            （摂取・消費の内訳・収支を、保存された生データから毎回計算し直す） */
  var VERSION = 'calc-1.3.0';

  /* 計算に使う固定値 */
  var CONST = {
    WALK_METS:        3.5,   // 通常歩行の強度
    WALK_SPEED_KMH:   4.8,   // 歩行速度の想定
    METS_TO_KCAL:     1.05,  // METs式の係数（kcal / kg / 時間）
    KCAL_PER_KG_FAT:  7200   // 体脂肪1kgあたりのカロリー（目安）
  };

  /* ---------- 小さな道具 ---------- */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function round(v, digits) {
    if (!isNum(v)) { return null; }
    var p = Math.pow(10, digits || 0);
    return Math.round(v * p) / p;
  }

  /* ---------- 入力刻みの確認 ---------- */

  /* 小数の計算には誤差があります（0.1 を足していくと 0.30000000000000004 の
     ようになる）。そのままの比較では「0.1刻み」の判定が失敗するため、
     刻みで割った値が整数に十分近いかどうかで判定します。 */
  var EPSILON = 1e-6;

  function isInteger(v) {
    if (!isNum(v)) { return false; }
    return Math.abs(v - Math.round(v)) < EPSILON;
  }

  /* v が step の倍数かどうか（0.1刻み、0.5刻みなど） */
  function isMultipleOf(v, step) {
    if (!isNum(v) || !isNum(step) || step <= 0) { return false; }
    var ratio = v / step;
    return Math.abs(ratio - Math.round(ratio)) < EPSILON;
  }

  /* 刻みに合わせて値を整える。
     71.80000000000001 のような誤差を保存しないためのものです。 */
  function snapToStep(v, step) {
    if (!isNum(v) || !isNum(step) || step <= 0) { return v; }
    return round(Math.round(v / step) * step, 3);
  }

  /* ---------- 日付の道具 ---------- */

  function pad2(n) { return ('0' + n).slice(-2); }

  /* 今日の日付を 'YYYY-MM-DD' で返す（端末の時計基準） */
  function todayStr(ref) {
    var d = ref ? new Date(ref) : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* 現在時刻を 'HH:MM' で返す */
  function nowTimeStr(ref) {
    var d = ref ? new Date(ref) : new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* 'YYYY-MM-DD' を n 日ずらす */
  function shiftDate(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) { return null; }
    d.setDate(d.getDate() + days);
    return todayStr(d);
  }

  /* 'YYYY-MM-DD' を '9/21' のように短く表示する */
  function formatDateShort(dateStr) {
    if (!dateStr) { return ''; }
    var p = dateStr.split('-');
    if (p.length !== 3) { return dateStr; }
    return Number(p[1]) + '/' + Number(p[2]);
  }

  /* 'YYYY-MM-DD' を '2026年9月21日(月)' のように表示する */
  function formatDateJP(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) { return dateStr; }
    var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + w + ')';
  }

  /* ---------- 年齢 ---------- */

  /* 生年月日（'1976-05-20' 形式）から、基準日時点の満年齢を返す */
  function ageFromBirthdate(birthdate, refDate) {
    if (!birthdate) { return null; }
    var b = new Date(birthdate + 'T00:00:00');
    if (isNaN(b.getTime())) { return null; }
    var r = refDate ? new Date(refDate) : new Date();
    var age = r.getFullYear() - b.getFullYear();
    var m = r.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && r.getDate() < b.getDate())) { age -= 1; }
    return (age >= 0 && age < 150) ? age : null;
  }

  /* ---------- 基礎代謝 ---------- */

  /* Mifflin-St Jeor 式（体組成計の値がないときの代替）
     男性：10×体重(kg) + 6.25×身長(cm) − 5×年齢 + 5 */
  function bmrMifflin(opts) {
    if (!opts || !isNum(opts.weightKg) || !isNum(opts.heightCm) || !isNum(opts.age)) { return null; }
    var base = 10 * opts.weightKg + 6.25 * opts.heightCm - 5 * opts.age;
    var v = (opts.sex === 'female') ? (base - 161) : (base + 5);
    return round(v, 0);
  }

  /* その日の基礎代謝を決める。
     1) 体組成計の値  2) 直近の体組成計の値  3) Mifflin-St Jeor
     どれを使ったかも一緒に返す。 */
  function resolveBmr(opts) {
    if (!opts) { return { value: null, source: 'none' }; }
    if (isNum(opts.deviceBmr))     { return { value: round(opts.deviceBmr, 0), source: 'device' }; }
    if (isNum(opts.lastDeviceBmr)) { return { value: round(opts.lastDeviceBmr, 0), source: 'device-last' }; }
    var est = bmrMifflin(opts);
    return { value: est, source: est === null ? 'none' : 'formula' };
  }

  /* ---------- 日常活動補正 ---------- */

  /* 歩数に現れない日常活動ぶん。基礎代謝 × β */
  function dailyActivityKcal(bmr24, beta) {
    if (!isNum(bmr24) || !isNum(beta)) { return null; }
    return round(bmr24 * beta, 0);
  }

  /* ---------- 歩行 ---------- */

  /* 歩数 → 距離(km) */
  function walkDistanceKm(steps, strideCm) {
    if (!isNum(steps) || !isNum(strideCm)) { return null; }
    return round(steps * strideCm / 100 / 1000, 2);
  }

  /* 歩行の「正味」消費カロリー。
     安静時ぶんは基礎代謝として別に数えているので (METs − 1) を使う。 */
  function walkingKcal(opts) {
    if (!opts || !isNum(opts.steps) || !isNum(opts.strideCm) || !isNum(opts.weightKg)) { return null; }
    var km = walkDistanceKm(opts.steps, opts.strideCm);
    if (km === null) { return null; }
    var hours = km / CONST.WALK_SPEED_KMH;
    var kcal = (CONST.WALK_METS - 1) * opts.weightKg * hours * CONST.METS_TO_KCAL;
    return round(kcal, 0);
  }

  /* ---------- 筋トレ ---------- */

  /* 時間と強度から正味の消費カロリーを推定する */
  function strengthKcal(opts) {
    if (!opts || !isNum(opts.durationMin) || !isNum(opts.weightKg) || !isNum(opts.mets)) { return null; }
    var hours = opts.durationMin / 60;
    var kcal = (opts.mets - 1) * opts.weightKg * hours * CONST.METS_TO_KCAL;
    return round(Math.max(kcal, 0), 0);
  }

  /* ---------- 有酸素 ---------- */

  /* マシン表示のカロリーの扱い。
     マシンによって計算方式が違うため、表示値を勝手に加工しません。

       machineKcalType
         'gross'   … 安静時ぶんを含むと分かっている → その時間ぶんの基礎代謝を引く
         'net'     … 安静時ぶんを除いた値と分かっている → そのまま使う
         'unknown' … 不明（既定）→ 表示値を参考値としてそのまま使う

     machineKcal は必ず原値のまま machineKcalRaw として返します。
     マシン表示がない場合のみ METs から推定します。 */
  function cardioKcal(opts) {
    if (!opts || !isNum(opts.durationMin)) { return null; }
    var hours = opts.durationMin / 60;

    if (isNum(opts.machineKcal)) {
      var type = opts.machineKcalType || 'unknown';

      if (type === 'gross' && isNum(opts.bmr24)) {
        var restKcal = (opts.bmr24 / 24) * hours;
        return {
          value:              round(Math.max(opts.machineKcal - restKcal, 0), 0),
          basis:              'machine-gross-adjusted',
          machineKcalRaw:     opts.machineKcal,
          machineKcalType:    type,
          restingSubtracted:  round(restKcal, 0),
          isEstimate:         true,
          calculationVersion: VERSION
        };
      }

      return {
        value:              round(opts.machineKcal, 0),
        basis:              (type === 'net') ? 'machine-net' : 'machine-as-reported',
        machineKcalRaw:     opts.machineKcal,
        machineKcalType:    type,
        restingSubtracted:  0,
        isEstimate:         true,
        calculationVersion: VERSION
      };
    }

    if (isNum(opts.mets) && isNum(opts.weightKg)) {
      return {
        value:              round(Math.max((opts.mets - 1) * opts.weightKg * hours * CONST.METS_TO_KCAL, 0), 0),
        basis:              'mets-estimate',
        machineKcalRaw:     null,
        machineKcalType:    null,
        restingSubtracted:  0,
        isEstimate:         true,
        calculationVersion: VERSION
      };
    }
    return null;
  }

  /* ---------- 食事誘発性熱産生 ---------- */

  function tefKcal(intakeKcal, tefRate) {
    if (!isNum(intakeKcal) || !isNum(tefRate)) { return null; }
    return round(intakeKcal * tefRate, 0);
  }

  /* ---------- 食事の合計 ---------- */

  /* 食事の一覧からカロリーと PFC を合計する。
     未入力（null）の項目は 0 として扱います。 */
  function sumNutrition(meals) {
    var t = { kcal: 0, protein: 0, fat: 0, carb: 0, count: 0 };
    (meals || []).forEach(function (m) {
      if (!m) { return; }
      if (isNum(m.kcal))    { t.kcal    += m.kcal; }
      if (isNum(m.protein)) { t.protein += m.protein; }
      if (isNum(m.fat))     { t.fat     += m.fat; }
      if (isNum(m.carb))    { t.carb    += m.carb; }
      t.count += 1;
    });
    t.kcal    = round(t.kcal, 0);
    t.protein = round(t.protein, 1);
    t.fat     = round(t.fat, 1);
    t.carb    = round(t.carb, 1);
    return t;
  }

  /* ---------- 1日の消費カロリー合計 ---------- */

  /* 内訳と合計を返す。値がないものは 0 として合計する。
     cardio には cardioKcal() が返した .value を渡すこと。
     【二重計上禁止】
     ・歩数はジム外の日常歩行のみを入れること
     ・トレッドミルや水中ウォーキングは有酸素として入れること
     ・同じ時間帯の筋トレと有酸素を重ねて入れないこと */
  function totalOut(parts) {
    var p = parts || {};
    var items = {
      bmr:           isNum(p.bmr)           ? p.bmr           : 0,
      dailyActivity: isNum(p.dailyActivity) ? p.dailyActivity : 0,
      walking:       isNum(p.walking)       ? p.walking       : 0,
      strength:      isNum(p.strength)      ? p.strength      : 0,
      cardio:        isNum(p.cardio)        ? p.cardio        : 0,
      tef:           isNum(p.tef)           ? p.tef           : 0
    };
    var total = items.bmr + items.dailyActivity + items.walking
              + items.strength + items.cardio + items.tef;
    return {
      breakdown:          items,
      total:              round(total, 0),
      isEstimate:         true,
      calculationVersion: VERSION
    };
  }

  /* 収支（＋なら余剰、−なら不足） */
  function balance(intakeKcal, outKcal) {
    if (!isNum(intakeKcal) || !isNum(outKcal)) { return null; }
    return round(intakeKcal - outKcal, 0);
  }

  /* ---------- 平均・推移 ---------- */

  /* 既定値。設定で変更できます。 */
  var DEFAULT_WINDOW_DAYS = 7;
  var DEFAULT_MIN_SAMPLES = 5;

  /* 体組成データから「代表体重だけの日別データ列」を作る。
     [{date:'2026-09-21', value:71.8}, ...] の形にして平均計算に渡します。 */
  function primaryWeightSeries(bodyEntries) {
    if (!bodyEntries || !bodyEntries.length) { return []; }
    var out = [];
    bodyEntries.forEach(function (e) {
      if (e && e.isPrimary && isNum(e.weightKg) && e.date) {
        out.push({ date: e.date, value: e.weightKg });
      }
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    return out;
  }

  /* 指定した日で終わる n 日間を集計する。
       endDate     … 期間の最終日（'YYYY-MM-DD'）
       windowDays  … 集計日数（既定7）
       minSamples  … 正式な平均として扱う最低日数（既定5）

     minSamples 日以上あれば average に数値、足りなければ null。
     samples には実際にデータがあった日数が入ります。 */
  function averageForWindow(series, endDate, windowDays, minSamples) {
    var n    = windowDays || DEFAULT_WINDOW_DAYS;
    var need = isNum(minSamples) ? minSamples : DEFAULT_MIN_SAMPLES;
    var end  = endDate || todayStr();
    var start = shiftDate(end, -(n - 1));

    var sum = 0, count = 0, seen = {};
    (series || []).forEach(function (p) {
      if (!p || !p.date || !isNum(p.value)) { return; }
      if (p.date < start || p.date > end) { return; }
      if (seen[p.date]) { return; }   /* 同じ日は1件だけ数える */
      seen[p.date] = true;
      sum += p.value;
      count += 1;
    });

    var isComplete = (count >= need);
    return {
      average:        isComplete ? round(sum / count, 2) : null,
      partialAverage: count > 0 ? round(sum / count, 2) : null,
      samples:        count,
      windowDays:     n,
      minSamples:     need,
      isComplete:     isComplete,
      isFull:         (count >= n),
      startDate:      start,
      endDate:        end
    };
  }

  /* 今日を終わりとする直近 n 日の平均。
     画面側は isComplete で「7日平均 69.4kg（5/7日）」と
     「データ蓄積中（4/7日）」を出し分けます。 */
  function recentAverageInfo(series, windowDays, minSamples, endDate) {
    return averageForWindow(series, endDate || todayStr(), windowDays, minSamples);
  }

  /* 数値だけが欲しい場合。条件を満たさなければ null。 */
  function recentAverage(series, windowDays, minSamples, endDate) {
    return recentAverageInfo(series, windowDays, minSamples, endDate).average;
  }

  /* 各日について、その日を終わりとする n 日平均を付けて返す（グラフ用）。
     条件を満たさない日の average は null。 */
  function movingAverage(series, windowDays, minSamples) {
    var n = windowDays || DEFAULT_WINDOW_DAYS;
    if (!series || !series.length) { return []; }

    var sorted = series.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    return sorted.map(function (p) {
      var info = averageForWindow(sorted, p.date, n, minSamples);
      return {
        date:           p.date,
        value:          p.value,
        average:        info.average,
        partialAverage: info.partialAverage,
        samples:        info.samples,
        windowDays:     info.windowDays,
        minSamples:     info.minSamples,
        isComplete:     info.isComplete
      };
    });
  }

  /* ============================================================
     1日ぶんのまとめ計算
     ------------------------------------------------------------
     保存してある生データと設定から、その日の
     摂取（IN）・消費（OUT）の内訳・収支を計算します。

     【方針】計算結果は保存しません。必要なときに毎回ここで
     計算し直すので、後から式を直しても過去の日付に反映されます。
     ============================================================ */

  /* その日の体重。なければ、それ以前でいちばん新しい代表体重を使う */
  function weightForDate(bodyEntries, date) {
    var best = null;
    (bodyEntries || []).forEach(function (e) {
      if (!e || !e.isPrimary || !isNum(e.weightKg)) { return; }
      if (e.date > date) { return; }
      if (!best || e.date > best.date) { best = e; }
    });
    return best ? best.weightKg : null;
  }

  /* その日の基礎代謝。体組成計の値 → それ以前の最新の値 → 計算式 */
  function bmrForDate(bodyEntries, date, profile) {
    var sameDay = null, prev = null;
    (bodyEntries || []).forEach(function (e) {
      if (!e || !isNum(e.bmrKcal) || e.date > date) { return; }
      if (e.date === date) {
        if (!sameDay || (e.time || '') < (sameDay.time || '')) { sameDay = e; }
      }
      if (!prev || e.date > prev.date) { prev = e; }
    });

    return resolveBmr({
      deviceBmr:     sameDay ? sameDay.bmrKcal : null,
      lastDeviceBmr: prev ? prev.bmrKcal : null,
      weightKg:      profile.weightKg,
      heightCm:      profile.heightCm,
      age:           profile.age,
      sex:           profile.sex
    });
  }

  /* data には body / meals / steps / strength / cardio の配列を渡します */
  function dailySummary(date, settings, data) {
    var d = data || {};
    var s = settings || {};

    var weightKg = weightForDate(d.body, date);
    var age      = ageFromBirthdate(s.birthdate);

    var bmrInfo = bmrForDate(d.body, date, {
      weightKg: weightKg,
      heightCm: s.heightCm,
      age:      age,
      sex:      s.sex || 'male'
    });
    var bmr = bmrInfo.value;

    /* 摂取 */
    var meals = (d.meals || []).filter(function (m) { return m && m.date === date; });
    var intake = sumNutrition(meals);

    /* 歩数 */
    var stepRec = null;
    (d.steps || []).forEach(function (r) { if (r && r.date === date) { stepRec = r; } });
    var steps = stepRec && isNum(stepRec.steps) ? stepRec.steps : null;
    var distanceKm = (steps !== null && isNum(s.strideCm)) ? walkDistanceKm(steps, s.strideCm) : null;
    var walking = (steps !== null && isNum(weightKg) && isNum(s.strideCm))
      ? walkingKcal({ steps: steps, strideCm: s.strideCm, weightKg: weightKg })
      : null;

    /* 筋トレ */
    var strengthList = (d.strength || []).filter(function (e) { return e && e.date === date; });
    var strengthKcalTotal = null;
    var strengthMinutes = 0;
    strengthList.forEach(function (e) {
      if (!isNum(e.durationMin) || !isNum(weightKg)) { return; }
      var mets = isNum(e.mets) ? e.mets : (isNum(s.strengthMets) ? s.strengthMets : 5.0);
      var k = strengthKcal({ durationMin: e.durationMin, weightKg: weightKg, mets: mets });
      if (k !== null) { strengthKcalTotal = (strengthKcalTotal || 0) + k; }
      strengthMinutes += e.durationMin;
    });

    /* 有酸素 */
    var cardioList = (d.cardio || []).filter(function (e) { return e && e.date === date; });
    var cardioKcalTotal = null;
    var cardioMinutes = 0;
    cardioList.forEach(function (e) {
      var r = cardioKcal({
        durationMin:     e.durationMin,
        machineKcal:     e.machineKcal,
        machineKcalType: e.machineKcalType,
        bmr24:           bmr,
        mets:            e.mets,
        weightKg:        weightKg
      });
      if (r && isNum(r.value)) { cardioKcalTotal = (cardioKcalTotal || 0) + r.value; }
      if (isNum(e.durationMin)) { cardioMinutes += e.durationMin; }
    });

    /* 日常活動補正と食事誘発性熱産生 */
    var beta = isNum(s.beta) ? s.beta : 0.10;
    var dailyAct = isNum(bmr) ? dailyActivityKcal(bmr, beta) : null;
    var tef = (intake.count > 0) ? tefKcal(intake.kcal, isNum(s.tefRate) ? s.tefRate : 0.10) : null;

    var out = totalOut({
      bmr:           bmr,
      dailyActivity: dailyAct,
      walking:       walking,
      strength:      strengthKcalTotal,
      cardio:        cardioKcalTotal,
      tef:           tef
    });

    /* 基礎代謝が分からない日は消費を出さない（過小評価を防ぐため） */
    var hasOut = isNum(bmr);

    return {
      date:       date,
      weightKg:   weightKg,
      bmr:        bmrInfo,
      intake:     intake,
      steps:      steps,
      distanceKm: distanceKm,
      strengthMinutes: strengthMinutes || null,
      cardioMinutes:   cardioMinutes || null,
      strengthCount:   strengthList.length,
      cardioCount:     cardioList.length,
      out:        hasOut ? out : null,
      balance:    (hasOut && intake.count > 0) ? balance(intake.kcal, out.total) : null,
      isEstimate: true,
      calculationVersion: VERSION
    };
  }

  /* ---------- 前週比較 ---------- */

  /* 直近 n 日と、その前の n 日を比べる。
     【重要】両方の期間が minSamples 日以上ないと比較しません。
     片方でも足りない場合は comparable:false を返し、
     画面側は増減の判定を出しません。 */
  function weekOverWeek(series, endDate, windowDays, minSamples) {
    var n   = windowDays || DEFAULT_WINDOW_DAYS;
    var end = endDate || todayStr();
    var prevEnd = shiftDate(end, -n);

    var cur  = averageForWindow(series, end, n, minSamples);
    var prev = averageForWindow(series, prevEnd, n, minSamples);

    var comparable = cur.isComplete && prev.isComplete;
    return {
      comparable:      comparable,
      current:         cur,
      previous:        prev,
      deltaKg:         comparable ? round(cur.average - prev.average, 2) : null,
      reason:          comparable ? null
                        : '比較するには両方の期間に' + cur.minSamples + '日以上の測定が必要です。',
      calculationVersion: VERSION
    };
  }

  /* ---------- 推定と実測の照合（Phase 3 で画面化する下地） ---------- */

  /* 期間の推定収支合計から理論上の体重変化を出し、
     実測（7日平均体重の変化）と比べてズレを返す。
     自動で設定を書き換えることはしない。補正候補を返すだけ。 */
  function reconcile(opts) {
    if (!opts || !isNum(opts.sumBalanceKcal) || !isNum(opts.actualDeltaKg) || !isNum(opts.days)) {
      return null;
    }
    var theoreticalDeltaKg = opts.sumBalanceKcal / CONST.KCAL_PER_KG_FAT;
    var gapKg   = opts.actualDeltaKg - theoreticalDeltaKg;
    var gapKcal = gapKg * CONST.KCAL_PER_KG_FAT;

    var suggestedBeta = null;
    if (isNum(opts.currentBeta) && isNum(opts.sumBmrKcal) && opts.sumBmrKcal > 0) {
      /* 実測のほうが減っていない＝OUTを多く見積もりすぎ → β を下げる方向 */
      suggestedBeta = round(opts.currentBeta - (gapKcal / opts.sumBmrKcal), 3);
      if (suggestedBeta < 0)   { suggestedBeta = 0; }
      if (suggestedBeta > 0.5) { suggestedBeta = 0.5; }
    }

    return {
      days:                opts.days,
      theoreticalDeltaKg:  round(theoreticalDeltaKg, 2),
      actualDeltaKg:       round(opts.actualDeltaKg, 2),
      gapKg:               round(gapKg, 2),
      gapKcalPerDay:       round(gapKcal / opts.days, 0),
      suggestedBeta:       suggestedBeta,   // あくまで候補。承認するまで適用しない
      applied:             false,
      reliable:            opts.days >= 14, // 14日未満は水分変動の影響が大きい
      calculationVersion:  VERSION
    };
  }

  /* ---------- 公開する窓口 ---------- */
  return {
    VERSION:            VERSION,
    CONST:              CONST,
    DEFAULT_WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
    DEFAULT_MIN_SAMPLES: DEFAULT_MIN_SAMPLES,
    round:              round,
    isInteger:          isInteger,
    isMultipleOf:       isMultipleOf,
    snapToStep:         snapToStep,
    todayStr:           todayStr,
    nowTimeStr:         nowTimeStr,
    shiftDate:          shiftDate,
    formatDateShort:    formatDateShort,
    formatDateJP:       formatDateJP,
    ageFromBirthdate:   ageFromBirthdate,
    bmrMifflin:         bmrMifflin,
    resolveBmr:         resolveBmr,
    dailyActivityKcal:  dailyActivityKcal,
    walkDistanceKm:     walkDistanceKm,
    walkingKcal:        walkingKcal,
    strengthKcal:       strengthKcal,
    cardioKcal:         cardioKcal,
    tefKcal:            tefKcal,
    sumNutrition:       sumNutrition,
    totalOut:           totalOut,
    balance:            balance,
    weightForDate:      weightForDate,
    bmrForDate:         bmrForDate,
    dailySummary:       dailySummary,
    primaryWeightSeries: primaryWeightSeries,
    averageForWindow:   averageForWindow,
    movingAverage:      movingAverage,
    recentAverageInfo:  recentAverageInfo,
    recentAverage:      recentAverage,
    weekOverWeek:       weekOverWeek,
    reconcile:          reconcile
  };
})();
