-- Meilenstein 8 – Watchlist und Preisalarme.
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query → einfügen → Run.
-- Jeder Nutzer sieht und ändert nur seine eigenen Zeilen. Der Laptop prüft die Alarme mit dem "secret key"
-- (umgeht RLS) und schreibt das Ergebnis zurück.

create table if not exists public.watchlist (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game       text not null check (game ~ '^[a-z0-9-]{1,40}$'),
  product_id bigint not null check (product_id > 0),
  language   text not null check (language in ('en', 'de', 'ja')),
  created_at timestamptz not null default now(),
  primary key (user_id, game, product_id, language)
);

create table if not exists public.alerts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game              text not null check (game ~ '^[a-z0-9-]{1,40}$'),
  product_id        bigint not null check (product_id > 0),
  language          text not null check (language in ('en', 'de', 'ja')),
  product_name      text check (char_length(product_name) <= 300),
  -- price_below / price_above / items_below / items_above / change (metric, days, direction, threshold = %)
  kind              text not null check (kind in ('price_below', 'price_above', 'items_below', 'items_above', 'change')),
  metric            text not null default 'price' check (metric in ('price', 'items')),
  threshold         numeric not null check (threshold >= 0 and threshold <= 100000000),
  days              integer not null default 7 check (days between 1 and 365),
  direction         text not null default 'any' check (direction in ('up', 'down', 'any')),
  basis             text not null default 'incl' check (basis in ('incl', 'excl')),
  region            text not null default 'eu' check (region in ('eu', 'all')),
  active            boolean not null default true,
  armed             boolean not null default true,   -- false nach dem Auslösen, bis die Bedingung einmal nicht erfüllt war
  last_checked_day  date,
  last_triggered_at timestamptz,
  last_value        numeric,
  created_at        timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts (user_id);
create index if not exists alerts_active_idx on public.alerts (active) where active;

create table if not exists public.alert_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  alert_id     uuid references public.alerts (id) on delete set null,
  game         text not null,
  product_id   bigint not null,
  language     text not null,
  product_name text,
  message      text not null,
  day          date not null,
  created_at   timestamptz not null default now()
);
create index if not exists alert_events_user_idx on public.alert_events (user_id, created_at desc);

alter table public.watchlist enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_events enable row level security;

drop policy if exists "eigene Watchlist" on public.watchlist;
create policy "eigene Watchlist" on public.watchlist for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "eigene Alarme" on public.alerts;
create policy "eigene Alarme" on public.alerts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Ereignisse schreibt nur der Laptop; Nutzer dürfen ihre lesen und löschen
drop policy if exists "eigene Ereignisse lesen" on public.alert_events;
create policy "eigene Ereignisse lesen" on public.alert_events for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "eigene Ereignisse löschen" on public.alert_events;
create policy "eigene Ereignisse löschen" on public.alert_events for delete to authenticated
  using ((select auth.uid()) = user_id);
