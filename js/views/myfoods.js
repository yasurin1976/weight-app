/* ============================================================
   views/myfoods.js  —  マイ食品リスト
   ------------------------------------------------------------
   よく食べるものを登録しておき、食事記録のときに呼び出します。
   使った回数が多いものが上に並びます。
   ============================================================ */

var App = App || {};

App.MyFoods = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var FIELDS = [
    { id: 'mf-kcal',    key: 'kcal',    label: 'カロリー', min: 0, max: 5000, step: 1,   stepLabel: '1kcal', required: true },
    { id: 'mf-protein', key: 'protein', label: 'P（タンパク質）', min: 0, max: 500, step: 0.1, stepLabel: '0.1g' },
    { id: 'mf-fat',     key: 'fat',     label: 'F（脂質）',       min: 0, max: 500, step: 0.1, stepLabel: '0.1g' },
    { id: 'mf-carb',    key: 'carb',    label: 'C（炭水化物）',   min: 0, max: 500, step: 0.1, stepLabel: '0.1g' }
  ];

  var editingId = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- 一覧 ---------- */

  function render() {
    var list  = $('myfood-list');
    var empty = $('myfood-empty');
    if (!list) { return; }

    var foods = S.listMyFoods();
    list.innerHTML = '';
    if (empty) { empty.hidden = foods.length > 0; }

    foods.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'entry-row';

      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'entry-main';
      main.setAttribute('data-food-edit', f.id);

      var v = document.createElement('span');
      v.className = 'entry-value';
      v.textContent = f.name + (f.unitLabel ? '（' + f.unitLabel + '）' : '');

      var k = document.createElement('span');
      k.className = 'entry-time';
      k.textContent = (typeof f.kcal === 'number' ? f.kcal : '-') + 'kcal';

      main.appendChild(v);
      main.appendChild(k);
      row.appendChild(main);

      var pfc = [];
      if (typeof f.protein === 'number') { pfc.push('P ' + f.protein); }
      if (typeof f.fat === 'number')     { pfc.push('F ' + f.fat); }
      if (typeof f.carb === 'number')    { pfc.push('C ' + f.carb); }
      if (pfc.length) {
        var sub = document.createElement('div');
        sub.className = 'entry-memo';
        sub.textContent = pfc.join('　');
        row.appendChild(sub);
      }

      list.appendChild(row);
    });
  }

  /* ---------- 入力フォーム ---------- */

  function openForm(id) {
    editingId = id || null;
    showError(null);

    var form = $('myfood-form');
    if (form) { form.hidden = false; }

    var title = $('myfood-form-title');
    if (title) { title.textContent = editingId ? '食品を編集' : '新しい食品'; }

    if (editingId) {
      var f = S.getMyFood(editingId);
      if ($('mf-name')) { $('mf-name').value = (f && f.name) || ''; }
      if ($('mf-unit')) { $('mf-unit').value = (f && f.unitLabel) || ''; }
      FIELDS.forEach(function (fd) {
        var el = $(fd.id);
        if (!el) { return; }
        var v = f ? f[fd.key] : null;
        el.value = (typeof v === 'number' && isFinite(v)) ? String(v) : '';
      });
    } else {
      if ($('mf-name')) { $('mf-name').value = ''; }
      if ($('mf-unit')) { $('mf-unit').value = ''; }
      FIELDS.forEach(function (fd) { if ($(fd.id)) { $(fd.id).value = ''; } });
    }

    var del = $('btn-myfood-delete');
    if (del) { del.hidden = !editingId; }

    window.scrollTo(0, 0);
  }

  function closeForm() {
    editingId = null;
    showError(null);
    var form = $('myfood-form');
    if (form) { form.hidden = true; }
  }

  function readForm() {
    var errors = [];
    var out = {};

    var name = ($('mf-name') && $('mf-name').value) ? $('mf-name').value.trim() : '';
    if (!name) { errors.push('食品名を入力してください。'); }
    out.name = name.slice(0, 60);
    out.unitLabel = ($('mf-unit') && $('mf-unit').value) ? $('mf-unit').value.trim().slice(0, 30) : '';

    FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { return; }
      var raw = (el.value || '').trim();
      if (raw === '') {
        if (f.required) { errors.push(f.label + 'を入力してください。'); }
        else { out[f.key] = null; }
        return;
      }
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

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('myfood-error');
    if (!box) { return; }
    if (!messages || !messages.length) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = messages.join(' ');
    window.scrollTo(0, 0);
  }

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.errors.length) { showError(r.errors); return; }

    var entry = r.values;
    if (editingId) {
      entry.id = editingId;
      var old = S.getMyFood(editingId);
      entry.useCount = (old && old.useCount) || 0;
    } else {
      entry.useCount = 0;
    }

    var res = S.saveMyFood(entry);
    if (!res.ok) { showError([res.error]); return; }

    closeForm();
    render();
  }

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この食品を削除します。よろしいですか？')) { return; }
    var res = S.deleteMyFood(editingId);
    if (!res.ok) { showError([res.error]); return; }
    closeForm();
    render();
  }

  function onListClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-food-edit')) {
        openForm(t.getAttribute('data-food-edit'));
        return;
      }
      t = t.parentNode;
    }
  }

  /* ---------- 初期化 ---------- */

  function open() {
    closeForm();
    render();
    if (App.showScreen) { App.showScreen('myfoods'); }
  }

  function init() {
    var form = $('myfood-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var newBtn = $('btn-myfood-new');
    if (newBtn) { newBtn.addEventListener('click', function () { openForm(); }); }

    var cancel = $('btn-myfood-cancel');
    if (cancel) { cancel.addEventListener('click', closeForm); }

    var del = $('btn-myfood-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var list = $('myfood-list');
    if (list) { list.addEventListener('click', onListClick); }

    render();
  }

  return {
    init:   init,
    open:   open,
    render: render
  };
})();
