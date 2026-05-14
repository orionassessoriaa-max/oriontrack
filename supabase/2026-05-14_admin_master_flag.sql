alter table public.profiles
  add column if not exists is_admin_master boolean not null default false;

update public.profiles
set is_admin_master = true,
    tipo_usuario = 'admin',
    status = 'active',
    email_real = 'ewerttonherculano@gmail.com',
    precisa_trocar_senha = false
where lower(email) = 'ewerttonherculano@gmail.com'
   or lower(coalesce(email_real, '')) = 'ewerttonherculano@gmail.com';

update public.profiles
set is_admin_master = false
where lower(email) <> 'ewerttonherculano@gmail.com'
  and lower(coalesce(email_real, '')) <> 'ewerttonherculano@gmail.com';
