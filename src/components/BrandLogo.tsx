import { useState } from 'react';

interface BrandLogoProps {
  logoUrl?: string;
  companyName?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function BrandLogo({ logoUrl, companyName = 'NOVO PLANETA', size = 'md' }: BrandLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const dims =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={`Logótipo ${companyName}`}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${dims} rounded-lg object-contain bg-white border border-slate-200 p-1 shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${dims} rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 border border-slate-800`}
      aria-label={companyName}
    >
      <svg
        viewBox="0 0 36 36"
        className="w-2/3 h-2/3"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="18" cy="18" r="13" stroke="#14B8A6" strokeWidth="2.2" />
        <ellipse
          cx="18"
          cy="18"
          rx="15"
          ry="5.5"
          transform="rotate(-22 18 18)"
          stroke="#F8FAFC"
          strokeWidth="1.8"
        />
        <circle cx="18" cy="18" r="3.5" fill="#14B8A6" />
      </svg>
    </div>
  );
}
