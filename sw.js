/* ============================================================
   sw.js  —  サービスワーカー
   ------------------------------------------------------------
   アプリのファイルを端末に保存しておき、
   電波が悪いときやオフラインでも起動できるようにします。

   【重要】記録したデータはここではなく localStorage にあります。
   このファイルが扱うのはアプリ本体（HTML・CSS・JS）だけなので、
   キャッシュを消してもデータは消えません。

   アプリを更新したときは CACHE_NAME の番号を上げてください。
   古いキャッシュは自動で削除されます。
   ============================================================ */

var CACHE_NAME = 'weight-app-v2.10.0';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/lib/chart.umd.js',
  './js/storage.js',
  './js/calc.js',
  './js/csv.js',
  './js/app.js',
  './js/labels.js',
  './js/vision.js',
  './js/views/settings.js',
  './js/views/body.js',
  './js/views/meal.js',
  './js/views/myfoods.js',
  './js/views/basket.js',
  './js/views/steps.js',
  './js/views/strength.js',
  './js/views/cardio.js',
  './js/views/gym.js',
  './js/views/scan.js',
  './js/views/plan.js',
  './js/views/trend.js',
  './js/views/history.js',
  './js/views/home.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* ---------- インストール：ファイルを保存する ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();   /* 新しい版をすぐ使う */
    })
  );
});

/* ---------- 有効化：古いキャッシュを消す ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) { return caches.delete(k); }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- 取得：まずキャッシュ、なければ通信 ---------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* 表示以外（データ送信など）はそのまま通す */
  if (req.method !== 'GET') { return; }

  /* 別サイトのものは扱わない */
  if (new URL(req.url).origin !== self.location.origin) { return; }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        /* 表示はキャッシュから即返しつつ、裏で新しい版を取りに行く */
        fetchAndPut(req);
        return hit;
      }
      return fetch(req).then(function (res) {
        putInCache(req, res.clone());
        return res;
      }).catch(function () {
        /* オフラインでページが見つからないときはトップを返す */
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

function fetchAndPut(req) {
  fetch(req).then(function (res) {
    if (res && res.status === 200) { putInCache(req, res.clone()); }
  }).catch(function () { /* オフラインなら何もしない */ });
}

function putInCache(req, res) {
  caches.open(CACHE_NAME).then(function (cache) {
    cache.put(req, res);
  }).catch(function () { /* 保存できなくても動作に影響しない */ });
}
