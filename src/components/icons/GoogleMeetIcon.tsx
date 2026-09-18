import type { SVGProps } from "react";

export default function GoogleMeetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="5" y="8" width="28" height="32" rx="6" fill="#FFCC00" />
      <path
        d="M32 18.25 40.6 13a2.25 2.25 0 0 1 3.4 1.92v18.16A2.25 2.25 0 0 1 40.6 35L32 29.75v-11.5Z"
        fill="#FF8A00"
      />
      <circle cx="14" cy="32" r="3" fill="#FFFFFF" />
    </svg>
  );
}
