/**
 * 868 VIBEZ V2.0 — CORE ENGINE (Phase 1 Update)
 * All 11 fixes applied.
 */
"use strict";

const DB_NAME    = "868VibezV2";
const DB_VERSION = 5;

const STORES = [
  { name:"tracks",    cfg:{ keyPath:"id" } },
  { name:"folders",   cfg:{ keyPath:"id" } },
  { name:"metadata",  cfg:{ keyPath:"trackId" } },
  { name:"queue",     cfg:{ keyPath:"id", autoIncrement:true } },
  { name:"playlists", cfg:{ keyPath:"id", autoIncrement:true } },
  { name:"crates",    cfg:{ keyPath:"id", autoIncrement:true } },
  { name:"recent",    cfg:{ keyPath:"id", autoIncrement:true } },
  { name:"settings",  cfg:{ keyPath:"key" } },
  { name:"waveforms", cfg:{ keyPath:"trackId" } },
  { name:"analysis",  cfg:{ keyPath:"trackId" } },
  { name:"stats",     cfg:{ keyPath:"trackId" } }
];

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(({ name, cfg }) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, cfg);
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function getStore(name, mode = "readonly") {
  return V.db.transaction(name, mode).objectStore(name);
}

const db = {
  put:  (s,v)   => new Promise((res,rej) => { const r=getStore(s,"readwrite").put(v);   r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }),
  get:  (s,k)   => new Promise((res,rej) => { const r=getStore(s).get(k);               r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }),
  all:  (s)     => new Promise((res,rej) => { const r=getStore(s).getAll();              r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }),
  del:  (s,k)   => new Promise((res,rej) => { const r=getStore(s,"readwrite").delete(k); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); })
};

const V = window.Vibez = {
  db:null, library:[], folders:{}, queue:[], favorites:new Set(),
  playlists:[], crates:[],
  currentTrack:null, currentFolder:null, currentFolderTracks:[], currentFolderIndex:-1,
  currentUrl:null, radioPlayer:new Audio(), activeRadioId:null,
  currentLibTab:"folders", currentLibFolder:null,
  currentPlaylist:null, currentCrate:null,
  playContext:"folder",
  actionTrackId:null, actionType:null
};

const $     = id => document.getElementById(id);
const esc   = s  => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmt   = s  => { if(!Number.isFinite(s)||s<0)return"0:00"; return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; };
const makeId  = f => `tr_${f.name}_${f.size}_${f.lastModified}`.replace(/[^a-z0-9_.-]/gi,"_");
const makeFId = p => p.replace(/[^a-z0-9_/.-]/gi,"_")||"imported";
const alphaSort = arr => [...arr].sort((a,b)=>(a.name||"").localeCompare(b.name||"",undefined,{numeric:true,sensitivity:"base"}));

// TOAST
let toastTimer=null;
function showToast(msg,duration=3000){
  const el=$("toast");
  el.textContent=msg;
  el.classList.add("show");
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove("show"),duration);
}

// SPLASH
function dismissSplash(){
  $("splash").classList.add("fade-out");
  $("app").classList.remove("hidden");
  setTimeout(()=>{ $("splash").style.display="none"; },650);
}

// IMPORT — Fix #2 #8 #11
async function importFiles(fileList){
  const files=[...fileList].filter(f=>f.type.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name));
  if(!files.length){showToast("No audio files found");return;}
  showToast(`Importing ${files.length} track${files.length>1?"s":""}…`);

  const folderMap={};
  for(const f of files){
    const rawPath=f.webkitRelativePath||"";
    const folderPath=rawPath.includes("/")?rawPath.substring(0,rawPath.lastIndexOf("/")):"Imported";
    const folderId=makeFId(folderPath);
    const folderName=folderPath.split("/").pop()||"Imported";
    if(!folderMap[folderId])folderMap[folderId]={id:folderId,name:folderName,path:folderPath,tracks:[]};
    const trackId=makeId(f);
    const title=f.name.replace(/\.[^.]+$/,"");
    await db.put("tracks",{id:trackId,name:f.name,type:f.type||"audio/mpeg",size:f.size,folderId,addedAt:Date.now(),blob:f});
    const ex=await db.get("metadata",trackId).catch(()=>null);
    if(!ex)await db.put("metadata",{trackId,title,artist:"",album:"",genre:"",year:""});
    await db.put("recent",{trackId,type:"added",timestamp:Date.now()});
    folderMap[folderId].tracks.push(trackId);
  }

  for(const[folderId,folder]of Object.entries(folderMap)){
    const ex=await db.get("folders",folderId).catch(()=>null);
    if(ex){
      const merged=[...new Set([...ex.tracks,...folder.tracks])];
      await db.put("folders",{...ex,tracks:merged});
    }else{
      await db.put("folders",folder);
    }
  }

  await syncState();
  const names=Object.values(folderMap).map(f=>f.name).join(", ");
  showToast(`Imported: ${names}`,4000);

  // Auto-play first track of first folder
  const firstFolder=Object.values(folderMap)[0];
  if(firstFolder?.tracks?.length){
    const firstTrack=V.library.find(x=>x.id===firstFolder.tracks[0]);
    if(firstTrack)loadTrack(firstTrack,true);
  }
}

// STATE SYNC
async function syncState(){
  V.library=await db.all("tracks");
  const fl=await db.all("folders");
  V.folders={};
  fl.forEach(f=>{V.folders[f.id]=f;});
  const qi=await db.all("queue");
  V.queue=qi.sort((a,b)=>(a.position||0)-(b.position||0));
  const fav=await db.get("settings","favorites").catch(()=>null);
  V.favorites=new Set(fav?.value||[]);
  V.playlists=await db.all("playlists");
  V.crates=await db.all("crates");
  renderLibrary();
  renderQueue();
  const last=await db.get("settings","last_session").catch(()=>null);
  if(last?.value?.trackId&&!V.currentTrack){
    const t=V.library.find(x=>x.id===last.value.trackId);
    if(t)loadTrack(t,false,last.value.time||0,null);
  }
}

// LOAD TRACK — Fix #3 #10 + playlist/crate context
async function loadTrack(trackRecord,shouldPlay=true,resumeAt=0,context=null){
  const audio=$("audio");
  if(V.activeRadioId)stopRadio();
  if(V.currentUrl){URL.revokeObjectURL(V.currentUrl);V.currentUrl=null;}
  const stored=await db.get("tracks",trackRecord.id);
  if(!stored?.blob)return;
  const meta=await db.get("metadata",trackRecord.id).catch(()=>({}));
  V.currentTrack={...stored,...meta};

  // Determine navigation context
  if(context==="playlist"&&V.currentPlaylist){
    V.playContext="playlist";
    const tracks=V.currentPlaylist.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
    const sorted=alphaSort(tracks);
    V.currentFolderTracks=sorted.map(t=>t.id);
    V.currentFolderIndex=V.currentFolderTracks.indexOf(stored.id);
  } else if(context==="crate"&&V.currentCrate){
    V.playContext="crate";
    const tracks=V.currentCrate.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
    const sorted=alphaSort(tracks);
    V.currentFolderTracks=sorted.map(t=>t.id);
    V.currentFolderIndex=V.currentFolderTracks.indexOf(stored.id);
  } else {
    V.playContext="folder";
    V.currentFolder=stored.folderId||null;
    if(V.currentFolder&&V.folders[V.currentFolder]){
      const ft=V.folders[V.currentFolder].tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
      const sorted=alphaSort(ft);
      V.currentFolderTracks=sorted.map(t=>t.id);
      V.currentFolderIndex=V.currentFolderTracks.indexOf(stored.id);
    }else{
      V.currentFolderTracks=[stored.id];
      V.currentFolderIndex=0;
    }
  }

  V.currentUrl=URL.createObjectURL(stored.blob);
  audio.src=V.currentUrl;
  audio.currentTime=resumeAt;
  updatePlayerUI();
  showPage("player");
  if(shouldPlay)audio.play().catch(()=>{});
  await db.put("settings",{key:"last_session",value:{trackId:stored.id,time:resumeAt}});
  setupMediaSession();
}

// FIX #1: Hide unknown artist
function updatePlayerUI(){
  const audio=$("audio");
  const t=V.currentTrack;
  const playing=t&&!audio.paused;
  $("songTitle").textContent=t?(t.title||t.name.replace(/\.[^.]+$/,"")):"No track loaded";
  const artistEl=$("artistName");
  const artist=(t?.artist||"").trim();
  if(artist&&artist.toLowerCase()!=="unknown artist"){
    artistEl.textContent=artist;
    artistEl.classList.remove("hidden");
  }else{
    artistEl.textContent="";
    artistEl.classList.add("hidden");
  }
  $("vinyl").classList.toggle("playing",playing);
  $("iconPlay").classList.toggle("hidden",playing);
  $("iconPause").classList.toggle("hidden",!playing);
  const isFav=t&&V.favorites.has(t.id);
  $("favBtn").classList.toggle("active",isFav);
  $("heartIcon").style.color=isFav?"var(--red)":"";
}

function setupMediaSession(){
  if(!("mediaSession"in navigator)||!V.currentTrack)return;
  navigator.mediaSession.metadata=new MediaMetadata({
    title:V.currentTrack.title||V.currentTrack.name.replace(/\.[^.]+$/,""),
    artist:V.currentTrack.artist||"868 Vibez",album:"868 Vibez"
  });
  try{navigator.mediaSession.setActionHandler("play",()=>$("audio").play());}catch{}
  try{navigator.mediaSession.setActionHandler("pause",()=>$("audio").pause());}catch{}
  try{navigator.mediaSession.setActionHandler("previoustrack",()=>prevTrack());}catch{}
  try{navigator.mediaSession.setActionHandler("nexttrack",()=>nextTrack());}catch{}
}

// FOLDER/PLAYLIST/CRATE NAVIGATION
function nextTrack(){
  if(V.queue.length>0){playNextFromQueue();return;}
  if(!V.currentFolderTracks.length)return;
  const next=(V.currentFolderIndex+1)%V.currentFolderTracks.length;
  const track=V.library.find(x=>x.id===V.currentFolderTracks[next]);
  if(track)loadTrack(track,true,0,V.playContext==="playlist"?"playlist":V.playContext==="crate"?"crate":null);
}
function prevTrack(){
  if(!V.currentFolderTracks.length)return;
  const len=V.currentFolderTracks.length;
  const prev=(V.currentFolderIndex-1+len)%len;
  const track=V.library.find(x=>x.id===V.currentFolderTracks[prev]);
  if(track)loadTrack(track,true,0,V.playContext==="playlist"?"playlist":V.playContext==="crate"?"crate":null);
}

// QUEUE
async function addToQueue(trackId){
  await db.put("queue",{trackId,position:Date.now()});
  await syncState();
  showToast("Added to queue");
}
async function removeFromQueue(itemId){
  await db.del("queue",itemId);
  await syncState();
}
async function playNextFromQueue(){
  if(!V.queue.length){nextTrack();return;}
  const item=V.queue.shift();
  await db.del("queue",item.id);
  const track=V.library.find(x=>x.id===item.trackId);
  renderQueue();
  if(track)loadTrack(track,true);
}
function renderQueue(){
  const el=$("queueList");if(!el)return;
  if(!V.queue.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">🎵</div><p class="list-empty-title">Queue is empty</p><p class="list-empty-sub">Add songs from the Library to queue them up</p></div>`;return;}
  el.innerHTML=V.queue.map((item,idx)=>{
    const t=V.library.find(x=>x.id===item.trackId);
    const name=t?esc(t.name.replace(/\.[^.]+$/,"")):"Unknown Track";
    return`<div class="list-item"><div class="list-item-art"><span class="list-item-note">${idx+1}</span></div><div class="list-item-info"><div class="list-item-title">${name}</div></div><div class="list-item-actions"><button class="list-action-btn" onclick="window.Vibez.removeFromQueue(${item.id})">✕</button></div></div>`;
  }).join("");
}

// RADIO — Fix #5 #6 #7 #4
const STATIONS=[
  {id:"wack901",    name:"Wack Radio",             freq:"90.1 FM", freqN:90.1,  cat:"music",stream:"https://stream.zeno.fm/wack-radio-90-1fm",        phone:"+18686529774",whatsapp:"18686524901"},
  {id:"mix901",     name:"MIX 90.1 FM",            freq:"90.1 FM", freqN:90.15, cat:"music",stream:"https://stream.zeno.fm/4v8g48v2w0vuv",            phone:"+18686249510",whatsapp:"18686249510"},
  {id:"radio905",   name:"Radio 90.5",              freq:"90.5 FM", freqN:90.5,  cat:"music",stream:"https://stream.zeno.fm/radio-90-5-fm",            phone:"+18686458083",whatsapp:"18686458083"},
  {id:"talkcity911",name:"Talk City 91.1 FM",       freq:"91.1 FM", freqN:91.1,  cat:"talk", stream:"https://stream.zeno.fm/1u6g2m13x0vuv",            phone:"+18686224911",whatsapp:"18683944911"},
  {id:"street919",  name:"The Street 91.9 FM",      freq:"91.9 FM", freqN:91.9,  cat:"music",stream:"https://stream.zeno.fm/the-street-91-9-fm",       phone:"+18686281158",whatsapp:"18686229154"},
  {id:"tambrin927", name:"Radio Tambrin 92.7",      freq:"92.7 FM", freqN:92.7,  cat:"music",stream:"https://stream.zeno.fm/tambrin927",               phone:"+18686393437",whatsapp:"18686392927"},
  {id:"hott93",     name:"Hott 93",                 freq:"93.5 FM", freqN:93.5,  cat:"music",stream:"https://stream.zeno.fm/hott-93",                  phone:"+18686258426",whatsapp:"18686234688"},
  {id:"boom941",    name:"Boom Champions 94.1",     freq:"94.1 FM", freqN:94.1,  cat:"music",stream:"http://198.105.220.10:8232/;stream.mp3",          phone:"+18686276937",whatsapp:"18683229494"},
  {id:"star947",    name:"Star 947",                freq:"94.7 FM", freqN:94.7,  cat:"music",stream:"https://stream.zeno.fm/star-947",                 phone:"+18686282947",whatsapp:"18686286044"},
  {id:"951ultimate",name:"95.1 The Ultimate One",   freq:"95.1 FM", freqN:95.1,  cat:"music",stream:"https://stream.zeno.fm/95-the-ultimate-one",      phone:"+18686252095",whatsapp:"18683949595"},
  {id:"i955",       name:"i95.5 FM",                freq:"95.5 FM", freqN:95.5,  cat:"talk", stream:"http://icecast.ctntworld.com:8000/i955fm",         phone:"+18686283937",whatsapp:"18686284955"},
  {id:"961wefm",    name:"96.1 WEFM",               freq:"96.1 FM", freqN:96.1,  cat:"music",stream:"https://stream.zeno.fm/96-1wefm",                 phone:"+18686289336",whatsapp:"18686286044"},
  {id:"music97",    name:"Music Radio 97",          freq:"97.1 FM", freqN:97.1,  cat:"music",stream:"https://stream.zeno.fm/music-radio-97-1-fm",      phone:"+18686229797",whatsapp:"18686229797"},
  {id:"isaac981",   name:"ISAAC 98.1 FM",           freq:"98.1 FM", freqN:98.1,  cat:"music",stream:"http://stream.family981.com:8000/stream",         phone:"+18686289681",whatsapp:"18686288351"},
  {id:"next991",    name:"Next 99.1 FM",            freq:"99.1 FM", freqN:99.1,  cat:"music",stream:"https://stream.zeno.fm/3v8g48v2w0vuv",           phone:"+18686283006",whatsapp:"18683104991"},
  {id:"sky995",     name:"SKY 99.5 FM",             freq:"99.5 FM", freqN:99.5,  cat:"music",stream:"https://stream.zeno.fm/sky-99-5-fm",              phone:"+18686239202",whatsapp:"18686247729"},
  {id:"sweet100",   name:"Sweet FM",                freq:"100.1 FM",freqN:100.1, cat:"music",stream:"https://stream.zeno.fm/5v8g48v2w0vuv",           phone:"+18686224141",whatsapp:"18686224141"},
  {id:"slam1005",   name:"Slam 100.5",              freq:"100.5 FM",freqN:100.5, cat:"music",stream:"https://stream.zeno.fm/93m3g3v5w0vuv",           phone:"+18686241005",whatsapp:"18687077526"},
  {id:"power102",   name:"Power 102 FM",            freq:"102.0 FM",freqN:102.0, cat:"music",stream:"http://icecast.ctntworld.com:8000/power102fm",    phone:"+18686276937",whatsapp:"18686276937"},
  {id:"jaagriti",   name:"Radio Jaagriti 102.7",   freq:"102.7 FM",freqN:102.7, cat:"music",stream:"https://stream.zeno.fm/09v06ehw00vuv",           phone:"+18686638743",whatsapp:"18686638743"},
  {id:"103fm",      name:"103 FM",                  freq:"103.0 FM",freqN:103.0, cat:"music",stream:"https://stream.zeno.fm/103-fmnu1uudd8mg0uv",      phone:"+18686289222",whatsapp:"18682994103"},
  {id:"heartbeat",  name:"Heartbeat 103.5",         freq:"103.5 FM",freqN:103.5, cat:"music",stream:"https://stream.zeno.fm/1t8g08v2w0vuv",           phone:"+18682223104",whatsapp:"18682234103"},
  {id:"iconic1047", name:"Iconic 104.7 FM",         freq:"104.7 FM",freqN:104.7, cat:"music",stream:"https://stream.zeno.fm/ba27v6eh00vuv",           phone:"+18686289595",whatsapp:"18686281047"},
  {id:"vibect105",  name:"Vibe CT 105.1",           freq:"105.1 FM",freqN:105.1, cat:"music",stream:"https://stream.zeno.fm/7g6t40m000vuv",           phone:"+18686235105",whatsapp:"18683881051"},
  {id:"sangeet1061",name:"Sangeet 106.1 FM",        freq:"106.1 FM",freqN:106.1, cat:"music",stream:"https://stream.zeno.fm/sangeet-106-1-fm",         phone:"+18686258426",whatsapp:"18686258426"},
  {id:"freedom1065",name:"Freedom 106.5 FM",        freq:"106.5 FM",freqN:106.5, cat:"music",stream:"https://stream.zeno.fm/0t8g08v2w0vuv",           phone:"+18683290393",whatsapp:"18683290393"},
  {id:"w1071",      name:"W107.1",                  freq:"107.1 FM",freqN:107.1, cat:"music",stream:"https://stream.zeno.fm/w107-1-the-word",          phone:"+18686284107",whatsapp:"18686229797"},
  {id:"1077mfl",    name:"107.7 FM Music For Life", freq:"107.7 FM",freqN:107.7, cat:"music",stream:"https://stream.zeno.fm/107-7-fm-music-for-life",  phone:"+18686286044",whatsapp:"18686286044"},
  {id:"bacchanal",  name:"Bacchanal Radio",         freq:"Online",  freqN:200,   cat:"music",stream:"https://stream.zeno.fm/u8zszw7szwzuv",           phone:"+18686822224",whatsapp:"18686822224"},
];
STATIONS.sort((a,b)=>a.freqN-b.freqN);

function renderRadio(){
  const el=$("radioList");if(!el)return;
  const renderItem=s=>{
    const active=V.activeRadioId===s.id;
    const phoneBtn=s.phone?`<a href="tel:${s.phone}" class="radio-link-btn">📞 Call</a>`:"";
    const waBtn=s.whatsapp?`<a href="https://wa.me/${s.whatsapp}" target="_blank" rel="noopener" class="radio-link-btn">💬 WhatsApp</a>`:"";
    return`<div class="radio-item">
      <div class="radio-logo"><img src="cover.png" alt="${esc(s.name)}"></div>
      <div class="radio-info">
        ${active?`<div class="radio-live-badge">● LIVE</div>`:""}
        <div class="radio-name">${esc(s.name)}</div>
        <div class="radio-freq">${esc(s.freq)}</div>
        ${(phoneBtn||waBtn)?`<div class="radio-links">${phoneBtn}${waBtn}</div>`:""}
      </div>
      <button class="radio-play-btn${active?" active":""}" onclick="window.Vibez.toggleRadio('${s.id}')">
        ${active?"■":"▶"}
      </button>
    </div>`;
  };
  const music=STATIONS.filter(s=>s.cat==="music");
  const talk=STATIONS.filter(s=>s.cat==="talk");
  el.innerHTML=`<div class="radio-category">Music Stations</div>${music.map(renderItem).join("")}<div class="radio-category">Talk &amp; News</div>${talk.map(renderItem).join("")}`;
}

function toggleRadio(stationId){
  const s=STATIONS.find(x=>x.id===stationId);if(!s)return;
  if(V.activeRadioId===stationId){stopRadio();return;}
  if(!s.stream){showToast(`${s.name} — stream coming soon`);return;}
  $("audio").pause();
  V.activeRadioId=stationId;
  V.radioPlayer.src=s.stream;
  V.radioPlayer.play()
    .then(()=>{showToast(`Now streaming: ${s.name}`);renderRadio();})
    .catch(()=>{showToast(`Could not connect to ${s.name}`);stopRadio();});
  renderRadio();
}
function stopRadio(){
  V.radioPlayer.pause();V.radioPlayer.src="";V.activeRadioId=null;renderRadio();
}

// PAGE NAV
function showPage(name){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${name}`));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  localStorage.setItem("vz_page",name);
}

// LIBRARY RENDERERS — Fix #9
async function renderLibrary(){
  switch(V.currentLibTab){
    case"folders":   renderFolderView();break;
    case"songs":     renderSongsList();break;
    case"playlists": renderPlaylistsTab();break;
    case"crates":    renderCratesTab();break;
    case"favorites": renderFavorites();break;
    case"recent":    renderRecent();break;
  }
}

function renderFolderView(){
  const el=$("libraryList");if(!el)return;
  if(V.currentLibFolder&&V.folders[V.currentLibFolder]){renderFolderContents(V.currentLibFolder);return;}
  const folderList=Object.values(V.folders);
  if(!folderList.length){
    el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">📁</div><p class="list-empty-title">No folders yet</p><p class="list-empty-sub">Tap Import to add music folders from your device</p></div>`;
    return;
  }
  const sorted=[...folderList].sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=`<div class="folder-grid">${sorted.map(f=>`
    <div class="folder-item" onclick="window.Vibez.openFolder('${f.id}')">
      <div class="folder-icon">📁</div>
      <div class="folder-info">
        <div class="folder-name">${esc(f.name)}</div>
        <div class="folder-count">${f.tracks.length} track${f.tracks.length!==1?"s":""}</div>
      </div>
      <div class="folder-arrow">›</div>
    </div>`).join("")}</div>`;
}

function renderFolderContents(folderId){
  const el=$("libraryList");
  const folder=V.folders[folderId];
  if(!el||!folder)return;
  const tracks=folder.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
  const sorted=alphaSort(tracks);
  const search=($("searchInput")?.value||"").toLowerCase().trim();
  const filtered=search?sorted.filter(t=>t.name.toLowerCase().includes(search)):sorted;
  el.innerHTML=`<div class="folder-back" onclick="window.Vibez.closeFolder()">‹ Back to Folders</div>`+
    (filtered.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">🔍</div><p class="list-empty-title">No results</p></div>`
      :filtered.map(t=>{
        const title=esc(t.name.replace(/\.[^.]+$/,""));
        const current=V.currentTrack?.id===t.id;
        return`<div class="list-item${current?" playing":""}">
          <div class="list-item-art">${current?`<div class="playing-bar"><span></span><span></span><span></span></div>`:`<span class="list-item-note">🎵</span>`}</div>
          <div class="list-item-info"><div class="list-item-title">${title}</div></div>
          <div class="list-item-actions">
            <button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button>
            <button class="list-action-btn" onclick="window.Vibez.addToQueue('${t.id}')">+Q</button>
            <button class="list-action-btn" onclick="window.Vibez.showActionSheet('${t.id}','playlist')" title="Add to Playlist">🎶</button>
            <button class="list-action-btn" onclick="window.Vibez.showActionSheet('${t.id}','crate')" title="Add to Crate">📦</button>
          </div>
        </div>`;
      }).join(""));
}

async function renderSongsList(){
  const el=$("libraryList");
  const search=($("searchInput")?.value||"").toLowerCase().trim();
  const metaAll=await db.all("metadata");
  const sorted=alphaSort(V.library);
  const filtered=sorted.filter(t=>{
    const m=metaAll.find(x=>x.trackId===t.id)||{};
    return!search||t.name.toLowerCase().includes(search)||(m.artist||"").toLowerCase().includes(search);
  });
  if(!filtered.length){
    el.innerHTML=V.library.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">📁</div><p class="list-empty-title">No music yet</p><p class="list-empty-sub">Tap Import to add your music</p></div>`
      :`<div class="list-empty"><div class="list-empty-icon">🔍</div><p class="list-empty-title">No results</p></div>`;
    return;
  }
  el.innerHTML=filtered.map(t=>{
    const m=metaAll.find(x=>x.trackId===t.id)||{};
    const title=esc(m.title||t.name.replace(/\.[^.]+$/,""));
    const artist=(m.artist||"").trim();
    const current=V.currentTrack?.id===t.id;
    return`<div class="list-item${current?" playing":""}">
      <div class="list-item-art">${current?`<div class="playing-bar"><span></span><span></span><span></span></div>`:`<span class="list-item-note">🎵</span>`}</div>
      <div class="list-item-info">
        <div class="list-item-title">${title}</div>
        ${artist?`<div class="list-item-sub">${esc(artist)}</div>`:""}
      </div>
      <div class="list-item-actions">
        <button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button>
        <button class="list-action-btn" onclick="window.Vibez.addToQueue('${t.id}')">+Q</button>
        <button class="list-action-btn" onclick="window.Vibez.showActionSheet('${t.id}','playlist')" title="Add to Playlist">🎶</button>
        <button class="list-action-btn" onclick="window.Vibez.showActionSheet('${t.id}','crate')" title="Add to Crate">📦</button>
      </div>
    </div>`;
  }).join("");
}

async function renderFavorites(){
  const el=$("libraryList");
  const metaAll=await db.all("metadata");
  const favTracks=alphaSort(V.library.filter(t=>V.favorites.has(t.id)));
  if(!favTracks.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">♥</div><p class="list-empty-title">No favorites yet</p><p class="list-empty-sub">Heart a song on the Player to save it here</p></div>`;return;}
  el.innerHTML=favTracks.map(t=>{
    const m=metaAll.find(x=>x.trackId===t.id)||{};
    const title=esc(m.title||t.name.replace(/\.[^.]+$/,""));
    return`<div class="list-item"><div class="list-item-art"><span class="list-item-note">♥</span></div><div class="list-item-info"><div class="list-item-title">${title}</div></div><div class="list-item-actions"><button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button></div></div>`;
  }).join("");
}

async function renderRecent(){
  const el=$("libraryList");
  const recentAll=await db.all("recent");
  const metaAll=await db.all("metadata");
  const seen=new Set();
  const sorted=recentAll.sort((a,b)=>b.timestamp-a.timestamp).filter(r=>{if(seen.has(r.trackId))return false;seen.add(r.trackId);return true;}).slice(0,50);
  if(!sorted.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">🕐</div><p class="list-empty-title">Nothing added yet</p></div>`;return;}
  el.innerHTML=sorted.map(r=>{
    const t=V.library.find(x=>x.id===r.trackId);if(!t)return"";
    const m=metaAll.find(x=>x.trackId===t.id)||{};
    const title=esc(m.title||t.name.replace(/\.[^.]+$/,""));
    return`<div class="list-item"><div class="list-item-art"><span class="list-item-note">🕐</span></div><div class="list-item-info"><div class="list-item-title">${title}</div></div><div class="list-item-actions"><button class="list-action-btn primary" onclick="window.Vibez.playFromLibrary('${t.id}')">▶</button></div></div>`;
  }).join("");
}

function renderEmptyTab(icon,title,sub){
  const el=$("libraryList");if(!el)return;
  el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">${icon}</div><p class="list-empty-title">${title}</p><p class="list-empty-sub">${sub}</p></div>`;
}

/* ============================================================
   PLAYLISTS
   ============================================================ */
function renderPlaylistsTab(){
  const el=$("libraryList");if(!el)return;
  if(V.currentPlaylist){renderPlaylistContents(V.currentPlaylist);return;}

  const html=`
    <div class="pl-create-btn" onclick="window.Vibez.createPlaylist()">
      <div class="pl-create-icon">＋</div>
      New Playlist
    </div>
    ${V.playlists.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">🎶</div><p class="list-empty-title">No playlists yet</p><p class="list-empty-sub">Tap + to create your first playlist</p></div>`
      :V.playlists.map(pl=>`
        <div class="pl-item">
          <div class="pl-icon">🎶</div>
          <div class="pl-info" onclick="window.Vibez.openPlaylist(${pl.id})">
            <div class="pl-name">${esc(pl.name)}</div>
            <div class="pl-count">${pl.tracks.length} track${pl.tracks.length!==1?"s":""}</div>
          </div>
          <div class="pl-actions">
            <button class="list-action-btn primary" onclick="window.Vibez.openPlaylist(${pl.id})">Open</button>
            <button class="list-action-btn" onclick="window.Vibez.deletePlaylist(${pl.id})">✕</button>
          </div>
        </div>`).join("")
    }`;
  el.innerHTML=html;
}

function renderPlaylistContents(pl){
  const el=$("libraryList");if(!el)return;
  const tracks=pl.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
  const sorted=alphaSort(tracks);

  el.innerHTML=`
    <div class="folder-back" onclick="window.Vibez.closePlaylist()">‹ Back to Playlists</div>
    <div class="pl-item" style="border-bottom:1px solid var(--line2);cursor:default">
      <div class="pl-icon">🎶</div>
      <div class="pl-info">
        <div class="pl-name">${esc(pl.name)}</div>
        <div class="pl-count">${sorted.length} track${sorted.length!==1?"s":""}</div>
      </div>
      ${sorted.length?`<button class="list-action-btn primary" onclick="window.Vibez.playPlaylist(${pl.id})">▶ Play All</button>`:""}
    </div>
    ${sorted.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">🎵</div><p class="list-empty-title">Playlist is empty</p><p class="list-empty-sub">Add songs from the Songs tab</p></div>`
      :sorted.map(t=>{
        const title=esc(t.name.replace(/\.[^.]+$/,""));
        const current=V.currentTrack?.id===t.id;
        return`<div class="list-item${current?" playing":""}">
          <div class="list-item-art">${current?`<div class="playing-bar"><span></span><span></span><span></span></div>`:`<span class="list-item-note">🎵</span>`}</div>
          <div class="list-item-info"><div class="list-item-title">${title}</div></div>
          <div class="list-item-actions">
            <button class="list-action-btn primary" onclick="window.Vibez.playFromPlaylist('${t.id}',${pl.id})">▶</button>
            <button class="list-action-btn" onclick="window.Vibez.removeFromPlaylist('${t.id}',${pl.id})">✕</button>
          </div>
        </div>`;
      }).join("")
    }`;
}

async function createPlaylist(){
  showCreateModal("playlist","New Playlist",async name=>{
    await db.put("playlists",{name,tracks:[],createdAt:Date.now()});
    V.playlists=await db.all("playlists");
    renderPlaylistsTab();
    showToast(`Playlist "${name}" created`);
  });
}

async function deletePlaylist(id){
  await db.del("playlists",id);
  V.playlists=await db.all("playlists");
  if(V.currentPlaylist?.id===id)V.currentPlaylist=null;
  renderPlaylistsTab();
  showToast("Playlist deleted");
}

async function addToPlaylist(trackId,playlistId){
  const pl=V.playlists.find(x=>x.id===playlistId);
  if(!pl)return;
  if(pl.tracks.includes(trackId)){showToast("Already in playlist");return;}
  pl.tracks.push(trackId);
  await db.put("playlists",pl);
  V.playlists=await db.all("playlists");
  showToast(`Added to "${pl.name}"`);
}

async function removeFromPlaylist(trackId,playlistId){
  const pl=V.playlists.find(x=>x.id===playlistId);
  if(!pl)return;
  pl.tracks=pl.tracks.filter(id=>id!==trackId);
  await db.put("playlists",pl);
  V.playlists=await db.all("playlists");
  if(V.currentPlaylist?.id===playlistId)V.currentPlaylist=pl;
  renderPlaylistContents(pl);
  showToast("Removed from playlist");
}

/* ============================================================
   CRATES
   ============================================================ */
function renderCratesTab(){
  const el=$("libraryList");if(!el)return;
  if(V.currentCrate){renderCrateContents(V.currentCrate);return;}

  const html=`
    <div class="pl-create-btn" onclick="window.Vibez.createCrate()">
      <div class="pl-create-icon" style="border-color:var(--gold);color:var(--gold)">＋</div>
      <span style="color:var(--gold)">New Crate</span>
    </div>
    ${V.crates.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">📦</div><p class="list-empty-title">No crates yet</p><p class="list-empty-sub">Tap + to create your first DJ crate</p></div>`
      :V.crates.map(cr=>`
        <div class="pl-item">
          <div class="pl-icon crate">📦</div>
          <div class="pl-info" onclick="window.Vibez.openCrate(${cr.id})">
            <div class="pl-name">${esc(cr.name)}</div>
            <div class="pl-count">${cr.tracks.length} track${cr.tracks.length!==1?"s":""}</div>
          </div>
          <div class="pl-actions">
            <button class="list-action-btn primary" onclick="window.Vibez.openCrate(${cr.id})">Open</button>
            <button class="list-action-btn" onclick="window.Vibez.deleteCrate(${cr.id})">✕</button>
          </div>
        </div>`).join("")
    }`;
  el.innerHTML=html;
}

function renderCrateContents(cr){
  const el=$("libraryList");if(!el)return;
  const tracks=cr.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean);
  const sorted=alphaSort(tracks);

  el.innerHTML=`
    <div class="folder-back" onclick="window.Vibez.closeCrate()">‹ Back to Crates</div>
    <div class="pl-item" style="border-bottom:1px solid var(--line2);cursor:default">
      <div class="pl-icon crate">📦</div>
      <div class="pl-info">
        <div class="pl-name">${esc(cr.name)}</div>
        <div class="pl-count">${sorted.length} track${sorted.length!==1?"s":""}</div>
      </div>
      ${sorted.length?`<button class="list-action-btn primary" onclick="window.Vibez.playCrate(${cr.id})">▶ Play All</button>`:""}
    </div>
    ${sorted.length===0
      ?`<div class="list-empty"><div class="list-empty-icon">📦</div><p class="list-empty-title">Crate is empty</p><p class="list-empty-sub">Add songs from the Songs tab</p></div>`
      :sorted.map(t=>{
        const title=esc(t.name.replace(/\.[^.]+$/,""));
        const current=V.currentTrack?.id===t.id;
        return`<div class="list-item${current?" playing":""}">
          <div class="list-item-art">${current?`<div class="playing-bar"><span></span><span></span><span></span></div>`:`<span class="list-item-note">🎵</span>`}</div>
          <div class="list-item-info"><div class="list-item-title">${title}</div></div>
          <div class="list-item-actions">
            <button class="list-action-btn primary" onclick="window.Vibez.playFromCrate('${t.id}',${cr.id})">▶</button>
            <button class="list-action-btn" onclick="window.Vibez.removeFromCrate('${t.id}',${cr.id})">✕</button>
          </div>
        </div>`;
      }).join("")
    }`;
}

async function createCrate(){
  showCreateModal("crate","New Crate",async name=>{
    await db.put("crates",{name,tracks:[],createdAt:Date.now()});
    V.crates=await db.all("crates");
    renderCratesTab();
    showToast(`Crate "${name}" created`);
  });
}

async function deleteCrate(id){
  await db.del("crates",id);
  V.crates=await db.all("crates");
  if(V.currentCrate?.id===id)V.currentCrate=null;
  renderCratesTab();
  showToast("Crate deleted");
}

async function addToCrate(trackId,crateId){
  const cr=V.crates.find(x=>x.id===crateId);
  if(!cr)return;
  if(cr.tracks.includes(trackId)){showToast("Already in crate");return;}
  cr.tracks.push(trackId);
  await db.put("crates",cr);
  V.crates=await db.all("crates");
  showToast(`Added to "${cr.name}"`);
}

async function removeFromCrate(trackId,crateId){
  const cr=V.crates.find(x=>x.id===crateId);
  if(!cr)return;
  cr.tracks=cr.tracks.filter(id=>id!==trackId);
  await db.put("crates",cr);
  V.crates=await db.all("crates");
  if(V.currentCrate?.id===crateId)V.currentCrate=cr;
  renderCrateContents(cr);
  showToast("Removed from crate");
}

/* ============================================================
   ACTION SHEET — Add to Playlist / Add to Crate
   ============================================================ */
function showActionSheet(trackId,type){
  V.actionTrackId=trackId;
  V.actionType=type;
  const titleEl=$("actionPanelTitle");
  const listEl=$("actionList");

  if(type==="playlist"){
    titleEl.textContent="Add to Playlist";
    const createRow=`<div class="action-item" onclick="window.Vibez.actionCreate()"><div class="action-item-icon">＋</div>New Playlist</div>`;
    if(!V.playlists.length){
      listEl.innerHTML=createRow+`<div class="list-empty"><div class="list-empty-icon">🎶</div><p class="list-empty-title">No playlists yet</p></div>`;
    }else{
      listEl.innerHTML=createRow+V.playlists.map(pl=>`
        <div class="action-item" onclick="window.Vibez.actionAddTo(${pl.id})">
          <div class="action-item-icon">🎶</div>${esc(pl.name)}
          <span style="margin-left:auto;font-size:11px;color:var(--sub)">${pl.tracks.length} tracks</span>
        </div>`).join("");
    }
  } else {
    titleEl.textContent="Add to Crate";
    const createRow=`<div class="action-item" onclick="window.Vibez.actionCreate()"><div class="action-item-icon">＋</div>New Crate</div>`;
    if(!V.crates.length){
      listEl.innerHTML=createRow+`<div class="list-empty"><div class="list-empty-icon">📦</div><p class="list-empty-title">No crates yet</p></div>`;
    }else{
      listEl.innerHTML=createRow+V.crates.map(cr=>`
        <div class="action-item" onclick="window.Vibez.actionAddTo(${cr.id})">
          <div class="action-item-icon">📦</div>${esc(cr.name)}
          <span style="margin-left:auto;font-size:11px;color:var(--sub)">${cr.tracks.length} tracks</span>
        </div>`).join("");
    }
  }

  $("actionPanel").classList.add("open");
}

/* ============================================================
   CREATE MODAL — shared for playlist and crate
   ============================================================ */
let _createCallback=null;
function showCreateModal(type,title,callback){
  _createCallback=callback;
  $("createModalTitle").textContent=title;
  $("createModalInput").value="";
  $("createModal").classList.remove("hidden");
  setTimeout(()=>$("createModalInput").focus(),100);
}

function hideCreateModal(){
  $("createModal").classList.add("hidden");
  _createCallback=null;
}

// EVENTS
function bindEvents(){
  const audio=$("audio");
  document.querySelectorAll(".nav-btn").forEach(b=>{
    b.onclick=()=>{
      showPage(b.dataset.page);
      if(b.dataset.page==="dj") window.DJEngine && window.DJEngine.onDJPageShow();
    };
  });
  $("importBtn").onclick=()=>$("fileInput").click();
  $("fileInput").onchange=e=>{importFiles(e.target.files);e.target.value="";};
  $("libImportBtn").onclick=()=>$("libFileInput").click();
  $("libFileInput").onchange=e=>{importFiles(e.target.files);e.target.value="";};
  $("playBtn").onclick=()=>{
    if(!V.currentTrack){if(V.library.length)loadTrack(alphaSort(V.library)[0],true);return;}
    audio.paused?audio.play().catch(()=>{}):audio.pause();
  };
  $("prevBtn").onclick=()=>prevTrack();
  $("nextBtn").onclick=()=>nextTrack();
  $("seek").oninput=()=>{if(audio.duration)audio.currentTime=(Number($("seek").value)/1000)*audio.duration;};
  audio.ontimeupdate=()=>{
    if(!audio.duration)return;
    $("seek").value=Math.floor((audio.currentTime/audio.duration)*1000);
    $("curTime").textContent=fmt(audio.currentTime);
    $("durTime").textContent=fmt(audio.duration);
    if(V.currentTrack&&Math.floor(audio.currentTime)%5===0){
      db.put("settings",{key:"last_session",value:{trackId:V.currentTrack.id,time:audio.currentTime}}).catch(()=>{});
    }
  };
  audio.onplay=updatePlayerUI;
  audio.onpause=updatePlayerUI;
  audio.onended=()=>nextTrack();
  $("favBtn").onclick=async()=>{
    if(!V.currentTrack)return;
    const id=V.currentTrack.id;
    const wasAdded=!V.favorites.has(id);
    wasAdded?V.favorites.add(id):V.favorites.delete(id);
    await db.put("settings",{key:"favorites",value:[...V.favorites]});
    updatePlayerUI();
    showToast(wasAdded?"Added to favorites":"Removed from favorites");
  };
  $("queueBtn").onclick=()=>$("queuePanel").classList.add("open");
  document.querySelectorAll("[data-close]").forEach(btn=>{btn.onclick=()=>{const t=btn.dataset.close;if(t)$(t).classList.remove("open");};});
  $("queuePanel").onclick=e=>{if(e.target===$("queuePanel"))$("queuePanel").classList.remove("open");};
  $("actionPanel").onclick=e=>{if(e.target===$("actionPanel"))$("actionPanel").classList.remove("open");};

  // Create modal
  $("createModalCancel").onclick=()=>hideCreateModal();
  $("createModalConfirm").onclick=async()=>{
    const name=$("createModalInput").value.trim();
    if(!name){showToast("Please enter a name");return;}
    hideCreateModal();
    if(_createCallback)await _createCallback(name);
  };
  $("createModalInput").onkeydown=async e=>{
    if(e.key==="Enter"){
      const name=$("createModalInput").value.trim();
      if(!name){showToast("Please enter a name");return;}
      hideCreateModal();
      if(_createCallback)await _createCallback(name);
    }
    if(e.key==="Escape")hideCreateModal();
  };

  document.querySelectorAll(".lib-tab").forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll(".lib-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      V.currentLibTab=tab.dataset.tab;
      V.currentLibFolder=null;
      renderLibrary();
    };
  });
  $("searchInput").oninput=()=>renderLibrary();
  $("splash").onclick=dismissSplash;
  setTimeout(dismissSplash,2800);
}

// GLOBAL API
Object.assign(window.Vibez,{
  playFromLibrary:id=>{const t=V.library.find(x=>x.id===id);if(t)loadTrack(t,true);},
  addToQueue,removeFromQueue,toggleRadio,
  openFolder:id=>{V.currentLibFolder=id;renderLibrary();},
  closeFolder:()=>{V.currentLibFolder=null;renderLibrary();},

  // Playlists
  createPlaylist,deletePlaylist,
  openPlaylist:id=>{V.currentPlaylist=V.playlists.find(x=>x.id===id)||null;renderPlaylistsTab();},
  closePlaylist:()=>{V.currentPlaylist=null;renderPlaylistsTab();},
  playFromPlaylist:(trackId,plId)=>{
    V.currentPlaylist=V.playlists.find(x=>x.id===plId)||null;
    const t=V.library.find(x=>x.id===trackId);
    if(t)loadTrack(t,true,0,"playlist");
  },
  playPlaylist:id=>{
    const pl=V.playlists.find(x=>x.id===id);if(!pl||!pl.tracks.length)return;
    V.currentPlaylist=pl;
    const tracks=pl.tracks.map(tid=>V.library.find(x=>x.id===tid)).filter(Boolean);
    const sorted=alphaSort(tracks);
    if(sorted.length)loadTrack(sorted[0],true,0,"playlist");
  },
  removeFromPlaylist,
  addToPlaylist,

  // Crates
  createCrate,deleteCrate,
  openCrate:id=>{V.currentCrate=V.crates.find(x=>x.id===id)||null;renderCratesTab();},
  closeCrate:()=>{V.currentCrate=null;renderCratesTab();},
  playFromCrate:(trackId,crId)=>{
    V.currentCrate=V.crates.find(x=>x.id===crId)||null;
    const t=V.library.find(x=>x.id===trackId);
    if(t)loadTrack(t,true,0,"crate");
  },
  playCrate:id=>{
    const cr=V.crates.find(x=>x.id===id);if(!cr||!cr.tracks.length)return;
    V.currentCrate=cr;
    const tracks=cr.tracks.map(tid=>V.library.find(x=>x.id===tid)).filter(Boolean);
    const sorted=alphaSort(tracks);
    if(sorted.length)loadTrack(sorted[0],true,0,"crate");
  },
  removeFromCrate,
  addToCrate,

  // Action sheet
  showActionSheet,
  actionCreate:()=>{
    $("actionPanel").classList.remove("open");
    if(V.actionType==="playlist"){
      createPlaylist();
    }else{
      createCrate();
    }
  },
  actionAddTo:async id=>{
    $("actionPanel").classList.remove("open");
    if(V.actionType==="playlist"){
      await addToPlaylist(V.actionTrackId,id);
    }else{
      await addToCrate(V.actionTrackId,id);
    }
  }
});

// INIT
(async()=>{
  try{
    V.db=await initDB();
    bindEvents();
    renderRadio();
    await syncState();
    showPage(localStorage.getItem("vz_page")||"player");
    console.info("868 Vibez V2 — Phase 1 Update ✓");
  }catch(err){
    console.error("868 Vibez init failed:",err);
  }
})();
/* ============================================================
   DJ ENGINE — Phase 4
   ============================================================ */
const DJE = window.DJEngine = (() => {
  const state = {
    audioCtx: null,
    decks: {
      A: { audio: new Audio(), gainNode:null, hiEQ:null, midEQ:null, loEQ:null,
           track:null, url:null, cueTime:0, pitch:1.0, vol:1.0,
           hotCues:[null,null,null,null], loopIn:null, loopOut:null, looping:false,
           animFrame:null, platAngle:0 },
      B: { audio: new Audio(), gainNode:null, hiEQ:null, midEQ:null, loEQ:null,
           track:null, url:null, cueTime:0, pitch:1.0, vol:1.0,
           hotCues:[null,null,null,null], loopIn:null, loopOut:null, looping:false,
           animFrame:null, platAngle:0 }
    },
    crossfader: 0.5,
    browserDeck: null,
    browserTab: "folders",
    browserFolder: null,
    coverImg: null
  };

  const coverImg = new Image();
  coverImg.src = "cover.png";
  coverImg.onload = () => { state.coverImg = coverImg; };

  function initAudio() {
    if (state.audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
    ["A","B"].forEach(id => {
      const d = state.decks[id];
      d.audio.crossOrigin = "anonymous";
      d.hiEQ  = state.audioCtx.createBiquadFilter(); d.hiEQ.type  = "highshelf"; d.hiEQ.frequency.value  = 8000;
      d.midEQ = state.audioCtx.createBiquadFilter(); d.midEQ.type = "peaking";   d.midEQ.frequency.value = 1000; d.midEQ.Q.value = 1;
      d.loEQ  = state.audioCtx.createBiquadFilter(); d.loEQ.type  = "lowshelf";  d.loEQ.frequency.value  = 200;
      d.gainNode = state.audioCtx.createGain();
      const src = state.audioCtx.createMediaElementSource(d.audio);
      src.connect(d.loEQ); d.loEQ.connect(d.midEQ); d.midEQ.connect(d.hiEQ); d.hiEQ.connect(d.gainNode);
      d.gainNode.connect(state.audioCtx.destination);
    });
    updateMix();
  }

  function updateMix() {
    if (!state.audioCtx) return;
    const cf = state.crossfader;
    const gainA = Math.cos(cf * Math.PI / 2);
    const gainB = Math.cos((1 - cf) * Math.PI / 2);
    const dA = state.decks.A, dB = state.decks.B;
    if (dA.gainNode) dA.gainNode.gain.setTargetAtTime(dA.vol * gainA, state.audioCtx.currentTime, 0.01);
    if (dB.gainNode) dB.gainNode.gain.setTargetAtTime(dB.vol * gainB, state.audioCtx.currentTime, 0.01);
  }

  async function loadToDeck(deckId, trackRecord) {
    initAudio();
    const d = state.decks[deckId];
    if (d.url) URL.revokeObjectURL(d.url);
    if (d.animFrame) cancelAnimationFrame(d.animFrame);
    const stored = await db.get("tracks", trackRecord.id);
    if (!stored?.blob) return;
    d.track = trackRecord;
    d.url = URL.createObjectURL(stored.blob);
    d.audio.src = d.url;
    d.audio.playbackRate = d.pitch;
    d.cueTime = 0; d.loopIn = null; d.loopOut = null; d.looping = false;
    d.hotCues = [null,null,null,null];
    const title = trackRecord.name.replace(/\.[^.]+$/,"");
    $(`deck${deckId}Title`).textContent = title;
    $(`play${deckId}`).textContent = "▶";
    $(`play${deckId}`).classList.remove("playing");
    $(`time${deckId}`).textContent = "0:00";
    $(`dur${deckId}`).textContent  = "0:00";
    $(`pitch${deckId}`).value = 0;
    $(`pitch${deckId}Val`).textContent = "0%";
    $(`vol${deckId}`).value = 1;
    // Only reset loop toggle if this deck was the one looping
    if (state.decks[deckId].looping) $("loopToggle").classList.remove("active");
    [0,1,2,3].forEach(i => $(`hc${i}`).classList.remove("set"));
    d.audio.ontimeupdate = () => {
      $(`time${deckId}`).textContent = fmt(d.audio.currentTime);
      if (d.looping && d.loopOut !== null && d.audio.currentTime >= d.loopOut) d.audio.currentTime = d.loopIn || 0;
      drawWave(deckId);
    };
    d.audio.ondurationchange = () => { $(`dur${deckId}`).textContent = fmt(d.audio.duration); };
    d.audio.onplay  = () => { $(`play${deckId}`).textContent = "⏸"; $(`play${deckId}`).classList.add("playing");    startPlatter(deckId); };
    d.audio.onpause = () => { $(`play${deckId}`).textContent = "▶";  $(`play${deckId}`).classList.remove("playing"); stopPlatter(deckId);  };
    drawPlatter(deckId); drawWave(deckId); updateMix();
    showToast(`Loaded to Deck ${deckId}: ${title}`);
  }

  function play(deckId) {
    initAudio();
    const d = state.decks[deckId];
    if (!d.track) return;
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    d.audio.paused ? d.audio.play().catch(()=>{}) : d.audio.pause();
  }

  function cue(deckId) {
    const d = state.decks[deckId]; if (!d.track) return;
    if (!d.audio.paused) { d.audio.pause(); d.audio.currentTime = d.cueTime; }
    else { d.cueTime = d.audio.currentTime; showToast(`Deck ${deckId} cue: ${fmt(d.cueTime)}`); }
  }

  function setPitch(deckId, val) {
    const d = state.decks[deckId];
    const pct = parseFloat(val);
    d.pitch = 1 + (pct / 100);
    d.audio.playbackRate = d.pitch;
    $(`pitch${deckId}Val`).textContent = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }

  function setVol(deckId, val) { state.decks[deckId].vol = parseFloat(val); updateMix(); }
  function setCrossfader(val)   { state.crossfader = parseFloat(val); updateMix(); }

  function setEQ(deckId, band, val) {
    const d = state.decks[deckId];
    if (!state.audioCtx) return;
    const gain = (parseFloat(val) - 1) * 15;
    if (band === "hi"  && d.hiEQ)  d.hiEQ.gain.setTargetAtTime(gain,  state.audioCtx.currentTime, 0.01);
    if (band === "mid" && d.midEQ) d.midEQ.gain.setTargetAtTime(gain, state.audioCtx.currentTime, 0.01);
    if (band === "lo"  && d.loEQ)  d.loEQ.gain.setTargetAtTime(gain,  state.audioCtx.currentTime, 0.01);
  }

  function activeDeck() {
    // Prefer playing deck, fall back to whichever has a track loaded
    if (!state.decks.A.audio.paused) return "A";
    if (!state.decks.B.audio.paused) return "B";
    return state.decks.A.track ? "A" : (state.decks.B.track ? "B" : "A");
  }

  function hotCue(idx) {
    const deckId = activeDeck();
    const d = state.decks[deckId]; if (!d.track) return;
    if (d.hotCues[idx] === null) {
      d.hotCues[idx] = d.audio.currentTime;
      $(`hc${idx}`).classList.add("set");
      showToast(`Cue ${idx+1} set at ${fmt(d.hotCues[idx])}`);
    } else {
      d.audio.currentTime = d.hotCues[idx];
      if (d.audio.paused) d.audio.play().catch(()=>{});
    }
  }

  function loopIn() {
    const d = state.decks[activeDeck()]; if (!d.track) return;
    d.loopIn = d.audio.currentTime; showToast(`Loop in: ${fmt(d.loopIn)}`);
  }
  function loopOut() {
    const d = state.decks[activeDeck()]; if (!d.track || d.loopIn === null) return;
    d.loopOut = d.audio.currentTime; showToast(`Loop out: ${fmt(d.loopOut)}`);
  }
  function loopToggle() {
    const d = state.decks[activeDeck()]; if (!d.track) return;
    d.looping = !d.looping;
    $("loopToggle").classList.toggle("active", d.looping);
    showToast(d.looping ? "Loop ON" : "Loop OFF");
    if (d.looping && d.loopIn !== null) d.audio.currentTime = d.loopIn;
  }

  function drawPlatter(deckId) {
    const canvas = $(`plat${deckId}`); if (!canvas) return;
    const wrap = canvas.parentElement;
    const size = Math.min(Math.floor((wrap.clientWidth || 120) * 0.95), 130);
    if (size <= 0) return;
    canvas.width  = size * window.devicePixelRatio;
    canvas.height = size * window.devicePixelRatio;
    canvas.style.width  = size + "px";
    canvas.style.height = size + "px";
    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const r  = cx - 2;
    const dpr = window.devicePixelRatio;
    const d  = state.decks[deckId];
    const col = deckId === "A" ? "#c8102e" : "#d4a017";
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.strokeStyle = col; ctx.lineWidth = 2*dpr; ctx.stroke();
    for (let i=1;i<=4;i++){
      ctx.beginPath(); ctx.arc(cx,cy,r-(i*6*dpr),0,Math.PI*2);
      ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth=1; ctx.stroke();
    }
    if (state.coverImg) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r*0.72,0,Math.PI*2); ctx.clip();
      ctx.translate(cx,cy); ctx.rotate(d.platAngle);
      const iSize = r*1.44; ctx.drawImage(state.coverImg,-iSize/2,-iSize/2,iSize,iSize);
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx,cy,5*dpr,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(d.platAngle);
    ctx.beginPath(); ctx.moveTo(0,-(r*0.72)); ctx.lineTo(0,-(r*0.72)+8*dpr);
    ctx.strokeStyle="#fff"; ctx.lineWidth=2*dpr; ctx.stroke(); ctx.restore();
  }

  function startPlatter(deckId) {
    const d = state.decks[deckId];
    function tick() {
      if (!d.audio.paused) {
        d.platAngle += (2*Math.PI)/(d.audio.playbackRate*60*0.6);
        drawPlatter(deckId);
        d.animFrame = requestAnimationFrame(tick);
      }
    }
    tick();
  }

  function stopPlatter(deckId) {
    const d = state.decks[deckId];
    if (d.animFrame) { cancelAnimationFrame(d.animFrame); d.animFrame=null; }
    drawPlatter(deckId);
  }

  function drawWave(deckId) {
    const canvas = $(`wave${deckId}`); if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    if (w<=0||h<=0) return;
    const d = state.decks[deckId];
    const col = deckId==="A" ? "#c8102e" : "#d4a017";
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle=col; ctx.lineWidth=1.5*window.devicePixelRatio; ctx.beginPath();
    for(let x=0;x<w;x++){
      const y=h/2+Math.sin(x*0.045)*h*0.3*Math.sin(x*0.009+(d.platAngle*2));
      x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.stroke();
    if (d.track && d.audio.duration){
      const prog = d.audio.currentTime/d.audio.duration;
      const px   = prog*w;
      ctx.strokeStyle="#fff"; ctx.lineWidth=1.5*window.devicePixelRatio;
      ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,h); ctx.stroke();
    }
  }

  function openBrowser(deckId) {
    state.browserDeck=deckId; state.browserTab="folders"; state.browserFolder=null;
    $("djBrowserTitle").textContent=`Load to Deck ${deckId}`;
    $("djBrowserTitle").style.color=deckId==="A"?"var(--red)":"var(--gold-hi)";
    document.querySelectorAll(".dj-btab").forEach(t=>t.classList.toggle("active",t.dataset.btab==="folders"));
    renderBrowser();
    $("djBrowser").classList.add("open");
  }

  function closeBrowser() { $("djBrowser").classList.remove("open"); state.browserFolder=null; }

  function renderBrowser() {
    const el=$("djBrowserList"); if(!el) return;
    if (state.browserTab==="folders") {
      if (state.browserFolder){renderBrowserFolder(state.browserFolder);return;}
      const folders=Object.values(V.folders);
      if(!folders.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">📁</div><p class="list-empty-title">No folders imported</p></div>`;return;}
      el.innerHTML=[...folders].sort((a,b)=>a.name.localeCompare(b.name)).map(f=>`
        <div class="folder-item" onclick="window.DJEngine.browserOpenFolder('${f.id}')">
          <div class="folder-icon">📁</div>
          <div class="folder-info"><div class="folder-name">${esc(f.name)}</div><div class="folder-count">${f.tracks.length} tracks</div></div>
          <div class="folder-arrow">›</div>
        </div>`).join("");
    } else if (state.browserTab==="playlists") {
      if(!V.playlists.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">🎶</div><p class="list-empty-title">No playlists</p></div>`;return;}
      el.innerHTML=V.playlists.map(pl=>`
        <div class="folder-item" onclick="window.DJEngine.browserOpenPlaylist(${pl.id})">
          <div class="folder-icon">🎶</div>
          <div class="folder-info"><div class="folder-name">${esc(pl.name)}</div><div class="folder-count">${pl.tracks.length} tracks</div></div>
          <div class="folder-arrow">›</div>
        </div>`).join("");
    } else {
      if(!V.crates.length){el.innerHTML=`<div class="list-empty"><div class="list-empty-icon">📦</div><p class="list-empty-title">No crates</p></div>`;return;}
      el.innerHTML=V.crates.map(cr=>`
        <div class="folder-item" onclick="window.DJEngine.browserOpenCrate(${cr.id})">
          <div class="folder-icon">📦</div>
          <div class="folder-info"><div class="folder-name">${esc(cr.name)}</div><div class="folder-count">${cr.tracks.length} tracks</div></div>
          <div class="folder-arrow">›</div>
        </div>`).join("");
    }
  }

  function renderBrowserFolder(folderId) {
    const el=$("djBrowserList"); const folder=V.folders[folderId]; if(!el||!folder) return;
    const tracks=alphaSort(folder.tracks.map(id=>V.library.find(x=>x.id===id)).filter(Boolean));
    el.innerHTML=`<div class="folder-back" onclick="window.DJEngine.browserBack()">‹ Back</div>`+
      tracks.map(t=>`<div class="list-item" onclick="window.DJEngine.browserLoad('${t.id}')">
        <div class="list-item-art"><span class="list-item-note">🎵</span></div>
        <div class="list-item-info"><div class="list-item-title">${esc(t.name.replace(/\.[^.]+$/,""))}</div></div>
        <div class="list-item-actions"><button class="list-action-btn primary">Load</button></div>
      </div>`).join("");
  }

  function renderBrowserCollection(tracks) {
    const el=$("djBrowserList"); if(!el) return;
    const sorted=alphaSort(tracks.filter(Boolean));
    el.innerHTML=`<div class="folder-back" onclick="window.DJEngine.browserBack()">‹ Back</div>`+
      sorted.map(t=>`<div class="list-item" onclick="window.DJEngine.browserLoad('${t.id}')">
        <div class="list-item-art"><span class="list-item-note">🎵</span></div>
        <div class="list-item-info"><div class="list-item-title">${esc(t.name.replace(/\.[^.]+$/,""))}</div></div>
        <div class="list-item-actions"><button class="list-action-btn primary">Load</button></div>
      </div>`).join("");
  }

  async function browserLoad(trackId) {
    const track=V.library.find(x=>x.id===trackId); if(!track) return;
    closeBrowser();
    await loadToDeck(state.browserDeck,track);
  }

  function switchBrowserTab(tab) {
    state.browserTab=tab; state.browserFolder=null;
    document.querySelectorAll(".dj-btab").forEach(t=>t.classList.toggle("active",t.dataset.btab===tab));
    renderBrowser();
  }

  function onDJPageShow() {
    setTimeout(()=>{ drawPlatter("A"); drawPlatter("B"); drawWave("A"); drawWave("B"); },120);
  }

  // Browser tab clicks
  document.querySelectorAll(".dj-btab").forEach(t=>{ t.onclick=()=>switchBrowserTab(t.dataset.btab); });
  $("djBrowser").onclick=e=>{ if(e.target===$("djBrowser"))closeBrowser(); };

  return {
    play, cue, setPitch, setVol, setCrossfader, setEQ,
    hotCue, loopIn, loopOut, loopToggle,
    openBrowser, closeBrowser, onDJPageShow,
    browserLoad,
    browserOpenFolder: id=>{ state.browserFolder=id; renderBrowserFolder(id); },
    browserOpenPlaylist: id=>{ const pl=V.playlists.find(x=>x.id===id); if(pl)renderBrowserCollection(pl.tracks.map(tid=>V.library.find(x=>x.id===tid))); },
    browserOpenCrate:   id=>{ const cr=V.crates.find(x=>x.id===id);    if(cr)renderBrowserCollection(cr.tracks.map(tid=>V.library.find(x=>x.id===tid))); },
    browserBack: ()=>{ state.browserFolder=null; renderBrowser(); }
  };
})();
