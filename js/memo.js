/* ============================================================
   memo.js  —  筋トレのメモ（テキスト）を読み取る
   ------------------------------------------------------------
   ジムでいつも付けているメモをそのまま貼り付けて、記録に変えます。
   AIは使いません。決まった書き方だけをアプリの中で読みます。

   【読める書き方】
     9/26 エニタイム 8:48        ← 1行目に月/日があれば日付にする
     ＜マシンコーナー＞           ← ＜＞や【】で囲んだ行は見出しとして飛ばす
     ラットプルダウン             ← 種目名（数字で始まらない行）
     150LBS(68kg)                ← 重量。単位は LBS か kg。( )内は無視
     左右24kg                    ← ダンベル。片手24kgとして記録し「左右24kg（計48kg）」と表示
     10+10+10回                  ← 回数。「＋」区切りでセットごと
                                 ← 空行で種目の区切り
     レッグプレス
     350LBS
     15回                        ← 重量→回数 の組が何回続いてもよい（重量ごとに1件）
     320LBS
     15回

   【守っていること】
   ・読み取っただけでは保存しません。確認画面で人が見てから保存します。
   ・回数が無い重量行は「未入力」として警告し、勝手に補いません。
   ・読めなかった行はそのまま一覧に出します（黙って捨てない）。
   ============================================================ */

var App = App || {};

App.Memo = (function () {
  'use strict';

  /* 「150LBS」「68kg」「150 lbs(68kg)」「150ポンド」
     ダンベル：「左右24kg」「片手24kg」「各24kg」「24kg×2」「24kg 左右」→ 片手24kg・左右あり */
  var RE_WEIGHT = /^(?:(左右|片手|各|片側)\s*)?(\d+(?:\.\d+)?)\s*(lbs?|ポンド|kg|キロ)(?=$|[^a-z]|x\s*2)\s*(?:[（(][^)）]*[)）])?\s*(×\s*2|x\s*2|左右|片手|各|片側)?/i;
  /* 「10+10+10回」「15回」「10,10,8回」「10回×3」「12x3回」 */
  var RE_REPS   = /^(\d+(?:\s*[+＋,、\/]\s*\d+)*)\s*回?\s*(?:[×xX*]\s*(\d+)\s*(?:セット|set)?)?\s*$/;
  var RE_REPS_X = /^(\d+)\s*回\s*[×xX*]\s*(\d+)/;
  var RE_DATE   = /(\d{1,2})\s*[\/／月]\s*(\d{1,2})\s*日?/;
  var RE_HEAD   = /^[＜<【\[（(].*[＞>】\]）)]$/;

  function normalizeUnit(u) {
    u = (u || '').toLowerCase();
    if (u === 'lb' || u === 'lbs' || u === 'ポンド') { return 'LBS'; }
    return 'kg';
  }

  function parseWeight(line) {
    var m = RE_WEIGHT.exec(line);
    if (!m) { return null; }
    var w = Number(m[2]);
    if (!isFinite(w) || w < 0 || w > 1000) { return null; }
    var perHand = !!(m[1] || m[4]);
    return { weight: Math.round(w * 2) / 2, unit: normalizeUnit(m[3]), perHand: perHand };
  }

  function parseReps(line) {
    var m = RE_REPS_X.exec(line);
    var reps = [];
    var i, n;
    if (m) {
      n = Number(m[1]);
      var sets = Number(m[2]);
      if (n < 1 || n > 200 || sets < 1 || sets > 20) { return null; }
      for (i = 0; i < sets; i++) { reps.push(n); }
      return reps;
    }
    m = RE_REPS.exec(line);
    if (!m) { return null; }
    /* 「回」も「＋」も無い裸の数字は、重量か回数か分からないので読まない */
    if (line.indexOf('回') < 0 && !/[+＋,、\/×xX*]/.test(line)) { return null; }
    var parts = m[1].split(/\s*[+＋,、\/]\s*/);
    for (i = 0; i < parts.length; i++) {
      n = Number(parts[i]);
      if (!isFinite(n) || n < 1 || n > 200) { return null; }
      reps.push(n);
    }
    if (m[2]) {
      var times = Number(m[2]);
      if (times < 1 || times > 20) { return null; }
      var base = reps.slice();
      reps = [];
      for (i = 0; i < times; i++) { reps = reps.concat(base); }
    }
    if (reps.length > 20) { return null; }
    return reps;
  }

  /* 「9/26」に年を当てる。今年だと未来なら去年 */
  function resolveDate(md, today) {
    var m = RE_DATE.exec(md);
    if (!m) { return null; }
    var year = Number(today.slice(0, 4));
    var mm = ('0' + m[1]).slice(-2), dd = ('0' + m[2]).slice(-2);
    var cand = year + '-' + mm + '-' + dd;
    if (!App.Calc.isValidDate || !App.Calc.isValidDate(cand)) {
      var dt = new Date(year, Number(mm) - 1, Number(dd));
      if (dt.getMonth() !== Number(mm) - 1) { return null; }
    }
    if (cand <= today) { return cand; }
    return (year - 1) + '-' + mm + '-' + dd;
  }

  /* ---------- 本体 ----------
     返り値：
       { date, rows: [{exercise, weight, unit, reps, line}], unknown: [line], notes: [] }
       reps が null の行は「回数が未入力」 */
  function parse(text, today) {
    today = today || App.Calc.todayStr();
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var rows = [], unknown = [], notes = [];
    var date = null;
    var exercise = null;
    var pending = null;   /* 重量だけ読めて回数待ちの行 */
    var i, line, w, r;

    function flushPending() {
      if (pending) {
        rows.push({ exercise: exercise, weight: pending.weight, unit: pending.unit, perHand: pending.perHand, reps: null, line: pending.line });
        pending = null;
      }
    }

    for (i = 0; i < lines.length; i++) {
      line = lines[i].trim().replace(/\s+/g, ' ');

      /* 空行：種目の区切り */
      if (line === '') { flushPending(); exercise = null; continue; }

      /* 1行目付近の日付 */
      if (date === null && rows.length === 0 && exercise === null && RE_DATE.test(line)) {
        date = resolveDate(line, today);
        if (date) { continue; }
      }

      /* 見出し */
      if (RE_HEAD.test(line)) { continue; }

      w = parseWeight(line);
      if (w) {
        flushPending();
        if (!exercise) { unknown.push(line); notes.push('種目名の前に重量が出てきました：' + line); continue; }
        pending = { weight: w.weight, unit: w.unit, perHand: w.perHand, line: line };
        continue;
      }

      r = parseReps(line);
      if (r) {
        if (!exercise) { unknown.push(line); continue; }
        if (pending) {
          rows.push({ exercise: exercise, weight: pending.weight, unit: pending.unit, perHand: pending.perHand, reps: r, line: pending.line + ' ' + line });
          pending = null;
        } else {
          /* 重量なしの回数（自重種目） */
          rows.push({ exercise: exercise, weight: null, unit: 'kg', perHand: false, reps: r, line: line });
        }
        continue;
      }

      /* 数字で始まる行は種目名にしない */
      if (/^\d/.test(line)) { unknown.push(line); continue; }

      /* 種目名。直前の種目に回数待ちがあれば確定させる */
      flushPending();
      exercise = line.slice(0, 40);
    }
    flushPending();

    return { date: date, rows: rows, unknown: unknown, notes: notes };
  }

  return {
    parse:      parse,
    parseReps:  parseReps,
    parseWeight: parseWeight
  };
})();
