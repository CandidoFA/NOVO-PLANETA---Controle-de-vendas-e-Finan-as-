export function formatKz(value: number | null | undefined): string {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const isNegative = safe < 0;
  const abs = Math.abs(safe);
  const hasDecimals = Math.round(abs * 100) % 100 !== 0;

  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(abs);

  return `${isNegative ? '-' : ''}${formatted} Kz`;
}

export function formatNumber(value: number | null | undefined): string {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('de-DE').format(safe);
}

export function formatDatePT(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const datePart = isoDate.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateTimePT(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return '—';
  // Handles both "YYYY-MM-DD HH:MM:SS" (SQLite datetime) and ISO strings
  const normalized = isoDateTime.includes('T') ? isoDateTime : isoDateTime.replace(' ', 'T') + 'Z';
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) {
    return formatDatePT(isoDateTime);
  }
  const day = String(dt.getDate()).padStart(2, '0');
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const year = dt.getFullYear();
  const hours = String(dt.getHours()).padStart(2, '0');
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function getTodayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthStartISO(year: number, monthIndex0: number): string {
  const month = String(monthIndex0 + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function getMonthEndISO(year: number, monthIndex0: number): string {
  const dt = new Date(year, monthIndex0 + 1, 0);
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${month}-${day}`;
}

export const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export const WEEKDAYS_SHORT_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
