/**
 * Локальный просмотр интерфейса без Google:
 *   node dev/preview.js dev/fixtures/start.json [порт]
 * Страница собирается из src/Index.html как HtmlService (include), google.script.run
 * отправляет вызовы в симулятор (dev/gas-sim.js) с данными из JSON.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { create } = require('./gas-sim');

const fixture = process.argv[2] || 'dev/fixtures/start.json';
const port = +(process.argv[3] || 8787);
const workbook = JSON.parse(fs.readFileSync(fixture, 'utf8'));
workbook['Пользователи'][1][0] = 'max@gmail.com';
workbook['Пользователи'][2][0] = 'marina@gmail.com';
const sim = create({ workbook, email: process.env.PREVIEW_EMAIL || 'max@gmail.com' });
if (process.env.PREVIEW_NOW) sim.ctx.NOW_OVERRIDE_ = new Date(process.env.PREVIEW_NOW);

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
function page() {
  const html = src('Index.html').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => src(n + '.html'));
  return html.replace('<head>', '<head><script>' + SHIM + '</script>');
}

/** google.script.run, history и url, как в Apps Script, поверх fetch и location.hash. */
const SHIM = `
(function(){
  function runner(ok, fail){
    return new Proxy({}, { get: function(_, name){
      if (name === 'withSuccessHandler') return function(f){ return runner(f, fail); };
      if (name === 'withFailureHandler') return function(f){ return runner(ok, f); };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: name, args: args }) })
          .then(function(r){ return r.json(); })
          .then(function(r){ setTimeout(function(){ r.error ? fail && fail(new Error(r.error)) : ok && ok(r.result); }, 150); });
      };
    }});
  }
  window.google = { script: {
    run: runner(null, null),
    history: { push: function(s, q, h){ location.hash = h || ''; }, setChangeHandler: function(f){ window.addEventListener('hashchange', function(){ f({ location: { hash: location.hash.slice(1) } }); }); } },
    url: { getLocation: function(cb){ cb({ hash: location.hash.slice(1), parameter: {} }); } }
  }};
})();`;

/** google.script.run не умеет передавать Date — ловим такие ответы заранее. */
function assertNoDates(v, p) {
  if (v && typeof v.toISOString === 'function') throw new Error('В ответе объект Date: ' + p);
  if (v && typeof v === 'object') for (const k of Object.keys(v)) assertNoDates(v[k], p + '.' + k);
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      let out;
      try {
        if (!/^[a-zA-Z]+$/.test(fn) || typeof sim.ctx[fn] !== 'function') throw new Error('Нет функции ' + fn);
        const result = sim.ctx[fn](...args);
        assertNoDates(result, fn);
        out = { result };
      } catch (e) {
        console.error(e);
        out = { error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(port, () => console.log('Просмотр: http://localhost:' + port));
