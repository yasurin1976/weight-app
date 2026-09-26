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
            （摂取・消費の内訳・収支を、保存された生データから毎回計算し直す）
     2.0.0：Phase 2。「許容量」と「乖離」の層を追加
            ・基本摂取目安（維持カロリー − 減量強度による赤字）
            ・運動加算（マシン表示 × 運動係数、マシン表示がなければMETs推定）
            ・今日の許容量＝基本摂取目安＋運動加算
            ・乖離＝許容量−摂取、7日累積乖離
            ・実測体重からの目安補正の提案（適用はユーザー承認）
            ※Phase 1 の計算関数は変更していません。上に層を足しただけです。 */
  var VERSION = 'calc-2.3.0';   /* 2.11.0：乖離の符号を反転（食べすぎ＝＋） */

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

  /* 2つの日付の間の日数。from より to が後なら正。 */
  function daysBetween(from, to) {
    var a = new Date(from + 'T00:00:00');
    var b = new Date(to + 'T00:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) { return null; }
    return Math.round((b - a) / 86400000);
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
  /* ============================================================
     筋トレの所要時間の推定
     ------------------------------------------------------------
     種目ごとに分数を手入力するのは現実的でないため、
     セット数と回数からおおよその時間を出します。

       1回あたり 3秒（挙上と戻し）
       1セットごとに 60秒の休憩

     例：10回×3セット → (30秒×3) + (60秒×3) = 270秒 ＝ 約5分

     これは消費カロリーの推定にしか使いません。
     筋トレの消費は1日の収支の中では小さいため、
     この粗さで実用上の支障はありません。
     ============================================================ */

  var SEC_PER_REP  = 3;
  var REST_SEC     = 60;

  function strengthMinutesFromReps(reps) {
    if (!(reps instanceof Array) || !reps.length) { return null; }
    var totalReps = 0;
    var i;
    for (i = 0; i < reps.length; i++) {
      if (!isNum(reps[i]) || reps[i] < 0) { return null; }
      totalReps += reps[i];
    }
    var sec = totalReps * SEC_PER_REP + reps.length * REST_SEC;
    return Math.max(1, Math.round(sec / 60));
  }

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

  /* ============================================================
     Phase 2：許容量と乖離の層
     ============================================================ */

  /* 減量強度ごとの1日あたり目標赤字（kcal） */
  var INTENSITY = {
    light:  280,   /* ゆるめ　週およそ0.25kg */
    normal: 440,   /* 普通　　週およそ0.40kg */
    hard:   600    /* きつめ　週およそ0.55kg */
  };

  function intensityDeficit(key) {
    return INTENSITY[key] !== undefined ? INTENSITY[key] : INTENSITY.normal;
  }

  /* ---------- 運動加算 ---------- */

  /* 【注意】運動係数（既定1.00。2.9.0までは0.70）について

     この1つの数字は、本来は別々の2つの補正をまとめたものです。

       (a) 機器誤差の補正
           マシンは体重と年齢しか見ていないため、表示は実際より多く出ます。
       (b) 安静時代謝の差し引き
           表示には「じっとしていても消費したはずの分」が含まれています。
           基礎代謝を24時間ぶん別に数えているので、本来は差し引く必要があります。

     (a) は機種ごとの癖、(b) は運動時間と基礎代謝から決まる量で、
     理論上はまったく別の補正です。ここでは運用を単純にするため
     1つの係数にまとめていますが、同じ意味ではありません。

     実測との照合でズレが続いたとき、原因が (a) なのか (b) なのかは
     この形では切り分けられません。切り分けが必要になったら、
     係数を2つに分けてください。設定から変更できるようにしてあるのは
     そのためです。 */
  var DEFAULT_CARDIO_FACTOR = 1.00;

  /* 有酸素1件の加算量。
     マシン表示があれば「表示 × 係数」、なければMETsから推定します。 */
  function cardioAddon(entry, opts) {
    if (!entry) { return 0; }
    var o = opts || {};
    var factor = isNum(o.cardioFactor) ? o.cardioFactor : DEFAULT_CARDIO_FACTOR;

    if (isNum(entry.machineKcal)) {
      return round(Math.max(entry.machineKcal * factor, 0), 0);
    }
    if (isNum(entry.durationMin) && isNum(entry.mets) && isNum(o.weightKg)) {
      /* METs推定はもともと安静分を除いた値なので、係数はかけません */
      var k = strengthKcal({ durationMin: entry.durationMin, weightKg: o.weightKg, mets: entry.mets });
      return isNum(k) ? k : 0;
    }
    return 0;
  }

  /* その日の運動加算の合計と内訳 */
  function exerciseAddonForDate(date, settings, data) {
    var s = settings || {};
    var d = data || {};
    var weightKg = weightForDate(d.body, date);

    var cardioSum = 0, strengthSum = 0;

    (d.cardio || []).forEach(function (e) {
      if (!e || e.date !== date) { return; }
      cardioSum += cardioAddon(e, {
        cardioFactor: isNum(s.cardioFactor) ? s.cardioFactor : DEFAULT_CARDIO_FACTOR,
        weightKg: weightKg
      });
    });

    (d.strength || []).forEach(function (e) {
      if (!e || e.date !== date) { return; }
      if (!isNum(e.durationMin) || !isNum(weightKg)) { return; }
      var mets = isNum(e.mets) ? e.mets : (isNum(s.strengthMets) ? s.strengthMets : 5.0);
      var k = strengthKcal({ durationMin: e.durationMin, weightKg: weightKg, mets: mets });
      if (isNum(k)) { strengthSum += k; }
    });

    return {
      cardio:   round(cardioSum, 0),
      strength: round(strengthSum, 0),
      total:    round(cardioSum + strengthSum, 0)
    };
  }

  /* ---------- 基本摂取目安 ---------- */

  /* 運動を除いた維持カロリーを推定する。
     ・基礎代謝 ＋ 日常活動（基礎代謝×β）＋ 歩行（直近の平均歩数から）
     ・そのうえで食事誘発性熱産生を織り込む
       （摂取Iのうち約10%が消化に使われるので、維持量は base÷(1−TEF率)） */
  function maintenanceIntake(settings, data, refDate) {
    var s = settings || {};
    var d = data || {};
    var date = refDate || todayStr();

    var weightKg = weightForDate(d.body, date);
    var age = ageFromBirthdate(s.birthdate);
    var bmrInfo = bmrForDate(d.body, date, {
      weightKg: weightKg, heightCm: s.heightCm, age: age, sex: s.sex || 'male'
    });
    var bmr = bmrInfo.value;
    if (!isNum(bmr)) { return { value: null, bmr: null, reason: '体重の記録が必要です' }; }

    var beta = isNum(s.beta) ? s.beta : 0.10;
    var daily = bmr * beta;

    /* 歩行は直近14日の平均歩数から。記録がなければ0として扱う */
    var from = shiftDate(date, -13);
    var sum = 0, n = 0;
    (d.steps || []).forEach(function (r) {
      if (!r || !isNum(r.steps)) { return; }
      if (r.date < from || r.date > date) { return; }
      sum += r.steps; n++;
    });
    var avgSteps = n > 0 ? (sum / n) : 0;
    var walking = (avgSteps > 0 && isNum(weightKg) && isNum(s.strideCm))
      ? walkingKcal({ steps: avgSteps, strideCm: s.strideCm, weightKg: weightKg })
      : 0;

    var base = bmr + daily + (isNum(walking) ? walking : 0);
    var tef = isNum(s.tefRate) ? s.tefRate : 0.10;
    var value = base / (1 - tef);

    return {
      value:      round(value, 0),
      bmr:        bmr,
      bmrSource:  bmrInfo.source,
      dailyActivity: round(daily, 0),
      walking:    round(walking || 0, 0),
      avgSteps:   Math.round(avgSteps),
      tefRate:    tef
    };
  }

  /* 基本摂取目安。設定に手動値があればそれを優先します。 */
  /* ============================================================
     目標日からの逆算
     ------------------------------------------------------------
     「いつまでに何kg」から、1日いくら赤字にすべきかを出します。
     強度の3段階（ゆるめ／普通／きつめ）は、目標日が無いときの代替です。

     【安全の上限】
     期限が短すぎると、計算上は無茶な赤字が必要になります。
     そのまま従うと筋肉が落ち、結局リバウンドします。
     次の3つで頭打ちにし、止めたことを必ず画面で知らせます。

       1. 週1.0kg まで
       2. 1日1000kcal の赤字まで
       3. 摂取が基礎代謝を下回らないところまで

     上限に当たった場合は、その上限で間に合う最短の日付も出します。
     ============================================================ */

  var SAFETY = {
    maxKgPerWeek:      1.0,
    maxDeficitPerDay:  1000
  };

  function deadlinePlan(settings, data, refDate) {
    var s = settings || {};
    var today = refDate || todayStr();

    var out = {
      active: false, reason: null,
      targetDate: s.targetDate || null,
      daysLeft: null, kgToLose: null,
      requiredPerDay: null, requiredKgPerWeek: null,
      deficitPerDay: null, capped: false, capReason: null,
      status: 'none', feasibleDate: null, cap: null
    };

    if (!s.targetDate) { out.reason = 'no-date'; return out; }

    var current = weightForDate((data || {}).body, today);
    if (!isNum(current)) { out.reason = 'no-weight'; return out; }
    if (!isNum(s.targetWeightKg)) { out.reason = 'no-target'; return out; }

    out.daysLeft = daysBetween(today, s.targetDate);
    out.kgToLose = round(current - s.targetWeightKg, 2);

    if (out.kgToLose <= 0) { out.status = 'done'; return out; }
    if (out.daysLeft <= 0) { out.status = 'past'; return out; }

    out.requiredPerDay    = Math.round(out.kgToLose * CONST.KCAL_PER_KG_FAT / out.daysLeft);
    out.requiredKgPerWeek = round(out.kgToLose / out.daysLeft * 7, 2);

    /* ---- 上限は2種類。意味が違うので分けて扱う ----
       (1) ペースの上限 … 週1.0kg／1日1000kcal。これを超える日付は物理的に無理。
       (2) 基礎代謝の下限 … 目安が基礎代謝を下回らない範囲。
           運動ぶんは別に足されるので、上限には直近14日の平均運動量も足して見る。
           動いていなければ当然ここが厳しくなる。 */

    var rateCap = Math.min(
      SAFETY.maxDeficitPerDay,
      Math.round(SAFETY.maxKgPerWeek * CONST.KCAL_PER_KG_FAT / 7)
    );

    var m = maintenanceIntake(s, data, today);
    var avgAddon = averageExerciseAddon(s, data, today, 14);
    var bmrCap = null;
    if (isNum(m.value) && isNum(m.bmr)) {
      bmrCap = Math.max(0, Math.round(m.value + avgAddon - m.bmr));
    }

    out.rateCap  = rateCap;
    out.bmrCap   = bmrCap;
    out.avgAddon = avgAddon;
    out.cap      = (bmrCap === null) ? rateCap : Math.min(rateCap, bmrCap);

    if (out.requiredPerDay > rateCap) {
      /* 日付そのものが無理 */
      out.deficitPerDay = out.cap;
      out.capped        = true;
      out.capReason     = 'rate';
      out.status        = 'impossible';
      out.feasibleDate  = shiftDate(today, Math.ceil(out.kgToLose * CONST.KCAL_PER_KG_FAT / out.cap));
    } else if (bmrCap !== null && out.requiredPerDay > bmrCap) {
      /* ペースとしては無理ではないが、このままだと目安が基礎代謝を下回る */
      out.deficitPerDay = bmrCap;
      out.capped        = true;
      out.capReason     = 'bmr';
      out.status        = 'bmr-limited';
      out.feasibleDate  = shiftDate(today, Math.ceil(out.kgToLose * CONST.KCAL_PER_KG_FAT / Math.max(1, bmrCap)));
    } else {
      out.deficitPerDay = out.requiredPerDay;
      out.status = (out.requiredPerDay > out.cap * 0.8) ? 'tight' : 'ok';
    }

    out.active = true;
    return out;
  }

  /* 直近 days 日の、1日あたり平均の運動加算 */
  function averageExerciseAddon(settings, data, date, days) {
    var n = days || 14;
    var sum = 0;
    var i, d;
    for (i = 0; i < n; i++) {
      d = shiftDate(date, -i);
      var a = exerciseAddonForDate(d, settings, data);
      if (a && isNum(a.total)) { sum += a.total; }
    }
    return Math.round(sum / n);
  }

  /* 今日めざす赤字。目標日があればそちら、無ければ強度の3段階。 */
  function effectiveDeficit(settings, data, refDate) {
    var p = deadlinePlan(settings, data, refDate);
    if (p.active && isNum(p.deficitPerDay)) { return p.deficitPerDay; }
    return intensityDeficit((settings || {}).intensity);
  }

  function baseTargetKcal(settings, data, refDate) {
    var s = settings || {};

    if (isNum(s.baseTargetKcal)) {
      return { value: s.baseTargetKcal, source: 'manual', maintenance: null,
               deficit: intensityDeficit(s.intensity) };
    }

    var m = maintenanceIntake(s, data, refDate);
    if (!isNum(m.value)) {
      return { value: null, source: 'none', maintenance: m, deficit: intensityDeficit(s.intensity) };
    }
    var deficit = effectiveDeficit(s, data, refDate);
    return {
      value:       round(m.value - deficit, 0),
      source:      'auto',
      maintenance: m,
      deficit:     deficit
    };
  }

  /* ---------- 1日の許容量と乖離 ---------- */

  /* 許容量 ＝ 基本摂取目安 ＋ 運動加算
     乖離   ＝ 許容量 − 摂取     （プラス＝余っている／マイナス＝超えている） */
  function allowanceForDate(date, settings, data) {
    var base = baseTargetKcal(settings, data, date);
    var addon = exerciseAddonForDate(date, settings, data);
    var meals = (data && data.meals ? data.meals : []).filter(function (m) { return m && m.date === date; });
    var intake = sumNutrition(meals);

    var allowance = isNum(base.value) ? round(base.value + addon.total, 0) : null;
    var hasIntake = intake.count > 0;

    return {
      date:       date,
      baseTarget: base.value,
      baseSource: base.source,
      deficit:    base.deficit,
      addon:      addon,
      allowance:  allowance,
      intake:     intake,
      hasIntake:  hasIntake,
      remaining:  (isNum(allowance) ? round(allowance - intake.kcal, 0) : null),
      /* 乖離 = 摂取 − 許容。食べすぎが＋、抑えた分が−（2.11.0 で符号を反転） */
      deviation:  (isNum(allowance) && hasIntake) ? round(intake.kcal - allowance, 0) : null,
      isEstimate: true,
      calculationVersion: VERSION
    };
  }

  /* ---------- 7日累積乖離 ---------- */

  /* 食事の記録がある日だけを数えます。
     記録し忘れた日を「食べなかった日」として抑えた分に数えないためです。
     合計は 食べすぎ＝＋／抑えた分＝− です。 */
  function cumulativeDeviation(endDate, settings, data, days) {
    var n = days || 7;
    var end = endDate || todayStr();
    var start = shiftDate(end, -(n - 1));

    var byDay = [];
    var sum = 0, withData = 0;

    for (var i = 0; i < n; i++) {
      var d = shiftDate(start, i);
      var a = allowanceForDate(d, settings, data);
      var v = a.deviation;
      byDay.push({
        date: d,
        deviation: v,
        allowance: a.allowance,
        intakeKcal: a.hasIntake ? a.intake.kcal : null,
        addon: a.addon.total
      });
      if (isNum(v)) { sum += v; withData++; }
    }

    var deficitPerDay = effectiveDeficit(settings, data, end);

    return {
      startDate:   start,
      endDate:     end,
      days:        n,
      withData:    withData,
      byDay:       byDay,
      total:       withData > 0 ? round(sum, 0) : null,
      targetTotal: round(deficitPerDay * n, 0),
      /* 達成率は補助表示。実際の赤字 ÷ 目標赤字（sum は食べすぎが＋なので引く） */
      achievement: (withData > 0 && deficitPerDay > 0)
        ? round(((deficitPerDay * withData) - sum) / (deficitPerDay * withData) * 100, 0)
        : null,
      calculationVersion: VERSION
    };
  }

  /* 乖離を運動時間に言い換える（トレッドミル換算・分） */
  function toExerciseMinutes(kcal, settings, data, refDate) {
    if (!isNum(kcal)) { return null; }
    var s = settings || {};
    var weightKg = weightForDate((data || {}).body, refDate || todayStr());
    if (!isNum(weightKg)) { return null; }
    /* トレッドミル早歩き相当 METs6.0 の正味消費から逆算 */
    var perMin = (6.0 - 1) * weightKg * (1 / 60) * 1.05;
    if (perMin <= 0) { return null; }
    return Math.round(Math.abs(kcal) / perMin);
  }

  /* 乖離を体脂肪の重さに言い換える（kg） */
  function toFatKg(kcal) {
    if (!isNum(kcal)) { return null; }
    return round(kcal / CONST.KCAL_PER_KG_FAT, 2);
  }

  /* ---------- 基本摂取目安の補正提案 ---------- */

  /* 期間内の乖離合計から理論上の体重変化を出し、7日平均体重の実変化と比べます。
     【重要】提案するだけで、設定は変更しません。 */
  function calibrationProposal(settings, data, opts) {
    var o = opts || {};
    var end = o.endDate || todayStr();
    var days = o.days || 14;
    var minSamples = isNum(o.minSamples) ? o.minSamples
                     : (isNum((settings || {}).avgMinSamples) ? settings.avgMinSamples : DEFAULT_MIN_SAMPLES);
    var maxStep = isNum(o.maxStep) ? o.maxStep : 100;   /* 1回の変更幅の上限 */

    var series = primaryWeightSeries((data || {}).body);
    var curr = averageForWindow(series, end, 7, minSamples);
    var prev = averageForWindow(series, shiftDate(end, -(days - 1)), 7, minSamples);

    if (!curr.isComplete || !prev.isComplete) {
      return {
        comparable: false,
        reason: '比較するには、いまと' + days + '日前の両方に' + minSamples + '日以上の測定が必要です。',
        days: days
      };
    }

    var cum = cumulativeDeviation(end, settings, data, days);
    if (!isNum(cum.total) || cum.withData < Math.ceil(days * 0.6)) {
      return {
        comparable: false,
        reason: '食事の記録が足りません（' + days + '日中' + cum.withData + '日）。',
        days: days
      };
    }

    /* 目標どおりなら、この期間で落ちるはずだった量 */
    var deficitPerDay = effectiveDeficit(settings, data, end);
    var plannedKcal = deficitPerDay * cum.withData;
    var actualDeficitKcal = plannedKcal - cum.total;       /* 抑えた分（−）は上積み、食べすぎ（＋）は目減り */
    var theoreticalDeltaKg = -actualDeficitKcal / CONST.KCAL_PER_KG_FAT;
    var actualDeltaKg = round(curr.average - prev.average, 2);

    var gapKg = round(actualDeltaKg - theoreticalDeltaKg, 2);
    var gapPerDay = round((gapKg * CONST.KCAL_PER_KG_FAT) / cum.withData, 0);

    var base = baseTargetKcal(settings, data, end);
    var suggested = null;
    if (isNum(base.value)) {
      var step = gapPerDay;
      if (step > maxStep)  { step = maxStep; }
      if (step < -maxStep) { step = -maxStep; }
      suggested = round(base.value - step, 0);
    }

    /* 誤差の範囲なら提案しない（1日50kcal未満のズレは測定誤差に埋もれる） */
    var meaningful = Math.abs(gapPerDay) >= 50;

    return {
      comparable:         true,
      days:               days,
      daysWithMeals:      cum.withData,
      theoreticalDeltaKg: round(theoreticalDeltaKg, 2),
      actualDeltaKg:      actualDeltaKg,
      gapKg:              gapKg,
      gapPerDay:          gapPerDay,
      currentBase:        base.value,
      suggestedBase:      meaningful ? suggested : null,
      meaningful:         meaningful,
      applied:            false,
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
    strengthMinutesFromReps: strengthMinutesFromReps,
    strengthKcal:       strengthKcal,
    cardioKcal:         cardioKcal,
    tefKcal:            tefKcal,
    sumNutrition:       sumNutrition,
    totalOut:           totalOut,
    balance:            balance,
    weightForDate:      weightForDate,
    bmrForDate:         bmrForDate,
    dailySummary:       dailySummary,
    SAFETY:                 SAFETY,
    daysBetween:            daysBetween,
    averageExerciseAddon:   averageExerciseAddon,
    deadlinePlan:           deadlinePlan,
    effectiveDeficit:       effectiveDeficit,
    INTENSITY:              INTENSITY,
    DEFAULT_CARDIO_FACTOR:  DEFAULT_CARDIO_FACTOR,
    intensityDeficit:       intensityDeficit,
    cardioAddon:            cardioAddon,
    exerciseAddonForDate:   exerciseAddonForDate,
    maintenanceIntake:      maintenanceIntake,
    baseTargetKcal:         baseTargetKcal,
    allowanceForDate:       allowanceForDate,
    cumulativeDeviation:    cumulativeDeviation,
    toExerciseMinutes:      toExerciseMinutes,
    toFatKg:                toFatKg,
    calibrationProposal:    calibrationProposal,
    primaryWeightSeries: primaryWeightSeries,
    averageForWindow:   averageForWindow,
    movingAverage:      movingAverage,
    recentAverageInfo:  recentAverageInfo,
    recentAverage:      recentAverage,
    weekOverWeek:       weekOverWeek,
    reconcile:          reconcile
  };
})();
