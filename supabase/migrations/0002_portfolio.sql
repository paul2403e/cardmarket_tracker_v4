-- Meilenstein 6b – Depots und Transaktionen.
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query → einfügen → Run.
-- Jeder Nutzer sieht und ändert nur seine eigenen Depots und Transaktionen (Row Level Security).

create table if not exists public.depots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists depots_user_idx on public.depots (user_id);

create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  depot_id         uuid not null references public.depots (id) on delete cascade,
  game             text not null check (game ~ '^[a-z0-9-]{1,40}$'),
  product_id       bigint not null check (product_id > 0),
  product_name     text check (char_length(product_name) <= 300),  -- Name zum Zeitpunkt der Eingabe (Anzeige/Export)
  language         text not null check (language in ('en', 'de', 'ja')),
  kind             text not null check (kind in ('buy', 'sell')),
  quantity         integer not null check (quantity between 1 and 100000),
  -- Kauf: Preis pro Stück inkl. Versand und Gebühren; Verkauf: Erlös pro Stück nach Gebühren und Versand
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000),
  trade_date       date not null check (trade_date between date '2000-01-01' and current_date + 1),
  note             text check (char_length(note) <= 500),
  created_at       timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions (user_id);
create index if not exists transactions_depot_idx on public.transactions (depot_id);

alter table public.depots enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "eigene Depots" on public.depots;
create policy "eigene Depots" on public.depots
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "eigene Transaktionen" on public.transactions;
create policy "eigene Transaktionen" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.depots d where d.id = depot_id and d.user_id = (select auth.uid()))
  );
