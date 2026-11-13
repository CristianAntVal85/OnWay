import type { ReactNode } from 'react';
import type { WeatherSymbol } from '@onway/geo';

/** Iconos del tiempo (issue #18, D-W6): SVG propios en línea, decorativos (el texto va al lado) y coloreados por la hoja con los tokens `--wx-*`. */
export const WEATHER_ICON_NAMES = ['clear', 'clear-night', 'partly', 'partly-night', 'cloudy', 'rain', 'heavy-rain', 'snow', 'thermometer', 'wind'] as const;
export type WeatherIconName = (typeof WEATHER_ICON_NAMES)[number];

/** El icono de un símbolo del tiempo; la luna solo existe para el cielo despejado y el parcialmente nuboso. */
export function symbolIcon(symbol: WeatherSymbol): WeatherIconName {
  if (symbol.name === 'clear') return symbol.night ? 'clear-night' : 'clear';
  if (symbol.name === 'partly') return symbol.night ? 'partly-night' : 'partly';
  return symbol.name;
}

const CLOUD = 'M13 35a7 7 0 0 1 .8-13.95A10.5 10.5 0 0 1 34 19.6 7.7 7.7 0 0 1 35 35z';
const CLOUD_UP = 'M13 29a7 7 0 0 1 .8-13.95A10.5 10.5 0 0 1 34 13.6 7.7 7.7 0 0 1 35 29z';
const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
const MOON = 'M30 8a16 16 0 1 0 10 28A13 13 0 0 1 30 8z';

function Sun({ cx, cy, radius, rays, ray }: { cx: number; cy: number; radius: number; rays: [number, number]; ray: number }) {
  return (
    <>
      <circle className="wx-sun" cx={cx} cy={cy} r={radius} />
      {SUN_RAYS.map((angle) => (
        <line key={angle} className="wx-sun wx-stroke" strokeWidth={ray} strokeLinecap="round" x1={cx} y1={cy - rays[0]} x2={cx} y2={cy - rays[1]} transform={`rotate(${angle} ${cx} ${cy})`} />
      ))}
    </>
  );
}

const Drop = ({ x, y, length = 6, width = 2.6 }: { x: number; y: number; length?: number; width?: number }) => (
  <line className="wx-rain wx-stroke" strokeWidth={width} strokeLinecap="round" x1={x} y1={y} x2={x - 2.6} y2={y + length} />
);
const Flake = ({ x, y }: { x: number; y: number }) => <circle className="wx-snow" cx={x} cy={y} r={2.2} />;

const SHAPES: Record<WeatherIconName, ReactNode> = {
  clear: <Sun cx={24} cy={24} radius={9} rays={[14, 19]} ray={3} />,
  'clear-night': <path className="wx-moon" d={MOON} />,
  partly: (
    <>
      <Sun cx={18} cy={17} radius={7} rays={[11, 15]} ray={2.6} />
      <path className="wx-cloud" d={CLOUD} />
    </>
  ),
  'partly-night': (
    <>
      <path className="wx-moon" d="M22 6a11 11 0 1 0 8 19A9 9 0 0 1 22 6z" />
      <path className="wx-cloud" d={CLOUD} />
    </>
  ),
  cloudy: <path className="wx-cloud" d={CLOUD} />,
  rain: (
    <>
      <path className="wx-cloud" d={CLOUD_UP} />
      <Drop x={17} y={34} />
      <Drop x={25} y={34} />
      <Drop x={33} y={34} />
    </>
  ),
  'heavy-rain': (
    <>
      <path className="wx-cloud" d={CLOUD_UP} />
      <Drop x={15} y={33} length={9} width={3.2} />
      <Drop x={22} y={34} length={9} width={3.2} />
      <Drop x={29} y={33} length={9} width={3.2} />
      <Drop x={36} y={34} length={9} width={3.2} />
    </>
  ),
  snow: (
    <>
      <path className="wx-cloud" d={CLOUD_UP} />
      <Flake x={17} y={36} />
      <Flake x={25} y={39} />
      <Flake x={33} y={36} />
    </>
  ),
  thermometer: (
    <>
      <rect className="wx-heat" x={20} y={5} width={8} height={26} rx={4} />
      <circle className="wx-heat" cx={24} cy={35} r={8} />
      <rect className="wx-cloud" x={23} y={12} width={2} height={20} rx={1} />
      <line className="wx-heat wx-stroke" strokeWidth={2.4} strokeLinecap="round" x1={32} y1={10} x2={37} y2={10} />
      <line className="wx-heat wx-stroke" strokeWidth={2.4} strokeLinecap="round" x1={32} y1={17} x2={37} y2={17} />
      <line className="wx-heat wx-stroke" strokeWidth={2.4} strokeLinecap="round" x1={32} y1={24} x2={37} y2={24} />
    </>
  ),
  wind: (
    <>
      <path className="wx-wind wx-stroke" strokeWidth={3} strokeLinecap="round" d="M6 17h22a5 5 0 1 0-5-5" />
      <path className="wx-wind wx-stroke" strokeWidth={3} strokeLinecap="round" d="M6 26h32a5 5 0 1 1-5 5" />
      <path className="wx-wind wx-stroke" strokeWidth={3} strokeLinecap="round" d="M6 35h14a4 4 0 1 1-4 4" />
    </>
  ),
};

/** Un icono; sin texto alternativo a propósito: quien lo usa pone al lado el texto que lo dice (el color nunca es lo único que informa). */
export function WeatherIcon({ name, className }: { name: WeatherIconName; className?: string }) {
  return (
    <svg className={className ? `wx-icon ${className}` : 'wx-icon'} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {SHAPES[name]}
    </svg>
  );
}
