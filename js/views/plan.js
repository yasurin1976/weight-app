/* ============================================================
   views/plan.js  —  食べる前の判断
   ------------------------------------------------------------
   これから食べるものを決める前に、食べたらどうなるかを先に見ます。

   ・残り（今日の許容量 − ここまでの摂取）
   ・候補を選ぶと、食べた後の残りと7日累積がどう変わるかを表示
   ・超える場合は、相殺に必要な運動時間も出す
   ・そのまま「食べる」で記録に確定できる
   ============================================================ */

var App = App || {};

App.Plan = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;
  var LB = App.Labels;

  var source = 'myfoods';   /* myfoods / recent */
  var picked = null;        /* 選択中の候補 {name, kcal, protein, fat, carb} */

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

  /* ---------- 画面を開く ---------- */

  function open() {
    picked = null;
    if ($('plan-kcal')) { $('plan-kcal').value = ''; }

    /* マイ食品がまだ無いときは「最近の食事」から始める。
       空のリストを最初に見せないため。 */
    if (!S.listMyFoods().length) { source = 'recent'; }
    var srcBox = $('plan-source');
    if (srcBox) {
      Array.prototype.forEach.call(srcBox.querySelectorAll('.chip'), function (c) {
        c.classList.toggle('is-on', c.getAttribute('data-src') === source);
      });
    }

    renderHeader();
    renderCandidates();
    renderResult();
    if (App.showScreen) { App.showScreen('plan'); }
  }

  function renderHeader() {
    var today = C.todayStr();
    var a = C.allowanceForDate(today, S.getSettings(), bundle());

    if (a.remaining === null) {
      setText('plan-remaining', '--');
      setText('plan-allowance-line', '体重を記録すると計算できます');
      return;
    }
    setText('plan-remaining', a.remaining.toLocaleString('ja-JP'));

    var line = '許容 ' + a.allowance.toLocaleString('ja-JP')
             + '（目安 ' + a.baseTarget.toLocaleString('ja-JP');
    if (a.addon.total > 0) { line += ' ＋ ' + LB.L.exerciseAddon + ' ' + a.addon.total; }
    line += '）　摂取 ' + a.intake.kcal.toLocaleString('ja-JP');
    setText('plan-allowance-line', line);
  }

  /* ---------- 候補 ---------- */

  function candidates() {
    if (source === 'myfoods') {
      return S.listMyFoods()
        .filter(function (f) { return typeof f.kcal === 'number'; })
        .slice(0, 12)
        .map(function (f) {
          return { name: f.name + (f.unitLabel ? '（' + f.unitLabel + '）' : ''),
                   plainName: f.name,
                   kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb };
        });
    }

    /* 最近の食事。同じ料理名は1件にまとめ、新しい順に */
    var seen = {};
    var out = [];
    var all = S.listMeals();
    for (var i = all.length - 1; i >= 0 && out.length < 12; i--) {
      var m = all[i];
      if (!m || typeof m.kcal !== 'number' || !m.name) { continue; }
      if (seen[m.name]) { continue; }
      seen[m.name] = true;
      out.push({ name: m.name, plainName: m.name, kcal: m.kcal,
                 protein: m.protein, fat: m.fat, carb: m.carb });
    }
    return out;
  }

  function renderCandidates() {
    var wrap = $('plan-candidates');
    var empty = $('plan-empty');
    if (!wrap) { return; }

    var list = candidates();
    wrap.innerHTML = '';
    if (empty) { empty.hidden = list.length > 0; }

    list.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-item';
      b.setAttribute('data-cand', String(i));

      var n = document.createElement('span');
      n.className = 'pick-name';
      n.textContent = c.name;

      var k = document.createElement('span');
      k.className = 'pick-kcal';
      k.textContent = c.kcal + 'kcal';

      b.appendChild(n);
      b.appendChild(k);
      wrap.appendChild(b);
    });

    wrap._list = list;
  }

  /* ---------- 結果の試算 ---------- */

  function simulate(kcal) {
    var settings = S.getSettings();
    var data = bundle();
    var today = C.todayStr();

    var a = C.allowanceForDate(today, settings, data);
    if (a.remaining === null) { return null; }

    var afterRemaining = C.round(a.remaining - kcal, 0);

    /* 7日累積は「今日の乖離が確定したら」どうなるかで見る */
    var cum = C.cumulativeDeviation(today, settings, data, 7);
    var todayDevNow = a.deviation;                    /* いまの時点の今日の乖離 */
    var todayDevAfter = C.round((a.intake.kcal + kcal) - a.allowance, 0);   /* 食べすぎ＝＋ */
    var base = (cum.total === null ? 0 : cum.total) - (todayDevNow === null ? 0 : todayDevNow);
    var cumAfter = C.round(base + todayDevAfter, 0);

    var overBy = afterRemaining < 0 ? Math.abs(afterRemaining) : 0;
    var offsetMin = overBy > 0 ? C.toExerciseMinutes(overBy, settings, data, today) : null;

    return {
      kcal: kcal,
      afterRemaining: afterRemaining,
      cumAfter: cumAfter,
      cumNow: cum.total,
      offsetMin: offsetMin
    };
  }

  function renderResult() {
    var box = $('plan-result');
    if (!box) { return; }

    var kcal = pickedKcal();
    if (kcal === null) { box.hidden = true; box.innerHTML = ''; return; }

    var r = simulate(kcal);
    if (!r) { box.hidden = true; return; }

    var over = r.afterRemaining < 0;
    box.hidden = false;
    box.className = 'sim ' + (over ? 'sim-over' : 'sim-ok');

    var html = '';
    html += '<div class="sim-head">' + (picked ? escapeHtml(picked.name) : '入力した量')
          + '<span class="sim-kcal">' + kcal.toLocaleString('ja-JP') + ' kcal</span></div>';
    html += '<div class="sim-row"><span>食べた後の残り</span><b class="' + (over ? 'bad' : 'good') + '">'
          + LB.signed(r.afterRemaining) + ' kcal</b></div>';
    html += '<div class="sim-row"><span>7日累積</span><b class="' + (r.cumAfter > 0 ? 'bad' : 'good') + '">'
          + LB.signedUnit(r.cumAfter) + '</b></div>';
    if (over && r.offsetMin) {
      html += '<div class="sim-note">歩行・トレッドミル約' + r.offsetMin + '分で相殺できます</div>';
    }
    box.innerHTML = html;

    var eat = $('btn-plan-eat');
    if (eat) { eat.hidden = false; }
  }

  function pickedKcal() {
    if (picked && typeof picked.kcal === 'number') { return picked.kcal; }
    var raw = ($('plan-kcal') && $('plan-kcal').value) ? $('plan-kcal').value.trim() : '';
    if (raw === '') { return null; }
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || n > 5000) { return null; }
    return Math.round(n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 記録に確定 ---------- */

  function onEat() {
    var kcal = pickedKcal();
    if (kcal === null) { return; }

    var h = new Date().getHours();
    var type = (h < 10) ? 'breakfast' : (h < 15) ? 'lunch' : (h < 21) ? 'dinner' : 'snack';

    var entry = {
      date:     C.todayStr(),
      mealType: type,
      name:     picked ? (picked.plainName || picked.name) : '食事',
      kcal:     kcal,
      protein:  picked && typeof picked.protein === 'number' ? picked.protein : null,
      fat:      picked && typeof picked.fat === 'number' ? picked.fat : null,
      carb:     picked && typeof picked.carb === 'number' ? picked.carb : null,
      memo:     '',
      input:    S.inputMeta('manual')
    };

    var res = S.saveMeal(entry);
    if (!res.ok) { window.alert(res.error); return; }

    picked = null;
    if ($('plan-kcal')) { $('plan-kcal').value = ''; }

    if (App.Record && App.Record.render) { App.Record.render(true); }
    if (App.Home && App.Home.refresh)    { App.Home.refresh(); }
    if (App.showScreen)                  { App.showScreen('home'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var input = $('plan-kcal');
    if (input) {
      input.addEventListener('input', function () {
        picked = null;
        renderResult();
      });
    }

    var src = $('plan-source');
    if (src) {
      src.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== src) {
          if (t.getAttribute && t.getAttribute('data-src')) {
            source = t.getAttribute('data-src');
            Array.prototype.forEach.call(src.querySelectorAll('.chip'), function (c) {
              c.classList.toggle('is-on', c.getAttribute('data-src') === source);
            });
            renderCandidates();
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var wrap = $('plan-candidates');
    if (wrap) {
      wrap.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== wrap) {
          if (t.getAttribute && t.getAttribute('data-cand') !== null) {
            var idx = Number(t.getAttribute('data-cand'));
            picked = wrap._list ? wrap._list[idx] : null;
            if (picked && $('plan-kcal')) { $('plan-kcal').value = String(picked.kcal); }
            Array.prototype.forEach.call(wrap.querySelectorAll('.pick-item'), function (el) {
              el.classList.toggle('is-on', el === t || el.contains(t));
            });
            renderResult();
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var eat = $('btn-plan-eat');
    if (eat) { eat.addEventListener('click', onEat); }

    var close = $('btn-plan-close');
    if (close) { close.addEventListener('click', function () { App.showScreen('home'); }); }
  }

  return { init: init, open: open };
})();
