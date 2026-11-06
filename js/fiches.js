/* Rubrique « Fiches élèves AESH » : ouvrir les fiches et changer le code d'équipe en cas de fuite.
   Le code d'équipe et la clé GitHub restent sur cet appareil (localStorage), jamais dans ce fichier public. */
(function () {
const URL_FICHES = 'https://cecilehanan-prog.github.io/cockpit-coordo/fiches-eleves.html';
const API = 'https://api.github.com/repos/cecilehanan-prog/cockpit-coordo/contents/fiches-eleves.html';
const K = 'cockpit-fiches-admin'; // { code, jeton, change }
const MOTS = 'abeille arbre automne balade bambou banane bateau biscuit bougie boussole brioche cactus cahier camion canard carotte cerise chapeau chocolat citron colibri comete crayon dauphin domino echarpe eclair epice etoile falaise fanfare farine fenetre flocon fontaine fougere fraise galet girafe glacier grenade guitare hibou horloge igloo jardin jonquille kiwi lagune lanterne lavande licorne lilas loutre lucarne mandarine manege marron melodie mimosa moulin muguet myrtille nuage oasis olive orange orage panda papillon pastel pelican piano pinceau pirate planete pomme prairie quartz radis raquette renard riviere robot rocher ruban sablier safran sapin satellite sirop soleil sorbet tambour tartine tilleul tortue toupie trefle tulipe vanille velo violon volcan wagon yaourt zebre'.split(' ');

const $ = q => document.querySelector(q);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); };
const setTitle = t => { $('#title').textContent = t; $('#topactions').innerHTML = ''; };
const lire = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
const ecrire = o => { try { localStorage.setItem(K, JSON.stringify(Object.assign(lire(), o))); } catch (e) {} };
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hasard = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const nouveauCode = () => [0, 1, 2].map(() => MOTS[hasard(MOTS.length)]).join('-') + '-' + (100 + hasard(900));

async function cle(code, sel, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function changerCode(etat) {
  const { code, jeton } = lire();
  const h = { Authorization: 'Bearer ' + jeton, Accept: 'application/vnd.github+json' };
  etat('Lecture de la page des fiches…');
  const r = await fetch(API + '?ref=main', { headers: h, cache: 'no-store' });
  if (r.status === 401 || r.status === 403) throw new Error('La clé GitHub est refusée. Recrée-la (étape 2) et colle-la de nouveau.');
  if (!r.ok) throw new Error('GitHub ne répond pas (' + r.status + '). Vérifie la connexion internet.');
  const f = await r.json();
  const html = new TextDecoder().decode(unb64(f.content.replace(/\n/g, '')));
  const m = html.match(/const DATA = "([^"]+)";/), it = html.match(/iterations:(\d+)/);
  if (!m || !it) throw new Error("La page des fiches n'a pas le format attendu. Rien n'a été changé.");
  const iter = +it[1];
  const [sel, iv, ct] = m[1].split('.').map(unb64);
  etat('Vérification du code actuel…');
  let clair;
  try { clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cle(code, sel, iter), ct); }
  catch (e) { throw new Error("Le code actuel enregistré ici n'ouvre pas les fiches. Corrige-le à l'étape 1. Rien n'a été changé."); }
  etat('Chiffrement avec le nouveau code…');
  const neuf = nouveauCode(), sel2 = crypto.getRandomValues(new Uint8Array(16)), iv2 = crypto.getRandomValues(new Uint8Array(12));
  const ct2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, await cle(neuf, sel2, iter), clair));
  const html2 = html.replace(m[0], 'const DATA = "' + [sel2, iv2, ct2].map(b64).join('.') + '";');
  etat('Publication sur GitHub…');
  const p = await fetch(API, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h),
    body: JSON.stringify({ message: "Fiches élèves : nouveau code d'équipe", content: b64(new TextEncoder().encode(html2)), sha: f.sha, branch: 'main' }) });
  if (!p.ok) throw new Error(p.status === 409 ? 'La page a changé entre-temps. Réessaie.' : 'La publication a échoué (' + p.status + '). Rien n\'a été changé.');
  ecrire({ code: neuf, change: new Date().toISOString() });
  return neuf;
}

window.fichesCopier = (t, b) => navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copié'; }, () => toast('Sélectionne le code et copie-le.'));
window.fichesSauver = () => {
  const c = document.getElementById('fa-code').value.trim(), j = document.getElementById('fa-jeton').value.trim();
  const o = {}; if (c) o.code = c.toLowerCase(); if (j) o.jeton = j; ecrire(o); toast('Enregistré sur cet appareil'); pageFichesAesh();
};
window.fichesDemander = () => { document.getElementById('fa-confirm').hidden = false; };
window.fichesAnnuler = () => { document.getElementById('fa-confirm').hidden = true; };
window.fichesGo = async () => {
  const msg = document.getElementById('fa-msg'), btn = document.getElementById('fa-go');
  btn.disabled = true; document.getElementById('fa-confirm').hidden = true;
  const etat = t => { msg.innerHTML = '<span class="muted">' + esc(t) + '</span>'; };
  try {
    const neuf = await changerCode(etat);
    msg.innerHTML = `<div style="background:#E9F7EE;border:1px solid #7CC596;border-radius:10px;padding:12px 14px;margin-top:10px">
      <b>Nouveau code : <span style="font-size:1.25em;font-family:ui-monospace,Menlo,monospace">${esc(neuf)}</span></b>
      <button class="btn sm" onclick="fichesCopier('${esc(neuf)}',this)">Copier</button>
      <p class="small" style="margin:8px 0 0">L'ancien code ne marche plus d'ici 1 à 2 minutes (le temps que GitHub publie). Donne le nouveau aux AESH de vive voix ou sur papier. Les puces et les QR codes ne changent pas.</p></div>`;
    setTimeout(pageFichesAesh, 30000);
  } catch (e) { msg.innerHTML = '<p style="color:var(--bad,#b3261e);font-weight:600">' + esc(e.message) + '</p>'; const d = document.getElementById('fa-reglages'); if (d) d.open = true; }
  btn.disabled = false;
};

window.pageFichesAesh = function () {
  setTitle('Fiches élèves AESH');
  const o = lire(), pret = o.code && o.jeton;
  $('#page').innerHTML = `
  <div class="card" style="margin-bottom:14px">
    <h2 style="margin-top:0">Ouvrir les fiches</h2>
    <p class="muted" style="margin:0 0 10px">Les fiches servent aux remplacements. Elles n'affichent qu'un code à 4 chiffres par élève ; la correspondance est dans le classeur.</p>
    <a class="btn primary" href="${URL_FICHES}" target="_blank" rel="noopener">Ouvrir les fiches élèves</a>
  </div>
  <div class="card" style="margin-bottom:14px">
    <h2 style="margin-top:0">Code d'équipe</h2>
    ${o.code ? `<p style="margin:0 0 6px">Code actuel : <b style="font-family:ui-monospace,Menlo,monospace;font-size:1.15em">${esc(o.code)}</b> <button class="btn sm" onclick="fichesCopier('${esc(o.code)}',this)">Copier</button></p>
    ${o.change ? `<p class="small muted" style="margin:0 0 10px">Changé le ${new Date(o.change).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}</p>` : ''}` : ''}
    <p>En cas de fuite du code, génère-en un nouveau : l'ancien cessera de fonctionner pour tout le monde.</p>
    <button class="btn primary" id="fa-go" onclick="fichesDemander()" ${pret ? '' : 'disabled title="Remplis d\'abord les réglages ci-dessous"'}>Générer un nouveau code</button>
    <div id="fa-confirm" hidden style="margin-top:10px;background:#FFF4E0;border:1px solid #E8B35A;border-radius:10px;padding:10px 14px">
      Toutes les AESH devront taper le nouveau code au prochain scan. Continuer ?
      <span style="display:inline-flex;gap:8px;margin-left:8px"><button class="btn sm primary" onclick="fichesGo()">Oui, changer le code</button><button class="btn sm" onclick="fichesAnnuler()">Annuler</button></span>
    </div>
    <div id="fa-msg"></div>
  </div>
  <details class="card" id="fa-reglages" ${pret ? '' : 'open'}>
    <summary style="cursor:pointer;font-weight:600">Réglages (une seule fois sur cet appareil)${pret ? ' <span class="pill ok">faits</span>' : ' <span class="pill warn">à faire</span>'}</summary>
    <p class="small muted">Ces réglages restent sur cet appareil. Ils ne sont ni publiés, ni synchronisés.</p>
    <p><b>1. Code d'équipe actuel</b><br><input id="fa-code" class="input" style="width:100%;max-width:360px;padding:8px" placeholder="ex. mot-mot-mot-123" value="${esc(o.code || '')}" autocomplete="off"></p>
    <p><b>2. Clé GitHub</b> ${o.jeton ? '<span class="pill ok">enregistrée</span>' : ''}<br>
      <span class="small">Elle permet à Cockpit de republier la page des fiches. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Créer la clé sur GitHub</a> : nom « Cockpit fiches », expiration 1 an, « Only select repositories » → <b>cockpit-coordo</b>, puis Permissions → <b>Contents : Read and write</b>, et « Generate token ». Copie la clé et colle-la ici.</span><br>
      <input id="fa-jeton" type="password" class="input" style="width:100%;max-width:360px;padding:8px;margin-top:6px" placeholder="${o.jeton ? 'Laisse vide pour garder la clé actuelle' : 'github_pat_…'}" autocomplete="off"></p>
    <button class="btn primary" onclick="fichesSauver()">Enregistrer</button>
  </details>`;
};

// Cockpit ne connaît pas cette rubrique : on passe juste après son propre affichage.
function afficherSiFiches() {
  if (!/^#\/fiches/.test(location.hash)) return;
  window.pageFichesAesh();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/fiches'));
  const b = document.querySelector('.bandeau-ess'), b2 = document.querySelector('.bandeau-ess-j2'); [b, b2].forEach(x => x && x.remove());
}
window.addEventListener('hashchange', afficherSiFiches);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(afficherSiFiches, 0)); else setTimeout(afficherSiFiches, 0);
})();
