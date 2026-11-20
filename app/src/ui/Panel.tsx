import type { CSSProperties, ReactNode } from 'react';
import { spriteUrl } from '../engine/atlas';

/** DOM panel framed with a 9-slice UI sprite (pixel-perfect at 3x). */
export function Panel({ kind = 'night', children, className = '', style }: {
  kind?: 'night' | 'parchment'; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <div
      className={`panel panel-${kind} ${className}`}
      style={{ borderImage: `url(${spriteUrl('ui', `panel_${kind}`)}) 4 fill / 12px stretch`, ...style }}
    >
      {children}
    </div>
  );
}

export function Sprite({ cat, name, size = 48 }: { cat: Parameters<typeof spriteUrl>[0]; name: string; size?: number }) {
  return <img className="px" src={spriteUrl(cat, name, true)} alt="" style={{ height: size }} />;
}
