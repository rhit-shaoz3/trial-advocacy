import './BrandIcon.css'

/**
 * The Getting to Trial icon (public/favicon.svg), drawn in the theme's colours:
 * its tile is the sidebar's colour in every palette, so it blends in the way
 * the navy original does. The browser tab keeps the navy file.
 */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `brand-icon ${className}` : 'brand-icon'}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="brand-icon-tile" width="64" height="64" rx="14" />
      <circle className="brand-icon-lens" cx="23" cy="23" r="11" strokeWidth="3.5" />
      <path className="brand-icon-line" d="M16.5 21 A 7 7 0 0 1 21 16.5" fill="none" strokeWidth="2" strokeLinecap="round" />
      <line className="brand-icon-line" x1="32" y1="32" x2="35.5" y2="35.5" strokeWidth="5" />
      <line className="brand-icon-line" x1="36" y1="36" x2="51" y2="51" strokeWidth="7.5" strokeLinecap="round" />
      <line className="brand-icon-cut" x1="16" y1="56" x2="46" y2="26" strokeWidth="10" strokeLinecap="round" />
      <line className="brand-icon-line" x1="16" y1="56" x2="46" y2="26" strokeWidth="5" strokeLinecap="round" />
      <g transform="translate(48 24) rotate(45)">
        <rect className="brand-icon-tile" x="-12" y="-6.5" width="24" height="13" rx="2" />
        <rect className="brand-icon-fill" x="-11" y="-5" width="22" height="10" rx="2" />
        <rect className="brand-icon-tile" x="-7.5" y="-5" width="1.6" height="10" />
        <rect className="brand-icon-tile" x="5.9" y="-5" width="1.6" height="10" />
      </g>
    </svg>
  )
}
