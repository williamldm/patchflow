# PatchFlow

Application web (français) pour techniciens son/scène : input lists, patchs, racks, plans de scène, RF, riders, consoles (SQ5, DM7). Site : https://patchflow.fr

## Architecture
- Front 100 % statique, sans build : `index.html` (accueil), `app.html` + `pf-app.js` + `pf-app.css` (l'app), `rider.html`, `pf-rf.js` (module RF), pages légales (`cgu.html`, `cgv.html`, `confidentialite.html`, `mentions-legales.html`).
- Back : Supabase (projet `ofiiutcueoogmtdvaupg`) — migrations SQL et edge functions dans `supabase/`. Paiement : Stripe (`stripe-checkout`, `stripe-webhook`). Les fonctions `lemonsqueezy-*` sont l'ancien prestataire.
- Hébergement : o2switch (cPanel). Mise en ligne du site : `git push` sur `main`, puis dans cPanel → Git Version Control → Update from Remote → Deploy HEAD Commit, puis ⌘⇧R (recharge sans cache). Cette étape se fait dans cPanel, par l'utilisateur : aucune session Claude ne l'a faite. Le `.cpanel.yml` référence encore `soundbooth_12.html` (obsolète).
- Fonctions Supabase : `supabase functions deploy <nom> --project-ref ofiiutcueoogmtdvaupg --use-api`, depuis l'ordinateur de l'utilisateur avec un jeton `SUPABASE_ACCESS_TOKEN`. Impossible depuis le cloud (réseau bloqué vers Supabase, cPanel et o2switch).
- `pf-road.js` : feuille de route (shows.stage_data.road), onglet de l'app et section `road` du rider partagé.
- `pf-app.js` fait ~1,5 Mo : utiliser `grep -a` (le fichier est vu comme binaire) et lire par plages de lignes.
- `.gitignore` ignore tout par défaut : tout nouveau fichier à versionner doit être ajouté en `!nom`.

## Skills
- `.claude/skills/` est versionné (pro-graphic-designer, worldbuilder-writing, security-advisor) pour être disponibles dans les sessions cloud ; le reste de `.claude/` est ignoré. Un nouveau skill se déclare dans `.gitignore` comme les autres fichiers.
- `pro-graphic-designer` cite `/mnt/skills/user/worldbuilder-writing/SKILL.md` : en cloud, lire `.claude/skills/worldbuilder-writing/SKILL.md`.

## Lancer / tester
- `python3 serve.py` puis ouvrir `http://127.0.0.1:7821/app.html` (Chromium + Playwright sont préinstallés dans le cloud pour les captures).
- Captures téléphone sans compte : `node tests/shot.js demo /tmp/rf "rfMobCal()"` (Supabase simulé, show de démo tiré de `tests/rf-fixtures.js`).
- Rider partagé sans serveur : `node tests/rider-shot.js 390 /tmp/rider` (deux visites, changements entre les deux).
- Tests RF : ouvrir `http://127.0.0.1:7821/tests/rf.html`.
- Le login (Supabase/Google) ne marche pas en local sans compte ; utiliser des données de démonstration pour vérifier le rendu.

## Règles
- Pas de secrets dans le dépôt (clés Stripe, clé de service Supabase : uniquement dans Supabase/cPanel). Seule la clé anon publique est dans `pf-app.js`.
- Les edge functions et migrations ne se déploient pas depuis le cloud (pas de CLI Supabase authentifiée) : fournir les commandes à lancer.
- Messages de commit en français, une ligne descriptive, comme l'historique existant.

## État (13 oct. 2026)
- Feuille de route : horaires (journée type, décalage), lieu, contacts, logistique, notes ; copie texte et PDF ; section « Feuille de route » cochable dans un lien (opt-in, elle contient des téléphones). Filtrée côté serveur par `get-shared-show` (`publicRoad`).
- Rider partagé : « Mis à jour depuis votre dernière visite » — état vu gardé dans le localStorage du destinataire (`pf_seen_*`), visite = 2 h sans ouvrir la page, bouton « Vu ». Une voie seulement renumérotée n'est pas marquée.
- Colonne ALT (`custom_data._alt`) : imports CSV/PDF/IA, export CSV/PDF, rider partagé ; le contrôle du bon accepte l'équivalent présent (second passage, après les modèles principaux) ; la demande au loueur l'écrit.
- À déployer côté Supabase : `get-shared-show` et `inputlist-ai` (et les 5 fonctions e-mail si ce n'est pas fait).
- RF sur téléphone (≤ 768 px) : vue dédiée `_rfRenderMob` (cartes, fiche en volet bas) et calibration rapide en 3 écrans (`rfMobCal`). « Vue complète » rebascule sur le tableau.
- Fenêtre « Pro » refaite (paiement direct, 1 mois offert) ; paiement Stripe réel non testé.
- En cours : valider la marque Google OAuth (afficher « PatchFlow » au lieu du domaine Supabase) → vérifier `patchflow.fr` dans la Search Console par TXT DNS (Name `patchflow.fr.`/`@`, TTL 14400), attendre 24 h, relancer la validation dans Google Cloud.
