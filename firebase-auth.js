/* firebase-auth.js
   Handles Firebase Authentication + Firestore favorites + Live visitor counter + Stats button
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHm6nxHzrIGHmWb1W_xDAYwnSoed6oTi4",
  authDomain: "fluxbynxtcoreee3.firebaseapp.com",
  projectId: "fluxbynxtcoreee3",
  storageBucket: "fluxbynxtcoreee3.firebasestorage.app",
  messagingSenderId: "1003023583985",
  appId: "1:1003023583985:web:58cec1087f433e2af97750",
  databaseURL: "https://fluxbynxtcoreee3-default-rtdb.europe-west1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

/* ===================== FIRESTORE HEALTH CHECK ===================== */
export async function checkFirestoreHealth() {
  try {
    const start = Date.now();
    await getDoc(doc(db, 'stats', 'health_ping'));
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ===================== LIVE PRESENCE ===================== */
let _onlineCount = 0;

async function updatePeakOnline(count) {
  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const peakRef = doc(db, 'stats', 'peak');
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(peakRef);
      const current = snap.exists() ? (snap.data().count || 0) : 0;
      if (count > current) {
        tx.set(peakRef, { count, date: new Date().toISOString() });
      }
    });
  } catch (e) { console.warn('Could not update peak:', e); }
}

export async function fetchPeakOnline() {
  try {
    const snap = await getDoc(doc(db, 'stats', 'peak'));
    if (snap.exists()) return snap.data().count;
    return '—';
  } catch { return '—'; }
}

export function initPresence() {
  const sessionId = Math.random().toString(36).slice(2);
  const presenceRef = ref(rtdb, `presence/${sessionId}`);
  const connectedRef = ref(rtdb, '.info/connected');

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      set(presenceRef, { online: true, timestamp: serverTimestamp() });
      onDisconnect(presenceRef).remove();
    }
  });

  onValue(ref(rtdb, 'presence'), (snap) => {
    _onlineCount = snap.exists() ? Object.keys(snap.val()).length : 0;
    const el = document.getElementById('stats-online-count');
    if (el) el.textContent = _onlineCount;
    const badge = document.getElementById('stats-btn-count');
    if (badge) badge.textContent = _onlineCount;
    if (_onlineCount > 0) updatePeakOnline(_onlineCount);
  });
}

/* ===================== GLOBAL FAV COUNT ===================== */
async function fetchGlobalFavCount() {
  try {
    const snap = await getDoc(doc(db, 'stats', 'favourites'));
    return snap.exists() ? (snap.data().total || 0) : 0;
  } catch { return '—'; }
}

/* ===================== STREAK & POINTS ===================== */
export async function trackLoginStreak() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  const today = getSwedishDate();
  const storageKey = `flux_streak_${today}`;
  if (localStorage.getItem(storageKey)) return;

  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const profileRef = doc(db, 'profiles', user.uid);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(profileRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const lastLogin = data.lastLoginDate || '';
      const streak = data.loginStreak || 0;
      const points = data.points || 0;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

      const newStreak = lastLogin === yesterdayStr ? streak + 1 : 1;
      const streakBonus = Math.min((newStreak - 1) * 2, 50);
      const pointsEarned = 10 + streakBonus;

      tx.update(profileRef, {
        loginStreak: newStreak,
        longestStreak: Math.max(newStreak, data.longestStreak || 0),
        lastLoginDate: today,
        points: points + pointsEarned,
        totalPointsEarned: (data.totalPointsEarned || 0) + pointsEarned,
      });
    });
    localStorage.setItem(storageKey, '1');
  } catch (e) { console.warn('Streak tracking failed:', e); }
}

export async function trackTimeOnSite() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  const POINTS_PER_MINUTE = 1;
  const INTERVAL = 5 * 60 * 1000;

  const interval = setInterval(async () => {
    try {
      const minutesElapsed = 5;
      const pointsEarned = minutesElapsed * POINTS_PER_MINUTE;
      const profileRef = doc(db, 'profiles', user.uid);
      const snap = await getDoc(profileRef);
      if (!snap.exists()) { clearInterval(interval); return; }
      await updateDoc(profileRef, {
        points: (snap.data().points || 0) + pointsEarned,
        totalPointsEarned: (snap.data().totalPointsEarned || 0) + pointsEarned,
        timeOnSiteMinutes: (snap.data().timeOnSiteMinutes || 0) + minutesElapsed,
      });
    } catch {}
  }, INTERVAL);

  window.addEventListener('beforeunload', () => clearInterval(interval));
}

export async function giftPoints(targetUid, amount, reason = '') {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Only the owner can gift points.' };
  if (!amount || amount <= 0) return { ok: false, error: 'Invalid amount.' };
  try {
    const profileRef = doc(db, 'profiles', targetUid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) return { ok: false, error: 'Profile not found.' };
    await updateDoc(profileRef, {
      points: (snap.data().points || 0) + amount,
      totalPointsEarned: (snap.data().totalPointsEarned || 0) + amount,
    });
    await sendNotification(targetUid, {
      type: 'points',
      title: `You received ${amount} points! 🎁`,
      body: reason || 'Points gifted by the owner',
      link: 'profile.html',
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function fetchLeaderboard() {
  try {
    const { collection: col, query: q, orderBy: ob, limit: lim, getDocs: gd } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const [pointsSnap, streakSnap] = await Promise.all([
      gd(q(col(db, 'profiles'), ob('points', 'desc'), lim(10))),
      gd(q(col(db, 'profiles'), ob('loginStreak', 'desc'), lim(10))),
    ]);
    return {
      points: pointsSnap.docs.map(d => ({ uid: d.id, ...d.data() })),
      streaks: streakSnap.docs.map(d => ({ uid: d.id, ...d.data() })),
    };
  } catch { return { points: [], streaks: [] }; }
}

/* ===================== GAME PLAY TRACKING ===================== */
export async function trackGamePlay(gameId, gameTitle) {
  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const gameRef = doc(db, 'gamestats', gameId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gameRef);
      if (snap.exists()) {
        tx.update(gameRef, {
          plays: (snap.data().plays || 0) + 1,
          title: gameTitle,
          lastPlayed: new Date().toISOString(),
        });
      } else {
        tx.set(gameRef, {
          plays: 1,
          title: gameTitle,
          firstSeen: new Date().toISOString(),
          lastPlayed: new Date().toISOString(),
        });
      }
    });

    await updateHotGame();
  } catch (e) { console.warn('Game tracking failed:', e); }
}

async function updateHotGame() {
  try {
    const { collection: col, query: q, orderBy: ob, limit: lim, getDocs: gd } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await gd(q(col(db, 'gamestats'), ob('plays', 'desc'), lim(1)));
    if (snap.empty) return;
    const hotGame = snap.docs[0];
    await setDoc(doc(db, 'stats', 'hotgame'), {
      id: hotGame.id,
      title: hotGame.data().title,
      plays: hotGame.data().plays,
      updatedAt: new Date().toISOString(),
    });
  } catch {}
}

export async function fetchHotGame() {
  try {
    const snap = await getDoc(doc(db, 'stats', 'hotgame'));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export async function fetchGameFirstSeen(gameId) {
  try {
    const snap = await getDoc(doc(db, 'gamestats', gameId));
    return snap.exists() ? snap.data().firstSeen : null;
  } catch { return null; }
}

export async function fetchAllGameStats() {
  try {
    const { collection: col, getDocs: gd } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await gd(col(db, 'gamestats'));
    const result = {};
    snap.docs.forEach(d => { result[d.id] = d.data(); });
    return result;
  } catch { return {}; }
}

export async function setGameCompatibility(gameId, gameTitle, compatibility) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Owner only.' };
  try {
    await setDoc(doc(db, 'gamestats', gameId), { compatibility, title: gameTitle }, { merge: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function rateGame(gameId, gameTitle, rating) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to rate.' };
  if (rating < 1 || rating > 5) return { ok: false, error: 'Rating must be 1-5.' };
  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const gameRef = doc(db, 'gamestats', gameId);
    const userRatingRef = doc(db, 'gamestats', gameId, 'ratings', user.uid);

    await runTransaction(db, async (tx) => {
      const gameSnap = await tx.get(gameRef);
      const prevRatingSnap = await tx.get(userRatingRef);

      const prevRating = prevRatingSnap.exists() ? prevRatingSnap.data().rating : null;
      const currentTotal = gameSnap.exists() ? (gameSnap.data().ratingTotal || 0) : 0;
      const currentCount = gameSnap.exists() ? (gameSnap.data().ratingCount || 0) : 0;

      const newTotal = currentTotal - (prevRating || 0) + rating;
      const newCount = prevRating ? currentCount : currentCount + 1;

      tx.set(gameRef, { ratingTotal: newTotal, ratingCount: newCount, title: gameTitle }, { merge: true });
      tx.set(userRatingRef, { rating, uid: user.uid, ratedAt: new Date().toISOString() });
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getUserRating(gameId) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  try {
    const snap = await getDoc(doc(db, 'gamestats', gameId, 'ratings', user.uid));
    return snap.exists() ? snap.data().rating : null;
  } catch { return null; }
}

export async function reportGame(gameId, gameTitle, reason) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to report.' };
  try {
    const { addDoc, collection: col } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await addDoc(col(db, 'gamereports'), {
      gameId, gameTitle, reason,
      reportedBy: user.uid,
      reportedAt: new Date().toISOString(),
      status: 'open',
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function fetchGameReports() {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return [];
  try {
    const { collection: col, query: q, where: w, getDocs: gd } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await gd(q(col(db, 'gamereports'), w('status', '==', 'open')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

export async function dismissGameReport(reportId) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  try {
    await updateDoc(doc(db, 'gamereports', reportId), { status: 'dismissed' });
  } catch {}
}

/* ===================== CURRENTLY PLAYING ===================== */
export async function setCurrentlyPlaying(gameId, gameTitle) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    await updateDoc(doc(db, 'profiles', user.uid), {
      currentlyPlaying: { id: gameId, title: gameTitle, since: new Date().toISOString() }
    });
  } catch {}
}

export async function clearCurrentlyPlaying() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    await updateDoc(doc(db, 'profiles', user.uid), { currentlyPlaying: null });
  } catch {}
}

/* ===================== DAILY VISITOR TRACKING ===================== */
function getSwedishDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

export async function trackDailyVisitor() {
  const today = getSwedishDate();
  const storageKey = `flux_visited_${today}`;
  if (localStorage.getItem(storageKey)) return;

  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const visitorRef = doc(db, 'stats', 'visitors');

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(visitorRef);
      if (snap.exists() && snap.data().date === today) {
        tx.update(visitorRef, { count: increment(1) });
      } else {
        tx.set(visitorRef, { date: today, count: 1 });
      }
    });

    localStorage.setItem(storageKey, '1');
  } catch (e) { console.warn('Could not track visitor:', e); }
}

async function fetchVisitorsToday() {
  try {
    const today = getSwedishDate();
    const snap = await getDoc(doc(db, 'stats', 'visitors'));
    if (snap.exists() && snap.data().date === today) return snap.data().count;
    return 0;
  } catch { return '—'; }
}

/* ===================== DARK MODE ===================== */
export function initDarkMode() {
  const DARK_KEY = 'flux_dark';
  const saved = localStorage.getItem(DARK_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const on = saved !== null ? saved === '1' : prefersDark;
  document.documentElement.classList.toggle('dark', on);
}

export function initStatsButton() {
  if (!document.getElementById('flux-beta-style')) {
    const s = document.createElement('style');
    s.id = 'flux-beta-style';
    s.textContent = `@keyframes beta-pulse { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(1.4);opacity:0} }`;
    document.head.appendChild(s);
  }
  const rightActions = document.querySelector('.right-actions');
  if (!rightActions) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:flex;align-items:center;';

  wrapper.innerHTML = `
    <button id="stats-btn" class="icon-btn" title="Live stats" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:8px 12px;">
      <span style="font-size:15px;">👁️</span>
      <span id="stats-btn-count" style="font-size:13px;font-weight:700;color:var(--accent);">—</span>
    </button>

    <div id="stats-dropdown" style="
      display:none;position:absolute;top:calc(100% + 10px);right:0;
      background:var(--panel);border-radius:14px;
      box-shadow:0 20px 60px rgba(0,0,0,0.15);
      border:1px solid var(--glass-border);width:240px;z-index:300;overflow:hidden;
    ">
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">📊</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--text);">Flux Stats</span>
      </div>
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,0.12);display:flex;align-items:center;justify-content:center;font-size:16px;">👥</div>
        <div style="flex:1;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Online right now</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;animation:pulse-dot 2s infinite;"></span>
            <span id="stats-online-count" style="font-size:20px;font-weight:700;color:var(--text);">—</span>
            <span style="font-size:12px;color:var(--muted);">people</span>
          </div>
          <div id="stats-peak-row" style="margin-top:4px;font-size:11px;color:var(--muted);cursor:pointer;display:none;" title="All-time peak concurrent users">
            🏆 Peak: <span id="stats-peak-count" style="font-weight:700;color:var(--text);">—</span>
          </div>
        </div>
      </div>
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(168,85,247,0.12);display:flex;align-items:center;justify-content:center;font-size:16px;">📅</div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Visitors today</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span id="stats-visitors-today" style="font-size:20px;font-weight:700;color:var(--text);">—</span>
            <span style="font-size:12px;color:var(--muted);">people</span>
          </div>
        </div>
      </div>
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,209,102,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;">★</div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Total favourites</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span id="stats-fav-count" style="font-size:20px;font-weight:700;color:var(--text);">—</span>
            <span style="font-size:12px;color:var(--muted);">across all users</span>
          </div>
        </div>
      </div>
      <div style="padding:14px 16px;display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(58,125,255,0.12);display:flex;align-items:center;justify-content:center;font-size:16px;">🎮</div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">Games available</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span id="stats-game-count" style="font-size:20px;font-weight:700;color:var(--text);">—</span>
            <span style="font-size:12px;color:var(--muted);">games</span>
          </div>
        </div>
      </div>
    </div>
  `;

  rightActions.prepend(wrapper);

  const btn = wrapper.querySelector('#stats-btn');
  const dd = wrapper.querySelector('#stats-dropdown');

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';

    if (!isOpen) {
      document.getElementById('stats-online-count').textContent = _onlineCount;
      document.getElementById('stats-btn-count').textContent = _onlineCount;

      document.getElementById('stats-fav-count').textContent = '…';
      const favCount = await fetchGlobalFavCount();
      document.getElementById('stats-fav-count').textContent = favCount;

      document.getElementById('stats-visitors-today').textContent = '…';
      const visitorsToday = await fetchVisitorsToday();
      document.getElementById('stats-visitors-today').textContent = visitorsToday;

      const peak = await fetchPeakOnline();
      const peakCount = document.getElementById('stats-peak-count');
      const peakRow = document.getElementById('stats-peak-row');
      if (peakCount) peakCount.textContent = peak;
      if (peakRow) peakRow.style.display = 'block';

      const gameCount = window._FLUX_GAME_COUNT || '—';
      document.getElementById('stats-game-count').textContent = gameCount;
    }
  });

  document.addEventListener('click', () => { dd.style.display = 'none'; });
}

/* ===================== AUTH ===================== */
export function signInWithGoogle() { return signInWithPopup(auth, googleProvider); }
export function signInAsGuest() { return signInAnonymously(auth); }
export function signInWithEmail(email, password) { return signInWithEmailAndPassword(auth, email, password); }
export function registerWithEmail(email, password) { return createUserWithEmailAndPassword(auth, email, password); }
export function logOut() { if (window._fluxBanned) return Promise.resolve(); return signOut(auth); }
export function onAuthChange(callback) { onAuthStateChanged(auth, callback); }
export function getCurrentUser() { return auth.currentUser; }

/* ===================== FIRESTORE FAVORITES ===================== */
export async function loadCloudFavs() {
  const user = await new Promise((resolve) => {
    if (auth.currentUser !== null) { resolve(auth.currentUser); return; }
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
  if (!user || user.isAnonymous) return null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return null;
    const favs = snap.data().favorites;
    return Array.isArray(favs) ? favs : null;
  } catch { return null; }
}

export async function syncProfileFavs(favs) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    const profileRef = doc(db, 'profiles', user.uid);
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      await updateDoc(profileRef, { favorites: favs });
    }
  } catch (e) { console.warn('Could not sync favs to profile:', e); }
}

export async function syncProfileRecents(recents) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    const profileRef = doc(db, 'profiles', user.uid);
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      await updateDoc(profileRef, { recentlyPlayed: recents });
    }
  } catch (e) { console.warn('Could not sync recents to profile:', e); }
}

export async function saveCloudFavs(favs) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const userRef = doc(db, 'users', user.uid);
    const profileRef = doc(db, 'profiles', user.uid);
    const statsRef = doc(db, 'stats', 'favourites');

    await runTransaction(db, async (tx) => {
      const prevSnap = await tx.get(userRef);
      const profileSnap = await tx.get(profileRef);
      const statsSnap = await tx.get(statsRef);

      const prevCount = prevSnap.exists() ? (prevSnap.data().favorites || []).length : 0;
      const diff = favs.length - prevCount;

      tx.set(userRef, { favorites: favs }, { merge: true });

      if (profileSnap.exists()) {
        tx.set(profileRef, { favorites: favs }, { merge: true });
      }

      if (diff !== 0) {
        const currentTotal = statsSnap.exists() ? (statsSnap.data().total || 0) : 0;
        tx.set(statsRef, { total: Math.max(0, currentTotal + diff) });
      }
    });
  } catch (e) { console.warn('Could not save favorites:', e); }
}

/* ===================== PROFILE SYSTEM ===================== */
const OWNER_UID  = 'zEy6TO5ligf2um4rssIZs9C9X7f2';
const OWNER_USERNAME = 'nxtcoreee3';

export async function getProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export async function getProfileByUsername(username) {
  try {
    const { collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q = query(collection(db, 'profiles'), where('username', '==', username.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { uid: snap.docs[0].id, ...snap.docs[0].data() };
  } catch { return null; }
}

export async function searchProfiles(term) {
  try {
    const { collection, query, where, orderBy, limit, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const t = term.toLowerCase();
    const q = query(collection(db, 'profiles'), where('username', '>=', t), where('username', '<=', t + '\uf8ff'), limit(10));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch { return []; }
}

export async function isUsernameTaken(username) {
  const p = await getProfileByUsername(username);
  return p !== null;
}

export async function createProfile({ uid, username, displayName, bio, isPrivate, avatarURL }) {
  const { collection, query, where, getDocs, serverTimestamp: fsTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const badges = uid === OWNER_UID ? ['owner', 'admin'] : [];

  let existingFavs = [];
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) existingFavs = userSnap.data().favorites || [];
  } catch {}

  const profileData = {
    uid,
    username: username.toLowerCase(),
    displayName: displayName || username,
    bio: bio || '',
    isPrivate: isPrivate || false,
    avatarURL: avatarURL || '',
    badges,
    followers: uid === OWNER_UID ? [] : [],
    following: uid === OWNER_UID ? [] : [OWNER_UID],
    favorites: existingFavs,
    joinedAt: new Date().toISOString(),
    isBanned: false,
  };
  await setDoc(doc(db, 'profiles', uid), profileData);

  if (uid !== OWNER_UID) {
    try {
      const { arrayUnion } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const ownerRef = doc(db, 'profiles', OWNER_UID);
      const ownerSnap = await getDoc(ownerRef);
      if (ownerSnap.exists()) {
        await updateDoc(ownerRef, { followers: arrayUnion(uid) });
      }
    } catch (e) { console.warn('Could not add to owner followers:', e); }
  }
  return profileData;
}

export async function updateProfile(uid, updates) {
  try {
    await updateDoc(doc(db, 'profiles', uid), updates);
  } catch (e) { console.warn('Profile update failed:', e); }
}

/* ===================== NOTIFICATIONS ===================== */
export async function sendNotification(targetUid, { type, title, body, link = '' }) {
  try {
    const { addDoc, collection: col } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await addDoc(col(db, 'notifications'), {
      uid: targetUid,
      type, title, body, link,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (e) { console.warn('Notification failed:', e); }
}

export function initNotifications() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;

  const rightActions = document.querySelector('.right-actions');
  if (!rightActions || document.getElementById('notif-btn')) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:flex;align-items:center;';
  wrapper.innerHTML = `
    <button id="notif-btn" class="icon-btn" title="Notifications" style="cursor:pointer;position:relative;padding:8px 10px;font-size:16px;">
      🔔
      <span id="notif-badge" style="display:none;position:absolute;top:4px;right:4px;background:#ef4444;color:white;font-size:9px;font-weight:800;padding:1px 4px;border-radius:20px;min-width:14px;text-align:center;line-height:14px;">0</span>
    </button>
    <div id="notif-dropdown" style="display:none;position:absolute;top:calc(100% + 10px);right:0;background:var(--panel);border:1px solid var(--glass-border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.15);width:300px;z-index:300;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;justify-content:space-between;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--text);">🔔 Notifications</span>
        <button id="notif-mark-all" style="background:none;border:none;font-size:11px;color:var(--accent);cursor:pointer;font-weight:700;">Mark all read</button>
      </div>
      <div id="notif-list" style="max-height:340px;overflow-y:auto;"></div>
    </div>
  `;
  rightActions.prepend(wrapper);

  const btn = wrapper.querySelector('#notif-btn');
  const dd = wrapper.querySelector('#notif-dropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) loadNotifications(user.uid);
  });
  document.addEventListener('click', () => { dd.style.display = 'none'; });

  document.getElementById('notif-mark-all').addEventListener('click', async (e) => {
    e.stopPropagation();
    await markAllNotificationsRead(user.uid);
    document.getElementById('notif-badge').style.display = 'none';
    loadNotifications(user.uid);
  });

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(({ collection: col, query: q, where: w, onSnapshot: ons }) => {
    const unreadQ = q(col(db, 'notifications'), w('uid', '==', user.uid), w('read', '==', false));
    ons(unreadQ, (snap) => {
      const badge = document.getElementById('notif-badge');
      if (!badge) return;
      if (snap.size > 0) {
        badge.textContent = snap.size > 9 ? '9+' : snap.size;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    });
  });
}

async function loadNotifications(uid) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Loading...</div>';

  try {
    const { collection: col, query: q, where: w, limit: lim, getDocs: gd } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await gd(q(col(db, 'notifications'), w('uid', '==', uid), lim(20)));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!docs.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">No notifications yet</div>';
      return;
    }

    list.innerHTML = '';
    docs.forEach(n => {
      const icons = { follow: '👤', message: '💬', points: '⭐', system: '📣', report: '⚠️' };
      const timeAgo = getTimeAgo(n.createdAt);
      const item = document.createElement(n.link ? 'a' : 'div');
      if (n.link) { item.href = n.link; item.style.textDecoration = 'none'; }
      item.style.cssText = `display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--glass-border);cursor:pointer;transition:background 0.1s;${!n.read ? 'background:rgba(58,125,255,0.05);' : ''}`;
      item.innerHTML = `
        <span style="font-size:20px;flex-shrink:0;margin-top:2px;">${icons[n.type] || '🔔'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${n.read ? '500' : '700'};color:var(--text);">${n.title}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${n.body}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;">${timeAgo}</div>
        </div>
        ${!n.read ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:4px;"></span>' : ''}
      `;
      item.addEventListener('mouseenter', () => item.style.background = 'var(--bg)');
      item.addEventListener('mouseleave', () => item.style.background = n.read ? '' : 'rgba(58,125,255,0.05)');
      item.addEventListener('click', async () => {
        if (!n.read) await updateDoc(doc(db, 'notifications', n.id), { read: true });
      });
      list.appendChild(item);
    });
    list.lastChild?.style.setProperty('border-bottom', 'none');
  } catch (e) { list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Failed to load</div>'; }
}

async function markAllNotificationsRead(uid) {
  try {
    const { collection: col, query: q, where: w, getDocs: gd, writeBatch: wb } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await gd(q(col(db, 'notifications'), w('uid', '==', uid), w('read', '==', false)));
    const batch = wb(db);
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  } catch {}
}

function getTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ===================== AUTO TEXT CONTRAST ===================== */
export function getContrastColor(hexColor) {
  try {
    const hex = (hexColor || '#3a7dff').replace('#', '');
    if (hex.length < 6) return '#ffffff';
    const r = parseInt(hex.substr(0,2), 16);
    const g = parseInt(hex.substr(2,2), 16);
    const b = parseInt(hex.substr(4,2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#111827' : '#ffffff';
  } catch { return '#ffffff'; }
}

export async function followUser(targetUid) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    const { arrayUnion } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const myRef = doc(db, 'profiles', user.uid);
    const theirRef = doc(db, 'profiles', targetUid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) { console.warn('followUser: follower has no profile doc'); return; }
    const myFollowing = mySnap.data().following || [];
    if (myFollowing.includes(targetUid)) { console.warn('followUser: already following'); return; }
    await updateDoc(myRef, { following: arrayUnion(targetUid) });
    await updateDoc(theirRef, { followers: arrayUnion(user.uid) });
    const myProfile = await getProfile(user.uid);
    if (myProfile) {
      await sendNotification(targetUid, {
        type: 'follow',
        title: `@${myProfile.username} followed you`,
        body: 'You have a new follower!',
        link: `profile.html?user=${myProfile.username}`,
      });
    }
  } catch (e) { console.error('Follow failed:', e.code, e.message); }
}

export async function unfollowUser(targetUid) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  try {
    const { arrayRemove } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const myRef = doc(db, 'profiles', user.uid);
    const theirRef = doc(db, 'profiles', targetUid);
    await updateDoc(myRef, { following: arrayRemove(targetUid) });
    await updateDoc(theirRef, { followers: arrayRemove(user.uid) });
  } catch (e) { console.warn('Unfollow failed:', e); }
}

export async function banUser(targetUid, reason = '') {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  await updateDoc(doc(db, 'profiles', targetUid), { isBanned: true, banReason: reason, bannedAt: new Date().toISOString() });
}

export async function unbanUser(targetUid) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  await updateDoc(doc(db, 'profiles', targetUid), { isBanned: false, banReason: '', bannedAt: null });
}

/* ===================== ROLE SYSTEM ===================== */
export const PREDEFINED_ROLES = [
  { id: 'moderator', label: 'Moderator', emoji: '🛡️', color: '#8b5cf6' },
  { id: 'vip',       label: 'VIP',       emoji: '⭐', color: '#f59e0b' },
  { id: 'verified',  label: 'Verified',  emoji: '✓',  color: '#22c55e' },
  { id: 'helper',    label: 'Helper',    emoji: '🤝', color: '#06b6d4' },
  { id: 'booster',   label: 'Booster',   emoji: '🚀', color: '#ec4899' },
  { id: 'og',        label: 'OG',        emoji: '🏆', color: '#d97706' },
];

export function renderBadges(badges = [], roles = []) {
  const badgeHTML = badges.map(b => {
    if (b === 'owner') return `<span style="display:inline-flex;align-items:center;gap:3px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;">👑 Owner</span>`;
    if (b === 'admin') return `<span style="display:inline-flex;align-items:center;gap:3px;background:#3a7dff;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;">⚡ Admin</span>`;
    return '';
  }).join(' ');

  const roleHTML = (roles || []).map(r => {
    const pre = PREDEFINED_ROLES.find(p => p.id === r.id);
    if (pre) {
      return `<span style="display:inline-flex;align-items:center;gap:3px;background:${pre.color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;">${pre.emoji} ${pre.label}</span>`;
    }
    const color = r.color || '#6b7280';
    return `<span style="display:inline-flex;align-items:center;gap:3px;background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.3px;">${r.emoji || '🏷️'} ${r.label}</span>`;
  }).join(' ');

  return [badgeHTML, roleHTML].filter(Boolean).join(' ');
}

export async function setUserRank(targetUid, rank) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Only the owner can assign ranks.' };
  if (targetUid === OWNER_UID) return { ok: false, error: 'Cannot change owner rank.' };
  try {
    const ref = doc(db, 'profiles', targetUid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, error: 'Profile not found.' };
    const badges = snap.data().badges || [];
    let newBadges = badges.filter(b => b !== 'admin' && b !== 'owner');
    if (rank === 'admin') newBadges = [...newBadges, 'admin'];
    if (rank === 'owner') newBadges = [...newBadges, 'admin', 'owner'];
    await updateDoc(ref, { rank, badges: newBadges });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getUserRank(targetUid) {
  try {
    const snap = await getDoc(doc(db, 'profiles', targetUid));
    return snap.exists() ? (snap.data().rank || 'user') : 'user';
  } catch { return 'user'; }
}

export async function assignRole(targetUid, role) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  const ref = doc(db, 'profiles', targetUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing = snap.data().roles || [];
  if (existing.find(r => r.id === role.id)) return;
  await updateDoc(ref, { roles: [...existing, role] });
}

export async function removeRole(targetUid, roleId) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  const ref = doc(db, 'profiles', targetUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing = snap.data().roles || [];
  await updateDoc(ref, { roles: existing.filter(r => r.id !== roleId) });
}

/* ===================== PROFILE SETUP MODAL ===================== */
export function initProfileSetup(onComplete) {
  onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) return;
    const profile = await getProfile(user.uid);
    if (profile) { if (onComplete) onComplete(profile); return; }

    const modal = document.createElement('div');
    modal.id = 'profile-setup-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(6px);';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:32px;width:100%;max-width:420px;box-shadow:0 30px 80px rgba(0,0,0,0.2);position:relative;max-height:90vh;overflow-y:auto;">
        <button id="psetup-skip" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;" title="Skip for now">✕</button>
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:40px;margin-bottom:8px;">👤</div>
          <h2 style="font-family:'Bebas Neue',sans-serif;font-size:30px;margin:0 0 6px;color:#111827;">Create your Profile</h2>
          <p style="color:#6b7280;font-size:13px;margin:0;">Set up your public Flux profile so others can follow you.</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Username <span style="color:#ef4444;">*</span></label>
            <div style="position:relative;">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:14px;">@</span>
              <input id="psetup-username" type="text" placeholder="yourname" maxlength="20"
                style="width:100%;padding:10px 12px 10px 28px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;">
            </div>
            <div id="psetup-username-msg" style="font-size:11px;margin-top:4px;display:none;"></div>
          </div>

          <div>
            <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Display Name</label>
            <input id="psetup-displayname" type="text" placeholder="${user.displayName || 'Your Name'}" maxlength="30"
              style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;">
          </div>

          <div>
            <label style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">Bio</label>
            <textarea id="psetup-bio" placeholder="Tell people a bit about yourself..." maxlength="120" rows="2"
              style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;outline:none;box-sizing:border-box;resize:none;font-family:inherit;"></textarea>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#f9fafb;border-radius:10px;border:1px solid rgba(0,0,0,0.07);">
            <div>
              <div style="font-size:13px;font-weight:600;color:#111827;">Private Profile</div>
              <div style="font-size:11px;color:#6b7280;">Only followers can see your games & bio</div>
            </div>
            <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;">
              <input type="checkbox" id="psetup-private" style="opacity:0;width:0;height:0;">
              <span id="psetup-toggle-track" style="position:absolute;inset:0;background:#d1d5db;border-radius:12px;transition:background 0.2s;"></span>
              <span id="psetup-toggle-thumb" style="position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
            </label>
          </div>

          <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:#f9fafb;border-radius:10px;border:1px solid rgba(0,0,0,0.07);">
            <input type="checkbox" id="psetup-privacy-agree" style="margin-top:2px;width:16px;height:16px;cursor:pointer;flex-shrink:0;">
            <label for="psetup-privacy-agree" style="font-size:12px;color:#6b7280;cursor:pointer;line-height:1.5;">
              I have read and agree to the <a href="info.html" target="_blank" style="color:var(--accent, #3a7dff);text-decoration:underline;">Privacy Policy</a>. I understand that Flux collects my username, display name, bio, favourited games, recently played games, and follower data. Firebase may also collect usage analytics and authentication data.
            </label>
          </div>

          <p id="psetup-error" style="color:#ef4444;font-size:12px;margin:0;display:none;text-align:center;"></p>

          <button id="psetup-submit" style="padding:12px;background:#3a7dff;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:15px;">Create Profile</button>
          <button id="psetup-skip2" style="padding:10px;background:none;border:none;color:#9ca3af;font-size:13px;cursor:pointer;">Skip for now</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const checkbox = document.getElementById('psetup-private');
    const track = document.getElementById('psetup-toggle-track');
    const thumb = document.getElementById('psetup-toggle-thumb');
    checkbox.addEventListener('change', () => {
      track.style.background = checkbox.checked ? '#3a7dff' : '#d1d5db';
      thumb.style.transform = checkbox.checked ? 'translateX(20px)' : 'translateX(0)';
    });

    let _usernameTimer = null;
    document.getElementById('psetup-username').addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      const msgEl = document.getElementById('psetup-username-msg');
      clearTimeout(_usernameTimer);
      if (val && !/^[a-z0-9_.]{3,20}$/.test(val)) {
        msgEl.textContent = 'Only letters, numbers, _ and . allowed (3-20 chars)';
        msgEl.style.color = '#ef4444'; msgEl.style.display = 'block'; return;
      }
      if (!val) { msgEl.style.display = 'none'; return; }
      msgEl.textContent = 'Checking...'; msgEl.style.color = '#9ca3af'; msgEl.style.display = 'block';
      _usernameTimer = setTimeout(async () => {
        const taken = await isUsernameTaken(val);
        if (taken) { msgEl.textContent = '✗ Username taken'; msgEl.style.color = '#ef4444'; }
        else { msgEl.textContent = '✓ Available'; msgEl.style.color = '#22c55e'; }
      }, 500);
    });

    const closeModal = () => modal.remove();
    document.getElementById('psetup-skip').addEventListener('click', closeModal);
    document.getElementById('psetup-skip2').addEventListener('click', closeModal);

    document.getElementById('psetup-submit').addEventListener('click', async () => {
      const username = document.getElementById('psetup-username').value.trim().toLowerCase();
      const displayName = document.getElementById('psetup-displayname').value.trim() || user.displayName || username;
      const bio = document.getElementById('psetup-bio').value.trim();
      const isPrivate = document.getElementById('psetup-private').checked;
      const errEl = document.getElementById('psetup-error');
      const btn = document.getElementById('psetup-submit');

      errEl.style.display = 'none';
      if (!document.getElementById('psetup-privacy-agree').checked) { errEl.textContent = 'You must agree to the Privacy Policy to create a profile.'; errEl.style.display = 'block'; return; }
      if (!username) { errEl.textContent = 'Username is required.'; errEl.style.display = 'block'; return; }
      if (!/^[a-z0-9_.]{3,20}$/.test(username)) { errEl.textContent = 'Invalid username format.'; errEl.style.display = 'block'; return; }

      btn.textContent = 'Creating...'; btn.disabled = true;

      const taken = await isUsernameTaken(username);
      if (taken) { errEl.textContent = 'That username is already taken.'; errEl.style.display = 'block'; btn.textContent = 'Create Profile'; btn.disabled = false; return; }

      const profile = await createProfile({
        uid: user.uid,
        username,
        displayName,
        bio,
        isPrivate,
        avatarURL: user.photoURL || '',
      });

      localStorage.setItem('flux_policy_accepted', '1');
      localStorage.setItem('flux_cookie_consent', 'accepted');
      closeModal();
      if (onComplete) onComplete(profile);
    });
  });
}

/* ===================== BAN OVERLAY ===================== */
function showBanOverlay(reason, bannedAt) {
  document.getElementById('flux-ban-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'flux-ban-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:#0a0a0a;
    display:flex;align-items:center;justify-content:center;
    font-family:'DM Sans',system-ui,sans-serif;
    padding:20px;box-sizing:border-box;
  `;

  const since = bannedAt
    ? new Date(bannedAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
    : 'Unknown date';

  overlay.innerHTML = `
    <div style="max-width:480px;width:100%;text-align:center;">
      <div style="font-size:72px;margin-bottom:20px;filter:grayscale(1);">🔨</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:52px;color:#ef4444;margin-bottom:8px;letter-spacing:1px;line-height:1;">
        You're Banned
      </div>
      <div style="font-size:14px;color:#6b7280;margin-bottom:28px;">
        Your account has been permanently suspended from Flux.
      </div>
      <div style="background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:20px 24px;margin-bottom:24px;text-align:left;">
        <div style="font-size:11px;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Reason</div>
        <div style="font-size:14px;color:#e5e7eb;line-height:1.6;">${reason || 'No reason provided.'}</div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #1f1f1f;">
          <div style="font-size:11px;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Banned since</div>
          <div style="font-size:13px;color:#9ca3af;">${since}</div>
        </div>
      </div>
      <div style="font-size:13px;color:#4b5563;line-height:1.7;">
        You cannot play games, interact with other users, or access any features.<br>
        If you believe this is a mistake, contact us on
        <a href="https://github.com/nxtcoreee3" target="_blank" rel="noopener" style="color:#3a7dff;text-decoration:none;font-weight:600;">GitHub</a>.
      </div>
      <div style="margin-top:20px;padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;font-size:12px;color:#ef4444;font-weight:600;">
        🔒 Your account is locked. Signing out is disabled.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target.tagName !== 'A') e.stopPropagation();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('flux-ban-overlay')) e.stopImmediatePropagation();
  }, true);

  document.querySelectorAll('.play-btn, .favorite, .rate-btn, button:not(#flux-ban-overlay button)').forEach(el => {
    el.disabled = true;
    el.style.pointerEvents = 'none';
  });

  window._fluxBanned = true;
}

/* ===================== AUTH UI ===================== */
export function initAuthUI(onUserChange) {
  const rightActions = document.querySelector('.right-actions');
  if (!rightActions) return;

  const authBtn = document.createElement('button');
  authBtn.id = 'auth-btn';
  authBtn.className = 'icon-btn';
  authBtn.textContent = 'Sign In';
  authBtn.style.cursor = 'pointer';
  rightActions.prepend(authBtn);

  const userDisplay = document.createElement('div');
  userDisplay.id = 'user-display';
  userDisplay.style.cssText = 'display:none;align-items:center;gap:8px;position:relative;cursor:pointer;';
  userDisplay.innerHTML = `
    <img id="user-avatar" src="" alt="avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid rgba(0,0,0,0.1);display:none;">
    <span id="user-name" style="font-size:13px;font-weight:600;color:var(--text,#111827);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
    <span style="color:var(--muted,#6b7280);font-size:11px;">▾</span>
    <div id="profile-dropdown" style="display:none;position:absolute;top:calc(100% + 10px);right:0;background:var(--panel,#fff);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.2);border:1px solid var(--glass-border,rgba(0,0,0,0.07));width:240px;z-index:300;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));display:flex;align-items:center;gap:10px;">
        <img id="profile-avatar-large" src="" alt="avatar" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid rgba(0,0,0,0.08);display:none;flex-shrink:0;">
        <div id="profile-avatar-placeholder" style="width:38px;height:38px;border-radius:50%;background:#3a7dff;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:15px;flex-shrink:0;">?</div>
        <div style="overflow:hidden;flex:1;min-width:0;">
          <div id="profile-display-name" style="font-weight:700;font-size:13px;color:var(--text,#111827);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
          <div id="profile-email" style="font-size:11px;color:var(--muted,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        </div>
      </div>
      <a id="view-profile-btn" href="profile.html" style="display:none;align-items:center;gap:10px;padding:10px 16px;font-size:13px;color:var(--text,#111827);text-decoration:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));">
        <span>👤</span> My Profile
      </a>
      <button id="spin-wheel-btn" style="width:100%;padding:10px 16px;background:none;border:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));text-align:left;cursor:pointer;font-size:13px;color:var(--text,#111827);display:flex;align-items:center;gap:10px;">
        <span>🎰</span> Spin Wheel <span id="spin-cooldown-label" style="font-size:10px;color:#6b7280;margin-left:auto;"></span>
      </button>
      <button id="gift-points-btn" style="width:100%;padding:10px 16px;background:none;border:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));text-align:left;cursor:pointer;font-size:13px;color:var(--text,#111827);display:flex;align-items:center;gap:10px;">
        <span>🎁</span> Gift Points
      </button>
      <button id="redeem-code-btn" style="width:100%;padding:10px 16px;background:none;border:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));text-align:left;cursor:pointer;font-size:13px;color:var(--text,#111827);display:flex;align-items:center;gap:10px;">
        <span>🎟️</span> Redeem Code
      </button>
      <a href="settings.html" style="display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:13px;color:var(--text,#111827);text-decoration:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));">
        <span>⚙️</span> Settings
      </a>
      <a href="status.html" style="display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:13px;color:var(--text,#111827);text-decoration:none;border-bottom:1px solid var(--glass-border,rgba(0,0,0,0.06));">
        <span>🛰️</span> Status
      </a>
      <button id="sign-out-btn" style="width:100%;padding:10px 16px;background:none;border:none;text-align:left;cursor:pointer;font-size:13px;color:#ef4444;display:flex;align-items:center;gap:10px;">
        <span>🚪</span> Sign Out
      </button>
      <button id="mod-panel-btn" style="display:none;width:100%;padding:10px 16px;background:none;border:none;border-top:1px solid var(--glass-border,rgba(0,0,0,0.06));text-align:left;cursor:pointer;font-size:13px;color:#7c3aed;align-items:center;gap:10px;">
        <span>🛠️</span> Mod Panel
      </button>
    </div>
  `;
  rightActions.prepend(userDisplay);

  const pwModal = document.createElement('div');
  pwModal.id = 'pw-modal';
  pwModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:400;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);backdrop-filter:blur(4px);';
  pwModal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;width:100%;max-width:340px;box-shadow:0 30px 80px rgba(0,0,0,0.15);position:relative;">
      <button id="pw-modal-close" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280;">✕</button>
      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:24px;margin:0 0 16px;color:#111827;">Change Password</h3>
      <input id="pw-new" type="password" placeholder="New password" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;margin-bottom:8px;box-sizing:border-box;outline:none;">
      <input id="pw-confirm" type="password" placeholder="Confirm new password" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;margin-bottom:12px;box-sizing:border-box;outline:none;">
      <button id="pw-save-btn" style="width:100%;padding:10px;background:#3a7dff;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;">Save Password</button>
      <p id="pw-msg" style="font-size:12px;margin:8px 0 0;text-align:center;display:none;"></p>
    </div>
  `;
  document.body.appendChild(pwModal);

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:200;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:32px;width:100%;max-width:380px;box-shadow:0 30px 80px rgba(0,0,0,0.15);position:relative;">
      <button id="auth-modal-close" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:#6b7280;">✕</button>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:28px;margin:0 0 6px;color:#111827;">Welcome to Flux</h2>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">Sign in to save your favorites across devices.</p>
      <button id="google-signin-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;padding:12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;background:#fff;cursor:pointer;font-weight:600;font-size:14px;margin-bottom:12px;">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </button>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="flex:1;height:1px;background:rgba(0,0,0,0.08);"></div>
        <span style="color:#6b7280;font-size:12px;">or</span>
        <div style="flex:1;height:1px;background:rgba(0,0,0,0.08);"></div>
      </div>
      <input id="auth-email" type="email" placeholder="Email" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;margin-bottom:8px;box-sizing:border-box;outline:none;">
      <input id="auth-password" type="password" placeholder="Password" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-size:14px;margin-bottom:12px;box-sizing:border-box;outline:none;">
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="email-signin-btn" style="flex:1;padding:10px;background:#3a7dff;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;">Sign In</button>
        <button id="email-register-btn" style="flex:1;padding:10px;background:transparent;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;color:#6b7280;">Register</button>
      </div>
      <button id="guest-signin-btn" style="width:100%;padding:10px;background:transparent;border:none;color:#6b7280;font-size:13px;cursor:pointer;text-decoration:underline;">Continue as guest</button>
      <p id="auth-error" style="color:#ef4444;font-size:12px;margin:8px 0 0;text-align:center;display:none;"></p>
    </div>
  `;
  document.body.appendChild(modal);

  authBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
  document.getElementById('auth-modal-close').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  document.getElementById('google-signin-btn').addEventListener('click', async () => {
    try { await signInWithGoogle(); modal.style.display = 'none'; }
    catch (err) { showAuthError(err.message); }
  });
  document.getElementById('email-signin-btn').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try { await signInWithEmail(email, password); modal.style.display = 'none'; }
    catch (err) { showAuthError(err.message); }
  });
  document.getElementById('email-register-btn').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try { await registerWithEmail(email, password); modal.style.display = 'none'; }
    catch (err) { showAuthError(err.message); }
  });
  document.getElementById('guest-signin-btn').addEventListener('click', async () => {
    try { await signInAsGuest(); modal.style.display = 'none'; }
    catch (err) { showAuthError(err.message); }
  });
  document.getElementById('sign-out-btn').addEventListener('click', async () => {
    await logOut();
    document.getElementById('profile-dropdown').style.display = 'none';
  });

  document.getElementById('spin-wheel-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').style.display = 'none';
    if (typeof window.openSpinWheel === 'function') window.openSpinWheel();
  });

  document.getElementById('gift-points-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').style.display = 'none';
    if (typeof window.openGiftPoints === 'function') window.openGiftPoints();
  });

  document.getElementById('redeem-code-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').style.display = 'none';
    if (typeof window.openRedeemCode === 'function') window.openRedeemCode();
  });

  userDisplay.addEventListener('click', async (e) => {
    e.stopPropagation();
    const dd = document.getElementById('profile-dropdown');
    const isOpening = dd.style.display === 'none';
    dd.style.display = isOpening ? 'block' : 'none';
    if (isOpening) {
      try {
        const lastSnap = await (async () => {
          const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
          const { getFirestore, doc: fd, getDoc: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
          const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
          const user = getAuth(getApp()).currentUser;
          if (!user) return null;
          const s = await gd(fd(getFirestore(getApp()), 'profiles', user.uid));
          return s.exists() ? s.data().lastSpinAt || null : null;
        })();
        const label = document.getElementById('spin-cooldown-label');
        if (label) {
          if (!lastSnap) { label.textContent = '✨ Ready!'; label.style.color = '#22c55e'; }
          else {
            const diff = new Date(lastSnap).getTime() + 3600000 - Date.now();
            if (diff <= 0) { label.textContent = '✨ Ready!'; label.style.color = '#22c55e'; }
            else {
              const m = Math.floor(diff/60000), s = Math.floor((diff%60000)/1000);
              label.textContent = m+'m '+s+'s'; label.style.color = '#6b7280';
            }
          }
        }
      } catch {}
    }
  });
  document.addEventListener('click', () => {
    const dd = document.getElementById('profile-dropdown');
    if (dd) dd.style.display = 'none';
  });

  document.getElementById('change-password-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').style.display = 'none';
    pwModal.style.display = 'flex';
  });
  document.getElementById('pw-modal-close').addEventListener('click', () => { pwModal.style.display = 'none'; });
  pwModal.addEventListener('click', (e) => { if (e.target === pwModal) pwModal.style.display = 'none'; });

  document.getElementById('pw-save-btn').addEventListener('click', async () => {
    const { updatePassword } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;
    const msg = document.getElementById('pw-msg');
    msg.style.display = 'block';
    if (newPw !== confirmPw) { msg.style.color = '#ef4444'; msg.textContent = 'Passwords do not match.'; return; }
    if (newPw.length < 6) { msg.style.color = '#ef4444'; msg.textContent = 'Password must be at least 6 characters.'; return; }
    try {
      await updatePassword(auth.currentUser, newPw);
      msg.style.color = '#22c55e'; msg.textContent = 'Password updated!';
      setTimeout(() => { pwModal.style.display = 'none'; msg.style.display = 'none'; }, 1500);
    } catch (err) {
      msg.style.color = '#ef4444';
      msg.textContent = err.message.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim();
    }
  });

  const ADMIN_UID = 'zEy6TO5ligf2um4rssIZs9C9X7f2';

  // (Mod modal HTML omitted for brevity — identical to original, no changes needed there)
  // If you need the full mod modal, it is unchanged from your original firebase-auth.js

  function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim();
    el.style.display = 'block';
  }

  onAuthChange(async (user) => {
    if (user) {
      authBtn.style.display = 'none';
      userDisplay.style.display = 'flex';
      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      const profileName = document.getElementById('profile-display-name');
      const profileEmail = document.getElementById('profile-email');
      const profileAvatarLarge = document.getElementById('profile-avatar-large');
      const profilePlaceholder = document.getElementById('profile-avatar-placeholder');
      const modBtn = document.getElementById('mod-panel-btn');

      if (modBtn) modBtn.style.display = user.uid === ADMIN_UID ? 'flex' : 'none';

      if (!user.isAnonymous) {
        const profile = await getProfile(user.uid);

        if (profile && profile.isBanned) {
          showBanOverlay(profile.banReason || '', profile.bannedAt || '');
          if (name) name.textContent = profile.displayName || profile.username || user.displayName || user.email;
          const signOutBtn = document.getElementById('sign-out-btn');
          if (signOutBtn) signOutBtn.style.display = 'none';
          ['spin-wheel-btn','gift-points-btn','redeem-code-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.disabled = true; el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }
          });
          if (onUserChange) onUserChange(user);
          return;
        }

        if (!profile) {
          initProfileSetup((p) => {
            if (p && name) name.textContent = p.displayName || p.username;
            setTimeout(() => { if (typeof window.startFluxTutorial === 'function') window.startFluxTutorial({ isNew: true }); }, 800);
          });
        } else {
          if (name) name.textContent = profile.displayName || profile.username || user.displayName || user.email;
          const profileLinkEl = document.getElementById('view-profile-btn');
          if (profileLinkEl) profileLinkEl.style.display = 'flex';
          if (profileLinkEl) profileLinkEl.href = `profile.html?user=${profile.username}`;
          // Keep Firestore avatarURL in sync with Google photoURL only if no custom avatar is set
          if (user.photoURL && !profile.avatarURL) {
            updateDoc(doc(db, 'profiles', user.uid), { avatarURL: user.photoURL }).catch(() => {});
          }
          setTimeout(() => { if (typeof window.startFluxTutorial === 'function') window.startFluxTutorial({ isNew: false }); }, 1200);
        }

        initNotifications();

        const isDark = document.documentElement.classList.contains('dark');
        const icon = document.getElementById('dropdown-dark-icon');
        const label = document.getElementById('dropdown-dark-label');
        if (icon) icon.textContent = isDark ? '☀️' : '🌙';
        if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';

        try {
          const profileSnap = await getDoc(doc(db, 'profiles', user.uid));
          if (profileSnap.exists()) {
            const betaOn = profileSnap.data().betaMode || false;
            document.documentElement.classList.toggle('beta', betaOn);
            localStorage.setItem('flux_beta', betaOn ? '1' : '0');
            const indicator = document.getElementById('beta-mode-indicator');
            if (indicator) indicator.style.display = betaOn ? 'inline-flex' : 'none';
          }
        } catch {
          const betaLocal = localStorage.getItem('flux_beta') === '1';
          document.documentElement.classList.toggle('beta', betaLocal);
          const indicator = document.getElementById('beta-mode-indicator');
          if (indicator) indicator.style.display = betaLocal ? 'inline-flex' : 'none';
        }
      }

      if (user.isAnonymous) {
        name.textContent = 'Guest';
        avatar.style.display = 'none';
        profileName.textContent = 'Guest';
        profileEmail.textContent = 'Anonymous session';
        profilePlaceholder.textContent = '?';
        profileAvatarLarge.style.display = 'none';
        profilePlaceholder.style.display = 'flex';
        document.getElementById('change-password-btn')?.style && (document.getElementById('change-password-btn').style.display = 'none');
      } else {
        const displayName = user.displayName || user.email;
        name.textContent = displayName;
        profileName.textContent = displayName;
        profileEmail.innerHTML = '';
        if (user.email) {
          const [local, domain] = user.email.split('@');
          profileEmail.innerHTML = `<span id="email-local" style="filter:blur(4px);transition:filter 0.2s;cursor:pointer;" title="Hover to reveal">${local}</span>@${domain}`;
          const localSpan = profileEmail.querySelector('#email-local');
          localSpan.addEventListener('mouseenter', () => localSpan.style.filter = 'none');
          localSpan.addEventListener('mouseleave', () => localSpan.style.filter = 'blur(4px)');
          localSpan.addEventListener('click', (e) => { e.stopPropagation(); localSpan.style.filter = localSpan.style.filter ? '' : 'blur(4px)'; });
        }
        profilePlaceholder.textContent = (user.displayName || user.email || '?')[0].toUpperCase();

        // ── THE FIX: prefer Firestore avatarURL over Google photoURL ──
        const profile = await getProfile(user.uid);
        const avatarSrc = profile?.avatarURL || user.photoURL || '';
        if (avatarSrc) {
          avatar.src = avatarSrc;
          avatar.style.display = 'block';
          profileAvatarLarge.src = avatarSrc;
          profileAvatarLarge.style.display = 'block';
          profilePlaceholder.style.display = 'none';
        } else {
          avatar.style.display = 'none';
          profileAvatarLarge.style.display = 'none';
          profilePlaceholder.style.display = 'flex';
        }

        document.getElementById('change-password-btn')?.style && (document.getElementById('change-password-btn').style.display = 'flex');
      }
    } else {
      authBtn.style.display = '';
      userDisplay.style.display = 'none';
    }
    if (onUserChange) onUserChange(user);
  });
}

/* ===================== SERVER STATUS ===================== */
export function initServerStatus() {
  const ADMIN_UID = 'zEy6TO5ligf2um4rssIZs9C9X7f2';

  const ERROR_CODES = [
    { code: 'ERR_INTERNAL_0x4F2A', trace: 'flux.core.js', func: 'handleRequest' },
    { code: 'ERR_HEAP_OVERFLOW_0x7C1B', trace: 'flux.memory.js', func: 'allocateBuffer' },
    { code: 'ERR_DB_TIMEOUT_0x3E9D', trace: 'flux.database.js', func: 'queryPool' },
    { code: 'ERR_SOCKET_RESET_0x8B44', trace: 'flux.network.js', func: 'openConnection' },
    { code: 'ERR_SEGFAULT_0x1A7F', trace: 'flux.runtime.js', func: 'processEvent' },
    { code: 'ERR_STACK_TRACE_0x5C3E', trace: 'flux.server.js', func: 'processNextTick' },
  ];

  let _countdownInterval = null;
  let _viewerPoll = null;

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(({ onSnapshot, setDoc, doc: firestoreDoc }) => {
    const statusRef = firestoreDoc(db, 'stats', 'server');

    onSnapshot(statusRef, (snap) => {
      if (!snap.exists()) return;
      const { status, message, restoreAt } = snap.data();

      if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
      if (_viewerPoll) { clearInterval(_viewerPoll); _viewerPoll = null; }

      if (status === 'online') {
        document.getElementById('server-status-overlay')?.remove();
        document.getElementById('server-status-banner')?.remove();
        return;
      }

      const applyOverlay = (isAdmin) => {
        const isCrash = status === 'crash';
        const err = ERROR_CODES[Math.floor(Math.random() * ERROR_CODES.length)];
        const lineNo = Math.floor(Math.random() * 900) + 100;
        const viewerCount = _onlineCount || 0;

        if (isAdmin) {
          document.getElementById('server-status-overlay')?.remove();
          let banner = document.getElementById('server-status-banner');
          if (!banner) {
            banner = document.createElement('div');
            banner.id = 'server-status-banner';
            document.body.prepend(banner);
          }
          banner.style.cssText = `
            position:fixed;top:0;left:0;right:0;z-index:9999;
            background:${isCrash ? '#f59e0b' : '#ef4444'};
            color:white;padding:10px 16px;
            display:flex;align-items:center;justify-content:space-between;gap:12px;
            font-size:13px;font-weight:600;flex-wrap:wrap;
          `;
          banner.innerHTML = `
            <span>${isCrash ? '💥' : '🔴'} Server is ${isCrash ? 'crashed' : 'shut down'} — users are blocked. ${restoreAt ? `Restoring in <span id="banner-countdown" style="font-weight:900;">...</span>` : 'No auto-restore set.'}</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <select id="banner-duration" style="padding:5px 8px;border-radius:6px;border:none;font-size:12px;cursor:pointer;background:rgba(255,255,255,0.2);color:white;">
                <option value="0" ${!restoreAt ? 'selected' : ''}>⛔ No limit</option>
                <option value="1">⏱ 1 min</option>
                <option value="2">⏱ 2 min</option>
                <option value="5">⏱ 5 min</option>
                <option value="10">⏱ 10 min</option>
                <option value="30">⏱ 30 min</option>
                <option value="60">⏱ 1 hour</option>
              </select>
              <button id="banner-update-btn" style="padding:5px 10px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);border-radius:6px;color:white;font-size:12px;font-weight:700;cursor:pointer;">Update Timer</button>
              <button id="banner-restore-btn" style="padding:5px 12px;background:white;border:none;border-radius:6px;color:#111;font-size:12px;font-weight:700;cursor:pointer;">✅ Restore</button>
            </div>
          `;

          document.getElementById('banner-restore-btn').addEventListener('click', async () => {
            await setDoc(firestoreDoc(db, 'stats', 'server'), { status: 'online', message: 'online', updatedAt: new Date().toISOString(), restoreAt: null });
          });

          document.getElementById('banner-update-btn').addEventListener('click', async () => {
            const mins = parseInt(document.getElementById('banner-duration').value) || 0;
            const newRestoreAt = mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null;
            await setDoc(firestoreDoc(db, 'stats', 'server'), { status, message, updatedAt: new Date().toISOString(), restoreAt: newRestoreAt });
          });

          if (restoreAt) {
            const bannerCountdown = document.getElementById('banner-countdown');
            const tick = () => {
              const secs = Math.max(0, Math.round((new Date(restoreAt) - Date.now()) / 1000));
              if (bannerCountdown) { const m = Math.floor(secs/60); const s = secs%60; bannerCountdown.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`; }
            };
            tick();
            _countdownInterval = setInterval(tick, 1000);
          }

        } else {
          document.getElementById('server-status-banner')?.remove();
          let overlay = document.getElementById('server-status-overlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'server-status-overlay';
            document.body.appendChild(overlay);
          }

          overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#0f0f0f;overflow-y:auto;';
          overlay.innerHTML = `
            <div style="text-align:center;max-width:500px;padding:32px;width:100%;">
              <img src="assets/holyshititcrashed.gif" alt="" style="max-width:280px;width:100%;border-radius:12px;margin-bottom:24px;">
              <h1 style="font-family:'Bebas Neue',sans-serif;font-size:48px;color:#fff;margin:0 0 12px;">
                ${isCrash ? 'Server Crashed' : 'Servers are currently shut down!'}
              </h1>
              <p style="color:#9ca3af;font-size:15px;line-height:1.6;margin:0 0 16px;">${message}</p>
              <div style="display:inline-flex;align-items:center;gap:8px;background:#1a1a1a;border-radius:20px;padding:6px 16px;margin-bottom:20px;">
                <span style="width:7px;height:7px;border-radius:50%;background:#ef4444;display:inline-block;animation:pulse-dot 2s infinite;"></span>
                <span id="overlay-viewer-count" style="font-size:13px;color:#9ca3af;">${viewerCount} ${viewerCount === 1 ? 'person' : 'people'} watching</span>
              </div>
              ${isCrash ? `
              <div style="background:#1f1f1f;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:12px;color:#ef4444;text-align:left;margin-bottom:16px;">
                <div style="color:#6b7280;margin-bottom:4px;">// ${err.code}</div>
                Error: ECONNREFUSED — ${err.code}<br>
                at ${err.func} (${err.trace}:${lineNo}:12)<br>
                at processNextTick (internal/process/next_tick.js:68:5)<br>
                at runMicrotasks (&lt;anonymous&gt;)
              </div>` : ''}
              ${restoreAt ? `<div style="color:#6b7280;font-size:13px;margin-bottom:16px;">Attempting to restore in <span id="overlay-countdown" style="color:#fff;font-weight:700;">...</span></div>` : ''}
              <p style="color:#4b5563;font-size:12px;margin-top:4px;">© Flux ${new Date().getFullYear()}</p>
            </div>
          `;

          const viewerEl = document.getElementById('overlay-viewer-count');
          _viewerPoll = setInterval(() => {
            if (!document.getElementById('server-status-overlay')) { clearInterval(_viewerPoll); return; }
            if (viewerEl) viewerEl.textContent = `${_onlineCount || 0} ${(_onlineCount || 0) === 1 ? 'person' : 'people'} watching`;
          }, 5000);

          if (restoreAt) {
            const countdownEl = document.getElementById('overlay-countdown');
            const tick = () => {
              const secs = Math.max(0, Math.round((new Date(restoreAt) - Date.now()) / 1000));
              if (!countdownEl || !document.getElementById('server-status-overlay')) { clearInterval(_countdownInterval); return; }
              const m = Math.floor(secs / 60); const s = secs % 60;
              countdownEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
            };
            tick();
            _countdownInterval = setInterval(tick, 1000);
          }
        }
      };

      if (auth.currentUser !== undefined) {
        applyOverlay(auth.currentUser?.uid === ADMIN_UID);
      } else {
        onAuthStateChanged(auth, (user) => {
          applyOverlay(user?.uid === ADMIN_UID);
        }, { once: true });
      }
    });
  });
}

/* ===================== BROADCAST ===================== */
export function initBroadcast() {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async ({ onSnapshot, getDoc, doc: firestoreDoc }) => {
    let _lastBroadcastId = null;
    const broadcastRef = firestoreDoc(db, 'stats', 'broadcast');

    try {
      const initial = await getDoc(broadcastRef);
      if (initial.exists()) _lastBroadcastId = initial.data().id || null;
    } catch {}

    function showBroadcastToast(message) {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.style.cssText = `
        background:#111827;border-radius:12px;padding:14px 18px;
        box-shadow:0 8px 30px rgba(0,0,0,0.3);border-left:4px solid #3a7dff;
        display:flex;flex-direction:column;gap:4px;
        pointer-events:all;max-width:300px;
        opacity:0;transform:translateY(8px);transition:all 0.25s ease;
      `;
      toast.innerHTML = `
        <span style="font-size:11px;font-weight:700;color:#3a7dff;text-transform:uppercase;letter-spacing:0.5px;">📣 Admin Broadcast</span>
        <span style="font-size:14px;color:#fff;font-weight:500;">${message}</span>
      `;
      container.appendChild(toast);
      requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
      setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)';
        setTimeout(() => toast.remove(), 250);
      }, 5000);
    }

    onSnapshot(broadcastRef, (snap) => {
      if (!snap.exists()) return;
      const { message, id } = snap.data();
      if (!message || id === _lastBroadcastId) return;
      _lastBroadcastId = id;
      showBroadcastToast(message);
    });

    setInterval(async () => {
      try {
        const snap = await getDoc(broadcastRef);
        if (!snap.exists()) return;
        const { message, id } = snap.data();
        if (!message || id === _lastBroadcastId) return;
        _lastBroadcastId = id;
        showBroadcastToast(message);
      } catch {}
    }, 1500);
  });
}

/* ===================== CHAOS ===================== */
export function initChaos() {
  const COLOURS = ['#3a7dff','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316'];
  const FONTS = ['Comic Sans MS', 'Impact', 'Courier New', 'Georgia', 'Papyrus', 'Arial Black'];
  let _chaosSheet = null;
  let _confettiInterval = null;
  let _crazyInterval = null;
  let _activeEffects = new Set();

  function getSheet() {
    if (!_chaosSheet) {
      const style = document.createElement('style');
      document.head.appendChild(style);
      _chaosSheet = style.sheet;
    }
    return _chaosSheet;
  }

  function clearRules() {
    const sheet = getSheet();
    while (sheet.cssRules.length) sheet.deleteRule(0);
  }

  function applyEffects(effects) {
    const prev = _activeEffects;
    _activeEffects = new Set(effects);

    clearRules();
    if (_confettiInterval) { clearInterval(_confettiInterval); _confettiInterval = null; }
    if (_crazyInterval) { clearInterval(_crazyInterval); _crazyInterval = null; }
    document.documentElement.style.transform = '';
    document.documentElement.style.transition = '';
    document.querySelectorAll('.chaos-confetti').forEach(el => el.remove());

    if (_activeEffects.has('shake')) {
      getSheet().insertRule(`@keyframes chaos-shake { 0%,100%{transform:translate(0,0) rotate(0deg)} 20%{transform:translate(-5px,3px) rotate(-1deg)} 40%{transform:translate(5px,-4px) rotate(1deg)} 60%{transform:translate(-4px,5px) rotate(-0.5deg)} 80%{transform:translate(4px,-3px) rotate(0.5deg)} }`, 0);
      getSheet().insertRule(`html { animation: chaos-shake 0.35s infinite !important; transform-origin: center center !important; }`, 1);
    }

    if (_activeEffects.has('flip')) {
      document.documentElement.style.transform = 'rotate(180deg)';
      document.documentElement.style.transition = 'transform 0.6s ease';
    }

    if (_activeEffects.has('colour')) {
      const col = COLOURS[Math.floor(Math.random() * COLOURS.length)];
      getSheet().insertRule(`:root { --accent: ${col} !important; --primary: ${col} !important; }`, 0);
      getSheet().insertRule(`a, button, .play-btn { background-color: ${col} !important; border-color: ${col} !important; }`, 1);
    }

    if (_activeEffects.has('crazytext')) {
      const randomise = () => {
        document.querySelectorAll('h1,h2,h3,.title,.card-body').forEach(el => {
          el.style.fontFamily = FONTS[Math.floor(Math.random() * FONTS.length)];
          el.style.fontSize = `${Math.floor(Math.random() * 16) + 10}px`;
          el.style.color = COLOURS[Math.floor(Math.random() * COLOURS.length)];
          el.style.transform = `rotate(${Math.floor(Math.random() * 10) - 5}deg)`;
        });
      };
      randomise();
      _crazyInterval = setInterval(randomise, 800);
    } else {
      if (prev.has('crazytext')) {
        document.querySelectorAll('h1,h2,h3,.title,.card-body').forEach(el => {
          el.style.fontFamily = ''; el.style.fontSize = ''; el.style.color = ''; el.style.transform = '';
        });
      }
    }

    if (_activeEffects.has('confetti')) {
      const spawnConfetti = () => {
        const el = document.createElement('div');
        el.className = 'chaos-confetti';
        const size = Math.random() * 10 + 6;
        el.style.cssText = `
          position:fixed;top:-20px;left:${Math.random()*100}vw;
          width:${size}px;height:${size}px;border-radius:${Math.random()>0.5?'50%':'2px'};
          background:${COLOURS[Math.floor(Math.random()*COLOURS.length)]};
          z-index:99998;pointer-events:none;
          animation:chaos-fall ${Math.random()*2+2}s linear forwards;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
      };
      getSheet().insertRule(`@keyframes chaos-fall { to { transform: translateY(110vh) rotate(720deg); opacity:0; } }`, 0);
      spawnConfetti();
      _confettiInterval = setInterval(spawnConfetti, 120);
    }

    if (_activeEffects.has('forceiframe')) {
      getSheet().insertRule(`.open-btn { display: none !important; }`, 0);
    }
  }

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(({ onSnapshot, getDoc, doc: firestoreDoc }) => {
    const chaosRef = firestoreDoc(db, 'stats', 'chaos');

    onSnapshot(chaosRef, (snap) => {
      const effects = snap.exists() ? (snap.data().effects || []) : [];
      applyEffects(effects);
    });

    setInterval(async () => {
      try {
        const snap = await getDoc(chaosRef);
        const effects = snap.exists() ? (snap.data().effects || []) : [];
        const effectsKey = [...effects].sort().join(',');
        const activeKey = [..._activeEffects].sort().join(',');
        if (effectsKey !== activeKey) applyEffects(effects);
      } catch {}
    }, 3000);
  });
}

/* ===================== JUMPSCARE ===================== */
export function initJumpscare() {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async ({ onSnapshot, getDoc, doc: firestoreDoc }) => {
    let _lastJumpscareId = null;
    const jumpscareRef = firestoreDoc(db, 'stats', 'jumpscare');

    try {
      const initial = await getDoc(jumpscareRef);
      if (initial.exists()) _lastJumpscareId = initial.data().id || null;
    } catch {}

    function triggerJumpscare() {
      const isAdmin = auth.currentUser?.uid === 'zEy6TO5ligf2um4rssIZs9C9X7f2';
      if (document.getElementById('server-status-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'jumpscare-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      overlay.innerHTML = `
        <img src="assets/jumpscare.png" alt="" style="max-width:100vw;max-height:100vh;object-fit:contain;animation:jumpscare-pop 0.1s ease-out;">
        ${isAdmin ? '<div style="position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#22c55e;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;white-space:nowrap;pointer-events:none;">👁 Admin Preview</div>' : ''}
      `;
      const style = document.createElement('style');
      style.textContent = `@keyframes jumpscare-pop { 0%{transform:scale(0.5);opacity:0} 100%{transform:scale(1);opacity:1} }`;
      document.head.appendChild(style);
      document.body.appendChild(overlay);

      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(); osc.stop(ctx.currentTime + 0.4);
      } catch {}

      const dismiss = () => { overlay.remove(); style.remove(); };
      overlay.addEventListener('click', dismiss);
      setTimeout(dismiss, isAdmin ? 2000 : 2500);
    }

    onSnapshot(jumpscareRef, (snap) => {
      if (!snap.exists()) return;
      const { id } = snap.data();
      if (id === _lastJumpscareId) return;
      _lastJumpscareId = id;
      triggerJumpscare();
    });

    setInterval(async () => {
      try {
        const snap = await getDoc(jumpscareRef);
        if (!snap.exists()) return;
        const { id } = snap.data();
        if (id === _lastJumpscareId) return;
        _lastJumpscareId = id;
        triggerJumpscare();
      } catch {}
    }, 1500);
  });
}

/* ===================== GAME DETAIL & AI DESCRIPTION ===================== */
export async function fetchGameDetail(gameId) {
  try {
    const snap = await getDoc(doc(db, 'gamestats', gameId));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

export async function getAiGameDescription(game) {
  try {
    const snap = await getDoc(doc(db, 'gamestats', game.id));
    if (snap.exists() && snap.data().aiDesc) return snap.data().aiDesc;
  } catch {}
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: `Write a 3-4 sentence engaging game description for "${game.title}" for a browser game portal. The short description is: "${game.desc}". Write in second person ("you"), be specific about gameplay mechanics, and make it exciting. Return only the description text, no quotes or extra formatting.` }]
      })
    });
    if (!res.ok) return game.desc;
    const data = await res.json();
    const aiDesc = data.content?.[0]?.text?.trim() || game.desc;
    try { await setDoc(doc(db, 'gamestats', game.id), { aiDesc }, { merge: true }); } catch {}
    return aiDesc;
  } catch { return game.desc; }
}

/* ===================== REVIEWS ===================== */
export async function getGameReviews(gameId) {
  try {
    const { collection: col, query: q, orderBy: ob, getDocs: gd, limit: lim } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await gd(q(col(db, 'gamestats', gameId, 'reviews'), ob('createdAt', 'desc'), lim(50)));
    return await Promise.all(snap.docs.map(async d => {
      const data = { id: d.id, ...d.data() };
      try {
        const cSnap = await gd(q(col(db, 'gamestats', gameId, 'reviews', d.id, 'comments'), ob('createdAt', 'asc'), lim(20)));
        data.comments = cSnap.docs.map(c => ({ id: c.id, ...c.data() }));
      } catch { data.comments = []; }
      return data;
    }));
  } catch { return []; }
}

export async function submitReview(gameId, gameTitle, rating, comment) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to leave a review.' };
  if (rating < 1 || rating > 5) return { ok: false, error: 'Rating must be 1–5.' };
  if (comment && comment.length > 500) return { ok: false, error: 'Review too long (max 500 chars).' };
  try {
    const { runTransaction, collection: col, getDocs: gd, query: q, where: w, addDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const profile = await getProfile(user.uid);
    const reviewsCol = col(db, 'gamestats', gameId, 'reviews');
    const gameRef = doc(db, 'gamestats', gameId);
    const existing = await gd(q(reviewsCol, w('uid', '==', user.uid)));
    if (!existing.empty) {
      const reviewDoc = existing.docs[0];
      const old = reviewDoc.data();
      await runTransaction(db, async tx => {
        const gSnap = await tx.get(gameRef);
        const total = (gSnap.data()?.ratingTotal || 0) - old.rating + rating;
        tx.update(reviewDoc.ref, { rating, comment: comment || '', updatedAt: new Date().toISOString() });
        tx.set(gameRef, { ratingTotal: total }, { merge: true });
      });
      return { ok: true };
    }
    await runTransaction(db, async tx => {
      const gSnap = await tx.get(gameRef);
      tx.set(gameRef, { ratingTotal: (gSnap.data()?.ratingTotal||0)+rating, ratingCount: (gSnap.data()?.ratingCount||0)+1, title: gameTitle }, { merge: true });
    });
    await addDoc(reviewsCol, { uid: user.uid, username: profile?.username||'Anonymous', displayName: profile?.displayName||user.displayName||'Anonymous', avatarURL: profile?.avatarURL||user.photoURL||'', rating, comment: comment||'', likes: [], createdAt: new Date().toISOString() });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function addReviewComment(gameId, reviewId, comment) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to comment.' };
  if (!comment?.trim() || comment.length > 300) return { ok: false, error: 'Invalid comment.' };
  try {
    const { addDoc, collection: col } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const profile = await getProfile(user.uid);
    await addDoc(col(db, 'gamestats', gameId, 'reviews', reviewId, 'comments'), { uid: user.uid, username: profile?.username||'Anonymous', displayName: profile?.displayName||user.displayName||'Anonymous', avatarURL: profile?.avatarURL||user.photoURL||'', comment: comment.trim(), createdAt: new Date().toISOString() });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function likeReview(gameId, reviewId) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false };
  try {
    const { arrayUnion, arrayRemove } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const ref = doc(db, 'gamestats', gameId, 'reviews', reviewId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false };
    const liked = (snap.data().likes||[]).includes(user.uid);
    await updateDoc(ref, { likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid) });
    return { ok: true, liked: !liked };
  } catch { return { ok: false }; }
}

export async function deleteReview(gameId, reviewId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const ref = doc(db, 'gamestats', gameId, 'reviews', reviewId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    if (snap.data().uid !== user.uid && user.uid !== 'zEy6TO5ligf2um4rssIZs9C9X7f2') return;
    await deleteDoc(ref);
    const gSnap = await getDoc(doc(db, 'gamestats', gameId));
    if (gSnap.exists()) {
      const r = snap.data().rating||0;
      await updateDoc(doc(db, 'gamestats', gameId), { ratingTotal: Math.max(0,(gSnap.data().ratingTotal||0)-r), ratingCount: Math.max(0,(gSnap.data().ratingCount||0)-1) });
    }
  } catch {}
}

/* ===================== GAME UNLOCK SYSTEM ===================== */
export async function fetchGamePricing() {
  try { const snap = await getDoc(doc(db, 'stats', 'gamePricing')); return snap.exists() ? snap.data() : {}; } catch { return {}; }
}

export async function setGamePrice(gameId, price, discount=0, discountExpiry=null) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Admin only.' };
  try {
    const snap = await getDoc(doc(db, 'stats', 'gamePricing'));
    const current = snap.exists() ? snap.data() : {};
    current[gameId] = { price: parseInt(price)||0, discount: parseInt(discount)||0, discountExpiry: discountExpiry||null };
    await setDoc(doc(db, 'stats', 'gamePricing'), current);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getUnlockedGames() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return [];
  try { const snap = await getDoc(doc(db, 'profiles', user.uid)); return snap.exists() ? (snap.data().unlockedGames||[]) : []; } catch { return []; }
}

export async function unlockGame(gameId, cost) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to unlock games.' };
  try {
    const { runTransaction } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const profileRef = doc(db, 'profiles', user.uid);
    let result = {};
    await runTransaction(db, async tx => {
      const snap = await tx.get(profileRef);
      if (!snap.exists()) { result = { ok: false, error: 'Profile not found.' }; return; }
      const data = snap.data();
      const points = data.points||0, unlocked = data.unlockedGames||[];
      if (unlocked.includes(gameId)) { result = { ok: true }; return; }
      if (points < cost) { result = { ok: false, error: `Need ${cost-points} more points.` }; return; }
      tx.update(profileRef, { points: points-cost, unlockedGames: [...unlocked, gameId] });
      result = { ok: true, newBalance: points-cost };
    });
    return result;
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ===================== SPIN WHEEL ===================== */
export const SPIN_SEGMENTS = [
  { label: '10 pts',  points: 10,  weight: 40, color: '#6b7280' },
  { label: '25 pts',  points: 25,  weight: 25, color: '#3a7dff' },
  { label: '50 pts',  points: 50,  weight: 15, color: '#22c55e' },
  { label: '100 pts', points: 100, weight: 10, color: '#f59e0b' },
  { label: '250 pts', points: 250, weight: 7,  color: '#8b5cf6' },
  { label: 'Try Again', points: 0, weight: 2,  color: '#ef4444' },
  { label: '🎰 500!', points: 500, weight: 1,  color: '#ec4899' },
];

export async function getLastSpin() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return null;
  try { const snap = await getDoc(doc(db, 'profiles', user.uid)); return snap.exists() ? snap.data().lastSpinAt||null : null; } catch { return null; }
}

export async function spinWheel() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to spin.' };
  try {
    const { runTransaction } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const profileRef = doc(db, 'profiles', user.uid);
    let result = {};
    await runTransaction(db, async tx => {
      const snap = await tx.get(profileRef);
      if (!snap.exists()) { result = { ok: false, error: 'No profile found.' }; return; }
      const lastSpin = snap.data().lastSpinAt||null;
      if (lastSpin && Date.now() - new Date(lastSpin).getTime() < 3600000) {
        result = { ok: false, error: 'cooldown', nextSpin: new Date(new Date(lastSpin).getTime()+3600000).toISOString() }; return;
      }
      const total = SPIN_SEGMENTS.reduce((s,seg)=>s+seg.weight,0);
      let rand = Math.random()*total, chosen = SPIN_SEGMENTS[0];
      for (const seg of SPIN_SEGMENTS) { rand -= seg.weight; if (rand <= 0) { chosen = seg; break; } }
      const pts = snap.data().points||0;
      const updates = { lastSpinAt: new Date().toISOString() };
      if (chosen.points > 0) { updates.points = pts+chosen.points; updates.totalPointsEarned = (snap.data().totalPointsEarned||0)+chosen.points; }
      tx.update(profileRef, updates);
      result = { ok: true, segment: chosen, newBalance: pts+chosen.points };
    });
    return result;
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ===================== USER POINT GIFTING ===================== */
export async function giftPointsToUser(targetUsername, amount) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to gift points.' };
  if (!amount || amount < 1 || amount > 10000) return { ok: false, error: 'Amount must be 1–10,000.' };
  try {
    const { runTransaction } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const target = await getProfileByUsername(targetUsername);
    if (!target) return { ok: false, error: `User @${targetUsername} not found.` };
    if (target.uid === user.uid) return { ok: false, error: 'Cannot gift yourself.' };
    const myRef = doc(db, 'profiles', user.uid), theirRef = doc(db, 'profiles', target.uid);
    let result = {};
    await runTransaction(db, async tx => {
      const [my, their] = await Promise.all([tx.get(myRef), tx.get(theirRef)]);
      if (!my.exists()) { result = { ok: false, error: 'Your profile not found.' }; return; }
      const pts = my.data().points||0;
      const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Stockholm'});
      const gifted = my.data().lastGiftDate===today ? (my.data().dailyGiftedPoints||0) : 0;
      if (pts < amount) { result = { ok: false, error: `Not enough points. You have ${pts}.` }; return; }
      if (gifted+amount > 500) { result = { ok: false, error: `Daily cap 500 pts. Already gifted ${gifted} today.` }; return; }
      tx.update(myRef, { points: pts-amount, dailyGiftedPoints: gifted+amount, lastGiftDate: today });
      tx.update(theirRef, { points: (their.data().points||0)+amount, totalPointsEarned: (their.data().totalPointsEarned||0)+amount });
      result = { ok: true, newBalance: pts-amount };
    });
    if (result.ok) {
      const me = await getProfile(user.uid);
      await sendNotification(target.uid, { type:'points', title:`🎁 @${me?.username||'Someone'} gifted you ${amount} pts!`, body:'Check your profile balance.', link:'profile.html' });
    }
    return result;
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ===================== REWARD CODES ===================== */
export async function createRewardCode(code, type, value, options = {}) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Admin only.' };
  try {
    const { setDoc: sd, doc: d } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await sd(d(db, 'rewardCodes', code.toUpperCase().trim()), {
      code: code.toUpperCase().trim(),
      type, value,
      description: options.description || '',
      maxUses: options.maxUses || 0,
      uses: 0,
      redeemedBy: [],
      expiresAt: options.expiresAt || null,
      createdAt: new Date().toISOString(),
      createdBy: user.uid,
      active: true,
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function redeemCode(codeStr) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, error: 'Sign in to redeem codes.' };
  const code = codeStr.toUpperCase().trim();
  if (!code) return { ok: false, error: 'Enter a code.' };
  try {
    const { runTransaction, doc: d } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const codeRef = d(db, 'rewardCodes', code);
    const profileRef = d(db, 'profiles', user.uid);
    let result = {};
    await runTransaction(db, async tx => {
      const [codeSnap, profileSnap] = await Promise.all([tx.get(codeRef), tx.get(profileRef)]);
      if (!codeSnap.exists()) { result = { ok: false, error: 'Invalid code.' }; return; }
      const c = codeSnap.data();
      if (!c.active) { result = { ok: false, error: 'This code is no longer active.' }; return; }
      if (c.expiresAt && new Date(c.expiresAt) < new Date()) { result = { ok: false, error: 'This code has expired.' }; return; }
      if (c.maxUses > 0 && c.uses >= c.maxUses) { result = { ok: false, error: 'This code has reached its maximum uses.' }; return; }
      if ((c.redeemedBy || []).includes(user.uid)) { result = { ok: false, error: 'You have already redeemed this code.' }; return; }
      if (!profileSnap.exists()) { result = { ok: false, error: 'Profile not found.' }; return; }
      const profile = profileSnap.data();
      const profileUpdate = {};
      if (c.type === 'points') {
        profileUpdate.points = (profile.points || 0) + Number(c.value);
        profileUpdate.totalPointsEarned = (profile.totalPointsEarned || 0) + Number(c.value);
        result = { ok: true, type: 'points', value: Number(c.value), message: `🎉 You got ${c.value} points!` };
      } else if (c.type === 'game') {
        const unlocked = profile.unlockedGames || [];
        if (unlocked.includes(c.value)) { result = { ok: false, error: 'You already own this game.' }; return; }
        profileUpdate.unlockedGames = [...unlocked, c.value];
        result = { ok: true, type: 'game', value: c.value, message: `🎮 Game unlocked!` };
      } else if (c.type === 'spins') {
        profileUpdate.bonusSpins = (profile.bonusSpins || 0) + Number(c.value);
        result = { ok: true, type: 'spins', value: Number(c.value), message: `🎰 You got ${c.value} free spin${Number(c.value) > 1 ? 's' : ''}!` };
      }
      profileUpdate.redeemedCodes = [...(profile.redeemedCodes || []), code];
      tx.update(profileRef, profileUpdate);
      tx.update(codeRef, { uses: (c.uses || 0) + 1, redeemedBy: [...(c.redeemedBy || []), user.uid] });
    });
    return result;
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getRewardCodes() {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return [];
  try {
    const { collection: col, getDocs: gd } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await gd(col(db, 'rewardCodes'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

export async function deactivateRewardCode(code) {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return;
  try {
    await updateDoc(doc(db, 'rewardCodes', code.toUpperCase()), { active: false });
  } catch {}
}

/* ===================== CHAT LOCK ===================== */
export function initChatLock(type, onLocked, onUnlocked) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async ({ onSnapshot, getDoc, doc: firestoreDoc }) => {
    const lockRef = firestoreDoc(db, 'stats', 'chatlock');
    try {
      const snap = await getDoc(lockRef);
      if (snap.exists()) {
        const locked = type === 'global' ? snap.data().globalLocked : snap.data().dmLocked;
        if (locked) onLocked(); else onUnlocked();
      }
    } catch {}
    onSnapshot(lockRef, (snap) => {
      if (!snap.exists()) { onUnlocked(); return; }
      const locked = type === 'global' ? snap.data().globalLocked : snap.data().dmLocked;
      if (locked) onLocked(); else onUnlocked();
    });
  });
}

/* ===================== COOKIE CONSENT ===================== */
export function initCookieConsent() {
  const CONSENT_KEY = 'flux_cookie_consent';
  const POLICY_KEY = 'flux_policy_accepted';

  onAuthStateChanged(auth, (user) => {
    if (user && !user.isAnonymous && localStorage.getItem(POLICY_KEY) !== '1') {
      showPolicyGate();
    }
  });

  if (localStorage.getItem(CONSENT_KEY) === 'accepted') return;

  const overlay = document.createElement('div');
  overlay.id = 'cookie-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:24px;box-sizing:border-box;';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:560px;box-shadow:0 30px 80px rgba(0,0,0,0.3);position:relative;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <span style="font-size:28px;">🍪</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:26px;margin:0;color:#111827;">Cookies & Privacy</h2>
      </div>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0 0 12px;">
        Flux uses cookies and local storage to keep you signed in and remember your preferences. We also use <strong>Firebase</strong> (by Google) for authentication, database storage, and analytics — which may collect usage data such as IP addresses, device info, and session activity.
      </p>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0 0 20px;">
        By using Flux you agree to this. You can read our full <a href="info.html" style="color:#3a7dff;text-decoration:underline;">Privacy Policy</a> for details. This site <strong>requires cookies to function</strong> — if you decline you will not be able to use the site.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="cookie-accept" style="flex:1;min-width:140px;padding:12px;background:#3a7dff;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;">✅ Accept & Continue</button>
        <button id="cookie-decline" style="flex:1;min-width:140px;padding:12px;background:transparent;border:1px solid rgba(0,0,0,0.1);border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;color:#6b7280;">❌ Decline</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cookie-accept').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    overlay.remove();
  });

  document.getElementById('cookie-decline').addEventListener('click', () => {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:32px;width:100%;max-width:480px;box-shadow:0 30px 80px rgba(0,0,0,0.3);text-align:center;">
        <span style="font-size:48px;display:block;margin-bottom:16px;">🚫</span>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:32px;margin:0 0 12px;color:#111827;">Cookies Required</h2>
        <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 20px;">
          Flux requires cookies to function — they're used for authentication and saving your preferences. Without them the site cannot work.
        </p>
        <button id="cookie-reconsider" style="padding:12px 28px;background:#3a7dff;color:white;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;">Go Back</button>
      </div>
    `;
    document.getElementById('cookie-reconsider').addEventListener('click', () => {
      overlay.remove();
      initCookieConsent();
    });
  });
}

function showPolicyGate() {
  if (window.location.pathname.includes('info.html')) return;
  if (document.getElementById('policy-gate-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'policy-gate-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';

  const returnUrl = encodeURIComponent(window.location.href);
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px;width:100%;max-width:480px;box-shadow:0 30px 80px rgba(0,0,0,0.3);text-align:center;">
      <span style="font-size:48px;display:block;margin-bottom:16px;">📋</span>
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:30px;margin:0 0 12px;color:#111827;">Privacy Policy Update</h2>
      <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 8px;">
        We've updated our Privacy Policy. You need to read and accept it to continue using Flux.
      </p>
      <p style="font-size:13px;color:#ef4444;line-height:1.6;margin:0 0 24px;">
        If you do not accept, your account will need to be deleted — but you're always welcome to create a new one.
      </p>
      <a href="info.html?accept=1&return=${returnUrl}"
        style="display:block;padding:13px;background:#3a7dff;color:white;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:10px;">
        📖 Read & Accept Privacy Policy
      </a>
      <button id="policy-gate-delete-btn" style="width:100%;padding:11px;background:transparent;border:1px solid rgba(239,68,68,0.3);border-radius:10px;font-weight:600;font-size:13px;color:#ef4444;cursor:pointer;">
        🗑️ Delete my account instead
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('policy-gate-delete-btn').addEventListener('click', async () => {
    if (!confirm('Are you sure? This will sign you out. To fully delete your data, contact us on GitHub.')) return;
    try {
      await signOut(auth);
      localStorage.removeItem('flux_policy_accepted');
      overlay.remove();
      location.reload();
    } catch (e) { console.warn('Sign out failed:', e); }
  });
}

/* ===================== INCIDENT BANNER ===================== */
export async function setIncidentBanner(active, message = '', type = 'warning', flaggedBy = 'dev') {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Admin only.' };
  try {
    await setDoc(doc(db, 'stats', 'incidentBanner'), {
      active, message, type, flaggedBy,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function initIncidentBanner() {
  import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js').then(async ({ onSnapshot, doc: fd }) => {
    let _lastMsg = null;
    const _sessionKey = 'flux_banner_seen';
    const ref = fd(db, 'stats', 'incidentBanner');

    if (!document.getElementById('flux-banner-style')) {
      const s = document.createElement('style');
      s.id = 'flux-banner-style';
      s.textContent = `
        @keyframes banner-slide-in { from { transform:translateX(-110%); opacity:0; } to { transform:translateX(0); opacity:1; } }
        @keyframes banner-slide-out { from { transform:translateX(0); opacity:1; } to { transform:translateX(-110%); opacity:0; } }
      `;
      document.head.appendChild(s);
    }

    const dismissBanner = (banner) => {
      banner.style.animation = 'banner-slide-out 0.3s ease forwards';
      setTimeout(() => banner.remove(), 300);
    };

    onSnapshot(ref, (snap) => {
      const existing = document.getElementById('flux-incident-banner');
      if (!snap.exists() || !snap.data().active) { existing ? dismissBanner(existing) : null; return; }
      const d = snap.data();

      const seenKey = `${_sessionKey}_${d.updatedAt}`;
      if (d.message === _lastMsg && existing) return;
      if (sessionStorage.getItem(seenKey)) return;

      _lastMsg = d.message;
      sessionStorage.setItem(seenKey, '1');
      if (existing) dismissBanner(existing);

      const colors = {
        info:    { bg: '#1e40af', border: '#3b82f6', icon: 'ℹ️' },
        warning: { bg: '#92400e', border: '#f59e0b', icon: '⚠️' },
        error:   { bg: '#7f1d1d', border: '#ef4444', icon: '🔴' },
      };
      const c = colors[d.type] || colors.warning;
      const banner = document.createElement('div');
      banner.id = 'flux-incident-banner';
      banner.style.cssText = `
        position:fixed;top:0;left:0;z-index:99980;
        background:${c.bg};
        border-bottom:2px solid ${c.border};
        color:white;font-family:inherit;
        padding:0;max-width:380px;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        border-radius:0 0 14px 0;
        overflow:hidden;
        animation:banner-slide-in 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
      `;
      const flagLabel = d.flaggedBy === 'ai'
        ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,0.15);padding:1px 7px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">🤖 Flagged by AI</span>'
        : '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,0.15);padding:1px 7px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">👨‍💻 Flagged by Developer</span>';
      const time = new Date(d.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      banner.innerHTML = `
        <div style="padding:10px 14px 10px 12px;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:18px;flex-shrink:0;margin-top:1px;">${c.icon}</span>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">
                ${flagLabel}
                <span style="font-size:9px;color:rgba(255,255,255,0.5);">${time}</span>
              </div>
              <div style="font-size:12px;line-height:1.5;color:rgba(255,255,255,0.92);">${d.message}</div>
              <button id="incident-status-link" style="margin-top:6px;background:rgba(255,255,255,0.15);border:none;color:white;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;cursor:pointer;font-family:inherit;letter-spacing:0.3px;">View Status Page →</button>
            </div>
            <button id="incident-banner-close" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:16px;padding:0;flex-shrink:0;line-height:1;margin-top:-2px;">✕</button>
          </div>
        </div>
      `;
      document.body.appendChild(banner);

      document.getElementById('incident-banner-close').addEventListener('click', () => dismissBanner(banner));
      document.getElementById('incident-status-link').addEventListener('click', () => window.open('status.html', '_blank'));

      setTimeout(() => {
        if (document.getElementById('flux-incident-banner') === banner) dismissBanner(banner);
      }, 5000);
    });
  });
}

/* ===================== STATUS PAGE DATA ===================== */
const SERVICE_DESCRIPTIONS = {
  firestore: {
    name: 'Database (Firestore)', icon: '🔥',
    descriptions: {
      operational: 'All database operations are running normally.',
      degraded: 'The Firestore database is experiencing elevated latency or intermittent errors.',
      outage: 'The Firestore database is currently unavailable.',
    }
  },
  googleAuth: {
    name: 'Authentication (Google)', icon: '🔐',
    descriptions: {
      operational: 'Sign-in and authentication services are operating normally.',
      degraded: 'Authentication services are experiencing intermittent issues.',
      outage: 'Authentication is currently unavailable.',
    }
  },
  website: {
    name: 'Website & Interface', icon: '🌐',
    descriptions: {
      operational: 'The Flux website is loading normally.',
      degraded: 'The website is experiencing slow load times or intermittent availability issues.',
      outage: 'The Flux website is currently unreachable or not loading correctly.',
    }
  },
  games: {
    name: 'Games', icon: '🎮',
    descriptions: {
      operational: 'All games are loading and running normally.',
      degraded: 'Some games may be failing to load or embed correctly.',
      outage: 'Games are currently not loading.',
    }
  },
};

export async function setServiceStatus(serviceKey, status, flaggedBy = 'dev') {
  const user = auth.currentUser;
  if (!user || user.uid !== OWNER_UID) return { ok: false, error: 'Admin only.' };
  try {
    const snap = await getDoc(doc(db, 'stats', 'serviceHealth'));
    const current = snap.exists() ? (snap.data().services || {}) : {};
    current[serviceKey] = {
      status,
      message: SERVICE_DESCRIPTIONS[serviceKey]?.descriptions[status] || '',
      flaggedBy,
      detectedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'stats', 'serviceHealth'), { services: current, updatedAt: new Date().toISOString() });
    if (status !== 'operational') {
      const svc = SERVICE_DESCRIPTIONS[serviceKey];
      const type = status === 'outage' ? 'error' : 'warning';
      const msg = `<strong>${svc?.name}</strong> is ${status === 'outage' ? 'experiencing an outage' : 'degraded'}.`;
      await setIncidentBanner(true, msg, type, flaggedBy);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function autoCheckServiceHealth() {
  let existing = {};
  try {
    const snap = await getDoc(doc(db, 'stats', 'serviceHealth'));
    existing = snap.exists() ? (snap.data().services || {}) : {};
  } catch {}

  const results = {};
  const KEYS = ['firestore', 'googleAuth', 'website', 'games'];
  const shouldSkip = (key) => existing[key]?.flaggedBy === 'dev';

  if (shouldSkip('firestore')) { results.firestore = existing.firestore; }
  else {
    try {
      const start = Date.now();
      await getDoc(doc(db, 'stats', 'health_ping'));
      results.firestore = { status: Date.now() - start > 4000 ? 'degraded' : 'operational', flaggedBy: 'ai' };
    } catch { results.firestore = { status: 'outage', flaggedBy: 'ai' }; }
  }

  if (shouldSkip('googleAuth')) { results.googleAuth = existing.googleAuth; }
  else {
    try {
      await Promise.race([
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 4000);
          const unsub = auth.onAuthStateChanged(() => { clearTimeout(timer); unsub(); resolve(); });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      results.googleAuth = { status: 'operational', flaggedBy: 'ai' };
    } catch { results.googleAuth = { status: 'degraded', flaggedBy: 'ai' }; }
  }

  results.website = shouldSkip('website') ? existing.website : { status: 'operational', flaggedBy: 'ai' };

  if (shouldSkip('games')) { results.games = existing.games; }
  else {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      await fetch('https://nxtcoreee3.github.io/Drive-Mad/', { method: 'HEAD', signal: ctrl.signal, mode: 'no-cors' });
      clearTimeout(timer);
      results.games = { status: 'operational', flaggedBy: 'ai' };
    } catch { results.games = { status: 'degraded', flaggedBy: 'ai' }; }
  }

  const services = {};
  for (const key of KEYS) {
    const r = results[key];
    if (shouldSkip(key) && existing[key]) { services[key] = existing[key]; }
    else {
      services[key] = {
        status: r?.status || 'operational',
        message: SERVICE_DESCRIPTIONS[key]?.descriptions[r?.status || 'operational'] || '',
        flaggedBy: 'ai',
        detectedAt: new Date().toISOString(),
      };
    }
  }

  const user = auth.currentUser;
  if (user && user.uid === OWNER_UID) {
    try {
      let anyNewIssue = false;
      for (const [key, svc] of Object.entries(services)) {
        if (shouldSkip(key)) continue;
        if (svc.status !== (existing[key]?.status) && svc.status !== 'operational') anyNewIssue = true;
      }
      await setDoc(doc(db, 'stats', 'serviceHealth'), { services, updatedAt: new Date().toISOString() });
      if (anyNewIssue) {
        const issues = Object.entries(services).filter(([, v]) => v.status !== 'operational').map(([k]) => SERVICE_DESCRIPTIONS[k]?.name).filter(Boolean);
        if (issues.length) {
          const msg = `Automated monitoring detected issues with: <strong>${issues.join(', ')}</strong>.`;
          const type = Object.values(services).some(v => v.status === 'outage') ? 'error' : 'warning';
          await setIncidentBanner(true, msg, type, 'ai');
        }
      }
    } catch (e) { console.warn('Health write failed:', e); }
  } else {
    try { await setDoc(doc(db, 'stats', 'serviceHealth'), { services, updatedAt: new Date().toISOString() }); } catch {}
  }

  return services;
}
