-- =====================================================================================
-- MoneyLife — ночной бэкап базы (BACKLOG, Этап 2, И3). Уровень 🟡: в базе ТОЛЬКО добавление.
--
-- ЧТО ДЕЛАЕТ
--   1) Создаёт отдельную схему backup (не public — её не видит REST API Supabase,
--      у anon и authenticated к ней нет никаких прав).
--   2) В ней — таблица backup.docs_snapshots: копии всех строк public.docs, каждая копия
--      помечена временем снимка snap_at. Внешнего ключа на auth.users НЕТ: бэкап не мешает
--      удалению аккаунта (supabase/delete_my_account.sql удаляет docs и auth.users как раньше).
--      RLS включён, политик нет — обычным пользователям таблица недоступна совсем.
--   3) Функция backup.snapshot_docs(): копирует все строки public.docs с одним snap_at = now(),
--      затем стирает старые снимки (только в backup.docs_snapshots) и возвращает, сколько
--      строк скопировано. Вызывать её могут только служебные роли (postgres, pg_cron).
--   4) Задача pg_cron 'moneylife-backup-docs' — раз в сутки в 00:17 UTC (02:17/03:17 по Киеву).
--      Другие задачи pg_cron (например, orion_push_schedule) этот файл не трогает.
--
-- СКОЛЬКО ХРАНИТСЯ
--   Остаются 7 последних снимков. Старым считается снимок старше 6 суток 12 часов: так снимок
--   живёт ровно 7 суток (удаляется на седьмом ночном запуске после своего), а не 8 — даже если
--   pg_cron запустится на несколько секунд раньше. Значит, записи удалённого аккаунта остаются
--   в резервных копиях не дольше 7 дней — так и написано в privacy.html и delete.html.
--
-- ЗАЧЕМ
--   Если ошибка в приложении или в базе испортит или сотрёт записи, их можно вернуть из копии
--   за любой из последних 7 дней (инструкция — supabase/backup_docs_restore.md; восстановление —
--   🛑, только по слову владельца).
--
-- КАК ПРОВЕРИТЬ (SQL Editor, после запуска файла)
--     select jobname, schedule, command from cron.job where jobname = 'moneylife-backup-docs';
--       → одна строка: '17 0 * * *', 'select backup.snapshot_docs()'
--     select backup.snapshot_docs();                    → число, равное select count(*) from public.docs
--     select snap_at, count(*) from backup.docs_snapshots group by snap_at order by snap_at desc;
--     select grantee, privilege_type from information_schema.role_table_grants
--       where table_schema = 'backup';                  → нет anon и authenticated
--     select grantee from information_schema.routine_privileges
--       where routine_schema = 'backup';                → нет anon, authenticated и PUBLIC
--   Через сутки: select * from cron.job_run_details where jobid = (select jobid from cron.job
--     where jobname = 'moneylife-backup-docs') order by start_time desc limit 3;  → status succeeded
--
-- КАК ОТКАТИТЬ
--   Запустить supabase/backup_docs_rollback.sql (снимает задачу 'moneylife-backup-docs'
--   и удаляет схему backup со всеми копиями). public.docs откат не затрагивает.
--
-- Повторный запуск файла безопасен: if not exists / create or replace, задача пересоздаётся.
-- =====================================================================================

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table if not exists backup.docs_snapshots (
  snap_at    timestamptz not null,
  owner      uuid        not null,
  col        text        not null,
  id         text        not null,
  data       jsonb,
  updated_at timestamptz,
  primary key (snap_at, owner, col, id)
);

alter table backup.docs_snapshots enable row level security;
-- политик нет намеренно: anon и authenticated не видят ни одной строки
revoke all on table backup.docs_snapshots from public, anon, authenticated;

create or replace function backup.snapshot_docs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t timestamptz := pg_catalog.now();
  n integer;
begin
  -- 1) копия всех строк public.docs (только чтение из public.docs)
  insert into backup.docs_snapshots (snap_at, owner, col, id, data, updated_at)
  select t, d.owner, d.col, d.id, d.data, d.updated_at
  from public.docs as d
  on conflict (snap_at, owner, col, id) do nothing;
  get diagnostics n = row_count;

  -- 2) старые снимки — только в нашей таблице; остаются 7 последних (каждый живёт 7 суток)
  delete from backup.docs_snapshots
  where snap_at < t - interval '6 days 12 hours';

  return n;
end;
$$;

revoke execute on function backup.snapshot_docs() from public, anon, authenticated;

-- задача pg_cron: пересоздаём только СВОЮ задачу по её имени, остальные не трогаем
do $$
begin
  if exists (select 1 from cron.job where jobname = 'moneylife-backup-docs') then
    perform cron.unschedule('moneylife-backup-docs');
  end if;
end;
$$;

select cron.schedule('moneylife-backup-docs', '17 0 * * *', $$select backup.snapshot_docs()$$);
