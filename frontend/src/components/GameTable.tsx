import React, { useEffect, useState } from 'react';
import { usePlayer } from '../PlayerContext';
import type { Player } from '../PlayerContext';
import { cardColor, getSuit, pointCards } from '../lib/cards';
import { displayTeamScores, teamOf } from '../lib/scores';
import CollectedCardsModal from './CollectedCardsModal';
import GameOverModal, { GameOverData } from './GameOverModal';
import Hand from './Hand';
import ReconnectOverlay from './ReconnectOverlay';
import RoundHistory from './RoundHistory';
import Scoreboard, { IndividualScores } from './Scoreboard';
import TableSeats from './TableSeats';
import { button, page } from './styles';

/** How long the "X won the trick" message stays up after the trick is cleared. */
const TRICK_FLASH_MS = 2500;

export default function GameTable() {
  const { handle, hand, legalMoves, gameState, socket, playerId, isHost, isSpectator, room,
    players } = usePlayer();
  // A bot that took over a seat still answers to the id of the player who left it, so a
  // spectator must not recognise that seat as their own.
  const myPlayerId = isSpectator ? '' : playerId;
  const [playedCard, setPlayedCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [collected, setCollected] = useState<Record<string, string[]>>({});
  const [modalPlayer, setModalPlayer] = useState<string | null>(null);
  const [flashWinner, setFlashWinner] = useState<string | null>(null);
  // The `game_over` payloads of the current match, which is all the round history needs.
  const [results, setResults] = useState<GameOverData[]>([]);

  const seats = gameState?.playerHandles ?? [];
  const trick = gameState?.trick ?? [];

  useEffect(() => {
    setPlayedCard(null);
  }, [trick.length]);

  // A trick still on screen with four cards in it is one the server resolved and is
  // holding there, so `lastTrick` names who took it. The message outlives that hold,
  // and the gap before the next trick fills is what lets a repeat win flash again.
  const heldTrickWinner = trick.length === 4 ? gameState?.lastTrick?.winner : undefined;
  useEffect(() => {
    if (heldTrickWinner) setFlashWinner(heldTrickWinner);
  }, [heldTrickWinner]);

  useEffect(() => {
    if (!flashWinner) return;
    const timer = setTimeout(() => setFlashWinner(null), TRICK_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashWinner]);

  // A match that has completed no hands reports zero totals for everyone. That is
  // what both "new game" and a continue past the end of a match look like from here,
  // and it is the only moment a ledger carried over from the previous match is wrong.
  const matchIsFresh = Object.values(gameState?.scores ?? {}).every(score => score === 0);
  useEffect(() => {
    if (matchIsFresh) setResults([]);
  }, [matchIsFresh]);

  useEffect(() => {
    if (!socket) return;
    const onInvalidPlay = () => {
      setPlayedCard(null);
      setError('Invalid card! Please follow suit.');
      setTimeout(() => setError(null), 1500);
    };
    const onGameOver = (data: GameOverData) => {
      setGameOver(data);
      setCollected(data.collected || {});
      setResults(previous => [...previous, data]);
    };
    const onGameStarted = () => {
      setGameOver(null);
      setCollected({});
      setFlashWinner(null);
    };
    const onCollected = (data: Record<string, string[]>) => {
      setCollected(data);
    };
    socket.on('invalid_play', onInvalidPlay);
    socket.on('game_over', onGameOver);
    socket.on('game_started', onGameStarted);
    socket.on('collected', onCollected);
    return () => {
      socket.off('invalid_play', onInvalidPlay);
      socket.off('game_over', onGameOver);
      socket.off('game_started', onGameStarted);
      socket.off('collected', onCollected);
    };
  }, [socket]);

  if (!gameState) {
    return <div style={{ textAlign: 'center', marginTop: '2rem' }}>Waiting for game state...</div>;
  }

  const currentPlayer = seats[gameState.turn];
  const isMyTurn = currentPlayer?.playerId === myPlayerId;
  const hasPlayed = playedCard !== null || trick.some(entry => entry.player === myPlayerId && entry.card);
  const leaderId = trick.length > 0 ? trick[0].player : currentPlayer?.playerId;
  const leaderHandle = seats.find((p: Player) => p.playerId === leaderId)?.handle;
  const ledSuit = trick.length > 0 && trick[0].card ? getSuit(trick[0].card) : null;
  const teamScores = displayTeamScores(gameState);
  const myPointCards = pointCards(collected[myPlayerId] || []);
  const botIds = new Set(players.filter((p: Player) => p.isBot).map((p: Player) => p.playerId));
  const winnerHandle = flashWinner
    ? seats.find((p: Player) => p.playerId === flashWinner)?.handle ?? null
    : null;

  const onPlayCard = (card: string) => {
    if (!isMyTurn || hasPlayed || !socket) return;
    setPlayedCard(card);
    socket.emit('play_card', card);
  };

  const myTurnMessage = hasPlayed
    ? 'Waiting for others...'
    : ledSuit === null
    ? 'Your turn — you lead this trick'
    : legalMoves.some(card => getSuit(card) === ledSuit)
    ? `Your turn — follow ${ledSuit}`
    : `Your turn — no ${ledSuit} left, play anything`;

  const turnMessage =
    isSpectator || !isMyTurn
      ? `Waiting for ${currentPlayer?.handle ?? 'the next player'}...`
      : myTurnMessage;

  return (
    <div style={page}>
      {gameState.teams ? (
        <Scoreboard
          team1={teamScores.team1}
          team2={teamScores.team2}
          myTeam={teamOf(gameState, myPlayerId)}
        />
      ) : (
        <IndividualScores seats={seats} scores={gameState.scores} myPlayerId={myPlayerId} />
      )}

      {isSpectator && (
        <div style={{ textAlign: 'center', marginBottom: 12, color: '#666', fontWeight: 'bold' }}>
          Spectating
        </div>
      )}

      <ReconnectOverlay />

      <div role="status" style={{ textAlign: 'center', marginBottom: 12, fontSize: 16, fontWeight: 500 }}>
        <div style={{ color: isMyTurn ? '#2e7d32' : '#555' }}>{turnMessage}</div>
        <div style={{ color: '#666', fontSize: 14 }}>
          {leaderHandle
            ? `${leaderId === myPlayerId ? 'You lead' : `${leaderHandle} leads`} this trick`
            : ''}
        </div>
      </div>

      <TableSeats
        // `player_list` is what says which seats are bots; the game state does not.
        seats={seats.map((p: Player) => ({ ...p, isBot: botIds.has(p.playerId) }))}
        trick={trick}
        myPlayerId={myPlayerId}
        currentPlayerId={currentPlayer?.playerId}
        leaderId={leaderId}
        teamOf={playerId => teamOf(gameState, playerId)}
        lastWinnerHandle={winnerHandle}
        onSelect={setModalPlayer}
      />

      {!isSpectator && (
        <>
          <Hand
            cards={hand}
            playable={isMyTurn && !hasPlayed}
            legalMoves={legalMoves}
            playedCard={playedCard}
            onPlay={onPlayCard}
          />

          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>Your Collected Point Cards</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', fontSize: 20 }}>
              {myPointCards.length === 0 ? (
                <span style={{ color: '#888', fontSize: 16 }}>None</span>
              ) : (
                myPointCards.map((card, idx) => (
                  <span key={idx} style={{ color: cardColor(card) }}>{card}</span>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {error && <div style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>{error}</div>}

      <RoundHistory results={results} seats={seats} />

      <div style={{ marginTop: 18, textAlign: 'center' }}>
        <button type="button" style={button} onClick={() => socket?.emit('leave_room')}>
          Leave room
        </button>
      </div>

      {modalPlayer && (
        <CollectedCardsModal
          handle={seats.find((p: Player) => p.playerId === modalPlayer)?.handle || modalPlayer}
          cards={pointCards(collected[modalPlayer] || [])}
          onClose={() => setModalPlayer(null)}
        />
      )}

      {gameOver && (
        <GameOverModal
          data={gameOver}
          gameState={gameState}
          myHandle={handle}
          canControl={isHost}
          hostHandle={room?.host?.handle}
          onClose={() => setGameOver(null)}
          onContinue={() => {
            setGameOver(null);
            socket?.emit('continue_game');
          }}
          onNewGame={() => {
            setGameOver(null);
            socket?.emit('start_game');
          }}
        />
      )}
    </div>
  );
}
