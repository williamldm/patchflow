// ══════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════
const SB_URL='https://ofiiutcueoogmtdvaupg.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9maWl1dGN1ZW9vZ210ZHZhdXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTA2NjcsImV4cCI6MjA5NDQyNjY2N30.PSZMkuq7GBJiQMhh5shH_tOZ6DAmA310K4c7au9e4mE';

/* Détection précoce du flux de réinitialisation de mot de passe.
   Le lien envoyé par Supabase contient soit:
   - #access_token=...&type=recovery (flux legacy, hash)
   - ?code=... avec query reset=1 (flux PKCE, query string)
   On lit cela AVANT de créer le client Supabase pour pouvoir désactiver
   detectSessionInUrl et empêcher l'auto-connection. */
var _recoveryTokens = null; // {accessToken, refreshToken} si flux legacy
var _recoveryCode   = null; // string si flux PKCE
var _inPasswordRecovery = (function(){
  var h = window.location.hash || '';
  var q = window.location.search || '';
  // Flux legacy: tokens dans le hash
  if (h.includes('type=recovery')) {
    var p = new URLSearchParams(h.substring(1));
    _recoveryTokens = {
      accessToken:  p.get('access_token'),
      refreshToken: p.get('refresh_token')
    };
    return true;
  }
  // Flux PKCE: code dans le query string + flag ?reset=1
  if (q.includes('reset=1')) {
    var qp = new URLSearchParams(q);
    _recoveryCode = qp.get('code');
    return true;
  }
  return false;
}());

/* Si on est en mode reset, créer le client avec persistSession:false et
   detectSessionInUrl:false pour empêcher Supabase de créer la session
   automatiquement (ce qui ouvrirait l'app au lieu du formulaire). */
const sb = _inPasswordRecovery
  ? supabase.createClient(SB_URL, SB_KEY, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false,
      }
    })
  : supabase.createClient(SB_URL, SB_KEY);

/* Base d'URL des liens PARTAGES : page rider dediee (sans login),
   pas l'app. Remplace le dernier segment du chemin par rider.html. */
function _riderBase(){ return window.location.origin + window.location.pathname.replace(/[^\/]*$/, 'rider.html'); }


/* En mode reset, nettoyer toute ancienne session pour éviter la connexion auto */
if (_inPasswordRecovery) {
  // Nettoyer le hash de l'URL (sécurité: ne pas laisser le token visible)
  try {
    if (window.location.hash.includes('type=recovery')) {
      history.replaceState(null, '', window.location.pathname + '?reset=1');
    }
  } catch(_){}
  // Effacer le localStorage Supabase de toutes les anciennes sessions
  try {
    Object.keys(localStorage).forEach(function(k){
      if (k.startsWith('sb-') || k.startsWith('supabase.')) localStorage.removeItem(k);
    });
  } catch(_){}
}

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let ME=null, PROFILE=null;
let SHOWS=[], CUR_SHOW=null, SHOW_MEMBERS_MAP={}, SHOW_OWNERS_CACHE={}, SHOW_STORAGE_MAP={};
let DELETED_SHOWS=[];   // shows en corbeille (Pro) — restaurables 30 jours
const TRASH_RETENTION_DAYS=30;
let SHOW_SCENES={syno:[],stage:[],site:[]};
let CUR_SCENES={syno:null,stage:null,site:null};
let CHS=[];
let _chRTSuppress=0;     // timestamp jusqu'auquel on ignore le toast realtime (undo en cours)
let ALL_CHS=[];          // tous les canaux du show, toutes les input lists (patches)
/* Résout un canal par id à travers TOUTES les input lists (pas seulement le
   patch actif) — utilisé par le plan de scène pour lier/afficher des canaux
   provenant de n'importe quelle liste. Repli sur CHS si ALL_CHS vide. */
function _chById(id){
  if(!id) return null;
  if(typeof ALL_CHS!=='undefined' && ALL_CHS.length){ const r=ALL_CHS.find(c=>c.id===id); if(r) return r; }
  return (typeof CHS!=='undefined'?CHS:[]).find(c=>c.id===id)||null;
}
let ALL_OUT=[];          // toutes les sorties (Output List) de toutes les listes
/* Résout une sortie par id à travers toutes les input lists — pour afficher
   le numéro OUT des retours dans le plan de scène (éditeur, export, rider). */
function _outById(id){
  if(!id) return null;
  if(typeof ALL_OUT!=='undefined' && ALL_OUT.length){ const r=ALL_OUT.find(c=>c.id===id); if(r) return r; }
  return (typeof OUT_CHS!=='undefined'?OUT_CHS:[]).find(c=>c.id===id)||null;
}
/* Reconstruit ALL_OUT à partir d'un objet out_data ({ [patch]: [...] }). */
function _rebuildAllOut(outData){
  ALL_OUT=[];
  if(outData&&typeof outData==='object'){ Object.keys(outData).forEach(function(k){ (outData[k]||[]).forEach(function(o){ ALL_OUT.push(o); }); }); }
}
let IL_PATCHES=[{id:'main',name:'Patch 1',pos:0}];
let CUR_PATCH_ID='main';
let CUR_IL_MODE='in';   // 'in' | 'out'
let OUT_CHS=[];         // sorties du patch courant
let OUT_DATA={};        // { [patch_id]: [...out_channels] }
let _saveOutTimer=null;
let _pdfExportType='in';          // 'in' | 'out'
let _pdfOrient='landscape';       // orientation des plans visuels : 'landscape' | 'portrait'
let _pdfLogoDataUrl=null;         // base64 logo studio
let _pdfBranding={co:'',site:'',color:'#ff6b1a',tagline:''};
let _patchColReady=false;
let RT=null, saveT=null;
let USER_TPLS=[];
let SEL_TPL=null, IM_MODE='replace';
let CODA_AMPS=[];
let stageEls=[],stageId=1,drag=null,dox=0,doy=0;
let PLAN_MODE='scene';
const _VISCOL_KEY='pf_viscol';
function _saveVisCol(){try{localStorage.setItem(_VISCOL_KEY,JSON.stringify([...visCol]));}catch(e){}}
function _loadVisCol(){try{var s=localStorage.getItem(_VISCOL_KEY);if(s){var a=JSON.parse(s);if(Array.isArray(a)&&a.length)return new Set(a);}}catch(e){}return new Set(['short','long','src','mic','gain','phantom','iem','foh','mon','note']);}
let visCol=_loadVisCol();
let pdfMeta={};
let prevType='';

// ══════════════════════════════════════
// AUTH
// ══════════════════════════════════════
function authTab(t){
  document.getElementById('form-login').style.display=t==='login'?'block':'none';
  document.getElementById('form-reg').style.display=t==='reg'?'block':'none';
  document.getElementById('form-forgot').style.display=t==='forgot'?'block':'none';
  const tabBar=document.getElementById('auth-tabs-bar');
  if(tabBar) tabBar.style.display=t==='forgot'?'none':'flex';
  if(t!=='forgot'){
    document.getElementById('tab-login').className='auth-tab'+(t==='login'?' on':'');
    document.getElementById('tab-reg').className='auth-tab'+(t==='reg'?' on':'');
  }
  authMsg('','');
}

async function doOAuth(provider){
  try{
    const {error}=await sb.auth.signInWithOAuth({
      provider,
      options:{ redirectTo: window.location.origin+window.location.pathname }
    });
    if(error) authMsg(error.message,'err');
  }catch(e){ authMsg('Erreur : '+e.message,'err'); }
}

async function doForgot(){
  const email=document.getElementById('f-email').value.trim();
  if(!email){authMsg('Saisis ton adresse e-mail.','err');return;}
  const btn=document.getElementById('f-btn');
  btn.disabled=true;btn.textContent='Envoi…';
  try{
    const {error}=await sb.auth.resetPasswordForEmail(email,{
      redirectTo: window.location.origin+window.location.pathname+'?reset=1'
    });
    if(error){ authMsg(error.message,'err'); }
    else{ authMsg('Lien envoyé ! Vérifie ta boîte mail.','ok'); btn.textContent='Envoyé ✓'; return; }
  }catch(e){ authMsg('Erreur réseau : '+e.message,'err'); }
  btn.disabled=false; btn.textContent='Envoyer le lien';
}
function authMsg(msg,type){
  const el=document.getElementById('auth-msg');
  el.textContent=msg;el.className='auth-msg'+(msg?' show':'')+(type?' '+type:'');
}
async function doLogin(){
  const email=document.getElementById('l-email').value.trim();
  const pwd=document.getElementById('l-pwd').value;
  if(!email||!pwd){authMsg('Remplis tous les champs.','err');return;}
  const btn=document.getElementById('l-btn');
  btn.disabled=true;btn.textContent='Connexion…';
  try{
    const {error}=await sb.auth.signInWithPassword({email,password:pwd});
    if(error){
      let m=error.message;
      if(m.includes('Invalid login'))m='Email ou mot de passe incorrect.';
      else if(m.includes('Email not confirmed'))m='Vérifie ta boîte mail et clique le lien de confirmation avant de te connecter.';
      authMsg(m,'err');
    }
  }catch(e){authMsg('Erreur réseau : '+e.message,'err');}
  btn.disabled=false;btn.textContent='Se connecter';
}
async function doReg(){
  const name=document.getElementById('r-name').value.trim();
  const email=document.getElementById('r-email').value.trim();
  const pwd=document.getElementById('r-pwd').value;
  const role=document.getElementById('r-role').value;
  if(!name||!email||!pwd){authMsg('Remplis tous les champs.','err');return;}
  if(pwd.length<6){authMsg('Mot de passe trop court.','err');return;}
  const btn=document.getElementById('r-btn');btn.disabled=true;btn.textContent='Création…';
  try{
    const {data,error}=await sb.auth.signUp({
      email,
      password:pwd,
      options:{
        data:{full_name:name,role},
        emailRedirectTo: 'https://patchflow.fr/app.html'
      }
    });
    if(error){authMsg(error.message,'err');}
    else if(data.session){/* Email confirmation disabled — onAuthStateChange handles it */}
    else{authMsg('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.','ok');}
  }catch(e){authMsg('Erreur : '+e.message,'err');}
  btn.disabled=false;btn.textContent='Créer mon compte';
}
async function doLogout(){
  await sb.auth.signOut();
  /* Masquer les overlays mobiles avant de revenir à l'auth */
  ['mob-syno-ov','mob-stage-ov'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.classList.remove('mob-plan-show');
  });
  /* Nettoyer les caches mémoire pour éviter les fuites de données entre comptes */
  try{
    SHOWS=[]; CUR_SHOW=null; CHS=[]; OUT_CHS=[]; PROFILE=null;
    SHOW_SCENES={syno:[],stage:[],site:[]}; CUR_SCENES={syno:null,stage:null,site:null};
    SHARED_LINKS=new Set(); SHOW_STORAGE_MAP={}; SHOW_MEMBERS_MAP={};
    _storageCache=null;
    /* Nettoyer les clés localStorage spécifiques user (les autres comptes sur la même
       machine ne doivent pas voir les données du précédent utilisateur) */
    for(var i=localStorage.length-1;i>=0;i--){
      var k=localStorage.key(i);
      if(k&&(k.startsWith('pf_cur_scenes_')||k.startsWith('out_data_')||k.startsWith('siteplan_')||k.startsWith('pf_synpro_'))){
        try{localStorage.removeItem(k);}catch(e){}
      }
    }
  }catch(e){console.warn('[logout cleanup]',e);}
  document.getElementById('auth-wrap').className='auth-wrap show';
  document.getElementById('app').className='';
}

// ══════════════════════════════════════
// SESSION INIT
// ══════════════════════════════════════
/* Sauvegarder ?invite=<id> IMMÉDIATEMENT (avant toute redirection / login) :
   si l'utilisateur clique le lien email sans être connecté, l'URL peut être
   perdue après le login → on persiste en sessionStorage pour réessayer. */
(function(){
  try{
    var p=new URLSearchParams(location.search);
    var inv=p.get('invite');
    if(inv) sessionStorage.setItem('pf_pending_invite', inv);
  }catch(e){}
}());

/* Afficher le formulaire de reset immédiatement si l'URL l'indique,
   sans attendre onAuthStateChange (qui peut arriver trop tard). */
(function(){
  if(!_inPasswordRecovery) return;
  // Dès que le DOM est prêt, basculer sur le formulaire de reset
  function _showResetForm(){
    var aw=document.getElementById('auth-wrap');
    if(!aw) return;
    aw.className='auth-wrap show';
    document.getElementById('app').className='';
    ['form-login','form-signup','form-forgot'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.style.display='none';
    });
    var tabBar=document.getElementById('auth-tabs');
    if(tabBar) tabBar.style.display='none';
    var resetForm=document.getElementById('form-reset');
    if(resetForm) resetForm.style.display='block';
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',_showResetForm);
  } else {
    _showResetForm();
  }
}());

sb.auth.onAuthStateChange(async(event,session)=>{
  /* Vue rider partagée (?link=/?rider=/?view=) : on n'initialise JAMAIS l'app
     complète — elle resterait cachée derrière le rider mais chargerait tout
     (shows, canaux, rendu) en tâche de fond → lenteur + flash. checkShareMode
     s'occupe seul de la vue partagée. */
  if(window.__riderMode) return;
  /* Lien de réinitialisation : Supabase fire PASSWORD_RECOVERY puis SIGNED_IN.
     On intercepte les deux pour rester sur le formulaire. */
  if(event==='PASSWORD_RECOVERY'){
    _inPasswordRecovery=true;
    ME=session?.user||null;
    // S'assurer que le formulaire est visible (cas où la détection URL a raté)
    var resetForm=document.getElementById('form-reset');
    if(resetForm&&resetForm.style.display==='none'){
      document.getElementById('auth-wrap').className='auth-wrap show';
      document.getElementById('app').className='';
      ['form-login','form-signup','form-forgot'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.style.display='none';
      });
      var tabBar=document.getElementById('auth-tabs');
      if(tabBar) tabBar.style.display='none';
      resetForm.style.display='block';
    }
    return;
  }
  /* Bloquer SIGNED_IN et TOKEN_REFRESHED pendant le reset */
  if(_inPasswordRecovery && (event==='SIGNED_IN'||event==='TOKEN_REFRESHED')) return;
  if(!session?.user){
    /* Déconnexion : réarmer le guard pour autoriser une ré-init au prochain login */
    window._appInitDone=false; window._appInitUser=null;
    return;
  }
  ME=session.user;
  document.getElementById('auth-wrap').className='auth-wrap';
  document.getElementById('app').className='show';
  /* N'initialiser qu'UNE fois par utilisateur. onAuthStateChange refire
     périodiquement (TOKEN_REFRESHED ~1×/h, USER_UPDATED, refocus d'onglet) ;
     relancer initApp à chaque fois rechargeait toute l'app et re-basculait le
     show actif → l'utilisateur se retrouvait parfois sur un autre show « sans
     raison ». On ne ré-init que pour un nouvel utilisateur (vrai login). */
  if(window._appInitDone && window._appInitUser===ME.id) return;
  window._appInitDone=true; window._appInitUser=ME.id;
  initApp();
});

async function doResetPassword(){
  var p1=(document.getElementById('r-pwd1')?.value||'').trim();
  var p2=(document.getElementById('r-pwd2')?.value||'').trim();
  var msg=document.getElementById('r-msg');
  var btn=document.getElementById('r-btn');
  function showMsg(text,isErr){
    if(!msg)return;
    msg.style.display='block';
    msg.className='auth-msg '+(isErr?'err':'ok');
    msg.textContent=text;
  }
  if(!p1||p1.length<8){showMsg('Le mot de passe doit faire au moins 8 caractères.',true);return;}
  if(p1!==p2){showMsg('Les mots de passe ne correspondent pas.',true);return;}
  if(btn){btn.disabled=true;btn.textContent='Mise à jour...';}

  /* Avant updateUser, on doit avoir une session valide avec le token recovery.
     Comme on a créé le client avec detectSessionInUrl:false, il faut établir
     la session manuellement à partir du token reçu dans le lien. */
  var setSessionErr = null;
  if (_recoveryTokens && _recoveryTokens.accessToken) {
    var sr = await sb.auth.setSession({
      access_token:  _recoveryTokens.accessToken,
      refresh_token: _recoveryTokens.refreshToken || '',
    });
    setSessionErr = sr.error;
  } else if (_recoveryCode) {
    var er = await sb.auth.exchangeCodeForSession(_recoveryCode);
    setSessionErr = er.error;
  }
  if (setSessionErr) {
    if(btn){btn.disabled=false;btn.textContent='Mettre à jour le mot de passe';}
    showMsg('Lien expiré ou invalide. Demande un nouveau lien depuis "Mot de passe oublié".', true);
    return;
  }

  var {error}=await sb.auth.updateUser({password:p1});
  if(btn){btn.disabled=false;btn.textContent='Mettre à jour le mot de passe';}
  if(error){showMsg('Erreur : '+error.message,true);return;}
  showMsg('Mot de passe mis à jour ! Redirection vers la connexion…',false);
  /* Le client de reset est en mode persistSession:false → on déconnecte
     proprement et on redirige vers /app.html sans paramètres pour que
     l'utilisateur se reconnecte avec le nouveau mdp. */
  try { await sb.auth.signOut(); } catch(_){}
  setTimeout(function(){
    window.location.href = window.location.pathname; // sans ?reset=1 ni #
  }, 1500);
}

function _withTimeout(promise,ms){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),ms))
  ]);
}

/* ════════════════════════════════════════════════════════════════════
   RÉSILIENCE RÉSEAU — retry exponentiel pour les appels critiques.
   Sur connexion 2G/3G ou wifi instable, un paquet perdu ne doit plus
   tuer l'app : on retry avec backoff exponentiel + jitter.
   ════════════════════════════════════════════════════════════════════ */
const NET_RETRY_DEFAULTS = { tries: 3, baseMs: 500, maxMs: 4000, timeoutMs: 12000 };

/* Erreurs réseau transitoires (à retry) vs erreurs métier (à propager) */
function _isTransientError(err){
  if(!err) return false;
  if(err.message==='timeout') return true;
  /* Erreurs de fetch : "Failed to fetch", "NetworkError", "Load failed", "AbortError" */
  const m = String(err.message||err).toLowerCase();
  if(m.includes('fetch')||m.includes('network')||m.includes('load failed')
     ||m.includes('timeout')||m.includes('econnreset')||m.includes('abort'))
    return true;
  /* Status HTTP : 5xx + 429 (rate limit) sont transitoires ; 4xx non */
  const s = err.status||err.statusCode;
  if(s===429||s===503||s===504||s===502||s===500) return true;
  return false;
}

/* Indique à l'UI qu'on retry — un toast léger pour informer sans paniquer */
let _retryInProgress = 0;
function _signalRetryStart(){
  _retryInProgress++;
  if(_retryInProgress===1 && typeof toast==='function'){
    toast('Connexion lente — nouvelle tentative…');
  }
}
function _signalRetryEnd(){
  _retryInProgress = Math.max(0, _retryInProgress-1);
}

/* Wrap n'importe quelle promesse avec retry+timeout. Renvoie la valeur résolue.
   - fn : function () => Promise (réexécutée à chaque tentative)
   - opts.label : utilisé pour les logs et la déduplication
   - opts.tries / baseMs / maxMs / timeoutMs : configurables (cf. NET_RETRY_DEFAULTS) */
async function _withRetry(fn, opts){
  const o = Object.assign({}, NET_RETRY_DEFAULTS, opts||{});
  /* Sur connexion lente détectée, on double le timeout d'office */
  if(isSlowConnection()) o.timeoutMs = o.timeoutMs * 2;
  let lastErr;
  for(let attempt=0; attempt<o.tries; attempt++){
    try{
      const result = await _withTimeout(fn(), o.timeoutMs);
      if(attempt>0) _signalRetryEnd();
      return result;
    }catch(e){
      lastErr = e;
      if(!_isTransientError(e) || attempt===o.tries-1){
        if(attempt>0) _signalRetryEnd();
        throw e;
      }
      if(attempt===0) _signalRetryStart();
      /* Backoff exponentiel + jitter (évite la "thundering herd") */
      const delay = Math.min(o.maxMs, o.baseMs * Math.pow(2,attempt))
                  + Math.random()*200;
      if(o.label) console.warn('[retry]',o.label,'attempt',attempt+1,'failed:',e.message,'→ retry in',Math.round(delay),'ms');
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  _signalRetryEnd();
  throw lastErr;
}

/* Déduplication : si plusieurs callers demandent la même requête en parallèle,
   ils partagent la même promesse (évite N requêtes identiques sur init). */
const _inflight = new Map();
function _dedup(key, fn){
  if(_inflight.has(key)) return _inflight.get(key);
  const p = fn().finally(()=>{ _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
}

/* Détection débit lent — pour adapter timeouts/compressions */
function _isSlowConnection(){
  /* Navigator.connection API (Chrome/Edge/Android) */
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(c){
    if(c.saveData) return true;
    if(c.effectiveType==='slow-2g'||c.effectiveType==='2g'||c.effectiveType==='3g') return true;
    if(c.downlink && c.downlink < 1.5) return true; // < 1.5 Mbps
  }
  return false;
}
/* Cache la valeur 30s pour éviter de la recalculer constamment */
let _slowConnCache = null, _slowConnTs = 0;
function isSlowConnection(){
  const now = Date.now();
  if(_slowConnCache===null || now-_slowConnTs>30000){
    _slowConnCache = _isSlowConnection();
    _slowConnTs = now;
  }
  return _slowConnCache;
}
function _showInitError(msg){
  var errHtml='<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px 20px;text-align:center">'
    +'<i class="ti ti-wifi-off" style="font-size:36px;color:#f87171"></i>'
    +'<div style="font-size:14px;font-weight:600;color:var(--txt)">Impossible de charger l\'application</div>'
    +'<div style="font-size:12px;color:var(--muted);max-width:320px">'+msg+'</div>'
    +'<div style="display:flex;gap:10px">'
      +'<button class="btn sm" onclick="initApp()" style="background:var(--ora);color:#000"><i class="ti ti-refresh"></i>Reessayer</button>'
      +'<button class="btn ghost sm" onclick="sb.auth.signOut()"><i class="ti ti-logout"></i>Se deconnecter</button>'
    +'</div>'
  +'</div>';
  setILBody(errHtml,true);
  var el=document.getElementById('cur-show-name');if(el)el.textContent='Erreur';
}
async function initApp(){
  /* GUARD anti-concurrence : onAuthStateChange peut fire plusieurs fois
     (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED) → évite les initApp parallèles
     qui rechargeaient tout en double et provoquaient des races (auto-accept, etc). */
  if(window._initAppRunning) return;
  window._initAppRunning=true;
  setILBody('<div class="loading"><div class="spinner"></div>Connexion a Supabase…</div>',true);
  try{
    /* PARALLÉLISATION : profile et shows en // — sur connexion lente, on gagne
       jusqu'à 50% du temps de chargement (au lieu de 8+10s séquentiel → max(8,10)). */
    await Promise.all([
      _withRetry(()=>loadProfile(), {label:'loadProfile', timeoutMs:10000, tries:3}),
      _withRetry(()=>loadShows(),   {label:'loadShows',   timeoutMs:12000, tries:3})
    ]);
    _handleCheckoutReturn(); // retour de paiement Lemon Squeezy
    _initSharedLinks(); // suivi des liens de partage (limite Gratuit)
    processShowInvites(); // charge les invitations en attente (notifications)
    /* Rafraîchir les notifications périodiquement (badge en quasi temps réel) */
    if(!window._notifPoll){
      window._notifPoll=setInterval(function(){ if(ME) refreshNotifications(); },60000);
    }
    loadColChips();
    initStage();
  }catch(e){
    console.error('initApp error:',e);
    var isTimeout=e.message==='timeout';
    var isOffline=!navigator.onLine;
    var msg=isOffline
      ?'Vous etes hors ligne. Verifiez votre connexion puis reessayez.'
      :isTimeout
        ?'La connexion prend trop de temps. Verifiez votre reseau ou l\'etat de Supabase.'
        :'Erreur : '+e.message;
    _showInitError(msg);
    if(isOffline)_showOfflineBanner();
  }finally{
    window._initAppRunning=false;
  }
}

async function loadProfile(){
  let {data}=await sb.from('profiles').select('id,full_name,role,company,contact,avatar_url,plan,shared_links').eq('id',ME.id).maybeSingle();
  if(!data){
    // Profil absent — le creer pour satisfaire la FK shows.owner_id -> profiles.id
    const {data:created,error:perr}=await sb.from('profiles').upsert(
      {id:ME.id,full_name:ME.email,role:'FOH Engineer'},
      {onConflict:'id'}
    ).select().maybeSingle();
    if(!perr) data=created;
  }
  PROFILE=data||{id:ME.id,full_name:ME.email,role:'FOH Engineer'};
  if(!PROFILE.plan) console.warn('[PatchFlow] plan manquant — verifiez la colonne plan dans Supabase profiles.');
  document.getElementById('u-name').textContent=PROFILE.full_name||ME.email;
  document.getElementById('u-email').textContent=ME.email;
  _refreshAllAvatars();
  _refreshPlanBadge();
  // Pre-fill PDF meta with profile
  document.getElementById('pdf-eng').value=PROFILE.full_name||'';
  document.getElementById('pdf-role').value=PROFILE.role||'';
  document.getElementById('pdf-co').value=PROFILE.company||'';
  document.getElementById('pdf-tel').value=PROFILE.contact||'';
}

// ══════════════════════════════════════
// SHOWS
// ══════════════════════════════════════
/* Clé localStorage pour cache shows par utilisateur */
function _showsCacheKey(){ return 'pf_shows_cache_'+(ME?.id||'anon'); }

/* Stale-while-revalidate : montre le cache local immédiatement
   (UX instantanée sur connexion lente), puis rafraîchit depuis le réseau */
function _loadShowsFromCache(){
  try{
    const raw=localStorage.getItem(_showsCacheKey());
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    /* Expire après 7 jours pour éviter les données trop obsolètes */
    if(Date.now()-parsed.ts > 7*86400*1000) return null;
    return parsed.shows;
  }catch(e){return null;}
}

async function loadShows(){
  /* Étape 1 : afficher le cache local immédiatement si dispo (UX rapide) */
  const cached = _loadShowsFromCache();
  if(cached && cached.length && (!SHOWS || !SHOWS.length)){
    SHOWS = cached;
    /* Pré-render mais marqueur "données peuvent être obsolètes" */
    try{ renderSessions(); }catch(e){}
  }

  // Load shows owned by the user (avec sélection plus compacte côté liste)
  const {data:ownedData,error:ownedErr}=await sb.from('shows').select('*').order('created_at',{ascending:false});
  if(ownedErr){console.error('shows error:',ownedErr);throw new Error(ownedErr.message);}

  // Also load shows the user is a member of (invited)
  // Use two queries to avoid circular RLS recursion (shows ↔ show_members)
  const {data:memberRows}=await sb.from('show_members')
    .select('show_id')
    .eq('user_id',ME.id);
  const memberIds=(memberRows||[]).map(m=>m.show_id).filter(Boolean);
  let memberShows=[];
  if(memberIds.length){
    const {data:mShows}=await sb.from('shows').select('*').in('id',memberIds);
    memberShows=mShows||[];
  }

  // Merge, deduplicate by id
  const allShows=[...(ownedData||[]),...memberShows];
  const seen=new Set();
  const deduped=allShows.filter(s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;});
  /* Séparation corbeille / actifs — filtrage 100% côté client (deleted_at peut
     ne pas exister encore : undefined → traité comme actif, aucune requête ne casse). */
  DELETED_SHOWS=deduped.filter(s=>s.deleted_at && s.owner_id===ME.id)
    .sort((a,b)=>new Date(b.deleted_at)-new Date(a.deleted_at));
  SHOWS=deduped.filter(s=>!s.deleted_at)
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  _updTrashBtn();

  /* Rendu IMMÉDIAT de tous les shows (owned + partagés) — garantit que la liste
     complète s'affiche même si une étape ultérieure (membres, stockage) échoue. */
  try{ renderSPShows(); }catch(e){}
  try{ renderSessions(); }catch(e){}

  /* Étape 2 : persister une version compacte du cache pour le prochain chargement */
  try{
    /* On ne stocke pas stage_data (peut être très lourd à cause des base64 images) */
    const lite = SHOWS.map(s=>({
      id:s.id, name:s.name, owner_id:s.owner_id, created_at:s.created_at,
      brand_color:s.brand_color, color:s.color
    }));
    localStorage.setItem(_showsCacheKey(), JSON.stringify({ts:Date.now(),shows:lite}));
  }catch(e){/* Quota atteint — ignorer */}
  try{ await loadAllShowMembers(); }catch(e){ console.warn('loadAllShowMembers:',e); }
  renderSPShows();
  renderSessions();
  loadShowStorage(); // async, non-bloquant
  if(SHOWS.length>0){
    /* Si un show est déjà actif ET toujours présent dans la liste, on le
       CONSERVE. loadShows() peut être rappelé (acceptation d'invitation,
       refresh de liste) ; sans cette garde, il re-basculait sur un autre show. */
    if(CUR_SHOW && SHOWS.some(s=>s.id===CUR_SHOW.id)){
      CUR_SHOW=SHOWS.find(s=>s.id===CUR_SHOW.id)||CUR_SHOW; // rafraîchir l'objet
      renderSPShows();
    } else {
      /* Restore last active show — fallback to first if not found / no longer accessible */
      let lastShowId=null;
      try{ lastShowId=localStorage.getItem(SHOW_PERSIST_KEY); }catch(e){}
      if(lastShowId && SHOWS.some(s=>s.id===lastShowId)){
        await switchShow(lastShowId);                  // restauration explicite
      } else {
        /* Repli : 1er show de la liste. On NE persiste PAS ce choix — si la
           liste était transitoirement incomplète (réseau/RLS), le vrai dernier
           show reste mémorisé pour le prochain chargement. */
        await switchShow(SHOWS[0].id, {persist:false});
      }
    }
  }
  else await _maybeCreateDefaultShow();
  /* Restore last active tab after everything is loaded */
  try{
    const lastTab=localStorage.getItem(TAB_PERSIST_KEY);
    const validTabs=['sessions','fichiers','inputlist','showfiles','synoptique','stage','team'];
    if(lastTab&&validTabs.includes(lastTab)&&lastTab!=='sessions'){
      goTab(lastTab,null);
    }
  }catch(e){}
}

// ══════════════════════════════════════
// MULTI-SCÈNES (Studio uniquement)
// ══════════════════════════════════════
const SCENE_TYPES=['syno','stage','site'];
const SCENE_LABELS={syno:'Synoptique',stage:'Plan de scène',site:'Plan de site'};

async function loadScenes(showId){
  SHOW_SCENES={syno:[],stage:[],site:[]};
  CUR_SCENES={syno:null,stage:null,site:null};
  /* On charge TOUJOURS les scènes : un membre non-Studio d'un show créé par un
     propriétaire Studio doit pouvoir LIRE les plans stockés dans show_scenes
     (sinon plan de site/scène vide). L'auto-création de scènes, elle, reste
     réservée aux comptes Studio (voir plus bas). Le lieu de stockage dépend du
     plan du PROPRIÉTAIRE, pas de celui du lecteur. */
  const {data,error}=await sb.from('show_scenes').select('*').eq('show_id',showId).order('position');
  if(error){console.error('loadScenes:',error); _renderAllSceneTabs(); return;}
  (data||[]).forEach(function(s){
    if(!SHOW_SCENES[s.type]) SHOW_SCENES[s.type]=[];
    SHOW_SCENES[s.type].push(s);
  });

  /* ── Nettoyage de doublons d'ID ── */
  SCENE_TYPES.forEach(function(t){
    var seenIds={};
    SHOW_SCENES[t]=SHOW_SCENES[t].filter(function(s){
      if(seenIds[s.id]) return false;
      seenIds[s.id]=true;
      return true;
    });
  });

  /* ── Auto-création de la Scène 1 pour les types sans scène.
     Le premier tab doit toujours être présent visuellement dès l'ouverture ;
     le "+" ne sert qu'à créer les scènes suivantes.
     On inclut les données legacy (stage_data / synoptique_data) si elles existent,
     pour que la scène 1 contienne déjà le travail existant. ── */
  const toInit=[];
  const raw=CUR_SHOW?.stage_data;
  /* Auto-création réservée aux Studio : un membre non-Studio ne doit jamais
     créer de scènes (échec RLS + scènes parasites). Il lit seulement. */
  if(canDo('multi_scenes')) SCENE_TYPES.forEach(function(t){
    if(SHOW_SCENES[t].length===0){
      var initialData=null;
      if(t==='stage' && raw?.band!=null)                   initialData={band:raw.band};
      else if(t==='site' && raw?.site!=null)               initialData={site:raw.site};
      else if(t==='syno' && CUR_SHOW?.synoptique_data!=null) initialData=CUR_SHOW.synoptique_data;
      toInit.push({show_id:showId,type:t,name:SCENE_LABELS[t]+' 1',data:initialData,position:0});
    }
  });
  if(toInit.length){
    const {data:created,error:cErr}=await sb.from('show_scenes').insert(toInit).select();
    if(!cErr && created){
      created.forEach(function(s){ SHOW_SCENES[s.type].push(s); });
    } else if(cErr){
      /* Race condition (deux onglets) : recharger ce qui est en DB */
      const {data:re}=await sb.from('show_scenes').select('*').eq('show_id',showId).order('position');
      (re||[]).forEach(function(s){
        if(!SHOW_SCENES[s.type]) SHOW_SCENES[s.type]=[];
        if(!SHOW_SCENES[s.type].find(function(x){return x.id===s.id;})) SHOW_SCENES[s.type].push(s);
      });
    }
  }

  // Restaurer la dernière scène active (mémorisée dans localStorage), sinon la première
  var _lsSceneKey='pf_cur_scenes_'+showId;
  var _savedScenes=null;
  try{_savedScenes=JSON.parse(localStorage.getItem(_lsSceneKey)||'null');}catch(e){}
  SCENE_TYPES.forEach(function(t){
    var lastId=_savedScenes&&_savedScenes[t];
    var found=lastId&&SHOW_SCENES[t].find(function(s){return s.id===lastId;});
    CUR_SCENES[t]=(found?found.id:null)||(SHOW_SCENES[t][0]?.id||null);
  });
  _renderAllSceneTabs();
}
/* ── Retourne les données d'une scène.
   La scène 1 est maintenant créée avec les données legacy directement
   dans loadScenes(), donc ce fallback ne sert plus qu'aux nouvelles scènes
   créées vides intentionnellement (elles doivent rester vides). ── */
function _firstSceneFallback(type, sceneData){
  return sceneData ?? null; // données telles quelles (null = scène vide)
}

function _renderAllSceneTabs(){
  SCENE_TYPES.forEach(_renderSceneTabs);
}

function _renderSceneTabs(type){
  const elId='scene-tabs-'+type;
  const el=document.getElementById(elId);
  if(!el) return;
  const isStudio=canDo('multi_scenes');
  /* Pour syno : toujours afficher. Pour stage/site : setPlanMode gère la visibilité */
  if(type==='syno') el.classList.remove('hidden');
  else if(type==='stage') el.classList.toggle('hidden', PLAN_MODE!=='scene');
  else if(type==='site')  el.classList.toggle('hidden', PLAN_MODE!=='site');

  if(!isStudio){
    /* Non-Studio : afficher un aperçu verrouillé */
    el.innerHTML=`
      <div class="il-ptab active" style="opacity:.5;cursor:default">Scène 1</div>
      <div class="il-ptab" style="opacity:.35;cursor:default">Scène 2</div>
      <button class="il-ptab-add" onclick="showUpgradeModal('multi_patches')" title="Plusieurs scènes — Pro" style="position:relative">+</button>
      <span onclick="showUpgradeModal('multi_patches')" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-family:var(--m);color:var(--ora);background:var(--ora-d);border:1px solid var(--ora-g);border-radius:6px;padding:3px 9px;cursor:pointer;white-space:nowrap" title="Disponible avec le plan Pro">
        <i class="ti ti-lock" style="font-size:11px"></i>Pro
      </span>`;
    return;
  }

  const scenes=SHOW_SCENES[type]||[];
  el.innerHTML=scenes.map(function(s){
    const active=s.id===CUR_SCENES[type];
    return `<div class="il-ptab${active?' active':''}" onclick="switchScene('${type}','${s.id}')" ondblclick="renameScene('${type}','${s.id}')" title="Double-clic pour renommer">
      ${s.name}
      <button class="il-ptab-dup" onclick="event.stopPropagation();duplicateScene('${type}','${s.id}')" title="Dupliquer cette version"><i class="ti ti-copy"></i></button>
      ${scenes.length>1?`<button class="il-ptab-del" onclick="event.stopPropagation();deleteScene('${type}','${s.id}')" title="Supprimer">×</button>`:''}
    </div>`;
  }).join('')+'<button class="il-ptab-add" onclick="addScene(\''+type+'\')" title="Nouvelle version (vide)">+</button>';
}

async function switchScene(type,sceneId){
  if(sceneId===CUR_SCENES[type]) return;
  // Sauvegarder la scène courante avant de changer (selon le type)
  if(type==='syno')   await SynPro._saveNow();
  if(type==='stage')  await saveStage();
  if(type==='site')   await saveSite();
  CUR_SCENES[type]=sceneId;
  _persistCurScenes();
  _renderSceneTabs(type);
  // Charger la nouvelle scène
  const scene=SHOW_SCENES[type]?.find(s=>s.id===sceneId);
  if(!scene) return;
  if(type==='syno'){
    /* IMPORTANT : setSceneId AVANT resetLoaded, car resetLoaded efface
       _injectedSceneData. On passe les données directement à _load via
       le champ .data du scene objet — pas via setSceneData. */
    SynPro.setSceneId(sceneId);
    SynPro.loadSceneDirect(scene.data);  // charge directement sans sentinel
  } else if(type==='stage'){
    _loadSceneStage(scene);
  } else if(type==='site'){
    _loadSceneSite(scene);
  }
  /* Sur téléphone, le plan est un aperçu image : re-générer après bascule. */
  if(typeof _isMobile==='function' && _isMobile()){
    const ovId = (type==='syno') ? 'mob-syno-ov' : 'mob-stage-ov';
    const ov = document.getElementById(ovId);
    if(ov && ov.classList.contains('mob-plan-show')){
      setTimeout(function(){ _showMobilePlanView(type); }, 60);
    }
  }
}
function _persistCurScenes(){
  try{
    var _k='pf_cur_scenes_'+(CUR_SHOW?.id||'');
    localStorage.setItem(_k,JSON.stringify(CUR_SCENES));
  }catch(e){}
}

async function addScene(type){
  if(!CUR_SHOW){return;}
  if(!canDo('multi_scenes')){showUpgradeModal('multi_patches');return;}
  const name=prompt(`Nom du ${SCENE_LABELS[type]} :`, (SCENE_LABELS[type]+' '+(SHOW_SCENES[type].length+1)));
  if(!name||!name.trim()) return;
  const pos=SHOW_SCENES[type].length;
  const {data,error}=await sb.from('show_scenes').insert({
    show_id:CUR_SHOW.id, type, name:name.trim(), data:null, position:pos
  }).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  SHOW_SCENES[type].push(data);
  await switchScene(type,data.id);
}

/* Duplique une scène (plan de scène / site / synoptique) AVEC son contenu →
   crée une variante (version B) à partir d'une version A. Réservé Pro. */
async function duplicateScene(type,sceneId){
  if(!CUR_SHOW){return;}
  if(!canDo('multi_scenes')){showUpgradeModal('multi_patches');return;}
  const src=SHOW_SCENES[type].find(s=>s.id===sceneId);
  if(!src){toast('Scène introuvable.');return;}
  /* Données source : si c'est la scène ACTIVE, on prend l'état live du module
     (capture les modifs non encore sauvegardées) ; sinon la donnée stockée. */
  let srcData=null;
  if(sceneId===CUR_SCENES[type]){
    if(type==='stage')      srcData={band:BandPlan.getData()};
    else if(type==='site')  srcData={site:SitePlan.getData()};
    else if(type==='syno')  srcData=SynPro.getData();
  } else {
    srcData=src.data;
  }
  let copy=null;
  try{ copy = srcData ? JSON.parse(JSON.stringify(srcData)) : null; }catch(e){ copy=null; }
  const name=prompt('Nom de la variante :', (src.name||SCENE_LABELS[type])+' (copie)');
  if(!name||!name.trim()) return;
  const pos=SHOW_SCENES[type].length;
  const {data,error}=await sb.from('show_scenes').insert({
    show_id:CUR_SHOW.id, type, name:name.trim(), data:copy, position:pos
  }).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  SHOW_SCENES[type].push(data);
  await switchScene(type,data.id);
  toast('✓ Variante créée');
}

async function deleteScene(type,sceneId){
  if(SHOW_SCENES[type].length<=1){toast('Impossible de supprimer la dernière scène.');return;}
  const scene=SHOW_SCENES[type].find(s=>s.id===sceneId);
  if(!confirm('Supprimer "'+( scene?.name||'cette scène')+'\" ?')) return;
  const wasCurrent=(CUR_SCENES[type]===sceneId);
  const {error}=await sb.from('show_scenes').delete().eq('id',sceneId);
  if(error){toast('Erreur : '+error.message);return;}
  SHOW_SCENES[type]=SHOW_SCENES[type].filter(s=>s.id!==sceneId);
  if(!wasCurrent){
    // La scène supprimée n'était pas active : rien d'autre à charger, on ne
    // touche pas à la scène courante ni à son contenu en mémoire.
    _renderSceneTabs(type);
    return;
  }
  /* La scène active vient d'être supprimée. ATTENTION : le contenu en mémoire
     (BandPlan/SitePlan/SynPro) appartient encore à la scène effacée. On ne doit
     SURTOUT PAS appeler switchScene ici car il sauvegarderait d'abord cet état
     en mémoire — et écraserait la scène restante avec les données supprimées.
     On charge donc directement les données déjà en cache de la scène suivante. */
  const next=SHOW_SCENES[type][0]||null;
  CUR_SCENES[type]=next?next.id:null;
  _persistCurScenes();
  _renderSceneTabs(type);
  if(next){
    if(type==='syno'){ SynPro.setSceneId(next.id); SynPro.loadSceneDirect(next.data); }
    else if(type==='stage'){ _loadSceneStage(next); }
    else if(type==='site'){ _loadSceneSite(next); }
  }
}

async function renameScene(type,sceneId){
  const scene=SHOW_SCENES[type]?.find(s=>s.id===sceneId);
  if(!scene) return;
  const name=prompt('Renommer la scène :',scene.name);
  if(!name||!name.trim()||name===scene.name) return;
  const {error}=await sb.from('show_scenes').update({name:name.trim()}).eq('id',sceneId);
  if(error){toast('Erreur : '+error.message);return;}
  scene.name=name.trim();
  _renderSceneTabs(type);
}

/* Sauvegarde la scène courante dans show_scenes */
async function _saveScene(type,dataObj){
  const sceneId=CUR_SCENES[type];
  if(!sceneId||!canDo('multi_scenes')) return false;
  await sb.from('show_scenes').update({data:dataObj}).eq('id',sceneId);
  // Mettre à jour le cache local
  const scene=SHOW_SCENES[type]?.find(s=>s.id===sceneId);
  if(scene) scene.data=dataObj;
  return true;
}

/* Charge les données d'une scène stage (fallback migration paresseuse pour scène vide) */
function _loadSceneStage(scene){
  const d=_firstSceneFallback('stage', scene?.data??null);
  BandPlan.load(d?.band??null);
  if(typeof SectionUndo!=='undefined') SectionUndo.reset('stage', BandPlan.getData());
  setPlanMode('scene',false);
}

/* Charge les données d'une scène site (fallback migration paresseuse pour scène vide) */
function _loadSceneSite(scene){
  const d=_firstSceneFallback('site', scene?.data??null);
  SitePlan.load(d?.site??null);
  if(typeof SectionUndo!=='undefined') SectionUndo.reset('site', SitePlan.getData());
  setPlanMode('site',false);
}

/* Calcule la taille de stockage de chaque show en arrière-plan */
async function loadShowStorage(){
  /* PERF : un seul appel batché au lieu d'1 appel par show.
     Pour l'affichage par carte show, on agrège plus tard si besoin.
     Ici on calcule juste le total — les badges par show sont optionnels. */
  SHOW_STORAGE_MAP={};
  if(!SHOWS.length || !canDo('storage')) return;
  /* On garde le détail par show via /storage-used uniquement pour le show
     actuellement visible (lazy) — sinon trop d'appels au chargement.
     Le total global est dans Mon abonnement (user-storage). */
  const cur=CUR_SHOW?.id;
  if(cur){
    try{
      const {data}=await _b2Call('storage-used',{showId:cur});
      if(data?.bytes!=null) SHOW_STORAGE_MAP[cur]=data.bytes;
    }catch(e){}
  }
  renderSessions();
}

/* Quitter un show où on est invité */
async function leaveShow(showId,e){
  if(e) e.stopPropagation();
  const s=SHOWS.find(x=>x.id===showId);
  if(!confirm('Quitter le show "'+( s?.name||'ce show')+'" ?\nVous perdrez l\'accès à ce show.')) return;
  /* .select() pour vérifier qu'une ligne a VRAIMENT été supprimée : un DELETE
     bloqué par RLS renvoie 0 ligne SANS erreur → ne plus afficher un faux
     « quitté » qui laissait le show réapparaître au rechargement. */
  const {data:del,error}=await sb.from('show_members').delete().eq('show_id',showId).eq('user_id',ME.id).select('id');
  if(error){toast('Erreur : '+error.message);return;}
  if(!del||!del.length){toast('Impossible de quitter ce show (droits insuffisants).');return;}
  // Retirer le show de la liste locale
  SHOWS=SHOWS.filter(x=>x.id!==showId);
  if(CUR_SHOW?.id===showId){
    if(SHOWS.length>0) await switchShow(SHOWS[0].id);
    else await newShowDefault();
  }
  renderSPShows();
  renderSessions();
  toast('✓ Vous avez quitté le show.');
}

async function loadAllShowMembers(){
  SHOW_MEMBERS_MAP={};
  if(!SHOWS.length) return;
  /* Cache owner profiles for shows we don't own (so we can display owner info on shared shows) */
  const otherOwnerIds=[...new Set(SHOWS.filter(s=>s.owner_id!==ME?.id).map(s=>s.owner_id).filter(Boolean))];
  if(otherOwnerIds.length){
    const {data:ownerProfs}=await sb.from('profiles').select('id,full_name,email,plan,avatar_url').in('id',otherOwnerIds);
    (ownerProfs||[]).forEach(function(p){ SHOW_OWNERS_CACHE[p.id]=p; });
  }
  const ids=SHOWS.map(function(s){return s.id;});
  const {data}=await sb.from('show_members').select('*,profiles(full_name,email,role,plan,avatar_url)').in('show_id',ids);
  (data||[]).forEach(function(m){
    if(!SHOW_MEMBERS_MAP[m.show_id])SHOW_MEMBERS_MAP[m.show_id]=[];
    SHOW_MEMBERS_MAP[m.show_id].push(m);
  });
}

/* Auto-création SÛRE d'un show par défaut quand la liste est vide.
   Bug corrigé : pendant des soucis réseau/RLS, le SELECT shows pouvait renvoyer
   une liste VIDE sans erreur dure → newShowDefault() créait un show par défaut,
   répété à chaque rechargement → plusieurs « Mon premier show » en double.
   Gardes : (1) si un cache local contient des shows, un vide est forcément
   transitoire → on ne crée rien ; (2) double-vérification serveur par COUNT
   avant toute insertion ; (3) verrou anti-concurrence. */
let _creatingDefaultShow=false;
async function _maybeCreateDefaultShow(){
  if(_creatingDefaultShow) return;
  /* (1) Cache non vide → l'utilisateur a déjà des shows, le vide est transitoire. */
  const cached=_loadShowsFromCache();
  if(cached && cached.length){
    console.warn('[shows] liste vide mais cache non vide → résultat transitoire, aucune création.');
    SHOWS=cached; try{renderSPShows();renderSessions();}catch(e){}
    setILBody('<div class="loading" style="color:var(--muted)"><i class="ti ti-wifi-off" style="font-size:20px;color:#f87171"></i>Connexion instable — <button class="btn sm" onclick="initApp()" style="margin-left:8px">Réessayer</button></div>',true);
    return;
  }
  _creatingDefaultShow=true;
  try{
    /* (2) Double-vérification serveur : combien de shows possède réellement ce compte ? */
    const {count,error}=await sb.from('shows').select('id',{count:'exact',head:true}).eq('owner_id',ME.id);
    if(error){ console.error('[shows] verif count:',error); return; } // erreur → ne RIEN créer
    if(count && count>0){ await loadShows(); return; }               // il y en a → recharger, pas créer
    await newShowDefault();                                          // compte réellement vide → ok
  } finally { _creatingDefaultShow=false; }
}
async function newShowDefault(){
  const {data,error}=await sb.from('shows').insert({name:'Mon premier show',slug:'premier-show-'+Date.now(),owner_id:ME.id}).select().single();
  if(error){
    console.error('newShowDefault:',error);
    toast('Impossible de creer un show : '+error.message);
    // Afficher un etat d'erreur dans les panels plutot que de laisser les spinners
    setILBody('<div class="loading" style="color:var(--muted)"><i class="ti ti-alert-circle" style="font-size:20px;color:#f87171"></i>Erreur de connexion — <button class="btn sm" onclick="initApp()" style="margin-left:8px">Reessayer</button></div>',true);
    const teamGrid=document.getElementById('team-grid');
    if(teamGrid)teamGrid.innerHTML='<div class="loading" style="color:var(--muted)"><i class="ti ti-alert-circle" style="font-size:20px;color:#f87171"></i>Erreur de connexion</div>';
    return;
  }
  SHOWS=[data];renderSPShows();await switchShow(data.id);
}

async function switchShow(id, opts){
  _stageReady=false;
  CUR_SHOW=SHOWS.find(s=>s.id===id);
  if(!CUR_SHOW)return;
  /* Persist the active show so reload restores it — SAUF bascule automatique
     de repli (opts.persist===false) : on ne veut pas écraser le dernier show
     réellement choisi par l'utilisateur si la liste était transitoirement
     incomplète (un repli sur SHOWS[0] mémorisé devenait "collant"). */
  if(!opts || opts.persist!==false){
    try{ localStorage.setItem(SHOW_PERSIST_KEY, id); }catch(e){}
  }
  const n=CUR_SHOW.name;
  document.getElementById('cur-show-name').textContent=n;
  const tbn=document.getElementById('tb-show-name');if(tbn)tbn.textContent=n;
  ['il','sf','stage','team'].forEach(k=>{const el=document.getElementById('sn-'+k);if(el)el.textContent=n;});
  document.getElementById('slink-url').textContent=`${_riderBase()}?view=${CUR_SHOW.id}&tab=il`;
  renderSPShows();
  // Init patches
  IL_PATCHES=loadPatchMeta();
  CUR_PATCH_ID=IL_PATCHES[0]?.id||'main';
  renderPatchTabs();
  // Load all show-specific data in parallel
  if(typeof SynPro!=="undefined"){SynPro.resetLoaded();SynPro.setSceneId(null);}
  // Charger les scènes multi (Studio) avant les plans
  await loadScenes(id);
  // Configurer la scène synoptique courante (lecture depuis les scènes dès
  // qu'elles existent — y compris pour un membre non-Studio).
  if(CUR_SCENES.syno){
    const sc=SHOW_SCENES.syno?.find(s=>s.id===CUR_SCENES.syno);
    const synoData=_firstSceneFallback('syno', sc?.data??null);
    /* Use setSceneData which sets the sentinel AFTER resetLoaded cleared it */
    SynPro.setSceneData(synoData);
    SynPro.setSceneId(CUR_SCENES.syno);
  }
  await Promise.all([
    loadChs(),
    loadAmps(),
    loadMembers(),
    loadUserTpls(),
  ]);
  loadOutData();
  loadStage();
  subRT();
  renderSessions();
  renderTplQuickBar();
  /* Pré-charger le cache de stockage en arrière-plan pour que les checks soient instantanés */
  _storageCache = null;
  if(typeof _getStorageUsage === 'function') _getStorageUsage(true).catch(function(){});
}

async function newShow(){
  if(SHOWS.filter(s=>s.owner_id===ME?.id).length>=planLimit('max_shows')){showUpgradeModal('max_shows');return;}
  const name=prompt('Nom du show :');if(!name?.trim())return;
  const {data,error}=await sb.from('shows').insert({name:name.trim(),slug:name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+Date.now(),owner_id:ME.id}).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  SHOWS.unshift(data);renderSPShows();await switchShow(data.id);toast(`✓ "${name}" créé`);
}

async function delShow(id,e){
  e?.stopPropagation();
  const s=SHOWS.find(x=>x.id===id);
  if(!s) return;
  const pro = userPlan()==='pro';

  if(pro){
    /* Pro : suppression douce → corbeille « Supprimés récemment » (restaurable 30 j). */
    if(!confirm(`Déplacer "${s.name}" dans les supprimés récemment ?\n\nTu pourras le restaurer pendant ${TRASH_RETENTION_DAYS} jours.`)) return;
    const iso=new Date().toISOString();
    const {error}=await sb.from('shows').update({deleted_at:iso}).eq('id',id);
    if(error){
      /* Colonne deleted_at absente (migration non appliquée) → repli explicite. */
      console.warn('soft-delete indisponible:',error.message);
      if(!confirm('La corbeille nécessite une mise à jour de la base (pas encore appliquée).\n\nSupprimer "'+s.name+'" DÉFINITIVEMENT à la place ?')) return;
      await sb.from('shows').delete().eq('id',id);
    } else {
      s.deleted_at=iso;
      DELETED_SHOWS.unshift(s);
      _updTrashBtn();
      toast('🗑 « '+s.name+' » déplacé dans Supprimés récemment');
    }
  } else {
    /* Gratuit : suppression définitive (la corbeille est une fonction Pro). */
    if(!confirm(`Supprimer "${s.name}" et tous ses canaux ?`)) return;
    await sb.from('shows').delete().eq('id',id);
  }

  SHOWS=SHOWS.filter(x=>x.id!==id);renderSPShows();renderSessions();
  if(CUR_SHOW?.id===id){if(SHOWS.length>0)await switchShow(SHOWS[0].id);else await newShowDefault();}
}

/* ── Corbeille « Supprimés récemment » (Pro) ────────────────────────────── */
function _trashDaysLeft(iso){
  const purge=new Date(iso).getTime()+TRASH_RETENTION_DAYS*864e5;
  return Math.max(0, Math.ceil((purge-Date.now())/864e5));
}
function _updTrashBtn(){
  const b=document.getElementById('sess-trash-btn');
  if(!b) return;
  const pro=userPlan()==='pro';
  const n=DELETED_SHOWS.length;
  b.style.display = pro ? '' : 'none';   // visible seulement pour les Pro
  const c=document.getElementById('sess-trash-count');
  if(c){ c.textContent = n>0 ? n : ''; c.style.display = n>0 ? '' : 'none'; }
}
async function _purgeOldTrash(){
  const cutoff=new Date(Date.now()-TRASH_RETENTION_DAYS*864e5).toISOString();
  const old=DELETED_SHOWS.filter(s=>s.deleted_at && s.deleted_at<cutoff);
  if(!old.length) return;
  try{
    await sb.from('shows').delete().lt('deleted_at',cutoff).eq('owner_id',ME.id);
    DELETED_SHOWS=DELETED_SHOWS.filter(s=>!(s.deleted_at && s.deleted_at<cutoff));
    _updTrashBtn();
  }catch(err){ console.warn('purge corbeille:',err); }
}
async function openTrashModal(){
  if(userPlan()!=='pro'){ showUpgradeModal('recently_deleted'); return; }
  const m=document.getElementById('trash-modal'); if(!m) return;
  m.style.display='flex';
  await _purgeOldTrash();
  renderTrashList();
}
function closeTrashModal(){ const m=document.getElementById('trash-modal'); if(m) m.style.display='none'; }
function renderTrashList(){
  const box=document.getElementById('trash-list'); if(!box) return;
  const empBtn=document.getElementById('trash-empty-btn');
  if(!DELETED_SHOWS.length){
    box.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--muted)"><i class="ti ti-trash-off" style="font-size:34px;display:block;margin-bottom:12px;opacity:.4"></i><div style="font-size:13px">Aucun show supprimé récemment</div><div style="font-size:11px;color:var(--muted2);margin-top:6px">Les shows que tu supprimes apparaissent ici et sont restaurables pendant '+TRASH_RETENTION_DAYS+' jours.</div></div>';
    if(empBtn) empBtn.style.display='none';
    return;
  }
  if(empBtn) empBtn.style.display='';
  box.innerHTML=DELETED_SHOWS.map(function(s){
    const days=_trashDaysLeft(s.deleted_at);
    const danger=days<=3;
    return '<div class="trash-row">'
      +'<div class="trash-info">'
        +'<div class="trash-name">'+_oh(s.name)+'</div>'
        +'<div class="trash-meta">Supprimé '+_timeAgo(s.deleted_at)+'<span class="trash-dot">·</span>'
          +'<span style="color:'+(danger?'var(--err)':'var(--muted)')+'">suppression définitive dans '+days+' j</span></div>'
      +'</div>'
      +'<div class="trash-actions">'
        +'<button class="btn sm" onclick="restoreShow(\''+s.id+'\')"><i class="ti ti-arrow-back-up"></i>Restaurer</button>'
        +'<button class="btn ghost sm" title="Supprimer définitivement" style="color:var(--err);border-color:rgba(255,77,106,.3)" onclick="purgeShowForever(\''+s.id+'\')"><i class="ti ti-trash-x"></i></button>'
      +'</div>'
    +'</div>';
  }).join('');
}
async function restoreShow(id){
  const s=DELETED_SHOWS.find(x=>x.id===id); if(!s) return;
  const {error}=await sb.from('shows').update({deleted_at:null}).eq('id',id);
  if(error){ toast('Erreur restauration : '+error.message); return; }
  s.deleted_at=null;
  DELETED_SHOWS=DELETED_SHOWS.filter(x=>x.id!==id);
  SHOWS.unshift(s);
  SHOWS.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  _updTrashBtn(); renderTrashList(); renderSPShows(); renderSessions();
  toast('✓ « '+s.name+' » restauré');
}
async function purgeShowForever(id){
  const s=DELETED_SHOWS.find(x=>x.id===id); if(!s) return;
  if(!confirm('Supprimer DÉFINITIVEMENT "'+s.name+'" et tous ses canaux ?\n\nCette action est irréversible.')) return;
  const {error}=await sb.from('shows').delete().eq('id',id);
  if(error){ toast('Erreur : '+error.message); return; }
  DELETED_SHOWS=DELETED_SHOWS.filter(x=>x.id!==id);
  _updTrashBtn(); renderTrashList();
  toast('Show supprimé définitivement');
}
async function emptyTrash(){
  if(!DELETED_SHOWS.length) return;
  if(!confirm('Vider la corbeille ? Les '+DELETED_SHOWS.length+' show(s) seront supprimés DÉFINITIVEMENT.\n\nCette action est irréversible.')) return;
  const ids=DELETED_SHOWS.map(s=>s.id);
  const {error}=await sb.from('shows').delete().in('id',ids);
  if(error){ toast('Erreur : '+error.message); return; }
  DELETED_SHOWS=[];
  _updTrashBtn(); renderTrashList();
  toast('Corbeille vidée');
}

// ══════════════════════════════════════
// CHANNELS
// ══════════════════════════════════════
async function loadChs(){
  setILBody('<div class="loading"><div class="spinner"></div>Chargement des canaux…</div>',true);
  const {data,error}=await sb.from('channels').select('*').eq('show_id',CUR_SHOW.id).order('ch');
  if(error){
    setILBody(`<div class="error-row"><i class="ti ti-alert-circle" style="font-size:18px"></i>Erreur Supabase : ${error.message}</div>`,true);
    console.error('channels error:',error);return;
  }
  const all=data||[];
  // Detect patch_id column from first row
  if(all.length>0) _patchColReady='patch_id' in all[0];
  // Renumber ch within EACH patch group (chaque input list est numérotée 1..n)
  const _byPatch={};
  all.forEach(r=>{const pid=r.patch_id||'main';(_byPatch[pid]=_byPatch[pid]||[]).push(r);});
  Object.keys(_byPatch).forEach(pid=>{_byPatch[pid].forEach((r,i)=>{if(r.ch!==i+1)r.ch=i+1;});});
  // Référentiel complet (toutes les listes) + vue filtrée sur le patch actif
  ALL_CHS=all;
  CHS=all.filter(r=>(r.patch_id||'main')===CUR_PATCH_ID);
  renderTable();
  /* Réinitialise l'historique d'annulation Input List pour ce patch/show. */
  if(typeof SectionUndo!=='undefined') SectionUndo.reset('il', CHS);
}
function setILBody(html,wrap){
  document.getElementById('il-body').innerHTML=wrap?`<tr><td colspan="13">${html}</td></tr>`:html;
}

async function addRow(){
  if(CHS.length>=planLimit('max_channels')){showUpgradeModal('max_channels');return;}
  const ch=CHS.length+1;
  const row={show_id:CUR_SHOW.id,ch,short_name:'',long_name:'',source:'',mic:'',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''};
  if(_patchColReady) row.patch_id=CUR_PATCH_ID;
  const {data,error}=await sb.from('channels').insert(row).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  CHS.push(data);renderTable();
}

async function clearAllRows(){
  if(!CHS.length) return;
  const pname=IL_PATCHES.find(p=>p.id===CUR_PATCH_ID)?.name||'ce patch';
  if(!confirm('Supprimer les '+CHS.length+' canaux de "'+pname+'" ? Cette action est irreversible.')) return;
  const ids=CHS.map(r=>r.id);
  CHS=[];renderTable();
  setSaving(true);
  if(ids.length) await sb.from('channels').delete().in('id',ids);
  setSaving(false);
  toast(ids.length+' canaux supprimes.');
}

async function delRow(id){
  CHS=CHS.filter(r=>r.id!==id);
  CHS.forEach((r,i)=>r.ch=i+1);
  renderTable();
  await sb.from('channels').delete().eq('id',id);
  for(let i=0;i<CHS.length;i++) await sb.from('channels').update({ch:i+1}).eq('id',CHS[i].id);
}

async function moveRow(id,dir){
  const idx=CHS.findIndex(r=>r.id===id);
  if(idx<0) return;
  const swp=idx+dir;
  if(swp<0||swp>=CHS.length) return;
  // Swap in array
  [CHS[idx],CHS[swp]]=[CHS[swp],CHS[idx]];
  // Renumber both
  CHS[idx].ch=idx+1; CHS[swp].ch=swp+1;
  renderTable();
  flashRow(id);
  setSaving(true);
  await Promise.all([
    sb.from('channels').update({ch:CHS[idx].ch}).eq('id',CHS[idx].id),
    sb.from('channels').update({ch:CHS[swp].ch}).eq('id',CHS[swp].id),
  ]);
  setSaving(false);
}

// ══════════════════════════════════════
// IL PATCHES
// ══════════════════════════════════════
function loadPatchMeta(){
  if(CUR_SHOW.il_patches?.length) return JSON.parse(JSON.stringify(CUR_SHOW.il_patches));
  try{const s=localStorage.getItem('il_patches_'+CUR_SHOW.id);if(s){const p=JSON.parse(s);if(p?.length)return p;}}catch(e){}
  return [{id:'main',name:'Patch 1',pos:0}];
}

function savePatchMeta(){
  try{localStorage.setItem('il_patches_'+CUR_SHOW.id,JSON.stringify(IL_PATCHES));}catch(e){}
  sb.from('shows').update({il_patches:IL_PATCHES}).eq('id',CUR_SHOW.id).then(({error})=>{
    if(!error) CUR_SHOW.il_patches=JSON.parse(JSON.stringify(IL_PATCHES));
  });
}

function renderPatchTabs(){
  const el=document.getElementById('il-patch-tabs');if(!el)return;
  const isStudio=canDo('multi_scenes');
  if(!isStudio){
    /* Non-Studio : aperçu verrouillé identique aux scene tabs */
    el.innerHTML=`
      <div class="il-ptab active" style="opacity:.5;cursor:default">Patch A</div>
      <div class="il-ptab" style="opacity:.35;cursor:default">Patch B</div>
      <button class="il-ptab-add" onclick="showUpgradeModal('multi_patches')" title="Multi-patches — Pro">+</button>
      <span onclick="showUpgradeModal('multi_patches')" style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-family:var(--m);color:var(--ora);background:var(--ora-d);border:1px solid var(--ora-g);border-radius:6px;padding:3px 9px;cursor:pointer;white-space:nowrap" title="Disponible avec le plan Pro">
        <i class="ti ti-lock" style="font-size:11px"></i>Pro
      </span>`;
    return;
  }
  el.innerHTML=IL_PATCHES.map(p=>{
    const active=p.id===CUR_PATCH_ID;
    return `<div class="il-ptab${active?' active':''}" onclick="switchPatch('${p.id}')" ondblclick="renamePatch('${p.id}')" title="Double-clic pour renommer">
      ${p.name.replace(/</g,'&lt;')}
      <button class="il-ptab-dup" onclick="event.stopPropagation();duplicatePatch('${p.id}')" title="Dupliquer ce patch (avec ses canaux)"><i class="ti ti-copy"></i></button>
      ${IL_PATCHES.length>1?`<button class="il-ptab-del" onclick="event.stopPropagation();deletePatch('${p.id}')" title="Supprimer">×</button>`:''}
    </div>`;
  }).join('')+'<button class="il-ptab-add" onclick="addPatch()" title="Nouveau patch (vide)">+</button>';
}

async function switchPatch(id){
  if(id===CUR_PATCH_ID)return;
  if(!canDo('multi_scenes')){showUpgradeModal('multi_patches');return;}
  CUR_PATCH_ID=id;
  renderPatchTabs();
  await loadChs();
  loadOutData();
  if(CUR_IL_MODE==='out') renderOutTable();
}

function addPatch(){
  if(!canDo('multi_scenes')){showUpgradeModal('multi_patches');return;}
  const name=prompt('Nom du patch :','Patch '+(IL_PATCHES.length+1));
  if(!name||!name.trim())return;
  const id='p'+Date.now();
  IL_PATCHES.push({id,name:name.trim(),pos:IL_PATCHES.length});
  savePatchMeta();
  switchPatch(id);
}

/* Duplique un patch (Input List) AVEC tous ses canaux → variante d'input list.
   Réservé Pro. Copie les canaux du patch source vers de nouvelles lignes
   portant le nouveau patch_id. */
async function duplicatePatch(patchId){
  if(!CUR_SHOW){return;}
  if(!canDo('multi_scenes')){showUpgradeModal('multi_patches');return;}
  const src=IL_PATCHES.find(p=>p.id===patchId);
  if(!src){toast('Patch introuvable.');return;}
  /* Canaux source : patch courant → CHS (frais) ; sinon depuis ALL_CHS. */
  const rows = (patchId===CUR_PATCH_ID) ? CHS
             : (typeof ALL_CHS!=='undefined'?ALL_CHS:[]).filter(r=>(r.patch_id||'main')===patchId);
  if(rows.length && !_patchColReady){
    toast("La séparation par patch n'est pas disponible sur ce show.");
    return;
  }
  if(rows.length > planLimit('max_channels')){ showUpgradeModal('max_channels'); return; }
  const name=prompt('Nom de la variante :', src.name+' (copie)');
  if(!name||!name.trim()) return;
  const newId='p'+Date.now();
  const newRows=rows.map((r,i)=>{
    const o={ show_id:CUR_SHOW.id, ch:i+1,
      short_name:r.short_name||'', long_name:r.long_name||'', source:r.source||'',
      mic:r.mic||'', gain:r.gain||0, phantom:!!r.phantom, iem_group:r.iem_group||'',
      foh:r.foh!==false, mon:!!r.mon, bc:!!r.bc, note:r.note||'' };
    if(_patchColReady) o.patch_id=newId;
    if(r.custom_data) o.custom_data=r.custom_data; // copie HF & colonnes perso
    return o;
  });
  IL_PATCHES.push({id:newId,name:name.trim(),pos:IL_PATCHES.length});
  savePatchMeta();
  if(newRows.length){
    setSaving(true);
    const {data,error}=await sb.from('channels').insert(newRows).select();
    setSaving(false);
    if(error){
      // rollback meta local en cas d'échec
      IL_PATCHES=IL_PATCHES.filter(p=>p.id!==newId); savePatchMeta();
      toast('Erreur : '+error.message); return;
    }
    if(typeof ALL_CHS!=='undefined') ALL_CHS=[...ALL_CHS,...(data||[])];
  }
  await switchPatch(newId);
  toast('✓ Variante créée ('+newRows.length+' canaux)');
}

async function deletePatch(id){
  if(IL_PATCHES.length<=1)return;
  const p=IL_PATCHES.find(x=>x.id===id);
  if(!confirm('Supprimer "'+( p?.name||'ce patch')+'" et tous ses canaux ?'))return;
  // Delete channels of this patch
  if(id===CUR_PATCH_ID){
    const ids=CHS.map(r=>r.id);
    if(ids.length) await sb.from('channels').delete().in('id',ids);
    CHS=[];
  } else if(_patchColReady){
    await sb.from('channels').delete().eq('show_id',CUR_SHOW.id).eq('patch_id',id);
  }
  IL_PATCHES=IL_PATCHES.filter(x=>x.id!==id);
  savePatchMeta();
  if(CUR_PATCH_ID===id){
    CUR_PATCH_ID=IL_PATCHES[0].id;
    renderPatchTabs();
    await loadChs();
  } else {
    renderPatchTabs();
  }
}

function renamePatch(id){
  const p=IL_PATCHES.find(x=>x.id===id);if(!p)return;
  const name=prompt('Renommer le patch :',p.name);
  if(!name||!name.trim())return;
  p.name=name.trim();
  savePatchMeta();
  renderPatchTabs();
}

// ══════════════════════════════════════
// IN / OUT MODE
// ══════════════════════════════════════
function setILMode(mode) {
  CUR_IL_MODE = mode;
  var isIn  = (mode === 'in');
  document.getElementById('pmb-il-in')?.classList.toggle('on', isIn);
  document.getElementById('pmb-il-out')?.classList.toggle('on', !isIn);
  var inBtns  = document.getElementById('il-in-btns');
  var outBtns = document.getElementById('il-out-btns');
  var inWrap  = document.getElementById('il-table-wrap');
  var outWrap = document.getElementById('out-table-wrap');
  var colPnl  = document.getElementById('col-panel');
  if(inBtns)  inBtns.style.display  = isIn ? 'contents' : 'none';
  if(outBtns) outBtns.style.display = isIn ? 'none' : 'inline-flex';
  if(outBtns && !isIn) { outBtns.style.gap='6px'; outBtns.style.alignItems='center'; }
  if(inWrap)  inWrap.style.display  = isIn ? '' : 'none';
  if(outWrap) outWrap.style.display = isIn ? 'none' : '';
  if(colPnl && !isIn)  colPnl.style.display = 'none';
  var titleEl = document.getElementById('il-pbar-title');
  if(titleEl) titleEl.textContent = isIn ? 'Input List' : 'Output List';
  if(!isIn) { loadOutData(); renderOutTable(); }
}

// ── OUT DATA (stocke dans shows.out_data, cache local)
function loadOutData() {
  if(!CUR_SHOW) return;
  var raw = CUR_SHOW.out_data;
  var fromLocal = false;
  if(!raw || (typeof raw==='object' && !Object.keys(raw).length)) {
    try { var s=localStorage.getItem('out_data_'+CUR_SHOW.id); if(s){ raw=JSON.parse(s); fromLocal=true; } } catch(e){}
  }
  OUT_DATA = raw || {};
  OUT_CHS  = (OUT_DATA[CUR_PATCH_ID] || []).slice();
  _rebuildAllOut(OUT_DATA);
  /* Auto-réparation : si les sorties ne venaient que du cache local (la base
     n'avait rien — ex. colonne out_data récemment ajoutée), on les remonte en
     base pour qu'elles persistent et soient visibles partout (autres appareils,
     plan de scène, rider). */
  if(fromLocal && Object.keys(OUT_DATA).length){
    CUR_SHOW.out_data = JSON.parse(JSON.stringify(OUT_DATA));
    sb.from('shows').update({out_data: OUT_DATA}).eq('id', CUR_SHOW.id)
      .then(function(r){ if(r&&r.error) console.warn('[out_data] migration vers DB échouée:', r.error.message); });
  }
}

function saveOutData() {
  if(!CUR_SHOW) return;
  OUT_DATA[CUR_PATCH_ID] = OUT_CHS.slice();
  _rebuildAllOut(OUT_DATA);
  try { localStorage.setItem('out_data_'+CUR_SHOW.id, JSON.stringify(OUT_DATA)); } catch(e){}
  CUR_SHOW.out_data = JSON.parse(JSON.stringify(OUT_DATA));
  clearTimeout(_saveOutTimer);
  _saveOutTimer = setTimeout(function(){
    sb.from('shows').update({out_data: OUT_DATA}).eq('id', CUR_SHOW.id)
      .then(function(r){ if(r&&r.error) console.warn('[out_data] sauvegarde échouée:', r.error.message); });
  }, 900);
}

// ══════════════════════════════════════
// OUT TABLE — RENDER + CRUD
// ══════════════════════════════════════
function _oh(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderOutTable() {
  var body = document.getElementById('out-body');
  if(!body) return;
  if(OUT_CHS.length === 0){
    body.innerHTML = '<tr><td colspan="8"><div class="loading" style="color:var(--muted);padding:28px 20px"><i class="ti ti-inbox" style="font-size:22px;margin-right:8px"></i>Aucune sortie — cliquez "+ Sortie" ou utilisez l\'Assistant</div></td></tr>';
    return;
  }
  var selOpts = Object.keys(OUT_TYPES).map(function(k){
    return '<option value="'+k+'">'+OUT_TYPES[k].label+'</option>';
  }).join('');
  body.innerHTML = OUT_CHS.map(function(r,i){
    var t = OUT_TYPES[r.type] || OUT_TYPES.other;
    var opts = Object.keys(OUT_TYPES).map(function(k){
      return '<option value="'+k+'"'+(r.type===k?' selected':'')+'>'+OUT_TYPES[k].label+'</option>';
    }).join('');
    return '<tr data-outid="'+r.id+'">'
      +'<td class="ch-num">'+r.ch+'</td>'
      +'<td data-label="Court"><input class="ilinp sh" maxlength="8" value="'+_oh(r.short_name||'')+'" onchange="updateOutField(\''+r.id+'\',\'short_name\',this.value.toUpperCase().slice(0,8))"/></td>'
      +'<td data-label="Nom long"><input class="ilinp" style="min-width:100px" value="'+_oh(r.long_name||'')+'" onchange="updateOutField(\''+r.id+'\',\'long_name\',this.value)"/></td>'
      +'<td data-label="Type"><select class="out-type-sel" style="color:'+t.color+'" onchange="updateOutField(\''+r.id+'\',\'type\',this.value)">'+opts+'</select></td>'
      +'<td data-label="Destination"><input class="ilinp" value="'+_oh(r.dest||'')+'" onchange="updateOutField(\''+r.id+'\',\'dest\',this.value)" placeholder="Ampli, zone, room..."/></td>'
      +'<td data-label="Fréq. HF"><input class="ilinp m" style="color:var(--grn);width:74px" value="'+_oh(r.hf||'')+'" onchange="updateOutField(\''+r.id+'\',\'hf\',this.value)" placeholder="MHz"/></td>'
      +'<td data-label="Note"><input class="ilinp" value="'+_oh(r.note||'')+'" onchange="updateOutField(\''+r.id+'\',\'note\',this.value)"/></td>'
      +'<td class="il-actions-cell" style="white-space:nowrap">'
      +'<button class="move-btn" onclick="moveOutRow(\''+r.id+'\',-1)"'+(i===0?' disabled':'')+' ><i class="ti ti-chevron-up"></i></button>'
      +'<button class="move-btn" onclick="moveOutRow(\''+r.id+'\',1)"'+(i===OUT_CHS.length-1?' disabled':'')+' ><i class="ti ti-chevron-down"></i></button>'
      +'<button class="del-btn" onclick="deleteOutRow(\''+r.id+'\')"><i class="ti ti-trash"></i></button>'
      +'</td></tr>';
  }).join('');
}

function addOutRow() {
  var ch = OUT_CHS.length + 1;
  OUT_CHS.push({id:'o'+Date.now()+Math.random().toString(36).slice(2,5), ch:ch, short_name:'OUT'+ch, long_name:'Sortie '+ch, type:'other', dest:'', hf:'', note:''});
  saveOutData(); renderOutTable();
}

function deleteOutRow(id) {
  OUT_CHS = OUT_CHS.filter(function(r){return r.id!==id;});
  OUT_CHS.forEach(function(r,i){r.ch=i+1;});
  saveOutData(); renderOutTable();
}

function moveOutRow(id, dir) {
  var idx = OUT_CHS.findIndex(function(r){return r.id===id;});
  var to  = idx + dir;
  if(to<0 || to>=OUT_CHS.length) return;
  var tmp=OUT_CHS[idx]; OUT_CHS[idx]=OUT_CHS[to]; OUT_CHS[to]=tmp;
  OUT_CHS.forEach(function(r,i){r.ch=i+1;});
  saveOutData(); renderOutTable();
}

const _OUT_FIELDS=new Set(['short_name','long_name','type','dest','hf','note']);
function updateOutField(id, field, value) {
  if(!_OUT_FIELDS.has(field)){console.warn('[sec] champ sortie non autorisé:',field);return;}
  var r = OUT_CHS.find(function(x){return x.id===id;});
  if(!r) return;
  r[field] = value;
  saveOutData();
  if(field==='type') renderOutTable(); // refresh color
}

function clearAllOutRows() {
  if(OUT_CHS.length===0) return;
  if(!confirm('Supprimer toutes les sorties de ce patch ?')) return;
  OUT_CHS = [];
  saveOutData(); renderOutTable();
}

function exportOutCSV() {
  if(!OUT_CHS.length){toast('Aucune sortie a exporter.');return;}
  var c='CH,Court,Nom Long,Type,Destination,Note\n';
  OUT_CHS.forEach(function(r){
    c+=r.ch+',"'+(r.short_name||'').trim()+'","'+(r.long_name||'')+'","'+(OUT_TYPES[r.type]?.label||r.type||'')+'","'+(r.dest||'')+'","'+(r.note||'')+'"\n';
  });
  var slug=(CUR_SHOW?.slug||'show');
  var link=document.createElement('a');
  link.href='data:text/csv;charset=utf-8,'+encodeURIComponent('﻿'+c);
  link.download=slug+'_outputlist.csv'; link.click();
}

// ══════════════════════════════════════
// OLA — OUTPUT LIST ASSISTANT
// ══════════════════════════════════════
function openOLAssist() {
  OLA_CATS.forEach(function(cat){ _olaCount[cat.id] = cat.def || 0; });
  _olaRender();
  document.getElementById('ol-assist-modal').className = 'modal-ov show';
}
function closeOLAssist() {
  document.getElementById('ol-assist-modal').className = 'modal-ov';
}
function olaAdj(catId, dir) {
  var cat = OLA_CATS.find(function(c){return c.id===catId;});
  if(!cat) return;
  _olaCount[catId] = Math.max(0, Math.min(cat.max, (_olaCount[catId]||0) + dir));
  _olaRender();
}

function _olaAllOutputs() {
  var result = [];
  OLA_CATS.forEach(function(cat){
    var n = _olaCount[cat.id] || 0;
    if(n <= 0) return;
    if(cat.mode === 'named'){
      for(var i=0; i<Math.min(n,cat.names.length); i++){
        result.push({short_name:cat.shorts[i], long_name:cat.names[i], type:cat.type, dest:'', note:''});
      }
    } else {
      for(var j=0; j<n; j++){
        result.push({short_name:(cat.short+(j+1)).slice(0,8), long_name:cat.prefix+(j+1), type:cat.type, dest:'', note:''});
      }
    }
  });
  return result;
}

function _olaRender() {
  var outputs = _olaAllOutputs();
  var total   = outputs.length;
  var html    = '';
  OLA_CATS.forEach(function(cat){
    var n = _olaCount[cat.id] || 0;
    var active = n > 0;
    var preview = '';
    if(n > 0){
      if(cat.mode === 'named'){
        preview = cat.names.slice(0,n).join(', ');
      } else {
        var pts = [];
        for(var k=1; k<=Math.min(n,3); k++) pts.push(cat.prefix+k);
        if(n>3) pts.push('...');
        preview = pts.join(', ');
      }
    }
    html += '<div class="ola-cat-row'+(active?' ola-active':'')+'">'
      +'<i class="ti '+cat.icon+' ola-cat-icon" style="color:'+(active?cat.color:'var(--muted)')+'"></i>'
      +'<div class="ola-cat-info">'
        +'<div class="ola-cat-lbl">'+cat.label+'</div>'
        +(preview?'<div class="ola-cat-sub">'+preview+'</div>':'')
      +'</div>'
      +'<div class="ola-spinner">'
        +'<button class="ola-spin-btn" onclick="olaAdj(\''+cat.id+'\',-1)"'+(n<=0?' disabled':'')+'>&#8722;</button>'
        +'<span class="ola-spin-val">'+n+'</span>'
        +'<button class="ola-spin-btn" onclick="olaAdj(\''+cat.id+'\',1)"'+(n>=cat.max?' disabled':'')+'>+</button>'
      +'</div>'
    +'</div>';
  });
  document.getElementById('ola-sections').innerHTML = html;
  var totEl   = document.getElementById('ola-total');
  var cntEl   = document.getElementById('ola-count');
  var applyBtn= document.getElementById('ola-apply-btn');
  if(totEl)    totEl.style.display = total>0?'':'none';
  if(cntEl)    cntEl.textContent   = total;
  if(applyBtn) applyBtn.style.display = total>0?'':'none';
}

async function applyOLAssist() {
  var outputs = _olaAllOutputs();
  if(!outputs.length){toast('Aucune sortie configuree.');return;}
  var btn = document.getElementById('ola-apply-btn');
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2"></i> Creation...';
  try {
    var startCh = OUT_CHS.length + 1;
    outputs.forEach(function(o,i){
      OUT_CHS.push({id:'o'+Date.now()+'_'+i, ch:startCh+i, short_name:o.short_name, long_name:o.long_name, type:o.type, dest:o.dest, note:o.note});
    });
    saveOutData();
    renderOutTable();
    closeOLAssist();
    toast(outputs.length+' sortie'+(outputs.length>1?'s':'')+' creee'+(outputs.length>1?'s':'')+'!');
  } finally {
    btn.disabled=false; btn.innerHTML='<i class="ti ti-check"></i>Creer les sorties';
  }
}

let _dndInit=false,_dragSrc=null,_dragOver=null;
function initDragDrop(){
  if(_dndInit) return; _dndInit=true;
  const tbody=document.getElementById('il-body');
  if(!tbody) return;
  tbody.addEventListener('dragstart',e=>{
    const tr=e.target.closest('tr[data-rid]');if(!tr)return;
    _dragSrc=tr.dataset.rid;
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',_dragSrc);
    setTimeout(()=>tr.classList.add('dragging'),0);
  });
  tbody.addEventListener('dragover',e=>{
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const tr=e.target.closest('tr[data-rid]');
    if(!tr||tr.dataset.rid===_dragSrc) return;
    if(tr.dataset.rid===_dragOver) return;
    tbody.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
    tr.classList.add('drag-over');_dragOver=tr.dataset.rid;
  });
  tbody.addEventListener('dragleave',e=>{
    const tr=e.target.closest('tr[data-rid]');
    if(tr&&!tr.contains(e.relatedTarget)) tr.classList.remove('drag-over');
  });
  tbody.addEventListener('drop',e=>{
    e.preventDefault();
    const src=_dragSrc,dst=_dragOver;
    _dragSrc=null;_dragOver=null;
    tbody.querySelectorAll('.dragging,.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));
    if(!src||!dst||src===dst) return;
    performDrop(src,dst);
  });
  tbody.addEventListener('dragend',()=>{
    _dragSrc=null;_dragOver=null;
    document.getElementById('il-body')?.querySelectorAll('.dragging,.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));
  });
}

async function performDrop(srcId,dstId){
  const si=CHS.findIndex(r=>r.id===srcId);
  const di=CHS.findIndex(r=>r.id===dstId);
  if(si<0||di<0) return;
  const [moved]=CHS.splice(si,1);
  CHS.splice(di,0,moved);
  CHS.forEach((r,i)=>r.ch=i+1);
  renderTable();flashRow(srcId);
  const lo=Math.min(si,di),hi=Math.max(si,di);
  setSaving(true);
  await Promise.all(CHS.slice(lo,hi+1).map(r=>sb.from('channels').update({ch:r.ch}).eq('id',r.id)));
  setSaving(false);
}

const _CH_FIELDS=new Set(['short_name','long_name','source','mic','gain','phantom','iem_group','foh','mon','bc','note','custom_data']);
function scheduleSave(id,field,val){
  if(!_CH_FIELDS.has(field)){console.warn('[sec] champ non autorisé:',field);return;}
  clearTimeout(saveT);
  const r=CHS.find(x=>x.id===id);if(r)r[field]=val;
  if(typeof SectionUndo!=='undefined') SectionUndo.record('il', function(){ return CHS; });
  setSaving(true);
  saveT=setTimeout(async()=>{
    await sb.from('channels').update({[field]:val,updated_by:ME.id}).eq('id',id);
    setSaving(false);
  },700);
}
function setSaving(b){
  document.getElementById('il-saving').style.display=b?'flex':'none';
  document.getElementById('il-notice').style.display=b?'none':'flex';
}

// ══════════════════════════════════════
// INPUT LIST ASSISTANT
// ══════════════════════════════════════
const ILA_CATS = [
  {
    id: 'drums', label: 'Batterie', icon: 'ti-circle', open: true,
    items: [
      { id:'kick_in',   label:'Kick In',             s:'KICK', mic:'Beta 91A', source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'kick_out',  label:'Kick Out',            s:'KOUT', mic:'Beta 52A', source:'Batterie', phantom:false, def:0, stand:'petit' },
      { id:'snare_top', label:'Caisse Claire Top',   s:'SNRT', mic:'SM57',    source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'snare_bot', label:'Caisse Claire Bottom',s:'SNRB', mic:'SM57',    source:'Batterie', phantom:false, def:0, stand:'petit' },
      { id:'hihat',     label:'Hi-Hat',              s:'HIHT', mic:'KSM137',  source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'tom1',      label:'Tom 1',               s:'TOM1', mic:'e604',    source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'tom2',      label:'Tom 2',               s:'TOM2', mic:'e604',    source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'floor_tom', label:'Floor Tom',           s:'FLOR', mic:'e604',    source:'Batterie', phantom:false, def:1, stand:'petit' },
      { id:'oh_l',      label:'Overhead L',          s:'OHL',  mic:'AKG 414', source:'Batterie', phantom:true,  def:1, stand:'grand' },
      { id:'oh_r',      label:'Overhead R',          s:'OHR',  mic:'AKG 414', source:'Batterie', phantom:true,  def:1, stand:'grand' },
      { id:'room_l',    label:'Room L',              s:'ROML', mic:'AKG 414', source:'Batterie', phantom:true,  def:0, stand:'grand' },
      { id:'room_r',    label:'Room R',              s:'ROMR', mic:'AKG 414', source:'Batterie', phantom:true,  def:0, stand:'grand' },
      { id:'ride',      label:'Ride',                s:'RIDE', mic:'KSM137',  source:'Batterie', phantom:false, def:0, stand:'petit' },
      { id:'crash',     label:'Crash',               s:'CRSH', mic:'KSM137',  source:'Batterie', phantom:false, def:0, stand:'petit' },
    ],
  },
  {
    id: 'bass_guitar', label: 'Basse / Guitare / Claviers', icon: 'ti-guitar-pick', open: false,
    items: [
      { id:'bass_di',  label:'Bass DI',            s:'BASS', mic:'Radial JDI', source:'Basse',    phantom:false, def:0, stand:''      },
      { id:'bass_mic', label:'Bass Mic',           s:'BSMC', mic:'Beta 52A',  source:'Basse',    phantom:false, def:0, stand:'petit' },
      { id:'guitar_e', label:'Guitare Electrique', s:'GTE',  mic:'SM57',      source:'Guitare',  phantom:false, def:0, stand:''      },
      { id:'keys_l',   label:'Claviers L',         s:'KYL',  mic:'DI Stereo', source:'Claviers', phantom:false, def:0, stand:''      },
      { id:'keys_r',   label:'Claviers R',         s:'KYR',  mic:'DI Stereo', source:'Claviers', phantom:false, def:0, stand:''      },
    ],
  },
  {
    id: 'vocals', label: 'Voix', icon: 'ti-microphone', open: false,
    items: [
      { id:'vox_lead', label:'Vox Lead',    s:'VOX', mic:'SM58', source:'Chant', phantom:false, def:0, stand:'grand' },
      { id:'bv',       label:'Backing Vox', s:'BV',  mic:'SM58', source:'Chant', phantom:false, def:0, stand:'grand' },
    ],
  },
  {
    id: 'dj', label: 'DJ', icon: 'ti-vinyl', open: false,
    items: [
      { id:'dj_l',   label:'DJ Main L', s:'DJL', mic:'DI Stereo', source:'DJ',       phantom:false, def:0, stand:''      },
      { id:'dj_r',   label:'DJ Main R', s:'DJR', mic:'DI Stereo', source:'DJ',       phantom:false, def:0, stand:''      },
      { id:'mc_mic', label:'MC Mic',    s:'MC',  mic:'SM58',      source:'Chant',    phantom:false, def:0, stand:'grand' },
      { id:'dj_aux', label:'AUX',       s:'AUX', mic:'DI',        source:'Playback', phantom:false, def:0, stand:''      },
    ],
  },
  {
    id: 'perc', label: 'Percussions', icon: 'ti-circle', open: false,
    items: [
      { id:'cajon',     label:'Cajon',               s:'CAJ', mic:'Beta 52A', source:'Percussions', phantom:false, def:0, stand:'petit' },
      { id:'congas',    label:'Congas',               s:'CON', mic:'SM57',    source:'Percussions', phantom:false, def:0, stand:''      },
      { id:'bongos',    label:'Bongos',               s:'BON', mic:'SM57',    source:'Percussions', phantom:false, def:0, stand:''      },
      { id:'djembe',    label:'Djembe',               s:'DJM', mic:'Beta 52A',source:'Percussions', phantom:false, def:0, stand:''      },
      { id:'perc_misc', label:'Percussions diverses', s:'PRC', mic:'SM57',    source:'Percussions', phantom:false, def:0, stand:'petit' },
    ],
  },
  {
    id: 'other', label: 'Autre', icon: 'ti-plug', open: false,
    items: [
      { id:'click',    label:'Click Track', s:'CLK', mic:'DI', source:'Playback',     phantom:false, def:0, stand:'' },
      { id:'playback', label:'Playback',    s:'PLY', mic:'DI', source:'Playback',     phantom:false, def:0, stand:'' },
      { id:'laptop',   label:'Ordinateur',  s:'PC',  mic:'DI', source:'Presentation', phantom:false, def:0, stand:'' },
    ],
  },
];


// ── OUTPUT TYPES
const OUT_TYPES = {
  main:   { label:'Main',    color:'#1a8fff', bg:'rgba(26,143,255,.15)'  },
  sub:    { label:'Sub',     color:'#ff6b1a', bg:'rgba(255,107,26,.15)'  },
  mon:    { label:'Monitor', color:'#f5c542', bg:'rgba(245,197,66,.14)'  },
  iem:    { label:'IEM',     color:'#22d6a0', bg:'rgba(34,214,160,.13)'  },
  fx:     { label:'FX',      color:'#9b6aff', bg:'rgba(155,106,255,.12)' },
  group:  { label:'Groupe',  color:'#5ab0ff', bg:'rgba(90,176,255,.12)'  },
  matrix: { label:'Matrix',  color:'#e8edf8', bg:'rgba(232,237,248,.09)' },
  aux:    { label:'Aux',     color:'#44bbff', bg:'rgba(68,187,255,.13)'  },
  other:  { label:'Autre',   color:'#5a6580', bg:'rgba(90,101,128,.11)'  },
};

// ── OLA CATEGORIES (spinners)
const OLA_CATS = [
  { id:'main',   label:'Sorties principales', icon:'ti-speakerphone',      color:'#1a8fff', type:'main',
    mode:'named', names:['Main L','Main R','Main C','Main D'], shorts:['ML','MR','MC','MD'], def:2, max:4 },
  { id:'sub',    label:'Infrabasses / Sub',   icon:'ti-antenna-bars-5',    color:'#ff6b1a', type:'sub',
    mode:'named', names:['Sub L','Sub R','Sub C'],             shorts:['SBL','SBR','SBC'],   def:2, max:3 },
  { id:'mon',    label:'Retours scene',       icon:'ti-triangle',          color:'#f5c542', type:'mon',
    mode:'count', prefix:'Mon ', short:'M',  def:0, max:16 },
  { id:'iem',    label:'IEM',                 icon:'ti-headphones',        color:'#22d6a0', type:'iem',
    mode:'count', prefix:'IEM ', short:'IE', def:0, max:8  },
  { id:'fx',     label:'Effets / FX',         icon:'ti-sparkles',          color:'#9b6aff', type:'fx',
    mode:'count', prefix:'FX ',  short:'FX', def:0, max:8  },
  { id:'group',  label:'Groupes',             icon:'ti-layers-intersect',  color:'#5ab0ff', type:'group',
    mode:'count', prefix:'Gr ',  short:'GR', def:0, max:16 },
  { id:'matrix', label:'Matrix / Mixbus',     icon:'ti-grid-dots',         color:'#e8edf8', type:'matrix',
    mode:'count', prefix:'Mtr ', short:'MT', def:0, max:8  },
  { id:'aux',    label:'Aux / Departs',       icon:'ti-git-branch',        color:'#44bbff', type:'aux',
    mode:'count', prefix:'Aux ', short:'AX', def:0, max:16 },
];

let _olaCount = {};   // catId -> integer

let _ilaCount       = {};   // itemId -> integer (0 = not selected)
let _ilaCatOpen     = {};
let _ilaCustomItems = {};   // catId -> [{id,label,s,mic,stand,source,phantom}]
let _ilaCustomCats  = [];   // [{id,label,icon}]
let _ilaFormCat     = null; // catId | '__new__' | null

const _ILA_STAND_S = { petit:'Petit', grand:'Grand', autre:'Autre' };
const _ILA_STAND_F = { petit:'Petit pied', grand:'Grand pied', autre:'Autre' };

function openILAssist() {
  _ilaCount = {}; _ilaCatOpen = {}; _ilaCustomItems = {}; _ilaCustomCats = []; _ilaFormCat = null;
  ILA_CATS.forEach(function(cat) {
    _ilaCatOpen[cat.id] = !!cat.open;
    cat.items.forEach(function(item) { _ilaCount[item.id] = item.def || 0; });
  });
  _ilaRender();
  document.getElementById('il-assist-modal').className = 'modal-ov show';
}

function closeILAssist() {
  document.getElementById('il-assist-modal').className = 'modal-ov';
}

function ilaToggleCat(catId) {
  _ilaCatOpen[catId] = !_ilaCatOpen[catId];
  var open = _ilaCatOpen[catId];
  var wrap = document.querySelector('.ila-cat[data-cat="'+catId+'"]');
  var body = document.querySelector('.ila-cat-body[data-cat="'+catId+'"]');
  var arr  = document.querySelector('.ila-cat-hd[data-cat="'+catId+'"] .ila-cat-hd-arr');
  if (wrap) wrap.classList.toggle('open', open);
  if (body) body.style.display = open ? '' : 'none';
  if (arr)  arr.style.transform = open ? 'rotate(90deg)' : '';
}

function ilaRowClick(itemId) {
  _ilaCount[itemId] = (_ilaCount[itemId] > 0) ? 0 : 1;
  _ilaRefreshRow(itemId); _ilaUpdateBadge(itemId); _ilaUpdateCount();
}

function ilaAdj(itemId, delta) {
  _ilaCount[itemId] = Math.max(0, Math.min(16, (_ilaCount[itemId] || 0) + delta));
  _ilaRefreshRow(itemId); _ilaUpdateBadge(itemId); _ilaUpdateCount();
}

function _ilaRefreshRow(itemId) {
  var n = _ilaCount[itemId] || 0;
  var row = document.querySelector('.ila-cb-row[data-id="'+itemId+'"]');
  if (!row) return;
  row.classList.toggle('checked', n > 0);
  var val = row.querySelector('.ila-sp-val'), mb = row.querySelector('.ila-sp-btn');
  if (val) val.textContent = n;
  if (mb)  mb.disabled = (n === 0);
}

function _ilaCatTotal(catId) {
  var t = 0;
  var bc = ILA_CATS.find(function(c) { return c.id === catId; });
  if (bc) bc.items.forEach(function(it) { t += _ilaCount[it.id] || 0; });
  (_ilaCustomItems[catId] || []).forEach(function(it) { t += _ilaCount[it.id] || 0; });
  return t;
}

function _ilaFindCatId(itemId) {
  for (var i = 0; i < ILA_CATS.length; i++) {
    if (ILA_CATS[i].items.some(function(it){return it.id===itemId;})) return ILA_CATS[i].id;
    if ((_ilaCustomItems[ILA_CATS[i].id]||[]).some(function(it){return it.id===itemId;})) return ILA_CATS[i].id;
  }
  for (var j = 0; j < _ilaCustomCats.length; j++) {
    if ((_ilaCustomItems[_ilaCustomCats[j].id]||[]).some(function(it){return it.id===itemId;})) return _ilaCustomCats[j].id;
  }
  return null;
}

function _ilaUpdateBadge(itemId) {
  var cid = _ilaFindCatId(itemId); if (!cid) return;
  var t = _ilaCatTotal(cid);
  var b = document.getElementById('ila-cat-cnt-'+cid);
  if (b) { b.textContent = t; b.classList.toggle('show', t > 0); }
}

/* ---- add/remove custom items & cats ---- */
function ilaShowItemForm(catId) { _ilaFormCat = catId;      _ilaRender(); }
function ilaHideForm()          { _ilaFormCat = null;       _ilaRender(); }
function ilaShowCatForm()       { _ilaFormCat = '__new__';  _ilaRender(); }

function ilaAddItem(catId) {
  var label = ((document.getElementById('ila-nf-label')||{}).value||'').trim();
  var s     = ((document.getElementById('ila-nf-s')    ||{}).value||'').trim();
  var mic   = ((document.getElementById('ila-nf-mic')  ||{}).value||'').trim();
  var stand = (document.getElementById('ila-nf-stand') ||{}).value||'';
  if (!label) { toast('Entrer un nom'); return; }
  s = (s||label.slice(0,4)).toUpperCase().slice(0,4);
  var uid = 'ci'+Date.now();
  if (!_ilaCustomItems[catId]) _ilaCustomItems[catId] = [];
  _ilaCustomItems[catId].push({id:uid,label:label,s:s,mic:mic,stand:stand,source:'',phantom:false});
  _ilaCount[uid] = 1;
  _ilaFormCat = null; _ilaRender();
}

function ilaRemoveItem(catId, itemId) {
  if (_ilaCustomItems[catId])
    _ilaCustomItems[catId] = _ilaCustomItems[catId].filter(function(it){return it.id!==itemId;});
  delete _ilaCount[itemId]; _ilaRender();
}

function ilaAddCat() {
  var label = ((document.getElementById('ila-ncat-label')||{}).value||'').trim();
  if (!label) { toast('Entrer un nom'); return; }
  var uid = 'cc'+Date.now();
  _ilaCustomCats.push({id:uid,label:label,icon:'ti-folder'});
  _ilaCatOpen[uid] = true; _ilaCustomItems[uid] = [];
  _ilaFormCat = null; _ilaRender();
}

function ilaRemoveCat(catId) {
  (_ilaCustomItems[catId]||[]).forEach(function(it){delete _ilaCount[it.id];});
  delete _ilaCustomItems[catId];
  _ilaCustomCats = _ilaCustomCats.filter(function(c){return c.id!==catId;});
  _ilaRender();
}

/* ---- render helpers ---- */
function _ilaItemRow(item, isCustom, catId) {
  var n = _ilaCount[item.id]||0, sl = _ILA_STAND_S[item.stand]||'';
  var r = '<div class="ila-cb-row'+(n>0?' checked':'')+'" data-id="'+item.id+'" onclick="ilaRowClick(\''+item.id+'\')">';
  r += '<div class="ila-cb-box"><div class="ila-cb-box-chk"></div></div>';
  r += '<span class="ila-cb-lbl">'+item.label+'</span>';
  if (item.mic) r += '<span class="ila-cb-mic">'+item.mic+'</span>';
  if (sl)       r += '<span class="ila-cb-stand">'+sl+'</span>';
  r += '<div class="ila-cb-spinner" onclick="event.stopPropagation()">';
  r += '<button type="button" class="ila-sp-btn" onclick="ilaAdj(\''+item.id+'\',-1)"'+(n===0?' disabled':'')+'>&#8722;</button>';
  r += '<span class="ila-sp-val">'+n+'</span>';
  r += '<button type="button" class="ila-sp-btn" onclick="ilaAdj(\''+item.id+'\',1)">+</button>';
  r += '</div>';
  if (isCustom)
    r += '<button type="button" class="ila-item-del" onclick="event.stopPropagation();ilaRemoveItem(\''+catId+'\',\''+item.id+'\')" title="Supprimer"><i class="ti ti-x"></i></button>';
  return r + '</div>';
}

function _ilaAddItemForm(catId) {
  return '<div class="ila-add-form-inline">'+
    '<div style="display:flex;gap:6px;margin-bottom:7px">'+
    '<input id="ila-nf-label" class="ila-af-inp" placeholder="Nom (ex: Acoustic Guitar)" style="flex:1">'+
    '<input id="ila-nf-s" class="ila-af-inp" placeholder="CODE" maxlength="4" style="width:52px;font-family:var(--m);text-transform:uppercase;text-align:center">'+
    '</div>'+
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
    '<input id="ila-nf-mic" class="ila-af-inp" placeholder="Micro (ex: SM57)" style="flex:1;min-width:90px">'+
    '<select id="ila-nf-stand" class="ila-af-sel">'+
    '<option value="">Pas de pied</option>'+
    '<option value="petit">Petit pied</option>'+
    '<option value="grand">Grand pied</option>'+
    '<option value="autre">Autre</option>'+
    '</select>'+
    '</div>'+
    '<div style="display:flex;gap:6px;margin-top:8px">'+
    '<button type="button" class="ila-af-ok" onclick="ilaAddItem(\''+catId+'\')"><i class="ti ti-plus"></i>Ajouter</button>'+
    '<button type="button" class="ila-af-cancel" onclick="ilaHideForm()"><i class="ti ti-x"></i></button>'+
    '</div></div>';
}

function _ilaRender() {
  var h = '';
  function renderBlock(catId, label, icon, builtinItems, isCustomCat) {
    var open = !!_ilaCatOpen[catId], total = _ilaCatTotal(catId);
    h += '<div class="ila-cat'+(open?' open':'')+'" data-cat="'+catId+'">';
    h += '<div class="ila-cat-hd" data-cat="'+catId+'" onclick="ilaToggleCat(\''+catId+'\')">';
    h += '<i class="ti '+icon+' ila-cat-hd-icon"></i>';
    h += '<span class="ila-cat-hd-label">'+label+'</span>';
    h += '<span class="ila-cat-hd-badge'+(total>0?' show':'')+'" id="ila-cat-cnt-'+catId+'">'+total+'</span>';
    if (isCustomCat)
      h += '<button type="button" class="ila-cat-del" onclick="event.stopPropagation();ilaRemoveCat(\''+catId+'\')" title="Supprimer"><i class="ti ti-trash"></i></button>';
    h += '<i class="ti ti-chevron-right ila-cat-hd-arr" style="'+(open?'transform:rotate(90deg)':'')+'"></i>';
    h += '</div>';
    h += '<div class="ila-cat-body" data-cat="'+catId+'" style="'+(open?'':'display:none')+'">';
    builtinItems.forEach(function(it){ h += _ilaItemRow(it, false, catId); });
    (_ilaCustomItems[catId]||[]).forEach(function(it){ h += _ilaItemRow(it, true, catId); });
    if (_ilaFormCat === catId) h += _ilaAddItemForm(catId);
    else h += '<div class="ila-add-item-btn" onclick="ilaShowItemForm(\''+catId+'\')"><i class="ti ti-plus"></i>Ajouter un instrument</div>';
    h += '</div></div>';
  }
  ILA_CATS.forEach(function(cat){ renderBlock(cat.id, cat.label, cat.icon, cat.items, false); });
  _ilaCustomCats.forEach(function(cat){ renderBlock(cat.id, cat.label, cat.icon||'ti-folder', [], true); });
  if (_ilaFormCat === '__new__') {
    h += '<div class="ila-add-cat-form">';
    h += '<input id="ila-ncat-label" class="ila-af-inp" placeholder="Nom de la categorie" style="width:100%;margin-bottom:8px">';
    h += '<div style="display:flex;gap:6px">';
    h += '<button type="button" class="ila-af-ok" onclick="ilaAddCat()"><i class="ti ti-folder-plus"></i>Creer</button>';
    h += '<button type="button" class="ila-af-cancel" onclick="ilaHideForm()"><i class="ti ti-x"></i></button>';
    h += '</div></div>';
  } else {
    h += '<button type="button" class="ila-add-cat-btn" onclick="ilaShowCatForm()"><i class="ti ti-folder-plus"></i>Nouvelle categorie</button>';
  }
  document.getElementById('ila-sections').innerHTML = h;
  _ilaUpdateCount();
  if (_ilaFormCat) {
    var inp = document.querySelector('#ila-sections .ila-af-inp');
    if (inp) setTimeout(function(){ inp.focus(); }, 30);
  }
}

function _ilaUpdateCount() {
  var total = _ilaAllChannels().length;
  document.getElementById('ila-count').textContent = total;
  document.getElementById('ila-total').style.display = total > 0 ? 'flex' : 'none';
  var vis = total > 0 ? 'inline-flex' : 'none';
  document.getElementById('ila-apply-btn').style.display = vis;
  document.getElementById('ila-save-tpl-btn').style.display = vis;
}

function _ilaAllChannels() {
  var rows = [];
  function pushItem(item) {
    var n = _ilaCount[item.id]||0;
    for (var i = 1; i <= n; i++) {
      rows.push({
        s: n>1 ? item.s.slice(0,3)+i : item.s,
        l: n>1 ? item.label+' '+i    : item.label,
        source: item.source||'', mic: item.mic||'',
        phantom: item.phantom||false,
        note: _ILA_STAND_F[item.stand]||''
      });
    }
  }
  ILA_CATS.forEach(function(cat){
    cat.items.forEach(pushItem);
    (_ilaCustomItems[cat.id]||[]).forEach(pushItem);
  });
  _ilaCustomCats.forEach(function(cat){
    (_ilaCustomItems[cat.id]||[]).forEach(pushItem);
  });
  return rows;
}

async function applyILAssist() {
  let chs = _ilaAllChannels();
  if (!chs.length) return;

  /* ── Enforce plan channel limit ── */
  const limit = planLimit('max_channels');
  if (limit !== Infinity) {
    const projected = CHS.length + chs.length;
    if (projected > limit) {
      const available = limit - CHS.length;
      if (available <= 0) { showUpgradeModal('max_channels'); return; }
      /* Truncate to the remaining slots and warn */
      chs = chs.slice(0, available);
      toast('⚠️ Plan Gratuit : limite de ' + limit + ' canaux — seulement ' + available + ' canal' + (available > 1 ? 'ux' : '') + ' ajouté' + (available > 1 ? 's' : '') + ' sur ' + projected + ' demandés.');
    }
  }

  const btn = document.getElementById('ila-apply-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Creation...';
  try {
    let startCh = CHS.length + 1;
    for (let i = 0; i < chs.length; i++) {
      const c = chs[i];
      const row = {
        show_id: CUR_SHOW.id,
        ch: startCh + i,
        short_name: (c.s || '').slice(0, 10),
        long_name: c.l || '',
        source: c.source || '',
        mic: c.mic || '',
        gain: 0,
        phantom: c.phantom || false,
        iem_group: '',
        foh: true,
        mon: false,
        bc: false,
        note: c.note || '',
      };
      if(_patchColReady) row.patch_id=CUR_PATCH_ID;
      const { data, error } = await sb.from('channels').insert(row).select().single();
      if (error) throw new Error('Canal ' + (i + 1) + ' : ' + error.message);
      CHS.push(data);
    }
    renderTable();
    closeILAssist();
    toast(chs.length + ' canaux crees !');
  } catch (e) {
    renderTable();
    toast('Erreur : ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i>Creer les canaux';
  }
}

async function saveILAAsTemplate(){
  const chs=_ilaAllChannels();
  if(!chs.length){toast('Aucun canal configure.');return;}
  const name=prompt('Nom du template :','');
  if(!name||!name.trim()) return;
  const ICONS=['🎸','🎤','🎹','🎺','🎻','🥁','🎧','📡','🎭','🏢'];
  const icon=ICONS[USER_TPLS.length%ICONS.length];
  const channels=chs.map((c,i)=>({
    ch:i+1,
    short_name:(c.s||'').slice(0,10),
    long_name:c.l||'',
    source:c.source||'',
    mic:c.mic||'',
    gain:0,
    phantom:!!c.phantom,
    iem_group:'',
    foh:true,
    mon:false,
    bc:false,
    note:c.note||''
  }));
  const btn=document.getElementById('ila-save-tpl-btn');
  btn.disabled=true;
  const {data,error}=await sb.from('templates').insert({owner_id:ME.id,name:name.trim(),description:'',icon,tags:[],channels,is_public:false}).select().single();
  btn.disabled=false;
  if(error){toast('Erreur : '+error.message);return;}
  USER_TPLS.unshift(data);
  renderSPTplsUser();
  renderTplQuickBar();
  toast('Template "'+name.trim()+'" sauvegarde ('+channels.length+' CH)');
  closeILAssist();
}

// ══════════════════════════════════════
// RENDER TABLE
// ══════════════════════════════════════
const _NOTE_ABBR={'gp':'Grand pied','pp':'Petit pied','er':'Embase ronde','pt':'Pied de table','pc':'Pince','pe':'Perche'};
function _expandNoteAbbr(inp){
  var v=inp.value.trim().toLowerCase();
  if(_NOTE_ABBR[v]){inp.value=_NOTE_ABBR[v];}
  return inp.value;
}
function renderTable(){
  if(typeof SectionUndo!=='undefined') SectionUndo.record('il', function(){ return CHS; });
  initDragDrop();
  if(CHS.length===0){setILBody('<div class="loading" style="color:var(--muted)"><i class="ti ti-inbox" style="font-size:20px"></i>Aucun canal — clique sur "+ Canal" pour commencer</div>',true);}
  else{
    document.getElementById('il-body').innerHTML=CHS.map(r=>`
    <tr data-rid="${r.id}" draggable="true">
      <td class="ch-num">${r.ch}</td>
      <td data-col="short" data-label="Court"><input class="ilinp sh" maxlength="4" value="${_oh((r.short_name||'').trim())}" onchange="scheduleSave('${r.id}','short_name',this.value.toUpperCase().slice(0,4));renderPills()"/></td>
      <td data-col="long" data-label="Nom long"><input class="ilinp" value="${_oh(r.long_name||'')}" onchange="scheduleSave('${r.id}','long_name',this.value);renderPills()"/></td>
      <td data-col="src" data-label="Source"><input class="ilinp" style="color:var(--txt2)" value="${_oh(r.source||'')}" onchange="scheduleSave('${r.id}','source',this.value)"/></td>
      <td data-col="mic" data-label="Micro/DI"><input class="ilinp m" value="${_oh(r.mic||'')}" onchange="scheduleSave('${r.id}','mic',this.value)"/></td>
      <td data-col="gain" data-label="Gain"><input class="ilinp m" type="number" style="width:42px" value="${r.gain||0}" min="-60" max="60" step="1" onchange="scheduleSave('${r.id}','gain',parseInt(this.value)||0)"/></td>
      <td data-col="phantom" data-label="+48V" style="text-align:center"><input type="checkbox" class="cb" ${r.phantom?'checked':''} onchange="scheduleSave('${r.id}','phantom',this.checked)"/></td>
      <td data-col="iem" data-label="IEM"><input class="ilinp m" style="color:var(--grn);width:46px" value="${_oh(r.iem_group||'')}" onchange="scheduleSave('${r.id}','iem_group',this.value)" placeholder="GR1"/></td>
      <td data-col="hf" data-label="Fréq. HF"><input class="ilinp m" style="color:var(--accent2,#9b6aff);width:74px" value="${_oh((r.custom_data&&r.custom_data._hf)||'')}" onchange="saveCustomCell('${r.id}','_hf',this.value)" placeholder="MHz"/></td>
      <td data-col="foh" data-label="FOH" style="text-align:center"><input type="checkbox" class="cb blu" ${r.foh?'checked':''} onchange="scheduleSave('${r.id}','foh',this.checked)"/></td>
      <td data-col="mon" data-label="MON" style="text-align:center"><input type="checkbox" class="cb warn" ${r.mon?'checked':''} onchange="scheduleSave('${r.id}','mon',this.checked)"/></td>
      <td data-col="bc" data-label="BC" style="text-align:center"><input type="checkbox" class="cb grn" ${r.bc?'checked':''} onchange="scheduleSave('${r.id}','bc',this.checked)"/></td>
      <td data-col="note" data-label="Note"><input class="ilinp" list="il-note-list" style="color:var(--txt2)" value="${_oh(r.note||'')}" placeholder="—" onchange="scheduleSave('${r.id}','note',_expandNoteAbbr(this))" onblur="_expandNoteAbbr(this)"/></td>
      ${_getCustomCols().map(col=>{const v=(r.custom_data&&r.custom_data[col.id])||'';return `<td data-col="${col.id}" data-label="${_oh(col.label||'')}" style="text-align:${col.type==='bool'?'center':'left'}">${_customCellHTML(col,r.id,v)}</td>`;}).join('')}
      <td class="il-actions-cell" style="white-space:nowrap">
        <i class="ti ti-grip-vertical drag-handle"></i>
        <button class="move-btn" onclick="moveRow('${r.id}',-1)" ${r.ch===1?'disabled':''}><i class="ti ti-chevron-up"></i></button>
        <button class="move-btn" onclick="moveRow('${r.id}',1)" ${r.ch===CHS.length?'disabled':''}><i class="ti ti-chevron-down"></i></button>
        <button class="del-btn" onclick="delRow('${r.id}')"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`).join('');
  }
  applyColVis();renderPills();updateStats();
  _saveChsSnapshot();
  _loadCustomColsIntoTable();
}

// ══════════════════════════════════════
// REALTIME
// ══════════════════════════════════════
function subRT(){
  if(RT){RT.unsubscribe();}
  setRT(true);
  RT=sb.channel('show:'+CUR_SHOW.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'channels',filter:'show_id=eq.'+CUR_SHOW.id},p=>{
      if(p.new?.updated_by===ME.id)return;
      const{eventType:ev,new:nr,old:or}=p;
      if(ev==='INSERT'&&!CHS.find(r=>r.id===nr.id)){CHS.push(nr);CHS.sort((a,b)=>a.ch-b.ch);}
      else if(ev==='UPDATE'){const i=CHS.findIndex(r=>r.id===nr.id);if(i>=0){CHS[i]=nr;flashRow(nr.id);}}
      else if(ev==='DELETE'){CHS=CHS.filter(r=>r.id!==or.id);}
      renderTable();
      if(!(_chRTSuppress&&Date.now()<_chRTSuppress)) toast('↻ Modifié par un collaborateur');
    })
    .subscribe(function(s){
      if(s==='SUBSCRIBED'){setRT('live');_hideOfflineBanner();}
      else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT'||s==='CLOSED'){
        if(!navigator.onLine)_showOfflineBanner();
        else setRT(false);
      }
    });
}
function flashRow(id){const r=document.querySelector(`tr[data-rid="${id}"]`);if(r){r.classList.add('flash');setTimeout(()=>r.classList.remove('flash'),600);}}
function setRT(state){
  var d=document.getElementById('rt-dot'),l=document.getElementById('rt-lbl');
  if(!d)return;
  if(state==='offline'){
    d.className='rt-dot offline';
    if(l)l.textContent='hors ligne';
  } else if(state===true||state==='live'){
    d.className='rt-dot live';
    if(l)l.textContent='live';
  } else {
    d.className='rt-dot';
    if(l)l.textContent='—';
  }
}
function _showOfflineBanner(){
  var b=document.getElementById('offline-banner');
  if(b&&!b.classList.contains('show')){b.classList.add('show');setRT('offline');}
}
function _hideOfflineBanner(){
  var b=document.getElementById('offline-banner');
  if(b){b.classList.remove('show');}
}
async function _retryConn(){
  if(!navigator.onLine){toast('Toujours hors ligne — vérifie ta connexion.');return;}
  _hideOfflineBanner();
  toast('Reconnexion en cours…');
  /* Re-tente effectivement les opérations en attente */
  try{
    /* Si on n'a pas encore de profil/show, ré-init complète */
    if(!ME || !SHOWS || !SHOWS.length){
      await initApp();
    } else {
      /* Sinon ré-abonne realtime + refresh shows légèrement */
      if(CUR_SHOW) subRT();
    }
    toast('✓ Connexion rétablie');
  }catch(e){
    toast('Reconnexion impossible : '+e.message);
    _showOfflineBanner();
  }
}
window.addEventListener('offline',function(){
  _showOfflineBanner();
  toast('⚠ Connexion perdue — mode hors ligne');
});
window.addEventListener('online',function(){
  _hideOfflineBanner();
  toast('✓ Connexion rétablie');
  if(CUR_SHOW) subRT();
  /* Flush des écritures en attente (autosave différé) si présent */
  if(typeof _flushPendingWrites==='function') _flushPendingWrites();
});
// Init : si deja offline au chargement
if(!navigator.onLine){_showOfflineBanner();}

// ══════════════════════════════════════
// TEAM
// ══════════════════════════════════════
async function loadMembers(){
  const grid=document.getElementById('team-grid');
  const {data,error}=await sb.from('show_members').select('*,profiles(full_name,email,role,plan,avatar_url)').eq('show_id',CUR_SHOW.id);
  if(error){console.error('members error:',error);toast('Erreur membres : '+error.message);}
  const members=(error?[]:data)||[];
  SHOW_MEMBERS_MAP[CUR_SHOW.id]=members;

  const COLS=['rgba(255,107,26,.13)','rgba(26,143,255,.13)','rgba(245,197,66,.13)','rgba(155,106,255,.13)','rgba(34,214,160,.13)'];
  const TC=['var(--ora)','var(--blu2)','var(--warn)','#c4a0ff','var(--grn)'];
  const _es=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const planPill=p=>{const labels={free:'Gratuit',pro:'Pro'};return `<span class="plan-badge-pill ${_es(p||'free')}">${_es(labels[p||'free']||p||'free')}</span>`;};
  const roleBadge=r=>{const l=ROLE_LABELS[r]||r;const c=ROLE_COLORS[r]||'var(--muted)';return `<span style="background:${c}18;color:${c};border:1px solid ${c}44;border-radius:5px;font-size:9px;padding:2px 7px;font-family:var(--m);text-transform:uppercase;letter-spacing:.5px">${_es(l)}</span>`;};
  const mkAv=(name,bg,col,avatarUrl,plan)=>{
    const inner=_avHtml(name,avatarUrl,plan,38,bg,col);
    return `<div class="tc-av" style="background:transparent">${inner}</div>`;
  };

  const isOwner = CUR_SHOW?.owner_id === ME?.id;
  let html='';
  /* Le quota de membres dépend du plan du PROPRIÉTAIRE du show (c'est lui qui
     invite/paie), pas du plan de la personne qui regarde. */
  let ownerPlan = isOwner ? (PROFILE?.plan || 'free') : 'free';

  if(isOwner){
    /* Current user IS the owner — show them first */
    const ownerName=PROFILE?.full_name||ME.email;
    html=`<div class="tc"><div class="tc-head">${mkAv(ownerName,'var(--ora-d)','var(--ora)',PROFILE?.avatar_url,PROFILE?.plan)}<div><div class="tc-name">${_es(ownerName)}</div><div class="tc-role" style="font-size:9px;color:var(--muted)">${_es(ME.email)}</div></div></div><div class="tc-perms">${roleBadge('admin')}<span class="tag t-ora">Propriétaire</span>${planPill(PROFILE?.plan)}</div><div class="tc-status"><span class="on-dot"></span>En ligne · toi</div></div>`;
  } else {
    /* Current user is a member — fetch actual owner's profile first */
    const {data:ownerProf}=await sb.from('profiles').select('full_name,email,plan,avatar_url').eq('id',CUR_SHOW.owner_id).maybeSingle();
    ownerPlan = ownerProf?.plan || 'free';
    const ownerName=ownerProf?.full_name||ownerProf?.email||'Propriétaire';
    html=`<div class="tc"><div class="tc-head">${mkAv(ownerName,'var(--ora-d)','var(--ora)',ownerProf?.avatar_url,ownerProf?.plan)}<div><div class="tc-name">${_es(ownerName)}</div><div class="tc-role" style="font-size:9px;color:var(--muted)">${_es(ownerProf?.email||'')}</div></div></div><div class="tc-perms">${roleBadge('admin')}<span class="tag t-ora">Propriétaire</span>${planPill(ownerProf?.plan)}</div><div class="tc-status"><span class="off-dot"></span>Owner</div></div>`;
  }

  members.forEach((m,i)=>{
    const isSelf = m.user_id === ME?.id;
    const n=m.profiles?.full_name||m.profiles?.email||'Membre';
    const ci=(i+1)%COLS.length;
    const mPlan=isSelf?PROFILE?.plan:m.profiles?.plan;
    const mAvatar=isSelf?PROFILE?.avatar_url:m.profiles?.avatar_url;
    const delBtn=isOwner&&!isSelf?`<button onclick="removeMember('${_es(m.id)}')" title="Retirer du show" style="margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:2px 5px;border-radius:4px;transition:color .15s" onmouseover="this.style.color='var(--err)'" onmouseout="this.style.color='var(--muted)'"><i class="ti ti-user-minus"></i></button>`:'';
    const status=isSelf?`<span class="on-dot"></span>En ligne · toi`:`<span class="off-dot"></span>Membre`;
    html+=`<div class="tc"><div class="tc-head">${mkAv(n,COLS[ci],TC[ci],mAvatar,mPlan)}<div><div class="tc-name">${_es(n)}</div><div class="tc-role" style="font-size:9px;color:var(--muted)">${_es(m.profiles?.email||'')}</div></div>${delBtn}</div><div class="tc-perms">${roleBadge(m.role||'editor')}${planPill(mPlan)}</div><div class="tc-status">${status}</div></div>`;
  });

  grid.innerHTML=html;grid.className='team-grid';
  _renderTeamQuota(ownerPlan, members.length, isOwner);
  _renderContactsBar();
}

/* Indicateur de quota de membres dans l'onglet Équipe : illimité (Pro) ou
   nombre invités / limite (Gratuit), avec lien d'upgrade pour le propriétaire. */
function _renderTeamQuota(ownerPlan, used, isOwner){
  const el=document.getElementById('team-quota');
  if(!el) return;
  const perms=PLAN_PERMS[ownerPlan||'free']||PLAN_PERMS.free;
  const limit=(typeof perms.max_members==='number')?perms.max_members:Infinity;
  let html;
  if(limit===Infinity){
    html='<i class="ti ti-infinity" style="font-size:14px;color:var(--grn)"></i>'
      +'<span>Membres <strong style="color:var(--grn)">illimités</strong> <span style="color:var(--muted2)">· plan Pro</span></span>';
  }else{
    const remaining=Math.max(0,limit-used);
    const full=remaining===0;
    html='<i class="ti ti-users" style="font-size:13px;color:'+(full?'var(--warn)':'var(--ora)')+'"></i>'
      +'<span><strong style="color:var(--txt)">'+used+' / '+limit+'</strong> membre'+(limit>1?'s':'')+' invité'+(used>1?'s':'')
      +(full?' — limite atteinte':'')+'</span>';
    if(isOwner){
      html+='<span style="color:var(--muted2)">·</span>'
        +'<span style="color:var(--ora);cursor:pointer;text-decoration:underline" onclick="showUpgradeModal(\'max_members\')">Passez Pro pour une équipe illimitée</span>';
    }
  }
  el.innerHTML=html;
  el.style.display='flex';
}
/* ── Role labels ── */
const ROLE_LABELS = { admin:'Administrateur', editor:'Éditeur', viewer:'Lecture seule' };
const ROLE_COLORS = { admin:'var(--err)', editor:'var(--ora)', viewer:'var(--muted)' };

function _invMsg(msg, ok) {
  const el = document.getElementById('inv-msg');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.style.background = ok ? 'rgba(34,214,160,.08)' : 'rgba(255,77,106,.08)';
  el.style.border = '1px solid ' + (ok ? 'rgba(34,214,160,.25)' : 'rgba(255,77,106,.25)');
  el.style.color = ok ? 'var(--grn)' : 'var(--err)';
  el.textContent = msg;
}

async function inviteMember() {
  if (window._inviting) return; /* guard anti-double-envoi */
  const emailEl = document.getElementById('inv-email');
  const roleEl  = document.getElementById('inv-role');
  const btn     = document.getElementById('inv-btn');
  const email   = emailEl.value.trim().toLowerCase();
  const role    = roleEl.value;
  if (!email) { _invMsg('Renseignez une adresse email.', false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _invMsg('Adresse email invalide.', false); return; }
  if (!CUR_SHOW) { _invMsg('Aucun show sélectionné.', false); return; }

  /* Plan limit check */
  const limit = planLimit('max_members');
  const currentCount = (SHOW_MEMBERS_MAP[CUR_SHOW.id] || []).length;
  if (limit !== Infinity && currentCount >= limit) { showUpgradeModal('max_members'); return; }

  window._inviting = true;
  btn.disabled = true;
  emailEl.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i>Envoi…';
  _invMsg('', false);

  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) { _invMsg('Vous devez être connecté.', false); return; }

    const res = await fetch(
      'https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/invite-member',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': SB_KEY,
        },
        body: JSON.stringify({ showId: CUR_SHOW.id, email, role }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      _invMsg(data.error || 'Erreur lors de l\'invitation.', false);
    } else {
      const action = data.action;
      const msg = action === 'added_directly'
        ? `✓ ${email} a été ajouté au show (compte existant).`
        : `✓ Invitation envoyée à ${email} — il recevra un lien pour rejoindre PatchFlow.`;
      _invMsg(msg, true);
      _saveContactEmail(email);
      emailEl.value = '';
      loadMembers(); // refresh member list
    }
  } catch (e) {
    _invMsg('Erreur réseau : ' + e.message, false);
  } finally {
    window._inviting = false;
    btn.disabled = false;
    emailEl.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i>Inviter';
  }
}

async function removeMember(memberId) {
  if (!confirm('Retirer ce membre du show ?')) return;
  const { error } = await sb.from('show_members').delete().eq('id', memberId);
  if (error) { toast('Erreur : ' + error.message); return; }
  toast('Membre retiré.');
  loadMembers();
}

/* ── Saved contacts (localStorage) ── */
const _CONTACTS_KEY='pf_saved_emails';
function _jsq(s){return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function _getSavedEmails(){try{return JSON.parse(localStorage.getItem(_CONTACTS_KEY)||'[]');}catch(e){return[];}}
function _saveContactEmail(email){
  if(!email)return;
  const list=_getSavedEmails().filter(e=>e!==email);
  list.unshift(email);
  localStorage.setItem(_CONTACTS_KEY,JSON.stringify(list.slice(0,30)));
  _renderContactsBar();
}
function _removeContactEmail(email){
  const list=_getSavedEmails().filter(e=>e!==email);
  localStorage.setItem(_CONTACTS_KEY,JSON.stringify(list));
  _renderContactsBar();
}
function _renderContactsBar(){
  const bar=document.getElementById('contacts-bar');
  if(!bar)return;
  const list=_getSavedEmails();
  const dl=document.getElementById('inv-email-list');
  const _es=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  if(dl)dl.innerHTML=list.map(e=>`<option value="${_es(e)}">`).join('');
  if(!list.length){bar.innerHTML='';return;}
  let html=`<div class="contacts-bar-label"><i class="ti ti-bookmark" style="font-size:9px"></i>Contacts enregistrés</div>`;
  list.forEach(e=>{
    html+=`<span class="contact-pill" onclick="document.getElementById('inv-email').value='${_jsq(e)}';document.getElementById('inv-email').focus()" title="${_es(e)}"><span>${_es(e)}</span><button class="contact-pill-del" onclick="event.stopPropagation();_removeContactEmail('${_jsq(e)}')" title="Retirer"><i class="ti ti-x"></i></button></span>`;
  });
  bar.innerHTML=html;
}

/* Process pending show invites after login */
/* Charge les invitations en attente sous forme de NOTIFICATIONS
   (l'utilisateur les accepte manuellement depuis le panneau). */
async function processShowInvites() {
  /* 1. Auto-accept si ?invite=<id> dans l'URL OU sessionStorage.
        GUARD : onAuthStateChange déclenche initApp() plusieurs fois
        (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED). Sans garde, l'auto-accept
        se lançait 2× et le 2e appel échouait → faux message d'erreur.
        Le flag est posé AVANT le await pour bloquer les appels concurrents. */
  if(!window._autoAcceptTried){
    try{
      var params=new URLSearchParams(location.search);
      var inviteId=params.get('invite') || sessionStorage.getItem('pf_pending_invite');
      if(inviteId){
        window._autoAcceptTried=true;
        console.log('[autoAccept] tentative pour invite', inviteId);
        var {data,error}=await sb.rpc('accept_show_invite',{p_invite_id:inviteId});
        console.log('[autoAccept] rpc resp:', {data, error});
        if(error){
          /* Erreur réseau / JWT pas prêt → réessayer plus tard */
          window._autoAcceptTried=false;
          sessionStorage.setItem('pf_pending_invite', inviteId);
          console.warn('[autoAccept] err, retry plus tard:', error.message);
        } else if(data && data.ok){
          /* Succès (joined) ou idempotent (already) : dans les deux cas on a rejoint */
          sessionStorage.removeItem('pf_pending_invite');
          if(data.joined){ toast('✓ Vous avez rejoint le show !'); }
          try{ await loadShows(); renderSPShows(); renderSessions(); }catch(e){}
        } else if(data && data.error==='not_your_invite'){
          sessionStorage.removeItem('pf_pending_invite');
          toast('⚠ Cette invitation est destinée à une autre adresse email. Connectez-vous avec le bon compte.');
        } else if(data && data.error==='not_authenticated'){
          /* Session pas encore établie : réessayer au prochain initApp */
          window._autoAcceptTried=false;
          sessionStorage.setItem('pf_pending_invite', inviteId);
        }
        /* Nettoyer l'URL pour éviter re-acceptation au refresh */
        try{ history.replaceState({},'',location.pathname); }catch(e){}
      }
    }catch(e){ window._autoAcceptTried=false; console.warn('[autoAccept] catch:',e); }
  }

  /* 2. Charger les notifications restantes */
  await refreshNotifications();
  if (_PENDING_INVITES.length) {
    var n = _PENDING_INVITES.length;
    toast('🔔 ' + n + ' invitation' + (n>1?'s':'') + ' en attente — ouvrez votre espace pour ' + (n>1?'les':'l\'') + ' accepter');
  }
}

/* ── Rider link builder ── */
var _riderSections={il:true,out:true,syno:true,stage:true,site:true,cloud:false};
var _riderPickedFiles=new Set();

/* ══════════════════════════════════════
   SUIVI UNIFIÉ DES LIENS DE PARTAGE
   Compte TOUS les liens (input list, output, synoptique, plans, rider).
   Clé = "showId:section". Persisté dans profiles.shared_links.
   Limite : 5 au total pour le plan Gratuit, illimité Pro.
   ══════════════════════════════════════ */
let SHARED_LINKS = new Set();

/* Initialise le set depuis le profil + migre les liens rider existants */
function _initSharedLinks(){
  SHARED_LINKS = new Set();
  try{
    var arr = (PROFILE && PROFILE.shared_links) || [];
    if(Array.isArray(arr)) arr.forEach(function(k){ SHARED_LINKS.add(k); });
  }catch(e){}
  /* Rétro-compat : les shows ayant déjà une config rider comptent comme 1 lien */
  (SHOWS||[]).forEach(function(s){
    if(s.owner_id===ME?.id && s.stage_data && s.stage_data.rider){
      SHARED_LINKS.add(s.id+':rider');
    }
  });
}

function _countShareLinks(){ return SHARED_LINKS.size; }

async function _persistSharedLinks(){
  try{
    var arr = Array.from(SHARED_LINKS);
    if(PROFILE) PROFILE.shared_links = arr;
    await sb.from('profiles').update({shared_links:arr}).eq('id',ME.id);
  }catch(e){ console.warn('persist shared_links:',e); }
}

/* Enregistre un lien de partage. Retourne true si autorisé, false si limite atteinte.
   section : 'il' | 'out' | 'syno' | 'stage' | 'site' | 'rider' */
function registerShareLink(section){
  if(!CUR_SHOW) return true;
  var key = CUR_SHOW.id + ':' + section;
  if(SHARED_LINKS.has(key)) return true; // déjà compté
  var lim = planLimit('max_share_links');
  if(lim !== Infinity && SHARED_LINKS.size >= lim){
    showUpgradeModal('max_share_links');
    return false;
  }
  SHARED_LINKS.add(key);
  _persistSharedLinks();
  _updateShareQuotaUI();
  return true;
}

/* Met à jour les affichages du compteur (builder rider + modale abonnement) */
function _updateShareQuotaUI(){
  var lim = planLimit('max_share_links');
  var used = SHARED_LINKS.size;
  // Builder rider
  var quota=document.getElementById('rider-quota');
  if(quota){
    if(lim===Infinity){ quota.style.display='none'; }
    else{
      quota.style.display='block';
      quota.innerHTML='<i class="ti ti-link" style="font-size:10px"></i> '+used+' / '+lim+' liens utilisés'
        +(used>=lim?' — <span style="color:var(--ora);cursor:pointer;text-decoration:underline" onclick="showUpgradeModal(\'max_share_links\')">Passez Pro pour des liens illimités</span>':'');
    }
  }
  // Modale abonnement
  var subEl=document.getElementById('sub-sharelinks-row');
  if(subEl){
    if(lim===Infinity){
      subEl.querySelector('#sub-sl-val').textContent='Illimités';
      var bar=subEl.querySelector('#sub-sl-bar'); if(bar)bar.style.width='100%';
    }else{
      subEl.querySelector('#sub-sl-val').textContent=used+' / '+lim;
      var pct=Math.min(100,used/lim*100);
      var bar2=subEl.querySelector('#sub-sl-bar');
      if(bar2){ bar2.style.width=pct+'%'; bar2.style.background=used>=lim?'var(--err)':used>=lim*0.6?'var(--warn)':'var(--ora)'; }
    }
  }
}

async function generateRiderLink(){
  if(!CUR_SHOW){toast('Aucun show selectionne.');return;}
  /* Limite de liens de partage pour le plan Gratuit (5 max, tout compris) */
  if(!registerShareLink('rider')) return;
  var btn=document.getElementById('rider-gen-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Sauvegarde...';}
  var t=document.getElementById('rider-title');
  var n=document.getElementById('rider-note');
  var inf=document.getElementById('rider-info');
  // Snapshot out_data, synoptique_data and site plan PNG into rider so share view always has them
  var outSnap=CUR_SHOW.out_data||OUT_DATA||{};
  var synSnap=CUR_SHOW.synoptique_data||null;

  /* Snapshot du plan de site en PNG base64 (SitePlan ne peut pas se re-rendre
     dans la vue lecture seule car le DOM #site-viewport n'y est pas).
     Charger les données si SitePlan est vide (onglet jamais ouvert dans cette session). */
  if(!SitePlan.hasContent()){
    var _sSD=CUR_SHOW?.stage_data?.site||null;
    var _sSC=null;
    if(!_sSD&&SHOW_SCENES.site&&SHOW_SCENES.site.length){
      var _cSS=SHOW_SCENES.site.find(function(s){return s.id===CUR_SCENES.site;});
      _sSC=_cSS&&_cSS.data&&_cSS.data.site||null;
    }
    var _sL=_sSD||_sSC; if(_sL) SitePlan.load(_sL);
  }
  var siteSnap=null;
  try{
    siteSnap = await new Promise(function(resolve){
      var timer=setTimeout(function(){resolve(null);},6000);
      SitePlan.exportCanvasSafe(function(cv){
        clearTimeout(timer);
        resolve(cv?cv.toDataURL('image/png'):null);
      });
    });
  }catch(e){siteSnap=null;}
  /* Fallback : si SitePlan n'a rien rendu, essayer directement depuis les données */
  if(!siteSnap){
    var _fbSiteData=CUR_SHOW?.stage_data?.site||null;
    if(!_fbSiteData&&SHOW_SCENES.site&&SHOW_SCENES.site.length){
      var _fbSS=SHOW_SCENES.site.find(function(s){return s.id===CUR_SCENES.site;});
      _fbSiteData=_fbSS&&_fbSS.data&&_fbSS.data.site||null;
    }
    if(_fbSiteData&&_fbSiteData.elements&&_fbSiteData.elements.length){
      siteSnap = await new Promise(function(resolve){
        /* Utiliser le renderer SitePlan._makeCanvas directement si disponible */
        SitePlan.load(_fbSiteData);
        var timer=setTimeout(function(){resolve(null);},8000);
        SitePlan.exportCanvasSafe(function(cv){
          clearTimeout(timer);
          resolve(cv?cv.toDataURL('image/png'):null);
        });
      });
    }
  }

  var _activeSecs=Object.keys(_riderSections).filter(function(k){return _riderSections[k];});
  var cfg={
    sections:_activeSecs,
    title:(t&&t.value.trim())||'',
    note:(n&&n.value.trim())||'',
    info:(inf&&inf.value.trim())||'',
    /* Sauvegarder les fichiers UNIQUEMENT si des fichiers ont été explicitement
       cochés — évite d'envoyer des résidus d'une ancienne génération */
    files:_riderPickedFiles.size>0?Array.from(_riderPickedFiles):[],
    out_snapshot:outSnap,
    syn_snapshot:synSnap,
    site_snapshot:siteSnap
  };
  var sd=Object.assign({},CUR_SHOW.stage_data||{v:2},{rider:cfg});
  CUR_SHOW.stage_data=sd;
  // Also explicitly persist out_data and synoptique_data in their own columns
  var {error}=await sb.from('shows').update({stage_data:sd}).eq('id',CUR_SHOW.id);
  if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-link"></i>Generer le lien';}
  if(error){toast('Erreur sauvegarde : '+error.message);return;}
  // Show URL
  var url=_riderBase()+'?rider='+CUR_SHOW.id;
  var urlEl=document.getElementById('slink-url');
  if(urlEl)urlEl.textContent=url;
  var row=document.getElementById('rider-link-row');
  if(row)row.style.display='block';
  var ok=document.getElementById('rider-saved-ok');
  if(ok){ok.style.display='block';setTimeout(function(){ok.style.display='none';},3000);}
  _updateShareQuotaUI();
}

/* ── Export PDF complet du rider (toutes sections cochées) ── */
async function exportRiderPdf(){
  if(!CUR_SHOW){toast('Aucun show sélectionné.');return;}
  var btn=document.getElementById('rider-pdf-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Génération…';}

  var secs=Object.keys(_riderSections).filter(function(k){return _riderSections[k];});
  var rTitle=(document.getElementById('rider-title')?.value||'').trim()||CUR_SHOW.name||'Rider';
  var rNote =(document.getElementById('rider-note')?.value||'').trim();
  var rInfo =(document.getElementById('rider-info')?.value||'').trim();
  var show  =CUR_SHOW.name||'';
  var now   =new Date().toLocaleString('fr-FR');
  var accentColor='#ff6b1a';

  /* ── CSS partagé ── */
  var css=`*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',sans-serif;background:#fff;color:#1a1a2e;font-size:9.5px}
@page{size:A4 portrait;margin:10mm 12mm}
@page landscape{size:A4 landscape;margin:8mm 10mm}
.page{page-break-after:always}
.page:last-child{page-break-after:auto}
.hd{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 16px 10px;border-bottom:3px solid ${accentColor}}
.hl{display:flex;align-items:center;gap:10px}.ht{font-size:15px;font-weight:700}
.hs{font-size:9px;color:#888;font-family:'DM Mono',monospace;letter-spacing:.5px}
.hr{text-align:right}.hdt{font-size:10px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:1.5px;font-family:'DM Mono',monospace}
.hdm{font-size:8px;color:#666;font-family:'DM Mono',monospace}
.meta-bar{padding:8px 16px;background:#fffbf7;border-bottom:1px solid #ffe0c8}
.meta-title{font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:3px}
.meta-note{font-size:9px;color:#666;line-height:1.5;white-space:pre-wrap}
.meta-info{font-size:8.5px;color:#888;margin-top:3px;font-family:'DM Mono',monospace}
.tw{padding:7px 16px 0}
table{width:100%;border-collapse:collapse}
thead tr{background:${accentColor}}
th{color:#fff;padding:5px 7px;text-align:left;font-size:8px;letter-spacing:.8px;text-transform:uppercase;font-family:'DM Mono',monospace;white-space:nowrap}
td{padding:4px 7px;border-bottom:1px solid #f0eee8;vertical-align:middle}
.ch{font-family:'DM Mono',monospace;font-weight:700;color:${accentColor};text-align:center;width:26px}
.mo{font-family:'DM Mono',monospace;font-size:9px;color:#555}.mu{color:#888}
.badge-ph{background:#e8faf5;color:#22a07a;border:1px solid #b8e8d8;border-radius:3px;padding:1px 4px;font-size:7.5px;font-family:'DM Mono',monospace}
.badge-type{border:1px solid;border-radius:3px;padding:1px 5px;font-size:7.5px;font-family:'DM Mono',monospace;white-space:nowrap}
.ck{color:#1a8fff;font-weight:700}.ck-m{color:#f5c542;font-weight:700}
.sb{display:flex;flex-wrap:wrap;padding:5px 16px;background:#f8f8fa;border-top:1px solid #eee;font-family:'DM Mono',monospace;font-size:8px;gap:0}
.si{padding:0 14px 0 0;margin-right:14px;border-right:1px solid #e0e0e0;color:#666}.si:last-child{border-right:none}.sv{font-weight:700;color:${accentColor}}
.ft{display:flex;align-items:center;justify-content:space-between;padding:5px 16px;border-top:1px solid #eee;font-size:8px;color:#bbb;font-family:'DM Mono',monospace;margin-top:auto}
.fl{font-weight:700;color:${accentColor};letter-spacing:1px}
.img-wrap{padding:10px 16px;display:flex;justify-content:center;align-items:center}
.img-wrap img{max-width:100%;height:auto;border-radius:4px}
/* SVG inline (synoptique) : doit aussi être contraint à la largeur du conteneur,
   sinon il est rendu à ses dimensions natives et déborde de la page A4 → câbles coupés */
.img-wrap svg{max-width:100%;max-height:170mm;width:auto;height:auto;display:block}
.sec-lbl{font-family:'DM Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:${accentColor};padding:5px 16px 2px;background:#fff8f4}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

  /* ── Header commun ── */
  function _hdr(secLabel){
    return '<div class="hd"><div class="hl"><div style="font-size:22px;font-weight:900;color:'+accentColor+'">P</div>'
      +'<div><div class="ht">'+_fEsc(show)+'</div><div class="hs">'+_fEsc(rTitle)+(secLabel?' · '+secLabel:'')+'</div></div></div>'
      +'<div class="hr"><div class="hdt">'+secLabel+'</div><div class="hdm">'+now+'</div></div></div>'
      +(rNote||rInfo?'<div class="meta-bar">'
        +(rNote?'<div class="meta-note">'+_fEsc(rNote)+'</div>':'')
        +(rInfo?'<div class="meta-info">'+_fEsc(rInfo)+'</div>':'')
      +'</div>':'');
  }
  function _ftr(){
    return '<div class="ft"><span>'+_fEsc(show)+'</span><span>'+_fEsc(rTitle)+'</span><span>'+now+'</span></div>';
  }
  /* Lien partagé du rider + QR (le plus important — repris du style Input List) */
  const _riderShareUrl = _riderBase()+'?rider='+(CUR_SHOW?.id||'');
  function _riderQrBlock(){
    const qr='https://api.qrserver.com/v1/create-qr-code/?size=130x130&data='
      +encodeURIComponent(_riderShareUrl)+'&color=1a8fff&bgcolor=f4faff&margin=0&qzone=1';
    return '<div style="display:flex;align-items:center;gap:14px;padding:10px 16px;background:#f4faff;border-top:2px solid #1a8fff">'
      +'<img src="'+qr+'" width="58" height="58" style="flex-shrink:0;border-radius:5px"/>'
      +'<div style="min-width:0">'
        +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#1a8fff;font-weight:600;margin-bottom:2px">Fiche à jour en ligne</div>'
        +'<a href="'+_riderShareUrl+'" style="font-size:10px;color:#1a4fff;font-family:\'DM Mono\',monospace;word-break:break-all;text-decoration:none;font-weight:600">'+_riderShareUrl+'</a>'
        +'<div style="font-size:8px;color:#7a8a9a;margin-top:2px;font-family:\'DM Mono\',monospace">Scannez le QR code ou ouvrez le lien pour retrouver cette fiche à jour à tout moment.</div>'
      +'</div></div>';
  }

  /* ── Helper : Promise avec timeout pour les opérations canvas async ── */
  function _canvasPromise(fn, timeoutMs){
    return new Promise(function(resolve){
      var done=false;
      var timer=setTimeout(function(){ if(!done){done=true;resolve(null);} },timeoutMs||8000);
      try{
        fn(function(result){
          if(!done){done=true;clearTimeout(timer);resolve(result);}
        });
      }catch(e){ if(!done){done=true;clearTimeout(timer);resolve(null);} }
    });
  }

  /* ── S'assurer que stage/site sont chargés (si l'onglet n'a jamais été ouvert) ── */
  if(secs.includes('stage')||secs.includes('site')||secs.includes('syno')){
    if(!_stageReady) loadStage();
    if(secs.includes('syno') && !SynPro.isLoaded()){
      try{ SynPro.show(); }catch(e){}
      await new Promise(function(r){ setTimeout(r,150); });
    }
  }

  /* ── Construire les sections ── */
  var pages=[];

  try{
  for(var si=0;si<secs.length;si++){
    var s=secs[si];

    if(s==='il'){
      var ilBody='<table><thead><tr><th>CH</th><th>Court</th><th>Nom Long</th><th>Source</th><th>Micro/DI</th><th>+48V</th><th>FOH</th><th>MON</th></tr></thead><tbody>';
      CHS.forEach(function(r,i){
        ilBody+='<tr style="'+(i%2===1?'background:#fdf8f4':'')+'"><td class="ch">'+r.ch+'</td>'
          +'<td><b>'+_fEsc((r.short_name||'').trim())+'</b></td>'
          +'<td><span class="mu">'+_fEsc(r.long_name||'')+'</span></td>'
          +'<td><span class="mo">'+_fEsc(r.source||'')+'</span></td>'
          +'<td><span class="mo">'+_fEsc(r.mic||'')+'</span></td>'
          +'<td>'+(r.phantom?'<span class="badge-ph">+48V</span>':'')+'</td>'
          +'<td>'+(r.foh?'<span class="ck">✓</span>':'')+'</td>'
          +'<td>'+(r.mon?'<span class="ck-m">✓</span>':'')+'</td></tr>';
      });
      ilBody+='</tbody></table>';
      pages.push('<div class="page">'+_hdr('Input List')+'<div class="tw">'+ilBody+'</div>'
        +'<div class="sb"><div class="si">Total <span class="sv">'+CHS.length+'</span> canaux</div>'
        +'<div class="si">+48V <span class="sv">'+CHS.filter(function(r){return r.phantom;}).length+'</span></div>'
        +'<div class="si">FOH <span class="sv">'+CHS.filter(function(r){return r.foh;}).length+'</span></div>'
        +'<div class="si">MON <span class="sv">'+CHS.filter(function(r){return r.mon;}).length+'</span></div>'
        +'</div>'+_ftr()+'</div>');
    }

    else if(s==='out'){
      var outBody='<table><thead><tr><th>CH</th><th>Court</th><th>Nom Long</th><th>Type</th><th>Destination</th></tr></thead><tbody>';
      OUT_CHS.forEach(function(r,i){
        var t=OUT_TYPES[r.type]||OUT_TYPES.other;
        outBody+='<tr style="'+(i%2===1?'background:#fdf8f4':'')+'"><td class="ch">'+r.ch+'</td>'
          +'<td><b>'+_fEsc((r.short_name||'').trim())+'</b></td>'
          +'<td><span class="mu">'+_fEsc(r.long_name||'')+'</span></td>'
          +'<td><span class="badge-type" style="background:'+t.bg+';color:'+t.color+';border-color:'+t.color+'40">'+t.label+'</span></td>'
          +'<td><span class="mo">'+_fEsc(r.dest||'')+'</span></td></tr>';
      });
      outBody+='</tbody></table>';
      pages.push('<div class="page">'+_hdr('Output List')+'<div class="tw">'+outBody+'</div>'
        +'<div class="sb"><div class="si">Total <span class="sv">'+OUT_CHS.length+'</span> sorties</div></div>'
        +_ftr()+'</div>');
    }

    else if(s==='syno'){
      try{
        var ex=SynPro.buildExportSvg({skipHeader:true});
        if(ex&&ex.svg){
          var svgWrapped='<div class="img-wrap" style="padding:0">'+ex.svg+'</div>';
          pages.push('<div class="page">'+_hdr('Synoptique')+svgWrapped+_ftr()+'</div>');
        }
      }catch(e){ console.warn('exportRiderPdf syno:',e); }
    }

    else if(s==='stage'){
      var stageDataUrl=await _canvasPromise(function(resolve){
        _makeBpCanvas(function(cv){ resolve(cv?cv.toDataURL('image/png'):null); });
      });
      if(stageDataUrl){
        pages.push('<div class="page">'+_hdr('Plan de scène')
          +'<div class="img-wrap"><img src="'+stageDataUrl+'"/></div>'+_ftr()+'</div>');
      }
    }

    else if(s==='site'){
      /* Charger SitePlan si pas encore initialisé (stage_data.site ou scène active) */
      if(!SitePlan.hasContent()){
        var _s1=CUR_SHOW?.stage_data?.site||null;
        if(!_s1&&SHOW_SCENES.site&&SHOW_SCENES.site.length){var _sc1=SHOW_SCENES.site.find(function(s){return s.id===CUR_SCENES.site;});_s1=_sc1&&_sc1.data&&_sc1.data.site||null;}
        if(_s1) SitePlan.load(_s1);
      }
      var siteDataUrl=await _canvasPromise(function(resolve){
        SitePlan.exportCanvasSafe(function(cv){ resolve(cv?cv.toDataURL('image/png'):null); });
      });
      if(siteDataUrl){
        pages.push('<div class="page">'+_hdr('Plan de site')
          +'<div class="img-wrap"><img src="'+siteDataUrl+'"/></div>'+_ftr()+'</div>');
      }
    }
  }

  /* ── Fichiers joints (documents sélectionnés dans le rider builder) ── */
  var pickedFiles=Array.from(_riderPickedFiles);
  if(pickedFiles.length){
    /* Récupérer les signed URLs pour chaque fichier */
    var fileUrls={};
    await Promise.all(pickedFiles.map(async function(path){
      try{
        var res=await B2Storage.createSignedUrl(path,3600);
        if(!res.error&&res.data?.signedUrl) fileUrls[path]=res.data.signedUrl;
      }catch(e){}
    }));

    var filesHtml='';
    for(var fi=0;fi<pickedFiles.length;fi++){
      var fp=pickedFiles[fi];
      var fname=fp.split('/').pop()||fp;
      var fdisp=typeof _fichDisplayName==='function'?_fichDisplayName(fname):fname;
      var finfo=typeof _fichInfoOf==='function'?_fichInfoOf(fdisp):{label:'Fichier'};
      var furl=fileUrls[fp]||'#';
      var isImage=/\.(png|jpg|jpeg|gif|webp)$/i.test(fdisp);
      var isPDF=/\.pdf$/i.test(fdisp);

      if(isImage&&furl!=='#'){
        /* Image : une page avec l'image en grand */
        filesHtml+='<div class="page">'
          +_hdr('Fichier joint — '+_fEsc(fdisp))
          +'<div class="img-wrap"><img src="'+furl+'" style="max-width:100%;max-height:160mm;object-fit:contain"/></div>'
          +_ftr()+'</div>';
      } else {
        /* Autres fichiers : liste avec lien cliquable */
        if(!filesHtml.includes('class="fj-list"')){
          filesHtml+='<div class="page"><style>.fj-list{padding:14px 16px;display:flex;flex-direction:column;gap:8px}.fj-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #e8edf4;border-radius:7px;background:#f8fafc}.fj-name{font-size:11px;font-weight:600;color:#1a1a2e;flex:1}.fj-type{font-size:9px;color:#888;font-family:"DM Mono",monospace;padding:2px 6px;background:#f0f2f5;border-radius:4px}.fj-dl{font-size:9px;color:#1a8fff;text-decoration:none;font-family:"DM Mono",monospace;padding:3px 8px;border:1px solid #b3d4ff;border-radius:4px;flex-shrink:0}</style>'
            +_hdr('Fichiers joints')
            +'<div class="fj-list">';
        }
        filesHtml+='<div class="fj-item">'
          +'<div class="fj-name">'+_fEsc(fdisp)+'</div>'
          +'<span class="fj-type">'+_fEsc(finfo.label||'Fichier')+'</span>'
          +(furl!=='#'?'<a class="fj-dl" href="'+furl+'" target="_blank">Ouvrir ↗</a>':'')
          +'</div>';
      }
    }
    /* Fermer la liste si elle a été ouverte */
    if(filesHtml.includes('class="fj-list"')){
      filesHtml+=_ftr()+'</div></div>';
    }
    if(filesHtml) pages.push(filesHtml);
  }

  }catch(e){ console.error('exportRiderPdf:',e); toast('Erreur génération PDF : '+e.message); }
  finally{
    if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-file-type-pdf"></i>Exporter PDF rider';}
  }

  if(!pages.length){toast('Aucune section à exporter.');return;}

  /* Insérer le bloc QR + lien à la fin de la dernière page (avant son footer) */
  if(pages.length){
    var last=pages[pages.length-1];
    var fi=last.lastIndexOf('<div class="ft">');
    if(fi>=0){ pages[pages.length-1]=last.slice(0,fi)+_riderQrBlock()+last.slice(fi); }
    else { pages[pages.length-1]=last.replace(/<\/div>\s*$/, _riderQrBlock()+'</div>'); }
  }

  var html='<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>'+_fEsc(rTitle)+'</title>'
    +'<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>'
    +'<style>'+css+'</style></head><body>'
    +pages.join('')
    +'<script>window.onload=()=>window.print();<\/script>'
    +'</body></html>';
  var w=window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
  else{toast('Autoriser les popups pour exporter le PDF.');}
}

function _loadRiderConfig(){
  var cfg=CUR_SHOW&&CUR_SHOW.stage_data&&CUR_SHOW.stage_data.rider;
  if(!cfg)return;
  if(cfg.sections&&cfg.sections.length>1){
    Object.keys(_riderSections).forEach(function(k){_riderSections[k]=cfg.sections.indexOf(k)>=0;});
    _syncRiderBtns();
  }
  var t=document.getElementById('rider-title');
  var n=document.getElementById('rider-note');
  var inf=document.getElementById('rider-info');
  if(t)t.value=cfg.title||'';
  if(n)n.value=cfg.note||'';
  if(inf)inf.value=cfg.info||'';
  /* Ne pas pré-remplir les pièces jointes : l'utilisateur doit les
     sélectionner explicitement à chaque génération de lien. */
  _riderPickedFiles=new Set();
}

function _initRiderBuilder(){
  var isPro=canDo('share_link');
  var isProMulti=canDo('multi_scenes'); // Pro plan = multi links
  var isStudio=canDo('multi_scenes');
  var gate=document.getElementById('rider-gate-msg');
  var inner=document.getElementById('rider-builder-inner');
  if(gate)  gate.style.display=isPro?'none':'flex';
  if(inner) inner.style.display=isPro?'block':'none';
  if(!isPro)return;
  _loadRiderConfig();
  _syncRiderBtns();
  var studioGate=document.getElementById('rider-studio-gate');
  var fileList=document.getElementById('rider-file-list');
  if(isStudio){
    if(studioGate)studioGate.style.display='none';
    if(fileList){fileList.style.display='block';_loadRiderFiles();}
  }else{
    if(studioGate)studioGate.style.display='flex';
    if(fileList)fileList.style.display='none';
  }
  // Afficher le bon bloc selon le plan
  var freeBlock=document.getElementById('rider-free-link-block');
  var proBlock =document.getElementById('rider-pro-links-block');
  if(isProMulti){
    if(freeBlock) freeBlock.style.display='none';
    if(proBlock)  proBlock.style.display='block';
    _loadLinksManager();
  } else {
    if(freeBlock) freeBlock.style.display='block';
    if(proBlock)  proBlock.style.display='none';
    // Free : afficher le lien existant
    if(CUR_SHOW&&CUR_SHOW.stage_data&&CUR_SHOW.stage_data.rider){
      var url=_riderBase()+'?rider='+CUR_SHOW.id;
      var urlEl=document.getElementById('slink-url');
      if(urlEl)urlEl.textContent=url;
      var row=document.getElementById('rider-link-row');
      if(row)row.style.display='block';
    }
    // Compteur de liens (plan Gratuit)
    var quota=document.getElementById('rider-quota');
    if(quota){
      var lim=planLimit('max_share_links');
      if(lim===Infinity){ quota.style.display='none'; }
      else{
        var used=_countShareLinks();
        var remaining=Math.max(0,lim-used);
        quota.style.display='block';
        quota.innerHTML='<i class="ti ti-link" style="font-size:10px"></i> '+used+' / '+lim+' liens utilisés'
          +(remaining===0?' — <span style="color:var(--ora);cursor:pointer;text-decoration:underline" onclick="showUpgradeModal(\'max_share_links\')">Passez Pro pour des liens illimités</span>':'');
      }
    }
  }
}

/* ══ Gestionnaire de liens Pro ══════════════════════════════════ */
var _proLinks=[]; // cache des liens du show courant

async function _loadLinksManager(){
  if(!CUR_SHOW)return;
  var list=document.getElementById('links-mgr-list');
  if(list) list.innerHTML='<div style="font-size:11px;color:var(--muted);padding:8px 0">Chargement…</div>';
  var {data,error}=await sb.from('show_riders').select('*').eq('show_id',CUR_SHOW.id).order('created_at');
  _proLinks=data||[];
  _renderLinksManager();
}

function _renderLinksManager(){
  var list=document.getElementById('links-mgr-list');
  if(!list)return;
  if(!_proLinks.length){
    list.innerHTML='<div style="font-size:11px;color:var(--muted);padding:6px 0 2px">Aucun lien créé. Créez votre premier lien de partage.</div>';
    return;
  }
  var SEC_LABELS={il:'Input List',out:'Output',syno:'Synoptique',stage:'Scène',site:'Site',cloud:'Fichiers',files:'PJ'};
  var base=_riderBase();
  list.innerHTML=_proLinks.map(function(lnk){
    var code=lnk.code||lnk.id;
    var url=base+'?link='+code;
    var secs=(lnk.sections||[]).map(function(s){
      return '<span class="link-sec-badge">'+_fEsc(SEC_LABELS[s]||s)+'</span>';
    }).join('');
    return '<div class="link-card">'
      +'<div class="link-card-head">'
        +'<i class="ti ti-link" style="font-size:13px;color:var(--muted);flex-shrink:0"></i>'
        +'<span class="link-card-name">'+_fEsc(lnk.name)+'</span>'
        +'<button class="link-card-btn del" onclick="_deleteLink(\''+lnk.id+'\')" title="Supprimer"><i class="ti ti-trash" style="font-size:11px"></i></button>'
      +'</div>'
      +(secs?'<div class="link-card-secs">'+secs+'</div>':'')
      +'<div class="link-card-url">'
        +'<span class="link-card-url-text">'+_fEsc(url)+'</span>'
        +'<button class="link-card-btn wa" onclick="_waShareLink(\''+_fEsc(code)+'\')"><i class="ti ti-brand-whatsapp" style="font-size:11px"></i>WhatsApp</button>'
        +'<button class="link-card-btn" onclick="_copyProLink(\''+_fEsc(url)+'\')"><i class="ti ti-copy" style="font-size:10px"></i>Copier</button>'
      +'</div>'
    +'</div>';
  }).join('');
}

function _openNewLinkForm(){
  var f=document.getElementById('link-new-form');
  var b=document.getElementById('link-new-btn');
  if(f) f.style.display='block';
  if(b) b.style.display='none';
  setTimeout(function(){ document.getElementById('link-form-name')?.focus(); },50);
}
function _closeNewLinkForm(){
  var f=document.getElementById('link-new-form');
  var b=document.getElementById('link-new-btn');
  if(f) f.style.display='none';
  if(b) b.style.display='flex';
  var ni=document.getElementById('link-form-name'); if(ni)ni.value='';
}

async function _createLink(){
  if(!CUR_SHOW)return;
  var name=(document.getElementById('link-form-name')?.value||'').trim()||'Lien partagé';
  /* Utiliser les sections cochées en haut du builder (pas de doublon) */
  var sections=Object.keys(_riderSections).filter(function(k){return _riderSections[k];});
  if(!sections.length){toast('Sélectionnez au moins une section en haut du builder.');return;}

  var btn=document.querySelector('#link-new-form .btn:first-of-type');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>';}

  /* Récupérer les infos depuis les champs existants du builder */
  var config={
    title:(document.getElementById('rider-title')?.value||'').trim(),
    note: (document.getElementById('rider-note')?.value||'').trim(),
    info: (document.getElementById('rider-info')?.value||'').trim(),
    files: _riderPickedFiles.size>0?Array.from(_riderPickedFiles):[],
    out_snapshot: CUR_SHOW.out_data||OUT_DATA||{}
  };

  /* Pré-calculer les snapshots visuels */
  if(sections.includes('site')){
    if(!SitePlan.hasContent()){
      /* Chercher les données site dans stage_data.site (non-Studio)
         OU dans la scène active (Pro multi-scènes) */
      var _siteFromSD=CUR_SHOW?.stage_data?.site||null;
      var _siteFromScene=null;
      if(!_siteFromSD&&SHOW_SCENES.site&&SHOW_SCENES.site.length){
        var _curSS=SHOW_SCENES.site.find(function(s){return s.id===CUR_SCENES.site;});
        _siteFromScene=_curSS&&_curSS.data&&_curSS.data.site||null;
      }
      var _siteToLoad=_siteFromSD||_siteFromScene;
      if(_siteToLoad) SitePlan.load(_siteToLoad);
    }
    /* On ne stocke le snapshot (gros PNG base64, souvent plusieurs Mo) QUE s'il
       n'y a pas de données de scène site : sinon la vue rider redessine le plan
       depuis la scène, et le serveur retire de toute façon ce snapshot de la
       réponse. Évite de gonfler la base et accélère la création du lien. */
    var _hasSiteScene=!!(SHOW_SCENES.site&&SHOW_SCENES.site.some(function(s){return s.data&&Object.keys(s.data).length>0;}));
    if(!_hasSiteScene){
      try{
        config.site_snapshot=await new Promise(function(resolve){
          var t=setTimeout(function(){resolve(null);},6000);
          SitePlan.exportCanvasSafe(function(cv){clearTimeout(t);resolve(cv?cv.toDataURL('image/png'):null);});
        });
      }catch(e){}
    }
  }
  if(sections.includes('syno')){ config.syn_snapshot=CUR_SHOW.synoptique_data||null; }
  if(sections.includes('out')){ config.out_snapshot=CUR_SHOW.out_data||OUT_DATA||{}; }

  /* On stocke un code court pour obtenir une URL facile à partager. Si la
     colonne "code" n'existe pas encore (migration non appliquée), on retombe
     proprement sur l'insertion sans code (l'URL utilisera alors l'UUID). */
  function _insRider(withCode){
    var pl={show_id:CUR_SHOW.id,name:name,sections:sections,config:config};
    if(withCode) pl.code=_genLinkCode();
    return sb.from('show_riders').insert(pl).select().maybeSingle();
  }
  var data,error;
  for(var _t=0;_t<3;_t++){
    var _r=await _insRider(true);
    data=_r.data;error=_r.error;
    if(!error) break;
    if(error.code==='23505'){ continue; }                 // code déjà pris → régénère
    if(error.code==='PGRST204'||/'?code'?/.test(error.message||'')){ // colonne absente
      var _r2=await _insRider(false); data=_r2.data;error=_r2.error;
    }
    break;
  }

  if(btn){btn.disabled=false;btn.innerHTML='<i class="ti ti-check"></i>Créer';}
  if(error){toast('Erreur : '+error.message);return;}

  _proLinks.push(data);
  _renderLinksManager();
  _closeNewLinkForm();
  toast('Lien "'+name+'" créé ✓');
}

async function _deleteLink(id){
  if(!confirm('Supprimer ce lien ? Les personnes qui l\'ont reçu ne pourront plus y accéder.'))return;
  var {error}=await sb.from('show_riders').delete().eq('id',id);
  if(error){toast('Erreur : '+error.message);return;}
  _proLinks=_proLinks.filter(function(l){return l.id!==id;});
  _renderLinksManager();
  toast('Lien supprimé');
}

/* Code court pour des liens faciles à envoyer (WhatsApp). Alphabet sans
   caractères ambigus (pas de 0/O/1/l/I). */
function _genLinkCode(){
  var A='23456789abcdefghjkmnpqrstuvwxyz',s='';
  try{var arr=new Uint32Array(7);crypto.getRandomValues(arr);for(var i=0;i<7;i++)s+=A[arr[i]%A.length];}
  catch(e){for(var j=0;j<7;j++)s+=A[Math.floor(Math.random()*A.length)];}
  return s;
}

/* Ouvre WhatsApp (mobile ou web) avec un message pré-rempli + le lien. */
function _waShare(url,label){
  var sn=(CUR_SHOW&&CUR_SHOW.name)?CUR_SHOW.name:'Patch';
  var head=label?(sn+' ('+label+')'):sn;
  var msg=head+'\nFiche à jour en temps réel :\n'+url;
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank','noopener');
}
function _waShareLink(code){
  var url=_riderBase()+'?link='+code;
  var lnk=_proLinks.find(function(l){return (l.code||l.id)===code;});
  _waShare(url,lnk?lnk.name:'');
}
function _waShareFree(){
  var url=(document.getElementById('slink-url')||{}).textContent||'';
  if(url)_waShare(url,'');
}

function _copyProLink(url){
  try{navigator.clipboard.writeText(url).then(function(){toast('Lien copié !');});}
  catch(e){
    var ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Lien copié !');
  }
}

async function _loadRiderFiles(){
  if(!CUR_SHOW)return;
  var fl=document.getElementById('rider-file-list');
  if(!fl)return;
  fl.innerHTML='<div style="font-size:11px;color:var(--muted);padding:8px 0">Chargement…</div>';
  // 1. Supabase (rapide)
  var {data,error}=await _sfListShowFiles();
  // 2. Fallback B2 si show_files vide (fichiers pre-migration)
  if(!error && (!data||!data.length)){
    var prefix=CUR_SHOW.id+'/';
    var {data:b2d}=await B2Storage.listB2Raw(prefix);
    var SKIP2=new Set(['.emptyFolderPlaceholder','.keep']);
    data=(b2d||[]).filter(function(f){return !SKIP2.has(f.name)&&f.name&&f.id!==null;})
      .map(function(f){return {path:prefix+f.name,name:f.name,folder:'',size:f.metadata?.size||0,content_type:'',is_folder:false,created_at:f.created_at};});
    // Backfill silencieux
    if(data.length&&ME){
      sb.from('show_files').upsert(data.map(function(f){return Object.assign({show_id:CUR_SHOW.id,created_by:ME.id},f);}),{onConflict:'show_id,path'}).then(function(){});
    }
  }
  if(error||!data||!data.length){fl.innerHTML='<div style="font-size:11px;color:var(--muted);padding:8px 0">Aucun fichier dans le cloud pour ce show.</div>';return;}
  fl.innerHTML=data.map(function(f){
    var path=f.path; // chemin complet déjà dans show_files
    var disp=_fichDisplayName?_fichDisplayName(f.name):f.name;
    var sz=_fmtSize?_fmtSize(f.size):'';
    var info=_fichInfoOf?_fichInfoOf(f.name):{icon:'<i class="ti ti-file" style="color:var(--muted);font-size:15px"></i>'};
    var picked=_riderPickedFiles.has(path);
    var isPdf = f.name.toLowerCase().endsWith('.pdf');
    var previewBtn = isPdf
      ? '<button class="btn ghost sm" style="padding:3px 7px;font-size:10px;flex-shrink:0;margin-left:auto" onclick="event.stopPropagation();_riderPreviewPdf(\''+encodeURIComponent(path)+'\',\''+disp+'\')" title="Ouvrir le PDF"><i class="ti ti-eye"></i></button>'
      : '';
    return '<div class="rider-file-item'+(picked?' picked':'')+'" onclick="_toggleRiderFile(\''+encodeURIComponent(path)+'\')" id="rfi-'+encodeURIComponent(path)+'">'
      +info.icon+'<span class="rfi-name">'+disp+'</span><span class="rfi-size">'+sz+'</span>'
      +previewBtn
      +'<i class="ti ti-'+(picked?'check':'plus')+' rfi-chk" style="font-size:12px;color:'+(picked?'var(--ora)':'var(--muted)')+'"></i>'
      +'</div>';
  }).join('');
}

function _toggleRiderFile(encodedPath){
  var path=decodeURIComponent(encodedPath);
  if(_riderPickedFiles.has(path)){_riderPickedFiles.delete(path);}else{_riderPickedFiles.add(path);}
  var el=document.getElementById('rfi-'+encodedPath);
  if(el){
    el.className='rider-file-item'+(_riderPickedFiles.has(path)?' picked':'');
    var chk=el.querySelector('.rfi-chk');
    if(chk){chk.className='ti ti-'+(_riderPickedFiles.has(path)?'check':'plus')+' rfi-chk';chk.style.color=_riderPickedFiles.has(path)?'var(--ora)':'var(--muted)';}
  }
}

async function _riderPreviewPdf(encodedPath, displayName){
  var path = decodeURIComponent(encodedPath);
  var { data, error } = await B2Storage.createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) { toast('Erreur : ' + (error?.message || 'URL invalide')); return; }
  var url = data.signedUrl;
  var modal   = document.getElementById('fich-viewer-modal');
  var titleEl = document.getElementById('fich-viewer-title');
  var content = document.getElementById('fich-viewer-content');
  var dlLink  = document.getElementById('fich-viewer-dl');
  if (!modal) return;
  if (titleEl) titleEl.textContent = displayName;
  if (dlLink) { dlLink.href = url; dlLink.download = displayName; }
  modal.style.display = 'flex';
  _openPdfJs(url, content);
}

function selectRiderSection(key){
  var next=!_riderSections[key];
  var others=Object.keys(_riderSections).filter(function(k){return k!==key&&_riderSections[k];});
  if(!next&&others.length===0)return;
  _riderSections[key]=next;
  _syncRiderBtns();
}
function _syncRiderBtns(){
  ['il','out','syno','stage','site','cloud'].forEach(function(k){
    var btn=document.getElementById('sc-'+k);
    if(btn)btn.className='slink-check'+(_riderSections[k]?' checked':'');
  });
  /* Bouton "Fichiers cloud" visible uniquement pour les Pro */
  var cloudBtn=document.getElementById('sc-cloud');
  if(cloudBtn) cloudBtn.style.display=canDo('storage')?'':'none';
}
function _updateRiderUrl(){
  if(!CUR_SHOW)return;
  var url=_riderBase()+'?rider='+CUR_SHOW.id;
  var el=document.getElementById('slink-url');
  if(el)el.textContent=url;
}
function copyRiderLink(){
  if(!canDo('share_link')){showUpgradeModal('share_link');return;}
  var url=document.getElementById('slink-url').textContent;
  navigator.clipboard.writeText(url).catch(function(){});
  toast('✓ Lien copié !');
}
function copyLink(){copyRiderLink();}

// ══════════════════════════════════════
// COLUMN VISIBILITY
// ══════════════════════════════════════
const COLS=[
  {id:'short',label:'Nom court',icon:'ti-letter-a'},
  {id:'long',label:'Nom long',icon:'ti-text-size'},
  {id:'src',label:'Source',icon:'ti-music'},
  {id:'mic',label:'Micro/DI',icon:'ti-microphone'},
  {id:'gain',label:'Gain',icon:'ti-adjustments'},
  {id:'phantom',label:'+48V',icon:'ti-bolt'},
  {id:'iem',label:'IEM',icon:'ti-headphones'},
  {id:'hf',label:'Fréquence HF',icon:'ti-antenna'},
  {id:'foh',label:'FOH',icon:'ti-speakerphone'},
  {id:'mon',label:'MON',icon:'ti-arrow-back-up'},
  {id:'bc',label:'BC',icon:'ti-broadcast'},
  {id:'note',label:'Pied micro',icon:'ti-ruler'},
];
const COL_PRESETS={
  simple:['short','long','src','mic'],
  foh:['short','long','src','mic','gain','phantom','foh','note'],
  broadcast:['short','long','src','mic','foh','mon','bc','note'],
  full:COLS.map(c=>c.id),
};
function loadColChips(){
  document.getElementById('col-chips').innerHTML=COLS.map(c=>`
    <div class="col-chip ${visCol.has(c.id)?'on':''}" onclick="toggleCol('${c.id}')">
      <span class="pip"></span><i class="ti ${c.icon}" style="font-size:11px"></i>${c.label}
    </div>`).join('');
}
function toggleCol(id){visCol.has(id)?visCol.delete(id):visCol.add(id);_saveVisCol();applyColVis();loadColChips();updateColBtn();}
function applyColVis(){
  document.querySelectorAll('#il-head th[data-col]').forEach(th=>th.style.display=visCol.has(th.dataset.col)?'':'none');
  document.querySelectorAll('#il-body tr').forEach(tr=>tr.querySelectorAll('td[data-col]').forEach(td=>td.style.display=visCol.has(td.dataset.col)?'':'none'));
  updateColBtn();
}
function updateColBtn(){const b=document.getElementById('col-btn');if(b)b.innerHTML=`<i class="ti ti-columns"></i>Colonnes <span style="font-family:var(--m);font-size:9px;background:var(--ora);color:#000;border-radius:9px;padding:1px 5px;margin-left:2px">${visCol.size}</span>`;}
function colPreset(n){visCol=new Set(COL_PRESETS[n]||COLS.map(c=>c.id));_saveVisCol();applyColVis();loadColChips();toast(`✓ Vue "${n}" appliquée`);}
function toggleColPanel(){const p=document.getElementById('col-panel');p.style.display=p.style.display==='none'||!p.style.display?'block':'none';if(p.style.display==='block'){loadColChips();_renderCustomColList();renderChNumSizes();}}

/* ── Taille du numéro de canal (préférence d'affichage, persistante) ── */
const CHNUM_SIZES=[{k:'s',label:'S',px:14},{k:'m',label:'M',px:18},{k:'l',label:'L',px:23},{k:'xl',label:'XL',px:29}];
function getChNumSize(){const v=parseInt(localStorage.getItem('pf_chnum_size'),10);return isNaN(v)?18:v;}
function applyChNumSize(px){document.documentElement.style.setProperty('--chnum-size',px+'px');}
function setChNumSize(px){try{localStorage.setItem('pf_chnum_size',px);}catch(e){}applyChNumSize(px);renderChNumSizes();}
function renderChNumSizes(){
  const grp=document.getElementById('chnum-size-grp');if(!grp)return;
  const cur=getChNumSize();
  grp.innerHTML=CHNUM_SIZES.map(s=>'<button class="btn sm'+(s.px===cur?'':' ghost')+'" style="padding:3px 11px;min-width:34px" onclick="setChNumSize('+s.px+')">'+s.label+'</button>').join('');
}
/* Appliquer la préférence dès le chargement (avant même d'ouvrir le panneau). */
applyChNumSize(getChNumSize());

// ══════════════════════════════════════
// CUSTOM COLUMNS (Pro)
// ══════════════════════════════════════
/* Récupère les colonnes custom du show courant (stockées dans stage_data.il_custom_cols) */
function _getCustomCols(){
  return (CUR_SHOW&&CUR_SHOW.stage_data&&CUR_SHOW.stage_data.il_custom_cols)||[];
}
async function _saveCustomCols(cols){
  if(!CUR_SHOW)return;
  const sd=Object.assign({},CUR_SHOW.stage_data||{v:2},{il_custom_cols:cols});
  CUR_SHOW.stage_data=sd;
  await sb.from('shows').update({stage_data:sd}).eq('id',CUR_SHOW.id);
}

/* Sauvegarde la valeur d'une colonne custom dans channels.custom_data */
var _customSaveTimers={};
function saveCustomCell(channelId,colId,val){
  const r=CHS.find(x=>x.id===channelId);
  if(r){ if(!r.custom_data)r.custom_data={}; r.custom_data[colId]=val; }
  clearTimeout(_customSaveTimers[channelId]);
  setSaving(true);
  _customSaveTimers[channelId]=setTimeout(async()=>{
    const ch=CHS.find(x=>x.id===channelId);
    const data=ch?ch.custom_data:{};
    await sb.from('channels').update({custom_data:data,updated_by:ME.id}).eq('id',channelId);
    setSaving(false);
  },700);
}

/* Ouvre le mini-formulaire de création de colonne */
function _openAddCustomCol(){
  if(!canDo('multi_scenes')){showUpgradeModal('custom_cols');return;}
  const f=document.getElementById('custom-col-form');
  if(f)f.style.display=f.style.display==='none'?'block':'none';
}

function _submitAddCustomCol(){
  const lbl=(document.getElementById('cc-label-inp').value||'').trim();
  if(!lbl){toast('Donnez un nom à la colonne');return;}
  const type=document.getElementById('cc-type-sel').value||'text';
  const id='cc_'+Date.now().toString(36);
  const cols=_getCustomCols();
  cols.push({id,label:lbl,type});
  _saveCustomCols(cols).then(()=>{
    document.getElementById('cc-label-inp').value='';
    document.getElementById('custom-col-form').style.display='none';
    _renderCustomColList();
    /* Ajouter la colonne à la table visible */
    _addCustomColToTable({id,label:lbl,type});
    visCol.add(id);
    _saveVisCol();
    updateColBtn();
    toast(`Colonne "${lbl}" créée`);
  });
}

async function _deleteCustomCol(colId){
  if(!confirm('Supprimer cette colonne ? Les données de tous les canaux seront perdues.'))return;
  const cols=_getCustomCols().filter(c=>c.id!==colId);
  await _saveCustomCols(cols);
  /* Supprimer la colonne de la table */
  document.querySelectorAll(`th[data-col="${colId}"],td[data-col="${colId}"]`).forEach(e=>e.remove());
  visCol.delete(colId);
  _saveVisCol();
  updateColBtn();
  _renderCustomColList();
  toast('Colonne supprimée');
}

function _renderCustomColList(){
  const wrap=document.getElementById('custom-col-list');
  if(!wrap)return;
  const cols=_getCustomCols();
  const isPro=canDo('multi_scenes');
  if(!cols.length){
    wrap.innerHTML='<div style="font-size:10px;color:var(--muted);font-style:italic">Aucune colonne personnalisée.</div>';
    return;
  }
  wrap.innerHTML=cols.map(c=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bdr)">
      <span class="col-chip on" style="cursor:default;flex:1;margin:0">${c.label}
        <span style="font-size:9px;font-family:var(--m);color:var(--muted);margin-left:4px">${c.type==='number'?'#':c.type==='bool'?'☑':'A'}</span>
      </span>
      ${isPro?`<button class="btn ghost sm" style="padding:2px 7px;font-size:10px" onclick="_deleteCustomCol('${c.id}')"><i class="ti ti-trash"></i></button>`:''}
    </div>`).join('');
}

/* Injecte une colonne custom dans le thead et toutes les lignes tbody existantes */
function _addCustomColToTable(col){
  const thead=document.getElementById('il-head');
  if(!thead)return;
  /* Insérer avant la dernière th (boutons d'actions) */
  const lastTh=thead.querySelector('th:last-child');
  const th=document.createElement('th');
  th.setAttribute('data-col',col.id);
  th.textContent=col.label;
  thead.insertBefore(th,lastTh);
  /* Insérer une td dans chaque ligne existante */
  document.querySelectorAll('#il-body tr[data-id]').forEach(tr=>{
    const chId=tr.dataset.id;
    const ch=CHS.find(x=>x.id===chId);
    const val=(ch&&ch.custom_data&&ch.custom_data[col.id])||'';
    const td=document.createElement('td');
    td.setAttribute('data-col',col.id);
    td.innerHTML=_customCellHTML(col,chId,val);
    const lastTd=tr.querySelector('td:last-child');
    tr.insertBefore(td,lastTd);
  });
}

function _customCellHTML(col,chId,val){
  const eId=_fEsc(chId); const eVal=_fEsc(String(val));
  if(col.type==='bool'){
    return `<input type="checkbox" class="cb" ${val?'checked':''} onchange="saveCustomCell('${eId}','${col.id}',this.checked)"/>`;
  }
  if(col.type==='number'){
    return `<input class="ilinp m" type="number" style="width:54px" value="${eVal}" onchange="saveCustomCell('${eId}','${col.id}',parseFloat(this.value)||0)"/>`;
  }
  return `<input class="ilinp" value="${eVal}" onchange="saveCustomCell('${eId}','${col.id}',this.value)"/>`;
}

/* Charge les colonnes custom au démarrage (après loadIL) */
function _loadCustomColsIntoTable(){
  const cols=_getCustomCols();
  const hasSaved=!!localStorage.getItem(_VISCOL_KEY);
  cols.forEach(c=>{
    if(!document.querySelector(`th[data-col="${c.id}"]`)){
      _addCustomColToTable(c);
    }
    /* N'ajoute à visCol que si aucune préférence sauvegardée (1re utilisation)
       ou si la col était déjà visible — évite d'écraser le choix de l'utilisateur */
    if(!hasSaved) visCol.add(c.id);
  });
  if(cols.length)updateColBtn();
}

// ══════════════════════════════════════
// SHOW FILES GENERATORS — exports console (Pro)
// Couleurs/icônes intelligentes basées sur le contenu du canal
// ══════════════════════════════════════

/* Détecte le groupe d'instrument à partir du nom/source/micro */
function _instrGroup(r){
  const n=((r.short_name||'')+' '+(r.long_name||'')+' '+(r.source||'')+' '+(r.mic||'')).toLowerCase();
  if(/kick|\bbd\b|grosse|kik|gc\b/.test(n)) return 'kick';
  if(/snare|\bsn\b|caisse.?cl|cdc/.test(n)) return 'snare';
  if(/\btom|floor|rototom/.test(n)) return 'tom';
  if(/hi.?hat|\bhh\b|\bhat\b|charley|charlie/.test(n)) return 'hat';
  if(/overhead|\boh\b|cymbal|ride|crash|cymbale/.test(n)) return 'oh';
  if(/\bdrum|batterie|\bperc|djembe|conga|cajon/.test(n)) return 'drums';
  if(/\bbass|basse|\bdib\b/.test(n)) return 'bass';
  if(/\bgtr|guit|guitar|gratte/.test(n)) return 'guitar';
  if(/key|piano|synth|clavier|nord|rhodes|organ|orgue|wurli/.test(n)) return 'keys';
  if(/lead.?vox|lead.?voc|\blv\b|chant.?lead|lead.?sing/.test(n)) return 'leadvox';
  if(/vox|vocal|voix|chant|choeur|chœur|chorus|\bbgv\b|backing|lead/.test(n)) return 'vox';
  if(/sax|trumpet|trompet|trombone|\bhorn|brass|cuivre|\bfl\b|flute|flûte/.test(n)) return 'horns';
  if(/click|track|playback|\bpb\b|\bseq|sample|backtrack/.test(n)) return 'track';
  if(/\bfx\b|reverb|delay|verb|effet/.test(n)) return 'fx';
  if(/talk|\btb\b|com|intercom/.test(n)) return 'talk';
  return 'other';
}

/* Maps de couleurs par console (par groupe d'instrument) */
const _COL_YAMAHA={kick:'YELLOW',snare:'YELLOW',tom:'YELLOW',hat:'YELLOW',oh:'YELLOW',drums:'YELLOW',bass:'GREEN',guitar:'PURPLE',keys:'CYAN',leadvox:'RED',vox:'RED',horns:'BLUE',track:'WHITE',fx:'WHITE',talk:'WHITE',other:'WHITE'};
/* dLive Director CSV — tokens couleur valides UNIQUEMENT : Off, Blue, Cyan, Red, Yellow, Green, Magenta, White
   (Cyan = bleu clair, Magenta = violet). 'Purple' n'existe pas → rejet à l'import. */
const _COL_AH={kick:'Yellow',snare:'Yellow',tom:'Yellow',hat:'Yellow',oh:'Yellow',drums:'Yellow',bass:'Green',guitar:'Magenta',keys:'Cyan',leadvox:'Red',vox:'Red',horns:'Blue',track:'White',fx:'White',talk:'White',other:'White'};
const _COL_WING={kick:'yellow',snare:'yellow',tom:'yellow',hat:'yellow',oh:'yellow',drums:'yellow',bass:'green',guitar:'purple',keys:'cyan',leadvox:'red',vox:'red',horns:'blue',track:'white',fx:'white',talk:'white',other:'white'};
/* X32/M32 — codes couleur : OFF RD GN YE BL MG CY WH */
const _COL_X32={kick:'YE',snare:'YE',tom:'YE',hat:'YE',oh:'YE',drums:'YE',bass:'GN',guitar:'MG',keys:'CY',leadvox:'RD',vox:'RD',horns:'BL',track:'WH',fx:'WH',talk:'WH',other:'WH'};
/* X32/M32 — index d'icône (1-74) approximatif par groupe */
const _ICON_X32={kick:8,snare:9,tom:10,hat:11,oh:12,drums:7,bass:14,guitar:17,keys:22,leadvox:33,vox:34,horns:29,track:50,fx:60,talk:36,other:1};

function _shortUp(r,len){return (r.short_name||r.long_name||'CH'+r.ch).trim().slice(0,len||8);}
function _longName(r){return (r.long_name||r.short_name||'CH'+r.ch).trim();}
/* Nom compatible dLive Director : sans accents/caractères spéciaux, max 8 caractères.
   dLive rejette äöüéß et tronque au-delà de 8 → on le fait proprement nous-mêmes. */
function _dliveName(r){
  var n=(r.short_name||r.long_name||('CH'+r.ch)).trim();
  n=n.normalize('NFD').replace(/[\u0300-\u036f]/g,'');   // décompose et retire les accents
  n=n.replace(/[^\x20-\x7E]/g,'').replace(/[",]/g,' ');  // ASCII imprimable, pas de "/,
  return n.trim().slice(0,8);
}

/* ── Yamaha CL / QL / CL Editor — CH_NAME.csv ── */
function genY(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Target,"INPUT CH"\r\nDataName,"Short Name","Long Name","Color","Icon","Input Patch"\r\n"","Short Name","Long Name","Color","Icon","Input Patch"\r\n';
  CHS.forEach((r,i)=>{
    const col=_COL_YAMAHA[_instrGroup(r)]||'WHITE';
    o+=`"Input Ch ${i+1}",${q(_shortUp(r,8).toUpperCase())},${q(_longName(r))},${q(col)},"",${q('Dante'+(i+1))}\r\n`;
  });
  return o;
}

/* ── Yamaha DM7 / DM7 Compact — Channel List CSV ──
   Le DM7 Editor (File → Channel List) importe un CSV de nommage des voies.
   Colonnes : Channel, Name, Color, Icon, +48V (convention Channel List Yamaha).
   Couleurs Yamaha en majuscules ; nom de voie limité à 8 caractères (afficheur). */
function genDM7(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Channel,Name,Color,Icon,+48V\r\n';
  CHS.forEach((r,i)=>{
    const col=_COL_YAMAHA[_instrGroup(r)]||'WHITE';
    const name=(r.long_name||r.short_name||('CH'+r.ch)).trim().slice(0,16);
    o+=`${i+1},${q(name)},${q(col)},,${r.phantom?'ON':'OFF'}\r\n`;
  });
  return o;
}

/* ── Yamaha Rivage PM — CSV nommage ── */
function genRiv(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Ch,Name,Color,Icon,HA Gain,+48V\r\n';
  CHS.forEach((r,i)=>{
    const col=_COL_YAMAHA[_instrGroup(r)]||'WHITE';
    o+=`${i+1},${q(_longName(r))},${q(col)},,${r.gain||0},${r.phantom?'ON':'OFF'}\r\n`;
  });
  return o;
}

/* ── Behringer X32 / Midas M32 — fichier scène .scn natif ── */
function genX32(){
  const name=(CUR_SHOW?.name||'PatchFlow').slice(0,12);
  const esc=s=>String(s||'').replace(/"/g,'');
  let o=`#4.0# "${esc(name)}" "PatchFlow" %000000000 1 1\n`;
  /* Config des voies : nom, couleur, icône, source */
  CHS.forEach((r,i)=>{
    if(i>=32) return; // X32 = 32 voies d'entrée
    const g=_instrGroup(r);
    const nm=esc(_shortUp(r,12));
    const col=_COL_X32[g]||'WH';
    const icon=_ICON_X32[g]||1;
    const src=i+1; // patch local 1:1
    const num=String(i+1).padStart(2,'0');
    o+=`/ch/${num}/config "${nm}" ${col} ${icon} ${src}\n`;
  });
  /* Head amps : gain + alimentation fantôme */
  CHS.forEach((r,i)=>{
    if(i>=32) return;
    const num=String(i).padStart(3,'0'); // headamp 000-031
    const gain=(typeof r.gain==='number'?r.gain:18).toFixed(1);
    const g=gain.startsWith('-')?gain:'+'+gain;
    o+=`/headamp/${num} ${g} ${r.phantom?'ON':'OFF'}\n`;
  });
  return o;
}

/* ── Behringer Wing — snapshot JSON ── */
function genW(){
  const snap={ch:{},bus:{},main:{}};
  CHS.forEach((r,i)=>{
    const col=_COL_WING[_instrGroup(r)]||'white';
    snap.ch[String(i+1)]={cfg:{name:_shortUp(r,12),color:col,on:1},ha:{gain:r.gain||0,phantom:r.phantom?1:0,pad:0},fdr:{val:-10,on:1}};
  });
  for(let b=1;b<=16;b++)snap.bus[String(b)]={cfg:{name:'Bus '+b,color:'white',on:1},fdr:{val:-10,on:0}};
  snap.main={lr:{cfg:{name:'LR',color:'white',on:1},fdr:{val:0,on:1}}};
  return JSON.stringify(snap);
}

/* ── DiGiCo SD / Quantum — CSV liste de voies ── */
function genDigi(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Channel,Name,Colour,Gain,48V\r\n';
  const DC={kick:'Yellow',snare:'Yellow',tom:'Yellow',hat:'Yellow',oh:'Yellow',drums:'Yellow',bass:'Green',guitar:'Purple',keys:'Cyan',leadvox:'Red',vox:'Red',horns:'Blue',track:'White',fx:'White',talk:'White',other:'White'};
  CHS.forEach((r,i)=>{
    const col=DC[_instrGroup(r)]||'White';
    o+=`${i+1},${q(_longName(r))},${col},${r.gain||0},${r.phantom?'On':'Off'}\r\n`;
  });
  return o;
}

/* ── Avid VENUE S6L / Profile — CSV noms de voies ── */
function genAvid(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Channel Number,Channel Name,Phantom,Gain (dB)\r\n';
  CHS.forEach((r,i)=>{
    o+=`${i+1},${q(_longName(r))},${r.phantom?'On':'Off'},${r.gain||0}\r\n`;
  });
  return o;
}

/* ── Soundcraft Vi / Si — CSV noms de voies ── */
function genSC(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Input,Label,Color,Gain,48V\r\n';
  const SCC={kick:'Yellow',snare:'Yellow',tom:'Yellow',hat:'Yellow',oh:'Yellow',drums:'Yellow',bass:'Green',guitar:'Magenta',keys:'Cyan',leadvox:'Red',vox:'Red',horns:'Blue',track:'White',fx:'White',talk:'White',other:'White'};
  CHS.forEach((r,i)=>{
    const col=SCC[_instrGroup(r)]||'White';
    o+=`${i+1},${q(_shortUp(r,10))},${col},${r.gain||0},${r.phantom?'On':'Off'}\r\n`;
  });
  return o;
}

/* ── Allen & Heath dLive — CSV Director (format officiel) ──
   Structure réelle attendue par dLive Director :
   - Section [Version] (V1.0) puis section [Channels], 28 colonnes par ligne.
   - Chaque canal : Input, <ch>, <nom≤8>, <couleur>, <source>, <socket>, '',
     <gain>, <pad>, <phantom>, puis 3 blocs "Unassigned"+5 cellules vides.
   - Couleurs valides : Off, Blue, Cyan, Red, Yellow, Green, Magenta, White.
   - Noms : ASCII uniquement, tronqués à 8 caractères.
   Ref : github.com/togrupe/dlive-midi-tools (src/directorcsv/CsvCreator.py) */
function genD(){
  const COLS=28;
  const cell=v=>{ v=String(v==null?'':v); return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
  const pad=arr=>{ while(arr.length<COLS) arr.push(''); return arr.slice(0,COLS); };
  const rows=[];
  rows.push(pad(['[Version]','V1.0']));
  rows.push(pad(['[Channels]']));
  CHS.forEach((r,i)=>{
    const ch=i+1;
    const col=_COL_AH[_instrGroup(r)]||'White';
    rows.push(pad([
      'Input', ch, _dliveName(r), col, 'Local', ch, '',
      (r.gain||0), 'Off', (r.phantom?'On':'Off'),
      'Unassigned','','','','','',
      'Unassigned','','','','','',
      'Unassigned'
    ]));
  });
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

/* ── Allen & Heath SQ — CSV générique (nom + couleur + patch) ──
   Le SQ-MixPad accepte un CSV simple ; on conserve le format historique. */
function genS(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Name,Colour,Source,Channel,Gain,Pad,Phantom\r\n';
  CHS.forEach((r,i)=>{
    const col=_COL_AH[_instrGroup(r)]||'White';
    o+=`${q(_dliveName(r))},${col},Local,${i+1},${r.gain||0},Off,${r.phantom?'On':'Off'}\r\n`;
  });
  return o;
}

/* ── Allen & Heath SQ — Patch List texte ── */
function genSP(){
  const n=CUR_SHOW?.name||'Show';const now=new Date().toLocaleString('fr-FR');
  let o=`PATCHFLOW — SQ Patch List\nShow: ${n}\nDate: ${now}\n${'═'.repeat(70)}\n`;
  o+=`${'CH'.padEnd(5)}${'COURT'.padEnd(7)}${'NOM'.padEnd(20)}${'MICRO'.padEnd(14)}${'GAIN'.padEnd(6)}${'48V'.padEnd(5)}IEM\n${'─'.repeat(70)}\n`;
  CHS.forEach(r=>{o+=`${String(r.ch).padEnd(5)}${(r.short_name||'').trim().padEnd(7)}${(r.long_name||'').slice(0,19).padEnd(20)}${(r.mic||'').slice(0,13).padEnd(14)}${String(r.gain||0).padEnd(6)}${(r.phantom?'+48V':'---').padEnd(5)}${r.iem_group||'—'}\n`;});
  o+=`\n${'═'.repeat(70)}\n${CHS.length} canaux | PatchFlow\n`;return o;
}

/* ── CSV universel (toute console acceptant un import générique) ── */
function genUniv(){
  const q=s=>'"'+String(s||'').replace(/"/g,'""')+'"';
  let o='Channel,Short,Long,Source,Mic,Gain,Phantom,FOH,MON\r\n';
  CHS.forEach((r,i)=>{
    o+=`${i+1},${q((r.short_name||'').trim())},${q(r.long_name||'')},${q(r.source||'')},${q(r.mic||'')},${r.gain||0},${r.phantom?'Yes':'No'},${r.foh?'Yes':'No'},${r.mon?'Yes':'No'}\r\n`;
  });
  return o;
}

const FMETA={
  y:   {title:'Yamaha CL/QL — CH_NAME.csv',          fn:'CH_NAME.csv',         type:'text/csv',          gen:genY},
  dm7: {title:'Yamaha DM7 — Channel List CSV',       fn:'DM7_channels.csv',    type:'text/csv',          gen:genDM7},
  riv: {title:'Yamaha Rivage PM — channels.csv',     fn:'Rivage_channels.csv', type:'text/csv',          gen:genRiv},
  x32: {title:'Behringer X32 / Midas M32 — scène .scn', fn:'patchflow.scn',     type:'text/plain',        gen:genX32},
  w:   {title:'Behringer Wing — snapshot.snap',      fn:'snapshot.snap',       type:'application/json',  gen:genW},
  digi:{title:'DiGiCo SD/Quantum — channels.csv',    fn:'DiGiCo_channels.csv', type:'text/csv',          gen:genDigi},
  avid:{title:'Avid VENUE S6L — channels.csv',       fn:'VENUE_channels.csv',  type:'text/csv',          gen:genAvid},
  sc:  {title:'Soundcraft Vi/Si — labels.csv',       fn:'Soundcraft_labels.csv',type:'text/csv',         gen:genSC},
  d:   {title:'A&H dLive — Director CSV',             fn:'patchflow-director.csv', type:'text/csv',       gen:genD},
  s:   {title:'A&H SQ — SQ_channels.csv',            fn:'SQ_channels.csv',     type:'text/csv',          gen:genS},
  sp:  {title:'A&H SQ — patch_list.txt',             fn:'patch_list.txt',      type:'text/plain',        gen:genSP},
  univ:{title:'CSV universel — channels.csv',        fn:'channels.csv',        type:'text/csv',          gen:genUniv},
};
function dl(content,type,fn){const b=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click();URL.revokeObjectURL(a.href);}
function dlFile(t){
  const m=FMETA[t];if(!m)return;
  /* Export console = fonctionnalité Pro */
  if(!canDo('console_export')){ showUpgradeModal('console_export'); return; }
  if(!CHS.length){ toast('Aucun canal à exporter — ajoutez des canaux dans l\'Input List.'); return; }
  const slug=CUR_SHOW?.slug||'show';
  dl(m.gen(),m.type,slug+'_'+m.fn);
  toast('✓ '+m.fn+' téléchargé');
}
// ── CSV IMPORT ──────────────────────────────────────────────────
var _csvRawRows=[], _csvHeaders=[], _csvColMap={}, _csvMode='append';
var _CSV_FIELDS=[
  {id:'short_name',label:'Court',    candidates:['court','short','short_name','ch_name','nom court']},
  {id:'long_name', label:'Nom long', candidates:['nom long','long','long_name','nom','name','label','description','libelle']},
  {id:'source',    label:'Source',   candidates:['source','src','instrument','type']},
  {id:'mic',       label:'Micro/DI', candidates:['micro','mic','di','micro/di','microphone','input']},
  {id:'gain',      label:'Gain',     candidates:['gain','trim','level','niveau']},
  {id:'phantom',   label:'Phantom',  candidates:['phantom','+48v','48v','alimentation phantom']},
  {id:'note',      label:'Note',     candidates:['note','notes','commentaire','comment','remarque','pied','pieds','stand','micro stand','mic stand']},
];
function importCSVClick(){
  document.getElementById('csv-import-input').value='';
  document.getElementById('csv-import-input').click();
}
function importCSVLoad(inp){
  var f=inp.files[0]; if(!f) return;
  var reader=new FileReader();
  reader.onload=function(e){
    var text=e.target.result;
    _csvRawRows=_parseCSV(text);
    if(_csvRawRows.length<2){alert('Fichier vide ou invalide.');return;}
    _csvHeaders=_csvRawRows[0];
    _detectCSVCols();
    _csvMode='append';
    document.getElementById('csv-import-fname').textContent=f.name;
    document.getElementById('csv-import-modal').className='modal-ov show';
    _renderCSVModal();
  };
  reader.readAsText(f,'UTF-8');
}
function _parseCSV(text){
  var rows=[], lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  for(var i=0;i<lines.length;i++){
    var line=lines[i]; if(!line.trim()) continue;
    var row=[], cur='', inq=false;
    for(var j=0;j<line.length;j++){
      var c=line[j];
      if(c==='"'){if(inq&&line[j+1]==='"'){cur+='"';j++;}else{inq=!inq;}}
      else if(c===','&&!inq){row.push(cur.trim());cur='';}
      else{cur+=c;}
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}
function _detectCSVCols(){
  _csvColMap={};
  _CSV_FIELDS.forEach(function(f){
    _csvColMap[f.id]=-1;
    for(var i=0;i<_csvHeaders.length;i++){
      var h=(_csvHeaders[i]||'').toLowerCase().trim();
      for(var k=0;k<f.candidates.length;k++){
        if(h.indexOf(f.candidates[k])!==-1){_csvColMap[f.id]=i;break;}
      }
      if(_csvColMap[f.id]!==-1) break;
    }
  });
}
function _csvGetVal(row,fieldId){
  var idx=_csvColMap[fieldId];
  if(idx===-1||idx===undefined||idx===null) return '';
  return (row[idx]||'').trim();
}
function csvMapChange(fieldId,sel){
  _csvColMap[fieldId]=parseInt(sel.value,10);
  _renderCSVPreview();
}
function setCsvMode(mode){
  _csvMode=mode;
  document.querySelectorAll('.csv-mode-btn').forEach(function(b){b.classList.remove('active');});
  var btn=document.getElementById('csv-mode-'+mode);
  if(btn) btn.classList.add('active');
}
function _renderCSVModal(){
  var mapHtml='';
  _CSV_FIELDS.forEach(function(f){
    mapHtml+='<div class="csv-map-field">';
    mapHtml+='<span class="csv-map-lbl">'+f.label+'</span>';
    mapHtml+='<select class="csv-map-sel" onchange="csvMapChange(\''+f.id+'\',this)">';
    mapHtml+='<option value="-1">-- Ignorer --</option>';
    _csvHeaders.forEach(function(h,i){
      var sel=_csvColMap[f.id]===i?' selected':'';
      mapHtml+='<option value="'+i+'"'+sel+'>'+h+'</option>';
    });
    mapHtml+='</select></div>';
  });
  document.getElementById('csv-map-grid').innerHTML=mapHtml;
  var dataRows=_csvRawRows.slice(1).filter(function(r){return r.some(function(c){return c.trim();});});
  document.getElementById('csv-row-count').textContent=dataRows.length+' ligne'+(dataRows.length!==1?'s':'');
  _renderCSVPreview();
}
function _renderCSVPreview(){
  var dataRows=_csvRawRows.slice(1).filter(function(r){return r.some(function(c){return c.trim();});});
  var preview=dataRows.slice(0,6);
  var startCh=(_csvMode==='replace')?1:(CHS.length?CHS[CHS.length-1].ch+1:1);
  var h='<table class="csv-preview-tbl"><thead><tr><th>CH</th>';
  _CSV_FIELDS.forEach(function(f){h+='<th>'+f.label+'</th>';});
  h+='</tr></thead><tbody>';
  if(preview.length===0){h+='<tr><td colspan="'+(1+_CSV_FIELDS.length)+'" style="text-align:center;padding:18px;color:var(--muted)">Aucune donnee</td></tr>';}
  preview.forEach(function(row,i){
    h+='<tr><td class="csv-td-ch">'+(startCh+i)+'</td>';
    _CSV_FIELDS.forEach(function(f){
      var v=_csvGetVal(row,f.id);
      if(f.id==='phantom'&&v){
        var pl=v.toLowerCase();
        v=(pl==='on'||pl==='1'||pl==='true'||pl==='oui')?'+48V':'Off';
      }
      h+='<td>'+(v?v:'<span style="color:var(--muted2)">—</span>')+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  document.getElementById('csv-preview-wrap').innerHTML=h;
}
function closeCSVImport(){document.getElementById('csv-import-modal').className='modal-ov';}
async function doCSVImport(){
  if(!CUR_SHOW){alert('Aucun show selectionne.');return;}
  var dataRows=_csvRawRows.slice(1).filter(function(r){return r.some(function(c){return c.trim();});});
  if(!dataRows.length){alert('Aucune donnee a importer.');return;}

  /* ── Enforce plan channel limit ── */
  var _csvLimit=planLimit('max_channels');
  if(_csvLimit!==Infinity){
    var _csvBase=_csvMode==='replace'?0:CHS.length;
    var _csvProjected=_csvBase+dataRows.length;
    if(_csvProjected>_csvLimit){
      var _csvAvail=_csvLimit-_csvBase;
      if(_csvAvail<=0){showUpgradeModal('max_channels');return;}
      dataRows=dataRows.slice(0,_csvAvail);
      toast('⚠️ Plan Gratuit : limite de '+_csvLimit+' canaux — '+_csvAvail+' ligne'+(+_csvAvail>1?'s':'')+' importée'+(+_csvAvail>1?'s':'')+' sur '+_csvProjected+' dans le fichier.');
    }
  }

  var btn=document.getElementById('csv-do-import-btn');
  btn.disabled=true;
  btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> Import...';
  try{
    if(_csvMode==='replace'){
      var {error:de}=await sb.from('channels').delete().eq('show_id',CUR_SHOW.id);
      if(de) throw de;
    }
    var startCh=(_csvMode==='replace')?1:(CHS.length?CHS[CHS.length-1].ch+1:1);
    var inserted=[];
    for(var i=0;i<dataRows.length;i++){
      var row=dataRows[i];
      var sn=(_csvGetVal(row,'short_name')||'').toUpperCase().slice(0,4);
      var ln=_csvGetVal(row,'long_name')||sn;
      var phRaw=(_csvGetVal(row,'phantom')||'').toLowerCase();
      var ph=phRaw==='on'||phRaw==='1'||phRaw==='true'||phRaw==='oui';
      var gainRaw=parseInt(_csvGetVal(row,'gain'),10);
      if(isNaN(gainRaw)) gainRaw=0;
      var rec={
        show_id:CUR_SHOW.id,
        ch:startCh+i,
        short_name:sn,
        long_name:ln,
        source:_csvGetVal(row,'source')||'',
        mic:_csvGetVal(row,'mic')||'',
        gain:gainRaw,
        phantom:ph,
        iem_group:'',
        foh:true,
        mon:false,
        bc:false,
        note:(_NOTE_ABBR[(_csvGetVal(row,'note')||'').trim().toLowerCase()]||_csvGetVal(row,'note')||'')
      };
      if(_patchColReady) rec.patch_id=CUR_PATCH_ID;
      var {data,error}=await sb.from('channels').insert(rec).select().single();
      if(error) throw error;
      inserted.push(data);
    }
    var {data:freshChs}=await sb.from('channels').select('*').eq('show_id',CUR_SHOW.id).order('ch');
    if(freshChs) CHS=freshChs;
    renderTable();
    closeCSVImport();
    toast(dataRows.length+' canal'+(dataRows.length!==1?'ux':'')+' importe'+(dataRows.length!==1?'s':'')+' !');
  }catch(err){
    console.error(err);
    alert('Erreur import : '+(err.message||err));
  }finally{
    btn.disabled=false;
    btn.innerHTML='<i class="ti ti-file-import"></i>Importer';
  }
}
// ────────────────────────────────────────────────────────────────
function exportCSV(){let c='CH,Court,Nom Long,Source,Micro/DI,Gain,Phantom,IEM,FOH,MON,BC,Note\n';CHS.forEach(r=>{c+=`${r.ch},"${(r.short_name||'').trim()}","${r.long_name||''}","${r.source||''}","${r.mic||''}",${r.gain||0},${r.phantom?'On':'Off'},"${r.iem_group||''}",${r.foh?1:0},${r.mon?1:0},${r.bc?1:0},"${r.note||''}"\n`;});dl(c,'text/csv',(CUR_SHOW?.slug||'show')+'_inputlist.csv');}
const _SF_KEYS=['y','dm7','riv','x32','w','digi','avid','sc','d','s'];
function prevFile(t){
  const m=FMETA[t];if(!m)return;
  if(!canDo('console_export')){ showUpgradeModal('console_export'); return; }
  prevType=t;let c=m.gen();
  if(t==='w'){try{c=JSON.stringify(JSON.parse(c),null,2);}catch(e){}}
  const lines=c.split('\n');
  document.getElementById('prev-title').textContent=m.title;
  document.getElementById('prev-code').textContent=lines.length>70?lines.slice(0,70).join('\n')+'\n\n[… '+(lines.length-70)+' lignes]':c;
  document.getElementById('prev-modal').className='modal-ov show';
}
function closePrevModal(){document.getElementById('prev-modal').className='modal-ov';}
function dlFromPrev(){dlFile(prevType);}
function renderPills(){
  const _e=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  _SF_KEYS.forEach(id=>{
    const el=document.getElementById('pills-'+id);
    if(!el)return;
    el.innerHTML=CHS.slice(0,10).map(r=>`<span class="ch-pill">${_e(r.ch)}·${_e((r.short_name||r.long_name||'CH'+r.ch).trim())}</span>`).join('');
  });
}
function updateStats(){const n=CHS.length,ph=CHS.filter(r=>r.phantom).length;_SF_KEYS.forEach(id=>{const el=document.getElementById('st-'+id);if(el)el.textContent=`${n} canaux`+(ph?` · ${ph} ×+48V`:'');});}

// ══════════════════════════════════════
// PDF EXPORT
// ══════════════════════════════════════
/* _pdfVisibleTypes : which buttons are shown in the current context */
let _pdfVisibleTypes = ['in','out','both','stage','site','syno'];

function setPdfExportType(type){
  _pdfExportType=type;
  ['in','out','both','stage','site','syno'].forEach(function(t){
    const btn=document.getElementById('pdf-exp-'+t);
    if(!btn) return;
    btn.classList.toggle('on', t===type);
    btn.style.display = _pdfVisibleTypes.includes(t) ? '' : 'none';
  });
  const titles={in:'Export PDF — Input List',out:'Export PDF — Output List',both:'Export PDF — Input + Output',stage:'Export PDF — Plan de scène',site:'Export PDF — Plan de site',syno:'Export PDF — Synoptique'};
  const titleEl=document.getElementById('pdf-modal-title');
  if(titleEl) titleEl.textContent = titles[type]||'Exporter en PDF';
  const isVisual = type==='stage'||type==='site'||type==='syno';
  const isTable  = !isVisual;
  // Show subtitle + orientation only for visual plans
  const subRow = document.getElementById('pdf-sub-row');
  if(subRow) subRow.style.display = isVisual ? '' : 'none';
  const orientRow = document.getElementById('pdf-orient-row');
  if(orientRow) orientRow.style.display = isVisual ? '' : 'none';
  // Hide link/recap checkboxes for visual plans
  const foot1 = document.querySelector('#pdf-modal .modal-foot > div:first-child');
  if(foot1) foot1.style.display = isTable ? '' : 'none';
  // Hide toggle row entirely if only one option visible
  const toggleRow = document.querySelector('#pdf-modal .modal-body > div:first-child');
  if(toggleRow) toggleRow.style.display = _pdfVisibleTypes.length <= 1 ? 'none' : '';
}
function setPdfOrient(o){
  _pdfOrient = (o==='portrait') ? 'portrait' : 'landscape';
  var l=document.getElementById('pdf-orient-land'), p=document.getElementById('pdf-orient-port');
  if(l) l.classList.toggle('on', _pdfOrient==='landscape');
  if(p) p.classList.toggle('on', _pdfOrient==='portrait');
}
function loadPdfLogo(input){
  var file=input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    _pdfLogoDataUrl=e.target.result;
    var prev=document.getElementById('pdf-logo-prev');
    if(prev)prev.innerHTML='<img src="'+_pdfLogoDataUrl+'" style="max-width:80px;max-height:40px;object-fit:contain"/>';
    try{localStorage.setItem('pdf_logo',_pdfLogoDataUrl);}catch(err){}
  };
  reader.readAsDataURL(file);
}
function clearPdfLogo(){
  _pdfLogoDataUrl=null;
  var prev=document.getElementById('pdf-logo-prev');
  if(prev)prev.innerHTML='';
  try{localStorage.removeItem('pdf_logo');}catch(err){}
}
function savePdfBranding(){
  _pdfBranding.co=(document.getElementById('pdf-brand-co')?.value||'').trim();
  _pdfBranding.site=(document.getElementById('pdf-brand-site')?.value||'').trim();
  _pdfBranding.color=document.getElementById('pdf-brand-color')?.value||'#ff6b1a';
  _pdfBranding.tagline=(document.getElementById('pdf-brand-tag')?.value||'').trim();
  try{localStorage.setItem('pdf_branding',JSON.stringify(_pdfBranding));}catch(err){}
}
function loadPdfBranding(){
  try{
    var s=localStorage.getItem('pdf_branding');
    if(s){var b=JSON.parse(s);if(b)Object.assign(_pdfBranding,b);}
    var logo=localStorage.getItem('pdf_logo');
    if(logo)_pdfLogoDataUrl=logo;
  }catch(err){}
  var co=document.getElementById('pdf-brand-co');if(co)co.value=_pdfBranding.co||'';
  var site=document.getElementById('pdf-brand-site');if(site)site.value=_pdfBranding.site||'';
  var col=document.getElementById('pdf-brand-color');if(col)col.value=_pdfBranding.color||'#ff6b1a';
  var hex=document.getElementById('pdf-brand-hex');if(hex)hex.value=_pdfBranding.color||'#ff6b1a';
  var tag=document.getElementById('pdf-brand-tag');if(tag)tag.value=_pdfBranding.tagline||'';
  var prev=document.getElementById('pdf-logo-prev');
  if(prev)prev.innerHTML=_pdfLogoDataUrl?'<img src="'+_pdfLogoDataUrl+'" style="max-width:80px;max-height:40px;object-fit:contain"/>':'';
}
function syncPdfBrandColor(val){
  _pdfBranding.color=val;
  var hex=document.getElementById('pdf-brand-hex');if(hex)hex.value=val;
  savePdfBranding();
}
function syncPdfBrandHex(val){
  if(/^#[0-9a-fA-F]{6}$/.test(val)){
    _pdfBranding.color=val;
    var col=document.getElementById('pdf-brand-color');if(col)col.value=val;
    savePdfBranding();
  }
}
/* Whitelist des formats d'image autorisés en logo (refuse SVG = vecteur XSS) */
function _safeLogoUrl(url){
  if(!url || typeof url !== 'string') return null;
  // Refuse SVG (script possible) et tout ce qui n'est pas data:image raster
  if(/^data:image\/svg/i.test(url)) return null;
  if(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(url)) return url;
  // Refuse aussi http://, javascript:, etc. — uniquement data:image raster
  return null;
}
/* Sanitise les couleurs/chaînes de branding pour éviter les injections CSS/HTML */
function _safeBrandStr(s){
  if(!s) return '';
  return String(s).replace(/[<>"'`\\]/g,'').slice(0,80);
}
function _safeColor(c){
  if(!c) return '';
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '';
}

function _pdfBrand(){
  const isStudio=canDo('custom_exports');
  return {
    co:   isStudio&&_pdfBranding.co   ? _safeBrandStr(_pdfBranding.co)   : 'PATCHFLOW',
    site: isStudio&&_pdfBranding.site ? _safeBrandStr(_pdfBranding.site) : 'patchflow.fr',
    color:_safeColor(_pdfBranding.color)||'#ff6b1a',
    tagline:isStudio?_safeBrandStr(_pdfBranding.tagline||''):'',
    logo: isStudio&&_pdfLogoDataUrl   ? _safeLogoUrl(_pdfLogoDataUrl)    : null,
    isStudio:isStudio,
    watermark: (PLAN_PERMS[userPlan()]||PLAN_PERMS.free).pdf_watermark === true /* true pour les comptes gratuits */
  };
}

/* Filigrane diagonal répété pour les exports gratuits */
function _pdfWatermarkHtml(brand){
  if(!brand.watermark) return '';
  return '<div style="position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;opacity:.06">'
    +'<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);white-space:nowrap;font-family:Outfit,sans-serif;font-weight:800;font-size:54px;line-height:2.4;color:#1a1a2e;letter-spacing:4px;text-align:center">'
    +('PATCHFLOW · GRATUIT &nbsp; ').repeat(60)
    +'</div></div>';
}
function _buildPdfInHTML(meta,brand){
  const show=CUR_SHOW?.name||'Show';const now=new Date().toLocaleString('fr-FR');
  const accentColor=brand.color||'#ff6b1a';
  const logoHtml=brand.logo?'<img src="'+brand.logo+'" style="max-width:34px;max-height:34px;object-fit:contain"/>':_PF_LOGO_PX;
  const subLine=meta.title||(brand.tagline||(brand.co+' · INPUT LIST'));
  const activeCols=[{id:'short',label:'Court'},{id:'long',label:'Nom Long'},{id:'src',label:'Source'},{id:'mic',label:'Micro/DI'},{id:'gain',label:'Gain'},{id:'phantom',label:'+48V'},{id:'iem',label:'IEM'},{id:'hf',label:'Fréq. HF'},{id:'foh',label:'FOH'},{id:'mon',label:'MON'},{id:'bc',label:'BC'},{id:'note',label:'Pied micro'}].filter(c=>visCol.has(c.id));
  const fm={short:'short_name',long:'long_name',src:'source',mic:'mic',gain:'gain',phantom:'phantom',iem:'iem_group',foh:'foh',mon:'mon',bc:'bc',note:'note'};
  let body=`<table><thead><tr><th>CH</th>${activeCols.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead><tbody>`;
  CHS.forEach((r,i)=>{
    body+=`<tr style="${i%2===1?'background:#fdf8f4':''}"><td class="ch">${r.ch}</td>`;
    activeCols.forEach(c=>{
      const v=(c.id==='hf')?((r.custom_data&&r.custom_data._hf)||''):r[fm[c.id]];let cell='';
      if(c.id==='short')cell=`<b>${(v||'').trim()}</b>`;
      else if(c.id==='hf')cell=v?`<span class="mo">${v}</span>`:'';
      else if(c.id==='phantom')cell=v?'<span class="badge-ph">+48V</span>':'';
      else if(c.id==='iem')cell=v?`<span class="badge-iem">${v}</span>`:'';
      else if(c.id==='foh')cell=v?'<span class="ck">&#10003;</span>':'';
      else if(c.id==='mon')cell=v?'<span class="ck-m">&#10003;</span>':'';
      else if(c.id==='bc')cell=v?'<span class="ck-b">&#10003;</span>':'';
      else if(c.id==='gain')cell=`<span class="mo">${v||0} dB</span>`;
      else if(c.id==='mic')cell=`<span class="mo">${v||''}</span>`;
      else cell=`<span class="mu">${v||''}</span>`;
      body+=`<td>${cell}</td>`;
    });
    body+='</tr>';
  });
  body+='</tbody></table>';
  const engLine=[meta.eng,meta.role].filter(Boolean).join(' — ');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${brand.co} — ${show}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--o:${accentColor};--b:#1a8fff;--g:#22d6a0;--w:#f5c542}
body{font-family:'Outfit',sans-serif;background:#fff;color:#1a1a2e;font-size:9.5px}@page{size:A4 landscape;margin:10mm 12mm}
.hd{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 16px 10px;border-bottom:3px solid var(--o)}
.hl{display:flex;align-items:center;gap:11px}.logo{width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ht{font-size:16px;font-weight:700}.hs{font-size:9px;color:#888;font-family:'DM Mono',monospace;letter-spacing:.5px}
.hr{text-align:right}.hdt{font-size:10px;font-weight:700;color:var(--o);text-transform:uppercase;letter-spacing:1.5px;font-family:'DM Mono',monospace}.hdm{font-size:8px;color:#666;font-family:'DM Mono',monospace}
.ib{display:flex;background:#f8f8fa;border-bottom:1px solid #eee;font-family:'DM Mono',monospace;font-size:9px}
.ic{padding:5px 12px;border-right:1px solid #eee;display:flex;flex-direction:column;gap:1px}
.il{color:#aaa;font-size:7.5px;text-transform:uppercase;letter-spacing:1px}.iv{color:#1a1a2e;font-weight:500}.ivo{color:var(--o)}
.tw{padding:7px 16px 0}table{width:100%;border-collapse:collapse}
thead tr{background:var(--o)}
th{color:#fff;padding:5px 7px;text-align:left;font-size:8px;letter-spacing:.8px;text-transform:uppercase;font-family:'DM Mono',monospace;font-weight:500;white-space:nowrap}
td{padding:4px 7px;border-bottom:1px solid #f0eee8;vertical-align:middle}
.ch{font-family:'DM Mono',monospace;font-weight:700;color:var(--o);text-align:center;width:26px}
.mo{font-family:'DM Mono',monospace;font-size:9px;color:#555}.mu{color:#888}
.badge-ph{background:#e8faf5;color:#22a07a;border:1px solid #b8e8d8;border-radius:3px;padding:1px 4px;font-size:7.5px;font-family:'DM Mono',monospace}
.badge-iem{background:#fff3e8;color:#cc5500;border:1px solid #ffd0a8;border-radius:3px;padding:1px 4px;font-size:7.5px;font-family:'DM Mono',monospace}
.ck{color:var(--b);font-weight:700;font-size:10px}.ck-m{color:var(--w);font-weight:700;font-size:10px}.ck-b{color:#9b6aff;font-weight:700;font-size:10px}
.sb{display:flex;padding:6px 16px;background:#f8f8fa;border-top:1px solid #eee;font-family:'DM Mono',monospace;font-size:8px;gap:0}
.si{padding:0 14px 0 0;margin-right:14px;border-right:1px solid #e0e0e0;color:#666}.si:last-child{border-right:none}.sv{font-weight:700;color:var(--o)}
.ns{padding:6px 16px;font-size:9px;color:#666;background:#fffbf7;border-top:1px solid #ffe0c8}
.nl{font-family:'DM Mono',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:2px}
.ft{display:flex;align-items:center;justify-content:space-between;padding:5px 16px;border-top:1px solid #eee;font-size:8px;color:#bbb;font-family:'DM Mono',monospace}
.fl{font-weight:700;color:var(--o);letter-spacing:1px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
${_pdfWatermarkHtml(brand)}
<div class="hd"><div class="hl"><div class="logo">${logoHtml}</div><div><div class="ht">${show}</div><div class="hs">${subLine}</div></div></div><div class="hr"><div class="hdt">Input List</div><div class="hdm">${meta.rev?`Rev. ${meta.rev}<br/>`:''}${now}</div></div></div>
<div class="ib">
  ${engLine?`<div class="ic"><div class="il">Ing&eacute;nieur</div><div class="iv ivo">${engLine}</div></div>`:''}
  ${meta.co?`<div class="ic"><div class="il">Soci&eacute;t&eacute;</div><div class="iv">${meta.co}</div></div>`:''}
  ${(CUR_SHOW?.venue||meta.venue)?`<div class="ic"><div class="il">Venue</div><div class="iv">${CUR_SHOW?.venue||meta.venue}</div></div>`:''}
  ${meta.date?`<div class="ic"><div class="il">Date</div><div class="iv">${meta.date}</div></div>`:''}
  ${meta.tel?`<div class="ic"><div class="il">Contact</div><div class="iv">${meta.tel}</div></div>`:''}
</div>
<div class="tw">${body}</div>
<div class="sb">
  <div class="si">Total <span class="sv">${CHS.length}</span> canaux</div>
  <div class="si">+48V <span class="sv">${CHS.filter(r=>r.phantom).length}</span></div>
  <div class="si">FOH <span class="sv">${CHS.filter(r=>r.foh).length}</span></div>
  <div class="si">MON <span class="sv">${CHS.filter(r=>r.mon).length}</span></div>
  <div class="si">IEM <span class="sv">${CHS.filter(r=>r.iem_group).length}</span></div>
</div>
${meta.recapHtml||''}
${meta.notes?`<div class="ns"><div class="nl">Notes techniques</div>${meta.notes}</div>`:''}
${meta.shareLink?`<div style="display:flex;align-items:center;gap:14px;padding:7px 16px;background:#f4faff;border-top:2px solid #1a8fff;border-bottom:1px solid #d0e8ff"><img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(meta.shareLink)}&color=1a8fff&bgcolor=f4faff" width="54" height="54" style="flex-shrink:0;border-radius:4px"/><div><div style="font-family:'DM Mono',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#1a8fff;margin-bottom:3px">Fiche a jour en ligne</div><a href="${meta.shareLink}" style="font-size:9px;color:#1a4fff;font-family:'DM Mono',monospace;word-break:break-all;text-decoration:none">${meta.shareLink}</a><div style="font-size:7.5px;color:#888;margin-top:3px;font-family:'DM Mono',monospace">Scannez le QR code ou visitez le lien pour retrouver cette fiche a jour a tout moment.</div></div></div>`:''}
<div class="ft"><span class="fl">${brand.co.toUpperCase()}</span><span>${engLine||show} · ${now}</span><span>${brand.site} · ${meta.rev||''}</span></div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;
}
function _buildPdfOutHTML(meta,brand){
  const show=CUR_SHOW?.name||'Show';const now=new Date().toLocaleString('fr-FR');
  const accentColor=brand.color||'#ff6b1a';
  const logoHtml=brand.logo?'<img src="'+brand.logo+'" style="max-width:34px;max-height:34px;object-fit:contain"/>':_PF_LOGO_PX;
  const subLine=meta.title||(brand.tagline||(brand.co+' · OUTPUT LIST'));
  const engLine=[meta.eng,meta.role].filter(Boolean).join(' — ');
  let body='<table><thead><tr><th>CH</th><th>Court</th><th>Nom Long</th><th>Type</th><th>Destination</th><th>Note</th></tr></thead><tbody>';
  OUT_CHS.forEach(function(r,i){
    var t=OUT_TYPES[r.type]||OUT_TYPES.other;
    body+='<tr style="'+(i%2===1?'background:#fdf8f4':'')+'"><td class="ch">'+r.ch+'</td>'
      +'<td><b>'+(r.short_name||'').trim()+'</b></td>'
      +'<td><span class="mu">'+(r.long_name||'')+'</span></td>'
      +'<td><span class="badge-type" style="background:'+t.bg+';color:'+t.color+';border-color:'+t.color+'40">'+t.label+'</span></td>'
      +'<td><span class="mo">'+(r.dest||'')+'</span></td>'
      +'<td><span class="mu">'+(r.note||'')+'</span></td>'
      +'</tr>';
  });
  body+='</tbody></table>';
  var typeSummary='';
  Object.keys(OUT_TYPES).forEach(function(k){
    var count=OUT_CHS.filter(function(r){return r.type===k;}).length;
    if(count>0){var t=OUT_TYPES[k];typeSummary+='<div class="si"><span style="color:'+t.color+'">'+t.label+'</span> <span class="sv" style="color:'+t.color+'">'+count+'</span></div>';}
  });
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${brand.co} — ${show} — Output List</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}:root{--o:${accentColor};--b:#1a8fff;--g:#22d6a0;--w:#f5c542}
body{font-family:'Outfit',sans-serif;background:#fff;color:#1a1a2e;font-size:9.5px}@page{size:A4 landscape;margin:10mm 12mm}
.hd{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 16px 10px;border-bottom:3px solid var(--o)}
.hl{display:flex;align-items:center;gap:11px}.logo{width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ht{font-size:16px;font-weight:700}.hs{font-size:9px;color:#888;font-family:'DM Mono',monospace;letter-spacing:.5px}
.hr{text-align:right}.hdt{font-size:10px;font-weight:700;color:var(--o);text-transform:uppercase;letter-spacing:1.5px;font-family:'DM Mono',monospace}.hdm{font-size:8px;color:#666;font-family:'DM Mono',monospace}
.ib{display:flex;background:#f8f8fa;border-bottom:1px solid #eee;font-family:'DM Mono',monospace;font-size:9px}
.ic{padding:5px 12px;border-right:1px solid #eee;display:flex;flex-direction:column;gap:1px}
.il{color:#aaa;font-size:7.5px;text-transform:uppercase;letter-spacing:1px}.iv{color:#1a1a2e;font-weight:500}.ivo{color:var(--o)}
.tw{padding:7px 16px 0}table{width:100%;border-collapse:collapse}
thead tr{background:var(--o)}
th{color:#fff;padding:5px 7px;text-align:left;font-size:8px;letter-spacing:.8px;text-transform:uppercase;font-family:'DM Mono',monospace;font-weight:500;white-space:nowrap}
td{padding:4px 7px;border-bottom:1px solid #f0eee8;vertical-align:middle}
.ch{font-family:'DM Mono',monospace;font-weight:700;color:var(--o);text-align:center;width:26px}
.mo{font-family:'DM Mono',monospace;font-size:9px;color:#555}.mu{color:#888}
.badge-type{border:1px solid;border-radius:3px;padding:1px 5px;font-size:7.5px;font-family:'DM Mono',monospace;white-space:nowrap}
.sb{display:flex;flex-wrap:wrap;padding:6px 16px;background:#f8f8fa;border-top:1px solid #eee;font-family:'DM Mono',monospace;font-size:8px;gap:0}
.si{padding:0 14px 0 0;margin-right:14px;border-right:1px solid #e0e0e0;color:#666}.si:last-child{border-right:none}.sv{font-weight:700;color:var(--o)}
.ns{padding:6px 16px;font-size:9px;color:#666;background:#fffbf7;border-top:1px solid #ffe0c8}
.nl{font-family:'DM Mono',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:2px}
.ft{display:flex;align-items:center;justify-content:space-between;padding:5px 16px;border-top:1px solid #eee;font-size:8px;color:#bbb;font-family:'DM Mono',monospace}
.fl{font-weight:700;color:var(--o);letter-spacing:1px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
${_pdfWatermarkHtml(brand)}
<div class="hd"><div class="hl"><div class="logo">${logoHtml}</div><div><div class="ht">${show}</div><div class="hs">${subLine}</div></div></div><div class="hr"><div class="hdt">Output List</div><div class="hdm">${meta.rev?`Rev. ${meta.rev}<br/>`:''}${now}</div></div></div>
<div class="ib">
  ${engLine?`<div class="ic"><div class="il">Ing&eacute;nieur</div><div class="iv ivo">${engLine}</div></div>`:''}
  ${meta.co?`<div class="ic"><div class="il">Soci&eacute;t&eacute;</div><div class="iv">${meta.co}</div></div>`:''}
  ${(CUR_SHOW?.venue||meta.venue)?`<div class="ic"><div class="il">Venue</div><div class="iv">${CUR_SHOW?.venue||meta.venue}</div></div>`:''}
  ${meta.date?`<div class="ic"><div class="il">Date</div><div class="iv">${meta.date}</div></div>`:''}
  ${meta.tel?`<div class="ic"><div class="il">Contact</div><div class="iv">${meta.tel}</div></div>`:''}
</div>
<div class="tw">${body}</div>
<div class="sb"><div class="si">Total <span class="sv">${OUT_CHS.length}</span> sorties</div>${typeSummary}</div>
${meta.notes?`<div class="ns"><div class="nl">Notes techniques</div>${meta.notes}</div>`:''}
${meta.shareLink?`<div style="display:flex;align-items:center;gap:14px;padding:7px 16px;background:#f4faff;border-top:2px solid #1a8fff;border-bottom:1px solid #d0e8ff"><img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(meta.shareLink)}&color=1a8fff&bgcolor=f4faff" width="54" height="54" style="flex-shrink:0;border-radius:4px"/><div><div style="font-family:'DM Mono',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#1a8fff;margin-bottom:3px">Fiche a jour en ligne</div><a href="${meta.shareLink}" style="font-size:9px;color:#1a4fff;font-family:'DM Mono',monospace;word-break:break-all;text-decoration:none">${meta.shareLink}</a><div style="font-size:7.5px;color:#888;margin-top:3px;font-family:'DM Mono',monospace">Scannez le QR code ou visitez le lien pour retrouver cette fiche a jour a tout moment.</div></div></div>`:''}
<div class="ft"><span class="fl">${brand.co.toUpperCase()}</span><span>${engLine||show} · ${now}</span><span>${brand.site} · ${meta.rev||''}</span></div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;
}
function _buildPdfBothHTML(meta,brand){
  const show=CUR_SHOW?.name||'Show';const now=new Date().toLocaleString('fr-FR');
  const accentColor=brand.color||'#ff6b1a';
  const logoHtml=brand.logo?'<img src="'+brand.logo+'" style="max-width:34px;max-height:34px;object-fit:contain"/>':_PF_LOGO_PX;
  const engLine=[meta.eng,meta.role].filter(Boolean).join(' — ');
  const docTitle=meta.title||(brand.tagline||(brand.co));
  // Build IN body
  const activeCols=[{id:'short',label:'Court'},{id:'long',label:'Nom Long'},{id:'src',label:'Source'},{id:'mic',label:'Micro/DI'},{id:'gain',label:'Gain'},{id:'phantom',label:'+48V'},{id:'iem',label:'IEM'},{id:'hf',label:'Fréq. HF'},{id:'foh',label:'FOH'},{id:'mon',label:'MON'},{id:'bc',label:'BC'},{id:'note',label:'Pied micro'}].filter(c=>visCol.has(c.id));
  const fm={short:'short_name',long:'long_name',src:'source',mic:'mic',gain:'gain',phantom:'phantom',iem:'iem_group',foh:'foh',mon:'mon',bc:'bc',note:'note'};
  let inBody='<table><thead><tr><th>CH</th>'+activeCols.map(c=>'<th>'+c.label+'</th>').join('')+'</tr></thead><tbody>';
  CHS.forEach(function(r,i){
    inBody+='<tr style="'+(i%2===1?'background:#fdf8f4':'')+'"><td class="ch">'+r.ch+'</td>';
    activeCols.forEach(function(c){
      const v=(c.id==='hf')?((r.custom_data&&r.custom_data._hf)||''):r[fm[c.id]];var cell='';
      if(c.id==='short')cell='<b>'+(v||'').trim()+'</b>';
      else if(c.id==='hf')cell=v?'<span class="mo">'+v+'</span>':'';
      else if(c.id==='phantom')cell=v?'<span class="badge-ph">+48V</span>':'';
      else if(c.id==='iem')cell=v?'<span class="badge-iem">'+v+'</span>':'';
      else if(c.id==='foh')cell=v?'<span class="ck">&#10003;</span>':'';
      else if(c.id==='mon')cell=v?'<span class="ck-m">&#10003;</span>':'';
      else if(c.id==='bc')cell=v?'<span class="ck-b">&#10003;</span>':'';
      else if(c.id==='gain')cell='<span class="mo">'+(v||0)+' dB</span>';
      else if(c.id==='mic')cell='<span class="mo">'+(v||'')+'</span>';
      else cell='<span class="mu">'+(v||'')+'</span>';
      inBody+='<td>'+cell+'</td>';
    });
    inBody+='</tr>';
  });
  inBody+='</tbody></table>';
  // Build OUT body
  var outBody='<table><thead><tr><th>CH</th><th>Court</th><th>Nom Long</th><th>Type</th><th>Destination</th><th>Fréq. HF</th><th>Note</th></tr></thead><tbody>';
  OUT_CHS.forEach(function(r,i){
    var t=OUT_TYPES[r.type]||OUT_TYPES.other;
    outBody+='<tr style="'+(i%2===1?'background:#fdf8f4':'')+'"><td class="ch">'+r.ch+'</td>'
      +'<td><b>'+(r.short_name||'').trim()+'</b></td>'
      +'<td><span class="mu">'+(r.long_name||'')+'</span></td>'
      +'<td><span class="badge-type" style="background:'+t.bg+';color:'+t.color+';border-color:'+t.color+'40">'+t.label+'</span></td>'
      +'<td><span class="mo">'+(r.dest||'')+'</span></td>'
      +'<td>'+(r.hf?'<span class="mo">'+r.hf+'</span>':'')+'</td>'
      +'<td><span class="mu">'+(r.note||'')+'</span></td></tr>';
  });
  outBody+='</tbody></table>';
  var typeSummary='';
  Object.keys(OUT_TYPES).forEach(function(k){
    var count=OUT_CHS.filter(function(r){return r.type===k;}).length;
    if(count>0){var t=OUT_TYPES[k];typeSummary+='<div class="si"><span style="color:'+t.color+'">'+t.label+'</span> <span class="sv" style="color:'+t.color+'">'+count+'</span></div>';}
  });
  const sharedCSS=`*{box-sizing:border-box;margin:0;padding:0}:root{--o:${accentColor};--b:#1a8fff;--g:#22d6a0;--w:#f5c542}
body{font-family:'Outfit',sans-serif;background:#fff;color:#1a1a2e;font-size:9.5px}@page{size:A4 landscape;margin:10mm 12mm}
.hd{display:flex;align-items:flex-start;justify-content:space-between;padding:12px 16px 10px;border-bottom:3px solid var(--o)}
.hl{display:flex;align-items:center;gap:11px}.logo{width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ht{font-size:16px;font-weight:700}.hs{font-size:9px;color:#888;font-family:'DM Mono',monospace;letter-spacing:.5px}
.hr{text-align:right}.hdt{font-size:10px;font-weight:700;color:var(--o);text-transform:uppercase;letter-spacing:1.5px;font-family:'DM Mono',monospace}.hdm{font-size:8px;color:#666;font-family:'DM Mono',monospace}
.ib{display:flex;background:#f8f8fa;border-bottom:1px solid #eee;font-family:'DM Mono',monospace;font-size:9px}
.ic{padding:5px 12px;border-right:1px solid #eee;display:flex;flex-direction:column;gap:1px}
.il{color:#aaa;font-size:7.5px;text-transform:uppercase;letter-spacing:1px}.iv{color:#1a1a2e;font-weight:500}.ivo{color:var(--o)}
.tw{padding:7px 16px 0}table{width:100%;border-collapse:collapse}
thead tr{background:var(--o)}
th{color:#fff;padding:5px 7px;text-align:left;font-size:8px;letter-spacing:.8px;text-transform:uppercase;font-family:'DM Mono',monospace;font-weight:500;white-space:nowrap}
td{padding:4px 7px;border-bottom:1px solid #f0eee8;vertical-align:middle}
.ch{font-family:'DM Mono',monospace;font-weight:700;color:var(--o);text-align:center;width:26px}
.mo{font-family:'DM Mono',monospace;font-size:9px;color:#555}.mu{color:#888}
.badge-ph{background:#e8faf5;color:#22a07a;border:1px solid #b8e8d8;border-radius:3px;padding:1px 4px;font-size:7.5px;font-family:'DM Mono',monospace}
.badge-iem{background:#fff3e8;color:#cc5500;border:1px solid #ffd0a8;border-radius:3px;padding:1px 4px;font-size:7.5px;font-family:'DM Mono',monospace}
.badge-type{border:1px solid;border-radius:3px;padding:1px 5px;font-size:7.5px;font-family:'DM Mono',monospace;white-space:nowrap}
.ck{color:var(--b);font-weight:700;font-size:10px}.ck-m{color:var(--w);font-weight:700;font-size:10px}.ck-b{color:#9b6aff;font-weight:700;font-size:10px}
.sb{display:flex;flex-wrap:wrap;padding:6px 16px;background:#f8f8fa;border-top:1px solid #eee;font-family:'DM Mono',monospace;font-size:8px;gap:0}
.si{padding:0 14px 0 0;margin-right:14px;border-right:1px solid #e0e0e0;color:#666}.si:last-child{border-right:none}.sv{font-weight:700;color:var(--o)}
.ns{padding:6px 16px;font-size:9px;color:#666;background:#fffbf7;border-top:1px solid #ffe0c8}
.nl{font-family:'DM Mono',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:2px}
.ft{display:flex;align-items:center;justify-content:space-between;padding:5px 16px;border-top:1px solid #eee;font-size:8px;color:#bbb;font-family:'DM Mono',monospace}
.fl{font-weight:700;color:var(--o);letter-spacing:1px}
.pb{page-break-after:always;height:0;overflow:hidden}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  const infoBar=`<div class="ib">
  ${engLine?'<div class="ic"><div class="il">Ing&eacute;nieur</div><div class="iv ivo">'+engLine+'</div></div>':''}
  ${meta.co?'<div class="ic"><div class="il">Soci&eacute;t&eacute;</div><div class="iv">'+meta.co+'</div></div>':''}
  ${(CUR_SHOW?.venue||meta.venue)?'<div class="ic"><div class="il">Venue</div><div class="iv">'+(CUR_SHOW?.venue||meta.venue)+'</div></div>':''}
  ${meta.date?'<div class="ic"><div class="il">Date</div><div class="iv">'+meta.date+'</div></div>':''}
  ${meta.tel?'<div class="ic"><div class="il">Contact</div><div class="iv">'+meta.tel+'</div></div>':''}
</div>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${brand.co} — ${show}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>${sharedCSS}</style></head><body>
${_pdfWatermarkHtml(brand)}
<div class="hd"><div class="hl"><div class="logo">${logoHtml}</div><div><div class="ht">${show}</div><div class="hs">${docTitle} · INPUT LIST</div></div></div><div class="hr"><div class="hdt">Input List</div><div class="hdm">${meta.rev?`Rev. ${meta.rev}<br/>`:''}${now}</div></div></div>
${infoBar}
<div class="tw">${inBody}</div>
<div class="sb">
  <div class="si">Total <span class="sv">${CHS.length}</span> canaux</div>
  <div class="si">+48V <span class="sv">${CHS.filter(r=>r.phantom).length}</span></div>
  <div class="si">FOH <span class="sv">${CHS.filter(r=>r.foh).length}</span></div>
  <div class="si">MON <span class="sv">${CHS.filter(r=>r.mon).length}</span></div>
  <div class="si">IEM <span class="sv">${CHS.filter(r=>r.iem_group).length}</span></div>
</div>
${meta.notes?`<div class="ns"><div class="nl">Notes techniques</div>${meta.notes}</div>`:''}
<div class="ft"><span class="fl">${brand.co.toUpperCase()}</span><span>${engLine||show} · ${now}</span><span>${brand.site} · ${meta.rev||''}</span></div>
<div class="pb"></div>
<div class="hd"><div class="hl"><div class="logo">${logoHtml}</div><div><div class="ht">${show}</div><div class="hs">${docTitle} · OUTPUT LIST</div></div></div><div class="hr"><div class="hdt">Output List</div><div class="hdm">${meta.rev?`Rev. ${meta.rev}<br/>`:''}${now}</div></div></div>
${infoBar}
<div class="tw">${outBody}</div>
<div class="sb"><div class="si">Total <span class="sv">${OUT_CHS.length}</span> sorties</div>${typeSummary}</div>
<div class="ft"><span class="fl">${brand.co.toUpperCase()}</span><span>${engLine||show} · ${now}</span><span>${brand.site} · ${meta.rev||''}</span></div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`;
}
function openPDFModal(forceType){
  // Determine which toggle buttons to show based on context
  if(forceType==='stage')      _pdfVisibleTypes=['stage'];
  else if(forceType==='site')  _pdfVisibleTypes=['site'];
  else if(forceType==='syno')  _pdfVisibleTypes=['syno'];
  else                         _pdfVisibleTypes=['in','out','both']; // Input List context

  const isFree=userPlan()==='free';
  const isStudio=canDo('custom_exports');
  document.querySelectorAll('.pdf-pro-fld').forEach(function(el){el.style.display=isFree?'none':'';});
  const notice=document.getElementById('pdf-free-notice');
  if(notice)notice.style.display=isFree?'flex':'none';
  const lastSec=document.getElementById('pdf-notes-sec');
  if(lastSec)lastSec.style.marginBottom=isFree?'0':'';
  const brandSec=document.getElementById('pdf-brand-sec');
  if(brandSec)brandSec.style.display=isStudio?'':'none';
  if(isStudio)loadPdfBranding();
  // Pre-fill common fields from show/profile
  const engEl=document.getElementById('pdf-eng');
  if(engEl&&!engEl.value) engEl.value=PROFILE?.full_name||'';
  const roleEl=document.getElementById('pdf-role');
  if(roleEl&&!roleEl.value) roleEl.value=PROFILE?.role||'';
  const venueEl=document.getElementById('pdf-venue');
  if(venueEl&&!venueEl.value&&CUR_SHOW?.venue) venueEl.value=CUR_SHOW.venue;
  const dateEl=document.getElementById('pdf-date');
  if(dateEl&&!dateEl.value&&CUR_SHOW?.show_date) dateEl.value=CUR_SHOW.show_date;
  /* On ne pré-remplit PLUS le sous-titre avec le nom du show (rendu PDF plus
     pro : le titre du document est mis en avant, pas le nom interne du show). */
  const type = forceType || CUR_IL_MODE;
  setPdfExportType(type);
  document.getElementById('pdf-modal').className='modal-ov show';
}
function closePDF(){document.getElementById('pdf-modal').className='modal-ov';}
function copyILShareLink(){
  if(!registerShareLink('il')) return;
  var url=_riderBase()+'?view='+(CUR_SHOW?.id||'')+'&tab=il';
  try{navigator.clipboard.writeText(url).then(function(){toast('Lien copié !');});} catch(e){
    var ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Lien copié !');
  }
}

// ══════════════════════════════════════
// BANDPLAN EXPORT
// ══════════════════════════════════════
/* ── Canvas helpers (vintage export) ─────────────────────────── */
function _bpRR(ctx,x,y,w,h,r){
  if(r<0)r=0;
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}
/* Label d'un nœud — réplique fidèlement .bp-vnode-lbl de l'éditeur (mode
   vintage) : DM Mono à 13px*textScale, couleur navy #1d3a5f, fond blanc +
   bordure fine, largeur max 130px*textScale, ellipsis si trop long.
   L'icône, elle, reste ancrée au coin (el.x) comme dans l'éditeur vintage. */
function _vtLabel(ctx,text,cx,y,SC,TS){
  TS=TS||1;
  var fs=Math.max(9,Math.round(13*TS*SC));
  ctx.font='600 '+fs+'px "DM Mono", ui-monospace, monospace';
  ctx.textAlign='center';ctx.textBaseline='top';
  var lbl=(text||'');
  var maxTextW=Math.max(20,(130*TS-20)*SC);
  if(ctx.measureText(lbl).width>maxTextW){ while(lbl.length>1 && ctx.measureText(lbl+'…').width>maxTextW) lbl=lbl.slice(0,-1); lbl+='…'; }
  var tw=ctx.measureText(lbl).width,padX=10*SC,padY=3*SC;
  var boxW=tw+padX*2,boxH=fs+padY*2,bx=cx-boxW/2;
  _bpRR(ctx,bx,y,boxW,boxH,5*SC);
  ctx.fillStyle='rgba(255,255,255,.98)';ctx.fill();
  ctx.strokeStyle='rgba(29,58,95,.18)';ctx.lineWidth=Math.max(1,1*SC);ctx.stroke();
  ctx.fillStyle='#1d3a5f';ctx.fillText(lbl,cx,y+padY);
  ctx.textBaseline='alphabetic';
}
function _vtChBadge(ctx,chNum,nodeW,nodeTop,SC,opts){
  SC=SC||1; opts=opts||{};
  var fs=Math.round(22*SC);
  var badge=(opts.prefix||'CH ')+chNum;
  ctx.font='900 '+fs+'px monospace';
  var pad=20*SC,bh=Math.round(32*SC),bw=ctx.measureText(badge).width+pad*2;
  var bx=nodeW-bw+10*SC,by=nodeTop-bh/2-4*SC;
  _bpRR(ctx,bx,by,bw,bh,bh/2);
  ctx.fillStyle=opts.color||'#ff6b1a';
  ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=8*SC;ctx.fill();ctx.shadowBlur=0;
  ctx.fillStyle=opts.txtColor||'#000';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(badge,bx+bw/2,by+bh/2);
  ctx.textBaseline='alphabetic';
}
/* Numéro de sortie pour un élément (retour) — mono ou stéréo L+R. */
function _bpOutBadgeText(el){
  if(!el) return '';
  var l=el.outCh?(_outById(el.outCh)?_outById(el.outCh).ch:'?'):null;
  var r=el.outChR?(_outById(el.outChR)?_outById(el.outChR).ch:'?'):null;
  if(l!=null && r!=null) return l+'+'+r;
  if(l!=null) return ''+l;
  if(r!=null) return ''+r;
  return '';
}
/* ══════════════════════════════════════
   MODE IA — adapter un plan de scène depuis une image (réservé Pro)
   ══════════════════════════════════════ */
function bpAiImport(){
  if(!CUR_SHOW){ toast('Aucun show sélectionné.'); return; }
  if(!canDo('ai_stage')){ showUpgradeModal('ai_stage'); return; }
  document.getElementById('bp-ai-file').click();
}
function _bpAiSetLoading(on){
  const btn=document.getElementById('bp-ai-btn'); if(!btn) return;
  if(on){ btn.disabled=true; btn.dataset.html=btn.innerHTML; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Analyse du plan…'; }
  else { btn.disabled=false; if(btn.dataset.html) btn.innerHTML=btn.dataset.html; }
}
/* Lit + redimensionne l'image (max 1600 px) → JPEG base64 : limite le coût IA
   et la taille réseau. */
function _bpAiPrepareImage(file){
  return new Promise(function(resolve,reject){
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        const MAX=1600; let w=img.width,h=img.height;
        if(Math.max(w,h)>MAX){ if(w>=h){h=Math.round(h*MAX/w);w=MAX;} else {w=Math.round(w*MAX/h);h=MAX;} }
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        resolve({dataUrl:cv.toDataURL('image/jpeg',0.85), mediaType:'image/jpeg'});
      };
      img.onerror=reject; img.src=e.target.result;
    };
    reader.onerror=reject; reader.readAsDataURL(file);
  });
}
async function bpAiHandleFile(input){
  const file=input.files&&input.files[0];
  input.value='';
  if(!file) return;
  if(!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)){ toast('Image PNG, JPEG, WEBP ou GIF requise.'); return; }
  if(file.size>6*1024*1024){ toast('Image trop lourde (max 6 Mo).'); return; }
  let prepared;
  try{ prepared=await _bpAiPrepareImage(file); }
  catch(e){ toast('Impossible de lire l\'image.'); return; }
  const base64=(prepared.dataUrl.split(',')[1])||'';

  _bpAiSetLoading(true);
  try{
    const sess=(await sb.auth.getSession()).data?.session;
    const res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/stage-ai',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(sess?.access_token||''),'apikey':SB_KEY},
      body:JSON.stringify({imageBase64:base64, mediaType:prepared.mediaType})
    });
    const data=await res.json().catch(function(){return {};});
    if(!res.ok){
      if(data&&data.code==='pro_only') showUpgradeModal('ai_stage');
      else toast('IA : '+((data&&data.error)||('erreur '+res.status)));
      return;
    }
    const els=(data&&data.elements)||[];
    if(!els.length){ toast('Aucun élément reconnu sur ce plan — réessayez avec une image plus nette.'); return; }
    const n=BandPlan.aiPlace(els);
    toast('✨ '+n+' élément'+(n>1?'s':'')+' placé'+(n>1?'s':'')+' depuis le plan');
  }catch(e){ toast('Erreur réseau : '+e.message); }
  finally{ _bpAiSetLoading(false); }
}

/* ══════════════════════════════════════
   MODE IA — adapter une input list depuis un fichier (réservé Pro).
   Formats : image (PNG/JPEG/WEBP/GIF), PDF, CSV/TXT, Word (.docx).
   ══════════════════════════════════════ */
function ilAiImport(){
  if(!CUR_SHOW){ toast('Aucun show sélectionné.'); return; }
  if(!canDo('ai_inputlist')){ showUpgradeModal('ai_inputlist'); return; }
  document.getElementById('il-ai-file').click();
}
function _ilAiSetLoading(on){
  const btn=document.getElementById('il-ai-btn'); if(!btn) return;
  if(on){ btn.disabled=true; btn.dataset.html=btn.innerHTML; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Analyse…'; }
  else { btn.disabled=false; if(btn.dataset.html) btn.innerHTML=btn.dataset.html; }
}
/* Lit + redimensionne une image (max 1600 px) → JPEG base64. */
function _ilAiPrepareImage(file){
  return new Promise(function(resolve,reject){
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        const MAX=1600; let w=img.width,h=img.height;
        if(Math.max(w,h)>MAX){ if(w>=h){h=Math.round(h*MAX/w);w=MAX;} else {w=Math.round(w*MAX/h);h=MAX;} }
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        resolve(cv.toDataURL('image/jpeg',0.85).split(',')[1]||'');
      };
      img.onerror=reject; img.src=e.target.result;
    };
    reader.onerror=reject; reader.readAsDataURL(file);
  });
}
function _ilAiReadBase64(file){
  return new Promise(function(resolve,reject){
    const reader=new FileReader();
    reader.onload=function(e){ resolve((e.target.result.split(',')[1])||''); };
    reader.onerror=reject; reader.readAsDataURL(file);
  });
}
function _ilAiReadText(file){
  return new Promise(function(resolve,reject){
    const reader=new FileReader();
    reader.onload=function(e){ resolve(e.target.result||''); };
    reader.onerror=reject; reader.readAsText(file);
  });
}
async function ilAiHandleFile(input){
  const file=input.files&&input.files[0];
  input.value='';
  if(!file) return;

  const name=(file.name||'').toLowerCase();
  const type=file.type||'';
  let payload;
  try{
    if(/^image\//.test(type)){
      if(!/^image\/(png|jpe?g|webp|gif)$/i.test(type)){ toast('Image PNG, JPEG, WEBP ou GIF requise.'); return; }
      if(file.size>6*1024*1024){ toast('Image trop lourde (max 6 Mo).'); return; }
      payload={kind:'image', imageBase64:await _ilAiPrepareImage(file), mediaType:'image/jpeg'};
    } else if(type==='application/pdf'||name.endsWith('.pdf')){
      if(file.size>10*1024*1024){ toast('PDF trop lourd (max 10 Mo).'); return; }
      payload={kind:'pdf', base64:await _ilAiReadBase64(file)};
    } else if(name.endsWith('.docx')||type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
      if(file.size>10*1024*1024){ toast('Document trop lourd (max 10 Mo).'); return; }
      payload={kind:'docx', base64:await _ilAiReadBase64(file)};
    } else if(name.endsWith('.csv')||name.endsWith('.txt')||type==='text/csv'||type==='text/plain'){
      payload={kind:'text', text:await _ilAiReadText(file)};
    } else if(name.endsWith('.doc')){
      toast('Les anciens fichiers .doc ne sont pas supportés — enregistrez en .docx, PDF ou CSV.'); return;
    } else {
      toast('Format non supporté. Utilisez image, PDF, CSV, TXT ou Word (.docx).'); return;
    }
  }catch(e){ toast('Impossible de lire le fichier.'); return; }

  _ilAiSetLoading(true);
  toast('Analyse du fichier en cours…');
  try{
    const sess=(await sb.auth.getSession()).data?.session;
    const res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/inputlist-ai',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(sess?.access_token||''),'apikey':SB_KEY},
      body:JSON.stringify(payload)
    });
    const data=await res.json().catch(function(){return {};});
    if(!res.ok){
      if(data&&data.code==='pro_only') showUpgradeModal('ai_inputlist');
      else toast('IA : '+((data&&data.error)||('erreur '+res.status)));
      return;
    }
    const chs=(data&&data.channels)||[];
    if(!chs.length){ toast('Aucun canal reconnu dans ce fichier — réessayez avec un document plus net.'); return; }
    const n=await ilAiPlace(chs);
    if(n>0) toast('✨ '+n+' canal'+(n>1?'ux':'')+' ajouté'+(n>1?'s':'')+' depuis le fichier');
  }catch(e){ toast('Erreur réseau : '+e.message); }
  finally{ _ilAiSetLoading(false); }
}
/* Insère les canaux détectés à la suite des canaux existants (même logique
   que applyILAssist : respect de la limite de plan + insert Supabase). */
async function ilAiPlace(chs){
  if(!CUR_SHOW||!chs.length) return 0;
  const limit=planLimit('max_channels');
  if(limit!==Infinity){
    const available=limit-CHS.length;
    if(available<=0){ showUpgradeModal('max_channels'); return 0; }
    if(chs.length>available){
      chs=chs.slice(0,available);
      toast('⚠️ Limite de '+limit+' canaux atteinte — '+available+' ajouté'+(available>1?'s':'')+' seulement.');
    }
  }
  let startCh=CHS.length+1, added=0;
  for(let i=0;i<chs.length;i++){
    const c=chs[i];
    const row={
      show_id:CUR_SHOW.id, ch:startCh+i,
      short_name:(c.short_name||'').slice(0,10),
      long_name:c.long_name||'', source:c.source||'', mic:c.mic||'',
      gain:Number(c.gain)||0, phantom:!!c.phantom, iem_group:c.iem_group||'',
      foh:true, mon:false, bc:false, note:c.note||''
    };
    if(_patchColReady) row.patch_id=CUR_PATCH_ID;
    const {data,error}=await sb.from('channels').insert(row).select().single();
    if(error){ toast('Erreur canal '+(i+1)+' : '+error.message); break; }
    CHS.push(data); added++;
  }
  renderTable();
  return added;
}

/* ══════════════════════════════════════
   PLAN DE SCÈNE assigné à l'Input List (patch courant).
   Stocké dans IL_PATCHES[i].stageImage : '' = plan PatchFlow (éditeur),
   sinon le chemin d'une image uploadée. Utilisé par le bouton « Voir le
   plan de scène » des liens partagés.
   ══════════════════════════════════════ */
async function openStagePlanPicker(){
  if(!CUR_SHOW){ toast('Aucun show sélectionné.'); return; }
  var patch=(IL_PATCHES||[]).find(function(p){return p.id===CUR_PATCH_ID;})||IL_PATCHES[0];
  if(!patch){ toast('Aucun patch.'); return; }
  var curImg=patch.stageImage||'';
  var curScene=patch.stageSceneId||'';
  var scenes=(SHOW_SCENES&&SHOW_SCENES.stage)||[];
  var imgs=[];
  try{ var r=await _sfListShowFiles(); imgs=(r.data||[]).filter(function(f){return /\.(png|jpe?g|webp|gif)$/i.test(f.name||'');}); }catch(e){}

  var ov=document.createElement('div');
  ov.id='stageplan-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(5,8,16,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  var opts='';
  /* Plans construits sur PatchFlow (chaque scène de l'éditeur, par son nom) */
  if(scenes.length){
    opts+='<div style="font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--txt2);font-family:var(--m);padding:4px 4px 2px">Plans PatchFlow</div>';
    scenes.forEach(function(s){
      var nb=(s.data&&s.data.band&&s.data.band.els&&s.data.band.els.length)||0;
      opts+=_spOptHtml('scene', s.id, '<i class="ti ti-map-2" style="font-size:17px;color:var(--ora)"></i>', s.name||'Plan', nb?(nb+' élément'+(nb>1?'s':'')):'Plan de scène', !curImg&&curScene===s.id);
    });
  } else {
    opts+=_spOptHtml('scene', '', '<i class="ti ti-map-2" style="font-size:17px;color:var(--ora)"></i>', 'Plan PatchFlow (éditeur)', 'Le plan de scène construit sur PatchFlow', !curImg&&!curScene);
  }
  /* Images uploadées */
  opts+='<div style="font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--txt2);font-family:var(--m);padding:8px 4px 2px">Images</div>';
  imgs.forEach(function(f){
    var disp=(typeof _fichDisplayName==='function')?_fichDisplayName(f.name):f.name;
    opts+=_spOptHtml('image', f.path, '<i class="ti ti-photo" style="font-size:17px;color:#34d399"></i>', disp, 'Image liée', curImg===f.path);
  });
  if(!imgs.length){
    opts+='<div style="font-size:11px;color:var(--muted);padding:6px 4px;font-style:italic">Aucune image dans les fichiers du show. Uploadez un PNG/JPG dans les Fichiers pour pouvoir le lier ici.</div>';
  }
  ov.innerHTML=
    '<div style="background:var(--surf);border:1px solid var(--bdr2);border-radius:14px;max-width:440px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)">'
    +'<div style="display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid var(--bdr2)">'
      +'<i class="ti ti-map-2" style="font-size:16px;color:var(--ora)"></i>'
      +'<span style="font-weight:700;font-size:14px;color:var(--txt)">Plan de scène — '+(patch.name||'patch').replace(/</g,'&lt;')+'</span>'
      +'<button onclick="closeStagePlanPicker()" style="margin-left:auto;background:none;border:none;color:var(--txt2);cursor:pointer;font-size:18px;line-height:1">&#10005;</button>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--muted);padding:12px 18px 4px">Choisissez ce qui s\'ouvre via le bouton « Voir le plan de scène » dans les liens partagés de cette input list.</div>'
    +'<div style="display:flex;flex-direction:column;gap:7px;padding:8px 14px 16px">'+opts+'</div>'
    +'</div>';
  ov.addEventListener('click',function(e){ if(e.target===ov) closeStagePlanPicker(); });
  document.body.appendChild(ov);
}
function _spOptHtml(kind, val, icon, title, sub, active){
  return '<button onclick="_setStagePlan(\''+kind+'\',\''+encodeURIComponent(val)+'\')" '
    +'style="display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:11px 13px;border:1px solid '+(active?'var(--ora)':'var(--bdr2)')+';'
    +'background:'+(active?'var(--ora-d)':'var(--surf2)')+';border-radius:10px;cursor:pointer;font-family:var(--f)">'
    +icon
    +'<span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+title.replace(/</g,'&lt;')+'</span>'
    +'<span style="display:block;font-size:10px;color:var(--txt2)">'+sub+'</span></span>'
    +(active?'<i class="ti ti-check" style="font-size:16px;color:var(--ora)"></i>':'')
    +'</button>';
}
function _setStagePlan(kind, encVal){
  var val=decodeURIComponent(encVal||'');
  var patch=(IL_PATCHES||[]).find(function(p){return p.id===CUR_PATCH_ID;})||IL_PATCHES[0];
  if(!patch){ closeStagePlanPicker(); return; }
  if(kind==='image'){ patch.stageImage=val; patch.stageSceneId=''; }
  else { patch.stageImage=''; patch.stageSceneId=val||''; }
  savePatchMeta();
  closeStagePlanPicker();
  toast(kind==='image'?'✓ Image liée comme plan de scène':'✓ Plan PatchFlow assigné');
}
function closeStagePlanPicker(){
  var m=document.getElementById('stageplan-modal'); if(m) m.remove();
}

function _makeBpCanvas(cb){
  const data=BandPlan.getData();
  const els=data.els||[];
  const RSCALE=75;
  // Bounds
  const _ss=data.stageScale||1;
  const _stgW=Math.min(2380,Math.round(2300*_ss));
  const _stgH=Math.min(1570,Math.round(1480*_ss));
  const _stgX=Math.round(1200-_stgW/2);
  const _stgY=Math.max(20,Math.round(180-(_stgH-900)/2));
  let minX=_stgX,minY=_stgY,maxX=_stgX+_stgW,maxY=_stgY+_stgH;
  const _ns=data.nodeScale||1, _ts=data.textScale||1;
  els.forEach(el=>{
    let w,h;
    if(el.type==='riser'){ w=(el.riserW||2)*RSCALE; h=(el.riserH||1)*RSCALE; }
    else if(el.type==='kit'){ w=210; h=40+Math.max(1,(el.chs||[]).length)*26; }
    else if(el.type==='text_lbl'){ w=200; h=40; }
    else if(el.type==='image_frame'){ w=el.imgPx||120; h=Math.max(1,Math.round(w/(el.imgAspect||1))); }
    else { w=120*_ns; h=120*_ns; }
    /* Hauteur du label sous l'icône + débord horizontal du label (centré sur
       l'icône, largeur jusqu'à ~130px*textScale) : indispensable pour ne pas
       rogner les retours/labels en bordure. */
    const lblH = (el.type==='kit'||el.type==='text_lbl') ? 0 : 13*_ts+14;
    const lblHalf = (el.type==='kit'||el.type==='riser'||el.type==='text_lbl') ? w/2 : Math.max(w/2, (130*_ts)/2);
    const cx = el.x + w/2;
    minX=Math.min(minX, el.x, cx-lblHalf);
    maxX=Math.max(maxX, el.x+w, cx+lblHalf);
    minY=Math.min(minY, el.y-26);            // badge au-dessus
    maxY=Math.max(maxY, el.y+h+lblH);
  });
  const PAD=70;
  minX-=PAD;minY-=PAD;maxX+=PAD;maxY+=PAD;
  const W=maxX-minX,H=maxY-minY;
  const SC=Math.min(2,4096/Math.max(W,H));
  const cw=Math.round(W*SC),ch=Math.round(H*SC);
  const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;
  const ctx=cv.getContext('2d');
  const wx=x=>(x-minX)*SC,wy=y=>(y-minY)*SC;
  const allChs=(typeof ALL_CHS!=='undefined'&&ALL_CHS.length)?ALL_CHS:(typeof CHS!=='undefined'?CHS:[]);
  /* ── VINTAGE CANVAS (light theme, white background) ── */
  if(true){  /* Always vintage now — modern mode removed */
    // White background
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cw,ch);
    /* Décor de scène (grille + cadre SCENE + footlight) — masquable */
    if(!data.hideStage){
      // Grid
      ctx.strokeStyle='#e5eaf2';ctx.lineWidth=0.6;
      for(var gx=0;gx<2400;gx+=40){var sx=wx(gx);if(sx>=0&&sx<=cw){ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,ch);ctx.stroke();}}
      for(var gy=0;gy<1600;gy+=40){var sy=wy(gy);if(sy>=0&&sy<=ch){ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(cw,sy);ctx.stroke();}}
      // Stage area — orange dashed frame
      _bpRR(ctx,wx(_stgX),wy(_stgY),_stgW*SC,_stgH*SC,18*SC);
      ctx.fillStyle='rgba(255,107,26,0.035)';ctx.fill();
      ctx.strokeStyle='rgba(255,107,26,0.30)';ctx.lineWidth=2*SC;ctx.setLineDash([14*SC,7*SC]);ctx.stroke();ctx.setLineDash([]);
      // SCENE label
      ctx.font='bold '+18*SC+'px sans-serif';
      ctx.fillStyle='rgba(255,107,26,0.18)';ctx.textAlign='center';
      ctx.fillText('SCENE',wx(1200),wy(Math.round(_stgY+_stgH*0.44)));
      // Footlight (orange glow) at front
      var flTop=wy(_stgY+_stgH)-30*SC;
      var flGrad=ctx.createLinearGradient(0,flTop+30*SC,0,flTop);
      flGrad.addColorStop(0,'rgba(255,107,26,0.10)');flGrad.addColorStop(1,'rgba(255,107,26,0)');
      ctx.fillStyle=flGrad;ctx.fillRect(wx(_stgX),flTop,_stgW*SC,30*SC);
    }
    // Load SVG images for standard nodes
    var sorted=els.slice().sort(function(a,b){return a.z-b.z;});
    var svgJobs=sorted.map(function(el){
      if(el.type==='riser'||el.type==='kit')return Promise.resolve({el:el,img:null});
      if(el.type==='image_frame'){
        if(!el.iconImg)return Promise.resolve({el:el,img:null,ci:{color:'#888',emoji:'🖼'},isImgFrame:true});
        return new Promise(function(resolve){
          var _fi=new Image();
          _fi.onload=function(){resolve({el:el,img:_fi,ci:{color:'#888',emoji:'🖼'},isImgFrame:true});};
          _fi.onerror=function(){resolve({el:el,img:null,ci:{color:'#888',emoji:'🖼'},isImgFrame:true});};
          _fi.src=el.iconImg;
        });
      }
      var ci=BandPlan.getCatInfo(el.type);
      var svgBody=BandPlan.getVintageSVG(el.type,ci.color);
      var svgFull='<svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">'+svgBody+'</svg>';
      var dataUrl='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgFull);
      return new Promise(function(resolve){
        var img=new Image();
        img.onload=function(){resolve({el:el,img:img,ci:ci});};
        img.onerror=function(){resolve({el:el,img:null,ci:ci});};
        img.src=dataUrl;
      });
    });
    /* Image de fond : chargée puis dessinée AU-DESSUS de la grille/scène mais
       SOUS les nœuds (même empilement que l'éditeur). */
    var bgJob = data.bgImage ? new Promise(function(resolve){
      var bi=new Image(); bi.onload=function(){resolve(bi);}; bi.onerror=function(){resolve(null);}; bi.src=data.bgImage;
    }) : Promise.resolve(null);
    Promise.all([bgJob].concat(svgJobs)).then(function(_all){
      var _bgImg=_all[0]; var results=_all.slice(1);
      if(_bgImg){
        var _bgx=data.bgX||0, _bgy=data.bgY||0, _bgs=data.bgScale==null?1:data.bgScale;
        ctx.save();
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
        ctx.globalAlpha=(data.bgOpacity==null?100:data.bgOpacity)/100;
        ctx.drawImage(_bgImg, wx(_bgx), wy(_bgy), _bgImg.naturalWidth*_bgs*SC, _bgImg.naturalHeight*_bgs*SC);
        ctx.restore();
      }
      results.forEach(function(item){
        var el=item.el,img=item.img,ci=item.ci;
        var _rad=(el.rot||0)*Math.PI/180,_scl=el.scl||1,_lx,_ly;
        ctx.save();
        ctx.translate(wx(el.x),wy(el.y));
        if(el.rot)ctx.rotate(_rad);
        if(el.scl&&el.scl!==1)ctx.scale(el.scl,el.scl);
        var ns=data.nodeScale||1;
        if(el.type==='riser'){
          var rw=(el.riserW||2)*RSCALE*SC,rh=(el.riserH||1)*RSCALE*SC,alt=el.riserAlt||0.4;
          var op=(0.10+(alt/1.2)*0.25).toFixed(2),rfs=Math.max(11,Math.min(18,rw/9));
          _bpRR(ctx,0,0,rw,rh,9*SC);
          ctx.fillStyle='rgba(255,107,26,'+op+')';ctx.fill();
          ctx.strokeStyle='rgba(255,107,26,.45)';ctx.lineWidth=2*SC;ctx.stroke();
          ctx.font='bold '+rfs+'px sans-serif';ctx.fillStyle='#1d3a5f';
          ctx.textAlign='center';ctx.fillText((el.riserW||2)+'m \xd7 '+(el.riserH||1)+'m',rw/2,rh/2+rfs*0.35);
          ctx.font=Math.max(8,9*SC)+'px sans-serif';ctx.fillStyle='#64748b';
          ctx.fillText('⬆ '+alt+'m',rw/2,rh/2+rfs*0.35+12*SC);
          if(el.ch){var rc=allChs.find(function(r){return r.id===el.ch;});if(rc)_vtChBadge(ctx,rc.ch,rw,0,SC);}
          _lx=rw/2;_ly=rh+6*SC;
        } else if(el.type==='kit'){
          /* Reproduit _vintageInnerHTML : header ≈40px (emoji 22px × line-height
             1.2 + padding 8+7), texte CHn coloré sans pastille, lignes 26px. */
          var kitChs=el.chs||[];
          var rows=kitChs.map(function(id){return allChs.find(function(r){return r.id===id;});}).filter(Boolean);
          var kci=BandPlan.getCatInfo('kit');
          var HEAD=40,ROW=26;
          var BW=210*SC,BH=(HEAD+Math.max(1,rows.length)*ROW)*SC;
          /* Boîte blanche arrondie */
          _bpRR(ctx,0,0,BW,BH,12*SC);ctx.fillStyle='#ffffff';ctx.fill();
          /* Fond du header (clippé à la boîte pour garder les coins arrondis) */
          ctx.save();_bpRR(ctx,0,0,BW,BH,12*SC);ctx.clip();
          ctx.fillStyle=kci.color+'12';ctx.fillRect(0,0,BW,HEAD*SC);ctx.restore();
          /* Bordure de la boîte */
          _bpRR(ctx,0,0,BW,BH,12*SC);ctx.strokeStyle=kci.color+'66';ctx.lineWidth=1.5*SC;ctx.stroke();
          /* Séparateur sous le header */
          ctx.strokeStyle=kci.color+'22';ctx.lineWidth=1*SC;
          ctx.beginPath();ctx.moveTo(0,HEAD*SC);ctx.lineTo(BW,HEAD*SC);ctx.stroke();
          /* Icône + label + badge "N CH" */
          ctx.textBaseline='middle';
          ctx.font=Math.round(22*SC)+'px serif';ctx.textAlign='left';ctx.fillStyle='#000';
          ctx.fillText('🥁',9*SC,HEAD*SC/2);
          ctx.font='bold '+Math.round(13*SC)+'px sans-serif';ctx.fillStyle='#1d3a5f';
          ctx.fillText(el.label.slice(0,16),32*SC,HEAD*SC/2);
          if(rows.length){
            var bt=rows.length+' CH';
            ctx.font='bold '+Math.round(9*SC)+'px sans-serif';
            var btw=ctx.measureText(bt).width+11*SC,bth=14*SC,bx=BW-btw-8*SC,by=(HEAD*SC-bth)/2;
            _bpRR(ctx,bx,by,btw,bth,bth/2);ctx.fillStyle=kci.color;ctx.fill();
            ctx.fillStyle='#fff';ctx.textAlign='center';
            ctx.fillText(bt,bx+btw/2,HEAD*SC/2);ctx.textAlign='left';
          }
          /* Lignes des canaux : « CHn » coloré + nom navy */
          rows.forEach(function(r,i){
            var ry=(HEAD+i*ROW)*SC,cy=ry+ROW*SC/2;
            if(i>0){ctx.strokeStyle='#e5eaf2';ctx.lineWidth=1*SC;ctx.beginPath();ctx.moveTo(10*SC,ry);ctx.lineTo(BW-10*SC,ry);ctx.stroke();}
            ctx.font='bold '+Math.round(11*SC)+'px monospace';ctx.fillStyle=kci.color;ctx.textAlign='left';
            ctx.fillText('CH'+r.ch,12*SC,cy);
            ctx.font=Math.round(12*SC)+'px sans-serif';ctx.fillStyle='#1d3a5f';
            ctx.fillText((r.long_name||r.short_name||'—').slice(0,18),46*SC,cy);
          });
          ctx.textBaseline='alphabetic';
        } else if(el.type==='image_frame'){
          var ifW=( el.imgPx||120)*SC,ifH2=Math.max(1,Math.round(ifW/(el.imgAspect||1)));
          if(img){
            ctx.drawImage(img,0,0,ifW,ifH2);
          } else {
            _bpRR(ctx,0,0,ifW,ifH2,6*SC);
            ctx.fillStyle='#e5eaf2';ctx.fill();
            ctx.strokeStyle='#c8d4e0';ctx.lineWidth=2*SC;ctx.stroke();
            ctx.font=Math.round(28*SC)+'px serif';ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillStyle='#94a3b8';ctx.fillText('🖼',ifW/2,ifH2/2);
            ctx.textBaseline='alphabetic';
          }
          _lx=ifW/2;_ly=ifH2+6*SC;
        } else {
          var SZ=120*SC*ns;
          /* Icone ancrée au coin (el.x,el.y) — identique à l'éditeur vintage
             (.bp-vnode : la vignette est au coin, le label centré dessous). */
          _bpRR(ctx,0,0,SZ,SZ,16*SC);
          ctx.fillStyle='#ffffff';ctx.fill();
          ctx.strokeStyle=((ci&&ci.color)||'#c8d4e0')+'66';ctx.lineWidth=1.5*SC;ctx.stroke();
          if(img){ctx.drawImage(img,0,0,SZ,SZ);}
          else{
            ctx.font=Math.round(42*SC*ns)+'px serif';ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillStyle=(ci&&ci.color)||'#5a6580';ctx.fillText((ci&&ci.emoji)||'?',SZ/2,SZ/2);
            ctx.textBaseline='alphabetic';
          }
          /* Badge entrée (CH, orange) ou sortie (OUT, vert) — comme l'éditeur */
          if(el.ch||el.chR){
            var _ic=el.ch?(_chById(el.ch)?_chById(el.ch).ch:'?'):null;
            var _icR=el.chR?(_chById(el.chR)?_chById(el.chR).ch:'?'):null;
            var _it=(_ic!=null?_ic:'')+(_icR!=null?((_ic!=null?'+':'')+_icR):'');
            if(_it!=='')_vtChBadge(ctx,_it,SZ,0,SC);
          } else if(el.outCh||el.outChR){
            var _ot=_bpOutBadgeText(el);
            if(_ot)_vtChBadge(ctx,_ot,SZ,0,SC,{prefix:'OUT ',color:'#22d6a0'});
          }
          _lx=SZ/2;_ly=SZ+6*SC;
        }
        ctx.restore();
        if(_lx!=null){var _wcx=wx(el.x)+(_lx*Math.cos(_rad)-_ly*Math.sin(_rad))*_scl;var _wcy=wy(el.y)+(_lx*Math.sin(_rad)+_ly*Math.cos(_rad))*_scl;_vtLabel(ctx,el.label,_wcx,_wcy,SC,data.textScale||1);}
      });
      cb(cv);
    });
    return;
  }
  /* ── MODERN CANVAS ── */
  // Background
  ctx.fillStyle='#f4f4f4';ctx.fillRect(0,0,cw,ch);
  // Grid
  ctx.strokeStyle='#ddd';ctx.lineWidth=.5;
  for(let x=0;x<2400;x+=40){const sx=wx(x);if(sx>=0&&sx<=cw){ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,ch);ctx.stroke();}}
  for(let y=0;y<1600;y+=40){const sy=wy(y);if(sy>=0&&sy<=ch){ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(cw,sy);ctx.stroke();}}
  // Stage rect
  ctx.strokeStyle='rgba(255,107,26,.28)';ctx.lineWidth=2*SC;ctx.setLineDash([12*SC,6*SC]);
  const rr=(x,y,w2,h2,r)=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w2-r,y);ctx.arcTo(x+w2,y,x+w2,y+r,r);ctx.lineTo(x+w2,y+h2-r);ctx.arcTo(x+w2,y+h2,x+w2-r,y+h2,r);ctx.lineTo(x+r,y+h2);ctx.arcTo(x,y+h2,x,y+h2-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();};
  rr(wx(_stgX),wy(_stgY),_stgW*SC,_stgH*SC,18*SC);
  ctx.fillStyle='rgba(255,107,26,.04)';ctx.fill();ctx.stroke();ctx.setLineDash([]);
  ctx.font='bold '+15*SC+'px sans-serif';ctx.fillStyle='rgba(255,107,26,.18)';ctx.textAlign='center';ctx.letterSpacing=8*SC+'px';
  ctx.fillText('SCENE',wx(1200),wy(Math.round(_stgY+_stgH*0.44)));ctx.letterSpacing='0px';
  // Nodes
  els.slice().sort((a,b)=>a.z-b.z).forEach(el=>{
    ctx.save();
    const tx=wx(el.x),ty=wy(el.y);
    ctx.translate(tx,ty);
    if(el.rot)ctx.rotate(el.rot*Math.PI/180);
    if(el.scl&&el.scl!==1)ctx.scale(el.scl,el.scl);
    if(el.type==='riser'){
      const rw=(el.riserW||2)*RSCALE*SC,rh=(el.riserH||1)*RSCALE*SC;
      const alt=el.riserAlt||0.4;const op=0.25+(alt/1.2)*0.55;
      rr(0,0,rw,rh,7*SC);ctx.fillStyle='rgba(90,100,120,'+op.toFixed(2)+')';ctx.fill();
      ctx.strokeStyle='rgba(100,115,140,.7)';ctx.lineWidth=2*SC;ctx.stroke();
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='bold '+Math.max(18*SC,Math.min(32*SC,rw/6))+'px sans-serif';
      ctx.fillText((el.riserW||2)+'m \xd7 '+(el.riserH||1)+'m',rw/2,rh/2-6*SC);
      ctx.font=Math.round(18*SC)+'px sans-serif';ctx.fillStyle='rgba(255,255,255,.75)';
      ctx.fillText('⬆ '+alt+'m',rw/2,rh/2+26*SC);
    } else if(el.type==='kit'){
      const kitChs=el.chs||[];const rows=kitChs.map(id=>allChs.find(r=>r.id===id)).filter(Boolean);
      const rowH=50*SC,headH=60*SC;
      const BW=280*SC,BH=Math.max(80*SC,rows.length*rowH+headH);
      rr(0,0,BW,BH,14*SC);ctx.fillStyle='#fff';ctx.fill();
      ctx.strokeStyle='rgba(255,77,106,.35)';ctx.lineWidth=2*SC;ctx.stroke();
      ctx.fillStyle='rgba(255,77,106,.1)';ctx.fillRect(0,0,BW,headH);
      ctx.font=Math.round(30*SC)+'px sans-serif';ctx.textAlign='left';ctx.fillText('🥁',10*SC,42*SC);
      ctx.font='bold '+Math.round(22*SC)+'px sans-serif';ctx.fillStyle='#222';ctx.fillText(el.label.slice(0,18),52*SC,36*SC);
      if(rows.length){ctx.font='bold '+Math.round(16*SC)+'px sans-serif';ctx.fillStyle='#ff4d6a';ctx.textAlign='right';ctx.fillText(rows.length+' CH',BW-10*SC,36*SC);}
      rows.forEach((r,i)=>{
        const ry=headH+i*rowH;
        ctx.strokeStyle='rgba(255,107,26,.15)';ctx.lineWidth=.5*SC;
        ctx.beginPath();ctx.moveTo(0,ry);ctx.lineTo(BW,ry);ctx.stroke();
        // CH pill
        const chTxt='CH'+r.ch,chFs=Math.round(18*SC);
        ctx.font='900 '+chFs+'px DM Mono,monospace';
        const cpw=ctx.measureText(chTxt).width+14*SC,cph=26*SC;
        rr(8*SC,ry+7*SC,cpw,cph,cph/2);ctx.fillStyle='#ff6b1a';ctx.fill();
        ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(chTxt,8*SC+cpw/2,ry+7*SC+cph/2);ctx.textBaseline='alphabetic';
        ctx.font=Math.round(16*SC)+'px sans-serif';ctx.fillStyle='#111';ctx.textAlign='left';
        ctx.fillText((r.long_name||r.short_name||'—').slice(0,20),8*SC+cpw+8*SC,ry+rowH*0.65);
      });
    } else {
      const ns=data.nodeScale||1;
      const SZ=120*SC*ns;
      rr(0,0,SZ,SZ,18*SC);
      // Get color from item or fallback
      const _ci=BandPlan.getCatInfo(el.type);
      const nColor=_ci.color;
      ctx.fillStyle=nColor+'18';ctx.fill();
      ctx.strokeStyle=nColor+'55';ctx.lineWidth=2*SC;ctx.stroke();
      const emoji=_ci.emoji;
      ctx.font=(el.type==='txt_bp'?'30':'50')*SC*ns+'px serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#333';
      ctx.fillText(emoji,SZ/2,SZ/2);ctx.textBaseline='alphabetic';
      const ts=data.textScale||1;
      ctx.font='600 '+30*SC*ts+'px sans-serif';ctx.textAlign='center';
      ctx.fillStyle='rgba(255,255,255,.92)';
      const lw=ctx.measureText(el.label).width+22*SC;
      const lh=40*SC*ts;const ly=SZ+8*SC;
      rr((SZ-lw)/2,ly,lw,lh,8*SC);ctx.fill();
      ctx.fillStyle='#111';ctx.fillText(el.label.slice(0,16),SZ/2,ly+28*SC*ts);
      if(el.ch){
        const r2=allChs.find(r=>r.id===el.ch);
        if(r2){
          const chTxt='CH'+r2.ch,chFs=Math.round(22*SC*ns);
          ctx.font='900 '+chFs+'px DM Mono,monospace';
          const cbw=ctx.measureText(chTxt).width+18*SC,cbh=30*SC*ns;
          rr(SZ-cbw+10*SC,-cbh/2,cbw,cbh,cbh/2);
          ctx.fillStyle='#ff6b1a';ctx.fill();
          ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(chTxt,SZ-cbw/2+10*SC,0);
          ctx.textBaseline='alphabetic';
        }
      }
    }
    ctx.restore();
  });
  cb(cv);
}

/* ── Export dropdown helpers — partagés entre toutes les sections ── */
/* Recale un menu déroulant (position:absolute; right:0) pour qu'il tienne dans
   l'écran. Sur mobile, la barre d'outils wrappe : le bouton peut finir à gauche
   ou à droite d'une ligne, et le menu débordait hors de l'écran. */
function _clampMenuToViewport(menu) {
  if (!menu) return;
  menu.style.left = ''; menu.style.right = '';   // reset (utile après resize)
  if (window.innerWidth > 640) return;           // desktop : on garde right:0
  const op = menu.offsetParent;                  // contexte de positionnement réel
  if (!op) return;
  const wrapRect = menu.getBoundingClientRect(); // position actuelle (right:0) du menu
  const opRect = op.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const vw = document.documentElement.clientWidth;
  const margin = 10;
  // Position viewport actuelle bornée à l'écran (ni trop à gauche, ni à droite).
  const vpLeft = Math.max(margin, Math.min(wrapRect.left, vw - mw - margin));
  menu.style.right = 'auto';
  menu.style.left = (vpLeft - opRect.left) + 'px';
}

function toggleExpMenu(menuId, btnId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  /* Fermer tous les menus ouverts (+ nettoyer un éventuel recalage inline) */
  document.querySelectorAll('.exp-menu.open, .sp-export-menu.open').forEach(function(m){ m.classList.remove('open'); m.style.left=''; m.style.right=''; });
  if (!isOpen) { menu.classList.add('open'); _clampMenuToViewport(menu); }
}
function closeExpMenu(menuId) {
  const m = document.getElementById(menuId); if(m) m.classList.remove('open');
}
/* Fermer au clic outside */
document.addEventListener('click', function(e) {
  if (!e.target.closest('.exp-wrap') && !e.target.closest('[id="sp-export"]') && !e.target.closest('.sp-export-menu')) {
    document.querySelectorAll('.exp-menu.open').forEach(function(m){ m.classList.remove('open'); });
  }
});

/* Actions export plan (scène ou site selon le mode actif) */
function _planExpPng() {
  if (PLAN_MODE === 'site') { SitePlan.exportPng(); }
  else { exportBpPng(); }
}
function _planExpPdf() {
  if (PLAN_MODE === 'site') { openPDFModal('site'); }
  else { openPDFModal('stage'); }
}
function _planExpShare() {
  if (PLAN_MODE === 'site') {
    if(!registerShareLink('site')) return;
    const url = _riderBase() + '?view=' + (CUR_SHOW?.id||'') + '&tab=site';
    navigator.clipboard.writeText(url).then(function(){ toast('Lien copié !'); }).catch(function(){ toast(url); });
  } else {
    if(!registerShareLink('stage')) return;
    openBpShare();
  }
}

/* Mise à jour du bouton export plan quand le mode change */
function _updatePlanExpWrap() {
  const wrap = document.getElementById('plan-exp-wrap');
  if (!wrap) return;
  wrap.style.display = '';
  const pngBtn   = document.getElementById('plan-exp-png');
  const pdfBtn   = document.getElementById('plan-exp-pdf');
  const shareBtn = document.getElementById('plan-exp-share');
  if (pngBtn)   pngBtn.firstChild.nextSibling.textContent = PLAN_MODE === 'site' ? 'Plan de site PNG' : 'Plan de scène PNG';
  if (pdfBtn)   pdfBtn.firstChild.nextSibling.textContent = PLAN_MODE === 'site' ? 'Plan de site PDF' : 'Plan de scène PDF';
  if (shareBtn) shareBtn.style.display = PLAN_MODE === 'site' ? 'none' : '';
}

function exportBpPng(){
  if(!BandPlan.getData().els.length){toast('Plan vide — rien a exporter.');return;}
  _makeBpCanvas(cv=>{
    cv.toBlob(blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='plan-scene-'+(CUR_SHOW?.name||'show').replace(/\s/g,'-')+'.png';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
    },'image/png');
  });
}

function openBpPDF(){ openPDFModal('stage'); }
function closeBpPDF(){ closePDF(); }

/* PatchFlow SVG logo — used in all PDF exports */
const _PF_LOGO_MM='<svg width="10mm" height="10mm" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M70 60 C100 60 100 140 130 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round"/><path d="M130 60 C100 60 100 140 70 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round" opacity="0.45"/><circle cx="60" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="60" r="5" fill="#FF6B2B"/><circle cx="140" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="60" r="5" fill="#FF6B2B"/><circle cx="60" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="140" r="5" fill="#FF6B2B"/><circle cx="140" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="140" r="5" fill="#FF6B2B"/></svg>';
const _PF_LOGO_PX='<svg width="34" height="34" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M70 60 C100 60 100 140 130 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round"/><path d="M130 60 C100 60 100 140 70 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round" opacity="0.45"/><circle cx="60" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="60" r="5" fill="#FF6B2B"/><circle cx="140" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="60" r="5" fill="#FF6B2B"/><circle cx="60" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="140" r="5" fill="#FF6B2B"/><circle cx="140" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="140" r="5" fill="#FF6B2B"/></svg>';

function _bpLoadJsPDF(){
  if(window.jspdf&&window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload=function(){resolve(window.jspdf.jsPDF);};
    s.onerror=function(){reject(new Error('jsPDF indisponible'));};
    document.head.appendChild(s);
  });
}

/* Active le partage du show si ce n'est pas déjà fait : l'edge function
   get-shared-show exige une config stage_data.rider pour autoriser l'accès
   public via ?view= / ?rider=. Sans elle, le lien renvoie « Ce show n'a pas
   de lien de partage actif ». On crée une config par défaut (toutes les
   sections, comme le rider builder) sans écraser une config existante. */
async function _ensureShareActive(){
  if(!CUR_SHOW) return false;
  if(CUR_SHOW.stage_data && CUR_SHOW.stage_data.rider) return true;
  var cfg={ sections:['il','out','syno','stage','site'], title:CUR_SHOW.name||'', note:'', info:'', files:[] };
  var sd=Object.assign({}, CUR_SHOW.stage_data||{v:2}, {rider:cfg});
  var {error}=await sb.from('shows').update({stage_data:sd}).eq('id',CUR_SHOW.id);
  if(error){ toast('Erreur activation du partage : '+error.message); return false; }
  CUR_SHOW.stage_data=sd;
  return true;
}
async function openBpShare(){
  if(!CUR_SHOW){ toast('Aucun show sélectionné.'); return; }
  const ok=await _ensureShareActive();
  if(!ok) return;
  const url=_riderBase()+'?view='+(CUR_SHOW.id||'')+'&tab=stage';
  document.getElementById('bp-share-url').value=url;
  document.getElementById('bp-share-copy-ok').style.display='none';
  document.getElementById('bp-share-modal').className='modal-ov show';
}
function closeBpShare(){document.getElementById('bp-share-modal').className='modal-ov';}
async function doCopyShareLink(){
  const url=document.getElementById('bp-share-url').value;
  try{await navigator.clipboard.writeText(url);}catch(e){document.getElementById('bp-share-url').select();document.execCommand('copy');}
  document.getElementById('bp-share-copy-ok').style.display='block';
  setTimeout(()=>{document.getElementById('bp-share-copy-ok').style.display='none';},2500);
}

function openSitePDF(){ openPDFModal('site'); }
function closeSitePDF(){ closePDF(); }
function $i(id){return document.getElementById(id);}

function doSitePlanPDF(){
  const meta={
    title:   ($i('sppdf-title').value.trim()||'Plan de Site'),
    sub:     $i('sppdf-sub').value.trim(),
    venue:   $i('sppdf-venue').value.trim(),
    date:    $i('sppdf-date').value.trim(),
    eng:     $i('sppdf-eng').value.trim(),
    rev:     $i('sppdf-rev').value.trim(),
    notes:   $i('sppdf-notes').value.trim(),
    link:    ($i('sppdf-link')?.value||'').trim(),
    contact: ($i('sppdf-contact')?.value||'').trim()
  };
  closeSitePDF();
  SitePlan.exportCanvas(canvas=>{
    const dataUrl=canvas.toDataURL('image/png');
    const now=new Date().toLocaleString('fr-FR');
    const metaBar=(meta.venue||meta.date||meta.eng||meta.contact)
      ? '<div class="mb">'
        +(meta.venue  ?'<div class="mc"><div class="ml">Venue</div><div class="mv">'+meta.venue+'</div></div>':'')
        +(meta.date   ?'<div class="mc"><div class="ml">Date</div><div class="mv">'+meta.date+'</div></div>':'')
        +(meta.eng    ?'<div class="mc"><div class="ml">Ingenieur</div><div class="mvo">'+meta.eng+'</div></div>':'')
        +(meta.contact?'<div class="mc"><div class="ml">Contact</div><div class="mv">'+meta.contact+'</div></div>':'')
        +'</div>' : '';
    const linkBlock=meta.link
      ? '<div style="display:flex;align-items:center;gap:5mm;padding:2.5mm 10mm;background:#fffbf0;border-bottom:1px solid #ffe0a0;flex-shrink:0">'
        +'<div style="width:6mm;height:6mm;border-radius:50%;background:#ff6b1a;display:flex;align-items:center;justify-content:center;color:#fff;font-size:3.5mm;flex-shrink:0">&#x1F517;</div>'
        +'<div style="flex:1">'
          +'<div style="font-size:2.2mm;text-transform:uppercase;letter-spacing:1px;color:#999;font-family:\'DM Mono\',monospace;margin-bottom:0.8mm">Lien</div>'
          +'<a href="'+meta.link+'" style="font-size:2.8mm;color:#1a6fff;font-family:\'DM Mono\',monospace;word-break:break-all;text-decoration:none">'+meta.link+'</a>'
        +'</div>'
      +'</div>' : '';
    const notesBlock=meta.notes
      ? '<div class="ns"><div class="nl">Notes</div><div class="nt">'+meta.notes+'</div></div>' : '';
    const html='<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>'
      +'<title>'+meta.title+'</title>'
      +'<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>'
      +'<style>'
      +'*{box-sizing:border-box;margin:0;padding:0}'
      +':root{--o:#ff6b1a}'
      +'html,body{width:100%;height:100%}'
      +'body{font-family:Outfit,sans-serif;background:#fff;color:#1a1a2e;display:flex;flex-direction:column;height:100%}'
      +'@page{size:A4 landscape;margin:0}'
      +'.hd{background:#0a0f1c;color:#fff;padding:8mm 10mm 6mm;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}'
      +'.hl{display:flex;align-items:center;gap:8mm}'
      +'.logo{width:10mm;height:10mm;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
      +'.ht{font-size:5.5mm;font-weight:700;line-height:1.2}'
      +'.hs{font-size:3mm;color:#8090a8;font-family:"DM Mono",monospace;margin-top:1mm}'
      +'.hr{text-align:right}'
      +'.hdt{font-size:3mm;font-weight:700;color:var(--o);font-family:"DM Mono",monospace;letter-spacing:1.5px;text-transform:uppercase}'
      +'.hdm{font-size:2.8mm;color:#556;font-family:"DM Mono",monospace;margin-top:0.5mm}'
      +'.mb{display:flex;background:#f4f5f7;border-bottom:1px solid #dde;flex-shrink:0}'
      +'.mc{padding:2.5mm 4mm;border-right:1px solid #dde;display:flex;flex-direction:column;gap:0.5mm}'
      +'.mc:last-child{border-right:none}'
      +'.ml{font-size:2.2mm;color:#aaa;text-transform:uppercase;letter-spacing:.8px;font-family:"DM Mono",monospace}'
      +'.mv{font-size:3mm;color:#333;font-weight:500;font-family:"DM Mono",monospace}'
      +'.mvo{font-size:3mm;color:var(--o);font-weight:600;font-family:"DM Mono",monospace}'
      +'.plan{flex:1;display:flex;align-items:center;justify-content:center;padding:4mm 6mm;overflow:hidden;min-height:0}'
      +'.plan img{max-width:100%;max-height:100%;object-fit:contain}'
      +'.ns{padding:2.5mm 10mm;background:#fffbf7;border-top:1px solid #ffe0c8;flex-shrink:0}'
      +'.nl{font-family:"DM Mono",monospace;font-size:2.5mm;text-transform:uppercase;letter-spacing:1px;color:#ccc;margin-bottom:1mm}'
      +'.nt{font-size:3mm;color:#555;white-space:pre-wrap}'
      +'.ft{display:flex;align-items:center;justify-content:space-between;padding:2mm 10mm;border-top:1px solid #eee;font-size:2.5mm;color:#bbb;font-family:"DM Mono",monospace;flex-shrink:0;background:#fafafa}'
      +'.fl{font-weight:700;color:var(--o);letter-spacing:1px}'
      +'@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
      +'</style></head><body>'
      +'<div class="hd">'
        +'<div class="hl"><div class="logo">'+_PF_LOGO_MM+'</div><div><div class="ht">'+meta.title+'</div>'+(meta.sub?'<div class="hs">'+meta.sub+'</div>':'')+'</div></div>'
        +'<div class="hr"><div class="hdt">Plan de Site</div><div class="hdm">'+(meta.rev?'Rev. '+meta.rev+' &nbsp;&middot;&nbsp; ':'')+now+'</div></div>'
      +'</div>'
      +linkBlock
      +metaBar
      +'<div class="plan"><img src="'+dataUrl+'" alt="Plan de site"/></div>'
      +notesBlock
      +'<div class="ft"><span class="fl">PATCHFLOW</span><span>'+meta.title+(meta.sub?' &middot; '+meta.sub:'')+'</span><span>'+now+'</span></div>'
      +'<script>window.onload=()=>window.print();<\/script>'
      +'</body></html>';
    const w=window.open('','_blank');
    if(!w){alert('Autorisez les popups pour generer le PDF');return;}
    w.document.write(html);
    w.document.close();
  });
}
function _buildPdfRecapBlock(rows,accentColor){
  // Build counts from rows
  var mics={},stands={};
  rows.forEach(function(r){
    var m=(r.mic||'').trim(); if(m) mics[m]=(mics[m]||0)+1;
    var s=(r.note||'').trim(); if(s) stands[s]=(stands[s]||0)+1;
  });
  var micEntries=Object.keys(mics).sort(function(a,b){return mics[b]-mics[a];});
  var standEntries=Object.keys(stands).sort(function(a,b){return stands[b]-stands[a];});
  if(!micEntries.length&&!standEntries.length) return '';
  var col=accentColor||'#ff6b1a';
  function tableRows(map,entries){
    if(!entries.length) return '<tr><td colspan="2" style="color:#aaa;font-style:italic;font-size:8px">Aucun</td></tr>';
    return entries.map(function(k){
      return '<tr><td style="padding:2px 0;color:#333;border-bottom:1px solid #f0ede8">'+k+'</td>'
        +'<td style="padding:2px 0 2px 8px;text-align:right;font-weight:800;color:'+col+';border-bottom:1px solid #f0ede8;font-family:\'DM Mono\',monospace">'+map[k]+'</td></tr>';
    }).join('');
  }
  var totalMics=micEntries.reduce(function(s,k){return s+mics[k];},0);
  var totalStands=standEntries.reduce(function(s,k){return s+stands[k];},0);
  return '<div style="padding:6px 16px;border-top:2px solid '+col+';background:#fffbf7">'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:7.5px;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:6px">Recapitulatif materiels</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">'
    +'<div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:'+col+';margin-bottom:4px;display:flex;justify-content:space-between">'
        +'<span>Micros &amp; DI</span><span style="font-weight:800">'+totalMics+' total</span>'
      +'</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:9px">'+tableRows(mics,micEntries)+'</table>'
    +'</div>'
    +'<div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:'+col+';margin-bottom:4px;display:flex;justify-content:space-between">'
        +'<span>Pieds de micro</span><span style="font-weight:800">'+totalStands+' total</span>'
      +'</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:9px">'+tableRows(stands,standEntries)+'</table>'
    +'</div>'
    +'</div>'
  +'</div>';
}

async function doPDF(){
  const type = _pdfExportType;
  const $v = id => (document.getElementById(id)?.value||'').trim();
  const brand = _pdfBrand();

  // Shared meta — common to ALL export types
  const meta = {
    eng:   $v('pdf-eng'),
    role:  $v('pdf-role'),
    title: $v('pdf-title'),
    co:    $v('pdf-co'),
    tel:   $v('pdf-tel'),
    venue: $v('pdf-venue'),
    date:  $v('pdf-date'),
    rev:   $v('pdf-rev'),
    notes: $v('pdf-notes'),
    sub:   $v('pdf-sub'),  // sous-titre pour plans visuels
  };

  closePDF();

  /* ── Visual plans — image-based exports ── */
  if(type === 'stage'){
    /* Le module live peut être désynchronisé (scènes) : si BandPlan rapporte
       vide, retomber sur la scène active puis sur stage_data.band avant
       d'abandonner. */
    var _live=BandPlan.getData();
    if(!_live.els.length){
      var _bd=null;
      if(typeof canDo!=='undefined' && canDo('multi_scenes') && CUR_SCENES.stage && SHOW_SCENES.stage){
        var _ss=SHOW_SCENES.stage.find(function(s){return s.id===CUR_SCENES.stage;});
        _bd=_ss&&_ss.data&&_ss.data.band||null;
      }
      if(!(_bd&&_bd.els&&_bd.els.length)) _bd=CUR_SHOW?.stage_data?.band||null;
      if(_bd&&_bd.els&&_bd.els.length){ BandPlan.load(_bd); _live=BandPlan.getData(); }
    }
    if(!_live.els.length){
      var _saved=(CUR_SHOW&&CUR_SHOW.stage_data&&CUR_SHOW.stage_data.band&&CUR_SHOW.stage_data.band.els&&CUR_SHOW.stage_data.band.els.length)||0;
      toast('Plan de scène vide (live:0 · sauvé:'+_saved+' · scène:'+(CUR_SCENES.stage||'-')+')');
      return;
    }
    await _ensureShareActive(); /* activer le partage (rider) AVANT de générer le lien/QR — sinon « pas de lien actif » */
    _makeBpCanvas(function(cv){
      try{
        if(!cv){toast('Plan de scène : canvas vide.');return;}
        var dataUrl;
        try{ dataUrl=cv.toDataURL('image/png'); }
        catch(corsErr){ toast('Erreur export (image CORS) : '+corsErr.message); console.error('stage pdf toDataURL:',corsErr); return; }
        const shareUrl=_riderBase()+'?view='+(CUR_SHOW?.id||'')+'&tab=stage';
        _openVisualPdf('Plan de scene', meta, dataUrl, shareUrl, brand, {orientation:_pdfOrient}).catch(function(e){toast('Erreur PDF : '+e.message);console.error('_openVisualPdf:',e);});
      }catch(e){toast('Erreur export PDF : '+e.message);console.error('stage pdf cb:',e);}
    });
    return;
  }
  if(type === 'site'){
    /* S'assurer que SitePlan est chargé (stage_data.site ou scène active) */
    if(!SitePlan.hasContent()){
      var _s2=CUR_SHOW?.stage_data?.site||null;
      if(!_s2&&SHOW_SCENES.site&&SHOW_SCENES.site.length){var _sc2=SHOW_SCENES.site.find(function(s){return s.id===CUR_SCENES.site;});_s2=_sc2&&_sc2.data&&_sc2.data.site||null;}
      if(_s2) SitePlan.load(_s2);
    }
    await _ensureShareActive(); /* activer le partage (rider) AVANT de générer le lien/QR */
    SitePlan.exportCanvas(function(cv){
      try{
        if(!cv){toast('Plan de site vide — rien à exporter.');return;}
        var dataUrl;
        try{ dataUrl=cv.toDataURL('image/png'); }
        catch(corsErr){ toast('Erreur export (image CORS) : '+corsErr.message); console.error('site pdf toDataURL:',corsErr); return; }
        const shareUrl=_riderBase()+'?view='+(CUR_SHOW?.id||'')+'&tab=site';
        _openVisualPdf('Plan de site', meta, dataUrl, shareUrl, brand, {orientation:_pdfOrient}).catch(function(e){toast('Erreur PDF : '+e.message);console.error('_openVisualPdf:',e);});
      }catch(e){toast('Erreur export PDF : '+e.message);console.error('site pdf cb:',e);}
    });
    return;
  }
  if(type === 'syno'){
    /* Build SVG snapshot inline */
    const synEl = document.getElementById('sp-world');
    if(!synEl||!synEl.children.length){toast('Synoptique vide — rien à exporter.');return;}
    const svgEl = document.getElementById('sp-edges');
    const synHtml = (svgEl?svgEl.outerHTML:'') + synEl.innerHTML;
    await _ensureShareActive(); /* activer le partage (rider) AVANT de générer le lien/QR */
    const shareUrl = _riderBase()+'?view='+(CUR_SHOW?.id||'')+'&tab=syno';
    _openSynoPdf(meta, synHtml, shareUrl, brand);
    return;
  }

  /* ── Table-based (Input / Output / Both) ── */
  const _inclLink  = document.getElementById('pdf-incl-link')?.checked !== false;
  const _inclRecap = document.getElementById('pdf-incl-recap')?.checked === true;
  if(_inclRecap && !canDo('recap_matos')){showUpgradeModal('recap_matos');return;}
  /* Le lien/QR intégré au PDF doit pointer vers la vue correspondant AU document
     exporté. Avant : on lisait toujours slink-url, figé sur ?tab=il → le QR d'une
     Output List ouvrait l'Input List (« on ne voit que l'input »). On construit
     donc l'URL selon le type :
       - out  → onglets Output + Input, Output actif
       - both → onglets Input + Output, Input actif
       - in   → Input seul (comportement d'origine) */
  if(_inclLink) await _ensureShareActive(); /* activer le partage (rider) AVANT de générer le lien/QR */
  var _slBase = _riderBase()+'?view='+(CUR_SHOW?.id||'');
  const _shareUrl = !_inclLink ? ''
    : type==='out'  ? _slBase+'&sections=out,il'
    : type==='both' ? _slBase+'&sections=il,out'
    :                 _slBase+'&tab=il';
  const _accentColor = brand.color||'#ff6b1a';
  const recapHtml = _inclRecap ? _buildPdfRecapBlock(CHS, _accentColor) : '';
  meta.shareLink = _shareUrl;
  meta.recapHtml = recapHtml;
  const html = type==='both' ? _buildPdfBothHTML(meta,brand)
             : type==='out'  ? _buildPdfOutHTML(meta,brand)
             :                 _buildPdfInHTML(meta,brand);
  const w = window.open('','_blank','width=1100,height=750');
  if(!w){alert('Autorisez les popups');return;}
  w.document.write(html); w.document.close();
}

/* Shared visual PDF (stage / site) — full-page landscape image */
/* ── Bloc QR + lien partagé par TOUS les exports PDF (le plus important) ──
   Reprend le style de l'Input List : QR code bleu + lien + sous-texte. */
function _pdfQrFooterHtml(shareUrl){
  if(!shareUrl) return '';
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data='
    + encodeURIComponent(shareUrl) + '&color=1a8fff&bgcolor=f4faff&margin=0&qzone=1';
  return '<div class="qrft">'
    + '<img class="qrimg" src="' + qr + '" alt="QR"/>'
    + '<div class="qrtx">'
      + '<div class="qrlbl">Fiche à jour en ligne</div>'
      + '<a class="qrlink" href="' + shareUrl + '">' + shareUrl + '</a>'
      + '<div class="qrsub">Scannez le QR code ou ouvrez le lien pour retrouver cette fiche à jour à tout moment.</div>'
    + '</div>'
  + '</div>';
}
/* CSS commun du bloc QR (à inclure dans le <style> de chaque PDF) */
const _PDF_QR_CSS =
  '.qrft{display:flex;align-items:center;gap:3.5mm;padding:2mm 10mm;background:#f4faff;border-top:2px solid #1a8fff;flex-shrink:0}'
  +'.qrimg{width:12mm;height:12mm;flex-shrink:0;border-radius:1.5mm}'
  +'.qrtx{display:flex;flex-direction:column;gap:0.3mm;min-width:0}'
  +'.qrlbl{font-family:"DM Mono",monospace;font-size:2.2mm;text-transform:uppercase;letter-spacing:1px;color:#1a8fff;font-weight:600}'
  +'.qrlink{font-size:2.8mm;color:#1a4fff;font-family:"DM Mono",monospace;word-break:break-all;text-decoration:none;font-weight:600}'
  +'.qrsub{font-size:2.2mm;color:#7a8a9a;font-family:"DM Mono",monospace}';

/* hex (#rrggbb / #rgb) → [r,g,b] pour jsPDF */
function _hex2rgb(hex){
  hex=(hex||'').replace('#','');
  if(hex.length===3) hex=hex.split('').map(function(c){return c+c;}).join('');
  var n=parseInt(hex,16);
  if(isNaN(n)||hex.length!==6) return [255,107,26];
  return [(n>>16)&255,(n>>8)&255,n&255];
}
/* Charge une URL image (ex. QR distant) en data URL PNG. null si échec/CORS. */
function _loadImgDataUrl(url){
  return new Promise(function(resolve){
    var img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){
      try{
        var cv=document.createElement('canvas');
        cv.width=img.naturalWidth||img.width; cv.height=img.naturalHeight||img.height;
        cv.getContext('2d').drawImage(img,0,0);
        resolve({dataUrl:cv.toDataURL('image/png'),w:cv.width,h:cv.height});
      }catch(e){ resolve(null); }
    };
    img.onerror=function(){ resolve(null); };
    img.src=url;
  });
}
/* Rasterise une chaîne SVG en PNG (pour le synoptique). null si échec. */
function _svgStrToPng(svgStr,scale){
  scale=scale||2;
  return new Promise(function(resolve){
    var blob=new Blob([svgStr],{type:'image/svg+xml;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var img=new Image();
    img.onload=function(){
      var w=img.naturalWidth||img.width||1600, h=img.naturalHeight||img.height||1131;
      var cv=document.createElement('canvas');
      cv.width=Math.round(w*scale); cv.height=Math.round(h*scale);
      var ctx=cv.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
      ctx.drawImage(img,0,0,cv.width,cv.height);
      URL.revokeObjectURL(url);
      resolve({dataUrl:cv.toDataURL('image/png'),w:cv.width,h:cv.height});
    };
    img.onerror=function(){ URL.revokeObjectURL(url); resolve(null); };
    img.src=url;
  });
}
/* Dimensions intrinsèques d'une data URL image. */
function _imgRatio(dataUrl){
  return new Promise(function(resolve){
    var i=new Image();
    i.onload=function(){ resolve((i.naturalWidth||i.width)/(i.naturalHeight||i.height)||(297/210)); };
    i.onerror=function(){ resolve(297/210); };
    i.src=dataUrl;
  });
}

/* Logo PatchFlow (marque seule) en SVG, rastérisé en PNG pour l'en-tête PDF. */
function _pfLogoSvg(color){
  color = color || '#FF6B2B';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">'
    +'<path d="M70 60 C100 60 100 140 130 140" fill="none" stroke="'+color+'" stroke-width="14" stroke-linecap="round"/>'
    +'<path d="M130 60 C100 60 100 140 70 140" fill="none" stroke="'+color+'" stroke-width="14" stroke-linecap="round" opacity="0.45"/>'
    +'<circle cx="60" cy="60" r="14" fill="none" stroke="'+color+'" stroke-width="10"/><circle cx="60" cy="60" r="5" fill="'+color+'"/>'
    +'<circle cx="140" cy="60" r="14" fill="none" stroke="'+color+'" stroke-width="10"/><circle cx="140" cy="60" r="5" fill="'+color+'"/>'
    +'<circle cx="60" cy="140" r="14" fill="none" stroke="'+color+'" stroke-width="10"/><circle cx="60" cy="140" r="5" fill="'+color+'"/>'
    +'<circle cx="140" cy="140" r="14" fill="none" stroke="'+color+'" stroke-width="10"/><circle cx="140" cy="140" r="5" fill="'+color+'"/></svg>';
}
async function _pfLogoPng(color){
  try{
    var svg=_pfLogoSvg(color);
    var url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
    var img=await new Promise(function(res,rej){ var im=new Image(); im.onload=function(){res(im);}; im.onerror=rej; im.src=url; });
    var cv=document.createElement('canvas'); cv.width=200; cv.height=200;
    cv.getContext('2d').drawImage(img,0,0,200,200);
    URL.revokeObjectURL(url);
    return cv.toDataURL('image/png');
  }catch(e){ return null; }
}

/* Génère et TÉLÉCHARGE directement un PDF A4 (paysage/portrait) du plan visuel
   (plan de scène, plan de site, synoptique) — plus de popup ni d'impression. */
async function _openVisualPdf(docType, meta, dataUrl, shareUrl, brand, opts){
  opts = opts || {};
  const inlineSvg = !!opts.inlineSvg;
  toast('Génération PDF…');
  try {
    const JsPDF = await _bpLoadJsPDF();

    /* Image du plan : raster direct (scène/site) ou SVG rasterisé (synoptique) */
    let planImg, ratio;
    if(inlineSvg){
      const r = await _svgStrToPng(dataUrl, 1.6);
      if(!r){ toast('Impossible de générer le PDF du synoptique.'); return; }
      planImg = r.dataUrl; ratio = r.w/r.h;
    } else {
      planImg = dataUrl;
      ratio = await _imgRatio(dataUrl);
    }

    /* Orientation choisie par l'utilisateur (paysage par défaut). */
    const orientation = (opts.orientation==='portrait') ? 'portrait' : 'landscape';
    const doc = new JsPDF({orientation, unit:'mm', format:'a4'});
    const PW = orientation==='portrait' ? 210 : 297;
    const PH = orientation==='portrait' ? 297 : 210;
    const now = new Date().toLocaleString('fr-FR');
    const acc = _hex2rgb(_safeColor(brand.color)||'#ff6b1a');
    /* Titre mis en avant. Le nom interne du show n'est PLUS injecté ici :
       si aucun titre n'est saisi, on retombe sur le type de document. */
    const title = String(meta.title||docType).slice(0,60);
    const sub   = String(meta.sub||'').slice(0,90);
    const eng   = [meta.eng, meta.role].filter(Boolean).join(' — ');

    /* Logo PatchFlow rastérisé (best-effort) — réutilisé en-tête + pied. */
    let _pfLogo=null; try{ _pfLogo = await _pfLogoPng('#FF6B2B'); }catch(e){ _pfLogo=null; }

    /* ── Header sombre — logo + titre en grand ── */
    const HDR=21;
    doc.setFillColor(10,15,28); doc.rect(0,0,PW,HDR,'F');
    doc.setFillColor(acc[0],acc[1],acc[2]); doc.rect(0,HDR,PW,0.9,'F');
    let LX=10;
    if(_pfLogo){ try{ doc.addImage(_pfLogo,'PNG',10,5.6,10,10); LX=24; }catch(e){ LX=10; } }
    /* Marque / société (petit, au-dessus du titre) */
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(acc[0],acc[1],acc[2]);
    doc.text((brand.co||'PatchFlow').toUpperCase(), LX, 8.2);
    /* Type de doc + horodatage (à droite) */
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(acc[0],acc[1],acc[2]);
    doc.text(String(docType).toUpperCase(),PW-10,8.2,{align:'right'});
    doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(122,138,160);
    doc.text((meta.rev?'Rev. '+meta.rev+'  ·  ':'')+now,PW-10,12.8,{align:'right'});
    /* Titre — grand, auto-réduit s'il déborde de la place dispo */
    let tFs=18; doc.setFont('helvetica','bold');
    const titleMaxW = PW - LX - 44; /* marge gauche (logo+texte) + réserve droite (type/date) */
    doc.setFontSize(tFs);
    while(tFs>11 && doc.getTextWidth(title) > titleMaxW){ tFs-=1; doc.setFontSize(tFs); }
    doc.setTextColor(255,255,255);
    doc.text(title, LX, sub?14.4:16.2);
    if(sub){ doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(150,165,190); doc.text(sub, LX, 18.4); }

    /* ── Barre méta ── */
    let y=HDR+0.8;
    const mItems=[];
    if(meta.venue) mItems.push(['Venue',meta.venue]);
    if(meta.date)  mItems.push(['Date',meta.date]);
    if(eng)        mItems.push(['Créateur',eng]);
    if(meta.co)    mItems.push(['Société',meta.co]);
    if(mItems.length){
      const MB=8.5;
      doc.setFillColor(247,248,250); doc.rect(0,y,PW,MB,'F');
      doc.setDrawColor(230,232,236); doc.setLineWidth(0.2); doc.line(0,y+MB,PW,y+MB);
      const cw=PW/mItems.length;
      mItems.forEach(function(it,i){
        const cx=i*cw+6;
        if(i>0){ doc.setDrawColor(230,232,236); doc.line(i*cw,y+1.5,i*cw,y+MB-1.5); }
        doc.setFontSize(5.5); doc.setFont('helvetica','normal'); doc.setTextColor(160,160,160);
        doc.text(it[0].toUpperCase(),cx,y+3.4);
        doc.setFontSize(7.5); doc.setFont('helvetica','bold');
        if(it[0]==='Créateur') doc.setTextColor(acc[0],acc[1],acc[2]); else doc.setTextColor(51,51,51);
        doc.text(String(it[1]).slice(0,38),cx,y+6.8);
      });
      y+=MB;
    }

    /* ── Zone image (maximisée, centrée, ratio préservé) — chrome resserré
       pour laisser le plan le plus grand possible ── */
    const hasQr = !!shareUrl;
    const QRH = hasQr?18:0;
    const notesLines = meta.notes ? doc.splitTextToSize(String(meta.notes), PW-20) : [];
    const notesH = meta.notes ? Math.min(16, 6+notesLines.length*3) : 0;
    const PAD=2;
    const availH = PH - y - QRH - notesH - PAD*2;
    const availW = PW - PAD*2;
    let drawW=availW, drawH=availW/ratio;
    if(drawH>availH){ drawH=availH; drawW=availH*ratio; }
    const ix=(PW-drawW)/2, iy=y+PAD;
    /* compression 'FAST' (zlib) : indispensable, sinon le PNG d'un grand canvas
       gonfle le PDF à plusieurs dizaines de Mo */
    doc.addImage(planImg,'PNG',ix,iy,drawW,drawH,undefined,'FAST');
    /* Cadre fin autour du plan (rendu pro) */
    doc.setDrawColor(208,214,222); doc.setLineWidth(0.3); doc.rect(ix,iy,drawW,drawH);

    /* ── Notes ── */
    if(meta.notes){
      const ny=PH-QRH-notesH;
      doc.setFillColor(255,251,247); doc.rect(0,ny,PW,notesH,'F');
      doc.setDrawColor(255,224,200); doc.setLineWidth(0.2); doc.line(0,ny,PW,ny);
      doc.setFontSize(5.5); doc.setFont('helvetica','bold'); doc.setTextColor(200,160,120);
      doc.text('NOTES',10,ny+3.4);
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(85,85,85);
      doc.text(notesLines,10,ny+6.6);
    }

    /* ── Footer QR + lien partagé + marque PatchFlow ── */
    if(hasQr){
      const fy=PH-QRH;
      doc.setFillColor(244,250,255); doc.rect(0,fy,PW,QRH,'F');
      doc.setFillColor(26,143,255); doc.rect(0,fy,PW,0.5,'F');
      const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data='+encodeURIComponent(shareUrl);
      const qr=await _loadImgDataUrl(qrUrl);
      let tx=10;
      /* QR centré verticalement dans le pied → plus de débordement/crop */
      const qrSize=13, qy=fy+(QRH-qrSize)/2;
      if(qr){ doc.addImage(qr.dataUrl,'PNG',10,qy,qrSize,qrSize); tx=10+qrSize+5; }
      doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(26,143,255);
      doc.text('FICHE À JOUR EN LIGNE',tx,fy+6);
      doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(26,79,255);
      const lnk=String(shareUrl).slice(0,88);
      if(doc.textWithLink){ doc.textWithLink(lnk,tx,fy+10.5,{url:shareUrl}); } else { doc.text(lnk,tx,fy+10.5); }
      doc.setFontSize(5.5); doc.setFont('helvetica','normal'); doc.setTextColor(122,138,154);
      doc.text('Scannez le QR code ou ouvrez le lien pour retrouver cette fiche à jour à tout moment.',tx,fy+14.2);
      /* Marque PatchFlow à droite du pied (logo + wordmark) */
      const wm='patchflow.fr', wmY=fy+QRH/2+1;
      doc.setFontSize(7); doc.setFont('helvetica','bold');
      const wmW=doc.getTextWidth(wm);
      if(_pfLogo){ try{ doc.addImage(_pfLogo,'PNG',PW-10-wmW-9,fy+(QRH-7)/2,7,7); }catch(e){} }
      doc.setTextColor(26,143,255); doc.text(wm,PW-10,wmY,{align:'right'});
    }

    /* ── Filigrane plan Gratuit ── */
    if(brand.watermark){
      try{ if(doc.setGState) doc.setGState(new doc.GState({opacity:0.07})); }catch(e){}
      doc.setTextColor(60,70,90); doc.setFont('helvetica','bold'); doc.setFontSize(46);
      doc.text('PATCHFLOW · GRATUIT', PW/2, PH/2, {align:'center', angle:28});
      try{ if(doc.setGState) doc.setGState(new doc.GState({opacity:1})); }catch(e){}
    }

    const slug=function(s){return String(s||'').replace(/[^a-z0-9]/gi,'-').replace(/-+/g,'-').toLowerCase().replace(/^-|-$/g,'');};
    doc.save((slug(title)||'plan')+'-'+(slug(docType)||'document')+'.pdf');
    toast('✓ PDF téléchargé');
  } catch(e){
    console.error('_openVisualPdf:',e);
    toast('Erreur PDF : '+(e&&e.message||e));
  }
}

/* Synoptique PDF — SVG inline pour préserver les câbles, flèches et marqueurs.
   Quand on injecte un SVG via <img src="data:image/svg+xml...">, les marqueurs
   (flèches) et parfois les paths internes ne s'affichent pas correctement à
   l'impression (sandboxing). Solution : rendre le SVG en INLINE dans le HTML. */
function _openSynoPdf(meta, synHtml, shareUrl, brand){
  if(!window.SynPro || !SynPro.buildExportSvg){
    toast('Module synoptique indisponible.');return;
  }
  let ex;
  try { ex = SynPro.buildExportSvg({skipHeader:true}); }
  catch(e){ toast('Erreur synoptique : '+e.message);return; }
  if(!ex || !ex.svg){toast('Synoptique vide ou non chargé.');return;}

  /* On passe le SVG STRING directement (pas un data URI) au visual PDF.
     _openVisualPdf détecte le préfixe '<svg' et l'inline dans la page. */
  _openVisualPdf('Synoptique', meta, ex.svg, shareUrl, brand, {bigPlan:true, inlineSvg:true, orientation:_pdfOrient});
}

// ══════════════════════════════════════
// CODA AMPS — per show, persisted in Supabase
// ══════════════════════════════════════
const DEFAULT_AMPS=[
  {name:'LINUS14D #1',model:'Linus14D',chs:['Main L','Main R','Sub L','Sub R'],position:0},
  {name:'LINUS10 #1',model:'Linus10',chs:['Side L','Side R','Fill L','Fill R'],position:1},
];

async function loadAmps(){
  CODA_AMPS=[];
  const {data,error}=await sb.from('coda_amps').select('*').eq('show_id',CUR_SHOW.id).order('position');
  if(error){console.error('loadAmps:',error);CODA_AMPS=DEFAULT_AMPS.map((a,i)=>({...a,id:'def'+i,show_id:CUR_SHOW.id}));return;}
  if(!data||data.length===0){
    /* Première fois : valeurs par défaut EN MÉMOIRE uniquement (id 'def…').
       On n'insère pas : la colonne réelle est `channels` (pas `chs`), ces
       défauts ne sont jamais persistés (saveAmp ignore les id 'def'), et la
       fonctionnalité est héritée. Évite un 400 et des écritures inutiles. */
    CODA_AMPS=DEFAULT_AMPS.map((a,i)=>({...a,id:'def'+i,show_id:CUR_SHOW.id}));
  } else {
    // Mapping colonne DB `channels` → `chs` utilisé côté client.
    CODA_AMPS=data.map(a=>({...a,chs:a.chs||a.channels||[]}));
  }
  // Legacy CODA amps : no longer linked to synoptique. Kept for future use.
}

async function saveAmp(idx){
  const amp=CODA_AMPS[idx];if(!amp||!amp.id||amp.id.startsWith('def'))return;
  await sb.from('coda_amps').update({name:amp.name,channels:amp.chs,position:idx}).eq('id',amp.id);
}

async function addAmp(){
  const M=['Linus14D','Linus10','Linus12C','LinusLIVE'];
  const m=M[CODA_AMPS.length%M.length];
  const newAmp={show_id:CUR_SHOW.id,name:`${m} #${Math.ceil((CODA_AMPS.length+1)/M.length)}`,model:m,channels:['—','—','—','—'],position:CODA_AMPS.length};
  const {data,error}=await sb.from('coda_amps').insert(newAmp).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  CODA_AMPS.push({...data,chs:data.channels||['—','—','—','—']});
}

async function delAmp(idx){
  const amp=CODA_AMPS[idx];
  CODA_AMPS.splice(idx,1);
  if(amp.id&&!amp.id.startsWith('def')) await sb.from('coda_amps').delete().eq('id',amp.id);
}

// ══════════════════════════════════════
// STAGE PLAN — persisted in shows.stage_data
// ══════════════════════════════════════
let _stageReady=false;   // true after loadStage() has run for the current show
let _saveChsTimer=null;
function _saveChsSnapshot(){
  // Only update the chs field — never touch band/site data before stage is loaded
  if(!CUR_SHOW||!_stageReady)return;
  clearTimeout(_saveChsTimer);
  _saveChsTimer=setTimeout(function(){
    if(!CUR_SHOW)return;
    const chsSnap=(typeof CHS!=='undefined'?CHS:[]).map(function(r){return{id:r.id,ch:r.ch,short_name:r.short_name||'',long_name:r.long_name||'',source:r.source||'',mic:r.mic||'',phantom:!!r.phantom,foh:!!r.foh,mon:!!r.mon,note:r.note||''};});
    const sd=Object.assign({},CUR_SHOW.stage_data||{v:2},{chs:chsSnap});
    CUR_SHOW.stage_data=sd;
    sb.from('shows').update({stage_data:sd}).eq('id',CUR_SHOW.id);
  },1500);
}
function loadStage(){
  _stageReady=false;
  /* Si des scènes existent (show créé par un propriétaire Studio), on lit
     TOUJOURS depuis elles — y compris pour un membre non-Studio — car c'est là
     que vivent les plans. Sinon (show legacy / propriétaire non-Studio), on lit
     stage_data. On ne dépend donc PAS du plan du lecteur. */
  if(CUR_SCENES.stage||CUR_SCENES.site){
    // Charger depuis les scènes (avec fallback migration paresseuse)
    const stageScene=SHOW_SCENES.stage?.find(s=>s.id===CUR_SCENES.stage);
    const siteScene=SHOW_SCENES.site?.find(s=>s.id===CUR_SCENES.site);
    const stageData=_firstSceneFallback('stage', stageScene?.data??null);
    const siteData =_firstSceneFallback('site',  siteScene?.data??null);
    BandPlan.load(stageData?.band??null);
    SitePlan.load(siteData?.site??null);
    // Déterminer quel plan afficher (utiliser le plan mode sauvegardé du show)
    const raw=CUR_SHOW?.stage_data;
    const savedMode=(raw&&raw.planMode)||'scene';
    setPlanMode(savedMode,false);
  } else {
    // Non-studio ou pas encore de scènes : comportement original
    const raw=CUR_SHOW?.stage_data;
    let bandData=null,siteData=null,savedMode='scene';
    if(raw&&raw.v>=2){bandData=raw.band||null;siteData=raw.site||null;savedMode=raw.planMode||'scene';}
    BandPlan.load(bandData);
    SitePlan.load(siteData);
    setPlanMode(savedMode,false);
  }
  /* Réinitialise l'historique d'annulation pour ce show/scène. */
  if(typeof SectionUndo!=='undefined'){ SectionUndo.reset('stage', BandPlan.getData()); SectionUndo.reset('site', SitePlan.getData()); }
  _stageReady=true;
}

let saveStageTimer=null;
/* ══════════════════════════════════════
   ANNULER (Ctrl+Z) — réservé Pro
   Historique par section (plan de scène / plan de site / synoptique).
   On enregistre un instantané APRÈS chaque sauvegarde ; annuler restaure
   l'instantané précédent. Données sérialisables via getData()/load().
   ══════════════════════════════════════ */
const SectionUndo = {
  stacks:{}, _restoring:false, MAX:50,
  isPro(){ try{ return userPlan()==='pro'; }catch(e){ return false; } },
  reset(key, snap){ try{ this.stacks[key]=[JSON.stringify(snap)]; }catch(e){ this.stacks[key]=[]; } this._sync(key); },
  record(key, getSnap){
    if(this._restoring || !this.isPro()) return;
    var st=this.stacks[key]||(this.stacks[key]=[]);
    var s; try{ s=JSON.stringify(getSnap()); }catch(e){ return; }
    if(!s) return;
    if(st.length && st[st.length-1]===s) return; /* pas de doublon */
    st.push(s);
    if(st.length>this.MAX+1) st.shift();
    this._sync(key);
  },
  canUndo(key){ return this.isPro() && (this.stacks[key]||[]).length>1; },
  undo(key, restoreFn){
    if(!this.canUndo(key)) return false;
    var st=this.stacks[key]; st.pop();              /* retire l'état courant */
    var prev; try{ prev=JSON.parse(st[st.length-1]); }catch(e){ return false; }
    this._restoring=true;
    try{ restoreFn(prev); }catch(e){ console.error('[undo]',e); }
    this._restoring=false;
    this._sync(key);
    return true;
  },
  _sync(key){
    var pro=this.isPro(), can=this.canUndo(key);
    document.querySelectorAll('[data-undo="'+key+'"]').forEach(function(btn){
      btn.style.display = pro ? '' : 'none';
      btn.disabled = !can;
      btn.style.opacity = can ? '' : '.4';
    });
  }
};
const _UNDO_ADAPTERS = {
  stage:{ visible(){ return document.getElementById('plan-scene-wrap') && document.getElementById('plan-scene-wrap').offsetParent!==null; },
          restore(d){ d.view=BandPlan.getData().view; BandPlan.load(d); saveStage(); } },
  site: { visible(){ return document.getElementById('plan-site-wrap') && document.getElementById('plan-site-wrap').offsetParent!==null; },
          restore(d){ d.view=SitePlan.getData().view; SitePlan.load(d); saveSite(); } },
  syno: { visible(){ return document.getElementById('sp-world') && document.getElementById('sp-world').offsetParent!==null; },
          restore(d){ if(SynPro.setData) SynPro.setData(d); else SynPro.loadSceneDirect(d); if(SynPro._saveNow) SynPro._saveNow(); } },
  il:   { visible(){ var p=document.getElementById('panel-inputlist'); return p && p.offsetParent!==null && (typeof CUR_IL_MODE==='undefined'||CUR_IL_MODE==='in'); },
          restore(d){ _ilUndoRestore(d); } },
};
/* Restauration de l'Input List (undo) — réconciliation DB : on remet les
   lignes de l'instantané (upsert) et on supprime celles ajoutées depuis. */
const _CH_UNDO_COLS=['id','show_id','ch','short_name','long_name','source','mic','gain','phantom','iem_group','foh','mon','bc','note','patch_id','custom_data'];
function _chCleanForUpsert(r){ var o={}; _CH_UNDO_COLS.forEach(function(k){ if(k in r) o[k]=r[k]; }); if(typeof ME!=='undefined'&&ME) o.updated_by=ME.id; return o; }
async function _ilUndoRestore(prevRows){
  if(!Array.isArray(prevRows)) return;
  var prevIds={}; prevRows.forEach(function(r){ prevIds[r.id]=1; });
  var toDelete=CHS.filter(function(r){ return !prevIds[r.id]; }).map(function(r){ return r.id; });
  /* 1) Restaure en mémoire immédiatement */
  CHS = prevRows.map(function(r){ return Object.assign({}, r); });
  if(typeof ALL_CHS!=='undefined') ALL_CHS = ALL_CHS.filter(function(r){ return (r.patch_id||'main')!==CUR_PATCH_ID; }).concat(CHS);
  renderTable(); if(typeof renderPills==='function') renderPills();
  /* 2) Persiste en base (en évitant l'écho realtime « modifié par un collaborateur ») */
  _chRTSuppress=Date.now()+2500;
  if(typeof setSaving==='function') setSaving(true);
  try{
    if(prevRows.length){ var up=await sb.from('channels').upsert(prevRows.map(_chCleanForUpsert)); if(up.error) throw up.error; }
    if(toDelete.length){ var del=await sb.from('channels').delete().in('id',toDelete); if(del.error) throw del.error; }
  }catch(e){ console.error('[il undo persist]',e); if(typeof toast!=='undefined') toast('Erreur annulation Input List : '+(e.message||e)); }
  if(typeof setSaving==='function') setSaving(false);
}
function undoSection(key){
  var a=_UNDO_ADAPTERS[key]; if(!a) return;
  if(!SectionUndo.isPro()){ if(typeof showUpgradeModal==='function') showUpgradeModal('multi_patches'); return; }
  if(!SectionUndo.canUndo(key)){ if(typeof toast!=='undefined') toast('Rien à annuler'); return; }
  if(SectionUndo.undo(key, a.restore) && typeof toast!=='undefined') toast('Action annulée');
}
function undoActiveSection(){
  if(!SectionUndo.isPro()) return false;
  var order=['il','site','stage','syno'];
  for(var i=0;i<order.length;i++){ if(_UNDO_ADAPTERS[order[i]].visible()){ undoSection(order[i]); return true; } }
  return false;
}
/* Ctrl/⌘+Z global (hors champs de saisie) */
document.addEventListener('keydown', function(e){
  if(!(e.ctrlKey||e.metaKey) || e.shiftKey) return;
  if((e.key||'').toLowerCase()!=='z') return;
  var t=e.target, tag=t&&t.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable)) return;
  if(undoActiveSection()) e.preventDefault();
});

async function saveStage(){
  if(!CUR_SHOW)return;
  SectionUndo.record('stage', ()=>BandPlan.getData());
  if(canDo('multi_scenes') && CUR_SCENES.stage){
    // Studio : sauvegarder dans la scène courante
    const stageData={band:BandPlan.getData()};
    await _saveScene('stage',stageData);
    // Sauvegarder planMode dans shows.stage_data pour mémoriser le dernier plan vu
    const existing=CUR_SHOW.stage_data||{};
    const chsSnap=(typeof CHS!=='undefined'?CHS:[]).map(function(r){return{id:r.id,ch:r.ch,short_name:r.short_name||'',long_name:r.long_name||'',source:r.source||'',mic:r.mic||'',phantom:!!r.phantom,foh:!!r.foh,mon:!!r.mon,note:r.note||''};});
    const sd=Object.assign({},existing,{v:2,planMode:PLAN_MODE,chs:chsSnap});
    CUR_SHOW.stage_data=sd;
    clearTimeout(saveStageTimer);
    saveStageTimer=setTimeout(async()=>{
      await sb.from('shows').update({stage_data:sd}).eq('id',CUR_SHOW.id);
    },1000);
    return;
  }
  // Non-Studio : comportement original
  const chsSnap=(typeof CHS!=='undefined'?CHS:[]).map(function(r){return{id:r.id,ch:r.ch,short_name:r.short_name||'',long_name:r.long_name||'',source:r.source||'',mic:r.mic||'',phantom:!!r.phantom,foh:!!r.foh,mon:!!r.mon,note:r.note||''};});
  const existing=CUR_SHOW.stage_data||{};
  /* IMPORTANT : ne sauvegarder site que si SitePlan a du contenu OU qu'il était
     déjà chargé. Si l'onglet plan de site n'a jamais été ouvert dans cette
     session, SitePlan.getData() retourne {elements:[]} et écraserait les
     données réelles stockées dans existing.site. */
  var siteData = SitePlan.hasContent()
    ? SitePlan.getData()
    : (existing.site || SitePlan.getData()); // fallback : existing si SitePlan est vide
  const data={v:2,planMode:PLAN_MODE,band:BandPlan.getData(),site:siteData,chs:chsSnap};
  if(existing.rider)data.rider=existing.rider;
  CUR_SHOW.stage_data=data;
  clearTimeout(saveStageTimer);
  saveStageTimer=setTimeout(async()=>{
    await sb.from('shows').update({stage_data:data}).eq('id',CUR_SHOW.id);
  },1000);
}
async function saveSite(){
  if(!CUR_SHOW)return;
  SectionUndo.record('site', ()=>SitePlan.getData());
  if(canDo('multi_scenes') && CUR_SCENES.site){
    const siteData={site:SitePlan.getData()};
    await _saveScene('site',siteData);
    return;
  }
  saveStage();
}





// ══════════════════════════════════════
// SYNOPTIQUE PRO — SynPro v1
// Professional network diagram editor.
// Inspired by the IMPACT EVENEMENT dLive S5000 rider style.
// ══════════════════════════════════════
const SynPro = (() => {

  /* ── Equipment library — structure deux niveaux :
     cat    = categorie principale (Consoles, Stageboxes, Amplis...)
     subcat = marque (Allen & Heath, Yamaha...) — optionnel
     La palette rend deux niveaux de menus deroulants imbriques.
     Tous les types historiques conserves (compat donnees sauvegardees). */
  const LIB = [

    /* ══════════════ CONSOLES ══════════════ */
    { type:'console.dlive-s5000',  cat:'Consoles', subcat:'Allen & Heath', label:'dLive S5000',     defaultSub:'Surface dLive',              w:200, h:130, icon:_iconConsoleLarge() },
    { type:'console.dlive-s7000',  cat:'Consoles', subcat:'Allen & Heath', label:'dLive S7000',     defaultSub:'Surface dLive grande',       w:220, h:135, icon:_iconConsoleLarge() },
    { type:'console.dlive-c3500',  cat:'Consoles', subcat:'Allen & Heath', label:'dLive C3500',     defaultSub:'Surface dLive compacte',     w:180, h:120, icon:_iconConsoleCompact() },
    { type:'console.dlive-c1500',  cat:'Consoles', subcat:'Allen & Heath', label:'dLive C1500',     defaultSub:'Surface dLive compacte',     w:170, h:115, icon:_iconConsoleCompact() },
    { type:'console.ah-avantis',   cat:'Consoles', subcat:'Allen & Heath', label:'Avantis',         defaultSub:'64 voies · 12 stages',       w:200, h:125, icon:_iconConsoleCompact() },
    { type:'console.sq7',          cat:'Consoles', subcat:'Allen & Heath', label:'SQ-7',            defaultSub:'48 ch · 24 mix bus',         w:190, h:118, icon:_iconConsoleCompact() },
    { type:'console.sq6',          cat:'Consoles', subcat:'Allen & Heath', label:'SQ-6',            defaultSub:'48 ch · 24 mix bus',         w:180, h:115, icon:_iconConsoleCompact() },
    { type:'console.sq5',          cat:'Consoles', subcat:'Allen & Heath', label:'SQ-5',            defaultSub:'48 ch · 24 mix bus',         w:170, h:110, icon:_iconConsoleCompact() },
    { type:'console.qu32',         cat:'Consoles', subcat:'Allen & Heath', label:'Qu-32',           defaultSub:'32 ch',                      w:180, h:115, icon:_iconConsoleCompact() },
    { type:'console.qu24',         cat:'Consoles', subcat:'Allen & Heath', label:'Qu-24',           defaultSub:'24 ch',                      w:170, h:110, icon:_iconConsoleCompact() },

    { type:'console.yam-rivage10', cat:'Consoles', subcat:'Yamaha', label:'Rivage PM10',   defaultSub:'144 in · flagship',          w:220, h:140, icon:_iconConsoleLarge() },
    { type:'console.yam-rivage7',  cat:'Consoles', subcat:'Yamaha', label:'Rivage PM7',    defaultSub:'144 in · grand format',      w:210, h:135, icon:_iconConsoleLarge() },
    { type:'console.yam-rivage5',  cat:'Consoles', subcat:'Yamaha', label:'Rivage PM5',    defaultSub:'120 in · compact',           w:200, h:130, icon:_iconConsoleLarge() },
    { type:'console.yam-cl5',      cat:'Consoles', subcat:'Yamaha', label:'CL5',           defaultSub:'72 mix · 8 matrix',          w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.yam-cl3',      cat:'Consoles', subcat:'Yamaha', label:'CL3',           defaultSub:'72 mix · 16 fader',          w:200, h:125, icon:_iconConsoleLarge() },
    { type:'console.yam-cl1',      cat:'Consoles', subcat:'Yamaha', label:'CL1',           defaultSub:'72 mix · 8 fader',           w:180, h:120, icon:_iconConsoleCompact() },
    { type:'console.yam-ql5',      cat:'Consoles', subcat:'Yamaha', label:'QL5',           defaultSub:'64 ch · 32 mic',             w:190, h:120, icon:_iconConsoleLarge() },
    { type:'console.yam-ql1',      cat:'Consoles', subcat:'Yamaha', label:'QL1',           defaultSub:'32 ch compact',              w:170, h:110, icon:_iconConsoleCompact() },
    { type:'console.yam-dm7',      cat:'Consoles', subcat:'Yamaha', label:'DM7',           defaultSub:'72 ch · tactile',            w:200, h:130, icon:_iconConsoleLarge() },
    { type:'console.yam-dm3',      cat:'Consoles', subcat:'Yamaha', label:'DM3',           defaultSub:'22 ch compact',              w:170, h:115, icon:_iconConsoleCompact() },
    { type:'console.cl5',          cat:'Consoles', subcat:'Yamaha', label:'CL5 (ancien)',   defaultSub:'Console FOH Yamaha',         w:200, h:125, icon:_iconConsoleLarge() },

    { type:'console.dig-q852',     cat:'Consoles', subcat:'DiGiCo', label:'Quantum 852',   defaultSub:'flagship',                   w:230, h:145, icon:_iconConsoleLarge() },
    { type:'console.dig-q338',     cat:'Consoles', subcat:'DiGiCo', label:'Quantum 338',   defaultSub:'128 ch · grand format',      w:220, h:140, icon:_iconConsoleLarge() },
    { type:'console.dig-q225',     cat:'Consoles', subcat:'DiGiCo', label:'Quantum 225',   defaultSub:'128 ch · compact',           w:200, h:130, icon:_iconConsoleLarge() },
    { type:'console.dig-sd12',     cat:'Consoles', subcat:'DiGiCo', label:'SD12',          defaultSub:'72 ch · 48 buses',           w:200, h:130, icon:_iconConsoleLarge() },
    { type:'console.dig-sd9',      cat:'Consoles', subcat:'DiGiCo', label:'SD9',           defaultSub:'48 ch · 24 buses',           w:190, h:125, icon:_iconConsoleLarge() },
    { type:'console.dig-s31',      cat:'Consoles', subcat:'DiGiCo', label:'S31',           defaultSub:'48 ch · 24 fader',           w:200, h:125, icon:_iconConsoleLarge() },
    { type:'console.dig-sd11',     cat:'Consoles', subcat:'DiGiCo', label:'SD11i',         defaultSub:'32 ch · compact',            w:180, h:115, icon:_iconConsoleCompact() },
    { type:'console.dig-s21',      cat:'Consoles', subcat:'DiGiCo', label:'S21',           defaultSub:'48 ch · compact',            w:170, h:115, icon:_iconConsoleCompact() },

    { type:'console.mid-hd96',     cat:'Consoles', subcat:'Midas',  label:'HD96-24',       defaultSub:'120 in · pavillon',          w:220, h:140, icon:_iconConsoleLarge() },
    { type:'console.mid-prox',     cat:'Consoles', subcat:'Midas',  label:'PRO X',         defaultSub:'168 in · flagship',          w:220, h:135, icon:_iconConsoleLarge() },
    { type:'console.mid-pro9',     cat:'Consoles', subcat:'Midas',  label:'PRO9',          defaultSub:'88 in',                      w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.mid-pro2',     cat:'Consoles', subcat:'Midas',  label:'PRO2',          defaultSub:'64 in · compact',            w:200, h:125, icon:_iconConsoleLarge() },
    { type:'console.mid-pro1',     cat:'Consoles', subcat:'Midas',  label:'PRO1',          defaultSub:'40 in',                      w:190, h:120, icon:_iconConsoleCompact() },
    { type:'console.mid-m32',      cat:'Consoles', subcat:'Midas',  label:'M32',           defaultSub:'32 ch · 16 bus',             w:200, h:120, icon:_iconConsoleLarge() },
    { type:'console.mid-m32r',     cat:'Consoles', subcat:'Midas',  label:'M32R Live',     defaultSub:'40 input ch',                w:180, h:115, icon:_iconConsoleCompact() },
    { type:'console.mid-m32c',     cat:'Consoles', subcat:'Midas',  label:'M32C',          defaultSub:'rack console',               w:170, h:100, icon:_iconRack(3) },
    { type:'console.m32',          cat:'Consoles', subcat:'Midas',  label:'M32 (ancien)',   defaultSub:'Console Midas/Behringer',    w:180, h:115, icon:_iconConsoleCompact() },

    { type:'console.beh-wing',     cat:'Consoles', subcat:'Behringer', label:'Wing',          defaultSub:'48 ch · tactile',          w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.beh-x32',      cat:'Consoles', subcat:'Behringer', label:'X32',           defaultSub:'32 ch · 16 bus',           w:200, h:120, icon:_iconConsoleLarge() },
    { type:'console.beh-x32c',     cat:'Consoles', subcat:'Behringer', label:'X32 Compact',   defaultSub:'32 ch compact',            w:180, h:115, icon:_iconConsoleCompact() },
    { type:'console.beh-x32p',     cat:'Consoles', subcat:'Behringer', label:'X32 Producer',  defaultSub:'32 ch · 16 fader',         w:170, h:110, icon:_iconConsoleCompact() },
    { type:'console.beh-x32rack',  cat:'Consoles', subcat:'Behringer', label:'X32 Rack',      defaultSub:'rackmount',                w:170, h:100, icon:_iconRack(3) },
    { type:'console.beh-x32core',  cat:'Consoles', subcat:'Behringer', label:'X32 Core',      defaultSub:'moteur sans surface',      w:160, h:85,  icon:_iconRack(2) },

    { type:'console.sc-vi3000',    cat:'Consoles', subcat:'Soundcraft', label:'Vi3000',         defaultSub:'96 ch',                  w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.sc-vi2000',    cat:'Consoles', subcat:'Soundcraft', label:'Vi2000',         defaultSub:'64 ch',                  w:200, h:125, icon:_iconConsoleLarge() },
    { type:'console.sc-vi1000',    cat:'Consoles', subcat:'Soundcraft', label:'Vi1000',         defaultSub:'48 ch',                  w:190, h:120, icon:_iconConsoleCompact() },
    { type:'console.sc-siperf',    cat:'Consoles', subcat:'Soundcraft', label:'Si Performer 3', defaultSub:'80 ch · live',           w:200, h:120, icon:_iconConsoleLarge() },
    { type:'console.sc-siexp',     cat:'Consoles', subcat:'Soundcraft', label:'Si Expression 3',defaultSub:'66 ch',                  w:200, h:115, icon:_iconConsoleCompact() },
    { type:'console.sc-siimpact',  cat:'Consoles', subcat:'Soundcraft', label:'Si Impact',      defaultSub:'80 in · 40 fader',       w:200, h:120, icon:_iconConsoleLarge() },

    { type:'console.av-s6l',       cat:'Consoles', subcat:'Avid', label:'VENUE | S6L',   defaultSub:'192 in · flagship',          w:220, h:140, icon:_iconConsoleLarge() },
    { type:'console.av-profile',   cat:'Consoles', subcat:'Avid', label:'VENUE Profile', defaultSub:'96 in',                      w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.av-s3l',       cat:'Consoles', subcat:'Avid', label:'S3L-X',         defaultSub:'64 in · compact',            w:200, h:120, icon:_iconConsoleCompact() },
    { type:'console.av-sc48',      cat:'Consoles', subcat:'Avid', label:'VENUE SC48',    defaultSub:'48 in compact',              w:190, h:120, icon:_iconConsoleCompact() },

    { type:'console.ssl-l500',     cat:'Consoles', subcat:'SSL', label:'L500',           defaultSub:'flagship',                   w:230, h:140, icon:_iconConsoleLarge() },
    { type:'console.ssl-l300',     cat:'Consoles', subcat:'SSL', label:'L300',           defaultSub:'288 ch',                     w:220, h:135, icon:_iconConsoleLarge() },
    { type:'console.ssl-l200',     cat:'Consoles', subcat:'SSL', label:'L200',           defaultSub:'144 ch',                     w:210, h:130, icon:_iconConsoleLarge() },
    { type:'console.ssl-l100',     cat:'Consoles', subcat:'SSL', label:'L100',           defaultSub:'72 ch',                      w:200, h:125, icon:_iconConsoleLarge() },

    { type:'console.generic',      cat:'Consoles', subcat:'Generique', label:'Console generique', defaultSub:'',                   w:180, h:115, icon:_iconConsoleCompact() },

    /* ══════════════ STAGEBOXES & RACKS ══════════════ */
    { type:'rack.dlive-dm0',       cat:'Stageboxes', subcat:'Allen & Heath', label:'DM0 MixRack',   defaultSub:'128 in / 64 out',        w:170, h:155, icon:_iconRack(6) },
    { type:'rack.dlive-dm64',      cat:'Stageboxes', subcat:'Allen & Heath', label:'DM64 MixRack',  defaultSub:'64 in / 32 out',         w:170, h:150, icon:_iconRack(6) },
    { type:'rack.dlive-dm48',      cat:'Stageboxes', subcat:'Allen & Heath', label:'DM48 MixRack',  defaultSub:'48 in / 24 out · 5 AES', w:170, h:140, icon:_iconRack(5) },
    { type:'rack.dlive-dm32',      cat:'Stageboxes', subcat:'Allen & Heath', label:'DM32 MixRack',  defaultSub:'32 in / 16 out',         w:170, h:130, icon:_iconRack(4) },
    { type:'io.dx168',             cat:'Stageboxes', subcat:'Allen & Heath', label:'DX168',          defaultSub:'16 in / 8 out',          w:160, h:90,  icon:_iconStagebox() },
    { type:'io.dx32',              cat:'Stageboxes', subcat:'Allen & Heath', label:'DX32',           defaultSub:'4 slots modulaires',     w:160, h:95,  icon:_iconStagebox() },
    { type:'io.ar2412',            cat:'Stageboxes', subcat:'Allen & Heath', label:'AR2412',         defaultSub:'24 in / 12 out',         w:160, h:90,  icon:_iconStagebox() },
    { type:'io.ar84',              cat:'Stageboxes', subcat:'Allen & Heath', label:'AR84',           defaultSub:'8 in / 4 out',           w:150, h:85,  icon:_iconStagebox() },

    { type:'rack.yam-rpio',        cat:'Stageboxes', subcat:'Yamaha', label:'RPio622 / 222',   defaultSub:'Rivage stagebox',        w:170, h:120, icon:_iconRack(5) },
    { type:'rack.yam-rio3224',     cat:'Stageboxes', subcat:'Yamaha', label:'Rio3224-D2',      defaultSub:'32 in / 16 out · Dante', w:170, h:120, icon:_iconRack(5) },
    { type:'rack.yam-rio1608',     cat:'Stageboxes', subcat:'Yamaha', label:'Rio1608-D2',      defaultSub:'16 in / 8 out · Dante',  w:170, h:100, icon:_iconRack(3) },
    { type:'rack.yam-tio1608',     cat:'Stageboxes', subcat:'Yamaha', label:'Tio1608-D2',      defaultSub:'16 in / 8 out · Dante',  w:170, h:100, icon:_iconRack(3) },

    { type:'rack.dig-sdrack',      cat:'Stageboxes', subcat:'DiGiCo', label:'SD-Rack',        defaultSub:'56 in / 56 out',         w:170, h:140, icon:_iconRack(5) },
    { type:'rack.dig-sdmini',      cat:'Stageboxes', subcat:'DiGiCo', label:'SD-MiNi Rack',   defaultSub:'24 in / 16 out',         w:170, h:120, icon:_iconRack(3) },
    { type:'rack.dig-sdnano',      cat:'Stageboxes', subcat:'DiGiCo', label:'SD-NANO Rack',   defaultSub:'24 in / 12 out',         w:160, h:110, icon:_iconRack(3) },

    { type:'rack.mid-dl251',       cat:'Stageboxes', subcat:'Midas',  label:'DL251',          defaultSub:'48 in / 16 out',         w:170, h:135, icon:_iconRack(5) },
    { type:'rack.mid-dl32',        cat:'Stageboxes', subcat:'Midas',  label:'DL32',           defaultSub:'32 in / 16 out',         w:170, h:120, icon:_iconRack(4) },
    { type:'rack.mid-dl151',       cat:'Stageboxes', subcat:'Midas',  label:'DL151',          defaultSub:'24 in · simple',         w:170, h:110, icon:_iconRack(3) },
    { type:'rack.mid-dl16',        cat:'Stageboxes', subcat:'Midas',  label:'DL16',           defaultSub:'16 in / 8 out',          w:170, h:100, icon:_iconRack(3) },

    { type:'rack.beh-s32',         cat:'Stageboxes', subcat:'Behringer', label:'S32',         defaultSub:'32 in / 16 out',         w:160, h:100, icon:_iconStagebox() },
    { type:'rack.beh-s16',         cat:'Stageboxes', subcat:'Behringer', label:'S16',         defaultSub:'16 in / 8 out',          w:160, h:90,  icon:_iconStagebox() },
    { type:'rack.beh-sd16',        cat:'Stageboxes', subcat:'Behringer', label:'SD16',        defaultSub:'16 in / 8 out · AES50',  w:160, h:90,  icon:_iconStagebox() },
    { type:'rack.beh-sd8',         cat:'Stageboxes', subcat:'Behringer', label:'SD8',         defaultSub:'8 in / 4 out · AES50',   w:150, h:85,  icon:_iconStagebox() },

    { type:'rack.sc-stage64',      cat:'Stageboxes', subcat:'Soundcraft', label:'Stagebox 64',defaultSub:'64 in / 32 out',         w:170, h:140, icon:_iconRack(6) },
    { type:'rack.sc-stage32',      cat:'Stageboxes', subcat:'Soundcraft', label:'Stagebox 32',defaultSub:'32 in / 16 out',         w:170, h:120, icon:_iconRack(4) },

    { type:'rack.av-stage64',      cat:'Stageboxes', subcat:'Avid', label:'Stage 64',        defaultSub:'64 in / 32 out',         w:170, h:140, icon:_iconRack(6) },
    { type:'rack.av-stage48',      cat:'Stageboxes', subcat:'Avid', label:'Stage 48',        defaultSub:'48 in / 24 out',         w:170, h:130, icon:_iconRack(5) },
    { type:'rack.av-stage16',      cat:'Stageboxes', subcat:'Avid', label:'Stage 16',        defaultSub:'16 in / 8 out',          w:170, h:100, icon:_iconRack(3) },

    { type:'rack.ssl-stagebox',    cat:'Stageboxes', subcat:'SSL',  label:'SSL Live SB',     defaultSub:'32 in / 16 out',         w:170, h:120, icon:_iconRack(4) },

    { type:'rack.generic',         cat:'Stageboxes', subcat:'Generique', label:'Rack vide',  defaultSub:'',                       w:160, h:140, icon:_iconRack(4) },
    { type:'io.stagebox',          cat:'Stageboxes', subcat:'Generique', label:'Stagebox',   defaultSub:'Generique',              w:150, h:80,  icon:_iconStagebox() },

    /* ══════════════ AMPLIS ══════════════ */
    { type:'amp.linus14',          cat:'Amplis',     label:'Coda Linus 14D', defaultSub:'4 ch DSP',                   w:170, h:100, icon:_iconAmp() },
    { type:'amp.linus12',          cat:'Amplis',     label:'Coda Linus 12',  defaultSub:'4 ch · 4 x 3000W',           w:170, h:100, icon:_iconAmp() },
    { type:'amp.linus10',          cat:'Amplis',     label:'Coda Linus 10',  defaultSub:'4 ch · 4 x 2500W',           w:170, h:100, icon:_iconAmp() },
    { type:'amp.lacoustics',       cat:'Amplis',     label:'L-Acoustics LA', defaultSub:'LA4X / LA12X',               w:170, h:100, icon:_iconAmp() },
    { type:'amp.dnd',              cat:'Amplis',     label:'d&b D80 / D40',  defaultSub:'4 ch · controle d&b',        w:170, h:100, icon:_iconAmp() },
    { type:'amp.powersoft',        cat:'Amplis',     label:'Powersoft X4/X8',defaultSub:'4-8 ch DSP',                 w:170, h:100, icon:_iconAmp() },
    { type:'amp.lab-gruppen',      cat:'Amplis',     label:'Lab Gruppen',    defaultSub:'4 ch · jusque 5000W',        w:170, h:100, icon:_iconAmp() },
    { type:'amp.crown',            cat:'Amplis',     label:'Crown ITech',    defaultSub:'4 ch DSP',                   w:170, h:100, icon:_iconAmp() },
    { type:'amp.generic',          cat:'Amplis',     label:'Ampli generique',defaultSub:'',                           w:160, h:95,  icon:_iconAmp() },

    /* ══════════════ ENCEINTES ══════════════ */
    { type:'spk.line-top',         cat:'Enceintes',  label:'Top',            defaultSub:'Line array',                 w:130, h:115, icon:_iconLineArray() },
    { type:'spk.sub',              cat:'Enceintes',  label:'Sub',            defaultSub:'Subwoofer',                  w:130, h:105, icon:_iconSub() },
    { type:'spk.front-fill',       cat:'Enceintes',  label:'Front Fill',     defaultSub:'',                           w:130, h:100, icon:_iconSpeaker() },
    { type:'spk.out-fill',         cat:'Enceintes',  label:'Out Fill',       defaultSub:'',                           w:130, h:100, icon:_iconSpeaker() },
    { type:'spk.side-fill',        cat:'Enceintes',  label:'Side Fill',      defaultSub:'',                           w:130, h:100, icon:_iconSpeaker() },
    { type:'spk.wedge',            cat:'Enceintes',  label:'Wedge',          defaultSub:'Retour de scene',            w:130, h:95,  icon:_iconWedge() },
    { type:'spk.delay',            cat:'Enceintes',  label:'Delay',          defaultSub:'Renfort delay',              w:130, h:100, icon:_iconSpeaker() },

    /* ══════════════ RESEAU ══════════════ */
    { type:'net.switch',           cat:'Reseau',     label:'Switch',         defaultSub:'Gigabit managed',            w:140, h:80,  icon:_iconSwitch() },
    { type:'net.wireless',         cat:'Reseau',     label:'WiFi',           defaultSub:'Point d\'acces',             w:130, h:80,  icon:_iconWifi() },
    { type:'net.reel',             cat:'Reseau',     label:'Touret',         defaultSub:'Bobine cable',               w:120, h:95,  icon:_iconReel() },
    { type:'net.fiber',            cat:'Reseau',     label:'Fibre',          defaultSub:'Monomode',                   w:130, h:80,  icon:_iconFiber() },

    /* ══════════════ SOURCES ══════════════ */
    { type:'src.mic',              cat:'Sources',    label:'Micro',          defaultSub:'',                           w:110, h:95,  icon:_iconMic() },
    { type:'src.di',               cat:'Sources',    label:'DI Box',         defaultSub:'Boitier d\'injection',       w:120, h:80,  icon:_iconDI() },
    { type:'src.iem',              cat:'Sources',    label:'IEM',            defaultSub:'Retour ear-monitor',         w:130, h:90,  icon:_iconIEM() },
    { type:'src.computer',         cat:'Sources',    label:'Ordinateur',     defaultSub:'',                           w:130, h:90,  icon:_iconComputer() },

    /* ══════════════ ANNOTATIONS ══════════════ */
    { type:'note',                 cat:'Annotations',label:'Annotation',     defaultSub:'Texte libre',                w:200, h:80,  icon:_iconNote() },
    { type:'text_label',           cat:'Annotations',label:'Texte simple',   defaultSub:'',                           w:160, h:50,  icon:_iconTextLabel() },
    { type:'image_frame',          cat:'Annotations',label:'Image',          defaultSub:'',                           w:120, h:120, icon:_iconImageFrame() },
  ];

  /* ── SVG icon builders — stylized, neutral grey/blue, scalable ── */
  function _iconConsoleLarge() {
    return '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="6" width="58" height="36" rx="2" fill="#2c3f5f"/><rect x="3" y="6" width="58" height="9" rx="2" fill="#1a2840"/><rect x="6" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#3a5378" stroke-width=".4"/><rect x="24" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#3a5378" stroke-width=".4"/><g fill="#1d9bf0"><rect x="42" y="20" width="2" height="9"/><rect x="46" y="20" width="2" height="9"/><rect x="50" y="20" width="2" height="9"/><rect x="54" y="20" width="2" height="9"/></g><g fill="#ff6b1a"><circle cx="43" cy="33" r="1.4"/><circle cx="47" cy="33" r="1.4"/><circle cx="51" cy="33" r="1.4"/><circle cx="55" cy="33" r="1.4"/></g></svg>';
  }
  function _iconConsoleCompact() {
    return '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="6" y="10" width="52" height="32" rx="2" fill="#2c3f5f"/><rect x="6" y="10" width="52" height="7" rx="2" fill="#1a2840"/><rect x="9" y="20" width="20" height="20" rx="1" fill="#16243d" stroke="#3a5378" stroke-width=".4"/><g fill="#1d9bf0"><rect x="32" y="22" width="2" height="9"/><rect x="36" y="22" width="2" height="9"/><rect x="40" y="22" width="2" height="9"/><rect x="44" y="22" width="2" height="9"/><rect x="48" y="22" width="2" height="9"/></g><g fill="#ff6b1a"><circle cx="33" cy="35" r="1.2"/><circle cx="37" cy="35" r="1.2"/><circle cx="41" cy="35" r="1.2"/><circle cx="45" cy="35" r="1.2"/><circle cx="49" cy="35" r="1.2"/></g></svg>';
  }
  function _iconRack(slots) {
    var rs='';
    var sh = (40 - 4) / slots;
    for (var i = 0; i < slots; i++) {
      rs += '<rect x="8" y="' + (6 + i*sh + 1) + '" width="48" height="' + (sh - 2) + '" rx=".5" fill="#1a2840" stroke="#3a5378" stroke-width=".3"/>';
      if (i % 2 === 0) rs += '<circle cx="14" cy="' + (6 + i*sh + sh/2) + '" r="1" fill="#ff6b1a"/>';
    }
    return '<svg viewBox="0 0 64 48" fill="none"><rect x="4" y="4" width="56" height="42" rx="2" fill="#0d1828" stroke="#2c3f5f" stroke-width="1"/><rect x="4" y="44" width="56" height="2" fill="#1d9bf0"/>' + rs + '</svg>';
  }
  function _iconStagebox() {
    return '<svg viewBox="0 0 64 36" fill="none"><rect x="3" y="6" width="58" height="24" rx="2" fill="#2c3f5f" stroke="#1d9bf0" stroke-width=".8"/><g fill="#1a2840" stroke="#3a5378" stroke-width=".3"><circle cx="10" cy="14" r="2"/><circle cx="16" cy="14" r="2"/><circle cx="22" cy="14" r="2"/><circle cx="28" cy="14" r="2"/><circle cx="34" cy="14" r="2"/><circle cx="40" cy="14" r="2"/><circle cx="46" cy="14" r="2"/><circle cx="52" cy="14" r="2"/></g><g fill="#ff6b1a"><rect x="10" y="22" width="3" height="5" rx=".5"/><rect x="16" y="22" width="3" height="5" rx=".5"/><rect x="22" y="22" width="3" height="5" rx=".5"/><rect x="28" y="22" width="3" height="5" rx=".5"/></g></svg>';
  }
  function _iconAmp() {
    return '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#2c3f5f"/><rect x="4" y="6" width="56" height="4" fill="#1d9bf0"/><g fill="#1a2840" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><g fill="#22d6a0"><circle cx="11" cy="20" r=".8"/><circle cx="14" cy="20" r=".8"/></g><g fill="#ff6b1a"><circle cx="36" cy="20" r=".8"/><circle cx="39" cy="20" r=".8"/></g></svg>';
  }
  function _iconLineArray() {
    return '<svg viewBox="0 0 48 64" fill="none"><g stroke="#2c3f5f" stroke-width="1" fill="#1d3a5f"><path d="M14 6 L34 6 L36 14 L12 14 Z"/><path d="M12 16 L36 16 L38 24 L10 24 Z"/><path d="M10 26 L38 26 L40 34 L8 34 Z"/><path d="M8 36 L40 36 L42 44 L6 44 Z"/></g><line x1="24" y1="2" x2="24" y2="6" stroke="#5a6a80" stroke-width="1.2"/><circle cx="24" cy="2" r="1.4" fill="#5a6a80"/></svg>';
  }
  function _iconSub() {
    return '<svg viewBox="0 0 64 56" fill="none"><rect x="6" y="6" width="52" height="44" rx="2" fill="#1d3a5f" stroke="#2c3f5f" stroke-width="1"/><circle cx="32" cy="28" r="16" fill="#0d1828" stroke="#1d9bf0" stroke-width="1.2"/><circle cx="32" cy="28" r="11" fill="#16243d" stroke="#3a5378" stroke-width=".5"/><circle cx="32" cy="28" r="4" fill="#5a6a80"/></svg>';
  }
  function _iconSpeaker() {
    return '<svg viewBox="0 0 48 56" fill="none"><rect x="6" y="6" width="36" height="44" rx="2" fill="#1d3a5f" stroke="#2c3f5f"/><circle cx="24" cy="20" r="8" fill="#0d1828" stroke="#1d9bf0"/><circle cx="24" cy="20" r="3" fill="#5a6a80"/><circle cx="24" cy="40" r="5" fill="#0d1828" stroke="#1d9bf0"/><circle cx="24" cy="40" r="2" fill="#5a6a80"/></svg>';
  }
  function _iconWedge() {
    return '<svg viewBox="0 0 64 40" fill="none"><path d="M4 32 L60 32 L52 6 L18 6 Z" fill="#1d3a5f" stroke="#2c3f5f" stroke-width="1.2"/><ellipse cx="32" cy="18" rx="10" ry="5" fill="#0d1828" stroke="#1d9bf0"/><circle cx="32" cy="18" r="2" fill="#5a6a80"/></svg>';
  }
  function _iconSwitch() {
    return '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#0d1828" stroke="#2c3f5f"/><g fill="#1a2840" stroke="#3a5378" stroke-width=".4"><rect x="8" y="14" width="6" height="6" rx=".5"/><rect x="16" y="14" width="6" height="6" rx=".5"/><rect x="24" y="14" width="6" height="6" rx=".5"/><rect x="32" y="14" width="6" height="6" rx=".5"/><rect x="40" y="14" width="6" height="6" rx=".5"/><rect x="48" y="14" width="6" height="6" rx=".5"/></g><g fill="#22d6a0"><rect x="9" y="22" width="4" height="2" rx=".3"/><rect x="17" y="22" width="4" height="2" rx=".3"/><rect x="25" y="22" width="4" height="2" rx=".3"/></g></svg>';
  }
  function _iconWifi() {
    return '<svg viewBox="0 0 48 40" fill="none" stroke="#1d9bf0" stroke-width="2" stroke-linecap="round"><path d="M8 22 Q24 6 40 22"/><path d="M14 26 Q24 16 34 26"/><path d="M20 30 Q24 26 28 30"/><circle cx="24" cy="34" r="2" fill="#1d9bf0"/></svg>';
  }
  function _iconReel() {
    return '<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="22" fill="#1a2840" stroke="#2c3f5f" stroke-width="1.5"/><circle cx="28" cy="28" r="14" fill="#0d1828" stroke="#3a5378"/><circle cx="28" cy="28" r="5" fill="#16243d"/><g stroke="#5a6a80" stroke-width=".8"><line x1="28" y1="14" x2="28" y2="6"/><line x1="28" y1="42" x2="28" y2="50"/><line x1="14" y1="28" x2="6" y2="28"/><line x1="42" y1="28" x2="50" y2="28"/></g></svg>';
  }
  function _iconFiber() {
    return '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#1d3a5f" stroke="#fbbf24" stroke-width="1"/><g stroke="#fbbf24" stroke-width="1.5"><path d="M10 20 Q20 14 32 20 Q44 26 54 20" fill="none"/></g><circle cx="12" cy="20" r="2" fill="#fbbf24"/><circle cx="52" cy="20" r="2" fill="#fbbf24"/></svg>';
  }
  function _iconMic() {
    return '<svg viewBox="0 0 32 56" fill="none" stroke="#1d3a5f" stroke-width="1.4"><rect x="11" y="6" width="10" height="22" rx="5" fill="#2c3f5f"/><path d="M7 26 Q7 36 16 36 Q25 36 25 26" fill="none"/><line x1="16" y1="36" x2="16" y2="46" stroke-linecap="round"/><line x1="10" y1="50" x2="22" y2="50" stroke-linecap="round"/></svg>';
  }
  function _iconDI() {
    return '<svg viewBox="0 0 48 56" fill="none"><rect x="8" y="8" width="32" height="40" rx="2" fill="#16243d" stroke="#2c3f5f" stroke-width="1.2"/><text x="24" y="28" text-anchor="middle" font-family="Outfit" font-size="10" font-weight="700" fill="#1d9bf0">DI</text><circle cx="16" cy="42" r="2" fill="#1a2840" stroke="#3a5378"/><circle cx="24" cy="42" r="2" fill="#1a2840" stroke="#3a5378"/><circle cx="32" cy="42" r="2" fill="#1a2840" stroke="#3a5378"/></svg>';
  }
  function _iconIEM() {
    return '<svg viewBox="0 0 48 48" fill="none" stroke="#1d3a5f" stroke-width="1.4"><rect x="8" y="14" width="32" height="20" rx="2" fill="#2c3f5f"/><circle cx="16" cy="24" r="3" fill="#ff6b1a"/><line x1="22" y1="24" x2="34" y2="24"/><path d="M40 24 Q44 16 40 8" fill="none" stroke-linecap="round"/></svg>';
  }
  function _iconComputer() {
    return '<svg viewBox="0 0 56 48" fill="none" stroke="#1d3a5f" stroke-width="1.2"><rect x="4" y="6" width="48" height="28" rx="1.5" fill="#16243d"/><rect x="6" y="8" width="44" height="24" fill="#0d1828"/><line x1="22" y1="38" x2="34" y2="38" stroke-linecap="round"/><line x1="14" y1="42" x2="42" y2="42" stroke-linecap="round" stroke-width="2"/></svg>';
  }
  function _iconNote() {
    return '<svg viewBox="0 0 56 40" fill="none" stroke="#fbbf24" stroke-width="1.4"><rect x="4" y="4" width="48" height="32" rx="2" fill="#fef3c7"/><line x1="10" y1="14" x2="46" y2="14" stroke="#fbbf24" stroke-width="1"/><line x1="10" y1="20" x2="46" y2="20" stroke="#fbbf24" stroke-width="1"/><line x1="10" y1="26" x2="36" y2="26" stroke="#fbbf24" stroke-width="1"/></svg>';
  }
  function _iconTextLabel() {
    return '<svg viewBox="0 0 56 32" fill="none"><text x="4" y="22" font-family="Outfit,sans-serif" font-size="16" font-weight="700" fill="#e8edf8">Aa</text></svg>';
  }
  function _iconImageFrame() {
    return '<svg viewBox="0 0 56 48" fill="none"><rect x="4" y="4" width="48" height="40" rx="5" fill="#1a2840" stroke="#3a5378" stroke-width="1.2"/><path d="M4 32 L16 20 L26 28 L34 18 L52 36 L52 44 L4 44 Z" fill="#2c4060"/><circle cx="40" cy="16" r="6" fill="#f5c542" opacity=".8"/><line x1="14" y1="14" x2="14" y2="10" stroke="#3a5378" stroke-width="1"/><line x1="14" y1="14" x2="18" y2="14" stroke="#3a5378" stroke-width="1"/></svg>';
  }

  /* ── State ──
     Cable type defaults — couvre la majorite des reseaux et signaux audio pro.
     L'utilisateur peut en ajouter, modifier, supprimer depuis le modal. */
  const DEFAULT_NETWORKS = [
    /* Reseaux numeriques audio */
    { id:'dante',    name:'Dante',           color:'#1d9bf0' },
    { id:'aes50',    name:'AES50',           color:'#a855f7' },
    { id:'madi',     name:'MADI',            color:'#fbbf24' },
    { id:'avb',      name:'AVB',             color:'#22d3ee' },
    /* Reseaux constructeurs */
    { id:'gigaace',  name:'gigaACE',         color:'#ea8a3b' },
    { id:'dxlink',   name:'DX-Link',         color:'#5db865' },
    /* Cables audio analogiques */
    { id:'xlr',      name:'XLR',             color:'#94a3b8' },
    { id:'trs',      name:'Jack TRS 6.35',   color:'#cbd5e1' },
    { id:'speakon',  name:'Speakon NL4',     color:'#dc2626' },
    /* Fibre optique */
    { id:'fibre',    name:'Fibre optique',   color:'#facc15' },
    /* Cables divers */
    { id:'midi',     name:'MIDI',            color:'#ec4899' },
    { id:'usb',      name:'USB',             color:'#10b981' },
    { id:'hdmi',     name:'HDMI / Video',    color:'#ef4444' },
    { id:'power',    name:'Alimentation',    color:'#1f2937' },
  ];

  let state = null;        // current diagram data
  let inited = false;
  let loaded = false;
  let saveTimer = null;
  /* localStorage key — per show, so multiple shows don't overwrite each other */
  function _lsKey() { return 'pf_synpro_state_' + (CUR_SHOW ? CUR_SHOW.id : 'default'); }
  function _lsSave() {
    if (!state) return;
    try { localStorage.setItem(_lsKey(), JSON.stringify(state)); } catch(e) {}
  }
  function _lsLoad() {
    try { var s = localStorage.getItem(_lsKey()); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  }
  function _lsClear() {
    try { localStorage.removeItem(_lsKey()); } catch(e) {}
  }
  let selected = { kind:null, id:null };
  let activeCable = null;  // network id when cable-drawing mode is active
  let cableFrom = null;    // first node id during cable creation
  let dragging = null;
  let panning = null;
  let resizing = null;
  let view = { zoom:1, panX:0, panY:0 };

  function _defaultState() {
    return {
      v:1,
      title:'Diagramme reseau',
      headerColor:'#ff6b1a',
      footer:'www.patchflow.fr',
      nodes:[],
      cables:[],
      networks: DEFAULT_NETWORKS.map(function(n){return Object.assign({},n);}),
    };
  }

  const $ = function(id){ return document.getElementById(id); };
  const esc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  const uid = function(){ return 'sp'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); };
  function spec(type){
    var b = LIB.find(function(x){ return x.type===type; });
    if (b) return b;
    var c = _getCustomItems().find(function(x){ return x.type === type; });
    return c ? _customSpec(c) : null;
  }
  function nodeById(id){ return state.nodes.find(function(n){ return n.id===id; }); }
  function cableById(id){ return state.cables.find(function(c){ return c.id===id; }); }
  function netById(id){ return state.networks.find(function(n){ return n.id===id; }); }

  /* ── Save status indicator ── */
  function _setSaveStatus(st) {
    /* st: 'saving' | 'saved' | 'error' */
    var el = document.getElementById('sp-save-status');
    if (!el) return;
    if (st === 'saving') {
      el.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Sauvegarde…';
      el.style.color = 'var(--muted)';
    } else if (st === 'saved') {
      el.innerHTML = '<i class="ti ti-circle-check-filled"></i> Sauvegarde';
      el.style.color = '#22c55e';
    } else if (st === 'error') {
      el.innerHTML = '<i class="ti ti-alert-triangle"></i> Erreur sauvegarde';
      el.style.color = 'var(--err)';
    }
  }

  /* ── Persistence ── */
  function scheduleSave() {
    if(typeof SectionUndo!=='undefined') SectionUndo.record('syno', function(){ return state; });
    /* 1. Save to localStorage IMMEDIATELY (synchronous, survives same-origin reload) */
    _lsSave();
    _setSaveStatus('saving');
    /* 2. Debounce the DB write — short delay (600ms) so DB is almost always
       up-to-date before the user switches browser/device */
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(_save, 600);
  }
  async function _saveNow() {
    _lsSave();
    if (saveTimer) clearTimeout(saveTimer);
    await _save();
  }
  var _activeSceneId = null; // set by setSceneId() for Studio multi-scene
  async function _save() {
    if (!CUR_SHOW || !state) return;
    /* Populate missing iconSvg fields before any save (retrocompat with older nodes) */
    state.nodes.forEach(function(n){
      if(!n.iconSvg && n.type!=='note'){
        var sp2=spec(n.type);
        if(sp2&&sp2.icon) n.iconSvg=sp2.icon;
      }
    });
    /* Studio : save to show_scenes table */
    if (_activeSceneId && typeof _saveScene === 'function') {
      await _saveScene('syno', state);
      _lsClear();
      _setSaveStatus('saved');
      return;
    }
    CUR_SHOW.synoptique_data = state;
    try {
      const { error } = await sb.from('shows').update({ synoptique_data: state }).eq('id', CUR_SHOW.id);
      if (error) {
        console.error('SynPro save:', error);
        _setSaveStatus('error');
        /* Colonne manquante = erreur 42703 ou message "column does not exist" */
        var msg = error.message || JSON.stringify(error);
        if (msg.includes('synoptique_data') || msg.includes('column') || error.code === '42703') {
          toast('Colonne manquante dans Supabase. SQL : ALTER TABLE shows ADD COLUMN IF NOT EXISTS synoptique_data jsonb;');
        } else {
          toast('Erreur sauvegarde synoptique : ' + msg);
        }
      } else {
        _lsClear();
        _setSaveStatus('saved');
      }
    } catch (e) {
      console.error('SynPro save', e);
      _setSaveStatus('error');
    }
  }
  var _injectedSceneData = undefined; // data to load from scene (Studio) — undefined=non défini, null=scène vide intentionnelle
  function _load() {
    if (!CUR_SHOW) return false;
    /* Studio : use injected scene data if available.
       undefined = pas d'injection (chemin non-Studio)
       null      = scène vide intentionnelle (nouvelle scène) → defaultState
       object    = données de scène à charger */
    if (_injectedSceneData !== undefined) {
      var sd = _injectedSceneData;
      _injectedSceneData = undefined;
      state = (sd && sd.v === 1) ? sd : _defaultState();
      if (CUR_SHOW && CUR_SHOW.name && state.title === 'Diagramme reseau') state.title = CUR_SHOW.name;
      loaded = true;
      if(typeof SectionUndo!=='undefined') SectionUndo.reset('syno', state);
      return true;
    }
    var saved = CUR_SHOW.synoptique_data;
    /* Parse JSON string if needed (Supabase may return string or object) */
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch(e) { saved = null; }
    }
    /* Migration : old SynEditor data had .scenes — drop it and start fresh.
       The user explicitly asked to remove old synoptique data. */
    if (saved && (saved.scenes || saved.activeScene !== undefined)) {
      saved = null;
      sb.from('shows').update({ synoptique_data: null }).eq('id', CUR_SHOW.id).then(function(){});
    }
    /* Fallback : if DB has nothing, check localStorage (written synchronously
       on every change so it always survives a page reload) */
    if (!saved || saved.v !== 1) {
      var ls = _lsLoad();
      if (ls && ls.v === 1) {
        saved = ls;
        /* Push localStorage state back to DB so they stay in sync */
        sb.from('shows').update({ synoptique_data: saved }).eq('id', CUR_SHOW.id).then(function(){});
      }
    }
    state = saved && saved.v === 1 ? saved : _defaultState();
    if (CUR_SHOW.name && state.title === 'Diagramme reseau') state.title = CUR_SHOW.name;
    loaded = true;
    if(typeof SectionUndo!=='undefined') SectionUndo.reset('syno', state);
    return true;
  }

  /* ── Coord helpers ── */
  function clientToWorld(cx, cy) {
    var vp = $('sp-viewport');
    if (!vp) return { x:0, y:0 };
    var r = vp.getBoundingClientRect();
    return {
      x:(cx - r.left - view.panX) / view.zoom,
      y:(cy - r.top  - view.panY) / view.zoom,
    };
  }
  /* Bounding box of all current nodes in world coords, with optional padding.
     Always covers at least (0, 0, 1100, 600) so empty diagrams have a default
     canvas. Includes negative coords if any node was placed there. */
  function _worldBounds(pad) {
    pad = pad || 0;
    var minX = 0, minY = 0, maxX = 1100, maxY = 600;
    state.nodes.forEach(function(n){
      var sp = spec(n.type) || { w:140, h:100 };
      if (n.x - pad < minX) minX = n.x - pad;
      if (n.y - pad < minY) minY = n.y - pad;
      if (n.x + sp.w + pad > maxX) maxX = n.x + sp.w + pad;
      if (n.y + sp.h + pad > maxY) maxY = n.y + sp.h + pad;
    });
    return { minX:minX, minY:minY, maxX:maxX, maxY:maxY };
  }
  function nodeCenter(n) {
    var el = document.querySelector('.sp-node[data-id="' + n.id + '"]');
    var vp = $('sp-viewport');
    if (el && vp) {
      var r = el.getBoundingClientRect();
      var vr = vp.getBoundingClientRect();
      var cx = (r.left + r.width/2 - vr.left - view.panX) / view.zoom;
      var cy = (r.top + r.height/2 - vr.top - view.panY) / view.zoom;
      return { x:cx, y:cy, w:r.width / view.zoom, h:r.height / view.zoom };
    }
    var sp2 = spec(n.type) || { w:140, h:100 };
    return { x:n.x + sp2.w/2, y:n.y + sp2.h/2, w:sp2.w, h:sp2.h };
  }

  /* ── Edge geometry — straight line between node edges, clipped to bounding box ── */
  function edgeGeom(c) {
    var fn = nodeById(c.from), tn = nodeById(c.to);
    if (!fn || !tn) return null;
    var a = nodeCenter(fn), b = nodeCenter(tn);
    /* Choose attachment side : left/right edge of each card based on relative position */
    var dx = b.x - a.x, dy = b.y - a.y;
    var horiz = Math.abs(dx) >= Math.abs(dy);
    var p0, p1;
    if (horiz) {
      p0 = { x: a.x + (dx >= 0 ? a.w/2 : -a.w/2), y: a.y };
      p1 = { x: b.x + (dx >= 0 ? -b.w/2 : b.w/2), y: b.y };
    } else {
      p0 = { x: a.x, y: a.y + (dy >= 0 ? a.h/2 : -a.h/2) };
      p1 = { x: b.x, y: b.y + (dy >= 0 ? -b.h/2 : b.h/2) };
    }
    return { p0:p0, p1:p1, mid:{ x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 } };
  }

  /* ── Render palette ── */
  /* ── Custom equipment library — persisted in localStorage ── */
  const CUSTOM_KEY = 'pf_synpro_custom_items';
  function _getCustomItems() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch(e) { return []; }
  }
  function _saveCustomItems(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch(e){}
  }
  function _addCustomItem(item) {
    var list = _getCustomItems();
    list.push(item);
    _saveCustomItems(list);
  }
  function _removeCustomItem(type) {
    _saveCustomItems(_getCustomItems().filter(function(x){ return x.type !== type; }));
  }
  /* Map icon-kind key to one of the builtin icon builders */
  const CUSTOM_ICONS = {
    rack: _iconRack(4), console: _iconConsoleCompact(), io: _iconStagebox(), amp: _iconAmp(),
    speaker: _iconSpeaker(), sub: _iconSub(), top: _iconLineArray(), wedge: _iconWedge(),
    network: _iconSwitch(), wifi: _iconWifi(), reel: _iconReel(), fiber: _iconFiber(),
    mic: _iconMic(), di: _iconDI(), iem: _iconIEM(), computer: _iconComputer(),
    note: _iconNote(),
  };
  function _customSpec(it) {
    return { type: it.type, cat: it.cat || 'Mes equipements', label: it.label, defaultSub: it.sub || '',
             w: it.w || 150, h: it.h || 110, icon: CUSTOM_ICONS[it.iconKind] || CUSTOM_ICONS.rack };
  }
  /* ── Palette state — remembers per-category collapse in localStorage ── */
  const PAL_OPEN_KEY = 'pf_synpro_pal_open';
  function _palOpenState() {
    try { return JSON.parse(localStorage.getItem(PAL_OPEN_KEY) || '{}'); } catch(e){ return {}; }
  }
  function _palSetOpen(cat, open) {
    var s = _palOpenState();
    s[cat] = open;
    try { localStorage.setItem(PAL_OPEN_KEY, JSON.stringify(s)); } catch(e){}
  }

  function _renderPalette() {
    var el = $('sp-pal-list');
    if (!el) return;
    var openState = _palOpenState();

    /* Build a 2-level tree : cat -> { subcat -> [items] }
       Items without subcat go directly under a null key (flat). */
    var tree = {};          /* cat -> { subcat|null -> [html] } */
    var catOrder = [];      /* preserve insertion order */
    function _addItem(it, html) {
      var c = it.cat || 'Divers';
      var s = it.subcat || null;
      if (!tree[c]) { tree[c] = {}; catOrder.push(c); }
      var key = s || '__flat__';
      (tree[c][key] = tree[c][key] || []).push(html);
    }

    LIB.forEach(function(it){ _addItem(it, _palItemHtml(it, false)); });
    /* Custom items always flat under their cat */
    _getCustomItems().forEach(function(it){
      var sp = _customSpec(it);
      _addItem(sp, _palItemHtml(sp, true));
    });

    var h = '';
    h += '<div style="padding:6px 8px 4px"><button class="sp-pal-cat-add" id="sp-pal-add" style="width:100%"><i class="ti ti-plus"></i> Nouvel equipement</button></div>';

    catOrder.forEach(function(c, catIdx) {
      var subcats = tree[c];
      var subcatKeys = Object.keys(subcats);

      /* Total item count for this category */
      var totalCount = subcatKeys.reduce(function(sum, k){ return sum + subcats[k].length; }, 0);

      var defCatOpen = catIdx === 0; /* first cat open by default */
      var isCatOpen = openState.hasOwnProperty(c) ? openState[c] : defCatOpen;
      var catCollapsed = !isCatOpen ? ' collapsed' : '';

      h += '<div class="sp-pal-cat' + catCollapsed + '" data-cat="' + esc(c) + '">';
      h += '<div class="sp-pal-cat-name" data-toggle-cat><span class="sp-pal-cat-chevron">&#9660;</span><span>' + esc(c) + '</span><span class="sp-pal-cat-count">' + totalCount + '</span></div>';
      h += '<div class="sp-pal-cat-items">';

      subcatKeys.forEach(function(sk, subIdx) {
        if (sk === '__flat__') {
          /* No subcat — render items directly */
          h += subcats[sk].join('');
        } else {
          /* Subcategory (brand) collapsible */
          var subKey = c + '/' + sk;
          var defSubOpen = subIdx === 0 && catIdx === 0;
          var isSubOpen = openState.hasOwnProperty(subKey) ? openState[subKey] : defSubOpen;
          var subCollapsed = !isSubOpen ? ' collapsed' : '';
          h += '<div class="sp-pal-subcat' + subCollapsed + '" data-subcat="' + esc(subKey) + '">';
          h += '<div class="sp-pal-subcat-name" data-toggle-sub><span class="sp-pal-sub-chevron">&#9660;</span><span>' + esc(sk) + '</span><span class="sp-pal-subcat-count">' + subcats[sk].length + '</span></div>';
          h += '<div class="sp-pal-subcat-items">' + subcats[sk].join('') + '</div>';
          h += '</div>';
        }
      });

      h += '</div></div>'; /* .sp-pal-cat-items + .sp-pal-cat */
    });

    el.innerHTML = h;

    /* Drag events */
    el.querySelectorAll('.sp-pal-item').forEach(function(item){
      item.addEventListener('dragstart', function(ev){
        ev.dataTransfer.setData('sp/type', item.dataset.type);
        ev.dataTransfer.effectAllowed = 'copy';
      });
    });

    /* Level-1 toggle */
    el.querySelectorAll('[data-toggle-cat]').forEach(function(t){
      t.addEventListener('click', function(){
        var cat = t.closest('.sp-pal-cat');
        cat.classList.toggle('collapsed');
        _palSetOpen(cat.dataset.cat, !cat.classList.contains('collapsed'));
      });
    });

    /* Level-2 toggle */
    el.querySelectorAll('[data-toggle-sub]').forEach(function(t){
      t.addEventListener('click', function(ev){
        ev.stopPropagation(); /* don't bubble to cat toggle */
        var sub = t.closest('.sp-pal-subcat');
        sub.classList.toggle('collapsed');
        _palSetOpen(sub.dataset.subcat, !sub.classList.contains('collapsed'));
      });
    });

    /* Custom item remove */
    el.querySelectorAll('.sp-pal-item-rem').forEach(function(b){
      b.addEventListener('click', function(ev){
        ev.stopPropagation();
        if (confirm('Supprimer cet equipement personnalise ?')) {
          _removeCustomItem(b.dataset.rem);
          _renderPalette();
        }
      });
    });

    var addBtn = el.querySelector('#sp-pal-add');
    if (addBtn) addBtn.addEventListener('click', _openAddItemModal);
  }
  function _palItemHtml(it, custom) {
    var rem = custom ? '<button class="sp-pal-item-rem" data-rem="' + esc(it.type) + '" title="Supprimer">&times;</button>' : '';
    return '<div class="sp-pal-item" draggable="true" data-type="' + esc(it.type) + '" title="Glisser sur le plan"><span class="sp-pal-icon">' + it.icon + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.label) + '</span>' + rem + '</div>';
  }

  /* ── Modal : add custom equipment ── */
  function _openAddItemModal() {
    var m = $('sp-add-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'sp-add-modal';
      m.className = 'sp-modal';
      m.innerHTML = '<div class="sp-modal-card"><div class="sp-modal-title"><i class="ti ti-plus"></i>Nouvel equipement</div><div id="sp-add-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function(e){ if (e.target === m) m.classList.remove('show'); });
    }
    var body = m.querySelector('#sp-add-body');
    /* Suggested categories : existing ones + free text */
    var existing = {};
    LIB.forEach(function(it){ existing[it.cat] = true; });
    _getCustomItems().forEach(function(it){ existing[it.cat || 'Mes equipements'] = true; });
    var catOpts = Object.keys(existing).map(function(c){ return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    /* Icon choices */
    var iconOptList = ['rack','console','io','amp','speaker','sub','top','wedge','network','wifi','reel','fiber','mic','di','iem','computer','note'];
    var iconGrid = iconOptList.map(function(k, i){
      return '<label class="sp-icon-radio" title="' + k + '"><input type="radio" name="sp-add-icon" value="' + k + '"' + (i===0?' checked':'') + '><span class="sp-icon-radio-box">' + CUSTOM_ICONS[k] + '</span></label>';
    }).join('');
    body.innerHTML =
      '<label class="sp-insp-lbl">Nom *</label><input class="sp-insp-inp" id="sp-add-label" placeholder="Ex: Yamaha DM7" autofocus>' +
      '<label class="sp-insp-lbl">Sous-titre</label><input class="sp-insp-inp" id="sp-add-sub" placeholder="Ex: Console FOH 48 voies">' +
      '<label class="sp-insp-lbl">Categorie</label><div style="display:flex;gap:6px"><select class="sp-insp-inp" id="sp-add-catsel" style="flex:1">' + catOpts + '<option value="__new__">+ Nouvelle categorie...</option></select></div>' +
      '<input class="sp-insp-inp" id="sp-add-catnew" placeholder="Nouvelle categorie" style="display:none;margin-top:6px">' +
      '<label class="sp-insp-lbl">Icone</label><div class="sp-icon-grid">' + iconGrid + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn ghost sm" id="sp-add-cancel">Annuler</button><button class="btn sm" id="sp-add-save"><i class="ti ti-device-floppy"></i>Enregistrer</button></div>';
    body.querySelector('#sp-add-catsel').addEventListener('change', function(e){
      body.querySelector('#sp-add-catnew').style.display = e.target.value === '__new__' ? 'block' : 'none';
    });
    body.querySelector('#sp-add-cancel').addEventListener('click', function(){ m.classList.remove('show'); });
    body.querySelector('#sp-add-save').addEventListener('click', function(){
      var label = body.querySelector('#sp-add-label').value.trim();
      if (!label) { toast('Le nom est requis.'); return; }
      var sub = body.querySelector('#sp-add-sub').value.trim();
      var catSel = body.querySelector('#sp-add-catsel').value;
      var cat = catSel === '__new__' ? body.querySelector('#sp-add-catnew').value.trim() || 'Mes equipements' : catSel;
      var iconKind = body.querySelector('input[name=sp-add-icon]:checked').value;
      var id = 'custom.' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      _addCustomItem({ type:id, label:label, sub:sub, cat:cat, iconKind:iconKind });
      _renderPalette();
      m.classList.remove('show');
      toast('Equipement "' + label + '" enregistre.');
    });
    m.classList.add('show');
    setTimeout(function(){ var i = body.querySelector('#sp-add-label'); if (i) i.focus(); }, 30);
  }

  function _renderCablePalette() {
    var el = $('sp-cable-list');
    if (!el) return;
    /* Cable section uses the same collapsible category structure as the
       equipment palette ; collapsed state persisted in localStorage. */
    var openState = _palOpenState();
    var catKey = '_cables_';
    var isOpen = openState.hasOwnProperty(catKey) ? openState[catKey] : true;
    var collapsed = !isOpen ? ' collapsed' : '';
    var items = state.networks.map(function(n){
      var active = activeCable === n.id ? ' active' : '';
      return '<div class="sp-cable-item' + active + '" data-net="' + esc(n.id) + '"><span class="sp-cable-swatch" style="background:' + esc(n.color) + '"></span><span style="flex:1">' + esc(n.name) + '</span></div>';
    }).join('');
    el.innerHTML =
      '<div class="sp-pal-cat' + collapsed + '" data-cat="' + catKey + '">' +
        '<div class="sp-pal-cat-name" data-toggle><span class="sp-pal-cat-chevron">&#9660;</span><span><i class="ti ti-cable" style="margin-right:4px"></i>Cables</span><span class="sp-pal-cat-count">' + state.networks.length + '</span></div>' +
        '<div class="sp-pal-cat-items">' +
          '<button class="sp-pal-cat-add" id="sp-cable-add" style="width:100%"><i class="ti ti-plus"></i> Nouveau type de cable</button>' +
          items +
          '<div style="margin-top:6px;font-size:9px;color:var(--muted);text-align:center;font-family:var(--m);line-height:1.4;padding:4px">Cliquez puis 2 equipements pour relier</div>' +
        '</div>' +
      '</div>';
    el.querySelector('[data-toggle]').addEventListener('click', function(){
      var cat = el.querySelector('.sp-pal-cat');
      cat.classList.toggle('collapsed');
      _palSetOpen(catKey, !cat.classList.contains('collapsed'));
    });
    el.querySelector('#sp-cable-add').addEventListener('click', _openAddCableModal);
    el.querySelectorAll('.sp-cable-item').forEach(function(it){
      it.addEventListener('click', function(){
        var nid = it.dataset.net;
        if (activeCable === nid) {
          activeCable = null;
          cableFrom = null;
        } else {
          activeCable = nid;
          cableFrom = null;
        }
        _renderCablePalette();
        _updateBanner();
      });
    });
  }

  /* ── Modal : add a new cable type / network ── */
  function _openAddCableModal() {
    var m = $('sp-add-cable-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'sp-add-cable-modal';
      m.className = 'sp-modal';
      m.innerHTML = '<div class="sp-modal-card"><div class="sp-modal-title"><i class="ti ti-cable"></i>Nouveau type de cable</div><div id="sp-add-cable-body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function(e){ if (e.target === m) m.classList.remove('show'); });
    }
    var body = m.querySelector('#sp-add-cable-body');
    var palette = ['#ea8a3b','#5db865','#1d9bf0','#a855f7','#f43f5e','#fbbf24','#22d3ee','#10b981','#ec4899','#94a3b8','#dc2626','#facc15','#1f2937','#ef4444'];
    var defColor = palette[state.networks.length % palette.length];
    body.innerHTML =
      '<label class="sp-insp-lbl">Nom du cable / reseau *</label>' +
      '<input class="sp-insp-inp" id="sp-cab-name" placeholder="Ex: Ethernet CAT6, Optocore, Word Clock..." autofocus>' +
      '<label class="sp-insp-lbl">Couleur</label>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input type="color" id="sp-cab-color" value="' + defColor + '" style="width:42px;height:30px;border:none;cursor:pointer;border-radius:4px"><span style="font-size:10px;color:var(--muted)">Trait colore sur le synoptique &middot; legende</span></div>' +
      '<div style="font-size:10px;color:var(--muted);background:var(--surf2);border:1px solid var(--bdr);border-radius:6px;padding:8px 10px;line-height:1.5;margin-top:8px"><i class="ti ti-info-circle" style="color:var(--ora)"></i> Une fois cree, ce type sera disponible pour tracer des cables. L\'etiquette individuelle (ex: <i>"RJ45 5m"</i>) se modifie sur chaque cable.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn ghost sm" id="sp-cab-cancel">Annuler</button><button class="btn sm" id="sp-cab-save"><i class="ti ti-device-floppy"></i>Enregistrer</button></div>';
    body.querySelector('#sp-cab-cancel').addEventListener('click', function(){ m.classList.remove('show'); });
    body.querySelector('#sp-cab-save').addEventListener('click', function(){
      var name = body.querySelector('#sp-cab-name').value.trim();
      if (!name) { toast('Le nom est requis.'); return; }
      var color = body.querySelector('#sp-cab-color').value;
      var id = 'cab.' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      state.networks.push({ id:id, name:name, color:color });
      scheduleSave();
      _renderCablePalette();
      _renderLegend();
      m.classList.remove('show');
      toast('Type de cable "' + name + '" ajoute.');
    });
    var inp = body.querySelector('#sp-cab-name');
    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') body.querySelector('#sp-cab-save').click(); });
    m.classList.add('show');
    setTimeout(function(){ if (inp) inp.focus(); }, 30);
  }

  function _updateBanner() {
    var b = $('sp-banner');
    if (!b) return;
    if (activeCable) {
      var n = netById(activeCable);
      b.innerHTML = '<i class="ti ti-cable"></i>Cable <b>' + esc(n ? n.name : activeCable) + '</b> &mdash; ' + (cableFrom ? 'cliquez la 2eme equipement' : 'cliquez la 1ere equipement') + ' <button onclick="SynPro.cancelCable()">Esc</button>';
      b.classList.add('show');
    } else {
      b.classList.remove('show');
    }
  }

  /* ── Render nodes ── */
  function _renderNodes() {
    var host = $('sp-nodes');
    if (!host) return;
    var h = '';
    state.nodes.forEach(function(n){
      var sp = spec(n.type);
      var label = n.label || (sp ? sp.label : '');
      var sub = n.sub != null ? n.sub : (sp ? sp.defaultSub : '');
      var w = sp ? sp.w : 140;
      var sel = (selected.kind === 'node' && selected.id === n.id) ? ' sel' : '';
      var target = (activeCable && cableFrom && cableFrom !== n.id) ? ' target-hint' : '';
      var iconHtml = '';
      if (n.type === 'note') {
        iconHtml = '<div class="sp-node-card" style="background:#fef3c7;border-color:#fbbf24;min-width:180px;padding:10px 14px"><div style="font-size:12px;color:#92400e;line-height:1.4;font-weight:600;white-space:pre-wrap">' + esc(label || 'Note') + '</div>' + (sub ? '<div style="font-size:10px;color:#a16207;margin-top:4px;white-space:pre-wrap">' + esc(sub) + '</div>' : '') + '</div>';
      } else if (n.type === 'text_label') {
        iconHtml = '<div style="font-family:Outfit,sans-serif;font-size:14px;font-weight:700;color:var(--txt);white-space:pre-wrap;min-width:80px;padding:4px 2px;cursor:grab;user-select:none">' + esc(label || 'Texte') + '</div>';
      } else if (n.type === 'image_frame') {
        /* Image flottante indépendante — au RATIO de l'image (pas de carré). */
        var ifAsp = n.imgAspect || 1;
        var ifW = (n.imgPx || 120);
        var ifH = Math.max(1, Math.round(ifW / ifAsp));
        if(n.iconImg && !n.imgAspect && !n._aspChk){
          n._aspChk=true;
          var _sim=new Image();
          _sim.onload=function(){ if(_sim.naturalHeight){ n.imgAspect=_sim.naturalWidth/_sim.naturalHeight; render(); } };
          _sim.src=n.iconImg;
        }
        var spHS=7;
        var spHandles = (sel && n.iconImg)
          ? '<div class="sp-rsz sp-rsz-nw" data-id="'+n.id+'" data-corner="nw" style="left:'+(-spHS)+'px;top:'+(-spHS)+'px"></div>'
            + '<div class="sp-rsz sp-rsz-ne" data-id="'+n.id+'" data-corner="ne" style="left:'+(ifW-spHS)+'px;top:'+(-spHS)+'px"></div>'
            + '<div class="sp-rsz sp-rsz-sw" data-id="'+n.id+'" data-corner="sw" style="left:'+(-spHS)+'px;top:'+(ifH-spHS)+'px"></div>'
            + '<div class="sp-rsz sp-rsz-se" data-id="'+n.id+'" data-corner="se" style="left:'+(ifW-spHS)+'px;top:'+(ifH-spHS)+'px"></div>'
          : '';
        iconHtml = n.iconImg
          ? '<img src="' + _safeImgSrc(n.iconImg) + '" style="width:'+ifW+'px;height:'+ifH+'px;object-fit:fill;border-radius:6px;display:block;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.15)"/>'
            + (label ? '<div class="sp-node-label" style="margin-top:4px">'+esc(label)+'</div>' : '')
            + spHandles
          : '<div style="width:'+ifW+'px;height:'+ifW+'px;border:2px dashed var(--bdr2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:6px" onclick="SynPro.uploadNodeIcon(\''+n.id+'\')">'
            + '<i class="ti ti-photo" style="font-size:28px;color:var(--muted)"></i>'
            + '<span style="font-size:10px;color:var(--muted);font-family:var(--m)">Ajouter une image</span></div>';
      } else if (n.iconImg) {
        /* Custom image icon with adaptive size */
        var imgSz = (n.imgPx || 90) + 'px';
        iconHtml = '<div class="sp-node-card"><div class="sp-node-icon" style="width:'+imgSz+';height:'+imgSz+';background:transparent"><img src="' + _safeImgSrc(n.iconImg) + '" style="width:100%;height:100%;object-fit:contain;border-radius:4px;pointer-events:none"/></div><div class="sp-node-label">' + esc(label) + '</div>' + (sub ? '<div class="sp-node-sub">' + esc(sub).replace(/\n/g,'<br>') + '</div>' : '') + '</div>';
      } else {
        var icon = sp ? sp.icon : _iconRack(3);
        iconHtml = '<div class="sp-node-card"><div class="sp-node-icon">' + icon + '</div><div class="sp-node-label">' + esc(label) + '</div>' + (sub ? '<div class="sp-node-sub">' + esc(sub).replace(/\n/g, '<br>') + '</div>' : '') + '</div>';
      }
      var nodeMinW = (n.type === 'image_frame') ? '0' : w + 'px';
      h += '<div class="sp-node' + sel + target + '" data-id="' + n.id + '" data-type="' + esc(n.type) + '" style="left:' + n.x + 'px;top:' + n.y + 'px;min-width:' + nodeMinW + '">' + iconHtml + '<button type="button" class="sp-node-del" data-del="' + n.id + '" title="Supprimer">&times;</button></div>';
    });
    host.innerHTML = h;
  }

  /* ── Render edges (SVG) ── */
  function _renderEdges() {
    var svg = $('sp-edges');
    if (!svg) return;
    var b = _worldBounds(80);
    var sw = b.maxX - b.minX, sh = b.maxY - b.minY;
    svg.style.left = b.minX + 'px';
    svg.style.top  = b.minY + 'px';
    svg.setAttribute('width', sw);
    svg.setAttribute('height', sh);
    svg.setAttribute('viewBox', b.minX + ' ' + b.minY + ' ' + sw + ' ' + sh);

    /* Arrow head size in world units */
    var ARR = 13;

    /* Build defs — one arrowhead pair per network color.
       refX=ARR-1 so the arrow TIP aligns exactly with the path endpoint (no overshoot). */
    var colorSet = {};
    state.cables.forEach(function(c){
      var net = netById(c.network) || { color:'#5a6a80' };
      colorSet[net.color] = true;
    });
    var defs = '<defs>';
    Object.keys(colorSet).forEach(function(col){
      var id = 'arr-' + col.replace('#','');
      defs += '<marker id="' + id + '-fwd" markerWidth="' + ARR + '" markerHeight="' + ARR + '" refX="' + (ARR - 1) + '" refY="' + (ARR/2) + '" orient="auto" markerUnits="userSpaceOnUse">' +
              '<path d="M1,' + (ARR*0.18) + ' L' + (ARR-1) + ',' + (ARR/2) + ' L1,' + (ARR*0.82) + ' Z" fill="' + col + '"/></marker>';
      defs += '<marker id="' + id + '-bwd" markerWidth="' + ARR + '" markerHeight="' + ARR + '" refX="1" refY="' + (ARR/2) + '" orient="auto-start-reverse" markerUnits="userSpaceOnUse">' +
              '<path d="M1,' + (ARR*0.18) + ' L' + (ARR-1) + ',' + (ARR/2) + ' L1,' + (ARR*0.82) + ' Z" fill="' + col + '"/></marker>';
    });
    defs += '</defs>';

    /* Group cables by canonical pair key so parallel cables get distinct curves */
    var pairGroups = {};
    state.cables.forEach(function(c){
      if (!nodeById(c.from) || !nodeById(c.to)) return;
      var key = [c.from, c.to].sort().join('|');
      (pairGroups[key] = pairGroups[key] || []).push(c.id);
    });

    var html = defs;
    state.cables.forEach(function(c){
      var g = edgeGeom(c);
      if (!g) return;
      var net = netById(c.network) || { color:'#5a6a80', name:'' };
      var sel = (selected.kind === 'cable' && selected.id === c.id);
      var lw  = sel ? 4 : 2.5;

      /* Parallel cable handling — offset each cable perpendicularly (true parallel lines) */
      var key = [c.from, c.to].sort().join('|');
      var group  = pairGroups[key] || [c.id];
      var idx    = group.indexOf(c.id);
      var count  = group.length;

      var p0 = g.p0, p1 = g.p1;

      /* Unit vectors along + perpendicular to the line */
      var dx = p1.x - p0.x, dy = p1.y - p0.y;
      var linLen = Math.sqrt(dx*dx + dy*dy) || 1;
      var ux = dx / linLen, uy = dy / linLen;          /* along */
      var perpX = -uy, perpY = ux;                      /* perpendicular */

      /* Offset: cables spaced by STEP px, centered around 0 */
      var STEP = 16;  /* px between parallel cables */
      var totalSpan = (count - 1) * STEP;
      var offset = idx * STEP - totalSpan / 2;

      /* Pull endpoints back from the box edges so arrows don't touch the cards */
      var GAP = 7;
      var sx0 = p0.x + perpX * offset + ux * GAP, sy0 = p0.y + perpY * offset + uy * GAP;
      var sx1 = p1.x + perpX * offset - ux * GAP, sy1 = p1.y + perpY * offset - uy * GAP;
      var midX = (sx0 + sx1) / 2, midY = (sy0 + sy1) / 2;

      var d = 'M' + sx0 + ',' + sy0 + ' L' + sx1 + ',' + sy1;

      /* Arrow markers */
      var dir = c.dir || 'none';
      var colId = net.color.replace('#','');
      var mEnd   = (dir === 'forward'  || dir === 'both') ? ' marker-end="url(#arr-'   + colId + '-fwd)"' : '';
      var mStart = (dir === 'backward' || dir === 'both') ? ' marker-start="url(#arr-' + colId + '-bwd)"' : '';

      html += '<path class="sp-edge-hit" data-cid="' + c.id + '" d="' + d + '" stroke="' + net.color + '" stroke-width="14" fill="none"/>';
      html += '<path class="sp-edge' + (sel ? ' sel' : '') + '" data-cid="' + c.id + '" d="' + d + '" stroke="' + net.color + '" stroke-width="' + lw + '" stroke-linecap="butt" fill="none"' + mEnd + mStart + '/>';

      /* Label — for parallel cables, push each label further out perpendicular so they never overlap */
      if (c.label && c.label.trim()) {
        var lines = c.label.split('\n');
        var lh = 12, totalH = lines.length * lh;
        var maxW = 0;
        lines.forEach(function(ln){ maxW = Math.max(maxW, ln.length); });
        var bw = Math.min(160, maxW * 6.5 + 12);
        /* Extra perpendicular separation so each label sits on its own band */
        var labelGap = (count > 1) ? (idx - (count - 1) / 2) * (totalH + 10) : 0;
        var lx = midX + perpX * labelGap, ly = midY + perpY * labelGap;
        html += '<rect x="' + (lx - bw/2) + '" y="' + (ly - totalH/2 - 3) + '" width="' + bw + '" height="' + (totalH + 6) + '" rx="3" fill="#fff" opacity=".94"/>';
        lines.forEach(function(ln, i){
          html += '<text x="' + lx + '" y="' + (ly - totalH/2 + lh/2 + 3 + i*lh) + '" text-anchor="middle" font-family="Outfit,sans-serif" font-size="10" font-weight="500" fill="' + net.color + '">' + esc(ln) + '</text>';
        });
      }
    });
    svg.innerHTML = html;
  }

  /* ── Render legend — only networks with at least one cable instance ── */
  function _renderLegend() {
    var el = $('sp-legend');
    if (!el) return;
    var used = {};
    state.cables.forEach(function(c){ used[c.network] = true; });
    var h = '';
    state.networks.forEach(function(n){
      if (!used[n.id]) return;
      h += '<span class="sp-legend-item"><span class="sp-legend-line" style="background:' + esc(n.color) + '"></span>' + esc(n.name) + '</span>';
    });
    el.innerHTML = h;
  }

  /* ── Render header / footer ── */
  function _renderHeader() {
    var headTitle = $('sp-doc-title-h'); if (headTitle) headTitle.textContent = state.title;
    var topTitle = $('sp-doc-title'); if (topTitle) topTitle.textContent = state.title;
    var fEl = $('sp-footer'); if (fEl) fEl.textContent = state.footer;
    var head = document.querySelector('.sp-doc-head');
    if (head) head.style.background = state.headerColor || '#1d9bf0';
  }

  /* ── Render inspector ── */
  function _renderInspector() {
    var el = $('sp-inspector');
    if (!el) return;
    if (selected.kind === 'node') {
      var n = nodeById(selected.id);
      if (!n) { selected = { kind:null, id:null }; _renderInspector(); return; }
      var sp = spec(n.type);
      var nId = n.id;
      el.innerHTML =
        '<div class="sp-insp-title"><i class="ti ti-box"></i>' + esc(sp ? sp.label : n.type) + '</div>' +
        '<label class="sp-insp-lbl">Nom affiche</label>' +
        '<input class="sp-insp-inp" id="sp-ins-label" value="' + esc(n.label != null ? n.label : (sp ? sp.label : '')) + '">' +
        '<label class="sp-insp-lbl">Sous-titre</label>' +
        '<textarea class="sp-insp-tx" id="sp-ins-sub" rows="2">' + esc(n.sub != null ? n.sub : (sp ? sp.defaultSub : '')) + '</textarea>' +
        ((n.iconImg || n.type==='image_frame') ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bdr2)"><div style="font-size:9px;font-family:var(--m);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:5px">Taille de l\'image</div><div style="display:flex;align-items:center;gap:7px"><button class="spl-ts-btn" onclick="SynPro.adjImgPx(\''+ nId +'\',-20)">−</button><span id="sp-img-px-lbl" style="flex:1;text-align:center;font-size:10px;color:var(--muted)">'+(n.imgPx||90)+'px</span><button class="spl-ts-btn" onclick="SynPro.adjImgPx(\''+ nId +'\',20)">+</button></div></div>' : '') +
        (n.type !== 'note' && n.type !== 'text_label' ? _iconImgInspHtml(nId, !!n.iconImg, n.iconImg||'', "SynPro.uploadNodeIcon('"+nId+"')", "SynPro.clearNodeIcon('"+nId+"')") : '') +
        '<button class="btn ghost sm" id="sp-ins-del" style="margin-top:12px;width:100%;color:var(--err)"><i class="ti ti-trash"></i>Supprimer</button>';
      $('sp-ins-label').addEventListener('input', function(e){ n.label = e.target.value; var el2 = document.querySelector('.sp-node[data-id="' + n.id + '"] .sp-node-label'); if (el2) el2.textContent = n.label; scheduleSave(); });
      $('sp-ins-sub').addEventListener('input', function(e){ n.sub = e.target.value; var el2 = document.querySelector('.sp-node[data-id="' + n.id + '"] .sp-node-sub'); if (el2) el2.innerHTML = esc(n.sub).replace(/\n/g, '<br>'); scheduleSave(); });
      $('sp-ins-del').addEventListener('click', function(){ deleteNode(n.id); });
    } else if (selected.kind === 'cable') {
      var c = cableById(selected.id);
      if (!c) { selected = { kind:null, id:null }; _renderInspector(); return; }
      var netOpts = state.networks.map(function(nw){
        return '<option value="' + esc(nw.id) + '"' + (c.network === nw.id ? ' selected' : '') + '>' + esc(nw.name) + '</option>';
      }).join('');
      var dir = c.dir || 'none';
      el.innerHTML =
        '<div class="sp-insp-title"><i class="ti ti-cable"></i>Cable</div>' +
        '<label class="sp-insp-lbl">Reseau</label>' +
        '<select class="sp-insp-inp" id="sp-ins-net">' + netOpts + '</select>' +
        '<label class="sp-insp-lbl">Direction du signal</label>' +
        '<div class="sp-dir-grp" id="sp-ins-dir">' +
          '<button class="sp-dir-btn' + (dir === 'none'     ? ' active' : '') + '" data-dir="none"     title="Sans fleche">&#8212;</button>' +
          '<button class="sp-dir-btn' + (dir === 'forward'  ? ' active' : '') + '" data-dir="forward"  title="De gauche a droite">&#x2192;</button>' +
          '<button class="sp-dir-btn' + (dir === 'backward' ? ' active' : '') + '" data-dir="backward" title="De droite a gauche">&#x2190;</button>' +
          '<button class="sp-dir-btn' + (dir === 'both'     ? ' active' : '') + '" data-dir="both"     title="Bidirectionnel">&#x21C4;</button>' +
        '</div>' +
        '<label class="sp-insp-lbl">Etiquette (ex: Liaison gigaACE RJ45 5m)</label>' +
        '<textarea class="sp-insp-tx" id="sp-ins-clbl" rows="3" placeholder="Type + longueur">' + esc(c.label || '') + '</textarea>' +
        '<button class="btn ghost sm" id="sp-ins-cdel" style="margin-top:12px;width:100%;color:var(--err)"><i class="ti ti-trash"></i>Supprimer le cable</button>';
      $('sp-ins-net').addEventListener('change', function(e){ c.network = e.target.value; _renderEdges(); _renderLegend(); scheduleSave(); });
      $('sp-ins-clbl').addEventListener('input', function(e){ c.label = e.target.value; _renderEdges(); scheduleSave(); });
      $('sp-ins-cdel').addEventListener('click', function(){ deleteCable(c.id); });
      el.querySelectorAll('.sp-dir-btn').forEach(function(btn){
        btn.addEventListener('click', function(){
          c.dir = btn.dataset.dir;
          el.querySelectorAll('.sp-dir-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
          _renderEdges();
          scheduleSave();
        });
      });
    } else {
      el.innerHTML = '<p class="sp-insp-empty">Glissez un equipement depuis la palette sur le plan.<br><br>Pour relier : cliquez un type de cable, puis cliquez deux equipements.</p>';
    }
  }

  /* ── Top-level render ── */
  function render() {
    if (!state) return;
    var world = $('sp-world');
    if (world) world.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(' + view.zoom + ')';
    _updateZoomHud();
    _renderHeader();
    _renderNodes();
    _renderEdges();
    _renderLegend();
    _renderCablePalette();
    _renderInspector();
  }

  /* ── Mutations ── */
  function createNode(type, x, y) {
    var sp = spec(type) || { w:140, h:100, label:type };
    var n = { id: uid(), type:type, x: Math.round(x), y: Math.round(y), label: sp.label, sub: sp.defaultSub || '',
              iconSvg: sp && sp.icon ? sp.icon : '' };
    if(type === 'image_frame') { n.imgPx = 120; n.label = ''; }
    state.nodes.push(n);
    selected = { kind:'node', id: n.id };
    scheduleSave();
    render();
    /* Auto-open file picker for image_frame */
    if(type === 'image_frame') setTimeout(function(){ uploadNodeIcon(n.id); }, 100);
  }
  function deleteNode(id) {
    /* Supprime aussi l'image du serveur (B2) si le nœud en portait une. */
    var _dn = nodeById(id);
    if (_dn && _dn.iconImgB2) _b2DeleteIcon(_dn.iconImgB2);
    state.nodes = state.nodes.filter(function(n){ return n.id !== id; });
    state.cables = state.cables.filter(function(c){ return c.from !== id && c.to !== id; });
    if (selected.id === id) selected = { kind:null, id:null };
    scheduleSave();
    render();
  }
  function deleteCable(id) {
    state.cables = state.cables.filter(function(c){ return c.id !== id; });
    if (selected.id === id) selected = { kind:null, id:null };
    scheduleSave();
    render();
  }
  function createCable(fromId, toId) {
    if (fromId === toId) return;
    /* Allow multiple cables between same pair — no duplicate block */
    var net = netById(activeCable) || state.networks[0];
    state.cables.push({ id: uid(), from: fromId, to: toId, network: net.id, label: '', dir: 'none' });
    scheduleSave();
    render();
  }

  function cancelCable() {
    activeCable = null;
    cableFrom = null;
    _renderCablePalette();
    _updateBanner();
    render();
  }

  /* ── Interactions ── */
  function bindEventsOnce() {
    var vp = $('sp-viewport');
    if (!vp || vp.dataset.bound) return;
    vp.dataset.bound = '1';

    /* Palette drag-drop */
    vp.addEventListener('dragover', function(e){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    vp.addEventListener('drop', function(e){
      e.preventDefault();
      var type = e.dataTransfer.getData('sp/type') || e.dataTransfer.getData('text/plain');
      if (!type) return;
      var sp = spec(type); if (!sp) return;
      var w = clientToWorld(e.clientX, e.clientY);
      createNode(type, w.x - sp.w/2, w.y - sp.h/2);
    });

    /* Wheel — ctrl=zoom, scroll=pan */
    vp.addEventListener('wheel', function(e){
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var f = Math.exp(-e.deltaY * 0.01);
        var r = vp.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        view.panX = mx - (mx - view.panX) * f;
        view.panY = my - (my - view.panY) * f;
        view.zoom = Math.min(3, Math.max(0.2, view.zoom * f));
      } else {
        view.panX -= e.deltaX;
        view.panY -= e.deltaY;
      }
      var w = $('sp-world');
      if (w) w.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(' + view.zoom + ')';
      _updateZoomHud();
    }, { passive:false });

    /* Pointer events */
    vp.addEventListener('pointerdown', function(e){
      if (e.button !== 0 && e.button !== 1) return;

      /* Belt-and-braces : a previous interaction's pointerup may have been
         missed (browser bug, release outside window, focus shift...). Clear
         any stale drag/pan state so this click starts fresh. */
      if (dragging || panning || resizing) {
        dragging = null;
        panning = null;
        resizing = null;
        vp.style.cursor = '';
      }

      var del = e.target.closest('.sp-node-del');
      if (del) { deleteNode(del.dataset.del); return; }

      var rsz = e.target.closest('.sp-rsz');
      if (rsz) {
        var rn = nodeById(rsz.dataset.id); if(!rn) return;
        var rw0 = rn.imgPx||120, rasp = rn.imgAspect||1;
        resizing = { id:rsz.dataset.id, corner:rsz.dataset.corner, x0:rn.x, y0:rn.y, right:rn.x+rw0, bottom:rn.y+rw0/rasp, asp:rasp };
        vp.setPointerCapture(e.pointerId);
        e.preventDefault(); e.stopPropagation(); return;
      }

      var nodeEl = e.target.closest('.sp-node');
      var edgeEl = e.target.closest('.sp-edge-hit,.sp-edge');

      /* Cable-drawing mode : click 2 nodes to connect */
      if (activeCable && nodeEl) {
        e.preventDefault();
        var nid = nodeEl.dataset.id;
        if (!cableFrom) {
          cableFrom = nid;
          _updateBanner();
          render();
        } else if (cableFrom !== nid) {
          createCable(cableFrom, nid);
          cableFrom = null;
          activeCable = null;
          _renderCablePalette();
          _updateBanner();
        } else {
          cableFrom = null;
          _updateBanner();
          render();
        }
        return;
      }

      if (nodeEl) {
        var nid2 = nodeEl.dataset.id;
        var n = nodeById(nid2);
        if (!n) return;
        selected = { kind:'node', id:nid2 };
        /* Apply .sel class immediately so the delete badge becomes visible
           and the user gets visual feedback even before they release */
        document.querySelectorAll('.sp-node').forEach(function(el){
          el.classList.toggle('sel', el.dataset.id === nid2);
        });
        var w = clientToWorld(e.clientX, e.clientY);
        dragging = { id:nid2, ox: w.x - n.x, oy: w.y - n.y, moved:false };
        vp.setPointerCapture(e.pointerId);
        /* Inspector is re-rendered on pointerup so it doesn't interfere
           with the drag (no DOM churn while dragging) */
        e.preventDefault();
        return;
      }

      if (edgeEl) {
        selected = { kind:'cable', id: edgeEl.dataset.cid };
        render();
        e.preventDefault();
        return;
      }

      /* Pan empty canvas — deselect any current selection */
      selected = { kind:null, id:null };
      if (activeCable) { cableFrom = null; _updateBanner(); }
      /* Clear .sel class from every node + edge so visual feedback matches state */
      document.querySelectorAll('.sp-node.sel').forEach(function(el){ el.classList.remove('sel'); });
      _renderEdges();
      _renderInspector();
      panning = { x: e.clientX, y: e.clientY, px: view.panX, py: view.panY };
      vp.setPointerCapture(e.pointerId);
      vp.style.cursor = 'grabbing';
      e.preventDefault();
    });

    vp.addEventListener('pointermove', function(e){
      if (resizing) {
        var rn2 = nodeById(resizing.id);
        if (rn2) {
          var rw = clientToWorld(e.clientX, e.clientY);
          var rc = resizing.corner;
          var nw = (rc==='se'||rc==='ne') ? (rw.x - resizing.x0) : (resizing.right - rw.x);
          nw = Math.max(40, Math.min(900, Math.round(nw)));
          var nh = Math.round(nw / resizing.asp);
          if (rc==='se'){ rn2.x=resizing.x0; rn2.y=resizing.y0; }
          else if (rc==='ne'){ rn2.x=resizing.x0; rn2.y=resizing.bottom-nh; }
          else if (rc==='sw'){ rn2.x=resizing.right-nw; rn2.y=resizing.y0; }
          else { rn2.x=resizing.right-nw; rn2.y=resizing.bottom-nh; }
          rn2.x=Math.round(rn2.x); rn2.y=Math.round(rn2.y);
          rn2.imgPx = nw;
          _renderNodes(); _renderEdges();
        }
        return;
      }
      if (dragging) {
        dragging.moved = true;
        var n = nodeById(dragging.id);
        var el = document.querySelector('.sp-node[data-id="' + dragging.id + '"]');
        if (n && el) {
          var w = clientToWorld(e.clientX, e.clientY);
          /* No clamp : the canvas extends in both directions ; user can
             freely place elements anywhere, including negative coords
             (visible when zoomed out or panned). */
          n.x = Math.round(w.x - dragging.ox);
          n.y = Math.round(w.y - dragging.oy);
          el.style.left = n.x + 'px';
          el.style.top = n.y + 'px';
          _renderEdges();
        }
        return;
      }
      if (!panning) return;
      view.panX = panning.px + (e.clientX - panning.x);
      view.panY = panning.py + (e.clientY - panning.y);
      var world = $('sp-world');
      if (world) world.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(' + view.zoom + ')';
    });

    vp.addEventListener('pointerup', function(){
      vp.style.cursor = '';
      if (resizing) { scheduleSave(); resizing = null; _renderInspector(); return; }
      if (dragging) {
        if (dragging.moved) scheduleSave();
        dragging = null;
        /* Now that the drag is done, refresh inspector for the selected node */
        _renderInspector();
        return;
      }
      panning = null;
    });

    vp.addEventListener('pointercancel', function(){
      vp.style.cursor = '';
      if (resizing) { scheduleSave(); resizing = null; }
      dragging = null;
      panning = null;
    });

    /* If pointer capture is lost (window blur, focus shift, browser bug),
       clean up so the next click can be processed normally. */
    vp.addEventListener('lostpointercapture', function(){
      vp.style.cursor = '';
      if (resizing) { scheduleSave(); resizing = null; _renderInspector(); }
      if (dragging) {
        if (dragging.moved) scheduleSave();
        dragging = null;
        _renderInspector();
      }
      panning = null;
    });

    /* Document-level failsafe : if vp.pointerup never fires (e.g. release
       outside the iframe / window), still clear drag/pan state. */
    document.addEventListener('pointerup', function(){
      if (dragging) {
        if (dragging.moved) scheduleSave();
        dragging = null;
        _renderInspector();
        vp.style.cursor = '';
      }
      if (panning) {
        panning = null;
        vp.style.cursor = '';
      }
    });

    /* Double-click cable or node to focus inspector */
    vp.addEventListener('dblclick', function(e){
      var ne = e.target.closest('.sp-node');
      if (ne) { selected = { kind:'node', id: ne.dataset.id }; _renderInspector(); return; }
      var ee = e.target.closest('.sp-edge-hit,.sp-edge');
      if (ee) { selected = { kind:'cable', id: ee.dataset.cid }; render(); return; }
    });

    /* Toolbar buttons */
    $('sp-zoom-in')?.addEventListener('click', function(){ _zoomBy(1.2); });
    $('sp-zoom-out')?.addEventListener('click', function(){ _zoomBy(1/1.2); });
    $('sp-fit')?.addEventListener('click', fitView);
    $('sp-conf')?.addEventListener('click', _openConfModal);
    $('sp-reset')?.addEventListener('click', _resetDiagram);

    /* Export dropdown */
    var expBtn  = $('sp-export');
    var expMenu = $('sp-export-menu');
    if (expBtn && expMenu) {
      expBtn.addEventListener('click', function(e){
        e.stopPropagation();
        expMenu.classList.toggle('open');
        if (expMenu.classList.contains('open')) _clampMenuToViewport(expMenu);
      });
      document.addEventListener('click', function(){ expMenu.classList.remove('open'); expMenu.style.left=''; expMenu.style.right=''; });
      expMenu.querySelectorAll('.sp-exp-item').forEach(function(item){
        item.addEventListener('click', function(e){
          e.stopPropagation();
          expMenu.classList.remove('open');
          var fmt = item.dataset.fmt;
          if (fmt === 'png')   _exportPng();
          if (fmt === 'svg')   _exportSvg();
          if (fmt === 'pdf')   _openPdfMetaModal();
          if (fmt === 'print') _print();
        });
      });
    }

    /* Zoom HUD — slider + buttons */
    var hudSlider = $('sp-zoom-slider');
    var hudPct    = $('sp-hud-pct');
    if (hudSlider) {
      hudSlider.addEventListener('input', function(){
        view.zoom = parseInt(hudSlider.value) / 100;
        var world = $('sp-world');
        if (world) world.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(' + view.zoom + ')';
        _updateZoomHud();
        _renderEdges();
      });
    }
    $('sp-hud-in')?.addEventListener('click',  function(){ _zoomBy(1.2); });
    $('sp-hud-out')?.addEventListener('click', function(){ _zoomBy(1/1.2); });
    $('sp-hud-fit')?.addEventListener('click', fitView);
    if (hudPct) {
      hudPct.addEventListener('click', function(){
        /* Click the % label → reset to 100% */
        view.zoom = 1;
        var world = $('sp-world');
        if (world) world.style.transform = 'translate(' + view.panX + 'px,' + view.panY + 'px) scale(1)';
        _updateZoomHud();
        _renderEdges();
      });
    }
    /* Keyboard shortcuts */
    document.addEventListener('keydown', function(e){
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === '=')) { e.preventDefault(); fitView(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '+') { e.preventDefault(); _zoomBy(1.2); }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); _zoomBy(1/1.2); }
      /* Cmd/Ctrl+S = force save immediately */
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); _saveNow(); }
    });

    /* Editable header texts (in canvas header) */
    var ttl = $('sp-doc-title-h');
    if (ttl) {
      ttl.addEventListener('click', function(){ _editText(ttl, function(v){ state.title = v; scheduleSave(); _renderHeader(); }); });
    }
    var foot = $('sp-footer');
    if (foot) {
      foot.addEventListener('click', function(){ _editText(foot, function(v){ state.footer = v; scheduleSave(); _renderHeader(); }); });
    }

    /* Escape cancels cable mode */
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && activeCable) {
        cancelCable();
      }
    });
  }

  function _editText(el, onChange) {
    var orig = el.textContent;
    var v = prompt('Modifier :', orig);
    if (v !== null && v !== orig) onChange(v);
  }

  function _updateZoomHud() {
    var pct = Math.round(view.zoom * 100);
    var lbl = $('sp-zoom-lbl'); if (lbl) lbl.textContent = pct + '%';
    var hudPct = $('sp-hud-pct'); if (hudPct) hudPct.textContent = pct + '%';
    var slider = $('sp-zoom-slider'); if (slider) slider.value = Math.min(300, Math.max(20, pct));
  }
  function _zoomBy(f) {
    var vp = $('sp-viewport');
    if (!vp) return;
    var r = vp.getBoundingClientRect();
    var cx = r.width / 2, cy = r.height / 2;
    view.panX = cx - (cx - view.panX) * f;
    view.panY = cy - (cy - view.panY) * f;
    view.zoom = Math.min(3, Math.max(0.2, view.zoom * f));
    render();
  }

  function fitView() {
    var vp = $('sp-viewport');
    if (!vp || !state.nodes.length) { view = { zoom:1, panX:0, panY:0 }; render(); return; }
    var r = vp.getBoundingClientRect();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.nodes.forEach(function(n){
      var sp = spec(n.type) || { w:140, h:100 };
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + sp.w); maxY = Math.max(maxY, n.y + sp.h);
    });
    var pad = 40;
    var bw = maxX - minX + pad*2;
    var bh = maxY - minY + pad*2;
    var zoom = Math.min(r.width / bw, r.height / bh, 1.5);
    view.zoom = zoom;
    view.panX = (r.width - bw * zoom) / 2 - (minX - pad) * zoom;
    view.panY = (r.height - bh * zoom) / 2 - (minY - pad) * zoom;
    render();
  }

  function _resetDiagram() {
    if (!confirm('Vider entierement le synoptique ?')) return;
    state = _defaultState();
    if (CUR_SHOW && CUR_SHOW.name) state.title = CUR_SHOW.name;
    selected = { kind:null, id:null };
    scheduleSave();
    render();
  }

  function _openConfModal() {
    var m = $('sp-conf-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'sp-conf-modal';
      m.className = 'sp-modal';
      m.innerHTML = '<div class="sp-modal-card"><div class="sp-modal-title"><i class="ti ti-settings"></i>Marque, titre &amp; reseaux</div><div id="sp-conf-body"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn ghost sm" id="sp-conf-close">Fermer</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function(e){ if (e.target === m) m.classList.remove('show'); });
    }
    var body = m.querySelector('#sp-conf-body');
    var netRows = state.networks.map(function(n, i){
      return '<div class="sp-net-row" data-i="' + i + '"><span class="sp-cable-swatch" style="background:' + esc(n.color) + ';width:30px;height:6px"></span><input type="text" value="' + esc(n.name) + '" data-f="name"><input type="color" value="' + esc(n.color) + '" data-f="color"><button type="button" class="btn ghost" data-rem="' + i + '">&times;</button></div>';
    }).join('');
    body.innerHTML =
      '<div class="sp-modal-section"><div class="sp-modal-section-title">Titre du document</div><input class="sp-insp-inp" id="sp-cf-title" value="' + esc(state.title) + '"></div>' +
      '<div class="sp-modal-section"><div class="sp-modal-section-title">Couleur du bandeau</div><div style="display:flex;gap:8px;align-items:center"><input type="color" id="sp-cf-headcol" value="' + esc(state.headerColor || '#1d9bf0') + '" style="width:42px;height:30px;border:none;cursor:pointer;border-radius:4px"><span style="font-size:10px;color:var(--muted)">Couleur de fond du bandeau de titre</span></div></div>' +
      '<div class="sp-modal-section"><div class="sp-modal-section-title">Pied de page</div><input class="sp-insp-inp" id="sp-cf-footer" value="' + esc(state.footer) + '"></div>' +
      '<div class="sp-modal-section"><div class="sp-modal-section-title">Types de cables</div>' + netRows + '<button class="btn sm" id="sp-cf-addnet" style="margin-top:8px"><i class="ti ti-plus"></i>Ajouter un type</button></div>';
    body.querySelector('#sp-cf-headcol').addEventListener('input', function(e){ state.headerColor = e.target.value; scheduleSave(); _renderHeader(); });
    body.querySelector('#sp-cf-title').addEventListener('input', function(e){ state.title = e.target.value; scheduleSave(); _renderHeader(); });
    body.querySelector('#sp-cf-footer').addEventListener('input', function(e){ state.footer = e.target.value; scheduleSave(); _renderHeader(); });
    body.querySelectorAll('.sp-net-row').forEach(function(row){
      var i = parseInt(row.dataset.i, 10);
      row.querySelectorAll('input').forEach(function(inp){
        inp.addEventListener('input', function(){
          var f = inp.dataset.f;
          state.networks[i][f] = inp.value;
          if (f === 'color') row.querySelector('.sp-cable-swatch').style.background = inp.value;
          scheduleSave();
          _renderCablePalette();
          _renderEdges();
          _renderLegend();
        });
      });
      var rem = row.querySelector('[data-rem]');
      if (rem) {
        rem.addEventListener('click', function(){
          if (state.networks.length <= 1) { toast('Au moins un reseau requis.'); return; }
          var removed = state.networks.splice(i, 1)[0];
          /* Reassign cables of this network to the first remaining one */
          state.cables.forEach(function(c){ if (c.network === removed.id) c.network = state.networks[0].id; });
          scheduleSave();
          render();
          _openConfModal(); /* re-render modal */
        });
      }
    });
    body.querySelector('#sp-cf-addnet').addEventListener('click', function(){
      var palette = ['#ea8a3b','#5db865','#1d9bf0','#a855f7','#f43f5e','#fbbf24','#22d3ee','#a0a4ab'];
      var color = palette[state.networks.length % palette.length];
      state.networks.push({ id:'NET'+state.networks.length, name:'Reseau '+(state.networks.length+1), color:color });
      scheduleSave();
      render();
      _openConfModal();
    });
    m.querySelector('#sp-conf-close').addEventListener('click', function(){ m.classList.remove('show'); });
    m.classList.add('show');
  }

  /* ── PNG export — render canvas to image ── */
  /* ── Build export SVG string (shared by PNG, PDF, SVG exports) ── */
  function _buildExportSvg(opts) {
    opts = opts || {};
    var skipHeader = !!opts.skipHeader; /* pour les PDF qui ont déjà leur propre en-tête */
    var b = _worldBounds(40);
    var ox = -b.minX, oy = -b.minY;
    var canvasW = b.maxX - b.minX;
    var canvasH = b.maxY - b.minY;
    var headH = skipHeader ? 0 : 56, footH = 42;
    var fullW = canvasW, fullH = canvasH + headH + footH;

    /* ── Arrow defs (same logic as _renderEdges) ── */
    var ARR = 13;
    var colorSet = {};
    state.cables.forEach(function(c){ var net = netById(c.network)||{color:'#5a6a80'}; colorSet[net.color]=true; });
    var defs = '<defs>';
    Object.keys(colorSet).forEach(function(col){
      var id = 'arr-' + col.replace('#','');
      defs += '<marker id="' + id + '-fwd" markerWidth="' + ARR + '" markerHeight="' + ARR + '" refX="' + (ARR-1) + '" refY="' + (ARR/2) + '" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,' + (ARR*0.18) + ' L' + (ARR-1) + ',' + (ARR/2) + ' L1,' + (ARR*0.82) + ' Z" fill="' + col + '"/></marker>';
      defs += '<marker id="' + id + '-bwd" markerWidth="' + ARR + '" markerHeight="' + ARR + '" refX="1" refY="' + (ARR/2) + '" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,' + (ARR*0.18) + ' L' + (ARR-1) + ',' + (ARR/2) + ' L1,' + (ARR*0.82) + ' Z" fill="' + col + '"/></marker>';
    });
    /* Clip to prevent nodes/cables from overflowing canvas area */
    defs += '<clipPath id="exp-clip"><rect x="0" y="' + headH + '" width="' + fullW + '" height="' + canvasH + '"/></clipPath>';
    defs += '</defs>';

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + fullW + '" height="' + fullH + '" viewBox="0 0 ' + fullW + ' ' + fullH + '">' + defs;

    /* White background */
    svg += '<rect width="' + fullW + '" height="' + fullH + '" fill="#ffffff"/>';

    if (!skipHeader) {
      /* Header band */
      svg += '<rect x="0" y="0" width="' + fullW + '" height="' + headH + '" fill="' + esc(state.headerColor || '#1d3a5f') + '"/>';
      svg += '<text x="' + (fullW/2) + '" y="' + (headH/2+8) + '" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="700" font-size="22" fill="#ffffff">' + esc(state.title) + '</text>';
      /* Thin separator line between header and canvas */
      svg += '<line x1="0" y1="' + headH + '" x2="' + fullW + '" y2="' + headH + '" stroke="#e2e8f0" stroke-width="1"/>';
    }

    /* nodeCenterExport : version SANS DOM utilisée exclusivement pour l'export.
       nodeCenter() utilise getBoundingClientRect() qui retourne {0,0,0,0}
       quand l'onglet synoptique est caché (ex: export depuis onglet Équipe).
       Ici on se base uniquement sur n.x/n.y stockés dans state — toujours fiables. */
    function nodeCenterExport(n) {
      var sp2 = spec(n.type) || { w:140, h:100 };
      return { x: n.x + sp2.w/2, y: n.y + sp2.h/2, w: sp2.w, h: sp2.h };
    }
    function edgeGeomExport(c) {
      var fn = nodeById(c.from), tn = nodeById(c.to);
      if (!fn || !tn) return null;
      var a = nodeCenterExport(fn), b = nodeCenterExport(tn);
      var dx = b.x - a.x, dy = b.y - a.y;
      var horiz = Math.abs(dx) >= Math.abs(dy);
      var p0, p1;
      if (horiz) {
        p0 = { x: a.x + (dx >= 0 ? a.w/2 : -a.w/2), y: a.y };
        p1 = { x: b.x + (dx >= 0 ? -b.w/2 : b.w/2), y: b.y };
      } else {
        p0 = { x: a.x, y: a.y + (dy >= 0 ? a.h/2 : -a.h/2) };
        p1 = { x: b.x, y: b.y + (dy >= 0 ? -b.h/2 : b.h/2) };
      }
      return { p0:p0, p1:p1, mid:{ x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 } };
    }

    /* ── Parallel cable groups (same logic as _renderEdges) ── */
    var pairGroups = {};
    state.cables.forEach(function(c){
      if (!nodeById(c.from) || !nodeById(c.to)) return;
      var key = [c.from, c.to].sort().join('|');
      (pairGroups[key] = pairGroups[key] || []).push(c.id);
    });

    /* ── Cables — utilise edgeGeomExport (basé sur state, pas DOM) ── */
    state.cables.forEach(function(c){
      var g = edgeGeomExport(c);
      if (!g) return;
      var net = netById(c.network) || { color:'#5a6a80', name:'' };

      /* Bezier curve for parallel cables */
      var key = [c.from, c.to].sort().join('|');
      var group = pairGroups[key] || [c.id];
      var idx = group.indexOf(c.id);
      var count = group.length;
      var p0x = g.p0.x + ox, p0y = g.p0.y + oy + headH;
      var p1x = g.p1.x + ox, p1y = g.p1.y + oy + headH;
      var dx = p1x - p0x, dy = p1y - p0y;
      var linLen = Math.sqrt(dx*dx + dy*dy) || 1;
      var ux = dx / linLen, uy = dy / linLen;
      var perpX = -uy, perpY = ux;
      /* Parallel lines — perpendicular offset + gap from box edges */
      var STEP = 16, GAP = 7;
      var totalSpan = (count - 1) * STEP;
      var offset = idx * STEP - totalSpan / 2;
      var sx0 = p0x + perpX * offset + ux * GAP, sy0 = p0y + perpY * offset + uy * GAP;
      var sx1 = p1x + perpX * offset - ux * GAP, sy1 = p1y + perpY * offset - uy * GAP;
      var midX = (sx0 + sx1) / 2, midY = (sy0 + sy1) / 2;
      var d = 'M' + sx0 + ',' + sy0 + ' L' + sx1 + ',' + sy1;

      var dir = c.dir || 'none';
      var colId = net.color.replace('#','');
      var mEnd   = (dir==='forward'  || dir==='both') ? ' marker-end="url(#arr-'   + colId + '-fwd)"' : '';
      var mStart = (dir==='backward' || dir==='both') ? ' marker-start="url(#arr-' + colId + '-bwd)"' : '';

      svg += '<path d="' + d + '" stroke="' + net.color + '" stroke-width="2.5" stroke-linecap="butt" fill="none"' + mEnd + mStart + '/>';

      if (c.label && c.label.trim()) {
        var lines = c.label.split('\n');
        var lh = 12, totalH = lines.length * lh;
        var maxLen = 0;
        lines.forEach(function(ln){ maxLen = Math.max(maxLen, ln.length); });
        var bw = Math.min(160, maxLen * 6.5 + 12);
        var labelGap = (count > 1) ? (idx - (count - 1) / 2) * (totalH + 10) : 0;
        var lx = midX + perpX * labelGap, ly = midY + perpY * labelGap;
        svg += '<rect x="' + (lx-bw/2) + '" y="' + (ly-totalH/2-3) + '" width="' + bw + '" height="' + (totalH+6) + '" rx="3" fill="#ffffff" stroke="' + net.color + '" stroke-width="0.5"/>';
        lines.forEach(function(ln, i){
          svg += '<text x="' + lx + '" y="' + (ly-totalH/2+lh/2+3+i*lh) + '" text-anchor="middle" font-family="Outfit,sans-serif" font-size="10" font-weight="500" fill="' + net.color + '">' + esc(ln) + '</text>';
        });
      }
    });

    /* ── Nodes ── */
    state.nodes.forEach(function(n){
      var sp = spec(n.type) || { w:140, h:100, icon:_iconRack(3) };
      var w = sp.w, h = sp.h;
      var x = n.x + ox, y = n.y + oy + headH;
      var label = n.label != null ? n.label : (sp.label || '');
      var sub   = n.sub   != null ? n.sub   : (sp.defaultSub || '');

      if (n.type === 'note') {
        svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="#fef3c7" stroke="#fbbf24" stroke-width="1.5"/>';
        var noteLines = (label + (sub ? '\n' + sub : '')).split('\n');
        noteLines.forEach(function(nl, i){
          svg += '<text x="' + (x+10) + '" y="' + (y+18+i*14) + '" font-family="Outfit,sans-serif" font-size="11" font-weight="600" fill="#92400e">' + esc(nl) + '</text>';
        });
        return;
      }

      if (n.type === 'text_label') {
        var txtLines = label.split('\n');
        txtLines.forEach(function(tl, i){
          svg += '<text x="' + x + '" y="' + (y+16+i*18) + '" font-family="Outfit,sans-serif" font-size="14" font-weight="700" fill="#1d3a5f">' + esc(tl) + '</text>';
        });
        return;
      }

      if (n.type === 'image_frame') {
        var ifW = n.imgPx || 120;
        var ifH = Math.max(1, Math.round(ifW / (n.imgAspect || 1)));
        if (n.iconImg) {
          svg += '<image x="' + x + '" y="' + y + '" width="' + ifW + '" height="' + ifH + '" href="' + _safeImgSrc(n.iconImg) + '" xlink:href="' + _safeImgSrc(n.iconImg) + '" preserveAspectRatio="none"/>';
          if (label) svg += '<text x="' + (x+ifW/2) + '" y="' + (y+ifH+14) + '" text-anchor="middle" font-family="Outfit,sans-serif" font-size="11" fill="#1d3a5f">' + esc(label) + '</text>';
        }
        return;
      }

      /* Equipment card — white box with border */
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8" fill="#ffffff" stroke="#c8d4e0" stroke-width="1.5"/>';

      /* Icon — proportional, centred in top area */
      var textAreaH = 32; /* reserved height at bottom for label + sub */
      var iconArea  = h - textAreaH - 10;
      var iconSize  = Math.max(20, Math.min(iconArea, w - 20));
      var iconX = x + (w - iconSize) / 2;
      var iconY = y + 6;
      if (n.iconImg) {
        /* Custom image — embed as <image> data URI (xlink:href requis pour SVG-as-img) */
        svg += '<image x="' + iconX + '" y="' + iconY + '" width="' + iconSize + '" height="' + iconSize + '" href="' + _safeImgSrc(n.iconImg) + '" xlink:href="' + _safeImgSrc(n.iconImg) + '" preserveAspectRatio="xMidYMid meet"/>';
      } else if (sp.icon) {
        var iconInner = sp.icon.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
        svg += '<svg x="' + iconX + '" y="' + iconY + '" width="' + iconSize + '" height="' + iconSize + '" overflow="visible">' + iconInner + '</svg>';
      }

      /* Label — centered, just above subtitle area */
      var labelY = y + h - (sub ? 18 : 10);
      svg += '<text x="' + (x+w/2) + '" y="' + labelY + '" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="700" font-size="11" fill="#1d3a5f">' + esc(label) + '</text>';

      /* Subtitle — one or two lines, clipped inside card */
      if (sub) {
        var subLines = sub.split('\n').slice(0,2);
        subLines.forEach(function(sl, i){
          svg += '<text x="' + (x+w/2) + '" y="' + (y+h-6+i*10) + '" text-anchor="middle" font-family="Outfit,sans-serif" font-size="8.5" fill="#64748b">' + esc(sl) + '</text>';
        });
      }
    });

    /* ── Legend (noms de câbles / réseaux) — toujours conservée ── */
    var legY = canvasH + headH + 16;
    var legends = state.networks.filter(function(n){ return state.cables.some(function(c){ return c.network===n.id; }); });
    legends.forEach(function(n, i){
      svg += '<rect x="' + (14+i*140) + '" y="' + (legY-4) + '" width="20" height="4" rx="2" fill="' + n.color + '"/>';
      svg += '<text x="' + (38+i*140) + '" y="' + legY + '" font-family="Outfit,sans-serif" font-size="10" fill="#64748b">' + esc(n.name) + '</text>';
    });

    /* Footer — uniquement si l'utilisateur a défini un texte personnalisé
       (on n'affiche plus la marque "www.patchflow.fr" par défaut) */
    var ftxt = (state.footer || '').trim();
    if (ftxt && ftxt.toLowerCase() !== 'www.patchflow.fr' && ftxt.toLowerCase() !== 'patchflow.fr') {
      svg += '<text x="' + (fullW-14) + '" y="' + (fullH-12) + '" text-anchor="end" font-family="Outfit,sans-serif" font-size="10" font-weight="600" fill="#94a3b8">' + esc(ftxt) + '</text>';
    }
    svg += '</svg>';
    return { svg: svg, w: fullW, h: fullH };
  }

  /* ── SVG → Canvas (Promise) ── */
  function _svgToCanvas(svgStr, w, h, scale) {
    scale = scale || 2;
    return new Promise(function(resolve, reject) {
      var blob = new Blob([svgStr], { type:'image/svg+xml;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var img  = new Image();
      img.onload = function() {
        var c = document.createElement('canvas');
        c.width = w * scale; c.height = h * scale;
        var ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
      img.src = url;
    });
  }

  /* ── Export PNG ── */
  async function _exportPng() {
    try {
      var ex = _buildExportSvg();
      var c = await _svgToCanvas(ex.svg, ex.w, ex.h, 2);
      c.toBlob(function(pngBlob){
        var a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = (state.title || 'synoptique').replace(/\W+/g, '_') + '.png';
        a.click();
      }, 'image/png');
    } catch(e) { toast('Erreur export PNG'); console.error(e); }
  }

  /* ── Export SVG ── */
  function _exportSvg() {
    var ex = _buildExportSvg();
    var blob = new Blob([ex.svg], { type:'image/svg+xml;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.title || 'synoptique').replace(/\W+/g, '_') + '.svg';
    a.click();
  }

  /* ── Load jsPDF on demand ── */
  function _getJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function(){ resolve(window.jspdf.jsPDF); };
      s.onerror = function(){ reject(new Error('jsPDF load failed')); };
      document.head.appendChild(s);
    });
  }

  /* ── Export PDF — A4, image fitted with margins ── */
  /* ── PDF meta modal — title / subtitle / venue / date / link / contact / notes ── */
  const PDF_META_KEY = 'pf_synpro_pdfmeta';
  function _loadPdfMeta() {
    try { return JSON.parse(localStorage.getItem(PDF_META_KEY) || '{}'); } catch(e) { return {}; }
  }
  function _savePdfMeta(m) {
    try { localStorage.setItem(PDF_META_KEY, JSON.stringify(m)); } catch(e) {}
  }
  function _openPdfMetaModal() {
    /* Pre-fill synoptique title into the unified pdf-title field */
    var titleEl = document.getElementById('pdf-title');
    if (titleEl && !titleEl.value && state.title) titleEl.value = state.title;
    openPDFModal('syno');
  }

  async function _exportPdf(meta) {
    try {
      toast('Generation PDF en cours…');
      meta = meta || {};
      var ex = _buildExportSvg();
      /* Render at 3x for sharp PDF quality */
      var c = await _svgToCanvas(ex.svg, ex.w, ex.h, 3);
      var imgData = c.toDataURL('image/jpeg', 0.96);

      var JsPDF = await _getJsPdf();
      /* A4 — orientation based on diagram ratio */
      var ratio = ex.w / ex.h;
      var orientation = ratio >= 1.1 ? 'landscape' : 'portrait';
      var pdf = new JsPDF({ orientation: orientation, unit: 'pt', format: 'a4', compress: true });
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();

      /* Reserve a footer band for meta info (only if there is any meta to show) */
      var hasMeta = meta.sub || meta.rev || meta.venue || meta.date || meta.eng || meta.contact || meta.link || meta.notes;
      var footerH = hasMeta ? 96 : 0;

      /* Image fills full page width, anchored to top so the orange header
         band touches the very top edge — no top margin. */
      var availH = pageH - footerH;
      var sc = Math.min(pageW / ex.w, availH / ex.h);
      var dw = ex.w * sc, dh = ex.h * sc;
      var dx = (pageW - dw) / 2;
      var dy = 0;
      pdf.addImage(imgData, 'JPEG', dx, dy, dw, dh);

      /* Meta footer band */
      if (hasMeta) {
        var fy = pageH - footerH;
        pdf.setFillColor(245, 247, 250);
        pdf.rect(0, fy, pageW, footerH, 'F');
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.5);
        pdf.line(0, fy, pageW, fy);

        var pad = 24, y = fy + 18;
        pdf.setTextColor(29, 58, 95);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
        var headerLine = [meta.sub, meta.rev, meta.venue, meta.date].filter(Boolean).join('  ·  ');
        if (headerLine) { pdf.text(headerLine, pad, y); y += 14; }

        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
        pdf.setTextColor(100, 116, 139);
        var infoLine = [];
        if (meta.eng)     infoLine.push('Ingenieur : ' + meta.eng);
        if (meta.contact) infoLine.push('Contact : ' + meta.contact);
        if (infoLine.length) { pdf.text(infoLine.join('  ·  '), pad, y); y += 11; }

        if (meta.link) {
          pdf.setTextColor(255, 107, 26);
          pdf.textWithLink(meta.link, pad, y, { url: meta.link });
          y += 11;
        }

        if (meta.notes) {
          pdf.setTextColor(71, 85, 105);
          var noteLines = pdf.splitTextToSize(meta.notes, pageW - pad * 2);
          pdf.text(noteLines.slice(0, 3), pad, y);
        }
      }

      var fname = (meta.title || state.title || 'synoptique').replace(/\W+/g, '_') + '.pdf';
      pdf.save(fname);
    } catch(e) { toast('Erreur export PDF : ' + e.message); console.error(e); }
  }

  /* ── Print — opens diagram in clean window ── */
  function _print() {
    var ex = _buildExportSvg();
    /* Scale SVG to fit A4 landscape width (1122px at 96dpi) */
    var targetW = 1122;
    var sc = targetW / ex.w;
    var win = window.open('', '_blank');
    win.document.write(
      '<html><head><title>' + esc(state.title) + '</title>' +
      '<style>@page{size:A4 landscape;margin:10mm}body{margin:0;background:#fff}' +
      'svg{width:' + Math.round(ex.w*sc) + 'px;height:' + Math.round(ex.h*sc) + 'px;display:block}</style></head>' +
      '<body>' + ex.svg.replace('<svg ', '<svg style="width:100%;height:auto" ') + '</body></html>'
    );
    win.document.close();
    win.focus();
    setTimeout(function(){ win.print(); }, 500);
  }

  /* ── Public API ── */
  function init() {
    if (inited) return;
    /* One-time cleanup of old SynEditor localStorage keys */
    try {
      ['pf_syn_custom_liaisons','pf_syn_cust_amps','pf_syn_cust_spks','pf_syn_cust_infra','pf_syn_names'].forEach(function(k){
        localStorage.removeItem(k);
      });
    } catch(e){}
    bindEventsOnce();
    /* Banner element */
    if (!$('sp-banner')) {
      var b = document.createElement('div');
      b.id = 'sp-banner';
      b.className = 'sp-banner';
      document.body.appendChild(b);
    }
    _renderPalette();
    inited = true;
  }
  function show() {
    init();
    if (!loaded) _load();
    render();
    setTimeout(fitView, 50);
  }
  function resetLoaded() {
    loaded = false;
    state = null;
    selected = { kind:null, id:null };
    activeCable = null;
    cableFrom = null;
    view = { zoom:1, panX:0, panY:0 };
    _injectedSceneData = undefined; // reset sentinel
  }
  function isLoaded() { return loaded; }
  function getData() { return state; }

  /* Force save when page unloads or visibility changes */
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', _saveNow);
    document.addEventListener('visibilitychange', function(){ if (document.hidden) _saveNow(); });
  }

  /* ── Adjust image pixel size ── */
  function adjImgPx(nodeId, delta){
    var n=nodeById(nodeId); if(!n)return;
    n.imgPx=Math.max(40,Math.min(400,(n.imgPx||(n.type==='image_frame'?120:90))+delta));
    var lbl=document.getElementById('sp-img-px-lbl');
    if(lbl)lbl.textContent=n.imgPx+'px';
    scheduleSave(); render();
  }

  /* ── Custom icon upload/clear (Pro) ── */
  function uploadNodeIcon(nodeId){
    _pickIconFile(async function(file){
      try{
        var b64=await _resizeIconToB64(file);
        var n=nodeById(nodeId); if(!n)return;
        var b2Key=(CUR_SHOW?.id||'unknown')+'/node-icons/syno-'+nodeId+'-'+Date.now()+'.jpg';
        _b2DeleteIcon(n.iconImgB2);
        n.iconImg=b64; n.iconImgB2=b2Key;
        n._aspChk=true;
        var _aim=new Image();
        _aim.onload=function(){ if(_aim.naturalHeight){ n.imgAspect=_aim.naturalWidth/_aim.naturalHeight; scheduleSave(); render(); } };
        _aim.src=b64;
        scheduleSave(); render(); _renderInspector();
        _b2UploadIcon(b64, b2Key);
      }catch(e){ toast('Erreur image : '+e.message); }
    });
  }
  function clearNodeIcon(nodeId){
    var n=nodeById(nodeId); if(!n)return;
    _b2DeleteIcon(n.iconImgB2);
    n.iconImg=null; n.iconImgB2=null;
    scheduleSave(); render(); _renderInspector();
  }

  function setSceneId(id){ _activeSceneId = id||null; }
  function setSceneData(data){ _injectedSceneData = (data!==undefined) ? (data||null) : undefined; }
  /* Direct scene loading — avoids the sentinel/resetLoaded race.
     Used by switchScene() and initial scene setup. */
  function loadSceneDirect(data){
    init();
    loaded = false;
    state = (data && data.v === 1) ? data : _defaultState();
    if (CUR_SHOW && CUR_SHOW.name && state.title === 'Diagramme reseau') state.title = CUR_SHOW.name;
    selected = { kind:null, id:null };
    activeCable = null; cableFrom = null;
    view = { zoom:1, panX:0, panY:0 };
    _injectedSceneData = undefined;
    loaded = true;
    if(typeof SectionUndo!=='undefined') SectionUndo.reset('syno', state);
    render();
    setTimeout(fitView, 50);
  }
  function getIconByType(type){ var s=spec(type); return (s&&s.icon)?s.icon:''; }
  /* Restaure un instantané (undo) sans réinitialiser la vue. */
  function setData(d){ if(!d) return; state=d; loaded=true; selected={kind:null,id:null}; render(); }
  return { init, show, render, resetLoaded, isLoaded, getData, setData, cancelCable, _saveNow, buildExportSvg: _buildExportSvg, setSceneId, setSceneData, loadSceneDirect, getIconByType, uploadNodeIcon, clearNodeIcon, adjImgPx };
})();

window.SynPro = SynPro;

// ══════════════════════════════════════
// BAND PLAN
// ══════════════════════════════════════
const BandPlan=(()=>{
  const CATS=[
    {id:'drums',  label:'Batterie',       color:'#ff4d6a', items:[
      {t:'kick',    n:'Grosse caisse',  e:'🥁'},
      {t:'snare',   n:'Caisse claire',  e:'🥁', c:'#ff4d6a'},
      {t:'hihat',   n:'Charleston',     e:'🎵'},
      {t:'toms',    n:'Toms',           e:'🪘'},
      {t:'cymbal',  n:'Cymbale',        e:'✦'},
      {t:'kit',     n:'Kit complet',    e:'🥁'},
      {t:'cajon',   n:'Cajon',          e:'📦', c:'#c03a50'},
    ]},
    {id:'guitar', label:'Guitares',       color:'#f5c542', items:[
      {t:'elec',    n:'Guitare elec.',  e:'🎸'},
      {t:'acou',    n:'Guitare acou.',  e:'🎸', c:'#d4a017'},
      {t:'bass_g',  n:'Basse',          e:'🎸', c:'#22d6a0'},
      {t:'gamp',    n:'Ampli guitare',  e:'🔊', c:'#f5c542'},
      {t:'bamp',    n:'Ampli basse',    e:'🔊', c:'#22d6a0'},
      {t:'cab',     n:'Baffle',         e:'📦', c:'#888'},
    ]},
    {id:'keys',   label:'Claviers',       color:'#9b6aff', items:[
      {t:'keyboard',n:'Clavier',        e:'🎹'},
      {t:'piano',   n:'Piano',          e:'🎹', c:'#7a4aef'},
      {t:'synth',   n:'Synthes.',       e:'🎹', c:'#c4a0ff'},
      {t:'wurly',   n:'Piano electr.',  e:'🎹', c:'#6a3abf'},
    ]},
    {id:'vocals', label:'Voix',           color:'#22d6a0', items:[
      {t:'mic_s',   n:'Pied micro',     e:'🎤'},
      {t:'mic_hf',  n:'Micro HF',       e:'📡', c:'#22d6a0'},
      {t:'iem_p',   n:'IEM (retour)',   e:'🎧'},
    ]},
    {id:'brass',  label:'Cuivres & Bois', color:'#ff6b1a', items:[
      {t:'trumpet', n:'Trompette',      e:'🎺'},
      {t:'trombone',n:'Trombone',       e:'🎷'},
      {t:'sax',     n:'Saxophone',      e:'🎷', c:'#ffa040'},
      {t:'horn',    n:'Cor / Tuba',     e:'🎺', c:'#ffcc60'},
    ]},
    {id:'perc',   label:'Percussions',    color:'#ff9040', items:[
      {t:'timb',    n:'Timbales',       e:'🥁', c:'#cc6000'},
      {t:'conga',   n:'Congas',         e:'🪘', c:'#ff9040'},
      {t:'marimba', n:'Marimba',        e:'🎵', c:'#ff8030'},
      {t:'xyl',     n:'Xylophone',      e:'🎵', c:'#d07020'},
    ]},
    {id:'tech',   label:'Technique',      color:'#1a8fff', items:[
      {t:'foh',     n:'Console FOH',    e:'🎛', c:'#1a8fff'},
      {t:'mon',     n:'Console MON',    e:'🎛', c:'#f5c542'},
      {t:'stagebox',n:'Stage Box',      e:'📦', c:'#5a6580'},
      {t:'di',      n:'Boite DI',       e:'🔌', c:'#5a6580'},
      {t:'iem_r',   n:'Rack IEM',       e:'📡', c:'#9b6aff'},
      {t:'spk',     n:'Enceinte',       e:'🔊', c:'#1a8fff'},
      {t:'sub',     n:'Sub',            e:'📢', c:'#ff6b1a'},
      {t:'wedge',   n:'Retour scene',   e:'🔺', c:'#f5c542'},
    ]},
    {id:'misc',   label:'Divers',         color:'#aabbdd', items:[
      {t:'chair',   n:'Chaise',         e:'💺', c:'#5a6580'},
      {t:'stool',   n:'Tabouret',       e:'🪑', c:'#5a6580'},
      {t:'riser',   n:'Praticable',     e:'▭',  c:'#777'},
      {t:'txt_bp',  n:'Texte libre',    e:'T',  c:'#aabbdd'},
      {t:'image_frame',n:'Image',       e:'🖼', c:'#5a6580'},
    ]},
  ];

  let _customItems=[];
  function _loadCustomItems(){try{const s=localStorage.getItem('bp_custom_items');if(s)_customItems=JSON.parse(s);}catch(e){}}
  function _saveCustomItems(){try{localStorage.setItem('bp_custom_items',JSON.stringify(_customItems));}catch(e){}}
  function addCustomItem(catId){
    const name=prompt('Nom de l\'instrument :','');
    if(!name||!name.trim())return;
    const emoji=prompt('Emoji (ex: 🎺) :','🎸');
    if(emoji===null)return;
    const t='cu_'+Math.random().toString(36).slice(2,8);
    const cat=CATS.find(c=>c.id===catId);
    const c=cat?cat.color:'#aabbdd';
    _customItems.push({catId,t,n:name.trim(),e:(emoji.trim()||'🎸'),c});
    _saveCustomItems();
    renderPalette(document.getElementById('bp-search')?.value||'');
  }
  function removeCustomItem(t){
    if(!confirm('Supprimer cet instrument de la palette ?'))return;
    _customItems=_customItems.filter(i=>i.t!==t);
    _saveCustomItems();
    renderPalette(document.getElementById('bp-search')?.value||'');
  }

  const RISER_SCALE=75;
  const RISER_SIZES=[
    {w:1,  h:1,   label:'1m \xd7 1m'},
    {w:2,  h:1,   label:'2m \xd7 1m'},
    {w:3,  h:1,   label:'3m \xd7 1m'},
    {w:4,  h:1,   label:'4m \xd7 1m'},
    {w:2,  h:0.5, label:'2m \xd7 0.5m'},
    {w:1,  h:0.5, label:'1m \xd7 0.5m'},
    {w:3,  h:2,   label:'3m \xd7 2m'},
    {w:4,  h:2,   label:'4m \xd7 2m'},
  ];
  const RISER_ALTS=[0.2,0.4,0.6,0.8,1.0,1.2];

  let st={els:[],nid:1,view:{z:1,px:80,py:60},cats:{},textScale:1.4,nodeScale:1.4,stageScale:1,viewMode:'vintage',bgImage:null,bgOpacity:100,bgX:0,bgY:0,bgScale:1,hideStage:false};
  let _sel=null,_dn=null,_dnox=0,_dnoy=0,_pan=false,_pox=0,_poy=0,_inited=false,_saveT=0,_bgEdit=false,_bpRsz=null;
  /* Input list (patch) choisie pour la liaison de canaux dans le plan de scène,
     et état du panneau de sélection multiple (kit). */
  let _bpLinkPatch=null,_bpKitMulti=false;
  /* Patch effectif depuis lequel lier — celui choisi, sinon le patch actif. */
  function _linkPatch(){
    const ps=(typeof IL_PATCHES!=='undefined'&&IL_PATCHES.length)?IL_PATCHES:[{id:'main',name:'Patch 1'}];
    if(_bpLinkPatch&&ps.some(p=>p.id===_bpLinkPatch))return _bpLinkPatch;
    return (typeof CUR_PATCH_ID!=='undefined'?CUR_PATCH_ID:'main');
  }
  function setLinkPatch(id){ _bpLinkPatch=id||null; _bpKitMulti=false; renderInspector(); }
  function toggleKitMulti(){
    if(!canDo('bulk_link')){ showUpgradeModal('bulk_link'); return; }
    _bpKitMulti=!_bpKitMulti; renderInspector();
  }
  function linkKitChMulti(){
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='kit')return;
    if(!el.chs)el.chs=[];
    const boxes=document.querySelectorAll('.bp-kit-msel:checked');
    let added=0;
    boxes.forEach(function(b){ if(b.value&&!el.chs.includes(b.value)){el.chs.push(b.value);added++;} });
    _bpKitMulti=false;
    renderNode(el);renderInspector();saveStage();
    if(added) toast(added+' canal'+(added>1?'ux':'')+' lie'+(added>1?'s':'')+' au kit');
    else toast('Aucun canal coché.');
  }
  function kitMultiAll(btn){
    const boxes=document.querySelectorAll('.bp-kit-msel');
    const allOn=Array.prototype.every.call(boxes,function(b){return b.checked;});
    boxes.forEach(function(b){b.checked=!allOn;});
    if(btn)btn.textContent=allOn?'Tout cocher':'Tout décocher';
  }

  function _wrap(){return document.getElementById('bp-canvas-wrap');}
  function _cv(){return document.getElementById('bp-canvas');}

  /* ── Background image (same pattern as SitePlan) ── */
  async function loadBg(input){
    const file=input.files?.[0];
    input.value='';
    if(!file)return;
    if(!/^image\//.test(file.type||'')){typeof toast!=='undefined'&&toast('Format non supporté (image attendue)');return;}
    if(file.size>8*1024*1024){typeof toast!=='undefined'&&toast('Image trop lourde (max 8 Mo)');return;}
    try{
      /* Redimensionne + compresse sous le plafond de stockage avant tout. */
      const dataUrl=await _compressImageToB64(file, 1920, _IMG_STORE_CAP);
      /* Vérifie le quota sur la taille RÉELLEMENT stockée (base64), pas le fichier. */
      if(!await _quotaCheck(_dataUrlBytes(dataUrl))) return;
      st.bgImage=dataUrl;
      /* Nouvelle image → repartir d'un placement ET d'une opacité neutres
         (origine, taille 100%, opacité 100%) pour qu'elle soit toujours
         pleinement visible. */
      st.bgX=0;st.bgY=0;st.bgScale=1;st.bgOpacity=100;
      _applyBg();saveStage();
    }catch(e){ typeof toast!=='undefined'&&toast('Erreur image : '+(e&&e.message||e)); }
  }
  /* Transform CSS de l'image (en coordonnées "monde" : l'image est enfant de
     #bp-canvas qui porte déjà le pan/zoom, donc translate/scale ici = placement
     dans le plan). */
  function _bgTransform(){ return 'translate('+(st.bgX||0)+'px,'+(st.bgY||0)+'px) scale('+(st.bgScale||1)+')'; }
  function _applyBg(){
    const img=document.getElementById('bp-bg-img');
    const ctrl=document.getElementById('bp-bg-controls');
    if(img){
      if(st.bgImage){
        img.src=st.bgImage;img.style.display='block';img.style.opacity=st.bgOpacity/100;
        img.style.transform=_bgTransform();
      }else{ img.src='';img.style.display='none'; }
    }
    if(ctrl)ctrl.style.display=st.bgImage?'block':'none';
    const sl=document.getElementById('bp-bg-opacity');if(sl)sl.value=st.bgOpacity;
    const vl=document.getElementById('bp-bg-opacity-val');if(vl)vl.textContent=Math.round(st.bgOpacity)+'%';
    const ss=document.getElementById('bp-bg-size');if(ss)ss.value=Math.round((st.bgScale||1)*100);
    if(!st.bgImage)_bgEdit=false;
    _updateBgEditUI();
  }
  function setBgOpacity(val){st.bgOpacity=+val;const img=document.getElementById('bp-bg-img');if(img)img.style.opacity=val/100;const vl=document.getElementById('bp-bg-opacity-val');if(vl)vl.textContent=Math.round(+val)+'%';saveStage();}
  function setBgScale(val){
    st.bgScale=Math.max(0.1,Math.min(6,(+val)/100));
    const img=document.getElementById('bp-bg-img');if(img)img.style.transform=_bgTransform();
    _positionBgHandle();saveStage();
  }
  function clearBg(){st.bgImage=null;st.bgOpacity=100;st.bgX=0;st.bgY=0;st.bgScale=1;_bgEdit=false;_applyBg();saveStage();}

  /* ── Afficher / masquer le décor de scène (grille + cadre SCENE/PUBLIC) ── */
  function _applyStageVis(){
    const bg=document.getElementById('bp-stage-svg');
    if(bg) bg.style.display = st.hideStage ? 'none' : 'block';
    const btn=document.getElementById('bp-stage-toggle-btn');
    if(btn){
      btn.innerHTML = st.hideStage
        ? '<i class="ti ti-eye"></i> Afficher la scène'
        : '<i class="ti ti-eye-off"></i> Masquer la scène';
      btn.style.background = st.hideStage ? 'var(--ora)' : '';
      btn.style.color = st.hideStage ? '#04231a' : '';
      btn.style.borderColor = st.hideStage ? 'var(--ora)' : '';
    }
  }
  function toggleStageBg(){ st.hideStage=!st.hideStage; _applyStageVis(); saveStage(); }

  /* ── Déplacement / redimensionnement de l'image de fond ── */
  function toggleBgEdit(){ if(!st.bgImage)return; _bgEdit=!_bgEdit; _updateBgEditUI(); }
  function _updateBgEditUI(){
    const img=document.getElementById('bp-bg-img');
    const btn=document.getElementById('bp-bg-edit-btn');
    const hint=document.getElementById('bp-bg-edit-hint');
    const on=_bgEdit && !!st.bgImage;
    if(img){
      img.style.pointerEvents=on?'auto':'none';
      img.style.outline=on?'2px dashed #ff6b1a':'';
      img.style.outlineOffset=on?'0':'';
      img.style.cursor=on?'move':'';
      img.style.zIndex=on?'9000':'';   /* passe au-dessus des nœuds pendant l'édition */
    }
    if(btn){ btn.style.background=on?'var(--ora)':''; btn.style.color=on?'#04231a':''; btn.style.borderColor=on?'var(--ora)':''; }
    if(hint) hint.style.display=on?'block':'none';
    _positionBgHandle();
  }
  function _ensureBgHandle(){
    let h=document.getElementById('bp-bg-handle');
    if(h) return h;
    const wrap=_wrap(); if(!wrap) return null;
    h=document.createElement('div'); h.id='bp-bg-handle';
    h.style.cssText='position:absolute;width:18px;height:18px;background:#ff6b1a;border:2px solid #fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:nwse-resize;display:none;z-index:9001;touch-action:none';
    wrap.appendChild(h);
    h.addEventListener('pointerdown',_bgHandleDown);
    return h;
  }
  function _positionBgHandle(){
    const h=document.getElementById('bp-bg-handle'); if(!h) return;
    const img=document.getElementById('bp-bg-img'); const wrap=_wrap();
    if(!(_bgEdit && st.bgImage && img && wrap && img.style.display!=='none')){ h.style.display='none'; return; }
    const ir=img.getBoundingClientRect(), wr=wrap.getBoundingClientRect();
    h.style.display='block';
    h.style.left=(ir.right-wr.left-9)+'px';
    h.style.top =(ir.bottom-wr.top-9)+'px';
  }
  function _bgImgDown(e){
    if(!_bgEdit||!st.bgImage) return;
    e.stopPropagation();
    const img=e.currentTarget;
    const sx=e.clientX, sy=e.clientY, ox=st.bgX||0, oy=st.bgY||0;
    try{ img.setPointerCapture(e.pointerId); }catch(_){}
    const mv=ev=>{
      st.bgX=ox+(ev.clientX-sx)/st.view.z;
      st.bgY=oy+(ev.clientY-sy)/st.view.z;
      img.style.transform=_bgTransform();
      _positionBgHandle();
    };
    const up=()=>{ img.removeEventListener('pointermove',mv); img.removeEventListener('pointerup',up); saveStage(); };
    img.addEventListener('pointermove',mv); img.addEventListener('pointerup',up);
  }
  function _bgHandleDown(e){
    if(!_bgEdit||!st.bgImage) return;
    e.stopPropagation(); e.preventDefault();
    const h=e.currentTarget;
    const img=document.getElementById('bp-bg-img'); const wrap=_wrap();
    if(!img||!wrap) return;
    const nW=img.naturalWidth||1;
    const wr=wrap.getBoundingClientRect();
    try{ h.setPointerCapture(e.pointerId); }catch(_){}
    const mv=ev=>{
      /* coin bas-droit suit le pointeur ; scale uniforme calé sur l'axe X (garde le ratio) */
      const pwx=(ev.clientX-wr.left-st.view.px)/st.view.z;
      let sc=(pwx-(st.bgX||0))/nW;
      sc=Math.max(0.1,Math.min(6,sc));
      st.bgScale=sc;
      img.style.transform=_bgTransform();
      const ss=document.getElementById('bp-bg-size'); if(ss)ss.value=Math.round(sc*100);
      _positionBgHandle();
    };
    const up=()=>{ h.removeEventListener('pointermove',mv); h.removeEventListener('pointerup',up); saveStage(); };
    h.addEventListener('pointermove',mv); h.addEventListener('pointerup',up);
  }
  function _catOf(t){return CATS.find(c=>c.items.some(i=>i.t===t))||CATS.find(c=>c.id===(_customItems.find(i=>i.t===t)?.catId))||null;}
  function _itemOf(t){for(const c of CATS){const it=c.items.find(i=>i.t===t);if(it)return it;}return _customItems.find(i=>i.t===t)||null;}
  function _elColor(t){const it=_itemOf(t);const cat=_catOf(t);return(it&&it.c)||(cat&&cat.color)||'#5a6580';}
  function _chNum(chId){const r=_chById(chId);return r?r.ch:'?';}
  const _OUTPUT_TYPES=new Set(['spk','sub','wedge','iem_r','iem_p']);
  function _isOutput(type){return _OUTPUT_TYPES.has(type);}
  function _outChNum(outChId){const r=_outById(outChId);return r?r.ch:'?';}

  // ---- palette ----
  function renderPalette(filter){
    const q=(filter||'').toLowerCase();
    const el=document.getElementById('bp-pal-list');if(!el)return;
    let h='';
    CATS.forEach(cat=>{
      const customs=_customItems.filter(ci=>ci.catId===cat.id&&(!q||ci.n.toLowerCase().includes(q)));
      const items=q?cat.items.filter(i=>i.n.toLowerCase().includes(q)):cat.items;
      if(!items.length&&!customs.length&&q)return;
      const open=st.cats[cat.id]!==false;
      const total=items.length+customs.length;
      h+='<div class="bp-cat'+(open?'':' collapsed')+'">'
        +'<div class="bp-cat-hd" onclick="BandPlan.toggleCat(\''+cat.id+'\')">'
        +'<i class="ti ti-chevron-down" style="font-size:9px;color:var(--ora);transition:transform .15s ease;width:8px;display:inline-block;'+(open?'':'transform:rotate(-90deg)')+'"></i>'
        +'<div class="bp-cat-dot" style="background:'+cat.color+'"></div>'
        +'<span>'+cat.label+'</span>'
        +'<span class="bp-cat-count">'+total+'</span>'
        +'</div>';
      if(open){
        h+='<div class="bp-cat-items">';
        items.forEach(it=>{
          const c=it.c||cat.color;
          /* Use the same vintage SVG as the canvas so palette icons match
             exactly what users will see when they drop them. */
          const svgInner=_vSVG(it.t,c);
          h+='<div class="bp-item" draggable="true" ondragstart="BandPlan._pdrag(event,\''+it.t+'\')" ondblclick="BandPlan._pdblclick(\''+it.t+'\')">'
            +'<div class="bp-item-ic" style="background:#fff;border-color:'+c+'55;padding:3px"><svg viewBox="0 0 72 72" style="width:100%;height:100%;display:block">'+svgInner+'</svg></div>'
            +'<div class="bp-item-nm">'+it.n+'</div>'
            +'</div>';
        });
        customs.forEach(it=>{
          const c=it.c||cat.color;
          h+='<div class="bp-item bp-item-custom" draggable="true" ondragstart="BandPlan._pdrag(event,\''+it.t+'\')" ondblclick="BandPlan._pdblclick(\''+it.t+'\')">'
            +'<button class="bp-item-del-ci" onclick="event.stopPropagation();BandPlan.removeCustomItem(\''+it.t+'\')" title="Supprimer">\xd7</button>'
            +'<div class="bp-item-ic" style="background:#fff;border-color:'+c+'66;border-style:dashed;color:'+c+';font-size:20px;font-family:var(--m);font-weight:700;display:flex;align-items:center;justify-content:center">'+(it.e||'?')+'</div>'
            +'<div class="bp-item-nm">'+it.n+'</div>'
            +'</div>';
        });
        if(!q)h+='<button class="bp-item-add" onclick="BandPlan.addCustomItem(\''+cat.id+'\')"><i class="ti ti-plus" style="font-size:10px"></i>Ajouter</button>';
        h+='</div>';
      }
      h+='</div>';
    });
    el.innerHTML=h;
  }
  function toggleCat(id){st.cats[id]=st.cats[id]===false?true:false;renderPalette(document.getElementById('bp-search')?.value||'');}
  function _pdrag(e,t){e.dataTransfer.setData('bp-type',t);e.dataTransfer.effectAllowed='copy';}
  function _pdblclick(t){
    const wrap=_wrap();if(!wrap)return;
    const rect=wrap.getBoundingClientRect();
    const cx=(rect.width/2-st.view.px)/st.view.z+80*(Math.random()-.5);
    const cy=(rect.height/2-st.view.py)/st.view.z+50*(Math.random()-.5);
    addNode(t,cx,cy);
  }

  // ---- canvas ----
  function applyTransform(){
    const c=_cv();if(!c)return;
    const t='matrix('+st.view.z+',0,0,'+st.view.z+','+st.view.px+','+st.view.py+')';
    c.style.transform=t;
    /* L'image de fond est désormais un enfant de #bp-canvas → elle hérite du
       transform du canvas (pan/zoom). Pas de synchro manuelle (sinon double
       transformation). Elle est empilée au-dessus de la grille (#bp-stage-svg)
       mais sous les nœuds. */
    const lbl=document.getElementById('bp-zoom-lbl');
    if(lbl)lbl.textContent=Math.round(st.view.z*100)+'%';
    const slider=document.getElementById('bp-zoom-slider');
    if(slider)slider.value=Math.min(300,Math.max(20,Math.round(st.view.z*100)));
    _positionBgHandle(); /* la poignée de redim. suit le pan/zoom */
  }

  function addNode(type,x,y){
    const it=_itemOf(type)||{n:type,e:'?'};
    const id=st.nid++;
    const el={id,type,label:it.n,x:Math.round(x),y:Math.round(y),scl:1,rot:0,z:id,ch:null};
    if(type==='riser'){el.riserW=2;el.riserH=1;el.riserAlt=0.4;}
    if(type==='kit'){el.chs=[];}
    if(type==='image_frame'){el.imgPx=240;el.imgAspect=1;el.label='';}
    st.els.push(el);
    renderNode(el);selectNode(id);saveStage();
    if(type==='image_frame') setTimeout(function(){ uploadElementIcon(el.id); },80);
  }

  /* Placement en lot depuis le « Mode IA » : crée des nœuds à partir d'une
     liste {type,x,y,label} renvoyée par la edge function stage-ai. Ne touche
     pas aux éléments existants ; coordonnées clampées au plateau 2400×1600. */
  function aiPlace(list){
    if(!Array.isArray(list)) return 0;
    const valid=new Set(); CATS.forEach(c=>c.items.forEach(i=>valid.add(i.t))); _customItems.forEach(i=>valid.add(i.t));
    let added=0;
    list.forEach(function(o){
      if(!o||!valid.has(o.type)) return;
      const it=_itemOf(o.type)||{n:o.type};
      const id=st.nid++;
      const el={id,type:o.type,
        label:(o.label?String(o.label).slice(0,40):it.n),
        x:Math.round(Math.max(40,Math.min(2360,+o.x||1200))),
        y:Math.round(Math.max(40,Math.min(1560,+o.y||800))),
        scl:1,rot:0,z:id,ch:null};
      if(o.type==='riser'){el.riserW=2;el.riserH=1;el.riserAlt=0.4;}
      if(o.type==='kit'){el.chs=[];}
      st.els.push(el); renderNode(el); added++;
    });
    if(added){ _sel=null; renderInspector(); saveStage(); setTimeout(fitView,60); }
    return added;
  }

  // ---- LIGHT-THEME SVG instrument logos (72x72 viewBox) ----
  // Color palette: deep navy #1d3a5f (outlines), blue #1d9bf0 + orange #ff6b1a accents,
  // soft white/grey body fills — matches SynPro/SitePlan light theme.
  function _vSVG(t,col){
    var c=col||'#1d3a5f';
    function _lug(a,r){var x=(36+r*Math.cos(a*Math.PI/180)).toFixed(1),y=(36+r*Math.sin(a*Math.PI/180)).toFixed(1);return '<circle cx="'+x+'" cy="'+y+'" r="1.8" fill="#c8d4e0" stroke="#1d3a5f" stroke-width=".4"/>';}
    switch(t){
      case 'kick':
        return '<circle cx="36" cy="36" r="31" fill="#f4f6fb" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="23" fill="#ffffff" stroke="#1d3a5f" stroke-width="1"/>'
          +'<circle cx="36" cy="36" r="10" fill="#1d3a5f" fill-opacity=".08" stroke="#1d3a5f" stroke-width="1" stroke-opacity=".35"/>'
          +'<text x="36" y="40" text-anchor="middle" font-family="Outfit" font-size="7" font-weight="700" fill="#1d3a5f">KICK</text>'
          +[0,45,90,135,180,225,270,315].map(function(a){return _lug(a,29);}).join('');
      case 'snare':
        return '<circle cx="36" cy="36" r="26" fill="#ffe4b5" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="19" fill="#fff8e1" stroke="#1d3a5f" stroke-width=".7"/>'
          +'<circle cx="36" cy="36" r="6" fill="#1d3a5f" fill-opacity=".15"/>'
          +[0,60,120,180,240,300].map(function(a){return _lug(a,24);}).join('')
          +'<line x1="22" y1="63" x2="50" y2="63" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<line x1="20" y1="67" x2="52" y2="67" stroke="#1d3a5f" stroke-width=".8" stroke-opacity=".6"/>';
      case 'hihat':
        return '<ellipse cx="36" cy="29" rx="25" ry="4.5" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1"/>'
          +'<ellipse cx="36" cy="35" rx="25" ry="4.5" fill="#d97706" stroke="#1d3a5f" stroke-width="1"/>'
          +'<line x1="36" y1="39" x2="36" y2="65" stroke="#1d3a5f" stroke-width="2"/>'
          +'<circle cx="36" cy="68" r="5" fill="#1d3a5f"/>';
      case 'toms':
        return '<circle cx="36" cy="36" r="24" fill="#f4f6fb" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="17" fill="#ffffff" stroke="#1d3a5f" stroke-width=".7"/>'
          +'<circle cx="36" cy="36" r="7" fill="#1d3a5f" fill-opacity=".18"/>'
          +'<text x="36" y="40" text-anchor="middle" font-family="Outfit" font-size="7" font-weight="700" fill="#1d3a5f">TOM</text>'
          +[0,60,120,180,240,300].map(function(a){return _lug(a,22);}).join('');
      case 'cymbal':
        return '<circle cx="36" cy="36" r="30" fill="#fbbf24" fill-opacity=".25"/>'
          +'<circle cx="36" cy="36" r="30" fill="none" stroke="#d97706" stroke-width="2"/>'
          +'<circle cx="36" cy="36" r="22" fill="none" stroke="#d97706" stroke-width="1" stroke-opacity=".5"/>'
          +'<circle cx="36" cy="36" r="14" fill="none" stroke="#d97706" stroke-width=".7" stroke-opacity=".3"/>'
          +'<circle cx="36" cy="36" r="5" fill="#d97706" stroke="#1d3a5f" stroke-width="1"/>';
      case 'cajon':
        return '<rect x="12" y="12" width="48" height="48" rx="4" fill="#d97706" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<rect x="17" y="17" width="38" height="38" rx="3" fill="#fbbf24" stroke="#1d3a5f" stroke-width=".7"/>'
          +'<circle cx="36" cy="36" r="9" fill="#1d3a5f" fill-opacity=".2" stroke="#1d3a5f" stroke-width=".8"/>';
      case 'elec':
        // Electric guitar body — orange ish accent
        return '<path d="M36,9C47,9 55,17 55,27C55,33 51,35 51,39C51,54 49,63 36,64C23,63 21,54 21,39C21,35 17,33 17,27C17,17 25,9 36,9Z" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<rect x="31" y="29" width="10" height="4" rx="1" fill="#1d3a5f"/>'
          +'<rect x="31" y="39" width="10" height="4" rx="1" fill="#1d3a5f"/>'
          +'<circle cx="26" cy="51" r="2.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".6"/>'
          +'<circle cx="32" cy="54" r="2.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".6"/>'
          +'<rect x="33" y="63" width="6" height="4" rx="1" fill="#1d3a5f"/>';
      case 'acou':
        return '<circle cx="36" cy="26" r="16" fill="#fde68a" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="36" cy="47" r="19" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<rect x="30" y="35" width="12" height="7" fill="#fde68a" stroke="#1d3a5f" stroke-width="1"/>'
          +'<circle cx="36" cy="47" r="9" fill="#1d3a5f" fill-opacity=".82" stroke="#1d3a5f" stroke-width=".8"/>'
          +'<circle cx="36" cy="47" r="11" fill="none" stroke="#1d3a5f" stroke-width=".6" stroke-opacity=".4"/>'
          +'<rect x="34" y="8" width="4" height="12" rx="1" fill="#1d3a5f"/>';
      case 'bass_g':
        return '<path d="M36,10C47,10 54,18 54,27C54,32 51,34 51,38C51,52 49,63 36,65C23,63 21,52 21,38C21,34 18,32 18,27C18,18 25,10 36,10Z" fill="#22d6a0" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<rect x="31" y="34" width="10" height="5" rx="1" fill="#1d3a5f"/>'
          +'<rect x="31" y="45" width="10" height="5" rx="1" fill="#1d3a5f"/>'
          +'<circle cx="27" cy="57" r="2.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".6"/>'
          +'<circle cx="36" cy="60" r="2.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".6"/>';
      case 'gamp':
      case 'bamp':
        return '<rect x="7" y="11" width="58" height="50" rx="5" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="36" cy="38" r="18" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="36" cy="38" r="13" fill="#1d3a5f" fill-opacity=".75" stroke="#0d1828" stroke-width="0.7"/>'
          +'<circle cx="36" cy="38" r="7" fill="#0d1828"/>'
          +'<circle cx="17" cy="19" r="3.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".8"/>'
          +'<circle cx="27" cy="19" r="3.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".8"/>'
          +'<circle cx="37" cy="19" r="3.5" fill="#ffffff" stroke="#1d3a5f" stroke-width=".8"/>'
          +'<circle cx="47" cy="19" r="3.5" fill="#ff6b1a" stroke="#1d3a5f" stroke-width=".8"/>';
      case 'cab':
        // 4x12 cabinet
        return '<rect x="5" y="5" width="62" height="62" rx="5" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="22" cy="22" r="13" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width=".8"/><circle cx="22" cy="22" r="8" fill="#1d3a5f" fill-opacity=".75"/>'
          +'<circle cx="50" cy="22" r="13" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width=".8"/><circle cx="50" cy="22" r="8" fill="#1d3a5f" fill-opacity=".75"/>'
          +'<circle cx="22" cy="50" r="13" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width=".8"/><circle cx="22" cy="50" r="8" fill="#1d3a5f" fill-opacity=".75"/>'
          +'<circle cx="50" cy="50" r="13" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width=".8"/><circle cx="50" cy="50" r="8" fill="#1d3a5f" fill-opacity=".75"/>';
      case 'keyboard':
      case 'synth':
      case 'piano':
      case 'wurly':
        // Keyboard top view — white keys with black accidentals
        return '<rect x="4" y="18" width="64" height="36" rx="4" fill="'+(t==='wurly'?'#d97706':'#1d3a5f')+'" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<rect x="6" y="24" width="60" height="28" rx="2" fill="#ffffff" stroke="#1d3a5f" stroke-width=".5"/>'
          +[0,1,2,3,4,5,6].map(function(i){return '<line x1="'+(14+i*8)+'" y1="24" x2="'+(14+i*8)+'" y2="52" stroke="#1d3a5f" stroke-width=".5"/>';}).join('')
          +[10,18,34,42,50].map(function(x){return '<rect x="'+x+'" y="24" width="5" height="16" rx="1" fill="#1d3a5f"/>';}).join('');
      case 'mic_s':
        // Mic on stand — top view (circle base + mic)
        return '<circle cx="36" cy="60" r="11" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="36" cy="60" r="5" fill="#1d3a5f" fill-opacity=".25"/>'
          +'<line x1="36" y1="49" x2="36" y2="20" stroke="#1d3a5f" stroke-width="2"/>'
          +'<ellipse cx="36" cy="15" rx="7" ry="10" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<ellipse cx="36" cy="15" rx="4.5" ry="7" fill="#1d3a5f" fill-opacity=".7"/>';
      case 'mic_hf':
        // Handheld wireless mic
        return '<ellipse cx="36" cy="17" rx="8" ry="12" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.3"/>'
          +'<ellipse cx="36" cy="17" rx="5" ry="8" fill="#1d3a5f" fill-opacity=".75"/>'
          +'<rect x="33" y="29" width="6" height="28" rx="2" fill="#1d3a5f" stroke="#1d3a5f" stroke-width=".5"/>'
          +'<circle cx="36" cy="58" r="2" fill="#ff6b1a"/>';
      case 'iem_p':
        // In-ear monitor — receiver belt-pack icon
        return '<rect x="22" y="10" width="28" height="46" rx="4" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.4"/>'
          +'<rect x="26" y="14" width="20" height="14" rx="1" fill="#1d3a5f"/>'
          +'<circle cx="36" cy="40" r="4" fill="#1d3a5f" fill-opacity=".25" stroke="#1d3a5f" stroke-width="0.8"/>'
          +'<circle cx="36" cy="40" r="1.5" fill="#1d3a5f"/>'
          +'<rect x="30" y="48" width="12" height="4" rx="1" fill="#9b6aff"/>'
          +'<line x1="36" y1="10" x2="36" y2="2" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="2" r="1.5" fill="#1d3a5f"/>';
      case 'trumpet':
        return '<path d="M50,28C50,20 44,14 36,14C28,14 20,18 18,26C16,34 20,40 28,40C36,40 44,36 50,28Z" fill="none" stroke="#d97706" stroke-width="2.5"/>'
          +'<circle cx="50" cy="44" r="16" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="50" cy="44" r="10" fill="#fde68a" stroke="#1d3a5f" stroke-width="0.8"/>'
          +'<circle cx="50" cy="44" r="4" fill="#d97706" stroke="#1d3a5f" stroke-width="0.6"/>'
          +'<line x1="28" y1="40" x2="20" y2="54" stroke="#d97706" stroke-width="2.5"/>';
      case 'trombone':
        return '<line x1="10" y1="24" x2="62" y2="24" stroke="#d97706" stroke-width="3"/>'
          +'<line x1="10" y1="33" x2="62" y2="33" stroke="#d97706" stroke-width="3"/>'
          +'<rect x="8" y="22" width="11" height="13" rx="2" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1"/>'
          +'<circle cx="62" cy="28" r="13" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="62" cy="28" r="7" fill="#fde68a"/>';
      case 'sax':
        return '<path d="M38,8C48,8 56,16 57,26C58,38 53,50 44,58C40,62 34,64 28,62C22,58 20,50 24,44C28,38 36,36 38,28C40,20 38,14 36,12" fill="none" stroke="#d97706" stroke-width="3.2" stroke-linecap="round"/>'
          +'<circle cx="44" cy="58" r="10" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="44" cy="58" r="5" fill="#fde68a"/>'
          +'<circle cx="38" cy="14" r="2.5" fill="#1d3a5f"/>'
          +'<circle cx="36" cy="28" r="2" fill="#1d3a5f"/>';
      case 'horn':
        return '<circle cx="36" cy="38" r="20" fill="#fbbf24" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="38" r="14" fill="#fde68a" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<circle cx="36" cy="38" r="6" fill="#1d3a5f" fill-opacity=".25" stroke="#1d3a5f" stroke-width="0.8"/>'
          +'<line x1="36" y1="18" x2="36" y2="10" stroke="#d97706" stroke-width="2"/>'
          +'<circle cx="36" cy="7" r="4" fill="#d97706" stroke="#1d3a5f" stroke-width="0.8"/>';
      case 'timb':
        return '<circle cx="20" cy="36" r="15" fill="#ffe4b5" stroke="#1d3a5f" stroke-width="1.5"/><circle cx="20" cy="36" r="10" fill="#fff8e1" stroke="#1d3a5f" stroke-width=".5"/>'
          +'<circle cx="52" cy="36" r="17" fill="#ffe4b5" stroke="#1d3a5f" stroke-width="1.5"/><circle cx="52" cy="36" r="12" fill="#fff8e1" stroke="#1d3a5f" stroke-width=".5"/>';
      case 'conga':
        return '<ellipse cx="22" cy="36" rx="13" ry="22" fill="#d97706" stroke="#1d3a5f" stroke-width="1.5"/><ellipse cx="22" cy="26" rx="10" ry="5" fill="#fbbf24" stroke="#1d3a5f" stroke-width=".7"/>'
          +'<ellipse cx="50" cy="36" rx="13" ry="22" fill="#d97706" stroke="#1d3a5f" stroke-width="1.5"/><ellipse cx="50" cy="26" rx="10" ry="5" fill="#fbbf24" stroke="#1d3a5f" stroke-width=".7"/>';
      case 'marimba':
      case 'xyl':
        return '<rect x="4" y="12" width="64" height="48" rx="3" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.2"/>'
          +[0,1,2,3,4,5,6].map(function(i){var bh=[46,42,38,34,38,42,46][i],bc=t==='xyl'?'#22d6a0':'#fbbf24';return '<rect x="'+(9+i*9)+'" y="'+(60-bh)+'" width="7" height="'+bh+'" rx="1.5" fill="'+bc+'" stroke="#1d3a5f" stroke-width="0.7"/>';}).join('');
      case 'foh':
      case 'mon':
        var consoleAccent = (t==='mon'?'#f5c542':'#1a8fff');
        return '<rect x="4" y="12" width="64" height="48" rx="5" fill="'+consoleAccent+'" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<rect x="4" y="12" width="64" height="9" rx="5" fill="#0d1828"/>'
          +[0,1,2,3,4,5,6,7].map(function(i){var fx=8+i*8,fp=[32,26,34,22,36,28,30,24][i];return '<rect x="'+fx+'" y="24" width="4" height="26" rx="1" fill="#16243d"/>'+'<rect x="'+fx+'" y="'+fp+'" width="4" height="6" rx="1" fill="#ffffff"/>';}).join('')
          +'<rect x="8" y="52" width="56" height="5" rx="1" fill="#16243d"/>'
          +[0,1,2,3,4].map(function(i){return '<rect x="'+(8+i*12)+'" y="53" width="10" height="3" rx="0.5" fill="'+(i<3?'#22d6a0':'#ff6b1a')+'"/>';}).join('');
      case 'stagebox':
        return '<rect x="7" y="16" width="58" height="40" rx="5" fill="#5a6580" stroke="#1d3a5f" stroke-width="1.2"/>'
          +[0,1,2,3].map(function(i){return '<circle cx="'+(15+i*14)+'" cy="29" r="4.5" fill="#ffffff" stroke="#1d3a5f" stroke-width="1"/><circle cx="'+(15+i*14)+'" cy="29" r="2" fill="#1d3a5f"/>';}).join('')
          +[0,1,2,3].map(function(i){return '<rect x="'+(12+i*14)+'" y="40" width="6" height="6" rx="1" fill="#ff6b1a" stroke="#1d3a5f" stroke-width=".5"/>';}).join('');
      case 'di':
        return '<rect x="14" y="14" width="44" height="44" rx="5" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<text x="36" y="32" text-anchor="middle" font-family="Outfit" font-size="11" font-weight="700" fill="#1d3a5f">DI</text>'
          +'<circle cx="25" cy="44" r="4" fill="#1d3a5f" fill-opacity=".15" stroke="#1d3a5f" stroke-width="0.8"/>'
          +'<rect x="37" y="40" width="11" height="7" rx="1" fill="#1d3a5f" fill-opacity=".15" stroke="#1d3a5f" stroke-width="0.7"/>';
      case 'iem_r':
        return '<rect x="4" y="10" width="64" height="44" rx="3" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.2"/>'
          +[0,1,2].map(function(i){return '<rect x="'+(8+i*22)+'" y="16" width="18" height="14" rx="2" fill="#9b6aff" stroke="#1d3a5f" stroke-width="0.7"/>'+'<circle cx="'+(17+i*22)+'" cy="23" r="3.5" fill="#ffffff" stroke="#1d3a5f" stroke-width="0.5"/>';}).join('')
          +[0,1,2].map(function(i){return '<rect x="'+(11+i*22)+'" y="38" width="12" height="4" rx=".5" fill="#9b6aff"/>';}).join('')
          +'<line x1="22" y1="10" x2="22" y2="3" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<line x1="44" y1="10" x2="44" y2="1" stroke="#1d3a5f" stroke-width="1.5"/>';
      case 'spk':
        return '<rect x="5" y="5" width="62" height="62" rx="5" fill="#1a8fff" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="25" fill="#ffffff" stroke="#1d3a5f" stroke-width="1"/>'
          +'<circle cx="36" cy="36" r="17" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<circle cx="36" cy="36" r="7" fill="#1d3a5f"/>';
      case 'sub':
        return '<rect x="4" y="4" width="64" height="64" rx="5" fill="#ff6b1a" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="28" fill="#ffffff" stroke="#1d3a5f" stroke-width="1"/>'
          +'<circle cx="36" cy="36" r="19" fill="#ff6b1a" fill-opacity=".15" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<circle cx="36" cy="36" r="8" fill="#1d3a5f"/>';
      case 'wedge':
        // Wedge — top-down trapezoid view
        return '<polygon points="4,66 68,66 68,14 4,52" fill="#f5c542" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<polygon points="10,63 62,63 62,20 10,49" fill="#ffffff" stroke="#1d3a5f" stroke-width="0.5"/>'
          +'<circle cx="36" cy="42" r="16" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width="1.2"/>'
          +'<circle cx="36" cy="42" r="10" fill="#1d3a5f" fill-opacity=".25" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<circle cx="36" cy="42" r="4.5" fill="#1d3a5f"/>'
          +'<rect x="18" y="62" width="36" height="2.5" rx="0.8" fill="#1d3a5f"/>';
      case 'chair':
        return '<rect x="12" y="12" width="48" height="48" rx="4" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<rect x="17" y="17" width="38" height="26" rx="3" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<rect x="16" y="46" width="8" height="11" rx="1.5" fill="#1d3a5f"/>'
          +'<rect x="48" y="46" width="8" height="11" rx="1.5" fill="#1d3a5f"/>';
      case 'stool':
        return '<circle cx="36" cy="36" r="27" fill="#ffffff" stroke="#1d3a5f" stroke-width="1.5"/>'
          +'<circle cx="36" cy="36" r="20" fill="#1d3a5f" fill-opacity=".10" stroke="#1d3a5f" stroke-width="0.7"/>'
          +'<circle cx="18" cy="54" r="3.5" fill="#1d3a5f"/><circle cx="54" cy="54" r="3.5" fill="#1d3a5f"/>'
          +'<circle cx="18" cy="18" r="3.5" fill="#1d3a5f"/><circle cx="54" cy="18" r="3.5" fill="#1d3a5f"/>';
      default:{
        var L=(t||'?').charAt(0).toUpperCase();
        return '<circle cx="36" cy="36" r="30" fill="#ffffff" stroke="'+c+'" stroke-width="2"/>'
          +'<text x="36" y="43" text-anchor="middle" font-family="Outfit" font-size="22" fill="'+c+'" font-weight="700">'+L+'</text>';
      }
    }
  }

  function _vintageInnerHTML(el){
    var c=_elColor(el.type);
    var it=_itemOf(el.type)||{e:'?'};
    var chBadge=el.type==='kit'
      ?(el.chs&&el.chs.length?'<div class="bp-node-ch">'+(el.chs.length===1?'CH '+_chNum(el.chs[0]):el.chs.length+'\xd7CH')+'</div>':'')
      :(_isOutput(el.type)
        ?(el.outStereo
          ?(el.outCh||el.outChR?'<div class="bp-node-ch" style="background:#22d6a0;font-size:22px">OUT '+(el.outCh?_outChNum(el.outCh):'?')+'+'+(el.outChR?_outChNum(el.outChR):'?')+'</div>':'')
          :(el.outCh?'<div class="bp-node-ch" style="background:#22d6a0">OUT '+_outChNum(el.outCh)+'</div>':''))
        :(el.stereo
          ?(el.ch||el.chR?'<div class="bp-node-ch" style="font-size:22px">CH '+(el.ch?_chNum(el.ch):'?')+'+'+(el.chR?_chNum(el.chR):'?')+'</div>':'')
          :(el.ch?'<div class="bp-node-ch">CH '+_chNum(el.ch)+'</div>':'')));
    if(el.type==='riser'){
      var rw=(el.riserW||2)*RISER_SCALE,rh=(el.riserH||1)*RISER_SCALE,alt=el.riserAlt||0.4;
      var op=(0.10+(alt/1.2)*0.25).toFixed(2),fs=Math.max(11,Math.min(18,rw/9));
      return '<div class="bp-riser-body" style="width:'+rw+'px;height:'+rh+'px;background:rgba(255,107,26,'+op+');border:2px solid rgba(255,107,26,.45);border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;position:relative;box-sizing:border-box;box-shadow:0 1px 6px rgba(0,0,0,.10)">'
        +chBadge
        +'<span style="font-family:var(--m);font-size:'+fs+'px;color:#1d3a5f;font-weight:700;letter-spacing:.3px">'+((el.riserW||2)+'m \xd7 '+(el.riserH||1)+'m')+'</span>'
        +'<span style="font-family:var(--m);font-size:8px;color:#64748b">⬆ '+alt+'m</span>'
        +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer">\xd7</button>'
        +'</div>'
        +'<div class="bp-vnode-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
    }
    if(el.type==='kit'){
      var kitChs=el.chs||[];
      var rows=kitChs.map(function(id){return _chById(id);}).filter(Boolean);
      var rowsHtml=rows.length
        ?rows.map(function(r){return '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid #e5eaf2">'
          +'<span style="font-family:var(--m);font-size:11px;font-weight:700;color:'+c+';min-width:34px">CH'+r.ch+'</span>'
          +'<span style="font-family:var(--m);font-size:12px;color:#1d3a5f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">'+(r.long_name||r.short_name||'—')+'</span>'
          +'</div>';}).join('')
        :'<div style="font-family:var(--m);font-size:11px;color:#94a3b8;padding:7px 12px;font-style:italic">Aucun canal li\xe9</div>';
      return '<div class="bp-kit-block" style="background:#ffffff;border:1.5px solid '+c+'66;border-radius:12px;overflow:hidden;min-width:210px;position:relative;box-shadow:0 2px 10px rgba(0,0,0,.10)">'
        +'<div style="display:flex;align-items:center;gap:8px;padding:8px 12px 7px;background:'+c+'12;border-bottom:1px solid '+c+'22">'
        +'<span style="font-size:22px">'+it.e+'</span>'
        +'<span style="font-family:var(--m);font-size:13px;font-weight:700;color:#1d3a5f;flex:1;letter-spacing:.2px">'+el.label.replace(/</g,'&lt;')+'</span>'
        +(rows.length?'<span style="font-family:var(--m);font-size:10px;color:#ffffff;background:'+c+';padding:2px 8px;border-radius:8px;font-weight:700">'+rows.length+' CH</span>':'')
        +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:relative;top:auto;right:auto;margin-left:2px">\xd7</button>'
        +'</div>'
        +rowsHtml
        +'</div>';
    }
    if(el.type==='image_frame'){
      var ifPx=el.imgPx||120,ifAsp=el.imgAspect||1;
      var ifH=Math.max(1,Math.round(ifPx/ifAsp));
      if(el.iconImg){
        return '<div class="bp-img-frame" style="width:'+ifPx+'px;height:'+ifH+'px">'
          +'<img src="'+_safeImgSrc(el.iconImg)+'" style="width:'+ifPx+'px;height:'+ifH+'px;object-fit:fill;display:block;border-radius:4px;pointer-events:none"/>'
          +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:absolute;left:50%;top:-11px;right:auto;transform:translateX(-50%)">\xd7</button>'
          +'<div class="bp-rsz bp-rsz-nw" data-bpid="'+el.id+'" data-corner="nw" style="left:-6px;top:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-ne" data-bpid="'+el.id+'" data-corner="ne" style="right:-6px;top:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-sw" data-bpid="'+el.id+'" data-corner="sw" style="left:-6px;bottom:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-se" data-bpid="'+el.id+'" data-corner="se" style="right:-6px;bottom:-6px"></div>'
          +'</div>'
          +'<div class="bp-vnode-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
      }
      return '<div class="bp-img-frame" onclick="BandPlan.uploadElementIcon('+el.id+')" '
        +'style="width:'+ifPx+'px;height:'+ifPx+'px;border:2px dashed var(--bdr2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:6px">'
        +'<button class="bp-node-del" onclick="event.stopPropagation();BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:absolute;left:50%;top:-11px;right:auto;transform:translateX(-50%)">\xd7</button>'
        +'<i class="ti ti-photo" style="font-size:22px;color:var(--muted);pointer-events:none"></i>'
        +'<span style="font-size:10px;font-family:var(--m);color:var(--muted);pointer-events:none">Ajouter une image</span>'
        +'</div>'
        +'<div class="bp-vnode-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
    }
    return '<div class="bp-vnode-wrap">'
      +'<div class="bp-vnode-body" style="background:#ffffff;border:1.5px solid '+c+'66">'
      +'<svg viewBox="0 0 72 72" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">'
      +_vSVG(el.type,c)
      +'</svg>'
      +'</div>'
      +chBadge
      +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer">\xd7</button>'
      +'</div>'
      +'<div class="bp-vnode-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
  }

  function renderNode(el){
    const wrap=_cv();if(!wrap)return;
    let div=wrap.querySelector('[data-bpid="'+el.id+'"]');
    const isNew=!div;
    if(isNew){div=document.createElement('div');div.className='bp-node';div.dataset.bpid=el.id;wrap.appendChild(div);}
    if(st.viewMode==='vintage'){
      div.innerHTML=_vintageInnerHTML(el);
      div.style.left=el.x+'px';div.style.top=el.y+'px';
      div.style.zIndex=el.z;
      div.style.transform='rotate('+el.rot+'deg) scale('+el.scl+')';
      var _lbl=div.querySelector('.bp-vnode-lbl');
      if(_lbl)_lbl.style.transform='rotate('+(-el.rot)+'deg)';
      div.classList.toggle('sel',_sel===el.id);
      if(isNew)_bindNode(div,el.id);
      /* Backfill du ratio pour les image_frame chargées depuis la DB sans imgAspect */
      if(el.type==='image_frame' && el.iconImg && !el.imgAspect && !el._aspChk){
        el._aspChk=true;
        var _bim=new Image();
        _bim.onload=function(){ if(_bim.naturalHeight){ el.imgAspect=_bim.naturalWidth/_bim.naturalHeight; renderNode(el); } };
        _bim.src=el.iconImg;
      }
      return;
    }
    const c=_elColor(el.type);
    const it=_itemOf(el.type)||{e:'?'};
    const chBadge=el.type==='kit'
      ?(el.chs&&el.chs.length?'<div class="bp-node-ch">'+(el.chs.length===1?'CH '+_chNum(el.chs[0]):el.chs.length+'\xd7CH')+'</div>':'')
      :(_isOutput(el.type)
        ?(el.outStereo
          ?(el.outCh||el.outChR?'<div class="bp-node-ch" style="background:#22d6a0;font-size:22px">OUT '+(el.outCh?_outChNum(el.outCh):'?')+'+'+(el.outChR?_outChNum(el.outChR):'?')+'</div>':'')
          :(el.outCh?'<div class="bp-node-ch" style="background:#22d6a0">OUT '+_outChNum(el.outCh)+'</div>':''))
        :(el.stereo
          ?(el.ch||el.chR?'<div class="bp-node-ch" style="font-size:22px">CH '+(el.ch?_chNum(el.ch):'?')+'+'+(el.chR?_chNum(el.chR):'?')+'</div>':'')
          :(el.ch?'<div class="bp-node-ch">CH '+_chNum(el.ch)+'</div>':'')));
    if(el.type==='riser'){
      const rw=(el.riserW||2)*RISER_SCALE;
      const rh=(el.riserH||1)*RISER_SCALE;
      const alt=el.riserAlt||0.4;
      const opacity=0.25+(alt/1.2)*0.55;
      const fs=Math.max(18,Math.min(32,rw/6));
      const dimLbl=(el.riserW||2)+'m \xd7 '+(el.riserH||1)+'m';
      div.innerHTML=
        '<div class="bp-riser-body" style="width:'+rw+'px;height:'+rh+'px;background:rgba(90,100,120,'+opacity.toFixed(2)+');border:2px solid rgba(100,115,140,0.7);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;position:relative;box-sizing:border-box">'
        +chBadge
        +'<span style="font-family:var(--m);font-size:'+fs+'px;color:#fff;font-weight:700;letter-spacing:.3px;text-shadow:0 1px 3px rgba(0,0,0,.5)">'+dimLbl+'</span>'
        +'<span style="font-family:var(--m);font-size:18px;color:rgba(255,255,255,.75);text-shadow:0 1px 2px rgba(0,0,0,.5)">⬆ '+alt+'m</span>'
        +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer">\xd7</button>'
        +'</div>'
        +'<div class="bp-node-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
    } else if(el.type==='kit'){
      const kitChs=el.chs||[];
      const rows=kitChs.map(id=>_chById(id)).filter(Boolean);
      const rowsHtml=rows.length
        ?rows.map(r=>'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid rgba(255,107,26,.15)">'
          +'<span style="font-family:var(--m);font-size:28px;font-weight:900;color:#000;background:var(--ora);padding:4px 12px;border-radius:12px;min-width:64px;text-align:center">CH'+r.ch+'</span>'
          +'<span style="font-family:var(--m);font-size:22px;font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">'+(r.long_name||r.short_name||'—')+'</span>'
          +'</div>').join('')
        :'<div style="font-family:var(--m);font-size:18px;color:rgba(100,100,100,.6);padding:10px 14px;font-style:italic">Aucun canal lie</div>';
      div.innerHTML=
        '<div class="bp-kit-block" style="background:#fff;border:2px solid '+c+'55;border-radius:14px;overflow:hidden;min-width:280px;position:relative;box-shadow:0 2px 14px rgba(0,0,0,.14)">'
        +'<div style="display:flex;align-items:center;gap:10px;padding:12px 16px 10px;background:'+c+'14">'
        +'<span style="font-size:36px">'+it.e+'</span>'
        +'<span style="font-family:var(--m);font-size:24px;font-weight:700;color:#222;flex:1">'+el.label.replace(/</g,'&lt;')+'</span>'
        +(rows.length?'<span style="font-family:var(--m);font-size:18px;color:'+c+';background:'+c+'22;padding:3px 10px;border-radius:10px;font-weight:700">'+rows.length+' CH</span>':'')
        +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:relative;top:auto;right:auto;margin-left:6px">\xd7</button>'
        +'</div>'
        +rowsHtml
        +'</div>';
    } else if(el.type==='image_frame'){
      const ifPx2=el.imgPx||120,ifAsp2=el.imgAspect||1;
      const ifH2=Math.max(1,Math.round(ifPx2/ifAsp2));
      if(el.iconImg){
        div.innerHTML=
          '<div class="bp-img-frame" style="width:'+ifPx2+'px;height:'+ifH2+'px">'
          +'<img src="'+_safeImgSrc(el.iconImg)+'" style="width:'+ifPx2+'px;height:'+ifH2+'px;object-fit:fill;display:block;border-radius:4px;pointer-events:none"/>'
          +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:absolute;left:50%;top:-11px;right:auto;transform:translateX(-50%)">\xd7</button>'
          +'<div class="bp-rsz bp-rsz-nw" data-bpid="'+el.id+'" data-corner="nw" style="left:-6px;top:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-ne" data-bpid="'+el.id+'" data-corner="ne" style="right:-6px;top:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-sw" data-bpid="'+el.id+'" data-corner="sw" style="left:-6px;bottom:-6px"></div>'
          +'<div class="bp-rsz bp-rsz-se" data-bpid="'+el.id+'" data-corner="se" style="right:-6px;bottom:-6px"></div>'
          +'</div>'
          +'<div class="bp-node-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
      } else {
        div.innerHTML=
          '<div class="bp-img-frame" onclick="BandPlan.uploadElementIcon('+el.id+')" '
          +'style="width:'+ifPx2+'px;height:'+ifPx2+'px;border:2px dashed var(--bdr2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:6px">'
          +'<button class="bp-node-del" onclick="event.stopPropagation();BandPlan.deleteNode('+el.id+')" title="Supprimer" style="position:absolute;left:50%;top:-11px;right:auto;transform:translateX(-50%)">\xd7</button>'
          +'<i class="ti ti-photo" style="font-size:22px;color:var(--muted);pointer-events:none"></i>'
          +'<span style="font-size:10px;font-family:var(--m);color:var(--muted);pointer-events:none">Ajouter une image</span>'
          +'</div>'
          +'<div class="bp-node-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
      }
    } else {
      const iconHtml = el.iconImg
        ? '<img src="'+_safeImgSrc(el.iconImg)+'" style="width:calc(68px * var(--bp-ns,1));height:calc(68px * var(--bp-ns,1));object-fit:contain;border-radius:5px;pointer-events:none"/>'
        : '<div style="pointer-events:none">'+it.e+'</div>';
      div.innerHTML=
        '<div class="bp-node-body" style="border-color:'+c+'55">'
        +chBadge
        +iconHtml
        +'<button class="bp-node-del" onclick="BandPlan.deleteNode('+el.id+')" title="Supprimer">\xd7</button>'
        +'</div>'
        +'<div class="bp-node-lbl">'+el.label.replace(/</g,'&lt;')+'</div>';
    }
    div.style.left=el.x+'px';div.style.top=el.y+'px';
    div.style.zIndex=el.z;
    div.style.transform='rotate('+el.rot+'deg) scale('+el.scl+')';
    var _lbl2=div.querySelector('.bp-node-lbl');
    if(_lbl2)_lbl2.style.transform='rotate('+(-el.rot)+'deg)';
    div.classList.toggle('sel',_sel===el.id);
    if(isNew)_bindNode(div,el.id);
  }

  function _bindNode(div,id){
    div.addEventListener('pointerdown',e=>{
      if(e.target.tagName==='BUTTON')return;
      /* Poignée de resize pour image_frame */
      const rsz=e.target.closest('.bp-rsz');
      if(rsz){
        const el=st.els.find(r=>r.id===id);if(!el)return;
        const asp=el.imgAspect||1,w0=el.imgPx||120,h0=Math.max(1,Math.round(w0/asp));
        const corner=rsz.dataset.corner;
        _bpRsz={id,corner,asp,
          anchorX:(corner==='nw'||corner==='sw')?el.x+w0:el.x,
          anchorY:(corner==='nw'||corner==='ne')?el.y+h0:el.y};
        div.setPointerCapture(e.pointerId);
        e.stopPropagation();e.preventDefault();return;
      }
      e.stopPropagation();e.preventDefault();
      selectNode(id);
      const rect=_wrap().getBoundingClientRect();
      const el=st.els.find(r=>r.id===id);if(!el)return;
      _dn=id;_dnox=e.clientX-rect.left-el.x*st.view.z-st.view.px;_dnoy=e.clientY-rect.top-el.y*st.view.z-st.view.py;
      div.setPointerCapture(e.pointerId);
    });
    div.addEventListener('pointermove',e=>{
      if(_bpRsz&&_bpRsz.id===id){
        const wrap=_wrap();if(!wrap)return;
        const wr=wrap.getBoundingClientRect();
        const el=st.els.find(r=>r.id===id);if(!el)return;
        const cx=(e.clientX-wr.left-st.view.px)/st.view.z;
        const c=_bpRsz.corner;
        let nw=(c==='se'||c==='ne')?cx-_bpRsz.anchorX:_bpRsz.anchorX-cx;
        nw=Math.max(40,Math.min(2400,Math.round(nw)));
        const nh=Math.max(1,Math.round(nw/_bpRsz.asp));
        el.imgPx=nw;
        if(c==='nw'||c==='sw'){el.x=Math.round(_bpRsz.anchorX-nw);}
        if(c==='nw'||c==='ne'){el.y=Math.round(_bpRsz.anchorY-nh);}
        renderNode(el);e.preventDefault();return;
      }
      if(_dn!==id)return;
      e.preventDefault();
      const wrap=_wrap();if(!wrap)return;
      const wr=wrap.getBoundingClientRect();
      const el=st.els.find(r=>r.id===id);if(!el)return;
      el.x=Math.round((e.clientX-wr.left-st.view.px-_dnox)/st.view.z);
      el.y=Math.round((e.clientY-wr.top-st.view.py-_dnoy)/st.view.z);
      div.style.left=el.x+'px';div.style.top=el.y+'px';
    });
    div.addEventListener('pointerup',()=>{
      if(_bpRsz&&_bpRsz.id===id){_bpRsz=null;saveStage();renderInspector();return;}
      if(_dn===id){_dn=null;saveStage();}
    });
  }

  function selectNode(id){
    _sel=id;
    document.querySelectorAll('.bp-node').forEach(n=>n.classList.toggle('sel',n.dataset.bpid==id));
    renderInspector();
  }

  function deleteNode(id){
    /* Supprime aussi l'image du serveur (B2) si l'élément en portait une. */
    const _del=st.els.find(e=>e.id===id);
    if(_del&&_del.iconImgB2)_b2DeleteIcon(_del.iconImgB2);
    st.els=st.els.filter(e=>e.id!==id);
    document.querySelector('[data-bpid="'+id+'"]')?.remove();
    if(_sel===id){_sel=null;renderInspector();}
    saveStage();
  }

  // ---- inspector ----
  function renderInspector(){
    const el=document.getElementById('bp-insp-body');if(!el)return;
    const sel=st.els.find(e=>e.id===_sel);
    if(!sel){
      el.innerHTML='<div class="bp-insp-empty"><i class="ti ti-cursor-text" style="font-size:28px;margin-bottom:9px;color:var(--muted2)"></i><span>Selectionnez un element</span></div>';
      return;
    }
    const c=_elColor(sel.type);
    const _allC=(typeof ALL_CHS!=='undefined'&&ALL_CHS.length)?ALL_CHS:(typeof CHS!=='undefined'?CHS:[]);
    const _patches=(typeof IL_PATCHES!=='undefined'&&IL_PATCHES.length)?IL_PATCHES:[{id:'main',name:'Patch 1'}];
    const _escO=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    /* Input list active pour la liaison (choisie via le sélecteur, sinon le
       patch courant) — on ne montre QUE les canaux de cette liste. */
    const _lp=_linkPatch();
    const _chOpts=(selId,excludeIds)=>{
      excludeIds=excludeIds||[];
      return _allC.filter(r=>(r.patch_id||'main')===_lp && excludeIds.indexOf(r.id)<0)
        .map(r=>'<option value="'+r.id+'"'+(selId===r.id?' selected':'')+'>CH'+r.ch+' — '+_escO(r.long_name||r.short_name||'—')+'</option>').join('');
    };
    /* Sélecteur de liste — affiché uniquement s'il y a plusieurs input lists. */
    const _listSel=_patches.length>1
      ? '<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px"><i class="ti ti-list-numbers" style="font-size:10px"></i> Input list</div>'
        +'<select class="bp-il-sel" style="margin-bottom:9px" onchange="BandPlan.setLinkPatch(this.value)">'
        +_patches.map(p=>'<option value="'+p.id+'"'+(p.id===_lp?' selected':'')+'>'+_escO(p.name||'Liste')+'</option>').join('')
        +'</select>'
      : '';
    const linkedCh=_chById(sel.ch);
    const chOpts=_chOpts(sel.ch);
    el.innerHTML=
      // --- Alias
      '<div class="bp-insp-sec">'
      +'<div class="bp-insp-title"><i class="ti ti-pencil" style="color:'+c+'"></i>Alias</div>'
      +'<input class="bp-inp" value="'+sel.label.replace(/"/g,'&quot;')+'" oninput="BandPlan.updateAlias(this.value)"/>'
      +'</div>'
      // --- Transform
      +'<div class="bp-insp-sec">'
      +'<div class="bp-insp-title"><i class="ti ti-move" style="color:var(--muted)"></i>Transform</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:9px">'
      +'<div><div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">X</div><input class="bp-xy-inp" type="number" value="'+sel.x+'" oninput="BandPlan.updPos(\'x\',+this.value)"/></div>'
      +'<div><div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">Y</div><input class="bp-xy-inp" type="number" value="'+sel.y+'" oninput="BandPlan.updPos(\'y\',+this.value)"/></div>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:9px">'
      +'<div><div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">Echelle</div>'
      +'<div style="display:flex;align-items:center;gap:3px">'
      +'<button class="bp-sc-btn" onclick="BandPlan.adjScale(-0.1)">−</button>'
      +'<span style="font-family:var(--m);font-size:10px;color:var(--txt2);min-width:36px;text-align:center">'+Math.round(sel.scl*100)+'%</span>'
      +'<button class="bp-sc-btn" onclick="BandPlan.adjScale(0.1)">+</button>'
      +'</div></div>'
      +'<div><div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">Plan</div>'
      +'<div style="display:flex;align-items:center;gap:3px">'
      +'<button class="bp-sc-btn" onclick="BandPlan.adjZ(-1)">↓</button>'
      +'<span style="font-family:var(--m);font-size:10px;color:var(--txt2);min-width:28px;text-align:center">'+sel.z+'</span>'
      +'<button class="bp-sc-btn" onclick="BandPlan.adjZ(1)">↑</button>'
      +'</div></div>'
      +'</div>'
      +'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:6px">Rotation</div>'
      +'<div class="bp-rot-grp">'
      +[0,90,180,270].map(r=>'<button class="bp-rot-btn'+(sel.rot===r?' on':'')+'" onclick="BandPlan.setRot('+r+')">'+r+'°</button>').join('')
      +'</div>'
      +'</div>'
      // --- Riser (praticable)
      +(sel.type==='riser'
        ?'<div class="bp-insp-sec">'
         +'<div class="bp-insp-title"><i class="ti ti-layout-board" style="color:#8899bb"></i>Praticable</div>'
         +'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:4px">Dimensions</div>'
         +'<select class="bp-il-sel" onchange="BandPlan.setRiserDims(this.value)" style="margin-bottom:9px">'
         +RISER_SIZES.map(s=>'<option value="'+s.w+','+s.h+'"'+((sel.riserW||2)===s.w&&(sel.riserH||1)===s.h?' selected':'')+'>'+s.label+'</option>').join('')
         +'</select>'
         +'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:4px">Hauteur</div>'
         +'<select class="bp-il-sel" onchange="BandPlan.setRiserAlt(+this.value)">'
         +RISER_ALTS.map(a=>'<option value="'+a+'"'+((sel.riserAlt||0.4)===a?' selected':'')+'>'+a+' m</option>').join('')
         +'</select>'
         +'</div>'
        :'')
      // --- Input / Output List
      +(sel.type==='kit'
        ?(()=>{
          const kitChs=sel.chs||[];
          const linkedRows=kitChs.map(id=>_chById(id)).filter(Boolean);
          const remOpts=_chOpts(null,kitChs);
          const availMulti=_allC.filter(r=>(r.patch_id||'main')===_lp && kitChs.indexOf(r.id)<0);
          const isPro=canDo('bulk_link');
          const multiBlock=_bpKitMulti
            ? '<div style="border:1px solid var(--bdr2);border-radius:8px;padding:8px;margin-bottom:6px;max-height:190px;overflow:auto;background:var(--surf2)">'
              +(availMulti.length
                ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px"><span style="font-size:9px;font-family:var(--m);color:var(--muted)">Cochez les canaux</span><button onclick="BandPlan.kitMultiAll(this)" style="background:none;border:none;color:var(--ora);font-size:9px;cursor:pointer;font-family:var(--m)">Tout cocher</button></div>'
                  +availMulti.map(r=>'<label style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--txt2);padding:3px 2px;cursor:pointer;user-select:none"><input type="checkbox" class="bp-kit-msel cb" value="'+r.id+'"/> CH'+r.ch+' — '+_escO(r.long_name||r.short_name||'—')+'</label>').join('')
                  +'<button class="bp-il-create" style="margin-top:7px" onclick="BandPlan.linkKitChMulti()"><i class="ti ti-plug-connected"></i>Ajouter la sélection</button>'
                : '<div style="font-size:10px;color:var(--muted);padding:4px 0">Aucun canal disponible dans cette liste.</div>')
              +'</div>'
              +'<button class="bp-il-create" style="background:var(--surf3);margin-bottom:6px" onclick="BandPlan.toggleKitMulti()"><i class="ti ti-x"></i>Fermer</button>'
            : (remOpts?'<select class="bp-il-sel" onchange="BandPlan.linkKitCh(this.value)" style="margin-bottom:6px"><option value="">+ Ajouter un canal…</option>'+remOpts+'</select>':'')
              +'<button class="bp-il-create" style="margin-bottom:6px" onclick="BandPlan.toggleKitMulti()"><i class="ti ti-checkbox"></i>Sélection multiple'+(isPro?'':' <span style="font-size:8px;background:var(--ora);color:#04231a;padding:1px 4px;border-radius:4px;font-weight:700;margin-left:3px">PRO</span>')+'</button>';
          return '<div class="bp-insp-sec">'
            +'<div class="bp-insp-title"><i class="ti ti-list-numbers" style="color:var(--ora)"></i>Input List — Kit</div>'
            +_listSel
            +linkedRows.map(r=>'<div class="bp-kit-ch-row"><i class="ti ti-plug-connected" style="color:var(--ora);font-size:11px"></i><span>CH '+r.ch+' — '+(r.long_name||r.short_name||'—')+'</span><button class="bp-kit-ch-del" onclick="BandPlan.unlinkKitCh(\''+r.id+'\')" title="Dissocier">\xd7</button></div>').join('')
            +multiBlock
            +'<button class="bp-il-create" onclick="BandPlan.createKitCh()"><i class="ti ti-plus"></i>Creer un canal</button>'
            +'</div>';
        })()
        :_isOutput(sel.type)
          ?(()=>{
            const outChs=typeof OUT_CHS!=='undefined'?OUT_CHS:[];
            const linkedOut=outChs.find(r=>r.id===sel.outCh);
            const linkedOutR=sel.outStereo?outChs.find(r=>r.id===sel.outChR):null;
            const outOpts=outChs.map(r=>'<option value="'+r.id+'"'+(sel.outCh===r.id?' selected':'')+'>OUT'+r.ch+' — '+(r.long_name||r.short_name||'—')+'</option>').join('');
            const outOptsR=outChs.map(r=>'<option value="'+r.id+'"'+(sel.outChR===r.id?' selected':'')+'>OUT'+r.ch+' — '+(r.long_name||r.short_name||'—')+'</option>').join('');
            const gc='#22d6a0';
            return '<div class="bp-insp-sec">'
              +'<div class="bp-insp-title"><i class="ti ti-list-numbers" style="color:'+gc+'"></i>Output List</div>'
              +'<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:11px;color:var(--txt2);margin-bottom:9px;user-select:none">'
              +'<input type="checkbox" class="cb"'+(sel.outStereo?' checked':'')+' onchange="BandPlan.toggleOutStereo(this.checked)"/> Stereo (2 sorties L+R)'
              +'</label>'
              +(sel.outStereo?'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">Sortie L</div>':'')
              +(linkedOut
                ?'<div class="bp-il-badge" style="border-color:rgba(34,214,160,.3);color:'+gc+'"><i class="ti ti-plug-connected"></i>OUT '+linkedOut.ch+' — '+(linkedOut.long_name||linkedOut.short_name||'—')+'</div>'
                 +'<button class="bp-il-unlink" onclick="BandPlan.unlinkOutCh()">Dissocier</button>'
                :(outOpts?'<select class="bp-il-sel" onchange="BandPlan.linkOutCh(this.value)"><option value="">— Lier a une sortie'+(sel.outStereo?' L':'')+' —</option>'+outOpts+'</select>':'<div style="font-size:10px;color:var(--muted);padding:4px 0">Aucune sortie dans l\'output list.</div>')
              )
              +'<button class="bp-il-create" onclick="BandPlan.createOutCh()" style="margin-bottom:'+(sel.outStereo?'10':'0')+'px"><i class="ti ti-plus"></i>Creer une sortie'+(sel.outStereo?' L':'')+' </button>'
              +(sel.outStereo
                ?'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px;margin-top:2px">Sortie R</div>'
                 +(linkedOutR
                   ?'<div class="bp-il-badge" style="border-color:rgba(34,214,160,.3);color:'+gc+'"><i class="ti ti-plug-connected"></i>OUT '+linkedOutR.ch+' — '+(linkedOutR.long_name||linkedOutR.short_name||'—')+'</div>'
                    +'<button class="bp-il-unlink" onclick="BandPlan.unlinkOutChR()">Dissocier</button>'
                   :(outOptsR?'<select class="bp-il-sel" onchange="BandPlan.linkOutChR(this.value)"><option value="">— Lier a une sortie R —</option>'+outOptsR+'</select>':'<div style="font-size:10px;color:var(--muted);padding:4px 0">Aucune sortie dans l\'output list.</div>')
                 )
                 +'<button class="bp-il-create" onclick="BandPlan.createOutChR()"><i class="ti ti-plus"></i>Creer une sortie R</button>'
                :''
              )
              +'</div>';
          })()
          :sel.type==='image_frame'
            ?('<div class="bp-insp-sec">'
              +'<div class="bp-insp-title"><i class="ti ti-photo" style="color:var(--ora)"></i>Image</div>'
              +'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:5px">Taille</div>'
              +'<div style="display:flex;align-items:center;gap:7px;margin-bottom:9px">'
              +'<button class="spl-ts-btn" onclick="BandPlan.adjImgPx(\''+sel.id+'\',-40)">-</button>'
              +'<span style="flex:1;text-align:center;font-size:10px;color:var(--muted)">'+(sel.imgPx||240)+'px</span>'
              +'<button class="spl-ts-btn" onclick="BandPlan.adjImgPx(\''+sel.id+'\',40)">+</button>'
              +'</div>'
              +_iconImgInspHtml(sel.id, !!sel.iconImg, sel.iconImg||'', "BandPlan.uploadElementIcon('"+sel.id+"')", "BandPlan.clearElementIcon('"+sel.id+"')")
              +'</div>')
            :(()=>{
            const linkedChR=sel.stereo?_chById(sel.chR):null;
            const chOptsR=_chOpts(sel.chR);
            return '<div class="bp-insp-sec">'
              +'<div class="bp-insp-title"><i class="ti ti-list-numbers" style="color:var(--ora)"></i>Input List</div>'
              +_listSel
              // Stereo toggle
              +'<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:11px;color:var(--txt2);margin-bottom:9px;user-select:none">'
              +'<input type="checkbox" class="cb"'+(sel.stereo?' checked':'')+' onchange="BandPlan.toggleStereo(this.checked)"/> Stereo (2 canaux L+R)'
              +'</label>'
              // Canal L (ou mono)
              +(sel.stereo?'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px">Canal L</div>':'')
              +(linkedCh
                ?'<div class="bp-il-badge"><i class="ti ti-plug-connected"></i>CH '+linkedCh.ch+' — '+(linkedCh.long_name||linkedCh.short_name||'—')+'</div>'
                 +'<button class="bp-il-unlink" onclick="BandPlan.unlinkCh()">Dissocier</button>'
                :(chOpts?'<select class="bp-il-sel" onchange="BandPlan.linkCh(this.value)"><option value="">— Lier a un canal'+(sel.stereo?' L':'')+' —</option>'+chOpts+'</select>':'')
              )
              +'<button class="bp-il-create" onclick="BandPlan.createCh()" style="margin-bottom:'+(sel.stereo?'10':'0')+'px"><i class="ti ti-plus"></i>Creer un canal'+(sel.stereo?' L':'')+' </button>'
              // Canal R (stereo uniquement)
              +(sel.stereo
                ?'<div style="font-size:9px;font-family:var(--m);color:var(--muted);margin-bottom:3px;margin-top:2px">Canal R</div>'
                 +(linkedChR
                   ?'<div class="bp-il-badge"><i class="ti ti-plug-connected"></i>CH '+linkedChR.ch+' — '+(linkedChR.long_name||linkedChR.short_name||'—')+'</div>'
                    +'<button class="bp-il-unlink" onclick="BandPlan.unlinkChR()">Dissocier</button>'
                   :(chOptsR?'<select class="bp-il-sel" onchange="BandPlan.linkChR(this.value)"><option value="">— Lier a un canal R —</option>'+chOptsR+'</select>':'')
                 )
                 +'<button class="bp-il-create" onclick="BandPlan.createChR()"><i class="ti ti-plus"></i>Creer un canal R</button>'
                :''
              )
              +'</div>'
              /* Image personnalisée */
              +_iconImgInspHtml(sel.id, !!sel.iconImg, sel.iconImg||'', "BandPlan.uploadElementIcon('"+sel.id+"')", "BandPlan.clearElementIcon('"+sel.id+"')");
          })()
      );
  }

  function updateAlias(v){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.label=v;
    const div=document.querySelector('[data-bpid="'+_sel+'"]');
    if(div){const lbl=div.querySelector('.bp-node-lbl');if(lbl)lbl.textContent=v;}
    clearTimeout(_saveT);_saveT=setTimeout(saveStage,800);
  }
  function updPos(axis,v){
    const el=st.els.find(e=>e.id===_sel);if(!el||isNaN(v))return;
    el[axis]=v;
    const div=document.querySelector('[data-bpid="'+_sel+'"]');
    if(div)div.style[axis==='x'?'left':'top']=v+'px';
    clearTimeout(_saveT);_saveT=setTimeout(saveStage,600);
  }
  function adjScale(d){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.scl=Math.max(0.3,Math.min(3,+(el.scl+d).toFixed(2)));
    const div=document.querySelector('[data-bpid="'+_sel+'"]');
    if(div)div.style.transform='rotate('+el.rot+'deg) scale('+el.scl+')';
    renderInspector();saveStage();
  }
  function adjZ(d){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.z=Math.max(1,el.z+d);
    const div=document.querySelector('[data-bpid="'+_sel+'"]');
    if(div)div.style.zIndex=el.z;
    renderInspector();saveStage();
  }
  function setRot(deg){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.rot=deg;
    const div=document.querySelector('[data-bpid="'+_sel+'"]');
    if(div){div.style.transform='rotate('+deg+'deg) scale('+el.scl+')';const _lbl=div.querySelector('.bp-vnode-lbl,.bp-node-lbl');if(_lbl)_lbl.style.transform='rotate('+(-deg)+'deg)';}
    renderInspector();saveStage();
  }
  function setRiserDims(val){
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='riser')return;
    const parts=val.split(',');
    el.riserW=parseFloat(parts[0]);el.riserH=parseFloat(parts[1]);
    renderNode(el);renderInspector();saveStage();
  }
  function setRiserAlt(val){
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='riser')return;
    el.riserAlt=val;
    renderNode(el);renderInspector();saveStage();
  }
  function linkKitCh(chId){
    if(!chId)return;
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='kit')return;
    if(!el.chs)el.chs=[];
    if(!el.chs.includes(chId))el.chs.push(chId);
    renderNode(el);renderInspector();saveStage();
  }
  function unlinkKitCh(chId){
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='kit')return;
    el.chs=(el.chs||[]).filter(id=>id!==chId);
    renderNode(el);renderInspector();saveStage();
  }
  async function createKitCh(){
    const el=st.els.find(e=>e.id===_sel);if(!el||el.type!=='kit'||!CUR_SHOW)return;
    if(!el.chs)el.chs=[];
    const ch=CHS.length+1;
    const row={show_id:CUR_SHOW.id,ch,short_name:(el.label||'').slice(0,4).toUpperCase().replace(/\s/g,''),long_name:el.label||'',source:'',mic:'',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''};
    if(_patchColReady)row.patch_id=CUR_PATCH_ID;
    const {data,error}=await sb.from('channels').insert(row).select().single();
    if(error){toast('Erreur : '+error.message);return;}
    CHS.push(data);renderTable();
    el.chs.push(data.id);
    renderNode(el);renderInspector();saveStage();
    toast('Canal CH'+ch+' cree et lie au kit');
  }
  function linkCh(chId){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.ch=chId||null;
    renderNode(el);renderInspector();saveStage();
  }
  function unlinkCh(){linkCh(null);}
  function toggleStereo(on){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.stereo=!!on;
    if(!on){el.chR=null;}
    renderNode(el);renderInspector();saveStage();
  }
  function linkChR(chId){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.chR=chId||null;
    renderNode(el);renderInspector();saveStage();
  }
  function unlinkChR(){linkChR(null);}
  async function createChR(){
    const el=st.els.find(e=>e.id===_sel);if(!el||!CUR_SHOW)return;
    const ch=CHS.length+1;
    const row={show_id:CUR_SHOW.id,ch,short_name:(el.label||'').slice(0,3).toUpperCase().replace(/\s/g,'')+'R',long_name:(el.label||'')+' R',source:'',mic:'',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''};
    if(_patchColReady)row.patch_id=CUR_PATCH_ID;
    const {data,error}=await sb.from('channels').insert(row).select().single();
    if(error){toast('Erreur : '+error.message);return;}
    CHS.push(data);renderTable();
    el.chR=data.id;
    renderNode(el);renderInspector();saveStage();
    toast('Canal CH'+ch+' (R) cree et lie a "'+el.label+'"');
  }
  function linkOutCh(outChId){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.outCh=outChId||null;
    renderNode(el);renderInspector();saveStage();
  }
  function unlinkOutCh(){linkOutCh(null);}
  function toggleOutStereo(on){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.outStereo=!!on;
    if(!on){el.outChR=null;}
    renderNode(el);renderInspector();saveStage();
  }
  function linkOutChR(outChId){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    el.outChR=outChId||null;
    renderNode(el);renderInspector();saveStage();
  }
  function unlinkOutChR(){linkOutChR(null);}
  function createOutChR(){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    const outChs=typeof OUT_CHS!=='undefined'?OUT_CHS:[];
    const ch=outChs.length+1;
    const row={id:'o'+Date.now()+Math.random().toString(36).slice(2,5),ch,short_name:(el.label||'').slice(0,3).toUpperCase().replace(/\s/g,'')+'R',long_name:(el.label||'')+' R',type:'other',dest:'',note:''};
    if(typeof OUT_CHS!=='undefined'){OUT_CHS.push(row);if(typeof saveOutData==='function')saveOutData();if(typeof renderOutTable==='function')renderOutTable();}
    el.outChR=row.id;
    renderNode(el);renderInspector();saveStage();
    toast('Sortie OUT'+ch+' (R) creee et liee a "'+el.label+'"');
  }
  function createOutCh(){
    const el=st.els.find(e=>e.id===_sel);if(!el)return;
    const outChs=typeof OUT_CHS!=='undefined'?OUT_CHS:[];
    const ch=outChs.length+1;
    const row={id:'o'+Date.now()+Math.random().toString(36).slice(2,5),ch,short_name:(el.label||'').slice(0,4).toUpperCase().replace(/\s/g,''),long_name:el.label||'',type:'other',dest:'',note:''};
    if(typeof OUT_CHS!=='undefined'){OUT_CHS.push(row);if(typeof saveOutData==='function')saveOutData();if(typeof renderOutTable==='function')renderOutTable();}
    el.outCh=row.id;
    renderNode(el);renderInspector();saveStage();
    toast('Sortie OUT'+ch+' creee et liee a "'+el.label+'"');
  }
  async function createCh(){
    const el=st.els.find(e=>e.id===_sel);if(!el||!CUR_SHOW)return;
    const ch=CHS.length+1;
    const row={show_id:CUR_SHOW.id,ch,short_name:(el.label||'').slice(0,4).toUpperCase().replace(/\s/g,''),long_name:el.label||'',source:'',mic:'',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''};
    if(_patchColReady)row.patch_id=CUR_PATCH_ID;
    const {data,error}=await sb.from('channels').insert(row).select().single();
    if(error){toast('Erreur : '+error.message);return;}
    CHS.push(data);renderTable();
    el.ch=data.id;
    renderNode(el);renderInspector();saveStage();
    toast('Canal CH'+ch+' cree et lie a "'+el.label+'"');
  }

  // ---- zoom / pan ----
  function zoom(f){
    const wrap=_wrap();if(!wrap)return;
    const rect=wrap.getBoundingClientRect();
    const cx=rect.width/2,cy=rect.height/2;
    st.view.px=cx-(cx-st.view.px)*f;
    st.view.py=cy-(cy-st.view.py)*f;
    st.view.z=Math.max(0.2,Math.min(3,st.view.z*f));
    applyTransform();
    _updateZoomSlider();
  }
  function setZoomPct(pct){
    const wrap=_wrap();if(!wrap)return;
    const target=Math.max(0.2,Math.min(3,(+pct)/100));
    const rect=wrap.getBoundingClientRect();
    const cx=rect.width/2,cy=rect.height/2;
    const factor=target/st.view.z;
    st.view.px=cx-(cx-st.view.px)*factor;
    st.view.py=cy-(cy-st.view.py)*factor;
    st.view.z=target;
    applyTransform();
    _updateZoomSlider();
  }
  function resetZoom(){ setZoomPct(100); }
  function _updateZoomSlider(){
    var s=document.getElementById('bp-zoom-slider');
    if(s) s.value=Math.min(300,Math.max(20,Math.round(st.view.z*100)));
    var l=document.getElementById('bp-zoom-lbl');
    if(l) l.textContent=Math.round(st.view.z*100)+'%';
  }
  function fitView(){
    const wrap=_wrap();if(!wrap)return;
    const rect=wrap.getBoundingClientRect();
    if(!rect.width||!rect.height){requestAnimationFrame(fitView);return;}
    st.view.z=Math.min(rect.width/2400,rect.height/1600)*.9;
    st.view.px=(rect.width-2400*st.view.z)/2;
    st.view.py=(rect.height-1600*st.view.z)/2;
    applyTransform();
    _updateZoomSlider();
  }
  function search(q){renderPalette(q);}

  // ---- canvas events ----
  function _initCanvas(){
    const wrap=_wrap();if(!wrap)return;
    wrap.addEventListener('dragover',e=>e.preventDefault());
    wrap.addEventListener('drop',e=>{
      e.preventDefault();
      const t=e.dataTransfer.getData('bp-type');if(!t)return;
      const rect=wrap.getBoundingClientRect();
      const cx=(e.clientX-rect.left-st.view.px)/st.view.z-31;
      const cy=(e.clientY-rect.top-st.view.py)/st.view.z-31;
      addNode(t,cx,cy);
    });
    wrap.addEventListener('pointerdown',e=>{
      if(e.target!==wrap&&e.target!==_cv()&&e.target.id!=='bp-stage-svg'&&!e.target.closest('#bp-stage-svg'))return;
      _pan=true;_pox=e.clientX-st.view.px;_poy=e.clientY-st.view.py;
      wrap.style.cursor='grabbing';wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove',e=>{
      if(!_pan)return;
      st.view.px=e.clientX-_pox;st.view.py=e.clientY-_poy;applyTransform();
    });
    wrap.addEventListener('pointerup',()=>{_pan=false;const w=_wrap();if(w)w.style.cursor='';});
    wrap.addEventListener('click',e=>{
      if(e.target===wrap||e.target===_cv()||e.target.closest('#bp-stage-svg')){
        _sel=null;renderInspector();document.querySelectorAll('.bp-node').forEach(n=>n.classList.remove('sel'));
      }
    });
    wrap.addEventListener('wheel',e=>{
      e.preventDefault();
      if(e.ctrlKey){
        // Pinch-to-zoom (trackpad) or Ctrl+wheel — zoom centred on cursor
        const f=Math.pow(0.995,e.deltaY);
        const rect=wrap.getBoundingClientRect();
        const cx=e.clientX-rect.left,cy=e.clientY-rect.top;
        st.view.px=cx-(cx-st.view.px)*f;
        st.view.py=cy-(cy-st.view.py)*f;
        st.view.z=Math.max(0.15,Math.min(3,st.view.z*f));
        applyTransform();
      } else {
        // Two-finger scroll (trackpad) or plain wheel — pan the canvas
        st.view.px-=e.deltaX;
        st.view.py-=e.deltaY;
        applyTransform();
      }
    },{passive:false});
  }

  // ---- init ----
  function init(){
    if(_inited)return;_inited=true;
    _loadCustomItems();
    renderPalette();
    const cv=_cv();if(!cv)return;
    const bg=document.createElement('div');
    bg.id='bp-stage-svg';bg.style.cssText='position:absolute;top:0;left:0;width:2400px;height:1600px;pointer-events:none';
    bg.innerHTML=_buildStageSVG_vintage();
    cv.insertBefore(bg,cv.firstChild);
    /* Déplacement de l'image de fond (actif uniquement en mode "Ajuster") + poignée de redim. */
    const bgImgEl=document.getElementById('bp-bg-img');
    if(bgImgEl){ bgImgEl.style.touchAction='none'; bgImgEl.addEventListener('pointerdown',_bgImgDown); }
    _ensureBgHandle();
    _applyStageVis();
    _initCanvas();
    applyTransform();
    _applyGlobalScales();
    _updateViewModeUI();
  }

  // ---- save/load ----
  function getData(){return {els:st.els.map(e=>({...e})),nid:st.nid,view:{...st.view},textScale:st.textScale,nodeScale:st.nodeScale,stageScale:st.stageScale,viewMode:st.viewMode,bgImage:st.bgImage||null,bgOpacity:st.bgOpacity??100,bgX:st.bgX||0,bgY:st.bgY||0,bgScale:st.bgScale??1,hideStage:!!st.hideStage};}
  function load(data){
    st.els=[];st.nid=1;
    _cv()?.querySelectorAll('.bp-node').forEach(n=>n.remove());
    st.bgImage=null;st.bgOpacity=100;st.bgX=0;st.bgY=0;st.bgScale=1;_bgEdit=false;st.hideStage=false;
    if(!data||!data.els){_applyBg();_applyStageVis();return;}
    st.els=data.els;
    st.nid=data.nid||(st.els.length?Math.max(...st.els.map(e=>e.id))+1:1);
    if(data.view)Object.assign(st.view,data.view);
    if(data.textScale)st.textScale=data.textScale;
    if(data.nodeScale)st.nodeScale=data.nodeScale;
    if(data.stageScale)st.stageScale=data.stageScale;
    if(data.bgImage)st.bgImage=data.bgImage;
    if(data.bgOpacity!=null)st.bgOpacity=data.bgOpacity;
    /* Garde-fou : une image de fond ne doit jamais être quasi invisible
       (anciennes données sous l'ancien plancher de 5%). */
    if(st.bgImage&&st.bgOpacity<20)st.bgOpacity=20;
    if(data.bgX!=null)st.bgX=data.bgX;
    if(data.bgY!=null)st.bgY=data.bgY;
    if(data.bgScale!=null)st.bgScale=data.bgScale;
    if(data.hideStage!=null)st.hideStage=!!data.hideStage;
    st.viewMode='vintage';  /* Always vintage now — toggle removed */
    st.els.forEach(el=>renderNode(el));
    applyTransform();_applyGlobalScales();_applyBg();_applyStageVis();_sel=null;renderInspector();
  }
  function clear(){
    st.els=[];st.nid=1;st.bgImage=null;st.bgOpacity=100;st.bgX=0;st.bgY=0;st.bgScale=1;_bgEdit=false;
    _cv()?.querySelectorAll('.bp-node').forEach(n=>n.remove());
    _applyBg();_sel=null;renderInspector();saveStage();
  }

  /* Returns the stage rect geometry based on current stageScale */
  function _getStageDims(){
    const ss=st.stageScale||1;
    const w=Math.min(2380,Math.round(2300*ss));
    const h=Math.min(1570,Math.round(1480*ss));
    const x=Math.round(1200-w/2);
    const y=Math.max(20,Math.round(180-(h-900)/2));
    const sepY=y+h;
    const pubY=Math.min(1580,sepY+Math.round(180*Math.max(0.5,1/ss)));
    const cy=Math.round(y+h*0.44);
    return {x,y,w,h,cx:1200,cy,sepY,pubY};
  }

  function _buildStageSVG(){
    const d=_getStageDims();
    return '<svg width="2400" height="1600" xmlns="http://www.w3.org/2000/svg">'
      +'<rect x="0" y="0" width="2400" height="1600" fill="#f4f4f4"/>'
      +'<defs><pattern id="bpg" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 L0 0 0 40" fill="none" stroke="#ddd" stroke-width="0.6"/></pattern></defs>'
      +'<rect width="2400" height="1600" fill="url(#bpg)"/>'
      +'<rect x="'+d.x+'" y="'+d.y+'" width="'+d.w+'" height="'+d.h+'" rx="18" fill="rgba(255,107,26,0.045)" stroke="rgba(255,107,26,0.25)" stroke-width="2" stroke-dasharray="12,6"/>'
      +'<text x="1200" y="'+d.cy+'" text-anchor="middle" font-family="DM Mono,monospace" font-size="18" fill="rgba(255,107,26,0.18)" letter-spacing="10">SCENE</text>'
      +'<line x1="'+d.x+'" y1="'+d.sepY+'" x2="'+(d.x+d.w)+'" y2="'+d.sepY+'" stroke="rgba(180,90,30,0.13)" stroke-width="2"/>'
      +'<text x="1200" y="'+d.pubY+'" text-anchor="middle" font-family="DM Mono,monospace" font-size="13" fill="rgba(150,150,150,0.32)" letter-spacing="6">PUBLIC</text>'
      +'</svg>';
  }

  function _buildStageSVG_vintage(){
    const d=_getStageDims();
    /* Light theme — white background with subtle grid pattern (SynPro look) */
    return '<svg width="2400" height="1600" xmlns="http://www.w3.org/2000/svg">'
      +'<defs>'
      +'<pattern id="bp_grid" width="40" height="40" patternUnits="userSpaceOnUse">'
      +'<path d="M40 0 L0 0 0 40" fill="none" stroke="#e5eaf2" stroke-width="0.6"/>'
      +'</pattern>'
      +'<linearGradient id="bp_foot" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#ff6b1a" stop-opacity="0.10"/><stop offset="100%" stop-color="#ff6b1a" stop-opacity="0"/></linearGradient>'
      +'</defs>'
      +'<rect width="2400" height="1600" fill="#ffffff"/>'
      +'<rect width="2400" height="1600" fill="url(#bp_grid)"/>'
      +'<rect x="'+d.x+'" y="'+d.y+'" width="'+d.w+'" height="'+d.h+'" rx="18" fill="rgba(255,107,26,0.035)" stroke="rgba(255,107,26,0.30)" stroke-width="2" stroke-dasharray="14,7"/>'
      +'<rect x="'+d.x+'" y="'+(d.sepY-55)+'" width="'+d.w+'" height="55" fill="url(#bp_foot)"/>'
      +'<text x="1200" y="'+d.cy+'" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="700" font-size="22" fill="rgba(255,107,26,0.18)" letter-spacing="12">SCENE</text>'
      +'<line x1="'+d.x+'" y1="'+d.sepY+'" x2="'+(d.x+d.w)+'" y2="'+d.sepY+'" stroke="rgba(255,107,26,0.30)" stroke-width="1.5" stroke-dasharray="6,4"/>'
      +'<text x="1200" y="'+d.pubY+'" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="600" font-size="14" fill="rgba(100,116,139,0.45)" letter-spacing="8">PUBLIC</text>'
      +'</svg>';
  }

  function _rebuildStageSVG(){
    const bg=document.getElementById('bp-stage-svg');
    if(bg)bg.innerHTML=_buildStageSVG_vintage();
    const sl=document.getElementById('bp-ss-val');
    if(sl)sl.textContent=Math.round((st.stageScale||1)*100)+'%';
  }

  function _applyGlobalScales(){
    const cv=_cv();if(!cv)return;
    cv.style.setProperty('--bp-ts',st.textScale);
    cv.style.setProperty('--bp-ns',st.nodeScale);
    const tl=document.getElementById('bp-ts-val');if(tl)tl.textContent=Math.round(st.textScale*100)+'%';
    const nl=document.getElementById('bp-ns-val');if(nl)nl.textContent=Math.round(st.nodeScale*100)+'%';
    const sl=document.getElementById('bp-ss-val');if(sl)sl.textContent=Math.round((st.stageScale||1)*100)+'%';
  }
  function setTextScale(dir){
    const steps=[0.6,0.75,0.85,1,1.2,1.4,1.7,2.1];
    let idx=steps.findIndex(s=>Math.abs(s-st.textScale)<0.05);
    if(idx<0)idx=steps.findIndex(s=>Math.abs(s-1.4)<0.05);
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    st.textScale=steps[idx];_applyGlobalScales();saveStage();
  }
  function setNodeScale(dir){
    const steps=[0.55,0.7,0.85,1,1.2,1.4,1.65,2];
    let idx=steps.findIndex(s=>Math.abs(s-st.nodeScale)<0.05);
    if(idx<0)idx=steps.findIndex(s=>Math.abs(s-1.4)<0.05);
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    st.nodeScale=steps[idx];_applyGlobalScales();saveStage();
  }
  function setStageScale(dir){
    const steps=[0.6,0.75,0.9,1,1.15,1.3,1.5];
    let idx=steps.findIndex(s=>Math.abs(s-(st.stageScale||1))<0.05);
    if(idx<0)idx=3;
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    st.stageScale=steps[idx];
    _rebuildStageSVG();
    saveStage();
  }

  /* Modern/Vintage toggle removed — only vintage rendering on a white canvas. */
  function _updateViewModeUI(){ /* no-op (toggle removed) */ }
  function setViewMode(){ /* no-op (vintage forced) */ }

  function getCatInfo(t){
    const cat=_catOf(t);
    const it=_itemOf(t);
    return {color:cat?cat.color:'#5a6580',emoji:it?it.e:'?'};
  }
  function getVintageSVG(t,col){return _vSVG(t,col);}
  function getViewMode(){return st.viewMode;}

  function adjImgPx(elId, delta){
    const el=st.els.find(e=>e.id===elId);if(!el)return;
    el.imgPx=Math.max(40,Math.min(2400,(el.imgPx||240)+delta));
    renderNode(el);renderInspector();saveStage();
  }

  function uploadElementIcon(elId){
    _pickIconFile(async function(file){
      try{
        const b64=await _resizeIconToB64(file);
        const el=st.els.find(e=>e.id===elId); if(!el)return;
        const b2Key=(typeof CUR_SHOW!=='undefined'&&CUR_SHOW?.id||'unknown')+'/node-icons/bp-'+elId+'-'+Date.now()+'.jpg';
        _b2DeleteIcon(el.iconImgB2);
        el.iconImg=b64; el.iconImgB2=b2Key;
        /* Capture du ratio pour image_frame */
        if(el.type==='image_frame'){
          var _aim=new Image();
          _aim.onload=function(){
            if(_aim.naturalHeight){ el.imgAspect=_aim.naturalWidth/_aim.naturalHeight; el._aspChk=true; }
            renderNode(el);renderInspector();saveStage();
            _b2UploadIcon(b64,b2Key);
          };
          _aim.src=b64; return;
        }
        renderNode(el); renderInspector(); saveStage();
        _b2UploadIcon(b64, b2Key);
      }catch(e){ if(typeof toast!=='undefined')toast('Erreur image : '+e.message); }
    });
  }
  function clearElementIcon(elId){
    const el=st.els.find(e=>e.id===elId); if(!el)return;
    _b2DeleteIcon(el.iconImgB2);
    el.iconImg=null; el.iconImgB2=null;
    renderNode(el); renderInspector(); saveStage();
  }

  return {init,load,getData,clear,zoom,setZoomPct,resetZoom,fitView,search,toggleCat,_pdrag,_pdblclick,renderInspector,updateAlias,updPos,adjScale,adjZ,setRot,linkCh,unlinkCh,createCh,toggleStereo,linkChR,unlinkChR,createChR,linkOutCh,unlinkOutCh,createOutCh,toggleOutStereo,linkOutChR,unlinkOutChR,createOutChR,deleteNode,setTextScale,setNodeScale,setStageScale,setRiserDims,setRiserAlt,addCustomItem,removeCustomItem,linkKitCh,unlinkKitCh,createKitCh,setViewMode,getCatInfo,getVintageSVG,getViewMode,loadBg,setBgOpacity,setBgScale,toggleBgEdit,toggleStageBg,clearBg,aiPlace,uploadElementIcon,clearElementIcon,adjImgPx,setLinkPatch,toggleKitMulti,linkKitChMulti,kitMultiAll};
})();

// ══════════════════════════════════════
// STAGE PLAN (legacy)
// ══════════════════════════════════════
const PAL=[{id:'main',label:'Main Array',icon:'🔊',color:'#1a8fff',w:46,h:22},{id:'sub',label:'Sub',icon:'📢',color:'#ff6b1a',w:40,h:18},{id:'wedge',label:'Wedge',icon:'🔺',color:'#f5c542',w:38,h:18},{id:'iem',label:'IEM TX',icon:'📡',color:'#9b6aff',w:30,h:20},{id:'amp',label:'Ampli CODA',icon:'⚡',color:'#22d6a0',w:52,h:22},{id:'sbox',label:'Stage Box',icon:'📦',color:'#5a6580',w:48,h:22},{id:'cfoh',label:'Console FOH',icon:'🎛',color:'#1a8fff',w:62,h:28},{id:'cmon',label:'Console MON',icon:'🎛',color:'#f5c542',w:62,h:28},{id:'mic',label:'Micro / Stand',icon:'🎤',color:'#e8edf8',w:20,h:26},{id:'drum',label:'Batterie',icon:'🥁',color:'#ff4d6a',w:60,h:44},{id:'keys',label:'Claviers',icon:'🎹',color:'#9b6aff',w:58,h:22},{id:'guit',label:'Guitare',icon:'🎸',color:'#f5c542',w:24,h:40},{id:'bass',label:'Basse',icon:'🎸',color:'#22d6a0',w:22,h:38}];
function initStage(){
  BandPlan.init();
}
function palDrag(e,id){e.dataTransfer.setData('pal',id);}
function buildStageEl(item,x,y,labelOverride){
  const c=document.getElementById('stage-c');
  const sid=stageId++;
  const label=labelOverride||item.label;
  const elData={id:sid,palId:item.id,label,icon:item.icon,color:item.color,w:item.w,h:item.h,x:Math.max(0,x),y:Math.max(0,y)};
  stageEls.push(elData);
  const div=document.createElement('div');
  div.className='s-el';div.dataset.sid=sid;
  div.style.left=elData.x+'px';div.style.top=elData.y+'px';
  div.innerHTML=`
    <div class="s-el-body" style="background:${item.color}18;border-color:${item.color}55;width:${item.w}px;height:${item.h}px;font-size:${item.h>30?18:13}px">${item.icon}</div>
    <input value="${label}" style="background:transparent;border:none;color:var(--muted);font-size:8px;font-family:var(--m);text-align:center;outline:none;width:${Math.max(item.w,52)}px" onchange="const d=stageEls.find(e=>e.id===${sid});if(d){d.label=this.value;saveStage();}"/>
    <button class="s-del" onclick="this.closest('.s-el').remove();stageEls=stageEls.filter(e=>e.id!==${sid});saveStage()">×</button>`;
  div.addEventListener('mousedown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON')return;
    document.querySelectorAll('.s-el').forEach(el=>el.classList.remove('sel'));
    div.classList.add('sel');
    const r=div.getBoundingClientRect();dox=e.clientX-r.left;doy=e.clientY-r.top;drag=div;e.preventDefault();
  });
  div.addEventListener('mouseenter',()=>div.querySelector('.s-del').style.display='flex');
  div.addEventListener('mouseleave',()=>div.querySelector('.s-del').style.display='none');
  return div;
}

function addSE(item,x,y){
  const c=document.getElementById('stage-c');
  c.appendChild(buildStageEl(item,x,y));
  saveStage();
}

function clearStage(){
  document.querySelectorAll('.s-el').forEach(e=>e.remove());
  stageEls=[];stageId=1;
  saveStage();
}
function clearCurrentPlan(){
  if(PLAN_MODE==='scene')BandPlan.clear();
  else SitePlan.clear();
}
function setPlanMode(mode,save=true){
  PLAN_MODE=mode;
  document.getElementById('plan-scene-wrap').style.display=mode==='scene'?'':'none';
  document.getElementById('plan-site-wrap').style.display=mode==='site'?'':'none';
  document.getElementById('pmb-scene').classList.toggle('on',mode==='scene');
  document.getElementById('pmb-site').classList.toggle('on',mode==='site');
  /* Bouton Annuler du plan : suit le mode actif (scène→stage, site→site). */
  var _undoBtn=document.getElementById('plan-undo-btn');
  if(_undoBtn){ _undoBtn.setAttribute('data-undo', mode==='site'?'site':'stage'); if(typeof SectionUndo!=='undefined') SectionUndo._sync(mode==='site'?'site':'stage'); }
  /* Scene tabs — chaque mode a sa propre barre, masquer l'autre */
  var stTabs=document.getElementById('scene-tabs-stage');
  var siTabs=document.getElementById('scene-tabs-site');
  if(stTabs) stTabs.classList.toggle('hidden', mode!=='scene');
  if(siTabs) siTabs.classList.toggle('hidden', mode!=='site');
  /* Ré-rendre les tabs du mode actif (au cas où pas encore peuplés) */
  _renderSceneTabs(mode==='site'?'site':'stage');
  /* Bouton mobile — affiche le mode opposé (action future) */
  var mobLbl=document.getElementById('mob-plan-mode-lbl');
  var mobBtn=document.getElementById('mob-plan-mode-btn');
  if(mobLbl) mobLbl.textContent=mode==='site'?'Scène':'Site';
  if(mobBtn){
    var mobIcon=mobBtn.querySelector('i');
    if(mobIcon) mobIcon.className=mode==='site'?'ti ti-layout-board':'ti ti-map-2';
  }
  /* Unified export dropdown — update labels/visibility */
  if(typeof _updatePlanExpWrap==='function') _updatePlanExpWrap();
  /* Re-render mobile view only if stage panel is currently visible */
  if(_isMobile() && document.getElementById('mob-stage-ov')?.classList.contains('mob-plan-show')){
    _showMobilePlanView(mode==='site'?'site':'stage');
  } else if(!_isMobile() && mode==='scene') setTimeout(()=>BandPlan.fitView(),50);
  if(save)saveStage();
}

// ══════════════════════════════════════
// RENDU FIDÈLE D'UN NŒUD DE PLAN DE SITE (export PNG/PDF + vue partagée)
// Reproduit l'apparence de l'éditeur : carte blanche (.spl-card), icône SVG
// centrée (sans boîte colorée), label gras navy, note. Utilisé par _makeCanvas
// (SitePlan) ET par le renderer de la vue partagée pour un rendu identique.
// ══════════════════════════════════════
function _spRR(ctx,x,y,w,h,r){
  if(r>w/2)r=w/2; if(r>h/2)r=h/2; if(r<0)r=0;
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}
/* Tronque un texte à une largeur max (px) avec ellipsis ASCII. ctx.font doit
   déjà être réglé. */
function _spFit(ctx,txt,maxW){
  txt=String(txt==null?'':txt);
  if(ctx.measureText(txt).width<=maxW) return txt;
  var s=txt;
  while(s.length>1 && ctx.measureText(s+'...').width>maxW) s=s.slice(0,-1);
  return s+'...';
}
var _SP_FONT='ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
var _SP_NAVY='#1d3a5f';
/* Dessine UN nœud. ex,ey = coin haut-gauche en px CANVAS (= wx(el.x),wy(el.y)).
   SCALE = facteur monde→canvas. TS = textScale. opt={color,iconImg,emoji}. */
function _spDrawSiteNode(ctx, el, ex, ey, SCALE, TS, opt){
  opt=opt||{}; TS=TS||1;
  var elTS=el.elTextScale||1;
  var color=opt.color||'#5a6580';
  var iconImg=(opt.iconImg && opt.iconImg!=='loading') ? opt.iconImg : null;
  var emoji=opt.emoji||'';

  /* ── Texte libre ── */
  if(el.type==='text_lbl'){
    var fs=Math.max(9,(el.elSize||18)*SCALE*TS*elTS);
    var txt=el.label||'';
    ctx.font='600 '+fs+'px '+_SP_FONT;
    ctx.textAlign='left'; ctx.textBaseline='top';
    if(!el.noBg){
      var tpadX=13*SCALE, tpadY=9*SCALE;
      var tw=ctx.measureText(txt).width;
      var bw=tw+tpadX*2, bh=fs+tpadY*2;
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,.06)'; ctx.shadowBlur=4*SCALE; ctx.shadowOffsetY=1*SCALE;
      _spRR(ctx,ex,ey,bw,bh,8*SCALE); ctx.fillStyle='#ffffff'; ctx.fill();
      ctx.restore();
      ctx.strokeStyle='rgba(29,58,95,.20)'; ctx.lineWidth=Math.max(1,1*SCALE); _spRR(ctx,ex,ey,bw,bh,8*SCALE); ctx.stroke();
      ctx.fillStyle=el.textColor||_SP_NAVY; ctx.fillText(txt, ex+tpadX, ey+tpadY);
    } else {
      ctx.fillStyle=el.textColor||_SP_NAVY; ctx.fillText(txt, ex, ey);
    }
    return;
  }

  /* ── Image flottante (au ratio, sans carte) ── */
  if(el.type==='image_frame'){
    var w0=(el.imgPx||el.elSize||120), asp=el.imgAspect||1;
    var iw=w0*SCALE, ih=(w0/asp)*SCALE;
    if(iconImg){
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,.20)'; ctx.shadowBlur=8*SCALE; ctx.shadowOffsetY=2*SCALE;
      _spRR(ctx,ex,ey,iw,ih,6*SCALE); ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
      ctx.save(); _spRR(ctx,ex,ey,iw,ih,6*SCALE); ctx.clip();
      ctx.drawImage(iconImg, ex, ey, iw, ih);
      ctx.restore();
    } else {
      ctx.strokeStyle='#c8d4e0'; ctx.setLineDash([5*SCALE,4*SCALE]); ctx.lineWidth=2*SCALE;
      _spRR(ctx,ex,ey,iw,ih,6*SCALE); ctx.stroke(); ctx.setLineDash([]);
    }
    if(el.label){
      var ilh=Math.max(9,12*TS*elTS*SCALE);
      ctx.font='700 '+ilh+'px '+_SP_FONT; ctx.fillStyle=_SP_NAVY;
      ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(_spFit(ctx,el.label,Math.max(iw,160*SCALE)), ex+iw/2, ey+ih+5*SCALE);
    }
    return;
  }

  /* ── Élément standard : carte blanche fidèle à .spl-card ── */
  var esz=(el.elSize||72);
  var bodyW=esz*SCALE, bodyH=esz*SCALE;
  var padL=12*SCALE, padR=12*SCALE, padT=9*SCALE, padB=12*SCALE, gap=5*SCALE;
  var lblFs=Math.max(9,12*TS*elTS*SCALE);
  var noteFs=Math.max(8,10*TS*elTS*SCALE);
  var maxInner=Math.max(bodyW,170*SCALE);
  var label=(el.label!=null&&el.label!=='')?el.label:'';
  var note=el.note||'';

  ctx.font='700 '+lblFs+'px '+_SP_FONT;
  var label2=label?_spFit(ctx,label,maxInner):'';
  var lblW=label2?ctx.measureText(label2).width:0;
  ctx.font='500 '+noteFs+'px '+_SP_FONT;
  var note2=note?_spFit(ctx,note,maxInner):'';
  var noteW=note2?ctx.measureText(note2).width:0;

  var innerW=Math.max(bodyW,lblW,noteW);
  var cardW=innerW+padL+padR;
  var cardH=padT+bodyH+(label2?gap+lblFs:0)+(note2?4*SCALE+noteFs:0)+padB;

  if(!el.noBg){
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.12)'; ctx.shadowBlur=10*SCALE; ctx.shadowOffsetY=2*SCALE;
    _spRR(ctx,ex,ey,cardW,cardH,11*SCALE); ctx.fillStyle='#ffffff'; ctx.fill();
    ctx.restore();
    ctx.strokeStyle='#c8d4e0'; ctx.lineWidth=Math.max(1,1*SCALE);
    _spRR(ctx,ex,ey,cardW,cardH,11*SCALE); ctx.stroke();
  }

  /* Icône centrée en haut (SVG navy ou image custom), sans boîte colorée. */
  var bodyX=ex+(cardW-bodyW)/2, bodyY=ey+padT;
  if(iconImg){
    var ipad=bodyW*0.06;
    var iar=(iconImg.naturalWidth||1)/(iconImg.naturalHeight||1); if(!isFinite(iar)||iar<=0)iar=1;
    var availW=bodyW-ipad*2, availH=bodyH-ipad*2;
    var dw=availW, dh=availW/iar; if(dh>availH){dh=availH; dw=availH*iar;}
    try{ ctx.drawImage(iconImg, bodyX+(bodyW-dw)/2, bodyY+(bodyH-dh)/2, dw, dh); }catch(e){}
  } else if(emoji){
    ctx.font=Math.round(bodyW*0.5)+'px '+_SP_FONT;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(emoji, bodyX+bodyW/2, bodyY+bodyH/2);
  } else {
    ctx.font='800 '+Math.round(bodyW*0.3)+'px '+_SP_FONT;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle=color; ctx.fillText((el.type||'').slice(0,4).toUpperCase(), bodyX+bodyW/2, bodyY+bodyH/2);
  }

  /* Label gras navy + note, centrés sous l'icône. */
  var cy=bodyY+bodyH+gap;
  if(label2){
    ctx.font='700 '+lblFs+'px '+_SP_FONT; ctx.fillStyle=_SP_NAVY;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(label2, ex+cardW/2, cy); cy+=lblFs+4*SCALE;
  }
  if(note2){
    ctx.font='500 '+noteFs+'px '+_SP_FONT; ctx.fillStyle='#64748b';
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(note2, ex+cardW/2, cy);
  }
}

// ══════════════════════════════════════
// SITE PLAN
// ══════════════════════════════════════
const SitePlan = (() => {
  /* ── Professional SVG icon library ── */
  const SITE_ICONS = {
    main_array: '<svg viewBox="0 0 48 64" fill="none"><g stroke="#1d3a5f" stroke-width="1" fill="#1d3a5f"><path d="M14 6 L34 6 L36 14 L12 14 Z"/><path d="M12 16 L36 16 L38 24 L10 24 Z"/><path d="M10 26 L38 26 L40 34 L8 34 Z"/><path d="M8 36 L40 36 L42 44 L6 44 Z"/></g><line x1="24" y1="2" x2="24" y2="6" stroke="#5a6a80" stroke-width="1.2"/><circle cx="24" cy="2" r="1.4" fill="#5a6a80"/></svg>',
    sub: '<svg viewBox="0 0 64 56" fill="none"><rect x="6" y="6" width="52" height="44" rx="2" fill="#1d3a5f" stroke="#0d1828" stroke-width="1"/><circle cx="32" cy="28" r="16" fill="#0d1828" stroke="#ff6b1a" stroke-width="1.5"/><circle cx="32" cy="28" r="11" fill="#16243d" stroke="#3a5378" stroke-width=".5"/><circle cx="32" cy="28" r="4" fill="#ff6b1a"/></svg>',
    frontfill: '<svg viewBox="0 0 48 56" fill="none"><rect x="6" y="6" width="36" height="44" rx="2" fill="#5ab0ff" stroke="#1d3a5f"/><circle cx="24" cy="20" r="8" fill="#0d1828" stroke="#fff"/><circle cx="24" cy="20" r="3" fill="#5ab0ff"/><circle cx="24" cy="40" r="5" fill="#0d1828" stroke="#fff"/><circle cx="24" cy="40" r="2" fill="#5ab0ff"/></svg>',
    delay: '<svg viewBox="0 0 48 56" fill="none"><path d="M24 4 L42 14 L42 38 L24 48 L6 38 L6 14 Z" fill="#9b6aff" stroke="#1d3a5f" stroke-width="1.4"/><circle cx="24" cy="26" r="9" fill="#0d1828" stroke="#fff"/><circle cx="24" cy="26" r="3.5" fill="#9b6aff"/></svg>',
    wedge: '<svg viewBox="0 0 64 40" fill="none"><path d="M4 32 L60 32 L52 6 L18 6 Z" fill="#f5c542" stroke="#1d3a5f" stroke-width="1.4"/><ellipse cx="32" cy="18" rx="10" ry="5" fill="#0d1828" stroke="#fff"/><circle cx="32" cy="18" r="2.5" fill="#f5c542"/></svg>',
    iem_tx: '<svg viewBox="0 0 48 48" fill="none"><rect x="6" y="14" width="36" height="22" rx="2" fill="#c4a0ff" stroke="#1d3a5f" stroke-width="1.2"/><circle cx="15" cy="25" r="3.5" fill="#0d1828" stroke="#fff"/><line x1="22" y1="25" x2="36" y2="25" stroke="#1d3a5f" stroke-width="1.5"/><path d="M40 8 Q46 18 40 28" fill="none" stroke="#c4a0ff" stroke-width="1.5" stroke-linecap="round"/><path d="M44 4 Q52 18 44 32" fill="none" stroke="#c4a0ff" stroke-width="1.3" stroke-linecap="round" opacity=".6"/></svg>',
    linus14: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#22d6a0" stroke-width="1"/><rect x="4" y="6" width="56" height="4" fill="#22d6a0"/><g fill="#16243d" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><g fill="#22d6a0"><circle cx="11" cy="20" r=".8"/><circle cx="14" cy="20" r=".8"/></g><text x="42" y="22" font-family="Outfit" font-size="7" font-weight="700" fill="#22d6a0">14</text></svg>',
    linus12: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#22d6a0" stroke-width="1"/><rect x="4" y="6" width="56" height="4" fill="#22d6a0"/><g fill="#16243d" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><g fill="#22d6a0"><circle cx="11" cy="20" r=".8"/><circle cx="14" cy="20" r=".8"/></g><text x="42" y="22" font-family="Outfit" font-size="7" font-weight="700" fill="#22d6a0">12</text></svg>',
    linus14d: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#22d6a0" stroke-width="1"/><rect x="4" y="6" width="56" height="4" fill="#22d6a0"/><g fill="#16243d" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><g fill="#22d6a0"><circle cx="11" cy="20" r=".8"/><circle cx="14" cy="20" r=".8"/></g><text x="40" y="22" font-family="Outfit" font-size="6.5" font-weight="700" fill="#22d6a0">14D</text></svg>',
    linus12c: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#1affd5" stroke-width="1"/><rect x="4" y="6" width="56" height="4" fill="#1affd5"/><g fill="#16243d" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><text x="40" y="22" font-family="Outfit" font-size="6.5" font-weight="700" fill="#1affd5">12C</text></svg>',
    linus10: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="1.5" fill="#0d1828" stroke="#22d6a0" stroke-width="1"/><rect x="4" y="6" width="56" height="4" fill="#22d6a0"/><g fill="#16243d" stroke="#3a5378" stroke-width=".3"><rect x="7" y="13" width="22" height="14" rx="1"/><rect x="32" y="13" width="22" height="14" rx="1"/></g><g fill="#22d6a0"><circle cx="11" cy="20" r=".8"/></g><text x="42" y="22" font-family="Outfit" font-size="7" font-weight="700" fill="#22d6a0">10</text></svg>',
    linuscon: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="2" fill="#0d1828" stroke="#5ab0ff" stroke-width="1"/><circle cx="20" cy="18" r="5" fill="#16243d" stroke="#5ab0ff"/><circle cx="20" cy="18" r="2" fill="#5ab0ff"/><g fill="#5ab0ff"><rect x="32" y="13" width="3" height="10" rx="1"/><rect x="38" y="13" width="3" height="10" rx="1"/><rect x="44" y="13" width="3" height="10" rx="1"/><rect x="50" y="13" width="3" height="10" rx="1"/></g></svg>',
    lmx14r: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#0d1828" stroke="#9b6aff" stroke-width="1"/><g fill="#16243d" stroke="#3a5378" stroke-width=".4"><rect x="8" y="14" width="6" height="6" rx=".5"/><rect x="16" y="14" width="6" height="6" rx=".5"/><rect x="24" y="14" width="6" height="6" rx=".5"/><rect x="32" y="14" width="6" height="6" rx=".5"/><rect x="40" y="14" width="6" height="6" rx=".5"/><rect x="48" y="14" width="6" height="6" rx=".5"/></g><g fill="#9b6aff"><rect x="9" y="22" width="4" height="2" rx=".3"/><rect x="17" y="22" width="4" height="2" rx=".3"/><rect x="25" y="22" width="4" height="2" rx=".3"/></g></svg>',
    lmx10p: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#0d1828" stroke="#9b6aff" stroke-width="1"/><g fill="#16243d" stroke="#3a5378" stroke-width=".4"><rect x="10" y="14" width="6" height="6" rx=".5"/><rect x="18" y="14" width="6" height="6" rx=".5"/><rect x="26" y="14" width="6" height="6" rx=".5"/><rect x="34" y="14" width="6" height="6" rx=".5"/><rect x="42" y="14" width="6" height="6" rx=".5"/></g><text x="32" y="27" text-anchor="middle" font-family="Outfit" font-size="5.5" font-weight="700" fill="#9b6aff">PoE</text></svg>',
    lmx25g: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#0d1828" stroke="#b48aff" stroke-width="1"/><g fill="#16243d" stroke="#3a5378" stroke-width=".4"><rect x="8" y="14" width="6" height="6" rx=".5"/><rect x="16" y="14" width="6" height="6" rx=".5"/><rect x="24" y="14" width="6" height="6" rx=".5"/><rect x="32" y="14" width="6" height="6" rx=".5"/></g><text x="46" y="20" font-family="Outfit" font-size="6" font-weight="700" fill="#b48aff">25G</text></svg>',
    sw_dante: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="10" width="56" height="20" rx="2" fill="#0d1828" stroke="#5ab0ff" stroke-width="1"/><g fill="#16243d" stroke="#3a5378" stroke-width=".4"><rect x="8" y="14" width="6" height="6" rx=".5"/><rect x="16" y="14" width="6" height="6" rx=".5"/><rect x="24" y="14" width="6" height="6" rx=".5"/><rect x="32" y="14" width="6" height="6" rx=".5"/></g><text x="48" y="20" font-family="Outfit" font-size="5" font-weight="700" fill="#5ab0ff">DANTE</text></svg>',
    wifi_ap: '<svg viewBox="0 0 48 40" fill="none" stroke="#5ab0ff" stroke-width="2" stroke-linecap="round"><path d="M8 22 Q24 6 40 22"/><path d="M14 26 Q24 16 34 26"/><path d="M20 30 Q24 26 28 30"/><circle cx="24" cy="34" r="2" fill="#5ab0ff"/></svg>',
    console_foh: '<svg viewBox="0 0 64 48" fill="none"><rect x="3" y="6" width="58" height="36" rx="2" fill="#1a8fff"/><rect x="3" y="6" width="58" height="9" rx="2" fill="#0d1828"/><rect x="6" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#fff" stroke-width=".4"/><rect x="24" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#fff" stroke-width=".4"/><g fill="#fff"><rect x="42" y="20" width="2" height="9"/><rect x="46" y="20" width="2" height="9"/><rect x="50" y="20" width="2" height="9"/><rect x="54" y="20" width="2" height="9"/></g><text x="32" y="11" text-anchor="middle" font-family="Outfit" font-size="4.5" font-weight="700" fill="#1a8fff">FOH</text></svg>',
    console_mon: '<svg viewBox="0 0 64 48" fill="none"><rect x="3" y="6" width="58" height="36" rx="2" fill="#f5c542"/><rect x="3" y="6" width="58" height="9" rx="2" fill="#0d1828"/><rect x="6" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#fff" stroke-width=".4"/><rect x="24" y="18" width="16" height="22" rx="1" fill="#16243d" stroke="#fff" stroke-width=".4"/><g fill="#fff"><rect x="42" y="20" width="2" height="9"/><rect x="46" y="20" width="2" height="9"/><rect x="50" y="20" width="2" height="9"/><rect x="54" y="20" width="2" height="9"/></g><text x="32" y="11" text-anchor="middle" font-family="Outfit" font-size="4.5" font-weight="700" fill="#f5c542">MON</text></svg>',
    processor: '<svg viewBox="0 0 64 36" fill="none"><rect x="4" y="6" width="56" height="24" rx="2" fill="#0d1828" stroke="#22d6a0"/><rect x="4" y="6" width="56" height="4" fill="#22d6a0"/><circle cx="14" cy="20" r="5" fill="#16243d" stroke="#22d6a0"/><circle cx="14" cy="20" r="1.5" fill="#22d6a0"/><circle cx="30" cy="20" r="5" fill="#16243d" stroke="#22d6a0"/><circle cx="30" cy="20" r="1.5" fill="#22d6a0"/><g fill="#22d6a0"><rect x="42" y="16" width="3" height="8" rx="1"/><rect x="48" y="16" width="3" height="8" rx="1"/><rect x="54" y="16" width="3" height="8" rx="1"/></g></svg>',
    cdj: '<svg viewBox="0 0 64 48" fill="none"><rect x="4" y="4" width="56" height="40" rx="3" fill="#16243d" stroke="#1d3a5f"/><circle cx="32" cy="26" r="16" fill="#0d1828" stroke="#e8edf8" stroke-width="1.2"/><circle cx="32" cy="26" r="10" fill="#16243d" stroke="#3a5378"/><circle cx="32" cy="26" r="2" fill="#e8edf8"/><rect x="9" y="9" width="14" height="4" rx="1" fill="#e8edf8"/></svg>',
    laptop: '<svg viewBox="0 0 56 48" fill="none"><rect x="4" y="6" width="48" height="28" rx="1.5" fill="#16243d" stroke="#1d3a5f" stroke-width="1.2"/><rect x="6" y="8" width="44" height="24" fill="#0d1828" stroke="#5ab0ff" stroke-width=".3"/><line x1="14" y1="42" x2="42" y2="42" stroke="#1d3a5f" stroke-linecap="round" stroke-width="2.5"/></svg>',
    regie_foh: '<svg viewBox="0 0 56 56" fill="none"><path d="M4 26 L28 6 L52 26 L52 50 L4 50 Z" fill="#ff6b1a" stroke="#1d3a5f" stroke-width="1.4"/><rect x="20" y="32" width="16" height="18" rx="1" fill="#fff" stroke="#1d3a5f"/><rect x="8" y="30" width="8" height="10" rx=".5" fill="#fff" stroke="#1d3a5f" stroke-width=".5"/><rect x="40" y="30" width="8" height="10" rx=".5" fill="#fff" stroke="#1d3a5f" stroke-width=".5"/><text x="28" y="45" text-anchor="middle" font-family="Outfit" font-size="5.5" font-weight="700" fill="#1d3a5f">FOH</text></svg>',
    regie_mon: '<svg viewBox="0 0 56 56" fill="none"><path d="M4 26 L28 6 L52 26 L52 50 L4 50 Z" fill="#f5c542" stroke="#1d3a5f" stroke-width="1.4"/><rect x="20" y="32" width="16" height="18" rx="1" fill="#fff" stroke="#1d3a5f"/><rect x="8" y="30" width="8" height="10" rx=".5" fill="#fff" stroke="#1d3a5f" stroke-width=".5"/><rect x="40" y="30" width="8" height="10" rx=".5" fill="#fff" stroke="#1d3a5f" stroke-width=".5"/><text x="28" y="45" text-anchor="middle" font-family="Outfit" font-size="5.5" font-weight="700" fill="#1d3a5f">MON</text></svg>',
    rack: '<svg viewBox="0 0 64 48" fill="none"><rect x="4" y="4" width="56" height="42" rx="2" fill="#0d1828" stroke="#5a6580" stroke-width="1"/><rect x="4" y="44" width="56" height="2" fill="#5a6580"/><rect x="8" y="7" width="48" height="6" rx=".5" fill="#16243d" stroke="#3a5378" stroke-width=".3"/><rect x="8" y="15" width="48" height="6" rx=".5" fill="#16243d" stroke="#3a5378" stroke-width=".3"/><rect x="8" y="23" width="48" height="6" rx=".5" fill="#16243d" stroke="#3a5378" stroke-width=".3"/><rect x="8" y="31" width="48" height="6" rx=".5" fill="#16243d" stroke="#3a5378" stroke-width=".3"/><circle cx="14" cy="10" r=".8" fill="#ff6b1a"/><circle cx="14" cy="26" r=".8" fill="#ff6b1a"/></svg>',
    stagebox: '<svg viewBox="0 0 64 36" fill="none"><rect x="3" y="6" width="58" height="24" rx="2" fill="#5a6580" stroke="#1d3a5f" stroke-width="1"/><g fill="#16243d" stroke="#fff" stroke-width=".3"><circle cx="10" cy="14" r="2"/><circle cx="16" cy="14" r="2"/><circle cx="22" cy="14" r="2"/><circle cx="28" cy="14" r="2"/><circle cx="34" cy="14" r="2"/><circle cx="40" cy="14" r="2"/><circle cx="46" cy="14" r="2"/><circle cx="52" cy="14" r="2"/></g><g fill="#ff6b1a"><rect x="10" y="22" width="3" height="5" rx=".5"/><rect x="16" y="22" width="3" height="5" rx=".5"/><rect x="22" y="22" width="3" height="5" rx=".5"/><rect x="28" y="22" width="3" height="5" rx=".5"/></g></svg>',
    splitter: '<svg viewBox="0 0 64 48" fill="none" stroke="#1d3a5f" stroke-width="1.5"><circle cx="14" cy="24" r="5" fill="#5a6580"/><circle cx="50" cy="10" r="4" fill="#5a6580"/><circle cx="50" cy="24" r="4" fill="#5a6580"/><circle cx="50" cy="38" r="4" fill="#5a6580"/><line x1="19" y1="24" x2="46" y2="10"/><line x1="19" y1="24" x2="46" y2="24"/><line x1="19" y1="24" x2="46" y2="38"/></svg>',
    distrib: '<svg viewBox="0 0 56 56" fill="none"><rect x="6" y="6" width="44" height="44" rx="3" fill="#ff4d6a" stroke="#1d3a5f" stroke-width="1.4"/><path d="M22 14 L30 14 L26 26 L34 26 L22 44 L26 32 L18 32 Z" fill="#fff" stroke="#1d3a5f" stroke-width=".4" stroke-linejoin="round"/></svg>',
    zone_lbl: '<svg viewBox="0 0 56 36" fill="none"><path d="M6 8 L40 8 L50 18 L40 28 L6 28 Z" fill="#3d4a62" stroke="#1d3a5f" stroke-width="1.2"/><circle cx="42" cy="18" r="2" fill="#fff"/></svg>',
    text_lbl: '<svg viewBox="0 0 56 40" fill="none"><rect x="4" y="6" width="48" height="28" rx="3" fill="#aabbdd" stroke="#1d3a5f" stroke-width="1.2"/><text x="28" y="26" text-anchor="middle" font-family="Outfit" font-size="16" font-weight="700" fill="#1d3a5f">T</text></svg>',
  };

  const PALETTE = [
    { cat:'Son',      color:'#1a8fff', items:[
      { type:'main_array', label:'Line Array',    icon:SITE_ICONS.main_array, color:'#1a8fff' },
      { type:'sub',        label:'Sub',           icon:SITE_ICONS.sub,         color:'#ff6b1a' },
      { type:'frontfill',  label:'Front fill',    icon:SITE_ICONS.frontfill,   color:'#5ab0ff' },
      { type:'delay',      label:'Delay / Tour',  icon:SITE_ICONS.delay,       color:'#9b6aff' },
      { type:'wedge',      label:'Retour scene',  icon:SITE_ICONS.wedge,       color:'#f5c542' },
      { type:'iem_tx',     label:'IEM Emetteur',  icon:SITE_ICONS.iem_tx,      color:'#c4a0ff' },
    ]},
    { cat:'Amplis',   color:'#22d6a0', items:[
      { type:'linus14',  label:'LINUS 14',  icon:SITE_ICONS.linus14,  color:'#22d6a0' },
      { type:'linus12',  label:'LINUS 12',  icon:SITE_ICONS.linus12,  color:'#22d6a0' },
      { type:'linus14d', label:'LINUS 14D', icon:SITE_ICONS.linus14d, color:'#22d6a0' },
      { type:'linus12c', label:'LINUS 12C', icon:SITE_ICONS.linus12c, color:'#1affd5' },
      { type:'linus10',  label:'LINUS 10',  icon:SITE_ICONS.linus10,  color:'#22d6a0' },
      { type:'linuscon', label:'LINUS CON', icon:SITE_ICONS.linuscon, color:'#5ab0ff' },
    ]},
    { cat:'Reseau',   color:'#9b6aff', items:[
      { type:'lmx14r',   label:'Luminex 14R',   icon:SITE_ICONS.lmx14r,   color:'#9b6aff' },
      { type:'lmx10p',   label:'Luminex 10PoE', icon:SITE_ICONS.lmx10p,   color:'#9b6aff' },
      { type:'lmx25g',   label:'Luminex 25G',   icon:SITE_ICONS.lmx25g,   color:'#b48aff' },
      { type:'sw_dante', label:'Switch Dante',  icon:SITE_ICONS.sw_dante, color:'#5ab0ff' },
      { type:'wifi_ap',  label:'Access Point',  icon:SITE_ICONS.wifi_ap,  color:'#5ab0ff' },
    ]},
    { cat:'Controle', color:'#f5c542', items:[
      { type:'console_foh', label:'Console FOH', icon:SITE_ICONS.console_foh, color:'#1a8fff' },
      { type:'console_mon', label:'Console MON', icon:SITE_ICONS.console_mon, color:'#f5c542' },
      { type:'processor',   label:'Processeur',  icon:SITE_ICONS.processor,   color:'#22d6a0' },
      { type:'cdj',         label:'Playback CDJ',icon:SITE_ICONS.cdj,         color:'#e8edf8' },
      { type:'laptop',      label:'Ordinateur',  icon:SITE_ICONS.laptop,      color:'#e8edf8' },
    ]},
    { cat:'Infra',    color:'#5a6580', items:[
      { type:'regie_foh', label:'Regie FOH',       icon:SITE_ICONS.regie_foh, color:'#ff6b1a' },
      { type:'regie_mon', label:'Regie MON',       icon:SITE_ICONS.regie_mon, color:'#f5c542' },
      { type:'rack',      label:'Rack 19"',        icon:SITE_ICONS.rack,      color:'#5a6580' },
      { type:'stagebox',  label:'Stage Box',       icon:SITE_ICONS.stagebox,  color:'#5a6580' },
      { type:'splitter',  label:'Splitter',        icon:SITE_ICONS.splitter,  color:'#5a6580' },
      { type:'distrib',   label:'Distrib. secteur',icon:SITE_ICONS.distrib,   color:'#ff4d6a' },
      { type:'zone_lbl',  label:'Zone / Label',    icon:SITE_ICONS.zone_lbl,  color:'#3d4a62' },
    ]},
    { cat:'Texte',     color:'#aabbdd', items:[
      { type:'text_lbl',    label:'Texte libre', icon:SITE_ICONS.text_lbl, color:'#aabbdd' },
      { type:'image_frame', label:'Image / Photo', icon:'<svg viewBox="0 0 56 48" fill="none"><rect x="4" y="4" width="48" height="40" rx="5" fill="#1a2840" stroke="#3a5378" stroke-width="1.2"/><path d="M4 32 L16 20 L26 28 L34 18 L52 36 L52 44 L4 44 Z" fill="#2c4060"/><circle cx="40" cy="16" r="6" fill="#f5c542" opacity=".8"/></svg>', color:'#ec4899' },
    ]},
  ];

  let CABLE_TYPES = [
    { id:'speakon', label:'Speakon',          color:'#ff6b1a', dash:'',          builtin:true },
    { id:'xlr',     label:'XLR / Multipaire', color:'#f5c542', dash:'',          builtin:true },
    { id:'rj45',    label:'RJ45',             color:'#44bbff', dash:'4 2',        builtin:true },
    { id:'dante',   label:'Ethernet Dante',   color:'#1a8fff', dash:'7 3',        builtin:true },
    { id:'luminex', label:'Reseau Luminex',   color:'#9b6aff', dash:'7 3',        builtin:true },
    { id:'fiber',   label:'Fibre optique',    color:'#22d6a0', dash:'3 3',        builtin:true },
    { id:'100v',    label:'Ligne 100V',        color:'#ffaa1a', dash:'6 2 2 2',   builtin:true },
    { id:'power',   label:'Secteur',          color:'#ff4d6a', dash:'',           builtin:true },
    { id:'multi',   label:'Multi-paire',      color:'#5ab0ff', dash:'5 2',        builtin:true },
  ];

  const CUSTOM_CABLES_KEY  = 'siteplan_custom_cables';
  const CUSTOM_ITEMS_KEY   = 'siteplan_custom_items';

  function _getCustomSiteItems()  { try { return JSON.parse(localStorage.getItem(CUSTOM_ITEMS_KEY)||'[]'); } catch(e2){ return []; } }
  function _saveCustomSiteItem(it){ var list=_getCustomSiteItems().filter(function(x){return x.type!==it.type;}); list.push(it); localStorage.setItem(CUSTOM_ITEMS_KEY,JSON.stringify(list)); _invalidateSiteIconImgs(); }
  function _removeCustomSiteItem(type){ localStorage.setItem(CUSTOM_ITEMS_KEY,JSON.stringify(_getCustomSiteItems().filter(function(x){return x.type!==type;}))); _invalidateSiteIconImgs(); }

  function _loadCustomCableTypes() {
    try {
      const raw = localStorage.getItem(CUSTOM_CABLES_KEY);
      if(!raw) return;
      const customs = JSON.parse(raw);
      customs.forEach(function(c) {
        if(c.id && c.label && !CABLE_TYPES.find(function(t){return t.id===c.id;}))
          CABLE_TYPES.push({id:c.id, label:c.label, color:c.color||'#ffffff', dash:c.dash||'', builtin:false});
      });
    } catch(e) {}
  }

  function _saveCustomCableTypes() {
    try {
      const customs = CABLE_TYPES.filter(function(t){return !t.builtin;});
      localStorage.setItem(CUSTOM_CABLES_KEY, JSON.stringify(customs));
    } catch(e) {}
  }

  function deleteCustomCableType(id) {
    if(CABLE_TYPES.find(function(t){return t.id===id&&t.builtin;})) return;
    CABLE_TYPES = CABLE_TYPES.filter(function(t){return t.id!==id;});
    _saveCustomCableTypes();
    if(state.activeCableType===id) state.activeCableType='xlr';
    renderCablePicker();
  }

  /* Surcharges (label/couleur/trait) des liaisons — y compris les types
     intégrés (qui ne sont pas dans CUSTOM_CABLES_KEY). Persistées et
     ré-appliquées au chargement. */
  const CABLE_OVERRIDES_KEY = 'siteplan_cable_overrides';
  function _loadCableOverrides(){ try{ return JSON.parse(localStorage.getItem(CABLE_OVERRIDES_KEY)||'{}')||{}; }catch(e){ return {}; } }
  function _saveCableOverride(id,patch){ try{ var o=_loadCableOverrides(); o[id]=Object.assign({},o[id],patch); localStorage.setItem(CABLE_OVERRIDES_KEY,JSON.stringify(o)); }catch(e){} }
  function _applyCableOverrides(){
    var o=_loadCableOverrides();
    CABLE_TYPES.forEach(function(t){
      var ov=o[t.id]; if(!ov) return;
      if(ov.label!=null) t.label=ov.label;
      if(ov.color!=null) t.color=ov.color;
      if(ov.dash!=null)  t.dash=ov.dash;
    });
  }
  /* Renommer / recolorier une liaison (intégrée ou personnalisée). */
  function updateCableType(id, patch){
    var c=CABLE_TYPES.find(function(t){return t.id===id;}); if(!c) return;
    if(patch.label!=null) c.label=patch.label;
    if(patch.color!=null) c.color=patch.color;
    if(patch.dash!=null)  c.dash=patch.dash;
    if(c.builtin) _saveCableOverride(id,{label:c.label,color:c.color,dash:c.dash});
    else _saveCustomCableTypes();
    renderCablePicker(); renderCables(); renderLegend();
  }

  let state = { elements:[], cables:[], bgImage:null, bgOpacity:100, view:{panX:60,panY:60,zoom:1}, selected:null, linkFrom:null, freePt1:null, activeCableType:'xlr', textScale:1, legendScale:1, cableTextScale:1, cableMode:false };
  let dragging=null, panning=null, inited=false, resizing=null, _wpDrag=null, _wpAddCid=null;

  const $  = id => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2,9);
  const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const findItem = type => { for(const g of PALETTE){const it=g.items.find(i=>i.type===type);if(it)return it;} const ci=_getCustomSiteItems().find(i=>i.type===type); if(ci)return ci; return {icon:SITE_ICONS.stagebox,label:type,color:'#5a6580'}; };
  const ct = id => CABLE_TYPES.find(c=>c.id===id)||CABLE_TYPES[0];

  function init() {
    if(inited) return;
    inited = true;
    _loadCustomCableTypes();
    _applyCableOverrides();
    renderPalette();
    renderCablePicker();
    bindEvents();
    applyTransform();
    render();
  }

  function renderPalette() {
    const el = $('site-pal-items');
    if(!el) return;
    const customAll = _getCustomSiteItems();
    el.innerHTML = PALETTE.map((g, gi) => {
      const customInCat = customAll.filter(function(it){ return it.cat === g.cat; });
      const allItems = g.items.concat(customInCat);
      const catColor = g.color || '#5a6580';
      return '<div class="spl-cat-sec">'
        + '<div class="spl-cat-lbl" data-cat="' + gi + '">'
        + '<span>' + g.cat + '</span>'
        + '<i class="ti ti-chevron-right spl-cat-arrow"></i>'
        + '</div>'
        + '<div class="spl-cat-items" data-cat="' + gi + '" style="display:none">'
        + allItems.map(function(it) {
            var isCustom = !!it.isCustom;
            var del = isCustom
              ? '<button type="button" class="spl-custom-del" data-ctype="' + it.type + '" title="Supprimer" style="margin-left:auto;border:none;background:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0 2px;flex-shrink:0;line-height:1">x</button>'
              : '';
            var isSvg = typeof it.icon === 'string' && it.icon.charAt(0) === '<';
            var iconHtml = isSvg
              ? '<span class="spl-item-ic" style="border-color:' + it.color + '55">' + it.icon + '</span>'
              : '<span class="spl-item-ic-emoji" style="background:' + it.color + '18;border-color:' + it.color + '44;color:' + it.color + '">' + it.icon + '</span>';
            return '<button class="spl-item' + (isCustom ? ' spl-custom-item' : '') + '" draggable="true" data-type="' + it.type + '" style="--ic:' + it.color + '">'
              + iconHtml
              + '<span style="flex:1;text-align:left">' + esc(it.label) + '</span>'
              + del
              + '</button>';
          }).join('')
        // Creation form
        + '<div class="spl-custom-form" data-cat="' + gi + '" data-catname="' + g.cat + '" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)">'
        + '<div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;font-family:var(--m)">Ajouter un objet</div>'
        + '<div style="display:flex;gap:3px;margin-bottom:4px">'
        + '<input class="spl-ci-icon syn-custom-inp" placeholder="&#x1F4E6;" style="width:34px;text-align:center;font-size:14px;padding:3px" maxlength="2"/>'
        + '<input class="spl-ci-label syn-custom-inp" placeholder="Nom..." style="flex:1"/>'
        + '<input type="color" class="spl-ci-color" value="' + catColor + '" style="width:26px;height:26px;border:none;border-radius:4px;padding:1px;cursor:pointer;background:none;flex-shrink:0"/>'
        + '</div>'
        + '<button type="button" class="spl-ci-add syn-custom-btn" style="width:100%">+ Ajouter et enregistrer</button>'
        + '</div>'
        + '</div></div>';
    }).join('');

    el.querySelectorAll('.spl-cat-lbl').forEach(function(hd) {
      hd.addEventListener('click', function() {
        var cat = hd.dataset.cat;
        var items = el.querySelector('.spl-cat-items[data-cat="' + cat + '"]');
        var arrow = hd.querySelector('.spl-cat-arrow');
        var isOpen = items.style.display !== 'none';
        items.style.display = isOpen ? 'none' : '';
        arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
      });
    });

    el.querySelectorAll('.spl-item').forEach(function(btn) {
      btn.addEventListener('dragstart', function(e) { e.dataTransfer.setData('spl-type', btn.dataset.type); });
      btn.addEventListener('click', function(ev) {
        if(ev.target.closest('.spl-custom-del')) return;
        var vp = $('site-viewport');
        if(!vp) return;
        var r = vp.getBoundingClientRect();
        addElement(btn.dataset.type, (r.width/2 - state.view.panX)/state.view.zoom, (r.height/2 - state.view.panY)/state.view.zoom);
      });
    });

    // Delete custom items
    el.querySelectorAll('.spl-custom-del').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        _removeCustomSiteItem(btn.dataset.ctype);
        renderPalette();
      });
    });

    // Add custom item
    el.querySelectorAll('.spl-ci-add').forEach(function(addBtn) {
      addBtn.addEventListener('click', function() {
        var form = addBtn.closest('.spl-custom-form');
        var label = (form.querySelector('.spl-ci-label')?.value || '').trim();
        if(!label){ toast('Donnez un nom'); return; }
        var icon  = (form.querySelector('.spl-ci-icon')?.value  || '').trim() || '📦';
        var color = form.querySelector('.spl-ci-color')?.value || '#5a6580';
        var catName = form.dataset.catname || 'Custom';
        var t = 'csi_' + Date.now().toString(36);
        _saveCustomSiteItem({ type:t, label:label, icon:icon, color:color, cat:catName, isCustom:true });
        renderPalette();
        toast('"' + label + '" enregistre');
      });
    });
  }

  function applyTransform() {
    const t = `translate(${state.view.panX}px,${state.view.panY}px) scale(${state.view.zoom})`;
    const nn = $('site-nodes'), cc = $('site-cables'), bg = $('site-bg-img');
    if(nn){ nn.style.transform = t; nn.style.setProperty('--spl-ts', state.textScale); }
    if(cc) cc.style.transform = t;
    if(bg) bg.style.transform = t;
    const lbl = $('site-zoom-lbl');
    if(lbl) lbl.textContent = Math.round(state.view.zoom*100)+'%';
    const sl  = $('site-zoom-slider');
    if(sl) sl.value = Math.min(300, Math.max(20, Math.round(state.view.zoom*100)));
  }

  function clientToWorld(cx,cy) {
    const vp = $('site-viewport');
    if(!vp) return {x:0,y:0};
    const r = vp.getBoundingClientRect();
    return { x:(cx-r.left-state.view.panX)/state.view.zoom, y:(cy-r.top-state.view.panY)/state.view.zoom };
  }

  function render() { renderNodes(); renderCables(); renderInspector(); renderLegend(); }

  function renderCablePicker() {
    const el = $('site-cable-picker');
    if(!el) return;
    const c = ct(state.activeCableType);
    const _hc = _safeColor(c.color)||'#888';
    const hdDot = c.dash
      ? `background:repeating-linear-gradient(90deg,${_hc} 0,${_hc} 7px,transparent 7px,transparent 10px);`
      : `background:${_hc};`;
    const items = CABLE_TYPES.map(ct2 => {
      const _c2 = _safeColor(ct2.color)||'#888';
      const ds = ct2.dash
        ? `background:repeating-linear-gradient(90deg,${_c2} 0,${_c2} 7px,transparent 7px,transparent 10px);`
        : `background:${_c2};`;
      const isCur = ct2.id === state.activeCableType;
      const _isPro = (typeof userPlan==='function') && userPlan()==='pro';
      const editBtn = _isPro ?
        `<button class="spl-cable-del" data-edit="${ct2.id}" title="Renommer / couleur" onclick="event.stopPropagation();editCableType('${ct2.id}')" style="opacity:.6"><i class="ti ti-pencil" style="font-size:10px"></i></button>` : '';
      const delBtn = ct2.builtin ? '' :
        `<button class="spl-cable-del" data-del="${ct2.id}" title="Supprimer" onclick="event.stopPropagation();SitePlan.deleteCustomCableType('${ct2.id}')">✕</button>`;
      return `<div style="display:flex;align-items:center;gap:2px">` +
        `<button class="spl-cable-btn${isCur?' active':''}" style="--c:${_c2};flex:1" onclick="SitePlan.setActiveCableType('${ct2.id}')">` +
        `<div class="spl-cable-dot-sm" style="${ds}"></div>${esc(ct2.label)}</button>${editBtn}${delBtn}</div>`;
    }).join('');
    const addBtn =
      `<button class="spl-cable-btn" style="color:var(--ora);font-weight:600;margin-top:3px;border:1px dashed var(--bdr2)" onclick="openCableTypeModal()">` +
      `<i class="ti ti-plus" style="font-size:11px"></i>Nouveau type…</button>`;
    el.innerHTML =
      // Header row: active type + toggle list + ⚡ mode button
      `<div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">` +
      `<button class="spl-cable-btn" id="spl-cpick-hd" style="--c:${c.color};flex:1;background:var(--surf2);border-color:var(--bdr2)" ` +
        `onclick="var l=document.getElementById('spl-cpick-list');l.style.display=l.style.display==='none'?'':'none'">` +
        `<div class="spl-cable-dot-sm" style="${hdDot}"></div>` +
        `<span style="flex:1">${esc(c.label)}</span>` +
        `<span style="opacity:.4;font-size:9px">▾</span></button>` +
      `<button class="spl-cable-btn${state.cableMode?' active':''}" style="--c:${c.color};padding:5px 9px;flex-shrink:0" ` +
        `onclick="SitePlan.toggleCableMode()" title="${state.cableMode?'Desactiver connexion':'Mode connexion'}">⚡</button>` +
      `</div>` +
      // Expandable list (closed by default, re-opened if was open before)
      `<div id="spl-cpick-list" style="display:none">${items}${addBtn}</div>`;
    // Re-open if list was already open (preserve state across re-renders)
    if(el._listOpen) { const l=$('spl-cpick-list'); if(l) l.style.display=''; }
    // Track open state
    const hd = $('spl-cpick-hd');
    if(hd) hd.addEventListener('click', ()=>{ const l=$('spl-cpick-list'); if(l) el._listOpen = l.style.display!=='none'; });
    // Close list after selection (not after delete or add button)
    el.querySelectorAll('#spl-cpick-list .spl-cable-btn:not([onclick*="openCableTypeModal"])').forEach(btn => {
      btn.addEventListener('click', ()=>{ el._listOpen=false; });
    });
  }

  function renderLegend() {
    const leg = $('site-cable-legend');
    if(!leg) return;
    const usedIds = [...new Set(state.cables.map(c=>c.type))];
    if(usedIds.length===0){ leg.style.display='none'; return; }
    leg.style.display='';
    const rows = usedIds.map(id=>{
      const c = CABLE_TYPES.find(t=>t.id===id)||CABLE_TYPES[0];
      const _col = _safeColor(c.color) || '#888';
      const bg = c.dash
        ? `repeating-linear-gradient(90deg,${_col} 0,${_col} 7px,transparent 7px,transparent 10px)`
        : _col;
      const bgStyle = c.dash ? `background:${bg};` : `background:${_col};`;
      return `<div class="scl-row"><div class="scl-line" style="${bgStyle}"></div><span>${esc(c.label)}</span></div>`;
    }).join('');
    const ls = state.legendScale || 1;
    leg.style.setProperty('--leg-ts', ls);
    leg.innerHTML = '<div class="scl-title">Cables</div>' + rows;
  }

  function renderNodes() {
    const host = $('site-nodes');
    if(!host) return;
    // Remove stale
    host.querySelectorAll('.spl-node').forEach(div => {
      if(!state.elements.find(e=>e.id===div.dataset.id)) div.remove();
    });
    state.elements.forEach(el => {
      let div = host.querySelector(`.spl-node[data-id="${el.id}"]`);
      if(!div){ div=document.createElement('div'); div.className='spl-node'; div.dataset.id=el.id; host.appendChild(div); }
      const it = findItem(el.type);
      const isSel = state.selected?.kind==='el' && state.selected.id===el.id;
      const isLink = state.linkFrom===el.id;
      const isCard = el.type!=='text_lbl' && el.type!=='image_frame';
      div.className = `spl-node${isCard?' spl-card':''}${el.noBg?' no-bg':''}${el.type==='image_frame'?' spl-img':''}${isSel?' sel':''}${isLink?' link-src':''}`;
      div.style.left = el.x+'px'; div.style.top = el.y+'px';
      div.style.setProperty('--el-ts', el.elTextScale || 1);
      if(el.type==='text_lbl'){
        const fs = el.elSize || 18;
        div.innerHTML =
          `<button class="spl-del" data-del="${el.id}">×</button>`+
          `<div class="spl-text-node" style="font-size:calc(${fs}px * var(--spl-ts,1) * var(--el-ts,1));color:${el.textColor||'#1d3a5f'}">${esc(el.label)}</div>`+
          `<button class="spl-conn" data-conn="${el.id}" title="Connecter"><i class="ti ti-bolt" style="font-size:11px"></i></button>`;
      } else {
        const sz = el.elSize || 72;
        const isSvg = typeof it.icon === 'string' && it.icon.charAt(0) === '<';
        const iconSz = Math.round(sz * 0.44);
        if(el.type === 'image_frame'){
          /* Image flottante libre — au RATIO de l'image (pas de carré blanc). */
          const asp = el.imgAspect || 1;
          const ifW = (el.imgPx || sz);
          const ifH = Math.max(1, Math.round(ifW / asp));
          /* Backfill du ratio pour les images existantes (une seule fois). */
          if(el.iconImg && !el.imgAspect && !el._aspChk){
            el._aspChk=true;
            const _im=new Image();
            _im.onload=function(){ if(_im.naturalHeight){ el.imgAspect=_im.naturalWidth/_im.naturalHeight; renderNodes(); } };
            _im.src=el.iconImg;
          }
          /* Poignées de coin (visibles à la sélection) pour redimensionner. */
          const HS=7;
          const handles = (isSel && el.iconImg)
            ? `<div class="spl-rsz spl-rsz-nw" data-id="${el.id}" data-corner="nw" style="left:${-HS}px;top:${-HS}px"></div>`+
              `<div class="spl-rsz spl-rsz-ne" data-id="${el.id}" data-corner="ne" style="left:${ifW-HS}px;top:${-HS}px"></div>`+
              `<div class="spl-rsz spl-rsz-sw" data-id="${el.id}" data-corner="sw" style="left:${-HS}px;top:${ifH-HS}px"></div>`+
              `<div class="spl-rsz spl-rsz-se" data-id="${el.id}" data-corner="se" style="left:${ifW-HS}px;top:${ifH-HS}px"></div>`
            : '';
          div.innerHTML = el.iconImg
            ? `<button class="spl-del" data-del="${el.id}">×</button>`+
              `<img src="${_safeImgSrc(el.iconImg)}" style="width:${ifW}px;height:${ifH}px;object-fit:fill;border-radius:6px;display:block;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.2)"/>`+
              (el.label?`<div class="spl-lbl">${esc(el.label)}</div>`:'')+
              handles+
              `<button class="spl-conn" data-conn="${el.id}" title="Connecter"><i class="ti ti-bolt" style="font-size:11px"></i></button>`
            : `<button class="spl-del" data-del="${el.id}">×</button>`+
              `<div style="width:${ifW}px;height:${ifW}px;border:2px dashed var(--bdr2);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;cursor:pointer" onclick="SitePlan.uploadElementIcon('${el.id}')">`+
              `<i class="ti ti-photo" style="font-size:28px;color:var(--muted)"></i><span style="font-size:10px;color:var(--muted);font-family:var(--m)">Ajouter une image</span></div>`+
              `<button class="spl-conn" data-conn="${el.id}" title="Connecter"><i class="ti ti-bolt" style="font-size:11px"></i></button>`;
        } else {
        const iconMarkup = el.iconImg
          ? `<img src="${_safeImgSrc(el.iconImg)}" style="width:${sz-6}px;height:${sz-6}px;object-fit:contain;pointer-events:none;border-radius:4px"/>`
          : isSvg
            ? it.icon
            : `<div class="spl-body-emoji" style="font-size:${iconSz}px;color:${it.color}">${it.icon}</div>`;
        div.innerHTML =
          `<button class="spl-del" data-del="${el.id}">×</button>`+
          `<div class="spl-body" style="border-color:${it.color};width:${sz}px;height:${sz}px">${iconMarkup}</div>`+
          `<div class="spl-lbl">${esc(el.label)}</div>`+
          (el.note?`<div class="spl-note">${esc(el.note)}</div>`:'')+
          `<button class="spl-conn" data-conn="${el.id}" title="Connecter"><i class="ti ti-bolt" style="font-size:11px"></i></button>`;
        }
      }
    });
  }

  // ── Shared cable geometry (used by renderCables and exportPng) ──
  function _buildPairMap() {
    const m={};
    state.cables.forEach(c=>{
      const k=c.fromPt ? c.id : [c.fromId,c.toId].sort().join('|');
      if(!m[k])m[k]=[];
      m[k].push(c.id);
    });
    return m;
  }

  /* Point au milieu (par longueur) d'une polyligne. */
  function _polyMid(pts){
    let total=0; const segs=[];
    for(let i=0;i<pts.length-1;i++){ const d=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y); segs.push(d); total+=d; }
    let half=total/2;
    for(let i=0;i<segs.length;i++){
      if(half<=segs[i]||i===segs.length-1){ const t=segs[i]?half/segs[i]:0; return {x:pts[i].x+(pts[i+1].x-pts[i].x)*t, y:pts[i].y+(pts[i+1].y-pts[i].y)*t}; }
      half-=segs[i];
    }
    return pts[0];
  }
  /* Distance d'un point au segment [a,b]. */
  function _distToSeg(p,a,b){
    const vx=b.x-a.x, vy=b.y-a.y, wx2=p.x-a.x, wy2=p.y-a.y;
    const c1=vx*wx2+vy*wy2; if(c1<=0) return Math.hypot(p.x-a.x,p.y-a.y);
    const c2=vx*vx+vy*vy; if(c2<=c1) return Math.hypot(p.x-b.x,p.y-b.y);
    const t=c1/c2; return Math.hypot(p.x-(a.x+t*vx), p.y-(a.y+t*vy));
  }
  /* Insère un point de routage au bon endroit (segment le plus proche). */
  function _addWaypointAt(cable, p){
    const g=_cableGeom(cable,_buildPairMap(),state.view.zoom||1);
    if(!g) return;
    const pts=g.pts; let best=0,bd=Infinity;
    for(let i=0;i<pts.length-1;i++){ const d=_distToSeg(p,pts[i],pts[i+1]); if(d<bd){bd=d;best=i;} }
    if(!cable.waypoints) cable.waypoints=[];
    cable.waypoints.splice(best,0,{x:Math.round(p.x),y:Math.round(p.y)});
  }
  /* Active/désactive le mode « placer un point ». cid=null pour désactiver. */
  function _setWpAddMode(cid){
    _wpAddCid=cid;
    const vp=$('site-viewport'); if(vp) vp.style.cursor=cid?'crosshair':'';
    const wrap=$('site-canvas-wrap'); if(wrap) wrap.classList.toggle('sp-wp-add', !!cid);
    if(cid && typeof toast!=='undefined') toast('Cliquez sur le plan pour placer le point');
  }

  // Returns endpoints + {pts, pathFwd, pathBack, nx,ny (end dir), bnx,bny (start dir)}
  // Avec waypoints : polyligne. Sinon : courbe bézier (comportement d'origine).
  function _cableGeom(cable, pairMap, zoom) {
    let fcx, fcy, tcx, tcy, fR, tR;
    if(cable.fromPt) {
      // Free cable: absolute coordinates
      fcx=cable.fromPt.x; fcy=cable.fromPt.y;
      tcx=cable.toPt.x;   tcy=cable.toPt.y;
      fR=0; tR=0;
    } else {
      const f=state.elements.find(e=>e.id===cable.fromId);
      const t2=state.elements.find(e=>e.id===cable.toId);
      if(!f||!t2) return null;
      const fhalf = f.type==='text_lbl' ? 20 : (f.elSize||72)/2;
      const thalf = t2.type==='text_lbl' ? 20 : (t2.elSize||72)/2;
      fcx=f.x+fhalf; fcy=f.y+fhalf;
      tcx=t2.x+thalf; tcy=t2.y+thalf;
      fR=fhalf+4; tR=thalf+4;
    }
    const wps=(cable.waypoints&&cable.waypoints.length)?cable.waypoints:null;
    if(wps){
      const first=wps[0], last=wps[wps.length-1];
      let sdx=first.x-fcx, sdy=first.y-fcy; const sd=Math.hypot(sdx,sdy)||1; const snx=sdx/sd, sny=sdy/sd;
      let edx=tcx-last.x, edy=tcy-last.y; const ed=Math.hypot(edx,edy)||1; const enx=edx/ed, eny=edy/ed;
      const afx=fcx+snx*fR, afy=fcy+sny*fR;
      const atx=tcx-enx*tR, aty=tcy-eny*tR;
      const pts=[{x:afx,y:afy}].concat(wps.map(function(p){return {x:p.x,y:p.y};})).concat([{x:atx,y:aty}]);
      const mid=_polyMid(pts);
      const d='M'+pts.map(function(p){return p.x+','+p.y;}).join(' L');
      return {
        afx,afy,atx,aty,myo:mid.y,mxo:mid.x,nx:enx,ny:eny,bnx:snx,bny:sny,pts,
        pathFwd:d,
        pathBack:'M'+pts.slice().reverse().map(function(p){return p.x+','+p.y;}).join(' L'),
      };
    }
    const ddx=tcx-fcx, ddy=tcy-fcy;
    const dist=Math.sqrt(ddx*ddx+ddy*ddy)||1;
    const nx=ddx/dist, ny=ddy/dist;
    const sx=fcx+nx*fR, sy=fcy+ny*fR;
    const ex=tcx-nx*tR, ey=tcy-ny*tR;
    const key=cable.fromPt ? cable.id : [cable.fromId,cable.toId].sort().join('|');
    const siblings=pairMap[key]||[cable.id];
    const idx=siblings.indexOf(cable.id);
    const n=siblings.length;
    const STEP=24/zoom;
    const off=(idx-(n-1)/2)*STEP;
    const px=-ny*off, py=nx*off;
    const afx=sx+px, afy=sy+py, atx=ex+px, aty=ey+py;
    const myo=(afy+aty)/2, mxo=(afx+atx)/2;
    return {
      afx,afy,atx,aty,myo,mxo,nx,ny,bnx:nx,bny:ny,
      pts:[{x:afx,y:afy},{x:atx,y:aty}],
      pathFwd:`M${afx},${afy} C${afx},${myo} ${atx},${myo} ${atx},${aty}`,
      pathBack:`M${atx},${aty} C${atx},${myo} ${afx},${myo} ${afx},${afy}`,
    };
  }

  function renderCables() {
    const svg = $('site-cables');
    if(!svg) return;
    const pairMap = _buildPairMap();
    const ARR_H=16, ARR_W=9;
    // tip at (tx,ty), arrow points in direction (dx,dy) — returns polygon points string
    const arrPoly = (tx,ty,dx,dy) => {
      const bx=tx-dx*ARR_H, by=ty-dy*ARR_H;
      return `${tx},${ty} ${bx-dy*ARR_W},${by+dx*ARR_W} ${bx+dy*ARR_W},${by-dx*ARR_W}`;
    };
    let paths = '';
    state.cables.forEach(cable => {
      const g = _cableGeom(cable, pairMap, state.view.zoom);
      if(!g) return;
      const {afx,afy,atx,aty,myo,mxo,nx,ny,bnx,bny,pathFwd} = g;
      const c = ct(cable.type);
      const isSel = state.selected?.kind==='cable' && state.selected.id===cable.id;
      const w = cable.width ?? 4;
      const dash = c.dash ? `stroke-dasharray="${c.dash}"` : '';
      const dir = cable.direction ?? 'forward';
      const op = isSel ? 1 : 0.85;
      const sw = isSel ? w+2 : w;
      paths += `<path class="sp-cable-hit" d="${pathFwd}" stroke="transparent" stroke-width="${w+12}" fill="none" data-cid="${cable.id}" style="pointer-events:stroke;cursor:pointer"/>`;
      paths += `<path class="spl-cable${isSel?' sel':''}" d="${pathFwd}" stroke="${c.color}" stroke-width="${sw}" fill="none" stroke-linejoin="round" stroke-linecap="round" ${dash} opacity="${op}"/>`;
      if(dir==='forward'||dir==='both')  paths += `<polygon points="${arrPoly(atx,aty,nx,ny)}"   fill="${c.color}" opacity="${op}"/>`;
      if(dir==='backward'||dir==='both') paths += `<polygon points="${arrPoly(afx,afy,-bnx,-bny)}" fill="${c.color}" opacity="${op}"/>`;
      if(cable.label||cable.length) {
        const txt=[cable.label,cable.length].filter(Boolean).join(' · ');
        const cts=state.cableTextScale||1;
        const fs=(14*cts), tw=txt.length*7*cts, rh=18*cts;
        paths += `<rect x="${mxo-tw/2-5*cts}" y="${myo-rh-5}" width="${tw+10*cts}" height="${rh}" rx="${4*cts}" fill="rgba(8,8,20,0.82)"/>`;
        paths += `<text x="${mxo}" y="${myo-rh/2-5+fs*0.36}" fill="${c.color}" font-size="${fs.toFixed(1)}" font-family="var(--m)" text-anchor="middle" opacity="0.97" font-weight="700">${esc(txt)}</text>`;
      }
      /* Poignées des points de routage (cable sélectionné). */
      if(isSel && cable.waypoints && cable.waypoints.length){
        const r=7/(state.view.zoom||1);
        cable.waypoints.forEach(function(p,wi){
          paths += `<circle class="sp-wp" cx="${p.x}" cy="${p.y}" r="${r}" data-cid="${cable.id}" data-idx="${wi}" vector-effect="non-scaling-stroke"/>`;
        });
      }
    });
    svg.innerHTML = paths;
    svg.querySelectorAll('.sp-cable-hit').forEach(p => {
      p.style.pointerEvents='stroke';
      p.addEventListener('click', e => {
        e.stopPropagation();
        state.selected={kind:'cable',id:p.dataset.cid};
        state.linkFrom=null;
        render();
      });
      /* Double-clic sur le câble : ajoute un point de routage à cet endroit. */
      p.addEventListener('dblclick', e => {
        e.stopPropagation(); e.preventDefault();
        const cable=state.cables.find(x=>x.id===p.dataset.cid); if(!cable) return;
        const wld=clientToWorld(e.clientX,e.clientY);
        _addWaypointAt(cable,{x:wld.x,y:wld.y});
        state.selected={kind:'cable',id:cable.id}; state.linkFrom=null;
        saveSite(); render();
      });
    });
    /* Poignées : glisser (clic gauche) pour déplacer · clic droit ou
       double-clic pour retirer CE point précis. */
    const _delWp=(cid,idx)=>{
      const cable=state.cables.find(x=>x.id===cid);
      if(cable&&cable.waypoints){ cable.waypoints.splice(idx,1); if(!cable.waypoints.length) delete cable.waypoints; saveSite(); render(); }
    };
    svg.querySelectorAll('.sp-wp').forEach(c2 => {
      c2.addEventListener('pointerdown', e => {
        if(e.button!==0) return; /* laisser le clic droit pour la suppression */
        e.stopPropagation(); e.preventDefault();
        _wpDrag={cid:c2.dataset.cid, idx:+c2.dataset.idx, moved:false};
      });
      c2.addEventListener('dblclick', e => {
        e.stopPropagation(); e.preventDefault();
        _delWp(c2.dataset.cid, +c2.dataset.idx);
      });
      c2.addEventListener('contextmenu', e => {
        e.stopPropagation(); e.preventDefault();
        _delWp(c2.dataset.cid, +c2.dataset.idx);
      });
    });
  }

  function renderInspector() {
    const insp = $('site-inspector');
    if(!insp) return;
    if(!state.selected){ insp.innerHTML='<p class="syn-insp-empty">Cliquez un element.<br/><br/>Pour connecter :<br/>survolez puis cliquez ⚡</p>'; return; }
    if(state.selected.kind==='el') {
      const el = state.elements.find(e=>e.id===state.selected.id);
      if(!el){ insp.innerHTML=''; return; }
      const it = findItem(el.type);
      const elSz = el.elSize || (el.type==='text_lbl'?18:72);
      const elTs = el.elTextScale || 1;
      const sizeLabel = el.type==='text_lbl' ? 'Taille police' : 'Taille element';
      const sizeMin  = el.type==='text_lbl' ? 10 : 32;
      const sizeMax  = el.type==='text_lbl' ? 72 : 180;
      const sizeStep = el.type==='text_lbl' ? 2  : 8;
      const connList = state.cables.filter(c=>c.fromId===el.id||c.toId===el.id).map(c=>{
        const other=state.elements.find(e=>e.id===(c.fromId===el.id?c.toId:c.fromId));
        const cc=ct(c.type);
        return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--txt2);margin-bottom:3px;cursor:pointer" onclick="SitePlan.selectCable('${c.id}')"><div style="width:18px;height:2px;background:${cc.color};border-radius:1px;flex-shrink:0"></div><span>${other?esc(other.label):'?'}</span><span style="color:var(--muted)">(${cc.label})</span></div>`;
      }).join('');
      const textBlock = el.type==='text_lbl'
        ? `<label class="syn-insp-lbl">Contenu</label><textarea class="syn-insp-inp" id="si-txt" rows="4" style="resize:vertical;font-size:11px">${esc(el.label)}</textarea>`
        : `<label class="syn-insp-lbl">Nom</label><input class="syn-insp-inp" id="si-lbl" value="${esc(el.label)}"/>`+
          `<label class="syn-insp-lbl">Note / Reference</label><input class="syn-insp-inp" id="si-note" value="${esc(el.note||'')}" placeholder="ex: SN 12345"/>`;
      const isSvgIcon = typeof it.icon === 'string' && it.icon.charAt(0) === '<';
      const titleIcon = isSvgIcon
        ? `<span style="width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:1px solid ${it.color}55;border-radius:5px;background:#fff;padding:2px;box-sizing:border-box;flex-shrink:0">${it.icon}</span>`
        : `<span style="font-size:16px;line-height:1">${it.icon}</span>`;
      insp.innerHTML =
        `<div class="syn-insp-title" style="color:${it.color};display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;margin-bottom:9px;line-height:1.2">${titleIcon}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(el.label.split('\n')[0])}</span></div>`+
        textBlock+
        `<label class="syn-insp-lbl">${sizeLabel}</label>`+
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">`+
        `<button class="spl-ts-btn" id="si-szminus">−</button>`+
        `<div style="flex:1;height:3px;background:var(--bdr3);border-radius:2px"><div style="width:${Math.round((elSz-sizeMin)/(sizeMax-sizeMin)*100)}%;height:3px;background:var(--ora);border-radius:2px"></div></div>`+
        `<button class="spl-ts-btn" id="si-szplus">+</button>`+
        `<span id="si-szval" style="font-size:10px;color:var(--muted);min-width:26px;text-align:right">${elSz}px</span></div>`+
        `<label class="syn-insp-lbl">Texte element</label>`+
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">`+
        `<button class="spl-ts-btn" id="si-etminus">A−</button>`+
        `<span id="si-etval" style="flex:1;font-size:10px;color:var(--muted);text-align:center">${Math.round(elTs*100)}%</span>`+
        `<button class="spl-ts-btn" id="si-etplus">A+</button></div>`+
        (connList?`<div style="padding-top:8px;border-top:1px solid var(--bdr2);margin-bottom:6px"><div style="font-size:9px;color:var(--muted);font-family:var(--m);margin-bottom:5px">CONNEXIONS</div>${connList}</div>`:``) +
        ((el.iconImg || el.type==='image_frame') ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bdr2)"><div style="font-size:9px;font-family:var(--m);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:5px">Taille de l'image</div><div style="display:flex;align-items:center;gap:7px"><button class="spl-ts-btn" onclick="SitePlan.adjImgPx('${el.id}',-16)">−</button><span id="si-img-px-lbl" style="flex:1;text-align:center;font-size:10px;color:var(--muted)">${el.imgPx||el.elSize||72}px</span><button class="spl-ts-btn" onclick="SitePlan.adjImgPx('${el.id}',16)">+</button></div></div>` : '') +
        (el.type!=='text_lbl' ? _iconImgInspHtml(el.id, !!el.iconImg, el.iconImg||'', `SitePlan.uploadElementIcon('${el.id}')`, `SitePlan.clearElementIcon('${el.id}')`) : '') +
        (el.type!=='image_frame' ? `<label style="display:flex;align-items:center;gap:8px;margin-top:11px;cursor:pointer;font-size:11px;color:var(--txt2);user-select:none"><input type="checkbox" class="cb" id="si-nobg" ${el.noBg?'checked':''}/> Fond transparent</label>` : '') +
        `<button class="btn sm" style="width:100%;margin-top:10px" id="si-dup"><i class="ti ti-copy"></i> Dupliquer <span style="font-size:8px;color:var(--muted);font-family:var(--m);margin-left:3px">Ctrl/⌘ D</span></button>`+
        `<button class="btn sm" style="width:100%;margin-top:6px;background:rgba(255,77,106,.12);border-color:var(--err);color:var(--err)" id="si-del"><i class="ti ti-trash"></i> Supprimer</button>`;
      // Events
      $('si-txt')?.addEventListener('input',e=>{el.label=e.target.value;saveSite();renderNodes();});
      $('si-lbl')?.addEventListener('change',e=>{el.label=e.target.value;saveSite();renderNodes();});
      $('si-note')?.addEventListener('change',e=>{el.note=e.target.value;saveSite();});
      const updSz=()=>{
        const v=el.elSize||(el.type==='text_lbl'?18:72);
        const pct=Math.round((v-sizeMin)/(sizeMax-sizeMin)*100);
        const szv=$('si-szval'); if(szv)szv.textContent=v+'px';
        const bar=insp.querySelector('#si-szminus+div div'); if(bar)bar.style.width=pct+'%';
      };
      $('si-szminus')?.addEventListener('click',()=>{ el.elSize=Math.max(sizeMin,(el.elSize||(el.type==='text_lbl'?18:72))-sizeStep); saveSite(); renderNodes(); updSz(); });
      $('si-szplus')?.addEventListener('click',()=>{ el.elSize=Math.min(sizeMax,(el.elSize||(el.type==='text_lbl'?18:72))+sizeStep); saveSite(); renderNodes(); updSz(); });
      const ET_STEPS=[0.6,0.75,0.85,1,1.2,1.5,1.8,2.2];
      const updEt=()=>{ const etv=$('si-etval'); if(etv)etv.textContent=Math.round((el.elTextScale||1)*100)+'%'; };
      $('si-etminus')?.addEventListener('click',()=>{
        let idx=ET_STEPS.findIndex(s=>Math.abs(s-(el.elTextScale||1))<0.05); if(idx<0)idx=3;
        el.elTextScale=ET_STEPS[Math.max(0,idx-1)]; saveSite(); renderNodes(); updEt();
      });
      $('si-etplus')?.addEventListener('click',()=>{
        let idx=ET_STEPS.findIndex(s=>Math.abs(s-(el.elTextScale||1))<0.05); if(idx<0)idx=3;
        el.elTextScale=ET_STEPS[Math.min(ET_STEPS.length-1,idx+1)]; saveSite(); renderNodes(); updEt();
      });
      $('si-nobg')?.addEventListener('change',e=>{ el.noBg=e.target.checked; saveSite(); renderNodes(); });
      $('si-dup')?.addEventListener('click',()=>{ duplicateSelectedEl(); });
      $('si-del')?.addEventListener('click',()=>{ if(el.iconImgB2)_b2DeleteIcon(el.iconImgB2); state.elements=state.elements.filter(x=>x.id!==el.id); state.cables=state.cables.filter(c=>c.fromId!==el.id&&c.toId!==el.id); state.selected=null; saveSite(); render(); });
    }
    if(state.selected.kind==='cable') {
      const cable = state.cables.find(c=>c.id===state.selected.id);
      if(!cable){ insp.innerHTML=''; return; }
      const f = cable.fromPt ? null : state.elements.find(e=>e.id===cable.fromId);
      const t2= cable.fromPt ? null : state.elements.find(e=>e.id===cable.toId);
      const fromLbl = cable.fromPt ? 'Point libre' : (f?esc(f.label):'?');
      const toLbl   = cable.fromPt ? 'Point libre' : (t2?esc(t2.label):'?');
      const c = ct(cable.type);
      const w = cable.width ?? 4;
      const dir = cable.direction ?? 'forward';
      const dirBtns = [
        {v:'forward', lbl:'→', title:'Source vers destination'},
        {v:'backward',lbl:'←', title:'Destination vers source'},
        {v:'both',    lbl:'↔', title:'Bidirectionnel'},
        {v:'none',    lbl:'—', title:'Sans fleche'},
      ].map(d=>`<button class="spl-dir-btn${dir===d.v?' on':''}" data-dir="${d.v}" title="${d.title}">${d.lbl}</button>`).join('');
      insp.innerHTML =
        `<div class="syn-insp-title" style="color:${_safeColor(c.color)||'#888'}">Liaison</div>`+
        `<div style="display:flex;gap:5px;align-items:center;margin-bottom:10px;font-size:11px;color:var(--txt2);flex-wrap:wrap">`+
        `<span style="color:var(--muted);font-size:10px">${fromLbl}</span><span style="color:${_safeColor(c.color)||'#888'};font-size:13px">──</span><span style="color:var(--muted);font-size:10px">${toLbl}</span></div>`+
        `<label class="syn-insp-lbl">Type</label>`+
        `<select class="syn-insp-inp" id="si-ct">${CABLE_TYPES.map(ct2=>`<option value="${esc(ct2.id)}"${cable.type===ct2.id?' selected':''}>${esc(ct2.label)}</option>`).join('')}</select>`+
        `<label class="syn-insp-lbl">Sens</label>`+
        `<div class="spl-dir-bar" id="si-dirbar">${dirBtns}</div>`+
        `<label class="syn-insp-lbl">Epaisseur</label>`+
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">`+
        `<button class="spl-ts-btn" id="si-wminus">−</button>`+
        `<div style="flex:1;height:${w}px;border-radius:${w}px;background:${c.color};transition:height .12s"></div>`+
        `<button class="spl-ts-btn" id="si-wplus">+</button>`+
        `<span id="si-wval" style="font-size:10px;color:var(--muted);min-width:18px;text-align:right">${w}</span></div>`+
        `<label class="syn-insp-lbl">Reference / label</label><input class="syn-insp-inp" id="si-cl" value="${esc(cable.label||'')}"/>`+
        `<label class="syn-insp-lbl">Longueur</label><input class="syn-insp-inp" id="si-clen" value="${esc(cable.length||'')}" placeholder="ex: 30m"/>`+
        `<label class="syn-insp-lbl" style="margin-top:11px">Routage</label>`+
        `<div style="display:flex;gap:6px"><button class="btn sm" style="flex:1" id="si-cwp"><i class="ti ti-vector-bezier-2"></i> + Point</button>`+
        (cable.waypoints&&cable.waypoints.length?`<button class="btn sm" style="flex:1" id="si-cwpc" title="Supprimer tous les points"><i class="ti ti-eraser"></i> Tout effacer (${cable.waypoints.length})</button>`:'')+`</div>`+
        `<div style="font-size:9px;color:var(--muted);font-family:var(--m);margin-top:5px;line-height:1.5"><b>+ Point</b> puis cliquez où vous voulez sur le plan (ou double-cliquez le câble) · glissez un point pour le déplacer · <b>clic droit</b> ou double-clic sur un point pour le supprimer.</div>`+
        `<button class="btn sm" style="width:100%;margin-top:12px;background:rgba(255,77,106,.12);border-color:var(--err);color:var(--err)" id="si-cdel"><i class="ti ti-trash"></i> Supprimer</button>`;
      $('si-ct')?.addEventListener('change',e=>{cable.type=e.target.value;saveSite();render();});
      $('si-cl')?.addEventListener('change',e=>{cable.label=e.target.value;saveSite();renderCables();});
      $('si-clen')?.addEventListener('change',e=>{cable.length=e.target.value;saveSite();renderCables();});
      $('si-wminus')?.addEventListener('click',()=>{ cable.width=Math.max(1,((cable.width??4)-1)); saveSite(); render(); });
      $('si-wplus')?.addEventListener('click',()=>{ cable.width=Math.min(16,((cable.width??4)+1)); saveSite(); render(); });
      $('si-dirbar')?.querySelectorAll('.spl-dir-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{ cable.direction=btn.dataset.dir; saveSite(); render(); });
      });
      $('si-cwp')?.addEventListener('click',()=>{ _setWpAddMode(cable.id); });
      $('si-cwpc')?.addEventListener('click',()=>{ delete cable.waypoints; saveSite(); render(); });
      $('si-cdel')?.addEventListener('click',()=>{ state.cables=state.cables.filter(c=>c.id!==cable.id); state.selected=null; saveSite(); render(); });
    }
  }

  function bindEvents() {
    const host=$('site-nodes'), vp=$('site-viewport'), wrap=$('site-canvas-wrap'), svg=$('site-cables');
    if(!host||!vp||!wrap) return;

    /* Mode « placer un point » : après clic sur « + Point », le prochain clic
       n'importe où sur le plan place le point de routage à cet endroit précis.
       Capture-phase = on intercepte avant tout autre handler (nœuds, câbles…). */
    wrap.addEventListener('pointerdown', e => {
      if(!_wpAddCid) return;
      const cable=state.cables.find(x=>x.id===_wpAddCid);
      _setWpAddMode(null);
      if(cable){
        const w=clientToWorld(e.clientX,e.clientY);
        _addWaypointAt(cable,{x:w.x,y:w.y});
        state.selected={kind:'cable',id:cable.id}; state.linkFrom=null;
        saveSite(); render();
      }
      e.stopPropagation(); e.preventDefault();
    }, true);

    // Drop from palette
    wrap.addEventListener('dragover',e=>e.preventDefault());
    wrap.addEventListener('drop',e=>{
      e.preventDefault();
      const type=e.dataTransfer.getData('spl-type');
      if(!type) return;
      const w=clientToWorld(e.clientX,e.clientY);
      addElement(type,w.x-31,w.y-31);
    });

    // Node pointer events
    host.addEventListener('pointerdown',ev=>{
      const del=ev.target.closest('.spl-del');
      if(del){
        const id=del.dataset.del;
        /* Supprime aussi l'image du serveur (B2) si l'élément en portait une. */
        const _del=state.elements.find(e=>e.id===id);
        if(_del&&_del.iconImgB2)_b2DeleteIcon(_del.iconImgB2);
        state.elements=state.elements.filter(e=>e.id!==id);
        state.cables=state.cables.filter(c=>c.fromId!==id&&c.toId!==id);
        if(state.selected?.id===id)state.selected=null;
        saveSite(); render(); ev.stopPropagation(); return;
      }
      const rsz=ev.target.closest('.spl-rsz');
      if(rsz){
        const id=rsz.dataset.id;
        const el=state.elements.find(e=>e.id===id); if(!el){ev.stopPropagation();return;}
        const w0=el.imgPx||el.elSize||120, asp=el.imgAspect||1, h0=w0/asp;
        resizing={id,corner:rsz.dataset.corner,x0:el.x,y0:el.y,right:el.x+w0,bottom:el.y+h0,asp};
        host.setPointerCapture?.(ev.pointerId);
        ev.stopPropagation(); ev.preventDefault(); return;
      }
      const conn=ev.target.closest('.spl-conn');
      if(conn){
        const id=conn.dataset.conn;
        if(state.linkFrom===id){ state.linkFrom=null; updateLinkBanner(); render(); }
        else if(state.linkFrom){ createCable(state.linkFrom,id); state.linkFrom=null; updateLinkBanner(); }
        else{ state.linkFrom=id; updateLinkBanner(); renderNodes(); }
        ev.stopPropagation(); return;
      }
      const nodeEl=ev.target.closest('.spl-node');
      if(!nodeEl) return;
      const id=nodeEl.dataset.id;
      // Cable mode: direct click on element connects
      if(state.cableMode){
        if(state.freePt1){
          // free point is set — snap the second end to this element center
          const el2=state.elements.find(e=>e.id===id);
          if(el2){const half=el2.type==='text_lbl'?20:(el2.elSize||72)/2; createFreeCable(state.freePt1,{x:el2.x+half,y:el2.y+half}); state.freePt1=null; _clearPreview(); updateLinkBanner();}
          ev.stopPropagation(); ev.preventDefault(); return;
        }
        if(!state.linkFrom){ state.linkFrom=id; updateLinkBanner(); renderNodes(); }
        else if(state.linkFrom===id){ state.linkFrom=null; updateLinkBanner(); renderNodes(); }
        else{ createCable(state.linkFrom,id); state.linkFrom=null; updateLinkBanner(); renderNodes(); }
        ev.stopPropagation(); ev.preventDefault(); return;
      }
      if(state.linkFrom&&state.linkFrom!==id){ createCable(state.linkFrom,id); state.linkFrom=null; updateLinkBanner(); ev.preventDefault(); return; }
      state.selected={kind:'el',id};
      const el=state.elements.find(e=>e.id===id);
      if(!el) return;
      const w=clientToWorld(ev.clientX,ev.clientY);
      dragging={id,ox:w.x-el.x,oy:w.y-el.y,moved:false};
      host.setPointerCapture?.(ev.pointerId);
      renderNodes(); renderInspector();
      ev.preventDefault();
    });

    host.addEventListener('pointermove',ev=>{
      if(resizing){
        const el=state.elements.find(e=>e.id===resizing.id);
        if(!el) return;
        const w=clientToWorld(ev.clientX,ev.clientY);
        const c=resizing.corner;
        let newW = (c==='se'||c==='ne') ? (w.x-resizing.x0) : (resizing.right-w.x);
        newW=Math.max(24,Math.min(900,Math.round(newW)));
        const newH=Math.round(newW/resizing.asp);
        if(c==='se'){ el.x=resizing.x0; el.y=resizing.y0; }
        else if(c==='ne'){ el.x=resizing.x0; el.y=resizing.bottom-newH; }
        else if(c==='sw'){ el.x=resizing.right-newW; el.y=resizing.y0; }
        else { el.x=resizing.right-newW; el.y=resizing.bottom-newH; }
        el.x=Math.max(0,Math.round(el.x)); el.y=Math.max(0,Math.round(el.y));
        el.imgPx=newW;
        renderNodes(); renderCables();
        return;
      }
      if(!dragging) return;
      dragging.moved=true;
      const el=state.elements.find(e=>e.id===dragging.id);
      const div=host.querySelector(`.spl-node[data-id="${dragging.id}"]`);
      if(!el||!div) return;
      const w=clientToWorld(ev.clientX,ev.clientY);
      el.x=Math.max(0,Math.round(w.x-dragging.ox));
      el.y=Math.max(0,Math.round(w.y-dragging.oy));
      div.style.left=el.x+'px'; div.style.top=el.y+'px';
      renderCables();
    });

    host.addEventListener('pointerup',()=>{ if(resizing){saveSite(); resizing=null; renderInspector();} if(dragging?.moved)saveSite(); dragging=null; });

    // Click on empty = deselect / cancel link / place free cable point
    vp.addEventListener('pointerdown',e=>{
      if(e.target!==vp&&e.target.id!=='site-bg-img'&&e.target.id!=='site-nodes'&&!e.target.id.startsWith('site-')) return;
      if(state.cableMode){
        const w=clientToWorld(e.clientX,e.clientY);
        if(state.freePt1){
          createFreeCable(state.freePt1, w);
          state.freePt1=null; _clearPreview(); updateLinkBanner();
        } else if(!state.linkFrom){
          state.freePt1=w; updateLinkBanner();
        } else {
          // linkFrom was set from element — use canvas point as destination free end
          // treat as cancelling for now; user should click element
          state.linkFrom=null; updateLinkBanner(); renderNodes();
        }
        e.stopPropagation(); e.preventDefault(); return;
      }
      if(state.linkFrom){ state.linkFrom=null; updateLinkBanner(); renderNodes(); return; }
      if(state.selected){ state.selected=null; renderNodes(); renderInspector(); }
      panning={sx:e.clientX-state.view.panX,sy:e.clientY-state.view.panY};
      vp.setPointerCapture?.(e.pointerId);
    });
    vp.addEventListener('pointermove',e=>{
      if(state.cableMode && state.freePt1){
        const w=clientToWorld(e.clientX,e.clientY);
        _renderPreview(state.freePt1,w);
      }
      if(!panning) return; state.view.panX=e.clientX-panning.sx; state.view.panY=e.clientY-panning.sy; applyTransform();
    });
    vp.addEventListener('pointerup',()=>{ panning=null; });
    vp.addEventListener('wheel',e=>{
      e.preventDefault();
      if(e.ctrlKey){
        // Pinch-to-zoom (Mac trackpad) or Ctrl+scroll — smooth exponential
        const f=Math.exp(-e.deltaY*0.01);
        const r=vp.getBoundingClientRect();
        const mx=e.clientX-r.left, my=e.clientY-r.top;
        state.view.panX=mx-(mx-state.view.panX)*f;
        state.view.panY=my-(my-state.view.panY)*f;
        state.view.zoom=Math.min(4,Math.max(0.1,state.view.zoom*f));
      } else {
        // Two-finger scroll = pan
        state.view.panX-=e.deltaX;
        state.view.panY-=e.deltaY;
      }
      applyTransform();
    },{passive:false});

    // Escape cancels link / free cable drawing
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&_wpAddCid){ _setWpAddMode(null); return; }
      if(e.key==='Escape'&&(state.linkFrom||state.cableMode||state.freePt1)){
        state.linkFrom=null; state.freePt1=null; state.cableMode=false;
        _clearPreview(); updateLinkBanner(); renderCablePicker(); renderNodes();
      }
      /* Copier / coller / dupliquer — uniquement quand le plan de site est
         visible et qu'on ne tape pas dans un champ. */
      if(!(e.ctrlKey||e.metaKey)) return;
      if(!host || host.offsetParent===null) return;
      var t=e.target, tag=t&&t.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.isContentEditable)) return;
      var k=(e.key||'').toLowerCase();
      if(k==='c'){ if(copySelectedEl()) e.preventDefault(); }
      else if(k==='v'){ if(_siteClip){ pasteEl(); e.preventDefault(); } }
      else if(k==='d'){ if(state.selected&&state.selected.kind==='el'){ duplicateSelectedEl(); e.preventDefault(); } }
    });

    /* Déplacement d'un point de routage de câble (drag global pour survivre
       aux re-rendus du SVG). */
    document.addEventListener('pointermove', e => {
      if(!_wpDrag) return;
      const cable=state.cables.find(x=>x.id===_wpDrag.cid);
      if(!cable||!cable.waypoints||!cable.waypoints[_wpDrag.idx]){ return; }
      const w=clientToWorld(e.clientX,e.clientY);
      cable.waypoints[_wpDrag.idx]={x:Math.round(w.x),y:Math.round(w.y)};
      renderCables();
    });
    document.addEventListener('pointerup', () => { if(_wpDrag){ _wpDrag=null; saveSite(); } });
  }

  function updateLinkBanner() {
    const b=$('site-link-banner'), wrap=$('site-canvas-wrap');
    if(!b) return;
    const c=CABLE_TYPES.find(t=>t.id===state.activeCableType)||CABLE_TYPES[0];
    const _cCol=_safeColor(c.color)||'#888', _cLbl=esc(c.label);
    if(state.cableMode && state.freePt1){
      b.innerHTML=`<i class="ti ti-plug-connected"></i> <span style="color:${_cCol};font-weight:600">${_cLbl}</span> &nbsp;— cliquez le <b>point d'arrivee</b> ou un element &nbsp;<span style="opacity:.5">Echap = annuler</span>`;
      b.classList.add('show');
    } else if(state.cableMode && !state.linkFrom){
      b.innerHTML=`<i class="ti ti-plug-connected"></i> <span style="color:${_cCol};font-weight:600">${_cLbl}</span> &nbsp;— cliquez un element ou un <b>point sur le plan</b> &nbsp;<span style="opacity:.5">Echap = quitter</span>`;
      b.classList.add('show');
    } else if(state.linkFrom){
      b.innerHTML=`<i class="ti ti-plug-connected"></i> <span style="color:${_cCol};font-weight:600">${_cLbl}</span> &nbsp;— cliquez la <b>destination</b> &nbsp;<span style="opacity:.5">Echap = annuler</span>`;
      b.classList.add('show');
    } else {
      b.classList.remove('show');
    }
    if(wrap) wrap.classList.toggle('link-mode', state.cableMode || !!state.linkFrom || !!state.freePt1);
  }

  function addElement(type,x,y) {
    const it=findItem(type);
    const el={id:uid(),type,label:it.label,x:Math.round(x),y:Math.round(y),note:''};
    if(type==='image_frame'){el.imgPx=120;el.elSize=120;el.label='';}
    state.elements.push(el);
    state.selected={kind:'el',id:el.id};
    saveSite(); render();
    if(type==='image_frame') setTimeout(function(){ uploadElementIcon(el.id); },80);
  }

  /* ── Copier / coller / dupliquer un élément (mêmes nom, taille, image…) ── */
  let _siteClip=null;
  function copySelectedEl(){
    if(!state.selected || state.selected.kind!=='el') return false;
    var el=state.elements.find(function(e){return e.id===state.selected.id;});
    if(!el) return false;
    _siteClip=JSON.parse(JSON.stringify(el));
    toast('Élément copié');
    return true;
  }
  function pasteEl(){
    if(!_siteClip) return;
    var el=JSON.parse(JSON.stringify(_siteClip));
    el.id=uid();
    el.x=Math.round((_siteClip.x||0)+24);
    el.y=Math.round((_siteClip.y||0)+24);
    /* La copie est indépendante : on garde l'image (base64, ré-affichée et
       comptée en DB) mais on retire la clé B2 partagée — ainsi supprimer
       l'un n'efface pas le fichier serveur de l'autre. */
    delete el.iconImgB2;
    state.elements.push(el);
    state.selected={kind:'el',id:el.id};
    /* Cascade : la prochaine collure se décale à partir de cette copie. */
    _siteClip=JSON.parse(JSON.stringify(el));
    saveSite(); render();
    toast('Élément collé');
  }
  function duplicateSelectedEl(){
    if(copySelectedEl()) pasteEl();
  }

  function createCable(fromId,toId) {
    if(fromId===toId) return;
    const cable={id:uid(),fromId,toId,type:state.activeCableType,label:'',length:'',width:4,direction:'forward'};
    state.cables.push(cable);
    state.selected={kind:'cable',id:cable.id};
    saveSite(); render();
  }

  function createFreeCable(fromPt, toPt) {
    const cable={id:uid(),fromPt:{x:Math.round(fromPt.x),y:Math.round(fromPt.y)},toPt:{x:Math.round(toPt.x),y:Math.round(toPt.y)},type:state.activeCableType,label:'',length:'',width:3,direction:'none'};
    state.cables.push(cable);
    state.selected={kind:'cable',id:cable.id};
    saveSite(); render();
  }

  function _renderPreview(from, to) {
    const svg=$('site-cables');
    if(!svg) return;
    let g=document.getElementById('site-preview-cable');
    if(!g){g=document.createElementNS('http://www.w3.org/2000/svg','g');g.id='site-preview-cable';svg.appendChild(g);}
    const c=ct(state.activeCableType);
    const dash=c.dash?'stroke-dasharray="'+c.dash+'"':'';
    g.innerHTML='<line x1="'+from.x+'" y1="'+from.y+'" x2="'+to.x+'" y2="'+to.y+'" stroke="'+c.color+'" stroke-width="3" '+dash+' opacity="0.5"/>'+'<circle cx="'+from.x+'" cy="'+from.y+'" r="5" fill="'+c.color+'" opacity="0.7"/>';
  }

  function _clearPreview() {
    const g=document.getElementById('site-preview-cable');
    if(g) g.innerHTML='';
  }

  async function loadBg(input) {
    const file=input.files?.[0];
    input.value='';
    if(!file) return;
    if(!/^image\//.test(file.type||'')){toast('Format non supporté (image attendue)');return;}
    if(file.size>8*1024*1024){toast('Image trop lourde (max 8 Mo)');return;}
    try{
      const dataUrl=await _compressImageToB64(file, 1600, _IMG_STORE_CAP);
      if(!await _quotaCheck(_dataUrlBytes(dataUrl))) return;
      state.bgImage=dataUrl;
      applyBg();
      saveSite();
    }catch(e){ toast('Erreur image : '+(e&&e.message||e)); }
  }

  function applyBg() {
    const img=$('site-bg-img'),ctrl=$('site-bg-controls');
    if(img){if(state.bgImage){img.src=state.bgImage;img.style.display='block';img.style.opacity=state.bgOpacity/100;}else{img.src='';img.style.display='none';}}
    if(ctrl)ctrl.style.display=state.bgImage?'block':'none';
  }

  function setBgOpacity(val) { state.bgOpacity=+val; const img=$('site-bg-img'); if(img)img.style.opacity=val/100; saveSite(); }
  function clearBg() { state.bgImage=null; applyBg(); saveSite(); }

  function load(data) {
    if(data){
      state.elements=data.elements||[];
      state.cables=data.cables||[];
      state.bgImage=data.bgImage||null;
      state.bgOpacity=data.bgOpacity??100;
      if(data.view)state.view=data.view;
    } else {
      state.elements=[];state.cables=[];state.bgImage=null;state.bgOpacity=100;state.view={panX:60,panY:60,zoom:1};
    }
    if(data?.activeCableType) state.activeCableType=data.activeCableType;
    if(data?.textScale) state.textScale=data.textScale;
    if(data?.legendScale) state.legendScale=data.legendScale;
    state.cableTextScale=data?.cableTextScale||1;
    state.selected=null;state.linkFrom=null;state.freePt1=null;
    const sl=$('site-bg-opacity');if(sl)sl.value=state.bgOpacity;
    const tl=$('spl-ts-val');if(tl)tl.textContent=Math.round(state.textScale*100)+'%';
    const ll=$('spl-leg-val');if(ll)ll.textContent=Math.round((state.legendScale||1)*100)+'%';
    const cl=$('spl-cab-val');if(cl)cl.textContent=Math.round((state.cableTextScale||1)*100)+'%';
    applyBg(); applyTransform();
    if(inited){ renderCablePicker(); render(); }
  }

  function getData() { return {elements:state.elements,cables:state.cables,bgImage:state.bgImage,bgOpacity:state.bgOpacity,view:state.view,activeCableType:state.activeCableType,textScale:state.textScale,legendScale:state.legendScale,cableTextScale:state.cableTextScale}; }

  function clear() { state.elements=[];state.cables=[];state.selected=null;state.linkFrom=null;state.freePt1=null;_clearPreview(); saveSite(); render(); }

  function zoom(f) {
    const vp = $('site-viewport');
    if (vp) {
      const rect = vp.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      state.view.panX = cx - (cx - state.view.panX) * f;
      state.view.panY = cy - (cy - state.view.panY) * f;
    }
    state.view.zoom = Math.min(3, Math.max(0.2, state.view.zoom * f));
    applyTransform();
  }
  function setZoomPct(pct) {
    const vp = $('site-viewport');
    const target = Math.max(0.2, Math.min(3, (+pct) / 100));
    if (vp) {
      const rect = vp.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const factor = target / state.view.zoom;
      state.view.panX = cx - (cx - state.view.panX) * factor;
      state.view.panY = cy - (cy - state.view.panY) * factor;
    }
    state.view.zoom = target;
    applyTransform();
  }
  function fitView() {
    const vp = $('site-viewport');
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    if (!state.elements.length) { resetView(); return; }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    state.elements.forEach(e => {
      const sz = e.elSize || 72;
      if (e.x < minX) minX = e.x;
      if (e.y < minY) minY = e.y;
      if (e.x + sz > maxX) maxX = e.x + sz;
      if (e.y + sz > maxY) maxY = e.y + sz;
    });
    const PAD = 60;
    const w = maxX - minX + PAD * 2;
    const h = maxY - minY + PAD * 2;
    state.view.zoom = Math.min(3, Math.max(0.2, Math.min(rect.width / w, rect.height / h) * 0.95));
    state.view.panX = (rect.width - (maxX - minX) * state.view.zoom) / 2 - (minX - PAD) * state.view.zoom;
    state.view.panY = (rect.height - (maxY - minY) * state.view.zoom) / 2 - (minY - PAD) * state.view.zoom;
    applyTransform();
  }

  function resetView() { state.view={panX:60,panY:60,zoom:1}; applyTransform(); }

  function selectCable(id) { state.selected={kind:'cable',id}; render(); }

  function setActiveCableType(id) {
    state.activeCableType = id;
    state.cableMode = true;
    state.linkFrom = null;
    updateLinkBanner();
    renderCablePicker();
  }

  function toggleCableMode() {
    state.cableMode = !state.cableMode;
    if(!state.cableMode) state.linkFrom = null;
    updateLinkBanner();
    renderCablePicker();
  }

  function setTextScale(dir) {
    const steps=[0.6,0.75,0.85,1,1.2,1.4,1.7,2.1];
    let idx=steps.findIndex(s=>Math.abs(s-state.textScale)<0.05);
    if(idx<0) idx=steps.indexOf(1);
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    state.textScale=steps[idx];
    applyTransform(); saveSite();
    const lbl=$('spl-ts-val'); if(lbl) lbl.textContent=Math.round(state.textScale*100)+'%';
  }

  function setLegendScale(dir) {
    const steps=[0.6,0.75,0.85,1,1.2,1.5,1.8,2.2];
    let idx=steps.findIndex(s=>Math.abs(s-(state.legendScale||1))<0.05);
    if(idx<0) idx=3;
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    state.legendScale=steps[idx]; saveSite(); renderLegend();
    const lbl=$('spl-leg-val'); if(lbl) lbl.textContent=Math.round(state.legendScale*100)+'%';
  }

  /* Taille du texte (longueur / label) des câbles — réglage global. */
  function setCableTextScale(dir) {
    const steps=[0.7,0.85,1,1.25,1.5,1.8,2.2,2.7];
    let idx=steps.findIndex(s=>Math.abs(s-(state.cableTextScale||1))<0.05);
    if(idx<0) idx=2;
    idx=Math.max(0,Math.min(steps.length-1,idx+dir));
    state.cableTextScale=steps[idx]; saveSite(); renderCables();
    const lbl=$('spl-cab-val'); if(lbl) lbl.textContent=Math.round(state.cableTextScale*100)+'%';
  }

  function _rrect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  }

  /* Pre-convert SVG icon strings to HTMLImageElement for canvas drawImage() */
  let _siteIconImgs = null;
  let _siteCustomImgCache = null; // cache des images personnalisées pour le canvas
  function _invalidateSiteIconImgs(){ _siteIconImgs = null; }
  function _loadSiteCustomImgs(done){
    const els = state.elements.filter(e=>e.iconImg);
    _siteCustomImgCache = {};
    if(!els.length){ done(); return; }
    let pending = els.length;
    els.forEach(function(el){
      const img = new Image();
      img.onload = img.onerror = function(){
        _siteCustomImgCache[el.id] = img.complete && img.width > 0 ? img : null;
        if(--pending === 0) done();
      };
      img.src = el.iconImg;
    });
  }
  function _loadSiteIconImgs(done) {
    if (_siteIconImgs) { done(); return; }
    _siteIconImgs = {};
    /* Combine built-in + custom item icons */
    var allIcons = Object.assign({}, SITE_ICONS);
    _getCustomSiteItems().forEach(function(it){ if(it.type&&it.icon) allIcons[it.type]=it.icon; });
    const keys = Object.keys(allIcons);
    let pending = keys.length;
    if (!pending) { done(); return; }
    keys.forEach(function(k) {
      const img = new Image();
      /* xmlns OBLIGATOIRE pour charger un SVG comme <img> : les icônes de la
         palette n'en ont pas → sans lui, l'image échoue (onerror) et on retombe
         sur l'abréviation. + width/height explicites pour naturalWidth>0. */
      var svgStr = allIcons[k];
      if(svgStr && !/xmlns=/.test(svgStr)) svgStr = svgStr.replace(/^<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');
      if(svgStr && !/\bwidth=/.test(svgStr)) svgStr = svgStr.replace(/^<svg /, '<svg width="64" height="64" ');
      const svgBlob = new Blob([svgStr], {type:'image/svg+xml'});
      const url = URL.createObjectURL(svgBlob);
      /* onload = succès (on accepte même si naturalWidth==0, certains navigateurs
         le rapportent ainsi pour les SVG). onerror = image cassée → null, sinon
         drawImage lève InvalidStateError ('broken' state) et casse tout l'export. */
      img.onload = function() {
        _siteIconImgs[k] = img;
        URL.revokeObjectURL(url);
        if (--pending === 0) done();
      };
      img.onerror = function() {
        _siteIconImgs[k] = null;
        URL.revokeObjectURL(url);
        if (--pending === 0) done();
      };
      img.src = url;
    });
  }

  function _makeCanvas(cb) {
    const _draw = bgImg => {
      const els=state.elements, cables=state.cables;
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      if(bgImg){ minX=0; minY=0; maxX=bgImg.naturalWidth; maxY=bgImg.naturalHeight; }
      els.forEach(e=>{
        const _es=(e.elSize||72), _iw=(e.type==='image_frame'?(e.imgPx||_es):_es);
        minX=Math.min(minX,e.x-40); minY=Math.min(minY,e.y-40);
        maxX=Math.max(maxX,e.x+Math.max(_iw,200)+24); maxY=Math.max(maxY,e.y+_es+150);
      });
      if(!isFinite(minX)){ minX=0;minY=0;maxX=1200;maxY=800; }
      const W=maxX-minX, H=maxY-minY;
      const SCALE=Math.min(2, 3840/Math.max(W,H));
      const cw=Math.round(W*SCALE), ch=Math.round(H*SCALE);
      const canvas=document.createElement('canvas');
      canvas.width=cw; canvas.height=ch;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#0a0f1c'; ctx.fillRect(0,0,cw,ch);
      const wx=x=>(x-minX)*SCALE, wy=y=>(y-minY)*SCALE;
      if(bgImg){
        ctx.save(); ctx.globalAlpha=state.bgOpacity/100;
        ctx.drawImage(bgImg, wx(0), wy(0), bgImg.naturalWidth*SCALE, bgImg.naturalHeight*SCALE);
        ctx.restore();
      }
      const drawArrow=(tx,ty,dx,dy,color,sz)=>{
        const bx=tx-dx*sz, by=ty-dy*sz;
        ctx.save(); ctx.fillStyle=color; ctx.beginPath();
        ctx.moveTo(tx,ty);
        ctx.lineTo(bx-dy*sz*0.55, by+dx*sz*0.55);
        ctx.lineTo(bx+dy*sz*0.55, by-dx*sz*0.55);
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      const pairMap=_buildPairMap();
      cables.forEach(cable=>{
        const g=_cableGeom(cable,pairMap,1);
        if(!g) return;
        const {afx,afy,atx,aty,myo,mxo,nx,ny,bnx,bny,pts}=g;
        const c=CABLE_TYPES.find(t=>t.id===cable.type)||CABLE_TYPES[0];
        const w=(cable.width??4)*SCALE;
        const dir=cable.direction??'forward';
        ctx.beginPath(); ctx.strokeStyle=c.color; ctx.lineWidth=w;
        ctx.lineJoin='round'; ctx.lineCap='round';
        if(c.dash) ctx.setLineDash(c.dash.split(' ').map(n=>parseFloat(n)*SCALE));
        else ctx.setLineDash([]);
        if(pts && pts.length>2){
          ctx.moveTo(wx(pts[0].x),wy(pts[0].y));
          for(let pi=1;pi<pts.length;pi++) ctx.lineTo(wx(pts[pi].x),wy(pts[pi].y));
        } else {
          ctx.moveTo(wx(afx),wy(afy));
          ctx.bezierCurveTo(wx(afx),wy(myo), wx(atx),wy(myo), wx(atx),wy(aty));
        }
        ctx.stroke(); ctx.setLineDash([]);
        const ARR=14*SCALE;
        if(dir==='forward'||dir==='both') drawArrow(wx(atx),wy(aty), nx, ny, c.color, ARR);
        if(dir==='backward'||dir==='both') drawArrow(wx(afx),wy(afy),-bnx,-bny, c.color, ARR);
        if(cable.label||cable.length){
          const txt=[cable.label,cable.length].filter(Boolean).join(' · ');
          const cts=state.cableTextScale||1;
          const fs=14*cts*SCALE;
          ctx.font=`700 ${fs}px sans-serif`;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          const tw=ctx.measureText(txt).width, rh=fs*1.5, cx=wx(mxo), cyy=wy(myo)-rh*0.7;
          _rrect(ctx,cx-tw/2-6*cts*SCALE,cyy-rh/2,tw+12*cts*SCALE,rh,4*cts*SCALE);
          ctx.fillStyle='rgba(8,8,20,0.82)'; ctx.fill();
          ctx.fillStyle=c.color; ctx.fillText(txt, cx, cyy);
        }
      });
      const TS=state.textScale||1;
      els.forEach(el=>{
        const it=findItem(el.type);
        const ex=wx(el.x), ey=wy(el.y);
        const _customImg=_siteCustomImgCache&&_siteCustomImgCache[el.id];
        const _icImg=_siteIconImgs&&_siteIconImgs[el.type];
        const _iconImg=_customImg||_icImg||null;
        const _emoji=(it&&typeof it.icon==='string'&&it.icon.charAt(0)!=='<')?it.icon:'';
        _spDrawSiteNode(ctx, el, ex, ey, SCALE, TS, {color:(it&&it.color)||'#5a6580', iconImg:_iconImg, emoji:_emoji});
      });
      const usedIds=[...new Set(cables.map(c=>c.type))];
      if(usedIds.length>0){
        const LS=state.legendScale||1;
        const ROW=22*LS, HDR=28*LS, LW=175*LS;
        const LH=(usedIds.length*ROW+HDR)*SCALE;
        const LX=16*SCALE, LY=ch-LH-16*SCALE;
        ctx.fillStyle='rgba(10,15,28,0.9)'; _rrect(ctx,LX,LY,LW*SCALE,LH,6*SCALE); ctx.fill();
        ctx.font=`bold ${9*LS*SCALE}px sans-serif`; ctx.fillStyle='#888';
        ctx.textAlign='left'; ctx.textBaseline='top';
        ctx.fillText('LIAISONS', LX+10*LS*SCALE, LY+8*LS*SCALE);
        usedIds.forEach((id,i)=>{
          const c=CABLE_TYPES.find(t=>t.id===id)||CABLE_TYPES[0];
          const ry=LY+(HDR+i*ROW)*SCALE;
          ctx.beginPath(); ctx.strokeStyle=c.color; ctx.lineWidth=2.5*LS*SCALE;
          if(c.dash) ctx.setLineDash(c.dash.split(' ').map(n=>parseFloat(n)*LS*SCALE));
          else ctx.setLineDash([]);
          ctx.moveTo(LX+10*LS*SCALE,ry+7*LS*SCALE); ctx.lineTo(LX+38*LS*SCALE,ry+7*LS*SCALE);
          ctx.stroke(); ctx.setLineDash([]);
          ctx.font=`${10*LS*SCALE}px sans-serif`; ctx.fillStyle='#ccc';
          ctx.textBaseline='top'; ctx.fillText(c.label, LX+46*LS*SCALE, ry);
        });
      }
      cb(canvas);
    };
    _loadSiteIconImgs(function() {
      _loadSiteCustomImgs(function(){
        const _safeDraw=function(bgImg){try{_draw(bgImg);}catch(e){if(typeof toast!=='undefined')toast('Erreur lors du rendu du plan : '+e.message);console.error('_makeCanvas _draw:',e);cb(null);}};
        if(state.bgImage){ const img=new Image(); img.onload=()=>_safeDraw(img); img.onerror=()=>_safeDraw(null); img.src=state.bgImage; }
        else { _safeDraw(null); }
      });
    });
  }

  function exportPng() {
    if(state.elements.length===0 && !state.bgImage){ alert('Plan vide — rien a exporter'); return; }
    _makeCanvas(canvas=>{
      canvas.toBlob(blob=>{
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download='plan-site.png'; a.click();
        setTimeout(()=>URL.revokeObjectURL(url),3000);
      },'image/png');
    });
  }

  function exportCanvas(cb) {
    if(state.elements.length===0 && !state.bgImage){ alert('Plan vide — rien a exporter'); return; }
    _makeCanvas(cb);
  }
  function exportCanvasSafe(cb) {
    /* Comme exportCanvas mais sans alert — pour l'usage interne (vue mobile) */
    if(state.elements.length===0 && !state.bgImage){ cb(null); return; }
    _makeCanvas(cb);
  }
  function hasContent(){ return state && (state.elements.length > 0 || !!state.bgImage); }

  function uploadElementIcon(elId){
    _pickIconFile(async function(file){
      try{
        var b64=await _resizeIconToB64(file);
        var el=state.elements.find(function(e){return e.id===elId;}); if(!el)return;
        var b2Key=(typeof CUR_SHOW!=='undefined'&&CUR_SHOW?.id||'unknown')+'/node-icons/site-'+elId+'-'+Date.now()+'.jpg';
        _b2DeleteIcon(el.iconImgB2);
        el.iconImg=b64; el.iconImgB2=b2Key;
        if(!el.imgPx) el.imgPx=el.elSize||72;
        el._aspChk=true;
        /* Capture le ratio de l'image pour l'afficher à son format exact. */
        var _im=new Image();
        _im.onload=function(){ if(_im.naturalHeight){ el.imgAspect=_im.naturalWidth/_im.naturalHeight; saveSite(); renderNodes(); } };
        _im.src=b64;
        _siteCustomImgCache=null;
        saveSite(); renderNodes(); renderInspector();
        _b2UploadIcon(b64, b2Key);
      }catch(e){ if(typeof toast!=='undefined')toast('Erreur image : '+e.message); }
    });
  }
  function clearElementIcon(elId){
    var el=state.elements.find(function(e){return e.id===elId;}); if(!el)return;
    _b2DeleteIcon(el.iconImgB2);
    el.iconImg=null; el.iconImgB2=null;
    _siteCustomImgCache=null;
    saveSite(); renderNodes(); renderInspector();
  }
  function adjImgPx(elId, delta){
    var el=state.elements.find(function(e){return e.id===elId;}); if(!el)return;
    el.imgPx=Math.max(24,Math.min(600,(el.imgPx||el.elSize||72)+delta));
    var lbl=document.getElementById('si-img-px-lbl'); if(lbl)lbl.textContent=el.imgPx+'px';
    _siteCustomImgCache=null;
    saveSite(); renderNodes();
  }
  function addElement_image(x,y){
    /* Crée un image_frame et ouvre le sélecteur de fichier */
    const id='spl_'+Date.now().toString(36);
    state.elements.push({id,type:'image_frame',label:'',x,y,elSize:120,imgPx:120,note:'',iconImg:null,iconImgB2:null});
    state.selected={kind:'el',id};
    saveSite(); render(); renderInspector();
    setTimeout(function(){ uploadElementIcon(id); },80);
  }
  return {init,load,getData,loadBg,setBgOpacity,clearBg,clear,zoom,setZoomPct,fitView,resetView,selectCable,exportPng,exportCanvas,exportCanvasSafe,hasContent,setActiveCableType,toggleCableMode,setTextScale,setLegendScale,setCableTextScale,deleteCustomCableType,updateCableType,uploadElementIcon,clearElementIcon,adjImgPx,
    /* Exposés pour le rendu fidèle côté lien partagé (couleur + icône réelles
       de la palette, identiques à _makeCanvas). */
    itemMeta:function(t){var it=findItem(t); return {color:(it&&it.color)||'#5a6a80', icon:(it&&it.icon)||null, label:(it&&it.label)||t};},
    cableMeta:function(id){var c=CABLE_TYPES.find(function(x){return x.id===id;})||CABLE_TYPES[0]; return c?{color:c.color,dash:c.dash||null,label:c.label||''}:{color:'#4a90d9',dash:null,label:''};},
    addCustomCableType:function(t){if(!CABLE_TYPES.find(function(x){return x.id===t.id;})){CABLE_TYPES.push(t);_saveCustomCableTypes();renderCablePicker();}}};
})();

// ══════════════════════════════════════
// SESSIONS PANEL
// ══════════════════════════════════════
/* ══════════════════════════════════════
   DOSSIERS DE SESSIONS
   Organisation personnelle de la grille des sessions (ex. archiver les
   anciennes tournées). Stockée localement par utilisateur — les sessions
   elles-mêmes restent dans la base ; les dossiers ne sont qu'une vue.
   ══════════════════════════════════════ */
const _SESS_FOLDER_COLORS=['#ff8c42','#4ca5ff','#22d6a0','#b48bff','#f5c542','#ff6b85','#2ad6c0'];
let SESS_FOLDERS=[];        // [{id,name,color}]
let SESS_ASSIGN={};         // { [showId]: folderId }
let SESS_FOLDER_VIEW='all'; // 'all' | 'none' | folderId
let _sessFoldersLoadedFor=null;
function _sessKey(p){ return 'pf_sess_'+p+'_'+(ME&&ME.id||'anon'); }
function _loadSessFolders(){
  if(_sessFoldersLoadedFor===(ME&&ME.id)) return;
  try{ SESS_FOLDERS=JSON.parse(localStorage.getItem(_sessKey('folders'))||'[]')||[]; }catch(e){ SESS_FOLDERS=[]; }
  try{ SESS_ASSIGN=JSON.parse(localStorage.getItem(_sessKey('assign'))||'{}')||{}; }catch(e){ SESS_ASSIGN={}; }
  SESS_FOLDER_VIEW=localStorage.getItem(_sessKey('view'))||'all';
  if(!Array.isArray(SESS_FOLDERS)) SESS_FOLDERS=[];
  _sessFoldersLoadedFor=(ME&&ME.id)||null;
}
function _saveSessFolders(){ try{ localStorage.setItem(_sessKey('folders'),JSON.stringify(SESS_FOLDERS)); }catch(e){} }
function _saveSessAssign(){ try{ localStorage.setItem(_sessKey('assign'),JSON.stringify(SESS_ASSIGN)); }catch(e){} }
function _saveSessView(){ try{ localStorage.setItem(_sessKey('view'),SESS_FOLDER_VIEW); }catch(e){} }
function _sessFolderById(id){ return SESS_FOLDERS.find(function(f){return f.id===id;})||null; }
function _sessFolderOf(showId){ return SESS_ASSIGN[showId]||''; }
function _sessFolderCount(fid){
  /* Compte les shows visibles (possédés + partagés) assignés à ce dossier. */
  return (SHOWS||[]).filter(function(s){ return _sessFolderOf(s.id)===fid; }).length;
}

function createSessFolder(){
  _loadSessFolders();
  var name=prompt('Nom du dossier (ex. « Tournée 2024 », « Archives ») :','');
  if(name===null) return;
  name=name.trim();
  if(!name){ toast('Nom de dossier vide.'); return; }
  if(name.length>40) name=name.slice(0,40);
  var id='f_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  var color=_SESS_FOLDER_COLORS[SESS_FOLDERS.length%_SESS_FOLDER_COLORS.length];
  SESS_FOLDERS.push({id:id,name:name,color:color});
  _saveSessFolders();
  SESS_FOLDER_VIEW=id; _saveSessView();
  renderSessions();
  toast('✓ Dossier « '+name+' » créé');
}
function renameSessFolder(id){
  var f=_sessFolderById(id); if(!f) return;
  var name=prompt('Renommer le dossier :',f.name);
  if(name===null) return;
  name=name.trim(); if(!name){ toast('Nom vide.'); return; }
  f.name=name.slice(0,40); _saveSessFolders(); renderSessions();
}
function recolorSessFolder(id,color){
  var f=_sessFolderById(id); if(!f) return;
  f.color=color; _saveSessFolders(); renderSessions();
}
function deleteSessFolder(id){
  var f=_sessFolderById(id); if(!f) return;
  var n=_sessFolderCount(id);
  if(!confirm('Supprimer le dossier « '+f.name+' » ?'+(n?'\n\nLes '+n+' session'+(n>1?'s':'')+' reviennent à « Sans dossier » (rien n\'est supprimé).':''))) return;
  SESS_FOLDERS=SESS_FOLDERS.filter(function(x){return x.id!==id;});
  Object.keys(SESS_ASSIGN).forEach(function(sid){ if(SESS_ASSIGN[sid]===id) delete SESS_ASSIGN[sid]; });
  _saveSessFolders(); _saveSessAssign();
  if(SESS_FOLDER_VIEW===id){ SESS_FOLDER_VIEW='all'; _saveSessView(); }
  renderSessions();
  toast('Dossier supprimé');
}
function setSessFolderView(v){
  SESS_FOLDER_VIEW=v; _saveSessView(); _closeSessMoveMenu(); renderSessions();
}
function moveShowToFolder(showId,folderId){
  _loadSessFolders();
  if(folderId){ SESS_ASSIGN[showId]=folderId; } else { delete SESS_ASSIGN[showId]; }
  _saveSessAssign(); _closeSessMoveMenu(); renderSessions();
  var f=folderId?_sessFolderById(folderId):null;
  toast(f?('Déplacé vers « '+f.name+' »'):'Retiré du dossier');
}

/* Popover « Déplacer vers un dossier » ancré sur un bouton de carte. */
function _closeSessMoveMenu(){
  var m=document.getElementById('sess-move-menu'); if(m) m.remove();
  document.removeEventListener('click',_sessMoveMenuOutside,true);
}
function _sessMoveMenuOutside(e){
  var m=document.getElementById('sess-move-menu');
  if(m && !m.contains(e.target)) _closeSessMoveMenu();
}
function openSessMoveMenu(showId,btn,ev){
  if(ev){ ev.stopPropagation(); ev.preventDefault(); }
  _loadSessFolders();
  var existing=document.getElementById('sess-move-menu');
  if(existing){ _closeSessMoveMenu(); return; }
  var cur=_sessFolderOf(showId);
  var _e=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
  var items='<div class="sess-mm-hd">Déplacer vers…</div>';
  items+='<button class="sess-mm-item'+(!cur?' on':'')+'" onclick="moveShowToFolder(\''+showId+'\',\'\')"><i class="ti ti-inbox"></i>Sans dossier'+(!cur?'<i class="ti ti-check sess-mm-ck"></i>':'')+'</button>';
  SESS_FOLDERS.forEach(function(f){
    items+='<button class="sess-mm-item'+(cur===f.id?' on':'')+'" onclick="moveShowToFolder(\''+showId+'\',\''+f.id+'\')"><span class="sess-fdot" style="background:'+f.color+'"></span>'+_e(f.name)+(cur===f.id?'<i class="ti ti-check sess-mm-ck"></i>':'')+'</button>';
  });
  items+='<div class="sess-mm-sep"></div><button class="sess-mm-item" onclick="_closeSessMoveMenu();createSessFolder()"><i class="ti ti-folder-plus" style="color:var(--ora)"></i>Nouveau dossier…</button>';
  var menu=document.createElement('div');
  menu.id='sess-move-menu'; menu.className='sess-move-menu'; menu.innerHTML=items;
  document.body.appendChild(menu);
  var r=btn.getBoundingClientRect();
  var mw=210, mh=menu.offsetHeight;
  var left=Math.min(r.left, window.innerWidth-mw-10);
  var top=r.bottom+6; if(top+mh>window.innerHeight-10) top=Math.max(10,r.top-mh-6);
  menu.style.left=Math.max(10,left)+'px'; menu.style.top=top+'px';
  setTimeout(function(){ document.addEventListener('click',_sessMoveMenuOutside,true); },0);
}

/* Glisser-déposer d'une carte de session vers une puce de dossier. */
let _sessDragShowId=null;
function _sessDragStart(ev,showId){
  _sessDragShowId=showId;
  try{ ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain',showId); }catch(e){}
  var card=ev.target.closest&&ev.target.closest('.sess-card'); if(card) card.classList.add('sess-dragging');
}
function _sessDragEnd(ev){
  _sessDragShowId=null;
  var card=ev.target.closest&&ev.target.closest('.sess-card'); if(card) card.classList.remove('sess-dragging');
  document.querySelectorAll('.sess-fchip.drag-over').forEach(function(c){c.classList.remove('drag-over');});
}
function _sessChipDragOver(ev){ ev.preventDefault(); try{ev.dataTransfer.dropEffect='move';}catch(e){} ev.currentTarget.classList.add('drag-over'); }
function _sessChipDragLeave(ev){ ev.currentTarget.classList.remove('drag-over'); }
function _sessChipDrop(ev,folderId){
  ev.preventDefault(); ev.currentTarget.classList.remove('drag-over');
  var sid=_sessDragShowId||(ev.dataTransfer&&ev.dataTransfer.getData('text/plain'));
  if(sid) moveShowToFolder(sid,folderId);
}

function renderSessions(){
  const grid=document.getElementById('sessions-grid');
  if(!grid){ var _fb0=document.getElementById('sess-folder-bar'); if(_fb0)_fb0.innerHTML=''; return; }
  _loadSessFolders();

  const _e=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
  const AV_COLS=[
    {bg:'rgba(255,107,26,.15)',fg:'var(--ora)'},
    {bg:'rgba(26,143,255,.15)',fg:'var(--blu2)'},
    {bg:'rgba(245,197,66,.14)',fg:'var(--warn)'},
    {bg:'rgba(155,106,255,.13)',fg:'#c084fc'},
    {bg:'rgba(34,214,160,.13)',fg:'var(--grn)'},
  ];
  /* Monogramme déterministe (couleur + initiales) à partir du nom du show */
  const _MONO_PAL=[
    {bg:'rgba(255,107,26,.14)',fg:'#ff8c42',bd:'rgba(255,107,26,.32)'},
    {bg:'rgba(26,143,255,.14)',fg:'#4ca5ff',bd:'rgba(26,143,255,.32)'},
    {bg:'rgba(34,214,160,.13)',fg:'#22d6a0',bd:'rgba(34,214,160,.30)'},
    {bg:'rgba(155,106,255,.14)',fg:'#b48bff',bd:'rgba(155,106,255,.32)'},
    {bg:'rgba(245,197,66,.14)',fg:'#f5c542',bd:'rgba(245,197,66,.32)'},
    {bg:'rgba(255,77,106,.12)',fg:'#ff6b85',bd:'rgba(255,77,106,.30)'},
    {bg:'rgba(0,200,180,.12)',fg:'#2ad6c0',bd:'rgba(0,200,180,.30)'},
  ];
  function showMono(name){
    var s=String(name||'?').trim();
    var fa=function(w){var m=w.match(/[a-zA-ZÀ-ÿ]/);return m?m[0]:'';};
    var words=s.split(/\s+/).filter(function(w){return /[a-zA-ZÀ-ÿ]/.test(w);});
    var ini;
    if(words.length>=2) ini=fa(words[0])+fa(words[1]);
    else if(words.length===1) ini=(words[0].replace(/[^a-zA-ZÀ-ÿ]/g,'').slice(0,2))||words[0].slice(0,2);
    else ini=s.slice(0,2);
    ini=(ini||'?').toUpperCase();
    var h=0; for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return {ini:ini, c:_MONO_PAL[h%_MONO_PAL.length]};
  }

  function planChip(plan){
    var p=plan||'free';
    var labels={free:'Gratuit',pro:'Pro'};
    return '<span class="sess-plan-chip '+p+'">'+(labels[p]||p)+'</span>';
  }

  function initials(name){
    return String(name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase()||'?';
  }

  function renderMembersRow(show){
    var members=SHOW_MEMBERS_MAP[show.id]||[];
    var list=[];
    // Owner entry — toujours affiché, qu'on soit owner ou invité
    if(show.owner_id===ME?.id){
      list.push({init:initials(PROFILE?.full_name||ME.email),plan:PROFILE?.plan||'free',name:PROFILE?.full_name||'Moi',role:'Propriétaire',col:{bg:'var(--ora-d)',fg:'var(--ora)'}});
    } else {
      /* On est invité — chercher l'owner dans le cache si présent, sinon placeholder */
      var ownerCached=SHOW_OWNERS_CACHE[show.owner_id];
      var ownerName=ownerCached?.full_name||ownerCached?.email||'Propriétaire';
      list.push({init:initials(ownerName),plan:ownerCached?.plan||'free',name:ownerName,role:'Propriétaire',col:{bg:'var(--ora-d)',fg:'var(--ora)'}});
    }
    members.forEach(function(m,i){
      var n=m.profiles?.full_name||m.profiles?.email||'Membre';
      list.push({init:initials(n),plan:m.profiles?.plan||'free',name:n,role:m.role||'Membre',col:AV_COLS[i%AV_COLS.length]});
    });
    if(list.length===0) return '<span class="sess-no-members"><i class="ti ti-user" style="font-size:11px"></i> Solo</span>';
    var MAX=4;
    var visible=list.slice(0,MAX);
    var extra=list.length-MAX;
    var html=visible.map(function(m){
      return '<div class="sess-member-wrap" title="'+_e(m.name)+' · '+_e(m.role)+'">'+
        '<div class="sess-av" style="background:'+m.col.bg+';color:'+m.col.fg+'">'+_e(m.init)+'</div>'+
        '<div class="sess-member-name">'+_e(m.name.split(' ')[0])+'</div>'+
        planChip(m.plan)+
        '</div>';
    }).join('');
    if(extra>0) html+='<div class="sess-member-wrap"><div class="sess-more-av">+'+extra+'</div></div>';
    return html;
  }

  function renderCard(s, idx){
    var isActive=s.id===CUR_SHOW?.id;
    var isOwn=s.owner_id===ME?.id;
    var members=SHOW_MEMBERS_MAP[s.id]||[];
    /* Total = owner + all members (owner is never in show_members table) */
    var totalMembers=members.length+1;
    var chCount=isActive?CHS.length:'—';
    var mono=showMono(s.name);
    var _fid=_sessFolderOf(s.id); var _fold=_fid?_sessFolderById(_fid):null;
    return '<div class="sess-card'+(isActive?' active':'')+'" draggable="true" ondragstart="_sessDragStart(event,\''+s.id+'\')" ondragend="_sessDragEnd(event)" onclick="sessionSwitch(\''+s.id+'\')">'+
      (isActive?'<div class="sess-stripe"></div>':'')+
      '<div class="sess-body">'+
        '<div class="sess-top">'+
          '<div class="sess-icon-wrap sess-mono" style="background:'+mono.c.bg+';border-color:'+mono.c.bd+';color:'+mono.c.fg+'">'+_e(mono.ini)+'</div>'+
          '<div class="sess-title-wrap">'+
            '<div class="sess-name">'+_e(s.name)+'</div>'+
            '<div class="sess-venue">'+(s.venue?_e(s.venue):'<span style="color:var(--muted2);font-style:italic">Venue non renseignée</span>')+'</div>'+
          '</div>'+
          (isActive?'<span style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--grn);font-family:var(--m);font-weight:700;flex-shrink:0;margin-top:2px"><span class="on-dot"></span>Actif</span>':'')+
        '</div>'+
        '<div class="sess-tags">'+
          (s.show_date?'<span class="sess-tag"><i class="ti ti-calendar" style="font-size:9px"></i>'+_e(s.show_date)+'</span>':'')+
          '<span class="sess-tag'+(isActive?' active':'')+'"><i class="ti ti-list" style="font-size:9px"></i>'+chCount+' canaux</span>'+
          '<span class="sess-tag"><i class="ti ti-users" style="font-size:9px"></i>'+totalMembers+' membre'+(totalMembers!==1?'s':'')+'</span>'+
          (SHOW_STORAGE_MAP[s.id]?'<span class="sess-tag"><i class="ti ti-cloud" style="font-size:9px"></i>'+_fmtSize(SHOW_STORAGE_MAP[s.id])+'</span>':'')+
          (!isOwn?'<span class="sess-tag" style="border-color:rgba(26,143,255,.3);color:var(--blu2)"><i class="ti ti-share" style="font-size:9px"></i>Partagé</span>':'')+
          (_fold?'<span class="sess-folder-pill"><span class="sess-fdot" style="background:'+_fold.color+'"></span>'+_e(_fold.name)+'</span>':'')+
        '</div>'+
        '<div class="sess-members-row">'+renderMembersRow(s)+'</div>'+
      '</div>'+
      '<div class="sess-footer">'+
        '<button class="sess-open-btn" onclick="event.stopPropagation();sessionSwitch(\''+s.id+'\')">'+(isActive?'<i class="ti ti-check"></i> Actif':'Ouvrir')+'</button>'+
        '<button class="sess-icon-btn'+(_fold?' has-folder':'')+'" onclick="event.stopPropagation();openSessMoveMenu(\''+s.id+'\',this,event)" title="Classer dans un dossier"'+(_fold?' style="color:'+_fold.color+';border-color:'+_fold.color+'55"':'')+'><i class="ti ti-folder"></i></button>'+
        (isOwn?'<button class="sess-icon-btn" onclick="event.stopPropagation();editShowMeta(\''+s.id+'\')" title="Modifier"><i class="ti ti-pencil"></i></button>':'')+
        (isOwn?'<button class="sess-icon-btn danger" onclick="event.stopPropagation();delShow(\''+s.id+'\')" title="Supprimer"><i class="ti ti-trash"></i></button>':'')+
        (!isOwn?'<button class="sess-icon-btn" onclick="leaveShow(\''+s.id+'\',event)" title="Quitter ce show" style="color:var(--muted)" onmouseover="this.style.color=\'var(--err)\';this.style.borderColor=\'rgba(255,77,106,.3)\'" onmouseout="this.style.color=\'var(--muted)\';this.style.borderColor=\'\'"><i class="ti ti-door-exit"></i></button>':'')+
      '</div>'+
    '</div>';
  }

  if(SHOWS.length===0){
    var _fbe=document.getElementById('sess-folder-bar'); if(_fbe)_fbe.innerHTML='';
    grid.innerHTML='<div style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--muted)"><i class="ti ti-folder-plus" style="font-size:36px;display:block;margin-bottom:12px;opacity:.4"></i><div style="font-size:13px;margin-bottom:14px">Aucune session — commencez ici</div><button class="btn" onclick="newShow()"><i class="ti ti-plus"></i>Créer un show</button></div>';
    return;
  }

  /* ── Recherche + tri ── */
  var q=(document.getElementById('sess-search-inp')?.value||'').trim().toLowerCase();
  var sortBy=document.getElementById('sess-sort')?.value||'recent';
  function matches(s){
    if(!q) return true;
    return String(s.name||'').toLowerCase().indexOf(q)>=0
        || String(s.venue||'').toLowerCase().indexOf(q)>=0;
  }
  function sortFn(a,b){
    if(sortBy==='az') return String(a.name||'').localeCompare(String(b.name||''),'fr');
    if(sortBy==='date') return String(b.show_date||'').localeCompare(String(a.show_date||''));
    return String(b.created_at||b.id||'').localeCompare(String(a.created_at||a.id||'')); // récents
  }

  /* Filtre par dossier (ignoré pendant une recherche : la recherche est globale). */
  var inFolder=function(s){
    if(q) return true;
    if(SESS_FOLDER_VIEW==='all') return true;
    if(SESS_FOLDER_VIEW==='none') return !_sessFolderOf(s.id);
    return _sessFolderOf(s.id)===SESS_FOLDER_VIEW;
  };
  var myShows=SHOWS.filter(function(s){return s.owner_id===ME?.id;}).filter(matches).filter(inFolder).sort(sortFn);
  var sharedShows=SHOWS.filter(function(s){return s.owner_id!==ME?.id;}).filter(matches).filter(inFolder).sort(sortFn);

  /* ── Barre des dossiers (puces) ── */
  (function(){
    var fb=document.getElementById('sess-folder-bar'); if(!fb) return;
    var allCount=SHOWS.length;
    var noneCount=SHOWS.filter(function(s){return !_sessFolderOf(s.id);}).length;
    var bar='';
    bar+='<button class="sess-fchip'+(SESS_FOLDER_VIEW==='all'?' on':'')+'" onclick="setSessFolderView(\'all\')"><i class="ti ti-stack-2" style="font-size:13px"></i>Toutes<span class="sess-fcount">'+allCount+'</span></button>';
    SESS_FOLDERS.forEach(function(f){
      bar+='<button class="sess-fchip'+(SESS_FOLDER_VIEW===f.id?' on':'')+'" data-folder="'+f.id+'" ondragover="_sessChipDragOver(event)" ondragleave="_sessChipDragLeave(event)" ondrop="_sessChipDrop(event,\''+f.id+'\')" onclick="setSessFolderView(\''+f.id+'\')"><span class="sess-fdot" style="background:'+f.color+'"></span>'+_e(f.name)+'<span class="sess-fcount">'+_sessFolderCount(f.id)+'</span></button>';
    });
    if(SESS_FOLDERS.length){
      bar+='<button class="sess-fchip'+(SESS_FOLDER_VIEW==='none'?' on':'')+'" data-folder="" ondragover="_sessChipDragOver(event)" ondragleave="_sessChipDragLeave(event)" ondrop="_sessChipDrop(event,\'\')" onclick="setSessFolderView(\'none\')"><i class="ti ti-inbox" style="font-size:12px"></i>Sans dossier<span class="sess-fcount">'+noneCount+'</span></button>';
    }
    bar+='<button class="sess-fchip-new" onclick="createSessFolder()"><i class="ti ti-folder-plus" style="font-size:13px"></i>Dossier</button>';
    var curF=(SESS_FOLDER_VIEW!=='all'&&SESS_FOLDER_VIEW!=='none')?_sessFolderById(SESS_FOLDER_VIEW):null;
    if(curF){
      bar+='<span class="sess-fbar-colors">'+_SESS_FOLDER_COLORS.map(function(c){return '<span class="sess-fcolor" style="background:'+c+(curF.color===c?';border-color:#fff':'')+'" title="Couleur du dossier" onclick="recolorSessFolder(\''+curF.id+'\',\''+c+'\')"></span>';}).join('')+'</span>';
      bar+='<span class="sess-fbar-tools"><button onclick="renameSessFolder(\''+curF.id+'\')" title="Renommer le dossier"><i class="ti ti-pencil"></i></button><button class="danger" onclick="deleteSessFolder(\''+curF.id+'\')" title="Supprimer le dossier"><i class="ti ti-trash"></i></button></span>';
    }
    fb.innerHTML=bar;
  })();

  /* Aucun résultat de recherche */
  if(q && myShows.length===0 && sharedShows.length===0){
    grid.innerHTML='<div class="sess-empty-search"><i class="ti ti-search-off" style="font-size:30px;display:block;margin-bottom:10px;opacity:.4"></i>Aucun show ne correspond à « '+_e(q)+' »</div>';
    return;
  }

  function sectionCount(n){
    return '<span style="background:var(--surf2);border:1px solid var(--bdr2);border-radius:10px;padding:0 7px;font-size:9px;color:var(--muted);font-weight:400">'+n+'</span>';
  }

  var html='';
  var curF2=(SESS_FOLDER_VIEW!=='all'&&SESS_FOLDER_VIEW!=='none')?_sessFolderById(SESS_FOLDER_VIEW):null;
  var folderMode=!q && SESS_FOLDER_VIEW!=='all';

  if(folderMode){
    /* Vue d'un dossier précis (ou « Sans dossier ») : grille unique. */
    var combined=myShows.concat(sharedShows);
    var ftitle=curF2
      ?'<span class="sess-fdot" style="background:'+curF2.color+'"></span>'+_e(curF2.name)
      :'<i class="ti ti-inbox" style="color:var(--muted);font-size:11px"></i>Sans dossier';
    html+='<div class="sess-section-title">'+ftitle+sectionCount(combined.length)+'</div>';
    if(combined.length===0){
      html+='<div style="grid-column:1/-1;color:var(--muted2);font-size:12px;padding:30px 6px;text-align:center"><i class="ti ti-folder-open" style="font-size:30px;display:block;margin-bottom:10px;opacity:.4"></i>'+(curF2?'Dossier vide — glissez des sessions ici, ou via le bouton <i class="ti ti-folder"></i> d\'une carte.':'Toutes vos sessions sont classées dans un dossier.')+'</div>';
    } else {
      combined.forEach(function(s,i){ html+=renderCard(s,i); });
    }
  } else {
    // ── Mes sessions
    html+='<div class="sess-section-title"><i class="ti ti-folder" style="color:var(--ora);font-size:11px"></i>Mes sessions'+sectionCount(myShows.length)+'</div>';
    if(myShows.length===0){
      html+='<div style="grid-column:1/-1;color:var(--muted2);font-size:11px;font-family:var(--m);padding:6px 2px">'+(q?'Aucun résultat ici.':'Aucun show. <button class="btn sm" onclick="newShow()" style="margin-left:6px"><i class="ti ti-plus"></i>Créer</button>')+'</div>';
    } else {
      myShows.forEach(function(s,i){ html+=renderCard(s,i); });
    }
    // ── Partagées avec moi
    if(sharedShows.length>0){
      html+='<div class="sess-section-title" style="margin-top:8px"><i class="ti ti-users" style="color:var(--blu2);font-size:11px"></i>Partagées avec moi'+sectionCount(sharedShows.length)+'</div>';
      sharedShows.forEach(function(s,i){ html+=renderCard(s,myShows.length+i); });
    }
  }

  grid.innerHTML=html;
}

async function sessionSwitch(id){
  await switchShow(id);
  renderSessions();
  // Switch to Input List
  goTab('inputlist',[...document.querySelectorAll('.tab')].find(t=>t.getAttribute('onclick')?.includes("'inputlist'")));
  toast(`✓ Show chargé`);
}

// ══════════════════════════════════════
// CABLE TYPE MODAL
// ══════════════════════════════════════
/* id de la liaison en cours d'édition (null = création d'un nouveau type) */
let _editingCableId = null;
/* Ouvre la modale pour RENOMMER / RECOLORIER une liaison (Pro). */
function editCableType(id){
  if(typeof userPlan==='function' && userPlan()!=='pro'){ if(typeof showUpgradeModal==='function') showUpgradeModal('multi_patches'); return; }
  var meta = (typeof SitePlan!=='undefined' && SitePlan.cableMeta) ? SitePlan.cableMeta(id) : null;
  if(!meta){ toast('Liaison introuvable.'); return; }
  openCableTypeModal({ id:id, label:meta.label||'', color:meta.color||'#44bbff', dash:meta.dash||'' });
}
function openCableTypeModal(edit) {
  const m = document.getElementById('cable-type-modal');
  if(!m) return;
  const isEdit = edit && edit.id;
  _editingCableId = isEdit ? edit.id : null;
  const lbl = document.getElementById('nct-label');
  const col  = document.getElementById('nct-color');
  const hex  = document.getElementById('nct-color-hex');
  const dash = document.getElementById('nct-dash');
  const initColor = isEdit ? (/^#[0-9a-fA-F]{6}$/.test(edit.color)?edit.color:'#44bbff') : '#44bbff';
  if(lbl)  lbl.value  = isEdit ? edit.label : '';
  if(col)  col.value  = initColor;
  if(hex)  hex.value  = initColor;
  if(dash) dash.value = isEdit ? (edit.dash||'') : '';
  const ttl = document.getElementById('nct-title'); if(ttl) ttl.textContent = isEdit ? 'Modifier la liaison' : 'Nouveau type de cable';
  const sbtn = document.getElementById('nct-save-btn'); if(sbtn) sbtn.innerHTML = '<i class="ti ti-check"></i>'+(isEdit?'Enregistrer':'Ajouter');
  _nctUpdatePreview();
  m.classList.add('show');
  setTimeout(function(){ if(lbl) lbl.focus(); }, 80);

  // Wire live preview
  [lbl, col, hex, dash].forEach(function(el) {
    if(el) el.addEventListener('input', _nctUpdatePreview);
  });
  // Sync color picker <-> hex input
  if(col) col.addEventListener('input', function() {
    if(hex) hex.value = col.value;
    _nctUpdatePreview();
  });
  if(hex) hex.addEventListener('input', function() {
    if(/^#[0-9a-fA-F]{6}$/.test(hex.value) && col) col.value = hex.value;
    _nctUpdatePreview();
  });
  // Enter key saves
  if(lbl) lbl.addEventListener('keydown', function(e) { if(e.key==='Enter') saveNewCableType(); });
}

function _nctUpdatePreview() {
  const lbl  = document.getElementById('nct-label');
  const col  = document.getElementById('nct-color');
  const dash = document.getElementById('nct-dash');
  const line = document.getElementById('nct-preview-line');
  const plbl = document.getElementById('nct-preview-label');
  const color = (col && /^#[0-9a-fA-F]{6}$/.test(col.value)) ? col.value : '#44bbff';
  const dashVal = dash ? dash.value : '';
  if(line) {
    line.setAttribute('stroke', color);
    if(dashVal) line.setAttribute('stroke-dasharray', dashVal);
    else line.removeAttribute('stroke-dasharray');
  }
  if(plbl) plbl.textContent = (lbl && lbl.value.trim()) ? lbl.value.trim() : 'Apercu';
  if(plbl) plbl.style.color = color;
}

function closeCableTypeModal() {
  const m = document.getElementById('cable-type-modal');
  if(m) m.classList.remove('show');
}

function saveNewCableType() {
  const lbl  = document.getElementById('nct-label');
  const col  = document.getElementById('nct-color');
  const hex  = document.getElementById('nct-color-hex');
  const dash = document.getElementById('nct-dash');
  const label = (lbl ? lbl.value.trim() : '');
  if(!label) { if(lbl){ lbl.style.outline='2px solid var(--err)'; setTimeout(function(){lbl.style.outline='';},1200); } return; }
  const rawColor = (hex && /^#[0-9a-fA-F]{6}$/.test(hex.value)) ? hex.value : (col ? col.value : '#44bbff');
  const dashVal  = dash ? dash.value : '';
  /* Mode édition : on met à jour la liaison existante (renommer / recolorier). */
  if(_editingCableId){
    if(typeof SitePlan !== 'undefined' && SitePlan.updateCableType){
      SitePlan.updateCableType(_editingCableId, { label:label, color:rawColor, dash:dashVal });
    }
    _editingCableId = null;
    closeCableTypeModal();
    toast('✓ Liaison "' + label + '" mise à jour');
    return;
  }
  const id = 'custom_' + Date.now().toString(36);
  const newType = { id:id, label:label, color:rawColor, dash:dashVal, builtin:false };
  if(typeof SitePlan !== 'undefined' && SitePlan.addCustomCableType) {
    SitePlan.addCustomCableType(newType);
    SitePlan.setActiveCableType(id);
  }
  closeCableTypeModal();
  toast('✓ Type "' + label + '" ajoute');
}

async function editShowMeta(id){
  const show=SHOWS.find(s=>s.id===id);if(!show)return;
  const name=prompt('Nom du show :',show.name);if(!name?.trim())return;
  const venue=prompt('Venue :',show.venue||'');
  const date=prompt('Date (ex: 15/05/2025) :',show.show_date||'');
  const {error}=await sb.from('shows').update({name:name.trim(),venue:venue||null,show_date:date||null}).eq('id',id);
  if(error){toast('Erreur : '+error.message);return;}
  const s=SHOWS.find(x=>x.id===id);if(s){s.name=name.trim();s.venue=venue;s.show_date=date;}
  renderSessions();renderSPShows();
  if(CUR_SHOW?.id===id){CUR_SHOW.name=name.trim();document.getElementById('cur-show-name').textContent=name.trim();['il','sf','stage','team'].forEach(k=>{const el=document.getElementById('sn-'+k);if(el)el.textContent=name.trim();});}
  toast('✓ Show mis à jour');
}

// ══════════════════════════════════════
// TEMPLATES — Quick bar in Input List
// ══════════════════════════════════════
let TPL_MODE='replace'; // 'replace' | 'append'

function setTplMode(mode){
  TPL_MODE=mode;
  document.getElementById('tpl-mode-replace').classList.toggle('active',mode==='replace');
  document.getElementById('tpl-mode-append').classList.toggle('active',mode==='append');
}

function toggleTplDd(e){
  e.stopPropagation();
  const menu=document.getElementById('tpl-dd-menu');
  const open=menu.classList.toggle('open');
  if(open){renderTplQuickBar();document.addEventListener('click',closeTplDd,{once:true});}
}
function closeTplDd(){document.getElementById('tpl-dd-menu')?.classList.remove('open');}
document.addEventListener('click',e=>{if(!document.getElementById('tpl-dd-wrap')?.contains(e.target))closeTplDd();});

function renderTplQuickBar(){
  const el=document.getElementById('tpl-quick-list');if(!el)return;
  const all=[...BLTPLS,...USER_TPLS];
  if(!all.length){el.innerHTML='<div style="font-size:11px;color:var(--muted);padding:4px 2px">Aucun template</div>';return;}
  const _et=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  el.innerHTML=all.map(t=>`
    <button class="tpl-dd-item" onclick="applyTemplate('${_et(t.id)}');closeTplDd()">
      <span style="font-size:14px">${/^\p{Emoji}/u.test(t.icon||'')?_et(t.icon):'📋'}</span>${_et(t.name)}<span style="font-family:var(--m);font-size:9px;color:var(--muted);margin-left:auto">${(t.channels||[]).length} CH</span>
    </button>`).join('');
}

async function applyTemplate(tplId){
  // Find template
  const tpl=[...BLTPLS,...USER_TPLS].find(t=>t.id===tplId);
  if(!tpl){toast('Template introuvable.');return;}
  if(!CUR_SHOW){toast('Aucun show actif.');return;}

  let chs=tpl.channels||[];
  if(chs.length===0){toast('Ce template est vide.');return;}

  const msg=TPL_MODE==='replace'
    ?`Remplacer les ${CHS.length} canaux actuels par "${tpl.name}" (${chs.length} canaux) ?`
    :`Ajouter les ${chs.length} canaux de "${tpl.name}" à la suite ?`;
  if(!confirm(msg))return;

  if(TPL_MODE==='replace'){
    const ids=CHS.map(r=>r.id);
    if(ids.length){const {error:de}=await sb.from('channels').delete().in('id',ids);if(de){toast('Erreur suppression : '+de.message);return;}}
    CHS=[];
  }

  /* ── Enforce plan channel limit ── */
  {
    const limit = planLimit('max_channels');
    if (limit !== Infinity) {
      const baseCount = CHS.length; /* CHS already empty after replace */
      const totalChs = chs.length;
      const projected = baseCount + totalChs;
      if (projected > limit) {
        const available = limit - baseCount;
        if (available <= 0) { showUpgradeModal('max_channels'); return; }
        chs = chs.slice(0, available);
        toast('⚠️ Plan Gratuit : limite de ' + limit + ' canaux — ' + available + ' sur ' + totalChs + ' canaux du template chargés. Passez Pro pour des canaux illimités.');
      }
    }
  }

  const offset=CHS.length;
  const toInsert=chs.map((r,i)=>{
    const row={
      show_id:CUR_SHOW.id,
      ch:offset+i+1,
      short_name:r.short_name||'',
      long_name:r.long_name||'',
      source:r.source||'',
      mic:r.mic||'',
      gain:r.gain||0,
      phantom:!!r.phantom,
      iem_group:r.iem_group||'',
      foh:!!r.foh,
      mon:!!r.mon,
      bc:!!r.bc,
      note:r.note||'',
    };
    if(_patchColReady) row.patch_id=CUR_PATCH_ID;
    return row;
  });

  const {data,error}=await sb.from('channels').insert(toInsert).select();
  if(error){toast('Erreur Supabase : '+error.message);console.error(error);return;}

  CHS=[...CHS,...(data||[])].sort((a,b)=>a.ch-b.ch);
  renderTable();
  toast(`✓ "${tpl.name}" appliqué — ${chs.length} canaux chargés`);
}


function toggleSP(){const p=document.getElementById('side-panel');p.classList.contains('show')?closeSP():openSP();}
function openSP(){
  document.getElementById('side-panel').classList.add('show');
  document.getElementById('sp-ov').classList.add('show');
  renderSPShows();
  /* État loading pendant le refresh, puis rendu unique avec data fraîche */
  var el=document.getElementById('sp-notif');
  if(el) el.innerHTML='<div style="font-size:10px;color:var(--muted);padding:8px 2px;display:flex;align-items:center;gap:7px"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite;font-size:13px"></i>Chargement…</div>';
  refreshNotifications().then(loadNotifications);
}
function closeSP(){document.getElementById('side-panel').classList.remove('show');document.getElementById('sp-ov').classList.remove('show');closePrev();}
function _fmtShowDate(d){
  if(!d)return '';
  try{
    var dt=new Date(d);
    return dt.toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
  }catch(e){return d;}
}
function renderSPShows(){
  const el=document.getElementById('sp-shows');if(!el)return;
  if(SHOWS.length===0){el.innerHTML='<div style="font-size:10px;color:var(--muted);padding:4px 0">Aucun show.</div>';return;}
  const _e2=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const _MP=[['rgba(255,107,26,.14)','#ff8c42','rgba(255,107,26,.32)'],['rgba(26,143,255,.14)','#4ca5ff','rgba(26,143,255,.32)'],['rgba(34,214,160,.13)','#22d6a0','rgba(34,214,160,.30)'],['rgba(155,106,255,.14)','#b48bff','rgba(155,106,255,.32)'],['rgba(245,197,66,.14)','#f5c542','rgba(245,197,66,.32)'],['rgba(255,77,106,.12)','#ff6b85','rgba(255,77,106,.30)'],['rgba(0,200,180,.12)','#2ad6c0','rgba(0,200,180,.30)']];
  const _mono=n=>{var s=String(n||'?').trim();var fa=w=>{var m=w.match(/[a-zA-ZÀ-ÿ]/);return m?m[0]:'';};var w=s.split(/\s+/).filter(x=>/[a-zA-ZÀ-ÿ]/.test(x));var ini=w.length>=2?(fa(w[0])+fa(w[1])):(w.length===1?(w[0].replace(/[^a-zA-ZÀ-ÿ]/g,'').slice(0,2)||w[0].slice(0,2)):s.slice(0,2));ini=(ini||'?').toUpperCase();var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return {ini:ini,c:_MP[h%_MP.length]};};
  el.innerHTML=SHOWS.map((s,i)=>{
    var isCur=s.id===CUR_SHOW?.id;
    var meta=[s.venue,_fmtShowDate(s.show_date)].filter(Boolean).join(' · ')||'Pas de lieu';
    var chCount=isCur&&CHS.length?`<span style="font-size:9px;font-family:var(--m);background:var(--ora-d);color:var(--ora);border:1px solid rgba(255,107,26,.2);border-radius:4px;padding:0 5px;margin-left:4px">${CHS.length} CH</span>`:'';
    var mo=_mono(s.name);
    return `<div class="sp-show ${isCur?'active':''}" onclick="spSwitch('${_e2(s.id)}')" style="${isCur?'border-left:2px solid var(--ora);padding-left:10px':''}">
      <div class="sp-show-ico" style="background:${mo.c[0]};border-color:${mo.c[2]};color:${mo.c[1]};font-family:var(--m);font-weight:700;font-size:11px;letter-spacing:.3px">${_e2(mo.ini)}</div>
      <div style="flex:1;min-width:0">
        <div class="sp-show-name" style="display:flex;align-items:center;gap:3px">${_e2(s.name)}${chCount}</div>
        <div class="sp-show-meta">${_e2(meta)}</div>
      </div>
      <button class="sp-show-del" onclick="delShow('${_e2(s.id)}',event)"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('');
}
async function spSwitch(id){await switchShow(id);closeSP();}

// Templates
const BLTPLS=[
  {id:'rock_full',icon:'🎸',name:'Rock Band',desc:'Kit complet, basse, 2 guitares, claviers, 3 voix, playback',channels:[
    {ch:1,short_name:'KCKI',long_name:'Kick In',source:'Batterie',mic:'Beta 91A',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:'Gate'},
    {ch:2,short_name:'KCKO',long_name:'Kick Out',source:'Batterie',mic:'Beta 52A',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:3,short_name:'SNRT',long_name:'Snare Top',source:'Batterie',mic:'SM57',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:4,short_name:'SNRB',long_name:'Snare Bot',source:'Batterie',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Phase inv.'},
    {ch:5,short_name:'TOM1',long_name:'Tom 1',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:6,short_name:'TOM2',long_name:'Tom 2',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:7,short_name:'FLTR',long_name:'Floor Tom',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:8,short_name:'HIHT',long_name:'Hi-Hat',source:'Batterie',mic:'KSM137',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:9,short_name:'OHL',long_name:'Overhead L',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:false,bc:false,note:''},
    {ch:10,short_name:'OHR',long_name:'Overhead R',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:false,bc:false,note:''},
    {ch:11,short_name:'BASS',long_name:'Basse DI',source:'Basse',mic:'Radial JDI',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:12,short_name:'GTR1',long_name:'Guitare 1',source:'Guitare',mic:'SM57',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:13,short_name:'GTR2',long_name:'Guitare 2',source:'Guitare',mic:'SM57',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:''},
    {ch:14,short_name:'KYL',long_name:'Claviers L',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:15,short_name:'KYR',long_name:'Claviers R',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:16,short_name:'VOX',long_name:'Voix Lead',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Comp + Lim'},
    {ch:17,short_name:'BV1',long_name:'Backing Vox 1',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:18,short_name:'BV2',long_name:'Backing Vox 2',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:''},
    {ch:19,short_name:'CLK',long_name:'Click',source:'Playback',mic:'DI',gain:0,phantom:false,iem_group:'GR1',foh:false,mon:true,bc:false,note:'IEM only'},
    {ch:20,short_name:'PBTL',long_name:'Playback L',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Ableton'},
    {ch:21,short_name:'PBTR',long_name:'Playback R',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Ableton'},
  ]},
  {id:'pop_prod',icon:'🎤',name:'Pop / Production',desc:'Voix, musiciens, tracks Ableton',channels:[
    {ch:1,short_name:'VOX',long_name:'Voix Lead',source:'Chant',mic:'Beta 87A',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Comp + De-ess'},
    {ch:2,short_name:'BV1',long_name:'Backing Vox 1',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:3,short_name:'BV2',long_name:'Backing Vox 2',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:4,short_name:'GTR',long_name:'Guitare DI',source:'Guitare',mic:'Radial JDI',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:5,short_name:'BASS',long_name:'Basse DI',source:'Basse',mic:'Radial JDI',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:6,short_name:'KYL',long_name:'Claviers L',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:7,short_name:'KYR',long_name:'Claviers R',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:8,short_name:'CLK',long_name:'Click',source:'Playback',mic:'DI',gain:0,phantom:false,iem_group:'GR1',foh:false,mon:true,bc:false,note:'IEM only'},
    {ch:9,short_name:'TRSL',long_name:'Tracks Stems L',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:true,note:'Ableton'},
    {ch:10,short_name:'TRSR',long_name:'Tracks Stems R',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:true,note:'Ableton'},
    {ch:11,short_name:'DRML',long_name:'Drums Tracks L',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:false,note:'Ableton'},
    {ch:12,short_name:'DRMR',long_name:'Drums Tracks R',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:false,note:'Ableton'},
  ]},
  {id:'jazz_acoustic',icon:'🎷',name:'Jazz / Acoustique',desc:'Piano, contrebasse, batterie legere, voix',channels:[
    {ch:1,short_name:'PNOL',long_name:'Piano L',source:'Piano',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:2,short_name:'PNOR',long_name:'Piano R',source:'Piano',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:3,short_name:'CBAS',long_name:'Contrebasse DI',source:'Contrebasse',mic:'Radial JDI',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:4,short_name:'SNRE',long_name:'Snare',source:'Batterie',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:5,short_name:'OHL',long_name:'Overhead L',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:6,short_name:'OHR',long_name:'Overhead R',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:7,short_name:'VOX',long_name:'Voix',source:'Chant',mic:'SM7B',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:'Comp doux'},
    {ch:8,short_name:'GTR',long_name:'Guitare acoustique',source:'Guitare',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:9,short_name:'SAX',long_name:'Saxophone',source:'Cuivres',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:true,bc:false,note:''},
    {ch:10,short_name:'TPTS',long_name:'Trompette',source:'Cuivres',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:true,bc:false,note:'Attenuateur'},
  ]},
  {id:'dj_full',icon:'🎧',name:'DJ Set',desc:'Console DJ, booth, MC, effets',channels:[
    {ch:1,short_name:'DJL',long_name:'DJ Sortie Main L',source:'DJ',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:''},
    {ch:2,short_name:'DJR',long_name:'DJ Sortie Main R',source:'DJ',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:''},
    {ch:3,short_name:'BTHL',long_name:'Booth Monitor L',source:'DJ',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:false,mon:true,bc:false,note:'Retour DJ'},
    {ch:4,short_name:'BTHR',long_name:'Booth Monitor R',source:'DJ',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:false,mon:true,bc:false,note:'Retour DJ'},
    {ch:5,short_name:'MC',long_name:'Micro MC / Voix',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:'Gate doux'},
    {ch:6,short_name:'FXRL',long_name:'FX Return L',source:'Effets',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:7,short_name:'FXRR',long_name:'FX Return R',source:'Effets',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
  ]},
  {id:'theatre_musical',icon:'🎭',name:'Theatre / Comedie musicale',desc:'HF comediens, fosse, regie',channels:[
    {ch:1,short_name:'HF01',long_name:'HF Comedien 1',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:2,short_name:'HF02',long_name:'HF Comedien 2',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:3,short_name:'HF03',long_name:'HF Comedien 3',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:4,short_name:'HF04',long_name:'HF Comedien 4',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:5,short_name:'HF05',long_name:'HF Comedien 5',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:6,short_name:'HF06',long_name:'HF Comedien 6',source:'Chant',mic:'DPA 4061',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:false,bc:true,note:'Lavalier'},
    {ch:7,short_name:'FSSL',long_name:'Fosse Orchestre L',source:'Orchestre',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Sub-mix'},
    {ch:8,short_name:'FSSR',long_name:'Fosse Orchestre R',source:'Orchestre',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Sub-mix'},
    {ch:9,short_name:'AMBL',long_name:'Ambiance Scene L',source:'Scene',mic:'DPA 4006',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:10,short_name:'AMBR',long_name:'Ambiance Scene R',source:'Scene',mic:'DPA 4006',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:11,short_name:'PBTL',long_name:'Playback QLab L',source:'Playback',mic:'DI',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:'QLab'},
    {ch:12,short_name:'PBTR',long_name:'Playback QLab R',source:'Playback',mic:'DI',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:'QLab'},
    {ch:13,short_name:'IFB',long_name:'IFB Regie',source:'Technique',mic:'DI',gain:0,phantom:false,iem_group:'',foh:false,mon:true,bc:false,note:'Retour regie'},
    {ch:14,short_name:'CHEF',long_name:'Retour chef orchestre',source:'Technique',mic:'DI',gain:0,phantom:false,iem_group:'',foh:false,mon:true,bc:false,note:'Mix special'},
  ]},
  {id:'corporate',icon:'🏢',name:'Corporate / Conference',desc:'Presentateurs, intervenants, AV',channels:[
    {ch:1,short_name:'PRES',long_name:'Presentateur principal',source:'Parole',mic:'DPA 4088 HF',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:'HF cravate'},
    {ch:2,short_name:'INT1',long_name:'Intervenant 1',source:'Parole',mic:'DPA 4088 HF',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'HF main'},
    {ch:3,short_name:'INT2',long_name:'Intervenant 2',source:'Parole',mic:'DPA 4088 HF',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:4,short_name:'INT3',long_name:'Intervenant 3',source:'Parole',mic:'DPA 4088 HF',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:5,short_name:'TAB1',long_name:'Table micro col 1',source:'Parole',mic:'Shure MX418',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Col de cygne'},
    {ch:6,short_name:'TAB2',long_name:'Table micro col 2',source:'Parole',mic:'Shure MX418',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Col de cygne'},
    {ch:7,short_name:'PCL',long_name:'Laptop Presentation L',source:'Laptop',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:'HDMI / Jack'},
    {ch:8,short_name:'PCR',long_name:'Laptop Presentation R',source:'Laptop',mic:'DI Stereo',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:true,note:'HDMI / Jack'},
  ]},
  {id:'festival',icon:'🎪',name:'Festival / Grande scene',desc:'Rider complet multi-artiste, 24 CH',channels:[
    {ch:1,short_name:'KCKI',long_name:'Kick In',source:'Batterie',mic:'Beta 91A',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:'Gate'},
    {ch:2,short_name:'KCKO',long_name:'Kick Out',source:'Batterie',mic:'Beta 52A',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:3,short_name:'SNRT',long_name:'Snare Top',source:'Batterie',mic:'SM57',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:false,note:''},
    {ch:4,short_name:'SNRB',long_name:'Snare Bot',source:'Batterie',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Phase inv.'},
    {ch:5,short_name:'TOM1',long_name:'Tom 1',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:6,short_name:'TOM2',long_name:'Tom 2',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:7,short_name:'FLTR',long_name:'Floor Tom',source:'Batterie',mic:'MD421',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Gate'},
    {ch:8,short_name:'OHL',long_name:'Overhead L',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:false,bc:false,note:''},
    {ch:9,short_name:'OHR',long_name:'Overhead R',source:'Batterie',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:false,bc:false,note:''},
    {ch:10,short_name:'BASS',long_name:'Basse DI',source:'Basse',mic:'Radial JDI',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:11,short_name:'BASC',long_name:'Basse Cabinet',source:'Basse',mic:'Beta 52A',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:false,bc:false,note:''},
    {ch:12,short_name:'GTR1',long_name:'Guitare 1',source:'Guitare',mic:'SM57',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:13,short_name:'GTR2',long_name:'Guitare 2',source:'Guitare',mic:'SM57',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:''},
    {ch:14,short_name:'KYL',long_name:'Claviers L',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:15,short_name:'KYR',long_name:'Claviers R',source:'Claviers',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:16,short_name:'PERC',long_name:'Percussions',source:'Percussions',mic:'AKG 414',gain:0,phantom:true,iem_group:'GR3',foh:true,mon:true,bc:false,note:'Stereo'},
    {ch:17,short_name:'HORN',long_name:'Section Cuivres',source:'Cuivres',mic:'SM57',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:'Sub-mix'},
    {ch:18,short_name:'VOX',long_name:'Voix Lead',source:'Chant',mic:'SM58 / Beta 87A',gain:0,phantom:true,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Comp + Lim'},
    {ch:19,short_name:'BV1',long_name:'Backing Vox 1',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR2',foh:true,mon:true,bc:false,note:''},
    {ch:20,short_name:'BV2',long_name:'Backing Vox 2',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:''},
    {ch:21,short_name:'BV3',long_name:'Backing Vox 3',source:'Chant',mic:'SM58',gain:0,phantom:false,iem_group:'GR3',foh:true,mon:true,bc:false,note:''},
    {ch:22,short_name:'CLK',long_name:'Click',source:'Playback',mic:'DI',gain:0,phantom:false,iem_group:'GR1',foh:false,mon:true,bc:false,note:'IEM only'},
    {ch:23,short_name:'PBTL',long_name:'Playback Tracks L',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Ableton'},
    {ch:24,short_name:'PBTR',long_name:'Playback Tracks R',source:'Playback',mic:'DI Stereo',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Ableton'},
  ]},
  {id:'orchestre',icon:'🎻',name:'Orchestre / Classique',desc:'Cordes, vents, cuivres, percus, soliste',channels:[
    {ch:1,short_name:'VIOL',long_name:'Violons (sub-mix)',source:'Cordes',mic:'DPA 4006',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Stereo'},
    {ch:2,short_name:'ALTO',long_name:'Altos (sub-mix)',source:'Cordes',mic:'DPA 4006',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:3,short_name:'VCEL',long_name:'Violoncelles',source:'Cordes',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:4,short_name:'CBAS',long_name:'Contrebasses',source:'Cordes',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:5,short_name:'FLUT',long_name:'Flutes / Bois',source:'Vents',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:6,short_name:'HAUT',long_name:'Hautbois / Clarinette',source:'Vents',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:7,short_name:'CORS',long_name:'Cors / Cuivres',source:'Cuivres',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:'Attenuateur'},
    {ch:8,short_name:'TMBT',long_name:'Trombones / Tuba',source:'Cuivres',mic:'SM57',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:9,short_name:'PERC',long_name:'Percussions',source:'Percussions',mic:'AKG 414',gain:0,phantom:true,iem_group:'',foh:true,mon:false,bc:false,note:'Overhead'},
    {ch:10,short_name:'TIMP',long_name:'Timbales',source:'Percussions',mic:'Beta 52A',gain:0,phantom:false,iem_group:'',foh:true,mon:false,bc:false,note:''},
    {ch:11,short_name:'SOLO',long_name:'Soliste',source:'Chant',mic:'SM7B',gain:0,phantom:false,iem_group:'GR1',foh:true,mon:true,bc:true,note:'Comp doux'},
    {ch:12,short_name:'CHEF',long_name:'Retour chef',source:'Technique',mic:'DI',gain:0,phantom:false,iem_group:'',foh:false,mon:true,bc:false,note:'IFB chef'},
  ]},
];
async function loadUserTpls(){
  if(!ME)return;
  const {data}=await sb.from('templates').select('*').eq('owner_id',ME.id).order('created_at',{ascending:false});
  USER_TPLS=data||[];
  renderSPTplsUser();
  renderTplQuickBar();
}
function getAllTpls(){return[...BLTPLS,...USER_TPLS];}

function renderSPTpls(){
  const _et=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  document.getElementById('sp-tpls-builtin').innerHTML=BLTPLS.map(t=>`
    <div class="sp-tpl ${SEL_TPL===t.id?'active':''}" onclick="selTpl('${_et(t.id)}')">
      <span style="font-size:16px;width:20px;text-align:center">${/^\p{Emoji}/u.test(t.icon||'')?_et(t.icon):'📋'}</span>
      <span style="flex:1">${_et(t.name)}</span>
      <span style="font-family:var(--m);font-size:9px;color:var(--muted)">${t.channels.length} CH</span>
    </div>`).join('');
  renderSPTplsUser();
}
function renderSPTplsUser(){
  const _et=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const el=document.getElementById('sp-tpls-user');if(!el)return;
  if(USER_TPLS.length===0){el.innerHTML='<div style="font-size:10px;color:var(--muted);padding:4px 0">Aucun template.</div>';return;}
  el.innerHTML=USER_TPLS.map(t=>`
    <div class="sp-tpl usr ${SEL_TPL===t.id?'active':''}" onclick="selTpl('${_et(t.id)}')">
      <span style="font-size:16px;width:20px;text-align:center">${/^\p{Emoji}/u.test(t.icon||'')?_et(t.icon):'📋'}</span>
      <span style="flex:1">${_et(t.name)}</span>
      <span style="font-family:var(--m);font-size:9px;color:var(--muted)">${(t.channels||[]).length} CH</span>
      <button class="sp-tpl-del" onclick="event.stopPropagation();delUserTpl('${_et(t.id)}')"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}

function selTpl(id){
  SEL_TPL=id;renderSPTpls();
  const tpl=getAllTpls().find(t=>t.id===id);if(!tpl)return;
  const chs=tpl.channels||[];
  document.getElementById('sp-prev-title').textContent=`${tpl.icon||'📋'} ${tpl.name} — ${chs.length} CH`;
  document.getElementById('sp-prev-tbl').innerHTML=`
    <table><thead><tr><th>CH</th><th>Court</th><th>Nom long</th><th>Micro/DI</th><th>FOH</th><th>MON</th></tr></thead>
    <tbody>${chs.map(r=>`<tr>
      <td style="font-family:var(--m);color:var(--ora);text-align:center">${r.ch}</td>
      <td style="font-family:var(--m);font-weight:500;color:var(--ora2);text-transform:uppercase;font-size:10px">${(r.short_name||'').trim()}</td>
      <td style="color:var(--txt)">${r.long_name||''}</td>
      <td style="font-family:var(--m);font-size:10px;color:var(--txt2)">${r.mic||''}</td>
      <td style="text-align:center">${r.foh?'<span style="color:var(--blu2)">✓</span>':''}</td>
      <td style="text-align:center">${r.mon?'<span style="color:var(--warn)">✓</span>':''}</td>
    </tr>`).join('')}</tbody></table>`;
  document.getElementById('sp-preview').classList.add('show');
}
function closePrev(){document.getElementById('sp-preview').classList.remove('show');}

// --- Activite recente (Pro) ---
function _timeAgo(iso){
  if(!iso)return '';
  var diff=Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if(diff<60)return 'il y a moins d\'1 min';
  if(diff<3600)return 'il y a '+Math.floor(diff/60)+' min';
  if(diff<86400)return 'il y a '+Math.floor(diff/3600)+'h';
  var d=Math.floor(diff/86400);
  return 'il y a '+d+(d===1?' jour':' jours');
}
/* ── Notifications : invitations à des shows ── */
var _PENDING_INVITES=[];
var _notifFetchError=false; /* dernier refresh a échoué (réseau/RLS) → ne pas faire croire à 0 invit */

/* Récupère les invitations en attente (depuis show_invites) et met à jour le badge.
   Appelé à l'init et à l'ouverture du panneau. */
async function refreshNotifications(){
  if(!ME?.email){ _PENDING_INVITES=[]; _notifFetchError=false; _updateNotifBadge(); return; }
  try{
    /* RLS owner_all permet à l'owner de voir les invites qu'il a ENVOYÉES.
       Côté notifs on ne veut QUE les invitations adressées à NOUS.
       Filtrage client-side case-insensitive. */
    var myEmail=(ME.email||'').toLowerCase();
    var {data,error}=await sb.from('show_invites').select('*');
    if(error){
      /* BUG corrigé : on n'écrasait _PENDING_INVITES qu'avec [] sur la moindre
         erreur réseau/RLS → la notif visible disparaissait à l'ouverture du
         panneau (faux « Aucune notification »). On CONSERVE le dernier état
         connu et on signale juste l'échec pour pouvoir réessayer. */
      console.warn('[refreshNotif] err:',error.message); _notifFetchError=true;
    } else {
      _notifFetchError=false;
      _PENDING_INVITES=(data||[]).filter(function(inv){
        return String(inv.invited_email||'').toLowerCase()===myEmail;
      });
      console.log('[refreshNotif]',_PENDING_INVITES.length,'invite(s) pour',myEmail,'sur',(data||[]).length,'visibles');
    }
  }catch(e){ console.warn('[refreshNotif] catch:',e); _notifFetchError=true; }
  _updateNotifBadge();
}

function _updateNotifBadge(){
  var n=_PENDING_INVITES.length;
  var dot=document.getElementById('tb-notif-dot');
  var cnt=document.getElementById('sp-notif-count');
  if(dot){ dot.style.display=n>0?'flex':'none'; dot.textContent=n>9?'9+':String(n); }
  if(cnt){ cnt.style.display=n>0?'inline-flex':'none'; cnt.textContent=String(n); }
}

/* Affiche les notifications dans le panneau latéral */
function loadNotifications(){
  var el=document.getElementById('sp-notif');
  if(!el)return;
  var _es=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
  if(!_PENDING_INVITES.length){
    if(_notifFetchError){
      /* Le fetch a échoué et on n'a aucune invit en cache : ne pas mentir avec
         « Aucune notification » → proposer de réessayer. */
      el.innerHTML='<div style="font-size:10px;color:var(--muted);padding:8px 2px;display:flex;align-items:center;gap:7px;flex-wrap:wrap"><i class="ti ti-wifi-off" style="color:var(--warn);font-size:13px"></i>Impossible de charger les notifications.<button class="btn ghost sm" style="margin-left:auto" onclick="this.parentNode.innerHTML=\'\';refreshNotifications().then(loadNotifications)"><i class="ti ti-refresh"></i>Réessayer</button></div>';
      return;
    }
    el.innerHTML='<div style="font-size:10px;color:var(--muted);padding:8px 2px;display:flex;align-items:center;gap:7px"><i class="ti ti-check" style="color:var(--grn);font-size:13px"></i>Aucune notification.</div>';
    return;
  }
  el.innerHTML=_PENDING_INVITES.map(function(inv){
    var showName=inv.show_name||'un show';
    var inviter=inv.inviter_name||'Un technicien';
    var role=(window.ROLE_LABELS&&ROLE_LABELS[inv.role])||inv.role||'Membre';
    return '<div class="sp-notif-card invite" data-inv="'+inv.id+'">'
      +'<div class="sp-notif-top">'
        +'<div class="sp-notif-ic"><i class="ti ti-user-plus"></i></div>'
        +'<div class="sp-notif-txt">'
          +'<div class="sp-notif-title">Invitation à rejoindre <strong>'+_es(showName)+'</strong></div>'
          +'<div class="sp-notif-sub">'+_es(inviter)+' · rôle '+_es(role)+'</div>'
        +'</div>'
      +'</div>'
      +'<div class="sp-notif-acts">'
        +'<button class="btn sm" onclick="acceptShowInvite(\''+inv.id+'\')"><i class="ti ti-check"></i>Accepter</button>'
        +'<button class="btn-decline" onclick="declineShowInvite(\''+inv.id+'\')"><i class="ti ti-x"></i>Refuser</button>'
      +'</div>'
    +'</div>';
  }).join('');
}

/* Accepter une invitation : rejoindre le show (via RPC sécurisée) */
async function acceptShowInvite(inviteId){
  var inv=_PENDING_INVITES.find(function(x){return x.id===inviteId;});
  if(!inv)return;
  if(window._acceptingInvite)return; /* anti double-clic */
  window._acceptingInvite=true;
  /* Feedback immédiat sur le bouton cliqué */
  var card=document.querySelector('.sp-notif-card[data-inv="'+inviteId+'"]');
  if(card){ var acts=card.querySelector('.sp-notif-acts'); if(acts) acts.innerHTML='<span style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i>Acceptation…</span>'; }
  var showName=inv.show_name||'le show';
  try{
    var {data,error}=await sb.rpc('accept_show_invite',{p_invite_id:inviteId});
    if(error){toast('Erreur : '+error.message); window._acceptingInvite=false; return;}
    if(data&&data.ok===false){
      var msgs={not_your_invite:'Cette invitation ne vous est pas adressée.',not_authenticated:'Session expirée, reconnectez-vous.'};
      toast(msgs[data.error]||'Impossible d\'accepter l\'invitation.');
      await refreshNotifications(); loadNotifications();
      window._acceptingInvite=false;
      return;
    }
    /* ok (joined ou already) → on a rejoint */
    _PENDING_INVITES=_PENDING_INVITES.filter(function(x){return x.id!==inviteId;});
    _updateNotifBadge();
    await loadShows();
    renderSPShows();
    try{ renderSessions(); }catch(e){}
    /* Confirmation VISIBLE et persistante dans le panneau (au lieu de blanc) */
    var el=document.getElementById('sp-notif');
    if(el && !_PENDING_INVITES.length){
      var _es2=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
      el.innerHTML='<div style="font-size:11px;color:var(--grn);padding:9px 10px;display:flex;align-items:center;gap:8px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;line-height:1.4"><i class="ti ti-circle-check" style="font-size:15px;flex-shrink:0"></i><span>Vous avez rejoint <strong>'+_es2(showName)+'</strong>. Il apparaît dans « Mes shows ».</span></div>';
    }else{
      loadNotifications();
    }
    toast('✓ Vous avez rejoint « '+showName+' »');
  }catch(e){toast('Erreur : '+e.message);}
  finally{ window._acceptingInvite=false; }
}

/* Refuser une invitation */
async function declineShowInvite(inviteId){
  var inv=_PENDING_INVITES.find(function(x){return x.id===inviteId;});
  if(!inv)return;
  if(window._acceptingInvite)return; /* anti double-action */
  window._acceptingInvite=true;
  try{
    var {error}=await sb.from('show_invites').delete().eq('id',inviteId);
    if(error){toast('Erreur : '+error.message); window._acceptingInvite=false; return;}
    _PENDING_INVITES=_PENDING_INVITES.filter(function(x){return x.id!==inviteId;});
    _updateNotifBadge();
    loadNotifications();
    toast('Invitation refusée');
  }catch(e){toast('Erreur : '+e.message);}
  finally{ window._acceptingInvite=false; }
}

function setIM(m){
  IM_MODE=m;
  document.getElementById('im-replace').className='im-btn'+(m==='replace'?' on':'');
  document.getElementById('im-append').className='im-btn'+(m==='append'?' on':'');
}

async function applySelTpl(){
  const tplId=SEL_TPL;
  if(!tplId||!CUR_SHOW){toast('Aucun template sélectionné.');return;}
  const tpl=getAllTpls().find(t=>t.id===tplId);
  if(!tpl){toast('Template introuvable.');return;}
  const chs=tpl.channels||[];
  if(!confirm(IM_MODE==='replace'?`Remplacer tous les canaux par "${tpl.name}" ?`:`Ajouter ${chs.length} canaux de "${tpl.name}" ?`))return;
  if(IM_MODE==='replace'){
    const {error:de}=await sb.from('channels').delete().eq('show_id',CUR_SHOW.id);
    if(de){toast('Erreur suppression : '+de.message);return;}
    CHS=[];
  }
  const offset=CHS.length;
  const ins=chs.map((r,i)=>{
    const row={...r,show_id:CUR_SHOW.id,ch:offset+i+1};
    delete row.id;
    return row;
  });
  const {data,error}=await sb.from('channels').insert(ins).select();
  if(error){toast('Erreur insertion : '+error.message);return;}
  CHS=[...CHS,...(data||[])].sort((a,b)=>a.ch-b.ch);
  renderTable();
  closeSP();
  // Switch to Input List tab
  const tabs=document.querySelectorAll('.tab');
  const ilTab=[...tabs].find(t=>t.getAttribute('onclick')?.includes("'inputlist'"));
  goTab('inputlist',ilTab);
  toast(`✓ Template "${tpl.name}" appliqué — ${chs.length} canaux`);
}

async function applySelTplNew(){
  const tplId=SEL_TPL;
  if(!tplId){toast('Aucun template sélectionné.');return;}
  const tpl=getAllTpls().find(t=>t.id===tplId);
  if(!tpl){toast('Template introuvable.');return;}
  const name=`${tpl.name} — ${new Date().toLocaleDateString('fr-FR')}`;
  const {data:show,error}=await sb.from('shows').insert({name,slug:tpl.id+'-'+Date.now(),owner_id:ME.id}).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  SHOWS.unshift(show);
  const ins=(tpl.channels||[]).map((r,i)=>{const row={...r,show_id:show.id,ch:i+1};delete row.id;return row;});
  await sb.from('channels').insert(ins);
  await switchShow(show.id);closeSP();
  toast(`✓ "${name}" créé avec ${ins.length} canaux`);
}

async function saveAsTemplate(){
  if(CHS.length===0){alert('Input List vide.');return;}
  const name=prompt('Nom du template :',CUR_SHOW?.name||'');if(!name?.trim())return;
  const desc=prompt('Description :','')||'';
  const tagsR=prompt('Tags (virgule) :','')||'';
  const tags=tagsR.split(',').map(s=>s.trim()).filter(Boolean);
  const ICONS=['🎸','🎤','🎹','🎺','🎻','🥁','🎧','📡','🎭','🏢'];
  const icon=ICONS[USER_TPLS.length%ICONS.length];
  const channels=CHS.map(r=>({ch:r.ch,short_name:r.short_name,long_name:r.long_name,source:r.source,mic:r.mic,gain:r.gain,phantom:r.phantom,iem_group:r.iem_group,foh:r.foh,mon:r.mon,bc:r.bc,note:r.note}));
  const {data,error}=await sb.from('templates').insert({owner_id:ME.id,name:name.trim(),description:desc,icon,tags,channels,is_public:false}).select().single();
  if(error){toast('Erreur : '+error.message);return;}
  USER_TPLS.unshift(data);renderSPTplsUser();
  toast(`✓ Template "${name}" sauvegardé (${channels.length} CH)`);
}

async function delUserTpl(id){
  const t=USER_TPLS.find(x=>x.id===id);if(!confirm(`Supprimer "${t?.name}" ?`))return;
  await sb.from('templates').delete().eq('id',id);
  USER_TPLS=USER_TPLS.filter(x=>x.id!==id);renderSPTplsUser();
}

// ══════════════════════════════════════
// PROFILE
// ══════════════════════════════════════
/* ── Avatar helpers ── */
function _planRingClass(plan){ return plan==='pro'?'pro':''; }

/* Renders a single avatar element: photo or initials, with optional plan ring */
function _avHtml(name, avatarUrl, plan, sizePx, bgColor, textColor){
  const sz=sizePx||38;
  const ring=_planRingClass(plan);
  const fs=Math.round(sz*0.37);
  const init=(name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
  const inner=avatarUrl
    ? `<img src="${avatarUrl}" style="width:${sz}px;height:${sz}px;object-fit:cover;border-radius:50%;display:block" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
      +`<span style="display:none;width:${sz}px;height:${sz}px;border-radius:50%;background:${bgColor||'var(--surf3)'};color:${textColor||'var(--txt)'};font-size:${fs}px;font-weight:700;align-items:center;justify-content:center;flex-shrink:0">${init}</span>`
    : `<span style="display:flex;width:${sz}px;height:${sz}px;border-radius:50%;background:${bgColor||'var(--surf3)'};color:${textColor||'var(--txt)'};font-size:${fs}px;font-weight:700;align-items:center;justify-content:center;flex-shrink:0">${init}</span>`;
  if(!ring) return `<div style="display:inline-flex;flex-shrink:0">${inner}</div>`;
  return `<div class="av-ring ${ring}" style="display:inline-flex;flex-shrink:0;border-radius:50%"><div style="background:var(--surf);border-radius:50%;padding:2px">${inner}</div></div>`;
}

/* Update all avatar displays in the UI */
function _refreshAllAvatars(){
  const url=PROFILE?.avatar_url||'';
  const plan=PROFILE?.plan||'free';
  const name=PROFILE?.full_name||ME?.email||'?';
  const init=name.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
  // Topbar
  const uav=document.getElementById('u-av');
  if(uav){
    if(url){ uav.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" onerror="this.style.display='none'">`;
    } else { uav.textContent=init; }
  }
  // Profile modal avatar
  const pav=document.getElementById('p-avatar');
  if(pav){
    const img=pav.querySelector('img');
    const sp=document.getElementById('p-avatar-init');
    if(url){
      if(!img){const i=document.createElement('img');i.src=url;i.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%;display:block';pav.insertBefore(i,pav.firstChild);}
      else{img.src=url;}
      if(sp)sp.style.display='none';
    } else {
      if(img)img.remove();
      if(sp){sp.style.display='';sp.textContent=init;}
    }
    // Ring on wrapper
    const ring=_planRingClass(plan);
    const wrapper=document.getElementById('p-avatar-ring');
    if(wrapper){
      wrapper.className=ring?`av-ring ${ring}`:'';
      wrapper.style.cssText=ring?'display:inline-flex;border-radius:50%':'';
    }
  }
}

async function uploadAvatar(input){
  const file=input.files[0];if(!file)return;
  if(file.size>5*1024*1024){toast('Image trop grande (max 5 Mo).');return;}
  // Compress to canvas ≤ 400px
  const img=new Image();
  const reader=new FileReader();
  reader.onload=function(e){
    img.onload=async function(){
      const MAX=400;
      const scale=Math.min(1,MAX/Math.max(img.width,img.height));
      const cv=document.createElement('canvas');
      cv.width=Math.round(img.width*scale);cv.height=Math.round(img.height*scale);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      cv.toBlob(async function(blob){
        const path=ME.id+'/avatar.jpg';
        const {error:upErr}=await sb.storage.from('avatars').upload(path,blob,{contentType:'image/jpeg',upsert:true});
        if(upErr){toast('Erreur upload : '+upErr.message);return;}
        const {data:urlData}=sb.storage.from('avatars').getPublicUrl(path);
        const publicUrl=urlData?.publicUrl+'?t='+Date.now();
        await sb.from('profiles').update({avatar_url:publicUrl}).eq('id',ME.id);
        PROFILE.avatar_url=publicUrl;
        _refreshAllAvatars();
        toast('✓ Photo mise à jour.');
      },'image/jpeg',0.82);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
  input.value='';
}

function openProfile(){
  closeUD();
  // Infos
  document.getElementById('p-name').value=PROFILE?.full_name||'';
  document.getElementById('p-role').value=PROFILE?.role||'';
  document.getElementById('p-co').value=PROFILE?.company||'';
  document.getElementById('p-tel').value=PROFILE?.contact||'';
  // Avatar + display
  const name=PROFILE?.full_name||ME?.email||'?';
  const init=name.split(' ').map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
  document.getElementById('p-avatar-init').textContent=init;
  _refreshAllAvatars();
  document.getElementById('p-display-name').textContent=name;
  document.getElementById('p-display-email').textContent=ME?.email||'';
  // Reset champs sécurité
  document.getElementById('p-new-email').value='';
  document.getElementById('p-pwd1').value='';
  document.getElementById('p-pwd2').value='';
  ['p-info-msg','p-email-msg','p-pwd-msg'].forEach(function(id){
    var el=document.getElementById(id);if(el){el.style.display='none';el.textContent='';}
  });
  document.getElementById('profile-modal').className='modal-ov show';
}
function closeProfile(){document.getElementById('profile-modal').className='modal-ov';}
function _profMsg(id,text,isErr){
  var el=document.getElementById(id);if(!el)return;
  el.textContent=text;el.className='prof-msg '+(isErr?'err':'ok');el.style.display='block';
  if(!isErr)setTimeout(function(){el.style.display='none';},3500);
}
async function saveProfile(){
  var u={full_name:document.getElementById('p-name').value.trim(),role:document.getElementById('p-role').value.trim(),company:document.getElementById('p-co').value.trim(),contact:document.getElementById('p-tel').value.trim()};
  if(!u.full_name){_profMsg('p-info-msg','Le nom est requis.',true);return;}
  var {error}=await sb.from('profiles').update(u).eq('id',ME.id);
  if(error){_profMsg('p-info-msg','Erreur : '+error.message,true);return;}
  PROFILE={...PROFILE,...u};
  document.getElementById('u-name').textContent=u.full_name;
  document.getElementById('p-display-name').textContent=u.full_name;
  _refreshAllAvatars();
  _profMsg('p-info-msg','✓ Profil mis a jour','');
}
async function changeEmail(){
  var newEmail=document.getElementById('p-new-email').value.trim();
  if(!newEmail||!newEmail.includes('@')){_profMsg('p-email-msg','Adresse email invalide.',true);return;}
  var {error}=await sb.auth.updateUser({email:newEmail});
  if(error){_profMsg('p-email-msg','Erreur : '+error.message,true);return;}
  _profMsg('p-email-msg','✓ Email de confirmation envoye a '+newEmail+'.');
  document.getElementById('p-new-email').value='';
}
async function changePassword(){
  var pwd1=document.getElementById('p-pwd1').value;
  var pwd2=document.getElementById('p-pwd2').value;
  if(pwd1.length<8){_profMsg('p-pwd-msg','Minimum 8 caracteres.',true);return;}
  if(pwd1!==pwd2){_profMsg('p-pwd-msg','Les mots de passe ne correspondent pas.',true);return;}
  var {error}=await sb.auth.updateUser({password:pwd1});
  if(error){_profMsg('p-pwd-msg','Erreur : '+error.message,true);return;}
  _profMsg('p-pwd-msg','✓ Mot de passe mis a jour.');
  document.getElementById('p-pwd1').value='';document.getElementById('p-pwd2').value='';
}

// ══════════════════════════════════════
// NAV
// ══════════════════════════════════════
// ══════════════════════════════════════
// FICHIERS CLOUD
// ══════════════════════════════════════
const FICH_BUCKET = 'show-files'; // kept for reference only — storage is now Backblaze B2

/* ══════════════════════════════════════
   ICÔNES PERSONNALISÉES (images JPEG/PNG)
   Resize → base64 (stocké dans le nœud) + upload B2 (comptage stockage)
   ══════════════════════════════════════ */
const _ICON_MAX_BYTES = 10 * 1024 * 1024; // 10 Mo max
const _ICON_PX        = 1200;            // stocker à 1200px max — préserve la qualité à toutes les tailles usuelles
/* Plafond de la taille STOCKÉE d'une image (base64) — au-delà on recompresse.
   Empêche qu'un seul PNG/JPEG gonfle la ligne DB de plusieurs Mo. */
const _IMG_STORE_CAP  = 2 * 1024 * 1024; // 2 Mo de base64 max par image

/* Taille en octets de la charge utile base64 d'une data-URL (sans l'en-tête). */
function _dataUrlBytes(dataUrl){
  if(typeof dataUrl!=='string') return 0;
  const i=dataUrl.indexOf(',');
  const b64=i>=0?dataUrl.slice(i+1):dataUrl;
  /* 4 caractères base64 = 3 octets ; on retire le padding '='. */
  let pad=0; if(b64.endsWith('=='))pad=2; else if(b64.endsWith('='))pad=1;
  return Math.max(0, Math.floor(b64.length*3/4) - pad);
}

/* N'accepte comme src d'image que : une data-URL image base64, une URL http(s),
   ou une chaîne vide. Tout le reste (tentative d'injection d'attribut via " ou
   d'un javascript:, blob:, etc.) est rejeté → renvoie ''. Empêche le XSS stocké
   quand iconImg/bgImage est rendu par concaténation dans un attribut src. */
function _safeImgSrc(src){
  if(typeof src!=='string'||!src) return '';
  /* Rejette tout caractere de rupture d'attribut (guillemets, chevrons,
     espaces/retours, backtick, antislash) — aucune src d'image legitime n'en
     contient (les URL encodent l'espace en %20). */
  if(/[\s"'<>\x60\\]/.test(src)) return '';
  /* data-URL image en base64 — SVG exclu (peut embarquer du script). */
  if(/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  /* URL http(s) simple. */
  if(/^https?:\/\/[A-Za-z0-9._~:\/?#\[\]@!$&()*+,;=%-]+$/.test(src)) return src;
  return '';
}

/* Redimensionne + compresse une image (File) vers une data-URL bornée.
   - maxDim : plus grande dimension autorisée (px)
   - capBytes : taille base64 max ; on baisse la qualité JPEG jusqu'à respecter
     le plafond (ou minimum 0.4). Renvoie toujours du JPEG (fond opaque). */
async function _compressImageToB64(file, maxDim, capBytes){
  if(!/^image\//.test(file.type||'')) throw new Error('Format non supporté (image attendue)');
  return new Promise(function(resolve,reject){
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=function(){
      let w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
      const s=Math.min(maxDim/w, maxDim/h, 1);
      w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s));
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
      ctx.drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      let q=0.9, out=c.toDataURL('image/jpeg',q);
      while(_dataUrlBytes(out) > capBytes && q > 0.4){
        q-=0.1; out=c.toDataURL('image/jpeg',q);
      }
      resolve(out);
    };
    img.onerror=function(){ URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image")); };
    img.src=url;
  });
}

async function _resizeIconToB64(file){
  if(!['image/jpeg','image/png'].includes(file.type)) throw new Error('Format non supporté (JPEG ou PNG uniquement)');
  if(file.size > _ICON_MAX_BYTES) throw new Error('Image trop grande (max 10 Mo)');
  return new Promise(function(resolve,reject){
    var url=URL.createObjectURL(file);
    var img=new Image();
    img.onload=function(){
      /* Pas d'upscale — limiter uniquement si plus grand que _ICON_PX */
      var s=Math.min(_ICON_PX/img.width,_ICON_PX/img.height,1);
      var c=document.createElement('canvas');
      c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      /* Conserver le format d'origine : PNG reste PNG (lossless), JPEG reste JPEG.
         Mais si le résultat dépasse le plafond de stockage (gros PNG photo),
         on bascule en JPEG et on baisse la qualité jusqu'à rentrer sous le cap —
         évite qu'une seule image gonfle la ligne DB de plusieurs Mo. */
      var isPng = file.type === 'image/png';
      var out = isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
      if(_dataUrlBytes(out) > _IMG_STORE_CAP){
        var q=0.9;
        out=c.toDataURL('image/jpeg',q);
        while(_dataUrlBytes(out) > _IMG_STORE_CAP && q > 0.4){ q-=0.1; out=c.toDataURL('image/jpeg',q); }
      }
      resolve(out);
    };
    img.onerror=function(){ URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image")); };
    img.src=url;
  });
}

function _pickIconFile(cb){
  if(!canDo('multi_scenes')){ showUpgradeModal('multi_patches'); return; }
  var inp=document.createElement('input');
  inp.type='file'; inp.accept='image/jpeg,image/png';
  inp.onchange=async function(){
    var file=inp.files[0]; if(!file) return;
    /* Vérifier le quota avant de charger l'image */
    if(!await _quotaCheck(file.size)) return;
    cb(file);
  };
  inp.click();
}

/* Convertit une data-URL base64 en Blob (pour upload B2). */
function _dataUrlToBlob(dataUrl){
  const m=/^data:([^;]+);base64,(.*)$/.exec(String(dataUrl||''));
  if(!m) return null;
  const mime=m[1], bin=atob(m[2]);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}

async function _b2UploadIcon(b64, b2Key){
  /* Upload silencieux — erreur non fatale, sert au comptage stockage.
     On envoie l'image REDIMENSIONNÉE (≤ _IMG_STORE_CAP), pas l'original :
     le coût B2 reste borné et cohérent avec le base64 stocké en DB. */
  try{
    const blob=_dataUrlToBlob(b64);
    if(blob) await B2Storage.upload(b2Key, blob, { contentType: blob.type });
  }
  catch(e){ console.warn('[icon b2]', e.message); }
  _storageCache = null; // invalider le cache après upload
}

/* ══════════════════════════════════════
   QUOTA DE STOCKAGE — vérification avant chaque upload
   ══════════════════════════════════════ */
let _storageCache = null; // { total:bytes, b2:bytes, db:bytes, ts:ms }
const _STORAGE_CACHE_TTL = 3 * 60 * 1000; // 3 min

function _storageQuotaBytes(){
  /* 500 Mo gratuit, 50 Go Pro */
  return canDo('multi_scenes') ? 50 * 1073741824 : 500 * 1048576;
}

async function _getStorageUsage(force){
  const now = Date.now();
  if(!force && _storageCache && (now - _storageCache.ts) < _STORAGE_CACHE_TTL) return _storageCache;
  try{
    const showIds = (SHOWS||[]).filter(s=>s.owner_id===ME?.id).map(s=>s.id);
    if(!showIds.length) return {total:0,b2:0,db:0,ts:now};
    const {data,error} = await _b2Call('user-storage',{showIds});
    if(error||!data) return _storageCache || {total:0,b2:0,db:0,ts:now};
    _storageCache = {
      total: data.total_bytes||0,
      b2:    data.b2_bytes||0,
      db:    data.db_bytes||0,
      ts:    now
    };
    return _storageCache;
  }catch(e){
    return _storageCache || {total:0,b2:0,db:0,ts:now};
  }
}

/* Vérifie si l'upload est possible. Affiche un modal bloquant si dépassement.
   sizeBytes = taille estimée du fichier à ajouter.
   Returns true si OK, false si quota dépassé. */
async function _quotaCheck(sizeBytes){
  const quota = _storageQuotaBytes();
  const usage = await _getStorageUsage(false);
  const after  = usage.total + sizeBytes;
  if(after <= quota) return true;
  /* Dépassement — afficher un message clair */
  const remaining = Math.max(0, quota - usage.total);
  const plan = userPlan();
  const upgradeMsg = plan === 'free'
    ? '<br><br>Passez au <strong>Pro</strong> pour obtenir 50 Go de stockage.'
    : '<br><br>Supprimez des fichiers pour libérer de l\'espace.';
  /* Afficher un toast d'erreur (non bloquant mais clair) */
  if(plan === 'free'){
    toast('🚫 Quota dépassé (' + _fmtSize(remaining) + ' restants). Passez Pro pour 50 Go.');
    setTimeout(function(){ openPlanModal(); }, 800);
  } else {
    toast('🚫 Quota dépassé — il reste ' + _fmtSize(remaining) + '. Supprimez des fichiers pour libérer de l\'espace.');
  }
  return false;
}

function _b2DeleteIcon(b2Key){
  if(!b2Key) return;
  B2Storage.remove([b2Key]).catch(function(){});
}

/* Badge "Image perso" pour les inspecteurs */
function _iconImgInspHtml(objId, hasImg, thumbSrc, uploadFn, clearFn){
  var proGate = canDo('multi_scenes') ? '' :
    '<div style="font-size:9px;color:var(--muted);font-family:var(--m);margin-top:4px"><i class="ti ti-lock" style="color:var(--ora)"></i> Pro uniquement</div>';
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bdr2)">'
    +'<div style="font-size:9px;font-family:var(--m);text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:6px">Image personnalisée</div>'
    +(hasImg ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">'
        +'<img src="'+_safeImgSrc(thumbSrc)+'" style="width:40px;height:40px;object-fit:contain;border-radius:5px;border:1px solid var(--bdr2);background:#fff"/>'
        +'<button class="btn ghost sm" style="flex:1;font-size:10px" onclick="'+clearFn+'"><i class="ti ti-x"></i> Retirer</button>'
      +'</div>' : '')
    +'<button class="btn ghost sm" style="width:100%;justify-content:center;font-size:10px" onclick="'+uploadFn+'"'+(canDo('multi_scenes')?'':' disabled')+'>'
      +'<i class="ti ti-photo" style="color:var(--ora)"></i> '+(hasImg?'Remplacer':'Ajouter une image')+' <span style="font-size:8px;color:var(--muted);margin-left:4px">JPEG/PNG · max 5 Mo</span>'
    +'</button>'
    +proGate
    +'</div>';
}

/* Cache mémoire des URLs signées (clé = path B2) — réduit la latence
   sur connexion lente en évitant de re-appeler la edge function pour
   les mêmes fichiers (lignes par lignes dans une grille, navigation...). */
const _signedUrlCache = new Map();

/* ── B2Storage : drop-in replacement for B2Storage ──
   All file operations are proxied through the Supabase Edge Function
   b2-storage, which holds B2 credentials securely server-side.
   Uploads use presigned PUT URLs so files go directly browser → B2. ── */
const _B2_FN_URL = (()=>{
  const h = window.location.hostname;
  const base = (h==='127.0.0.1'||h==='localhost')
    ? 'http://127.0.0.1:54321/functions/v1'
    : 'https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1';
  return base + '/b2-storage';
})();

async function _b2Call(action, params){
  try{
    /* Retry + timeout pour résister aux connexions instables.
       Les uploads (upload-presigned) ne doivent PAS retry car le caller
       gère lui-même la suite avec un PUT direct vers B2. */
    const noRetry = action==='upload-presigned';
    const callFn = async function(){
      const sess=(await sb.auth.getSession()).data?.session;
      const res=await fetch(_B2_FN_URL,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+(sess?.access_token||''),
        },
        body:JSON.stringify({action,...params}),
      });
      if(!res.ok){
        const txt=await res.text().catch(()=>'');
        const err = new Error('HTTP '+res.status+': '+txt);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    };
    if(noRetry){
      return await _withTimeout(callFn(), 15000);
    }
    return await _withRetry(callFn, { label:'b2:'+action, tries:3, timeoutMs:15000 });
  }catch(e){
    return {data:null,error:{message:e.message}};
  }
}

const B2Storage={
  /* list files and folders at a prefix (depuis Supabase show_files) */
  async list(prefix,_opts){
    return _b2Call('list',{prefix});
  },
  /* vrai listing B2 S3 (fallback/backfill des fichiers pré-migration) */
  async listB2Raw(prefix){
    return _b2Call('list-b2-raw',{prefix});
  },
  /* upload: get presigned PUT URL, then PUT directly to B2 */
  async upload(path,file,_opts){
    const {data,error}=await _b2Call('upload-presigned',{
      path,
      contentType:file.type||'application/octet-stream',
      size:file.size,
    });
    if(error||!data?.uploadUrl) return {data:null,error:error||{message:'Presigned URL error'}};
    /* Le serveur impose un Content-Type sûr et signe l'URL avec : on DOIT
       PUT avec exactement ce type, sinon la signature B2 est rejetée.
       (fallback file.type pour compat avec une ancienne version du serveur) */
    const putType=data.contentType||file.type||'application/octet-stream';
    const put=await fetch(data.uploadUrl,{
      method:'PUT',
      headers:{'Content-Type':putType},
      body:file,
    });
    if(!put.ok) return {data:null,error:{message:'Upload B2 failed: '+put.statusText}};
    return {data:{path},error:null};
  },
  /* Retourne uniquement l'URL présignée (pour upload custom de blob) */
  async uploadPresigned(path, _size, contentType){
    return _b2Call('upload-presigned',{path,contentType:contentType||'application/octet-stream'});
  },
  /* move / rename */
  async move(fromPath,toPath){
    return _b2Call('move',{fromPath,toPath});
  },
  /* purge des anciennes versions B2 d'une clé (après un remplacement) */
  async purgeOldVersions(path){
    return _b2Call('purge-old-versions',{path});
  },
  /* delete one or many objects */
  async remove(paths){
    return _b2Call('delete',{paths});
  },
  /* presigned GET for view / download — avec cache mémoire et dédup
     pour éviter de rappeler la edge function pour le même path */
  async createSignedUrl(path,expiresIn,downloadName){
    const exp = expiresIn||3600;
    /* Clé de cache distincte pour un lien de téléchargement (Content-Disposition
       différent d'un lien de visualisation) */
    const ckey = downloadName ? path+' dl:'+downloadName : path;
    /* Cache valide tant qu'on est dans 90% de la durée d'expiration */
    const cached = _signedUrlCache.get(ckey);
    if(cached && cached.exp > Date.now()){
      return { data:{ signedUrl: cached.url }, error:null };
    }
    /* Dédup : si deux appels demandent le même path en parallèle → 1 seule requête */
    return _dedup('signurl:'+ckey, async function(){
      const res = await _b2Call('signed-url',{path,expiresIn:exp,downloadName});
      if(!res.error && res.data?.signedUrl){
        _signedUrlCache.set(ckey, {
          url: res.data.signedUrl,
          /* Valable jusqu'à 90% de la durée pour avoir une marge */
          exp: Date.now() + exp*1000*0.9
        });
      }
      return res;
    });
  },
};

let SHOW_FILES = [];
let _fichInited = false;
let _fichPath = []; // current folder navigation stack

const _fEsc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const FICH_TYPES = {
  pdf:    { ext:['pdf'],                               icon:'<i class="ti ti-file-type-pdf" style="color:#ef4444;font-size:20px"></i>',    cls:'ico-pdf',     label:'PDF',        preview:'pdf' },
  word:   { ext:['docx','doc','rtf'],                  icon:'<i class="ti ti-file-type-doc" style="color:#3b82f6;font-size:20px"></i>',    cls:'ico-word',    label:'Document',   preview:'docx' },
  odt:    { ext:['odt'],                               icon:'<i class="ti ti-file-type-doc" style="color:#3b82f6;font-size:20px"></i>',    cls:'ico-word',    label:'Document',   preview:'odt' },
  txt:    { ext:['txt'],                              icon:'<i class="ti ti-file-text" style="color:#94a3b8;font-size:20px"></i>',          cls:'ico-txt',     label:'Texte',      preview:'text' },
  excel:  { ext:['xlsx','xls','ods'],                 icon:'<i class="ti ti-file-type-xls" style="color:#22c55e;font-size:20px"></i>',    cls:'ico-excel',   label:'Tableur',    preview:'xlsx' },
  csv:    { ext:['csv'],                              icon:'<i class="ti ti-table" style="color:#22c55e;font-size:20px"></i>',              cls:'ico-excel',   label:'Tableur',    preview:'xlsx' },
  ppt:    { ext:['pptx','ppt','odp','key'],            icon:'<i class="ti ti-file-type-ppt" style="color:#f97316;font-size:20px"></i>',    cls:'ico-ppt',     label:'Presentation', preview:'none' },
  image:  { ext:['png','jpg','jpeg','gif','webp','svg','heic','bmp','tif','tiff'], icon:'<i class="ti ti-photo" style="color:#ec4899;font-size:20px"></i>', cls:'ico-image', label:'Image',      preview:'image' },
  video:  { ext:['mp4','mov','avi','webm','mkv'],       icon:'<i class="ti ti-device-tv" style="color:#a855f7;font-size:20px"></i>',       cls:'ico-video',   label:'Video',      preview:'video' },
  audio:  { ext:['mp3','wav','m4a','aac','flac','ogg','aiff','aif'], icon:'<i class="ti ti-music" style="color:#06b6d4;font-size:20px"></i>', cls:'ico-audio', label:'Audio',      preview:'audio' },
  /* Console show files — Yamaha, DiGiCo, A&H, Midas/Behringer, SSL, Avid... */
  showfile:{ ext:['scn','show','dlive','dvs','avs','xml','qu','cl','sb','prj','ses','vsh','svc','daw','mid'],
             icon:'<i class="ti ti-adjustments-alt" style="color:#ff6b1a;font-size:20px"></i>', cls:'ico-show', label:'Show file', preview:'none' },
  /* DAW / multitrack sessions — Pro Tools, Logic, Live, Reaper, Cubase... */
  daw:    { ext:['ptx','ptf','logicx','als','rpp','cpr','npr','song','reapeaks','flp'],
            icon:'<i class="ti ti-waveform" style="color:#8b5cf6;font-size:20px"></i>', cls:'ico-daw', label:'Session DAW', preview:'none' },
  archive:{ ext:['zip','rar','7z','tar','gz'],         icon:'<i class="ti ti-file-zip" style="color:#eab308;font-size:20px"></i>',         cls:'ico-archive', label:'Archive',    preview:'none' },
};

function _fichInfoOf(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  for (const k in FICH_TYPES) {
    if (FICH_TYPES[k].ext.includes(ext)) return FICH_TYPES[k];
  }
  return { icon:'<i class="ti ti-file" style="color:var(--muted);font-size:20px"></i>', cls:'ico-other', label:'Fichier', preview:'none' };
}

function _fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' o';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' Ko';
  return (b / 1048576).toFixed(1) + ' Mo';
}

function _fichDisplayName(storedName) {
  const idx = storedName.indexOf('_');
  return idx > -1 ? storedName.slice(idx + 1) : storedName;
}

// ══════════════════════════════════════
// SHOW_FILES — Supabase comme source de vérité pour les listings
// Toutes les opérations B2 sont mirrorées ici pour éviter
// les appels B2Storage.list() lents et coûteux.
// ══════════════════════════════════════

/* Extrait le dossier parent d'un chemin complet.
   'showId/Logos/abc_img.png' → 'Logos'
   'showId/abc_rider.pdf'     → ''          */
function _sfFolder(fullPath) {
  // Retire le showId/ initial puis le nom de fichier final
  const rel = fullPath.startsWith(CUR_SHOW.id + '/') ? fullPath.slice(CUR_SHOW.id.length + 1) : fullPath;
  const parts = rel.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

/* Upsert un fichier dans show_files après upload B2 réussi */
async function _sfUpsertFile(fullPath, file) {
  if (!CUR_SHOW || !ME) return;
  const name = fullPath.split('/').pop();
  const folder = _sfFolder(fullPath);
  await sb.from('show_files').upsert({
    show_id:      CUR_SHOW.id,
    path:         fullPath,
    name:         name,
    folder:       folder,
    size:         file.size || 0,
    content_type: file.type || '',
    is_folder:    false,
    created_by:   ME.id,
  }, { onConflict: 'show_id,path' });
}

/* Upsert un dossier dans show_files (entrée virtuelle) */
async function _sfUpsertFolder(fullPath, folderName) {
  if (!CUR_SHOW || !ME) return;
  // fullPath est le chemin du .keep, on remonte d'un niveau pour le dossier
  const folderPath = fullPath.replace(/\/\.keep$/, '');
  const parentFolder = _sfFolder(folderPath + '/dummy'); // dossier parent
  await sb.from('show_files').upsert({
    show_id:      CUR_SHOW.id,
    path:         folderPath,
    name:         folderName,
    folder:       parentFolder,
    size:         0,
    content_type: '',
    is_folder:    true,
    created_by:   ME.id,
  }, { onConflict: 'show_id,path' });
}

/* Supprime un fichier de show_files */
async function _sfDeleteFile(fullPath) {
  if (!CUR_SHOW) return;
  await sb.from('show_files').delete().eq('show_id', CUR_SHOW.id).eq('path', fullPath);
}

/* Supprime un dossier et son contenu de show_files */
async function _sfDeleteFolder(folderRelPath) {
  if (!CUR_SHOW) return;
  const basePath = CUR_SHOW.id + '/' + folderRelPath;
  // Supprime le dossier lui-même + tous les fichiers dont le path commence par basePath/
  await sb.from('show_files').delete()
    .eq('show_id', CUR_SHOW.id)
    .or(`path.eq.${basePath},path.like.${basePath}/%`);
}

/* Met à jour le path/folder d'un fichier après un move B2 */
async function _sfMoveFile(oldPath, newPath) {
  if (!CUR_SHOW) return;
  const newName   = newPath.split('/').pop();
  const newFolder = _sfFolder(newPath);
  await sb.from('show_files')
    .update({ path: newPath, name: newName, folder: newFolder })
    .eq('show_id', CUR_SHOW.id).eq('path', oldPath);
}

/* Lit les fichiers/dossiers d'un dossier depuis Supabase (remplace B2Storage.list)
   Les sous-dossiers sont DÉRIVÉS des chemins des fichiers (robuste : pas besoin
   de lignes de dossiers séparées), + les lignes is_folder explicites (dossiers vides). */
async function _sfListFolder(folderRelPath) {
  if (!CUR_SHOW) return { data: [], error: null };
  const folderKey = folderRelPath.replace(/\/$/, ''); // '' | 'Logos' | 'Logos/Sub'

  // 1. Fichiers directs de ce dossier
  const { data: directRows, error: e1 } = await sb.from('show_files')
    .select('id, path, name, folder, size, content_type, is_folder, created_at, verified_at, verified_by_name')
    .eq('show_id', CUR_SHOW.id)
    .eq('folder', folderKey)
    .order('name', { ascending: true });
  if (e1) return { data: null, error: e1 };

  const directFiles   = (directRows || []).filter(r => !r.is_folder);
  const explicitFolders = (directRows || []).filter(r => r.is_folder).map(r => r.name);

  // 2. Tous les fichiers descendants → dériver les noms de sous-dossiers immédiats
  const childPrefix = folderKey ? folderKey + '/' : '';
  let q = sb.from('show_files')
    .select('folder')
    .eq('show_id', CUR_SHOW.id)
    .eq('is_folder', false);
  q = childPrefix ? q.like('folder', childPrefix + '%') : q.neq('folder', '');
  const { data: descRows, error: e2 } = await q;
  if (e2) return { data: null, error: e2 };

  const subSet = new Set(explicitFolders);
  (descRows || []).forEach(r => {
    if (!r.folder) return;
    const rel = r.folder.slice(childPrefix.length); // segment relatif
    const seg = rel.split('/')[0];
    if (seg) subSet.add(seg);
  });
  // Ne jamais exposer le dossier d'assets internes
  subSet.delete('node-icons');

  // 3. Construire la liste : dossiers (dérivés) d'abord, puis fichiers
  const folders = [...subSet].sort().map(name => ({
    id: null, path: CUR_SHOW.id + '/' + childPrefix + name, name,
    folder: folderKey, size: 0, content_type: '', is_folder: true, created_at: null,
  }));
  return { data: [...folders, ...directFiles], error: null };
}

/* Lit les fichiers (pas dossiers) d'un show depuis Supabase pour le rider picker */
async function _sfListShowFiles() {
  if (!CUR_SHOW) return { data: [], error: null };
  const { data, error } = await sb.from('show_files')
    .select('id, path, name, folder, size, content_type, is_folder, created_at')
    .eq('show_id', CUR_SHOW.id)
    .eq('is_folder', false)
    .order('name', { ascending: true });
  // Exclure les assets internes (icônes synoptique/plan stockées dans node-icons/)
  const filtered = (data || []).filter(f => !/(^|\/)node-icons\//.test(f.path) && f.folder !== 'node-icons');
  return { data: filtered, error };
}

function _fichPathStr() {
  return _fichPath.length ? _fichPath.join('/') + '/' : '';
}

function _fichFullPath(filename) {
  return CUR_SHOW.id + '/' + _fichPathStr() + filename;
}

async function loadFichiers() {
  if (!CUR_SHOW) return;
  const folderRel = _fichPathStr().replace(/\/$/, ''); // '' | 'Logos' | 'Logos/Sub'
  const list = document.getElementById('fichiers-list');
  const dz   = document.getElementById('fichiers-drop-zone');

  // 1. Essayer Supabase (rapide)
  const { data: sfData, error: sfErr } = await _sfListFolder(folderRel);
  if (sfErr) {
    if (list) list.innerHTML = '<div class="fich-empty"><i class="ti ti-alert-triangle"></i><p style="font-size:12px">Erreur chargement : ' + (sfErr.message||'') + '</p></div>';
    if (dz) dz.style.display = 'none';
    return;
  }

  const prefix = CUR_SHOW.id + '/' + (folderRel ? folderRel + '/' : '');

  // 2. Si Supabase retourne des résultats → on les affiche tout de suite
  if (sfData && sfData.length > 0) {
    SHOW_FILES = sfData.map(f => ({
      name:         f.name,
      id:           f.is_folder ? null : f.id,
      metadata:     { size: f.size },
      created_at:   f.created_at,
      content_type: f.content_type,
      verified_at:      f.verified_at || null,
      verified_by_name: f.verified_by_name || null,
      _path:        f.path,
      _isFolder:    f.is_folder,
    }));
    _renderFichBreadcrumb();
    _renderFichiersGrid();
    // Réconciliation B2 en arrière-plan : capture dossiers/fichiers manquants
    _reconcileFolderWithB2(prefix, folderRel);
    return;
  }

  // 3. show_files vide pour ce dossier → lecture B2 directe + backfill
  const { data: b2Data, error: b2Err } = await B2Storage.listB2Raw(prefix);
  if (b2Err) {
    if (list) list.innerHTML = '<div class="fich-empty"><i class="ti ti-alert-triangle"></i><p style="font-size:12px">Erreur stockage : ' + (b2Err.message||'') + '</p></div>';
    if (dz) dz.style.display = 'none';
    return;
  }
  const SKIP = new Set(['.emptyFolderPlaceholder', '.keep']);
  const b2Files = (b2Data || []).filter(f => !SKIP.has(f.name) && f.name);
  SHOW_FILES = b2Files.map(f => {
    const isDir = f.id === null;
    return {
      name:         f.name,
      id:           isDir ? null : f.id,
      metadata:     { size: f.metadata?.size || 0 },
      created_at:   f.created_at,
      content_type: '',
      verified_at:      null, // pas encore synchronisé dans show_files
      verified_by_name: null,
      _path:        prefix + f.name,
      _isFolder:    isDir,
    };
  });
  _renderFichBreadcrumb();
  _renderFichiersGrid();
  _backfillRows(b2Files, prefix, folderRel);
}

/* « Pierres tombales » : chemins B2 qu'on vient de renommer/supprimer/déplacer.
   La suppression B2 est à consistance différée → le listing peut encore renvoyer
   l'ancien fichier. Sans ça, la réconciliation le voit « manquant » de show_files
   et le RÉ-INJECTE → doublon après un renommage. On l'ignore pendant 30 s. */
const _fichGone = new Map(); // path complet -> expiry (ms)
function _fichMarkGone(path){ if (path) _fichGone.set(path, Date.now() + 30000); }
function _fichIsGone(path){
  const exp = _fichGone.get(path);
  if (exp === undefined) return false;
  if (exp < Date.now()) { _fichGone.delete(path); return false; }
  return true;
}

/* Upsert une liste d'entrées B2 brutes dans show_files */
async function _backfillRows(b2Files, prefix, folderRel) {
  if (!b2Files.length || !ME) return;
  const rows = b2Files
    .filter(f => !_fichIsGone(prefix + f.name)) // ne pas ressusciter un fichier renommé/supprimé
    .map(f => {
      const isDir = f.id === null;
      return {
        show_id: CUR_SHOW.id, path: prefix + f.name, name: f.name, folder: folderRel,
        size: isDir ? 0 : (f.metadata?.size || 0), content_type: '', is_folder: isDir, created_by: ME.id,
      };
    });
  if (!rows.length) return;
  await sb.from('show_files').upsert(rows, { onConflict: 'show_id,path' }).then(()=>{});
}

/* Réconcilie le dossier courant avec B2 : ajoute dans show_files les
   dossiers/fichiers présents en B2 mais absents de Supabase, et re-render
   si du nouveau contenu apparaît. Tourne en arrière-plan (non bloquant). */
async function _reconcileFolderWithB2(prefix, folderRel) {
  try {
    const { data: b2Data } = await B2Storage.listB2Raw(prefix);
    if (!b2Data) return;
    const SKIP = new Set(['.emptyFolderPlaceholder', '.keep']);
    const b2Files = b2Data.filter(f => !SKIP.has(f.name) && f.name && !_fichIsGone(prefix + f.name));
    if (!b2Files.length) return;
    // Noms déjà affichés
    const known = new Set(SHOW_FILES.map(f => f.name));
    const missing = b2Files.filter(f => !known.has(f.name));
    if (!missing.length) return;
    // Backfill puis recharger l'affichage depuis Supabase
    await _backfillRows(b2Files, prefix, folderRel);
    // Vérifier qu'on est toujours sur le même dossier avant de re-render
    const stillHere = (CUR_SHOW.id + '/' + (_fichPathStr())) === prefix;
    if (stillHere) {
      const { data: fresh } = await _sfListFolder(folderRel);
      if (fresh && fresh.length) {
        SHOW_FILES = fresh.map(f => ({
          name: f.name, id: f.is_folder ? null : f.id, metadata: { size: f.size },
          created_at: f.created_at, content_type: f.content_type,
          verified_at: f.verified_at || null, verified_by_name: f.verified_by_name || null,
          _path: f.path, _isFolder: f.is_folder,
        }));
        _renderFichiersGrid();
      }
    }
  } catch (e) { /* silencieux */ }
}

function _renderFichBreadcrumb() {
  const el = document.getElementById('fich-breadcrumb');
  if (!el) return;
  if (_fichPath.length === 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  let html = '<span class="fich-bc-seg" onclick="_fichNavTo(-1)"><i class="ti ti-home" style="font-size:11px"></i> Accueil</span>';
  _fichPath.forEach((seg, i) => {
    html += '<span class="fich-bc-sep"><i class="ti ti-chevron-right"></i></span>';
    const isCur = i === _fichPath.length - 1;
    html += '<span class="fich-bc-seg' + (isCur ? ' cur' : '') + '"' +
      (isCur ? '' : ' onclick="_fichNavTo(' + i + ')"') + '>' + _fEsc(seg) + '</span>';
  });
  el.innerHTML = html;
}

function _fichNavTo(idx) {
  _fichPath = idx === -1 ? [] : _fichPath.slice(0, idx + 1);
  loadFichiers();
}

/* Navigation dans un sous-dossier — fonction atomique avec garde anti-double-clic.
   L'ancien pattern onclick="navTo(idx);_fichPath.push(name);loadFichiers()" était
   exécuté deux fois sur un double-clic → dossier dupliqué dans le chemin. */
let _fichNavLock = false;
function _fichEnterFolder(name) {
  if(_fichNavLock) return;
  _fichNavLock = true;
  _fichPath.push(name);
  loadFichiers().finally(function(){ _fichNavLock = false; });
}

let _fichFilter = 'all';
let _fichSearch = '';
let _fichSort = 'name-asc';

function setFichFilter(type, btn) {
  _fichFilter = type;
  document.querySelectorAll('.fich-filter-chip').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  _renderFichiersGrid();
}
function setFichSearch(q) { _fichSearch = (q || '').toLowerCase().trim(); _renderFichiersGrid(); }
function setFichSort(v) { _fichSort = v || 'name-asc'; _renderFichiersGrid(); }

function _fichSortFiles(arr) {
  const [key, dir] = _fichSort.split('-');
  const mul = dir === 'desc' ? -1 : 1;
  return arr.slice().sort(function(a, b) {
    if (key === 'name') return mul * _fichDisplayName(a.name).localeCompare(_fichDisplayName(b.name), 'fr', { numeric:true });
    if (key === 'size') return mul * ((a.metadata?.size || 0) - (b.metadata?.size || 0));
    if (key === 'date') return mul * (new Date(a.created_at || 0) - new Date(b.created_at || 0));
    return 0;
  });
}

/* Suggested folder structure tailored to a sound tech's show */
const FICH_SUGGEST = [
  { name:'Riders',            sub:'Riders tech & hospitality', icon:'ti-file-description', color:'#ef4444' },
  { name:'Show Files',        sub:'Fichiers consoles',         icon:'ti-adjustments-alt',  color:'#ff6b1a' },
  { name:'Plans & Schemas',   sub:'Scene, site, synoptique',   icon:'ti-map-2',            color:'#22d6a0' },
  { name:'Audio',             sub:'Multipistes, virtual SC',   icon:'ti-waveform',         color:'#8b5cf6' },
  { name:'Logos & Visuels',   sub:'Logos prod, photos',        icon:'ti-photo',            color:'#ec4899' },
  { name:'Contrats & Admin',  sub:'Devis, feuilles de route',  icon:'ti-folder',           color:'#3b82f6' },
];

async function _fichCreateFolderNamed(name) {
  if (!canDo('storage')) { showUpgradeModal('storage'); return; }
  const keepPath = CUR_SHOW.id + '/' + _fichPathStr() + name + '/.keep';
  await B2Storage.upload(keepPath, new Blob(['']), { upsert: true });
}
async function fichCreateSuggested(name) {
  await _fichCreateFolderNamed(name);
  toast('✓ Dossier « ' + name + ' » créé');
  await loadFichiers();
}
async function fichCreateAllSuggested() {
  if (!canDo('storage')) { showUpgradeModal('storage'); return; }
  const status = document.getElementById('fich-upload-status');
  if (status) status.style.display = '';
  for (const s of FICH_SUGGEST) await _fichCreateFolderNamed(s.name);
  if (status) status.style.display = 'none';
  toast('✓ Arborescence créée');
  await loadFichiers();
}

async function renameFichier(relPath) {
  const filename = relPath.split('/').pop();
  const display = _fichDisplayName(filename);
  const dot = display.lastIndexOf('.');
  const base = dot > 0 ? display.slice(0, dot) : display;
  const ext  = dot > 0 ? display.slice(dot) : '';
  const nv = await _promptModal('Renommer le fichier', 'Nouveau nom :', base);
  if (nv === null) return;
  const clean = nv.trim();
  if (!clean || clean === base) return;
  /* Build paths directly from relPath — no dependency on current _fichPath state */
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const prefix = filename.indexOf('_') > -1 ? filename.slice(0, filename.indexOf('_') + 1) : '';
  const oldPath = CUR_SHOW.id + '/' + relPath;
  const newPath = CUR_SHOW.id + '/' + dir + prefix + clean + ext;
  const { error } = await B2Storage.move(oldPath, newPath);
  if (error) { toast('Erreur renommage : ' + error.message); return; }
  _fichMarkGone(oldPath); // empêche la réconciliation de recréer l'ancien nom
  // Sync Supabase
  await _sfMoveFile(oldPath, newPath).catch(() => {});
  toast('Fichier renomme');
  await loadFichiers();
}

/* ── Déplacer un fichier dans un dossier ── */
let _fichMoveRelPath = null; // chemin relatif du fichier en cours de déplacement

function openMoveFichier(event, relPath) {
  _fichMoveRelPath = relPath;
  const pop = document.getElementById('fich-move-pop');
  const lst = document.getElementById('fich-move-list');
  if (!pop || !lst) return;

  /* Construire la liste des destinations disponibles :
     - Racine du show (si on n'y est pas déjà)
     - Tous les dossiers du niveau courant (sauf le dossier actuel du fichier)
     - Dossier parent (si on est dans un sous-dossier) */
  const currentDir = _fichPathStr(); // chemin du dossier affiché actuellement
  const fileDir    = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const allFolders = SHOW_FILES.filter(f => f.id === null);
  let items = [];

  // Racine (si le fichier n'est pas déjà à la racine)
  if (fileDir !== '') {
    items.push({ label: 'Racine', path: '', icon: 'ti-home' });
  }

  // Dossier parent (si on est dans un sous-dossier et que le fichier n'y est pas déjà)
  if (_fichPath.length > 0) {
    const parentPath = _fichPath.slice(0, -1).join('/') + (_fichPath.length > 1 ? '/' : '');
    if (parentPath !== fileDir) {
      const parentName = _fichPath.length > 1 ? _fichPath[_fichPath.length - 2] : 'Racine';
      items.push({ label: '↑ ' + parentName, path: parentPath, icon: 'ti-corner-left-up' });
    }
  }

  // Dossiers du niveau courant (excluant le dossier actuel du fichier)
  allFolders.forEach(function(f) {
    const destPath = currentDir + f.name + '/';
    if (destPath !== fileDir) {
      items.push({ label: f.name, path: destPath, icon: 'ti-folder-filled' });
    }
  });

  if (items.length === 0) {
    items.push({ label: 'Aucun dossier disponible', path: null, icon: 'ti-info-circle' });
  }

  /* Utiliser data-dest plutôt que onclick inline pour éviter que les guillemets
     dans les noms de dossiers cassent l'attribut HTML. */
  lst.innerHTML = items.map(function(it) {
    const color = it.icon === 'ti-folder-filled' ? 'color:#f5c542' : 'color:var(--muted)';
    const disabled = it.path === null;
    return '<div class="fich-move-item"'
      + (disabled ? ' style="opacity:.5;cursor:default"' : ' data-dest="' + _fEsc(it.path) + '"')
      + '>'
      + '<i class="ti ' + it.icon + '" style="' + color + '"></i>'
      + '<span style="overflow:hidden;text-overflow:ellipsis">' + _fEsc(it.label) + '</span>'
      + '</div>';
  }).join('');

  // Délégation d'événements sur la liste (évite les closures par item)
  lst.onclick = function(e) {
    var item = e.target.closest('.fich-move-item[data-dest]');
    if (!item) return;
    moveFichierToFolder(item.getAttribute('data-dest'));
  };

  // Positionner le popover — au-dessus du bouton si pas assez de place en dessous
  const btn = event.currentTarget || event.target;
  const r   = btn.getBoundingClientRect();
  pop.style.top  = '-9999px'; // positionner hors écran pour mesurer la hauteur
  pop.style.left = '-9999px';
  pop.classList.add('show');
  const popH = pop.offsetHeight || 200;
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const spaceAbove = r.top - 8;
  if (spaceBelow >= popH || spaceBelow >= spaceAbove) {
    // Afficher en dessous
    pop.style.top  = (r.bottom + 4) + 'px';
  } else {
    // Afficher au-dessus
    pop.style.top  = (r.top - popH - 4) + 'px';
  }
  pop.style.left = Math.min(window.innerWidth - 200, Math.max(4, r.right - 190)) + 'px';

  // Fermer si clic ailleurs
  setTimeout(function() {
    document.addEventListener('click', _closeMovePopover, { once: true });
  }, 0);
}

function _closeMovePopover() {
  const pop = document.getElementById('fich-move-pop');
  if (pop) pop.classList.remove('show');
}

async function moveFichierToFolder(destDir) {
  _closeMovePopover();
  if (!_fichMoveRelPath || !CUR_SHOW) return;
  const relPath = _fichMoveRelPath;
  _fichMoveRelPath = null;

  const filename = relPath.split('/').pop();
  const oldFullPath = CUR_SHOW.id + '/' + relPath;
  const newFullPath = CUR_SHOW.id + '/' + destDir + filename;

  if (oldFullPath === newFullPath) return;

  const btn = document.querySelector('.fich-file-btn.mv');
  try {
    const { error } = await B2Storage.move(oldFullPath, newFullPath);
    if (error) { toast('Erreur déplacement : ' + error.message); return; }
    _fichMarkGone(oldFullPath); // évite la ré-injection de l'ancien emplacement
    // Sync Supabase
    await _sfMoveFile(oldFullPath, newFullPath).catch(() => {});
    const destLabel = destDir === '' ? 'la racine' : destDir.replace(/\/$/, '').split('/').pop();
    toast('Déplacé vers ' + destLabel + ' ✓');
    await loadFichiers();
  } catch(e) {
    toast('Erreur : ' + e.message);
  }
}

function _renderFichiersGrid() {
  const list = document.getElementById('fichiers-list');
  const dz   = document.getElementById('fichiers-drop-zone');
  const stor  = document.getElementById('fich-storage-row');
  if (!list) return;

  const folders = SHOW_FILES.filter(f => f.id === null);
  const allFiles = SHOW_FILES.filter(f => f.id !== null);

  const isEmpty = folders.length === 0 && allFiles.length === 0;
  /* Empty root → onboarding with suggested folder structure */
  if (isEmpty && _fichPath.length === 0) {
    if (dz) dz.className = 'fich-dropzone has-files';
    if (stor) stor.style.display = 'none';
    var sg = '<div class="fich-list-wrap"><div class="fich-suggest">'+
      '<div style="text-align:center;padding:14px 0 18px">'+
        '<i class="ti ti-cloud-plus" style="font-size:34px;color:var(--ora)"></i>'+
        '<div style="font-size:14px;font-weight:700;color:var(--txt);margin-top:8px">Votre cloud de production</div>'+
        '<div style="font-size:11px;color:var(--muted);margin-top:3px">Glissez vos fichiers ici, ou démarrez avec une arborescence prête pour le son.</div>'+
      '</div>'+
      '<div class="fich-suggest-hd"><i class="ti ti-folders"></i>Dossiers suggérés</div>'+
      '<div class="fich-suggest-grid">';
    FICH_SUGGEST.forEach(function(s){
      sg += '<button class="fich-suggest-card" onclick="fichCreateSuggested(\'' + s.name.replace(/'/g,"\\'") + '\')">'+
        '<div class="fich-suggest-ico" style="background:'+s.color+'1f;color:'+s.color+'"><i class="ti '+s.icon+'"></i></div>'+
        '<div><div class="fich-suggest-nm">'+s.name+'</div><div class="fich-suggest-sub">'+s.sub+'</div></div>'+
        '</button>';
    });
    sg += '</div>'+
      '<button class="btn sm fich-suggest-all" onclick="fichCreateAllSuggested()"><i class="ti ti-wand"></i> Créer toute l\'arborescence</button>'+
      '</div></div>';
    list.innerHTML = sg;
    return;
  }
  if (dz) dz.className = 'fich-dropzone has-files';

  // type filter
  let files = _fichFilter === 'all'
    ? allFiles
    : allFiles.filter(f => _fichInfoOf(_fichDisplayName(f.name)).label === _fichFilter);

  // search filter (across files + folders)
  let foldersShown = folders;
  if (_fichSearch) {
    files = files.filter(f => _fichDisplayName(f.name).toLowerCase().includes(_fichSearch));
    foldersShown = folders.filter(f => f.name.toLowerCase().includes(_fichSearch));
  }

  let html = '<div class="fich-list-wrap">';

  // dossiers (cache si filtre type actif)
  if (foldersShown.length && _fichFilter === 'all') {
    html += '<div class="fich-section-lbl"><i class="ti ti-folder" style="color:#f5c542;font-size:10px"></i>Dossiers</div>';
    _fichSortFiles(foldersShown).forEach(function(f) {
      const fnJ = _fEsc(JSON.stringify(f.name)); // HTML-escape so quotes survive inside onclick="..."
      html += '<div class="fich-file-card" onclick="_fichEnterFolder(' + fnJ + ')">' +
        '<div class="fich-file-ico ico-folder"><i class="ti ti-folder-filled fich-folder-ico"></i></div>' +
        '<div class="fich-file-info"><div class="fich-file-name">' + _fEsc(f.name) + '</div><div class="fich-file-meta">Dossier</div></div>' +
        '<div class="fich-file-actions">' +
          '<button class="fich-file-btn del" onclick="event.stopPropagation();deleteFichierFolder(' + fnJ + ')" title="Supprimer"><i class="ti ti-trash"></i></button>' +
        '</div>' +
        '</div>';
    });
  }

  // fichiers groupes
  if (files.length) {
    const groups = {};
    files.forEach(function(f) {
      const name = _fichDisplayName(f.name);
      const info = _fichInfoOf(name);
      const g = info.label;
      if (!groups[g]) groups[g] = [];
      groups[g].push({ f, name, info });
    });
    const ORDER = ['PDF','Show file','Session DAW','Audio','Image','Document','Tableur','Presentation','Video','Archive','Fichier'];
    Object.entries(groups)
      .sort(function(a,b){ return ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]); })
      .forEach(function([label, items]) {
        if (_fichFilter === 'all') {
          html += '<div class="fich-section-lbl"><i class="ti ti-tag" style="font-size:9px;color:var(--muted)"></i>' + label + ' <span style="color:var(--muted2);font-weight:400">· ' + items.length + '</span></div>';
        }
        _fichSortFiles(items.map(i => i.f)).forEach(function(f) {
          const name = _fichDisplayName(f.name);
          const info = _fichInfoOf(name);
          const size = _fmtSize(f.metadata?.size);
          const date = f.created_at ? new Date(f.created_at).toLocaleDateString('fr-FR') : '';
          const meta = [size, date ? 'Ajoute ' + date : ''].filter(Boolean).join(' · ');
          const fpJ  = _fEsc(JSON.stringify(_fichPathStr() + f.name)); // HTML-escape so quotes survive inside onclick="..."
          const isVerified = !!f.verified_at;
          const vDate = isVerified ? new Date(f.verified_at).toLocaleDateString('fr-FR') : '';
          const vTag = isVerified
            ? '<div class="fich-file-verified-tag"><i class="ti ti-rosette-discount-check"></i>Vérifié par ' + _fEsc(f.verified_by_name||'—') + ' · ' + _fEsc(vDate) + '</div>'
            : '';
          const fidJ = _fEsc(JSON.stringify(f.id||''));
          const vTitle = isVerified
            ? 'Vérifié par ' + (f.verified_by_name||'—') + ' le ' + vDate + ' — cliquer pour annuler'
            : 'Marquer comme vérifié (matériel demandé confirmé disponible)';
          html += '<div class="fich-file-card' + (isVerified?' verified':'') + '" onclick="viewFichier(' + fpJ + ')">' +
            '<div class="fich-file-ico ' + (info.cls || 'ico-other') + '">' + info.icon + '</div>' +
            '<div class="fich-file-info"><div class="fich-file-name">' + _fEsc(name) + '</div><div class="fich-file-meta">' + _fEsc(meta) + '</div>' + vTag + '</div>' +
            '<div class="fich-file-actions">' +
              '<button class="fich-file-btn vf' + (isVerified?' on':'') + '" onclick="event.stopPropagation();toggleFileVerified(' + fidJ + ',' + fpJ + ')" title="' + _fEsc(vTitle) + '"><i class="ti ' + (isVerified?'ti-rosette-discount-check-filled':'ti-rosette-discount-check') + '"></i></button>' +
              '<button class="fich-file-btn" onclick="event.stopPropagation();replaceFichier(' + fpJ + ')" title="Remplacer par une nouvelle version (même nom)"><i class="ti ti-refresh"></i></button>' +
              '<button class="fich-file-btn" onclick="event.stopPropagation();renameFichier(' + fpJ + ')" title="Renommer"><i class="ti ti-pencil"></i></button>' +
              '<button class="fich-file-btn mv" onclick="event.stopPropagation();openMoveFichier(event,' + fpJ + ')" title="Déplacer dans un dossier"><i class="ti ti-folder-share"></i></button>' +
              '<button class="fich-file-btn dl" onclick="event.stopPropagation();_fichDownload(' + fpJ + ')" title="Telecharger"><i class="ti ti-download"></i></button>' +
              '<button class="fich-file-btn del" onclick="event.stopPropagation();deleteFichier(' + fpJ + ')" title="Supprimer"><i class="ti ti-trash"></i></button>' +
            '</div>' +
            '</div>';
        });
      });
  } else if (!foldersShown.length) {
    var emptyMsg = _fichSearch ? 'Aucun résultat pour « ' + _fEsc(_fichSearch) + ' »'
                 : (_fichFilter !== 'all' ? 'Aucun fichier dans ce filtre' : 'Dossier vide');
    html += '<div class="fich-empty"><i class="ti ti-filter"></i><p style="font-size:12px">' + emptyMsg + '</p></div>';
  }

  html += '</div>';
  list.innerHTML = html;

  // barre de stockage (plan-aware)
  const plan = userPlan ? userPlan() : 'free';
  const QUOTA_GO = { free: 0.5, pro: 50 };
  const quotaGo  = QUOTA_GO[plan] || 0;
  const lblEl  = document.getElementById('fich-storage-lbl');
  const fillEl = document.getElementById('fich-storage-fill');
  if (stor) {
    if (!canDo || !canDo('storage') || quotaGo === 0) {
      stor.style.display = 'none';
    } else {
      const totalBytes = allFiles.reduce(function(s, f) { return s + (f.metadata?.size || 0); }, 0);
      const totalMo = (totalBytes / 1048576).toFixed(1);
      const quotaBytes = quotaGo * 1073741824;
      const fillPct = Math.min(100, totalBytes / quotaBytes * 100).toFixed(1);
      if (lblEl)  lblEl.textContent  = totalMo + ' Mo utilises / ' + quotaGo + ' Go';
      if (fillEl) fillEl.style.width = fillPct + '%';
      stor.style.display = '';
    }
  }
}

async function _fichDownload(relPath) {
  const filename = relPath.split('/').pop();
  const displayName = _fichDisplayName(filename);
  const path = CUR_SHOW.id + '/' + relPath;
  /* downloadName → le serveur force Content-Disposition avec le nom propre
     (l'attribut a.download est ignoré cross-origin sur les URLs B2). */
  const { data, error } = await B2Storage.createSignedUrl(path, 3600, displayName);
  if (error || !data?.signedUrl) { toast('Erreur telechargement'); return; }
  const a = document.createElement('a');
  a.href = data.signedUrl; a.download = displayName; a.target = '_blank'; a.click();
}

function fichImportClick() {
  if(!canDo('storage')){showUpgradeModal('storage');return;}
  document.getElementById('fichiers-file-input')?.click();
}

function initFichiersDrop() {
  if (_fichInited) return;
  _fichInited = true;
  const dz = document.getElementById('fichiers-drop-zone');
  const inp = document.getElementById('fichiers-file-input');
  const panel = document.getElementById('panel-fichiers');

  const doUpload = files => { if (files.length) _uploadFichiers([...files]); };

  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); doUpload(e.dataTransfer.files); });
    dz.addEventListener('click', () => inp?.click());
  }
  if (inp) inp.addEventListener('change', e => { doUpload(e.target.files); inp.value = ''; });
  const rinp = document.getElementById('fich-replace-input');
  if (rinp) rinp.addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) _doReplaceFichier(f); });
  if (panel) {
    panel.addEventListener('dragover', e => e.preventDefault());
    panel.addEventListener('drop', e => { e.preventDefault(); doUpload(e.dataTransfer.files); });
  }
}

/* Cherche dans le dossier courant un fichier (pas un dossier) qui porte le même
   nom affiché — sert à détecter un doublon avant l'upload. */
function _fichFindByDisplay(displayName) {
  const dn = (displayName || '').toLowerCase();
  return SHOW_FILES.find(f => !f._isFolder && f.id !== null
    && _fichDisplayName(f.name).toLowerCase() === dn) || null;
}
function _fichSplitName(name) {
  const dot = name.lastIndexOf('.');
  return { base: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot) : '' };
}
/* Propose « bon (2).pdf », « bon (3).pdf »… jusqu'à un nom libre dans le dossier. */
function _fichUniqueDisplayName(displayName) {
  const { base, ext } = _fichSplitName(displayName);
  const taken = new Set(SHOW_FILES.filter(f => !f._isFolder)
    .map(f => _fichDisplayName(f.name).toLowerCase()));
  let n = 2, cand = displayName;
  while (taken.has(cand.toLowerCase()) && n < 999) { cand = base + ' (' + n + ')' + ext; n++; }
  return cand;
}

async function _uploadFichiers(files) {
  if (!CUR_SHOW || !files.length) return;
  if (!canDo('storage')) { showUpgradeModal('storage'); return; }
  const status = document.getElementById('fich-upload-status');
  let ok = 0, replaced = 0;
  for (const file of files) {
    let displayName = file.name;
    let replacePath = null, oldSize = 0;

    /* Doublon : un fichier du même nom existe déjà dans ce dossier ? */
    const existing = _fichFindByDisplay(displayName);
    if (existing) {
      const choice = await _dupFileModal(displayName);
      if (choice === 'cancel') continue;
      if (choice === 'replace') {
        replacePath = existing._path;
        oldSize = existing.metadata?.size || 0;
      } else { /* rename : garder les deux */
        const sug = _fichSplitName(_fichUniqueDisplayName(displayName));
        const nv = await _promptModal('Renommer le fichier', 'Nouveau nom :', sug.base);
        if (nv === null) continue;
        const clean = (nv || '').trim();
        if (!clean) continue;
        displayName = clean + sug.ext;
      }
    }

    /* Quota : on ne compte que le surplus réel (taille - ancienne version). */
    if (!await _quotaCheck(Math.max(0, file.size - oldSize))) break;
    if (status) status.style.display = '';

    let uploadPath, isReplace = !!replacePath;
    if (isReplace) {
      uploadPath = replacePath; // même clé B2 → on écrase le contenu, on garde le nom
    } else {
      const prefix = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      uploadPath = _fichFullPath(prefix + '_' + displayName);
    }

    const { error } = await B2Storage.upload(uploadPath, file, { upsert: isReplace });
    if (error) { toast('Erreur upload : ' + error.message); continue; }
    ok++;
    _storageCache = null;
    if (isReplace) {
      replaced++;
      _signedUrlCache.delete(uploadPath); // l'aperçu doit refléter la nouvelle version
      /* Met à jour la ligne : taille, type, date, et retire la vérification
         (c'est une nouvelle version, à re-vérifier). */
      await sb.from('show_files').update({
        size: file.size || 0, content_type: file.type || '',
        created_at: new Date().toISOString(),
        verified_at: null, verified_by: null, verified_by_name: null,
      }).eq('show_id', CUR_SHOW.id).eq('path', uploadPath).then(() => {}, () => {});
      B2Storage.purgeOldVersions(uploadPath).catch(() => {}); // purge l'ancienne version B2
    } else {
      _sfUpsertFile(uploadPath, file).catch(() => {}); // sync Supabase, non bloquant
    }
  }
  if (status) status.style.display = 'none';
  if (ok) {
    const added = ok - replaced;
    let msg = [];
    if (added) msg.push(added === 1 ? '✓ Fichier importé' : '✓ ' + added + ' fichiers importés');
    if (replaced) msg.push(replaced === 1 ? '✓ Fichier mis à jour' : '✓ ' + replaced + ' fichiers mis à jour');
    toast(msg.join(' · '));
  }
  await loadFichiers();
}

/* ── Remplacer un fichier précis par une nouvelle version (même nom, même place) ── */
let _fichReplaceTarget = null;
function replaceFichier(relPath) {
  if (!canDo('storage')) { showUpgradeModal('storage'); return; }
  _fichReplaceTarget = relPath;
  const inp = document.getElementById('fich-replace-input');
  if (inp) { inp.value = ''; inp.click(); }
}
async function _doReplaceFichier(file) {
  const relPath = _fichReplaceTarget; _fichReplaceTarget = null;
  if (!file || !relPath || !CUR_SHOW) return;
  const fullPath = CUR_SHOW.id + '/' + relPath;
  const display = _fichDisplayName(relPath.split('/').pop());
  const cur = SHOW_FILES.find(f => f._path === fullPath);
  const oldSize = cur?.metadata?.size || 0;
  if (!await _quotaCheck(Math.max(0, file.size - oldSize))) return;
  const status = document.getElementById('fich-upload-status');
  if (status) status.style.display = '';
  const { error } = await B2Storage.upload(fullPath, file, { upsert: true });
  if (status) status.style.display = 'none';
  if (error) { toast('Erreur remplacement : ' + error.message); return; }
  _storageCache = null;
  _signedUrlCache.delete(fullPath);
  await sb.from('show_files').update({
    size: file.size || 0, content_type: file.type || '',
    created_at: new Date().toISOString(),
    verified_at: null, verified_by: null, verified_by_name: null,
  }).eq('show_id', CUR_SHOW.id).eq('path', fullPath).then(() => {}, () => {});
  B2Storage.purgeOldVersions(fullPath).catch(() => {}); // purge l'ancienne version B2
  toast('✓ « ' + display +' » mis à jour');
  await loadFichiers();
}

async function createFichierFolder() {
  const name = prompt('Nom du dossier :');
  if (!name?.trim()) return;
  const clean = name.trim().replace(/[/\\?%*:|"<>]/g, '_');
  const keepPath = _fichFullPath(clean + '/.keep');
  const { error } = await B2Storage.upload(keepPath, new Blob(['']), { upsert: true });
  if (error) { toast('Erreur : ' + error.message); return; }
  // Sync Supabase : entrée dossier virtuelle
  await _sfUpsertFolder(keepPath, clean);
  toast('✓ Dossier « ' + clean + ' » créé');
  await loadFichiers();
}

async function deleteFichierFolder(folderName) {
  if (!CUR_SHOW) return;
  if (!await _confirmModal('Supprimer « ' + folderName + ' » ?', 'Tout le contenu du dossier sera supprimé.')) return;
  const folderRelPath = _fichPathStr() + folderName;
  // 1. Récupérer les paths depuis Supabase (plus rapide que B2 list)
  const { data: sfFiles } = await sb.from('show_files')
    .select('path')
    .eq('show_id', CUR_SHOW.id)
    .or(`folder.eq.${folderRelPath},folder.like.${folderRelPath}/%,path.eq.${CUR_SHOW.id}/${folderRelPath}`);
  // 2. Supprimer de B2 (fichiers réels + .keep)
  const b2Paths = (sfFiles || []).map(f => f.path);
  // Ajouter le .keep du dossier lui-même
  b2Paths.push(_fichFullPath(folderName + '/.keep'));
  if (b2Paths.length) await B2Storage.remove(b2Paths).catch(() => {});
  // 3. Sync Supabase
  await _sfDeleteFolder(folderRelPath);
  toast('✓ Dossier supprimé');
  await loadFichiers();
}

/* Marque/démarque un fichier comme "vérifié" — confirmation qu'on a bien
   consulté le document (ex: fiche technique) et que le matériel demandé sera
   disponible. Ouvert à tout membre du show (pas réservé au propriétaire),
   via la RPC restreinte set_file_verified (cf. migration 20260616). */
async function toggleFileVerified(fileId, relPath) {
  if (!CUR_SHOW) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId || '')) {
    // Fichier pas encore synchronisé dans show_files (upload tout juste fait,
    // backfill en cours) → rafraîchir pour récupérer le vrai id puis réessayer.
    toast('Synchronisation en cours… réessayez dans un instant.');
    loadFichiers();
    return;
  }
  const entry = SHOW_FILES.find(f => f.id === fileId);
  const nextVerified = !(entry && entry.verified_at);
  const { data, error } = await sb.rpc('set_file_verified', { p_file_id: fileId, p_verified: nextVerified });
  if (error) { toast('Erreur : ' + error.message); return; }
  if (data && data.ok === false) {
    toast(data.error === 'forbidden' ? 'Action non autorisée.' : 'Fichier introuvable.');
    return;
  }
  if (entry) {
    entry.verified_at      = nextVerified ? (data?.verified_at || new Date().toISOString()) : null;
    entry.verified_by_name = nextVerified ? (data?.verified_by_name || null) : null;
  }
  _renderFichiersGrid();
  toast(nextVerified ? '✓ Fichier marqué vérifié' : 'Vérification retirée');
}

async function deleteFichier(relPath) {
  if (!CUR_SHOW) return;
  const displayName = _fichDisplayName(relPath.split('/').pop());
  if (!await _confirmModal('Supprimer « ' + displayName + ' » ?', 'Cette action est irréversible.')) return;
  const fullPath = CUR_SHOW.id + '/' + relPath;
  const { error } = await B2Storage.remove([fullPath]);
  if (error) { toast('Erreur : ' + error.message); return; }
  _fichMarkGone(fullPath); // évite la ré-injection par la réconciliation B2
  // Sync Supabase
  await _sfDeleteFile(fullPath);
  toast('Fichier supprimé');
  await loadFichiers();
}

async function viewFichier(relPath) {
  const filename = relPath.split('/').pop();
  const displayName = _fichDisplayName(filename);
  const path = CUR_SHOW.id + '/' + relPath;

  const { data, error } = await B2Storage.createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) { toast('Erreur : ' + (error?.message || 'URL invalide')); return; }
  _openFileViewer(data.signedUrl, displayName, { b2Path: path });
}

/* Ouvre un fichier dans la visionneuse modale partagée (PDF.js, image, vidéo,
   audio, docx, tableur, texte) à partir d'une URL DÉJÀ signée. Utilisé par la
   section Fichiers (édition possible) ET par la vue rider partagée
   (opts.readonly → les éditeurs lourds sont ouverts en téléchargement). */
function _openFileViewer(url, displayName, opts){
  opts = opts || {};
  const info = (typeof _fichInfoOf==='function') ? _fichInfoOf(displayName) : {preview:'none'};
  const path = opts.b2Path || '';
  const modal = document.getElementById('fich-viewer-modal');
  const titleEl = document.getElementById('fich-viewer-title');
  const content = document.getElementById('fich-viewer-content');
  const dlLink = document.getElementById('fich-viewer-dl');
  if (!modal || !content) { try{ window.open(url,'_blank'); }catch(e){} return; }

  /* Éditeurs lourds (docx/odt/xlsx/texte) en lecture seule, ou type sans aperçu
     → ouverture/téléchargement dans un nouvel onglet. */
  const heavyEditable = (info.preview==='docx'||info.preview==='odt'||info.preview==='xlsx'||info.preview==='text');
  if (info.preview === 'none' || (opts.readonly && heavyEditable)) {
    const a = document.createElement('a');
    a.href = url; a.download = displayName; a.target = '_blank'; a.rel = 'noopener'; a.click();
    return;
  }

  if (titleEl) titleEl.textContent = displayName;
  if (dlLink) { dlLink.href = url; dlLink.download = displayName; }

  if (info.preview === 'pdf') {
    modal.style.display = 'flex';
    _openPdfJs(url, content);
    return;
  } else if (info.preview === 'video') {
    content.innerHTML = '<video controls autoplay src="' + url + '"></video>';
  } else if (info.preview === 'audio') {
    content.innerHTML = '<div class="fich-audio-wrap"><audio controls autoplay src="' + url + '"></audio></div>';
  } else if (info.preview === 'image') {
    content.innerHTML = '<img src="' + url + '" alt="' + _fEsc(displayName) + '" style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px;display:block;margin:0 auto"/>';
  } else if (info.preview === 'docx') {
    modal.style.display = 'flex';
    _openDocxViewer(url, displayName, path, content);
    return;
  } else if (info.preview === 'odt') {
    modal.style.display = 'flex';
    _openOdtViewer(url, displayName, path, content);
    return;
  } else if (info.preview === 'xlsx') {
    modal.style.display = 'flex';
    _openXlsxViewer(url, displayName, path, content);
    return;
  } else if (info.preview === 'text') {
    modal.style.display = 'flex';
    content.innerHTML = '<div style="flex:1;overflow:auto;padding:0"><textarea id="fich-txt-editor" style="width:100%;height:100%;background:#1a1a2e;color:#e2e8f0;font-family:\'DM Mono\',monospace;font-size:13px;padding:24px;border:none;outline:none;resize:none;line-height:1.6"></textarea></div>';
    fetch(url).then(function(r){ return r.text(); }).then(function(t){
      var ta = document.getElementById('fich-txt-editor');
      if(ta){ ta.value = t; ta.dataset.orig = t; }
    });
    return;
  }

  modal.style.display = 'flex';
}


/* ── PDF.js lazy-loader ───────────────────────────────────────────── */
const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN     = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER  = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

function _loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = function(){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function _openPdfJs(url, container){
  container.innerHTML = '<div class="fich-pdf-loading"><div class="spinner"></div><span>Chargement du PDF…</span></div>';
  try {
    const pdfjs = await _loadPdfJs();
    const pdf   = await pdfjs.getDocument({ url }).promise;
    container.innerHTML = '';

    /* Barre de navigation */
    const nav = document.createElement('div');
    nav.className = 'fich-pdf-nav';
    nav.innerHTML =
      '<button class="btn ghost sm" id="pdf-prev" onclick="_pdfPage(-1)" title="Page précédente"><i class="ti ti-chevron-left"></i></button>' +
      '<span id="pdf-page-info" class="fich-pdf-pageinfo">1 / ' + pdf.numPages + '</span>' +
      '<button class="btn ghost sm" id="pdf-next" onclick="_pdfPage(1)" title="Page suivante"><i class="ti ti-chevron-right"></i></button>' +
      '<span class="fich-pdf-nav-sep"></span>' +
      '<button class="btn ghost sm" onclick="_pdfZoom(-0.25)" title="Zoom -"><i class="ti ti-zoom-out"></i></button>' +
      '<span id="pdf-zoom-info" class="fich-pdf-pageinfo">100%</span>' +
      '<button class="btn ghost sm" onclick="_pdfZoom(0.25)" title="Zoom +"><i class="ti ti-zoom-in"></i></button>' +
      '<button class="btn ghost sm" onclick="_pdfFit()" title="Ajuster"><i class="ti ti-arrows-maximize"></i></button>';
    container.appendChild(nav);

    const wrap = document.createElement('div');
    wrap.className = 'fich-pdf-wrap';
    container.appendChild(wrap);

    const inner = document.createElement('div');
    inner.className = 'fich-pdf-inner';
    wrap.appendChild(inner);

    /* Badge zoom : s'affiche brièvement au centre après chaque changement */
    const badge = document.createElement('div');
    badge.className = 'fich-pdf-zoom-badge';
    container.appendChild(badge);

    /* Détection tactile/mobile : pilote le mode d'interaction (pan/zoom transform). */
    const isTouch = window.matchMedia('(max-width:767px)').matches ||
      ((navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(pointer:coarse)').matches);

    window._pdfState = { pdf, page:1, wrap, inner, badge, pageEls:[], observer:null,
                         zoomBy:null, fitView:null, goPage:null, _cleanup:null };

    let _badgeTimer = null;
    function _showBadge(z){
      badge.textContent = Math.round(z*100)+'%';
      badge.classList.add('show');
      clearTimeout(_badgeTimer);
      _badgeTimer = setTimeout(()=>badge.classList.remove('show'), 900);
      const zi = document.getElementById('pdf-zoom-info');
      if(zi) zi.textContent = Math.round(z*100)+'%';
    }

    /* ── Construit une page (canvas HD + calque texte) à l'échelle CSS donnée ── */
    async function _buildPage(i, cssScale, backDpr){
      const pg  = await pdf.getPage(i);
      const vVp = pg.getViewport({ scale: cssScale });
      const cVp = pg.getViewport({ scale: cssScale * backDpr });

      const pageEl = document.createElement('div');
      pageEl.className = 'fich-pdf-page';
      pageEl.dataset.page = i;
      pageEl.style.width  = vVp.width  + 'px';
      pageEl.style.height = vVp.height + 'px';

      const canvas = document.createElement('canvas');
      canvas.className = 'fich-pdf-canvas';
      canvas.width  = cVp.width;
      canvas.height = cVp.height;
      canvas.style.width  = vVp.width  + 'px';
      canvas.style.height = vVp.height + 'px';
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: cVp }).promise;

      const textDiv = document.createElement('div');
      textDiv.className = 'fich-pdf-text';
      textDiv.style.width  = vVp.width  + 'px';
      textDiv.style.height = vVp.height + 'px';
      textDiv.style.zIndex = '2';
      try {
        if(typeof pdfjs.renderTextLayer === 'function'){
          const rt = pdfjs.renderTextLayer({
            textContentSource: pg.streamTextContent({ includeMarkedContent: true }),
            container: textDiv, viewport: vVp, textDivs: []
          });
          const p = rt && (rt.promise || (typeof rt.then === 'function' ? rt : null));
          if(p) await p;
        } else {
          const tc = await pg.getTextContent();
          const U = pdfjs.Util;
          tc.items.forEach(function(item){
            if(!item.str) return;
            var tx = U.transform(vVp.transform, item.transform);
            var h = Math.hypot(tx[2], tx[3]);
            var angle = Math.atan2(tx[1], tx[0]);
            var sp = document.createElement('span');
            sp.textContent = item.str;
            var css = 'position:absolute;color:transparent;white-space:pre;cursor:text;transform-origin:0% 0%;' +
              'left:' + tx[4] + 'px;top:' + (vVp.height - tx[5]) + 'px;font-size:' + h + 'px;';
            if(Math.abs(angle) > 0.001) css += 'transform:rotate(' + (-angle) + 'rad);';
            sp.style.cssText = css;
            textDiv.appendChild(sp);
          });
        }
      } catch(_){}
      canvas.style.zIndex = '1';
      pageEl.appendChild(canvas);
      pageEl.appendChild(textDiv);
      return pageEl;
    }

    if(isTouch) await _setupTouch();
    else        await _setupDesktop();

    /* ════════════════════════════════════════════════════════════════
       MODE TACTILE (téléphone / tablette)
       Pages rastérisées UNE SEULE FOIS à la largeur de l'écran. Le zoom
       et le déplacement passent par un transform CSS (GPU) — jamais de
       re-rendu à haute résolution, donc pas de canvas vide ni de saut.
         écran = translate(tx,ty) · scale(s) · contenu   (origine 0 0)
       ════════════════════════════════════════════════════════════════ */
    async function _setupTouch(){
      wrap.style.overflow   = 'hidden';
      wrap.style.padding     = '0';
      wrap.style.touchAction = 'none';
      inner.style.transformOrigin = '0 0';
      inner.style.willChange = 'transform';
      inner.style.alignItems = 'stretch';

      const dpr = Math.min(window.devicePixelRatio || 1, 2); // plafonné → mémoire maîtrisée
      let Wv = wrap.clientWidth, Hv = wrap.clientHeight;

      async function raster(){
        inner.innerHTML = '';
        window._pdfState.pageEls = [];
        Wv = wrap.clientWidth; Hv = wrap.clientHeight;
        for(let i=1;i<=pdf.numPages;i++){
          const pg  = await pdf.getPage(i);
          const vp1 = pg.getViewport({ scale:1 });
          const fit = Wv / vp1.width;             // la page remplit la largeur de l'écran
          const el  = await _buildPage(i, fit, dpr);
          el.dataset.fit = fit;                   // échelle CSS de référence (largeur écran)
          const cv = el.querySelector('canvas');
          if(cv) cv.dataset.rscale = dpr;         // multiple de rastérisation courant
          inner.appendChild(el);
          window._pdfState.pageEls.push(el);
        }
      }
      await raster();

      /* État du transform */
      let s = 1, tx = 0, ty = 0;
      const MINS = 1, MAXS = 4;
      function contentH(){ return inner.offsetHeight; }   // hauteur non transformée
      function clamp(){
        const sw = Wv * s, sh = contentH() * s;
        if(sw <= Wv) tx = (Wv - sw) / 2;
        else tx = Math.min(0, Math.max(Wv - sw, tx));
        if(sh <= Hv) ty = 0;
        else ty = Math.min(0, Math.max(Hv - sh, ty));
      }
      function updateCounter(){
        const els = window._pdfState.pageEls;
        const centerY = (Hv/2 - ty) / s;   // coord. contenu au centre de l'écran
        let p = 1;
        for(let k=0;k<els.length;k++){
          if(els[k].offsetTop <= centerY) p = k+1; else break;
        }
        window._pdfState.page = p;
        const info = document.getElementById('pdf-page-info');
        if(info) info.textContent = p + ' / ' + pdf.numPages;
      }
      function apply(){
        clamp();
        inner.style.transform = 'translate('+tx+'px,'+ty+'px) scale('+s+')';
        updateCounter();
        scheduleSharpen();
      }

      /* ── Netteté : re-rastérise les pages VISIBLES à la résolution écran réelle ──
         Le transform CSS étire le bitmap → flou au-delà de la rastérisation de
         base. Après stabilisation du zoom (debounce), on re-rend uniquement les
         pages à l'écran à un multiple proche de dpr×zoom (plafonné pour iOS), et
         on redescend les pages hors-champ à la base → mémoire bornée (canvas HD
         limités à 2-3 pages). Géométrie inchangée : seule la finesse du canvas
         augmente, le calque texte et le layout ne bougent pas. */
      const MAXDIM = 4096, MAXAREA = 12e6;
      let _shToken = 0, _shTimer = null;
      function scheduleSharpen(){ clearTimeout(_shTimer); _shTimer = setTimeout(sharpen, 200); }
      function pageVisible(el){
        const top = ty + el.offsetTop*s, bot = top + el.offsetHeight*s;
        return bot > -60 && top < Hv + 60;
      }
      async function renderCanvasAt(el, mult, token){
        const num = parseInt(el.dataset.page), fit = parseFloat(el.dataset.fit);
        const old = el.querySelector('canvas'); if(!old) return;
        const pg  = await pdf.getPage(num);
        const cVp = pg.getViewport({ scale: fit*mult });
        const nc  = document.createElement('canvas');   // rendu hors-écran → pas de flash
        nc.className = 'fich-pdf-canvas';
        nc.width  = Math.round(cVp.width);
        nc.height = Math.round(cVp.height);
        nc.style.width  = old.style.width;               // taille CSS inchangée (fit)
        nc.style.height = old.style.height;
        nc.style.zIndex = '1';
        await pg.render({ canvasContext: nc.getContext('2d'), viewport: cVp }).promise;
        if(token !== _shToken) return;                   // un nouveau zoom est arrivé → on jette
        nc.dataset.rscale = mult;
        old.replaceWith(nc);
      }
      async function sharpen(){
        const token = ++_shToken;
        const target = Math.min(s, MAXS);
        for(const el of window._pdfState.pageEls){
          if(token !== _shToken) return;
          const cv = el.querySelector('canvas'); if(!cv) continue;
          const cur = parseFloat(cv.dataset.rscale || dpr);
          const elW = el.offsetWidth, elH = el.offsetHeight;
          if(pageVisible(el)){
            let mult = dpr * target;                      // densité écran ≈ dpr
            mult = Math.min(mult, MAXDIM/elW, MAXDIM/elH, Math.sqrt(MAXAREA/(elW*elH)), 6);
            mult = Math.max(mult, dpr);
            if(mult - cur > 0.2) await renderCanvasAt(el, mult, token);
          } else if(cur > dpr + 0.1){
            await renderCanvasAt(el, dpr, token);         // hors-champ → libère la mémoire
          }
        }
      }
      /* Zoom centré sur un point écran (fx,fy) — le contenu sous ce point reste fixe */
      function zoomAt(ns, fx, fy){
        ns = Math.max(MINS, Math.min(MAXS, ns));
        if(ns === s) return;
        const cx = (fx - tx) / s, cy = (fy - ty) / s;
        s = ns;
        tx = fx - s*cx; ty = fy - s*cy;
        apply(); _showBadge(s);
      }
      apply();

      /* ── Gestes ── */
      let mode = null;           // 'pan' | 'pinch'
      let startDist = 0, anchor = null;   // pinch
      let startX = 0, startY = 0, tx0 = 0, ty0 = 0;  // pan
      let lastTap = 0;
      const mid = t => ({ x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2 });
      const dist = t => Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY);
      const rel  = (cx,cy) => { const r = wrap.getBoundingClientRect(); return { x:cx-r.left, y:cy-r.top }; };

      function onStart(e){
        if(e.touches.length === 2){
          e.preventDefault();
          mode = 'pinch';
          startDist = dist(e.touches);
          const m = mid(e.touches), p = rel(m.x, m.y);
          anchor = { sx:p.x, sy:p.y, cx:(p.x-tx)/s, cy:(p.y-ty)/s, s0:s };
        } else if(e.touches.length === 1){
          mode = 'pan';
          const p = rel(e.touches[0].clientX, e.touches[0].clientY);
          startX = p.x; startY = p.y; tx0 = tx; ty0 = ty;
        }
      }
      function onMove(e){
        if(mode === 'pinch' && e.touches.length === 2){
          e.preventDefault();
          const ns = Math.max(MINS, Math.min(MAXS, anchor.s0 * dist(e.touches)/startDist));
          const m = mid(e.touches), p = rel(m.x, m.y);
          s = ns;
          tx = p.x - s*anchor.cx;   // garde le point de contenu ancré sous les doigts
          ty = p.y - s*anchor.cy;
          apply(); _showBadge(s);
        } else if(mode === 'pan' && e.touches.length === 1){
          const p = rel(e.touches[0].clientX, e.touches[0].clientY);
          /* Au zoom 1, un seul doigt fait défiler verticalement uniquement. */
          tx = (s > 1.001) ? tx0 + (p.x - startX) : tx;
          ty = ty0 + (p.y - startY);
          if(s > 1.001 || Math.abs(p.y - startY) > 2) e.preventDefault();
          apply();
        }
      }
      function onEnd(e){
        if(e.touches.length === 0){
          /* double-tap → bascule ajuster ↔ 2,5× sur le point touché */
          if(mode !== 'pinch' && e.changedTouches.length === 1){
            const now = Date.now();
            if(now - lastTap < 300){
              const p = rel(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
              if(s <= 1.05) zoomAt(2.5, p.x, p.y);
              else { s = 1; tx = 0; ty = 0; apply(); _showBadge(1); }
            }
            lastTap = now;
          }
          mode = null;
        } else if(e.touches.length === 1 && mode === 'pinch'){
          /* fin du pinch mais un doigt reste → passe en pan */
          mode = 'pan';
          const p = rel(e.touches[0].clientX, e.touches[0].clientY);
          startX = p.x; startY = p.y; tx0 = tx; ty0 = ty;
        }
      }
      wrap.addEventListener('touchstart', onStart, { passive:false });
      wrap.addEventListener('touchmove',  onMove,  { passive:false });
      wrap.addEventListener('touchend',   onEnd,   { passive:true });

      /* Réagencrage si rotation / redimensionnement (re-rastérise à la nouvelle largeur) */
      let _rsTimer = null;
      function onResize(){
        clearTimeout(_rsTimer);
        _rsTimer = setTimeout(async ()=>{
          /* préserve la page courante : on retient l'offset relatif avant re-raster */
          const frac = contentH() ? (-ty/s) / contentH() : 0;
          await raster();
          tx = 0; ty = -frac * contentH() * s; apply();
        }, 250);
      }
      window.addEventListener('resize', onResize);
      window._pdfState._cleanup = ()=>window.removeEventListener('resize', onResize);

      /* Boutons toolbar */
      window._pdfState.zoomBy   = d => zoomAt(s + d, Wv/2, Hv/2);
      window._pdfState.fitView  = () => { s=1; tx=0; ty=0; apply(); _showBadge(1); };
      window._pdfState.goPage   = d => {
        const n = Math.max(1, Math.min(pdf.numPages, window._pdfState.page + d));
        const el = window._pdfState.pageEls[n-1];
        if(el){ ty = -el.offsetTop * s; apply(); }
      };
    }

    /* ════════════════════════════════════════════════════════════════
       MODE BUREAU (souris) — défilement natif vertical + zoom par re-rendu
       (mémoire confortable sur desktop, texte toujours net).
       ════════════════════════════════════════════════════════════════ */
    async function _setupDesktop(){
      window._pdfState.zoom = 1.0;
      function fitScale(pg){
        const vp0 = pg.getViewport({ scale:1 });
        return Math.min(Math.max(inner.clientWidth || 300, 300) / vp0.width, 1.5);
      }
      async function renderAll(zoom){
        if(window._pdfState.observer){ window._pdfState.observer.disconnect(); window._pdfState.observer = null; }
        inner.innerHTML = '';
        window._pdfState.pageEls = [];
        zoom = zoom !== undefined ? zoom : (window._pdfState.zoom || 1.0);
        window._pdfState.zoom = zoom;
        _showBadge(zoom);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for(let i=1;i<=pdf.numPages;i++){
          const pg  = await pdf.getPage(i);
          const el  = await _buildPage(i, fitScale(pg)*zoom, dpr);
          inner.appendChild(el);
          window._pdfState.pageEls.push(el);
        }
        const obs = new IntersectionObserver(function(entries){
          var best=null, bestR=0;
          entries.forEach(function(e){ if(e.intersectionRatio>bestR){ bestR=e.intersectionRatio; best=e.target; } });
          if(best){
            var p = parseInt(best.dataset.page);
            window._pdfState.page = p;
            var info = document.getElementById('pdf-page-info');
            if(info) info.textContent = p + ' / ' + pdf.numPages;
          }
        }, { root: wrap, threshold:[0.1,0.3,0.5,0.7,0.9] });
        window._pdfState.pageEls.forEach(el=>obs.observe(el));
        window._pdfState.observer = obs;
      }
      window._pdfState.zoomBy  = d => renderAll(Math.max(0.4, Math.min(3.5, (window._pdfState.zoom||1)+d)));
      window._pdfState.fitView = () => { window._pdfState.zoom=1; renderAll(1); };
      window._pdfState.goPage  = d => {
        const n = Math.max(1, Math.min(pdf.numPages, window._pdfState.page + d));
        if(n === window._pdfState.page) return;
        window._pdfState.page = n;
        const el = window._pdfState.pageEls[n-1];
        if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
      };
      await renderAll(1);
    }

  } catch(e) {
    container.innerHTML = '<div class="fich-pdf-loading" style="flex-direction:column;gap:10px"><i class="ti ti-file-broken" style="font-size:36px;opacity:.4"></i><span style="font-size:12px">Impossible d\'ouvrir ce PDF<br/><span style="opacity:.6">' + e.message + '</span></span></div>';
  }
}

function _pdfPage(delta){ var s = window._pdfState; if(s && s.goPage)  s.goPage(delta); }
function _pdfZoom(delta){ var s = window._pdfState; if(s && s.zoomBy)  s.zoomBy(delta); }
function _pdfFit(){       var s = window._pdfState; if(s && s.fitView) s.fitView(); }

function closeFichierViewer() {
  var modal   = document.getElementById('fich-viewer-modal');
  var content = document.getElementById('fich-viewer-content');
  if(modal)   modal.style.display = 'none';
  if(content) content.innerHTML   = '';
  if(window._pdfState){
    if(window._pdfState.observer) window._pdfState.observer.disconnect();
    if(window._pdfState._cleanup) window._pdfState._cleanup();
  }
  window._pdfState  = null;
  window._xlsxState = null;
}

/* ════════════════════════════════════════════════════════
   WORD (.docx) VIEWER — mammoth.js (lazy-loaded)
   Rendu HTML + édition basique via contenteditable,
   sauvegarde en re-uploadant le fichier modifié vers B2.
   ════════════════════════════════════════════════════════ */
function _loadMammoth(){
  if(window.mammoth) return Promise.resolve(window.mammoth);
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
    s.onload=function(){ resolve(window.mammoth); };
    s.onerror=reject;
    document.head.appendChild(s);
  });
}

async function _openDocxViewer(url, displayName, b2Path, container){
  container.innerHTML='<div class="fich-pdf-loading"><div class="spinner"></div><span>Chargement du document…</span></div>';
  try{
    const mammoth = await _loadMammoth();
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuf });

    container.innerHTML=
      '<div class="fich-docx-bar">'
        +'<span class="fich-docx-status" id="docx-status">Lecture seule — cliquez dans le document pour modifier</span>'
        +'<button class="btn sm" id="docx-save-btn" onclick="_saveDocxEdits(\''+_fEsc(b2Path)+'\',\''+_fEsc(displayName)+'\')" style="display:none"><i class="ti ti-device-floppy"></i>Enregistrer</button>'
        +'<a class="btn ghost sm" href="'+url+'" download="'+_fEsc(displayName)+'" target="_blank"><i class="ti ti-download"></i>Télécharger</a>'
      +'</div>'
      +'<div class="fich-docx-wrap">'
        +'<div class="fich-docx-body" id="docx-body" contenteditable="true" '
          +'oninput="document.getElementById(\'docx-status\').textContent=\'Modifié — pensez à enregistrer\';document.getElementById(\'docx-save-btn\').style.display=\'\';">'
          +result.value
        +'</div>'
      +'</div>';

    if(result.messages.length){
      console.warn('[docx] warnings:', result.messages.map(function(m){ return m.message; }));
    }
  }catch(e){
    container.innerHTML='<div class="fich-pdf-loading" style="flex-direction:column;gap:10px"><i class="ti ti-file-broken" style="font-size:36px;opacity:.4"></i><span style="font-size:12px">Impossible d\'ouvrir ce document<br><span style="opacity:.6">'+_fEsc(e.message)+'</span></span></div>';
  }
}

async function _saveDocxEdits(b2Path, displayName){
  const body = document.getElementById('docx-body');
  const btn  = document.getElementById('docx-save-btn');
  const status = document.getElementById('docx-status');
  if(!body||!btn) return;
  btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>';

  try{
    /* Exporter le HTML édité en blob texte (fallback simple) puis upload */
    const htmlContent='<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+_fEsc(displayName)+'</title></head><body>'+body.innerHTML+'</body></html>';
    const blob = new Blob([htmlContent],{type:'text/html'});

    /* Upload en remplaçant le fichier — renommer en .html si le nom était .docx */
    var savePath = b2Path;
    if(savePath.match(/\.(doc|docx|odt|rtf)$/i)){
      savePath = savePath.replace(/\.(doc|docx|odt|rtf)$/i,'.html');
    }
    const {data:upData,error:upErr} = await B2Storage.uploadPresigned(savePath, blob.size, 'text/html');
    if(upErr||!upData?.uploadUrl){ throw new Error(upErr?.message||'Upload impossible'); }
    const putRes = await fetch(upData.uploadUrl,{method:'PUT',body:blob,headers:{'Content-Type':'text/html'}});
    if(!putRes.ok) throw new Error('PUT failed '+putRes.status);

    status.textContent='Enregistré ✓';
    btn.style.display='none';
    if(savePath!==b2Path) toast('Sauvegardé en HTML (format .docx non modifiable en natif)');
    else toast('Document enregistré ✓');
    btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>Enregistrer';
    loadFichiers();
  }catch(e){
    toast('Erreur enregistrement : '+e.message);
    btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>Enregistrer';
  }
}

/* ════════════════════════════════════════════════════════
   OPENDOCUMENT TEXTE (.odt) VIEWER — parseur maison (JSZip + DOMParser)
   mammoth.js ne lit QUE l'OOXML (.docx) et échoue sur l'OpenDocument
   (.odt) : structure XML totalement différente (« Could not find main
   document part »). On lit nous-mêmes content.xml/styles.xml et on les
   convertit en HTML (paragraphes, titres, gras/italique/souligné,
   listes à puces/numérotées, tableaux, liens). Lecture seule (pas
   d'écriture ODF en v1 — pas de bouton Enregistrer pour ce format).
   ════════════════════════════════════════════════════════ */
function _loadJSZip(){
  if(window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload=function(){ resolve(window.JSZip); };
    s.onerror=reject;
    document.head.appendChild(s);
  });
}

async function _openOdtViewer(url, displayName, b2Path, container){
  container.innerHTML='<div class="fich-pdf-loading"><div class="spinner"></div><span>Chargement du document…</span></div>';
  try{
    const JSZip = await _loadJSZip();
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuf);

    const contentFile = zip.file('content.xml');
    if(!contentFile) throw new Error('Fichier ODT invalide (content.xml manquant)');
    const contentXml = await contentFile.async('string');
    const stylesFile = zip.file('styles.xml');
    const stylesXml = stylesFile ? await stylesFile.async('string') : '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(contentXml, 'application/xml');
    const stylesDoc = stylesXml ? parser.parseFromString(stylesXml, 'application/xml') : null;
    if(doc.querySelector('parsererror')) throw new Error('Document XML invalide');

    /* ── Styles caractère (gras/italique/souligné) + listes ordonnées,
       fusionnés depuis content.xml (styles automatiques) et styles.xml
       (styles nommés). Pas de résolution d'héritage parent — suffisant
       pour la plupart des exports LibreOffice/Word réels. ── */
    const byLocalName = (d, n) => d ? Array.prototype.slice.call(d.getElementsByTagNameNS('*', n)) : [];
    const charStyles = {};
    byLocalName(doc,'style').concat(byLocalName(stylesDoc,'style')).forEach(function(st){
      const name = st.getAttribute('style:name');
      if(!name) return;
      let tp=null;
      for(let i=0;i<st.children.length;i++){ if(st.children[i].localName==='text-properties'){ tp=st.children[i]; break; } }
      if(!tp) return;
      charStyles[name] = {
        bold: /bold|^[789]00$/.test(tp.getAttribute('fo:font-weight')||''),
        italic: (tp.getAttribute('fo:font-style')||'')==='italic',
        underline: (tp.getAttribute('style:text-underline-style')||'none')!=='none',
      };
    });
    const orderedListStyles = {};
    byLocalName(doc,'list-style').concat(byLocalName(stylesDoc,'list-style')).forEach(function(ls){
      const name = ls.getAttribute('style:name');
      if(!name) return;
      let ordered=false;
      for(let i=0;i<ls.children.length;i++){ if(ls.children[i].localName==='list-level-style-number'){ ordered=true; break; } }
      orderedListStyles[name]=ordered;
    });

    const SKIP_TAGS = new Set(['annotation','annotation-end','tracked-changes','change','change-start','change-end','sequence-decls']);

    function convertChildren(node){
      let html='';
      for(let i=0;i<node.childNodes.length;i++) html += convertNode(node.childNodes[i]);
      return html;
    }
    function convertNode(node){
      if(node.nodeType===3) return _fEsc(node.nodeValue);
      if(node.nodeType!==1) return '';
      const tag = node.localName;
      if(SKIP_TAGS.has(tag)) return '';
      switch(tag){
        case 'p': return '<p>'+convertChildren(node)+'</p>';
        case 'h': {
          let lvl=parseInt(node.getAttribute('text:outline-level')||'1',10);
          lvl=Math.min(6,Math.max(1,lvl||1));
          return '<h'+lvl+'>'+convertChildren(node)+'</h'+lvl+'>';
        }
        case 'span': {
          const sname = node.getAttribute('text:style-name');
          const st = sname && charStyles[sname];
          let css='';
          if(st){ if(st.bold)css+='font-weight:700;'; if(st.italic)css+='font-style:italic;'; if(st.underline)css+='text-decoration:underline;'; }
          return css ? '<span style="'+css+'">'+convertChildren(node)+'</span>' : convertChildren(node);
        }
        case 'a': {
          const href = node.getAttribute('xlink:href')||'#';
          return '<a href="'+_fEsc(href)+'" target="_blank" rel="noopener">'+convertChildren(node)+'</a>';
        }
        case 'line-break': return '<br>';
        case 'tab': return '&emsp;';
        case 's': {
          const c=Math.min(40,Math.max(1,parseInt(node.getAttribute('text:c')||'1',10)));
          return '&nbsp;'.repeat(c);
        }
        case 'list': {
          const sname = node.getAttribute('text:style-name');
          const tagName = (sname && orderedListStyles[sname]) ? 'ol' : 'ul';
          return '<'+tagName+'>'+convertChildren(node)+'</'+tagName+'>';
        }
        case 'list-item': return '<li>'+convertChildren(node)+'</li>';
        case 'table': return '<table>'+convertChildren(node)+'</table>';
        case 'table-row': return '<tr>'+convertChildren(node)+'</tr>';
        case 'table-cell': {
          const repeat=Math.min(20,Math.max(1,parseInt(node.getAttribute('table:number-columns-repeated')||'1',10)));
          return ('<td>'+convertChildren(node)+'</td>').repeat(repeat);
        }
        case 'table-column': return '';
        default: return convertChildren(node); // élément inconnu : on garde le texte interne
      }
    }

    const officeBody = doc.getElementsByTagNameNS('*','body')[0];
    const officeText = officeBody && Array.prototype.slice.call(officeBody.children).find(c=>c.localName==='text');
    if(!officeText) throw new Error('Contenu du document introuvable');

    const html = convertChildren(officeText);

    container.innerHTML =
      '<div class="fich-docx-bar">'
        +'<span class="fich-docx-status">Lecture seule — format ODT (édition non disponible)</span>'
        +'<a class="btn ghost sm" href="'+url+'" download="'+_fEsc(displayName)+'" target="_blank"><i class="ti ti-download"></i>Télécharger</a>'
      +'</div>'
      +'<div class="fich-docx-wrap">'
        +'<div class="fich-docx-body">'+(html||'<p style="color:#94a3b8;font-style:italic">Document vide.</p>')+'</div>'
      +'</div>';
  }catch(e){
    container.innerHTML='<div class="fich-pdf-loading" style="flex-direction:column;gap:10px"><i class="ti ti-file-broken" style="font-size:36px;opacity:.4"></i><span style="font-size:12px">Impossible d\'ouvrir ce document<br><span style="opacity:.6">'+_fEsc(e.message)+'</span></span></div>';
  }
}

/* ════════════════════════════════════════════════════════
   EXCEL (.xlsx / .csv) VIEWER/EDITEUR — SheetJS (lazy-loaded)
   Rendu en tableau HTML éditable cellule par cellule,
   export et upload vers B2 au format .xlsx.
   ════════════════════════════════════════════════════════ */
function _loadSheetJS(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=function(){ resolve(window.XLSX); };
    s.onerror=reject;
    document.head.appendChild(s);
  });
}

async function _openXlsxViewer(url, displayName, b2Path, container){
  container.innerHTML='<div class="fich-pdf-loading"><div class="spinner"></div><span>Chargement du tableur…</span></div>';
  try{
    const XLSX = await _loadSheetJS();
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const wb = XLSX.read(arrayBuf,{type:'array',cellStyles:true});
    window._xlsxState = { wb, b2Path, displayName, signedUrl:url, activeSheet:0 };

    _renderXlsxSheet(container, wb, 0);
  }catch(e){
    container.innerHTML='<div class="fich-pdf-loading" style="flex-direction:column;gap:10px"><i class="ti ti-table-off" style="font-size:36px;opacity:.4"></i><span style="font-size:12px">Impossible d\'ouvrir ce tableur<br><span style="opacity:.6">'+_fEsc(e.message)+'</span></span></div>';
  }
}

function _renderXlsxSheet(container, wb, sheetIdx){
  const XLSX = window.XLSX;
  const sheetName = wb.SheetNames[sheetIdx];
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref']||'A1:A1');
  const maxRow = Math.min(range.e.r, 999);
  const maxCol = Math.min(range.e.c, 50);

  /* Barre d'onglets + actions */
  var tabs = wb.SheetNames.map(function(n,i){
    return '<div class="fich-xlsx-tab'+(i===sheetIdx?' on':'')+'" onclick="_xlsxSwitchSheet('+i+')">'+_fEsc(n)+'</div>';
  }).join('');

  /* Construction du tableau HTML */
  var tableHtml='<div class="fich-xlsx-table-wrap"><table class="fich-xlsx-table"><thead><tr><th style="width:36px;background:#111827">#</th>';
  for(var c=0;c<=maxCol;c++){
    tableHtml+='<th>'+XLSX.utils.encode_col(c)+'</th>';
  }
  tableHtml+='</tr></thead><tbody>';

  for(var r=0;r<=maxRow;r++){
    tableHtml+='<tr><td style="background:#1a2740;color:#64748b;text-align:center;font-weight:700;position:sticky;left:0;z-index:1">'+(r+1)+'</td>';
    for(var c2=0;c2<=maxCol;c2++){
      var addr=XLSX.utils.encode_cell({r:r,c:c2});
      var cell=ws[addr];
      var val=cell?XLSX.utils.format_cell(cell):'';
      var isNum=cell&&(cell.t==='n');
      var align=isNum?'text-align:right':'';
      tableHtml+='<td contenteditable="true" data-r="'+r+'" data-c="'+c2+'" style="'+align+'" '
        +'oninput="_xlsxCellEdit(this,\''+sheetName+'\')" '
        +'onfocus="this.dataset.before=this.textContent">'+_fEsc(val)+'</td>';
    }
    tableHtml+='</tr>';
  }
  tableHtml+='</tbody></table></div>';

  container.innerHTML=
    '<div class="fich-xlsx-bar">'
      +'<div class="fich-xlsx-tabs">'+tabs+'</div>'
      +'<span id="xlsx-status" style="font-size:10px;font-family:var(--m);color:var(--muted)">Cliquez une cellule pour modifier</span>'
      +'<button class="btn sm" id="xlsx-save-btn" onclick="_saveXlsxEdits()" style="display:none"><i class="ti ti-device-floppy"></i>Enregistrer</button>'
      +'<a class="btn ghost sm" href="'+(window._xlsxState?.signedUrl||'#')+'" download="'+_fEsc(window._xlsxState?.displayName||'tableur.xlsx')+'" id="xlsx-dl-btn"><i class="ti ti-download"></i>Télécharger</a>'
    +'</div>'
    +tableHtml;

  if(window._xlsxState) window._xlsxState.activeSheet=sheetIdx;
}

function _xlsxSwitchSheet(idx){
  const s=window._xlsxState; if(!s) return;
  const container=document.getElementById('fich-viewer-content');
  if(!container) return;
  _renderXlsxSheet(container, s.wb, idx);
}

function _xlsxCellEdit(td, sheetName){
  const s=window._xlsxState; if(!s) return;
  const XLSX=window.XLSX;
  const r=parseInt(td.dataset.r), c=parseInt(td.dataset.c);
  const addr=XLSX.utils.encode_cell({r,c});
  const ws=s.wb.Sheets[sheetName];
  const val=td.textContent;
  /* Déterminer le type : nombre, date, texte */
  const num=parseFloat(val);
  if(val===''){ delete ws[addr]; }
  else if(!isNaN(num)&&val.trim()!==''){ ws[addr]={t:'n',v:num,w:val}; }
  else{ ws[addr]={t:'s',v:val,w:val}; }
  /* Indiquer modification */
  const st=document.getElementById('xlsx-status');
  const sv=document.getElementById('xlsx-save-btn');
  if(st) st.textContent='Modifié — pensez à enregistrer';
  if(sv) sv.style.display='';
}

async function _saveXlsxEdits(){
  const s=window._xlsxState; if(!s) return;
  const XLSX=window.XLSX;
  const btn=document.getElementById('xlsx-save-btn');
  const st=document.getElementById('xlsx-status');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>'; }
  try{
    const wbOut=XLSX.write(s.wb,{bookType:'xlsx',type:'array'});
    const blob=new Blob([wbOut],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

    /* Sauvegarder en .xlsx (renommer si besoin) */
    var savePath=s.b2Path;
    if(!savePath.match(/\.xlsx$/i)) savePath=savePath.replace(/\.[^.]+$/,'.xlsx');

    const {data:upData,error:upErr}=await B2Storage.uploadPresigned(savePath,blob.size,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if(upErr||!upData?.uploadUrl) throw new Error(upErr?.message||'Upload impossible');
    const putRes=await fetch(upData.uploadUrl,{method:'PUT',body:blob,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    if(!putRes.ok) throw new Error('PUT failed '+putRes.status);

    if(st) st.textContent='Enregistré ✓';
    if(btn){ btn.style.display='none'; btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>Enregistrer'; }
    toast('Tableur enregistré ✓');
    loadFichiers();
  }catch(e){
    toast('Erreur : '+e.message);
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="ti ti-device-floppy"></i>Enregistrer'; }
  }
}

function renderFichiers() {
  const sn = document.getElementById('sn-fichiers');
  if (sn && CUR_SHOW) sn.textContent = CUR_SHOW.name || '…';
  initFichiersDrop();
  loadFichiers();
}

const TAB_PERSIST_KEY = 'pf_active_tab';
const SHOW_PERSIST_KEY = 'pf_active_show';
function goTab(id,el){
  /* Toujours masquer les overlays mobiles — ils sont re-affichés uniquement pour syno/stage */
  ['mob-syno-ov','mob-stage-ov'].forEach(function(oid){
    var ov=document.getElementById(oid);
    if(ov) ov.classList.remove('mob-plan-show');
  });
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  document.getElementById('panel-'+id)?.classList.add('on');
  // Desktop tabs
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  if(el) el.classList.add('on');
  else document.querySelectorAll('.tab').forEach(t=>{if(t.getAttribute('onclick')?.includes("'"+id+"'"))t.classList.add('on');});
  // Bottom nav sync
  document.querySelectorAll('.bn-tab').forEach(b=>b.classList.remove('on'));
  const bn=document.getElementById('bn-'+id);if(bn)bn.classList.add('on');
  // Persist active tab
  try{localStorage.setItem(TAB_PERSIST_KEY,id);}catch(e){}
  // Side effects
  if(id==='synoptique'){
    if(window.innerWidth<=768){ _showMobilePlanView('syno'); }
    else { SynPro.show(); }
  }
  if(id==='sessions')renderSessions();
  if(id==='stage'){
    SitePlan.init(); BandPlan.init();
    if(window.innerWidth<=768){ _showMobilePlanView(PLAN_MODE==='site'?'site':'stage'); }
    else { setTimeout(()=>BandPlan.fitView(),80); }
  }
  if(id==='fichiers')renderFichiers();
  if(id==='team'){_initRiderBuilder();}
  if(id==='showfiles'){
    renderPills(); updateStats();
    var sfB=document.getElementById('sf-pro-banner');
    if(sfB) sfB.style.display = canDo('console_export') ? 'none' : 'flex';
  }
}

const _MOB_PLAN_W = 1200; // largeur de rendu SVG/canvas mobile

function _isMobile(){ return window.innerWidth <= 768; }

function _hideMobilePlanView(type){
  const ov=document.getElementById(type==='syno'?'mob-syno-ov':'mob-stage-ov');
  if(ov) ov.classList.remove('mob-plan-show');
}

/* Re-fit les vues mobiles au changement d'orientation / redimensionnement */
let _mobResizeTimer=null;
window.addEventListener('resize',function(){
  clearTimeout(_mobResizeTimer);
  _mobResizeTimer=setTimeout(function(){
    ['mob-syno-scroll','mob-stage-scroll'].forEach(function(cid){
      const s=_mobZoomState[cid];
      const ov=document.getElementById(cid)?.closest('.mob-plan-ov');
      if(s && ov && ov.classList.contains('mob-plan-show')){
        _mobFitToCanvas(cid,s.iw,s.ih);
      }
    });
  },200);
});

/* ── Moteur pinch-zoom + pan pour vues mobiles ── */
const _mobZoomState = {};

function _mobApplyTransform(cid){
  const s=_mobZoomState[cid]; if(!s)return;
  const img=document.querySelector('#'+cid+' .mob-img');
  if(img) img.style.transform='translate('+s.tx+'px,'+s.ty+'px) scale('+s.scale+')';
}
function _mobFitToCanvas(cid,iw,ih,_retries){
  const canvas=document.getElementById(cid); if(!canvas||!iw||!ih)return;
  const cw=canvas.clientWidth, ch=canvas.clientHeight;
  /* Si le canvas n'est pas encore dimensionné (layout pas prêt), réessayer */
  if((cw<10||ch<10) && (_retries||0)<10){
    requestAnimationFrame(()=>_mobFitToCanvas(cid,iw,ih,(_retries||0)+1));
    return;
  }
  /* Scale pour afficher le plan en pleine largeur (pas de plafond à 1 — on veut remplir l'écran) */
  const scale=Math.min(cw/iw, ch/ih);
  _mobZoomState[cid]={scale, tx:(cw-iw*scale)/2, ty:(ch-ih*scale)/2, iw, ih};
  _mobApplyTransform(cid);
}
function _mobZoom(cid,factor){
  const s=_mobZoomState[cid]; if(!s)return;
  const canvas=document.getElementById(cid); if(!canvas)return;
  const cx=canvas.clientWidth/2, cy=canvas.clientHeight/2;
  const ns=Math.max(0.1,Math.min(10,s.scale*factor));
  const r=ns/s.scale;
  s.tx=cx-r*(cx-s.tx); s.ty=cy-r*(cy-s.ty); s.scale=ns;
  _mobApplyTransform(cid);
}
function _mobZoomFit(cid){
  const s=_mobZoomState[cid]; if(!s)return;
  _mobFitToCanvas(cid,s.iw,s.ih);
}

/* Plein écran : utilise l'API Fullscreen quand disponible (Android Chrome),
   sinon bascule en mode .mob-fs (iOS Safari) qui étend l'overlay à top:0/bottom:0.
   Le bouton bascule entre plein écran et vue normale. */
function _mobFullscreen(ovId, cid){
  const ov = document.getElementById(ovId);
  if(!ov) return;
  const isFs = ov.classList.contains('mob-fs')
             || !!(document.fullscreenElement || document.webkitFullscreenElement);

  if(isFs){
    /* Sortir du plein écran */
    ov.classList.remove('mob-fs');
    if(document.exitFullscreen) document.exitFullscreen().catch(()=>{});
    else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
    /* Mettre à jour l'icône du bouton */
    const btn = ov.parentElement?.querySelector('[id$="-fs-btn"]') || ov.querySelector('[id$="-fs-btn"]');
    if(btn) btn.innerHTML = '<i class="ti ti-arrows-maximize"></i>';
  } else {
    /* Entrer en plein écran — essayer l'API native d'abord */
    const req = ov.requestFullscreen || ov.webkitRequestFullscreen;
    if(req) {
      req.call(ov).then(function(){
        ov.classList.add('mob-fs');
      }).catch(function(){
        /* Fallback iOS Safari : étendre l'overlay manuellement */
        ov.classList.add('mob-fs');
      });
    } else {
      ov.classList.add('mob-fs');
    }
    const btn = document.getElementById(ovId==='mob-syno-ov'?'mob-syno-fs-btn':'mob-stage-fs-btn');
    if(btn) btn.innerHTML = '<i class="ti ti-arrows-minimize"></i>';
    /* Recalculer le fit après l'agrandissement */
    setTimeout(function(){ _mobZoomFit(cid); }, 120);
  }
}
/* Synchroniser le bouton si l'utilisateur sort du plein écran via le geste système */
document.addEventListener('fullscreenchange', function(){
  if(!document.fullscreenElement){
    ['mob-syno-ov','mob-stage-ov'].forEach(function(id){
      const ov = document.getElementById(id);
      if(ov) ov.classList.remove('mob-fs');
    });
    var b1 = document.getElementById('mob-syno-fs-btn');
    var b2 = document.getElementById('mob-stage-fs-btn');
    if(b1) b1.innerHTML = '<i class="ti ti-arrows-maximize"></i>';
    if(b2) b2.innerHTML = '<i class="ti ti-arrows-maximize"></i>';
  }
});
document.addEventListener('webkitfullscreenchange', function(){
  document.dispatchEvent(new Event('fullscreenchange'));
});
function _mobInitGestures(cid){
  const canvas=document.getElementById(cid); if(!canvas)return;
  if(canvas.dataset.gesturesReady==='1') return; // éviter le double-attachement
  canvas.dataset.gesturesReady='1';
  let t0=null,t1=null,startScale=1,startTx=0,startTy=0,startDist=0,startMidX=0,startMidY=0,lastTap=0,wasPinch=false;
  const D=(a,b)=>Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
  canvas.addEventListener('touchstart',function(e){
    const ts=Array.from(e.touches);
    const s=_mobZoomState[cid]; if(!s)return;
    if(ts.length===1){t0=ts[0];t1=null;startTx=s.tx;startTy=s.ty;wasPinch=false;}
    else if(ts.length>=2){
      t0=ts[0];t1=ts[1];startDist=D(t0,t1);startScale=s.scale;startTx=s.tx;startTy=s.ty;
      const r=canvas.getBoundingClientRect();
      startMidX=(t0.clientX+t1.clientX)/2-r.left;
      startMidY=(t0.clientY+t1.clientY)/2-r.top;
      wasPinch=true;
    }
    e.preventDefault();
  },{passive:false});
  canvas.addEventListener('touchmove',function(e){
    const ts=Array.from(e.touches);
    const s=_mobZoomState[cid]; if(!s)return;
    if(ts.length===1&&t0&&!t1){
      s.tx=startTx+(ts[0].clientX-t0.clientX);
      s.ty=startTy+(ts[0].clientY-t0.clientY);
    } else if(ts.length>=2&&t0&&t1){
      const d=D(ts[0],ts[1]);
      const ns=Math.max(0.1,Math.min(10,startScale*d/startDist));
      const ratio=ns/startScale;
      s.tx=startMidX-ratio*(startMidX-startTx);
      s.ty=startMidY-ratio*(startMidY-startTy);
      s.scale=ns;
    }
    _mobApplyTransform(cid);
    e.preventDefault();
  },{passive:false});
  canvas.addEventListener('touchend',function(e){
    const ts=Array.from(e.touches);
    const now=Date.now();
    /* Double-tap to fit — uniquement pour des taps 1 doigt (jamais après un pinch) */
    if(!wasPinch && ts.length===0 && (now-lastTap<280)){_mobZoomFit(cid);}
    if(ts.length===0){lastTap=now; t0=null;t1=null; wasPinch=false;}
    else if(ts.length===1){
      const s=_mobZoomState[cid]; if(!s)return;
      t0=ts[0];t1=null;startTx=s.tx;startTy=s.ty;
    }
  });
}
function _mobSetImage(cid, img){
  const canvas=document.getElementById(cid); if(!canvas)return;
  img.className='mob-img';
  img.style.cssText='position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;-webkit-user-drag:none;display:block;max-width:none';
  const old=canvas.querySelector('.mob-img'); if(old)old.remove();
  canvas.appendChild(img);
  const doFit=()=>_mobFitToCanvas(cid,img.naturalWidth,img.naturalHeight);
  if(img.naturalWidth) doFit(); else img.onload=doFit;
  _mobInitGestures(cid);
}
function _mobClearCanvas(cid){
  const canvas=document.getElementById(cid); if(!canvas)return;
  const old=canvas.querySelector('.mob-img'); if(old)old.remove();
  canvas.insertAdjacentHTML('afterbegin','<div class="mob-plan-loading"><div class="spinner"></div>Génération…</div>');
}
function _mobShowEmpty(cid,icon,label){
  const canvas=document.getElementById(cid); if(!canvas)return;
  const old=canvas.querySelector('.mob-img'); if(old)old.remove();
  const ld=canvas.querySelector('.mob-plan-loading'); if(ld)ld.remove();
  canvas.insertAdjacentHTML('afterbegin',`<div class="mob-plan-loading" style="flex-direction:column;gap:12px"><i class="ti ${icon}" style="font-size:40px;opacity:.25"></i><div>${label}</div><div style="font-size:10px;font-family:var(--m);color:var(--muted2)">Créez du contenu sur ordinateur</div></div>`);
}

function _mobEmptyState(icon, label){
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:200px;padding:40px;color:var(--muted);text-align:center">
    <i class="ti ${icon}" style="font-size:48px;opacity:.25"></i>
    <div style="font-size:13px">${label}</div>
    <div style="font-size:11px;font-family:var(--m);color:var(--muted2)">Créez du contenu sur ordinateur pour le visualiser ici</div>
  </div>`;
}

/* Sélecteur de scènes du visionneur mobile (multi-scène Pro). Le type est
   'syno' | 'stage' | 'site'. Permet de basculer/ajouter une version sur
   téléphone — l'éditeur complet restant réservé au bureau. */
function _renderMobSceneBar(type){
  const barId = (type==='syno') ? 'mob-syno-scenes' : 'mob-stage-scenes';
  const bar = document.getElementById(barId);
  if(!bar) return;
  if(!canDo('multi_scenes')){
    /* Gratuit : chip verrouillé (découverte → modale d'upgrade). */
    bar.innerHTML = '<button class="mob-scene-chip locked" onclick="showUpgradeModal(\'multi_patches\')"><i class="ti ti-lock" style="font-size:10px"></i>Multi-scènes (Pro)</button>';
    bar.style.display = 'flex';
    return;
  }
  const scenes = SHOW_SCENES[type] || [];
  if(!scenes.length){ bar.style.display='none'; return; }
  bar.innerHTML = scenes.map(function(s){
    const active = s.id===CUR_SCENES[type];
    return '<button class="mob-scene-chip'+(active?' active':'')+'" onclick="switchScene(\''+type+'\',\''+s.id+'\')">'+_oh(s.name)+'</button>';
  }).join('') + '<button class="mob-scene-chip add" onclick="addScene(\''+type+'\')" title="Nouvelle version">+</button>';
  bar.style.display = 'flex';
}

async function _showMobilePlanView(type){
  /* Ne pas afficher si l'app n'est pas active (écran d'auth, vue partagée) */
  const appEl = document.getElementById('app');
  if(!appEl || appEl.style.display==='none') return;
  const isSyno = type==='syno';
  const ovId    = isSyno ? 'mob-syno-ov' : 'mob-stage-ov';
  const cid     = isSyno ? 'mob-syno-scroll' : 'mob-stage-scroll';
  const ov      = document.getElementById(ovId);
  if(!ov) return;
  ov.classList.add('mob-plan-show');
  _renderMobSceneBar(type);

  /* Update title & icon for stage/site */
  if(!isSyno){
    const icon   = document.getElementById('mob-stage-icon');
    const pdfBtn = document.getElementById('mob-stage-pdf-btn');
    if(type==='site'){
      if(icon) icon.className = 'ti ti-map-2';
      document.getElementById('mob-stage-title').textContent = 'Plan de site';
      if(pdfBtn) pdfBtn.setAttribute('onclick', "openPDFModal('site')");
    } else {
      if(icon) icon.className = 'ti ti-layout-board';
      document.getElementById('mob-stage-title').textContent = 'Plan de scène';
      if(pdfBtn) pdfBtn.setAttribute('onclick', "openPDFModal('stage')");
    }
  }

  _mobClearCanvas(cid);

  try {
    if(isSyno){
      if(!SynPro.isLoaded()){ SynPro.show(); await new Promise(r=>setTimeout(r,150)); }
      let ex;
      try { ex = SynPro.buildExportSvg(); } catch(e){ ex = null; }
      if(!ex || !ex.svg || !SynPro.getData()?.nodes?.length){
        _mobShowEmpty(cid,'ti-topology-star','Synoptique vide'); return;
      }
      const blob = new Blob([ex.svg], {type:'image/svg+xml;charset=utf-8'});
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onerror = ()=>{ _mobShowEmpty(cid,'ti-topology-star','Erreur de rendu'); URL.revokeObjectURL(url); };
      img.onload  = ()=>{ setTimeout(()=>URL.revokeObjectURL(url),10000); };
      img.src = url;
      _mobSetImage(cid, img);

    } else if(type==='stage'){
      if(!BandPlan.getData().els.length){ _mobShowEmpty(cid,'ti-layout-board','Plan de scène vide'); return; }
      _makeBpCanvas(function(cv){
        const img=new Image(); img.src=cv.toDataURL('image/png'); _mobSetImage(cid,img);
      });

    } else {
      if(!SitePlan.hasContent()){ _mobShowEmpty(cid,'ti-map-2','Plan de site vide'); return; }
      SitePlan.exportCanvasSafe(function(cv){
        if(!cv){ _mobShowEmpty(cid,'ti-map-2','Plan de site vide'); return; }
        const img=new Image(); img.src=cv.toDataURL('image/png'); _mobSetImage(cid,img);
      });
    }
  } catch(e){
    _mobShowEmpty(cid,'ti-alert-triangle','Erreur : '+e.message);
  }
}
function toggleUD(){document.getElementById('user-dd').classList.toggle('show');}
function closeUD(){document.getElementById('user-dd').classList.remove('show');}

// ══════════════════════════════════════
// PLANS & PERMISSIONS
// ══════════════════════════════════════
const PLAN_PERMS = {
  free:   { max_shows:3,        max_channels:26,       max_members:1,        max_templates:5,        max_share_links:5,
            export_pdf:true,    share_link:true,       site_plan:true,       pdf_watermark:true,
            storage:true,       multi_scenes:false,    multi_patches:false,  custom_exports:false,  vintage_view:false, recap_matos:false, recent_activity:false, console_export:false, ai_stage:false, ai_inputlist:false, bulk_link:false, recently_deleted:false },
  pro:    { max_shows:Infinity, max_channels:Infinity, max_members:Infinity, max_templates:Infinity, max_share_links:Infinity,
            export_pdf:true,    share_link:true,       site_plan:true,       pdf_watermark:false,
            storage:true,       multi_scenes:true,     multi_patches:true,   custom_exports:true,   vintage_view:true,  recap_matos:true,  recent_activity:true, console_export:true, ai_stage:true, ai_inputlist:true, bulk_link:true, recently_deleted:true },
};

const PLAN_META = {
  free:   { label:'Gratuit', color:'var(--muted)',  price:'0 €',     period:'/mois' },
  pro:    { label:'Pro',     color:'var(--ora)',    price:'11,99 €', period:'/mois' },
};

const GATE_META = {
  export_pdf:     { icon:'ti-file-type-pdf',    title:'Export PDF sans filigrane',    desc:'Generez des PDF professionnels sans filigrane, prets a imprimer ou a partager avec votre equipe.', plan:'pro',    feats:['PDF sans filigrane PatchFlow','Mise en page professionnelle complete','Impression directe depuis le navigateur'] },
  share_link:     { icon:'ti-link',             title:'Lien de partage',              desc:'Partagez votre patch en lecture seule avec vos collegues ou votre client via un lien securise.', plan:'pro',    feats:['Lien unique en lecture seule','Acces sans compte requis','Mise a jour en temps reel'] },
  storage:        { icon:'ti-cloud',            title:'Stockage 500 Go',              desc:'Ajoutez l\'option stockage 500 Go pour seulement 3,50 €/mois et centralisez tous vos fichiers de production.', plan:'pro',    feats:['Option 500 Go a 3,50 €/mois','Acces a tous les membres du show','PDF, Word, Excel, Audio, Video...'] },
  site_plan:      { icon:'ti-map-2',            title:'Plan de site',                 desc:'Implantez votre sonorisation sur le plan du site. Tracez vos liaisons XLR, DANTE et HF.', plan:'pro',    feats:['Edition drag & drop du plan de site','Export PNG et PDF du plan','Inclus dans le plan Pro'] },
  max_shows:      { icon:'ti-calendar-event',   title:'Limite de shows atteinte',     desc:'Le plan Gratuit est limite a 3 shows actifs. Passez au Pro pour des shows illimites.', plan:'pro',    feats:['Shows illimites sur Pro','Canaux illimites par show','Archivage et gestion avancee'] },
  max_channels:   { icon:'ti-list-numbers',     title:'Limite de canaux atteinte',    desc:'Le plan Gratuit est limite a 26 canaux par show. Passez au Pro pour des canaux illimites.', plan:'pro',    feats:['Canaux illimites sur Pro','Pas de restriction sur le nombre de prises','Full festival patch sans limite'] },
  max_members:    { icon:'ti-users',            title:'Limite de membres atteinte',   desc:'Le plan Gratuit est limite a 1 membre. Passez au Pro pour inviter votre equipe sans limite.', plan:'pro', feats:['Membres illimites sur Pro','Roles et permissions par membre','Collaboration en temps reel'] },
  multi_patches:  { icon:'ti-layers-subtract',  title:'Multi-patches & multi-scenes', desc:'Creez plusieurs variantes de patch (A/B, festival) et plusieurs synoptiques / plans par show.', plan:'pro', feats:['Variantes A/B, festival, acoustique','Plusieurs synoptiques et plans par show','Inclus dans le plan Pro'] },
  custom_exports: { icon:'ti-photo',            title:'Exports personnalises',        desc:'Ajoutez votre logo et les informations de votre societe sur tous les exports PDF.', plan:'pro', feats:['Logo sur chaque page PDF','Entete avec vos coordonnees','Charte graphique de votre societe'] },
  vintage_view:   { icon:'ti-photo-film',       title:'Affichage Vintage',            desc:'Mode theatral avec les instruments dessines en vue de dessus sur un plateau sombre.', plan:'pro', feats:['Vue en plongee de chaque instrument','Fond de scene theatral avec parquet','Inclus dans le plan Pro'] },
  recap_matos:    { icon:'ti-clipboard-list',   title:'Recap materiels',              desc:'Obtenez le decompte exact de chaque micro et pied necessaires — indispensable avant un show pour ne rien oublier.', plan:'pro', feats:['Decompte par modele de micro ou DI','Decompte par type de pied','Total consolide sur tous les patches'] },
  recent_activity:{ icon:'ti-history',          title:'Activite recente',             desc:'Visualisez les derniers canaux modifies par votre equipe en temps reel — utile pour savoir qui a touche a quoi.', plan:'pro', feats:['5 derniers canaux modifies','Horodatage relatif (il y a X min)','Inclus dans le plan Pro'] },
  export_pdf_pro: { icon:'ti-file-type-pdf',    title:'Export PDF complet',           desc:'Retirez le filigrane et ajoutez societe, contact, venue, date, revision et notes techniques.', plan:'pro', feats:['PDF sans filigrane','Coordonnees completes en en-tete','Notes techniques sur chaque export'] },
  console_export: { icon:'ti-device-floppy',    title:'Exports console (Show Files)',  desc:'Generez les fichiers natifs pour charger vos noms de voies, couleurs, gains et +48V directement dans votre console.', plan:'pro', feats:['Yamaha, Behringer, Midas, DiGiCo, Avid, A&H...','Scene X32/M32 native, CSV officiels','Couleurs et icones intelligentes par instrument'] },
  ai_stage:       { icon:'ti-sparkles',         title:'Plan de scène par IA',          desc:'Envoyez la photo ou le croquis d\'un plan de scène : l\'IA le numérise et place automatiquement les instruments et le matériel dans l\'éditeur.', plan:'pro', feats:['Reconnaissance d\'un plan à partir d\'une image','Placement automatique des éléments','Vous ajustez ensuite librement'] },
  ai_inputlist:   { icon:'ti-sparkles',         title:'Input List par IA',             desc:'Envoyez une input list existante (image, PDF, CSV, Word) : l\'IA la numérise et crée automatiquement les canaux avec micro, +48V, IEM et pied de micro.', plan:'pro', feats:['Formats image, PDF, CSV et Word','Détecte micro/DI, +48V, IEM et pied','Canaux ajoutés prêts à ajuster'] },
  max_share_links:{ icon:'ti-link',             title:'Limite de liens de partage',   desc:'Le plan Gratuit est limite a 5 liens de partage au total. Passez au Pro pour des liens illimites.', plan:'pro', feats:['Liens de partage illimites sur Pro','Partagez chaque show en lecture seule','Mise a jour en temps reel'] },
  bulk_link:      { icon:'ti-checkbox',         title:'Liaison multiple de canaux',   desc:'Liez plusieurs canaux d\'un coup a un kit (batterie, percussions...) en les cochant — au lieu de les ajouter un par un.', plan:'pro', feats:['Cochez 8 canaux et liez-les en un clic','Ideal pour les kits batterie / percussions','Inclus dans le plan Pro'] },
  recently_deleted:{ icon:'ti-trash',          title:'Supprimés récemment',          desc:'Vos shows supprimés ne sont plus perdus : ils sont conservés 30 jours dans une corbeille d\'où vous pouvez les restaurer en un clic.', plan:'pro', feats:['Corbeille de récupération des shows','Restauration en un clic pendant 30 jours','Suppression définitive quand vous le décidez'] },
};

function userPlan() { return PROFILE?.plan || 'free'; }

function canDo(feat) {
  const p = PLAN_PERMS[userPlan()] || PLAN_PERMS.free;
  const v = p[feat];
  return v === true;
}

function planLimit(feat) {
  const p = PLAN_PERMS[userPlan()] || PLAN_PERMS.free;
  const v = p[feat];
  return (typeof v === 'number') ? v : Infinity;
}

function showUpgradeModal(feat) {
  const m = GATE_META[feat] || { icon:'ti-lock', title:'Fonctionnalite reservee', desc:'Non disponible dans votre offre.', plan:'pro', feats:[] };
  const pm = PLAN_META[m.plan] || PLAN_META.pro;
  const pilClr = 'var(--ora)';
  const pilBg  = 'var(--ora-d)';
  const pilBdr = 'var(--ora-g)';
  document.getElementById('gate-icon').className = 'ti ' + m.icon;
  document.getElementById('gate-icon').style.color = pilClr;
  document.getElementById('gate-title').textContent = m.title;
  document.getElementById('gate-desc').textContent = m.desc;
  const pill = document.getElementById('gate-plan-pill');
  pill.textContent = pm.label;
  pill.style.cssText = 'background:' + pilBg + ';color:' + pilClr + ';border:1px solid ' + pilBdr + ';font-family:var(--m);font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px';
  document.getElementById('gate-feats').innerHTML = m.feats.map(function(f) {
    return '<div class="gate-feat-row"><i class="ti ti-check"></i><span>' + f + '</span></div>';
  }).join('');
  document.getElementById('gate-modal').className = 'modal-ov show';
}
function closeGateModal() { document.getElementById('gate-modal').className = 'modal-ov'; }

/* ── Portail facturation ── */
async function openPortal() {
  var cur = userPlan();
  var icons  = { free:'🎙️', pro:'⚡' };
  var names  = { free:'Plan Gratuit', pro:'Plan Pro' };
  var iconBg = { free:'var(--surf3)', pro:'var(--ora-d)' };
  var chips  = { free:'Gratuit', pro:'Pro · Actif' };
  var ci = document.getElementById('portal-cur-icon');
  if(ci){ ci.textContent = icons[cur]||'🎙️'; ci.style.background = iconBg[cur]||'var(--surf3)'; }
  var cn = document.getElementById('portal-cur-name');
  if(cn) cn.textContent = names[cur]||'Plan Gratuit';
  var cd = document.getElementById('portal-cur-desc');
  if(cd) cd.textContent = 'Actif';
  var cc = document.getElementById('portal-billing-chip');
  if(cc) cc.textContent = chips[cur]||'Gratuit';
  document.getElementById('portal-modal').className = 'modal-ov show';

  /* Charger les détails de l'abonnement Lemon Squeezy */
  var payBtn = document.querySelector('.portal-pay-btn');
  var invList = document.getElementById('portal-invoice-list');
  if(cur !== 'pro'){
    if(cd) cd.textContent = 'Aucun abonnement actif';
    if(payBtn){ payBtn.onclick=function(){ closePortal(); openPlanModal(); }; payBtn.querySelector('span').textContent='Passer au plan Pro'; }
    return;
  }
  try{
    const {data} = await _lsCall('portal', {});
    if(data){
      if(cd){
        var info = [];
        if(data.card_brand && data.card_last_four) info.push(data.card_brand+' •••• '+data.card_last_four);
        if(data.status==='cancelled' && data.ends_at) info.push('Se termine le '+new Date(data.ends_at).toLocaleDateString('fr-FR'));
        else if(data.renews_at) info.push('Renouvelé le '+new Date(data.renews_at).toLocaleDateString('fr-FR'));
        cd.textContent = info.join(' · ') || 'Actif';
      }
      var portalUrl = data.customer_portal_url || data.update_payment_url;
      if(payBtn && portalUrl){
        payBtn.onclick = function(){ window.open(portalUrl, '_blank'); };
        payBtn.querySelector('span').textContent = 'Gérer mon abonnement / paiement';
      }
      if(invList && portalUrl){
        invList.innerHTML = '<div style="padding:14px;text-align:center;font-size:12px;color:var(--muted)">'
          +'<i class="ti ti-external-link" style="font-size:24px;color:var(--ora);display:block;margin-bottom:8px"></i>'
          +'Vos factures et reçus sont disponibles dans le portail client sécurisé Lemon Squeezy.'
          +'<br><a href="'+portalUrl+'" target="_blank" style="color:var(--ora);text-decoration:underline;font-family:var(--m);font-size:11px;display:inline-block;margin-top:8px">Ouvrir le portail →</a></div>';
      }
    }
  }catch(e){ console.warn('portal:',e); }
}
function closePortal() { document.getElementById('portal-modal').className = 'modal-ov'; }

/* ── Support ── */
function openSupport() {
  document.getElementById('support-modal').className = 'modal-ov show';
}
function closeSupport() { document.getElementById('support-modal').className = 'modal-ov'; }
async function submitSupport() {
  var subj    = document.getElementById('support-subject');
  var msg     = document.getElementById('support-msg');
  var sendBtn = document.querySelector('#support-modal .btn');
  if (!msg || !msg.value.trim()) { toast('Veuillez saisir un message.'); return; }
  if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Envoi…'; }
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) { toast('Connecte-toi pour envoyer un message.'); return; }
    const res = await fetch(
      'https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/send-support-email',
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey':        SB_KEY,
        },
        body: JSON.stringify({
          subject:  subj ? subj.value : 'Support PatchFlow',
          message:  msg.value.trim(),
          userName: PROFILE?.full_name || ME?.email || '',
        }),
      }
    );
    const json = await res.json();
    if (!res.ok) {
      toast(json.error || 'Erreur lors de l\'envoi.');
    } else {
      toast('Message envoyé ! Vérifiez votre boîte mail pour la confirmation.');
      msg.value = '';
      closeSupport();
    }
  } catch (e) {
    toast('Erreur réseau : ' + e.message);
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="ti ti-send"></i>Envoyer le message'; }
  }
}

/* Charge les détails de l'abonnement LS et remplit le bloc "Abonnement actif" */
async function _loadSubDetails() {
  const set = function(id, val) { var el=document.getElementById(id); if(el) el.textContent = val||'—'; };
  try {
    const { data } = await _lsCall('portal', {});
    if (!data) return;

    // Statut badge
    var badge = document.getElementById('sub-status-badge');
    if (badge) {
      var statusMap = {
        active:     { label:'Actif',     color:'rgba(34,214,160,.12)',  text:'var(--grn)',  border:'rgba(34,214,160,.25)' },
        on_trial:   { label:'Essai',     color:'rgba(99,179,237,.12)',  text:'var(--blu)',  border:'rgba(99,179,237,.25)' },
        cancelled:  { label:'Annulé',    color:'rgba(251,191,36,.12)',  text:'#f59e0b',     border:'rgba(251,191,36,.25)' },
        paused:     { label:'En pause',  color:'rgba(160,160,160,.12)', text:'var(--muted)',border:'var(--bdr2)' },
        unpaid:     { label:'Impayé',    color:'rgba(239,68,68,.12)',   text:'var(--err)',  border:'rgba(239,68,68,.25)' },
      };
      var st = statusMap[data.status] || statusMap.active;
      badge.textContent = st.label;
      badge.style.background = st.color;
      badge.style.color = st.text;
      badge.style.borderColor = st.border;
    }

    // Date renouvellement
    if (data.status === 'cancelled' && data.ends_at) {
      set('sub-renew-date', 'Fin le ' + new Date(data.ends_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}));
      var warn = document.getElementById('sub-cancel-warn');
      var msg  = document.getElementById('sub-cancel-msg');
      if (warn) warn.style.display = 'block';
      if (msg)  msg.textContent = 'Votre abonnement se termine le ' + new Date(data.ends_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}) + '. Vos données restent accessibles jusqu\'à cette date.';
    } else if (data.renews_at) {
      set('sub-renew-date', new Date(data.renews_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}));
    }

    // Carte bancaire
    if (data.card_brand && data.card_last_four) {
      var cardIcons = { visa:'💳', mastercard:'💳', amex:'💳' };
      set('sub-card-info', (data.card_brand.charAt(0).toUpperCase()+data.card_brand.slice(1)) + ' •••• ' + data.card_last_four);
    }

    // Période (mensuel / annuel)
    var portalUrl = data.customer_portal_url || data.update_payment_url;
    set('sub-period-info', data.renews_at ? 'Mensuel' : 'Annuel');

    // Prochaine facture (estimation)
    if (data.renews_at) {
      set('sub-next-invoice', 'Le ' + new Date(data.renews_at).toLocaleDateString('fr-FR', {day:'numeric',month:'long'}));
    }

    // Bouton Gérer → portail LS
    var manageBtn = document.querySelector('#sub-active-block button[onclick="openPortal()"]');
    if (manageBtn && portalUrl) {
      manageBtn.setAttribute('onclick', 'window.open("' + portalUrl + '","_blank")');
    }

  } catch(e) { console.warn('[_loadSubDetails]', e); }
}

/* Achat de stockage supplémentaire — ouvre une session checkout LS avec le bon produit */
async function buyExtraStorage(gb, priceEur) {
  toast('Redirection vers le paiement…');
  try {
    var { data, error } = await _lsCall('checkout', { variant: 'storage_' + gb });
    if (error || !data?.url) {
      toast('Option de stockage extra bientôt disponible — contactez le support.');
      return;
    }
    window.open(data.url, '_blank');
  } catch(e) {
    toast('Option de stockage extra bientôt disponible — contactez le support.');
  }
}

function openPlanModal() {
  const cur = userPlan();
  const descs = {
    free:   'Passez au Pro pour debloquer le PDF sans filigrane, le multi-patches, l\'equipe illimitee et bien plus.',
    pro:    'Vous avez acces a toutes les fonctionnalites de PatchFlow.',
  };
  const icons = { free:'🎙️', pro:'⚡' };
  const iconBg = { free:'var(--surf3)', pro:'var(--ora-d)' };
  const chips  = { free:'Gratuit · Actif', pro:'Pro · Actif' };
  const pm = PLAN_META[cur] || PLAN_META.free;
  document.getElementById('sub-current-label').textContent = 'Plan ' + pm.label;
  document.getElementById('sub-current-desc').textContent = descs[cur] || '';
  const iconEl = document.getElementById('plan-cur-icon');
  if(iconEl){iconEl.textContent=icons[cur]||'⚡';iconEl.style.background=iconBg[cur]||'var(--surf3)';}
  const chipEl = document.getElementById('plan-billing-chip');
  if(chipEl){chipEl.textContent=chips[cur]||'Actif';}
  const FEATS = {
    free:   [['Canaux/show','26',false],['Shows actifs','3',false],['Membres/show','1',false],['Export PDF','Filigrane',false],['Lien partage','Oui',false],['Multi-patches','Non',true]],
    pro:    [['Canaux/show','Illimites',false],['Shows actifs','Illimites',false],['Membres/show','Illimites',false],['Export PDF','Sans filigrane',false],['Multi-scenes & patches','Oui',false],['Exports a votre logo','Oui',false]],
  };
  const grid = document.getElementById('sub-plans-grid');
  grid.innerHTML = ['free','pro'].map(function(p) {
    const pm = PLAN_META[p];
    const isCur = p === cur;
    const isUp  = ['free','pro'].indexOf(p) > ['free','pro'].indexOf(cur);
    const isPopular = p === 'pro';
    const rows = (FEATS[p] || []).map(function(r) {
      const ko = r[2];
      return '<li><i class="' + (ko ? 'off ti ti-minus' : 'ok ti ti-check') + '"></i><span>' + r[0] + ' — <strong>' + r[1] + '</strong></span></li>';
    }).join('');
    const ctaLabel = isCur ? 'Plan actuel' : (isUp ? 'Passer au ' + pm.label : 'Downgrader');
    const ctaCls   = isCur ? '' : (isUp ? ' upgrade-cta' : '');
    const priceId  = p==='pro' ? ' id="sub-pro-price"'  : '';
    const periodId = p==='pro' ? ' id="sub-pro-period"' : '';
    return '<div class="sub-plan-card' + (isCur ? ' current' : '') + (isPopular && !isCur ? ' popular' : '') + '">' +
      (isCur ? '<div class="sub-current-badge">Actuel</div>' : '') +
      '<div class="sub-plan-name">' + pm.label + '</div>' +
      '<div class="sub-plan-price"'+priceId+' style="color:' + (p === 'free' ? 'var(--txt)' : pm.color) + '">' + pm.price + '</div>' +
      '<div class="sub-plan-period"'+periodId+'>' + pm.period + '</div>' +
      '<ul class="sub-plan-feats">' + rows + '</ul>' +
      '<button class="sub-plan-cta' + ctaCls + '"' + (isCur ? ' disabled' : ' onclick="subCTA(\'' + p + '\')"') + '>' +
      (isCur ? '<i class="ti ti-check"></i> ' : (isUp ? '<i class="ti ti-rocket"></i> ' : '')) + ctaLabel + '</button></div>';
  }).join('');
  // Masquer le sélecteur de période pour les abonnés Pro (déjà abonnés)
  var bpToggle = document.getElementById('sub-billing-toggle');
  if(bpToggle) bpToggle.style.display = (cur==='pro') ? 'none' : 'flex';
  // Bloc abonnement actif + stockage extra (Pro uniquement)
  var activeBlock = document.getElementById('sub-active-block');
  var extraBlock  = document.getElementById('sub-extra-storage-block');
  if(activeBlock) activeBlock.style.display = (cur==='pro') ? 'block' : 'none';
  if(extraBlock)  extraBlock.style.display  = (cur==='pro') ? 'block' : 'none';
  setBillingPeriod(_billingPeriod); // applique les prix selon la période
  document.getElementById('plan-modal').className = 'modal-ov show';
  // Load storage stats async
  _loadSubStorageStats();
  // Compteur de liens de partage
  _updateShareQuotaUI();
  // Charger détails abonnement Lemon Squeezy pour les Pro
  if(cur==='pro') _loadSubDetails();
  var slHint=document.getElementById('sub-sl-hint');
  if(slHint){
    var slLim=planLimit('max_share_links');
    if(slLim!==Infinity && _countShareLinks()>=slLim){
      slHint.innerHTML='<span style="color:var(--ora);font-weight:600">Limite atteinte — passez au Pro pour des liens illimités.</span>';
    } else {
      slHint.textContent='Input list, output, synoptique, plans, rider — tout type de lien compte.';
    }
  }
}
function closePlanModal() { document.getElementById('plan-modal').className = 'modal-ov'; }

async function _loadSubStorageStats(){
  const set = (id, txt) => { const el=document.getElementById(id); if(el)el.textContent=txt; };
  const fmt = (bytes) => {
    if(bytes < 1024) return bytes + ' o';
    if(bytes < 1048576) return (bytes/1024).toFixed(1) + ' Ko';
    if(bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' Mo';
    return (bytes/1073741824).toFixed(2) + ' Go';
  };
  const QUOTA_BYTES = canDo('multi_scenes') ? 50*1073741824 : 500*1048576; // 50 Go Pro, 500 Mo Free

  try {
    // Get all show IDs for this user
    const showIds = (SHOWS||[]).filter(s=>s.owner_id===ME?.id).map(s=>s.id);
    if(!showIds.length){ set('sub-storage-total','0 o / '+fmt(QUOTA_BYTES)); return; }

    const {data,error} = await _b2Call('user-storage', {showIds});
    if(error || !data){
      set('sub-storage-total','Erreur calcul stockage');
      return;
    }
    const b2 = data.b2_bytes || 0;
    const db = data.db_bytes || 0;
    const total = data.total_bytes || (b2 + db);
    const pct = Math.min(100, total / QUOTA_BYTES * 100);
    const warn = pct >= 80;

    set('sub-storage-total', fmt(total) + ' / ' + fmt(QUOTA_BYTES));
    set('sub-s-b2', fmt(b2));
    set('sub-s-db', fmt(db));

    const bar = document.getElementById('sub-storage-bar');
    if(bar){
      bar.style.width = pct.toFixed(1) + '%';
      bar.style.background = warn ? 'var(--err)' : pct >= 60 ? 'var(--warn)' : 'var(--ora)';
    }
    // Warn label color
    const tot = document.getElementById('sub-storage-total');
    if(tot) tot.style.color = warn ? 'var(--err)' : 'var(--txt2)';
  } catch(e) {
    set('sub-storage-total', 'Erreur : ' + e.message);
  }
}

/* Période de facturation sélectionnée dans la modale d'abonnement */
let _billingPeriod = 'monthly';
function setBillingPeriod(p){
  _billingPeriod = (p==='yearly') ? 'yearly' : 'monthly';
  document.querySelectorAll('.bp-toggle-btn').forEach(function(b){
    b.classList.toggle('on', b.dataset.bp===_billingPeriod);
  });
  // Mettre à jour les prix affichés
  var priceEl = document.getElementById('sub-pro-price');
  var perEl   = document.getElementById('sub-pro-period');
  if(priceEl) priceEl.textContent = _billingPeriod==='yearly' ? '9,92 €' : '11,99 €';
  if(perEl)   perEl.textContent   = _billingPeriod==='yearly' ? '/mois · facturé 119 €/an' : '/mois';
}

/* URL de la fonction edge Lemon Squeezy */
const _LS_FN_URL = (()=>{
  const h = window.location.hostname;
  const base = (h==='127.0.0.1'||h==='localhost')
    ? 'http://127.0.0.1:54321/functions/v1'
    : 'https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1';
  return base;
})();

async function _lsCall(action, params){
  const sess=(await sb.auth.getSession()).data?.session;
  const res=await fetch(_LS_FN_URL+'/lemonsqueezy-checkout',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(sess?.access_token||'')},
    body:JSON.stringify({action,...params}),
  });
  if(!res.ok){ const t=await res.text().catch(()=>''); return {data:null,error:{message:'HTTP '+res.status+': '+t}}; }
  return await res.json();
}

async function subCTA(plan) {
  if (plan === 'free') {
    toast('Pour résilier votre abonnement, utilisez le portail de facturation.');
    return;
  }
  if (plan === 'pro' && userPlan() === 'pro') { toast('Vous êtes déjà abonné Pro.'); return; }

  // Désactiver le bouton pendant la création du checkout
  const btns = document.querySelectorAll('.sub-plan-cta.upgrade-cta');
  btns.forEach(b=>{ b.disabled=true; b.dataset.old=b.innerHTML; b.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Redirection…'; });

  const {data,error} = await _lsCall('checkout', { variant: _billingPeriod });

  btns.forEach(b=>{ b.disabled=false; if(b.dataset.old) b.innerHTML=b.dataset.old; });

  if(error || !data?.url){
    toast('Paiement indisponible : ' + (error?.message || 'configuration manquante') + '. Contactez le support.');
    return;
  }
  // Redirection vers le checkout hébergé Lemon Squeezy
  window.location.href = data.url;
}

/* Après retour du checkout : rafraîchir le plan depuis la DB */
async function _refreshPlanFromDb(){
  if(!ME) return null;
  try{
    const {data} = await sb.from('profiles').select('plan').eq('id',ME.id).maybeSingle();
    if(data?.plan && PROFILE){ PROFILE.plan = data.plan; _refreshPlanBadge(); }
    return data?.plan || null;
  }catch(e){ return null; }
}

/* Détecte ?checkout=success au retour du paiement et attend que le webhook
   ait activé le plan Pro (polling court, le webhook arrive en quelques secondes) */
function _handleCheckoutReturn(){
  const p = new URLSearchParams(window.location.search);
  if(p.get('checkout') !== 'success') return;
  // Nettoyer l'URL
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, '', clean);

  toast('✓ Paiement reçu — activation de votre abonnement Pro…');
  let tries = 0;
  const poll = async ()=>{
    tries++;
    const plan = await _refreshPlanFromDb();
    if(plan === 'pro'){
      toast('🎉 Bienvenue dans PatchFlow Pro ! Toutes les fonctionnalités sont débloquées.');
      _refreshPlanBadge();
      return;
    }
    if(tries < 12){ setTimeout(poll, 2500); } // ~30s max
    else { toast('Abonnement en cours d\'activation. Rechargez la page dans un instant si besoin.'); }
  };
  setTimeout(poll, 2000);
}

function _refreshPlanBadge() {
  const p = userPlan();
  const cls = p === 'pro' ? 'pro' : 'free';
  const lbl = PLAN_META[p]?.label || 'Gratuit';
  const el = document.getElementById('u-plan-badge');
  if (el) el.innerHTML = '<span class="plan-badge-pill ' + cls + '">' + lbl + '</span>';
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.user-wrap'))closeUD();
  if(!e.target.closest('.side-panel')&&!e.target.closest('.sp-trigger')&&document.getElementById('side-panel').classList.contains('show'))closeSP();
});

// ══════════════════════════════════════
// TOAST
// ══════════════════════════════════════
let toastT;
/* ── Modal confirm / prompt (remplacent confirm() et prompt() natifs) ── */
function _confirmModal(title, sub) {
  return new Promise(function(resolve) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
    ov.innerHTML = '<div style="background:var(--surf);border:1px solid var(--bdr2);border-radius:14px;padding:24px;max-width:380px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.6)">'
      + '<div style="font-size:15px;font-weight:700;color:var(--txt);margin-bottom:6px">' + _fEsc(title) + '</div>'
      + (sub ? '<div style="font-size:12px;color:var(--muted);margin-bottom:20px">' + _fEsc(sub) + '</div>' : '<div style="margin-bottom:20px"></div>')
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button id="_mc-cancel" style="background:var(--surf2);border:1px solid var(--bdr2);color:var(--txt2);font-size:12px;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:var(--f)">Annuler</button>'
      + '<button id="_mc-ok" style="background:#ef4444;border:none;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:var(--f)">Supprimer</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#_mc-ok').onclick = function() { document.body.removeChild(ov); resolve(true); };
    ov.querySelector('#_mc-cancel').onclick = function() { document.body.removeChild(ov); resolve(false); };
    ov.addEventListener('keydown', function(e) { if(e.key==='Escape'){document.body.removeChild(ov);resolve(false);} });
  });
}

/* Doublon à l'upload : propose de remplacer (écraser) ou de garder les deux
   (renommer). Résout 'replace' | 'rename' | 'cancel'. */
function _dupFileModal(displayName) {
  return new Promise(function(resolve) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
    ov.innerHTML = '<div style="background:var(--surf);border:1px solid var(--bdr2);border-radius:14px;padding:24px;max-width:400px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.6)">'
      + '<div style="font-size:15px;font-weight:700;color:var(--txt);margin-bottom:6px"><i class="ti ti-file-alert" style="color:var(--ora);margin-right:6px"></i>Ce fichier existe déjà</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:20px">« ' + _fEsc(displayName) + ' » est déjà dans ce dossier. Remplacer la version existante, ou garder les deux ?</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px">'
      + '<button id="_dup-replace" style="background:var(--ora);border:none;color:#000;font-size:12px;font-weight:700;padding:10px 16px;border-radius:8px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;justify-content:center;gap:7px"><i class="ti ti-refresh"></i>Remplacer la version existante</button>'
      + '<button id="_dup-rename" style="background:var(--surf2);border:1px solid var(--bdr2);color:var(--txt);font-size:12px;font-weight:600;padding:10px 16px;border-radius:8px;cursor:pointer;font-family:var(--f);display:flex;align-items:center;justify-content:center;gap:7px"><i class="ti ti-copy-plus"></i>Garder les deux (renommer)</button>'
      + '<button id="_dup-cancel" style="background:none;border:none;color:var(--muted);font-size:12px;font-weight:600;padding:6px;border-radius:8px;cursor:pointer;font-family:var(--f)">Annuler</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    const done = function(v) { document.body.removeChild(ov); resolve(v); };
    ov.querySelector('#_dup-replace').onclick = function() { done('replace'); };
    ov.querySelector('#_dup-rename').onclick  = function() { done('rename'); };
    ov.querySelector('#_dup-cancel').onclick  = function() { done('cancel'); };
    ov.addEventListener('keydown', function(e) { if (e.key === 'Escape') { done('cancel'); } });
  });
}

function _promptModal(title, label, defaultVal) {
  return new Promise(function(resolve) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
    ov.innerHTML = '<div style="background:var(--surf);border:1px solid var(--bdr2);border-radius:14px;padding:24px;max-width:380px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.6)">'
      + '<div style="font-size:15px;font-weight:700;color:var(--txt);margin-bottom:16px">' + _fEsc(title) + '</div>'
      + '<label style="font-size:11px;font-family:var(--m);color:var(--muted);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">' + _fEsc(label) + '</label>'
      + '<input id="_mp-inp" type="text" value="' + _fEsc(defaultVal||'') + '" style="width:100%;background:var(--surf2);border:1px solid var(--bdr2);color:var(--txt);font-size:13px;padding:9px 12px;border-radius:8px;outline:none;font-family:var(--f);box-sizing:border-box;margin-bottom:16px" />'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button id="_mp-cancel" style="background:var(--surf2);border:1px solid var(--bdr2);color:var(--txt2);font-size:12px;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:var(--f)">Annuler</button>'
      + '<button id="_mp-ok" style="background:var(--ora);border:none;color:#000;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;cursor:pointer;font-family:var(--f)">Renommer</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    const inp = ov.querySelector('#_mp-inp');
    inp.focus(); inp.select();
    const done = function(v) { document.body.removeChild(ov); resolve(v); };
    ov.querySelector('#_mp-ok').onclick = function() { done(inp.value||null); };
    ov.querySelector('#_mp-cancel').onclick = function() { done(null); };
    inp.addEventListener('keydown', function(e) {
      if(e.key==='Enter'){ done(inp.value||null); }
      if(e.key==='Escape'){ done(null); }
    });
    ov.addEventListener('keydown', function(e) { if(e.key==='Escape'){ done(null); } });
  });
}

function toast(msg){
  const el=document.getElementById('toast');el.textContent=msg;
  el.style.transform='translateX(-50%) translateY(0)';el.style.opacity='1';
  clearTimeout(toastT);toastT=setTimeout(()=>{el.style.transform='translateX(-50%) translateY(80px)';el.style.opacity='0';},3200);
}

// Keyboard shortcuts
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('auth-wrap').classList.contains('show')){document.getElementById('form-login').style.display!=='none'?doLogin():doReg();}});
document.getElementById('prev-modal').addEventListener('click',function(e){if(e.target===this)closePrevModal();});
document.getElementById('pdf-modal').addEventListener('click',function(e){if(e.target===this)closePDF();});
document.getElementById('site-pdf-modal').addEventListener('click',function(e){if(e.target===this)closeSitePDF();});
document.getElementById('fich-viewer-modal').addEventListener('click',function(e){if(e.target.classList.contains('fich-viewer-ov'))closeFichierViewer();});
document.getElementById('profile-modal').addEventListener('click',function(e){if(e.target===this)closeProfile();});
document.getElementById('gate-modal').addEventListener('click',function(e){if(e.target===this)closeGateModal();});
document.getElementById('plan-modal').addEventListener('click',function(e){if(e.target===this)closePlanModal();});
document.getElementById('bp-pdf-modal').addEventListener('click',function(e){if(e.target===this)closeBpPDF();});
document.getElementById('bp-share-modal').addEventListener('click',function(e){if(e.target===this)closeBpShare();});
// ══════════════════════════════════════
// RECAP MATOS
// ══════════════════════════════════════
function closeRecapModal(){document.getElementById('recap-modal').className='modal-ov';}

function _buildRecapData(rows){
  var mics={};
  var stands={};
  rows.forEach(function(r){
    var m=(r.mic||'').trim();
    if(m) mics[m]=(mics[m]||0)+1;
    var s=(r.note||'').trim();
    if(s) stands[s]=(stands[s]||0)+1;
  });
  return {mics:mics,stands:stands};
}

function _renderRecapSection(title,icon,map,emptyMsg){
  var entries=Object.keys(map).sort(function(a,b){return map[b]-map[a];});
  if(!entries.length) return '<div style="margin-bottom:18px"><div style="font-family:var(--m);font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:5px"><i class="ti '+icon+'" style="color:var(--ora)"></i>'+title+'</div>'
    +'<div style="color:var(--muted2);font-size:11px;padding:8px 0">'+emptyMsg+'</div></div>';
  var total=entries.reduce(function(s,k){return s+map[k];},0);
  var max=entries[0]?map[entries[0]]:1;
  var rows=entries.map(function(k){
    var n=map[k];
    var pct=Math.round(n/max*100);
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--bdr)">'
      +'<div style="flex:1;font-size:12px;color:var(--txt);font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+k+'</div>'
      +'<div style="flex:2;background:var(--surf3);border-radius:4px;height:8px;overflow:hidden;min-width:60px">'
        +'<div style="width:'+pct+'%;height:100%;background:var(--ora);border-radius:4px;transition:width .3s"></div>'
      +'</div>'
      +'<div style="font-family:var(--m);font-size:13px;font-weight:800;color:var(--ora);min-width:28px;text-align:right">'+n+'</div>'
    +'</div>';
  }).join('');
  return '<div style="margin-bottom:22px">'
    +'<div style="font-family:var(--m);font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:5px">'
      +'<i class="ti '+icon+'" style="color:var(--ora)"></i>'+title
      +'<span style="margin-left:auto;background:var(--ora-d);color:var(--ora);border:1px solid var(--ora-g);border-radius:8px;padding:1px 7px;font-size:9px">Total '+total+'</span>'
    +'</div>'
    +rows
  +'</div>';
}

function _renderPatchChip(name,color){
  return '<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--m);font-size:9px;padding:2px 8px;border-radius:8px;background:'+color+'22;border:1px solid '+color+'55;color:'+color+'">'+name+'</span>';
}

async function openRecapMatos(){
  if(!canDo('recap_matos')){showUpgradeModal('recap_matos');return;}
  if(!CUR_SHOW){toast('Aucun show selectionne.');return;}

  var modal=document.getElementById('recap-modal');
  var body=document.getElementById('recap-modal-body');
  var scopeLbl=document.getElementById('recap-scope-lbl');
  modal.className='modal-ov show';
  body.innerHTML='<div class="loading"><div class="spinner"></div>Calcul en cours…</div>';
  scopeLbl.textContent='';

  var isStudio=canDo('multi_scenes');
  var PATCH_COLORS=['var(--ora)','var(--blu2)','var(--grn)','#c084fc','var(--warn)','#22d6a0','#f97316'];

  try{
    var html='';
    if(isStudio&&IL_PATCHES.length>1){
      // Load all patches from DB
      var {data:allChs,error}=await sb.from('channels').select('*').eq('show_id',CUR_SHOW.id).order('ch');
      if(error) throw error;
      allChs=allChs||[];

      // Group by patch
      var byPatch={};
      allChs.forEach(function(r){
        var pid=r.patch_id||'main';
        if(!byPatch[pid])byPatch[pid]=[];
        byPatch[pid].push(r);
      });

      // Combined total
      var combined=_buildRecapData(allChs);
      html+='<div style="margin-bottom:20px;padding:10px 14px;background:var(--surf2);border:1px solid var(--bdr2);border-radius:10px">'
        +'<div style="font-size:11px;font-weight:600;color:var(--txt2);margin-bottom:10px;display:flex;align-items:center;gap:6px">'
          +'<i class="ti ti-sum" style="color:var(--ora)"></i>Total tous patches'
          +'<span style="margin-left:auto;font-family:var(--m);font-size:9px;color:var(--muted)">'+allChs.length+' canaux</span>'
        +'</div>'
        +_renderRecapSection('Micros et DI','ti-microphone',combined.mics,'Aucun micro renseigne.')
        +_renderRecapSection('Pieds de micro','ti-line-height',combined.stands,'Aucun pied renseigne.')
      +'</div>';

      // Per-patch breakdown
      html+='<div style="font-family:var(--m);font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin-bottom:10px">Detaill par patch</div>';
      IL_PATCHES.forEach(function(p,i){
        var prows=byPatch[p.id]||[];
        var pdata=_buildRecapData(prows);
        var col=PATCH_COLORS[i%PATCH_COLORS.length];
        var hasMics=Object.keys(pdata.mics).length>0;
        var hasStands=Object.keys(pdata.stands).length>0;
        html+='<details style="margin-bottom:10px;border:1px solid var(--bdr2);border-radius:9px;overflow:hidden">'
          +'<summary style="padding:9px 14px;cursor:pointer;background:var(--surf2);display:flex;align-items:center;gap:8px;list-style:none;user-select:none">'
            +_renderPatchChip(p.name,col)
            +'<span style="font-size:11px;color:var(--txt2)">'+prows.length+' canaux</span>'
            +(hasMics?'<span style="font-size:10px;color:var(--muted);font-family:var(--m)">'+Object.keys(pdata.mics).length+' modele'+(Object.keys(pdata.mics).length>1?'s':'')+' de micro</span>':'')
            +'<i class="ti ti-chevron-down" style="margin-left:auto;font-size:11px;color:var(--muted)"></i>'
          +'</summary>'
          +'<div style="padding:12px 14px">'
            +(hasMics||hasStands
              ?_renderRecapSection('Micros et DI','ti-microphone',pdata.mics,'Aucun micro renseigne.')
               +_renderRecapSection('Pieds de micro','ti-line-height',pdata.stands,'Aucun pied renseigne.')
              :'<div style="color:var(--muted2);font-size:11px;padding:4px 0">Patch vide ou sans donnees.</div>'
            )
          +'</div>'
        +'</details>';
      });

      scopeLbl.textContent='Studio — '+IL_PATCHES.length+' patch'+(IL_PATCHES.length>1?'es':'')+' • '+allChs.length+' canaux au total';
    } else {
      // Pro: current patch only
      var data=_buildRecapData(CHS);
      html+=_renderRecapSection('Micros et DI','ti-microphone',data.mics,'Aucun micro renseigne dans ce patch.')
           +_renderRecapSection('Pieds de micro','ti-line-height',data.stands,'Aucun pied renseigne dans ce patch.');
      var pname=IL_PATCHES.find(function(p){return p.id===CUR_PATCH_ID;})?.name||'Patch 1';
      scopeLbl.textContent='Patch « '+pname+' » — '+CHS.length+' canaux';
    }
    body.innerHTML=html;
  }catch(err){
    body.innerHTML='<div style="color:var(--err);padding:20px;text-align:center;font-size:12px">Erreur : '+_fEsc(err.message)+'</div>';
  }
}

// ══════════════════════════════════════
// BON DE PRÉPARATION — checklist matériel
// Vérifie que tout le matériel de la fiche technique sera disponible/préparé.
// Agrège micros/DI, pieds, +48V (input list) + sorties/retours (output list).
// État persistant en localStorage par show (offline-friendly).
// ══════════════════════════════════════
let _prepState = null;   // {checked:{key:true}, verifiedAt, verifiedBy}
let _prepRows  = [];     // [{key,cat,label,qty}]

function closePrepModal(){ document.getElementById('prep-modal').className='modal-ov'; }
function _prepKey(){ return 'pf_prep_' + (CUR_SHOW ? CUR_SHOW.id : 'none'); }
function _loadPrepState(){
  try{ var s=JSON.parse(localStorage.getItem(_prepKey())||'null'); if(s&&s.checked) return s; }catch(e){}
  return {checked:{}, verifiedAt:null, verifiedBy:null};
}
function _savePrepState(){ try{ localStorage.setItem(_prepKey(), JSON.stringify(_prepState)); }catch(e){} }

/* Agrège le matériel depuis les canaux (micros/DI, pieds, +48V) et l'output list */
function _buildPrepRows(rows, outData){
  var out=[], mics={}, stands={}, phantom=0;
  (rows||[]).forEach(function(r){
    var m=(r.mic||'').trim();  if(m) mics[m]=(mics[m]||0)+1;
    var s=(r.note||'').trim(); if(s) stands[s]=(stands[s]||0)+1;
    if(r.phantom) phantom++;
  });
  Object.keys(mics).sort(function(a,b){return mics[b]-mics[a];}).forEach(function(k){
    out.push({key:'mic:'+k, cat:'Micros & DI', label:k, qty:mics[k]});
  });
  Object.keys(stands).sort(function(a,b){return stands[b]-stands[a];}).forEach(function(k){
    out.push({key:'pied:'+k, cat:'Pieds de micro', label:k, qty:stands[k]});
  });
  if(phantom) out.push({key:'phantom', cat:'Alimentation', label:'Voies en +48V (alim. fantôme)', qty:phantom});
  if(outData){
    var outs=[]; Object.keys(outData).forEach(function(pid){ (outData[pid]||[]).forEach(function(o){ outs.push(o); }); });
    var TL={main:'Façade (Main)',sub:'Subs',mon:'Retours (wedges)',iem:'Ears / IEM',fx:'Effets (FX)',matrix:'Matrix',other:'Autres sorties'};
    var byType={}; outs.forEach(function(o){ var t=o.type||'other'; byType[t]=(byType[t]||0)+1; });
    Object.keys(byType).forEach(function(t){
      out.push({key:'out:'+t, cat:'Sorties / Retours', label:(TL[t]||t), qty:byType[t]});
    });
  }
  return out;
}

function _prepProgress(){
  var total=_prepRows.length;
  var done=_prepRows.filter(function(r){return _prepState.checked[r.key];}).length;
  return {done:done,total:total,pct: total?Math.round(done/total*100):0};
}

function togglePrepItem(key){
  if(_prepState.checked[key]) delete _prepState.checked[key];
  else _prepState.checked[key]=true;
  /* Décocher invalide le tampon "tout vérifié" (le bon n'est plus complet) */
  var p=_prepProgress();
  if(p.done<p.total){ _prepState.verifiedAt=null; _prepState.verifiedBy=null; }
  _savePrepState(); _renderPrep();
}

function toggleVerifyAllPrep(){
  var p=_prepProgress();
  if(p.total>0 && p.done===p.total && _prepState.verifiedAt){
    _prepState.verifiedAt=null; _prepState.verifiedBy=null;          // retirer le tampon
  }else{
    _prepRows.forEach(function(r){ _prepState.checked[r.key]=true; }); // tout cocher + tamponner
    _prepState.verifiedAt=new Date().toISOString();
    _prepState.verifiedBy=(PROFILE&&PROFILE.full_name)||(ME&&ME.email)||'—';
  }
  _savePrepState(); _renderPrep();
}

function resetPrep(){
  if(!confirm('Réinitialiser le bon de préparation (tout décocher) ?')) return;
  _prepState={checked:{}, verifiedAt:null, verifiedBy:null};
  _savePrepState(); _renderPrep();
}

function _renderPrep(){
  var head=document.getElementById('prep-head');
  var body=document.getElementById('prep-body');
  if(!head||!body) return;
  var p=_prepProgress();
  var allDone = p.total>0 && p.done===p.total;
  head.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
      +'<div style="flex:1;background:var(--surf3);border-radius:6px;height:10px;overflow:hidden">'
        +'<div style="width:'+p.pct+'%;height:100%;background:'+(allDone?'var(--grn)':'var(--ora)')+';border-radius:6px;transition:width .25s"></div>'
      +'</div>'
      +'<div style="font-family:var(--m);font-size:12px;font-weight:800;color:'+(allDone?'var(--grn)':'var(--ora)')+'">'+p.done+'/'+p.total+'</div>'
    +'</div>'
    + (_prepState.verifiedAt
        ? '<div style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--grn);background:rgba(34,214,160,.08);border:1px solid rgba(34,214,160,.25);border-radius:8px;padding:7px 11px">'
            +'<i class="ti ti-rosette-discount-check" style="font-size:15px;flex-shrink:0"></i>'
            +'<span>Matériel vérifié disponible le <strong>'+_fEsc(new Date(_prepState.verifiedAt).toLocaleDateString('fr-FR'))+'</strong> par <strong>'+_fEsc(_prepState.verifiedBy||'—')+'</strong></span>'
          +'</div>'
        : (allDone
            ? '<div style="font-size:11px;color:var(--muted)">Tous les articles sont cochés — cliquez « Tout vérifié » pour valider le bon.</div>'
            : '<div style="font-size:11px;color:var(--muted)">Cochez chaque article à mesure que vous le préparez.</div>'));
  if(!_prepRows.length){
    body.innerHTML='<div style="text-align:center;color:var(--muted2);padding:30px;font-size:12px"><i class="ti ti-clipboard-off" style="font-size:26px;display:block;margin-bottom:8px;color:var(--muted)"></i>Aucun matériel renseigné.<br><span style="font-size:11px">Renseignez les micros / pieds dans l\'input list pour générer le bon.</span></div>';
    return;
  }
  var CAT_ICON={'Micros & DI':'ti-microphone','Pieds de micro':'ti-line-height','Alimentation':'ti-bolt','Sorties / Retours':'ti-speakerphone'};
  var byCat={}; _prepRows.forEach(function(r){ (byCat[r.cat]=byCat[r.cat]||[]).push(r); });
  var html='';
  Object.keys(byCat).forEach(function(cat){
    var items=byCat[cat];
    var cdone=items.filter(function(r){return _prepState.checked[r.key];}).length;
    html+='<div style="margin-bottom:16px">'
      +'<div style="font-family:var(--m);font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin-bottom:7px;display:flex;align-items:center;gap:6px">'
        +'<i class="ti '+(CAT_ICON[cat]||'ti-box')+'" style="color:var(--ora)"></i>'+_fEsc(cat)
        +'<span style="margin-left:auto;color:'+(cdone===items.length?'var(--grn)':'var(--muted2)')+'">'+cdone+'/'+items.length+'</span>'
      +'</div>';
    items.forEach(function(r){
      var on=!!_prepState.checked[r.key];
      html+='<div onclick="togglePrepItem('+_fEsc(JSON.stringify(r.key))+')" style="display:flex;align-items:center;gap:11px;padding:9px 11px;margin-bottom:5px;border:1px solid '+(on?'rgba(34,214,160,.3)':'var(--bdr2)')+';border-radius:9px;cursor:pointer;background:'+(on?'rgba(34,214,160,.06)':'var(--surf2)')+';transition:background .12s,border-color .12s">'
        +'<div style="width:22px;height:22px;border-radius:6px;border:2px solid '+(on?'var(--grn)':'var(--bdr3)')+';background:'+(on?'var(--grn)':'transparent')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#04231a">'
          +(on?'<i class="ti ti-check" style="font-size:14px;font-weight:800"></i>':'')
        +'</div>'
        +'<div style="flex:1;min-width:0;font-size:13px;color:var(--txt)">'+_fEsc(r.label)+'</div>'
        +'<div style="font-family:var(--m);font-size:13px;font-weight:800;color:var(--ora);background:var(--ora-d);border:1px solid var(--ora-g);border-radius:8px;padding:2px 9px;flex-shrink:0">×'+r.qty+'</div>'
      +'</div>';
    });
    html+='</div>';
  });
  body.innerHTML=html;
  var vb=document.getElementById('prep-verify-btn');
  if(vb){
    if(_prepState.verifiedAt){ vb.innerHTML='<i class="ti ti-circle-check-filled"></i>Vérifié ✓'; vb.style.background='var(--grn)'; vb.style.borderColor='var(--grn)'; }
    else { vb.innerHTML='<i class="ti ti-circle-check"></i>Tout vérifié'; vb.style.background=''; vb.style.borderColor=''; }
  }
}

function openPrep(){
  if(!CUR_SHOW){ toast('Aucun show sélectionné.'); return; }
  closeExpMenu&&closeExpMenu('il-exp-menu');
  var modal=document.getElementById('prep-modal');
  modal.className='modal-ov show';
  document.getElementById('prep-body').innerHTML='<div class="loading"><div class="spinner"></div>Calcul en cours…</div>';
  document.getElementById('prep-head').innerHTML='';
  _prepState=_loadPrepState();
  /* out_data n'est pas une colonne → fallback sur OUT_DATA en mémoire (cf _renderOUT) */
  var outData = (CUR_SHOW.out_data && Object.keys(CUR_SHOW.out_data).length) ? CUR_SHOW.out_data
              : (typeof OUT_DATA!=='undefined' ? OUT_DATA : null);
  _prepRows=_buildPrepRows(typeof CHS!=='undefined'?CHS:[], outData);
  /* purger les clés cochées qui n'existent plus dans le matériel courant */
  var valid={}; _prepRows.forEach(function(r){ valid[r.key]=true; });
  Object.keys(_prepState.checked).forEach(function(k){ if(!valid[k]) delete _prepState.checked[k]; });
  var pname=(typeof IL_PATCHES!=='undefined'&&IL_PATCHES.find)?((IL_PATCHES.find(function(p){return p.id===CUR_PATCH_ID;})||{}).name||''):'';
  var totQty=_prepRows.reduce(function(s,r){return s+r.qty;},0);
  document.getElementById('prep-scope-lbl').textContent=(pname?'Patch « '+pname+' » — ':'')+_prepRows.length+' références · '+totQty+' unités';
  _renderPrep();
}

function printPrep(){
  if(!_prepRows.length){ toast('Rien à imprimer.'); return; }
  var esc=_fEsc, p=_prepProgress();
  var byCat={}; _prepRows.forEach(function(r){ (byCat[r.cat]=byCat[r.cat]||[]).push(r); });
  var showName=esc((CUR_SHOW&&CUR_SHOW.name)||'Show');
  var venue=esc((CUR_SHOW&&CUR_SHOW.venue)||'');
  var date=esc((CUR_SHOW&&CUR_SHOW.show_date)||'');
  var now=esc(new Date().toLocaleString('fr-FR'));
  var rowsHtml='';
  Object.keys(byCat).forEach(function(cat){
    rowsHtml+='<tr><td colspan="3" class="cat">'+esc(cat)+'</td></tr>';
    byCat[cat].forEach(function(r){
      var on=!!_prepState.checked[r.key];
      rowsHtml+='<tr><td class="bx">'+(on?'&#9745;':'&#9744;')+'</td><td>'+esc(r.label)+'</td><td class="q">&times;'+r.qty+'</td></tr>';
    });
  });
  var stamp=_prepState.verifiedAt
    ? '<div class="stamp">&#10003; Matériel vérifié disponible le '+esc(new Date(_prepState.verifiedAt).toLocaleDateString('fr-FR'))+' par '+esc(_prepState.verifiedBy||'—')+'</div>'
    : '<div class="stamp todo">Préparation en cours — '+p.done+'/'+p.total+' références prêtes</div>';
  var html='<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Bon de préparation — '+showName+'</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;padding:28px 32px}'
    +'h1{font-size:20px;color:#0a0f1c}.sub{font-size:12px;color:#666;margin:3px 0 14px;font-family:monospace}'
    +'.stamp{font-size:12px;font-weight:700;color:#0a7d54;background:#e8f9f1;border:1px solid #9be3c5;border-radius:8px;padding:8px 12px;margin-bottom:16px}'
    +'.stamp.todo{color:#b06a00;background:#fff6e8;border-color:#f0c894}'
    +'table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 8px;border-bottom:1px solid #eee}'
    +'.cat{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#ff6b1a;font-weight:700;padding-top:16px;border-bottom:2px solid #ffd9c2}'
    +'.bx{font-size:18px;width:30px;text-align:center}.q{text-align:right;font-weight:800;color:#ff6b1a;font-family:monospace;width:60px}'
    +'.ft{margin-top:22px;font-size:10px;color:#999;font-family:monospace;border-top:1px solid #eee;padding-top:10px}'
    +'@media print{body{padding:0}}</style></head><body>'
    +'<h1>Bon de préparation</h1>'
    +'<div class="sub">'+showName+(venue?' · '+venue:'')+(date?' · '+date:'')+'</div>'
    +stamp
    +'<table><tbody>'+rowsHtml+'</tbody></table>'
    +'<div class="ft">PatchFlow — généré le '+now+' — '+p.total+' références</div>'
    +'<script>window.onload=function(){window.print();}<\/script></body></html>';
  var w=window.open('','_blank','width=800,height=900');
  if(!w){ toast('Autorisez les popups pour imprimer.'); return; }
  w.document.write(html); w.document.close();
}

/* Visionneuse plein écran mobile (pan + pinch-zoom fluides) pour les plans
   partagés. L'image s'ajuste à l'écran au départ (on voit tout le plan), puis
   on peut zoomer au pincement et déplacer au doigt. Lit la source depuis l'img
   inline (par id) pour éviter de passer une énorme data-URL en attribut. */
function _svFs(imgId, title){
  var srcEl=document.getElementById(imgId); if(!srcEl) return;
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:#0a0f1c;z-index:100000;overflow:hidden;touch-action:none;overscroll-behavior:none;user-select:none';
  var img=document.createElement('img');
  img.src=srcEl.src;
  img.draggable=false;
  img.style.cssText='position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;pointer-events:none;-webkit-user-drag:none';
  ov.appendChild(img);
  var hdr=document.createElement('div');
  hdr.style.cssText='position:absolute;top:0;left:0;right:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(#000b,transparent);pointer-events:none';
  hdr.innerHTML='<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.75);font-family:DM Mono,monospace">'+(title||'')+'</div>';
  var close=document.createElement('button');
  close.innerHTML='&#10005;';
  close.style.cssText='pointer-events:auto;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);color:#fff;font-size:17px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1;cursor:pointer';
  close.onclick=function(){ window.removeEventListener('resize',fit); ov.remove(); };
  hdr.appendChild(close);
  ov.appendChild(hdr);
  var hint=document.createElement('div');
  hint.style.cssText='position:absolute;bottom:0;left:0;right:0;text-align:center;padding:10px;font-size:9px;color:rgba(255,255,255,.35);font-family:DM Mono,monospace;pointer-events:none';
  hint.textContent='Pincez pour zoomer · Glissez pour déplacer · Double-tap pour ajuster';
  ov.appendChild(hint);
  document.body.appendChild(ov);

  var scale=1, tx=0, ty=0, minScale=1, maxScale=8;
  function apply(){ img.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')'; }
  function clampPan(){
    var vw=ov.clientWidth, vh=ov.clientHeight, iw=img.naturalWidth*scale, ih=img.naturalHeight*scale;
    if(iw<=vw){ tx=(vw-iw)/2; } else { tx=Math.min(0,Math.max(vw-iw,tx)); }
    if(ih<=vh){ ty=(vh-ih)/2; } else { ty=Math.min(0,Math.max(vh-ih,ty)); }
  }
  function fit(){
    var vw=ov.clientWidth||window.innerWidth, vh=ov.clientHeight||window.innerHeight, iw=img.naturalWidth, ih=img.naturalHeight;
    if(!iw||!ih||!vw||!vh) return;
    minScale=Math.min(vw/iw, vh/ih); scale=minScale; maxScale=minScale*8;
    clampPan(); apply();
  }
  if(img.complete && img.naturalWidth) fit(); else img.onload=fit;
  window.addEventListener('resize',fit);

  var pts={}, pinch=null, pan=null, lastTap=0;
  ov.addEventListener('pointerdown',function(e){
    pts[e.pointerId]={x:e.clientX,y:e.clientY};
    var ids=Object.keys(pts);
    if(ids.length===1){
      pan={x:e.clientX,y:e.clientY,tx:tx,ty:ty};
      var nowT=Date.now();
      if(nowT-lastTap<300){ // double-tap : ajuster / zoom x2
        if(scale>minScale*1.1){ fit(); } else { var f=Math.min(maxScale,minScale*3); var cx=e.clientX,cy=e.clientY; tx=cx-(cx-tx)*(f/scale); ty=cy-(cy-ty)*(f/scale); scale=f; clampPan(); apply(); }
      }
      lastTap=nowT;
    } else if(ids.length===2){
      var a=pts[ids[0]], b=pts[ids[1]];
      pinch={d:Math.hypot(a.x-b.x,a.y-b.y), mx:(a.x+b.x)/2, my:(a.y+b.y)/2, scale:scale, tx:tx, ty:ty};
      pan=null;
    }
  });
  ov.addEventListener('pointermove',function(e){
    if(!pts[e.pointerId]) return;
    pts[e.pointerId]={x:e.clientX,y:e.clientY};
    var ids=Object.keys(pts);
    if(ids.length>=2 && pinch){
      var a=pts[ids[0]], b=pts[ids[1]];
      var d=Math.hypot(a.x-b.x,a.y-b.y);
      var ns=Math.min(maxScale,Math.max(minScale, pinch.scale*(d/(pinch.d||1))));
      // zoom autour du point milieu initial
      tx=pinch.mx-(pinch.mx-pinch.tx)*(ns/pinch.scale);
      ty=pinch.my-(pinch.my-pinch.ty)*(ns/pinch.scale);
      scale=ns; clampPan(); apply();
    } else if(ids.length===1 && pan){
      tx=pan.tx+(e.clientX-pan.x); ty=pan.ty+(e.clientY-pan.y);
      clampPan(); apply();
    }
  });
  function up(e){ delete pts[e.pointerId]; var ids=Object.keys(pts); if(ids.length<2)pinch=null; if(ids.length===1){ pan={x:pts[ids[0]].x,y:pts[ids[0]].y,tx:tx,ty:ty}; } if(ids.length===0)pan=null; }
  ov.addEventListener('pointerup',up);
  ov.addEventListener('pointercancel',up);
}

// Share-view mode
(async function checkShareMode(){
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  /* Échappement pour valeur injectée dans une chaîne JS d'un handler inline
     (onclick="fn('...')") : esc() ne neutralise pas l'apostrophe, qui permet
     de sortir de la chaîne JS → XSS stocké. Backslash d'abord, puis quote,
     puis les caractères HTML (l'attribut est décodé avant l'exécution JS). */
  const jsq=s=>String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  /* Source d'image sûre : les snapshots (site/stage/synoptique) viennent de la
     config stockée en base — contrôlée par le créateur du lien. On n'accepte
     que des data-URL image base64 ou du https, sinon chaîne vide. */
  const safeSrc=u=>{
    u=String(u||'');
    return (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(u)||/^https:\/\//i.test(u))?esc(u):'';
  };
  const p=new URLSearchParams(window.location.search);
  var isMobile=window.innerWidth<640;

  // Detect entry point: ?link=uuid (Pro), ?rider=showId (legacy), ?view=showId
  const linkId =p.get('link');   // nouveau lien Pro nommé
  const riderId=p.get('rider');  // lien legacy (showId)
  const sid=riderId||p.get('view');
  if(!linkId&&!sid)return;

  // Variables — resolved from DB
  var sections,rTitle='',rNote='',rInfo='',rFiles=[];
  /* Nom du show (résolu au pré-chargement) — sert à éviter le doublon
     titre-du-rider / nom-du-show dans le bandeau du haut. */
  var _preShowName='';
  /* showId utilisé pour les actions B2 publiques */
  var _shareShowId=sid||'';
  /* Variables pour le switching multi-patches/scènes */
  var _allRows=[];
  /* Réponse de get-shared-show mémorisée au pré-chargement, réutilisée telle
     quelle au moment du rendu pour éviter un 2e appel réseau identique. */
  var _sharedResp=null;
  /* Consomme le préchargement lancé très tôt dans le <head> (en parallèle du
     parsing du gros script) si disponible ; sinon lance l'appel maintenant. */
  async function _getShared(){
    if(window.__riderPrefetch){
      var _pp=window.__riderPrefetch; window.__riderPrefetch=null;
      try{ var _pj=await _pp; if(_pj) return _pj; }catch(_e){}
    }
    var _b=linkId?{linkId:linkId}:{showId:(sid||riderId)};
    var _r=await fetch(SB_URL+'/functions/v1/get-shared-show',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+SB_KEY},body:JSON.stringify(_b)});
    return await _r.json();
  }

  if(linkId||riderId){
    // Charger config depuis la edge function publique
    document.getElementById('auth-wrap').style.display='none';
    document.getElementById('app').style.display='none';
    const tmp=document.createElement('div');
    tmp.style.cssText='min-height:100vh;background:#0a0f1c;display:flex;align-items:center;justify-content:center;font-family:DM Mono,monospace;color:#5a6a80;font-size:12px';
    tmp.textContent='Chargement du rider…';
    document.body.prepend(tmp);
    let preShow;
    try{
      var _prj=await _getShared();
      _sharedResp=_prj; // réutilisé au rendu (pas de 2e fetch identique)
      if(_prj&&!_prj.error&&_prj.data){
        preShow=_prj.data.show;
        /* Pour un ?link=, les sections/config viennent de overrideRider */
        if(linkId&&_prj.data.overrideRider){
          var or=_prj.data.overrideRider;
          sections=or.sections&&or.sections.length>1?or.sections:or.sections&&or.sections.length===1&&or.sections[0]!=='il'?or.sections:['il','out','syno','stage','site'];
          rTitle=or.title||'';rNote=or.note||'';rInfo=or.info||'';
          rFiles=or.files||[];
          /* Injecter les snapshots dans le preShow.stage_data.rider pour que
             le rendu des sections (syno, site, out) les trouve */
          if(!preShow.stage_data) preShow.stage_data={};
          if(!preShow.stage_data.rider) preShow.stage_data.rider={};
          Object.assign(preShow.stage_data.rider, or);
        }
        /* showId pour les actions B2 */
        if(preShow) _shareShowId=preShow.id;
        if(preShow) _preShowName=preShow.name||'';
      }
    }catch(e){}
    tmp.remove();
    document.getElementById('auth-wrap').style.display='';
    document.getElementById('app').style.display='';
    if(!sections){
      var cfg=(preShow&&preShow.stage_data&&preShow.stage_data.rider)||{};
      sections=cfg.sections&&cfg.sections.length>1?cfg.sections:['il','out','syno','stage','site'];
      rTitle=cfg.title||'';rNote=cfg.note||'';rInfo=cfg.info||'';rFiles=cfg.files||[];
    }
  }else{
    // Legacy ?view= URL params
    const _VALID_SECS=new Set(['il','out','syno','stage','site','files']);
    const legacyTab=p.get('tab');
    const rawSecs=p.get('sections');
    /* Mapper le tab legacy vers la bonne section (QR codes des exports PDF) */
    const _tabMap={stage:'stage',site:'site',syno:'syno',out:'out',il:'il',inputlist:'il',outputlist:'out'};
    sections=rawSecs?rawSecs.split(',').map(function(s){return s.trim();}).filter(function(s){return _VALID_SECS.has(s);})
             :(_tabMap[legacyTab]?[_tabMap[legacyTab]]:['il']);
    rTitle=p.get('rtitle')||'';
    rNote=p.get('rnote')||'';
    rInfo=p.get('rinfo')||'';
    var rFilesRaw=p.get('rfiles')||'';
    rFiles=rFilesRaw?rFilesRaw.split('|').filter(Boolean):[];
  }

  // Hide app & auth, show share viewer
  document.getElementById('auth-wrap').style.display='none';
  document.getElementById('app').style.display='none';

  // ── Build shell ──
  var SV_LOGO='<svg width="28" height="28" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M70 60 C100 60 100 140 130 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round"/><path d="M130 60 C100 60 100 140 70 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round" opacity="0.45"/><circle cx="60" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="60" r="5" fill="#FF6B2B"/><circle cx="140" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="60" r="5" fill="#FF6B2B"/><circle cx="60" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="140" r="5" fill="#FF6B2B"/><circle cx="140" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="140" r="5" fill="#FF6B2B"/></svg>';
  var SV_TABCSS='display:inline-flex;align-items:center;gap:'+(isMobile?'4':'6')+'px;padding:'+(isMobile?'10px 12px':'12px 18px')+';background:none;border:none;border-bottom:2px solid transparent;color:#5a6a80;font-family:DM Mono,monospace;font-size:'+(isMobile?'10':'11')+'px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:all .15s;margin-bottom:-1px;white-space:nowrap;border-radius:8px 8px 0 0';
  var SV_TABCSS_ON='display:inline-flex;align-items:center;gap:'+(isMobile?'4':'6')+'px;padding:'+(isMobile?'10px 12px':'12px 18px')+';background:linear-gradient(180deg,rgba(255,107,26,.1),transparent);border:none;border-bottom:2px solid #ff6b1a;color:#ff6b1a;font-family:DM Mono,monospace;font-size:'+(isMobile?'10':'11')+'px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;margin-bottom:-1px;white-space:nowrap;border-radius:8px 8px 0 0';

  var secLabels={il:'Input List',out:'Output List',syno:'Synoptique',stage:'Plan de scene',site:'Plan de site',cloud:'Fichiers',files:'Pieces jointes'};
  /* Icônes Tabler (même jeu que le builder) — plus pro que les symboles Unicode */
  var secIcons={
    il:'<i class="ti ti-list-numbers" style="font-size:15px"></i>',
    out:'<i class="ti ti-list-letters" style="font-size:15px"></i>',
    syno:'<i class="ti ti-topology-star-3" style="font-size:15px"></i>',
    stage:'<i class="ti ti-map-2" style="font-size:15px"></i>',
    site:'<i class="ti ti-building-stadium" style="font-size:15px"></i>',
    cloud:'<i class="ti ti-folders" style="font-size:15px"></i>',
    files:'<i class="ti ti-paperclip" style="font-size:15px"></i>'
  };

  var _VALID_SEC_SET=new Set(['il','out','syno','stage','site','cloud','files']);

  /* Nettoyer les sections et rFiles :
     - Filtrer uniquement les sections valides
     - 'cloud' : n'afficher que si explicitement coché (pas déduit)
     - 'files' (pièces jointes) : 'files' n'est pas un toggle dans _riderSections,
       c'est un bloc séparé. On ajoute automatiquement l'onglet si rFiles contient
       des fichiers ET que 'files' n'est pas déjà dans sections. */
  var allSections=sections.filter(function(s){return _VALID_SEC_SET.has(s);});
  /* Ajouter l'onglet pièces jointes si des fichiers ont été sélectionnés */
  if(rFiles.length && allSections.indexOf('files')<0) allSections.push('files');
  /* Supprimer l'onglet si aucun fichier */
  if(!rFiles.length) allSections=allSections.filter(function(s){return s!=='files';});
  var tabsHtml='';
  if(allSections.length>1){
    tabsHtml='<div id="sv-tabs" style="position:relative;flex-shrink:0;display:flex;border-bottom:1px solid #1e2a3a;margin-bottom:0;overflow-x:auto;background:#080e1a;padding:0 '+(isMobile?'4px':'14px')+'">';
    allSections.filter(function(s){return _VALID_SEC_SET.has(s);}).forEach(function(s,i){
      var active=i===0;
      tabsHtml+='<button id="svt-'+s+'" style="'+(active?SV_TABCSS_ON:SV_TABCSS)+'" onclick="_svSwitch(\''+esc(s)+'\')">'
        +(secIcons[s]||'')+'<span>'+(secLabels[s]||'')+'</span></button>';
    });
    tabsHtml+='</div>';
  }

  var wrap=document.createElement('div');
  wrap.id='share-view';
  wrap.style.cssText='min-height:100vh;background:#0a0f1c;color:#e8edf8;font-family:Outfit,sans-serif;position:relative;display:flex;flex-direction:column';
  /* Petit logo réutilisé (header mobile + bandeau bas de page) */
  var SV_LOGO_SM='<svg width="22" height="22" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M70 60 C100 60 100 140 130 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round"/><path d="M130 60 C100 60 100 140 70 140" fill="none" stroke="#FF6B2B" stroke-width="14" stroke-linecap="round" opacity=".45"/><circle cx="60" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="60" r="5" fill="#FF6B2B"/><circle cx="140" cy="60" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="60" r="5" fill="#FF6B2B"/><circle cx="60" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="60" cy="140" r="5" fill="#FF6B2B"/><circle cx="140" cy="140" r="14" fill="none" stroke="#FF6B2B" stroke-width="10"/><circle cx="140" cy="140" r="5" fill="#FF6B2B"/></svg>';
  /* Anti-doublon : si le titre du rider est identique au nom du show (déjà
     affiché en gros dans le bandeau méta plus bas), on ne le répète pas
     dans le bandeau du haut — on garde seulement note/infos s'il y en a. */
  var _bannerTitle=(rTitle&&_preShowName&&rTitle.trim().toLowerCase()===_preShowName.trim().toLowerCase())?'':rTitle;
  wrap.innerHTML=
    '<style>@keyframes svPulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes svSpin{to{transform:rotate(360deg)}}</style>'
    /* Halo orange discret en haut de page (même signature visuelle que la landing) */
    +'<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:920px;max-width:100vw;height:280px;background:radial-gradient(ellipse at 50% 0%,rgba(255,107,26,.08),transparent 65%);pointer-events:none"></div>'
    /* ── Barre du haut ── */
    +'<div style="position:relative;display:flex;align-items:center;min-height:'+(isMobile?'54':'62')+'px;background:rgba(8,11,18,.92);border-bottom:1px solid #1e2a3a;padding:0 '+(isMobile?'12':'24')+'px;gap:'+(isMobile?'8':'12')+'px">'
    +(isMobile?SV_LOGO_SM:SV_LOGO)
    +'<div style="font-size:'+(isMobile?'13':'15')+'px;font-weight:700">Patch<span style="color:#ff6b1a">Flow</span></div>'
    +'<div style="font-size:9px;font-family:DM Mono,monospace;color:#ff8c42;background:rgba(255,107,26,.1);border:1px solid rgba(255,107,26,.25);border-radius:5px;padding:2px 8px;letter-spacing:1.5px;text-transform:uppercase">Rider</div>'
    +'<div style="flex:1"></div>'
    +'<div style="display:inline-flex;align-items:center;gap:6px;font-size:'+(isMobile?'9':'10')+'px;font-family:DM Mono,monospace;background:rgba(34,214,160,.1);color:#22d6a0;border:1px solid rgba(34,214,160,.25);border-radius:20px;padding:'+(isMobile?'3px 9px':'4px 12px')+'"><span style="width:6px;height:6px;border-radius:50%;background:#22d6a0;animation:svPulse 2s infinite;flex-shrink:0"></span>'+(isMobile?'Live':'À jour en temps réel')+'</div>'
    +(isMobile?'':'<a href="/" style="display:inline-flex;align-items:center;gap:6px;background:#ff6b1a;color:#000;font-size:11.5px;font-weight:700;padding:7px 16px;border-radius:8px;text-decoration:none;font-family:Outfit,sans-serif;transition:background .15s" onmouseover="this.style.background=\'#ff8c42\'" onmouseout="this.style.background=\'#ff6b1a\'">Créer mon rider</a>')
    +'</div>'
    +(_bannerTitle||rNote||rInfo?
      '<div style="position:relative;background:linear-gradient(180deg,#0a1322,#080e1a);border-bottom:1px solid #1e2a3a;padding:'+(isMobile?'14px 14px':'18px 28px')+'">'
      +(_bannerTitle?'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="width:4px;height:'+(isMobile?'16':'20')+'px;background:linear-gradient(180deg,#ff6b1a,#ff3d00);border-radius:2px;flex-shrink:0"></span><span style="font-size:'+(isMobile?'17':'20')+'px;font-weight:800;color:#f0f4ff;letter-spacing:-.3px">'+esc(_bannerTitle)+'</span></div>':'')
      +(rNote?'<div style="font-size:'+(isMobile?'11':'12')+'px;color:#8899aa;line-height:1.6;white-space:pre-wrap;margin-bottom:'+(rInfo?'6px':'0')+'">'+esc(rNote)+'</div>':'')
      +(rInfo?'<div style="font-size:10px;font-family:DM Mono,monospace;color:#5a7a9a;margin-top:4px">'+esc(rInfo)+'</div>':'')
      +'</div>'
    :'')
    +tabsHtml
    +'<div id="sv-body" style="position:relative;flex:1;width:100%;max-width:1100px;margin:0 auto;padding:'+(isMobile?'14px 10px':'28px 20px')+'">'
    +'<div style="display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:70px"><div style="width:26px;height:26px;border:2.5px solid #1e2a3a;border-top-color:#ff6b1a;border-radius:50%;animation:svSpin .8s linear infinite"></div><div style="color:#5a6a80;font-family:DM Mono,monospace;font-size:11px">Chargement du rider…</div></div>'
    +'</div>'
    /* ── Bandeau conversion : les destinataires du lien sont de futurs clients ── */
    +'<div style="position:relative;width:100%;max-width:1100px;margin:8px auto 0;padding:'+(isMobile?'0 10px 30px':'0 20px 48px')+'">'
      +'<div style="background:linear-gradient(135deg,rgba(255,107,26,.1),rgba(255,107,26,.02) 45%,#0d1424 100%);border:1px solid rgba(255,107,26,.22);border-radius:16px;padding:'+(isMobile?'20px 18px':'26px 30px')+';display:flex;align-items:center;gap:'+(isMobile?'14':'22')+'px;flex-wrap:wrap">'
        +'<div style="width:46px;height:46px;border-radius:12px;background:rgba(255,107,26,.1);border:1px solid rgba(255,107,26,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0">'+SV_LOGO_SM+'</div>'
        +'<div style="flex:1;min-width:200px">'
          +'<div style="font-size:'+(isMobile?'14':'16')+'px;font-weight:800;color:#f0f4ff;margin-bottom:5px">Ce rider est fait avec PatchFlow</div>'
          +'<div style="font-size:'+(isMobile?'11.5':'12.5')+'px;color:#8899aa;line-height:1.65">Input List, plans, synoptique et fichiers de prod — créés et partagés en un lien, à jour en temps réel pour toute l\'équipe. Gratuit pour commencer.</div>'
        +'</div>'
        +'<a href="/" style="display:inline-flex;align-items:center;gap:8px;background:#ff6b1a;color:#000;font-size:13px;font-weight:700;padding:'+(isMobile?'11px 18px':'12px 22px')+';border-radius:10px;text-decoration:none;white-space:nowrap;font-family:Outfit,sans-serif;box-shadow:0 6px 24px rgba(255,107,26,.25);transition:background .15s" onmouseover="this.style.background=\'#ff8c42\'" onmouseout="this.style.background=\'#ff6b1a\'">Créer le mien — gratuit</a>'
      +'</div>'
      +'<div style="text-align:center;margin-top:16px;font-size:10px;font-family:DM Mono,monospace;color:#3a4a5a;letter-spacing:.5px">PatchFlow — Par des techniciens, pour des techniciens</div>'
    +'</div>';
  document.body.prepend(wrap);
  /* La vue rider est en place : on retire le splash de démarrage. */
  var _rspEl=document.getElementById('rider-splash'); if(_rspEl)_rspEl.remove();

  // Pre-generate signed URLs for all attached files
  var _signedUrls={};
  /* Header pour les appels publics aux edge functions Supabase —
     la gateway exige Authorization même pour les actions sans auth utilisateur.
     On utilise la clé anon (publique par design, déjà dans le HTML). */
  var _pubHeaders={'Content-Type':'application/json','Authorization':'Bearer '+SB_KEY};

  /* _fetchSignedUrls() est appelé APRÈS la résolution de _shareShowId
     (après le chargement du show) pour que showId soit toujours valide,
     notamment pour les liens ?link=uuid où sid=null au départ. */
  function _fetchSignedUrls(){
    if(!rFiles.length||!_shareShowId) return;
    Promise.all(rFiles.map(function(path){
      return fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',
        headers:_pubHeaders,
        body:JSON.stringify({action:'public-rider-file',path:path,showId:_shareShowId})
      }).then(function(r){return r.json();}).then(function(res){
        if(!res.error&&res.data?.signedUrl) _signedUrls[path]=res.data.signedUrl;
      }).catch(function(){});
    }));
  }

  // ── Load show via edge function publique (bypass RLS pour les liens partagés) ──
  var show,rows=[];
  try{
    /* Réutiliser la réponse déjà obtenue au pré-chargement (liens ?link= / ?rider=) ;
       sinon (lien legacy ?view=) faire l'appel maintenant. Évite un 2e aller-retour
       réseau + un 2e jeu de requêtes serveur pour le même show. */
    var _sfJson=_sharedResp||await _getShared();
    if(!_sfJson||_sfJson.error||!_sfJson.data){
      document.getElementById('sv-body').innerHTML='<div style="text-align:center;color:#f87171;margin-top:60px;font-size:14px">'
        +esc(_sfJson.error||'Show introuvable')+'</div>';
      return;
    }
    show=_sfJson.data.show;
    /* Résoudre _shareShowId depuis la réponse (pour les liens ?link= où sid=null) */
    if(show&&show.id){ _shareShowId=show.id; _fetchSignedUrls(); }
    /* Injecter overrideRider si présent (lien Pro nommé) */
    if(_sfJson.data.overrideRider&&show){
      if(!show.stage_data) show.stage_data={};
      if(!show.stage_data.rider) show.stage_data.rider={};
      Object.assign(show.stage_data.rider, _sfJson.data.overrideRider);
    }
    var _chs=_sfJson.data.channels||[];
    var _allRows=_chs.length?_chs:((show.stage_data&&show.stage_data.chs)||[]).slice().sort(function(a,b){return (a.ch||0)-(b.ch||0);});
    /* Charger les patches depuis le show */
    IL_PATCHES=show.il_patches||[{id:'main',name:'Patch 1',pos:0}];
    CUR_PATCH_ID=IL_PATCHES[0]?.id||'main';
    /* Charger les scènes depuis la réponse de get-shared-show */
    var _svScenes=_sfJson.data.scenes||[];
    if(_svScenes.length){
      SHOW_SCENES={syno:[],stage:[],site:[]};
      _svScenes.forEach(function(s){
        if(!SHOW_SCENES[s.type]) SHOW_SCENES[s.type]=[];
        SHOW_SCENES[s.type].push(s);
      });
      CUR_SCENES={syno:null,stage:null,site:null};
      ['syno','stage','site'].forEach(function(t){
        CUR_SCENES[t]=SHOW_SCENES[t][0]?.id||null;
      });
    }
    /* Référentiel complet (toutes les input lists) pour résoudre les liens du
       plan de scène vers des canaux d'autres listes que celle active. */
    ALL_CHS=_allRows.slice();
    /* Sorties (Output List) — pour afficher le numéro OUT des retours. */
    if(typeof OUT_DATA!=='undefined') OUT_DATA=show.out_data||{};
    _rebuildAllOut(show.out_data||{});
    /* Filtrer les canaux par patch courant */
    rows=_allRows.filter(function(r){return (r.patch_id||'main')===CUR_PATCH_ID;});
    // Inject CHS snapshot for canvas renderers
    if(rows.length){CHS.splice(0,CHS.length,...rows);}
  }catch(err){document.getElementById('sv-body').innerHTML='<div style="text-align:center;color:#f87171;margin-top:60px">Erreur: '+esc(err.message)+'</div>';return;}

  // ── Section renderers ──
  var now=new Date().toLocaleString('fr-FR');
  /* Chips méta : style carte (cohérent avec la landing), icônes Tabler */
  var _chipCss='display:inline-flex;align-items:center;gap:6px;font-size:'+(isMobile?'10':'11')+'px;font-family:DM Mono,monospace;color:#8899aa;background:#0d1424;border:1px solid #1e2a3a;border-radius:8px;padding:'+(isMobile?'4px 9px':'5px 12px')+'';
  var _showMeta='<div style="margin-bottom:'+(isMobile?'18':'28')+'px">'
    +'<div style="display:flex;align-items:center;gap:'+(isMobile?'9':'12')+'px;margin-bottom:'+(isMobile?'9':'12')+'px">'
      +'<span style="width:4px;height:'+(isMobile?'20':'26')+'px;background:linear-gradient(180deg,#ff6b1a,#ff3d00);border-radius:2px;flex-shrink:0"></span>'
      +'<span style="font-size:'+(isMobile?'19':'26')+'px;font-weight:800;letter-spacing:-.5px;line-height:1.15">'+esc(show.name||'')+'</span>'
    +'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +(show.venue?'<span style="'+_chipCss+'"><i class="ti ti-map-pin" style="color:#ff8c42;font-size:13px"></i>'+esc(show.venue)+'</span>':'')
    +(show.show_date?'<span style="'+_chipCss+'"><i class="ti ti-calendar" style="color:#1a8fff;font-size:13px"></i>'+show.show_date+'</span>':'')
    +'<span style="'+_chipCss+';color:#22d6a0;background:rgba(34,214,160,.07);border-color:rgba(34,214,160,.2)"><i class="ti ti-refresh" style="font-size:13px"></i>'+now+'</span>'
    +'</div></div>';

  /* Switch entre patches (Input List) — window pour accès global depuis onclick */
  window._svSelectPatch=function(patchId){
    CUR_PATCH_ID=patchId;
    rows=_allRows.filter(function(r){return (r.patch_id||'main')===CUR_PATCH_ID;});
    if(rows.length){CHS.splice(0,CHS.length,...rows);}
    _paneCache.out=undefined; // l'output list dépend aussi du patch courant
    _paneCache.il=_renderIL();
    document.getElementById('sv-body').innerHTML=_paneCache.il;
  };
  /* Switch entre patches (Output List) — chaque patch a ses propres sorties */
  window._svSelectOutPatch=function(patchId){
    CUR_PATCH_ID=patchId;
    rows=_allRows.filter(function(r){return (r.patch_id||'main')===CUR_PATCH_ID;});
    if(rows.length){CHS.splice(0,CHS.length,...rows);}
    _paneCache.il=undefined; // l'input list dépend aussi du patch courant
    _paneCache.out=_renderOUT();
    document.getElementById('sv-body').innerHTML=_paneCache.out;
  };
  /* ── « Voir le plan de scène » en un clic (depuis l'Input List) ──
     Source : image liée au lien (rider.stage_image) sinon le plan PatchFlow. */
  function _svCurPatch(){ return (IL_PATCHES||[]).find(function(p){return p.id===CUR_PATCH_ID;}); }
  function _svPatchStageImage(){ var p=_svCurPatch(); return (p&&p.stageImage)||''; }
  function _svPatchSceneId(){ var p=_svCurPatch(); return (p&&p.stageSceneId)||''; }
  function _svBandById(sceneId){
    var sc=(typeof SHOW_SCENES!=='undefined'&&SHOW_SCENES.stage)||[];
    var s=sc.find(function(x){return x.id===sceneId;});
    return (s&&s.data&&s.data.band)||null;
  }
  function _svPlanAvailable(){
    if(_svPatchStageImage()) return true;
    if(_svPatchSceneId()&&_svBandById(_svPatchSceneId())) return true;
    var rider=show.stage_data&&show.stage_data.rider;
    if(rider&&rider.stage_image) return true;
    var sc=(typeof SHOW_SCENES!=='undefined'&&SHOW_SCENES.stage)||[];
    for(var i=0;i<sc.length;i++){var b=sc[i].data&&sc[i].data.band;if(b&&((b.els&&b.els.length)||b.bgImage))return true;}
    var raw=show.stage_data; var band=raw&&raw.v>=2&&raw.band;
    if(band&&((band.els&&band.els.length)||band.bgImage))return true;
    return false;
  }
  function _svShowPlanImage(src){
    var old=document.getElementById('_svPlanImg'); if(old) old.remove();
    var img=document.createElement('img');
    img.id='_svPlanImg'; img.src=src;
    img.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1px;height:1px';
    document.body.appendChild(img);
    if(img.complete&&img.naturalWidth){ _svFs('_svPlanImg','Plan de scène'); }
    else { img.onload=function(){ _svFs('_svPlanImg','Plan de scène'); };
           img.onerror=function(){ alert('Impossible de charger le plan.'); }; }
  }
  window._svViewPlan=async function(){
    var rider=show.stage_data&&show.stage_data.rider;
    var stageImg=_svPatchStageImage()||(rider&&rider.stage_image);
    if(stageImg){
      try{
        var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
          method:'POST',headers:_pubHeaders,
          body:JSON.stringify({action:'public-rider-file',path:stageImg,showId:show.id,linkId:linkId||undefined})
        });
        var j=await res.json();
        if(j.error) throw new Error(j.error.message||j.error);
        var url=j.data&&j.data.signedUrl;
        if(!url) throw new Error('URL invalide');
        _svShowPlanImage(url);
      }catch(e){ alert('Erreur : '+e.message); }
      return;
    }
    /* Plan PatchFlow → rendu canvas puis plein écran. Si une scène précise est
       assignée à l'input list, on l'utilise ; sinon la scène courante. */
    var raw=show.stage_data;
    var bandData=(_svPatchSceneId()&&_svBandById(_svPatchSceneId()))
      ||_svCurrentSceneData('stage')
      ||((raw&&raw.v>=2)?raw.band||null:null);
    BandPlan.load(bandData);
    _makeBpCanvas(function(cv){ _svShowPlanImage(cv.toDataURL('image/png')); });
  };
  /* Helper: HTML du sélecteur de scènes */
  function _svSceneSelector(sceneType){
    var scenes=SHOW_SCENES[sceneType]||[];
    if(scenes.length<=1) return '';
    var cur=CUR_SCENES[sceneType];
    var html='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
    scenes.forEach(function(s){
      var active=s.id===cur;
      html+='<button onclick="_svSelectScene(\''+jsq(sceneType)+'\',\''+jsq(s.id)+'\')" '
        +'style="padding:6px 12px;border:1px solid '+(active?'#ff6b1a':'#1e2a3a')+';'
        +'background:'+(active?'rgba(255,107,26,.12)':'transparent')+';'
        +'color:'+(active?'#ff6b1a':'#5a6a80')+';border-radius:6px;font-size:11px;'
        +'font-weight:'+(active?'700':'500')+';cursor:pointer;font-family:var(--f)">'+esc(s.name)+'</button>';
    });
    html+='</div>';
    return html;
  }

  /* Helper: données de la scène courante.
     ATTENTION : pour le plan de scène, les données sont stockées sous la clé
     'band' (saveStage enregistre {band:...}), pas 'stage'. Sans ce mapping, le
     rider lisait scene.data['stage'] (undefined) et retombait toujours sur les
     données legacy stage_data.band — d'où l'opacité/le masquage de scène qui ne
     suivaient jamais les modifications faites en mode multi-scènes. */
  function _svCurrentSceneData(sceneType){
    var curId=CUR_SCENES[sceneType];
    if(!curId) return null;
    var scene=(SHOW_SCENES[sceneType]||[]).find(function(s){return s.id===curId;});
    if(!scene||!scene.data) return null;
    var dataKey=sceneType==='stage'?'band':sceneType;
    return scene.data[dataKey]||null;
  }

  /* Switch entre scènes — window pour accès global depuis onclick */
  window._svSelectScene=function(sceneType, sceneId){
    CUR_SCENES[sceneType]=sceneId;
    _paneCache[sceneType]=null;
    if(sceneType==='stage'){
      _renderStage(function(h){_paneCache.stage=h;document.getElementById('sv-body').innerHTML=h;});
    }else if(sceneType==='site'){
      _renderSite(function(h){_paneCache.site=h;document.getElementById('sv-body').innerHTML=h;});
    }else if(sceneType==='syno'){
      _paneCache.syno=_renderSyno();document.getElementById('sv-body').innerHTML=_paneCache.syno;
    }
  };

  function _renderIL(){
    var h=_showMeta;
    /* Fréquence HF (micros HF) : n'afficher la colonne que si au moins un
       canal en porte une — garde le rider propre pour les shows sans HF. */
    var _hfOf=function(r){return (r.custom_data&&r.custom_data._hf)||'';};
    var hasHf=rows.some(function(r){return _hfOf(r);});
    /* Selector pour les patches s'il y en a plusieurs */
    if(IL_PATCHES&&IL_PATCHES.length>1){
      h+='<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap">';
      IL_PATCHES.forEach(function(p){
        var active=p.id===CUR_PATCH_ID;
        h+='<button onclick="_svSelectPatch(\''+jsq(p.id)+'\')" style="padding:6px 12px;border:1px solid '+(active?'#ff6b1a':'#1e2a3a')+';background:'+(active?'var(--ora-d)':'transparent')+';color:'+(active?'#ff6b1a':'#5a6a80')+';border-radius:6px;font-size:11px;font-weight:'+(active?'700':'500')+';cursor:pointer;font-family:var(--f);transition:all .1s">'+esc(p.name)+'</button>';
      });
      h+='</div>';
    }
    /* Bouton « Voir le plan de scène » en un clic (si un plan est disponible). */
    if(_svPlanAvailable()){
      h+='<button onclick="_svViewPlan()" style="margin-bottom:14px;display:inline-flex;align-items:center;gap:8px;background:#ff6b1a;border:none;color:#000;font-size:12px;font-weight:700;padding:10px 16px;border-radius:9px;cursor:pointer;font-family:var(--f);box-shadow:0 2px 10px rgba(255,107,26,.25)">'
        +'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>'
        +'Voir le plan de scène</button>';
    }
    if(isMobile){
      // Card layout for phones
      h+='<div style="display:flex;flex-direction:column;gap:8px">';
      rows.forEach(function(r){
        var tags='';
        if(r.phantom) tags+='<span style="background:rgba(245,197,66,.15);color:#f5c542;border:1px solid rgba(245,197,66,.3);border-radius:4px;font-size:9px;padding:2px 6px;font-family:DM Mono,monospace">+48V</span> ';
        if(r.foh)    tags+='<span style="background:rgba(34,214,160,.12);color:#22d6a0;border:1px solid rgba(34,214,160,.25);border-radius:4px;font-size:9px;padding:2px 6px;font-family:DM Mono,monospace">FOH</span> ';
        if(r.mon)    tags+='<span style="background:rgba(26,143,255,.12);color:#1a8fff;border:1px solid rgba(26,143,255,.25);border-radius:4px;font-size:9px;padding:2px 6px;font-family:DM Mono,monospace">MON</span> ';
        if(_hfOf(r)) tags+='<span style="background:rgba(155,106,255,.12);color:#9b6aff;border:1px solid rgba(155,106,255,.25);border-radius:4px;font-size:9px;padding:2px 6px;font-family:DM Mono,monospace">HF '+esc(_hfOf(r))+'</span> ';
        h+='<div style="background:#0d1220;border:1px solid #1e2a3a;border-radius:10px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px">'
          +'<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:#ff6b1a;color:#000;font-family:DM Mono,monospace;font-size:13px;font-weight:800;min-width:30px;height:30px;border-radius:6px;padding:0 5px;letter-spacing:-.3px">'+r.ch+'</span>'
          +'<div style="flex:1;min-width:0">'
            +'<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:2px">'
              +(r.short_name?'<span style="font-weight:700;font-size:14px;color:#f0f4ff">'+esc(r.short_name)+'</span>':'')
              +(r.long_name?'<span style="font-size:12px;color:#8899aa">'+esc(r.long_name)+'</span>':'')
            +'</div>'
            +(r.source||r.mic?'<div style="font-size:10px;color:#5a7a9a;font-family:DM Mono,monospace;margin-bottom:4px">'+(r.source?esc(r.source):'')+(r.source&&r.mic?' &bull; ':'')+( r.mic?esc(r.mic):'')+'</div>':'')
            +(tags?'<div style="display:flex;gap:5px;flex-wrap:wrap">'+tags+'</div>':'')
            +(r.note?'<div style="margin-top:5px;font-size:10px;color:#5a6a80;font-style:italic">'+esc(r.note)+'</div>':'')
          +'</div>'
          +'</div>';
      });
      h+='</div>';
    } else {
      // Table layout for desktop
      h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
        +'<thead><tr style="background:#111827;color:#8899aa;font-family:DM Mono,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.8px">'
        +'<th style="padding:8px 10px;text-align:center;border-bottom:1px solid #1e2a3a;width:52px">CH</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Court</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Nom</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Source</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Micro</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">+48V</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">FOH</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">MON</th>'
        +(hasHf?'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Fréq. HF</th>':'')
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Note</th>'
        +'</tr></thead><tbody>';
      rows.forEach(function(r,i){
        var bg=i%2===0?'#0d1220':'#0a0f1c';
        h+='<tr style="background:'+bg+';border-bottom:1px solid #141c2e">'
          +'<td style="padding:6px 10px;text-align:center;vertical-align:middle">'
          +'<span style="display:inline-flex;align-items:center;justify-content:center;background:#ff6b1a;color:#000;font-family:DM Mono,monospace;font-size:13px;font-weight:800;min-width:28px;height:22px;border-radius:5px;padding:0 6px;letter-spacing:-.3px;line-height:1">'
          +r.ch+'</span></td>'
          +'<td style="padding:8px 12px;font-weight:700;font-size:13px;color:#f0f4ff">'+esc(r.short_name||'')+'</td>'
          +'<td style="padding:8px 12px;color:#c8d4e0;font-size:12px">'+esc(r.long_name||'')+'</td>'
          +'<td style="padding:8px 12px;color:#7a8a9a;font-family:DM Mono,monospace;font-size:10px">'+esc(r.source||'')+'</td>'
          +'<td style="padding:8px 12px;color:#7a8a9a;font-family:DM Mono,monospace;font-size:10px">'+esc(r.mic||'')+'</td>'
          +'<td style="padding:8px 12px">'+(r.phantom?'<span style="background:rgba(245,197,66,.15);color:#f5c542;border:1px solid rgba(245,197,66,.3);border-radius:4px;font-size:9px;padding:2px 6px;font-family:DM Mono,monospace">+48V</span>':'')+'</td>'
          +'<td style="padding:8px 12px;font-size:15px;font-weight:700">'+(r.foh?'<span style="color:#22d6a0">&#10003;</span>':'')+'</td>'
          +'<td style="padding:8px 12px;font-size:15px;font-weight:700">'+(r.mon?'<span style="color:#1a8fff">&#10003;</span>':'')+'</td>'
          +(hasHf?'<td style="padding:8px 12px;color:#9b6aff;font-family:DM Mono,monospace;font-size:10px">'+esc(_hfOf(r))+'</td>':'')
          +'<td style="padding:8px 12px;color:#5a6a80;font-size:11px">'+esc(r.note||'')+'</td>'
          +'</tr>';
      });
      h+='</tbody></table></div>';
    }
    h+='<div style="margin-top:20px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow — '+rows.length+' canaux — '+now+'</div>';
    return h;
  }

  function _renderStage(cb){
    const raw=show.stage_data;
    /* Utiliser les données de la scène active si disponible, sinon fallback stage_data.band */
    var sceneData=_svCurrentSceneData('stage');
    const bandData=sceneData||((raw&&raw.v>=2)?raw.band||null:null);
    BandPlan.load(bandData);
    _makeBpCanvas(function(cv){
      var dataUrl=cv.toDataURL('image/png');
      var imgW=cv.width, imgH=cv.height;
      if(isMobile){
        // Mobile : aperçu ajusté à l'écran (on voit tout le plan) + plein écran
        // pan/pinch au toucher via _svFs.
        var h=_showMeta+_svSceneSelector('stage');
        h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">'
          +'<div style="font-size:10px;color:#5a6a80;font-family:DM Mono,monospace;display:flex;align-items:center;gap:5px">'
            +'<span style="font-size:12px">&#128269;</span> Touchez le plan pour le plein écran'
          +'</div>'
          +'<button onclick="_svFs(\'_svStageImg\',\'Plan de scène\')" '
            +'style="flex-shrink:0;background:#ff6b1a;border:none;color:#000;font-size:11px;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit">'
            +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
            +'Plein écran'
          +'</button>'
        +'</div>';
        h+='<div onclick="_svFs(\'_svStageImg\',\'Plan de scène\')" style="border-radius:10px;border:1px solid #1e2a3a;background:#fff;overflow:hidden;cursor:zoom-in">'
          +'<img id="_svStageImg" src="'+safeSrc(dataUrl)+'" style="width:100%;height:auto;display:block"/>'
        +'</div>';
        h+='<div style="margin-top:14px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow · Plan de scene · '+now+'</div>';
        cb(h);
      } else {
        cb(_showMeta+_svSceneSelector('stage')
          +'<div style="overflow:auto;border-radius:10px;border:1px solid #1e2a3a;background:#0a0f1c">'
          +'<img src="'+safeSrc(dataUrl)+'" style="max-width:100%;display:block;border-radius:10px"/>'
          +'</div>'
          +'<div style="margin-top:14px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow · Plan de scene · '+now+'</div>');
      }
    });
  }

  function _renderSite(cb){
    const raw=show.stage_data;
    const rider=raw&&raw.rider;
    const siteSnap=rider&&rider.site_snapshot||null;
    /* Données de la scène SÉLECTIONNÉE (multi-scènes) sinon données directes */
    var sceneData=_svCurrentSceneData('site');
    var siteData=sceneData||((raw&&raw.v>=2)?raw.site||null:null);
    var hasData=siteData&&((siteData.elements&&siteData.elements.length)||siteData.bgImage);
    /* On rend la scène sélectionnée FIDÈLEMENT via le vrai SitePlan. Le snapshot
       n'est qu'un SECOURS : sinon, en multi-scènes, toutes les scènes
       afficheraient le même snapshot (celui figé à la création du lien). */
    if(hasData){
      _renderSiteFromData(siteData, function(dataUrl, dispW){
        if(dataUrl){ cb(_showMeta+_svSceneSelector('site')+_renderSiteImageHtml(dataUrl, dispW)); return; }
        if(siteSnap){ cb(_showMeta+_svSceneSelector('site')+_renderSiteImageHtml(siteSnap)); return; }
        cb(_showMeta+_svSceneSelector('site')+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:12px">'
          +'<i class="ti ti-map-2" style="font-size:32px;display:block;margin-bottom:12px;opacity:.4"></i>'
          +'Le plan de site n\'a pas pu être rendu.</div>');
      });
      return;
    }
    /* Pas de données pour cette scène : snapshot en secours si dispo */
    if(siteSnap){ cb(_showMeta+_svSceneSelector('site')+_renderSiteImageHtml(siteSnap)); return; }
    /* Rien du tout */
    cb(_showMeta+_svSceneSelector('site')+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:12px">'
      +'<i class="ti ti-map-2" style="font-size:32px;display:block;margin-bottom:12px;opacity:.4"></i>'
      +'Plan de site vide ou non sauvegardé.<br>'
      +'<span style="font-size:10px;opacity:.6">Ouvrez l\'onglet Plan de site, ajoutez des éléments, puis re-générez le lien.</span>'
      +'</div>');
  }

  /* Renderer site plan pour le lien partagé — autonome et FIDÈLE à l'app :
     fond BLANC (comme le canvas de l'app), couleurs réelles via SitePlan.itemMeta,
     icônes intégrées de la palette (recolorées via xmlns), taille réelle.
     NB : on n'utilise PAS SitePlan.exportCanvasSafe ici car _makeCanvas rend sur
     fond SOMBRE (#0a0f1c) — l'utilisateur veut le rendu blanc de l'app. */
  function _renderSiteFromData(siteData, cb){
    var els    = siteData.elements||[];
    var cables = siteData.cables||[];
    if(!els.length && !siteData.bgImage){ cb(null); return; }

    /* Couleur réelle d'un élément (palette SitePlan) avec repli minimal. */
    var _ITEM_COLORS_FB={'console':'#3b82f6','rack':'#8b5cf6','io':'#06b6d4','amp':'#f59e0b',
      'spk':'#10b981','net':'#6366f1','src':'#f43f5e','note':'#fbbf24','stagebox':'#14b8a6',
      'monitor':'#84cc16','sub':'#f97316','power':'#ef4444','di':'#a78bfa','main_array':'#1a8fff','default':'#5a6a80'};
    function _elColorOf(type){
      try{ if(typeof SitePlan!=='undefined' && SitePlan.itemMeta){ var m=SitePlan.itemMeta(type); if(m&&m.color) return m.color; } }catch(e){}
      return _ITEM_COLORS_FB[type]||_ITEM_COLORS_FB[(type||'').split('.')[0]]||_ITEM_COLORS_FB.default;
    }

    /* Couleurs types de câbles (palette SitePlan, sinon custom/défaut) */
    var _customCT = siteData.customCableTypes||[];
    function _cableColor(type){
      try{ if(typeof SitePlan!=='undefined' && SitePlan.cableMeta){ var cm=SitePlan.cableMeta(type); if(cm&&cm.color) return {color:cm.color,dash:cm.dash||null}; } }catch(e){}
      var ct=_customCT.find(function(t){return t.id===type;});
      if(ct) return {color:ct.color, dash:ct.dash||null};
      var defaults={'audio':{color:'#3b82f6'},'video':{color:'#a855f7'},
        'power':{color:'#f59e0b'},'network':{color:'#22c55e'},'other':{color:'#6b7280'}};
      return defaults[type]||{color:'#4a90d9'};
    }

    var TS = siteData.textScale||1;

    /* Pré-charger : images custom (iconImg) + icônes INTÉGRÉES de la palette,
       recolorées vers la couleur de l'élément pour rester visibles sur le fond
       sombre (les SVG de palette sont en navy #1d3a5f, invisibles sinon). */
    var _imgs={};       // id   -> image custom
    var _iconImgs={};   // type -> image icône intégrée (recolorée)
    var pending=0, done=0;
    function _tick(){ done++; if(done===pending) _draw(); }
    els.forEach(function(e){
      if(e.iconImg){
        pending++;
        var img=new Image();
        img.onload =function(){ _imgs[e.id]=img; _tick(); };
        img.onerror=_tick;
        img.src=e.iconImg;
        return;
      }
      /* Icône intégrée (une seule fois par type) */
      try{
        if(typeof SitePlan!=='undefined' && SitePlan.itemMeta && !_iconImgs[e.type]){
          var meta=SitePlan.itemMeta(e.type);
          if(meta && meta.icon){
            _iconImgs[e.type]='loading';
            pending++;
            var svg=String(meta.icon);
            /* xmlns OBLIGATOIRE pour charger un SVG comme <img> (les icônes de
               la palette n'en ont pas -> sinon l'image échoue et on retombe sur
               l'abréviation). Pas de recolor : navy #1d3a5f visible sur blanc,
               identique à l'app. */
            if(!/xmlns=/.test(svg)) svg=svg.replace(/^<svg /,'<svg xmlns="http://www.w3.org/2000/svg" ');
            if(!/\bwidth=/.test(svg)) svg=svg.replace(/^<svg /,'<svg width="64" height="64" ');
            var url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
            var im=new Image();
            im.onload =function(){ _iconImgs[e.type]=im; URL.revokeObjectURL(url); _tick(); };
            im.onerror=function(){ _iconImgs[e.type]=null; URL.revokeObjectURL(url); _tick(); };
            im.src=url;
          }
        }
      }catch(err){ /* repli abréviation */ }
    });

    /* Pré-charger l'image de fond */
    var _bgImg=null;
    if(siteData.bgImage){
      pending++;
      var bgI=new Image();
      bgI.onload =function(){ _bgImg=bgI; _tick(); };
      bgI.onerror=_tick;
      bgI.src=siteData.bgImage;
    }

    /* Si aucune image à charger, lancer directement */
    if(pending===0) _draw();

    function _rrect(ctx,x,y,w,h,r){
      if(ctx.roundRect){ ctx.roundRect(x,y,w,h,r); }
      else {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
        ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();
      }
    }

    function _draw(){
      try{
        if(!els.length&&!_bgImg){cb(null);return;}
        /* Bounding box : taille réelle des éléments + place pour labels en-dessous */
        var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        if(_bgImg){ minX=0;minY=0;maxX=_bgImg.naturalWidth;maxY=_bgImg.naturalHeight; }
        els.forEach(function(e){
          var esz=(e.elSize||72), iw=(e.type==='image_frame'?(e.imgPx||esz):esz);
          minX=Math.min(minX,e.x-40);
          minY=Math.min(minY,e.y-40);
          maxX=Math.max(maxX,e.x+Math.max(iw,200)+24);
          maxY=Math.max(maxY,e.y+esz+150);
        });
        if(!isFinite(minX)){ minX=0;minY=0;maxX=1200;maxY=800; }
        var W=maxX-minX, H=maxY-minY;
        var SCALE=Math.min(2,3840/Math.max(W,H));
        var cw=Math.round(W*SCALE), ch=Math.round(H*SCALE);
        var canvas=document.createElement('canvas');
        canvas.width=cw; canvas.height=ch;
        var ctx=canvas.getContext('2d');
        var wx=function(x){return (x-minX)*SCALE;};
        var wy=function(y){return (y-minY)*SCALE;};

        /* Fond BLANC (identique au canvas de l'app, pas de fond sombre) */
        ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cw,ch);
        if(_bgImg){
          ctx.save(); ctx.globalAlpha=(siteData.bgOpacity??100)/100;
          ctx.drawImage(_bgImg, wx(0), wy(0), _bgImg.naturalWidth*SCALE, _bgImg.naturalHeight*SCALE);
          ctx.restore();
        }

        /* Câbles — fidèle à l'éditeur : waypoints (polyligne), câbles libres,
           flèches de direction, jointures arrondies. */
        function _arrow(tx,ty,dx,dy,color,sz){
          var bx=tx-dx*sz, by=ty-dy*sz;
          ctx.save(); ctx.fillStyle=color; ctx.beginPath();
          ctx.moveTo(tx,ty);
          ctx.lineTo(bx-dy*sz*0.55, by+dx*sz*0.55);
          ctx.lineTo(bx+dy*sz*0.55, by-dx*sz*0.55);
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
        cables.forEach(function(c){
          var fcx,fcy,tcx,tcy,fR,tR;
          if(c.fromPt){
            fcx=c.fromPt.x; fcy=c.fromPt.y; tcx=c.toPt.x; tcy=c.toPt.y; fR=0; tR=0;
          } else {
            var from=els.find(function(e){return e.id===c.fromId;});
            var to  =els.find(function(e){return e.id===c.toId;});
            if(!from||!to) return;
            var fh=(from.type==='text_lbl'?20:(from.elSize||72)/2);
            var th=(to.type==='text_lbl'?20:(to.elSize||72)/2);
            fcx=from.x+fh; fcy=from.y+fh; tcx=to.x+th; tcy=to.y+th; fR=fh+4; tR=th+4;
          }
          var ct=_cableColor(c.type);
          var wps=(c.waypoints&&c.waypoints.length)?c.waypoints:null;
          ctx.strokeStyle=ct.color; ctx.lineWidth=(c.width||4)*SCALE;
          ctx.lineJoin='round'; ctx.lineCap='round';
          if(ct.dash) ctx.setLineDash(ct.dash.split(' ').map(function(n){return parseFloat(n)*SCALE;})); else ctx.setLineDash([]);
          var afx,afy,atx,aty,nx,ny,bnx,bny,mx,my,pts;
          if(wps){
            var first=wps[0], last=wps[wps.length-1];
            var sdx=first.x-fcx, sdy=first.y-fcy, sd=Math.hypot(sdx,sdy)||1; bnx=sdx/sd; bny=sdy/sd;
            var edx=tcx-last.x, edy=tcy-last.y, ed=Math.hypot(edx,edy)||1; nx=edx/ed; ny=edy/ed;
            afx=fcx+bnx*fR; afy=fcy+bny*fR; atx=tcx-nx*tR; aty=tcy-ny*tR;
            pts=[{x:afx,y:afy}].concat(wps.map(function(p){return {x:p.x,y:p.y};})).concat([{x:atx,y:aty}]);
            ctx.beginPath(); ctx.moveTo(wx(pts[0].x),wy(pts[0].y));
            for(var i=1;i<pts.length;i++) ctx.lineTo(wx(pts[i].x),wy(pts[i].y));
            ctx.stroke();
            var midp=pts[Math.floor(pts.length/2)]; mx=midp.x; my=midp.y;
          } else {
            var ddx=tcx-fcx, ddy=tcy-fcy, dist=Math.hypot(ddx,ddy)||1; nx=ddx/dist; ny=ddy/dist; bnx=nx; bny=ny;
            afx=fcx+nx*fR; afy=fcy+ny*fR; atx=tcx-nx*tR; aty=tcy-ny*tR;
            my=(afy+aty)/2; mx=(afx+atx)/2;
            ctx.beginPath(); ctx.moveTo(wx(afx),wy(afy));
            ctx.bezierCurveTo(wx(afx),wy(my), wx(atx),wy(my), wx(atx),wy(aty));
            ctx.stroke();
          }
          ctx.setLineDash([]);
          var ARR=14*SCALE, dir=c.direction||'forward';
          if(dir==='forward'||dir==='both') _arrow(wx(atx),wy(aty), nx, ny, ct.color, ARR);
          if(dir==='backward'||dir==='both') _arrow(wx(afx),wy(afy), -bnx, -bny, ct.color, ARR);
          if(c.label||c.length){
            var txt=[c.label,c.length].filter(Boolean).join(' · ');
            var cts=siteData.cableTextScale||1;
            var fs=14*cts*SCALE;
            ctx.font='700 '+fs+'px sans-serif';
            ctx.textAlign='center'; ctx.textBaseline='middle';
            var tw=ctx.measureText(txt).width, rh=fs*1.5, cx=wx(mx), cyy=wy(my)-rh*0.7;
            _rrect(ctx,cx-tw/2-6*cts*SCALE,cyy-rh/2,tw+12*cts*SCALE,rh,4*cts*SCALE);
            ctx.fillStyle='rgba(8,8,20,0.82)'; ctx.fill();
            ctx.fillStyle=ct.color; ctx.fillText(txt, cx, cyy);
          }
        });

        /* Éléments — rendu FIDÈLE à l'éditeur (carte blanche + icône + label). */
        els.forEach(function(e){
          var ex=wx(e.x), ey=wy(e.y);
          var ic=_elColorOf(e.type);
          var customImg=_imgs[e.id];
          var builtinIcon=_iconImgs[e.type];
          var iconImg=customImg||((builtinIcon&&builtinIcon!=='loading')?builtinIcon:null);
          _spDrawSiteNode(ctx, e, ex, ey, SCALE, TS, {color:ic, iconImg:iconImg, emoji:''});
        });

        /* 2e arg = largeur d'affichage en px RÉELS (coords monde) : le canvas est
           rendu en haute résolution (x SCALE) mais affiché à la taille réelle ->
           éléments à leur vraie taille (≈88px), plus de zoom excessif. */
        cb(canvas.toDataURL('image/png'), Math.round(W));
      }catch(err){ console.warn('[renderSiteFromData]',err); cb(null); }
    }
  }
  /* Retourne le HTML de l'image du plan de site (sans le _showMeta ni le sélecteur).
     dispW = largeur d'affichage souhaitée en px (optionnel). */
  function _renderSiteImageHtml(dataUrl, dispW){
    if(isMobile){
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">'
        +'<div style="font-size:10px;color:#5a6a80;font-family:DM Mono,monospace"><span style="font-size:12px">&#128269;</span> Touchez le plan pour le plein écran</div>'
        +'<button onclick="_svFs(\'_svSiteImg\',\'Plan de site\')" '
          +'style="flex-shrink:0;background:#ff6b1a;border:none;color:#000;font-size:11px;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit">'
          +'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
          +'Plein écran'
        +'</button>'
      +'</div>'
      +'<div onclick="_svFs(\'_svSiteImg\',\'Plan de site\')" style="border-radius:10px;border:1px solid #1e2a3a;background:#fff;overflow:hidden;cursor:zoom-in">'
        +'<img id="_svSiteImg" src="'+safeSrc(dataUrl)+'" style="width:100%;height:auto;display:block"/>'
      +'</div>'
      +'<div style="margin-top:14px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow · Plan de site · '+now+'</div>';
    } else {
      /* Affichage à la taille réelle (dispW) si fournie -> évite le sur-zoom,
         tout en gardant la haute résolution du canvas. Fond blanc. */
      var imgStyle = dispW
        ? 'width:'+dispW+'px;max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px'
        : 'max-width:100%;display:block;border-radius:8px';
      return '<div style="overflow:auto;border-radius:10px;border:1px solid #1e2a3a;background:#ffffff;padding:18px">'
        +'<img src="'+safeSrc(dataUrl)+'" style="'+imgStyle+'"/>'
        +'</div>'
        +'<div style="margin-top:14px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow · Plan de site · '+now+'</div>';
    }
  }

  function _renderSiteImage(dataUrl,cb){
    cb(_showMeta+_svSceneSelector('site')+_renderSiteImageHtml(dataUrl));
  }


  function _renderOUT(){
    // Try direct column first (only if non-empty), then rider snapshot
    var rider=show.stage_data&&show.stage_data.rider;
    var _od=show.out_data;
    var _snap=rider&&rider.out_snapshot;
    // An empty {} is truthy but useless — fall through to snapshot in that case
    var outData=(_od&&Object.keys(_od).length)?_od
               :(_snap&&Object.keys(_snap).length)?_snap:{};
    /* Sélecteur de patch (comme l'Input List) — chaque patch a ses sorties. */
    var _selOut='';
    if(IL_PATCHES&&IL_PATCHES.length>1){
      _selOut='<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap">';
      IL_PATCHES.forEach(function(p){
        var active=p.id===CUR_PATCH_ID;
        _selOut+='<button onclick="_svSelectOutPatch(\''+jsq(p.id)+'\')" style="padding:6px 12px;border:1px solid '+(active?'#ff6b1a':'#1e2a3a')+';background:'+(active?'var(--ora-d)':'transparent')+';color:'+(active?'#ff6b1a':'#5a6a80')+';border-radius:6px;font-size:11px;font-weight:'+(active?'700':'500')+';cursor:pointer;font-family:var(--f);transition:all .1s">'+esc(p.name)+'</button>';
      });
      _selOut+='</div>';
    }
    /* Ne montrer que les sorties du patch courant. Fallback : si une seule clé
       de patch, on la prend ; si plusieurs sans correspondance, on fusionne. */
    var _opids=Object.keys(outData);
    var allOuts;
    if(_opids.length>1 && outData[CUR_PATCH_ID]){ allOuts=(outData[CUR_PATCH_ID]||[]).slice(); }
    else if(_opids.length<=1){ allOuts=(outData[_opids[0]]||[]).slice(); }
    else { allOuts=[]; _opids.forEach(function(pid){(outData[pid]||[]).forEach(function(o){allOuts.push(o);});}); }
    if(!allOuts.length) return _showMeta+_selOut+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:13px">Aucune sortie configuree pour ce patch.</div>';
    /* Fréquence HF (ear monitors) : colonne affichée seulement si renseignée. */
    var hasOutHf=allOuts.some(function(r){return r.hf;});
    var OUT_COLORS={main:'#22d6a0',mon:'#1a8fff',iem:'#a855f7',fx:'#f5c542',matrix:'#f97316',other:'#5a6a80'};
    var h=_showMeta+_selOut;
    if(isMobile){
      // Card layout for phones
      h+='<div style="display:flex;flex-direction:column;gap:8px">';
      allOuts.forEach(function(r,i){
        var col=OUT_COLORS[r.type]||OUT_COLORS.other;
        h+='<div style="background:#0d1220;border:1px solid #1e2a3a;border-radius:10px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px">'
          +'<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:'+col+'22;color:'+col+';border:1px solid '+col+'44;font-family:DM Mono,monospace;font-size:12px;font-weight:800;min-width:30px;height:30px;border-radius:6px;padding:0 5px">'+(r.ch||i+1)+'</span>'
          +'<div style="flex:1;min-width:0">'
            +'<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:2px">'
              +(r.short_name?'<span style="font-weight:700;font-size:14px;color:#f0f4ff">'+esc(r.short_name)+'</span>':'')
              +(r.long_name?'<span style="font-size:12px;color:#8899aa">'+esc(r.long_name)+'</span>':'')
            +'</div>'
            +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px">'
              +'<span style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44;border-radius:4px;font-size:9px;padding:2px 7px;font-family:DM Mono,monospace;text-transform:uppercase">'+esc(r.type||'')+'</span>'
              +(r.dest?'<span style="font-size:10px;color:#5a7a9a;font-family:DM Mono,monospace">'+esc(r.dest)+'</span>':'')
              +(r.hf?'<span style="background:rgba(155,106,255,.12);color:#9b6aff;border:1px solid rgba(155,106,255,.25);border-radius:4px;font-size:9px;padding:2px 7px;font-family:DM Mono,monospace">HF '+esc(r.hf)+'</span>':'')
            +'</div>'
            +(r.note?'<div style="margin-top:5px;font-size:10px;color:#5a6a80;font-style:italic">'+esc(r.note)+'</div>':'')
          +'</div>'
          +'</div>';
      });
      h+='</div>';
    } else {
      h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
        +'<thead><tr style="background:#111827;color:#8899aa;font-family:DM Mono,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.8px">'
        +'<th style="padding:8px 16px;text-align:center;border-bottom:1px solid #1e2a3a;width:80px">N°</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Court</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Nom</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Type</th>'
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Destination</th>'
        +(hasOutHf?'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Fréq. HF</th>':'')
        +'<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #1e2a3a">Note</th>'
        +'</tr></thead><tbody>';
      allOuts.forEach(function(r,i){
        var bg=i%2===0?'#0d1220':'#0a0f1c';
        var col=OUT_COLORS[r.type]||OUT_COLORS.other;
        h+='<tr style="background:'+bg+';border-bottom:1px solid #141c2e">'
          +'<td style="padding:8px 16px;text-align:center;font-family:DM Mono,monospace;font-weight:700;color:#5a6a80">'+(r.ch||i+1)+'</td>'
          +'<td style="padding:8px 12px;font-weight:700;font-size:13px;color:#f0f4ff">'+esc(r.short_name||'')+'</td>'
          +'<td style="padding:8px 12px;color:#c8d4e0">'+esc(r.long_name||'')+'</td>'
          +'<td style="padding:8px 12px"><span style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44;border-radius:4px;font-size:9px;padding:2px 7px;font-family:DM Mono,monospace;text-transform:uppercase">'+esc(r.type||'')+'</span></td>'
          +'<td style="padding:8px 12px;color:#7a8a9a;font-family:DM Mono,monospace;font-size:10px">'+esc(r.dest||'')+'</td>'
          +(hasOutHf?'<td style="padding:8px 12px;color:#9b6aff;font-family:DM Mono,monospace;font-size:10px">'+esc(r.hf||'')+'</td>':'')
          +'<td style="padding:8px 12px;color:#5a6a80;font-size:11px">'+esc(r.note||'')+'</td>'
          +'</tr>';
      });
      h+='</tbody></table></div>';
    }
    h+='<div style="margin-top:20px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow — '+allOuts.length+' sortie'+(allOuts.length>1?'s':'')+' — '+now+'</div>';
    return h;
  }

  function _renderSyno(){
    var rider=show.stage_data&&show.stage_data.rider;
    /* Scène active en priorité, puis synoptique_data global, puis snapshot rider */
    var sceneData=_svCurrentSceneData('syno');
    var synData=sceneData||show.synoptique_data||(rider&&rider.syn_snapshot)||null;
    /* New SynPro schema : { v:1, title, brand, brandColor, footer, nodes, cables, networks } */
    if(!synData||synData.v!==1) return _showMeta+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:13px">Synoptique non disponible &mdash; ouvrez le synoptique dans l\'application et generez le lien.</div>';
    var nodes=synData.nodes||[];var cables=synData.cables||[];var nets=synData.networks||[];
    if(!nodes.length) return _showMeta+_svSceneSelector('syno')+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:13px">Synoptique vide.</div>';
    var netMap={};nets.forEach(function(n){netMap[n.id]=n;});
    /* Bounding box from node positions + default sizes (we don\'t have the LIB in share view) */
    var DEF={'console':{w:200,h:130},'rack':{w:170,h:140},'io':{w:160,h:90},'amp':{w:170,h:100},'spk':{w:130,h:110},'net':{w:140,h:80},'src':{w:120,h:90},'note':{w:200,h:80},'text_label':{w:160,h:30}};
    function sz(n){
      if(n.type==='image_frame'){var p=n.imgPx||120;return{w:p,h:p};}
      return DEF[n.type]||DEF[(n.type||'').split('.')[0]]||{w:140,h:100};
    }
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    nodes.forEach(function(n){var s=sz(n);minX=Math.min(minX,n.x||0);minY=Math.min(minY,n.y||0);maxX=Math.max(maxX,(n.x||0)+s.w);maxY=Math.max(maxY,(n.y||0)+s.h);});
    var pad=40;var vw=Math.max(1100,maxX-minX+pad*2);var vh=Math.max(560,maxY-minY+pad*2);
    var ox=pad-minX;var oy=pad-minY;
    /* Header band */
    var headH=56,footH=40;
    var brandCol=esc(synData.headerColor||synData.brandColor||'#1d9bf0');
    var nodeMap={};nodes.forEach(function(n){nodeMap[n.id]=n;});
    /* Cables — arrow markers + parallel offset + gap (same logic as editor) */
    var ARR=13;
    var colSet={};cables.forEach(function(c){var co=(netMap[c.network]&&netMap[c.network].color)||'#5a6a80';colSet[co]=true;});
    var edgeDefs='<defs>';
    Object.keys(colSet).forEach(function(co){
      var id='sarr-'+co.replace('#','');
      edgeDefs+='<marker id="'+id+'-fwd" markerWidth="'+ARR+'" markerHeight="'+ARR+'" refX="'+(ARR-1)+'" refY="'+(ARR/2)+'" orient="auto" markerUnits="userSpaceOnUse"><path d="M1,'+(ARR*0.18)+' L'+(ARR-1)+','+(ARR/2)+' L1,'+(ARR*0.82)+' Z" fill="'+co+'"/></marker>';
      edgeDefs+='<marker id="'+id+'-bwd" markerWidth="'+ARR+'" markerHeight="'+ARR+'" refX="1" refY="'+(ARR/2)+'" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,'+(ARR*0.18)+' L'+(ARR-1)+','+(ARR/2)+' L1,'+(ARR*0.82)+' Z" fill="'+co+'"/></marker>';
    });
    edgeDefs+='</defs>';
    /* Group parallel cables */
    var sPairGroups={};
    cables.forEach(function(c){if(!nodeMap[c.from]||!nodeMap[c.to])return;var k=[c.from,c.to].sort().join('|');(sPairGroups[k]=sPairGroups[k]||[]).push(c.id);});
    var edgeSvg=edgeDefs;
    cables.forEach(function(c){
      var fn=nodeMap[c.from],tn=nodeMap[c.to];if(!fn||!tn)return;
      var fs=sz(fn),ts=sz(tn);
      var fcx=(fn.x||0)+ox+fs.w/2,fcy=(fn.y||0)+oy+fs.h/2;
      var tcx=(tn.x||0)+ox+ts.w/2,tcy=(tn.y||0)+oy+ts.h/2;
      var dx=tcx-fcx,dy=tcy-fcy;var horiz=Math.abs(dx)>=Math.abs(dy);
      var p0x,p0y,p1x,p1y;
      if(horiz){p0x=fcx+(dx>=0?fs.w/2:-fs.w/2);p0y=fcy;p1x=tcx+(dx>=0?-ts.w/2:ts.w/2);p1y=tcy;}
      else{p0x=fcx;p0y=fcy+(dy>=0?fs.h/2:-fs.h/2);p1x=tcx;p1y=tcy+(dy>=0?-ts.h/2:ts.h/2);}
      p0y+=headH;p1y+=headH;
      var col=(netMap[c.network]&&netMap[c.network].color)||'#5a6a80';
      var key=[c.from,c.to].sort().join('|');
      var grp=sPairGroups[key]||[c.id];var idx=grp.indexOf(c.id);var cnt=grp.length;
      var ldx=p1x-p0x,ldy=p1y-p0y;var ll=Math.sqrt(ldx*ldx+ldy*ldy)||1;
      var ux=ldx/ll,uy=ldy/ll,perpX=-uy,perpY=ux;
      var STEP=16,GAP=7;
      var off=idx*STEP-(cnt-1)*STEP/2;
      var sx0=p0x+perpX*off+ux*GAP,sy0=p0y+perpY*off+uy*GAP;
      var sx1=p1x+perpX*off-ux*GAP,sy1=p1y+perpY*off-uy*GAP;
      var midX=(sx0+sx1)/2,midY=(sy0+sy1)/2;
      var dir=c.dir||'none';var cid='sarr-'+col.replace('#','');
      var mEnd=(dir==='forward'||dir==='both')?' marker-end="url(#'+cid+'-fwd)"':'';
      var mStart=(dir==='backward'||dir==='both')?' marker-start="url(#'+cid+'-bwd)"':'';
      /* vector-effect="non-scaling-stroke" : garde le trait visible (2.5px)
         même quand le SVG est réduit à 100% sur mobile (évite sub-pixel invisible) */
      edgeSvg+='<line x1="'+sx0+'" y1="'+sy0+'" x2="'+sx1+'" y2="'+sy1+'" stroke="'+col+'" stroke-width="2.5" stroke-linecap="butt" vector-effect="non-scaling-stroke"'+mEnd+mStart+'/>';
      if(c.label){
        var lines=c.label.split('\n');var lh=12,maxLen=0;
        lines.forEach(function(l){maxLen=Math.max(maxLen,l.length);});
        var bw=Math.min(160,maxLen*6.5+12);var totalH=lines.length*lh;
        var labelGap=(cnt>1)?(idx-(cnt-1)/2)*(totalH+10):0;
        var lx=midX+perpX*labelGap,ly=midY+perpY*labelGap;
        edgeSvg+='<rect x="'+(lx-bw/2)+'" y="'+(ly-totalH/2-3)+'" width="'+bw+'" height="'+(totalH+6)+'" rx="3" fill="#fff"/>';
        lines.forEach(function(l,i){
          edgeSvg+='<text x="'+lx+'" y="'+(ly-totalH/2+lh/2+3+i*lh)+'" text-anchor="middle" font-family="Outfit,sans-serif" font-size="10" font-weight="500" fill="'+col+'">'+esc(l)+'</text>';
        });
      }
    });
    /* Nodes (simple rectangular cards — no icons in share view to keep payload small) */
    var nodeSvg='';
    nodes.forEach(function(n){
      var s=sz(n);var x=(n.x||0)+ox,y=(n.y||0)+oy+headH;var w=s.w,h=s.h;
      if(n.type==='note'){
        nodeSvg+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="6" fill="#fef3c7" stroke="#fbbf24"/>';
        nodeSvg+='<foreignObject x="'+(x+8)+'" y="'+(y+8)+'" width="'+(w-16)+'" height="'+(h-16)+'"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Outfit,sans-serif;font-size:11px;color:#92400e;line-height:1.4;font-weight:600">'+esc(n.label||'')+'<br>'+esc(n.sub||'')+'</div></foreignObject>';
      } else if(n.type==='text_label'){
        var tls=(n.label||'').split('\n');
        tls.forEach(function(tl,i){nodeSvg+='<text x="'+x+'" y="'+(y+16+i*18)+'" font-family="Outfit,sans-serif" font-size="14" font-weight="700" fill="#1d3a5f">'+esc(tl)+'</text>';});
      } else if(n.type==='image_frame'){
        if(n.iconImg){
          nodeSvg+='<image x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" href="'+safeSrc(n.iconImg)+'" xlink:href="'+safeSrc(n.iconImg)+'" preserveAspectRatio="xMidYMid meet"/>';
          if(n.label)nodeSvg+='<text x="'+(x+w/2)+'" y="'+(y+h+14)+'" text-anchor="middle" font-family="Outfit,sans-serif" font-size="11" fill="#1d3a5f">'+esc(n.label)+'</text>';
        }
      } else {
        nodeSvg+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="9" fill="#fff" stroke="#c8d4e0"/>';
        /* Icon area */
        var iconAreaH=h-46, iconAreaY=y+10;
        /* Custom image takes priority over SVG icon */
        if(n.iconImg){
          var iw2=Math.min(iconAreaH,w-20),ih2=iconAreaH;
          var ix2=(x+(w-iw2)/2),iy2=iconAreaY;
          nodeSvg+='<image x="'+ix2+'" y="'+iy2+'" width="'+iw2+'" height="'+ih2+'" href="'+safeSrc(n.iconImg)+'" xlink:href="'+safeSrc(n.iconImg)+'" preserveAspectRatio="xMidYMid meet"/>';
        }
        /* Use stored iconSvg; fall back to live LIB lookup for older nodes */
        var _icSvg=n.iconImg?null:(n.iconSvg||(window.SynPro&&typeof window.SynPro.getIconByType==='function'?window.SynPro.getIconByType(n.type):''));
        if(_icSvg){
          /* Inline SVG icon directly (no data URI — works everywhere) */
          var iw=Math.min(iconAreaH,w-20), ih=iconAreaH;
          var ix=(x+(w-iw)/2), iy=iconAreaY;
          /* Strip outer <svg> wrapper and re-wrap with correct position/size */
          var inner=_icSvg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
          /* Extract original viewBox from the icon SVG */
          var vbMatch=_icSvg.match(/viewBox=["']([^"']+)["']/);
          var vbAttr=vbMatch?'viewBox="'+vbMatch[1]+'"':'viewBox="0 0 64 48"';
          nodeSvg+='<svg x="'+ix+'" y="'+iy+'" width="'+iw+'" height="'+ih+'" overflow="visible" '+vbAttr+' preserveAspectRatio="xMidYMid meet">'+inner+'</svg>';
        } else {
          nodeSvg+='<rect x="'+(x+w/2-26)+'" y="'+(iconAreaY)+'" width="52" height="'+(iconAreaH)+'" rx="4" fill="#e8eef5" stroke="#c8d4e0" stroke-width=".5"/>';
        }
        nodeSvg+='<text x="'+(x+w/2)+'" y="'+(y+h-22)+'" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="700" font-size="12" fill="#1d3a5f">'+esc(n.label||'')+'</text>';
        if(n.sub){var sublines=n.sub.split('\n');sublines.forEach(function(s2,i){nodeSvg+='<text x="'+(x+w/2)+'" y="'+(y+h-8+i*11)+'" text-anchor="middle" font-family="Outfit,sans-serif" font-size="9" fill="#5a6a80">'+esc(s2)+'</text>';});}
      }
    });
    /* Header — title only centered */
    var headSvg='<rect x="0" y="0" width="'+vw+'" height="'+headH+'" fill="'+brandCol+'"/>'
      +'<text x="'+(vw/2)+'" y="'+(headH/2+7)+'" text-anchor="middle" font-family="Outfit,sans-serif" font-weight="700" font-size="20" fill="#fff">'+esc(synData.title||'')+'</text>';
    /* Footer */
    var footSvg='<rect x="0" y="'+(vh+headH)+'" width="'+vw+'" height="'+footH+'" fill="#fff"/>';
    var legX=14,legY=vh+headH+25;
    var used=nets.filter(function(n){return cables.some(function(c){return c.network===n.id;});});
    used.forEach(function(n,i){
      footSvg+='<rect x="'+(legX+i*150)+'" y="'+(legY-3)+'" width="22" height="3" rx="1.5" fill="'+n.color+'"/>';
      footSvg+='<text x="'+(legX+i*150+28)+'" y="'+legY+'" font-family="Outfit,sans-serif" font-size="11" fill="#5a6a80">'+esc(n.name)+'</text>';
    });
    footSvg+='<text x="'+(vw-14)+'" y="'+(vh+headH+footH-12)+'" text-anchor="end" font-family="Outfit,sans-serif" font-size="11" font-weight="600" fill="'+brandCol+'">'+esc(synData.footer||'')+'</text>';
    /* Canvas bg */
    var bgSvg='<rect x="0" y="'+headH+'" width="'+vw+'" height="'+vh+'" fill="#f7f9fc"/>';
    var fullH=vh+headH+footH;
    var svgStr='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 '+vw+' '+fullH+'" style="max-width:100%;border-radius:10px;border:1px solid #1e2a3a;background:#fff;display:block">'+headSvg+bgSvg+edgeSvg+nodeSvg+footSvg+'</svg>';
    return _showMeta+_svSceneSelector('syno')+svgStr
      +'<div style="margin-top:14px;text-align:center;font-size:10px;color:#3a4a5a;font-family:DM Mono,monospace">PatchFlow &middot; Synoptique &middot; '+now+'</div>';
  }

  // ── Pieces jointes tab ──
  var _activeFile=0;
  function _fileCard(i,fpath,url){
    var fname=fpath.split('/').pop();
    var disp=(typeof _fichDisplayName==='function')?_fichDisplayName(fname):fname.replace(/^[a-z0-9]+_/i,'');
    var ext=(fname.split('.').pop()||'').toLowerCase();
    /* Icône Tabler par type (cohérent avec la section Fichiers) */
    var info=(typeof _fichInfoOf==='function')?_fichInfoOf(disp):null;
    var icon=(info&&info.icon)||'<i class="ti ti-file" style="color:#8899aa;font-size:20px"></i>';
    return '<div onclick="_svOpenFile('+i+')" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #1e2a3a;border-radius:10px;background:#0d1520;transition:border-color .15s,background .15s" onmouseover="this.style.borderColor=\'#ff6b1a\';this.style.background=\'#111c2e\'" onmouseout="this.style.borderColor=\'#1e2a3a\';this.style.background=\'#0d1520\'">'
      +'<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:9px;background:#0a0f1c">'+icon+'</span>'
      +'<div style="flex:1;overflow:hidden"><div style="font-size:13px;font-weight:600;color:#e0eaf8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(disp)+'</div>'
      +'<div style="font-size:9px;font-family:DM Mono,monospace;color:#5a6a80;margin-top:2px">'+ext.toUpperCase()+((info&&info.label)?' · '+esc(info.label):'')+'</div></div>'
      +'<i class="ti ti-eye" style="color:#ff6b1a;font-size:17px;flex-shrink:0" title="Ouvrir"></i>'
      +'<button onclick="event.stopPropagation();_svDownloadAttach('+i+')" title="Télécharger" style="color:#5a6a80;font-size:16px;flex-shrink:0;background:none;border:none;cursor:pointer;padding:0;display:inline-flex"><i class="ti ti-download"></i></button>'
      +'</div>';
  }
  /* Ouvre le fichier dans la même visionneuse modale que la section Fichiers
     (PDF.js défilable/zoomable, image, vidéo, audio…), en lecture seule. */
  window._svOpenFile=function(i){
    var fp=rFiles[i]; if(!fp) return;
    var url=_signedUrls[fp];
    var disp=(typeof _fichDisplayName==='function')?_fichDisplayName(fp.split('/').pop()):fp.split('/').pop().replace(/^[a-z0-9]+_/i,'');
    if(!url){ alert('Fichier temporairement indisponible — réessayez dans un instant.'); return; }
    if(typeof _openFileViewer==='function'){ _openFileViewer(url, disp, {readonly:true}); }
    else { window.open(url,'_blank','noopener'); }
  };
  /* Téléchargement d'une pièce jointe avec son nom propre (le serveur force le
     Content-Disposition ; l'attribut download est ignoré cross-origin sur B2). */
  window._svDownloadAttach=async function(i){
    var fp=rFiles[i]; if(!fp) return;
    var name=(typeof _fichDisplayName==='function')?_fichDisplayName(fp.split('/').pop()):fp.split('/').pop().replace(/^[a-z0-9]+_/i,'');
    try{
      var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',headers:_pubHeaders,
        body:JSON.stringify({action:'public-rider-file',path:fp,showId:_shareShowId,linkId:linkId||undefined,downloadName:name})
      });
      var json=await res.json();
      if(json.error) throw new Error(json.error.message||json.error);
      var url=json.data?.signedUrl; if(!url) throw new Error('URL invalide');
      var a=document.createElement('a'); a.href=url; a.download=name; a.target='_blank'; a.click();
    }catch(e){ alert('Erreur : '+e.message); }
  };

  function _fileViewer(fpath,url){
    if(!url) return '<div style="text-align:center;color:#f87171;padding:40px;font-size:12px">Fichier temporairement indisponible.</div>';
    var ext=(fpath.split('.').pop()||'').toLowerCase();
    if(ext==='pdf'){
      if(isMobile){
        // Sur mobile, les iframes PDF ne defilent pas — ouvrir dans le viewer natif du navigateur
        var fname=fpath.split('/').pop().replace(/^[a-z0-9]+_/i,'');
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:48px 24px;text-align:center">'
          +'<div style="width:64px;height:80px;background:#1e2a3a;border:2px solid #2d3d50;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">'
            +'<div style="font-size:26px;line-height:1">&#128196;</div>'
            +'<div style="font-size:8px;font-family:DM Mono,monospace;font-weight:700;color:#ff6b1a;letter-spacing:1px">PDF</div>'
          +'</div>'
          +'<div>'
            +'<div style="font-size:14px;font-weight:700;color:#e0eaf8;margin-bottom:6px;word-break:break-all">'+esc(fname)+'</div>'
            +'<div style="font-size:11px;color:#5a6a80">Appuyez pour ouvrir dans votre navigateur</div>'
          +'</div>'
          +'<div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px">'
            +'<a href="'+url+'" target="_blank" rel="noopener" '
              +'style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;background:#ff6b1a;color:#000;font-weight:700;border-radius:10px;text-decoration:none;font-size:14px">'
              +'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
              +'Ouvrir le PDF'
            +'</a>'
            +'<button onclick="_svDownloadAttach('+_activeFile+')" '
              +'style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;background:#1e2a3a;border:1px solid #2d3d50;color:#a0b0c0;font-weight:600;border-radius:10px;font-size:13px;cursor:pointer">'
              +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
              +'Telecharger'
            +'</button>'
          +'</div>'
        +'</div>';
      }
      return '<iframe src="'+url+'" style="width:100%;height:100%;min-height:70vh;flex:1;border:none;border-radius:8px;background:#111;display:block" allowfullscreen></iframe>';
    }
    if(['mp4','mov','webm','avi'].includes(ext)){
      return '<video src="'+url+'" controls style="width:100%;max-height:70vh;border-radius:8px;background:#000;display:block"></video>';
    }
    if(['mp3','wav','m4a','aac','flac','ogg'].includes(ext)){
      var fname=fpath.split('/').pop().replace(/^[a-z0-9]+_/i,'');
      return '<div style="padding:40px 20px;text-align:center">'
        +'<div style="font-size:48px;margin-bottom:16px">&#127925;</div>'
        +'<div style="font-size:14px;font-weight:600;color:#c8d4e0;margin-bottom:20px">'+esc(fname)+'</div>'
        +'<audio src="'+url+'" controls style="width:100%;max-width:480px;accent-color:#ff6b1a"></audio>'
        +'</div>';
    }
    // Other formats: download card
    var fname=fpath.split('/').pop().replace(/^[a-z0-9]+_/i,'');
    var ext2=(fpath.split('.').pop()||'').toUpperCase();
    return '<div style="text-align:center;padding:60px 20px">'
      +'<div style="font-size:52px;margin-bottom:16px">&#128196;</div>'
      +'<div style="font-size:15px;font-weight:700;color:#c8d4e0;margin-bottom:6px">'+esc(fname)+'</div>'
      +'<div style="font-size:10px;font-family:DM Mono,monospace;color:#5a6a80;margin-bottom:24px">'+ext2+'</div>'
      +'<button onclick="_svDownloadAttach('+_activeFile+')" style="display:inline-flex;align-items:center;gap:8px;padding:10px 22px;background:#ff6b1a;color:#000;font-weight:700;border-radius:8px;font-size:13px;cursor:pointer;border:none">&#11123; Telecharger</button>'
      +'</div>';
  }

  /* ── Fichiers cloud — lecture seule de l'espace B2 du show ──
     Charge la liste des fichiers/dossiers du show via la edge function b2-storage,
     génère des signed URLs et affiche un explorateur en lecture seule. */
  var _cloudFiles=null; // cache pour éviter re-fetch
  var _cloudPath=[]; // navigation dossiers
  var _cloudSignedUrls={};

  function _renderCloudPane(cb){
    var body=document.getElementById('sv-body');
    if(body) body.innerHTML='<div style="text-align:center;color:#5a6a80;font-family:DM Mono,monospace;padding:60px 20px;font-size:12px"><div class="spinner" style="margin:0 auto 14px"></div>Chargement des fichiers…</div>';
    _cloudLoadDir([], cb);
  }

  function _cloudPathStr(path){ return path.length?path.join('/')+'/'  :''; }
  function _cloudPrefix(path){ return show.id+'/'+_cloudPathStr(path); }

  async function _cloudLoadDir(path, cb){
    var prefix=_cloudPrefix(path);
    try{
      /* Appel B2 avec le token de l'utilisateur courant — la vue partagée
         utilise la session de lecture de Supabase (anon, RLS appliquée) */
      var sess=(await sb.auth.getSession()).data?.session;
      var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+(sess?.access_token||SB_KEY)},
        body:JSON.stringify({action:'list',prefix:prefix})
      });
      var json=await res.json();
      if(json.error) throw new Error(json.error.message||json.error);
      var files=json.data||[];
      _cloudFiles=files;
      _cloudPath=path;
      cb(_buildCloudHTML(files, path));
    }catch(e){
      cb(_showMeta+'<div style="text-align:center;color:#f87171;padding:40px;font-size:12px">Erreur chargement fichiers : '+esc(e.message)+'</div>');
    }
  }

  function _buildCloudHTML(files, path){
    /* Icône Tabler + couleur par type de fichier (rendu pro, cohérent app) */
    var FTYPE=function(name){
      var ext=(name.split('.').pop()||'').toLowerCase();
      var au=['ti-music','#a78bfa'],vi=['ti-movie','#f472b6'],im=['ti-photo','#34d399'],
          xl=['ti-file-spreadsheet','#22c55e'],dc=['ti-file-text','#60a5fa'],
          zp=['ti-file-zip','#eab308'],se=['ti-adjustments-bolt','#fb923c'];
      var map={mp3:au,wav:au,aiff:au,flac:au,aac:au,ogg:au,
               mp4:vi,mov:vi,avi:vi,
               jpg:im,jpeg:im,png:im,gif:im,webp:im,svg:im,
               xlsx:xl,xls:xl,csv:xl,
               docx:dc,doc:dc,txt:dc,
               pdf:['ti-file-type-pdf','#f87171'],
               zip:zp,rar:zp,'7z':zp,
               ptx:se,als:se,rpp:se,logicx:se};
      return map[ext]||['ti-file','#8899aa'];
    };
    /* Pastille d'icône carrée (dossier/fichier) */
    var _icoBox=function(cls,color,bg){
      return '<span style="display:inline-flex;width:36px;height:36px;border-radius:9px;background:'+bg+';align-items:center;justify-content:center;flex-shrink:0">'
        +'<i class="ti '+cls+'" style="color:'+color+';font-size:18px"></i></span>';
    };
    var folders=files.filter(function(f){return f.id===null;});
    var fileItems=files.filter(function(f){return f.id!==null;});

    var h=_showMeta;
    /* Breadcrumb — data-path évite les guillemets dans onclick */
    if(path.length){
      h+='<div id="_cloud_bc" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;font-family:DM Mono,monospace">';
      h+='<span class="_cloud_nav" data-path="[]" style="color:#1a8fff;cursor:pointer">Fichiers</span>';
      path.forEach(function(seg,i){
        h+=' <span style="color:#3a4a5a">/</span> ';
        if(i<path.length-1){
          var sub=path.slice(0,i+1);
          h+='<span class="_cloud_nav" data-path="'+_fEsc(JSON.stringify(sub))+'" style="color:#1a8fff;cursor:pointer">'+esc(seg)+'</span>';
        } else {
          h+='<span style="color:#c8d8f0">'+esc(seg)+'</span>';
        }
      });
      h+='</div>';
    }

    if(!folders.length&&!fileItems.length){
      return h+'<div style="text-align:center;color:#5a6a80;padding:40px;font-size:12px">Dossier vide.</div>';
    }

    h+='<div id="_cloud_list" style="display:flex;flex-direction:column;gap:6px">';
    /* Dossiers — data-path pour navigation */
    folders.forEach(function(f){
      var newPath=JSON.stringify(path.concat([f.name]));
      h+='<div class="_cloud_nav" data-path="'+_fEsc(newPath)+'" '
        +'style="display:flex;align-items:center;gap:12px;padding:9px 14px;background:#0d1220;border:1px solid #1e2a3a;border-radius:11px;cursor:pointer;transition:border-color .12s,background .12s" '
        +'onmouseover="this.style.borderColor=\'#ff6b1a\';this.style.background=\'#111a2c\'" onmouseout="this.style.borderColor=\'#1e2a3a\';this.style.background=\'#0d1220\'">'
        +_icoBox('ti-folder','#f5c542','rgba(245,197,66,.12)')
        +'<span style="font-size:13px;font-weight:600;color:#e2e8f0">'+esc(f.name)+'</span>'
        +'<span style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#5a6a80;font-family:DM Mono,monospace">Ouvrir<i class="ti ti-arrow-right" style="font-size:13px"></i></span>'
        +'</div>';
    });
    /* Fichiers — ligne cliquable pour OUVRIR (visionneuse), + bouton télécharger */
    fileItems.forEach(function(f){
      var name=(typeof _fichDisplayName==='function')?_fichDisplayName(f.name):f.name.replace(/^[a-z0-9]+_/,'');
      var size=f.metadata&&f.metadata.size?_cloudFmtSize(f.metadata.size):'';
      var fp=_cloudPrefix(path)+f.name;
      var ft=FTYPE(name);
      h+='<div class="_cloud_open" data-fp="'+_fEsc(fp)+'" data-name="'+_fEsc(name)+'" '
        +'style="display:flex;align-items:center;gap:12px;padding:9px 14px;background:#0d1220;border:1px solid #1e2a3a;border-radius:11px;cursor:pointer;transition:border-color .12s,background .12s" '
        +'onmouseover="this.style.borderColor=\'#ff6b1a\';this.style.background=\'#111a2c\'" onmouseout="this.style.borderColor=\'#1e2a3a\';this.style.background=\'#0d1220\'">'
        +_icoBox(ft[0],ft[1],'rgba(255,255,255,.04)')
        +'<div style="min-width:0;flex:1">'
          +'<div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(name)+'</div>'
          +(size?'<div style="font-size:10px;color:#5a6a80;font-family:DM Mono,monospace;margin-top:1px">'+esc(size)+'</div>':'')
        +'</div>'
        +'<span style="flex-shrink:0;color:#ff6b1a;display:inline-flex;align-items:center" title="Ouvrir"><i class="ti ti-eye" style="font-size:16px"></i></span>'
        +'<button class="_cloud_dl" data-fp="'+_fEsc(fp)+'" data-name="'+_fEsc(name)+'" title="Télécharger" '
          +'style="flex-shrink:0;display:inline-flex;align-items:center;background:#1e2a3a;border:1px solid #2d3d50;color:#c0d0e0;font-size:11px;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer;transition:all .12s" '
          +'onmouseover="this.style.background=\'#2d3d50\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'#1e2a3a\';this.style.color=\'#c0d0e0\'">'
          +'<i class="ti ti-download" style="font-size:14px"></i></button>'
        +'</div>';
    });
    h+='</div>';
    return h;
  }

  function _cloudFmtSize(b){
    if(!b)return '';
    if(b<1024)return b+' o';
    if(b<1048576)return (b/1024).toFixed(1)+' Ko';
    return (b/1048576).toFixed(1)+' Mo';
  }

  var _cloudCurrentShowId=_shareShowId||sid; // showId de la vue partagée

  function _cloudNavTo(path){
    var body=document.getElementById('sv-body');
    if(body) body.innerHTML='<div style="text-align:center;color:#5a6a80;padding:60px;font-size:12px"><div class="spinner" style="margin:0 auto 14px"></div>Chargement…</div>';
    _cloudLoadDir(path, function(h){
      if(body){ body.innerHTML=h; _cloudBindEvents(body); }
    });
  }

  /* Délégation d'événements — attachée après chaque injection HTML */
  function _cloudBindEvents(container){
    /* Navigation dossiers */
    container.querySelectorAll('._cloud_nav').forEach(function(el){
      el.addEventListener('click',function(){
        try{ _cloudNavTo(JSON.parse(el.getAttribute('data-path')||'[]')); }catch(e){}
      });
    });
    /* Ouverture d'un fichier (même visionneuse que la section Fichiers) */
    container.querySelectorAll('._cloud_open').forEach(function(el){
      el.addEventListener('click',function(){
        _cloudOpen(el.getAttribute('data-fp'),el.getAttribute('data-name'));
      });
    });
    /* Téléchargements (stopPropagation : ne pas déclencher l'ouverture de la ligne) */
    container.querySelectorAll('._cloud_dl').forEach(function(el){
      el.addEventListener('click',function(e){
        e.stopPropagation();
        _cloudDownload(el.getAttribute('data-fp'),el.getAttribute('data-name'));
      });
    });
  }

  /* Récupère une URL signée publique puis ouvre le fichier dans la visionneuse
     modale partagée (PDF.js, image, vidéo, audio…), comme la section Fichiers. */
  async function _cloudOpen(filePath, name){
    var info=(typeof _fichInfoOf==='function')?_fichInfoOf(name):{preview:'none'};
    if(info.preview==='none'){ _cloudDownload(filePath,name); return; }
    try{
      var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',
        headers:_pubHeaders,
        body:JSON.stringify({action:'public-rider-file',path:filePath,showId:_cloudCurrentShowId,linkId:linkId||undefined})
      });
      var json=await res.json();
      if(json.error) throw new Error(json.error.message||json.error);
      var url=json.data?.signedUrl;
      if(!url) throw new Error('URL invalide');
      if(typeof _openFileViewer==='function'){ _openFileViewer(url, name, {readonly:true}); }
      else { window.open(url,'_blank','noopener'); }
    }catch(e){
      alert('Erreur : '+e.message);
    }
  }

  async function _cloudLoadDir(path, cb){
    var prefix=_cloudPrefix(path);
    try{
      var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',
        headers:_pubHeaders,
        body:JSON.stringify({action:'public-cloud-list',prefix:prefix,showId:_cloudCurrentShowId,linkId:linkId||undefined})
      });
      var json=await res.json();
      if(json.error) throw new Error(json.error.message||json.error);
      var files=json.data||[];
      _cloudFiles=files;
      _cloudPath=path;
      cb(_buildCloudHTML(files, path));
    }catch(e){
      cb(_showMeta+'<div style="text-align:center;color:#f87171;padding:40px;font-size:12px">Erreur chargement fichiers : '+esc(e.message)+'</div>');
    }
  }

  async function _cloudDownload(filePath, name){
    try{
      var res=await fetch('https://ofiiutcueoogmtdvaupg.supabase.co/functions/v1/b2-storage',{
        method:'POST',
        headers:_pubHeaders,
        body:JSON.stringify({action:'public-rider-file',path:filePath,showId:_cloudCurrentShowId,linkId:linkId||undefined,downloadName:name})
      });
      var json=await res.json();
      if(json.error) throw new Error(json.error.message||json.error);
      var url=json.data?.signedUrl;
      if(!url) throw new Error('URL invalide');
      var a=document.createElement('a'); a.href=url; a.download=name; a.target='_blank'; a.click();
    }catch(e){
      alert('Erreur : '+e.message);
    }
  }

  function _renderFilesPane(){
    if(!rFiles.length) return '<div style="text-align:center;color:#5a6a80;padding:60px">Aucun fichier joint.</div>';
    var h='<div style="max-width:640px;margin:0 auto;padding:8px 0">'
      +'<div style="font-size:10px;font-family:DM Mono,monospace;color:#5a6a80;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px 2px">'+rFiles.length+' fichier'+(rFiles.length>1?'s':'')+' joint'+(rFiles.length>1?'s':'')+' · cliquez pour ouvrir</div>'
      +'<div style="display:flex;flex-direction:column;gap:8px">';
    for(var i=0;i<rFiles.length;i++){ h+=_fileCard(i,rFiles[i],_signedUrls[rFiles[i]]); }
    h+='</div></div>';
    return h;
  }

  window._svFileSelect=function(i){
    _activeFile=i;
    // Rebuild sidebar cards
    var cards=document.querySelectorAll('#sv-body [onclick^="_svFileSelect"]');
    rFiles.forEach(function(fp,idx){
      var card=cards[idx];if(!card)return;
      var active=idx===i;
      card.style.background=active?'#111c2e':'#0d1520';
      card.style.borderColor=active?'#ff6b1a':'#1e2a3a';
      var nameEl=card.querySelector('div>div:first-child');
      if(nameEl)nameEl.style.color=active?'#ff6b1a':'#c8d4e0';
    });
    var vw=document.getElementById('sv-file-viewer');
    if(vw)vw.innerHTML=_fileViewer(rFiles[i],_signedUrls[rFiles[i]]);
  };

  // ── Pane cache & tab switcher ──
  var _paneCache={};
  window._svSwitch=function(sec){
    allSections.forEach(function(s){
      var t=document.getElementById('svt-'+s);
      if(t) t.style.cssText=s===sec?SV_TABCSS_ON:SV_TABCSS;
    });
    if(_paneCache[sec]!==undefined){
      var _cb=document.getElementById('sv-body');
      _cb.innerHTML=_paneCache[sec];
      /* Le cloud pane utilise la délégation d'événements (addEventListener) ;
         restaurer le HTML depuis le cache perd les handlers → réattacher,
         sinon on ne peut plus ouvrir de dossier après un changement d'onglet. */
      if(sec==='cloud') _cloudBindEvents(_cb);
      return;
    }
    document.getElementById('sv-body').innerHTML='<div style="text-align:center;color:#5a6a80;font-family:DM Mono,monospace;margin-top:60px">Chargement...</div>';
    if(sec==='il'){_paneCache.il=_renderIL();document.getElementById('sv-body').innerHTML=_paneCache.il;}
    else if(sec==='out'){_paneCache.out=_renderOUT();document.getElementById('sv-body').innerHTML=_paneCache.out;}
    else if(sec==='stage'){_renderStage(function(h){_paneCache.stage=h;document.getElementById('sv-body').innerHTML=h;});}
    else if(sec==='site'){_renderSite(function(h){_paneCache.site=h;document.getElementById('sv-body').innerHTML=h;});}
    else if(sec==='syno'){_paneCache.syno=_renderSyno();document.getElementById('sv-body').innerHTML=_paneCache.syno;}
    else if(sec==='cloud'){
      _renderCloudPane(function(h){
        _paneCache.cloud=h;
        var body=document.getElementById('sv-body');
        body.innerHTML=h;
        _cloudBindEvents(body);
      });
    }
    else if(sec==='files'){
      // Wait for signed URLs if not yet ready, then render
      var tryRender=function(){
        var h=_renderFilesPane();
        document.getElementById('sv-body').innerHTML=h;
      };
      // If URLs not yet resolved give a short delay
      var allReady=rFiles.every(function(fp){return _signedUrls[fp];});
      if(allReady){tryRender();}else{setTimeout(tryRender,1200);}
    }
  };

  // ── Initial render ──
  var first=allSections[0]||'il';
  window._svSwitch(first);
})();