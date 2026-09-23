/* ============================================================
   views/steps.js  —  歩数の記録
   ------------------------------------------------------------
   1日1件です。同じ日付で保存すると上書きします。
   距離と推定消費カロリーは入力しながら自動で表示します。

   【二重計上を防ぐルール】
   ここに入れるのは日常の歩行だけです。
   トレッドミルや水中ウォーキングは有酸素として記録します。
   ============================================================ */

var App = App || {};

App.Steps = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var editingId = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- 画面を開く ---------- */

  function open(date) {
    showError(null);
    var d = date || C.todayStr();
    if ($('s-date')) { $('s-date').value = d; }
    loadForDate(d);
    if (App.showScreen) { App.showScreen('steps'); }
  }

  /* その日の記録があれば読み込む */
  function loadForDate(date) {
    var rec = S.getStepsByDate(date);
    editingId = rec ? rec.id : null;

    if ($('s-steps')) {
      $('s-steps').value = (rec && typeof rec.steps === 'number') ? String(rec.steps) : '';
    }

    var note = $('s-existing');
    if (note) {
      if (rec) {
        note.hidden = false;
        note.textContent = 'この日はすでに記録があります。保存すると上書きします。';
      } else {
        note.hidden = true;
      }
    }

    var del = $('btn-steps-delete');
    if (del) { del.hidden = !rec; }

    preview();
  }

  /* ---------- 距離・消費の自動表示 ---------- */

  function preview() {
    var raw = ($('s-steps') && $('s-steps').value) ? $('s-steps').value.trim() : '';
    var n = Number(raw);
    var date = ($('s-date') && $('s-date').value) ? $('s-date').value : C.todayStr();

    if (raw === '' || !isFinite(n) || n < 0) {
      setText('s-distance', '--');
      setText('s-kcal', '--');
      return;
    }

    var s = S.getSettings();
    var km = C.walkDistanceKm(n, s.strideCm);
    setText('s-distance', km === null ? '--' : km.toFixed(2) + ' km');

    var weight = C.weightForDate(S.listBody(), date);
    if (weight === null) {
      setText('s-kcal', '体重の記録が必要です');
      return;
    }
    var kcal = C.walkingKcal({ steps: n, strideCm: s.strideCm, weightKg: weight });
    setText('s-kcal', kcal === null ? '--' : kcal + ' kcal');
  }

  function setText(id, t) {
    var el = $(id);
    if (el) { el.textContent = t; }
  }

  /* ---------- 入力の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    var date = ($('s-date') && $('s-date').value) ? $('s-date').value.trim() : '';
    if (!date) { errors.push('日付を入力してください。'); }
    else if (date > C.todayStr()) { errors.push('日付に未来の日付は入力できません。'); }
    out.date = date;

    var raw = ($('s-steps') && $('s-steps').value) ? $('s-steps').value.trim() : '';
    if (raw === '') {
      errors.push('歩数を入力してください。');
    } else {
      var n = Number(raw);
      if (!isFinite(n)) { errors.push('歩数には数字を入力してください。'); }
      else if (!C.isInteger(n)) { errors.push('歩数は整数で入力してください。'); }
      else if (n < 0 || n > 100000) { errors.push('歩数は0〜100000の範囲で入力してください。'); }
      else { out.steps = Math.round(n); }
    }

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('steps-error');
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

    var res = S.saveSteps(r.values);   /* 同じ日付があれば上書き */
    if (!res.ok) { showError([res.error]); return; }

    editingId = null;
    afterChange();
  }

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この日の歩数を削除します。よろしいですか？')) { return; }
    var res = S.deleteSteps(editingId);
    if (!res.ok) { showError([res.error]); return; }
    editingId = null;
    afterChange();
  }

  function onCancel() {
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
    var form = $('steps-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var si = $('s-steps');
    if (si) { si.addEventListener('input', preview); }

    var di = $('s-date');
    if (di) {
      di.addEventListener('change', function () { loadForDate(di.value); });
    }

    var del = $('btn-steps-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var cancel = $('btn-steps-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init: init,
    open: open
  };
})();
