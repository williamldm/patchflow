/* Rider partagé sans serveur : get-shared-show est simulé avec deux versions d'un show (tests/rider-fixture.js).
   Visite 1, puis visite 2 avec des changements : vérifie le bandeau « Mis à jour depuis votre dernière visite »,
   les repères, le bouton « Vu », et prend des captures.
   python3 serve.py &  puis  node tests/rider-shot.js 390 /tmp/rider   (largeur, préfixe des captures) */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const F=require('./rider-fixture.js');
(async()=>{
  const w=+process.argv[2]||390, out=process.argv[3]||'/tmp/rider';
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await b.newContext({viewport:{width:w,height:w<500?844:900},deviceScaleFactor:w<500?2:1,isMobile:w<500,hasTouch:w<500});
  let ver='base';
  await ctx.route(/get-shared-show/,r=>r.fulfill({contentType:'application/json',body:JSON.stringify({data:F[ver](),error:null})}));
  await ctx.route(/cdn\.jsdelivr\.net|fonts\.|google|gstatic|b2-storage/,r=>r.abort());
  await ctx.addInitScript(()=>{window.supabase={createClient:function(){var q=new Proxy(function(){},{get:function(t,k){if(k==='then')return function(f){return Promise.resolve({data:null,error:null}).then(f)};return function(){return q}},apply:function(){return q}});return {from:function(){return q},rpc:function(){return q},storage:{from:function(){return q}},channel:function(){return q},removeChannel:function(){},functions:{invoke:async function(){return {}}},auth:{getSession:async function(){return {data:{session:null}}},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}}},getUser:async function(){return {data:{user:null}}}}}}};});
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message)); p.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE',m.text().slice(0,200)); });
  const url='http://127.0.0.1:7821/rider.html?link=abcd1234';
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({path:out+'-1road.png',fullPage:true});
  console.log('visit1 banner:', await p.$('#sv-chg')?'yes':'no');
  ver='v2'; await p.reload(); await p.waitForTimeout(1500);
  console.log('visit2 banner:', await p.$('#sv-chg')?'yes':'no', '| tabs chg:', await p.$$eval('.sv-tab.chg',l=>l.map(x=>x.id).join(',')));
  await p.screenshot({path:out+'-2road.png',fullPage:true});
  await p.evaluate(()=>_svSwitch('il')); await p.waitForTimeout(600); await p.screenshot({path:out+'-2il.png',fullPage:true});
  console.log('IL rows marked:', await p.$$eval('tr.sv-chg',l=>l.map(x=>x.className+':'+x.querySelector('.sv-n b').textContent).join(' | ')));
  console.log('banner lines:', await p.$$eval('#sv-chg li',l=>l.map(x=>x.textContent).join(' / ')));
  await p.evaluate(()=>_svSwitch('out')); await p.waitForTimeout(600); await p.screenshot({path:out+'-2out.png',fullPage:true});
  await p.reload(); await p.waitForTimeout(1200);
  console.log('reload within gap banner:', await p.$('#sv-chg')?'yes':'no');
  await p.click('.sv-chgb-ok'); await p.waitForTimeout(400);
  console.log('after Vu banner:', await p.$('#sv-chg')?'yes':'no');
  await p.reload(); await p.waitForTimeout(1200);
  console.log('reload after Vu banner:', await p.$('#sv-chg')?'yes':'no');
  await b.close();
})();
