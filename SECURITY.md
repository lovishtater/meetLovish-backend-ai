# Security & Rate Limiting

## 🛡️ Multi-Layered Rate Limiting System

The backend implements a robust, multi-layered rate limiting system to prevent abuse and protect against OpenAI credit exhaustion attacks.

## 🔒 Attack Prevention

### **1. Session Limit Removal**
- **Before**: 30 messages per session (easily bypassed)
- **After**: No session limits (users can chat freely within daily limits)
- **Benefit**: Better user experience, no artificial session barriers

### **2. Multi-Identifier Tracking**
The system tracks daily limits across **three independent identifiers**:

#### **A. IP Address Tracking**
- **Purpose**: Prevents abuse from same network
- **Bypass**: VPN/proxy (but other identifiers still apply)
- **Storage**: In-memory with daily reset

#### **B. User Token Tracking**
- **Purpose**: Prevents abuse even if localStorage is cleared
- **Bypass**: None (persistent across browser resets)
- **Storage**: In-memory with daily reset

#### **C. Browser Fingerprint Tracking**
- **Purpose**: Prevents abuse from same device/browser
- **Components**: Browser name, version, OS, geolocation
- **Bypass**: Requires changing device/browser completely
- **Storage**: In-memory with daily reset

### **3. Configurable Daily Limits**
```bash
# Set in .env file
DAILY_MESSAGE_LIMIT=150  # Default if not set
```

## 🚨 Attack Scenarios & Mitigation

### **Scenario 1: localStorage Clearing**
```
Attack: User clears localStorage → New userToken → Bypass limits
Mitigation: Browser fingerprint + IP tracking still applies
Result: ❌ Attack fails
```

### **Scenario 2: VPN/Proxy Usage**
```
Attack: User changes IP via VPN → New IP → Reset daily limit
Mitigation: User token + browser fingerprint still applies
Result: ❌ Attack fails
```

### **Scenario 3: Browser Reset**
```
Attack: User resets browser → New fingerprint → Bypass limits
Mitigation: IP address + user token still applies
Result: ❌ Attack fails
```

### **Scenario 4: Complete Device Change**
```
Attack: User changes device → New fingerprint + IP → Bypass limits
Mitigation: Requires legitimate device change (acceptable)
Result: ✅ Legitimate use case
```

## 📊 Rate Limiting Logic

### **Daily Limit Enforcement**
```javascript
// All three identifiers must be under the limit
const identifiers = [
  { key: ip, store: ipStore, type: 'IP' },
  { key: userToken, store: userTokenStore, type: 'User Token' },
  { key: fingerprint, store: fingerprintStore, type: 'Fingerprint' }
];

// If ANY identifier exceeds the limit, request is blocked
if (anyIdentifier.messageCount >= DAILY_MESSAGE_LIMIT) {
  return { allowed: false, reason: 'daily_limit' };
}
```

### **Count Tracking**
```javascript
// Increment counts for ALL valid identifiers
for (const identifier of identifiers) {
  if (identifier.key) {
    identifier.store.get(identifier.key).messageCount++;
  }
}

// Return the highest count across all identifiers
return { dailyCount: Math.max(...allCounts) };
```

## 🔧 Configuration

### **Environment Variables**
```bash
# Required
DAILY_MESSAGE_LIMIT=150  # Messages per day per user

# Optional (for monitoring)
NODE_ENV=production
```

### **Monitoring & Alerts**
The system provides detailed information about which identifier exceeded the limit:

```json
{
  "error": "Daily limit reached. You can send up to 150 messages per day.",
  "reason": "daily_limit",
  "dailyCount": 150,
  "exceededBy": "User Token",  // Shows which identifier triggered the limit
  "resetTime": 1732489200000
}
```

## 🎯 Benefits

### **For Users:**
✅ **No Session Limits**: Chat freely within daily limits
✅ **Better UX**: No artificial session barriers
✅ **Fair Limits**: 150 messages per day is generous

### **For System:**
✅ **Attack Prevention**: Multi-layered protection
✅ **Cost Control**: Prevents OpenAI credit abuse
✅ **Configurable**: Easy to adjust limits via environment
✅ **Monitoring**: Clear visibility into limit triggers

### **For Development:**
✅ **Simple Setup**: Just set `DAILY_MESSAGE_LIMIT`
✅ **Easy Testing**: Can adjust limits for testing
✅ **Clear Logs**: Detailed rate limiting information

## 🚀 Production Recommendations

1. **Set Appropriate Limits**: Start with 150, adjust based on usage
2. **Monitor Usage**: Watch for unusual patterns
3. **Consider Redis**: For production, use Redis instead of in-memory storage
4. **Log Analysis**: Monitor which identifiers trigger limits most often
5. **User Feedback**: Collect feedback on limit appropriateness

This system provides robust protection against abuse while maintaining a good user experience!
