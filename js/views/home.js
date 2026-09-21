/* ============================================================
   views/home.js  —  ホーム画面
   ------------------------------------------------------------
   その日の状態をまとめて表示します。
   消費カロリーは calc.js の dailySummary() で毎回計算し直すため、
   後から式や設定を変えても過去の日付に正しく反映されます。
   ============================================================ */

var App = App || {};

App.Home = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  function $(id) { return document.getElementById(id); }

  function setText(id, text) {
    var el = $(id);
    if (el) { el.textContent = text; }
  }

  function kcalText(v) {
    return (typeof v === 'number' && isFinite(v)) ? (v + ' kcal') : '--';
  }

  /* ---------- バックアップ警告バナー ---------- */

  function renderBackupBanner() {
    var banner = $('backup-banner');
    var text   = $('backup-banner-text');
    if (!banner || !text) { return; }

    var meta = S.getMeta();
    var days = (App.Settings && App.Settings.daysSince)
      ? App.Settings.daysSince(meta.lastBackupAt)
      : null;

    if (meta.lastBackupAt && days !== null && days >= 14) {
      text.textContent = 'バックアップから' + days + '日が経過しています。設定画面から書き出してください。';
      banner.hidden = false;
      return;
    }
    banner.hidden = true;
  }

  /* ---------- 体重まわり ---------- */

  function renderWeight() {
    var s       = S.getSettings();
    var latest  = S.latestBodyEntry();
    var entries = S.listBody();

    if (latest && typeof latest.weightKg === 'number') {
      setText('home-weight', latest.weightKg.toFixed(1));
      setText('home-weight-at', C.formatDateShort(latest.date) + ' ' + (latest.time || ''));
      if (typeof s.targetWeightKg === 'number') {
        var diff = C.round(latest.weightKg - s.targetWeightKg, 1);
        setText('home-weight-diff', (diff > 0 ? '+' : '') + diff.toFixed(1) + 'kg');
      } else {
        setText('home-weight-diff', '--');
      }
    } else {
      setText('home-weight', '--');
      setText('home-weight-at', '');
      setText('home-weight-diff', '--');
    }

    var series = C.primaryWeightSeries(entries);
    var info = C.recentAverageInfo(
      series,
      s.avgWindowDays || C.DEFAULT_WINDOW_DAYS,
      (typeof s.avgMinSamples === 'number') ? s.avgMinSamples : C.DEFAULT_MIN_SAMPLES
    );
    var countText = '（' + info.samples + '/' + info.windowDays + '日）';

    if (info.isComplete) {
      setText('home-avg7-label', info.windowDays + '日平均' + countText);
      setText('home-weight-avg7', info.average.toFixed(1) + 'kg');
    } else if (info.samples > 0) {
      setText('home-avg7-label', info.windowDays + '日平均' + countText);
      setText('home-weight-avg7', 'データ蓄積中');
    } else {
      setText('home-avg7-label', info.windowDays + '日平均');
      setText('home-weight-avg7', '--');
    }
  }

  /* ---------- 体脂肪率 ---------- */

  function renderBodyFat() {
    var e = S.latestBodyEntryWith('bodyFatPct');
    if (e) {
      setText('home-bodyfat', e.bodyFatPct.toFixed(1));
      setText('home-bodyfat-at', C.formatDateShort(e.date) + ' ' + (e.time || ''));
    } else {
      setText('home-bodyfat', '--');
      setText('home-bodyfat-at', '');
    }
  }

  /* ---------- 今日のIN / OUT / 収支 ---------- */

  function renderToday() {
    var today = C.todayStr();
    var sum = C.dailySummary(today, S.getSettings(), {
      body:     S.listBody(),
      meals:    S.listMeals(),
      steps:    S.listSteps(),
      strength: S.listStrength ? S.listStrength() : [],
      cardio:   S.listCardio ? S.listCardio() : []
    });

    /* 摂取 */
    if (sum.intake.count > 0) {
      setText('home-in', sum.intake.kcal + ' kcal');
      setText('home-protein', sum.intake.protein + ' g');
    } else {
      setText('home-in', '--');
      setText('home-protein', '--');
    }

    /* 消費と収支 */
    if (sum.out) {
      setText('home-out', sum.out.total + ' kcal');
      var bd = sum.out.breakdown;
      setText('bd-bmr',      kcalText(bd.bmr));
      setText('bd-daily',    kcalText(bd.dailyActivity));
      setText('bd-walk',     bd.walking  ? kcalText(bd.walking)  : '0 kcal');
      setText('bd-strength', bd.strength ? kcalText(bd.strength) : '0 kcal');
      setText('bd-cardio',   bd.cardio   ? kcalText(bd.cardio)   : '0 kcal');
      setText('bd-tef',      bd.tef      ? kcalText(bd.tef)      : '0 kcal');

      var src = sum.bmr.source;
      var srcText = (src === 'device')      ? '基礎代謝は体組成計の値を使用しています。'
                  : (src === 'device-last') ? '基礎代謝は直近の体組成計の値を使用しています。'
                  : '基礎代謝は計算式（Mifflin-St Jeor）による推定です。';
      setText('bd-note', srcText + ' すべて推定値です。運動ぶんを「追加で食べてよい分」とは考えないでください。');
    } else {
      setText('home-out', '--');
      ['bd-bmr','bd-daily','bd-walk','bd-strength','bd-cardio','bd-tef'].forEach(function (id) { setText(id, '--'); });
      setText('bd-note', '体重を記録すると消費カロリーの推定を表示します。');
    }

    setText('home-balance', (sum.balance === null || sum.balance === undefined)
      ? '--'
      : ((sum.balance > 0 ? '+' : '') + sum.balance + ' kcal'));

    /* 活動 */
    setText('home-steps', (sum.steps === null)
      ? '--'
      : (sum.steps.toLocaleString('ja-JP') + ' 歩' + (sum.distanceKm !== null ? '（' + sum.distanceKm.toFixed(2) + 'km）' : '')));

    setText('home-strength', sum.strengthCount
      ? (sum.strengthCount + '種目' + (sum.strengthMinutes ? '　' + sum.strengthMinutes + '分' : ''))
      : '--');

    setText('home-cardio', sum.cardioCount
      ? (sum.cardioCount + '件' + (sum.cardioMinutes ? '　' + sum.cardioMinutes + '分' : ''))
      : '--');
  }

  /* ---------- 再描画 ---------- */

  function refresh() {
    renderBackupBanner();
    renderWeight();
    renderBodyFat();
    renderToday();
  }

  function init() {
    var binds = [
      ['btn-quick-body',  function () { App.Body.open(); }],
      ['btn-quick-meal',  function () { App.Meal.open(); }],
      ['btn-quick-steps', function () { App.Steps.open(); }],
      ['btn-quick-workout', function () { if (App.showScreen) { App.showScreen('record'); } }]
    ];
    binds.forEach(function (b) {
      var el = $(b[0]);
      if (el) { el.addEventListener('click', b[1]); }
    });

    var detail = $('btn-out-detail');
    if (detail) {
      detail.addEventListener('click', function () {
        var box = $('home-out-breakdown');
        if (!box) { return; }
        box.hidden = !box.hidden;
        detail.textContent = box.hidden ? '消費の内訳を見る' : '内訳を閉じる';
      });
    }

    refresh();
  }

  return {
    init:    init,
    refresh: refresh
  };
})();
