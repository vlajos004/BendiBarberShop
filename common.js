import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'hu';
export const db = getFirestore(app);
export { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp };

/* ---------- alapbeállítások (helykitöltők – Bendi az admin felületen átírja) ---------- */
export const DEFAULT_PUBLIC = {
  shopName: 'Bendi',
  address: '1234 Budapest, Minta utca 1.',
  phone: '+36 30 123 4567',
  publicEmail: '',
  instagram: '',
  hours: { '0': null, '1': ['09:00','18:00'], '2': ['09:00','18:00'], '3': ['09:00','18:00'], '4': ['09:00','18:00'], '5': ['09:00','18:00'], '6': ['09:00','14:00'] },
  durations: [30, 45, 60, 90],
  slotStep: 15,
  horizonDays: 14,
  maxActive: 2,
  minNoticeHours: 2,
  requireApproval: true
};
export const DEFAULT_PRIVATE = {
  notifyEmail: '',
  reminderConfirm: true,
  reminderSubject: 'Holnap {ido}-kor vár a szék',
  reminderBody: 'Szia {nev}!\n\nEmlékeztetlek, hogy holnap ({datum}) {ido}-kor várlak, {idotartam} időtartamra.\n\nItt tudod megerősíteni vagy lemondani: {link}\n\nHa kérdésed van, válaszolj erre a levélre.\n\nBendi'
};

export async function loadPublic(){
  try { const s = await getDoc(doc(db, 'settings', 'public')); return Object.assign({}, DEFAULT_PUBLIC, s.exists() ? s.data() : {}); }
  catch(e){ console.error(e); return { ...DEFAULT_PUBLIC }; }
}

/* ---------- dátum / idő ---------- */
export const pad = n => String(n).padStart(2, '0');
export const toStr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const today = () => toStr(new Date());
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
export const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
export const fmtLong = s => parse(s).toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
export const fmtShort = s => parse(s).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', weekday: 'short' });
export const fmtDur = m => m < 60 ? m + ' perc' : m % 60 === 30 ? String(m / 60).replace('.', ',') + ' óra' : m % 60 ? Math.floor(m / 60) + ' óra ' + (m % 60) + ' perc' : (m / 60) + ' óra';
// A foglalás neve: régi foglalásnál a szolgáltatás, újnál az időtartam.
export const bLabel = b => b.serviceName || fmtDur(b.dur);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const WEEKDAYS = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];

export function randToken(){
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}

// Szabad kezdési időpontok egy napra: nyitvatartáson belül, foglalt/zárolt sávokkal nem ütközve, legalább minNoticeHours múlva.
export function slotsFor(date, dur, S, busy, now = new Date()){
  const t0 = today();
  if (date < t0 || date > addDays(t0, S.horizonDays)) return [];
  const h = S.hours && S.hours[String(parse(date).getDay())];
  if (!h) return [];
  const open = mins(h[0]), close = mins(h[1]), step = S.slotStep || 15;
  const earliest = date === toStr(now) ? now.getHours() * 60 + now.getMinutes() + (S.minNoticeHours || 0) * 60 : -1;
  const taken = busy.filter(b => b.date === date).map(b => [mins(b.start), mins(b.end)]);
  const out = [];
  for (let t = open; t + dur <= close; t += step){
    if (t < earliest) continue;
    if (taken.some(([a, z]) => t < z && a < t + dur)) continue;
    out.push(hhmm(t));
  }
  return out;
}

export const STATUS = {
  pending: ['Jóváhagyásra vár', 'warn'], accepted: ['Elfogadva', 'ok'], rejected: ['Elutasítva', 'bad'], cancelled: ['Lemondva', 'muted']
};
export const CONFIRM = { yes: ['Visszaigazolta', 'ok'], no: ['Lemondta (linkkel)', 'bad'] };

export function toast(msg){
  let t = document.getElementById('toast');
  if (!t){ t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

export function authError(e){
  const m = {
    'auth/email-already-in-use': 'Ezzel az e-mail-címmel már regisztráltak. Lépj be, vagy kérj új jelszót.',
    'auth/invalid-credential': 'Hibás e-mail-cím vagy jelszó.',
    'auth/wrong-password': 'Hibás e-mail-cím vagy jelszó.',
    'auth/user-not-found': 'Hibás e-mail-cím vagy jelszó.',
    'auth/weak-password': 'A jelszó legalább 6 karakter legyen.',
    'auth/invalid-email': 'Érvénytelen e-mail-cím.',
    'auth/too-many-requests': 'Túl sok próbálkozás. Várj pár percet.',
    'auth/network-request-failed': 'Nincs internetkapcsolat.'
  };
  return m[e && e.code] || 'Hiba történt. Próbáld újra.';
}
