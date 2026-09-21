/* ============================================================
   csv.js  —  CSV書き出し
   ------------------------------------------------------------
   記録の種類ごとに CSV ファイルを書き出します。
   iPhone の Excel でも文字化けしないよう、
   ファイルの先頭に BOM（目印）を付けた UTF-8 で保存します。

   日次サマリーは保存値ではなく、そのつど calc.js で
   計算し直した結果を出力します。
   ============================================================ */

var App = App || {};

App.Csv = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  /* ---------- CSVの組み立て ---------- */

  /* カンマ・改行・引用符を含む値を安全に囲む */
  function cell(v) {
    if (v === null || v === undefined) { return ''; }
    var s = String(v);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(header, rows) {
    var lines = [header.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(cell).join(',')); });
    return lines.join('\r\n');
  }

  /* ---------- 書き出し ---------- */

  function download(filename, text) {
    /* BOM を付けると Excel が UTF-8 として開いてくれる */
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* ---------- 種類ごとの中身 ---------- */

  var BUILDERS = {

    body: function () {
      return {
        name: '体組成',
        header: ['測定日', '測定時刻', '代表', '体重kg', '体脂肪率%', '体脂肪量kg',
                 '内臓脂肪レベル', '骨格筋率%', '骨格筋量kg', '基礎代謝kcal', 'BMI', 'メモ'],
        rows: S.listBody().map(function (e) {
          return [e.date, e.time, e.isPrimary ? '○' : '', e.weightKg, e.bodyFatPct, e.fatMassKg,
                  e.visceralLevel, e.skeletalMusclePct, e.skeletalMuscleKg, e.bmrKcal, e.bmi, e.memo];
        })
      };
    },

    meals: function () {
      return {
        name: '食事',
        header: ['日付', '区分', '料理名', 'kcal', 'P_g', 'F_g', 'C_g', 'メモ'],
        rows: S.listMeals().map(function (e) {
          return [e.date, S.mealTypeLabel(e.mealType), e.name, e.kcal, e.protein, e.fat, e.carb, e.memo];
        })
      };
    },

    myFoods: function () {
      return {
        name: 'マイ食品',
        header: ['食品名', '基準量', 'kcal', 'P_g', 'F_g', 'C_g', '使用回数'],
        rows: S.listMyFoods().map(function (e) {
          return [e.name, e.unitLabel, e.kcal, e.protein, e.fat, e.carb, e.useCount || 0];
        })
      };
    },

    steps: function () {
      var s = S.getSettings();
      return {
        name: '歩数',
        header: ['日付', '歩数', '推定距離km', '推定消費kcal'],
        rows: S.listSteps().map(function (e) {
          var km = C.walkDistanceKm(e.steps, s.strideCm);
          var w  = C.weightForDate(S.listBody(), e.date);
          var k  = (w !== null) ? C.walkingKcal({ steps: e.steps, strideCm: s.strideCm, weightKg: w }) : null;
          return [e.date, e.steps, km, k];
        })
      };
    },

    strength: function () {
      return {
        name: '筋トレ',
        header: ['日付', '種目', '重量', '単位', 'セット数', '各セット回数', '合計回数', '時間分', 'メモ', '元入力'],
        rows: S.listStrength().map(function (e) {
          return [e.date, e.exercise, e.weight, e.unit, e.setCount,
                  (e.reps || []).join('+'), e.totalReps, e.durationMin, e.memo, e.rawText];
        })
      };
    },

    cardio: function () {
      return {
        name: '有酸素',
        header: ['日付', '種目', '時間分', '距離km', 'マシン表示kcal', 'マシン表示の種類',
                 '平均心拍', '平均速度', '傾斜', '水深cm', '強度', 'メモ'],
        rows: S.listCardio().map(function (e) {
          var t = (e.machineKcalType === 'gross') ? '安静分込み'
                : (e.machineKcalType === 'net')   ? '運動分のみ'
                : (e.machineKcal !== null && e.machineKcal !== undefined) ? '不明' : '';
          return [e.date, e.exercise, e.durationMin, e.distanceKm, e.machineKcal, t,
                  e.avgHr, e.avgSpeed, e.incline, e.waterDepthCm, e.intensity, e.memo];
        })
      };
    },

    daily: function () {
      var settings = S.getSettings();
      var data = {
        body:     S.listBody(),
        meals:    S.listMeals(),
        steps:    S.listSteps(),
        strength: S.listStrength(),
        cardio:   S.listCardio()
      };

      /* 何かしら記録のある日をすべて集める */
      var set = {};
      ['body', 'meals', 'steps', 'strength', 'cardio'].forEach(function (k) {
        data[k].forEach(function (e) { if (e && e.date) { set[e.date] = true; } });
      });
      var dates = Object.keys(set).sort();

      return {
        name: '日次サマリー',
        header: ['日付', '代表体重kg', '摂取kcal', 'P_g', 'F_g', 'C_g',
                 '基礎代謝kcal', '基礎代謝の出所', '日常活動kcal', '歩行kcal', '筋トレkcal',
                 '有酸素kcal', 'TEFkcal', '推定消費kcal', '推定収支kcal', '歩数', '計算式バージョン'],
        rows: dates.map(function (d) {
          var s = C.dailySummary(d, settings, data);
          var bd = s.out ? s.out.breakdown : {};
          var srcLabel = (s.bmr.source === 'device')      ? '体組成計'
                       : (s.bmr.source === 'device-last') ? '体組成計（直近）'
                       : (s.bmr.source === 'formula')     ? '計算式' : '不明';
          return [d, s.weightKg, s.intake.count ? s.intake.kcal : null,
                  s.intake.count ? s.intake.protein : null,
                  s.intake.count ? s.intake.fat : null,
                  s.intake.count ? s.intake.carb : null,
                  s.bmr.value, srcLabel,
                  s.out ? bd.dailyActivity : null,
                  s.out ? bd.walking : null,
                  s.out ? bd.strength : null,
                  s.out ? bd.cardio : null,
                  s.out ? bd.tef : null,
                  s.out ? s.out.total : null,
                  s.balance, s.steps, s.calculationVersion];
        })
      };
    }
  };

  /* ---------- 公開する関数 ---------- */

  function exportKind(kind) {
    var build = BUILDERS[kind];
    if (!build) { return { ok: false, error: '書き出せる種類ではありません。' }; }

    var b = build();
    if (!b.rows.length) {
      return { ok: false, error: b.name + 'の記録がまだありません。' };
    }
    download('weight-' + kind + '-' + stamp() + '.csv', toCsv(b.header, b.rows));
    return { ok: true, count: b.rows.length, name: b.name };
  }

  return {
    exportKind: exportKind,
    KINDS: ['body', 'meals', 'myFoods', 'steps', 'strength', 'cardio', 'daily'],
    toCsv: toCsv
  };
})();
