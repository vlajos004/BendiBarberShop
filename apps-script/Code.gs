/**
 * Bendi Időpontfoglalás – e-mail-küldő (Google Apps Script, ingyenes).
 * 5 percenként fut:
 *   1. új foglalásról e-mail Bendinek,
 *   2. elfogadás / elutasítás / Bendi általi lemondás után e-mail a vendégnek,
 *   3. 16:00 után emlékeztető a másnapi elfogadott foglalásokhoz (megerősítő linkkel, ha be van kapcsolva).
 *
 * Szkripttulajdonságok (Projektbeállítások → Szkripttulajdonságok):
 *   API_KEY, PROJECT_ID, ADMIN_EMAIL, ADMIN_PASSWORD, SITE_URL (pl. https://vlajos004.github.io/BendiBarberShop/)
 * Első futtatás: válaszd ki a `setup` függvényt, és nyomd meg a Futtatás gombot.
 */

var TZ = 'Europe/Budapest';
var REMINDER_HOUR = 16;
var HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
var HU_DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  run();
  Logger.log('Kész: a szkript mostantól 5 percenként fut.');
}

function run() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var c = cfg_(), fs = firestore_(c);
    var pub = fs.get('settings/public') || {}, priv = fs.get('settings/private') || {};
    var shop = 'Bendi Időpontfoglalás';

    // 1. Új foglalás → Bendi
    fs.query('bookings', [['notified', '==', false]]).forEach(function (b) {
      try {
        if (priv.notifyEmail) {
          var pend = b.status === 'pending';
          send_(priv.notifyEmail, (pend ? 'Új foglalási kérés: ' : 'Új foglalás: ') + b.name + ' – ' + huDate(b.date) + ' ' + b.start,
            (pend ? 'Új foglalási kérés érkezett, jóváhagyásra vár.\n\n' : 'Új foglalás érkezett.\n\n') +
            'Név: ' + b.name + '\nTelefon: ' + (b.phone || '-') + '\nE-mail: ' + (b.email || '-') +
            '\nIdőtartam: ' + label(b) + '\nIdőpont: ' + huDate(b.date) + ', ' + b.start + '–' + b.end +
            (pend ? '\n\nJóváhagyás vagy elutasítás: ' + c.site + 'admin.html' : ''), shop, b.email || null);
        }
      } catch (e) { Logger.log('Értesítés hiba ' + b.id + ': ' + e); }
      fs.patch('bookings/' + b.id, { notified: true });
    });

    // 2. Döntés → vendég
    fs.query('bookings', [['decisionMailed', '==', false]]).forEach(function (b) {
      if (b.status === 'pending') return;  // még nincs döntés
      var mail = decisionMail(b, shop);
      try { if (mail && b.email) send_(b.email, mail[0], mail[1], shop, priv.notifyEmail || null); }
      catch (e) { Logger.log('Döntés-e-mail hiba ' + b.id + ': ' + e); }
      fs.patch('bookings/' + b.id, { decisionMailed: true });
    });

    // 3. Emlékeztető 16:00 után a holnapi foglalásokhoz
    var now = new Date();
    if (Number(Utilities.formatDate(now, TZ, 'H')) >= REMINDER_HOUR) {
      var tomorrow = addDay(Utilities.formatDate(now, TZ, 'yyyy-MM-dd'));
      fs.query('bookings', [['status', '==', 'accepted'], ['date', '==', tomorrow]]).forEach(function (b) {
        if (b.reminded || b.guestConfirm === 'no') return;
        try {
          if (b.email) {
            var link = priv.reminderConfirm === false ? null : c.site + 'confirm.html?b=' + encodeURIComponent(b.id) + '&t=' + encodeURIComponent(b.token) + '&d=' + b.date + '&s=' + encodeURIComponent(b.start);
            var vals = { nev: firstName(b.name), datum: huDate(b.date), ido: b.start, idotartam: label(b), szolgaltatas: label(b), link: link };
            send_(b.email, fill(priv.reminderSubject || 'Holnap {ido}-kor vár a szék', vals), fill(priv.reminderBody || 'Szia {nev}! Holnap {ido}-kor várlak ({idotartam}).\n{link}', vals), shop, priv.notifyEmail || null);
          }
        } catch (e) { Logger.log('Emlékeztető hiba ' + b.id + ': ' + e); }
        fs.patch('bookings/' + b.id, { reminded: true });
      });
    }
  } finally { lock.releaseLock(); }
}

/* ---------- szövegek ---------- */
function decisionMail(b, shop) {
  var when = huDate(b.date) + ', ' + b.start;
  if (b.status === 'accepted') return ['Foglalás elfogadva – ' + when, 'Szia ' + firstName(b.name) + '!\n\nA foglalásodat elfogadtam: ' + when + ' (' + label(b) + ').\nElőző nap délután küldök egy emlékeztetőt.\n\nVárlak!\n' + shop];
  if (b.status === 'rejected') return ['Foglalás – ' + when, 'Szia ' + firstName(b.name) + '!\n\nSajnos a(z) ' + when + ' időpontot nem tudom vállalni. Kérlek, válassz egy másikat a weboldalon.\n\n' + shop];
  if (b.status === 'cancelled' && b.cancelledBy === 'admin') return ['Időpont lemondva – ' + when, 'Szia ' + firstName(b.name) + '!\n\nSajnos le kellett mondanom a(z) ' + when + ' időpontodat. Elnézést kérek! Kérlek, foglalj új időpontot a weboldalon.\n\n' + shop];
  return null;  // vendég saját lemondása: nem kell levél
}

// Helyettesítők kitöltése; ha nincs link, a {link}-et tartalmazó sorok kimaradnak.
function fill(tpl, vals) {
  return String(tpl).split('\n').filter(function (l) { return vals.link || l.indexOf('{link}') < 0; }).join('\n')
    .replace(/\{(\w+)\}/g, function (m, k) { return vals[k] != null ? vals[k] : m; });
}
function label(b) { if (b.serviceName) return b.serviceName; var m = Number(b.dur) || 0; return m < 60 ? m + ' perc' : m % 60 === 30 ? String(m / 60).replace('.', ',') + ' óra' : m % 60 ? Math.floor(m / 60) + ' óra ' + (m % 60) + ' perc' : (m / 60) + ' óra'; }
function firstName(n) { var p = String(n || '').trim().split(/\s+/); return p[p.length - 1] || ''; }  // magyar névsorrend
function huDate(s) { var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2])); return HU_MONTHS[p[1] - 1] + ' ' + p[2] + '., ' + HU_DAYS[d.getUTCDay()]; }
function addDay(s) { var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)); return d.toISOString().slice(0, 10); }

function send_(to, subject, body, name, replyTo) {
  var opt = { name: name };
  if (replyTo) opt.replyTo = replyTo;
  GmailApp.sendEmail(to, subject, body, opt);
}

/* ---------- Firestore REST ---------- */
function cfg_() {
  var p = PropertiesService.getScriptProperties();
  var c = { key: p.getProperty('API_KEY'), project: p.getProperty('PROJECT_ID'), email: p.getProperty('ADMIN_EMAIL'), pass: p.getProperty('ADMIN_PASSWORD'), site: p.getProperty('SITE_URL') || '' };
  ['key', 'project', 'email', 'pass', 'site'].forEach(function (k) { if (!c[k]) throw new Error('Hiányzó szkripttulajdonság: ' + k); });
  if (!/\/$/.test(c.site)) c.site += '/';
  return c;
}

function firestore_(c) {
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + c.key, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: c.email, password: c.pass, returnSecureToken: true })
  });
  if (r.getResponseCode() !== 200) throw new Error('Firebase-bejelentkezés sikertelen: ' + r.getContentText());
  var token = JSON.parse(r.getContentText()).idToken;
  var base = 'https://firestore.googleapis.com/v1/projects/' + c.project + '/databases/(default)/documents';
  function call(method, url, body) {
    var o = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, contentType: 'application/json' };
    if (body) o.payload = JSON.stringify(body);
    var res = UrlFetchApp.fetch(url, o), code = res.getResponseCode();
    if (code === 404) return null;
    if (code >= 300) throw new Error(method + ' ' + url + ' → ' + code + ' ' + res.getContentText());
    return JSON.parse(res.getContentText());
  }
  return {
    get: function (path) { var d = call('get', base + '/' + path); return d ? fromFields(d.fields) : null; },
    query: function (coll, filters) {
      var ff = filters.map(function (f) { return { fieldFilter: { field: { fieldPath: f[0] }, op: 'EQUAL', value: toValue(f[2]) } }; });
      var where = ff.length === 1 ? ff[0] : { compositeFilter: { op: 'AND', filters: ff } };
      var res = call('post', base + ':runQuery', { structuredQuery: { from: [{ collectionId: coll }], where: where } }) || [];
      return res.filter(function (x) { return x.document; }).map(function (x) {
        var o = fromFields(x.document.fields); o.id = x.document.name.split('/').pop(); return o;
      });
    },
    patch: function (path, obj) {
      var mask = Object.keys(obj).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
      // currentDocument.exists=true: ha közben törölték, ne hozzon létre üres dokumentumot
      return call('patch', base + '/' + path + '?' + mask + '&currentDocument.exists=true', { fields: toFields(obj) });
    }
  };
}

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
function fromFields(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = fromValue(f[k]); }); return o; }
function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  return { stringValue: String(x) };
}
function toFields(o) { var f = {}; Object.keys(o).forEach(function (k) { f[k] = toValue(o[k]); }); return f; }

/* Próba: e-mail küldése az értesítési címre. Futtasd egyszer a beállítás után. */
function testEmail() {
  var c = cfg_(), priv = firestore_(c).get('settings/private') || {};
  if (!priv.notifyEmail) throw new Error('Az admin felületen még nincs megadva értesítési e-mail-cím.');
  send_(priv.notifyEmail, 'Próba – Bendi foglalási rendszer', 'Ha ezt olvasod, az e-mail-küldés működik.', 'Bendi Időpontfoglalás', null);
  Logger.log('Próbalevél elküldve: ' + priv.notifyEmail);
}
