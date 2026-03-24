-- ============================================
-- RPC FUNCTIONS (vervangt Edge Functions)
-- ============================================

-- Fix: maak trigger robuuster voor signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1),
      'Speler'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Maak rensmaljers@hotmail.com admin
UPDATE profiles SET is_admin = true
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'rensmaljers@hotmail.com'
);

-- Ook via display_name voor zekerheid
UPDATE profiles SET is_admin = true
WHERE lower(display_name) = 'rens'
   OR lower(display_name) LIKE 'rens%';

-- ============================================
-- SUBMIT PICK (met validatie)
-- ============================================
create or replace function submit_pick(p_stage_id int, p_rider_id int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_stage record;
  v_comp_id int;
  v_is_late boolean;
  v_already_used boolean;
  v_existing_pick record;
  v_result record;
begin
  if v_user_id is null then
    raise exception 'Niet ingelogd';
  end if;

  -- Haal stage op
  select * into v_stage from stages where id = p_stage_id;
  if v_stage is null then
    raise exception 'Etappe niet gevonden';
  end if;

  v_comp_id := v_stage.competition_id;
  v_is_late := (now() > v_stage.deadline) or v_stage.locked;

  -- Check of renner al gebruikt in andere etappe van dezelfde competitie
  select exists(
    select 1 from picks p
    join stages s on s.id = p.stage_id
    where p.user_id = v_user_id
      and p.rider_id = p_rider_id
      and p.stage_id != p_stage_id
      and s.competition_id = v_comp_id
  ) into v_already_used;

  if v_already_used then
    raise exception 'Je hebt deze renner al gebruikt in een andere etappe';
  end if;

  -- Check bestaande pick
  select * into v_existing_pick from picks
  where user_id = v_user_id and stage_id = p_stage_id;

  if v_existing_pick is not null and v_is_late then
    raise exception 'Etappe is vergrendeld, keuze kan niet meer gewijzigd worden';
  end if;

  -- Upsert pick
  insert into picks (user_id, stage_id, rider_id, is_late, submitted_at)
  values (v_user_id, p_stage_id, p_rider_id, v_is_late, now())
  on conflict (user_id, stage_id)
  do update set rider_id = p_rider_id, is_late = v_is_late, submitted_at = now()
  returning * into v_result;

  return jsonb_build_object(
    'success', true,
    'pick_id', v_result.id,
    'is_late', v_is_late,
    'warning', case when v_is_late then 'Keuze ingediend na deadline — te laat straf geldt' else null end
  );
end;
$$;

-- ============================================
-- ADMIN: SAVE RESULTS
-- ============================================
create or replace function admin_save_results(p_stage_id int, p_results jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_item jsonb;
  v_count int := 0;
begin
  select is_admin into v_is_admin from profiles where id = v_user_id;
  if not coalesce(v_is_admin, false) then
    raise exception 'Admin rechten vereist';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    insert into stage_results (stage_id, rider_id, time_seconds, points, mountain_points, dnf)
    values (
      p_stage_id,
      (v_item->>'rider_id')::int,
      (v_item->>'time_seconds')::int,
      coalesce((v_item->>'points')::int, 0),
      coalesce((v_item->>'mountain_points')::int, 0),
      coalesce((v_item->>'dnf')::boolean, false)
    )
    on conflict (stage_id, rider_id)
    do update set
      time_seconds = excluded.time_seconds,
      points = excluded.points,
      mountain_points = excluded.mountain_points,
      dnf = excluded.dnf;
    v_count := v_count + 1;
  end loop;

  -- Lock stage
  update stages set locked = true where id = p_stage_id;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

-- ============================================
-- DEELNEMERS KEUZES (zichtbaar na deadline)
-- ============================================
create or replace view stage_picks_public as
select
  p.stage_id,
  s.stage_number,
  s.competition_id,
  s.locked,
  s.deadline,
  p.user_id,
  pr.display_name,
  p.rider_id,
  r.name as rider_name,
  r.team as rider_team,
  r.bib_number,
  p.is_late,
  sr.time_seconds,
  sr.points,
  sr.mountain_points,
  sr.dnf
from picks p
join stages s on s.id = p.stage_id
join profiles pr on pr.id = p.user_id
join riders r on r.id = p.rider_id
left join stage_results sr on sr.stage_id = p.stage_id and sr.rider_id = p.rider_id
where s.locked = true or s.deadline < now();
