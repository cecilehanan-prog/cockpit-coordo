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
     L'ancien emplacement est mis en pause (copie gardée dans « etat-ancien »), ces appareils affichent « ⚠ à vérifier ».

   Version 2026-11-20f : « Synchro OK » reste OK toute seule.
   - Un appareil resté sur l'ancien code ne fait plus passer CET appareil en « ⚠ à vérifier » (ses ajouts sont repris ;
     l'information reste dans la fenêtre Synchro).
   - Mise en veille, réveil, coupure réseau, onglet laissé ouvert : la synchro revérifie toute seule (au retour sur l'appli, au
     réveil de l'ordinateur, au retour du réseau, et toutes les 4 minutes), relance la connexion Firebase si elle s'est figée,
     et réessaie un envoi raté (5 s, 20 s, 1 min, puis toutes les 2 min). « ⚠ à vérifier » ne s'affiche plus que si le
     problème dure (plus de 3 essais ratés de suite avec internet) ou s'il faut une action (phrase secrète, clé changée). */
(() => {
'use strict';
const CFG = window.COCKPIT_FIREBASE;
const APP = () => window.cockpitSync; // fourni par app.js : { cle, appliquer(d) }
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const L = { cle: 'cockpit-sync-cle', sel: 'cockpit-sync-sel', vu: 'cockpit-sync-vu2', base: 'cockpit-sync-base2',
  copie: 'cockpit-pas-v1-copie-avant-synchro', copie2: 'cockpit-pas-v1-copie-avant-v2' };
const DOC = 'etat-v2', ANCIEN = 'etat', ANCIEN_SAUVE = 'etat-ancien', PAUSE = 'en-pause-mettre-a-jour';
const ITER = 600000;
const VERSION = '2026-11-28e'; // affichée dans la fenêtre Synchro : permet de vérifier que l'appareil a la dernière version
let distant = null; // { appareil, savedAt } du dernier bloc vu en ligne
// journal de la synchro (visible dans la fenêtre Synchro, gardé sur l'appareil) : dit exactement où ça en est
let etape = '';
const JOURNAL = (() => { try { return JSON.parse(localStorage.getItem('cockpit-sync-journal') || '[]'); } catch { return []; } })();
function noter(txt) { etape = txt; JOURNAL.push({ t: new Date().toISOString(), txt: String(txt).slice(0, 200) }); if (JOURNAL.length > 40) JOURNAL.splice(0, JOURNAL.length - 40); try { localStorage.setItem('cockpit-sync-journal', JSON.stringify(JOURNAL)); } catch {} }
// rien ne doit pouvoir attendre indéfiniment (réseau, IndexedDB, chargement d'un script…)
const delai = (p, ms, quoi) => new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error(quoi + ' : pas de réponse au bout de ' + Math.round(ms / 1000) + ' s')), ms); Promise.resolve(p).then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); ko(e); }); });
let echecs = 0, premierEchec = 0, relanceMinu = 0, dernierOK = 0, derniereVerif = 0; // auto-réparation : essais ratés de suite, relance prévue
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
let idbOk = true;
async function baseLire() { if (idbOk) { try { const v = await idb('readonly', s => s.get('base')); if (v) return v; } catch (e) { idbOk = false; noter('IndexedDB indisponible (' + (e.message || e) + ') : localStorage utilisé'); } } return get(L.base); }
async function baseEcrire(txt) { if (idbOk) { try { await idb('readwrite', s => s.put(txt, 'base')); put(L.base, null); return; } catch (e) { idbOk = false; noter('IndexedDB indisponible (' + (e.message || e) + ') : localStorage utilisé'); } } try { localStorage.setItem(L.base, txt); } catch { put(L.base, null); } }

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
// la version « d » contient-elle les dernières modifications de « ref » ? (ses 30 lignes de journal les plus récentes)
function descend(d, ref) {
  const r = (ref && ref.journal || []).slice(0, 30); if (!r.length) return true;
  const cles = new Set((d && d.journal || []).map(j => j.date + '|' + j.texte));
  return r.every(j => cles.has(j.date + '|' + j.texte));
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
async function compresser(brut) {
  try { const g = await flux(brut, window.CompressionStream); if (g) return g; } catch {}
  try { if (!window.fflate) await delai(charger('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js'), 15000, 'Chargement de fflate'); return window.fflate.gzipSync(brut); } catch { return null; } // vieux Safari / iPhone : compression quand même (envoi 5 fois plus léger)
}
async function chiffrer(texte, raw) {
  const brut = new TextEncoder().encode(texte), gz = await compresser(brut);
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
const ancienMsg = () => `${ancienActif.appareil || 'Un appareil'} a encore l'ancienne version (enregistré le ${quand(ancienActif.savedAt)}) : ses ajouts sont repris ici, mais il ne reçoit plus les nouveautés. Mets-le à jour : ouvre https://cecilehanan-prog.github.io/cockpit-coordo/ dessus.`;
function ancienRegle() { // l'appareil a été mis à jour depuis : il apparaît avec la nouvelle version, après son dernier envoi à l'ancien emplacement
  if (!ancienActif) return; const n = ancienActif.appareil;
  if (Date.now() - Date.parse(ancienActif.savedAt || 0) > 864e5) { ancienActif = null; return; } // plus rien de cet appareil depuis un jour
  if (Object.values(appareils).some(a => a && a.nom === n && a.vu > (ancienActif.savedAt || ''))) ancienActif = null;
}
function dire(e, m) {
  ancienRegle();
  if (e === 'ok') { echecs = 0; clearTimeout(relanceMinu); relanceMinu = 0; dernierOK = Date.now(); }
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
// un même appareil peut apparaître plusieurs fois (données du navigateur effacées) : on ne montre que sa dernière apparition, et rien de plus vieux que 30 jours
function appareilsVisibles() {
  const L = Object.entries(appareils).filter(([id, a]) => a && a.vu && (id === monId || Date.now() - Date.parse(a.vu) < 30 * 864e5)).sort((a, b) => String(b[1].vu).localeCompare(String(a[1].vu)));
  const cle = a => (a.nom || '') + '|' + (a.code || ''), moi = L.find(([id]) => id === monId), vus = new Set(moi ? [cle(moi[1])] : []);
  return L.filter(([id, a]) => { if (id === monId) return true; if (vus.has(cle(a))) return false; vus.add(cle(a)); return true; });
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
    ${window.cockpitEcritures ? (() => { const E = window.cockpitEcritures(), L = Object.entries(E).filter(([k]) => k !== 'jour'), t = L.reduce((a, [, v]) => a + v, 0); return `<p class="small muted" style="margin:4px 0 0">Enregistrements envoyés à Firebase aujourd'hui par cet appareil : <b>${t}</b>${L.length ? ' (' + L.map(([k, v]) => echap(k) + ' ' + v).join(', ') + ')' : ''}. Limite gratuite : 20 000 par jour pour tous tes appareils.</p>`; })() : ''}
    <p class="small muted" style="margin:4px 0 0">Version ${VERSION} (code ${window.COCKPIT_CODE_SOURCE === 'github' ? 'pris sur GitHub' : 'de cet appareil'})${distant ? ` · dernier envoi en ligne : ${echap(distant.appareil || '?')}, ${quand(distant.savedAt)}` : ''}</p>
    ${connecte && Object.keys(appareils).length ? `<div class="small" style="margin-top:8px"><b>Tes appareils</b>${appareilsVisibles().map(([id, a]) => `<div>${id === monId ? '▸ ' : ''}${echap(a.nom)} · version ${echap(a.version)}${a.version === VERSION ? ' ✓' : ' <b style="color:var(--bad,#c33)">ancienne</b>'} · vu le ${quand(a.vu)}${id === monId ? ' (cet appareil)' : ''}</div>`).join('')}</div>` : ''}
    ${ancienActif ? `<p class="small" style="margin-top:8px;color:var(--bad,#c33)"><b>⚠ ${echap(ancienMsg())}</b></p>` : ''}
    ${connecte ? `<details style="margin-top:10px"><summary class="small"><b>Cet appareil a les bonnes données : les envoyer à tous</b></summary><p class="small muted">Tes autres appareils prennent les données de celui-ci (ils gardent une copie des leurs, récupérable ici).</p><button class="btn sm" type="button" id="sync-imposer">Envoyer les données de cet appareil à tous</button></details>` : ''}
    ${copies.length ? `<details style="margin-top:10px"><summary class="small"><b>Revenir à une copie gardée sur cet appareil</b></summary>${copies.map((c, i) => `
      <div class="small" style="margin:8px 0;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px">${echap(c.lib)} : <b>${quand(c.quand)}</b>, ${c.nb} élèves.
        ${c.plus.length ? `<div>En plus dans la copie : ${echap(c.plus.slice(0, 12).join(', '))}${c.plus.length > 12 ? '…' : ''}</div>` : ''}
        ${c.moins.length ? `<div>Absents de la copie : ${echap(c.moins.slice(0, 12).join(', '))}${c.moins.length > 12 ? '…' : ''}</div>` : ''}
        ${!c.plus.length && !c.moins.length ? '<div class="muted">Mêmes élèves que maintenant.</div>' : ''}
        <button class="btn sm" type="button" data-copie="${i}" style="margin-top:6px">Revenir à cette copie</button></div>`).join('')}</details>` : ''}
    <details style="margin-top:10px"><summary class="small"><b>Journal de la synchro</b> (à envoyer à Claude en cas de souci)</summary><div class="small" style="max-height:180px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:6px">${JOURNAL.slice().reverse().map(j => `<div>${new Date(j.t).toLocaleString('fr-FR')} · ${echap(j.txt)}</div>`).join('') || '<div class="muted">vide</div>'}</div></details>
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="sync-fermer">Fermer</button></div></div>`;
  document.body.appendChild(w);
  w.querySelector('#sync-fermer').onclick = () => w.remove();
  const f = w.querySelector('#sync-form'); if (f) f.onsubmit = e => { e.preventDefault(); connecter(f.querySelector('#sync-mail').value.trim(), f.querySelector('#sync-mdp').value, f.querySelector('#sync-phrase').value); };
  const rz = w.querySelector('#sync-reset'); if (rz) { rz.onclick = recommencer; rz.hidden = !enAttente; }
  const o = w.querySelector('#sync-out'); if (o) o.onclick = deconnecter;
  const m = w.querySelector('#sync-maint'); if (m) m.onclick = () => { echecs = 0; verifier('demandé', true); };
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
let attenteMinu = 0;
let auth = null, docRef = null, arret = null, applique = false, minuterie = 0, pret = false;
const charger = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
const dossier = u => firebase.firestore().collection('coffres').doc(u.uid).collection('cockpit');
// une seule opération à la fois (réception, réunion, envoi) : rien ne se croise
let file = Promise.resolve();
const enFile = fn => (file = file.then(() => delai(fn(), 150000, 'Synchro bloquée'), () => delai(fn(), 150000, 'Synchro bloquée')).catch(e => { noter('ERREUR ' + (etape ? '[' + etape + '] ' : '') + (e && (e.code || e.message) || e)); console.warn('Synchro', e);  incident('Erreur de synchro' + (etape ? ' (étape : ' + etape + ')' : '') + ' : ' + (e && (e.code || e.message) || e)); }));
// Problème passager (réseau, veille, Firebase lent) : on réessaie tout seul. « ⚠ à vérifier » seulement si ça dure.
const PAUSES = [5000, 20000, 60000, 120000];
// 28/11 : Firebase a atteint sa limite gratuite du jour (remise à zéro vers 9 h) : on le dit clairement et on réessaie
// seulement toutes les 30 minutes (chaque essai coûte aussi une lecture). Les données restent enregistrées sur cet appareil.
const MSG_QUOTA = "Firebase a atteint sa limite d’envois pour aujourd’hui. Tes modifications sont bien enregistrées sur CET appareil et partiront toutes seules dès que Firebase les acceptera (en général le lendemain vers 9 h). D’ici là, ne réinitialise pas cet appareil et ne le déconnecte pas de la synchro.";
function incidentQuota() {
  if (!echecs) premierEchec = Date.now(); echecs++; noter('Firebase plein (limite du jour atteinte) → nouvel essai dans 30 minutes');
  dire('err', MSG_QUOTA);
  clearTimeout(relanceMinu); relanceMinu = setTimeout(() => { relanceMinu = 0; verifier('nouvel essai après limite Firebase', false); }, 30 * 60000);
}
function incident(msg) {
  if (!echecs) premierEchec = Date.now(); echecs++; noter('incident n° ' + echecs + ' : ' + msg + ' → nouvel essai automatique');
  if (!navigator.onLine) dire('hors', 'Hors ligne : tes données restent enregistrées sur cet appareil, elles partiront au retour de la connexion.');
  else if (echecs > 3 && Date.now() - premierEchec > 150000) dire('err', msg + ' (nouvel essai automatique toutes les 2 minutes ; « Synchroniser maintenant » pour réessayer tout de suite)');
  else dire('cours', 'Reconnexion en cours…');
  clearTimeout(relanceMinu); relanceMinu = setTimeout(() => { relanceMinu = 0; verifier('nouvel essai', echecs > 1); }, PAUSES[Math.min(echecs - 1, PAUSES.length - 1)]);
}
// Revérifie l'état en ligne (lecture directe du serveur) : reçoit ce qui manque, envoie ce qui n'est pas parti.
// relancer = true : la connexion Firebase est d'abord coupée puis rouverte (elle peut rester figée après une mise en veille).
function verifier(raison, relancer) {
  if (!utilisateur || !get(L.cle) || !auth || !APP()) return;
  derniereVerif = Date.now();
  return enFile(async () => {
    noter('vérification (' + raison + ')');
    if (relancer) { try { const db = firebase.firestore(); await delai(db.disableNetwork(), 10000, 'Coupure Firebase'); await delai(db.enableNetwork(), 10000, 'Relance Firebase'); } catch (e) { noter('relance Firebase : ' + (e.message || e)); } }
    if (!docRef) { ecouter(utilisateur); return; }
    const d = await lireServeur('Vérification en ligne');
    pret = true; clearTimeout(attenteMinu);
    await recevoir(d);
  });
}
async function demarrer() {
  bouton();
  if (!CFG) { dire('attente', 'La synchro sera prête dès que ton espace Firebase sera branché.'); return; }
  try { for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await charger(FB + f); }
  catch { dire('hors', 'Pas de connexion internet : tes données restent enregistrées sur cet appareil.'); return; }
  try { if (!firebase.apps.length) firebase.initializeApp(CFG); auth = firebase.auth();
    // connexion « simple » (requêtes ordinaires) : certains réseaux, pare-feu ou antivirus laissent passer les lectures mais bloquent
    // les écritures en flux continu de Firebase (l'envoi restait alors sans réponse)
    try { firebase.firestore().settings({ experimentalForceLongPolling: true }); } catch (e) { console.warn('réglage Firestore', e); } }
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
  noter('connectée, attente des données en ligne'); dire('cours', 'Connectée avec ' + (u.email || '') + ' : attente des données en ligne…');
  clearTimeout(attenteMinu); attenteMinu = setTimeout(() => { if (!pret) { noter('aucune réponse de Firebase après 30 s'); incident("Firebase ne répond pas (connexion internet ?)"); } }, 30000);
  const a1 = docRef.onSnapshot(s => { if (s.metadata && s.metadata.hasPendingWrites) return; if (s.metadata && s.metadata.fromCache && !s.exists) return; /* pas encore la réponse du serveur : on ne conclut pas « espace vide » */ const d = s.data(); enFile(() => recevoir(d)); },
    e => { noter('écoute interrompue : ' + (e && (e.code || e.message) || e)); if (arret) { arret(); arret = null; } docRef = null; incident("Lecture de ton espace Firebase interrompue (" + (e && (e.code || e.message) || e) + ')'); });
  // un appareil resté sur l'ancien code écrit encore à l'ancien emplacement : on le signale, on garde ce qu'il a envoyé, on remet la pause
  const a2 = dossier(u).doc(ANCIEN).onSnapshot(s => { const d = s.data(); if (d && d.data && d.sel !== PAUSE) enFile(() => mettreAncienEnPause(u, d)); }, () => {});
  const a3 = dossier(u).doc('appareils').onSnapshot(s => { appareils = s.data() || {}; if (ancienActif) ancienRegle(); }, () => {});
  signaler(); // hors de la file : ne retarde jamais la réception
  arret = () => { a1(); a2(); a3(); };
}
/* ---------- écriture : Firebase normal, et si l'envoi ne répond pas, envoi direct par l'API web de Firestore ---------- */
const MES_ENVOIS = 'cockpit-sync-mes-envois'; // dates des versions envoyées par cet appareil (pour reconnaître un ancien envoi arrivé en retard)
function retenirEnvoi(at) { if (!at) return; let l = []; try { l = JSON.parse(get(MES_ENVOIS) || '[]'); } catch {} l.push(at); put(MES_ENVOIS, JSON.stringify(l.slice(-30))); }
const dejaEnvoye = at => { try { return JSON.parse(get(MES_ENVOIS) || '[]').includes(at); } catch { return false; } };
let modeNormal = false; // passe à true pour la session si l'envoi direct est impossible sur ce réseau
function champsRest(o) { const f = {}; for (const [k, v] of Object.entries(o)) f[k] = typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : v == null ? { nullValue: null } : { stringValue: String(v) }; return { fields: f }; }
async function ecrireDirect(chemin, o) {
  const tok = await delai(auth.currentUser.getIdToken(), 20000, 'Jeton de connexion');
  const url = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents/' + chemin.split('/').map(encodeURIComponent).join('/');
  const r = await delai(fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(champsRest(o)) }), 60000, 'Envoi direct');
  if (!r.ok) { let t = ''; try { t = (await r.text()).slice(0, 160); } catch {} const e = new Error('envoi direct refusé (' + r.status + ') ' + t); e.http = r.status; e.quota = r.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(t); throw e; }
}
// lecture directe (API web de Firestore) : toujours la vraie version du serveur
async function lireDirect(chemin) {
  const tok = await delai(auth.currentUser.getIdToken(), 20000, 'Jeton de connexion');
  const url = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents/' + chemin.split('/').map(encodeURIComponent).join('/');
  const r = await delai(fetch(url, { headers: { Authorization: 'Bearer ' + tok } }), 30000, 'Lecture directe');
  if (r.status === 404) return undefined;
  if (!r.ok) { const e = new Error('lecture directe refusée (' + r.status + ')'); e.quota = r.status === 429; throw e; }
  const j = await r.json(), o = {};
  for (const [k, v] of Object.entries(j.fields || {})) o[k] = 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : null;
  return o;
}
// 28/11 : un envoi resté en attente dans Firebase (refusé car limite du jour atteinte, Firebase le garde et réessaie sans fin)
// apparaissait dans les lectures comme s'il était déjà en ligne : l'appareil se croyait « à jour », et à la réouverture
// l'ancienne version en ligne effaçait ses modifications (questions à poser perdues). On ne se fie donc qu'à la vraie version du serveur.
async function lireServeur(quoi) {
  const s = await delai(docRef.get({ source: 'server' }), 30000, quoi);
  if (!(s.metadata && s.metadata.hasPendingWrites)) return s.data();
  noter('un envoi est encore en attente dans Firebase : lecture directe du serveur');
  return lireDirect(docRef.path);
}
// 28/11 : envoi direct d'abord (réponse claire, rien ne reste en attente dans Firebase) ; l'envoi normal ne sert que si
// l'envoi direct est impossible sur ce réseau (erreur de connexion, pas un refus du serveur)
async function ecrire(ref, o, quoi) {
  if (!modeNormal) {
    try { await ecrireDirect(ref.path, o); noter('envoyé (envoi direct) : ' + ref.path.split('/').pop()); return; }
    catch (e) { if (e.http || !/fetch|network|load failed|réseau/i.test(String(e.message || e))) throw e; modeNormal = true; noter('envoi direct impossible sur ce réseau : envoi normal'); }
  }
  return await delai(ref.set(o), 20000, quoi);
}
// fiche de cet appareil (nom, version du code, dernier contact) : visible dans la fenêtre Synchro de tous les appareils
let dernierSignal = 0;
async function signaler() {
  if (!utilisateur) return;
  if (Date.now() - dernierSignal < 20 * 60000 && appareils[monId] && appareils[monId].version === VERSION) return; // 26/11 : au plus toutes les 20 minutes (économie d'enregistrements Firebase)
  dernierSignal = Date.now();
  try { await delai(dossier(utilisateur).doc('appareils').set({ [monId]: { nom: nomAppareil(), version: VERSION, code: window.COCKPIT_CODE_SOURCE || 'local', vu: new Date().toISOString() } }, { merge: true }), 20000, 'Liste des appareils'); } catch (e) { console.warn('appareils', e); }
}
// L'ancien emplacement (« etat ») servait aux anciennes versions du code. On en garde une copie (« etat-ancien »), puis on le
// remplace par un bloc « en pause » : un appareil resté sur l'ancien code affiche « ⚠ à vérifier » et n'envoie plus rien.
async function mettreAncienEnPause(u, d) {
  try {
    const anc = dossier(u).doc(ANCIEN);
    if (!d || d.sel === PAUSE || !d.data) return;
    const sauve = dossier(u).doc(ANCIEN_SAUVE);
    noter('ancien emplacement : un appareil à l’ancien code a écrit (' + (d.appareil || '?') + ', ' + quand(d.savedAt) + ')');
    if (!(await delai(sauve.get(), 20000, 'Ancien emplacement')).exists) await ecrire(sauve, d, 'Ancien emplacement'); // état au moment du passage à la nouvelle synchro
    else { // envoyé ENSUITE par un appareil pas encore mis à jour (ex. iPhone) : on reprend ce qu'il a ajouté ou modifié, sans rien effacer
      const derRef = dossier(u).doc('etat-ancien-dernier'), prec = (await delai(derRef.get(), 20000, 'Ancien emplacement')).data();
      if (!(prec && prec.savedAt === d.savedAt && prec.data === d.data)) await reprendreAncien(d, prec);
      await ecrire(derRef, d, 'Ancien emplacement');
      if (Date.now() - Date.parse(d.savedAt || 0) < 3 * 3600e3) { ancienActif = { appareil: d.appareil, savedAt: d.savedAt }; noter('info : ' + ancienMsg()); } }
    await ecrire(anc, { v: 1, sel: PAUSE, iv: '', data: 'pause', gz: false, savedAt: '', appareil: 'ANCIENNE VERSION : mets à jour cet appareil (nouveau code du 20/11)' }, 'Ancien emplacement');
  } catch (e) { console.warn('Ancien emplacement', e); }
}
// Reprise de ce qu'un appareil à l'ancien code a enregistré. Base = son envoi précédent (ses changements exacts depuis) ;
// pour son premier envoi, base inconnue : on ajoute ce qui manque ici, et en cas de désaccord CET appareil l'emporte (rien n'est effacé ni remis en arrière).
async function reprendreAncien(d, prec) {
  const raw = get(L.cle), local = get(APP().cle); if (!raw || !local || !d.sel || d.sel !== get(L.sel)) return;
  try {
    const lire = async x => JSON.parse(await delai(dechiffrer(x, unb64(raw)), 20000, 'Déchiffrement ancien appareil'));
    const lui = await lire(d); let base = null;
    // une base n'est valable que si l'ancien appareil en descend : ses 50 dernières lignes du journal sont toutes chez lui
    const cles = new Set((lui.journal || []).map(j => j.date + '|' + j.texte));
    const descend = b => b && (b.journal || []).slice(0, 50).every(j => cles.has(j.date + '|' + j.texte));
    for (const x of [prec, (await delai(dossier(utilisateur).doc(ANCIEN_SAUVE).get(), 20000, 'Ancien emplacement')).data()]) {
      if (!x || !x.data || x.sel !== d.sel) continue; let b = null; try { b = await lire(x); } catch {} if (descend(b)) { base = b; break; } }
    const ici = JSON.parse(local);
    const m = reunirEtats(base, lui, ici); // désaccord : « ici » l'emporte
    if (sansDate(m) === sansDate(ici)) return noter('rien de nouveau venant de ' + (d.appareil || "l'ancien appareil"));
    if (get(APP().cle) !== local) return; // une saisie est arrivée entre-temps : on reprendra au prochain envoi de l'ancien appareil
    m._savedAt = new Date().toISOString(); APP().appliquer(m); // modification de cet appareil : part vers les autres
    noter('ajouts de ' + (d.appareil || "l'ancien appareil") + ' repris' + (base ? '' : ' (sans rien effacer)'));
  } catch (e) { noter('reprise impossible : ' + (e.message || e)); }
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
  const q = "Recommencer avec cette nouvelle phrase ?\n\nLes données de CET appareil deviendront la référence pour tous tes appareils. Fais-le depuis ton Mac, qui a les bonnes données.";
  if (!(await (window.demander ? window.demander(q, { ok: 'Recommencer', danger: true }) : Promise.resolve(confirm(q))))) return;
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
  noter('reçu en ligne : ' + (d && d.data ? (d.appareil || '?') + ', ' + quand(d.savedAt) : 'espace vide'));
  const raw = get(L.cle); if (!raw || !APP()) return;
  if (d && d.sel && get(L.sel) && d.sel !== get(L.sel)) return dire('err', 'La clé a changé sur un autre appareil : reconnecte celui-ci.');
  const local = get(APP().cle), lAt = savedAt(local), vu = get(L.vu) || '';
  pret = true;
  if (!d || !d.data) return envoyerMaintenant(true); // espace vide : cet appareil l'initialise avec ses données
  if (d.savedAt !== vu && d.savedAt < vu && dejaEnvoye(d.savedAt)) { noter('ancien envoi de cet appareil arrivé en retard : on renvoie la version actuelle'); return envoyerMaintenant(true, 0, true); }
  if (d.savedAt === lAt) { if (vu !== lAt) { put(L.vu, lAt); await baseEcrire(local); } return dire('ok', 'Tout est à jour.'); }
  if (d.savedAt === vu) return lAt !== vu && local ? envoyerMaintenant() : dire('ok', 'Tout est à jour.'); // rien de nouveau en ligne ; nos changements partent
  // il y a du nouveau en ligne
  noter('déchiffrement');
  let p; try { p = await ouvrir(d, unb64(raw)); } catch { return dire('err', 'Impossible de déchiffrer : vérifie ta phrase secrète (déconnecte puis reconnecte cet appareil).'); }
  let texte; try { texte = new TextDecoder().decode(d.gz ? await delai(decompresser(p), 20000, 'Décompression') : p); } catch (e) { return incident("Décompression des données reçues impossible pour l'instant (" + (e.message || e) + ')'); }
  const dist = JSON.parse(texte);
  noter('application des données reçues');
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
  const loc = JSON.parse(local);
  // 28/11 : une version en ligne ne remplace celle de cet appareil que si elle contient ses dernières modifications (lignes
  // récentes du journal) et n'est pas plus ancienne que la dernière vue. Sinon (envoi refusé, appareil qui se croyait à jour,
  // ancien envoi arrivé tard) : on réunit sans rien effacer, et en cas de désaccord ce qui est sur cet appareil l'emporte.
  const prudent = (d.savedAt < vu && !dejaEnvoye(d.savedAt)) || (lAt === vu && !descend(dist, loc));
  if (lAt === vu && !prudent) { // seul l'autre appareil a changé
    if (get(APP().cle) !== local) return essai < 3 ? recevoir(d, essai + 1) : planifier(); // une saisie est arrivée pendant le déchiffrement : on recommence
    appliquerRecu(dist); put(L.vu, d.savedAt); await baseEcrire(texte); apresApplication(d.savedAt);
    return dire('ok', 'Mis à jour depuis ' + (d.appareil || 'un autre appareil') + '.');
  }
  // les deux ont changé : on réunit, à partir de la dernière version commune
  noter(prudent ? 'version en ligne sans les dernières modifications de cet appareil : réunion sans rien effacer' : 'réunion des modifications des deux appareils');
  let base = null; if (!prudent) try { const bt = await baseLire(); const bo = bt && JSON.parse(bt); if (bo && bo._savedAt === vu && descend(dist, bo)) base = bo; } catch {}
  const m = prudent ? reunirEtats(null, dist, loc) : reunirEtats(base, loc, dist);
  if (get(APP().cle) !== local) return essai < 3 ? recevoir(d, essai + 1) : planifier(); // une saisie est arrivée pendant la réunion : on recommence
  if (sansDate(m) === sansDate(dist)) { appliquerRecu(dist); put(L.vu, d.savedAt); await baseEcrire(texte); apresApplication(d.savedAt); return dire('ok', 'Mis à jour depuis ' + (d.appareil || 'un autre appareil') + '.'); }
  m._savedAt = new Date().toISOString();
  appliquerRecu(m); put(L.vu, d.savedAt); await baseEcrire(texte);
  await envoyerMaintenant();
  dire('ok', 'Modifications de cet appareil et de ' + (d.appareil || "l'autre appareil") + ' réunies.');
}
const nomAppareil = () => /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Electron/.test(navigator.userAgent) ? 'Mac (appli)' : /\.netlify\.app$/.test(location.hostname) ? 'Netlify' : /github\.io$/.test(location.hostname) ? 'github.io' : 'navigateur';
function envoyer(force) { return enFile(() => envoyerMaintenant(force)); }
async function envoyerMaintenant(force, essai = 0, ecraser = false) {
  const raw = get(L.cle); if (!docRef || !raw || (!pret && !force)) return;
  const local = get(APP().cle); if (!local) return;
  const at = savedAt(local), vu = get(L.vu) || '';
  dire('cours', null); noter('envoi des données de cet appareil');
  try {
    const c = await chiffrer(local, unb64(raw));
    const doc = { v: 2, sel: get(L.sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: at, appareil: nomAppareil(), version: VERSION, remplace: false };
    // on n'écrase jamais une version en ligne qu'on n'a pas encore vue : on la réunit d'abord
    let autre = null;
    // lecture puis écriture simples (les mêmes opérations que l'ancienne synchro, qui marchaient partout ; pas de « transaction »)
    const d = await lireServeur('Lecture avant envoi');
    if (!ecraser && d && d.data && d.savedAt !== vu && d.savedAt !== at && !(d.savedAt < vu && dejaEnvoye(d.savedAt))) autre = d;
    else { noter('envoi en cours (' + Math.round(c.data.length / 1024) + ' Ko' + (c.gz ? ', compressé' : '') + ')'); retenirEnvoi(at); await ecrire(docRef, doc, 'Envoi'); }
    noter(autre ? 'une version plus récente est en ligne : réunion' : 'envoyé');
    if (autre) return essai < 3 ? recevoir(autre) : incident('Plusieurs appareils enregistrent en même temps');
    put(L.vu, at); await baseEcrire(local); dire('ok', 'Tout est à jour.'); signaler();
 } catch (e) { noter('envoi non abouti : ' + (e.code || e.message || e)); if (e.quota || /resource-exhausted/i.test(e.code || '')) return incidentQuota(); incident("L'envoi n'a pas abouti (" + (e.code || e.message || '') + ')'); }
}
// l'appareil qui a les bonnes données les impose à tous les autres (qui gardent une copie des leurs)
function imposer() {
  return enFile(async () => {
    const raw = get(L.cle), local = get(APP().cle); if (!docRef || !raw || !local) return dire('err', "Cet appareil n'est pas connecté ou n'a pas de données.");
    const o = JSON.parse(local); o._savedAt = new Date().toISOString(); const txt = JSON.stringify(o);
    applique = true; try { localStorage.setItem(APP().cle, txt); } finally { applique = false; }
    const c = await chiffrer(txt, unb64(raw));
    noter('envoi à tous (cet appareil fait référence)');
    retenirEnvoi(o._savedAt); await ecrire(docRef, { v: 2, sel: get(L.sel), iv: c.iv, data: c.data, gz: c.gz, savedAt: o._savedAt, appareil: nomAppareil(), version: VERSION, remplace: true }, 'Envoi');
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
// Retour sur l'appli, réveil de l'ordinateur, retour du réseau, et contrôle régulier : la synchro se revérifie toute seule
addEventListener('online', () => { echecs = 0; verifier('retour du réseau', true); });
addEventListener('offline', () => { if (utilisateur && get(L.cle)) dire('hors', 'Hors ligne : tes données restent enregistrées sur cet appareil, elles partiront au retour de la connexion.'); });
const auRetour = raison => { if (document.hidden) return; if (Date.now() - derniereVerif > 45000) verifier(raison, Date.now() - dernierOK > 10 * 60000); };
document.addEventListener('visibilitychange', () => auRetour("retour sur l'appli"));
addEventListener('focus', () => auRetour("retour sur l'appli"));
addEventListener('pageshow', () => auRetour('page réaffichée'));
let tic = Date.now();
setInterval(() => { const n = Date.now(), dort = n - tic > 90000; tic = n; // l'ordinateur s'est mis en veille : les minuteries étaient arrêtées
  if (dort) { echecs = 0; verifier("réveil de l'appareil", true); }
  else if (n - derniereVerif > 4 * 60000 && !relanceMinu) verifier('contrôle régulier', etat === 'err');
}, 15000);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
window.cockpitSyncTest = { chiffrer, dechiffrer, deriver, reunirEtats, descend };
})();
