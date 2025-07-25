# Frontend API Integration Guide

## Base URL
```
https://your-backend-domain.com
```

## User Token System

The backend now uses a token-based user identification system:

1. **User Token**: A unique identifier stored in localStorage to track returning users
2. **Session ID**: Generated for each chat session (for organization, no timeout)
3. **User-Session Relationship**: Users can have multiple sessions tracked over time

## Rate Limiting & Security

The backend implements **multi-layered rate limiting** to prevent abuse:

1. **Daily Limit**: Configurable via `DAILY_MESSAGE_LIMIT` environment variable (default: 150)
2. **Multi-Identifier Tracking**: Tracks limits across:
   - **IP Address**: Prevents abuse from same network
   - **User Token**: Prevents abuse even if localStorage is cleared
   - **Browser Fingerprint**: Prevents abuse from same device/browser
3. **Attack Prevention**:
   - Clearing localStorage won't reset limits
   - Using VPN/proxy won't bypass limits
   - Same device/browser is tracked regardless of IP changes

## Personalization Features

The AI assistant now provides intelligent personalization:

1. **Name Recognition**: Once a user provides their name, it's used throughout the conversation
2. **Incremental Data Collection**: Information is gathered naturally as the conversation progresses
3. **Smart Context**: The AI remembers previous information and builds on it
4. **No Repetitive Questions**: Won't ask for information already provided

### User Information Flow:
- **Initial**: `userInfo.name` and `userInfo.email` are `null`
- **After Name Provided**: `userInfo.name` contains the user's name
- **After Email Provided**: `userInfo.email` contains the user's email
- **Frontend Display**: Use these fields to show personalized UI elements

## Available APIs

### 1. POST /api/chat/init
**Purpose:** Start a new chat session and identify/create user

**Request:**
```javascript
POST /api/chat/init
Content-Type: application/json
Body: {
  "token": "optional-existing-user-token" // Send null or omit for new users
}
```

**Response:**
```json
{
  "sessionId": "abc123def456",
  "userToken": "xyz789abc123", // New or existing user token
  "userInfo": {
    "geolocation": {
      "country": "US",
      "region": "CA",
      "city": "San Francisco",
      "ll": [37.7749, -122.4194],
      "timezone": "America/Los_Angeles"
    },
    "browser": {
      "name": "Chrome",
      "version": "91.0.4472.124",
      "os": "Windows 10"
    },
    "name": "John Doe", // User's name if previously provided
    "email": "john@example.com" // User's email if previously provided
  },
  "rateLimits": {
    "dailyCount": 0,
    "dailyLimit": 150
  },
  "timestamp": "2025-07-25T07:30:00.000Z"
}
```

**Headers Received:**
```
X-RateLimit-Daily-Limit: 150
X-RateLimit-Daily-Remaining: 150
X-RateLimit-Reset: 1732489200000
```

**Frontend Implementation:**
```javascript
// Check localStorage for existing token
let userToken = localStorage.getItem('userToken');

// Initialize chat session
const response = await fetch('/api/chat/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: userToken })
});

const data = await response.json();

// Store the token (new or existing)
localStorage.setItem('userToken', data.userToken);
localStorage.setItem('sessionId', data.sessionId);
```

### 2. POST /api/chat
**Purpose:** Send message to AI assistant

**Request:**
```javascript
POST /api/chat
Content-Type: application/json
Body: {
  "message": "Hello, tell me about Lovish's experience",
  "sessionId": "abc123def456",
  "userToken": "xyz789abc123"
}
```

**Response:**
```json
{
  "message": "Hello! I'm here to tell you about Lovish Tater...",
  "sessionId": "abc123def456",
  "userInfo": {
    "name": "John Doe", // User's name if provided during conversation
    "email": "john@example.com" // User's email if provided during conversation
  },
  "rateLimits": {
    "dailyCount": 1,
    "dailyLimit": 150
  }
}
```

**Headers Received:**
```
X-RateLimit-Daily-Limit: 150
X-RateLimit-Daily-Remaining: 149
X-RateLimit-Reset: 1732489200000
```

**Frontend Implementation:**
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: userMessage,
    sessionId: localStorage.getItem('sessionId'),
    userToken: localStorage.getItem('userToken')
  })
});
```

### 3. GET /api/chat/status
**Purpose:** Check rate limit status

**Request:**
```javascript
GET /api/chat/status?sessionId=abc123def456
```

**Response:**
```json
{
  "sessionId": "abc123def456",
  "rateLimits": {
    "dailyCount": 12,
    "dailyRemaining": 138
  }
}
```

### 4. GET /health
**Purpose:** Check if backend is running

**Request:**
```javascript
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-07-25T07:30:00.000Z",
  "version": "1.0.0",
  "environment": "production"
}
```

### 5. GET /
**Purpose:** Get API information

**Request:**
```javascript
GET /
```

**Response:**
```json
{
  "name": "Lovish Tater AI Assistant Backend",
  "description": "Backend API for the AI assistant integrated into Lovish Tater's portfolio website",
  "version": "1.0.0",
  "endpoints": {
    "chat": {
      "init": "POST /api/chat/init - Initialize a new chat session",
      "send": "POST /api/chat - Send a message to the AI assistant",
      "status": "GET /api/chat/status - Get session status and rate limits"
    },
    "health": "GET /health - Health check endpoint"
  },
  "rateLimits": {
    "daily": "150 messages per day (configurable via DAILY_MESSAGE_LIMIT)"
  }
}
```

## Error Responses

### Rate Limit Exceeded (429)
```json
{
  "error": "Session limit reached. You can send up to 30 messages per session. Please refresh to start a new session.",
  "reason": "session_limit",
  "sessionCount": 30,
  "dailyCount": 45,
  "resetTime": null
}
```

### Daily Limit Exceeded (429)
```json
{
  "error": "Daily limit reached. You can send up to 150 messages per day. Please try again tomorrow.",
  "reason": "daily_limit",
  "sessionCount": 5,
  "dailyCount": 150,
  "resetTime": 1732489200000
}
```

### Invalid Request (400)
```json
{
  "error": "Session ID is required"
}
```

### Message Too Long (400)
```json
{
  "error": "Message too long. Maximum 1000 characters allowed."
}
```

### Server Error (500)
```json
{
  "error": "Internal server error. Please try again."
}
```

### Service Unavailable (503)
```json
{
  "error": "AI service temporarily unavailable. Please try again in a moment."
}
```

## Rate Limit Information

- **Session Limit**: 30 messages per session
- **Daily Limit**: 150 messages per day per IP
- **Session Duration**: 1 hour of inactivity
- **Headers**: All rate limit info provided in response headers
- **Reset Time**: Unix timestamp for when daily limit resets

## Data Available

- **Session ID**: Unique identifier for current session
- **User Token**: Persistent identifier for returning users
- **User Geolocation**: Country, region, city, coordinates, timezone
- **Browser Info**: Name, version, operating system
- **Rate Limits**: Current usage and limits
- **Timestamps**: ISO 8601 format for all timestamps

## Frontend Storage Strategy

```javascript
// Recommended localStorage structure
localStorage.setItem('userToken', 'xyz789abc123'); // Persistent user identifier
localStorage.setItem('sessionId', 'abc123def456'); // Current session
localStorage.setItem('lastActivity', '2025-07-25T07:30:00.000Z'); // For session timeout

// Check if session is still valid (1 hour timeout)
function isSessionValid() {
  const lastActivity = localStorage.getItem('lastActivity');
  if (!lastActivity) return false;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return new Date(lastActivity) > oneHourAgo;
}

// Update activity timestamp on each message
function updateActivity() {
  localStorage.setItem('lastActivity', new Date().toISOString());
}
```
