/* ====================== SYNCHRO CHIFFRÉE (Mac, iPad, iPhone) ======================
   Toutes les données du cockpit sont chiffrées SUR L'APPAREIL (AES-GCM 256, clé tirée d'une phrase secrète
   que seule Cécile connaît, PBKDF2 600 000 tours) avant d'être envoyées dans son espace Firebase privé.
   Firebase ne voit qu'un bloc illisible et la date du dernier enregistrement.
   Rien n'est actif tant que window.COCKPIT_FIREBASE (js/sync-config.js) est vide. */
(() => {
'use strict';
const CFG = window.COCKPIT_FIREBASE;
const APP = () => window.cockpitSync; // fourni par app.js : { cle, appliquer(d) }
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const L = { cle: 'cockpit-sync-cle', sel: 'cockpit-sync-sel', vu: 'cockpit-sync-vu', copie: 'cockpit-pas-v1-copie-avant-synchro' };
const ITER = 600000;
const VERSION = '2026-11-07e'; // affichée dans la fenêtre Synchro : permet de vérifier que l'appareil a la dernière version
let distant = null; // { appareil, savedAt } du dernier bloc vu en ligne
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const savedAt = txt => { try { return JSON.parse(txt)._savedAt || ''; } catch { return ''; } };

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
let etat = 'off', message = '', utilisateur = null;
function dire(e, m) {
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
function fenetre() {
  const ex = document.getElementById('sync-modal'); if (ex) ex.remove();
  if (typeof window.toggleMenu === 'function') window.toggleMenu(false); // iPhone : on referme le menu avant d'ouvrir la fenêtre
  const w = document.createElement('div'); w.id = 'sync-modal'; w.className = 'modal-bg no-print'; w.style.zIndex = 70;
  w.onclick = e => { if (e.target === w) w.remove(); };
  const connecte = !!(utilisateur && get(L.cle));
  w.innerHTML = `<div class="modal" style="width:min(460px,94vw)"><h2 style="margin-top:0">Synchronisation</h2>
    <p class="small muted">Tes données sont chiffrées sur cet appareil avec ta <b>phrase secrète</b> avant d'être envoyées. Personne d'autre, ni Google ni Claude, ne peut les lire. Utilise la même phrase sur le Mac, l'iPad et l'iPhone.</p>
    ${!CFG ? `<p><b>Pas encore disponible :</b> ton espace Firebase n'est pas encore branché.</p>` : connecte ? `
      <p>Connectée : <b>${(utilisateur.email || '').replace(/[<>&]/g, '')}</b></p>
      <div class="toolbar"><button class="btn" id="sync-maint">Synchroniser maintenant</button><button class="btn" id="sync-out">Se déconnecter de cet appareil</button></div>` : `
      <form id="sync-form" style="display:grid;gap:8px">
        <label>E-mail Firebase<br><input type="email" id="sync-mail" required autocomplete="username" style="width:100%"></label>
        <label>Mot de passe Firebase<br><input type="password" id="sync-mdp" required autocomplete="current-password" style="width:100%"></label>
        <label>Phrase secrète (au moins 12 caractères, la même sur tous tes appareils)<br><input type="password" id="sync-phrase" required minlength="12" autocomplete="off" style="width:100%"></label>
        <button class="btn primary" type="submit">Connecter cet appareil</button>
        <button class="btn" type="button" id="sync-reset" hidden>J'ai oublié ma phrase : recommencer depuis cet appareil</button>
      </form>`}
    <p class="small" id="sync-msg" style="margin-top:10px">${message}</p>
    <p class="small muted" style="margin:4px 0 0">Version ${VERSION}${distant ? ` · dernier envoi en ligne : ${String(distant.appareil || '?').replace(/[<>&]/g, '')}, ${quand(distant.savedAt)}` : ''}</p>
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="sync-fermer">Fermer</button></div></div>`;
  document.body.appendChild(w);
  w.querySelector('#sync-fermer').onclick = () => w.remove();
  const f = w.querySelector('#sync-form'); if (f) f.onsubmit = e => { e.preventDefault(); connecter(f.querySelector('#sync-mail').value.trim(), f.querySelector('#sync-mdp').value, f.querySelector('#sync-phrase').value); };
  const rz = w.querySelector('#sync-reset'); if (rz) { rz.onclick = recommencer; rz.hidden = !enAttente; }
  const o = w.querySelector('#sync-out'); if (o) o.onclick = deconnecter;
  const m = w.querySelector('#sync-maint'); if (m) m.onclick = () => envoyer(true);
}

/* ---------- Firebase ---------- */
let auth = null, docRef = null, arret = null, applique = false, minuterie = 0, pret = false;
const charger = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
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
  docRef = firebase.firestore().collection('coffres').doc(u.uid).collection('cockpit').doc('etat');
  dire('cours', 'Connectée avec ' + (u.email || '') + '.');
  arret = docRef.onSnapshot(s => recevoir(s.data()), () => dire('err', "Je n'arrive pas à lire ton espace Firebase (règles ?)."));
}
// L'iPad et l'iPhone remplacent souvent ' par ’ (et ajoutent parfois un espace) : on essaie ces variantes
function variantes(p) {
  const droit = p.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D\u00AB\u00BB]/g, '"');
  const courbe = p.replace(/'/g, '\u2019');
  return [...new Set([p, p.trim(), droit, droit.trim(), courbe, courbe.trim(), droit.trim().replace(/\s+/g, ' ')])];
}
let enAttente = null; // { u, ref, phrase } quand la phrase ne correspond pas
async function connecter(mail, mdp, phrase) {
  if (!auth) return dire('err', "Firebase n'est pas encore chargé : vérifie la connexion internet.");
  if (phrase.trim().length < 12) return dire('err', 'La phrase secrète doit faire au moins 12 caractères.');
  dire('cours', 'Connexion…');
  try {
    const u = (await auth.signInWithEmailAndPassword(mail, mdp)).user;
    const ref = firebase.firestore().collection('coffres').doc(u.uid).collection('cockpit').doc('etat');
    const d = (await ref.get()).data(); if (d) distant = { appareil: d.appareil, savedAt: d.savedAt };
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
  await ref.set({ v: 1, sel: b64(sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: savedAt(local), appareil: 'recommencé' });
  put(L.sel, b64(sel)); put(L.cle, b64(raw)); put(L.vu, savedAt(local));
  enAttente = null; document.getElementById('sync-modal')?.remove(); ecouter(u);
  dire('ok', 'Nouvelle phrase en place. Reconnecte tes autres appareils avec elle.');
}
async function deconnecter() {
  put(L.cle, null); put(L.sel, null); put(L.vu, null);
  if (arret) { arret(); arret = null; } docRef = null;
  try { await auth.signOut(); } catch {}
  document.getElementById('sync-modal')?.remove(); dire('off', "Cet appareil n'est plus synchronisé. Ses données restent dessus.");
}
async function recevoir(d) {
  if (d) distant = { appareil: d.appareil, savedAt: d.savedAt };
  const raw = get(L.cle); if (!raw) return;
  const local = get(APP().cle), lAt = savedAt(local), vu = get(L.vu) || '';
  if (!d || !d.data) { pret = true; return envoyer(); } // espace vide : cet appareil l'initialise
  if (d.sel && get(L.sel) && d.sel !== get(L.sel)) return dire('err', 'La clé a changé sur un autre appareil : reconnecte celui-ci.');
  pret = true;
  if (d.savedAt === lAt) { put(L.vu, d.savedAt); return dire('ok', 'Tout est à jour.'); }
  const localModifie = lAt && lAt !== vu;
  const premiere = !vu; // premier branchement de cet appareil : l'espace déjà rempli fait foi (copie locale gardée)
  if (premiere || d.savedAt > lAt || !localModifie) {
    let p; try { p = await ouvrir(d, unb64(raw)); } catch { return dire('err', 'Impossible de déchiffrer : vérifie ta phrase secrète (déconnecte puis reconnecte cet appareil).'); }
    let texte; try { texte = new TextDecoder().decode(d.gz ? await decompresser(p) : p); } catch (e) { return dire('err', "La phrase est bonne, mais cet appareil n'arrive pas à décompresser les données (" + (e.message || e) + '). Vérifie la connexion internet puis recharge la page.'); }
    if ((localModifie || premiere) && local) put(L.copie, local); // les deux appareils ont changé : on garde une copie de celui-ci
    applique = true; try { APP().appliquer(JSON.parse(texte)); } finally { applique = false; }
    put(L.vu, d.savedAt);
    dire('ok', localModifie ? 'Mis à jour depuis un autre appareil (une copie de la version de cet appareil est gardée).' : 'Mis à jour depuis un autre appareil.');
  } else envoyer();
}
async function envoyer(force) {
  const raw = get(L.cle); if (!docRef || !raw || (!pret && !force)) return;
  const local = get(APP().cle); if (!local) return;
  const at = savedAt(local);
  dire('cours', null);
  try {
    const c = await chiffrer(local, unb64(raw));
    await docRef.set({ v: 1, sel: get(L.sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: at, appareil: /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Electron/.test(navigator.userAgent) ? 'Mac (appli)' : 'navigateur' });
    put(L.vu, at); dire('ok', 'Tout est à jour.');
  } catch (e) { dire(navigator.onLine ? 'err' : 'hors', navigator.onLine ? "L'envoi a échoué : " + (e.code || e.message || '') : 'Hors ligne : ce sera envoyé au retour de la connexion.'); }
}
// Chaque enregistrement du cockpit part (chiffré) quelques secondes plus tard
const setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (k, v) {
  setItem.call(this, k, v);
  if (this === window.localStorage && APP() && k === APP().cle && !applique) { clearTimeout(minuterie); minuterie = setTimeout(() => envoyer(), 2000); }
};
addEventListener('online', () => envoyer());
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
window.cockpitSyncTest = { chiffrer, dechiffrer, deriver };
})();
