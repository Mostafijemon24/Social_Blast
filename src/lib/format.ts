/** Short label for a source page title: "AC Tune-Up & Maintenance" → "AC Tune-Up", "HVAC in Austin, TX" → "Austin". */
export function sourceLabel(title: string): string {
  return title
    .replace(/ &.*| —.*/, '')
    .replace(/^.* in ([^,]+),.*$/, '$1')
    .replace(/^About .*/, 'About');
}

export function money(cents: number): string {
  const d = cents / 100;
  return `$${d % 1 === 0 ? d.toFixed(0) : d.toFixed(2)}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((x) => x[0]!).join('').slice(0, 2).toUpperCase();
}
