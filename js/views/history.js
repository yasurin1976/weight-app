/* ============================================================
   views/history.js  —  記録画面（1日ぶんのタイムライン）
   ------------------------------------------------------------
   Phase 2 で「履歴」から「記録」に役割を変えました。
   既定は今日。日付を前後に送れば過去日も見られます。
   表示する種類は SECTIONS に登録しているので、
   写真解析を足しても表示側は変えずに済みます。
   ============================================================ */

var App = App || {};

App.History = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var LB = App.Labels;
  var viewDate = null;   /* 表示している日。null なら今日 */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls)  { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }

  /* ---------- 表示する種類の定義 ---------- */

  /* list()     … 全件を返す
     title      … その日の見出し
     rowText(e) … 1行に出す文字
     sub(e)     … 補足（メモなど。なければ空）
     editAttr   … タップで編集画面を開くための印
     actions(e) … 追加ボタン（代表にする・複製など） */
  var SECTIONS = [
    {
      key:   'body',
      title: '体組成',
      list:  function () { return S.listBody(); },
      rowText: function (e) {
        var parts = [];
        if (typeof e.weightKg === 'number')          { parts.push(e.weightKg.toFixed(1) + 'kg'); }
        if (typeof e.bodyFatPct === 'number')        { parts.push('体脂肪 ' + e.bodyFatPct.toFixed(1) + '%'); }
        if (typeof e.skeletalMuscleKg === 'number')  { parts.push('骨格筋 ' + e.skeletalMuscleKg.toFixed(1) + 'kg'); }
        if (typeof e.visceralLevel === 'number')     { parts.push('内臓脂肪 ' + e.visceralLevel); }
        return parts.join('　');
      },
      lead:    function (e) { return e.time || '--:--'; },
      badge:   function (e) { return e.isPrimary ? '代表' : null; },
      sub:     function (e) { return e.memo || ''; },
      sort:    function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; },
      open:    function (id) { App.Body.open(id); },
      actions: function (e, sameDay) {
        if (sameDay.length > 1 && !e.isPrimary) {
          return [{ label: '代表にする', act: 'set-primary', id: e.id }];
        }
        return [];
      }
    },
    {
      key:   'meals',
      title: '食事',
      list:  function () { return S.listMeals(); },
      rowText: function (e) {
        var t = e.name;
        if (typeof e.kcal === 'number') { t += '　' + e.kcal + 'kcal'; }
        return t;
      },
      lead:  function (e) { return S.mealTypeLabel(e.mealType); },
      badge: function () { return null; },
      sub:   function (e) {
        var pfc = [];
        if (typeof e.protein === 'number') { pfc.push('P ' + e.protein); }
        if (typeof e.fat === 'number')     { pfc.push('F ' + e.fat); }
        if (typeof e.carb === 'number')    { pfc.push('C ' + e.carb); }
        var s = pfc.join('　');
        if (e.memo) { s = s ? (s + '　/　' + e.memo) : e.memo; }
        return s;
      },
      sort:  function () { return 0; },   /* listMeals が区分順に並べて返す */
      open:  function (id) { App.Meal.open(id); },
      actions: function (e) {
        return [{ label: '複製して今日に登録', act: 'copy-meal', id: e.id }];
      }
    },
    {
      key:   'steps',
      title: '歩数',
      list:  function () { return S.listSteps(); },
      rowText: function (e) {
        var s = S.getSettings();
        var km = C.walkDistanceKm(e.steps, s.strideCm);
        return (typeof e.steps === 'number' ? e.steps.toLocaleString('ja-JP') : '-') + ' 歩'
             + (km !== null ? '　' + km.toFixed(2) + 'km' : '');
      },
      lead:  function () { return '日常'; },
      badge: function () { return null; },
      sub:   function () { return ''; },
      sort:  function () { return 0; },
      open:  function (id) {
        var r = S.listSteps().filter(function (x) { return x.id === id; })[0];
        App.Steps.open(r ? r.date : null);
      },
      actions: function () { return []; }
    },
    {
      key:   'strength',
      title: '筋トレ',
      list:  function () { return S.listStrength(); },
      rowText: function (e) {
        var parts = [e.exercise];
        if (typeof e.weight === 'number') { parts.push(App.Strength.weightLabel(e.weight, e.unit)); }
        if (e.reps && e.reps.length) {
          parts.push(App.Strength.repsText(e.reps) + '回（計' + e.totalReps + '）');
        }
        return parts.join('　');
      },
      lead:  function (e) { return (e.durationMin || '-') + '分'; },
      badge: function () { return null; },
      sub:   function (e) { return e.memo || ''; },
      sort:  function () { return 0; },
      open:  function (id) { App.Strength.open(id); },
      actions: function () { return []; }
    },
    {
      key:   'cardio',
      title: '有酸素',
      list:  function () { return S.listCardio(); },
      rowText: function (e) {
        var parts = [e.exercise];
        if (typeof e.distanceKm === 'number') { parts.push(e.distanceKm + 'km'); }
        if (typeof e.machineKcal === 'number') { parts.push('表示 ' + e.machineKcal + 'kcal'); }
        return parts.join('　');
      },
      lead:  function (e) { return (e.durationMin || '-') + '分'; },
      badge: function (e) {
        if (e.machineKcalType === 'gross') { return '安静分込'; }
        if (e.machineKcalType === 'net')   { return '運動分'; }
        return null;
      },
      sub:   function (e) {
        var s = [];
        if (typeof e.avgHr === 'number')    { s.push('心拍 ' + e.avgHr); }
        if (typeof e.avgSpeed === 'number') { s.push('速度 ' + e.avgSpeed); }
        if (typeof e.incline === 'number')  { s.push('傾斜 ' + e.incline); }
        if (typeof e.waterDepthCm === 'number') { s.push('水深 ' + e.waterDepthCm + 'cm'); }
        if (e.intensity) { s.push(e.intensity); }
        var t = s.join('　');
        if (e.memo) { t = t ? (t + '　/　' + e.memo) : e.memo; }
        return t;
      },
      sort:  function () { return 0; },
      open:  function (id) { App.Cardio.open(id); },
      actions: function () { return []; }
    }
  ];

  /* ---------- 表示する日 ---------- */

  function currentDate() {
    return viewDate || C.todayStr();
  }

  function shiftDay(n) {
    var d = C.shiftDate(currentDate(), n);
    if (d > C.todayStr()) { return; }        /* 未来には進めない */
    viewDate = d;
    render();
  }

  /* ---------- 1行を作る ---------- */

  function buildRow(sec, e, sameDay) {
    var row = el('div', 'entry-row');

    var main = el('button', 'entry-main');
    main.type = 'button';
    main.setAttribute('data-open', sec.key + ':' + e.id);

    main.appendChild(el('span', 'entry-time', sec.lead(e)));
    main.appendChild(el('span', 'entry-value', sec.rowText(e)));

    var badge = sec.badge(e);
    if (badge) { main.appendChild(el('span', 'badge', badge)); }

    row.appendChild(main);

    var subText = sec.sub(e);
    if (subText) { row.appendChild(el('div', 'entry-memo', subText)); }

    sec.actions(e, sameDay).forEach(function (a) {
      var b = el('button', 'entry-sub', a.label);
      b.type = 'button';
      b.setAttribute('data-act', a.act);
      b.setAttribute('data-id', a.id);
      row.appendChild(b);
    });

    return row;
  }

  /* ---------- 描画 ---------- */

  function render() {
    var date = currentDate();
    var list  = $('history-list');
    var empty = $('history-empty');
    if (!list) { return; }

    /* 日付ナビ */
    var label = $('day-label');
    if (label) {
      label.textContent = (date === C.todayStr()) ? '今日　' + C.formatDateJP(date) : C.formatDateJP(date);
    }
    var next = $('day-next');
    if (next) { next.disabled = (date >= C.todayStr()); }

    /* その日の集計 */
    var settings = S.getSettings();
    var data = {
      body: S.listBody(), meals: S.listMeals(), steps: S.listSteps(),
      strength: S.listStrength(), cardio: S.listCardio()
    };
    var a = C.allowanceForDate(date, settings, data);

    var intakeEl = $('day-intake');
    if (intakeEl) {
      intakeEl.textContent = a.hasIntake
        ? (a.intake.kcal.toLocaleString('ja-JP') + ' kcal'
           + (a.allowance !== null ? '　/　許容 ' + a.allowance.toLocaleString('ja-JP') : ''))
        : '--';
    }
    var devKey = $('day-dev-key');
    var devEl = $('day-dev');
    if (devEl) {
      if (a.deviation === null) {
        devEl.textContent = '--';
        if (devKey) { devKey.textContent = '乖離'; }
      } else {
        devEl.textContent = LB.signed(a.deviation) + ' kcal';
        devEl.className = 'kv-val ' + (a.deviation >= 0 ? 'good' : 'bad');
        if (devKey) { devKey.textContent = LB.forValue(a.deviation); }
      }
    }

    /* その日の記録 */
    list.innerHTML = '';
    var any = false;

    SECTIONS.forEach(function (sec) {
      var items = sec.list().filter(function (e) { return e && e.date === date; });
      if (!items.length) { return; }
      any = true;

      items = items.slice().sort(sec.sort);
      list.appendChild(el('div', 'sec-head', sec.title));
      items.forEach(function (e) { list.appendChild(buildRow(sec, e, items)); });

      if (sec.key === 'meals') {
        var t = C.sumNutrition(items);
        var sum = el('div', 'day-sum');
        sum.textContent = '合計 ' + t.kcal + 'kcal　P ' + t.protein + '　F ' + t.fat + '　C ' + t.carb;
        list.appendChild(sum);
      }
    });

    if (empty) { empty.hidden = any; }
  }

  /* ---------- 操作 ---------- */

  function onListClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute) {
        var act = t.getAttribute('data-act');
        if (act === 'set-primary') {
          var res = S.setPrimaryBodyEntry(t.getAttribute('data-id'));
          if (!res.ok) { window.alert(res.error); return; }
          render();
          if (App.Home && App.Home.refresh) { App.Home.refresh(); }
          return;
        }
        if (act === 'copy-meal') {
          var m = S.getMeal(t.getAttribute('data-id'));
          if (m) { App.Meal.open(null, m); }
          return;
        }
        var open = t.getAttribute('data-open');
        if (open) {
          var p = open.split(':');
          for (var i = 0; i < SECTIONS.length; i++) {
            if (SECTIONS[i].key === p[0]) { SECTIONS[i].open(p[1]); return; }
          }
          return;
        }
      }
      t = t.parentNode;
    }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var list = $('history-list');
    if (list) { list.addEventListener('click', onListClick); }

    var add = $('btn-history-add');
    if (add) { add.addEventListener('click', function () { App.showScreen('addmenu'); }); }

    var prev = $('day-prev');
    if (prev) { prev.addEventListener('click', function () { shiftDay(-1); }); }
    var next = $('day-next');
    if (next) { next.addEventListener('click', function () { shiftDay(1); }); }

    render();
  }

  function goToday() { viewDate = null; render(); }

  return {
    init:     init,
    render:   render,
    goToday:  goToday,
    SECTIONS: SECTIONS
  };
})();
