/**
 * Setup.gs — подготовка таблицы и триггеров.
 *
 * setupSpreadsheet() можно запускать сколько угодно раз: она только добавляет
 * недостающее и никогда не меняет и не удаляет существующие данные.
 */

var DEFAULT_SETTINGS = [
  { key: 'GC_USER_URL', value: 'https://uvnschool.ru/user/control/user/update/id/{id}' },
  { key: 'GC_ORDER_URL', value: '' },
  { key: 'MANAGER_NAME', value: 'Максим' },
  // Переписка в GetCourse открывается со страницы пользователя: …/update/id/<ID пользователя>#respId=<номер переписки>.
  // Номера переписки по ID пользователя не узнать, поэтому по умолчанию пусто: кнопка «GetCourse» ведёт в профиль.
  { key: 'GC_DIALOG_URL', value: '' },
  { key: 'FOLLOWUP_DAYS', value: 1 },
  { key: 'TASK_DEFAULT_TIME', value: '10:00' },
  { key: 'NEW_DEAL_ALERT_MIN', value: 10 },
  { key: 'DIGEST_HOUR', value: 9 }
];

/** Значения справочников по умолчанию. Ставятся только в пустую колонку. */
var DEFAULT_DICTS = {
  'Потоки': ['Входящее', 'Неоплаченный заказ', 'Исходящее'],
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
  { sheet: 'Касания', header: 'Тип', dict: 'Типы касаний' },
  { sheet: 'Касания', header: 'Канал', dict: 'Каналы' },
  { sheet: 'Сделки', header: 'Где был контакт', dict: 'Каналы' },
  { sheet: 'Сделки', header: 'Был контакт', list: ['Да', 'Нет'] },
  { sheet: 'Сделки', header: 'Оценка', list: ['1', '2', '3'] },
  { sheet: 'Участники', header: 'Статус', list: ['Не написали', 'Написали', 'Ответил', 'Не интересно', 'Купил', 'Удалён', 'Не пишем'] },
  { sheet: 'Участники', header: 'Канал', dict: 'Каналы' }
];

/** Колонки, где цифры — это текст (телефон, номера): формат «обычный текст», чтобы не терялись нули. */
var TEXT_COLUMNS = [
  { sheet: 'Клиенты', header: 'ID GetCourse' },
  { sheet: 'Клиенты', header: 'Телефон' },
  { sheet: 'Сделки', header: 'Номер заказа GetCourse' },
  { sheet: 'Пользователи', header: 'Telegram chat ID' },
  { sheet: 'Участники', header: 'ID GetCourse' },
  { sheet: 'Участники', header: 'Телефон' }
];

/**
 * Создаёт недостающие листы и колонки, закрепляет заголовки, ставит выпадающие списки,
 * заполняет пустые справочники и недостающие настройки. Возвращает отчёт о сделанном.
 */
function setupSpreadsheet() {
  var report = withLock_(function () {
    var ss = SpreadsheetApp.getActive();
    var log = [];

    // ТЗ: часовой пояс Europe/Moscow. Таблица из .xlsx получает пояс аккаунта, и даты в ней сдвигаются.
    if (ss.getSpreadsheetTimeZone() !== 'Europe/Moscow') {
      log.push('часовой пояс таблицы: ' + ss.getSpreadsheetTimeZone() + ' → Europe/Moscow');
      ss.setSpreadsheetTimeZone('Europe/Moscow');
    }

    Object.keys(SCHEMA).forEach(function (name) {
      ensureSheet_(ss, name, values_(SCHEMA[name]), log);
    });

    renamePotok_(ss, 'Реактивация', 'Исходящее', log);
    fillDicts_(ss, log);
    fillSettings_(ss, log);
    applyDropdowns_(ss, log);
    applyTextFormats_(ss);
    applyProspectColumn_(ss);
    migrateScore_(ss, log);
    applyRowColors_(ss);

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

/** Старые значения настроек по умолчанию, которые оказались неверными: заменяются новым значением по умолчанию. */
var OUTDATED_SETTINGS = {
  GC_DIALOG_URL: ['https://uvnschool.ru/pl/tasks/resp?filter%5Bobject_type_id%5D=55#respId={id}']
};

/** В «Настройки» дописываются отсутствующие ключи со значениями по умолчанию. */
function fillSettings_(ss, log) {
  var t = new Table_(SHEET.SETTINGS);
  var rows = t.all();
  var keys = rows.map(function (s) { return String(s.key).trim(); });
  rows.forEach(function (r) {
    var k = String(r.key).trim();
    var old = OUTDATED_SETTINGS[k];
    if (!old || old.indexOf(String(r.value).trim()) < 0) return;
    var def = DEFAULT_SETTINGS.filter(function (d) { return d.key === k; })[0];
    t.update(r._row, { value: def ? def.value : '' });
    log.push('исправлена настройка ' + k);
  });
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
    if (!c) return;
    var builder = SpreadsheetApp.newDataValidation();
    if (d.list) {
      builder = builder.requireValueInList(d.list, true);
    } else {
      var dc = headerCol_(dictSheet, d.dict);
      if (!dc) return;
      var letter = colLetter_(dc);
      builder = builder.requireValueInRange(dictSheet.getRange(letter + '2:' + letter), true);
    }
    var rule = builder.setAllowInvalid(true).build();
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

/**
 * Поток «Реактивация» переименован в «Исходящее» (менеджер пишет первым) — по просьбе руководителя.
 * Меняет значение в «Справочники» и во всех сделках. Повторный запуск ничего не делает.
 */
function renamePotok_(ss, from, to, log) {
  var dict = ss.getSheetByName(SHEET.DICTS);
  var c = headerCol_(dict, 'Потоки');
  var last = dict.getLastRow();
  if (c && last > 1) {
    var vals = dict.getRange(2, c, last - 1, 1).getValues();
    var hasTo = vals.some(function (r) { return String(r[0]).trim() === to; });
    var changed = false;
    vals = vals.map(function (r) {
      if (String(r[0]).trim() !== from) return r;
      changed = true;
      return [hasTo ? '' : to];
    });
    if (changed) {
      dict.getRange(2, c, vals.length, 1).setValues(vals);
      log.push('справочник «Потоки»: «' + from + '» → «' + to + '»');
    }
  }
  var deals = ss.getSheetByName(SHEET.DEALS);
  var dc = headerCol_(deals, 'Поток');
  var dl = deals.getLastRow();
  if (!dc || dl < 2) return;
  var col = deals.getRange(2, dc, dl - 1, 1).getValues();
  var n = 0;
  col = col.map(function (r) {
    if (String(r[0]).trim() !== from) return r;
    n++;
    return [to];
  });
  if (n) {
    deals.getRange(2, dc, col.length, 1).setValues(col);
    log.push('в сделках поток «' + from + '» → «' + to + '»: ' + n + ' шт.');
  }
}

/** «Перспектива» — флажок в каждой строке «Сделки». */
function applyProspectColumn_(ss) {
  var sheet = ss.getSheetByName(SHEET.DEALS);
  var c = headerCol_(sheet, 'Перспектива');
  if (!c) return;
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, c, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
}

/** Оценка появилась позже флажка «Перспектива»: у сделок с перспективой без оценки ставится 3. */
function migrateScore_(ss, log) {
  var sheet = ss.getSheetByName(SHEET.DEALS);
  var pc = headerCol_(sheet, 'Перспектива');
  var sc = headerCol_(sheet, 'Оценка');
  var last = sheet.getLastRow();
  if (!pc || !sc || last < 2) return;
  var p = sheet.getRange(2, pc, last - 1, 1).getValues();
  var range = sheet.getRange(2, sc, last - 1, 1);
  var vals = range.getValues();
  var n = 0;
  vals = vals.map(function (r, i) {
    if (String(r[0]).trim() === '' && toBool_(p[i][0])) { n++; return ['3']; }
    return r;
  });
  if (n) {
    range.setValues(vals);
    log.push('оценка 3 поставлена сделкам с перспективой оплаты: ' + n + ' шт.');
  }
}

/**
 * Цвет строк «Сделки» (условное форматирование): зелёный — «Оплачено», жёлтый — «Перспектива»
 * отмечена и не «Отказ». Остальные — белые. Свои старые правила при повторном запуске заменяются.
 */
var ROW_COLOR_GREEN = '#d9f2e0';
var ROW_COLOR_YELLOW = '#fff4c2';

function applyRowColors_(ss) {
  var sheet = ss.getSheetByName(SHEET.DEALS);
  var stageCol = colLetter_(headerCol_(sheet, 'Стадия'));
  var prospectCol = colLetter_(headerCol_(sheet, 'Перспектива'));
  var width = sheet.getMaxColumns();
  var range = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), width);
  var green = '=$' + stageCol + '2="Оплачено"';
  var yellow = '=AND($' + prospectCol + '2=TRUE,$' + stageCol + '2<>"Отказ",$' + stageCol + '2<>"Оплачено")';

  var keep = sheet.getConditionalFormatRules().filter(function (r) {
    var b = r.getBooleanCondition();
    var vals = b ? b.getCriteriaValues() : [];
    var f = vals.length ? String(vals[0]) : '';
    var bg = b && b.getBackground ? b.getBackground() : '';
    return !(bg === ROW_COLOR_GREEN || bg === ROW_COLOR_YELLOW) || f.indexOf('"Оплачено"') < 0;
  });
  keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(green).setBackground(ROW_COLOR_GREEN).setRanges([range]).build());
  keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(yellow).setBackground(ROW_COLOR_YELLOW).setRanges([range]).build());
  sheet.setConditionalFormatRules(keep);
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
