/* ============================================================
   vision.js  —  画像をAIに読ませる部分
   ------------------------------------------------------------
   ここがやることは3つだけです。

     1. iPhoneで選んだ写真を、送れる大きさに縮める
     2. 中継サーバーに送る（APIキーはアプリ側には一切ありません）
     3. 返ってきた数値を検算して、おかしいものは捨てる

   【重要な方針】
   ・画面に写っていない値をこちらで作ることはしません。
   ・AIが返した値でも、ありえない数値は捨てて空欄にします。
   ・読み取った結果をそのまま保存することはありません。
     必ず確認画面（体組成の入力欄）に出して、人が確認してから保存します。

   将来ほかのAIに差し替えるときは、中継サーバー側を変えるだけで、
   このファイルはそのまま使えます。
   ============================================================ */

var App = App || {};

App.Vision = (function () {
  'use strict';

  /* 送る画像の最大の辺。文字が読める程度は保ちつつ、通信量を抑える */
  var MAX_EDGE = 1400;
  var JPEG_QUALITY = 0.85;

  /* 通信が返ってこないときに諦めるまでの時間 */
  var TIMEOUT_MS = 45000;

  /* 体組成として受け取ってよい項目と、ありえる範囲・入力できる刻み。
     刻みは体組成の入力画面と同じものです。
     オムロンの画面は「70.10」のように桁数が多いことがあるため、
     入力画面が受け付けられる刻みに合わせて丸めます。
     丸めた項目は確認画面で必ず知らせます（黙って書き換えないため）。 */
  var RANGES = {
    weightKg:          [30,  200,  0.1],
    bodyFatPct:        [3,   60,   0.1],
    fatMassKg:         [0,   100,  0.1],
    visceralLevel:     [0.5, 30,   0.5],
    skeletalMusclePct: [5,   60,   0.1],
    skeletalMuscleKg:  [0,   100,  0.1],
    bmrKcal:           [500, 3000, 1],
    bmi:               [10,  50,   0.1]
  };

  /* ---------- 中継サーバーのURL ---------- */

  function relayUrl() {
    var s = App.Storage.getSettings();
    var u = (s.relayUrl || '').trim();
    return u ? u.replace(/\/+$/, '') : '';
  }

  function isConfigured() {
    return relayUrl() !== '';
  }

  /* ---------- 写真を縮める ---------- */

  /* iPhoneの写真はそのままだと大きすぎるので、
     長いほうの辺を MAX_EDGE まで縮めてJPEGにします。 */
  function toSmallJpeg(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('画像が選ばれていません。')); return; }
      if (file.size > 30 * 1024 * 1024) { reject(new Error('画像が大きすぎます。')); return; }

      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        URL.revokeObjectURL(url);

        if (!w || !h) { reject(new Error('画像を読み込めませんでした。')); return; }

        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));

        var cv = document.createElement('canvas');
        cv.width = cw;
        cv.height = ch;
        var ctx = cv.getContext('2d');
        /* 文字を読ませるので、縮小時のぼやけを抑える */
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cw, ch);

        var dataUrl;
        try { dataUrl = cv.toDataURL('image/jpeg', JPEG_QUALITY); }
        catch (e) { reject(new Error('画像を変換できませんでした。')); return; }

        var comma = dataUrl.indexOf(',');
        resolve({
          base64: dataUrl.slice(comma + 1),
          mimeType: 'image/jpeg',
          width: cw,
          height: ch
        });
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('この画像は読み込めませんでした。別のスクリーンショットでお試しください。'));
      };

      img.src = url;
    });
  }

  /* ---------- 返ってきた値の検算 ---------- */

  /* 中継サーバー側でも同じ検算をしていますが、
     アプリ側でももう一度確認します（どちらか片方が変わっても守られるように）。 */
  function clean(fields) {
    var out = {};
    var dropped = [];
    var rounded = [];
    var key, v, r, n, snapped;

    for (key in RANGES) {
      if (!Object.prototype.hasOwnProperty.call(RANGES, key)) { continue; }
      v = fields ? fields[key] : null;
      if (v === null || v === undefined || v === '') { out[key] = null; continue; }
      n = Number(v);
      r = RANGES[key];
      if (!isFinite(n) || n < r[0] || n > r[1]) { out[key] = null; dropped.push(key); continue; }

      /* 入力画面が受け付ける刻みに合わせる */
      snapped = App.Calc.snapToStep(n, r[2]);
      if (Math.abs(snapped - n) > 1e-6) { rounded.push({ key: key, from: n, to: snapped }); }
      out[key] = snapped;
    }

    /* 日付。オムロンの画面には年が出ないことが多いので、
       月日しか読めなかった場合はここで年を補います。
       今年として計算すると未来になってしまう場合は去年とみなします。 */
    var d = fields && fields.date ? String(fields.date).trim() : '';
    var md = fields && fields.monthDay ? String(fields.monthDay).trim() : '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= App.Calc.todayStr()) {
      out.date = d;
      out.dateFromMonthDay = false;
    } else if (/^\d{2}-\d{2}$/.test(md)) {
      out.date = resolveYear(md);
      out.dateFromMonthDay = (out.date !== null);
      if (out.date === null) { dropped.push('date'); }
    } else {
      out.date = null;
      out.dateFromMonthDay = false;
      if (d || md) { dropped.push('date'); }
    }

    var t = fields && fields.time ? String(fields.time).trim() : '';
    var m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) { out.time = ('0' + m[1]).slice(-2) + ':' + m[2]; }
    else { out.time = null; if (t) { dropped.push('time'); } }

    return { fields: out, dropped: dropped, rounded: rounded };
  }

  /* "09-22" のような月日に年を当てる。
     今年だと未来になる場合（1月に12月の記録を入れたときなど）は去年にする。 */
  function resolveYear(monthDay) {
    var today = App.Calc.todayStr();
    var year = Number(today.slice(0, 4));
    var cand = year + '-' + monthDay;
    if (!isValidDate(cand)) { return null; }
    if (cand <= today) { return cand; }
    var prev = (year - 1) + '-' + monthDay;
    return isValidDate(prev) ? prev : null;
  }

  /* 2月30日のような存在しない日付をはじく */
  function isValidDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) { return false; }
    var dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return dt.getFullYear() === Number(m[1])
        && dt.getMonth() === Number(m[2]) - 1
        && dt.getDate() === Number(m[3]);
  }

  /* 読み取れた項目がいくつあるか（体重が無ければ失敗扱いにする） */
  function countFilled(fields) {
    var n = 0, k;
    for (k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k) && fields[k] !== null) { n++; }
    }
    return n;
  }

  /* ---------- 中継サーバーに送る ---------- */

  function post(payload) {
    var url = relayUrl();
    if (!url) {
      return Promise.reject(new Error('読み取りサーバーのURLが設定されていません。設定画面で登録してください。'));
    }

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) { clearTimeout(timer); }
      return res.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { /* JSONでない返答 */ }
        if (!res.ok || !body || body.ok !== true) {
          var msg = (body && body.error) ? body.error : ('読み取りに失敗しました（' + res.status + '）。');
          var err = new Error(msg);
          err.detail = body && body.detail ? body.detail : text.slice(0, 200);
          throw err;
        }
        return body;
      });
    }).catch(function (e) {
      if (timer) { clearTimeout(timer); }
      if (e && e.name === 'AbortError') {
        throw new Error('読み取りに時間がかかりすぎました。電波の良い場所でもう一度お試しください。');
      }
      if (e instanceof TypeError) {
        throw new Error('読み取りサーバーにつながりませんでした。URLと通信状態をご確認ください。');
      }
      throw e;
    });
  }

  /* ---------- 外から呼ぶのはこれだけ ---------- */

  /* 写真ファイルを渡すと、確認画面に出すための数値を返します。
     保存は一切しません。 */
  function readBodyImage(file) {
    return toSmallJpeg(file).then(function (img) {
      return post({ imageBase64: img.base64, mimeType: img.mimeType, kind: 'omron-body' });
    }).then(function (body) {
      var c = clean(body.fields);

      if (c.fields.weightKg === null) {
        var e = new Error('体重を読み取れませんでした。数値がはっきり写るように撮り直すか、手入力してください。');
        e.notes = body.notes || null;
        throw e;
      }

      return {
        fields:  c.fields,
        dropped: c.dropped,
        rounded: c.rounded,
        filled:  countFilled(c.fields),
        notes:   body.notes || null,
        model:   body.model || null,
        analyzedAt: body.analyzedAt || new Date().toISOString()
      };
    });
  }

  /* ============================================================
     トレッドミルの結果画面（2.10.0）
     ------------------------------------------------------------
     読み取るのは 経過時間・距離・カロリー・平均心拍 の4つ。
     経過時間は秒で返ってくるので、有酸素の入力欄（1分単位）に
     合わせて四捨五入します。丸めたことは確認画面で知らせます。
     日付は画面に無いので、ここでは触りません（入力画面が今日を入れます）。
     ============================================================ */

  var RANGES_TREADMILL = {
    distanceKm:  [0,  100,  0.01],
    machineKcal: [0,  3000, 1],
    avgHr:       [30, 230,  1]
  };

  function cleanTreadmill(fields) {
    var out = {};
    var dropped = [];
    var rounded = [];
    var f = fields || {};

    /* 中継サーバーの kcal → 入力画面の machineKcal に名前を合わせる */
    var src = { distanceKm: f.distanceKm, machineKcal: f.kcal, avgHr: f.avgHr };
    var key, v, n, r, snapped;
    for (key in RANGES_TREADMILL) {
      if (!Object.prototype.hasOwnProperty.call(RANGES_TREADMILL, key)) { continue; }
      v = src[key];
      if (v === null || v === undefined || v === '') { out[key] = null; continue; }
      n = Number(v);
      r = RANGES_TREADMILL[key];
      if (!isFinite(n) || n < r[0] || n > r[1]) { out[key] = null; dropped.push(key); continue; }
      snapped = App.Calc.snapToStep(n, r[2]);
      if (Math.abs(snapped - n) > 1e-6) { rounded.push({ key: key, from: n, to: snapped }); }
      out[key] = snapped;
    }

    /* 経過時間（秒）→ 分。30秒以上は切り上げ */
    var sec = Number(f.elapsed);
    if (isFinite(sec) && sec >= 60 && sec <= 300 * 60) {
      out.durationMin = Math.round(sec / 60);
      out.elapsedSec  = sec;
      if (sec % 60 !== 0) {
        rounded.push({ key: 'durationMin', from: secToLabel(sec), to: out.durationMin + '分' });
      }
    } else {
      out.durationMin = null;
      out.elapsedSec  = null;
      if (f.elapsed !== null && f.elapsed !== undefined) { dropped.push('durationMin'); }
    }

    return { fields: out, dropped: dropped, rounded: rounded };
  }

  function secToLabel(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + ('0' + s).slice(-2);
  }

  function readTreadmillImage(file) {
    return toSmallJpeg(file).then(function (img) {
      return post({ imageBase64: img.base64, mimeType: img.mimeType, kind: 'treadmill' });
    }).then(function (body) {
      var c = cleanTreadmill(body.fields);

      if (c.fields.durationMin === null) {
        var e = new Error('経過時間を読み取れませんでした。数値がはっきり写るように撮り直すか、手入力してください。');
        e.notes = body.notes || null;
        throw e;
      }

      return {
        fields:  c.fields,
        dropped: c.dropped,
        rounded: c.rounded,
        notes:   body.notes || null,
        model:   body.model || null,
        analyzedAt: body.analyzedAt || new Date().toISOString()
      };
    });
  }

  return {
    isConfigured:  isConfigured,
    relayUrl:      relayUrl,
    readBodyImage: readBodyImage,
    readTreadmillImage: readTreadmillImage,
    _cleanTreadmill: cleanTreadmill,
    /* テスト用に内部処理も出しておく */
    _clean:        clean,
    _toSmallJpeg:  toSmallJpeg
  };
})();
