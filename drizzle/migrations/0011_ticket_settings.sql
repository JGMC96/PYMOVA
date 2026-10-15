ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS ticket_address text,
  ADD COLUMN IF NOT EXISTS ticket_phone text,
  ADD COLUMN IF NOT EXISTS ticket_website text,
  ADD COLUMN IF NOT EXISTS ticket_header text,
  ADD COLUMN IF NOT EXISTS ticket_footer text,
  ADD COLUMN IF NOT EXISTS ticket_return_policy text,
  ADD COLUMN IF NOT EXISTS ticket_show_logo boolean NOT NULL DEFAULT true;