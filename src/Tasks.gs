/**
 * Tasks.gs — задания по спискам: «отработать тех, кто был на эфирах», «смотрел записи» и т. п.
 *
 * Задание (лист «Задания») может иметь подзадания (колонка «Родитель»).
 * В задание загружаются люди (лист «Участники») с сегментом; у задания свои шаблоны
 * (лист «Шаблоны», колонки «Задание» и «Сегмент»). Менеджер копирует шаблон — человек
 * отмечается «Написали» с этим шаблоном и каналом. «Ответил» превращает человека в сделку CRM.
 * По заданию считается, сколько отправлено и сколько ответило по каждому шаблону и сегменту.
 */

var PERSON_STATUS = {
  TODO: 'Не написали',
  SENT: 'Написали',
  REPLIED: 'Ответил',
  NO: 'Не интересно',
  BOUGHT: 'Купил',
  REMOVED: 'Удалён',
  // Решили не писать (например, человек прямо сейчас учится) — с причиной; в цифры не входит.
  SKIP: 'Не пишем'
};
var PERSON_STATUSES = [PERSON_STATUS.TODO, PERSON_STATUS.SENT, PERSON_STATUS.REPLIED, PERSON_STATUS.NO, PERSON_STATUS.BOUGHT, PERSON_STATUS.REMOVED, PERSON_STATUS.SKIP];
/** Статусы, которые считаются ответом человека. */
var ANSWERED_STATUSES = [PERSON_STATUS.REPLIED, PERSON_STATUS.NO, PERSON_STATUS.BOUGHT];

function listTasks() { return api_(function (user) { return svcListTasks_(user); }); }
function getTask(id) { return api_(function (user) { return svcGetTask_(user, id); }); }
function saveTask(task) { return api_(function (user) { return svcSaveTask_(user, task || {}); }); }
function saveTaskTemplate(tpl) { return api_(function (user) { return svcSaveTaskTemplate_(user, tpl || {}); }); }
function importPeople(taskId, segment, rows) { return api_(function (user) { return svcImportPeople_(user, taskId, segment, rows || []); }); }
function markPersonSent(id, templateId, channel) { return api_(function (user) { return svcMarkPersonSent_(user, id, templateId, channel); }); }
function setPersonChannel(id, channel) { return api_(function (user) { return svcSetPersonChannel_(user, id, channel); }); }
function setPersonStatus(id, status, note) { return api_(function (user) { return svcSetPersonStatus_(user, id, status, note); }); }
function personToCrm(id) { return api_(function (user) { return svcPersonToCrm_(user, id); }); }
function saveTemplate(tpl) { return api_(function (user) { return svcSaveTemplate_(user, tpl || {}); }); }
function listTemplates() { return api_(function (user) { return getRef_().templates; }); }
function addNameToGreetings(apply) { return api_(function (user) { return svcAddNameToGreetings_(user, !!apply); }); }

/* ---------- Представление ---------- */

function splitSegments_(v) {
  return String(v || '').split(/\n|;/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function taskView_(t) {
  var v = serialize_(t);
  v.segments = splitSegments_(t.segments);
  return v;
}

function personView_(p) {
  var v = serialize_(p);
  ['gcId', 'phone', 'vk'].forEach(function (f) { v[f] = v[f] === '' || v[f] === undefined ? '' : String(v[f]); });
  v.status = v.status || PERSON_STATUS.TODO;
  v.name = (String(p.firstName || '') + ' ' + String(p.lastName || '')).trim();
  return v;
}

/** Счётчики по людям: всего, написали, ответили (+ по шаблонам и сегментам). */
function taskStats_(people) {
  var s = { total: 0, sent: 0, answered: 0, replied: 0, no: 0, bought: 0, byTemplate: {}, bySegment: {}, byChannel: {} };
  var bump = function (map, key, p) {
    var k = key || '—';
    var x = map[k] || (map[k] = { sent: 0, answered: 0, replied: 0, no: 0, bought: 0, total: 0 });
    x.total++;
    if (p.status !== PERSON_STATUS.TODO) x.sent++;
    if (ANSWERED_STATUSES.indexOf(p.status) >= 0) x.answered++;
    if (p.status === PERSON_STATUS.REPLIED) x.replied++;
    if (p.status === PERSON_STATUS.NO) x.no++;
    if (p.status === PERSON_STATUS.BOUGHT) x.bought++;
  };
  s.removed = 0;
  s.skipped = 0;
  people.forEach(function (raw) {
    var p = { status: raw.status || PERSON_STATUS.TODO };
    // Удалённые из задания не входят в цифры: их убрали из списка как неподходящих.
    if (p.status === PERSON_STATUS.REMOVED) { s.removed++; return; }
    // «Не пишем» — в списке остаются, но не входят в «людей» и конверсию.
    if (p.status === PERSON_STATUS.SKIP) { s.skipped++; return; }
    s.total++;
    if (p.status !== PERSON_STATUS.TODO) s.sent++;
    if (ANSWERED_STATUSES.indexOf(p.status) >= 0) s.answered++;
    if (p.status === PERSON_STATUS.REPLIED) s.replied++;
    if (p.status === PERSON_STATUS.NO) s.no++;
    if (p.status === PERSON_STATUS.BOUGHT) s.bought++;
    bump(s.bySegment, String(raw.segment || '').trim(), p);
    if (p.status !== PERSON_STATUS.TODO) {
      bump(s.byTemplate, String(raw.templateId || '').trim(), p);
      bump(s.byChannel, String(raw.channel || '').trim(), p);
    }
  });
  return s;
}

/* ---------- Список и карточка задания ---------- */

function svcListTasks_(user) {
  var tasks = new Table_(SHEET.TASKS).all();
  var people = new Table_(SHEET.PEOPLE).all();
  var byTask = {};
  people.forEach(function (p) { (byTask[String(p.taskId)] = byTask[String(p.taskId)] || []).push(p); });
  var views = tasks.map(function (t) {
    var v = taskView_(t);
    v.stats = taskStats_(byTask[String(t.id)] || []);
    return v;
  });
  // У родителя — сумма по подзаданиям и его собственным людям.
  views.forEach(function (v) {
    var kids = views.filter(function (k) { return k.parentId === v.id; });
    if (!kids.length) return;
    var all = (byTask[v.id] || []).slice();
    kids.forEach(function (k) { all = all.concat(byTask[k.id] || []); });
    v.totalStats = taskStats_(all);
  });
  views.sort(function (a, b) { return (a.start || '').localeCompare(b.start || '') || String(a.id).localeCompare(String(b.id)); });
  return views;
}

function svcGetTask_(user, id) {
  var t = new Table_(SHEET.TASKS).find('id', id);
  if (!t) throw userError_('Задание ' + id + ' не найдено.');
  var people = new Table_(SHEET.PEOPLE).all().filter(function (p) { return String(p.taskId) === String(id); });
  var templates = getRef_().templates.filter(function (x) { return x.taskId === String(id) && x.active; });
  var v = taskView_(t);
  // Сегменты: заданные вручную + те, что встречаются у людей и шаблонов.
  people.concat(templates).forEach(function (x) {
    var sg = String(x.segment || '').trim();
    if (sg && v.segments.indexOf(sg) < 0) v.segments.push(sg);
  });
  var lastDeal = {};
  new Table_(SHEET.DEALS).all().forEach(function (d) {
    var k = String(d.clientId);
    var t = isDate_(d.createdAt) ? d.createdAt.getTime() : 0;
    if (!lastDeal[k] || t >= lastDeal[k].t) lastDeal[k] = { t: t, id: String(d.id) };
  });
  return {
    task: v,
    people: people.map(function (p) {
      var pv = personView_(p);
      pv.crmDealId = pv.dealId || (pv.clientId && lastDeal[pv.clientId] ? lastDeal[pv.clientId].id : '');
      return pv;
    }),
    templates: templates,
    stats: taskStats_(people),
    statuses: PERSON_STATUSES
  };
}

/* ---------- Создание и правка ---------- */

function svcSaveTask_(user, input) {
  return withLock_(function () {
    var t = new Table_(SHEET.TASKS);
    var name = String(input.name || '').trim();
    if (!name) throw userError_('Назовите задание.', 'name');
    var start = parseTaskDate_(input.start, '00:00');
    var end = parseTaskDate_(input.end, '00:00');
    if (isDate_(start) && isDate_(end) && end < start) throw userError_('Конец раньше начала.', 'end');
    var parentId = String(input.parentId || '').trim();
    if (parentId && !t.find('id', parentId)) throw userError_('Родительское задание ' + parentId + ' не найдено.', 'parentId');
    var data = {
      name: name,
      parentId: parentId,
      start: start,
      end: end,
      segments: (Array.isArray(input.segments) ? input.segments : splitSegments_(input.segments)).join('\n'),
      description: String(input.description || '').trim()
    };
    if (input.id) {
      var row = t.find('id', input.id);
      if (!row) throw userError_('Задание ' + input.id + ' не найдено.');
      if (parentId === String(input.id)) throw userError_('Задание не может быть подзаданием самого себя.', 'parentId');
      return taskView_(t.update(row._row, data));
    }
    data.id = t.nextId('Z');
    data.createdAt = now_();
    data.author = user.email;
    return taskView_(t.append(data));
  });
}

/** Шаблон задания: создаётся или правится прямо в CRM, хранится в листе «Шаблоны». */
function svcSaveTaskTemplate_(user, input) {
  var task = new Table_(SHEET.TASKS).find('id', input.taskId);
  if (!task) throw userError_('Задание не найдено.');
  return svcSaveTemplate_(user, Object.assign({}, input, { taskId: String(task.id), situation: String(task.name) }));
}

/**
 * Любой шаблон (вкладка «Сообщения» и шаблоны заданий). Ситуация — категория, по которой шаблоны
 * сгруппированы. У шаблона задания taskId заполнен, а ситуация — название задания.
 */
function svcSaveTemplate_(user, input) {
  var res = withLock_(function () {
    var t = new Table_(SHEET.TEMPLATES);
    if (input.taskId && !('taskId' in t.col)) throw userError_('В листе «Шаблоны» нет колонки «Задание». Откройте меню CRM → «Подготовить таблицу».');
    var title = String(input.title || '').trim();
    var text = String(input.text || '').trim();
    if (!title) throw userError_('Назовите шаблон.', 'title');
    if (!text) throw userError_('Напишите текст шаблона.', 'text');
    var situation = String(input.situation || '').trim();
    if (!situation) throw userError_('Выберите или впишите категорию.', 'situation');
    var data = {
      title: title,
      text: text,
      situation: situation,
      active: input.active === false ? false : true
    };
    if ('taskId' in t.col) {
      data.taskId = String(input.taskId || '').trim();
      data.segment = String(input.segment || '').trim();
    }
    if (input.id) {
      var row = t.find('id', input.id);
      if (!row) throw userError_('Шаблон ' + input.id + ' не найден.');
      return t.update(row._row, data);
    }
    data.id = t.nextId('T');
    return t.append(data);
  });
  clearRefCache_();
  REF_MEMO_ = null;
  return { id: res.id, title: res.title, text: res.text, segment: res.segment || '', taskId: res.taskId || '', situation: res.situation, active: toBool_(res.active) };
}

/**
 * Имя клиента в приветствиях: «Здравствуйте!» → «Здравствуйте, {Имя}!» (и «Добрый день!» и т. п.)
 * в шаблонах, где {Имя} ещё нет. Шаблоны, где спрашиваем, как обращаться, не трогаем.
 * apply = false — только показать, что изменится.
 */
var GREETING_RE_ = /^(\s*)(Здравствуйте|Добрый день|Добрый вечер|Доброе утро)(\s*)!/;

function svcAddNameToGreetings_(user, apply) {
  var run = function () {
    var t = new Table_(SHEET.TEMPLATES);
    var changes = [];
    t.all().forEach(function (x) {
      var text = String(x.text || '');
      if (text.indexOf('{Имя}') >= 0 || /как (я )?могу к вам обращаться/i.test(text) || !GREETING_RE_.test(text)) return;
      var next = text.replace(GREETING_RE_, '$1$2, {Имя}!');
      changes.push({ id: String(x.id), title: String(x.title), before: text.split('\n')[0], after: next.split('\n')[0] });
      if (apply) t.update(x._row, { text: next });
    });
    return changes;
  };
  var changes = apply ? withLock_(run) : run();
  if (apply) { clearRefCache_(); REF_MEMO_ = null; }
  return { applied: apply, changes: changes };
}

/* ---------- Загрузка списка ---------- */

/** «+7 917 …», «89…» → 7XXXXXXXXXX; VK-ID «214476064» → ссылка. */
function vkLink_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return 'https://vk.com/id' + s;
  if (/vk\.(com|ru)\//i.test(s)) return s;
  return '';
}

/**
 * rows — люди из выгрузки GetCourse (сайт уже разобрал колонки):
 * { firstName, lastName, email, phone, gcId, vk, source }.
 * Повторы внутри задания (по ID GetCourse, почте или телефону) пропускаются.
 * Если человек уже есть в CRM — сразу привязывается к его карточке.
 */
function svcImportPeople_(user, taskId, segment, rows) {
  return withLock_(function () {
    var task = new Table_(SHEET.TASKS).find('id', taskId);
    if (!task) throw userError_('Задание не найдено.');
    var sg = String(segment || '').trim();
    if (!sg) throw userError_('Укажите сегмент для этого списка.', 'segment');
    if (!rows.length) throw userError_('В списке нет людей.');
    if (rows.length > 3000) throw userError_('Слишком большой список: за раз можно загрузить до 3000 человек.');

    var pt = new Table_(SHEET.PEOPLE);
    var clients = new Table_(SHEET.CLIENTS).all();
    var existing = pt.all().filter(function (p) { return String(p.taskId) === String(taskId); });
    var keys = {};
    var keyOf = function (p) {
      return [normGcId_(p.gcId) && 'g' + normGcId_(p.gcId), normEmail_(p.email) && 'e' + normEmail_(p.email), normPhone_(p.phone) && 'p' + normPhone_(p.phone)]
        .filter(function (k) { return k; });
    };
    existing.forEach(function (p) { keyOf(p).forEach(function (k) { keys[k] = true; }); });

    var now = now_();
    var added = 0;
    var skipped = 0;
    var linked = 0;
    var nextNum = parseInt(String(pt.nextId('U')).slice(1), 10);
    var batch = [];
    rows.forEach(function (r) {
      var p = {
        firstName: String(r.firstName || '').trim(),
        lastName: String(r.lastName || '').trim(),
        email: normEmail_(r.email),
        phone: r.phone ? normPhone_(r.phone) : '',
        gcId: normGcId_(r.gcId),
        vk: vkLink_(r.vk),
        source: String(r.source || '').trim()
      };
      var k = keyOf(p);
      if (!p.firstName && !k.length) { skipped++; return; }
      if (k.some(function (x) { return keys[x]; })) { skipped++; return; }
      k.forEach(function (x) { keys[x] = true; });
      var dup = findDuplicateClients_(clients, { gcId: p.gcId, email: p.email, phone: p.phone, dialogUrl: p.vk }, null)[0];
      if (dup) linked++;
      var id = String(nextNum++);
      while (id.length < 4) id = '0' + id;
      p.id = 'U' + id;
      p.taskId = String(taskId);
      p.segment = sg;
      p.status = PERSON_STATUS.TODO;
      p.clientId = dup ? dup.client.id : '';
      p.channel = '';
      p.updatedAt = now;
      batch.push(pt.objToRow_(p, null));
      added++;
    });
    if (batch.length) {
      var start = lastDataRow_(pt.sheet) + 1;
      var need = start + batch.length - 1;
      if (need > pt.sheet.getMaxRows()) pt.sheet.insertRowsAfter(pt.sheet.getMaxRows(), need - pt.sheet.getMaxRows());
      pt.sheet.getRange(start, 1, batch.length, pt.width).setValues(batch);
    }
    // Сегмент запоминаем в задании, чтобы он был виден, даже если людей потом уберут.
    var tt = new Table_(SHEET.TASKS);
    var trow = tt.find('id', taskId);
    var segs = splitSegments_(trow.segments);
    if (segs.indexOf(sg) < 0) tt.update(trow._row, { segments: segs.concat([sg]).join('\n') });
    return { added: added, skipped: skipped, linked: linked };
  });
}

/* ---------- Работа с человеком ---------- */

function personRow_(pt, id) {
  var p = pt.find('id', id);
  if (!p) throw userError_('Человек ' + id + ' не найден в задании.');
  return p;
}

/** Скопировали шаблон и отправили: «Написали», какой шаблон, в какой канал. Повторная отправка обновляет шаблон и время. */
function svcMarkPersonSent_(user, id, templateId, channel) {
  return withLock_(function () {
    var ref = getRef_();
    var pt = new Table_(SHEET.PEOPLE);
    var p = personRow_(pt, id);
    var ch = String(channel || '').trim();
    if (ch && ref.dicts.channels.indexOf(ch) < 0) throw userError_('Выберите канал из списка.', 'channel');
    var patch = { templateId: String(templateId || '').trim(), channel: ch, sentAt: now_(), updatedAt: now_() };
    if (!p.status || p.status === PERSON_STATUS.TODO) patch.status = PERSON_STATUS.SENT;
    return personView_(pt.update(p._row, patch));
  });
}

/** Канал, в который пишем этому человеку, — у каждого свой, сохраняется сразу. */
function svcSetPersonChannel_(user, id, channel) {
  var ch = String(channel || '').trim();
  if (ch && getRef_().dicts.channels.indexOf(ch) < 0) throw userError_('Выберите канал из списка.', 'channel');
  return withLock_(function () {
    var pt = new Table_(SHEET.PEOPLE);
    var p = personRow_(pt, id);
    return personView_(pt.update(p._row, { channel: ch, updatedAt: now_() }));
  });
}

/**
 * Смена статуса. «Ответил» и «Купил» заводят сделку в CRM (если её ещё нет):
 * клиент — найденный по контактам или новый из данных списка, поток «Исходящее»,
 * в истории — отправленный шаблон (на дату отправки) и ответ клиента.
 */
function svcSetPersonStatus_(user, id, status, note) {
  if (PERSON_STATUSES.indexOf(status) < 0) throw userError_('Неизвестный статус.');
  if (status === PERSON_STATUS.REMOVED && !String(note || '').trim()) throw userError_('Напишите причину, почему убираете человека из задания.', 'note');
  if (status === PERSON_STATUS.SKIP && !String(note || '').trim()) throw userError_('Напишите причину, почему не пишем.', 'note');
  var p0 = (function () { return personRow_(new Table_(SHEET.PEOPLE), id); })();
  var dealId = String(p0.dealId || '');
  var clientId = String(p0.clientId || '');
  if ((status === PERSON_STATUS.REPLIED || status === PERSON_STATUS.BOUGHT) && !dealId) {
    var made = createDealFromPerson_(user, p0);
    dealId = made.dealId;
    clientId = made.clientId;
  }
  return withLock_(function () {
    var pt = new Table_(SHEET.PEOPLE);
    var p = personRow_(pt, id);
    var patch = { status: status, updatedAt: now_(), dealId: dealId, clientId: clientId };
    if (ANSWERED_STATUSES.indexOf(status) >= 0 && !isDate_(p.repliedAt)) patch.repliedAt = now_();
    if (status === PERSON_STATUS.TODO) { patch.sentAt = ''; patch.templateId = ''; patch.repliedAt = ''; }
    if (status === PERSON_STATUS.REMOVED) patch.repliedAt = p.repliedAt;
    if (status === PERSON_STATUS.SKIP) { patch.sentAt = ''; patch.templateId = ''; patch.repliedAt = ''; }
    if (note !== undefined && note !== null) patch.note = String(note).trim();
    return personView_(pt.update(p._row, patch));
  });
}

/** «Завести в CRM», не дожидаясь ответа: сделка «Исходящее», статус человека не меняется. */
function svcPersonToCrm_(user, id) {
  var p = personRow_(new Table_(SHEET.PEOPLE), id);
  if (p.dealId) return personView_(p);
  var made = createDealFromPerson_(user, p, false);
  return withLock_(function () {
    var pt = new Table_(SHEET.PEOPLE);
    var row = personRow_(pt, id);
    var v = personView_(pt.update(row._row, { dealId: made.dealId, clientId: made.clientId, updatedAt: now_() }));
    v.crmDealId = made.dealId;
    return v;
  });
}

function createDealFromPerson_(user, p, replied) {
  var task = new Table_(SHEET.TASKS).find('id', p.taskId) || { name: '' };
  var tpl = getRef_().templates.filter(function (t) { return t.id === String(p.templateId); })[0];
  var channel = String(p.channel || '').trim() || (/insta/i.test(p.source) ? 'Инстаграм' : /vk/i.test(p.source) ? 'ВК' : 'GetCourse');
  var payload = {
    deal: {
      channel: channel,
      potok: POTOK.OUT,
      request: 'Задание «' + task.name + '»' + (p.segment ? ', сегмент «' + p.segment + '»' : '') + (tpl ? '. Отправлен шаблон «' + tpl.title + '»' : ''),
      // Клиент уже есть в CRM — «был контакт» отметится сам; иначе человек из списка, раньше не общались.
      priorContact: p.clientId ? '' : 'Нет',
      priorNote: 'Из списка задания ' + p.taskId + (p.segment ? ' (' + p.segment + ')' : '')
    },
    force: true
  };
  if (p.clientId) payload.clientId = String(p.clientId);
  else payload.client = {
    name: (String(p.firstName || '') + ' ' + String(p.lastName || '')).trim() || 'Без имени',
    email: p.email, phone: p.phone ? String(p.phone) : '', gcId: p.gcId ? String(p.gcId) : '', dialogUrl: p.vk
  };
  var res = svcCreateDeal_(user, payload);
  // История: отправленный шаблон (на дату отправки) и ответ клиента.
  if (isDate_(p.sentAt)) {
    svcAddTouch_(user, res.dealId, { type: TOUCH.TEMPLATE, text: tpl ? 'Шаблон: ' + tpl.title : 'Сообщение по заданию', channel: channel, date: p.sentAt.toISOString() });
  }
  if (replied !== false) svcAddTouch_(user, res.dealId, { type: TOUCH.REPLIED, text: 'Ответ на сообщение по заданию', channel: channel });
  return res;
}
