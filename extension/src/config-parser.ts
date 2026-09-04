import type { LeagueConfigSection } from '../../shared/models/league-config';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

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
  return clean(labelled?.textContent || parentLabel?.textContent || element.getAttribute('name') || element.getAttribute('aria-label')) || `setting_${index + 1}`;
}

export function looksLikeCommissionerSettingsPage() {
  const haystack = `${document.title} ${location.pathname} ${location.search} ${document.body?.innerText?.slice(0, 6000) ?? ''}`.toLowerCase();
  return /(commissioner|league setup|league settings|scoring|roster settings|lineup settings|waiver|playoff)/.test(haystack);
}

export function parseLeagueConfig(): LeagueConfigSection[] {
  const sections: LeagueConfigSection[] = [];
  const containers = Array.from(document.querySelectorAll('form, fieldset, table, .panel, .card, .section'));
  const used = new Set<Element>();

  for (const [containerIndex, container] of containers.entries()) {
    const controls = Array.from(container.querySelectorAll('input, select, textarea')).filter(control => !used.has(control));
    if (!controls.length) continue;
    const values: LeagueConfigSection['values'] = {};
    controls.forEach((control, index) => {
      used.add(control);
      const label = labelFor(control, index);
      const value = valueFor(control);
      if (value !== null && value !== '') values[label] = value;
    });
    if (!Object.keys(values).length) continue;
    const heading = clean(container.querySelector('legend, caption, h1, h2, h3, h4, .title, .header')?.textContent);
    sections.push({ name: heading || `Settings section ${containerIndex + 1}`, values });
  }

  // RTSports may render some commissioner settings as plain tables rather than form controls.
  for (const [tableIndex, table] of Array.from(document.querySelectorAll('table')).entries()) {
    const values: LeagueConfigSection['values'] = {};
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const cells = Array.from(row.querySelectorAll('th,td')).map(cell => clean(cell.textContent)).filter(Boolean);
      if (cells.length === 2 && cells[0].length < 160 && cells[1].length < 300) values[cells[0]] = cells[1];
    }
    if (Object.keys(values).length >= 2) {
      const caption = clean(table.querySelector('caption')?.textContent);
      sections.push({ name: caption || `Settings table ${tableIndex + 1}`, values });
    }
  }

  return sections;
}
