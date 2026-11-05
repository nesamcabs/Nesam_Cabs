import React from 'react';

/**
 * The NESAM emblem + embedded-wordmark lockup from the reference. The emblem JPEG has white margins, so
 * the CSS crops it (127.45% wide, negative offsets) inside a 44px square — do not swap in a plain <img>.
 */
export const Brand: React.FC<{ variant?: 'sidebar' | 'mobile' }> = ({ variant = 'sidebar' }) => (
  <div className={`${variant === 'mobile' ? 'mobile-brand' : 'brand'} nesam-brand`} role="img" aria-label="NESAM Driver">
    <span className="nesam-symbol">
      <img className="real-logo" src="/brand/nesam-emblem.jpg" alt="" width={512} height={497} decoding="async" />
    </span>
    <div className="nesam-brand-text">
      <div className="brand-name">NESAM</div>
      <span className="brand-label">DRIVER</span>
    </div>
  </div>
);
