import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PlayerProvider } from './PlayerContext';
import ConnectionBanner from './components/ConnectionBanner';
import Lobby from './components/Lobby';
import Login from './components/Login';
import Room from './components/Room';

function App() {
  return (
    <PlayerProvider>
      <ConnectionBanner />
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/lobby" element={<Lobby />} />
          {/* The invite link. A guest who opens it is asked for a handle, then joins. */}
          <Route path="/room/:code" element={<Room />} />
          <Route path="*" element={<Navigate to="/lobby" replace />} />
        </Routes>
      </Router>
    </PlayerProvider>
  );
}

export default App;
