/* script.js
   Single data file that powers the UI and features:
   - Game list rendering
   - Play modal with iframe + fallback
   - Search & sort
   - Favorites (localStorage)
   - Small responsive nav
*/

const GAMES = [
  {
    id: 'drive-mad',
    title: 'Drive Mad',
    thumb: 'assets/Drive-Mad.png',
    url: 'https://nxtcoreee3.github.io/Drive-Mad/',
    desc: 'High speed driving challenge'
  },
  {
    id: 'stickman-hook',
    title: 'Stickman Hook',
    thumb: 'assets/Stickman-Hook.png',
    url: 'https://nxtcoreee3.github.io/Stickman-Hook/',
    desc: 'Swing through levels with perfect timing'
  },
  {
    id: 'geometry-dash-lite',
    title: 'Geometry Dash Lite',
    thumb: 'assets/Geometry-Dash-Lite.png',
    url: 'https://nxtcoreee3.github.io/Geometry-Dash-Lite/',
    desc: 'Rhythm-based platformer — lite'
  }
];

/* --- Utilities --- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* DOM elements */
const gameGrid = document.getElementById('game-grid') || document.getElementById('games-grid');
const quickSearch = document.getElementById('quick-search') || document.getElementById('games-search');
const sortSelect = document.getElementById('sort-select');

/* NAV TOGGLE (mobile) */
document.addEventListener('click', (e) => {
  const toggle = document.querySelector('.nav-toggle');
  if (!toggle) return;
  if (e.target === toggle) {
    const nav = document.getElementById('main-nav');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    nav.style.display = expanded ? '' : 'flex';
  }
});

/* YEAR footers */
['year','year2','year3','year4','year5'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.textContent = (new Date()).getFullYear();
});

/* FAVORITES */
const FAVORITES_KEY = 'flux_favs';
function loadFavs(){ try{ return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }catch{ return []; } }
function saveFavs(arr){ localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr)); }
function isFav(id){ return loadFavs().includes(id); }
function toggleFav(id){
  const favs = loadFavs();
  const idx = favs.indexOf(id);
  if(idx === -1) favs.push(id); else favs.splice(idx,1);
  saveFavs(favs);
}

/* Renderers */
function createCard(game){
  const div = document.createElement('article');
  div.className = 'card';
  div.setAttribute('data-id', game.id);

  div.innerHTML = `
    <img class="thumb" src="${game.thumb}" alt="${game.title} thumbnail" loading="lazy">
    <div class="card-body">
      <h3 class="title">${game.title}</h3>
      <div class="meta">${game.desc || ''}</div>
    </div>
    <div class="card-foot">
      <div style="display:flex;gap:8px;align-items:center">
        <button class="favorite" title="Toggle favorite" aria-pressed="${isFav(game.id)}">${isFav(game.id) ? '★' : '☆'}</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="open-btn" data-url="${game.url}" aria-label="Open in new tab">Open</button>
        <button class="play-btn" data-url="${game.url}" data-title="${game.title}">Play</button>
      </div>
    </div>
  `;

  const favBtn = div.querySelector('.favorite');
  favBtn.addEventListener('click', () => {
    toggleFav(game.id);
    favBtn.textContent = isFav(game.id) ? '★' : '☆';
    favBtn.classList.toggle('active', isFav(game.id));
  });
  favBtn.classList.toggle('active', isFav(game.id));
  favBtn.setAttribute('aria-pressed', String(isFav(game.id)));

  div.querySelector('.open-btn').addEventListener('click', (e) => {
    const url = e.currentTarget.dataset.url;
    window.open(url, '_blank', 'noopener');
  });

  div.querySelector('.play-btn').addEventListener('click', (e) => {
    const url = e.currentTarget.dataset.url;
    const title = e.currentTarget.dataset.title;
    openPlayModal(url, title);
  });

  return div;
}

function renderGames(list){
  const grid = document.getElementById('game-grid') || document.getElementById('games-grid');
  if(!grid) return;
  grid.innerHTML = '';
  list.forEach(g => grid.appendChild(createCard(g)));
}

/* search + sort */
function applyFilters(){
  const query = (quickSearch && quickSearch.value || '').toLowerCase().trim();
  const sort = (sortSelect && sortSelect.value) || 'featured';

  let list = [...GAMES];
  if(query){
    list = list.filter(g => g.title.toLowerCase().includes(query) || (g.desc||'').toLowerCase().includes(query));
  }

  if(sort === 'alpha'){ list.sort((a,b)=> a.title.localeCompare(b.title)); }
  else if(sort === 'recent'){ list = list.slice().reverse(); }

  renderGames(list);
}

if (quickSearch) quickSearch.addEventListener('input', debounce(applyFilters, 160));
if (sortSelect) sortSelect.addEventListener('change', applyFilters);

function debounce(fn, wait=120){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(()=> fn(...args), wait); };
}

document.addEventListener('DOMContentLoaded', () => {
  if(gameGrid) renderGames(GAMES);
  if(quickSearch) quickSearch.addEventListener('input', debounce(applyFilters, 120));
});

/* Play modal code omitted for brevity — same as original working version */
