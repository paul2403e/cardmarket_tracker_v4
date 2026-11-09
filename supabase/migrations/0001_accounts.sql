-- Meilenstein 6a – Konten: Einstellungen je Nutzer, eigenes Konto löschen.
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query → einfügen → Run.
-- Jeder Nutzer sieht und ändert nur seine eigene Zeile (Row Level Security).

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "eigene Einstellungen lesen" on public.user_settings;
create policy "eigene Einstellungen lesen" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "eigene Einstellungen anlegen" on public.user_settings;
create policy "eigene Einstellungen anlegen" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "eigene Einstellungen ändern" on public.user_settings;
create policy "eigene Einstellungen ändern" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Eigenes Konto löschen (DSGVO): löscht den Nutzer; alle seine Daten hängen per "on delete cascade" daran.
create or replace function public.delete_own_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
