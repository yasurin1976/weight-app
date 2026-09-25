/* ============================================================
   labels.js  —  画面に出す言葉を1か所にまとめたファイル
   ------------------------------------------------------------
   【重要】ここにある言葉は「仮ラベル」です。
   使ってみて印象が強すぎる・分かりにくいと感じたら、
   このファイルの右側の文字だけを書き換えてください。
   画面のあちこちを直す必要はありません。

   【2.5.0】「貯金／借金」は数値の表示から外しました。
   「借金 −170」は言葉と符号で二重に否定していて読みにくいためです。
   いまは「＋170／−170」と符号と色だけで示しています。

   言葉を戻したい場合は下の surplus / deficit を書き換え、
   signedWithWord() を使う側に戻してください。
     貯金 → 余裕 ／ 余剰 ／ プラス
     借金 → 超過 ／ 不足 ／ マイナス
   ============================================================ */

var App = App || {};

App.Labels = (function () {
  'use strict';

  var L = {

    /* ---- 乖離の呼び方（仮ラベル） ---- */
    surplus:        '貯金',      /* 許容量より少なく食べた分 */
    deficit:        '借金',      /* 許容量より多く食べた分 */
    deviationTitle: '直近7日の累積',
    deviationUnit:  'kcal',

    /* ---- 許容量まわり ---- */
    allowance:      '今日の許容量',
    remaining:      '今日あと食べられる',
    intake:         '摂取',
    exerciseAddon:  '運動',
    baseTarget:     '基本摂取目安',

    /* ---- 強度 ---- */
    intensityLight:  'ゆるめ',
    intensityNormal: '普通',
    intensityHard:   'きつめ',

    /* ---- 画面名 ---- */
    navHome:    'ホーム',
    navRecord:  '記録',
    navTrend:   '推移',
    navSettings:'設定',
    planTitle:  '食べる前に',

    /* ---- 注記 ---- */
    estimate:   '推定'
  };

  /* 符号に応じて呼び方を返す。
     v > 0 なら余っている側、v < 0 なら超えている側。 */
  function forValue(v) {
    return (v >= 0) ? L.surplus : L.deficit;
  }

  /* 「＋1,240 kcal 貯金」のような文字列を作る */
  function signed(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return '--'; }
    var s = (v > 0 ? '＋' : (v < 0 ? '−' : '')) + Math.abs(Math.round(v)).toLocaleString('ja-JP');
    return s;
  }

  function signedWithWord(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return '--'; }
    return signed(v) + ' ' + L.deviationUnit + ' ' + forValue(v);
  }

  /* 「＋170 kcal」「−170 kcal」。言葉は付けない。 */
  function signedUnit(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return '--'; }
    return signed(v) + ' ' + L.deviationUnit;
  }

  /* 色分け用のクラス名。超過は赤、余裕は緑、ちょうどは色なし。 */
  function toneOf(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return ''; }
    if (v < 0) { return 'val-over'; }
    if (v > 0) { return 'val-under'; }
    return '';
  }

  /* 要素に値と色をまとめて当てる */
  function applyTone(el, v) {
    if (!el) { return; }
    el.classList.remove('val-over', 'val-under');
    var t = toneOf(v);
    if (t) { el.classList.add(t); }
  }

  return {
    L:              L,
    forValue:       forValue,
    signed:         signed,
    signedUnit:     signedUnit,
    signedWithWord: signedWithWord,
    toneOf:         toneOf,
    applyTone:      applyTone
  };
})();
