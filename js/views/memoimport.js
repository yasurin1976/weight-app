/* ============================================================
   views/memoimport.js  —  筋トレをメモから一括記録
   ------------------------------------------------------------
   流れ：
     メモを貼る → 読み取る → 一覧で確認（回数の修正・行の削除）→ 保存

   読み取り（文字の解釈）は js/memo.js。
   ここは画面と、確認後の保存だけを担当します。

   【守っていること】
   ・読み取っただけでは保存しません。
   ・保存される形は、筋トレ画面で1件ずつ保存したものと同じです。
   ・回数が空の行は保存しません（警告を出して止めます）。
   ============================================================ */

var App = App || {};

App.MemoImport = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  var rows = [];        /* 確認画面に出している行 */
  var lastText = '';

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el) { el.textContent = t; } }

  /* ---------- 画面 ---------- */

  function open() {
    rows = [];
    showError(null);
    step('paste');
    if ($('memo-text')) { $('memo-text').value = lastText; }
    if (App.showScreen) { App.showScreen('memo'); }
  }

  function step(which) {
    var a = $('memo-step-paste'), b = $('memo-step-confirm');
    if (a) { a.hidden = (which !== 'paste'); }
    if (b) { b.hidden = (which !== 'confirm'); }
    window.scrollTo(0, 0);
  }

  /* ---------- 読み取る ---------- */

  function onParse() {
    var text = ($('memo-text') && $('memo-text').value) ? $('memo-text').value : '';
    lastText = text;
    if (!text.trim()) { showError(['メモを貼り付けてください。'], 'paste'); return; }

    var r = App.Memo.parse(text, C.todayStr());
    if (!r.rows.length) {
      showError(['種目・重量・回数の組を読み取れませんでした。「種目名 → 150LBS → 10+10+10回」の形になっているか確認してください。'], 'paste');
      return;
    }
    showError(null);

    rows = r.rows.map(function (x, i) {
      return { id: i, exercise: x.exercise, weight: x.weight, unit: x.unit, perHand: !!x.perHand,
               reps: x.reps ? x.reps.slice() : null,
               origReps: x.reps ? x.reps.join('+') : '',   /* 人が直したかの判定用 */
               line: x.line, removed: false };
    });

    if ($('memo-date')) { $('memo-date').value = r.date || C.todayStr(); }
    setText('memo-date-note', r.date
      ? 'メモの「' + r.date.slice(5).replace('-', '/') + '」を日付にしました。違えば直してください。'
      : 'メモに日付が無かったので今日を入れています。');

    renderNote(r);
    renderList();
    renderUnknown(r.unknown);
    step('confirm');
  }

  function renderNote(r) {
    var box = $('memo-note');
    if (!box) { return; }
    var missing = r.rows.filter(function (x) { return !x.reps; }).length;
    var lines = [];
    lines.push('<p class="scan-note-head">' + r.rows.length + '件を読み取りました。内容を確認してください。</p>');
    if (missing) {
      lines.push('<p class="scan-note-warn">回数が書かれていない行が ' + missing + ' 件あります。回数を入れるか、×で外してください。</p>');
    }
    if (r.unknown.length) {
      lines.push('<p class="scan-note-warn">読み取れなかった行が ' + r.unknown.length + ' 件あります（下に表示）。</p>');
    }
    box.innerHTML = lines.join('');
    box.hidden = false;
  }

  function weightLabel(w, u, perHand) {
    if (typeof w !== 'number') { return '自重'; }
    return perHand ? ('左右 ' + w + ' ' + u + '（計 ' + (w * 2) + ' ' + u + '）') : (w + ' ' + u);
  }

  function repsStr(reps) { return reps ? reps.join('+') : ''; }

  function renderList() {
    var list = $('memo-list');
    if (!list) { return; }
    list.innerHTML = '';

    rows.forEach(function (x) {
      if (x.removed) { return; }
      var row = document.createElement('div');
      row.className = 'memo-row' + (x.reps ? '' : ' is-warn');
      row.setAttribute('data-row', String(x.id));

      var info = document.createElement('div');
      var ex = document.createElement('div'); ex.className = 'memo-ex'; ex.textContent = x.exercise;
      var w  = document.createElement('div'); w.className = 'memo-w';  w.textContent = weightLabel(x.weight, x.unit, x.perHand);
      info.appendChild(ex); info.appendChild(w);

      var right = document.createElement('div');
      right.className = 'memo-reps';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.value = repsStr(x.reps);
      inp.placeholder = '回数';
      inp.setAttribute('data-reps', String(x.id));
      inp.setAttribute('aria-label', x.exercise + 'の回数');
      var u = document.createElement('span'); u.className = 'u'; u.textContent = '回';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'memo-del'; del.textContent = '×';
      del.setAttribute('data-del', String(x.id));
      del.setAttribute('aria-label', x.exercise + 'を外す');
      right.appendChild(inp); right.appendChild(u); right.appendChild(del);

      row.appendChild(info);
      row.appendChild(right);

      if (!x.reps) {
        var warn = document.createElement('div');
        warn.className = 'memo-warn';
        warn.textContent = '回数が未入力です（例：10+10+10）';
        row.appendChild(warn);
      }
      list.appendChild(row);
    });
  }

  function renderUnknown(unknown) {
    var box = $('memo-unknown-box'), list = $('memo-unknown');
    if (!box || !list) { return; }
    list.innerHTML = '';
    box.hidden = !unknown.length;
    unknown.forEach(function (l) {
      var d = document.createElement('div');
      d.className = 'memo-unknown-line';
      d.textContent = l;
      list.appendChild(d);
    });
  }

  /* ---------- 操作 ---------- */

  function onListClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-del')) {
        var id = Number(t.getAttribute('data-del'));
        rows.forEach(function (x) { if (x.id === id) { x.removed = true; } });
        renderList();
        return;
      }
      t = t.parentNode;
    }
  }

  function onListInput(ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || !t.getAttribute('data-reps')) { return; }
    var id = Number(t.getAttribute('data-reps'));
    var reps = App.Memo.parseReps(t.value.trim() + (/回|[+＋,、]/.test(t.value) ? '' : '回'));
    rows.forEach(function (x) {
      if (x.id === id) {
        x.reps = reps;
        var row = t.closest ? t.closest('.memo-row') : null;
        if (row) { row.classList.toggle('is-warn', !reps); }
      }
    });
  }

  function showError(messages, where) {
    var box = $('memo-error');
    if (!box) { return; }
    if (!messages || !messages.length) { box.hidden = true; box.textContent = ''; return; }
    /* 貼り付け段階のエラーは、貼り付け側に出す */
    if (where === 'paste') {
      window.alert(messages.join(' '));
      return;
    }
    box.hidden = false;
    box.textContent = messages.join(' ');
    box.scrollIntoView({ block: 'center' });
  }

  /* ---------- 保存 ---------- */

  function onSave() {
    var date = ($('memo-date') && $('memo-date').value) ? $('memo-date').value.trim() : '';
    if (!date)               { showError(['日付を入力してください。']); return; }
    if (date > C.todayStr()) { showError(['日付に未来の日付は入力できません。']); return; }

    var live = rows.filter(function (x) { return !x.removed; });
    if (!live.length) { showError(['保存する行がありません。']); return; }

    var missing = live.filter(function (x) { return !x.reps || !x.reps.length; });
    if (missing.length) {
      showError(['回数が入っていない行があります：' + missing.map(function (x) {
        return x.exercise + ' ' + weightLabel(x.weight, x.unit, x.perHand);
      }).join('、') + '。回数を入れるか、×で外してください。']);
      return;
    }
    showError(null);

    var failed = [];
    live.forEach(function (x) {
      var reps = x.reps;
      var entry = {
        date:      date,
        exercise:  x.exercise,
        weight:    (typeof x.weight === 'number') ? x.weight : null,
        unit:      x.unit,
        perHand:   (typeof x.weight === 'number') ? !!x.perHand : false,
        reps:      reps,
        setCount:  reps.length,
        totalReps: reps.reduce(function (a, b) { return a + b; }, 0),
        rawText:   reps.join('+').slice(0, 100),
        durationMin:        C.strengthMinutesFromReps(reps),
        durationEstimated:  true,
        calculationVersion: C.VERSION,
        memo:      '',
        input:     S.inputMeta('text', { edited: reps.join('+') !== x.origReps })
      };
      var res = S.saveStrength(entry);
      if (!res || !res.ok) { failed.push(x.exercise); }
    });

    if (failed.length) {
      showError(['保存できなかったものがあります：' + failed.join('、')]);
      return;
    }

    lastText = '';
    rows = [];
    if (App.History && App.History.render) { App.History.goToday(); }
    if (App.Home && App.Home.refresh)      { App.Home.refresh(); }
    if (App.showScreen)                    { App.showScreen('record'); }
  }

  function onBack() { showError(null); step('paste'); }

  function onCancel() {
    rows = [];
    showError(null);
    if (App.showScreen) { App.showScreen('record'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var b;
    b = $('btn-strength-memo'); if (b) { b.addEventListener('click', open); }
    b = $('btn-memo-parse');    if (b) { b.addEventListener('click', onParse); }
    b = $('btn-memo-save');     if (b) { b.addEventListener('click', onSave); }
    b = $('btn-memo-back');     if (b) { b.addEventListener('click', onBack); }
    b = $('btn-memo-cancel');   if (b) { b.addEventListener('click', onCancel); }
    b = $('btn-memo-cancel2');  if (b) { b.addEventListener('click', onCancel); }

    var list = $('memo-list');
    if (list) {
      list.addEventListener('click', onListClick);
      list.addEventListener('input', onListInput);
    }
  }

  return {
    init: init,
    open: open
  };
})();
