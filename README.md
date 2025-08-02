# AI Assistant Backend

A Node.js backend for an AI assistant integrated into my personal portfolio website. The assistant uses OpenAI's GPT API with function calling tools to interact with visitors, collect user details, and track unknown questions.

## ✨ Features

- 🤖 **AI Assistant**: Powered by OpenAI GPT-4o-mini with function calling
- 🛡️ **Rate Limiting**: 30 messages per session, 150 per day per IP
- 📊 **Chat Logging**: Complete session tracking with geolocation and device info
- 🔧 **Admin Dashboard**: Protected admin interface with analytics
- 🌍 **CORS Ready**: Configurable for frontend integration
- 📈 **Analytics**: Real-time chat and tool usage statistics

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- OpenAI API key
- Optional: MongoDB for production (uses local files by default)

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd meetLovish-backend-ai
npm install
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env with your values:
# OPENAI_API_KEY=your_openai_api_key_here
# ADMIN_SECRET=your_secure_admin_secret_here
# PORT=3000
```

3. **Start the server:**
```bash
npm start
# or for development:
npm run dev
```

4. **Verify installation:**
```bash
curl http://localhost:3000/health
```

## 📡 API Endpoints

### Chat Endpoints

#### `POST /api/chat`
Send a message to the AI assistant.

**Request:**
```json
{
  "message": "Hi, tell me about Lovish's experience",
  "sessionId": "optional-session-id",
  "sessionMessages": []
}
```

**Response:**
```json
{
  "message": "Hello! I'm here to tell you about Lovish Tater...",
  "sessionId": "generated-session-id",
  "sessionMessages": [...],
  "rateLimits": {
    "sessionCount": 1,
    "dailyCount": 1,
    "sessionLimit": 30,
    "dailyLimit": 150
  }
}
```

#### `GET /api/chat/status`
Get session status and rate limits.

**Parameters:**
- `sessionId` (optional): Session ID to check

**Response:**
```json
{
  "sessionId": "session-id",
  "rateLimits": {
    "sessionCount": 5,
    "dailyCount": 12,
    "sessionRemaining": 25,
    "dailyRemaining": 138
  }
}
```

### Admin Endpoints (Protected)

All admin endpoints require a secret parameter: `?secret=YOUR_SECRET`

#### `GET /api/admin/dashboard?secret=YOUR_SECRET`
Web-based admin dashboard with visual analytics.

#### `GET /api/admin/chats?secret=YOUR_SECRET`
Get recent chat sessions in JSON format.

**Parameters:**
- `limit` (optional): Number of chats to return (max 200)

#### `GET /api/admin/tools?secret=YOUR_SECRET`
Get recent tool calls (user details, unknown questions).

#### `GET /api/admin/analytics?secret=YOUR_SECRET`
Get analytics summary with chat and tool statistics.

### Other Endpoints

#### `GET /health`
Health check endpoint.

#### `GET /`
API information and available endpoints.

## 🔧 Function Calling Tools

The AI assistant has access to two tools:

### `record_user_details`
Records when a user provides contact information.

**Parameters:**
- `email` (required): User's email address
- `name` (optional): User's name
- `notes` (optional): Additional conversation context

### `record_unknown_question`
Records questions the AI couldn't answer.

**Parameters:**
- `question` (required): The unanswered question

## 📊 Data Storage

### MongoDB Collections
The system uses MongoDB for persistent storage with the following collections:

#### Chats Collection
- Session identification and message history
- User and assistant messages
- Tool outputs and user information
- Geolocation and browser data
- Automatic cleanup after 30 days

#### Users Collection
- Contact information (email, name, notes)
- Interaction history and analytics
- User metadata and geolocation
- Status tracking (active, inactive, blocked)

#### Tool Calls Collection
- Function call logs with detailed results
- Processing time and success/failure tracking
- Session context and user information
- Automatic cleanup after 90 days

### In-Memory Storage
- Rate limiting data (session and daily limits)
- Session management for active conversations
- Automatic cleanup of old sessions

## 🛡️ Rate Limiting

- **Session Limit**: 30 messages per session
- **Daily Limit**: 150 messages per day per IP
- **Session Duration**: 1 hour of inactivity
- **Cleanup**: Automatic cleanup of old sessions and daily counters

## 🔒 Security

- **Admin Secret**: Simple secret-based authentication for admin endpoints
- **CORS**: Configurable origin restrictions
- **Input Validation**: Message length limits and sanitization
- **Rate Limiting**: Prevents abuse and API cost control
- **Error Handling**: Secure error messages in production

## 🌍 Environment Variables

```bash
# Required
OPENAI_API_KEY=your_openai_api_key_here
ADMIN_SECRET=your_secure_admin_secret_here
MONGODB_URI=mongodb://localhost:27017/meetlovish

# Optional
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Alternative MongoDB connection (for cloud platforms)
DATABASE_URL=mongodb+srv://username:password@cluster.mongodb.net/meetlovish
```

## 📱 Frontend Integration

### Basic Chat Implementation

```javascript
// Send a message
async function sendMessage(message, sessionId = null, sessionMessages = []) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, sessionMessages })
  });

  return await response.json();
}

// Check session status
async function getSessionStatus(sessionId) {
  const response = await fetch(`/api/chat/status?sessionId=${sessionId}`);
  return await response.json();
}
```

### Session Management

```javascript
class ChatSession {
  constructor() {
    this.sessionId = localStorage.getItem('sessionId');
    this.messages = JSON.parse(localStorage.getItem('messages') || '[]');
  }

  async sendMessage(message) {
    const result = await sendMessage(message, this.sessionId, this.messages);

    if (result.sessionId) {
      this.sessionId = result.sessionId;
      this.messages = result.sessionMessages;

      localStorage.setItem('sessionId', this.sessionId);
      localStorage.setItem('messages', JSON.stringify(this.messages));
    }

    return result;
  }
}
```

## 🔍 Monitoring & Analytics

The admin API provides comprehensive data for frontend dashboards:

### Dashboard Data
- Real-time chat statistics and trends
- User engagement metrics and demographics
- Tool usage analytics with success rates
- Recent conversations and user interactions
- Geographic distribution and browser analytics

### Available Endpoints
- `/api/admin/dashboard` - Comprehensive dashboard data
- `/api/admin/analytics` - Detailed analytics
- `/api/admin/chats` - Recent chat sessions
- `/api/admin/users` - User management
- `/api/admin/tools` - Tool call logs
- `/api/admin/sessions/:id` - Session history
- `/api/admin/search` - Search functionality
- `/api/admin/status` - System status

See `API_DOCUMENTATION.md` for complete endpoint documentation.

## 📝 Memory System

The AI assistant loads context from environment variable `PERSONAL_INFO` which contains:
- User's professional background
- Skills and expertise
- Professional experience
- Personal traits and focus areas

Edit this file to update the assistant's knowledge about User.

## 🚀 Deployment

### Production Checklist

1. Set secure environment variables
2. Configure CORS for your frontend domain
3. Set up reverse proxy (nginx/apache)
4. Enable HTTPS
5. Set up log rotation
6. Configure monitoring
7. Set `NODE_ENV=production`

### Example Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License - see the package.json file for details.

## 💬 Support

For questions or issues:
- Check the admin dashboard for logs
- Review console output for errors
- Ensure environment variables are set correctly
- Verify OpenAI API key permissions

---

Built with ❤️ for Lovish Tater's portfolio website.
