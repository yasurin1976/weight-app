/* ============================================================
   views/trend.js  —  推移（直近7日 ／ 長期）
   ------------------------------------------------------------
   直近7日：累積乖離を数値・0中心バー・運動換算・体脂肪換算で表示し、
            実測体重との答え合わせと目安の補正提案を出します。
            【重要】提案するだけで、承認するまで設定は変わりません。

   長期　：カロリー乖離／体重／体脂肪率を縦3段で、同じ期間で並べます。
   ============================================================ */

var App = App || {};

App.Trend = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;
  var LB = App.Labels;

  var tab = 'week';
  var rangeDays = 30;
  var charts = {};
  var lastProposal = null;

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

  function cssVar(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || fb;
  }

  /* ============================================================
     直近7日
     ============================================================ */

  function renderWeek() {
    var settings = S.getSettings();
    var data = bundle();
    var today = C.todayStr();
    var cum = C.cumulativeDeviation(today, settings, data, 7);

    setText('wk-label', LB.L.deviationTitle);

    if (cum.total === null) {
      setText('wk-total', '--');
      setText('wk-unit', '');
      setText('wk-target', '食事を記録すると計算できます');
    } else {
      setText('wk-total', LB.signed(cum.total));
      setText('wk-unit', ' ' + LB.L.deviationUnit + ' ' + LB.forValue(cum.total));
      setText('wk-target', '目標 ' + cum.targetTotal.toLocaleString('ja-JP')
        + ' に対し ' + (cum.achievement === null ? '--' : cum.achievement + '%'));
    }

    renderWeekBars(cum);

    var ex = (cum.total === null) ? null : C.toExerciseMinutes(cum.total, settings, data, today);
    setText('wk-ex', ex === null ? '--' : ('約 ' + formatMinutes(ex)));
    var fat = (cum.total === null) ? null : C.toFatKg(cum.total);
    setText('wk-fat', fat === null ? '--' : ('約 ' + Math.abs(fat).toFixed(2) + ' kg'));
    setText('wk-days-count', cum.withData + ' / 7 日');

    renderCalibration(settings, data, today);
  }

  function formatMinutes(min) {
    if (min < 60) { return min + '分'; }
    var h = Math.floor(min / 60), m = min % 60;
    return h + '時間' + (m ? m + '分' : '');
  }

  function renderWeekBars(cum) {
    var bars = $('wk-bars');
    var days = $('wk-days');
    if (!bars || !days) { return; }

    var max = 1;
    cum.byDay.forEach(function (d) {
      if (typeof d.deviation === 'number') { max = Math.max(max, Math.abs(d.deviation)); }
    });

    bars.innerHTML = '';
    days.innerHTML = '';

    cum.byDay.forEach(function (d) {
      var cell = document.createElement('div');
      if (typeof d.deviation === 'number') {
        var h = Math.round(Math.abs(d.deviation) / max * 46);
        var b = document.createElement('span');
        b.className = 'b ' + (d.deviation >= 0 ? 'save' : 'debt');
        b.style.height = Math.max(h, 3) + 'px';
        b.title = d.date + '　' + LB.signedWithWord(d.deviation);
        cell.appendChild(b);
      } else {
        var none = document.createElement('span');
        none.className = 'b none';
        none.style.height = '3px';
        cell.appendChild(none);
      }
      bars.appendChild(cell);

      var lab = document.createElement('div');
      var l = document.createElement('span');
      l.className = 'd';
      l.textContent = Number(d.date.split('-')[2]);
      lab.appendChild(l);
      days.appendChild(lab);
    });
  }

  /* ---------- 実測との答え合わせと補正提案 ---------- */

  function renderCalibration(settings, data, today) {
    var box = $('wk-calib-body');
    if (!box) { return; }

    var p = C.calibrationProposal(settings, data, { endDate: today, days: 14 });
    lastProposal = p;
    box.innerHTML = '';

    if (!p.comparable) {
      var note = document.createElement('p');
      note.className = 'note';
      note.textContent = p.reason;
      box.appendChild(note);
      return;
    }

    box.appendChild(kv('理論上の変化', p.theoreticalDeltaKg.toFixed(2) + ' kg'));
    box.appendChild(kv('7日平均の実変化', p.actualDeltaKg.toFixed(2) + ' kg'));
    box.appendChild(kv('ズレ', (p.gapPerDay > 0 ? '＋' : '') + p.gapPerDay + ' kcal／日'));

    if (!p.meaningful) {
      var ok = document.createElement('p');
      ok.className = 'note';
      ok.textContent = '推定と実測はおおむね合っています。目安の変更は不要です。';
      box.appendChild(ok);
      return;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.id = 'btn-apply-calib';
    btn.textContent = LB.L.baseTarget + 'を ' + p.currentBase.toLocaleString('ja-JP')
      + ' → ' + p.suggestedBase.toLocaleString('ja-JP') + ' に変更';
    btn.addEventListener('click', onApplyCalibration);
    box.appendChild(btn);

    var warn = document.createElement('p');
    warn.className = 'note';
    warn.textContent = '承認するまで変更しません。変更しても記録は書き換わらず、今日以降の許容量だけが変わります。';
    box.appendChild(warn);
  }

  function kv(k, v) {
    var row = document.createElement('div');
    row.className = 'kv';
    var a = document.createElement('span'); a.className = 'kv-key'; a.textContent = k;
    var b = document.createElement('span'); b.className = 'kv-val'; b.textContent = v;
    row.appendChild(a); row.appendChild(b);
    return row;
  }

  function onApplyCalibration() {
    if (!lastProposal) { return; }
    var msg = App.Labels.L.baseTarget + 'を '
      + lastProposal.currentBase + ' から ' + lastProposal.suggestedBase + ' に変更します。\n'
      + '過去の記録は書き換わりません。よろしいですか？';
    if (!window.confirm(msg)) { return; }

    var res = S.applyCalibration(lastProposal);
    if (!res.ok) { window.alert(res.error); return; }

    renderWeek();
    if (App.Home && App.Home.refresh) { App.Home.refresh(); }
    if (App.Settings && App.Settings.fillForm) { App.Settings.fillForm(); }
  }

  /* ============================================================
     長期
     ============================================================ */

  function startDate() {
    return C.shiftDate(C.todayStr(), -(rangeDays - 1));
  }

  function baseOptions(unit) {
    var text = cssVar('--text-sub', '#6b7280');
    var grid = cssVar('--border', '#dfe2e8');
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--surface', '#fff'),
          titleColor: cssVar('--text', '#1b1d21'),
          bodyColor: cssVar('--text', '#1b1d21'),
          borderColor: grid, borderWidth: 1, padding: 10,
          callbacks: {
            label: function (ctx) {
              if (ctx.parsed.y === null) { return null; }
              return ctx.dataset.label + '： ' + ctx.parsed.y + unit;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false },
             ticks: { color: text, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { grid: { color: grid, drawBorder: false }, ticks: { color: text, font: { size: 11 } } }
      }
    };
  }

  function draw(canvasId, type, labels, datasets, unit) {
    var el = $(canvasId);
    if (!el || typeof Chart === 'undefined') { return; }
    if (charts[canvasId]) { charts[canvasId].destroy(); }
    charts[canvasId] = new Chart(el.getContext('2d'), {
      type: type,
      data: { labels: labels, datasets: datasets },
      options: baseOptions(unit)
    });
  }

  function line(label, data, color, opts) {
    var o = opts || {};
    return {
      label: label, data: data,
      borderColor: color, backgroundColor: color,
      borderWidth: 2, borderDash: o.dash || [],
      pointRadius: o.pointRadius === undefined ? 3 : o.pointRadius,
      pointHoverRadius: 6,
      pointBorderColor: cssVar('--surface', '#fff'), pointBorderWidth: 2,
      tension: 0.25, spanGaps: true
    };
  }

  function renderLong() {
    var settings = S.getSettings();
    var data = bundle();
    var today = C.todayStr();
    var from = startDate();

    var allSeries = C.primaryWeightSeries(data.body);
    var series = allSeries.filter(function (p) { return p.date >= from; });

    var empty = $('chart-empty');
    var area  = $('chart-area');
    if (!series.length) {
      if (empty) { empty.hidden = false; }
      if (area)  { area.hidden = true; }
      return;
    }
    if (empty) { empty.hidden = true; }
    if (area)  { area.hidden = false; }

    /* --- カロリー乖離（期間ぶん、日ごと） --- */
    var cum = C.cumulativeDeviation(today, settings, data, rangeDays);
    var devLabels = [], devValues = [], devColors = [];
    var good = cssVar('--good', '#17794f');
    var bad  = cssVar('--bad',  '#b3341f');

    cum.byDay.forEach(function (d) {
      devLabels.push(C.formatDateShort(d.date));
      devValues.push(typeof d.deviation === 'number' ? d.deviation : null);
      devColors.push((d.deviation >= 0) ? good : bad);
    });

    draw('chart-deviation', 'bar', devLabels, [{
      label: LB.L.deviationTitle,
      data: devValues,
      backgroundColor: devColors,
      borderRadius: 3,
      borderSkipped: false
    }], ' kcal');

    setText('dev-chart-label', 'カロリー乖離（' + LB.L.surplus + 'が上／' + LB.L.deficit + 'が下）');
    setText('dev-chart-note', cum.total === null
      ? '食事の記録がある日だけ表示します。'
      : ('この期間の累積 ' + LB.signedWithWord(cum.total) + '　記録できた日 ' + cum.withData + '/' + rangeDays + '日'));

    /* --- 体重 --- */
    var minSamples = (typeof settings.avgMinSamples === 'number') ? settings.avgMinSamples : C.DEFAULT_MIN_SAMPLES;
    var ma = C.movingAverage(allSeries, settings.avgWindowDays || 7, minSamples);
    var maBy = {};
    ma.forEach(function (p) { maBy[p.date] = p.average; });

    var wLabels = series.map(function (p) { return C.formatDateShort(p.date); });
    draw('chart-weight', 'line', wLabels, [
      line('実測', series.map(function (p) { return p.value; }), cssVar('--series-1', '#2a78d6'), { pointRadius: 2 }),
      line('7日平均', series.map(function (p) {
        var v = maBy[p.date]; return (v === undefined) ? null : v;
      }), cssVar('--series-2', '#eb6834'), { pointRadius: 0, dash: [6, 4] })
    ], 'kg');

    /* --- 体脂肪率 --- */
    var bf = [];
    data.body.forEach(function (e) {
      if (!e.isPrimary || typeof e.bodyFatPct !== 'number') { return; }
      if (e.date < from) { return; }
      bf.push({ date: e.date, value: e.bodyFatPct });
    });
    bf.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    var bfNote = $('bodyfat-chart-note');
    var bfBox = $('chart-bodyfat') ? $('chart-bodyfat').parentNode : null;
    if (!bf.length) {
      if (charts['chart-bodyfat']) { charts['chart-bodyfat'].destroy(); delete charts['chart-bodyfat']; }
      if (bfBox)  { bfBox.hidden = true; }
      if (bfNote) { bfNote.hidden = false; }
    } else {
      if (bfBox)  { bfBox.hidden = false; }
      if (bfNote) { bfNote.hidden = true; }

      var bfMa = C.movingAverage(bf, settings.avgWindowDays || 7, minSamples);
      var bfBy = {};
      bfMa.forEach(function (p) { bfBy[p.date] = p.average; });

      draw('chart-bodyfat', 'line', bf.map(function (p) { return C.formatDateShort(p.date); }), [
        line('実測', bf.map(function (p) { return p.value; }), cssVar('--series-1', '#2a78d6'), { pointRadius: 2 }),
        line('7日平均', bf.map(function (p) {
          var v = bfBy[p.date]; return (v === undefined) ? null : v;
        }), cssVar('--series-2', '#eb6834'), { pointRadius: 0, dash: [6, 4] })
      ], '%');
    }
  }

  /* ============================================================
     切り替え
     ============================================================ */

  function setTab(t) {
    tab = t;
    var tabs = $('trend-tabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-tab') === t);
      });
    }
    if ($('trend-week')) { $('trend-week').hidden = (t !== 'week'); }
    if ($('trend-long')) { $('trend-long').hidden = (t !== 'long'); }
    render();
  }

  function setRange(days) {
    rangeDays = Number(days) || 30;
    var g = $('range-group');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-on', Number(b.getAttribute('data-range')) === rangeDays);
      });
    }
    if (tab === 'long') { renderLong(); }
  }

  function render() {
    if (tab === 'week') { renderWeek(); }
    else { renderLong(); }
  }

  function init() {
    var tabs = $('trend-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== tabs) {
          if (t.getAttribute && t.getAttribute('data-tab')) { setTab(t.getAttribute('data-tab')); return; }
          t = t.parentNode;
        }
      });
    }

    var g = $('range-group');
    if (g) {
      g.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== g) {
          if (t.getAttribute && t.getAttribute('data-range')) { setRange(t.getAttribute('data-range')); return; }
          t = t.parentNode;
        }
      });
    }

    setTab('week');
  }

  return { init: init, render: render, setTab: setTab };
})();
