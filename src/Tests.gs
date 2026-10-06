/**
 * Tests.gs — самопроверка бизнес-правил (ТЗ, раздел 8, этап 2).
 *
 * runSelfTests() создаёт временные листы с префиксом TEST_, гоняет на них правила
 * и API, затем удаляет листы. Рабочие данные не читаются и не меняются.
 */

var TEST_PREFIX = 'TEST_';
var TEST_USER = { email: 'test.manager@example.com', name: 'Тест Менеджер', role: 'менеджер', active: true };
var TEST_BOSS = { email: 'test.boss@example.com', name: 'Тест Руководитель', role: 'руководитель', active: true };
/** Понедельник 05.10.2026, 12:00 по Москве. */
var TEST_NOW = new Date('2026-10-05T09:00:00Z');

function runSelfTests() {
  var results = [];
  var ss = SpreadsheetApp.getActive();
  removeTestSheets_(ss);
  try {
    createTestSheets_(ss);
    TABLE_PREFIX_ = TEST_PREFIX;
    REF_MEMO_ = null;
    NOW_OVERRIDE_ = TEST_NOW;
    selfTestCases_().forEach(function (tc) {
      try {
        tc[1]();
        results.push({ name: tc[0], ok: true });
      } catch (e) {
        results.push({ name: tc[0], ok: false, error: e.userMessage || e.message || String(e) });
      }
    });
  } finally {
    TABLE_PREFIX_ = '';
    REF_MEMO_ = null;
    NOW_OVERRIDE_ = null;
    removeTestSheets_(ss);
  }

  var failed = results.filter(function (r) { return !r.ok; });
  var lines = results.map(function (r) { return (r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.error); });
  console.log(lines.join('\n'));
  var msg = failed.length
    ? 'Самопроверка: ошибок ' + failed.length + ' из ' + results.length + '.\n\n' +
      failed.map(function (r) { return '✗ ' + r.name + ' — ' + r.error; }).join('\n')
    : 'Самопроверка пройдена: ' + results.length + ' из ' + results.length + ' проверок.';
  notify_(msg);
  return { passed: results.length - failed.length, failed: failed.length, results: results };
}

function removeTestSheets_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (sh.getName().indexOf(TEST_PREFIX) === 0) ss.deleteSheet(sh);
  });
}

function createTestSheets_(ss) {
  var put = function (name, rows) {
    var sh = ss.insertSheet(TEST_PREFIX + name);
    var width = rows[0].length;
    sh.getRange(1, 1, rows.length, width).setValues(rows.map(function (r) {
      var line = r.slice();
      while (line.length < width) line.push('');
      return line;
    }));
  };
  put(SHEET.CLIENTS, [values_(SCHEMA[SHEET.CLIENTS])]);
  put(SHEET.DEALS, [values_(SCHEMA[SHEET.DEALS])]);
  put(SHEET.TOUCHES, [values_(SCHEMA[SHEET.TOUCHES])]);

  var dictHeaders = values_(SCHEMA[SHEET.DICTS]);
  var maxLen = Math.max.apply(null, dictHeaders.map(function (h) { return DEFAULT_DICTS[h].length; }));
  var dictRows = [dictHeaders];
  for (var i = 0; i < maxLen; i++) dictRows.push(dictHeaders.map(function (h) { return DEFAULT_DICTS[h][i] || ''; }));
  put(SHEET.DICTS, dictRows);

  put(SHEET.TARIFFS, [values_(SCHEMA[SHEET.TARIFFS]),
    ['ЯБ', 'Золотая середина', 89900, true],
    ['УСН', 'Необходимый минимум', 29900, true],
    ['УСН', 'Старый', 1000, false]]);
  put(SHEET.TEMPLATES, [values_(SCHEMA[SHEET.TEMPLATES]),
    ['T001', 'Оплата', 'Оплата поступила', '{Имя}, оплата {Сумма} за «{Курс}» поступила. {Менеджер}', true]]);
  put(SHEET.USERS, [values_(SCHEMA[SHEET.USERS]),
    [TEST_USER.email, TEST_USER.name, TEST_USER.role, '', true],
    [TEST_BOSS.email, TEST_BOSS.name, TEST_BOSS.role, '', true]]);
  put(SHEET.TASKS, [values_(SCHEMA[SHEET.TASKS])]);
  put(SHEET.PEOPLE, [values_(SCHEMA[SHEET.PEOPLE])]);
  var settings = [values_(SCHEMA[SHEET.SETTINGS])];
  DEFAULT_SETTINGS.forEach(function (s) { settings.push([s.key, s.value]); });
  put(SHEET.SETTINGS, settings);
}

/* ---------- Проверки ---------- */

function assertEq_(actual, expected, what) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a !== e) throw new Error((what ? what + ': ' : '') + 'ожидалось ' + e + ', получено ' + a);
}

function assertThrows_(fn, field, what) {
  try {
    fn();
  } catch (e) {
    if (!e.userMessage) throw e;
    if (field && e.field !== field) throw new Error((what || '') + ': ошибка не по тому полю: ' + e.field + ' (' + e.userMessage + ')');
    return e;
  }
  throw new Error((what || 'ожидалась ошибка') + ': сохранение прошло, а не должно было');
}

function mskIso_(s) {
  return new Date(s + '+03:00').toISOString();
}

/** Создаёт сделку через API-логику и возвращает её карточку. */
function testDeal_(potok, contact, extra) {
  var deal = { potok: potok, channel: 'ВК', request: 'Тестовый запрос' };
  for (var k in (extra || {})) deal[k] = extra[k];
  var res = svcCreateDeal_(TEST_USER, { client: { name: 'Тест', contact: contact }, deal: deal, force: true });
  return svcGetDeal_(TEST_USER, res.dealId);
}

function selfTestCases_() {
  var u = TEST_USER;
  return [
    ['Нормализация ника', function () {
      assertEq_(normNick_(' @Ivan.Petrov '), 'ivan.petrov');
      assertEq_(normNick_('https://www.instagram.com/Ivan_P/?igsh=abc'), 'ivan_p');
      assertEq_(normNick_('instagram.com/maria.s/'), 'maria.s');
    }],
    ['Нормализация телефона: 8…, +7…, 10 цифр', function () {
      assertEq_(normPhone_('8 (916) 123-45-67'), '79161234567', '8…');
      assertEq_(normPhone_('+7 916 123 45 67'), '79161234567', '+7…');
      assertEq_(normPhone_('916-123-45-67'), '79161234567', '10 цифр');
    }],
    ['Нормализация почты', function () {
      assertEq_(normalizeClient_({ email: '  Ivan@Mail.RU ' }).email, 'ivan@mail.ru');
    }],
    ['ID GetCourse из ссылки на профиль', function () {
      var c = normalizeClient_({ dialogUrl: 'https://uvnschool.ru/user/control/user/update/id/481550966' });
      assertEq_(c.gcId, '481550966');
    }],
    ['Определение типа контакта', function () {
      assertEq_(detectContact_('@Lena.Buh').field, 'nick');
      assertEq_(detectContact_('https://vk.com/id123').field, 'dialogUrl');
      assertEq_(detectContact_('lena@mail.ru').field, 'email');
      assertEq_(detectContact_('+7 (916) 123-45-67').field, 'phone');
      assertEq_(detectContact_('481550966').field, 'gcId');
    }],
    ['Клиент без контакта не сохраняется', function () {
      assertThrows_(function () {
        svcCreateDeal_(u, { client: { name: 'Без контакта' }, deal: { channel: 'ВК', request: 'x' } });
      }, 'contact');
    }],
    ['Дубли по каждому из пяти полей', function () {
      svcCreateDeal_(u, {
        client: { name: 'Анна', nick: 'anna.buh', dialogUrl: 'https://vk.com/anna_buh', gcId: '111222333', email: 'anna@mail.ru', phone: '79001112233' },
        deal: { channel: 'ВК', request: 'дубли' }
      });
      var cases = {
        nick: { nick: '@Anna.Buh' },
        dialogUrl: { dialogUrl: 'http://vk.com/anna_buh/' },
        gcId: { gcId: '111222333' },
        email: { email: 'ANNA@mail.ru ' },
        phone: { phone: '8 900 111-22-33' }
      };
      Object.keys(cases).forEach(function (f) {
        var found = svcFindDuplicates_(u, cases[f]);
        assertEq_(found.length, 1, 'дубль по ' + f);
        assertEq_(found[0].name, 'Анна', 'дубль по ' + f);
      });
      assertEq_(svcFindDuplicates_(u, { name: 'Анна', nick: 'другая' }).length, 0, 'совпадение только по имени');
    }],
    ['Создание с дублем: без force — список похожих, с force — новый клиент', function () {
      var draft = { name: 'Анна 2', contact: '@anna.buh' };
      var res = svcCreateDeal_(u, { client: draft, deal: { channel: 'ВК', request: 'x' } });
      assertEq_(res.duplicates.length, 1, 'найден дубль');
      var forced = svcCreateDeal_(u, { client: draft, deal: { channel: 'ВК', request: 'x' }, force: true });
      if (!forced.dealId) throw new Error('сделка не создана');
    }],
    ['Задачи по умолчанию и начальная стадия по потоку', function () {
      var a = testDeal_('Входящее', '@t.in').deal;
      assertEq_([a.stage, a.nextTask, a.taskAt], ['Новое', 'Ответить клиенту', TEST_NOW.toISOString()], 'Входящее');
      var b = testDeal_('Неоплаченный заказ', '@t.unpaid').deal;
      assertEq_([b.stage, b.nextTask, b.taskAt], ['Заказ создан', 'Написать по заказу', mskIso_('2026-10-05T12:10:00')], 'Неоплаченный заказ');
      var c = testDeal_('Исходящее', '@t.react').deal;
      assertEq_([c.stage, c.nextTask, c.taskAt], ['В диалоге', 'Написать повторно', mskIso_('2026-10-06T10:00:00')], 'Исходящее');
    }],
    ['При создании пишется касание «Обращение»', function () {
      var card = testDeal_('Входящее', '@t.lead');
      assertEq_([card.touches.length, card.touches[0].type, card.touches[0].text], [1, 'Обращение', 'Тестовый запрос']);
    }],
    ['Сумма подставляется из тарифа', function () {
      var d = testDeal_('Входящее', '@t.tariff', { course: 'ЯБ', tariff: 'Золотая середина' }).deal;
      assertEq_(d.amount, 89900);
      var upd = svcUpdateDeal_(u, d.id, { course: 'УСН', tariff: 'Необходимый минимум' }).deal;
      assertEq_(upd.amount, 29900, 'после смены тарифа');
      var manual = svcUpdateDeal_(u, d.id, { amount: 25000 }).deal;
      assertEq_(manual.amount, 25000, 'ручная сумма');
    }],
    ['«Оплачено»: нужны сумма и способ оплаты; задача и причина очищаются', function () {
      var d = testDeal_('Входящее', '@t.paid').deal;
      assertThrows_(function () { svcUpdateDeal_(u, d.id, { stage: 'Оплачено', payMethod: 'Полная' }); }, 'amount');
      assertThrows_(function () { svcUpdateDeal_(u, d.id, { stage: 'Оплачено', amount: 89900 }); }, 'payMethod');
      var res = svcUpdateDeal_(u, d.id, { stage: 'Оплачено', amount: 89900, payMethod: 'Полная' });
      assertEq_([res.deal.nextTask, res.deal.taskAt, res.deal.lostReason], ['', '', '']);
      assertEq_(res.deal.paidAt, mskIso_('2026-10-05T00:00:00'), 'дата оплаты по умолчанию — сегодня');
      assertEq_(res.newTouches[0].text, 'Новое → Оплачено, 89 900 ₽', 'касание «Смена стадии»');
    }],
    ['«Отказ»: нужна причина; задача очищается', function () {
      var d = testDeal_('Входящее', '@t.lost').deal;
      assertThrows_(function () { svcUpdateDeal_(u, d.id, { stage: 'Отказ' }); }, 'lostReason');
      var res = svcUpdateDeal_(u, d.id, { stage: 'Отказ', lostReason: 'Нет денег' });
      assertEq_([res.deal.nextTask, res.deal.taskAt], ['', '']);
      assertEq_(res.newTouches[0].text, 'Новое → Отказ: Нет денег');
    }],
    ['«Отложено»: дата задачи не раньше завтра', function () {
      var d = testDeal_('Входящее', '@t.later').deal;
      assertThrows_(function () { svcUpdateDeal_(u, d.id, { stage: 'Отложено', taskAt: '2026-10-05' }); }, 'taskAt');
      var res = svcUpdateDeal_(u, d.id, { stage: 'Отложено', taskAt: '2026-10-07' });
      assertEq_(res.deal.taskAt, mskIso_('2026-10-07T10:00:00'), 'время по умолчанию');
    }],
    ['Открытые стадии: без даты задачи не сохраняется', function () {
      var d = testDeal_('Входящее', '@t.open').deal;
      ['Новое', 'В диалоге', 'Курс подобран', 'Заказ создан'].forEach(function (st) {
        assertThrows_(function () { svcUpdateDeal_(u, d.id, { stage: st, taskAt: '' }); }, 'taskAt', st);
      });
    }],
    ['Повторное открытие закрытой сделки', function () {
      var d = testDeal_('Входящее', '@t.reopen').deal;
      svcUpdateDeal_(u, d.id, { stage: 'Отказ', lostReason: 'Другое' });
      var res = svcUpdateDeal_(u, d.id, { stage: 'В диалоге', taskAt: '2026-10-06', nextTask: 'Вернуться' });
      assertEq_(res.deal.stage, 'В диалоге');
    }],
    ['Касание «Написал»: «Новое» → «В диалоге» и задача «Написать повторно»', function () {
      var d = testDeal_('Входящее', '@t.wrote').deal;
      var res = svcAddTouch_(u, d.id, { type: 'Написал', text: '' });
      assertEq_([res.deal.stage, res.deal.nextTask, res.deal.taskAt],
        ['В диалоге', 'Написать повторно', mskIso_('2026-10-06T10:00:00')]);
      var card = svcGetDeal_(u, d.id);
      var types = card.touches.map(function (t) { return t.type; }).sort();
      assertEq_(types, ['Написал', 'Обращение', 'Смена стадии'].sort(), 'журнал');
      var stageTouch = card.touches.filter(function (t) { return t.type === 'Смена стадии'; })[0];
      assertEq_(stageTouch.text, 'Новое → В диалоге');
    }],
    ['Касание со своей задачей не перезаписывается задачей по умолчанию', function () {
      var d = testDeal_('Исходящее', '@t.own').deal;
      var res = svcAddTouch_(u, d.id, { type: 'Написал', nextTask: 'Позвонить после отпуска', nextTaskDate: '2026-10-20' });
      assertEq_([res.deal.nextTask, res.deal.taskAt], ['Позвонить после отпуска', mskIso_('2026-10-20T10:00:00')]);
    }],
    ['Заметка не меняет задачу', function () {
      var d = testDeal_('Исходящее', '@t.note').deal;
      var res = svcAddTouch_(u, d.id, { type: 'Заметка менеджера', text: 'Думает' });
      assertEq_(res.deal.taskAt, d.taskAt);
    }],
    ['Подстановка переменных шаблона', function () {
      var vars = templateVars_({ course: 'ЯБ', tariff: '', amount: 89900 }, { name: 'Ирина' }, u);
      var r = fillTemplate_('{Имя}, «{Курс}» {Тариф}за {Сумма}. {Менеджер}', vars);
      assertEq_(r.text, 'Ирина, «ЯБ» за 89 900 ₽. Тест Менеджер');
      assertEq_(r.missing, ['Тариф']);
    }],
    ['Копирование шаблона пишет касание «Шаблон»', function () {
      var d = testDeal_('Входящее', '@t.tpl').deal;
      var res = svcLogTemplateUse_(u, d.id, 'T001');
      assertEq_([res.touch.type, res.touch.text], ['Шаблон', 'Шаблон: Оплата поступила']);
      assertEq_(res.deal.stage, 'В диалоге');
    }],
    ['Правка клиента: дубль с другим клиентом и удаление последнего контакта', function () {
      var a = svcCreateDeal_(u, { client: { name: 'Ольга', nick: 'olga.one' }, deal: { channel: 'ВК', request: 'x' }, force: true });
      svcCreateDeal_(u, { client: { name: 'Олег', nick: 'oleg.two' }, deal: { channel: 'ВК', request: 'x' }, force: true });
      assertThrows_(function () { svcUpdateClient_(u, a.clientId, { nick: '@Oleg.Two' }); }, 'nick', 'дубль');
      assertEq_(svcUpdateClient_(u, a.clientId, { nick: '@Olga.One', phone: '89001234567' }).phone, '79001234567', 'свой же ник не дубль');
      svcUpdateClient_(u, a.clientId, { phone: '' });
      assertThrows_(function () { svcUpdateClient_(u, a.clientId, { nick: '' }); }, 'nick', 'последний контакт');
    }],
    ['Формулы отчёта на тестовом наборе', function () {
      var d = function (s) { return new Date(s + 'T12:00:00+03:00'); };
      var deals = [
        { createdAt: d('2026-09-01'), channel: 'ВК', potok: 'Входящее', stage: 'Оплачено', paidAt: d('2026-09-10'), amount: 50000, course: 'ЯБ' },
        { createdAt: d('2026-09-15'), channel: 'ВК', potok: 'Входящее', stage: 'Отказ', lostReason: 'Нет денег' },
        { createdAt: d('2026-09-20'), channel: 'Инстаграм', potok: 'Исходящее', stage: 'В диалоге' },
        { createdAt: d('2026-09-30'), channel: 'Инстаграм', potok: 'Входящее', stage: 'Оплачено', paidAt: d('2026-10-02'), amount: 30000, course: 'УСН' },
        { createdAt: d('2026-08-25'), channel: 'Почта', potok: 'Входящее', stage: 'Оплачено', paidAt: d('2026-09-05'), amount: 20000, course: 'УСН' }
      ];
      var r = computeReport_(deals, parseTaskDate_('2026-09-01', '00:00'), mskDayStart_(parseTaskDate_('2026-09-30', '00:00'), 1));
      assertEq_(r.leads, 4, 'обращения');
      assertEq_(r.byChannel, { 'ВК': 2, 'Инстаграм': 2 }, 'по каналам');
      assertEq_(r.byPotok, { 'Входящее': 3, 'Исходящее': 1 }, 'по потокам');
      assertEq_(r.paidFromLeads, 2, 'оплачено из обращений');
      assertEq_(r.conversion, 0.5, 'конверсия');
      assertEq_(r.revenue, 70000, 'выручка по дате оплаты');
      assertEq_(r.byCourse, { 'ЯБ': { count: 1, revenue: 50000 }, 'УСН': { count: 1, revenue: 20000 } }, 'по курсам');
      assertEq_(r.lostReasons, { 'Нет денег': 1 }, 'причины отказов');
      assertEq_(r.funnel, { 'Оплачено': 2, 'Отказ': 1, 'В диалоге': 1 }, 'стадии');
      var empty = computeReport_([], parseTaskDate_('2026-09-01', '00:00'), parseTaskDate_('2026-09-02', '00:00'));
      assertEq_(empty.conversion, 0, 'нет обращений — конверсия 0');
    }],
    ['Отчёт доступен и менеджеру, и руководителю', function () {
      svcGetReport_(TEST_USER, '2026-09-01', '2026-09-30');
      svcGetReport_(TEST_BOSS, '2026-09-01', '2026-09-30');
    }],
    ['Отчёт: новые и повторные обращения, «был контакт», активные диалоги по каналам', function () {
      var d = function (s) { return new Date(s + 'T12:00:00+03:00'); };
      var deals = [
        { id: 'D1', clientId: 'C1', createdAt: d('2026-08-20'), channel: 'ВК', potok: 'Входящее', stage: 'Отказ' },
        { id: 'D2', clientId: 'C1', createdAt: d('2026-10-02'), channel: 'ВК', potok: 'Входящее', stage: 'В диалоге' },
        { id: 'D3', clientId: 'C2', createdAt: d('2026-10-03'), channel: 'Макс', potok: 'Исходящее', stage: 'В диалоге' },
        { id: 'D4', clientId: 'C3', createdAt: d('2026-10-04'), channel: 'ВК', potok: 'Входящее', stage: 'Новое', priorContact: 'Да' },
        { id: 'D5', clientId: 'C4', createdAt: d('2026-10-05'), channel: 'Инстаграм', potok: 'Входящее', stage: 'Новое', priorContact: 'Нет' }
      ];
      var touches = [
        { dealId: 'D1', date: d('2026-10-01'), type: 'Написал', channel: 'ВК' },
        { dealId: 'D1', date: d('2026-10-02'), type: 'Клиент ответил', channel: 'Макс' },
        { dealId: 'D3', date: d('2026-10-03'), type: 'Написал', channel: '' },
        { dealId: 'D3', date: d('2026-10-03'), type: 'Смена стадии', channel: '' },
        { dealId: 'D5', date: d('2026-09-30'), type: 'Написал', channel: 'Инстаграм' }
      ];
      var r = computeReport_(deals, parseTaskDate_('2026-10-01', '00:00'), parseTaskDate_('2026-11-01', '00:00'), touches);
      assertEq_([r.leads, r.newLeads, r.repeatLeads], [4, 2, 2], 'обращения: всего, новые, повторные');
      assertEq_(r.newByPotok, { 'Исходящее': 1, 'Входящее': 1 }, 'новые по потокам');
      assertEq_(r.priorContact, { 'Да': 1, 'Нет': 1, 'Не отмечено': 2 }, 'был контакт');
      assertEq_(r.activeDialogs, 2, 'активные диалоги');
      assertEq_(r.activeByChannel, { 'ВК': 1, 'Макс': 2 }, 'диалоги по каналам');
    }],
    ['Старая переписка задним числом: без смены стадии и авто-задачи, со своим каналом', function () {
      var d = testDeal_('Входящее', '@t.old').deal;
      var res = svcAddTouch_(u, d.id, { type: 'Написал', text: 'Писала в августе', date: '2026-08-15', channel: 'ВК' });
      assertEq_([res.deal.stage, res.deal.taskAt], ['Новое', d.taskAt], 'сделка не изменилась');
      assertEq_([res.touch.channel, res.touch.date], ['ВК', mskIso_('2026-08-15T12:00:00')], 'канал и дата касания');
      assertThrows_(function () { svcAddTouch_(u, d.id, { type: 'Написал', date: '2026-12-01' }); }, 'date', 'будущая дата');
      var now = svcAddTouch_(u, d.id, { type: 'Написал' });
      assertEq_([now.touch.channel, now.deal.stage], ['ВК', 'В диалоге'], 'по умолчанию канал сделки');
    }],
    ['«Был контакт»: вручную и автоматически для клиента из CRM', function () {
      var a = svcCreateDeal_(u, { client: { name: 'Нина', nick: 'nina.prior' }, deal: { channel: 'Макс', request: 'x', priorContact: 'Да', priorWhere: 'ВК', priorWhen: '2026-05-10', priorNote: 'Спрашивала про ЯБ весной' } });
      var da = svcGetDeal_(u, a.dealId).deal;
      assertEq_([da.priorContact, da.priorWhere, da.priorWhen, da.priorNote], ['Да', 'ВК', mskIso_('2026-05-10T00:00:00'), 'Спрашивала про ЯБ весной']);
      var b = svcCreateDeal_(u, { clientId: a.clientId, deal: { channel: 'ВК', request: 'снова' } });
      var db = svcGetDeal_(u, b.dealId).deal;
      assertEq_([db.priorContact, db.priorWhere], ['Да', 'Макс'], 'из прошлой сделки');
      var c = svcCreateDeal_(u, { client: { name: 'Новенькая', nick: 'nina.new' }, deal: { channel: 'ВК', request: 'x', priorContact: 'Нет', priorWhere: 'ВК' } });
      assertEq_(svcGetDeal_(u, c.dealId).deal.priorWhere, '', '«Нет» — без «где»');
    }],
    ['Другие ссылки клиента участвуют в поиске дублей', function () {
      var a = svcCreateDeal_(u, { client: { name: 'Вика', nick: 'vika.links' }, deal: { channel: 'ВК', request: 'x' }, force: true });
      svcUpdateClient_(u, a.clientId, { otherLinks: 'https://vk.com/vika_l\nhttps://t.me/vika_l' });
      var found = svcFindDuplicates_(u, { contact: 'https://t.me/vika_l/' });
      assertEq_(found.length, 1, 'нашли по второй ссылке');
    }],
    ['Доска: открытые по колонкам, закрытые за период', function () {
      var b = svcGetBoard_(u, {});
      if (!b.open.length) throw new Error('нет открытых сделок');
      if (b.open.some(function (d) { return d.stage === 'Оплачено' || d.stage === 'Отказ'; })) throw new Error('закрытые попали в открытые');
      if (!b.paid.length || !b.lost.length) throw new Error('нет оплаченных или отказов за месяц: ' + b.paid.length + '/' + b.lost.length);
    }],
    ['Цвет строки: оплачено — зелёный, перспектива — жёлтый, иначе белый', function () {
      assertEq_(dealColor_({ stage: 'Оплачено', prospect: false }), 'green', 'оплачено');
      assertEq_(dealColor_({ stage: 'В диалоге', prospect: true }), 'yellow', 'перспектива');
      assertEq_(dealColor_({ stage: 'Отказ', prospect: true }), 'white', 'отказ');
      assertEq_(dealColor_({ stage: 'Новое', prospect: '' }), 'white', 'без перспектив');
      var d = testDeal_('Входящее', '@t.color', { prospect: true }).deal;
      assertEq_([d.prospect, d.color], [true, 'yellow'], 'новое обращение с перспективой');
      var upd = svcUpdateDeal_(u, d.id, { prospect: false }).deal;
      assertEq_([upd.prospect, upd.color], [false, 'white'], 'снята перспектива');
    }],
    ['Поток «Исходящее»: стадия «В диалоге», задача «Написать повторно» завтра', function () {
      var d = testDeal_('Исходящее', '@t.out').deal;
      assertEq_([d.potok, d.stage, d.nextTask], ['Исходящее', 'В диалоге', 'Написать повторно']);
    }],
    ['Задания: задание и подзадание, загрузка списка, повторы и связь с CRM', function () {
      var parent = svcSaveTask_(u, { name: 'Отработка БК, октябрь', start: '2026-10-05', end: '2026-10-18' });
      var sub = svcSaveTask_(u, { name: 'Были на эфирах', parentId: parent.id, start: '2026-10-05', end: '2026-10-11', segments: ['Был на всех'] });
      assertEq_([sub.parentId, sub.segments], [parent.id, ['Был на всех']], 'подзадание');
      assertThrows_(function () { svcSaveTask_(u, { name: 'x', start: '2026-10-10', end: '2026-10-01' }); }, 'end', 'конец раньше начала');
      svcCreateDeal_(u, { client: { name: 'Полина', email: 'polina@mail.ru' }, deal: { channel: 'ВК', request: 'x', priorContact: 'Нет' } });
      var res = svcImportPeople_(u, sub.id, 'Был на всех', [
        { firstName: 'Полина', lastName: 'М', email: 'Polina@mail.ru', phone: '+79170000001', gcId: '111', vk: '2144', source: 'instagram' },
        { firstName: 'Айсылу', email: 'ai@mail.ru', phone: '89170000002', gcId: '222' },
        { firstName: 'Айсылу повтор', gcId: '222' },
        { firstName: '', lastName: '' }
      ]);
      assertEq_([res.added, res.skipped, res.linked], [2, 2, 1], 'загружено / пропущено / найдено в CRM');
      var t = svcGetTask_(u, sub.id);
      var pol = t.people.filter(function (p) { return p.firstName === 'Полина'; })[0];
      assertEq_([pol.phone, pol.vk, pol.status, !!pol.clientId], ['79170000001', 'https://vk.com/id2144', 'Не написали', true], 'нормализация и связь');
      var again = svcImportPeople_(u, sub.id, 'Был на всех', [{ firstName: 'Айсылу', phone: '+7 917 000-00-02' }]);
      assertEq_(again.added, 0, 'повторная загрузка не дублирует');
    }],
    ['Задания: шаблон, «написали», «ответил» → сделка, статистика по шаблонам', function () {
      var task = svcListTasks_(u).filter(function (x) { return x.name === 'Были на эфирах'; })[0];
      var tpl = svcSaveTaskTemplate_(u, { taskId: task.id, segment: 'Был на всех', title: 'Вариант 1', text: '{Имя}, добрый день!' });
      assertEq_([tpl.taskId, tpl.situation], [task.id, 'Были на эфирах'], 'шаблон привязан к заданию');
      var people = svcGetTask_(u, task.id).people;
      assertEq_(svcGetTask_(u, task.id).templates.length, 1, 'шаблон виден в задании');
      var a = svcMarkPersonSent_(u, people[0].id, tpl.id, 'Инстаграм');
      assertEq_([a.status, a.templateId, a.channel], ['Написали', tpl.id, 'Инстаграм'], 'отметка отправки');
      svcMarkPersonSent_(u, people[1].id, tpl.id, 'ВК');
      var b = svcSetPersonStatus_(u, people[0].id, 'Ответил');
      if (!b.dealId) throw new Error('сделка не создана');
      var card = svcGetDeal_(u, b.dealId);
      assertEq_([card.deal.potok, card.deal.channel], ['Исходящее', 'Инстаграм'], 'сделка из задания');
      var types = card.touches.map(function (x) { return x.type; });
      if (types.indexOf('Шаблон') < 0 || types.indexOf('Клиент ответил') < 0) throw new Error('история: ' + types.join(', '));
      svcSetPersonStatus_(u, people[1].id, 'Не интересно', 'Уже учится');
      var st = svcGetTask_(u, task.id).stats;
      assertEq_([st.total, st.sent, st.answered, st.replied, st.no], [2, 2, 2, 1, 1], 'итоги');
      assertEq_([st.byTemplate[tpl.id].sent, st.byTemplate[tpl.id].answered], [2, 2], 'по шаблону');
      var parent = svcListTasks_(u).filter(function (x) { return x.id === task.parentId; })[0];
      assertEq_(parent.totalStats.total, 2, 'родитель суммирует подзадания');
    }],
    ['«Сегодня»: просрочено, на сегодня, без ответа, счётчики', function () {
      var t = svcGetToday_(u);
      if (!t.fresh.length) throw new Error('нет блока «Без ответа»');
      if (!t.today.length) throw new Error('нет задач на сегодня');
      if (t.counters.created < 5) throw new Error('счётчик обращений: ' + t.counters.created);
      if (t.counters.paid !== 1) throw new Error('счётчик оплат: ' + t.counters.paid);
      assertEq_([t.counters.monthPaid, t.counters.monthPaidSum], [1, 89900], 'оплачено за месяц');
    }]
  ];
}
