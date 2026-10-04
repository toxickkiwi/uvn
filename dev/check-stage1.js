/**
 * Проверка критериев этапа 1 в симуляторе:
 *   node dev/check-stage1.js dev/fixtures/start.json
 */
const assert = require('assert');
const fs = require('fs');
const { create } = require('./gas-sim');

const workbook = JSON.parse(fs.readFileSync(process.argv[2] || 'dev/fixtures/start.json', 'utf8'));
// В стартовой таблице почты пустые — для проверки впишем тестовые.
const users = workbook['Пользователи'];
users[1][0] = 'max@gmail.com';
users[2][0] = 'Marina@Gmail.com ';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓ ' + name);
}

const names = Object.keys(workbook);

test('setupSpreadsheet на стартовой таблице: данные не меняются', () => {
  const sim = create({ workbook, email: 'max@gmail.com' });
  const before = {};
  names.forEach((n) => { before[n] = sim.ss.dump(n); });
  sim.ctx.setupSpreadsheet();
  names.forEach((n) => assert.deepStrictEqual(sim.ss.dump(n), before[n], 'изменился лист ' + n));
  assert.strictEqual(sim.ss.getSheetByName('Сделки').getFrozenRows(), 1);
  assert.ok(sim.ss.getSheetByName('Сделки').validations[13], 'нет списка на «Стадия»');
  assert.ok(sim.ss.getSheetByName('Касания').validations[3], 'нет списка на «Тип»');
  console.log('   ' + sim.state.alerts[0].replace(/\n/g, '\n   '));
});

test('повторный запуск ничего не меняет', () => {
  const sim = create({ workbook });
  sim.ctx.setupSpreadsheet();
  const snap = names.map((n) => sim.ss.dump(n));
  sim.ctx.setupSpreadsheet();
  assert.deepStrictEqual(names.map((n) => sim.ss.dump(n)), snap);
});

test('часовой пояс таблицы ставится на Москву', () => {
  const sim = create({ workbook });
  sim.ss.tz = 'America/Los_Angeles';
  sim.ctx.setupSpreadsheet();
  assert.strictEqual(sim.ss.getSpreadsheetTimeZone(), 'Europe/Moscow');
  assert.ok(/Europe\/Moscow/.test(sim.state.alerts[0]));
});

test('пустая таблица: создаются все листы, справочники и настройки', () => {
  const sim = create({ workbook: { 'Лист1': [] } });
  sim.ctx.setupSpreadsheet();
  ['Клиенты', 'Сделки', 'Касания', 'Тарифы', 'Справочники', 'Шаблоны', 'Пользователи', 'Настройки']
    .forEach((n) => assert.ok(sim.ss.getSheetByName(n), 'нет листа ' + n));
  assert.deepStrictEqual(sim.ss.dump('Сделки')[0].slice(0, 3), ['ID', 'ID клиента', 'Поток']);
  assert.strictEqual(sim.ss.dump('Справочники')[7][2], 'Отказ');
  assert.strictEqual(sim.ss.dump('Настройки').length, 7);
});

test('недостающая колонка дописывается в конец, порядок остальных сохраняется', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  wb['Касания'] = wb['Касания'].map((r) => [r[1], r[0], r[2], r[3]]); // переставили и убрали «Автор»
  const sim = create({ workbook: wb });
  sim.ctx.setupSpreadsheet();
  const h = sim.ss.dump('Касания')[0];
  assert.deepStrictEqual(h, ['Дата', 'ID сделки', 'Тип', 'Текст', 'Автор']);
  assert.strictEqual(sim.ss.dump('Касания')[1][1], 'D001');
});

test('пользователь из списка проходит, почта сравнивается без регистра', () => {
  const sim = create({ workbook, email: 'marina@gmail.com' });
  const page = sim.ctx.doGet({});
  assert.strictEqual(page.name, 'Index');
  const res = sim.ctx.getBootstrap();
  assert.ok(res.ok, JSON.stringify(res));
  assert.strictEqual(res.data.user.role, 'руководитель');
  assert.strictEqual(res.data.dicts.stages.length, 7);
  assert.strictEqual(res.data.tariffs.length, 15);
  assert.strictEqual(res.data.settings.TASK_DEFAULT_TIME, '10:00');
});

test('посторонний видит «Нет доступа» со своей почтой, API отвечает ошибкой', () => {
  const sim = create({ workbook, email: 'stranger@gmail.com' });
  const page = sim.ctx.doGet({});
  assert.strictEqual(page.name, 'NoAccess');
  assert.strictEqual(page.vars.email, 'stranger@gmail.com');
  const res = sim.ctx.getBootstrap();
  assert.strictEqual(res.ok, false);
  assert.ok(/Нет доступа/.test(res.error));
});

test('неактивный пользователь не проходит', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  wb['Пользователи'][1][4] = false;
  const sim = create({ workbook: wb, email: 'max@gmail.com' });
  assert.strictEqual(sim.ctx.doGet({}).name, 'NoAccess');
});

test('нет листа «Пользователи» — понятная ошибка, а не падение', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  delete wb['Пользователи'];
  const sim = create({ workbook: wb, email: 'max@gmail.com' });
  assert.strictEqual(sim.ctx.doGet({}).name, 'NoAccess');
  const res = sim.ctx.getBootstrap();
  assert.ok(/Подготовить таблицу/.test(res.error), res.error);
});

test('Table_: чтение по заголовкам, nextId, update одной строкой', () => {
  const sim = create({ workbook });
  const t = new sim.ctx.Table_('Клиенты');
  assert.strictEqual(t.all().length, 48);
  assert.strictEqual(t.nextId('C'), 'C049');
  const d = new sim.ctx.Table_('Сделки');
  const row = d.find('id', 'D005');
  const writes = d.sheet.writes;
  const upd = d.update(row._row, { stage: 'В диалоге' });
  assert.strictEqual(upd.stage, 'В диалоге');
  assert.strictEqual(upd.potok, 'Неоплаченный заказ');
  assert.strictEqual(d.sheet.writes, writes + 1);
  const added = d.append({ id: d.nextId('D'), clientId: 'C001', stage: 'Новое' });
  assert.strictEqual(added.id, 'D049');
  assert.strictEqual(added._row, 50);
});

console.log(`\nВсе проверки этапа 1 пройдены: ${passed}`);
