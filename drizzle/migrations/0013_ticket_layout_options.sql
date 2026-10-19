ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS ticket_trade_name text,
  ADD COLUMN IF NOT EXISTS ticket_legal_name text,
  ADD COLUMN IF NOT EXISTS ticket_tax_id text,
  ADD COLUMN IF NOT EXISTS ticket_font_size text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS ticket_line_spacing text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS ticket_bold_items boolean NOT NULL DEFAULT true;
ALTER TABLE public.business_settings
  ADD CONSTRAINT ticket_font_size_chk CHECK (ticket_font_size IN ('small','normal','large','xlarge')),
  ADD CONSTRAINT ticket_line_spacing_chk CHECK (ticket_line_spacing IN ('compact','normal','relaxed'));