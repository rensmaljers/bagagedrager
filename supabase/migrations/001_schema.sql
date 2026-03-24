-- Bagagedrager Tour - Database Schema

-- Riders (Tour de France participants)
create table riders (
  id serial primary key,
  name text not null,
  team text not null,
  bib_number int unique not null
);

-- Stages
create table stages (
  id serial primary key,
  stage_number int unique not null,
  name text not null,           -- e.g. "Lille → Dunkerque"
  stage_type text not null default 'flat', -- flat, mountain, tt, sprint
  date date not null,
  deadline timestamptz not null, -- 23:00 the day before
  locked boolean not null default false
);

-- Stage results (admin enters these after each stage)
create table stage_results (
  id serial primary key,
  stage_id int not null references stages(id),
  rider_id int not null references riders(id),
  time_seconds int not null,       -- stage time in seconds
  points int not null default 0,   -- points classification
  mountain_points int not null default 0,
  dnf boolean not null default false,
  unique(stage_id, rider_id)
);

-- User picks (one rider per stage per user)
create table picks (
  id serial primary key,
  user_id uuid not null references auth.users(id),
  stage_id int not null references stages(id),
  rider_id int not null references riders(id),
  submitted_at timestamptz not null default now(),
  is_late boolean not null default false,
  unique(user_id, stage_id)
);

-- User profiles (synced from auth.users)
create table profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fast lookups
create index idx_picks_user on picks(user_id);
create index idx_picks_stage on picks(stage_id);
create index idx_stage_results_stage on stage_results(stage_id);
create index idx_stages_deadline on stages(deadline);

-- Auto-create profile on signup (trigger)
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Enforce max 50 users
create or replace function check_max_users()
returns trigger as $$
begin
  if (select count(*) from profiles) >= 50 then
    raise exception 'Maximum number of players (50) reached';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger enforce_max_users
  before insert on profiles
  for each row execute function check_max_users();

-- View: General Classification (aggregated standings)
create or replace view general_classification as
with pick_times as (
  select
    p.user_id,
    p.stage_id,
    p.rider_id,
    p.is_late,
    coalesce(sr.time_seconds, 0) as time_seconds,
    case when p.is_late then 0 else coalesce(sr.points, 0) end as points,
    case when p.is_late then 0 else coalesce(sr.mountain_points, 0) end as mountain_points,
    coalesce(sr.dnf, false) as dnf
  from picks p
  left join stage_results sr on sr.stage_id = p.stage_id and sr.rider_id = p.rider_id
)
select
  pt.user_id,
  pr.display_name,
  sum(
    case
      when pt.is_late or pt.dnf then (
        select coalesce(max(sr2.time_seconds), 0)
        from stage_results sr2
        where sr2.stage_id = pt.stage_id and not sr2.dnf
      )
      else pt.time_seconds
    end
  ) as total_time,
  sum(pt.points) as total_points,
  sum(pt.mountain_points) as total_mountain_points,
  count(pt.stage_id) as stages_played
from pick_times pt
join profiles pr on pr.id = pt.user_id
group by pt.user_id, pr.display_name;

-- RLS Policies
alter table profiles enable row level security;
alter table picks enable row level security;
alter table riders enable row level security;
alter table stages enable row level security;
alter table stage_results enable row level security;

-- Everyone can read profiles, riders, stages, results
create policy "Public read profiles" on profiles for select using (true);
create policy "Public read riders" on riders for select using (true);
create policy "Public read stages" on stages for select using (true);
create policy "Public read results" on stage_results for select using (true);
create policy "Public read picks" on picks for select using (true);

-- Users can insert their own picks
create policy "Users insert own picks" on picks for insert
  with check (auth.uid() = user_id);

-- Users can update their own profile display name
create policy "Users update own profile" on profiles for update
  using (auth.uid() = id);

-- Admins can do everything (via service role key in edge functions)
