/**
 * Api.gs — функции для google.script.run (ТЗ, раздел 5).
 * Каждая возвращает { ok: true, data } или { ok: false, error, field? }.
 *
 * Публичные функции — тонкие обёртки: проверка доступа в api_(), сама логика — в svc*_().
 * runSelfTests() вызывает svc*_() напрямую на временных листах TEST_.
 */

function getBootstrap() {
  return api_(function (user) { return bootstrapData_(user); });
}

/** Первая загрузка сайта одним запросом: настройки + экран «Сегодня». */
function getStart() {
  return api_(function (user) { return { boot: bootstrapData_(user), today: svcGetToday_(user) }; });
}

function bootstrapData_(user) {
    var ref = getRef_();
    return {
      user: { email: user.email, name: user.name, role: user.role, readOnly: isReadOnly_(user) },
      dicts: ref.dicts,
      tariffs: ref.tariffs.filter(function (t) { return t.active; }),
      // Курсы — из всех строк «Тарифы»: курс остаётся в списке, даже если все его тарифы выключены.
      courses: ref.tariffs.map(function (t) { return t.course; })
        .filter(function (c, i, a) { return c && a.indexOf(c) === i; }),
      templates: ref.templates.filter(function (t) { return t.active; }),
      settings: ref.settings,
      appUrl: ScriptApp.getService().getUrl() || '',
      now: now_().toISOString()
    };
}

function getToday() { return api_(function (user) { return svcGetToday_(user); }); }
function listDeals(filter) { return api_(function (user) { return svcListDeals_(user, filter || {}); }); }
function getDeal(id) { return api_(function (user) { return svcGetDeal_(user, id); }); }
function getDeals(ids) { return api_(function (user) { return svcGetDeals_(user, ids || []); }); }
function findDuplicates(client) { return api_(function (user) { return svcFindDuplicates_(user, client || {}); }); }
function createDeal(payload) { return api_(function (user) { return svcCreateDeal_(user, payload || {}); }); }
function updateDeal(id, patch) { return api_(function (user) { return svcUpdateDeal_(user, id, patch || {}); }); }
function updateClient(id, patch) { return api_(function (user) { return svcUpdateClient_(user, id, patch || {}); }); }
function addTouch(dealId, touch) { return api_(function (user) { return svcAddTouch_(user, dealId, touch || {}); }); }
function logTemplateUse(dealId, templateId) { return api_(function (user) { return svcLogTemplateUse_(user, dealId, templateId); }); }
function markChecked(kind, id) { return api_(function (user) { return svcMarkChecked_(user, kind, id); }); }
function getReport(from, to) { return api_(function (user) { return svcGetReport_(user, from, to); }); }
function getBoard(filter) { return api_(function (user) { return svcGetBoard_(user, filter || {}); }); }
function getCalendar(month) { return api_(function (user) { return svcGetCalendar_(user, month); }); }
function getCalendarDay(day) { return api_(function (user) { return svcGetCalendarDay_(user, day); }); }

/* ---------- Представление данных для клиента ---------- */

function indexBy_(rows, field) {
  var map = {};
  rows.forEach(function (r) { map[String(r[field])] = r; });
  return map;
}

/** Сводка по касаниям: последнее касание и было ли что-то, кроме «Обращение». */
function touchStats_(touches) {
  var stats = {};
  touches.forEach(function (t) {
    var id = String(t.dealId);
    var s = stats[id] || (stats[id] = { last: null, answered: false });
    if (t.type !== TOUCH.LEAD) s.answered = true;
    if (t.type !== TOUCH.STAGE && isDate_(t.date) && (!s.last || t.date > s.last)) s.last = t.date;
  });
  return stats;
}

function clientView_(c) {
  if (!c) return null;
  var v = serialize_(c);
  ['gcId', 'phone'].forEach(function (f) { v[f] = v[f] === '' ? '' : String(v[f]); });
  return v;
}

function dealView_(d, client, stats) {
  var v = serialize_(d);
  v.orderNo = v.orderNo === '' ? '' : String(v.orderNo);
  // client === undefined — ответ на запись: поля клиента не трогаем, у сайта они уже есть.
  if (client !== undefined) {
    v.clientName = client ? String(client.name) : '';
    v.nick = client ? String(client.nick || '') : '';
    v.dialogUrl = client ? String(client.dialogUrl || '') : '';
    v.gcId = client && client.gcId !== '' ? String(client.gcId) : '';
    v.clientCheck = client ? String(client.check || '') : '';
    v.contactHint = contactHint_(client);
  }
  if (stats) {
    // Без stats (ответ на запись) этих полей нет — клиент оставляет свои значения.
    var s = stats[String(d.id)];
    v.lastTouchAt = s && s.last ? s.last.toISOString() : '';
    v.answered = s ? s.answered : false;
  }
  v.imported = String(d.source || '') !== SOURCE_CRM;
  v.prospect = toBool_(d.prospect);
  v.score = normScore_(d.score);
  v.color = dealColor_(d);
  return v;
}

/**
 * Короткая подпись к имени, чтобы различать одинаковые имена: @ник, адрес диалога, почта,
 * последние цифры телефона или ID GetCourse — что есть.
 */
function contactHint_(c) {
  if (!c) return '';
  var nick = normNick_(c.nick);
  if (nick) return '@' + nick;
  var url = String(c.dialogUrl || '').trim();
  if (url && !gcIdFromUrl_(url) && !/instagram\.com\/direct\//i.test(url)) {
    var short = urlKey_(url).replace(/^(www\.|m\.)/, '');
    return short.length > 28 ? short.slice(0, 27) + '…' : short;
  }
  if (String(c.email || '').trim()) return String(c.email).trim();
  var ph = normPhone_(c.phone);
  if (ph.length >= 4) return 'тел. …' + ph.slice(-4);
  if (String(c.gcId || '').trim()) return 'GC ' + String(c.gcId);
  if (url) return 'диалог в Инстаграм';
  return '';
}

function touchView_(t, usersByEmail) {
  var v = serialize_(t);
  var u = usersByEmail[normEmail_(t.author)];
  v.authorName = u ? u.name : String(t.author || '');
  return v;
}

function usersByEmail_() {
  var map = {};
  getRef_().users.forEach(function (u) { if (u.email) map[u.email] = u; });
  return map;
}

/* ---------- Сегодня ---------- */

function svcGetToday_(user) {
  var now = now_();
  var dayStart = mskDayStart_(now, 0);
  var dayEnd = mskDayStart_(now, 1);
  var clients = indexBy_(new Table_(SHEET.CLIENTS).all(), 'id');
  var deals = new Table_(SHEET.DEALS).all();
  var touches = new Table_(SHEET.TOUCHES).all();
  var stats = touchStats_(touches);

  var overdue = [];
  var today = [];
  var fresh = [];
  var counters = { created: 0, touches: 0, paid: 0, paidSum: 0, monthPaid: 0, monthPaidSum: 0, monthCreated: 0 };
  var lists = { created: [], touches: [], paid: [] };
  var brief = function (d) {
    var c = clients[String(d.clientId)];
    return { id: d.id, clientName: c ? String(c.name) : '', contactHint: contactHint_(c), channel: d.channel, stage: d.stage, course: d.course, amount: d.amount, request: d.request };
  };
  var dealsById = {};
  var monthStart = mskMonthStart_(now, 0);
  var monthEnd = mskMonthStart_(now, 1);
  counters.month = monthStart.toISOString();

  deals.forEach(function (d) {
    dealsById[String(d.id)] = d;
    if (isDate_(d.createdAt) && d.createdAt >= dayStart && d.createdAt < dayEnd) {
      counters.created++;
      lists.created.push(Object.assign(brief(d), { time: d.createdAt.toISOString() }));
    }
    if (d.stage === STAGE.PAID && isDate_(d.paidAt) && d.paidAt >= dayStart && d.paidAt < dayEnd) {
      counters.paid++;
      counters.paidSum += toNumber_(d.amount);
      lists.paid.push(brief(d));
    }
    if (isDate_(d.createdAt) && d.createdAt >= monthStart && d.createdAt < monthEnd) counters.monthCreated++;
    if (d.stage === STAGE.PAID && isDate_(d.paidAt) && d.paidAt >= monthStart && d.paidAt < monthEnd) {
      counters.monthPaid++;
      counters.monthPaidSum += toNumber_(d.amount);
    }
    if (!isOpenStage_(d.stage)) return;
    var v = dealView_(d, clients[String(d.clientId)], stats);
    if (d.stage === STAGE.NEW && !v.answered) fresh.push(v);
    else if (!isDate_(d.taskAt) || d.taskAt < dayStart) overdue.push(v);
    else if (d.taskAt < dayEnd) today.push(v);
  });
  touches.forEach(function (t) {
    if (t.type !== TOUCH.STAGE && isDate_(t.date) && t.date >= dayStart && t.date < dayEnd) {
      counters.touches++;
      var d = dealsById[String(t.dealId)];
      lists.touches.push({ id: String(t.dealId), clientName: d ? brief(d).clientName : '', contactHint: d ? brief(d).contactHint : '', type: t.type, channel: String(t.channel || (d && d.channel) || ''),
        time: t.date.toISOString(), text: String(t.text || '').slice(0, 120) });
    }
  });
  ['created', 'touches'].forEach(function (k) { lists[k].sort(function (a, b) { return b.time.localeCompare(a.time); }); });

  var byTask = function (a, b) { return (a.taskAt || '').localeCompare(b.taskAt || ''); };
  overdue.sort(byTask);
  today.sort(byTask);
  fresh.sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  return { overdue: overdue, today: today, fresh: fresh, counters: counters, lists: lists, now: now.toISOString() };
}

/* ---------- Список и поиск ---------- */

function svcListDeals_(user, filter) {
  var clients = indexBy_(new Table_(SHEET.CLIENTS).all(), 'id');
  var deals = new Table_(SHEET.DEALS).all();
  var stats = touchStats_(new Table_(SHEET.TOUCHES).all());
  var from = filter.from ? parseTaskDate_(filter.from, '00:00') : null;
  var to = filter.to ? mskDayStart_(parseTaskDate_(filter.to, '00:00'), 1) : null;
  var q = String(filter.query || '').trim().toLowerCase();
  var qDigits = q.replace(/\D/g, '');
  var course = String(filter.course || '').trim().toLowerCase();

  var out = [];
  deals.forEach(function (d) {
    if (filter.stages && filter.stages.length && filter.stages.indexOf(d.stage) < 0) return;
    if (filter.potok && d.potok !== filter.potok) return;
    if (filter.channel && d.channel !== filter.channel) return;
    if (course && String(d.course).toLowerCase().indexOf(course) < 0) return;
    if (from && !(isDate_(d.createdAt) && d.createdAt >= from)) return;
    if (to && !(isDate_(d.createdAt) && d.createdAt < to)) return;
    var c = clients[String(d.clientId)];
    if (q) {
      var hay = [d.id, d.clientId, c && c.name, c && c.nick, c && c.email, c && c.gcId, d.orderNo]
        .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
      var phone = c ? normPhone_(c.phone) : '';
      var hit = hay.indexOf(q) >= 0 || (qDigits.length >= 5 && phone.indexOf(qDigits) >= 0);
      if (!hit) return;
    }
    out.push(dealView_(d, c, stats));
  });
  out.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  return out.slice(0, filter.limit || 500);
}

/* ---------- Карточка ---------- */

function svcGetDeal_(user, id) {
  var cards = svcGetDeals_(user, [id]);
  if (!cards[id]) throw userError_('Сделка ' + id + ' не найдена.');
  return cards[id];
}

/**
 * Несколько карточек за один запрос: сайт заранее подгружает карточки из «Сегодня» и доски,
 * чтобы они открывались мгновенно. Листы читаются по одному разу на всю пачку.
 */
function svcGetDeals_(user, ids) {
  var want = {};
  (ids || []).slice(0, 150).forEach(function (id) { want[String(id)] = true; });
  var deals = new Table_(SHEET.DEALS).all();
  var clients = indexBy_(new Table_(SHEET.CLIENTS).all(), 'id');
  var touchesAll = new Table_(SHEET.TOUCHES).all();
  var stats = touchStats_(touchesAll);
  var users = usersByEmail_();
  var byDeal = {};
  touchesAll.forEach(function (t) {
    var k = String(t.dealId);
    if (want[k]) (byDeal[k] = byDeal[k] || []).push(t);
  });
  var byClient = {};
  deals.forEach(function (d) { (byClient[String(d.clientId)] = byClient[String(d.clientId)] || []).push(d); });
  var out = {};
  deals.forEach(function (deal) {
    var id = String(deal.id);
    if (!want[id]) return;
    var client = clients[String(deal.clientId)] || null;
    var touches = (byDeal[id] || [])
      .sort(function (a, b) {
        var ta = isDate_(a.date) ? a.date.getTime() : 0;
        var tb = isDate_(b.date) ? b.date.getTime() : 0;
        return tb - ta || b._row - a._row;
      })
      .map(function (t) { return touchView_(t, users); });
    var other = (byClient[String(deal.clientId)] || [])
      .filter(function (d) { return String(d.id) !== id; })
      .map(function (d) { return dealView_(d, client, stats); });
    out[id] = { deal: dealView_(deal, client, stats), client: clientView_(client), touches: touches, otherDeals: other };
  });
  return out;
}

/* ---------- Клиенты ---------- */

function duplicatesView_(matches, deals) {
  return matches.map(function (m) {
    var v = clientView_(m.client);
    v.matchedBy = m.fields.map(function (f) { return CONTACT_LABELS[f]; });
    v.deals = deals
      .filter(function (d) { return String(d.clientId) === String(m.client.id); })
      .map(function (d) { return { id: d.id, stage: d.stage, course: d.course, createdAt: toIso_(d.createdAt) }; });
    return v;
  });
}

function svcFindDuplicates_(user, draft) {
  var clients = new Table_(SHEET.CLIENTS).all();
  var matches = findDuplicateClients_(clients, draft, draft.id);
  return duplicatesView_(matches, new Table_(SHEET.DEALS).all());
}

var CLIENT_EDITABLE = ['name', 'nick', 'dialogUrl', 'gcId', 'email', 'phone', 'otherLinks'];

function svcUpdateClient_(user, id, patch) {
  return withLock_(function () {
    var t = new Table_(SHEET.CLIENTS);
    var before = t.find('id', id);
    if (!before) throw userError_('Клиент ' + id + ' не найден.');
    var clean = {};
    CLIENT_EDITABLE.forEach(function (f) { if (f in patch) clean[f] = patch[f]; });
    var norm = normalizeClient_(clean);
    validateClientFields_(norm);
    var after = {};
    for (var k in before) after[k] = before[k];
    for (var f in norm) after[f] = norm[f];

    if (!String(after.name || '').trim()) throw userError_('Имя клиента не может быть пустым.', 'name');
    // 4.5: контакт обязателен. У импортированных клиентов без контактов править остальное можно.
    if (!hasContact_(after) && hasContact_(before)) {
      throw userError_('Нельзя удалить последний контакт: нужен хотя бы ник, ссылка, ID GetCourse, почта или телефон.', Object.keys(norm)[0]);
    }
    if (!patch.force) {
      var dupDraft = {};
      CONTACT_FIELDS.concat(['otherLinks']).forEach(function (f) { if (f in norm && norm[f]) dupDraft[f] = norm[f]; });
      var dups = findDuplicateClients_(t.all(), dupDraft, id);
      if (dups.length) {
        var d = dups[0];
        throw userError_('Такой контакт уже есть у клиента ' + d.client.id + ' «' + d.client.name + '» (' +
          d.fields.map(function (f) { return CONTACT_LABELS[f]; }).join(', ') + ').', d.fields[0]);
      }
    }
    return clientView_(t.update(before._row, norm));
  });
}

/* ---------- Создание обращения ---------- */

function svcCreateDeal_(user, payload) {
  return withLock_(function () {
    var ref = getRef_();
    var now = now_();
    var clientsT = new Table_(SHEET.CLIENTS);
    var dealsT = new Table_(SHEET.DEALS);
    var touchesT = new Table_(SHEET.TOUCHES, { headerOnly: true });
    var dealIn = payload.deal || {};

    var potok = dealIn.potok || POTOK.INBOUND;
    var request = String(dealIn.request || '').trim();
    if (!dealIn.channel) throw userError_('Выберите канал.', 'channel');
    if (!request) throw userError_('Опишите запрос клиента.', 'request');

    var client;
    if (payload.clientId) {
      client = clientsT.find('id', payload.clientId);
      if (!client) throw userError_('Клиент ' + payload.clientId + ' не найден.');
    } else {
      var c = normalizeClient_(payload.client || {});
      validateClientFields_(c);
      if (!c.name) throw userError_('Укажите имя клиента.', 'name');
      if (!hasContact_(c)) throw userError_('Укажите контакт: ник, ссылку на диалог, ID GetCourse, почту или телефон.', 'contact');
      if (!payload.force) {
        var dups = findDuplicateClients_(clientsT.all(), c, null);
        if (dups.length) return { duplicates: duplicatesView_(dups, dealsT.all()) };
      }
      c.id = clientsT.nextId('C');
      c.createdAt = now;
      c.author = user.email;
      client = clientsT.append(c);
    }

    var deal = {
      id: dealsT.nextId('D'),
      clientId: client.id,
      potok: potok,
      channel: dealIn.channel,
      createdAt: now,
      request: request,
      course: String(dealIn.course || '').trim(),
      tariff: String(dealIn.tariff || '').trim(),
      amount: dealIn.amount === undefined ? '' : dealIn.amount,
      payMethod: '',
      orderNo: String(dealIn.orderNo || '').trim(),
      paidAt: '',
      stage: dealIn.stage || initialStage_(potok),
      lostReason: '',
      nextTask: String(dealIn.nextTask || '').trim(),
      taskAt: parseTaskDate_(dealIn.taskAt, setting_('TASK_DEFAULT_TIME')),
      source: SOURCE_CRM,
      check: '',
      owner: user.email,
      updatedAt: now,
      prospect: toBool_(dealIn.prospect),
      score: normScore_(dealIn.score),
      priorContact: normPrior_(dealIn.priorContact),
      priorWhere: String(dealIn.priorWhere || '').trim(),
      priorWhen: parseTaskDate_(dealIn.priorWhen, '00:00'),
      priorNote: String(dealIn.priorNote || '').trim()
    };
    // Клиент уже есть в CRM — значит, контакт был: где и когда берём из его последней сделки.
    if (payload.clientId && !deal.priorContact) {
      var last = dealsT.all()
        .filter(function (d) { return String(d.clientId) === String(client.id); })
        .sort(function (a, b) { return (isDate_(b.createdAt) ? b.createdAt.getTime() : 0) - (isDate_(a.createdAt) ? a.createdAt.getTime() : 0); })[0];
      deal.priorContact = 'Да';
      if (last) {
        if (!deal.priorWhere) deal.priorWhere = last.channel;
        if (!isDate_(deal.priorWhen) && isDate_(last.createdAt)) deal.priorWhen = mskDayStart_(last.createdAt, 0);
        if (!deal.priorNote) deal.priorNote = 'Сделка ' + last.id + (last.stage ? ' (' + last.stage + ')' : '');
      }
    }
    if (deal.priorContact !== 'Да') {
      deal.priorWhere = '';
      deal.priorWhen = '';
    }
    if (isDate_(deal.priorWhen) && deal.priorWhen.getTime() > now.getTime()) throw userError_('Дата прошлого контакта не может быть в будущем.', 'priorWhen');
    if (deal.amount === '' || deal.amount === null) {
      var price = tariffPrice_(ref.tariffs, deal.course, deal.tariff);
      deal.amount = price === null ? '' : price;
    }
    if (!deal.nextTask && !isDate_(deal.taskAt) && isOpenStage_(deal.stage)) {
      var def = defaultTaskForNewDeal_(potok, now, settingsWithDefaults_());
      deal.nextTask = def.nextTask;
      deal.taskAt = def.taskAt;
    }
    applyDealRules_(deal, null, { dicts: ref.dicts, now: now });
    dealsT.append(deal);
    touchesT.append({ dealId: deal.id, date: now, type: TOUCH.LEAD, text: request, author: user.email, channel: deal.channel });
    return { dealId: deal.id, clientId: client.id };
  });
}

function settingsWithDefaults_() {
  var s = {};
  DEFAULT_SETTINGS.forEach(function (d) { s[d.key] = setting_(d.key); });
  return s;
}

/* ---------- Изменение сделки ---------- */

var DEAL_EDITABLE = ['potok', 'channel', 'request', 'course', 'tariff', 'amount', 'payMethod', 'orderNo',
  'paidAt', 'stage', 'lostReason', 'nextTask', 'taskAt', 'prospect', 'score', 'orderUrl',
  'priorContact', 'priorWhere', 'priorWhen', 'priorNote'];

/**
 * Общая часть updateDeal / addTouch / cron: применяет patch к сделке, проверяет правила,
 * пишет строку и касание «Смена стадии». Вызывать под withLock_.
 */
function saveDeal_(user, dealsT, touchesT, before, patch, now) {
  var ref = getRef_();
  var deal = {};
  for (var k in before) deal[k] = before[k];
  for (var f in patch) deal[f] = patch[f];

  // 4.7: сменили курс или тариф без ручной суммы — подставляем цену тарифа.
  if (('tariff' in patch || 'course' in patch) && !('amount' in patch)) {
    var price = tariffPrice_(ref.tariffs, deal.course, deal.tariff);
    if (price !== null) deal.amount = price;
  }
  applyDealRules_(deal, before, { dicts: ref.dicts, now: now });
  deal.updatedAt = now;
  delete deal._row;
  var saved = dealsT.update(before._row, deal);

  var newTouches = [];
  if (before.stage !== saved.stage) {
    var touch = { dealId: saved.id, date: now, type: TOUCH.STAGE, text: stageChangeText_(before.stage, saved), author: user.email, channel: saved.channel };
    touchesT.append(touch);
    newTouches.push(touch);
  }
  return { deal: saved, newTouches: newTouches };
}

function svcUpdateDeal_(user, id, patch) {
  return withLock_(function () {
    var dealsT = new Table_(SHEET.DEALS);
    var touchesT = new Table_(SHEET.TOUCHES, { headerOnly: true });
    var before = dealsT.find('id', id);
    if (!before) throw userError_('Сделка ' + id + ' не найдена.');
    var clean = {};
    DEAL_EDITABLE.forEach(function (f) { if (f in patch) clean[f] = patch[f]; });
    if ('taskAt' in clean) clean.taskAt = parseTaskDate_(clean.taskAt, setting_('TASK_DEFAULT_TIME'));
    if ('paidAt' in clean) clean.paidAt = parseTaskDate_(clean.paidAt, '00:00');
    if ('priorWhen' in clean) {
      clean.priorWhen = parseTaskDate_(clean.priorWhen, '00:00');
      if (isDate_(clean.priorWhen) && clean.priorWhen.getTime() > now_().getTime()) throw userError_('Дата прошлого контакта не может быть в будущем.', 'priorWhen');
    }
    if ('priorContact' in clean) clean.priorContact = normPrior_(clean.priorContact);
    ['nextTask', 'request', 'course', 'tariff', 'orderNo', 'orderUrl'].forEach(function (f) {
      if (f in clean) clean[f] = String(clean[f] || '').trim();
    });
    var res = saveDeal_(user, dealsT, touchesT, before, clean, now_());
    return dealResult_(res);
  });
}

/** Ответ на запись: лист «Клиенты» не читаем — имя и контакты клиента у сайта уже есть. */
function dealResult_(res) {
  var users = usersByEmail_();
  return {
    deal: dealView_(res.deal, undefined, null),
    newTouches: res.newTouches.map(function (t) { return touchView_(t, users); })
  };
}

/* ---------- Касания ---------- */

/** Добавляет касание и применяет 4.2 (задача по умолчанию) и авто-переход «Новое» → «В диалоге». */
function addTouchInternal_(user, dealId, touch, now) {
  var ref = getRef_();
  var dealsT = new Table_(SHEET.DEALS);
  var touchesT = new Table_(SHEET.TOUCHES, { headerOnly: true });
  var before = dealsT.find('id', dealId);
  if (!before) throw userError_('Сделка ' + dealId + ' не найдена.');
  var type = touch.type;
  var channel = String(touch.channel || before.channel || '').trim();
  if (channel && ref.dicts.channels.indexOf(channel) < 0) throw userError_('Выберите канал из списка.', 'channel');
  // Старая переписка вносится задним числом: дата в прошлом — без авто-задачи и смены стадии.
  var when = touch.date ? parseTaskDate_(touch.date, '12:00') : now;
  if (when.getTime() > now.getTime() + 5 * 60000) throw userError_('Дата касания не может быть в будущем.', 'date');
  var backdated = when.getTime() < now.getTime() - 3600 * 1000;
  if (ref.dicts.touchTypes.indexOf(type) < 0) throw userError_('Выберите тип касания.', 'type');
  if (SYSTEM_TOUCHES.indexOf(type) >= 0) throw userError_('Касание «' + type + '» добавляется автоматически.', 'type');
  var text = String(touch.text || '').trim();
  if (type === TOUCH.NOTE && !text) throw userError_('Напишите текст заметки.', 'text');

  var patch = {};
  if (before.stage === STAGE.NEW && !backdated) patch.stage = STAGE.TALK;
  var stageAfter = patch.stage || before.stage;
  if (touch.nextTask || touch.nextTaskDate) {
    if (touch.nextTask) patch.nextTask = String(touch.nextTask).trim();
    if (touch.nextTaskDate) patch.taskAt = parseTaskDate_(touch.nextTaskDate, setting_('TASK_DEFAULT_TIME'));
  } else if (!backdated && FOLLOWUP_TOUCHES.indexOf(type) >= 0 && isOpenStage_(stageAfter) && stageAfter !== STAGE.POSTPONED) {
    var f = followupTask_(now, settingsWithDefaults_());
    patch.nextTask = f.nextTask;
    patch.taskAt = f.taskAt;
  }

  // Сначала сделка (там все проверки), потом касание — чтобы при ошибке ничего не записалось наполовину.
  var res = Object.keys(patch).length
    ? saveDeal_(user, dealsT, touchesT, before, patch, now)
    : { deal: before, newTouches: [] };
  var row = { dealId: before.id, date: when, type: type, text: text, author: user.email, channel: channel };
  touchesT.append(row);
  res.newTouches.unshift(row);
  return res;
}

function svcAddTouch_(user, dealId, touch) {
  return withLock_(function () {
    var res = addTouchInternal_(user, dealId, touch, now_());
    var out = dealResult_(res);
    out.touch = out.newTouches[0];
    return out;
  });
}

function svcLogTemplateUse_(user, dealId, templateId) {
  return withLock_(function () {
    var tpl = getRef_().templates.filter(function (t) { return t.id === templateId; })[0];
    if (!tpl) throw userError_('Шаблон ' + templateId + ' не найден.');
    var res = addTouchInternal_(user, dealId, { type: TOUCH.TEMPLATE, text: 'Шаблон: ' + tpl.title }, now_());
    var out = dealResult_(res);
    out.touch = out.newTouches[0];
    return out;
  });
}

function svcMarkChecked_(user, kind, id) {
  return withLock_(function () {
    var t = new Table_(kind === 'client' ? SHEET.CLIENTS : SHEET.DEALS);
    var row = t.find('id', id);
    if (!row) throw userError_('Запись ' + id + ' не найдена.');
    t.update(row._row, { check: '' });
    return { kind: kind, id: id };
  });
}

/* ---------- Отчёт ---------- */

function svcGetReport_(user, from, to) {
  var fromDay = parseTaskDate_(from, '00:00');
  var toDay = parseTaskDate_(to, '00:00');
  if (!isDate_(fromDay) || !isDate_(toDay)) throw userError_('Укажите период отчёта.');
  if (toDay < fromDay) throw userError_('Начало периода позже конца.');
  return computeReport_(new Table_(SHEET.DEALS).all(), fromDay, mskDayStart_(toDay, 1), new Table_(SHEET.TOUCHES).all());
}

/* ---------- Доска ---------- */

/**
 * Открытые сделки по колонкам + закрытые за период (по умолчанию текущий месяц):
 * «Оплачено» — по дате оплаты, «Отказ» — по дате последнего изменения.
 */
function svcGetBoard_(user, filter) {
  var now = now_();
  var from = filter.from ? parseTaskDate_(filter.from, '00:00') : mskMonthStart_(now, 0);
  var to = filter.to ? mskDayStart_(parseTaskDate_(filter.to, '00:00'), 1) : mskMonthStart_(now, 1);
  var rows = svcListDeals_(user, { potok: filter.potok, channel: filter.channel, course: filter.course, query: filter.query, limit: 100000 });
  var inPeriod = function (iso) { if (!iso) return false; var t = new Date(iso); return t >= from && t < to; };
  var open = [];
  var paid = [];
  var lost = [];
  rows.forEach(function (d) {
    if (isOpenStage_(d.stage)) open.push(d);
    else if (d.stage === STAGE.PAID && inPeriod(d.paidAt)) paid.push(d);
    else if (d.stage === STAGE.LOST && inPeriod(d.updatedAt)) lost.push(d);
  });
  open.sort(function (a, b) { return (a.taskAt || '9').localeCompare(b.taskAt || '9'); });
  return { open: open, paid: paid, lost: lost, from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() };
}

/* ---------- Календарь ---------- */

/** Московский день 'YYYY-MM-DD' для даты. */
function mskDayKey_(d) {
  var m = new Date(d.getTime() + MSK_OFFSET_MS);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return m.getUTCFullYear() + '-' + p(m.getUTCMonth() + 1) + '-' + p(m.getUTCDate());
}

/**
 * Сводка по дням месяца: обращения (входящие / исходящие), касания, оплаты и сумма.
 * month — 'YYYY-MM' (по умолчанию текущий). Считается так же, как счётчики на «Сегодня».
 */
function svcGetCalendar_(user, month) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  var start = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1) - MSK_OFFSET_MS) : mskMonthStart_(now_(), 0);
  var end = mskMonthStart_(start, 1);
  var days = {};
  var day = function (d) {
    var k = mskDayKey_(d);
    return days[k] || (days[k] = { created: 0, createdIn: 0, createdOut: 0, touches: 0, paid: 0, paidSum: 0 });
  };
  var deals = new Table_(SHEET.DEALS).all();
  var byId = {};
  deals.forEach(function (d) {
    byId[String(d.id)] = d;
    if (isDate_(d.createdAt) && d.createdAt >= start && d.createdAt < end) {
      var x = day(d.createdAt);
      x.created++;
      if (d.potok === POTOK.OUT) x.createdOut++; else x.createdIn++;
    }
    if (d.stage === STAGE.PAID && isDate_(d.paidAt) && d.paidAt >= start && d.paidAt < end) {
      var y = day(d.paidAt);
      y.paid++;
      y.paidSum += toNumber_(d.amount);
    }
  });
  new Table_(SHEET.TOUCHES).all().forEach(function (t) {
    if (t.type !== TOUCH.STAGE && isDate_(t.date) && t.date >= start && t.date < end && byId[String(t.dealId)]) day(t.date).touches++;
  });
  var total = { created: 0, createdIn: 0, createdOut: 0, touches: 0, paid: 0, paidSum: 0 };
  Object.keys(days).forEach(function (k) { Object.keys(total).forEach(function (f) { total[f] += days[k][f]; }); });
  return { month: mskDayKey_(start).slice(0, 7), today: mskDayKey_(now_()), days: days, total: total };
}

/** Подробно за один день 'YYYY-MM-DD': кто обратился, касания, оплаты — как списки на «Сегодня». */
function svcGetCalendarDay_(user, dayStr) {
  var dayStart = parseTaskDate_(dayStr, '00:00');
  if (!isDate_(dayStart)) throw userError_('Неверная дата.');
  var dayEnd = mskDayStart_(dayStart, 1);
  var clients = indexBy_(new Table_(SHEET.CLIENTS).all(), 'id');
  var deals = new Table_(SHEET.DEALS).all();
  var byId = {};
  var brief = function (d) {
    var c = clients[String(d.clientId)];
    return { id: d.id, clientName: c ? String(c.name) : '', contactHint: contactHint_(c), channel: d.channel, potok: d.potok, stage: d.stage, course: d.course, amount: d.amount, request: d.request, score: normScore_(d.score) };
  };
  var out = { day: dayStr, created: [], touches: [], paid: [] };
  deals.forEach(function (d) {
    byId[String(d.id)] = d;
    if (isDate_(d.createdAt) && d.createdAt >= dayStart && d.createdAt < dayEnd) out.created.push(Object.assign(brief(d), { time: d.createdAt.toISOString() }));
    if (d.stage === STAGE.PAID && isDate_(d.paidAt) && d.paidAt >= dayStart && d.paidAt < dayEnd) out.paid.push(brief(d));
  });
  new Table_(SHEET.TOUCHES).all().forEach(function (t) {
    var d = byId[String(t.dealId)];
    if (!d || t.type === TOUCH.STAGE || !isDate_(t.date) || t.date < dayStart || t.date >= dayEnd) return;
    out.touches.push({ id: String(t.dealId), clientName: brief(d).clientName, contactHint: brief(d).contactHint, type: t.type, channel: String(t.channel || d.channel || ''),
      time: t.date.toISOString(), text: String(t.text || '').slice(0, 160) });
  });
  ['created', 'touches'].forEach(function (k) { out[k].sort(function (a, b) { return a.time.localeCompare(b.time); }); });
  return out;
}
