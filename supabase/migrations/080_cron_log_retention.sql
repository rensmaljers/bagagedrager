-- cron.job_run_details heeft geen ingebouwde retentie: elke cron-run (9 jobs,
-- 24/7) schrijft voor altijd een rij weg. Stond op 30.869 rijen / 10MB en
-- bleef groeien -- droeg bij aan het Disk IO Budget-verbruik. Purge dagelijks
-- rijen ouder dan 7 dagen.

select cron.schedule('purge-cron-job-run-details', '0 4 * * *', $$
  delete from cron.job_run_details
  where end_time < now() - interval '7 days'
$$);
