# Ranasinghe Motors POS - Render version (shared cloud data)

Meka POS eka Render eke run karanna puluwan widiyata hadapu project ekak. Hama device ekakama (kade PC, cashier ge phone,
Korea idan owner ge phone) **ekama data** penawa: badu, bill, customers, points, day close.

## Files
- `server.js` - small Node server (login, data sync, backups). Framework nathi.
- `public/index.html` - POS page eka (same file eka Netlify ekatath damma ganna puluwan; Netlify eke eka device ekata witharai data).
- `package.json`, `render.yaml` - Render settings.

## Data save wenne kohe? (mehema thoranna ONA)
Render free web service eke **files delete wenawa** (restart / redeploy / sleep welawe). Eka nisa data save karanna thanak ona.

| Option | Data surakshitada? | Mila (Render eke docs walin) |
|---|---|---|
| **A. Starter web service + Persistent Disk** (recommended) | Ow. Disk eke JSON file ekak + dawasakata backup 1 (dina 14k) | Paid. Disk eka paid service ekakata witharai. Mila render.com/pricing eke balanna |
| **B. Free web service + free external Postgres** (Neon / Supabase wage) | Ow, ehema DB eka expire wenne naha nam | Free, namuth free web service eka **idle minute 15kin sleep** wenawa. Udae palaweni bill ekata ~1 min wait karanna wenawa |
| C. Free web service + Render free Postgres | **Naha.** Render free Postgres **dina 30kin expire** wenawa, passe dina 14kin delete wenawa | Free - **test karanna witharai** |

Option A: kade eke wada walata hondama. Option B: free, namuth udae mulin slow.

## Deploy karana widiya (Option A)
1. **GitHub** eke private repository ekak hadala me files okkoma (`server.js`, `package.json`, `render.yaml`, `public/index.html`, `.gitignore`) upload karanna.
2. render.com -> **New -> Blueprint** -> repo eka thoranna -> `render.yaml` eka use karanawa. (Nathnam **New -> Web Service**: Runtime **Node**, Build `npm install`, Start `node server.js`, Health check `/healthz`.)
3. Web Service walata **Disk** ekak ekathu karanna: Mount path `/var/data`, size 1 GB. (Blueprint eken auto enawa.)
4. **Environment variables**:
   - `DATA_DIR` = `/var/data`
   - `SESSION_SECRET` = hadisi akuru godak (Blueprint eken auto)
   - `ADMIN_PIN` = oyage admin PIN eka (default 1234 ona naha - **wenas karanna**)
5. Deploy iwara wunama `https://<oyage-nama>.onrender.com` link eka enawa. Eka kade eke saha oyage phone eke open karanna.

## Option B (free Postgres ekka)
- neon.tech (ho supabase.com) eke free Postgres ekak hadala **connection string** eka ganna.
- Render web service eka **Free** plan ekata, `DATA_DIR` nathuwa, **`DATABASE_URL`** = ema connection string eka damma deploy karanna.
- Disk ona naha.

## Palaweni wara
1. Link eka open karanna -> **Admin** -> PIN eka (`ADMIN_PIN` ho 1234).
2. **Settings (profile icon eke menu eke) -> Admin / Users** eke cashier la hadanna (nama + PIN).
3. Kade eke device walin cashier widiyata login wenna. Oya (admin) Korea idan login wela sales/profit balanna.
4. Kalin eka device ekakata thibuna data thiyenawanam, eka device eken **palaweni login** ekedi auto cloud ekata merge wenawa (kisima deyak nathi wenne naha).

## Security
- PIN walin login: **server eke** check wenawa. 8 waradi try kalama minute 5k block wenawa.
- **Cashier ta** badu mila, users, settings, admin PIN wenas karanna ba (server eka eka nawathanawa). Stock adu kirimata witharai badu edit karanna puluwan.
- Admin PIN / cashier PIN **godak sulabha** nam wenas karanna.
- Internet thiyenne naththam bill ekak ahanna puluwan (device eke save wenawa); internet awama auto sync wenawa. Namuth **device dekak ekama welawe offline wela bill ahanoth bill numbers samana wenna puluwan.**

## Backup
- App eke **Settings -> Backup** eken file ekak gannnna puluwan (owner ta).
- Option A: server eka dawasakata ekak `backup-YYYY-MM-DD.json` kiyala disk eke save karanawa (dina 14k).

## Local eke test karanna
```
npm install
ADMIN_PIN=1234 node server.js     # http://localhost:3000
```
