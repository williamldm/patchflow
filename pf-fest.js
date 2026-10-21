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
var FEST = { t:null, open:{}, edit:null };

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

function _fsData(){
  var f = CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.festival;
  f = (f && typeof f === 'object') ? JSON.parse(JSON.stringify(f)) : {};
  /* Identifiants repris dans des onclick : uniquement lettres, chiffres, tiret et souligné */
  f.slots = Array.isArray(f.slots) ? f.slots.filter(function(s){ return s && _fsId(s.id) && _fsId(s.pid); }) : [];
  f.slots.forEach(function(s){ if(s.scene && !_fsId(s.scene)) s.scene = ''; });
  f.house = _fsId(f.house) ? f.house : '';
  f.cmp = f.cmp === 'house' ? 'house' : 'prev';
  return f;
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
function _fsPatch(pid){ return (typeof IL_PATCHES !== 'undefined' ? IL_PATCHES : []).find(function(p){ return p.id === pid; }) || null; }
function _fsName(pid){ var p = _fsPatch(pid); return p ? p.name : 'Liste supprimée'; }
function _fsChs(pid){
  var all = (typeof ALL_CHS !== 'undefined' && ALL_CHS.length) ? ALL_CHS : (typeof CHS !== 'undefined' ? CHS : []);
  return all.filter(function(r){ return (r.patch_id || 'main') === pid; }).slice().sort(function(a, b){ return a.ch - b.ch; });
}
function _fsOuts(pid){ return ((typeof OUT_DATA !== 'undefined' && OUT_DATA[pid]) || []).slice().sort(function(a, b){ return (a.ch || 0) - (b.ch || 0); }); }
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
function renderFestival(){
  var root = document.getElementById('fest-root'); if(!root) return;
  var E = _fsE;
  if(!CUR_SHOW){
    root.innerHTML = '<div class="dt-empty"><i class="ti ti-calendar-event"></i><div class="dt-empty-t">Aucun show ouvert</div><div class="dt-empty-s">Choisissez une session pour préparer le programme du festival.</div><button class="btn pri" onclick="goTab(\'sessions\',null)">Voir les sessions</button></div>';
    return;
  }
  var head = '<header class="bonp-head"><div><div class="bonp-eyebrow">' + E(CUR_SHOW.name || '') + '</div><h1>Mode festival</h1>'
    + '<p>Le programme de la scène&nbsp;: chaque groupe a son input list, son output list et son plan. Entre deux groupes, le changement de plateau est calculé voie par voie.</p></div>';
  if(!canDo('multi_patches')){
    root.innerHTML = head + '</header><section class="fs-gate"><div class="fs-gate-ic"><i class="ti ti-calendar-time"></i></div>'
      + '<div><b>Le mode festival est inclus dans l\'offre Pro</b><ul>'
      + '<li>Le programme par jour, sur une frise, avec les temps de changement</li>'
      + '<li>Une input list et une output list par groupe, dans le même show</li>'
      + '<li>Pour chaque changement de plateau&nbsp;: voies qui changent, voies libérées, 48 V à basculer, retours et HF</li>'
      + '<li>Comparaison avec le patch maître de la scène, feuille de changements à imprimer</li></ul>'
      + '<button class="btn pri" onclick="showUpgradeModal(\'festival\')"><i class="ti ti-sparkles"></i>Découvrir Pro</button></div></section>';
    return;
  }
  var f = _fsData(), slots = _fsSorted(f);
  head += '<div class="rf-act">'
    + (slots.length ? '<button class="btn" onclick="festPrint()"><i class="ti ti-printer"></i>Feuille de changements</button>' : '')
    + '<button class="btn pri" onclick="festEdit()"><i class="ti ti-plus"></i>Ajouter un groupe</button></div></header>';

  if(!slots.length){
    var spare = (IL_PATCHES || []).length;
    root.innerHTML = head + '<section class="fs-empty"><i class="ti ti-calendar-time"></i><b>Construisez le programme de la scène</b>'
      + '<span>Ajoutez les groupes dans l\'ordre de passage, avec leurs horaires. Chacun reçoit son input list (vide, copiée du patch maître, ou une liste existante).</span>'
      + '<div class="fs-empty-a"><button class="btn pri" onclick="festEdit()"><i class="ti ti-plus"></i>Ajouter le premier groupe</button>'
      + (spare > 1 || (spare === 1 && _fsChs(IL_PATCHES[0].id).length) ? '<button class="btn" onclick="festFromPatches()"><i class="ti ti-list-numbers"></i>Mettre ' + (spare > 1 ? 'les ' + spare + ' input lists' : 'l\'input list actuelle') + ' au programme</button>' : '')
      + '</div></section>';
    return;
  }

  /* Réglages : patch maître et comparaison */
  var opts = '<option value="">Aucun</option>' + (IL_PATCHES || []).map(function(p){ return '<option value="' + E(p.id) + '"' + (p.id === f.house ? ' selected' : '') + '>' + E(p.name) + '</option>'; }).join('');
  var h = head + _fsNowHtml(f, false)
    + '<div class="fs-bar"><label><span>Patch maître de la scène</span><select class="pdf-inp" onchange="festSet(\'house\',this.value)">' + opts + '</select></label>'
    + '<div class="fs-seg" role="group" aria-label="Comparer"><span>Changements</span>'
    + '<button type="button" class="' + (f.cmp === 'prev' ? 'on' : '') + '" onclick="festSet(\'cmp\',\'prev\')">avec le groupe précédent</button>'
    + '<button type="button" class="' + (f.cmp === 'house' ? 'on' : '') + '"' + (f.house ? '' : ' disabled title="Choisissez d\'abord le patch maître"') + ' onclick="festSet(\'cmp\',\'house\')">avec le patch maître</button></div></div>';

  /* Un bloc par jour : frise, puis groupes et changements */
  var days = {}, order = [];
  slots.forEach(function(s){ var k = s.day || ''; if(!days[k]){ days[k] = []; order.push(k); } days[k].push(s); });
  order.forEach(function(day){
    var list = days[day], lo = Infinity, hi = -Infinity;
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
      var ref = (f.cmp === 'house' && f.house && f.house !== s.pid) ? f.house : (prev ? prev.pid : null);
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
function festEdit(slotId, pidPreset){
  if(pidPreset && !_fsId(pidPreset)) pidPreset = null;
  var f = _fsData(), s = slotId ? f.slots.find(function(x){ return x.id === slotId; }) : null, E = _fsE;
  var last = _fsSorted(f).slice(-1)[0];
  var day = s ? s.day : (last ? last.day : ((typeof _showDateISO === 'function' && _showDateISO(CUR_SHOW.show_date)) || _fsToday()));
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
    + '<div class="fs-f3"><label class="fs-f"><span>Jour</span><input class="pdf-inp" type="date" id="fs-day" value="' + E(day) + '"></label>'
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
    sb.from('shows').update({ out_data:OUT_DATA }).eq('id', CUR_SHOW.id).then(function(r){ if(r && r.error) console.warn('[festival] sorties', r.error.message); });
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

/* ── Feuille de changements à imprimer : un tableau par changement de plateau ── */
function festPrint(){
  var f = _fsData(), list = _fsSorted(f), E = _fsE; if(!list.length) return;
  var body = '', lastDay = null;
  list.forEach(function(s, i){
    if(s.day !== lastDay){ body += '<h2>' + E(_fsDayLbl(s.day)) + '</h2>'; lastDay = s.day; }
    var prev = i > 0 && list[i - 1].day === s.day ? list[i - 1] : null;
    var ref = (f.cmp === 'house' && f.house && f.house !== s.pid) ? f.house : (prev ? prev.pid : null);
    body += '<section><h3><span>' + E(s.start) + '–' + E(s.end) + '</span>' + E(_fsName(s.pid)) + '</h3>' + (s.note ? '<p class="n">' + E(s.note) + '</p>' : '');
    if(ref){
      var d = _fsDiff(ref, s.pid);
      body += '<p class="sub">' + (f.cmp === 'house' && f.house ? 'Par rapport au patch maître (' + E(_fsName(f.house)) + ')' : 'Après ' + E(_fsName(prev.pid))) + ' : ' + d.same + ' voies identiques, ' + d.chg.length + ' à changer, ' + d.add.length + ' ajoutées, ' + d.free.length + ' libérées, ' + d.p48.length + ' bascules 48 V.</p>';
      body += _fsDiffList(d).replace(/<i class="ti ti-arrow-right"><\/i>/g, '→').replace(/<i class="ti ti-bolt"><\/i>/g, '⚡ ');
    } else {
      body += '<p class="sub">Premier groupe : ' + _fsChs(s.pid).length + ' voies, ' + _fsOuts(s.pid).length + ' sorties.</p>';
    }
    body += '</section>';
  });
  var css = '@page{size:A4;margin:14mm}body{font:12px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#111}h1{font-size:20px;margin:0 0 2px}.h{color:#666;margin-bottom:14px}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #ff6b1a;padding-bottom:3px}'
    + 'section{break-inside:avoid;margin:0 0 12px}h3{font-size:13px;margin:8px 0 2px}h3 span{display:inline-block;min-width:92px;color:#b5400d;font-variant-numeric:tabular-nums}.sub{margin:2px 0 6px;color:#444}.n{margin:0 0 4px;color:#666;font-style:italic}'
    + 'ul{list-style:none;padding:0;margin:0;border:1px solid #ddd;border-radius:6px}li{display:flex;gap:10px;padding:4px 8px;border-top:1px solid #eee}li:first-child{border-top:0}li b{min-width:58px}li em{color:#666;font-style:normal}'
    + 'li.p48{background:#fff4e5}li.add b{color:#15803d}li.free b{color:#888}.fs-none{color:#666;font-style:italic}';
  var html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Changements de plateau — ' + E(CUR_SHOW.name || '') + '</title><style>' + css + '</style></head><body>'
    + '<h1>Changements de plateau</h1><div class="h">' + E(CUR_SHOW.name || '') + (CUR_SHOW.venue ? ' · ' + E(CUR_SHOW.venue) : '') + ' · PatchFlow</div>' + body
    + '<script>window.onload=function(){window.print();};<\/script></body></html>';
  var w = window.open('', '_blank');
  if(w){ w.document.write(html); w.document.close(); } else toast('Autorisez les fenêtres surgissantes pour imprimer.');
}
