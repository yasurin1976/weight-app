/* ============================================================
   views/basket.js  —  まとめて記録
   ------------------------------------------------------------
   1食に何品も食べるのが普通なので、
   マイ食品を一覧から選び、それぞれの個数を決めて一括登録します。

   【保存される形】
   選んだ品ごとに1件ずつ、従来と同じ食事の記録として保存します。
   1件にまとめてしまうと、あとで1品だけ直すことができなくなるためです。
   個数は既存の qty / unitKcal をそのまま使います。

   合計と「登録後の残り」を先に見せるので、
   登録してから超過に気づく、ということが起きません。
   ============================================================ */

var App = App || {};

App.Basket = (function () {
  'use strict';

  var S  = App.Storage;
  var C  = App.Calc;
  var LB = App.Labels;

  /* { マイ食品のid : 個数 } */
  var counts = {};
  var mealType = 'breakfast';

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el) { el.textContent = t; } }

  /* ---------- 画面を開く ---------- */

  function open() {
    counts = {};
    showError(null);

    if ($('bk-date')) { $('bk-date').value = C.todayStr(); }
    setType(App.Meal.guessType());

    render();
    if (App.showScreen) { App.showScreen('basket'); }
  }

  function setType(t) {
    mealType = t;
    var g = $('bk-type-group');
    if (!g) { return; }
    Array.prototype.forEach.call(g.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-type') === mealType);
    });
  }

  /* ---------- 一覧の描画 ---------- */

  function render() {
    var list  = $('bk-list');
    var empty = $('bk-empty');
    if (!list) { return; }

    var foods = S.listMyFoods();
    list.innerHTML = '';

    if (empty) { empty.hidden = foods.length > 0; }
    if ($('bk-total-box')) { $('bk-total-box').hidden = !foods.length; }

    foods.forEach(function (f) {
      list.appendChild(row(f));
    });

    renderTotal();
  }

  function row(f) {
    var n = counts[f.id] || 0;

    var wrap = document.createElement('div');
    wrap.className = 'bk-item' + (n > 0 ? ' is-on' : '');

    var info = document.createElement('div');
    info.className = 'bk-info';

    var name = document.createElement('div');
    name.className = 'bk-name';
    name.textContent = f.name;

    var sub = document.createElement('div');
    sub.className = 'bk-sub';
    var unit = (typeof f.kcal === 'number') ? f.kcal : null;
    sub.textContent = (unit === null ? '-' : unit) + ' kcal'
                    + (f.unitLabel ? '／' + f.unitLabel : '')
                    + (n > 1 && unit !== null ? '　→ ' + (unit * n) + ' kcal' : '');

    info.appendChild(name);
    info.appendChild(sub);

    var qty = document.createElement('div');
    qty.className = 'bk-qty';

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.disabled = (n <= 0);
    minus.setAttribute('data-minus', f.id);
    minus.setAttribute('aria-label', f.name + 'を減らす');

    var count = document.createElement('div');
    count.className = 'bk-count' + (n === 0 ? ' is-zero' : '');
    count.textContent = String(n);

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '＋';
    plus.disabled = (typeof f.kcal !== 'number');
    plus.setAttribute('data-plus', f.id);
    plus.setAttribute('aria-label', f.name + 'を増やす');

    qty.appendChild(minus);
    qty.appendChild(count);
    qty.appendChild(plus);

    wrap.appendChild(info);
    wrap.appendChild(qty);
    return wrap;
  }

  /* ---------- 合計と、登録後の残り ---------- */

  function totalKcal() {
    var sum = 0;
    S.listMyFoods().forEach(function (f) {
      var n = counts[f.id] || 0;
      if (n > 0 && typeof f.kcal === 'number') { sum += f.kcal * n; }
    });
    return Math.round(sum);
  }

  function renderTotal() {
    var total = totalKcal();
    setText('bk-total', total.toLocaleString('ja-JP') + ' kcal');

    /* 登録したあと、今日あとどれだけ食べられるか */
    var el = $('bk-remain');
    if (!el) { return; }

    var date = ($('bk-date') && $('bk-date').value) ? $('bk-date').value : C.todayStr();
    var settings = S.getSettings();
    var data = {
      body: S.listBody(), meals: S.listMeals(), steps: S.listSteps(),
      strength: S.listStrength(), cardio: S.listCardio()
    };
    var a = C.allowanceForDate(date, settings, data);

    if (a.allowance === null) { el.textContent = ''; return; }
    if (total === 0) {
      el.textContent = '今日あと食べられる ' + a.remaining.toLocaleString('ja-JP') + ' kcal';
      el.classList.remove('val-over', 'val-under');
      return;
    }
    var after = a.remaining - total;
    el.textContent = '登録すると残り ' + LB.signed(after) + ' kcal になります';
    LB.applyTone(el, after);
  }

  /* ---------- 操作 ---------- */

  function bump(id, d) {
    var n = (counts[id] || 0) + d;
    if (n < 0)  { n = 0; }
    if (n > 99) { n = 99; }
    if (n === 0) { delete counts[id]; } else { counts[id] = n; }
    render();
  }

  function onListClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute) {
        var plus  = t.getAttribute('data-plus');
        if (plus)  { bump(plus, 1);   return; }
        var minus = t.getAttribute('data-minus');
        if (minus) { bump(minus, -1); return; }
      }
      t = t.parentNode;
    }
  }

  function onTypeClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-type')) {
        setType(t.getAttribute('data-type'));
        return;
      }
      t = t.parentNode;
    }
  }

  function showError(messages) {
    var box = $('basket-error');
    if (!box) { return; }
    if (!messages || !messages.length) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = messages.join(' ');
    window.scrollTo(0, 0);
  }

  /* ---------- 登録 ---------- */

  function onSave() {
    var date = ($('bk-date') && $('bk-date').value) ? $('bk-date').value.trim() : '';
    if (!date)                 { showError(['日付を入力してください。']); return; }
    if (date > C.todayStr())   { showError(['日付に未来の日付は入力できません。']); return; }

    var foods = S.listMyFoods().filter(function (f) { return (counts[f.id] || 0) > 0; });
    if (!foods.length) { showError(['食べたものを1つ以上選んでください。']); return; }

    showError(null);

    /* 1品＝1件で保存する。まとめて1件にすると、
       あとで1品だけ直したいときに直せなくなるため。 */
    var failed = [];
    foods.forEach(function (f) {
      var n = counts[f.id];
      var res = S.saveMeal({
        date:     date,
        mealType: mealType,
        name:     f.name,
        kcal:     Math.round(f.kcal * n),
        protein:  (typeof f.protein === 'number') ? C.snapToStep(f.protein * n, 0.1) : null,
        fat:      (typeof f.fat === 'number')     ? C.snapToStep(f.fat * n, 0.1)     : null,
        carb:     (typeof f.carb === 'number')    ? C.snapToStep(f.carb * n, 0.1)    : null,
        memo:     '',
        qty:      n,
        unitKcal: f.kcal,
        input:    S.inputMeta('manual')
      });
      if (res && res.ok) { S.touchMyFood(f.id); }
      else { failed.push(f.name); }
    });

    if (failed.length) {
      showError(['保存できなかったものがあります：' + failed.join('、')]);
      return;
    }

    counts = {};
    if (App.History && App.History.render) { App.History.goToday(); }
    if (App.Home && App.Home.refresh)      { App.Home.refresh(); }
    if (App.showScreen)                    { App.showScreen('record'); }
  }

  function onOther() { App.Meal.open(); }

  function onCancel() {
    counts = {};
    showError(null);
    if (App.showScreen) { App.showScreen('record'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var list = $('bk-list');
    if (list) { list.addEventListener('click', onListClick); }

    var g = $('bk-type-group');
    if (g) { g.addEventListener('click', onTypeClick); }

    var d = $('bk-date');
    if (d) { d.addEventListener('change', renderTotal); }

    var save = $('btn-basket-save');
    if (save) { save.addEventListener('click', onSave); }

    var other = $('btn-basket-other');
    if (other) { other.addEventListener('click', onOther); }

    var cancel = $('btn-basket-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init: init,
    open: open
  };
})();
