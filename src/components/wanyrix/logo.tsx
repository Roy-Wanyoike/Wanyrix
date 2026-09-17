export function WanyrixLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wanyrix-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset="0.55" stopColor="#ea580c" />
          <stop offset="1" stopColor="#9a3412" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#wanyrix-g)" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="oklch(1 0 0 / 18%)" strokeWidth="1" />
      <path
        d="M11 8.5h11.2v3.1h-7.6v3.4h6.5v3.1h-6.5v6.9H11V8.5Z"
        fill="white"
        fillOpacity="0.96"
      />
      <circle cx="25" cy="8.6" r="2.1" fill="white" fillOpacity="0.85" />
    </svg>
  )
}
