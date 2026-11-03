-- =====================================================================================
-- MoneyLife — функция удаления аккаунта  public.delete_my_account()
-- ЧЕРНОВИК компании MoneyLife (ветка agent). В живую базу компания её НЕ запускала:
-- база меняется только руками владельца.
--
-- ЧТО ДЕЛАЕТ
--   Кнопка «Удалить навсегда» в приложении (shim.js → mlDeleteAccount) вызывает
--   c.rpc('delete_my_account') без параметров. Функция:
--     1) отказывает, если человек не вошёл (auth.uid() пустой) — ошибка 'not signed in';
--     2) удаляет ТОЛЬКО его записи: public.docs, где owner = auth.uid();
--     3) удаляет его аккаунт из auth.users (сессии и способы входа Supabase удалит сам).
--   Чужие записи и чужие аккаунты функция тронуть не может: она знает только того,
--   кто её вызвал. Секретный ключ service_role для этого не нужен.
--   Повторный вызов не падает: удалять уже нечего, функция просто ничего не делает.
--   Запускать текст ниже повторно тоже можно — он заменит функцию на ту же самую.
--
-- КАК ЗАПУСТИТЬ САМОМУ (около 2 минут)
--   1. Откройте supabase.com и войдите. Выберите проект MoneyLife.
--   2. Слева нажмите «SQL Editor» (значок с квадратом и чёрточками) → «New query» (новый запрос).
--   3. Скопируйте ВЕСЬ этот файл (от первой до последней строки) и вставьте в поле.
--   4. Нажмите зелёную кнопку «Run» (запустить) внизу справа.
--      Должно появиться «Success. No rows returned» (успешно, строк нет). Это нормально.
--      Если Supabase спросит про «destructive operation» (опасную операцию) — это из-за
--      слова delete внутри функции; нажмите «Run this query» (выполнить).
--
-- КАК ПРОВЕРИТЬ
--   В том же SQL Editor: новый запрос, вставить две строки ниже (без знаков «--»), Run:
--     select proname, prosecdef, proconfig from pg_proc where proname = 'delete_my_account';
--     select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'delete_my_account';
--   Первый: одна строка, prosecdef = true, proconfig = {"search_path=\"\""}.
--   Второй: в списке есть authenticated, и НЕТ anon и PUBLIC
--   (postgres и service_role — служебные, это нормально).
--   Настоящая проверка — только на ТЕСТОВОМ аккаунте, не на своём: войти вторым аккаунтом,
--   внести 1–2 записи, «Настройки» → «Аккаунт» → «Удалить аккаунт» (кнопка появится после
--   флага accountDelete: true в config.js). Потом в Supabase → Authentication → Users
--   тестового аккаунта нет, а ваши записи на месте.
--
-- КАК ОТКАТИТЬ (если понадобится)
--     drop function if exists public.delete_my_account();
-- =====================================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- 1) записи пользователя (каскад docs_owner_fkey тоже бы их удалил — удаляем явно)
  delete from public.docs where owner = me;

  -- 2) сам аккаунт; если его уже нет, удалится 0 строк — без ошибки
  delete from auth.users where id = me;
end;
$$;

-- вызывать могут только вошедшие пользователи; анонимам и «всем» — нельзя
-- (Supabase по умолчанию выдаёт новым функциям право anon, поэтому anon убираем явно)
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
