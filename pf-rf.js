/* ══════════════════════════════════════════════════════════════════════
   PatchFlow — module RF
   Reprend une session Shure Wireless Workbench (.shw) et en fait un outil
   de préparation : canaux HF, fréquences, utilisateurs, états, contrôles
   simples, liaison avec l'input list, feuille RF.

   Ce fichier se charge après pf-app.js. La première partie (lecture du
   .shw, bandes, contrôles, fusion) ne dépend de rien d'autre que du
   navigateur : elle est testée seule par tests/rf.html.

   Le calcul de fréquences reprend les règles et les
   écarts de Wireless Workbench (porteuses, intermodulation par zone et
   dans le filtre du récepteur), sans les fréquences parasites propres
   aux appareils ni le spectre du lieu. Il ne garantit pas une coordination
   et se valide par un scan. Aucune fréquence n'est modifiée d'office :
   tout passe par un aperçu et une confirmation.
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
  var cb = (typeof _rfCatBand === 'function') ? _rfCatBand(ser, band) : null;
  if(cb) return [cb.a, cb.b];
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
function _rfEmpty(){ return { v:1, src:null, zones:[], iso:[], zim:[], excl:[], spare:[], ch:[], vers:[], coord:_rfCoDef() }; }
function _rfCleanCh(c){
  if(!c || typeof c !== 'object') return null;
  var kind = c.kind === 'iem' || c.kind === 'oth' ? c.kind : 'mic';
  /* Écarts d'un profil personnalisé du show WWB : [porteuses, ordre 3, ordre 5, 3 émetteurs] en kHz, filtre en MHz */
  var pf = (Array.isArray(c.pf) && c.pf.length === 5) ? c.pf.map(function(v, i){ return Math.max(i === 4 ? 1 : 0, Math.min(i === 4 ? 1000 : 5000, _rfInt(v))); }) : null;
  if(pf && !pf[0]) pf = null;
  return { id: /^[a-z0-9]{4,24}$/.test(c.id) ? c.id : _rfId(), src: _rfStr(c.src, 60), did: _rfStr(c.did, 48),
    n: _rfStr(c.n, 60), n0: _rfStr(c.n0, 60), who: _rfStr(c.who, 60), kind: kind,
    tx: (kind === 'mic' && (c.tx === 'hh' || c.tx === 'bp')) ? c.tx : '',
    f: _rfFreq(c.f), band: _rfStr(c.band, 16), ser: _rfStr(c.ser, 30), mdl: _rfStr(c.mdl, 30), mk: _rfStr(c.mk, 30),
    dev: _rfStr(c.dev, 40), zone: _rfStr(c.zone, 40), tags: _rfStr(c.tags, 80), gc: _rfStr(c.gc, 20),
    pw: Math.max(0, Math.min(5000, _rfInt(c.pw))), sp: Math.max(0, Math.min(5000, _rfInt(c.sp))),
    note: _rfStr(c.note, 200), lk: c.lk === undefined ? c.st === 'ok' : !!c.lk, il: _rfStr(c.il, 60), out: _rfStr(c.out, 60),
    cm: (c.cm === 'rob' || c.cm === 'std' || c.cm === 'more' || (c.cm === 'wwb' && pf)) ? c.cm : '', cd: (c.cd === 'up' || c.cd === 'down') ? c.cd : '', sh: _rfStr(c.sh, 60), pf: pf, nl: !!c.nl, pn: _rfStr(c.pn, 30) };
}
function _rfClean(d){
  var o = _rfEmpty();
  if(!d || typeof d !== 'object') return o;
  var L = function(a){ return Array.isArray(a) ? a : []; };
  if(d.src && typeof d.src === 'object') o.src = { file:_rfStr(d.src.file, 120), show:_rfStr(d.src.show, 80), app:_rfStr(d.src.app, 20), at:_rfStr(d.src.at, 30), mode: d.src.mode === 'coord' ? 'coord' : 'inv' };
  o.zones = L(d.zones).map(function(z){ return _rfStr(z, 40); }).filter(Boolean).slice(0, 60);
  o.zim = L(d.zim).filter(function(p){ return Array.isArray(p) && p.length === 2; }).slice(0, 400).map(function(p){ return [_rfStr(p[0], 40), _rfStr(p[1], 40)]; });
  o.iso = L(d.iso).filter(function(p){ return Array.isArray(p) && p.length === 2; }).slice(0, 400).map(function(p){ return [_rfStr(p[0], 40), _rfStr(p[1], 40)]; });
  o.excl = L(d.excl).map(function(e){ return e && { a:_rfFreq(e.a), b:_rfFreq(e.b), l:_rfStr(e.l, 40) }; }).filter(function(e){ return e && e.a && e.b > e.a; }).slice(0, 400);
  o.spare = L(d.spare).map(function(s){ return s && { f:_rfFreq(s.f), ser:_rfStr(s.ser, 30), band:_rfStr(s.band, 16), zone:_rfStr(s.zone, 40) }; }).filter(function(s){ return s && s.f; }).slice(0, 200);
  o.ch = L(d.ch).map(_rfCleanCh).filter(Boolean).slice(0, _RF_MAX_CH);
  var seen = {};
  o.ch.forEach(function(c){ if(seen[c.id]) c.id = _rfId(); seen[c.id] = 1; });
  var co = _rfCoDef(), dc = (d.coord && typeof d.coord === 'object') ? d.coord : {};
  var clo = _rfFreq(dc.lo), chi = _rfFreq(dc.hi);
  co.mode = _rfLvl(dc.mode); co.dir = dc.dir === 'down' ? 'down' : 'up'; co.from = _rfFreq(dc.from) || 0;
  if(clo && chi > clo){ co.lo = clo; co.hi = chi; }
  co.tvw = dc.tvw === 6 ? 6 : 8; co.sx = dc.sx !== false;
  var tvOk = _rfTvList(co.tvw);
  L(dc.tv).forEach(function(n){ n = _rfInt(n); if(tvOk.indexOf(n) >= 0 && co.tv.indexOf(n) < 0) co.tv.push(n); });
  co.tv.sort(function(x, y){ return x - y; });
  L(dc.rules).forEach(function(r){ var ra = r && _rfFreq(r.a), rb = r && _rfFreq(r.b); if(ra && rb > ra && co.rules.length < 30) co.rules.push({ t:r.t === 'in' ? 'in' : 'ex', a:ra, b:rb }); });
  if(!co.rules.length && dc.avoid) _rfParseRanges(dc.avoid).forEach(function(r){ co.rules.push({ t:'ex', a:r[0], b:r[1] }); });   /* ancien champ texte */
  o.coord = co;
  o.scan = (typeof _rfScanClean === 'function') ? _rfScanClean(d.scan) : null;
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
              zones:[], iso:[], zim:[], excl:[], ch:[], spare:[], skipped:0, coordDiff:0, invDup:0, suggest:'inv', tvw:8 };

  /* Zones et isolement entre zones (matrice de WWB : ch-ch à 0 = zones qui ne se voient pas) */
  var zs = _rfKid(inv, 'zones');
  _rfKids(zs, 'zone').forEach(function(z){ var n = _rfStr(z.textContent, 40); if(n && out.zones.indexOf(n) < 0) out.zones.push(n); });
  _rfKids(_rfKid(zs, 'zone_matrix'), 'from').forEach(function(f){
    var a = _rfStr(f.getAttribute('zone'), 40);
    _rfKids(f, 'to').forEach(function(t){
      var b = _rfStr(t.getAttribute('zone'), 40);
      if(a && b && a !== b && _rfTxt(t, 'ch-ch') === '0') out.iso.push([a, b]);
      if(a && b && a !== b && _rfTxt(t, 'ch-imd') === '0') out.zim.push([a, b]);
    });
  });

  /* Coordination : fréquence coordonnée, type d'appareil et espacement du profil, par canal */
  var cr = _rfKid(root, 'coordinated_data_root'), prof = {}, plv = {}, coord = {}, used = {};
  _rfKids(_rfKid(cr, 'compatibility_profile_settings'), 'profile').forEach(function(p){
    var cp = _rfKid(p, 'compat_profile'); if(!cp) return;
    var sp = _rfInt(_rfTxt(_rfKid(cp, 'spacing'), 'ch_ch')); if(sp <= 0) return;
    /* L'identifiant du profil ne correspond pas toujours à celui des canaux : repli sur série + bande (+ zone) */
    var k = _rfTxt(p, 'series') + '|' + _rfTxt(p, 'band');
    /* Niveau choisi dans WWB, lu dans le nom du profil ; un profil personnalisé reste sans niveau */
    var nm = String(cp.getAttribute('name') || ''), lv = /\*\s*$/.test(nm) ? '' : /^robust$/i.test(nm.trim()) ? 'rob' : /^more frequencies$/i.test(nm.trim()) ? 'more' : /^standard$/i.test(nm.trim()) ? 'std' : '';
    if(!lv){                 /* profil modifié ou créé dans WWB : ses propres écarts sont gardés */
      var S = _rfKid(cp, 'spacing'), fe = Math.abs(_rfInt(_rfTxt(_rfKid(cp, 'filter'), 'filter_end')));
      lv = [sp, _rfInt(_rfTxt(S, 'imd_2t3o')), _rfInt(_rfTxt(S, 'imd_2t5o')), _rfInt(_rfTxt(S, 'imd_3t3o')), fe ? Math.round(fe / 1000) : 100];
    }
    if(cp.getAttribute('id')){ prof['#' + cp.getAttribute('id')] = sp; plv['#' + cp.getAttribute('id')] = lv; }
    prof[k + '|' + _rfTxt(p, 'zone')] = sp; plv[k + '|' + _rfTxt(p, 'zone')] = lv;
    if(!prof[k]){ prof[k] = sp; plv[k] = lv; }
  });
  var level = function(e){
    var ck = _rfKid(e, 'compat_key'), k = _rfTxt(ck, 'series') + '|' + _rfTxt(ck, 'band'), id = '#' + _rfTxt(e, 'compat_prof_id');
    return (plv[id] !== undefined ? plv[id] : plv[k + '|' + _rfTxt(ck, 'zone')] !== undefined ? plv[k + '|' + _rfTxt(ck, 'zone')] : plv[k]) || '';
  };
  var lvOf = function(e){ var l = e ? level(e) : ''; return Array.isArray(l) ? { lv:'wwb', pf:l } : { lv:l, pf:null }; };
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
    var mine = [];
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
      mine.push({ src:(did ? sid : ''), did:did, n:_rfStr(_rfTxt(c, 'channel_name'), 60), dev:dev + (chans.length > 1 ? ' · ' + num : ''),
        mk:mk, ser:ser, mdl:mdl, band:band, zone:zone, tags:_rfStr(_rfTxt(c, 'tags'), 80), gc:gc,
        pw:Math.max(0, _rfInt(_rfTxt(c, 'tx_power'))), kind:kind, fi:fi, fc:fc,
        sp:e ? spacing(e) : 0, lv:lvOf(e).lv, pf:lvOf(e).pf, pn:e ? _rfStr(_rfTxt(_rfKid(e, 'compat_key'), 'mode'), 30) : '', sh:'' });
    });
    /* Émetteur large bande (Axient PSM) : ses canaux audio voyagent sur une seule porteuse. WWB n'en
       coordonne qu'une par appareil ; les canaux réglés sur la même fréquence la partagent. */
    if(/^ADPSM$/i.test(ser)){
      var grp = {};
      mine.forEach(function(m){ if(m.fi) (grp[m.fi] = grp[m.fi] || []).push(m); });
      Object.keys(grp).forEach(function(k){
        var g = grp[k]; if(g.length < 2) return;
        var lead = g.filter(function(m){ return m.fc; })[0];
        g.forEach(function(m){ m.sh = did + '#' + k; if(lead && !m.fc){ m.fc = lead.fc; m.sp = lead.sp; m.lv = lead.lv; m.pf = lead.pf; m.pn = lead.pn; } });
      });
    }
    var counted = {};
    mine.forEach(function(m){
      if(m.sh && counted[m.sh]){ out.ch.push(m); return; }
      if(m.sh) counted[m.sh] = 1;
      if(m.fc && m.fc !== m.fi) out.coordDiff++;
      if(m.fi) defaults[m.fi] = (defaults[m.fi] || 0) + 1;
      out.ch.push(m);
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
  if(/^\s*6/.test(_rfTxt(_rfPath(ci, 'channel_exclusions/location_info'), 'tv_spectrum_format'))) out.tvw = 6;
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
    var base = { src:p.src, did:p.did, n0:p.n, dev:p.dev, mk:p.mk, ser:p.ser, mdl:p.mdl, band:p.band, tags:p.tags, gc:p.gc, pw:p.pw, sp:p.sp, f:f, sh:p.sh || '', pf:p.pf || null, pn:p.pn || '' };
    if(m){
      taken[m.id] = 1;
      var what = [];
      if(m.lk && m.f){ if(m.f !== f) what.push('fréquence verrouillée gardée (' + _rfFmt(m.f) + ', le show dit ' + (_rfFmt(f) || 'aucune') + ')'); base.f = f = m.f; }
      if(m.f !== f) what.push(_rfFmt(m.f) ? _rfFmt(m.f) + ' → ' + (_rfFmt(f) || 'aucune') : 'fréquence ' + _rfFmt(f));
      var renamed = m.n !== m.n0 && !!m.n;                      /* nom retouché dans PatchFlow : on le garde */
      if(!renamed && m.n !== p.n) what.push('nom « ' + (m.n || '—') + ' » → « ' + (p.n || '—') + ' »');
      if(m.band !== p.band && p.band) what.push('bande ' + p.band);
      var c = _rfCleanCh(Object.assign({}, m, base, { n: renamed ? m.n : p.n, zone: m.zone || p.zone, kind: m.kind, cm: m.cm || p.lv || '' }));
      res.ch.push(c);
      if(what.length){ res.upd++; res.diffs.push({ id:c.id, n:c.n || c.dev, what:what }); } else res.same++;
    } else {
      res.add++;
      res.ch.push(_rfCleanCh(Object.assign({ id:_rfId(), n:p.n, zone:p.zone, kind:p.kind, who:'', tx:'', note:'', lk:false, il:'', out:'', cm:p.lv || '' }, base)));
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
/* Une ligne par porteuse : les canaux qui partagent la porteuse d'un émetteur large bande, tant qu'ils
   sont sur la même fréquence, n'en font qu'une. */
function _rfCarriers(list){
  var seen = {};
  return (list || []).filter(function(c){ if(!c.sh) return true; var k = c.sh + '|' + c.f; if(seen[k]) return false; seen[k] = 1; return true; });
}
function _rfIsHfRow(r){
  return /\b(hf|sans[ -]?fil|wireless|ulxd\w*|qlxd\w*|slxd\w*|axient|adx?[123]\w*|skm ?\d*|sk ?\d{3,4}|ur[124]d?)\b/i.test((r.mic || '') + ' ' + (r.name || '')) || !!String(r.hf || '').trim();
}
function _rfChecks(rf, il){
  var out = [], ch = (rf && rf.ch) || [], iso = {};
  ((rf && rf.iso) || []).forEach(function(p){ iso[p[0] + '|' + p[1]] = 1; iso[p[1] + '|' + p[0]] = 1; });
  var apart = function(a, b){ return !!(a.zone && b.zone && a.zone !== b.zone && iso[a.zone + '|' + b.zone]); };
  var nm = function(c){ return c.n || c.who || c.dev || 'Canal'; };
  var push = function(lvl, code, ids, msg){ out.push({ lvl:lvl, code:code, ids:ids, msg:msg }); };
  var on = _rfCarriers(ch.filter(function(c){ return c.f > 0; })).sort(function(a, b){ return a.f - b.f; }), av = _rfAvoid(rf);

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
    var ex = av.ban.filter(function(e){ return c.f >= e.a && c.f <= e.b; })[0];
    if(ex) push('warn', 'excl', [c.id], '« ' + nm(c) + ' » : ' + _rfFmt(c.f) + ' MHz dans une plage à éviter' + (ex.l ? ' (' + ex.l + ')' : '') + '.');
    else if(av.inc.length && !av.inc.some(function(r){ return c.f >= r[0] && c.f <= r[1]; })) push('warn', 'incl', [c.id], '« ' + nm(c) + ' » : ' + _rfFmt(c.f) + ' MHz hors des plages incluses.');
  });
  var group = function(lvl, code, list, one, many){
    if(list.length) push(lvl, code, list.map(function(c){ return c.id; }), list.length + ' ' + (list.length > 1 ? many : one));
  };
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
      if((c.il || c.out) && !r){ push('info', 'lost', [c.id], '« ' + nm(c) + ' » est lié à une ligne absente du patch affiché.'); return; }
      if(!r) return;
      linked[(isOut ? 'o' : 'i') + r.id] = 1;
      var h = _rfParseMHz(r.hf);
      if(c.f && String(r.hf || '').trim() && h !== c.f)
        push('warn', 'ilf', [c.id], (isOut ? 'Sortie ' : 'Entrée ') + r.ch + ' « ' + (r.name || '') + ' » affiche ' + String(r.hf).trim() + ', sa liaison est sur ' + _rfFmt(c.f) + ' MHz. Cliquer pour aligner.');
    });
    var orphan = (il.chs || []).filter(function(r){ return !linked['i' + r.id] && _rfIsHfRow(r); });
    if(orphan.length && ch.length) push('info', 'ilhf', [], orphan.length + (orphan.length > 1 ? ' micros HF de l\'input list sans liaison : ' : ' micro HF de l\'input list sans liaison : ') +
      orphan.slice(0, 6).map(function(r){ return r.ch + ' ' + (r.name || ''); }).join(', ') + (orphan.length > 6 ? '…' : '') + '. Cliquer pour créer leurs liaisons.');
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

/* ── Compatibilité et calcul de fréquences ─────────────────────────────
   Chaque liaison a son niveau de compatibilité (Robuste, Standard, Plus de
   fréquences) et les écarts qui vont avec, propres à sa famille d'appareils :
     - écart minimal avec les autres porteuses ;
     - distance minimale aux produits d'intermodulation des autres
       émetteurs : ordre 3 à deux émetteurs (2A − B), ordre 5 à deux
       émetteurs (3A − 2B), ordre 3 à trois émetteurs (A + B − C).
   Règles, vérifiées sur des shows coordonnés dans Wireless Workbench 7 :
     - une liaison est protégée selon SON niveau : un produit qui tombe près
       d'un canal Robuste est jugé avec les distances du Robuste ;
     - entre deux porteuses, le plus grand des deux écarts s'applique, et
       il vaut entre toutes les zones (sauf zones déclarées isolées) ;
     - un produit naît entre émetteurs d'une même zone ; il compte pour
       une liaison, de n'importe quelle zone, si ces émetteurs sont dans
       la fenêtre du filtre de son récepteur (quelques dizaines de MHz
       autour d'elle). La matrice de zones du show WWB peut couper
       l'intermodulation entre deux zones.
   Écarts et fenêtres par famille sont alignés sur les profils Robust,
   Standard et More Frequencies de Wireless Workbench. Le calcul reste
   simplifié : il ignore les fréquences parasites propres aux appareils et
   le spectre réel du lieu. Le résultat se valide par un scan sur place. */
const _RF_LVL = [['rob', 'Robuste'], ['std', 'Standard'], ['more', 'Plus de fréquences']];
/* Par niveau, en kHz : [porteuses, ordre 3 à 2 émetteurs, ordre 5 à 2 émetteurs, ordre 3 à 3 émetteurs].
   w : demi-largeur de la fenêtre du filtre, en MHz, pour [robuste, standard, plus de fréquences]. */
const _RF_FAM = {
  ad:      { l:'Shure Axient Digital',  rob:[350, 150, 0, 0],     std:[350, 75, 0, 0],    more:[350, 0, 0, 0],     w:[90, 70, 55] },
  ulxd:    { l:'Shure ULX-D / QLX-D',   rob:[350, 150, 0, 0],     std:[350, 75, 0, 0],    more:[350, 0, 0, 0],     w:[100, 100, 100] },
  slxd:    { l:'Shure SLX-D',           rob:[450, 300, 0, 0],     std:[450, 200, 0, 0],   more:[450, 100, 0, 0],   w:[100, 100, 100] },
  uhfr:    { l:'Shure UHF-R',           rob:[350, 175, 0, 100],   std:[325, 175, 0, 50],  more:[300, 175, 0, 0],   w:[30, 25, 25] },
  axt:     { l:'Shure Axient',          rob:[300, 125, 0, 100],   std:[275, 125, 0, 0],   more:[250, 100, 0, 0],   w:[30, 25, 25] },
  psm1000: { l:'Shure PSM 1000',        rob:[375, 275, 0, 100],   std:[350, 250, 0, 50],  more:[325, 225, 0, 0],   w:[69, 62, 57] },
  psm900:  { l:'Shure PSM 900',         rob:[400, 300, 0, 100],   std:[375, 275, 0, 50],  more:[375, 250, 0, 0],   w:[57, 50, 45] },
  psm300:  { l:'Shure PSM 300',         rob:[375, 300, 200, 0],   std:[375, 300, 0, 0],   more:[350, 250, 0, 0],   w:[100, 70, 65] },
  adpsm:   { l:'Shure Axient PSM',      rob:[800, 550, 0, 0],     std:[800, 500, 0, 0],   more:[800, 0, 0, 0],     w:[32, 28, 24] },
  senn:    { l:'Sennheiser analogique', rob:[600, 200, 150, 150], std:[400, 200, 0, 150], more:[350, 175, 0, 0],   w:[100, 50, 50] },
  em3732:  { l:'Sennheiser 3000',       rob:[500, 200, 150, 150], std:[300, 175, 0, 150], more:[300, 175, 0, 0],   w:[100, 50, 50] },
  senniem: { l:'Sennheiser IEM 2000',   rob:[600, 200, 150, 200], std:[500, 200, 0, 200], more:[400, 200, 0, 150], w:[100, 50, 50] },
  ewiem:   { l:'Sennheiser ew IEM',     rob:[600, 200, 150, 200], std:[400, 200, 0, 100], more:[400, 200, 0, 150], w:[100, 50, 50] },
  em6000:  { l:'Sennheiser 6000',       rob:[500, 50, 25, 25],    std:[400, 0, 0, 0],     more:[375, 0, 0, 0],     w:[100, 50, 50] },
  d9000:   { l:'Sennheiser 9000',       rob:[600, 0, 0, 0],       std:[500, 0, 0, 0],     more:[400, 0, 0, 0],     w:[200, 150, 100] },
  ewd:     { l:'Sennheiser EW-D',       rob:[600, 200, 0, 0],     std:[600, 200, 0, 0],   more:[600, 200, 0, 0],   w:[400, 400, 400] },
  /* Appareil inconnu : valeurs d'une liaison analogique courante, fenêtre large par prudence */
  gen:     { l:'Générique',             rob:[400, 250, 0, 100],   std:[375, 200, 0, 50],  more:[350, 175, 0, 0],   w:[100, 100, 100] }
};
const _RF_FAM_RX = [
  [/^AD$/, 'ad'], [/^(ULXD|QLXD)$/, 'ulxd'], [/^ADPSM$/, 'adpsm'], [/^SLXD/, 'slxd'], [/^(UHFR|UR5)$/, 'uhfr'], [/^AXT$/, 'axt'],
  [/^PSM1000$/, 'psm1000'], [/^PSM900$/, 'psm900'], [/^PSM300$/, 'psm300'],
  [/^(SR20(00|50)|EK2000|EW300IEMG3)$/, 'senniem'], [/^EWIEMG4$/, 'ewiem'],
  [/^(EM20(00|50)|EW(100|300|500)G[34]|EW300500G4)$/, 'senn'], [/^EM373/, 'em3732'], [/^EM6000/, 'em6000'], [/^D9000$/, 'd9000'], [/^EWDEM$/, 'ewd']
];
const _RF_T3_MAX = 150;      /* au-delà, les produits à trois émetteurs ne sont plus calculés (trop nombreux) */
function _rfLvl(m){ return m === 'rob' || m === 'more' ? m : 'std'; }
function _rfLvlLbl(m){ m = _rfLvl(m); return m === 'rob' ? 'Robuste' : m === 'more' ? 'Plus de fréquences' : 'Standard'; }
function _rfFam(c){
  var s = _rfNormSer(c && c.ser);
  for(var i = 0; i < _RF_FAM_RX.length; i++) if(_RF_FAM_RX[i][0].test(s)) return _RF_FAM_RX[i][1];
  return 'gen';
}
/* Écarts d'une liaison à un niveau donné (kHz), fenêtre du filtre comprise. Appareil inconnu :
   l'écart entre porteuses du profil de la session est retenu s'il est plus grand. */
function _rfProf(c, lvl){
  if(lvl === 'wwb' && c && c.pf) return { cc:c.pf[0], i3:c.pf[1], i5:c.pf[2], t3:c.pf[3], w:c.pf[4] * 1000, fam:_rfFam(c) };
  lvl = _rfLvl(lvl);
  var cb = c ? _rfCatBand(c.ser, c.band) : null, pn = cb ? _rfCatProfName(cb, c.pn) : '';
  if(pn){                       /* valeurs exactes de la série, de la bande et du profil RF */
    var q = _RF_CAT.prof[cb.p[pn]][lvl === 'rob' ? 0 : lvl === 'std' ? 1 : 2];
    return { cc:q[0], i3:q[1], i5:q[2], t3:q[5], w:q[6] * 1000, fam:_rfFam(c), cat:true, pn:pn };
  }
  var fam = _rfFam(c), F = _RF_FAM[fam], v = F[lvl], cc = v[0];
  if(fam === 'gen' && c && c.sp > cc) cc = c.sp;
  return { cc:cc, i3:v[1], i5:v[2], t3:v[3], w:F.w[lvl === 'rob' ? 0 : lvl === 'std' ? 1 : 2] * 1000, fam:fam };
}
/* « 470-478 ; 518,5 à 526 » → [[470000,478000],[518500,526000]] */
function _rfParseRanges(s){
  var out = [], re = /(\d+(?:[.,]\d+)?)\s*(?:-|à|a)\s*(\d+(?:[.,]\d+)?)/g, m;
  while((m = re.exec(String(s || ''))) && out.length < 40){
    var a = _rfParseMHz(m[1]), b = _rfParseMHz(m[2]);
    if(a && b && b > a) out.push([a, b]);
  }
  return out;
}
/* Canal TV → plage en kHz. Canaux de 8 MHz (Europe, 21 = 470 MHz) ou de 6 MHz (Amériques, 14 = 470 MHz) */
function _rfTvList(w){ var o = [], n; if(w === 6) for(n = 14; n <= 36; n++) o.push(n); else for(n = 21; n <= 48; n++) o.push(n); return o; }
function _rfTvRange(n, w){ return w === 6 ? [470000 + (n - 14) * 6000, 470000 + (n - 13) * 6000] : [470000 + (n - 21) * 8000, 470000 + (n - 20) * 8000]; }
function _rfCoDef(){ return { mode:'std', dir:'up', from:0, lo:470000, hi:694000, tv:[], tvw:8, sx:true, rules:[] }; }
/* Ce que le show demande d'éviter : exclusions de la session, canaux TV cochés, plages exclues ;
   et, s'il y en a, les seules plages où chercher (inclusions). */
function _rfAvoid(rf){
  var co = (rf && rf.coord) || _rfCoDef(), ban = [], inc = [];
  if(co.sx !== false) ((rf && rf.excl) || []).forEach(function(e){ ban.push({ a:e.a, b:e.b, l:e.l || 'session' }); });
  (co.tv || []).forEach(function(n){ var r = _rfTvRange(n, co.tvw); ban.push({ a:r[0], b:r[1], l:'TV ' + n }); });
  (co.rules || []).forEach(function(r){ if(r.t === 'in') inc.push([r.a, r.b]); else ban.push({ a:r.a, b:r.b, l:'plage exclue' }); });
  if(rf && rf.scan && rf.scan.use !== false && typeof _rfScanBans === 'function') _rfScanBans(rf.scan).forEach(function(r){ ban.push({ a:r[0], b:r[1], l:'scan', sc:1 }); });
  return { ban:ban, inc:inc };
}
function _rfIsoMap(iso){ var m = {}; (iso || []).forEach(function(p){ m[p[0] + '|' + p[1]] = 1; m[p[1] + '|' + p[0]] = 1; }); return m; }
/* Conflits entre des fréquences. list : [{id, f, p, z}] ; p = écarts de la liaison (_rfProf, niveau
   Standard s'ils manquent), z = zone. iso : paires de zones isolées (pas d'écart exigé entre elles).
   zim : paires de zones sans intermodulation de l'une vers l'autre.
   Retour : { list:[{t:'cc'|'i3'|'i5'|'t3', v (canal gêné), src:[canaux en cause], d (kHz)}], more, t3skip } */
function _rfCompat(list, iso, zim){
  var cs = (list || []).filter(function(c){ return c.f > 0; }).map(function(c){ return { id:c.id, f:c.f, z:c.z || '', p:c.p || _rfProf(c, c.lvl) }; }).sort(function(a, b){ return a.f - b.f; });
  var n = cs.length, out = [], CAP = 400, more = false, t3skip = false, I = _rfIsoMap(iso), i, j, mcc = 0;
  cs.forEach(function(c){ if(c.p.cc > mcc) mcc = c.p.cc; });
  for(i = 0; i < n; i++) for(j = i + 1; j < n; j++){
    var d = cs[j].f - cs[i].f;
    if(d >= mcc) break;
    if(d >= Math.max(cs[i].p.cc, cs[j].p.cc) || (cs[i].z !== cs[j].z && I[cs[i].z + '|' + cs[j].z])) continue;
    if(out.length >= CAP){ more = true; break; }
    out.push({ t:'cc', v:cs[j].id, src:[cs[i].id], d:d });
  }
  /* Intermodulation : les produits naissent entre émetteurs d'une même zone, et peuvent gêner une
     liaison de n'importe quelle zone (sauf paires de zones déclarées sans intermodulation). */
  var zones = {}, F = cs.map(function(c){ return c.f; }), mx = { i3:0, i5:0, t3:0, w:0 }, seen = {}, NI = _rfIsoMap(zim);
  cs.forEach(function(c, q){ c.q = q; (zones[c.z] = zones[c.z] || []).push(c); ['i3', 'i5', 't3', 'w'].forEach(function(t){ if(c.p[t] > mx[t]) mx[t] = c.p[t]; }); });
  var lower = function(x){ var lo = 0, hi = n; while(lo < hi){ var q = (lo + hi) >> 1; if(F[q] < x) lo = q + 1; else hi = q; } return lo; };
  var hit = function(t, p, src, z){
    var D = mx[t]; if(!D || more) return;
    for(var v = lower(p - D + 1); v < n && F[v] < p + D; v++){
      var V = cs[v];
      if(src.indexOf(V) >= 0 || Math.abs(F[v] - p) >= V.p[t]) continue;                  /* jugé avec les écarts du canal gêné */
      if(V.z !== z && NI[z + '|' + V.z]) continue;
      if(src.some(function(S){ return Math.abs(S.f - F[v]) > V.p.w; })) continue;        /* émetteur hors de la fenêtre de son filtre */
      var key = t + v + ':' + src.map(function(S){ return S.q; }).sort(function(x, y){ return x - y; }).join('-');
      if(seen[key]) continue; seen[key] = 1;
      if(out.length >= CAP){ more = true; return; }
      out.push({ t:t, v:V.id, src:src.map(function(S){ return S.id; }), d:Math.abs(F[v] - p) });
    }
  };
  Object.keys(zones).forEach(function(z){
    var g = zones[z], m = g.length, a, b, k;
    for(a = 0; a < m && !more; a++) for(b = 0; b < m; b++){
      if(a === b || g[a].f === g[b].f) continue;
      var gap = Math.abs(g[a].f - g[b].f);
      if(2 * gap <= mx.w + mx.i3) hit('i3', 2 * g[a].f - g[b].f, [g[a], g[b]], z);
      if(3 * gap <= mx.w + mx.i5) hit('i5', 3 * g[a].f - 2 * g[b].f, [g[a], g[b]], z);
    }
    if(mx.t3 && m > _RF_T3_MAX) t3skip = true;
    else if(mx.t3) for(a = 0; a < m && !more; a++) for(b = a + 1; b < m; b++){
      if(g[b].f - g[a].f > 2 * mx.w) break;
      for(k = 0; k < m; k++) if(k !== a && k !== b) hit('t3', g[a].f + g[b].f - g[k].f, [g[a], g[b], g[k]], z);
    }
  });
  return { list:out, more:more, t3skip:t3skip };
}
/* Attribution de fréquences compatibles.
   chs : [{id, f, lo, hi, fixed, p, dir, z}] dans l'ordre d'attribution. fixed = fréquence gardée telle
   quelle et protégée ; p = écarts de la liaison ; dir = 'up' (depuis le bas de sa plage) ou 'down' ;
   z = zone. opt : { step (kHz), avoid:[[a,b]], include:[[a,b]], iso:[[zone, zone]], zim:[[zone, zone]] } — avec des
   inclusions, on ne cherche que dedans.
   Chaque canal reçoit la première fréquence libre de sa plage dans son sens. Une fréquence écartée
   le reste (les contraintes ne font que s'ajouter) : la recherche ne revient jamais en arrière.
   Par zone, deux jeux de tables au kHz : où tombent les produits déjà créés (avec la distance du
   plus lointain des émetteurs en cause), et où une porteuse est protégée (avec la largeur de son
   filtre). Un produit gêne quand sa « portée » tient dans le filtre de la liaison touchée. */
/* Départ du calcul à une fréquence choisie : vers le haut, la recherche commence à cette fréquence
   (vers le bas, elle part d'elle) au lieu du bord de la bande. Hors de la bande d'un appareil, son bord
   de bande reste le départ. */
function _rfFromRange(r, from, dir){
  if(!r || !(from > r[0]) || !(from < r[1])) return r;
  return dir === 'down' ? [r[0], from] : [from, r[1]];
}
function _rfCoord(chs, opt){
  opt = opt || {};
  var step = opt.step > 0 ? Math.round(opt.step) : 25, U = 10;
  var norm = function(c){ return c.p || _rfProf(c, c.lvl); };
  var todo = (chs || []).filter(function(c){ return !c.fixed && c.lo > 0 && c.hi > c.lo; });
  var fixed = (chs || []).filter(function(c){ return c.fixed && c.f > 0; });
  var res = { list:[], placed:0, missed:0, err:'' };
  if(!todo.length) return res;
  /* Les liaisons qui demandent le plus de place autour d'elles passent en premier : placées dans un
     spectre encore peu chargé en produits, elles laissent les moins exigeantes se glisser ensuite.
     À exigence égale, l'ordre donné est respecté. */
  todo = todo.map(function(c, i){ var p = norm(c); return { c:c, i:i, w:p.i3 + p.t3 + p.i5 + (p.cc > 400 ? p.cc - 400 : 0) }; })
             .sort(function(a, b){ return b.w - a.w || a.i - b.i; }).map(function(x){ return x.c; });
  var gLo = Infinity, gHi = 0, Z = {}, nz = 0, I = _rfIsoMap(opt.iso), NI = _rfIsoMap(opt.zim), any5 = false, any3 = false, ZK;
  todo.forEach(function(c){ gLo = Math.min(gLo, c.lo); gHi = Math.max(gHi, c.hi); });
  fixed.forEach(function(c){ gLo = Math.min(gLo, c.f); gHi = Math.max(gHi, c.f); });
  todo.concat(fixed).forEach(function(c){
    var p = norm(c), z = c.z || '', zo = Z[z] || (nz++, Z[z] = { car:[], n5:false, n3:false });
    if(p.i5){ zo.n5 = true; any5 = true; } if(p.t3){ zo.n3 = true; any3 = true; }
  });
  ZK = Object.keys(Z);
  var PAD = 1000, base = gLo - PAD, size = gHi - gLo + 2 * PAD + 1;
  if(size > 6e6 || size * nz > 8e7){ res.err = 'Plage de calcul trop étendue pour ce nombre de zones.'; return res; }
  var ban = new Uint8Array(size), all = [];
  var paint = function(arr, a, b, v){ for(var x = Math.max(0, a - base), e = Math.min(size - 1, b - base); x <= e; x++) arr[x] = v; };
  if(opt.include && opt.include.length){ ban.fill(1); opt.include.forEach(function(r){ paint(ban, r[0], r[1], 0); }); }
  (opt.avoid || []).forEach(function(r){ paint(ban, r[0], r[1], 1); });
  Object.keys(Z).forEach(function(z){
    var zo = Z[z], A = function(on){ return on ? new Uint16Array(size) : null; };
    /* R : produits créés dans la zone (utiles dès qu'une liaison, où qu'elle soit, s'en protège) ; N : porteuses de la zone à protéger */
    zo.R3 = A(true); zo.N3 = A(true); zo.R5 = A(any5); zo.N5 = A(zo.n5); zo.RT = A(any3); zo.NT = A(zo.n3);
  });
  var reach = function(r){ return Math.min(65535, Math.floor(r / U) + 1); };          /* portée d'un produit, par excès de prudence */
  var wide = function(w){ return Math.min(65535, Math.ceil(w / U) + 1); };            /* fenêtre d'un filtre */
  var put = function(arr, p, r){ p -= base; if(p >= 0 && p < size && (!arr[p] || r < arr[p])) arr[p] = r; };
  var guard = function(arr, f, d, w){ for(var x = Math.max(0, f - d + 1 - base), e = Math.min(size - 1, f + d - 1 - base); x <= e; x++) if(arr[x] < w) arr[x] = w; };
  var hits = function(arr, p, r){ p -= base; return p >= 0 && p < size && arr[p] !== 0 && r <= arr[p]; };          /* un produit de portée r tombe sur une porteuse protégée */
  var struck = function(arr, f, d, w){ for(var x = Math.max(0, f - d + 1 - base), e = Math.min(size - 1, f + d - 1 - base); x <= e; x++) if(arr[x] !== 0 && arr[x] <= w) return true; return false; };
  var r3 = function(f, a, b){ var q = f + a - b; return reach(Math.max(Math.abs(f - q), Math.abs(a - q), Math.abs(b - q))); };
  var add = function(f, p, z){
    var zo = Z[z], car = zo.car, k = car.length, i, j, a, b, d;
    for(i = 0; i < k; i++){
      a = car[i]; d = Math.abs(f - a);
      put(zo.R3, 2 * f - a, reach(2 * d)); put(zo.R3, 2 * a - f, reach(2 * d));
      if(zo.R5){ put(zo.R5, 3 * f - 2 * a, reach(3 * d)); put(zo.R5, 3 * a - 2 * f, reach(3 * d)); }
    }
    if(zo.RT && k < _RF_T3_MAX) for(i = 0; i < k; i++) for(j = i + 1; j < k; j++){
      a = car[i]; b = car[j];
      put(zo.RT, f + a - b, r3(f, a, b)); put(zo.RT, f + b - a, r3(f, b, a)); put(zo.RT, a + b - f, r3(a, b, f));
    }
    var w = wide(p.w);
    if(p.i3) guard(zo.N3, f, p.i3, w);
    if(zo.N5 && p.i5) guard(zo.N5, f, p.i5, w);
    if(zo.NT && p.t3) guard(zo.NT, f, p.t3, w);
    car.push(f); all.push({ f:f, cc:p.cc, z:z });
  };
  var ok = function(f, p, z){
    var x = f - base;
    if(x < 0 || x >= size || ban[x]) return false;
    var zo = Z[z], car = zo.car, k = car.length, i, j, a, b, d, w = wide(p.w);
    for(i = 0; i < all.length; i++){
      a = all[i];
      if(Math.abs(f - a.f) < Math.max(p.cc, a.cc) && !(a.z !== z && I[a.z + '|' + z])) return false;
    }
    var q, o, ra, rb, rc;
    for(q = 0; q < ZK.length; q++){                                  /* un produit existant, né dans une zone, tombe sur la candidate */
      if(ZK[q] !== z && NI[ZK[q] + '|' + z]) continue;
      o = Z[ZK[q]];
      if(p.i3 && struck(o.R3, f, p.i3, w)) return false;
      if(o.R5 && p.i5 && struck(o.R5, f, p.i5, w)) return false;
      if(o.RT && p.t3 && struck(o.RT, f, p.t3, w)) return false;
    }
    for(q = 0; q < ZK.length; q++){                                  /* un produit de la candidate tombe sur une porteuse, dans n'importe quelle zone */
      if(ZK[q] !== z && NI[z + '|' + ZK[q]]) continue;
      o = Z[ZK[q]];
      for(i = 0; i < k; i++){
        a = car[i]; d = Math.abs(f - a); ra = reach(2 * d);
        if(hits(o.N3, 2 * f - a, ra) || hits(o.N3, 2 * a - f, ra)) return false;
        if(o.N5 && (hits(o.N5, 3 * f - 2 * a, reach(3 * d)) || hits(o.N5, 3 * a - 2 * f, reach(3 * d)))) return false;
      }
      if(o.NT && k < _RF_T3_MAX) for(i = 0; i < k; i++) for(j = i + 1; j < k; j++){
        a = car[i]; b = car[j];
        if(hits(o.NT, f + a - b, r3(f, a, b)) || hits(o.NT, f + b - a, r3(f, b, a)) || hits(o.NT, a + b - f, r3(a, b, f))) return false;
      }
    }
    return true;
  };
  fixed.forEach(function(c){ add(c.f, norm(c), c.z || ''); });
  var ptr = {};
  todo.forEach(function(c){
    var p = norm(c), z = c.z || '', down = c.dir === 'down', key = [c.lo, c.hi, p.cc, p.i3, p.i5, p.t3, p.w, down ? 'd' : 'u', z, c.step || 0].join('|');
    var st = c.step > 0 ? Math.round(c.step) : step;                 /* pas d'accord propre à la bande, s'il est connu */
    var lo = Math.ceil(c.lo / st) * st, hi = Math.floor(c.hi / st) * st;
    var f = ptr[key] === undefined ? (down ? hi : lo) : ptr[key], found = 0;
    while(down ? f >= lo : f <= hi){ if(ok(f, p, z)){ found = f; break; } f += down ? -st : st; }
    ptr[key] = found ? found + (down ? -st : st) : f;
    if(found){ add(found, p, z); res.placed++; } else res.missed++;
    res.list.push({ id:c.id, f:found });
  });
  return res;
}

/* ── Catalogue de matériel ─────────────────────────────────────────────
   pf-rf-catalog.json : toutes les séries Shure et Sennheiser connues de
   Wireless Workbench 7 — modèles, nombre de canaux, bandes, plages
   d'accord, pas d'accord, et pour chaque bande les écarts de compatibilité
   de chaque profil RF aux trois niveaux. Il est chargé à l'ouverture de
   l'onglet RF ; tant qu'il manque (hors ligne), les tables intégrées plus
   haut (bandes courantes, écarts par famille) servent de repli. */
var _RF_CAT = null, _RF_CAT_IDX = null, _RF_CAT_P = null;
function _rfCatSet(cat){
  if(!cat || !Array.isArray(cat.series) || !Array.isArray(cat.prof)) return false;
  var idx = {};
  cat.series.forEach(function(s){ (s.b || []).forEach(function(b){ idx[_rfNormSer(s.s) + '|' + b.n] = b; }); });
  _RF_CAT = cat; _RF_CAT_IDX = idx; _RF_BMAP = null;
  return true;
}
function _rfCatLoad(){
  if(_RF_CAT) return Promise.resolve(true);
  if(!_RF_CAT_P) _RF_CAT_P = fetch('pf-rf-catalog.json?v=1').then(function(r){ return r.ok ? r.json() : null; }).then(_rfCatSet).catch(function(){ _RF_CAT_P = null; return false; });
  return _RF_CAT_P;
}
function _rfCatBand(ser, band){ return (_RF_CAT_IDX && _RF_CAT_IDX[_rfNormSer(ser) + '|' + String(band || '').trim()]) || null; }
/* Profil RF d'une bande : celui du canal s'il existe, sinon Standard, sinon le premier */
function _rfCatProfName(b, pn){
  if(!b || !b.p) return '';
  if(pn && b.p[pn] !== undefined) return pn;
  if(b.p.Standard !== undefined) return 'Standard';
  if(b.p['4-channel_wideband'] !== undefined) return '4-channel_wideband';
  return Object.keys(b.p)[0] || '';
}
const _RF_PN_LBL = { 'Standard':'Standard', 'HD':'Haute densité', '4-channel_wideband':'Large bande 4 canaux', '2-channel_wideband':'Large bande 2 canaux', 'Narrowband':'Bande étroite',
  'SC_narrowband':'Bande étroite (canal seul)', 'AD_Standard_PTP':'Standard point à point', 'Analog_FM':'FM analogique', 'AXT':'Axient', 'UHF-R':'UHF-R', 'MW':'MW' };
/* Type d'un modèle du catalogue → nature du canal dans PatchFlow */
const _RF_CAT_T = { rx:'Récepteur micro', iem:'Émetteur IEM', hh:'Émetteur main', bp:'Émetteur ceinture', iemrx:'Récepteur IEM', com:'Intercom', mic:'Micro', scan:'Scanner', dist:'Distributeur d\'antennes', chg:'Chargeur', ap:'Point d\'accès', oth:'Autre' };
/* Canaux à créer pour n appareils d'un modèle. Pur : sert aussi aux tests. */
function _rfGearChannels(o){
  var out = [], ch = Math.max(1, Math.min(64, _rfInt(o.ch) || 1)), n = Math.max(1, Math.min(50, _rfInt(o.qty) || 1)), from = Math.max(1, _rfInt(o.from) || 1);
  var kind = o.t === 'iem' || o.t === 'iemrx' ? 'iem' : o.t === 'com' || o.t === 'oth' ? 'oth' : 'mic';
  var wide = /^4-channel_wideband$/.test(o.pn || '') ? 4 : /^2-channel_wideband$/.test(o.pn || '') ? 2 : 0;
  for(var d = 0; d < n; d++){
    var did = _rfId(), name = o.mdl + ' ' + (from + d);
    for(var i = 0; i < ch; i++){
      out.push(_rfCleanCh({ id:_rfId(), did:did, n:'', mk:o.mk, ser:o.ser, mdl:o.mdl, band:o.band, pn:o.pn || '', zone:o.zone || '', kind:kind,
        dev:name + (ch > 1 ? ' · ' + (i + 1) : ''), sh:wide ? did + '#w' + Math.floor(i / wide) : '' }));
    }
  }
  return out;
}

/* ── Scan du spectre ───────────────────────────────────────────────────
   Un scan dit ce qui est déjà occupé sur place. Formats lus :
     - .sdb3 de Wireless Workbench (en-tête JSON, puis balayages binaires) ;
     - .csv / .txt « fréquence, niveau » (RF Explorer, TTi, Sennheiser,
       Rohde & Schwarz, export Workbench…), en Hz, kHz ou MHz.
   Le scan est ramené sur une grille de 25 kHz, en crête, à 1 dB près, et
   rangé avec le show. Au-dessus du seuil choisi, les fréquences sont
   évitées par le calcul et signalées par les contrôles. */
const _RF_SCAN_STEP = 25, _RF_SCAN_MAX = 60000;
function _rfScanEnc(db){ return Math.max(1, Math.min(255, Math.round(db) + 141)); }      /* 0 = pas de mesure */
function _rfScanDb(v){ return v - 141; }
/* Points [kHz, dBm] → grille { a, b, d:Uint8Array } (crête par case, trous comblés par la mesure voisine si le pas d'origine est large) */
function _rfScanGrid(pts){
  pts = (pts || []).filter(function(p){ return _rfFreq(p[0]) && isFinite(p[1]); }).sort(function(x, y){ return x[0] - y[0]; });
  if(pts.length < 10) return null;
  var S = _RF_SCAN_STEP, a = Math.floor(pts[0][0] / S) * S, b = Math.ceil(pts[pts.length - 1][0] / S) * S, n = (b - a) / S + 1;
  if(n > _RF_SCAN_MAX) return null;
  var d = new Uint8Array(n), i, k, gaps = [];
  for(i = 1; i < pts.length; i++) gaps.push(pts[i][0] - pts[i - 1][0]);
  gaps.sort(function(x, y){ return x - y; });
  var step = gaps[gaps.length >> 1] || S, hold = Math.min(40, Math.max(0, Math.round((step / S - 1) / 2)));     /* demi-pas d'origine */
  pts.forEach(function(p){
    var c = Math.round((p[0] - a) / S), v = _rfScanEnc(p[1]);
    for(k = Math.max(0, c - hold); k <= Math.min(n - 1, c + hold); k++) if(v > d[k]) d[k] = v;
  });
  return { a:a, b:b, d:d };
}
function _rfB64(u8){ var s = '', i; for(i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function _rfUnB64(s){ try { var b = atob(String(s || '')), u = new Uint8Array(b.length); for(var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } catch(e){ return null; } }
/* Scan rangé avec le show : { name, a, b, th (seuil dBm), d (base64) } */
function _rfScanClean(s){
  if(!s || typeof s !== 'object') return null;
  var a = _rfFreq(s.a), b = _rfFreq(s.b), u = _rfUnB64(s.d);
  if(!a || !(b > a) || !u || u.length !== (b - a) / _RF_SCAN_STEP + 1 || u.length > _RF_SCAN_MAX) return null;
  var th = Math.round(+s.th); if(!isFinite(th)) th = -95;
  return { name:_rfStr(s.name, 80), a:a, b:b, th:Math.max(-130, Math.min(-20, th)), d:String(s.d), use:s.use !== false };
}
var _RF_SCAN_MEMO = { d:null, u:null };
function _rfScanData(s){ if(!s) return null; if(_RF_SCAN_MEMO.d !== s.d){ _RF_SCAN_MEMO.d = s.d; _RF_SCAN_MEMO.u = _rfUnB64(s.d); } return _RF_SCAN_MEMO.u; }
/* Plages au-dessus du seuil : [[a, b]] en kHz, les trous de moins de 100 kHz étant refermés */
function _rfScanBans(s){
  var u = _rfScanData(s), out = [], S = _RF_SCAN_STEP, lim; if(!u) return out;
  lim = _rfScanEnc(s.th);
  for(var i = 0, st = -1; i <= u.length; i++){
    var on = i < u.length && u[i] > lim;
    if(on && st < 0) st = i;
    if(!on && st >= 0){
      var A = s.a + st * S, B = s.a + (i - 1) * S;
      if(out.length && A - out[out.length - 1][1] <= 100) out[out.length - 1][1] = B; else out.push([A, B]);
      st = -1;
    }
  }
  return out.slice(0, 2000);
}
/* Fusion de deux scans : la crête des deux, sur la réunion des plages */
function _rfScanMerge(x, y){
  if(!x) return y; if(!y) return x;
  var ux = _rfScanData(x) && new Uint8Array(_rfScanData(x)), uy = _rfUnB64(y.d), S = _RF_SCAN_STEP, a = Math.min(x.a, y.a), b = Math.max(x.b, y.b), n = (b - a) / S + 1, i;
  if(!ux || !uy || n > _RF_SCAN_MAX) return y;
  var d = new Uint8Array(n);
  for(i = 0; i < ux.length; i++) d[(x.a - a) / S + i] = ux[i];
  for(i = 0; i < uy.length; i++){ var k = (y.a - a) / S + i; if(uy[i] > d[k]) d[k] = uy[i]; }
  return { name:_rfStr(x.name + ' + ' + y.name, 80), a:a, b:b, th:x.th, d:_rfB64(d), use:x.use !== false };
}
/* Lecture d'un fichier de scan. buf : ArrayBuffer. Retour : { ok, pts:[[kHz, dBm]], title } ou { ok:false, err } */
function _rfScanParse(buf){
  var fail = function(m){ return { ok:false, err:m }; };
  if(!buf || !buf.byteLength) return fail('Fichier vide.');
  if(buf.byteLength > 30e6) return fail('Fichier trop volumineux (30 Mo au maximum).');
  var u8 = new Uint8Array(buf), head = '', i;
  for(i = 0; i < Math.min(u8.length, 12); i++) head += String.fromCharCode(u8[i]);
  if(head.indexOf('//@ShureScan') === 0) return _rfScanSdb(u8);
  if(head.slice(0, 2) === 'PK' || head.slice(0, 4) === '%PDF') return fail('Ce fichier n\'est pas un scan. Formats lus : .sdb3 de Wireless Workbench, .csv ou .txt « fréquence, niveau ».');
  var text = '';
  try { text = new TextDecoder('utf-8').decode(u8); } catch(e){ for(i = 0; i < u8.length; i++) text += String.fromCharCode(u8[i]); }
  if(text.indexOf('<show') >= 0) return fail('Ce fichier est un show Wireless Workbench, pas un scan : importez-le avec « Importer un show WWB ».');
  var rows = [], semi = /[;\t]/.test(text.slice(0, 4000));
  text.split(/\r?\n/).forEach(function(l){
    var p = semi ? l.split(/[;\t]/) : l.trim().split(/\s*,\s*|\s+/);
    if(p.length < 2) return;
    var f = parseFloat(String(p[0]).replace(',', '.')), v = parseFloat(String(p[1]).replace(',', '.'));
    if(isFinite(f) && isFinite(v) && f > 0 && /^[\s"]*[\d.,]+[\s"]*$/.test(p[0])) rows.push([f, v]);
  });
  if(rows.length < 10) return fail('Aucune mesure lisible : il faut une fréquence et un niveau par ligne.');
  var mid = rows.map(function(r){ return r[0]; }).sort(function(x, y){ return x - y; })[rows.length >> 1];
  var mul = mid < 30000 ? 1000 : mid < 3e7 ? 1 : 0.001;                 /* MHz, kHz ou Hz */
  var pts = rows.map(function(r){ return [r[0] * mul, r[1]]; });
  var lv = pts.map(function(p){ return p[1]; }).sort(function(x, y){ return x - y; }), med = lv[lv.length >> 1];
  if(med > 20 || med < -200) return fail('Niveaux illisibles : le scan doit donner des niveaux en dBm.');
  return { ok:true, pts:pts, title:'' };
}
/* .sdb3 : « //@ShureScan », un en-tête JSON, « @Binary: », puis des balayages « @Swp » (identifiant, horodatage,
   une valeur entière par point, somme de contrôle). On garde la crête de tous les balayages. */
function _rfScanSdb(u8){
  var fail = function(m){ return { ok:false, err:m }; }, find = function(str, from){
    outer: for(var i = from || 0; i <= u8.length - str.length; i++){ for(var k = 0; k < str.length; k++) if(u8[i + k] !== str.charCodeAt(k)) continue outer; return i; }
    return -1;
  };
  var bi = find('@Binary:'); if(bi < 0) return fail('Scan .sdb3 illisible : données absentes.');
  var js = '', i, H;
  for(i = find('\n') + 1; i < bi; i++) js += String.fromCharCode(u8[i]);
  try { H = JSON.parse(js); } catch(e){ return fail('Scan .sdb3 illisible : en-tête endommagé.'); }
  var curve = null, pre = 0, post = 0, seen = false;
  (H.BinarySchema || []).forEach(function(s){ if(s.Curve){ curve = s.Curve; seen = true; } else if(seen) post += s.Bytes || 0; else pre += s.Bytes || 0; });
  var width = (H.BitWidth || 16) / 8, unit = /^m/i.test(H.FreqUnits || '') ? 1000 : /^k/i.test(H.FreqUnits || '') ? 1 : 0.001;
  if(!curve || !curve.FreqRanges || width !== 2) return fail('Scan .sdb3 d\'un format non pris en charge.');
  var fr = [], n = 0;
  curve.FreqRanges.forEach(function(r){ for(var f = r.StartFreq; f <= r.EndFreq + 1e-6; f += r.StepFreq){ fr.push(f * unit); n++; } });
  if(n < 10 || n > 400000) return fail('Scan .sdb3 illisible : plage de fréquences incohérente.');
  var scale = H['Scale Factor'] || 1, nodata = H.NoDataValue, peak = new Float64Array(n).fill(-1e9), pos = bi + 8, sweeps = 0, len = pre + n * 2 + post;
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  while(pos + len <= u8.length && u8[pos] === 64 && u8[pos + 1] === 83 && u8[pos + 2] === 119 && u8[pos + 3] === 112){        /* « @Swp » */
    for(i = 0; i < n; i++){ var v = dv.getInt16(pos + pre + i * 2, false); if(v !== nodata && v / scale > peak[i]) peak[i] = v / scale; }
    pos += len; sweeps++;
  }
  if(!sweeps) return fail('Scan .sdb3 sans balayage.');
  var pts = [];
  for(i = 0; i < n; i++) if(peak[i] > -1e8) pts.push([fr[i], peak[i]]);
  return { ok:true, pts:pts, title:_rfStr(H.Title, 60), sweeps:sweeps };
}

/* ══════════════════════════════════════════════════════════════════════
   Interface — s'appuie sur pf-app.js (CUR_SHOW, sb, CHS, OUT_CHS, toast,
   charte PDF…). Les données vivent dans CUR_SHOW.stage_data.rf : même
   enregistrement et mêmes droits que le reste du show.
   ══════════════════════════════════════════════════════════════════════ */
var RF = { showId:null, data:null, q:'', fk:'', fz:'', fs:'', sort:'zone', look:false, lq:'', t:null, pend:null, allAl:false, co:null, onClose:null, gear:null, wwb:null, sel:{}, selLast:'' };

function _rfLoad(){
  var id = CUR_SHOW && CUR_SHOW.id;
  if(RF.showId === id && RF.data) return;
  RF.showId = id; RF.data = _rfClean(CUR_SHOW && CUR_SHOW.stage_data && CUR_SHOW.stage_data.rf);
  RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; RF.look = false; RF.lq = ''; RF.pend = null; RF.allAl = false; RF.sel = {}; RF.selLast = ''; RF.calcUndo = null;
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
function _rfCmp(a, b){ return String(a || '').localeCompare(String(b || ''), 'fr', { numeric:true, sensitivity:'base' }); }
function _rfMatchQ(c, raw){
  var q = _rfNorm(raw), qf = String(raw || '').replace(',', '.').trim();
  if(!q && !qf) return true;
  if(/^\d/.test(qf) && _rfFmt(c.f).indexOf(qf) >= 0) return true;
  return !!q && _rfNorm([c.n, c.who, c.mdl, c.dev, c.zone, c.tags, c.note, c.band].join(' ')).indexOf(q) >= 0;
}
function _rfVisible(){
  var zs = _rfZones(), ko = { mic:0, iem:1, oth:2 }, so = {};
  var list = RF.data.ch.filter(function(c){
    return (!RF.fk || c.kind === RF.fk) && (!RF.fz || c.zone === RF.fz) && (!RF.fs || (RF.fs === 'lk') === !!c.lk) && _rfMatchQ(c, RF.q);
  });
  var zi = function(c){ var i = zs.indexOf(c.zone); return i < 0 ? 999 : i; };
  list.sort(function(a, b){
    if(RF.sort === 'f') return (a.f || 9e9) - (b.f || 9e9) || _rfCmp(a.n, b.n);
    if(RF.sort === 'n') return _rfCmp(a.n, b.n);
    if(RF.sort === 'who') return _rfCmp(a.who || 'zzz', b.who || 'zzz') || _rfCmp(a.n, b.n);
    if(RF.sort === 'st') return (a.lk ? 0 : 1) - (b.lk ? 0 : 1) || _rfCmp(a.n, b.n);
    return zi(a) - zi(b) || ko[a.kind] - ko[b.kind] || _rfCmp(a.dev, b.dev) || _rfCmp(a.n, b.n);
  });
  return list;
}
/* Alertes rangées par canal */
function _rfAlerts(){
  var all = _rfChecks(RF.data, _rfIl()), by = {};
  all.forEach(function(a){ if(a.lvl === 'info') return; a.ids.forEach(function(id){ (by[id] = by[id] || []).push(a); }); });
  /* Intermodulation : une seule ligne ; le recalcul est dans la bande « Fréquences », le détail dans ses Options */
  var cp = _rfCompat(_rfWithProf(RF.data.ch), RF.data.iso, RF.data.zim), imd = cp.list.filter(function(x){ return x.t !== 'cc'; }).length;
  if(imd) all.push({ lvl:'info', code:'imd', ids:[], msg:'Intermodulation : ' + imd + (cp.more ? '+' : '') + ' conflit' + (imd > 1 ? 's' : '') + ' entre les fréquences actuelles, au niveau de compatibilité de chaque liaison (calcul simplifié). Calculer leur trouve des fréquences compatibles.' });
  return { all:all, by:by };
}

/* ── Fenêtre de dialogue ── */
function _rfModal(title, icon, body, foot, w){
  var prev = document.getElementById('rf-modal'); if(prev) prev.remove();
  RF.onClose = null;
  var m = document.createElement('div');
  m.className = 'modal-ov show'; m.id = 'rf-modal';
  m.onclick = function(e){ if(e.target === m) rfModalClose(); };
  m.innerHTML = '<div class="modal-box" style="width:' + (w || 580) + 'px"><div class="modal-head"><i class="ti ' + icon + '" style="font-size:16px;color:var(--ora)"></i><span class="modal-title">' + _bonE(title) + '</span>' +
    '<button class="btn ghost sm" onclick="rfModalClose()" aria-label="Fermer"><i class="ti ti-x"></i></button></div><div class="modal-body rf-mb">' + body + '</div><div class="modal-foot">' + foot + '</div></div>';
  document.body.appendChild(m);
}
function rfModalClose(){
  var m = document.getElementById('rf-modal'), cb = RF.onClose;
  RF.onClose = null;
  if(m) m.remove();
  if(cb) cb();
}

/* ── Page ── */
function renderRf(){
  var root = document.getElementById('rf-root'); if(!root) return;
  var E = _bonE;
  if(!CUR_SHOW){
    root.innerHTML = '<div class="dt-empty"><i class="ti ti-calendar-event"></i><div class="dt-empty-t">Aucun show ouvert</div><div class="dt-empty-s">Choisissez une session pour préparer ses liaisons HF.</div><button class="btn pri" onclick="goTab(\'sessions\',null)">Voir les sessions</button></div>';
    return;
  }
  _rfLoad(); _rfDropInit(root);
  if(!_RF_CAT) _rfCatLoad().then(function(ok){ var pn = document.getElementById('panel-rf'); if(ok && pn && pn.classList.contains('on') && !document.getElementById('rf-modal') && !(document.activeElement && root.contains(document.activeElement))) renderRf(); });
  if(_rfFollowNames()) _rfSave();
  if(RF.look){ _rfRenderLook(root); return; }
  var d = RF.data, n = d.ch.length;
  var src = d.src ? 'Session « ' + E(d.src.show || d.src.file) + ' » reprise de Wireless Workbench' + (d.src.at ? ' le ' + E(new Date(d.src.at).toLocaleDateString('fr-FR')) : '') + '.' : 'Importez un show Wireless Workbench ou saisissez vos canaux.';
  var h = '<header class="bonp-head"><div><div class="bonp-eyebrow">' + E(CUR_SHOW.name || '') + '</div><h1>RF</h1><p>Les liaisons HF du show : fréquences, utilisateurs, verrouillage. ' + src + '</p></div>' +
    '<div class="rf-act">' +
      '<button class="btn pri" onclick="rfImport()"><i class="ti ti-file-import"></i>Importer un show WWB</button>' +
      '<button class="btn" data-rfmenu="add" onclick="rfTopMenu(this,\'add\')"><i class="ti ti-plus"></i>Ajouter<i class="ti ti-chevron-down rf-chev"></i></button>' +
      (n ? '<button class="btn" data-rfmenu="exp" onclick="rfTopMenu(this,\'exp\')"><i class="ti ti-download"></i>Exporter<i class="ti ti-chevron-down rf-chev"></i></button>' +
           '<button class="btn" onclick="rfLook(true)"><i class="ti ti-eye"></i>Consultation</button>' : '') +
    '</div></header>';
  if(!n){
    h += '<button type="button" class="bonp-empty rf-dropzone" onclick="rfImport()"><i class="ti ti-antenna"></i><b>Importer un show Wireless Workbench</b>' +
      '<span>Déposez un fichier .shw ici, ou cliquez pour le choisir. PatchFlow reprend les appareils, les canaux, les fréquences, les zones et les exclusions de la session.</span></button>' +
      '<p class="rf-note" style="text-align:center;margin-top:14px">Pas de session ? <button type="button" class="ov-link" onclick="rfGear()">Ajouter du matériel du catalogue</button> ou <button type="button" class="ov-link" onclick="rfAdd()">créer un canal à la main</button></p>';
    root.innerHTML = h; return;
  }
  var zs = _rfZones();
  var opt = function(v, l, cur){ return '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(l) + '</option>'; };
  h += '<div class="bonp-tiles" id="rf-tiles"></div><section class="rf-card" id="rf-spec"></section><div id="rf-quick"></div>';
  h += '<div class="rf-bar">' +
    '<label class="rf-search"><i class="ti ti-search"></i><input id="rf-q" type="search" placeholder="Nom, artiste, fréquence…" value="' + E(RF.q) + '" oninput="rfSearch(this.value)" autocomplete="off"/></label>' +
    '<div class="rf-seg">' + [['', 'Tous'], ['mic', 'Micros'], ['iem', 'IEM']].map(function(k){ return '<button type="button" class="' + (RF.fk === k[0] ? 'on' : '') + '" onclick="rfFilter(\'fk\',\'' + k[0] + '\')">' + k[1] + '</button>'; }).join('') + '</div>' +
    (zs.length > 1 ? '<select class="rf-sel" onchange="rfFilter(\'fz\',this.value)" aria-label="Zone">' + opt('', 'Toutes les zones', RF.fz) + zs.map(function(z){ return opt(z, z, RF.fz); }).join('') + '</select>' : '') +
    '<select class="rf-sel" onchange="rfFilter(\'fs\',this.value)" aria-label="Verrou">' + opt('', 'Verrouillées ou non', RF.fs) + opt('lk', 'Verrouillées', RF.fs) + opt('free', 'Libres', RF.fs) + '</select>' +
    '<select class="rf-sel" onchange="rfSort(this.value)" aria-label="Tri">' + [['zone', 'Tri : zone'], ['f', 'Tri : fréquence'], ['n', 'Tri : nom'], ['who', 'Tri : utilisateur'], ['st', 'Tri : verrou']].map(function(s){ return opt(s[0], s[1], RF.sort); }).join('') + '</select>' +
    '<span class="rf-grow"></span>' +
    '<button class="btn sm" onclick="rfAutoLink()" title="Proposer les liens entre liaisons et lignes de l\'input list portant le même nom"><i class="ti ti-link"></i>Associer à l\'input list</button>' +
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
  var ok = d.ch.filter(function(c){ return c.lk; }).length, pb = 0;
  var errs = al.all.filter(function(a){ return a.lvl === 'err'; }).length, warns = al.all.filter(function(a){ return a.lvl === 'warn'; }).length;
  var tile = function(cls, icon, l, b, s, act){ var tg = act ? 'button type="button" onclick="' + act + '"' : 'div'; return '<' + tg + ' class="bonp-tile rf-tile ' + cls + (act ? ' act' : '') + '"><i class="ti ' + icon + '"></i><span class="bonp-tile-l">' + l + '</span><b>' + b + '</b><span class="bonp-tile-s">' + s + '</span></' + (act ? 'button' : 'div') + '>'; };
  var t = document.getElementById('rf-tiles');
  if(t) t.innerHTML =
    tile('', 'ti-antenna', 'Canaux', d.ch.length, mics + ' micro' + (mics > 1 ? 's' : '') + ' · ' + iem + ' IEM' + (d.ch.length - mics - iem ? ' · ' + (d.ch.length - mics - iem) + ' autre' : '')) +
    tile('', 'ti-map-pin', 'Zones', zs.length || '—', E(zs.slice(0, 3).join(' · ') + (zs.length > 3 ? '…' : '')) || 'aucune zone') +
    tile(ok === d.ch.length ? 'ok' : '', 'ti-lock', 'Verrouillées', ok + '<small> / ' + d.ch.length + '</small>', ok === d.ch.length ? 'toutes les fréquences sont figées' : (d.ch.length - ok) + ' libre' + (d.ch.length - ok > 1 ? 's' : '') + ' pour le calcul') +
    tile(errs ? 'bad' : (warns ? '' : 'ok'), 'ti-alert-triangle', 'Alertes', errs + warns, errs + warns ? errs + ' bloquante' + (errs > 1 ? 's' : '') + ' · ' + warns + ' à vérifier' : (al.all.length ? al.all.length + ' remarque' + (al.all.length > 1 ? 's' : '') : 'aucune'), al.all.length ? 'rfAlerts()' : '');

  var sp = document.getElementById('rf-spec');
  if(sp){
    var svg = _rfSpecSvg(d, al, zs, Math.max(300, sp.clientWidth - 32));
    var cnt = {}; d.ch.forEach(function(c){ cnt[c.zone] = (cnt[c.zone] || 0) + 1; });
    sp.style.display = '';
    sp.innerHTML = !svg ? '<h3>Spectre</h3>' + _rfScanBar() : '<h3>Spectre <small>fréquences du show, de la plus basse à la plus haute</small></h3>' + svg + _rfScanBar() +
      '<div class="rf-leg">' + zs.map(function(z){ return '<button type="button" class="' + (RF.fz === z ? 'on' : '') + '" data-z="' + E(z) + '" onclick="rfFilter(\'fz\',RF.fz===this.dataset.z?\'\':this.dataset.z)"><i style="background:' + _rfHue(z, zs) + '"></i>' + E(z) + ' <em>' + (cnt[z] || 0) + '</em></button>'; }).join('') +
      '<span class="rf-leg-k"><i class="k-mic"></i>micro <i class="k-iem"></i>IEM' + (d.spare.length ? ' <i class="k-sp"></i>réserve' : '') + (_rfAvoid(d).ban.length ? ' <i class="k-ex"></i>à éviter' : '') + (d.scan ? ' <i class="k-sc"></i>scan' : '') + '</span></div>';
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
  var on = d.ch.filter(function(c){ return c.f > 0; }), sc = d.scan, su = sc ? _rfScanData(sc) : null;
  if(!on.length && !su) return '';
  var E = _bonE, fs = on.map(function(c){ return c.f; }).concat(d.spare.map(function(s){ return s.f; }));
  if(!fs.length) fs = [sc.a, sc.b];
  var min = Math.min.apply(null, fs), max = Math.max.apply(null, fs), pad = Math.max(2000, (max - min) * 0.04);
  var lo = Math.floor((min - pad) / 1000) * 1000, hi = Math.ceil((max + pad) / 1000) * 1000, H = 0, AX = 80;
  var x = function(f){ return Math.round((f - lo) / (hi - lo) * W * 10) / 10; };
  var step = 1000; [1, 2, 4, 8, 10, 20, 40, 50, 100, 200, 500].some(function(s){ step = s * 1000; return (hi - lo) / step <= Math.max(4, W / 70); });
  var g = '';
  if(su){                               /* tracé du scan : crête par pixel ; l'échelle va du bruit de fond au plus fort niveau visible */
    var path = '', cols = Math.max(50, Math.round(W)), base = AX, topY = 14, c, lastY = null, vmin = 255, vmax = 0;
    for(c = Math.max(0, Math.floor((lo - sc.a) / _RF_SCAN_STEP)); c <= Math.min(su.length - 1, Math.ceil((hi - sc.a) / _RF_SCAN_STEP)); c++){ if(su[c]){ if(su[c] < vmin) vmin = su[c]; if(su[c] > vmax) vmax = su[c]; } }
    var dbLo = (vmax ? _rfScanDb(vmin) : -110) - 2, dbHi = Math.max(vmax ? _rfScanDb(vmax) : -40, sc.th) + 6, dbR = Math.max(12, dbHi - dbLo);
    for(c = 0; c <= cols; c++){
      var f0 = lo + (hi - lo) * c / cols, f1 = lo + (hi - lo) * (c + 1) / cols, i0 = Math.max(0, Math.floor((f0 - sc.a) / _RF_SCAN_STEP)), i1 = Math.min(su.length - 1, Math.ceil((f1 - sc.a) / _RF_SCAN_STEP)), mv = 0;
      for(var q = i0; q <= i1; q++) if(su[q] > mv) mv = su[q];
      if(i1 < i0 || !mv){ if(lastY !== null){ path += 'L' + (c * W / cols).toFixed(1) + ' ' + base + 'Z'; lastY = null; } continue; }
      var y = base - Math.max(0, Math.min(1, (_rfScanDb(mv) - dbLo) / dbR)) * (base - topY);
      path += (lastY === null ? 'M' + (c * W / cols).toFixed(1) + ' ' + base + 'L' : 'L') + (c * W / cols).toFixed(1) + ' ' + y.toFixed(1); lastY = y;
    }
    if(lastY !== null) path += 'L' + W + ' ' + base + 'Z';
    var ty = base - Math.max(0, Math.min(1, (sc.th - dbLo) / dbR)) * (base - topY);
    g += '<path class="rf-scp" d="' + path + '"/><line class="rf-sct" x1="0" y1="' + ty.toFixed(1) + '" x2="' + W + '" y2="' + ty.toFixed(1) + '"><title>Seuil ' + sc.th + ' dBm</title></line>';
  }
  _rfAvoid(d).ban.forEach(function(e){ if(e.sc || e.b < lo || e.a > hi) return; var a = x(Math.max(lo, e.a)), b = x(Math.min(hi, e.b)); g += '<rect class="rf-sx" x="' + a + '" y="10" width="' + Math.max(1, b - a) + '" height="' + (AX - 10) + '"><title>À éviter' + (e.l ? ' : ' + E(e.l) : '') + '</title></rect>'; });
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
  var h = dl + '<div class="bonp-scroll"><table class="rf-tbl"><thead><tr><th class="rf-c-lk"><label class="il-ck" title="Sélectionner toute la liste affichée"><input type="checkbox" class="cb" id="rf-ck-all" onclick="rfSelAll(this)" aria-label="Tout sélectionner"/></label></th><th>Nom</th><th>Utilisateur</th><th>Type</th><th>Fréquence</th><th>Bande</th><th>Zone</th><th>Input list</th><th>Note</th><th></th></tr></thead><tbody>';
  var last = null;
  list.forEach(function(c){
    if(RF.sort === 'zone' && c.zone !== last){
      last = c.zone;
      var nz = list.filter(function(x){ return x.zone === c.zone; }).length;
      h += '<tr class="rf-g" data-z="' + E(c.zone) + '"><td colspan="10"><label class="il-ck" title="Sélectionner cette zone"><input type="checkbox" class="cb rf-ck-z" onclick="rfSelZone(this)" aria-label="Sélectionner la zone"/></label><i style="background:' + _rfHue(c.zone, zs) + '"></i>' + E(c.zone || 'Sans zone') + '<em>' + _rfPl(nz) + '</em></td></tr>';
    }
    var r = _rfRange(c), sub = [c.mk && c.mk !== 'Generic' && c.mdl.indexOf(c.mk) < 0 ? c.mk : '', c.mdl, _rfDevLbl(c), c.gc, c.pw ? c.pw + ' mW' : '', c.cm ? (c.cm === 'wwb' ? 'profil du show' : _rfLvlLbl(c.cm)) : '', c.cd ? (c.cd === 'down' ? 'décroissant' : 'croissant') : ''].filter(Boolean).join(' · ');
    h += '<tr class="rf-r" data-id="' + c.id + '">' +
      '<td data-label="Verrou" class="rf-c-lk"><label class="il-ck" title="Sélectionner (Maj + clic : une plage)"><input type="checkbox" class="cb rf-ck" data-id="' + c.id + '" onclick="rfSelToggle(this,event)" aria-label="Sélectionner ce canal"/></label><button type="button" class="rf-lock' + (c.lk ? ' on' : '') + '" onclick="rfLock(this)" title="' + (c.lk ? 'Fréquence verrouillée : le calcul et les imports n\'y touchent pas. Cliquer pour libérer.' : 'Verrouiller cette fréquence') + '" aria-pressed="' + (c.lk ? 'true' : 'false') + '"><i class="ti ' + (c.lk ? 'ti-lock' : 'ti-lock-open') + '"></i></button></td>' +
      '<td data-label="Nom" class="rf-c-n"><input class="rf-in b" value="' + E(c.n) + '" placeholder="Nom du canal" onchange="rfSet(this,\'n\')" maxlength="60"/>' + (sub ? '<small>' + E(sub) + '</small>' : '') + '</td>' +
      '<td data-label="Utilisateur"><input class="rf-in" list="rf-dl-who" value="' + E(c.who) + '" placeholder="Artiste, musicien…" onchange="rfSet(this,\'who\')" maxlength="60"/></td>' +
      '<td data-label="Type"><select class="rf-in" onchange="rfSet(this,\'kind\')">' + _RF_KINDS.map(function(k){ return '<option value="' + k[0] + '"' + (k[0] === _rfKindVal(c) ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></td>' +
      '<td data-label="Fréquence" class="rf-c-f"><input class="rf-in f" value="' + _rfFmt(c.f) + '"' + (c.lk ? ' readonly title="Fréquence verrouillée : libérez-la pour la modifier"' : '') + ' placeholder="MHz" inputmode="decimal" onchange="rfSet(this,\'f\')" maxlength="12"/><button type="button" class="rf-al" onclick="rfWhy(this)" aria-label="Alertes de ce canal"></button></td>' +
      '<td data-label="Bande" class="rf-c-b">' + (c.band ? '<b>' + E(c.band) + '</b>' : '') + '<small>' + (r ? _rfFmt(r[0]) + ' à ' + _rfFmt(r[1]) : (c.band || c.ser ? 'plage inconnue' : '')) + '</small></td>' +
      '<td data-label="Zone"><input class="rf-in" list="rf-dl-zone" value="' + E(c.zone) + '" placeholder="Zone" onchange="rfSet(this,\'zone\')" maxlength="40"/></td>' +
      '<td data-label="Input list"><select class="rf-in rf-lk" onchange="rfLink(this)">' + (c.kind === 'iem' ? lopt(il.outs, c.out, 'OUT ') : lopt(il.chs, c.il, '')) + '</select></td>' +
      '<td data-label="Note"><input class="rf-in" value="' + E(c.note) + '" placeholder="Note de terrain" onchange="rfSet(this,\'note\')" maxlength="200"/></td>' +
      '<td class="rf-c-x"><button type="button" class="rf-ib" onclick="rfDup(this)" title="Dupliquer"><i class="ti ti-copy"></i></button><button type="button" class="rf-ib" onclick="rfDel(this)" title="Supprimer"><i class="ti ti-trash"></i></button></td></tr>';
  });
  box.innerHTML = h + '</tbody></table></div>';
  _rfPaintSide(); _rfSelSync();
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
    if(c.lk){ el.value = _rfFmt(c.f); toast('Fréquence verrouillée : libérez-la pour la modifier.'); return; }
    var k = _rfParseMHz(v);
    if(String(v).trim() && !k){ toast('Fréquence illisible : saisissez-la en MHz, par exemple 606.125'); el.value = _rfFmt(c.f); return; }
    c.f = k; el.value = _rfFmt(k);
    if(_rfMirror(c)) _rfIlRefresh();                 /* la ligne liée suit */
  } else if(field === 'kind'){
    var p = String(v).split(':'), was = c.kind;
    c.kind = p[0] === 'iem' || p[0] === 'oth' ? p[0] : 'mic'; c.tx = c.kind === 'mic' && (p[1] === 'hh' || p[1] === 'bp') ? p[1] : '';
    if((was === 'iem') !== (c.kind === 'iem')){ c.il = ''; c.out = ''; _rfSave(); _rfPaintTable(); return; }   /* la liaison change de liste */
  } else if(field === 'n' || field === 'who' || field === 'zone' || field === 'note'){
    c[field] = _rfStr(v, field === 'note' ? 200 : field === 'zone' ? 40 : 60); el.value = c[field];
    if(field === 'n') c.nl = false;                  /* nom retouché ici : il ne suit plus la ligne */
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
  var n = _rfCleanCh(Object.assign({}, c, { id:_rfId(), src:'', il:'', out:'', lk:false, n:c.n ? c.n + ' (copie)' : '' }));
  RF.data.ch.splice(RF.data.ch.indexOf(c) + 1, 0, n);
  _rfSave(); _rfPaintTable();
}
function rfDel(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  if(!confirm('Supprimer le canal « ' + (c.n || c.dev || 'sans nom') + ' » ?' + (c.il || c.out ? '\nSa ligne dans l\'input list ne sera plus en HF.' : ''))) return;
  var linked = !!(c.il || c.out);
  if(linked) _rfUnlink(c);
  RF.data.ch = RF.data.ch.filter(function(x){ return x !== c; });
  _rfSave(); if(linked) _rfIlRefresh(); renderRf();
}
/* ── Calcul des fréquences depuis la page ──────────────────────────────
   Niveau, sens, puis « Calculer » : pas de fenêtre. Le calcul porte sur les canaux cochés, sinon
   sur la liste affichée ; les fréquences verrouillées et celles hors périmètre sont gardées et
   protégées. « Annuler » revient à l'état d'avant. Canaux TV, inclusions et exclusions restent
   dans Options. */
function _rfQuickScope(){
  var sel = _rfSelIds(), ids = {}, list;
  if(sel.length){ sel.forEach(function(id){ ids[id] = 1; }); list = sel.map(_rfGet).filter(Boolean); }
  else { list = _rfVisible(); list.forEach(function(c){ ids[c.id] = 1; }); }
  return { ids:ids, list:list, sel:sel.length > 0 };
}
/* Champ « à partir de », dans la bande Fréquences et dans Options */
function _rfFromField(){
  var co = RF.data.coord;
  return '<label class="rf-from" title="Les fréquences se placent à partir de celle-ci (vers le haut ou vers le bas selon le sens), pas depuis le bord de la bande. Hors de la bande d\'un appareil, c\'est son bord de bande. S\'il manque de la place, la suite repart du bord de bande."><span>à partir de</span>' +
    '<input class="rf-co-in s" inputmode="decimal" placeholder="bord de bande" value="' + (co.from ? _rfFmt(co.from) : '') + '" onchange="rfQuickFrom(this.value)" aria-label="Fréquence de départ en MHz"/><span>MHz</span></label>';
}
function rfQuickFrom(v){
  var co = RF.data.coord, t = String(v || '').trim();
  if(!t) co.from = 0;
  else {
    var f = _rfParseMHz(t);
    if(!f){ toast('Fréquence illisible : écrivez-la en MHz, par exemple 600.000.'); _rfPaintQuick(); return; }
    co.from = f;
  }
  _rfSave(); _rfPaintQuick();
  if(RF.co && document.getElementById('rf-modal')) _rfCoordModal();
}
function _rfPaintQuick(){
  var box = document.getElementById('rf-quick'); if(!box || !RF.data) return;
  var d = RF.data, co = d.coord, sc = _rfQuickScope(), free = sc.list.filter(function(c){ return !(c.lk && c.f); }).length;
  var same = function(fn){ var v = null, ok = true; sc.list.forEach(function(c){ var x = fn(c); if(v === null) v = x; else if(v !== x) ok = false; }); return ok ? v : ''; };
  var lv = sc.list.length ? same(function(c){ return c.cm || co.mode; }) : co.mode, dr = sc.list.length ? same(function(c){ return c.cd || co.dir; }) : co.dir;
  var seg = function(k, cur, list){ return '<div class="rf-seg">' + list.map(function(x){ return '<button type="button" class="' + (cur === x[0] ? 'on' : '') + '" onclick="rfQuick(\'' + k + '\',\'' + x[0] + '\')" title="' + x[2] + '">' + x[1] + '</button>'; }).join('') + '</div>'; };
  box.className = 'rf-quick';
  box.innerHTML = '<span class="rf-quick-t"><i class="ti ti-wave-sine"></i>Fréquences</span>' +
    seg('mode', lv, [['rob', 'Robuste', 'Écarts les plus larges'], ['std', 'Standard', 'Écarts recommandés'], ['more', 'Plus de fréquences', 'Écarts réduits']]) +
    seg('dir', dr, [['up', '<i class="ti ti-sort-ascending"></i>Croissant', 'Du bas de la bande vers le haut'], ['down', '<i class="ti ti-sort-descending"></i>Décroissant', 'Du haut de la bande vers le bas']]) +
    _rfFromField() +
    '<button type="button" class="btn pri sm" onclick="rfQuickCalc()"' + (free ? '' : ' disabled') + '><i class="ti ti-calculator"></i>Calculer ' + (free ? free + ' fréquence' + (free > 1 ? 's' : '') : '') + '</button>' +
    (RF.calcUndo ? '<button type="button" class="btn sm" onclick="rfQuickUndo()"><i class="ti ti-arrow-back-up"></i>Annuler</button>' : '') +
    '<span class="rf-quick-s">' + (sc.sel ? 'sur les ' + _rfPl(sc.list.length) + ' cochés' : (RF.fk || RF.fz || RF.fs || RF.q ? 'sur la liste affichée' : 'sur tous les canaux')) + (sc.list.length - free ? ' · ' + (sc.list.length - free) + ' verrouillé' + (sc.list.length - free > 1 ? 's' : '') : '') + '</span>' +
    '<span class="rf-grow"></span><button type="button" class="btn sm" onclick="rfCoord()" title="Canaux TV, plages à éviter ou à réserver, aperçu avant d\'appliquer"><i class="ti ti-adjustments"></i>Options</button>';
}
/* Niveau ou sens : pour les canaux cochés s'il y en a, sinon pour toute la liste affichée */
function rfQuick(k, v){
  var d = RF.data, co = d.coord, sc = _rfQuickScope(), f = k === 'mode' ? 'cm' : 'cd';
  var val = k === 'mode' ? _rfLvl(v) : (v === 'down' ? 'down' : 'up');
  if(sc.sel) sc.list.forEach(function(c){ c[f] = val; });
  else {
    sc.list.forEach(function(c){ c[f] = ''; });
    if(sc.list.length === d.ch.length) co[k] = val; else sc.list.forEach(function(c){ c[f] = val; });
  }
  _rfSave(); _rfPaintTable();
}
function rfQuickCalc(){
  var d = RF.data, sc = _rfQuickScope();
  var P = _rfCoPlan(function(c){ return !!sc.ids[c.id]; }), n = 0;
  if(!P.todo){ toast('Rien à calculer : ces fréquences sont verrouillées.'); return; }
  if(!P.res.placed){ toast('Aucune fréquence libre trouvée avec ces réglages : baissez le niveau, ou voyez Options.'); return; }
  /* Un seul point de retour pour une série d'essais : les versions gardées ne sont pas chassées par dix calculs de suite */
  var lbl = 'Avant le calcul des fréquences', last = d.vers[d.vers.length - 1], old = {};
  if(!last || last.label !== lbl) _rfSnapshot(lbl);
  d.ch.forEach(function(c){ var f = P.map[c.id]; if(f){ old[c.id] = c.f || 0; c.f = f; n++; } });
  RF.calcUndo = old;
  _rfSave(); _rfMirrorAll(); renderRf();
  var left = P.after.list.length;
  toast(n + ' fréquence' + (n > 1 ? 's calculées' : ' calculée') + (P.res.missed ? ' · ' + P.res.missed + ' sans place' : '') + (left ? ' · ' + left + (P.after.more ? '+' : '') + ' conflit' + (left > 1 ? 's' : '') + ' restant' + (left > 1 ? 's' : '') : ' · aucun conflit'));
}
/* Rend aux canaux calculés leur fréquence d'avant, sans toucher à ce qui a été modifié depuis */
function rfQuickUndo(){
  var old = RF.calcUndo, n = 0; if(!old) return;
  RF.data.ch.forEach(function(c){ if(old[c.id] !== undefined && !c.lk){ c.f = old[c.id]; n++; } });
  RF.calcUndo = null;
  _rfSave(); _rfMirrorAll(); renderRf();
  toast('Calcul annulé : ' + n + ' fréquence' + (n > 1 ? 's rétablies' : ' rétablie'));
}

/* ── Sélection de plusieurs canaux ─────────────────────────────────────
   Case sur chaque ligne (Maj + clic : une plage), case de zone, case « tout » ;
   une barre d'actions apparaît : verrouiller, libérer, niveau, zone, supprimer. */
function _rfSelIds(){ return Object.keys(RF.sel || {}); }
function _rfSelSync(){
  var bar = document.getElementById('rf-selbar'), pn = document.getElementById('panel-rf'), live = !!(RF.data && pn && pn.classList.contains('on') && !RF.look);
  var have = {}; if(RF.data) RF.data.ch.forEach(function(c){ have[c.id] = 1; });
  Object.keys(RF.sel || {}).forEach(function(id){ if(!have[id]) delete RF.sel[id]; });       /* canaux supprimés ou restaurés autrement */
  var n = _rfSelIds().length;
  document.querySelectorAll('#rf-list .rf-ck').forEach(function(i){ var on = !!RF.sel[i.dataset.id]; i.checked = on; var tr = i.closest('tr'); if(tr) tr.classList.toggle('sel', on); });
  var vis = live ? _rfVisible() : [], all = document.getElementById('rf-ck-all');
  if(all){ var k = vis.filter(function(c){ return RF.sel[c.id]; }).length; all.checked = !!vis.length && k === vis.length; all.indeterminate = k > 0 && k < vis.length; }
  document.querySelectorAll('#rf-list .rf-ck-z').forEach(function(z){
    var g = z.closest('tr').dataset.z, mem = vis.filter(function(c){ return c.zone === g; }), k = mem.filter(function(c){ return RF.sel[c.id]; }).length;
    z.checked = !!mem.length && k === mem.length; z.indeterminate = k > 0 && k < mem.length;
  });
  if(live) _rfPaintQuick();
  if(!live || !n){ if(bar) bar.remove(); return; }
  var E = _bonE, zs = _rfZones(), lk = _rfSelIds().filter(function(id){ var c = _rfGet(id); return c && c.lk; }).length;
  var html = '<b>' + n + '</b><span>sélectionné' + (n > 1 ? 's' : '') + (lk ? ' · ' + lk + ' verrouillé' + (lk > 1 ? 's' : '') : '') + '</span>' +
    '<button type="button" class="btn sm" onclick="rfSelLock(true)"><i class="ti ti-lock"></i>Verrouiller</button>' +
    '<button type="button" class="btn sm" onclick="rfSelLock(false)"><i class="ti ti-lock-open"></i>Libérer</button>' +
    '<select class="rf-sel xs" onchange="rfSelLevel(this)" aria-label="Niveau de compatibilité"><option value="?">Niveau…</option><option value="">Par défaut</option>' + _RF_LVL.map(function(l){ return '<option value="' + l[0] + '">' + l[1] + '</option>'; }).join('') + '</select>' +
    '<select class="rf-sel xs" onchange="rfSelDir(this)" aria-label="Sens du calcul"><option value="?">Sens…</option><option value="">Par défaut</option><option value="up">Croissant</option><option value="down">Décroissant</option></select>' +
    '<select class="rf-sel xs" onchange="rfSelZoneSet(this)" aria-label="Zone"><option value="?">Zone…</option>' + zs.map(function(z){ return '<option value="' + E(z) + '">' + E(z) + '</option>'; }).join('') + '<option value="__none">Sans zone</option><option value="__new">Nouvelle zone…</option></select>' +
    '<button type="button" class="btn sm" onclick="rfSelGear()" title="Attribuer un modèle d\'appareil et une bande à ces canaux"><i class="ti ti-antenna"></i>Matériel</button>' +
    '<button type="button" class="btn sm il-selbar-del" onclick="rfSelDel()"><i class="ti ti-trash"></i>Supprimer</button>' +
    '<button type="button" class="rf-ib on" onclick="rfSelClear()" title="Tout désélectionner" aria-label="Tout désélectionner"><i class="ti ti-x"></i></button>';
  if(!bar){ bar = document.createElement('div'); bar.id = 'rf-selbar'; bar.className = 'il-selbar rf-selbar'; document.body.appendChild(bar); }
  bar.innerHTML = html;
}
function rfSelToggle(el, ev){
  var id = el.dataset.id; if(!id || !RF.data) return;
  var ids = _rfVisible().map(function(c){ return c.id; }), a = ids.indexOf(RF.selLast), b = ids.indexOf(id);
  if(ev && ev.shiftKey && a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function(i){ if(el.checked) RF.sel[i] = 1; else delete RF.sel[i]; });
  else if(el.checked) RF.sel[id] = 1; else delete RF.sel[id];
  RF.selLast = id; _rfSelSync();
}
function rfSelAll(el){ _rfVisible().forEach(function(c){ if(el.checked) RF.sel[c.id] = 1; else delete RF.sel[c.id]; }); _rfSelSync(); }
function rfSelZone(el){
  var tr = el.closest('tr'), g = tr ? tr.dataset.z : '';
  _rfVisible().forEach(function(c){ if(c.zone === g){ if(el.checked) RF.sel[c.id] = 1; else delete RF.sel[c.id]; } });
  _rfSelSync();
}
function rfSelClear(){ RF.sel = {}; RF.selLast = ''; _rfSelSync(); }
function _rfSelList(){ return _rfSelIds().map(_rfGet).filter(Boolean); }
function rfSelLock(on){
  var list = _rfSelList(), n = 0, none = 0;
  list.forEach(function(c){ if(on && !c.f){ none++; return; } if(!!c.lk !== !!on){ c.lk = !!on; n++; } });
  _rfSave(); renderRf(); _rfSelSync();
  toast(n ? n + ' fréquence' + (n > 1 ? 's ' : ' ') + (on ? 'verrouillée' : 'libérée') + (n > 1 ? 's' : '') + (none ? ' · ' + none + ' sans fréquence ignoré' + (none > 1 ? 's' : '') : '')
          : (none ? 'Pas de fréquence à verrouiller sur ' + (none > 1 ? 'ces canaux.' : 'ce canal.') : 'Rien à changer.'));
}
function rfSelLevel(el){
  var v = el.value; el.value = '?'; if(v === '?') return;
  var list = _rfSelList(); list.forEach(function(c){ c.cm = (v === 'rob' || v === 'std' || v === 'more') ? v : ''; });
  _rfSave(); renderRf(); _rfSelSync();
  toast('Niveau ' + (v ? _rfLvlLbl(v) : 'par défaut') + ' pour ' + _rfPl(list.length));
}
function rfSelDir(el){
  var v = el.value; el.value = '?'; if(v === '?') return;
  var list = _rfSelList(); list.forEach(function(c){ c.cd = (v === 'up' || v === 'down') ? v : ''; });
  _rfSave(); renderRf(); _rfSelSync();
  toast('Sens ' + (v === 'down' ? 'décroissant' : v === 'up' ? 'croissant' : 'par défaut') + ' pour ' + _rfPl(list.length));
}
/* Attribuer du matériel du catalogue aux canaux cochés (lignes venues de l'input list, canaux saisis à la main…) */
function rfSelGear(){
  /* Ordre de rangement dans les appareils : celui de l'input list, puis des sorties, pour les canaux qui y sont liés
     (ligne 1 = canal 1 du premier récepteur) ; les autres suivent, dans l'ordre du tableau. */
  var il = _rfIl(), pos = {}, order = {};
  il.chs.forEach(function(r, i){ pos['il:' + r.id] = i; }); il.outs.forEach(function(r, i){ pos['out:' + r.id] = 10000 + i; });
  _rfSorted().forEach(function(c, i){ var k = c.il ? pos['il:' + c.il] : c.out ? pos['out:' + c.out] : undefined; order[c.id] = k === undefined ? 20000 + i : k; });
  var ids = _rfSelIds().filter(function(id){ return order[id] !== undefined; }).sort(function(a, b){ return order[a] - order[b]; });
  if(!ids.length) return;
  rfGear(ids);
}
function rfSelZoneSet(el){
  var v = el.value; el.value = '?'; if(v === '?') return;
  var z = v === '__none' ? '' : v;
  if(v === '__new'){ z = _rfStr(prompt('Nom de la nouvelle zone :') || '', 40); if(!z) return; if(RF.data.zones.indexOf(z) < 0) RF.data.zones.push(z); }
  var list = _rfSelList(); list.forEach(function(c){ c.zone = z; });
  _rfSave(); renderRf(); _rfSelSync();
  toast(_rfPl(list.length) + ' déplacé' + (list.length > 1 ? 's' : '') + ' vers ' + (z ? '« ' + z + ' »' : 'aucune zone'));
}
function rfSelDel(){
  var list = _rfSelList(), n = list.length; if(!n) return;
  var linked = list.filter(function(c){ return c.il || c.out; }).length, locked = list.filter(function(c){ return c.lk; }).length;
  if(!confirm((n === RF.data.ch.length ? 'Supprimer les ' + n + ' canaux de l\'onglet RF ?' : 'Supprimer ' + _rfPl(n) + ' ?') + (locked ? '\n' + locked + ' ont une fréquence verrouillée.' : '') + (linked ? '\n' + linked + (linked > 1 ? ' lignes de l\'input list ne seront plus en HF.' : ' ligne de l\'input list ne sera plus en HF.') : ''))) return;
  list.forEach(function(c){ if(c.il || c.out) _rfUnlink(c); });
  var del = {}; list.forEach(function(c){ del[c.id] = 1; });
  RF.data.ch = RF.data.ch.filter(function(c){ return !del[c.id]; });
  RF.sel = {}; RF.selLast = '';
  _rfSave(); if(linked) _rfIlRefresh(); renderRf(); _rfSelSync();
  toast(_rfPl(n) + ' supprimé' + (n > 1 ? 's' : ''));
}
/* Verrou : une fréquence verrouillée n'est plus touchée par le calcul ni par un import, et ne se modifie plus à la main */
function rfLock(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  if(!c.lk && !c.f){ toast('Pas de fréquence à verrouiller sur ce canal.'); return; }
  c.lk = !c.lk;
  _rfSave(); if(RF.look) _rfPaintLook(); else _rfPaintTable();
}
/* Liste des alertes, ouverte depuis la tuile « Alertes » */
function rfAlerts(){
  var al = _rfAlerts(), E = _bonE, ico = { err:'ti-alert-triangle', warn:'ti-alert-circle', info:'ti-info-circle' };
  if(!al.all.length){ toast('Aucune alerte.'); return; }
  _rfModal('Alertes', 'ti-alert-triangle',
    '<div class="rf-all">' + al.all.map(function(a){
      var act = a.code === 'imd' ? 'rfModalClose()' : a.code === 'ilhf' ? 'rfFromIl()' : a.code === 'ilf' ? 'rfModalClose();rfMirrorFix()' : a.ids.length ? 'rfModalClose();rfFocus(this.dataset.go)' : '';
      return '<button type="button" class="rf-alr ' + a.lvl + '"' + (a.ids.length ? ' data-go="' + a.ids[0] + '"' : '') + (act ? ' onclick="' + act + '"' : ' disabled') + '><i class="ti ' + ico[a.lvl] + '"></i><span>' + E(a.msg) + '</span></button>'; }).join('') + '</div>' +
    '<p class="rf-note">Doublons, écart entre porteuses, plage d\'accord, plages à éviter et intermodulation, au niveau de compatibilité de chaque liaison. Calcul simplifié : il se valide par un scan sur place.</p>',
    '<button class="btn pri sm" onclick="rfModalClose()">Fermer</button>', 620);
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

/* ── Liaison avec l'input list et les sorties ─────────────────────────
   Une ligne d'entrée ou de sortie « en HF » est une ligne liée à une liaison
   de l'onglet RF. Le lien est porté par la liaison (c.il ou c.out) : il se
   pose aussi bien depuis l'onglet RF que depuis la ligne elle-même.
   Une fois liées, la ligne suit la liaison : sa case « Fréq. HF » reprend la
   fréquence de la liaison à chaque changement, et la modifier dans la ligne
   modifie la liaison. Poser un lien qui remplacerait une fréquence déjà
   saisie demande confirmation. */
function _rfWriteHf(out, id, val){
  if(out){ if(typeof updateOutField === 'function') updateOutField(id, 'hf', val); }
  else if(typeof saveCustomCell === 'function') saveCustomCell(id, '_hf', val);
}
function _rfIlRefresh(){
  try { if(typeof renderTable === 'function') renderTable(); } catch(e){}
  try { if(typeof renderOutTable === 'function') renderOutTable(); } catch(e){}
}
function _rfRow(kind, id){
  var il = _rfIl(), list = kind === 'out' ? il.outs : il.chs;
  return list.filter(function(r){ return r.id === String(id); })[0] || null;
}
function _rfLinked(kind, id){ return (RF.data ? RF.data.ch : []).filter(function(c){ return c[kind] === String(id); })[0] || null; }
/* Recopie la fréquence d'une liaison dans sa ligne. Vrai si la ligne a changé. */
function _rfMirror(c){
  if(!c || !(c.il || c.out)) return false;
  var kind = c.il ? 'il' : 'out', row = _rfRow(kind, c[kind]);
  if(!row) return false;
  var cur = String(row.hf || '').trim(), want = _rfFmt(c.f);
  if(cur === want || (c.f && _rfParseMHz(cur) === c.f)) return false;
  _rfWriteHf(kind === 'out', row.id, want);
  return true;
}
function _rfMirrorAll(){
  var n = 0;
  RF.data.ch.forEach(function(c){ if(_rfMirror(c)) n++; });
  if(n) _rfIlRefresh();
  return n;
}
function rfMirrorFix(){
  var n = _rfMirrorAll();
  renderRf();
  toast(n ? n + ' ligne' + (n > 1 ? 's alignées' : ' alignée') + ' sur sa liaison HF' : 'Les lignes liées sont déjà à jour.');
}
/* Les liaisons créées depuis une ligne portent son nom tant qu'il n'a pas été retouché dans l'onglet RF */
function _rfFollowNames(){
  var changed = false;
  RF.data.ch.forEach(function(c){
    if(!c.nl || !(c.il || c.out)) return;
    var row = _rfRow(c.il ? 'il' : 'out', c.il || c.out), n = row ? _rfStr(row.long || row.name, 60) : '';
    if(n && n !== c.n){ c.n = n; changed = true; }
  });
  return changed;
}
function _rfLinkGate(){
  if(typeof canDo === 'function' && !canDo('rf_link')){ if(typeof showUpgradeModal === 'function') showUpgradeModal('rf_link'); return false; }
  return true;
}
/* Pose le lien entre une liaison et une ligne. force : ne pas demander confirmation. */
function _rfDoLink(c, kind, rowId, force){
  var row = _rfRow(kind, rowId); if(!c || !row) return false;
  var cur = String(row.hf || '').trim(), curK = _rfParseMHz(cur);
  if(!force && c.f && cur && curK !== c.f &&
     !confirm('Cette ligne affiche « ' + cur + ' » et la liaison est sur ' + _rfFmt(c.f) + ' MHz.\nUne fois liée, la ligne suit la liaison : elle passera à ' + _rfFmt(c.f) + '.\n\nContinuer ?')) return false;
  RF.data.ch.forEach(function(x){ if(x !== c && x[kind] === row.id) x[kind] = ''; });      /* une ligne = une seule liaison */
  c.il = ''; c.out = ''; c[kind] = row.id;
  if(!c.f && curK) c.f = curK;                    /* liaison sans fréquence : elle reprend celle de la ligne */
  _rfSave(); _rfMirror(c);
  return true;
}
/* Défaire le lien : la ligne n'est plus en HF, sa case « Fréq. HF » (qui recopiait la liaison) est vidée */
function _rfUnlink(c){
  if(!c) return;
  var kind = c.il ? 'il' : c.out ? 'out' : '', row = kind ? _rfRow(kind, c[kind]) : null;
  if(row && String(row.hf || '').trim()) _rfWriteHf(kind === 'out', row.id, '');
  c.il = ''; c.out = ''; c.nl = false; _rfSave();
}
/* Nouvelle liaison à partir d'une ligne : « cette entrée est en HF » */
function _rfNewFromRow(kind, rowId){
  var row = _rfRow(kind, rowId); if(!row) return null;
  if(RF.data.ch.length >= _RF_MAX_CH){ toast('Limite de ' + _RF_MAX_CH + ' canaux atteinte.'); return null; }
  var c = _rfCleanCh({ id:_rfId(), n:row.long || row.name || '', kind:kind === 'out' ? 'iem' : 'mic', f:_rfParseMHz(row.hf), nl:true });
  c[kind] = row.id;
  RF.data.ch.push(c);
  _rfSave(); _rfMirror(c);
  return c;
}
/* Onglet RF : colonne « Input list » */
function rfLink(el){
  var c = _rfGet(_rfRowId(el)); if(!c) return;
  var kind = c.kind === 'iem' ? 'out' : 'il', v = String(el.value || '');
  if(!_rfLinkGate()){ el.value = c[kind]; return; }
  if(!v) _rfUnlink(c);
  else if(!_rfDoLink(c, kind, v)){ el.value = c[kind]; return; }
  _rfIlRefresh(); renderRf();
}
function rfAutoLink(){
  if(!_rfLinkGate()) return;
  var props = _rfMatchIl(RF.data.ch, _rfIl()), E = _bonE;
  if(!props.length){ toast('Aucune correspondance sûre par nom. Liez les lignes à la main, ici ou depuis l\'input list.'); return; }
  RF.pend = { link:props };
  _rfModal('Associer à l\'input list', 'ti-link',
    '<p class="rf-note">Liaisons et lignes portant le même nom. Décochez ce qui ne convient pas. Une ligne liée affiche ensuite la fréquence de sa liaison.</p><div class="rf-chk">' +
    props.map(function(p, i){ return '<label><input type="checkbox" class="cb" data-i="' + i + '" checked/><span><b>' + E(p.c.who || p.c.n) + '</b> ' + _rfFmt(p.c.f) + '</span><i class="ti ti-arrow-right"></i><span>' + (p.out ? 'Sortie ' : 'Entrée ') + E(p.r.ch + ' · ' + p.r.name) + (String(p.r.hf || '').trim() && _rfParseMHz(p.r.hf) !== p.c.f ? ' <s>' + E(p.r.hf) + '</s>' : '') + '</span></label>'; }).join('') + '</div>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Annuler</button><button class="btn pri sm" onclick="rfAutoLinkApply()"><i class="ti ti-link"></i>Associer</button>');
}
function rfAutoLinkApply(){
  var props = (RF.pend && RF.pend.link) || [], n = 0;
  document.querySelectorAll('#rf-modal .rf-chk input:checked').forEach(function(cb){
    var p = props[+cb.dataset.i], c = p && _rfGet(p.id);
    if(c && _rfDoLink(c, p.out ? 'out' : 'il', p.to, true)) n++;
  });
  RF.pend = null; rfModalClose();
  if(n){ _rfIlRefresh(); renderRf(); toast(_rfPl(n) + (n > 1 ? ' liés' : ' lié') + ' à l\'input list'); }
}
/* Onglet RF : créer d'un coup les liaisons des lignes qui ont l'air d'être en HF */
function _rfOrphans(){
  var il = _rfIl(), used = {};
  RF.data.ch.forEach(function(c){ if(c.il) used[c.il] = 1; });
  return il.chs.filter(function(r){ return !used[r.id] && _rfIsHfRow(r); });
}
function rfFromIl(){
  if(!_rfLinkGate()) return;
  var rows = _rfOrphans(), E = _bonE;
  if(!rows.length){ toast('Toutes les lignes HF de l\'input list ont déjà leur liaison.'); return; }
  RF.pend = { rows:rows };
  _rfModal('Liaisons HF de l\'input list', 'ti-antenna',
    '<p class="rf-note">Ces entrées ont l\'air d\'être en HF (micro sans fil ou fréquence saisie) et n\'ont pas de liaison dans l\'onglet RF. Cochez celles à créer.</p><div class="rf-chk">' +
    rows.map(function(r, i){ return '<label><input type="checkbox" class="cb" data-i="' + i + '" checked/><span>Entrée <b>' + E(r.ch + ' · ' + (r.long || r.name)) + '</b></span><span class="rf-chg">' + E(r.mic || '') + (String(r.hf || '').trim() ? ' <b>' + E(r.hf) + '</b>' : '') + '</span></label>'; }).join('') + '</div>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Annuler</button><button class="btn pri sm" onclick="rfFromIlApply()"><i class="ti ti-plus"></i>Créer les liaisons</button>');
}
function rfFromIlApply(){
  var rows = (RF.pend && RF.pend.rows) || [], n = 0;
  document.querySelectorAll('#rf-modal .rf-chk input:checked').forEach(function(cb){ var r = rows[+cb.dataset.i]; if(r && _rfNewFromRow('il', r.id)) n++; });
  RF.pend = null; rfModalClose();
  if(n){ _rfIlRefresh(); renderRf(); toast(n + ' liaison' + (n > 1 ? 's HF créées' : ' HF créée')); }
}

/* ── Depuis l'input list et les sorties ── */
/* Bouton HF d'une ligne (appelé par pf-app.js en dessinant les tableaux). r : la ligne. */
function _rfIlBtn(kind, r){
  if(!CUR_SHOW || !r) return '';
  _rfLoad();
  var E = _bonE, id = String(r.id), c = _rfLinked(kind, id);
  var hint = !c && kind === 'il' && _rfIsHfRow({ mic:r.mic, name:r.short_name, hf:r.custom_data && r.custom_data._hf });
  var title = c ? 'Liaison HF : ' + (c.n || c.dev || 'sans nom') + (c.f ? ' · ' + _rfFmt(c.f) + ' MHz' : '') : (kind === 'out' ? 'Sortie en HF : la lier à une liaison de l\'onglet RF' : 'Entrée en HF : la lier à une liaison de l\'onglet RF');
  return '<button type="button" class="rf-hf' + (c ? ' on' : hint ? ' hint' : '') + '" data-rf="' + kind + '" data-id="' + E(id) + '" onclick="rfRowMenu(this)" title="' + E(title) + '" aria-label="' + E(title) + '"><i class="ti ti-antenna"></i></button>';
}
function rfPopClose(){
  var p = document.getElementById('rf-pop'); if(p) p.remove();
  document.removeEventListener('mousedown', _rfPopOut, true);
  document.removeEventListener('keydown', _rfPopKey, true);
  window.removeEventListener('scroll', _rfPopScroll, true);
  window.removeEventListener('resize', rfPopClose);
}
/* Le menu est posé à côté du bouton : il se ferme dès que la page défile sous lui */
function _rfPopScroll(e){ var p = document.getElementById('rf-pop'); if(p && !p.contains(e.target)) rfPopClose(); }
function _rfPopOut(e){ var p = document.getElementById('rf-pop'); if(p && !p.contains(e.target) && !(e.target.closest && e.target.closest('.rf-hf,[data-rfmenu]'))) rfPopClose(); }
function _rfPopKey(e){ if(e.key === 'Escape'){ e.stopPropagation(); rfPopClose(); } }
/* Menus « Ajouter » et « Exporter » de l'en-tête */
var _RF_TOP = {
  add:[['gear', 'ti-antenna', 'Matériel du catalogue', 'Récepteurs et émetteurs Shure ou Sennheiser, avec leur bande'],
       ['new', 'ti-plus', 'Canal vide', 'À remplir à la main']],
  exp:[['wwb', 'ti-file-export', 'Show Wireless Workbench', 'Remet les fréquences dans le .shw d\'origine'],
       ['lists', 'ti-file-zip', 'Listes de fréquences', 'Une par série, bande et zone, pour Workbench'],
       ['csv', 'ti-file-spreadsheet', 'Tableau CSV', 'Pour Excel ou Sheets'],
       ['pdf', 'ti-file-type-pdf', 'Feuille RF en PDF', 'Fréquences par zone, à imprimer']]
};
function rfTopMenu(el, kind){
  if(!CUR_SHOW || !el || !_RF_TOP[kind]) return;
  var open = document.getElementById('rf-pop');
  if(open && open.dataset.rf === 'top' && open.dataset.id === kind){ rfPopClose(); return; }
  rfPopClose(); _rfLoad();
  var E = _bonE, p = document.createElement('div');
  p.id = 'rf-pop'; p.className = 'rf-pop rf-top'; p.dataset.rf = 'top'; p.dataset.id = kind;
  p.innerHTML = _RF_TOP[kind].map(function(i){ return '<button type="button" data-act="' + i[0] + '"><i class="ti ' + i[1] + '"></i><span>' + E(i[2]) + '<small>' + E(i[3]) + '</small></span></button>'; }).join('');
  p.onclick = function(e){
    var b = e.target.closest ? e.target.closest('button[data-act]') : null; if(!b) return;
    var a = b.dataset.act; rfPopClose();
    if(a === 'gear') rfGear(); else if(a === 'new') rfAdd(); else if(a === 'wwb') rfWwb();
    else if(a === 'lists') rfWwbLists(); else if(a === 'csv') rfCsv(); else if(a === 'pdf') rfPdf();
  };
  document.body.appendChild(p);
  var r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  p.style.left = Math.max(8, Math.min(r.left, W - p.offsetWidth - 8)) + 'px';
  p.style.top = (r.bottom + 6 + p.offsetHeight > H - 8 ? Math.max(8, r.top - p.offsetHeight - 6) : r.bottom + 6) + 'px';
  document.addEventListener('mousedown', _rfPopOut, true);
  document.addEventListener('keydown', _rfPopKey, true);
  window.addEventListener('scroll', _rfPopScroll, true);
  window.addEventListener('resize', rfPopClose);
}
function rfRowMenu(el){
  if(!CUR_SHOW || !el) return;
  var open = document.getElementById('rf-pop'), kind = el.dataset.rf === 'out' ? 'out' : 'il', id = String(el.dataset.id || '');
  if(open && open.dataset.id === id && open.dataset.rf === kind){ rfPopClose(); return; }
  rfPopClose(); _rfLoad();
  var E = _bonE, c = _rfLinked(kind, id), h = '';
  var item = function(act, icon, label, extra){ return '<button type="button" data-act="' + act + '"' + (extra || '') + '><i class="ti ' + icon + '"></i><span>' + label + '</span></button>'; };
  if(c){
    h = '<div class="rf-pop-h"><i class="ti ti-antenna"></i><div><b>' + E(c.n || c.dev || 'Liaison HF') + '</b><span>' + (c.f ? _rfFmt(c.f) + ' MHz' : 'sans fréquence') + E([c.mdl, c.zone].filter(Boolean).map(function(x){ return ' · ' + x; }).join('')) + '</span></div></div>' +
      item('see', 'ti-arrow-right', 'Voir dans l\'onglet RF') + item('unlink', 'ti-unlink', 'Ce n\'est plus une ligne HF (délier)');
  } else {
    var free = RF.data.ch.filter(function(x){ return !x.il && !x.out && (kind === 'out' ? x.kind !== 'mic' : x.kind !== 'iem'); });
    h = '<div class="rf-pop-t">' + (kind === 'out' ? 'Sortie en HF' : 'Entrée en HF') + '</div>' + item('new', 'ti-plus', 'Créer sa liaison dans l\'onglet RF');
    if(free.length) h += '<div class="rf-pop-t">Ou la lier à une liaison existante</div><div class="rf-pop-l">' +
      free.map(function(x){ return '<button type="button" data-act="link" data-c="' + x.id + '"><b>' + E(x.n || x.dev || 'Sans nom') + '</b><span>' + (x.f ? _rfFmt(x.f) : '—') + E(x.mdl ? ' · ' + x.mdl : '') + '</span></button>'; }).join('') + '</div>';
  }
  var p = document.createElement('div');
  p.id = 'rf-pop'; p.className = 'rf-pop'; p.dataset.rf = kind; p.dataset.id = id; p.innerHTML = h;
  p.onclick = function(e){ var b = e.target.closest ? e.target.closest('button[data-act]') : null; if(b) rfRowAct(b.dataset.act, kind, id, b.dataset.c || ''); };
  document.body.appendChild(p);
  var r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  p.style.left = Math.max(8, Math.min(r.left, W - p.offsetWidth - 8)) + 'px';
  p.style.top = (r.bottom + 6 + p.offsetHeight > H - 8 ? Math.max(8, r.top - p.offsetHeight - 6) : r.bottom + 6) + 'px';
  document.addEventListener('mousedown', _rfPopOut, true);
  document.addEventListener('keydown', _rfPopKey, true);
  window.addEventListener('scroll', _rfPopScroll, true);
  window.addEventListener('resize', rfPopClose);
}
function rfRowAct(act, kind, id, cid){
  rfPopClose(); _rfLoad();
  var c = _rfLinked(kind, id);
  if(act === 'see'){ if(c){ goTab('rf', null); rfFocus(c.id); } return; }
  if(act === 'unlink'){ if(c){ _rfUnlink(c); toast('Ligne déliée. La liaison reste dans l\'onglet RF.'); } }
  else {
    if(!_rfLinkGate()) return;
    if(act === 'new'){ if(_rfNewFromRow(kind, id)) toast('Liaison HF créée : elle est dans l\'onglet RF.'); }
    else if(act === 'link'){ if(!_rfDoLink(_rfGet(cid), kind, id)) return; toast('Ligne liée à sa liaison HF.'); }
    else return;
  }
  _rfIlRefresh();
  var on = document.getElementById('panel-rf'); if(on && on.classList.contains('on')) renderRf();
}
/* Case « Fréq. HF » d'une ligne modifiée à la main. Vrai si la ligne est liée : la liaison est alors
   mise à jour, et c'est elle qui fait foi. */
function rfIlFreq(kind, id, el){
  if(!CUR_SHOW) return false;
  _rfLoad();
  var c = _rfLinked(kind, id); if(!c) return false;
  var v = String(el.value || '').trim(), k = v ? _rfParseMHz(v) : 0;
  if(c.lk){ el.value = _rfFmt(c.f); toast('Fréquence verrouillée dans l\'onglet RF : libérez-la pour la modifier.'); return true; }
  if(v && !k){ toast('Fréquence illisible : saisissez-la en MHz, par exemple 606.125'); el.value = _rfFmt(c.f); return true; }
  c.f = k; el.value = _rfFmt(k);
  _rfWriteHf(kind === 'out', String(id), _rfFmt(k));
  _rfSave();
  return true;
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
  i.type = 'file';     /* pas d'attribut accept : iOS et Android grisent les .shw, extension qu'ils ne connaissent pas */
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
      '<p class="rf-note">Utilisateurs, types d\'émetteur, états, notes et liaisons sont conservés.</p></div>';
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
  d.iso = p.iso; d.zim = p.zim; d.excl = p.excl; d.spare = p.spare;
  if(!d.coord.tv.length) d.coord.tvw = p.tvw === 6 ? 6 : 8;
  d.src = { file:_rfStr(P.file, 120), show:p.show.name, app:p.show.app, at:new Date().toISOString(), mode:P.mode };
  RF.data = _rfClean(d); RF.pend = null; RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = '';
  rfModalClose(); _rfSave(); _rfMirrorAll(); renderRf();
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
  if(!confirm('Restaurer cette version (' + v.ch.length + ' canaux) ?')) return;
  var ch = JSON.parse(JSON.stringify(v.ch));
  d.vers.splice(i, 1);
  _rfSnapshot('Avant restauration');
  d.ch = ch; RF.data = _rfClean(d);
  rfModalClose(); _rfSave(); _rfMirrorAll(); renderRf(); toast('Version restaurée');
}

/* ── Calcul des fréquences ─────────────────────────────────────────────
   Fenêtre des options de calcul (bouton « Options » de la bande « Fréquences »). Les réglages (niveau et sens par défaut ou par
   liaison, canaux TV, inclusions, exclusions) sont enregistrés au fil de
   l'eau : ils servent aussi aux contrôles et au bandeau spectre. Les
   fréquences, elles, ne sont qu'un aperçu : rien n'est écrit sans
   « Appliquer », et l'état précédent est gardé en version. */
function _rfProfTxt(p){
  return p.cc + ' kHz' + (p.i3 ? ' · IM3 ' + p.i3 : '') + (p.i5 ? ' · IM5 ' + p.i5 : '') + (p.t3 ? ' · 3 ém. ' + p.t3 : '');
}
function _rfSorted(){
  var keep = { q:RF.q, fk:RF.fk, fz:RF.fz, fs:RF.fs, sort:RF.sort };
  RF.q = ''; RF.fk = ''; RF.fz = ''; RF.fs = ''; RF.sort = 'zone';
  var list = _rfVisible(); Object.assign(RF, keep);
  return list;
}
/* Liaisons avec leurs écarts, au niveau choisi pour chacune (ou celui par défaut) */
function _rfWithProf(list){
  var co = RF.data.coord;
  return _rfCarriers(list).map(function(c){ return { id:c.id, f:c.f, z:c.zone, p:_rfProf(c, c.cm || co.mode) }; });
}
function rfCoord(){
  if(!CUR_SHOW) return;
  _rfLoad();
  if(!RF.data.ch.length){ toast('Aucun canal : importez un show ou créez vos canaux d\'abord.'); return; }
  RF.co = { scope:RF.fz ? 'z:' + RF.fz : 'all', sp:false, lock:false };
  _rfCoordModal();
}
function rfCoordClose(){ RF.co = null; rfModalClose(); renderRf(); }
function _rfCoIn(c){ var s = RF.co.scope; return s === 'empty' ? !c.f : s.indexOf('z:') === 0 ? c.zone === s.slice(2) : true; }
function _rfCoPlan(inFn){
  inFn = inFn || _rfCoIn;
  var d = RF.data, co = d.coord, av = _rfAvoid(d), grp = {}, reps = [];
  _rfSorted().forEach(function(c){ var k = c.sh || c.id; if(!grp[k]){ grp[k] = []; reps.push(c); } grp[k].push(c); });
  var chs = reps.map(function(c){
    var r = _rfRange(c), dr = c.cd || co.dir, rr = r ? _rfFromRange(r, co.from, dr) : null;
    return { id:c.id, f:c.f, lo:rr ? rr[0] : co.lo, hi:rr ? rr[1] : co.hi, lo0:r ? r[0] : co.lo, hi0:r ? r[1] : co.hi, fixed:!grp[c.sh || c.id].some(inFn) || grp[c.sh || c.id].some(function(m){ return m.lk && m.f; }), p:_rfProf(c, c.cm || co.mode), dir:dr, z:c.zone, step:(_rfCatBand(c.ser, c.band) || {}).st || 0 };
  });
  var opt = { step:25, avoid:av.ban.map(function(b){ return [b.a, b.b]; }), include:av.inc, iso:d.iso, zim:d.zim };
  var res = _rfCoord(chs, opt);
  /* Départ au milieu de la bande : ce qui n'y tient pas repart du bord de bande, autour de ce qui est placé */
  if(co.from && res.missed){
    var got = {}; res.list.forEach(function(x){ got[x.id] = x.f; });
    var r2 = _rfCoord(chs.map(function(c){ return got[c.id] ? Object.assign({}, c, { fixed:true, f:got[c.id] }) : Object.assign({}, c, { lo:c.lo0, hi:c.hi0 }); }), opt);
    res = { list:res.list.filter(function(l){ return l.f > 0; }).concat(r2.list), placed:res.placed + r2.placed, missed:r2.missed, err:res.err || r2.err };
  }
  var byRep = {}, map = {}; res.list.forEach(function(x){ byRep[x.id] = x.f; });
  reps.forEach(function(c){ if(byRep[c.id] !== undefined) grp[c.sh || c.id].forEach(function(m){ map[m.id] = byRep[c.id]; }); });
  var after = d.ch.map(function(c){ return Object.assign({}, c, { f:map[c.id] || c.f }); });
  return { res:res, map:map, reps:reps.filter(function(c){ return byRep[c.id] !== undefined; }), grp:grp,
           todo:chs.filter(function(c){ return !c.fixed; }).length, kept:chs.filter(function(c){ return c.fixed && c.f; }).length,
           before:_rfCompat(_rfWithProf(d.ch), d.iso, d.zim), after:_rfCompat(_rfWithProf(after), d.iso, d.zim) };
}
function _rfCoordModal(){
  var o = RF.co; if(!o) return;
  var E = _bonE, d = RF.data, co = d.coord, zs = _rfZones(), P = _rfCoPlan(), cnt = function(x){ return x.list.length + (x.more ? '+' : ''); };
  var old = document.getElementById('rf-modal'), sc = [0, 0];
  if(old){ var mb = old.querySelector('.modal-body'), ls = old.querySelector('.rf-co-list'); sc = [mb ? mb.scrollTop : 0, ls ? ls.scrollTop : 0]; }
  var seg = function(k, list){ return '<div class="rf-seg">' + list.map(function(x){ return '<button type="button" class="' + (co[k] === x[0] ? 'on' : '') + '" onclick="rfCoordOpt(\'' + k + '\',\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>'; };
  var nz = function(z){ return d.ch.filter(function(c){ return c.zone === z; }).length; }, empty = d.ch.filter(function(c){ return !c.f; }).length;
  var opt = function(v, l, cur){ return '<option value="' + E(v) + '"' + (cur === v ? ' selected' : '') + '>' + E(l) + '</option>'; };
  var b = '<div class="rf-co">' +
    '<div class="rf-co-row"><span>Compatibilité</span>' + seg('mode', _RF_LVL) + '<small>pour tous les canaux concernés ; les écarts dépendent de chaque appareil, et se règlent ensuite liaison par liaison, plus bas. Les produits d\'intermodulation naissent entre émetteurs d\'une même zone et protègent les liaisons de toutes les zones ; l\'écart entre porteuses vaut entre toutes.</small></div>' +
    '<div class="rf-co-row"><span>Sens</span>' + seg('dir', [['up', 'Croissant'], ['down', 'Décroissant']]) + _rfFromField() + '<small>pour tous les canaux concernés : ' + (co.dir === 'down' ? 'du haut de chaque bande vers le bas' : 'du bas de chaque bande vers le haut') + ', les liaisons les plus exigeantes d\'abord puis l\'ordre de la liste</small></div>' +
    '<div class="rf-co-row"><span>Canaux</span><select class="rf-sel" onchange="rfCoordOpt(\'scope\',this.value)">' + opt('all', 'Tous les canaux (' + d.ch.length + ')', o.scope) +
      zs.map(function(z){ return opt('z:' + z, 'Zone ' + z + ' (' + nz(z) + ')', o.scope); }).join('') + (empty ? opt('empty', 'Seulement les canaux sans fréquence (' + empty + ')', o.scope) : '') + '</select>' +
      '<small>' + (o.scope === 'all' ? 'les fréquences libres sont recalculées' : 'les autres fréquences sont gardées et protégées') + ' ; les fréquences verrouillées ne bougent jamais</small></div>' +
    '<div class="rf-co-row"><span>Ensuite</span><label class="rf-imp-c"><input type="checkbox" class="cb" ' + (o.lock ? 'checked' : '') + ' onchange="RF.co.lock=this.checked"/><span>Verrouiller les fréquences appliquées</span></label><small></small></div>' +
  '</div>';

  /* Spectre : canaux TV, exclusions de la session, plages incluses ou exclues */
  var nIn = co.rules.filter(function(r){ return r.t === 'in'; }).length, nEx = co.rules.length - nIn;
  var sum = [co.tv.length ? co.tv.length + (co.tv.length > 1 ? ' canaux TV' : ' canal TV') : '', nEx ? nEx + ' exclusion' + (nEx > 1 ? 's' : '') : '', nIn ? nIn + ' inclusion' + (nIn > 1 ? 's' : '') : '',
             d.excl.length && co.sx ? d.excl.length + ' de la session' : '', d.scan && d.scan.use ? 'scan' : ''].filter(Boolean).join(' · ') || 'rien à éviter';
  b += '<details class="rf-co-sp"' + (o.sp ? ' open' : '') + ' ontoggle="if(RF.co)RF.co.sp=this.open"><summary><b>Spectre à éviter ou à réserver</b><em>' + sum + '</em><i class="ti ti-chevron-down"></i></summary><div class="rf-co-spb">' +
    '<div class="rf-co-h">Canaux TV à éviter <select class="rf-sel xs" onchange="rfCoordOpt(\'tvw\',this.value)" aria-label="Largeur des canaux TV">' + opt('8', 'canaux de 8 MHz (Europe)', String(co.tvw)) + opt('6', 'canaux de 6 MHz (Amériques)', String(co.tvw)) + '</select></div>' +
    '<div class="rf-co-tv">' + _rfTvList(co.tvw).map(function(n){ var r = _rfTvRange(n, co.tvw); return '<button type="button" class="' + (co.tv.indexOf(n) >= 0 ? 'on' : '') + '" onclick="rfCoordTv(' + n + ')" title="Canal ' + n + ' : ' + (r[0] / 1000) + ' à ' + (r[1] / 1000) + ' MHz"><b>' + n + '</b><small>' + (r[0] / 1000) + '</small></button>'; }).join('') + '</div>' +
    (d.excl.length ? '<label class="rf-imp-c"><input type="checkbox" class="cb" ' + (co.sx ? 'checked' : '') + ' onchange="rfCoordOpt(\'sx\',this.checked)"/><span>Éviter aussi les ' + d.excl.length + ' plages exclues dans le show Wireless Workbench</span></label>' : '') +
    '<div class="rf-co-h">Scan du lieu</div>' + _rfScanBar() +
    '<div class="rf-co-h">Plages incluses ou exclues</div>' +
    (co.rules.length ? '<div class="rf-co-rules">' + co.rules.map(function(r, i){
      return '<div data-i="' + i + '"><select class="rf-sel xs" onchange="rfCoordRule(this,\'t\')" aria-label="Type">' + opt('ex', 'Exclure', r.t) + opt('in', 'Inclure', r.t) + '</select>' +
        '<input class="rf-co-in s" value="' + _rfFmt(r.a) + '" inputmode="decimal" onchange="rfCoordRule(this,\'a\')" aria-label="Début en MHz"/><span>à</span>' +
        '<input class="rf-co-in s" value="' + _rfFmt(r.b) + '" inputmode="decimal" onchange="rfCoordRule(this,\'b\')" aria-label="Fin en MHz"/><span>MHz</span>' +
        '<button type="button" class="rf-ib on" onclick="rfCoordRule(this,\'del\')" title="Retirer cette plage"><i class="ti ti-x"></i></button></div>'; }).join('') + '</div>' : '') +
    '<div class="rf-co-add"><button type="button" class="btn sm" onclick="rfCoordRuleAdd(\'ex\')"><i class="ti ti-ban"></i>Exclure une plage</button><button type="button" class="btn sm" onclick="rfCoordRuleAdd(\'in\')"><i class="ti ti-target"></i>Inclure une plage</button></div>' +
    '<p class="rf-note">Une exclusion interdit la plage. Dès qu\'une inclusion existe, les fréquences ne sont cherchées que dans les plages incluses.</p>' +
    '<div class="rf-co-row"><span>Bande inconnue</span><span class="rf-co-rg"><input class="rf-co-in s" value="' + _rfFmt(co.lo) + '" inputmode="decimal" onchange="rfCoordOpt(\'lo\',this.value)" aria-label="Début de plage en MHz"/> à <input class="rf-co-in s" value="' + _rfFmt(co.hi) + '" inputmode="decimal" onchange="rfCoordOpt(\'hi\',this.value)" aria-label="Fin de plage en MHz"/> MHz</span><small>plage des canaux dont la plage d\'accord n\'est pas connue</small></div>' +
  '</div></details>';

  var r = P.res;
  b += '<div class="rf-co-sum' + (r.missed ? ' bad' : '') + '"><b>' + r.placed + ' / ' + P.todo + '</b><span>fréquence' + (P.todo > 1 ? 's' : '') + ' trouvée' + (r.placed > 1 ? 's' : '') +
    (r.missed ? ' · <em>' + r.missed + ' sans place</em>' : '') + (P.kept ? ' · ' + P.kept + ' gardée' + (P.kept > 1 ? 's' : '') : '') + '</span>' +
    '<span class="rf-co-cf">Conflits : ' + cnt(P.before) + ' aujourd\'hui → <b>' + cnt(P.after) + '</b> après</span></div>';
  if(!P.todo) b += '<p class="rf-co-tip"><i class="ti ti-lock"></i>Rien à calculer : toutes les fréquences concernées sont verrouillées. Libérez celles que vous voulez recalculer.</p>';
  if(r.err) b += '<p class="rf-err"><i class="ti ti-alert-triangle"></i>' + E(r.err) + '</p>';
  if(r.missed) b += '<p class="rf-co-tip"><i class="ti ti-info-circle"></i>Pas assez de place pour tous les canaux : baissez le niveau des liaisons qui le permettent, réduisez ce qui est à éviter, ou calculez zone par zone si les plateaux ne jouent pas ensemble.</p>';

  /* Liste : niveau et sens réglables par liaison, ou d'un coup pour toute une zone */
  var mOpt = function(cur, first){ return opt('', first, cur) + _RF_LVL.map(function(l){ return opt(l[0], l[1], cur); }).join(''); };
  var dOpt = function(cur, first){ return opt('', first, cur) + opt('up', '↑ Croissant', cur) + opt('down', '↓ Décroissant', cur); };
  var rows = '', last = null, list = P.reps, over = d.ch.filter(function(c){ return c.cm || c.cd; }).length;
  list.forEach(function(c){
    if(c.zone !== last){
      last = c.zone;
      rows += '<div class="rf-co-g" data-z="' + E(c.zone) + '"><b><i style="background:' + _rfHue(c.zone, zs) + '"></i>' + E(c.zone || 'Sans zone') + '</b>' +
        '<select class="rf-sel xs" onchange="rfCoordZone(this,\'cm\')" aria-label="Niveau de toute la zone">' + opt('?', 'Niveau de la zone…', '?') + opt('', 'Par défaut', '?') + _RF_LVL.map(function(l){ return opt(l[0], l[1], '?'); }).join('') + '</select>' +
        '<select class="rf-sel xs" onchange="rfCoordZone(this,\'cd\')" aria-label="Sens de toute la zone">' + opt('?', 'Sens de la zone…', '?') + opt('', 'Par défaut', '?') + opt('up', '↑ Croissant', '?') + opt('down', '↓ Décroissant', '?') + '</select></div>';
    }
    var f = P.map[c.id], rg = _rfRange(c), p = _rfProf(c, c.cm || co.mode), ng = P.grp[c.sh || c.id].length;
    rows += '<div class="rf-co-r' + (f ? '' : ' miss') + '" data-id="' + c.id + '"><span class="n"><b>' + E(c.n || c.dev || 'Canal') + '</b>' + E(ng > 1 ? 'porteuse commune à ' + ng + ' canaux' : c.who) +
      '<small>' + E((c.band || (rg ? '' : 'plage par défaut')) + ' · ' + (p.cat ? c.ser + (p.pn && p.pn !== 'Standard' ? ' ' + (_RF_PN_LBL[p.pn] || p.pn) : '') : _RF_FAM[p.fam].l) + ' · ' + _rfProfTxt(p)) + '</small></span>' +
      '<select class="rf-sel xs' + (c.cm ? ' set' : '') + '" onchange="rfCoordCh(this,\'cm\')" aria-label="Niveau de compatibilité">' + mOpt(c.cm, 'Défaut : ' + _rfLvlLbl(co.mode)) + (c.pf ? opt('wwb', 'Profil du show WWB', c.cm) : '') + '</select>' +
      '<select class="rf-sel xs' + (c.cd ? ' set' : '') + '" onchange="rfCoordCh(this,\'cd\')" aria-label="Sens">' + dOpt(c.cd, 'Défaut : ' + (co.dir === 'down' ? '↓' : '↑')) + '</select>' +
      '<span class="o">' + (_rfFmt(c.f) || '—') + '</span><i class="ti ti-arrow-right"></i><span class="f">' + (f ? _rfFmt(f) : 'pas de place') + '</span></div>';
  });
  b += '<div class="rf-co-list">' + rows + '</div>';
  if(over) b += '<p class="rf-note">' + over + ' liaison' + (over > 1 ? 's ont' : ' a') + ' un réglage propre. <button type="button" class="ov-link" onclick="rfCoordReset()">Tout remettre par défaut</button></p>';
  if(P.after.t3skip) b += '<p class="rf-note">Plus de ' + _RF_T3_MAX + ' porteuses : les produits à trois émetteurs ne sont pas calculés.</p>';
  b += '<p class="rf-note">Écarts alignés sur les profils Robust, Standard et More Frequencies de Wireless Workbench. Calcul simplifié, au pas d\'accord de chaque appareil : il ignore les fréquences parasites propres aux appareils et le spectre réel du lieu. Validez par un scan sur place, puis réglez les appareils.' + (r.missed ? ' Les canaux sans place gardent leur fréquence actuelle.' : '') + '</p>';
  _rfModal('Calculer les fréquences', 'ti-wave-sine', b,
    '<button class="btn ghost sm" onclick="rfCoordClose()">Fermer</button><button class="btn pri sm" onclick="rfCoordApply()"' + (r.placed ? '' : ' disabled') + '><i class="ti ti-check"></i>Appliquer ' + r.placed + ' fréquence' + (r.placed > 1 ? 's' : '') + '</button>', 820);
  RF.onClose = function(){ RF.co = null; renderRf(); };
  var m = document.getElementById('rf-modal');
  if(m){ var nb = m.querySelector('.modal-body'), nl = m.querySelector('.rf-co-list'); if(nb) nb.scrollTop = sc[0]; if(nl) nl.scrollTop = sc[1]; }
}
/* Réglages généraux : enregistrés tout de suite */
function rfCoordOpt(k, v){
  var o = RF.co, co = RF.data.coord; if(!o) return;
  if(k === 'scope'){ o.scope = String(v || 'all'); _rfCoordModal(); return; }
  /* Les boutons du haut valent pour tous les canaux concernés : les réglages propres à une liaison
     (niveau repris de Workbench, ou choisi plus bas) sont remplacés, sinon le bouton ne changerait rien. */
  if(k === 'mode' || k === 'dir'){
    var f = k === 'mode' ? 'cm' : 'cd', over = 0;
    RF.data.ch.forEach(function(c){ if(_rfCoIn(c) && c[f]){ c[f] = ''; over++; } });
    if(k === 'mode') co.mode = _rfLvl(v); else co.dir = v === 'down' ? 'down' : 'up';
    if(over) toast(over + ' réglage' + (over > 1 ? 's propres à une liaison remplacé' : ' propre à une liaison remplacé') + (over > 1 ? 's' : '') + ' : tout est en ' + (k === 'mode' ? _rfLvlLbl(v) : (co.dir === 'down' ? 'décroissant' : 'croissant')) + '. Réglable ensuite liaison par liaison.');
  }
  else if(k === 'sx') co.sx = !!v;
  else if(k === 'tvw'){ co.tvw = String(v) === '6' ? 6 : 8; co.tv = []; }
  else if(k === 'lo' || k === 'hi'){
    var f = _rfParseMHz(v), lo = k === 'lo' ? f : co.lo, hi = k === 'hi' ? f : co.hi;
    if(!f || hi <= lo) toast('Plage illisible : deux fréquences en MHz, la première plus basse que la seconde.');
    else { co.lo = lo; co.hi = hi; }
  }
  _rfSave(); _rfCoordModal();
}
function rfCoordTv(n){
  var co = RF.data.coord; if(!RF.co || _rfTvList(co.tvw).indexOf(n) < 0) return;
  var i = co.tv.indexOf(n);
  if(i >= 0) co.tv.splice(i, 1); else co.tv.push(n);
  co.tv.sort(function(a, b){ return a - b; });
  _rfSave(); _rfCoordModal();
}
function rfCoordRuleAdd(t){
  var co = RF.data.coord; if(!RF.co) return;
  if(co.rules.length >= 30){ toast('30 plages au maximum.'); return; }
  co.rules.push(t === 'in' ? { t:'in', a:co.lo, b:co.hi } : { t:'ex', a:606000, b:614000 });
  RF.co.sp = true;
  _rfSave(); _rfCoordModal();
}
function rfCoordRule(el, k){
  var co = RF.data.coord, row = el.closest('[data-i]'), i = row ? +row.dataset.i : -1, r = co.rules[i];
  if(!RF.co || !r) return;
  if(k === 'del') co.rules.splice(i, 1);
  else if(k === 't') r.t = el.value === 'in' ? 'in' : 'ex';
  else {
    var f = _rfParseMHz(el.value), a = k === 'a' ? f : r.a, b = k === 'b' ? f : r.b;
    if(!f || b <= a) toast('Plage illisible : deux fréquences en MHz, la première plus basse que la seconde.');
    else { r.a = a; r.b = b; }
  }
  _rfSave(); _rfCoordModal();
}
/* Niveau ou sens d'une liaison, d'une zone entière, ou retour au réglage par défaut */
function _rfCoSet(c, k, v){
  if(k === 'cm') c.cm = (v === 'rob' || v === 'std' || v === 'more' || (v === 'wwb' && c.pf)) ? v : '';
  else if(k === 'cd') c.cd = (v === 'up' || v === 'down') ? v : '';
}
function rfCoordCh(el, k){
  var c = _rfGet(_rfRowId(el)); if(!RF.co || !c) return;
  _rfCoSet(c, k, el.value);
  _rfSave(); _rfCoordModal();
}
function rfCoordZone(el, k){
  var g = el.closest('[data-z]'), v = el.value; if(!RF.co || !g || v === '?') return;
  RF.data.ch.forEach(function(c){ if(c.zone === g.dataset.z && _rfCoIn(c)) _rfCoSet(c, k, v); });
  _rfSave(); _rfCoordModal();
}
function rfCoordReset(){
  if(!RF.co) return;
  RF.data.ch.forEach(function(c){ c.cm = ''; c.cd = ''; });
  _rfSave(); _rfCoordModal();
}
function rfCoordApply(){
  if(!RF.co || !CUR_SHOW) return;
  var P = _rfCoPlan(), d = RF.data, n = 0;
  if(!P.res.placed) return;
  _rfSnapshot('Avant le calcul des fréquences');
  var lock = !!RF.co.lock;
  d.ch.forEach(function(c){ var f = P.map[c.id]; if(f){ c.f = f; if(lock) c.lk = true; n++; } });
  RF.data = _rfClean(d); RF.co = null; RF.onClose = null;
  rfModalClose(); _rfSave(); _rfMirrorAll(); renderRf();
  toast(n + ' fréquence' + (n > 1 ? 's appliquées' : ' appliquée') + '. À régler sur les appareils.');
}

/* ── Ajouter du matériel depuis le catalogue ───────────────────────────
   On choisit un modèle, sa bande, une quantité : les canaux sont créés avec
   la bonne plage d'accord et le bon profil, prêts à être coordonnés.
   « Mon parc » garde les configurations qu'on réutilise, sur le compte
   (profiles.tours.rf_gear) et dans le navigateur. */
var RF_GEAR = null;
function _rfGearKey(){ return 'pf_rf_gear_' + ((typeof ME !== 'undefined' && ME && ME.id) || ''); }
function _rfGearClean(list){
  return (Array.isArray(list) ? list : []).filter(function(g){ return g && g.mdl && g.ser; }).slice(0, 60).map(function(g){
    return { mk:_rfStr(g.mk, 30), ser:_rfStr(g.ser, 30), mdl:_rfStr(g.mdl, 30), band:_rfStr(g.band, 16), pn:_rfStr(g.pn, 30), ch:Math.max(1, Math.min(64, _rfInt(g.ch) || 1)),
             t:_rfStr(g.t, 8), qty:Math.max(1, Math.min(50, _rfInt(g.qty) || 1)) };
  });
}
function _rfGearLocal(){ try { return _rfGearClean(JSON.parse(localStorage.getItem(_rfGearKey()) || '[]')); } catch(e){ return []; } }
/* Appelé par pf-app.js à la lecture de profiles.tours : le compte fait foi */
function _rfGearFromServer(t){
  var srv = t && Array.isArray(t.rf_gear) ? _rfGearClean(t.rf_gear) : null;
  RF_GEAR = srv || _rfGearLocal();
  try { localStorage.setItem(_rfGearKey(), JSON.stringify(RF_GEAR)); } catch(e){}
}
function _rfGearSave(){
  try { localStorage.setItem(_rfGearKey(), JSON.stringify(RF_GEAR || [])); } catch(e){}
  if(typeof _pushToursSoon === 'function') _pushToursSoon();
}
function rfGear(assign){
  if(!CUR_SHOW) return;
  _rfLoad();
  if(RF_GEAR === null) RF_GEAR = _rfGearLocal();
  assign = Array.isArray(assign) && assign.length ? assign : null;
  var allIem = assign && assign.every(function(id){ var c = _rfGet(id); return c && c.kind === 'iem'; });
  RF.gear = { q:'', mk:'', t:allIem ? 'iem' : 'rx', sel:null, band:'', pn:'', qty:1, zone:RF.fz || '', keep:false, assign:assign };
  if(!_RF_CAT){
    _rfModal(RF.gear.assign ? 'Attribuer du matériel' : 'Ajouter du matériel', 'ti-antenna', '<p class="rf-note">Chargement du catalogue…</p>', '<button class="btn ghost sm" onclick="rfModalClose()">Fermer</button>', 720);
    _rfCatLoad().then(function(ok){
      if(!RF.gear || !document.getElementById('rf-modal')) return;
      if(ok) _rfGearModal();
      else _rfModal('Ajouter du matériel', 'ti-alert-triangle', '<p class="rf-err"><i class="ti ti-alert-triangle"></i>Catalogue indisponible : vérifiez la connexion, puis réessayez.</p>', '<button class="btn pri sm" onclick="rfModalClose()">Fermer</button>', 520);
    });
    return;
  }
  _rfGearModal();
}
function _rfGearList(){
  var g = RF.gear, q = _rfNorm(g.q), out = [];
  _RF_CAT.series.forEach(function(s){
    if(g.mk && s.mk !== g.mk) return;
    s.m.forEach(function(m){
      if(g.t === 'rx' ? m.t !== 'rx' : g.t === 'iem' ? m.t !== 'iem' : (m.t === 'rx' || m.t === 'iem')) return;
      if(g.t === 'all' && !q) return;
      if(q && _rfNorm(s.mk + ' ' + s.s + ' ' + m.n).indexOf(q) < 0) return;
      out.push({ s:s, m:m });
    });
  });
  return out;
}
function _rfGearBands(x){ return x.s.b.filter(function(b){ return !x.m.b || x.m.b.indexOf(b.n) >= 0; }); }
function _rfGearModal(){
  var g = RF.gear; if(!g) return;
  var E = _bonE, old = document.getElementById('rf-modal'), sc = old && old.querySelector('.rf-gl') ? old.querySelector('.rf-gl').scrollTop : 0;
  var seg = function(k, list){ return '<div class="rf-seg">' + list.map(function(x){ return '<button type="button" class="' + (g[k] === x[0] ? 'on' : '') + '" onclick="rfGearOpt(\'' + k + '\',\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>'; };
  var b = '', A = g.assign;
  if(A) b += '<p class="rf-note" style="margin:0 0 10px">Choisissez le modèle et la bande à donner aux ' + _rfPl(A.length) + ' cochés. Leur nom, leur utilisateur, leur fréquence et leur lien avec l\'input list sont gardés.</p>';
  if(!A && RF_GEAR && RF_GEAR.length){
    b += '<div class="rf-co-h">Mon parc</div><div class="rf-gp">' + RF_GEAR.map(function(p, i){
      return '<span><button type="button" onclick="rfGearPark(' + i + ')" title="Ajouter au show"><b>' + p.qty + ' × ' + E(p.mdl) + '</b>' + E(p.band) + '</button><button type="button" class="x" onclick="rfGearParkDel(' + i + ')" title="Retirer de mon parc" aria-label="Retirer de mon parc"><i class="ti ti-x"></i></button></span>'; }).join('') + '</div>';
  }
  b += '<div class="rf-gbar"><label class="rf-search"><i class="ti ti-search"></i><input id="rf-gq" type="search" placeholder="Modèle ou série : ULXD4Q, AD4D, SR 2050…" value="' + E(g.q) + '" oninput="rfGearOpt(\'q\',this.value)" autocomplete="off"/></label>' +
    seg('mk', [['', 'Toutes'], ['Shure', 'Shure'], ['Sennheiser', 'Sennheiser']]) + seg('t', [['rx', 'Récepteurs micro'], ['iem', 'Émetteurs IEM'], ['all', 'Tout le catalogue']]) + '</div>';
  var list = _rfGearList();
  b += '<div class="rf-gl">' + (list.length ? list.map(function(x){
    var on = g.sel && g.sel.s === x.s.s && g.sel.m === x.m.n && g.sel.mk === x.s.mk, nb = _rfGearBands(x).length, add = x.m.t === 'rx' || x.m.t === 'iem';
    return '<button type="button" class="' + (on ? 'on' : '') + (add ? '' : ' off') + '" data-mk="' + E(x.s.mk) + '" data-s="' + E(x.s.s) + '" data-m="' + E(x.m.n) + '" onclick="rfGearPick(this)"><b>' + E(x.m.n) + '</b><span>' + E(x.s.mk + (x.s.s ? ' · ' + x.s.s : '')) + '</span><em>' +
      E(_RF_CAT_T[x.m.t] || '') + (x.m.ch > 1 ? ' · ' + x.m.ch + ' canaux' : '') + (nb ? ' · ' + nb + ' bande' + (nb > 1 ? 's' : '') : '') + '</em></button>'; }).join('')
    : '<p class="rf-void"><i class="ti ti-search-off"></i>' + (g.t === 'all' && !g.q ? 'Saisissez un modèle ou une série pour chercher dans tout le catalogue.' : 'Aucun modèle ne correspond.') + '</p>') + '</div>';
  var x = _rfGearSel(), n = 0;
  if(x){
    var bands = _rfGearBands(x), bd = bands.filter(function(q){ return q.n === g.band; })[0] || bands[0];
    if(bd){
      var pns = Object.keys(bd.p || {}), pn = _rfCatProfName(bd, g.pn), opt = function(v, l, cur){ return '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(l) + '</option>'; };
      var pr = pn ? _RF_CAT.prof[bd.p[pn]] : null; n = g.qty * x.m.ch;
      b += '<div class="rf-gf"><div class="rf-gf-t"><b>' + E(x.s.mk + ' ' + x.m.n) + '</b><span>' + E(_RF_CAT_T[x.m.t] || '') + ' · ' + _rfPl(x.m.ch) + ' par appareil</span></div>' +
        '<label>Bande<select class="rf-sel" onchange="rfGearOpt(\'band\',this.value)">' + bands.map(function(q){ return opt(q.n, q.n + '  ·  ' + _rfFmt(q.a) + ' à ' + _rfFmt(q.b) + ' MHz', bd.n); }).join('') + '</select></label>' +
        (pns.length > 1 ? '<label>Profil RF<select class="rf-sel" onchange="rfGearOpt(\'pn\',this.value)">' + pns.map(function(q){ return opt(q, _RF_PN_LBL[q] || q, pn); }).join('') + '</select></label>' : '') +
        (A ? '<label>Appareils<b class="rf-gf-n">' + Math.ceil(A.length / x.m.ch) + ' × ' + E(x.m.n) + '</b></label>' : '<label>Appareils<span class="rf-step"><button type="button" onclick="rfGearOpt(\'qty\',' + (g.qty - 1) + ')" aria-label="Moins"><i class="ti ti-minus"></i></button><b>' + g.qty + '</b><button type="button" onclick="rfGearOpt(\'qty\',' + (g.qty + 1) + ')" aria-label="Plus"><i class="ti ti-plus"></i></button></span></label>') +
        (A ? '' : '<label>Zone<input class="rf-co-in" list="rf-gz" value="' + E(g.zone) + '" placeholder="Plateau, accueil…" onchange="rfGearOpt(\'zone\',this.value)" maxlength="40"/><datalist id="rf-gz">' + _rfZones().map(function(z){ return '<option value="' + E(z) + '"></option>'; }).join('') + '</datalist></label>') +
        (pr ? '<p class="rf-note">Pas d\'accord ' + bd.st + ' kHz. Écarts ' + ['robuste', 'standard', 'plus de fréquences'].map(function(l, i){ return l + ' ' + pr[i][0] + (pr[i][1] ? ' / IM3 ' + pr[i][1] : '') + (pr[i][5] ? ' / 3 ém. ' + pr[i][5] : ''); }).join(' · ') + ' kHz.</p>' : '') +
        (A ? '' : '<label class="rf-imp-c"><input type="checkbox" class="cb" ' + (g.keep ? 'checked' : '') + ' onchange="rfGearOpt(\'keep\',this.checked)"/><span>Garder cette configuration dans mon parc</span></label>') + '</div>';
    } else b += '<div class="rf-gf"><p class="rf-note">' + E(x.m.n) + ' : ' + E(_RF_CAT_T[x.m.t] || 'appareil') + ' sans bande propre dans le catalogue.</p></div>';
  }
  _rfModal(A ? 'Attribuer du matériel' : 'Ajouter du matériel', 'ti-antenna', b,
    '<button class="btn ghost sm" onclick="RF.gear=null;rfModalClose()">Fermer</button>' + (A
      ? '<button class="btn pri sm" onclick="rfGearAssign()"' + (n ? '' : ' disabled') + '><i class="ti ti-check"></i>' + (n ? 'Attribuer à ' + _rfPl(A.length) : 'Choisissez un modèle') + '</button>'
      : '<button class="btn pri sm" onclick="rfGearAdd()"' + (n ? '' : ' disabled') + '><i class="ti ti-plus"></i>' + (n ? 'Ajouter ' + _rfPl(n) : 'Choisissez un modèle') + '</button>'), 760);
  var m = document.getElementById('rf-modal'), gl = m && m.querySelector('.rf-gl'); if(gl) gl.scrollTop = sc;
}
function _rfGearSel(){
  var g = RF.gear; if(!g || !g.sel) return null;
  var s = _RF_CAT.series.filter(function(q){ return q.s === g.sel.s && q.mk === g.sel.mk; })[0], m = s && s.m.filter(function(q){ return q.n === g.sel.m; })[0];
  return m && (m.t === 'rx' || m.t === 'iem') ? { s:s, m:m } : (m ? { s:{ mk:s.mk, s:s.s, b:[] }, m:m } : null);
}
function rfGearOpt(k, v){
  var g = RF.gear; if(!g) return;
  if(k === 'q'){ g.q = String(v || ''); _rfGearModal(); var i = document.getElementById('rf-gq'); if(i){ i.focus(); try { i.setSelectionRange(g.q.length, g.q.length); } catch(e){} } return; }
  if(k === 'mk') g.mk = v === 'Shure' || v === 'Sennheiser' ? v : '';
  else if(k === 't') g.t = v === 'iem' || v === 'all' ? v : 'rx';
  else if(k === 'band'){ g.band = String(v || ''); g.pn = ''; }
  else if(k === 'pn') g.pn = String(v || '');
  else if(k === 'qty') g.qty = Math.max(1, Math.min(50, _rfInt(v) || 1));
  else if(k === 'zone') g.zone = _rfStr(v, 40);
  else if(k === 'keep') g.keep = !!v;
  _rfGearModal();
}
function rfGearPick(el){
  var g = RF.gear; if(!g) return;
  g.sel = { mk:el.dataset.mk, s:el.dataset.s, m:el.dataset.m }; g.band = ''; g.pn = ''; g.qty = 1;
  _rfGearModal();
}
/* Numéro du prochain appareil de ce modèle dans le show (« ULXD4Q 3 ») */
function _rfGearNext(mdl){
  var ids = {}; RF.data.ch.forEach(function(c){ if(c.mdl === mdl) ids[c.did || c.id] = 1; });
  return Object.keys(ids).length + 1;
}
function _rfGearPush(o){
  var room = _RF_MAX_CH - RF.data.ch.length, list = _rfGearChannels(Object.assign({ from:_rfGearNext(o.mdl) }, o));
  if(list.length > room){ toast('Limite de ' + _RF_MAX_CH + ' canaux atteinte.'); return 0; }
  list.forEach(function(c){ RF.data.ch.push(c); });
  if(o.zone && RF.data.zones.indexOf(o.zone) < 0) RF.data.zones.push(o.zone);
  return list.length;
}
function rfGearAdd(){
  var g = RF.gear, x = _rfGearSel(); if(!g || !x) return;
  var bands = _rfGearBands(x), bd = bands.filter(function(q){ return q.n === g.band; })[0] || bands[0]; if(!bd) return;
  var o = { mk:x.s.mk, ser:x.s.s, mdl:x.m.n, band:bd.n, pn:_rfCatProfName(bd, g.pn), ch:x.m.ch, t:x.m.t, qty:g.qty, zone:g.zone };
  var n = _rfGearPush(o); if(!n) return;
  if(g.keep){
    RF_GEAR = (RF_GEAR || []).filter(function(p){ return !(p.mdl === o.mdl && p.band === o.band && p.pn === o.pn); });
    RF_GEAR.unshift(_rfGearClean([o])[0]); RF_GEAR = RF_GEAR.slice(0, 60); _rfGearSave();
  }
  _rfSave(); g.qty = 1; g.keep = false;
  _rfGearModal(); renderRf();
  toast(_rfPl(n) + ' ajouté' + (n > 1 ? 's' : '') + ' : ' + o.mdl + ' ' + o.band + '. Calculer leur donnera des fréquences.');
}
/* Donne le modèle et la bande choisis aux canaux cochés, en les rangeant dans autant d'appareils qu'il en faut
   (6 canaux sur un récepteur 4 canaux = 2 appareils). Ce que l'utilisateur a saisi sur ces canaux est gardé. */
function rfGearAssign(){
  var g = RF.gear, x = _rfGearSel(); if(!g || !g.assign || !x) return;
  var bands = _rfGearBands(x), bd = bands.filter(function(q){ return q.n === g.band; })[0] || bands[0]; if(!bd) return;
  var pn = _rfCatProfName(bd, g.pn), per = x.m.ch, from = 0, did = '', n = 0, out = 0;
  var wide = /^4-channel_wideband$/.test(pn) ? 4 : /^2-channel_wideband$/.test(pn) ? 2 : 0;
  var mine = {}; g.assign.forEach(function(id){ mine[id] = 1; });
  var ids = {}; RF.data.ch.forEach(function(c){ if(c.mdl === x.m.n && !mine[c.id]) ids[c.did || c.id] = 1; });
  from = Object.keys(ids).length + 1;
  g.assign.forEach(function(id, i){
    var c = _rfGet(id); if(!c) return;
    var slot = i % per, dev = Math.floor(i / per);
    if(slot === 0) did = _rfId();
    c.mk = x.s.mk; c.ser = x.s.s; c.mdl = x.m.n; c.band = bd.n; c.pn = pn; c.did = did;
    c.dev = x.m.n + ' ' + (from + dev) + (per > 1 ? ' · ' + (slot + 1) : '');
    c.sh = wide ? did + '#w' + Math.floor(slot / wide) : '';
    if(c.f && (c.f < bd.a || c.f > bd.b)) out++;
    n++;
  });
  RF.data = _rfClean(RF.data); RF.gear = null;
  rfModalClose(); _rfSave(); renderRf();
  toast(_rfPl(n) + ' sur ' + Math.ceil(n / per) + ' × ' + x.m.n + ' ' + bd.n + (out ? ' · ' + out + ' fréquence' + (out > 1 ? 's' : '') + ' hors de cette bande : recalculez-les' : ''));
}
function rfGearPark(i){
  var p = (RF_GEAR || [])[i]; if(!p || !RF.gear) return;
  var n = _rfGearPush(Object.assign({}, p, { zone:RF.gear.zone })); if(!n) return;
  _rfSave(); _rfGearModal(); renderRf();
  toast(_rfPl(n) + ' ajouté' + (n > 1 ? 's' : '') + ' depuis mon parc : ' + p.qty + ' × ' + p.mdl);
}
function rfGearParkDel(i){
  if(!RF_GEAR || !RF_GEAR[i]) return;
  RF_GEAR.splice(i, 1); _rfGearSave(); _rfGearModal();
}

/* ── Retour vers Wireless Workbench ───────────────────────────────────
   Le plus sûr est de repartir du show d'origine : on y remplace les
   fréquences (appareils et coordination), et tout le reste du fichier est
   rendu tel quel. Le format .shw n'étant pas documenté, PatchFlow ne
   fabrique pas un show de toutes pièces.
   Pour les canaux nés dans PatchFlow, absents du show, des listes de
   fréquences par série et par bande servent à la saisie dans WWB. */
/* chs : canaux PatchFlow ({src, f, n}). opt.names : reporter aussi les noms.
   Retour : { ok, xml, n (canaux mis à jour), same, missed:[canaux sans équivalent dans le show] } ou { ok:false, err } */
function _rfPatchShw(text, chs, opt){
  opt = opt || {};
  var chk = _rfParseShw(text);
  if(!chk.ok) return { ok:false, err:chk.err };
  var doc = new DOMParser().parseFromString(text, 'application/xml'), root = doc.documentElement;
  var by = {}, hit = {}, n = 0, same = 0;
  (chs || []).forEach(function(c){ if(c.src) by[c.src] = c; });
  var setTxt = function(el, v){ if(!el) return false; if(String(el.textContent || '').trim() === String(v)) return false; el.textContent = String(v); return true; };
  _rfKids(_rfKid(root, 'inventory'), 'device').forEach(function(d){
    var chans = _rfKids(d, 'channel'), did = _rfTxt(d, 'id');
    chans.forEach(function(ce, i){
      var num = _rfInt(ce.getAttribute('number')) || (i + 1), c = by[did + '-' + (num - 1)] || (chans.length === 1 ? by[did] : null);
      if(!c) return;
      hit[c.src] = 1;
      var ch = false;
      if(c.f) ch = setTxt(_rfKid(ce, 'frequency'), c.f) || ch;
      if(opt.names && c.n){
        var ne = _rfKid(ce, 'channel_name'), nm = String(c.n).replace(/\]\]>/g, '');
        if(ne && String(ne.textContent || '') !== nm){ while(ne.firstChild) ne.removeChild(ne.firstChild); ne.appendChild(doc.createCDATASection(nm)); ch = true; }
      }
      if(ch) n++; else same++;
    });
  });
  _rfKids(_rfPath(root, 'coordinated_data_root/mic_channels'), 'freq_entry').forEach(function(e){
    var c = by[_rfTxt(e, 'source_id')];
    if(!c) return;
    if(c.f) setTxt(_rfKid(e, 'value'), c.f);
    if(opt.names && c.n) setTxt(_rfKid(e, 'source_name'), String(c.n));
  });
  var missed = (chs || []).filter(function(c){ return !c.src || !hit[c.src]; });
  return { ok:true, xml:new XMLSerializer().serializeToString(doc), n:n, same:same, missed:missed };
}
/* Listes de fréquences : un fichier par série, bande et zone ; une fréquence en MHz par ligne, sans en-tête */
function _rfFreqLists(chs){
  var g = {}, slug = function(s){ return String(s || '').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
  _rfCarriers((chs || []).filter(function(c){ return c.f > 0; })).forEach(function(c){
    var k = [slug(c.ser || c.mdl || 'Divers'), slug(c.band), slug(c.zone)].filter(Boolean).join('_') || 'Divers';
    (g[k] = g[k] || []).push(c.f);
  });
  return Object.keys(g).sort().map(function(k){ return { name:k + '.csv', n:g[k].length, text:g[k].sort(function(a, b){ return a - b; }).map(_rfFmt).join('\r\n') + '\r\n' }; });
}
function _rfDownload(name, blob){
  var a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 20000);
}
function rfWwb(){
  if(!CUR_SHOW) return;
  _rfLoad();
  var d = RF.data, E = _bonE, withSrc = d.ch.filter(function(c){ return c.src; }).length, born = d.ch.length - withSrc, nof = d.ch.filter(function(c){ return !c.f; }).length;
  RF.wwb = { names:false };
  _rfModal('Exporter vers Wireless Workbench', 'ti-file-export',
    '<div class="rf-wwb"><div class="rf-wwb-c"><b>1 · Mettre à jour le show d\'origine</b>' +
      '<p>Choisissez le fichier .shw' + (d.src && d.src.file ? ' importé (« ' + E(d.src.file) + ' »)' : '') + ' : PatchFlow y écrit les fréquences de ' + (withSrc ? _rfPl(withSrc) : 'vos canaux') + ', appareils et coordination, sans toucher au reste. Le fichier modifié est téléchargé, l\'original n\'est pas changé.</p>' +
      (withSrc ? '' : '<p class="rf-err"><i class="ti ti-alert-triangle"></i>Aucun canal de ce show ne vient d\'un fichier Wireless Workbench : utilisez les listes de fréquences.</p>') +
      '<label class="rf-imp-c"><input type="checkbox" class="cb" onchange="RF.wwb.names=this.checked"/><span>Reporter aussi les noms des canaux (Workbench peut les raccourcir selon l\'appareil)</span></label>' +
      '<button class="btn pri" onclick="rfWwbPick()"' + (withSrc ? '' : ' disabled') + '><i class="ti ti-file-import"></i>Choisir le show .shw</button></div>' +
    '<div class="rf-wwb-c"><b>2 · Listes de fréquences</b>' +
      '<p>Une archive avec un fichier par série, bande et zone : une fréquence en MHz par ligne. Pour les saisir ou les importer dans la coordination de Workbench' + (born ? ', notamment les ' + _rfPl(born) + ' créés dans PatchFlow, absents du show' : '') + '.</p>' +
      '<button class="btn" onclick="rfWwbLists()"><i class="ti ti-file-zip"></i>Télécharger les listes</button></div></div>' +
    (nof ? '<p class="rf-note">' + _rfPl(nof) + ' sans fréquence : rien n\'est exporté pour ' + (nof > 1 ? 'eux' : 'lui') + '.</p>' : '') +
    '<p class="rf-note">Ouvrez le fichier dans Wireless Workbench et relisez-le avant de l\'envoyer aux appareils.</p>',
    '<button class="btn ghost sm" onclick="rfModalClose()">Fermer</button>', 640);
}
function rfWwbPick(){
  var i = document.createElement('input');
  i.type = 'file';
  i.onchange = function(){ if(i.files && i.files[0]) rfWwbFile(i.files[0]); };
  i.click();
}
function rfWwbFile(file){
  if(!file || !RF.data) return;
  if(file.size > 25e6){ _rfImportErr('Fichier trop volumineux (25 Mo au maximum).'); return; }
  var r = new FileReader(), names = !!(RF.wwb && RF.wwb.names);
  r.onerror = function(){ _rfImportErr('Lecture du fichier impossible.'); };
  r.onload = function(){
    var res;
    try { res = _rfPatchShw(String(r.result || ''), RF.data.ch, { names:names }); } catch(e){ res = { ok:false, err:'Fichier .shw illisible.' }; }
    if(!res.ok){ _rfImportErr(res.err); return; }
    var E = _bonE, total = res.n + res.same;
    if(!total){
      _rfModal('Exporter vers Wireless Workbench', 'ti-alert-triangle', '<p class="rf-err"><i class="ti ti-alert-triangle"></i>Ce show ne contient aucun des canaux de PatchFlow : ce n\'est sans doute pas le fichier d\'origine.</p>',
        '<button class="btn ghost sm" onclick="rfWwb()">Retour</button>', 520);
      return;
    }
    var out = String(file.name || 'show.shw').replace(/\.(shw|xml)$/i, '') + ' - PatchFlow.shw';
    _rfDownload(out, new Blob([res.xml], { type:'application/xml' }));
    _rfModal('Exporter vers Wireless Workbench', 'ti-circle-check',
      '<div class="rf-imp-h"><b>' + E(out) + '</b><span>' + _rfPl(res.n) + ' mis à jour · ' + res.same + ' déjà à jour' + (res.missed.length ? ' · ' + res.missed.length + ' absent' + (res.missed.length > 1 ? 's' : '') + ' du show' : '') + '</span></div>' +
      (res.missed.length ? '<p class="rf-note">Absents du show, à ajouter dans Workbench : ' + E(res.missed.slice(0, 8).map(function(c){ return c.n || c.dev || c.mdl || 'canal'; }).join(', ')) + (res.missed.length > 8 ? '…' : '') + '. Les listes de fréquences les contiennent.</p>' : '') +
      '<p class="rf-note">Dans Wireless Workbench : ouvrez ce fichier, relisez les fréquences, puis envoyez-les aux appareils.</p>',
      '<button class="btn ghost sm" onclick="rfWwbLists()"><i class="ti ti-file-zip"></i>Listes de fréquences</button><button class="btn pri sm" onclick="rfModalClose()">Terminé</button>', 560);
  };
  r.readAsText(file);
}
async function rfWwbLists(){
  var lists = _rfFreqLists(RF.data.ch);
  if(!lists.length){ toast('Aucune fréquence à exporter.'); return; }
  try {
    var Zip = await _loadJSZip(), z = new Zip();
    lists.forEach(function(l){ z.file(l.name, l.text); });
    z.file('LISEZ-MOI.txt', 'Listes de fréquences exportées de PatchFlow\r\n\r\nUn fichier par série, bande et zone. Une fréquence en MHz par ligne, sans en-tête.\r\n\r\n' + lists.map(function(l){ return l.name + ' : ' + l.n + ' fréquence' + (l.n > 1 ? 's' : ''); }).join('\r\n') + '\r\n');
    _rfDownload(((typeof _pdfSlug === 'function' && _pdfSlug(CUR_SHOW.name || '')) || 'patchflow') + '-frequences-wwb.zip', await z.generateAsync({ type:'blob' }));
    toast(lists.length + ' liste' + (lists.length > 1 ? 's' : '') + ' de fréquences téléchargée' + (lists.length > 1 ? 's' : ''));
  } catch(e){ toast('Export impossible : ' + (e && e.message || e)); }
}

/* Scan : import, seuil, retrait */
function rfScan(){
  if(!CUR_SHOW) return;
  var i = document.createElement('input');
  i.type = 'file';
  i.onchange = function(){ if(i.files && i.files[0]) rfScanFile(i.files[0]); };
  i.click();
}
function rfScanFile(file){
  if(!CUR_SHOW || !file) return;
  _rfLoad();
  var r = new FileReader();
  r.onerror = function(){ _rfImportErr('Lecture du fichier impossible.'); };
  r.onload = function(){
    var p, g;
    try { p = _rfScanParse(r.result); } catch(e){ p = { ok:false, err:'Scan illisible.' }; }
    if(p.ok && !(g = _rfScanGrid(p.pts))) p = { ok:false, err:'Scan trop étendu ou trop court pour être repris.' };
    if(!p.ok){
      _rfModal('Import du scan impossible', 'ti-alert-triangle', '<p class="rf-err"><i class="ti ti-alert-triangle"></i>' + _bonE(p.err) + '</p><p class="rf-note">Formats lus : scan .sdb3 de Wireless Workbench (clic droit sur un scan, Enregistrer), ou fichier .csv / .txt avec une fréquence et un niveau en dBm par ligne.</p>',
        '<button class="btn pri sm" onclick="rfModalClose()">Compris</button>', 520);
      return;
    }
    var d = RF.data, sc = { name:_rfStr(p.title || String(file.name || 'Scan').replace(/\.[a-z0-9]+$/i, ''), 80), a:g.a, b:g.b, th:d.scan ? d.scan.th : -95, d:_rfB64(g.d), use:true };
    var had = !!d.scan;
    d.scan = _rfScanClean(had && confirm('Un scan est déjà présent.\nOK : le compléter avec celui-ci (crête des deux).\nAnnuler : le remplacer.') ? _rfScanMerge(d.scan, sc) : sc);
    rfModalClose(); _rfSave(); renderRf(); if(RF.co) _rfCoordModal();
    var n = _rfScanBans(d.scan).length;
    toast('Scan repris : ' + _rfFmt(d.scan.a) + ' à ' + _rfFmt(d.scan.b) + ' MHz, ' + n + ' plage' + (n > 1 ? 's occupées' : ' occupée') + ' au-dessus de ' + d.scan.th + ' dBm');
  };
  r.readAsArrayBuffer(file);
}
function rfScanSet(k, v){
  var s = RF.data && RF.data.scan; if(!s) return;
  if(k === 'th') s.th = Math.max(-130, Math.min(-20, s.th + (v > 0 ? 5 : -5)));
  else if(k === 'use') s.use = !!v;
  else if(k === 'del'){ if(!confirm('Retirer le scan de ce show ?')) return; RF.data.scan = null; }
  _rfSave(); renderRf(); if(RF.co) _rfCoordModal();
}
function _rfScanBar(){
  var s = RF.data.scan;
  if(!s) return '<div class="rf-scan"><button type="button" class="btn sm" onclick="rfScan()"><i class="ti ti-chart-area-line"></i>Importer un scan</button><span>pour voir et éviter ce qui est déjà occupé sur place (.sdb3 de Workbench, .csv, .txt)</span></div>';
  var n = _rfScanBans(s).length;
  return '<div class="rf-scan on"><i class="ti ti-chart-area-line"></i><b>' + _bonE(s.name || 'Scan') + '</b><span>' + _rfFmt(s.a) + ' à ' + _rfFmt(s.b) + ' MHz</span>' +
    '<span class="rf-step" title="Seuil : au-dessus, la fréquence est tenue pour occupée"><button type="button" onclick="rfScanSet(\'th\',-1)" aria-label="Baisser le seuil"><i class="ti ti-minus"></i></button><b>' + s.th + ' dBm</b><button type="button" onclick="rfScanSet(\'th\',1)" aria-label="Monter le seuil"><i class="ti ti-plus"></i></button></span>' +
    '<label class="rf-imp-c"><input type="checkbox" class="cb" ' + (s.use ? 'checked' : '') + ' onchange="rfScanSet(\'use\',this.checked)"/><span>éviter les ' + n + ' plage' + (n > 1 ? 's' : '') + ' au-dessus du seuil</span></label>' +
    '<span class="rf-grow"></span><button type="button" class="btn sm" onclick="rfScan()">Autre scan</button><button type="button" class="rf-ib on" onclick="rfScanSet(\'del\')" title="Retirer le scan"><i class="ti ti-trash"></i></button></div>';
}

/* ── Consultation : retrouver vite une fréquence ou un utilisateur pendant le show ── */
function rfLook(on){ RF.look = !!on; RF.lq = ''; renderRf(); _rfSelSync(); if(on){ var i = document.getElementById('rf-lq'); if(i) i.focus(); } }
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
      '<button type="button" class="rf-lkc-s' + (c.lk ? ' on' : '') + '" onclick="rfLock(this)" title="' + (c.lk ? 'Libérer la fréquence' : 'Verrouiller la fréquence') + '"><i class="ti ' + (c.lk ? 'ti-lock' : 'ti-lock-open') + '"></i>' + (c.lk ? 'Verrouillée' : 'Libre') + '</button></div>';
  }).join('') : '<p class="rf-void"><i class="ti ti-search-off"></i>Aucun canal ne correspond.</p>';
}

/* ── Exports ── */
function rfCsv(){
  var d = RF.data; if(!d || !d.ch.length) return;
  var q = function(v){ v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var il = _rfIl(), rows = {}, outs = {};
  il.chs.forEach(function(r){ rows[r.id] = r; }); il.outs.forEach(function(r){ outs[r.id] = r; });
  var lines = [['Zone', 'Nom', 'Utilisateur', 'Type', 'Fréquence (MHz)', 'Bande', 'Fabricant', 'Modèle', 'Appareil', 'Groupe/canal', 'Puissance (mW)', 'Verrouillée', 'Input list', 'Note'].join(';')];
  _rfVisible().forEach(function(c){
    var r = c.il ? rows[c.il] : (c.out ? outs[c.out] : null);
    lines.push([c.zone, c.n, c.who, _rfKindLbl(c), _rfFmt(c.f), c.band, c.mk, c.mdl, c.dev, c.gc, c.pw || '', c.lk ? 'oui' : 'non', r ? (c.out && !c.il ? 'OUT ' : '') + r.ch + ' ' + r.name : '', c.note].map(q).join(';'));
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
      para('Contrôles simples sur les fréquences saisies (doublons, espacement du profil de la session, plage d\'accord, exclusions). Ce document ne remplace pas un scan sur place.', K.muted, 7.4);
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
