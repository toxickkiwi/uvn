/**
 * Api.gs — функции для google.script.run (ТЗ, раздел 5).
 * Каждая возвращает { ok: true, data } или { ok: false, error, field? }.
 */

/** Текущий пользователь, справочники, активные тарифы и шаблоны, настройки, URL приложения. */
function getBootstrap() {
  return api_(function (user) {
    var ref = getRef_();
    return {
      user: { email: user.email, name: user.name, role: user.role },
      dicts: ref.dicts,
      tariffs: ref.tariffs.filter(function (t) { return t.active; }),
      templates: ref.templates.filter(function (t) { return t.active; }),
      settings: ref.settings,
      appUrl: ScriptApp.getService().getUrl() || ''
    };
  });
}
