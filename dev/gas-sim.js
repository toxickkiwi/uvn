/**
 * Локальный симулятор Apps Script для разработки (в Google не загружается).
 * Загружает все src/*.gs в один контекст с упрощёнными SpreadsheetApp, CacheService,
 * LockService, Session, PropertiesService, Utilities, ScriptApp.
 *
 *   const sim = require('./gas-sim').create({ workbook, email: 'max@gmail.com' });
 *   sim.ctx.setupSpreadsheet();
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Date внутри vm-контекста — другой класс, чем снаружи (instanceof не сработает).
// Поэтому даты из JSON создаются конструктором контекста: SimDate ставится в create().
let SimDate = Date;
function reviveCell(v) {
  if (v && typeof v === 'object' && v.$date) return new SimDate(v.$date);
  return v === null || v === undefined ? '' : v;
}

/**
 * Как Google Таблицы: строка «10:00» при записи становится временем — Date 30.12.1899.
 * В 1899 году у Москвы было смещение +2:30:17, поэтому такая Date, прочитанная «по-современному»,
 * даёт сдвинутые часы. Симулятор воспроизводит это, а текст ячейки отдаёт через getDisplayValues.
 */
function sheetValue(v) {
  if (typeof v === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v.trim())) {
    const [h, m] = v.trim().split(':').map(Number);
    const d = new SimDate(Date.UTC(1899, 11, 30, h, m) - (2 * 3600 + 30 * 60 + 17) * 1000);
    d.__shown = pad(h) + ':' + pad(m) + ':00';
    return d;
  }
  return v;
}

function shownValue(v) {
  if (v === '' || v === undefined || v === null) return '';
  if (v.__shown) return v.__shown;
  if (typeof v.toISOString === 'function') return formatDate(v, '', 'dd.MM.yyyy HH:mm:ss');
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v);
}

class Range {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getDisplayValues() {
    return this.getValues().map((r) => r.map(shownValue));
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.grid[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((l) => l.length !== this.nc)) {
      throw new Error(`setValues: размер ${values.length}x${values[0] && values[0].length} не совпадает с диапазоном ${this.nr}x${this.nc}`);
    }
    if (this.row - 1 + this.nr > this.sheet.maxRows || this.col - 1 + this.nc > this.sheet.maxCols) {
      throw new Error('Диапазон выходит за границы листа');
    }
    this.sheet.writes++;
    for (let r = 0; r < this.nr; r++) {
      const gr = this.row - 1 + r;
      while (this.sheet.grid.length <= gr) this.sheet.grid.push([]);
      for (let c = 0; c < this.nc; c++) this.sheet.grid[gr][this.col - 1 + c] = sheetValue(values[r][c]);
    }
    return this;
  }
  setFontWeight() { return this; }
  setNumberFormat(f) {
    this.sheet.formats.push({ col: this.col, fmt: f });
    return this;
  }
  setDataValidation(rule) {
    this.sheet.validations[this.col] = { rule, rows: this.nr };
    return this;
  }
}

class Sheet {
  constructor(name, rows) {
    this.name = name;
    this.grid = rows.map((r) => r.map((v) => sheetValue(reviveCell(v))));
    this.maxRows = Math.max(1000, this.grid.length);
    this.maxCols = Math.max(26, ...this.grid.map((r) => r.length));
    this.frozen = 0;
    this.validations = {};
    this.formats = [];
    this.writes = 0;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      if ((this.grid[r] || []).some((v) => v !== '' && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.grid.forEach((r) => r.forEach((v, i) => { if (v !== '' && v !== undefined) m = Math.max(m, i + 1); }));
    return m;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  getFrozenRows() { return this.frozen; }
  getConditionalFormatRules() { return (this.cf || []).slice(); }
  setConditionalFormatRules(rules) { this.cf = rules.slice(); }
  setFrozenRows(n) { this.frozen = n; }
  getDataRange() {
    return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d*)$/.exec(a);
      if (!m) throw new Error('A1 не поддержан симулятором: ' + a);
      const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
      const r1 = +m[2];
      const r2 = m[4] ? +m[4] : this.maxRows;
      return new Range(this, r1, col, r2 - r1 + 1, 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
}

class Spreadsheet {
  constructor(workbook) {
    this.sheets = Object.keys(workbook).map((n) => new Sheet(n, workbook[n]));
  }
  getSpreadsheetTimeZone() { return this.tz || 'Europe/Moscow'; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) {
    const s = new Sheet(n, []);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getSheets() { return this.sheets.slice(); }
  /** Значения листа как простые массивы (для сравнения снимков). */
  dump(n) {
    const s = this.getSheetByName(n);
    return s.grid.map((r) => r.map((v) => (v && typeof v.toISOString === 'function' ? v.toISOString() : v)));
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

/** Utilities.formatDate для Europe/Moscow (UTC+3 без перехода на летнее время). */
function formatDate(d, tz, fmt) {
  const m = new Date(d.getTime() + 3 * 3600 * 1000);
  return fmt
    .replace('yyyy', m.getUTCFullYear())
    .replace('MM', pad(m.getUTCMonth() + 1))
    .replace('dd', pad(m.getUTCDate()))
    .replace('HH', pad(m.getUTCHours()))
    .replace('mm', pad(m.getUTCMinutes()))
    .replace('ss', pad(m.getUTCSeconds()));
}

function create({ workbook, email = '', appUrl = 'https://script.google.com/macros/s/TEST/exec' }) {
  const realm = vm.createContext({});
  SimDate = vm.runInContext('Date', realm);
  const ss = new Spreadsheet(JSON.parse(JSON.stringify(workbook)));
  const cache = new Map();
  const props = new Map();
  const state = { email, alerts: [], fetches: [] };

  const ctx = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => ss,
      getUi: () => ({ alert: (m) => state.alerts.push(m) }),
      newConditionalFormatRule: () => {
        const r = {};
        const b = {
          whenFormulaSatisfied: (f) => { r.formula = f; return b; },
          setBackground: (c) => { r.bg = c; return b; },
          setRanges: (rs) => { r.ranges = rs; return b; },
          build: () => ({
            ...r,
            getBooleanCondition: () => ({ getCriteriaValues: () => [r.formula], getBackground: () => r.bg })
          })
        };
        return b;
      },
      newDataValidation: () => {
        const rule = {};
        const b = {
          requireValueInRange: (r, show) => { rule.range = r; rule.show = show; return b; },
          requireCheckbox: () => { rule.checkbox = true; return b; },
          requireValueInList: (l, show) => { rule.list = l; rule.show = show; return b; },
          setAllowInvalid: (v) => { rule.allowInvalid = v; return b; },
          build: () => rule
        };
        return b;
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k)
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k)
      })
    },
    Session: { getActiveUser: () => ({ getEmail: () => state.email }) },
    ScriptApp: { getService: () => ({ getUrl: () => appUrl }) },
    Utilities: { formatDate },
    HtmlService: {
      createTemplateFromFile: (name) => ({
        name,
        evaluate() {
          const t = this;
          const out = { name: t.name, vars: t, setTitle() { return out; }, addMetaTag() { return out; } };
          return out;
        }
      })
    }
  };
  Object.assign(realm, ctx);
  const srcDir = path.join(__dirname, '..', 'src');
  fs.readdirSync(srcDir)
    .filter((f) => f.endsWith('.gs'))
    .sort()
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), realm, { filename: f }));
  return { ctx: realm, ss, state, cache, props, Date: SimDate };
}

module.exports = { create };
