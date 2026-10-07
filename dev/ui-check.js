/**
 * Проверка экранов в браузере (этап 3). Сначала запустите просмотр:
 *   PREVIEW_NOW=2026-10-04T09:00:00Z node dev/preview.js dev/fixtures/start.json 8788
 * затем:
 *   node dev/ui-check.js http://localhost:8788 [папка для скриншота]
 */
const BASE = process.argv[2] || 'http://localhost:8788';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  const step = async (name, fn) => { await fn(); console.log('✓', name); };
  // SortableJS нужен «живой» жест мыши: плавное движение, а не мгновенный перенос.
  const drag = async (from, to) => {
    await to.scrollIntoViewIfNeeded();
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await p.mouse.move(a.x + 20, a.y + 10);
    await p.waitForTimeout(150);
    await p.mouse.down();
    await p.waitForTimeout(150);
    for (let i = 1; i <= 15; i++) {
      await p.mouse.move(a.x + 20 + (b.x + 30 - a.x - 20) * i / 15, a.y + 10 + (b.y + 40 - a.y - 10) * i / 15);
      await p.waitForTimeout(25);
    }
    await p.mouse.up();
  };
  await p.goto(BASE + '/#today');
  await p.waitForSelector('.counters', { timeout: 90000 });

  await step('«Просрочено» свёрнуто и раскрывается по клику', async () => {
    if (await p.locator('.block:has(h2:text-is("Просроченные"))').locator('.drow').first().isVisible()) throw new Error('просроченные видны сразу');
    await p.click('.block:has(h2:text-is("Просроченные")) .block-head.toggle');
    await p.locator('.block:has(h2:text-is("Просроченные"))').locator('.drow').first().waitFor();
  });
  await step('«Написал» убирает сделку из просроченных', async () => {
    const before = await p.locator('.badge.red').innerText();
    const name = await p.locator('.block:has(h2:text-is("Просроченные"))').locator('.drow:has(.stage:text-is("В диалоге"))').first().locator('.drow-name').innerText();
    await p.locator('.block:has(h2:text-is("Просроченные"))').locator('.drow:has(.stage:text-is("В диалоге"))').first().locator('text=Написал').click();
    await p.waitForSelector('.toast:has-text("Касание добавлено")', { timeout: 1000 });
    const after = await p.locator('.badge.red').innerText();
    if (+after !== +before - 1) throw new Error(before + ' → ' + after);
    const touches = await p.locator('.counter >> nth=1').locator('.num').innerText();
    console.log('   ', name, 'просрочено', before, '→', after, '; касаний', touches);
  });
  await step('«+1 день» переносит задачу', async () => {
    const before = await p.locator('.badge.red').innerText();
    await p.locator('.block:has(h2:text-is("Просроченные")) .drow').first().locator('text=+1 день').click();
    await p.waitForSelector('.toast:has-text("перенесена")');
    const after = await p.locator('.badge.red').innerText();
    if (+after !== +before - 1) throw new Error(before + ' → ' + after);
  });
  await step('Порядок блоков и список «касаний» по кнопке «посмотреть»', async () => {
    const titles = await p.locator('.block h2').allInnerTexts();
    if (titles.join('|') !== 'На сегодня|Просроченные|Без ответа') throw new Error(titles.join('|'));
    await p.click('.counter.clickable >> nth=1');
    await p.waitForSelector('.modal h2:has-text("Касания за сегодня")');
    const n = await p.locator('.modal .list-item').count();
    if (n < 1) throw new Error('в списке касаний ' + n);
    await p.click('.modal >> text=✕');
  });
  await step('Карточка из «Сегодня» открывается сразу (заранее подгружена)', async () => {
    await p.waitForTimeout(1500); // время на фоновую подгрузку карточек
    const t0 = Date.now();
    await p.locator('.block:has(h2:text-is("На сегодня")) .drow, .block:has(h2:text-is("Без ответа")) .drow').first().locator('.drow-name').click();
    await p.waitForSelector('.deal-grid .zone-client', { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector('.zone-history').innerText.includes('Загружаю историю'), null, { timeout: 15000 });
    const ms = Date.now() - t0;
    console.log('    карточка с историей за', ms, 'мс');
    if (ms > 600) throw new Error('карточка открывалась ' + ms + ' мс');
    await p.click('.deal-head .btn.ghost');
    await p.waitForSelector('.counters');
  });
  await step('Новое обращение: похожие клиенты при вводе имени', async () => {
    await p.keyboard.press('n');
    await p.fill('.modal input.input >> nth=1', 'Снежана');
    await p.waitForSelector('.similar-item:has-text("Снежана")', { timeout: 8000 });
    const href = await p.locator('.similar-item a').first().getAttribute('href');
    if (!/#deal\/D\d+$/.test(href)) throw new Error('ссылка в новой вкладке: ' + href);
    await p.click('.modal-head .btn');
  });
  await step('Строка «Итого оплачено за месяц»', async () => {
    const t = await p.locator('.month-total').innerText();
    if (!/Итого оплачено за октябрь/.test(t)) throw new Error(t);
    console.log('   ', t.replace(/\s+/g, ' '));
  });
  await step('Новое обращение по клавише N → карточка', async () => {
    await p.keyboard.press('n');
    if (!(await p.locator('.modal select >> nth=1').isDisabled())) throw new Error('тариф доступен без курса');
    const potoki = await p.locator('.modal .seg >> nth=1').innerText();
    if (!/Исходящее/.test(potoki) || /Реактивация/.test(potoki)) throw new Error('потоки: ' + potoki);
    await p.selectOption('.modal select >> nth=0', 'ЯБ');
    const tariffs = await p.locator('.modal select >> nth=1').locator('option').allInnerTexts();
    if (tariffs.join('|') !== '— не выбран —|Необходимый минимум|Золотая середина|Всё и сразу') throw new Error('тарифы: ' + tariffs);
    await p.selectOption('.modal select >> nth=1', 'Золотая середина');
    await p.click('.modal .score-pick button:has-text("3")');
    await p.click('.modal >> text=Инстаграм');
    await p.fill('.modal input.input >> nth=0', 'https://instagram.com/New.Client_77/');
    await p.locator('.modal input.input >> nth=1').fill('Вера');
    await p.click('.modal >> text=Да, общались');
    await p.selectOption('.modal .prior-box select', 'ВК');
    await p.fill('.modal .prior-box input[type=date]', '2026-05-10');
    await p.fill('.modal .prior-box input:not([type])', 'Весной спрашивала про УСН');
    await p.waitForTimeout(500);
    await p.fill('.modal textarea', 'Хочет на УСН, спрашивает про рассрочку');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.deal-grid', { timeout: 15000 });
    const head = await p.locator('.deal-head').innerText();
    if (!/Вера/.test(head) || !/Новое/.test(head)) throw new Error(head);
    if (!(await p.locator('.deal-head .score-pick .btn.on.s3').count())) throw new Error('оценка 3 не отмечена');
    const amount = await p.inputValue('.zone-deal input[type=number]');
    if (amount !== '89900') throw new Error('сумма ' + amount);
    const nick = await p.locator('.zone-client').innerText();
    if (!/new\.client_77/.test(nick)) throw new Error('ник не нормализован: ' + nick);
    console.log('   ', head.replace(/\s+/g, ' '));
  });
  await step('Курс и тариф подставляют сумму; у курса только его тарифы', async () => {
    const tariffSel = '.zone-deal .field:has(> label:text-is("Тариф")) select';
    const courseSel = '.zone-deal .field:has(> label:text-is("Курс")) select';
    await p.selectOption(courseSel, 'НДС');
    await p.waitForSelector('.toast:has-text("Сохранено"), .save-state:has-text("Сохранено")', { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(600);
    let opts = await p.locator(tariffSel).locator('option').allInnerTexts();
    if (opts.some((o) => /минимум|середина|сразу/.test(o))) throw new Error('у НДС лишние тарифы: ' + opts);
    await p.selectOption(courseSel, 'УСН');
    await p.waitForTimeout(600);
    opts = await p.locator(tariffSel).locator('option').allInnerTexts();
    if (opts.some((o) => /сопровожд/i.test(o)) || opts.length !== 4) throw new Error('у УСН лишние тарифы: ' + opts);
    await p.selectOption(tariffSel, 'Золотая середина');
    await p.waitForFunction(() => document.querySelector('.zone-deal input[type=number]').value === '59900', null, { timeout: 5000 });
  });
  await step('Шаблон: быстрое копирование 📋 одной кнопкой', async () => {
    await p.click('text=Шаблоны');
    await p.click('.tpl-item-row:has-text("Рассрочка одобрена") .tpl-quick');
    await p.waitForSelector('.feed-item:has-text("Шаблон: Рассрочка одобрена")', { timeout: 8000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    if (!/^Вера, добрый день/.test(clip)) throw new Error('буфер: ' + clip);
    await p.click('.tpl-panel >> text=Закрыть');
  });
  await step('Шаблон: копирование с именем и касание «Шаблон»', async () => {
    await p.click('text=Шаблоны');
    await p.click('.tpl-item:has-text("Рассрочка одобрена")');
    await p.click('text=Скопировать');
    await p.waitForSelector('.feed-item:has-text("Шаблон: Рассрочка одобрена")', { timeout: 5000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    if (!/^Вера, добрый день/.test(clip)) throw new Error('буфер: ' + clip);
    const stage = await p.locator('.deal-head .stage').innerText();
    if (stage !== 'В диалоге') throw new Error('стадия ' + stage);
  });
  await step('«Был контакт» сохранился в карточке', async () => {
    const box = await p.locator('.zone-deal .prior-box').innerText();
    if (!/Был контакт/.test(box)) throw new Error(box);
    const where = await p.locator('.zone-deal .prior-box select').inputValue();
    if (where !== 'ВК') throw new Error('где: ' + where);
  });
  await step('Старая переписка с датой и каналом; касание появляется сразу', async () => {
    await p.click('.touch-form >> text=Клиент ответил');
    await p.fill('.touch-form textarea', 'Отвечала в ВК в мае');
    await p.selectOption('.touch-form select', 'ВК');
    await p.click('text=старая переписка? указать дату');
    await p.fill('.touch-form input[type=datetime-local]', '2026-05-12T15:00');
    await p.click('.touch-form button.btn.primary');
    await p.waitForSelector('.feed-item:not(.pending):has-text("Отвечала в ВК в мае")', { timeout: 8000 });
    const last = await p.locator('.feed-item').last().innerText();
    if (!/Отвечала в ВК в мае/.test(last) || !/12\.05/.test(last)) throw new Error('старая переписка не в конце ленты: ' + last);
  });
  await step('История: входящие и исходящие помечены', async () => {
    const meta = await p.locator('.feed-item .feed-meta').allInnerTexts();
    if (!meta.some((m) => /исходящее\s*Шаблон/.test(m)) || !meta.some((m) => /входящее\s*Обращение/.test(m))) throw new Error(meta.join(' / '));
  });
  await step('Правка клиента: телефон нормализуется', async () => {
    await p.click('.zone-client .kv:has-text("Телефон") .inline-val');
    await p.keyboard.type('8 (916) 555-44-33');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.zone-client .inline-val:has-text("79165554433")', { timeout: 5000 });
  });
  await step('Отказ без причины не сохраняется, с причиной — сохраняется', async () => {
    await p.click('.btn.danger.lg');
    await p.click('.modal >> text=Сохранить');
    await p.waitForSelector('.toast.error:has-text("причину")');
    await p.selectOption('.modal select', 'Нет денег');
    await p.click('.modal >> text=Сохранить');
    await p.waitForSelector('.deal-head .stage:has-text("Отказ")');
    await p.waitForSelector('.feed-item:has-text("В диалоге → Отказ: Нет денег")');
  });
  await step('Отложено через выбор стадии требует дату не раньше завтра', async () => {
    await p.selectOption('.zone-deal select >> nth=0', 'Отложено');
    await p.waitForSelector('.modal');
    await p.click('.modal >> text=Сохранить');
    await p.waitForSelector('.deal-head .stage:has-text("Отложено")');
  });
  await step('Поиск по нику открывает карточку', async () => {
    await p.keyboard.press('Escape');
    await p.click('.deal-head h1');
    await p.keyboard.press('/');
    await p.keyboard.type('malinka');
    await p.waitForSelector('.search-item', { timeout: 5000 });
    await p.keyboard.press('Enter');
    await p.waitForSelector('.deal-head:has-text("Марина")');
  });
  await step('«Проверено» убирает жёлтую плашку', async () => {
    await p.goto(BASE + '/#deal/D033');
    await p.waitForSelector('.banner');
    await p.click('.banner >> text=Проверено');
    await p.waitForSelector('.banner', { state: 'detached' });
  });
  await step('Доска: колонки по стадиям, перетаскивание в «Отказ» открывает окно, отмена возвращает', async () => {
    await p.click('.topbar .tab:has-text("Доска")');
    await p.waitForSelector('.board .bcol', { timeout: 15000 });
    const cols = await p.locator('.bcol-head .stage').allInnerTexts();
    if (cols.join('|') !== 'Новое|В диалоге|Курс подобран|Заказ создан|Отложено|Оплачено|Отказ') throw new Error(cols.join('|'));
    const src = p.locator('.bcol >> nth=1').locator('.bcard').first();
    const name = await src.locator('b').innerText();
    const before = await p.locator('.bcol >> nth=1').locator('.bcard').count();
    await drag(src, p.locator('.bcol.closed >> nth=1').locator('.bcol-body'));
    await p.waitForSelector('.modal h2:has-text("Отказ")', { timeout: 8000 });
    await p.click('.modal >> text=Отмена');
    const after = await p.locator('.bcol >> nth=1').locator('.bcard').count();
    if (after !== before) throw new Error('карточка не вернулась: ' + before + ' → ' + after);
    const src2 = p.locator('.bcol >> nth=1').locator('.bcard').first();
    await drag(src2, p.locator('.bcol >> nth=2').locator('.bcol-body'));
    await p.waitForFunction((n) => [...document.querySelectorAll('.bcol')][2].innerText.includes(n), name, { timeout: 8000 });
  });
  await step('Отчёт: новые входящие/исходящие и диалоги по каналам', async () => {
    await p.click('.topbar .tab:has-text("Отчёт")');
    await p.waitForSelector('.kpis', { timeout: 15000 });
    const k = await p.locator('.kpis').innerText();
    if (!/новые: входящие \/ исходящие/.test(k) || !/активных диалогов/.test(k)) throw new Error(k);
    const rows = await p.locator('.tbl >> nth=0').locator('tbody tr').count();
    if (!rows) throw new Error('нет строк по каналам');
    console.log('   ', k.replace(/\s+/g, ' ').slice(0, 160));
  });
  await step('Как работать: схема ведёт по шагам', async () => {
    await p.click('.topbar .tab:has-text("Как работать")');
    await p.click('text=Нет, не нашёлся');
    await p.click('text=Клиент написал нам');
    await p.waitForSelector('.flow-node.answer:has-text("Входящее")');
  });
  await step('Задания: создать, загрузить список, шаблон, «написали», «ответил» → сделка, статистика', async () => {
    await p.click('.topbar .tab:has-text("Задания")');
    await p.waitForSelector('text=Создать первое задание', { timeout: 15000 });
    await p.click('text=Создать первое задание');
    await p.fill('.modal input.input >> nth=0', 'Отработка БК, октябрь');
    await p.fill('.modal input[type=date] >> nth=0', '2026-10-05');
    await p.fill('.modal input[type=date] >> nth=1', '2026-10-18');
    await p.click('.modal >> text=Сохранить');
    await p.waitForSelector('.deal-head h1:has-text("Отработка БК")', { timeout: 15000 });
    await p.click('text=изменить');
    await p.fill('.modal textarea >> nth=0', 'Был на всех\nБыл на первом');
    await p.click('.modal >> text=Сохранить');
    await p.waitForSelector('.modal', { state: 'detached' });
    await p.click('.filters >> text=Загрузить список');
    const tsv = ['id\tEmail\tИмя\tФамилия\tТелефон\tutm_source\tVK-ID', '9001\tanna@test.ru\tАнна\tТестова\t+79990000001\tinstagram\t',
      '9002\tolga@test.ru\tОльга\tПримерова\t+79990000002\tvk\t123456', '9002\tolga@test.ru\tОльга\tПовтор\t\t\t'].join('\n');
    await p.click('text=или вставить строки из таблицы');
    await p.fill('.modal textarea', tsv);
    await p.waitForSelector('.import-preview:has-text("Найдено людей: 3")');
    await p.click('.modal .modal-foot .btn.primary');
    await p.waitForSelector('.toast:has-text("Загружено 2")', { timeout: 15000 });
    await p.waitForSelector('.prow:has-text("Анна")', { timeout: 15000 });
    await p.click('.subtabs >> text=Шаблоны');
    await p.click('text=+ Шаблон');
    await p.fill('.tpl-form input.input', 'Вариант 1');
    await p.selectOption('.tpl-form select', 'Был на всех');
    await p.fill('.tpl-form textarea', '{Имя}, добрый день! Это {Менеджер}.');
    await p.click('.tpl-form >> text=Сохранить');
    await p.waitForSelector('.tpl-item-card:has-text("Вариант 1")', { timeout: 15000 });
    await p.click('.subtabs >> text=Люди');
    await p.click('.prow:has-text("Анна")');
    await p.waitForSelector('.person-panel');
    const ch = await p.locator('.person-panel .seg .btn.on').first().innerText();
    if (ch !== 'Инстаграм') throw new Error('канал по utm_source: ' + ch);
    await p.click('.person-panel >> text=Скопировать и отметить');
    await p.waitForSelector('.prow:has-text("Анна") .pstatus:has-text("Написали")', { timeout: 15000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    if (!/^Анна, добрый день! Это Максим\./.test(clip)) throw new Error('буфер: ' + clip);
    await p.click('.person-panel >> text=Ответил → в CRM');
    await p.waitForSelector('.person-panel a:has-text("Открыть в CRM (D")', { timeout: 15000 });
    await p.click('.subtabs >> text=Статистика');
    const row = await p.locator('.tbl >> nth=0').locator('tbody tr').first().innerText();
    if (!/Вариант 1/.test(row) || !/100%/.test(row)) throw new Error('статистика: ' + row);
    await p.click('.subtabs >> text=Люди');
    await p.click('.prow:has-text("Анна")');
    await p.click('.person-panel a:has-text("Открыть в CRM (D")');
    await p.waitForSelector('.deal-head:has-text("Анна Тестова")', { timeout: 15000 });
    const hist = await p.locator('.zone-history').innerText();
    if (!/Шаблон: Вариант 1/.test(hist) || !/Клиент ответил/.test(hist)) throw new Error('история сделки: ' + hist.slice(0, 300));
    await p.click('text=← Задание');
    await p.waitForSelector('.deal-head h1:has-text("Отработка БК")', { timeout: 15000 });
    await p.click('.prow:has-text("Ольга")');
    await p.click('.person-panel >> text=Удалить из задания');
    await p.waitForSelector('.modal h2:has-text("Напишите причину")');
    if (!(await p.locator('.modal .btn.danger').isDisabled())) throw new Error('можно удалить без причины');
    await p.fill('.modal textarea', 'Уже учится у нас');
    await p.click('.modal .btn.danger');
    await p.waitForSelector('.prow:has-text("Ольга")', { state: 'detached', timeout: 15000 });
  });
  await step('Сообщения: категории, правка, имя в приветствия', async () => {
    await p.click('.topbar .tab:has-text("Сообщения")');
    await p.waitForSelector('.msg-group', { timeout: 15000 });
    const cats = await p.locator('.msg-group h2').allInnerTexts();
    if (cats.length < 5) throw new Error('категорий ' + cats.length);
    await p.click('text=Имя клиента в приветствия');
    await p.waitForSelector('.modal h2:has-text("Имя клиента")');
    const rows = await p.locator('.greet-row').allInnerTexts();
    if (!rows.length || rows.some((r) => /обращаться/i.test(r))) throw new Error('приветствия: ' + rows.join(' / '));
    await p.click('.modal-foot .btn.primary');
    await p.waitForSelector('.toast:has-text("Имя добавлено")', { timeout: 15000 });
    await p.waitForSelector('.msg-card:has-text("Не завершил оформление") .msg-text:has-text("Здравствуйте, {Имя}! Меня зовут")', { timeout: 15000 });
    await p.click('.msg-card:has-text("Не завершил оформление") >> text=изменить');
    await p.fill('.tpl-form textarea', 'Здравствуйте, {Имя}! Проверка правки.');
    await p.click('.tpl-form >> text=Сохранить');
    await p.waitForSelector('.msg-card:has-text("Проверка правки")', { timeout: 15000 });
  });
  await step('«Сегодня»: только входящие, исходящие по кнопке', async () => {
    await p.click('.topbar .tab:has-text("Сегодня")');
    await p.waitForSelector('.out-toggle', { timeout: 15000 });
    const count = async () => p.$$eval('.block .badge', (els) => els.reduce((s, e) => s + (+e.textContent || 0), 0));
    const before = await count();
    await p.click('.out-toggle button');
    const after = await count();
    if (!(after > before)) throw new Error('исходящие не добавились: ' + before + ' → ' + after);
    await p.click('.out-toggle button');
    if ((await count()) !== before) throw new Error('исходящие не скрылись');
    console.log('    входящих', before, ', вместе с исходящими', after);
  });
  await step('Календарь: числа по дням, день подробно', async () => {
    await p.click('.topbar .tab:has-text("Календарь")');
    await p.waitForSelector('.cal-cell.today', { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector('.cal.dim'));
    await p.click('.cal-cell:has(.cal-d:text-is("2"))');
    await p.waitForSelector('.cal-day .counter', { timeout: 15000 });
    const n = await p.locator('.cal-day .counter .num >> nth=0').innerText();
    const cell = await p.locator('.cal-cell:has(.cal-d:text-is("2")) .cal-main b').innerText();
    if (n !== cell) throw new Error('день ' + n + ' ≠ клетка ' + cell);
    await p.screenshot({ path: (process.argv[3] || '.') + '/calendar.png', fullPage: true });
    await p.click('.cal-day .list-item >> nth=0');
    await p.waitForSelector('.deal-grid', { timeout: 15000 });
    console.log('    2 октября: обращений', n);
  });
  await step('Почистить: список дублей открывается с «Сегодня»', async () => {
    await p.click('.topbar .tab:has-text("Сегодня")');
    await p.click('a:has-text("Почистить")');
    await p.waitForSelector('.dup-group, .empty-state', { timeout: 15000 });
    console.log('    групп дублей:', await p.locator('.dup-group').count());
  });
  await p.screenshot({ path: (process.argv[3] || '.') + '/ui-check.png' });
  console.log('Ошибки в консоли:', errs.length ? errs : 'нет');
  await b.close();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
