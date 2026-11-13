// Símbolo del tiempo y tramos del día (issue #18). Todo se deriva de los datos que YA trae el proveedor (nubosidad, precipitación, nieve y
// temperatura): ninguno dice si hay tormenta, niebla o probabilidad de lluvia, así que el conjunto de símbolos es cerrado y nunca los inventa.
// Va aquí y no en un componente de React (regla 9); el reloj de quien mira lo inyecta quien llama, para que sirva a la web y a la app móvil.

/** Lo que enseña cada icono: sol, sol con nube, nube, nube con lluvia, nube con lluvia fuerte y nube con nieve. */
export type WeatherSymbolName = 'clear' | 'partly' | 'cloudy' | 'rain' | 'heavy-rain' | 'snow';

export interface WeatherSymbol {
  name: WeatherSymbolName;
  /** Solo `clear` y `partly` tienen variante de noche (luna en lugar de sol). */
  night: boolean;
}

export interface SymbolInput {
  /** Nubosidad (media del periodo), de 0 a 100. */
  cloudCoverPct: number;
  /** Precipitación total del periodo, en mm (incluye la nieve en agua equivalente). */
  precipitationMm: number;
  /** Nieve total del periodo en cm; `null` si el proveedor no la da. */
  snowfallCm: number | null;
  /** Temperatura media del periodo, en °C. */
  temperatureC: number;
  isNight: boolean;
}

/** Por debajo de esta nubosidad el cielo se ve despejado, y a partir de la siguiente, cubierto. */
export const PARTLY_CLOUDY_FROM_PCT = 20;
export const CLOUDY_FROM_PCT = 65;
/** Lluvia total del periodo (un tramo de 6 h) desde la que se dibuja lluvia, y la desde la que se dibuja lluvia fuerte. */
export const RAIN_FROM_MM = 1;
export const HEAVY_RAIN_FROM_MM = 10;
/** Nieve total del periodo, en cm, desde la que se dibuja nieve. Con precipitación de `RAIN_FROM_MM` y temperatura de `SNOW_AT_OR_BELOW_C` o menos, también. */
export const SNOW_FROM_CM = 0.5;
export const SNOW_AT_OR_BELOW_C = 0;

/** Un símbolo para un periodo. La nieve gana a la lluvia y la lluvia, a la nubosidad: lo que cae es lo que importa. */
export function weatherSymbol(input: SymbolInput): WeatherSymbol {
  const snow = input.snowfallCm !== null && input.snowfallCm >= SNOW_FROM_CM;
  const coldPrecipitation = input.precipitationMm >= RAIN_FROM_MM && input.temperatureC <= SNOW_AT_OR_BELOW_C;
  if (snow || coldPrecipitation) return { name: 'snow', night: false };
  if (input.precipitationMm >= HEAVY_RAIN_FROM_MM) return { name: 'heavy-rain', night: false };
  if (input.precipitationMm >= RAIN_FROM_MM) return { name: 'rain', night: false };
  if (input.cloudCoverPct >= CLOUDY_FROM_PCT) return { name: 'cloudy', night: false };
  if (input.cloudCoverPct >= PARTLY_CLOUDY_FROM_PCT) return { name: 'partly', night: input.isNight };
  return { name: 'clear', night: input.isNight };
}

/** La hora de reloj de quien mira para un instante: la fecha (AAAA-MM-DD), la hora (0–23) y los minutos. Lo da `Intl` en la web. */
export interface ClockTime {
  date: string;
  hour: number;
  minute: number;
}

/** Una hora prevista, como la manda el proveedor. */
export interface DayPartHour {
  time: string;
  temperatureC: number;
  precipitationMm: number;
  snowfallCm: number | null;
  cloudCoverPct: number;
}

export type DayPartName = 'morning' | 'afternoon' | 'night';

/** Los tres tramos y su horario de reloj: Mañana 06–12, Tarde 12–18 y Noche 18–24 (de 00 a 06 h no hay tramo propio). */
export const DAY_PARTS: readonly { part: DayPartName; startHour: number; endHour: number }[] = [
  { part: 'morning', startHour: 6, endHour: 12 },
  { part: 'afternoon', startHour: 12, endHour: 18 },
  { part: 'night', startHour: 18, endHour: 24 },
];

export interface DayPartSymbol {
  part: DayPartName;
  startHour: number;
  endHour: number;
  /** `tomorrow` si el tramo ya pasó hoy: el horario basta para entender que es el del día siguiente. */
  day: 'today' | 'tomorrow';
  /** Cuántas horas previstas entran en el símbolo (el tramo en curso solo cuenta las que le quedan). */
  hours: number;
  /** `null` si no hay ninguna hora prevista en el tramo: no se inventa un símbolo. */
  symbol: WeatherSymbol | null;
}

export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
}

const HOUR_MS = 3_600_000;

const nextDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Los tres símbolos de la tarjeta, **en su orden**: primero el tramo en curso y después los siguientes (si ya estamos en la tarde,
 * Tarde, Noche y la Mañana de mañana). De 00 a 06 h el primero es la Mañana de hoy. Cada símbolo sale de las horas previstas de su tramo:
 * nubosidad y temperatura medias, y lluvia y nieve sumadas, para contestar «¿lloverá por la tarde?» y no «¿llueve ahora?». Es de noche
 * en un tramo si lo son más de la mitad de sus horas; el día siguiente usa el mismo amanecer y atardecer que hoy.
 */
export function dayPartSymbols(hourly: readonly DayPartHour[], now: Date, clock: (iso: string) => ClockTime, sun: SunTimes): DayPartSymbol[] {
  const today = clock(now.toISOString());
  const tomorrow = nextDate(today.date);
  const first = today.hour < 12 ? 0 : today.hour < 18 ? 1 : 2;
  const from = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;

  const minuteOf = (iso: string | null): number | null => {
    if (iso === null) return null;
    const time = clock(iso);
    return time.hour * 60 + time.minute;
  };
  const sunrise = minuteOf(sun.sunrise);
  const sunset = minuteOf(sun.sunset);
  const isNightAt = (time: ClockTime): boolean => sunrise !== null && sunset !== null && (time.hour * 60 + time.minute < sunrise || time.hour * 60 + time.minute >= sunset);

  const upcoming = hourly.filter((hour) => Date.parse(hour.time) >= from).map((hour) => ({ hour, at: clock(hour.time) }));

  return [0, 1, 2].map((step): DayPartSymbol => {
    const { part, startHour, endHour } = DAY_PARTS[(first + step) % 3]!;
    const day = first + step >= 3 ? 'tomorrow' : 'today';
    const date = day === 'today' ? today.date : tomorrow;
    const inside = upcoming.filter(({ at }) => at.date === date && at.hour >= startHour && at.hour < endHour);
    if (inside.length === 0) return { part, startHour, endHour, day, hours: 0, symbol: null };
    const snow = inside.map(({ hour }) => hour.snowfallCm).filter((value): value is number => value !== null);
    const symbol = weatherSymbol({
      cloudCoverPct: mean(inside.map(({ hour }) => hour.cloudCoverPct)),
      precipitationMm: inside.reduce((sum, { hour }) => sum + hour.precipitationMm, 0),
      snowfallCm: snow.length === 0 ? null : snow.reduce((sum, value) => sum + value, 0),
      temperatureC: mean(inside.map(({ hour }) => hour.temperatureC)),
      isNight: inside.filter(({ at }) => isNightAt(at)).length * 2 > inside.length,
    });
    return { part, startHour, endHour, day, hours: inside.length, symbol };
  });
}
