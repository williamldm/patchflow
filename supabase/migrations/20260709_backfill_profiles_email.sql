-- ── Backfill profiles.email depuis auth.users ──
-- profiles.email n'était écrit nulle part côté client : ni à la création du
-- profil (loadProfile(), fallback lors du 1er login), ni dans saveProfile(),
-- ni après un changement d'email. Résultat : la colonne restait NULL pour
-- tous les comptes, nouveaux comme anciens. C'était resté invisible car
-- l'affichage utilise systématiquement un repli full_name || email.
--
-- Le code client est corrigé en parallèle (pf-app.js) pour écrire email à la
-- création du profil et rattraper les profils existants au prochain login.
-- Cette migration comble immédiatement TOUS les comptes déjà créés, sans
-- attendre une reconnexion (utile pour les membres invités, les emails
-- d'expiration d'abonnement côté serveur, etc.).

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;
