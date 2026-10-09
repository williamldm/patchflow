/* ══════════════════════════════════════════════════════════════════════
   PatchFlow — module RF
   Reprend une session Shure Wireless Workbench (.shw) et en fait un outil
   de préparation : canaux HF, fréquences, utilisateurs, états, contrôles
   simples, liaison avec l'input list, feuille RF.

   Ce fichier se charge après pf-app.js. La première partie (lecture du
   .shw, bandes, contrôles, fusion) ne dépend de rien d'autre que du
   navigateur : elle est testée seule par tests/rf.html.

   Ce que le module ne fait pas, et ne prétend pas faire : calculer les
   intermodulations ou garantir une coordination. Les contrôles portent
   sur les fréquences saisies, avec les espacements du profil WWB quand
   la session les fournit. Aucune fréquence n'est modifiée d'office.
   ══════════════════════════════════════════════════════════════════════ */

/* Plages d'accord par série et par bande (kHz), telles que publiées par
   les fabricants. Une bande absente de cette table reste « plage inconnue » :
   aucun contrôle de plage n'est alors fait. */
const _RF_BANDS_RAW={
  'D9000':'A1=470000~494000;A2=494000~518000;A3=510000~534000;A4=534000~558000;A5=550000~574000;A6=574000~598000;A7=590000~614000;A8=614000~638000;B1=630000~654000;B2=654000~678000;B3=670000~694000;B4=694000~718000;B5=710000~734000;B6=734000~758000;B7=750000~774000;B8=774000~798000',
  'EM 2000|EM 2050|SR 2000|SR 2050':'Aw=516000~558000;Bw=626000~698000;Cw=718000~790000;Dw=790000~865000;Gw=558000~626000',
  'EM 3732':'A=470000~560000;B=518000~608000;C=548000~638000;D=614000~704000;E=678000~768000;F=708000~798000;G=776000~866000;H=814000~904000;I=870000~960000',
  'EM 3732-II':'L=470000~638000;N=614000~798000;P=776000~960000',
  'EM 6000':'A1A4=470200~558000;A5A8=550000~638000;B1B4=630850~713800',
  'EW 100 G3|EW 300 G3|EW 300 IEM G3|EW 500 G3':'A=516000~558000;B=626000~668000;C=734000~776000;D=780000~822000;E=823000~865000;G=566000~608000',
  'EW 100 G4':'A=516000~558000;A1=470000~516000;AS=520000~558000;B=626000~668000;C=734000~776000;D=780000~822000;GB=606000~648000;JB=806000~810000;K=925000~937500;TH=780000~822000',
  'EW 300-500 G4':'AS=520000~558000;Aw+=470100~558000;Bw=626000~698000;Cw=718100~789900;Dw=790100~864900;GBw=606000~678000;Gw=558000~626000;Gw1=558000~608000;JB=806125~809875;K+=925100~937400',
  'EW IEM G4':'A=516000~558000;A1=470000~516000;AS=520000~558000;B=626000~668000;C=734000~776000;D=780000~822000;E=823000~865000;G=566000~608000;GB=606000~648000',
  'EW-D EM':'Q1-6=470200000~526000000;R1-6=520000000~576000000;R4-9=552000000~607800000;S1-7=606200000~662000000;S4-7=630000000~662000000;S7-10=662000000~693800000;U1/5=823200000~864800000;V3-4=925200000~937300000;Y1-3=1785200000~1799800000',
  'AD':'G53=470125~509875;G54=479125~564875;G55=470125~636000;G56=470150~636000;G57=470125~607875;G57+=470125~615875;G62=510100~529900;G63=487125~635875;H54=520125~636000;JB=806125~809750;K53=606000~697875;K54=606000~662875;K55=606125~693875;K56=606000~713850;K57=606125~789875;K58=622125~697875;L54=630125~786875;L60=630125~697875;P55=694500~805700;R52=794125~805875;X51=925125~937375;X55=941625~959725;X56=960125~1000000;Z16=1240125~1259875',
  'ADPSM':'G53=470125~509875;G54=479125~564875;G55=470125~636000;G56=470150~636000;G56J=470150~636000;G56K=470150~636000;G57=470125~607875;G63=487125~635875;H54=520125~636000;K54=606000~662875;K55=606000~693875;K56=606000~713875;K58=622125~697875;K60=614125~702875;L60=630125~697875;P55=694500~805700;X51=925125~937350;X55=941625~959725;X57=961125~1153875;Z16=1240125~1259875',
  'AXT':'A24=779125~805875;G1=470125~529875;G12=479125~529875;G19=470125~529875;G1E=470125~529875;G1HK=470125~529875;G7C=470125~509875;H12=518125~564875;H18=518000~578000;H4=518000~578000;H4E=518000~578000;H4HK=518000~578000;J12=578000~638000;J5=578000~638000;J5A=578000~607875;J5E=578000~638000;J5HK=578000~638000;JBX=806125~809750;K4E=606125~665875;L20=638000~698000;L3=638000~697875;L3A=653125~662875;L3E=638000~698000;L3HK=638000~698000;M8=666000~730000;MA24=779125~805875;MJBX=806125~809750;P8=710000~790000;P9=710000~786875;Q10A=740125~786875;Q5=740000~814000;Q5HK=740000~805875;R16=794125~805875',
  'BLX':'G18=470125~493875;H10=542125~571800;H10E=542125~571800;H11=572125~595850;H62=518125~529850;H8=518125~541850;H8E=518100~541875;H9=512125~541800;J10=584150~607875;J11=596125~615875;JB=806125~809750;K12=614150~637875;K14=614125~637875;K3E=606125~629875;L19=630150~653800;L27=674125~697875;M15=662150~685875;M16=686125~709800;M17=662125~685875;M19=694125~702850;P18=710125~733850;Q12=748150~757850;Q25=742125~765875;Q26=764125~786825;R12=794075~805925;S8=823125~831825;T11=863125~864875;X7=925125~937375',
  'PSM1000':'A24=779250~805750;G10=470125~541875;G10E=470125~541875;G10J=470250~541750;G11=479125~541875;G53=470125~509875;G62=510125~529875;H22=518125~581875;H8Z=518125~581875;J8=554125~625875;J8A=554000~615875;J8E=554125~625875;J8J=554250~625750;K10E=596125~667775;L11J=670250~713750;L60=630125~697875;L8=626125~697875;L8A=653125~662875;L8E=626125~697875;L8J=626250~697750;L9E=670125~741875;M19=694500~702700;P8=710125~789875;Q12=748300~757700;Q21=750125~786875;Q22E=750125~821875;R26=794125~805875;R27=794125~805875;X1=944125~951875;X2=925125~931875;X55=941625~959725;X7=925125~937375',
  'PSM300':'G20=488125~511875;H20=518125~541875;H62=518125~529875;H8E=518100~541875;J10=584150~607875;J13=566125~589875;JB=806125~809750;K12=614150~637875;K3E=606125~629875;L18=630250~653750;L19=630150~653800;L26=655125~678875;M16=686125~709800;M18=686250~709750;Q12=748300~757700;Q25=742125~765875;R12=794075~805925;S8=823125~831875;T11=863125~864875;X7=925125~937375',
  'PSM900':'A24=779250~805750;G14=506125~541875;G14J=506250~541750;G6=470125~505875;G62=510125~529875;G6E=470125~505875;G6J=470250~505750;G7=506125~541875;G7E=506125~541875;G7Z=518125~541875;H21=542125~577875;K1=596125~631875;K1E=596125~631875;K1J=596250~631750;L6=656125~691875;L6E=656125~691875;L6J=656250~691750;P7=702125~741875;Q12=748300~757700;Q15=750125~789875;Q20=750125~786875;R20=794125~805875;R21=794125~805875;R22=790125~829875;X1=944125~951875;X2=925125~931875;X55=941625~959725;X7=925125~937375',
  'QLXD':'G50=470125~534000;G51=470125~534000;G52=479125~533875;G53=470125~509875;G62=510100~529900;H50=534000~598000;H51=534000~598000;H52=534125~564875;H53=534000~598000;J50=572000~636000;J50A=572000~615875;J51=572000~636000;JB=806125~809750;K51=606000~670000;K52=606000~670000;L50=632000~696000;L50A=653125~662875;L51=632125~695875;L52=632000~694000;L53=632000~713850;M19=694500~702700;P51=710000~782000;P52=710000~782000;Q12=748300~757700;Q51=794125~805875;S50=823125~864875;V50=174125~215875;V51=174125~215875;V52=174125~209875;X51=925125~937375;X52=902400~927600;X53=902400~927600;X54=915400~927600;Z17=1492125~1524875;Z18=1785200~1804800;Z19=1786025~1800000;Z20=1790100~1804900',
  'SLXD':'G54=479125~564875;G57=470125~607875;G58=470125~514000;G59=470125~513875;G60=470125~510000;G61=479125~523000;G62=510100~529900;G64=470125~615875;G65=470125~605875;G66=487125~605875;H55=514000~558000;H56=518125~561875;H57=520000~564000;H58=520125~607875;J52=558000~615875;J53=562125~605875;J54=562125~605875;JB=806125~809875;K55=606125~693875;K59=606500~649875;K60=614125~702875;L55=646000~690000;L56=650125~693875;L57=650000~694000;L58=630125~674000;L59=654000~697875;L60=630125~697875;M55=694400~757800;S50=823125~864875;X51=925125~937375',
  'UHFR':'A24=779125~805875;G1=470125~529875;G1E=470125~529875;G1HK=470125~529875;G7C=470125~509875;H4=518000~578000;H4E=518000~578000;H4HK=518000~578000;J5=578000~638000;J5E=578000~638000;J5HK=578000~638000;JBX=806125~809750;K4E=606125~665875;L3=638000~697875;L3E=638000~698000;L3HK=638000~698000;M5E=694125~757875;M6=692000~713875;P8=710000~790000;P9=710000~786875;Q10=740000~797900;Q10A=740125~786875;Q5=740000~814000;Q5HK=740000~805875;Q6=740125~751875;Q9=740000~805975;R16=794125~805875;R18=794125~805875;R9=790000~865000;X1=944125~951875',
  'ULXD':'AB=770250~809750;G50=470125~534000;G51=470125~534000;G52=479125~533875;G53=470125~509875;G54=479125~564875;G55=470125~636000;G56=470150~636000;G57=470125~607875;G62=510100~529900;G65=470125~605875;G66=487125~605875;H50=534000~598000;H51=534000~598000;H52=534125~564875;H53=534000~598000;H54=520125~636000;J50=572000~636000;J50A=572000~615875;J51=572000~636000;JA=770250~805750;JB=806125~809750;K51=606000~670000;K52=606000~670000;L50=632000~696000;L50A=653125~662875;L51=632125~695875;L52=632000~694000;L53=632000~713850;M19=694500~702700;P51=710000~782000;P52=710000~782000;Q12=748300~757700;Q51=794125~805875;R51=800125~810000;S50=823125~864875;V50=174125~215875;V51=174125~215875;V52=174125~209875;X50=925125~931875;X51=925125~937375;X52=902400~927600;X53=902400~927600;X54=915400~927600;Z16=1240125~1259875;Z17=1492125~1524875;Z18=1785200~1804800;Z19=1786025~1800000;Z20=1790100~1804900'
};

const _RF_ST = [['todo','À préparer'],['prep','Préparé'],['test','Testé'],['ok','Prêt'],['pb','Problème']];
const _RF_KINDS = [['mic','Micro'],['mic:hh','Micro main'],['mic:bp','Micro ceinture'],['iem','IEM'],['oth','Autre liaison']];
const _RF_HUES = ['#ff6b1a','#3b82f6','#22c55e','#a855f7','#eab308','#06b6d4','#ec4899','#84cc16','#f43f5e','#64748b'];
const _RF_MAX_CH = 600;

/* ── Outils ── */
/* « 1 canal », « 7 canaux » */
function _rfPl(n){ return n + (n > 1 ? ' canaux' : ' canal'); }
function _rfId(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function _rfStr(v, n){ return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 80); }
function _rfInt(v){ v = parseInt(v, 10); return isFinite(v) ? v : 0; }
/* Fréquence valide : entre 30 MHz et 7 GHz, en kHz entiers */
function _rfFreq(v){ v = Math.round(+v); return (isFinite(v) && v >= 30000 && v <= 7000000) ? v : 0; }
function _rfFmt(k){ return k ? (k / 1000).toFixed(3) : ''; }
/* « 606.125 », « 606,125 MHz », « 606125 » (kHz) → kHz ; 0 si illisible */
function _rfParseMHz(v){
  var s = String(v == null ? '' : v).replace(/mhz|khz/ig, '').replace(/\s+/g, '').replace(',', '.');
  if(!/^\d+(\.\d+)?$/.test(s)) return 0;
  var n = parseFloat(s);
  return _rfFreq(n >= 30000 ? n : n * 1000);
}
function _rfNorm(s){ return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim(); }
function _rfNormSer(s){ return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
var _RF_BMAP = null;
function _rfBand(ser, band){
  if(!_RF_BMAP){
    _RF_BMAP = {};
    Object.keys(_RF_BANDS_RAW).forEach(function(k){
      var sers = k.split('|');
      _RF_BANDS_RAW[k].split(';').forEach(function(p){
        var i = p.indexOf('='), r = p.slice(i + 1).split('~');
        sers.forEach(function(s){ _RF_BMAP[_rfNormSer(s) + '|' + p.slice(0, i)] = [+r[0], +r[1]]; });
      });
    });
  }
  return _RF_BMAP[_rfNormSer(ser) + '|' + String(band || '').trim()] || null;
}
function _rfRange(c){ return c.band ? _rfBand(c.ser, c.band) : null; }
/* Nom laissé par défaut dans WWB : le canal n'a pas été nommé */
function _rfDefaultName(n){ return !n || /^(shure|sennheiser|generic|rx ?\d*|tx ?\d*|ch(annel)? ?\d*|remchannel\d*)$/i.test(String(n).trim()); }

/* ── Données d'un show ── */
function _rfEmpty(){ return { v:1, src:null, zones:[], iso:[], excl:[], spare:[], ch:[], vers:[] }; }
function _rfCleanCh(c){
  if(!c || typeof c !== 'object') return null;
  var kind = c.kind === 'iem' || c.kind === 'oth' ? c.kind : 'mic';
  var st = 'todo'; _RF_ST.forEach(function(s){ if(s[0] === c.st) st = c.st; });
  return { id: /^[a-z0-9]{4,24}$/.test(c.id) ? c.id : _rfId(), src: _rfStr(c.src, 60), did: _rfStr(c.did, 48),
    n: _rfStr(c.n, 60), n0: _rfStr(c.n0, 60), who: _rfStr(c.who, 60), kind: kind,
    tx: (kind === 'mic' && (c.tx === 'hh' || c.tx === 'bp')) ? c.tx : '',
    f: _rfFreq(c.f), band: _rfStr(c.band, 16), ser: _rfStr(c.ser, 30), mdl: _rfStr(c.mdl, 30), mk: _rfStr(c.mk, 30),
    dev: _rfStr(c.dev, 40), zone: _rfStr(c.zone, 40), tags: _rfStr(c.tags, 80), gc: _rfStr(c.gc, 20),
    pw: Math.max(0, Math.min(5000, _rfInt(c.pw))), sp: Math.max(0, Math.min(5000, _rfInt(c.sp))),
    note: _rfStr(c.note, 200), st: st, il: _rfStr(c.il, 60), out: _rfStr(c.out, 60) };
}
function _rfClean(d){
  var o = _rfEmpty();
  if(!d || typeof d !== 'object') return o;
  var L = function(a){ return Array.isArray(a) ? a : []; };
  if(d.src && typeof d.src === 'object') o.src = { file:_rfStr(d.src.file, 120), show:_rfStr(d.src.show, 80), app:_rfStr(d.src.app, 20), at:_rfStr(d.src.at, 30), mode: d.src.mode === 'coord' ? 'coord' : 'inv' };
  o.zones = L(d.zones).map(function(z){ return _rfStr(z, 40); }).filter(Boolean).slice(0, 60);
  o.iso = L(d.iso).filter(function(p){ return Array.isArray(p) && p.length === 2; }).slice(0, 400).map(function(p){ return [_rfStr(p[0], 40), _rfStr(p[1], 40)]; });
  o.excl = L(d.excl).map(function(e){ return e && { a:_rfFreq(e.a), b:_rfFreq(e.b), l:_rfStr(e.l, 40) }; }).filter(function(e){ return e && e.a && e.b > e.a; }).slice(0, 400);
  o.spare = L(d.spare).map(function(s){ return s && { f:_rfFreq(s.f), ser:_rfStr(s.ser, 30), band:_rfStr(s.band, 16), zone:_rfStr(s.zone, 40) }; }).filter(function(s){ return s && s.f; }).slice(0, 200);
  o.ch = L(d.ch).map(_rfCleanCh).filter(Boolean).slice(0, _RF_MAX_CH);
  var seen = {};
  o.ch.forEach(function(c){ if(seen[c.id]) c.id = _rfId(); seen[c.id] = 1; });
  o.vers = L(d.vers).slice(-3).map(function(v){ return v && { at:_rfStr(v.at, 30), label:_rfStr(v.label, 120), ch:L(v.ch).map(_rfCleanCh).filter(Boolean).slice(0, _RF_MAX_CH) }; }).filter(function(v){ return v && v.ch.length; });
  return o;
}

/* ── Lecture d'un show Wireless Workbench (.shw) ──────────────────────
   Le .shw est un XML : <show> → <inventory> (appareils et canaux),
   <coordinated_data_root> (fréquences coordonnées, profils d'espacement),
   <coordination_info> (exclusions). Le format n'est pas documenté par
   Shure : tout champ absent est toléré, et un fichier qui n'a pas cette
   forme est refusé avec un message clair. */
function _rfKid(el, name){ if(!el) return null; for(var c = el.firstElementChild; c; c = c.nextElementSibling) if(c.tagName === name) return c; return null; }
function _rfKids(el, name){ var o = []; if(el) for(var c = el.firstElementChild; c; c = c.nextElementSibling) if(c.tagName === name) o.push(c); return o; }
function _rfTxt(el, name){ var k = _rfKid(el, name); return k ? String(k.textContent || '').trim() : ''; }
function _rfPath(el, path){ path.split('/').forEach(function(p){ el = _rfKid(el, p); }); return el; }
function _rfParseShw(text){
  var fail = function(m){ return { ok:false, err:m }; };
  if(typeof text !== 'string' || !text.trim()) return fail('Fichier vide.');
  if(text.length > 25e6) return fail('Fichier trop volumineux (25 Mo au maximum).');
  if(text.slice(0, 2) === 'PK') return fail('Ce fichier est une archive, pas un show. Ouvrez-le dans Wireless Workbench puis enregistrez le show au format .shw.');
  if(text.indexOf('<show') < 0 || text.indexOf('<inventory') < 0) return fail('Ce fichier n\'est pas un show Wireless Workbench (.shw).');
  var doc;
  try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch(e){ return fail('Fichier .shw illisible.'); }
  if(!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return fail('Fichier .shw illisible : le XML est endommagé ou incomplet.');
  var root = doc.documentElement;
  if(root.tagName !== 'show') return fail('Ce fichier n\'est pas un show Wireless Workbench (.shw).');
  var inv = _rfKid(root, 'inventory');
  if(!inv) return fail('Ce show ne contient pas d\'inventaire : aucun appareil à reprendre.');

  var out = { ok:true, show:{ name:_rfStr(_rfTxt(_rfPath(root, 'show_properties/show_info'), 'name'), 80), app:_rfStr(root.getAttribute('appl_version'), 20), date:_rfStr(root.getAttribute('date'), 30) },
              zones:[], iso:[], excl:[], ch:[], spare:[], skipped:0, coordDiff:0, invDup:0, suggest:'inv' };

  /* Zones et isolement entre zones (matrice de WWB : ch-ch à 0 = zones qui ne se voient pas) */
  var zs = _rfKid(inv, 'zones');
  _rfKids(zs, 'zone').forEach(function(z){ var n = _rfStr(z.textContent, 40); if(n && out.zones.indexOf(n) < 0) out.zones.push(n); });
  _rfKids(_rfKid(zs, 'zone_matrix'), 'from').forEach(function(f){
    var a = _rfStr(f.getAttribute('zone'), 40);
    _rfKids(f, 'to').forEach(function(t){
      var b = _rfStr(t.getAttribute('zone'), 40);
      if(a && b && a !== b && _rfTxt(t, 'ch-ch') === '0') out.iso.push([a, b]);
    });
  });

  /* Coordination : fréquence coordonnée, type d'appareil et espacement du profil, par canal */
  var cr = _rfKid(root, 'coordinated_data_root'), prof = {}, coord = {}, used = {};
  _rfKids(_rfKid(cr, 'compatibility_profile_settings'), 'profile').forEach(function(p){
    var cp = _rfKid(p, 'compat_profile'); if(!cp) return;
    var sp = _rfInt(_rfTxt(_rfKid(cp, 'spacing'), 'ch_ch')); if(sp <= 0) return;
    /* L'identifiant du profil ne correspond pas toujours à celui des canaux : repli sur série + bande (+ zone) */
    var k = _rfTxt(p, 'series') + '|' + _rfTxt(p, 'band');
    if(cp.getAttribute('id')) prof['#' + cp.getAttribute('id')] = sp;
    prof[k + '|' + _rfTxt(p, 'zone')] = sp;
    if(!prof[k]) prof[k] = sp;
  });
  var spacing = function(e){
    var ck = _rfKid(e, 'compat_key'), k = _rfTxt(ck, 'series') + '|' + _rfTxt(ck, 'band');
    return prof['#' + _rfTxt(e, 'compat_prof_id')] || prof[k + '|' + _rfTxt(ck, 'zone')] || prof[k] || 0;
  };
  var entries = _rfKids(_rfKid(cr, 'mic_channels'), 'freq_entry');
  entries.forEach(function(e){ var sid = _rfTxt(e, 'source_id'); if(sid) coord[sid] = e; });

  /* Inventaire */
  var defaults = {};
  _rfKids(inv, 'device').forEach(function(d){
    var chans = _rfKids(d, 'channel');
    if(!chans.length){ out.skipped++; return; }
    var did = _rfTxt(d, 'id'), ser = _rfStr(_rfTxt(d, 'series'), 30), mdl = _rfStr(_rfTxt(d, 'model'), 30);
    var mk = _rfStr(_rfTxt(d, 'manufacturer'), 30), dev = _rfStr(_rfTxt(d, 'device_name'), 40);
    var band = _rfStr(_rfTxt(d, 'band'), 16), zone = _rfStr(_rfTxt(d, 'zone'), 40);
    if(zone && out.zones.indexOf(zone) < 0) out.zones.push(zone);
    chans.forEach(function(c, i){
      if(out.ch.length >= _RF_MAX_CH) return;
      var num = _rfInt(c.getAttribute('number')) || (i + 1);
      var sid = did + '-' + (num - 1), e = coord[sid];
      if(!e && chans.length === 1){ sid = did; e = coord[sid]; }       /* appareil à un canal : identifiant sans suffixe */
      if(e) used[sid] = 1;
      var types = e ? _rfKids(_rfKid(e, 'dev_category'), 'dev_type').map(function(t){ return t.textContent || ''; }).join(' ') : '';
      var kind = /in ear/i.test(types) ? 'iem' : /intercom|other/i.test(types) ? 'oth' : /micro/i.test(types) ? 'mic'
               : /^(psm|adpsm|sr\b|sr ?\d|ew .*iem)/i.test(ser) || /^(adtq|p\d+t|sr ?\d)/i.test(mdl) ? 'iem' : 'mic';
      var gc = _rfStr(_rfTxt(c, 'group_channel'), 20); if(!/\d/.test(gc)) gc = '';
      var fi = _rfFreq(_rfTxt(c, 'frequency')), fc = e ? _rfFreq(_rfTxt(e, 'value')) : 0;
      if(fc && fc !== fi) out.coordDiff++;
      if(fi) defaults[fi] = (defaults[fi] || 0) + 1;
      out.ch.push({ src:(did ? sid : ''), did:did, n:_rfStr(_rfTxt(c, 'channel_name'), 60), dev:dev + (chans.length > 1 ? ' · ' + num : ''),
        mk:mk, ser:ser, mdl:mdl, band:band, zone:zone, tags:_rfStr(_rfTxt(c, 'tags'), 80), gc:gc,
        pw:Math.max(0, _rfInt(_rfTxt(c, 'tx_power'))), kind:kind, fi:fi, fc:fc,
        sp:e ? spacing(e) : 0 });
    });
  });
  if(!out.ch.length) return fail('Aucun canal HF dans ce show : l\'inventaire est vide.');
  Object.keys(defaults).forEach(function(f){ if(defaults[f] > 1) out.invDup += defaults[f]; });
  /* Fréquences coordonnées mais pas encore envoyées aux appareils : l'inventaire est resté sur ses
     valeurs par défaut (doublons) → la coordination est la bonne source. Sinon, l'inventaire. */
  if(out.coordDiff && out.invDup >= out.coordDiff) out.suggest = 'coord';

  /* Fréquences coordonnées sans appareil : réserves */
  entries.forEach(function(e){
    var sid = _rfTxt(e, 'source_id'), f = _rfFreq(_rfTxt(e, 'value')), k = _rfKid(e, 'compat_key');
    if(used[sid] || !f || out.spare.length >= 200) return;
    out.spare.push({ f:f, ser:_rfStr(_rfTxt(k, 'series'), 30), band:_rfStr(_rfTxt(k, 'band'), 16), zone:_rfStr(_rfTxt(k, 'zone'), 40) });
  });

  /* Exclusions actives de la session */
  var ci = _rfKid(root, 'coordination_info');
  _rfKids(_rfPath(ci, 'global_exclusions/freq_range_exclusions'), 'range').forEach(function(r){
    var fr = _rfKid(r, 'frequency'), ex = _rfTxt(r, 'exclude');
    if(ex !== '1' && ex !== 'true') return;
    var a = _rfFreq(_rfTxt(fr, 'start')), b = _rfFreq(_rfTxt(fr, 'end'));
    if(a && b > a && out.excl.length < 400) out.excl.push({ a:a, b:b, l:_rfStr(_rfTxt(r, 'notes') || _rfTxt(r, 'source'), 40) });
  });
  _rfKids(_rfPath(ci, 'channel_exclusions/channel_avoidance_info'), 'channel').forEach(function(c){
    if(_rfTxt(c, 'exclude') !== 'true') return;
    var a = _rfParseMHz(_rfTxt(c, 'tv_chann_start_freq')), b = _rfParseMHz(_rfTxt(c, 'tv_chann_end_freq'));
    if(a && b > a && out.excl.length < 400) out.excl.push({ a:a, b:b, l:'TV ' + _rfStr(_rfTxt(c, 'number'), 6) });
  });
  return out;
}

/* ── Fusion d'une session lue avec les canaux déjà présents ───────────
   mode : 'coord' reprend la fréquence coordonnée quand elle existe, 'inv'
   celle de l'appareil. Ce que l'utilisateur a saisi dans PatchFlow
   (utilisateur, type d'émetteur, état, note, liaison, nom modifié) est
   conservé ; le nom et la fréquence viennent du fichier. drop : retirer
   les canaux qui ne sont plus dans la session. */
function _rfMerge(cur, parsed, opt){
  opt = opt || {};
  var mode = opt.mode === 'coord' ? 'coord' : 'inv';
  var old = (cur || []).slice(), bySrc = {}, byKey = {}, taken = {};
  var key = function(c){ return _rfDefaultName(c.n0 || c.n) ? '' : _rfNorm(c.n0 || c.n) + '|' + _rfNormSer(c.mdl); };
  old.forEach(function(c){ if(c.src) bySrc[c.src] = c; var k = key(c); if(k) byKey[k] = byKey[k] === undefined ? c : null; });
  var res = { ch:[], add:0, upd:0, same:0, gone:0, diffs:[] };
  parsed.ch.forEach(function(p){
    var f = (mode === 'coord' && p.fc) ? p.fc : p.fi;
    var m = (p.src && bySrc[p.src]) || null;
    if(!m){ var k = _rfDefaultName(p.n) ? '' : _rfNorm(p.n) + '|' + _rfNormSer(p.mdl); if(k && byKey[k] && !taken[byKey[k].id]) m = byKey[k]; }
    if(m && taken[m.id]) m = null;
    var base = { src:p.src, did:p.did, n0:p.n, dev:p.dev, mk:p.mk, ser:p.ser, mdl:p.mdl, band:p.band, tags:p.tags, gc:p.gc, pw:p.pw, sp:p.sp, f:f };
    if(m){
      taken[m.id] = 1;
      var what = [];
      if(m.f !== f) what.push(_rfFmt(m.f) ? _rfFmt(m.f) + ' → ' + (_rfFmt(f) || 'aucune') : 'fréquence ' + _rfFmt(f));
      var renamed = m.n !== m.n0 && !!m.n;                      /* nom retouché dans PatchFlow : on le garde */
      if(!renamed && m.n !== p.n) what.push('nom « ' + (m.n || '—') + ' » → « ' + (p.n || '—') + ' »');
      if(m.band !== p.band && p.band) what.push('bande ' + p.band);
      var c = _rfCleanCh(Object.assign({}, m, base, { n: renamed ? m.n : p.n, zone: m.zone || p.zone, kind: m.kind }));
      res.ch.push(c);
      if(what.length){ res.upd++; res.diffs.push({ id:c.id, n:c.n || c.dev, what:what }); } else res.same++;
    } else {
      res.add++;
      res.ch.push(_rfCleanCh(Object.assign({ id:_rfId(), n:p.n, zone:p.zone, kind:p.kind, who:'', tx:'', note:'', st:'todo', il:'', out:'' }, base)));
    }
  });
  old.forEach(function(c){
    if(taken[c.id]) return;
    res.gone++;
    if(!opt.drop) res.ch.push(c);
  });
  return res;
}

/* ── Contrôles simples ─────────────────────────────────────────────────
   rf : données du show. il : { chs:[{id,ch,name,mic,hf}], outs:[{id,ch,name,hf}] }
   (facultatif) pour les recoupements avec l'input list.
   Chaque alerte : { lvl:'err'|'warn'|'info', code, ids, msg }. */
function _rfIsHfRow(r){
  return /\b(hf|sans[ -]?fil|wireless|ulxd\w*|qlxd\w*|slxd\w*|axient|adx?[123]\w*|skm ?\d*|sk ?\d{3,4}|ur[124]d?)\b/i.test((r.mic || '') + ' ' + (r.name || '')) || !!String(r.hf || '').trim();
}
function _rfChecks(rf, il){
  var out = [], ch = (rf && rf.ch) || [], iso = {};
  ((rf && rf.iso) || []).forEach(function(p){ iso[p[0] + '|' + p[1]] = 1; iso[p[1] + '|' + p[0]] = 1; });
  var apart = function(a, b){ return !!(a.zone && b.zone && a.zone !== b.zone && iso[a.zone + '|' + b.zone]); };
  var nm = function(c){ return c.n || c.who || c.dev || 'Canal'; };
  var push = function(lvl, code, ids, msg){ out.push({ lvl:lvl, code:code, ids:ids, msg:msg }); };
  var on = ch.filter(function(c){ return c.f > 0; }).sort(function(a, b){ return a.f - b.f; });

  /* Doublons */
  var byF = {};
  on.forEach(function(c){ (byF[c.f] = byF[c.f] || []).push(c); });
  Object.keys(byF).forEach(function(f){
    var g = byF[f]; if(g.length < 2) return;
    if(g.length >= 4){ push('err', 'dup', g.map(function(c){ return c.id; }), g.length + ' canaux sur ' + _rfFmt(+f) + ' MHz : fréquences sans doute pas encore attribuées.'); return; }
    for(var i = 0; i < g.length; i++) for(var j = i + 1; j < g.length; j++){
      if(apart(g[i], g[j])) continue;
      push('err', 'dup', [g[i].id, g[j].id], '« ' + nm(g[i]) + ' » et « ' + nm(g[j]) + ' » sont sur la même fréquence (' + _rfFmt(+f) + ' MHz).');
    }
  });
  /* Écart inférieur à l'espacement du profil WWB */
  var maxSp = 0, near = 0;
  on.forEach(function(c){ if(c.sp > maxSp) maxSp = c.sp; });
  for(var i = 0; i < on.length && maxSp; i++){
    for(var j = i + 1; j < on.length && on[j].f - on[i].f < maxSp; j++){
      var d = on[j].f - on[i].f, need = Math.max(on[i].sp, on[j].sp);
      if(!d || !need || d >= need || apart(on[i], on[j])) continue;
      if(++near <= 30) push('warn', 'near', [on[i].id, on[j].id], '« ' + nm(on[i]) + ' » et « ' + nm(on[j]) + ' » : écart de ' + d + ' kHz, le profil de la session en demande ' + need + '.');
    }
  }
  if(near > 30) push('warn', 'near', [], (near - 30) + ' autres paires trop proches.');
  /* Hors plage d'accord, plage exclue */
  on.forEach(function(c){
    var r = _rfRange(c);
    if(r && (c.f < r[0] || c.f > r[1])) push('err', 'range', [c.id], '« ' + nm(c) + ' » : ' + _rfFmt(c.f) + ' MHz hors de la bande ' + c.band + ' (' + _rfFmt(r[0]) + ' à ' + _rfFmt(r[1]) + ').');
    var ex = ((rf && rf.excl) || []).filter(function(e){ return c.f >= e.a && c.f <= e.b; })[0];
    if(ex) push('warn', 'excl', [c.id], '« ' + nm(c) + ' » : ' + _rfFmt(c.f) + ' MHz dans une plage exclue de la session' + (ex.l ? ' (' + ex.l + ')' : '') + '.');
  });
  var group = function(lvl, code, list, one, many){
    if(list.length) push(lvl, code, list.map(function(c){ return c.id; }), list.length + ' ' + (list.length > 1 ? many : one));
  };
  group('warn', 'pb', ch.filter(function(c){ return c.st === 'pb'; }), 'canal signalé en problème.', 'canaux signalés en problème.');
  group('warn', 'nofreq', ch.filter(function(c){ return !c.f; }), 'canal sans fréquence.', 'canaux sans fréquence.');
  group('info', 'nowho', ch.filter(function(c){ return !c.who; }), 'canal sans utilisateur.', 'canaux sans utilisateur.');
  group('info', 'noname', ch.filter(function(c){ return _rfDefaultName(c.n); }), 'canal sans nom.', 'canaux sans nom.');

  /* Recoupement avec l'input list */
  if(il){
    var rows = {}, outs = {}, linked = {};
    (il.chs || []).forEach(function(r){ rows[r.id] = r; });
    (il.outs || []).forEach(function(r){ outs[r.id] = r; });
    ch.forEach(function(c){
      var r = c.il ? rows[c.il] : (c.out ? outs[c.out] : null), isOut = !c.il && !!c.out;
      if((c.il || c.out) && !r){ push('info', 'lost', [c.id], '« ' + nm(c) + ' » était lié à une ligne qui n\'existe plus.'); return; }
      if(!r) return;
      linked[(isOut ? 'o' : 'i') + r.id] = 1;
      var h = _rfParseMHz(r.hf);
      if(c.f && String(r.hf || '').trim() && h !== c.f)
        push('warn', 'ilf', [c.id], (isOut ? 'Sortie ' : 'Entrée ') + r.ch + ' « ' + (r.name || '') + ' » affiche ' + String(r.hf).trim() + ', le canal RF est sur ' + _rfFmt(c.f) + ' MHz.');
    });
    var orphan = (il.chs || []).filter(function(r){ return !linked['i' + r.id] && _rfIsHfRow(r); });
    if(orphan.length && ch.length) push('info', 'ilhf', [], orphan.length + (orphan.length > 1 ? ' micros HF de l\'input list sans canal RF : ' : ' micro HF de l\'input list sans canal RF : ') +
      orphan.slice(0, 6).map(function(r){ return r.ch + ' ' + (r.name || ''); }).join(', ') + (orphan.length > 6 ? '…' : '') + '.');
  }
  var w = { err:0, warn:1, info:2 };
  return out.sort(function(a, b){ return w[a.lvl] - w[b.lvl]; });
}
/* Rapprochement par nom entre canaux RF et lignes de l'input list (propositions seulement) */
function _rfMatchIl(ch, il){
  var res = [], usedI = {}, usedO = {};
  ch.forEach(function(c){ if(c.il) usedI[c.il] = 1; if(c.out) usedO[c.out] = 1; });
  ch.forEach(function(c){
    if(c.il || c.out) return;
    var keys = [_rfNorm(c.who), _rfDefaultName(c.n) ? '' : _rfNorm(c.n)].filter(Boolean);
    if(!keys.length) return;
    var isOut = c.kind === 'iem', list = isOut ? (il.outs || []) : (il.chs || []), used = isOut ? usedO : usedI;
    var hit = list.filter(function(r){ return !used[r.id] && keys.some(function(k){ return k === _rfNorm(r.name) || k === _rfNorm(r.long); }); });
    if(hit.length !== 1) return;                                 /* rien, ou ambigu : on ne propose pas */
    used[hit[0].id] = 1;
    res.push({ id:c.id, to:hit[0].id, out:isOut, c:c, r:hit[0] });
  });
  return res;
}

/* ══════════════════════════════════════════════════════════════════════
   Interface — s'appuie sur pf-app.js (CUR_SHOW, sb, CHS, OUT_CHS, toast,
   charte PDF…). Les données vivent dans CUR_SHOW.stage_data.rf : même
   enregistrement et mêmes droits que le reste du show.
   ══════════════════════════════════════════════════════════════════════ */
var RF = { showId:null, data:null, q:'', fk:'', fz:'', fs:'', sort:'zone', look:false, lq:'', t:null, undo:null, pend:null, allAl:false };

function _rfLoad(){
  var id = CUR_SHOW && CUR_SHOW.id;
  if(RF.showId === id && RF.data) return;
  RF.showId = id; RF.data = _rfClean(CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.rf);
  RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; RF.look = false; RF.lq = ''; RF.undo = null; RF.pend = null; RF.allAl = false;
}
function _rfSave(){
  if(!CUR_SHOW || !RF.data) return;
  CUR_SHOW.stage_data = Object.assign({}, CUR_SHOW.stage_data || { v:2 }, { rf: JSON.parse(JSON.stringify(RF.data)) });
  /* L'écriture vise le show édité, même si l'on en ouvre un autre avant la fin du délai */
  var show = CUR_SHOW;
  clearTimeout(RF.t);
  RF.t = setTimeout(async function(){
    try {
      if(typeof setSaving === 'function') setSaving(true);
      var r = await sb.from('shows').update({ stage_data: show.stage_data }).eq('id', show.id);
      if(r && r.error) toast('RF non enregistré : ' + r.error.message);
    } catch(e){ toast('RF non enregistré : ' + (e && e.message || e)); }
    if(typeof setSaving === 'function') setSaving(false);
  }, 600);
}
/* Lignes de l'input list et des sorties, réduites à ce dont le module a besoin */
function _rfIl(){
  var chs = (typeof CHS !== 'undefined' && Array.isArray(CHS)) ? CHS : [], outs = (typeof OUT_CHS !== 'undefined' && Array.isArray(OUT_CHS)) ? OUT_CHS : [];
  return { chs: chs.map(function(r){ return { id:String(r.id), ch:r.ch, name:r.short_name || r.long_name || '', long:r.long_name || '', mic:r.mic || '', hf:(r.custom_data && r.custom_data._hf) || '' }; }),
           outs: outs.map(function(r){ return { id:String(r.id), ch:r.ch, name:r.short_name || r.long_name || '', long:r.long_name || '', hf:r.hf || '' }; }) };
}
function _rfGet(id){ return RF.data ? RF.data.ch.filter(function(c){ return c.id === id; })[0] : null; }
function _rfRowId(el){ var r = el && el.closest ? el.closest('[data-id]') : null; return r ? r.dataset.id : ''; }
function _rfZones(){ var z = RF.data.zones.slice(); RF.data.ch.forEach(function(c){ if(c.zone && z.indexOf(c.zone) < 0) z.push(c.zone); }); return z; }
function _rfHue(zone, zs){ var i = zs.indexOf(zone); return i < 0 ? '#8a8f9c' : _RF_HUES[i % _RF_HUES.length]; }
/* Nom de l'appareil sans répéter le modèle : « P10T 01 · 2 », ou « canal 2 » */
function _rfDevLbl(c){
  if(!c.dev || c.dev === c.mdl) return '';
  return c.mdl && c.dev.indexOf(c.mdl + ' · ') === 0 ? 'canal ' + c.dev.slice(c.mdl.length + 3) : c.dev;
}
function _rfKindVal(c){ return c.kind === 'mic' && c.tx ? 'mic:' + c.tx : c.kind; }
function _rfKindLbl(c){ var v = _rfKindVal(c), l = ''; _RF_KINDS.forEach(function(k){ if(k[0] === v) l = k[1]; }); return l; }
function _rfStLbl(st){ var l = ''; _RF_ST.forEach(function(s){ if(s[0] === st) l = s[1]; }); return l; }
function _rfCmp(a, b){ return String(a || '').localeCompare(String(b || ''), 'fr', { numeric:true, sensitivity:'base' }); }
function _rfMatchQ(c, raw){
  var q = _rfNorm(raw), qf = String(raw || '').replace(',', '.').trim();
  if(!q && !qf) return true;
  if(/^\d/.test(qf) && _rfFmt(c.f).indexOf(qf) >= 0) return true;
  return !!q && _rfNorm([c.n, c.who, c.mdl, c.dev, c.zone, c.tags, c.note, c.band].join(' ')).indexOf(q) >= 0;
}
function _rfVisible(){
  var zs = _rfZones(), ko = { mic:0, iem:1, oth:2 }, so = {};
  _RF_ST.forEach(function(s, i){ so[s[0]] = i; });
  var list = RF.data.ch.filter(function(c){
    return (!RF.fk || c.kind === RF.fk) && (!RF.fz || c.zone === RF.fz) && (!RF.fs || c.st === RF.fs) && _rfMatchQ(c, RF.q);
  });
  var zi = function(c){ var i = zs.indexOf(c.zone); return i < 0 ? 999 : i; };
  list.sort(function(a, b){
    if(RF.sort === 'f') return (a.f || 9e9) - (b.f || 9e9) || _rfCmp(a.n, b.n);
    if(RF.sort === 'n') return _rfCmp(a.n, b.n);
    if(RF.sort === 'who') return _rfCmp(a.who || 'zzz', b.who || 'zzz') || _rfCmp(a.n, b.n);
    if(RF.sort === 'st') return so[a.st] - so[b.st] || _rfCmp(a.n, b.n);
    return zi(a) - zi(b) || ko[a.kind] - ko[b.kind] || _rfCmp(a.dev, b.dev) || _rfCmp(a.n, b.n);
  });
  return list;
}
/* Alertes rangées par canal */
function _rfAlerts(){
  var all = _rfChecks(RF.data, _rfIl()), by = {};
  all.forEach(function(a){ if(a.lvl === 'info') return; a.ids.forEach(function(id){ (by[id] = by[id] || []).push(a); }); });
  return { all:all, by:by };
}

/* ── Fenêtre de dialogue ── */
function _rfModal(title, icon, body, foot, w){
  rfModalClose();
  var m = document.createElement('div');
  m.className = 'modal-ov show'; m.id = 'rf-modal';
  m.onclick = function(e){ if(e.target === m) rfModalClose(); };
  m.innerHTML = '<div class="modal-box" style="width:' + (w || 580) + 'px"><div class="modal-head"><i class="ti ' + icon + '" style="font-size:16px;color:var(--ora)"></i><span class="modal-title">' + _bonE(title) + '</span>' +
    '<button class="btn ghost sm" onclick="rfModalClose()" aria-label="Fermer"><i class="ti ti-x"></i></button></div><div class="modal-body rf-mb">' + body + '</div><div class="modal-foot">' + foot + '</div></div>';
  document.body.appendChild(m);
}
function rfModalClose(){ var m = document.getElementById('rf-modal'); if(m) m.remove(); }

/* ── Page ── */
function renderRf(){
  var root = document.getElementById('rf-root'); if(!root) return;
  var E = _bonE;
  if(!CUR_SHOW){
    root.innerHTML = '<div class="dt-empty"><i class="ti ti-calendar-event"></i><div class="dt-empty-t">Aucun show ouvert</div><div class="dt-empty-s">Choisissez une session pour préparer ses liaisons HF.</div><button class="btn pri" onclick="goTab(\'sessions\',null)">Voir les sessions</button></div>';
    return;
  }
  _rfLoad(); _rfDropInit(root);
  if(RF.look){ _rfRenderLook(root); return; }
  var d = RF.data, n = d.ch.length;
  var src = d.src ? 'Session « ' + E(d.src.show || d.src.file) + ' » reprise de Wireless Workbench' + (d.src.at ? ' le ' + E(new Date(d.src.at).toLocaleDateString('fr-FR')) : '') + '.' : 'Importez un show Wireless Workbench ou saisissez vos canaux.';
  var h = '<header class="bonp-head"><div><div class="bonp-eyebrow">' + E(CUR_SHOW.name || '') + '</div><h1>RF</h1><p>Les liaisons HF du show : fréquences, utilisateurs, état de préparation. ' + src + '</p></div>' +
    '<div class="rf-act">' +
      '<button class="btn pri" onclick="rfImport()"><i class="ti ti-file-import"></i>Importer un show WWB</button>' +
      '<button class="btn" onclick="rfAdd()"><i class="ti ti-plus"></i>Canal</button>' +
      (n ? '<button class="btn" onclick="rfLook(true)"><i class="ti ti-eye"></i>Consultation</button>' +
           '<button class="btn" onclick="rfPdf()"><i class="ti ti-file-type-pdf"></i>Feuille RF</button>' : '') +
    '</div></header>';
  if(!n){
    h += '<button type="button" class="bonp-empty rf-dropzone" onclick="rfImport()"><i class="ti ti-antenna"></i><b>Importer un show Wireless Workbench</b>' +
      '<span>Déposez un fichier .shw ici, ou cliquez pour le choisir. PatchFlow reprend les appareils, les canaux, les fréquences, les zones et les exclusions de la session.</span></button>' +
      '<p class="rf-note" style="text-align:center;margin-top:14px">Pas de session ? <button type="button" class="ov-link" onclick="rfAdd()">Créer un canal à la main</button></p>';
    root.innerHTML = h; return;
  }
  var zs = _rfZones();
  var opt = function(v, l, cur){ return '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(l) + '</option>'; };
  h += '<div class="bonp-tiles" id="rf-tiles"></div><section class="rf-card" id="rf-spec"></section><section id="rf-alerts"></section>';
  h += '<div class="rf-bar">' +
    '<label class="rf-search"><i class="ti ti-search"></i><input id="rf-q" type="search" placeholder="Nom, artiste, fréquence…" value="' + E(RF.q) + '" oninput="rfSearch(this.value)" autocomplete="off"/></label>' +
    '<div class="rf-seg">' + [['', 'Tous'], ['mic', 'Micros'], ['iem', 'IEM']].map(function(k){ return '<button type="button" class="' + (RF.fk === k[0] ? 'on' : '') + '" onclick="rfFilter(\'fk\',\'' + k[0] + '\')">' + k[1] + '</button>'; }).join('') + '</div>' +
    (zs.length > 1 ? '<select class="rf-sel" onchange="rfFilter(\'fz\',this.value)" aria-label="Zone">' + opt('', 'Toutes les zones', RF.fz) + zs.map(function(z){ return opt(z, z, RF.fz); }).join('') + '</select>' : '') +
    '<select class="rf-sel" onchange="rfFilter(\'fs\',this.value)" aria-label="État">' + opt('', 'Tous les états', RF.fs) + _RF_ST.map(function(s){ return opt(s[0], s[1], RF.fs); }).join('') + '</select>' +
    '<select class="rf-sel" onchange="rfSort(this.value)" aria-label="Tri">' + [['zone', 'Tri : zone'], ['f', 'Tri : fréquence'], ['n', 'Tri : nom'], ['who', 'Tri : utilisateur'], ['st', 'Tri : état']].map(function(s){ return opt(s[0], s[1], RF.sort); }).join('') + '</select>' +
    '<span class="rf-grow"></span>' +
    (RF.undo ? '<button class="btn sm" onclick="rfSyncUndo()"><i class="ti ti-arrow-back-up"></i>Annuler le report</button>' : '') +
    '<button class="btn sm" onclick="rfAutoLink()" title="Proposer les liaisons entre canaux RF et lignes de l\'input list portant le même nom"><i class="ti ti-link"></i>Associer</button>' +
    '<button class="btn sm" onclick="rfSync()" title="Écrire les fréquences dans la colonne Fréq. HF de l\'input list, après confirmation"><i class="ti ti-arrow-bar-to-right"></i>Reporter les fréquences</button>' +
    '<button class="btn sm" onclick="rfCsv()" title="Exporter la liste en CSV"><i class="ti ti-file-spreadsheet"></i>CSV</button>' +
    (d.vers.length ? '<button class="btn sm" onclick="rfVersions()" title="Versions précédentes"><i class="ti ti-history"></i>Versions</button>' : '') +
  '</div><div id="rf-list"></div>';
  if(d.spare.length){
    h += '<section class="rf-card rf-spare"><h3>Fréquences de réserve <small>coordonnées dans la session, sans appareil</small></h3><div class="rf-spare-l">' +
      d.spare.slice().sort(function(a, b){ return a.f - b.f; }).map(function(s){ return '<span><b>' + _rfFmt(s.f) + '</b>' + E([s.ser, s.band].filter(Boolean).join(' ')) + '</span>'; }).join('') + '</div></section>';
  }
  root.innerHTML = h;
  _rfPaintSide(); _rfPaintTable();
}
function _rfPaintSide(){
  var d = RF.data, E = _bonE, al = _rfAlerts(), zs = _rfZones();
  var mics = d.ch.filter(function(c){ return c.kind === 'mic'; }).length, iem = d.ch.filter(function(c){ return c.kind === 'iem'; }).length;
  var ok = d.ch.filter(function(c){ return c.st === 'ok'; }).length, pb = d.ch.filter(function(c){ return c.st === 'pb'; }).length;
  var errs = al.all.filter(function(a){ return a.lvl === 'err'; }).length, warns = al.all.filter(function(a){ return a.lvl === 'warn'; }).length;
  var tile = function(cls, icon, l, b, s){ return '<div class="bonp-tile rf-tile ' + cls + '"><i class="ti ' + icon + '"></i><span class="bonp-tile-l">' + l + '</span><b>' + b + '</b><span class="bonp-tile-s">' + s + '</span></div>'; };
  var t = document.getElementById('rf-tiles');
  if(t) t.innerHTML =
    tile('', 'ti-antenna', 'Canaux', d.ch.length, mics + ' micro' + (mics > 1 ? 's' : '') + ' · ' + iem + ' IEM' + (d.ch.length - mics - iem ? ' · ' + (d.ch.length - mics - iem) + ' autre' : '')) +
    tile('', 'ti-map-pin', 'Zones', zs.length || '—', E(zs.slice(0, 3).join(' · ') + (zs.length > 3 ? '…' : '')) || 'aucune zone') +
    tile(ok === d.ch.length ? 'ok' : (pb ? 'bad' : ''), 'ti-circle-check', 'Prêts', ok + '<small> / ' + d.ch.length + '</small>', pb ? pb + ' en problème' : (ok === d.ch.length ? 'tout est prêt' : (d.ch.length - ok) + ' à finir')) +
    tile(errs ? 'bad' : (warns ? '' : 'ok'), 'ti-alert-triangle', 'Alertes', errs + warns, errs + warns ? errs + ' bloquante' + (errs > 1 ? 's' : '') + ' · ' + warns + ' à vérifier' : 'aucune');

  var sp = document.getElementById('rf-spec');
  if(sp){
    var svg = _rfSpecSvg(d, al, zs, Math.max(300, sp.clientWidth - 32));
    var cnt = {}; d.ch.forEach(function(c){ cnt[c.zone] = (cnt[c.zone] || 0) + 1; });
    sp.style.display = svg ? '' : 'none';
    sp.innerHTML = svg ? '<h3>Spectre <small>fréquences du show, de la plus basse à la plus haute</small></h3>' + svg +
      '<div class="rf-leg">' + zs.map(function(z){ return '<button type="button" class="' + (RF.fz === z ? 'on' : '') + '" data-z="' + E(z) + '" onclick="rfFilter(\'fz\',RF.fz===this.dataset.z?\'\':this.dataset.z)"><i style="background:' + _rfHue(z, zs) + '"></i>' + E(z) + ' <em>' + (cnt[z] || 0) + '</em></button>'; }).join('') +
      '<span class="rf-leg-k"><i class="k-mic"></i>micro <i class="k-iem"></i>IEM' + (d.spare.length ? ' <i class="k-sp"></i>réserve' : '') + (d.excl.length ? ' <i class="k-ex"></i>plage exclue' : '') + '</span></div>' : '';
  }
  var box = document.getElementById('rf-alerts');
  if(box){
    var list = RF.allAl ? al.all : al.all.slice(0, 6), ico = { err:'ti-alert-triangle', warn:'ti-alert-circle', info:'ti-info-circle' };
    box.className = 'rf-card rf-alc' + (al.all.length ? '' : ' none');
    box.innerHTML = (al.all.length
      ? '<h3>Contrôles <small>' + al.all.length + ' point' + (al.all.length > 1 ? 's' : '') + '</small></h3><div class="rf-all">' +
        list.map(function(a){ return '<button type="button" class="rf-alr ' + a.lvl + '"' + (a.ids.length ? ' data-go="' + a.ids[0] + '" onclick="rfFocus(this.dataset.go)"' : ' disabled') + '><i class="ti ' + ico[a.lvl] + '"></i><span>' + E(a.msg) + '</span></button>'; }).join('') + '</div>' +
        (al.all.length > 6 ? '<button type="button" class="ov-link" onclick="RF.allAl=!RF.allAl;_rfPaintSide()">' + (RF.allAl ? 'Réduire' : 'Tout afficher (' + al.all.length + ')') + '</button>' : '')
      : '<p class="rf-okline"><i class="ti ti-circle-check"></i>Aucune alerte sur les contrôles simples.</p>') +
      '<p class="rf-note">Contrôles simples sur les fréquences saisies : doublons, espacement du profil de la session, plage d\'accord, exclusions. Les intermodulations ne sont pas calculées : la coordination se fait dans Wireless Workbench.</p>';
  }
  /* Pastilles d'alerte des lignes déjà affichées */
  document.querySelectorAll('#rf-list .rf-al').forEach(function(s){
    var a = al.by[_rfRowId(s)] || [], err = a.some(function(x){ return x.lvl === 'err'; });
    s.className = 'rf-al' + (a.length ? (err ? ' err' : ' warn') : '');
    s.title = a.map(function(x){ return x.msg; }).join('\n');
    s.innerHTML = a.length ? '<i class="ti ti-alert-triangle"></i>' : '';
    var tr = s.closest('tr'); if(tr){ tr.classList.toggle('al-err', err); tr.classList.toggle('al-warn', a.length > 0 && !err); }
  });
}
/* Bandeau spectre : un trait par canal, les plages exclues en fond, les bandes connues en pied */
function _rfSpecSvg(d, al, zs, W){
  var on = d.ch.filter(function(c){ return c.f > 0; });
  if(!on.length) return '';
  var E = _bonE, fs = on.map(function(c){ return c.f; }).concat(d.spare.map(function(s){ return s.f; }));
  var min = Math.min.apply(null, fs), max = Math.max.apply(null, fs), pad = Math.max(2000, (max - min) * 0.04);
  var lo = Math.floor((min - pad) / 1000) * 1000, hi = Math.ceil((max + pad) / 1000) * 1000, H = 0, AX = 80;
  var x = function(f){ return Math.round((f - lo) / (hi - lo) * W * 10) / 10; };
  var step = 1000; [1, 2, 4, 8, 10, 20, 40, 50, 100, 200, 500].some(function(s){ step = s * 1000; return (hi - lo) / step <= Math.max(4, W / 70); });
  var g = '';
  d.excl.forEach(function(e){ if(e.b < lo || e.a > hi) return; var a = x(Math.max(lo, e.a)), b = x(Math.min(hi, e.b)); g += '<rect class="rf-sx" x="' + a + '" y="10" width="' + Math.max(1, b - a) + '" height="' + (AX - 10) + '"><title>Plage exclue' + (e.l ? ' : ' + E(e.l) : '') + '</title></rect>'; });
  for(var f = Math.ceil(lo / step) * step; f <= hi; f += step){
    g += '<line class="rf-sg" x1="' + x(f) + '" y1="10" x2="' + x(f) + '" y2="' + AX + '"/><text class="rf-st" x="' + x(f) + '" y="' + (AX + 13) + '" text-anchor="middle">' + (f / 1000) + '</text>';
  }
  g += '<line class="rf-sa" x1="0" y1="' + AX + '" x2="' + W + '" y2="' + AX + '"/>';
  /* Bandes dont la plage est connue */
  var seen = {}, row = 0;
  on.forEach(function(c){
    var r = _rfRange(c), k = _rfNormSer(c.ser) + '|' + c.band;
    if(!r || seen[k] || row >= 3) return; seen[k] = 1;
    var a = x(Math.max(lo, r[0])), b = x(Math.min(hi, r[1])), y = AX + 32 + row * 14; row++;
    g += '<rect class="rf-sb" x="' + a + '" y="' + y + '" width="' + Math.max(2, b - a) + '" height="3" rx="1.5"/><text class="rf-sbt" ' + (a > W * 0.6 ? 'text-anchor="end" x="' + (b - 1) : 'x="' + (a + 1)) + '" y="' + (y - 3) + '">' + E(c.ser + ' ' + c.band) + '</text>';
  });
  d.spare.forEach(function(s){ var px = x(s.f); g += '<path class="rf-sp" d="M' + px + ' ' + (AX - 9) + 'l3.5 4.5l-3.5 4.5l-3.5 -4.5z"><title>Réserve ' + _rfFmt(s.f) + ' MHz</title></path>'; });
  on.forEach(function(c){
    var px = x(c.f), a = al.by[c.id] || [], err = a.some(function(q){ return q.lvl === 'err'; }), col = err ? 'var(--err)' : _rfHue(c.zone, zs), top = c.kind === 'iem' ? 40 : 22;
    g += '<g class="rf-mk' + (err ? ' err' : '') + '" data-go="' + c.id + '" onclick="rfFocus(this.dataset.go)"><title>' + E((c.n || c.dev || 'Canal') + (c.who ? ' · ' + c.who : '') + ' · ' + _rfFmt(c.f) + ' MHz') + '</title>' +
      '<line x1="' + px + '" y1="' + top + '" x2="' + px + '" y2="' + AX + '" stroke="' + col + '"/>' +
      (c.kind === 'iem' ? '<rect x="' + (px - 3) + '" y="' + (top - 3) + '" width="6" height="6" rx="1" fill="' + col + '"/>' : '<circle cx="' + px + '" cy="' + top + '" r="3.4" fill="' + col + '"/>') + '</g>';
  });
  H = AX + 20 + row * 14 + (row ? 6 : 0);
  return '<svg class="rf-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fréquences du show sur le spectre, en MHz">' + g + '</svg>';
}
function _rfPaintTable(){
  var box = document.getElementById('rf-list'); if(!box) return;
  var E = _bonE, d = RF.data, list = _rfVisible(), il = _rfIl(), zs = _rfZones();
  if(!list.length){ box.innerHTML = '<p class="rf-void"><i class="ti ti-filter-off"></i>Aucun canal ne correspond. <button type="button" class="ov-link" onclick="rfReset()">Effacer les filtres</button></p>'; return; }
  var who = {}; d.ch.forEach(function(c){ if(c.who) who[c.who] = 1; c.tags.split(/[;,]/).forEach(function(t){ t = t.trim(); if(t) who[t] = 1; }); });
  il.chs.forEach(function(r){ if(r.name) who[r.name] = 1; });
  var dl = '<datalist id="rf-dl-who">' + Object.keys(who).slice(0, 200).map(function(w){ return '<option value="' + E(w) + '"></option>'; }).join('') + '</datalist>' +
           '<datalist id="rf-dl-zone">' + zs.map(function(z){ return '<option value="' + E(z) + '"></option>'; }).join('') + '</datalist>';
  var lopt = function(rows, cur, pre){ return '<option value="">—</option>' + rows.map(function(r){ return '<option value="' + E(r.id) + '"' + (r.id === cur ? ' selected' : '') + '>' + E(pre + r.ch + ' · ' + (r.name || '')) + '</option>'; }).join(''); };
  var h = dl + '<div class="bonp-scroll"><table class="rf-tbl"><thead><tr><th>État</th><th>Nom</th><th>Utilisateur</th><th>Type</th><th>Fréquence</th><th>Bande</th><th>Zone</th><th>Input list</th><th>Note</th><th></th></tr></thead><tbody>';
  var last = null;
  list.forEach(function(c){
    if(RF.sort === 'zone' && c.zone !== last){
      last = c.zone;
      var nz = list.filter(function(x){ return x.zone === c.zone; }).length;
      h += '<tr class="rf-g"><td colspan="10"><i style="background:' + _rfHue(c.zone, zs) + '"></i>' + E(c.zone || 'Sans zone') + '<em>' + _rfPl(nz) + '</em></td></tr>';
    }
    var r = _rfRange(c), sub = [c.mk && c.mk !== 'Generic' && c.mdl.indexOf(c.mk) < 0 ? c.mk : '', c.mdl, _rfDevLbl(c), c.gc, c.pw ? c.pw + ' mW' : ''].filter(Boolean).join(' · ');
    h += '<tr class="rf-r" data-id="' + c.id + '">' +
      '<td data-label="État"><select class="rf-stsel st-' + c.st + '" onchange="rfSet(this,\'st\')">' + _RF_ST.map(function(s){ return '<option value="' + s[0] + '"' + (s[0] === c.st ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></td>' +
      '<td data-label="Nom" class="rf-c-n"><input class="rf-in b" value="' + E(c.n) + '" placeholder="Nom du canal" onchange="rfSet(this,\'n\')" maxlength="60"/>' + (sub ? '<small>' + E(sub) + '</small>' : '') + '</td>' +
      '<td data-label="Utilisateur"><input class="rf-in" list="rf-dl-who" value="' + E(c.who) + '" placeholder="Artiste, musicien…" onchange="rfSet(this,\'who\')" maxlength="60"/></td>' +
      '<td data-label="Type"><select class="rf-in" onchange="rfSet(this,\'kind\')">' + _RF_KINDS.map(function(k){ return '<option value="' + k[0] + '"' + (k[0] === _rfKindVal(c) ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></td>' +
      '<td data-label="Fréquence" class="rf-c-f"><input class="rf-in f" value="' + _rfFmt(c.f) + '" placeholder="MHz" inputmode="decimal" onchange="rfSet(this,\'f\')" maxlength="12"/><button type="button" class="rf-al" onclick="rfWhy(this)" aria-label="Alertes de ce canal"></button></td>' +
      '<td data-label="Bande" class="rf-c-b">' + (c.band ? '<b>' + E(c.band) + '</b>' : '') + '<small>' + (r ? _rfFmt(r[0]) + ' à ' + _rfFmt(r[1]) : (c.band || c.ser ? 'plage inconnue' : '')) + '</small></td>' +
      '<td data-label="Zone"><input class="rf-in" list="rf-dl-zone" value="' + E(c.zone) + '" placeholder="Zone" onchange="rfSet(this,\'zone\')" maxlength="40"/></td>' +
      '<td data-label="Input list"><select class="rf-in rf-lk" onchange="rfLink(this)">' + (c.kind === 'iem' ? lopt(il.outs, c.out, 'OUT ') : lopt(il.chs, c.il, '')) + '</select></td>' +
      '<td data-label="Note"><input class="rf-in" value="' + E(c.note) + '" placeholder="Note de terrain" onchange="rfSet(this,\'note\')" maxlength="200"/></td>' +
      '<td class="rf-c-x"><button type="button" class="rf-ib" onclick="rfDup(this)" title="Dupliquer"><i class="ti ti-copy"></i></button><button type="button" class="rf-ib" onclick="rfDel(this)" title="Supprimer"><i class="ti ti-trash"></i></button></td></tr>';
  });
  box.innerHTML = h + '</tbody></table></div>';
  _rfPaintSide();
}

/* ── Actions ── */
function rfSearch(v){ RF.q = String(v || ''); _rfPaintTable(); }
function rfFilter(k, v){ if(k === 'fk' || k === 'fz' || k === 'fs'){ RF[k] = String(v || ''); renderRf(); } }
function rfSort(v){ RF.sort = v; _rfPaintTable(); }
function rfReset(){ RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; renderRf(); }
function rfSet(el, field){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  var v = el.value;
  if(field === 'f'){
    var k = _rfParseMHz(v);
    if(String(v).trim() && !k){ toast('Fréquence illisible : saisissez-la en MHz, par exemple 606.125'); el.value = _rfFmt(c.f); return; }
    c.f = k; el.value = _rfFmt(k);
  } else if(field === 'kind'){
    var p = String(v).split(':'), was = c.kind;
    c.kind = p[0] === 'iem' || p[0] === 'oth' ? p[0] : 'mic'; c.tx = c.kind === 'mic' && (p[1] === 'hh' || p[1] === 'bp') ? p[1] : '';
    if((was === 'iem') !== (c.kind === 'iem')){ c.il = ''; c.out = ''; _rfSave(); _rfPaintTable(); return; }   /* la liaison change de liste */
  } else if(field === 'st'){
    _RF_ST.forEach(function(s){ if(s[0] === v) c.st = v; });
    el.className = 'rf-stsel st-' + c.st;
  } else if(field === 'n' || field === 'who' || field === 'zone' || field === 'note'){
    c[field] = _rfStr(v, field === 'note' ? 200 : field === 'zone' ? 40 : 60); el.value = c[field];
  } else return;
  _rfSave(); _rfPaintSide();
}
function rfAdd(){
  if(!CUR_SHOW) return;
  _rfLoad();
  if(RF.data.ch.length >= _RF_MAX_CH){ toast('Limite de ' + _RF_MAX_CH + ' canaux atteinte.'); return; }
  var c = _rfCleanCh({ id:_rfId(), n:'', zone:RF.fz, kind:RF.fk || 'mic' });
  RF.data.ch.push(c); RF.q = ''; RF.fs = '';
  _rfSave(); renderRf();
  var i = document.querySelector('#rf-list tr[data-id="' + c.id + '"] .rf-c-n input'); if(i){ i.focus(); i.scrollIntoView({ block:'center' }); }
}
function rfDup(el){
  var c = _rfGet(_rfRowId(el)); if(!c || RF.data.ch.length >= _RF_MAX_CH) return;
  var n = _rfCleanCh(Object.assign({}, c, { id:_rfId(), src:'', il:'', out:'', st:'todo', n:c.n ? c.n + ' (copie)' : '' }));
  RF.data.ch.splice(RF.data.ch.indexOf(c) + 1, 0, n);
  _rfSave(); _rfPaintTable();
}
function rfDel(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  if(!confirm('Supprimer le canal « ' + (c.n || c.dev || 'sans nom') + ' » ?')) return;
  RF.data.ch = RF.data.ch.filter(function(x){ return x !== c; });
  _rfSave(); renderRf();
}
function rfWhy(el){
  var a = _rfAlerts().by[_rfRowId(el)] || [];
  if(a.length) toast(a.map(function(x){ return x.msg; }).join(' '));
}
/* Amène un canal à l'écran, en levant les filtres qui le cachent */
function rfFocus(id){
  var c = _rfGet(id); if(!c) return;
  if(RF.look){ RF.look = false; renderRf(); }
  var row = document.querySelector('#rf-list tr[data-id="' + id + '"]');
  if(!row){ RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; renderRf(); row = document.querySelector('#rf-list tr[data-id="' + id + '"]'); }
  if(!row) return;
  row.scrollIntoView({ block:'center', behavior:'smooth' });
  row.classList.add('flash'); setTimeout(function(){ row.classList.remove('flash'); }, 1600);
}

/* ── Liaison avec l'input list ── */
function _rfLinkGate(){
  if(typeof canDo === 'function' && !canDo('rf_link')){ if(typeof showUpgradeModal === 'function') showUpgradeModal('rf_link'); return false; }
  return true;
}
function rfLink(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  if(!_rfLinkGate()){ el.value = c.kind === 'iem' ? c.out : c.il; return; }
  var v = String(el.value || ''), k = c.kind === 'iem' ? 'out' : 'il', moved = false;
  if(v) RF.data.ch.forEach(function(x){ if(x !== c && x[k] === v){ x[k] = ''; moved = true; } });   /* une ligne = un seul canal RF */
  c[k] = v; if(k === 'il') c.out = ''; else c.il = '';
  _rfSave();
  if(moved){ toast('Cette ligne était liée à un autre canal RF : la liaison a été déplacée.'); _rfPaintTable(); } else _rfPaintSide();
}
function rfAutoLink(){
  if(!_rfLinkGate()) return;
  var props = _rfMatchIl(RF.data.ch, _rfIl()), E = _bonE;
  if(!props.length){ toast('Aucune correspondance sûre par nom. Liez les canaux à la main, colonne Input list.'); return; }
  RF.pend = { link:props };
  _rfModal('Associer à l\'input list', 'ti-link',
    '<p class="rf-note">Canaux RF et lignes portant le même nom. Décochez ce qui ne convient pas ; rien d\'autre n\'est modifié.</p><div class="rf-chk">' +
    props.map(function(p, i){ return '<label><input type="checkbox" class="cb" data-i="' + i + '" checked/><span><b>' + E(p.c.who || p.c.n) + '</b> ' + _rfFmt(p.c.f) + '</span><i class="ti ti-arrow-right"></i><span>' + (p.out ? 'Sortie ' : 'Entrée ') + E(p.r.ch + ' · ' + p.r.name) + '</span></label>'; }).join('') + '</div>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Annuler</button><button class="btn pri sm" onclick="rfAutoLinkApply()"><i class="ti ti-link"></i>Associer</button>');
}
function rfAutoLinkApply(){
  var props = (RF.pend && RF.pend.link) || [], n = 0;
  document.querySelectorAll('#rf-modal .rf-chk input:checked').forEach(function(cb){
    var p = props[+cb.dataset.i], c = p && _rfGet(p.id); if(!c) return;
    if(p.out){ c.out = p.to; c.il = ''; } else { c.il = p.to; c.out = ''; }
    n++;
  });
  RF.pend = null; rfModalClose();
  if(n){ _rfSave(); renderRf(); toast(_rfPl(n) + (n > 1 ? ' liés' : ' lié') + ' à l\'input list'); }
}
/* Report des fréquences vers la colonne « Fréq. HF » : liste des changements, confirmation, annulation possible */
function _rfSyncList(){
  var il = _rfIl(), rows = {}, outs = {}, list = [];
  il.chs.forEach(function(r){ rows[r.id] = r; }); il.outs.forEach(function(r){ outs[r.id] = r; });
  RF.data.ch.forEach(function(c){
    var isOut = !c.il && !!c.out, r = c.il ? rows[c.il] : (c.out ? outs[c.out] : null);
    if(!r || !c.f) return;
    var cur = String(r.hf || '').trim();
    if(_rfParseMHz(cur) === c.f) return;
    list.push({ c:c, r:r, out:isOut, cur:cur, nv:_rfFmt(c.f) });
  });
  return list;
}
function rfSync(){
  if(!_rfLinkGate()) return;
  var E = _bonE;
  if(!RF.data.ch.some(function(c){ return c.il || c.out; })){ toast('Aucun canal lié. Utilisez Associer, ou la colonne Input list.'); return; }
  var list = _rfSyncList();
  if(!list.length){ toast('Rien à reporter : les fréquences de l\'input list sont à jour.'); return; }
  RF.pend = { sync:list };
  var over = list.filter(function(x){ return x.cur; }).length;
  _rfModal('Reporter les fréquences', 'ti-arrow-bar-to-right',
    '<p class="rf-note">Les fréquences ci-dessous seront écrites dans la colonne « Fréq. HF ».' + (over ? ' <b>' + over + ' valeur' + (over > 1 ? 's existantes seront remplacées' : ' existante sera remplacée') + '.</b>' : '') + ' Vous pourrez annuler juste après.</p><div class="rf-chk">' +
    list.map(function(x, i){ return '<label><input type="checkbox" class="cb" data-i="' + i + '" checked/><span>' + (x.out ? 'Sortie ' : 'Entrée ') + '<b>' + E(x.r.ch + ' · ' + x.r.name) + '</b></span><span class="rf-chg">' + (x.cur ? '<s>' + E(x.cur) + '</s>' : '') + '<b>' + x.nv + '</b></span></label>'; }).join('') + '</div>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Annuler</button><button class="btn pri sm" onclick="rfSyncApply()"><i class="ti ti-check"></i>Reporter</button>');
}
function _rfWriteHf(out, id, val){
  if(out){ if(typeof updateOutField === 'function') updateOutField(id, 'hf', val); }
  else if(typeof saveCustomCell === 'function') saveCustomCell(id, '_hf', val);
}
function _rfIlRefresh(){
  try { if(typeof renderTable === 'function') renderTable(); } catch(e){}
  try { if(typeof renderOutTable === 'function') renderOutTable(); } catch(e){}
}
function rfSyncApply(){
  var list = (RF.pend && RF.pend.sync) || [], undo = [];
  document.querySelectorAll('#rf-modal .rf-chk input:checked').forEach(function(cb){
    var x = list[+cb.dataset.i]; if(!x) return;
    undo.push({ out:x.out, id:x.r.id, old:x.cur });
    _rfWriteHf(x.out, x.r.id, x.nv);
  });
  RF.pend = null; rfModalClose();
  if(!undo.length) return;
  RF.undo = undo; _rfIlRefresh(); renderRf();
  var hidden = (typeof visCol !== 'undefined' && visCol && visCol.hf === false);
  toast(undo.length + ' fréquence' + (undo.length > 1 ? 's reportées' : ' reportée') + ' dans l\'input list' + (hidden ? '. La colonne Fréq. HF y est masquée : affichez-la pour les voir.' : ''));
}
function rfSyncUndo(){
  if(!RF.undo) return;
  RF.undo.forEach(function(u){ _rfWriteHf(u.out, u.id, u.old); });
  var n = RF.undo.length; RF.undo = null;
  _rfIlRefresh(); renderRf();
  toast('Report annulé : ' + n + ' valeur' + (n > 1 ? 's rétablies' : ' rétablie'));
}

/* ── Import d'un show WWB ── */
function _rfDropInit(root){
  if(root._rfDrop) return; root._rfDrop = 1;
  var has = function(e){ return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
  root.addEventListener('dragover', function(e){ if(has(e) && CUR_SHOW){ e.preventDefault(); root.classList.add('rf-drag'); } });
  root.addEventListener('dragleave', function(e){ if(!root.contains(e.relatedTarget)) root.classList.remove('rf-drag'); });
  root.addEventListener('drop', function(e){
    root.classList.remove('rf-drag');
    if(!has(e) || !CUR_SHOW) return;
    e.preventDefault(); e.stopPropagation();
    if(e.dataTransfer.files && e.dataTransfer.files[0]) rfFile(e.dataTransfer.files[0]);
  });
}
function rfImport(){
  if(!CUR_SHOW) return;
  var i = document.createElement('input');
  i.type = 'file'; i.accept = '.shw,.xml,text/xml';
  i.onchange = function(){ if(i.files && i.files[0]) rfFile(i.files[0]); };
  i.click();
}
function _rfImportErr(msg){
  _rfModal('Import impossible', 'ti-alert-triangle',
    '<p class="rf-err"><i class="ti ti-alert-triangle"></i>' + _bonE(msg) + '</p><p class="rf-note">PatchFlow lit les shows Wireless Workbench au format .shw (WWB 7). Dans Wireless Workbench : Fichier, puis Enregistrer le show sous. Les rapports PDF ou CSV, les inventaires .inv et les scans ne sont pas des shows.</p>',
    '<button class="btn pri sm" onclick="rfModalClose()">Compris</button>', 520);
}
function rfFile(file){
  if(!CUR_SHOW || !file) return;
  _rfLoad();
  var name = String(file.name || '');
  if(!/\.(shw|xml)$/i.test(name)){ _rfImportErr('« ' + name + ' » n\'est pas un show Wireless Workbench.'); return; }
  if(file.size > 25e6){ _rfImportErr('Fichier trop volumineux (25 Mo au maximum).'); return; }
  var r = new FileReader();
  r.onerror = function(){ _rfImportErr('Lecture du fichier impossible.'); };
  r.onload = function(){
    var p;
    try { p = _rfParseShw(String(r.result || '')); } catch(e){ p = { ok:false, err:'Fichier .shw illisible.' }; }
    if(!p.ok){ _rfImportErr(p.err); return; }
    RF.pend = { p:p, file:name, mode:p.suggest, drop:false };
    _rfImportModal();
  };
  r.readAsText(file);
}
function _rfImportModal(){
  var P = RF.pend; if(!P || !P.p) return;
  var E = _bonE, p = P.p, has = RF.data.ch.length > 0, by = {}, devs = {};
  p.ch.forEach(function(c){ var k = (c.mk && c.mk !== 'Generic' && c.mdl.indexOf(c.mk) < 0 ? c.mk + ' ' : '') + (c.mdl || c.ser || 'Appareil') + (c.band ? ' · ' + c.band : ''); by[k] = (by[k] || 0) + 1; devs[c.did || c.src] = 1; });
  var m = _rfMerge(RF.data.ch, p, { mode:P.mode, drop:P.drop });
  var b = '<div class="rf-imp-h"><b>' + E(p.show.name || P.file) + '</b><span>' + p.ch.length + ' canaux · ' + Object.keys(devs).length + ' appareils' + (p.zones.length ? ' · ' + p.zones.length + ' zone' + (p.zones.length > 1 ? 's' : '') : '') + (p.show.app ? ' · WWB ' + E(p.show.app) : '') + '</span></div>' +
    '<div class="rf-imp-m">' + Object.keys(by).map(function(k){ return '<span>' + E(k) + ' <b>' + by[k] + '</b></span>'; }).join('') + '</div>';
  if(p.coordDiff){
    b += '<fieldset class="rf-imp-f"><legend>Fréquences à reprendre</legend>' +
      '<label><input type="radio" name="rf-mode" ' + (P.mode === 'coord' ? 'checked' : '') + ' onchange="rfImportOpt(\'mode\',\'coord\')"/><span><b>Celles de la coordination</b> ' + p.coordDiff + ' canaux diffèrent des appareils' + (p.suggest === 'coord' ? ', qui sont encore sur leurs fréquences par défaut.' : '.') + '</span></label>' +
      '<label><input type="radio" name="rf-mode" ' + (P.mode === 'inv' ? 'checked' : '') + ' onchange="rfImportOpt(\'mode\',\'inv\')"/><span><b>Celles réglées sur les appareils</b> telles qu\'enregistrées dans l\'inventaire.</span></label></fieldset>';
  }
  if(has){
    b += '<div class="rf-imp-d"><b>Par rapport aux canaux déjà présents</b><span>' + m.add + ' nouveau' + (m.add > 1 ? 'x' : '') + ' · ' + m.upd + ' modifié' + (m.upd > 1 ? 's' : '') + ' · ' + m.same + ' inchangé' + (m.same > 1 ? 's' : '') + ' · ' + m.gone + ' absent' + (m.gone > 1 ? 's' : '') + ' de ce show</span>' +
      (m.diffs.length ? '<ul>' + m.diffs.slice(0, 10).map(function(x){ return '<li><b>' + E(x.n) + '</b> ' + E(x.what.join(', ')) + '</li>'; }).join('') + (m.diffs.length > 10 ? '<li>et ' + (m.diffs.length - 10) + ' autres…</li>' : '') + '</ul>' : '') +
      (m.gone ? '<label class="rf-imp-c"><input type="checkbox" class="cb" ' + (P.drop ? 'checked' : '') + ' onchange="rfImportOpt(\'drop\',this.checked)"/><span>Retirer les ' + m.gone + ' canaux absents de ce show</span></label>' : '') +
      '<p class="rf-note">Utilisateurs, types d\'émetteur, états, notes et liaisons sont conservés. L\'état actuel reste récupérable dans Versions.</p></div>';
  }
  var extra = [];
  if(p.spare.length) extra.push(p.spare.length + ' fréquence' + (p.spare.length > 1 ? 's' : '') + ' de réserve');
  if(p.excl.length) extra.push(p.excl.length + ' plage' + (p.excl.length > 1 ? 's exclues' : ' exclue'));
  if(p.skipped) extra.push(p.skipped + ' appareil' + (p.skipped > 1 ? 's' : '') + ' sans canal RF ignoré' + (p.skipped > 1 ? 's' : ''));
  if(extra.length) b += '<p class="rf-note">Aussi dans ce show : ' + extra.join(', ') + '.</p>';
  if(p.ch.length >= _RF_MAX_CH) b += '<p class="rf-err"><i class="ti ti-alert-triangle"></i>Show très grand : seuls les ' + _RF_MAX_CH + ' premiers canaux sont repris.</p>';
  _rfModal('Importer un show Wireless Workbench', 'ti-file-import', b,
    '<button class="btn ghost sm" onclick="RF.pend=null;rfModalClose()">Annuler</button><button class="btn pri sm" onclick="rfImportApply()"><i class="ti ti-check"></i>' + (has ? 'Mettre à jour' : 'Importer ' + p.ch.length + ' canaux') + '</button>', 620);
}
function rfImportOpt(k, v){
  if(!RF.pend || !RF.pend.p) return;
  if(k === 'mode') RF.pend.mode = v === 'coord' ? 'coord' : 'inv';
  if(k === 'drop') RF.pend.drop = !!v;
  _rfImportModal();
}
function _rfSnapshot(label){
  var d = RF.data; if(!d.ch.length) return;
  d.vers.push({ at:new Date().toISOString(), label:_rfStr(label, 120), ch:JSON.parse(JSON.stringify(d.ch)) });
  d.vers = d.vers.slice(-3);
}
function rfImportApply(){
  var P = RF.pend; if(!P || !P.p || !CUR_SHOW) return;
  var d = RF.data, p = P.p, m = _rfMerge(d.ch, p, { mode:P.mode, drop:P.drop });
  _rfSnapshot('Avant l\'import de ' + P.file);
  d.ch = m.ch.slice(0, _RF_MAX_CH);
  p.zones.forEach(function(z){ if(d.zones.indexOf(z) < 0) d.zones.push(z); });
  d.iso = p.iso; d.excl = p.excl; d.spare = p.spare;
  d.src = { file:_rfStr(P.file, 120), show:p.show.name, app:p.show.app, at:new Date().toISOString(), mode:P.mode };
  RF.data = _rfClean(d); RF.pend = null; RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = '';
  rfModalClose(); _rfSave(); renderRf();
  toast(m.add + m.upd + m.same + ' canaux repris de Wireless Workbench');
}
function rfVersions(){
  var E = _bonE, v = RF.data.vers;
  _rfModal('Versions précédentes', 'ti-history',
    '<p class="rf-note">Les trois derniers états avant import ou restauration. Restaurer remplace les canaux actuels, qui deviennent eux-mêmes une version.</p><div class="rf-vers">' +
    v.map(function(x, i){ return '<div><span><b>' + E(new Date(x.at).toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' })) + '</b>' + E(x.label) + ' · ' + x.ch.length + ' canaux</span><button class="btn sm" onclick="rfRestore(' + i + ')">Restaurer</button></div>'; }).reverse().join('') + '</div>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Fermer</button>', 560);
}
function rfRestore(i){
  var d = RF.data, v = d.vers[i]; if(!v) return;
  if(!confirm('Restaurer cette version (' + v.ch.length + ' canaux) ? Les canaux actuels restent disponibles dans Versions.')) return;
  var ch = JSON.parse(JSON.stringify(v.ch));
  d.vers.splice(i, 1);
  _rfSnapshot('Avant restauration');
  d.ch = ch; RF.data = _rfClean(d);
  rfModalClose(); _rfSave(); renderRf(); toast('Version restaurée');
}

/* ── Consultation : retrouver vite une fréquence ou un utilisateur pendant le show ── */
function rfLook(on){ RF.look = !!on; RF.lq = ''; renderRf(); if(on){ var i = document.getElementById('rf-lq'); if(i) i.focus(); } }
function _rfRenderLook(root){
  root.innerHTML = '<div class="rf-look"><div class="rf-look-top"><button class="btn" onclick="rfLook(false)"><i class="ti ti-arrow-left"></i>Retour</button>' +
    '<label class="rf-search big"><i class="ti ti-search"></i><input id="rf-lq" type="search" placeholder="Artiste, nom ou fréquence" value="' + _bonE(RF.lq) + '" oninput="RF.lq=this.value;_rfPaintLook()" autocomplete="off"/></label></div><div id="rf-look-list"></div></div>';
  _rfPaintLook();
}
function _rfPaintLook(){
  var box = document.getElementById('rf-look-list'); if(!box) return;
  var E = _bonE, zs = _rfZones(), al = _rfAlerts();
  var list = RF.data.ch.filter(function(c){ return _rfMatchQ(c, RF.lq); }).sort(function(a, b){ return zs.indexOf(a.zone) - zs.indexOf(b.zone) || _rfCmp(a.who || a.n, b.who || b.n); });
  box.innerHTML = list.length ? list.map(function(c){
    var a = al.by[c.id] || [];
    return '<div class="rf-lkc' + (a.some(function(x){ return x.lvl === 'err'; }) ? ' err' : '') + '" data-id="' + c.id + '" style="--z:' + _rfHue(c.zone, zs) + '">' +
      '<div class="rf-lkc-t"><b>' + E(c.who || c.n || c.dev || 'Canal') + '</b><span>' + E([c.who ? c.n : '', _rfKindLbl(c), c.zone, c.mdl].filter(Boolean).join(' · ')) + '</span>' + (c.note ? '<em>' + E(c.note) + '</em>' : '') + '</div>' +
      '<div class="rf-lkc-f">' + (_rfFmt(c.f) || '—') + '</div>' +
      '<button type="button" class="rf-lkc-s st-' + c.st + '" onclick="rfCycle(this)" title="Changer l\'état">' + _rfStLbl(c.st) + '</button></div>';
  }).join('') : '<p class="rf-void"><i class="ti ti-search-off"></i>Aucun canal ne correspond.</p>';
}
function rfCycle(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  var i = 0; _RF_ST.forEach(function(s, k){ if(s[0] === c.st) i = k; });
  c.st = _RF_ST[(i + 1) % _RF_ST.length][0];
  _rfSave(); _rfPaintLook();
}

/* ── Exports ── */
function rfCsv(){
  var d = RF.data; if(!d || !d.ch.length) return;
  var q = function(v){ v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var il = _rfIl(), rows = {}, outs = {};
  il.chs.forEach(function(r){ rows[r.id] = r; }); il.outs.forEach(function(r){ outs[r.id] = r; });
  var lines = [['Zone', 'Nom', 'Utilisateur', 'Type', 'Fréquence (MHz)', 'Bande', 'Fabricant', 'Modèle', 'Appareil', 'Groupe/canal', 'Puissance (mW)', 'État', 'Input list', 'Note'].join(';')];
  _rfVisible().forEach(function(c){
    var r = c.il ? rows[c.il] : (c.out ? outs[c.out] : null);
    lines.push([c.zone, c.n, c.who, _rfKindLbl(c), _rfFmt(c.f), c.band, c.mk, c.mdl, c.dev, c.gc, c.pw || '', _rfStLbl(c.st), r ? (c.out && !c.il ? 'OUT ' : '') + r.ch + ' ' + r.name : '', c.note].map(q).join(';'));
  });
  var blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  var a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = ((typeof _pdfSlug === 'function' && _pdfSlug(CUR_SHOW.name || '')) || 'patchflow') + '-rf.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 15000);
}
/* Feuille RF : par zone, une case à cocher par canal, les points à vérifier en fin de document */
async function rfPdf(){
  if(!CUR_SHOW) return;
  _rfLoad();
  var d = RF.data; if(!d.ch.length){ toast('Aucun canal RF à exporter.'); return; }
  toast('Génération de la feuille RF…');
  try {
    var JsPDF = await _loadAutoTable(), doc = new JsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    var PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), K = _PDFK, M = K.M, brand = _pdfBrand(), acc = _hex2rgb(brand.color || '#ff6b1a');
    var pf = null; try { pf = await _pfLogoPng('#FF6B2B'); } catch(e){}
    var logo = await _pdfLogoInfo(brand.logo), s = CUR_SHOW || {}, BOT = _pdfFootH(false) + 4, TOP = 30, title = s.name || 'Show';
    var who = (typeof PROFILE !== 'undefined' && PROFILE && PROFILE.full_name) || '';
    var y = _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:'Feuille RF', title:title, sub:'', logo:logo, rightLines:['Édité le ' + new Date().toLocaleDateString('fr-FR')],
      meta:[['Lieu', s.venue], ['Date', _pdfDateFr(_showDateISO(s.show_date))], ['Canaux', String(d.ch.length)], ['Session WWB', d.src && (d.src.show || d.src.file)], ['Édité par', who]] }) + 5;
    var zs = _rfZones(), keep = { q:RF.q, fk:RF.fk, fz:RF.fz, fs:RF.fs, sort:RF.sort };
    RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; RF.sort = 'zone';
    var list = _rfVisible(); Object.assign(RF, keep);
    var body = [], meta = [], last = null;
    list.forEach(function(c){
      if(c.zone !== last){
        last = c.zone;
        var nz = list.filter(function(x){ return x.zone === c.zone; }).length;
        body.push([{ content:(c.zone || 'Sans zone') + '   ' + _rfPl(nz), colSpan:8, styles:{ fontStyle:'bold', fontSize:8.2, textColor:K.ink, fillColor:[243,244,246], cellPadding:{ top:1.6, bottom:1.6, left:1.8, right:1.8 } } }]);
        meta.push(null);
      }
      body.push(['', c.n || '—', c.who, _rfKindLbl(c), _rfFmt(c.f) || '—', c.band, [c.mdl, _rfDevLbl(c)].filter(Boolean).join('\n'), c.note]);
      meta.push(c);
    });
    doc.autoTable({ head:[['', 'NOM', 'UTILISATEUR', 'TYPE', 'FRÉQUENCE', 'BANDE', 'APPAREIL', 'NOTE']], body:body, startY:y, theme:'plain', margin:{ left:M, right:M, top:TOP, bottom:BOT },
      styles:{ font:'helvetica', fontSize:8.6, cellPadding:{ top:1.7, bottom:1.7, left:1.8, right:1.8 }, textColor:K.ink, lineColor:K.line, lineWidth:{ bottom:0.2 }, valign:'middle', overflow:'linebreak' },
      headStyles:{ fontSize:6.5, fontStyle:'bold', textColor:K.muted, lineColor:K.ink, lineWidth:{ bottom:0.35 } },
      columnStyles:{ 0:{ cellWidth:7 }, 1:{ fontStyle:'bold', cellWidth:34 }, 2:{ cellWidth:32 }, 3:{ cellWidth:22, textColor:K.txt2 }, 4:{ fontStyle:'bold', fontSize:10, cellWidth:24, textColor:acc }, 5:{ cellWidth:14 }, 6:{ cellWidth:28, fontSize:7.6, textColor:K.txt2 }, 7:{ fontSize:7.8, textColor:K.txt2 } },
      didDrawCell:function(c){
        if(c.section !== 'body' || c.column.index !== 0) return;
        var ch = meta[c.row.index]; if(!ch) return;
        var bx = c.cell.x + 1.6, by = c.cell.y + (c.cell.height - 3.4) / 2;
        doc.setDrawColor(K.ink[0], K.ink[1], K.ink[2]); doc.setLineWidth(0.25); doc.rect(bx, by, 3.4, 3.4);
        if(ch.st === 'ok'){ doc.setLineWidth(0.5); doc.line(bx + 0.7, by + 1.8, bx + 1.5, by + 2.7); doc.line(bx + 1.5, by + 2.7, bx + 2.9, by + 0.8); }
      } });
    y = doc.lastAutoTable.finalY + 7;
    var room = function(need){ if(y > PH - BOT - need){ doc.addPage(); y = TOP; } };
    var hd = function(t){ room(18); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(K.ink[0], K.ink[1], K.ink[2]); doc.text(t, M, y + 3.6); y += 7; };
    var para = function(t, col, size){ doc.setFont('helvetica', 'normal'); doc.setFontSize(size || 8.6); doc.setTextColor(col[0], col[1], col[2]); doc.splitTextToSize(t, PW - 2 * M).forEach(function(l){ if(y > PH - BOT - 5){ doc.addPage(); y = TOP; } doc.text(l, M, y + 3); y += (size || 8.6) * 0.5; }); };
    if(d.spare.length){
      hd('Fréquences de réserve');
      var sg = {}; d.spare.slice().sort(function(a, b){ return a.f - b.f; }).forEach(function(x){ var k = [x.ser, x.band].filter(Boolean).join(' ') || 'Sans profil'; (sg[k] = sg[k] || []).push(_rfFmt(x.f)); });
      Object.keys(sg).forEach(function(k){ para(k + ' : ' + sg[k].join('   '), K.ink); y += 1; });
      y += 4;
    }
    var al = _rfChecks(d, _rfIl()).filter(function(a){ return a.lvl !== 'info'; });
    if(al.length){
      hd('Points à vérifier');
      al.slice(0, 16).forEach(function(a){ para('•  ' + a.msg, K.ink); y += 0.6; });
      if(al.length > 16) para('… et ' + (al.length - 16) + ' autres.', K.txt2);
      y += 2;
      para('Contrôles simples sur les fréquences saisies (doublons, espacement du profil de la session, plage d\'accord, exclusions). Les intermodulations ne sont pas calculées.', K.muted, 7.4);
    }
    var n = doc.internal.getNumberOfPages();
    for(var p = 1; p <= n; p++){
      doc.setPage(p);
      if(p > 1) _pdfHead(doc, { acc:acc, pf:pf, brand:brand.co || 'PatchFlow', docType:'Feuille RF', title:title, compact:true });
      _pdfFoot(doc, { acc:acc, pf:pf, credit:_pdfCreditFree(), creditWhat:'fiche technique', qr:null, url:'', stamp:title, page:p, pages:n });
    }
    await _pdfDeliver(doc, (_pdfSlug(title) || 'patchflow') + '-rf.pdf');
  } catch(e){ console.error('rfPdf:', e); toast('Export impossible : ' + (e && e.message || e)); }
}
/* Matériel HF du show, pour la demande au loueur : récepteurs et émetteurs IEM par modèle,
   émetteurs main et ceinture quand le type a été précisé */
function _rfGearRows(){
  var d = _rfClean(CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.rf), by = {}, tx = {}, rows = [];
  var slug = function(s){ return _rfNorm(s).replace(/ /g, '-'); };
  d.ch.forEach(function(c){
    var name = ((c.mk && c.mk !== 'Generic' && c.mdl.indexOf(c.mk) < 0 ? c.mk + ' ' : '') + (c.mdl || c.ser)).trim();
    if(name){
      var k = slug(name + ' ' + c.band), g = by[k] || (by[k] = { name:name, band:c.band, dev:{}, n:0 });
      g.n++; g.dev[c.did || c.id] = 1;
    }
    if(c.kind === 'mic' && c.tx){
      var t = (c.tx === 'hh' ? 'Émetteur main ' : 'Émetteur ceinture ') + (c.ser || c.mdl), kt = slug(t + ' ' + c.band), gt = tx[kt] || (tx[kt] = { name:t, band:c.band, n:0 });
      gt.n++;
    }
  });
  Object.keys(by).forEach(function(k){ var g = by[k]; rows.push({ key:'rf:' + k, name:g.name, det:(g.band ? 'bande ' + g.band + ' · ' : '') + _rfPl(g.n), qty:Object.keys(g.dev).length }); });
  Object.keys(tx).forEach(function(k){ var g = tx[k]; rows.push({ key:'rf:tx-' + k, name:g.name, det:g.band ? 'bande ' + g.band : '', qty:g.n }); });
  return rows;
}
