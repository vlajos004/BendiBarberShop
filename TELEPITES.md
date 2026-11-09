# Bendi Időpontfoglalás – telepítési útmutató

Kb. 30–40 perc, egyszer kell megcsinálni. **Gép kell hozzá** (a Firebase konzol és az Apps Script telefonon kényelmetlen). Programot telepíteni nem kell, minden a böngészőben megy.

## Mi micsoda

| Fájl | Mire való |
|---|---|
| `index.html` | A weboldal: regisztráció, foglalás, nyitvatartás, elérhetőség |
| `admin.html` | Bendi felülete: jóváhagyás, naptár, zárolás, beállítások |
| `confirm.html` | Ide visz az emlékeztető e-mail „megerősítem / lemondom” linkje |
| `adatkezeles.html` | Adatkezelési tájékoztató (**minta, ki kell tölteni**) |
| `common.js`, `style.css`, `morph.js` | Közös kód, dizájn és a nyitókép animációja |
| `config.js` | **Ide kell beírni a Firebase-adatokat** (2. lépés) |
| `firestore.rules` | Adatbázis-szabályok (3. lépés) |
| `apps-script/Code.gs` | E-mail-küldő (5. lépés), ez **nem** megy fel a GitHubra |

---

## 1. Firebase-projekt létrehozása (ingyenes, kártya nélkül)

1. Nyisd meg a https://console.firebase.google.com oldalt, és lépj be egy Google-fiókkal (lehet a külön Gmail is).
2. **Projekt létrehozása** → név: pl. `bendi-barber` → a Google Analyticset kapcsold ki → Létrehozás.
3. A csomag maradjon **Spark (ingyenes)**. Kártyát ne adj meg.

## 2. Webalkalmazás hozzáadása → `config.js`

1. A projekt kezdőlapján kattints a **`</>`** (Web) ikonra → név: `weboldal` → a Hosting pipát **ne** jelöld be → Regisztrálás.
2. Megjelenik egy `firebaseConfig = { ... }` blokk. Az értékeit másold be a `config.js` fájlba a helykitöltők helyére.
3. Jegyezd fel külön az **apiKey** és a **projectId** értékét, az 5. lépésben kellenek.

## 3. Bejelentkezés és adatbázis

**Authentication:**
1. Bal menü → **Build → Authentication** → Kezdés → **Email/Password** → Engedélyezés → Mentés.
2. **Settings → Authorized domains** → Domain hozzáadása: `vlajos004.github.io`.
3. **Templates** fülön a nyelvet állítsd magyarra (a jelszó-visszaállító levél miatt).

**Firestore:**
1. Bal menü → **Build → Firestore Database** → Adatbázis létrehozása.
2. Hely: **EU-s régió** (pl. `eur3 (europe-west)` vagy `europe-central2 (Warsaw)`). **Ezt később nem lehet megváltoztatni.**
3. Indítás **production mode**-ban.
4. A **Rules** fülön töröld a meglévő szöveget, másold be a teljes `firestore.rules` tartalmát → **Publish**.

## 4. Admin fiókok

Két fiók kell: **Bendié** (ő ezzel lép be az adminba) és a **szkripté** (a külön Gmail, ezzel küldi az e-maileket).

1. **Authentication → Users → Add user**:
   - Bendi e-mail-címe + egy jelszó,
   - a külön Gmail-cím (pl. `bendibarber.foglalas@gmail.com`) + egy **erős, csak erre használt** jelszó.
2. Mindkét sorban másold ki a **User UID**-t (hosszú betű–szám sor).
3. **Firestore → Start collection** → gyűjtemény neve: `admins`
   - Dokumentum-azonosító: **Bendi UID-ja**, mező: `note` (string) = `Bendi` → Mentés.
   - **Add document** → azonosító: **a szkript UID-ja**, mező: `note` = `e-mail szkript` → Mentés.

## 5. E-mail-küldő (Google Apps Script, ingyenes)

1. Lépj be a **külön Gmail-fiókkal** a https://script.google.com oldalra → **Új projekt**.
2. Töröld a minta kódot, és másold be az `apps-script/Code.gs` teljes tartalmát. Nevezd el pl. `Bendi e-mail`-nek → Mentés.
3. Bal oldalt a fogaskerék (**Projektbeállítások**) → **Időzóna:** `(GMT+01:00) Budapest`.
4. Ugyanitt lent: **Szkripttulajdonságok → Tulajdonság hozzáadása** (pontosan ezekkel a nevekkel):

   | Tulajdonság | Érték |
   |---|---|
   | `API_KEY` | a 2. lépés apiKey-e |
   | `PROJECT_ID` | a 2. lépés projectId-ja |
   | `ADMIN_EMAIL` | a külön Gmail-cím (a 4. lépésben felvett szkriptfiók) |
   | `ADMIN_PASSWORD` | annak a jelszava |
   | `SITE_URL` | `https://vlajos004.github.io/BendiBarberShop/` |

5. Vissza a szerkesztőbe → fent a függvényválasztóban válaszd ki: **`setup`** → **Futtatás**.
6. Engedélyt kér: válaszd a fiókot → „A Google nem ellenőrizte az alkalmazást” → **Speciális → Ugrás a(z) Bendi e-mail oldalra** → Engedélyezés. (Ez a saját szkripted, ezért nincs ellenőrizve.)
7. Ha a napló végén azt írja, hogy „Kész”, akkor a szkript mostantól 5 percenként fut.

## 6. Feltöltés a GitHubra

1. **A régi Bendi appot ne töröld:** a GitHubon a mostani `index.html`-t nevezd át `app.html`-re (megnyitod → ceruza → a fájlnév mezőben átírod → Commit). Bendi így továbbra is eléri a régi adatait a `…/BendiBarberShop/app.html` címen.
2. **Add file → Upload files** → töltsd fel ezeket (egyszerre is lehet): `index.html`, `admin.html`, `confirm.html`, `adatkezeles.html`, `common.js`, `morph.js`, `style.css`, `config.js` → Commit.
3. 1–2 perc múlva nyisd meg: `https://vlajos004.github.io/BendiBarberShop/admin.html` → lépj be **Bendi** fiókjával.
4. Az admin **Beállítások** fülön állítsd be:
   - értesítési e-mail-cím (ide jönnek az új foglalások),
   - nyitvatartás, választható időtartamok, cím és telefonszám (ezek most mintaadatok!),
   - szükség esetén az emlékeztető szövege.
5. Futtasd az Apps Scriptben a **`testEmail`** függvényt: ha megjön a próbalevél, működik a küldés.

---

## Próba élesítés előtt

1. Regisztrálj vendégként egy másik e-mail-címmel, és foglalj időpontot holnapra.
2. 5 percen belül Bendi e-mailt kap → az adminban **Elfogadom** → a vendég e-mailt kap.
3. 16:00 után (vagy ha holnapra foglaltál 16 óra után, 5 percen belül) megjön az emlékeztető → kattints a linkre → **Nem tudok jönni** → az időpont újra szabad a weboldalon.
4. Az első leveleket nézd meg a **Spam** mappában is. Ha ott vannak, jelöld „Nem spam”-nek.

## Amit tudni kell

- **Korlátok:** a Gmail kb. napi 100 levelet enged Apps Scriptből, ez egy szalonnak bőven elég.
- **A szkript jelszava** a szkripttulajdonságokban van. Aki hozzáfér a külön Gmailhez, látja. Ezért legyen ez a fiók csak erre használva.
- **A „max. 2 jövőbeli foglalás” korlátot** a weboldal ellenőrzi. Aki ügyesen megkerüli, azt Bendi a jóváhagyásnál elutasíthatja és **letilthatja**.
- **Az adatkezelési tájékoztató** minta: töltsd ki a sárga részeket, és élesítés előtt nézesd át szakemberrel.
- Ha valami nem működik, a böngészőben az F12 → Console fül hibaüzenete, illetve az Apps Script **Végrehajtások** menüje mutatja, mi a gond.
