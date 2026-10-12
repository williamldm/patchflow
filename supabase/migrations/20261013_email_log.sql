-- ── Journal des e-mails envoyés par PatchFlow ──
-- Alimenté par les fonctions serveur (e-mails d'authentification, invitations, support, avis d'abonnement).
-- Ne contient ni le corps des messages, ni les liens, ni l'adresse complète du destinataire : seulement
-- de quoi voir si les envois partent (type, destinataire masqué, objet, réussite, erreur).
-- Lecture réservée à l'administration, par admin_email_overview(). Conservation : 30 jours.

CREATE TABLE IF NOT EXISTS public.email_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  source     text NOT NULL,                  -- fonction qui a envoyé
  kind       text NOT NULL,                  -- signup, recovery, invite, support, notice, test…
  to_masked  text NOT NULL,                  -- j***@gmail.com
  subject    text,
  status     text NOT NULL CHECK (status IN ('sent', 'failed')),
  error      text
);
CREATE INDEX IF NOT EXISTS email_log_at_idx ON public.email_log (at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_log FROM PUBLIC, anon, authenticated;     -- accès : service_role et fonction admin

-- Purge : à chaque insertion, ce qui a plus de 30 jours disparaît
CREATE OR REPLACE FUNCTION public.email_log_prune()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.email_log WHERE at < now() - interval '30 days';
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_log_prune ON public.email_log;
CREATE TRIGGER trg_email_log_prune AFTER INSERT ON public.email_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.email_log_prune();

-- Vue d'ensemble pour l'administration
CREATE OR REPLACE FUNCTION public.admin_email_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'h24', (SELECT jsonb_build_object(
              'sent',   count(*) FILTER (WHERE status = 'sent'),
              'failed', count(*) FILTER (WHERE status = 'failed'))
            FROM public.email_log WHERE at > now() - interval '24 hours'),
    'd7',  (SELECT jsonb_build_object(
              'sent',   count(*) FILTER (WHERE status = 'sent'),
              'failed', count(*) FILTER (WHERE status = 'failed'))
            FROM public.email_log WHERE at > now() - interval '7 days'),
    'last_sent',   (SELECT max(at) FROM public.email_log WHERE status = 'sent'),
    'last_failed', (SELECT max(at) FROM public.email_log WHERE status = 'failed'),
    'by_kind', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.n DESC)
      FROM (
        SELECT kind, count(*) AS n,
               count(*) FILTER (WHERE status = 'failed') AS failed,
               max(at) AS last_at
        FROM public.email_log
        WHERE at > now() - interval '7 days'
        GROUP BY kind
      ) x
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.at DESC)
      FROM (
        SELECT at, source, kind, to_masked, subject, status, error
        FROM public.email_log
        ORDER BY at DESC
        LIMIT 60
      ) x
    ), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_email_overview() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_email_overview() TO authenticated, service_role;
