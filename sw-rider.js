/* Service worker du rider partagé (portée /rider) : la page et ses fichiers restent disponibles sans réseau.
   N'agit que sur les pages /rider… : l'application (app.html) n'est pas concernée.
   - rider.html et les fichiers du site (pf-*.js, pf-*.css) : réseau d'abord, copie locale si le réseau manque ;
     une seule version de chaque fichier est gardée.
   - polices, icônes et bibliothèques (CDN) : copie locale d'abord, mise à jour en arrière-plan.
   - les données du lien (appel POST à Supabase) sont gardées par la page elle-même (voir _getShared). */
var CACHE = 'pf-rider-v1';
var CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return /^pf-rider-v/.test(k) && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

/* Garde la réponse ; pour un fichier versionné (?v=N), retire les autres versions du même fichier */
function keep(req, res){
  if(!res || (res.status !== 200 && res.type !== 'opaque')) return Promise.resolve();
  return caches.open(CACHE).then(function(c){
    var u = new URL(req.url);
    var clean = (u.origin === self.location.origin && /^\/pf-[\w-]+\.(js|css)$/.test(u.pathname))
      ? c.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ var x = new URL(k.url); return x.pathname === u.pathname && x.search !== u.search; }).map(function(k){ return c.delete(k); })); })
      : Promise.resolve();
    return clean.then(function(){ return c.put(req, res); });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var u = new URL(req.url);
  var same = u.origin === self.location.origin;

  /* La page : une seule copie, quelle que soit la clé du lien dans l'adresse */
  if(same && req.mode === 'navigate' && /^\/rider(\.html)?$/.test(u.pathname)){
    var key = new Request(self.location.origin + '/rider.html');
    e.respondWith(fetch(req).then(function(res){ keep(key, res.clone()); return res; })
      .catch(function(){ return caches.match(key).then(function(r){ return r || Response.error(); }); }));
    return;
  }
  /* Fichiers du site */
  if(same && /^\/(pf-[\w-]+\.(js|css)|favicon\.svg)$/.test(u.pathname)){
    e.respondWith(fetch(req).then(function(res){ keep(req, res.clone()); return res; })
      .catch(function(){ return caches.match(req).then(function(r){ return r || caches.match(req, { ignoreSearch:true }); }).then(function(r){ return r || Response.error(); }); }));
    return;
  }
  /* Polices, icônes, bibliothèques */
  if(CDN.test(req.url)){
    e.respondWith(caches.match(req).then(function(hit){
      var net = fetch(req).then(function(res){ keep(req, res.clone()); return res; }).catch(function(){ return hit || Response.error(); });
      return hit || net;
    }));
  }
});
