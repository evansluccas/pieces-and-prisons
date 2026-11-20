import { useEffect, useRef } from 'react';
import { Gfx, HitRegion } from './gfx';

export type DrawFn = (g: Gfx) => void;

interface Props {
  width: number;   // logical resolution
  height: number;
  draw: DrawFn;
  onHit?: (id: string) => void;
  /** Fires when the pointer is released anywhere (for hold-to-act controls). */
  onRelease?: () => void;
}

/**
 * A canvas that renders a low-res logical scene at the largest integer scale
 * that fits its container (crisp pixels, no blur). Sprites are drawn with
 * smoothing off; text uses a real font so it stays sharp at any scale.
 */
export function PixelStage({ width, height, draw, onHit, onRelease }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const hitRef = useRef(onHit);
  const hitsRef = useRef<HitRegion[]>([]);
  const hoverRef = useRef<string | null>(null);
  const scaleRef = useRef(1);
  const releaseRef = useRef(onRelease);
  drawRef.current = draw;
  hitRef.current = onHit;
  releaseRef.current = onRelease;

  useEffect(() => {
    const up = () => releaseRef.current?.();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const s = Math.max(1, Math.floor(Math.min(wrap.clientWidth / width, (window.innerHeight - 24) / height)));
      scaleRef.current = s;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${width * s}px`;
      canvas.style.height = `${height * s}px`;
      canvas.width = Math.round(width * s * dpr);
      canvas.height = Math.round(height * s * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    const loop = (t: number) => {
      const ctx = canvas.getContext('2d')!;
      const k = scaleRef.current * (window.devicePixelRatio || 1);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      const g = new Gfx(ctx, width, height, hoverRef.current, t);
      drawRef.current(g);
      hitsRef.current = g.hits;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [width, height]);

  const locate = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    for (let i = hitsRef.current.length - 1; i >= 0; i--) {
      const h = hitsRef.current[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h.id;
    }
    return null;
  };

  return (
    <div ref={wrapRef} className="stage-wrap">
      <canvas
        ref={canvasRef}
        className="stage"
        onPointerMove={(e) => {
          const id = locate(e);
          hoverRef.current = id;
          (e.target as HTMLCanvasElement).style.cursor = id ? 'pointer' : 'default';
        }}
        onPointerLeave={() => (hoverRef.current = null)}
        onPointerDown={(e) => {
          const id = locate(e);
          if (id) hitRef.current?.(id);
        }}
      />
    </div>
  );
}
