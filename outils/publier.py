#!/usr/bin/env python3
"""Copie le cockpit (dossier « pas » sur iCloud) dans ce dépôt, SANS aucune donnée d'élève ni d'AESH.

Usage : python3 outils/publier.py "<chemin du dossier pas>"

Ce qui est copié : index.html, css/, et le code de js/ (app.js, documents.js, mopps-items.js).
Ce qui n'est JAMAIS copié : data.js, dossiers-donnees.js, dossiers-index.js, pial-donnees.js, ess-donnees.js,
les EDT (images), exports, rapports, scripts et leur cache. Ils sont remplacés par des fichiers vides :
les données se chargent dans l'appli avec « Données & exports › Importer JSON » et restent dans le navigateur.
"""
import pathlib, re, shutil, sys

SRC = pathlib.Path(sys.argv[1]).expanduser()
DST = pathlib.Path(__file__).resolve().parent.parent

# Fichiers de code repris tels quels
for rel in ['css/app.css', 'js/mopps-items.js']:
    (DST / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC / rel, DST / rel)

# css : sur iPad, le menu de gauche doit pouvoir défiler (dans l'appli Mac, la fenêtre est assez haute)
with open(DST / 'css/app.css', 'a', encoding='utf-8') as f:
    f.write("\n/* Version en ligne (ajouté par outils/publier.py) : sur iPad, le menu de gauche doit pouvoir défiler,\n   et 100dvh suit la vraie hauteur de l'écran de Safari (barre d'adresse comprise). */\n#app{height:100vh;height:100dvh}\n.main{height:100vh;height:100dvh}\n.sidebar{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;min-height:0}\n")

# documents.js : un commentaire donnait en exemple le nom d'un élève
doc = (SRC / 'js/documents.js').read_text(encoding='utf-8')
doc = re.sub(r'« [A-Z]+ » ≈ « [A-Z]+ »', '« DUPOND » ≈ « DUPONT »', doc)
(DST / 'js/documents.js').write_text(doc, encoding='utf-8')

# app.js : on retire les questions pré-remplies (elles citent des élèves par leur nom)
app = (SRC / 'js/app.js').read_text(encoding='utf-8')
app, n1 = re.subn(r'^const QUESTIONS_INITIALES = \[.*\];$', 'const QUESTIONS_INITIALES = [];', app, count=1, flags=re.M)
app, n2 = re.subn(r"^(\s*s\.questions = s\.questions \|\| )\[\{.*\}\];$", r'\1[];', app, count=1, flags=re.M)
if n1 != 1 or n2 != 1:
    sys.exit("app.js a changé : les questions pré-remplies n'ont pas été trouvées, rien n'est publié.")
(DST / 'js/app.js').write_text(app, encoding='utf-8')

# Données : fichiers vides (le cockpit démarre vide, puis on importe son JSON)
VIDE = {
    'data.js': 'window.PAS_SEED = {"schemaVersion": 1, "annee": "", "etablissement": "", "aesh": [], "eleves": [], "classes": [], '
               '"affectations": [], "creneaux": [], "journal": [], "calendrier": {"annee": "", "vacances": [], "feries": []}, '
               '"regles": {"jours": true, "horaires": true, "niveaux": true}};\n',
    'dossiers-donnees.js': 'window.DOSSIERS_DONNEES = {"genere": "", "nbFichiers": 0, "nonClasses": [], "nonLus": [], "eleves": {}};\n',
    'dossiers-index.js': '',
    'pial-donnees.js': 'window.PIAL_DONNEES = {"fichier": "", "genere": "", "eleves": {}};\n',
    'ess-donnees.js': 'window.ESS_DONNEES = {"fichiers": [], "genere": "", "ess": []};\n',
}
for nom, contenu in VIDE.items():
    (DST / 'js' / nom).write_text('/* Volontairement vide : les données restent sur tes appareils (Importer JSON). */\n' + contenu, encoding='utf-8')

# index.html : même page, plus ce qu'il faut pour l'installer sur le téléphone
html = (SRC / 'index.html').read_text(encoding='utf-8')
tete = ('<meta name="theme-color" content="#2f4f6b"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes"><link rel="apple-touch-icon" href="icon.svg">\n')
html = html.replace('<link rel="stylesheet"', tete + '<link rel="stylesheet"', 1)
html = html.replace('</body>', '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");</script>\n</body>', 1)
(DST / 'index.html').write_text(html, encoding='utf-8')
print('Cockpit copié sans données dans', DST)

# Contrôle final : aucun NOM d'élève ou d'AESH (lus dans les données du Mac) ne doit se retrouver dans le dépôt
import json
def charger(f):
    t = (SRC / 'js' / f).read_text(encoding='utf-8')
    return json.loads(t[t.index('{'):t.rindex('}') + 1])
seed, pial, ess = charger('data.js'), charger('pial-donnees.js'), charger('ess-donnees.js')
noms = {p.get(k) or '' for p in seed['aesh'] + seed['eleves'] for k in ('nom', 'prenom')}
noms |= {v.get('pial') or '' for v in pial['eleves'].values()} | {x.get('eleve') or '' for x in ess['ess']}
mots = {m for n in noms for m in re.findall(r'\b[A-ZÉÈÏ][A-ZÉÈÏ\-]{3,}\b', n)} - {'AESH', 'SEGPA', 'ULIS', 'BODIN'}
fuites = []
for p in DST.rglob('*'):
    if p.is_file() and '.git' not in p.parts and p.suffix in {'.js', '.html', '.css', '.md', '.webmanifest'}:
        t = p.read_text(encoding='utf-8', errors='ignore')
        fuites += [f'{p.name}: {m}' for m in mots if re.search(r'\b' + re.escape(m) + r'\b', t, re.I)]
if fuites:
    sys.exit('ATTENTION, noms trouvés dans le dépôt, ne pas publier :\n' + '\n'.join(sorted(fuites)))
print(f'Contrôle OK : aucun des {len(mots)} noms des données ne figure dans le dépôt.')
