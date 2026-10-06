/**
 * Db.gs — чтение и запись листов по заголовкам, блокировки, кэш справочников.
 *
 * Названия листов и заголовки колонок — контракт (ТЗ, раздел 3).
 * Код ищет колонки только по заголовку, порядок колонок может быть любым.
 * Имена полей в JSON — английские; соответствие колонкам задаётся картой SCHEMA.
 */

var SHEET = {
  CLIENTS: 'Клиенты',
  DEALS: 'Сделки',
  TOUCHES: 'Касания',
  TARIFFS: 'Тарифы',
  DICTS: 'Справочники',
  TEMPLATES: 'Шаблоны',
  USERS: 'Пользователи',
  SETTINGS: 'Настройки',
  TASKS: 'Задания',
  PEOPLE: 'Участники'
};

/** Поле JSON → заголовок колонки. Порядок — порядок колонок нового листа. */
var SCHEMA = {};
SCHEMA[SHEET.CLIENTS] = {
  id: 'ID',
  name: 'Имя',
  nick: 'Ник Инстаграм',
  dialogUrl: 'Ссылка на диалог',
  gcId: 'ID GetCourse',
  email: 'Почта',
  phone: 'Телефон',
  check: 'Проверить',
  createdAt: 'Создан',
  author: 'Автор',
  otherLinks: 'Другие ссылки'
};
SCHEMA[SHEET.DEALS] = {
  id: 'ID',
  clientId: 'ID клиента',
  potok: 'Поток',
  channel: 'Канал',
  createdAt: 'Дата создания',
  request: 'Запрос клиента',
  course: 'Курс',
  tariff: 'Тариф',
  amount: 'Сумма, ₽',
  payMethod: 'Способ оплаты',
  orderNo: 'Номер заказа GetCourse',
  paidAt: 'Дата оплаты',
  stage: 'Стадия',
  lostReason: 'Причина отказа',
  nextTask: 'Следующая задача',
  taskAt: 'Дата задачи',
  source: 'Источник',
  check: 'Проверить',
  owner: 'Ответственный',
  updatedAt: 'Изменено',
  prospect: 'Перспектива',
  priorContact: 'Был контакт',
  priorWhere: 'Где был контакт',
  priorWhen: 'Когда был контакт',
  priorNote: 'Комментарий о контакте'
};
SCHEMA[SHEET.TOUCHES] = {
  dealId: 'ID сделки',
  date: 'Дата',
  type: 'Тип',
  text: 'Текст',
  author: 'Автор',
  channel: 'Канал'
};
SCHEMA[SHEET.TARIFFS] = {
  course: 'Курс',
  tariff: 'Тариф',
  price: 'Цена, ₽',
  active: 'Активен'
};
SCHEMA[SHEET.DICTS] = {
  potoki: 'Потоки',
  channels: 'Каналы',
  stages: 'Стадии',
  payMethods: 'Способы оплаты',
  lostReasons: 'Причины отказа',
  touchTypes: 'Типы касаний'
};
SCHEMA[SHEET.TEMPLATES] = {
  id: 'ID',
  situation: 'Ситуация',
  title: 'Название',
  text: 'Текст',
  active: 'Активен',
  taskId: 'Задание',
  segment: 'Сегмент'
};
SCHEMA[SHEET.USERS] = {
  email: 'Почта',
  name: 'Имя',
  role: 'Роль',
  tgChatId: 'Telegram chat ID',
  active: 'Активен'
};
SCHEMA[SHEET.SETTINGS] = {
  key: 'Ключ',
  value: 'Значение'
};
/** Задания по спискам (рассылки): у подзадания заполнен «Родитель». */
SCHEMA[SHEET.TASKS] = {
  id: 'ID',
  name: 'Название',
  parentId: 'Родитель',
  start: 'Начало',
  end: 'Конец',
  segments: 'Сегменты',
  description: 'Описание',
  createdAt: 'Создано',
  author: 'Автор'
};
/** Люди из списков заданий и что с ними сделали. */
SCHEMA[SHEET.PEOPLE] = {
  id: 'ID',
  taskId: 'ID задания',
  segment: 'Сегмент',
  firstName: 'Имя',
  lastName: 'Фамилия',
  email: 'Почта',
  phone: 'Телефон',
  gcId: 'ID GetCourse',
  vk: 'ВК',
  source: 'Откуда пришёл',
  status: 'Статус',
  templateId: 'Шаблон',
  channel: 'Канал',
  sentAt: 'Отправлено',
  repliedAt: 'Ответил',
  clientId: 'ID клиента',
  dealId: 'ID сделки',
  note: 'Комментарий',
  updatedAt: 'Изменено'
};

/**
 * Колонки, добавленные после запуска. Пока «Подготовить таблицу» их не создала,
 * приложение работает без них: читает пустое значение и не пишет.
 */
var OPTIONAL_COLUMNS = {
  prospect: true, otherLinks: true, channel: true, taskId: true, segment: true,
  priorContact: true, priorWhere: true, priorWhen: true, priorNote: true
};

/** Поля, в которых лежат даты (в таблице — настоящие Date, клиенту — ISO-строки). */
var DATE_FIELDS = {
  createdAt: true,
  paidAt: true,
  taskAt: true,
  updatedAt: true,
  date: true,
  priorWhen: true,
  start: true,
  end: true,
  sentAt: true,
  repliedAt: true
};

/** Префикс имён листов. runSelfTests() ставит 'TEST_', чтобы работать на временных копиях. */
var TABLE_PREFIX_ = '';

var CACHE_TTL_SEC = 300;
var CACHE_KEY_REF = 'ref:v1';
var LOCK_WAIT_MS = 10000;

/* ---------- Ошибки для пользователя ---------- */

/**
 * Ошибка с понятным русским текстом. Api-обёртка отдаёт её клиенту как есть;
 * все остальные исключения превращаются в общий текст.
 */
function userError_(message, field) {
  var e = new Error(message);
  e.userMessage = message;
  if (field) e.field = field;
  return e;
}

/* ---------- Таблица ---------- */

/**
 * Обёртка над листом. Лист читается целиком один раз при создании объекта.
 * Строки — объекты с полями из SCHEMA и служебным _row (номер строки на листе).
 */
function Table_(name, opts) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(TABLE_PREFIX_ + name);
  if (!sheet) {
    throw userError_('В таблице нет листа «' + name + '». Откройте меню CRM → «Подготовить таблицу».');
  }
  this.name = name;
  this.sheet = sheet;
  this.fields = SCHEMA[name];
  // headerOnly: только заголовки — для листов, куда лишь дописываем строки (Касания растут быстрее всех).
  var values = opts && opts.headerOnly
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()
    : sheet.getDataRange().getValues();
  this.headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  this.width = this.headers.length;
  this.data = values.slice(1);
  this.col = {};
  for (var f in this.fields) {
    var idx = this.headers.indexOf(this.fields[f]);
    if (idx < 0 && OPTIONAL_COLUMNS[f]) continue;
    if (idx < 0) {
      throw userError_('На листе «' + name + '» нет колонки «' + this.fields[f] +
        '». Откройте меню CRM → «Подготовить таблицу».');
    }
    this.col[f] = idx;
  }
}

/** Все непустые строки листа как объекты. */
Table_.prototype.all = function () {
  var out = [];
  for (var i = 0; i < this.data.length; i++) {
    var obj = this.rowToObj_(this.data[i], i + 2);
    if (obj) out.push(obj);
  }
  return out;
};

/** Первая строка, у которой поле field равно value (сравнение как строк). */
Table_.prototype.find = function (field, value) {
  var c = this.col[field];
  var needle = String(value);
  for (var i = 0; i < this.data.length; i++) {
    if (String(this.data[i][c]) === needle && needle !== '') return this.rowToObj_(this.data[i], i + 2);
  }
  return null;
};

Table_.prototype.rowToObj_ = function (row, rowNum) {
  var empty = true;
  var obj = { _row: rowNum };
  for (var f in this.col) {
    var v = row[this.col[f]];
    if (v !== '' && v !== null) empty = false;
    obj[f] = v === null ? '' : v;
  }
  return empty ? null : obj;
};

/** Собирает массив значений строки; колонки, которых нет в SCHEMA, берутся из base. */
Table_.prototype.objToRow_ = function (obj, base) {
  var row = base ? base.slice() : [];
  while (row.length < this.width) row.push('');
  for (var f in this.col) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      var v = obj[f];
      row[this.col[f]] = v === null || v === undefined ? '' : v;
    }
  }
  return row;
};

/** Добавляет строку в конец листа. Возвращает объект с _row. */
Table_.prototype.append = function (obj) {
  var row = this.objToRow_(obj, null);
  var rowNum = lastDataRow_(this.sheet) + 1;
  if (rowNum > this.sheet.getMaxRows()) this.sheet.insertRowsAfter(this.sheet.getMaxRows(), 50);
  this.sheet.getRange(rowNum, 1, 1, this.width).setValues([row]);
  this.data[rowNum - 2] = row;
  return this.rowToObj_(row, rowNum);
};

/** Меняет поля строки rowNum одним setValues. Возвращает обновлённый объект. */
Table_.prototype.update = function (rowNum, patch) {
  var base = this.data[rowNum - 2];
  if (!base) throw new Error('Строка ' + rowNum + ' на листе ' + this.name + ' не найдена');
  var row = this.objToRow_(patch, base);
  this.sheet.getRange(rowNum, 1, 1, this.width).setValues([row]);
  this.data[rowNum - 2] = row;
  return this.rowToObj_(row, rowNum);
};

/** Следующий ID вида C001: максимальный номер + 1, минимум 3 цифры. */
Table_.prototype.nextId = function (prefix) {
  var c = this.col.id;
  var max = 0;
  var re = new RegExp('^' + prefix + '(\\d+)$');
  for (var i = 0; i < this.data.length; i++) {
    var m = re.exec(String(this.data[i][c]).trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return prefix + n;
};

/** Последняя строка, где есть хоть одно значение (getLastRow учитывает и форматирование). */
function lastDataRow_(sheet) {
  return Math.max(sheet.getLastRow(), 1);
}

/* ---------- Блокировка ---------- */

/** Выполняет fn под общей блокировкой скрипта. Все записи идут только через неё. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw userError_('Таблица сейчас занята другим сохранением. Повторите через несколько секунд.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Справочники, тарифы, шаблоны, пользователи, настройки ---------- */

/**
 * Справочная информация из таблицы, кэш на 5 минут.
 * { dicts: {potoki: [...], ...}, tariffs: [...], templates: [...], users: [...], settings: {KEY: value} }
 */
var REF_MEMO_ = null;

function getRef_() {
  if (TABLE_PREFIX_) return REF_MEMO_ || (REF_MEMO_ = loadRef_());
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY_REF);
  if (hit) return JSON.parse(hit);
  var ref = loadRef_();
  try {
    cache.put(CACHE_KEY_REF, JSON.stringify(ref), CACHE_TTL_SEC);
  } catch (e) {
    console.warn('Справочники не поместились в кэш: ' + e);
  }
  return ref;
}

function clearRefCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY_REF);
}

function loadRef_() {
  var dicts = {};
  var dictTable = new Table_(SHEET.DICTS);
  for (var f in dictTable.col) {
    var c = dictTable.col[f];
    dicts[f] = dictTable.data
      .map(function (r) { return String(r[c]).trim(); })
      .filter(function (v) { return v !== ''; });
  }

  var tariffs = new Table_(SHEET.TARIFFS).all().map(function (t) {
    return {
      course: String(t.course).trim(),
      tariff: String(t.tariff).trim(),
      price: toNumber_(t.price),
      active: toBool_(t.active)
    };
  });

  var templates = new Table_(SHEET.TEMPLATES).all().map(function (t) {
    return {
      id: String(t.id).trim(),
      situation: String(t.situation).trim(),
      title: String(t.title).trim(),
      text: String(t.text),
      active: toBool_(t.active),
      taskId: String(t.taskId || '').trim(),
      segment: String(t.segment || '').trim()
    };
  });

  var users = new Table_(SHEET.USERS).all().map(function (u) {
    return {
      email: normEmail_(u.email),
      name: String(u.name).trim(),
      role: String(u.role).trim().toLowerCase(),
      tgChatId: String(u.tgChatId).trim(),
      active: toBool_(u.active)
    };
  });

  // Настройки читаем так, как они видны в ячейке: «10:00» Google Таблица превращает во время
  // с датой 1899 года, и при чтении как Date часы сдвигаются из-за старого смещения часового пояса.
  var settings = {};
  var st = new Table_(SHEET.SETTINGS);
  var shown = st.sheet.getDataRange().getDisplayValues().slice(1);
  st.data.forEach(function (row, i) {
    var key = String(row[st.col.key]).trim();
    if (!key) return;
    var raw = row[st.col.value];
    var text = String((shown[i] || [])[st.col.value] || '').trim();
    if (raw instanceof Date || /^\d{1,2}:\d{2}/.test(text)) settings[key] = normHhmm_(text);
    else settings[key] = typeof raw === 'number' ? raw : text;
  });

  return { dicts: dicts, tariffs: tariffs, templates: templates, users: users, settings: settings };
}

/** Значение настройки с запасным значением из DEFAULT_SETTINGS. */
function setting_(key) {
  var v = getRef_().settings[key];
  if (v === undefined || v === null || v === '') {
    var d = DEFAULT_SETTINGS.filter(function (s) { return s.key === key; })[0];
    return d ? d.value : '';
  }
  return v;
}

/* ---------- Преобразования значений ---------- */

function toBool_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'да' || s === '1' || s === 'истина';
}

function toNumber_(v) {
  if (typeof v === 'number') return v;
  var s = String(v).replace(/\s/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normEmail_(v) {
  return String(v || '').trim().toLowerCase();
}

/** Дата из таблицы → ISO-строка для клиента; пустое → ''. */
function toIso_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  return '';
}

/** ISO-строка от клиента → Date; пустое → ''. */
function fromIso_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  var d = new Date(v);
  if (isNaN(d.getTime())) throw userError_('Не удалось разобрать дату «' + v + '».');
  return d;
}

/** «10:00:00», «8:30 PM» → «10:00», «20:30». */
function normHhmm_(text) {
  var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(String(text).trim());
  if (!m) return String(text).trim();
  var h = +m[1];
  if (m[3] && /p/i.test(m[3]) && h < 12) h += 12;
  if (m[3] && /a/i.test(m[3]) && h === 12) h = 0;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}

/** Объект строки → JSON для клиента: даты в ISO, без служебного _row. */
function serialize_(obj) {
  if (!obj) return null;
  var out = {};
  for (var k in obj) {
    if (k === '_row') continue;
    var v = obj[k];
    out[k] = DATE_FIELDS[k] ? toIso_(v) : v;
  }
  return out;
}
