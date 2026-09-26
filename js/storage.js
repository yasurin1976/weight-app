/* ============================================================
   storage.js  —  保存層（データの出し入れだけを担当）
   ------------------------------------------------------------
   ここだけが localStorage を直接触ります。
   将来 IndexedDB や Supabase に移行する場合も、
   このファイルの中身を差し替えるだけで済むようにしています。

   アプリ本体からは Storage.get() / Storage.set() などしか呼びません。
   ============================================================ */

var App = App || {};

App.Storage = (function () {
  'use strict';

  /* データ形式のバージョン。項目の構造を変えたら上げる
       v1 … Phase 1
       v2 … Phase 2。設定項目の追加と、各記録の「入力元」欄の追加。
             記録そのものの形は変えていないので、v1のバックアップは
             そのまま読み込めます（migrate() が不足分を補います）。 */
  var SCHEMA_VERSION = 2;

  /* localStorage に入れるときの名前の頭につける文字列 */
  var PREFIX = 'wm.';

  /* 扱うデータの種類。Step 2 以降でここに追加していく */
  var KEYS = {
    settings:    'settings',    // 設定（プロフィール・目標など）
    meta:        'meta',        // 最終バックアップ日時など
    body:        'body',        // 体組成       ← Step 2
    meals:       'meals',       // 食事         ← Step 3
    myFoods:     'myFoods',     // マイ食品     ← Step 3
    steps:       'steps',       // 歩数         ← Step 4
    strength:    'strength',    // 筋トレ
    cardio:      'cardio',      // 有酸素
                                //   machineKcal は原値のまま保存する
    calibrations:'calibrations' // 基本摂取目安の補正履歴 ← Phase 2
  };

  /* ---------- 内部：読み書きの基本 ---------- */

  function rawGet(key) {
    try {
      var s = window.localStorage.getItem(PREFIX + key);
      if (s === null) { return null; }
      return JSON.parse(s);
    } catch (e) {
      console.warn('[storage] 読み込みに失敗しました:', key, e);
      return null;
    }
  }

  function rawSet(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[storage] 保存に失敗しました:', key, e);
      return false;
    }
  }

  /* ---------- 保存できるかどうかの確認 ---------- */

  function isAvailable() {
    try {
      var t = PREFIX + '__test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 公開する読み書き ---------- */

  function get(key, fallback) {
    var v = rawGet(key);
    return (v === null || v === undefined) ? (fallback === undefined ? null : fallback) : v;
  }

  function set(key, value) {
    return rawSet(key, value);
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(PREFIX + key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 設定 ---------- */

  /* 初期値。Step 1 で確定した内容 */
  var DEFAULT_SETTINGS = {
    birthdate:          null,         // 生年月日（未入力。初回に設定画面で入力する）
    sex:                'male',       // 性別（男性固定）
    heightCm:           171,
    strideCm:           77,
    beta:               0.10,         // 日常活動補正
    strengthMets:       5.0,          // 筋トレの強度
    tefRate:            0.10,         // 食事誘発性熱産生の割合
    targetWeightKg:     64,
    /* 目標日。null なら減量強度の3段階を使う（2.4.0で追加） */
    targetDate:         null,
    targetBodyFatPct:   15,
    targetPaceKgPerWeek: 0.4,
    avgWindowDays:      7,           // 平均を取る日数
    avgMinSamples:      5,           // 正式な平均として扱う最低測定日数

    /* ---- Phase 2 で追加 ---- */
    intensity:          'normal',    // 減量強度 light / normal / hard
    baseTargetKcal:     null,        // 基本摂取目安。null なら自動計算
    cardioFactor:       1.00,        // 運動係数。1.00＝マシン表示をそのまま使う（2.9.0で0.70から変更）
    lastCalibrationAt:  null,        // 最後に目安を見直した日時

    /* ---- 2.3.0 で追加：表示テーマ ---- */
    /* auto … iPhoneの設定に合わせる / light / dark */
    theme:              'auto',

    /* ---- 2.1.0 で追加：スクショ読み取り ---- */
    /* 中継サーバーのURL。APIキーはここには入りません（中継サーバー側が持ちます）。
       空のあいだは読み取り機能を使いません。 */
    relayUrl:           ''
  };

  function getSettings() {
    var saved = get(KEYS.settings, null);
    var out = {};
    var k;
    for (k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        out[k] = DEFAULT_SETTINGS[k];
      }
    }
    if (saved && typeof saved === 'object') {
      for (k in saved) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) {
          out[k] = saved[k];
        }
      }
    }
    return out;
  }

  function saveSettings(settings) {
    return set(KEYS.settings, settings);
  }

  function hasSavedSettings() {
    return get(KEYS.settings, null) !== null;
  }

  /* ---------- メタ情報（最終バックアップ日時など） ---------- */

  function getMeta() {
    return get(KEYS.meta, { lastBackupAt: null });
  }

  function setLastBackupAt(iso) {
    var meta = getMeta();
    meta.lastBackupAt = iso;
    return set(KEYS.meta, meta);
  }

  /* ============================================================
     体組成データ
     ------------------------------------------------------------
     1件＝1回の測定。1日に何回でも登録できます。
     グラフと平均に使う「代表体重」は 1日1件だけ isPrimary が true。
     ============================================================ */

  function newId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* 全件。日付→時刻の順に並べて返す */
  function listBody() {
    var arr = get(KEYS.body, []);
    if (!(arr instanceof Array)) { return []; }
    return arr.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      return (a.time || '') < (b.time || '') ? -1 : ((a.time || '') > (b.time || '') ? 1 : 0);
    });
  }

  function getBodyEntry(id) {
    var all = listBody();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { return all[i]; }
    }
    return null;
  }

  function writeBody(arr) {
    return set(KEYS.body, arr);
  }

  /* ---------- 代表体重の付け直し ---------- */

  /* その日の代表を決める規則
       1) 手動で代表に指定したもの（primaryLocked）があればそれ
       2) なければ、その日の最も早い測定
     1日に代表は必ず1件です。 */
  function reapplyPrimaryForDate(arr, date) {
    var sameDay = arr.filter(function (e) { return e.date === date; });
    if (!sameDay.length) { return arr; }

    sameDay.sort(function (a, b) {
      return (a.time || '') < (b.time || '') ? -1 : ((a.time || '') > (b.time || '') ? 1 : 0);
    });

    var locked = null;
    for (var i = 0; i < sameDay.length; i++) {
      if (sameDay[i].primaryLocked) { locked = sameDay[i]; break; }
    }
    var chosen = locked || sameDay[0];

    sameDay.forEach(function (e) {
      e.isPrimary = (e.id === chosen.id);
      if (!locked) { e.primaryLocked = false; }
    });
    return arr;
  }

  /* 追加または更新。id があれば更新、なければ新規。 */
  function saveBodyEntry(entry) {
    var arr = get(KEYS.body, []);
    if (!(arr instanceof Array)) { arr = []; }
    var now = new Date().toISOString();
    var targetDate = entry.date;
    var oldDate = null;

    if (entry.id) {
      var found = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === entry.id) {
          oldDate = arr[i].date;
          entry.createdAt    = arr[i].createdAt || now;
          entry.primaryLocked = !!arr[i].primaryLocked;
          /* 日付を変えた場合、手動指定は引き継がない */
          if (oldDate !== targetDate) { entry.primaryLocked = false; }
          entry.updatedAt = now;
          arr[i] = entry;
          found = true;
          break;
        }
      }
      if (!found) { return { ok: false, error: '対象の記録が見つかりませんでした。' }; }
    } else {
      entry.id            = newId();
      entry.createdAt     = now;
      entry.updatedAt     = now;
      entry.primaryLocked = false;
      entry.isPrimary     = false;
      arr.push(entry);
    }

    reapplyPrimaryForDate(arr, targetDate);
    if (oldDate && oldDate !== targetDate) { reapplyPrimaryForDate(arr, oldDate); }

    var ok = writeBody(arr);
    return ok ? { ok: true, id: entry.id }
              : { ok: false, error: '保存できませんでした。端末の空き容量をご確認ください。' };
  }

  function deleteBodyEntry(id) {
    var arr = get(KEYS.body, []);
    if (!(arr instanceof Array)) { return { ok: false, error: 'データがありません。' }; }

    var date = null;
    var next = [];
    arr.forEach(function (e) {
      if (e.id === id) { date = e.date; } else { next.push(e); }
    });
    if (date === null) { return { ok: false, error: '対象の記録が見つかりませんでした。' }; }

    /* 削除したものが手動指定だった場合も、残りから自動で選び直す */
    reapplyPrimaryForDate(next, date);
    var ok = writeBody(next);
    return ok ? { ok: true } : { ok: false, error: '削除できませんでした。' };
  }

  /* 指定した測定をその日の代表にする（手動指定） */
  function setPrimaryBodyEntry(id) {
    var arr = get(KEYS.body, []);
    if (!(arr instanceof Array)) { return { ok: false, error: 'データがありません。' }; }

    var target = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { target = arr[i]; break; }
    }
    if (!target) { return { ok: false, error: '対象の記録が見つかりませんでした。' }; }

    arr.forEach(function (e) {
      if (e.date === target.date) { e.primaryLocked = (e.id === id); }
    });
    reapplyPrimaryForDate(arr, target.date);

    var ok = writeBody(arr);
    return ok ? { ok: true } : { ok: false, error: '変更できませんでした。' };
  }

  /* 最も新しい測定（日付→時刻の順で最後） */
  function latestBodyEntry() {
    var all = listBody();
    return all.length ? all[all.length - 1] : null;
  }

  /* 指定した項目に値が入っている、最も新しい測定 */
  function latestBodyEntryWith(field) {
    var all = listBody();
    for (var i = all.length - 1; i >= 0; i--) {
      var v = all[i][field];
      if (typeof v === 'number' && isFinite(v)) { return all[i]; }
    }
    return null;
  }

  /* ============================================================
     共通のデータ置き場（食事・マイ食品・歩数・筋トレ・有酸素）
     ------------------------------------------------------------
     体組成は代表値の扱いが特殊なので専用の処理を使い、
     それ以外はこの共通処理で追加・更新・削除します。
     ============================================================ */

  function genId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function listOf(key) {
    var arr = get(key, []);
    return (arr instanceof Array) ? arr : [];
  }

  function getOf(key, id) {
    var all = listOf(key);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { return all[i]; }
    }
    return null;
  }

  /* id があれば更新、なければ新規追加 */
  function saveOf(key, entry, prefix) {
    var arr = listOf(key);
    var now = new Date().toISOString();

    if (entry.id) {
      var found = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === entry.id) {
          entry.createdAt = arr[i].createdAt || now;
          entry.updatedAt = now;
          arr[i] = entry;
          found = true;
          break;
        }
      }
      if (!found) { return { ok: false, error: '対象の記録が見つかりませんでした。' }; }
    } else {
      entry.id        = genId(prefix);
      entry.createdAt = now;
      entry.updatedAt = now;
      arr.push(entry);
    }
    var ok = set(key, arr);
    return ok ? { ok: true, id: entry.id }
              : { ok: false, error: '保存できませんでした。端末の空き容量をご確認ください。' };
  }

  function deleteOf(key, id) {
    var arr = listOf(key);
    var next = arr.filter(function (e) { return e.id !== id; });
    if (next.length === arr.length) { return { ok: false, error: '対象の記録が見つかりませんでした。' }; }
    var ok = set(key, next);
    return ok ? { ok: true } : { ok: false, error: '削除できませんでした。' };
  }

  /* ============================================================
     入力元の記録（Phase 2）
     ------------------------------------------------------------
     どの記録も「どうやって入力されたか」を持ちます。
     いまは手入力だけですが、写真解析を足したときに
     ・AIの精度を後から検証する
     ・同じ元データで解析し直す
     ためにここを使います。

     sourceRef は将来クラウドに画像を置いたときの置き場所の目印です。
     Phase 2 では画像を保存しないため常に null ですが、
     欄だけ先に用意しておきます（後から足すとデータの作り直しになるため）。
     ============================================================ */

  function inputMeta(method, extra) {
    var e = extra || {};
    return {
      method:    method || 'manual',  // manual / photo / screenshot / text
      model:     e.model || null,     // 使った解析モデル名
      analyzedAt:e.analyzedAt || null,
      sourceRef: e.sourceRef || null, // 将来の元データ参照ID（画像など）
      edited:    e.edited === true    // 解析結果を人が直したか
    };
  }

  /* 古い記録にも入力元の欄を補う */
  function withInputMeta(entry) {
    if (entry && !entry.input) { entry.input = inputMeta('manual'); }
    return entry;
  }

  /* ---------- 食事 ---------- */

  var MEAL_TYPES = [
    { key: 'breakfast', label: '朝食' },
    { key: 'lunch',     label: '昼食' },
    { key: 'dinner',    label: '夕食' },
    { key: 'snack',     label: '間食' }
  ];

  function mealTypeLabel(k) {
    for (var i = 0; i < MEAL_TYPES.length; i++) {
      if (MEAL_TYPES[i].key === k) { return MEAL_TYPES[i].label; }
    }
    return '';
  }

  function mealTypeOrder(k) {
    for (var i = 0; i < MEAL_TYPES.length; i++) {
      if (MEAL_TYPES[i].key === k) { return i; }
    }
    return 99;
  }

  /* 日付を指定すると、その日のぶんだけ返します */
  function listMeals(date) {
    var all = listOf(KEYS.meals);
    if (date) { all = all.filter(function (m) { return m.date === date; }); }
    return all.sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      var d = mealTypeOrder(a.mealType) - mealTypeOrder(b.mealType);
      if (d !== 0) { return d; }
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
  }

  function getMeal(id)        { return getOf(KEYS.meals, id); }
  function saveMeal(entry)    { return saveOf(KEYS.meals, entry, 'm'); }
  function deleteMeal(id)     { return deleteOf(KEYS.meals, id); }

  /* ---------- マイ食品 ---------- */

  /* よく使うものが上に来るよう、使用回数の多い順→名前順 */
  function listMyFoods() {
    return listOf(KEYS.myFoods).sort(function (a, b) {
      var d = (b.useCount || 0) - (a.useCount || 0);
      if (d !== 0) { return d; }
      return (a.name || '') < (b.name || '') ? -1 : 1;
    });
  }

  function getMyFood(id)     { return getOf(KEYS.myFoods, id); }
  function saveMyFood(entry) { return saveOf(KEYS.myFoods, entry, 'f'); }
  function deleteMyFood(id)  { return deleteOf(KEYS.myFoods, id); }

  /* マイ食品を使ったときに使用回数を1つ増やす */
  function touchMyFood(id) {
    var f = getMyFood(id);
    if (!f) { return; }
    f.useCount = (f.useCount || 0) + 1;
    saveMyFood(f);
  }

  /* ---------- 歩数（1日1件） ---------- */

  function listSteps() {
    return listOf(KEYS.steps).sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });
  }

  function getStepsByDate(date) {
    var all = listOf(KEYS.steps);
    for (var i = 0; i < all.length; i++) {
      if (all[i].date === date) { return all[i]; }
    }
    return null;
  }

  /* 同じ日付の記録があれば上書きします */
  function saveSteps(entry) {
    var existing = getStepsByDate(entry.date);
    if (existing) { entry.id = existing.id; }
    return saveOf(KEYS.steps, entry, 's');
  }

  function deleteSteps(id) { return deleteOf(KEYS.steps, id); }

  /* ---------- 筋トレ ---------- */

  function listStrength() {
    return listOf(KEYS.strength).sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
  }

  function getStrength(id)     { return getOf(KEYS.strength, id); }
  function saveStrength(entry) { return saveOf(KEYS.strength, entry, 'w'); }
  function deleteStrength(id)  { return deleteOf(KEYS.strength, id); }

  /* 同じ種目の過去の記録（新しい順） */
  function historyOfExercise(name, limit) {
    if (!name) { return []; }
    var key = name.trim();
    var all = listStrength().filter(function (e) { return e.exercise === key; });
    all.reverse();
    return all.slice(0, limit || 3);
  }

  /* 同じ種目の自己ベスト（重量が最大のもの。単位ごとに分けて見る） */
  function bestOfExercise(name) {
    var all = listStrength().filter(function (e) {
      return e.exercise === name && typeof e.weight === 'number';
    });
    var best = null;
    all.forEach(function (e) {
      if (!best || e.weight > best.weight) { best = e; }
    });
    return best;
  }

  /* ---------- 有酸素 ---------- */

  function listCardio() {
    return listOf(KEYS.cardio).sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
  }

  function getCardio(id)     { return getOf(KEYS.cardio, id); }
  function saveCardio(entry) { return saveOf(KEYS.cardio, entry, 'c'); }
  function deleteCardio(id)  { return deleteOf(KEYS.cardio, id); }

  /* ---------- 基本摂取目安の補正履歴（Phase 2） ---------- */

  function listCalibrations() {
    return listOf(KEYS.calibrations).sort(function (a, b) {
      return (a.at || '') < (b.at || '') ? 1 : -1;   /* 新しい順 */
    });
  }

  /* 提案を承認したときだけ呼びます。設定値の変更と履歴の記録を同時に行います。 */
  function applyCalibration(proposal) {
    if (!proposal || !proposal.comparable || proposal.suggestedBase === null) {
      return { ok: false, error: '適用できる提案がありません。' };
    }
    var s = getSettings();
    var before = s.baseTargetKcal;
    var beforeEffective = proposal.currentBase;

    s.baseTargetKcal = proposal.suggestedBase;
    s.lastCalibrationAt = new Date().toISOString();
    if (!saveSettings(s)) { return { ok: false, error: '設定を保存できませんでした。' }; }

    var rec = saveOf(KEYS.calibrations, {
      at:                 s.lastCalibrationAt,
      beforeSetting:      before,            /* 変更前の設定値（null＝自動計算だった） */
      beforeEffective:    beforeEffective,   /* 変更前に実際に使われていた値 */
      after:              proposal.suggestedBase,
      days:               proposal.days,
      daysWithMeals:      proposal.daysWithMeals,
      theoreticalDeltaKg: proposal.theoreticalDeltaKg,
      actualDeltaKg:      proposal.actualDeltaKg,
      gapPerDay:          proposal.gapPerDay,
      approvedByUser:     true,
      calculationVersion: proposal.calculationVersion
    }, 'k');

    return rec.ok ? { ok: true, value: proposal.suggestedBase } : rec;
  }

  /* 自動計算に戻す */
  function resetBaseTarget() {
    var s = getSettings();
    s.baseTargetKcal = null;
    return saveSettings(s) ? { ok: true } : { ok: false, error: '設定を保存できませんでした。' };
  }

  /* ---------- データ形式の移行 ---------- */

  /* v1 で保存されたデータを v2 の形に合わせます。
     記録の中身は変えず、足りない欄を補うだけです。 */
  function migrate(fromVersion) {
    if (fromVersion >= SCHEMA_VERSION) { return false; }

    ['meals', 'body', 'cardio', 'strength', 'steps'].forEach(function (name) {
      var key = KEYS[name];
      var arr = listOf(key);
      if (!arr.length) { return; }
      arr.forEach(withInputMeta);
      set(key, arr);
    });

    /* 設定に Phase 2 の項目を補う（既存の値は触らない） */
    var s = get(KEYS.settings, null);
    if (s && typeof s === 'object') {
      if (s.intensity === undefined)         { s.intensity = 'normal'; }
      if (s.baseTargetKcal === undefined)    { s.baseTargetKcal = null; }
      if (s.cardioFactor === undefined)      { s.cardioFactor = 1.00; }
      if (s.lastCalibrationAt === undefined) { s.lastCalibrationAt = null; }
      set(KEYS.settings, s);
    }

    var meta = getMeta();
    meta.schemaVersion = SCHEMA_VERSION;
    meta.migratedAt = new Date().toISOString();
    set(KEYS.meta, meta);
    return true;
  }

  /* 運動係数の初期値を 0.70 → 1.00 に変えたときの一度きりの引き継ぎ。
     0.70 のまま残っている設定は、旧初期値のままの可能性が高いので 1.00 にします。
     それ以外の値（自分で変えた値）は触りません。二度は行いません。 */
  function migrateCardioFactor() {
    var meta = getMeta();
    if (meta.cardioFactorTo100) { return false; }
    var s = get(KEYS.settings, null);
    if (s && typeof s === 'object' && s.cardioFactor === 0.70) {
      s.cardioFactor = 1.00;
      set(KEYS.settings, s);
    }
    meta.cardioFactorTo100 = new Date().toISOString();
    set(KEYS.meta, meta);
    return true;
  }

  /* 起動時に呼びます */
  function ensureMigrated() {
    var meta = getMeta();
    var v = (typeof meta.schemaVersion === 'number') ? meta.schemaVersion : 1;
    var r = migrate(v);
    migrateCardioFactor();
    return r;
  }

  /* ---------- JSON バックアップ ---------- */

  /* 全データを 1 つのオブジェクトにまとめる */
  function exportAll() {
    var data = {};
    var name;
    for (name in KEYS) {
      if (Object.prototype.hasOwnProperty.call(KEYS, name)) {
        var v = rawGet(KEYS[name]);
        if (v !== null) { data[KEYS[name]] = v; }
      }
    }
    return {
      app:             'weight-manager',
      schemaVersion:   SCHEMA_VERSION,
      calculationVersion: (App.Calc && App.Calc.VERSION) ? App.Calc.VERSION : null,
      exportedAt:      new Date().toISOString(),
      data:            data
    };
  }

  /* バックアップファイルの中身が正しい形かどうかを確認する */
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object')      { return 'ファイルの中身が読み取れません。'; }
    if (obj.app !== 'weight-manager')          { return 'このアプリのバックアップファイルではありません。'; }
    if (typeof obj.schemaVersion !== 'number') { return 'データ形式のバージョンが見つかりません。'; }
    if (obj.schemaVersion > SCHEMA_VERSION)    { return 'このバックアップは新しいバージョンのアプリで作られています。アプリを更新してください。'; }
    if (!obj.data || typeof obj.data !== 'object') { return 'データ本体が見つかりません。'; }
    return null; // 問題なし
  }

  /* バックアップから復元する（現在のデータは上書きされます） */
  function importAll(obj) {
    var err = validateBackup(obj);
    if (err) { return { ok: false, error: err }; }

    /* 既存データを消してから入れ直す */
    var name;
    for (name in KEYS) {
      if (Object.prototype.hasOwnProperty.call(KEYS, name)) {
        remove(KEYS[name]);
      }
    }
    var key;
    for (key in obj.data) {
      if (Object.prototype.hasOwnProperty.call(obj.data, key)) {
        rawSet(key, obj.data[key]);
      }
    }

    /* 古い形式のバックアップなら、読み込んだあとで今の形に合わせます */
    var v = (typeof obj.schemaVersion === 'number') ? obj.schemaVersion : 1;
    var migrated = migrate(v);

    return { ok: true, migrated: migrated, fromVersion: v };
  }

  /* ---------- 公開する窓口 ---------- */
  return {
    SCHEMA_VERSION:   SCHEMA_VERSION,
    KEYS:             KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    isAvailable:      isAvailable,
    get:              get,
    set:              set,
    remove:           remove,
    getSettings:      getSettings,
    saveSettings:     saveSettings,
    hasSavedSettings: hasSavedSettings,
    getMeta:          getMeta,
    setLastBackupAt:  setLastBackupAt,
    listBody:             listBody,
    getBodyEntry:         getBodyEntry,
    saveBodyEntry:        saveBodyEntry,
    deleteBodyEntry:      deleteBodyEntry,
    setPrimaryBodyEntry:  setPrimaryBodyEntry,
    latestBodyEntry:      latestBodyEntry,
    latestBodyEntryWith:  latestBodyEntryWith,
    MEAL_TYPES:           MEAL_TYPES,
    mealTypeLabel:        mealTypeLabel,
    listMeals:            listMeals,
    getMeal:              getMeal,
    saveMeal:             saveMeal,
    deleteMeal:           deleteMeal,
    listMyFoods:          listMyFoods,
    getMyFood:            getMyFood,
    saveMyFood:           saveMyFood,
    deleteMyFood:         deleteMyFood,
    touchMyFood:          touchMyFood,
    listSteps:            listSteps,
    getStepsByDate:       getStepsByDate,
    saveSteps:            saveSteps,
    deleteSteps:          deleteSteps,
    listStrength:         listStrength,
    getStrength:          getStrength,
    saveStrength:         saveStrength,
    deleteStrength:       deleteStrength,
    historyOfExercise:    historyOfExercise,
    bestOfExercise:       bestOfExercise,
    listCardio:           listCardio,
    getCardio:            getCardio,
    saveCardio:           saveCardio,
    deleteCardio:         deleteCardio,
    inputMeta:            inputMeta,
    withInputMeta:        withInputMeta,
    listCalibrations:     listCalibrations,
    applyCalibration:     applyCalibration,
    resetBaseTarget:      resetBaseTarget,
    ensureMigrated:       ensureMigrated,
    exportAll:        exportAll,
    validateBackup:   validateBackup,
    importAll:        importAll
  };
})();
