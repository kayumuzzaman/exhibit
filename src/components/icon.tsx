import type { SVGProps } from 'react';

export type IconName =
  | 'archive'
  | 'back'
  | 'clear'
  | 'copy'
  | 'export'
  | 'filter'
  | 'menu'
  | 'record'
  | 'settings'
  | 'stop'
  | 'theme';

const PATHS: Readonly<Record<IconName, string>> = {
  archive: 'M4 5h16v15H4z M2 2h20v4H2z M9 10h6',
  back: 'm15 18-6-6 6-6 M9 12h11',
  clear: 'M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13 M10 11v5 M14 11v5',
  copy: 'M9 9h11v11H9z M4 4h11v5 M4 4v11h5',
  export: 'M12 3v12 M7 8l5-5 5 5 M5 14v6h14v-6',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  record: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  settings:
    'M4 6h10 M18 6h2 M14 4v4 M4 12h2 M10 12h10 M8 10v4 M4 18h10 M18 18h2 M16 16v4',
  stop: 'M7 7h10v10H7z',
  theme:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M4.9 4.9 7 7 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1 7 17 M17 7l2.1-2.1',
};

export function Icon({
  name,
  ...props
}: Readonly<{ name: IconName }> & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      {...props}
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
