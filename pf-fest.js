/* ══════════════════════════════════════
   MODE FESTIVAL (Pro)
   Le programme d'une scène : chaque groupe est un créneau (jour, début, fin) relié à une input list
   (IL_PATCHES, channels.patch_id), à son output list (OUT_DATA[patch]) et, s'il en a un, à son plan
   de scène (show_scenes). Entre deux groupes qui se suivent, le changement de plateau est calculé
   voie par voie : ce qui reste, ce qui change, ce qui arrive, ce qui se libère, et le 48 V à basculer.
   On peut aussi comparer chaque groupe au patch maître de la scène.
   Rangé dans shows.stage_data.festival = { slots:[{id,pid,day,start,end,scene,note}], house, cmp },
   enregistré rubrique par rubrique (_sdPatch) comme le reste de stage_data.
   ══════════════════════════════════════ */
var FEST = { t:null, open:{}, edit:null, view:'prog', day:'all', io:'in', mic:true, full:false };
try{ var _fsPref = JSON.parse(localStorage.getItem('pf_fest_view') || '{}'); ['view','io','mic'].forEach(function(k){ if(_fsPref[k] !== undefined) FEST[k] = _fsPref[k]; }); }catch(e){}

function _fsE(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _fsId(x){ return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x); }
function _fsPad(n){ return (n < 10 ? '0' : '') + n; }
function _fsToday(){ var d = new Date(); return d.getFullYear() + '-' + _fsPad(d.getMonth() + 1) + '-' + _fsPad(d.getDate()); }
/* Heure « HH:MM » en minutes ; avant 6 h, c'est la nuit du même jour de festival (01:30 = 25:30) */
function _fsMin(t){ var m = /^(\d{1,2})[:hH](\d{2})$/.exec(String(t || '').trim()); if(!m) return null; var v = (+m[1]) * 60 + (+m[2]); return v < 360 ? v + 1440 : v; }
function _fsHM(v){ v = ((v % 1440) + 1440) % 1440; return _fsPad(Math.floor(v / 60)) + ':' + _fsPad(v % 60); }
function _fsDur(m){ if(m == null) return ''; m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + _fsPad(m % 60) : '') : m + ' min'; }
function _fsDayLbl(iso){
  if(!iso) return 'Sans date';
  try{ var d = new Date(iso + 'T12:00:00'); var s = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }); return s.charAt(0).toUpperCase() + s.slice(1); }catch(e){ return iso; }
}

/* Sources des données : l'app (CUR_SHOW, ALL_CHS, OUT_DATA, IL_PATCHES) ou, dans le rider partagé,
   un contexte en lecture seule { fest, chs, out, patches } posé par _fsWith. Pendant un affichage, les
   voies et sorties de chaque liste sont indexées une seule fois (FEST._c) au lieu d'être refiltrées à
   chaque cellule. */
var _FSX = null;
function _fsWith(ctx, fn){ var prev = _FSX, pc = FEST._c; _FSX = ctx; FEST._c = {}; try { return fn(); } finally { _FSX = prev; FEST._c = pc; } }
function _fsCached(fn){ if(FEST._c) return fn(); FEST._c = {}; try { return fn(); } finally { FEST._c = null; } }
function _fsData(){
  var f = _FSX ? _FSX.fest : (CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.festival);
  f = (f && typeof f === 'object') ? JSON.parse(JSON.stringify(f)) : {};
  /* Identifiants repris dans des onclick : uniquement lettres, chiffres, tiret et souligné */
  f.slots = Array.isArray(f.slots) ? f.slots.filter(function(s){ return s && _fsId(s.id) && _fsId(s.pid); }) : [];
  f.slots.forEach(function(s){ if(s.scene && !_fsId(s.scene)) s.scene = ''; });
  f.house = _fsId(f.house) ? f.house : '';
  f.cmp = f.cmp === 'house' ? 'house' : 'prev';
  /* Jours du festival : ceux ajoutés à la main, plus ceux des créneaux ; triés, sans doublon */
  var dd = (Array.isArray(f.days) ? f.days : []).filter(function(d){ return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); });
  f.slots.forEach(function(x){ if(/^\d{4}-\d{2}-\d{2}$/.test(x.day || '') && dd.indexOf(x.day) < 0) dd.push(x.day); });
  f.days = dd.filter(function(d, i){ return dd.indexOf(d) === i; }).sort().slice(0, 30);
  return f;
}
/* Barre des jours : filtre (Tous / chaque jour), retrait d'un jour, ajout d'un jour */
function _fsDayBar(f){
  var E = _fsE;
  if(FEST.day !== 'all' && f.days.indexOf(FEST.day) < 0) FEST.day = 'all';
  return '<div class="fs-days" role="group" aria-label="Jours du festival">'
    + (f.days.length > 1 ? '<button type="button" class="fs-dayb' + (FEST.day === 'all' ? ' on' : '') + '" onclick="festDay(\'all\')">Tous</button>' : '')
    + f.days.map(function(d){
      var n = f.slots.filter(function(x){ return x.day === d; }).length, lb = _fsDayLbl(d).split(' ');
      return '<span class="fs-dayb' + (FEST.day === d ? ' on' : '') + '"><button type="button" onclick="festDay(\'' + _jsq(d) + '\')" title="' + E(_fsDayLbl(d)) + ' · ' + n + ' groupe' + (n > 1 ? 's' : '') + '">' + E(lb[0]) + ' <small>' + E(lb[1] || '') + '</small></button>'
        + '<button type="button" class="fs-dayx" onclick="festDelDay(\'' + _jsq(d) + '\')" title="Retirer ce jour" aria-label="Retirer ' + E(_fsDayLbl(d)) + '"><i class="ti ti-x"></i></button></span>';
    }).join('')
    + '<button type="button" class="fs-dayb add" onclick="festAddDay()"><i class="ti ti-plus"></i>Jour</button></div>';
}
function festDay(d){ FEST.day = d; renderFestival(); }
function festAddDay(){
  var f = _fsData(), last = f.days[f.days.length - 1], base = last || (typeof _showDateISO === 'function' && _showDateISO(CUR_SHOW.show_date)) || _fsToday();
  var nx = base; if(last){ var t = new Date(last + 'T12:00:00'); t.setDate(t.getDate() + 1); nx = t.getFullYear() + '-' + _fsPad(t.getMonth() + 1) + '-' + _fsPad(t.getDate()); }
  var m = document.getElementById('fest-modal');
  if(!m){ m = document.createElement('div'); m.id = 'fest-modal'; m.className = 'modal-ov'; m.addEventListener('click', function(e){ if(e.target === m) festClose(); }); document.body.appendChild(m); }
  m.innerHTML = '<div class="modal-box fs-box" style="width:min(400px,94vw)"><div class="modal-head"><span class="modal-title">Ajouter un jour</span><button class="modal-close" onclick="festClose()" aria-label="Fermer"><i class="ti ti-x"></i></button></div>'
    + '<div class="modal-body fs-form"><label class="fs-f"><span>Date</span><input class="pdf-inp" type="date" id="fs-newday" value="' + _fsE(nx) + '"></label>'
    + (f.days.length ? '<p class="fs-hint">Jours déjà au programme : ' + f.days.map(function(d){ return _fsE(_fsDayLbl(d)); }).join(', ') + '.</p>' : '') + '</div>'
    + '<div class="modal-foot"><button class="btn" onclick="festClose()">Annuler</button><button class="btn pri" onclick="festAddDayOk()"><i class="ti ti-check"></i>Ajouter</button></div></div>';
  m.classList.add('show');
  setTimeout(function(){ var i = document.getElementById('fs-newday'); if(i) i.focus(); }, 60);
}
function festAddDayOk(){
  var el = document.getElementById('fs-newday'), d = el ? String(el.value || '') : '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast('Choisissez une date.'); return; }
  var f = _fsData();
  if(f.days.indexOf(d) < 0){ f.days.push(d); f.days.sort(); _fsSave(f); }
  FEST.day = d; festClose(); renderFestival();
  toast('✓ ' + _fsDayLbl(d) + ' ajouté : ajoutez-y des groupes.');
}
function festDelDay(d){
  var f = _fsData(), n = f.slots.filter(function(x){ return x.day === d; }).length;
  if(n && !confirm('Retirer ' + _fsDayLbl(d) + ' et ses ' + n + ' groupe' + (n > 1 ? 's' : '') + ' du programme ?\nLeurs input lists et output lists restent dans le show.')) return;
  f.slots = f.slots.filter(function(x){ return x.day !== d; });
  f.days = f.days.filter(function(x){ return x !== d; });
  if(FEST.day === d) FEST.day = 'all';
  _fsSave(f); renderFestival(); _fsSync();
}
function _fsSave(f){
  if(!CUR_SHOW) return;
  CUR_SHOW.stage_data = Object.assign({}, CUR_SHOW.stage_data || { v:2 }, { festival:f });
  var show = CUR_SHOW;
  clearTimeout(FEST.t);
  FEST.t = setTimeout(async function(){
    if(typeof setSaving === 'function') setSaving(true);
    var r = await _sdPatch(show, ['festival']);
    if(typeof setSaving === 'function') setSaving(false);
    if(r && r.error) toast('Programme non enregistré : ' + r.error.message);
  }, 450);
}
function _fsSorted(f){
  return f.slots.slice().sort(function(a, b){
    return String(a.day || '').localeCompare(String(b.day || '')) || ((_fsMin(a.start) || 0) - (_fsMin(b.start) || 0));
  });
}
function _fsSlotOf(pid){ var f = _fsData(); return _fsSorted(f).find(function(s){ return s.pid === pid; }) || null; }
function _fsPatches(){ return _FSX ? (_FSX.patches || []) : (typeof IL_PATCHES !== 'undefined' ? IL_PATCHES : []); }
function _fsPatch(pid){ return _fsPatches().find(function(p){ return p && p.id === pid; }) || null; }
function _fsName(pid){ var p = _fsPatch(pid); return p ? p.name : 'Liste supprimée'; }
function _fsChs(pid){
  var c = FEST._c; if(c && c['i:' + pid]) return c['i:' + pid];
  var all = _FSX ? (_FSX.chs || []) : ((typeof ALL_CHS !== 'undefined' && ALL_CHS.length) ? ALL_CHS : (typeof CHS !== 'undefined' ? CHS : []));
  var r = all.filter(function(x){ return (x.patch_id || 'main') === pid; }).slice().sort(function(a, b){ return a.ch - b.ch; });
  if(c) c['i:' + pid] = r;
  return r;
}
function _fsOuts(pid){
  var c = FEST._c; if(c && c['o:' + pid]) return c['o:' + pid];
  var od = _FSX ? (_FSX.out || {}) : (typeof OUT_DATA !== 'undefined' ? OUT_DATA : {});
  var r = (Array.isArray(od[pid]) ? od[pid] : []).slice().sort(function(a, b){ return (a.ch || 0) - (b.ch || 0); });
  if(c) c['o:' + pid] = r;
  return r;
}
function _fsHf(r){ return String((r.custom_data && r.custom_data._hf) || '').trim(); }
function _fsLbl(r){ return String(r.long_name || r.short_name || '').trim(); }
function _fsN(s){ return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/* ── Changement de plateau : voie par voie, puis sortie par sortie ── */
function _fsDiff(aPid, bPid){
  var am = {}, bm = {}, max = 0, res = { same:0, chg:[], add:[], free:[], p48:[], hf:[], outs:[], nA:0, nB:0 };
  _fsChs(aPid).forEach(function(r){ am[r.ch] = r; max = Math.max(max, r.ch); res.nA++; });
  _fsChs(bPid).forEach(function(r){ bm[r.ch] = r; max = Math.max(max, r.ch); res.nB++; });
  for(var ch = 1; ch <= max; ch++){
    var a = am[ch], b = bm[ch];
    if(!a && b) res.add.push({ ch:ch, b:b });
    else if(a && !b) res.free.push({ ch:ch, a:a });
    else if(a && b){
      var same = _fsN(_fsLbl(a)) === _fsN(_fsLbl(b)) && _fsN(a.mic) === _fsN(b.mic);
      if(same) res.same++; else res.chg.push({ ch:ch, a:a, b:b });
    }
    if(b && !!b.phantom !== !!(a && a.phantom) && (b.phantom || a)) res.p48.push({ ch:ch, on:!!b.phantom, b:b });
    else if(a && !b && a.phantom) res.p48.push({ ch:ch, on:false, b:null });
    if(b && _fsHf(b) && _fsHf(b) !== (a ? _fsHf(a) : '')) res.hf.push({ ch:ch, b:b });
  }
  var oa = {}, ob = {}, omax = 0;
  _fsOuts(aPid).forEach(function(o){ oa[o.ch] = o; omax = Math.max(omax, o.ch || 0); });
  _fsOuts(bPid).forEach(function(o){ ob[o.ch] = o; omax = Math.max(omax, o.ch || 0); });
  for(var oc = 1; oc <= omax; oc++){
    var x = oa[oc], y = ob[oc];
    if(!x && !y) continue;
    var nm = function(o){ return o ? _fsN((o.long_name || o.short_name || '') + '|' + (o.type || '')) : ''; };
    if(nm(x) !== nm(y) || (y && String(y.hf || '') !== String(x && x.hf || ''))) res.outs.push({ ch:oc, a:x || null, b:y || null });
  }
  return res;
}
function _fsDiffSum(d){
  var t = [];
  if(d.same) t.push('<span class="fs-chip">' + d.same + ' identique' + (d.same > 1 ? 's' : '') + '</span>');
  if(d.chg.length) t.push('<span class="fs-chip chg">' + d.chg.length + ' à changer</span>');
  if(d.add.length) t.push('<span class="fs-chip add">+' + d.add.length + ' voie' + (d.add.length > 1 ? 's' : '') + '</span>');
  if(d.free.length) t.push('<span class="fs-chip free">' + d.free.length + ' libérée' + (d.free.length > 1 ? 's' : '') + '</span>');
  if(d.p48.length) t.push('<span class="fs-chip p48"><i class="ti ti-bolt"></i>' + d.p48.length + ' en 48 V</span>');
  if(d.outs.length) t.push('<span class="fs-chip">' + d.outs.length + ' retour' + (d.outs.length > 1 ? 's' : '') + ' modifié' + (d.outs.length > 1 ? 's' : '') + '</span>');
  if(d.hf.length) t.push('<span class="fs-chip">' + d.hf.length + ' HF</span>');
  return t.join('') || '<span class="fs-chip">Rien ne change</span>';
}
function _fsDiffList(d){
  var E = _fsE, row = function(cls, ch, txt){ return '<li class="' + cls + '"><b>' + ch + '</b><span>' + txt + '</span></li>'; };
  var lm = function(r){ return E(_fsLbl(r) || 'sans nom') + (r.mic ? ' <em>' + E(r.mic) + '</em>' : ''); };
  var h = '';
  d.chg.forEach(function(x){ h += row('chg', 'CH ' + x.ch, lm(x.a) + ' <i class="ti ti-arrow-right"></i> ' + lm(x.b)); });
  d.add.forEach(function(x){ h += row('add', 'CH ' + x.ch, 'arrive&nbsp;: ' + lm(x.b)); });
  d.free.forEach(function(x){ h += row('free', 'CH ' + x.ch, 'libérée (était ' + lm(x.a) + ')'); });
  d.p48.forEach(function(x){ h += row('p48', 'CH ' + x.ch, '<i class="ti ti-bolt"></i>48 V à ' + (x.on ? 'activer' : 'couper') + (x.b ? ' · ' + E(_fsLbl(x.b)) : '')); });
  d.hf.forEach(function(x){ h += row('hf', 'CH ' + x.ch, 'HF ' + E(_fsHf(x.b)) + ' MHz · ' + E(_fsLbl(x.b))); });
  d.outs.forEach(function(x){
    var o = function(v){ return v ? E(v.long_name || v.short_name || 'sortie') + (v.hf ? ' <em>' + E(v.hf) + ' MHz</em>' : '') : '—'; };
    h += row('out', 'OUT ' + x.ch, o(x.a) + ' <i class="ti ti-arrow-right"></i> ' + o(x.b));
  });
  return h ? '<ul class="fs-diff">' + h + '</ul>' : '<div class="fs-none">Même patch : rien à toucher.</div>';
}

/* ── Maintenant / suivant, sur le jour en cours ── */
function _fsNow(f){
  var today = _fsToday(), list = _fsSorted(f).filter(function(s){ return s.day === today; });
  if(!list.length) return null;
  var d = new Date(), now = d.getHours() * 60 + d.getMinutes(); if(now < 360) now += 1440;
  var cur = null, next = null;
  list.forEach(function(s){
    var a = _fsMin(s.start), b = _fsMin(s.end); if(b != null && a != null && b < a) b += 1440;
    if(a != null && b != null && now >= a && now < b) cur = s;
    if(a != null && a > now && !next) next = s;
  });
  return { cur:cur, next:next, now:now };
}
function _fsNowHtml(f, compact){
  var n = _fsNow(f); if(!n || (!n.cur && !n.next)) return '';
  var E = _fsE, h = '<div class="fs-now' + (compact ? ' sm' : '') + '">';
  if(n.cur) h += '<div><span class="fs-live"><i></i>Sur scène</span><b>' + E(_fsName(n.cur.pid)) + '</b><span>jusqu\'à ' + E(n.cur.end) + '</span></div>';
  if(n.next){
    var dt = _fsMin(n.next.start) - n.now;
    h += '<div><span class="fs-next">Ensuite</span><b>' + E(_fsName(n.next.pid)) + '</b><span>à ' + E(n.next.start) + ' · dans ' + _fsDur(dt) + '</span></div>';
  }
  return h + '</div>';
}

/* ── Page ── */
function renderFestival(){ return _fsCached(_renderFestival); }
function _renderFestival(){
  var root = document.getElementById('fest-root'); if(!root) return;
  var E = _fsE;
  if(!CUR_SHOW){
    root.innerHTML = '<div class="dt-empty"><i class="ti ti-calendar-event"></i><div class="dt-empty-t">Aucun show ouvert</div><div class="dt-empty-s">Choisissez une session pour préparer le programme du festival.</div><button class="btn pri" onclick="goTab(\'sessions\',null)">Voir les sessions</button></div>';
    return;
  }
  var head = _fsHead(false);
  if(!canDo('multi_patches')){
    root.innerHTML = head + '<section class="fs-gate"><div class="fs-gate-ic"><i class="ti ti-calendar-time"></i></div>'
      + '<div><b>Le mode festival est inclus dans l\'offre Pro</b><ul>'
      + '<li>Le programme par jour, sur une frise, avec les temps de changement</li>'
      + '<li>Une input list et une output list par groupe, dans le même show</li>'
      + '<li>Pour chaque changement de plateau&nbsp;: voies qui changent, voies libérées, 48 V à basculer, retours et HF</li>'
      + '<li>Comparaison avec le patch maître de la scène, feuille de changements à imprimer</li></ul>'
      + '<button class="btn pri" onclick="showUpgradeModal(\'festival\')"><i class="ti ti-sparkles"></i>Découvrir Pro</button></div></section>';
    return;
  }
  var f = _fsData(), slots = _fsSorted(f);
  head = _fsHead(slots.length > 0);

  if(!slots.length && !f.days.length){
    var spare = (IL_PATCHES || []).length;
    root.innerHTML = head + '<div class="pbar il-bar"><div class="il-row a"><button class="btn pri" onclick="festEdit()"><i class="ti ti-plus"></i>Groupe</button></div></div><section class="fs-empty"><i class="ti ti-calendar-time"></i><b>Construisez le programme de la scène</b>'
      + '<span>Ajoutez les groupes dans l\'ordre de passage, avec leurs horaires. Chacun reçoit son input list (vide, copiée du patch maître, ou une liste existante).</span>'
      + '<div class="fs-empty-a"><button class="btn pri" onclick="festEdit()"><i class="ti ti-plus"></i>Ajouter le premier groupe</button>'
      + (spare > 1 || (spare === 1 && _fsChs(IL_PATCHES[0].id).length) ? '<button class="btn" onclick="festFromPatches()"><i class="ti ti-list-numbers"></i>Mettre ' + (spare > 1 ? 'les ' + spare + ' input lists' : 'l\'input list actuelle') + ' au programme</button>' : '')
      + '</div></section>';
    return;
  }

  if(FEST.view === 'grid'){ _fsRenderGrid(root, f, slots); return; }
  root.classList.remove('fs-gridmode', 'fs-full');

  /* Réglages : patch maître et comparaison */
  var opts = '<option value="">Aucun</option>' + (IL_PATCHES || []).map(function(p){ return '<option value="' + E(p.id) + '"' + (p.id === f.house ? ' selected' : '') + '>' + E(p.name) + '</option>'; }).join('');
  var h = head + '<div class="pbar il-bar"><div class="il-row a">'
    + '<button class="btn pri" onclick="festEdit()"><i class="ti ti-plus"></i>Groupe</button>'
    + _fsDayBar(f)
    + _fsRefSel(f)
    + '<span class="il-bar-sp"></span>'
    + '<button class="btn" onclick="festShare()" title="Lien de partage en lecture seule"><i class="ti ti-link"></i><span class="fs-lbl">Lien de partage</span></button>'
    + '<button class="btn" id="fest-exp-btn" onclick="festOpenExport()"><i class="ti ti-file-export"></i><span class="fs-lbl">Exporter</span></button>'
    + '</div></div>' + _fsNowHtml(f, false);

  /* Un bloc par jour : frise, puis groupes et changements */
  var days = {}, order = f.days.slice();
  order.forEach(function(d){ days[d] = []; });
  slots.forEach(function(s){ var k = s.day || ''; if(!days[k]){ days[k] = []; order.push(k); } days[k].push(s); });
  if(FEST.day !== 'all') order = order.filter(function(d){ return d === FEST.day; });
  order.forEach(function(day){
    var list = days[day], lo = Infinity, hi = -Infinity;
    if(!list.length){
      h += '<section class="fs-day"><div class="fs-day-hd"><h2>' + E(_fsDayLbl(day)) + '</h2><span>aucun groupe</span></div>'
        + '<button type="button" class="fs-day-empty" onclick="festEdit(null,null,\'' + _jsq(day) + '\')"><i class="ti ti-plus"></i>Ajouter un groupe ce jour-là</button></section>';
      return;
    }
    list.forEach(function(s){ var a = _fsMin(s.start), b = _fsMin(s.end); if(a != null) lo = Math.min(lo, a); if(b != null){ if(a != null && b < a) b += 1440; hi = Math.max(hi, b); } });
    if(!isFinite(lo)){ lo = 18 * 60; } if(!isFinite(hi) || hi <= lo) hi = lo + 60;
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    var span = hi - lo, pct = function(v){ return ((v - lo) / span * 100).toFixed(3) + '%'; };
    var ticks = ''; for(var t = lo; t <= hi; t += 60) ticks += '<span class="' + (t === lo ? 'first' : t === hi ? 'last' : '') + '" style="left:' + pct(t) + '">' + _fsHM(t).slice(0, 2) + 'h</span>';
    var blocks = list.map(function(s, i){
      var a = _fsMin(s.start), b = _fsMin(s.end); if(a == null) return ''; if(b == null || b <= a) b = (b != null && b < a) ? b + 1440 : a + 45;
      return '<button type="button" class="fs-blk c' + (i % 6) + '" style="left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')" onclick="festJump(\'' + _jsq(s.id) + '\')" title="' + E(_fsName(s.pid) + ' · ' + s.start + '–' + s.end) + '"><b>' + E(_fsName(s.pid)) + '</b><span>' + E(s.start) + '</span></button>';
    }).join('');
    var nowMark = '';
    if(day === _fsToday()){ var n = _fsNow(f); if(n && n.now >= lo && n.now <= hi) nowMark = '<i class="fs-nowline" style="left:' + pct(n.now) + '"></i>'; }
    h += '<section class="fs-day"><div class="fs-day-hd"><h2>' + E(_fsDayLbl(day)) + '</h2><span>' + list.length + ' groupe' + (list.length > 1 ? 's' : '') + '</span></div>'
      + '<div class="fs-tl"><div class="fs-tl-ticks">' + ticks + '</div><div class="fs-tl-track">' + blocks + nowMark + '</div></div><div class="fs-list">';
    list.forEach(function(s, i){
      var prev = i > 0 ? list[i - 1] : null;
      var ref = (f.cmp === 'house' && f.house) ? (f.house !== s.pid ? f.house : null) : (prev ? prev.pid : null);
      if(ref){
        var d = _fsDiff(ref, s.pid), gap = null;
        if(prev && f.cmp !== 'house'){ var pe = _fsMin(prev.end), ns = _fsMin(s.start); if(pe != null && ns != null) gap = ns - pe; }
        var op = !!FEST.open[s.id];
        h += '<div class="fs-chg' + (op ? ' open' : '') + '"><button type="button" class="fs-chg-hd" onclick="festToggle(\'' + _jsq(s.id) + '\')" aria-expanded="' + op + '">'
          + '<i class="ti ti-arrows-exchange"></i><span class="fs-chg-t">' + (f.cmp === 'house' && f.house ? 'Par rapport au patch maître' : 'Changement de plateau' + (gap != null ? ' · ' + (gap >= 0 ? _fsDur(gap) : '<em class="fs-warn">chevauchement</em>') : '')) + '</span>'
          + '<span class="fs-chips">' + _fsDiffSum(d) + '</span><i class="ti ti-chevron-down fs-chev"></i></button>'
          + (op ? _fsDiffList(d) : '') + '</div>';
      }
      var nIn = _fsChs(s.pid).length, nOut = _fsOuts(s.pid).length, nHf = _fsChs(s.pid).filter(function(r){ return _fsHf(r); }).length;
      var sc = s.scene && SHOW_SCENES.stage ? SHOW_SCENES.stage.find(function(x){ return x.id === s.scene; }) : null;
      h += '<article class="fs-card" id="fs-' + E(s.id) + '"><div class="fs-time"><b>' + E(s.start || '—') + '</b><span>' + E(s.end || '') + '</span></div>'
        + '<div class="fs-main"><div class="fs-name">' + E(_fsName(s.pid)) + (s.pid === f.house ? '<span class="fs-house">patch maître</span>' : '') + '</div>'
        + '<div class="fs-meta"><span>' + nIn + ' voie' + (nIn > 1 ? 's' : '') + '</span><span>' + nOut + ' sortie' + (nOut > 1 ? 's' : '') + '</span>' + (nHf ? '<span>' + nHf + ' HF</span>' : '') + (s.note ? '<span class="fs-note">' + E(s.note) + '</span>' : '') + '</div>'
        + '<div class="fs-acts"><button class="btn sm" onclick="festOpen(\'' + _jsq(s.pid) + '\',\'in\')"><i class="ti ti-list-numbers"></i>Input list</button>'
        + '<button class="btn sm" onclick="festOpen(\'' + _jsq(s.pid) + '\',\'out\')"><i class="ti ti-arrow-bar-to-right"></i>Output list</button>'
        + '<button class="btn sm" onclick="festScene(\'' + _jsq(s.id) + '\')"><i class="ti ti-layout-board"></i>' + (sc ? 'Plan' : 'Créer le plan') + '</button>'
        + '<button class="btn ghost sm" onclick="festShift(\'' + _jsq(s.id) + '\')" title="Retard ou avance : décaler ce groupe et les suivants du même jour"><i class="ti ti-hourglass"></i></button>'
        + '<button class="btn ghost sm" onclick="festEdit(\'' + _jsq(s.id) + '\')" title="Horaires et liste"><i class="ti ti-clock-edit"></i></button></div></div></article>';
    });
    h += '</div></section>';
  });

  /* Input lists hors programme */
  var used = {}; slots.forEach(function(s){ used[s.pid] = 1; });
  var free = (IL_PATCHES || []).filter(function(p){ return !used[p.id] && _fsId(p.id); });
  if(free.length) h += '<section class="fs-free"><span>Hors programme</span>' + free.map(function(p){
    return '<button type="button" onclick="festEdit(null,\'' + _jsq(p.id) + '\')"><i class="ti ti-plus"></i>' + E(p.name) + (p.id === f.house ? ' · patch maître' : '') + '</button>';
  }).join('') + '</section>';
  root.innerHTML = h;
}


/* ── Vue d'ensemble : toutes les voies en lignes, le patch maître puis chaque groupe en colonne ──
   En clair et en italique : la voie ne change pas (même source et même micro que la référence, patch
   maître ou groupe précédent). En gras : elle change. « — » : voie libre. Un clic ouvre la liste du groupe. */

/* Vue d'ensemble : une barre unique (vues, référence, jours, entrées/sorties, actions), puis le tableau sur
   toute la hauteur. « Agrandir » le passe en plein écran (Échap pour revenir). */
/* En-tête de la page, identique à celui de l'input list : nom du show, titre, et le sélecteur de vue
   (Programme / Patch) dans la même pastille que IN / OUT. En vue Patch, IN / OUT juste à côté. */
function _fsHead(withViews){
  var E = _fsE, grid = FEST.view === 'grid', out = FEST.io === 'out';
  return '<header class="il-head"><div class="il-head-t"><div class="il-eyebrow">' + E(CUR_SHOW.name || '') + '</div><h1 class="il-title">Festival</h1></div>'
    + (withViews ? '<div class="plan-mode-bar il-mode" role="group" aria-label="Vue"><button class="pmb' + (grid ? '' : ' on') + '" onclick="festView(\'prog\')"><i class="ti ti-calendar-time"></i>Programme</button>'
      + '<button class="pmb' + (grid ? ' on' : '') + '" onclick="festView(\'grid\')"><i class="ti ti-table"></i>Patch</button></div>'
      + (grid ? '<div class="plan-mode-bar il-mode" role="group" aria-label="Entrées ou sorties"><button class="pmb' + (out ? '' : ' on') + '" onclick="festGrid(\'io\',\'in\')">IN</button><button class="pmb' + (out ? ' on' : '') + '" onclick="festGrid(\'io\',\'out\')">OUT</button></div>' : '') : '')
    + '</header>';
}
/* « Comparer à » : groupe précédent ou une liste prise comme patch maître, dans un bouton de la barre */
function _fsRefSel(f){
  var E = _fsE;
  var o = '<option value="prev"' + (f.cmp !== 'house' ? ' selected' : '') + '>Comparer au groupe précédent</option>'
    + _fsPatches().filter(function(p){ return _fsId(p.id); }).map(function(p){ return '<option value="h:' + E(p.id) + '"' + (f.cmp === 'house' && f.house === p.id ? ' selected' : '') + '>Comparer au patch maître : ' + E(p.name) + '</option>'; }).join('');
  return '<label class="btn fs-sel" title="Référence des changements"><i class="ti ti-git-compare"></i><select onchange="festRef(this.value)" aria-label="Comparer à">' + o + '</select><i class="ti ti-chevron-down il-chev"></i></label>';
}
function _fsRenderGrid(root, f, slots){
  var E = _fsE, out = FEST.io === 'out';
  root.classList.add('fs-gridmode'); root.classList.toggle('fs-full', !!FEST.full);
  var bar = '<div class="pbar il-bar"><div class="il-row a">'
    + _fsRefSel(f)
    + _fsDayBar(f)
    + '<button class="btn' + (FEST.mic ? ' on' : '') + '" onclick="festGrid(\'mic\')"><i class="ti ti-' + (out ? 'tag' : 'microphone') + '"></i>' + (out ? 'Types' : 'Micros') + '</button>'
    + '<span class="il-bar-sp"></span>'
    + '<button class="btn" onclick="festShare()" title="Lien de partage en lecture seule"><i class="ti ti-link"></i><span class="fs-lbl">Lien de partage</span></button>'
    + '<button class="btn" id="fest-exp-btn" onclick="festOpenExport()"><i class="ti ti-file-export"></i><span class="fs-lbl">Exporter</span></button>'
    + '<button class="btn fs-full-btn" onclick="festFull()" title="' + (FEST.full ? 'Quitter le plein écran (Échap)' : 'Tableau en plein écran') + '"><i class="ti ti-' + (FEST.full ? 'minimize' : 'maximize') + '"></i>' + (FEST.full ? 'Réduire' : 'Plein écran') + '</button>'
    + '</div></div>';
  root.innerHTML = _fsHead(true) + bar + _fsGridHtml(f, slots);
}
function festRef(v){
  var f = _fsData();
  if(v === 'prev') f.cmp = 'prev';
  else if(/^h:/.test(v) && _fsId(v.slice(2))){ f.house = v.slice(2); f.cmp = 'house'; }
  _fsSave(f); renderFestival();
}
function festFull(){ FEST.full = !FEST.full; renderFestival(); }
document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && FEST.full){ FEST.full = false; renderFestival(); } });
function festView(v){ FEST.view = v === 'grid' ? 'grid' : 'prog'; if(FEST.view !== 'grid') FEST.full = false; _fsPrefSave(); renderFestival(); }
function festGrid(k, v){ if(k === 'day') FEST.day = v; if(k === 'io') FEST.io = v === 'out' ? 'out' : 'in'; if(k === 'mic') FEST.mic = !FEST.mic; _fsPrefSave(); renderFestival(); }
function _fsPrefSave(){ try{ localStorage.setItem('pf_fest_view', JSON.stringify({ view:FEST.view, io:FEST.io, mic:FEST.mic })); }catch(e){} }
function _fsGridHtml(f, slots, ro){
  var E = _fsE, out = FEST.io === 'out';
  var dayList = []; slots.forEach(function(s){ if(dayList.indexOf(s.day || '') < 0) dayList.push(s.day || ''); });
  if(FEST.day !== 'all' && dayList.indexOf(FEST.day) < 0) FEST.day = 'all';
  var cols = slots.filter(function(s){ return FEST.day === 'all' || (s.day || '') === FEST.day; });
  var house = f.house && _fsPatch(f.house) ? f.house : '';
  var useHouse = f.cmp === 'house' && house;
  /* Lignes d'une liste, rangées par numéro */
  var rowsOf = function(pid){
    var m = {};
    if(out) _fsOuts(pid).forEach(function(o){ if(o.ch) m[o.ch] = { l:String(o.long_name || o.short_name || '').trim(), mic:String(o.type || ''), hf:String(o.hf || ''), p48:false }; });
    else _fsChs(pid).forEach(function(r){ m[r.ch] = { l:_fsLbl(r), mic:String(r.mic || '').trim(), hf:_fsHf(r), p48:!!r.phantom }; });
    return m;
  };
  var key = function(c){ return c ? _fsN(c.l) + '|' + _fsN(c.mic) : ''; };
  var colData = cols.map(function(s){ return { s:s, m:rowsOf(s.pid) }; });
  var hm = useHouse ? rowsOf(house) : null;   /* la colonne du patch maître seulement quand on s'y compare */
  var hcol = !!hm && !cols.some(function(s){ return s.pid === house; });   /* et pas en double s'il joue dans les colonnes affichées */
  var max = 0;
  colData.forEach(function(c){ Object.keys(c.m).forEach(function(k){ max = Math.max(max, +k); }); });
  if(hm) Object.keys(hm).forEach(function(k){ max = Math.max(max, +k); });
  var TYPES = { main:'Façade', sub:'Sub', mon:'Retour', iem:'IEM', fx:'Effet', group:'Groupe', matrix:'Matrice', aux:'Aux' };
  var sub = function(c){ return out ? (TYPES[c.mic] || c.mic) : c.mic; };

  var tools = '<div class="fsg-tools"><div class="fsg-leg"><span class="same">identique</span><span class="chg">à changer</span><span>— libre</span>' + (out ? '' : '<span><i class="ti ti-bolt"></i>48 V</span>') + '</div></div>';
  if(!max) return tools + '<div class="fs-none" style="padding:18px 4px">Aucune ' + (out ? 'sortie' : 'voie') + ' dans ces listes pour l\'instant.</div>';

  var head = '<tr><th class="fsg-ch">' + (out ? 'OUT' : 'CH') + '</th>'
    + (hm && hcol ? '<th class="fsg-house"><small>Patch maître</small><b>' + E(_fsName(house)) + '</b></th>' : '')
    + colData.map(function(c, i){
      var s = c.s, ref = useHouse ? (s.pid === house ? null : hm) : (i > 0 ? colData[i - 1].m : null), nChg = 0;
      if(ref) for(var k = 1; k <= max; k++){ if(key(c.m[k]) !== key(ref[k]) && (c.m[k] || ref[k])) nChg++; }
      return '<th' + (useHouse && s.pid === house ? ' class="fsg-ishouse"' : '') + '><small>' + E(_fsDayLbl(s.day).split(' ')[0]) + ' · ' + E(s.start || '') + (s.end ? '–' + E(s.end) : '') + (useHouse && s.pid === house ? ' · patch maître' : '') + '</small><b>' + E(_fsName(s.pid)) + '</b>'
        + '<span class="fsg-n">' + Object.keys(c.m).length + ' ' + (out ? 'sorties' : 'voies') + (ref ? ' · <em>' + nChg + ' à changer</em>' : '') + '</span></th>';
    }).join('') + '</tr>';

  var body = '';
  for(var ch = 1; ch <= max; ch++){
    var h0 = hm ? hm[ch] : null;
    var allSame = colData.every(function(c){ return key(c.m[ch]) === key(colData[0].m[ch]); }) && (!hm || key(h0) === key(colData[0].m[ch]));
    body += '<tr' + (allSame ? ' class="fsg-common"' : '') + '><td class="fsg-ch">' + ch + '</td>';
    if(hm && hcol) body += '<td class="fsg-house">' + (h0 ? '<b>' + E(h0.l || 'sans nom') + '</b>' + (FEST.mic && h0.mic ? '<small>' + E(sub(h0)) + '</small>' : '') : '<span class="fsg-free">—</span>') + '</td>';
    colData.forEach(function(c, i){
      var cell = c.m[ch], ref = useHouse ? (c.s.pid === house ? null : hm) : (i > 0 ? colData[i - 1].m : null);
      var same = ref ? key(cell) === key(ref[ch]) : false;
      var cls = !cell ? 'free' : (ref ? (same ? 'same' : 'chg') : 'first');
      var t = !cell ? '<span class="fsg-free">—</span>'
        : '<b>' + E(cell.l || 'sans nom')
          + (ref && ((cell.p48 && (!ref[ch] || !ref[ch].p48)) || (!cell.p48 && ref[ch] && ref[ch].p48)) ? '<i class="ti ti-bolt fsg-48' + (cell.p48 ? '' : ' off') + '" title="48 V ' + (cell.p48 ? 'à activer' : 'à couper') + '"></i>' : (cell.p48 ? '<i class="ti ti-bolt fsg-48 keep" title="48 V"></i>' : ''))
          + (cell.hf ? '<em class="fsg-hf">' + E(cell.hf) + '</em>' : '') + '</b>'
          + (FEST.mic && cell.mic ? '<small>' + E(sub(cell)) + '</small>' : '');
      if(ro){ body += '<td class="' + cls + '">' + t + '</td>'; return; }
      body += '<td class="' + cls + '" onclick="festOpen(\'' + _jsq(c.s.pid) + '\',\'' + (out ? 'out' : 'in') + '\')" title="' + E(_fsName(c.s.pid)) + ' · ' + (out ? 'OUT ' : 'CH ') + ch + '">' + t + '</td>';
    });
    body += '</tr>';
  }
  return tools + '<div class="fsg-wrap"><table class="fsg">' + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}


/* ── Retard : décaler un groupe et tous ceux qui le suivent le même jour ── */
function festShift(slotId){
  var f = _fsData(), s = f.slots.find(function(x){ return x.id === slotId; }); if(!s) return;
  var v = prompt('Décaler « ' + _fsName(s.pid) + ' » et les groupes suivants du ' + _fsDayLbl(s.day).toLowerCase() + ' de combien de minutes ?\n(négatif pour avancer, ex. 15 ou -10)', '15');
  if(v == null) return;
  var m = parseInt(String(v).replace(/[^\d-]/g, ''), 10); if(!m || Math.abs(m) > 720){ toast('Indiquez un nombre de minutes.'); return; }
  var from = _fsMin(s.start), n = 0;
  f.slots.forEach(function(x){
    if(x.day !== s.day || _fsMin(x.start) == null || _fsMin(x.start) < from) return;
    x.start = _fsHM(_fsMin(x.start) + m); if(_fsMin(x.end) != null) x.end = _fsHM(_fsMin(x.end) + m); n++;
  });
  _fsSave(f); renderFestival(); _fsSync();
  toast('✓ ' + n + ' groupe' + (n > 1 ? 's' : '') + ' décalé' + (n > 1 ? 's' : '') + ' de ' + (m > 0 ? '+' : '') + m + ' min');
}

/* ── Exporter : la même fenêtre que l'input list et les plans (openPDFModal), avec ses réglages d'en-tête,
   logo et couleurs, le choix PDF ou CSV et « Vers Fichiers ». Ici : le patch (entrées ou sorties), ou les changements. ── */
var _FX_PARTS = [['prog', 'Programme', 'ti-calendar-time', 'Jour, horaire, voies, sorties, +48V, HF'], ['in', 'Patch · entrées', 'ti-list-numbers', 'Toutes les voies, un groupe par colonne'],
  ['out', 'Patch · sorties', 'ti-arrow-bar-to-right', 'Retours et ears, un groupe par colonne'], ['chg', 'Changements de plateau', 'ti-arrows-exchange', 'Voie par voie : à changer, arrive, libérée, +48V']];
function festOpenExport(){
  /* Préréglage : ce que l'on regarde à l'écran */
  if(!FEST.xs) FEST.xs = FEST.view === 'grid' ? { prog:false, in:FEST.io !== 'out', out:FEST.io === 'out', chg:false } : { prog:true, in:true, out:false, chg:true };
  FEST.xd = FEST.day;
  if(typeof openPDFModal === 'function') openPDFModal('fest');
}
function festXp(k){ if(!FEST.xs) FEST.xs = {}; FEST.xs[k] = !FEST.xs[k]; if(!Object.keys(FEST.xs).some(function(x){ return FEST.xs[x]; })) FEST.xs[k] = true; _fxRefresh(); }
function festXpDay(d){ FEST.xd = d; _fxRefresh(); }
function festXpMic(){ FEST.mic = !FEST.mic; _fsPrefSave(); _fxRefresh(); }
function festXpRef(v){ festRef(v); _fxRefresh(); }
function festXpPreset(k){
  FEST.xs = k === 'plateau' ? { prog:true, in:false, out:false, chg:true } : k === 'facade' ? { prog:true, in:true, out:false, chg:false } : k === 'retours' ? { prog:true, in:false, out:true, chg:false } : { prog:true, in:true, out:true, chg:true };
  _fxRefresh();
}
function _fxRefresh(){ if(typeof setPdfExportType === 'function') setPdfExportType('fest'); }
function _fxSel(){ var x = FEST.xs || { in:true }; return _FX_PARTS.map(function(p){ return p[0]; }).filter(function(k){ return x[k]; }); }
/* La partie propre au festival dans la fenêtre Exporter commune */
function festXpSync(on){
  var row = document.getElementById('pdf-fest-row'); if(row) row.style.display = on ? '' : 'none';
  if(!on || !row) return;
  var E = _fsE, f = _fsData(), x = FEST.xs || {}, sel = _fxSel();
  if(FEST.xd !== 'all' && f.days.indexOf(FEST.xd) < 0) FEST.xd = 'all';
  var nG = f.slots.filter(function(s){ return FEST.xd === 'all' || s.day === FEST.xd; }).length;
  var refO = '<option value="prev"' + (f.cmp !== 'house' ? ' selected' : '') + '>au groupe précédent</option>' + _fsPatches().filter(function(p){ return _fsId(p.id); }).map(function(p){ return '<option value="h:' + E(p.id) + '"' + (f.cmp === 'house' && f.house === p.id ? ' selected' : '') + '>au patch maître : ' + E(p.name) + '</option>'; }).join('');
  row.innerHTML = '<div class="fx-pre"><span class="xp-lbl">Pour</span>'
      + [['plateau', 'Régie plateau'], ['facade', 'Façade'], ['retours', 'Retours'], ['tout', 'Dossier complet']].map(function(q){ return '<button type="button" onclick="festXpPreset(\'' + q[0] + '\')">' + q[1] + '</button>'; }).join('') + '</div>'
    + '<div class="fx-parts">' + _FX_PARTS.map(function(p){
      return '<button type="button" class="fx-part' + (x[p[0]] ? ' on' : '') + '" onclick="festXp(\'' + p[0] + '\')" aria-pressed="' + !!x[p[0]] + '"><i class="ti ' + p[2] + '"></i><span><b>' + p[1] + '</b><small>' + p[3] + '</small></span><em class="fx-ck"><i class="ti ti-check"></i></em></button>';
    }).join('') + '</div>'
    + '<div class="xp-row"><span class="xp-lbl">Jours</span><div class="xp-seg"><button type="button" class="xp-seg-b' + (FEST.xd === 'all' ? ' on' : '') + '" onclick="festXpDay(\'all\')">Tous</button>'
      + f.days.map(function(d){ var l = _fsDayLbl(d).split(' '); return '<button type="button" class="xp-seg-b' + (FEST.xd === d ? ' on' : '') + '" onclick="festXpDay(\'' + _jsq(d) + '\')">' + E(l[0] + ' ' + (l[1] || '')) + '</button>'; }).join('') + '</div>'
      + '<span class="xp-hint">' + nG + ' groupe' + (nG > 1 ? 's' : '') + '</span></div>'
    + ((x.in || x.out || x.chg) ? '<div class="xp-row"><span class="xp-lbl">Comparer</span><select class="pdf-inp fx-ref" onchange="festXpRef(this.value)">' + refO + '</select>'
      + ((x.in || x.out) ? '<label class="fx-mic"><input type="checkbox" class="cb"' + (FEST.mic ? ' checked' : '') + ' onchange="festXpMic()"/>' + (x.out && !x.in ? 'Types de sortie' : 'Micros') + ' sous chaque nom</label>' : '') + '</div>' : '');
  /* CSV : un fichier par tableau coché (le changement de plateau reste en PDF) */
  var hint = document.getElementById('pdf-fmt-hint');
  if(hint && typeof _pdfCurFmt === 'function' && _pdfCurFmt() === 'csv'){
    var n = sel.filter(function(k){ return k !== 'chg'; }).length;
    hint.textContent = n + ' fichier' + (n > 1 ? 's' : '') + ' CSV' + (x.chg ? ' · les changements de plateau ne sont qu\'en PDF' : '');
  }
}
function _fxFormats(){ var sel = _fxSel(); return sel.length === 1 && sel[0] === 'chg' ? ['pdf'] : ['pdf', 'csv']; }
function festDoExport(fmt, toFiles){
  var v = function(id){ var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  var meta = { eng:v('pdf-eng'), role:v('pdf-role'), title:v('pdf-title'), co:v('pdf-co'), tel:v('pdf-tel'), venue:v('pdf-venue'), date:v('pdf-date'), rev:v('pdf-rev'), notes:v('pdf-notes') };
  var lk = document.getElementById('pdf-incl-link'); meta.inclLink = !lk || lk.checked;
  var sel = _fxSel(), keep = FEST.day; FEST.day = FEST.xd || 'all';
  var done = function(){ FEST.day = keep; };
  if(fmt === 'csv'){ try { festCsvAll(sel.filter(function(k){ return k !== 'chg'; })); } finally { done(); } return; }
  festDossierPdf(meta, !!toFiles, sel).then(done, done);
}
/* Lignes du patch (entrées ou sorties) pour l'export : [{ch, cells:[{t, mic, st}]}] avec st = same|chg|free|first */
function _fsMatrix(f, out){
  var slots = _fsSorted(f).filter(function(s){ return FEST.day === 'all' || s.day === FEST.day; });
  var useHouse = f.cmp === 'house' && f.house && _fsPatch(f.house);
  var rowsOf = function(pid){ var m = {}; if(out) _fsOuts(pid).forEach(function(o){ if(o.ch) m[o.ch] = { l:String(o.long_name || o.short_name || ''), mic:({ main:'Façade', sub:'Sub', mon:'Retour', iem:'IEM', fx:'Effet', group:'Groupe', matrix:'Matrice', aux:'Aux' })[o.type] || String(o.type || '') }; }); else _fsChs(pid).forEach(function(r){ m[r.ch] = { l:_fsLbl(r), mic:String(r.mic || ''), p48:!!r.phantom }; }); return m; };
  var key = function(c){ return c ? _fsN(c.l) + '|' + _fsN(c.mic) : ''; };
  var cols = slots.map(function(s){ return { s:s, m:rowsOf(s.pid) }; });
  var hm = useHouse ? rowsOf(f.house) : null, max = 0;
  cols.concat(hm ? [{ m:hm }] : []).forEach(function(c){ Object.keys(c.m).forEach(function(k){ max = Math.max(max, +k); }); });
  var rows = [];
  for(var ch = 1; ch <= max; ch++){
    var cells = cols.map(function(c, i){
      var x = c.m[ch], ref = hm ? (c.s.pid === f.house ? null : hm) : (i > 0 ? cols[i - 1].m : null);
      return { t:x ? x.l : '', mic:x ? x.mic : '', p48:!!(x && x.p48), st:!x ? 'free' : (ref ? (key(x) === key(ref[ch]) ? 'same' : 'chg') : 'first') };
    });
    rows.push({ ch:ch, house:hm && hm[ch] ? hm[ch] : null, cells:cells });
  }
  return { cols:cols.map(function(c){ return c.s; }), house:hm ? _fsName(f.house) : '', rows:rows };
}
function _fxDownload(rows, name){
  var q = function(v){ v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(function(r){ return r.map(q).join(';'); }).join('\n')], { type:'text/csv;charset=utf-8' }));
  a.download = ((typeof _pdfSlug === 'function' && _pdfSlug(CUR_SHOW.name)) || 'festival') + '-' + name + '.csv';
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
function festCsvAll(parts){
  _fsCached(function(){
    var f = _fsData();
    parts.forEach(function(k, i){
      setTimeout(function(){
        if(k === 'prog'){ _fxDownload([['Jour', 'Horaire', 'Groupe', 'Voies', 'Sorties', '+48V', 'HF', 'Note']].concat(_festProgRows(f)), 'programme'); return; }
        var out = k === 'out', M = _fsMatrix(f, out);
        var rows = [[out ? 'OUT' : 'CH'].concat(M.house ? ['Patch maître : ' + M.house, ''] : []).concat([].concat.apply([], M.cols.map(function(s){ return [_fsName(s.pid) + ' (' + _fsDayLbl(s.day) + ' ' + (s.start || '') + ')', out ? 'Type' : 'Micro']; })))];
        M.rows.forEach(function(r){
          var l = [r.ch].concat(M.house ? [r.house ? r.house.l : '', r.house ? r.house.mic : ''] : []);
          r.cells.forEach(function(c){ l.push(c.t + (c.st === 'chg' ? ' *' : '') + (c.p48 ? ' (+48V)' : ''), c.mic); });
          rows.push(l);
        });
        rows.push([], ['* : à changer par rapport au ' + (M.house ? 'patch maître' : 'groupe précédent')]);
        _fxDownload(rows, 'patch-' + (out ? 'sorties' : 'entrees'));
      }, i * 350);
    });
  });
}
/* ── Lien en ligne repris dans le QR des PDF : un lien nommé du show qui contient la rubrique Festival
   (créé une fois, puis réutilisé ; il se met à jour avec le show). null si impossible (hors ligne, limite). ── */
async function _festLiveUrl(){
  if(!CUR_SHOW || typeof sb === 'undefined') return null;
  try {
    var r = await sb.from('show_riders').select('id, name, sections, code').eq('show_id', CUR_SHOW.id).order('created_at');
    var list = (r && !r.error && Array.isArray(r.data)) ? r.data : [];
    var hit = list.find(function(l){ return Array.isArray(l.sections) && l.sections.indexOf('fest') >= 0; });
    if(!hit){
      var secs = ['fest', 'road', 'il', 'out'];
      var cfg = typeof _buildLinkConfig === 'function' ? await _buildLinkConfig(secs) : {};
      var ins = await sb.from('show_riders').insert({ show_id:CUR_SHOW.id, name:'Festival · PDF', sections:secs, config:cfg, code:_genLinkCode() }).select().maybeSingle();
      if(ins.error || !ins.data) return null;
      hit = ins.data;
      if(typeof _proLinks !== 'undefined' && _lastLinksShowId === CUR_SHOW.id) _proLinks.push(hit);
    }
    return _riderBase() + '?link=' + (hit.code || hit.id);
  } catch(e){ console.warn('[festival] lien', e); return null; }
}

/* ── PDF à la charte des autres exports (même en-tête, mêmes tableaux sans grille, même pied avec QR) ── */
async function _festPdfBase(meta, docType){
  var JsPDF = await _loadAutoTable(), doc = new JsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
  var brand = _pdfBrand(), acc = _hex2rgb(brand.color || '#ff6b1a'), K = _PDFK;
  var pf = null; try { pf = await _pfLogoPng('#FF6B2B'); } catch(e){}
  var logo = await _pdfLogoInfo(brand.logo);
  var url = meta.inclLink ? await _festLiveUrl() : null, qr = null;
  if(url){ try { var q = await _qrImage(url, { px:320 }); qr = q && q.dataUrl; } catch(e){} }
  var f = _fsData(), days = []; _fsSorted(f).forEach(function(s){ if((FEST.day === 'all' || s.day === FEST.day) && days.indexOf(s.day) < 0) days.push(s.day); });
  var when = days.length > 1 ? 'du ' + _fsDayLbl(days[0]).toLowerCase() + ' au ' + _fsDayLbl(days[days.length - 1]).toLowerCase() : (days[0] ? _fsDayLbl(days[0]) : '');
  var title = meta.title || CUR_SHOW.name || 'Festival', venue = meta.venue || CUR_SHOW.venue || '';
  var y = _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:docType, title:title, sub:meta.title && CUR_SHOW.name !== meta.title ? CUR_SHOW.name : '', logo:logo,
    rightLines:[meta.rev ? 'Révision ' + meta.rev : '', 'Édité le ' + new Date().toLocaleDateString('fr-FR')].filter(Boolean),
    meta:[['Lieu', venue], ['Dates', when], ['Réalisé par', [meta.eng, meta.role].filter(Boolean).join(' · ')], ['Société', meta.co], ['Contact', meta.tel]] });
  var PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 12, TOP = 30, BOT = _pdfFootH(!!qr) + 4;
  var TBL = { theme:'plain', margin:{ left:M, right:M, top:TOP, bottom:BOT },
    styles:{ font:'helvetica', fontSize:7.8, cellPadding:{ top:1.4, bottom:1.4, left:1.8, right:1.8 }, textColor:K.ink, lineColor:K.line, lineWidth:{ bottom:0.2 }, valign:'middle', overflow:'linebreak' },
    headStyles:{ fontSize:6.3, fontStyle:'bold', textColor:K.muted, lineColor:K.ink, lineWidth:{ bottom:0.35 }, valign:'bottom' } };
  var sect = function(t, n, yy){ doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(K.ink[0], K.ink[1], K.ink[2]); doc.text(t, M, yy); var tw = doc.getTextWidth(t);
    if(n !== '' && n != null){ doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(K.muted[0], K.muted[1], K.muted[2]); doc.text(String(n), M + tw + 2.5, yy); } };
  var note = function(t, yy){ doc.setFont('helvetica', 'normal'); doc.setFontSize(7.3); doc.setTextColor(K.muted[0], K.muted[1], K.muted[2]); doc.text(t, M, yy); };
  var finish = async function(fileName){
    if(meta.notes){
      var yy = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 10;
      if(yy > PH - BOT - 18){ doc.addPage(); yy = TOP + 4; }
      sect('Notes techniques', '', yy); yy += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(K.txt2[0], K.txt2[1], K.txt2[2]);
      doc.splitTextToSize(meta.notes, PW - 2 * M).forEach(function(l){ if(yy > PH - BOT - 4){ doc.addPage(); yy = TOP; } doc.text(l, M, yy); yy += 4.2; });
    }
    var n = doc.internal.getNumberOfPages();
    for(var p = 1; p <= n; p++){
      doc.setPage(p);
      if(p > 1) _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:docType, title:title, compact:true, right:[venue, when].filter(Boolean).join(' · ') });
      _pdfFoot(doc, { acc:acc, pf:pf, credit:_pdfCreditOn(), creditWhat:'festival', qr:p === 1 ? qr : null, url:url || '', qrNote:'Scannez : programme et patch du festival, toujours à jour', stamp:p === 1 ? '' : title, page:p, pages:n });
    }
    await _pdfDeliver(doc, ((typeof _pdfSlug === 'function' && _pdfSlug(title)) || 'festival') + '-' + fileName + '.pdf');
  };
  return { doc:doc, K:K, acc:acc, y:y, PW:PW, PH:PH, M:M, TOP:TOP, BOT:BOT, TBL:TBL, sect:sect, note:note, finish:finish, f:f };
}
/* Programme du jour (ou de tout le festival) : une ligne par groupe */
function _festProgRows(f){
  return _fsSorted(f).filter(function(s){ return FEST.day === 'all' || s.day === FEST.day; }).map(function(s){
    var ins = _fsChs(s.pid), p48 = ins.filter(function(r){ return r.phantom; }).length, hf = ins.filter(function(r){ return _fsHf(r); }).length;
    return [_fsDayLbl(s.day), (s.start || '—') + (s.end ? ' – ' + s.end : ''), _fsName(s.pid), String(ins.length), String(_fsOuts(s.pid).length), p48 ? String(p48) : '', hf ? String(hf) : '', s.note || ''];
  });
}
/* Ligne du patch d'une cellule autotable, retrouvée par son numéro de voie (les lignes coupées entre deux
   pages sont renumérotées par autotable : l'index ne suffit pas) */
function _fxRow(M, d){
  var raw = d && d.row && d.row.raw, ch = raw && raw.length ? parseInt(raw[0], 10) : NaN;
  return isNaN(ch) ? null : (M.rows[ch - 1] && M.rows[ch - 1].ch === ch ? M.rows[ch - 1] : M.rows.find(function(r){ return r.ch === ch; }) || null);
}
async function festDossierPdf(meta, toFiles, sel){
  meta = meta || {}; sel = sel && sel.length ? sel : ['in'];
  if(typeof _pdfSaveToFiles !== 'undefined') _pdfSaveToFiles = !!toFiles;
  if(typeof _loadAutoTable !== 'function'){ toast('Export PDF indisponible.'); return; }
  toast('Génération PDF…');
  var LBL = { prog:'programme', in:'patch des entrées', out:'patch des sorties', chg:'changements de plateau' };
  try {
    await _fsCached(async function(){
      var B = await _festPdfBase(meta, 'Festival · ' + (sel.length === 1 ? LBL[sel[0]] : 'dossier technique'));
      var doc = B.doc, K = B.K, f = B.f, first = true;
      if(!_fsSorted(f).some(function(s){ return FEST.day === 'all' || s.day === FEST.day; })){ toast('Aucun groupe au programme ' + (FEST.day === 'all' ? '' : 'ce jour-là') + '.'); return; }
      B.cy = B.y + 4;
      var part = function(){ if(!first){ doc.addPage(); B.cy = B.TOP + 6; } first = false; };
      if(sel.indexOf('prog') >= 0){
        part();
        var rowsP = _festProgRows(f);
        B.sect('Programme', rowsP.length + ' groupe' + (rowsP.length > 1 ? 's' : ''), B.cy);
        doc.autoTable(Object.assign({}, B.TBL, { startY:B.cy + 3, head:[['JOUR', 'HORAIRE', 'GROUPE', 'VOIES', 'SORTIES', '+48V', 'HF', 'NOTE']], body:rowsP,
          columnStyles:{ 0:{ cellWidth:38, textColor:K.txt2 }, 1:{ cellWidth:26, font:'courier', fontStyle:'bold', textColor:B.acc }, 2:{ fontStyle:'bold', cellWidth:56 }, 3:{ halign:'center', cellWidth:14 }, 4:{ halign:'center', cellWidth:16 }, 5:{ halign:'center', cellWidth:13, textColor:B.acc }, 6:{ halign:'center', cellWidth:11 }, 7:{ textColor:K.txt2 } } }));
        B.cy = doc.lastAutoTable.finalY + 10;
        /* Le programme seul tient en tête de la partie suivante quand il est court */
        if(rowsP.length <= 8 && sel.length > 1) first = true;
      }
      ['in', 'out'].forEach(function(k){
        if(sel.indexOf(k) < 0) return;
        var out = k === 'out', M = _fsMatrix(f, out);
        if(!M.rows.length) return;
        part();
      var per = M.house ? 4 : 5, chunks = [];
      for(var i = 0; i < M.cols.length; i += per) chunks.push(i);
      var yy = B.cy;
      chunks.forEach(function(start, ci){
        var cols = M.cols.slice(start, start + per);
        if(yy > B.PH - B.BOT - 40){ doc.addPage(); yy = B.TOP + 4; }
        B.sect('Patch des ' + (out ? 'sorties' : 'entrées'), chunks.length > 1 ? 'groupes ' + (start + 1) + ' à ' + (start + cols.length) + ' sur ' + M.cols.length : '', yy);
        var head = [(out ? 'OUT' : 'CH')].concat(M.house ? ['PATCH MAÎTRE\n' + M.house.toUpperCase()] : []).concat(cols.map(function(s){ return (_fsDayLbl(s.day).split(' ')[0] + ' ' + (s.start || '')).toUpperCase() + '\n' + _fsName(s.pid); }));
        var off = M.house ? 2 : 1;
        var body = M.rows.map(function(r){
          return [String(r.ch)].concat(M.house ? [r.house ? r.house.l + (r.house.mic ? '\n' + r.house.mic : '') : '—'] : [])
            .concat(cols.map(function(s, j){ var c = r.cells[start + j]; return c.st === 'free' ? '—' : c.t + (c.p48 && !out ? '  +48V' : '') + (c.mic && FEST.mic ? '\n' + c.mic : ''); }));
        });
        var cw = (B.PW - 2 * B.M - 10 - (M.house ? 38 : 0)) / cols.length, cs = { 0:{ halign:'center', fontStyle:'bold', cellWidth:10, textColor:B.acc } };
        if(M.house) cs[1] = { cellWidth:38, textColor:K.txt2, fillColor:[247, 246, 243] };
        doc.autoTable(Object.assign({}, B.TBL, { startY:yy + 3, head:[head], body:body, columnStyles:cs, rowPageBreak:'avoid',
          didParseCell:function(d){
            if(d.section === 'head' && d.column.index >= off){ d.cell.styles.textColor = K.ink; d.cell.styles.fontSize = 6.8; }
            if(d.section !== 'body' || d.column.index < off) return;
            d.cell.styles.cellWidth = cw;
            var rr = _fxRow(M, d); var c = rr && rr.cells[start + d.column.index - off]; if(!c) return;
            if(c.st === 'same'){ d.cell.styles.textColor = [158, 158, 158]; d.cell.styles.fontStyle = 'italic'; }
            else if(c.st === 'chg'){ d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = K.ink; }
            else if(c.st === 'free'){ d.cell.styles.textColor = [200, 200, 200]; }
          },
          didDrawCell:function(d){
            if(d.section !== 'body' || d.column.index < off) return;
            var rr = _fxRow(M, d); var c = rr && rr.cells[start + d.column.index - off];
            if(c && c.st === 'chg'){ doc.setFillColor(245, 181, 30); doc.rect(d.cell.x + 0.2, d.cell.y + 0.6, 0.9, d.cell.height - 1.2, 'F'); }
          } }));
        yy = doc.lastAutoTable.finalY + 4;
        B.note('Gras avec un trait jaune : à changer par rapport au ' + (M.house ? 'patch maître' : 'groupe précédent') + '   ·   gris : identique   ·   — : libre' + (out ? '' : '   ·   +48V : alimentation fantôme'), yy);
        yy += 10;
      });
      B.cy = yy;
      });
      if(sel.indexOf('chg') >= 0){
        part();
      var list = _fsSorted(f).filter(function(s){ return FEST.day === 'all' || s.day === FEST.day; });
      var y = B.cy, lastDay = null;
      list.forEach(function(s, i){
        var prev = i > 0 && list[i - 1].day === s.day ? list[i - 1] : null;
        var ref = (f.cmp === 'house' && f.house) ? (f.house !== s.pid ? f.house : null) : (prev ? prev.pid : null);
        if(s.day !== lastDay){
          if(y > B.PH - B.BOT - 30){ doc.addPage(); y = B.TOP + 4; }
          B.sect(_fsDayLbl(s.day), '', y); lastDay = s.day; y += 6;
        }
        if(y > B.PH - B.BOT - 26){ doc.addPage(); y = B.TOP + 4; }
        doc.setFont('courier', 'bold'); doc.setFontSize(9.5); doc.setTextColor(B.acc[0], B.acc[1], B.acc[2]); doc.text((s.start || '—') + (s.end ? '–' + s.end : ''), B.M, y);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(K.ink[0], K.ink[1], K.ink[2]); doc.text(_fsName(s.pid), B.M + 30, y);
        var nw = doc.getTextWidth(_fsName(s.pid));
        if(s.note){ doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(K.muted[0], K.muted[1], K.muted[2]); doc.text(s.note, B.M + 30 + nw + 4, y); }
        y += 2;
        var pl = function(n, w){ return n + ' ' + w + (n > 1 ? 's' : ''); };
        if(!ref){ B.note('Premier passage : ' + pl(_fsChs(s.pid).length, 'voie') + ' et ' + pl(_fsOuts(s.pid).length, 'sortie') + ' à installer.', y + 3.5); y += 10; return; }
        var d = _fsDiff(ref, s.pid), rows = [];
        var lm = function(r){ return (_fsLbl(r) || 'sans nom') + (r.mic ? '  (' + r.mic + ')' : ''); };
        d.chg.forEach(function(x){ rows.push(['CH ' + x.ch, 'À changer', lm(x.a), lm(x.b)]); });
        d.add.forEach(function(x){ rows.push(['CH ' + x.ch, 'Arrive', '—', lm(x.b)]); });
        d.free.forEach(function(x){ rows.push(['CH ' + x.ch, 'Libérée', lm(x.a), '—']); });
        d.p48.forEach(function(x){ rows.push(['CH ' + x.ch, x.on ? '+48V à activer' : '+48V à couper', '', x.b ? _fsLbl(x.b) : '']); });
        d.hf.forEach(function(x){ rows.push(['CH ' + x.ch, 'HF', '', _fsHf(x.b) + ' MHz · ' + _fsLbl(x.b)]); });
        d.outs.forEach(function(x){ var o = function(v){ return v ? (v.long_name || v.short_name || 'sortie') + (v.hf ? '  (' + v.hf + ' MHz)' : '') : '—'; }; rows.push(['OUT ' + x.ch, 'Retour', o(x.a), o(x.b)]); });
        var head = [['VOIE', 'ACTION', (f.cmp === 'house' && f.house ? 'PATCH MAÎTRE · ' + _fsName(f.house) : 'AVANT · ' + _fsName(prev.pid)).toUpperCase(), ('APRÈS · ' + _fsName(s.pid)).toUpperCase()]];
        if(!rows.length) rows = [['', 'Rien à changer', '', '']];
        doc.autoTable(Object.assign({}, B.TBL, { startY:y + 1.5, head:head, body:rows,
          columnStyles:{ 0:{ cellWidth:18, font:'courier', fontStyle:'bold', textColor:B.acc }, 1:{ cellWidth:32, fontStyle:'bold' }, 2:{ textColor:[150, 150, 150] }, 3:{ fontStyle:'bold' } },
          didParseCell:function(c){ if(c.section === 'body' && c.column.index === 1 && /48V/.test(String(c.cell.raw))) c.cell.styles.textColor = [212, 63, 63]; } }));
        y = doc.lastAutoTable.finalY + 3.5;
        B.note([pl(d.same, 'identique'), d.chg.length + ' à changer', d.add.length + (d.add.length > 1 ? ' arrivent' : ' arrive'), pl(d.free.length, 'libérée'), pl(d.p48.length, 'bascule') + ' +48V'].join('  ·  '), y);
        y += 9;
      });
      B.cy = y;
      }
      await B.finish(sel.length === 1 ? ({ prog:'programme', in:'patch-entrees', out:'patch-sorties', chg:'changements-de-plateau' })[sel[0]] : 'dossier-festival');
    });
  } catch(e){ console.error('festDossierPdf:', e); toast('Export impossible : ' + (e && e.message || e)); }
}
function festShare(){
  if(typeof _riderSections !== 'undefined'){ _riderSections.fest = true; _riderSections.road = true; }
  goTab('team', null);
  setTimeout(function(){
    if(typeof _syncRiderBtns === 'function') _syncRiderBtns();
    var i = document.getElementById('link-form-name'); if(i){ if(!i.value) i.value = 'Programme du festival'; i.focus(); }
    toast('Rubriques Festival et Feuille de route cochées : créez le lien.');
  }, 120);
}

/* ── Rider partagé : la rubrique Festival, en lecture seule ──
   Quatre vues (programme, patch des entrées, des sorties, changements de plateau), un filtre par jour,
   « sur scène / ensuite » le jour même. Le patch occupe toute la largeur, en-têtes et voies figés.
   Chaque groupe renvoie à son input list et à son output list dans le même rider. */
var FSV = { v:'prog', d:'all', off:0 };
function festSv(k, v){ FSV[k] = v; if(k === 'v') FSV.picked = true; if(typeof window._svFest === 'function') window._svFest(); }

/* ── Direct (rider partagé) : l'heure de l'appareil dit qui est sur scène, quel changement de plateau
   arrive et ce qu'il faut toucher. FSV.off décale l'horloge pour un aperçu (« voir la suite »). ── */
function _fsClock(){ return new Date(Date.now() + (FSV.off || 0)); }
/* Jour du festival : avant 6 h, on est encore dans la soirée de la veille */
function _fsFestDay(d){ var x = new Date(d.getTime() - 6 * 3600e3); return x.getFullYear() + '-' + _fsPad(x.getMonth() + 1) + '-' + _fsPad(x.getDate()); }
function _fsLive(f, d){
  var day = _fsFestDay(d), now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; if(now < 360) now += 1440;
  var dated = f.slots.some(function(s){ return s.day; });
  var list = _fsSorted(f).filter(function(s){ return (dated ? s.day === day : true) && _fsMin(s.start) != null; });
  var T = list.map(function(s, i){
    var a = _fsMin(s.start), b = _fsMin(s.end);
    if(b != null && b <= a) b += 1440;
    if(b == null){ var n = list[i + 1]; b = n ? _fsMin(n.start) : a + 60; }
    return { s:s, a:a, b:b };
  });
  var L = { day:day, now:now, T:T, cur:-1, next:-1, last:-1, dated:dated };
  T.forEach(function(t, i){ if(now >= t.a && now < t.b) L.cur = i; if(t.b <= now) L.last = i; if(t.a > now && L.next < 0) L.next = i; });
  L.phase = !T.length ? 'off' : L.cur >= 0 ? 'show' : (L.next >= 0 && L.last >= 0) ? 'chg' : L.next >= 0 ? 'before' : 'done';
  return L;
}
function _fsIn(m){ m = Math.ceil(m); return m <= 0 ? 'maintenant' : 'dans ' + _fsDur(m); }
/* En direct, on compare à ce qui est réellement sur scène juste avant (le groupe précédent) ;
   le patch maître ne sert que pour le premier groupe de la journée */
function _fsLiveRef(f, L, i){ var s = L.T[i].s; return i > 0 ? (L.T[i - 1].s.pid !== s.pid ? L.T[i - 1].s.pid : null) : (f.cmp === 'house' && f.house && f.house !== s.pid ? f.house : null); }
function _fsLiveActs(pid){
  var no = _fsOuts(pid).length;
  return '<div class="fsv-acts"><button type="button" onclick="window._svOpenPatch&&_svOpenPatch(\'' + _jsq(pid) + '\',\'il\')"><i class="ti ti-list-numbers"></i>Input list</button>'
    + (no ? '<button type="button" onclick="window._svOpenPatch&&_svOpenPatch(\'' + _jsq(pid) + '\',\'out\')"><i class="ti ti-arrow-bar-to-right"></i>Output list</button>' : '') + '</div>';
}
function _fsLiveHtml(f){
  var E = _fsE, d = _fsClock(), L = _fsLive(f, d), T = L.T, h = '<div class="fsl">';
  var bar = function(p){ p = Math.max(0, Math.min(1, p)); return '<div class="fsl-bar"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div>'; };
  h += '<div class="fsl-top"><span class="fsl-on' + (FSV.off ? ' sim' : '') + '"><i></i>' + (FSV.off ? 'Aperçu' : 'En direct') + '</span>'
    + '<b class="fsl-clock">' + _fsPad(d.getHours()) + ':' + _fsPad(d.getMinutes()) + '</b>'
    + '<span class="fsl-day">' + E(L.dated ? _fsDayLbl(L.day) : 'Aujourd\'hui') + '</span><span class="sv-grow"></span>'
    + '<span class="fsl-sim"><button type="button" onclick="festLiveStep(-15)" title="Reculer de 15 minutes">&minus;15 min</button><button type="button" onclick="festLiveStep(15)" title="Avancer de 15 minutes">+15 min</button>'
    + (FSV.off ? '<button type="button" class="on" onclick="festLiveStep(0)"><i class="ti ti-clock"></i>Heure réelle</button>' : '') + '</span></div>';

  /* Où en est la scène */
  if(L.phase === 'show'){
    var c = T[L.cur];
    h += '<section class="fsl-hero"><span class="fsl-k"><i class="ti ti-microphone-2"></i>Sur scène</span><div class="fsl-n">' + E(_fsName(c.s.pid)) + '</div>'
      + '<div class="fsl-sub">' + E(c.s.start) + ' – ' + _fsHM(c.b) + ' · fin ' + _fsIn(c.b - L.now) + '</div>' + bar((L.now - c.a) / (c.b - c.a)) + '</section>';
  } else if(L.phase === 'before'){
    var b0 = T[L.next];
    h += '<section class="fsl-hero idle"><span class="fsl-k"><i class="ti ti-hourglass"></i>Avant le premier groupe</span><div class="fsl-n">' + E(_fsName(b0.s.pid)) + '</div>'
      + '<div class="fsl-sub">à ' + E(b0.s.start) + ' · ' + _fsIn(b0.a - L.now) + '</div></section>';
  } else if(L.phase === 'done' || L.phase === 'off'){
    var later = f.days.filter(function(x){ return x > L.day; })[0], earlier = f.days.length && f.days[0] > L.day;
    var first = later ? _fsSorted(f).filter(function(s){ return s.day === later && _fsMin(s.start) != null; })[0] : null;
    h += '<section class="fsl-hero idle"><span class="fsl-k"><i class="ti ti-moon"></i>' + (L.phase === 'done' ? 'Fin de la journée' : earlier ? 'Le festival n\'a pas commencé' : later ? 'Pas de groupe aujourd\'hui' : 'Festival terminé') + '</span>'
      + (L.phase === 'done' ? '<div class="fsl-n">' + E(_fsName(T[T.length - 1].s.pid)) + '</div><div class="fsl-sub">dernier passage, terminé à ' + _fsHM(T[T.length - 1].b) + '</div>' : '')
      + (later ? '<div class="fsl-sub">Prochain jour : <b>' + E(_fsDayLbl(later)) + '</b>' + (first ? ', ' + E(_fsName(first.pid)) + ' à ' + E(first.start) : '') + '</div>' : '')
      + (f.days.length ? '<div class="fsl-prev"><span>Voir le direct comme s\'il était l\'heure :</span>' + f.days.map(function(x){ return '<button type="button" onclick="festLiveAt(\'' + _jsq(x) + '\')">' + E(_fsDayLbl(x)) + '</button>'; }).join('') + '</div>' : '') + '</section>';
  }

  /* Le prochain changement de plateau (ou celui en cours) */
  if(L.next >= 0){
    var n = T[L.next], p = L.next > 0 ? T[L.next - 1] : null, r = _fsLiveRef(f, L, L.next), df = r ? _fsDiff(r, n.s.pid) : null;
    var inChg = L.phase === 'chg', gap = p ? n.a - p.b : null, house = f.cmp === 'house' && f.house;
    h += '<section class="fsl-chg' + (inChg ? ' live' : '') + '"><div class="fsl-h"><span class="fsl-k"><i class="ti ti-arrows-exchange"></i>' + (inChg ? 'Changement de plateau en cours' : p ? 'Prochain changement de plateau' : 'Installation du premier groupe') + '</span>'
      + '<span class="fsl-cd">' + (inChg ? E(_fsName(n.s.pid)) + ' sur scène ' : 'commence ') + '<b>' + _fsIn((inChg || !p ? n.a : p.b) - L.now) + '</b></span></div>'
      + '<div class="fsl-tr">' + (p ? '<span>' + E(_fsName(p.s.pid)) + '</span><i class="ti ti-arrow-right"></i>' : '') + '<b>' + E(_fsName(n.s.pid)) + '</b></div>'
      + '<div class="fsl-meta">' + (p ? _fsHM(p.b) + ' → ' : '') + E(n.s.start) + (gap != null && gap > 0 ? ' · ' + _fsDur(gap) + ' de changement' : gap != null && gap <= 0 ? ' · enchaîné, sans temps de changement' : '') + (n.s.note ? ' · ' + E(n.s.note) : '') + '</div>'
      + (inChg && gap > 0 ? bar((L.now - p.b) / gap) : '')
      + (df ? (house && !p ? '<div class="fsl-ref">Comparé au patch maître (' + E(_fsName(f.house)) + ')</div>' : '') + '<div class="fsv-chips">' + _fsDiffSum(df) + '</div>' + _fsDiffList(df)
        : '<div class="fs-none">' + _fsChs(n.s.pid).length + ' voies et ' + _fsOuts(n.s.pid).length + ' sorties à installer.</div>')
      + _fsLiveActs(n.s.pid) + '</section>';
  }

  /* La suite, puis ce qui est passé */
  var rows = function(from, to, past){
    var out = '';
    for(var i = from; i < to; i++){
      var t = T[i], r = _fsLiveRef(f, L, i), dd = r ? _fsDiff(r, t.s.pid) : null;
      out += '<details class="fsl-row' + (past ? ' past' : '') + '" data-k="' + E(t.s.id) + '"><summary><b class="fsl-t">' + E(t.s.start) + '</b><span class="fsl-rn">' + E(_fsName(t.s.pid)) + '</span>'
        + '<span class="fsl-rc">' + (past ? 'terminé' : _fsIn(t.a - L.now)) + '</span><i class="ti ti-chevron-down fsv-chev"></i></summary>'
        + '<div class="fsl-rb">' + (dd ? '<div class="fsv-chips">' + _fsDiffSum(dd) + '</div>' + _fsDiffList(dd) : '<div class="fs-none">Premier passage : ' + _fsChs(t.s.pid).length + ' voies à installer.</div>') + _fsLiveActs(t.s.pid) + '</div></details>';
    }
    return out;
  };
  if(L.next >= 0 && L.next + 1 < T.length) h += '<h3 class="fsl-sec">À suivre <span>' + (T.length - L.next - 1) + '</span></h3>' + rows(L.next + 1, T.length, false);
  var nPast = L.cur >= 0 ? L.cur : L.next >= 0 ? L.next : (L.phase === 'done' ? T.length : 0);
  if(nPast) h += '<details class="fsl-past"' + (FSV.pastOpen ? ' open' : '') + ' ontoggle="FSV.pastOpen=this.open"><summary>Déjà passés <span>' + nPast + '</span><i class="ti ti-chevron-down fsv-chev"></i></summary>' + rows(0, nPast, true) + '</details>';
  return h + '</div>';
}
function festLiveStep(m){ FSV.off = m ? (FSV.off || 0) + m * 60000 : 0; FSV._lm = null; if(typeof window._svFest === 'function') window._svFest(); }
/* Aperçu d'un jour : l'horloge est placée 20 minutes avant le premier groupe */
function festLiveAt(day){
  var raw = FSV._f; if(!raw || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  var first = _fsWith({ fest:raw, chs:[], out:{}, patches:[] }, function(){ return _fsSorted(_fsData()).filter(function(s){ return s.day === day && _fsMin(s.start) != null; })[0]; });
  var m = first ? _fsMin(first.start) - 20 : 18 * 60, at = new Date(day + 'T00:00:00'); at.setMinutes(m);
  FSV.off = at.getTime() - Date.now(); FSV._lm = null; if(typeof window._svFest === 'function') window._svFest();
}
/* Mise à jour à chaque nouvelle minute, en gardant les lignes ouvertes ; l'écran reste allumé */
function _fsLiveTick(){
  var on = FSV.v === 'live' && !!document.querySelector('.fsl');
  _fsWake(on && !document.hidden);
  if(!on || document.hidden) return;
  var d = _fsClock(), k = d.getHours() * 60 + d.getMinutes();
  if(k === FSV._lm) return;
  var open = [].map.call(document.querySelectorAll('.fsl-row[open]'), function(x){ return x.getAttribute('data-k'); });
  if(typeof window._svFest === 'function') window._svFest();
  open.forEach(function(id){ var x = _fsId(id) && document.querySelector('.fsl-row[data-k="' + id + '"]'); if(x) x.open = true; });
}
function _fsWake(on){
  try {
    if(on && !FSV._wl && !FSV._wlp && navigator.wakeLock){
      FSV._wlp = true;
      navigator.wakeLock.request('screen').then(function(l){ FSV._wl = l; FSV._wlp = false; l.addEventListener('release', function(){ FSV._wl = null; }); }).catch(function(){ FSV._wlp = false; });
    } else if(!on && FSV._wl){ FSV._wl.release(); FSV._wl = null; }
  } catch(e){}
}
function festSharedHtml(show, chs, esc){
  var raw = show && show.stage_data && show.stage_data.festival;
  if(!raw || !Array.isArray(raw.slots) || !raw.slots.length) return '<div class="sv-empty"><i class="ti ti-calendar-time"></i><b>Programme vide</b><span>Le programme du festival apparaîtra ici dès qu\'il sera préparé.</span></div>';
  var ctx = { fest:raw, chs:chs || [], out:show.out_data || {}, patches:Array.isArray(show.il_patches) ? show.il_patches : [] };
  return _fsWith(ctx, function(){
    var f = _fsData(), E = _fsE, all = _fsSorted(f);
    FSV._f = raw;
    /* Le jour du festival, le direct s'ouvre de lui-même (tant qu'on n'a pas choisi une autre vue) */
    if(!FSV.picked){ var L0 = _fsLive(f, _fsClock()); if(L0.T.length && L0.phase !== 'done') FSV.v = 'live'; }
    if(!FSV._tick){ FSV._tick = setInterval(_fsLiveTick, 5000); document.addEventListener('visibilitychange', _fsLiveTick); }
    if(FSV.d !== 'all' && f.days.indexOf(FSV.d) < 0) FSV.d = 'all';
    var slots = all.filter(function(s){ return FSV.d === 'all' || s.day === FSV.d; });
    var hasOut = Object.keys(ctx.out).some(function(k){ return Array.isArray(ctx.out[k]) && ctx.out[k].length; });
    if(FSV.v === 'out' && !hasOut) FSV.v = 'prog';
    var save = { day:FEST.day, io:FEST.io, mic:FEST.mic }; FEST.day = FSV.d; FEST.mic = true;
    try {
      var nIn = 0; slots.forEach(function(s){ nIn = Math.max(nIn, _fsChs(s.pid).length); });
      var V = [['live', 'Direct', 'ti-broadcast'], ['prog', 'Programme', 'ti-calendar-time'], ['in', 'Entrées', 'ti-list-numbers']].concat(hasOut ? [['out', 'Sorties', 'ti-arrow-bar-to-right']] : []).concat([['chg', 'Changements', 'ti-arrows-exchange']]);
      var live = FSV.v === 'live';
      var h = (live ? '' : _fsNowHtml(f, false))
        + '<div class="fsv-bar"><div class="sv-seg" role="tablist">' + V.map(function(v){ return '<button type="button" class="' + (FSV.v === v[0] ? 'on' : '') + '" onclick="festSv(\'v\',\'' + v[0] + '\')"><i class="ti ' + v[2] + '"></i>' + v[1] + '</button>'; }).join('') + '</div>'
        + (f.days.length > 1 && !live ? '<div class="sv-seg" role="tablist"><button type="button" class="' + (FSV.d === 'all' ? 'on' : '') + '" onclick="festSv(\'d\',\'all\')">Tous les jours</button>' + f.days.map(function(d){ var l = _fsDayLbl(d).split(' '); return '<button type="button" class="' + (FSV.d === d ? 'on' : '') + '" onclick="festSv(\'d\',\'' + _jsq(d) + '\')">' + E(l[0] + ' ' + (l[1] || '')) + '</button>'; }).join('') + '</div>' : '')
        + '<span class="sv-grow"></span><span class="sv-count"><b>' + slots.length + '</b> groupe' + (slots.length > 1 ? 's' : '') + (nIn ? ' · jusqu\'à <b>' + nIn + '</b> voies' : '') + '</span></div>';
      var ref = function(s, i, list){ return (f.cmp === 'house' && f.house) ? (f.house !== s.pid ? f.house : null) : (i > 0 && list[i - 1].day === s.day ? list[i - 1].pid : null); };
      if(live){
        FSV._lm = (function(d){ return d.getHours() * 60 + d.getMinutes(); })(_fsClock());
        h += _fsLiveHtml(f);
      } else if(FSV.v === 'in' || FSV.v === 'out'){
        FEST.io = FSV.v;
        h += '<div class="fsv-legend"><span class="same">Italique gris : identique</span><span class="chg">Gras, trait jaune : à changer</span><span>— : voie libre</span>' + (FSV.v === 'in' ? '<span><i class="ti ti-bolt"></i>+48V</span>' : '') + '<span class="ref">Comparé au ' + (f.cmp === 'house' && f.house ? 'patch maître (' + E(_fsName(f.house)) + ')' : 'groupe précédent') + '</span></div>'
          + '<div class="fsv-grid">' + _fsGridHtml(f, slots, true) + '</div>';
      } else if(FSV.v === 'chg'){
        var lastDay = null;
        slots.forEach(function(s, i){
          if(s.day !== lastDay){ h += '<h3 class="fsv-day">' + E(_fsDayLbl(s.day)) + '</h3>'; lastDay = s.day; }
          var r = ref(s, i, slots), d = r ? _fsDiff(r, s.pid) : null;
          h += '<section class="sv-card fsv-chg"><div class="fsv-chg-hd"><b class="fsv-t">' + E(s.start || '—') + '</b><span class="fsv-n">' + E(_fsName(s.pid)) + '</span>'
            + (r ? '<span class="fsv-from">' + (f.cmp === 'house' && f.house ? 'comparé au patch maître ' : 'après ') + E(_fsName(r)) + '</span>' : '<span class="fsv-from">' + (s.pid === f.house && f.cmp === 'house' ? 'patch maître : la référence' : 'premier passage') + '</span>') + '</div>'
            + (d ? '<div class="fsv-chips">' + _fsDiffSum(d) + '</div>' + _fsDiffList(d) : '<div class="fs-none">' + _fsChs(s.pid).length + ' voies et ' + _fsOuts(s.pid).length + ' sorties à installer.</div>') + '</section>';
        });
      } else {
        var lastD = null;
        slots.forEach(function(s, i){
          if(s.day !== lastD){ h += '<h3 class="fsv-day">' + E(_fsDayLbl(s.day)) + '</h3>'; lastD = s.day; }
          var r = ref(s, i, slots), d = r ? _fsDiff(r, s.pid) : null;
          var ins = _fsChs(s.pid), p48 = ins.filter(function(x){ return x.phantom; }).length, hf = ins.filter(function(x){ return _fsHf(x); }).length, no = _fsOuts(s.pid).length;
          if(d && (d.chg.length || d.add.length || d.free.length || d.p48.length || d.outs.length))
            h += '<details class="fsv-gap"><summary><i class="ti ti-arrows-exchange"></i>' + (f.cmp === 'house' && f.house ? 'Écart avec le patch maître' : 'Changement de plateau') + (r !== s.pid && i > 0 && f.cmp !== 'house' && _fsMin(slots[i - 1].end) != null && _fsMin(s.start) != null ? ' · ' + _fsDur(_fsMin(s.start) - _fsMin(slots[i - 1].end)) : '') + '<span class="fs-chips">' + _fsDiffSum(d) + '</span><i class="ti ti-chevron-down fsv-chev"></i></summary>' + _fsDiffList(d) + '</details>';
          h += '<article class="fsv-card"><div class="fsv-time"><b>' + E(s.start || '—') + '</b><span>' + E(s.end || '') + '</span></div>'
            + '<div class="fsv-main"><div class="fsv-name">' + E(_fsName(s.pid)) + (s.pid === f.house ? '<em>patch maître</em>' : '') + '</div>'
            + (s.note ? '<div class="fsv-note">' + E(s.note) + '</div>' : '')
            + '<div class="fsv-stats"><span><b>' + ins.length + '</b> voie' + (ins.length > 1 ? 's' : '') + '</span>' + (no ? '<span><b>' + no + '</b> sortie' + (no > 1 ? 's' : '') + '</span>' : '') + (p48 ? '<span class="p48"><b>' + p48 + '</b> en +48V</span>' : '') + (hf ? '<span><b>' + hf + '</b> HF</span>' : '') + '</div></div>'
            + '<div class="fsv-acts"><button type="button" onclick="window._svOpenPatch&&_svOpenPatch(\'' + _jsq(s.pid) + '\',\'il\')"><i class="ti ti-list-numbers"></i>Input list</button>'
            + (no ? '<button type="button" onclick="window._svOpenPatch&&_svOpenPatch(\'' + _jsq(s.pid) + '\',\'out\')"><i class="ti ti-arrow-bar-to-right"></i>Output list</button>' : '') + '</div></article>';
        });
      }
      return h;
    } finally { FEST.day = save.day; FEST.io = save.io; FEST.mic = save.mic; }
  });
}
/* Pour le rider partagé : les listes dans l'ordre de passage, avec leur heure */
function festPatchOrder(show){
  var raw = show && show.stage_data && show.stage_data.festival;
  if(!raw || !Array.isArray(raw.slots) || !raw.slots.length) return null;
  return _fsWith({ fest:raw, chs:[], out:{}, patches:show.il_patches || [] }, function(){
    var f = _fsData(), m = {}, days = {};
    _fsSorted(f).forEach(function(s, i){ if(!m[s.pid]){ m[s.pid] = { i:i, t:s.start, day:s.day }; days[s.day] = 1; } });
    var multi = Object.keys(days).length > 1;
    Object.keys(m).forEach(function(k){ if(multi) m[k].t = _fsDayLbl(m[k].day).split(' ')[0].slice(0, 3) + '. ' + m[k].t; });
    return m;
  });
}

/* ── Actions ── */
function festSet(k, v){
  var f = _fsData();
  if(k === 'house'){ f.house = v || ''; if(!f.house) f.cmp = 'prev'; }
  if(k === 'cmp') f.cmp = (v === 'house' && f.house) ? 'house' : 'prev';
  _fsSave(f); renderFestival();
}
function festToggle(id){ FEST.open[id] = !FEST.open[id]; renderFestival(); }
function festJump(id){ var el = document.getElementById('fs-' + id); if(el){ el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('flash'); setTimeout(function(){ el.classList.remove('flash'); }, 900); } }
async function festOpen(pid, mode){
  if(typeof switchPatch === 'function' && pid !== CUR_PATCH_ID) await switchPatch(pid);
  navIL(mode);
}
/* Un plan de scène par groupe : la version de plan portant son nom (créée au besoin) */
async function festScene(slotId){
  if(!canDo('multi_scenes')){ showUpgradeModal('multi_patches'); return; }
  var f = _fsData(), s = f.slots.find(function(x){ return x.id === slotId; }); if(!s) return;
  if(s.pid !== CUR_PATCH_ID) await switchPatch(s.pid);
  var sc = s.scene && SHOW_SCENES.stage.find(function(x){ return x.id === s.scene; });
  if(!sc){
    var r = await sb.from('show_scenes').insert({ show_id:CUR_SHOW.id, type:'stage', name:_fsName(s.pid), data:null, position:SHOW_SCENES.stage.length }).select().single();
    if(r.error){ toast('Plan non créé : ' + r.error.message); return; }
    sc = r.data; SHOW_SCENES.stage.push(sc);
    s.scene = sc.id; _fsSave(f);
    toast('Plan de « ' + _fsName(s.pid) + ' » créé : « Depuis l\'input list » le remplit avec ses voies.');
  }
  navPlan('scene');
  await switchScene('stage', sc.id);
}
/* Toutes les input lists existantes au programme, à la suite, 1 h 15 de concert et 30 min de changement */
function festFromPatches(){
  var f = _fsData(), day = (typeof _showDateISO === 'function' && _showDateISO(CUR_SHOW.show_date)) || _fsToday(), t = 18 * 60;
  (IL_PATCHES || []).forEach(function(p){
    if(f.slots.some(function(s){ return s.pid === p.id; })) return;
    f.slots.push({ id:'s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), pid:p.id, day:day, start:_fsHM(t), end:_fsHM(t + 75), scene:'', note:'' });
    t += 105;
  });
  _fsSave(f); renderFestival(); _fsSync();
  toast('✓ Programme créé : ajustez les horaires de chaque groupe.');
}

/* ── Fenêtre : ajouter ou modifier un groupe ── */
function festEdit(slotId, pidPreset, dayPreset){
  if(pidPreset && !_fsId(pidPreset)) pidPreset = null;
  var f = _fsData(), s = slotId ? f.slots.find(function(x){ return x.id === slotId; }) : null, E = _fsE;
  var curDay = /^\d{4}-\d{2}-\d{2}$/.test(dayPreset || '') ? dayPreset : (FEST.day !== 'all' ? FEST.day : '');
  var last = _fsSorted(f).filter(function(x){ return !curDay || x.day === curDay; }).slice(-1)[0];
  var day = s ? s.day : (curDay || (last ? last.day : (f.days[0] || (typeof _showDateISO === 'function' && _showDateISO(CUR_SHOW.show_date)) || _fsToday())));
  var st = s ? s.start : (last && _fsMin(last.end) != null ? _fsHM(_fsMin(last.end) + 30) : '18:00');
  var en = s ? s.end : _fsHM((_fsMin(st) || 1080) + 75);
  FEST.edit = { id:s ? s.id : null };
  var srcOpts = s ? '' : ('<option value="new">Nouvelle input list vide</option>'
    + (f.house ? '<option value="copy:' + E(f.house) + '">Copie du patch maître (' + E(_fsName(f.house)) + ')</option>' : '')
    + (IL_PATCHES || []).filter(function(p){ return p.id !== f.house; }).map(function(p){ return '<option value="copy:' + E(p.id) + '">Copie de ' + E(p.name) + '</option>'; }).join('')
    + (IL_PATCHES || []).filter(function(p){ return !f.slots.some(function(x){ return x.pid === p.id; }); }).map(function(p){ return '<option value="use:' + E(p.id) + '"' + (p.id === pidPreset ? ' selected' : '') + '>Utiliser « ' + E(p.name) + ' » telle quelle</option>'; }).join(''));
  var m = document.getElementById('fest-modal');
  if(!m){ m = document.createElement('div'); m.id = 'fest-modal'; m.className = 'modal-ov'; m.addEventListener('click', function(e){ if(e.target === m) festClose(); }); document.body.appendChild(m); }
  m.innerHTML = '<div class="modal-box fs-box"><div class="modal-head"><span class="modal-title">' + (s ? 'Modifier le créneau' : 'Ajouter un groupe') + '</span><button class="modal-close" onclick="festClose()" aria-label="Fermer"><i class="ti ti-x"></i></button></div>'
    + '<div class="modal-body fs-form">'
    + '<label class="fs-f"><span>Groupe</span><input class="pdf-inp" id="fs-name" maxlength="60" value="' + E(s ? _fsName(s.pid) : (pidPreset ? _fsName(pidPreset) : '')) + '" placeholder="Nom du groupe ou de l\'artiste"></label>'
    + '<div class="fs-f3"><label class="fs-f"><span>Jour</span>' + (f.days.length
        ? '<select class="pdf-inp" id="fs-day">' + f.days.concat(f.days.indexOf(day) < 0 ? [day] : []).sort().map(function(d){ return '<option value="' + E(d) + '"' + (d === day ? ' selected' : '') + '>' + E(_fsDayLbl(d)) + '</option>'; }).join('') + '</select>'
        : '<input class="pdf-inp" type="date" id="fs-day" value="' + E(day) + '">') + '</label>'
    + '<label class="fs-f"><span>Début</span><input class="pdf-inp" type="time" id="fs-start" value="' + E(st) + '"></label>'
    + '<label class="fs-f"><span>Fin</span><input class="pdf-inp" type="time" id="fs-end" value="' + E(en) + '"></label></div>'
    + (s ? '' : '<label class="fs-f"><span>Input list et output list</span><select class="pdf-inp" id="fs-src">' + srcOpts + '</select></label>')
    + '<label class="fs-f"><span>Note <em>(facultative)</em></span><input class="pdf-inp" id="fs-note" maxlength="120" value="' + E(s ? s.note || '' : '') + '" placeholder="ex : balance à 14 h, batterie fournie"></label>'
    + '</div><div class="modal-foot">'
    + (s ? '<button class="btn ghost" onclick="festRemove(\'' + _jsq(s.id) + '\')"><i class="ti ti-calendar-minus"></i>Retirer du programme</button><span style="flex:1"></span>' : '')
    + '<button class="btn" onclick="festClose()">Annuler</button><button class="btn pri" onclick="festSaveSlot()"><i class="ti ti-check"></i>' + (s ? 'Enregistrer' : 'Ajouter') + '</button></div></div>';
  m.classList.add('show');
  setTimeout(function(){ var i = document.getElementById(s ? 'fs-start' : 'fs-name'); if(i) i.focus(); }, 60);
}
function festClose(){ var m = document.getElementById('fest-modal'); if(m) m.classList.remove('show'); FEST.edit = null; }
async function festSaveSlot(){
  var v = function(id){ var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  var name = v('fs-name'), day = v('fs-day'), st = v('fs-start'), en = v('fs-end'), note = v('fs-note'), src = v('fs-src') || '';
  if(!name){ toast('Indiquez le nom du groupe.'); return; }
  if(_fsMin(st) == null){ toast('Indiquez l\'heure de début.'); return; }
  var f = _fsData();
  if(FEST.edit && FEST.edit.id){
    var s = f.slots.find(function(x){ return x.id === FEST.edit.id; }); if(!s) return;
    s.day = day; s.start = st; s.end = en; s.note = note;
    var p = _fsPatch(s.pid); if(p && p.name !== name){ p.name = name; savePatchMeta(); renderPatchTabs(); }
    _fsSave(f); festClose(); renderFestival(); return;
  }
  var pid;
  if(/^use:/.test(src)){
    pid = src.slice(4); var pu = _fsPatch(pid); if(pu && pu.name !== name){ pu.name = name; savePatchMeta(); }
  } else {
    pid = await _fsNewPatch(name, /^copy:/.test(src) ? src.slice(5) : null);
    if(!pid) return;
  }
  f = _fsData();
  f.slots.push({ id:'s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), pid:pid, day:day, start:st, end:en, scene:'', note:note });
  _fsSave(f); festClose(); renderFestival(); _fsSync();
  toast('✓ ' + name + ' ajouté au programme');
}
function festRemove(id){
  var f = _fsData(), s = f.slots.find(function(x){ return x.id === id; }); if(!s) return;
  if(!confirm('Retirer « ' + _fsName(s.pid) + ' » du programme ?\nSon input list et son output list restent dans le show.')) return;
  f.slots = f.slots.filter(function(x){ return x.id !== id; });
  _fsSave(f); festClose(); renderFestival(); _fsSync();
}

/* Nouvelle input list pour un groupe, vide ou copiée d'une autre (voies, HF, colonnes perso et sorties) */
async function _fsEnsurePatchCol(){
  if(typeof _patchColReady !== 'undefined' && _patchColReady) return true;
  var r = await sb.from('channels').select('patch_id').limit(1);
  if(r && !r.error){ _patchColReady = true; return true; }
  toast('La séparation des input lists par groupe n\'est pas disponible sur ce compte.');
  return false;
}
async function _fsNewPatch(name, fromPid){
  if(!(await _fsEnsurePatchCol())) return null;
  var id = 'p' + Date.now();
  var rows = fromPid ? _fsChs(fromPid) : [];
  if(rows.length > planLimit('max_channels')){ showUpgradeModal('max_channels'); return null; }
  IL_PATCHES.push({ id:id, name:name, pos:IL_PATCHES.length });
  savePatchMeta();
  if(rows.length){
    var ins = rows.map(function(r, i){
      var o = { show_id:CUR_SHOW.id, ch:i + 1, short_name:r.short_name || '', long_name:r.long_name || '', source:r.source || '', mic:r.mic || '', gain:r.gain || 0,
        phantom:!!r.phantom, iem_group:r.iem_group || '', foh:r.foh !== false, mon:!!r.mon, bc:!!r.bc, note:r.note || '', patch_id:id };
      if(r.custom_data) o.custom_data = r.custom_data;
      return o;
    });
    if(typeof setSaving === 'function') setSaving(true);
    var res = await sb.from('channels').insert(ins).select();
    if(typeof setSaving === 'function') setSaving(false);
    if(res.error){ IL_PATCHES = IL_PATCHES.filter(function(p){ return p.id !== id; }); savePatchMeta(); toast('Erreur : ' + res.error.message); return null; }
    if(typeof ALL_CHS !== 'undefined') ALL_CHS = ALL_CHS.concat(res.data || []);
  }
  var outs = fromPid ? _fsOuts(fromPid) : [];
  if(outs.length){
    OUT_DATA[id] = outs.map(function(o, i){ return Object.assign({}, o, { id:'o' + Date.now().toString(36) + i }); });
    if(typeof _rebuildAllOut === 'function') _rebuildAllOut(OUT_DATA);
    CUR_SHOW.out_data = JSON.parse(JSON.stringify(OUT_DATA));
    _outPatch(CUR_SHOW, [id]).then(function(r){ if(r && r.error) console.warn('[festival] sorties', r.error.message); });
  }
  if(typeof renderPatchTabs === 'function') renderPatchTabs();
  return id;
}
/* Les onglets de l'input list suivent l'ordre du programme */
function _fsSync(){ if(typeof renderPatchTabs === 'function') renderPatchTabs(); if(typeof _navSync === 'function') _navSync(); }
function festReload(){ var pn = document.getElementById('panel-festival'); if(pn && pn.classList.contains('on')) renderFestival(); _fsSync(); }

/* Pour les onglets de l'input list : heure de passage et ordre */
function festPatchInfo(){
  if(!CUR_SHOW || !canDo('multi_patches')) return null;
  var f = _fsData(); if(!f.slots.length) return null;
  var map = {}, days = {};
  _fsSorted(f).forEach(function(s, i){ days[s.day] = 1; map[s.pid] = { i:i, t:s.start, day:s.day }; });
  var multi = Object.keys(days).length > 1;
  Object.keys(map).forEach(function(k){
    var m = map[k];
    if(multi && m.day){ try{ m.t = new Date(m.day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short' }).replace('.', '') + ' ' + m.t; }catch(e){} }
  });
  return map;
}

/* Carte de la vue d'ensemble : en ce moment, ensuite, et le nombre de groupes */
function _festOvHtml(){
  if(!CUR_SHOW || !canDo('multi_patches')) return '';
  var f = _fsData(); if(!f.slots.length) return '';
  var list = _fsSorted(f), days = {}; list.forEach(function(s){ days[s.day] = 1; });
  var nd = Object.keys(days).length;
  return '<section class="ov-card"><div class="ov-card-hd"><h2>Festival</h2><button class="ov-link" onclick="goTab(\'festival\',null)">Ouvrir</button></div>'
    + '<div class="ov-stats"><div><b>' + list.length + '</b><span>groupe' + (list.length > 1 ? 's' : '') + '</span></div><div><b>' + nd + '</b><span>jour' + (nd > 1 ? 's' : '') + '</span></div></div>'
    + (_fsNowHtml(f, true) || '<div class="ov-none">Premier passage&nbsp;: ' + _fsE(_fsName(list[0].pid)) + ', ' + _fsE(_fsDayLbl(list[0].day).toLowerCase()) + ' à ' + _fsE(list[0].start) + '.</div>')
    + '</section>';
}
