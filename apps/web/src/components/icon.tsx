import type { ReactNode } from 'react';

/**
 * Iconos de la interfaz (UI-simplificacion, D-S7): SVG propios en línea, de trazo, sobre una rejilla de 24 y con `currentColor`.
 * Son decorativos (`aria-hidden`): el nombre accesible lo da el texto de al lado o el `aria-label` del control que los lleva.
 */
const SHAPES = {
  home: <path d="M4 11.5 12 4l8 7.5M6.5 9.5V20h11V9.5M10 20v-5h4v5" />,
  flag: <path d="M6 21V4m0 1h11l-2.5 4L17 13H6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  route: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 19.5c.4-3.2 2.8-5 6-5s5.6 1.8 6 5M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.9c1.9.6 3.2 2.2 3.5 4.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.5-3.6 3.2-5.5 7-5.5s6.5 1.9 7 5.5" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  layers: <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8zM3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  map: <path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13" />,
  road: <path d="M8 3.5 5 20.5M16 3.5l3 17M12 4.5v3M12 10.5v3M12 16.5v3" />,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15.5V4.5m0 0L7.5 9M12 4.5 16.5 9M5 19.5h14" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
  'chevron-down': <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  'chevron-right': <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  'arrow-left': <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  edit: <path d="M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5zM13.5 7l3.5 3.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
      <path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.5v.5" />
    </>
  ),
  document: <path d="M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4M9.5 12.5h5.5M9.5 16h5.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10 8.5 5.5 3.5L10 15.5z" />
    </>
  ),
  shield: <path d="M12 3.5 5 6v5.5c0 4.5 2.8 7.5 7 9 4.2-1.5 7-4.5 7-9V6z" />,
  cloud: <path d="M7.5 18.5a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5 3.3 3.3 0 0 1-.5 6.5z" />,
  pencil: <path d="M4 20c2-5 4.5-9 8-12.5 2-2 4-3 6-3.5-.5 2-1.5 4-3.5 6C11 13.5 8 16 4 20zM4 20h7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof SHAPES;
export const ICON_NAMES = Object.keys(SHAPES) as IconName[];

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      data-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
