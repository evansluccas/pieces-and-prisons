import { useEffect, useState } from 'react';
import { PixelStage } from '../../engine/PixelStage';
import type { Gfx } from '../../engine/gfx';
import type { OnlineGameProps } from '../../ui/Online';
import { MarketLog, drawScene } from './RumorExchange';
import { GameState, Orders, orderCash } from './logic';

/** Rumor Exchange at an online table: buy rumors, then place your orders; prices move once everyone has traded. */
export function RumorExchangeOnline({ game, send, onAgain }: OnlineGameProps) {
  const s = game.view as GameState;
  const me = s.players.find((p) => p.id === 'you')!;
  const [sel, setSel] = useState(0);
  const [orders, setOrders] = useState<Orders>({});
  useEffect(() => setOrders({}), [s.round, s.phase]);

  const after = orderCash(s, 'you', orders);
  const setQty = (i: number, q: number) => setOrders((o) => ({ ...o, [i]: Math.max(-me.shares[i], q) }));

  const onHit = (id: string) => {
    if (id === 'again') return onAgain();
    if (id.startsWith('row:')) return setSel(Number(id.slice(4)));
    if (!game.waiting) return;
    const q = orders[sel] ?? 0;
    if (id === 'q-10') setQty(sel, q - 10);
    if (id === 'q-1') setQty(sel, q - 1);
    if (id === 'q+1') setQty(sel, q + 1);
    if (id === 'q+10') setQty(sel, q + 10);
    if (id === 'qmax') setQty(sel, Math.floor((orderCash(s, 'you', { ...orders, [sel]: 0 }) ?? 0) / s.prices[sel]));
    if (id === 'qsell') setQty(sel, -me.shares[sel]);
    if (id === 'qzero') setQty(sel, 0);
    if (id === 'rumor') send({ type: 'act', action: { type: 'rumor', company: sel } });
    if (id === 'end' && after !== null) {
      const clean = Object.fromEntries(Object.entries(orders).filter(([, n]) => n));
      send({ type: 'act', action: { type: 'orders', orders: clean } });
    }
  };

  const draw = (g: Gfx) => {
    const left = game.deadline ? Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)) : null;
    drawScene(g, s, sel, orders, after, { clock: game.waiting && left !== null && left <= 20 ? `${left}s left` : undefined });
  };

  return (
    <div className="game-layout">
      <PixelStage width={480} height={270} draw={draw} onHit={onHit} />
      <MarketLog state={s} />
    </div>
  );
}
