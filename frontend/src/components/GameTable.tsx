import React, { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../PlayerContext';
import type { Player } from '../PlayerContext';
import { cardColor, getSuit, pointCards, trickWinner, TrickEntry } from '../lib/cards';
import { displayTeamScores, teamOf } from '../lib/scores';
import CollectedCardsModal from './CollectedCardsModal';
import GameOverModal, { GameOverData } from './GameOverModal';
import Hand from './Hand';
import PlayerTiles from './PlayerTiles';
import Scoreboard, { IndividualScores } from './Scoreboard';
import Trick from './Trick';
import { button, page } from './styles';

/** How long the "X won the trick" message stays up after the trick is cleared. */
const TRICK_FLASH_MS = 2500;

export default function GameTable() {
  const { handle, hand, gameState, socket, playerId: myPlayerId, isHost, isSpectator, room, players } =
    usePlayer();
  const [playedCard, setPlayedCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);
  const [collected, setCollected] = useState<Record<string, string[]>>({});
  const [modalPlayer, setModalPlayer] = useState<string | null>(null);
  // Held as an object so that consecutive wins by the same player are distinct
  // states and each one restarts the flash timer.
  const [lastTrick, setLastTrick] = useState<{ winner: string } | null>(null);
  const previousTrick = useRef<TrickEntry[]>([]);

  const trickLength = gameState?.trick.length;

  useEffect(() => {
    setPlayedCard(null);
  }, [trickLength]);

  // The server clears the trick about a second after the fourth card, so a
  // 4 → 0 transition marks a completed trick whose winner is worth showing.
  useEffect(() => {
    const current = gameState?.trick ?? [];
    const previous = previousTrick.current;
    previousTrick.current = current;
    if (current.length === 0 && previous.length === 4) {
      const winner = trickWinner(previous);
      if (winner) setLastTrick({ winner });
    }
  }, [gameState]);

  useEffect(() => {
    if (!lastTrick) return;
    const timer = setTimeout(() => setLastTrick(null), TRICK_FLASH_MS);
    return () => clearTimeout(timer);
  }, [lastTrick]);

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
    };
    const onGameStarted = () => {
      setGameOver(null);
      setCollected({});
      setLastTrick(null);
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

  const { trick, turn, playerHandles: seats } = gameState;
  const currentPlayer = seats[turn];
  const isMyTurn = currentPlayer?.playerId === myPlayerId;
  const hasPlayed = playedCard !== null || trick.some(entry => entry.player === myPlayerId && entry.card);
  const leaderId = trick.length > 0 ? trick[0].player : currentPlayer?.playerId;
  const leaderHandle = seats.find((p: Player) => p.playerId === leaderId)?.handle;
  const ledSuit = trick.length > 0 && trick[0].card ? getSuit(trick[0].card) : null;
  const teamScores = displayTeamScores(gameState);
  const myPointCards = pointCards(collected[myPlayerId] || []);
  const botIds = new Set(players.filter((p: Player) => p.isBot).map((p: Player) => p.playerId));

  const onPlayCard = (card: string) => {
    if (!isMyTurn || hasPlayed || !socket) return;
    setPlayedCard(card);
    socket.emit('play_card', card);
  };

  const turnMessage = isSpectator
    ? `Waiting for ${currentPlayer?.handle ?? 'the next player'}...`
    : isMyTurn
    ? hasPlayed
      ? 'Waiting for others...'
      : ledSuit
        ? `Your turn — follow ${ledSuit} if you can`
        : 'Your turn — you lead this trick'
    : `Waiting for ${currentPlayer?.handle ?? 'the next player'}...`;

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

      <div role="status" style={{ textAlign: 'center', marginBottom: 12, fontSize: 16, fontWeight: 500 }}>
        <div style={{ color: isMyTurn ? '#2e7d32' : '#555' }}>{turnMessage}</div>
        <div style={{ color: '#666', fontSize: 14 }}>
          {leaderHandle
            ? `${leaderId === myPlayerId ? 'You lead' : `${leaderHandle} leads`} this trick`
            : ''}
        </div>
      </div>

      <PlayerTiles
        players={seats
          .filter((p: Player) => p.playerId !== myPlayerId)
          // `player_list` is what says which seats are bots; the game state does not.
          .map((p: Player) => ({ ...p, isBot: botIds.has(p.playerId) }))}
        teamOf={playerId => teamOf(gameState, playerId)}
        onSelect={setModalPlayer}
      />

      <Trick
        seats={seats}
        trick={trick}
        myPlayerId={myPlayerId}
        currentPlayerId={currentPlayer?.playerId}
        leaderId={leaderId}
        teamOf={playerId => teamOf(gameState, playerId)}
        lastWinnerHandle={
          lastTrick ? seats.find((p: Player) => p.playerId === lastTrick.winner)?.handle ?? null : null
        }
      />

      {!isSpectator && (
        <>
          <Hand
            cards={hand}
            playable={isMyTurn && !hasPlayed}
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
