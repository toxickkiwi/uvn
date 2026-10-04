/**
 * Rules.gs — нормализация, валидация, переходы стадий (ТЗ, раздел 4).
 * Функции здесь не читают таблицу: всё нужное передаётся аргументами, поэтому их легко проверять.
 */

var STAGE = {
  NEW: 'Новое',
  TALK: 'В диалоге',
  PICKED: 'Курс подобран',
  ORDER: 'Заказ создан',
  PAID: 'Оплачено',
  POSTPONED: 'Отложено',
  LOST: 'Отказ'
};
var OPEN_STAGES = [STAGE.NEW, STAGE.TALK, STAGE.PICKED, STAGE.ORDER, STAGE.POSTPONED];
var CLOSED_STAGES = [STAGE.PAID, STAGE.LOST];

var POTOK = { INBOUND: 'Входящее', UNPAID: 'Неоплаченный заказ', OUT: 'Исходящее' };

var TOUCH = {
  LEAD: 'Обращение',
  WROTE: 'Написал',
  REPLIED: 'Клиент ответил',
  MATERIALS: 'Отправил материалы',
  TEMPLATE: 'Шаблон',
  STAGE: 'Смена стадии',
  NOTE: 'Заметка менеджера'
};
/** Касания, после которых ставится «Написать повторно» (правило 4.2). */
var FOLLOWUP_TOUCHES = [TOUCH.WROTE, TOUCH.MATERIALS, TOUCH.TEMPLATE];
/** Касания, которые пишет только система. */
var SYSTEM_TOUCHES = [TOUCH.LEAD, TOUCH.STAGE];

var SOURCE_CRM = 'CRM';
var MSK_OFFSET_MS = 3 * 3600 * 1000; // Москва: UTC+3 круглый год
var DAY_MS = 24 * 3600 * 1000;
var CONTACT_FIELDS = ['nick', 'dialogUrl', 'gcId', 'email', 'phone'];
var CONTACT_LABELS = { nick: 'Ник Инстаграм', dialogUrl: 'Ссылка на диалог', gcId: 'ID GetCourse', email: 'Почта', phone: 'Телефон' };

/* ---------- Время ---------- */

/** Текущее время. Тесты подменяют NOW_OVERRIDE_. */
var NOW_OVERRIDE_ = null;
function now_() {
  return NOW_OVERRIDE_ ? new Date(NOW_OVERRIDE_.getTime()) : new Date();
}

/** Начало московских суток, в которые попадает d, со сдвигом на addDays дней. */
function mskDayStart_(d, addDays) {
  var shifted = d.getTime() + MSK_OFFSET_MS;
  var start = shifted - ((shifted % DAY_MS) + DAY_MS) % DAY_MS;
  return new Date(start - MSK_OFFSET_MS + (addDays || 0) * DAY_MS);
}

/** Начало московского месяца, в который попадает d, со сдвигом на addMonths месяцев. */
function mskMonthStart_(d, addMonths) {
  var m = new Date(d.getTime() + MSK_OFFSET_MS);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + (addMonths || 0), 1) - MSK_OFFSET_MS);
}

/** Московская дата со временем «ЧЧ:ММ». */
function mskAt_(dayStart, hhmm) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '10:00'));
  var h = m ? +m[1] : 10;
  var min = m ? +m[2] : 0;
  return new Date(dayStart.getTime() + (h * 60 + min) * 60000);
}

/** 'YYYY-MM-DD' или полная ISO-строка от клиента → Date. Только дата → время по умолчанию. */
function parseTaskDate_(v, defaultTime) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  var s = String(v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    var day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - MSK_OFFSET_MS);
    return mskAt_(day, defaultTime);
  }
  return fromIso_(s);
}

function isDate_(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

/* ---------- Нормализация контактов (4.4) ---------- */

function normNick_(v) {
  var s = String(v || '').trim();
  var m = /instagram\.com\/([^\/?#\s]+)/i.exec(s);
  if (m && ['direct', 'p', 'reel', 'reels', 'stories', 'explore'].indexOf(m[1].toLowerCase()) < 0) s = m[1];
  return s.replace(/\s+/g, '').replace(/^@+/, '').toLowerCase();
}

function normPhone_(v) {
  var d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  return d;
}

function normGcId_(v) {
  return String(v || '').replace(/\D/g, '');
}

/** «ID GetCourse» из ссылки на профиль …/user/control/user/update/id/<цифры>. */
function gcIdFromUrl_(url) {
  var m = /\/user\/control\/user\/update\/id\/(\d+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/** Ключ для сравнения ссылок: без https:// и завершающего / (правило 4.6). */
function urlKey_(url) {
  return String(url || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Определяет, что вставлено в единое поле «Контакт» нового обращения.
 * Возвращает { field, value } — поле клиента и значение.
 */
function detectContact_(raw) {
  var s = String(raw || '').trim();
  if (!s) return { field: '', value: '' };
  if (/instagram\.com\//i.test(s) && !/instagram\.com\/direct\//i.test(s)) return { field: 'nick', value: normNick_(s) };
  if (/^https?:\/\//i.test(s) || /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*/.test(s)) return { field: 'dialogUrl', value: s };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { field: 'email', value: s.toLowerCase() };
  var digits = s.replace(/\D/g, '');
  if (/^[\d\s()+\-]+$/.test(s) && digits.length >= 10) return { field: 'phone', value: normPhone_(s) };
  if (/^\d+$/.test(s)) return { field: 'gcId', value: s };
  return { field: 'nick', value: normNick_(s) };
}

/**
 * Нормализует поля клиента, которые есть в draft (правило 4.4).
 * Если в draft есть contact (единое поле), раскладывает его по нужному полю.
 */
function normalizeClient_(draft) {
  var c = {};
  if (draft.contact) {
    var d = detectContact_(draft.contact);
    if (d.field) c[d.field] = d.value;
  }
  ['name', 'nick', 'dialogUrl', 'gcId', 'email', 'phone'].forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(draft, f)) c[f] = draft[f];
  });
  if ('name' in c) c.name = String(c.name || '').trim().replace(/\s+/g, ' ');
  if ('nick' in c) c.nick = normNick_(c.nick);
  if ('dialogUrl' in c) c.dialogUrl = String(c.dialogUrl || '').trim();
  if ('gcId' in c) c.gcId = normGcId_(c.gcId);
  if ('email' in c) c.email = normEmail_(c.email);
  if ('phone' in c) c.phone = normPhone_(c.phone);
  if (c.dialogUrl && !c.gcId) {
    var id = gcIdFromUrl_(c.dialogUrl);
    if (id) c.gcId = id;
  }
  return c;
}

/** Проверка формата контактов; ошибка с указанием поля. */
function validateClientFields_(c) {
  if ('email' in c && c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) {
    throw userError_('Почта указана с ошибкой: «' + c.email + '».', 'email');
  }
  if ('phone' in c && c.phone && (c.phone.length < 11 || c.phone.length > 15)) {
    throw userError_('Телефон должен быть в формате 7XXXXXXXXXX, сейчас: «' + c.phone + '».', 'phone');
  }
}

function hasContact_(c) {
  return CONTACT_FIELDS.some(function (f) { return String(c[f] || '').trim() !== ''; });
}

/**
 * Совпадения клиента с базой (правило 4.6). Имя дублем не считается.
 * Возвращает [{ client, fields: ['nick', ...] }].
 */
function findDuplicateClients_(clients, draft, excludeId) {
  var c = normalizeClient_(draft);
  var out = [];
  clients.forEach(function (x) {
    if (excludeId && String(x.id) === String(excludeId)) return;
    var hit = [];
    if (c.nick && normNick_(x.nick) === c.nick) hit.push('nick');
    if (c.gcId && normGcId_(x.gcId) === c.gcId) hit.push('gcId');
    if (c.email && normEmail_(x.email) === c.email) hit.push('email');
    if (c.phone && normPhone_(x.phone) === c.phone) hit.push('phone');
    if (c.dialogUrl && urlKey_(x.dialogUrl) && urlKey_(x.dialogUrl) === urlKey_(c.dialogUrl)) hit.push('dialogUrl');
    if (hit.length) out.push({ client: x, fields: hit });
  });
  return out;
}

/* ---------- Стадии (4.1) ---------- */

function isOpenStage_(stage) {
  return OPEN_STAGES.indexOf(stage) >= 0;
}

/** Начальная стадия по потоку (4.2). */
function initialStage_(potok) {
  if (potok === POTOK.OUT) return STAGE.TALK;
  if (potok === POTOK.UNPAID) return STAGE.ORDER;
  return STAGE.NEW;
}

/**
 * Цвет строки (запрос руководителя): зелёный — оплачено, жёлтый — есть перспектива оплаты,
 * белый — пока без перспектив. Закрытые «Отказ» всегда белые.
 */
function dealColor_(deal) {
  if (deal.stage === STAGE.PAID) return 'green';
  if (deal.stage !== STAGE.LOST && toBool_(deal.prospect)) return 'yellow';
  return 'white';
}

/** Задача по умолчанию для новой сделки (4.2). Исходящее — менеджер написал первым: напомнить завтра. */
function defaultTaskForNewDeal_(potok, now, settings) {
  if (potok === POTOK.UNPAID) return { nextTask: 'Написать по заказу', taskAt: new Date(now.getTime() + 10 * 60000) };
  if (potok === POTOK.OUT) {
    return { nextTask: 'Написать повторно', taskAt: mskAt_(mskDayStart_(now, toNumber_(settings.FOLLOWUP_DAYS)), settings.TASK_DEFAULT_TIME) };
  }
  return { nextTask: 'Ответить клиенту', taskAt: new Date(now.getTime()) };
}

/** Задача после касания «Написал», «Отправил материалы», «Шаблон» (4.2). */
function followupTask_(now, settings) {
  return {
    nextTask: 'Написать повторно',
    taskAt: mskAt_(mskDayStart_(now, toNumber_(settings.FOLLOWUP_DAYS)), settings.TASK_DEFAULT_TIME)
  };
}

/**
 * Проверяет сделку перед сохранением и применяет эффекты стадии (4.1, 4.9).
 * deal — итоговое состояние сделки, prev — состояние до изменения (или null для новой).
 * Меняет deal на месте; при нарушении бросает userError_ с полем.
 */
function applyDealRules_(deal, prev, ctx) {
  var dicts = ctx.dicts;
  var now = ctx.now;

  if (!deal.clientId) throw userError_('У сделки не указан клиент.', 'clientId');
  if (!deal.stage) throw userError_('Укажите стадию.', 'stage');
  if (dicts.stages.indexOf(deal.stage) < 0) throw userError_('Неизвестная стадия «' + deal.stage + '».', 'stage');
  checkDict_(deal, prev, 'potok', dicts.potoki, 'поток');
  checkDict_(deal, prev, 'channel', dicts.channels, 'канал');
  checkDict_(deal, prev, 'payMethod', dicts.payMethods, 'способ оплаты');
  checkDict_(deal, prev, 'lostReason', dicts.lostReasons, 'причину отказа');
  deal.prospect = toBool_(deal.prospect);

  if (!prev || (prev.createdAt !== deal.createdAt)) {
    if (isDate_(deal.createdAt) && deal.createdAt.getTime() > now.getTime() + 5 * 60000) {
      throw userError_('Дата создания не может быть в будущем.', 'createdAt');
    }
  }

  if (deal.amount !== '' && deal.amount !== null && deal.amount !== undefined) {
    var n = toNumber_(deal.amount);
    if (n < 0) throw userError_('Сумма не может быть отрицательной.', 'amount');
    deal.amount = n;
  }

  if (isOpenStage_(deal.stage)) {
    if (!isDate_(deal.taskAt)) throw userError_('Укажите дату следующей задачи.', 'taskAt');
    if (!String(deal.nextTask || '').trim()) deal.nextTask = 'Связаться с клиентом';
    if (deal.stage === STAGE.POSTPONED && deal.taskAt.getTime() < mskDayStart_(now, 1).getTime()) {
      throw userError_('Для «Отложено» дата задачи должна быть не раньше завтрашнего дня.', 'taskAt');
    }
  }

  if (deal.stage === STAGE.PAID) {
    if (!(toNumber_(deal.amount) > 0)) throw userError_('Для «Оплачено» укажите сумму больше нуля.', 'amount');
    if (!deal.payMethod) throw userError_('Для «Оплачено» укажите способ оплаты.', 'payMethod');
    if (!isDate_(deal.paidAt)) deal.paidAt = mskDayStart_(now, 0);
    deal.nextTask = '';
    deal.taskAt = '';
    deal.lostReason = '';
  }

  if (deal.stage === STAGE.LOST) {
    if (!deal.lostReason) throw userError_('Для «Отказ» укажите причину.', 'lostReason');
    deal.nextTask = '';
    deal.taskAt = '';
  }
  return deal;
}

/** Значение из справочника проверяется, только если его поменяли: старые записи из импорта не мешают править остальное. */
function checkDict_(deal, prev, field, list, label) {
  if (prev && prev[field] === deal[field]) return;
  if (deal[field] && list.indexOf(deal[field]) < 0) {
    throw userError_('Неизвестное значение «' + deal[field] + '» — выберите ' + label + ' из списка.', field);
  }
}

/** Текст касания «Смена стадии» (4.3). */
function stageChangeText_(from, deal) {
  var text = (from || '—') + ' → ' + deal.stage;
  if (deal.stage === STAGE.LOST && deal.lostReason) text += ': ' + deal.lostReason;
  if (deal.stage === STAGE.PAID) text += ', ' + formatRub_(deal.amount);
  return text;
}

/* ---------- Шаблоны (4.8) ---------- */

function formatRub_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Math.round(toNumber_(v));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

/** Значения переменных шаблона для сделки. */
function templateVars_(deal, client, user) {
  return {
    'Имя': client ? String(client.name || '').trim() : '',
    'Курс': deal ? String(deal.course || '').trim() : '',
    'Тариф': deal ? String(deal.tariff || '').trim() : '',
    'Сумма': deal && toNumber_(deal.amount) > 0 ? formatRub_(deal.amount) : '',
    'Менеджер': user ? String(user.name || '').trim() : ''
  };
}

/** Подстановка переменных: {text, missing}. Переменная без значения → пустая строка. */
function fillTemplate_(text, vars) {
  var missing = [];
  var out = String(text || '').replace(/\{(Имя|Курс|Тариф|Сумма|Менеджер)\}/g, function (_, name) {
    var v = vars[name];
    if (!v) {
      if (missing.indexOf(name) < 0) missing.push(name);
      return '';
    }
    return v;
  });
  return { text: out, missing: missing };
}

/* ---------- Тарифы (4.7) ---------- */

/** Цена активного тарифа для курса или null (для комбо и свободного текста). */
function tariffPrice_(tariffs, course, tariff) {
  var c = String(course || '').trim();
  var t = String(tariff || '').trim();
  if (!c || !t) return null;
  for (var i = 0; i < tariffs.length; i++) {
    if (tariffs[i].active && tariffs[i].course === c && tariffs[i].tariff === t) return tariffs[i].price;
  }
  return null;
}
