/* Capture de l'app sur un écran de téléphone, sans compte ni réseau (Supabase simulé).
   python3 serve.py &  puis  node tests/shot.js demo /tmp/rf "rfMobCal()"
   argv : demo|empty, préfixe du fichier, code JS optionnel exécuté avant une 2e capture. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
(async()=>{
  const mode=process.argv[2]||'demo', out=process.argv[3]||'shot';
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  p.on('pageerror',e=>console.log('ERR',e.message));
  await p.route(/supabase\.co/,r=>r.abort());
  await p.route(/cdn\.jsdelivr\.net/,r=>r.abort());
  await p.addInitScript(()=>{window.supabase={createClient:function(){var q=new Proxy(function(){},{get:function(t,k){if(k==='then')return function(f){return Promise.resolve({data:null,error:null}).then(f)};return function(){return q}},apply:function(){return q}});return {from:function(){return q},rpc:function(){return q},storage:{from:function(){return q}},channel:function(){return q},removeChannel:function(){},functions:{invoke:async function(){return {}}},auth:{getSession:async function(){return {data:{session:null}}},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}}},getUser:async function(){return {data:{user:null}}}}}}};});
  await p.route(/google|gvt1|fonts\./,r=>r.abort());
  await p.goto('http://127.0.0.1:7821/app.html',{waitUntil:'load'});
  await p.addScriptTag({path:require('path').join(__dirname,'rf-fixtures.js')});
  await p.evaluate((mode)=>{
    document.getElementById('auth-wrap')?.classList.remove('show'); document.getElementById('app').className='show';
    ME={id:'demo',email:'demo@x'};
    let rf=null;
    if(mode==='demo'){ const pr=_rfParseShw(RF_FIX.festival); rf=_rfEmpty(); rf.ch=_rfMerge([],pr,{mode:'coord'}).ch; rf.zones=pr.zones; }
    CUR_SHOW={id:'demo',name:'Festival démo',stage_data:{v:2,rf}};
    goTab('rf',null);
  },mode);
  await p.waitForTimeout(1200);
  await p.screenshot({path:out+'.png',fullPage:true});
  if(process.argv[4]){ await p.evaluate(process.argv[4]); await p.waitForTimeout(800); await p.screenshot({path:out+'-2.png',fullPage:true}); }
  await b.close();
})();
