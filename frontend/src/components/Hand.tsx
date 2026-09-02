import React from 'react';
import { cardColor, sortHand } from '../lib/cards';

interface HandProps {
  cards: string[];
  /** False while it is someone else's turn or this player has already played. */
  playable: boolean;
  playedCard: string | null;
  onPlay: (card: string) => void;
}

/** The player's own hand, always shown sorted by suit then rank. */
export default function Hand({ cards, playable, playedCard, onPlay }: HandProps) {
  const sorted = sortHand(cards);

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>Your Hand</h3>
      <div
        data-testid="hand"
        style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        {sorted.map(card => (
          <button
            key={card}
            type="button"
            disabled={!playable}
            onClick={() => onPlay(card)}
            style={{
              padding: '8px 12px',
              border: '1px solid #aaa',
              borderRadius: 6,
              background: playedCard === card ? '#eee' : '#fff',
              fontSize: 20,
              lineHeight: 1.2,
              cursor: playable ? 'pointer' : 'not-allowed',
              opacity: playable ? 1 : 0.5,
              color: cardColor(card),
            }}
          >
            {card}
          </button>
        ))}
      </div>
    </div>
  );
}
