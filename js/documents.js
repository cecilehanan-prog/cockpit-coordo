/* ====================== DOCUMENTS (dossier « Aménagements / Notifications ») ======================
   Rapproche automatiquement chaque fichier du dossier de l'élève concerné, d'après son nom de fichier
   (nom + prénom, tolérant aux fautes de frappe, aux initiales, aux tirets / espaces) et le classe par type
   (MOPPS, PPS, MDPH / notification, PAI, PAP, GEVASCO). Rien n'est inventé : un fichier dont l'élève n'est pas
   identifié avec certitude reste « à classer ».
   Source de la liste des fichiers : l'application Mac la lit dans le dossier à chaque ouverture (window.cockpitFS) ;
   sinon (navigateur, téléphone) on utilise js/documents-index.js, généré par scripts/indexer_documents.py. */
(function () {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const lettres = s => norm(s).replace(/[^A-Z]/g, '');
  const MOTS_TYPE = ['GEVASCO', 'GEVACO', 'GEVASC', 'GEVAS', 'MOPPS', 'PPS', 'PAI', 'PAP', 'MDPH', 'MPA', 'AESHI', 'AESHM', 'AESH', 'ULIS', 'NDAHI', 'NDAHM', 'NDAH', 'REEX', 'BIS', 'CR', 'AVIS', 'AP', 'ITEP', 'SESSAD', 'AHI', 'ET', 'ORIENTATION', 'ORIENTATIONS', 'NOTIF', 'NOTIFICATION', 'DOSSIER', 'DE', 'H', 'ANNEE', 'CONTRAT', 'AMENAGEMENT', 'AMENAGEMENTS', 'SCOLARITE', 'CAS', 'D', 'DES', 'LA'];

  const TYPES = [
    ['MOPPS', /\bMOPPS\b/],
    ['PPS', /\bPPS\b/],
    ['PAI', /\bPAI\b/],
    ['PAP', /\bPAP\b/],
    ['GEVASCO', /\bGEVAS?C?O?\b|\bGEVACO\b|\bGEVASC\b/],
    ['Contrat d’aménagement', /\bCONTRAT\b.*\bAMENAGEMENTS?\b|\bCAS\b/],
    ['MDPH / notification', /\b(MDPH|NDAHI|NDAHM|NDAH|NOTIF\w*|AESHI|AESHM|MPA|ULIS|ORIENTATIONS?|CR AVIS)\b/],
  ];
  const ORDRE_TYPES = ['MOPPS', 'PPS', 'MDPH / notification', 'PAI', 'PAP', 'GEVASCO', 'Contrat d’aménagement', 'Autre document'];

  function typeDe(nom) {
    const s = norm(nom).replace(/\.[A-Z0-9]{2,4}$/, '').replace(/[_.\-()]/g, ' ');
    for (const [t, re] of TYPES) if (re.test(s)) return t;
    return 'Autre document';
  }
  function anneeDe(nom) {
    const s = String(nom).replace(/[_.]/g, ' ');
    let m = s.match(/(20\d\d)\s*[-\/ ]\s*(20\d\d)/); if (m) return m[1] + '-' + m[2];
    m = s.match(/\b(20\d\d)\b/); return m ? m[1] : '';
  }
  // partie « nom / prénom » du fichier : on retire l'extension, les chiffres, les mots de type et les parenthèses
  function nomDe(nom) {
    const brut = norm(nom).replace(/\.[A-Z0-9]{2,4}$/, '').replace(/\([^)]*\)/g, ' ').replace(/[^A-Z]+/g, ' ').trim();
    return brut.split(' ').filter(t => t && !MOTS_TYPE.includes(t));
  }
  // distance d'édition avec transposition (« DUPOND » ≈ « DUPONT »)
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  const tolerance = len => len >= 7 ? 2 : len >= 5 ? 1 : 0;

  // score d'un élève pour un fichier (null = pas de correspondance)
  function score(tokens, e, nomUnique) {
    const L = tokens.join(''); if (!L) return null;
    const N = lettres(e.nom), P = lettres(e.prenom);
    const tol = tolerance(N.length);
    let meilleur = null;
    // disposition « NOM Prénom » puis « Prénom NOM »
    for (const ordre of ['NP', 'PN']) {
      for (let dl = -tol; dl <= tol; dl++) {
        const ln = N.length + dl; if (ln < 3 || ln > L.length) continue;
        const nomPart = ordre === 'NP' ? L.slice(0, ln) : L.slice(L.length - ln);
        const reste = ordre === 'NP' ? L.slice(ln) : L.slice(0, L.length - ln);
        const dN = lev(nomPart, N); if (dN > tol) continue;
        let dP, bonus;
        if (!reste) { if (!nomUnique) continue; dP = 0; bonus = 0; }
        else if (reste.length === 1) { if (reste !== P[0]) continue; dP = 0; bonus = 2; }
        else if (P.startsWith(reste) || reste.startsWith(P)) { dP = 0; bonus = 6; }
        else if (reste.length >= 3 && reste[0] === P[0] && lev(reste, P.slice(0, reste.length)) <= 1) { dP = 1; bonus = 3; } // diminutif : « Anto » ≈ « Anthony »
        else if (reste.length >= 4 && P.includes(reste)) { dP = 1; bonus = 2; } // prénom composé : « David » pour « Ghis-David »
        else { dP = lev(reste, P); if (dP > (P.length >= 5 ? 1 : 0)) continue; bonus = 3; }
        const sc = 100 - 12 * dN - 6 * dP + bonus - Math.abs(dl);
        if (!meilleur || sc > meilleur) meilleur = sc;
      }
    }
    return meilleur;
  }

  // fichiers : [{name, rel, ...}] ; élèves : S.eleves  →  { parEleve: {id: [fichiers]}, aClasser: [{fichier, candidats}] }
  function rapprocher(fichiers, eleves) {
    const parEleve = {}, aClasser = [];
    const nbParNom = {}; eleves.forEach(e => { const k = lettres(e.nom); nbParNom[k] = (nbParNom[k] || 0) + 1; });
    (fichiers || []).forEach(f => {
      const tokens = nomDe(f.name);
      const info = { ...f, type: typeDe(f.name), annee: anneeDe(f.name) };
      const cands = [];
      eleves.forEach(e => { let sc = score(tokens, e, nbParNom[lettres(e.nom)] === 1); (e.alias || []).forEach(al => { const s2 = score(tokens, { ...e, prenom: al }, nbParNom[lettres(e.nom)] === 1); if (s2 != null && (sc == null || s2 > sc)) sc = s2; }); if (sc != null) cands.push({ e, sc }); });
      cands.sort((a, b) => b.sc - a.sc);
      if (cands.length && (cands.length === 1 || cands[0].sc - cands[1].sc >= 4)) (parEleve[cands[0].e.id] ||= []).push(info);
      else aClasser.push({ fichier: info, candidats: cands.slice(0, 3).map(c => c.e) });
    });
    const rang = t => ORDRE_TYPES.indexOf(t);
    Object.values(parEleve).forEach(l => l.sort((a, b) => rang(a.type) - rang(b.type) || String(b.annee).localeCompare(String(a.annee)) || a.name.localeCompare(b.name, 'fr')));
    return { parEleve, aClasser };
  }

  // EDT papier : « EDT NOM Prénom.jpeg » → AESH ; en cas de plusieurs fichiers pour la même AESH, le plus récent est retenu
  const MOTS_EDT = ['EDT', 'SEGPA', 'ULIS', 'COMPLET', 'ANNEE', 'ANNEES'];
  function rapprocherEdt(fichiers, aeshList) {
    const parAesh = {}, aClasser = [];
    const cibles = aeshList.map(a => { const p = String(a.nom).trim().split(/\s+/); return { id: a.id, prenom: p[0], nom: p.slice(1).join(' ') }; });
    (fichiers || []).filter(f => /\.(jpe?g|png|pdf|heic|webp)$/i.test(f.name)).forEach(f => {
      const tokens = norm(f.name).replace(/\.[A-Z0-9]{2,4}$/, '').replace(/[^A-Z]+/g, ' ').trim().split(' ').filter(t => t && !MOTS_EDT.includes(t));
      const cands = []; cibles.forEach(c => { const sc = score(tokens, c, true); if (sc != null) cands.push({ c, sc }); });
      cands.sort((a, b) => b.sc - a.sc);
      if (cands.length && (cands.length === 1 || cands[0].sc - cands[1].sc >= 4)) { const id = cands[0].c.id; const cur = parAesh[id]; if (!cur || (f.mtime || 0) > (cur.mtime || 0)) parAesh[id] = f; }
      else aClasser.push(f);
    });
    return { parAesh, aClasser };
  }

  window.DOCUMENTS = { rapprocher, rapprocherEdt, typeDe, anneeDe, ORDRE_TYPES, norm };
})();
