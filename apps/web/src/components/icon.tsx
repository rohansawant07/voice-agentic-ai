import type { CSSProperties } from "react";

const paths = {
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" />
    </>
  ),
  send: (
    <>
      <path d="m12 19 0-14m-6 6 6-6 6 6" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" />
    </>
  ),
  wave: (
    <>
      <path d="M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  plane: (
    <>
      <path d="M10.2 13.8 6 18l-3-1 1-1.5 3-.5m6.2-1.2L9 21l2 .5 1-2 .5-4.7m-2.3-1L18 6a2.1 2.1 0 0 0-3-3l-7.8 7.8m3 3L5 12l2-3 4.4 1.5" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V6m0 7h18v5M3 13V9h7a3 3 0 0 1 3 3v1m8 0v-1a3 3 0 0 0-3-3h-5M6.5 11a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" />
    </>
  ),
  car: (
    <>
      <path d="M5 16H3.5a.5.5 0 0 1-.5-.5V12l2-5h12l2.5 5H21v3.5a.5.5 0 0 1-.5.5H19M3 12h18" />
      <circle cx="7" cy="16.5" r="2" />
      <circle cx="17" cy="16.5" r="2" />
      <path d="M9 16.5h6" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11v3" />
      <path d="M16 13.5h.01" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8a2 2 0 0 0 0 4v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4a2 2 0 0 1 0-4V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v3Zm11-4v13" />
    </>
  ),
  check: (
    <>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14m-7-7h14" />
    </>
  ),
  star: (
    <>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </>
  ),
  link: (
    <>
      <path d="M14 4h6v6m0-6-9 9m-1-7H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
    </>
  ),
};

export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
