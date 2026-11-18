-- MoneyLife — откат ночного бэкапа (supabase/backup_docs.sql).
-- Снимает только задачу pg_cron 'moneylife-backup-docs' (если она есть) и удаляет схему backup
-- вместе со всеми резервными копиями. public.docs и другие задачи pg_cron не затрагиваются.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'moneylife-backup-docs') then
    perform cron.unschedule('moneylife-backup-docs');
  end if;
end;
$$;

drop schema if exists backup cascade;
