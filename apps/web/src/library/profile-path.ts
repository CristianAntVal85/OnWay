// Escala del perfil de elevación al dibujo SVG y filas de su tabla equivalente. Puro: sin React ni red.
// Los datos ya vienen calculados del servidor (`elevationProfile`, ≤ 500 pares [distancia m, altitud m]).
export interface ProfileBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ProfileShape {
  /** Puntos de la línea y del relleno, en coordenadas del dibujo. */
  line: string;
  area: string;
  minElevation: number;
  maxElevation: number;
  totalMeters: number;
  /** Marcas de los ejes: valor y posición en el dibujo. */
  xTicks: { value: number; x: number }[];
  yTicks: { value: number; y: number }[];
}

const niceStep = (span: number, target: number): number => {
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((u) => u * power >= raw) ?? 10;
  return unit * power;
};

export function profileShape(profile: readonly (readonly [number, number])[], box: ProfileBox): ProfileShape {
  const total = profile.at(-1)?.[0] ?? 0;
  const values = profile.map(([, z]) => z);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Un poco de aire arriba y abajo; una ruta llana no colapsa el eje.
  const pad = Math.max((max - min) * 0.08, 5);
  const low = Math.floor((min - pad) / 10) * 10;
  const high = Math.ceil((max + pad) / 10) * 10;
  const w = box.width - box.left - box.right;
  const h = box.height - box.top - box.bottom;
  const x = (d: number) => box.left + (total > 0 ? (d / total) * w : 0);
  const y = (z: number) => box.top + h - ((z - low) / (high - low || 1)) * h;
  const points = profile.map(([d, z]) => `${x(d).toFixed(1)},${y(z).toFixed(1)}`);

  const yStep = niceStep(high - low, 4);
  const yTicks: ProfileShape['yTicks'] = [];
  for (let value = Math.ceil(low / yStep) * yStep; value <= high; value += yStep) yTicks.push({ value, y: y(value) });
  const xStep = niceStep(total / 1000, 5) * 1000;
  const xTicks: ProfileShape['xTicks'] = [];
  for (let value = 0; value <= total + 1e-6; value += xStep) xTicks.push({ value, x: x(value) });

  return {
    line: points.join(' '),
    area: `${box.left},${box.top + h} ${points.join(' ')} ${x(total).toFixed(1)},${box.top + h}`,
    minElevation: min,
    maxElevation: max,
    totalMeters: total,
    xTicks,
    yTicks,
  };
}

/** Como mucho `count` filas, repartidas por igual y con la primera y la última, para la tabla que acompaña al perfil. */
export function tableRows(profile: readonly (readonly [number, number])[], count = 21): [number, number][] {
  if (profile.length <= count) return profile.map(([d, z]) => [d, z]);
  const last = profile.length - 1;
  return Array.from({ length: count }, (_, k) => {
    const [d, z] = profile[Math.round((k * last) / (count - 1))]!;
    return [d, z];
  });
}
