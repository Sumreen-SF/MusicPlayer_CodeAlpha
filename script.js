/* ============================================================
   DATA
   Local tracks, served from /music, with matching covers from
   /covers. Edit title/artist strings below any time — they're
   just display labels guessed from your filenames.
   ============================================================ */
let nextId = 1;
function mk(title, artist, src, art){
  return { id: nextId++, title, artist, src, art: art || null };
}

const art_ = (name) => `covers/${name}.jpg`;
const song = (name) => `music/${name}.mp3`;

const t_art       = mk("Art",              "Unknown Artist", song("art"),               art_("art"));
const t_chill      = mk("Chill Lofi",       "Unknown Artist", song("chill-lofi"),         art_("chill-lofi"));
const t_escape     = mk("Escape Your Love", "Unknown Artist", song("escape-your-love"),   art_("escape-your-love"));
const t_fun        = mk("Fun",              "Unknown Artist", song("fun"),                art_("fun"));
const t_jazzy      = mk("Jazzy Lofi",       "Unknown Artist", song("jazzy-lofi"),         art_("jazzy-lofi"));
const t_joyful     = mk("Joyful Rhythm",     "Unknown Artist", song("joyful-rhythm"),       art_("joyful-rhythm"));
const t_lazy       = mk("Lazy Day",         "Unknown Artist", song("lazyday"),            art_("lazyday"));
const t_letitgo    = mk("Let It Go",        "Unknown Artist", song("let-it-go"),          art_("letitgo"));
const t_rock       = mk("Rock",             "Unknown Artist", song("rock"),               art_("rock"));
const t_running    = mk("Running Night",    "Unknown Artist", song("runningnight"),       art_("runningnight"));
const t_study      = mk("Study Lofi",       "Unknown Artist", song("study-lofi"),         art_("study"));

const library = [
  t_art, t_chill, t_escape, t_fun, t_jazzy, t_joyful,
  t_lazy, t_letitgo, t_rock, t_running, t_study,
];

const playlists = {
  "Emerald Mix": library.map(t => t.id),
  "Pink Room": [t_chill.id, t_lazy.id, t_jazzy.id, t_study.id],
  "Sunday Static": [t_escape.id, t_letitgo.id, t_running.id],
};
let currentPlaylist = "Emerald Mix";
let activeOrder = [];      // the real playback sequence for the current playlist (canonical or shuffled)
let currentIndex = 0;      // position within activeOrder
let isPlaying = false;
let autoplay = true;
let shuffle = false;
let nowPlayingContextLabel = null; // e.g. "Most Listened" when playing an ad-hoc queue, not a saved playlist
let countedThisLoad = false;       // guards play-count so a track only counts once per load, not per replay/seek


/* ============================================================
   STORAGE LAYER
   Two tiers:
   - localStorage: small JSON — groove notes, playlist structure
     (which track IDs belong to which playlist), and metadata
     for user-added tracks (title/artist/id, plus how to find
     their actual audio).
   - IndexedDB: the actual audio/cover file *bytes* for anything
     the user uploaded from disk. Uploaded files become blob:
     URLs that die the moment the page reloads, so the only way
     to survive a refresh is to keep the real Blob around and
     mint a fresh object URL from it on load. Pasted-link tracks
     don't need this — their URL is already permanent.
   Everything here is wrapped defensively: if storage is full,
   blocked (private browsing), or unsupported, the app just
   falls back to in-memory/session-only behavior instead of
   breaking.
   ============================================================ */
const LS_PREFIX = 'groove:';

function lsGet(key, fallback){
  try{
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){
    console.warn('[groove/storage] could not read', key, e);
    return fallback;
  }
}
function lsSet(key, value){
  try{
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  }catch(e){
    console.warn('[groove/storage] could not save', key, e);
    return false;
  }
}

const IDB_NAME = 'groove-media';
const IDB_VERSION = 1;
const IDB_STORE = 'files';
let idbPromise = null;
function openMediaDB(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unsupported'));
  if(idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}
async function idbSetFile(key, blob){
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetFile(key){
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbDeleteFile(key){
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Groove Notes persistence ----
let grooveNotes = lsGet('grooveNotes', {}); // { trackId: [{time, text}] }
function saveGrooveNotes(){ lsSet('grooveNotes', grooveNotes); }

// ---- Play counts (powers Browse's most/least listened + Charts) ----
let playCounts = lsGet('playCounts', {}); // { trackId: count }
function savePlayCounts(){ lsSet('playCounts', playCounts); }
function getPlayCount(id){ return playCounts[id] || 0; }
function registerPlay(id){
  playCounts[id] = (playCounts[id] || 0) + 1;
  savePlayCounts();
}

// ---- Favorites ----
let favorites = new Set(lsGet('favorites', []));
function saveFavorites(){ lsSet('favorites', Array.from(favorites)); }
function isFavorite(id){ return favorites.has(id); }
function toggleFavorite(id){
  if(favorites.has(id)) favorites.delete(id); else favorites.add(id);
  saveFavorites();
}

// ---- Playlist structure persistence ----
function savePlaylists(){ lsSet('playlists', playlists); }
function loadPlaylistsFromStorage(){
  const stored = lsGet('playlists', null);
  if(!stored) return;
  Object.keys(playlists).forEach(k => delete playlists[k]);
  Object.assign(playlists, stored);
}

// ---- User-added track persistence ----
// Built-in library tracks (from /music) are never persisted — they're
// already permanent files on disk and get rebuilt deterministically
// every load. Only tracks added through "+ Add Music" are saved here.
async function persistUserTrack(track){
  const rec = { id: track.id, title: track.title, artist: track.artist };
  if(track._audioFile){
    await idbSetFile(`audio-${track.id}`, track._audioFile);
    rec.srcKind = 'idb';
  } else {
    rec.srcKind = 'url';
    rec.src = track.src;
  }
  if(track._artFile){
    await idbSetFile(`art-${track.id}`, track._artFile);
    rec.artKind = 'idb';
  } else if(track.art){
    rec.artKind = 'url';
    rec.art = track.art;
  } else {
    rec.artKind = 'none';
  }
  const userTracks = lsGet('userTracks', []);
  userTracks.push(rec);
  lsSet('userTracks', userTracks);
}

async function loadUserTracksIntoLibrary(){
  const userTracks = lsGet('userTracks', []);
  for(const rec of userTracks){
    let src = rec.src || null;
    if(rec.srcKind === 'idb'){
      try{
        const blob = await idbGetFile(`audio-${rec.id}`);
        if(!blob) continue; // saved record but the file itself is gone — skip it
        src = URL.createObjectURL(blob);
      }catch(e){
        console.warn('[groove/storage] could not restore audio for track', rec.id, e);
        continue;
      }
    }
    let art = null;
    if(rec.artKind === 'idb'){
      try{
        const blob = await idbGetFile(`art-${rec.id}`);
        if(blob) art = URL.createObjectURL(blob);
      }catch(e){ /* fall back to generated art */ }
    } else if(rec.artKind === 'url'){
      art = rec.art;
    }
    library.push({ id: rec.id, title: rec.title, artist: rec.artist, src, art });
    if(rec.id >= nextId) nextId = rec.id + 1;
  }
}

// Built-in tracks (from /music) are hardcoded via mk() every load, so
// deleting one only "removes" it for that session unless we remember the
// id and filter it back out on every subsequent load.
function applyDeletedTracksFilter(){
  const deletedIds = new Set(lsGet('deletedTrackIds', []));
  if(deletedIds.size === 0) return;
  for(let i = library.length - 1; i >= 0; i--){
    if(deletedIds.has(library[i].id)) library.splice(i, 1);
  }
  Object.keys(playlists).forEach(name => {
    playlists[name] = playlists[name].filter(id => !deletedIds.has(id));
  });
}

/* ============================================================
   DOM REFS
   ============================================================ */
const audio = document.getElementById('audio');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const seek = document.getElementById('seek');
const seekFill = document.getElementById('seekFill');
const seekWrap = document.getElementById('seekWrap');
const curTimeEl = document.getElementById('curTime');
const durTimeEl = document.getElementById('durTime');
const vol = document.getElementById('vol');
const vinyl = document.getElementById('vinyl');
const tonearm = document.getElementById('tonearm');
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');
const artSlot = document.getElementById('artSlot');
const queueList = document.getElementById('queueList');
const statusTag = document.getElementById('statusTag');
const noteBtn = document.getElementById('noteBtn');
const autoplayToggle = document.getElementById('autoplayToggle');
const shuffleToggle = document.getElementById('shuffleToggle');
const rpmTag = document.getElementById('rpmTag');
const playlistList = document.getElementById('playlistList');
const playlistTitle = document.getElementById('playlistTitle');
const newPlaylistBtn = document.getElementById('newPlaylistBtn');
const addMusicBtn = document.getElementById('addMusicBtn');
const audioFileInput = document.getElementById('audioFileInput');
const artFileInput = document.getElementById('artFileInput');
const modalOverlay = document.getElementById('modalOverlay');
const modalCard = document.getElementById('modalCard');
const favBtn = document.getElementById('favBtn');
const navLinks = document.querySelectorAll('nav.primary a[data-view]');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarEl = document.querySelector('.sidebar');
const views = {
  'now-playing': document.getElementById('viewNowPlaying'),
  'browse': document.getElementById('viewBrowse'),
  'charts': document.getElementById('viewCharts'),
  'favorites': document.getElementById('viewFavorites'),
};
let currentView = 'now-playing';

/* ============================================================
   GENERATIVE ALBUM ART
   No real cover art is pulled from the web — each track gets a
   unique abstract "cover" generated from its title, in the
   emerald/pink palette. Upload your own image to override it.
   ============================================================ */
function hashStr(s){
  let h = 0;
  for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; }
  return h;
}
function paintArt(canvas, track, size){
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const h = hashStr(track.title + track.artist);
  const palette = ['#12503d', '#0c3b2e', '#e89ab1', '#c15c7c', '#d9b871', '#2f7a5f'];
  const c1 = palette[h % palette.length];
  const c2 = palette[(h >> 3) % palette.length];
  const grad = ctx.createLinearGradient(0,0,size,size);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,size,size);

  const shapeType = h % 3;
  ctx.globalAlpha = 0.5;
  if(shapeType === 0){
    // concentric rings, echoing the vinyl motif
    for(let r = size*0.45; r > 6; r -= size*0.11){
      ctx.beginPath();
      ctx.arc(size*0.5, size*0.5, r, 0, Math.PI*2);
      ctx.strokeStyle = (h >> 5) % 2 === 0 ? '#fbf3ec' : '#0c1a15';
      ctx.lineWidth = size*0.03;
      ctx.stroke();
    }
  } else if(shapeType === 1){
    // diagonal stripes
    ctx.fillStyle = '#fbf3ec';
    for(let x = -size; x < size*2; x += size*0.22){
      ctx.save();
      ctx.translate(x + (h % 20), 0);
      ctx.rotate(Math.PI/4);
      ctx.fillRect(0, -size, size*0.08, size*3);
      ctx.restore();
    }
  } else {
    // scattered dots
    const n = 14;
    for(let i=0;i<n;i++){
      const seed = (h * (i+7)) % 997;
      const x = (seed % size);
      const y = ((seed*13) % size);
      const r = 3 + (seed % 9);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = i % 2 === 0 ? '#fbf3ec' : '#0c1a15';
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // initial letter, centered
  ctx.font = `${size*0.34}px Fraunces, serif`;
  ctx.fillStyle = 'rgba(251,243,236,0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(track.title.charAt(0).toUpperCase(), size*0.5, size*0.54);
}

// Paints the image/canvas only — no hover edit control. Used for contexts
// like playlist cards where there's no single "this track" to edit.
function paintArtInto(container, track, size){
  container.innerHTML = '';
  container.style.width = size + 'px';
  container.style.height = size + 'px';
  if(track.art){
    const img = document.createElement('img');
    img.src = track.art;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    // If the cover URL is broken (bad path, moved file, dead pasted link),
    // don't leave a broken-image icon — fall back to the generated art.
    img.onerror = () => {
      container.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);
      paintArt(canvas, track, size);
    };
    container.appendChild(img);
  } else {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    paintArt(canvas, track, size);
  }
}

// Same, plus the hover camera-icon overlay to change that track's cover.
// Used everywhere a row/card represents exactly one editable track.
function renderArtInto(container, track, size){
  paintArtInto(container, track, size);
  attachCoverEditor(container, track, size);
}

function attachCoverEditor(container, track, size){
  const btn = document.createElement('button');
  btn.className = 'cover-edit-btn' + (size <= 44 ? ' mini' : '');
  btn.title = 'Change cover image';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm8 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    artFileInput.value = '';
    artFileInput.onchange = () => {
      const f = artFileInput.files[0];
      if(f){
        track.art = URL.createObjectURL(f);
        track._artFile = f;
        updateArtDisplays();
        // if this track was already persisted, refresh its saved cover too
        if(isUserTrack(track.id)) persistArtOverride(track).catch(()=>{});
      }
    };
    artFileInput.click();
  });
  container.appendChild(btn);
}

function isUserTrack(id){
  return lsGet('userTracks', []).some(r => r.id === id);
}
async function persistArtOverride(track){
  await idbSetFile(`art-${track.id}`, track._artFile);
  const userTracks = lsGet('userTracks', []);
  const rec = userTracks.find(r => r.id === track.id);
  if(rec){ rec.artKind = 'idb'; delete rec.art; lsSet('userTracks', userTracks); }
}

function updateArtDisplays(){
  const t = currentTrack();
  if(t) renderArtInto(artSlot, t, 88);
  renderQueue();
}

/* ============================================================
   HELPERS
   ============================================================ */
function fmt(t){
  if(isNaN(t)) return "0:00";
  const m = Math.floor(t/60);
  const s = Math.floor(t%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function getTrackById(id){ return library.find(t => t.id === id); }
function currentQueueIds(){ return activeOrder; }
function currentTrack(){
  const ids = currentQueueIds();
  const id = ids[currentIndex];
  return id ? getTrackById(id) : null;
}
function shuffleArray(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Rebuilds activeOrder from the canonical playlist order.
// preserveCurrent: keep whatever track is currently loaded at the front
// of the new order, instead of jumping elsewhere.
function rebuildActiveOrder(preserveCurrent){
  const canonical = playlists[currentPlaylist] || [];
  const curId = preserveCurrent ? activeOrder[currentIndex] : null;
  if(shuffle){
    if(curId){
      activeOrder = [curId, ...shuffleArray(canonical.filter(id => id !== curId))];
      currentIndex = 0;
    } else {
      activeOrder = shuffleArray(canonical);
      currentIndex = 0;
    }
  } else {
    activeOrder = [...canonical];
    currentIndex = curId ? Math.max(activeOrder.indexOf(curId), 0) : 0;
  }
}

/* ============================================================
   PLAYLIST SIDEBAR
   ============================================================ */
function renderPlaylists(){
  playlistList.innerHTML = '';
  Object.keys(playlists).forEach(name => {
    const row = document.createElement('div');
    row.className = 'pl-row';
    const btn = document.createElement('button');
    btn.className = 'pl-btn' + (name === currentPlaylist ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => switchPlaylist(name));
    const count = document.createElement('span');
    count.className = 'pl-count';
    count.textContent = playlists[name].length;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pl-delete-btn';
    del.innerHTML = TRASH_ICON;
    del.title = 'Delete playlist';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeletePlaylistModal(name);
    });
    row.appendChild(btn);
    row.appendChild(count);
    row.appendChild(del);
    playlistList.appendChild(row);
  });
}
function switchPlaylist(name){
  currentPlaylist = name;
  nowPlayingContextLabel = null;
  rebuildActiveOrder(false);
  renderPlaylists();
  switchView('now-playing');
  closeSidebar();
  const track = currentTrack();
  if(track) loadTrack(false);
  else { trackTitle.textContent = '—'; trackArtist.textContent = 'Add some music to get started'; renderQueue(); updateFavBtnUI(); }
}
newPlaylistBtn.addEventListener('click', () => { closeSidebar(); openNewPlaylistModal(); });

/* ---------------- Delete Playlist ---------------- */
function openDeletePlaylistModal(name){
  const count = (playlists[name] || []).length;
  if(Object.keys(playlists).length <= 1){
    openModal(`
      <div class="modal-header">
        <h3>Delete Playlist</h3>
        <button class="modal-close-btn" data-action="close">✕</button>
      </div>
      <div class="modal-body">
        <p class="modal-hint">"${escapeHtml(name)}" is your only playlist, so it can't be deleted. Create another playlist first if you want to remove this one.</p>
        <div class="modal-actions">
          <button class="modal-btn primary" data-action="close">Got it</button>
        </div>
      </div>
    `);
    return;
  }
  openModal(`
    <div class="modal-header">
      <h3>Delete Playlist</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-filename">🗑 ${escapeHtml(name)} — ${count} track${count === 1 ? '' : 's'}</div>
      <p class="modal-hint">The playlist itself will be deleted. Your tracks stay in your library and in any other playlists they're part of.</p>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="close">Cancel</button>
        <button class="modal-btn danger" id="mConfirmDeletePlaylist">Delete Playlist</button>
      </div>
    </div>
  `, (card) => {
    card.querySelector('#mConfirmDeletePlaylist').addEventListener('click', () => {
      deletePlaylist(name);
      closeModal();
    });
  });
}

function deletePlaylist(name){
  delete playlists[name];
  savePlaylists();
  if(currentPlaylist === name){
    currentPlaylist = Object.keys(playlists)[0];
    nowPlayingContextLabel = null;
    rebuildActiveOrder(false);
    if(currentTrack()) loadTrack(false);
    else { trackTitle.textContent = '—'; trackArtist.textContent = 'Add some music to get started'; renderQueue(); updateFavBtnUI(); }
    updateTopbarHeading();
  }
  renderPlaylists();
  if(currentView === 'browse') renderBrowsePage();
  if(currentView === 'charts') renderChartsPage();
}

/* ============================================================
   MODAL ENGINE — a tiny helper the New Playlist, Add Music, and
   Groove Note flows are all built on, matching the app's own
   look instead of the browser's native prompt()/confirm() dialogs.
   ============================================================ */
function openModal(html, onMount){
  modalCard.innerHTML = html;
  modalOverlay.classList.add('open');
  modalCard.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', closeModal));
  if(onMount) onMount(modalCard);
}
function closeModal(){
  modalOverlay.classList.remove('open');
}
modalOverlay.addEventListener('click', (e) => { if(e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
});

/* ============================================================
   VIEW ROUTING — Now Playing / Browse / Charts / Favorites
   The audio element lives outside all of this, so playback keeps
   going in the background no matter which page is showing.
   ============================================================ */
/* ============================================================
   MOBILE SIDEBAR DRAWER
   Below 820px the emerald sidebar becomes an off-canvas drawer
   instead of disappearing — otherwise Browse/Charts/Favorites,
   playlists, and "+ New Playlist" would be unreachable on phones.
   ============================================================ */
function openSidebar(){
  sidebarEl.classList.add('open');
  sidebarBackdrop.classList.add('open');
}
function closeSidebar(){
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
}
mobileMenuBtn.addEventListener('click', openSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeSidebar(); });

function switchView(name){
  currentView = name;
  Object.entries(views).forEach(([key, el]) => {
    const active = key === name;
    el.style.display = active ? (key === 'now-playing' ? 'grid' : 'flex') : 'none';
  });
  navLinks.forEach(a => a.classList.toggle('active', a.dataset.view === name));
  if(name === 'browse') renderBrowsePage();
  if(name === 'charts') renderChartsPage();
  if(name === 'favorites') renderFavoritesPage();
  updateTopbarHeading();
}
function updateTopbarHeading(){
  if(currentView === 'now-playing') playlistTitle.textContent = nowPlayingContextLabel || currentPlaylist;
  else if(currentView === 'browse') playlistTitle.textContent = 'Browse';
  else if(currentView === 'charts') playlistTitle.textContent = 'Charts';
  else if(currentView === 'favorites') playlistTitle.textContent = 'Favorites';
}
navLinks.forEach(a => {
  a.addEventListener('click', (e) => { e.preventDefault(); switchView(a.dataset.view); closeSidebar(); });
});

/* ---------------- New Playlist modal ---------------- */
function openNewPlaylistModal(){
  openModal(`
    <div class="modal-header">
      <h3>+ New Playlist</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <div class="modal-label">Playlist name</div>
        <input type="text" class="modal-input" id="mPlaylistName" placeholder="e.g. Rainy Day" maxlength="40">
      </div>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="close">Cancel</button>
        <button class="modal-btn primary" id="mCreatePlaylist">Create</button>
      </div>
    </div>
  `, (card) => {
    const input = card.querySelector('#mPlaylistName');
    input.focus();
    const submit = () => {
      const name = input.value.trim();
      if(!name){ input.classList.add('error'); return; }
      if(playlists[name]){
        input.classList.add('error');
        input.value = '';
        input.placeholder = 'That name is already taken';
        return;
      }
      playlists[name] = [];
      savePlaylists();
      switchPlaylist(name);
      closeModal();
    };
    input.addEventListener('input', () => input.classList.remove('error'));
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
    card.querySelector('#mCreatePlaylist').addEventListener('click', submit);
  });
}

/* ============================================================
   TRANSPORT / LOADING
   ============================================================ */
function loadTrack(shouldPlay){
  const track = currentTrack();
  if(!track) return;
  suppressAutoAdvanceUntil = Date.now() + 400;
  countedThisLoad = false;
  audio.src = track.src;
  trackTitle.textContent = track.title;
  trackArtist.textContent = track.artist;
  renderArtInto(artSlot, track, 88);
  renderQueue();
  renderNotePins();
  updateFavBtnUI();
  updateTopbarHeading();
  if(shouldPlay){ audio.play().catch(()=>{}); }
}

function updateFavBtnUI(){
  const track = currentTrack();
  const active = !!(track && isFavorite(track.id));
  favBtn.classList.toggle('active', active);
  favBtn.innerHTML = (active ? HEART_FILLED : HEART_OUTLINE) + `<span>${active ? 'Favorited' : 'Favorite'}</span>`;
  favBtn.title = active ? 'Remove from Favorites' : 'Add to Favorites';
}
favBtn.addEventListener('click', () => {
  const track = currentTrack();
  if(!track) return;
  toggleFavorite(track.id);
  updateFavBtnUI();
  if(currentView === 'favorites') renderFavoritesPage();
});

function renderQueue(){
  queueList.innerHTML = '';
  const ids = currentQueueIds();
  if(ids.length === 0){
    queueList.appendChild(emptyNote('This playlist is empty — use "+ Add Music" to add a track.'));
    return;
  }
  ids.forEach((id, pos) => {
    const t = getTrackById(id);
    if(!t) return;
    queueList.appendChild(createTrackRowEl(t, {
      isPlayingRow: pos === currentIndex,
      rightContent: pos === currentIndex ? (isPlaying ? '▸ playing' : 'paused') : '',
      onClick: () => { currentIndex = pos; loadTrack(true); }
    }));
  });
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function emptyNote(text){
  const p = document.createElement('p');
  p.className = 'section-empty';
  p.textContent = text;
  return p;
}

const HEART_OUTLINE = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.4C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z"/></svg>';
const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.4C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3.5 8 5H4v2h16V5h-4l-1-1.5H9zM5.5 9l1 12h11l1-12h-13zm4 2h1.4v8H9.5v-8zm4.1 0h1.4v8h-1.4v-8z"/></svg>';

/* Builds one track row — used by the Up Next queue, and by the Browse,
   Charts, and Favorites pages. Keeping this in one place means the heart
   toggle, art, and layout stay consistent everywhere a track is listed. */
function createTrackRowEl(track, opts = {}){
  const { isPlayingRow = false, onClick = null, rightContent = '', rankLabel = null, showHeart = true, showDelete = true } = opts;
  const div = document.createElement('div');
  div.className = 'track-item' + (isPlayingRow ? ' playing' : '');

  if(rankLabel != null){
    const rank = document.createElement('div');
    rank.className = 'chart-rank';
    rank.textContent = rankLabel;
    div.appendChild(rank);
  }

  const mini = document.createElement('div');
  mini.className = 'mini-art';
  renderArtInto(mini, track, 38);
  div.appendChild(mini);

  const meta = document.createElement('div');
  meta.className = 'ti-meta';
  meta.innerHTML = `<div class="t">${escapeHtml(track.title)}</div><div class="a">${escapeHtml(track.artist)}</div>`;
  div.appendChild(meta);

  if(showHeart){
    const heart = document.createElement('button');
    heart.type = 'button';
    const active0 = isFavorite(track.id);
    heart.className = 'heart-btn' + (active0 ? ' active' : '');
    heart.innerHTML = active0 ? HEART_FILLED : HEART_OUTLINE;
    heart.title = active0 ? 'Remove from Favorites' : 'Add to Favorites';
    heart.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(track.id);
      const active = isFavorite(track.id);
      heart.classList.toggle('active', active);
      heart.innerHTML = active ? HEART_FILLED : HEART_OUTLINE;
      heart.title = active ? 'Remove from Favorites' : 'Add to Favorites';
      updateFavBtnUI();
      if(currentView === 'favorites') renderFavoritesPage();
    });
    div.appendChild(heart);
  }

  if(showDelete){
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'row-delete-btn';
    del.innerHTML = TRASH_ICON;
    del.title = 'Delete track';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteTrackModal(track);
    });
    div.appendChild(del);
  }

  const extra = document.createElement('div');
  extra.className = 'dur';
  extra.textContent = rightContent;
  div.appendChild(extra);

  if(onClick) div.addEventListener('click', onClick);
  return div;
}

function spinsLabel(count){
  return `${count} ${count === 1 ? 'spin' : 'spins'}`;
}

/* Starts playback from an ad-hoc list of track IDs that isn't necessarily
   a saved playlist (e.g. "Most Listened" from Browse, or a Chart). The
   real currentPlaylist is left untouched so Add Music etc. keep working;
   only the heading and active queue change. */
function playFromContext(ids, index, label){
  activeOrder = ids;
  currentIndex = index;
  nowPlayingContextLabel = label;
  switchView('now-playing');
  loadTrack(true);
}

function setPlayingUI(playing){
  isPlaying = playing;
  vinyl.classList.toggle('spinning', playing);
  tonearm.classList.toggle('playing', playing);
  statusTag.textContent = playing ? 'now spinning' : 'paused';
  playIcon.innerHTML = playing
    ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  renderQueue();
}

playBtn.addEventListener('click', () => {
  if(!currentTrack()) return;
  if(audio.paused){ audio.play().catch(()=>{}); }
  else { userInitiatedPause = true; audio.pause(); }
});
audio.addEventListener('play', () => setPlayingUI(true));

let advancing = false; // debounce guard so a finish is only handled once
let userInitiatedPause = false;       // true only when the pause button was clicked
let suppressAutoAdvanceUntil = 0;     // swapping audio.src itself can fire a 'pause' — ignore that window
function handleTrackFinish(){
  if(advancing) return;
  advancing = true;
  setTimeout(() => { advancing = false; }, 400);
  if(autoplay) stepTrack(1);
  else setPlayingUI(false);
}
audio.addEventListener('ended', handleTrackFinish);
audio.addEventListener('pause', () => {
  if(userInitiatedPause){ userInitiatedPause = false; setPlayingUI(false); return; }
  if(Date.now() < suppressAutoAdvanceUntil){ setPlayingUI(false); return; }
  // Any other pause — including mismatched-duration files that stall
  // just short of their reported length — is treated as the track finishing.
  handleTrackFinish();
});

function stepTrack(dir){
  const ids = currentQueueIds();
  if(ids.length === 0) return;
  // Circular traversal: always wraps around activeOrder, which is
  // pre-shuffled when shuffle is on, so this never replays the same track.
  currentIndex = (currentIndex + dir + ids.length) % ids.length;
  loadTrack(true);
}
prevBtn.addEventListener('click', () => stepTrack(-1));
nextBtn.addEventListener('click', () => stepTrack(1));

/* ---------------- PROGRESS / SEEK ---------------- */
audio.addEventListener('loadedmetadata', () => {
  seek.max = Math.floor(audio.duration) || 100;
  durTimeEl.textContent = fmt(audio.duration);
  renderNotePins();
});
audio.addEventListener('timeupdate', () => {
  seek.value = audio.currentTime;
  curTimeEl.textContent = fmt(audio.currentTime);
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seekFill.style.width = pct + '%';

  // Count a "spin" once a track has been listened to for a meaningful
  // stretch — half its length, capped at 30s — rather than on every play,
  // so scrubbing back and forth doesn't inflate the count.
  if(!countedThisLoad && audio.duration){
    const threshold = Math.min(30, audio.duration * 0.5);
    if(audio.currentTime >= threshold){
      countedThisLoad = true;
      const track = currentTrack();
      if(track) registerPlay(track.id);
    }
  }
});
seek.addEventListener('input', () => { audio.currentTime = seek.value; });

/* ---------------- VOLUME ---------------- */
vol.addEventListener('input', () => { audio.volume = vol.value / 100; });
audio.volume = 0.7;

/* ---------------- TOGGLES ---------------- */
autoplayToggle.addEventListener('click', () => {
  autoplay = !autoplay;
  autoplayToggle.classList.toggle('on', autoplay);
});
shuffleToggle.addEventListener('click', () => {
  shuffle = !shuffle;
  shuffleToggle.classList.toggle('on', shuffle);
  rpmTag.textContent = shuffle ? '45 RPM' : '33 RPM';
  rebuildActiveOrder(true);
  renderQueue();
});

/* ============================================================
   GROOVE NOTES (signature feature)
   Pin a timestamped note directly onto the seek bar. Hover a
   pin to read it, click a pin to jump straight to that moment.
   Notes persist per track ID in localStorage, so they survive
   reloads and switching tracks/playlists.
   ============================================================ */
noteBtn.addEventListener('click', openGrooveNoteModal);

function openGrooveNoteModal(){
  const track = currentTrack();
  if(!track) return;
  const capturedTime = audio.currentTime;
  const timeLabel = fmt(capturedTime);

  openModal(`
    <div class="modal-header">
      <h3>✎ Pin a Groove Note</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-note-time">
        <div class="dot-pulse"></div>
        ${escapeHtml(timeLabel)} — ${escapeHtml(track.title)}
      </div>
      <div class="modal-field">
        <div class="modal-label">Note</div>
        <input type="text" class="modal-input" id="mNoteText" placeholder="What's happening at this moment?" maxlength="140">
        <div class="modal-char-count" id="mNoteCount">140 characters left</div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="close">Cancel</button>
        <button class="modal-btn primary" id="mPinNote">Pin Note</button>
      </div>
    </div>
  `, (card) => {
    const input = card.querySelector('#mNoteText');
    const count = card.querySelector('#mNoteCount');
    input.focus();
    input.addEventListener('input', () => {
      input.classList.remove('error');
      count.textContent = `${140 - input.value.length} characters left`;
    });
    const submit = () => {
      const text = input.value.trim();
      if(!text){ input.classList.add('error'); return; }
      const list = grooveNotes[track.id] || (grooveNotes[track.id] = []);
      list.push({ time: capturedTime, text });
      saveGrooveNotes();
      renderNotePins();
      closeModal();
    };
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
    card.querySelector('#mPinNote').addEventListener('click', submit);
  });
}

function renderNotePins(){
  document.querySelectorAll('.note-pin').forEach(p => p.remove());
  const track = currentTrack();
  if(!track || !audio.duration) return;
  const list = grooveNotes[track.id] || [];
  list.forEach(n => {
    const pct = (n.time / audio.duration) * 100;
    const pin = document.createElement('div');
    pin.className = 'note-pin';
    pin.style.left = pct + '%';
    pin.innerHTML = `<div class="note-tip">${escapeHtml(fmt(n.time))} — ${escapeHtml(n.text)}</div>`;
    pin.addEventListener('click', (e) => { e.stopPropagation(); audio.currentTime = n.time; });
    seekWrap.appendChild(pin);
  });
}

/* ============================================================
   BROWSE — most/least listened tracks, plus every playlist as a
   clickable card. Clicking a track plays it as an ad-hoc queue
   built from that section; clicking a playlist card switches to it.
   ============================================================ */
function renderBrowsePage(){
  const container = views.browse;
  container.innerHTML = `
    <div class="section-block">
      <h4 class="section-heading">Most Listened</h4>
      <div class="section-list" id="bMostListened"></div>
    </div>
    <div class="section-block">
      <h4 class="section-heading">Least Listened</h4>
      <div class="section-list" id="bLeastListened"></div>
    </div>
    <div class="section-block">
      <h4 class="section-heading">All Playlists</h4>
      <div class="browse-grid" id="bPlaylistGrid"></div>
    </div>
  `;

  const byPlayCountDesc = [...library].sort((a, b) => getPlayCount(b.id) - getPlayCount(a.id));
  const mostListened = byPlayCountDesc.slice(0, 5);
  const leastListened = [...byPlayCountDesc].reverse().slice(0, 5);

  const mostEl = container.querySelector('#bMostListened');
  if(mostListened.length === 0 || getPlayCount(mostListened[0].id) === 0){
    mostEl.appendChild(emptyNote('Nothing played yet — start spinning a track to see it here.'));
  } else {
    const ids = mostListened.map(t => t.id);
    mostListened.forEach((t, i) => {
      mostEl.appendChild(createTrackRowEl(t, {
        rightContent: spinsLabel(getPlayCount(t.id)),
        onClick: () => playFromContext(ids, i, 'Most Listened')
      }));
    });
  }

  const leastEl = container.querySelector('#bLeastListened');
  if(leastListened.length === 0){
    leastEl.appendChild(emptyNote('Add some music to see this list.'));
  } else {
    const ids = leastListened.map(t => t.id);
    leastListened.forEach((t, i) => {
      leastEl.appendChild(createTrackRowEl(t, {
        rightContent: spinsLabel(getPlayCount(t.id)),
        onClick: () => playFromContext(ids, i, 'Least Listened')
      }));
    });
  }

  const gridEl = container.querySelector('#bPlaylistGrid');
  Object.keys(playlists).forEach(name => {
    const ids = playlists[name];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'playlist-card';

    const art = document.createElement('div');
    art.className = 'playlist-card-art';
    const firstTrack = ids.length ? getTrackById(ids[0]) : null;
    if(firstTrack) paintArtInto(art, firstTrack, 64);

    const nameEl = document.createElement('div');
    nameEl.className = 'playlist-card-name';
    nameEl.textContent = name;

    const countEl = document.createElement('div');
    countEl.className = 'playlist-card-count';
    countEl.textContent = `${ids.length} track${ids.length === 1 ? '' : 's'}`;

    card.appendChild(art);
    card.appendChild(nameEl);
    card.appendChild(countEl);
    card.addEventListener('click', () => switchPlaylist(name));
    gridEl.appendChild(card);
  });
}

/* ============================================================
   CHARTS — top played songs (ranked) and a most-used-playlists
   leaderboard, derived from summing each playlist's track spins.
   ============================================================ */
function renderChartsPage(){
  const container = views.charts;
  container.innerHTML = `
    <div class="section-block">
      <h4 class="section-heading">Most-Played Songs</h4>
      <div class="section-list" id="cSongs"></div>
    </div>
    <div class="section-block">
      <h4 class="section-heading">Most-Used Playlists</h4>
      <div class="chart-playlist-list" id="cPlaylists"></div>
    </div>
  `;

  const ranked = [...library]
    .filter(t => getPlayCount(t.id) > 0)
    .sort((a, b) => getPlayCount(b.id) - getPlayCount(a.id))
    .slice(0, 10);

  const songsEl = container.querySelector('#cSongs');
  if(ranked.length === 0){
    songsEl.appendChild(emptyNote("No spins yet — play a track and it'll show up on the chart."));
  } else {
    const ids = ranked.map(t => t.id);
    ranked.forEach((t, i) => {
      songsEl.appendChild(createTrackRowEl(t, {
        rankLabel: i + 1,
        rightContent: spinsLabel(getPlayCount(t.id)),
        onClick: () => playFromContext(ids, i, 'Chart Toppers')
      }));
    });
  }

  const scored = Object.entries(playlists)
    .map(([name, ids]) => ({ name, total: ids.reduce((sum, id) => sum + getPlayCount(id), 0) }))
    .sort((a, b) => b.total - a.total);
  const maxScore = Math.max(1, ...scored.map(p => p.total));

  const plEl = container.querySelector('#cPlaylists');
  if(scored.every(p => p.total === 0)){
    plEl.appendChild(emptyNote('Play something from a playlist to see it climb the chart.'));
  } else {
    scored.forEach((p, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chart-playlist-row';
      row.innerHTML = `
        <span class="chart-rank">${i + 1}</span>
        <span class="cpl-name">${escapeHtml(p.name)}</span>
        <span class="cpl-bar-wrap"><span class="cpl-bar" style="width:${(p.total / maxScore) * 100}%"></span></span>
        <span class="cpl-count">${spinsLabel(p.total)}</span>
      `;
      row.addEventListener('click', () => switchPlaylist(p.name));
      plEl.appendChild(row);
    });
  }
}

/* ============================================================
   FAVORITES — every track you've hearted, anywhere in the app.
   ============================================================ */
function renderFavoritesPage(){
  const container = views.favorites;
  container.innerHTML = `
    <div class="section-block">
      <h4 class="section-heading">Your Favorites</h4>
      <div class="section-list" id="fList"></div>
    </div>
  `;
  const favTracks = library.filter(t => isFavorite(t.id));
  const listEl = container.querySelector('#fList');
  if(favTracks.length === 0){
    listEl.appendChild(emptyNote('Tap the heart on any track to pin it here.'));
    return;
  }
  const ids = favTracks.map(t => t.id);
  favTracks.forEach((t, i) => {
    listEl.appendChild(createTrackRowEl(t, {
      rightContent: spinsLabel(getPlayCount(t.id)),
      onClick: () => playFromContext(ids, i, 'Favorites')
    }));
  });
}

/* ============================================================
   DELETE TRACK
   Removes a track everywhere it could be referenced: every
   playlist, the active queue, favorites, groove notes, and play
   counts. If it was uploaded by the user, its saved file is
   removed from IndexedDB too. Built-in /music tracks are
   remembered as "deleted" so they don't come back on reload.
   ============================================================ */
function openDeleteTrackModal(track){
  openModal(`
    <div class="modal-header">
      <h3>Delete Track</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-filename">🗑 ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}</div>
      <p class="modal-hint">This removes it from every playlist and from Favorites. This can't be undone.</p>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="close">Cancel</button>
        <button class="modal-btn danger" id="mConfirmDeleteTrack">Delete</button>
      </div>
    </div>
  `, (card) => {
    card.querySelector('#mConfirmDeleteTrack').addEventListener('click', () => {
      deleteTrackEverywhere(track.id);
      closeModal();
    });
  });
}

function deleteTrackEverywhere(trackId){
  const wasCurrent = !!(currentTrack() && currentTrack().id === trackId);
  const posInActive = activeOrder.indexOf(trackId);

  Object.keys(playlists).forEach(name => {
    const idx = playlists[name].indexOf(trackId);
    if(idx !== -1) playlists[name].splice(idx, 1);
  });
  savePlaylists();

  if(posInActive !== -1){
    activeOrder.splice(posInActive, 1);
    if(posInActive < currentIndex) currentIndex--;
  }

  const libIdx = library.findIndex(t => t.id === trackId);
  if(libIdx !== -1) library.splice(libIdx, 1);

  favorites.delete(trackId);
  saveFavorites();
  delete grooveNotes[trackId];
  saveGrooveNotes();
  delete playCounts[trackId];
  savePlayCounts();

  const deletedIds = lsGet('deletedTrackIds', []);
  if(!deletedIds.includes(trackId)){
    deletedIds.push(trackId);
    lsSet('deletedTrackIds', deletedIds);
  }

  const userTracks = lsGet('userTracks', []);
  if(userTracks.some(r => r.id === trackId)){
    lsSet('userTracks', userTracks.filter(r => r.id !== trackId));
    idbDeleteFile(`audio-${trackId}`).catch(()=>{});
    idbDeleteFile(`art-${trackId}`).catch(()=>{});
  }

  if(wasCurrent){
    userInitiatedPause = true;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if(activeOrder.length){
      currentIndex = Math.min(currentIndex, activeOrder.length - 1);
      loadTrack(false);
    } else {
      trackTitle.textContent = '—';
      trackArtist.textContent = 'Add some music to get started';
      artSlot.innerHTML = '';
      curTimeEl.textContent = '0:00';
      durTimeEl.textContent = '0:00';
      seek.value = 0;
      seekFill.style.width = '0%';
      document.querySelectorAll('.note-pin').forEach(p => p.remove());
      setPlayingUI(false);
      updateFavBtnUI();
    }
  }

  renderPlaylists();
  renderQueue();
  if(currentView === 'browse') renderBrowsePage();
  if(currentView === 'charts') renderChartsPage();
  if(currentView === 'favorites') renderFavoritesPage();
}

/* ============================================================
   ADD MUSIC — build your own library/playlists
   Upload a local audio file, or paste a direct link to one you
   host somewhere. Optionally attach your own cover image.
   Uploaded files/covers are saved to IndexedDB and metadata is
   saved to localStorage, so they're still there next time you
   open the app — not just for this session.
   ============================================================ */
addMusicBtn.addEventListener('click', openAddMusicSourceStep);

function openAddMusicSourceStep(){
  openModal(`
    <div class="modal-header">
      <h3>+ Add Music</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <button class="modal-choice-btn" id="mChooseUpload" type="button">
        <svg viewBox="0 0 24 24"><path d="M12 2 6.5 7.5l1.4 1.4L11 5.8V16h2V5.8l3.1 3.1 1.4-1.4zM5 18v2h14v-2z"/></svg>
        <div class="mc-text"><b>Upload a file</b><span>Pick an audio file from your device</span></div>
      </button>
      <button class="modal-choice-btn" id="mChooseLink" type="button">
        <svg viewBox="0 0 24 24"><path d="M3.9 12a5.1 5.1 0 0 1 5.1-5.1H12v1.8H9a3.3 3.3 0 1 0 0 6.6H12V17H9A5.1 5.1 0 0 1 3.9 12zm6.1-1h4v2h-4zm3-4.1H16A5.1 5.1 0 0 1 16 17h-3v-1.8h3a3.3 3.3 0 0 0 0-6.6h-3z"/></svg>
        <div class="mc-text"><b>Paste a link</b><span>Add a direct URL to an audio file</span></div>
      </button>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="close">Cancel</button>
      </div>
    </div>
  `, (card) => {
    card.querySelector('#mChooseUpload').addEventListener('click', () => {
      audioFileInput.value = '';
      audioFileInput.onchange = () => {
        const file = audioFileInput.files[0];
        if(file) openAddMusicDetailsStep({ src: URL.createObjectURL(file), name: file.name, file });
      };
      audioFileInput.click();
    });
    card.querySelector('#mChooseLink').addEventListener('click', openAddMusicLinkStep);
  });
}

function openAddMusicLinkStep(){
  openModal(`
    <div class="modal-header">
      <button class="modal-back-btn" data-action="back">←</button>
      <h3 class="centered">Paste a Link</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <div class="modal-label">Direct audio URL</div>
        <input type="text" class="modal-input" id="mLinkUrl" placeholder="https://example.com/song.mp3">
        <div class="modal-hint">Must be a direct link to an audio file — not a YouTube/Spotify page.</div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="back">Back</button>
        <button class="modal-btn primary" id="mLinkNext">Next</button>
      </div>
    </div>
  `, (card) => {
    const input = card.querySelector('#mLinkUrl');
    input.focus();
    const submit = () => {
      const url = input.value.trim();
      if(!url){ input.classList.add('error'); return; }
      openAddMusicDetailsStep({ src: url, name: url.split('/').pop().split('?')[0] || 'Untitled' });
    };
    input.addEventListener('input', () => input.classList.remove('error'));
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
    card.querySelector('#mLinkNext').addEventListener('click', submit);
    card.querySelector('[data-action="back"]').addEventListener('click', openAddMusicSourceStep);
  });
}

function openAddMusicDetailsStep(sourceInfo){
  const defaultTitle = sourceInfo.name.replace(/\.[^/.]+$/, '') || 'Untitled';
  let coverUrl = null;
  let coverFile = null;
  openModal(`
    <div class="modal-header">
      <button class="modal-back-btn" data-action="back">←</button>
      <h3 class="centered">Track Details</h3>
      <button class="modal-close-btn" data-action="close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-filename">🎵 ${escapeHtml(sourceInfo.name)}</div>
      <div class="modal-field">
        <div class="modal-label">Title</div>
        <input type="text" class="modal-input" id="mTitle" value="${escapeHtml(defaultTitle)}">
      </div>
      <div class="modal-field">
        <div class="modal-label">Artist</div>
        <input type="text" class="modal-input" id="mArtist" value="Unknown Artist">
      </div>
      <div class="modal-field">
        <div class="modal-label">Cover image (optional)</div>
        <div class="modal-cover-row" id="mCoverRow">
          <button class="modal-btn ghost" id="mChooseCover" type="button">＋ Add Cover</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn ghost" data-action="back">Back</button>
        <button class="modal-btn primary" id="mAddTrack">Add to Playlist</button>
      </div>
    </div>
  `, (card) => {
    card.querySelector('#mChooseCover').addEventListener('click', () => {
      artFileInput.value = '';
      artFileInput.onchange = () => {
        const f = artFileInput.files[0];
        if(f){
          coverFile = f;
          coverUrl = URL.createObjectURL(f);
          card.querySelector('#mCoverRow').innerHTML =
            `<img src="${coverUrl}"><span style="font-size:12px;color:var(--emerald);">Cover selected ✓</span>`;
        }
      };
      artFileInput.click();
    });
    card.querySelector('#mAddTrack').addEventListener('click', async () => {
      const submitBtn = card.querySelector('#mAddTrack');
      const title = card.querySelector('#mTitle').value.trim() || defaultTitle;
      const artist = card.querySelector('#mArtist').value.trim() || 'Unknown Artist';
      const track = mk(title, artist, sourceInfo.src, coverUrl);
      track._audioFile = sourceInfo.file || null;
      track._artFile = coverFile || null;
      submitBtn.textContent = 'Adding…';
      await finalizeNewTrack(track);
      closeModal();
    });
    card.querySelector('[data-action="back"]').addEventListener('click', openAddMusicSourceStep);
  });
}

async function finalizeNewTrack(track){
  library.push(track);
  playlists[currentPlaylist].push(track.id);
  // If we were playing an ad-hoc queue (e.g. from Browse/Charts) rather than
  // the real current playlist, snap back to the real playlist's order first
  // so the new track lands in the right queue instead of a throwaway one.
  if(nowPlayingContextLabel){
    nowPlayingContextLabel = null;
    rebuildActiveOrder(false);
  }
  activeOrder.push(track.id);
  currentIndex = activeOrder.length - 1;
  renderPlaylists();
  switchView('now-playing');
  loadTrack(true);
  try{
    await persistUserTrack(track);
    savePlaylists();
  }catch(e){
    console.warn('[groove/storage] track added, but could not be saved for next time', e);
  }
}

/* ============================================================
   LIVE WAVEFORM (audio-reactive)
   ============================================================ */
let audioCtx, analyser, dataArray, source;
function setupAnalyser(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  dataArray = new Uint8Array(analyser.frequencyBinCount);
}
audio.addEventListener('play', () => {
  setupAnalyser();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  drawViz();
});
const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d');
function drawViz(){
  if(!isPlaying) return;
  requestAnimationFrame(drawViz);
  if(!analyser) return;
  analyser.getByteFrequencyData(dataArray);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const barW = canvas.width / dataArray.length;
  for(let i=0;i<dataArray.length;i++){
    const h = (dataArray[i]/255) * canvas.height;
    ctx.fillStyle = i % 2 === 0 ? '#e89ab1' : '#d9b871';
    ctx.fillRect(i*barW, canvas.height-h, barW-1, h);
  }
}

/* ============================================================
   INIT
   User-added tracks (and their blobs) load first so the library
   is complete before playlists/queue are built from stored data.
   ============================================================ */
async function initApp(){
  await loadUserTracksIntoLibrary();
  loadPlaylistsFromStorage();
  applyDeletedTracksFilter();
  renderPlaylists();
  rebuildActiveOrder(false);
  switchView('now-playing');
  loadTrack(false);
  setPlayingUI(false);
}
initApp();
