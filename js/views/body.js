/* ============================================================
   views/body.js  —  体組成の記録・編集・削除
   ------------------------------------------------------------
   必須は「測定日・測定時刻・体重」の3つ。
   それ以外は体組成計に表示されている値だけ入力します。
   画面に出ていない値をアプリ側で計算して埋めることはしません。
   ============================================================ */

var App = App || {};

App.Body = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  /* 入力欄と保存項目の対応。
     step は入力できる刻み。stepLabel はエラー文に出す表記。
     任意項目は required を付けていません。 */
  var FIELDS = [
    { id: 'b-weight',   key: 'weightKg',          label: '体重',           min: 30,  max: 200,  step: 0.1, stepLabel: '0.1kg', required: true },
    { id: 'b-bodyfat',  key: 'bodyFatPct',        label: '体脂肪率',       min: 3,   max: 60,   step: 0.1, stepLabel: '0.1%' },
    { id: 'b-fatmass',  key: 'fatMassKg',         label: '体脂肪量',       min: 0,   max: 100,  step: 0.1, stepLabel: '0.1kg' },
    { id: 'b-visceral', key: 'visceralLevel',     label: '内臓脂肪レベル', min: 0.5, max: 30,   step: 0.5, stepLabel: '0.5' },
    { id: 'b-smpct',    key: 'skeletalMusclePct', label: '骨格筋率',       min: 5,   max: 60,   step: 0.1, stepLabel: '0.1%' },
    { id: 'b-smkg',     key: 'skeletalMuscleKg',  label: '骨格筋量',       min: 0,   max: 100,  step: 0.1, stepLabel: '0.1kg' },
    { id: 'b-bmr',      key: 'bmrKcal',           label: '基礎代謝',       min: 500, max: 3000, step: 1,   stepLabel: '1kcal' },
    { id: 'b-bmi',      key: 'bmi',               label: 'BMI',            min: 10,  max: 50,   step: 0.1, stepLabel: '0.1' }
  ];

  var editingId = null;   // 編集中の記録ID。新規なら null
  var scan      = null;   // AI読み取りから来たときだけ入る。{model, analyzedAt, values}

  function $(id) { return document.getElementById(id); }

  /* ---------- 画面を開く ---------- */

  /* id を渡すと編集、渡さなければ新規 */
  function open(id) {
    editingId = id || null;
    clearScan();
    showError(null);

    var title = $('screen-body');
    if (title) {
      title.setAttribute('data-title', editingId ? '体組成を編集' : '体組成を記録');
    }

    if (editingId) {
      fillFromEntry(S.getBodyEntry(editingId));
    } else {
      clearForm();
    }

    var del = $('btn-body-delete');
    if (del) { del.hidden = !editingId; }

    if (App.showScreen) { App.showScreen('body'); }
  }

  function clearForm() {
    if ($('b-date')) { $('b-date').value = C.todayStr(); }
    if ($('b-time')) { $('b-time').value = C.nowTimeStr(); }
    FIELDS.forEach(function (f) { if ($(f.id)) { $(f.id).value = ''; } });
    if ($('b-memo')) { $('b-memo').value = ''; }
  }

  /* ============================================================
     AI読み取りからの確認画面
     ------------------------------------------------------------
     読み取った値を入力欄に入れるだけで、保存はしません。
     人が確認して「登録する」を押したときに、はじめて保存します。

     読み取れなかった項目は空欄のままにします。
     体重と体脂肪率から体脂肪量を計算する、といった補完はしません。
     ============================================================ */

  function openFromScan(result) {
    editingId = null;
    showError(null);

    scan = {
      model:      result.model || null,
      analyzedAt: result.analyzedAt || new Date().toISOString(),
      values:     {}
    };

    clearForm();

    var f = result.fields || {};

    /* 日付と時刻。画面に写っていなければ今日・現在時刻を初期値にする */
    if ($('b-date')) { $('b-date').value = f.date || C.todayStr(); }
    if ($('b-time')) { $('b-time').value = f.time || C.nowTimeStr(); }

    var read = [];
    var missing = [];

    FIELDS.forEach(function (fd) {
      var el = $(fd.id);
      if (!el) { return; }
      var v = f[fd.key];
      if (typeof v === 'number' && isFinite(v)) {
        el.value = String(v);
        el.classList.add('is-ai');
        scan.values[fd.key] = v;
        read.push(fd.label);
      } else {
        el.value = '';
        el.classList.remove('is-ai');
        missing.push(fd.label);
      }
    });

    renderScanBanner(read, missing, f, result.rounded || []);

    var del = $('btn-body-delete');
    if (del) { del.hidden = true; }

    var title = $('screen-body');
    if (title) { title.setAttribute('data-title', '読み取り結果の確認'); }

    var save = $('btn-body-save');
    if (save) { save.textContent = '確認して登録する'; }

    if (App.showScreen) { App.showScreen('body'); }
    window.scrollTo(0, 0);
  }

  function labelOf(key) {
    var i;
    for (i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].key === key) { return FIELDS[i].label; }
    }
    return key;
  }

  function renderScanBanner(read, missing, f, rounded) {
    var box = $('body-scan-note');
    if (!box) { return; }
    box.hidden = false;

    var lines = [];
    lines.push('<p class="scan-note-head">AIが読み取りました。数値を確認してください。</p>');
    lines.push('<p class="scan-note-sub">色のついた欄がAIの読み取り結果です。間違いがあればその場で直せます。</p>');

    if (!f.date) {
      lines.push('<p class="scan-note-warn">測定日が画面から読み取れなかったため、今日の日付を入れています。日付が違う場合は直してください。</p>');
    } else if (f.dateFromMonthDay) {
      /* オムロンの画面には年が出ないので、こちらで補っています。
         年をまたいだ記録を入れるときに間違いやすいので、必ず知らせます。 */
      lines.push('<p class="scan-note-warn">画面に年が出ていないため、年は「' + f.date.slice(0, 4) + '年」として入れています。違う場合は直してください。</p>');
    }

    if (!f.time) { lines.push('<p class="scan-note-warn">測定時刻が読み取れなかったため、現在時刻を入れています。</p>'); }

    if (rounded && rounded.length) {
      var r = rounded.map(function (x) {
        return labelOf(x.key) + ' ' + x.from + ' → ' + x.to;
      });
      lines.push('<p class="scan-note-warn">このアプリで扱える細かさに合わせて丸めました：' + r.join('、') + '</p>');
    }

    if (missing.length) {
      lines.push('<p class="scan-note-warn">読み取れなかった項目は空欄のままです：' + missing.join('・') + '</p>');
    }

    box.innerHTML = lines.join('');
  }

  function clearScan() {
    scan = null;
    var box = $('body-scan-note');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    FIELDS.forEach(function (fd) {
      var el = $(fd.id);
      if (el) { el.classList.remove('is-ai'); }
    });
    var title = $('screen-body');
    if (title) { title.setAttribute('data-title', '体組成を記録'); }
    var save = $('btn-body-save');
    if (save) { save.textContent = '保存する'; }
  }

  /* 読み取った値が人の手で直されたかどうか */
  function wasEdited(values) {
    if (!scan) { return false; }
    var k;
    for (k in scan.values) {
      if (!Object.prototype.hasOwnProperty.call(scan.values, k)) { continue; }
      if (values[k] !== scan.values[k]) { return true; }
    }
    /* 空欄だったところに人が書き足した場合も「直した」とみなす */
    var i;
    for (i = 0; i < FIELDS.length; i++) {
      var key = FIELDS[i].key;
      if (scan.values[key] === undefined && values[key] !== null && values[key] !== undefined) { return true; }
    }
    return false;
  }

  function fillFromEntry(e) {
    if (!e) { clearForm(); return; }
    if ($('b-date')) { $('b-date').value = e.date || ''; }
    if ($('b-time')) { $('b-time').value = e.time || ''; }
    FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { return; }
      var v = e[f.key];
      el.value = (typeof v === 'number' && isFinite(v)) ? String(v) : '';
    });
    if ($('b-memo')) { $('b-memo').value = e.memo || ''; }
  }

  /* ---------- 入力の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    var date = ($('b-date') && $('b-date').value) ? $('b-date').value.trim() : '';
    var time = ($('b-time') && $('b-time').value) ? $('b-time').value.trim() : '';

    if (!date) {
      errors.push('測定日を入力してください。');
    } else if (date > C.todayStr()) {
      errors.push('測定日に未来の日付は入力できません。');
    }
    if (!time) { errors.push('測定時刻を入力してください。'); }

    out.date = date;
    out.time = time;

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
      if (!isFinite(n)) {
        errors.push(f.label + 'には数字を入力してください。');
        return;
      }
      if (n < f.min || n > f.max) {
        errors.push(f.label + 'は' + f.min + '〜' + f.max + 'の範囲で入力してください。');
        return;
      }
      /* 入力できる刻みかどうか（小数の誤差を考慮して判定） */
      if (!C.isMultipleOf(n, f.step)) {
        errors.push(f.label + 'は' + f.stepLabel + '刻みで入力してください。');
        return;
      }
      /* 誤差の混じった値を保存しないよう、刻みに合わせて整える */
      out[f.key] = C.snapToStep(n, f.step);
    });

    out.memo = ($('b-memo') && $('b-memo').value) ? $('b-memo').value.trim().slice(0, 100) : '';

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('body-error');
    if (!box) { return; }
    if (!messages || !messages.length) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = messages.join(' ');
    window.scrollTo(0, 0);
  }

  /* ---------- 保存 ---------- */

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.errors.length) { showError(r.errors); return; }
    showError(null);

    var entry = r.values;
    if (editingId) { entry.id = editingId; }

    /* どうやって入力したかを記録に残す。
       画像そのものは保存しません（sourceRef は将来クラウドに置いたときの目印）。 */
    if (scan) {
      entry.input = S.inputMeta('screenshot', {
        model:      scan.model,
        analyzedAt: scan.analyzedAt,
        sourceRef:  null,
        edited:     wasEdited(r.values)
      });
    }

    var res = S.saveBodyEntry(entry);
    if (!res.ok) { showError([res.error]); return; }

    editingId = null;
    clearScan();
    afterChange();
  }

  /* ---------- 削除 ---------- */

  function onDelete() {
    if (!editingId) { return; }
    if (!window.confirm('この記録を削除します。よろしいですか？')) { return; }

    var res = S.deleteBodyEntry(editingId);
    if (!res.ok) { showError([res.error]); return; }

    editingId = null;
    afterChange();
  }

  function onCancel() {
    editingId = null;
    clearScan();
    showError(null);
    if (App.showScreen) { App.showScreen('record'); }
  }

  /* 保存・削除の後は履歴に戻り、ホームの表示も更新する */
  function afterChange() {
    if (App.History && App.History.render) { App.History.goToday(); }
    if (App.Home && App.Home.refresh)      { App.Home.refresh(); }
    if (App.showScreen)                    { App.showScreen('record'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var form = $('body-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var del = $('btn-body-delete');
    if (del) { del.addEventListener('click', onDelete); }

    var cancel = $('btn-body-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init: init,
    open: open,
    openFromScan: openFromScan
  };
})();
