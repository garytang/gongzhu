#!/bin/bash

# Development Server Launcher for Gongzhu
# This script starts both frontend and backend development servers

# Kill any running frontend/backend dev servers (on ports 3000 and 4000)
kill $(lsof -t -i:3000) 2>/dev/null
kill $(lsof -t -i:4000) 2>/dev/null

# Start backend in background, log to backend.log
(cd backend && npm start > ../backend.log 2>&1 &)
BACKEND_PID=$!

# Start frontend in background, log to frontend.log
(cd frontend && npm start > ../frontend.log 2>&1 &)
FRONTEND_PID=$!

# Wait a few seconds for servers to start
sleep 5

# Open four browser windows/tabs for four players (uncomment if desired)
# open -na "Google Chrome" --args --new-window "http://localhost:3000/login"
# sleep 1
# open -na "Google Chrome" --args --new-window "http://localhost:3000/login"
# sleep 1
# open -na "Google Chrome" --args --new-window "http://localhost:3000/login"

# Print instructions
cat <<EOM

🃏 Gongzhu Development Servers Started

Frontend: http://localhost:3000
Backend:  http://localhost:4000

Manual Testing Instructions:
- Open 4 browser windows to http://localhost:3000/login
- Enter unique handles (e.g., Player1, Player2, Player3, Player4) in each window
- When all four players are in the lobby, start the game

To stop servers, run:
  kill $BACKEND_PID $FRONTEND_PID

Backend logs: backend.log
Frontend logs: frontend.log

For automated tests, run: ./test.sh
EOM 