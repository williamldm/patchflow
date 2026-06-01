-- ── Fonction RPC : statistiques de stockage DB de l'utilisateur connecté ──
-- Retourne les tailles en octets de toutes les données JSON stockées en DB
-- (synoptique_data, stage_data, out_data, show_scenes.data)
-- Utilisée dans "Mon abonnement" pour le compteur de stockage total.

CREATE OR REPLACE FUNCTION get_user_storage_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    -- Données JSON des shows (synoptique, plans, output)
    'shows_bytes', COALESCE((
      SELECT SUM(
        COALESCE(pg_column_size(synoptique_data), 0) +
        COALESCE(pg_column_size(stage_data), 0)
      )
      FROM shows
      WHERE owner_id = auth.uid()
    ), 0),
    -- Données des scènes multi (images base64 incluses)
    'scenes_bytes', COALESCE((
      SELECT SUM(COALESCE(pg_column_size(sc.data), 0))
      FROM show_scenes sc
      JOIN shows s ON sc.show_id = s.id
      WHERE s.owner_id = auth.uid()
    ), 0),
    -- Nombre de canaux (pour estimation)
    'channel_count', COALESCE((
      SELECT COUNT(*)
      FROM channels c
      JOIN shows s ON c.show_id = s.id
      WHERE s.owner_id = auth.uid()
    ), 0),
    -- Nombre de shows
    'show_count', COALESCE((
      SELECT COUNT(*) FROM shows WHERE owner_id = auth.uid()
    ), 0)
  );
$$;

GRANT EXECUTE ON FUNCTION get_user_storage_stats() TO authenticated;
