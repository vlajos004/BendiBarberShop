import { firebaseConfig, PING_URL } from './config.js?v=8';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'hu';
export const db = getFirestore(app);
export { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, increment };

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
  requireApproval: true,
  shopEnabled: false,
  galleryEnabled: true
};
export const DEFAULT_PRIVATE = {
  notifyEmail: '',
  reminderConfirm: true,
  reminderSubject: '{Mikor} {ido}-kor várlak',
  reminderBody: 'Szia {nev}!\n\nEmlékeztetlek, hogy {mikor} {ido}-kor várlak, {idotartam} időtartamra.\n\nItt tudod megerősíteni vagy lemondani: {link}\n\nHa kérdésed van, válaszolj erre a levélre.\n\nBendi'
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

// Szól az e-mail-szkriptnek, hogy most fusson le (a válasz nem érdekes, ezért no-cors).
// Készlet: rendeléskor levonja (sign -1), lemondáskor visszaadja (sign +1) a batch-ben; csak a követett készletű termékeknél.
// A levonás az adatbázisban történik (increment), így két egyidejű rendelés sem viheti mínuszba (a szabály tiltja).
export async function stockMove(batch, items, sign, orderId){
  for (const i of items) {
    const s = await getDoc(doc(db, 'products', i.pid)), st = s.exists() ? s.data().stock : null;
    if (typeof st !== 'number') continue;
    if (sign < 0 && st < i.qty) throw { code: 'stock', name: i.name, left: st };
    batch.update(doc(db, 'products', i.pid), { stock: increment(sign * i.qty), lastOrder: orderId });
  }
}
export function ping(){ if (PING_URL) fetch(PING_URL, { mode: 'no-cors' }).catch(() => {}); }

export function toast(msg){
  let t = document.getElementById('toast');
  if (!t){ t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

export const fmtFt = n => Math.round(Number(n) || 0).toLocaleString('hu-HU').replace(/ /g, ' ') + ' Ft';

// Kép lekicsinyítése JPEG-be, hogy beférjen egy Firestore-dokumentumba (1 MB alatt). A Firebase képtárhely bankkártyás csomagot kérne.
export async function compressImage(file, max = 1400, limit = 600000){
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Ez nem kép.');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { throw new Error('Ezt a képformátumot a böngésző nem tudja megnyitni. Mentsd el JPG-ként, és próbáld újra.'); }
  let side = max;
  for (let i = 0; i < 8; i++){
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
    for (const q of [.82, .72, .62]) { const u = c.toDataURL('image/jpeg', q); if (u.length <= limit) return u; }
    side = Math.round(side * .8);
  }
  throw new Error('A kép túl nagy, nem sikerült lekicsinyíteni.');
}

/* ---------- közös belépés / regisztráció (foglalás és webshop) ---------- */
// id: a menüben (am) és az oldalon (auth) egyszerre is lehet űrlap, ezért külön azonosító kell
export function authFormHTML(tab, id = 'auth'){
  return `<div class="tabs" role="tablist"><button type="button" role="tab" class="${tab === 'login' ? 'on' : ''}" data-tab="login">Belépés</button><button type="button" role="tab" class="${tab === 'reg' ? 'on' : ''}" data-tab="reg">Regisztráció</button></div>
    <form id="${id}-form" novalidate>
    ${tab === 'reg' ? `<div class="two"><label class="field"><span>Teljes név</span><input name="name" autocomplete="name" required></label>
    <label class="field"><span>Telefonszám</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+36 30 123 4567" required></label></div>` : ''}
    <div class="two"><label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required></label>
    <label class="field"><span>Jelszó</span><input name="password" type="password" autocomplete="${tab === 'reg' ? 'new-password' : 'current-password'}" minlength="6" required></label></div>
    ${tab === 'reg' ? `<label class="check"><input type="checkbox" name="consent" required><span>Elolvastam és elfogadom az <a href="adatkezeles.html" target="_blank">adatkezelési tájékoztatót</a>.</span></label>` : ''}
    <div class="recap" style="margin-top:18px">${tab === 'login' ? '<button type="button" class="btn btn-line" data-act="reset">Elfelejtett jelszó</button>' : '<span></span>'}
    <button class="btn btn-red" type="submit">${tab === 'reg' ? 'Regisztrálok' : 'Belépek'}</button></div>
    <p class="err" id="${id}-err"></p></form>`;
}
// Regisztrációnál a profilt előre átadja (onRegProfile), mert a belépés eseménye hamarabb lefuthat, mint ahogy elmentjük.
export async function submitAuth(tab, f, onRegProfile){
  if (tab === 'reg') {
    if (!f.name || f.name.trim().length < 2) throw { msg: 'Add meg a teljes neved.' };
    if (!/^[+\d][\d\s\-()]{7,}$/.test((f.phone || '').trim())) throw { msg: 'Adj meg egy érvényes telefonszámot.' };
    if (!f.consent) throw { msg: 'A regisztrációhoz fogadd el az adatkezelési tájékoztatót.' };
    const prof = { name: f.name.trim(), email: (f.email || '').trim().toLowerCase(), phone: f.phone.trim() };
    if (onRegProfile) onRegProfile(prof);
    const cred = await createUserWithEmailAndPassword(auth, (f.email || '').trim(), f.password || '');
    prof.email = cred.user.email;
    await setDoc(doc(db, 'users', cred.user.uid), { ...prof, created: serverTimestamp() });
    await updateProfile(cred.user, { displayName: prof.name });
    return prof;
  }
  await signInWithEmailAndPassword(auth, (f.email || '').trim(), f.password || '');
  return null;
}
export async function loadProfile(u, regProfile){
  try { const p = await getDoc(doc(db, 'users', u.uid));
    // a regisztrációs űrlap adatait csak ugyanahhoz a címhez használjuk (sikertelen regisztráció után ne ragadjon rá más fiókra)
    return p.exists() ? p.data() : (regProfile && regProfile.email === u.email ? regProfile : { name: u.displayName, phone: '' }); }
  catch (e) { console.error(e); return { name: u.displayName, phone: '' }; }
}
export async function resetPassword(id = 'auth'){
  const el = document.querySelector(`#${id}-form [name=email]`), err = document.getElementById(id + '-err'), em = el ? el.value.trim() : '';
  if (!em) { err.textContent = 'Írd be az e-mail-címed, és kattints újra.'; return; }
  try { await sendPasswordResetEmail(auth, em); toast('Elküldtük a jelszó-visszaállító e-mailt.'); } catch (x) { err.textContent = authError(x); }
}

// Görgetésre beúszó elemek ([data-reveal]); csökkentett mozgás beállításnál nincs animáció (a <head> csak akkor teszi ki a .js osztályt).
let io = null;
export function reveal(root = document){
  if (!document.documentElement.classList.contains('js')) return;
  io = io || new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  root.querySelectorAll('[data-reveal]:not(.in)').forEach(el => io.observe(el));
}

export function authError(e){
  const m = {
    'auth/email-already-in-use': 'Ezzel az e-mail-címmel már regisztráltak. Lépj be, vagy kérj új jelszót.',
    'auth/invalid-credential': 'Hibás e-mail-cím vagy jelszó.',
    // ezek csak akkor jönnek, ha a Firebase-ben ki van kapcsolva az „Email enumeration protection”; különben invalid-credential
    'auth/wrong-password': 'Hibás jelszó. Próbáld újra, vagy kérj új jelszót.',
    'auth/user-not-found': 'Ezzel az e-mail-címmel még nem regisztráltak. Válts a Regisztráció fülre.',
    'auth/weak-password': 'A jelszó legalább 6 karakter legyen.',
    'auth/invalid-email': 'Érvénytelen e-mail-cím.',
    'auth/too-many-requests': 'Túl sok próbálkozás. Várj pár percet.',
    'auth/network-request-failed': 'Nincs internetkapcsolat.'
  };
  return m[e && e.code] || 'Hiba történt. Próbáld újra.';
}
