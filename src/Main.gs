/**
 * Main.gs — точка входа веб-приложения, проверка доступа, меню таблицы.
 */

var APP_TITLE = 'CRM «Учёт в народ»';

function doGet(e) {
  var user = null;
  try {
    user = currentUser_();
  } catch (err) {
    // У посторонних нет прав на таблицу — чтение «Пользователи» падает. Это тоже «нет доступа».
    console.warn('doGet: ' + err);
  }
  var page;
  if (!user) {
    page = HtmlService.createTemplateFromFile('NoAccess');
    page.email = currentEmail_() || 'не удалось определить';
    return page.evaluate()
      .setTitle('Нет доступа — ' + APP_TITLE)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  page = HtmlService.createTemplateFromFile('Index');
  return page.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Вставка содержимого другого HTML-файла проекта: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------- Доступ (ТЗ, раздел 7.1) ---------- */

function currentEmail_() {
  return normEmail_(Session.getActiveUser().getEmail());
}

/** Активная строка «Пользователи» для вошедшего человека или null. */
function currentUser_() {
  var email = currentEmail_();
  if (!email) return null;
  var users = getRef_().users;
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email && users[i].active) return users[i];
  }
  return null;
}

/** Каждая API-функция начинается с этой проверки. */
function requireUser_() {
  var user = currentUser_();
  if (!user) throw userError_('Нет доступа. Обратитесь к руководителю. Вы вошли как ' + (currentEmail_() || 'неизвестный пользователь') + '.');
  return user;
}

function isBoss_(user) {
  return user.role === 'руководитель';
}

/**
 * Обёртка для функций google.script.run: проверка доступа и перевод исключений
 * в ответ { ok: false, error, field } с понятным текстом.
 */
function api_(fn) {
  try {
    var user = requireUser_();
    return { ok: true, data: fn(user) };
  } catch (e) {
    if (e && e.userMessage) {
      var res = { ok: false, error: e.userMessage };
      if (e.field) res.field = e.field;
      return res;
    }
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: 'Что-то пошло не так на сервере. Повторите действие; если ошибка не уходит — сообщите руководителю. (' + (e && e.message ? e.message : e) + ')' };
  }
}

/* ---------- Меню в таблице (ТЗ, раздел 7.4) ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM')
    .addItem('Открыть приложение', 'menuOpenApp')
    .addSeparator()
    .addItem('Подготовить таблицу', 'setupSpreadsheet')
    .addItem('Включить уведомления', 'setupTriggers')
    .addItem('Показать chat ID Telegram', 'telegramShowChatIds')
    .addItem('Запустить самопроверку', 'runSelfTests')
    .addToUi();
}

function menuOpenApp() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    notify_('Веб-приложение ещё не опубликовано. Инструкция — в README, раздел «Публикация».');
    return;
  }
  var safe = url.replace(/"/g, '&quot;');
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px system-ui,sans-serif">' +
    '<p><a href="' + safe + '" target="_blank" onclick="setTimeout(function(){google.script.host.close()},300)">Открыть CRM в новой вкладке</a></p>' +
    '<p style="color:#666">Ссылку можно сохранить в закладки браузера.</p></div>'
  ).setWidth(320).setHeight(110);
  SpreadsheetApp.getUi().showModalDialog(html, APP_TITLE);
}

/**
 * Простой триггер: руководитель поправил справочник, тарифы, шаблоны, пользователей
 * или настройки — сбрасываем кэш, чтобы приложение увидело изменения сразу, а не через 5 минут.
 */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if ([SHEET.DICTS, SHEET.TARIFFS, SHEET.TEMPLATES, SHEET.USERS, SHEET.SETTINGS].indexOf(name) >= 0) {
      clearRefCache_();
    }
  } catch (err) {
    console.warn('onEdit: ' + err);
  }
}
