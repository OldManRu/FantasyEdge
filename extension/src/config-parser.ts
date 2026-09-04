import type { LeagueConfigSection } from '../../shared/models/league-config';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const SENSITIVE = /(uid|user.?id|session|token|csrf|auth|password|passwd|secret|api.?key|access.?key)/i;
const NOISE_HIDDEN = /^(x|submit|action|mode|page|tab|menu|nav|callback|return|redirect)$/i;

function isSensitiveControl(element: Element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return false;
  const haystack = [
    element.getAttribute('name'),
    element.getAttribute('id'),
    element.getAttribute('autocomplete'),
    element.getAttribute('aria-label'),
  ].filter(Boolean).join(' ');
  if (SENSITIVE.test(haystack)) return true;
  if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') return true;
  return false;
}

function shouldCaptureHiddenInput(element: HTMLInputElement) {
  if (element.type.toLowerCase() !== 'hidden') return true;
  const name = clean(element.name || element.id);
  if (!name || SENSITIVE.test(name)) return false;
  if (NOISE_HIDDEN.test(name)) return false;
  return true;
}

function valueFor(element: Element): string | number | boolean | null {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
    const value = clean(element.value);
    const numeric = Number(value);
    return value !== '' && Number.isFinite(numeric) ? numeric : value || null;
  }
  if (element instanceof HTMLSelectElement) return clean(element.selectedOptions[0]?.textContent || element.value) || null;
  if (element instanceof HTMLTextAreaElement) return clean(element.value) || null;
  const value = clean(element.textContent);
  const numeric = Number(value);
  return value !== '' && Number.isFinite(numeric) ? numeric : value || null;
}

function labelFor(element: Element, index: number) {
  const id = element.getAttribute('id');
  const labelled = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const parentLabel = element.closest('label');
  return clean(labelled?.textContent || parentLabel?.textContent || element.getAttribute('name') || element.getAttribute('aria-label') || id) || `setting_${index + 1}`;
}

function uniqueKey(values: LeagueConfigSection['values'], desired: string) {
  const base = clean(desired) || 'setting';
  if (!(base in values)) return base;
  let suffix = 2;
  while (`${base} (${suffix})` in values) suffix += 1;
  return `${base} (${suffix})`;
}

function valueForCell(value: string): string | number | boolean | null {
  const cleaned = clean(value);
  if (/^(yes|enabled|true|on)$/i.test(cleaned)) return true;
  if (/^(no|disabled|false|off)$/i.test(cleaned)) return false;
  const numeric = Number(cleaned.replace(/,/g, ''));
  return cleaned !== '' && Number.isFinite(numeric) ? numeric : cleaned || null;
}

function tableToSection(table: HTMLTableElement, tableIndex: number): LeagueConfigSection | null {
  const rows = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr'));
  if (!rows.length) return null;
  const rowCells = rows.map(row => Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(cell => clean(cell.textContent)));
  const headerRowIndex = rowCells.findIndex((cells, index) => cells.length >= 2 && cells.some(Boolean) && Boolean(rows[index]?.querySelector('th')));
  const headers = headerRowIndex >= 0 ? rowCells[headerRowIndex].map((value, index) => value || `Column ${index + 1}`) : [];
  const values: LeagueConfigSection['values'] = {};

  rowCells.forEach((cells, rowIndex) => {
    const nonEmpty = cells.filter(Boolean);
    if (nonEmpty.length < 2 || rowIndex === headerRowIndex) return;
    if (cells.length === 2) {
      values[uniqueKey(values, cells[0])] = valueForCell(cells[1]);
      return;
    }
    const rowLabel = cells[0] || `Row ${rowIndex + 1}`;
    for (let columnIndex = 1; columnIndex < cells.length; columnIndex += 1) {
      const raw = cells[columnIndex];
      if (!raw) continue;
      const columnLabel = headers[columnIndex] || `Column ${columnIndex + 1}`;
      values[uniqueKey(values, `${rowLabel} — ${columnLabel}`)] = valueForCell(raw);
    }
  });

  if (!Object.keys(values).length) return null;
  const heading = clean(
    table.querySelector('caption')?.textContent ||
    table.closest('fieldset, .panel, .card, .section, div')?.querySelector('legend, h1, h2, h3, h4, .title, .header')?.textContent,
  );
  return { name: heading || `Settings table ${tableIndex + 1}`, values };
}

function visibleTextFallback(): LeagueConfigSection | null {
  const root = document.querySelector('main, #content, #main, .content, form') || document.body;
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,legend,label,th,td,button,a,option,span,div'))
    .filter(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    })
    .map(element => clean(element.textContent))
    .filter(value => value.length > 0 && value.length <= 240 && /(scor|rush|pass|receiv|yard|touchdown|td\b|interception|fumble|kick|field goal|extra point|sack|tackle|assist|defen|return|conversion|point|bonus|lineup|roster|quarterback|running back|wide receiver|tight end|linebacker|defensive|head coach|flex)/i.test(value));

  const unique = Array.from(new Set(candidates)).slice(0, 250);
  if (!unique.length) return null;
  const values: LeagueConfigSection['values'] = {};
  unique.forEach((text, index) => { values[`text_${String(index + 1).padStart(3, '0')}`] = text; });
  return { name: 'Visible RTSports settings text', values };
}

export function looksLikeCommissionerSettingsPage() {
  const haystack = `${document.title} ${location.pathname} ${location.search} ${document.body?.innerText?.slice(0, 12000) ?? ''}`.toLowerCase();
  return /(commissioner|league setup|league settings|manage league|scoring|roster settings|lineup settings|waiver|playoff)/.test(haystack);
}

export function sanitizedPageUrl() {
  const url = new URL(location.href);
  for (const key of Array.from(url.searchParams.keys())) {
    if ((SENSITIVE.test(key) || /^x$/i.test(key)) && !/^lid$/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function relevantSettingsText() {
  const root = document.querySelector('main, #content, #main, .content, form') || document.body;
  const text = clean(root?.textContent).slice(0, 50000);
  return text;
}

export function parseLeagueConfig(): LeagueConfigSection[] {
  const sections: LeagueConfigSection[] = [];
  const used = new Set<Element>();
  const formContainers = Array.from(document.querySelectorAll('fieldset, form, .panel, .card, .section, #content, #main, main'));

  for (const [containerIndex, container] of formContainers.entries()) {
    const controls = Array.from(container.querySelectorAll('input, select, textarea')).filter(control => {
      if (used.has(control) || isSensitiveControl(control)) return false;
      if (control instanceof HTMLInputElement && !shouldCaptureHiddenInput(control)) return false;
      return true;
    });
    if (!controls.length) continue;
    const values: LeagueConfigSection['values'] = {};
    controls.forEach((control, index) => {
      used.add(control);
      const label = labelFor(control, index);
      if (SENSITIVE.test(label)) return;
      const value = valueFor(control);
      if (value !== null && value !== '') values[uniqueKey(values, label)] = value;
    });
    if (!Object.keys(values).length) continue;
    const heading = clean(container.querySelector('legend, h1, h2, h3, h4, .title, .header')?.textContent);
    sections.push({ name: heading || `Settings section ${containerIndex + 1}`, values });
  }

  for (const [tableIndex, table] of Array.from(document.querySelectorAll('table')).entries()) {
    const section = tableToSection(table as HTMLTableElement, tableIndex);
    if (section) sections.push(section);
  }

  const fallback = visibleTextFallback();
  if (fallback) sections.push(fallback);

  const seen = new Set<string>();
  return sections.filter(section => {
    const fingerprint = JSON.stringify(section.values);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}
