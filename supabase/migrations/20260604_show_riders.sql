-- ── Table des liens de partage multiples (Pro) ──
CREATE TABLE IF NOT EXISTS public.show_riders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id     UUID NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Lien partagé',
  sections    JSONB NOT NULL DEFAULT '["il"]'::jsonb,
  config      JSONB DEFAULT '{}'::jsonb, -- {title, note, info, files, syn_snapshot, site_snapshot, out_snapshot}
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS show_riders_show_id_idx ON public.show_riders(show_id);

ALTER TABLE public.show_riders ENABLE ROW LEVEL SECURITY;

-- Le propriétaire du show peut tout faire sur ses riders
CREATE POLICY "show_riders_owner_all" ON public.show_riders
  USING (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));
