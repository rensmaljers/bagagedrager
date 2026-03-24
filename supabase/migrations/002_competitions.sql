-- Add competitions table
create table competitions (
  id serial primary key,
  name text not null,               -- e.g. "Tour de France 2025"
  slug text unique not null,        -- e.g. "tour-2025"
  competition_type text not null,   -- tour, giro, vuelta, classic
  year int not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Add competition_id to stages
alter table stages add column competition_id int references competitions(id);

-- Drop old unique constraint on stage_number (was global, now per competition)
alter table stages drop constraint stages_stage_number_key;
alter table stages add constraint stages_competition_stage_unique unique(competition_id, stage_number);

-- Index
create index idx_stages_competition on stages(competition_id);

-- RLS for competitions
alter table competitions enable row level security;
create policy "Public read competitions" on competitions for select using (true);

-- Allow admins to insert/update via REST (check is_admin in profiles)
-- For riders, stages, competitions: admins write via service role in edge functions
-- But for convenience, let's also allow direct REST writes with RLS for admins
create policy "Admin insert competitions" on competitions for insert
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
create policy "Admin update competitions" on competitions for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "Admin insert stages" on stages for insert
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
create policy "Admin update stages" on stages for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
create policy "Admin delete stages" on stages for delete
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "Admin insert riders" on riders for insert
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
create policy "Admin update riders" on riders for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
create policy "Admin delete riders" on riders for delete
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "Admin update profiles" on profiles for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- Update general_classification view to include competition_id
drop view if exists general_classification;
create view general_classification as
with pick_times as (
  select
    p.user_id,
    p.stage_id,
    p.rider_id,
    p.is_late,
    s.competition_id,
    coalesce(sr.time_seconds, 0) as time_seconds,
    case when p.is_late then 0 else coalesce(sr.points, 0) end as points,
    case when p.is_late then 0 else coalesce(sr.mountain_points, 0) end as mountain_points,
    coalesce(sr.dnf, false) as dnf
  from picks p
  join stages s on s.id = p.stage_id
  left join stage_results sr on sr.stage_id = p.stage_id and sr.rider_id = p.rider_id
)
select
  pt.competition_id,
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
group by pt.competition_id, pt.user_id, pr.display_name;
