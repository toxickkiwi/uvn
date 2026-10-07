/**
 * Перенос из таблицы Максима на стартовой таблице в симуляторе.
 *   node dev/check-import.js <таблица_Максима.xlsx> [dev/fixtures/start.json] [путь к xlsx.full.min.js]
 * Файл с данными клиентов в репозиторий не кладётся.
 * Разбор книги — та же функция parseLegacyWorkbook, что на сайте (вырезается из App.html).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { create } = require('./gas-sim');

const [xlsxPath, fixture = 'dev/fixtures/start.json', libPath] = process.argv.slice(2);
const XLSX = require(libPath ? path.resolve(libPath) : 'xlsx');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.html'), 'utf8');
const src = /\/\* LEGACY-PARSER-START \*\/([\s\S]*?)\/\* LEGACY-PARSER-END \*\//.exec(app)[1];
const parseLegacyWorkbook = new Function(src + '; return parseLegacyWorkbook;')();

const parsed = parseLegacyWorkbook(XLSX, XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer', cellStyles: true }));
console.log('Лист обращений:', parsed.dealsSheet, parsed.deals.length, 'строк; рассылки:', parsed.tasks.map((t) => `${t.sheet} (${t.people.length}, вариантов ${t.templates.length})`).join(', '));

const workbook = JSON.parse(fs.readFileSync(fixture, 'utf8'));
workbook['Пользователи'][1][0] = 'max@gmail.com';
workbook['Пользователи'][2][0] = 'marina@gmail.com';
const sim = create({ workbook, email: 'max@gmail.com' });
sim.ctx.setupSpreadsheet();
sim.ctx.NOW_OVERRIDE_ = new Date('2026-10-07T09:00:00Z');
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
// Как через google.script.run: аргументы проходят через JSON.
const j = (x) => JSON.parse(JSON.stringify(x));

const plan = ok(sim.ctx.previewLegacyDeals(j(parsed.deals), parsed.dealsSheet)).items;
plan.forEach((it) => console.log(`${String(it.row).padStart(3)} ${it.kind.padEnd(6)} ${(it.dealId || '').padEnd(5)} ${it.name.slice(0, 28).padEnd(28)} ${it.changes.join(' | ')}${it.warn ? '  ⚠ ' + it.warn : ''}`));
const pick = plan.filter((it) => it.checked).map((it) => it.row);
const done = ok(sim.ctx.applyLegacyDeals(j(parsed.deals), parsed.dealsSheet, pick));
console.log('Перенесено:', done);
assert.strictEqual(done.failed.length, 0, 'ошибки переноса');
const again = ok(sim.ctx.previewLegacyDeals(j(parsed.deals), parsed.dealsSheet)).items;
const left = again.filter((it) => it.kind === 'new' || it.kind === 'update');
assert.strictEqual(left.length, 0, 'повторный перенос не должен ничего менять: ' + JSON.stringify(left.slice(0, 3)));
console.log('✓ повторный просмотр: изменений нет');

parsed.tasks.forEach((t) => {
  const input = { name: t.sheet, segment: 'Все', templates: t.templates, people: t.people };
  const pv = ok(sim.ctx.importLegacyTask(j(input), false));
  console.log('Задание', pv);
  const ap = ok(sim.ctx.importLegacyTask(j(input), true));
  const pv2 = ok(sim.ctx.importLegacyTask(j(input), false));
  assert.ok(!pv2.isNew && pv2.add === 0 && pv2.update === 0 && pv2.templatesNew === 0, 'повтор задания без изменений: ' + JSON.stringify(pv2));
  const task = ok(sim.ctx.getTask(ap.taskId));
  console.log('  статистика:', JSON.stringify({ total: task.stats.total, sent: task.stats.sent, answered: task.stats.answered, removed: task.stats.removed }),
    'по шаблонам:', JSON.stringify(Object.fromEntries(Object.entries(task.stats.byTemplate).map(([k, v]) => [k, v.sent + '/' + v.answered]))));
});
const today = ok(sim.ctx.getToday());
console.log('Сегодня после переноса:', { overdue: today.overdue.length, today: today.today.length, fresh: today.fresh.length, monthCreated: today.counters.monthCreated, monthPaid: today.counters.monthPaid });
console.log('\nПеренос проверен');
