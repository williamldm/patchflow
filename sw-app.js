/* Service worker de l'application (app.html), pour l'app installée et l'usage sans réseau.
   - app.html : réseau d'abord (4 s au plus), sinon la dernière copie gardée ; une seule copie, quelle que soit l'adresse.
   - fichiers du site versionnés (pf-*.js / pf-*.css ?v=N) : copie gardée d'abord, une seule version par fichier.
   - polices, icônes et bibliothèques (CDN) : copie gardée d'abord, mise à jour en arrière-plan.
   - les données des shows (Supabase) sont gardées par la page elle-même (voir _pfFetch dans pf-app.js).
   Le rider partagé a son propre service worker (sw-rider.js, portée /rider), qui garde la main sur ses pages. */
var CACHE = 'pf-app-v1';
var CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|cdn\.sheetjs\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
var PAGE = self.location.origin + '/app.html';

/* À l'installation : la page et les fichiers qu'elle charge d'emblée, pour qu'elle s'ouvre sans réseau */
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){
    return fetch(PAGE, { cache:'no-cache' }).then(function(res){
      if(!res.ok) return;
      return res.clone().text().then(function(html){
        var urls = [], re = /(?:src|href)="([^"]+)"/g, m;
        while((m = re.exec(html))){
          var u = m[1];
          if(/^\/?pf-[\w-]+\.(js|css)\?v=/.test(u) || u === '/favicon.svg') urls.push(new URL(u, PAGE).href);
          else if(CDN.test(u) && !/^https:\/\/[^/]+\/?$/.test(u)) urls.push(u);
        }
        return c.put(PAGE, res).then(function(){
          return Promise.all(urls.map(function(u){
            return fetch(u, { mode:'cors', credentials:'omit' }).then(function(r){ if(r.ok) return c.put(u, r); }).catch(function(){});
          }));
        });
      });
    }).catch(function(){});
  }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return /^pf-app-v/.test(k) && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

/* Garde la réponse ; pour un fichier versionné (?v=N), retire les autres versions du même fichier */
function keep(req, res){
  if(!res || (res.status !== 200 && res.type !== 'opaque')) return Promise.resolve();
  return caches.open(CACHE).then(function(c){
    var u = new URL(typeof req === 'string' ? req : req.url);
    var clean = (u.origin === self.location.origin && /^\/pf-[\w-]+\.(js|css)$/.test(u.pathname))
      ? c.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ var x = new URL(k.url); return x.pathname === u.pathname && x.search !== u.search; }).map(function(k){ return c.delete(k); })); })
      : Promise.resolve();
    return clean.then(function(){ return c.put(req, res); });
  });
}
/* Réseau, abandonné au bout de ms millisecondes (réseau qui ne répond pas) */
function net(req, ms){
  return new Promise(function(ok, ko){
    var t = setTimeout(function(){ ko(new Error('timeout')); }, ms);
    fetch(req).then(function(r){ clearTimeout(t); ok(r); }, function(err){ clearTimeout(t); ko(err); });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var u = new URL(req.url), same = u.origin === self.location.origin;

  if(same && req.mode === 'navigate' && /^\/app(\.html)?$/.test(u.pathname)){
    e.respondWith(net(req, 4000).then(function(res){ if(res.ok) keep(PAGE, res.clone()); return res; })
      .catch(function(){ return caches.match(PAGE).then(function(r){ return r || fetch(req); }); }));
    return;
  }
  if(same && /^\/pf-[\w-]+\.(js|css)$/.test(u.pathname)){
    e.respondWith(caches.match(req).then(function(hit){
      if(hit && u.search) return hit;
      return fetch(req).then(function(res){ keep(req, res.clone()); return res; })
        .catch(function(){ return hit || caches.match(req, { ignoreSearch:true }).then(function(r){ return r || Response.error(); }); });
    }));
    return;
  }
  if(same && /^\/(favicon\.svg|img\/app-[\w-]+\.png)$/.test(u.pathname)){
    e.respondWith(fetch(req).then(function(res){ keep(req, res.clone()); return res; })
      .catch(function(){ return caches.match(req).then(function(r){ return r || Response.error(); }); }));
    return;
  }
  if(CDN.test(req.url)){
    e.respondWith(caches.match(req).then(function(hit){
      var upd = fetch(req).then(function(res){ keep(req, res.clone()); return res; }).catch(function(){ return hit || Response.error(); });
      return hit || upd;
    }));
  }
});
