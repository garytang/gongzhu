import React from 'react';
import { cardColor } from '../lib/cards';
import { modalCard, overlay, primaryButton } from './styles';

interface CollectedCardsModalProps {
  handle: string;
  /** Already filtered to point cards. */
  cards: string[];
  onClose: () => void;
}

export default function CollectedCardsModal({ handle, cards, onClose }: CollectedCardsModalProps) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modalCard, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>
          {handle}'s Collected Point Cards
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', fontSize: 20 }}>
          {cards.length === 0 ? (
            <span style={{ color: '#888', fontSize: 16 }}>None</span>
          ) : (
            cards.map((card, idx) => (
              <span key={idx} style={{ color: cardColor(card) }}>{card}</span>
            ))
          )}
        </div>
        <button style={{ ...primaryButton, marginTop: 18 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
