/* ============================================================
   views/settings.js  —  設定画面
   ------------------------------------------------------------
   ・プロフィール／推定設定／目標の入力と保存
   ・生年月日から年齢を自動表示
   ・JSONバックアップの書き出しと復元
   ・最終バックアップ日の表示
   ============================================================ */

var App = App || {};

App.Settings = (function () {
  'use strict';

  var S = App.Storage;
  var C = App.Calc;

  /* 入力欄と設定項目の対応表 */
  var FIELDS = [
    { id: 'f-birthdate',     key: 'birthdate',           type: 'date',  label: '生年月日' },
    { id: 'f-height',        key: 'heightCm',            type: 'num',   label: '身長',     min: 100, max: 250 },
    { id: 'f-stride',        key: 'strideCm',            type: 'num',   label: '歩幅',     min: 30,  max: 120 },
    { id: 'f-beta',          key: 'beta',                type: 'num',   label: '日常活動補正 β', min: 0, max: 0.5 },
    { id: 'f-mets',          key: 'strengthMets',        type: 'num',   label: '筋トレの強度', min: 1, max: 12 },
    { id: 'f-tef',           key: 'tefRate',             type: 'pct',   label: 'TEF',      min: 0,  max: 30 },
    { id: 'f-target-weight', key: 'targetWeightKg',      type: 'num',   label: '目標体重', min: 30, max: 200 },
    { id: 'f-target-bodyfat',key: 'targetBodyFatPct',    type: 'num',   label: '目標体脂肪率', min: 3, max: 60 },
    { id: 'f-target-pace',   key: 'targetPaceKgPerWeek', type: 'num',   label: '目標ペース', min: 0, max: 2 },
    { id: 'f-min-samples',   key: 'avgMinSamples',       type: 'int',   label: '7日平均に必要な測定日数', min: 1, max: 7 },
    { id: 'f-cardio-factor', key: 'cardioFactor',        type: 'num',   label: '運動係数', min: 0.3, max: 1 },
    /* 読み取りサーバーのURL。空でも構わない（空なら読み取り機能を使わない） */
    { id: 'f-relay-url',     key: 'relayUrl',            type: 'url',   label: '読み取りサーバーのURL' },
    /* 目標日は任意。空欄なら減量強度の3段階を使う */
    { id: 'f-target-date',   key: 'targetDate',          type: 'optdate', label: '目標日' }
  ];

  var intensity = 'normal';

  function $(id) { return document.getElementById(id); }

  /* ---------- 画面に設定を流し込む ---------- */

  function fillForm() {
    var s = S.getSettings();
    FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { return; }
      var v = s[f.key];
      if (f.type === 'pct') {
        el.value = (typeof v === 'number') ? String(C.round(v * 100, 1)) : '';
      } else {
        el.value = (v === null || v === undefined) ? '' : String(v);
      }
    });
    setIntensity(s.intensity || 'normal');
    applyTheme(s.theme || 'auto');
    updateAgeDisplay();
  }

  /* ---------- 減量の強度 ---------- */

  /* ---------- 表示テーマ ----------
     auto はiPhoneの設定に合わせる。light / dark は <html> に印を付けて
     CSS 側で上書きする。選んだ瞬間に切り替わり、その場で保存する。 */

  var theme = 'auto';

  function applyTheme(v) {
    theme = (v === 'light' || v === 'dark') ? v : 'auto';
    var root = document.documentElement;
    if (theme === 'auto') { root.removeAttribute('data-theme'); }
    else { root.setAttribute('data-theme', theme); }

    var g = $('f-theme-group');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-theme') === theme);
      });
    }
  }

  function setTheme(v) {
    applyTheme(v);
    var st = S.getSettings();
    st.theme = theme;
    S.saveSettings(st);
  }

  function setIntensity(v) {
    intensity = (v === 'light' || v === 'hard') ? v : 'normal';
    var g = $('f-intensity-group');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll('.seg-btn'), function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-intensity') === intensity);
      });
    }
    var help = $('intensity-help');
    if (help) {
      var td = ($('f-target-date') && $('f-target-date').value.trim()) ? $('f-target-date').value.trim() : null;
      if (td) {
        help.textContent = '目標日が入っているため、いまは目標日からの逆算が使われます。'
                         + '強度は目標日を空欄にしたときに使われます。';
      } else {
        var d = C.intensityDeficit(intensity);
        var kgPerWeek = (d * 7 / 7200).toFixed(2);
        help.textContent = '1日あたり約' + d + 'kcalの赤字。週およそ' + kgPerWeek + 'kgのペースです。';
      }
    }
    renderBaseTarget();
  }

  /* ---------- 基本摂取目安の表示 ---------- */

  function renderBaseTarget() {
    var el = $('base-target-view');
    var note = $('base-target-note');
    var reset = $('btn-reset-base');
    if (!el) { return; }

    var s = S.getSettings();
    s.intensity = intensity;   /* 選択中の強度で試算する */
    /* 画面で編集中の目標日も反映する（保存前でも結果が見えるように） */
    if ($('f-target-date')) {
      var td = $('f-target-date').value.trim();
      s.targetDate = td || null;
    }

    var data = {
      body: S.listBody(), meals: S.listMeals(), steps: S.listSteps(),
      strength: S.listStrength(), cardio: S.listCardio()
    };
    var bt = C.baseTargetKcal(s, data, C.todayStr());

    if (bt.value === null) {
      el.textContent = '--';
      if (note) { note.textContent = '体重を記録すると計算できます。'; }
      if (reset) { reset.hidden = true; }
      return;
    }

    el.textContent = bt.value.toLocaleString('ja-JP') + ' kcal';

    if (note) {
      if (bt.source === 'manual') {
        note.textContent = '実測に合わせて手動で調整された値です。運動した分はこれに上乗せされます。';
      } else {
        var m = bt.maintenance;
        var src = s.targetDate ? '目標日からの逆算' : '減量強度';
        note.textContent = '維持カロリー ' + m.value.toLocaleString('ja-JP')
          + '（基礎代謝 ' + m.bmr + ' ＋ 日常活動 ' + m.dailyActivity
          + ' ＋ 歩行 ' + m.walking + '）から、' + src + 'ぶんの赤字 ' + bt.deficit
          + ' を引いた値です。運動した分はこれに上乗せされます。';
      }
    }
    if (reset) { reset.hidden = (bt.source !== 'manual'); }
  }

  /* ---------- 年齢の自動表示 ---------- */

  function updateAgeDisplay() {
    var el = $('age-display');
    if (!el) { return; }
    var age = C.ageFromBirthdate($('f-birthdate') ? $('f-birthdate').value : null);
    el.textContent = (age === null) ? '--' : String(age);
  }

  /* ---------- 入力値の確認 ---------- */

  function readForm() {
    var errors = [];
    var out = {};

    FIELDS.forEach(function (f) {
      var el = $(f.id);
      if (!el) { return; }
      var raw = (el.value || '').trim();

      if (f.type === 'optdate') {
        if (raw === '') { out[f.key] = null; return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) { errors.push(f.label + 'が正しくありません。'); return; }
        if (raw <= C.todayStr()) { errors.push(f.label + 'には明日以降の日付を入れてください。'); return; }
        out[f.key] = raw;
        return;
      }

      if (f.type === 'url') {
        /* 空欄でよい。入れるなら https:// で始まる形だけ受け付ける */
        if (raw === '') { out[f.key] = ''; return; }
        if (!/^https:\/\/[^\s]+$/.test(raw)) {
          errors.push(f.label + 'は https:// で始まるURLを入力してください。');
          return;
        }
        out[f.key] = raw.replace(/\/+$/, '');
        return;
      }

      if (f.type === 'date') {
        if (!raw) { errors.push(f.label + 'を入力してください。'); return; }
        if (C.ageFromBirthdate(raw) === null) { errors.push(f.label + 'が正しくありません。'); return; }
        out[f.key] = raw;
        return;
      }

      if (raw === '') { errors.push(f.label + 'を入力してください。'); return; }
      var n = Number(raw);
      if (!isFinite(n)) { errors.push(f.label + 'には数字を入力してください。'); return; }

      if (f.type === 'pct') {
        if (n < f.min || n > f.max) {
          errors.push(f.label + 'は' + f.min + '〜' + f.max + '%の範囲で入力してください。');
          return;
        }
        out[f.key] = C.round(n / 100, 4);
        return;
      }

      /* 整数だけを受け付ける項目 */
      if (f.type === 'int') {
        if (!C.isInteger(n)) {
          errors.push(f.label + 'は' + f.min + '〜' + f.max + 'の整数で入力してください。');
          return;
        }
        n = Math.round(n);
        if (n < f.min || n > f.max) {
          errors.push(f.label + 'は' + f.min + '〜' + f.max + 'の整数で入力してください。');
          return;
        }
        out[f.key] = n;
        return;
      }

      if (n < f.min || n > f.max) {
        errors.push(f.label + 'は' + f.min + '〜' + f.max + 'の範囲で入力してください。');
        return;
      }
      out[f.key] = n;
    });

    /* 性別は男性固定（Step 1 の確定仕様） */
    out.sex = 'male';
    out.intensity = intensity;

    return { values: out, errors: errors };
  }

  function showError(messages) {
    var box = $('settings-error');
    if (!box) { return; }
    if (!messages || !messages.length) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = messages.join(' ');
  }

  function flash(el, text) {
    if (!el) { return; }
    if (text) { el.textContent = text; }
    el.hidden = false;
    window.setTimeout(function () { el.hidden = true; }, 2500);
  }

  /* ---------- 保存 ---------- */

  function onSubmit(e) {
    e.preventDefault();
    var r = readForm();
    if (r.errors.length) {
      showError(r.errors);
      return;
    }
    showError(null);

    var merged = S.getSettings();
    var k;
    for (k in r.values) {
      if (Object.prototype.hasOwnProperty.call(r.values, k)) {
        merged[k] = r.values[k];
      }
    }

    var ok = S.saveSettings(merged);
    if (!ok) {
      showError(['保存できませんでした。Safariのプライベートブラウズを使っている場合は、通常モードでお試しください。']);
      return;
    }
    flash($('settings-saved'), '保存しました。');
    updateAgeDisplay();
    renderBaseTarget();
    if (App.Trend && App.Trend.render) { App.Trend.render(); }

    /* ホーム画面の表示にも反映する */
    if (App.Home && App.Home.refresh) { App.Home.refresh(); }
  }

  /* ---------- バックアップの書き出し ---------- */

  function onExport() {
    var payload = S.exportAll();
    var text = JSON.stringify(payload, null, 2);
    var blob = new Blob([text], { type: 'application/json' });

    var now = new Date();
    var stamp = now.getFullYear()
      + ('0' + (now.getMonth() + 1)).slice(-2)
      + ('0' + now.getDate()).slice(-2)
      + '-' + ('0' + now.getHours()).slice(-2)
      + ('0' + now.getMinutes()).slice(-2);

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'weight-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    S.setLastBackupAt(now.toISOString());
    renderBackupInfo();
    if (App.Home && App.Home.refresh) { App.Home.refresh(); }
  }

  /* ---------- バックアップからの復元 ---------- */

  function onImport(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) { return; }

    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try {
        obj = JSON.parse(String(reader.result));
      } catch (err) {
        flash($('import-msg'), '読み込めませんでした。JSONファイルを選んでください。');
        e.target.value = '';
        return;
      }

      var err2 = S.validateBackup(obj);
      if (err2) {
        flash($('import-msg'), err2);
        e.target.value = '';
        return;
      }

      var ok = window.confirm('現在のデータをすべて上書きして復元します。よろしいですか？');
      if (!ok) { e.target.value = ''; return; }

      var res = S.importAll(obj);
      e.target.value = '';
      if (!res.ok) {
        flash($('import-msg'), res.error);
        return;
      }
      fillForm();
      renderBackupInfo();
      if (App.Home && App.Home.refresh) { App.Home.refresh(); }
      flash($('import-msg'), '復元しました。');
    };
    reader.readAsText(file);
  }

  /* ---------- 最終バックアップ日の表示 ---------- */

  function daysSince(iso) {
    if (!iso) { return null; }
    var t = new Date(iso).getTime();
    if (isNaN(t)) { return null; }
    return Math.floor((Date.now() - t) / 86400000);
  }

  function formatDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '--'; }
    return d.getFullYear() + '/'
      + ('0' + (d.getMonth() + 1)).slice(-2) + '/'
      + ('0' + d.getDate()).slice(-2) + ' '
      + ('0' + d.getHours()).slice(-2) + ':'
      + ('0' + d.getMinutes()).slice(-2);
  }

  function renderBackupInfo() {
    var meta = S.getMeta();
    var el = $('last-backup');
    var advice = $('backup-advice');
    if (!el) { return; }

    if (!meta.lastBackupAt) {
      el.textContent = '未実施';
      if (advice) {
        advice.textContent = 'まだバックアップしていません。データを失わないよう、記録を始めたら定期的に書き出してください。';
      }
      return;
    }

    var d = daysSince(meta.lastBackupAt);
    el.textContent = formatDateTime(meta.lastBackupAt) + (d !== null ? '（' + d + '日前）' : '');

    if (advice) {
      if (d !== null && d >= 7) {
        advice.textContent = '前回のバックアップから' + d + '日が経過しています。書き出しをおすすめします。';
      } else {
        advice.textContent = '週に1回を目安にバックアップしてください。';
      }
    }
  }

  /* ---------- バージョン表示 ---------- */

  function renderVersions() {
    if ($('app-version'))    { $('app-version').textContent    = App.VERSION || '--'; }
    if ($('calc-version'))   { $('calc-version').textContent   = C.VERSION; }
    if ($('schema-version')) { $('schema-version').textContent = 'v' + S.SCHEMA_VERSION; }
  }

  /* ---------- CSV書き出し ---------- */

  function onCsvClick(ev) {
    var t = ev.target;
    while (t && t !== ev.currentTarget) {
      if (t.getAttribute && t.getAttribute('data-csv')) {
        var res = App.Csv.exportKind(t.getAttribute('data-csv'));
        flash($('csv-msg'), res.ok
          ? (res.name + 'を' + res.count + '件書き出しました。')
          : res.error);
        return;
      }
      t = t.parentNode;
    }
  }

  /* ---------- 初期化 ---------- */

  function init() {
    var csv = $('csv-list');
    if (csv) { csv.addEventListener('click', onCsvClick); }

    var tdi = $('f-target-date');
    if (tdi) {
      tdi.addEventListener('change', function () { setIntensity(intensity); });
    }

    var clr = $('btn-clear-target-date');
    if (clr) {
      clr.addEventListener('click', function () {
        if ($('f-target-date')) { $('f-target-date').value = ''; }
        setIntensity(intensity);
      });
    }

    var tg = $('f-theme-group');
    if (tg) {
      tg.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== tg) {
          if (t.getAttribute && t.getAttribute('data-theme')) {
            setTheme(t.getAttribute('data-theme'));
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var ig = $('f-intensity-group');
    if (ig) {
      ig.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== ig) {
          if (t.getAttribute && t.getAttribute('data-intensity')) {
            setIntensity(t.getAttribute('data-intensity'));
            return;
          }
          t = t.parentNode;
        }
      });
    }

    var adv = $('btn-advanced');
    if (adv) {
      adv.addEventListener('click', function () {
        var box = $('advanced-box');
        if (!box) { return; }
        box.hidden = !box.hidden;
        adv.textContent = box.hidden ? '詳細設定を開く' : '詳細設定を閉じる';
      });
    }

    var reset = $('btn-reset-base');
    if (reset) {
      reset.addEventListener('click', function () {
        if (!window.confirm('基本摂取目安を自動計算に戻します。よろしいですか？')) { return; }
        var r = S.resetBaseTarget();
        if (!r.ok) { window.alert(r.error); return; }
        renderBaseTarget();
        if (App.Home && App.Home.refresh) { App.Home.refresh(); }
      });
    }

    var form = $('settings-form');
    if (form) { form.addEventListener('submit', onSubmit); }

    var bd = $('f-birthdate');
    if (bd) { bd.addEventListener('change', updateAgeDisplay); }

    var btnExport = $('btn-export');
    if (btnExport) { btnExport.addEventListener('click', onExport); }

    var fileInput = $('f-import');
    if (fileInput) { fileInput.addEventListener('change', onImport); }

    fillForm();
    renderBackupInfo();
    renderVersions();
  }

  /* 画面を開くたびに、いまのデータで目安を計算し直す */
  function refresh() {
    setIntensity(S.getSettings().intensity || 'normal');
    renderBackupInfo();
  }

  return {
    applyTheme: applyTheme,
    init:              init,
    refresh:           refresh,
    fillForm:          fillForm,
    renderBackupInfo:  renderBackupInfo,
    daysSince:         daysSince
  };
})();
