/* Cockpit Coordo — application locale de suivi AESH. Vanilla JS, aucune dépendance obligatoire. */
(() => {
'use strict';

/* ====================== STORE ====================== */
const KEY = 'cockpit-pas-v1';
const SITES = ['Collège', 'SEGPA', 'ULIS', 'Lycée GT', 'Lycée Pro']; // SEGPA et ULIS = rubriques du collège
const NIVEAUX = ['6e', '5e', '4e', '3e', '2nde', '1ère', 'Tle', 'BTS'];
const STATUTS = ['Notifié', 'Dossier 1ère demande déposé AESHi', 'Dossier 1ère demande déposé AESHm', 'Dossier renouvellement déposé AESHi', 'Dossier renouvellement déposé AESHm', 'Dossier à monter', 'Vigilance (sans dossier)', 'Sorti / fin de notification'];
const MOTIFS_ABSENCE = ['Arrêt maladie', 'Congés', 'Grève', 'Congé enfant malade', 'RDV médical', 'Formation'];
const STATUTS_AESH = ['Actif', ...MOTIFS_ABSENCE]; // statut d'une AESH = Actif, ou le motif de son absence
const motifNormalise = m => m === 'Arrêt de travail' ? 'Arrêt maladie' : m === 'En congés' ? 'Congés' : m; // anciens libellés
// Rattachement automatique : les élèves d'un dispositif sont toujours rattachés aux AESH de ce dispositif. Si une AESH est remplacée par une autre
// (dispositif retiré / AESH supprimée, et dispositif donné à une nouvelle AESH), ses élèves passent à la nouvelle avec les mêmes heures, à confirmer.
function synchroDispositifs() {
  let n = 0;
  DISPOSITIFS.forEach(D => {
    const ids = S.aesh.filter(a => a.dispositif === D).map(a => a.id); if (!ids.length) return;
    S.eleves.filter(e => isActive(e) && dispositifDe(e) === D).forEach(e => {
      const hors = S.affectations.filter(x => x.eleveId === e.id && !ids.includes(x.aeshId));
      const manque = ids.filter(id => !S.affectations.some(x => x.eleveId === e.id && x.aeshId === id));
      manque.forEach((id, i) => { S.affectations.push({ eleveId: e.id, aeshId: id, heures: hors[i] ? hors[i].heures : 0, aConfirmer: true }); n++; });
      const pris = hors.slice(0, manque.length); // seules les AESH remplacées sont retirées ; les autres restent (et sont signalées en alerte)
      if (pris.length) S.affectations = S.affectations.filter(x => !pris.includes(x));
    });
  });
  return n;
}
// Dispositifs : un élève SEGPA n'est suivi que par les AESH SEGPA, un élève ULIS du collège que par les AESH ULIS. Le dispositif d'une AESH se règle dans sa fiche (champ « Dispositif », modifiable chaque année).
const dispositifDe = e => e.dispositif !== undefined && e.dispositif !== null ? (e.dispositif || null) : (e.site === 'SEGPA' ? 'SEGPA' : e.site === 'ULIS' ? 'ULIS' : (e.site === 'Collège' && /ULIS/i.test(e.classe || '') ? 'ULIS' : null)); // dispositif choisi dans la fiche, sinon déduit du site / de la classe
// SEGPA / ULIS : toujours précisé quand un élève est cité (l'équipe ne connaît pas tous les élèves)
const libDisp = e => { const d = dispositifDe(e) || (/ULIS/i.test(e.classe || '') ? 'ULIS' : null); return d && !new RegExp(d, 'i').test(e.classe || '') ? d : ''; }; // vide si la classe l'indique déjà (ex. « TCAP ULIS »)
const classeDisp = e => e.classe + (libDisp(e) ? ', élève ' + libDisp(e) : '');
const classeHtml = e => esc(e.classe) + (libDisp(e) ? ` <span class="pill warn">${libDisp(e)}</span>` : '');
const horsDispositif = (a, e) => { const d = dispositifDe(e); return d && a.dispositif !== d ? d : null; };
const absente = a => !!a.statut && a.statut !== 'Actif';
const aujourdhui = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const KANBAN = ['Vigilance (sans dossier)', 'Dossier à monter', 'Dossier 1ère demande déposé AESHi', 'Dossier 1ère demande déposé AESHm', 'Dossier renouvellement déposé AESHi', 'Dossier renouvellement déposé AESHm'];
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
const H0 = 8, H1 = 18; // planning 8h → 18h
const PERIODES = ['08:10', '09:05', '10:15', '11:10', '13:00', '13:55', '14:50', '16:00', '16:55']; // vraies bornes de créneaux de l'établissement
const PALETTE = ['#2F4A8A', '#1C8C7A', '#6D4BB5', '#C8443C', '#D98F17', '#2E8B57', '#B5405F', '#3C7FB1', '#7A6C2F', '#8A2F6E', '#1F7A8C', '#A0522D', '#4B6A2F', '#5A5AA0', '#C06030', '#2F8A8A'];

let S; // état global
const DISPOSITIFS = ['ULIS', 'SEGPA'];
/* ---- Fiches élèves remplies depuis les documents (PPS, MOPPS, GEVASCO, notifications MDPH, PAI, PAP…) : scripts/extraire_dossiers.py ---- */
const CHAMPS_DOSSIER = ['essDate', 'essHeure', 'essSalle', 'essNote', 'depotDate', 'numDossier', 'responsables', 'tel', 'email', 'adresse', 'enseignantReferent', 'gevascoDate', 'notifDebut', 'notifFin'];
const cleEleve = e => e.nom + '|' + e.prenom;
const frDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR') : '';
function appliquerDossiers() {
  const D = (window.DOSSIERS_DONNEES && window.DOSSIERS_DONNEES.eleves) || {}; let n = 0;
  S.eleves.forEach(e => {
    const d = D[cleEleve(e)]; if (!d) return;
    e.auto = e.auto || {}; e.manuel = e.manuel || {};
    CHAMPS_DOSSIER.forEach(c => { const x = d.champs[c]; if (!x || e.manuel[c]) return; if (!e[c] || e.auto[c]) { if (e[c] !== x.valeur) { e[c] = x.valeur; n++; } e.auto[c] = x.source; } });
    const pr = e.profil = e.profil || { troubles: [], aides: [], masques: { troubles: [], aides: [] } }; pr.masques = pr.masques || { troubles: [], aides: [] };
    const fus = (liste, auto, masques) => { const man = (liste || []).filter(i => i.manuel); const noms = new Set(man.map(i => i.nom.toLowerCase())); return [...auto.filter(a => !masques.includes(a.nom) && !noms.has(a.nom.toLowerCase())).map(a => ({ nom: a.nom, sources: a.sources })), ...man]; };
    const t2 = fus(pr.troubles, d.troubles || [], pr.masques.troubles), a2 = fus(pr.aides, d.aides || [], pr.masques.aides);
    if (JSON.stringify(t2) !== JSON.stringify(pr.troubles) || JSON.stringify(a2) !== JSON.stringify(pr.aides)) n++;
    pr.troubles = t2; pr.aides = a2; pr.maj = window.DOSSIERS_DONNEES.genere;
  });
  return n;
}
/* ====================== ESS (dates relevées dans les tableaux des ESS collège et lycée) ====================== */
// dates et heures lues automatiquement (js/ess-donnees.js, produit par scripts/extraire_ess.py) ; la salle se saisit dans la fiche élève ; une saisie manuelle n'est jamais écrasée
function appliquerEss() {
  const D = window.ESS_DONNEES; if (!D || !D.ess) return 0; let n = 0;
  const idx = {}; D.ess.forEach(x => { idx[x.eleve] = x; }); const src = (D.fichiers || []).join(', ');
  S.eleves.forEach(e => { const x = idx[e.nom + ' ' + e.prenom]; e.auto = e.auto || {}; e.manuel = e.manuel || {};
    [['essDate', (x && x.date) || ''], ['essHeure', (x && x.heure) || ''], ['essNote', (x && !x.date && x.statut) || '']].forEach(([c, v]) => {
      if (e.manuel[c]) return; if (!v && !e.auto[c]) return;
      if ((e[c] || '') !== v) { e[c] = v; n++; } if (v) e.auto[c] = src; else delete e.auto[c]; }); });
  return n;
}
const essMoment = e => e.essDate ? new Date(e.essDate + 'T' + (e.essHeure || '23:59') + ':00') : null;
const jourDe = iso => JOURS_LONGS[(new Date(iso + 'T12:00:00').getDay() + 6) % 7];
const heureTxt = h => h ? h.replace(':', 'h').replace(/h00$/, 'h00') : '';
const essDeLaSemaine = lundi => { const fin = new Date(lundi + 'T12:00:00'); fin.setDate(fin.getDate() + 6); const f = isoLocal(fin); return S.eleves.filter(e => !e.archive && e.essDate && e.essDate >= lundi && e.essDate <= f).sort((a, b) => (a.essDate + (a.essHeure || '')).localeCompare(b.essDate + (b.essHeure || '')) || a.nom.localeCompare(b.nom)); };
const aeshEss = e => affOf(e).filter(a => (a.heures ?? 0) > 0 || a.aConfirmer).map(a => aesh(a.aeshId)).filter(Boolean);
const lundiSuivant = (lundi, n) => { const d = new Date(lundi + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return isoLocal(d); };
const frCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
// semaine visée par le rappel : à partir du jeudi 10h00, la semaine suivante ; avant, la semaine en cours (rappel du jeudi précédent éventuellement en retard)
function essCible(now = new Date()) {
  const lundi = lundiDe(isoLocal(now)), jeudi = new Date(lundi); jeudi.setDate(jeudi.getDate() + 3); jeudi.setHours(10, 0, 0, 0);
  const apres = now >= jeudi; return { lundi: lundiSuivant(isoLocal(lundi), apres ? 1 : 0), declenche: apres, jeudi };
}
function essMessages(lundi) {
  const par = {};
  essDeLaSemaine(lundi).forEach(e => aeshEss(e).forEach(a => { (par[a.id] ||= { a, liste: [] }).liste.push(e); }));
  return Object.values(par).map(({ a, liste }) => {
    const sig = liste.map(e => [e.id, e.essDate, e.essHeure, e.essSalle].join('/')).join(';'), sent = (S.essRappels[lundi] || {})[a.id];
    const lignes = liste.map(e => `- ${e.prenom} ${e.nom} (${classeDisp(e)}) : ${jourDe(e.essDate)} ${frDate(e.essDate)} à ${e.essHeure ? heureTxt(e.essHeure) : "[heure à confirmer]"}, salle ${e.essSalle || '[à confirmer]'}`);
    const fin = new Date(lundi + 'T12:00:00'); fin.setDate(fin.getDate() + 4);
    const sujet = liste.length > 1 ? `Rappel : ${liste.length} ESS la semaine du ${frCourt(lundi)}` : `Rappel : ESS de ${liste[0].prenom} ${liste[0].nom}, ${jourDe(liste[0].essDate)} ${frDate(liste[0].essDate)}`;
    const corps = `Bonjour ${a.nom.split(' ')[0]},\n\nRappel : ${liste.length > 1 ? 'vous participez à ' + liste.length + ' ESS' : "vous participez à l'ESS suivante"} la semaine du ${frCourt(lundi)} au ${frCourt(isoLocal(fin))} :\n\n${lignes.join('\n')}\n\nMerci de me confirmer votre présence.\n\nCécile BODIN`;
    return { a, liste, sig, sujet, corps, sent, etat: !sent ? 'a-envoyer' : sent.sig === sig ? 'envoye' : 'modifie', manque: liste.some(e => !e.essSalle || !e.essHeure) };
  }).sort((x, y) => x.a.nom.localeCompare(y.a.nom, 'fr'));
}
const essDus = () => { const c = essCible(); if (!c.declenche && !essDeLaSemaine(c.lundi).some(e => essMoment(e) >= new Date())) return { c, n: 0, msgs: [] }; const msgs = essMessages(c.lundi).filter(m => m.etat !== 'envoye' && !absente(m.a) || false); return { c, n: msgs.length, msgs }; };
window.essCopier = (lundi, aid) => { const m = essMessages(lundi).find(x => x.a.id === aid); if (!m) return; navigator.clipboard.writeText(m.corps).then(() => toast('Message copié : à coller dans Pronote')); };
window.essMarquer = (lundi, aid, oui) => { const m = essMessages(lundi).find(x => x.a.id === aid); if (!m) return; S.essRappels[lundi] = S.essRappels[lundi] || {}; if (oui) S.essRappels[lundi][aid] = { le: new Date().toISOString(), sig: m.sig }; else delete S.essRappels[lundi][aid]; commit('ess', `Rappel d'ESS ${oui ? 'envoyé à' : 'remis à envoyer pour'} ${m.a.nom} (semaine du ${frDate(lundi)})`); };
// ouvre un brouillon par AESH dans la messagerie du Mac (adresse académique du destinataire déjà remplie) ; un clic sur « Envoyer » dans la messagerie
window.essMailTous = async lundi => {
  const L = essMessages(lundi).filter(m => m.etat !== 'envoye' && !absente(m.a) && m.a.email);
  if (!L.length) return toast('Aucun message à envoyer');
  if (!confirm(`Ouvrir ${L.length} brouillon${L.length > 1 ? 's' : ''} d'e-mail (un par AESH) dans ta messagerie ? Vérifie que ton compte académique est le compte d'envoi.`)) return;
  for (const m of L) { const a = document.createElement('a'); a.href = `mailto:${m.a.email}?subject=${encodeURIComponent(m.sujet)}&body=${encodeURIComponent(m.corps)}`; document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 1500)); }
  if (confirm('Une fois les e-mails envoyés depuis ta messagerie, les marquer comme « envoyés » ici ?')) { L.forEach(m => { S.essRappels[lundi] = S.essRappels[lundi] || {}; S.essRappels[lundi][m.a.id] = { le: new Date().toISOString(), sig: m.sig }; }); commit('ess', `Rappels d'ESS envoyés par e-mail à ${L.length} AESH (semaine du ${frDate(lundi)})`); }
};
window.essMail = (lundi, aid) => { const m = essMessages(lundi).find(x => x.a.id === aid); if (!m) return; location.href = `mailto:${m.a.email || ''}?subject=${encodeURIComponent(m.sujet)}&body=${encodeURIComponent(m.corps)}`; };
let essVue = null;
window.essSemaine = n => { essVue = lundiSuivant(essVue || essCible().lundi, n); render(); };
window.essAujourdhui = () => { essVue = null; render(); };
window.essNotifPerm = () => { try { Notification.requestPermission().then(() => render()); } catch (x) { } };
// rappel du jeudi 10h00 : bandeau dans l'appli + notification du Mac si l'appli est ouverte
function essVerifierRappel() {
  try { const J = essProches().filter(e => e.essDate === aujourdhui() && !S.essNotif['j0:' + cleJ2(e)]); if (J.length) { J.forEach(e => { S.essNotif['j0:' + cleJ2(e)] = new Date().toISOString(); }); save(); toast(`ESS AUJOURD'HUI : ${J.map(e => e.nom + ' ' + e.prenom + (e.essHeure ? ' à ' + heureTxt(e.essHeure) : '')).join(', ')}`); if ('Notification' in window && Notification.permission === 'granted') new Notification('Cockpit Coordo — ESS aujourd\'hui', { body: J.map(e => `${e.nom} ${e.prenom}${e.essHeure ? ' · ' + heureTxt(e.essHeure) : ''}${e.essSalle ? ' · salle ' + e.essSalle : ''}`).join('\n') }); majCompteurAlertes(); render(); } } catch (x) { }
  try { const L = essProches().filter(e => !S.essNotif['j2:' + cleJ2(e)]); if (L.length) { L.forEach(e => { S.essNotif['j2:' + cleJ2(e)] = new Date().toISOString(); }); save(); toast(`ESS à venir : ${L.map(e => e.nom + ' ' + e.prenom).join(', ')}`); if ('Notification' in window && Notification.permission === 'granted') new Notification('Cockpit Coordo — ESS à venir', { body: L.map(e => `${e.nom} ${e.prenom} · ${frDate(e.essDate)}${e.essHeure ? ' à ' + heureTxt(e.essHeure) : ''}`).join('\n') }); majCompteurAlertes(); render(); } } catch (x) { }
  try {
    const d = essDus(); if (!d.c.declenche || !d.n) return; if (S.essNotif[d.c.lundi]) return;
    S.essNotif[d.c.lundi] = new Date().toISOString(); save();
    toast(`Rappel du jeudi : ${d.n} message${d.n > 1 ? 's' : ''} d'ESS à envoyer`);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Cockpit Coordo — ESS de la semaine prochaine', { body: `${d.n} AESH à prévenir (messages prêts pour Pronote).` });
    majCompteurAlertes(); render();
  } catch (x) { }
}
// Rappel 2 jours avant chaque ESS (2 jours ouvrés : une ESS du lundi est rappelée dès le jeudi) ; reste affiché jusqu'à l'ESS ou jusqu'à « Vu »
const joursOuvresAvant = (iso, n) => { const d = new Date(iso + 'T12:00:00'); let k = 0; while (k < n) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) k++; } return isoLocal(d); };
const cleJ2 = e => e.id + '@' + e.essDate;
function essProches() {
  const auj = aujourdhui(), now = maintenantLocal();
  return S.eleves.filter(e => !e.archive && e.essDate && e.essDate >= auj && auj >= joursOuvresAvant(e.essDate, 2) && `${e.essDate}T${e.essHeure || '23:59'}` > now && !S.essVus[cleJ2(e)])
    .sort((a, b) => (a.essDate + (a.essHeure || '')).localeCompare(b.essDate + (b.essHeure || '')));
}
window.essVu = k => { S.essVus[k] = new Date().toISOString(); commit('ess', 'Rappel d\'ESS marqué comme vu'); };
function bandeauEssProches() {
  const L = essProches(); const p = $('#page'); if (!L.length || !p || p.querySelector('.bandeau-ess-j2')) return;
  const auj = aujourdhui(), dans = iso => { const n = Math.round((new Date(iso + 'T12:00:00') - new Date(auj + 'T12:00:00')) / 864e5); return n === 0 ? '<b style="color:#d92d20">AUJOURD\'HUI</b>' : n === 1 ? 'demain' : 'dans ' + n + ' jours'; };
  p.insertAdjacentHTML('afterbegin', `<div class="bandeau-ess-j2 no-print" style="background:#EAF4FF;border:1px solid #7FB2E5;border-radius:10px;padding:10px 14px;margin-bottom:12px"><b>ESS à venir</b><ul style="list-style:none;padding:0;margin:6px 0 0">${L.map(e => `<li style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:3px 0"><span><a href="#/eleves/${e.id}" style="color:inherit"><b>${esc(e.nom)} ${esc(e.prenom)}</b></a> ${libDisp(e) ? '<span class="pill warn">' + libDisp(e) + '</span> ' : ''}<span class="muted">${esc(e.classe)}</span> · ${dans(e.essDate)} (${jourDe(e.essDate)} ${frDate(e.essDate)}${e.essHeure ? ' à ' + heureTxt(e.essHeure) : ''}) · salle ${e.essSalle ? esc(e.essSalle) : '<span class="pill warn">à saisir</span>'}${aeshEss(e).length ? ' · ' + aeshEss(e).map(a => esc(a.nom.split(' ')[0])).join(', ') : ''}</span><button class="btn sm" onclick="essVu('${cleJ2(e)}')">Vu</button></li>`).join('')}</ul></div>`);
}
function bandeauEss() {
  bandeauEssProches();
  const d = essDus(); if (!d.n || /^#\/ess/.test(location.hash)) return;
  const p = $('#page'); if (!p || p.querySelector('.bandeau-ess')) return;
  p.insertAdjacentHTML('afterbegin', `<div class="bandeau-ess no-print" style="background:#FFF4E0;border:1px solid #E8B35A;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><b>Rappel des ESS</b> — ${essDeLaSemaine(d.c.lundi).length} ESS la semaine du ${frCourt(d.c.lundi)} : ${d.n} message${d.n > 1 ? 's' : ''} à envoyer aux AESH.</span><a class="btn sm primary" href="#/ess">Préparer les messages</a></div>`);
}
function pageEss() {
  const cible = essCible(); const lundi = essVue || cible.lundi; const aujLundi = essCible().lundi;
  setTitle('ESS');
  const D = window.ESS_DONNEES || {}, auj = aujourdhui();
  const toutes = S.eleves.filter(e => !e.archive && (e.essDate || (e.essNote && e.essNote !== 'démission'))).sort((a, b) => (a.essDate || '9999').localeCompare(b.essDate || '9999') || a.nom.localeCompare(b.nom));
  const avenir = toutes.filter(e => e.essDate && e.essDate >= auj), sem = essDeLaSemaine(lundi), msgs = essMessages(lundi), afixer = toutes.filter(e => !e.essDate);
  const fin = new Date(lundi + 'T12:00:00'); fin.setDate(fin.getDate() + 6);
  const kpi = (v, l, k = '') => `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const rows = sem.map(e => { const A = aeshEss(e); return `<tr><td><a href="#/eleves/${e.id}" style="color:inherit"><b>${esc(e.nom)}</b> ${esc(e.prenom)}</a></td><td class="small">${classeHtml(e)}</td><td class="small"><b>${jourDe(e.essDate)}</b> ${frDate(e.essDate)}</td><td class="small">${e.essHeure ? heureTxt(e.essHeure) : '<span class="pill warn">heure ?</span>'}</td><td class="small">${e.essSalle ? esc(e.essSalle) : `<a href="#/eleves/${e.id}"><span class="pill warn">salle à saisir</span></a>`}</td><td class="small">${A.map(a => `<span class="dot" style="background:${couleurAesh(a)}"></span>${esc(a.nom)}${absente(a) ? ' <span class="pill warn">en absence</span>' : ''}`).join('<br>') || '<span class="muted">aucune AESH</span>'}</td></tr>`; }).join('');
  const blocs = msgs.map(m => `<div class="card" style="margin:8px 0;padding:10px 12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><span class="dot" style="background:${couleurAesh(m.a)}"></span><b>${esc(m.a.nom)}</b> <span class="small muted">${m.liste.length} ESS</span> ${m.etat === 'envoye' ? `<span class="pill ok">envoyé le ${frDate(m.sent.le.slice(0, 10))}</span>` : m.etat === 'modifie' ? '<span class="pill warn">ESS modifiée depuis l\'envoi</span>' : '<span class="pill bad">à envoyer</span>'}${m.manque ? ' <span class="pill warn">salle ou heure manquante</span>' : ''}${absente(m.a) ? ' <span class="pill warn">AESH en absence</span>' : ''}</div>
    <span class="no-print"><button class="btn sm primary" onclick="essCopier('${lundi}','${m.a.id}')">Copier pour Pronote</button> <button class="btn sm" onclick="essMail('${lundi}','${m.a.id}')">Écrire par e-mail</button> ${m.etat === 'envoye' ? `<button class="btn sm ghost" onclick="essMarquer('${lundi}','${m.a.id}',false)">Remettre à envoyer</button>` : `<button class="btn sm" onclick="essMarquer('${lundi}','${m.a.id}',true)">Marquer envoyé</button>`}</span></div>
    <details style="margin-top:6px"><summary class="small muted">Voir le message</summary><div class="small" style="white-space:pre-wrap;background:var(--bg-soft,#F5F7FA);padding:8px;border-radius:6px;margin-top:6px"><b>Objet :</b> ${esc(m.sujet)}\n\n${esc(m.corps.replace(/\\n/g, '\n'))}</div></details></div>`).join('');
  const reste = toutes.filter(e => e.essDate && e.essDate >= auj);
  const notifOk = 'Notification' in window ? Notification.permission : 'indispo';
  $('#page').innerHTML = `<div class="kpis" style="margin-bottom:14px">${kpi(avenir.length, 'ESS à venir')}${kpi(essDeLaSemaine(aujLundi).length, 'cette semaine' + (cible.declenche ? '' : ' (rappel dû)'))}${kpi(essDeLaSemaine(lundiSuivant(aujLundi, cible.declenche ? 0 : 1)).length, 'semaine suivante')}${kpi(afixer.length, 'à fixer / en attente', afixer.length ? 'warn' : 'ok')}</div>
  <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Rappel — semaine du ${frCourt(lundi)} au ${frCourt(isoLocal(fin))}${lundi === aujLundi ? ' <span class="pill ok">semaine visée</span>' : ''}</h2><span class="no-print"><button class="btn sm primary" onclick="essMailTous('${lundi}')">E-mailer toutes les AESH</button> <button class="btn sm" onclick="essSemaine(-1)">← précédente</button> <button class="btn sm" onclick="essAujourdhui()">semaine visée</button> <button class="btn sm" onclick="essSemaine(1)">suivante →</button></span></div>
    <p class="small muted" style="margin:6px 0 10px">Chaque jeudi à 10h00, l'appli te rappelle les ESS de la semaine suivante (bandeau en haut de chaque page et notification du Mac si l'appli est ouverte). Les messages sont prêts : <b>Copier pour Pronote</b>, puis colle-les dans la messagerie Pronote (l'appli ne peut pas écrire elle-même dans Pronote). Ou bien <b>Écrire par e-mail</b> : un brouillon est ouvert dans ta messagerie, adressé à l'adresse académique de l'AESH ; il ne reste qu'à cliquer sur Envoyer. « Marquer envoyé » les retire du rappel.</p>
    ${sem.length ? `<table class="t compact"><thead><tr><th>Élève</th><th>Classe</th><th>Date</th><th>Heure</th><th>Salle</th><th>AESH concerné.e.s</th></tr></thead><tbody>${rows}</tbody></table>${blocs}` : '<div class="empty">Aucune ESS cette semaine-là.</div>'}</div>
  <div class="card" style="margin-top:14px"><h2>Toutes les ESS <span class="small muted">lues dans ${esc((D.fichiers || []).join(' · ') || 'les tableaux des ESS')}${D.genere ? ' (mise à jour du ' + frDate(D.genere.slice(0, 10)) + ')' : ''}</span></h2>
    <table class="t compact"><thead><tr><th>Date</th><th>Heure</th><th>Élève</th><th>Classe</th><th>Salle</th><th>AESH</th></tr></thead><tbody>${toutes.map(e => `<tr style="${e.essDate && e.essDate < auj ? 'opacity:.5' : ''}"><td class="small">${e.essDate ? '<b>' + jourDe(e.essDate) + '</b> ' + frDate(e.essDate) : `<span class="pill warn">${esc(e.essNote || 'à fixer')}</span>`}</td><td class="small">${heureTxt(e.essHeure)}</td><td><a href="#/eleves/${e.id}" style="color:inherit"><b>${esc(e.nom)}</b> ${esc(e.prenom)}</a></td><td class="small">${classeHtml(e)}</td><td class="small">${esc(e.essSalle || '')}</td><td class="small">${aeshEss(e).map(a => esc(a.nom)).join(', ')}</td></tr>`).join('')}</tbody></table>
    <p class="small muted" style="margin:8px 0 0">Les tableaux contiennent aussi des élèves qui n'ont pas d'AESH : ${(D.nonRapproches || []).length} lignes ne sont pas reprises. Les tableaux se mettent à jour en relançant la mise à jour des fiches (procédure dans scripts/LISEZ-MOI.md). La date, l'heure et la salle se corrigent dans la fiche de l'élève.</p>
    ${notifOk === 'default' ? '<button class="btn sm no-print" onclick="essNotifPerm()">Activer les notifications du Mac pour le rappel du jeudi</button>' : notifOk === 'denied' ? '<span class="small muted">Notifications du Mac refusées : le rappel s\'affiche seulement dans l\'appli.</span>' : ''}</div>`;
}

// Statut du dossier MDPH d'après la date de validité de la notification (documents, à défaut le tableau PIAL), sauf statut saisi à la main
const STATUTS_A_LA_MAIN = ['Dossier à monter', 'Vigilance (sans dossier)', 'Sorti / fin de notification'];
function anneeScolaireRef() { const m = ((S.calendrier && S.calendrier.annee) || '').match(/(\d{4})/); const y = m ? +m[1] : new Date().getFullYear(); return { debut: y + '-09-01', fin: (y + 1) + '-08-31', libelle: y + '-' + (y + 1) }; }
function statutCalcule(e) {
  const A = anneeScolaireRef(), P = ((window.PIAL_DONNEES && window.PIAL_DONNEES.eleves) || {})[cleEleve(e)], suf = e.type === 'Individuel' ? 'AESHi' : 'AESHm';
  const fin = e.notifFin || (P && P.fin) || '';
  if (fin && fin >= A.debut) return { statut: 'Notifié', raison: `notification valable jusqu'au ${frDate(fin)}` };
  if (fin) return { statut: 'Dossier renouvellement déposé ' + suf, raison: `notification échue le ${frDate(fin)} : renouvellement pour ${A.libelle}` };
  if (P) {
    if (P.statut === 'En attente de renouvellement') return { statut: 'Dossier renouvellement déposé ' + suf, raison: `PIAL : en attente de renouvellement (${A.libelle})` };
    if (/^En attente de 1e/.test(P.statut)) return { statut: 'Dossier 1ère demande déposé ' + suf, raison: 'PIAL : en attente de 1ʳᵉ notification' };
    if (P.statut === 'Accompagné') return { statut: 'Notifié', raison: 'PIAL : accompagné' };
  }
  return null;
}
function appliquerStatuts() {
  let n = 0; const P = (window.PIAL_DONNEES && window.PIAL_DONNEES.eleves) || {};
  S.eleves.forEach(e => {
    if (e.archive || STATUTS_A_LA_MAIN.includes(e.statut) || e.statutManuel) return;
    if (!e.notifFin && P[cleEleve(e)] && P[cleEleve(e)].fin) { e.auto = e.auto || {}; e.notifFin = P[cleEleve(e)].fin; e.auto.notifFin = 'tableau PIAL'; }
    const r = statutCalcule(e); if (!r) return;
    e.statutAuto = r.raison;
    if (e.statut !== r.statut) { log('dossier', `${e.nom} ${e.prenom} : statut ${e.statut} → ${r.statut} (${r.raison})`); e.statut = r.statut; n++; }
  });
  return n;
}
window.statutAuto = id => { const e = eleve(id); e.statutManuel = false; appliquerStatuts(); commit('dossier', `${e.nom} ${e.prenom} : statut recalculé d'après la date de validité`); };

/* ---- dossiers « Aménagements / Notifications » et « EDT AESH » (rapprochement automatique des fichiers) ---- */
// js/documents.js absent ou ancien (ex. sur le Mac) : l'appli continue de marcher, simplement sans rapprochement des documents
const DOCS_LIB = () => window.DOCUMENTS || { rapprocher: () => ({ parEleve: {}, aClasser: [] }), rapprocherEdt: () => ({ parAesh: {}, aClasser: [] }), ORDRE_TYPES: ['MOPPS', 'PPS', 'MDPH / notification', 'PAI', 'PAP', 'GEVASCO', 'Contrat d’aménagement', 'Autre document'] };
let DOSS = { source: '', maj: '', docs: { parEleve: {}, aClasser: [] }, edt: { parAesh: {}, aClasser: [] }, tous: [], nbDocs: 0, nbEdt: 0 };
async function chargerDossiers() {
  let docs = [], edt = [], source = 'index', maj = '';
  try {
    if (window.cockpitFS) { docs = await window.cockpitFS.listDocuments(); edt = await window.cockpitFS.listEdt(); source = 'dossier'; maj = new Date().toISOString(); }
    else if (window.DOSSIERS_INDEX) { docs = window.DOSSIERS_INDEX.docs || []; edt = window.DOSSIERS_INDEX.edt || []; maj = window.DOSSIERS_INDEX.genere || ''; }
  } catch (e) { console.warn('Dossiers illisibles', e); }
  const rapDocs = DOCS_LIB().rapprocher(docs, S.eleves), rapEdt = DOCS_LIB().rapprocherEdt(edt, S.aesh);
  const tous = []; Object.values(rapDocs.parEleve).forEach(l => l.forEach(f => { f.i = tous.length; tous.push(f); })); rapDocs.aClasser.forEach(a => { a.fichier.i = tous.length; tous.push(a.fichier); });
  DOSS = { source, maj, docs: rapDocs, edt: rapEdt, tous, nbDocs: docs.length, nbEdt: edt.length };
  if (/^#\/(eleves\/|aesh\/|parametres)/.test(location.hash)) render();
}
window.ouvrirDoc = i => { const f = DOSS.tous[i]; if (!f) return; if (window.cockpitFS && window.cockpitFS.openDocument && f.rel) window.cockpitFS.openDocument(f.rel); else window.open(f.url, '_blank'); };
// MOPPS / GEVASCO de l'élève : le fichier (PDF ou image) du dossier « Aménagements / Notifications », le plus récent s'il y en a plusieurs
const docsDeType = (e, type) => ((DOSS.docs.parEleve || {})[e.id] || []).filter(f => f.type === type).sort((x, y) => String(y.annee).localeCompare(String(x.annee)) || (y.mtime || 0) - (x.mtime || 0));
function lienDoc(e, type, libelle) {
  const L = docsDeType(e, type);
  if (!L.length) return `<span class="muted" title="Aucun ${libelle} dans le dossier de cet élève">—</span>`;
  return `<a href="javascript:ouvrirDoc(${L[0].i})" title="Ouvrir : ${esc(L[0].name)}${L.length > 1 ? ' (' + (L.length - 1) + ' autre' + (L.length > 2 ? 's' : '') + ' dans la fiche)' : ''}">${libelle}</a>${L.length > 1 ? ` <span class="muted">(${L.length})</span>` : ''}`;
}
const edtAesh = a => { const f = DOSS.edt.parAesh[a.id]; if (f) return { url: f.url, name: f.name }; return null; }; /* version en ligne : les photos d'EDT restent sur le Mac */
// statut du dossier + date de dépôt quand le dossier est déposé (« Dossier renouvellement déposé AESHm — déposé le … »)
// Pastille de validité de la notification (même présentation que le tableau « Décisions MDPH / PPS ») : en cours / échue / échue avec renouvellement déposé
function pastilleValidite(e, court = false) {
  if (!e.notifFin) return '';
  if (e.notifFin >= aujourdhui()) return `<span class="pill ok" title="Notification valable jusqu'au ${frDate(e.notifFin)}">en cours</span>`;
  if (/déposé/.test(e.statut || '')) return ''; // déjà dit par le statut (« Échue - renouvellement déposé … ») : pas de doublon
  return `<span class="pill bad" title="Notification échue le ${frDate(e.notifFin)} : pas de renouvellement déposé">échue</span>`;
}
// libellé du statut : « Échue - renouvellement déposé AESHi / AESHm » quand la notification est échue et le renouvellement déposé
const statutTxt = e => { let t = e.statut || ''; if (/^Dossier renouvellement déposé/.test(t) && e.notifFin && e.notifFin < aujourdhui()) t = t.replace(/^Dossier renouvellement déposé/, 'Échue - renouvellement déposé'); return t + (/déposé/.test(e.statut || '') && e.depotDate ? ` — déposé le ${frDate(e.depotDate)}` : ''); };
function statutNote(e) {
  if (e.statutManuel) return `<dt></dt><dd class="small muted">Statut saisi à la main · <a href="javascript:statutAuto('${e.id}')">recalculer d'après la date de validité</a></dd>`;
  if (e.statutAuto) return `<dt></dt><dd class="small muted" title="Le statut se met à jour automatiquement d'après la date de validité de la notification MDPH">Statut calculé : ${esc(e.statutAuto)}</dd>`;
  return '';
}
function carteDecisions(e) {
  const D = ((window.DOSSIERS_DONNEES && window.DOSSIERS_DONNEES.eleves) || {})[cleEleve(e)], dec = (D && D.decisions) || [], auj = aujourdhui();
  if (!dec.length) return '';
  const etat = x => x.debut > auj ? ['à venir', 'neutral'] : x.fin < auj ? ['échue', 'bad'] : ['en cours', 'ok'];
  return `<div class="card" style="margin-top:14px"><h2>Décisions MDPH / PPS — validité <span class="small muted">relevées dans les PPS, MOPPS et notifications</span></h2>
    <table class="t compact"><thead><tr><th>Décision</th><th>Période de validité</th><th>État</th><th>Décidée le</th><th>Document</th></tr></thead><tbody>${dec.map(x => { const [l, k] = etat(x); return `<tr><td><b>${esc(x.objet)}</b></td><td>du ${frDate(x.debut)} au ${frDate(x.fin)}</td><td><span class="pill ${k}">${l}</span></td><td class="small">${x.dateDecision ? frDate(x.dateDecision) : '—'}</td><td class="small muted">${esc(x.source || '')}</td></tr>`; }).join('')}</tbody></table>
    <p class="small muted" style="margin:8px 0 0">Le statut du dossier (Notifié, renouvellement déposé…) suit la validité de l'aide humaine (AESH). Un PPS est valable jusqu'à la fin du cycle en cours et peut être révisé à la demande de la famille.</p></div>`;
}
function carteProfil(e) {
  const pr = e.profil || { troubles: [], aides: [] }, src = it => it.manuel ? 'saisi dans la fiche' : 'relevé dans : ' + (it.sources || []).join(', ');
  const tr = (pr.troubles || []).map(t => `<span class="chip ${t.manuel ? 'mutu' : 'indiv'}" style="cursor:default" title="${esc(src(t))}">${esc(t.nom)}</span>`).join(' ');
  const ad = (pr.aides || []).map(a => `<li title="${esc(src(a))}">${esc(a.nom)}${a.manuel ? ' <span class="small muted">(saisi)</span>' : ''}</li>`).join('');
  const nbDocs = ((window.DOSSIERS_DONNEES && window.DOSSIERS_DONNEES.eleves[cleEleve(e)]) || { sources: [] }).sources.length;
  return `<div class="card" style="margin-top:14px"><h2>Troubles et aides à mettre en place <button class="btn sm no-print" style="float:right" onclick="editProfil('${e.id}')">Modifier</button></h2>
    <div class="grid g2" style="gap:14px"><div><b class="small">Troubles mentionnés</b><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${tr || '<span class="muted small">Aucun trouble relevé dans les documents.</span>'}</div></div>
    <div><b class="small">Aides et aménagements</b>${ad ? `<ul style="margin:6px 0 0;padding-left:18px">${ad}</ul>` : '<div class="muted small" style="margin-top:6px">Aucune aide relevée.</div>'}</div></div>
    <p class="small muted" style="margin:10px 0 0">Mentions relevées automatiquement dans les documents de l'élève (GEVASCO, PPS, MOPPS, notifications MDPH, PAI, PAP…) — ${nbDocs} document${nbDocs > 1 ? 's' : ''} lu${nbDocs > 1 ? 's' : ''}${pr.maj ? ', mise à jour du ' + new Date(pr.maj).toLocaleDateString('fr-FR') : ''}. Ce ne sont pas des diagnostics : survole une mention pour voir le document source. Les mentions saisies à la main sont conservées.</p></div>`;
}
window.editProfil = id => {
  const e = eleve(id), pr = e.profil = e.profil || { troubles: [], aides: [], masques: { troubles: [], aides: [] } }, D = ((window.DOSSIERS_DONNEES && window.DOSSIERS_DONNEES.eleves) || {})[cleEleve(e)] || { troubles: [], aides: [] };
  modal(`<h2>Troubles et aides — ${esc(e.prenom)} ${esc(e.nom)}</h2><div class="form-grid">
    <label class="f wide">Troubles (un par ligne)<textarea name="troubles" rows="6">${esc((pr.troubles || []).map(t => t.nom).join('\n'))}</textarea></label>
    <label class="f wide">Aides et aménagements à mettre en place (un par ligne)<textarea name="aides" rows="10">${esc((pr.aides || []).map(a => a.nom).join('\n'))}</textarea></label></div>
    <p class="small muted">Les mentions relevées dans les documents reviennent à chaque mise à jour, sauf si tu les supprimes ici. Celles que tu ajoutes sont conservées.</p>`, d => {
    pr.masques = pr.masques || { troubles: [], aides: [] };
    const trait = (txt, auto, cle) => { const lignes = [...new Set(String(txt || '').split('\n').map(x => x.trim()).filter(Boolean))]; const autoNoms = auto.map(a => a.nom); const items = lignes.map(nom => { const a = auto.find(x => x.nom.toLowerCase() === nom.toLowerCase()); return a ? { nom: a.nom, sources: a.sources } : { nom, manuel: true }; }); pr.masques[cle] = autoNoms.filter(n => !items.some(i => !i.manuel && i.nom === n)); return items; };
    pr.troubles = trait(d.troubles, D.troubles || [], 'troubles'); pr.aides = trait(d.aides, D.aides || [], 'aides');
    commit('eleve', `${e.nom} ${e.prenom} : troubles et aides modifiés`);
  });
};
function carteDocuments(e) {
  const l = DOSS.docs.parEleve[e.id] || [];
  const groupes = (DOCS_LIB().ORDRE_TYPES || []).map(t => [t, l.filter(f => f.type === t)]).filter(([, x]) => x.length);
  const corps = groupes.length ? groupes.map(([t, x]) => `<div style="margin:6px 0"><b class="small">${esc(t)}</b><ul style="margin:3px 0 0;padding-left:18px">${x.map(f => `<li><a href="javascript:ouvrirDoc(${f.i})">${esc(f.name)}</a>${f.annee ? ` <span class="small muted">${esc(f.annee)}</span>` : ''}</li>`).join('')}</ul></div>`).join('')
    : `<p class="small muted" style="margin:4px 0 0">Aucun document trouvé. Dépose le fichier (PDF, photo…) dans le dossier « Aménagements / Notifications » avec <b>NOM Prénom</b> dans son nom : il apparaîtra ici automatiquement.</p>`;
  return `<div class="card" style="margin-top:14px"><h2>Documents <span class="small muted">MOPPS · PPS · MDPH · PAI · PAP · GEVASCO — ${l.length} fichier${l.length > 1 ? 's' : ''}</span></h2>${corps}</div>`;
}
function load() {
  const seed = window.PAS_SEED;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (seed && seed._seedVersion && saved._seedVersion !== seed._seedVersion) {
        // Les données de référence (élèves, AESH, affectations, créneaux) ont été mises à jour depuis l'extérieur :
        // on les recharge automatiquement, en conservant l'historique (journal, archives) et les préférences déjà enregistrés.
        const fresh = JSON.parse(JSON.stringify(seed));
        fresh.journal = saved.journal || fresh.journal;
        fresh.archives = saved.archives || fresh.archives;
        fresh.segmentsRempl = saved.segmentsRempl || fresh.segmentsRempl;
        fresh.prisesOcc = saved.prisesOcc || fresh.prisesOcc;
        fresh.pubApercu = saved.pubApercu || false; fresh.serveur = saved.serveur || fresh.serveur; fresh.evals = saved.evals || fresh.evals; fresh.evalsVues = saved.evalsVues || fresh.evalsVues; if (saved.questions) { fresh.questions = saved.questions; fresh.questionsAjoutees = saved.questionsAjoutees; }
        fresh.affConfirmees = saved.affConfirmees || fresh.affConfirmees; fresh.essVus = saved.essVus || fresh.essVus; fresh.prisesVues = saved.prisesVues || fresh.prisesVues; fresh.essRappels = saved.essRappels || fresh.essRappels; fresh.essNotif = saved.essNotif || fresh.essNotif; // rappels d'ESS déjà envoyés
        fresh.absences = saved.absences || fresh.absences; // historique des absences : saisie de l'appli, conservée
        // saisies faites dans l'appli (calendrier, règles de l'équipe, souhaits, dispositif et compteur d'heures supplémentaires des AESH) : conservées
        if (saved.calendrier) fresh.calendrier = saved.calendrier;
        if (saved.regles) fresh.regles = saved.regles;
        (saved.aesh || []).forEach(sa => { const fa = fresh.aesh.find(x => x.id === sa.id); if (fa) ['statut', 'absenceDebut', 'absenceFin'].forEach(k => { if (sa[k] !== undefined) fa[k] = sa[k]; }); /* l'état d'absence appartient à l'appli (saisi par Cécile) : jamais réimposé par les données de référence */ if (fa && sa.souhaits) fa.souhaits = sa.souhaits; if (fa && sa.dispositif !== undefined) fa.dispositif = sa.dispositif; if (fa && sa.hs) fa.hs = (fa.hs && (fa.hs.rev || 0) > (sa.hs.rev || 0)) ? { ...sa.hs, autorise: fa.hs.autorise, depuis: fa.hs.depuis, rev: fa.hs.rev } : sa.hs; /* réglage du dépassement renouvelé dans les données (rev plus récente) : on le reprend, mais on garde les mouvements saisis */ });
        (saved.eleves || []).forEach(se => { const fe = fresh.eleves.find(x => x.id === se.id); if (!fe) return;
          ['manuel', 'auto', 'profil', 'statutManuel'].forEach(k => { if (se[k] !== undefined) fe[k] = se[k]; });
          Object.keys(se.manuel || {}).forEach(c => { fe[c] = se[c]; }); if (se.statutManuel) fe.statut = se.statut; });
        S = migrate(fresh);
        window.__dataJustRefreshed = true;
        return;
      }
      S = migrate(saved);
      return;
    }
  } catch (e) { console.warn(e); }
  S = migrate(JSON.parse(JSON.stringify(seed)));
}
const QUESTIONS_INITIALES = [];
// répartitions « à confirmer » confirmées par un clic : retenues (élève + AESH + heures) même quand les données de référence sont rechargées ; si les heures changent, la confirmation est à refaire
function cleAff(x) { return x.eleveId + '|' + x.aeshId + '|' + (x.heures ?? 0); }
function migrate(s) {
  s.affConfirmees = s.affConfirmees || []; s.affectations.forEach(x => { if (x.aConfirmer && s.affConfirmees.includes(cleAff(x))) x.aConfirmer = false; });
  s.schemaVersion = s.schemaVersion || 1;
  for (const k of ['aesh', 'eleves', 'classes', 'affectations', 'creneaux', 'journal', 'archives']) s[k] = s[k] || [];
  s.aesh.forEach(a => { a.statut = a.statut || 'Actif'; a.heuresAutres = a.heuresAutres ?? null; a.email = a.email || ''; a.hs = a.hs || { autorise: 0, depuis: '', mouvements: [] }; if (a.dispositif === undefined) a.dispositif = /SEGPA/i.test(a.remarques || '') ? 'SEGPA' : /ULIS/i.test(a.remarques || '') ? 'ULIS' : ''; });
  s.absences = s.absences || [];
  s.prisesOcc = s.prisesOcc || []; s.serveur = s.serveur || { url: '', cle: '' }; s.evals = s.evals || { maj: '', demandes: [] }; s.evalsVues = s.evalsVues || [];
  s.questions = s.questions || [];
  // questions ajoutées par Claude : chaque question n'est ajoutée qu'une fois (suivi dans questionsAjoutees), ce que Cécile supprime ou coche n'est pas recréé
  s.questionsAjoutees = s.questionsAjoutees || ['q1'];
  QUESTIONS_INITIALES.forEach(q => { if (!s.questionsAjoutees.includes(q.id) && !s.questions.some(x => x.id === q.id)) { s.questions.push({ ...q }); } if (!s.questionsAjoutees.includes(q.id)) s.questionsAjoutees.push(q.id); });
  s.essVus = s.essVus || {}; s.prisesVues = s.prisesVues || null; s.essRappels = s.essRappels || {}; s.essNotif = s.essNotif || {};
  s.segmentsRempl = s.segmentsRempl || [];
  // historique des absences : une seule fiche par absence (aucun doublon quand les données de référence sont rechargées)
  s.aesh.forEach(a => { a.statut = motifNormalise(a.statut); }); s.absences.forEach(x => { x.motif = motifNormalise(x.motif); });
  s.aesh.forEach(a => { if (absente(a) && !s.absences.some(x => x.aeshId === a.id && (x.ouvert || (x.debut === (a.absenceDebut || '') && (x.fin || '') === (a.absenceFin || ''))))) s.absences.push({ id: 'abs' + a.id, aeshId: a.id, debut: a.absenceDebut || '', fin: a.absenceFin || '', motif: a.statut, ouvert: true }); });
  { const vus = new Set(); s.absences = s.absences.filter(x => { const k = [x.aeshId, x.debut || '', x.fin || '', x.ouvert ? 'o' : 'f'].join('|'); if (vus.has(k)) return false; vus.add(k); return true; }); }
  s.calendrier = s.calendrier || { annee: s.annee || '', refLundi: '', refQ: 'Q1', vacances: [], feries: [] };
  s.regles = Object.assign({ jours: true, horaires: true, niveaux: true }, s.regles || {}); delete s.regles.trou; delete s.regles.midi; // le comptage des trous a été supprimé
  return s;
}
function save() { S._savedAt = new Date().toISOString(); const txt = JSON.stringify(S);
  try { localStorage.setItem(KEY, txt); }
  catch (err) { // mémoire du navigateur pleine : on allège le journal puis on réessaie ; sinon on le dit clairement
    if (S.journal && S.journal.length > 200) { S.journal.length = 200; try { localStorage.setItem(KEY, JSON.stringify(S)); toast('Journal raccourci pour libérer de la place'); } catch (e2) { return erreurEnregistrement(e2); } }
    else return erreurEnregistrement(err); }
  const f = document.getElementById('savestate'); if (f) f.textContent = 'Enregistré ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function log(type, texte) { S.journal.unshift({ date: new Date().toISOString(), type, texte }); if (S.journal.length > 2000) S.journal.length = 2000; }
function erreurEnregistrement(err) { console.error(err); const f = document.getElementById('savestate'); if (f) f.textContent = '⚠ Non enregistré';
  alert("Attention : la modification est affichée mais n'a pas pu être enregistrée sur cet appareil (" + (err && (err.name || err.message) || err) + ").\nFais « Données & exports › Exporter JSON » pour ne rien perdre, puis préviens Claude."); }
function commit(type, texte) { if (texte) log(type, texte); save(); render(); }
window.printEdt = id => {
  const a = aesh(id); if (!a) return;
  const affs = affOfAesh(a).map(x => ({ ...x, e: eleve(x.eleveId) })).sort((p, q) => q.heures - p.heures);
  const bl = S.creneaux.filter(x => x.aeshId === id).map(cr => { const blk = crBlock(cr, 'aesh'); if (!blk) return null; blk.sub = cr.matiere || ''; return blk; }).filter(Boolean);
  const conflits = chevauchements().filter(x => x.type === 'aesh' && x.id === id);
  const conflictIds = new Set(conflits.flatMap(x => [x.a.id, x.b.id]));
  const rows = affs.map(x => { const autres = affOf(x.e).filter(z => z.aeshId !== id && z.heures > 0).map(z => `${aesh(z.aeshId).nom} (${hf(z.heures)})`);
    return `<tr><td><b>${esc(x.e.nom)}</b> ${esc(x.e.prenom)}</td><td>${esc(x.e.classe)}</td><td>${x.e.type}</td><td class="num">${hf(x.heures)}</td><td>${autres.join(', ') || '—'}</td></tr>`; }).join('');
  const head = `<div class="print-title" style="display:block">Emploi du temps — ${esc(a.nom)}</div>
    <table class="print-summary"><thead><tr><th>Élève</th><th>Classe</th><th>Type</th><th class="num">Heures</th><th>Autres AESH</th></tr></thead><tbody>${rows}</tbody></table>`;
  const holder = document.getElementById('edt-print-render');
  const PAGE_BUDGET = 700; // hauteur utile d'une page A4 paysage (marges 10mm déduites), en px CSS
  // 1) rendu de mesure : on pose une hauteur de grille arbitraire pour connaître la place réellement prise par le titre + le tableau + l'en-tête de grille
  holder.style.cssText = 'display:block;position:fixed;left:-9999px;top:0;width:277mm';
  holder.innerHTML = head + weekGrid(bl, true, 'editCreneau', conflictIds, 400);
  const wk = holder.querySelector('.wk'), col = holder.querySelector('.col');
  const nonColH = holder.scrollHeight - col.getBoundingClientRect().height;
  const H = Math.max(380, Math.round(PAGE_BUDGET - nonColH));
  // 2) rendu final avec la hauteur de grille recalculée pour tenir sur une seule page
  holder.innerHTML = head + weekGrid(bl, true, 'editCreneau', conflictIds, H);
  holder.removeAttribute('style');
  document.body.classList.add('print-edt-only');
  window.print();
};
window.addEventListener('afterprint', () => { document.body.classList.remove('print-edt-only'); document.getElementById('edt-print-render').innerHTML = ''; });
const uid = p => p + Math.random().toString(36).slice(2, 8);

/* ====================== HELPERS ====================== */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hf = n => (n == null || n === '') ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' h';
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const num = v => { // accepte 2.25, 2,25, 2h15, 2:15 ; texte illisible → NaN
  if (v === '' || v == null) return null; if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s+/g, ''); if (!s) return null;
  const m = s.match(/^(\d+)[hH:](\d{0,2})$/); if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  return Number(s.replace(',', '.'));
};
/* Champs d'heures : saisie libre (virgule ou point), boutons − / + et flèches du clavier par pas de 0,25 h (15 min) */
const PAS_H = 0.25;
const hTxt = v => v == null || v === '' ? '' : String(v).replace('.', ',');
const champH = (attrs, v) => `<span class="h-champ"><input type="text" inputmode="decimal" autocomplete="off" class="h-input" ${attrs} value="${hTxt(v)}"><button type="button" class="h-pas h-moins" tabindex="-1" onmousedown="event.preventDefault()" onclick="pasH(this,-1)" title="Diminuer de 15 min" aria-label="Diminuer de 15 min">−</button><button type="button" class="h-pas" tabindex="-1" onmousedown="event.preventDefault()" onclick="pasH(this,1)" title="Augmenter de 15 min" aria-label="Augmenter de 15 min">+</button></span>`;
window.pasH = (el, sens, clavier) => { const i = el.parentNode.querySelector('input'); const v = num(i.value); const n = Math.max(i.dataset.neg ? -999 : 0, Math.round(((Number.isFinite(v) ? v : 0) + sens * PAS_H) / PAS_H) * PAS_H); i.value = hTxt(n);
  if (clavier) i.dataset.modif = '1'; else i.dispatchEvent(new Event('change', { bubbles: true })); };
document.addEventListener('keydown', ev => { const i = ev.target; if (!i.classList || !i.classList.contains('h-input') || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return; ev.preventDefault(); pasH(i, ev.key === 'ArrowUp' ? 1 : -1, true); });
document.addEventListener('focusout', ev => { const i = ev.target; if (i.dataset && i.dataset.modif) { delete i.dataset.modif; i.dispatchEvent(new Event('change', { bubbles: true })); } });
const H_ILLISIBLE = "Nombre d'heures non reconnu. Écris par exemple 2,25 (ou 2h15) pour 2 h 15 min.";
const byId = (arr, id) => arr.find(x => x.id === id);
const eleve = id => byId(S.eleves, id);
const aesh = id => byId(S.aesh, id);
const ini = a => a.nom.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
const couleurAesh = a => absente(a) ? '#B0B4BA' : a.couleur;
const CLASSE_COLOR_OVERRIDES = { '4e 3': '#E0A526', '2nde 1': '#D98F17', '3e 5': '#83C34B', '4e 2': '#4CA658' };
const classeColor = nom => { if (CLASSE_COLOR_OVERRIDES[nom]) return CLASSE_COLOR_OVERRIDES[nom]; let h = 0; for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; };
const semainesDe = c => (c && (c.groupe === 'Q1' || c.groupe === 'Q2')) ? [c.groupe] : ['Q1', 'Q2'];
const semainesSeRecoupent = (a, b) => semainesDe(a).some(w => semainesDe(b).includes(w));
// 1 créneau = 1 h ; un créneau d'une semaine sur deux (Q1 ou Q2 seul) compte 0,5 h (moyenne (Q1+Q2)/2). Les horaires réels (55 min) ne s'affichent que dans la grille EDT.
const dureeUnique = bl => { const slots = {}; bl.forEach(b => { const k = b.jour + '|' + b.debut + '|' + b.fin; const st = (slots[k] ||= new Set()); semainesDe(b).forEach(w => st.add(w)); st.poids = Math.max(0.5, Math.round((t2m(b.fin) - t2m(b.debut)) / 30) * 0.5); }); return Object.values(slots).reduce((t, st) => t + st.size / 2 * st.poids, 0); }; // 1 créneau (55 min) = 1 h ; un créneau plus court ou plus long compte sa durée à la demi-heure près (07h40-08h10 = 0,5 h ; 11h10-12h40 = 1,5 h)
const dateFr = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const sortEleves = list => list.slice().sort((a, b) => SITES.indexOf(a.site) - SITES.indexOf(b.site) || NIVEAUX.indexOf(a.niveau) - NIVEAUX.indexOf(b.niveau) || a.classe.localeCompare(b.classe) || a.nom.localeCompare(b.nom));
const aeshSites = a => new Set([a.site, ...affOfAesh(a).map(x => eleve(x.eleveId).site)]);
const aeshGroup = a => absente(a) ? 3 : /ULIS/i.test(a.remarques || '') ? 1 : /SEGPA/i.test(a.remarques || '') ? 2 : 0;
const nomFamille = a => a.nom.split(' ').slice(1).join(' ') || a.nom;
const sortAesh = list => list.slice().sort((a, b) => aeshGroup(a) - aeshGroup(b) || nomFamille(a).localeCompare(nomFamille(b), 'fr'));
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); };
const dl = (name, content, type = 'application/json') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); };
const isPending = e => /^Dossier|^Renouvellement|^Vigilance/.test(e.statut);
const isActive = e => !e.archive && e.statut !== 'Sorti / fin de notification';
const t2m = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + m; };
const m2t = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/* ====================== CALENDRIER SCOLAIRE (semaines Q1 / Q2, vacances) ====================== */
const isoLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const lundiDe = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const semaineEnVacances = lundi => { const mer = new Date(lundi); mer.setDate(mer.getDate() + 2); const m = isoLocal(mer); return (S.calendrier.vacances || []).some(v => v.debut && v.fin && m >= v.debut && m <= v.fin); };
// Q1/Q2 alternent sur les seules semaines de cours (les semaines de vacances sont sautées).
function quinzaineDe(iso) {
  const cal = S.calendrier; if (!cal || !cal.refLundi) return null;
  const cible = lundiDe(iso); if (semaineEnVacances(cible)) return null;
  const ref = lundiDe(cal.refLundi), pas = cible >= ref ? 7 : -7; const cur = new Date(ref); let n = 0;
  for (let i = 0; i < 700 && isoLocal(cur) !== isoLocal(cible); i++) { cur.setDate(cur.getDate() + pas); if (!semaineEnVacances(cur)) n++; }
  return (n % 2 === 0) === (cal.refQ === 'Q1') ? 'Q1' : 'Q2';
}
const prochainesVacances = iso => (S.calendrier.vacances || []).filter(v => v.debut && v.fin >= iso).sort((a, b) => a.debut.localeCompare(b.debut))[0] || null;
function majSemSel() {
  const el = document.getElementById('semsel'); if (!el) return;
  const auj = aujourdhui(), q = quinzaineDe(auj), pv = prochainesVacances(auj); const fr = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const enV = (S.calendrier.vacances || []).find(v => v.debut <= auj && auj <= v.fin);
  el.innerHTML = `<div class="small" style="opacity:.8;margin-bottom:4px">Cette semaine</div><div style="font-weight:700;margin-bottom:2px">${q ? 'Semaine ' + q : (enV ? 'Vacances : ' + esc(enV.nom) : (S.calendrier.refLundi ? 'Hors calendrier' : 'Calendrier à renseigner'))}</div>${pv && !enV ? `<div class="small" style="opacity:.75;margin-bottom:8px">${esc(pv.nom)} dès le ${fr(pv.debut)}</div>` : '<div style="margin-bottom:8px"></div>'}
    <div class="small" style="opacity:.8;margin-bottom:4px">Semaines affichées</div><div class="seg seg-side">${[['', 'Les deux'], ['Q1', 'Q1'], ['Q2', 'Q2']].map(([v, l]) => `<button class="${view.semaine === v ? 'on' : ''}" onclick="setView('semaine','${v}')">${l}</button>`).join('')}</div>`;
}

/* ====================== CALCULS ====================== */
const affOf = e => S.affectations.filter(a => a.eleveId === e.id);
const affOfAesh = a => S.affectations.filter(x => x.aeshId === a.id && eleve(x.eleveId) && isActive(eleve(x.eleveId)));
const couvertes = e => affOf(e).reduce((s, a) => s + (a.heures || 0), 0); // heures réellement attribuées (les élèves SEGPA / ULIS ne sont plus supposés couverts d'office)
function couverture(e) {
  const c = couvertes(e);
  if (!(c > 0)) return { k: 'bad', l: 'Non couvert' }; // aucune AESH en face de l'élève : jamais « couvert », même si ses heures notifiées sont à 0 ou non renseignées
  if (e.heures == null) return c > 0 ? { k: 'ok', l: 'Suivi (sans cible)' } : { k: 'warn', l: 'À définir' };
  if (c > e.heures) return { k: 'bad', l: 'Sur-couvert' };
  if (c === e.heures) return { k: 'ok', l: 'Couvert' };
  if (c === 0) return { k: 'bad', l: 'Non couvert' };
  return { k: 'warn', l: 'Partiel' };
}
function charge(a) {
  const list = affOfAesh(a).filter(x => !dispositifDe(eleve(x.eleveId))); // les heures ULIS / SEGPA sont déjà dans heuresAutres
  const ind = list.filter(x => eleve(x.eleveId).type === 'Individuel').reduce((s, x) => s + (x.heures || 0), 0);
  const mut = list.filter(x => eleve(x.eleveId).type === 'Mutualisé').reduce((s, x) => s + (x.heures || 0), 0);
  const autres = a.heuresAutres || 0;
  const tot = ind + mut + autres, q = a.quotite;
  let k = 'neutral', l = 'Quotité manquante';
  const aut = (a.hs && a.hs.autorise) || 0; // dépassement de quotité autorisé (heures par semaine)
  if (q != null) { if (tot > q + aut) { k = 'bad'; l = 'Dépassement'; } else if (tot > q) { k = 'warn'; l = 'Heures sup. autorisées'; } else if (q - tot > 0) { k = 'warn'; l = 'Quotité non atteinte'; } else { k = 'ok'; l = '✓'; } }
  return { hsAut: q != null && tot > q && tot <= q + aut, ind, mut, autres, tot, reste: q == null ? null : q - tot, taux: q ? tot / q : null, n: list.filter(x => x.heures > 0).length, k, l };
}
const elevesDe = c => S.eleves.filter(e => isActive(e) && e.classe === c.nom);
function stats(list) {
  const act = list.filter(isActive);
  const cible = act.reduce((s, e) => s + (e.heures || 0), 0);
  const couv = act.reduce((s, e) => s + couvertes(e), 0);
  return { n: act.length, ind: act.filter(e => e.type === 'Individuel').length, mut: act.filter(e => e.type === 'Mutualisé').length, pending: act.filter(isPending).length,
    cible, couv, reste: cible - couv, prev: act.reduce((s, e) => s + (e.heuresPrev || 0), 0),
    nonCouv: act.filter(e => couverture(e).l === 'Non couvert').length, partiel: act.filter(e => couverture(e).l === 'Partiel').length, adef: act.filter(e => couverture(e).l === 'À définir').length };
}
function ressource(site) {
  const list = S.aesh.filter(a => (!site || a.site === site) && !absente(a));
  const vol = list.reduce((s, a) => s + (a.quotite || 0), 0);
  const aff = list.reduce((s, a) => s + charge(a).tot, 0);
  return { n: list.length, vol, aff, reste: vol - aff, manq: list.filter(a => a.quotite == null).length, dep: list.filter(a => charge(a).l === 'Dépassement').length };
}
/* ====================== MOTEUR PLANNING : conflits, doublons ====================== */
const SLOTS = ['08:10', '09:05', '10:15', '11:10', '12:05', '13:00', '13:55', '14:50', '16:00', '16:55']; // créneaux Pronote ; 12:05 et 13:00 = repas
const LUNCH = [4, 5];
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const hh = h => h.replace(':', 'h');
const slotsDe = cr => { const out = []; SLOTS.forEach((p, i) => { const d = t2m(p); if (d >= t2m(cr.debut) && d < t2m(cr.fin)) out.push(i); }); return out; };
function busySlots(aid, jour, sem, extra) {
  const s = new Set();
  S.creneaux.forEach(c => { if (c.aeshId === aid && c.jour === jour && semainesDe(c).includes(sem)) slotsDe(c).forEach(i => s.add(i)); });
  const a = aesh(aid); const so = a ? souhaitsDe(a) : SOUHAITS_VIDES;
  PERIODES.forEach((p, i) => { if (so.dispo[jour + '-' + i] === 'occupee') s.add(SLOTS.indexOf(p)); });
  (extra || []).forEach(i => s.add(i));
  return [...s].sort((x, y) => x - y);
}
// deux AESH (ou plus) auprès du même élève à la même heure, la même semaine : une seule heure est comptée
function doublonsEleve(eid) {
  const m = {};
  S.creneaux.filter(c => c.eleveId === eid).forEach(c => slotsDe(c).forEach(i => semainesDe(c).forEach(w => { (m[c.jour + '|' + i + '|' + w] ||= new Set()).add(c.aeshId); })));
  const out = {};
  Object.entries(m).forEach(([k, set]) => { if (set.size > 1) { const [j, i, w] = k.split('|'); const o = (out[j + '|' + i] ||= { jour: +j, slot: +i, aesh: new Set(), sem: new Set() }); set.forEach(x => o.aesh.add(x)); o.sem.add(w); } });
  return Object.values(out).sort((a, b) => a.jour - b.jour || a.slot - b.slot);
}
const suffixeSem = set => set.size === 1 ? ` (semaine ${[...set][0]})` : '';
function alertes() {
  const out = []; const add = (k, cat, t, h) => out.push({ k, cat, t, h });
  S.aesh.forEach(a => { const c = charge(a); if (c.l === 'Dépassement') add('bad', 'AESH', `${a.nom} dépasse sa quotité (${hf(c.tot)} / ${hf(a.quotite)})`, '#/aesh/' + a.id); });
  S.eleves.filter(isActive).forEach(e => {
    const c = couverture(e);
    if (c.l === 'Non couvert' && (e.heures || 0) > 0) add('bad', 'Élèves', `${e.nom} ${e.prenom} (${e.classe}) : aucun AESH affecté`, '#/eleves/' + e.id);
    if (c.l === 'Sur-couvert') add('bad', 'Élèves', `${e.nom} ${e.prenom} : heures affectées > notification`, '#/eleves/' + e.id);
    if (e.gevasco) { const d = (new Date(e.gevasco) - Date.now()) / 864e5; if (d < 90) add(d < 0 ? 'bad' : 'warn', 'Dossiers', `${e.nom} ${e.prenom} : GEVASCO ${d < 0 ? 'expiré' : 'à renouveler'} (${new Date(e.gevasco).toLocaleDateString('fr-FR')})`, '#/eleves/' + e.id); }
    if (e.notifFin && !/déposé/.test(e.statut || '')) { const d = (new Date(e.notifFin) - Date.now()) / 864e5; if (d < 270) add('bad', 'Dossiers', `${e.nom} ${e.prenom} : notification MDPH à renouveler (fin ${new Date(e.notifFin).toLocaleDateString('fr-FR')})`, '#/eleves/' + e.id); }
    const dbl = doublonsEleve(e.id);
    if (dbl.length) add('warn', 'Élèves', `${e.nom} ${e.prenom} : 2 AESH sur la même heure (${dbl.slice(0, 3).map(x => JOURS[x.jour - 1].toLowerCase() + ' ' + hh(SLOTS[x.slot]) + ' : ' + [...x.aesh].map(id => (aesh(id)?.nom || '?').split(' ')[0]).join(' + ') + suffixeSem(x.sem)).join(' ; ')}${dbl.length > 3 ? ' …' : ''}) — une seule heure comptée`, '#/eleves/' + e.id);
  });
  S.affectations.filter(a => a.aConfirmer).forEach(a => { const e = eleve(a.eleveId), x = aesh(a.aeshId); if (e && x && isActive(e)) add('warn', 'Affectation', `Répartition à confirmer : ${e.nom} ${e.prenom} ↔ ${x.nom} (${hf(a.heures)})`, '#/affectation'); });
  S.affectations.forEach(a => { const e = eleve(a.eleveId), x = aesh(a.aeshId); const dp = e && x && isActive(e) ? horsDispositif(x, e) : null; if (dp) add('bad', 'Affectation', `${e.nom} ${e.prenom} est en ${dp} : seules les AESH ${dp} interviennent (${x.nom} n'en fait pas partie)`, '#/eleves/' + e.id); });
  const manq = S.aesh.filter(a => a.quotite == null).length; if (manq) out.unshift({ k: 'warn', cat: 'AESH', t: `${manq} AESH sans quotité renseignée — le volume d'heures restant disponible n'est pas calculable`, h: '#/aesh' });
  chevauchements().forEach(x => { if (x.type !== 'aesh') return; const a = aesh(x.id); if (a) add('bad', 'AESH', `${a.nom} est à deux endroits le ${JOURS_LONGS[x.a.jour - 1]} (${x.a.debut}-${x.a.fin} / ${x.b.debut}-${x.b.fin})`, '#/aesh/' + a.id); });
  // signalements liés aux souhaits et aux règles de l'équipe (ils ne bloquent jamais)
  const R = S.regles;
  S.aesh.filter(a => !absente(a)).forEach(a => {
    const so = souhaitsDe(a), mine = S.creneaux.filter(c => c.aeshId === a.id); const lien = '#/aesh/' + a.id;
    if (R.jours) so.joursOff.forEach(j => { if (mine.some(c => c.jour === j)) add('warn', 'AESH', `${a.nom} travaille le ${JOURS_LONGS[j - 1]}, jour non souhaité`, lien); });
    const dv = {}; mine.forEach(c => slotsDe(c).forEach(i => { const pi = PERIODES.indexOf(SLOTS[i]); const et = pi >= 0 ? so.dispo[c.jour + '-' + pi] : null; if (et) (dv[c.jour + '|' + i] = { j: c.jour, i, et }); }));
    Object.values(dv).forEach(v => add(v.et === 'evite' ? 'warn' : 'bad', 'AESH', `${a.nom} : ${JOURS_LONGS[v.j - 1]} ${hh(SLOTS[v.i])}, créneau ${v.et === 'evite' ? 'à éviter' : v.et === 'indispo' ? 'marqué indisponible' : 'marqué occupé (ULIS/SEGPA…)'}`, lien));
    if (R.horaires && (so.debut || so.fin)) { const h = {}; mine.forEach(c => slotsDe(c).forEach(i => { const d = t2m(SLOTS[i]); if ((so.debut && d < t2m(so.debut)) || (so.fin && d + 55 > t2m(so.fin))) h[c.jour + '|' + i] = { j: c.jour, i }; })); Object.values(h).forEach(v => add('warn', 'AESH', `${a.nom} : ${JOURS_LONGS[v.j - 1]} ${hh(SLOTS[v.i])}, hors des horaires souhaités`, lien)); }
    if (R.niveaux && so.niveaux.length) { const hors = [...new Set(mine.map(c => eleve(c.eleveId)).filter(e => e && !so.niveaux.includes(e.site)).map(e => e.site))]; if (hors.length) add('warn', 'AESH', `${a.nom} suit des élèves hors de ses sites souhaités (${hors.join(', ')})`, lien); }
  });
  return out;
}
function chevauchements() {
  const out = [];
  for (let i = 0; i < S.creneaux.length; i++) for (let j = i + 1; j < S.creneaux.length; j++) {
    const c1 = S.creneaux[i], c2 = S.creneaux[j];
    if (c1.jour !== c2.jour || t2m(c1.debut) >= t2m(c2.fin) || t2m(c2.debut) >= t2m(c1.fin)) continue;
    if (!semainesSeRecoupent(c1, c2)) continue;
    if (c1.aeshId === c2.aeshId) { const e1 = eleve(c1.eleveId), e2 = eleve(c2.eleveId); if (e1 && e2 && e1.classe === e2.classe && e1.type === 'Mutualisé' && e2.type === 'Mutualisé') continue; out.push({ type: 'aesh', id: c1.aeshId, a: c1, b: c2 }); }
    else if (c1.eleveId === c2.eleveId) out.push({ type: 'eleve', id: c1.eleveId, a: c1, b: c2 });
  }
  return out;
}

/* ====================== CHARTS (SVG) ====================== */
function donut(parts, size = 150, centre) {
  const tot = parts.reduce((s, p) => s + p.v, 0) || 1; let acc = 0; const r = 60, cx = 75, cy = 75;
  let d = '';
  parts.forEach(p => {
    const a0 = acc / tot * Math.PI * 2 - Math.PI / 2; acc += p.v; const a1 = acc / tot * Math.PI * 2 - Math.PI / 2;
    if (!p.v) return; const big = (a1 - a0) > Math.PI ? 1 : 0;
    if (p.v === tot) { d += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.c}" stroke-width="22"/>`; return; }
    d += `<path d="M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${big} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}" fill="none" stroke="${p.c}" stroke-width="22"><title>${esc(p.l)} : ${p.v}</title></path>`;
  });
  return `<div style="display:flex;gap:14px;align-items:center"><svg viewBox="0 0 150 150" width="${size}" height="${size}">${d}<text x="75" y="80" text-anchor="middle" font-size="20" font-weight="700" fill="#1B2430">${centre != null ? centre : Math.round(tot * 100) / 100}</text></svg>
  <div class="small">${parts.map(p => p.href ? `<a href="${p.href}" style="display:block;color:inherit;text-decoration:none;cursor:pointer" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><span class="dot" style="background:${p.c}"></span>${esc(p.l)} <b>${p.v}</b></a>` : `<div><span class="dot" style="background:${p.c}"></span>${esc(p.l)} <b>${p.v}</b></div>`).join('')}</div></div>`;
}
function hbars(rows, opts = {}) { // rows: {l, segs:[{v,c,t}], max, right}
  const max = Math.max(1, ...rows.map(r => Math.max(r.max || 0, r.segs.reduce((s, x) => s + x.v, 0))));
  return `<div class="chart">${rows.map(r => {
    let x = 0; const segs = r.segs.map(s => { const w = 100 * s.v / max; const h = `<div title="${esc(s.t || '')}" style="position:absolute;left:${x}%;width:${w}%;top:0;bottom:0;background:${s.c};border-radius:3px"></div>`; x += w; return h; }).join('');
    const mark = r.max ? `<div style="position:absolute;left:${100 * r.max / max}%;top:-3px;bottom:-3px;width:2px;background:#1B2430;opacity:.6" title="Quotité ${r.max} h"></div>` : '';
    return `<div style="display:grid;grid-template-columns:${opts.lw || 120}px 1fr 70px;gap:10px;align-items:center;margin:5px 0;font-size:12px">
      <a href="${r.h || '#'}" style="text-decoration:none;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.l)}</a>
      <div style="position:relative;height:14px;background:#EDF0F4;border-radius:3px">${segs}${mark}</div>
      <div class="num muted" style="text-align:right;font-variant-numeric:tabular-nums">${esc(r.right || '')}</div></div>`; }).join('')}</div>`;
}

/* ====================== PROPOSITIONS D'AESH ====================== */
const ORD_ST = { ok: 0, warn: 1, bad: 2 };
function evalAesh(aid, eid, jour, debut, fin, groupe, ignoreId) {
  const a = aesh(aid), e = eleve(eid); const R = []; let st = 'ok', sc = 50;
  const mal = (k, t, p) => { R.push([k, t]); sc -= p; if (ORD_ST[k] > ORD_ST[st]) st = k; };
  if (!a || !e) return { aid, st: 'bad', sc: 0, R: [['bad', 'données manquantes']] };
  if (absente(a)) mal('bad', 'absente : ' + String(a.statut).toLowerCase(), 60);
  const dp = horsDispositif(a, e); if (dp) mal('bad', `élève ${dp} : réservé aux AESH ${dp}`, 60);
  const so = souhaitsDe(a); const cren = { jour, debut, fin, groupe: groupe || null }; const sl = slotsDe(cren);
  const sems = semainesDe(cren);
  // déjà ailleurs à ce moment (même semaine) ?
  const autres = S.creneaux.filter(c => c.id !== ignoreId && c.aeshId === aid && c.jour === jour && t2m(c.debut) < t2m(fin) && t2m(c.fin) > t2m(debut) && semainesSeRecoupent(c, cren));
  const memeSalle = autres.filter(c => { const o = eleve(c.eleveId); return o && o.classe === e.classe && o.type === 'Mutualisé' && e.type === 'Mutualisé'; });
  autres.filter(c => !memeSalle.includes(c)).slice(0, 1).forEach(c => { const o = eleve(c.eleveId); mal('bad', `déjà avec ${o ? o.nom : '?'} (${o ? o.classe : ''}) à ce moment`, 60); });
  if (memeSalle.length) { R.push(['ok', 'déjà dans la salle avec la même classe']); sc += 14; }
  sl.forEach(i => { const pi = PERIODES.indexOf(SLOTS[i]); const et = pi >= 0 ? so.dispo[jour + '-' + pi] : null; if (et === 'indispo') mal('bad', 'indisponible à cette heure', 40); else if (et === 'occupee') mal('bad', 'occupée à cette heure (ULIS/SEGPA…)', 40); else if (et === 'evite') mal('warn', 'préfère éviter ce créneau', 12); });
  if (S.regles.jours && so.joursOff.includes(jour)) mal('warn', `ne souhaite pas le ${JOURS_LONGS[jour - 1]}`, 20);
  if (S.regles.horaires && sl.length && ((so.debut && t2m(SLOTS[sl[0]]) < t2m(so.debut)) || (so.fin && t2m(SLOTS[sl[sl.length - 1]]) + 55 > t2m(so.fin)))) mal('warn', 'hors de ses horaires souhaités', 10);
  if (S.regles.niveaux && so.niveaux.length && !so.niveaux.includes(e.site)) mal('warn', `préfère ${so.niveaux.join(' / ')}`, 12);
  // le créneau s'ajoute-t-il à la suite de ses heures ? la journée devient-elle trop longue ?
  if (!autres.length && sl.length) sems.forEach(w => {
    const avant = busySlots(aid, jour, w), apres = busySlots(aid, jour, w, sl);
    if (avant.some(i => sl.some(x => Math.abs(x - i) === 1))) { R.push(['ok', 'à la suite de ses heures']); sc += 6; }
    if (apres.length >= 7) mal('warn', `journée de ${apres.length} h`, 5);
  });
  const c = charge(a), dur = sl.length * sems.length / 2;
  const aff = S.affectations.find(x => x.eleveId === eid && x.aeshId === aid && x.heures > 0);
  if (!autres.length) {
    if (aff) { const prevu = dureeUnique(S.creneaux.filter(x => x.id !== ignoreId && x.eleveId === eid && x.aeshId === aid).map(x => ({ jour: x.jour, debut: x.debut, fin: x.fin, groupe: x.groupe }))); if (prevu + dur > aff.heures + 0.01) mal('warn', `dépasserait les ${hf(aff.heures)} affectées à ${e.prenom} (${hf(prevu)} déjà planifiées)`, 12); }
    else if (c.reste != null && c.reste < dur) mal('warn', `pas affectée à ${e.prenom} et à sa quotité (${hf(c.tot)} / ${hf(a.quotite)})`, 15);
  }
  if (aff) { R.push(['ok', `déjà affectée à ${e.prenom} (${hf(aff.heures)})`]); sc += 16; }
  if (so.eleves.includes(eid)) { R.push(['ok', `souhaite suivre ${e.prenom}`]); sc += 8; }
  const nbAesh = new Set(S.creneaux.filter(x => x.eleveId === eid).map(x => x.aeshId)); if (!nbAesh.has(aid) && nbAesh.size >= 4) mal('warn', `serait la ${nbAesh.size + 1}ᵉ AESH de ${e.prenom}`, 10);
  return { aid, st, sc: Math.max(0, Math.min(100, sc)), R };
}
function proposerAesh(eid, jour, debut, fin, groupe, ignoreId) {
  return S.aesh.map(a => evalAesh(a.id, eid, jour, debut, fin, groupe, ignoreId)).sort((x, y) => ORD_ST[x.st] - ORD_ST[y.st] || y.sc - x.sc);
}
window.majPropositions = () => {
  const f = document.getElementById('mform'); const box = document.getElementById('propositions'); if (!f || !box) return;
  const g = n => f.elements[n] ? f.elements[n].value : '';
  if (!g('eleveId') || !g('debut') || !g('fin') || t2m(g('fin')) <= t2m(g('debut'))) { box.innerHTML = '<div class="muted small">Choisis un élève, un jour et des horaires.</div>'; return; }
  const idCur = f.dataset.cid || null; const L = proposerAesh(g('eleveId'), +g('jour'), g('debut'), g('fin'), g('groupe'), idCur);
  const cls = { ok: 'ok', warn: 'warn', bad: 'bad' }, lib = { ok: 'convient', warn: 'avec réserve', bad: 'indisponible' };
  box.innerHTML = L.slice(0, 8).map(r => { const a = aesh(r.aid); return `<div class="prop ${r.aid === g('aeshId') ? 'sel' : ''}" onclick="choisirAesh('${r.aid}')"><span class="pill ${cls[r.st]}">${lib[r.st]}</span> <b>${esc(a.nom)}</b><span class="small muted"> — ${r.R.map(x => esc(x[1])).join(' · ') || 'aucune particularité'}</span></div>`; }).join('');
};
window.choisirAesh = aid => { const f = document.getElementById('mform'); if (f && f.elements.aeshId) { f.elements.aeshId.value = aid; majPropositions(); } };

/* ====================== ALERTES ====================== */
function pageAlertes() {
  setTitle('Alertes');
  const all = alertes(); const cats = ['Élèves', 'AESH', 'Dossiers', 'Affectation'];
  const list = all.filter(a => !view.alerteCat || a.cat === view.alerteCat);
  // chaque bloc est séparé en deux parties par un filet de la couleur de l'alerte (rouge = à régler, orange = à décider) : ce qui concerne les AESH / ce qui concerne les élèves (dossiers et affectations comprises)
  const ligne = a => `<li style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="pill neutral" style="margin-right:8px">${esc(a.cat)}</span><a href="${a.h}" style="text-decoration:none;color:inherit">${esc(a.t)}</a></li>`;
  const groupe = (titre, l, premier, couleur) => `<div style="${premier ? '' : `border-top:1.5px solid var(${couleur});margin-top:14px;padding-top:10px`}"><div style="font-weight:650;margin-bottom:4px">${titre} <span class="small muted">(${l.length})</span></div><ul class="alerts" style="list-style:none;padding:0;margin:0">${l.map(ligne).join('') || '<li class="muted small">Rien à signaler.</li>'}</ul></div>`;
  const bloc = (k, titre, couleur, aide) => { const l = list.filter(a => a.k === k), pa = l.filter(a => a.cat === 'AESH'), pe = l.filter(a => a.cat !== 'AESH'); return `<div class="card" style="margin-bottom:14px;border-left:4px solid var(${couleur})"><h2>${titre} <span class="pill ${k}">${l.length}</span></h2><p class="small muted" style="margin:0 0 8px">${aide}</p>${groupe('Concernant les AESH', pa, true, couleur)}${groupe('Concernant les élèves', pe, false, couleur)}</div>`; };
  $('#page').innerHTML = `<div class="print-title">Alertes</div>
  <div class="toolbar"><div class="seg"><button class="${!view.alerteCat ? 'on' : ''}" onclick="setView('alerteCat','')">Toutes (${all.length})</button>${cats.map(c => `<button class="${view.alerteCat === c ? 'on' : ''}" onclick="setView('alerteCat','${c}')">${c} (${all.filter(a => a.cat === c).length})</button>`).join('')}</div></div>
  <p class="small muted" style="margin:-4px 0 12px"><b>Comment lire :</b> rouge = à régler (anomalie : conflit, élève sans AESH, quotité dépassée…) ; orange = à décider (souhait non respecté, doublon : l'équipe tranche, rien n'est bloqué). Les règles se règlent dans « Données &amp; exports ». Un clic ouvre la fiche concernée.</p>
  ${bloc('bad', 'À régler', '--bad', 'Anomalies à corriger.')}${bloc('warn', 'À décider', '--warn', 'Signalements : à toi de décider.')}`;
}
function majCompteurQuestions() { const el = document.getElementById('nav-questions'); if (!el) return; const n = (S.questions || []).filter(q => !q.fait).length; el.textContent = n || ''; el.style.display = n ? '' : 'none'; }
function majCompteurEss() { majCompteurQuestions(); majCompteurEvals(); majCompteurAbsences(); const el = document.getElementById('nav-ess'); if (!el) return; const n = essDus().n + essProches().length, jj = essProches().some(e => e.essDate === aujourdhui()); el.className = 'pill ' + (jj ? 'bad' : 'warn'); el.textContent = n || ''; el.style.display = n ? '' : 'none'; }
function majCompteurAlertes() { majCompteurEss(); const el = document.getElementById('nav-alertes'); if (!el) return; const n = alertes().length; const bb = document.getElementById('bb-alertes'); if (bb) { bb.textContent = n; bb.hidden = !n; } el.textContent = n || ''; el.style.display = n ? '' : 'none'; }

/* ====================== SYNTHÈSE PAR AESH (impression) ====================== */
function pageSyntheseAesh() {
  setTitle('Synthèse par AESH');
  const list = sortAesh(S.aesh);
  const cards = list.map(a => {
    const c = charge(a);
    const affs = affOfAesh(a).map(x => ({ ...x, e: eleve(x.eleveId) })); // tous les élèves suivis, quel que soit le statut du dossier ou le nombre d'heures
    affs.sort((p, q) => (p.e.type === q.e.type ? 0 : p.e.type === 'Individuel' ? -1 : 1) || p.e.classe.localeCompare(q.e.classe, 'fr') || p.e.nom.localeCompare(q.e.nom, 'fr'));
    const resteLabel = c.reste == null ? '—' : c.reste < 0 ? `${c.hsAut ? 'Heures sup. autorisées' : 'Dépassement'} ${hf(-c.reste)}` : `Reste ${hf(c.reste)}`;
    const donutParts = [
      { l: 'Individuel', v: c.ind, c: 'var(--indiv)' },
      { l: 'Mutualisé', v: c.mut, c: 'var(--mutu)' },
      ...(c.autres ? [{ l: 'Collectif', v: c.autres, c: '#8A93A6' }] : []),
      ...(c.reste != null && c.reste > 0 ? [{ l: 'Disponible', v: c.reste, c: '#E3E7ED' }] : [])
    ];
    return `<div class="card aesh-synth-page" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <h2 style="margin:0">${esc(a.nom)} <span class="pill ${c.k}">${c.l}</span>${a.statut && a.statut !== 'Actif' ? ` <span class="pill warn">${esc(a.statut)}</span>` : ''}${compteurHS(a).solde ? ` <span class="pill neutral" title="Heures supplémentaires à récupérer">+${hf(compteurHS(a).solde)} à récupérer</span>` : ''}</h2>
        <span class="small muted">${a.site}</span>
      </div>
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        ${donut(donutParts, 108)}
        <div class="kpis" style="grid-template-columns:repeat(3,1fr);gap:8px;flex:1;min-width:280px">
          <div class="kpi"><div class="v">${a.quotite == null ? '—' : a.quotite + ' h'}</div><div class="l">quotité hebdo</div></div>
          <div class="kpi indiv"><div class="v">${hf(c.ind)}</div><div class="l">individuel</div></div>
          <div class="kpi mutu"><div class="v">${hf(c.mut)}</div><div class="l">mutualisé</div></div>
          <div class="kpi"><div class="v">${hf(c.tot)}</div><div class="l">heures effectuées</div></div>
          <div class="kpi ${c.reste == null ? '' : c.k}"><div class="v">${c.reste == null ? '?' : hf(Math.abs(c.reste))}</div><div class="l">${c.reste != null && c.reste < 0 ? (c.hsAut ? 'heures sup. autorisées' : 'dépassement') : 'reste disponible'}</div></div>
          <div class="kpi"><div class="v">${c.taux == null ? '—' : Math.round(c.taux * 100) + ' %'}</div><div class="l">taux d'occupation</div></div>
        </div>
      </div>
      <table class="t compact"><thead><tr><th>Élève</th><th>Classe</th><th>Type</th><th class="num">Heures couvertes</th><th>Binôme (autre AESH)</th><th style="text-align:center">Couverture</th></tr></thead><tbody>
      ${affs.map(x => {
        const partners = affOf(x.e).filter(o => o.aeshId !== a.id && o.heures > 0).map(o => `${esc(aesh(o.aeshId)?.nom)} (${hf(o.heures)})`).join(', ');
        const total = couvertes(x.e);
        const complet = x.e.heures != null && Math.round(total * 100) / 100 === Math.round(x.e.heures * 100) / 100;
        const okmark = x.e.heures == null ? '<span class="muted" title="Pas de cible d\'heures">—</span>' : complet ? `<span title="Complet : ${hf(total)} / ${hf(x.e.heures)} h" style="color:var(--ok);font-size:16px;font-weight:700">✓</span>` : `<span title="Incomplet : ${hf(total)} / ${hf(x.e.heures)} h couvertes" style="color:var(--bad);font-size:16px;font-weight:700">✗</span>`;
        const dp = dispositifDe(x.e); const dossier = x.e.statut !== 'Notifié' ? ` <span class="pill warn" title="${esc(x.e.statut)}">dossier en cours</span>` : '';
        return `<tr><td><b>${esc(x.e.nom)}</b> ${esc(x.e.prenom)}${dossier}</td><td>${esc(x.e.classe)}</td><td><span class="pill ${x.e.type === 'Individuel' ? 'indiv' : 'mutu'}">${x.e.type}</span>${dp ? ` <span class="pill neutral">${dp}</span>` : ''}</td><td class="num" ${dp ? 'title="Heures déjà comprises dans les heures collectives de l\'AESH"' : ''}>${dp ? '<span class="muted">' + hf(x.heures) + '</span>' : hf(x.heures)}</td><td class="small">${partners || '<span class="muted">—</span>'}</td><td style="text-align:center">${okmark}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">Aucun élève suivi.</td></tr>'}
      </tbody><tfoot><tr style="font-weight:600"><td colspan="3">Total (${affs.length} élève${affs.length > 1 ? 's' : ''})</td><td class="num">${hf(c.ind + c.mut)}</td><td colspan="2" class="small muted">${c.autres ? '+ ' + hf(c.autres) + ' collectives (ULIS / SEGPA) = ' + hf(c.tot) + ' effectuées' : '= heures effectuées'}</td></tr></tfoot></table>
    </div>`;
  }).join('');
  $('#page').innerHTML = `<div class="print-title">Synthèse par AESH</div>${cards}`;
}

/* ====================== ABSENCES, REMPLACEMENTS ET COMPTEURS ====================== */
const poidsCreneau = (d, f) => Math.max(0.5, Math.round((t2m(f) - t2m(d)) / 30) * 0.5);
const absenceOuverte = aid => (S.absences || []).find(x => x.aeshId === aid && x.ouvert);
function syncAbsence(a) {
  S.absences = S.absences || []; const o = absenceOuverte(a.id);
  if (absente(a)) { if (!o) S.absences.push({ id: uid('abs'), aeshId: a.id, debut: a.absenceDebut || aujourdhui(), fin: a.absenceFin || '', motif: a.statut, ouvert: true }); else { o.debut = a.absenceDebut || o.debut; o.fin = a.absenceFin || ''; o.motif = a.statut; } }
  else if (o) { o.ouvert = false; o.fin = o.fin && o.fin < aujourdhui() ? o.fin : aujourdhui(); }
}
// Heures effectuées pour un créneau hebdomadaire. VERROU DU PASSÉ : la personne qui remplace n'est créditée que des occurrences
// qui commencent APRÈS le moment où elle a pris le créneau (depuis) et qui sont terminées ; on ne peut pas s'inscrire après coup.
const maintenantLocal = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${isoLocal(d)}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function heuresPeriode(cr, debut, fin, depuis, jusqua) {
  const now = maintenantLocal(), parSem = {}; let h = 0;
  if (!debut) return { h: 0, parSem };
  for (const d = lundiDe(debut), g = 0; isoLocal(d) <= now.slice(0, 10) && g < 80; d.setDate(d.getDate() + 7)) {
    const j = new Date(d); j.setDate(j.getDate() + cr.jour - 1); const iso = isoLocal(j);
    if (iso < debut || (fin && iso > fin) || (S.calendrier.feries || []).some(f => f.date === iso)) continue;
    const q = quinzaineDe(iso); if (!q || (cr.groupe && cr.groupe !== q)) continue;
    const dt0 = `${iso}T${cr.debut}`, dt1 = `${iso}T${cr.fin}`;
    if (dt1 > now || (depuis && dt0 < depuis) || (jusqua && dt0 >= jusqua)) continue;
    const w = poidsCreneau(cr.debut, cr.fin); parSem[isoLocal(d)] = (parSem[isoLocal(d)] || 0) + w; h += w;
  }
  return { h, parSem };
}
function remplacementsEntrees() {
  const L = [];
  (S.archives || []).forEach(ar => (ar.remplacements || []).forEach(r => { if (r.remplacantId) L.push({ remplacantId: r.remplacantId, absentId: ar.aeshId, debut: ar.absenceDebut || '', fin: ar.absenceFin || (ar.date || '').slice(0, 10), cr: r, depuis: r.depuis || '', jusqua: r.jusqua || '' }); }));
  (S.segmentsRempl || []).forEach(g => L.push({ remplacantId: g.remplacantId, absentId: g.absentId, debut: g.absDebut || '', fin: g.absFin || '', cr: g.cr, depuis: g.depuis || '', jusqua: g.jusqua || '' }));
  S.creneaux.filter(c => c.remplacantId).forEach(c => { const ab = absenceOuverte(c.aeshId), a = aesh(c.aeshId); L.push({ remplacantId: c.remplacantId, absentId: c.aeshId, debut: (ab && ab.debut) || (a && a.absenceDebut) || aujourdhui(), fin: (ab && ab.fin) || (a && a.absenceFin) || '', cr: c, depuis: c.remplacantDepuis || '', jusqua: '' }); });
  return L;
}
function statsAbsences() {
  const T = {}, g = id => (T[id] ||= { nbAbs: 0, jours: 0, remplCr: 0, remplH: 0, extra: 0, semaines: {} });
  (S.absences || []).forEach(ab => { const s2 = g(ab.aeshId); s2.nbAbs++; const fin = ab.ouvert ? (ab.fin && ab.fin < aujourdhui() ? ab.fin : aujourdhui()) : (ab.fin || aujourdhui()); s2.jours += Math.max(1, Math.round((new Date(fin) - new Date(ab.debut || fin)) / 864e5) + 1); });
  remplacementsEntrees().forEach(en => { const s2 = g(en.remplacantId), { h, parSem } = heuresPeriode(en.cr, en.debut, en.fin, en.depuis, en.jusqua); if (h > 0 || !en.jusqua) s2.remplCr++; s2.remplH += h; Object.entries(parSem).forEach(([k, v]) => { s2.semaines[k] = (s2.semaines[k] || 0) + v; }); });
  (S.prisesOcc || []).forEach(p => { const s2 = g(p.remplacantId); s2.remplCr++; if (`${p.date}T${p.fin}` <= maintenantLocal()) { const w = poidsCreneau(p.debut, p.fin), k = isoLocal(lundiDe(p.date)); s2.remplH += w; s2.semaines[k] = (s2.semaines[k] || 0) + w; } });
  Object.entries(T).forEach(([id, s2]) => { const a = aesh(id); if (!a || a.quotite == null) return; const base = charge(a).tot; Object.values(s2.semaines).forEach(w => { s2.extra += Math.max(0, Math.min(w, base + w - a.quotite)); }); });
  return T;
}
const libCreneau = cr => `${JOURS_LONGS[cr.jour - 1]} ${hh(cr.debut)}–${hh(cr.fin)}${cr.groupe ? ' (semaine ' + cr.groupe + ')' : ''}`;
function candidatsRemplacement(cr) {
  const ST = { ok: '✓', warn: '⚠', bad: '✗' };
  return S.aesh.filter(a => a.id !== cr.aeshId && !absente(a)).map(a => evalAesh(a.id, cr.eleveId, cr.jour, cr.debut, cr.fin, cr.groupe, cr.id)).sort((x, y) => ORD_ST[x.st] - ORD_ST[y.st] || y.sc - x.sc)
    .map(r => ({ id: r.aid, label: `${ST[r.st]} ${aesh(r.aid).nom}${r.R.length ? ' — ' + r.R.slice(0, 2).map(x => x[1]).join(', ') : ''}` }));
}
window.declarerAbsence = (aid = '') => {
  const dispo = sortAesh(S.aesh.filter(a => !absente(a)));
  modal(`<h2>Déclarer une absence</h2><div class="form-grid">
    <label class="f wide">AESH en absence<select name="aid">${dispo.map(a => `<option value="${a.id}" ${a.id === aid ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select></label>
    <label class="f">Motif<select name="motif">${MOTIFS_ABSENCE.map(m => `<option>${m}</option>`).join('')}</select></label>
    <label class="f">À partir du<input type="date" name="debut" value="${aujourdhui()}" required></label>
    <label class="f">Jusqu'au (si connu)<input type="date" name="fin"></label></div>
    <p class="small muted">L'AESH repasse automatiquement « Actif » le lendemain de la date de fin.</p>`, d => {
    const a = aesh(d.aid); if (!a) return false; a.statut = d.motif; a.absenceDebut = d.debut || aujourdhui(); a.absenceFin = d.fin || null; syncAbsence(a);
    commit('aesh', `${a.nom} : absence déclarée (${d.motif}) à partir du ${frDate(a.absenceDebut)}${a.absenceFin ? ' jusqu\'au ' + frDate(a.absenceFin) : ''}`); location.hash = '#/absences'; setTimeout(() => publierAuto(), 100);
  });
};
window.finAbsence = aid => {
  const a = aesh(aid); if (!confirm(`Mettre fin à l'absence de ${a.nom} ? Retour au statut « Actif » et les remplacements en cours sont archivés.`)) return;
  const n = archiverRemplacements(aid); const ab = absenceOuverte(aid); if (ab) { ab.ouvert = false; ab.fin = aujourdhui(); }
  a.statut = 'Actif'; a.absenceDebut = null; a.absenceFin = null; commit('aesh', `${a.nom} : fin d'absence${n ? ' ; remplacements archivés : ' + n : ''}`); setTimeout(() => publierAuto(), 100);
};
// Dates réellement touchées par une absence, pour un créneau hebdomadaire : seulement la période d'absence (à partir d'aujourd'hui), vacances / fériés / semaines Q1-Q2 respectés.
// Sans date de fin, on regarde les 14 prochains jours (republié à chaque ouverture de Cockpit).
function datesImpactees(cr, ab) {
  const auj = aujourdhui(), debut = ab && ab.debut && ab.debut > auj ? ab.debut : auj;
  const fin = ab && ab.fin ? ab.fin : isoLocal(new Date(Date.now() + 14 * 864e5)), out = [];
  for (let d = new Date(debut + 'T12:00:00'); isoLocal(d) <= fin; d.setDate(d.getDate() + 1)) {
    const iso = isoLocal(d); if ((d.getDay() + 6) % 7 + 1 !== cr.jour || (S.calendrier.feries || []).some(f => f.date === iso)) continue;
    const q = quinzaineDe(iso); if (!q || (cr.groupe && cr.groupe !== q)) continue; // la journée en cours reste affichée même si le cours est passé (information) ; seuls les cours à venir sont publiés / envoyés
    out.push(iso);
  }
  return out;
}
// créneaux de l'AESH touchés par son absence en cours (chacun avec ses dates : _dates)
function creneauxACouvrir(aid) {
  const ab = absenceOuverte(aid); if (!ab) return [];
  return S.creneaux.filter(c => c.aeshId === aid && eleve(c.eleveId)).map(c => ({ ...c, _dates: datesImpactees(c, ab) })).filter(c => c._dates.length)
    .sort((p, q) => p._dates[0].localeCompare(q._dates[0]) || p.debut.localeCompare(q.debut) || (p.groupe || '').localeCompare(q.groupe || ''));
}
const datesAVenir = c => c._dates.filter(dt => `${dt}T${c.debut}` > maintenantLocal()); // cours pas encore commencés : seuls ceux-là peuvent être remplacés
const dateCourte = iso => `${jourDe(iso).slice(0, 3)}. ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// texte diffusable : sans parenthèses ni aucun mot qui soit un prénom ou un nom d'élève (certains créneaux ont pour « matière » le prénom de l'élève)
let _nomsEleves = null;
const _noms = () => {
  if (!_nomsEleves || _nomsEleves.n !== S.eleves.length) { const nrm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, ''); _nomsEleves = { n: S.eleves.length, nrm, set: new Set(S.eleves.flatMap(e => [e.prenom, e.nom, ...String(e.prenom || '').split(/[\s-]+/), ...String(e.nom || '').split(/[\s-]+/)]).map(nrm).filter(x => x.length >= 3)) }; }
  return _nomsEleves;
};
const contientNomEleve = t => { const N = _noms(); return String(t || '').split(/[^A-Za-zÀ-ÿ'’-]+/).some(w => w && N.set.has(N.nrm(w))); };
const sansNomEleve = t => {
  const _nomsEleves = _noms();
  return String(t || '').replace(/\s*\([^)]*\)/g, '').split(/(\s+|\/)/).filter(w => !w.trim() || w === '/' || !_nomsEleves.set.has(_nomsEleves.nrm(w))).join('').replace(/\s*\/\s*(?=\/|$)/g, '').replace(/^\s*\/\s*/, '').replace(/\s+/g, ' ').trim();
};
function messageEquipe(aid) {
  const a = aesh(aid), ab = absenceOuverte(aid) || {}, L = creneauxACouvrir(aid).filter(c => !c.remplacantId);
  const periode = ab.debut ? `du ${frDate(ab.debut)}${ab.fin ? ' au ' + frDate(ab.fin) : ' (fin à préciser)'}` : '';
  const lignes = L.flatMap(c => { const e = eleve(c.eleveId); return datesAVenir(c).map(dt => ({ dt, c, e })); }).sort((x, y) => x.dt.localeCompare(y.dt) || x.c.debut.localeCompare(y.c.debut)).slice(0, 60)
    .map(({ dt, c, e }) => `- ${jourDe(dt)} ${dt.slice(8, 10)}/${dt.slice(5, 7)} ${hh(c.debut)}–${hh(c.fin)} — ${e.site === 'Collège' ? '' : e.site + ' · '}classe ${e.classe}${libDisp(e) ? ' (élève ' + libDisp(e) + ')' : ''}${sansNomEleve(c.matiere) ? ' — ' + sansNomEleve(c.matiere) : ''}`);
  const sujet = `Remplacement à prévoir — absence de ${a.nom} ${periode}`.trim();
  const corps = `Bonjour à toutes et à tous,\n\n${a.nom} est en absence ${periode}.\nVoici les créneaux à couvrir (aucun nom d'élève dans ce message) :\n\n${lignes.join('\n') || '- (aucun créneau restant à couvrir)'}\n\nMerci de me dire par retour si vous pouvez en prendre un.\n\nCécile`;
  const bcc = S.aesh.filter(x => !absente(x) && x.email && (a.dispositif || !x.dispositif)).map(x => x.email).join(','); // AESH ULIS / SEGPA exclues, sauf si l'absente est elle-même ULIS / SEGPA (alors toute l'équipe est prévenue)
  return { sujet, corps, bcc, n: L.length };
}
window.prevenirEquipe = aid => {
  const m = messageEquipe(aid), href = `mailto:?bcc=${encodeURIComponent(m.bcc)}&subject=${encodeURIComponent(m.sujet)}&body=${encodeURIComponent(m.corps)}`;
  modal(`<h2>Prévenir l'équipe</h2><p class="small muted" style="margin-top:0">Message prêt à envoyer à toute l'équipe en copie cachée (${m.bcc.split(',').filter(Boolean).length} adresses académiques). Il ne contient aucun nom d'élève.</p>
    <label class="f wide">Objet<input type="text" value="${esc(m.sujet)}" readonly></label><label class="f wide">Message<textarea rows="12" readonly>${esc(m.corps)}</textarea></label>
    <div class="toolbar" style="margin-top:10px"><a class="btn primary" href="${href}">Ouvrir dans ma messagerie</a><button type="button" class="btn" onclick="navigator.clipboard.writeText(document.querySelector('#modal textarea').value).then(() => toast('Message copié'))">Copier le message</button></div>`, () => { });
};
// occurrences datées à venir d'un créneau hebdomadaire (jamais le passé : rien ne peut être pris après coup)
function occurrencesAVenir(cr, fin, nbSem = 8) {
  const now = maintenantLocal(), out = [];
  for (let d = lundiDe(aujourdhui()), g = 0; g < nbSem; d.setDate(d.getDate() + 7), g++) {
    const j = new Date(d); j.setDate(j.getDate() + cr.jour - 1); const iso = isoLocal(j);
    if (fin && iso > fin) break; if ((S.calendrier.feries || []).some(f => f.date === iso)) continue;
    const q = quinzaineDe(iso); if (!q || (cr.groupe && cr.groupe !== q)) continue;
    if (`${iso}T${cr.debut}` <= now) continue;
    out.push({ id: cr.id + '@' + iso, date: iso, debut: cr.debut, fin: cr.fin, semaine: q });
  }
  return out;
}
// Consignes pratiques seulement (jamais de santé, de diagnostic ni de prénom) : liste blanche + formulations des MOPPS sans nom d'élève
const AIDES_PRATIQUES = ['Accompagnement dans les activités d’apprentissage', 'Lecteur / lecture des consignes', 'Dictée aménagée / à l’adulte', 'Ordinateur / matériel informatique', 'Matériel pédagogique adapté', 'Tiers-temps / temps majoré', 'Pauses / temps de repos', 'Police et mise en page adaptées', 'Calculatrice / aide au calcul', 'Réduire la quantité d’exercices', 'Placement adapté en classe', 'Secrétaire / scripteur', 'Évaluations aménagées', 'Accompagnement dans les activités sociales et relationnelles', 'Accompagnement dans les activités de la vie quotidienne'];
function apercuEleve(e) {
  const aides = [];
  ((e.profil && e.profil.aides) || []).forEach(a => { const n = String(a.nom || '').trim();
    if (AIDES_PRATIQUES.includes(n)) aides.push(n);
    else if (/^[«"]/.test(n) && !contientNomEleve(n)) { const c = n.replace(/[«»"]/g, '').trim(); if (c.length > 4) aides.push(c.charAt(0).toUpperCase() + c.slice(1)); } });
  return { accompagnement: e.type === 'Individuel' ? 'Accompagnement individuel' : 'Accompagnement mutualisé (plusieurs élèves de la classe)', aides: [...new Set(aides)].slice(0, 6) };
}
function construirePublication() {
  const ouv = (S.absences || []).filter(x => x.ouvert), occ = [];
  ouv.forEach(ab => creneauxACouvrir(ab.aeshId).filter(c => !c.remplacantId).forEach(c => { const e = eleve(c.eleveId);
    datesAVenir(c).map(dt => ({ id: c.id + '@' + dt, date: dt, debut: c.debut, fin: c.fin, semaine: quinzaineDe(dt) })).forEach(o => occ.push({ ...o, creneauId: c.id, absenceId: ab.id, absentId: ab.aeshId, classe: e.classe, dispositif: libDisp(e) || (dispositifDe(e) || ''), site: e.site, matiere: sansNomEleve(c.matiere), ...(S.pubApercu ? { prenom: e.prenom, apercu: apercuEleve(e) } : {}) })); }));
  const quinzaines = {}; for (let i = 0, d = lundiDe(aujourdhui()); i < 12; i++, d.setDate(d.getDate() + 7)) quinzaines[isoLocal(d)] = quinzaineDe(isoLocal(d)) || null;
  const aeshL = S.aesh.filter(a => !absente(a) && a.email).map(a => ({ id: a.id, nom: a.nom, email: a.email, dispositif: a.dispositif || null, classes: [...new Set(affOfAesh(a).filter(x => x.heures > 0).map(x => (eleve(x.eleveId) || {}).classe).filter(Boolean))],
    occupations: S.creneaux.filter(c => c.aeshId === a.id || c.remplacantId === a.id).map(c => ({ jour: c.jour, debut: c.debut, fin: c.fin, groupe: c.groupe || null })) }));
  const absences = ouv.map(ab => { const a = aesh(ab.aeshId); return { id: ab.id, aeshId: ab.aeshId, nom: a ? a.nom : '', dispositif: a && a.dispositif ? a.dispositif : null, debut: ab.debut || '', fin: ab.fin || '' }; });
  const lim = isoLocal(new Date(Date.now() + 14 * 864e5)), ess = S.eleves.filter(e => !e.archive && e.essDate && e.essDate >= aujourdhui() && e.essDate <= lim).map(e => ({ id: e.id, date: e.essDate, debut: e.essHeure || '', salle: e.essSalle || '', classe: e.classe, dispositif: libDisp(e) || '', aeshIds: aeshEss(e).map(a => a.id), ...(S.pubApercu ? { prenom: e.prenom } : {}) })).filter(x => x.aeshIds.length);
  return { genere: maintenantLocal(), avecApercu: !!S.pubApercu, absences, occurrences: occ, aesh: aeshL, quinzaines, ess };
}
window.pubApercu = oui => { S.pubApercu = !!oui; save(); toast(oui ? 'Prénom et consignes seront inclus dans la publication' : 'Aucune donnée d’élève dans la publication'); };
// Envoi automatique à l'appli en ligne : le serveur envoie lui-même le mail aux collègues qui peuvent prendre un créneau (une seule fois par absence)
const normaliserUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'http://' + u; try { return new URL(u).origin; } catch (x) { return u.replace(/\/+$/, ''); } };
const erreurServeur = x => { const m = String((x && x.message) || x); if (/Clé invalide/.test(m)) return 'Clé refusée. Avec le test, la clé change à chaque lancement : copie la clé affichée dans la fenêtre du lanceur ACTUELLE, saisis-la ici (Absences AESH → Envoi automatique aux collègues) puis clique sur Enregistrer.'; if (/:8750/.test((S.serveur || {}).url || '')) return 'Cette adresse (…:8750) est celle de la COPIE de Cockpit, pas celle de l\'appli en ligne. Il faut l\'adresse qui se termine par :8745 (ligne « Adresse » de la fenêtre du lanceur).'; if (/Failed to fetch|NetworkError|Load failed|fetch|network/i.test(m)) return 'Appli en ligne injoignable (' + ((S.serveur || {}).url || '?') + '). Vérifie que l\'adresse est identique à celle de la fenêtre du lanceur (elle se termine par :8745), que cette fenêtre est ouverte et que Tailscale est actif.'; return m; };
let evalsEtat = { ok: null, msg: '', le: '' };
window.serveurEnregistrer = async () => {
  S.serveur = { url: normaliserUrl($('#srv-url').value), cle: ($('#srv-cle').value || '').trim() }; save();
  const el = document.getElementById('srv-etat'); if (el) { el.className = 'small muted'; el.textContent = 'Vérification…'; }
  const ok = await evalsActualiser(false);
  const e2 = document.getElementById('srv-etat'); if (e2) { e2.className = 'small'; e2.style.color = ok ? 'var(--ok)' : 'var(--bad)'; e2.textContent = ok ? `✓ Relié à l'appli en ligne (${(S.evals.demandes || []).length} demande${(S.evals.demandes || []).length > 1 ? 's' : ''} reçue${(S.evals.demandes || []).length > 1 ? 's' : ''}).` : '✗ ' + evalsEtat.msg; }
  return ok;
};
window.publierAuto = async (verbose = false) => {
  S.pubJour = aujourdhui();
  const sv = S.serveur || {}; if (!sv.url || !sv.cle) { if (verbose) toast('Renseigne d’abord l’adresse et la clé du serveur'); return false; }
  try {
    const r = await fetch(sv.url + '/api/admin/publier', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sv.cle }, body: JSON.stringify(construirePublication()) });
    const j = await r.json().catch(() => ({})); if (verbose || !r.ok || /prévenues/.test(j.message || '')) toast(r.ok ? 'Appli en ligne : ' + j.message : 'Appli en ligne refusée : ' + (j.erreur || r.status)); return r.ok;
  } catch (x) { toast('Appli en ligne injoignable : les collègues ne sont pas prévenues automatiquement (utilise « Prévenir l’équipe »)'); return false; }
};
window.exporterACouvrir = () => {
  const pub = construirePublication();
  const b = new Blob([JSON.stringify(pub, null, 1)], { type: 'application/json' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = 'publication-remplacements.json'; l.click(); URL.revokeObjectURL(u);
  toast(`${pub.occurrences.length} créneaux à venir exportés`);
};
// Prises faites dans l'appli en ligne (fichier « prises-remplacements.json » téléchargé dans la rubrique Coordination)
function integrerPrises(prises) {
  let ajout = 0, retrait = 0, rejet = 0;
  (prises || []).forEach(p => {
    const i = S.prisesOcc.findIndex(x => x.occId === p.occId);
    if (p.annulee) { if (i >= 0) { S.prisesOcc.splice(i, 1); retrait++; } return; }
    // verrou du passé : une prise de l'équipe enregistrée après le début du cours n'est pas retenue ; une décision de la coordination l'est toujours
    if (!p.priseLe || (!p.parCoordination && p.priseLe >= `${p.date}T${p.debut}`)) { rejet++; return; }
    const cr = S.creneaux.find(c => c.id === p.creneauId), rec = { occId: p.occId, creneauId: p.creneauId, absentId: cr ? cr.aeshId : null, date: p.date, debut: p.debut, fin: p.fin, remplacantId: p.aeshId, priseLe: p.priseLe, parCoordination: !!p.parCoordination };
    if (i >= 0) S.prisesOcc[i] = rec; else { S.prisesOcc.push(rec); ajout++; }
  });
  return { ajout, retrait, rejet };
}
window.importerPrises = async ev => {
  const f = ev.target.files[0]; if (!f) return; let d; try { d = JSON.parse(await f.text()); } catch (x) { return alert('Fichier illisible.'); }
  const { ajout, retrait, rejet } = integrerPrises(d.prises);
  commit('aesh', `Prises de l'appli en ligne importées : ${ajout} nouvelle(s), ${retrait} annulée(s)${rejet ? ', ' + rejet + ' rejetée(s) (enregistrées après le début du cours)' : ''}`);
};
// récupération automatique des prises faites dans l'appli en ligne (même clé que l'envoi automatique) ; pastille « Absences AESH » pour chaque nouvelle prise
window.prisesActualiser = async (silencieux = false) => {
  if (!serveurOK()) return false;
  try {
    const j = await apiServeur('/api/admin/prises'), avant = new Set(S.prisesOcc.map(p => p.occId)), r = integrerPrises(j.prises);
    if (S.prisesVues === null) S.prisesVues = [...avant]; // première synchro : on ne notifie pas l'existant
    const neuves = S.prisesOcc.filter(p => !avant.has(p.occId));
    if (r.ajout || r.retrait) { save(); majCompteurAbsences(); if (/^#\/(absences|aesh\/)/.test(location.hash)) render(); }
    if (neuves.length && silencieux) { const t = neuves.map(p => `${(aesh(p.remplacantId) || {}).nom || '?'} remplace ${(aesh(p.absentId) || {}).nom || '?'} le ${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`).join(' ; '); toast('Remplacement pris : ' + t); try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Cockpit Coordo — remplacement pris', { body: t }); } catch (x) { } }
    return true;
  } catch (x) { return false; }
};
function majCompteurAbsences() { const el = document.getElementById('nav-absences'); if (!el) return; const vues = new Set(S.prisesVues || []), n = (S.prisesOcc || []).filter(p => !vues.has(p.occId)).length; el.textContent = n || ''; el.style.display = n ? '' : 'none'; majTitreEtBadge(); }
// pastille sur l'icône de l'appli quand c'est possible (navigateur / PWA) et dans le titre de l'onglet
function majTitreEtBadge() {
  const tot = ['nav-evals', 'nav-absences', 'nav-ess', 'nav-alertes', 'nav-questions'].slice(0, 3).reduce((t, id) => { const e = document.getElementById(id); return t + (e && e.style.display !== 'none' ? parseInt(e.textContent) || 0 : 0); }, 0);
  document.title = (tot ? `(${tot}) ` : '') + 'Cockpit Coordo — suivi AESH'; try { if (navigator.setAppBadge) tot ? navigator.setAppBadge(tot) : navigator.clearAppBadge(); } catch (x) { }
}
/* ====================== QUESTIONS À POSER (réunions) ====================== */
window.questionAjouter = () => { const t = ($('#q-texte').value || '').trim(); if (!t) return; S.questions.unshift({ id: uid('q'), texte: t, pour: ($('#q-pour').value || '').trim(), lien: '', creeLe: aujourdhui(), fait: false, reponse: '' }); commit('question', 'Question ajoutée : ' + t.slice(0, 60)); };
window.questionBascule = (id, v) => { const q = S.questions.find(x => x.id === id); if (!q) return; q.fait = !!v; commit('question', (v ? 'Question posée : ' : 'Question remise à poser : ') + q.texte.slice(0, 50)); };
window.questionReponse = (id, v) => { const q = S.questions.find(x => x.id === id); if (!q) return; q.reponse = v.trim(); commit('question', 'Réponse notée : ' + q.texte.slice(0, 50)); };
window.questionSupprimer = id => { const q = S.questions.find(x => x.id === id); if (!q || !confirm('Supprimer cette question ?')) return; S.questions = S.questions.filter(x => x.id !== id); commit('question', 'Question supprimée : ' + q.texte.slice(0, 50)); };
function pageQuestions() {
  setTitle('Questions à poser');
  const a = S.questions.filter(q => !q.fait), f = S.questions.filter(q => q.fait);
  const carte = q => `<div class="card" style="margin-bottom:10px;${q.fait ? 'opacity:.75' : ''}"><div style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" ${q.fait ? 'checked' : ''} onchange="questionBascule('${q.id}',this.checked)" title="Cochée = question posée" style="margin-top:4px"><div style="flex:1"><div>${esc(q.texte)}</div>
    <div class="small muted" style="margin-top:4px">${q.pour ? esc(q.pour) + ' · ' : ''}notée le ${frDate(q.creeLe)}${q.lien ? ` · <a href="${q.lien}">voir la fiche</a>` : ''}</div>
    <textarea placeholder="Réponse obtenue…" style="width:100%;margin-top:6px;min-height:42px" onchange="questionReponse('${q.id}',this.value)">${esc(q.reponse || '')}</textarea></div><button class="btn sm ghost no-print" onclick="questionSupprimer('${q.id}')" title="Supprimer">✕</button></div></div>`;
  $('#page').innerHTML = `<div class="card" style="margin-bottom:14px"><h2>Noter une question</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="q-texte" type="text" placeholder="Ma question…" style="flex:3;min-width:240px"><input id="q-pour" type="text" placeholder="Pour qui / quelle réunion" style="flex:1;min-width:160px"><button class="btn primary" onclick="questionAjouter()">Ajouter</button></div></div>
    <h2>À poser <span class="pill ${a.length ? 'warn' : 'ok'}">${a.length}</span></h2>${a.map(carte).join('') || '<div class="empty">Aucune question en attente.</div>'}
    ${f.length ? `<h2 style="margin-top:18px">Déjà posées <span class="pill neutral">${f.length}</span></h2>${f.map(carte).join('')}` : ''}`;
}
/* ====================== ÉVALUATIONS (demandes d'AESH des enseignants, reçues par l'appli en ligne) ====================== */
window.importerEvals = async ev => {
  const f = ev.target.files[0]; if (!f) return; let d; try { d = JSON.parse(await f.text()); } catch (x) { return alert('Fichier illisible.'); }
  S.evals = { maj: d.genere || '', demandes: d.demandes || [] }; commit('aesh', `Demandes d'AESH pour évaluations importées : ${S.evals.demandes.length}`);
};
const STATUTS_EVAL = { nouvelle: ['À traiter', 'bad'], proposee: ['Proposée aux AESH', 'warn'], acceptee: ['Validée', 'ok'], refusee: ['Refusée', 'neutral'], annulee: ['Annulée', 'neutral'] };
const serveurOK = () => !!(S.serveur && S.serveur.url && S.serveur.cle);
async function apiServeur(chemin, corps) {
  const opt = { headers: { Authorization: 'Bearer ' + S.serveur.cle } };
  if (corps !== undefined) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(corps); }
  const r = await fetch(S.serveur.url + chemin, opt), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erreur || 'Erreur ' + r.status); return j;
}
function majCompteurEvals() { const el = document.getElementById('nav-evals'); if (!el) return; const n = (S.evals.demandes || []).filter(d => d.statut === 'nouvelle' || (d.statut === 'proposee' && (d.candidats || []).some(c => c.positionne))).length; el.textContent = n || ''; el.style.display = n ? '' : 'none'; majTitreEtBadge(); }
// les demandes des enseignant.e.s arrivent directement de l'appli en ligne (même clé que l'envoi automatique) ; contrôle toutes les 2 minutes
window.evalsActualiser = async (silencieux = false) => {
  if (!serveurOK()) { if (!silencieux) toast('Renseigne l’adresse et la clé de l’appli en ligne (Absences AESH → Envoi automatique)'); return false; }
  try {
    const anciennes = (S.evals.demandes || []).slice(); const j = await apiServeur('/api/admin/demandes'); S.evals = { maj: j.genere || '', demandes: j.demandes || [] }; evalsEtat = { ok: true, msg: '', le: new Date().toTimeString().slice(0, 5) };
    const neuves = S.evals.demandes.filter(d => d.statut === 'nouvelle' && !S.evalsVues.includes(d.id));
    const posAvant = {}; (anciennes || []).forEach(d => { posAvant[d.id] = (d.candidats || []).filter(c => c.positionne).length; }); const positionnees = S.evals.demandes.filter(d => d.statut === 'proposee' && (d.candidats || []).filter(c => c.positionne).length > (posAvant[d.id] ?? 0) && anciennes && anciennes.length);
    save(); majCompteurEvals();
    if (positionnees.length && silencieux) toast(`${positionnees.length > 1 ? positionnees.length + ' demandes ont' : 'Une demande a'} reçu une nouvelle candidature : à valider`);
    if (neuves.length && silencieux) { toast(`Nouvelle demande d'accompagnement : ${neuves.length}`); try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Cockpit Coordo — DS demande d\'accompagnement', { body: `${neuves.length} nouvelle${neuves.length > 1 ? 's' : ''} demande${neuves.length > 1 ? 's' : ''} d'un.e enseignant.e` }); } catch (x) { } }
    if (/^#\/evals/.test(location.hash)) render(); return true;
  } catch (x) { evalsEtat = { ok: false, msg: erreurServeur(x), le: new Date().toTimeString().slice(0, 5) }; if (!silencieux) toast('Appli en ligne : ' + evalsEtat.msg.slice(0, 90) + '…'); if (/^#\/evals/.test(location.hash)) render(); return false; }
};
// « 4e8 », « 4e 8 », « 4ème 8 » désignent la même classe
const normClasse = c => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(\d)\s*(?:eme|ere|e|°)(?![a-z])/g, '$1e').replace(/[\s.\-_]+/g, '');
const elevesClasse = c => S.eleves.filter(e => !e.archive && normClasse(e.classe) === normClasse(c));
// AESH qui suivent (heures affectées) au moins un élève de la classe : elles sont prioritaires pour accompagner une évaluation
const suiveusesClasse = c => { const m = {}; elevesClasse(c).forEach(e => affOf(e).filter(x => x.heures > 0).forEach(x => { const a = aesh(x.aeshId); if (a) (m[a.id] ||= { a, eleves: [] }).eleves.push(e); })); return m; };
const demandeEval = id => (S.evals.demandes || []).find(d => d.id === id);
const libDemande = d => `${jourDe(d.date)} ${frDate(d.date)} · ${hh(d.debut)}–${hh(d.fin)} · classe ${d.classe} · salle ${d.salle}`;
async function actionEval(chemin, corps, msgOk) { try { const j = await apiServeur(chemin, corps); toast(j.message || msgOk || 'Fait'); } catch (x) { toast(x.message); } await evalsActualiser(true); render(); }
window.evalProposer = id => {
  const d = demandeEval(id); if (!d) return; const suit = suiveusesClasse(d.classe), L = sortAesh(S.aesh.filter(a => !absente(a) && a.email));
  modal(`<h2>Proposer aux AESH</h2><p class="small muted" style="margin-top:0">${esc(libDemande(d))} (${esc(d.type)})${d.notifie ? ' · <b>élève notifié</b>' : ''}</p>
    <label style="display:block;margin:6px 0"><input type="radio" name="mode" value="choix" ${Object.keys(suit).length ? 'checked' : ''}> Seulement les AESH cochées (celles qui suivent la classe sont pré-cochées)</label>
    <div style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin:4px 0 8px">${L.map(a => `<label style="display:flex;gap:8px;align-items:center;padding:2px 0"><input type="checkbox" name="a_${a.id}" ${suit[a.id] ? 'checked' : ''}> ${esc(a.nom)} ${suit[a.id] ? '<span class="pill ok">suit la classe</span>' : ''}</label>`).join('')}</div>
    <label style="display:block;margin:6px 0"><input type="radio" name="mode" value="tous" ${Object.keys(suit).length ? '' : 'checked'}> Toute l'équipe</label>
    <label style="display:block;margin:10px 0 0"><input type="checkbox" name="mail" checked> Les prévenir par mail — tu reçois une copie</label>`, f => {
    const ids = f.mode === 'choix' ? L.filter(a => f['a_' + a.id]).map(a => a.id) : [];
    if (f.mode === 'choix' && !ids.length) { alert('Coche au moins une AESH, ou choisis « Toute l\'équipe ».'); return false; }
    actionEval('/api/admin/demandes/decider', { id, decision: 'proposer', aeshIds: ids, prevenir: !!f.mail });
  });
};
window.evalElargir = id => { if (confirm('Élargir cette demande à toute l\'équipe ?')) actionEval('/api/admin/demandes/decider', { id, decision: 'elargir', prevenir: confirm('Prévenir par mail les autres AESH ?') }); };
window.evalValider = (id, aid) => { const a = aesh(aid); if (confirm(`Valider ${a ? a.nom : 'cette AESH'} ? Elle et l'enseignant.e recevront un mail de validation (tu reçois une copie).`)) actionEval('/api/admin/demandes/decider', { id, decision: 'accepter', aeshId: aid }); };
window.evalRefuser = id => { const m = prompt('Motif du refus (envoyé à l\'enseignant.e) :', ''); if (m !== null) actionEval('/api/admin/demandes/decider', { id, decision: 'refuser', message: m }); };
window.evalAnnuler = id => { if (confirm('Annuler cette demande ?')) actionEval('/api/admin/demandes/annuler', { id }); };
window.evalInfos = id => {
  const d = demandeEval(id); if (!d) return;
  // Élève notifié : nom, prénom et récapitulatif d'accompagnement repris de la fiche élève (élèves de la classe qui ont une AESH affectée) ; modifiable avant envoi
  const typeAcc = e => { const A = affOf(e).filter(x => x.heures > 0); return (e.type === 'Individuel' ? 'accompagnement individuel' : 'accompagnement mutualisé') + (e.heures ? ' · ' + hf(e.heures) + ' notifiées' : '') + (A.length ? ' · AESH habituelle' + (A.length > 1 ? 's' : '') + ' : ' + A.map(x => (aesh(x.aeshId) || {}).nom || '?').join(', ') : ''); };
  const aidesExamen = e => { const base = apercuEleve(e).aides, ex = ((e.profil && e.profil.aides) || []).map(a => String(a.nom || '').trim()).filter(n => n === 'Aménagements aux examens' || n === 'Évaluations aménagées'); return [...new Set([...base, ...ex])]; };
  // synthèse tirée de la fiche, du MOPPS enregistré (aide humaine, activités) et des aménagements PPS retenus pour le niveau de l'élève
  const syntheseMopps = e => { const m = e.mopps, out = []; if (!m) return out;
    if (m.aeshType) out.push(`aide humaine ${m.aeshType}${m.aeshHeures ? ' · ' + m.aeshHeures + ' h' : ''}`);
    const labels = []; (window.MOPPS_AESH_ACTIVITES || []).forEach(g => g.items.forEach(([i, l]) => { if ((m.aeshActivites || []).includes(i)) labels.push(l); })); if (labels.length) out.push('l\'AESH aide à : ' + labels.slice(0, 6).join(' ; '));
    const pps = ppsSummary(e, e.niveau).flatMap(x => x.items).slice(0, 8); if (pps.length) out.push('aménagements retenus : ' + pps.join(' ; '));
    return out; };
  // élèves notifiés de la classe ; s'il y en a plusieurs, on retient d'abord ceux que l'AESH validée suit déjà (le plus probable), sinon tous (à toi de garder le bon)
  const tous = elevesClasse(d.classe).filter(e => affOf(e).some(x => x.heures > 0)), suivis = tous.filter(e => affOf(e).some(x => x.aeshId === d.aeshId && x.heures > 0)), notifies = suivis.length ? suivis : tous;
  const prefill = notifies.map(e => `Élève : ${e.prenom} ${e.nom}${libDisp(e) ? ' (' + libDisp(e) + ')' : ''} — classe ${e.classe}\nAccompagnement : ${typeAcc(e)}\nAides à mettre en place : ${aidesExamen(e).length ? aidesExamen(e).join(' ; ') : 'aucune consigne particulière enregistrée dans la fiche'}${syntheseMopps(e).length ? '\nSelon le MOPPS : ' + syntheseMopps(e).join(' — ') : ''}`).join('\n\n');
  const aide = notifies.length ? `Texte prérempli d'après la fiche${notifies.length > 1 ? ' des ' + notifies.length + ' élèves notifiés de la classe ' + esc(d.classe) + ' : supprime ceux qui ne sont pas concernés' : ' de l\'élève notifié de la classe ' + esc(d.classe)}. Relis, corrige si besoin, puis clique sur Enregistrer : l'AESH est prévenue.` : `Aucun élève notifié trouvé dans la classe « ${esc(d.classe)} » : saisis le texte.`;
  modal(`<h2>Communiquer l'élève et les aides</h2><p class="small muted" style="margin-top:0">${esc(libDemande(d))}. Ce texte n'est visible que par l'AESH validée (dans l'appli) ; elle est prévenue par mail. Effacé le lendemain.</p><p class="small" style="margin:0 0 6px"><b>${aide}</b></p><label class="f wide">Élève(s) et aides à mettre en place<textarea name="note" rows="9" style="width:100%">${esc(prefill)}</textarea></label>`, f => { actionEval('/api/admin/demandes/liberer', { id, note: f.note || '', oui: true }); });
};
function pageEvals() {
  setTitle('DS demande d’accompagnement', `<button class="btn primary" onclick="evalsActualiser()">Actualiser</button>`);
  if (serveurOK() && !S.evalsRafraichi) { S.evalsRafraichi = true; evalsActualiser(true); }
  (S.evals.demandes || []).filter(d => d.statut === 'nouvelle').forEach(d => { if (!S.evalsVues.includes(d.id)) S.evalsVues.push(d.id); }); save();
  const L = (S.evals.demandes || []).slice().sort((a, b) => (a.date + a.debut).localeCompare(b.date + b.debut)), auj = aujourdhui();
  const actives = L.filter(d => ['nouvelle', 'proposee', 'acceptee'].includes(d.statut) && d.date >= auj), autres = L.filter(d => !actives.includes(d));
  const kpi = (v, l, k = '') => `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const n = st => actives.filter(d => d.statut === st).length;
  const carte = d => { const [lib, k] = STATUTS_EVAL[d.statut] || [d.statut, 'neutral'], suit = suiveusesClasse(d.classe), cands = d.candidats || [], pos = cands.filter(c => c.positionne);
    const eleves = elevesClasse(d.classe).filter(e => affOf(e).some(x => x.heures > 0));
    const acts = d.statut === 'nouvelle' ? `<button class="btn primary sm" onclick="evalProposer('${d.id}')">Proposer aux AESH…</button> <button class="btn sm" onclick="evalRefuser('${d.id}')">Refuser</button>`
      : d.statut === 'proposee' ? `${pos.map(c => `<button class="btn primary sm" onclick="evalValider('${d.id}','${c.id}')">Valider ${esc(c.nom)}</button>`).join(' ') || '<span class="small muted">Aucune AESH positionnée pour l\'instant.</span>'} <button class="btn sm" onclick="evalElargir('${d.id}')" ${d.visibleA ? '' : 'disabled'}>Élargir à toute l'équipe</button> <button class="btn sm" onclick="evalRefuser('${d.id}')">Refuser</button> <button class="btn sm ghost" onclick="evalAnnuler('${d.id}')">Annuler</button>`
      : d.statut === 'acceptee' ? `<button class="btn sm" onclick="evalInfos('${d.id}')">${d.liberee ? 'Modifier l’élève et les aides' : 'Communiquer l’élève et les aides'}</button> <button class="btn sm ghost" onclick="evalAnnuler('${d.id}')">Annuler</button>` : '';
    return `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--${d.statut === 'nouvelle' ? 'bad' : d.statut === 'acceptee' ? 'ok' : 'warn'})"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><h2 style="margin:0">${jourDe(d.date)} ${frDate(d.date)} · ${hh(d.debut)}–${hh(d.fin)}</h2><span><span class="pill ${k}">${lib}</span>${d.liberee ? ' <span class="pill ok">infos élève communiquées</span>' : ''}</span></div>
      <div style="margin:4px 0"><b>${esc(d.type)}</b> · classe <b>${esc(d.classe)}</b> · salle <b>${esc(d.salle)}</b> · demandé par ${esc(d.profNom || d.prof)}${d.notifie ? ' · <span class="pill ok">élève notifié</span>' : ''}${d.commentaire ? ` <span class="muted">— « ${esc(d.commentaire)} »</span>` : ''}</div>
      <div class="small muted" style="margin:4px 0">${eleves.length ? 'Élèves suivis dans cette classe (visible de toi seule) : ' + eleves.map(e => `${esc(e.nom)} ${esc(e.prenom)}${libDisp(e) ? ' (' + libDisp(e) + ')' : ''} → ${affOf(e).filter(x => x.heures > 0).map(x => esc((aesh(x.aeshId) || {}).nom || '?')).join(', ')}`).join(' · ') : 'Aucun élève suivi par une AESH dans cette classe.'}</div>
      ${d.statut === 'proposee' ? `<div class="small" style="margin:4px 0">${d.visibleA ? `Proposée à ${d.visibleA.length} AESH (${d.visibleA.map(id => esc((aesh(id) || {}).nom || id)).join(', ')})` : 'Proposée à toute l\'équipe'} · ${pos.length} positionnée${pos.length > 1 ? 's' : ''}${pos.length ? ' : ' + pos.map(c => esc(c.nom) + (c.libre ? '' : ' (a cours : laisserait son élève)') + (c.suitClasse ? ' ★' : '')).join(', ') : ''}</div>` : ''}
      ${d.statut === 'acceptee' ? `<div class="small" style="margin:4px 0">AESH validée : <b>${esc((cands.find(c => c.id === d.aeshId) || aesh(d.aeshId) || {}).nom || d.aesh || '')}</b></div>` : ''}
      ${d.reponse ? `<div class="small muted">Réponse : ${esc(d.reponse)}</div>` : ''}<div class="no-print" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${acts}</div></div>`; };
  $('#page').innerHTML = `<div class="kpis" style="margin-bottom:14px">${kpi(n('nouvelle'), 'à traiter', n('nouvelle') ? 'bad' : 'ok')}${kpi(n('proposee'), 'proposées aux AESH', n('proposee') ? 'warn' : '')}${kpi(n('acceptee'), 'validées à venir', 'ok')}${kpi(L.length, 'demandes reçues')}</div>
    ${serveurOK() && evalsEtat.ok === false ? `<div class="card" style="margin-bottom:14px;border-left:4px solid var(--bad)"><b>L'appli en ligne ne répond pas</b> <span class="small">(${evalsEtat.le})</span><div class="small" style="margin:4px 0 8px">${esc(evalsEtat.msg)}</div><button class="btn sm" onclick="evalsActualiser()">Réessayer</button> <a class="btn sm" href="#/absences">Vérifier l'adresse et la clé</a></div>` : serveurOK() && evalsEtat.ok ? `<div class="small muted" style="margin-bottom:8px">✓ Appli en ligne reliée · actualisé à ${evalsEtat.le}</div>` : ''}
    ${serveurOK() ? '' : `<div class="card" style="margin-bottom:14px;border-left:4px solid var(--warn)"><b>Appli en ligne non reliée.</b> <span class="small muted">Les demandes des enseignant.e.s arriveront ici dès que l'adresse et la clé de l'appli en ligne sont saisies (Absences AESH → « Envoi automatique aux collègues »). En attendant tu peux charger un fichier téléchargé depuis l'appli en ligne : <label class="btn sm" style="cursor:pointer">Charger le fichier<input type="file" accept=".json" style="display:none" onchange="importerEvals(event)"></label></span></div>`}
    <p class="small muted" style="margin:0 0 10px">Fonctionnement : l'enseignant.e saisit sa demande dans l'appli en ligne (accusé de réception par mail, tu reçois la demande ici et par mail). Tu la <b>proposes</b> à toute l'équipe ou à certaines AESH (celles qui suivent la classe sont pré-cochées) ; elles se positionnent ; tu <b>valides</b> : mail à l'AESH et à l'enseignant.e, copie pour toi ; puis tu <b>communiques l'élève et les aides</b>. Mise à jour automatique toutes les 2 minutes.</p>
    ${actives.map(carte).join('') || '<div class="empty">Aucune demande en cours.</div>'}
    ${autres.length ? `<div class="card" style="margin-top:14px"><h2>Terminées, refusées ou passées <span class="pill neutral">${autres.length}</span></h2><table class="t compact"><tbody>${autres.slice(-15).reverse().map(d => `<tr><td class="small">${frDate(d.date)} ${hh(d.debut)}</td><td class="small">${esc(d.classe)} · ${esc(d.salle)}</td><td class="small">${esc(d.profNom || d.prof)}</td><td class="small">${esc((STATUTS_EVAL[d.statut] || [d.statut])[0])}${d.aesh ? ' · ' + esc(d.aesh) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
function pageAbsences() {
  S.prisesVues = (S.prisesOcc || []).map(p => p.occId); save(); majCompteurAbsences();
  setTitle('Absences AESH', `<button class="btn primary" onclick="declarerAbsence()">+ Déclarer une absence</button>`);
  const ouvertes = (S.absences || []).filter(x => x.ouvert), st = statsAbsences();
  const toutes = ouvertes.flatMap(ab => creneauxACouvrir(ab.aeshId)), pris = toutes.filter(c => c.remplacantId).length;
  const heuresACouvrir = toutes.filter(c => !c.remplacantId).reduce((t, c) => t + poidsCreneau(c.debut, c.fin) * c._dates.length, 0);
  const kpi = (v, l, k = '') => `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const cartes = ouvertes.map(ab => { const a = aesh(ab.aeshId); if (!a) return ''; const L = creneauxACouvrir(ab.aeshId), per = `${ab.debut ? 'du ' + frDate(ab.debut) : ''}${ab.fin ? ' au ' + frDate(ab.fin) : ' — fin à préciser'}`;
    const rows = L.map(cr => { const e = eleve(cr.eleveId), cand = candidatsRemplacement(cr);
      return `<tr><td class="small"><b>${cr._dates.slice(0, 4).map(dateCourte).join(', ')}${cr._dates.length > 4 ? ' …(+' + (cr._dates.length - 4) + ')' : ''}</b><br>${cr.debut}–${cr.fin}</td><td class="small">${classeHtml(e)}${sansNomEleve(cr.matiere) ? ' · <span class="muted">' + esc(sansNomEleve(cr.matiere)) + '</span>' : ''}</td><td class="small muted"><a href="#/eleves/${e.id}" style="color:inherit">${esc(e.nom)} ${esc(e.prenom)}</a></td>
        <td><select onchange="assignerRemplacant('${cr.id}',this.value)" style="min-width:230px"><option value="">— à couvrir —</option>${cand.map(c => `<option value="${c.id}" ${cr.remplacantId === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></td><td>${cr.remplacantId ? `<span class="pill ok">pris</span>${cr.remplacantDepuis ? `<div class="small muted">depuis le ${frDate(cr.remplacantDepuis.slice(0, 10))} à ${cr.remplacantDepuis.slice(11)}</div>` : ''}` : '<span class="pill warn">à couvrir</span>'}</td></tr>`; }).join('');
    const nbPris = L.filter(c => c.remplacantId).length;
    return `<div class="card" style="margin-bottom:14px;border-left:4px solid var(--warn)"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><h2 style="margin:0"><a href="#/aesh/${a.id}" style="color:inherit" title="Voir son emploi du temps et les remplaçant.e.s">${esc(a.nom)}</a> <span class="pill warn">${esc(ab.motif || a.statut)}</span> <span class="small muted">${per}</span></h2>
      <span class="no-print"><button class="btn sm primary" onclick="prevenirEquipe('${a.id}')">Prévenir l'équipe</button> <button class="btn sm" onclick="finAbsence('${a.id}')">Fin d'absence</button></span></div>
      <div class="small muted" style="margin:6px 0 8px">${nbPris} créneau${nbPris > 1 ? 'x' : ''} pris sur ${L.length}. Les propositions tiennent compte des disponibilités, des dispositifs (ULIS / SEGPA), des souhaits et de la quotité (✓ convient · ⚠ avec réserve · ✗ indisponible). 🔒 Une heure déjà passée ne peut plus être attribuée : la personne qui remplace n'est créditée que des cours qui commencent après le moment où le créneau est pris, et si on change de remplaçant.e, les cours déjà passés restent à la personne précédente. Le créneau pris apparaît sur l'EDT de ${esc(a.nom.split(' ')[0])} et sur la fiche de la personne qui remplace.</div>
      ${L.length ? `<table class="t compact"><thead><tr><th>Date(s) et horaire</th><th>Classe</th><th>Élève</th><th>Remplaçant.e</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted small">Aucun créneau touché par cette absence sur la période (vacances, semaine sans cours ou EDT non saisi).</div>'}</div>`; }).join('');
  const lignes = S.aesh.map(a => ({ a, s: st[a.id] || { nbAbs: 0, jours: 0, remplCr: 0, remplH: 0, extra: 0 } }));
  const maxRem = Math.max(0, ...lignes.map(x => x.s.remplH)), maxAbs = Math.max(0, ...lignes.map(x => x.s.jours));
  const compteurs = sortAesh(S.aesh).map(a => { const s2 = st[a.id] || { nbAbs: 0, jours: 0, remplCr: 0, remplH: 0, extra: 0 }, hs = compteurHS(a);
    return `<tr><td><a href="#/aesh/${a.id}" style="color:inherit;text-decoration:none"><span class="dot" style="background:${couleurAesh(a)}"></span> ${esc(a.nom)}</a></td><td class="num">${s2.nbAbs}</td><td class="num">${s2.jours ? s2.jours + ' j' : '—'}${maxAbs && s2.jours === maxAbs ? ' <span class="pill bad" title="Le plus d’absences">+ absences</span>' : ''}</td><td class="num">${s2.remplCr || '—'}</td><td class="num">${s2.remplH ? hf(s2.remplH) : '—'}${maxRem && s2.remplH === maxRem ? ' <span class="pill ok" title="Remplace le plus">+ remplace</span>' : ''}</td><td class="num">${s2.extra ? hf(s2.extra) : '—'}</td><td class="num"><b>${hs.solde ? hf(hs.solde) : '—'}</b></td></tr>`; }).join('');
  const histo = (S.absences || []).filter(x => !x.ouvert).slice().sort((p, q) => (q.debut || '').localeCompare(p.debut || '')).map(ab => { const a = aesh(ab.aeshId); return `<tr><td>${esc(a ? a.nom : '?')}</td><td>${esc(ab.motif || '')}</td><td>${ab.debut ? frDate(ab.debut) : '—'} → ${ab.fin ? frDate(ab.fin) : '—'}</td><td class="no-print" style="text-align:right"><button class="btn sm" onclick="modifierAbsence('${ab.id}')">Modifier</button></td></tr>`; }).join('');
  $('#page').innerHTML = `<div class="kpis" style="margin-bottom:14px">${kpi(ouvertes.length, 'absence' + (ouvertes.length > 1 ? 's' : '') + ' en cours', ouvertes.length ? 'warn' : 'ok')}${kpi(toutes.length - pris, 'créneaux à couvrir', toutes.length - pris ? 'bad' : 'ok')}${kpi(pris, 'créneaux pris', 'ok')}${kpi(hf(heuresACouvrir), 'heures à couvrir sur la période')}</div>
    ${cartes || '<div class="empty">Aucune absence en cours. Déclare une absence avec « + Déclarer une absence ».</div>'}
    <div class="card" style="margin-top:14px"><h2>Compteurs de l'équipe <span class="small muted">absences, remplacements et heures supplémentaires</span></h2>
      <table class="t compact"><thead><tr><th>AESH</th><th class="num">Absences</th><th class="num">Jours d'absence</th><th class="num">Créneaux remplacés</th><th class="num">Heures de remplacement</th><th class="num">Dont en plus de la quotité</th><th class="num">Heures sup. à récupérer</th></tr></thead><tbody>${compteurs}</tbody></table>
      <p class="small muted" style="margin:8px 0 0"><b>Comment lire :</b> les heures de remplacement comptent chaque semaine scolaire écoulée depuis la prise du créneau (vacances, jours fériés et semaines Q1 / Q2 respectés). Les heures faites au-delà de la quotité sont mises de côté dans le compteur d'heures supplémentaires de la fiche AESH, à récupérer plus tard.</p></div>
    ${histo ? `<div class="card" style="margin-top:14px"><h2>Absences terminées</h2><table class="t compact"><thead><tr><th>AESH</th><th>Motif</th><th>Période</th><th class="no-print"></th></tr></thead><tbody>${histo}</tbody></table></div>` : ''}
    ${(S.prisesOcc || []).length ? `<div class="card" style="margin-top:14px"><h2>Créneaux pris dans l'appli en ligne</h2><table class="t compact"><thead><tr><th>Date</th><th>Horaire</th><th>Absence de</th><th>Pris par</th><th>Pris le</th><th class="no-print"></th></tr></thead><tbody>${S.prisesOcc.slice().sort((x, y) => (y.date + y.debut).localeCompare(x.date + x.debut)).map(p => { const ab = aesh(p.absentId), r = aesh(p.remplacantId); return `<tr><td>${frDate(p.date)}</td><td>${hh(p.debut)}–${hh(p.fin)}</td><td>${esc(ab ? ab.nom : '?')}</td><td>${esc(r ? r.nom : '?')}${p.parCoordination ? ' <span class="pill warn">coordination</span>' : ''}</td><td class="small muted">${frDate(p.priseLe.slice(0, 10))} ${p.priseLe.slice(11)}</td><td class="no-print" style="text-align:right"><button class="btn sm" onclick="supprimerPriseOcc('${esc(p.occId)}')">Supprimer</button></td></tr>`; }).join('')}</tbody></table></div>` : ''}
    <div class="card no-print" style="margin-top:14px"><h2>Envoi automatique aux collègues <span class="pill ${S.serveur && S.serveur.url && S.serveur.cle ? 'ok' : 'neutral'}">${S.serveur && S.serveur.url && S.serveur.cle ? 'activé' : 'non configuré'}</span></h2><p class="small muted" style="margin:0 0 8px">Quand tu déclares une absence ici, Cockpit envoie les créneaux à l'appli en ligne, qui prévient <b>automatiquement par mail</b> les collègues pouvant en prendre un (une seule fois par absence) ; elles se positionnent ensuite dans l'appli. Il faut l'adresse de l'appli en ligne et la clé qui t'a été donnée à son installation (elle reste sur ce Mac).</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="srv-url" type="text" placeholder="Adresse de l'appli en ligne (https://…)" value="${esc((S.serveur || {}).url || '')}" style="flex:2;min-width:240px"><input id="srv-cle" type="password" placeholder="Clé" value="${esc((S.serveur || {}).cle || '')}" style="flex:1;min-width:140px"><button class="btn" onclick="serveurEnregistrer()">Enregistrer et vérifier</button><button class="btn" onclick="serveurEnregistrer().then(ok => ok && publierAuto(true))">Tester l'envoi</button></div><div id="srv-etat" class="small muted" style="margin-top:6px">${S.serveur && S.serveur.url ? 'Adresse enregistrée : ' + esc(S.serveur.url) : ''}</div></div>
    <div class="card no-print" style="margin-top:14px"><h2>Appli en ligne pour l'équipe</h2><p class="small muted" style="margin:0 0 8px">Les AESH se positionnent sur leur téléphone (appli en ligne, dossier « remplacements-en-ligne »). <b>1.</b> Publier : par défaut le fichier ne contient que <b>la classe, l'horaire et la matière</b> (aucune donnée d'élève ne quitte ton poste ; tu transmets les consignes toi-même). Si tu coches la case ci-dessous, le prénom et les consignes pratiques sont aussi envoyés au serveur, jamais montrés dans la liste, et le prénom n'est communiqué que si tu le décides (effacés le lendemain du cours). <b>2.</b> Récupérer les prises : fichier téléchargé dans la rubrique « Coordination » de l'appli en ligne. Pour l'équipe, un créneau dont l'heure de début est passée ne peut plus être pris ni annulé ; toi seule peux encore le modifier dans l'onglet Coordination (inscrit au journal). En attendant, « Prévenir l'équipe » reste possible.</p><label class="small" style="display:block;margin:0 0 8px"><input type="checkbox" ${S.pubApercu ? 'checked' : ''} onchange="pubApercu(this.checked)"> Inclure aussi le prénom et les consignes pratiques (sinon aucune donnée d'élève n'est publiée)</label><button class="btn" onclick="exporterACouvrir()">Publier vers l'appli en ligne (fichier)</button> <label class="btn" style="cursor:pointer">Récupérer les prises<input type="file" accept=".json" style="display:none" onchange="importerPrises(event)"></label></div>`;
}
function carteAbsencesAesh(a) {
  const s2 = statsAbsences()[a.id] || { nbAbs: 0, jours: 0, remplCr: 0, remplH: 0, extra: 0 }, hist = (S.absences || []).filter(x => x.aeshId === a.id).slice().sort((p, q) => (q.debut || '').localeCompare(p.debut || ''));
  const kp = (v, l, k = '') => `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  return `<div class="card" style="margin-top:14px"><h2>Absences et remplacements <a class="small" href="#/absences" style="font-weight:400">rubrique Absences →</a></h2>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">${kp(s2.nbAbs, 'absence' + (s2.nbAbs > 1 ? 's' : ''))}${kp(s2.jours ? s2.jours + ' j' : '0 j', "jours d'absence")}${kp(hf(s2.remplH), 'heures de remplacement faites', s2.remplH ? 'ok' : '')}${kp(hf(s2.extra), 'dont en plus de la quotité', s2.extra ? 'warn' : '')}</div>
    ${hist.length ? `<table class="t compact" style="margin-top:8px"><thead><tr><th>Motif</th><th>Période</th><th>État</th></tr></thead><tbody>${hist.map(ab => `<tr><td>${esc(ab.motif || '')}</td><td>${ab.debut ? frDate(ab.debut) : '—'} → ${ab.fin ? frDate(ab.fin) : '—'}</td><td>${ab.ouvert ? '<span class="pill warn">en cours</span>' : '<span class="pill neutral">terminée</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted" style="margin-top:6px">Aucune absence enregistrée.</div>'}</div>`;
}

/* ====================== ROUTER ====================== */
const routes = {
  questions: pageQuestions, evals: pageEvals, ess: pageEss, absences: pageAbsences, synthese: pageSynthese, planning: pagePlanning, classes: pageClasses, eleves: pageEleves, aesh: pageAesh,
  affectation: pageAffectation, dossiers: pageDossiers, archives: pageArchives, bibliotheque: pageBibliotheque, parametres: pageParametres, reperes: pageReperes, pps: pagePPS, 'synthese-aesh': pageSyntheseAesh, alertes: pageAlertes
};
const view = { planning: 'classe', planningSite: '', elevesFilter: {}, sort: 'classe', aeshSite: '', classeSite: '', aeshFicheType: '', semaine: '', alerteCat: '' };
window.toggleMenu = v => document.body.classList.toggle('menu-open', typeof v === 'boolean' ? v : !document.body.classList.contains('menu-open'));
function render() {
  const hash = location.hash || '#/synthese';
  const [, name, id] = hash.split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + name));
  document.querySelectorAll('#bottombar a').forEach(a => a.classList.toggle('on', a.dataset.r === name)); toggleMenu(false);
  $('#topactions').innerHTML = ''; majSemSel(); majCompteurAlertes();
  const ss = document.getElementById('savestate'); if (ss && !ss.textContent) ss.textContent = 'Données chargées';
  $('#brand-sub').textContent = (S.etablissement || 'Suivi AESH') + ' · ' + S.annee;
  const page = $('#page'); page.className = 'page';
  if (name === 'eleves' && id) { ficheEleve(id); return bandeauEss(); }
  if (name === 'aesh' && id) { ficheAesh(id); return bandeauEss(); }
  if (name === 'pps' && id) return pagePPSForm(id);
  (routes[name] || pageSynthese)();
  bandeauEss(); page.scrollTop = 0;
}
window.addEventListener('hashchange', render);
function setTitle(t, actions = '') { $('#title').textContent = t; $('#topactions').innerHTML = actions; }

/* ====================== SYNTHÈSE ====================== */
function pageSynthese() {
  setTitle('Synthèse');
  const g = stats(S.eleves), r = ressource();
  const hs = stats(S.eleves.filter(e => !['SEGPA', 'ULIS'].includes(dispositifDe(e)))); // heures à couvrir / couvertes : sans les élèves SEGPA ni ULIS du collège (leurs heures sont portées par les AESH du dispositif, comptées en collectif)
  const al = alertes();
  const kpi = (v, l, k = '', href = '') => href ? `<a href="${href}" class="kpi ${k}" style="text-decoration:none;color:inherit;cursor:pointer"><div class="v">${v}</div><div class="l">${l}</div></a>` : `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const classes = S.classes.slice().sort(cmpClasse).map(c => { const s = stats(elevesDe(c)); return { l: c.nom, h: '#/classes', segs: [{ v: s.couv, c: 'var(--ok)', t: 'couvert' }, { v: Math.max(0, s.reste), c: 'var(--bad)', t: 'reste' }, { v: s.prev, c: 'var(--warn)', t: 'prévisionnel' }], right: `${s.n} élève${s.n > 1 ? 's' : ''}` }; }).filter(x => x.right !== '0 élèves');
  const aeshRows = sortAesh(S.aesh).map(a => { const c = charge(a); return { l: a.nom, h: '#/aesh/' + a.id, max: a.quotite || 0, segs: [{ v: c.ind, c: 'var(--indiv)', t: 'individuel' }, { v: c.mut, c: 'var(--mutu)', t: 'mutualisé' }], right: a.quotite == null ? '? h' : `${hf(c.tot)} / ${a.quotite}` }; });
  const aeshResteRows = sortAesh(S.aesh).filter(a => a.quotite != null && !absente(a) && charge(a).reste > 0).sort((p, q) => charge(q).reste - charge(p).reste).map(a => { const c = charge(a); return { l: a.nom, h: '#/aesh/' + a.id, max: a.quotite, segs: [{ v: c.reste, c: 'var(--ok)', t: 'reste à combler' }], right: `${hf(c.reste)} à combler` }; });
  const bySite = SITES.map(s => { const st = stats(S.eleves.filter(e => e.site === s)), rs = ressource(s); return `<tr><td>${s}</td><td class="num">${st.n}</td><td class="num">${st.ind}</td><td class="num">${st.mut}</td><td class="num">${st.pending}</td><td class="num">${hf(st.cible)}</td><td class="num">${hf(st.couv)}</td><td class="num ${st.reste > 0 ? 'bad' : ''}">${hf(st.reste)}</td><td class="num">${rs.n}</td><td class="num">${hf(rs.vol)}</td><td class="num" style="color:${rs.reste < 0 ? 'var(--bad)' : 'var(--ok)'}">${hf(rs.reste)}</td></tr>`; }).join('');
  $('#page').innerHTML = `<div class="print-title">Synthèse PAS — ${esc(S.annee)}</div>
  <div class="kpis">
    ${kpi(g.n, 'élèves suivis', '', "javascript:gotoElevesType('')")}${kpi(g.ind, 'individuels', 'indiv', "javascript:gotoElevesType('Individuel')")}${kpi(g.mut, 'mutualisés', 'mutu', "javascript:gotoElevesType('Mutualisé')")}
    ${kpi(hf(S.aesh.filter(x => !absente(x) && x.quotite != null).reduce((t, x) => t + x.quotite, 0)), "volume horaire total disponible AESH / semaine", 'indiv')}${kpi(hf(hs.cible), "volume horaire total à couvrir / semaine (hors élèves SEGPA et ULIS)")}${kpi(hf(hs.couv), 'volume d\'heures couvertes (hors élèves SEGPA et ULIS)', hs.reste > 0 ? 'warn' : 'ok')}
    ${kpi(r.manq ? '?' : hf(r.reste), r.manq ? 'volume d\'heures restant disponible (quotités manquantes)' : 'volume d\'heures restant disponible', r.manq ? 'warn' : (r.reste < 0 ? 'bad' : 'ok'))}
  </div>
  <div class="grid g4" style="margin-bottom:14px">
    ${(() => { const L = S.aesh.filter(a => !absente(a) && a.quotite != null), C = L.map(a => charge(a)), som = f => C.reduce((t, c) => t + f(c), 0), vol = L.reduce((t, a) => t + a.quotite, 0);
      return `<div class="card"><h2>Volume horaire disponible AESH <span class="small muted">quotités de ${L.length} AESH${S.aesh.some(absente) ? ' (absentes exclues)' : ''}</span></h2>${donut([{ l: 'Individuel', v: som(c => c.ind), c: 'var(--indiv)' }, { l: 'Mutualisé', v: som(c => c.mut), c: 'var(--mutu)' }, ...(som(c => c.autres) ? [{ l: 'Collectif (ULIS / SEGPA)', v: som(c => c.autres), c: '#8A93A6' }] : []), { l: 'Encore disponible', v: som(c => Math.max(0, c.reste || 0)), c: '#E3E7ED' }], 150, hf(vol))}<p class="small muted" style="margin:6px 0 0">Au centre : total des quotités (${hf(vol)}). Heures utilisées : ${hf(som(c => c.tot))}.</p></div>`; })()}
    <div class="card"><h2>Heures par type d'accompagnement <span class="small muted">hors élèves SEGPA et ULIS · clic sur un segment pour voir les élèves</span></h2>${donut([{ l: 'Individuel', v: S.eleves.filter(e => isActive(e) && e.type === 'Individuel' && !['SEGPA', 'ULIS'].includes(dispositifDe(e))).reduce((s, e) => s + (e.heures || 0), 0), c: 'var(--indiv)', href: "javascript:gotoElevesType('Individuel')" }, { l: 'Mutualisé', v: S.eleves.filter(e => isActive(e) && e.type === 'Mutualisé' && !['SEGPA', 'ULIS'].includes(dispositifDe(e))).reduce((s, e) => s + (e.heures || 0), 0), c: 'var(--mutu)', href: "javascript:gotoElevesType('Mutualisé')" }, { l: 'Prévisionnel (dossiers)', v: g.prev, c: 'var(--warn)', href: "javascript:gotoElevesStatut(['Dossier renouvellement déposé AESHi','Dossier renouvellement déposé AESHm'])" }])}</div>
    <div class="card"><h2>Couverture des élèves <span class="small muted">clic sur un segment pour voir les élèves</span></h2>${donut([{ l: 'Couverts', v: g.n - g.nonCouv - g.partiel - g.adef, c: 'var(--ok)', href: "javascript:gotoElevesCouv(['Couvert','Sur-couvert','Suivi (sans cible)'])" }, { l: 'Partiels', v: g.partiel, c: 'var(--warn)', href: "javascript:gotoElevesCouv('Partiel')" }, { l: 'Non couverts', v: g.nonCouv, c: 'var(--bad)', href: "javascript:gotoElevesCouv('Non couvert')" }, { l: 'Sans cible définie', v: g.adef, c: '#B8C2CE', href: "javascript:gotoElevesCouv('À définir')" }])}</div>
    <div class="card"><h2>Alertes <span class="pill ${al.length ? 'bad' : 'ok'}">${al.length}</span> <a href="#/alertes" class="small" style="font-weight:400">Voir tout →</a></h2><ul class="alerts" style="list-style:none;padding:0;margin:0;max-height:170px;overflow:auto">${al.length ? al.slice(0, 30).map(a => `<li><span class="dot" style="background:var(--${a.k === 'warn' ? 'warn' : 'bad'})"></span><a href="${a.h}" style="text-decoration:none;color:var(--${a.k === 'warn' ? 'warn' : 'bad'})">${esc(a.t)}</a></li>`).join('') : '<li class="muted">Aucune alerte.</li>'}</ul></div>
  </div>
  <div class="grid g2" style="margin-bottom:14px">
    <div class="card"><h2>Heures par classe <span class="small muted">vert = couvert · rouge = reste · orange = prévisionnel</span></h2><div style="max-height:360px;overflow:auto">${hbars(classes, { lw: 110 })}</div></div>
    <div class="card"><h2>Charge des AESH <span class="small muted">violet = individuel · vert = mutualisé · trait = quotité</span></h2><div style="max-height:360px;overflow:auto">${hbars(aeshRows, { lw: 110 })}</div></div>
  </div>
  <div class="card" style="margin-bottom:14px"><h2>AESH avec des heures à combler <span class="small muted">clic sur un nom pour ouvrir sa fiche</span></h2>${aeshResteRows.length ? `<div style="max-height:300px;overflow:auto">${hbars(aeshResteRows, { lw: 110 })}</div>` : '<div class="empty">Aucun AESH n\'a de reste disponible.</div>'}</div>
  <div class="card"><h2>Par site</h2><table class="t"><thead><tr><th>Site</th><th class="num">Suivis</th><th class="num">Indiv.</th><th class="num">Mutu.</th><th class="num">Dossiers</th><th class="num">Cibles</th><th class="num">Couvertes</th><th class="num">Reste</th><th class="num">AESH</th><th class="num">Volume AESH</th><th class="num">Dispo</th></tr></thead><tbody>${bySite}</tbody></table></div>`;
}
function cmpClasse(a, b) { return SITES.indexOf(a.site) - SITES.indexOf(b.site) || NIVEAUX.indexOf(a.niveau) - NIVEAUX.indexOf(b.niveau) || a.nom.localeCompare(b.nom); }

/* ====================== PLANNING ====================== */
const RECRES = [['10:00', '10:15'], ['15:45', '16:00']];
function weekGrid(blocks, big = false, onclickFn = 'editCreneau', conflictIds = null, forceH = null) {
  if (view.semaine) blocks = blocks.filter(b => !b.groupe || b.groupe === view.semaine);
  const H = forceH || (big ? 520 : 150); const per = H / (H1 - H0);
  const hours = PERIODES.map(t => `<span style="top:${(t2m(t) - H0 * 60) / 60 * per}px">${t.replace(':', 'h')}</span>`);
  const recreBlocks = RECRES.map(([deb, fin]) => `<div class="recre" style="top:${(t2m(deb) - H0 * 60) / 60 * per}px;height:${(t2m(fin) - t2m(deb)) / 60 * per}px">${big ? 'récré' : ''}</div>`).join('');
  return `<div class="wk ${big ? 'big' : ''}" style="--h:${H}px"><div class="dh corner">Heures</div>${JOURS.map(j => `<div class="dh">${j}</div>`).join('')}<div class="dh corner">Heures</div>
  <div class="hours" style="--h:${H}px">${hours.join('')}</div>${JOURS.map((j, d) => { const dayBlocks = blocks.filter(b => b.jour === d + 1);
    const byTime = {}; dayBlocks.forEach(b => { const k = b.debut + '|' + b.fin; (byTime[k] = byTime[k] || []).push(b); });
    return `<div class="col" style="--h:${H}px">${recreBlocks}${dayBlocks.map(b => {
    const top = (t2m(b.debut) - H0 * 60) / 60 * per, h = (t2m(b.fin) - t2m(b.debut)) / 60 * per;
    const pair = byTime[b.debut + '|' + b.fin]; const isSplit = pair.length === 2;
    const isRight = isSplit && (b.groupe === 'Q2' || (b.groupe !== 'Q1' && pair.indexOf(b) === 1));
    const side = isSplit ? (isRight ? 'left:51%;right:2px' : 'left:2px;right:51%') : 'left:2px;right:2px';
    const cf = !isSplit && conflictIds && conflictIds.has(b.id);
    return `<div class="blk ${big ? 'big' : ''}${isSplit ? ' split' : ''}" style="${side};top:${top}px;height:${h - 2}px;background:${b.c};--c:${b.c};${cf ? 'outline:3px solid var(--bad);outline-offset:-3px' : ''}${b.remplace ? 'opacity:.5;border:2px dashed #fff' : ''}" title="${esc(b.title)}${cf ? ' ⚠ chevauchement' : ''}" onclick="${onclickFn}('${b.id}')">${cf ? '⚠ ' : ''}${esc(b.label)}${big && b.sub ? `<br><span style="opacity:.85">${esc(b.sub)}</span>` : ''}</div>`; }).join('')}</div>`; }).join('')}<div class="hours" style="--h:${H}px">${hours.join('')}</div></div>`;
}
const crBlock = (cr, mode) => { const e = eleve(cr.eleveId), a = aesh(cr.aeshId); if (!e || !a) return null; const g = cr.groupe ? ` (${cr.groupe})` : ''; const r = mode === 'aesh' && cr.remplacantId ? aesh(cr.remplacantId) : null; const rSuffix = r ? ` → remplacé par ${r.nom}` : ''; return { id: cr.id, jour: cr.jour, debut: cr.debut, fin: cr.fin, groupe: cr.groupe, remplace: !!r, c: classeColor(e.classe), title: `${e.nom} ${e.prenom} (${e.classe}${libDisp(e) ? ', ' + libDisp(e) : ''})${g} · ${a.nom} · ${cr.debut}-${cr.fin}${rSuffix}`, label: (mode === 'aesh' ? `${e.prenom} ${e.classe}` : mode === 'eleve' ? a.nom : `${ini(a)} · ${e.prenom}`) + g + (r ? ` ↪${ini(r)}` : '') }; };
function pagePlanning() {
  setTitle('Planning');
  const classesUtiles = [...new Set(S.creneaux.map(x => eleve(x.eleveId)?.classe).filter(Boolean))].sort();
  const legend = `<div class="legend">${classesUtiles.map(nom => `<span style="white-space:nowrap"><span class="dot" style="background:${classeColor(nom)}"></span>${esc(nom)}</span>`).join('') || '<span class="muted small">Couleur = classe de l\'élève</span>'}</div>`;
  const seg = `<div class="toolbar"><div class="seg">${['classe', 'aesh', 'eleve'].map(m => `<button class="${view.planning === m ? 'on' : ''}" onclick="setView('planning','${m}')">Par ${m === 'aesh' ? 'AESH' : m === 'eleve' ? 'élève' : m}</button>`).join('')}</div>
   <select onchange="setView('planningSite',this.value)"><option value="">Tous les sites</option>${SITES.map(s => `<option ${view.planningSite === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
   <span class="muted small">${S.creneaux.length} créneau${S.creneaux.length > 1 ? 'x' : ''} · consultation seule : clic sur un bloc ouvre la fiche (les modifications se font depuis la fiche élève ou la fiche AESH)</span></div>`;
  let body = '';
  if (!S.creneaux.length) body = `<div class="empty">Aucun créneau. Les créneaux se saisissent depuis la fiche élève ou la fiche AESH.</div>`;
  else if (view.planning === 'classe') {
    body = `<div class="pano">${S.classes.filter(c => !view.planningSite || c.site === view.planningSite).sort(cmpClasse).map(c => {
      const ids = elevesDe(c).map(e => e.id); const bl = S.creneaux.filter(x => ids.includes(x.eleveId)).map(x => crBlock(x, 'classe')).filter(Boolean);
      if (!bl.length) return ''; return `<div class="mini"><div class="h"><b>${esc(c.nom)}</b><span class="small muted">${ids.length} suivi${ids.length > 1 ? 's' : ''} · ${hf(dureeUnique(bl))}</span></div>${weekGrid(bl, false, 'voirFicheCreneau')}</div>`; }).join('')}</div>`;
  } else if (view.planning === 'aesh') {
    body = `<div class="pano">${sortAesh(S.aesh.filter(a => !view.planningSite || aeshSites(a).has(view.planningSite))).map(a => { const bl = S.creneaux.filter(x => x.aeshId === a.id).map(x => crBlock(x, 'aesh')).filter(Boolean); const c = charge(a);
      return `<div class="mini"><div class="h"><b style="white-space:nowrap"><span class="dot" style="background:${couleurAesh(a)}"></span>${esc(a.nom)}</b><span class="small muted">${hf(dureeUnique(bl))} planifiées / ${hf(c.tot)} affectées</span></div>${weekGrid(bl, false, 'voirFicheCreneau')}</div>`; }).join('')}</div>`;
  } else {
    body = `<div class="pano">${sortEleves(S.eleves.filter(e => isActive(e) && (!view.planningSite || e.site === view.planningSite))).map(e => { const bl = S.creneaux.filter(x => x.eleveId === e.id).map(x => crBlock(x, 'eleve')).filter(Boolean); if (!bl.length) return '';
      return `<div class="mini"><div class="h"><b><a href="#/eleves/${e.id}" style="text-decoration:none;color:inherit">${esc(e.nom)} ${esc(e.prenom)}</a> <span class="pill ${e.type === 'Individuel' ? 'indiv' : 'mutu'}">${e.classe}</span></b><span class="small muted">${hf(dureeUnique(bl))} / ${hf(e.heures)}</span></div>${weekGrid(bl, false, 'voirFicheCreneau')}</div>`; }).join('')}</div>`;
  }
  $('#page').innerHTML = `<div class="print-title">Planning — vue par ${view.planning}</div>${seg}${legend}${body}`;
}
window.voirFicheCreneau = id => { const c = S.creneaux.find(x => x.id === id); if (c) location.hash = view.planning === 'aesh' ? '#/aesh/' + c.aeshId : '#/eleves/' + c.eleveId; };
window.setView = (k, v) => { view[k] = v; render(); };
window.triValidite = () => { view.sort = view.sort === 'validite' ? 'validite-inv' : 'validite'; render(); };
function conflit(aeshId, eleveId, jour, d, f, ignoreId, groupe) {
  return S.creneaux.some(c => c.id !== ignoreId && c.jour === jour && (c.aeshId === aeshId || c.eleveId === eleveId) && t2m(c.debut) < f && t2m(c.fin) > d && semainesSeRecoupent(c, { groupe }));
}
window.proposerCreneaux = () => {
  if (!confirm('Générer des créneaux pour les affectations qui n\'en ont pas encore ? (les créneaux existants sont conservés)')) return;
  let n = 0;
  const affs = S.affectations.filter(a => a.heures > 0 && eleve(a.eleveId) && isActive(eleve(a.eleveId)) && aesh(a.aeshId));
  affs.sort((a, b) => b.heures - a.heures);
  for (const a of affs) {
    const done = S.creneaux.filter(c => c.eleveId === a.eleveId && c.aeshId === a.aeshId).reduce((s, c) => s + (t2m(c.fin) - t2m(c.debut)) / 60, 0);
    let rest = a.heures - done; if (rest <= 0) continue;
    const slots = []; for (const h of [8, 10, 14, 9, 13, 15, 11, 16]) for (const j of [1, 2, 4, 5, 3]) slots.push([j, h]);
    for (const [j, h] of slots) {
      if (rest <= 0) break;
      const len = Math.min(2, rest, (h < 12 ? 12 : 17) - h); if (len <= 0) continue;
      const d = h * 60, f = d + len * 60;
      if (conflit(a.aeshId, a.eleveId, j, d, f)) continue;
      S.creneaux.push({ id: uid('k'), eleveId: a.eleveId, aeshId: a.aeshId, jour: j, debut: m2t(d), fin: m2t(f) }); rest -= len; n++;
    }
  }
  commit('planning', `${n} créneaux proposés automatiquement`); toast(`${n} créneaux ajoutés`);
};
window.editCreneau = (id, presets = {}) => {
  const c = id ? S.creneaux.find(x => x.id === id) : { jour: 1, debut: '08:00', fin: '10:00', ...presets };
  modal(`<h2>${id ? 'Modifier' : 'Nouveau'} créneau</h2><div class="form-grid">
    <label class="f">Élève<select name="eleveId" onchange="majPropositions()">${sortEleves(S.eleves.filter(isActive)).map(e => `<option value="${e.id}" ${c.eleveId === e.id ? 'selected' : ''}>${esc(e.nom)} ${esc(e.prenom)} — ${e.classe}</option>`).join('')}</select></label>
    <label class="f">AESH<select name="aeshId" onchange="majPropositions()">${S.aesh.map(a => `<option value="${a.id}" ${c.aeshId === a.id ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select></label>
    <label class="f">Jour<select name="jour" onchange="majPropositions()">${JOURS.map((j, i) => `<option value="${i + 1}" ${c.jour === i + 1 ? 'selected' : ''}>${j}</option>`).join('')}</select></label>
    <label class="f">Début<input type="time" name="debut" value="${c.debut}" step="900" onchange="majPropositions()"></label>
    <label class="f">Fin<input type="time" name="fin" value="${c.fin}" step="900" onchange="majPropositions()"></label>
    <label class="f">Semaines<select name="groupe" onchange="majPropositions()"><option value="">Les deux (Q1 + Q2)</option><option value="Q1" ${c.groupe === 'Q1' ? 'selected' : ''}>Q1 seulement</option><option value="Q2" ${c.groupe === 'Q2' ? 'selected' : ''}>Q2 seulement</option></select></label></div>
    <h3 style="margin:14px 0 4px">AESH disponibles pour ce créneau</h3><p class="small muted" style="margin:0 0 6px"><b>Comment lire :</b> vert = convient, orange = possible avec une réserve, rouge = indisponible. Un clic sélectionne l'AESH ; rien n'est jamais bloqué.</p><div id="propositions" class="props"></div>`,
    (d) => {
      const jour = +d.jour, deb = t2m(d.debut), fin = t2m(d.fin);
      if (!d.eleveId || !d.aeshId) { alert('Choisis un élève et une AESH.'); return false; }
      if (!d.debut || !d.fin) { alert('Indique l\'heure de début et l\'heure de fin.'); return false; }
      if (fin <= deb) { alert('L\'heure de fin doit être après le début.'); return false; }
      if (conflit(d.aeshId, d.eleveId, jour, deb, fin, id, d.groupe) && !confirm('Conflit : l\'AESH ou l\'élève a déjà un créneau à ce moment. Enregistrer quand même ?')) return false;
      if (id) { Object.assign(c, { eleveId: d.eleveId, aeshId: d.aeshId, jour, debut: d.debut, fin: d.fin }); if (d.groupe) c.groupe = d.groupe; else delete c.groupe; } else S.creneaux.push({ id: uid('k'), eleveId: d.eleveId, aeshId: d.aeshId, jour, debut: d.debut, fin: d.fin, ...(d.groupe ? { groupe: d.groupe } : {}) });
      commit('planning', `Créneau ${id ? 'modifié' : 'ajouté'} : ${eleve(d.eleveId).nom} · ${aesh(d.aeshId).nom} · ${JOURS[jour - 1]} ${d.debut}-${d.fin}`);
    }, id ? () => { S.creneaux = S.creneaux.filter(x => x.id !== id); commit('planning', 'Créneau supprimé'); } : null);
  const fm = document.getElementById('mform'); if (fm) { if (id) fm.dataset.cid = id; majPropositions(); }
};

/* ====================== CLASSES ====================== */
function pageClasses() {
  setTitle('Classes');
  const list = S.classes.filter(c => !view.classeSite || c.site === view.classeSite).sort(cmpClasse);
  $('#page').innerHTML = `<div class="print-title">Classes</div><div class="toolbar"><div class="seg"><button class="${!view.classeSite ? 'on' : ''}" onclick="setView('classeSite','')">Tous</button>${SITES.map(s => `<button class="${view.classeSite === s ? 'on' : ''}" onclick="setView('classeSite','${s}')">${s}</button>`).join('')}</div>
  <span class="small muted">Mauve = individuel · vert = mutualisé · pointillé = dossier en cours · clic sur un élève ouvre sa fiche</span></div>
  <div class="grid g3">${list.map(c => { const el = sortEleves(elevesDe(c)).sort((a, b) => (a.type === 'Mutualisé' ? 1 : 0) - (b.type === 'Mutualisé' ? 1 : 0)); const s = stats(el); const cv = couverture; const aeshIds = [...new Set(S.affectations.filter(a => el.some(e => e.id === a.eleveId) && a.heures > 0).map(a => a.aeshId))];
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(c.nom)} <span class="small muted">${c.site}</span></h2><span class="small muted">${c.effectif ? s.n + ' / ' + c.effectif + ' élèves' : s.n + ' suivi' + (s.n > 1 ? 's' : '')} ${c.effectif ? '(' + pct(s.n, c.effectif) + ' %)' : ''}</span></div>
    <div style="margin:8px 0"><div class="gauge"><i class="${s.reste > 0 ? 'warn' : ''}" style="width:${s.cible ? pct(s.couv, s.cible) : 0}%"></i></div><div class="small muted" style="margin-top:3px">${hf(s.couv)} couvertes / ${hf(s.cible)} à couvrir${s.prev ? ' · +' + hf(s.prev) + ' prévisionnel' : ''}${s.pending ? ' · <span style="color:var(--warn)">' + s.pending + ' dossier' + (s.pending > 1 ? 's' : '') + '</span>' : ''}</div></div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">${el.map(e => `<span class="chip ${e.type === 'Individuel' ? 'indiv' : 'mutu'} ${isPending(e) ? 'pending' : ''}" onclick="location.hash='#/eleves/${e.id}'" title="${esc(e.statut)} · ${cv(e).l}">${esc(e.prenom)} ${esc(e.nom.slice(0, 1))}.${e.heures ? ' <b>' + e.heures + 'h</b>' : ''}</span>`).join('') || '<span class="muted small">Aucun élève suivi</span>'}</div>
    <div class="small muted" style="margin-top:8px">${aeshIds.length ? 'AESH : ' + aeshIds.map(id => `<span style="white-space:nowrap"><span class="dot" style="background:${couleurAesh(aesh(id))}"></span>${esc(aesh(id).nom)}</span>`).join(' ') : ''}</div></div>`; }).join('')}</div>`;
}
window.editClasse = id => {
  const c = id ? byId(S.classes, id) : { site: 'Collège', niveau: '6e', nom: '', effectif: null, pp: '' };
  modal(`<h2>${id ? 'Modifier la classe' : 'Nouvelle classe'}</h2><div class="form-grid">
    <label class="f">Nom<input type="text" name="nom" value="${esc(c.nom)}" required></label>
    <label class="f">Site<select name="site">${SITES.map(s => `<option ${c.site === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="f">Niveau<select name="niveau">${NIVEAUX.map(s => `<option ${c.niveau === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="f">Effectif<input type="number" name="effectif" value="${c.effectif ?? ''}"></label>
    <label class="f wide">Professeur principal<input type="text" name="pp" value="${esc(c.pp)}"></label></div>`,
    d => { if (!d.nom.trim()) { alert('Nom obligatoire'); return false; } const old = c.nom; Object.assign(c, { nom: d.nom.trim(), site: d.site, niveau: d.niveau, effectif: num(d.effectif), pp: d.pp });
      if (!id) S.classes.push({ id: uid('c'), ...c }); else if (old !== c.nom) S.eleves.forEach(e => { if (e.classe === old) e.classe = c.nom; });
      commit('classe', `Classe ${id ? 'modifiée' : 'créée'} : ${c.nom}`); },
    id ? () => { if (elevesDe(c).length && !confirm('Des élèves sont rattachés à cette classe. Supprimer quand même ?')) return; S.classes = S.classes.filter(x => x.id !== id); commit('classe', `Classe supprimée : ${c.nom}`); } : null);
};

/* ====================== ÉLÈVES ====================== */
function pageEleves() {
  setTitle('Élèves', `<button class="btn" onclick="exportWordListe()">Word (liste)</button> <button class="btn primary" onclick="editEleve()">+ Élève</button>`);
  const f = view.elevesFilter; const q = (f.q || '').toLowerCase();
  let list = S.eleves.filter(e => (f.archive ? true : !e.archive) && (!f.site || e.site === f.site) && (!f.type || e.type === f.type) && (!f.statut || (f.statut === 'pending' ? isPending(e) : Array.isArray(f.statut) ? f.statut.includes(e.statut) : e.statut === f.statut)) && (!f.couv || (Array.isArray(f.couv) ? f.couv.includes(couverture(e).l) : couverture(e).l === f.couv)) && (!f.aesh || affOf(e).some(a => a.aeshId === f.aesh && a.heures > 0)) && (!q || `${e.nom} ${e.prenom} ${e.classe}`.toLowerCase().includes(q)));
  if (view.sort === 'niveau') list = list.slice().sort((a, b) => NIVEAUX.indexOf(a.niveau) - NIVEAUX.indexOf(b.niveau) || a.nom.localeCompare(b.nom, 'fr'));
  else if (view.sort === 'nom') list = list.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  else if (view.sort === 'type') list = sortEleves(list).sort((a, b) => (a.type === 'Mutualisé' ? 1 : 0) - (b.type === 'Mutualisé' ? 1 : 0));
  else if (view.sort === 'validite' || view.sort === 'validite-inv') { // validité de la notification : en cours (échéance la plus proche d'abord), puis périmées (la plus récente d'abord), puis sans date
    const auj = aujourdhui(), r = e => !e.notifFin ? 2 : e.notifFin >= auj ? 0 : 1, inv = view.sort === 'validite-inv';
    list = sortEleves(list).sort((a, b) => { const ra = r(a), rb = r(b); if (ra !== rb) return ra === 2 ? 1 : rb === 2 ? -1 : inv ? rb - ra : ra - rb; return ra === 0 ? a.notifFin.localeCompare(b.notifFin) : ra === 1 ? b.notifFin.localeCompare(a.notifFin) : 0; }); }
  else if (view.sort === 'statut') list = sortEleves(list).sort((a, b) => (isPending(a) ? 0 : 1) - (isPending(b) ? 0 : 1));
  else if (view.sort === 'couv') { const rang = { 'Non couvert': 0, 'Sur-couvert': 1, 'Partiel': 2, 'À définir': 3, 'Suivi (sans cible)': 4, 'Couvert': 5 }; list = sortEleves(list).sort((a, b) => rang[couverture(a).l] - rang[couverture(b).l]); }
  else if (view.sort === 'aesh') { const first = e => affOf(e).filter(x => x.heures > 0).map(x => aesh(x.aeshId)?.nom).filter(Boolean).sort()[0] || '';
    list = sortEleves(list).sort((a, b) => { const an = first(a), bn = first(b); if (!an && bn) return -1; if (an && !bn) return 1; return an.localeCompare(bn, 'fr'); }); }
  else list = sortEleves(list);
  view.ordre = list.map(e => e.id); // ordre de la liste affichée : sert aux flèches « élève précédent / suivant » des fiches
  const sel = (name, opts, cur, all) => `<select onchange="setFilter('${name}',this.value)"><option value="">${all}</option>${opts.map(o => `<option value="${o[0]}" ${cur === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  $('#page').innerHTML = `<div class="print-title">Élèves suivis</div><div class="toolbar">
    <input type="search" placeholder="Rechercher nom, prénom, classe…" value="${esc(f.q || '')}" oninput="setFilter('q',this.value)">
    ${sel('site', SITES.map(s => [s, s]), f.site, 'Tous sites')}${sel('type', [['Individuel', 'Individuel'], ['Mutualisé', 'Mutualisé']], f.type, 'Tous types')}
    ${sel('statut', [['pending', '⏳ Dossiers en cours'], ...STATUTS.map(s => [s, s])], f.statut, 'Tous statuts')}
    ${sel('couv', ['Couvert', 'Partiel', 'Non couvert', 'À définir', 'Suivi (sans cible)', 'Sur-couvert'].map(s => [s, s]), f.couv, 'Toute couverture')}
    ${sel('aesh', S.aesh.map(a => [a.id, a.nom]), f.aesh, 'Tous AESH')}
    <label class="small"><input type="checkbox" ${f.archive ? 'checked' : ''} onchange="setFilter('archive',this.checked)"> archivés</label>
    <span class="muted small">${list.length} élève${list.length > 1 ? 's' : ''}</span></div>
    <div class="small muted" style="margin:-6px 0 10px">Mauve = individuel · vert = mutualisé · clic sur un élève ouvre sa fiche</div>
  <div class="table-wrap"><table class="t compact"><thead><tr><th>#</th><th style="cursor:pointer" title="Trier par ordre alphabétique" onclick="setView('sort','nom')">Élève</th><th style="cursor:pointer" title="Trier par classe" onclick="setView('sort','classe')">Classe</th><th>Site</th><th style="cursor:pointer" title="Trier : individuel puis mutualisé" onclick="setView('sort','type')">Type</th><th style="cursor:pointer" title="Trier : en attente puis notifiés" onclick="setView('sort','statut')">Statut du dossier MDPH</th><th style="cursor:pointer" title="Trier : validité en cours (échéance la plus proche d'abord), puis périmées. Un second clic met les périmées en premier." onclick="triValidite()">Date de validité ${view.sort === 'validite' ? '▲' : view.sort === 'validite-inv' ? '▼' : ''}</th><th class="num">Nombre d'heures à couvrir</th><th style="cursor:pointer" title="Trier par AESH (élèves non couverts d'abord)" onclick="setView('sort','aesh')">AESH</th><th class="num" title="Heures couvertes par chaque AESH, dans le même ordre">Heures couvertes</th><th style="cursor:pointer" title="Trier : non couverts et sur-couverts d'abord" onclick="setView('sort','couv')">Couverture</th><th>GEVASCO</th><th>MOPPS</th><th>EDT</th></tr></thead><tbody>
  ${list.map((e, i) => { const c = couverture(e); const affs = affOf(e).filter(a => a.heures > 0).map(a => ({ a: aesh(a.aeshId), aeshId: a.aeshId, heures: a.heures })).filter(x => x.a); const as = affs.map(x => x.a);
    const joursAvant = e.notifFin ? (new Date(e.notifFin) - Date.now()) / 864e5 : null; const aRenouveler = joursAvant != null && joursAvant < 270;
    return `<tr class="row ${['SEGPA', 'Lycée GT', 'BTS'].includes(e.site) || /BTS/i.test(e.classe || '') ? 'pole-gris' : ''}" onclick="location.hash='#/eleves/${e.id}'"><td class="muted">${i + 1}</td><td><b>${esc(e.nom)}</b> ${esc(e.prenom)}${e.archive ? ' <span class="pill neutral">archivé</span>' : ''}</td><td>${esc(e.classe)}</td><td class="muted">${e.site}</td><td><span class="pill ${e.type === 'Individuel' ? 'indiv' : 'mutu'}">${e.type}</span></td><td><span class="pill ${isPending(e) ? 'warn' : 'neutral'}">${esc(statutTxt(e))}</span></td><td class="small" style="${aRenouveler ? 'background:var(--bad-soft);color:var(--bad);font-weight:600;border-radius:6px' : ''}" title="${aRenouveler ? 'À renouveler : moins de 9 mois avant la fin de notification' : ''}" onclick="event.stopPropagation()"><div style="display:flex;flex-direction:column;gap:2px"><span title="Début notification">${dateFr(e.notifDebut)}</span><span title="Fin notification">${dateFr(e.notifFin)}</span>${pastilleValidite(e, true)}</div></td><td class="num">${e.heures == null ? '—' : hf(e.heures)}</td><td><div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;line-height:1.4">${affs.map(x => `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap"><span class="dot" style="background:${couleurAesh(x.a)};flex:none"></span>${esc(x.a.nom)}</div>`).join('') || '<span class="muted small">—</span>'}</div></td><td class="num"><div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end;line-height:1.4">${affs.map(x => `<b>${hf(x.heures)}</b>`).join('') || '<span class="muted small">—</span>'}</div></td><td><span class="pill ${c.k}">${c.l}</span></td><td class="small" style="white-space:nowrap" onclick="event.stopPropagation()">${lienDoc(e, 'GEVASCO', 'GEVASCO')}${(e.gevasco || e.gevascoDate) ? ` <span class="muted" title="${e.gevasco ? 'Validité du GEVASCO' : 'Dernière réunion GEVASCO'}">· ${new Date(e.gevasco || e.gevascoDate).toLocaleDateString('fr-FR')}</span>` : ''}</td><td class="small" onclick="event.stopPropagation()">${lienDoc(e, 'MOPPS', 'MOPPS')}</td><td class="small"><a href="#/eleves/${e.id}" onclick="event.stopPropagation()">EDT</a></td></tr>`; }).join('') || '<tr><td colspan="14" class="muted">Aucun élève ne correspond aux filtres.</td></tr>'}
  </tbody></table></div>`;
}
window.setFilter = (k, v) => { view.elevesFilter[k] = v; render(); const s = $('.toolbar input[type=search]'); if (k === 'q' && s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
window.gotoElevesCouv = couv => { view.elevesFilter = { couv }; view.sort = 'niveau'; location.hash = '#/eleves'; };
window.gotoElevesType = type => { view.elevesFilter = type ? { type } : {}; view.sort = 'niveau'; location.hash = '#/eleves'; };
window.gotoElevesStatut = statut => { view.elevesFilter = { statut }; view.sort = 'niveau'; location.hash = '#/eleves'; };

function eleveForm(e) {
  const opt = (arr, cur) => arr.map(s => `<option ${cur === s ? 'selected' : ''}>${s}</option>`).join('');
  return `<div class="form-grid">
    <label class="f">Nom<input type="text" name="nom" value="${esc(e.nom)}" required></label>
    <label class="f">Prénom<input type="text" name="prenom" value="${esc(e.prenom)}"></label>
    <label class="f">Classe<input type="text" name="classe" list="classes-dl" value="${esc(e.classe)}"><datalist id="classes-dl">${S.classes.map(c => `<option value="${esc(c.nom)}">`).join('')}</datalist></label>
    <label class="f">Site<select name="site">${opt(SITES, e.site)}</select></label>
    <label class="f">Niveau<select name="niveau">${opt(NIVEAUX, e.niveau)}</select></label>
    <label class="f">Type d'accompagnement<select name="type">${opt(['Individuel', 'Mutualisé'], e.type)}</select></label>
    <label class="f">Dispositif <span class="small muted">un élève ULIS ou SEGPA n'est suivi que par les AESH de ce dispositif</span><select name="dispositif"><option value="">Aucun (en ordinaire)</option>${DISPOSITIFS.map(x => `<option ${dispositifDe(e) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="f">Statut du dossier<select name="statut">${opt(STATUTS, e.statut)}</select></label>
    <label class="f">Nombre d'heures à couvrir${champH('name="heures"', e.heures)}</label>
    <label class="f">Heures prévisionnelles (si dossier accepté)${champH('name="heuresPrev"', e.heuresPrev)}</label>
    <label class="f">N° dossier MDPH<input type="text" name="numDossier" value="${esc(e.numDossier)}"></label>
    <label class="f">Début notification<input type="date" name="notifDebut" value="${e.notifDebut || ''}"></label>
    <label class="f">Fin notification<input type="date" name="notifFin" value="${e.notifFin || ''}"></label>
    <label class="f">Validité GEVASCO<input type="date" name="gevasco" value="${e.gevasco || ''}"></label>
    <label class="f">Professeur principal<input type="text" name="pp" value="${esc(e.pp)}"></label>
    <label class="f wide">Adresse<input type="text" name="adresse" value="${esc(e.adresse)}"></label>
    <label class="f">Responsables légaux<input type="text" name="responsables" value="${esc(e.responsables)}"></label>
    <label class="f">Téléphone<input type="text" name="tel" value="${esc(e.tel)}"></label>
    <label class="f">E-mail<input type="text" name="email" value="${esc(e.email)}"></label>
    <label class="f wide">Remarques<textarea name="remarques">${esc(e.remarques)}</textarea></label></div>`;
}
window.editEleve = (id, presets = {}) => {
  const e = id ? eleve(id) : { nom: '', prenom: '', classe: '', site: 'Collège', niveau: '6e', type: 'Mutualisé', statut: 'Notifié', heures: null, heuresPrev: null, gevasco: '', adresse: '', responsables: '', tel: '', email: '', pp: '', notifDebut: '', notifFin: '', numDossier: '', remarques: '', archive: false, ...presets };
  modal(`<h2>${id ? 'Modifier ' + esc(e.prenom) + ' ' + esc(e.nom) : 'Nouvel élève'}</h2>${eleveForm(e)}`, d => {
    if (!d.nom.trim()) { alert('Nom obligatoire'); return false; }
    if (Number.isNaN(num(d.heures)) || Number.isNaN(num(d.heuresPrev))) { alert(H_ILLISIBLE); return false; }
    const obj = { ...e, ...d, nom: d.nom.trim().toUpperCase(), heures: num(d.heures), heuresPrev: num(d.heuresPrev) };
    if (obj.classe && !S.classes.some(c => c.nom === obj.classe)) S.classes.push({ id: uid('c'), site: obj.site, niveau: obj.niveau, nom: obj.classe, effectif: null, pp: '' });
    if (id) { CHAMPS_DOSSIER.forEach(c => { if (obj[c] !== undefined && String(e[c] ?? '') !== String(obj[c] ?? '')) { (e.manuel = e.manuel || {})[c] = true; if (e.auto) delete e.auto[c]; } }); if (obj.statut !== e.statut) e.statutManuel = true;
      const avant = dispositifDe(e); const chg = ['statut', 'type', 'heures', 'classe', 'dispositif'].filter(k => String(e[k] ?? '') !== String(obj[k] ?? '')).map(k => `${k} : ${e[k] ?? '—'} → ${obj[k] ?? '—'}`); Object.assign(e, obj);
      // l'élève quitte son dispositif : il devient un élève ordinaire et perd les AESH de ce dispositif (il faudra lui en attribuer)
      if (e.dispositif === '' && (e.site === 'SEGPA' || e.site === 'ULIS')) e.site = 'Collège';
      let perdu = '';
      if (avant && dispositifDe(e) !== avant) { const gone = S.affectations.filter(x => x.eleveId === e.id && aesh(x.aeshId)?.dispositif === avant); S.affectations = S.affectations.filter(x => !gone.includes(x)); perdu = gone.length ? ` — quitte ${avant} : ${gone.map(x => aesh(x.aeshId).nom).join(', ')} retirée${gone.length > 1 ? 's' : ''}, AESH à attribuer` : ` — quitte ${avant}`; }
      synchroDispositifs(); commit('eleve', `${e.nom} ${e.prenom} modifié${chg.length ? ' (' + chg.join(', ') + ')' : ''}${perdu}`); }
    else { obj.id = uid('e'); S.eleves.push(obj); synchroDispositifs(); commit('eleve', `Élève ajouté : ${obj.nom} ${obj.prenom} (${obj.classe}, ${obj.type}, ${obj.statut})`); location.hash = '#/eleves/' + obj.id; }
  });
};
// navigation entre fiches : suit l'ordre de la liste Élèves telle qu'elle est affichée (tri et filtres), sinon l'ordre par défaut
const ordreEleves = id => (view.ordre && view.ordre.includes(id) ? view.ordre.filter(i => eleve(i)) : sortEleves(S.eleves.filter(e => !e.archive)).map(e => e.id));
window.eleveVoisin = d => { const id = location.hash.split('/')[2], o = ordreEleves(id), i = o.indexOf(id); if (!o.length) return; location.hash = '#/eleves/' + o[(i + d + o.length) % o.length]; };
window.rechercheEleve = () => {
  const ex = document.getElementById('recherche-eleve'); if (ex) { ex.remove(); return; }
  const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const p = document.createElement('div'); p.id = 'recherche-eleve'; p.className = 'no-print';
  p.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);width:min(440px,92vw);z-index:70;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:10px';
  p.innerHTML = '<input type="search" id="re-q" placeholder="Nom, prénom ou classe…" autocomplete="off" style="width:100%"><div id="re-res" style="margin-top:6px;max-height:50vh;overflow:auto"></div>';
  document.body.appendChild(p); const q = p.querySelector('#re-q'), res = p.querySelector('#re-res');
  const fermer = () => { p.remove(); document.removeEventListener('mousedown', dehors, true); };
  const dehors = ev => { if (!p.contains(ev.target) && !ev.target.closest('[aria-label="Chercher un élève"]')) fermer(); };
  const aller = id => { fermer(); location.hash = '#/eleves/' + id; };
  const maj = () => {
    const mots = norm(q.value).split(/\s+/).filter(Boolean);
    const L = S.eleves.filter(e => !e.archive && mots.every(m => norm(e.nom + ' ' + e.prenom + ' ' + e.classe + ' ' + libDisp(e)).includes(m))).sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr')).slice(0, 15);
    res.innerHTML = L.map((e, i) => `<div data-id="${e.id}" class="re-item" style="padding:7px 8px;border-radius:8px;cursor:pointer;${i === 0 && mots.length ? 'background:var(--bg-soft,#EEF2F7)' : ''}"><b>${esc(e.nom)}</b> ${esc(e.prenom)} <span class="small muted">· ${esc(e.classe)}${libDisp(e) ? ' ' + libDisp(e) : ''}</span></div>`).join('') || '<div class="small muted" style="padding:6px">Aucun élève trouvé.</div>';
    res.querySelectorAll('.re-item').forEach(d => d.onclick = () => aller(d.dataset.id));
  };
  q.oninput = maj; q.onkeydown = ev => { if (ev.key === 'Escape') fermer(); if (ev.key === 'Enter') { const d = res.querySelector('.re-item'); if (d) aller(d.dataset.id); } };
  document.addEventListener('mousedown', dehors, true); maj(); q.focus();
};
function ficheEleve(id) {
  const e = eleve(id); if (!e) { location.hash = '#/eleves'; return; }
  setTitle(`${e.nom} ${e.prenom}`, `<a class="btn" href="#/pps/${id}">Document PPS</a> <button class="btn" onclick="exportWordEleve('${id}')">Word</button> <button class="btn" onclick="editEleve('${id}')">Modifier</button> <button class="btn ${e.archive ? '' : 'danger'}" onclick="archiverEleve('${id}')">${e.archive ? 'Restaurer' : 'Archiver'}</button>`);
  const c = couverture(e); const affs = affOf(e); const bl = S.creneaux.filter(x => x.eleveId === id).map(x => crBlock(x, 'eleve')).filter(Boolean);
  const hist = S.journal.filter(j => j.texte.includes(e.nom)).slice(0, 12);
  const row = (k, v) => `<dt>${k}</dt><dd>${v || '<span class="muted">—</span>'}</dd>`;
  const ed = (k, field, kind = 'text', opts = []) => { const v = e[field]; const disp = v == null || v === '' ? '<span class="muted">— cliquer pour saisir</span>' : kind === 'date' ? new Date(v).toLocaleDateString('fr-FR') : kind === 'number' ? hf(v) : esc(v);
    return `<dt>${k}</dt><dd class="ed" data-f="${field}" title="${e.auto && e.auto[field] ? 'Relevé automatiquement dans : ' + esc(e.auto[field]) + ' — cliquer pour modifier' : 'Cliquer pour modifier'}" onclick="inlineEdit('${id}','${field}','${kind}',${JSON.stringify(opts).replace(/"/g, '&quot;')})">${disp}</dd>`; };
  const ordre = ordreEleves(id), pos = ordre.indexOf(id) + 1;
  $('#page').innerHTML = `<div class="no-print" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn sm btn-back" onclick="location.hash='#/eleves'">← Retour</button><button class="btn sm" onclick="eleveVoisin(-1)" title="Élève précédent" aria-label="Élève précédent">‹</button><span class="small muted" title="Position dans la liste des élèves">${pos || '–'} / ${ordre.length}</span><button class="btn sm" onclick="eleveVoisin(1)" title="Élève suivant" aria-label="Élève suivant">›</button><button class="btn sm" onclick="rechercheEleve()" title="Chercher un élève" aria-label="Chercher un élève">🔍</button></div><div class="print-title">Fiche élève — ${esc(e.nom)} ${esc(e.prenom)}</div>
  <div class="fiche-head"><div class="avatar" style="background:var(--${e.type === 'Individuel' ? 'indiv' : 'mutu'})">${esc(e.prenom[0] || '')}${esc(e.nom[0] || '')}</div>
   <div><div style="font-size:18px;font-weight:650">${esc(e.nom)} ${esc(e.prenom)} <span class="pill ${e.type === 'Individuel' ? 'indiv' : 'mutu'}">${e.type}</span> <span class="pill ${isPending(e) ? 'warn' : 'neutral'}">${esc(statutTxt(e))}</span> ${pastilleValidite(e)} <span class="pill ${c.k}">${c.l}</span>${e.archive ? ' <span class="pill neutral">archivé</span>' : ''}</div>
   <div class="muted">${esc(e.classe)} · ${e.site}${dispositifDe(e) ? ' · <b>dispositif ' + dispositifDe(e) + '</b>' : ''} · ${e.niveau}${e.pp ? ' · PP : ' + esc(e.pp) : ''}</div></div></div>
  <div class="grid g3">
   <div class="card"><h2>Identité <span class="small muted" style="font-weight:400">cliquer sur une valeur pour la modifier</span></h2><dl class="dl">${ed('Adresse', 'adresse')}${ed('Responsables', 'responsables')}${ed('Téléphone', 'tel')}${ed('E-mail', 'email')}${ed('N° dossier MDPH', 'numDossier')}${ed('Enseignant référent', 'enseignantReferent')}${ed('Professeur principal', 'pp')}${ed('Classe', 'classe')}</dl></div>
   <div class="card"><h2>Notification</h2><dl class="dl">${ed('Type', 'type', 'select', ['Individuel', 'Mutualisé'])}${ed('Statut', 'statut', 'select', STATUTS)}${statutNote(e)}${/déposé/.test(e.statut || '') ? ed('Dossier déposé le', 'depotDate', 'date') : ''}${ed("Nombre d'heures à couvrir", 'heures', 'number')}${ed('Prévisionnel', 'heuresPrev', 'number')}${ed('Début notification', 'notifDebut', 'date')}${ed('Fin notification', 'notifFin', 'date')}${pastilleValidite(e) ? '<dt>Validité</dt><dd>' + pastilleValidite(e) + '</dd>' : ''}${ed('GEVASCO (validité)', 'gevasco', 'date')}${ed('Dernière réunion GEVASCO', 'gevascoDate', 'date')}${ed('ESS : date', 'essDate', 'date')}${ed('ESS : heure', 'essHeure', 'time')}${ed('ESS : salle', 'essSalle')}${e.essNote && !e.essDate ? ed('ESS : situation', 'essNote') : ''}</dl>
    <div style="margin-top:10px"><div class="gauge"><i class="${c.k === 'ok' ? '' : c.k}" style="width:${e.heures ? Math.min(100, pct(couvertes(e), e.heures)) : (couvertes(e) ? 100 : 0)}%"></i></div><div class="small muted" style="margin-top:3px">${hf(couvertes(e))} affectées${e.heures ? ' sur ' + hf(e.heures) : ''}</div></div></div>
   <div class="card"><h2>AESH affectés</h2><div class="aff-list" id="afflist">${affs.map(a => { const x = aesh(a.aeshId); return x ? `<div class="aff-item"><span style="white-space:nowrap"><span class="dot" style="background:${couleurAesh(x)}"></span><a href="#/aesh/${x.id}">${esc(x.nom)}</a>${a.aConfirmer ? ` <button type="button" class="pill warn" style="border:0;cursor:pointer;font:inherit;font-weight:600" title="Cliquer pour confirmer cette répartition" onclick="confirmerAff('${e.id}','${x.id}')">à confirmer</button>` : ''}</span>${champH(`onchange="setAff('${e.id}','${x.id}',this.value)"`, a.heures ?? 0)}<button class="btn sm ghost" onclick="setAff('${e.id}','${x.id}','')" title="Retirer">✕</button></div>` : ''; }).join('') || '<span class="muted small">Aucun AESH.</span>'}</div>
    <div class="toolbar no-print" style="margin:10px 0 0"><select id="addaesh" style="width:auto">${S.aesh.filter(a => !affs.some(x => x.aeshId === a.id)).map(a => `<option value="${a.id}">${esc(a.nom)} (${charge(a).reste == null ? '?' : charge(a).reste + ' h dispo'})</option>`).join('')}</select><button class="btn sm" onclick="setAff('${e.id}',document.getElementById('addaesh').value,0);">+ Ajouter</button></div>
    <h3 style="margin-top:12px">Remarques / notes</h3><dl class="dl" style="grid-template-columns:1fr"><dd class="ed" data-f="remarques" onclick="inlineEdit('${id}','remarques','textarea',[])" title="Cliquer pour modifier">${e.remarques ? esc(e.remarques).replace(/\n/g, '<br>') : '<span class="muted">— cliquer pour ajouter une note</span>'}</dd></dl></div>
  </div>
  ${(() => { const sum = ppsSummary(e, e.niveau); const m = e.mopps; if (!sum.length && !(m && (m.aeshType || m.aeshActivites.length))) return `<div class="card" style="margin-top:14px"><h2>Aménagements PPS retenus <span class="small muted">niveau ${e.niveau}</span></h2><div class="muted small">Aucun aménagement coché pour ce niveau. <a href="#/pps/${id}">Ouvrir le document de mise en œuvre</a>.</div></div>`;
    return `<div class="card" style="margin-top:14px"><h2>Aménagements PPS retenus <span class="small muted">niveau ${e.niveau} · ${sum.reduce((s, x) => s + x.items.length, 0)} items</span> <a class="btn sm no-print" style="float:right" href="#/pps/${id}">Modifier</a></h2>
    ${m && m.aeshType ? `<p class="small" style="margin:0 0 8px"><b>Aide humaine :</b> ${esc(m.aeshType)}${m.aeshHeures ? ' · ' + esc(m.aeshHeures) + ' h' : ''}${m.aeshPct ? ' · ' + esc(m.aeshPct) + ' %' : ''}${m.aeshActivites.length ? ' · ' + m.aeshActivites.length + ' activités prescrites' : ''}</p>` : ''}
    <div class="pps-sum">${sum.map(s => `<div><h3>${esc(s.titre)}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}${s.autre ? `<li><i>${esc(s.autre)}</i></li>` : ''}</ul></div>`).join('')}</div></div>`; })()}
  ${carteDecisions(e)}${carteProfil(e)}${carteDocuments(e)}
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><h2>Emploi du temps d'accompagnement <button class="btn sm no-print" style="float:right" onclick="editCreneau(null,{eleveId:'${id}',aeshId:'${affs[0]?.aeshId || ''}'})">+ Créneau</button></h2>${(() => { const cf = chevauchements().filter(x => x.type === 'eleve' && x.id === id); const cfIds = new Set(cf.flatMap(x => [x.a.id, x.b.id]));
    return (cf.length ? `<div class="small" style="color:var(--bad);margin-bottom:6px">⚠ ${cf.length} chevauchement${cf.length > 1 ? 's' : ''} d'horaires (deux AESH prévues en même temps).</div>` : '') + (bl.length ? weekGrid(bl, true, 'editCreneau', cfIds) : '<div class="empty">Aucun créneau planifié.</div>'); })()}
    ${e.edt ? `<h3 style="margin-top:14px" id="edt-papier">Emploi du temps papier</h3><a href="edt-eleves/${encodeURIComponent(e.edt)}" target="_blank"><img src="edt-eleves/${encodeURIComponent(e.edt)}" alt="Emploi du temps de ${esc(e.nom)}" style="max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:6px"></a>` : ''}</div>
   <div class="card"><h2>Historique</h2><ul class="journal" style="list-style:none;padding:0;margin:0">${hist.map(j => `<li><time>${new Date(j.date).toLocaleDateString('fr-FR')}</time>${esc(j.texte)}</li>`).join('') || '<li class="muted">Rien pour l\'instant.</li>'}</ul></div>
  </div>`;
}

/* ---- édition en place (fiche élève) ---- */
window.inlineEdit = (id, field, kind, opts) => {
  const e = eleve(id); const cur = e[field] ?? '';
  const el = document.querySelector(`[data-f="${field}"]`); if (!el || el.querySelector('input,select,textarea')) return;
  let ctl;
  if (kind === 'select') ctl = `<select>${opts.map(o => `<option ${cur === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  else if (kind === 'textarea') ctl = `<textarea>${esc(cur)}</textarea>`;
  else if (kind === 'number') ctl = champH('', cur);
  else ctl = `<input type="${kind}" value="${esc(cur)}">`;
  el.innerHTML = ctl; const c = el.querySelector('input,select,textarea'); c.focus();
  const done = (cancel) => {
    if (cancel) return render();
    let v = c.value; if (kind === 'number') { v = num(v); if (Number.isNaN(v)) { alert(H_ILLISIBLE); return render(); } } if (kind === 'text' || kind === 'textarea') v = v.trim();
    if (String(e[field] ?? '') !== String(v ?? '')) { const old = e[field]; e[field] = v; if (CHAMPS_DOSSIER.includes(field)) { (e.manuel = e.manuel || {})[field] = true; if (e.auto) delete e.auto[field]; } if (field === 'statut') e.statutManuel = true; commit('eleve', `${e.nom} ${e.prenom} : ${field} ${old ?? '—'} → ${v ?? '—'}`); } else render();
  };
  c.onblur = () => done(false);
  c.onkeydown = ev => { if (ev.key === 'Escape') { c.onblur = null; done(true); } if (ev.key === 'Enter' && kind !== 'textarea') c.blur(); };
  if (kind === 'select') c.onchange = () => c.blur();
};
window.inlineEditAesh = (id, field, kind) => {
  const a = aesh(id); const cur = a[field] ?? '';
  const el = document.querySelector(`[data-af="${field}"]`); if (!el || el.querySelector('input,select,textarea')) return;
  const ctl = kind === 'number' ? champH('', cur) : `<input type="${kind}" value="${esc(cur)}">`;
  el.innerHTML = ctl; const c = el.querySelector('input'); c.focus(); c.select();
  const done = (cancel) => {
    if (cancel) return render();
    let v = c.value; if (kind === 'number') { v = num(v); if (Number.isNaN(v)) { alert(H_ILLISIBLE); return render(); } }
    if (String(a[field] ?? '') !== String(v ?? '')) { const old = a[field]; a[field] = v; commit('aesh', `${a.nom} : ${field} ${old ?? '—'} → ${v ?? '—'}`); } else render();
  };
  c.onblur = () => done(false);
  c.onkeydown = ev => { if (ev.key === 'Escape') { c.onblur = null; done(true); } if (ev.key === 'Enter') c.blur(); };
};
window.changerAesh = (eid, oldAid, newAid) => {
  if (!newAid || newAid === oldAid) return;
  const e = eleve(eid); const old = S.affectations.find(z => z.eleveId === eid && z.aeshId === oldAid);
  const heures = old ? old.heures : 0;
  const existing = S.affectations.find(z => z.eleveId === eid && z.aeshId === newAid);
  if (existing && existing.heures > 0 && !confirm(`${aesh(newAid).nom} a déjà ${hf(existing.heures)} pour ${e.nom} ${e.prenom}. Remplacer par ${hf(heures)} ?`)) { render(); return; }
  S.affectations = S.affectations.filter(z => !(z.eleveId === eid && z.aeshId === oldAid) && !(z.eleveId === eid && z.aeshId === newAid));
  S.affectations.push({ eleveId: eid, aeshId: newAid, heures, aConfirmer: false });
  commit('affectation', `${e.nom} ${e.prenom} : ${aesh(oldAid).nom} → ${aesh(newAid).nom} (${hf(heures)})`);
};
window.setAff = (eid, aid, v) => {
  if (!aid) return;
  const e = eleve(eid), a = aesh(aid);
  let x = S.affectations.find(z => z.eleveId === eid && z.aeshId === aid);
  if (v === '' || v == null) { S.affectations = S.affectations.filter(z => z !== x); return commit('affectation', `${e.nom} ${e.prenom} : ${a.nom} retirée`); }
  v = num(v); if (!Number.isFinite(v)) { alert(H_ILLISIBLE); return render(); }
  if (x) { const old = x.heures; x.heures = v; x.aConfirmer = false; commit('affectation', old !== v ? `${e.nom} ${e.prenom} ↔ ${a.nom} : ${old} → ${v} h` : null); }
  else { S.affectations.push({ eleveId: eid, aeshId: aid, heures: v, aConfirmer: false }); commit('affectation', `${e.nom} ${e.prenom} ↔ ${a.nom} : ${v} h`); }
};
window.archiverEleve = id => { const e = eleve(id); e.archive = !e.archive; commit('eleve', `${e.nom} ${e.prenom} ${e.archive ? 'archivé' : 'restauré'}`); };
window.setNotifDate = (id, field, v) => { const e = eleve(id); const old = e[field]; e[field] = v || ''; commit('eleve', `${e.nom} ${e.prenom} : ${field} ${old || '—'} → ${v || '—'}`); };
window.setHeuresACouvrir = (id, v) => { const e = eleve(id); const old = e.heures; const val = v === '' ? null : num(v); if (old === val) return; e.heures = val; commit('eleve', `${e.nom} ${e.prenom} : heures à couvrir ${hf(old)} → ${hf(val)}`); };

/* ====================== AESH ====================== */
function pageAesh() {
  setTitle('AESH', `<button class="btn" onclick="mailAllAesh()">Envoyer un mail à tous</button> <button class="btn primary" onclick="editAesh()">+ AESH</button>`);
  const list = sortAesh(S.aesh.filter(a => !view.aeshSite || aeshSites(a).has(view.aeshSite)));
  const r = ressource(view.aeshSite);
  $('#page').innerHTML = `<div class="print-title">Équipe AESH</div><div class="toolbar"><div class="seg"><button class="${!view.aeshSite ? 'on' : ''}" onclick="setView('aeshSite','')">Tous</button>${SITES.map(s => `<button class="${view.aeshSite === s ? 'on' : ''}" onclick="setView('aeshSite','${s}')">${s}</button>`).join('')}</div>
   <span class="small muted">${r.n} AESH · volume ${hf(r.vol)} · affecté ${hf(r.aff)} · reste ${r.manq ? '? (' + r.manq + ' quotité' + (r.manq > 1 ? 's' : '') + ' manquante' + (r.manq > 1 ? 's' : '') + ')' : hf(r.reste)}</span>
   <div class="small muted" style="margin-top:4px">Mauve = individuel · vert = mutualisé · « ? » après les heures = répartition à confirmer</div></div>
  <div class="grid g3">${list.map((a, i) => { const c = charge(a); const w = a.quotite ? Math.min(100, pct(c.tot, a.quotite)) : 0;
    const grp = aeshGroup(a);
    const grpLabel = grp === 0 ? 'TOUS NIVEAUX' : grp === 1 ? 'ULIS' : grp === 2 ? 'SEGPA' : grp === 3 ? 'EN ABSENCE' : '';
    const brk = (i === 0 || grp > aeshGroup(list[i - 1])) ? `<div style="grid-column:1/-1;margin-top:${i === 0 ? 16 : 36}px">${grpLabel ? `<h3 style="color:${couleurAesh(a)};margin:0 0 3px;font-size:18px">${grpLabel}</h3>` : ''}</div>` : '';
    return brk + `<div class="card" style="border-top:4px solid ${couleurAesh(a)};cursor:pointer;${absente(a) ? 'background:#EEF0F2' : ''}" onclick="location.hash='#/aesh/${a.id}'">
     <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(a.nom)}</h2><span class="pill ${c.k}">${c.l}</span>${a.statut && a.statut !== 'Actif' ? ` <span class="pill warn">${esc(a.statut)}</span>` : ''}</div>
     <div class="muted small">${a.site}${a.remarques ? ' · ' + esc(a.remarques) : ''}</div>
     <div style="display:flex;gap:16px;margin:10px 0 6px"><div><div style="font-size:22px;font-weight:700">${a.quotite == null ? '<span style="color:var(--warn)">?</span>' : a.quotite + ' h'}</div><div class="small muted">quotité</div></div><div><div style="font-size:22px;font-weight:700">${hf(c.tot)}</div><div class="small muted">affectées</div></div><div><div style="font-size:22px;font-weight:700;color:${c.reste == null ? 'inherit' : 'var(--' + c.k + ')'}">${c.reste == null ? '?' : hf(c.reste)}</div><div class="small muted">reste</div></div><div><div style="font-size:22px;font-weight:700">${c.n}</div><div class="small muted">élèves</div></div></div>
     <div class="gauge" style="height:10px"><i class="indiv" style="width:${a.quotite ? Math.min(100, pct(c.ind, a.quotite)) : 0}%;float:left;border-radius:4px 0 0 4px"></i><i style="width:${a.quotite ? Math.min(100 - pct(c.ind, a.quotite), pct(c.mut, a.quotite)) : 0}%;float:left;border-radius:0;background:var(--mutu)"></i>${c.autres ? `<i style="width:${a.quotite ? Math.min(100 - pct(c.ind, a.quotite) - pct(c.mut, a.quotite), pct(c.autres, a.quotite)) : 0}%;float:left;border-radius:0;background:${couleurAesh(a)}"></i>` : ''}</div>
     <div class="small muted" style="margin-top:4px"><span style="white-space:nowrap"><span class="dot" style="background:var(--indiv)"></span>individuel ${hf(c.ind)}</span> <span style="white-space:nowrap"><span class="dot" style="background:var(--mutu);margin-left:8px"></span>mutualisé ${hf(c.mut)}</span>${c.autres ? ` <span style="white-space:nowrap"><span class="dot" style="background:${a.couleur};margin-left:8px"></span>collectif ${hf(c.autres)}</span>` : ''}</div>
     ${(() => { const L = affOfAesh(a).map(x => ({ e: eleve(x.eleveId), h: x.heures || 0, conf: x.aConfirmer })).filter(x => x.e).sort((p, q) => (p.e.type === q.e.type ? 0 : p.e.type === 'Individuel' ? -1 : 1) || p.e.classe.localeCompare(q.e.classe, 'fr') || p.e.nom.localeCompare(q.e.nom, 'fr'));
       return L.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:4px">${L.length} élève${L.length > 1 ? 's' : ''} suivi${L.length > 1 ? 's' : ''}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${L.map(x => `<a href="#/eleves/${x.e.id}" onclick="event.stopPropagation()" style="text-decoration:none;color:inherit;font-size:12px;line-height:1.25;border:1px solid var(--line);border-left:3px solid var(${x.e.type === 'Individuel' ? '--indiv' : '--mutu'});border-radius:6px;padding:2px 6px;background:var(--surface)" title="${esc(x.e.nom + ' ' + x.e.prenom + ' · ' + x.e.classe + ' · ' + hf(x.h))}"><b>${esc(x.e.nom)}</b> ${esc(x.e.prenom)} <span class="muted">${esc(x.e.classe)}${libDisp(x.e) ? ' ' + libDisp(x.e) : ''} · ${hf(x.h)}${x.conf ? ' ?' : ''}</span></a>`).join('')}</div></div>` : ''; })()}
    </div>`; }).join('')}</div>`;
}
window.mailAllAesh = () => {
  const emails = S.aesh.filter(a => a.email).map(a => a.email);
  if (!emails.length) return alert('Aucune adresse e-mail renseignée.');
  location.href = 'mailto:?bcc=' + emails.join(',') + '&subject=' + encodeURIComponent('Équipe AESH');
};
window.attacherEleve = aeshId => {
  const sel = document.getElementById('attach-eleve-select');
  const heuresInput = document.getElementById('attach-eleve-heures');
  const eleveId = sel.value;
  if (!eleveId) return alert('Choisis un élève.');
  const heures = num(heuresInput.value);
  if (!heures || heures <= 0) return alert('Indique un nombre d\'heures supérieur à 0.');
  setAff(eleveId, aeshId, heures);
  editAesh(aeshId);
};
window.editAesh = id => {
  const a = id ? aesh(id) : { nom: '', site: 'Collège', quotite: null, statut: 'Actif', heuresAutres: null, dispositif: '', couleur: PALETTE[S.aesh.length % PALETTE.length], remarques: '', email: '' };
  modal(`<h2>${id ? 'Modifier ' + esc(a.nom) : 'Nouvel AESH'}</h2><div class="form-grid">
    <label class="f">Prénom / Nom<input type="text" name="nom" value="${esc(a.nom)}" required></label>
    <label class="f">Site principal<select name="site">${[...SITES, 'Mixte'].map(s => `<option ${a.site === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="f">Quotité hebdo d'accompagnement (h)${champH('name="quotite"', a.quotite)}</label>
    <label class="f">Statut<select name="statut" onchange="document.getElementById('absence-dates').style.display=this.value!=='Actif'?'':'none'">${STATUTS_AESH.map(s => `<option ${a.statut === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <div id="absence-dates" class="f wide" style="display:${absente(a) ? '' : 'none'};gap:10px;grid-template-columns:1fr 1fr">
      <label class="f">Absence du<input type="date" name="absenceDebut" value="${a.absenceDebut || ''}"></label>
      <label class="f">au<input type="date" name="absenceFin" value="${a.absenceFin || ''}"></label>
      <div class="small muted" style="grid-column:1/-1">Retour automatique : l'AESH repasse « Actif » le lendemain de la date de fin.</div>
    </div>
    <label class="f">Heures collectives (h) <span class="small muted">hors élève individuel — ex. ULIS, SEGPA</span>${champH('name="heuresAutres"', a.heuresAutres)}</label>
    <label class="f">Dispositif <span class="small muted">seules les AESH ULIS suivent les élèves ULIS du collège, seules les AESH SEGPA les élèves SEGPA</span><select name="dispositif"><option value="">Aucun (élèves en ordinaire)</option>${DISPOSITIFS.map(x => `<option ${a.dispositif === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label class="f">E-mail<input type="email" name="email" value="${esc(a.email)}"></label>
    <label class="f">Couleur<input type="color" name="couleur" value="${a.couleur}" style="height:36px;width:100%"></label>
    <label class="f wide">Remarques<textarea name="remarques">${esc(a.remarques)}</textarea></label></div>
    ${id ? (() => { const dispo = sortEleves(S.eleves.filter(e => isActive(e) && !S.affectations.some(x => x.eleveId === e.id && x.aeshId === id)));
      return `<h3 style="margin:16px 0 8px">Rattacher un élève</h3><div class="toolbar" style="margin:0">
      <select id="attach-eleve-select" style="width:auto">${dispo.length ? dispo.map(e => `<option value="${e.id}">${esc(e.nom)} ${esc(e.prenom)} — ${esc(e.classe)}</option>`).join('') : '<option value="">Aucun élève disponible</option>'}</select>
      <span style="width:170px;display:inline-block">${champH('id="attach-eleve-heures" placeholder="heures / semaine"', null)}</span>
      <button type="button" class="btn sm" onclick="attacherEleve('${id}')">+ Rattacher</button></div>`; })() : ''}`,
    d => { if (!d.nom.trim()) { alert('Nom obligatoire'); return false; } if (Number.isNaN(num(d.quotite)) || Number.isNaN(num(d.heuresAutres))) { alert(H_ILLISIBLE); return false; } const nomParts = d.nom.trim().split(' '); const nomFmt = nomParts.length > 1 ? nomParts[0] + ' ' + nomParts.slice(1).join(' ').toUpperCase() : nomParts[0];
      const obj = { nom: nomFmt, site: d.site, quotite: num(d.quotite), statut: d.statut, absenceDebut: d.statut !== 'Actif' ? (d.absenceDebut || null) : null, absenceFin: d.statut !== 'Actif' ? (d.absenceFin || null) : null, heuresAutres: num(d.heuresAutres), dispositif: d.dispositif || '', email: d.email.trim(), couleur: d.couleur, remarques: d.remarques };
      if (id) { const chg = a.quotite !== obj.quotite ? ` (quotité ${a.quotite ?? '—'} → ${obj.quotite ?? '—'})` : ''; const dchg = a.dispositif !== obj.dispositif ? ` (dispositif ${a.dispositif || 'aucun'} → ${obj.dispositif || 'aucun'})` : ''; const avantAbs = !!absenceOuverte(a.id); Object.assign(a, obj); syncAbsence(a); if (avantAbs !== !!absenceOuverte(a.id)) setTimeout(() => publierAuto(), 300); const nb = synchroDispositifs(); commit('aesh', `${a.nom} modifié${chg}${dchg}${nb ? ' — élèves ULIS / SEGPA rattachés automatiquement' : ''}`); }
      else { const n = { id: uid('a'), ...obj }; S.aesh.push(n); const nb = synchroDispositifs(); commit('aesh', `AESH ajouté : ${n.nom}${nb ? ' — élèves ULIS / SEGPA rattachés automatiquement' : ''}`); location.hash = '#/aesh/' + n.id; } },
    id ? () => { if (!confirm(`Supprimer ${a.nom} et toutes ses affectations ?`)) return; S.creneaux = S.creneaux.filter(x => x.aeshId !== id); S.aesh = S.aesh.filter(x => x.id !== id); synchroDispositifs(); S.affectations = S.affectations.filter(x => x.aeshId !== id); commit('aesh', `AESH supprimé : ${a.nom}`); location.hash = '#/aesh'; } : null);
};
function remplacementCard(a) {
  const mesCreneaux = creneauxACouvrir(a.id); // seulement les créneaux touchés par l'absence (jours de la période), pas toute la semaine
  const autresAesh = sortAesh(S.aesh.filter(x => x.id !== a.id && !absente(x)));
  const periode = a.absenceDebut || a.absenceFin ? ` du ${a.absenceDebut ? new Date(a.absenceDebut).toLocaleDateString('fr-FR') : '?'} au ${a.absenceFin ? new Date(a.absenceFin).toLocaleDateString('fr-FR') : '?'}` : '';
  if (!mesCreneaux.length) return `<div class="card" style="border-left:4px solid var(--warn);background:#FFF8EC;margin-bottom:14px"><b>Absence${periode}</b> — aucun créneau de ${esc(a.nom)} n'est touché sur cette période (vacances, jour sans cours ou EDT non saisi), rien à répartir.</div>`;
  const joursPresents = [...new Set(mesCreneaux.map(x => x._dates[0]))];
  const rows = mesCreneaux.map(cr => { const e = eleve(cr.eleveId); if (!e) return '';
    const shade = joursPresents.indexOf(cr._dates[0]) % 2 === 1 ? 'background:#EEF0F2' : '';
    const enLigne = (S.prisesOcc || []).filter(p => p.creneauId === cr.id).map(p => `${esc((aesh(p.remplacantId) || {}).nom || '?')} le ${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`);
    return `<tr style="${shade}"><td class="small"><b>${cr._dates.slice(0, 3).map(dateCourte).join(', ')}${cr._dates.length > 3 ? ' …' : ''}</b></td><td class="small">${cr.debut}–${cr.fin}</td><td><b>${esc(e.nom)}</b> ${esc(e.prenom)} <span class="small muted">(${esc(e.classe)})</span></td><td><select onchange="assignerRemplacant('${cr.id}',this.value)"><option value="">— non assigné —</option>${autresAesh.map(r => `<option value="${r.id}" ${cr.remplacantId === r.id ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select>${enLigne.length ? `<div class="small muted" style="margin-top:3px">Pris en ligne : ${enLigne.join(' · ')}</div>` : ''}</td></tr>`; }).join('');
  return `<div class="card" style="border-left:4px solid var(--warn);background:#FFF8EC;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">Organiser le remplacement<span class="small muted">${periode}</span></h2><button class="btn sm no-print" onclick="terminerRemplacement('${a.id}')">Fin du remplacement</button></div>
    <p class="small muted" style="margin:6px 0 10px">Choisis, pour chaque créneau, quel·le collègue prend le relais pendant l'absence. Le créneau apparaîtra alors sur la fiche du/de la remplaçant.e, dans « Remplacements en cours ».</p>
    <table class="t compact"><thead><tr><th>Date</th><th>Horaire</th><th>Élève</th><th>Remplaçant.e</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
window.assignerRemplacant = (creneauId, remplacantId) => {
  const cr = S.creneaux.find(x => x.id === creneauId); if (!cr) return;
  const e = eleve(cr.eleveId); const a = aesh(cr.aeshId);
  if (cr.remplacantId === (remplacantId || undefined) || (!cr.remplacantId && !remplacantId)) return;
  const maintenant = maintenantLocal(), ab = absenceOuverte(cr.aeshId);
  if (cr.remplacantId) { // l'ancien.ne remplaçant.e garde les occurrences déjà passées pendant la durée où le créneau était tenu
    S.segmentsRempl.push({ id: uid('seg'), absentId: cr.aeshId, remplacantId: cr.remplacantId, depuis: cr.remplacantDepuis || '', jusqua: maintenant, absDebut: (ab && ab.debut) || a.absenceDebut || '', absFin: (ab && ab.fin) || a.absenceFin || '', cr: { jour: cr.jour, debut: cr.debut, fin: cr.fin, groupe: cr.groupe || null } });
  }
  cr.remplacantId = remplacantId || null; cr.remplacantDepuis = remplacantId ? maintenant : null;
  commit('aesh', remplacantId ? `${aesh(remplacantId).nom} remplace ${a.nom} pour ${e.nom} ${e.prenom} (${JOURS[cr.jour - 1]} ${cr.debut}-${cr.fin})` : `Remplacement retiré pour ${e.nom} ${e.prenom} (${a.nom}, ${JOURS[cr.jour - 1]} ${cr.debut}-${cr.fin})`);
};
function archiverRemplacements(aeshId) {
  const a = aesh(aeshId);
  const concernes = S.creneaux.filter(cr => cr.aeshId === aeshId && cr.remplacantId);
  if (concernes.length) {
    S.archives.unshift({
      id: uid('arch'), date: new Date().toISOString(), aeshId, aeshNom: a.nom,
      absenceDebut: a.absenceDebut || null, absenceFin: a.absenceFin || null,
      remplacements: concernes.map(cr => { const e = eleve(cr.eleveId); const r = aesh(cr.remplacantId);
        return { eleveId: cr.eleveId, eleveNom: e ? `${e.nom} ${e.prenom}` : '?', remplacantId: cr.remplacantId, remplacantNom: r ? r.nom : '?', jour: cr.jour, debut: cr.debut, fin: cr.fin, groupe: cr.groupe || null, depuis: cr.remplacantDepuis || '', jusqua: maintenantLocal() }; })
    });
  }
  S.creneaux.forEach(cr => { if (cr.aeshId === aeshId) { delete cr.remplacantId; delete cr.remplacantDepuis; } });
  return concernes.length;
}
window.terminerRemplacement = aeshId => {
  if (!confirm('Retirer tous les remplacements en cours pour cet AESH ?')) return;
  const a = aesh(aeshId);
  const n = archiverRemplacements(aeshId);
  commit('aesh', `Remplacements terminés pour ${a.nom}${n ? ' (archivés : ' + n + ' créneau' + (n > 1 ? 'x' : '') + ')' : ''}`);
};
/* Retour automatique : une AESH en arrêt ou en congés redevient « Actif » le lendemain de sa date de fin d'absence. */
function verifierRetours() {
  const auj = aujourdhui(); const revenues = [];
  S.aesh.forEach(a => {
    if (!absente(a) || !a.absenceFin || auj <= a.absenceFin) return;
    const n = archiverRemplacements(a.id); const ab = (S.absences || []).find(x => x.aeshId === a.id && x.ouvert); if (ab) { ab.ouvert = false; ab.fin = a.absenceFin; }
    const motif = String(a.statut).toLowerCase();
    log('aesh', `${a.nom} réintégrée automatiquement (fin de ${motif} le ${new Date(a.absenceFin).toLocaleDateString('fr-FR')})${n ? ' ; remplacements archivés : ' + n + ' créneau' + (n > 1 ? 'x' : '') : ''}`);
    revenues.push(a.nom); a.statut = 'Actif'; a.absenceDebut = null; a.absenceFin = null;
  });
  if (revenues.length) { save(); render(); toast(`${revenues.join(', ')} : de retour, réintégrée${revenues.length > 1 ? 's' : ''} automatiquement`); }
  return revenues.length;
}
function remplacementsEnCoursCard(a) {
  const mine = S.creneaux.filter(x => x.remplacantId === a.id);
  if (!mine.length) return '';
  const byAbsent = {}; mine.forEach(cr => { (byAbsent[cr.aeshId] ||= []).push(cr); });
  return `<div class="card" style="border-left:4px solid var(--ok);background:#EEFBF3;margin-bottom:14px"><h2 style="margin:0 0 8px">Remplacements en cours</h2>
    ${Object.entries(byAbsent).map(([absentId, crs]) => { const absent = aesh(absentId); if (!absent) return '';
      const parPeriode = absent.absenceDebut || absent.absenceFin ? ` jusqu'au ${absent.absenceFin ? new Date(absent.absenceFin).toLocaleDateString('fr-FR') : '?'}` : '';
      const byEleve = {}; crs.forEach(cr => { (byEleve[cr.eleveId] ||= []).push(cr); });
      return `<div style="margin-bottom:10px"><b>À la place de ${esc(absent.nom)}</b><span class="small muted">${parPeriode}</span><ul style="margin:4px 0 0;padding-left:18px">${Object.entries(byEleve).map(([eid, list]) => { const e = eleve(eid); if (!e) return ''; return `<li><a href="#/eleves/${eid}" style="color:inherit">${esc(e.nom)} ${esc(e.prenom)}</a> — ${list.slice().sort((p, q) => p.jour - q.jour || p.debut.localeCompare(q.debut)).map(cr => `${JOURS[cr.jour - 1]} ${cr.debut}-${cr.fin}`).join(', ')}</li>`; }).join('')}</ul></div>`; }).join('')}</div>`;
}
function ficheAesh(id) {
  const a = aesh(id); if (!a) { location.hash = '#/aesh'; return; }
  const c = charge(a); const affs = affOfAesh(a).map(x => ({ ...x, e: eleve(x.eleveId) })).sort((p, q) => q.heures - p.heures);
  const bl = S.creneaux.filter(x => x.aeshId === id).map(x => crBlock(x, 'aesh')).filter(Boolean);
  const planned = dureeUnique(bl);
  const conflits = chevauchements().filter(x => x.type === 'aesh' && x.id === id);
  const conflictIds = new Set(conflits.flatMap(x => [x.a.id, x.b.id]));
  const notifies = affs.filter(x => x.e.statut === 'Notifié').length;
  setTitle(a.nom, `${a.email ? `<a class="btn" href="mailto:${esc(a.email)}">Envoyer un mail</a> ` : ''}<button class="btn" onclick="exportWordAesh('${id}')">Word</button> <button class="btn" onclick="editAesh('${id}')">Modifier</button>`);
  const byClass = {}; affs.forEach(x => { byClass[x.e.classe] = (byClass[x.e.classe] || 0) + x.heures; });
  $('#page').innerHTML = `<div class="print-title">Fiche AESH — ${esc(a.nom)}</div>
  <div class="fiche-head" style="${absente(a) ? 'background:#EEF0F2;border-radius:var(--radius)' : ''}"><div class="avatar" style="background:${couleurAesh(a)}">${ini(a)}</div><div><div style="font-size:18px;font-weight:650">${esc(a.nom)} <span class="pill ${c.k}">${c.l}</span>${a.statut && a.statut !== 'Actif' ? ` <span class="pill warn">${esc(a.statut)}</span>` : ''}</div><div class="muted">${a.site}${a.dispositif ? ' · <b>dispositif ' + a.dispositif + '</b>' : ''}${a.remarques ? ' · ' + esc(a.remarques) : ''}${a.email ? ' · <a href="mailto:' + esc(a.email) + '" style="color:inherit">' + esc(a.email) + '</a>' : ''}</div></div></div>
  <div class="kpis" style="grid-template-columns:repeat(${c.autres ? 6 : 5},1fr)">
   <div class="kpi ${a.quotite == null ? 'warn' : ''}"><div class="v" data-af="quotite" title="Cliquer pour modifier" style="cursor:pointer" onclick="inlineEditAesh('${id}','quotite','number')">${a.quotite == null ? '<span class="muted">— cliquer pour saisir</span>' : a.quotite + ' h'}</div><div class="l">quotité hebdo</div></div>
   <div class="kpi indiv"><div class="v">${hf(c.ind)}</div><div class="l">individuel</div></div>
   <div class="kpi mutu"><div class="v">${hf(c.mut)}</div><div class="l">mutualisé</div></div>
   ${c.autres ? `<div class="kpi"><div class="v">${hf(c.autres)}</div><div class="l">collectif (ULIS/autre)</div></div>` : ''}
   <div class="kpi ${c.reste == null ? '' : c.k}"><div class="v">${c.reste == null ? '?' : hf(c.reste)}</div><div class="l">reste disponible</div></div>
   <div class="kpi"><div class="v">${c.taux == null ? '—' : Math.round(c.taux * 100) + ' %'}</div><div class="l">taux d'occupation</div></div></div>
  ${conflits.length ? `<div class="card" style="border-left:4px solid var(--bad);background:var(--bad-soft);margin-bottom:14px">⚠ <b>${conflits.length} chevauchement${conflits.length > 1 ? 's' : ''} d'horaires</b> détecté${conflits.length > 1 ? 's' : ''} dans l'emploi du temps de ${esc(a.nom)} : ${conflits.map(x => `le ${JOURS[x.a.jour - 1]} (${x.a.debut}–${x.a.fin} et ${x.b.debut}–${x.b.fin})`).join(', ')}.</div>` : ''}
  ${absente(a) ? remplacementCard(a) : ''}
  ${remplacementsEnCoursCard(a)}
  <div class="grid g2">
   <div class="card"><h2>Élèves suivis (${affs.length}) <span class="small muted">dont ${notifies} notifié${notifies > 1 ? 's' : ''}</span></h2>
    <div class="seg" style="margin-bottom:10px"><button class="${!view.aeshFicheType ? 'on' : ''}" onclick="setView('aeshFicheType','')">Tous (${affs.length})</button><button class="${view.aeshFicheType === 'Individuel' ? 'on' : ''}" onclick="setView('aeshFicheType','Individuel')">Individuel (${affs.filter(x => x.e.type === 'Individuel').length})</button><button class="${view.aeshFicheType === 'Mutualisé' ? 'on' : ''}" onclick="setView('aeshFicheType','Mutualisé')">Mutualisé (${affs.filter(x => x.e.type === 'Mutualisé').length})</button></div>
    <table class="t"><thead><tr><th>Élève</th><th>Classe</th><th>Type</th><th>Statut du dossier MDPH</th><th class="num" title="Notification d'heures MDPH de l'élève">Heure à couvrir</th><th class="num" title="Heures données par cet AESH à l'élève (case AESH affectés de la fiche élève)">Heures couvertes</th><th></th></tr></thead><tbody>${(view.aeshFicheType ? affs.filter(x => x.e.type === view.aeshFicheType) : affs).map(x => `<tr class="row" onclick="location.hash='#/eleves/${x.e.id}'"><td><b>${esc(x.e.nom)}</b> ${esc(x.e.prenom)}</td><td>${esc(x.e.classe)}</td><td><span class="pill ${x.e.type === 'Individuel' ? 'indiv' : 'mutu'}">${x.e.type}</span></td><td><span class="pill ${x.e.statut === 'Notifié' ? 'ok' : isPending(x.e) ? 'warn' : 'neutral'}">${esc(x.e.statut)}</span> ${pastilleValidite(x.e, true)}</td><td class="num">${hf(x.e.heures)}</td><td class="num" onclick="event.stopPropagation()" style="cursor:default;min-width:140px" title="Heures données par cette AESH à l'élève : modifiables ici (pas de 15 min)">${champH(`onchange="setAff('${x.e.id}','${a.id}',this.value)"`, x.heures ?? 0)}</td><td>${x.aConfirmer ? `<button type="button" class="pill warn" style="border:0;cursor:pointer;font:inherit;font-weight:600" title="Cliquer pour confirmer cette répartition" onclick="confirmerAff('${x.e.id}','${a.id}')">à confirmer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun élève.</td></tr>'}</tbody></table>
    <h3 style="margin-top:12px">Répartition par classe</h3>${hbars(Object.entries(byClass).sort((p, q) => q[1] - p[1]).map(([k, v]) => ({ l: k, segs: [{ v, c: couleurAesh(a) }], right: hf(v) })), { lw: 90 })}</div>
   <div class="card" id="edt-print-block"><h2>Emploi du temps <span class="small muted">${hf(planned)} couvertes / ${hf(c.tot)} à couvrir</span> <button class="btn sm no-print" style="float:right" onclick="editCreneau(null,{aeshId:'${id}',eleveId:'${affs[0]?.eleveId || ''}'})">+ Créneau</button> <button class="btn sm no-print" style="float:right;margin-right:8px" onclick="printEdt('${id}')">Imprimer / PDF</button></h2>${bl.length ? weekGrid(bl, true, 'editCreneau', conflictIds) : '<div class="empty">Aucun créneau planifié.</div>'}
    ${(() => { const f = edtAesh(a); if (!f) return ''; const pdf = f.name.toLowerCase().endsWith('.pdf'); const u = f.url;
      return `<h3 style="margin-top:14px">Emploi du temps papier <span class="small muted" style="font-weight:400">${esc(f.name)} · mis à jour automatiquement depuis le dossier « EDT AESH »</span></h3>` + (pdf ? `<a href="${u}" target="_blank" class="small">Ouvrir le PDF ↗</a><embed src="${u}" type="application/pdf" style="width:100%;height:600px;border:1px solid var(--line);border-radius:8px;margin-top:6px">` : `<a href="${u}" target="_blank"><img src="${u}" alt="Emploi du temps de ${esc(a.nom)}" style="max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:6px"></a>`); })()}</div>
  </div>
  ${carteAbsencesAesh(a)}${carteHeuresSup(a)}${carteSouhaits(a)}`;
}

/* ====================== SOUHAITS PAR AESH (jamais bloquants) ====================== */
const SOUHAITS_VIDES = { joursOff: [], debut: '', fin: '', niveaux: [], eleves: [], dispo: {}, note: '' };
const souhaitsDe = a => a.souhaits || SOUHAITS_VIDES;
const souhaitsEdit = a => (a.souhaits ||= JSON.parse(JSON.stringify(SOUHAITS_VIDES)));
const DISPO_ETATS = ['', 'evite', 'indispo', 'occupee'];
const DISPO_LIB = { '': 'Libre', evite: 'À éviter', indispo: 'Indisponible', occupee: 'Occupée (ULIS/SEGPA…)' };
const labelPeriode = h => h.replace(':', 'h');
/* ---- Compteur d'heures supplémentaires (mises de côté, à récupérer plus tard) ---- */
// Heures sup. = dépassement de quotité autorisé par semaine × semaines scolaires écoulées (vacances exclues) + ajustements − heures récupérées.
function semainesHS(a) {
  const h = a.hs; if (!h || !h.autorise || !h.depuis) return 0;
  let n = 0; const fin = h.jusqua || '9999-12-31';
  for (const d = lundiDe(h.depuis); n < 80; d.setDate(d.getDate() + 7)) { const ven = new Date(d); ven.setDate(ven.getDate() + 4); if (isoLocal(ven) >= aujourdhui() || isoLocal(d) > fin) break; if (!semaineEnVacances(d)) n++; }
  return n;
}
function compteurHS(a) {
  const h = a.hs || { autorise: 0, mouvements: [] }, sem = semainesHS(a), remp = (statsAbsences()[a.id] || { extra: 0 }).extra, auto = sem * (h.autorise || 0) + remp;
  const ajust = (h.mouvements || []).filter(m => m.type === 'ajust').reduce((t, m) => t + m.heures, 0), recup = (h.mouvements || []).filter(m => m.type === 'recup').reduce((t, m) => t + m.heures, 0);
  return { sem, remp, auto, ajust, recup, solde: auto + ajust - recup };
}
function carteHeuresSup(a) {
  const id = a.id, h = a.hs || { autorise: 0, depuis: '', mouvements: [] }, c = compteurHS(a), mv = (h.mouvements || []).slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  const kp = (v, l, k = '') => `<div class="kpi ${k}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  return `<div class="card" style="margin-top:14px"><h2>Heures supplémentaires <span class="small muted">compteur : heures mises de côté, à récupérer plus tard</span></h2>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
      <label class="f">Dépassement de quotité autorisé (h par semaine)${champH(`placeholder="0" onchange="setHsConf('${id}','autorise',this.value)"`, h.autorise || '')}</label>
      <label class="f">Compté à partir du lundi<input type="date" value="${h.depuis || ''}" onchange="setHsConf('${id}','depuis',this.value)"></label></div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-top:10px">${kp(hf(c.auto), `cumulées${c.sem ? ' · ' + c.sem + ' sem. × ' + hf(h.autorise) : ''}${c.remp ? ' · dont ' + hf(c.remp) + ' de remplacements' : ''}`)}${kp((c.ajust >= 0 ? '+' : '−') + hf(Math.abs(c.ajust)), 'ajustements')}${kp('−' + hf(c.recup), 'récupérées')}${kp(hf(c.solde), 'à récupérer', c.solde > 0 ? 'warn' : '')}</div>
    <div class="toolbar no-print" style="margin:10px 0 6px"><button class="btn sm" onclick="ajouterHS('${id}','recup')">+ Heures récupérées</button><button class="btn sm" onclick="ajouterHS('${id}','ajust')">+ Ajustement (+/−)</button></div>
    ${mv.length ? `<table class="t compact"><thead><tr><th>Date</th><th>Mouvement</th><th class="num">Heures</th><th>Note</th><th></th></tr></thead><tbody>${mv.map(m => `<tr><td>${m.date ? new Date(m.date).toLocaleDateString('fr-FR') : '—'}</td><td>${m.type === 'recup' ? 'Récupération' : 'Ajustement'}</td><td class="num">${m.type === 'recup' ? '−' : (m.heures >= 0 ? '+' : '−')}${hf(Math.abs(m.heures))}</td><td class="small">${esc(m.note || '')}</td><td class="no-print"><button class="btn sm ghost" onclick="supprimerHS('${id}','${m.id}')" title="Supprimer">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Aucun mouvement enregistré.</div>'}
    <p class="small muted" style="margin:8px 0 0">Chaque semaine scolaire écoulée (vacances exclues) ajoute le dépassement autorisé au compteur. Un ajustement corrige une semaine (par exemple −0,5 h si aucune heure en plus n'a été faite). Le compteur n'a aucun effet sur les quotités ni sur les heures des élèves.</p></div>`;
}
window.setHsConf = (id, champ, v) => { const a = aesh(id); a.hs = a.hs || { autorise: 0, depuis: '', mouvements: [] }; const old = a.hs[champ]; a.hs[champ] = champ === 'autorise' ? (num(v) || 0) : v; commit('aesh', `${a.nom} : heures supplémentaires — ${champ === 'autorise' ? 'dépassement autorisé' : 'début du comptage'} ${old || '—'} → ${a.hs[champ] || '—'}`); };
window.ajouterHS = (id, type) => {
  const a = aesh(id), recup = type === 'recup';
  modal(`<h2>${recup ? 'Heures récupérées' : 'Ajustement du compteur'} — ${esc(a.nom)}</h2><div class="form-grid">
    <label class="f">Date<input type="date" name="date" value="${aujourdhui()}" required></label>
    <label class="f">${recup ? 'Heures récupérées' : 'Heures (+ ou −)'}${champH(`name="heures"${recup ? '' : ' data-neg="1" placeholder="ex. 1,5 ou -1,5"'}`, '')}</label>
    <label class="f wide">Note<input type="text" name="note" placeholder="${recup ? 'ex. matinée du mercredi récupérée' : 'ex. semaine sans heure en plus'}"></label></div>`,
    d => { const hrs = num(d.heures); if (hrs == null || Number.isNaN(hrs) || hrs === 0 || (recup && hrs < 0)) { alert('Indique un nombre d\'heures' + (recup ? ' positif' : ' (positif ou négatif)') + ', par exemple 1,5.'); return false; } a.hs = a.hs || { autorise: 0, depuis: '', mouvements: [] }; a.hs.mouvements.push({ id: uid('hs'), date: d.date, type, heures: hrs, note: (d.note || '').trim() }); commit('aesh', `${a.nom} : heures supplémentaires — ${recup ? 'récupération de ' : 'ajustement de '}${hrs} h`); });
};
window.supprimerHS = (id, mid) => { const a = aesh(id); if (!confirm('Supprimer ce mouvement du compteur ?')) return; a.hs.mouvements = a.hs.mouvements.filter(m => m.id !== mid); commit('aesh', `${a.nom} : mouvement d'heures supplémentaires supprimé`); };
function carteSouhaits(a) {
  const so = souhaitsDe(a); const id = a.id;
  const aCren = new Set(S.creneaux.filter(x => x.aeshId === id).map(x => x.jour + '-' + PERIODES.findIndex(p => t2m(p) <= t2m(x.debut) && t2m(x.debut) < t2m(p) + 55)));
  const eleves = sortEleves(S.eleves.filter(isActive)); const dispo = eleves.filter(e => !so.eleves.includes(e.id));
  const grille = `<table class="t compact dispo-grid"><thead><tr><th></th>${JOURS.map(j => `<th style="text-align:center">${j}</th>`).join('')}</tr></thead><tbody>${PERIODES.map((p, i) => `<tr><th class="small">${labelPeriode(p)}</th>${JOURS.map((j, jj) => { const k = (jj + 1) + '-' + i; const et = so.dispo[k] || ''; return `<td><button class="dispo-cell ${et}" onclick="cycleDispo('${id}','${k}')" title="${DISPO_LIB[et]} — clic pour changer">${aCren.has(k) ? '●' : ''}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="card" id="souhaits" style="margin-top:14px"><h2>Fiche de souhaits <span class="small muted">jamais bloquante : elle sert à signaler et à proposer</span></h2>
    <div class="grid g2"><div>
      <div class="f" style="margin-bottom:10px"><b class="small">Jours non souhaités</b><div>${JOURS.map((j, i) => `<label style="margin-right:10px"><input type="checkbox" ${so.joursOff.includes(i + 1) ? 'checked' : ''} onchange="setSouhaitJour('${id}',${i + 1},this.checked)"> ${j}</label>`).join('')}</div></div>
      <div class="form-grid">        <label class="f">Ne pas commencer avant<input type="time" value="${so.debut}" onchange="setSouhait('${id}','debut',this.value)"></label>
        <label class="f">Finir au plus tard<input type="time" value="${so.fin}" onchange="setSouhait('${id}','fin',this.value)"></label></div>
      <div class="f" style="margin:10px 0"><b class="small">Sites / niveaux souhaités</b><div>${[...SITES.filter(si => si !== 'ULIS' && si !== 'SEGPA'), 'ULIS', 'SEGPA'].map(si => `<label style="margin-right:10px"><input type="checkbox" ${so.niveaux.includes(si) ? 'checked' : ''} onchange="setSouhaitListe('${id}','niveaux','${si}',this.checked)"> ${si}</label>`).join('')}</div></div>
      <div class="f" style="margin-bottom:10px"><b class="small">Élèves souhaités</b><div style="margin:4px 0">${so.eleves.map(eid => { const e = eleve(eid); return e ? `<span class="chip">${esc(e.nom)} ${esc(e.prenom)} <button class="btn sm ghost" style="padding:0 4px" onclick="setSouhaitListe('${id}','eleves','${eid}',false)" title="Retirer">✕</button></span>` : ''; }).join(' ') || '<span class="muted small">Aucun</span>'}</div>
        <select onchange="if(this.value){setSouhaitListe('${id}','eleves',this.value,true)}"><option value="">+ Ajouter un élève…</option>${dispo.map(e => `<option value="${e.id}">${esc(e.nom)} ${esc(e.prenom)} — ${esc(e.classe)}</option>`).join('')}</select></div>
      <label class="f">Remarques<textarea onchange="setSouhait('${id}','note',this.value)">${esc(so.note)}</textarea></label></div>
    <div><b class="small">Disponibilités</b>${grille}
      <div class="legend small" style="margin-top:6px">${DISPO_ETATS.map(et => `<span style="white-space:nowrap"><span class="dispo-cell ${et}" style="display:inline-block;width:14px;height:14px;vertical-align:middle"></span> ${DISPO_LIB[et]}</span>`).join('')}<span>● = a déjà un créneau</span></div>
      <p class="small muted" style="margin:6px 0 0"><b>Comment lire :</b> chaque case est un créneau de la semaine ; un clic la fait passer de libre à « à éviter », « indisponible », « occupée » puis libre. L'appli signale un créneau placé sur une case « à éviter » ou « indisponible » et l'évite dans ses propositions, sans jamais l'interdire.</p></div></div></div>`;
}
window.setSouhait = (id, k, v) => { const a = aesh(id); souhaitsEdit(a)[k] = v; commit('aesh', `${a.nom} : souhait « ${k} » modifié`); };
window.setSouhaitJour = (id, j, on) => { const a = aesh(id), so = souhaitsEdit(a); so.joursOff = on ? [...new Set([...so.joursOff, j])].sort() : so.joursOff.filter(x => x !== j); commit('aesh', `${a.nom} : jours non souhaités modifiés`); };
window.setSouhaitListe = (id, k, v, on) => { const a = aesh(id), so = souhaitsEdit(a); so[k] = on ? [...new Set([...so[k], v])] : so[k].filter(x => x !== v); commit('aesh', `${a.nom} : souhaits (${k}) modifiés`); };
window.cycleDispo = (id, k) => { const a = aesh(id), so = souhaitsEdit(a); const cur = so.dispo[k] || ''; const nxt = DISPO_ETATS[(DISPO_ETATS.indexOf(cur) + 1) % DISPO_ETATS.length]; if (nxt) so.dispo[k] = nxt; else delete so.dispo[k]; commit('aesh', null); };
/* ---- Règles de l'équipe (réglées dans Données & exports) : elles signalent, elles ne bloquent jamais ---- */
const REGLES_LIB = { jours: 'Signaler un créneau un jour non souhaité', horaires: 'Signaler un créneau hors des horaires souhaités', niveaux: 'Signaler un élève hors des sites/niveaux souhaités' };
function carteRegles() {
  return `<div class="card" style="margin-top:14px"><h2>Règles de l'équipe <span class="small muted">elles signalent, elles ne bloquent jamais</span></h2>
    ${Object.keys(REGLES_LIB).map(k => `<label style="display:block;margin:6px 0"><input type="checkbox" ${S.regles[k] ? 'checked' : ''} onchange="setRegle('${k}',this.checked)"> ${REGLES_LIB[k]}</label>`).join('')}
    <p class="small muted" style="margin:8px 0 0">Ces règles ne changent jamais les heures dues aux élèves : elles servent seulement à repérer ce qu'il faut régler ou décider.</p></div>`;
}
window.setRegle = (k, v) => { S.regles[k] = v; commit('param', `Règle d'équipe « ${k} » ${v ? 'activée' : 'désactivée'}`); };

/* ====================== AFFECTATION ====================== */
function pageAffectation() {
  setTitle('Affectation');
  const els = sortEleves(S.eleves.filter(isActive));
  const aeshList = sortAesh(S.aesh);
  const head = `<tr><th class="name">Élève</th><th style="text-align:right">À couvrir</th>${aeshList.map(a => `<th class="col" style="--c:${couleurAesh(a)}" title="${esc(a.nom)} · quotité ${a.quotite ?? '?'} h">${esc(a.nom)}</th>`).join('')}<th>Total</th><th>Écart</th></tr>`;
  const rows = els.map(e => { const tot = couvertes(e); const ec = e.heures == null ? null : e.heures - tot; const k = ec == null ? '' : ec < 0 ? 'bad' : ec > 0 ? 'warn' : 'ok';
    return `<tr><td class="name"><a href="#/eleves/${e.id}" style="text-decoration:none;color:inherit"><span class="dot" style="background:var(--${e.type === 'Individuel' ? 'indiv' : 'mutu'})"></span><b>${esc(e.nom)}</b> ${esc(e.prenom)}</a> <span class="muted">${esc(e.classe)}</span></td><td class="tot">${hf(e.heures)}</td>
    ${aeshList.map(a => { const x = S.affectations.find(z => z.eleveId === e.id && z.aeshId === a.id); return `<td class="cell ${x && x.heures > 0 ? 'has' : ''} ${x && x.aConfirmer ? 'conf' : ''}">${x && x.heures ? hf(x.heures) : ''}</td>`; }).join('')}
    <td class="tot">${hf(tot)}</td><td class="tot ${k}">${ec == null ? '' : (ec > 0 ? '−' : ec < 0 ? '+' : '') + hf(Math.abs(ec))}</td></tr>`; }).join('');
  const foot = (label, fn) => `<tr class="foot"><td class="name">${label}</td><td></td>${aeshList.map(a => { const [v, k] = fn(a); return `<td class="${k}">${v}</td>`; }).join('')}<td></td><td></td></tr>`;
  $('#page').innerHTML = `<div class="print-title">Grille d'affectation</div><div class="small muted" style="margin-bottom:8px">Saumon = à confirmer · consultation seule : les affectations se modifient depuis la fiche élève ou la fiche AESH</div><div class="table-wrap" style="max-height:calc(100vh - 150px)"><table class="aff"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>
   ${foot('Total affecté', a => [hf(charge(a).tot), ''])}${foot('Quotité', a => [a.quotite == null ? '?' : a.quotite + ' h', ''])}${foot('Reste', a => { const c = charge(a); return [c.reste == null ? '?' : hf(c.reste), c.reste == null ? '' : 'tot ' + c.k]; })}</tfoot></table></div>`;
}
window.confirmerAff = (eid, aid) => { const x = S.affectations.find(z => z.eleveId === eid && z.aeshId === aid), e = eleve(eid), a = aesh(aid); if (!x) return; x.aConfirmer = false; if (!S.affConfirmees.includes(cleAff(x))) S.affConfirmees.push(cleAff(x)); commit('affectation', `Répartition confirmée : ${e ? e.nom + ' ' + e.prenom : eid} ↔ ${a ? a.nom : aid} (${hf(x.heures)})`); };
window.confirmerTout = () => { S.affectations.forEach(a => { if (a.aConfirmer && !S.affConfirmees.includes(cleAff(a))) S.affConfirmees.push(cleAff(a)); a.aConfirmer = false; }); commit('affectation', 'Toutes les répartitions marquées confirmées'); };

/* ====================== DOSSIERS ====================== */
function pageDossiers() {
  setTitle('PPS / MOPPS');
  const g = stats(S.eleves);
  $('#page').innerHTML = `<div class="print-title">PPS / MOPPS en cours</div><div class="toolbar"><span class="muted small">${g.pending} dossier${g.pending > 1 ? 's' : ''} en cours · ${hf(g.prev)} prévisionnelles. Consultation seule : le statut d'un dossier se modifie depuis la fiche de l'élève.</span></div>
  <div class="kanban">${KANBAN.map(st => { const list = sortEleves(S.eleves.filter(e => isActive(e) && e.statut === st));
    return `<div class="kcol"><h3>${esc(st)}<span class="pill neutral">${list.length}</span></h3>${list.map(e => { let renouv = '';
      if (st.startsWith('Dossier renouvellement déposé') && e.notifFin) { const d = new Date(e.notifFin); d.setMonth(d.getMonth() - 9); renouv = `<div class="small" style="margin-top:4px;color:var(--bad);font-weight:600">À renouveler avant le ${d.toLocaleDateString('fr-FR')}</div>`; }
      if (e.depotDate) renouv += `<div class="small muted" style="margin-top:4px">Déposé le ${frDate(e.depotDate)}</div>`;
      if (e.notifFin) renouv += `<div class="small" style="margin-top:4px">${pastilleValidite(e, true)} <span class="muted">notif. jusqu'au ${frDate(e.notifFin)}</span></div>`;
      return `<div class="kcard"><b><a href="#/eleves/${e.id}" style="text-decoration:none;color:inherit">${esc(e.nom)} ${esc(e.prenom)}</a></b><span class="small muted">${esc(e.classe)} · <span class="pill ${e.type === 'Individuel' ? 'indiv' : 'mutu'}">${e.type}</span>${e.heuresPrev ? ' · prévu ' + hf(e.heuresPrev) : ''}</span>${renouv}${e.remarques ? `<div class="small" style="margin-top:4px">${esc(e.remarques)}</div>` : ''}</div>`; }).join('') || '<div class="muted small">—</div>'}</div>`; }).join('')}</div>`;
}
window.setStatut = (id, st) => { const e = eleve(id); const old = e.statut; e.statut = st; commit('dossier', `${e.nom} ${e.prenom} : ${old} → ${st}`); };
window.notifier = id => { const e = eleve(id); const t = e.statut.includes('AESHi') ? 'Individuel' : e.statut.includes('AESHm') ? 'Mutualisé' : e.type;
  const h = prompt(`${e.nom} ${e.prenom} — heures notifiées (${t}) :`, e.heuresPrev ?? e.heures ?? ''); if (h === null) return;
  const old = e.statut; e.statut = 'Notifié'; e.type = t; e.heures = num(h); e.heuresPrev = null; commit('dossier', `${e.nom} ${e.prenom} notifié ${t} ${hf(e.heures)} (était : ${old})`); location.hash = '#/eleves/' + id; };

/* ====================== ARCHIVES (remplacements) ====================== */
function pageArchives() {
  setTitle('Archives');
  const list = S.archives || [];
  $('#page').innerHTML = `<div class="print-title">Archives des remplacements</div>
  <div class="small muted" style="margin-bottom:10px">Historique des r\u00E9partitions de cr\u00E9neaux enregistr\u00E9es \u00E0 chaque clic sur \u00AB Fin du remplacement \u00BB depuis une fiche AESH.</div>
  ${list.length ? list.map(ar => { const periode = ar.absenceDebut || ar.absenceFin ? ` \u00B7 absence du ${ar.absenceDebut ? new Date(ar.absenceDebut).toLocaleDateString('fr-FR') : '?'} au ${ar.absenceFin ? new Date(ar.absenceFin).toLocaleDateString('fr-FR') : '?'}` : '';
    const byRemp = {}; ar.remplacements.forEach(r => { (byRemp[r.remplacantNom] ||= []).push(r); });
    return `<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(ar.aeshNom)}</h2><span class="small muted">archiv\u00E9 le ${new Date(ar.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${periode}</span></div>
      ${Object.entries(byRemp).map(([nom, rs]) => `<div style="margin-top:8px"><b>${esc(nom)}</b> a couvert :<ul style="margin:4px 0 0;padding-left:18px">${rs.map(r => `<li>${esc(r.eleveNom)} \u2014 ${JOURS[r.jour - 1]} ${r.debut}-${r.fin}${r.groupe ? ' (' + r.groupe + ')' : ''}</li>`).join('')}</ul></div>`).join('')}
      </div>`; }).join('') : '<div class="empty">Aucune archive pour l\'instant.</div>'}`;
}

/* ====================== PARAMÈTRES / EXPORTS ====================== */
function carteDossiers() {
  const d = DOSS, nbRat = Object.values(d.docs.parEleve).reduce((t, l) => t + l.length, 0);
  const dateFr2 = m => m ? new Date(m).toLocaleDateString('fr-FR') : '—';
  const src = d.source === 'dossier' ? 'Les dossiers sont lus en direct à chaque ouverture de l\'application et au retour sur la fenêtre.' : `Version navigateur / téléphone : liste générée le ${d.maj ? new Date(d.maj).toLocaleString('fr-FR') : '—'} (l'application Mac lit les dossiers en direct).`;
  const edtRows = sortAesh(S.aesh).map(a => { const f = d.edt.parAesh[a.id]; return `<tr><td>${esc(a.nom)}</td><td class="small">${f ? esc(f.name) : (a.edt ? '<span class="muted">' + esc(a.edt) + ' (copie enregistrée)</span>' : '<span class="muted">aucun fichier</span>')}</td><td class="small">${f ? dateFr2(f.mtime) : '—'}</td></tr>`; }).join('');
  const classer = d.docs.aClasser.map(a => `<li><a href="javascript:ouvrirDoc(${a.fichier.i})">${esc(a.fichier.name)}</a> <span class="small muted">— ${a.candidats.length ? 'élève douteux : ' + a.candidats.map(e => esc(e.nom + ' ' + e.prenom)).join(' / ') : 'aucun élève reconnu'}</span></li>`).join('');
  return `<div class="card" style="margin-top:14px"><h2>Documents et EDT papier <span class="small muted">mise à jour automatique</span></h2>
    <p class="small muted" style="margin:0 0 8px">${src} Dossiers : « Aménagements / Notifications » (${d.nbDocs} fichier${d.nbDocs > 1 ? 's' : ''}, ${nbRat} rattaché${nbRat > 1 ? 's' : ''} à un élève) et « EDT AESH » (${d.nbEdt} fichier${d.nbEdt > 1 ? 's' : ''}). Rien à saisir : dépose les fichiers dans les dossiers, chaque année, avec <b>NOM Prénom</b> dans le nom du fichier ; l'EDT papier le plus récent de chaque AESH remplace l'ancien.</p>
    <h3 style="margin:10px 0 4px">Documents à classer <span class="pill ${d.docs.aClasser.length ? 'warn' : 'ok'}">${d.docs.aClasser.length}</span></h3>
    ${d.docs.aClasser.length ? `<p class="small muted" style="margin:0 0 4px">Ces fichiers ne portent pas de nom d'élève reconnu (ou l'élève n'a pas de fiche) : renomme-les dans le dossier avec NOM Prénom, ils se rangeront seuls.</p><ul style="margin:0;padding-left:18px">${classer}</ul>` : '<p class="small muted" style="margin:0">Tous les fichiers sont rattachés à un élève.</p>'}
    <h3 style="margin:12px 0 4px">EDT papier des AESH</h3>
    <table class="t compact"><thead><tr><th>AESH</th><th>Fichier affiché</th><th>Modifié le</th></tr></thead><tbody>${edtRows}</tbody></table>
    ${d.edt.aClasser.length ? `<p class="small" style="color:var(--warn);margin:6px 0 0">Fichiers « EDT AESH » non reconnus : ${d.edt.aClasser.map(f => esc(f.name)).join(', ')}</p>` : ''}
  </div>`;
}
function pageParametres() {
  setTitle('Données & exports'); setTimeout(() => { if (location.hash === '#/parametres') $('#page').insertAdjacentHTML('beforeend', carteDossiers()); }, 0);
  $('#page').innerHTML = `<div class="grid g2">
   <div class="card"><h2>Établissement</h2><div class="form-grid"><label class="f">Nom<input type="text" id="p-etab" value="${esc(S.etablissement)}"></label><label class="f">Année scolaire<input type="text" id="p-annee" value="${esc(S.annee)}"></label></div><div class="toolbar" style="margin:10px 0 0"><button class="btn primary" onclick="S.etablissement=document.getElementById('p-etab').value;S.annee=document.getElementById('p-annee').value;commit('param','Paramètres modifiés');toast('Enregistré')">Enregistrer</button></div>
    <h2 style="margin-top:18px">Sauvegarde JSON</h2><p class="small muted">Le JSON contient tout (élèves, AESH, affectations, créneaux, journal). C'est ta sauvegarde de référence : exporte-le après chaque séance de travail et garde-le dans un dossier sûr.</p>
    <div class="toolbar"><button class="btn primary" onclick="exportJSON()">Exporter JSON</button><label class="btn">Importer JSON<input type="file" accept=".json" class="sr" onchange="importJSON(this.files[0])"></label></div>
    <h2 style="margin-top:18px">Excel / CSV</h2><p class="small muted">Excel = 4 onglets (Élèves, AESH, Affectation, Créneaux). Nécessite une connexion la première fois (librairie chargée à la volée) ; sinon le CSV fonctionne hors ligne.</p>
    <div class="toolbar"><button class="btn" onclick="exportExcel()">Exporter Excel</button><button class="btn" onclick="exportCSV()">Exporter CSV (élèves)</button></div>
    <h2 style="margin-top:18px">Word</h2><p class="small muted">Documents .doc ouvrables dans Word / LibreOffice : liste des élèves, fiche élève (depuis sa page), fiche AESH (depuis sa page), synthèse.</p>
    <div class="toolbar"><button class="btn" onclick="exportWordListe()">Liste élèves</button><button class="btn" onclick="exportWordSynthese()">Synthèse</button></div>
    <h2 style="margin-top:18px">PDF</h2><p class="small muted">Chaque page a une mise en page d'impression : ouvre la page voulue puis « Imprimer / PDF » (choisir « Enregistrer au format PDF »). Les fiches élève et AESH tiennent sur une page A4.</p></div>
   <div class="card"><h2>Zone de danger</h2><p class="small muted">Réinitialiser remet les données de départ (import des tableaux Individuels / Mutualisés). Tes saisies dans ce navigateur sont perdues — exporte un JSON avant.</p>
    <div class="toolbar"><button class="btn danger" onclick="if(confirm('Remettre les données initiales ? Tes modifications seront perdues.')){localStorage.removeItem('${KEY}');location.reload()}">Réinitialiser</button>
    <button class="btn danger" onclick="if(confirm('Supprimer tous les créneaux du planning ?')){S.creneaux=[];commit('planning','Planning vidé')}">Vider le planning</button></div>
    <h2 style="margin-top:18px">Listes de valeurs</h2><p class="small">Statuts de dossier : ${STATUTS.map(s => `<span class="pill neutral">${s}</span>`).join(' ')}</p><p class="small">Sites : ${SITES.join(', ')} · Niveaux : ${NIVEAUX.join(', ')}</p>
    <h2 style="margin-top:18px">Chiffres</h2><p class="small muted">${S.eleves.length} élèves (${S.eleves.filter(e => e.archive).length} archivés) · ${S.aesh.length} AESH · ${S.classes.length} classes · ${S.affectations.length} affectations · ${S.creneaux.length} créneaux · ${S.journal.length} entrées de journal · ${(JSON.stringify(S).length / 1024).toFixed(0)} Ko</p></div></div>
  ${carteRegles()}
  ${carteCalendrier()}`;
}
/* ---- Calendrier scolaire (à mettre à jour chaque année) ---- */
function carteCalendrier() {
  const cal = S.calendrier; const fr = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const semaines = []; if (cal.refLundi) { const d = lundiDe(aujourdhui()); for (let i = 0; i < 10; i++) { const iso = isoLocal(d); const q = quinzaineDe(iso); semaines.push(`<span class="pill ${q === 'Q1' ? 'indiv' : q === 'Q2' ? 'mutu' : 'neutral'}" title="Semaine du ${fr(iso)}">${fr(iso)} : ${q || 'vacances'}</span>`); d.setDate(d.getDate() + 7); } }
  const inp = (t, v, js, w = '') => `<input type="${t}" value="${esc(v || '')}" onchange="${js}" ${w ? `style="width:${w}"` : ''}>`;
  return `<div class="card" style="margin-top:14px"><h2>Calendrier scolaire <span class="small muted">à mettre à jour chaque année</span></h2>
    <p class="small muted" style="margin:0 0 10px"><b>Comment lire :</b> Q1 et Q2 sont les deux semaines qui alternent ; elles alternent uniquement sur les semaines de cours (les vacances sont sautées). Un créneau « Q1 seulement » ou « Q2 seulement » compte 0,5 h en moyenne ; un créneau des deux semaines compte 1 h. Légende : mauve = Q1, vert = Q2, gris = vacances.</p>
    <div class="form-grid"><label class="f">Année scolaire<input type="text" value="${esc(cal.annee || S.annee)}" onchange="setCal('annee',this.value)"></label>
      <label class="f">Lundi d'une semaine de référence<input type="date" value="${cal.refLundi || ''}" onchange="setCal('refLundi',this.value)"></label>
      <label class="f">Cette semaine de référence est en<select onchange="setCal('refQ',this.value)"><option ${cal.refQ === 'Q1' ? 'selected' : ''}>Q1</option><option ${cal.refQ === 'Q2' ? 'selected' : ''}>Q2</option></select></label></div>
    <div style="margin:10px 0">${semaines.join(' ') || '<span class="muted small">Renseigne une semaine de référence pour voir l\'alternance.</span>'}</div>
    <div class="grid g2"><div><h3 style="margin:8px 0">Vacances</h3>
      <table class="t compact"><thead><tr><th>Nom</th><th>Du</th><th>Au</th><th></th></tr></thead><tbody>${(cal.vacances || []).map((v, i) => `<tr><td>${inp('text', v.nom, `setCalLigne('vacances',${i},'nom',this.value)`, '110px')}</td><td>${inp('date', v.debut, `setCalLigne('vacances',${i},'debut',this.value)`)}</td><td>${inp('date', v.fin, `setCalLigne('vacances',${i},'fin',this.value)`)}</td><td><button class="btn sm ghost" onclick="delCalLigne('vacances',${i})" title="Retirer">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucune période.</td></tr>'}</tbody></table>
      <button class="btn sm" style="margin-top:6px" onclick="addCalLigne('vacances')">+ Période de vacances</button></div>
    <div><h3 style="margin:8px 0">Jours fériés</h3>
      <table class="t compact"><thead><tr><th>Nom</th><th>Date</th><th></th></tr></thead><tbody>${(cal.feries || []).map((v, i) => `<tr><td>${inp('text', v.nom, `setCalLigne('feries',${i},'nom',this.value)`, '150px')}</td><td>${inp('date', v.date, `setCalLigne('feries',${i},'date',this.value)`)}</td><td><button class="btn sm ghost" onclick="delCalLigne('feries',${i})" title="Retirer">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucun jour férié.</td></tr>'}</tbody></table>
      <button class="btn sm" style="margin-top:6px" onclick="addCalLigne('feries')">+ Jour férié</button></div></div>
    <div class="toolbar" style="margin:12px 0 0"><button class="btn danger" onclick="nouvelleAnneeCalendrier()">Préparer une nouvelle année</button><span class="small muted">vide les vacances et jours fériés, pour les ressaisir</span></div></div>`;
}
window.setCal = (k, v) => { S.calendrier[k] = v; commit('param', `Calendrier : ${k} modifié`); };
window.setCalLigne = (liste, i, k, v) => { S.calendrier[liste][i][k] = v; commit('param', `Calendrier : ${liste} modifié`); };
window.addCalLigne = liste => { S.calendrier[liste].push(liste === 'vacances' ? { nom: '', debut: '', fin: '' } : { nom: '', date: '' }); commit('param', `Calendrier : ligne ajoutée (${liste})`); };
window.delCalLigne = (liste, i) => { S.calendrier[liste].splice(i, 1); commit('param', `Calendrier : ligne retirée (${liste})`); };
window.nouvelleAnneeCalendrier = () => { if (!confirm('Vider les vacances et les jours fériés pour préparer la nouvelle année scolaire ? (les créneaux ne sont pas touchés)')) return; const an = prompt('Nouvelle année scolaire (ex. 2027-2028) :', ''); if (an === null) return; S.calendrier = { annee: an || '', refLundi: '', refQ: 'Q1', vacances: [], feries: [] }; commit('param', 'Calendrier : nouvelle année préparée'); };
window.cockpitSync = { cle: KEY, appliquer: d => { S = migrate(d); localStorage.setItem(KEY, JSON.stringify(S)); render(); } }; // synchro chiffrée (js/sync.js)
window.exportJSON = () => dl(`cockpit-pas_${S.annee}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S, null, 1));
window.importJSON = file => { if (!file) return; const r = new FileReader(); r.onload = () => { try { const d = JSON.parse(r.result); if (!d.eleves || !d.aesh) throw 0; S = migrate(d); log('import', `JSON importé : ${file.name}`); save(); render(); toast('Import réussi'); } catch { alert('Fichier JSON invalide.'); } }; r.readAsText(file); };
const csvLine = arr => arr.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';');
function elevesRows() { return S.eleves.map(e => { const c = couverture(e); return { Nom: e.nom, Prénom: e.prenom, Site: e.site, Niveau: e.niveau, Classe: e.classe, Type: e.type, Statut: e.statut, "Nombre d'heures à couvrir": e.heures ?? '', 'Heures prévisionnelles': e.heuresPrev ?? '', 'Heures couvertes': couvertes(e), Couverture: c.l, AESH: affOf(e).filter(a => a.heures > 0).map(a => `${aesh(a.aeshId)?.nom} (${a.heures} h)`).join(', '), GEVASCO: e.gevasco, 'Fin notification': e.notifFin, 'N° dossier': e.numDossier, Adresse: e.adresse, Responsables: e.responsables, Téléphone: e.tel, Remarques: e.remarques, Archivé: e.archive ? 'oui' : '', 'Aménagements PPS': ppsCount(e) }; }); }
window.exportCSV = () => { const rows = elevesRows(); dl('eleves.csv', '\uFEFF' + csvLine(Object.keys(rows[0])) + '\n' + rows.map(r => csvLine(Object.values(r))).join('\n'), 'text/csv'); };
window.exportExcel = async () => {
  if (!window.XLSX) { toast('Chargement de la librairie…'); await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }).catch(() => alert('Impossible de charger la librairie Excel (pas de connexion). Utilise l\'export CSV.')); if (!window.XLSX) return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(elevesRows()), 'Élèves');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.aesh.map(a => { const c = charge(a); return { AESH: a.nom, Site: a.site, Quotité: a.quotite ?? '', Individuel: c.ind, Mutualisé: c.mut, Total: c.tot, Reste: c.reste ?? '', 'Nb élèves': c.n, Statut: c.l }; })), 'AESH');
  const grid = sortEleves(S.eleves.filter(isActive)).map(e => { const o = { Élève: `${e.nom} ${e.prenom}`, Classe: e.classe, Cible: e.heures ?? '' }; S.aesh.forEach(a => { const x = S.affectations.find(z => z.eleveId === e.id && z.aeshId === a.id); o[a.nom] = x && x.heures ? x.heures : ''; }); o.Total = couvertes(e); return o; });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grid), 'Affectation');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.creneaux.map(c => ({ Élève: eleve(c.eleveId) ? eleve(c.eleveId).nom + ' ' + eleve(c.eleveId).prenom : '', Classe: eleve(c.eleveId)?.classe, AESH: aesh(c.aeshId)?.nom, Jour: JOURS[c.jour - 1], Début: c.debut, Fin: c.fin }))), 'Créneaux');
  XLSX.writeFile(wb, `cockpit-pas_${S.annee}.xlsx`);
};
function wordDoc(title, body) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial;font-size:11pt}h1{font-size:16pt}h2{font-size:13pt;color:#2F4A8A;margin-top:14pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;font-size:10pt}th{background:#E4EAF6}</style></head><body><h1>${esc(title)}</h1><p style="color:#666">${esc(S.etablissement || '')} · ${esc(S.annee)} · édité le ${new Date().toLocaleDateString('fr-FR')}</p>${body}</body></html>`;
  dl(title.replace(/[^\w\dàâäéèêëîïôöùûüç -]/gi, '').replace(/\s+/g, '_') + '.doc', html, 'application/msword');
}
window.exportWordListe = () => { const rows = sortEleves(S.eleves.filter(isActive)); wordDoc('Liste des élèves suivis', `<table><tr><th>Nom</th><th>Prénom</th><th>Classe</th><th>Type</th><th>Statut</th><th>Heures</th><th>Couverture</th><th>AESH</th></tr>${rows.map(e => `<tr><td>${esc(e.nom)}</td><td>${esc(e.prenom)}</td><td>${esc(e.classe)}</td><td>${e.type}</td><td>${esc(statutTxt(e))}</td><td>${hf(e.heures)}</td><td>${couverture(e).l}</td><td>${affOf(e).filter(a => a.heures > 0).map(a => esc(aesh(a.aeshId)?.nom) + ' (' + a.heures + ' h)').join(', ')}</td></tr>`).join('')}</table>`); };
window.exportWordEleve = id => { const e = eleve(id); const c = couverture(e); const r = (k, v) => `<tr><th style="width:35%;text-align:left">${k}</th><td>${v || '—'}</td></tr>`;
  wordDoc(`Fiche élève ${e.nom} ${e.prenom}`, `<h2>Identité</h2><table>${r('Nom', esc(e.nom))}${r('Prénom', esc(e.prenom))}${r('Classe', esc(e.classe) + ' (' + e.site + ')')}${r('Professeur principal', esc(e.pp))}${r('Adresse', esc(e.adresse))}${r('Responsables légaux', esc(e.responsables))}${r('Téléphone', esc(e.tel))}${r('E-mail', esc(e.email))}</table>
  <h2>Notification MDPH</h2><table>${r('Type d\'accompagnement', e.type)}${r('Statut du dossier', esc(statutTxt(e)))}${r('N° dossier', esc(e.numDossier))}${r("Nombre d'heures à couvrir", hf(e.heures))}${r('Heures prévisionnelles', e.heuresPrev ? hf(e.heuresPrev) : '')}${r('Période', (e.notifDebut || '?') + ' → ' + (e.notifFin || '?'))}${r('Validité GEVASCO', e.gevasco)}${r('Couverture', c.l + ' (' + hf(couvertes(e)) + ')')}</table>
  <h2>AESH affectés</h2><table><tr><th>AESH</th><th>Heures / semaine</th></tr>${affOf(e).map(a => `<tr><td>${esc(aesh(a.aeshId)?.nom)}</td><td>${hf(a.heures)}</td></tr>`).join('') || '<tr><td colspan="2">Aucun</td></tr>'}</table>
  <h2>Créneaux</h2><table><tr><th>Jour</th><th>Horaire</th><th>AESH</th></tr>${S.creneaux.filter(x => x.eleveId === id).sort((p, q) => p.jour - q.jour || t2m(p.debut) - t2m(q.debut)).map(x => `<tr><td>${JOURS[x.jour - 1]}</td><td>${x.debut}–${x.fin}</td><td>${esc(aesh(x.aeshId)?.nom)}</td></tr>`).join('') || '<tr><td colspan="3">Aucun</td></tr>'}</table>
  <h2>Remarques</h2><p>${esc(e.remarques) || '—'}</p>`); };
window.exportWordAesh = id => { const a = aesh(id); const c = charge(a);
  wordDoc(`Fiche AESH ${a.nom}`, `<table><tr><th>Site</th><td>${a.site}</td></tr><tr><th>Quotité hebdo</th><td>${a.quotite ?? '?'} h</td></tr><tr><th>Individuel / Mutualisé</th><td>${hf(c.ind)} / ${hf(c.mut)}</td></tr><tr><th>Total affecté</th><td>${hf(c.tot)}</td></tr><tr><th>Reste disponible</th><td>${c.reste == null ? '?' : hf(c.reste)}</td></tr></table>
  <h2>Élèves suivis</h2><table><tr><th>Élève</th><th>Classe</th><th>Type</th><th>Heures</th></tr>${affOfAesh(a).map(x => { const e = eleve(x.eleveId); return `<tr><td>${esc(e.nom)} ${esc(e.prenom)}</td><td>${esc(e.classe)}</td><td>${e.type}</td><td>${hf(x.heures)}</td></tr>`; }).join('')}</table>
  <h2>Emploi du temps</h2><table><tr><th>Jour</th><th>Horaire</th><th>Élève</th></tr>${S.creneaux.filter(x => x.aeshId === id).sort((p, q) => p.jour - q.jour || t2m(p.debut) - t2m(q.debut)).map(x => `<tr><td>${JOURS[x.jour - 1]}</td><td>${x.debut}–${x.fin}</td><td>${esc(eleve(x.eleveId)?.nom)} ${esc(eleve(x.eleveId)?.prenom)} (${esc(eleve(x.eleveId)?.classe)})</td></tr>`).join('') || '<tr><td colspan="3">Aucun</td></tr>'}</table>`); };
window.exportWordSynthese = () => { const rows = SITES.map(s => { const st = stats(S.eleves.filter(e => e.site === s)), rs = ressource(s); return `<tr><td>${s}</td><td>${st.n}</td><td>${st.ind}</td><td>${st.mut}</td><td>${st.pending}</td><td>${hf(st.cible)}</td><td>${hf(st.couv)}</td><td>${hf(st.reste)}</td><td>${rs.n}</td><td>${hf(rs.vol)}</td><td>${hf(rs.reste)}</td></tr>`; }).join('');
  const g = stats(S.eleves), r = ressource();
  wordDoc('Synthèse PAS', `<table><tr><th>Élèves suivis</th><td>${g.n}</td><th>Nombre d'heures à couvrir</th><td>${hf(g.cible)}</td></tr><tr><th>Individuels / mutualisés</th><td>${g.ind} / ${g.mut}</td><th>Heures couvertes</th><td>${hf(g.couv)}</td></tr><tr><th>Dossiers en cours</th><td>${g.pending}</td><th>Volume AESH / reste</th><td>${hf(r.vol)} / ${r.manq ? '?' : hf(r.reste)}</td></tr></table>
  <h2>Par site</h2><table><tr><th>Site</th><th>Suivis</th><th>Indiv.</th><th>Mutu.</th><th>Dossiers</th><th>Cibles</th><th>Couvertes</th><th>Reste</th><th>AESH</th><th>Volume</th><th>Dispo</th></tr>${rows}</table>
  <h2>Alertes</h2><ul>${alertes().map(a => `<li>${esc(a.t)}</li>`).join('') || '<li>Aucune</li>'}</ul>`); };


/* ====================== REPÈRES ====================== */
const REPERES = [
 { id: 'plans', t: 'PPRE, PAP, PAI, PPS : quel plan pour qui ?', body: `
  <p>Quatre plans encadrent la scolarité des élèves à besoins particuliers. Trois se décident <b>dans l'établissement</b> ; seul le PPS passe par la <b>MDPH</b>.</p>
  <div class="rep-grid">
   <div class="rep-box" style="--c:#3C7FB1"><b>PPRE</b><span>Programme personnalisé de réussite éducative</span><p>Élève en difficulté sur des compétences du socle. Plan d'actions <b>court</b>, pédagogique, décidé par l'équipe. Pas d'avis médical.</p></div>
   <div class="rep-box" style="--c:#D98F17"><b>PAP</b><span>Plan d'accompagnement personnalisé</span><p>Difficultés <b>durables</b> liées à un trouble des apprentissages (dys, TDAH…), <b>sans</b> reconnaissance de handicap. Avis du médecin scolaire, aménagements pédagogiques (examens compris). Remplace un PPRE qui ne suffit plus.</p></div>
   <div class="rep-box" style="--c:#2E8B57"><b>PAI</b><span>Projet d'accueil individualisé</span><p>Maladie chronique, allergie, intolérance. Traitement, protocole d'urgence, aménagements de la scolarité. Établi avec le médecin scolaire. Un peu à part des trois autres.</p></div>
   <div class="rep-box" style="--c:#6D4BB5"><b>PPS</b><span>Projet personnalisé de scolarisation</span><p><b>Handicap reconnu par la MDPH.</b> Feuille de route de la scolarité : aménagements, matériel adapté, orientation (ULIS…), <b>aide humaine (AESH)</b>. Décidé par la CDAPH, suivi par l'enseignant référent et l'ESS. Il absorbe le PAP ou le PPRE en cours.</p></div>
  </div>
  <svg viewBox="0 0 720 110" class="rep-svg"><defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5 0 10z" fill="#66717F"/></marker></defs>
   <text x="10" y="18" font-size="12" fill="#66717F">Progressivité (hors PAI)</text>
   <g font-size="13" font-weight="600" fill="#fff"><rect x="10" y="40" width="150" height="44" rx="8" fill="#3C7FB1"/><text x="85" y="59" text-anchor="middle">PPRE</text><text x="85" y="76" text-anchor="middle" font-weight="400" font-size="11">difficulté ponctuelle</text>
   <rect x="230" y="40" width="150" height="44" rx="8" fill="#D98F17"/><text x="305" y="59" text-anchor="middle">PAP</text><text x="305" y="76" text-anchor="middle" font-weight="400" font-size="11">trouble durable</text>
   <rect x="450" y="40" width="260" height="44" rx="8" fill="#6D4BB5"/><text x="580" y="59" text-anchor="middle">PPS</text><text x="580" y="76" text-anchor="middle" font-weight="400" font-size="11">handicap reconnu → MDPH / CDAPH</text></g>
   <line x1="165" y1="62" x2="225" y2="62" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/><line x1="385" y1="62" x2="445" y2="62" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
   <text x="10" y="104" font-size="11" fill="#66717F">Décidés dans l'établissement (chef d'établissement / équipe / médecin scolaire)</text><text x="450" y="104" font-size="11" fill="#66717F">Décidé hors établissement</text></svg>
  <p class="rep-src">Sources : <a href="https://www.monparcourshandicap.gouv.fr/scolarite/ppre-pai-pap-pps-en-quoi-consistent-les-differentes-possibilites-dappui-la-scolarisation" target="_blank">monparcourshandicap.gouv.fr</a> · <a href="https://eduscol.education.fr/document/21427/download" target="_blank">Éduscol – Quel plan pour qui ?</a> · <a href="https://aefe.gouv.fr/fr/articles/amenagements-pedagogiques-pai-ppre-pap-pps" target="_blank">AEFE</a></p>` },
 { id: 'mdph', t: 'MDPH et CDAPH : le circuit d\'une demande', body: `
  <p>La <b>MDPH</b> (Maison départementale des personnes handicapées) instruit les demandes ; la <b>CDAPH</b> (Commission des droits et de l'autonomie) est l'instance qui <b>décide</b> et notifie. L'école ne demande jamais un AESH directement : elle documente les besoins, la <b>famille</b> dépose la demande.</p>
  <svg viewBox="0 0 820 260" class="rep-svg">
   <g font-size="12" fill="#1B2430">
    <rect x="10" y="20" width="148" height="66" rx="8" fill="#E4EAF6" stroke="#2F4A8A"/><text x="84" y="42" text-anchor="middle" font-weight="600">1 · Équipe éduc.</text><text x="84" y="60" text-anchor="middle" font-size="10.5">repère les besoins,</text><text x="84" y="74" text-anchor="middle" font-size="10.5">remplit le GEVA-Sco</text>
    <rect x="170" y="20" width="148" height="66" rx="8" fill="#FBF0DA" stroke="#D98F17"/><text x="244" y="42" text-anchor="middle" font-weight="600">2 · Famille</text><text x="244" y="60" text-anchor="middle" font-size="10.5">dépose le dossier : Cerfa,</text><text x="244" y="74" text-anchor="middle" font-size="10.5">certif. médical, GEVA-Sco</text>
    <rect x="330" y="20" width="148" height="66" rx="8" fill="#E1F3F0" stroke="#1C8C7A"/><text x="404" y="42" text-anchor="middle" font-weight="600">3 · MDPH</text><text x="404" y="60" text-anchor="middle" font-size="10.5">équipe pluridisciplinaire</text><text x="404" y="74" text-anchor="middle" font-size="10.5">évalue, propose un plan</text>
    <rect x="490" y="20" width="148" height="66" rx="8" fill="#EEE8F9" stroke="#6D4BB5"/><text x="564" y="42" text-anchor="middle" font-weight="600">4 · CDAPH</text><text x="564" y="60" text-anchor="middle" font-size="10.5">décide : PPS, AESH</text><text x="564" y="74" text-anchor="middle" font-size="10.5">indiv. / mutu., ULIS…</text>
    <rect x="650" y="20" width="148" height="66" rx="8" fill="#E3F3E9" stroke="#2E8B57"/><text x="724" y="42" text-anchor="middle" font-weight="600">5 · Notification</text><text x="724" y="60" text-anchor="middle" font-size="10.5">envoyée à la famille</text><text x="724" y="74" text-anchor="middle" font-size="10.5">et à l'établissement</text>
    <line x1="158" y1="53" x2="168" y2="53" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/><line x1="318" y1="53" x2="328" y2="53" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/><line x1="478" y1="53" x2="488" y2="53" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/><line x1="638" y1="53" x2="648" y2="53" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
    <rect x="170" y="138" width="468" height="78" rx="8" fill="#F3F5F8" stroke="#CBD3DC"/><text x="404" y="160" text-anchor="middle" font-weight="600">6 · Mise en œuvre et suivi dans l'établissement</text><text x="404" y="178" text-anchor="middle" font-size="10.5">Enseignant référent (ERSEH) · ESS au moins une fois par an</text><text x="404" y="192" text-anchor="middle" font-size="10.5">GEVA-Sco de réexamen pour renouveler la notification</text><text x="404" y="206" text-anchor="middle" font-size="10.5">Le coordonnateur PAS affecte les AESH selon les notifications</text>
    <path d="M724 86 L724 116 L500 116 L500 136" fill="none" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
    <path d="M300 138 L300 116 L84 116 L84 90" fill="none" stroke="#66717F" stroke-width="2" stroke-dasharray="4 3" marker-end="url(#ar)"/><text x="150" y="110" font-size="10" fill="#66717F">renouvellement</text>
    <text x="10" y="232" font-size="10.5" fill="#66717F">Instruction : souvent plusieurs mois → déposer bien avant la rentrée visée.</text><text x="10" y="248" font-size="10.5" fill="#66717F">Si la famille ne donne pas suite sous 4 mois à une proposition de PPS, la MDPH est informée.</text>
   </g></svg>
  <p><b>Aide humaine notifiée :</b> <span class="pill indiv">individuelle</span> = attention soutenue et continue, quotité horaire fixée, l'AESH ne peut pas s'occuper d'un autre élève en même temps · <span class="pill mutu">mutualisée</span> = l'AESH accompagne plusieurs élèves, pas de quotité imposée par la CDAPH, c'est l'établissement (PAS) qui répartit.</p>
  <p class="rep-src">Sources : <a href="https://www.monparcourshandicap.gouv.fr/scolarite/quest-ce-que-le-geva-sco" target="_blank">monparcourshandicap.gouv.fr – GEVA-Sco</a> · <a href="https://www.monparcourshandicap.gouv.fr/scolarite/quels-sont-les-accompagnements-notifies-par-la-mdph" target="_blank">accompagnements notifiés</a> · <a href="https://www.mdph31.fr/qui-fait-quoi-dans-le-parcours-de-scolarisation/" target="_blank">MDPH 31 – qui fait quoi</a> · <a href="https://eduscol.education.fr/document/21181/download" target="_blank">Éduscol – livret d'accueil AESH</a></p>` },
 { id: 'ulis', t: 'ULIS : comment fonctionne le dispositif', body: `
  <p>L'<b>ULIS</b> (Unité localisée pour l'inclusion scolaire) est un <b>dispositif</b>, pas une classe : l'élève garde sa classe de référence et alterne entre inclusion en classe ordinaire et temps de regroupement avec l'enseignant spécialisé.</p>
  <svg viewBox="0 0 720 210" class="rep-svg">
   <g font-size="12" fill="#1B2430">
    <rect x="10" y="20" width="160" height="50" rx="8" fill="#EEE8F9" stroke="#6D4BB5"/><text x="90" y="41" text-anchor="middle" font-weight="600">Orientation CDAPH</text><text x="90" y="58" text-anchor="middle" font-size="11">inscrite dans le PPS</text>
    <line x1="170" y1="45" x2="215" y2="45" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
    <rect x="220" y="10" width="280" height="190" rx="12" fill="#F3F5F8" stroke="#CBD3DC"/><text x="360" y="32" text-anchor="middle" font-weight="600">Établissement</text>
    <rect x="235" y="45" width="115" height="70" rx="8" fill="#E1F3F0" stroke="#1C8C7A"/><text x="292" y="66" text-anchor="middle" font-weight="600">Regroupement</text><text x="292" y="82" text-anchor="middle" font-size="11">ULIS</text><text x="292" y="98" text-anchor="middle" font-size="11">coordonnateur + AESH-co</text>
    <rect x="370" y="45" width="115" height="70" rx="8" fill="#E4EAF6" stroke="#2F4A8A"/><text x="427" y="66" text-anchor="middle" font-weight="600">Classe de</text><text x="427" y="82" text-anchor="middle" font-size="11">référence</text><text x="427" y="98" text-anchor="middle" font-size="11">inclusion (+ AESH-co)</text>
    <path d="M352 70 L368 70" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/><path d="M368 92 L352 92" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
    <text x="360" y="140" text-anchor="middle" font-size="11">Emploi du temps individuel fixé par le coordonnateur</text><text x="360" y="156" text-anchor="middle" font-size="11">selon le PPS de chaque élève</text>
    <text x="360" y="185" text-anchor="middle" font-size="11" fill="#66717F">Le coordonnateur planifie aussi les interventions de l'AESH-co</text>
    <rect x="530" y="20" width="180" height="90" rx="8" fill="#FBF0DA" stroke="#D98F17"/><text x="620" y="41" text-anchor="middle" font-weight="600">AESH-co (collectif)</text><text x="620" y="60" text-anchor="middle" font-size="11">rattaché au dispositif,</text><text x="620" y="75" text-anchor="middle" font-size="11">pas notifié par la CDAPH,</text><text x="620" y="90" text-anchor="middle" font-size="11">sous l'autorité pédagogique</text><text x="620" y="104" text-anchor="middle" font-size="11">du coordonnateur</text>
    <line x1="500" y1="65" x2="528" y2="65" stroke="#66717F" stroke-width="2" marker-end="url(#ar)"/>
   </g></svg>
  <ul class="rep-list">
   <li><b>Qui décide ?</b> L'orientation en ULIS est une décision de la CDAPH ; l'affectation dans tel établissement relève de l'Éducation nationale.</li>
   <li><b>Le coordonnateur</b> est un enseignant spécialisé : il enseigne lors des regroupements, coordonne le dispositif et conseille les collègues (personne ressource).</li>
   <li><b>AESH-co</b> : un accompagnant collectif fait partie du fonctionnement de l'ULIS. Sauf besoin particulier (soins physiologiques, certains TSA), un AESH individuel ou mutualisé n'est donc pas attribué en plus.</li>
   <li><b>Pour le PAS :</b> les élèves ULIS de ton tableau (« Lycée ULIS ») ne consomment normalement pas les heures des AESH mutualisés, sauf notification spécifique.</li>
  </ul>
  <p class="rep-src">Sources : <a href="https://www.education.gouv.fr/bo/15/Hebdo31/MENE1504950C.htm" target="_blank">Circulaire n° 2015-129 (BO)</a> · <a href="https://www.ih2ef.gouv.fr/unite-localisee-pour-linclusion-scolaire-ulis" target="_blank">IH2EF – ULIS</a> · <a href="https://www.education.gouv.fr/etre-accompagnant-des-eleves-en-situation-de-handicap-aesh-12188" target="_blank">education.gouv.fr – AESH</a></p>` },
 { id: 'acteurs', t: 'Qui fait quoi autour d\'un élève notifié', body: `
  <div class="rep-grid">
   <div class="rep-box" style="--c:#2F4A8A"><b>Famille</b><span>demande, décide</span><p>Seule à pouvoir saisir la MDPH. Membre de droit de l'ESS.</p></div>
   <div class="rep-box" style="--c:#1C8C7A"><b>Enseignant référent (ERSEH)</b><span>suit le parcours</span><p>Réunit l'ESS au moins une fois par an, rédige le GEVA-Sco de réexamen, interlocuteur des parents.</p></div>
   <div class="rep-box" style="--c:#D98F17"><b>ESS</b><span>Équipe de suivi de scolarisation</span><p>Vérifie que le PPS est appliqué, propose des ajustements (aménagements, aide humaine, tiers-temps…).</p></div>
   <div class="rep-box" style="--c:#6D4BB5"><b>Coordonnateur PAS / AESH</b><span>met en œuvre</span><p>Affecte les AESH selon les notifications, organise les emplois du temps, arbitre la mutualisation.</p></div>
   <div class="rep-box" style="--c:#C8443C"><b>Chef d'établissement</b><span>responsable</span><p>Informe la famille quand un PPS semble nécessaire, valide PPRE / PAP / PAI, garant de la mise en œuvre.</p></div>
   <div class="rep-box" style="--c:#2E8B57"><b>Médecin scolaire</b><span>avis médical</span><p>Indispensable pour le PAP et le PAI.</p></div>
  </div>
  <p class="rep-src">Sources : <a href="https://www.savoie.fr/web/sw_57803/MDPH/Ecoleparcoursetaidesalascolarisation" target="_blank">MDPH Savoie</a> · <a href="https://www.mdph31.fr/qui-fait-quoi-dans-le-parcours-de-scolarisation/" target="_blank">MDPH 31</a></p>` }
];
const BIBLIO = [
 { cat: 'Cadre légal général', items: [
   { t: 'Loi n° 2005-102 du 11 février 2005', s: "Pour l'égalité des droits et des chances, la participation et la citoyenneté des personnes handicapées. Pose le principe de la scolarisation en milieu ordinaire et crée les MDPH.", url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000809647/' },
   { t: 'Loi n° 2019-791 du 26 juillet 2019', s: "Pour une école de la confiance. Sécurise le statut des AESH (CDI possible après 3 ans de CDD, contrats de 3 ans) et crée les PIAL.", url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000038829065/' },
 ]},
 { cat: 'Statut et missions des AESH', items: [
   { t: 'Décret n° 2014-724 du 27 juin 2014', s: "Conditions de recrutement et d'emploi des AESH. Crée le statut de contractuel AESH (auparavant AVS/EVS).", url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000029154865/' },
   { t: 'Circulaire n° 2017-084 du 3 mai 2017', s: "Missions et activités des personnels chargés de l'accompagnement des élèves en situation de handicap. Texte de référence : détaille les 3 grands types d'aide (actes de la vie quotidienne, accès aux apprentissages, vie sociale et relationnelle) et la distinction individuel / mutualisé.", url: 'https://www.education.gouv.fr/bo/17/Hebdo17/MENE1710105C.htm' },
   { t: 'Vadémécum « L\'accompagnant des élèves en situation de handicap »', s: "Guide pratique du ministère : rôle au quotidien, posture professionnelle, relation avec l'enseignant et la famille. Régulièrement mis à jour.", url: 'https://eduscol.education.fr/1057/accompagnement-des-eleves-en-situation-de-handicap' },
 ]},
 { cat: 'Organisation (PIAL) et scolarisation', items: [
   { t: 'Circulaire n° 2019-090 du 5 juin 2019', s: "Déploiement des pôles inclusifs d'accompagnement localisés (PIAL) : mutualisation et pilotage territorial des moyens humains d'accompagnement.", url: 'https://www.education.gouv.fr/bo/19/Hebdo23/MENE1915610C.htm' },
   { t: 'Circulaire n° 2016-117 du 8 août 2016', s: "Parcours de formation des élèves en situation de handicap dans les écoles et établissements scolaires. Cadre le PPS et son document de mise en œuvre.", url: 'https://www.education.gouv.fr/bo/16/Hebdo31/MENE1620951C.htm' },
   { t: 'Arrêté du 6 février 2015', s: "Modèle du document de mise en œuvre du PPS utilisé dans le module « PPS · Mise en œuvre » de cette appli.", url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000030245741/' },
 ]},
 { cat: 'Académie de Lyon — ressources AESH', items: [
   { t: 'Vademecum académique AESH (septembre 2025)', s: "Document de référence du rectorat de Lyon : prise de poste, missions, hiérarchie, temps de travail, contrat, congés et absences, droits. Vérifié le 15/09/2026 sur le site officiel de l'académie — c'est la version la plus récente, elle remplace celle d'avril 2023.", url: 'https://www.ac-lyon.fr/media/47550/download' },
   { t: 'Livret d\'accueil AESH', s: "Document d'accueil remis à la prise de poste : repères pratiques pour bien démarrer.", url: 'https://www.ac-lyon.fr/media/15635/download' },
   { t: 'Fiche de poste AESH', s: "Fiche de poste officielle du rectorat, référence pour les entretiens et le suivi RH.", url: 'https://www.ac-lyon.fr/media/15637/download' },
   { t: 'Annuaire académique AESH', s: "Coordonnées des interlocuteurs académiques (DSDEN Ain/Rhône/Loire, PIAL/PAS, gestion RH).", url: 'https://www.ac-lyon.fr/media/60026/download' },
   { t: 'Page « AESH : ressources utiles » — Académie de Lyon', s: "Page officielle centralisant tous les documents pratiques : remboursement de frais, absences, messagerie académique, ENSAP, PIAL/PAS. Mise à jour juin 2026, c'est la page à consulter en cas de doute ou pour une info manquante ici.", url: 'https://www.ac-lyon.fr/accompagnants-des-eleves-en-situation-de-handicap-aesh-ressources-utiles-121914' },
 ]},
];
function pageBibliotheque() {
  setTitle('Bibliothèque');
  $('#page').innerHTML = `<div class="print-title">Bibliothèque — réglementation de l'accompagnement des élèves</div>
  <p class="muted" style="margin:0 0 14px">Textes de référence sur les AESH et l'école inclusive, avec un résumé et un lien vers le texte officiel. Les circulaires peuvent être mises à jour ou remplacées : en cas de doute, vérifie la version en vigueur sur <a href="https://www.legifrance.gouv.fr" target="_blank">Légifrance</a>.</p>
  ${BIBLIO.map(g => `<h3 style="margin:18px 0 8px">${esc(g.cat)}</h3><div class="grid g2">${g.items.map(it => `<div class="card"><h2 style="margin:0 0 6px;font-size:15px">${esc(it.t)}</h2><p class="small" style="margin:0 0 8px">${esc(it.s)}</p><a class="small" href="${it.url}" target="_blank">Lire le texte officiel ↗</a></div>`).join('')}</div>`).join('')}`;
}
function pageReperes() {
  setTitle('Repères');
  const open = (location.hash.split('/')[2]) || 'plans';
  $('#page').innerHTML = `<div class="print-title">Repères — dispositifs de l'école inclusive</div><p class="muted" style="margin:0 0 14px">Les grandes lignes, sans le détail réglementaire. Clique sur un titre pour l'ouvrir. Les liens en bas de chaque fiche mènent aux textes officiels.</p>
  ${REPERES.map(r => `<div class="card rep ${open === r.id ? 'open' : ''}" id="rep-${r.id}"><h2 class="rep-h" onclick="location.hash='#/reperes/${r.id}'"><span class="rep-arrow">▸</span>${esc(r.t)}</h2><div class="rep-body">${r.body}</div></div>`).join('')}`;
}


/* ====================== PPS — DOCUMENT DE MISE EN ŒUVRE ====================== */
const PPS_COLS = e => e.site === 'Collège' ? ['6e', '5e', '4e', '3e'] : ['3e', '2nde', '1ère', 'Tle'];
const PPS_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const PPS_MOMENTS = [['matin', 'Matin'], ['dej', 'Déjeuner'], ['apm', 'Après-midi'], ['peri', 'Périscolaire']];
function mopps(e) {
  if (!e.mopps) e.mopps = { etabMedico: '', annee: '', objectifs: '', articulation: '', priorites: '', miseEnOeuvre1: '', amenagementsPreco: '', miseEnOeuvre2: '', aeshType: '', aeshHeures: '', aeshPct: '', aeshActivites: [], materiel: '', edt: {}, checks: {}, autres: {}, visas: {} };
  return e.mopps;
}
const itemLabel = id => { for (const s of window.MOPPS_ITEMS) for (const [i, l] of s.items) if (i === id) return l; return id; };
function ppsSummary(e, niveau) {
  const m = e.mopps; if (!m) return [];
  const out = [];
  for (const s of window.MOPPS_ITEMS) {
    const its = s.items.filter(([i]) => (m.checks[i] || []).includes(niveau)).map(([, l]) => l);
    const autre = (m.autres[s.id] || '').trim();
    if (its.length || autre) out.push({ titre: s.titre, items: its, autre });
  }
  return out;
}
const ppsCount = e => e.mopps ? Object.values(e.mopps.checks).reduce((s, arr) => s + (arr.length ? 1 : 0), 0) : 0;
function pagePPS() {
  setTitle('PPS · Documents de mise en œuvre');
  const list = S.classes.filter(c => !view.classeSite || c.site === view.classeSite).sort(cmpClasse);
  $('#page').innerHTML = `<div class="print-title">Documents de mise en œuvre du PPS</div><div class="toolbar"><div class="seg"><button class="${!view.classeSite ? 'on' : ''}" onclick="setView('classeSite','')">Tous</button>${SITES.map(s => `<button class="${view.classeSite === s ? 'on' : ''}" onclick="setView('classeSite','${s}')">${s}</button>`).join('')}</div>
   <span class="small muted">Un document par élève, prérempli avec sa fiche. Le nombre indique les aménagements déjà cochés. Clic sur un élève pour ouvrir son document.</span></div>
  <div class="grid g3">${list.map(c => { const el = sortEleves(elevesDe(c)); if (!el.length) return '';
    return `<div class="card"><h2 style="margin-bottom:8px">${esc(c.nom)} <span class="small muted">${c.site} · ${el.length} élève${el.length > 1 ? 's' : ''}</span></h2>
    <div style="display:flex;flex-direction:column;gap:5px">${el.map(e => { const n = ppsCount(e); return `<a href="#/pps/${e.id}" class="pps-row"><span class="dot" style="background:var(--${e.type === 'Individuel' ? 'indiv' : 'mutu'})"></span><b>${esc(e.nom)}</b>&nbsp;${esc(e.prenom)}<span class="grow"></span>${e.mopps?.aeshType ? `<span class="pill neutral">${esc(e.mopps.aeshType)}</span>` : ''}<span class="pill ${n ? 'ok' : 'neutral'}">${n} aménagement${n > 1 ? 's' : ''}</span></a>`; }).join('')}</div></div>`; }).join('')}</div>`;
}
function pagePPSForm(id) {
  const e = eleve(id); if (!e) { location.hash = '#/pps'; return; }
  const m = mopps(e); const cols = PPS_COLS(e);
  setTitle(`PPS · ${e.nom} ${e.prenom}`, `<a class="btn" href="#/eleves/${id}">Fiche élève</a> <button class="btn" onclick="exportWordPPS('${id}')">Word</button> <span class="small muted" style="margin-left:8px">Enregistrement automatique</span>`);
  const T = (k, label, rows = 2) => `<label class="f"><span>${label}</span><textarea rows="${rows}" oninput="ppsSet('${id}','${k}',this.value)">${esc(m[k])}</textarea></label>`;
  const I = (k, label, type = 'text') => `<label class="f"><span>${label}</span><input type="${type}" value="${esc(m[k])}" onchange="ppsSet('${id}','${k}',this.value)"></label>`;
  const ro = (label, v) => `<label class="f"><span>${label}</span><input type="text" value="${esc(v)}" readonly style="background:#F3F5F8" title="Modifiable depuis la fiche élève"></label>`;
  // emploi du temps : créneaux AESH auto + texte libre
  const cr = S.creneaux.filter(x => x.eleveId === id);
  const edt = PPS_JOURS.map((j, d) => `<tr><th>${j}</th>${PPS_MOMENTS.map(([k, l]) => { const auto = cr.filter(x => x.jour === d + 1 && (k === 'matin' ? t2m(x.debut) < 12 * 60 : k === 'apm' ? t2m(x.debut) >= 13 * 60 : false)).map(x => `${x.debut}–${x.fin} ${aesh(x.aeshId)?.nom || ''}`).join('\n'); const v = m.edt[d + '.' + k] ?? '';
    return `<td><textarea rows="2" placeholder="${esc(auto)}" oninput="ppsSet('${id}','edt.${d}.${k}',this.value)">${esc(v)}</textarea></td>`; }).join('')}</tr>`).join('');
  const activ = window.MOPPS_AESH_ACTIVITES.map(g => `<div class="pps-group"><h3>${esc(g.g)}</h3>${g.items.map(([i, l]) => `<label class="pps-check"><input type="checkbox" ${m.aeshActivites.includes(i) ? 'checked' : ''} onchange="ppsToggleAct('${id}','${i}',this.checked)"><span>${esc(l)}</span></label>`).join('')}</div>`).join('');
  let lastPart = '';
  const sections = window.MOPPS_ITEMS.map(s => { const head = s.part !== lastPart ? `<h2 class="pps-part">${esc(s.part)}</h2>` : ''; lastPart = s.part;
    return `${head}<div class="card pps-sec"><table class="pps-t"><thead><tr><th>${esc(s.titre)}</th>${cols.map(c => `<th class="c ${c === e.niveau ? 'cur' : ''}">${c}</th>`).join('')}</tr></thead><tbody>
    ${s.items.map(([i, l]) => `<tr class="${(m.checks[i] || []).length ? 'on' : ''}"><td>${esc(l)}</td>${cols.map(c => `<td class="c"><input type="checkbox" ${(m.checks[i] || []).includes(c) ? 'checked' : ''} onchange="ppsToggle('${id}','${i}','${c}',this.checked)"></td>`).join('')}</tr>`).join('')}
    <tr><td colspan="${cols.length + 1}"><input type="text" placeholder="Autre(s) :" value="${esc(m.autres[s.id] || '')}" onchange="ppsSet('${id}','autres.${s.id}',this.value)"></td></tr></tbody></table></div>`; }).join('');
  const visas = `<table class="pps-t"><thead><tr><th></th>${cols.map(c => `<th class="c">${c}</th>`).join('')}</tr></thead><tbody>${[['date', 'Date'], ['parents', 'Visa des parents'], ['eleve', 'Visa de l\'élève'], ['chef', 'Visa du chef d\'établissement']].map(([k, l]) => `<tr><td>${l}</td>${cols.map(c => `<td class="c"><input type="text" value="${esc(m.visas[c + '.' + k] || '')}" onchange="ppsSet('${id}','visas.${c}.${k}',this.value)"></td></tr>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('#page').innerHTML = `<div class="pps-doc">
   <div class="pps-head"><div><div class="small muted">Projet personnalisé de scolarisation</div><h2 style="font-size:20px;margin:0">Document de mise en œuvre – Second degré</h2><div class="small muted">En application de l'arrêté du 6 février 2015 relatif au PPS · circulaire du 08/08/2016 · ${esc(S.etablissement || '')}</div></div><div class="avatar" style="background:var(--${e.type === 'Individuel' ? 'indiv' : 'mutu'})">${esc(e.prenom[0] || '')}${esc(e.nom[0] || '')}</div></div>
   <div class="card"><h2>Renseignements administratifs</h2><div class="form-grid">${ro('Nom', e.nom)}${ro('Prénom', e.prenom)}${ro('Classe', e.classe + ' · ' + e.site)}${ro('Adresse', e.adresse)}${ro('Téléphone', e.tel)}${ro('Courriel', e.email)}</div>
    <div class="form-grid" style="margin-top:12px">${ro('Établissement scolaire', S.etablissement || '')}${I('etabMedico', 'Établissement ou service médico-social')}${I('annee', 'Année scolaire')}${ro('Niveau actuel', e.niveau)}</div></div>
   <div class="card"><h2>Emploi du temps de l'élève</h2><p class="small muted">Articulation entre temps d'enseignement, périscolaire et interventions (psychologiques, éducatives, médicales…), répartition entre les lieux, horaires de présence de l'AESH. Les créneaux AESH du planning apparaissent en grisé : tape par-dessus pour les compléter.</p>
    <table class="pps-t edt"><thead><tr><th>Semaine</th>${PPS_MOMENTS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${edt}</tbody></table></div>
   <div class="card"><h2>Préconisations de la MDPH : priorités, objectifs et préconisations</h2><div class="form-grid">${T('objectifs', '1. Objectifs pédagogiques (PPS point 2)', 3)}${T('articulation', 'Articulation enseignement / périscolaire / interventions', 3)}${T('priorites', 'Priorités complémentaires', 2)}<div class="wide">${T('miseEnOeuvre1', 'Mise en œuvre des priorités et objectifs', 3)}</div>${T('amenagementsPreco', '2. Aménagements préconisés (PPS point 4)', 3)}${T('miseEnOeuvre2', 'Mise en œuvre des aménagements préconisés', 3)}</div></div>
   <div class="card"><h2>Notifications de la CDAPH — 1. Aide humaine (PPS point 3)</h2>
    <div class="form-grid"><label class="f"><span>AESH (en cohérence avec la notification)</span><select onchange="ppsSet('${id}','aeshType',this.value)"><option value="">—</option>${['AESH-I (individuelle)', 'AESH-M (mutualisée)', 'AESH-Co (collective / ULIS)'].map(o => `<option ${m.aeshType === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>${I('aeshHeures', 'Nombre d\'heures (AESH-I)', 'text')}${I('aeshPct', 'ou % du temps de scolarisation', 'text')}${ro('Dans l\'application', e.type + (e.heures ? ' · ' + hf(e.heures) : '') + ' · ' + affOf(e).filter(a => a.heures > 0).map(a => aesh(a.aeshId)?.nom).join(', '))}</div>
    <p class="small muted" style="margin-top:10px">Déclinaison des activités principales prescrites par la CDAPH :</p><div class="pps-acts">${activ}</div></div>
   <div class="card"><h2>Notifications de la CDAPH — 2. Matériel pédagogique adapté (PPS point 3)</h2>${T('materiel', 'Utilisation du matériel pédagogique par discipline', 3)}</div>
   <div class="pps-legend small muted">Aménagements et adaptations : coche les colonnes de niveau concernées. La colonne surlignée est le niveau actuel de l'élève ; ce qui y est coché remonte automatiquement dans sa fiche.</div>
   ${sections}
   <div class="card"><h2>Visas</h2>${visas}</div></div>`;
}
window.ppsSet = (id, path, v) => { const e = eleve(id); const m = mopps(e); const p = path.split('.'); if (p.length === 1) m[p[0]] = v; else if (p[0] === 'edt') m.edt[p[1] + '.' + p[2]] = v; else if (p[0] === 'autres') m.autres[p[1]] = v; else if (p[0] === 'visas') m.visas[p[1] + '.' + p[2]] = v; save(); };
window.ppsToggle = (id, item, niv, on) => { const e = eleve(id); const m = mopps(e); const arr = m.checks[item] || []; m.checks[item] = on ? [...new Set([...arr, niv])] : arr.filter(x => x !== niv); if (!m.checks[item].length) delete m.checks[item];
  log('pps', `${e.nom} ${e.prenom} · PPS ${niv} : ${on ? '☑' : '☐'} ${itemLabel(item).slice(0, 60)}`); save(); const row = document.activeElement?.closest('tr'); if (row) row.classList.toggle('on', !!(m.checks[item] || []).length); };
window.ppsToggleAct = (id, item, on) => { const e = eleve(id); const m = mopps(e); m.aeshActivites = on ? [...new Set([...m.aeshActivites, item])] : m.aeshActivites.filter(x => x !== item); save(); };
window.exportWordPPS = id => { const e = eleve(id); const m = mopps(e); const cols = PPS_COLS(e); const r = (k, v) => `<tr><th style="width:35%;text-align:left">${k}</th><td>${v || ''}</td></tr>`;
  const secs = window.MOPPS_ITEMS.map(s => `<h2>${esc(s.part)} — ${esc(s.titre)}</h2><table><tr><th>Aménagements et adaptations</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${s.items.map(([i, l]) => `<tr><td>${esc(l)}</td>${cols.map(c => `<td style="text-align:center">${(m.checks[i] || []).includes(c) ? '☑' : '☐'}</td>`).join('')}</tr>`).join('')}<tr><td colspan="${cols.length + 1}">Autre(s) : ${esc(m.autres[s.id] || '')}</td></tr></table>`).join('');
  const edt = `<table><tr><th>Semaine</th>${PPS_MOMENTS.map(([, l]) => `<th>${l}</th>`).join('')}</tr>${PPS_JOURS.map((j, d) => `<tr><th>${j}</th>${PPS_MOMENTS.map(([k]) => `<td>${esc(m.edt[d + '.' + k] || '').replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table>`;
  const acts = window.MOPPS_AESH_ACTIVITES.map(g => `<p><b>${esc(g.g)}</b></p><ul>${g.items.map(([i, l]) => `<li>${m.aeshActivites.includes(i) ? '☑' : '☐'} ${esc(l)}</li>`).join('')}</ul>`).join('');
  wordDoc(`PPS mise en oeuvre ${e.nom} ${e.prenom}`, `<p><i>Projet personnalisé de scolarisation — Document de mise en œuvre, second degré. En application de l'arrêté du 6 février 2015, circulaire du 08/08/2016.</i></p>
  <h2>Renseignements administratifs</h2><table>${r('Nom', esc(e.nom))}${r('Prénom', esc(e.prenom))}${r('Adresse', esc(e.adresse))}${r('Téléphone', esc(e.tel))}${r('Courriel', esc(e.email))}${r('Établissement scolaire', esc(S.etablissement))}${r('Établissement ou service médico-social', esc(m.etabMedico))}${r('Année scolaire', esc(m.annee))}${r('Classe', esc(e.classe))}</table>
  <h2>Emploi du temps</h2>${edt}
  <h2>Préconisations de la MDPH</h2><table>${r('Objectifs pédagogiques', esc(m.objectifs))}${r('Articulation', esc(m.articulation))}${r('Priorités complémentaires', esc(m.priorites))}${r('Mise en œuvre', esc(m.miseEnOeuvre1))}${r('Aménagements préconisés', esc(m.amenagementsPreco))}${r('Mise en œuvre', esc(m.miseEnOeuvre2))}</table>
  <h2>Notifications de la CDAPH — aide humaine</h2><table>${r('AESH', esc(m.aeshType))}${r('Nombre d\'heures', esc(m.aeshHeures))}${r('% du temps', esc(m.aeshPct))}</table>${acts}
  <h2>Matériel pédagogique adapté</h2><p>${esc(m.materiel)}</p>${secs}
  <h2>Visas</h2><table><tr><th></th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${[['date', 'Date'], ['parents', 'Visa des parents'], ['eleve', 'Visa de l\'élève'], ['chef', 'Chef d\'établissement']].map(([k, l]) => `<tr><td>${l}</td>${cols.map(c => `<td>${esc(m.visas[c + '.' + k] || '')}</td>`).join('')}</tr>`).join('')}</table>`); };

/* ====================== MODAL ====================== */
// Absence terminée : éléments qui lui sont rattachés (remplacements archivés, remplacements partiels, prises faites en ligne)
function liensAbsence(ab) {
  const d = ab.debut || '';
  return { arch: (S.archives || []).filter(r => r.aeshId === ab.aeshId && (r.absenceDebut || '') === d), segs: (S.segmentsRempl || []).filter(g => g.absentId === ab.aeshId && (g.absDebut || '') === d),
    prises: (S.prisesOcc || []).filter(p => p.absentId === ab.aeshId && p.date >= (ab.fin && ab.fin < d ? ab.fin : d) && p.date <= (ab.fin && ab.fin > d ? ab.fin : (ab.fin ? d : '9999-12-31'))) };
}
window.supprimerPriseOcc = occId => {
  const p = (S.prisesOcc || []).find(x => x.occId === occId); if (!p) return;
  const r = aesh(p.remplacantId), ab = aesh(p.absentId);
  if (!confirm(`Supprimer cette ligne ?\n${frDate(p.date)} ${hh(p.debut)}–${hh(p.fin)} — absence de ${ab ? ab.nom : '?'}, pris par ${r ? r.nom : '?'}.\n\nElle disparaît de Cockpit (compteurs et heures de remplacement comprises). Si la prise existe encore dans l'appli en ligne, elle n'y est pas supprimée.`)) return;
  S.prisesOcc = S.prisesOcc.filter(x => x !== p); S.prisesVues = (S.prisesVues || []).filter(x => x !== occId);
  commit('aesh', `Prise en ligne supprimée : ${frDate(p.date)} ${hh(p.debut)}–${hh(p.fin)}, ${ab ? ab.nom : '?'} remplacé.e par ${r ? r.nom : '?'}`);
};
window.modifierAbsence = id => {
  const ab = (S.absences || []).find(x => x.id === id); if (!ab || ab.ouvert) return;
  const motifs = MOTIFS_ABSENCE.includes(ab.motif) ? MOTIFS_ABSENCE : [ab.motif, ...MOTIFS_ABSENCE].filter(Boolean);
  const L = liensAbsence(ab), nbLiens = L.arch.length + L.segs.length + L.prises.length;
  modal(`<h2>Modifier une absence terminée</h2><div class="form-grid">
    <label class="f wide">AESH<select name="aid">${sortAesh(S.aesh).map(a => `<option value="${a.id}" ${a.id === ab.aeshId ? 'selected' : ''}>${esc(a.nom)}</option>`).join('')}</select></label>
    <label class="f">Motif<select name="motif">${motifs.map(m => `<option ${m === ab.motif ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label class="f">Du<input type="date" name="debut" value="${esc(ab.debut || '')}" required></label>
    <label class="f">Au<input type="date" name="fin" value="${esc(ab.fin || '')}" required></label></div>
    <p class="small muted">Les remplacements rattachés à cette absence (${nbLiens ? nbLiens + ' élément' + (nbLiens > 1 ? 's' : '') : 'aucun'}) suivent la modification. « Supprimer » efface l'absence${nbLiens ? ' et ces éléments' : ''} : l'AESH n'est pas modifiée.</p>`, d => {
    if (!d.debut || !d.fin) { toast('Les deux dates sont obligatoires.'); return false; }
    if (d.fin < d.debut) { toast('La date de fin est avant la date de début.'); return false; }
    const a = aesh(d.aid); if (!a) return false;
    if ((S.absences || []).some(x => x !== ab && x.aeshId === d.aid && x.debut === d.debut && (x.fin || '') === d.fin && !x.ouvert)) { toast('Cette absence existe déjà pour cette AESH.'); return false; }
    L.arch.forEach(r => { r.aeshId = d.aid; r.aeshNom = a.nom; r.absenceDebut = d.debut; r.absenceFin = d.fin; });
    L.segs.forEach(g => { g.absentId = d.aid; g.absDebut = d.debut; g.absFin = d.fin; });
    L.prises.forEach(p => { p.absentId = d.aid; });
    const avant = `${(aesh(ab.aeshId) || {}).nom || '?'}, ${ab.motif}, ${frDate(ab.debut)} → ${frDate(ab.fin)}`;
    ab.aeshId = d.aid; ab.motif = d.motif; ab.debut = d.debut; ab.fin = d.fin;
    commit('aesh', `Absence terminée modifiée (${avant}) → ${a.nom}, ${d.motif}, ${frDate(d.debut)} → ${frDate(d.fin)}`); setTimeout(() => publierAuto(), 100);
  }, () => {
    if (!confirm(`Supprimer l'absence de ${(aesh(ab.aeshId) || {}).nom || '?'} (${ab.motif}, ${ab.debut ? frDate(ab.debut) : '—'} → ${ab.fin ? frDate(ab.fin) : '—'}) ?${nbLiens ? `\n\nSont aussi supprimés : ${L.arch.length} remplacement(s) archivé(s), ${L.segs.length} remplacement(s) partiel(s), ${L.prises.length} prise(s) faite(s) en ligne.` : ''}`)) return;
    S.absences = S.absences.filter(x => x !== ab); S.archives = (S.archives || []).filter(r => !L.arch.includes(r)); S.segmentsRempl = (S.segmentsRempl || []).filter(g => !L.segs.includes(g)); S.prisesOcc = (S.prisesOcc || []).filter(p => !L.prises.includes(p));
    commit('aesh', `Absence supprimée : ${(aesh(ab.aeshId) || {}).nom || '?'}, ${ab.motif}, ${ab.debut ? frDate(ab.debut) : '—'} → ${ab.fin ? frDate(ab.fin) : '—'}`);
  });
};
function modal(html, onSave, onDelete) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog"><form id="mform" onsubmit="return false">${html}<div class="acts">${onDelete ? '<button type="button" class="btn danger" id="m-del" style="margin-right:auto">Supprimer</button>' : ''}<button type="button" class="btn" onclick="closeModal()">Annuler</button><button type="submit" class="btn primary" id="m-ok">Enregistrer</button></div></form></div></div>`;
  const form = $('#mform');
  $('#m-ok').onclick = ev => { ev.preventDefault(); const d = {}; new FormData(form).forEach((v, k) => d[k] = v); let r;
    try { r = onSave(d); } catch (err) { console.error(err); closeModal(); try { render(); } catch (e2) { } alert("Un problème est survenu pendant l'enregistrement : " + (err && err.message || err) + "\nVérifie la fiche ; si la modification n'apparaît pas, envoie ce message à Claude."); return; }
    if (r !== false) closeModal(); };
  form.onsubmit = e => { e.preventDefault(); $('#m-ok').click(); };
  if (onDelete) $('#m-del').onclick = () => { onDelete(); closeModal(); };
  const first = form.querySelector('input,select'); if (first) first.focus();
  document.onkeydown = e => { if (e.key === 'Escape') closeModal(); };
}
window.closeModal = () => { $('#modal').innerHTML = ''; document.onkeydown = null; };

/* ====================== INIT ====================== */
load(); { const nd = appliquerDossiers() + appliquerEss() + appliquerStatuts(); if (nd) { log('eleve', 'Fiches élèves mises à jour d\'après les documents (PPS, MOPPS, notifications, GEVASCO…)'); save(); } } chargerDossiers(); if (synchroDispositifs()) { log('affectation', 'Élèves ULIS / SEGPA rattachés automatiquement aux AESH de leur dispositif'); save(); } render(); verifierRetours(); essVerifierRappel(); setInterval(essVerifierRappel, 60000);
setInterval(verifierRetours, 3600 * 1000); evalsActualiser(true); prisesActualiser(true); setInterval(() => { evalsActualiser(true); prisesActualiser(true); }, 120000); setTimeout(() => { if (serveurOK()) publierAuto(); }, 4000); setInterval(() => { if (serveurOK() && S.pubJour !== aujourdhui()) publierAuto(); }, 600000); document.addEventListener('visibilitychange', () => { if (!document.hidden) { verifierRetours(); chargerDossiers(); } });
// Un clic sur « Synthèse » actualise toute l'application : relecture des fichiers de données (nouvelle version éventuelle) puis recalcul de toutes les pages. Les saisies sont déjà enregistrées, rien n'est perdu.
const lienSynthese = document.querySelector('#nav a[href="#/synthese"]');
if (lienSynthese) lienSynthese.addEventListener('click', ev => { ev.preventDefault(); try { sessionStorage.setItem('cockpit-actualise', '1'); } catch (e) { } location.hash = '#/synthese'; location.reload(); });
try { if (sessionStorage.getItem('cockpit-actualise')) { sessionStorage.removeItem('cockpit-actualise'); setTimeout(() => toast('Application actualisée'), 300); } } catch (e) { }
if (window.__dataJustRefreshed) { save(); setTimeout(() => toast('Données mises à jour automatiquement'), 300); }
window.PAS = { get state() { return S; }, save, render, quinzaineDe, dureeUnique, chevauchements };
})();
