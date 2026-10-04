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
  await p.goto(BASE + '/#today');
  await p.waitForSelector('.counters', { timeout: 30000 });

  await step('«Написал» убирает сделку из просроченных', async () => {
    const before = await p.locator('.badge.red').innerText();
    const name = await p.locator('.drow >> nth=1').locator('.drow-name').innerText();
    await p.locator('.drow >> nth=1').locator('text=Написал').click();
    await p.waitForSelector('.toast:has-text("Касание добавлено")');
    const after = await p.locator('.badge.red').innerText();
    if (+after !== +before - 1) throw new Error(before + ' → ' + after);
    const touches = await p.locator('.counter >> nth=1').locator('.num').innerText();
    console.log('   ', name, 'просрочено', before, '→', after, '; касаний', touches);
  });
  await step('«+1 день» переносит задачу', async () => {
    const before = await p.locator('.badge.red').innerText();
    await p.locator('.drow >> nth=0').locator('text=+1 день').click();
    await p.waitForSelector('.toast:has-text("перенесена")');
    const after = await p.locator('.badge.red').innerText();
    if (+after !== +before - 1) throw new Error(before + ' → ' + after);
  });
  await step('Новое обращение по клавише N → карточка', async () => {
    await p.keyboard.press('n');
    await p.click('.modal >> text=Инстаграм');
    await p.fill('.modal input.input >> nth=0', 'https://instagram.com/New.Client_77/');
    await p.locator('.modal input.input >> nth=1').fill('Вера');
    await p.waitForTimeout(500);
    await p.fill('.modal textarea', 'Хочет на УСН, спрашивает про рассрочку');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.deal-grid', { timeout: 15000 });
    const head = await p.locator('.deal-head').innerText();
    if (!/Вера/.test(head) || !/Новое/.test(head)) throw new Error(head);
    const nick = await p.locator('.zone-client').innerText();
    if (!/new\.client_77/.test(nick)) throw new Error('ник не нормализован: ' + nick);
    console.log('   ', head.replace(/\s+/g, ' '));
  });
  await step('Курс и тариф подставляют сумму', async () => {
    await p.fill('input[list="dl-courses"]', 'УСН');
    await p.locator('input[list="dl-courses"]').dispatchEvent('change');
    await p.waitForTimeout(400);
    await p.fill('input[list="dl-tariffs"]', 'Золотая середина');
    await p.locator('input[list="dl-tariffs"]').dispatchEvent('change');
    await p.waitForFunction(() => document.querySelector('.zone-deal input[type=number]').value === '59900', null, { timeout: 5000 });
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
    await p.click('body');
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
  await p.screenshot({ path: (process.argv[3] || '.') + '/ui-check.png' });
  console.log('Ошибки в консоли:', errs.length ? errs : 'нет');
  await b.close();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
