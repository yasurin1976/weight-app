/* ============================================================
   views/chart.js  —  推移グラフ
   ------------------------------------------------------------
   ・体重（実測の代表体重＋7日平均）
   ・体脂肪率
   ・骨格筋量

   1つのグラフには1種類の軸だけを使います（体重と体脂肪率を
   1つのグラフに重ねると読み違えるため、別々にしています）。
   ============================================================ */

var App = App || {};

App.Chart = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var rangeDays = 30;         // 0 なら全期間
  var charts = {};            // 描画済みのグラフ

  function $(id) { return document.getElementById(id); }

  /* ---------- 色（CSSで定義した値を読む） ---------- */

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = (v || '').trim();
    return v || fallback;
  }

  function palette() {
    return {
      series1: cssVar('--series-1', '#2a78d6'),
      series2: cssVar('--series-2', '#eb6834'),
      text:    cssVar('--text-sub', '#6b7280'),
      grid:    cssVar('--border', '#dfe2e8'),
      surface: cssVar('--surface', '#ffffff')
    };
  }

  /* ---------- データの用意 ---------- */

  function startDate() {
    if (!rangeDays) { return null; }
    return C.shiftDate(C.todayStr(), -(rangeDays - 1));
  }

  /* 代表体重の日別データ（期間で絞る） */
  function weightSeries() {
    var all = C.primaryWeightSeries(S.listBody());
    var from = startDate();
    return from ? all.filter(function (p) { return p.date >= from; }) : all;
  }

  /* 代表測定から、指定した項目の日別データを作る */
  function fieldSeries(field) {
    var from = startDate();
    var out = [];
    S.listBody().forEach(function (e) {
      if (!e.isPrimary || typeof e[field] !== 'number') { return; }
      if (from && e.date < from) { return; }
      out.push({ date: e.date, value: e[field] });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  /* ---------- グラフの共通設定 ---------- */

  function baseOptions(pal, unit) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: pal.surface,
          titleColor: cssVar('--text', '#1b1d21'),
          bodyColor: cssVar('--text', '#1b1d21'),
          borderColor: pal.grid,
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            label: function (ctx) {
              if (ctx.parsed.y === null) { return null; }
              return ctx.dataset.label + '： ' + ctx.parsed.y + unit;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: pal.text,
            font: { size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          }
        },
        y: {
          grid: { color: pal.grid, drawBorder: false },
          ticks: { color: pal.text, font: { size: 11 } }
        }
      }
    };
  }

  function lineDataset(label, data, color, opts) {
    var o = opts || {};
    return {
      label: label,
      data: data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderDash: o.dash || [],
      pointRadius: o.pointRadius === undefined ? 3 : o.pointRadius,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: cssVar('--surface', '#fff'),
      pointBorderWidth: 2,
      tension: 0.25,
      spanGaps: true
    };
  }

  function draw(canvasId, labels, datasets, unit) {
    var el = $(canvasId);
    if (!el || typeof Chart === 'undefined') { return; }

    if (charts[canvasId]) { charts[canvasId].destroy(); }
    charts[canvasId] = new Chart(el.getContext('2d'), {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: baseOptions(palette(), unit)
    });
  }

  /* ---------- 描画 ---------- */

  function render() {
    var pal = palette();
    var s   = S.getSettings();

    var wSeries = weightSeries();
    var empty   = $('chart-empty');
    var area    = $('chart-area');

    if (!wSeries.length) {
      if (empty) { empty.hidden = false; }
      if (area)  { area.hidden = true; }
      return;
    }
    if (empty) { empty.hidden = true; }
    if (area)  { area.hidden = false; }

    /* --- 体重（実測＋7日平均） --- */
    var minSamples = (typeof s.avgMinSamples === 'number') ? s.avgMinSamples : C.DEFAULT_MIN_SAMPLES;
    var windowDays = s.avgWindowDays || C.DEFAULT_WINDOW_DAYS;

    /* 平均は期間外のデータも使って計算するため、全期間から計算して期間で切り出す */
    var allSeries = C.primaryWeightSeries(S.listBody());
    var ma = C.movingAverage(allSeries, windowDays, minSamples);
    var maByDate = {};
    ma.forEach(function (p) { maByDate[p.date] = p.average; });

    var labels = wSeries.map(function (p) { return C.formatDateShort(p.date); });
    var actual = wSeries.map(function (p) { return p.value; });
    var avg    = wSeries.map(function (p) {
      var v = maByDate[p.date];
      return (v === undefined) ? null : v;
    });

    draw('chart-weight', labels, [
      lineDataset('実測', actual, pal.series1, { pointRadius: 3 }),
      lineDataset(windowDays + '日平均', avg, pal.series2, { pointRadius: 0, dash: [6, 4] })
    ], 'kg');

    var withAvg = avg.filter(function (v) { return v !== null; }).length;
    var note = $('weight-chart-note');
    if (note) {
      note.textContent = withAvg
        ? (windowDays + '日平均は、直近' + windowDays + '日のうち' + minSamples + '日以上の測定がある日だけ線を引いています。')
        : ('測定日数が足りないため' + windowDays + '日平均はまだ表示できません（' + minSamples + '日以上必要）。');
    }

    /* --- 体脂肪率 --- */
    drawSingle('chart-bodyfat', 'bodyfat-chart-note', fieldSeries('bodyFatPct'), '体脂肪率', '%', pal.series1);

    /* --- 骨格筋量 --- */
    drawSingle('chart-muscle', 'muscle-chart-note', fieldSeries('skeletalMuscleKg'), '骨格筋量', 'kg', pal.series1);

    renderTable(wSeries, maByDate);
  }

  function drawSingle(canvasId, noteId, series, label, unit, color) {
    var note = $(noteId);
    var el = $(canvasId);

    if (!series.length) {
      if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
      if (el)   { el.parentNode.hidden = true; }
      if (note) { note.hidden = false; }
      return;
    }
    if (el)   { el.parentNode.hidden = false; }
    if (note) { note.hidden = true; }

    draw(canvasId,
      series.map(function (p) { return C.formatDateShort(p.date); }),
      [lineDataset(label, series.map(function (p) { return p.value; }), color, { pointRadius: 3 })],
      unit);
  }

  /* ---------- 数値表 ---------- */

  function renderTable(wSeries, maByDate) {
    var t = $('chart-table');
    if (!t) { return; }

    var body = S.listBody();
    var byDate = {};
    body.forEach(function (e) { if (e.isPrimary) { byDate[e.date] = e; } });

    var rows = wSeries.slice().reverse();
    var html = '<thead><tr><th>日付</th><th>体重</th><th>平均</th><th>体脂肪</th><th>骨格筋</th></tr></thead><tbody>';
    rows.forEach(function (p) {
      var e = byDate[p.date] || {};
      var avg = maByDate[p.date];
      html += '<tr>'
        + '<td>' + C.formatDateShort(p.date) + '</td>'
        + '<td>' + p.value.toFixed(1) + '</td>'
        + '<td>' + (avg === null || avg === undefined ? '—' : avg.toFixed(1)) + '</td>'
        + '<td>' + (typeof e.bodyFatPct === 'number' ? e.bodyFatPct.toFixed(1) : '—') + '</td>'
        + '<td>' + (typeof e.skeletalMuscleKg === 'number' ? e.skeletalMuscleKg.toFixed(1) : '—') + '</td>'
        + '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
  }

  /* ---------- 期間切り替え ---------- */

  function setRange(days) {
    rangeDays = Number(days) || 0;
    var btns = document.querySelectorAll('#range-group .seg-btn');
    Array.prototype.forEach.call(btns, function (b) {
      if (Number(b.getAttribute('data-range')) === rangeDays) { b.classList.add('is-on'); }
      else { b.classList.remove('is-on'); }
    });
    render();
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var group = $('range-group');
    if (group) {
      group.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== group) {
          if (t.getAttribute && t.getAttribute('data-range') !== null) {
            setRange(t.getAttribute('data-range'));
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var tbl = $('btn-chart-table');
    if (tbl) {
      tbl.addEventListener('click', function () {
        var card = $('chart-table-card');
        if (!card) { return; }
        card.hidden = !card.hidden;
        tbl.textContent = card.hidden ? '数値で見る' : '数値を閉じる';
      });
    }

    setRange(30);
  }

  return {
    init:   init,
    render: render
  };
})();
