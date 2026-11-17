/* MoneyLife — обучающий ролик для новичка «MoneyLife за минуту» (17.11.2026, задача владельца).
   Что это: 7 анимированных слайдов (~66 с) с голосом Ориона, субтитрами и тихой музыкой. Показ — один раз, при первом
   входе нового пользователя, поверх знакомства (#ob); последняя кнопка «Настроить мой план» открывает знакомство.
   Пересмотреть — «Настройки» → «Отображение» → «Как пользоваться MoneyLife». Отдельный модуль: грузится только когда нужен.
   Голос (по порядку): 1) записанные файлы AUDIO[язык] (озвучка из ElevenLabs по tools/intro-voice.md);
     2) живой голос Ориона (window.mlVoice, та же серверная функция, что у помощника); 3) голос телефона (speechSynthesis);
     4) нет голоса — только субтитры. Музыка — синтез Web Audio прямо в телефоне (0 КБ, без чужих записей), под голосом тише.
   Анимация — Web Animations API + CSS (transform/opacity), без библиотек; «Уменьшить движение» — только плавное появление.
   Сворачивание приложения ставит паузу. Тексты — TEXT ниже (русский и украинский). События — window.mlTrack (если есть),
   событие 'ml-intro' на document и журнал ml-intro-log на телефоне (последние 40). Расчёты, данные и база не трогаются;
   на телефоне хранится только отметка ml-intro (ролик показан). */
(function () {
  'use strict';
  if (window.MLIntro) return;

  /* ---------- настройки и тексты ---------- */
  /* Записанная озвучка: положить файлы intro/ru/01.mp3 … 07.mp3 (и intro/uk/…) и вписать сюда путь, например 'intro/ru/'.
     null — файлов нет, говорит живой голос Ориона или голос телефона. */
  const AUDIO = { ru: null, uk: null, ext: '.mp3' };
  const LIVE = true;               /* живой голос Ориона, пока нет файлов (тратит символы ElevenLabs: ~700 за просмотр) */
  const MUSIC = { vol: 0.045, duck: 0.35 };
  const DUR = [8, 10, 11, 11, 10, 9, 7];   /* длительность слайдов, с; растягивается под реальную длину голоса */

  const TEXT = {
    ru: {
      dialog: 'Как пользоваться MoneyLife',
      coverT: 'MoneyLife за минуту', coverS: 'Орион покажет главное: план, лестницу докупок и как записать первую покупку.',
      watch: 'Смотреть · 1 мин', prep: 'Готовлю голос…', skip: 'Пропустить', back: 'Назад', next: 'Далее',
      soundOn: 'Выключить звук', soundOff: 'Включить звук', ccOn: 'Скрыть субтитры', ccOff: 'Показать субтитры', pause: 'Пауза', play: 'Продолжить', resume: 'Продолжить',
      cta: 'Настроить мой план', ctaReplay: 'Готово', slide: (i, n) => `Слайд ${i} из ${n}`,
      mk: {
        total: 'Итог', day: 'за сутки', tip: '12 нояб.', btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana',
        tSimple: 'Простой', tAuthor: 'Как у автора', tOwn: 'Свой', sSimple: 'BTC 70 · ETH 30', sAuthor: '50 · 30 · 20 + лестница', sOwn: 'свои доли и правила',
        budget: 'в месяц', bday: '5-го числа', ladder: 'Лестница докупок · шаблон «Как у автора»', signal: 'Сигнал: ступень −30%', reserve: 'из резерва',
        buy: 'Купить', one: 'Одна монета', coin: 'Монета', amount: 'Сумма', save: 'Сохранить', saved: 'Записано',
        say: 'Биткоин за сутки: плюс 2%', learn: 'Знания', learnS: '18 коротких уроков', d14: '14 дней с MoneyLife', d14S: 'День 1 · первая запись'
      },
      slides: [
        { t: 'Крипта по плану, без нервов', vo: 'Привет, я Орион. За минуту покажу, как MoneyLife помогает копить в крипте спокойно и по плану.',
          say: 'Привет, я Орион. За минуту покажу, как Мани Лайф помогает копить в крипте спокойно и по плану.' },
        { t: 'Весь портфель — одна сумма', vo: 'Здесь вся ваша крипта: одна сумма, график и каждая монета. Проведите пальцем по графику — увидите, сколько было в любой день.' },
        { t: 'План и бюджет в месяц', vo: 'Возьмите готовый шаблон или соберите свой и укажите, сколько откладываете в месяц. План сам разложит сумму по монетам.' },
        { t: 'Просадка? Лестница уже готова', vo: 'Когда рынок падает, работает лестница докупок: на каждой ступени — своя сумма из резерва. Я сообщу, когда цена дойдёт до ступени.' },
        { t: 'Покупка — за 10 секунд', vo: 'Купили монету — нажмите «Купить», найдите её среди 18 тысяч и сохраните. Портфель пересчитается сам.',
          say: 'Купили монету — нажмите «Купить», найдите её среди восемнадцати тысяч и сохраните. Портфель пересчитается сам.' },
        { t: 'Орион скажет главное', vo: 'Нажмите на меня — расскажу главное за день. А в «Знаниях» есть короткие уроки, если захотите разобраться глубже.' },
        { t: 'Соберём план?', vo: 'Начнём? Настройка займёт пару минут, а цифры можно вписать примерно и потом поправить.',
          voReplay: 'Вот и всё. Пересмотреть ролик можно в «Настройках», в разделе «Отображение».' }
      ]
    },
    uk: {
      dialog: 'Як користуватися MoneyLife',
      coverT: 'MoneyLife за хвилину', coverS: 'Оріон покаже головне: план, сходи докупівель і як записати першу покупку.',
      watch: 'Дивитися · 1 хв', prep: 'Готую голос…', skip: 'Пропустити', back: 'Назад', next: 'Далі',
      soundOn: 'Вимкнути звук', soundOff: 'Увімкнути звук', ccOn: 'Сховати субтитри', ccOff: 'Показати субтитри', pause: 'Пауза', play: 'Продовжити', resume: 'Продовжити',
      cta: 'Налаштувати мій план', ctaReplay: 'Готово', slide: (i, n) => `Слайд ${i} з ${n}`,
      mk: {
        total: 'Підсумок', day: 'за добу', tip: '12 лист.', btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana',
        tSimple: 'Простий', tAuthor: 'Як в автора', tOwn: 'Свій', sSimple: 'BTC 70 · ETH 30', sAuthor: '50 · 30 · 20 + сходи', sOwn: 'свої частки й правила',
        budget: 'на місяць', bday: '5-го числа', ladder: 'Сходи докупівель · шаблон «Як в автора»', signal: 'Сигнал: сходинка −30%', reserve: 'з резерву',
        buy: 'Купити', one: 'Одна монета', coin: 'Монета', amount: 'Сума', save: 'Зберегти', saved: 'Записано',
        say: 'Біткоїн за добу: плюс 2%', learn: 'Знання', learnS: '18 коротких уроків', d14: '14 днів з MoneyLife', d14S: 'День 1 · перший запис'
      },
      slides: [
        { t: 'Крипта за планом, без нервів', vo: 'Привіт, я Оріон. За хвилину покажу, як MoneyLife допомагає збирати крипту спокійно і за планом.',
          say: 'Привіт, я Оріон. За хвилину покажу, як Мані Лайф допомагає збирати крипту спокійно і за планом.' },
        { t: 'Весь портфель — одна сума', vo: 'Тут уся ваша крипта: одна сума, графік і кожна монета. Проведіть пальцем по графіку — побачите, скільки було будь-якого дня.' },
        { t: 'План і бюджет на місяць', vo: 'Візьміть готовий шаблон або складіть свій і вкажіть, скільки відкладаєте на місяць. План сам розподілить суму між монетами.' },
        { t: 'Просідання? Сходи вже готові', vo: 'Коли ринок падає, працюють сходи докупівель: на кожній сходинці — своя сума з резерву. Я повідомлю, коли ціна дійде до сходинки.' },
        { t: 'Покупка — за 10 секунд', vo: 'Купили монету — натисніть «Купити», знайдіть її серед 18 тисяч і збережіть. Портфель перерахується сам.',
          say: 'Купили монету — натисніть «Купити», знайдіть її серед вісімнадцяти тисяч і збережіть. Портфель перерахується сам.' },
        { t: 'Оріон скаже головне', vo: 'Натисніть на мене — розповім головне за день. А в «Знаннях» є короткі уроки, якщо захочете розібратися глибше.' },
        { t: 'Складемо план?', vo: 'Почнемо? Налаштування займе кілька хвилин, а цифри можна вписати приблизно й потім виправити.',
          voReplay: 'Ось і все. Переглянути ролик можна в «Налаштуваннях», у розділі «Відображення».' }
      ]
    }
  };

  /* ---------- служебное ---------- */
  const N = DUR.length;
  const RM = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const lang = () => { try { return window.mlLang && window.mlLang() === 'uk' ? 'uk' : 'ru'; } catch (e) { return 'ru'; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ease = p => 1 - Math.pow(1 - p, 3);
  const sentences = t => (String(t).match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) || [t]).map(s => s.trim()).filter(Boolean);
  /* субтитры: короткое предложение («Привет, я Орион.») показываем вместе со следующим */
  const capParts = t => sentences(t).reduce((o, x) => { if (o.length && o[o.length - 1].length < 26) o[o.length - 1] += ' ' + x; else o.push(x); return o; }, []);
  const money = v => '$' + Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ');

  function track(name, data) {
    const e = Object.assign({ e: name, t: new Date().toISOString(), lang: lang(), mode: S.mode }, data || {});
    try { const a = lsGet('ml-intro-log', []); a.push(e); lsSet('ml-intro-log', a.slice(-40)); } catch (x) {}
    try { document.dispatchEvent(new CustomEvent('ml-intro', { detail: e })); } catch (x) {}
    try { if (typeof window.mlTrack === 'function') window.mlTrack('intro_' + name, e); } catch (x) {}
  }

  /* ---------- стили (токены «Графита» из index.html: --bg, --surface, --fg, --accent, --btn-bg …) ---------- */
  const CSS = `
@property --mi-oc{syntax:'<color>';inherits:true;initial-value:#8b7dff}
#mlIntro{position:fixed;inset:0;z-index:160;display:flex;flex-direction:column;background:var(--bg,#09090b);color:var(--fg,#f5f5f7);font-family:var(--ui,system-ui,sans-serif);
  padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) calc(14px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));
  opacity:0;transition:opacity .35s ease;-webkit-tap-highlight-color:transparent;overscroll-behavior:contain;touch-action:pan-y}
#mlIntro.on{opacity:1}
#mlIntro *{box-sizing:border-box}
#mlIntro button{font:inherit;color:inherit}
#mlIntro :focus-visible{outline:2px solid var(--fg,#fff);outline-offset:2px;border-radius:10px}
.mi-in{width:100%;max-width:440px;margin:0 auto;flex:1;display:flex;flex-direction:column;min-height:0}
.mi-prog{display:flex;gap:4px;height:3px;margin:4px 0 6px}
.mi-prog i{flex:1;border-radius:3px;background:var(--line2,#2f2f37);overflow:hidden;position:relative}
.mi-prog i b{position:absolute;inset:0;background:var(--fg,#f5f5f7);transform-origin:0 50%;transform:scaleX(0)}
.mi-prog i.done b{transform:scaleX(1)}
.mi-bar{display:flex;align-items:center;gap:4px;min-height:48px}
.mi-ic{width:48px;height:48px;display:grid;place-items:center;border:0;background:none;border-radius:50%;cursor:pointer;color:var(--mute,#a3a3ae)}
.mi-ic svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mi-skip{margin-left:auto;min-height:48px;padding:0 14px;border:0;background:none;color:var(--mute,#a3a3ae);font-size:15px;font-weight:600;cursor:pointer;border-radius:24px}
.mi-body{position:relative;flex:1;min-height:0;overflow:hidden}
.mi-sl{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px}
.mi-st{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.mi-tx{flex:none;display:flex;flex-direction:column;gap:6px;padding:0 2px}
#mlIntro .mi-tx h2:focus,#mlIntro .mi-tx h2:focus-visible{outline:none}
.mi-tx h2{margin:0;font-size:25px;line-height:1.18;font-weight:700;letter-spacing:-.015em;text-wrap:balance;outline:none}
.mi-tx p.mi-sub{margin:0;color:var(--mute,#a3a3ae);font-size:15.5px;line-height:1.45}
.mi-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mi-cap{flex:none;min-height:66px;margin:12px 0 10px;padding:11px 14px;border-radius:var(--r-m,14px);background:var(--surface2,#19191d);border:1px solid transparent;
  font-size:15px;line-height:1.42;color:var(--fg,#f5f5f7);display:flex;align-items:center;transition:opacity .25s}
.mi-cap:empty{opacity:0}
.mi-nav{flex:none;display:flex;gap:10px}
.mi-btn{flex:1;min-height:52px;border-radius:var(--r-pill,999px);border:1px solid var(--line2,#2f2f37);background:none;font-weight:600;font-size:16px;cursor:pointer;padding:0 18px}
.mi-btn.pri{background:var(--btn-bg,#f5f5f7);color:var(--btn-fg,#09090b)!important;border-color:transparent}
.mi-btn[disabled]{opacity:.55}
.mi-btn.back{flex:0 0 auto;min-width:110px}
.mi-btn.ghost{visibility:hidden}
.mi-resume{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;min-height:52px;padding:0 24px;border-radius:999px;border:0;background:var(--btn-bg,#f5f5f7);color:var(--btn-fg,#09090b)!important;font-weight:600;font-size:16px;display:none;cursor:pointer}
#mlIntro.paused .mi-resume{display:block}
#mlIntro.cover .mi-cap,#mlIntro.cover .mi-prog,#mlIntro.nocc .mi-cap{visibility:hidden}
.mi-cc{font-size:12px;font-weight:700;letter-spacing:.04em;border:1.6px solid currentColor;border-radius:5px;padding:1px 4px;line-height:1.2}
.mi-ic[aria-pressed="false"] .mi-cc{opacity:.5;text-decoration:line-through}
#mlIntro.paused .mi-st{opacity:.45}
#mlIntro.paused *,#mlIntro.paused *::before,#mlIntro.paused *::after{animation-play-state:paused!important}
/* сфера Ориона */
.mi-or{position:relative;width:var(--s,120px);height:var(--s,120px);flex:none}
.mi-or i{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 38% 34%,#fff 0,var(--mi-oc) 46%,#07070a 100%);transition:--mi-oc 1.2s ease;animation:miBreath 4.5s ease-in-out infinite}
.mi-or svg{position:absolute;inset:-14%;width:128%;height:128%;opacity:0;transition:opacity .4s}
.mi-or svg circle{fill:none;stroke:var(--mi-oc);stroke-width:1.2;stroke-linecap:round;transition:stroke 1.2s}
.mi-or.talk svg{opacity:.8;animation:miSpin 6s linear infinite}
.mi-or.talk i{animation:miBreath 1.1s ease-in-out infinite}
@keyframes miBreath{50%{transform:scale(1.045)}}
@keyframes miSpin{to{transform:rotate(360deg)}}
.mi-brand{font-size:15px;font-weight:600;letter-spacing:.04em;color:var(--mute,#a3a3ae)}
/* макеты экранов */
.mi-mk{width:100%;max-width:340px;border-radius:var(--r-l,20px);background:var(--surface,#141417);border:1px solid transparent;padding:16px;display:flex;flex-direction:column;gap:10px;position:relative}
.mi-lbl{font-size:12.5px;color:var(--mute,#a3a3ae);font-weight:500}
.mi-sum{font-size:34px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.mi-pos{color:var(--pos,#30d158);font-size:13.5px;font-weight:600}
.mi-row{display:flex;align-items:center;gap:10px;min-height:44px;padding:4px 0;border-top:1px solid var(--line,#222228)}
.mi-row img{width:30px;height:30px;border-radius:50%;flex:none}
.mi-row b{font-weight:600;font-size:14.5px;flex:1}
.mi-row span{font-variant-numeric:tabular-nums;font-size:14px;color:var(--mute,#a3a3ae)}
.mi-chart{width:100%;height:92px;display:block;overflow:visible}
.mi-chart path.l{fill:none;stroke:var(--fg,#f5f5f7);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.mi-chart path.a{fill:var(--fg,#f5f5f7);opacity:.06}
.mi-tpl{display:grid;grid-template-columns:1fr;gap:8px;width:100%;max-width:340px}
.mi-card{border-radius:var(--r-m,14px);background:var(--surface2,#19191d);border:1px solid var(--line2,#2f2f37);padding:11px 14px;display:flex;flex-direction:column;gap:2px;transition:border-color .3s,background-color .3s}
.mi-card b{font-size:15px;font-weight:600}
.mi-card span{font-size:13px;color:var(--mute,#a3a3ae)}
.mi-card.on{border-color:var(--fg,#f5f5f7);background:var(--raise,#222227)}
.mi-plan{display:flex;align-items:center;gap:14px;width:100%;max-width:340px;margin-top:4px}
.mi-ring{width:76px;height:76px;flex:none;transform:rotate(-90deg)}
.mi-ring circle{fill:none;stroke-width:9}
.mi-pill{flex:1;border-radius:var(--r-m,14px);background:var(--field,#1b1b20);border:1px solid transparent;padding:10px 12px;font-size:14px;font-variant-numeric:tabular-nums;min-height:48px;display:flex;flex-direction:column;justify-content:center}
.mi-pill b{font-size:17px}
.mi-lad{position:relative;width:100%;max-width:340px;height:230px;flex:none}
.mi-lad svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.mi-lv{position:absolute;left:0;right:0;height:0;border-top:1px dashed var(--line2,#2f2f37)}
.mi-lv span{position:absolute;right:0;top:-10px;font-size:12px;font-weight:600;color:var(--mute,#a3a3ae);background:var(--bg,#09090b);padding:1px 6px;border-radius:6px;font-variant-numeric:tabular-nums}
.mi-lv.hot{border-top-color:var(--warn,#f5b545)}
.mi-lv.hot span{color:var(--warn,#f5b545);background:var(--warn-soft,#f5b5451c)}
.mi-ntf{position:absolute;left:0;right:0;top:-6px;z-index:3;display:flex;align-items:center;gap:10px;border-radius:var(--r-m,14px);background:var(--raise,#222227);padding:10px 12px;font-size:14px;font-weight:600;opacity:0}
.mi-ntf .mi-or{--s:22px}
.mi-sheet{position:relative;width:100%;max-width:340px;border-radius:var(--r-l,20px) var(--r-l,20px) var(--r-m,14px) var(--r-m,14px);background:var(--surface2,#19191d);border:1px solid transparent;padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;opacity:0}
.mi-sheet h3{margin:0;font-size:16px;font-weight:700}
.mi-fld{border-radius:12px;background:var(--field,#1b1b20);border:1px solid transparent;min-height:46px;padding:6px 12px;display:flex;flex-direction:column;justify-content:center;font-size:15px;font-variant-numeric:tabular-nums}
.mi-fld small{font-size:11.5px;color:var(--dim,#6e6e7a)}
.mi-fld em{font-style:normal}
.mi-fld em::after{content:'';display:inline-block;width:1.5px;height:1em;background:var(--fg,#fff);margin-left:1px;vertical-align:-2px;animation:miCar .9s steps(1) infinite}
@keyframes miCar{50%{opacity:0}}
.mi-sug{display:flex;align-items:center;gap:10px;border-radius:12px;background:var(--raise,#222227);padding:7px 10px;font-size:14px;opacity:0}
.mi-sug img{width:26px;height:26px;border-radius:50%}
.mi-sug span{color:var(--mute,#a3a3ae);margin-left:auto;font-size:12.5px}
.mi-pbtn{min-height:46px;border-radius:999px;background:var(--btn-bg,#f5f5f7);color:var(--btn-fg,#09090b);display:grid;place-items:center;font-weight:600;font-size:15px}
.mi-ok{position:absolute;inset:0;display:grid;place-items:center;border-radius:inherit;background:var(--surface2,#19191d);font-weight:600;font-size:16px;gap:8px;opacity:0}
.mi-ok svg{width:44px;height:44px;stroke:var(--pos,#30d158);fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mi-buyrow{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:340px;gap:10px}
.mi-buyrow .mi-pbtn{min-width:120px;padding:0 18px}
.mi-cards2{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;max-width:340px}
.mi-col{display:flex;flex-direction:column;align-items:center;gap:16px;width:100%}
.mi-say{border-radius:var(--r-m,14px);background:var(--surface2,#19191d);border:1px solid transparent;padding:9px 14px;font-size:14.5px;opacity:0}
/* «палец» */
.mi-fg{position:absolute;left:0;top:0;z-index:4;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;background:rgba(160,160,170,.35);border:2px solid rgba(220,220,228,.8);background:color-mix(in srgb,var(--fg,#fff) 22%,transparent);border:2px solid color-mix(in srgb,var(--fg,#fff) 70%,transparent);pointer-events:none;opacity:0}
.mi-hl{outline:2px solid var(--accent,#8b7dff);outline-offset:2px}
.mi-rp{position:absolute;z-index:3;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;border:2px solid var(--fg,#fff);pointer-events:none;opacity:0}
@media (max-height:700px){.mi-tx h2{font-size:21px}.mi-sum{font-size:28px}.mi-lad{height:190px}.mi-cap{min-height:56px;margin:8px 0}}
@media (prefers-reduced-motion:reduce){.mi-or i,.mi-or.talk i,.mi-or.talk svg,.mi-fld em::after{animation:none!important}}
`;

  /* ---------- состояние ---------- */
  const S = {
    open: false, mode: 'first', i: -1, t: 0, len: 0, k: 1, playing: false, paused: false, muted: false,
    q: [], tw: [], anims: [], raf: 0, last: 0, voice: null, kind: 'phone', bufs: new Map(), onClose: null, root: null, el: {},
    capIdx: -1, caps: [], capT: [], dir: 1, started: false, prevFocus: null, cc: true, done7: false, inert: []
  };
  const T = () => TEXT[lang()];

  /* ---------- звук: голос, музыка, приглушение под голос ---------- */
  const AU = { ctx: null, master: null, music: null, voice: null, padT: 0, padI: 0 };
  function audioCtx() {
    if (AU.ctx) return AU.ctx;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    try { AU.ctx = new C(); } catch (e) { return null; }
    const c = AU.ctx;
    AU.master = c.createGain(); AU.master.gain.value = 0; AU.master.connect(c.destination);
    AU.music = c.createGain(); AU.music.gain.value = MUSIC.vol; AU.music.connect(AU.master);
    AU.voice = c.createGain(); AU.voice.gain.value = 1; AU.voice.connect(AU.master);
    return c;
  }
  function masterTo(v, sec) {
    const c = AU.ctx; if (!c) return; const g = AU.master.gain, t = c.currentTime;
    try { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + (sec || 0.3)); } catch (e) { g.value = v; }
  }
  function duck(on) {
    const c = AU.ctx; if (!c) return; const g = AU.music.gain, t = c.currentTime;
    try { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(on ? MUSIC.vol * MUSIC.duck : MUSIC.vol, t + (on ? 0.25 : 0.7)); } catch (e) {}
  }
  /* фон — мягкие аккорды (ля минор → фа → соль → ми минор), по 4 с, через фильтр: тихо и без мелодии */
  const CH = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]];
  function padPump() {
    const c = AU.ctx; if (!c || c.state !== 'running') return;
    while (AU.padT < c.currentTime + 6) {
      const t0 = Math.max(AU.padT, c.currentTime + 0.05), ch = CH[AU.padI++ % CH.length], len = 4.6;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4; f.connect(AU.music);
      const env = c.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.32, t0 + 1.3); env.gain.setValueAtTime(0.32, t0 + len - 1.8); env.gain.linearRampToValueAtTime(0, t0 + len); env.connect(f);
      ch.concat([ch[0] / 2]).forEach((fr, j) => {
        [0, 4].forEach(det => { const o = c.createOscillator(); o.type = j === 3 ? 'sine' : (det ? 'triangle' : 'sine'); o.frequency.value = fr; o.detune.value = det ? 6 : -4;
          const g = c.createGain(); g.gain.value = (j === 3 ? 0.5 : 0.22) * (det ? 0.45 : 1); o.connect(g); g.connect(env); o.start(t0); o.stop(t0 + len + 0.05); });
      });
      AU.padT = t0 + 4;
    }
  }
  /* голос: файл или живой голос Ориона → AudioBuffer (с кэшем); null — нет */
  function sayText(i) { const s = T().slides[i]; return (S.mode === 'replay' && i === N - 1 && s.voReplay) ? s.voReplay : (s.say || s.vo); }
  function capText(i) { const s = T().slides[i]; return (S.mode === 'replay' && i === N - 1 && s.voReplay) ? s.voReplay : s.vo; }
  function bufFor(i) {
    const key = lang() + ':' + S.mode + ':' + i;
    if (S.bufs.has(key)) return S.bufs.get(key);
    const c = audioCtx();
    let p = Promise.resolve(null);
    const dir = AUDIO[lang()];
    if (c && dir) {
      const nn = String(i + 1).padStart(2, '0') + (S.mode === 'replay' && i === N - 1 ? 'r' : '');
      p = fetch(dir + nn + AUDIO.ext).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    } else if (c && LIVE && !S.voiceOff && typeof window.mlVoice === 'function' && !window.mlDemo && !navigator.webdriver && navigator.onLine !== false) {
      p = Promise.resolve().then(() => window.mlVoice(sayText(i), {})).then(r => r && r.audio ? r.audio : null).catch(() => null);
    }
    p = p.then(ab => ab ? new Promise(res => { try { c.decodeAudioData(ab.slice(0), b => res(b), () => res(null)); } catch (e) { res(null); } }) : null);
    p.then(b => { p.done = true; p.buf = b; });
    S.bufs.set(key, p); return p;
  }
  /* голос телефона */
  let PV;   /* undefined — ещё не выбирали (список голосов в Chrome приходит не сразу) */
  function phoneVoice() {
    if (PV !== undefined) return PV;
    try {
      const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
      if (!vs.length) return null;
      const want = lang() === 'uk' ? /^uk/i : /^ru/i;
      PV = vs.find(v => want.test(v.lang) && v.localService) || vs.find(v => want.test(v.lang)) || (lang() === 'uk' ? vs.find(v => /^ru/i.test(v.lang)) : null) || null;
    } catch (e) { return null; }
    return PV;
  }
  function stopVoice() {
    const v = S.voice; S.voice = null;
    if (v && v.src) { try { v.src.onended = null; v.src.stop(); } catch (e) {} }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    duck(false); orTalk(false);
  }
  /* запуск голоса слайда; from — с какого предложения (для голоса телефона после паузы) */
  function startVoice(i, from) {
    stopVoice();
    const v = { i, done: false, kind: 'none' }; S.voice = v;
    const p = S.kind !== 'phone' ? S.bufs.get(lang() + ':' + S.mode + ':' + i) : null;
    /* запись играет и без звука (громкость 0) — после «включить звук» голос идёт в такт с картинкой */
    if (p && p.done && p.buf && AU.ctx) {
      const src = AU.ctx.createBufferSource(); src.buffer = p.buf; src.connect(AU.voice);
      v.kind = 'buf'; v.src = src; v.dur = p.buf.duration; v.t0 = S.t;
      src.onended = () => { if (S.voice === v) { v.done = true; duck(false); orTalk(false); } };
      v.t0 = S.t;
      duck(true); orTalk(true); try { src.start(); } catch (e) { v.done = true; }
      return;
    }
    if (S.muted) { v.done = true; return; }
    const pv = phoneVoice();
    if (!pv || !window.speechSynthesis) { v.done = true; return; }
    const parts = sentences(sayText(i)).slice(from || 0);
    if (!parts.length) { v.done = true; return; }
    v.kind = 'phone';
    try {
      const u = new SpeechSynthesisUtterance(parts.join(' '));
      u.voice = pv; u.lang = pv.lang; u.rate = 1; u.pitch = 0.95;
      u.onstart = () => { if (S.voice === v && !v.paused) { duck(true); orTalk(true); } };
      u.onend = u.onerror = () => { if (S.voice === v && !v.paused) { v.done = true; duck(false); orTalk(false); } };
      speechSynthesis.speak(u);
      setTimeout(() => { if (S.voice === v && !v.paused && !speechSynthesis.speaking && !speechSynthesis.pending) v.done = true; }, 1500);
    } catch (e) { v.done = true; }
  }
  function orTalk(on) { const o = S.root && S.root.querySelector('.mi-sl.cur .mi-or.big'); if (o) o.classList.toggle('talk', !!on); }

  /* ---------- время слайда: события, твины, анимации ---------- */
  function at(t, fn) { S.q.push({ t: t * S.k, fn }); S.q.sort((a, b) => a.t - b.t); }
  function tween(d, fn) { S.tw.push({ t0: S.t, d: Math.max(0.001, d), fn }); }
  function reduceKF(kf) { const ks = kf.map(f => { const o = {}; if ('opacity' in f) o.opacity = f.opacity; return o; }); return ks.some(f => 'opacity' in f) ? [ks[0], ks[ks.length - 1]] : null; }
  function anim(el, kf, ms, o) {
    if (!el || !el.animate) return null;
    let k = kf; if (RM) { k = reduceKF(kf); if (!k) { const f = kf[kf.length - 1]; for (const p in f) if (p !== 'offset' && p !== 'easing') try { el.style[p] = f[p]; } catch (e) {} return null; } ms = Math.min(ms, 220); }
    let a = null; try { a = el.animate(k, Object.assign({ duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }, o || {})); } catch (e) { return null; }
    S.anims.push(a); if (S.paused) try { a.pause(); } catch (e) {}
    return a;
  }
  const show = (el, t, dy) => { el.style.opacity = '0'; at(t, () => anim(el, [{ opacity: 0, transform: `translateY(${dy == null ? 12 : dy}px)` }, { opacity: 1, transform: 'none' }], 460)); };
  /* палец: подлетает к элементу и нажимает */
  function fingerTo(st, fg, target, t, tap, dx, dy) {
    if (RM) { if (tap) at(t + 0.5, () => { target.classList.add('mi-hl'); }); return; }
    at(t, () => {
      const r = st.getBoundingClientRect(), b = target.getBoundingClientRect();
      const x = b.left - r.left + b.width * (dx == null ? 0.55 : dx), y = b.top - r.top + b.height * (dy == null ? 0.6 : dy);
      const from = fg._p || { x: x + 60, y: y + 90 };
      anim(fg, [{ opacity: fg._p ? 1 : 0, transform: `translate(${from.x}px,${from.y}px)` }, { opacity: 1, transform: `translate(${x}px,${y}px)` }], 650, { easing: 'cubic-bezier(.4,0,.2,1)' });
      fg._p = { x, y };
      if (tap) setTimeoutT(0.7, () => {
        anim(fg, [{ transform: `translate(${x}px,${y}px) scale(1)` }, { transform: `translate(${x}px,${y}px) scale(.82)` }, { transform: `translate(${x}px,${y}px) scale(1)` }], 260);
        const rp = h('i', 'mi-rp'); st.appendChild(rp);
        anim(rp, [{ opacity: .7, transform: `translate(${x}px,${y}px) scale(.6)` }, { opacity: 0, transform: `translate(${x}px,${y}px) scale(1.9)` }], 520, { easing: 'ease-out' });
      });
    });
  }
  function fingerOut(fg, t) { if (RM) return; at(t, () => { if (!fg._p) return; anim(fg, [{ opacity: 1, transform: `translate(${fg._p.x}px,${fg._p.y}px)` }, { opacity: 0, transform: `translate(${fg._p.x + 40}px,${fg._p.y + 70}px)` }], 450); }); }
  function setTimeoutT(d, fn) { S.q.push({ t: S.t + d, fn }); S.q.sort((a, b) => a.t - b.t); }

  /* ---------- слайды ---------- */
  const sphere = (s, cls) => `<div class="mi-or ${cls || ''}" style="--s:${s}px" aria-hidden="true"><i></i><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" stroke-dasharray="40 26 14 26"/></svg></div>`;
  const logo = s => `<img src="logos/${s}.webp" alt="" width="30" height="30" decoding="async">`;
  const PTS = [62, 58, 64, 55, 49, 52, 44, 47, 38, 40, 31, 34, 24, 27, 18];   /* форма графика (0 — верх) */

  const BUILD = [
    /* 1 — привет */
    (st, m) => {
      st.innerHTML = `<div class="mi-col">${sphere(132, 'big')}<div class="mi-brand">MoneyLife</div></div>`;
      const o = st.querySelector('.mi-or'), b = st.querySelector('.mi-brand');
      o.style.opacity = '0'; at(0, () => anim(o, [{ opacity: 0, transform: 'scale(.15)' }, { opacity: 1, transform: 'scale(1)' }], 1100, { easing: 'cubic-bezier(.2,.9,.25,1.05)' }));
      show(b, 0.9, 8);
    },
    /* 2 — главная: сумма, график, монеты */
    (st, m) => {
      const W = 300, H = 92, pts = PTS.map((y, i) => [i * W / (PTS.length - 1), y * H / 70]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      st.innerHTML = `<div class="mi-mk"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px"><div><div class="mi-lbl" id="miLbl">${esc(m.total)}</div><div class="mi-sum" id="miSum">$0</div><div class="mi-pos">+3,2% ${esc(m.day)}</div></div>${sphere(40)}</div>
        <svg class="mi-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${d} L ${W} ${H} L 0 ${H} Z"/><path class="l" d="${d}"/></svg>
        <div class="mi-row">${logo('BTC')}<b>${m.btc}</b><span>$1 240</span></div><div class="mi-row">${logo('ETH')}<b>${m.eth}</b><span>$744</span></div><div class="mi-row">${logo('SOL')}<b>${m.sol}</b><span>$496</span></div></div>
        <i class="mi-fg"></i>`;
      const mk = st.querySelector('.mi-mk'), sum = st.querySelector('#miSum'), path = st.querySelector('path.l'), area = st.querySelector('path.a'), lbl = st.querySelector('#miLbl'), fg = st.querySelector('.mi-fg'), rows = st.querySelectorAll('.mi-row');
      show(mk, 0, 18);
      at(0.3, () => tween(1.4, p => { sum.textContent = money(2480 * p); }));
      let L = 600; try { L = path.getTotalLength(); } catch (e) {}
      path.style.strokeDasharray = L; path.style.strokeDashoffset = RM ? 0 : L; area.style.opacity = '0';
      at(0.6, () => { anim(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], 1300, { easing: 'ease-in-out' }); anim(area, [{ opacity: 0 }, { opacity: .06 }], 900, { delay: 600 }); });
      rows.forEach((r, j) => show(r, 1.3 + j * 0.18, 10));
      /* палец ведёт по графику — сверху дата и сумма */
      if (!RM) {
        const svg = st.querySelector('.mi-chart');
        at(4.2, () => {
          const r0 = st.getBoundingClientRect(), b = svg.getBoundingClientRect(), mr = mk.getBoundingClientRect();
          const xy = q => { const f = q * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)), u = f - j; const y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u; return [b.left - r0.left + b.width * q, b.top - r0.top + y * b.height / H]; };
          const [x0, y0] = xy(0.3); fg._p = { x: x0, y: y0 };
          anim(fg, [{ opacity: 0, transform: `translate(${x0 + 40}px,${y0 + 80}px)` }, { opacity: 1, transform: `translate(${x0}px,${y0}px)` }], 500);
          setTimeoutT(0.55, () => { for (const a of fg.getAnimations ? fg.getAnimations() : []) try { a.cancel(); } catch (e) {} fg.style.opacity = '1'; tween(2.6, p => {
            const q = 0.3 + 0.55 * Math.sin(p * Math.PI / 2), [x, y] = xy(q);
            fg.style.transform = `translate(${x}px,${y}px)`;
            const day = 3 + Math.round(q * 13), v = 1500 + q * 900;
            lbl.textContent = day + ' ' + m.tip.replace(/^\d+\s*/, '');
            sum.textContent = money(v);
          }); });
          setTimeoutT(3.4, () => { tween(0.6, p => { sum.textContent = money(2306 + (2480 - 2306) * p); }); lbl.textContent = m.total; fg._p = { x: xy(0.85)[0], y: xy(0.85)[1] }; });
        });
        fingerOut(fg, 7.8);
      }
    },
    /* 3 — шаблон и бюджет */
    (st, m) => {
      const C = 2 * Math.PI * 30;
      st.innerHTML = `<div class="mi-col" style="gap:12px"><div class="mi-tpl"><div class="mi-card"><b>${esc(m.tSimple)}</b><span>${esc(m.sSimple)}</span></div><div class="mi-card" id="miAuth"><b>${esc(m.tAuthor)}</b><span>${esc(m.sAuthor)}</span></div><div class="mi-card"><b>${esc(m.tOwn)}</b><span>${esc(m.sOwn)}</span></div></div>
        <div class="mi-plan"><svg class="mi-ring" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="30" stroke="var(--line2,#2f2f37)"/><circle class="sg" cx="38" cy="38" r="30" stroke="#f7931a"/><circle class="sg" cx="38" cy="38" r="30" stroke="#9aa8ff"/><circle class="sg" cx="38" cy="38" r="30" stroke="#9b6dff"/></svg>
        <div class="mi-pill"><b id="miBud">$0</b><span class="mi-lbl">${esc(m.budget)} · ${esc(m.bday)}</span></div></div></div><i class="mi-fg"></i>`;
      const cards = st.querySelectorAll('.mi-card'), auth = st.querySelector('#miAuth'), plan = st.querySelector('.mi-plan'), fg = st.querySelector('.mi-fg'), bud = st.querySelector('#miBud');
      cards.forEach((c, j) => show(c, 0.1 + j * 0.16, 16));
      fingerTo(st, fg, auth, 2.0, true);
      at(2.75, () => auth.classList.add('on'));
      show(plan, 3.4, 12);
      const segs = st.querySelectorAll('circle.sg'), parts = [0.5, 0.3, 0.2]; let off = 0;
      segs.forEach((s, j) => { const len = C * parts[j] - 2; s.style.strokeDasharray = `0 ${C}`; s.style.strokeDashoffset = -off; const o = off; off += C * parts[j];
        at(3.8 + j * 0.45, () => tween(RM ? 0.01 : 0.5, p => { s.style.strokeDasharray = `${(len * ease(p)).toFixed(2)} ${C}`; s.style.strokeDashoffset = -o; })); });
      fingerTo(st, fg, st.querySelector('.mi-pill'), 5.6, true);
      at(6.4, () => tween(0.9, p => { bud.textContent = money(100 * ease(p)); }));
      fingerOut(fg, 7.6);
    },
    /* 4 — лестница докупок */
    (st, m) => {
      const lv = [30, 40, 50, 60, 70];
      st.innerHTML = `<div class="mi-lad"><div class="mi-ntf">${sphere(22)}<span>${esc(m.signal)}</span></div>
        <svg viewBox="0 0 300 230" preserveAspectRatio="none" aria-hidden="true"><path class="l" d="M0 58 L30 50 L55 64 L85 56 L115 76 L140 70 L170 88 L195 82 L222 99 L246 101" style="fill:none;stroke:var(--fg,#f5f5f7);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/></svg>
        ${lv.map((d, j) => `<div class="mi-lv" style="top:${100 + j * 24}px"><span>−${d}%</span></div>`).join('')}<div class="mi-lbl" style="position:absolute;left:0;bottom:0">${esc(m.ladder)}</div></div>`;
      const box = st.querySelector('.mi-lad'), path = st.querySelector('path'), lvs = st.querySelectorAll('.mi-lv'), ntf = st.querySelector('.mi-ntf');
      show(box, 0, 10);
      let L = 500; try { L = path.getTotalLength(); } catch (e) {}
      path.style.strokeDasharray = L; path.style.strokeDashoffset = RM ? 0 : L;
      at(0.4, () => anim(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], 3400, { easing: 'ease-in' }));
      lvs.forEach((l, j) => show(l, 1.2 + j * 0.3, 0));
      at(3.9, () => { lvs[0].classList.add('hot'); anim(lvs[0], [{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }, { opacity: .35 }, { opacity: 1 }], 1100, { easing: 'linear' }); });
      at(4.3, () => { const o = ntf.querySelector('.mi-or'); o.style.setProperty('--mi-oc', 'var(--warn,#f5b545)'); anim(ntf, [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], 460); });
    },
    /* 5 — запись покупки */
    (st, m) => {
      st.innerHTML = `<div class="mi-col" style="gap:12px"><div class="mi-buyrow"><div><div class="mi-lbl">${esc(m.total)}</div><div class="mi-sum" id="miSum5" style="font-size:26px">$2 480</div></div><div class="mi-pbtn" id="miBuy">${esc(m.buy)}</div></div>
        <div class="mi-sheet"><h3>${esc(m.one)}</h3><div class="mi-fld"><small>${esc(m.coin)}</small><em id="miSym"></em></div>
        <div class="mi-sug">${logo('BTC')}<b>Bitcoin</b><span>BTC · №1</span></div>
        <div class="mi-fld"><small>${esc(m.amount)}</small><span id="miAmt">—</span></div><div class="mi-pbtn" id="miSave">${esc(m.save)}</div>
        <div class="mi-ok"><div style="display:grid;justify-items:center;gap:8px"><svg viewBox="0 0 48 48"><path d="M12 25 l8 8 l16 -18"/></svg>${esc(m.saved)}</div></div></div></div><i class="mi-fg"></i>`;
      const row = st.querySelector('.mi-buyrow'), buy = st.querySelector('#miBuy'), sh = st.querySelector('.mi-sheet'), sym = st.querySelector('#miSym'), sug = st.querySelector('.mi-sug'), amt = st.querySelector('#miAmt'), save = st.querySelector('#miSave'), ok = st.querySelector('.mi-ok'), sum = st.querySelector('#miSum5'), fg = st.querySelector('.mi-fg');
      show(row, 0, 10);
      fingerTo(st, fg, buy, 0.7, true);
      at(1.5, () => anim(sh, [{ opacity: 0, transform: 'translateY(60px)' }, { opacity: 1, transform: 'none' }], 520));
      at(2.3, () => tween(RM ? 0.01 : 0.7, p => { sym.textContent = 'BTC'.slice(0, Math.ceil(3 * p)); }));
      at(3.1, () => anim(sug, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], 320));
      fingerTo(st, fg, sug, 3.6, true);
      at(4.4, () => { anim(sug, [{ opacity: 1 }, { opacity: 0 }], 250); sym.textContent = 'Bitcoin · BTC'; });
      at(5.0, () => tween(RM ? 0.01 : 0.6, p => { amt.textContent = money(100 * ease(p)); }));
      fingerTo(st, fg, save, 6.0, true);
      at(6.8, () => { anim(ok, [{ opacity: 0 }, { opacity: 1 }], 300); const p = ok.querySelector('path'); let L = 40; try { L = p.getTotalLength(); } catch (e) {} p.style.strokeDasharray = L; anim(p, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], 450, { delay: 120 }); });
      fingerOut(fg, 7.0);
      at(7.6, () => tween(0.9, p => { sum.textContent = money(2480 + 100 * ease(p)); }));
    },
    /* 6 — Орион и знания */
    (st, m) => {
      st.innerHTML = `<div class="mi-col">${sphere(110, 'big')}<div class="mi-say">${esc(m.say)}</div>
        <div class="mi-cards2" style="--line2:transparent"><div class="mi-card"><b>${esc(m.learn)}</b><span>${esc(m.learnS)}</span></div><div class="mi-card"><b>${esc(m.d14)}</b><span>${esc(m.d14S)}</span></div></div></div>`;
      const o = st.querySelector('.mi-or'), say = st.querySelector('.mi-say'), cs = st.querySelectorAll('.mi-card');
      o.style.opacity = '0'; at(0, () => anim(o, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], 700));
      at(1.6, () => o.style.setProperty('--mi-oc', 'var(--pos,#30d158)'));
      at(1.9, () => anim(say, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 420));
      cs.forEach((c, j) => show(c, 4.6 + j * 0.25, 14));
    },
    /* 7 — первое действие */
    (st, m) => {
      st.innerHTML = `<div class="mi-col">${sphere(96, 'big')}</div>`;
      const o = st.querySelector('.mi-or'); o.style.opacity = '0';
      at(0, () => anim(o, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], 600));
    }
  ];

  /* ---------- разметка ---------- */
  const IC = {
    on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>'
  };
  function mount() {
    if (!document.getElementById('mlIntroCss')) { const s = h('style'); s.id = 'mlIntroCss'; s.textContent = CSS; document.head.appendChild(s); }
    const t = T();
    const r = h('div'); r.id = 'mlIntro'; r.setAttribute('role', 'dialog'); r.setAttribute('aria-modal', 'true'); r.setAttribute('aria-label', t.dialog); r.setAttribute('translate', 'no');
    r.innerHTML = `<div class="mi-in"><div class="mi-prog" aria-hidden="true">${DUR.map(() => '<i><b></b></i>').join('')}</div>
      <div class="mi-bar"><button type="button" class="mi-ic" id="miSnd"></button><button type="button" class="mi-ic" id="miCc"><span class="mi-cc" aria-hidden="true">CC</span></button><button type="button" class="mi-ic" id="miPause"></button><button type="button" class="mi-skip" id="miSkip">${esc(t.skip)}</button></div>
      <div class="mi-body" id="miBody"><button type="button" class="mi-resume" id="miResume">${esc(t.resume)}</button></div>
      <div class="mi-cap" id="miCap" aria-hidden="true"></div>
      <div class="mi-nav" id="miNav"></div></div>`;
    document.body.appendChild(r);
    S.root = r;
    S.el = { cc: r.querySelector('#miCc'), body: r.querySelector('#miBody'), cap: r.querySelector('#miCap'), nav: r.querySelector('#miNav'), snd: r.querySelector('#miSnd'), pause: r.querySelector('#miPause'), skip: r.querySelector('#miSkip'), prog: [...r.querySelectorAll('.mi-prog i')] };
    S.el.skip.onclick = () => close('skip');
    S.el.snd.onclick = () => setMuted(!S.muted);
    S.el.cc.onclick = () => { S.cc = !S.cc; lsSet('ml-intro-cc', S.cc); paintCtl(); };
    S.el.pause.onclick = () => (S.paused ? resume() : pause());
    r.querySelector('#miResume').onclick = () => resume();
    /* смахивание влево/вправо */
    let sx = 0, sy = 0, st = 0, on = false;
    S.el.body.addEventListener('pointerdown', e => { on = true; sx = e.clientX; sy = e.clientY; st = Date.now(); }, { passive: true });
    S.el.body.addEventListener('pointerup', e => {
      if (!on) return; on = false; const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) { if (dx < 0) next(); else prev(); }
    }, { passive: true });
    S.el.body.addEventListener('pointercancel', () => { on = false; }, { passive: true });
    r.addEventListener('keydown', onKey);
    paintCtl();
    requestAnimationFrame(() => r.classList.add('on'));
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close('skip'); }
    else if (e.key === 'ArrowRight') { if (S.i >= 0) next(); }
    else if (e.key === 'ArrowLeft') { if (S.i > 0) prev(); }
    else if (e.key === 'Tab') {   /* фокус не уходит из ролика */
      const f = [...S.root.querySelectorAll('button:not([disabled]),[tabindex="-1"]')].filter(b => b.offsetParent && b.tagName === 'BUTTON');
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }
  function paintCtl() {
    const t = T(), e = S.el; if (!e.snd) return;
    e.snd.innerHTML = S.muted ? IC.off : IC.on; e.snd.setAttribute('aria-label', S.muted ? t.soundOff : t.soundOn); e.snd.setAttribute('aria-pressed', S.muted ? 'true' : 'false');
    e.cc.setAttribute('aria-pressed', S.cc ? 'true' : 'false'); e.cc.setAttribute('aria-label', S.cc ? t.ccOn : t.ccOff); S.root.classList.toggle('nocc', !S.cc);
    e.pause.innerHTML = S.paused ? IC.play : IC.pause; e.pause.setAttribute('aria-label', S.paused ? t.play : t.pause);
    e.pause.style.visibility = S.i >= 0 && S.i < N - 1 ? 'visible' : 'hidden';
    S.root.classList.toggle('paused', !!S.paused);
  }
  function paintNav() {
    const t = T(), nav = S.el.nav; nav.innerHTML = '';
    if (S.i < 0) {
      const b = h('button', 'mi-btn pri'); b.type = 'button'; b.id = 'miWatch'; b.textContent = t.watch; b.onclick = start; nav.appendChild(b); return;
    }
    const back = h('button', 'mi-btn back' + (S.i === 0 ? ' ghost' : '')); back.type = 'button'; back.id = 'miBack'; back.textContent = t.back; back.onclick = prev; if (S.i === 0) back.tabIndex = -1, back.setAttribute('aria-hidden', 'true');
    nav.appendChild(back);
    if (S.i < N - 1) { const n = h('button', 'mi-btn'); n.type = 'button'; n.id = 'miNext'; n.textContent = t.next; n.onclick = next; nav.appendChild(n); }
    else { const c = h('button', 'mi-btn pri'); c.type = 'button'; c.id = 'miCta'; c.textContent = S.mode === 'replay' ? t.ctaReplay : t.cta; c.onclick = () => { track('cta', { slide: N }); close('cta'); }; nav.appendChild(c); }
  }
  function paintProg() {
    S.el.prog.forEach((p, j) => { p.classList.toggle('done', j < S.i); const b = p.firstChild; b.style.transform = j < S.i ? 'scaleX(1)' : 'scaleX(0)'; });
  }

  /* ---------- показ ---------- */
  function cover() {
    S.root.classList.add('cover');
    const t = T(), sl = h('div', 'mi-sl cur');
    sl.innerHTML = `<div class="mi-st"><div class="mi-col">${sphere(120, 'big')}</div></div><div class="mi-tx"><h2 tabindex="-1">${esc(t.coverT)}</h2><p class="mi-sub">${esc(t.coverS)}</p></div>`;
    S.el.body.appendChild(sl);
    paintNav(); paintCtl(); paintProg();
    setTimeout(() => { const hd = sl.querySelector('h2'); try { hd.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  async function start() {
    if (S.started || !S.open) return;
    const run = S.run, b = S.root.querySelector('#miWatch');
    S.started = true;
    const c = audioCtx();
    if (c && c.state === 'suspended') { try { await c.resume(); } catch (e) {} }
    if (!S.open || S.run !== run) return;
    try { if (window.speechSynthesis) speechSynthesis.getVoices(); } catch (e) {}
    /* какой голос: файлы → живой Орион → телефон. Первая реплика должна быть готова — ждём до 2,5 с */
    const p0 = bufFor(0);
    if (!p0.done && (AUDIO[lang()] || (LIVE && !S.voiceOff && window.mlVoice && !navigator.webdriver))) {
      if (b) { b.disabled = true; b.textContent = T().prep; }
      await Promise.race([p0, new Promise(r => setTimeout(r, 2500))]);
      if (!S.open || S.run !== run) return;   /* пока готовился голос, нажали «Пропустить» */
    }
    S.kind = p0.done && p0.buf ? (AUDIO[lang()] ? 'file' : 'live') : 'phone';
    if (S.kind !== 'phone') bufFor(1);
    if (!S.muted) masterTo(1, 1.4);
    AU.padT = c ? c.currentTime : 0; padPump();
    track('start', { voice: S.kind });
    go(0);
  }
  function clearSlide() {
    for (const a of S.anims) try { a.cancel(); } catch (e) {}
    S.anims = []; S.q = []; S.tw = [];
    stopVoice();
  }
  function go(i) {
    if (i < 0 || i >= N || !S.open) return;
    const prevI = S.i; S.dir = i >= prevI ? 1 : -1;
    /* куда вернуть фокус: нажали «Далее»/«Назад» — на ту же кнопку; фокус на кнопках сверху — не трогаем; иначе — на заголовок */
    const ae = document.activeElement, fid = (ae && ae.id) || '', keep = /^mi(Next|Back)$/.test(fid), stay = !!(ae && ae.closest && ae.closest('#mlIntro .mi-bar'));
    clearSlide(); S.root.classList.remove('cover');
    S.i = i; S.t = 0; S.k = 1; S.capIdx = -1;
    /* голос: если запись уже готова — слайд растягивается под её длину */
    const p = S.kind !== 'phone' ? bufFor(i) : null;
    if (p && p.done && p.buf) S.k = Math.max(1, (0.5 + p.buf.duration + 0.9) / DUR[i]);
    S.len = DUR[i] * S.k;
    if (S.kind !== 'phone' && i + 1 < N) bufFor(i + 1);
    /* субтитры: предложения по времени, пропорционально длине */
    const cap = capText(i), ss = capParts(cap), total = ss.reduce((a, s) => a + s.length, 0) || 1;
    const vd = p && p.done && p.buf ? p.buf.duration : Math.max(DUR[i] - 1.6, cap.length / 14);
    let acc = 0; S.caps = ss; S.capT = ss.map(s => { const t0 = 0.5 * S.k + vd * acc / total; acc += s.length; return t0; });
    S.el.cap.textContent = '';
    /* новый слайд */
    const t = T(), s = t.slides[i], old = S.el.body.querySelector('.mi-sl.cur');
    const sl = h('div', 'mi-sl cur');
    sl.innerHTML = `<div class="mi-st" aria-hidden="true"></div><div class="mi-tx"><h2 tabindex="-1">${esc(s.t)}</h2><p class="mi-vh" id="miVh${i}">${esc(t.slide(i + 1, N))}. ${esc(cap)}</p></div>`;
    S.el.body.appendChild(sl);
    const st = sl.querySelector('.mi-st');
    try { BUILD[i](st, t.mk); } catch (e) { console.warn('intro slide', i, e); }
    const hd = sl.querySelector('.mi-tx'); hd.style.opacity = '0';
    at(0.15, () => anim(hd, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], 500));
    if (old) {
      old.classList.remove('cur');
      const a = old.animate ? old.animate(RM ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-28 * S.dir}px)` }], { duration: RM ? 150 : 320, easing: 'ease-in', fill: 'forwards' }) : null;
      if (a) a.onfinish = () => old.remove(); else old.remove();
      if (!RM && sl.animate) sl.animate([{ transform: `translateX(${28 * S.dir}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    at(0.5, () => startVoice(i));
    paintNav(); paintProg(); paintCtl();
    if (S.paused) { S.paused = false; S.playing = true; if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {}); paintCtl(); }
    S.playing = true;
    if (!stay) setTimeout(() => { try { const k = keep && (document.getElementById(fid) || document.getElementById('miCta')); if (k && k.offsetParent && getComputedStyle(k).visibility !== 'hidden') k.focus({ preventScroll: true }); else sl.querySelector('h2').focus({ preventScroll: true }); } catch (e) {} }, 80);
    track('slide', { n: i + 1 });
    if (i === N - 1 && !S.done7) { S.done7 = true; track('complete', { n: N }); }
  }
  function next() { if (S.i < N - 1) go(S.i + 1); }
  function prev() { if (S.i > 0) go(S.i - 1); }

  /* часы ролика: идут только во время показа */
  function tick(now) {
    S.raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - (S.last || now)) / 1000)); S.last = now;
    if (!S.playing || S.paused || S.i < 0) return;
    S.t += dt;
    while (S.q.length && S.q[0].t <= S.t) { const e = S.q.shift(); try { e.fn(); } catch (x) { console.warn('intro step', x); } }
    if (S.tw.length) S.tw = S.tw.filter(w => { const p = Math.min(1, (S.t - w.t0) / w.d); try { w.fn(p); } catch (x) {} return p < 1; });
    /* полоска прогресса текущего слайда */
    const pb = S.el.prog[S.i] && S.el.prog[S.i].firstChild; if (pb) pb.style.transform = `scaleX(${Math.min(1, S.t / S.len).toFixed(4)})`;
    /* субтитры */
    let ci = -1; for (let j = 0; j < S.capT.length; j++) if (S.t >= S.capT[j]) ci = j;
    if (ci !== S.capIdx && ci >= 0) { S.capIdx = ci; S.el.cap.textContent = S.caps[ci]; }
    if (AU.ctx && AU.ctx.state === 'running') padPump();
    /* конец слайда: время вышло и голос договорил (голос телефона — не дольше +6 с) */
    if (S.i < N - 1 && S.t >= S.len) {
      const v = S.voice, done = !v || v.done || S.muted || S.t > S.len + 6;
      if (done) next();
    }
  }

  function pause(auto) {
    if (S.paused || S.i < 0) return;
    S.paused = true; S.playing = false;
    for (const a of S.anims) try { if (a.playState === 'running') a.pause(); } catch (e) {}
    if (AU.ctx && AU.ctx.state === 'running') AU.ctx.suspend().catch(() => {});
    if (S.voice && S.voice.kind === 'phone' && !S.voice.done) { const v = S.voice; v.paused = true; v.resumeFrom = sentences(S.caps.slice(0, Math.max(0, S.capIdx)).join(' ') || '').length * (S.capIdx > 0 ? 1 : 0); try { speechSynthesis.cancel(); } catch (e) {} }
    paintCtl(); track('pause', { n: S.i + 1, auto: !!auto });
  }
  function resume() {
    if (!S.paused) return;
    S.paused = false; S.playing = true; S.last = performance.now();
    for (const a of S.anims) try { if (a.playState === 'paused') a.play(); } catch (e) {}
    if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {});
    const v = S.voice; if (v && v.kind === 'phone' && v.paused && !v.done) startVoice(S.i, v.resumeFrom);
    paintCtl();
  }
  function setMuted(m) {
    S.muted = !!m; lsSet('ml-intro-mute', S.muted);
    if (S.started) masterTo(S.muted ? 0 : 1, 0.25);
    const v = S.voice;
    if (S.muted && v && v.kind === 'phone') { try { speechSynthesis.cancel(); } catch (e) {} v.done = true; }
    if (!S.muted && S.i >= 0 && S.kind === 'phone' && v && v.kind !== 'buf' && !S.paused && S.t < S.len) startVoice(S.i, S.capIdx > 0 ? sentences(S.caps.slice(0, S.capIdx).join(' ')).length : 0);
    paintCtl();
  }
  function onVis() { if (document.visibilityState === 'hidden' && S.open && S.i >= 0 && !S.paused) pause(true); }

  function open(o) {
    o = o || {};
    if (S.open) return;
    S.open = true; S.mode = o.mode === 'replay' ? 'replay' : 'first'; S.onClose = o.onClose || null; S.i = -1; S.started = false; S.paused = false; S.playing = false; S.kind = 'phone';
    S.voiceOff = !!o.voiceOff; S.run = (S.run || 0) + 1;
    S.muted = !!o.voiceOff || !!lsGet('ml-intro-mute', false); S.cc = lsGet('ml-intro-cc', true) !== false; S.done7 = false; S.prevFocus = document.activeElement;
    try { if (window.Mascot && window.Mascot.hush) window.Mascot.hush(); } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    mount(); cover();
    /* остальное приложение недоступно скринридеру и клавиатуре, пока идёт ролик */
    S.inert = [...document.body.children].filter(x => x !== S.root && x.tagName !== 'SCRIPT' && x.tagName !== 'STYLE' && !x.inert);
    S.inert.forEach(x => { try { x.inert = true; x.setAttribute('inert', ''); } catch (e) {} });
    document.addEventListener('visibilitychange', onVis);
    S.last = 0; cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(tick);
    /* первая реплика готовится, пока человек читает обложку */
    if (AUDIO[lang()] || (LIVE && !S.voiceOff && window.mlVoice && !navigator.webdriver)) try { bufFor(0); } catch (e) {}
    track('open', {});
  }
  function close(reason) {
    if (!S.open) return;
    if (reason === 'skip') track('skip', { n: S.i + 1 });
    lsSet('ml-intro', { seen: new Date().toISOString(), how: reason || 'close', mode: S.mode });
    S.open = false; S.playing = false;
    clearSlide();
    document.removeEventListener('visibilitychange', onVis);
    cancelAnimationFrame(S.raf);
    if (AU.ctx) { masterTo(0, 0.5); const c = AU.ctx; setTimeout(() => { try { c.close(); } catch (e) {} }, 650); AU.ctx = null; }
    S.bufs = new Map();
    S.inert.forEach(x => { try { x.inert = false; x.removeAttribute('inert'); } catch (e) {} }); S.inert = [];
    const r = S.root; S.root = null; S.el = {};
    if (r) { r.classList.remove('on'); setTimeout(() => r.remove(), RM ? 0 : 360); }
    const cb = S.onClose; S.onClose = null;
    try { if (cb) cb(reason); } catch (e) {}
    try { if (S.mode === 'replay' && S.prevFocus && S.prevFocus.focus && S.prevFocus.offsetParent) S.prevFocus.focus(); } catch (e) {}
  }

  window.MLIntro = {
    open, close,
    seen: () => !!lsGet('ml-intro', null),
    debug: { state: () => ({ open: S.open, i: S.i, t: +S.t.toFixed(2), len: +S.len.toFixed(2), paused: S.paused, muted: S.muted, kind: S.kind, mode: S.mode, cap: S.el.cap ? S.el.cap.textContent : '', rm: RM }), go: i => go(i), slides: N, durations: DUR.slice(), text: TEXT }
  };
})();
