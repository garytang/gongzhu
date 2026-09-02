import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PlayerProvider } from './PlayerContext';
import ConnectionBanner from './components/ConnectionBanner';
import GameTable from './components/GameTable';
import Lobby from './components/Lobby';
import Login from './components/Login';

function App() {
  return (
    <PlayerProvider>
      <ConnectionBanner />
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
