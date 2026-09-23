/* ============================================================
   labels.js  —  画面に出す言葉を1か所にまとめたファイル
   ------------------------------------------------------------
   【重要】ここにある言葉は「仮ラベル」です。
   使ってみて印象が強すぎる・分かりにくいと感じたら、
   このファイルの右側の文字だけを書き換えてください。
   画面のあちこちを直す必要はありません。

   特に「貯金／借金」は分かりやすい反面、心理的な圧が強い
   言い方です。固定したものではありません。

   言い換えの候補（そのまま差し替えられます）：
     貯金 → 余裕 ／ 余剰 ／ プラス ／ 貯金
     借金 → 超過 ／ 不足 ／ マイナス ／ 借金
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

  return {
    L:              L,
    forValue:       forValue,
    signed:         signed,
    signedWithWord: signedWithWord
  };
})();
