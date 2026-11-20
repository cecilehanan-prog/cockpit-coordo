/* ====================== SYNCHRO CHIFFRÉE (Mac, iPad, iPhone) ======================
   Toutes les données du cockpit sont chiffrées SUR L'APPAREIL (AES-GCM 256, clé tirée d'une phrase secrète
   que seule Cécile connaît, PBKDF2 600 000 tours) avant d'être envoyées dans son espace Firebase privé.
   Firebase ne voit qu'un bloc illisible et la date du dernier enregistrement.
   Rien n'est actif tant que window.COCKPIT_FIREBASE (js/sync-config.js) est vide.

   Version 2026-11-20a : les modifications ne « ressautent » plus.
   - Avant : la copie enregistrée le plus récemment remplaçait TOUT. Un appareil resté sur de vieilles données (Mac ouvert,
     onglet oublié) enregistrait quelque chose tout seul au démarrage (rappels, statuts…) : sa vieille copie devenait « la plus
     récente » et effaçait partout les imports et les saisies faites ailleurs.
   - Maintenant : quand deux appareils ont changé, on RÉUNIT les deux (élève par élève, champ par champ, à partir de la
     dernière version commune). Rien n'est effacé sauf ce qui a vraiment été supprimé.
   - Nouvel emplacement en ligne (« etat-v2 ») : les appareils qui ont encore l'ancien code ne peuvent plus rien écraser.
     L'ancien emplacement est mis en pause (copie gardée dans « etat-ancien »), ces appareils affichent « ⚠ à vérifier ». */
(() => {
'use strict';
const CFG = window.COCKPIT_FIREBASE;
const APP = () => window.cockpitSync; // fourni par app.js : { cle, appliquer(d) }
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const L = { cle: 'cockpit-sync-cle', sel: 'cockpit-sync-sel', vu: 'cockpit-sync-vu2', base: 'cockpit-sync-base2',
  copie: 'cockpit-pas-v1-copie-avant-synchro', copie2: 'cockpit-pas-v1-copie-avant-v2' };
const DOC = 'etat-v2', ANCIEN = 'etat', ANCIEN_SAUVE = 'etat-ancien', PAUSE = 'en-pause-mettre-a-jour';
const ITER = 600000;
const VERSION = '2026-11-20b'; // affichée dans la fenêtre Synchro : permet de vérifier que l'appareil a la dernière version
let distant = null; // { appareil, savedAt } du dernier bloc vu en ligne
let ancienActif = null; // un appareil resté sur l'ancien code a enregistré : { appareil, savedAt }
let appareils = {}; // liste des appareils connectés à la nouvelle synchro (doc « appareils »)
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const monId = (() => { let i = get('cockpit-sync-appareil'); if (!i) { i = 'ap' + Math.random().toString(36).slice(2, 10); put('cockpit-sync-appareil', i); } return i; })();
const savedAt = txt => { try { return JSON.parse(txt)._savedAt || ''; } catch { return ''; } };

/* ---------- dernière version commune (sert à réunir les modifications de deux appareils) ---------- */
// gardée dans IndexedDB (place suffisante) ; à défaut dans localStorage ; à défaut, la réunion se fait sans rien supprimer
function idb(mode, fn) {
  return new Promise((ok, ko) => {
    if (!window.indexedDB) return ko(new Error('pas d’IndexedDB'));
    const minu = setTimeout(() => ko(new Error('IndexedDB ne répond pas')), 3000); // certains Safari ne répondent jamais : on n'attend pas
    const ok0 = ok, ko0 = ko; ok = v => { clearTimeout(minu); ok0(v); }; ko = e => { clearTimeout(minu); ko0(e); };
    const r = indexedDB.open('cockpit-sync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => ko(r.error);
    r.onsuccess = () => { const db = r.result; let q; try { const t = db.transaction('kv', mode); q = fn(t.objectStore('kv')); t.oncomplete = () => { db.close(); ok(q && q.result); }; t.onerror = t.onabort = () => { db.close(); ko(t.error); }; } catch (e) { db.close(); ko(e); } };
  });
}
async function baseLire() { try { const v = await idb('readonly', s => s.get('base')); if (v) return v; } catch {} return get(L.base); }
async function baseEcrire(txt) { try { await idb('readwrite', s => s.put(txt, 'base')); put(L.base, null); return; } catch {} try { localStorage.setItem(L.base, txt); } catch { put(L.base, null); } }

/* ---------- réunion de deux versions (base = dernière version commune ; INCONNUE = on ne sait pas : rien n'est supprimé) ---------- */
const ABSENT = { absent: 1 }, INCONNUE = { inconnue: 1 };
const egal = (a, b) => a === b || (a !== ABSENT && b !== ABSENT && a !== INCONNUE && b !== INCONNUE && JSON.stringify(a) === JSON.stringify(b));
const estObj = x => x !== null && typeof x === 'object' && !Array.isArray(x) && x !== ABSENT && x !== INCONNUE;
function cleDe(x) {
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    if (x.id != null) return 'id:' + x.id;
    if (x.occId != null) return 'occ:' + x.occId;
    if (x.eleveId != null && x.aeshId != null && x.date == null) return 'af:' + x.eleveId + '|' + x.aeshId; // affectation élève ↔ AESH
  }
  return 'v:' + JSON.stringify(x);
}
function indexer(t) { const m = new Map(), vus = {}; (t || []).forEach(x => { const k0 = cleDe(x); const n = vus[k0] = (vus[k0] || 0) + 1; m.set(n > 1 ? k0 + '#' + n : k0, x); }); return m; }
function enfant(b, k) { if (b === INCONNUE) return INCONNUE; return estObj(b) && Object.prototype.hasOwnProperty.call(b, k) ? b[k] : ABSENT; }
function reunir(b, l, r) {
  if (egal(l, r)) return l;
  if (b !== INCONNUE) { if (egal(l, b)) return r; if (egal(r, b)) return l; }
  if (l === ABSENT) return r; // supprimé ici, modifié là-bas : on garde
  if (r === ABSENT) return l;
  if (estObj(l) && estObj(r)) {
    const o = {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
      const v = reunir(enfant(b, k), k in l ? l[k] : ABSENT, k in r ? r[k] : ABSENT);
      if (v !== ABSENT) o[k] = v;
    }
    return o;
  }
  if (Array.isArray(l) && Array.isArray(r)) {
    const bm = b === INCONNUE ? INCONNUE : Array.isArray(b) ? indexer(b) : new Map(), lm = indexer(l), rm = indexer(r), out = [];
    const bv = k => bm === INCONNUE ? INCONNUE : bm.has(k) ? bm.get(k) : ABSENT;
    for (const [k, rv] of rm) { const v = reunir(bv(k), lm.has(k) ? lm.get(k) : ABSENT, rv); if (v !== ABSENT) out.push(v); }
    for (const [k, lv] of lm) if (!rm.has(k)) { const v = reunir(bv(k), lv, ABSENT); if (v !== ABSENT) out.push(v); }
    return out;
  }
  return r; // même valeur changée des deux côtés : la version en ligne l'emporte
}
// base, local, distant : objets (états complets du cockpit). Renvoie l'état réuni.
function reunirEtats(base, local, dist) {
  const m = reunir(base == null ? INCONNUE : base, local, dist);
  if (Array.isArray(m.journal)) m.journal.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return m;
}
const sansDate = o => { const c = { ...o }; delete c._savedAt; return JSON.stringify(c); };

/* ---------- chiffrement ---------- */
async function deriver(phrase, sel) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations: ITER }, base, 256);
}
const cleAes = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function flux(data, Stream) {
  if (typeof Stream === 'undefined') return null;
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer());
}
async function chiffrer(texte, raw) {
  const brut = new TextEncoder().encode(texte), gz = await flux(brut, window.CompressionStream);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cleAes(raw), gz || brut);
  return { iv: b64(iv), data: b64(c), gz: !!gz };
}
// Étape 1 : AES seul. S'il réussit, la phrase est la bonne (un mauvais mot de passe échoue ici, nulle part ailleurs).
const ouvrir = async (doc, raw) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(doc.iv) }, await cleAes(raw), unb64(doc.data)));
// Étape 2 : décompression. Les vieux iPad / iPhone (avant iOS 16.4) n'ont pas DecompressionStream : on charge alors fflate.
async function decompresser(p) {
  if (typeof DecompressionStream !== 'undefined') { try { return await flux(p, window.DecompressionStream); } catch {} }
  if (!window.fflate) await charger('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
  return window.fflate.gunzipSync(p);
}
async function dechiffrer(doc, raw) {
  const p = await ouvrir(doc, raw);
  return new TextDecoder().decode(doc.gz ? await decompresser(p) : p);
}

/* ---------- interface ---------- */
const quand = t => { try { return t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '?'; } catch { return String(t); } };
const echap = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let etat = 'off', message = '', utilisateur = null;
const ancienMsg = () => `Un appareil a encore l'ancienne version (${ancienActif.appareil || '?'}, enregistré le ${quand(ancienActif.savedAt)}) : ce qu'il enregistre n'arrive pas ici. Mets-le à jour (voir la fenêtre Synchro).`;
function ancienRegle() { // l'appareil a été mis à jour depuis : il apparaît avec la nouvelle version, après son dernier envoi à l'ancien emplacement
  if (!ancienActif) return; const n = ancienActif.appareil;
  if (Date.now() - Date.parse(ancienActif.savedAt || 0) > 864e5) { ancienActif = null; return; } // plus rien de cet appareil depuis un jour
  if (Object.values(appareils).some(a => a && a.nom === n && a.vu > (ancienActif.savedAt || ''))) ancienActif = null;
}
function dire(e, m) {
  ancienRegle(); if (ancienActif && (e === 'ok' || e === 'cours')) { e = 'err'; m = ancienMsg(); }
  etat = e; if (m != null) message = m;
  const t = { off: 'Synchro : non connectée', attente: 'Synchro : à configurer', cours: 'Synchro : en cours…', ok: 'Synchro : ✓ à jour', hors: 'Synchro : hors ligne', err: 'Synchro : ⚠ à vérifier' }[e];
  const b = document.getElementById('sync-pill'); if (b) { b.textContent = t; b.dataset.etat = e; }
  const m2 = document.getElementById('sync-msg'); if (m2) m2.textContent = message;
}
function bouton() {
  const side = document.querySelector('.sidebar'); if (!side || document.getElementById('sync-pill')) return;
  const b = document.createElement('button'); b.id = 'sync-pill'; b.type = 'button'; b.className = 'sync-pill no-print'; b.onclick = fenetre;
  const foot = side.querySelector('.foot'); side.insertBefore(b, foot); dire(CFG ? 'off' : 'attente');
}
// copies gardées sur cet appareil (avant qu'une synchro ne les remplace) : on peut y revenir
function copiesGardees() {
  let cur = null; try { cur = JSON.parse(get(APP().cle) || 'null'); } catch {}
  const noms = s => new Set((s && s.eleves || []).filter(e => !e.archive).map(e => (e.nom || '') + ' ' + (e.prenom || '')));
  const nc = noms(cur);
  return [[L.copie, 'Copie gardée avant une synchro'], [L.copie2, 'Copie gardée au passage à la nouvelle synchro']].map(([k, lib]) => {
    let s = null; try { s = JSON.parse(get(k) || 'null'); } catch {} if (!s || !Array.isArray(s.eleves)) return null;
    const n = noms(s), plus = [...n].filter(x => !nc.has(x)), moins = [...nc].filter(x => !n.has(x));
    return { k, lib, s, quand: s._savedAt, nb: n.size, plus, moins };
  }).filter(Boolean);
}
function fenetre() {
  const ex = document.getElementById('sync-modal'); if (ex) ex.remove();
  if (typeof window.toggleMenu === 'function') window.toggleMenu(false); // iPhone : on referme le menu avant d'ouvrir la fenêtre
  const w = document.createElement('div'); w.id = 'sync-modal'; w.className = 'modal-bg no-print'; w.style.zIndex = 70;
  w.onclick = e => { if (e.target === w) w.remove(); };
  const connecte = !!(utilisateur && get(L.cle));
  const copies = APP() ? copiesGardees() : [];
  w.innerHTML = `<div class="modal" style="width:min(480px,94vw)"><h2 style="margin-top:0">Synchronisation</h2>
    <p class="small muted">Tes données sont chiffrées sur cet appareil avec ta <b>phrase secrète</b> avant d'être envoyées. Personne d'autre, ni Google ni Claude, ne peut les lire. Utilise la même phrase sur le Mac, l'iPad et l'iPhone.</p>
    ${!CFG ? `<p><b>Pas encore disponible :</b> ton espace Firebase n'est pas encore branché.</p>` : connecte ? `
      <p>Connectée : <b>${echap(utilisateur.email || '')}</b></p>
      <div class="toolbar"><button class="btn" id="sync-maint">Synchroniser maintenant</button><button class="btn" id="sync-out">Se déconnecter de cet appareil</button></div>` : `
      <form id="sync-form" style="display:grid;gap:8px">
        <label>E-mail Firebase<br><input type="email" id="sync-mail" required autocomplete="username" style="width:100%"></label>
        <label>Mot de passe Firebase<br><input type="password" id="sync-mdp" required autocomplete="current-password" style="width:100%"></label>
        <label>Phrase secrète (au moins 12 caractères, la même sur tous tes appareils)<br><input type="password" id="sync-phrase" required minlength="12" autocomplete="off" style="width:100%"></label>
        <button class="btn primary" type="submit">Connecter cet appareil</button>
        <button class="btn" type="button" id="sync-reset" hidden>J'ai oublié ma phrase : recommencer depuis cet appareil</button>
      </form>`}
    <p class="small" id="sync-msg" style="margin-top:10px">${echap(message)}</p>
    <p class="small muted" style="margin:4px 0 0">Version ${VERSION} (code ${window.COCKPIT_CODE_SOURCE === 'github' ? 'pris sur GitHub' : 'de cet appareil'})${distant ? ` · dernier envoi en ligne : ${echap(distant.appareil || '?')}, ${quand(distant.savedAt)}` : ''}</p>
    ${connecte && Object.keys(appareils).length ? `<div class="small" style="margin-top:8px"><b>Tes appareils</b>${Object.entries(appareils).sort((a, b) => String(b[1].vu).localeCompare(String(a[1].vu))).map(([id, a]) => `<div>${id === monId ? '▸ ' : ''}${echap(a.nom)} · version ${echap(a.version)}${a.version === VERSION ? ' ✓' : ' <b style="color:var(--bad,#c33)">ancienne</b>'} · vu le ${quand(a.vu)}${id === monId ? ' (cet appareil)' : ''}</div>`).join('')}</div>` : ''}
    ${ancienActif ? `<p class="small" style="margin-top:8px;color:var(--bad,#c33)"><b>⚠ ${echap(ancienMsg())}</b></p>` : ''}
    ${connecte ? `<details style="margin-top:10px"><summary class="small"><b>Cet appareil a les bonnes données : les envoyer à tous</b></summary><p class="small muted">Tes autres appareils prennent les données de celui-ci (ils gardent une copie des leurs, récupérable ici).</p><button class="btn sm" type="button" id="sync-imposer">Envoyer les données de cet appareil à tous</button></details>` : ''}
    ${copies.length ? `<details style="margin-top:10px"><summary class="small"><b>Revenir à une copie gardée sur cet appareil</b></summary>${copies.map((c, i) => `
      <div class="small" style="margin:8px 0;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px">${echap(c.lib)} : <b>${quand(c.quand)}</b>, ${c.nb} élèves.
        ${c.plus.length ? `<div>En plus dans la copie : ${echap(c.plus.slice(0, 12).join(', '))}${c.plus.length > 12 ? '…' : ''}</div>` : ''}
        ${c.moins.length ? `<div>Absents de la copie : ${echap(c.moins.slice(0, 12).join(', '))}${c.moins.length > 12 ? '…' : ''}</div>` : ''}
        ${!c.plus.length && !c.moins.length ? '<div class="muted">Mêmes élèves que maintenant.</div>' : ''}
        <button class="btn sm" type="button" data-copie="${i}" style="margin-top:6px">Revenir à cette copie</button></div>`).join('')}</details>` : ''}
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="sync-fermer">Fermer</button></div></div>`;
  document.body.appendChild(w);
  w.querySelector('#sync-fermer').onclick = () => w.remove();
  const f = w.querySelector('#sync-form'); if (f) f.onsubmit = e => { e.preventDefault(); connecter(f.querySelector('#sync-mail').value.trim(), f.querySelector('#sync-mdp').value, f.querySelector('#sync-phrase').value); };
  const rz = w.querySelector('#sync-reset'); if (rz) { rz.onclick = recommencer; rz.hidden = !enAttente; }
  const o = w.querySelector('#sync-out'); if (o) o.onclick = deconnecter;
  const m = w.querySelector('#sync-maint'); if (m) m.onclick = () => envoyer(true);
  const im = w.querySelector('#sync-imposer'); if (im) im.onclick = () => { if (!im.dataset.ok) { im.dataset.ok = '1'; im.className = 'btn sm danger'; im.textContent = 'Confirmer : remplacer les données de tous mes appareils par celles-ci'; return; } w.remove(); imposer(); };
  // deux clics (les fenêtres de confirmation du navigateur peuvent être bloquées)
  w.querySelectorAll('[data-copie]').forEach(b => b.onclick = () => {
    const c = copies[+b.dataset.copie]; if (!c) return;
    if (!b.dataset.ok) { b.dataset.ok = '1'; b.className = 'btn sm danger'; b.textContent = 'Confirmer : remplacer les données actuelles par cette copie'; return; }
    const s = JSON.parse(JSON.stringify(c.s)); s._savedAt = new Date().toISOString();
    try { localStorage.setItem(APP().cle + '-avant-copie', get(APP().cle) || ''); } catch {}
    APP().appliquer(s); // enregistré comme une modification de cet appareil : part vers les autres
    w.remove(); dire(etat, 'Copie remise en place sur cet appareil.');
  });
}

/* ---------- Firebase ---------- */
let auth = null, docRef = null, arret = null, applique = false, minuterie = 0, pret = false;
const charger = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
const dossier = u => firebase.firestore().collection('coffres').doc(u.uid).collection('cockpit');
// une seule opération à la fois (réception, réunion, envoi) : rien ne se croise
let file = Promise.resolve();
const enFile = fn => (file = file.then(fn, fn).catch(e => { console.warn('Synchro', e); dire('err', 'Erreur de synchro : ' + (e && (e.code || e.message) || e)); }));
async function demarrer() {
  bouton();
  if (!CFG) { dire('attente', 'La synchro sera prête dès que ton espace Firebase sera branché.'); return; }
  try { for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await charger(FB + f); }
  catch { dire('hors', 'Pas de connexion internet : tes données restent enregistrées sur cet appareil.'); return; }
  try { if (!firebase.apps.length) firebase.initializeApp(CFG); auth = firebase.auth(); }
  catch (e) { dire('err', 'Firebase ne démarre pas : ' + (e.message || e)); return; }
  auth.onAuthStateChanged(u => {
    utilisateur = u; if (arret) { arret(); arret = null; } docRef = null; pret = false;
    if (!u || !get(L.cle)) { dire('off', u ? 'Entre ta phrase secrète pour finir de connecter cet appareil.' : 'Connecte cet appareil une fois : ensuite tout se synchronise tout seul.'); return; }
    ecouter(u);
  });
}
function ecouter(u) {
  if (arret) arret();
  utilisateur = u; pret = false;
  docRef = dossier(u).doc(DOC);
  dire('cours', 'Connectée avec ' + (u.email || '') + '.');
  const a1 = docRef.onSnapshot(s => { if (s.metadata && s.metadata.hasPendingWrites) return; const d = s.data(); enFile(() => recevoir(d)); },
    () => dire('err', "Je n'arrive pas à lire ton espace Firebase (règles ?)."));
  // un appareil resté sur l'ancien code écrit encore à l'ancien emplacement : on le signale, on garde ce qu'il a envoyé, on remet la pause
  const a2 = dossier(u).doc(ANCIEN).onSnapshot(s => { const d = s.data(); if (d && d.data && d.sel !== PAUSE) enFile(() => mettreAncienEnPause(u, d)); }, () => {});
  const a3 = dossier(u).doc('appareils').onSnapshot(s => { appareils = s.data() || {}; if (ancienActif) { ancienRegle(); if (!ancienActif) dire('ok', 'Tout est à jour.'); } }, () => {});
  enFile(signaler);
  arret = () => { a1(); a2(); a3(); };
}
// fiche de cet appareil (nom, version du code, dernier contact) : visible dans la fenêtre Synchro de tous les appareils
async function signaler() {
  if (!utilisateur) return;
  try { await dossier(utilisateur).doc('appareils').set({ [monId]: { nom: nomAppareil(), version: VERSION, code: window.COCKPIT_CODE_SOURCE || 'local', vu: new Date().toISOString() } }, { merge: true }); } catch (e) { console.warn('appareils', e); }
}
// L'ancien emplacement (« etat ») servait aux anciennes versions du code. On en garde une copie (« etat-ancien »), puis on le
// remplace par un bloc « en pause » : un appareil resté sur l'ancien code affiche « ⚠ à vérifier » et n'envoie plus rien.
async function mettreAncienEnPause(u, d) {
  try {
    const anc = dossier(u).doc(ANCIEN);
    if (!d || d.sel === PAUSE || !d.data) return;
    const sauve = dossier(u).doc(ANCIEN_SAUVE);
    if (!(await sauve.get()).exists) await sauve.set(d); // état au moment du passage à la nouvelle synchro
    else { await dossier(u).doc('etat-ancien-dernier').set(d); ancienActif = { appareil: d.appareil, savedAt: d.savedAt }; // envoyé ENSUITE par un appareil pas mis à jour
      dire('err', `Un appareil a encore l'ancienne version (${d.appareil || '?'}, ${quand(d.savedAt)}) : ce qu'il enregistre n'arrive pas ici. Mets-le à jour.`); }
    await anc.set({ v: 1, sel: PAUSE, iv: '', data: 'pause', gz: false, savedAt: '', appareil: 'ANCIENNE VERSION : mets à jour cet appareil (nouveau code du 20/11)' });
  } catch (e) { console.warn('Ancien emplacement', e); }
}
// L'iPad et l'iPhone remplacent souvent ' par ’ (et ajoutent parfois un espace) : on essaie ces variantes
function variantes(p) {
  const droit = p.replace(/[‘’ʼ]/g, "'").replace(/[“”«»]/g, '"');
  const courbe = p.replace(/'/g, '’');
  return [...new Set([p, p.trim(), droit, droit.trim(), courbe, courbe.trim(), droit.trim().replace(/\s+/g, ' ')])];
}
let enAttente = null; // { u, ref, phrase } quand la phrase ne correspond pas
async function connecter(mail, mdp, phrase) {
  if (!auth) return dire('err', "Firebase n'est pas encore chargé : vérifie la connexion internet.");
  if (phrase.trim().length < 12) return dire('err', 'La phrase secrète doit faire au moins 12 caractères.');
  dire('cours', 'Connexion…');
  try {
    const u = (await auth.signInWithEmailAndPassword(mail, mdp)).user;
    const ref = dossier(u).doc(DOC);
    // la phrase se vérifie sur le bloc en ligne : le nouveau, sinon la copie de l'ancien
    let d = (await ref.get()).data();
    if (!(d && d.data)) { for (const n of [ANCIEN_SAUVE, ANCIEN]) { const x = (await dossier(u).doc(n).get()).data(); if (x && x.data && x.sel && x.sel !== PAUSE) { d = x; break; } } }
    if (d) distant = { appareil: d.appareil, savedAt: d.savedAt };
    if (!(d && d.data)) { const sel0 = crypto.getRandomValues(new Uint8Array(16)); dire('cours', 'Préparation de la clé (quelques secondes)…'); return brancher(u, ref, await deriver(phrase.trim(), sel0), sel0); }
    const sel = unb64(d.sel);
    const essais = variantes(phrase);
    for (let i = 0; i < essais.length; i++) {
      dire('cours', `Vérification de la phrase secrète${essais.length > 1 ? ` (${i + 1}/${essais.length})` : ''}…`);
      const raw = await deriver(essais[i], sel);
      try { await ouvrir(d, raw); return brancher(u, ref, raw, sel); } catch {}
    }
    enAttente = { u, ref, phrase: phrase.trim() };
    dire('err', "Cette phrase secrète ne correspond pas à celle déjà utilisée. Vérifie-la (majuscules, accents). Si tu l'as oubliée, tu peux recommencer depuis l'appareil qui a les bonnes données (ton Mac).");
    const r = document.getElementById('sync-reset'); if (r) r.hidden = false;
  } catch (e) {
    dire('err', /password|credential|user/i.test(e.code || '') ? 'E-mail ou mot de passe Firebase incorrect.' : 'La connexion a échoué : ' + (e.code || e.message || 'réessaie'));
  }
}
async function brancher(u, ref, raw, sel) {
  put(L.sel, b64(sel)); put(L.cle, b64(raw)); put(L.vu, null);
  enAttente = null; document.getElementById('sync-modal')?.remove(); ecouter(u);
}
// Phrase oubliée : on repart de CET appareil, avec la nouvelle phrase (l'ancien bloc chiffré en ligne est remplacé)
async function recommencer() {
  if (!enAttente) return;
  if (!confirm("Recommencer avec cette nouvelle phrase ?\n\nLes données de CET appareil deviendront la référence pour tous tes appareils. Fais-le depuis ton Mac, qui a les bonnes données.")) return;
  const { u, ref, phrase } = enAttente;
  dire('cours', 'Préparation de la nouvelle clé…');
  const sel = crypto.getRandomValues(new Uint8Array(16)), raw = await deriver(phrase, sel);
  const local = get(APP().cle); if (!local) return dire('err', "Cet appareil n'a pas de données à envoyer.");
  const c = await chiffrer(local, raw);
  await ref.set({ v: 2, sel: b64(sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: savedAt(local), appareil: 'recommencé' });
  put(L.sel, b64(sel)); put(L.cle, b64(raw)); put(L.vu, savedAt(local)); await baseEcrire(local);
  enAttente = null; document.getElementById('sync-modal')?.remove(); ecouter(u);
  dire('ok', 'Nouvelle phrase en place. Reconnecte tes autres appareils avec elle.');
}
async function deconnecter() {
  put(L.cle, null); put(L.sel, null); put(L.vu, null);
  if (arret) { arret(); arret = null; } docRef = null;
  try { await auth.signOut(); } catch {}
  document.getElementById('sync-modal')?.remove(); dire('off', "Cet appareil n'est plus synchronisé. Ses données restent dessus.");
}
// applique un état reçu sans le renvoyer (l'appli peut ensuite l'enregistrer elle-même : ce sera une modification de cet appareil)
function appliquerRecu(obj) { applique = true; try { APP().appliquer(obj); } finally { applique = false; } }
function apresApplication(at) { if (savedAt(get(APP().cle)) !== at) planifier(); }
async function recevoir(d, essai = 0) {
  if (d) distant = { appareil: d.appareil, savedAt: d.savedAt };
  const raw = get(L.cle); if (!raw || !APP()) return;
  if (d && d.sel && get(L.sel) && d.sel !== get(L.sel)) return dire('err', 'La clé a changé sur un autre appareil : reconnecte celui-ci.');
  const local = get(APP().cle), lAt = savedAt(local), vu = get(L.vu) || '';
  pret = true;
  if (!d || !d.data) return envoyerMaintenant(true); // espace vide : cet appareil l'initialise avec ses données
  if (d.savedAt === lAt) { if (vu !== lAt) { put(L.vu, lAt); await baseEcrire(local); } return dire('ok', 'Tout est à jour.'); }
  if (d.savedAt === vu) return lAt !== vu && local ? envoyerMaintenant() : dire('ok', 'Tout est à jour.'); // rien de nouveau en ligne ; nos changements partent
  // il y a du nouveau en ligne
  let p; try { p = await ouvrir(d, unb64(raw)); } catch { return dire('err', 'Impossible de déchiffrer : vérifie ta phrase secrète (déconnecte puis reconnecte cet appareil).'); }
  let texte; try { texte = new TextDecoder().decode(d.gz ? await decompresser(p) : p); } catch (e) { return dire('err', "La phrase est bonne, mais cet appareil n'arrive pas à décompresser les données (" + (e.message || e) + '). Vérifie la connexion internet puis recharge la page.'); }
  const dist = JSON.parse(texte);
  if (d.remplace) { // « Envoyer les données de cet appareil à tous » sur un autre appareil : on prend tout (copie de celui-ci gardée)
    if (local && sansDate(JSON.parse(local)) !== sansDate(dist)) put(L.copie, local);
    appliquerRecu(dist); put(L.vu, d.savedAt); await baseEcrire(texte); apresApplication(d.savedAt);
    return dire('ok', 'Données remplacées par celles de ' + (d.appareil || "l'autre appareil") + ' (copie de cet appareil gardée).');
  }
  if (!vu || !local) { // premier passage de cet appareil sur la nouvelle synchro : ce qui est en ligne fait foi (copie de cet appareil gardée)
    if (local && sansDate(JSON.parse(local)) !== sansDate(dist)) put(L.copie2, local);
    appliquerRecu(dist); put(L.vu, d.savedAt); await baseEcrire(texte); apresApplication(d.savedAt);
    return dire('ok', 'Données récupérées depuis ' + (d.appareil || 'un autre appareil') + '.');
  }
  if (lAt === vu) { // seul l'autre appareil a changé
    appliquerRecu(dist); put(L.vu, d.savedAt); await baseEcrire(texte); apresApplication(d.savedAt);
    return dire('ok', 'Mis à jour depuis ' + (d.appareil || 'un autre appareil') + '.');
  }
  // les deux ont changé : on réunit, à partir de la dernière version commune
  let base = null; try { const bt = await baseLire(); const bo = bt && JSON.parse(bt); if (bo && bo._savedAt === vu) base = bo; } catch {}
  const m = reunirEtats(base, JSON.parse(local), dist);
  if (get(APP().cle) !== local) return essai < 3 ? recevoir(d, essai + 1) : planifier(); // une saisie est arrivée pendant la réunion : on recommence
  put(L.vu, d.savedAt); await baseEcrire(texte);
  if (sansDate(m) === sansDate(dist)) { appliquerRecu(dist); apresApplication(d.savedAt); return dire('ok', 'Mis à jour depuis ' + (d.appareil || 'un autre appareil') + '.'); }
  m._savedAt = new Date().toISOString();
  appliquerRecu(m);
  await envoyerMaintenant();
  dire('ok', 'Modifications de cet appareil et de ' + (d.appareil || "l'autre appareil") + ' réunies.');
}
const nomAppareil = () => /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Electron/.test(navigator.userAgent) ? 'Mac (appli)' : /\.netlify\.app$/.test(location.hostname) ? 'Netlify' : /github\.io$/.test(location.hostname) ? 'github.io' : 'navigateur';
function envoyer(force) { return enFile(() => envoyerMaintenant(force)); }
async function envoyerMaintenant(force, essai = 0) {
  const raw = get(L.cle); if (!docRef || !raw || (!pret && !force)) return;
  const local = get(APP().cle); if (!local) return;
  const at = savedAt(local), vu = get(L.vu) || '';
  dire('cours', null);
  try {
    const c = await chiffrer(local, unb64(raw));
    const doc = { v: 2, sel: get(L.sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: at, appareil: nomAppareil(), version: VERSION };
    // on n'écrase jamais une version en ligne qu'on n'a pas encore vue : on la réunit d'abord
    let autre = null;
    await firebase.firestore().runTransaction(async t => {
      const s = await t.get(docRef), d = s.data(); autre = null;
      if (d && d.data && d.savedAt !== vu && d.savedAt !== at) { autre = d; return; }
      t.set(docRef, doc);
    });
    if (autre) return essai < 3 ? recevoir(autre) : dire('err', 'Plusieurs appareils enregistrent en même temps : réessaie dans un instant.');
    put(L.vu, at); await baseEcrire(local); dire('ok', 'Tout est à jour.'); signaler();
  } catch (e) { dire(navigator.onLine ? 'err' : 'hors', navigator.onLine ? "L'envoi a échoué : " + (e.code || e.message || '') : 'Hors ligne : ce sera envoyé au retour de la connexion.'); }
}
// l'appareil qui a les bonnes données les impose à tous les autres (qui gardent une copie des leurs)
function imposer() {
  return enFile(async () => {
    const raw = get(L.cle), local = get(APP().cle); if (!docRef || !raw || !local) return dire('err', "Cet appareil n'est pas connecté ou n'a pas de données.");
    const o = JSON.parse(local); o._savedAt = new Date().toISOString(); const txt = JSON.stringify(o);
    applique = true; try { localStorage.setItem(APP().cle, txt); } finally { applique = false; }
    const c = await chiffrer(txt, unb64(raw));
    await docRef.set({ v: 2, sel: get(L.sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: o._savedAt, appareil: nomAppareil(), version: VERSION, remplace: true });
    put(L.vu, o._savedAt); await baseEcrire(txt); dire('ok', 'Les données de cet appareil sont envoyées à tous tes appareils.'); signaler();
  });
}
function planifier() { clearTimeout(minuterie); minuterie = setTimeout(() => envoyer(), 2000); }
// Chaque enregistrement du cockpit part (chiffré) quelques secondes plus tard
const setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (k, v) {
  setItem.call(this, k, v);
  if (this === window.localStorage && APP() && k === APP().cle && !applique) planifier();
};
addEventListener('online', () => envoyer());
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
window.cockpitSyncTest = { chiffrer, dechiffrer, deriver, reunirEtats };
})();
