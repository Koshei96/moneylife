# Разбор конкурентов — 16.11.2026

Лев (аналитик) · регулярное дело №8 · дополняет `competitors-2026-11-03.md`, `competitors-2026-11-10.md`,
`features-2026-11-07.md`, `ideas-2026-11-08.md` (уже найденное там не повторяю).
Источники открыты 16.11.2026. Отзывы Google Play — свежие 1★/2★ (сортировка «новые»), получены через
Firecrawl (провайдер `play-google-com`); дату отзыва провайдер не отдал — указываю версию приложения из отзыва.
Цитаты короче 15 слов, английские и немецкие — с переводом. Что не удалось проверить — сказано прямо.

Выбор недели (новые лица, кроме Delta и CoinStats — у них свежие обновления и отзывы):
**Kubera** (учёт всего капитала), **Strike** (BTC и DCA), **Delta** (трекер), **CoinStats** (трекер),
**getquin** (европейский трекер), **Relai / Bitpanda** (DCA-планы), **monobank** и **Revolut** (банки — образец удобства).

---

## 1. Kubera — учёт всего капитала

**Что есть у них и нет у нас**
- Итог всего портфеля можно смотреть **в биткоинах**; стейблкоины считаются «наличными»
  ([kubera.com/crypto-tracker](https://www.kubera.com/crypto-tracker)). У нас итог — только $ и ₴
  (чип «≈» под суммой, `index.html` ~2120); показа в BTC нет (поиск «сатош», «в BTC» — пусто).
- **Fast Forward** — расчёт будущего по сценариям со своими правилами, с поправкой на инфляцию
  «в сегодняшних деньгах» ([обзор WalletHacks](https://wallethacks.com/kubera-review/)). У нас похожее есть
  частично: «Число свободы» со сроком по взносу (`plus.js` ~315).
- **Life Check** — если владелец не отвечает на проверку, доверенный человек получает доступ к сведениям
  (не к деньгам) ([там же](https://wallethacks.com/kubera-review/)).
- Ссылки «только просмотр» с паролем и сроком; ИИ-импорт из CSV, PDF и скриншотов (там же).

**Что бесит людей:** в обзоре минусы — платная подписка после 14 дней и (на момент обзора) нет мобильного
приложения ([там же](https://wallethacks.com/kubera-review/)). Свежие отзывы 1★ не смотрел — не проверено.

## 2. Strike — покупка BTC и DCA

**Что нового:** 07.10.2026 — **Stacks**: до 5 именных «стопок» BTC под цели, у каждой свой план
регулярной покупки без комиссии ([Crypto Briefing](https://cryptobriefing.com/strike-launches-stacks-bitcoin-savings/)).
В App Store — оповещения о цене, виджеты, учёт цены покупки (cost basis), 4,8★ из ~29 тыс.
([App Store](https://apps.apple.com/app/apple-store/id1488724463)). Последние «Что нового» — общее
«исправления ошибок», конкретики нет.

**Что есть у них и нет у нас:** цели-«копилки» внутри BTC. У нас цель в BTC стоит в BACKLOG (P4, 28.10) —
Stacks подтверждает, что приём живой; отдельной идеей не предлагаю.

**Что бесит людей (Google Play 1★):**
- Экран отправки с платными «скоростями» выглядит как плата за то, чего сеть не делает:
  «makes it look like you're paying for speed» — «выглядит, будто платишь за скорость»
  ([отзыв](https://play.google.com/store/apps/details?id=zapsolutions.strike&reviewId=f3d4fd89-0ac9-4d79-9155-823233d8a078)).
- Купленное недоступно 14–22 дня, закрытые счета без причины
  ([отзыв](https://play.google.com/store/apps/details?id=zapsolutions.strike&reviewId=e4e562c0-9957-4256-9d90-65916a2ce7f3),
  [отзыв](https://play.google.com/store/apps/details?id=zapsolutions.strike&reviewId=b30f87a0-92ec-4830-a5f3-19424b0312e2)).
  К нам не относится (мы не держим деньги), но показывает: люди не понимают, кто и за что с них берёт.

## 3. Delta (eToro)

**Что нового:** обновление 04.11.2026 — «Delta AI» для всех: «What's Going On» — объяснение крупных движений
рынка и «умнее» объяснение по своему портфелю, ограниченное число ИИ-ответов в месяц
([Google Play](https://play.google.com/store/apps/details?id=io.getdelta.android&hl=en&gl=US)). 4,1★, 31,3 тыс. отзывов.

**Что есть у них и нет у нас:** ответ «почему портфель изменился за день». У нас «24ч» — одна цифра
(`index.html` ~2118), «Лидеры дня» — только проценты монет (~2145), вклада каждой монеты в $ нет.

**Что бесит людей (1★):**
- Второй портфель после смены телефона — только по подписке:
  «I can only see one of them on the free plan» — «на бесплатном вижу только один»
  ([отзыв](https://play.google.com/store/apps/details?id=io.getdelta.android&reviewId=7b651e65-f3d7-4619-aca8-525f182ba917)).
- Неверные цифры: «I just don't know where it pulls its numbers from» — «не понимаю, откуда цифры»
  ([отзыв](https://play.google.com/store/apps/details?id=io.getdelta.android&reviewId=95b51cc2-ef48-4806-a728-90740880a883)).
- Нет импорта CSV — «without .csv imports I just can't use it» — «без CSV пользоваться не могу»
  ([отзыв](https://play.google.com/store/apps/details?id=io.getdelta.android&reviewId=854a3a7c-3ca6-4df6-b448-9cce6fb4cfa5)).
- После слияния с eToro приложение недоступно в части стран, а подписку списали
  ([отзыв](https://play.google.com/store/apps/details?id=io.getdelta.android&reviewId=5557490b-fab4-444f-b477-fe56c76755cd)).

## 4. CoinStats

**Что нового:** ИИ-чат прямо в знакомстве (видно по отзыву на 5.33.1). Trustpilot 4,2★ из ~8,8 тыс.
([Trustpilot](https://ie.trustpilot.com/review/coinstats.app)).

**Что бесит людей:**
- ИИ-чат при знакомстве: «Not everything needs Ai chat» — «не всему нужен ИИ-чат»
  ([Google Play 1★](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=627ddfd2-e21e-41c3-bc72-8cd8ca1e68a0)).
  Нам урок: «Орион» не навязывать в знакомстве.
- Люди думают, что трекер хранит их деньги: «I don't know how to withdraw money from coinstats» —
  «не знаю, как вывести деньги из CoinStats»
  ([отзыв](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=0ce990cf-e99b-44ae-b226-624ceae7ebb3));
  ещё два 1★ про «украденные» деньги
  ([1](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=014f5fae-c287-4b51-b3e1-48dc8892747e)),
  а CoinStats на Trustpilot отвечает, что не держит средства и это, вероятно, мошенники
  ([Trustpilot](https://ie.trustpilot.com/review/coinstats.app)).
- Удалённая история без предупреждения (Trustpilot 2★, 17.09.2026; Google Play 1★
  [отзыв](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=682d12bd-af96-4896-b007-d311e7f35bee)).
- Неверная прибыль (P&L) по отдельным монетам, пробный период без обещанного напоминания, трудная отмена
  подписки ([Trustpilot](https://ie.trustpilot.com/review/coinstats.app), 14–15.10.2026).
- Связка с Binance: «some days i see a 1$ portfolio» — «бывает, портфель — 1 доллар»
  ([отзыв](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=715721f8-ae9d-4a9f-b734-e76d7bc7737e)).

**Что хвалят:** простой чистый вид, всё в одном месте, быстрые исправления ошибок, ответы поддержки (Trustpilot).

## 5. getquin (Германия)

**Что бесит людей (Google Play DE, 1★):**
- «Zeigt beim Start der App immer -100% Verlust» — «при запуске всегда показывает −100% убытка»
  ([отзыв](https://play.google.com/store/apps/details?id=com.getquin.app&reviewId=89f1bce7-cea1-4eb1-aac0-e2e65519d8b6)).
  У нас это исправлено 28.10 — правильное решение, держать тестом.
- «Import ja, aber kein Export» — «импорт есть, выгрузки нет»
  ([отзыв](https://play.google.com/store/apps/details?id=com.getquin.app&reviewId=e794a58b-1948-4557-ac64-995243279271));
  «Wie bekomme ich meine Daten zurück?» — «как мне вернуть мои данные?»
  ([отзыв](https://play.google.com/store/apps/details?id=com.getquin.app&reviewId=794851ee-1635-479e-8e58-5a2c45ce0420)).
  У нас выгрузка есть — это стоит говорить в описании.
- Наличные перестали считаться вложением без выбора человека: «lässt mich doch selbst entscheiden» —
  «дайте решать мне самому» ([отзыв](https://play.google.com/store/apps/details?id=com.getquin.app&reviewId=cb8f8b39-0183-4174-8576-7d88491dacb8)).
  Нам урок: смысл резерва USDT в итоге не менять молча.
- Реклама даже при подписке, «с каждым обновлением хуже», ручную запись стало не найти
  ([отзыв](https://play.google.com/store/apps/details?id=com.getquin.app&reviewId=70acc4eb-6e3e-4751-843f-8e6478d14f85)).

## 6. Relai и Bitpanda — DCA-планы

**Что есть у них:** Relai — 1% сервисный сбор плюс «небольшой спред», бесплатная покупка до 100 CHF/EUR в месяц
по плану ([Relai, Pricing Policy](https://relai.app/pricing-policy/)); сказано ли, входит ли спред в
показанную цену (кроме покупки картой), — в документе нет. Bitpanda — «0.99% premium» для BTC, **встроенная в цену**;
планы от 1 € раз в неделю/две/месяц ([Datawallet, обзор Bitpanda](https://www.datawallet.com/crypto/bitpanda-review)).
Отзывы 1★ Bitpanda (по обзору) — закрытые счета после проверки личности; сам Google Play не смотрел.

**Вывод:** у DCA-сервисов реальная цена покупки выше рыночной на 1–2% и плохо видна. MoneyLife записывает
сумму и количество (а с 06.11 — ручную цену), но **не показывает, сколько человек переплатил к рынку**.

## 7. monobank и Revolut — образец удобства

- **monobank** 2026: инвестирование валютных «банок» в ОВДП, 3,7% в $ и 2,8% в € годовых, тест с 09.02.2026
  ([ITC.ua](https://itc.ua/ua/novini/v-monobank-zapustyly-investytsiyi-dlya-banok-z-yevro-ta-dolaramy-do-3-7-richnyh-zalezhno-vid-valyuty/));
  файлы к платежам, блокировка нежелательных переводов (заголовки в поиске; сами статьи не открывал — не проверено).
  1★ (UA): после обновления вход по отпечатку сменился кодом, и его не поменять
  ([отзыв](https://play.google.com/store/apps/details?id=com.ftband.mono&reviewId=85108b54-26f4-4691-b9cd-9f52beee404a)) —
  урок: не менять привычный вход без объяснения.
- **Revolut**: 09.04.2026 — ИИ-помощник AIR: разбор трат, подписок, вложений; видит только то, что человек и так
  видит в приложении ([Revolut](https://www.revolut.com/news/revolut_enters_new_era_of_money_intelligence_with_launch_of_ai_assistant/));
  определение звонков от «банка» против мошенников
  ([Revolut](https://www.revolut.com/news/revolut_amps_up_fight_against_impersonation_scams_with_new_call_identification_feature/)).
  2★ (GB): спрятали расчёт комиссии при пополнении картой и молча списывают —
  «hide the card fee calculation» — «спрятали расчёт комиссии за карту»
  ([отзыв](https://play.google.com/store/apps/details?id=com.revolut.revolut&reviewId=1ab476da-a6e0-44f2-8dd6-b4edf82efcaa));
  «changing their terms weekly» — «меняют условия каждую неделю»
  ([отзыв](https://play.google.com/store/apps/details?id=com.revolut.revolut&reviewId=027d8f81-d4b1-46e5-aeb9-951bf3b4e755)).

---

## Что бесит людей — сводка

1. **Непонятные или скрытые комиссии** (Revolut, Strike, Bitpanda/Relai — встроенная наценка).
2. **Неверные цифры без объяснения** (Delta, CoinStats P&L, getquin −100%).
3. **Потеря истории и нет выгрузки** (CoinStats, getquin).
4. **Путаница «трекер = кошелёк»** и мошенники вокруг этого (CoinStats).
5. **Платная стена на то, что было бесплатно; молча меняют правила** (Delta, getquin, Revolut).
6. **ИИ навязывают** там, где его не просили (CoinStats).

## Идеи для MoneyLife

### 1. «Наценка к рынку» в покупках — сколько ушло на комиссии и спред
- **Что увидит человек:** в карточке монеты строка «Средняя наценка к рынку ≈ 1,1% · ≈ $14 за всё время»;
  в записи покупки — «цена записи выше дневной цены CoinGecko на 0,9%». Подпись: «оценка по дневной цене,
  не точная комиссия биржи». Помогает сравнить, где покупать дешевле, — без советов, что покупать.
- **Доказательства:** спрятанная комиссия Revolut ([2★](https://play.google.com/store/apps/details?id=com.revolut.revolut&reviewId=1ab476da-a6e0-44f2-8dd6-b4edf82efcaa));
  встроенная «0.99% premium» Bitpanda ([Datawallet](https://www.datawallet.com/crypto/bitpanda-review));
  1% + спред у Relai ([Relai](https://relai.app/pricing-policy/)); путаница с платой у Strike
  ([1★](https://play.google.com/store/apps/details?id=zapsolutions.strike&reviewId=f3d4fd89-0ac9-4d79-9155-823233d8a078)).
  У трекеров из разбора такого показателя не нашёл (не значит, что его нет нигде — не проверено).
- **Оценка:** **крупное, можно без владельца** — новый показатель, только показывает; себестоимость, прибыль,
  лестница и формат записей не меняются. Нужна дневная цена на дату покупки (история цен CoinGecko уже
  запрашивается для графика — проверить, хватает ли её, и не задеть паузу 90 с из BACKLOG P3).
- **Объём:** 6–8 ч (расчёт по записям с суммой и количеством, кэш дневных цен, строка в карточке, RU/UA, тесты).
- **Риск:** дневная цена ≠ цена минуты покупки — показывать только среднее за много покупок и только если
  разница > 0,3%; отрицательную наценку подписывать «ниже дневной цены», без «выгодно».

### 2. Итог в BTC — ещё один чип «≈ 0,0412 BTC» под суммой
- **Что увидит человек:** рядом с «≈ ₴…» чип «≈ 0,0412 BTC» (по нажатию на чип — по кругу ₴ → BTC, выбор
  запоминается на телефоне). При скрытых суммах — «••••».
- **Доказательства:** Kubera показывает весь портфель в биткоинах ([kubera.com](https://www.kubera.com/crypto-tracker));
  Strike строит учёт вокруг BTC и «стопок» ([Crypto Briefing](https://cryptobriefing.com/strike-launches-stacks-bitcoin-savings/)).
  Для стратегии владельца (лестница BTC) это естественная мера «сколько у меня в биткоинах».
- **Оценка:** **крупное, можно без владельца** (новая мелкая функция, только показ, по объёму маленькая).
- **Объём:** 1–2 ч (≈ 15 строк у чипов `index.html` ~2120, текст UA, тест, метка версии).
- **Риск:** без цены BTC чип не показывать; не путать с «количеством BTC» в монете — подпись «весь портфель в BTC».

### 3. «Из чего 24ч» — вклад каждой монеты в изменение за сутки
- **Что увидит человек:** нажал на чип «24ч −$120» — короткая строка/шторка: «BTC −$90 · ETH −$38 · SOL +$8»,
  отсортировано по вкладу; одна фраза-объяснение «изменение = количество × движение цены за 24 ч».
  Без ИИ и без «почему рынок упал» — только арифметика своего портфеля.
- **Доказательства:** Delta 04.11.2026 сделала «What's Going On» по портфелю ключевой функцией обновления
  ([Google Play](https://play.google.com/store/apps/details?id=io.getdelta.android&hl=en&gl=US)); жалобы «откуда эти
  цифры» ([Delta 1★](https://play.google.com/store/apps/details?id=io.getdelta.android&reviewId=95b51cc2-ef48-4806-a728-90740880a883));
  при этом ИИ людей раздражает ([CoinStats 1★](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=627ddfd2-e21e-41c3-bc72-8cd8ca1e68a0)).
  Продолжает нашу «Из чего итог» (features 07.11, сделано в 3.0) — но для сегодняшнего изменения.
- **Оценка:** **крупное, можно без владельца** — показ уже посчитанного `d24` по монетам (`index.html` ~2116),
  расчёт не меняется.
- **Объём:** 2–3 ч (раскладка тех же слагаемых, шторка/строка, RU/UA, тест сумма слагаемых = чип).
- **Риск:** сумма строк обязана совпасть с чипом до цента — тест; монеты без цены — отдельной строкой «без цены».

### 4. Строка безопасности: «MoneyLife не хранит деньги»
- **Что увидит человек:** в Настройках («О приложении») и в шаге 0 знакомства одна спокойная строка:
  «MoneyLife — дневник и калькулятор. Деньги не хранит, переводов, ключей бирж и сид-фраз не просит. Кто просит
  от имени MoneyLife — мошенник».
- **Доказательства:** CoinStats — люди ищут, как «вывести деньги» из трекера, и пишут о краже
  ([1★](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=0ce990cf-e99b-44ae-b226-624ceae7ebb3),
  [1★](https://play.google.com/store/apps/details?id=com.coinstats.crypto.portfolio&reviewId=014f5fae-c287-4b51-b3e1-48dc8892747e));
  компания отвечает про мошенников ([Trustpilot](https://ie.trustpilot.com/review/coinstats.app)); Revolut в 2026
  вкладывается в защиту от «звонков от банка»
  ([Revolut](https://www.revolut.com/news/revolut_amps_up_fight_against_impersonation_scams_with_new_call_identification_feature/)).
  У нас такой строки нет (поиск «сид», «мошен», «не храним» по `index.html`, `plus.js`, `i18n.js` — пусто).
- **Оценка:** **мелкое** (только текст, RU/UA, без `privacy.html`). Если Глеб сочтёт вставку в знакомство
  новым поведением — только Настройки.
- **Объём:** 30–45 мин + метка версии и тест текста.
- **Риск:** текст должен совпадать с правдой: ключи бирж мы действительно не просим (сверено с 10.11).

## Отсеяно

- Импорт CSV с бирж (Delta 1★) — массовая запись в базу и сопоставление форматов; формат данных → ждёт владельца, сейчас не время.
- ИИ-чат / ИИ-объяснения рынка (Delta, Revolut AIR, CoinStats) — нужны сервер и деньги; объяснение рынка граничит с прогнозом; людей раздражает навязанный ИИ.
- Цели-«стопки» BTC (Strike Stacks) — уже в BACKLOG (P4 «Цель накопления в BTC», 28.10); Stacks лишь подтверждает приём.
- Fast Forward с инфляцией (Kubera) — частично есть «Число свободы»; поправка на инфляцию меняет существующий расчёт → ждёт владельца.
- Доступ доверенному человеку (Kubera Life Check) — нужна база и сервер; ждёт владельца, интересно позже.
- Файлы и чеки к записям (monobank) — новое поле и хранилище файлов → формат данных и база.
- Проценты на «банки» (monobank, ОВДП) — это продукт банка, не учёт; нам неприменимо.
- Напоминание о конце пробного периода (CoinStats, Revolut) — подписки у нас нет; записать как правило на будущее: напоминать за 3 дня и отменять в одно касание.
- Сравнение «мой портфель / только BTC» — уже предложено 08.11 (`ideas-2026-11-08.md` №12).

## Не удалось проверить

- WebFetch журнала изменений CoinTracker (`feedback.cointracker.com/changelog`) — запрос разрешения не получил ответа; CoinTracker в разбор не вошёл.
- Даты отзывов Google Play провайдер не вернул — указаны версии приложения из отзывов.
- Свежие 1★ Kubera и Relai, статьи monobank о файлах к платежам и блокировке переводов — не открывал.
- Есть ли «наценка к рынку» у других трекеров (Koinly, CoinTracking и т. п.) — не искал.
