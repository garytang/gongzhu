import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PlayerProvider, usePlayer } from './PlayerContext';
import type { Player } from './PlayerContext';

function Login() {
  const { handle, setHandle } = usePlayer();
  const [input, setInput] = useState(handle);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setHandle(input.trim());
      navigate('/lobby');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '2rem auto', textAlign: 'center' }}>
      <h2>Enter your handle</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Nickname"
          style={{ padding: '0.5rem', width: '80%' }}
        />
        <br />
        <button type="submit" style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
          Enter Lobby
        </button>
      </form>
    </div>
  );
}

function Lobby() {
  const { handle, players, socket } = usePlayer();
  const navigate = useNavigate();
  const canStart = players.length === 4;

  useEffect(() => {
    if (!socket) return;
    const onGameStarted = () => {
      navigate('/game');
    };
    socket.on('game_started', onGameStarted);
    return () => {
      socket.off('game_started', onGameStarted);
    };
  }, [socket, navigate]);

  const handleStart = () => {
    if (canStart && socket) {
      socket.emit('start_game');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '2rem auto', textAlign: 'center' }}>
      <h2>Lobby</h2>
      <div style={{ marginBottom: '1rem' }}>You are: <b>{handle}</b></div>
      <h3>Players in Room:</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {players.map((p: Player, i) => (
          <li key={p.playerId || i} style={{ padding: '0.5rem 0', fontWeight: p.handle === handle ? 'bold' : 'normal' }}>
            {p.handle}
          </li>
        ))}
      </ul>
      <button
        onClick={handleStart}
        disabled={!canStart}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', opacity: canStart ? 1 : 0.5 }}
      >
        Start Game
      </button>
      {!canStart && <div style={{ marginTop: '0.5rem', color: 'gray' }}>Waiting for 4 players...</div>}
    </div>
  );
}

function GameTable() {
  const { handle, hand, gameState, socket, playerId: myPlayerId } = usePlayer();
  const [playedCard, setPlayedCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<null | { 
    scores: Record<string, number>, 
    collected: Record<string, string[]>, 
    teamInfo?: {
      team1: { players: string[], roundScore: number, cumulativeScore: number },
      team2: { players: string[], roundScore: number, cumulativeScore: number }
    },
    gameEnded?: boolean,
    winningTeam?: number | null
  }>(null);
  const [collected, setCollected] = useState<Record<string, string[]>>({});
  const [modalPlayer, setModalPlayer] = useState<string | null>(null);
  const [displayedTrick, setDisplayedTrick] = useState<any[]>([]);
  const trickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isShowingCompletedTrick, setIsShowingCompletedTrick] = useState(false);

  useEffect(() => {
    setPlayedCard(null);
  }, [gameState?.trick?.length]);

  useEffect(() => {
    if (!gameState) return;
    
    // If we have a completed trick (4 cards displayed) and the server has cleared it (0 cards),
    // start the display timeout but don't immediately clear the displayed trick
    if (displayedTrick.length === 4 && gameState.trick.length === 0 && !isShowingCompletedTrick) {
      if (trickTimeoutRef.current) clearTimeout(trickTimeoutRef.current);
      setIsShowingCompletedTrick(true);
      trickTimeoutRef.current = setTimeout(() => {
        setDisplayedTrick([]);
        setIsShowingCompletedTrick(false);
        trickTimeoutRef.current = null;
      }, 2000);
      return; // Don't update displayedTrick to gameState.trick yet
    }
    
    // For all other cases, sync displayedTrick with gameState.trick
    // unless we're showing a completed trick
    if (!isShowingCompletedTrick) {
      setDisplayedTrick(gameState.trick);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.trick, isShowingCompletedTrick]);

  useEffect(() => {
    if (!socket) return;
    const onInvalidPlay = () => {
      setPlayedCard(null);
      setError('Invalid card! Please follow suit.');
      setTimeout(() => setError(null), 1500);
    };
    const onGameOver = (data: { 
      scores: Record<string, number>, 
      collected: Record<string, string[]>,
      teamInfo?: {
        team1: { players: string[], roundScore: number, cumulativeScore: number },
        team2: { players: string[], roundScore: number, cumulativeScore: number }
      },
      gameEnded?: boolean,
      winningTeam?: number | null
    }) => {
      setGameOver(data);
      setCollected(data.collected || {});
    };
    const onGameStarted = () => {
      setGameOver(null);
      setCollected({});
      setDisplayedTrick([]);
    };
    socket.on('invalid_play', onInvalidPlay);
    socket.on('game_over', onGameOver);
    socket.on('game_started', onGameStarted);
    return () => {
      socket.off('invalid_play', onInvalidPlay);
      socket.off('game_over', onGameOver);
      socket.off('game_started', onGameStarted);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const onCollected = (data: Record<string, string[]>) => {
      setCollected(data);
    };
    socket.on('collected', onCollected);
    return () => {
      socket.off('collected', onCollected);
    };
  }, [socket]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (trickTimeoutRef.current) {
        clearTimeout(trickTimeoutRef.current);
      }
    };
  }, []);

  if (!gameState) {
    return <div style={{ textAlign: 'center', marginTop: '2rem' }}>Waiting for game state...</div>;
  }

  const { trick, turn, playerHandles, scores } = gameState;
  const currentPlayerId = playerHandles[turn]?.playerId;
  const currentPlayerHandle = playerHandles[turn]?.handle;
  const isMyTurn = playerHandles[turn]?.playerId === myPlayerId;
  const hasPlayed = playedCard !== null || (trick.find(t => t.player === myPlayerId) && trick.find(t => t.player === myPlayerId)?.card);

  // Debug logs for turn logic
  console.log('myPlayerId', myPlayerId, 'currentPlayerId', currentPlayerId, 'isMyTurn', isMyTurn);
  console.log('gameState.turn', turn, 'playerHandles[turn]', playerHandles[turn]);

  const onPlayCard = (card: string) => {
    if (!isMyTurn || hasPlayed || !socket) return;
    setPlayedCard(card);
    socket.emit('play_card', card);
  };

  // Helper: get point cards collected for a player
  const getPointCards = (playerId: string) => {
    const cards = collected[playerId] || [];
    return cards.filter(card => {
      return card.endsWith('♥') || card === 'Q♠' || card === 'J♦' || card === '10♣';
    });
  };

  // Helper: get color for a card
  const getCardColor = (card: string) => {
    if (card.endsWith('♥') || card.endsWith('♦')) return 'red';
    if (card.endsWith('♠') || card.endsWith('♣')) return 'black';
    return 'inherit';
  };

  // Helper: calculate team scores from individual scores
  const calculateTeamScoresFromIndividual = () => {
    if (!gameState?.teams) {
      // Fallback to old hardcoded logic if teams not available
      const team1 = (scores[playerHandles[0]?.playerId] || 0) + (scores[playerHandles[2]?.playerId] || 0);
      const team2 = (scores[playerHandles[1]?.playerId] || 0) + (scores[playerHandles[3]?.playerId] || 0);
      return { team1, team2 };
    }
    
    // Use actual team assignments from backend
    const team1 = gameState.teams.team1.reduce((sum, playerId) => sum + (scores[playerId] || 0), 0);
    const team2 = gameState.teams.team2.reduce((sum, playerId) => sum + (scores[playerId] || 0), 0);
    return { team1, team2 };
  };

  // Team scores - use cumulative scores from backend if available, otherwise calculate from current round
  const calculatedTeamScores = calculateTeamScoresFromIndividual();
  const team1Score = gameState?.cumulativeTeamScores?.team1 || calculatedTeamScores.team1;
  const team2Score = gameState?.cumulativeTeamScores?.team2 || calculatedTeamScores.team2;

  // Other players (not me)
  const otherPlayers = playerHandles.filter((p: Player) => p.playerId !== myPlayerId);

  // Helper: get team for a player
  const getTeam = (playerId: string) => {
    if (!gameState?.teams) {
      // Fallback to old hardcoded logic if teams not available
      if (playerId === playerHandles[0]?.playerId || playerId === playerHandles[2]?.playerId) return 1;
      if (playerId === playerHandles[1]?.playerId || playerId === playerHandles[3]?.playerId) return 2;
      return 0;
    }
    
    // Use actual team assignments from backend
    if (gameState.teams.team1.includes(playerId)) return 1;
    if (gameState.teams.team2.includes(playerId)) return 2;
    return 0;
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'inherit' }}>
      {/* Team scores at the top */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 16, fontWeight: 'bold', fontSize: 20 }}>
        <span style={{ color: '#222', background: '#e3eafc', borderRadius: 8, padding: '4px 16px' }}>Team 1: {team1Score}</span>
        <span style={{ color: '#222', background: '#f5e9da', borderRadius: 8, padding: '4px 16px' }}>Team 2: {team2Score}</span>
      </div>
      {/* Other players as tiles */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
        {otherPlayers.map((p: Player) => (
          <div
            key={p.playerId}
            style={{
              width: 70,
              height: 70,
              background: '#f5f5f5',
              color: '#222',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: 22,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
            }}
            onClick={() => setModalPlayer(p.playerId)}
          >
            {p.handle}
          </div>
        ))}
      </div>
      {/* Current trick in the center */}
      <div style={{ margin: '0 auto 24px auto', padding: 12, border: '1px solid #eee', borderRadius: 8, background: '#fafafa', maxWidth: 320 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Current Trick</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 8 }}>
          {playerHandles.map((p: Player) => {
            const t = displayedTrick.find((t: any) => t.player === p.playerId);
            const team = getTeam(p.playerId);
            const bg = team === 1 ? '#e3eafc' : '#f5e9da';
            const color = '#222';
            return (
              <div key={p.playerId} style={{ minWidth: 40, textAlign: 'center' }}>
                <div style={{ fontWeight: p.playerId === myPlayerId ? 'bold' : 'normal', fontSize: 14, background: bg, color, borderRadius: 6, padding: '2px 8px', marginBottom: 2 }}>{p.handle}</div>
                <div style={{ fontSize: 24, marginTop: 4, color: t && t.card ? getCardColor(t.card) : undefined }}>{t ? t.card : '—'}</div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Your hand at the bottom */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Your Hand</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {hand.map((card, i) => (
            <div
              key={i}
              style={{
                padding: '8px 14px',
                border: '1px solid #aaa',
                borderRadius: 6,
                background: playedCard === card ? '#eee' : '#fff',
                fontSize: 20,
                cursor: isMyTurn && !hasPlayed ? 'pointer' : 'not-allowed',
                opacity: isMyTurn && !hasPlayed ? 1 : 0.5,
                transition: 'background 0.2s',
                color: getCardColor(card),
                marginBottom: 4
              }}
              onClick={() => onPlayCard(card)}
            >
              {card}
            </div>
          ))}
        </div>
      </div>
      {/* Your collected point cards */}
      <div style={{ marginTop: 18, textAlign: 'center' }}>
        <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>Your Collected Point Cards</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', fontSize: 20 }}>
          {getPointCards(myPlayerId || '').length === 0 ? <span style={{ color: '#888', fontSize: 16 }}>None</span> :
            getPointCards(myPlayerId || '').map((card, idx) => (
              <span key={idx} style={{ color: getCardColor(card) }}>{card}</span>
            ))}
        </div>
      </div>
      {/* Turn/Waiting message */}
      <div style={{ marginTop: 24, color: currentPlayerId === myPlayerId ? 'green' : 'gray', textAlign: 'center', fontSize: 18, fontWeight: 500 }}>
        {currentPlayerId === myPlayerId
          ? (hasPlayed ? 'Waiting for others...' : 'Your turn!')
          : `Waiting for ${currentPlayerHandle}...`}
      </div>
      {/* Error message */}
      {error && <div style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>{error}</div>}
      {/* Modal for other player's collected cards */}
      {modalPlayer && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
          onClick={() => setModalPlayer(null)}
        >
          <div style={{ background: '#fff', padding: 24, borderRadius: 10, minWidth: 220, minHeight: 120 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>{playerHandles.find((p: Player) => p.playerId === modalPlayer)?.handle}'s Collected Point Cards</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', fontSize: 20 }}>
              {getPointCards(modalPlayer).length === 0 ? <span style={{ color: '#888', fontSize: 16 }}>None</span> :
                getPointCards(modalPlayer).map((card, idx) => (
                  <span key={idx} style={{ color: getCardColor(card) }}>{card}</span>
                ))}
            </div>
            <button style={{ marginTop: 18, padding: '6px 18px', borderRadius: 6, border: 'none', background: '#1976D2', color: '#fff', fontWeight: 'bold', fontSize: 16, cursor: 'pointer' }} onClick={() => setModalPlayer(null)}>Close</button>
          </div>
        </div>
      )}
      {/* Game over modal */}
      {gameOver && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 12, minWidth: 400, maxWidth: 500 }}>
            <h2>{gameOver.gameEnded ? 'Game Over!' : 'Round Over'}</h2>
            
            {gameOver.teamInfo ? (
              <div>
                <h3>Team Scores</h3>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ 
                    padding: '12px', 
                    margin: '8px 0', 
                    borderRadius: 6, 
                    background: gameOver.winningTeam === 1 ? '#e8f5e8' : '#f5f5f5',
                    border: gameOver.winningTeam === 1 ? '2px solid #4CAF50' : '1px solid #ddd'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>Team 1 ({gameOver.teamInfo.team1.players.join(' & ')})</strong>
                      {gameOver.winningTeam === 1 && <span style={{ color: '#4CAF50', fontSize: 24 }}>🏆</span>}
                    </div>
                    <div>Round: {gameOver.teamInfo.team1.roundScore}</div>
                    <div>Total: <strong>{gameOver.teamInfo.team1.cumulativeScore}</strong></div>
                  </div>
                  <div style={{ 
                    padding: '12px', 
                    margin: '8px 0', 
                    borderRadius: 6, 
                    background: gameOver.winningTeam === 2 ? '#e8f5e8' : '#f5f5f5',
                    border: gameOver.winningTeam === 2 ? '2px solid #4CAF50' : '1px solid #ddd'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>Team 2 ({gameOver.teamInfo.team2.players.join(' & ')})</strong>
                      {gameOver.winningTeam === 2 && <span style={{ color: '#4CAF50', fontSize: 24 }}>🏆</span>}
                    </div>
                    <div>Round: {gameOver.teamInfo.team2.roundScore}</div>
                    <div>Total: <strong>{gameOver.teamInfo.team2.cumulativeScore}</strong></div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h3>Team Scores</h3>
                {(() => {
                  // Calculate team scores using actual teams if available, otherwise use fallback
                  let team1Score, team2Score, team1Players, team2Players;
                  
                  if (gameState?.teams) {
                    // Use actual team assignments
                    team1Score = gameState.teams.team1.reduce((sum, playerId) => sum + (gameOver.scores[playerId] || 0), 0);
                    team2Score = gameState.teams.team2.reduce((sum, playerId) => sum + (gameOver.scores[playerId] || 0), 0);
                    team1Players = gameState.teams.team1.map(id => playerHandles.find(p => p.playerId === id)?.handle || id).join(' & ');
                    team2Players = gameState.teams.team2.map(id => playerHandles.find(p => p.playerId === id)?.handle || id).join(' & ');
                  } else {
                    // Fallback to hardcoded positions
                    team1Score = (gameOver.scores[playerHandles[0]?.playerId] || 0) + (gameOver.scores[playerHandles[2]?.playerId] || 0);
                    team2Score = (gameOver.scores[playerHandles[1]?.playerId] || 0) + (gameOver.scores[playerHandles[3]?.playerId] || 0);
                    team1Players = `${playerHandles[0]?.handle} & ${playerHandles[2]?.handle}`;
                    team2Players = `${playerHandles[1]?.handle} & ${playerHandles[3]?.handle}`;
                  }
                  
                  const team1Wins = team1Score > team2Score;
                  return (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ 
                        padding: '12px', 
                        margin: '8px 0', 
                        borderRadius: 6, 
                        background: team1Wins ? '#e8f5e8' : '#f5f5f5',
                        border: team1Wins ? '2px solid #4CAF50' : '1px solid #ddd'
                      }}>
                        <strong>Team 1 ({team1Players}): {team1Score}</strong>
                        {team1Wins && <span style={{ color: '#4CAF50', marginLeft: 8 }}>🏆</span>}
                      </div>
                      <div style={{ 
                        padding: '12px', 
                        margin: '8px 0', 
                        borderRadius: 6, 
                        background: !team1Wins ? '#e8f5e8' : '#f5f5f5',
                        border: !team1Wins ? '2px solid #4CAF50' : '1px solid #ddd'
                      }}>
                        <strong>Team 2 ({team2Players}): {team2Score}</strong>
                        {!team1Wins && <span style={{ color: '#4CAF50', marginLeft: 8 }}>🏆</span>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            
            <h3>Collected Cards This Round</h3>
            <ul style={{ listStyle: 'none', padding: 0, marginBottom: 20 }}>
              {Object.entries(gameOver.collected).map(([player, cards]) => {
                // Only show point cards
                const pointCards = cards.filter(card => card.endsWith('♥') || card === 'Q♠' || card === 'J♦' || card === '10♣');
                return (
                  <li key={player} style={{ margin: '8px 0', fontWeight: player === handle ? 'bold' : 'normal' }}>
                    {player}: {pointCards.length > 0 ? pointCards.map((card, idx) => (
                      <span key={idx} style={{ color: getCardColor(card), marginRight: 2 }}>{card}{idx < pointCards.length - 1 ? ', ' : ''}</span>
                    )) : <span style={{ color: '#888' }}>No point cards</span>}
                  </li>
                );
              })}
            </ul>
            
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button style={{ padding: '8px 16px' }} onClick={() => setGameOver(null)}>
                Close
              </button>
              {!gameOver.gameEnded && (
                <button 
                  style={{ padding: '8px 16px', background: '#2196F3', color: 'white', border: 'none', borderRadius: 4 }}
                  onClick={() => {
                    setGameOver(null);
                    if (socket) {
                      socket.emit('continue_game');
                    }
                  }}
                >
                  Continue (Same Teams)
                </button>
              )}
              <button 
                style={{ padding: '8px 16px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: 4 }}
                onClick={() => {
                  setGameOver(null);
                  if (socket) {
                    socket.emit('start_game');
                  }
                }}
              >
                {gameOver.gameEnded ? 'Start New Game' : 'New Game (New Teams)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <PlayerProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/game" element={<GameTable />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </PlayerProvider>
  );
}

export default App;
