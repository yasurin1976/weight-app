/* ============================================================
   views/cardio.js  —  有酸素運動の記録
   ------------------------------------------------------------
   マシン表示のカロリーは原値のまま保存します。
   「安静分込み」と分かっているときだけ、その時間ぶんの
   基礎代謝を差し引いて消費カロリーに数えます。
   ============================================================ */

var App = App || {};

App.Cardio = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  /* 種目ごとの強度の目安。マシン表示がないときの推定に使います */
  var METS_PRESET = {
    'トレッドミル':     6.0,
    'ステッパー':       7.0,
    'クライマー':       8.0,
    '水中ウォーキング': 4.5,
    'その他':           5.0
  };

  var NUM_FIELDS = [
    { id: 'c-distance',     key: 'distanceKm',  label: '距離',     min: 0,  max: 100,  step: 0.01, stepLabel: '0.01km' },
    { id: 'c-machine-kcal', key: 'machineKcal', label: 'マシン表示', min: 0, max: 3000, step: 1,   stepLabel: '1kcal' },
    { id: 'c-mets',         key: 'mets',        label: '強度（METs）', min: 1, max: 20, step: 0.1, stepLabel: '0.1' },
    { id: 'c-hr',           key: 'avgHr',       label: '平均心拍', min: 30, max: 230,  step: 1,    stepLabel: '1' },
    { id: 'c-speed',        key: 'avgSpeed',    label: '平均速度', min: 0,  max: 40,   step: 0.1,  stepLabel: '0.1' },
    { id: 'c-incline',      key: 'incline',     label: '傾斜',     min: 0,  max: 30,   step: 0.1,  stepLabel: '0.1' },
    { id: 'c-depth',        key: 'waterDepthCm',label: '水深',     min: 30, max: 200,  step: 1,    stepLabel: '1cm' }
  ];

  var editingId = null;
  var kcalType  = 'unknown';

  function $(id) { return document.getElementById(id); }

  /* ---------- 種目の選択 ---------- */

  function setExercise(name) {
    var btns = document.querySelectorAll('#c-type-group .chip');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.getAttribute('data-ex') === name) { b.classList.add('is-on'); }
      else { b.classList.remove('is-on'); }
    });

    if ($('c-exercise')) {
      $('c-exercise').value = (name === 'その他') ? '' : name;
    }
    if ($('c-mets') && METS_PRESET[name]) {
      $('c-mets').value = String(METS_PRESET[name]);
    }

    var water = $('c-water-row');
    if (water) { water.hidden = (name !== '水中ウォーキング'); }

    preview();
  }

  function setKcalType(t) {
    kcalType = t || 'unknown';
    var btns = document.querySelectorAll('#c-kcaltype-group .seg-btn');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.getAttribute('data-kt') === kcalType) { b.classList.add('is-on'); }
      else { b.classList.remove('is-on'); }
    });
    preview();
  }

  /* ---------- 推定消費の自動表示 ---------- */

  function numOf(id) {
    var el = $(id);
    if (!el) { return null; }
    var raw = (el.value || '').trim();
    if (raw === '') { return null; }
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  function preview() {
    var date     = ($('c-date') && $('c-date').value) ? $('c-date').value : C.todayStr();
    var duration = numOf('c-duration');
    var machine  = numOf('c-machine-kcal');
    var mets     = numOf('c-mets');

    if (duration === null) {
      setText('c-preview', '--');
      setText('c-preview-note', '運動時間を入れると推定を表示します。');
      return;
    }

    var settings = S.getSettings();
    var body     = S.listBody();
    var weight   = C.weightForDate(body, date);
    var age      = C.ageFromBirthdate(settings.birthdate);
    var bmrInfo  = C.bmrForDate(body, date, {
      weightKg: weight, heightCm: settings.heightCm, age: age, sex: settings.sex || 'male'
    });

    var r = C.cardioKcal({
      durationMin:     duration,
      machineKcal:     machine,
      machineKcalType: kcalType,
      bmr24:           bmrInfo.value,
      mets:            mets,
      weightKg:        weight
    });

    if (!r) {
      setText('c-preview', '--');
      setText('c-preview-note', 'マシン表示か、強度（METs）と体重の記録が必要です。');
      return;
    }

    setText('c-preview', r.value + ' kcal');

    var note = '';
    if (r.basis === 'machine-as-reported') {
      note = 'マシン表示をそのまま参考値として使っています。';
    } else if (r.basis === 'machine-net') {
      note = 'マシン表示（運動分のみ）をそのまま使っています。';
    } else if (r.basis === 'machine-gross-adjusted') {
      note = 'マシン表示から、この時間ぶんの基礎代謝' + r.restingSubtracted + 'kcalを差し引いています。';
    } else {
      note = '強度（METs）と体重から推定しています。';
    }
    setText('c-preview-note', note);
  }

  function setText(id, t) {
    var el = $(id);
    if (el) { el.textContent = t; }
  }

  /* ---------- 画面を開く ---------- */

  function open(id) {
    editingId = id || null;
    showError(null);

    var sec = $('screen-cardio');
    if (sec) { sec.setAttribute('data-title', editingId ? '有酸素を編集' : '有酸素を記録'); }

    if (editingId) {
      var e = S.getCardio(editingId) || {};
      if ($('c-date')) { $('c-date').value = e.date || C.todayStr(); }
      if ($('c-exercise')) { $('c-exercise').value = e.exercise || ''; }
      if ($('c-duration')) { $('c-duration').value = (typeof e.durationMin === 'number') ? String(e.durationMin) : ''; }
      NUM_FIELDS.forEach(function (f) {
        var el = $(f.id);
        if (!el) { return; }
        var v = e[f.key];
        el.value = (typeof v === 'number' && isFinite(v)) ? String(v) : '';
      });
      if ($('c-intensity')) { $('c-intensity').value = e.intensity || ''; }
      if ($('c-memo'))      { $('c-memo').value = e.memo || ''; }
      setKcalType(e.machineKcalType || 'unknown');
      highlightChip(e.exercise);
      var water = $('c-water-row');
      if (water) { water.hidden = (e.exercise !== '水中ウォーキング'); }
    } else {
      if ($('c-date')) { $('c-date').value = C.todayStr(); }
      if ($('c-duration')) { $('c-duration').value = ''; }
      NUM_FIELDS.forEach(function (f) { if ($(f.id)) { $(f.id).value = ''; } });
      if ($('c-intensity')) { $('c-intensity').value = ''; }
      if ($('c-memo'))      { $('c-memo').value = ''; }
      setKcalType('unknown');
      setExercise('トレッドミル');
    }

    var del = $('btn-cardio-delete');
    if (del) { del.hidden = !editingId; }

    preview();
    if (App.showScreen) { App.showScreen('cardio'); }
  }

  function highlightChip(name) {
    var known = false;
    Object.keys(METS_PRESET).forEach(function (k) { if (k === name) { known = true; } });
    var btns = document.querySelectorAll('#c-type-group .chip');
    Array.prototype.forEach.call(btns, function (b) {
      var v = b.getAttribute('data-ex');
      var on = known ? (v === name) : (v === 'その他');
      if (on) { b.classList.add('is-on'); } else { b.classList.remove('is-on'); }
    });
  }

  /* ---------- 入力の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    var date = ($('c-date') && $('c-date').value) ? $('c-date').value.trim() : '';
    if (!date) { errors.push('日付を入力してください。'); }
    else if (date > C.todayStr()) { errors.push('日付に未来の日付は入力できません。'); }
    out.date = date;

    var ex = ($('c-exercise') && $('c-exercise').value) ? $('c-exercise').value.trim() : '';
    if (!ex) { errors.push('種目名を入力してください。'); }
    out.exercise = ex.slice(0, 40);

    var dRaw = ($('c-duration') && $('c-duration').value) ? $('c-duration').value.trim() : '';
    if (dRaw === '') {
      errors.push('運動時間を入力してください。');
    } else {
      var d = Number(dRaw);
      if (!isFinite(d))          { errors.push('運動時間には数字を入力してください。'); }
      else if (!C.isInteger(d))  { errors.push('運動時間は1分単位で入力してください。'); }
      else if (d < 1 || d > 300) { errors.push('運動時間は1〜300分の範囲で入力してください。'); }
      else { out.durationMin = Math.round(d); }
    }

    NUM_FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { out[f.key] = null; return; }
      var raw = (el.value || '').trim();
      if (raw === '') { out[f.key] = null; return; }
      var n = Number(raw);
      if (!isFinite(n)) { errors.push(f.label + 'には数字を入力してください。'); return; }
      if (n < f.min || n > f.max) {
        errors.push(f.label + 'は' + f.min + '〜' + f.max + 'の範囲で入力してください。');
        return;
      }
      if (!C.isMultipleOf(n, f.step)) {
        errors.push(f.label + 'は' + f.stepLabel + '刻みで入力してください。');
        return;
      }
      out[f.key] = C.snapToStep(n, f.step);
    });

    out.machineKcalType = (out.machineKcal === null) ? null : kcalType;
    out.intensity = ($('c-intensity') && $('c-intensity').value) ? $('c-intensity').value.trim().slice(0, 20) : '';
    out.memo      = ($('c-memo') && $('c-memo').value) ? $('c-memo').value.trim().slice(0, 100) : '';

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('cardio-error');
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

    var res = S.saveCardio(entry);
    if (!res.ok) { showError([res.error]); return; }

    editingId = null;
    afterChange();
  }

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この記録を削除します。よろしいですか？')) { return; }
    var res = S.deleteCardio(editingId);
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
    var form = $('cardio-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var types = $('c-type-group');
    if (types) {
      types.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== types) {
          if (t.getAttribute && t.getAttribute('data-ex')) { setExercise(t.getAttribute('data-ex')); return; }
          t = t.parentNode;
        }
      });
    }

    var kt = $('c-kcaltype-group');
    if (kt) {
      kt.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== kt) {
          if (t.getAttribute && t.getAttribute('data-kt')) { setKcalType(t.getAttribute('data-kt')); return; }
          t = t.parentNode;
        }
      });
    }

    ['c-duration', 'c-machine-kcal', 'c-mets'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('input', preview); }
    });

    var del = $('btn-cardio-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var cancel = $('btn-cardio-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init: init,
    open: open,
    METS_PRESET: METS_PRESET
  };
})();
