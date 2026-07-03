-- 066: optioneel logo per ronde (sfeer) — getoond in de navbar naast de ronde-kiezer
alter table competitions add column if not exists logo_url text;
