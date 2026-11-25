-- MoneyLife — откат мониторинга ошибок (supabase/client_errors.sql).
-- Удаляет только наши объекты по имени: задачу pg_cron 'moneylife-client-errors-prune' (если есть),
-- функции public.log_client_error и public.prune_client_errors и таблицу public.client_errors
-- (вместе с её индексом и счётчиком id) — без cascade. Таблица docs, другие функции, политики
-- и задачи pg_cron не затрагиваются. Сообщения о сбоях при этом стираются — в них нет данных людей.
-- После отката приложение продолжит вызывать log_client_error: вызов вернёт ошибку, приложение её молча пропустит.

begin;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'moneylife-client-errors-prune') then
    perform cron.unschedule('moneylife-client-errors-prune');
  end if;
end;
$$;

drop function if exists public.log_client_error(text, text, text, text);
drop function if exists public.prune_client_errors();
drop table if exists public.client_errors;

commit;
