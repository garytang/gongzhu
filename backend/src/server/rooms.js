'use strict';

const { SEATS, DEFAULT_VARIANT, DEFAULT_OPTIONS, heartTable } = require('../engine');

/**
 * Room bookkeeping: join codes, options, seats and spectators.
 *
 * Nothing here knows about sockets or handles, and it plays no part in a hand — it takes
 * the table size and the option values from the engine and answers who sits, who
 * spectates and who hosts. `createServer.js` calls into it for every membership change,
 * so those rules live in one place.
 */

/** Codes get read aloud and typed by hand, so the 0/O and 1/I pairs are left out. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

const VISIBILITIES = ['public', 'private'];
const MAX_NAME_LENGTH = 40;

/**
 * What happens to a seat whose player is still gone when the reconnect countdown ends:
 * a bot plays it out for the rest of the match, or the hand is abandoned and everyone
 * waits in the room for a fresh one.
 */
const DISCONNECT_POLICIES = ['bot', 'lobby'];

const DEFAULT_ROOM_OPTIONS = {
  variant: DEFAULT_VARIANT,
  teams: true,
  targetScore: DEFAULT_OPTIONS.targetScore,
  visibility: 'public',
  onDisconnect: 'bot',
};

/** A rejected client request. `createServer` turns it into a `room_error`. */
class RoomError extends Error {}

/** A code no live room is using. The space is 32^6, so collisions are vanishingly rare. */
function newRoomCode(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new RoomError('No room code is available');
}

/** Accepts the loose casing and spacing a person types when given a code verbally. */
function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRoomName(value, fallback) {
  const name = String(value == null ? '' : value).trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

/**
 * Applies a client-supplied patch to a set of room options, rejecting anything the
 * engine or the lobby cannot honour. Unknown keys are ignored.
 */
function normalizeRoomOptions(patch = {}, base = DEFAULT_ROOM_OPTIONS) {
  const options = { ...base };
  const given = patch && typeof patch === 'object' ? patch : {};

  if ('variant' in given) {
    // The engine owns the list of heart tables; asking it keeps the two from drifting.
    try {
      heartTable(given.variant);
    } catch (error) {
      throw new RoomError(`Unknown variant "${given.variant}"`);
    }
    options.variant = given.variant;
  }
  if ('teams' in given) {
    if (typeof given.teams !== 'boolean') throw new RoomError('teams must be true or false');
    options.teams = given.teams;
  }
  if ('targetScore' in given) {
    const target = Number(given.targetScore);
    if (!Number.isInteger(target) || target < 1 || target > 100000) {
      throw new RoomError('targetScore must be a whole number between 1 and 100000');
    }
    options.targetScore = target;
  }
  if ('onDisconnect' in given) {
    if (!DISCONNECT_POLICIES.includes(given.onDisconnect)) {
      throw new RoomError(`Unknown onDisconnect policy "${given.onDisconnect}"`);
    }
    options.onDisconnect = given.onDisconnect;
  }
  if ('visibility' in given) {
    if (!VISIBILITIES.includes(given.visibility)) {
      throw new RoomError(`Unknown visibility "${given.visibility}"`);
    }
    options.visibility = given.visibility;
  }
  return options;
}

function createRoom({ code, name, hostId, options, bots }) {
  return {
    code,
    name,
    hostId,
    createdAt: Date.now(),
    options,
    seats: [hostId],
    spectators: [],
    /** The engine session, as built by `createServer`; null until the first hand. */
    session: null,
    /** This room's bots. Server-global bots would leak between tables. */
    bots,
    /** Set while the room is empty and counting down to deletion. */
    deleteTimer: null,
    /**
     * Seated players who have dropped mid-match, `memberId -> { timer, deadline }`.
     * They keep their seat until the timer fires; `createServer` owns both.
     */
    absent: new Map(),
  };
}

/** Everyone in the room, seated or not, in the order they should inherit the host role. */
function members(room) {
  return [...room.seats, ...room.spectators];
}

function isMember(room, memberId) {
  return room.seats.includes(memberId) || room.spectators.includes(memberId);
}

/**
 * What the room is doing, derived from the engine rather than tracked separately so the
 * two can never disagree.
 */
function phaseOf(room) {
  const match = room.session && room.session.match;
  if (!match) return 'waiting';
  if (match.phase === 'matchComplete') return 'matchOver';
  if (match.phase === 'handComplete') return 'handOver';
  return 'playing';
}

/**
 * Adds a member: a free seat before the cards are dealt, otherwise a spectator seat.
 * Seats are only handed out while waiting because a started hand is dealt to a fixed
 * four players; `takeFreeSeats` promotes spectators when the next hand is started.
 */
function admit(room, memberId) {
  const role = seat(room, memberId);
  // An emptied room keeps the id of the host who left it, so the host of a room they
  // refreshed out of gets it back rather than losing it to whoever arrives first. A
  // stranger walking into an abandoned room still hosts it, so no table is left
  // unstartable.
  if (!isMember(room, room.hostId)) room.hostId = memberId;
  return role;
}

function seat(room, memberId) {
  if (isMember(room, memberId)) return isSpectator(room, memberId) ? 'spectator' : 'seat';
  if (phaseOf(room) === 'waiting' && room.seats.length < SEATS) {
    room.seats.push(memberId);
    return 'seat';
  }
  room.spectators.push(memberId);
  return 'spectator';
}

function isSpectator(room, memberId) {
  return room.spectators.includes(memberId);
}

/**
 * Removes a member. A seat freed before the game starts goes to the longest-waiting
 * spectator, and the host role passes to whoever is next in line, so a room only dies
 * when the last person leaves.
 */
function release(room, memberId) {
  room.seats = room.seats.filter(id => id !== memberId);
  room.spectators = room.spectators.filter(id => id !== memberId);

  if (phaseOf(room) === 'waiting') takeFreeSeats(room);
  // The role passes to whoever is left; with nobody left it stays with the departing
  // host, for them to reclaim in `admit` if they come back.
  if (room.hostId === memberId) room.hostId = members(room)[0] || memberId;
}

/** Spectators fill any seat left empty, in arrival order. Called when a hand is dealt. */
function takeFreeSeats(room) {
  while (room.seats.length < SEATS && room.spectators.length > 0) {
    room.seats.push(room.spectators.shift());
  }
}

module.exports = {
  SEATS,
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_ROOM_OPTIONS,
  DISCONNECT_POLICIES,
  RoomError,
  admit,
  createRoom,
  isMember,
  isSpectator,
  members,
  newRoomCode,
  normalizeCode,
  normalizeRoomName,
  normalizeRoomOptions,
  phaseOf,
  release,
  takeFreeSeats,
};
