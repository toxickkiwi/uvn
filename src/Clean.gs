/**
 * Clean.gs — «Почистить»: поиск дублей клиентов для ручной проверки (раз в неделю).
 *
 * Дубли ищутся по всей базе, группами:
 *  — точно: одинаковый ник, ID GetCourse, почта, телефон, ссылка на диалог, номер или ссылка заказа GetCourse;
 *  — возможно: одинаковые имя и фамилия; одинаковое имя + тот же канал + обращения в пределах 3 дней,
 *    если хотя бы у одного из двоих нет контактов (у обоих есть, но разные — значит, разные люди).
 * У многих клиентов нет ID GetCourse, только номер заказа, — поэтому заказы сравниваются тоже.
 *
 * Менеджер решает сам: «Объединить» (сделки, контакты и участие в заданиях переходят к главному клиенту,
 * дубль удаляется) или «Это разные люди» (пара запоминается в колонке «Не дубль» и больше не показывается).
 */

function listDuplicates() { return api_(function (user) { return svcListDuplicates_(user); }); }
function mergeClients(mainId, otherIds) { return api_(function (user) { return svcMergeClients_(user, mainId, otherIds || []); }); }
function markNotDuplicate(ids) { return api_(function (user) { return svcMarkNotDuplicate_(user, ids || []); }); }

var DUP_REASON = {
  nick: 'одинаковый ник Инстаграм',
  gcId: 'одинаковый ID GetCourse',
  email: 'одинаковая почта',
  phone: 'одинаковый телефон',
  link: 'одинаковая ссылка на диалог',
  order: 'одинаковый заказ GetCourse',
  fullName: 'одинаковые имя и фамилия',
  firstName: 'одно имя, тот же канал, обращения рядом по датам'
};
var DUP_SURE = ['nick', 'gcId', 'email', 'phone', 'link', 'order'];

function normName_(v) {
  return String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Номер заказа GetCourse без «.0» и пробелов. */
function normOrderNo_(v) {
  return String(v === null || v === undefined ? '' : v).trim().replace(/\.0+$/, '').replace(/\s+/g, '');
}

function notDupList_(c) {
  return String(c.notDup || '').split(/[\s,;]+/).filter(function (x) { return x; });
}

/** Разные контакты одного вида — точно разные люди (для «возможных» дублей по имени). */
function contactsConflict_(a, b) {
  var pairs = [
    [normNick_(a.nick), normNick_(b.nick)], [normGcId_(a.gcId), normGcId_(b.gcId)],
    [normEmail_(a.email), normEmail_(b.email)], [normPhone_(a.phone), normPhone_(b.phone)]
  ];
  return pairs.some(function (p) { return p[0] && p[1] && p[0] !== p[1]; });
}

/**
 * Группы дублей. clients, deals — строки листов. Возвращает
 * [{ ids: [...], reasons: { 'C001|C002': ['phone'] }, sure: bool }].
 */
function findDuplicateGroups_(clients, deals) {
  var byId = indexBy_(clients, 'id');
  var pairs = {};
  var addPair = function (a, b, reason) {
    a = String(a); b = String(b);
    if (a === b || !byId[a] || !byId[b]) return;
    var key = a < b ? a + '|' + b : b + '|' + a;
    if (notDupList_(byId[a]).indexOf(b) >= 0 || notDupList_(byId[b]).indexOf(a) >= 0) return;
    var list = pairs[key] || (pairs[key] = []);
    if (list.indexOf(reason) < 0) list.push(reason);
  };
  var bucket = function (map, key, id) {
    if (!key) return;
    var arr = map[key] || (map[key] = []);
    if (arr.indexOf(String(id)) < 0) arr.push(String(id));
  };
  var flush = function (map, reason) {
    Object.keys(map).forEach(function (k) {
      var ids = map[k];
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) addPair(ids[i], ids[j], reason);
    });
  };

  var maps = { nick: {}, gcId: {}, email: {}, phone: {}, link: {}, order: {}, fullName: {}, firstName: {} };
  clients.forEach(function (c) {
    bucket(maps.nick, normNick_(c.nick), c.id);
    bucket(maps.gcId, normGcId_(c.gcId), c.id);
    bucket(maps.email, normEmail_(c.email), c.id);
    var ph = normPhone_(c.phone);
    if (ph.length >= 11) bucket(maps.phone, ph, c.id);
    linkKeys_(c).forEach(function (k) {
      // Общая ссылка «все ответы GetCourse» без номера переписки — не контакт.
      if (/\/pl\/tasks\/resp\/?$/.test(k)) return;
      bucket(maps.link, k, c.id);
    });
    var n = normName_(c.name);
    if (n.split(' ').length >= 2) bucket(maps.fullName, n, c.id);
  });
  deals.forEach(function (d) {
    bucket(maps.order, normOrderNo_(d.orderNo) && 'n' + normOrderNo_(d.orderNo), d.clientId);
    var ou = urlKey_(d.orderUrl);
    if (ou) bucket(maps.order, 'u' + ou, d.clientId);
  });
  // Одно имя + тот же канал + обращения в пределах 3 дней, без разных контактов.
  var near = deals.filter(function (d) { return isDate_(d.createdAt) && byId[String(d.clientId)]; })
    .sort(function (a, b) { return a.createdAt - b.createdAt; });
  for (var i = 0; i < near.length; i++) {
    for (var j = i + 1; j < near.length && near[j].createdAt - near[i].createdAt <= 3 * DAY_MS; j++) {
      var a = byId[String(near[i].clientId)];
      var b = byId[String(near[j].clientId)];
      if (a === b || near[i].channel !== near[j].channel) continue;
      var fa = firstName_(normName_(a.name));
      if (!fa || fa.length < 2 || fa !== firstName_(normName_(b.name)) || /^(без|безымянный|клиент)/.test(fa)) continue;
      // У обоих есть контакты, и ни один не совпал (иначе сработало бы правило выше) — разные люди.
      if (contactsConflict_(a, b) || (hasContact_(a) && hasContact_(b))) continue;
      addPair(a.id, b.id, 'firstName');
    }
  }
  Object.keys(maps).forEach(function (r) { if (r !== 'firstName') flush(maps[r], r); });

  // Пары → группы (связные компоненты).
  var parent = {};
  var find = function (x) { while (parent[x] && parent[x] !== x) x = parent[x]; return x; };
  Object.keys(pairs).forEach(function (key) {
    var ab = key.split('|');
    parent[ab[0]] = parent[ab[0]] || ab[0];
    parent[ab[1]] = parent[ab[1]] || ab[1];
    var ra = find(ab[0]);
    var rb = find(ab[1]);
    if (ra !== rb) parent[rb] = ra;
  });
  var groups = {};
  Object.keys(parent).forEach(function (id) {
    var r = find(id);
    (groups[r] = groups[r] || { ids: [], reasons: {}, sure: false }).ids.push(id);
  });
  Object.keys(pairs).forEach(function (key) {
    var g = groups[find(key.split('|')[0])];
    g.reasons[key] = pairs[key];
    if (pairs[key].some(function (r) { return DUP_SURE.indexOf(r) >= 0; })) g.sure = true;
  });
  return Object.keys(groups).map(function (k) {
    var g = groups[k];
    g.ids.sort();
    return g;
  }).sort(function (a, b) { return (b.sure - a.sure) || a.ids[0].localeCompare(b.ids[0]); });
}

function svcListDuplicates_(user) {
  var clients = new Table_(SHEET.CLIENTS).all();
  var deals = new Table_(SHEET.DEALS).all();
  var byId = indexBy_(clients, 'id');
  var dealsBy = {};
  deals.forEach(function (d) { (dealsBy[String(d.clientId)] = dealsBy[String(d.clientId)] || []).push(d); });
  var groups = findDuplicateGroups_(clients, deals).map(function (g) {
    var reasons = [];
    Object.keys(g.reasons).forEach(function (k) {
      g.reasons[k].forEach(function (r) { if (reasons.indexOf(DUP_REASON[r]) < 0) reasons.push(DUP_REASON[r]); });
    });
    return {
      key: g.ids.join('|'),
      sure: g.sure,
      reasons: reasons,
      clients: g.ids.map(function (id) {
        var v = clientView_(byId[id]);
        v.deals = (dealsBy[id] || []).map(function (d) {
          return { id: d.id, stage: d.stage, channel: d.channel, potok: d.potok, createdAt: toIso_(d.createdAt), request: String(d.request || '').slice(0, 80),
            orderNo: normOrderNo_(d.orderNo), amount: d.amount };
        }).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        return v;
      })
    };
  });
  return { groups: groups, checkedAt: now_().toISOString() };
}

/** Объединить: сделки, контакты и люди из заданий переходят к mainId; дубли удаляются из «Клиенты». */
function svcMergeClients_(user, mainId, otherIds) {
  return withLock_(function () {
    var ct = new Table_(SHEET.CLIENTS);
    var main = ct.find('id', mainId);
    if (!main) throw userError_('Клиент ' + mainId + ' не найден.');
    var others = otherIds.map(String).filter(function (id) { return id !== String(mainId); }).map(function (id) {
      var c = ct.find('id', id);
      if (!c) throw userError_('Клиент ' + id + ' не найден.');
      return c;
    });
    if (!others.length) throw userError_('Выберите, кого объединять.');
    var patch = {};
    var links = splitLinks_(main.otherLinks);
    var notes = [];
    var cur = function (f) { return f in patch ? patch[f] : main[f]; };
    others.forEach(function (o) {
      var extra = [];
      ['nick', 'gcId', 'email', 'phone'].forEach(function (f) {
        var v = String(o[f] || '').trim();
        if (!v) return;
        if (!String(cur(f) || '').trim()) patch[f] = v;
        else if (String(cur(f)).trim() !== v) extra.push(CONTACT_LABELS[f] + ': ' + v);
      });
      [o.dialogUrl].concat(splitLinks_(o.otherLinks)).forEach(function (u) {
        u = String(u || '').trim();
        if (!u) return;
        if (!String(cur('dialogUrl') || '').trim()) { patch.dialogUrl = u; return; }
        var keys = [urlKey_(cur('dialogUrl'))].concat(links.map(urlKey_));
        if (keys.indexOf(urlKey_(u)) < 0) links.push(u);
      });
      notes.push('Объединён с клиентом ' + o.id + ' «' + o.name + '»' + (extra.length ? ' (у него было: ' + extra.join(', ') + ')' : ''));
    });
    if (links.join('\n') !== String(main.otherLinks || '')) patch.otherLinks = links.join('\n');
    var keepNot = notDupList_(main);
    others.forEach(function (o) { notDupList_(o).forEach(function (x) { if (keepNot.indexOf(x) < 0 && x !== String(main.id)) keepNot.push(x); }); });
    if (keepNot.join(' ') !== String(main.notDup || '')) patch.notDup = keepNot.join(' ');
    if (Object.keys(patch).length) ct.update(main._row, patch);

    var ids = others.map(function (o) { return String(o.id); });
    var dt = new Table_(SHEET.DEALS);
    var tt = new Table_(SHEET.TOUCHES, { headerOnly: true });
    var moved = 0;
    var now = now_();
    var mainDeal = dt.all().filter(function (d) { return String(d.clientId) === String(main.id); })
      .sort(function (a, b) { return (isDate_(b.createdAt) ? b.createdAt.getTime() : 0) - (isDate_(a.createdAt) ? a.createdAt.getTime() : 0); })[0];
    dt.all().forEach(function (d) {
      if (ids.indexOf(String(d.clientId)) < 0) return;
      dt.update(d._row, { clientId: String(main.id), updatedAt: now });
      tt.append({ dealId: d.id, date: now, type: TOUCH.NOTE, text: notes[ids.indexOf(String(d.clientId))], author: user.email, channel: d.channel });
      moved++;
    });
    if (mainDeal) notes.forEach(function (n) { tt.append({ dealId: mainDeal.id, date: now, type: TOUCH.NOTE, text: n, author: user.email, channel: mainDeal.channel }); });
    var pt = new Table_(SHEET.PEOPLE);
    pt.all().forEach(function (p) {
      if (ids.indexOf(String(p.clientId)) >= 0) pt.update(p._row, { clientId: String(main.id) });
    });
    // Удаляем снизу вверх, чтобы номера строк не съезжали.
    others.map(function (o) { return o._row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { ct.sheet.deleteRow(r); });
    return { mainId: String(main.id), merged: ids, movedDeals: moved };
  });
}

/** «Это разные люди»: каждый запоминает остальных в колонке «Не дубль». */
function svcMarkNotDuplicate_(user, ids) {
  ids = ids.map(String);
  if (ids.length < 2) throw userError_('Нужно хотя бы два клиента.');
  return withLock_(function () {
    var ct = new Table_(SHEET.CLIENTS);
    if (!('notDup' in ct.col)) throw userError_('В листе «Клиенты» нет колонки «Не дубль». Откройте меню CRM → «Подготовить таблицу».');
    ids.forEach(function (id) {
      var c = ct.find('id', id);
      if (!c) return;
      var list = notDupList_(c);
      ids.forEach(function (x) { if (x !== id && list.indexOf(x) < 0) list.push(x); });
      ct.update(c._row, { notDup: list.join(' ') });
    });
    return { ids: ids };
  });
}
