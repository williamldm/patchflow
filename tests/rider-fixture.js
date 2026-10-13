/* Deux versions du même show : la visite 1, puis la visite 2 avec des changements */
const today=new Date(), iso=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
const hh=today.getHours(), pad=n=>String(n).padStart(2,'0');
function base(){
  return {
    show:{ id:'11111111-2222-4333-8444-555555555555', name:'Festival des Nuits', venue:'Le Rocher, Paris', show_date:iso,
      stage_data:{ v:2, rider:{},
        road:{ v:1, addr:'12 rue de la Scène, 75011 Paris', access:'Quai côté cour, hauteur 1,10 m. Code portail 4521.', parking:'1 porteur 12 m sur le quai',
          hotel:'Hôtel du Parc, 3 rue Haute — check-in 15 h', meals:'Catering 19:00 au foyer, 2 végétariens', loges:'2 loges au 1er étage', wifi:'Rocher-Artistes / show2026', notes:'Pass à retirer à l\'accueil artistes.',
          sched:[
            {id:'s1',t:pad(Math.max(0,hh-3))+':00',l:'Arrivée équipe technique',n:'Accueil par la régie salle'},
            {id:'s2',t:pad(Math.max(0,hh-2))+':00',l:'Déchargement',n:''},
            {id:'s3',t:pad(Math.max(0,hh-1))+':30',l:'Balance',n:'Batterie d\'abord'},
            {id:'s4',t:pad(Math.min(23,hh+1))+':00',l:'Ouverture des portes',n:''},
            {id:'s5',t:pad(Math.min(23,hh+2))+':00',l:'Concert',n:'1 h 30'},
            {id:'s6',t:'00:30',l:'Démontage',n:''}],
          people:[{id:'p1',r:'Régisseur son de la salle',n:'Camille Martin',p:'06 12 34 56 78',m:'camille@exemple.fr'},{id:'p2',r:'Tour manager',n:'Alex Durand',p:'+33 6 98 76 54 32',m:''}] } },
      out_data:{ main:[{id:'o1',ch:1,short_name:'WDG1',long_name:'Wedge chant',type:'mon',dest:'Avant-scène',hf:'',note:''},{id:'o2',ch:2,short_name:'IEM1',long_name:'Ear batteur',type:'iem',dest:'',hf:'606.125',note:''}] },
      il_patches:null, synoptique_data:null },
    channels:[
      {id:'c1',ch:1,short_name:'KICK',long_name:'Grosse caisse',source:'Batterie',mic:'Beta 91A',phantom:true,foh:true,mon:true,note:'',custom_data:{}},
      {id:'c2',ch:2,short_name:'SNR',long_name:'Caisse claire',source:'Batterie',mic:'SM57',phantom:false,foh:true,mon:true,note:'Petit pied',custom_data:{_alt:'e906 / i5'}},
      {id:'c3',ch:3,short_name:'BASS',long_name:'Basse DI',source:'Basse',mic:'Radial J48',phantom:true,foh:true,mon:false,note:'',custom_data:{}},
      {id:'c4',ch:4,short_name:'VOX',long_name:'Lead vox',source:'Chant',mic:'SM58',phantom:false,foh:true,mon:true,note:'Grand pied',custom_data:{_alt:'Beta 58A'}}],
    scenes:[], riderName:'Régie du Rocher', overrideRider:{sections:['road','il','out'], title:''}
  };
}
function v2(){
  const d=base();
  d.channels[1].mic='SM57 Beta'; d.channels[1].custom_data._alt='e906';       // micro modifié
  d.channels.splice(2,1);                                                      // basse retirée
  d.channels.forEach((c,i)=>c.ch=i+1);                                          // renumérotation après retrait
  d.channels.push({id:'c5',ch:4,short_name:'GTR',long_name:'Guitare',source:'Guitare',mic:'e906',phantom:false,foh:true,mon:true,note:'Petit pied',custom_data:{}}); // ajout
  d.show.stage_data.road.sched[2].t=d.show.stage_data.road.sched[2].t.replace(':30',':45');  // balance décalée
  d.show.stage_data.road.people.push({id:'p3',r:'Accueil artistes',n:'Sam Leroy',p:'07 11 22 33 44',m:''});
  d.show.stage_data.road.wifi='Rocher-Artistes / nuits2026';
  d.show.out_data.main[1].hf='614.250';
  return d;
}
module.exports={base,v2};
