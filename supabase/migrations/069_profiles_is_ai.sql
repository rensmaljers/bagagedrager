-- 069: AI-speler-vlag — admin-voorvertoning toont vóór de deadline alleen
-- de picks van AI-spelers (+ wie nog geen keuze heeft), niet die van mensen.
alter table profiles add column if not exists is_ai boolean not null default false;
update profiles set is_ai = true where display_name like '%🤖%';
