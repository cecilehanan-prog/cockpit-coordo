/* ====================== APPLI EN LIGNE (Firebase « coordo-sync », sans serveur) ======================
   Remplace l'ancienne appli « remplacements-en-ligne » (serveur local :8745). Cockpit garde la même interface :
   ce fichier répond lui-même aux adresses /api/admin/... en lisant et écrivant dans Firestore, avec le compte de la Synchro.
   - Profs : demande.html#e=ESPACE&k=CLE_PROFS → écrivent une demande (ils ne peuvent rien lire).
   - AESH : equipe.html#e=ESPACE&p=CLE_PERSO → lisent leur propre fiche (créneaux à prendre, demandes proposées),
     écrivent des réponses (prise, annulation, candidature). Seule Cécile lit les réponses et les demandes.
   - Aucune donnée d'élève n'est publiée en clair, sauf le texte « élève et aides » que Cécile communique à l'AESH validée (effacé le lendemain).
     Les fiches élèves (prénom + initiale, classe, notification, aides) sont publiées CHIFFRÉES avec le code d'équipe (fiches.js, 26/11).
   - Les mails ne partent pas tout seuls : Cockpit ouvre un brouillon de mail prêt à envoyer. */
(() => {
'use strict';
// 26/11 : AESH sorties de l'équipe (champ dateSortie, voir app.js) : plus de lien perso, plus de mail, plus de fiche en ligne à partir de cette date
const jourIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const equipeA = () => (S().aesh || []).filter(a => !(a.dateSortie && jourIso() >= a.dateSortie));
const ORIGINE = 'https://enligne.coordo'; // adresse « interne » : jamais contactée, interceptée ci-dessous
// toujours l'adresse Netlify, quel que soit l'endroit où le cockpit est ouvert (appli Mac, ancienne adresse github.io…)
const BASE = 'https://cockpit-coordo.netlify.app/';
const fetchOrig = window.fetch.bind(window);
/* 26/11 : compteur des enregistrements envoyés à Firebase par CET appareil, par jour (offre gratuite : 20 000 par jour pour tout le projet).
   Affiché dans la fenêtre Synchro, pour trouver ce qui consomme. Rien n'est envoyé : c'est gardé sur l'appareil. */
const K_ECR = 'cockpit-ecritures-jour';
const ecritures = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem(K_ECR) || '{}'); } catch (e) {} const j = new Date().toISOString().slice(0, 10); return o.jour === j ? o : { jour: j }; })();
function compter(chemin, n = 1) {
  const j = new Date().toISOString().slice(0, 10); if (ecritures.jour !== j) { Object.keys(ecritures).forEach(k => delete ecritures[k]); ecritures.jour = j; }
  const z = /coffres\//.test(chemin) ? (/appareils/.test(chemin) ? 'appareils' : 'synchro') : /\/membres\/f[0-9a-f]{32}/.test(chemin) ? 'fiches' : /\/membres\//.test(chemin) ? 'liens AESH' : /enligne\//.test(chemin) ? 'appli en ligne' : 'autre';
  ecritures[z] = (ecritures[z] || 0) + n; try { localStorage.setItem(K_ECR, JSON.stringify(ecritures)); } catch (e) {}
}
window.cockpitEcritures = () => ecritures;
function brancherCompteur() {
  const F = window.firebase && firebase.firestore; if (!F || !F.DocumentReference || F.__compte) { if (!(F && F.__compte)) setTimeout(brancherCompteur, 500); return; }
  F.__compte = true;
  const D = F.DocumentReference.prototype, B = F.WriteBatch && F.WriteBatch.prototype, C = F.CollectionReference && F.CollectionReference.prototype;
  ['set', 'update', 'delete'].forEach(m => { const o = D[m]; if (o) D[m] = function () { compter(this.path); return o.apply(this, arguments); }; });
  if (B) ['set', 'update', 'delete'].forEach(m => { const o = B[m]; if (o) B[m] = function (ref) { compter(ref && ref.path || ''); return o.apply(this, arguments); }; });
  if (C && C.add) { const o = C.add; C.add = function () { compter(this.path + '/x'); return o.apply(this, arguments); }; }
}
brancherCompteur();
const $ = q => document.querySelector(q);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); };
const S = () => window.PAS && window.PAS.state;
const alea = n => { const a = crypto.getRandomValues(new Uint8Array(n)), c = 'abcdefghijkmnopqrstuvwxyz23456789'; return Array.from(a, x => c[x % c.length]).join(''); };
const auj = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const frD = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const hh = t => String(t || '').replace(':', 'h');
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const jourDe = iso => JOURS[new Date(iso + 'T12:00').getDay()];
const normClasse = c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/(\d)\s*(?:eme|ere|e|°)(?![a-z])/g, '$1e').replace(/[\s.\-_]+/g, '');
const lienProfs = cfg => `${BASE}demande.html#e=${cfg.e}&k=${cfg.kProf}`;
const lienPerso = (cfg, cle) => `${BASE}equipe.html#e=${cfg.e}&p=${cle}`;

/* ---------- Firebase (chargé par sync.js) ---------- */
async function fb() {
  for (let i = 0; i < 60 && !(window.firebase && firebase.apps && firebase.apps.length && firebase.firestore); i++) await new Promise(r => setTimeout(r, 250));
  if (!(window.firebase && firebase.apps && firebase.apps.length)) throw new Error("Firebase n'est pas chargé : vérifie la connexion internet.");
  const auth = firebase.auth();
  const u = auth.currentUser || await new Promise(r => { const off = auth.onAuthStateChanged(x => { off(); r(x); }); });
  if (!u) throw new Error('Connecte la Synchro sur cet appareil (en bas du menu) pour utiliser l\'appli en ligne.');
  return { db: firebase.firestore(), u };
}
const cfgEnLigne = () => (S() && S().enligne && S().enligne.e) ? S().enligne : null;
const racine = (db, cfg) => db.collection('enligne').doc(cfg.e);

async function activer() {
  const { db, u } = await fb();
  let cfg = cfgEnLigne();
  if (!cfg) {
    cfg = { e: alea(20), kProf: alea(16) };
    await db.collection('enligne').doc(cfg.e).set({ owner: u.uid, kProf: cfg.kProf, cree: new Date().toISOString() });
    await db.collection('enligne').doc(cfg.e).collection('admin').doc('config').set({ membres: {}, prevenues: [] });
    S().enligne = cfg;
  }
  S().serveur = { url: ORIGINE, cle: 'firebase' }; window.PAS.save();
  await membresAJour();
  return cfg;
}

/* ---------- état d'administration ---------- */
async function lireConfig(db, cfg) { const s = await racine(db, cfg).collection('admin').doc('config').get(); return Object.assign({ membres: {}, prevenues: [] }, s.exists ? s.data() : {}); }
async function membresAJour() {
  const { db } = await fb(), cfg = cfgEnLigne(), conf = await lireConfig(db, cfg), A = equipeA(); let neuf = false;
  for (const a of A) if (!conf.membres[a.id]) { conf.membres[a.id] = alea(24); neuf = true; await racine(db, cfg).collection('membres').doc(conf.membres[a.id]).set({ aeshId: a.id, nom: a.nom, maj: '' }); }
  if (neuf) await racine(db, cfg).collection('admin').doc('config').set(conf, { merge: true });
  return conf;
}
async function lireReponses(db, cfg) {
  const q = await racine(db, cfg).collection('reponses').get();
  return q.docs.map(d => d.data()).sort((x, y) => String(x.le || '').localeCompare(String(y.le || '')));
}
async function lirePrises(db, cfg) {
  const q = await racine(db, cfg).collection('prises').get(), st = {};
  q.forEach(d => { const x = d.data(); st[d.id] = { occId: d.id, creneauId: x.creneauId, date: x.date, debut: x.debut, fin: x.fin, aeshId: x.aeshId, priseLe: x.le, annulee: !!x.annulee }; });
  return st;
}
function plierCandidatures(R) {
  const m = {}; R.filter(r => r.type === 'candidat' || r.type === 'retrait').forEach(r => { (m[r.demandeId] ||= {})[r.aeshId] = r.type === 'candidat'; });
  return m;
}
const chevauche = (a1, b1, a2, b2) => a1 < b2 && a2 < b1;
function libreA(a, date, debut, fin, pub) {
  const j = new Date(date + 'T12:00').getDay(), q = (pub && pub.quinzaines) ? pub.quinzaines[lundiIso(date)] : null;
  return !(S().creneaux || []).some(c => (c.aeshId === a.id || c.remplacantId === a.id) && c.jour === j && (!c.groupe || !q || c.groupe === q) && chevauche(c.debut, c.fin, debut, fin));
}
function lundiIso(date) { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/* ---------- publication des fiches personnelles des AESH ---------- */
// empreinte de chaque fiche AESH déjà envoyée, gardée sur l'appareil : on ne réécrit plus les ~25 fiches à chaque ouverture du cockpit
const K_HASH = 'cockpit-enligne-empreintes';
let dernierHash = {}; try { dernierHash = JSON.parse(localStorage.getItem(K_HASH) || '{}'); } catch (e) {}
let dernierRepublier = 0;
/* 28/11 : les fiches des AESH (« liens AESH ») saturaient Firebase (2 457 enregistrements avant 10 h sur l'iMac).
   Cause : quand Firebase est plein, un envoi groupé reste en attente (Firebase le garde et réessaie sans fin) et ne répond
   jamais ; l'empreinte n'était donc pas retenue, et toutes les 2 minutes un NOUVEL envoi des ~25 fiches s'empilait. À la
   remise à zéro du quota, tous ces envois en attente partaient d'un coup et resaturaient Firebase pour la journée.
   Maintenant : un seul envoi à la fois, envoi direct (refus immédiat et clair si Firebase est plein, rien ne s'empile),
   pause de 30 minutes après un refus. Pour les collègues, rien ne change : leur fiche est mise à jour dès qu'elle change. */
let republierEnCours = null, pauseEcrituresJusqua = 0;
function enValeur(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(enValeur) } : {} };
  const f = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) f[k] = enValeur(x); return { mapValue: { fields: f } };
}
async function envoyerDocs(docs) { // docs : [{ path, data }] → un seul envoi direct (API web de Firestore)
  const app = firebase.app(), pid = app.options.projectId, u = firebase.auth().currentUser; if (!u) throw new Error('pas connectée');
  const tok = await u.getIdToken(), racineDocs = 'projects/' + pid + '/databases/(default)/documents';
  const corps = { writes: docs.map(d => ({ update: { name: racineDocs + '/' + d.path, fields: enValeur(d.data).mapValue.fields } })) };
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, minu = setTimeout(() => ctl && ctl.abort(), 60000);
  try {
    const r = await fetchOrig('https://firestore.googleapis.com/v1/' + racineDocs + ':commit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(corps), signal: ctl ? ctl.signal : undefined });
    if (!r.ok) { let t = ''; try { t = (await r.text()).slice(0, 200); } catch (e) {} const e = new Error('envoi refusé (' + r.status + ') ' + t); e.quota = r.status === 429 || /RESOURCE_EXHAUSTED/.test(t); throw e; }
    docs.forEach(d => compter(d.path));
  } finally { clearTimeout(minu); }
}
async function republier(db, cfg, ctx) {
  if (republierEnCours) return 0; // un envoi est déjà en route : on ne l'empile pas
  republierEnCours = republierUneFois(db, cfg, ctx);
  try { return await republierEnCours; } finally { republierEnCours = null; }
}
async function republierUneFois(db, cfg, ctx) {
  const conf = ctx.conf || await lireConfig(db, cfg);
  const pubS = await racine(db, cfg).collection('admin').doc('publication').get(), pub = pubS.exists ? pubS.data().p : null;
  const R = ctx.R || await lireReponses(db, cfg), prises = await lirePrises(db, cfg), cand = plierCandidatures(R);
  const D = ctx.D || (await racine(db, cfg).collection('demandes').get()).docs.map(d => Object.assign({ id: d.id }, d.data()));
  const nomA = id => ((S().aesh || []).find(a => a.id === id) || {}).nom || '';
  // pseudonymisation : l'AESH voit le numéro de fiche de l'élève (4 chiffres), jamais sa classe ni son dispositif
  // 26/11 : le lien « Voir la fiche » ouvre les fiches en ligne (fiches.html, prénom visible après le code d'équipe)
  const F = S().fiches || {}, siteFiches = () => String(F.site || 'https://fiches-eleves.netlify.app/').replace(/\/?$/, '/');
  const lienFiche = n => window.fichesEnLigne && F.code ? window.fichesEnLigne.lien(cfg.e, n) : siteFiches() + '#' + n;
  const numEleve = crId => { const c = (S().creneaux || []).find(x => x.id === crId); return (c && (F.codes || {})[c.eleveId]) || ''; };
  const occ = (pub && pub.occurrences || []).filter(o => o.date >= auj()).map(o => { const p = prises[o.id]; return { id: o.id, creneauId: o.creneauId, date: o.date, debut: o.debut, fin: o.fin, semaine: o.semaine || '', eleve: numEleve(o.creneauId), fiche: numEleve(o.creneauId) ? lienFiche(numEleve(o.creneauId)) : '', site: o.site || '', matiere: o.matiere || '', absent: nomA(o.absentId), prisPar: p && !p.annulee ? p.aeshId : null, prisParNom: p && !p.annulee ? nomA(p.aeshId) : '' }; });
  const aEnvoyer = [], aMettre = {}; let n = 0;
  for (const a of equipeA()) {
    const cle = conf.membres[a.id]; if (!cle) continue;
    const dem = D.filter(d => d.date >= auj() && (d.statut === 'proposee' && (!d.visibleA || d.visibleA.includes(a.id)) || d.statut === 'acceptee' && d.aeshId === a.id))
      .map(d => ({ id: d.id, date: d.date, debut: d.debut, fin: d.fin, classe: d.classe || '', salle: d.salle || '', type: d.type || '', prof: d.profNom || '', statut: d.statut, positionne: !!(cand[d.id] && cand[d.id][a.id]), validee: d.statut === 'acceptee' && d.aeshId === a.id, desiste: d.statut === 'acceptee' && d.aeshId === a.id && !!cand[d.id] && cand[d.id][a.id] === false, note: d.statut === 'acceptee' && d.aeshId === a.id && d.liberee && d.date >= auj() && !(cand[d.id] && cand[d.id][a.id] === false) ? (d.note || '') : '' }));
    const occupations = (S().creneaux || []).filter(c => c.aeshId === a.id || c.remplacantId === a.id).map(c => ({ jour: c.jour, debut: c.debut, fin: c.fin, groupe: c.groupe || null }));
    const doc = { aeshId: a.id, nom: a.nom, absente: !!(a.statut && a.statut !== 'Actif'), creneaux: occ, demandes: dem, occupations, quinzaines: (pub && pub.quinzaines) || {} };
    const h = JSON.stringify(doc); if (dernierHash[cle] === h) continue; aMettre[cle] = h;
    aEnvoyer.push({ path: racine(db, cfg).collection('membres').doc(cle).path, data: Object.assign(doc, { maj: new Date().toISOString() }) }); n++;
  }
  if (n && Date.now() < pauseEcrituresJusqua) n = 0; // Firebase plein : on réessaiera après la pause (les empreintes ne bougent pas)
  else if (n) {
    let ok = false;
    try { await envoyerDocs(aEnvoyer); ok = true; }
    catch (e) {
      if (e.quota) { pauseEcrituresJusqua = Date.now() + 30 * 60000; console.warn('liens AESH : Firebase plein, nouvel essai dans 30 min'); }
      else if (e.name === 'AbortError' || /refusé/.test(e.message || '')) console.warn('liens AESH', e);
      else try { // envoi direct impossible sur ce réseau : envoi normal, sans jamais attendre plus d'une minute (sinon pause : rien ne s'empile)
        const batch = db.batch(); aEnvoyer.forEach(d => batch.set(db.doc(d.path), d.data));
        await Promise.race([batch.commit(), new Promise((_, ko) => setTimeout(() => ko(new Error('envoi sans réponse')), 60000))]); ok = true;
      } catch (e2) { pauseEcrituresJusqua = Date.now() + 30 * 60000; console.warn('liens AESH', e2); }
    }
    if (ok) { Object.assign(dernierHash, aMettre); try { localStorage.setItem(K_HASH, JSON.stringify(dernierHash)); } catch (e) {} } else n = 0;
  }
  dernierRepublier = Date.now();
  if (window.fichesEnLigne && Date.now() >= pauseEcrituresJusqua) await Promise.race([window.fichesEnLigne.publier(db, racine(db, cfg)), new Promise(ok => setTimeout(() => ok(false), 60000))]); // ne publie que si les fiches ont changé
  return n;
}

/* ---------- les « adresses » que Cockpit appelle ---------- */
function mail(to, sujet, corps, bcc) {
  const q = [['subject', sujet], ['body', corps]].concat(bcc ? [['bcc', bcc]] : []).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  setTimeout(() => { location.href = 'mailto:' + (to || '') + '?' + q; }, 50);
}
const emailA = id => ((S().aesh || []).find(a => a.id === id) || {}).email || '';
const libD = d => `${jourDe(d.date)} ${frD(d.date)}, ${hh(d.debut)}–${hh(d.fin)}, classe ${d.classe}, salle ${d.salle}`;
const SIGNATURE = '\n\nCécile BODIN\nCoordination AESH';

async function api(chemin, corps) {
  const { db } = await fb(), cfg = cfgEnLigne(); if (!cfg) throw new Error("Appli en ligne pas encore activée (Absences AESH › Appli en ligne).");
  const ref = racine(db, cfg), conf = await lireConfig(db, cfg);
  if (chemin === '/api/admin/demandes') {
    const R = await lireReponses(db, cfg), cand = plierCandidatures(R), pubS = await ref.collection('admin').doc('publication').get(), pub = pubS.exists ? pubS.data().p : null;
    const snap = await ref.collection('demandes').get(), D = [];
    for (const d of snap.docs) {
      const x = Object.assign({ id: d.id }, d.data()); delete x.k;
      const c = cand[x.id] || {}; const cands = Object.keys(c).map(aid => { const a = (S().aesh || []).find(y => y.id === aid) || { id: aid, nom: '?' }; return { id: aid, nom: a.nom, positionne: !!c[aid], libre: libreA(a, x.date, x.debut, x.fin, pub), suitClasse: (S().affectations || []).some(af => af.aeshId === aid && af.heures > 0 && (S().eleves || []).some(e => e.id === af.eleveId && normClasse(e.classe) === normClasse(x.classe))) }; });
      x.candidats = cands;
      x.desiste = x.statut === 'acceptee' && !!x.aeshId && c[x.aeshId] === false; // l'AESH validée s'est désistée depuis son lien
      if (x.note && x.date < auj()) { x.note = ''; await d.ref.update({ note: '' }); }
      D.push(x);
    }
    await republier(db, cfg, { conf, R, D });
    return { genere: new Date().toISOString().slice(0, 16), demandes: D };
  }
  if (chemin === '/api/admin/prises') {
    const st = await lirePrises(db, cfg);
    if (Date.now() - dernierRepublier > 90000) await republier(db, cfg, { conf }); // déjà fait il y a moins d'1 min 30 (vérification des demandes) : on économise les lectures
    return { prises: Object.values(st) };
  }
  if (chemin === '/api/admin/publier') {
    await ref.collection('admin').doc('publication').set({ p: JSON.parse(JSON.stringify(corps)), le: new Date().toISOString() });
    await membresAJour(); await republier(db, cfg, {});
    const neuves = (corps.absences || []).filter(ab => !(conf.prevenues || []).includes(ab.id) && (corps.occurrences || []).some(o => o.absenceId === ab.id));
    if (!neuves.length) return { message: 'créneaux à jour dans l\'appli de l\'équipe' };
    await ref.collection('admin').doc('config').set({ prevenues: (conf.prevenues || []).concat(neuves.map(x => x.id)) }, { merge: true });
    const bcc = (corps.aesh || []).map(a => a.email).filter(Boolean).join(',');
    mail('', 'Remplacement AESH : créneaux à prendre', `Bonjour,\n\n${neuves.map(x => x.nom).join(', ')} ${neuves.length > 1 ? 'sont absentes' : 'est absente'}${neuves[0].fin ? ' jusqu\'au ' + frD(neuves[0].fin) : ''}. Des créneaux sont à prendre.\n\nOuvre ton lien personnel de l'équipe (celui que je t'ai envoyé) pour voir les créneaux et te positionner depuis ton téléphone.\n\nMerci !` + SIGNATURE, bcc);
    return { message: 'brouillon de mail ouvert : collègues prévenues dès que tu l\'envoies' };
  }
  if (chemin === '/api/admin/prises/retirer') { // la coordination libère un créneau pris en ligne
    if (!corps || !corps.occId) throw new Error('Créneau inconnu');
    await ref.collection('prises').doc(String(corps.occId)).delete(); await republier(db, cfg, { conf });
    return { message: 'Créneau libéré dans l\'appli de l\'équipe' };
  }
  const id = corps && corps.id, dref = id ? ref.collection('demandes').doc(id) : null, dS = dref ? await dref.get() : null, d = dS && dS.exists ? dS.data() : null;
  if (!d) throw new Error('Demande introuvable');
  if (chemin === '/api/admin/demandes/supprimer') { // efface la demande et les candidatures des AESH qui s'y rapportent
    const rs = await ref.collection('reponses').where('demandeId', '==', id).get(), b = db.batch();
    rs.forEach(r => b.delete(r.ref)); b.delete(dref); await b.commit(); await republier(db, cfg, { conf });
    if (corps.prevenir) { const aE = d.statut === 'acceptee' && corps.aeshAussi ? emailA(d.aeshId) : '';
      mail([aE, d.profEmail].filter(Boolean).join(','), 'Accompagnement annulé : ' + frD(d.date) + ' ' + hh(d.debut), `Bonjour,\n\nL'accompagnement AESH prévu le ${libD(d)} (${d.type}) est annulé.\n\nMerci de votre compréhension.` + SIGNATURE); }
    return { message: 'Demande supprimée' };
  }
  if (chemin === '/api/admin/demandes/modifier') {
    const ch = corps.champs || {}, M = {};
    [['type', 40], ['date', 10], ['debut', 5], ['fin', 5], ['classe', 40], ['salle', 40], ['profNom', 80], ['profEmail', 120], ['commentaire', 500]].forEach(([k, n]) => { if (typeof ch[k] === 'string') M[k] = ch[k].trim().slice(0, n); });
    if ('notifie' in ch) M.notifie = !!ch.notifie;
    await dref.update(M); await republier(db, cfg, { conf });
    const n = Object.assign({}, d, M);
    if (corps.prevenir) { const aE = n.statut === 'acceptee' && corps.aeshAussi ? emailA(n.aeshId) : '';
      mail([aE, n.profEmail].filter(Boolean).join(','), 'Accompagnement modifié : ' + frD(n.date) + ' ' + hh(n.debut), `Bonjour,\n\nLa demande d'accompagnement AESH a été modifiée. Nouvelles informations : ${libD(n)} (${n.type}).${n.statut === 'acceptee' && n.aesh ? '\n\nAESH : ' + n.aesh + '.' : ''}\n\nMerci !` + SIGNATURE); }
    return { message: 'Demande modifiée' };
  }
  if (chemin === '/api/admin/demandes/annuler') { await dref.update({ statut: 'annulee' }); await republier(db, cfg, { conf }); return { message: 'Demande annulée' }; }
  if (chemin === '/api/admin/demandes/liberer') {
    await dref.update({ note: String(corps.note || '').slice(0, 4000), liberee: true }); await republier(db, cfg, { conf });
    mail(emailA(d.aeshId), 'Accompagnement du ' + frD(d.date) + ' : infos sur l\'élève', `Bonjour,\n\nLes informations sur l'élève à accompagner le ${libD(d)} sont dans ton lien personnel de l'équipe (rubrique « Mes demandes »). Elles seront effacées le lendemain.\n\nMerci !` + SIGNATURE);
    return { message: 'Infos communiquées à l\'AESH' };
  }
  if (chemin === '/api/admin/demandes/decider') {
    const dec = corps.decision;
    if (dec === 'proposer' || dec === 'elargir') {
      const vis = dec === 'proposer' && corps.aeshIds && corps.aeshIds.length ? corps.aeshIds : null;
      await dref.update(Object.assign({ statut: 'proposee', visibleA: vis }, d.statut === 'acceptee' ? { aeshId: null, aesh: '', liberee: false, note: '' } : {})); await membresAJour(); await republier(db, cfg, {});
      if (corps.prevenir) { const cibles = equipeA().filter(a => a.email && !(a.statut && a.statut !== 'Actif') && (!vis || vis.includes(a.id)) && !(dec === 'elargir' && d.visibleA && d.visibleA.includes(a.id)));
        mail('', 'Demande d\'accompagnement : ' + frD(d.date) + ' ' + hh(d.debut), `Bonjour,\n\nUn.e enseignant.e demande une AESH le ${libD(d)} (${d.type}).\n\nSi tu es disponible, positionne-toi dans ton lien personnel de l'équipe (rubrique « Demandes »).\n\nMerci !` + SIGNATURE, cibles.map(a => a.email).join(',')); }
      return { message: vis ? 'Proposée à ' + vis.length + ' AESH' : 'Proposée à toute l\'équipe' };
    }
    if (dec === 'accepter') {
      const a = (S().aesh || []).find(x => x.id === corps.aeshId) || {};
      await dref.update({ statut: 'acceptee', aeshId: corps.aeshId, aesh: a.nom || '' }); await republier(db, cfg, { conf });
      mail([a.email, d.profEmail].filter(Boolean).join(','), 'Accompagnement validé : ' + frD(d.date) + ' ' + hh(d.debut), `Bonjour,\n\nPour le ${libD(d)} (${d.type}), c'est ${a.nom || 'une AESH'} qui accompagnera.\n\nMerci à vous deux !` + SIGNATURE);
      return { message: 'Validée : ' + (a.nom || '') };
    }
    if (dec === 'refuser') {
      await dref.update({ statut: 'refusee', reponse: String(corps.message || '').slice(0, 1000) }); await republier(db, cfg, { conf });
      mail(d.profEmail || '', 'Votre demande d\'accompagnement du ' + frD(d.date), `Bonjour,\n\nJe ne peux pas donner suite à votre demande d'AESH pour le ${libD(d)}.${corps.message ? '\n\n' + corps.message : ''}\n\nBien cordialement,` + SIGNATURE);
      return { message: 'Demande refusée' };
    }
  }
  throw new Error('Action inconnue : ' + chemin);
}

window.fetch = async (url, opt) => {
  if (typeof url === 'string' && url.startsWith(ORIGINE + '/')) {
    const chemin = url.slice(ORIGINE.length);
    try { const corps = opt && opt.body ? JSON.parse(opt.body) : undefined; const j = await api(chemin, corps); return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (e) { return new Response(JSON.stringify({ erreur: e.message || String(e) }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
  }
  try { const u = typeof url === 'string' ? url : url && url.url; if (u && /firestore\.googleapis\.com/.test(u) && opt && opt.method && opt.method !== 'GET') compter(decodeURIComponent(u.split('/documents/')[1] || '')); } catch (e) {}
  return fetchOrig(url, opt);
};

/* ---------- carte « Appli en ligne » (Absences AESH et DS demande d'accompagnement) ---------- */
function fenetre(html) {
  const w = document.createElement('div'); w.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';
  w.innerHTML = `<div class="card" style="max-width:720px;width:100%;max-height:85vh;overflow:auto;position:relative"><button class="btn sm" style="position:absolute;top:10px;right:10px" data-x>Fermer</button>${html}</div>`;
  w.addEventListener('click', e => { if (e.target === w || e.target.hasAttribute('data-x')) w.remove(); }); document.body.appendChild(w); return w;
}
window.enligneActiver = async () => { window.toast && toast('Activation en cours…'); try { await activer(); toast('Appli en ligne activée'); window.PAS.render(); window.evalsActualiser && window.evalsActualiser(true); } catch (e) { alert(e.message); } };
window.enligneCopier = (t, b) => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copié'; }, () => window.saisir('Copie ce lien (sélectionné) :', t, { ok: 'Fermer', annuler: null }));
window.enligneLienProfs = () => { const cfg = cfgEnLigne(); if (!cfg) return; const l = lienProfs(cfg);
  fenetre(`<h2>Lien pour les enseignant.e.s</h2><p class="small muted">Avec ce lien, un.e enseignant.e t'envoie une demande d'AESH (DS, évaluation…). Il ne donne accès à rien d'autre. Mets-le dans l'ENT ou envoie-le par mail.</p><p style="word-break:break-all"><a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a></p><button class="btn primary" onclick="enligneCopier('${esc(l)}',this)">Copier le lien</button> <button class="btn" onclick="enligneMailProfs()">Préparer un mail</button>`);
  window.enligneMailProfs = () => mail('', 'Demander une AESH pour un DS ou une évaluation', "Bonjour,\n\nPour demander une AESH lors d'un DS, d'une évaluation ou d'une sortie, cliquez sur ce lien et remplissez le formulaire (pas besoin de compte ni de mot de passe) :\n" + l + "\n\nMerci de ne pas écrire de nom d'élève. Je vous réponds par mail.\n\nMerci !" + SIGNATURE); };
window.enligneLiensEquipe = async () => { const cfg = cfgEnLigne(); if (!cfg) return; let conf; try { conf = await membresAJour(); } catch (e) { return alert(e.message); }
  const A = equipeA().slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  window.enligneMailAesh = (id, bouton) => { const a = A.find(x => x.id === id); if (!a) return; const l = lienPerso(cfg, conf.membres[a.id]);
    mail(a.email, 'Ton lien pour les remplacements AESH', 'Bonjour ' + a.nom.split(' ')[0] + ",\n\nVoici ton lien personnel (ne le partage pas) :\n" + l + "\n\nTu y verras les créneaux à prendre quand une collègue est absente, et les demandes d'accompagnement pour les DS. Pas besoin de compte ni de mot de passe. Ouvre-le dans Safari, puis Partager › « Sur l'écran d'accueil ».\n\nMerci !" + SIGNATURE);
    if (bouton) bouton.textContent = 'Mail ouvert'; };
  fenetre(`<h2>Liens personnels de l'équipe</h2><p class="small muted">Chaque AESH a son propre lien : elle y voit les créneaux à prendre quand une collègue est absente, et les demandes d'accompagnement que tu lui proposes. Envoie à chacune le sien, une seule fois. Elle l'ajoute à l'écran d'accueil de son téléphone.</p>
  <table class="t compact"><tbody>${A.map(a => { const l = lienPerso(cfg, conf.membres[a.id]); return `<tr><td><b>${esc(a.nom)}</b>${a.email ? '' : ' <span class="pill warn">pas d\'e-mail</span>'}</td><td style="white-space:nowrap"><button class="btn sm" onclick="enligneCopier('${esc(l)}',this)">Copier</button> ${a.email ? `<button class="btn sm primary" onclick="enligneMailAesh('${a.id}',this)">Envoyer</button>` : ''}</td></tr>`; }).join('')}</tbody></table>`); };

// dernière vérification des créneaux pris et des demandes (toutes les 2 minutes tant que Cockpit est ouvert)
function etatTexte() {
  const p = window.prisesEtat;
  if (!p) return '<span class="muted">Vérification en cours…</span>';
  return p.ok ? `<span style="color:var(--ok)">✓ Vérifié à ${p.le}</span> <span class="muted">· ${p.n} créneau${p.n > 1 ? 'x' : ''} pris en ligne · nouvelle vérification toutes les 2 minutes</span>`
    : `<span style="color:var(--bad)">⚠ Vérification impossible à ${p.le} : ${esc(p.msg || '')}</span> <span class="muted">· vérifie internet et la Synchro, puis « Vérifier maintenant »</span>`;
}
window.enligneVerifier = async b => { if (b) { b.disabled = true; b.textContent = 'Vérification…'; }
  await Promise.all([window.prisesActualiser ? window.prisesActualiser(false) : 0, window.evalsActualiser ? window.evalsActualiser(false) : 0]);
  if (b) { b.disabled = false; b.textContent = 'Vérifier maintenant'; } const e = document.getElementById('enligne-etat'); if (e) e.innerHTML = etatTexte(); if (window.PAS) window.PAS.render(); };
setInterval(() => { const e = document.getElementById('enligne-etat'); if (e) e.innerHTML = etatTexte(); }, 15000);
function carte() {
  const cfg = cfgEnLigne(), relie = cfg && S().serveur && S().serveur.url === ORIGINE;
  return `<div class="card no-print" id="enligne-carte" style="margin-bottom:14px;border-left:4px solid var(--${relie ? 'ok' : 'warn'})"><h2 style="margin-top:0">Appli en ligne de l'équipe <span class="pill ${relie ? 'ok' : 'warn'}">${relie ? 'activée' : 'à activer'}</span></h2>
    ${relie ? `<p class="small muted" style="margin:0 0 8px">Les demandes des profs arrivent ici, et les AESH prennent les créneaux depuis leur téléphone. Quand tu proposes, valides ou déclares une absence, Cockpit ouvre un mail prêt à envoyer.</p>
      <button class="btn sm primary" onclick="enligneLiensEquipe()">Liens de l'équipe</button> <button class="btn sm" onclick="enligneLienProfs()">Lien pour les profs</button> <button class="btn sm" onclick="enligneVerifier(this)">Vérifier maintenant</button>${'Notification' in window && Notification.permission === 'default' ? ` <button class="btn sm" onclick="Notification.requestPermission().then(() => window.PAS.render())">Activer les notifications</button>` : ''}
      <div class="small" id="enligne-etat" style="margin-top:8px">${etatTexte()}</div>`
    : `<p class="small muted" style="margin:0 0 8px">Remplace l'ancienne appli. Il faut que la Synchro soit connectée sur cet appareil. À faire une seule fois : ensuite c'est actif sur tous tes appareils.</p><button class="btn sm primary" onclick="enligneActiver()">Activer l'appli en ligne</button>`}</div>`;
}
function injecter() {
  if (!/^#\/(absences|evals)/.test(location.hash)) return;
  const p = $('#page'); if (!p || p.querySelector('#enligne-carte') || !S()) return;
  p.insertAdjacentHTML('afterbegin', carte());
}
const obs = new MutationObserver(() => injecter());
function brancher() { const p = $('#page'); if (p) { obs.observe(p, { childList: true }); injecter(); } else setTimeout(brancher, 200); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', brancher); else brancher();
window.addEventListener('hashchange', () => setTimeout(injecter, 0));
// l'ancienne adresse de test (127.0.0.1:8745) est remplacée automatiquement une fois l'appli en ligne activée
setTimeout(() => { const s = S(); if (s && cfgEnLigne() && (!s.serveur || s.serveur.url !== ORIGINE)) { s.serveur = { url: ORIGINE, cle: 'firebase' }; window.PAS.save(); } }, 1500);
window.cockpitEnLigne = { api, ORIGINE };
})();
