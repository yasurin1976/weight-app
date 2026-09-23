/* ============================================================
   views/home.js  —  ホーム画面（Phase 2）
   ------------------------------------------------------------
   起動した瞬間に、今日どうすべきかが分かることが目的です。
   スクロールせずに次の3つが見えます。

     1. 今日あと食べられる量（運動した分は加算済み）
     2. 直近7日の累積乖離（主指標）
     3. 体重と体脂肪率（当日値と7日平均）

   数値はすべて calc.js でそのつど計算し直しています。
   ============================================================ */

var App = App || {};

App.Home = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;
  var LB = App.Labels;

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el) { el.textContent = t; } }

  function bundle() {
    return {
      body:     S.listBody(),
      meals:    S.listMeals(),
      steps:    S.listSteps(),
      strength: S.listStrength(),
      cardio:   S.listCardio()
    };
  }

  /* ---------- 上部のお知らせ ---------- */

  function renderBanners(allowance) {
    var banner = $('backup-banner');
    var text   = $('backup-banner-text');
    if (banner && text) {
      var meta = S.getMeta();
      var days = (App.Settings && App.Settings.daysSince)
        ? App.Settings.daysSince(meta.lastBackupAt) : null;
      if (meta.lastBackupAt && days !== null && days >= 14) {
        text.textContent = 'バックアップから' + days + '日が経過しています。設定画面から書き出してください。';
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }

    /* 体重が未記録だと許容量が出せないので、その案内を出す */
    var sb = $('setup-banner');
    var st = $('setup-banner-text');
    if (sb && st) {
      if (allowance && allowance.allowance === null) {
        st.textContent = '体重を1回記録すると、今日食べられる量の計算が始まります。';
        sb.hidden = false;
      } else {
        sb.hidden = true;
      }
    }
  }

  /* ---------- 今日あと食べられる量 ---------- */

  function renderRemaining(a) {
    setText('home-remaining-label', LB.L.remaining);

    if (a.allowance === null) {
      setText('home-remaining', '--');
      setText('home-allowance-line', '体重の記録が必要です');
      if ($('home-meter-fill')) { $('home-meter-fill').style.width = '0%'; }
      return;
    }

    setText('home-remaining', a.remaining.toLocaleString('ja-JP'));

    var pct = Math.max(0, Math.min(100, Math.round(a.intake.kcal / a.allowance * 100)));
    var fill = $('home-meter-fill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.classList.toggle('over', a.remaining < 0);
    }

    var line = LB.L.intake + ' ' + a.intake.kcal.toLocaleString('ja-JP')
             + ' ／ ' + LB.L.allowance + ' ' + a.allowance.toLocaleString('ja-JP');
    setText('home-allowance-line', line);

    /* 運動で増えた分を別行で示す */
    var el = $('home-allowance-line');
    if (el && a.addon.total > 0) {
      var tag = document.createElement('span');
      tag.className = 'addon';
      tag.textContent = '＋' + a.addon.total + ' ' + LB.L.exerciseAddon;
      el.appendChild(document.createTextNode('　'));
      el.appendChild(tag);
    }
  }

  /* ---------- 直近7日の累積乖離 ---------- */

  function renderDeviation(settings, data, today) {
    setText('home-dev-label', LB.L.deviationTitle);

    var cum = C.cumulativeDeviation(today, settings, data, 7);

    if (cum.total === null) {
      setText('home-dev', '--');
      setText('home-dev-unit', '');
      setText('home-dev-convert', '食事を記録すると計算できます');
      setText('home-dev-achieve', '');
      setFill(0, 0);
      return;
    }

    setText('home-dev', LB.signed(cum.total));
    setText('home-dev-unit', ' ' + LB.L.deviationUnit + ' ' + LB.forValue(cum.total));

    /* 0中心バー。目盛りは目標の累積赤字ぶんを上限にする */
    var scale = Math.max(cum.targetTotal, Math.abs(cum.total), 1);
    setFill(cum.total, scale);
    setText('home-zero-min', LB.L.deficit + ' −' + scale.toLocaleString('ja-JP'));
    setText('home-zero-max', LB.L.surplus + ' ＋' + scale.toLocaleString('ja-JP'));

    var min = C.toExerciseMinutes(cum.total, settings, data, today);
    var fat = C.toFatKg(cum.total);
    var parts = [];
    if (min !== null) { parts.push('歩行換算 約' + formatMinutes(min)); }
    if (fat !== null) { parts.push('体脂肪 約' + Math.abs(fat).toFixed(2) + 'kg'); }
    setText('home-dev-convert', parts.join(' ／ '));

    setText('home-dev-achieve',
      '目標赤字の ' + (cum.achievement === null ? '--' : cum.achievement + '%')
      + '　記録できた日 ' + cum.withData + '/7');
  }

  function setFill(v, scale) {
    var el = $('home-zerofill');
    if (!el) { return; }
    if (!scale) { el.style.width = '0%'; el.style.left = '50%'; return; }
    var w = Math.min(50, Math.abs(v) / scale * 50);
    el.className = (v >= 0) ? 'save' : 'debt';
    if (v >= 0) { el.style.left = '50%'; }
    else        { el.style.left = (50 - w) + '%'; }
    el.style.width = w + '%';
  }

  function formatMinutes(min) {
    if (min < 60) { return min + '分'; }
    var h = Math.floor(min / 60), m = min % 60;
    return h + '時間' + (m ? m + '分' : '');
  }

  /* ---------- 体重・体脂肪率 ---------- */

  function renderBody(settings) {
    var entries = S.listBody();
    var minSamples = (typeof settings.avgMinSamples === 'number') ? settings.avgMinSamples : C.DEFAULT_MIN_SAMPLES;
    var win = settings.avgWindowDays || C.DEFAULT_WINDOW_DAYS;

    /* 体重 */
    var latest = S.latestBodyEntry();
    var wSeries = C.primaryWeightSeries(entries);
    var wAvg = C.recentAverageInfo(wSeries, win, minSamples);

    if (latest && typeof latest.weightKg === 'number') {
      setText('home-weight-main', latest.weightKg.toFixed(1) + ' kg');
      var sub = [avgText(wAvg, 'kg')];
      if (typeof settings.targetWeightKg === 'number') {
        var diff = C.round(latest.weightKg - settings.targetWeightKg, 1);
        sub.push('目標まで ' + (diff > 0 ? '−' : '＋') + Math.abs(diff).toFixed(1) + 'kg');
      }
      setText('home-weight-sub', sub.filter(Boolean).join('　'));
    } else {
      setText('home-weight-main', '--');
      setText('home-weight-sub', '');
    }

    /* 体脂肪率 */
    var bfLatest = S.latestBodyEntryWith('bodyFatPct');
    var bfSeries = [];
    entries.forEach(function (e) {
      if (e.isPrimary && typeof e.bodyFatPct === 'number') {
        bfSeries.push({ date: e.date, value: e.bodyFatPct });
      }
    });
    var bfAvg = C.recentAverageInfo(bfSeries, win, minSamples);

    if (bfLatest) {
      setText('home-bodyfat-main', bfLatest.bodyFatPct.toFixed(1) + ' %');
      setText('home-bodyfat-sub', avgText(bfAvg, '%'));
    } else {
      setText('home-bodyfat-main', '--');
      setText('home-bodyfat-sub', '');
    }
  }

  function avgText(info, unit) {
    if (info.isComplete) {
      return info.windowDays + '日平均 ' + info.average.toFixed(1) + unit;
    }
    if (info.samples > 0) {
      return info.windowDays + '日平均 蓄積中（' + info.samples + '/' + info.windowDays + '日）';
    }
    return '';
  }

  /* ---------- 再描画 ---------- */

  function refresh() {
    var settings = S.getSettings();
    var data = bundle();
    var today = C.todayStr();

    var a = C.allowanceForDate(today, settings, data);

    renderBanners(a);
    renderRemaining(a);
    renderDeviation(settings, data, today);
    renderBody(settings);
  }

  function init() {
    var binds = [
      ['btn-quick-plan',    function () { App.Plan.open(); }],
      ['btn-quick-meal',    function () { App.Meal.open(); }],
      ['btn-quick-scan',    function () { App.Scan.open(); }],
      ['btn-quick-workout', function () { App.showScreen('addmenu'); }]
    ];
    binds.forEach(function (b) {
      var el = $(b[0]);
      if (el) { el.addEventListener('click', b[1]); }
    });
    refresh();
  }

  return { init: init, refresh: refresh };
})();
