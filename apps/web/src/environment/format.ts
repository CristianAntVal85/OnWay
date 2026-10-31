// Formato de números, horas y días del tiempo, la luz y la luna. Los instantes llegan en ISO 8601 con zona y se muestran en la del navegador.

export const decimal = (value: number, locale: string, digits = 0): string => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);

export const clock = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Día del pronóstico (`2026-11-01`, fecha local del punto) como «sáb, 1 nov». Se fija UTC para que la zona del navegador no mueva el día. */
export const dayLabel = (date: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** Día del sol y la luna (`sun.date`) con el mes completo. */
export const longDay = (date: string, locale: string): string => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
