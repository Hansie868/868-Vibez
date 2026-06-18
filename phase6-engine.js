/* ============================================================
   MediaSuite V3 — Phase 6 Super Intelligence Engine
   Local-first, client-side only. No cloud calls.
   ============================================================ */
(function(){
  'use strict';
  const $ = (id)=>document.getElementById(id);
  const q = (sel,root=document)=>root.querySelector(sel);
  const qa = (sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const DB_NAME='MediaSuiteV3';
  const DB_VERSION=6;
  const AUDIO_EXT=/\.(mp3|wav|ogg|m4a|aac|flac|mp4|webm)$/i;
  const state={ db:null, selected:null, library:[], worker:null, activeMedia:null, loops:{A:null,B:null}, phase6Ready:false };

  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function fmt(sec){sec=Number(sec)||0; const m=Math.floor(sec/60), s=Math.floor(sec%60); return `${m}:${String(s).padStart(2,'0')}`;}
  function idb(){
    if(state.db) return Promise.resolve(state.db);
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{ const db=req.result; ['tracks','metadata','waveforms','crates','playlists','settings','cuePoints','sessions','analysis','radioStations','podcasts','healthReports','loops','setHistory'].forEach(s=>{ if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:'id'}); }); };
      req.onsuccess=()=>{state.db=req.result; resolve(state.db)}; req.onerror=()=>reject(req.error);
    });
  }
  async function tx(store,mode='readonly'){ const db=await idb(); return db.transaction(store,mode).objectStore(store); }
  async function getAll(store){ const os=await tx(store); return new Promise((res,rej)=>{const r=os.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);});}
  async function get(store,id){ const os=await tx(store); return new Promise((res,rej)=>{const r=os.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);});}
  async function put(store,val){ const os=await tx(store,'readwrite'); return new Promise((res,rej)=>{const r=os.put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error);});}
  async function del(store,id){ const os=await tx(store,'readwrite'); return new Promise((res,rej)=>{const r=os.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);});}

  function camelotFromIndex(i,minor=true){ const n=((i%12)+12)%12 + 1; return `${n}${minor?'A':'B'}`; }
  function compatibleKeys(key){ const m=String(key||'').toUpperCase().match(/^(\d{1,2})(A|B)$/); if(!m)return[]; const n=+m[1], l=m[2]; return [`${n}${l}`,`${n===1?12:n-1}${l}`,`${n===12?1:n+1}${l}`,`${n}${l==='A'?'B':'A'}`]; }
  function pseudoKeyFromHash(hash){ if(!hash) return ''; const v=parseInt(hash.slice(0,2),16); return camelotFromIndex(v%12, (v%2)===0); }
  function scoreEnergy(rms,transient){ const raw=(rms*16)+(transient*0.02); return Math.max(1,Math.min(10,Math.round(raw))); }

  async function decodeAudio(file){
    const arr=await file.arrayBuffer();
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const buf=await ac.decodeAudioData(arr.slice(0));
    await ac.close();
    return {buffer:buf,arrayBuffer:arr};
  }
  function estimateBPM(buffer){
    const data=buffer.getChannelData(0); const sr=buffer.sampleRate; const step=Math.max(1,Math.floor(sr/100));
    const env=[]; for(let i=0;i<data.length;i+=step){ let sum=0; for(let j=0;j<step && i+j<data.length;j++) sum+=Math.abs(data[i+j]); env.push(sum/step); }
    const mean=env.reduce((a,b)=>a+b,0)/Math.max(1,env.length); const peaks=[];
    for(let i=1;i<env.length-1;i++){ if(env[i]>mean*1.55 && env[i]>env[i-1] && env[i]>env[i+1]) peaks.push(i); }
    if(peaks.length<4) return null;
    const intervals=[]; for(let i=1;i<peaks.length;i++){ const d=(peaks[i]-peaks[i-1])*(step/sr); if(d>.25 && d<1.5) intervals.push(d); }
    if(!intervals.length)return null;
    const bpms=intervals.map(x=>60/x).map(b=>{while(b<80)b*=2; while(b>180)b/=2; return Math.round(b);});
    const counts={}; bpms.forEach(b=>counts[b]=(counts[b]||0)+1); return Number(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]);
  }
  function estimateLoudnessEnergy(buffer){
    const data=buffer.getChannelData(0); const step=Math.max(1,Math.floor(data.length/90000)); let sum=0, crossings=0, prev=0, trans=0;
    for(let i=0;i<data.length;i+=step){ const v=data[i]||0; sum+=v*v; if((v>=0)!=(prev>=0))crossings++; trans+=Math.abs(v-prev); prev=v; }
    const n=Math.ceil(data.length/step); const rms=Math.sqrt(sum/Math.max(1,n)); return { rms:+rms.toFixed(4), zeroCrossings:crossings, transient:+(trans/Math.max(1,n)).toFixed(4), energy:scoreEnergy(rms,trans/Math.max(1,n)) };
  }
  function buildPeaks(buffer,buckets=420){ const data=buffer.getChannelData(0), step=Math.max(1,Math.floor(data.length/buckets)), peaks=[]; for(let i=0;i<buckets;i++){let max=0; for(let j=0;j<step;j++) max=Math.max(max,Math.abs(data[i*step+j]||0)); peaks.push(+max.toFixed(4));} return peaks; }

  async function fileFromTrack(track){
    if(track.fileHandle && track.fileHandle.getFile) return track.fileHandle.getFile();
    if(window.fileFromTrack && typeof window.fileFromTrack==='function') return window.fileFromTrack(track);
    throw new Error('File handle unavailable. Re-open folder first.');
  }
  async function analyzeTrack(track){
    const file=await fileFromTrack(track);
    const {buffer,arrayBuffer}=await decodeAudio(file);
    const a=await get('analysis',track.id) || {id:track.id,trackId:track.id};
    const loud=estimateLoudnessEnergy(buffer); const bpm=estimateBPM(buffer); const peaks=buildPeaks(buffer);
    a.duration=buffer.duration; a.sampleRate=buffer.sampleRate; a.bpm=bpm; a.energy=loud.energy; a.rms=loud.rms; a.zeroCrossings=loud.zeroCrossings; a.transient=loud.transient; a.updatedAt=Date.now();
    await put('analysis',a); await put('waveforms',{id:track.id,trackId:track.id,peaks,duration:buffer.duration,sampleRate:buffer.sampleRate,createdAt:Date.now(),phase6:true});
    const next={...track,duration:buffer.duration,bpm:track.bpm||bpm,energy:track.energy||loud.energy,analyzedAt:Date.now()};
    await put('tracks',next); state.library=await getAll('tracks'); renderPhase6(); return next;
  }
  async function analyzeSelected(){ if(!state.selected) return alert('Select a track first.'); setOutput('Analyzing selected track locally...'); try{ const t=await analyzeTrack(state.selected); setOutput(`Analysis complete:\n${t.title}\nBPM: ${t.bpm||'unknown'}\nEnergy: ${t.energy||'unknown'}\nDuration: ${fmt(t.duration)}`); }catch(e){ setOutput('Analysis failed: '+e.message); } }
  async function analyzeAll(){
    const tracks=await getAll('tracks'); if(!tracks.length) return alert('No tracks indexed yet.');
    if(!confirm(`Analyze ${tracks.length} tracks? Large libraries may take time.`)) return;
    let done=0; for(const t of tracks){ try{ await analyzeTrack(t); }catch(e){} done++; setOutput(`Analyzed ${done}/${tracks.length}`); await new Promise(r=>setTimeout(r,0)); }
    setOutput(`Analysis complete. ${done}/${tracks.length} processed.`); renderPhase6();
  }
  async function autoFillKeys(){ const tracks=await getAll('tracks'); let n=0; for(const t of tracks){ if(!t.key){ let a=await get('analysis',t.id); const hash=a?.hash || t.hash || t.id; t.key=pseudoKeyFromHash(hash); await put('tracks',t); n++; } } state.library=await getAll('tracks'); setOutput(`Auto-filled ${n} Camelot key placeholders. Manual correction is still recommended.`); renderPhase6(); }

  function injectUI(){
    if($('phase6-panel')) return;
    const tabs=q('.tabs'); const main=q('main');
    if(tabs && !$('phase6TabBtn')) tabs.insertAdjacentHTML('beforeend','<button id="phase6TabBtn" data-tab="phase6">Phase 6</button>');
    if(main) main.insertAdjacentHTML('beforeend',`<section id="tab-phase6" class="panel"><div class="panel-head"><div><h1>Phase 6 — Super Intelligence Engine</h1><p>Audio analysis, hot cues, loops, library OS, radio/podcast shell, analytics, and local assistant.</p></div><div class="actions"><button id="p6AnalyzeSelected" class="btn primary">Analyze Selected</button><button id="p6AnalyzeAll" class="btn">Analyze All</button></div></div><div id="phase6-panel" class="phase6-panel"></div></section>`);
    qa('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{ const tab=btn.dataset.tab; qa('[data-tab]').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); qa('.panel').forEach(p=>p.classList.remove('active')); const panel=$('tab-'+tab); if(panel) panel.classList.add('active'); }));
    $('p6AnalyzeSelected')?.addEventListener('click',analyzeSelected); $('p6AnalyzeAll')?.addEventListener('click',analyzeAll);
    const deck=q('#tab-deck .deck-grid') || $('tab-deck'); if(deck && !$('phase6-dj-tools')) deck.insertAdjacentHTML('afterend',`<div id="phase6-dj-tools" class="phase6-panel"><h2>Phase 6 DJ Performance Tools</h2><div class="phase6-grid"><div class="phase6-card"><h3>Hot Cues A</h3><div id="p6CuesA" class="phase6-cuegrid"></div></div><div class="phase6-card"><h3>Hot Cues B</h3><div id="p6CuesB" class="phase6-cuegrid"></div></div><div class="phase6-card"><h3>Loop Engine A</h3><div id="p6LoopsA" class="phase6-cuegrid"></div></div><div class="phase6-card"><h3>Loop Engine B</h3><div id="p6LoopsB" class="phase6-cuegrid"></div></div></div></div>`);
  }
  function setOutput(msg){ const out=$('p6CommandOutput'); if(out) out.textContent=msg; }
  function row(label,value){return `<div class="phase6-kv"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
  function renderPhase6(){
    const box=$('phase6-panel'); if(!box) return;
    const tracks=state.library||[]; const missing=tracks.filter(t=>!t.bpm||!t.key||!t.energy).length; const dups=duplicateTitles(tracks).length; const analyzed=tracks.filter(t=>t.analyzedAt).length;
    const avgBpm=Math.round(tracks.filter(t=>t.bpm).reduce((a,t)=>a+Number(t.bpm),0)/Math.max(1,tracks.filter(t=>t.bpm).length))||'—';
    box.innerHTML=`
      <div class="phase6-grid">
        <div class="phase6-card"><h3>Audio Intelligence</h3>${row('Analyzed',`${analyzed}/${tracks.length}`)}${row('Average BPM',avgBpm)}${row('Missing Core Metadata',missing)}<div class="phase6-actions"><button class="phase6-btn" id="p6AutoKeys">Auto-fill Key Placeholders</button></div></div>
        <div class="phase6-card"><h3>Library OS Health</h3>${row('Duplicate Titles',dups)}${row('Missing Artwork',tracks.filter(t=>!t.artwork).length)}${row('Favorites',tracks.filter(t=>t.favorite).length)}<div class="phase6-actions"><button class="phase6-btn" id="p6Health">Run Health Report</button></div></div>
        <div class="phase6-card"><h3>Recommendation Engine</h3><div id="p6Recs" class="phase6-list">${renderRecs()}</div></div>
        <div class="phase6-card"><h3>Local Assistant</h3><div class="phase6-assistant"><input id="p6Command" class="phase6-input" placeholder="e.g. show 120 bpm soca tracks"><button id="p6RunCommand" class="phase6-btn">Run</button></div><div id="p6CommandOutput" class="phase6-command-output">Ask for BPM, key, genre, favorites, duplicates, missing metadata, or recommendations.</div></div>
      </div>
      <div class="phase6-radio-grid">
        <div class="phase6-card"><h3>Radio Engine</h3><input id="p6StationName" class="phase6-input" placeholder="Station name"><br><br><input id="p6StationUrl" class="phase6-input" placeholder="Direct stream URL"><div class="phase6-actions"><button id="p6SaveStation" class="phase6-btn">Save Station</button></div><div id="p6Stations" class="phase6-list"></div></div>
        <div class="phase6-card"><h3>Podcast Engine</h3><input id="p6PodcastName" class="phase6-input" placeholder="Podcast name"><br><br><input id="p6PodcastUrl" class="phase6-input" placeholder="RSS/feed/audio URL"><div class="phase6-actions"><button id="p6SavePodcast" class="phase6-btn">Save Podcast</button></div><div id="p6Podcasts" class="phase6-list"></div></div>
      </div>`;
    bindPhase6Panel(); renderRadioPodcast(); renderDjTools();
  }
  function bindPhase6Panel(){
    $('p6AutoKeys')?.addEventListener('click',autoFillKeys); $('p6Health')?.addEventListener('click',runHealthReport); $('p6RunCommand')?.addEventListener('click',runAssistant); $('p6Command')?.addEventListener('keydown',e=>{if(e.key==='Enter')runAssistant()});
    $('p6SaveStation')?.addEventListener('click',saveStation); $('p6SavePodcast')?.addEventListener('click',savePodcast);
  }
  function duplicateTitles(tracks){ const m={}; tracks.forEach(t=>{const k=String(t.title||t.name||'').toLowerCase(); if(k)m[k]=(m[k]||0)+1}); return Object.entries(m).filter(([k,v])=>v>1); }
  async function runHealthReport(){ const tracks=await getAll('tracks'); const report={id:'health_'+Date.now(),createdAt:Date.now(),total:tracks.length,missingMetadata:tracks.filter(t=>!t.bpm||!t.key||!t.energy).length,missingArtwork:tracks.filter(t=>!t.artwork).length,duplicateTitles:duplicateTitles(tracks).map(x=>x[0])}; await put('healthReports',report); setOutput(`Health Report\nTracks: ${report.total}\nMissing metadata: ${report.missingMetadata}\nMissing artwork: ${report.missingArtwork}\nDuplicate titles: ${report.duplicateTitles.length}`); }
  function renderRecs(){ if(!state.selected) return '<small>Select a track to generate recommendations.</small>'; const recs=state.library.filter(t=>t.id!==state.selected.id).map(t=>({t,score:score(state.selected,t)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5); return recs.length?recs.map(x=>`<div class="phase6-row"><div><strong>${esc(x.t.title||x.t.name)}</strong><small>${esc(x.t.bpm||'—')} BPM · ${esc(x.t.key||'—')} · energy ${esc(x.t.energy||'—')}</small></div><div class="phase6-badge">${x.score}</div></div>`).join(''):'<small>No recommendations until BPM/key/energy metadata exists.</small>'; }
  function score(a,b){let s=0;if(a.key&&b.key){if(String(a.key).toUpperCase()===String(b.key).toUpperCase())s+=50;else if(compatibleKeys(a.key).includes(String(b.key).toUpperCase()))s+=35}if(a.bpm&&b.bpm){const d=Math.abs(a.bpm-b.bpm); if(d<=2)s+=25;else if(d<=5)s+=15;else if(d<=10)s+=5}if(a.energy&&b.energy){const d=Math.abs(a.energy-b.energy); if(d<=1)s+=12;else if(d<=2)s+=6}if(a.genre&&b.genre&&String(a.genre).toLowerCase()===String(b.genre).toLowerCase())s+=10;return s;}
  function runAssistant(){ const cmd=($('p6Command')?.value||'').toLowerCase().trim(); if(!cmd) return; let arr=state.library.slice(); let msg=''; const bpm=cmd.match(/(\d{2,3})\s*bpm|bpm\s*(\d{2,3})/); if(bpm){const v=+(bpm[1]||bpm[2]); arr=arr.filter(t=>Math.abs((t.bpm||0)-v)<=3); msg+=`BPM near ${v}: ${arr.length} tracks\n`; } const key=cmd.match(/\b(\d{1,2}[ab])\b/i); if(key){arr=arr.filter(t=>String(t.key||'').toLowerCase()===key[1].toLowerCase()); msg+=`Key ${key[1].toUpperCase()}: ${arr.length} tracks\n`; } if(cmd.includes('favorite')){arr=arr.filter(t=>t.favorite);msg+=`Favorites: ${arr.length}\n`;} if(cmd.includes('missing')){arr=arr.filter(t=>!t.bpm||!t.key||!t.energy);msg+=`Missing metadata: ${arr.length}\n`;} if(cmd.includes('duplicate')){const d=duplicateTitles(state.library);msg+=`Duplicate titles: ${d.length}\n${d.slice(0,10).map(x=>'- '+x[0]).join('\n')}`; setOutput(msg); return;} if(cmd.includes('recommend')){msg='Recommendations:\n'+renderRecs().replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); setOutput(msg); return;} if(!msg){ arr=arr.filter(t=>[t.title,t.artist,t.album,t.genre,t.key,String(t.bpm||'')].join(' ').toLowerCase().includes(cmd)); msg=`Search results: ${arr.length}\n`; } msg += arr.slice(0,12).map(t=>`- ${t.title||t.name} · ${t.bpm||'—'} BPM · ${t.key||'—'}`).join('\n'); setOutput(msg); }
  async function saveStation(){ const name=$('p6StationName')?.value.trim(), url=$('p6StationUrl')?.value.trim(); if(!name||!url)return alert('Enter station name and URL.'); await put('radioStations',{id:'station_'+Date.now(),name,url,createdAt:Date.now()}); renderRadioPodcast(); }
  async function savePodcast(){ const name=$('p6PodcastName')?.value.trim(), url=$('p6PodcastUrl')?.value.trim(); if(!name||!url)return alert('Enter podcast name and URL.'); await put('podcasts',{id:'podcast_'+Date.now(),name,url,createdAt:Date.now()}); renderRadioPodcast(); }
  async function renderRadioPodcast(){ const s=await getAll('radioStations'), p=await getAll('podcasts'); if($('p6Stations')) $('p6Stations').innerHTML=s.length?s.map(x=>`<div class="phase6-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.url)}</small></div><button class="phase6-btn" data-play-url="${esc(x.url)}">Play</button></div>`).join(''):'<small>No stations saved.</small>'; if($('p6Podcasts')) $('p6Podcasts').innerHTML=p.length?p.map(x=>`<div class="phase6-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.url)}</small></div><button class="phase6-btn" data-play-url="${esc(x.url)}">Play</button></div>`).join(''):'<small>No podcasts saved.</small>'; qa('[data-play-url]').forEach(b=>b.onclick=()=>playUrl(b.dataset.playUrl)); }
  function playUrl(url){ const a=$('mainAudio')||document.createElement('audio'); a.src=url; a.controls=true; a.play().catch(()=>alert('Could not play this URL. It must allow browser playback/CORS.')); if($('npTitle')) $('npTitle').textContent='External Stream'; if($('npSub')) $('npSub').textContent=url; }
  function getDeckAudio(deck){ return $('audio'+deck) || $(deck==='A'?'audioA':'audioB'); }
  async function setHotCue(deck,slot){ const a=getDeckAudio(deck); const current=getDeckTrack(deck); if(!a||!current)return alert('Load a track on Deck '+deck+' first.'); const cue={id:`${current.id}_${deck}_${slot}`,trackId:current.id,deck,slot,time:a.currentTime,label:`${slot}: ${fmt(a.currentTime)}`,updatedAt:Date.now()}; await put('cuePoints',cue); renderDjTools(); }
  async function jumpHotCue(deck,slot){ const a=getDeckAudio(deck); const current=getDeckTrack(deck); if(!a||!current)return; const cue=await get('cuePoints',`${current.id}_${deck}_${slot}`); if(cue) a.currentTime=cue.time; else setHotCue(deck,slot); }
  function getDeckTrack(deck){ const title=$(deck==='A'?'deckATitle':'deckBTitle')?.textContent; if(!title) return state.selected; return state.library.find(t=>String(title).includes(t.title)) || state.selected; }
  function setLoop(deck,beats){ const a=getDeckAudio(deck); const t=getDeckTrack(deck); if(!a||!t)return alert('Load a track first.'); const bpm=Number(t.bpm)||120; const len=(60/bpm)*beats; state.loops[deck]={start:a.currentTime,end:a.currentTime+len,beats}; put('loops',{id:`${t.id}_${deck}`,trackId:t.id,deck,start:a.currentTime,end:a.currentTime+len,beats,updatedAt:Date.now()}); renderDjTools(); }
  function clearLoop(deck){ state.loops[deck]=null; renderDjTools(); }
  function tickLoops(){ ['A','B'].forEach(deck=>{ const a=getDeckAudio(deck), l=state.loops[deck]; if(a&&l&&a.currentTime>=l.end) a.currentTime=l.start; }); requestAnimationFrame(tickLoops); }
  function renderDjTools(){ ['A','B'].forEach(deck=>{ const cueBox=$('p6Cues'+deck); if(cueBox) cueBox.innerHTML=[1,2,3,4,5,6,7,8].map(n=>`<button class="phase6-cue" data-cue-deck="${deck}" data-cue-slot="${n}">Cue ${n}</button>`).join(''); const loopBox=$('p6Loops'+deck); if(loopBox) loopBox.innerHTML=[1,2,4,8,16,32].map(n=>`<button class="phase6-loop ${state.loops[deck]?.beats===n?'active':''}" data-loop-deck="${deck}" data-loop-beats="${n}">${n} beat</button>`).join('')+`<button class="phase6-loop" data-loop-clear="${deck}">Clear</button>`; }); qa('[data-cue-deck]').forEach(b=>b.onclick=(e)=>{ if(e.shiftKey) setHotCue(b.dataset.cueDeck,b.dataset.cueSlot); else jumpHotCue(b.dataset.cueDeck,b.dataset.cueSlot); }); qa('[data-loop-deck]').forEach(b=>b.onclick=()=>setLoop(b.dataset.loopDeck,+b.dataset.loopBeats)); qa('[data-loop-clear]').forEach(b=>b.onclick=()=>clearLoop(b.dataset.loopClear)); }

  async function refreshLibrary(){ state.library=await getAll('tracks'); if(window.library && Array.isArray(window.library) && window.library.length>state.library.length) state.library=window.library; const selectedId=q('.track.active')?.dataset?.id; state.selected=selectedId?state.library.find(t=>t.id===selectedId):state.selected; renderPhase6(); }
  function hookSelection(){ document.addEventListener('click',async(e)=>{ const tr=e.target.closest?.('[data-id]'); if(tr){ await refreshLibrary(); state.selected=state.library.find(t=>t.id===tr.dataset.id)||state.selected; renderPhase6(); } }); }
  async function boot(){ await idb(); injectUI(); hookSelection(); await refreshLibrary(); tickLoops(); setInterval(refreshLibrary,3500); state.phase6Ready=true; console.log('MediaSuite Phase 6 engine loaded'); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
