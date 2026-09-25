/* ============================================================
   views/meal.js  —  食事の記録・編集・削除
   ------------------------------------------------------------
   1件＝1料理。1食に複数の料理があれば、その数だけ登録します。
   マイ食品から呼び出して入力を省略できます。
   ============================================================ */

var App = App || {};

App.Meal = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var FIELDS = [
    { id: 'm-kcal',    key: 'kcal',    label: 'カロリー', min: 0, max: 5000, step: 1,   stepLabel: '1kcal', required: true },
    { id: 'm-protein', key: 'protein', label: 'P（タンパク質）', min: 0, max: 500, step: 0.1, stepLabel: '0.1g' },
    { id: 'm-fat',     key: 'fat',     label: 'F（脂質）',       min: 0, max: 500, step: 0.1, stepLabel: '0.1g' },
    { id: 'm-carb',    key: 'carb',    label: 'C（炭水化物）',   min: 0, max: 500, step: 0.1, stepLabel: '0.1g' }
  ];

  var editingId = null;
  var mealType  = 'breakfast';

  var TYPE_LABELS = { breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食' };
  function labelOfType(t) { return TYPE_LABELS[t] || '食事'; }

  function $(id) { return document.getElementById(id); }

  /* ---------- 時間帯から区分を推測する ---------- */

  function guessType() {
    var h = new Date().getHours();
    if (h < 10) { return 'breakfast'; }
    if (h < 15) { return 'lunch'; }
    if (h < 21) { return 'dinner'; }
    return 'snack';
  }

  function setType(t) {
    mealType = t;
    var btns = document.querySelectorAll('#m-type-group .seg-btn');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.getAttribute('data-type') === t) { b.classList.add('is-on'); }
      else { b.classList.remove('is-on'); }
    });
  }

  /* ---------- 画面を開く ---------- */

  /* open()                … 新規
     open(id)              … 編集
     open(null, copyFrom)  … 過去の記録を複製して新規 */
  function open(id, copyFrom) {
    editingId = id || null;
    showError(null);
    hidePicker();

    var sec = $('screen-meal');
    if (sec) { sec.setAttribute('data-title', editingId ? '食事を編集' : '食事を記録'); }

    if (editingId) {
      fillFrom(S.getMeal(editingId), false);
    } else if (copyFrom) {
      fillFrom(copyFrom, true);   // 日付は今日にする
    } else {
      clearForm();
    }

    var del = $('btn-meal-delete');
    if (del) { del.hidden = !editingId; }

    var chk = $('m-save-myfood');
    if (chk) { chk.checked = false; }

    if (App.showScreen) { App.showScreen('meal'); }
  }

  function clearForm() {
    if ($('m-date')) { $('m-date').value = C.todayStr(); }
    setType(guessType());
    if ($('m-name')) { $('m-name').value = ''; }
    FIELDS.forEach(function (f) { if ($(f.id)) { $(f.id).value = ''; } });
    if ($('m-memo')) { $('m-memo').value = ''; }
    setDetailOpen(false);
    setQty(1);
  }

  function fillFrom(e, asCopy) {
    if (!e) { clearForm(); return; }
    /* すでにPFCやメモが入っている記録を開くときは、隠れていると気づけないので開く */
    setDetailOpen(!!(e.protein || e.fat || e.carb || e.memo));
    if ($('m-date')) { $('m-date').value = asCopy ? C.todayStr() : (e.date || C.todayStr()); }
    setType(e.mealType || guessType());
    if ($('m-name')) { $('m-name').value = e.name || ''; }
    /* 個数つきで保存された記録は、1個ぶんに戻して表示する。
       古い記録（個数なし）は、そのまま1個ぶんとして扱う。 */
    var q = (typeof e.qty === 'number' && e.qty >= 1) ? Math.round(e.qty) : 1;
    FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { return; }
      var v = e[f.key];
      if (typeof v === 'number' && isFinite(v) && q > 1) {
        v = (f.key === 'kcal') ? Math.round(v / q) : C.snapToStep(v / q, 0.1);
      }
      el.value = (typeof v === 'number' && isFinite(v)) ? String(v) : '';
    });
    setQty(q);
    if ($('m-memo')) { $('m-memo').value = asCopy ? '' : (e.memo || ''); }
  }

  /* ---------- マイ食品の呼び出し ---------- */

  function togglePicker() {
    var box = $('myfood-picker');
    if (!box) { return; }
    if (box.hidden) { renderPicker(); box.hidden = false; }
    else { box.hidden = true; }
  }

  function hidePicker() {
    var box = $('myfood-picker');
    if (box) { box.hidden = true; }
  }

  function renderPicker() {
    var wrap  = $('myfood-picker-list');
    var empty = $('myfood-picker-empty');
    if (!wrap) { return; }

    var foods = S.listMyFoods();
    wrap.innerHTML = '';
    if (empty) { empty.hidden = foods.length > 0; }

    foods.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-item';
      b.setAttribute('data-food', f.id);

      var n = document.createElement('span');
      n.className = 'pick-name';
      n.textContent = f.name + (f.unitLabel ? '（' + f.unitLabel + '）' : '');

      var k = document.createElement('span');
      k.className = 'pick-kcal';
      k.textContent = (typeof f.kcal === 'number' ? f.kcal : '-') + 'kcal';

      b.appendChild(n);
      b.appendChild(k);
      wrap.appendChild(b);
    });
  }

  function onPickerClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-food')) {
        applyMyFood(t.getAttribute('data-food'));
        return;
      }
      t = t.parentNode;
    }
  }

  function applyMyFood(id) {
    var f = S.getMyFood(id);
    if (!f) { return; }
    if ($('m-name')) { $('m-name').value = f.name || ''; }
    FIELDS.forEach(function (fd) {
      var el = $(fd.id);
      if (!el) { return; }
      var v = f[fd.key];
      el.value = (typeof v === 'number' && isFinite(v)) ? String(v) : '';
    });
    setQty(1);
    S.touchMyFood(id);
    hidePicker();
  }

  /* ---------- 入力の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    var date = ($('m-date') && $('m-date').value) ? $('m-date').value.trim() : '';
    if (!date) { errors.push('日付を入力してください。'); }
    else if (date > C.todayStr()) { errors.push('日付に未来の日付は入力できません。'); }
    out.date = date;
    out.mealType = mealType;

    /* 料理名は任意。空なら区分名（朝食・昼食など）を入れる。
       毎日使うものなので、入力の手間はできるだけ減らす。 */
    var name = ($('m-name') && $('m-name').value) ? $('m-name').value.trim() : '';
    if (!name) { name = labelOfType(mealType); }
    out.name = name.slice(0, 60);

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

    out.memo = ($('m-memo') && $('m-memo').value) ? $('m-memo').value.trim().slice(0, 100) : '';

    /* 個数ぶんを掛ける。
       記録に入るのは合計（kcal・PFC）で、内訳として1個ぶんと個数も残す。
       ホーム画面や集計はこれまでどおり kcal を見るだけでよい。 */
    var qty = readQty();
    if (qty === null) {
      errors.push('個数は1〜99の整数で入力してください。');
    } else {
      out.qty = qty;
      out.unitKcal = out.kcal;
      if (qty > 1) {
        if (typeof out.kcal === 'number') { out.kcal = Math.round(out.kcal * qty); }
        ['protein', 'fat', 'carb'].forEach(function (k) {
          if (typeof out[k] === 'number') { out[k] = C.snapToStep(out[k] * qty, 0.1); }
        });
      }
      if (typeof out.kcal === 'number' && out.kcal > 20000) {
        errors.push('合計カロリーが大きすぎます。1個ぶんの値と個数を確認してください。');
      }
    }

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('meal-error');
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

    var res = S.saveMeal(entry);
    if (!res.ok) { showError([res.error]); return; }

    /* マイ食品にも登録する場合 */
    var chk = $('m-save-myfood');
    if (chk && chk.checked) {
      /* マイ食品には合計ではなく「1個ぶん」を登録する。
         次に呼び出したとき、個数を変えるだけで済むようにするため。 */
      var q = (typeof entry.qty === 'number' && entry.qty > 1) ? entry.qty : 1;
      S.saveMyFood({
        name:      entry.name,
        unitLabel: '',
        kcal:      (typeof entry.kcal === 'number') ? Math.round(entry.kcal / q) : entry.kcal,
        protein:   (typeof entry.protein === 'number') ? C.snapToStep(entry.protein / q, 0.1) : entry.protein,
        fat:       (typeof entry.fat === 'number') ? C.snapToStep(entry.fat / q, 0.1) : entry.fat,
        carb:      (typeof entry.carb === 'number') ? C.snapToStep(entry.carb / q, 0.1) : entry.carb,
        useCount:  0
      });
    }

    editingId = null;
    afterChange();
  }

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この記録を削除します。よろしいですか？')) { return; }
    var res = S.deleteMeal(editingId);
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

  /* ---------- 個数 ----------
     入力欄のカロリーは「1個ぶん」。記録には 1個ぶん × 個数 を保存する。
     あとで見返したときに内訳が分かるよう、1個ぶんと個数も一緒に残す。 */

  function readQty() {
    var raw = ($('m-qty') && $('m-qty').value) ? $('m-qty').value.trim() : '';
    var n = Number(raw);
    if (!isFinite(n) || !C.isInteger(n) || n < 1) { return null; }
    if (n > 99) { return null; }
    return n;
  }

  function setQty(n) {
    if ($('m-qty')) { $('m-qty').value = String(n); }
    previewTotal();
  }

  function bumpQty(d) {
    var n = readQty() || 1;
    n = Math.min(99, Math.max(1, n + d));
    setQty(n);
  }

  /* 個数が2以上のときだけ合計を出す。1個なら余計なことを言わない。 */
  function previewTotal() {
    var el = $('m-total-help');
    if (!el) { return; }

    var qty = readQty();
    if (qty === null) { el.textContent = '個数は1〜99の整数で入力してください。'; return; }
    if (qty === 1) { el.textContent = '1個のままなら、そのまま記録されます。'; return; }

    var raw = ($('m-kcal') && $('m-kcal').value) ? $('m-kcal').value.trim() : '';
    var unit = Number(raw);
    if (raw === '' || !isFinite(unit)) { el.textContent = qty + '個ぶんで記録します。'; return; }

    el.innerHTML = unit + ' kcal × ' + qty + '個 = <span class="qty-total">'
                 + Math.round(unit * qty).toLocaleString('ja-JP') + ' kcal</span> として記録します。';
  }

  /* PFC・メモの開閉。既定は閉じたまま。
     毎回使うものではないので、開いた状態を次回に持ち越さない。 */
  function setDetailOpen(open) {
    var box = $('meal-detail-box');
    var btn = $('btn-meal-detail');
    if (box) { box.hidden = !open; }
    if (btn) { btn.textContent = open ? 'PFC・メモを閉じる' : 'PFC・メモを入れる'; }
  }

  function init() {
    var minus = $('m-qty-minus');
    if (minus) { minus.addEventListener('click', function () { bumpQty(-1); }); }
    var plus = $('m-qty-plus');
    if (plus) { plus.addEventListener('click', function () { bumpQty(1); }); }
    var qi = $('m-qty');
    if (qi) { qi.addEventListener('input', previewTotal); }
    var ki = $('m-kcal');
    if (ki) { ki.addEventListener('input', previewTotal); }

    var bk = $('btn-meal-basket');
    if (bk) { bk.addEventListener('click', function () { App.Basket.open(); }); }

    var det = $('btn-meal-detail');
    if (det) {
      det.addEventListener('click', function () {
        var box = $('meal-detail-box');
        setDetailOpen(box ? box.hidden : true);
      });
    }

    var form = $('meal-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var group = $('m-type-group');
    if (group) {
      group.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== group) {
          if (t.getAttribute && t.getAttribute('data-type')) {
            setType(t.getAttribute('data-type'));
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var pick = $('btn-pick-myfood');
    if (pick) { pick.addEventListener('click', togglePicker); }

    var pl = $('myfood-picker-list');
    if (pl) { pl.addEventListener('click', onPickerClick); }

    var del = $('btn-meal-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var cancel = $('btn-meal-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    guessType: guessType,
    init: init,
    open: open
  };
})();
