/**
 * Import.gs — перенос данных из старой таблицы менеджера (Google Таблица Максима).
 *
 * Файл .xlsx разбирает сайт (SheetJS) и присылает строки уже в виде объектов; здесь —
 * сопоставление с CRM и запись. Сначала всегда «посмотреть» (apply = false), потом «перенести».
 * Повторный перенос того же файла ничего не дублирует: сделки ищутся по «Источник» (лист и строка)
 * и по контактам, участники заданий — по ID GetCourse, почте и телефону.
 *
 * Лист «Обращения» (колонки по порядку, как их описал Максим):
 * № · ФИ (ссылка на канал связи) · Канал · Дата · Запрос · Дата 2 контакта · План действий ·
 * Оценка 1–3 · Оплатил · Заказ (ссылка) · Сумма · Дата оплаты.
 * Цвет «Плана действий»: белый — больше не в работе, жёлтый — в работе, зелёный — оплачено.
 */

function previewLegacyDeals(rows, sheetName) { return api_(function (user) { return svcLegacyDeals_(user, rows || [], sheetName, null); }); }
function applyLegacyDeals(rows, sheetName, pick) { return api_(function (user) { return svcLegacyDeals_(user, rows || [], sheetName, pick || []); }); }
function importLegacyTask(input, apply) { return api_(function (user) { return svcLegacyTask_(user, input || {}, !!apply); }); }

var LEGACY_SOURCE_RE_ = /^(?:Нов\.? ?Обр|Обращения)[^,]*,\s*строка\s*(\d+)\s*$/i;

/** «Инст», «эл. почта», «ГетКурс»… → значение справочника «Каналы» (или '' если не узнали). */
function legacyChannel_(v, channels) {
  var s = String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  var map = {
    'вк': 'ВК', 'vk': 'ВК', 'вконтакте': 'ВК',
    'инст': 'Инстаграм', 'инста': 'Инстаграм', 'инстаграм': 'Инстаграм', 'instagram': 'Инстаграм', 'insta': 'Инстаграм',
    'макс': 'Макс', 'max': 'Макс',
    'тг': 'ТГ', 'телеграм': 'ТГ', 'telegram': 'ТГ', 'tg': 'ТГ',
    'эл.почта': 'Почта', 'эл. почта': 'Почта', 'почта': 'Почта', 'email': 'Почта', 'e-mail': 'Почта',
    'геткурс': 'GetCourse', 'getcourse': 'GetCourse', 'gc': 'GetCourse'
  };
  var out = map[s] || '';
  if (!out) {
    for (var i = 0; i < channels.length; i++) if (channels[i].toLowerCase() === s) out = channels[i];
  }
  return out && channels.indexOf(out) >= 0 ? out : '';
}

/** «Yulia Gerasimova (@nick) • Instagram photos and videos» → «Yulia Gerasimova»; «(Людмила)@nick» → «Людмила». */
function legacyName_(raw) {
  var s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*•.*$/, '').trim();
  var paren = /^\(([^)]+)\)\s*@\S+$/.exec(s);
  if (paren) return paren[1].trim();
  s = s.replace(/\(@[^)]*\)/g, '').replace(/\s@\S+/g, '').trim();
  var words = s.split(' ');
  if (words.some(function (w) { return /[а-яё]/i.test(w); })) {
    // «Елена elena_77», «Мехрубон mehru» — латинский ник рядом с русским именем убираем.
    var kept = words.filter(function (w) { return /[а-яё]/i.test(w); });
    if (kept.length) s = kept.join(' ');
  }
  return s || String(raw || '').trim();
}

/** Ссылка из ячейки «ФИ» → контакты клиента. Ссылка на заказ GetCourse — не контакт. */
function legacyContact_(url) {
  var s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return {};
  var gc = gcIdFromUrl_(s);
  if (gc) return { gcId: gc };
  if (/\/sales\/control\/deal\//i.test(s)) return {};
  if (/\/pl\/tasks\/resp/i.test(s) && !/respId=\d+/i.test(s)) return {};
  if (/instagram\.com\//i.test(s) && !/instagram\.com\/direct\//i.test(s)) {
    var nick = normNick_(s);
    return nick ? { nick: nick } : {};
  }
  return { dialogUrl: s };
}

function legacyDdMm_(d) {
  var m = new Date(d.getTime() + MSK_OFFSET_MS);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(m.getUTCDate()) + '.' + p(m.getUTCMonth() + 1);
}

function legacyText_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\r/g, '').trim();
}

function legacySame_(a, b) {
  var n = function (x) { return String(x || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, ''); };
  return n(a) && n(a) === n(b);
}

/** Цвет «Плана действий» (или всей строки): white | yellow | green | ''. */
function legacyColor_(rgb) {
  var c = String(rgb || '').replace(/^#/, '').toUpperCase().slice(-6);
  if (!c) return '';
  if (c === 'FFFFFF') return 'white';
  if (['FFF2CC', 'FFE599', 'FFFF00', 'FFD966', 'FCE8B2'].indexOf(c) >= 0) return 'yellow';
  if (['B6D7A8', 'D9EAD3', '93C47D', '00FF00', 'B7E1CD'].indexOf(c) >= 0) return 'green';
  return '';
}

/** Похожи ли строка таблицы и сделка CRM: имя, ник или запрос. */
function legacyLooksLike_(r, deal, client) {
  var cname = String(client && client.name || '').trim().toLowerCase();
  var rname = String(r.name || '').toLowerCase();
  var first = cname.split(/\s+/)[0];
  if (first && first.length >= 2 && rname.indexOf(first) >= 0) return true;
  var rfirst = legacyName_(r.name).toLowerCase().split(/\s+/)[0];
  if (rfirst && cname.indexOf(rfirst) >= 0) return true;
  var c = legacyContact_(r.link);
  if (c.nick && client && normNick_(client.nick) === c.nick) return true;
  var rq = String(r.request || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 20);
  var dq = String(deal.request || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 20);
  return !!rq && rq === dq;
}

/**
 * План переноса листа «Обращения»: что будет с каждой строкой.
 * data = { deals, clients, touches, dicts, now, sheetName }. Ничего не пишет.
 */
function planLegacyDeals_(rows, data) {
  var clientsById = indexBy_(data.clients, 'id');
  var bySource = {};
  data.deals.forEach(function (d) {
    var m = LEGACY_SOURCE_RE_.exec(String(d.source || '').trim());
    if (m) bySource[m[1]] = d;
  });
  var touchesByDeal = {};
  data.touches.forEach(function (t) { (touchesByDeal[String(t.dealId)] = touchesByDeal[String(t.dealId)] || []).push(t); });
  var dealsByClient = {};
  data.deals.forEach(function (d) { (dealsByClient[String(d.clientId)] = dealsByClient[String(d.clientId)] || []).push(d); });
  var defTime = data.defaultTime || '10:00';
  var today = mskDayStart_(data.now, 0);
  var takenContacts = {};

  return rows.map(function (r) {
    var item = { row: r.row, no: r.no, name: legacyName_(r.name), raw: r.name, kind: 'same', changes: [], warn: '', dealId: '', checked: false };
    var channel = legacyChannel_(r.channel, data.dicts.channels);
    var created = r.date ? parseTaskDate_(r.date, '00:00') : '';
    var second = r.second ? parseTaskDate_(r.second, defTime) : '';
    var plan = legacyText_(r.plan);
    if (plan === '-' || plan === '—') plan = '';
    var score = normScore_(r.score);
    var amount = toNumber_(r.amount);
    var paid = amount > 0 || /^да/i.test(String(r.paid || '').trim());
    var color = legacyColor_(r.planColor) || legacyColor_(r.rowColor);
    var contact = legacyContact_(r.link);
    // Ссылка на заказ GetCourse: из «Заказ» или из «ФИ», если там заказ, а не профиль.
    var orderUrl = String(r.orderLink || '').trim() || (/\/sales\/control\/deal\//i.test(String(r.link || '')) ? String(r.link).trim() : '');
    var payDay = r.payDate ? parseTaskDate_(r.payDate, '00:00') : (isDate_(created) ? created : today);
    // Касание о плане: на дату второго контакта (если она не в будущем), иначе на дату обращения.
    var noteAt = isDate_(second) && second <= data.now ? mskAt_(mskDayStart_(second, 0), '12:00') : (isDate_(created) ? mskAt_(created, '12:00') : data.now);
    if (noteAt > data.now) noteAt = data.now;

    // 1. Сделка, перенесённая раньше из этой же строки.
    var deal = bySource[String(r.row)] || null;
    if (deal && !legacyLooksLike_(r, deal, clientsById[String(deal.clientId)])) {
      item.warn = 'Строка ' + r.row + ' в CRM — другой человек (' + deal.id + '), ищу по контактам.';
      deal = null;
    }
    // 2. Клиент с тем же контактом.
    var client = deal ? clientsById[String(deal.clientId)] : null;
    if (!deal && Object.keys(contact).length) {
      var dup = findDuplicateClients_(data.clients, contact, null)[0];
      if (dup) {
        client = dup.client;
        var theirs = (dealsByClient[String(client.id)] || []).slice().sort(function (a, b) {
          return (isDate_(b.createdAt) ? b.createdAt.getTime() : 0) - (isDate_(a.createdAt) ? a.createdAt.getTime() : 0);
        });
        // Та же сделка, если создана не раньше чем за 7 дней до обращения.
        deal = theirs.filter(function (d) {
          return !isDate_(created) || !isDate_(d.createdAt) || d.createdAt.getTime() >= created.getTime() - 7 * DAY_MS;
        })[0] || null;
      }
    }

    if (!deal) {
      // Новая сделка. Если похожая уже заведена руками в CRM — не отмечаем по умолчанию.
      if (!channel) {
        item.kind = 'skip';
        item.warn = 'Не понял канал «' + r.channel + '» — строка пропущена.';
        return item;
      }
      if (!isDate_(created)) {
        item.kind = 'skip';
        item.warn = 'Нет даты обращения — строка пропущена.';
        return item;
      }
      var similar = client ? null : data.deals.filter(function (d) {
        var c = clientsById[String(d.clientId)];
        return d.channel === channel && isDate_(d.createdAt) && Math.abs(d.createdAt.getTime() - created.getTime()) <= 3 * DAY_MS &&
          c && firstName_(c.name).toLowerCase() === firstName_(item.name).toLowerCase() && !LEGACY_SOURCE_RE_.test(String(d.source || ''));
      })[0];
      var stage = paid ? STAGE.PAID : color === 'white' ? STAGE.LOST : plan ? STAGE.TALK : STAGE.NEW;
      var newDeal = {
        potok: POTOK.INBOUND, channel: channel, createdAt: created, request: legacyText_(r.request) || '—',
        course: '', tariff: '', amount: paid ? (amount || '') : '', payMethod: paid ? 'Полная' : '',
        orderNo: legacyText_(r.orderNo).replace(/\.0+$/, ''), orderUrl: orderUrl, paidAt: paid ? payDay : '',
        stage: stage, lostReason: stage === STAGE.LOST ? 'Не отвечает' : '',
        nextTask: isOpenStage_(stage) ? (plan ? plan.split('\n')[0].slice(0, 120) : 'Написать повторно') : '',
        taskAt: isOpenStage_(stage) ? (isDate_(second) ? second : mskAt_(created, defTime)) : '',
        score: score, prospect: score === '3',
        source: (data.sheetName || 'Обращения') + ', строка ' + r.row,
        check: paid ? 'перенесено из таблицы: проверьте способ оплаты и курс' : ''
      };
      var touches = [{ type: TOUCH.LEAD, date: created, text: newDeal.request }];
      if (plan) touches.push({ type: TOUCH.NOTE, date: noteAt, text: plan });
      item.kind = similar ? 'maybe' : 'new';
      item.checked = !similar;
      if (similar) item.warn = 'Похоже, уже заведено в CRM: ' + similar.id + ' — проверьте, прежде чем отмечать.';
      item.changes.push((client ? 'новая сделка у клиента ' + client.id : 'новый клиент и сделка') + ': ' + channel + ', ' + stage +
        (paid ? ', ' + formatRub_(amount) : '') + (score ? ', оценка ' + score : ''));
      if (!client && !Object.keys(contact).length) item.changes.push('нет ника или ссылки — клиент будет с пометкой «Проверить»');
      item.ops = { clientId: client ? client.id : '', client: client ? null : Object.assign({ name: item.name || 'Без имени' }, contact), deal: newDeal, touches: touches };
      return item;
    }

    // Сделка нашлась — дополняем, ничего не стираем.
    item.dealId = deal.id;
    client = client || clientsById[String(deal.clientId)];
    var clientPatch = {};
    if (client) {
      Object.keys(contact).forEach(function (f) {
        var v = contact[f];
        var key = f + ':' + v;
        if (takenContacts[key]) return;
        var other = findDuplicateClients_(data.clients, (function () { var o = {}; o[f] = v; return o; })(), client.id)[0];
        if (other) return;
        if (!String(client[f] || '').trim()) {
          clientPatch[f] = v;
          takenContacts[key] = true;
          item.changes.push('контакт: ' + CONTACT_LABELS[f] + ' ' + v);
        } else if (f === 'dialogUrl' && urlKey_(client.dialogUrl) !== urlKey_(v) && linkKeys_(client).indexOf(urlKey_(v)) < 0) {
          clientPatch.otherLinks = splitLinks_(client.otherLinks).concat([v]).join('\n');
          takenContacts[key] = true;
          item.changes.push('другая ссылка: ' + v);
        }
      });
    }
    var patch = {};
    if (score && normScore_(deal.score) !== score) { patch.score = score; item.changes.push('оценка ' + score + ' — ' + SCORE_LABELS[score]); }
    if (!legacyText_(deal.request) && legacyText_(r.request)) patch.request = legacyText_(r.request);
    var orderNo = legacyText_(r.orderNo).replace(/\.0+$/, '');
    if (paid && deal.stage !== STAGE.PAID) {
      if (amount > 0 || toNumber_(deal.amount) > 0) {
        patch.stage = STAGE.PAID;
        if (amount > 0) patch.amount = amount;
        if (!deal.payMethod) { patch.payMethod = 'Полная'; patch.check = 'перенесено из таблицы: проверьте способ оплаты'; }
        patch.paidAt = payDay;
        if (orderNo && !legacyText_(deal.orderNo)) patch.orderNo = orderNo;
        item.changes.push('→ Оплачено' + (amount ? ', ' + formatRub_(amount) : ''));
      } else {
        item.warn = 'В таблице «оплачено», но нет суммы — стадию не меняю.';
      }
    } else if (paid) {
      if (orderNo && !legacyText_(deal.orderNo)) { patch.orderNo = orderNo; item.changes.push('номер заказа ' + orderNo); }
      if (amount > 0 && !(toNumber_(deal.amount) > 0)) { patch.amount = amount; item.changes.push('сумма ' + formatRub_(amount)); }
    } else if (color === 'white' && isOpenStage_(deal.stage) && deal.stage !== STAGE.POSTPONED) {
      patch.stage = STAGE.LOST;
      patch.lostReason = 'Не отвечает';
      item.changes.push('→ Отказ: не отвечает (в таблице «больше не в работе»)');
    } else if (color === 'yellow' && isOpenStage_(deal.stage)) {
      if (deal.stage === STAGE.NEW && plan) { patch.stage = STAGE.TALK; item.changes.push('→ В диалоге'); }
      if (isDate_(second) && (!isDate_(deal.taskAt) || mskDayStart_(second, 0) > mskDayStart_(deal.taskAt, 0))) {
        patch.taskAt = second;
        item.changes.push('задача на ' + legacyDdMm_(second));
      }
    }
    if (orderUrl && !legacyText_(deal.orderUrl)) { patch.orderUrl = orderUrl; item.changes.push('ссылка на заказ GetCourse'); }
    var known = (touchesByDeal[String(deal.id)] || []).map(function (t) { return t.text; }).concat([deal.nextTask, deal.request]);
    var touchesNew = [];
    if (plan && !known.some(function (t) { return legacySame_(t, plan); })) {
      touchesNew.push({ type: TOUCH.NOTE, date: noteAt, text: plan });
      item.changes.push('заметка: «' + plan.split('\n')[0].slice(0, 60) + '»');
    }
    if (Object.keys(patch).length || Object.keys(clientPatch).length || touchesNew.length) {
      item.kind = 'update';
      item.checked = true;
      item.ops = { dealId: deal.id, clientId: client ? client.id : '', clientPatch: clientPatch, patch: patch, touches: touchesNew };
    }
    return item;
  });
}

function legacyData_(sheetName) {
  var ref = getRef_();
  return {
    deals: new Table_(SHEET.DEALS).all(),
    clients: new Table_(SHEET.CLIENTS).all(),
    touches: new Table_(SHEET.TOUCHES).all(),
    dicts: ref.dicts,
    now: now_(),
    defaultTime: setting_('TASK_DEFAULT_TIME'),
    sheetName: String(sheetName || 'Обращения').trim()
  };
}

/** pick = null — только план; pick = [номера строк] — перенести отмеченные. */
function svcLegacyDeals_(user, rows, sheetName, pick) {
  if (rows.length > 2000) throw userError_('Слишком много строк: за раз до 2000.');
  if (!pick) return { items: planLegacyDeals_(rows, legacyData_(sheetName)).map(legacyItemView_) };
  return withLock_(function () {
    var data = legacyData_(sheetName);
    var want = {};
    pick.forEach(function (n) { want[String(n)] = true; });
    var items = planLegacyDeals_(rows.filter(function (r) { return want[String(r.row)]; }), data);
    var ref = getRef_();
    var clientsT = new Table_(SHEET.CLIENTS);
    var dealsT = new Table_(SHEET.DEALS);
    var touchesT = new Table_(SHEET.TOUCHES, { headerOnly: true });
    var done = { created: 0, updated: 0, failed: [] };
    items.forEach(function (it) {
      if (!it.ops) return;
      try {
        if (it.kind === 'update') {
          if (Object.keys(it.ops.clientPatch).length && it.ops.clientId) {
            var c = clientsT.find('id', it.ops.clientId);
            if (c) clientsT.update(c._row, it.ops.clientPatch);
          }
          var before = dealsT.find('id', it.ops.dealId);
          if (Object.keys(it.ops.patch).length) saveDeal_(user, dealsT, touchesT, before, it.ops.patch, data.now);
          it.ops.touches.forEach(function (t) {
            touchesT.append({ dealId: before.id, date: t.date, type: t.type, text: t.text, author: user.email, channel: before.channel });
          });
          done.updated++;
        } else {
          var clientId = it.ops.clientId;
          if (!clientId) {
            var nc = normalizeClient_(it.ops.client);
            nc.id = clientsT.nextId('C');
            nc.createdAt = it.ops.deal.createdAt;
            nc.author = user.email;
            nc.check = hasContact_(nc) ? '' : 'нет ника или ссылки';
            clientId = clientsT.append(nc).id;
          }
          var d = Object.assign({}, it.ops.deal, { id: dealsT.nextId('D'), clientId: clientId, owner: user.email, updatedAt: data.now,
            priorContact: '', priorWhere: '', priorWhen: '', priorNote: '' });
          applyDealRules_(d, null, { dicts: ref.dicts, now: data.now });
          dealsT.append(d);
          it.ops.touches.forEach(function (t) {
            touchesT.append({ dealId: d.id, date: t.date, type: t.type, text: t.text, author: user.email, channel: d.channel });
          });
          done.created++;
        }
      } catch (e) {
        done.failed.push('строка ' + it.row + ': ' + (e && e.message || e));
      }
    });
    return done;
  });
}

function legacyItemView_(it) {
  return { row: it.row, no: it.no, name: it.name, raw: it.raw, kind: it.kind, changes: it.changes, warn: it.warn, dealId: it.dealId, checked: it.checked };
}

/* ---------- Списки рассылок → задания ---------- */

/** Сегмент для тех, кто прошёл курс (в таблице Максима имя зелёное или «Прошёл курс — Да»). */
var LEGACY_PASSED_SEGMENT = 'Прошли курс';

var PERSON_RANK_ = { 'Не написали': 0, 'Написали': 1, 'Ответил': 2, 'Не интересно': 2, 'Купил': 3, 'Удалён': 2, 'Не пишем': 2 };

/** «[Имя], добрый день!» / «Имя, добрый день!» → «{Имя}, добрый день!». */
function legacyTemplateText_(text) {
  return String(text || '').replace(/\r/g, '').trim().replace(/^\[?Имя\]?\s*,/, '{Имя},');
}

/**
 * Статус человека по отметкам в таблице: «Написал» да/нет, «Есть ответ».
 * «Нет» в «Написал» — Максим решил не писать (уже купил, уже на курсе…): человек убирается из задания с причиной.
 */
function legacyPersonStatus_(p) {
  var sent = String(p.sent || '').trim();
  var note = String(p.note || '').trim();
  if (/^да/i.test(String(p.replied || '').trim())) return { status: PERSON_STATUS.REPLIED, note: note };
  if (/^да$/i.test(sent)) return { status: PERSON_STATUS.SENT, note: note };
  if (/^нет$/i.test(sent)) return { status: PERSON_STATUS.SKIP, note: note || 'Не писали (отметка в таблице)' };
  if (sent) return { status: PERSON_STATUS.SENT, note: [sent, note].filter(Boolean).join('; ') };
  return { status: PERSON_STATUS.TODO, note: note };
}

/**
 * input = { taskId | name, segment, templates: [{ n, text }], people: [{ firstName, lastName, email, phone, gcId, vk,
 *   sent, replied, sentAt, variant, channel, note }] }
 */
function svcLegacyTask_(user, input, apply) {
  var people = input.people || [];
  if (!people.length) throw userError_('В листе нет людей.');
  if (people.length > 3000) throw userError_('Слишком большой список: до 3000 человек за раз.');
  var segment = String(input.segment || '').trim() || 'Все';
  var run = function () {
    var ref = getRef_();
    var tasksT = new Table_(SHEET.TASKS);
    var task = input.taskId ? tasksT.find('id', input.taskId) : null;
    var name = task ? String(task.name) : String(input.name || '').trim();
    if (!name) throw userError_('Назовите задание.', 'name');
    if (!task) task = tasksT.all().filter(function (t) { return String(t.name).trim().toLowerCase() === name.toLowerCase(); })[0] || null;
    var templates = (input.templates || []).filter(function (t) { return String(t.text || '').trim(); });
    var existingTpl = task ? ref.templates.filter(function (t) { return t.taskId === String(task.id); }) : [];
    var tplByN = {};
    var tplNew = 0;
    templates.forEach(function (t) {
      var title = 'Вариант ' + t.n;
      var have = existingTpl.filter(function (x) { return x.title === title; })[0];
      if (have) tplByN[t.n] = have.id;
      else tplNew++;
    });

    var pt = new Table_(SHEET.PEOPLE);
    var mine = task ? pt.all().filter(function (p) { return String(p.taskId) === String(task.id); }) : [];
    var keyOf = function (p) {
      return [normGcId_(p.gcId) && 'g' + normGcId_(p.gcId), normEmail_(p.email) && 'e' + normEmail_(p.email), normPhone_(p.phone) && 'p' + normPhone_(p.phone)]
        .filter(function (k) { return k; });
    };
    var byKey = {};
    mine.forEach(function (p) { keyOf(p).forEach(function (k) { byKey[k] = p; }); });
    var clients = new Table_(SHEET.CLIENTS).all();
    var stat = { add: 0, update: 0, same: 0, skipped: 0, byStatus: {} };
    var adds = [];
    var updates = [];
    var seen = {};
    var dates = [];
    people.forEach(function (raw) {
      var st = legacyPersonStatus_(raw);
      var p = {
        firstName: String(raw.firstName || '').trim(),
        lastName: String(raw.lastName || '').trim(),
        email: normEmail_(raw.email),
        phone: raw.phone ? normPhone_(raw.phone) : '',
        gcId: normGcId_(raw.gcId),
        vk: vkLink_(raw.vk),
        source: String(raw.source || '').trim()
      };
      var k = keyOf(p);
      if (!p.firstName && !k.length) { stat.skipped++; return; }
      if (k.some(function (x) { return seen[x]; })) { stat.skipped++; return; }
      k.forEach(function (x) { seen[x] = true; });
      var sentAt = raw.sentAt ? parseTaskDate_(raw.sentAt, '12:00') : '';
      if (isDate_(sentAt)) dates.push(sentAt);
      var data = {
        segment: raw.passed ? LEGACY_PASSED_SEGMENT : segment,
        status: st.status,
        note: st.note,
        channel: legacyChannel_(raw.channel, ref.dicts.channels),
        sentAt: st.status === PERSON_STATUS.TODO ? '' : sentAt,
        variant: raw.variant ? String(raw.variant).replace(/\.0+$/, '') : ''
      };
      stat.byStatus[st.status] = (stat.byStatus[st.status] || 0) + 1;
      var have = null;
      k.forEach(function (x) { if (!have && byKey[x]) have = byKey[x]; });
      if (have) {
        var cur = have.status || PERSON_STATUS.TODO;
        var segFix = raw.passed && String(have.segment || '') !== LEGACY_PASSED_SEGMENT;
        if (segFix) data.segmentFix = true;
        // Раньше «Написал — Нет» переносилось как «Удалён»; теперь это «Не пишем».
        var toSkip = cur === PERSON_STATUS.REMOVED && data.status === PERSON_STATUS.SKIP;
        if (toSkip) data.toSkip = true;
        if (segFix || toSkip || (PERSON_RANK_[data.status] || 0) > (PERSON_RANK_[cur] || 0) || (data.note && !String(have.note || '').trim())) {
          stat.update++;
          updates.push({ row: have._row, data: data, cur: cur, note: have.note });
        } else stat.same++;
        return;
      }
      stat.add++;
      adds.push(Object.assign(p, data));
    });
    var view = {
      taskName: name, taskId: task ? String(task.id) : '', isNew: !task, segment: segment,
      passed: people.filter(function (p) { return p.passed; }).length,
      passed: people.filter(function (p) { return p.passed; }).length,
      templates: templates.length, templatesNew: tplNew, add: stat.add, update: stat.update, same: stat.same, skipped: stat.skipped, byStatus: stat.byStatus
    };
    if (!apply) return view;

    var usedSegs = [segment];
    adds.concat(updates.map(function (u) { return { segment: u.data.segmentFix ? LEGACY_PASSED_SEGMENT : segment }; }))
      .forEach(function (p) { if (usedSegs.indexOf(p.segment) < 0) usedSegs.push(p.segment); });
    if (!task) {
      dates.sort(function (a, b) { return a - b; });
      task = tasksT.append({
        id: tasksT.nextId('Z'), name: name, parentId: '', start: dates.length ? mskDayStart_(dates[0], 0) : '',
        end: dates.length ? mskDayStart_(dates[dates.length - 1], 0) : '', segments: usedSegs.join('\n'),
        description: 'Перенесено из таблицы менеджера', createdAt: now_(), author: user.email
      });
    } else {
      var segs = splitSegments_(task.segments);
      var more = usedSegs.filter(function (x) { return segs.indexOf(x) < 0; });
      if (more.length) tasksT.update(task._row, { segments: segs.concat(more).join('\n') });
    }
    if (tplNew) {
      var tt = new Table_(SHEET.TEMPLATES);
      if (!('taskId' in tt.col)) throw userError_('В листе «Шаблоны» нет колонки «Задание». Откройте меню CRM → «Подготовить таблицу».');
      templates.forEach(function (t) {
        if (tplByN[t.n]) return;
        var row = tt.append({ id: tt.nextId('T'), situation: name, title: 'Вариант ' + t.n, text: legacyTemplateText_(t.text), active: true, taskId: String(task.id), segment: '' });
        tplByN[t.n] = row.id;
      });
      clearRefCache_();
      REF_MEMO_ = null;
    }
    var now = now_();
    updates.forEach(function (u) {
      var patch = { updatedAt: now };
      if (u.data.toSkip || (PERSON_RANK_[u.data.status] || 0) > (PERSON_RANK_[u.cur] || 0)) {
        patch.status = u.data.status;
        if (u.data.sentAt) patch.sentAt = u.data.sentAt;
        if (u.data.channel) patch.channel = u.data.channel;
        if (u.data.variant && tplByN[u.data.variant]) patch.templateId = tplByN[u.data.variant];
      }
      if (u.data.note && !String(u.note || '').trim()) patch.note = u.data.note;
      if (u.data.segmentFix) patch.segment = LEGACY_PASSED_SEGMENT;
      pt.update(u.row, patch);
    });
    if (adds.length) {
      var nextNum = parseInt(String(pt.nextId('U')).slice(1), 10);
      var batch = adds.map(function (p) {
        var dup = findDuplicateClients_(clients, { gcId: p.gcId, email: p.email, phone: p.phone, dialogUrl: p.vk }, null)[0];
        var id = String(nextNum++);
        while (id.length < 4) id = '0' + id;
        return pt.objToRow_({
          id: 'U' + id, taskId: String(task.id), segment: p.segment, firstName: p.firstName, lastName: p.lastName,
          email: p.email, phone: p.phone, gcId: p.gcId, vk: p.vk, source: p.source, status: p.status,
          templateId: p.variant && tplByN[p.variant] ? tplByN[p.variant] : '', channel: p.channel, sentAt: p.sentAt,
          repliedAt: '', clientId: dup ? dup.client.id : '', dealId: '', note: p.note, updatedAt: now
        }, null);
      });
      var start = lastDataRow_(pt.sheet) + 1;
      var need = start + batch.length - 1;
      if (need > pt.sheet.getMaxRows()) pt.sheet.insertRowsAfter(pt.sheet.getMaxRows(), need - pt.sheet.getMaxRows());
      pt.sheet.getRange(start, 1, batch.length, pt.width).setValues(batch);
    }
    view.taskId = String(task.id);
    view.applied = true;
    return view;
  };
  return apply ? withLock_(run) : run();
}
