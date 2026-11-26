/* Rubrique « Fiches élèves AESH » (version 2026-11-11, hors GitHub).
   Cockpit fabrique lui-même la page des fiches (chiffrée avec le code d'équipe) : Hanan la dépose sur Netlify (site « fiches »).
   Chaque élève a un code à 4 chiffres ; la correspondance code ↔ élève n'existe que dans Cockpit et dans le classeur imprimé.
   Le code d'équipe et les codes élèves sont gardés dans les données de Cockpit (synchro chiffrée), jamais dans un fichier public. */
(function () {
const SITE_DEFAUT = 'https://fiches-eleves.netlify.app/';
const ITER = 250000;
const K_ANCIEN = 'cockpit-fiches-admin'; // ancien réglage local (code d'équipe) : repris une fois
const MOTS = 'abeille arbre automne balade bambou banane bateau biscuit bougie boussole brioche cactus cahier camion canard carotte cerise chapeau chocolat citron colibri comete crayon dauphin domino echarpe eclair epice etoile falaise fanfare farine fenetre flocon fontaine fougere fraise galet girafe glacier grenade guitare hibou horloge igloo jardin jonquille kiwi lagune lanterne lavande licorne lilas loutre lucarne mandarine manege marron melodie mimosa moulin muguet myrtille nuage oasis olive orange orage panda papillon pastel pelican piano pinceau pirate planete pomme prairie quartz radis raquette renard riviere robot rocher ruban sablier safran sapin satellite sirop soleil sorbet tambour tartine tilleul tortue toupie trefle tulipe vanille velo violon volcan wagon yaourt zebre'.split(' ');
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const $ = q => document.querySelector(q);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
const setTitle = t => { $('#title').textContent = t; $('#topactions').innerHTML = ''; };
const P = () => window.PAS;
const S = () => P().state;
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const hasard = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const nouveauCode = () => [0, 1, 2].map(() => MOTS[hasard(MOTS.length)]).join('-') + '-' + (100 + hasard(900));
const hh = t => String(t || '').replace(':', 'h');

function etat() {
  const s = S();
  if (!s.fiches) {
    let ancien = {}; try { ancien = JSON.parse(localStorage.getItem(K_ANCIEN)) || {}; } catch (e) {}
    s.fiches = { site: SITE_DEFAUT, code: ancien.code || '', change: ancien.change || '', codes: {}, fabrique: '' };
  }
  s.fiches.codes = s.fiches.codes || {}; s.fiches.site = s.fiches.site || SITE_DEFAUT;
  return s.fiches;
}
const sauver = () => P().save();
const urlFiche = (f, code) => f.site.replace(/\/?$/, '/') + '#' + code;

// élèves concernés (20/11) : élèves notifiés ou accompagnés (AESH, créneau), même sans créneau encore saisi
function elevesConcernes() {
  const s = S();
  return (s.eleves || []).filter(e => P().ficheConcernee ? P().ficheConcernee(e) : !e.archive).sort((a, b) => (a.classe || '').localeCompare(b.classe || '', 'fr', { numeric: true }) || (a.nom || '').localeCompare(b.nom || '', 'fr'));
}
// 20/11 : les numéros sont donnés tout seuls à l'enregistrement (app.js, numeroterFiches) : ici on s'assure seulement qu'ils le sont
function attribuerCodes() {
  const f = etat(), avant = Object.keys(f.codes).length;
  if (P().numeroter) P().numeroter(); else elevesConcernes().forEach(e => { if (f.codes[e.id]) return; const pris = new Set(Object.values(f.codes)); let c; do { c = String(1000 + hasard(9000)); } while (pris.has(c)); f.codes[e.id] = c; });
  return Object.keys(f.codes).length - avant;
}

// 26/11 : prénom + initiale du nom, pour savoir qui est qui quand on remplace (lisible seulement avec le code d'équipe)
const initiale = n => { const m = String(n || '').trim().match(/[A-Za-zÀ-ÖØ-öø-ÿ]/); return m ? m[0].toUpperCase() + '.' : ''; };
const frDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const hNotif = h => { const n = Number(h); if (!n) return ''; const e = Math.floor(n), m = Math.round((n - e) * 60); return e + ' h' + (m ? String(m).padStart(2, '0') : ''); };
function notifDe(e) {
  const st = e.statut || '', acc = e.type === 'Individuel' ? 'individuel' : 'mutualisé';
  if (st === 'Notifié') return 'Notification MDPH : accompagnement ' + acc + (e.type === 'Individuel' && hNotif(e.heures) ? ', ' + hNotif(e.heures) + ' par semaine' : '') + (e.notifFin ? ' (jusqu\'au ' + frDate(e.notifFin) + ')' : '');
  if (/renouvellement/i.test(st)) return 'Renouvellement demandé (dossier déposé) : accompagnement ' + acc + ' en attendant la réponse';
  if (/1ère demande/i.test(st)) return 'Première demande déposée : en attente de notification';
  return st ? st + ' : accompagnement ' + acc : 'Accompagnement ' + acc;
}
function ficheDe(e) {
  const s = S(), pas = P(), ap = pas.apercu ? pas.apercu(e) : { accompagnement: e.type === 'Individuel' ? 'Accompagnement individuel' : 'Accompagnement mutualisé', aides: [] };
  const aesh = [...new Set((s.affectations || []).filter(x => x.eleveId === e.id && x.heures > 0).map(x => String(((s.aesh || []).find(a => a.id === x.aeshId) || {}).nom || '').split(' ')[0]).filter(Boolean))];
  // pas d'emploi du temps dans la fiche (décision du 08/11) : classe, accompagnement et aides ; ni diagnostic ni santé
  return { prenom: String(e.prenom || '').trim(), ini: initiale(e.nom), classe: e.classe || '', site: e.site || '', disp: pas.libDisp ? pas.libDisp(e) : '', acc: ap.accompagnement, notif: notifDe(e), aesh, aides: ap.aides || [] };
}

/* ---------- 26/11 : fiches en ligne (page fiches.html sur github.io), mises à jour toutes seules ----------
   Le bloc chiffré avec le code d'équipe est rangé dans l'espace de l'appli en ligne (Firestore enligne/{e}/membres/{id}),
   id = empreinte du code d'équipe : sans le code, on ne peut ni trouver ni lire les fiches. Cockpit le remet à jour
   à chaque vérification de l'appli en ligne (toutes les 2 minutes quand Cockpit est ouvert), seulement s'il a changé. */
const PAGE_EN_LIGNE = 'https://cecilehanan-prog.github.io/cockpit-coordo/fiches.html';
async function idFiches(code) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fiches-cockpit:' + String(code).trim().toLowerCase())));
  return 'f' + Array.from(h.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}
const lienEnLigne = (e, n) => PAGE_EN_LIGNE + '#e=' + encodeURIComponent(e) + (n ? '&n=' + n : '');
// état de la dernière mise en ligne, gardé sur l'appareil (il survit au rechargement) et affiché en direct
const K_ETAT = 'cockpit-fiches-en-ligne';
let empreinte = '', publieLe = '', erreurEnLigne = '', verifie = false;
try { const x = JSON.parse(localStorage.getItem(K_ETAT) || '{}'); publieLe = x.le || ''; erreurEnLigne = x.err || ''; verifie = !!x.ok; } catch (e) {}
const noterEtat = () => { try { localStorage.setItem(K_ETAT, JSON.stringify({ le: publieLe, err: erreurEnLigne, ok: verifie })); } catch (e) {} const z = document.getElementById('fe-etat-en-ligne'); if (z) z.innerHTML = texteEtat(); };
const avant = (p, ms, quoi) => new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error(quoi + ' : pas de réponse de Firebase au bout de ' + Math.round(ms / 1000) + ' s (vérifie internet)')), ms); p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); ko(e); }); });
function texteEtat() {
  const d = iso => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  if (erreurEnLigne) return '<b style="color:#FF7E6E">Dernière mise à jour impossible : ' + esc(erreurEnLigne) + '</b>';
  if (publieLe) return '<b style="color:#82D6A0">✓ Fiches en ligne' + (verifie ? ' et vérifiées' : '') + ' le ' + d(publieLe) + '.</b> Elles se remettent à jour toutes seules quand Cockpit est ouvert.';
  return 'Pas encore mises en ligne depuis cet appareil : touche « Mettre à jour maintenant ».';
}
// 26/11 soir : envoi par l'API REST de Firestore (avec le jeton de la Synchro) au lieu du canal du SDK,
// qui restait sans réponse chez Hanan (« pas de réponse de Firebase au bout de 30 s »). Mêmes règles de sécurité.
function urlDoc(chemin) { const c = window.COCKPIT_FIREBASE || {}; return 'https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents/' + chemin + '?key=' + c.apiKey; }
async function rest(methode, chemin, champs) {
  const u = window.firebase && firebase.auth && firebase.auth().currentUser; if (!u) throw new Error('connecte la Synchro sur cet appareil (en bas du menu)');
  const jeton = await avant(u.getIdToken(), 20000, 'Connexion à Firebase');
  const opt = { method: methode, headers: { Authorization: 'Bearer ' + jeton } };
  if (champs) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify({ fields: Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, { stringValue: String(v) }])) }); }
  const r = await avant(fetch(urlDoc(chemin), opt), 30000, 'Envoi des fiches');
  if (!r.ok && !(methode === 'DELETE' && r.status === 404)) { let m = ''; try { m = (await r.json()).error.message; } catch (e) {} if (r.status === 429) throw new Error("limite gratuite de Firebase atteinte pour aujourd'hui (trop d'enregistrements). Réessaie demain après 9 h"); throw new Error('Firebase a refusé (' + r.status + (m ? ' : ' + m : '') + ')'); }
  return r;
}
async function publierEnLigne(db, ref, force) {
  const f = etat(); if (!f.code || !ref) return false;
  const fiches = {}; elevesConcernes().forEach(e => { const c = f.codes[e.id]; if (c) fiches[c] = ficheDe(e); });
  const h = JSON.stringify([f.code, fiches]); if (!force && h === empreinte) return false;
  const genere = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  const chemin = 'enligne/' + ref.id + '/membres/' + await idFiches(f.code), bloc = await chiffrer(f.code, { genere, fiches });
  await rest('PATCH', chemin, { fiches: bloc, maj: new Date().toISOString() });
  // relecture comme la fera le téléphone d'une AESH (sans compte) : on est sûr qu'elle trouvera les fiches avec ce code
  verifie = false; try { const r = await avant(fetch(urlDoc(chemin), { cache: 'no-store' }), 20000, 'Vérification'); verifie = r.ok && (((await r.json()).fields || {}).fiches || {}).stringValue === bloc; } catch (e) { console.warn('vérification fiches', e); }
  // ancien code d'équipe (après « Créer un nouveau code ») : son bloc est effacé
  if (f.ancienCode && f.ancienCode !== f.code) { try { await rest('DELETE', 'enligne/' + ref.id + '/membres/' + await idFiches(f.ancienCode)); delete f.ancienCode; sauver(); } catch (e) {} }
  empreinte = h; publieLe = new Date().toISOString(); erreurEnLigne = ''; noterEtat();
  return true;
}
window.fichesEnLigne = {
  publier: (db, ref, force) => publierEnLigne(db, ref, force).catch(e => { erreurEnLigne = e.message || String(e); noterEtat(); console.warn('fiches en ligne', e); return false; }),
  lien: (e, n) => lienEnLigne(e, n)
};
window.fichesMettreEnLigne = async b => {
  const s = S(); if (!(s.enligne && s.enligne.e)) { toast("Active d'abord l'appli en ligne (Absences AESH)"); return; }
  if (b) { b.disabled = true; b.textContent = 'Mise à jour…'; }
  try {
    if (!(window.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser)) throw new Error('connecte la Synchro sur cet appareil (en bas du menu)');
    const f = etat(); if (!f.code) { f.code = nouveauCode(); f.change = new Date().toISOString(); }
    attribuerCodes(); sauver();
    if (!f.code) throw new Error("pas de code d'équipe");
    const db = firebase.firestore(); await publierEnLigne(db, db.collection('enligne').doc(s.enligne.e), true);
    toast(verifie ? 'Fiches en ligne à jour et vérifiées' : 'Fiches envoyées (vérification impossible pour l\'instant)');
  } catch (e) { erreurEnLigne = e.message || String(e); noterEtat(); toast('Mise à jour impossible : ' + erreurEnLigne); }
  window.pageFichesAesh();
};

async function chiffrer(code, obj) {
  const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, new TextEncoder().encode(JSON.stringify(obj))));
  return [sel, iv, ct].map(b64).join('.');
}

// La page publiée : aucune donnée lisible, tout est dans DATA (chiffré). Le téléphone garde le code d'équipe une fois saisi.
function pageFiches(data, genere) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Fiche élève</title><meta name="theme-color" content="#37667F">
<style>
:root{--bleu:#37667F;--fond:#F3F6F8;--texte:#1F2A33;--gris:#5C6B77;--ligne:#DCE3E8;--carte:#fff}
@media (prefers-color-scheme:dark){:root{--fond:#12181D;--texte:#E7EDF1;--gris:#9DAAB4;--ligne:#2A353D;--carte:#1A2228}}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{background:var(--bleu);color:#fff;padding:14px 16px;font-weight:650;font-size:17px}
main{max-width:560px;margin:0 auto;padding:16px}
.carte{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:16px;margin-bottom:14px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px;color:var(--gris);text-transform:uppercase;letter-spacing:.03em}
.gris{color:var(--gris);font-size:14px}ul{margin:0;padding-left:20px}li{margin:3px 0}
input{width:100%;font-size:18px;padding:12px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte);color:var(--texte)}
button{margin-top:10px;width:100%;font-size:17px;padding:12px;border:0;border-radius:10px;background:var(--bleu);color:#fff;font-weight:600}
.cr{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--ligne)}.cr:first-of-type{border-top:0}.cr b{min-width:92px}
.err{color:#C0392B;font-weight:600}.lien{background:none;color:var(--bleu);padding:4px;font-size:14px;font-weight:500}
</style></head><body><header>Fiche élève</header><main id="m"></main>
<script>
const DATA = "${data}";
const ITER = ${ITER}, K = 'fiches-code-equipe', M = document.getElementById('m');
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unb = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const lire = () => { try { return localStorage.getItem(K) || ''; } catch (e) { return ''; } };
const garder = v => { try { v ? localStorage.setItem(K, v) : localStorage.removeItem(K); } catch (e) {} };
const codeEleve = () => (location.hash.replace('#', '') || new URLSearchParams(location.search).get('e') || '').replace(/\\D/g, '').slice(0, 4);
async function ouvrir(code) {
  const [sel, iv, ct] = DATA.split('.').map(unb);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  const cle = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cle, ct)));
}
function demanderCode(msg) {
  M.innerHTML = '<div class="carte"><h1>Code d\\'équipe</h1><p class="gris">Tape le code donné par la coordinatrice (par exemple mot-mot-mot-123). Ce téléphone s\\'en souviendra.</p>' + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') + '<input id="c" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="mot-mot-mot-123"><button id="ok">Ouvrir</button></div>';
  const go = () => { const v = document.getElementById('c').value.trim(); if (v) essayer(v, true); };
  document.getElementById('ok').onclick = go; document.getElementById('c').onkeydown = e => { if (e.key === 'Enter') go(); };
}
function demanderEleve(D, msg) {
  M.innerHTML = '<div class="carte"><h1>Numéro de l\\'élève</h1><p class="gris">Tape les 4 chiffres inscrits sur la puce ou sous le QR code.</p>' + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') + '<input id="n" inputmode="numeric" maxlength="4" placeholder="1234"><button id="ok">Voir la fiche</button></div>' + pied(D);
  const go = () => { location.hash = document.getElementById('n').value.replace(/\\D/g, ''); };
  document.getElementById('ok').onclick = go; document.getElementById('n').onkeydown = e => { if (e.key === 'Enter') go(); }; brancherPied();
}
const pied = D => '<p class="gris" style="text-align:center">Mise à jour : ' + esc(D.genere) + '</p><button class="lien" id="oubli">Changer de code d\\'équipe</button>';
const brancherPied = () => { const b = document.getElementById('oubli'); if (b) b.onclick = () => { garder(''); demanderCode(''); }; };
function afficher(D) {
  const n = codeEleve(); if (!n) return demanderEleve(D, '');
  const f = D.fiches[n]; if (!f) return demanderEleve(D, 'Aucune fiche avec le numéro ' + n + '.');
  M.innerHTML = '<div class="carte"><h1>' + (f.prenom ? esc(f.prenom + ' ' + (f.ini || '')) : 'Élève n° ' + esc(n)) + '</h1><div style="font-size:18px">Classe ' + esc(f.classe) + (f.disp ? ' · ' + esc(f.disp) : '') + '</div><div class="gris">' + esc(f.site) + (f.prenom ? ' · n° ' + esc(n) : '') + '</div></div>'
    + '<div class="carte"><h2>Accompagnement</h2><div>' + esc(f.notif || f.acc) + '</div></div>'
    + '<div class="carte"><h2>Aides à mettre en place</h2>' + (f.aides.length ? '<ul>' + f.aides.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '<p class="gris">Demande à la coordinatrice ou au professeur.</p>') + '</div>'
    + pied(D);
  brancherPied();
}
let D = null;
async function essayer(code, nouveau) {
  M.innerHTML = '<div class="carte gris">Ouverture…</div>';
  try { D = await ouvrir(code); garder(code); afficher(D); }
  catch (e) { garder(''); demanderCode(nouveau ? 'Ce code ne marche pas. Vérifie-le auprès de la coordinatrice.' : 'Le code d\\'équipe a changé. Tape le nouveau code.'); }
}
window.addEventListener('hashchange', () => { if (D) afficher(D); });
const c0 = lire(); if (c0) essayer(c0, false); else demanderCode('');
</script></body></html>`;
}

function telecharger(nom, texte, type) {
  const u = URL.createObjectURL(new Blob([texte], { type })), a = document.createElement('a'); a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}

// 26/11 : la page Netlify (puces NFC, QR codes déjà imprimés) renvoie vers les fiches en ligne : plus besoin de la redéposer à chaque changement
function pageRenvoi(e) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Fiche élève</title>
<script>location.replace(${JSON.stringify(PAGE_EN_LIGNE + '#e=' + e)} + (location.hash.replace(/\\D/g, '').slice(0, 4) ? '&n=' + location.hash.replace(/\\D/g, '').slice(0, 4) : ''));</script>
</head><body style="font:16px sans-serif;padding:24px">Ouverture de la fiche… <a href="${PAGE_EN_LIGNE + '#e=' + e}">Toucher ici si rien ne se passe</a></body></html>`;
}

window.fichesFabriquer = async () => {
  const f = etat(), msg = $('#fa-msg'); if (!f.code) { f.code = nouveauCode(); f.change = new Date().toISOString(); }
  const en = S().enligne && S().enligne.e;
  if (en) {
    const n = attribuerCodes(); f.fabrique = new Date().toISOString(); sauver();
    telecharger('index.html', pageRenvoi(en), 'text/html');
    msg.innerHTML = `<div style="background:#E9F7EE;border:1px solid #7CC596;border-radius:10px;padding:12px 14px;margin-top:10px;color:#1F2A33"><b>Page de renvoi fabriquée${n ? ' (' + n + ' nouveaux numéros)' : ''}.</b>
      <p class="small" style="margin:6px 0 0">À déposer <b>une seule fois</b> sur Netlify (à partir du 6 décembre) : mets <b>index.html</b> seul dans un dossier « fiches-coordo » et glisse-le dans le site des fiches, onglet Deploys. Ensuite les puces et QR codes ouvrent toujours les fiches à jour, avec le prénom.</p></div>`;
    return;
  }
  const n = attribuerCodes(), fiches = {}, E = elevesConcernes();
  E.forEach(e => { fiches[f.codes[e.id]] = ficheDe(e); });
  msg.innerHTML = '<p class="muted">Chiffrement des ' + E.length + ' fiches…</p>';
  try {
    const genere = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const html = pageFiches(await chiffrer(f.code, { genere, fiches }), genere);
    f.fabrique = new Date().toISOString(); sauver();
    telecharger('index.html', html, 'text/html');
    msg.innerHTML = `<div style="background:#E9F7EE;border:1px solid #7CC596;border-radius:10px;padding:12px 14px;margin-top:10px"><b>Page fabriquée : ${E.length} fiches${n ? ', dont ' + n + ' nouveaux numéros' : ''}.</b>
      <p class="small" style="margin:6px 0 0">Le fichier <b>index.html</b> est dans Téléchargements. Mets-le seul dans un dossier « fiches-coordo », puis glisse ce dossier dans Netlify (site des fiches, onglet Deploys). ${n ? 'Imprime aussi la feuille des QR codes : il y a de nouveaux élèves.' : ''}</p></div>`;
    setTimeout(window.pageFichesAesh, 15000);
  } catch (e) { msg.innerHTML = '<p style="color:var(--bad,#b3261e);font-weight:600">La fabrication a échoué : ' + esc(e.message) + '</p>'; }
};

window.fichesImprimer = async () => {
  const f = etat(); attribuerCodes(); sauver();
  const E = elevesConcernes(), w = window.open('', '_blank'); if (!w) { toast('Autorise les fenêtres pour imprimer'); return; }
  w.document.write('<p style="font:16px sans-serif">Préparation des QR codes…</p>');
  try {
    if (!window.qrcode) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = ok; s.onerror = () => ko(new Error('pas de connexion internet')); document.head.appendChild(s); });
    const qr = t => { const q = window.qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
    const svg = {}, carte = e => { const c = f.codes[e.id], u = urlFiche(f, c); svg[c] = svg[c] || qr(u); return `<div class="c"><div class="g1"><div class="q">${svg[c]}</div><div class="n">${c}</div></div><div class="d"><div><b>${esc(e.nom)} ${esc(e.prenom)}</b></div><div>${esc(e.classe)}</div><div class="u">${esc(u)}</div></div></div>`; };
    const parNum = E.slice().sort((a, b) => Number(f.codes[a.id]) - Number(f.codes[b.id]));
    const parNom = E.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }) || (a.prenom || '').localeCompare(b.prenom || '', 'fr', { sensitivity: 'base' }));
    // 3. par AESH (20/11) : AESH par ordre alphabétique du nom de famille, ses élèves dessous ; un élève suivi par deux AESH apparaît sous chacune
    const s0 = S(), famille = a => (String(a.nom || '').split(' ').slice(1).join(' ') || a.nom || ''), ids = new Set(E.map(e => e.id));
    const suiviPar = a => (s0.affectations || []).filter(x => x.aeshId === a.id && ids.has(x.eleveId)).map(x => E.find(e => e.id === x.eleveId)).filter((e, i, L) => e && L.indexOf(e) === i);
    const parNomTri = L => L.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }) || (a.prenom || '').localeCompare(b.prenom || '', 'fr', { sensitivity: 'base' }));
    const groupes = (s0.aesh || []).slice().sort((a, b) => famille(a).localeCompare(famille(b), 'fr', { sensitivity: 'base' }) || String(a.nom).localeCompare(String(b.nom), 'fr')).map(a => [a, parNomTri(suiviPar(a))]).filter(([, L]) => L.length);
    const sansAesh = parNomTri(E.filter(e => !(s0.affectations || []).some(x => x.eleveId === e.id && groupes.some(([a]) => a.id === x.aeshId))));
    const parAesh = groupes.map(([a, L]) => `<div class="ga"><h3>Suivis par ${esc(a.nom)} <span class="nb">(${L.length} élève${L.length > 1 ? 's' : ''})</span></h3><div class="g">${L.map(carte).join('')}</div></div>`).join('')
      + (sansAesh.length ? `<div class="ga"><h3>Sans AESH pour l'instant <span class="nb">(${sansAesh.length})</span></h3><div class="g">${sansAesh.map(carte).join('')}</div></div>` : '');
    const cartes = `<div class="choix"><b>Afficher :</b> <button data-v="tout" class="on">Les trois classements</button><button data-v="num">Par numéro</button><button data-v="nom">Par ordre alphabétique</button><button data-v="aesh">Par AESH</button></div>`
      + `<section data-s="num"><h2>1. Par numéro (ordre croissant)</h2><div class="g">${parNum.map(carte).join('')}</div></section>`
      + `<section data-s="nom"><h2 class="saut">2. Par ordre alphabétique (nom)</h2><div class="g">${parNom.map(carte).join('')}</div></section>`
      + `<section data-s="aesh"><h2 class="saut">3. Par AESH</h2>${parAesh}</section>`
      + `<script>document.querySelectorAll('.choix button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.choix button').forEach(function(x){x.className=x===b?'on':'';});var v=b.getAttribute('data-v');document.querySelectorAll('section[data-s]').forEach(function(s,i){s.style.display=v==='tout'||s.getAttribute('data-s')===v?'':'none';var h=s.querySelector('h2');if(h)h.className=(v==='tout'&&i>0)?'saut':'';});};});<\/script>`;
    w.document.open(); w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>QR codes des fiches élèves</title><style>
      body{font:13px -apple-system,sans-serif;margin:16px;color:#000}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.c{display:flex;gap:10px;align-items:center;border:1px dashed #999;border-radius:8px;padding:8px;break-inside:avoid}
      .g1{display:flex;flex-direction:column;align-items:center;flex:none;width:118px}.q{width:110px}.q svg{width:110px;height:110px;display:block}.n{font-size:24px;font-weight:700;letter-spacing:.08em;line-height:1.1;margin-top:2px}.d{min-width:0}.u{font-size:10px;color:#555;word-break:break-all}
      h2{font-size:16px;margin:14px 0 8px}h3{font-size:14px;margin:14px 0 6px;break-after:avoid}.nb{font-weight:400;color:#555}.choix{margin:0 0 10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.choix button{font-size:14px;padding:6px 10px;border:1px solid #999;border-radius:6px;background:#fff}.choix button.on{background:#37667F;color:#fff;border-color:#37667F}@media print{button,.choix{display:none}.saut{break-before:page;page-break-before:always;margin-top:0}}</style></head><body>
      <h1>Fiches élèves AESH : QR codes et numéros</h1><p><b>Document confidentiel, à garder dans le classeur.</b> Découpe la colonne de gauche (QR code + numéro) <b>sans le nom</b> pour l'emploi du temps ou le carnet. Pour une puce NFC, écris l'adresse sous le QR code avec l'appli NFC Tools (Écrire › Ajouter un enregistrement › URL).</p>
      <button onclick="print()" style="font-size:15px;padding:8px 14px;margin-bottom:12px">Imprimer</button>${cartes}</body></html>`); w.document.close();
  } catch (e) { w.document.body.innerHTML = '<p style="font:16px sans-serif;color:#b3261e">Impossible de fabriquer les QR codes : ' + esc(e.message) + '</p>'; }
};

window.fichesNouveauCode = async () => {
  if (!(await window.demander(S().enligne && S().enligne.e ? "Créer un nouveau code d'équipe ? L'ancien cessera de marcher tout de suite pour tout le monde. Toutes les AESH devront taper le nouveau code." : "Créer un nouveau code d'équipe ? L'ancien ne marchera plus dès que tu auras déposé la nouvelle page sur Netlify. Toutes les AESH devront taper le nouveau code.", { ok: 'Créer un nouveau code', danger: true }))) return;
  const f = etat(); if (f.code) f.ancienCode = f.code; f.code = nouveauCode(); f.change = new Date().toISOString(); sauver();
  if (S().enligne && S().enligne.e) { await window.fichesMettreEnLigne(); toast("Nouveau code créé : donne-le aux AESH"); return; }
  window.pageFichesAesh(); toast('Nouveau code créé : fabrique la page et dépose-la sur Netlify');
};
window.fichesSite = async () => {
  const v = await window.saisir('Adresse du site des fiches sur Netlify :', etat().site || '', { ok: 'Enregistrer' }); if (v === null || !v.trim()) return; const f = etat();
  let u = v.trim(); if (!/^https?:\/\//.test(u)) u = 'https://' + u; f.site = u.replace(/[#?].*$/, '').replace(/\/?$/, '/'); sauver(); window.pageFichesAesh();
};
window.fichesCopier = (t, b) => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copié'; }, () => toast('Sélectionne le code et copie-le.'));

/* ---------- présentation (11/11) : liste en cartes sombres, clic = fiche détaillée avec QR ---------- */
const FE_CSS = `
.page.fe-page{background:#14181E;color:#EEF1F4}
.fe-page .card{background:#1C2229;border:1px solid #2E3741;color:#EEF1F4}
.fe-page .muted,.fe-page .small.muted{color:#9AA4AE}
.fe-page a{color:#8CC4EE}
.fe{max-width:1180px;margin:0 auto}
.fe-t{font-size:30px;font-weight:800;letter-spacing:-.01em;margin:4px 0 6px;color:#F4F6F8}
.fe-sous{color:#9AA4AE;font-size:15px;margin-bottom:16px}
.fe-sous a{color:#8CC4EE;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.fe-page .btn:not(.primary){background:#2A323B;border:1px solid #3A444F;color:#EEF1F4}
.page.fe-page input.fe-q{width:100%;box-sizing:border-box;background:#1C2229;border:1px solid #333D48;border-radius:14px;color:#EEF1F4;font-size:17px;padding:15px 18px;margin-bottom:14px;outline:none}
.page.fe-page input.fe-q::placeholder{color:#8A949E}.page.fe-page input.fe-q:focus{border-color:#5A7FA0;box-shadow:none}
.fe-chips{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;margin-bottom:14px;scrollbar-width:none}
.fe-chips::-webkit-scrollbar{display:none}
.fe-chip{flex:none;background:#1C2229;border:1px solid #333D48;color:#EEF1F4;border-radius:999px;padding:9px 18px;font-size:15px;font-weight:700;cursor:pointer}
.fe-chip.on{background:#EEF1F4;color:#14181E;border-color:#EEF1F4}
.fe-sep{flex:none;width:1px;align-self:stretch;background:#333D48;margin:4px 4px}
.fe-chip.fe-tri.on{background:#7FB7E8;color:#14181E;border-color:#7FB7E8}
.fe-l{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.fe-c{display:flex;gap:18px;align-items:flex-start;background:#1C2229;border:1px solid #2E3741;border-radius:16px;padding:18px 20px;cursor:pointer;text-align:left;color:inherit}
.fe-c:hover,.fe-c:focus-visible{border-color:#5A7FA0;outline:none}
.fe-av{flex:none;width:58px;height:58px;border-radius:50%;background:#2A323B;display:flex;align-items:center;justify-content:center}
.fe-av svg{width:32px;height:32px}
.fe-n{font-size:19px;font-weight:800;color:#F4F6F8;line-height:1.25}
.fe-cl{color:#9AA4AE;font-size:15px;margin-top:3px}
.fe-ae{font-size:15px;margin-top:6px;color:#D9DEE3}.fe-ae b{color:#F4F6F8}
.fe-tags{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.fe-tag{border-radius:999px;padding:4px 11px;font-size:14px;font-weight:700;background:#2C343D;color:#D3D9DF}
.fe-tag.r{background:#47201F;color:#FF7E6E}.fe-tag.p{background:#46203A;color:#F286B8}.fe-tag.b{background:#1D3350;color:#86BDF2}
.fe-tag.v{background:#33244B;color:#C3A3F2}.fe-tag.o{background:#45351A;color:#F0C46A}.fe-tag.s{background:#1D3B2A;color:#82D6A0}
.fe-vide{color:#9AA4AE;padding:20px 4px}
.fe-retour{background:none;border:0;color:#8CC4EE;font-size:16px;font-weight:700;cursor:pointer;padding:4px 0;margin-bottom:12px}
.fe-d{background:#1C2229;border:1px solid #2E3741;border-radius:16px;padding:20px;display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
.fe-qr{flex:none;width:150px;text-align:center}
.fe-qr [data-qr]{width:150px;height:150px;background:#fff;border-radius:12px;padding:8px;box-sizing:border-box}
.fe-qr [data-qr] svg{width:100%;height:100%;display:block}
.fe-num{font-size:30px;font-weight:800;letter-spacing:.08em;margin-top:6px;color:#F4F6F8}
.fe-sec{margin-top:16px}.fe-sec h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9AA4AE;margin:0 0 6px}
.fe-sec ul{margin:2px 0 0;padding-left:20px;color:#D9DEE3}.fe-sec li{margin:2px 0}
#fe-admin{margin-bottom:16px}
@media (max-width:800px){.fe-l{grid-template-columns:1fr}.fe-t{font-size:28px}.fe-c{padding:16px}.fe-d{padding:16px}}
`;
const feStyle = () => { if (document.getElementById('fe-css')) return; const st = document.createElement('style'); st.id = 'fe-css'; st.textContent = FE_CSS; document.head.appendChild(st); };
const FE_AVATAR = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="11" r="6" fill="#A9B4BF"/><path d="M5 28c0-6.1 4.9-10 11-10s11 3.9 11 10z" fill="#A9B4BF"/></svg>';
const FE_TAGS = [[/TDA\/?H/i, 'TDAH', 'r'], [/concentration|attention/i, 'Attention fragile', 'r'], [/anxi|phobie/i, 'Anxiété', 'p'], [/fatigab/i, 'Fatigabilité', ''],
  [/comportement|conduite/i, 'Comportement', 'r'], [/dyslexie/i, 'Dyslexie', 'b'], [/dysortho/i, 'Dysorthographie', 'b'], [/dyscalc/i, 'Dyscalculie', 'b'], [/dyspraxie|coordination/i, 'Dyspraxie', 'b'],
  [/dysphasie|TSLO|langage/i, 'Dysphasie', 'b'], [/dys/i, 'Troubles dys', 'b'], [/autisme|TSA/i, 'TSA', 'v'], [/HPI|potentiel/i, 'HPI', 'v'], [/moteur/i, 'Moteur', 'o'],
  [/visuel/i, 'Trouble visuel', 'o'], [/audit/i, 'Trouble auditif', 'o'], [/asthme|allerg|PAI/i, 'PAI', 's'], [/diab/i, 'Diabète', 's'], [/épilep|epilep/i, 'Épilepsie', 's']];
const feTags = L => { const vu = new Set(); return L.map(t => { const m = FE_TAGS.find(x => x[0].test(t)); return m ? [m[1], m[2], t] : [fvCourt(t), '', t]; }).filter(x => !vu.has(x[0]) && vu.add(x[0])); };
const feTagsHtml = L => L.length ? `<div class="fe-tags">${feTags(L).map(([l, c, t]) => `<span class="fe-tag ${c}" title="${esc(t)}">${esc(l)}</span>`).join('')}</div>` : '';
const feNom = e => `${esc(e.prenom)} ${esc(String(e.nom || '').toUpperCase())}`;
let feOuvert = null, feAdmin = false, feQ = '';

function feGestion(f, E) {
  const sansNum = E.filter(e => !f.codes[e.id]).length;
  const date = iso => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '';
  const en = S().enligne && S().enligne.e, lien = en ? lienEnLigne(en) : '';
  const enLigne = en ? `<div class="card" style="margin-bottom:14px;border-left:4px solid ${erreurEnLigne ? '#FF7E6E' : '#82D6A0'}">
    <h2 style="margin-top:0">Fiches en ligne, avec le prénom</h2>
    <p class="muted" style="margin:0 0 10px">Après le code d'équipe, l'AESH voit le <b>prénom et l'initiale du nom</b> de l'élève, sa classe, sa notification, ses AESH habituelles et les aides. Elle peut aussi choisir une classe et toucher le prénom de l'élève : plus besoin du QR code ni du classeur. Le lien « Voir la fiche » des créneaux de remplacement ouvre cette page.</p>
    <p style="margin:0 0 6px;word-break:break-all">Lien à donner à l'équipe : <a href="${esc(lien)}" target="_blank" rel="noopener">${esc(lien)}</a></p>
    <p style="margin:0 0 10px"><button class="btn sm" onclick="fichesCopier('${esc(lien)}',this)">Copier le lien</button> <button class="btn sm" onclick="fichesMettreEnLigne(this)">Mettre à jour maintenant</button></p>
    <p class="small" id="fe-etat-en-ligne" style="margin:0">${texteEtat()}</p>
  </div>` : '';
  return enLigne + `<div class="card" style="margin-bottom:14px">
    <h2 style="margin-top:0">Liens NFC et page des fiches</h2>
    <p class="muted" style="margin:0 0 10px">Les AESH qui remplacent scannent la puce ou le QR code de l'élève${en ? ' : la puce ouvre la fiche en ligne ci-dessus (une fois la page de renvoi déposée sur Netlify)' : ' : elles voient sa classe, son accompagnement et les aides à mettre en place'}. Le nom n'est jamais écrit sur la puce ni sur le QR code, seulement un numéro à 4 chiffres. Tout est chiffré avec le code d'équipe.</p>
    <p style="margin:0 0 10px">Adresse : <a href="${esc(f.site)}" target="_blank" rel="noopener">${esc(f.site)}</a> <button class="btn sm" onclick="fichesSite()">Changer</button></p>
    <p class="small muted" style="margin:0 0 10px">${E.length} élèves suivis${sansNum ? ` · <b>${sansNum} sans numéro</b> (ils en recevront un)` : ''}${f.fabrique ? ' · page fabriquée le ' + date(f.fabrique) : ' · page jamais fabriquée'}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn${en ? '' : ' primary'}" onclick="fichesFabriquer()">${en ? 'Fabriquer la page de renvoi (Netlify)' : 'Fabriquer la page des fiches'}</button>
      <button class="btn" onclick="fichesImprimer()">Imprimer les QR codes et numéros</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">${en ? 'La page de renvoi se dépose une seule fois sur Netlify (pas de dépôt possible avant le 6 décembre). Ensuite plus rien à déposer : les fiches en ligne se mettent à jour toutes seules.' : 'Refais « Fabriquer » après un changement d\'aides ou l\'arrivée d\'un élève, puis dépose le fichier sur Netlify.'} Les numéros, les puces et les QR codes ne changent pas.</p>
    <div id="fa-msg"></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Code d'équipe</h2>
    ${f.code ? `<p style="margin:0 0 6px">Code actuel : <b style="font-family:ui-monospace,Menlo,monospace;font-size:1.15em">${esc(f.code)}</b> <button class="btn sm" onclick="fichesCopier('${esc(f.code)}',this)">Copier</button></p>
    ${f.change ? `<p class="small muted" style="margin:0 0 10px">Créé le ${date(f.change)}${!en && f.fabrique && f.fabrique < f.change ? ' · <b style="color:#FF7E6E">pas encore dans la page en ligne : fabrique-la et dépose-la</b>' : ''}</p>` : ''}` : '<p class="muted">Il sera créé à la première fabrication.</p>'}
    <p>${en ? 'Les AESH le tapent une fois sur leur téléphone, qui s\'en souvient. En cas de fuite, crée un nouveau code : l\'ancien cesse de marcher tout de suite pour tout le monde.' : 'En cas de fuite, crée un nouveau code, puis fabrique et dépose la page : l\'ancien code cessera de marcher pour tout le monde.'} Donne le nouveau aux AESH de vive voix ou sur papier.</p>
    <button class="btn" onclick="fichesNouveauCode()">Créer un nouveau code d'équipe</button>
  </div>`;
}
window.fichesLiens = ev => { if (ev) ev.preventDefault(); feAdmin = !feAdmin; const a = $('#fe-admin'); if (a) a.hidden = !feAdmin; };
window.fichesOuvrir = id => { feOuvert = id; window.pageFichesAesh(); const p = $('#page'); if (p) p.scrollTop = 0; window.scrollTo(0, 0); };
window.fichesRetour = () => { const id = feOuvert; feOuvert = null; window.pageFichesAesh(); const c = document.querySelector(`.fe-c[data-id="${CSS.escape(id || '')}"]`); if (c) c.scrollIntoView({ block: 'center' }); };

window.pageFichesAesh = function () {
  setTitle('Fiches élèves AESH'); feStyle();
  const pg = $('#page'); pg.classList.add('fe-page');
  const f = etat(), E = elevesConcernes(), actifs = (S().eleves || []).filter(e => !e.archive);
  const el = feOuvert && actifs.find(e => e.id === feOuvert);
  if (el) { pg.innerHTML = `<div class="fe"><button class="fe-retour" onclick="fichesRetour()">‹ Toutes les fiches</button><div id="fv-l">${feDetail(el)}</div></div>`; fvQR(); return; }
  feOuvert = null;
  pg.innerHTML = `<div class="fe">
    <h1 class="fe-t">Fiches élèves</h1>
    <div class="fe-sous">${actifs.length} élève${actifs.length > 1 ? 's' : ''} · ${esc(S().annee || '')} · <a href="#" onclick="fichesLiens(event)">Liens NFC</a> · <a href="#" onclick="event.preventDefault();exportFichesJSON()">Exporter en JSON</a></div>
    <div id="fe-admin"${feAdmin ? '' : ' hidden'}>${feGestion(f, E)}</div>
    <input id="fv-q" class="fe-q" type="search" placeholder="Prénom, nom, classe ou AESH…" oninput="fichesVue()" value="${esc(feQ)}">
    <div id="fv-f" class="fe-chips"></div>
    <div id="fv-l" class="fe-l"></div>
  </div>`;
  fichesVue();
};

/* ---------- données d'un élève (locales, jamais publiées) ---------- */
let fvFiltre = 'Tous';
// classement de la liste (après « Sans numéro ») : ordre alphabétique ou numéro croissant ; retenu sur l'appareil
const FV_TRIS = [['alpha', 'Ordre alphabétique'], ['num', 'Numéro croissant']];
let fvTri = 'alpha'; try { if (localStorage.getItem('fv-tri') === 'num') fvTri = 'num'; } catch (x) {}
const FV_FILTRES = ['Tous', 'Collège', 'Lycée Pro', 'ULIS', 'Lycée GT', 'SEGPA', 'Sans numéro'];
const fvSite = e => { const d = (P().libDisp && P().libDisp(e)) || ''; return /ULIS/i.test(e.classe || '') || /ULIS/i.test(d) || e.site === 'ULIS' ? 'ULIS' : e.site === 'SEGPA' || /SEGPA/i.test(d) ? 'SEGPA' : e.site || ''; };
function fvDonnees(e) {
  const s = S(), f = etat(), pr = e.profil || {}, mq = pr.masques || { troubles: [], aides: [] };
  const vis = (L, m) => (L || []).filter(x => x && x.nom && !(m || []).includes(x.nom)).map(x => x.nom);
  const aeshIds = [...new Set([...(s.affectations || []).filter(a => a.eleveId === e.id && a.heures > 0).map(a => a.aeshId), ...(s.creneaux || []).filter(c => c.eleveId === e.id).map(c => c.aeshId)])];
  const aesh = aeshIds.map(id => ((s.aesh || []).find(a => a.id === id) || {}).nom).filter(Boolean);
  const pps = P().ppsSummary ? P().ppsSummary(e, e.niveau) : [];
  const aides = vis(pr.aides, mq.aides), cit = a => /^[«"]/.test(a);
  // aménagements = aides « types » (tiers-temps, ordinateur…) ; suggestions = phrases citées du PPS / GEVASCO
  return { num: f.codes[e.id] || '', site: fvSite(e), aesh, troubles: vis(pr.troubles, mq.troubles), amen: aides.filter(a => !cit(a) && !/^AESH (mutualis|individuel)/i.test(a)), sugg: aides.filter(cit).map(a => { const c = a.replace(/[«»"]/g, '').trim(); return c.charAt(0).toUpperCase() + c.slice(1); }), pps };
}
const fvCourt = t => String(t).replace(/\s*\(.*?\)\s*/g, ' ').trim();
async function fvQR() {
  try {
    if (!window.qrcode) await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
    const f = etat();
    document.querySelectorAll('#fv-l [data-qr]').forEach(el => { if (el.firstChild) return; const q = window.qrcode(0, 'M'); q.addData(urlFiche(f, el.dataset.qr)); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 3, margin: 1, scalable: true }); });
  } catch (x) { document.querySelectorAll('#fv-l [data-qr]').forEach(el => { if (!el.firstChild) el.innerHTML = '<span class="small" style="color:#555">QR hors ligne</span>'; }); }
}
function feDetail(e) {
  const d = fvDonnees(e), f = etat();
  const pps = d.pps.map(x => `<div style="margin-top:6px"><b>${esc(x.titre)}</b><ul>${x.items.map(i => `<li>${esc(i)}</li>`).join('')}${x.autre ? `<li>${esc(x.autre)}</li>` : ''}</ul></div>`).join('');
  return `<div class="fe-d">
    <div class="fe-qr">${d.num ? `<div data-qr="${d.num}"></div><div class="fe-num">${d.num}</div><a class="small" href="${esc(urlFiche(f, d.num))}" target="_blank" rel="noopener">Ouvrir la fiche en ligne</a>` : '<div class="fe-cl" style="padding-top:40px">Pas de fiche en ligne<br>(aucun créneau)</div>'}</div>
    <div style="min-width:0;flex:1 1 300px">
      <div class="fe-n" style="font-size:24px">${feNom(e)}</div>
      <div class="fe-cl">${esc(e.classe || '')}${e.site ? ' · ' + esc(e.site) : ''} · ${e.type === 'Individuel' ? 'individuel' : 'mutualisé'}</div>
      <div class="fe-ae">AESH : <b>${d.aesh.length ? d.aesh.map(esc).join(', ') : '—'}</b></div>
      ${feTagsHtml(d.troubles)}
      ${pps ? `<div class="fe-sec"><h3>Aménagements retenus au PPS</h3>${pps}</div>` : ''}
      ${d.amen.length ? `<div class="fe-sec"><h3>Aménagements</h3><div class="fe-tags" style="margin-top:0">${d.amen.map(a => `<span class="fe-tag">${esc(a)}</span>`).join('')}</div></div>` : ''}
      ${d.sugg.length ? `<div class="fe-sec"><h3>Suggestions d'aide</h3><ul>${d.sugg.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${!pps && !d.amen.length && !d.sugg.length ? '<div class="fe-cl" style="margin-top:12px">Aucun aménagement ni aide renseignés dans la fiche.</div>' : ''}
    </div></div>`;
}
window.fichesVueFiltre = v => { fvFiltre = v; fichesVue(); };
window.fichesVueTri = v => { fvTri = v === 'num' ? 'num' : 'alpha'; try { localStorage.setItem('fv-tri', fvTri); } catch (x) {} fichesVue(); };
window.fichesVue = function () {
  const L = $('#fv-l'); if (!L || feOuvert) return;
  feQ = ($('#fv-q') || {}).value || ''; const q = feQ.trim().toLowerCase();
  const parNom = (a, b) => String(a.nom || '').trim().localeCompare(String(b.nom || '').trim(), 'fr', { sensitivity: 'base' }) || String(a.prenom || '').trim().localeCompare(String(b.prenom || '').trim(), 'fr', { sensitivity: 'base' });
  const tous = (S().eleves || []).filter(e => !e.archive).sort(parNom);
  const D = new Map(tous.map(e => [e.id, fvDonnees(e)]));
  if (fvTri === 'num') { const n = e => { const v = parseInt(D.get(e.id).num, 10); return isNaN(v) ? Infinity : v; }; tous.sort((a, b) => (n(a) - n(b)) || parNom(a, b)); }
  const ok = e => { const d = D.get(e.id);
    if (fvFiltre === 'Sans numéro' ? d.num : fvFiltre !== 'Tous' && d.site !== fvFiltre) return false;
    if (!q) return true;
    return [e.nom, e.prenom, e.classe, d.num, d.site, ...d.aesh].join(' ').toLowerCase().includes(q); };
  const E = tous.filter(ok);
  $('#fv-f').innerHTML = FV_FILTRES.map(v => `<button class="fe-chip${v === fvFiltre ? ' on' : ''}" onclick="fichesVueFiltre('${v}')">${v}</button>`).join('')
    + '<span class="fe-sep" aria-hidden="true"></span>'
    + FV_TRIS.map(([k, t]) => `<button class="fe-chip fe-tri${k === fvTri ? ' on' : ''}" onclick="fichesVueTri('${k}')">${t}</button>`).join('');
  L.innerHTML = E.map(e => { const d = D.get(e.id);
    return `<div class="fe-c" role="button" tabindex="0" data-id="${esc(e.id)}" onclick="fichesOuvrir(this.dataset.id)" onkeydown="if(event.key==='Enter')fichesOuvrir(this.dataset.id)">
      <div class="fe-av">${FE_AVATAR}</div>
      <div style="min-width:0;flex:1">
        <div class="fe-n">${feNom(e)}</div>
        <div class="fe-cl">${fvTri === 'num' && d.num ? `<b>n° ${esc(d.num)}</b> · ` : ''}${esc(e.classe || '')}${e.site ? ' · ' + esc(e.site) : ''}</div>
        <div class="fe-ae">AESH : <b>${d.aesh.length ? d.aesh.map(esc).join(', ') : '—'}</b></div>
        ${feTagsHtml(d.troubles)}
      </div></div>`; }).join('') || '<div class="fe-vide">Aucun élève ne correspond.</div>';
};


// Cockpit ne connaît pas cette rubrique : on passe juste après son propre affichage.
function afficherSiFiches() {
  if (!/^#\/fiches/.test(location.hash)) { const p = document.getElementById('page'); if (p) p.classList.remove('fe-page'); feOuvert = null; return; }
  window.pageFichesAesh();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/fiches'));
  const b = document.querySelector('.bandeau-ess'), b2 = document.querySelector('.bandeau-ess-j2'); [b, b2].forEach(x => x && x.remove());
}
window.addEventListener('hashchange', afficherSiFiches);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(afficherSiFiches, 0)); else setTimeout(afficherSiFiches, 0);
})();
