/* ══════════════════════════════════════════════════════════════════════
   FEUILLE DE ROUTE — la journée de la date, au même endroit que le patch
   Horaires (arrivée, déchargement, balance, portes, concert, démontage…),
   lieu et accès, contacts, hébergement, repas, loges, wi-fi et notes.
   Rangée dans shows.stage_data.road. Elle se partage comme une section du
   rider : le destinataire la lit sur son téléphone, appelle un contact d'un
   toucher, et voit ce qui est en cours le jour de la date.
   Le lieu et la date viennent du show (modifiables depuis cette page).
   ══════════════════════════════════════════════════════════════════════ */

/* Journée type : l'ordre habituel d'une date, sans heures (elles changent d'un lieu à l'autre) */
const _RD_DAY = ['Arrivée équipe technique', 'Déchargement', 'Montage', 'Line check', 'Balance', 'Repas',
  'Ouverture des portes', 'Première partie', 'Concert', 'Fin de soirée (couvre-feu)', 'Démontage', 'Chargement et départ'];
/* Libellés proposés à la saisie */
const _RD_LABELS = _RD_DAY.concat(['Arrivée artistes', 'Raccords', 'Changement de plateau', 'Catering', 'Interview', 'Photos',
  'Fin de concert', 'Départ hôtel', 'Arrivée hôtel', 'Rendez-vous', 'Transfert']);
const _RD_ROLES = ['Régisseur général', 'Régisseur son de la salle', 'Régisseur lumière', 'Directeur technique', 'Tour manager',
  'Production', 'Accueil artistes', 'Organisateur', 'Programmateur', 'Loueur', 'Ingé façade', 'Ingé retours', 'Backliner', 'Sécurité', 'Chauffeur'];
/* Champs texte de la page : [clé, libellé, aide, longueur max] */
const _RD_PLACE = [['addr', 'Adresse', 'Numéro, rue, ville', 200], ['access', 'Accès et déchargement', 'Quai, hauteur, code du portail, entrée artistes…', 400],
  ['parking', 'Stationnement', 'Camion, bus, voitures de l\'équipe', 300]];
const _RD_LOGI = [['hotel', 'Hébergement', 'Hôtel, adresse, horaires, confirmation', 400], ['meals', 'Repas et catering', 'Horaires, lieu, régimes', 300],
  ['loges', 'Loges', 'Nombre, emplacement, équipement', 300], ['wifi', 'Wi-Fi', 'Réseau et mot de passe', 120]];
const _RD_MAX_SCHED = 40, _RD_MAX_PEOPLE = 30;

function _rdId(){ return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function _rdStr(v, n){ return String(v == null ? '' : v).replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n || 80); }
function _rdLine(v, n){ return _rdStr(v, n).replace(/\n/g, ' '); }
/* « 14h », « 14h30 », « 14:30 », « 1430 », « 9 » → « 14:00 », « 14:30 », « 09:00 » ; vide si illisible */
function _rdTime(v){
  var s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
  if(!s) return '';
  var m = s.match(/^(\d{1,2})(?:[h:.]|h?$)(\d{2})?(?:mn|min)?$/) || s.match(/^(\d{1,2})(\d{2})$/);
  if(!m) return '';
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if(h > 23 || mi > 59) return '';
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}
function _rdMin(t){ var m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : -1; }

function _rdEmpty(){ return { v:1, sched:[], people:[], addr:'', access:'', parking:'', hotel:'', meals:'', loges:'', wifi:'', notes:'' }; }
/* Données venant de la base ou d'un lien partagé : types et longueurs forcés */
function _rdClean(d){
  var o = _rdEmpty();
  if(!d || typeof d !== 'object') return o;
  _RD_PLACE.concat(_RD_LOGI).forEach(function(f){ o[f[0]] = _rdStr(d[f[0]], f[3]); });
  o.notes = _rdStr(d.notes, 1500);
  o.sched = (Array.isArray(d.sched) ? d.sched : []).slice(0, _RD_MAX_SCHED).filter(function(x){ return x && typeof x === 'object'; }).map(function(x){
    return { id:_rdLine(x.id, 24) || _rdId(), t:_rdTime(x.t), l:_rdLine(x.l, 60), n:_rdLine(x.n, 120) };
  });
  o.people = (Array.isArray(d.people) ? d.people : []).slice(0, _RD_MAX_PEOPLE).filter(function(x){ return x && typeof x === 'object'; }).map(function(x){
    return { id:_rdLine(x.id, 24) || _rdId(), r:_rdLine(x.r, 60), n:_rdLine(x.n, 60), p:_rdLine(x.p, 30), m:_rdLine(x.m, 120) };
  });
  return o;
}
function _rdIsEmpty(d){
  return !d || (!d.sched.length && !d.people.length && !_RD_PLACE.concat(_RD_LOGI).some(function(f){ return d[f[0]]; }) && !d.notes);
}
/* Ordre d'affichage : par heure. Après minuit, une heure avant 6 h passe en fin de journée si la journée
   commence l'après-midi (démontage à 00:30 après le concert de 22:00). Une ligne sans heure suit celle d'avant. */
function _rdSorted(sched){
  var late = sched.some(function(x){ return _rdMin(x.t) >= 720; }), prev = -1;
  return sched.map(function(x, i){
    var m = _rdMin(x.t);
    if(m >= 0 && m < 360 && late) m += 1440;
    var k = m >= 0 ? m : prev + 0.001; if(m >= 0) prev = m; else prev = k;
    return { x:x, k:k, i:i };
  }).sort(function(a, b){ return a.k - b.k || a.i - b.i; }).map(function(o){ return o.x; });
}
/* Le jour de la date : ligne en cours (commencée, la suivante pas encore) et ligne à venir */
function _rdNow(list, iso, now){
  now = now || new Date();
  var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  var y = new Date(now.getTime() - 86400000), yday = y.getFullYear() + '-' + ('0' + (y.getMonth() + 1)).slice(-2) + '-' + ('0' + y.getDate()).slice(-2);
  if(!iso || (iso !== today && iso !== yday)) return null;
  var late = list.some(function(x){ return _rdMin(x.t) >= 720; });
  var cur = now.getHours() * 60 + now.getMinutes() + (iso === yday ? 1440 : 0);
  var timed = list.map(function(x){ var m = _rdMin(x.t); if(m >= 0 && m < 360 && late) m += 1440; return { id:x.id, m:m }; }).filter(function(o){ return o.m >= 0; });
  var on = null, next = null;
  timed.forEach(function(o){ if(o.m <= cur) on = o; else if(!next) next = o; });
  if(!on && !next) return null;
  if(on && !next && cur - on.m > 180) return null;           /* la journée est finie */
  return { on:on ? on.id : '', next:next ? next.id : '' };
}
function _rdTel(p){ return String(p || '').replace(/[^\d+]/g, ''); }
function _rdMaps(addr){ return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr); }

/* ── État de la page ── */
var RD = { showId:null, data:null, t:null };
function _rdLoad(){
  var id = CUR_SHOW && CUR_SHOW.id;
  if(RD.showId === id && RD.data) return RD.data;
  RD.showId = id; RD.data = _rdClean(CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.road);
  return RD.data;
}
function _rdSave(){
  if(!CUR_SHOW || !RD.data) return;
  CUR_SHOW.stage_data = Object.assign({}, CUR_SHOW.stage_data || { v:2 }, { road:JSON.parse(JSON.stringify(RD.data)) });
  var show = CUR_SHOW;        /* l'écriture vise le show édité, même si l'on en ouvre un autre avant la fin du délai */
  clearTimeout(RD.t);
  RD.t = setTimeout(async function(){
    try {
      if(typeof setSaving === 'function') setSaving(true);
      var r = await sb.from('shows').update({ stage_data:show.stage_data }).eq('id', show.id);
      if(r && r.error) toast('Feuille de route non enregistrée : ' + r.error.message);
    } catch(e){ toast('Feuille de route non enregistrée : ' + (e && e.message || e)); }
    if(typeof setSaving === 'function') setSaving(false);
  }, 600);
}
/* Un collègue a modifié le show : on relit, sauf pendant une saisie dans la page */
function _rdReload(){
  RD.showId = null;
  var pn = document.getElementById('panel-road'), root = document.getElementById('road-root');
  if(pn && pn.classList.contains('on') && !(document.activeElement && root && root.contains(document.activeElement))) renderRoad();
}

/* ── Page ── */
function renderRoad(){
  var root = document.getElementById('road-root'); if(!root) return;
  var E = _bonE;
  if(!CUR_SHOW){
    root.innerHTML = '<div class="dt-empty"><i class="ti ti-calendar-event"></i><div class="dt-empty-t">Aucun show ouvert</div><div class="dt-empty-s">Choisissez une session pour préparer sa feuille de route.</div><button class="btn pri" onclick="goTab(\'sessions\',null)">Voir les sessions</button></div>';
    return;
  }
  var d = _rdLoad(), iso = _showDateISO(CUR_SHOW.show_date);
  var dateTxt = iso ? _isoToDate(iso).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '';
  var h = '<header class="bonp-head"><div><div class="bonp-eyebrow">' + E(CUR_SHOW.name || '') + '</div><h1>Feuille de route</h1>' +
    '<p>Horaires, lieu, contacts et logistique de la date. Cochez-la dans un lien de partage : l\'équipe la consulte sur son téléphone, toujours à jour.</p></div>' +
    '<div class="rf-act"><button class="btn" onclick="roadCopy()"><i class="ti ti-copy"></i>Copier le texte</button>' +
      '<button class="btn" onclick="roadPdf()"><i class="ti ti-file-type-pdf"></i>PDF</button>' +
      '<button class="btn pri" onclick="goTab(\'team\',null)"><i class="ti ti-link"></i>Partager</button></div></header>';
  /* Le show : date et lieu, ceux de la fiche du show */
  h += '<section class="rd-show"><div><i class="ti ti-calendar"></i><span><small>Date</small><b>' + (dateTxt ? E(dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1)) : '<em>à renseigner</em>') + '</b></span></div>' +
    '<div><i class="ti ti-map-pin"></i><span><small>Lieu</small><b>' + (CUR_SHOW.venue ? E(CUR_SHOW.venue) : '<em>à renseigner</em>') + '</b></span></div>' +
    '<button type="button" class="ov-link" onclick="roadEditShow()"><i class="ti ti-pencil"></i>Modifier</button></section>';
  h += '<div class="rd-grid"><div class="rd-col">';
  /* Horaires */
  h += '<section class="rd-card"><div class="rd-hd"><h3><i class="ti ti-clock"></i>Horaires</h3><span class="rd-grow"></span>' +
    (d.sched.some(function(x){ return x.t; }) ? '<button type="button" class="ov-link" onclick="roadShift()" title="Décaler toutes les heures (retard, avance)"><i class="ti ti-clock-edit"></i>Décaler</button>' : '') + '</div>';
  if(!d.sched.length){
    h += '<div class="rd-void"><p>Pas encore d\'horaire. Partez de la journée type (arrivée, déchargement, balance, portes, concert, démontage…), puis ajoutez les heures.</p>' +
      '<div class="rd-void-a"><button type="button" class="btn pri sm" onclick="roadDay()"><i class="ti ti-list-details"></i>Journée type</button>' +
      '<button type="button" class="btn sm" onclick="roadAdd()"><i class="ti ti-plus"></i>Un horaire</button></div></div>';
  } else {
    h += '<datalist id="rd-dl-l">' + _RD_LABELS.map(function(l){ return '<option value="' + E(l) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="rd-sched">' + _rdSorted(d.sched).map(function(x){
        return '<div class="rd-row" data-id="' + E(x.id) + '">' +
          '<input class="rf-in rd-t' + (x.t ? '' : ' none') + '" value="' + E(x.t) + '" placeholder="--:--" inputmode="numeric" maxlength="5" aria-label="Heure" onchange="roadSched(this,\'t\')"/>' +
          '<input class="rf-in b" list="rd-dl-l" value="' + E(x.l) + '" placeholder="Étape" maxlength="60" aria-label="Étape" onchange="roadSched(this,\'l\')"/>' +
          '<input class="rf-in rd-n" value="' + E(x.n) + '" placeholder="Précision (lieu, qui, durée…)" maxlength="120" aria-label="Précision" onchange="roadSched(this,\'n\')"/>' +
          '<button type="button" class="rf-ib" onclick="roadDel(this)" title="Retirer" aria-label="Retirer cet horaire"><i class="ti ti-x"></i></button></div>';
      }).join('') + '</div>' +
      (d.sched.length < _RD_MAX_SCHED ? '<button type="button" class="rd-add" onclick="roadAdd()"><i class="ti ti-plus"></i>Ajouter un horaire</button>' : '');
  }
  h += '</section>';
  /* Contacts */
  h += '<section class="rd-card"><div class="rd-hd"><h3><i class="ti ti-address-book"></i>Contacts</h3></div>';
  if(d.people.length){
    h += '<datalist id="rd-dl-r">' + _RD_ROLES.map(function(l){ return '<option value="' + E(l) + '"></option>'; }).join('') + '</datalist><div class="rd-people">' +
      d.people.map(function(x){
        return '<div class="rd-pp" data-id="' + E(x.id) + '">' +
          '<input class="rf-in rd-r" list="rd-dl-r" value="' + E(x.r) + '" placeholder="Rôle" maxlength="60" aria-label="Rôle" onchange="roadPerson(this,\'r\')"/>' +
          '<input class="rf-in b" value="' + E(x.n) + '" placeholder="Nom" maxlength="60" aria-label="Nom" onchange="roadPerson(this,\'n\')"/>' +
          '<input class="rf-in" value="' + E(x.p) + '" placeholder="Téléphone" inputmode="tel" maxlength="30" aria-label="Téléphone" onchange="roadPerson(this,\'p\')"/>' +
          '<input class="rf-in" value="' + E(x.m) + '" placeholder="E-mail" inputmode="email" maxlength="120" aria-label="E-mail" onchange="roadPerson(this,\'m\')"/>' +
          '<button type="button" class="rf-ib" onclick="roadPersonDel(this)" title="Retirer" aria-label="Retirer ce contact"><i class="ti ti-x"></i></button></div>';
      }).join('') + '</div>';
  } else h += '<p class="rd-hint">Régisseur de la salle, tour manager, accueil artistes, loueur… Les destinataires d\'un lien les appellent d\'un toucher.</p>';
  if(d.people.length < _RD_MAX_PEOPLE) h += '<button type="button" class="rd-add" onclick="roadPersonAdd()"><i class="ti ti-plus"></i>Ajouter un contact</button>';
  h += '<p class="rd-priv"><i class="ti ti-lock"></i>Les contacts ne sont visibles que dans les liens où la feuille de route est cochée.</p></section>';
  h += '</div><div class="rd-col">';
  var field = function(f){
    var big = f[3] > 150;
    return '<label class="rd-f"><span>' + f[1] + '</span>' + (big
      ? '<textarea class="rf-in rd-ta" rows="2" maxlength="' + f[3] + '" placeholder="' + E(f[2]) + '" onchange="roadField(\'' + f[0] + '\',this.value)">' + E(d[f[0]]) + '</textarea>'
      : '<input class="rf-in" maxlength="' + f[3] + '" placeholder="' + E(f[2]) + '" value="' + E(d[f[0]]) + '" onchange="roadField(\'' + f[0] + '\',this.value)"/>') + '</label>';
  };
  h += '<section class="rd-card"><div class="rd-hd"><h3><i class="ti ti-map-2"></i>Lieu et accès</h3>' +
    (d.addr ? '<span class="rd-grow"></span><a class="ov-link" href="' + E(_rdMaps(d.addr)) + '" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>Carte</a>' : '') + '</div>' +
    _RD_PLACE.map(field).join('') + '</section>';
  h += '<section class="rd-card"><div class="rd-hd"><h3><i class="ti ti-building"></i>Logistique</h3></div>' + _RD_LOGI.map(field).join('') + '</section>';
  h += '<section class="rd-card"><div class="rd-hd"><h3><i class="ti ti-notes"></i>Notes</h3></div>' +
    '<textarea class="rf-in rd-ta" rows="4" maxlength="1500" placeholder="Consignes de la salle, sécurité, pass, merch, horaires de la presse…" onchange="roadField(\'notes\',this.value)">' + E(d.notes) + '</textarea></section>';
  h += '</div></div>';
  root.innerHTML = h;
}

/* ── Actions ── */
function _rdRow(el){ var r = el && el.closest ? el.closest('[data-id]') : null; return r ? r.dataset.id : ''; }
function roadEditShow(){
  if(!CUR_SHOW || typeof editShowMeta !== 'function') return;
  Promise.resolve(editShowMeta(CUR_SHOW.id)).then(function(){ renderRoad(); });
}
function roadField(k, v){
  var d = _rdLoad(), f = _RD_PLACE.concat(_RD_LOGI).filter(function(x){ return x[0] === k; })[0];
  if(k === 'notes') d.notes = _rdStr(v, 1500);
  else if(f) d[k] = _rdStr(v, f[3]);
  else return;
  _rdSave();
  if(k === 'addr') renderRoad();                    /* le lien « Carte » suit l'adresse */
}
function roadAdd(label){
  var d = _rdLoad(); if(d.sched.length >= _RD_MAX_SCHED) return;
  var x = { id:_rdId(), t:'', l:_rdLine(label, 60), n:'' };
  d.sched.push(x); _rdSave(); renderRoad();
  var i = document.querySelector('#road-root .rd-row[data-id="' + x.id + '"] .rd-t'); if(i) i.focus();
}
function roadDay(){
  var d = _rdLoad();
  _RD_DAY.forEach(function(l){ if(d.sched.length < _RD_MAX_SCHED) d.sched.push({ id:_rdId(), t:'', l:l, n:'' }); });
  _rdSave(); renderRoad();
  var i = document.querySelector('#road-root .rd-row .rd-t'); if(i) i.focus();
  toast('Journée type ajoutée : renseignez les heures, retirez ce qui ne sert pas.');
}
function roadSched(el, k){
  var d = _rdLoad(), x = d.sched.filter(function(s){ return s.id === _rdRow(el); })[0]; if(!x) return;
  if(k === 't'){
    var t = _rdTime(el.value);
    if(String(el.value).trim() && !t){ toast('Heure illisible : écrivez-la comme 14:30 ou 14h30.'); el.value = x.t; return; }
    x.t = t; _rdSave(); renderRoad();                 /* la ligne reprend sa place dans l'ordre des heures */
    var nx = document.querySelector('#road-root .rd-row[data-id="' + x.id + '"] .rf-in.b'); if(nx && !x.l) nx.focus();
    return;
  }
  x[k] = _rdLine(el.value, k === 'l' ? 60 : 120); el.value = x[k];
  _rdSave();
}
function roadDel(el){
  var d = _rdLoad(), id = _rdRow(el);
  d.sched = d.sched.filter(function(s){ return s.id !== id; });
  _rdSave(); renderRoad();
}
/* Retard ou avance : toutes les heures bougent d'autant */
function roadShift(){
  var d = _rdLoad();
  var v = prompt('Décaler toutes les heures de combien de minutes ?\nExemples : 30 pour un retard d\'une demi-heure, -15 pour avancer d\'un quart d\'heure.', '30');
  if(v === null) return;
  var n = parseInt(String(v).replace(/\s/g, '').replace(/min$/i, ''), 10);
  if(!isFinite(n) || !n || Math.abs(n) > 720){ toast('Décalage illisible : un nombre de minutes, par exemple 30 ou -15.'); return; }
  var k = 0;
  d.sched.forEach(function(x){
    var m = _rdMin(x.t); if(m < 0) return;
    m = ((m + n) % 1440 + 1440) % 1440;
    x.t = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); k++;
  });
  _rdSave(); renderRoad();
  toast(k + ' horaire' + (k > 1 ? 's décalés' : ' décalé') + ' de ' + (n > 0 ? '+' : '') + n + ' min');
}
function roadPersonAdd(){
  var d = _rdLoad(); if(d.people.length >= _RD_MAX_PEOPLE) return;
  var x = { id:_rdId(), r:'', n:'', p:'', m:'' };
  d.people.push(x); _rdSave(); renderRoad();
  var i = document.querySelector('#road-root .rd-pp[data-id="' + x.id + '"] .rd-r'); if(i) i.focus();
}
function roadPerson(el, k){
  var d = _rdLoad(), x = d.people.filter(function(s){ return s.id === _rdRow(el); })[0]; if(!x) return;
  x[k] = _rdLine(el.value, { r:60, n:60, p:30, m:120 }[k] || 60); el.value = x[k];
  _rdSave();
}
function roadPersonDel(el){
  var d = _rdLoad(), id = _rdRow(el), x = d.people.filter(function(s){ return s.id === id; })[0];
  if(x && (x.n || x.p) && !confirm('Retirer ' + (x.n || 'ce contact') + ' de la feuille de route ?')) return;
  d.people = d.people.filter(function(s){ return s.id !== id; });
  _rdSave(); renderRoad();
}

/* ── Texte à copier (WhatsApp, SMS, mail) ── */
function _rdText(d, show){
  var iso = _showDateISO(show.show_date), out = [];
  var dt = iso ? _isoToDate(iso).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }) : '';
  out.push('FEUILLE DE ROUTE — ' + [show.name, show.venue, dt].filter(Boolean).join(' · '));
  var list = _rdSorted(d.sched).filter(function(x){ return x.t || x.l; });
  if(list.length){ out.push('', 'HORAIRES'); list.forEach(function(x){ out.push((x.t || '  —  ') + '  ' + x.l + (x.n ? ' (' + x.n + ')' : '')); }); }
  var place = _RD_PLACE.filter(function(f){ return d[f[0]]; });
  if(place.length){ out.push('', 'LIEU'); place.forEach(function(f){ out.push(f[1] + ' : ' + d[f[0]]); }); }
  var ppl = d.people.filter(function(x){ return x.n || x.p || x.m; });
  if(ppl.length){ out.push('', 'CONTACTS'); ppl.forEach(function(x){ out.push([x.r, x.n].filter(Boolean).join(' — ') + (x.p ? ' · ' + x.p : '') + (x.m ? ' · ' + x.m : '')); }); }
  var logi = _RD_LOGI.filter(function(f){ return d[f[0]]; });
  if(logi.length){ out.push('', 'LOGISTIQUE'); logi.forEach(function(f){ out.push(f[1] + ' : ' + d[f[0]]); }); }
  if(d.notes){ out.push('', 'NOTES', d.notes); }
  return out.join('\n');
}
function roadCopy(){
  if(!CUR_SHOW) return;
  var d = _rdLoad();
  if(_rdIsEmpty(d)){ toast('La feuille de route est vide.'); return; }
  var txt = _rdText(d, CUR_SHOW);
  var done = function(){ toast('Feuille de route copiée : collez-la dans un message.'); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function(){ _rdCopyFallback(txt, done); });
  else _rdCopyFallback(txt, done);
}
function _rdCopyFallback(txt, done){
  var t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); done(); } catch(e){ toast('Copie impossible dans ce navigateur.'); }
  t.remove();
}

/* ── PDF, à la charte des autres exports ── */
async function roadPdf(){
  if(!CUR_SHOW) return;
  var d = _rdLoad();
  if(_rdIsEmpty(d)){ toast('La feuille de route est vide.'); return; }
  toast('Génération PDF…');
  try {
    var JsPDF = await _loadAutoTable(), doc = new JsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    var PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), K = _PDFK, M = K.M, brand = _pdfBrand(), acc = _hex2rgb(brand.color || '#ff6b1a');
    var pf = null; try { pf = await _pfLogoPng('#FF6B2B'); } catch(e){}
    var logo = await _pdfLogoInfo(brand.logo), s = CUR_SHOW, title = s.name || 'Show', TOP = 30, BOT = _pdfFootH(false) + 4;
    var iso = _showDateISO(s.show_date), dt = iso ? _isoToDate(iso).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '';
    var y = _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:'Feuille de route', title:title, sub:'', logo:logo,
      rightLines:['Édité le ' + new Date().toLocaleDateString('fr-FR') + ' à ' + new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })],
      meta:[['Date', dt ? dt.charAt(0).toUpperCase() + dt.slice(1) : ''], ['Lieu', s.venue], ['Adresse', d.addr]] }) + 3;
    var put = function(t){
      if(y > PH - BOT - 28){ doc.addPage(); y = TOP; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(K.ink[0], K.ink[1], K.ink[2]); doc.text(t, M, y + 4);
      y += 6;
    };
    var tbl = function(head, body, cols){
      doc.autoTable({ head:head ? [head] : [], showHead:head ? 'everyPage' : 'never', body:body, startY:y, theme:'plain', margin:{ left:M, right:M, top:TOP, bottom:BOT },
        styles:{ font:'helvetica', fontSize:9.5, cellPadding:{ top:1.9, bottom:1.9, left:1.8, right:1.8 }, textColor:K.ink, lineColor:K.line, lineWidth:{ bottom:0.2 }, valign:'middle', overflow:'linebreak' },
        headStyles:{ fontSize:6.5, fontStyle:'bold', textColor:K.muted, lineColor:K.ink, lineWidth:{ bottom:0.35 } },
        columnStyles:cols });
      y = doc.lastAutoTable.finalY + 7;
    };
    var list = _rdSorted(d.sched).filter(function(x){ return x.t || x.l; });
    if(list.length){ put('Horaires'); tbl(['HEURE', 'ÉTAPE', 'PRÉCISIONS'], list.map(function(x){ return [x.t || '—', x.l, x.n]; }),
      { 0:{ fontStyle:'bold', textColor:acc, cellWidth:18, font:'courier' }, 1:{ fontStyle:'bold', cellWidth:(PW - 2 * M - 18) * 0.42 }, 2:{ textColor:K.txt2, fontSize:8.5 } }); }
    var ppl = d.people.filter(function(x){ return x.n || x.p || x.m; });
    if(ppl.length){ put('Contacts'); tbl(['RÔLE', 'NOM', 'TÉLÉPHONE', 'E-MAIL'], ppl.map(function(x){ return [x.r, x.n, x.p, x.m]; }),
      { 0:{ textColor:K.txt2, cellWidth:44 }, 1:{ fontStyle:'bold', cellWidth:44 }, 2:{ cellWidth:34 }, 3:{ textColor:K.txt2, fontSize:8.5 } }); }
    var rows = _RD_PLACE.filter(function(f){ return f[0] !== 'addr' && d[f[0]]; }).concat(_RD_LOGI.filter(function(f){ return d[f[0]]; }));
    if(rows.length){ put('Lieu et logistique'); tbl(null, rows.map(function(f){ return [f[1], d[f[0]]]; }), { 0:{ fontStyle:'bold', textColor:K.txt2, cellWidth:44 }, 1:{} }); }
    if(d.notes){
      put('Notes');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(K.txt2[0], K.txt2[1], K.txt2[2]);
      doc.splitTextToSize(d.notes, PW - 2 * M).forEach(function(l){ if(y > PH - BOT - 6){ doc.addPage(); y = TOP; } doc.text(l, M, y + 3); y += 4.6; });
    }
    var n = doc.internal.getNumberOfPages();
    for(var p = 1; p <= n; p++){
      doc.setPage(p);
      if(p > 1) _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:'Feuille de route', title:title, compact:true, right:[s.venue, dt].filter(Boolean).join(' · ') });
      _pdfFoot(doc, { acc:acc, pf:pf, credit:_pdfCreditFree(), creditWhat:'feuille de route', qr:null, url:'', stamp:'', page:p, pages:n });
    }
    await _pdfDeliver(doc, (_pdfSlug(title) || 'patchflow') + '-feuille-de-route.pdf');
  } catch(e){ console.error('roadPdf:', e); toast('Export impossible : ' + (e && e.message || e)); }
}

/* ── Vue du rider partagé (lecture seule) ──
   chg : changements depuis la dernière visite du destinataire ({ids:{id:'new'|'mod'}, fields:{clé:1}}), ou null */
function _rdSharedHtml(raw, show, esc, chg){
  var d = _rdClean(raw), E = esc || _bonE, iso = _showDateISO(show && show.show_date);
  if(_rdIsEmpty(d)) return '<div class="sv-empty"><i class="ti ti-route"></i><b>Feuille de route vide</b><span>Les horaires et les contacts de la date apparaîtront ici dès qu\'ils seront saisis.</span></div>';
  var C = chg || { ids:{}, fields:{} }, mark = function(id){ return C.ids[id] ? ' sv-chg' + (C.ids[id] === 'new' ? ' new' : '') : ''; };
  var tag = function(id){ return C.ids[id] ? '<em class="sv-chg-t">' + (C.ids[id] === 'new' ? 'nouveau' : 'modifié') + '</em>' : ''; };
  var list = _rdSorted(d.sched).filter(function(x){ return x.t || x.l; }), now = _rdNow(list, iso), h = '';
  if(list.length){
    h += '<section class="sv-card sv-rd"><h4><i class="ti ti-clock"></i>Horaires' + (now ? '<span class="sv-rd-live"><i></i>Aujourd\'hui</span>' : '') + '</h4><ol class="sv-rd-t">' +
      list.map(function(x){
        var st = now && now.on === x.id ? ' on' : now && now.next === x.id ? ' next' : '';
        return '<li class="' + st + mark(x.id) + '"><b>' + (x.t ? E(x.t) : '—') + '</b><span>' + E(x.l) + (x.n ? '<small>' + E(x.n) + '</small>' : '') + '</span>' +
          (st === ' on' ? '<em class="sv-rd-now">en cours</em>' : st === ' next' ? '<em class="sv-rd-nx">à suivre</em>' : '') + tag(x.id) + '</li>';
      }).join('') + '</ol></section>';
  }
  var ppl = d.people.filter(function(x){ return x.n || x.p || x.m; });
  if(ppl.length){
    h += '<section class="sv-card sv-rd"><h4><i class="ti ti-address-book"></i>Contacts</h4><div class="sv-rd-pp">' +
      ppl.map(function(x){
        var tel = _rdTel(x.p);
        return '<div class="sv-rd-c' + mark(x.id) + '"><span><small>' + E(x.r || 'Contact') + '</small><b>' + E(x.n || x.p || x.m) + '</b>' + (x.p && x.n ? '<em>' + E(x.p) + '</em>' : '') + '</span>' + tag(x.id) +
          (tel ? '<a class="sv-rd-btn" href="tel:' + E(tel) + '" aria-label="Appeler ' + E(x.n || x.p) + '"><i class="ti ti-phone"></i></a>' : '') +
          (x.m ? '<a class="sv-rd-btn" href="mailto:' + E(x.m) + '" aria-label="Écrire à ' + E(x.n || x.m) + '"><i class="ti ti-mail"></i></a>' : '') + '</div>';
      }).join('') + '</div></section>';
  }
  var info = function(f){
    if(!d[f[0]]) return '';
    var v = E(d[f[0]]).replace(/\n/g, '<br/>');
    return '<div class="sv-rd-i' + (C.fields[f[0]] ? ' sv-chg' : '') + '"><small>' + f[1] + (C.fields[f[0]] ? ' <em class="sv-chg-t">modifié</em>' : '') + '</small><p>' + v +
      (f[0] === 'addr' ? ' <a href="' + E(_rdMaps(d.addr)) + '" target="_blank" rel="noopener" class="sv-rd-map"><i class="ti ti-map-2"></i>Itinéraire</a>' : '') + '</p></div>';
  };
  var place = _RD_PLACE.map(info).join(''), logi = _RD_LOGI.map(info).join('');
  if(place) h += '<section class="sv-card sv-rd"><h4><i class="ti ti-map-pin"></i>Lieu et accès</h4>' + place + '</section>';
  if(logi) h += '<section class="sv-card sv-rd"><h4><i class="ti ti-building"></i>Logistique</h4>' + logi + '</section>';
  if(d.notes) h += '<section class="sv-card sv-rd"><h4><i class="ti ti-notes"></i>Notes' + (C.fields.notes ? ' <em class="sv-chg-t">modifié</em>' : '') + '</h4><p class="sv-rd-notes' + (C.fields.notes ? ' sv-chg' : '') + '">' + E(d.notes).replace(/\n/g, '<br/>') + '</p></section>';
  return h;
}
