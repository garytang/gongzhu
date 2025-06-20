#!/bin/bash

# Gongzhu Test Suite Runner
# Runs all tests for the project

set -e  # Exit on any error

echo "🃏 Running Gongzhu Test Suite..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to run tests and capture results
run_test_suite() {
    local name=$1
    local command=$2
    local directory=$3
    
    print_status $YELLOW "Running $name..."
    
    if [ -n "$directory" ]; then
        cd "$directory"
    fi
    
    if eval "$command"; then
        print_status $GREEN "✅ $name passed"
        return 0
    else
        print_status $RED "❌ $name failed"
        return 1
    fi
}

# Initialize test results
TOTAL_TESTS=0
PASSED_TESTS=0

# Backend Tests
echo ""
print_status $YELLOW "=== Backend Tests ==="

# Install backend dependencies if needed
if [ ! -d "backend/node_modules" ]; then
    print_status $YELLOW "Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

# Check if Mocha is installed
if [ ! -d "backend/node_modules/.bin/mocha" ]; then
    print_status $YELLOW "Installing Mocha test framework..."
    cd backend && npm install --save-dev mocha && cd ..
fi

# Run backend unit tests
((TOTAL_TESTS++))
if run_test_suite "Backend Unit Tests" "npm test" "backend"; then
    ((PASSED_TESTS++))
fi
cd ..

# Frontend Tests  
echo ""
print_status $YELLOW "=== Frontend Tests ==="

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
    print_status $YELLOW "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Run frontend tests
((TOTAL_TESTS++))
if run_test_suite "Frontend Unit Tests" "npm test -- --coverage --watchAll=false" "frontend"; then
    ((PASSED_TESTS++))
fi
cd ..

# Integration Tests
echo ""
print_status $YELLOW "=== Integration Tests ==="

# Start backend for integration tests
print_status $YELLOW "Starting backend server for integration tests..."
cd backend
npm start > ../test-backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for server to start
sleep 3

# Check if backend is running
if ! curl -s http://localhost:4000 > /dev/null; then
    print_status $RED "Backend server failed to start"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

# Run integration tests
((TOTAL_TESTS++))
if run_test_suite "Socket.IO Integration Tests" "npm run test:integration" "backend"; then
    ((PASSED_TESTS++))
fi
cd ..

# Clean up backend process
kill $BACKEND_PID 2>/dev/null || true
print_status $YELLOW "Stopped test backend server"

# End-to-End Tests (placeholder for future)
echo ""
print_status $YELLOW "=== End-to-End Tests ==="
print_status $YELLOW "E2E tests not implemented yet (would use Playwright/Cypress)"

# Test Summary
echo ""
print_status $YELLOW "=== Test Summary ==="
echo "Total test suites: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $((TOTAL_TESTS - PASSED_TESTS))"

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    print_status $GREEN "🎉 All tests passed!"
    exit 0
else
    print_status $RED "💥 Some tests failed"
    exit 1
fi