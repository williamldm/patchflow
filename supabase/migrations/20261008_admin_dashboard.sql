-- ══════════════════════════════════════════════════════════════════
-- Tableau de bord d'administration (lecture seule)
--
-- Qui est administrateur : la liste vit dans la table app_admins, pas dans le
-- code. Le dépôt est public ; une adresse écrite ici désignerait le compte à
-- viser. On ajoute un administrateur à la main, depuis l'éditeur SQL :
--     INSERT INTO public.app_admins (email) VALUES ('adresse@exemple.fr');
--
-- Contrôle d'accès : il est fait ICI, dans la base. Chaque fonction admin_*
-- commence par is_app_admin(), qui compare l'adresse CONFIRMÉE du compte
-- connecté (auth.users, pas profiles.email que l'utilisateur peut modifier)
-- à la liste. Le menu « Administration » de l'application n'est qu'un
-- affichage : le masquer ou le forcer ne donne aucun accès.
--
-- Ces fonctions ne font que lire. Elles ne renvoient ni les liens du portail
-- client Lemon Squeezy, ni les moyens de paiement, ni le contenu des fichiers.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_admins (
  email    text PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- RLS activée sans aucune policy : la table est illisible et inscriptible par personne via l'API.
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_admins FROM PUBLIC, anon, authenticated;

-- ── Le compte connecté est-il administrateur ? ──
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.app_admins a ON lower(a.email) = lower(u.email)
    WHERE u.id = auth.uid()
      AND u.email_confirmed_at IS NOT NULL
  );
$$;

-- ── Vue d'ensemble : comptes, abonnements, contenu, stockage ──
CREATE OR REPLACE FUNCTION public.admin_overview()
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

    'users', (
      SELECT jsonb_build_object(
        'total',        count(*),
        'new_7d',       count(*) FILTER (WHERE u.created_at > now() - interval '7 days'),
        'new_30d',      count(*) FILTER (WHERE u.created_at > now() - interval '30 days'),
        'active_7d',    count(*) FILTER (WHERE u.last_sign_in_at > now() - interval '7 days'),
        'active_30d',   count(*) FILTER (WHERE u.last_sign_in_at > now() - interval '30 days'),
        'unconfirmed',  count(*) FILTER (WHERE u.email_confirmed_at IS NULL),
        'pro',          count(*) FILTER (WHERE p.plan = 'pro'),
        'pro_override', count(*) FILTER (WHERE p.plan = 'pro' AND p.plan_override)
      )
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
    ),

    -- Inscriptions des 12 dernières semaines (semaine commençant le lundi)
    'signups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('week', w.wk, 'n', w.n) ORDER BY w.wk)
      FROM (
        SELECT g.wk::date AS wk,
               (SELECT count(*) FROM auth.users u
                 WHERE u.created_at >= g.wk AND u.created_at < g.wk + interval '7 days') AS n
        FROM generate_series(date_trunc('week', now()) - interval '11 weeks',
                             date_trunc('week', now()), interval '7 days') AS g(wk)
      ) w
    ), '[]'::jsonb),

    'subs', jsonb_build_object(
      'total',     (SELECT count(*) FROM public.subscriptions),
      'active',    (SELECT count(*) FROM public.subscriptions WHERE status IN ('active', 'on_trial')),
      'ending',    (SELECT count(*) FROM public.subscriptions WHERE status = 'cancelled' AND ends_at > now()),
      'by_status', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('status', x.status, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT status, count(*) AS n FROM public.subscriptions GROUP BY status) x
      ), '[]'::jsonb),
      'by_variant', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('variant', x.v, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT COALESCE(ls_variant_id, '—') AS v, count(*) AS n
                FROM public.subscriptions WHERE status IN ('active', 'on_trial') GROUP BY 1) x
      ), '[]'::jsonb),
      -- Les 200 abonnements modifiés le plus récemment
      'list', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC NULLS LAST)
        FROM (
          SELECT s.user_id, u.email, p.full_name, s.status, s.plan, s.ls_variant_id,
                 s.ls_subscription_id, s.ls_customer_id,
                 s.renews_at, s.ends_at, s.created_at, s.updated_at
          FROM public.subscriptions s
          LEFT JOIN auth.users u ON u.id = s.user_id
          LEFT JOIN public.profiles p ON p.id = s.user_id
          ORDER BY s.updated_at DESC NULLS LAST
          LIMIT 200
        ) x
      ), '[]'::jsonb),
      -- Comptes Pro sans abonnement en cours : octrois manuels, comptes de test
      'pro_without_sub', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.email)
        FROM (
          SELECT p.id AS user_id, u.email, p.full_name, COALESCE(p.plan_override, false) AS plan_override
          FROM public.profiles p
          JOIN auth.users u ON u.id = p.id
          WHERE p.plan = 'pro'
            AND NOT EXISTS (SELECT 1 FROM public.subscriptions s
                             WHERE s.user_id = p.id AND s.status IN ('active', 'on_trial'))
          ORDER BY u.email
          LIMIT 100
        ) x
      ), '[]'::jsonb)
    ),

    'content', jsonb_build_object(
      'shows',         (SELECT count(*) FROM public.shows WHERE deleted_at IS NULL),
      'shows_deleted', (SELECT count(*) FROM public.shows WHERE deleted_at IS NOT NULL),
      'shows_30d',     (SELECT count(*) FROM public.shows WHERE deleted_at IS NULL AND created_at > now() - interval '30 days'),
      'channels',      (SELECT count(*) FROM public.channels),
      'riders',        (SELECT count(*) FROM public.show_riders),
      'members',       (SELECT count(*) FROM public.show_members),
      'db_bytes',      (SELECT COALESCE(sum(COALESCE(pg_column_size(synoptique_data), 0)
                                          + COALESCE(pg_column_size(stage_data), 0)
                                          + COALESCE(pg_column_size(out_data), 0)), 0) FROM public.shows)
                     + (SELECT COALESCE(sum(COALESCE(pg_column_size(data), 0)), 0) FROM public.show_scenes)
    ),

    'files', jsonb_build_object(
      'count', (SELECT count(*) FROM public.show_files WHERE NOT is_folder),
      'bytes', (SELECT COALESCE(sum(size), 0) FROM public.show_files WHERE NOT is_folder),
      'added_30d_bytes', (SELECT COALESCE(sum(size), 0) FROM public.show_files
                           WHERE NOT is_folder AND created_at > now() - interval '30 days'),
      'by_type', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('ext', x.ext, 'n', x.n, 'bytes', x.bytes) ORDER BY x.bytes DESC)
        FROM (
          SELECT COALESCE(lower(substring(name FROM '\.([A-Za-z0-9]{1,6})$')), 'autre') AS ext,
                 count(*) AS n, COALESCE(sum(size), 0) AS bytes
          FROM public.show_files
          WHERE NOT is_folder
          GROUP BY 1
          ORDER BY 3 DESC
          LIMIT 15
        ) x
      ), '[]'::jsonb),
      -- Les 20 comptes qui stockent le plus
      'by_owner', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.bytes DESC)
        FROM (
          SELECT s.owner_id AS user_id, u.email, p.full_name, COALESCE(p.plan, 'free') AS plan,
                 count(*) AS n, COALESCE(sum(f.size), 0) AS bytes
          FROM public.show_files f
          JOIN public.shows s ON s.id = f.show_id
          LEFT JOIN auth.users u ON u.id = s.owner_id
          LEFT JOIN public.profiles p ON p.id = s.owner_id
          WHERE NOT f.is_folder
          GROUP BY s.owner_id, u.email, p.full_name, p.plan
          ORDER BY 6 DESC
          LIMIT 20
        ) x
      ), '[]'::jsonb),
      -- Les 30 plus gros fichiers
      'top', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.size DESC)
        FROM (
          SELECT f.name, f.size, f.created_at, s.name AS show_name, s.owner_id AS user_id, u.email
          FROM public.show_files f
          JOIN public.shows s ON s.id = f.show_id
          LEFT JOIN auth.users u ON u.id = s.owner_id
          WHERE NOT f.is_folder
          ORDER BY f.size DESC
          LIMIT 30
        ) x
      ), '[]'::jsonb)
    ),

    'pending_deletions', (
      SELECT count(*) FROM public.pending_data_deletions
      WHERE executed_at IS NULL AND cancelled_at IS NULL
    )
  ) INTO r;

  RETURN r;
END;
$$;

-- ── Liste des comptes, paginée ──
--   p_search : cherche dans l'adresse, le nom et la société
--   p_plan   : '' (tous), 'pro' ou 'free'
--   p_sort   : 'recent' (inscription), 'active' (dernière connexion), 'storage', 'shows'
CREATE OR REPLACE FUNCTION public.admin_users(
  p_search text DEFAULT '',
  p_plan   text DEFAULT '',
  p_sort   text DEFAULT 'recent',
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r     jsonb;
  v_q   text := trim(COALESCE(p_search, ''));
  v_pat text;
  v_lim int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_off int  := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Les caractères joker saisis sont cherchés tels quels
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  WITH base AS (
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
           (u.email_confirmed_at IS NOT NULL) AS confirmed,
           COALESCE(u.raw_app_meta_data ->> 'provider', 'email') AS provider,
           p.full_name, p.company,
           COALESCE(p.plan, 'free') AS plan,
           COALESCE(p.plan_override, false) AS plan_override
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE (v_q = '' OR u.email ILIKE v_pat OR p.full_name ILIKE v_pat OR p.company ILIKE v_pat)
      AND (COALESCE(p_plan, '') = '' OR COALESCE(p.plan, 'free') = p_plan)
  ),
  agg AS (
    SELECT b.*,
      (SELECT count(*) FROM public.shows s
        WHERE s.owner_id = b.id AND s.deleted_at IS NULL) AS shows,
      (SELECT count(*) FROM public.channels c JOIN public.shows s ON s.id = c.show_id
        WHERE s.owner_id = b.id AND s.deleted_at IS NULL) AS channels,
      (SELECT count(*) FROM public.show_files f JOIN public.shows s ON s.id = f.show_id
        WHERE s.owner_id = b.id AND NOT f.is_folder) AS files,
      (SELECT COALESCE(sum(f.size), 0) FROM public.show_files f JOIN public.shows s ON s.id = f.show_id
        WHERE s.owner_id = b.id AND NOT f.is_folder) AS files_bytes,
      sub.status   AS sub_status,
      sub.renews_at AS sub_renews_at,
      sub.ends_at   AS sub_ends_at
    FROM base b
    LEFT JOIN LATERAL (
      SELECT x.status, x.renews_at, x.ends_at
      FROM public.subscriptions x
      WHERE x.user_id = b.id
      ORDER BY x.updated_at DESC NULLS LAST
      LIMIT 1
    ) sub ON true
  ),
  page AS (
    SELECT a.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'storage' THEN a.files_bytes END DESC NULLS LAST,
        CASE WHEN p_sort = 'shows'   THEN a.shows END DESC NULLS LAST,
        CASE WHEN p_sort = 'active'  THEN a.last_sign_in_at END DESC NULLS LAST,
        a.created_at DESC
    ) AS rn
    FROM agg a
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'limit', v_lim,
    'offset', v_off,
    'rows', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t.rn)
      FROM (SELECT * FROM page WHERE rn > v_off AND rn <= v_off + v_lim) t
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$$;

-- ── Fiche d'un compte : sessions, stockage, abonnement ──
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user uuid)
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
    'user', (
      SELECT jsonb_build_object(
        'id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
        'confirmed', (u.email_confirmed_at IS NOT NULL),
        'provider', COALESCE(u.raw_app_meta_data ->> 'provider', 'email'),
        'full_name', p.full_name, 'company', p.company, 'role', p.role,
        'plan', COALESCE(p.plan, 'free'), 'plan_override', COALESCE(p.plan_override, false)
      )
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id = p_user
    ),
    'shows', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC NULLS LAST)
      FROM (
        SELECT s.id, s.name, s.venue, s.show_date, s.created_at, s.deleted_at,
          (SELECT count(*) FROM public.channels c WHERE c.show_id = s.id) AS channels,
          (SELECT count(*) FROM public.show_files f WHERE f.show_id = s.id AND NOT f.is_folder) AS files,
          (SELECT COALESCE(sum(f.size), 0) FROM public.show_files f WHERE f.show_id = s.id AND NOT f.is_folder) AS files_bytes,
          (SELECT count(*) FROM public.show_members m WHERE m.show_id = s.id) AS members,
          (SELECT count(*) FROM public.show_riders rd WHERE rd.show_id = s.id) AS riders,
          COALESCE(pg_column_size(s.synoptique_data), 0) + COALESCE(pg_column_size(s.stage_data), 0)
            + COALESCE(pg_column_size(s.out_data), 0)
            + (SELECT COALESCE(sum(COALESCE(pg_column_size(sc.data), 0)), 0)
                 FROM public.show_scenes sc WHERE sc.show_id = s.id) AS db_bytes
        FROM public.shows s
        WHERE s.owner_id = p_user
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT 200
      ) x
    ), '[]'::jsonb),
    -- Sessions d'autres comptes auxquelles celui-ci est invité
    'member_of', (SELECT count(*) FROM public.show_members m WHERE m.user_id = p_user),
    'subscriptions', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC NULLS LAST)
      FROM (
        SELECT s.status, s.plan, s.ls_variant_id, s.ls_subscription_id, s.ls_customer_id, s.ls_order_id,
               s.renews_at, s.ends_at, s.created_at, s.updated_at
        FROM public.subscriptions s
        WHERE s.user_id = p_user
      ) x
    ), '[]'::jsonb),
    'pending_deletion', (
      SELECT jsonb_build_object('scheduled_at', d.scheduled_at, 'notified_at', d.notified_at,
                                'executed_at', d.executed_at, 'cancelled_at', d.cancelled_at)
      FROM public.pending_data_deletions d
      WHERE d.user_id = p_user
    )
  ) INTO r;

  RETURN r;
END;
$$;

-- Appelables par un compte connecté seulement ; chacune vérifie elle-même qu'il est administrateur.
REVOKE EXECUTE ON FUNCTION public.is_app_admin()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_overview()                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_users(text, text, text, int, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_user_detail(uuid)                 FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_app_admin()                          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_overview()                        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_users(text, text, text, int, int) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_user_detail(uuid)                 TO authenticated, service_role;
