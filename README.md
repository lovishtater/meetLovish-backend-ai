# AI Assistant Backend

A Node.js backend for an AI assistant integrated into my personal portfolio website. Uses OpenAI's GPT API with smart validation and function calling.

## ✨ Features

- 🤖 **AI Assistant**: Powered by OpenAI GPT-4o-mini with smart question validation
- 🛡️ **Rate Limiting**: Configurable daily message limits per IP
- 📊 **Analytics**: Admin dashboard with chat and user analytics
- 🔧 **Smart Filtering**: Automatically filters irrelevant questions
- 🌍 **CORS Ready**: Configurable for frontend integration

## 🚀 Quick Start

1. **Install dependencies:**
```bash
npm install
```

2. **Set environment variables:**
```bash
# Required
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=your_mongodb_connection
ADMIN_SECRET=your_admin_secret
EMAIL=your_email@example.com
USER_NAME=Your Name
PERSONAL_INFO="Your complete personal information..."

# Optional
FRONTEND_URL=https://yourdomain.com
DAILY_MESSAGE_LIMIT=50
```

3. **Start server:**
```bash
npm start
```

## 📡 API Endpoints

### Chat
- `POST /api/chat` - Send message to AI assistant
- `GET /api/chat/status` - Check session status

### Admin (Protected with secret)
- `GET /api/admin/dashboard?secret=SECRET` - Analytics dashboard
- `GET /api/admin/analytics?secret=SECRET` - Chat statistics
- `GET /api/admin/chats?secret=SECRET` - Recent conversations

### Health
- `GET /health` - Health check

## 🌍 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `ADMIN_SECRET` | ✅ | Admin dashboard secret |
| `EMAIL` | ✅ | Your email address |
| `USER_NAME` | ✅ | Your name for AI assistant |
| `PERSONAL_INFO` | ✅ | Complete personal background |
| `FRONTEND_URL` | ⚪ | Frontend domain for CORS |
| `DAILY_MESSAGE_LIMIT` | ⚪ | Daily message limit (default: 50) |

## 📱 Frontend Integration

```javascript
// Send message
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Hello!",
    sessionId: "optional-session-id"
  })
});

const result = await response.json();
```

## 🚀 Deployment

Set environment variables in your hosting platform and deploy. The system automatically handles:
- Rate limiting
- Session management
- Database connections
- CORS configuration

---

Built with ❤️ for Lovish Tater's portfolio website.
