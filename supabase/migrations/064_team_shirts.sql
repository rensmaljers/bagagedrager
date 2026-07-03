-- 064: team_shirts — PCS-tenues centraal in de DB
-- Tenues zaten alleen in localStorage van de browser die de sync draaide,
-- waardoor andere spelers ze nooit zagen. Nu een publieke lookup-tabel die
-- sync-pcs-race server-side vult en de frontend bij boot inlaadt.

create table if not exists team_shirts (
  team_name text primary key,
  shirt_url text not null,
  updated_at timestamptz not null default now()
);

alter table team_shirts enable row level security;

-- Publiek leesbaar (ook anon: tenues zijn niet gevoelig)
create policy "team_shirts_select" on team_shirts
  for select using (true);

-- Schrijven alleen via service role (edge functions omzeilen RLS); geen
-- insert/update/delete policies voor gewone rollen.
