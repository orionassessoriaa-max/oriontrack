-- Inbox comercial: usa as conversas WhatsApp existentes e vincula pelo telefone do lead comercial.
create index if not exists idx_comercial_leads_telefone on public.comercial_leads(telefone);
create index if not exists idx_whatsapp_conversas_telefone on public.whatsapp_conversas(telefone);
