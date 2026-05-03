CREATE TABLE IF NOT EXISTS public.exchange_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  exchange_id UUID NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('void_exchange', 'revert_void_exchange')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exchange_edit_requests_status_created_idx
  ON public.exchange_edit_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS exchange_edit_requests_event_status_idx
  ON public.exchange_edit_requests (event_id, status);

CREATE INDEX IF NOT EXISTS exchange_edit_requests_exchange_status_idx
  ON public.exchange_edit_requests (exchange_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS exchange_edit_requests_one_pending_idx
  ON public.exchange_edit_requests (exchange_id, request_type)
  WHERE status = 'pending';

ALTER TABLE public.exchange_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage exchange edit requests" ON public.exchange_edit_requests;
CREATE POLICY "Super admins manage exchange edit requests"
  ON public.exchange_edit_requests
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Org admins read exchange edit requests" ON public.exchange_edit_requests;
CREATE POLICY "Org admins read exchange edit requests"
  ON public.exchange_edit_requests
  FOR SELECT
  TO authenticated
  USING (public.has_org_role(public.event_org_id(event_id), 'editor'));

DROP POLICY IF EXISTS "Org admins create exchange edit requests" ON public.exchange_edit_requests;
CREATE POLICY "Org admins create exchange edit requests"
  ON public.exchange_edit_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(public.event_org_id(event_id), 'editor'));
