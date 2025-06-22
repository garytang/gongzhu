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

### Service-Specific railway.json Files

Each service has its own `railway.json` configuration file:

#### Backend Configuration (`backend/railway.json`):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Frontend Configuration (`frontend/railway.json`):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "npx serve -s build -p $PORT",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Important Notes:**
- **No root `railway.json`** - this would force single-service deployment
- Each service reads its own configuration when Railway sets the root directory
- Backend uses `npm start` to run the Express server
- Frontend builds React app and serves static files using `serve`

## Deployment Process

### Step-by-Step Railway Setup

#### Step 1: Create Backend Service
1. **Go to Railway Dashboard** (https://railway.app)
2. **Click "New Project"** 
3. **Select "Deploy from GitHub repo"**
4. **Choose your repository** (e.g., `username/gongzhu`)
5. **Service will start building automatically** - it will likely fail initially
6. **Configure Root Directory:**
   - Go to **Service Settings** → **Source** (or **Deploy** section)
   - Find **"Root Directory"** field
   - Set to: **`/backend`**
   - Click **Save**
7. **Enable Public Networking:**
   - Go to **Service Settings** → **Networking**
   - Enable **"Public Networking"**
   - This generates a public URL that browsers can access
8. **Set Environment Variables** (Settings → Variables):
   - `NODE_ENV`: `production`
   - `CORS_ORIGIN`: `*` (update later with frontend URL)
9. **Redeploy the service**

#### Step 2: Create Frontend Service  
1. **Click "New Project"** again
2. **Select "Deploy from GitHub repo"**
3. **Choose the SAME repository** (`username/gongzhu`)
4. **Service will start building** - will likely fail initially
5. **Configure Root Directory:**
   - Go to **Service Settings** → **Source** (or **Deploy** section)
   - Find **"Root Directory"** field  
   - Set to: **`/frontend`**
   - Click **Save**
6. **Enable Public Networking:**
   - Go to **Service Settings** → **Networking**
   - Enable **"Public Networking"**
   - This allows users to access your React app in browsers
7. **Set Environment Variables** (Settings → Variables):
   - `REACT_APP_BACKEND_URL`: `https://your-backend-service.railway.app`
8. **Redeploy the service**

#### Step 3: Update Cross-References
Once both services are successfully deployed:

**Backend Service Environment Variables:**
- Update `CORS_ORIGIN` to your frontend service URL
- Example: `https://gongzhu-frontend-abc123.railway.app`

**Frontend Service Environment Variables:**
- Update `REACT_APP_BACKEND_URL` to your backend service URL  
- Example: `https://gongzhu-backend-def456.railway.app`

#### Step 4: Final Redeploy
- Redeploy both services after updating environment variables
- Test the application by visiting the frontend service URL

### Troubleshooting Common Issues

**"No start command found" Error:**
- Ensure Root Directory is set correctly (`/backend` or `/frontend`)
- Check that each directory has its own `package.json` with proper dependencies

**"Cannot find module" Errors:**
- Verify `backend/package.json` includes: `express`, `socket.io`, `cors`
- Verify `frontend/package.json` includes: `react`, `react-scripts`, `socket.io-client`

**Build Failures:**
- Check Railway build logs for specific error messages
- Ensure dependencies are properly listed in respective `package.json` files

**CORS Errors:**
- Verify `CORS_ORIGIN` in backend matches frontend service URL exactly
- Ensure both services are deployed and accessible

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

## Railway Networking Configuration

### Public vs Private Networking

**Both services MUST have Public Networking enabled** for this application:

#### Why Backend Needs Public Networking:
- **Direct WebSocket Connections**: Users' browsers connect directly to the backend for Socket.IO
- **Real-time Communication**: WebSocket connections bypass the frontend service
- **API Access**: Frontend JavaScript makes HTTP requests to backend from browsers

#### Why Frontend Needs Public Networking:
- **User Access**: Users need to access the React app in their browsers
- **Static File Serving**: HTML, CSS, and JavaScript files must be publicly accessible

#### Network Flow:
```
User's Browser → Frontend Service (public URL) → Loads React App
User's Browser → Backend Service (public URL) → WebSocket connection for game
```

### Railway Private Networking
Private networking (internal Railway URLs) is **not sufficient** because:
- Private URLs only work between Railway services
- User browsers cannot access private Railway networks
- WebSocket connections from browsers require public endpoints

## WebSocket Configuration

Railway fully supports WebSocket connections. No special configuration needed for Socket.IO - it works out of the box with public networking enabled.

## Best Practices

1. **Separate Services**: Deploy frontend and backend as separate Railway services
2. **Environment Variables**: Use Railway's environment variables for service-to-service communication
3. **Watch Paths**: Configure watch paths to prevent unnecessary rebuilds
4. **Health Checks**: Railway automatically monitors service health
5. **Custom Domains**: Available on all plans including free tier