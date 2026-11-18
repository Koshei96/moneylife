# Восстановление записей из ночного бэкапа

Бэкап делает `supabase/backup_docs.sql`: каждую ночь в 00:17 UTC копия всей таблицы `public.docs`
кладётся в `moneylife_backup.docs_snapshots`; отдельная очистка каждые 6 часов стирает снимки старше
5 суток 12 часов — остаётся около 6 последних копий (каждая живёт меньше 7 дней).

> 🛑 **Восстановление — только по слову владельца.** Это изменение записей пользователей
> (стоп-список, `ai-ops/RULES.md`, п. 1). Команда сама не восстанавливает: готовит запрос
> и предлагает его в дайджесте. Запускает владелец (или директор по его прямому «делай»).

Все запросы — в Supabase → SQL Editor. Реальные id и данные пользователей не копировать
в отчёты, дайджесты и скриншоты.

## 1. Какие снимки есть

```sql
select snap_at, count(*) as rows
from moneylife_backup.docs_snapshots
group by snap_at
order by snap_at desc;
```

## 2. Что есть у одного владельца в снимке (только посмотреть)

```sql
select col, count(*) as rows, max(updated_at) as last_change
from moneylife_backup.docs_snapshots
where snap_at = '2026-11-19 00:17:00.123+00'                 -- точное время из шага 1
  and owner   = '00000000-0000-0000-0000-000000000000'       -- id владельца записей
group by col
order by col;
```

Каких записей сейчас нет в `public.docs` (их и вернёт шаг 3):

```sql
select s.col, s.id, s.updated_at
from moneylife_backup.docs_snapshots s
where s.snap_at = '2026-11-19 00:17:00.123+00'
  and s.owner   = '00000000-0000-0000-0000-000000000000'
  and not exists (select 1 from public.docs d
                  where d.owner = s.owner and d.col = s.col and d.id = s.id);
```

## 3. Вернуть недостающие записи ОДНОГО владельца

> ⚠️ **Вставка вернёт и то, что человек удалил сам после снимка.** Запрос не отличает запись,
> потерянную по ошибке, от записи, которую человек стёр нарочно (удалил покупку, заметку,
> напоминание): обе «недостающие». Поэтому восстанавливать только то, что **точно потеряно
> по ошибке**: сначала шаг 2 («каких записей нет»), сверить список с владельцем и при
> необходимости сузить запрос условием `and s.col = '…'` / `and s.id in (…)`.

Только вставка того, чего нет. Существующие записи не меняются (`on conflict do nothing`),
никаких `delete` и `update` в `public.docs`.

```sql
insert into public.docs (owner, col, id, data, updated_at)
select s.owner, s.col, s.id, s.data, s.updated_at
from moneylife_backup.docs_snapshots s
where s.snap_at = '2026-11-19 00:17:00.123+00'
  and s.owner   = '00000000-0000-0000-0000-000000000000'
on conflict (owner, col, id) do nothing;
```

Supabase покажет, сколько строк вставлено, — оно должно совпасть с числом из запроса
«каких записей нет». Человеку после этого достаточно открыть приложение заново.

Записи удалённого аккаунта восстановить нельзя и не нужно: аккаунта в `auth.users` больше нет,
вставка упадёт на внешнем ключе `public.docs` → `auth.users` — так и задумано.

## Откат самого бэкапа

`supabase/backup_docs_rollback.sql` — снимает задачи `moneylife-backup-docs` и
`moneylife-backup-docs-prune`, удаляет по имени таблицу копий и обе функции, затем пустую схему
`moneylife_backup` (без cascade — чужое в ней не удалит, а остановится с ошибкой).
