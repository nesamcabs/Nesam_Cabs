import React from 'react';
import { ICONS, type IconName } from './icons';

export type { IconName };

/** References a symbol from <IconSprite />, which the shell renders once. */
export const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className = '' }) => (
  <svg className={`vx-icon ${className}`.trim()} aria-hidden="true">
    <use href={`#vi-${name}`} />
  </svg>
);

export const IconSprite: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
    <defs>
      {(Object.keys(ICONS) as IconName[]).map((name) => (
        <symbol key={name} id={`vi-${name}`} viewBox={ICONS[name].viewBox} dangerouslySetInnerHTML={{ __html: ICONS[name].inner }} />
      ))}
    </defs>
  </svg>
);
