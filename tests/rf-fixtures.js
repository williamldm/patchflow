/* Sessions Wireless Workbench synthétiques, au même schéma que les .shw de WWB 7.
   Aucune donnée réelle : noms, identifiants et fréquences sont inventés. */
var RF_FIX = (function(){
  function dev(o){
    var ch = o.ch.map(function(c, i){
      return '<channel number="' + (i + 1) + '"><channel_name type="10"><![CDATA[' + c.n + ']]></channel_name><frequency type="3">' + c.f + '</frequency>' +
        (c.pw ? '<tx_power type="2">' + c.pw + '</tx_power>' : '') + '<tags type="10">' + (c.tags || '') + '</tags><group_channel type="10">' + (c.gc || '--,--') + '</group_channel></channel>';
    }).join('');
    return '<device><id dcid="X">' + o.id + '</id><series>' + o.ser + '</series><model type="10">' + o.mdl + '</model><manufacturer type="10">' + (o.mk || 'Shure') + '</manufacturer>' +
      '<device_name type="10"><![CDATA[' + (o.name || o.mdl) + ']]></device_name><band type="10">' + o.band + '</band><zone type="12">' + (o.zone || '') + '</zone>' + ch + '</device>';
  }
  function entry(o){
    return '<freq_entry id="e" tag="' + (o.tag || '') + '"><compat_key><zone>' + (o.zone || '') + '</zone><series>' + o.ser + '</series><band>' + o.band + '</band></compat_key>' +
      '<compat_prof_id>' + (o.prof || '') + '</compat_prof_id><value>' + o.f + '</value><context_role>2</context_role>' +
      '<model>' + (o.mdl || '') + '</model><source_id>' + o.sid + '</source_id><source_name>' + (o.name || '') + '</source_name>' +
      (o.types ? '<dev_category>' + o.types.map(function(t){ return '<dev_type>' + t + '</dev_type>'; }).join('') + '</dev_category>' : '') + '</freq_entry>';
  }
  function show(o){
    var zones = (o.zones || []).map(function(z, i){ return '<zone ordinal="' + i + '" color="#ffff00">' + z + '</zone>'; }).join('');
    var mat = (o.matrix || []).map(function(m){ return '<from zone="' + m[0] + '"><to zone="' + m[1] + '"><ch-ch>' + m[2] + '</ch-ch><ch-imd>' + m[2] + '</ch-imd></to></from>'; }).join('');
    var profs = (o.profs || []).map(function(p){ return '<profile><band>' + p.band + '</band><series>' + p.ser + '</series><compat_profile id="' + p.id + '" name="' + (p.name || 'Standard') + '"><spacing freq_units="kHz"><ch_ch>' + p.sp + '</ch_ch></spacing></compat_profile></profile>'; }).join('');
    var excl = (o.excl || []).map(function(e){ return '<range><frequency units="kHz"><start>' + e[0] + '</start><end>' + e[1] + '</end></frequency><source>' + (e[3] || 'User') + '</source><notes>' + (e[2] || '') + '</notes><exclude>' + (e[4] === false ? 0 : 1) + '</exclude></range>'; }).join('');
    var tv = (o.tv || []).map(function(t){ return '<channel><number>' + t[0] + '</number><tv_chann_start_freq>' + t[1] + '</tv_chann_start_freq><tv_chann_end_freq>' + t[2] + '</tv_chann_end_freq><exclude>' + (t[3] ? 'true' : 'false') + '</exclude></channel>'; }).join('');
    return '<show date="Mon Jan 05 2026" time="10:00:00" source="test.local" appl_version="7.8.0.66" version="1.0">' +
      '<show_properties version="1.0"><show_info><name>' + (o.name || 'Show de test') + '</name><customer/></show_info><notes/></show_properties>' +
      '<inventory version="2.1">' + (o.devices || []).join('') + '<zones version="1.1">' + zones + '<zone_matrix>' + mat + '</zone_matrix></zones></inventory>' +
      '<coordination_info><channel_exclusions version="1.0"><channel_avoidance_info>' + tv + '</channel_avoidance_info></channel_exclusions>' +
      '<global_exclusions version="1.0"><freq_range_exclusions>' + excl + '</freq_range_exclusions></global_exclusions></coordination_info>' +
      '<coordinated_data_root id="r" version="0.3"><mic_channels count="0" units="kHz">' + (o.entries || []).join('') + '</mic_channels>' +
      '<compatibility_profile_settings count="0" version="1.0">' + profs + '</compatibility_profile_settings></coordinated_data_root></show>';
  }
  var RX = ['Receiver', 'Microphone', 'Rack'], IEM = ['In Ear Monitor', 'Transmitter', 'Rack'];
  /* Festival : coordination faite mais pas encore envoyée aux appareils (inventaire sur valeurs par défaut) */
  var festival = show({ name:'Festival Test', zones:['Plateau', 'Accueil'], matrix:[['Plateau', 'Accueil', 0], ['Accueil', 'Plateau', 0], ['Plateau', 'Plateau', 1]],
    devices:[
      dev({ id:'AAAA0001', ser:'AD', mdl:'AD4D-A', band:'G56', zone:'Plateau', ch:[{ n:'Lead Vox', f:470150, tags:'Plateau' }, { n:'Shure', f:470150 }] }),
      dev({ id:'AAAA0002', ser:'ULXD', mdl:'ULXD4', band:'K51', zone:'Plateau', ch:[{ n:'Guitare HF', f:606000 }] }),
      dev({ id:'AAAA0003', ser:'PSM1000', mdl:'PSM1000', name:'P10T 01', band:'L8E', zone:'Plateau', ch:[{ n:'IEM Lead', f:626125, pw:10 }, { n:'IEM Bat', f:626125, pw:50 }] }),
      dev({ id:'AAAA0004', ser:'SR 2050', mdl:'SR 2050', mk:'Sennheiser', band:'Gw', zone:'Accueil', ch:[{ n:'Speaker', f:558000, pw:10, gc:'G:1 Ch:3' }, { n:'Sennheiser', f:558000 }] }),
      '<device><id>BBBB0001</id><series>UA</series><model type="10">UA845</model><manufacturer type="10">Shure</manufacturer><device_name type="10">Distri</device_name></device>'
    ],
    entries:[
      entry({ sid:'AAAA0001-0', ser:'AD', band:'G56', zone:'Plateau', f:511475, prof:'p-ad', types:RX }),
      entry({ sid:'AAAA0001-1', ser:'AD', band:'G56', zone:'Plateau', f:512000, prof:'p-ad', types:RX }),
      entry({ sid:'AAAA0002', ser:'ULXD', band:'K51', zone:'Plateau', f:611250, prof:'autre-id', types:RX }),
      entry({ sid:'AAAA0003-0', ser:'PSM1000', band:'L8E', zone:'Plateau', f:630000, prof:'p-ps', types:IEM }),
      entry({ sid:'AAAA0003-1', ser:'PSM1000', band:'L8E', zone:'Plateau', f:631000, prof:'p-ps', types:IEM }),
      entry({ sid:'AAAA0004-0', ser:'SR 2050', band:'Gw', zone:'Accueil', f:560000, prof:'p-sr', types:IEM }),
      entry({ sid:'00000000-0000-0000-0000-000000000002', ser:'AD', band:'G56', zone:'Plateau', f:540475 })
    ],
    profs:[{ id:'p-ad', ser:'AD', band:'G56', sp:350 }, { id:'p-ul', ser:'ULXD', band:'K51', sp:350, name:'Robust' }, { id:'p-ps', ser:'PSM1000', band:'L8E', sp:325, name:'More Frequencies*' }, { id:'p-sr', ser:'SR 2050', band:'Gw', sp:325, name:'SR perso' }],
    excl:[[480000, 488000, 'DVB local'], [700000, 710000, 'ignorée', 'User', false]],
    tv:[['21', '470,000 MHz', '478,000 MHz', false], ['30', '542,000 MHz', '550,000 MHz', true]] });
  /* Même parc, recoordonné et déployé : une fréquence change, un appareil disparaît, un autre arrive */
  var festival2 = show({ name:'Festival Test', zones:['Plateau', 'Accueil'],
    devices:[
      dev({ id:'AAAA0001', ser:'AD', mdl:'AD4D-A', band:'G56', zone:'Plateau', ch:[{ n:'Lead Vox', f:513000 }, { n:'Choeur', f:512000 }] }),
      dev({ id:'AAAA0003', ser:'PSM1000', mdl:'PSM1000', name:'P10T 01', band:'L8E', zone:'Plateau', ch:[{ n:'IEM Lead', f:630000, pw:10 }, { n:'IEM Bat', f:631000, pw:50 }] }),
      dev({ id:'AAAA0009', ser:'AD', mdl:'AD4D-A', band:'G56', zone:'Plateau', ch:[{ n:'Spare 1', f:520000 }, { n:'Spare 2', f:521000 }] })
    ] });
  /* Émetteur IEM large bande : quatre canaux audio, une seule porteuse coordonnée */
  var wideband = show({ name:'Large bande', zones:['Plateau'],
    devices:[
      dev({ id:'CCCC0001', ser:'ADPSM', mdl:'ADTQ', band:'G56', zone:'Plateau', ch:[{ n:'Mix 1', f:470400 }, { n:'Mix 2', f:470400 }, { n:'Mix 3', f:470400 }, { n:'Mix 4', f:470400 }] }),
      dev({ id:'CCCC0002', ser:'AD', mdl:'AD4D-A', band:'G56', zone:'Plateau', ch:[{ n:'Vox 1', f:480000 }, { n:'Vox 2', f:480350 }] })
    ],
    entries:[ entry({ sid:'CCCC0001-0', ser:'ADPSM', band:'G56', zone:'Plateau', f:471375, prof:'p-w', types:IEM }),
              entry({ sid:'CCCC0002-0', ser:'AD', band:'G56', zone:'Plateau', f:480000, prof:'p-a', types:RX }), entry({ sid:'CCCC0002-1', ser:'AD', band:'G56', zone:'Plateau', f:480350, prof:'p-a', types:RX }) ],
    profs:[{ id:'p-w', ser:'ADPSM', band:'G56', sp:800 }, { id:'p-a', ser:'AD', band:'G56', sp:350 }] });
  return { show:show, dev:dev, entry:entry, festival:festival, festival2:festival2, wideband:wideband, RX:RX, IEM:IEM };
})();
