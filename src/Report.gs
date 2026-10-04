/**
 * Report.gs — расчёт отчёта (ТЗ, раздел 5, getReport).
 *
 * Конверсия считается по когорте: из сделок, созданных в периоде, сколько сейчас в «Оплачено».
 * Выручка считается по дате оплаты: оплаченные в периоде сделки, когда бы они ни были созданы.
 */

/** deals — строки «Сделки»; from включительно, toExclusive — начало дня после конца периода. */
function computeReport_(deals, from, toExclusive) {
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
    funnel: {}
  };
  var inc = function (obj, key, n) {
    var k = String(key || '').trim() || '—';
    obj[k] = (obj[k] || 0) + (n === undefined ? 1 : n);
  };

  deals.forEach(function (d) {
    if (inPeriod(d.createdAt)) {
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
  r.conversion = r.leads ? r.paidFromLeads / r.leads : 0;
  return r;
}
