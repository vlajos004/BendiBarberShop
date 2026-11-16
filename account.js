// Fiók menü a fejléc jobb oldalán (kezdőlap, webshop): belépés / regisztráció, a saját közelgő időpontok és rendelések
// állapottal, lemondás, kilépés. Ha itt változik valami, 'bendi:changed' eseményt küld, hogy az oldal is frissüljön.
import { auth, db, onAuthStateChanged, signOut, doc, collection, query, where, getDocs, writeBatch,
  today, addDays, parse, fmtLong, WEEKDAYS, esc, bLabel, STATUS, toast, authError, ping, fmtFt,
  authFormHTML, submitAuth, loadProfile, resetPassword } from './common.js?v=9';

const ORDER = { new: ['Beérkezett', 'warn'], ready: ['Átvehető', 'ok'], done: ['Átvéve', 'muted'], cancelled: ['Lemondva', 'muted'] };
const orderNo = id => '#' + String(id).slice(0, 6).toUpperCase();
const badge = (map, k) => { const [t, c] = map[k] || [k, 'muted']; return `<span class="badge b-${c}">${esc(t)}</span>`; };
const MONTHS = ['jan', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];
const svg = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const PERSON = svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');
const CHEV = svg('<path d="m6 9 6 6 6-6"/>');
const BAG = svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.6l2.3 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.5L21.5 7H6"/>');
const OUT = svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9"/>');

export function mountAccount(host, { home = 'index.html' } = {}){
  let user = null, profile = null, regProfile = null, tab = 'login', open = false, data = null;
  host.classList.add('am');
  host.innerHTML = `<button type="button" class="am-btn" aria-haspopup="dialog" aria-expanded="false"></button><div class="am-pop" role="dialog" aria-label="Fiókom" tabindex="-1" hidden></div>`;
  const btn = host.firstElementChild, pop = host.lastElementChild;
  const fullName = () => (profile?.name || user?.displayName || user?.email.split('@')[0] || '').trim();
  const initials = () => { const p = fullName().split(/\s+/).filter(Boolean); return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : (p[0] || '?').slice(0, 2)).toUpperCase(); };
  const changed = () => document.dispatchEvent(new CustomEvent('bendi:changed'));

  function renderBtn(){
    btn.classList.toggle('in', !!user);
    btn.innerHTML = user ? `<span class="am-av">${esc(initials())}</span><span class="am-name">${esc(fullName().split(/\s+/).pop())}</span>${CHEV}` : `${PERSON}<span class="am-name">Belépés</span>`;
    btn.setAttribute('aria-label', user ? 'Fiókom: ' + fullName() : 'Belépés vagy regisztráció');
  }
  function bookingRow(b){
    const d = parse(b.date), when = b.date === today() ? 'Ma' : b.date === addDays(today(), 1) ? 'Holnap' : WEEKDAYS[d.getDay()];
    return `<li class="am-it"><span class="am-tile"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></span>
      <span class="am-mid"><b>${when}, ${esc(b.start)}–${esc(b.end)}</b><small>${esc(bLabel(b))}</small></span>
      <span class="am-end">${badge(STATUS, b.status)}${b.status === 'pending' || b.status === 'accepted' ? `<button type="button" class="linkish" data-am-cancel="${b.id}">Lemondom</button>` : ''}</span></li>`;
  }
  function orderRow(o){
    return `<li class="am-it"><span class="am-tile am-ico">${BAG}</span>
      <span class="am-mid"><b>${orderNo(o.id)} · ${fmtFt(o.total)}</b><small>${o.items.map(i => esc(i.name) + (i.qty > 1 ? ' × ' + i.qty : '')).join(', ')}</small></span>
      <span class="am-end">${badge(ORDER, o.status)}${o.status === 'new' ? `<button type="button" class="linkish" data-am-ocancel="${o.id}">Lemondom</button>` : ''}</span></li>`;
  }
  function render(){
    if (!user) {
      pop.innerHTML = `<div class="am-head"><b>Fiókod</b><p>Lépj be, és itt látod az időpontjaidat és a rendeléseidet.</p></div><div class="am-body">${authFormHTML(tab, 'am')}</div>`;
      return;
    }
    const B = data?.bookings || [], O = data?.orders || [], wait = '<p class="am-empty">Betöltés…</p>';
    pop.innerHTML = `<div class="am-head am-me"><span class="am-av lg">${esc(initials())}</span><span><b>${esc(fullName())}</b><small>${esc(user.email)}</small></span></div>
      <div class="am-body">
        <section class="am-sec"><h3>Időpontjaim${B.length ? ` <span>${B.length}</span>` : ''}</h3>
          ${!data ? wait : data.err ? '<p class="am-empty">Most nem sikerült betölteni. Próbáld újra később.</p>' : B.length ? `<ul>${B.map(bookingRow).join('')}</ul>` : `<p class="am-empty">Nincs közelgő időpontod. <a href="${home}#foglalas" data-am="close">Foglalok →</a></p>`}</section>
        ${O.length ? `<section class="am-sec"><h3>Rendeléseim</h3><ul>${O.map(orderRow).join('')}</ul></section>` : ''}
      </div>
      <div class="am-foot"><button type="button" class="am-out" data-am="logout">${OUT}Kijelentkezés</button></div>`;
  }
  async function refresh(){
    const u = user; if (!u) return;
    try {
      const [b, o] = await Promise.all([getDocs(query(collection(db, 'bookings'), where('uid', '==', u.uid))), getDocs(query(collection(db, 'orders'), where('uid', '==', u.uid)))]);
      if (u !== user) return;  // közben kijelentkezett
      data = {
        bookings: b.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.date >= today() && x.status !== 'cancelled').sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start)),
        orders: o.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (y.createdMs || 0) - (x.createdMs || 0)).slice(0, 5)
      };
    } catch (e) { console.error(e); data = { err: true }; }
    if (open) render();
  }
  function toggle(on = !open){
    open = on; pop.hidden = !on; btn.setAttribute('aria-expanded', on);
    if (on) { render(); refresh(); pop.focus({ preventScroll: true }); }
  }
  async function cancelBooking(id){
    const b = data?.bookings?.find(x => x.id === id); if (!b || !confirm(`Lemondod ezt az időpontot: ${fmtLong(b.date)}, ${b.start}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'bookings', id), { status: 'cancelled', cancelledBy: 'guest' });
      batch.delete(doc(db, 'busy', id));
      await batch.commit(); ping(); toast('Lemondtad az időpontot.'); changed(); await refresh();
    } catch (e) { console.error(e); toast('A lemondás nem sikerült. Hívd fel Bendit.'); }
  }
  async function cancelOrder(id){
    if (!confirm(`Lemondod a(z) ${orderNo(id)} rendelést?`)) return;
    try { const batch = writeBatch(db); batch.update(doc(db, 'orders', id), { status: 'cancelled', cancelledBy: 'guest' }); await batch.commit(); ping(); toast('Lemondtad a rendelést.'); changed(); await refresh(); }
    catch (e) { console.error(e); toast('Nem sikerült lemondani. Hívd fel Bendit.'); }
  }

  // A menün belüli kattintás és küldés nem jut el az oldal saját kezelőihez (azok is figyelik a data-tab / data-act gombokat).
  host.addEventListener('click', async e => {
    e.stopPropagation();
    const t = e.target.closest('button,a'); if (!t) return;
    const d = t.dataset;
    if (t === btn) toggle();
    else if (d.tab) { tab = d.tab; render(); pop.querySelector('input')?.focus(); }
    else if (d.act === 'reset') resetPassword('am');
    else if (d.am === 'close') toggle(false);
    else if (d.am === 'logout') { toggle(false); await signOut(auth); toast('Kijelentkeztél.'); }
    else if (d.amCancel) cancelBooking(d.amCancel);
    else if (d.amOcancel) cancelOrder(d.amOcancel);
  });
  host.addEventListener('submit', async e => {
    e.preventDefault(); e.stopPropagation();
    const err = pop.querySelector('#am-err'), sb = e.target.querySelector('[type=submit]'); err.textContent = ''; sb.disabled = true;
    try {
      const p = await submitAuth(tab, Object.fromEntries(new FormData(e.target)), x => regProfile = x);
      if (p) { profile = p; renderBtn(); }
      toast(p ? 'Regisztráltál, be vagy jelentkezve.' : 'Beléptél.'); changed();
    } catch (x) { regProfile = null; err.textContent = x.msg || authError(x); sb.disabled = false; }
  });
  document.addEventListener('click', () => { if (open) toggle(false); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { toggle(false); btn.focus(); } });

  renderBtn();
  onAuthStateChanged(auth, async u => {
    user = u; data = null; profile = u ? await loadProfile(u, regProfile) : null;
    renderBtn(); if (open) { render(); refresh(); }
  });
}
