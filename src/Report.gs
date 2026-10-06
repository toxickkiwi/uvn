/**
 * Report.gs — расчёт отчёта (ТЗ, раздел 5, getReport).
 *
 * Конверсия считается по когорте: из сделок, созданных в периоде, сколько сейчас в «Оплачено».
 * Выручка считается по дате оплаты: оплаченные в периоде сделки, когда бы они ни были созданы.
 */

/**
 * deals — строки «Сделки»; from включительно, toExclusive — начало дня после конца периода;
 * touches — строки «Касания» (для активных диалогов), можно не передавать.
 *
 * «Новое» обращение — первая сделка клиента в CRM и при этом «Был контакт» ≠ «Да»:
 * с этим человеком раньше вообще не общались. Остальные обращения периода — повторные.
 * «Активный диалог» — сделка, в которой за период было хоть одно касание (кроме «Смена стадии»).
 */
function computeReport_(deals, from, toExclusive, touches) {
  var inPeriod = function (d) { return isDate_(d) && d >= from && d < toExclusive; };
  var r = {
    from: from.toISOString(),
    to: new Date(toExclusive.getTime() - 1).toISOString(),
    leads: 0,
    byChannel: {},
    byPotok: {},
    paidFromLeads: 0,
    conversion: 0,
    revenue: 0,
    paidCount: 0,
    byCourse: {},
    lostReasons: {},
    funnel: {},
    newLeads: 0,
    newByPotok: {},
    newByChannel: {},
    repeatLeads: 0,
    priorContact: { 'Да': 0, 'Нет': 0, 'Не отмечено': 0 },
    activeDialogs: 0,
    activeByChannel: {}
  };
  var inc = function (obj, key, n) {
    var k = String(key || '').trim() || '—';
    obj[k] = (obj[k] || 0) + (n === undefined ? 1 : n);
  };

  // Первая сделка каждого клиента (по дате создания, при равенстве — по номеру).
  var first = {};
  deals.forEach(function (d) {
    var k = String(d.clientId);
    var t = isDate_(d.createdAt) ? d.createdAt.getTime() : Infinity;
    var f = first[k];
    if (!f || t < f.t || (t === f.t && String(d.id) < String(f.id))) first[k] = { t: t, id: String(d.id) };
  });
  var dealById = {};
  deals.forEach(function (d) { dealById[String(d.id)] = d; });

  deals.forEach(function (d) {
    if (inPeriod(d.createdAt)) {
      var prior = normPrior_(d.priorContact);
      r.priorContact[prior || 'Не отмечено']++;
      var isFirst = first[String(d.clientId)] && first[String(d.clientId)].id === String(d.id);
      if (isFirst && prior !== 'Да') {
        r.newLeads++;
        inc(r.newByPotok, d.potok);
        inc(r.newByChannel, d.channel);
      } else {
        r.repeatLeads++;
      }
      r.leads++;
      inc(r.byChannel, d.channel);
      inc(r.byPotok, d.potok);
      inc(r.funnel, d.stage);
      if (d.stage === STAGE.PAID) r.paidFromLeads++;
      if (d.stage === STAGE.LOST) inc(r.lostReasons, d.lostReason);
    }
    if (d.stage === STAGE.PAID && inPeriod(d.paidAt)) {
      var amount = toNumber_(d.amount);
      r.revenue += amount;
      r.paidCount++;
      var key = String(d.course || '').trim() || '—';
      var c = r.byCourse[key] || (r.byCourse[key] = { count: 0, revenue: 0 });
      c.count++;
      c.revenue += amount;
    }
  });
  // Активные диалоги: сделка × канал касания (канал сделки, если у касания не указан).
  var seenDeal = {};
  var seenPair = {};
  (touches || []).forEach(function (t) {
    if (t.type === TOUCH.STAGE || !inPeriod(t.date)) return;
    var d = dealById[String(t.dealId)];
    if (!d) return;
    var ch = String(t.channel || d.channel || '').trim() || '—';
    if (!seenDeal[d.id]) { seenDeal[d.id] = true; r.activeDialogs++; }
    var key = d.id + '|' + ch;
    if (!seenPair[key]) { seenPair[key] = true; inc(r.activeByChannel, ch); }
  });

  r.conversion = r.leads ? r.paidFromLeads / r.leads : 0;
  return r;
}
