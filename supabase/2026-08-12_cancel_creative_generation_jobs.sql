alter table public.criativo_generation_jobs
  drop constraint if exists criativo_generation_jobs_status_check;

alter table public.criativo_generation_jobs
  add constraint criativo_generation_jobs_status_check
  check (status in ('na_fila', 'gerando', 'pronto', 'falhou', 'cancelado'));

