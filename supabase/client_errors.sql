-- =====================================================================================
-- MoneyLife — мониторинг ошибок приложения (BACKLOG, Этап 2, И4). Уровень 🟡: в базе ТОЛЬКО добавление.
--
-- ЧТО ДЕЛАЕТ
--   1) Таблица public.client_errors — сообщения о сбоях JavaScript у пользователей:
--        id, ts (время записи на сервере), msg (текст ошибки ≤ 200 знаков), src (файл:строка ≤ 80),
--        ver (метка сборки ≤ 20), lang (язык ≤ 5).
--      НЕТ user_id, почты, IP и любых записей пользователя: по строке нельзя понять, чья это ошибка.
--      RLS включён, политик НЕТ, права anon/authenticated на таблицу отозваны — читать и писать
--      напрямую через REST API Supabase никто не может (только служебные роли: postgres, service_role).
--   2) Функция public.log_client_error(p_msg, p_src, p_ver, p_lang) — единственный путь записи
--      (security definer, set search_path = ''). Вызывать могут anon и authenticated
--      (приложение вызывает её и до входа). Внутри:
--        - обезличивание ещё раз, на сервере (приложение уже делает это само): адреса почты → <email>,
--          ссылки → <url>, текст в кавычках длиннее 3 знаков → <…>, длинные токены → <…>, все цифры → #;
--        - обрезка длин: msg 200, src 80, ver 20, lang 5 (src/ver/lang — только безопасные знаки);
--        - защита от засорения: не больше 2000 строк за последние сутки ВСЕГО; лишнее молча
--          отбрасывается (функция просто ничего не пишет, ошибки клиенту нет);
--        - стирает строки старше 29 суток 12 часов.
--   3) Функция public.prune_client_errors() — та же очистка, только для служебных ролей,
--      и задача pg_cron 'moneylife-client-errors-prune' каждые 6 часов (00:37, 06:37, 12:37, 18:37 UTC):
--      строки удаляются, даже если новых ошибок нет.
--
-- СКОЛЬКО ХРАНИТСЯ
--   Порог — 29 суток 12 часов, очистка 4 раза в сутки и при каждой новой записи → строка живёт
--   не дольше ~29 суток 18 часов; даже при пропуске нескольких запусков pg_cron — меньше 30 дней.
--   Так написано в privacy.html: «…автоматически сохраняются у нас до 30 дней».
--
-- СЧЁТЧИК ДЛЯ ДАЙДЖЕСТА (SQL Editor / execute_sql, только чтение)
--     select count(*) from public.client_errors where ts > now() - interval '1 day';
--     select msg, src, ver, count(*) from public.client_errors
--       where ts > now() - interval '1 day' group by 1, 2, 3 order by 4 desc limit 10;
--
-- КАК ПРОВЕРИТЬ (после запуска файла)
--     select public.log_client_error('Test 123 "secret" a@b.co', 'index.html:12', '20261124120000', 'ru');
--     select msg, src, ver, lang from public.client_errors order by id desc limit 1;
--       → 'Test ### <…> <email>', 'index.html:12', '20261124120000', 'ru'
--       (цифры заменяются только в msg; в src остаётся номер строки, в ver — метка сборки: это не данные человека)
--     select grantee, privilege_type from information_schema.role_table_grants
--       where table_schema = 'public' and table_name = 'client_errors';   → нет anon и authenticated
--     select jobname, schedule from cron.job where jobname = 'moneylife-client-errors-prune';
--     delete from public.client_errors where msg like 'Test #%';         -- убрать проверочную строку
--
-- КАК ОТКАТИТЬ
--   supabase/client_errors_rollback.sql: снимает задачу pg_cron по имени, удаляет обе функции
--   и таблицу по имени. Остальные таблицы, функции, политики и задачи pg_cron не затрагиваются.
--
-- Повторный запуск безопасен: таблица и функции проверяются по метке-комментарию — если объект
-- с таким именем уже есть, но он не наш, файл останавливается с ошибкой и ничего не меняет.
-- =====================================================================================

begin;

do $$
begin
  if to_regclass('public.client_errors') is not null
     and coalesce(obj_description(to_regclass('public.client_errors'), 'pg_class'), '') not like 'moneylife:client_errors%' then
    raise exception 'таблица public.client_errors уже есть и она не наша — не трогаем';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('log_client_error', 'prune_client_errors')
               and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'moneylife:client_errors%') then
    raise exception 'функция public.log_client_error или public.prune_client_errors уже есть и она не наша — не трогаем';
  end if;
end;
$$;

create table if not exists public.client_errors (
  id   bigint generated always as identity primary key,
  ts   timestamptz not null default now(),
  msg  text not null check (char_length(msg) between 1 and 200),
  src  text check (char_length(src) <= 80),
  ver  text check (char_length(ver) <= 20),
  lang text check (char_length(lang) <= 5)
);
comment on table public.client_errors is 'moneylife:client_errors — сбои JS у пользователей, без данных о человеке (нет id, почты, адреса), хранение < 30 дней (supabase/client_errors.sql)';
create index if not exists client_errors_ts_idx on public.client_errors (ts);

alter table public.client_errors enable row level security;
-- политик нет намеренно: anon и authenticated не видят и не пишут ни одной строки напрямую
revoke all on table public.client_errors from public, anon, authenticated;
revoke all on sequence public.client_errors_id_seq from public, anon, authenticated;

create or replace function public.log_client_error(p_msg text, p_src text default null, p_ver text default null, p_lang text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m text;
  n integer;
begin
  m := pg_catalog.left(coalesce(p_msg, ''), 600);
  m := pg_catalog.regexp_replace(m, '[^[:space:]<>"''`@]+@[^[:space:]<>"''`@]+\.[A-Za-z]{2,}', '<email>', 'g');
  m := pg_catalog.regexp_replace(m, '(https?|wss?|file|blob|data):[^[:space:]"''`)]+', '<url>', 'g');
  m := pg_catalog.regexp_replace(m, '"[^"]{4,}"', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '''[^'']{4,}''', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '`[^`]{4,}`', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '«[^»]{4,}»', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '“[^”]{4,}”', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '[A-Za-z0-9_-]{32,}', '<…>', 'g');
  m := pg_catalog.regexp_replace(m, '[0-9]', '#', 'g');
  m := pg_catalog.btrim(pg_catalog.left(m, 200));
  if m = '' then
    return;
  end if;

  -- одна запись за раз: счётчик за сутки не обгонят параллельные вызовы
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('moneylife.client_errors'));
  delete from public.client_errors where ts < pg_catalog.now() - interval '29 days 12 hours';
  select count(*) into n from public.client_errors where ts > pg_catalog.now() - interval '1 day';
  if n >= 2000 then
    return;   -- засорение: молча отбрасываем
  end if;

  insert into public.client_errors (msg, src, ver, lang)
  values (
    m,
    nullif(pg_catalog.left(pg_catalog.regexp_replace(coalesce(p_src, ''), '[^A-Za-z0-9_.:-]', '', 'g'), 80), ''),
    nullif(pg_catalog.left(pg_catalog.regexp_replace(coalesce(p_ver, ''), '[^A-Za-z0-9_.-]', '', 'g'), 20), ''),
    nullif(pg_catalog.left(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_lang, ''), '[^A-Za-z-]', '', 'g')), 5), '')
  );
end;
$$;
comment on function public.log_client_error(text, text, text, text) is 'moneylife:client_errors — запись сбоя JS (обезличено, ≤ 2000 в сутки)';

create or replace function public.prune_client_errors()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.client_errors where ts < pg_catalog.now() - interval '29 days 12 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.prune_client_errors() is 'moneylife:client_errors — очистка старше 29 суток 12 часов';

-- новые функции в public по умолчанию доступны всем (урок 28.10): сначала отзываем, потом даём нужное
revoke execute on function public.log_client_error(text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_client_error(text, text, text, text) to anon, authenticated;
revoke execute on function public.prune_client_errors() from public, anon, authenticated;

-- задача pg_cron: пересоздаём только СВОЮ задачу по имени, остальные не трогаем
do $$
begin
  if exists (select 1 from cron.job where jobname = 'moneylife-client-errors-prune') then
    perform cron.unschedule('moneylife-client-errors-prune');
  end if;
end;
$$;

select cron.schedule('moneylife-client-errors-prune', '37 */6 * * *', $$select public.prune_client_errors()$$);

commit;
