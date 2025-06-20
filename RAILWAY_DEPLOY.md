# Railway Deployment Guide for Gongzhu (2024)

## Overview
Railway provides excellent support for monorepo deployments with both frontend and backend services. This document outlines the deployment configuration for the Gongzhu card game application.

## Railway Monorepo Support (2024)

Railway supports two types of monorepos:
1. **Isolated Monorepos**: Components isolated to their directories (our case: React frontend + Node.js backend)
2. **Shared Monorepos**: Components sharing code/configuration (Yarn workspaces, Lerna projects)

## Deployment Architecture

### Services Configuration
- **Frontend Service**: Static React build served from Railway
- **Backend Service**: Node.js Express server with Socket.IO on Railway
- **Database**: Not required (game state in memory)

### Key Configuration Requirements

1. **Root Directory Setting**: 
   - Frontend service: `/frontend`
   - Backend service: `/backend`

2. **Watch Paths**: Prevent unnecessary rebuilds
   - Frontend watches: `frontend/**`
   - Backend watches: `backend/**`

3. **Environment Variables**:
   - Backend: `NODE_ENV=production`, `PORT=8080` (Railway default)
   - Frontend: `REACT_APP_BACKEND_URL` (points to backend service URL)

## Configuration Files

### railway.json (Recommended)
```json
{
  "services": {
    "backend": {
      "rootDirectory": "/backend",
      "startCommand": "npm start",
      "watchPaths": ["backend/**"]
    },
    "frontend": {
      "rootDirectory": "/frontend", 
      "startCommand": "npm run build",
      "watchPaths": ["frontend/**"]
    }
  }
}
```

## Deployment Process

### Method 1: GitHub Integration (Recommended)
1. Push code to GitHub repository
2. Connect Railway to GitHub repo
3. Create new project in Railway
4. Add two services: frontend and backend
5. Configure root directories and environment variables
6. Deploy

### Method 2: Railway CLI
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up
```

## Environment Variables Setup

### Backend Service
- `NODE_ENV`: `production`
- `PORT`: `8080` (Railway default)
- `CORS_ORIGIN`: `${{RAILWAY_PUBLIC_DOMAIN}}` (frontend domain)

### Frontend Service
- `REACT_APP_BACKEND_URL`: `https://backend-service-name.railway.app`

## WebSocket Configuration

Railway fully supports WebSocket connections. No special configuration needed for Socket.IO - it works out of the box.

## Best Practices

1. **Separate Services**: Deploy frontend and backend as separate Railway services
2. **Environment Variables**: Use Railway's environment variables for service-to-service communication
3. **Watch Paths**: Configure watch paths to prevent unnecessary rebuilds
4. **Health Checks**: Railway automatically monitors service health
5. **Custom Domains**: Available on all plans including free tier