/* ============================================================
   app.js  —  アプリ全体の起動と画面切り替え
   ------------------------------------------------------------
   ・下部ナビで画面を切り替える
   ・初回起動時に初期設定を保存する
   ・各画面の初期化を呼び出す
   ============================================================ */

var App = App || {};

App.VERSION = '2.2.0 (筋トレ入力を修正)';

(function () {
  'use strict';

  /* 画面の一覧。body は「記録」タブの下にある入力画面です。 */
  var SCREENS = ['home', 'record', 'addmenu', 'plan', 'scan', 'body', 'meal', 'myfoods', 'steps', 'strength', 'cardio', 'trend', 'settings'];

  /* 下部ナビのどのタブを光らせるか */
  var NAV_OF = {
    home: 'home', plan: 'home',
    record: 'record', addmenu: 'record', scan: 'record', body: 'record', meal: 'record',
    myfoods: 'record', steps: 'record', strength: 'record', cardio: 'record',
    trend: 'trend', settings: 'settings'
  };

  function $(id) { return document.getElementById(id); }

  /* ---------- 画面切り替え ---------- */

  function showScreen(name) {
    if (SCREENS.indexOf(name) === -1) { name = 'home'; }

    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) { el.hidden = (s !== name); }
    });

    var navName = NAV_OF[name] || name;
    var navBtns = document.querySelectorAll('.nav-btn');
    Array.prototype.forEach.call(navBtns, function (btn) {
      if (btn.getAttribute('data-target') === navName) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    var target = $('screen-' + name);
    var title  = $('screen-title');
    if (title && target) {
      title.textContent = target.getAttribute('data-title') || '';
    }

    window.scrollTo(0, 0);

    /* 画面を開くたびに最新の内容にする */
    if (name === 'home' && App.Home && App.Home.refresh) {
      App.Home.refresh();
    }
    if (name === 'record' && App.History && App.History.render) {
      App.History.render();
    }
    if (name === 'myfoods' && App.MyFoods && App.MyFoods.render) {
      App.MyFoods.render();
    }
    if (name === 'trend' && App.Trend && App.Trend.render) {
      App.Trend.render();
    }
    if (name === 'settings' && App.Settings && App.Settings.refresh) {
      App.Settings.refresh();
    }
  }

  function bindMenu(id, fn) {
    var b = document.getElementById(id);
    if (b) { b.addEventListener('click', fn); }
  }

  function bindNav() {
    var navBtns = document.querySelectorAll('.nav-btn');
    Array.prototype.forEach.call(navBtns, function (btn) {
      btn.addEventListener('click', function () {
        showScreen(btn.getAttribute('data-target'));
      });
    });
  }

  /* ---------- 初回起動の処理 ---------- */

  function ensureInitialSettings() {
    if (!App.Storage.hasSavedSettings()) {
      /* 初期値をそのまま保存しておく。
         生年月日は空のままなので、設定画面で入力してもらう。 */
      App.Storage.saveSettings(App.Storage.getSettings());
      return true; // 初回起動だった
    }
    return false;
  }

  /* 生年月日が未入力のうちは設定画面から始める
     （基礎代謝の代替計算に年齢が必要なため） */
  function needsSetup() {
    var s = App.Storage.getSettings();
    return !s.birthdate;
  }

  /* ---------- 起動 ---------- */

  function start() {
    if (!App.Storage.isAvailable()) {
      window.alert(
        'このブラウザではデータを保存できません。\n' +
        'Safariのプライベートブラウズを使っている場合は、通常モードで開き直してください。'
      );
    }

    ensureInitialSettings();
    App.Storage.ensureMigrated();   /* 古い形式のデータを今の形に合わせる */

    bindNav();

    bindMenu('btn-menu-scan',    function () { App.Scan.open(); });
    bindMenu('btn-menu-body',    function () { App.Body.open(); });
    bindMenu('btn-menu-meal',    function () { App.Meal.open(); });
    bindMenu('btn-menu-myfoods', function () { App.MyFoods.open(); });
    bindMenu('btn-menu-steps',    function () { App.Steps.open(); });
    bindMenu('btn-menu-strength', function () { App.Strength.open(); });
    bindMenu('btn-menu-cardio',   function () { App.Cardio.open(); });

    App.Settings.init();
    App.Body.init();
    App.Scan.init();
    App.Meal.init();
    App.MyFoods.init();
    App.Steps.init();
    App.Strength.init();
    App.Cardio.init();
    App.Plan.init();
    App.Trend.init();
    App.History.init();
    App.Home.init();

    /* 生年月日が未入力なら設定画面から始めてもらう */
    showScreen(needsSetup() ? 'settings' : 'home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 他のファイルからも画面切り替えを使えるようにしておく */
  App.showScreen = showScreen;
})();
