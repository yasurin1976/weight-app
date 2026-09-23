/* ============================================================
   views/scan.js  —  オムロンのスクリーンショットを読み取る画面
   ------------------------------------------------------------
   流れ：

     写真を選ぶ → 読み取り中 → 確認画面（体組成の入力欄）→ 登録

   確認画面は、これまで使ってきた「体組成を記録」の画面をそのまま使います。
   新しく別の入力欄を作らないので、保存される形も、入力の決まり（刻みや
   範囲の確認）も、これまでとまったく同じです。

   【守っていること】
   ・AIの読み取り結果をそのまま保存しません。必ず確認画面を挟みます。
   ・画面に写っていない値は空欄のままにします。こちらで作りません。
   ・読み取りに失敗しても、手入力に進めるようにしています。
   ============================================================ */

var App = App || {};

App.Scan = (function () {
  'use strict';

  var busy = false;

  function $(id) { return document.getElementById(id); }

  /* ---------- 画面の状態 ---------- */

  function setState(state, message) {
    var idle    = $('scan-idle');
    var loading = $('scan-loading');
    var error   = $('scan-error');

    if (idle)    { idle.hidden    = (state !== 'idle'); }
    if (loading) { loading.hidden = (state !== 'loading'); }
    if (error)   { error.hidden   = (state !== 'error'); }

    if (state === 'error' && $('scan-error-text')) {
      $('scan-error-text').textContent = message || '読み取りに失敗しました。';
    }
  }

  function open() {
    busy = false;
    setState('idle');
    showSetupNotice();
    if ($('scan-file')) { $('scan-file').value = ''; }
    if (App.showScreen) { App.showScreen('scan'); }
  }

  /* 中継サーバーが未設定なら、先にそれを案内する */
  function showSetupNotice() {
    var box = $('scan-setup');
    var btn = $('btn-scan-pick');
    if (!box) { return; }
    var ready = App.Vision && App.Vision.isConfigured();
    box.hidden = ready;
    if (btn) { btn.disabled = !ready; }
  }

  /* ---------- 写真を選んだとき ---------- */

  function onPick() {
    var input = $('scan-file');
    if (input) { input.click(); }
  }

  function onFile(e) {
    var file = e.target && e.target.files && e.target.files[0];
    if (!file || busy) { return; }

    busy = true;
    setState('loading');

    App.Vision.readBodyImage(file).then(function (result) {
      busy = false;
      setState('idle');
      if ($('scan-file')) { $('scan-file').value = ''; }
      /* 確認画面へ。ここではまだ保存していません */
      App.Body.openFromScan(result);
    }).catch(function (err) {
      busy = false;
      var msg = (err && err.message) ? err.message : '読み取りに失敗しました。';
      if (err && err.notes) { msg += '（' + err.notes + '）'; }
      setState('error', msg);
      if ($('scan-file')) { $('scan-file').value = ''; }
    });
  }

  /* ---------- 失敗したとき ---------- */

  function onRetry() { setState('idle'); }

  function onManual() { App.Body.open(); }

  function onCancel() {
    if (App.showScreen) { App.showScreen('record'); }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var pick = $('btn-scan-pick');
    if (pick) { pick.addEventListener('click', onPick); }

    var file = $('scan-file');
    if (file) { file.addEventListener('change', onFile); }

    var retry = $('btn-scan-retry');
    if (retry) { retry.addEventListener('click', onRetry); }

    var manual = $('btn-scan-manual');
    if (manual) { manual.addEventListener('click', onManual); }

    var cancel = $('btn-scan-cancel');
    if (cancel) { cancel.addEventListener('click', onCancel); }
  }

  return {
    init: init,
    open: open
  };
})();
