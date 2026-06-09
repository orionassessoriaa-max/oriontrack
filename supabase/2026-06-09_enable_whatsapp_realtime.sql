-- Enable Realtime for WhatsApp conversations and messages
alter publication supabase_realtime add table public.whatsapp_conversas;
alter publication supabase_realtime add table public.whatsapp_mensagens;
