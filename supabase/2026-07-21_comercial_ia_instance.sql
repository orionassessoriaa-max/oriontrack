alter table if exists public.comercial_config
  add column if not exists ia_sdr_profile_id uuid references public.profiles(id) on delete set null;
