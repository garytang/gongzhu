'use strict';

const { RANKS, isPointCard } = require('../engine/cards');
const { heartTable, DEFAULT_VARIANT } = require('../engine/scoring');

/**
 * Hard ceiling on the prompt handed to a provider. The prompt is assembled from a
 * bounded observation so it never approaches this in practice; the cap is here so a
 * malformed observation cannot turn into an unbounded (and unboundedly billed) request.
 */
const MAX_PROMPT_CHARS = 8000;

function nameOf(names, playerId) {
  return (names && names[playerId]) || playerId;
}

/** "A♥ −50, K♥ −40, …" for the variant in play, so the prompt matches the scoring code. */
function heartValueLine(variant = DEFAULT_VARIANT) {
  const table = heartTable(variant);
  return RANKS.slice().reverse()
    .map(rank => `${rank}♥ ${table[rank]}`)
    .join(', ');
}

function pointCardsOf(cards) {
  return (cards || []).filter(isPointCard);
}

function trickLine(observation, names) {
  if (observation.trick.length === 0) return 'empty — you lead';
  return observation.trick
    .map(play => `${nameOf(names, play.player)}: ${play.card}`)
    .join(', ');
}

function collectedBlock(observation, names) {
  return observation.playerIds
    .map(id => {
      const points = pointCardsOf(observation.collected[id]);
      return `  ${nameOf(names, id)}: ${points.length > 0 ? points.join(', ') : 'none'}`;
    })
    .join('\n');
}

function standingsLine(observation, names) {
  const individual = observation.playerIds
    .map(id => `${nameOf(names, id)} ${observation.totals[id] || 0}`)
    .join(', ');
  if (!observation.teamTotals) return individual;
  const { team1, team2 } = observation.teamTotals;
  return `${individual}\nTeam totals: team1 ${team1}, team2 ${team2}`;
}

function cardsLeftLine(observation, names) {
  return observation.playerIds
    .map(id => `${nameOf(names, id)} ${observation.handCounts[id]}`)
    .join(', ');
}

/**
 * Render an engine observation as the prompt for one move.
 *
 * Everything in the prompt comes from the observation, which by construction holds only
 * what the acting player may legitimately see — no other player's hand ever reaches a
 * provider.
 */
function buildPrompt(observation, names = {}) {
  const me = nameOf(names, observation.playerId);
  const opponents = observation.playerIds
    .filter(id => id !== observation.playerId && id !== observation.teammate)
    .map(id => nameOf(names, id))
    .join(', ');

  // The heart values are read from the scoring tables so they follow the variant; the
  // pig / sheep / transformer values are variant-independent and written out in prose.
  // Both must stay in step with src/engine/scoring.js.
  const sections = [
`You are ${me}, playing Gongzhu (Chinese Hearts), a four-player trick-taking card game.

RULES
- Follow the led suit if you can; otherwise play anything. No trumps.
- Ranks run 2 < 3 < ... < 10 < J < Q < K < A. The highest card of the led suit takes the
  trick and collects all four cards.
- Point cards: Q♠ -100, J♦ +100, 10♣ +50 on its own, otherwise it doubles your hand total.
- Hearts: ${heartValueLine(observation.variant)}.
- All thirteen hearts is +200 instead; with Q♠ as well, +300.
- An exposed (亮) card counts double for whoever ends up taking it.`,

`SITUATION
Hand ${observation.handNumber || '?'}, trick ${observation.trickNumber}.
Your hand: ${observation.hand.join(', ')}
Current trick: ${trickLine(observation, names)}
Trick led by: ${nameOf(names, observation.leader)}
Cards left in each hand: ${cardsLeftLine(observation, names)}
Exposed cards: ${observation.exposed.length > 0 ? observation.exposed.join(', ') : 'none'}`,

`TABLE
Your teammate: ${observation.teammate ? nameOf(names, observation.teammate) : 'none (individual scoring)'}
Opponents: ${opponents || 'none'}

POINT CARDS TAKEN SO FAR
${collectedBlock(observation, names)}

SCORES
${standingsLine(observation, names)}`,

`Choose one card. Weigh:
1. Whether taking this trick helps you — will it bring in points you want (J♦, 10♣) or
   points you do not (Q♠, hearts)?
2. Timing: is this card worth more played now or held for a later trick?
3. Your teammate's position — their points count toward the same total as yours.
4. What the opponents are trying to do, and whether you can spoil it.
5. Which point cards are still unaccounted for, and who is likely to hold them.

LEGAL PLAYS (you must pick exactly one of these): ${observation.legalMoves.join(', ')}

Reply in this format and nothing else:
<reasoning>
one or two sentences
</reasoning>
<played_card>
one card from the legal plays above
</played_card>`,
  ];

  // The closing section carries the legal plays and the response format, so it is the
  // one part that must survive the cap intact.
  const instructions = sections.pop();
  let context = sections.join('\n\n');
  const budget = MAX_PROMPT_CHARS - instructions.length - 2;
  if (context.length > budget) {
    context = `${context.slice(0, Math.max(budget - 20, 0))}\n[context truncated]`;
  }
  return `${context}\n\n${instructions}`;
}

module.exports = { buildPrompt, MAX_PROMPT_CHARS };
