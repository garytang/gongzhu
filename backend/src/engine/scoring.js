'use strict';

const {
  ALL_HEARTS,
  PIG,
  SHEEP,
  TRANSFORMER,
  ACE_HEARTS,
  RANKS,
  HEARTS,
  isHeart,
  isPointCard,
  rankOf,
} = require('./cards');

/**
 * Heart value tables. Both sum to -200 across the suit, which is what makes
 * 全紅 (all hearts) worth a clean +200 under either variant.
 *
 *  - `standard`: the published Gongzhu table (pagat, zh.wikipedia, TW tournament rules).
 *  - `pips`:     house rule where number cards score their pip value, except 4♥ which
 *                scores -10. Face cards are unchanged.
 */
const HEART_TABLES = {
  standard: {
    A: -50, K: -40, Q: -30, J: -20,
    10: -10, 9: -10, 8: -10, 7: -10, 6: -10, 5: -10,
    4: 0, 3: 0, 2: 0,
  },
  pips: {
    A: -50, K: -40, Q: -30, J: -20,
    10: -10, 9: -9, 8: -8, 7: -7, 6: -6, 5: -5,
    4: -10, 3: -3, 2: -2,
  },
};

const DEFAULT_VARIANT = 'standard';

function heartTable(variant = DEFAULT_VARIANT) {
  const table = HEART_TABLES[variant];
  if (!table) {
    throw new Error(`Unknown heart scoring variant: ${variant}`);
  }
  return table;
}

/** Total of all hearts under a variant. Both current variants total -200. */
function heartSuitTotal(variant = DEFAULT_VARIANT) {
  const table = heartTable(variant);
  return RANKS.reduce((sum, rank) => sum + table[rank], 0);
}

/**
 * Score one player's collected cards.
 *
 * `exposed` is the set of exposed (亮) cards for the whole hand, regardless of who
 * exposed them — exposure doubles a card's value for whoever ends up taking it.
 *
 * The formula is compositional rather than a table of slam totals, and reproduces
 * every published total exactly:
 *   全紅        = +200                    (hearts flip positive)
 *   全紅 + 豬   = +300
 *   小滿貫      = +400                    (all hearts + pig + sheep)
 *   大滿貫      = (200+100+100) * 2 = +800
 *   大滿貫 全亮 = (400+200+200) * 4 = +3200
 */
function scorePlayerCards(cards, { variant = DEFAULT_VARIANT, exposed = [] } = {}) {
  const table = heartTable(variant);
  const exposedSet = new Set(exposed);
  const held = new Set(cards);

  const heartsMultiplier = exposedSet.has(ACE_HEARTS) ? 2 : 1;
  const pigMultiplier = exposedSet.has(PIG) ? 2 : 1;
  const sheepMultiplier = exposedSet.has(SHEEP) ? 2 : 1;
  // The transformer multiplies the player's other scoring cards: x2 normally, x4 exposed.
  const transformerMultiplier = exposedSet.has(TRANSFORMER) ? 4 : 2;
  const transformerAlone = exposedSet.has(TRANSFORMER) ? 100 : 50;

  const hasPig = held.has(PIG);
  const hasSheep = held.has(SHEEP);
  const hasTransformer = held.has(TRANSFORMER);
  const hearts = cards.filter(isHeart);
  const hasAllHearts = ALL_HEARTS.every(card => held.has(card));

  // Hearts: normally the sum of their (negative) values; if a player sweeps the
  // whole suit the total flips to a positive +200 ("全紅" / 豬羊變色).
  let heartsScore;
  if (hasAllHearts) {
    heartsScore = -heartSuitTotal(variant) * heartsMultiplier;
  } else {
    heartsScore = hearts.reduce((sum, card) => sum + table[rankOf(card)], 0) * heartsMultiplier;
  }

  // The pig turns positive for a player who also swept the hearts.
  const pigScore = hasPig ? (hasAllHearts ? 100 : -100) * pigMultiplier : 0;
  const sheepScore = hasSheep ? 100 * sheepMultiplier : 0;

  const otherPointCards = cards.filter(card => isPointCard(card) && card !== TRANSFORMER);
  let score = heartsScore + pigScore + sheepScore;

  if (hasTransformer) {
    // Taken with no other point cards the transformer is a flat bonus; otherwise
    // it multiplies everything else the same player took.
    score = otherPointCards.length === 0 ? transformerAlone : score * transformerMultiplier;
  }

  return {
    score,
    hearts: hearts.length,
    hasPig,
    hasSheep,
    hasTransformer,
    hasAllHearts,
    // 小滿貫: every point card except the transformer. 大滿貫: literally everything.
    isSmallSlam: hasAllHearts && hasPig && hasSheep && !hasTransformer,
    isGrandSlam: hasAllHearts && hasPig && hasSheep && hasTransformer,
    pointCards: cards.filter(isPointCard),
  };
}

/**
 * Score a completed hand for every player.
 *
 * Individual scores are always the source of truth. Team totals, when a partnership
 * is configured, are a pure aggregation on top — never a separate scoring path.
 */
function scoreHand(collected, { variant = DEFAULT_VARIANT, exposed = [], teams = null } = {}) {
  const players = {};
  for (const [playerId, cards] of Object.entries(collected)) {
    players[playerId] = scorePlayerCards(cards, { variant, exposed });
  }

  const individual = {};
  for (const [playerId, result] of Object.entries(players)) {
    individual[playerId] = result.score;
  }

  let teamScores = null;
  if (teams) {
    teamScores = {};
    for (const [teamName, memberIds] of Object.entries(teams)) {
      teamScores[teamName] = memberIds.reduce((sum, id) => sum + (individual[id] || 0), 0);
    }
  }

  return { individual, teamScores, players };
}

module.exports = {
  HEART_TABLES,
  DEFAULT_VARIANT,
  heartTable,
  heartSuitTotal,
  scorePlayerCards,
  scoreHand,
};
