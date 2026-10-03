/**
 * Setup.gs — подготовка таблицы и триггеров.
 *
 * setupSpreadsheet() можно запускать сколько угодно раз: она только добавляет
 * недостающее и никогда не меняет и не удаляет существующие данные.
 */

var DEFAULT_SETTINGS = [
  { key: 'GC_USER_URL', value: 'https://uvnschool.ru/user/control/user/update/id/{id}' },
  { key: 'GC_ORDER_URL', value: '' },
  { key: 'FOLLOWUP_DAYS', value: 1 },
  { key: 'TASK_DEFAULT_TIME', value: '10:00' },
  { key: 'NEW_DEAL_ALERT_MIN', value: 10 },
  { key: 'DIGEST_HOUR', value: 9 }
];

/** Значения справочников по умолчанию. Ставятся только в пустую колонку. */
var DEFAULT_DICTS = {
  'Потоки': ['Входящее', 'Неоплаченный заказ', 'Реактивация'],
  'Каналы': ['ВК', 'Инстаграм', 'Макс', 'ТГ', 'Почта', 'GetCourse'],
  'Стадии': ['Новое', 'В диалоге', 'Курс подобран', 'Заказ создан', 'Оплачено', 'Отложено', 'Отказ'],
  'Способы оплаты': ['Полная', 'Банковская рассрочка', 'От организации', 'Задаток 5 000 + остаток', 'Рассрочка по допсоглашению'],
  'Причины отказа': ['Нет денег', 'Отказ банка', 'Нашёл другой курс', 'Не актуально', 'Не отвечает', 'Другое'],
  'Типы касаний': ['Обращение', 'Написал', 'Клиент ответил', 'Отправил материалы', 'Шаблон', 'Смена стадии', 'Заметка менеджера']
};

/** Выпадающие списки: лист → колонка → колонка листа «Справочники». */
var DROPDOWNS = [
  { sheet: 'Сделки', header: 'Поток', dict: 'Потоки' },
  { sheet: 'Сделки', header: 'Канал', dict: 'Каналы' },
  { sheet: 'Сделки', header: 'Стадия', dict: 'Стадии' },
  { sheet: 'Сделки', header: 'Способ оплаты', dict: 'Способы оплаты' },
  { sheet: 'Сделки', header: 'Причина отказа', dict: 'Причины отказа' },
  { sheet: 'Касания', header: 'Тип', dict: 'Типы касаний' }
];

/** Колонки, где цифры — это текст (телефон, номера): формат «обычный текст», чтобы не терялись нули. */
var TEXT_COLUMNS = [
  { sheet: 'Клиенты', header: 'ID GetCourse' },
  { sheet: 'Клиенты', header: 'Телефон' },
  { sheet: 'Сделки', header: 'Номер заказа GetCourse' },
  { sheet: 'Пользователи', header: 'Telegram chat ID' }
];

/**
 * Создаёт недостающие листы и колонки, закрепляет заголовки, ставит выпадающие списки,
 * заполняет пустые справочники и недостающие настройки. Возвращает отчёт о сделанном.
 */
function setupSpreadsheet() {
  var report = withLock_(function () {
    var ss = SpreadsheetApp.getActive();
    var log = [];

    Object.keys(SCHEMA).forEach(function (name) {
      ensureSheet_(ss, name, values_(SCHEMA[name]), log);
    });

    fillDicts_(ss, log);
    fillSettings_(ss, log);
    applyDropdowns_(ss, log);
    applyTextFormats_(ss);

    clearRefCache_();
    return log;
  });

  var msg = report.length ? 'Готово. Что сделано:\n• ' + report.join('\n• ') : 'Готово. Таблица уже в порядке, ничего менять не пришлось.';
  console.log(msg);
  notify_(msg);
  return report;
}

function values_(obj) {
  return Object.keys(obj).map(function (k) { return obj[k]; });
}

/** Создаёт лист, если его нет; дописывает в конец недостающие заголовки; закрепляет первую строку. */
function ensureSheet_(ss, name, headers, log) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    log.push('создан лист «' + name + '»');
  }
  var lastCol = sheet.getLastColumn();
  var existing = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
  if (missing.length) {
    var start = lastCol + 1;
    var need = start + missing.length - 1;
    if (need > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    log.push('на листе «' + name + '» добавлены колонки: ' + missing.join(', '));
  }
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
  return sheet;
}

/** Номер колонки (с 1) по заголовку или 0. */
function headerCol_(sheet, header) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return 0;
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < row.length; i++) {
    if (String(row[i]).trim() === header) return i + 1;
  }
  return 0;
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Пустые колонки «Справочники» заполняются значениями по умолчанию. Заполненные не трогаются. */
function fillDicts_(ss, log) {
  var sheet = ss.getSheetByName(SHEET.DICTS);
  Object.keys(DEFAULT_DICTS).forEach(function (header) {
    var c = headerCol_(sheet, header);
    var last = sheet.getLastRow();
    var current = last > 1 ? sheet.getRange(2, c, last - 1, 1).getValues() : [];
    var hasValues = current.some(function (r) { return String(r[0]).trim() !== ''; });
    if (hasValues) return;
    var vals = DEFAULT_DICTS[header].map(function (v) { return [v]; });
    if (vals.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), vals.length + 1 - sheet.getMaxRows());
    sheet.getRange(2, c, vals.length, 1).setValues(vals);
    log.push('заполнен справочник «' + header + '»');
  });
}

/** В «Настройки» дописываются отсутствующие ключи со значениями по умолчанию. */
function fillSettings_(ss, log) {
  var t = new Table_(SHEET.SETTINGS);
  var keys = t.all().map(function (s) { return String(s.key).trim(); });
  DEFAULT_SETTINGS.forEach(function (s) {
    if (keys.indexOf(s.key) >= 0) return;
    t.append({ key: s.key, value: s.value });
    log.push('добавлена настройка ' + s.key);
  });
}

/** Выпадающие списки из «Справочники» на нужные колонки (со 2-й строки до конца листа). */
function applyDropdowns_(ss, log) {
  var dictSheet = ss.getSheetByName(SHEET.DICTS);
  DROPDOWNS.forEach(function (d) {
    var sheet = ss.getSheetByName(d.sheet);
    var c = headerCol_(sheet, d.header);
    var dc = headerCol_(dictSheet, d.dict);
    if (!c || !dc) return;
    var letter = colLetter_(dc);
    var source = dictSheet.getRange(letter + '2:' + letter);
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(source, true)
      .setAllowInvalid(true)
      .build();
    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, c, rows, 1).setDataValidation(rule);
  });
}

function applyTextFormats_(ss) {
  TEXT_COLUMNS.forEach(function (t) {
    var sheet = ss.getSheetByName(t.sheet);
    var c = headerCol_(sheet, t.header);
    if (!c) return;
    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, c, rows, 1).setNumberFormat('@');
  });
}

/** Всплывающее сообщение, если функция запущена из меню таблицы; из редактора — только лог. */
function notify_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // Запуск из редактора скрипта или триггера: интерфейса таблицы нет.
  }
}

/** Триггеры Telegram — этап 6. */
function setupTriggers() {
  notify_('Уведомления появятся на этапе 6 (Telegram и триггеры).');
}
