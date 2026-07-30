// MY FINANCE · MY DAY · MY PROJECT — Service Worker
// ※ GitHub Pages 호환: 상대 경로 기반, scope는 등록 시 자동 결정

const CACHE_VER = 'v3';
const CACHE_NAME   = 'myday-app-'  + CACHE_VER;
const FONT_CACHE   = 'myday-fonts-' + CACHE_VER;

// 앱 핵심 파일 (상대 경로: GitHub Pages 하위 경로에서도 동작)
const STATIC_ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './modern.css',
  './sync-config.js',
  './notion-sync.js'
];

// 외부 폰트 도메인
const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ─── 설치 ───
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── 활성화: 구버전 캐시 정리 ───
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── 요청 처리 ───
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 폰트 → 캐시 우선 (오프라인 대응)
  if (FONT_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 앱 파일 → 네트워크 우선, 실패 시 캐시 (항상 최신 유지)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 외부 API → 네트워크만
  event.respondWith(
    fetch(event.request).catch(() => new Response('', { status: 503 }))
  );
});
