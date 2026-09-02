'use strict';

const { RANKS, suitOf, rankValue } = require('../engine/cards');
const { SEATS } = require('../engine/game');

/**
 * Reconstructs the full trick history of a hand from the observations one player
 * receives, using only information that player is entitled to.
 *
 * `observation()` exposes no per-trick history, but it does expose `collected`, which
 * appends each won trick's four cards in play order. Combined with `leader`, which is
 * the winner of the previous trick, the whole hand is recoverable:
 *
 *   winner(t) === leader(t + 1), and leader(t) fixes the seat that played card 0 of
 *   that trick, so card i belongs to the seat i places clockwise from the leader.
 *
 * Feed every observation to `observe()`; query `playedCards`, `isVoid` and
 * `highestOutstanding` afterwards.
 */
class HandTracker {
  constructor() {
    this.reset(null, []);
  }

  reset(handNumber, playerIds) {
    this.handNumber = handNumber;
    this.playerIds = playerIds.slice();
    this.played = new Set();
    this.voids = Object.fromEntries(playerIds.map(id => [id, new Set()]));
    this.leaderByTrick = {};
    this.nextTrickToResolve = 1;
    this.collectedCursor = Object.fromEntries(playerIds.map(id => [id, 0]));
  }

  observe(obs) {
    if (obs.handNumber !== this.handNumber) this.reset(obs.handNumber, obs.playerIds);
    this.leaderByTrick[obs.trickNumber] = obs.leader;

    // Every trick before the current one is now fully determined.
    while (this.nextTrickToResolve < obs.trickNumber) {
      const trickNumber = this.nextTrickToResolve;
      const winner = this.leaderByTrick[trickNumber + 1];
      const cursor = this.collectedCursor[winner];
      const cards = (obs.collected[winner] || []).slice(cursor, cursor + SEATS);
      this.collectedCursor[winner] = cursor + SEATS;
      this.nextTrickToResolve += 1;
      if (cards.length < SEATS) continue;

      const leaderSeat = this.playerIds.indexOf(this.leaderByTrick[trickNumber]);
      const ledSuit = suitOf(cards[0]);
      cards.forEach((card, i) => {
        this.played.add(card);
        if (suitOf(card) !== ledSuit) {
          this.voids[this.playerIds[(leaderSeat + i) % SEATS]].add(ledSuit);
        }
      });
    }

    if (obs.trick.length > 0) {
      const ledSuit = suitOf(obs.trick[0].card);
      for (const play of obs.trick) {
        this.played.add(play.card);
        if (suitOf(play.card) !== ledSuit) this.voids[play.player].add(ledSuit);
      }
    }
  }

  isVoid(playerId, suit) {
    const set = this.voids[playerId];
    return set ? set.has(suit) : false;
  }

  /** Cards of `suit` still unaccounted for — not played, and not in `myHand`. */
  outstanding(suit, myHand) {
    const mine = new Set(myHand);
    return RANKS
      .map(rank => `${rank}${suit}`)
      .filter(card => !this.played.has(card) && !mine.has(card));
  }

  /** The best card of `suit` still in someone else's hand, or null. */
  highestOutstanding(suit, myHand) {
    const cards = this.outstanding(suit, myHand);
    if (cards.length === 0) return null;
    return cards.reduce((best, card) => (rankValue(card) > rankValue(best) ? card : best));
  }

  /** How many of `players` have shown void in `suit`. */
  countVoid(players, suit) {
    return players.filter(id => this.isVoid(id, suit)).length;
  }
}

module.exports = { HandTracker };
