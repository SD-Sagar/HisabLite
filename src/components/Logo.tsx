import type { CSSProperties } from 'react';

/**
 * The Khatay-Kalomay (খাতায়-কলমে) app icon:
 * An open ledger book (খাতা) with an elegant golden fountain pen (কলম)
 * sweeping into a triumphant verified tally checkmark.
 */
export function Logo({ size = 44, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg className="logo" viewBox="0 0 512 512" width={size} height={size} style={style} aria-hidden="true">
      <defs>
        {/* Dynamic theme gradient for the background */}
        <linearGradient id="kk-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary, #4338ca)" />
          <stop offset="100%" stopColor="var(--primary-strong, #1e1b4b)" />
        </linearGradient>

        {/* Kalam Pen Gold Gradient */}
        <linearGradient id="kk-logo-pen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>

        {/* Nib Metallic Gradient */}
        <linearGradient id="kk-logo-nib" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#fef08a" />
        </linearGradient>

        {/* Tally Verified Checkmark Stroke */}
        <linearGradient id="kk-logo-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>

      {/* Squircle Base */}
      <rect width="512" height="512" rx="116" fill="url(#kk-logo-bg)" />

      {/* Ambient Lighting */}
      <circle cx="390" cy="120" r="140" fill="#ffffff" opacity="0.12" />
      <circle cx="120" cy="400" r="120" fill="#f59e0b" opacity="0.1" />

      {/* Book Cover Spine Underlay */}
      <path
        d="M 86 376 C 86 392, 100 404, 116 406 L 244 426 C 252 427, 260 427, 268 426 L 396 406 C 412 404, 426 392, 426 376 L 426 142 C 426 130, 414 120, 400 122 L 268 144 C 260 145, 252 145, 244 144 L 112 122 C 98 120, 86 130, 86 142 Z"
        fill="#0f172a"
        opacity="0.5"
      />

      {/* Left Page (Khata Left Wing) */}
      <path
        d="M 96 142 C 96 130, 108 120, 120 123 L 246 148 C 252 149, 256 155, 256 161 L 256 396 C 256 403, 250 408, 243 407 L 117 383 C 105 381, 96 371, 96 359 Z"
        fill="#ffffff"
      />

      {/* Traditional red khata margin strip */}
      <path
        d="M 96 142 C 96 130, 108 120, 120 123 L 132 125 L 132 385 L 117 383 C 105 381, 96 371, 96 359 Z"
        fill="#fee2e2"
      />
      <line x1="132" y1="125" x2="132" y2="385" stroke="#ef4444" strokeWidth="3" strokeOpacity="0.7" />

      {/* Ledger Entry Lines on Left Page */}
      <rect x="146" y="174" width="82" height="12" rx="6" fill="var(--primary, #4338ca)" />
      <rect x="146" y="214" width="72" height="10" rx="5" fill="#cbd5e1" />
      <rect x="146" y="250" width="86" height="10" rx="5" fill="#cbd5e1" />
      <rect x="146" y="286" width="60" height="10" rx="5" fill="#cbd5e1" />
      <rect x="146" y="322" width="76" height="10" rx="5" fill="#cbd5e1" />

      {/* Right Page (Khata Right Wing) */}
      <path
        d="M 256 161 C 256 155, 260 149, 266 148 L 392 123 C 404 120, 416 130, 416 142 L 416 359 C 416 371, 407 381, 395 383 L 269 407 C 262 408, 256 403, 256 396 Z"
        fill="#f8fafc"
      />

      {/* Right Page Ruling Lines */}
      <rect x="282" y="174" width="90" height="12" rx="6" fill="#94a3b8" />
      <rect x="282" y="214" width="74" height="10" rx="5" fill="#e2e8f0" />
      <rect x="282" y="250" width="84" height="10" rx="5" fill="#e2e8f0" />
      <rect x="282" y="286" width="64" height="10" rx="5" fill="#e2e8f0" />

      {/* Spine Crease */}
      <path d="M 248 148 L 256 161 L 264 148 L 264 404 L 256 396 L 248 404 Z" fill="#cbd5e1" opacity="0.65" />

      {/* Triumphant Checkmark flourishing from pen tip */}
      <path
        d="M 200 324 L 242 366 C 248 372, 258 370, 262 362 L 358 206 C 362 200, 370 198, 376 202 L 388 210 C 394 214, 394 224, 388 230 L 268 392 C 258 404, 240 404, 230 392 L 176 338 C 170 332, 170 322, 176 316 L 186 306 C 192 300, 202 300, 208 306 Z"
        fill="url(#kk-logo-stroke)"
      />

      {/* Kalam: Upper Barrel */}
      <path
        d="M 390 76 L 436 122 C 442 128, 442 138, 436 144 L 342 238 L 296 192 L 390 98 C 396 92, 396 82, 390 76 Z"
        fill="url(#kk-logo-pen)"
      />

      {/* Kalam: Golden Clip */}
      <rect x="368" y="112" width="12" height="64" rx="6" transform="rotate(45 368 112)" fill="#fef08a" />

      {/* Kalam: Metallic Collar */}
      <path d="M 338 234 L 292 188 L 278 202 L 324 248 Z" fill="#ffffff" />
      <path d="M 334 238 L 288 192 L 282 198 L 328 244 Z" fill="#fbbf24" />

      {/* Kalam: Fountain Pen Nib */}
      <path
        d="M 284 196 L 330 242 L 290 282 C 286 286, 276 288, 270 284 L 236 250 C 232 244, 234 234, 238 230 Z"
        fill="url(#kk-logo-nib)"
      />

      {/* Nib Tip Accent */}
      <polygon points="236,250 254,232 246,268" fill="#d97706" />

      {/* Nib Breather Hole & Center Slit */}
      <circle cx="280" cy="240" r="5" fill="#312e81" />
      <line x1="280" y1="240" x2="242" y2="254" stroke="#312e81" strokeWidth="2.5" strokeLinecap="round" />

      {/* Precision Sparkle */}
      <polygon points="438,82 444,98 460,104 444,110 438,126 432,110 416,104 432,98" fill="#fef08a" opacity="0.9" />
    </svg>
  );
}
