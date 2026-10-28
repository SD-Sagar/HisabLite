const LINE = 'color-mix(in srgb, var(--primary) 28%, #fff)';

/** The HisabLite app icon, drawn in the current app theme color. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="hl-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary-light)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--primary-strong)' }} />
        </linearGradient>
        <linearGradient id="hl-logo-accent" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#hl-logo-bg)" />

      {/* Left Folio Page (Left pillar of the H) */}
      <rect x="110" y="112" width="120" height="288" rx="24" fill="#ffffff" />
      <rect x="110" y="112" width="30" height="288" rx="15" style={{ fill: 'var(--primary-line)' }} />

      {/* Ledger lines on left page */}
      <rect x="156" y="172" width="56" height="16" rx="8" style={{ fill: 'var(--primary)' }} />
      <rect x="156" y="218" width="56" height="14" rx="7" style={{ fill: LINE }} />
      <rect x="156" y="260" width="46" height="14" rx="7" style={{ fill: LINE }} />
      <rect x="156" y="302" width="52" height="14" rx="7" style={{ fill: LINE }} />

      {/* Center Bridge (Horizontal crossbar of the H) */}
      <rect x="200" y="234" width="112" height="44" rx="22" fill="#ffffff" />
      <rect x="214" y="244" width="84" height="24" rx="12" style={{ fill: 'var(--primary)' }} />

      {/* Right Folio Page (Right pillar of the H) */}
      <rect x="282" y="112" width="120" height="288" rx="24" fill="#ffffff" />
      <rect x="304" y="172" width="76" height="16" rx="8" style={{ fill: 'color-mix(in srgb, var(--primary) 35%, #94a3b8)' }} />
      <rect x="304" y="218" width="60" height="14" rx="7" style={{ fill: LINE }} />
      <rect x="304" y="302" width="76" height="14" rx="7" style={{ fill: LINE }} />

      {/* The 'Lite' Dynamic Surge Checkmark */}
      <path
        d="M236 340 L310 404 C318 411, 330 409, 336 400 L424 250 C432 238, 426 222, 412 218 L368 206 C358 203, 348 209, 345 219 L320 296 L262 254 Z"
        fill="url(#hl-logo-accent)"
      />

      {/* Subtle Spark Accent */}
      <circle cx="414" cy="148" r="14" fill="#38bdf8" />
    </svg>
  );
}
