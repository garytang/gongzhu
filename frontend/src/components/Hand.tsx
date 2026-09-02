import React from 'react';
import { cardColor, sortHand } from '../lib/cards';

interface HandProps {
  cards: string[];
  /** False while it is someone else's turn or this player has already played. */
  playable: boolean;
  /** Cards the server says may be played right now; empty when it is not your turn. */
  legalMoves: string[];
  playedCard: string | null;
  onPlay: (card: string) => void;
}

/** The player's own hand, always shown sorted by suit then rank. */
export default function Hand({ cards, playable, legalMoves, playedCard, onPlay }: HandProps) {
  const sorted = sortHand(cards);

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>Your Hand</h3>
      <div
        data-testid="hand"
        style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        {sorted.map(card => {
          const enabled = playable && legalMoves.includes(card);
          return (
            <button
              key={card}
              type="button"
              disabled={!enabled}
              onClick={() => onPlay(card)}
              style={{
                padding: '8px 12px',
                // A card you may play is lifted out of the fan by its border.
                border: enabled ? '2px solid #2e7d32' : '1px solid #aaa',
                borderRadius: 6,
                background: playedCard === card ? '#eee' : '#fff',
                fontSize: 20,
                lineHeight: 1.2,
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.4,
                color: cardColor(card),
              }}
            >
              {card}
            </button>
          );
        })}
      </div>
    </div>
  );
}
