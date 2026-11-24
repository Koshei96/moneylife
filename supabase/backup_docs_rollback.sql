-- MoneyLife — откат ночного бэкапа (supabase/backup_docs.sql).
-- Удаляет только наши объекты по имени: задачи pg_cron 'moneylife-backup-docs' и
-- 'moneylife-backup-docs-prune' (если есть), таблицу резервных копий, две функции и затем схему
-- moneylife_backup — без cascade: если в схеме окажется что-то чужое, откат остановится с ошибкой.
-- public.docs и другие задачи pg_cron не затрагиваются.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'moneylife-backup-docs') then
    perform cron.unschedule('moneylife-backup-docs');
  end if;
  if exists (select 1 from cron.job where jobname = 'moneylife-backup-docs-prune') then
    perform cron.unschedule('moneylife-backup-docs-prune');
  end if;
end;
$$;

drop function if exists moneylife_backup.snapshot_docs();
drop function if exists moneylife_backup.prune_docs_snapshots();
drop table if exists moneylife_backup.docs_snapshots;
drop schema if exists moneylife_backup;
