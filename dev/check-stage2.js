/**
 * Этап 2: runSelfTests() в симуляторе + проверки API на стартовой таблице.
 *   node dev/check-stage2.js dev/fixtures/start.json
 */
const assert = require('assert');
const fs = require('fs');
const { create } = require('./gas-sim');

const workbook = JSON.parse(fs.readFileSync(process.argv[2] || 'dev/fixtures/start.json', 'utf8'));
workbook['Пользователи'][1][0] = 'max@gmail.com';
workbook['Пользователи'][2][0] = 'marina@gmail.com';

const sim = create({ workbook, email: 'max@gmail.com' });
const res = sim.ctx.runSelfTests();
res.results.forEach((r) => console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.error)));
assert.strictEqual(res.failed, 0, 'самопроверка не прошла');
assert.ok(!sim.ss.getSheets().some((s) => s.getName().startsWith('TEST_')), 'листы TEST_ не удалены');
console.log(`\nrunSelfTests: ${res.passed} из ${res.passed + res.failed}, листы TEST_ удалены\n`);

// Проверки на реальных данных: «сейчас» = 04.10.2026 12:00 МСК
sim.ctx.NOW_OVERRIDE_ = new Date('2026-10-04T09:00:00Z');
const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };

const today = ok(sim.ctx.getToday());
console.log('Сегодня:', { overdue: today.overdue.length, today: today.today.length, fresh: today.fresh.length, counters: today.counters });
assert.ok(today.overdue.length > 0, 'просроченные из старой таблицы видны');

const dups = ok(sim.ctx.findDuplicates({ contact: '@Malinka.Miss' }));
assert.strictEqual(dups.length, 1, 'существующий ник найден');
console.log('Дубль по нику:', dups[0].id, dups[0].name, dups[0].matchedBy, dups[0].deals.map((d) => d.id));

const deal = today.overdue.find((d) => d.stage === 'В диалоге');
const after = ok(sim.ctx.addTouch(deal.id, { type: 'Написал' }));
assert.strictEqual(after.deal.taskAt, new Date('2026-10-05T10:00:00+03:00').toISOString());
console.log('«Написал» на', deal.id, '→ задача', after.deal.nextTask, after.deal.taskAt);

const card = ok(sim.ctx.getDeal('D003'));
assert.strictEqual(card.deal.stage, 'Оплачено');
const created = ok(sim.ctx.createDeal({ client: { name: 'Новая Клиентка', contact: 'https://vk.com/new_client' }, deal: { channel: 'ВК', request: 'Хочу на ЯБ' } }));
assert.ok(/^D049$/.test(created.dealId) && /^C049$/.test(created.clientId), JSON.stringify(created));
const rep = sim.ctx.getReport('2026-09-01', '2026-10-31');
assert.strictEqual(rep.ok, false, 'менеджеру отчёт не отдаётся');
console.log('\nВсе проверки этапа 2 пройдены');
