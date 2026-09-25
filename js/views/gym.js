/* ============================================================
   views/gym.js  —  エニタイム（ジム）の入れ物
   ------------------------------------------------------------
   筋トレと有酸素は同じ場所で行うため、画面を1つにまとめ、
   上のタブで入力欄だけを切り替えます。

   中の入力欄そのものは strength.js / cardio.js が
   これまでどおり担当します。このファイルは
   「どちらのタブを出すか」だけを扱います。
   ============================================================ */

var App = App || {};

App.Gym = (function () {
  'use strict';

  var current = 'strength';

  function $(id) { return document.getElementById(id); }

  function setTab(which) {
    current = (which === 'cardio') ? 'cardio' : 'strength';

    var st = $('gym-strength');
    var cd = $('gym-cardio');
    if (st) { st.hidden = (current !== 'strength'); }
    if (cd) { cd.hidden = (current !== 'cardio'); }

    var g = $('gym-tab-group');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-gym') === current);
      });
    }
  }

  /* タブを押したときは、その種類の入力欄を新規の状態で開き直す */
  function onTabClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-gym')) {
        var which = t.getAttribute('data-gym');
        if (which === current) { return; }
        if (which === 'cardio') { App.Cardio.open(); }
        else                    { App.Strength.open(); }
        return;
      }
      t = t.parentNode;
    }
  }

  /* strength.js / cardio.js から呼ばれる。
     タブを合わせてから画面を出す。 */
  function show(which) {
    setTab(which);
    if (App.showScreen) { App.showScreen('gym'); }
  }

  /* 画面の見出し。編集中かどうかで変える */
  function setTitle(text) {
    var sec = $('screen-gym');
    if (sec) { sec.setAttribute('data-title', text); }
  }

  function init() {
    var g = $('gym-tab-group');
    if (g) { g.addEventListener('click', onTabClick); }
    setTab('strength');
  }

  return {
    init:     init,
    show:     show,
    setTab:   setTab,
    setTitle: setTitle
  };
})();
