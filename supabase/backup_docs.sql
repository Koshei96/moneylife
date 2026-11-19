-- =====================================================================================
-- MoneyLife — ночной бэкап базы (BACKLOG, Этап 2, И3). Уровень 🟡: в базе ТОЛЬКО добавление.
--
-- ЧТО ДЕЛАЕТ
--   1) Создаёт свою отдельную схему moneylife_backup (не public — её не видит REST API Supabase,
--      у anon и authenticated к ней нет никаких прав). Если схема с таким именем уже есть, но в ней
--      нет нашей таблицы docs_snapshots, — файл останавливается с ошибкой: чужую схему не трогаем.
--   2) В ней — таблица moneylife_backup.docs_snapshots: копии всех строк public.docs, каждая копия
--      помечена временем снимка snap_at. Внешнего ключа на auth.users НЕТ: бэкап не мешает
--      удалению аккаунта (supabase/delete_my_account.sql удаляет docs и auth.users как раньше).
--      RLS включён, политик нет — обычным пользователям таблица недоступна совсем.
--   3) Две функции (вызывать могут только служебные роли — postgres, pg_cron):
--      moneylife_backup.snapshot_docs()        — копирует все строки public.docs с одним
--                                                snap_at = now(); возвращает число строк;
--      moneylife_backup.prune_docs_snapshots() — стирает старые снимки (только в нашей таблице);
--                                                возвращает число стёртых строк.
--   4) Две задачи pg_cron, у каждой своя транзакция — ошибка снимка не отменяет очистку:
--      'moneylife-backup-docs'        — снимок раз в сутки в 00:17 UTC (02:17/03:17 по Киеву);
--      'moneylife-backup-docs-prune'  — очистка каждые 6 часов (00:47, 06:47, 12:47, 18:47 UTC).
--      Другие задачи pg_cron (например, из orion_push_schedule) этот файл не трогает.
--
-- СКОЛЬКО ХРАНИТСЯ
--   Старым считается снимок старше 5 суток 12 часов — остаётся около 6 последних копий.
--   Очистка идёт 4 раза в сутки, поэтому снимок исчезает не позже чем через ~5 суток 18 часов,
--   а если очистка пропустит запуск или два (pg_cron может опоздать или не запуститься) —
--   всё равно раньше 7 суток. Значит, записи удалённого аккаунта остаются в резервных копиях
--   не дольше 7 дней — так написано в privacy.html и delete.html, с запасом.
--   Пропуск или сбой снимка на очистку не влияет: это отдельная задача и отдельная транзакция.
--
-- ЗАЧЕМ
--   Если ошибка в приложении или в базе испортит или сотрёт записи, их можно вернуть из копии
--   за любой из последних ~6 дней (инструкция — supabase/backup_docs_restore.md; восстановление —
--   🛑, только по слову владельца).
--
-- КАК ПРОВЕРИТЬ (SQL Editor, после запуска файла)
--     select jobname, schedule, command from cron.job where jobname like 'moneylife-backup-docs%';
--       → две строки: '17 0 * * *' snapshot_docs() и '47 */6 * * *' prune_docs_snapshots()
--     select moneylife_backup.snapshot_docs();          → число, равное select count(*) from public.docs
--     select snap_at, count(*) from moneylife_backup.docs_snapshots group by snap_at order by snap_at desc;
--     select moneylife_backup.prune_docs_snapshots();   → 0 (старых снимков ещё нет)
--     select grantee, privilege_type from information_schema.role_table_grants
--       where table_schema = 'moneylife_backup';        → нет anon и authenticated
--     select grantee from information_schema.routine_privileges
--       where routine_schema = 'moneylife_backup';      → нет anon, authenticated и PUBLIC
--   Через сутки: select j.jobname, d.status, d.start_time from cron.job_run_details d
--     join cron.job j using (jobid) where j.jobname like 'moneylife-backup-docs%'
--     order by d.start_time desc limit 6;               → status succeeded
--
-- КАК ОТКАТИТЬ
--   Запустить supabase/backup_docs_rollback.sql: снимает обе задачи по имени, удаляет таблицу
--   и функции по имени, затем пустую схему moneylife_backup. public.docs откат не затрагивает.
--
-- Повторный запуск файла безопасен: схема проверяется явно, таблица — if not exists,
-- функции — create or replace, обе задачи пересоздаются по своим именам.
-- =====================================================================================

do $$
begin
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'moneylife_backup') then
    if not exists (select 1 from pg_catalog.pg_class c
                   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'moneylife_backup' and c.relname = 'docs_snapshots' and c.relkind = 'r') then
      raise exception 'схема moneylife_backup уже есть, но в ней нет таблицы docs_snapshots — это не наша схема, не трогаем';
    end if;
  else
    create schema moneylife_backup;
  end if;
end;
$$;

revoke all on schema moneylife_backup from public, anon, authenticated;

create table if not exists moneylife_backup.docs_snapshots (
  snap_at    timestamptz not null,
  owner      uuid        not null,
  col        text        not null,
  id         text        not null,
  data       jsonb,
  updated_at timestamptz,
  primary key (snap_at, owner, col, id)
);

alter table moneylife_backup.docs_snapshots enable row level security;
-- политик нет намеренно: anon и authenticated не видят ни одной строки
revoke all on table moneylife_backup.docs_snapshots from public, anon, authenticated;

-- снимок: только чтение из public.docs и вставка в нашу таблицу
create or replace function moneylife_backup.snapshot_docs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into moneylife_backup.docs_snapshots (snap_at, owner, col, id, data, updated_at)
  select pg_catalog.now(), d.owner, d.col, d.id, d.data, d.updated_at
  from public.docs as d
  on conflict (snap_at, owner, col, id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- очистка: только наша таблица, снимки старше 5 суток 12 часов
create or replace function moneylife_backup.prune_docs_snapshots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from moneylife_backup.docs_snapshots
  where snap_at < pg_catalog.now() - interval '5 days 12 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function moneylife_backup.snapshot_docs() from public, anon, authenticated;
revoke execute on function moneylife_backup.prune_docs_snapshots() from public, anon, authenticated;

-- задачи pg_cron: пересоздаём только СВОИ задачи по их именам, остальные не трогаем
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

select cron.schedule('moneylife-backup-docs', '17 0 * * *', $$select moneylife_backup.snapshot_docs()$$);
select cron.schedule('moneylife-backup-docs-prune', '47 */6 * * *', $$select moneylife_backup.prune_docs_snapshots()$$);
