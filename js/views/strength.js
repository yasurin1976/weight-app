/* ============================================================
   views/strength.js  —  筋トレの記録
   ------------------------------------------------------------
   1件＝1種目。回数は「10+10+8」のように区切って入力します。
   元の単位（kg / LBS）はそのまま保存します。

   運動時間は必須です。セット数と回数からは消費カロリーを
   計算できないため、時間から推定するためです。
   ============================================================ */

var App = App || {};

App.Strength = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var LBS_TO_KG = 0.45359237;

  var editingId = null;
  var unit = 'kg';

  function $(id) { return document.getElementById(id); }

  /* ---------- 回数の読み取り ---------- */

  /* 「10+10+8」「10,10,8」「10 10 8」 → [10,10,8] */
  function parseReps(text) {
    if (!text) { return []; }
    return String(text)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .split(/[^0-9]+/)
      .filter(function (s) { return s !== ''; })
      .map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return !isNaN(n) && n > 0 && n <= 999; });
  }

  function repsText(reps) {
    return (reps || []).join('+');
  }

  /* ---------- 単位 ---------- */

  function setUnit(u) {
    unit = (u === 'LBS') ? 'LBS' : 'kg';
    var btns = document.querySelectorAll('#w-unit-group .seg-btn');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.getAttribute('data-unit') === unit) { b.classList.add('is-on'); }
      else { b.classList.remove('is-on'); }
    });
  }

  /* 表示用の換算（保存するのは元の単位のまま） */
  function weightLabel(w, u) {
    if (typeof w !== 'number') { return ''; }
    if (u === 'LBS') {
      return w + 'LBS（約' + C.round(w * LBS_TO_KG, 1) + 'kg）';
    }
    return w + 'kg';
  }

  /* ---------- 画面を開く ---------- */

  function open(id) {
    editingId = id || null;
    showError(null);

    var sec = $('screen-strength');
    if (sec) { sec.setAttribute('data-title', editingId ? '筋トレを編集' : '筋トレを記録'); }

    fillExerciseList();

    if (editingId) {
      var e = S.getStrength(editingId);
      if ($('w-date'))     { $('w-date').value = (e && e.date) || C.todayStr(); }
      if ($('w-exercise')) { $('w-exercise').value = (e && e.exercise) || ''; }
      if ($('w-weight'))   { $('w-weight').value = (e && typeof e.weight === 'number') ? String(e.weight) : ''; }
      setUnit(e && e.unit);
      if ($('w-reps'))     { $('w-reps').value = e ? repsText(e.reps) : ''; }
      if ($('w-duration')) { $('w-duration').value = (e && typeof e.durationMin === 'number') ? String(e.durationMin) : ''; }
      if ($('w-memo'))     { $('w-memo').value = (e && e.memo) || ''; }
    } else {
      if ($('w-date'))     { $('w-date').value = C.todayStr(); }
      if ($('w-exercise')) { $('w-exercise').value = ''; }
      if ($('w-weight'))   { $('w-weight').value = ''; }
      setUnit('kg');
      if ($('w-reps'))     { $('w-reps').value = ''; }
      if ($('w-duration')) { $('w-duration').value = ''; }
      if ($('w-memo'))     { $('w-memo').value = ''; }
    }

    var del = $('btn-strength-delete');
    if (del) { del.hidden = !editingId; }

    renderPast();
    if (App.showScreen) { App.showScreen('strength'); }
  }

  /* ---------- 種目名の候補と過去の記録 ---------- */

  function fillExerciseList() {
    var dl = $('exercise-list');
    if (!dl) { return; }
    var seen = {};
    var names = [];
    S.listStrength().forEach(function (e) {
      if (e.exercise && !seen[e.exercise]) { seen[e.exercise] = true; names.push(e.exercise); }
    });
    dl.innerHTML = '';
    names.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      dl.appendChild(o);
    });
  }

  function renderPast() {
    var box  = $('w-past');
    var list = $('w-past-list');
    if (!box || !list) { return; }

    var name = ($('w-exercise') && $('w-exercise').value) ? $('w-exercise').value.trim() : '';
    if (!name) { box.hidden = true; return; }

    var past = S.historyOfExercise(name, 3).filter(function (e) { return e.id !== editingId; });
    if (!past.length) { box.hidden = true; return; }

    /* 新規入力で重量がまだ空なら、その種目を前回記録した単位に合わせる。
       LBS表示のマシンを kg として記録してしまう誤りを防ぐためです。 */
    if (!editingId) {
      var wEl = $('w-weight');
      if (wEl && (wEl.value || '').trim() === '' && past[0].unit) {
        setUnit(past[0].unit);
      }
    }

    list.innerHTML = '';
    past.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'past-row';
      var total = (e.reps || []).reduce(function (a, b) { return a + b; }, 0);
      row.textContent = C.formatDateShort(e.date) + '　'
        + weightLabel(e.weight, e.unit) + '　'
        + repsText(e.reps) + '回（計' + total + '）';
      list.appendChild(row);
    });

    var best = S.bestOfExercise(name);
    if (best && typeof best.weight === 'number') {
      var b = document.createElement('div');
      b.className = 'past-row past-best';
      b.textContent = '最高重量：' + weightLabel(best.weight, best.unit)
        + '（' + C.formatDateShort(best.date) + '）';
      list.appendChild(b);
    }

    box.hidden = false;
  }

  /* ---------- 入力の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    var date = ($('w-date') && $('w-date').value) ? $('w-date').value.trim() : '';
    if (!date) { errors.push('日付を入力してください。'); }
    else if (date > C.todayStr()) { errors.push('日付に未来の日付は入力できません。'); }
    out.date = date;

    var ex = ($('w-exercise') && $('w-exercise').value) ? $('w-exercise').value.trim() : '';
    if (!ex) { errors.push('種目名を入力してください。'); }
    out.exercise = ex.slice(0, 40);

    /* 重量は任意（自重種目もあるため） */
    var wRaw = ($('w-weight') && $('w-weight').value) ? $('w-weight').value.trim() : '';
    if (wRaw === '') {
      out.weight = null;
      out.unit   = unit;
    } else {
      var w = Number(wRaw);
      if (!isFinite(w))            { errors.push('重量には数字を入力してください。'); }
      else if (w < 0 || w > 1000)  { errors.push('重量は0〜1000の範囲で入力してください。'); }
      else if (!C.isMultipleOf(w, 0.5)) { errors.push('重量は0.5刻みで入力してください。'); }
      else { out.weight = C.snapToStep(w, 0.5); out.unit = unit; }
    }

    var repsRaw = ($('w-reps') && $('w-reps').value) ? $('w-reps').value.trim() : '';
    var reps = parseReps(repsRaw);
    if (!reps.length) {
      errors.push('各セットの回数を入力してください（例：10+10+8）。');
    } else {
      out.reps      = reps;
      out.setCount  = reps.length;
      out.totalReps = reps.reduce(function (a, b) { return a + b; }, 0);
      out.rawText   = repsRaw.slice(0, 100);
    }

    var dRaw = ($('w-duration') && $('w-duration').value) ? $('w-duration').value.trim() : '';
    if (dRaw === '') {
      errors.push('運動時間を入力してください。');
    } else {
      var d = Number(dRaw);
      if (!isFinite(d))                 { errors.push('運動時間には数字を入力してください。'); }
      else if (!C.isInteger(d))         { errors.push('運動時間は1分単位で入力してください。'); }
      else if (d < 1 || d > 300)        { errors.push('運動時間は1〜300分の範囲で入力してください。'); }
      else { out.durationMin = Math.round(d); }
    }

    out.memo = ($('w-memo') && $('w-memo').value) ? $('w-memo').value.trim().slice(0, 100) : '';

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('strength-error');
    if (!box) { return; }
    if (!messages || !messages.length) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = messages.join(' ');
    window.scrollTo(0, 0);
  }

  /* ---------- 保存・削除 ---------- */

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.errors.length) { showError(r.errors); return; }
    showError(null);

    var entry = r.values;
    if (editingId) { entry.id = editingId; }

    var res = S.saveStrength(entry);
    if (!res.ok) { showError([res.error]); return; }

    editingId = null;
    afterChange();
  }

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この記録を削除します。よろしいですか？')) { return; }
    var res = S.deleteStrength(editingId);
    if (!res.ok) { showError([res.error]); return; }
    editingId = null;
    afterChange();
  }

  function onCancel() {
    editingId = null;
    showError(null);
    if (App.showScreen) { App.showScreen('record'); }
  }

  function afterChange() {
    if (App.History && App.History.render) { App.History.goToday(); }
    if (App.Home && App.Home.refresh)      { App.Home.refresh(); }
    if (App.showScreen)                    { App.showScreen('record'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var form = $('strength-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var group = $('w-unit-group');
    if (group) {
      group.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== group) {
          if (t.getAttribute && t.getAttribute('data-unit')) { setUnit(t.getAttribute('data-unit')); return; }
          t = t.parentNode;
        }
      });
    }

    var ex = $('w-exercise');
    if (ex) {
      ex.addEventListener('input', renderPast);
      ex.addEventListener('change', renderPast);
    }

    var reps = $('w-reps');
    if (reps) {
      reps.addEventListener('input', function () {
        var r = parseReps(reps.value);
        var note = $('w-reps-note');
        if (!note) { return; }
        note.textContent = r.length
          ? (r.length + 'セット　合計' + r.reduce(function (a, b) { return a + b; }, 0) + '回')
          : '「+」か「,」で区切って入力してください。合計回数は自動計算します。';
      });
    }

    var del = $('btn-strength-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var cancel = $('btn-strength-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init:        init,
    open:        open,
    parseReps:   parseReps,
    repsText:    repsText,
    weightLabel: weightLabel
  };
})();
