-- ── Plafond des riders partagés, selon le plan du propriétaire ──
-- Un rider porte des aperçus de plans (bornés à 600 Ko côté application) et des listes : quelques centaines
-- de Ko en usage normal. 5 Mo pour un compte gratuit, 15 Mo pour un compte Pro. Toute écriture au-dessus est
-- refusée (check_violation), y compris par appel direct de l'API.

CREATE OR REPLACE FUNCTION public.pf_enforce_rider_size()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_max  int;
BEGIN
  SELECT p.plan INTO v_plan
    FROM public.shows s JOIN public.profiles p ON p.id = s.owner_id
   WHERE s.id = NEW.show_id;
  v_max := CASE WHEN v_plan = 'pro' THEN 15 * 1048576 ELSE 5 * 1048576 END;
  IF octet_length(to_jsonb(NEW)::text) > v_max THEN
    RAISE EXCEPTION 'rider trop volumineux (% Mo au maximum)', (v_max / 1048576)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pf_size_riders ON public.show_riders;
CREATE TRIGGER trg_pf_size_riders BEFORE INSERT OR UPDATE ON public.show_riders
  FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_rider_size();
