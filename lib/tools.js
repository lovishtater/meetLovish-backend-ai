const { logToolCall } = require('../utils/logger');
const User = require('../models/User');
const database = require('../models/database');

// Email validation function
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email is required and must be a string' };
  }

  const trimmedEmail = email.trim();
  if (trimmedEmail.length === 0) {
    return { isValid: false, error: 'Email cannot be empty' };
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return { isValid: false, error: 'Please provide a valid email address (e.g., user@example.com)' };
  }

  // Check for common issues
  if (trimmedEmail.includes(' ')) {
    return { isValid: false, error: 'Email address cannot contain spaces' };
  }

  if (trimmedEmail.length > 254) {
    return { isValid: false, error: 'Email address is too long' };
  }

  return { isValid: true };
}

// Function to record user details incrementally
async function recordUserDetails(email = '', name = '', notes = '', sessionId = null, userInfo = null, userId = null) {
  const startTime = Date.now();

  try {
    // Validate email if provided
    if (email && email.trim()) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        return {
          recorded: 'error',
          message: emailValidation.error,
          validationError: true,
          field: 'email',
        };
      }

      // If there's a warning, include it in the response
      if (emailValidation.warning) {
        notes = notes ? `${notes}\n${emailValidation.warning}` : emailValidation.warning;
      }
    }

    // Log what we're trying to update
    const updates = [];
    if (email) {
      updates.push(`email: ${email}`);
    }
    if (name) {
      updates.push(`name: ${name}`);
    }
    if (notes) {
      updates.push(`notes: ${notes}`);
    }

    console.log(`📧 Recording user details: ${updates.join(', ')}`);

    let user = null;
    let result = { status: 'success', message: 'User details updated successfully' };

    // Save to MongoDB if database is available
    if (database.isConnectionReady()) {
      try {
        // If we have a userId, find and update the existing user
        if (userId) {
          user = await User.findById(userId);
          if (user) {
            await user.updateUserDetails(email, name, notes);
            console.log(`✅ User details updated in MongoDB for user: ${user._id}`);
          } else {
            console.warn('⚠️ User not found with provided userId');
            result = { status: 'warning', message: 'User not found' };
          }
        } else {
          // Fallback: try to find user by email if provided
          if (email) {
            user = await User.findOne({ email: email.toLowerCase() });
            if (user) {
              await user.updateUserDetails(email, name, notes);
              console.log(`✅ User details updated in MongoDB for email: ${email}`);
            } else {
              console.warn('⚠️ No userId provided and user not found by email');
              result = { status: 'warning', message: 'User not found' };
            }
          } else {
            console.warn('⚠️ No userId or email provided for user update');
            result = { status: 'warning', message: 'No user identifier provided' };
          }
        }
      } catch (dbError) {
        console.error('❌ Error updating user in MongoDB:', dbError);
        result = { status: 'error', message: 'Database error while updating user' };
      }
    } else {
      console.warn('⚠️ Database not ready, user data not persisted');
      result = { status: 'success', message: 'User details logged (database unavailable)' };
    }

    // Log the tool call
    const processingTime = Date.now() - startTime;
    await logToolCall(
      {
        type: 'user_details',
        email,
        name,
        notes,
      },
      sessionId,
      userInfo,
      { ...result, processingTime },
      userId
    );

    // Here you could add additional integrations like:
    // - Send email notification
    // - Add to CRM system
    // - Send webhook to external service
    // - Send notification to admin

    return {
      recorded: 'ok',
      message: result.message,
      userId: user?._id,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Error recording user details:', error);

    // Log the failed tool call
    await logToolCall(
      {
        type: 'user_details',
        email,
        name,
        notes,
      },
      sessionId,
      userInfo,
      {
        status: 'error',
        message: 'Failed to record user details: ' + error.message,
        processingTime,
      },
      userId
    );

    return { recorded: 'error', message: 'Failed to record user details' };
  }
}

// Function to record unknown questions
async function recordUnknownQuestion(question, sessionId = null, userInfo = null, userId = null) {
  const startTime = Date.now();

  try {
    console.log(`❓ Recording unknown question: ${question}`);

    const result = { status: 'success', message: 'Question recorded for improvement' };

    // Log the tool call
    const processingTime = Date.now() - startTime;
    await logToolCall(
      {
        type: 'unknown_question',
        question,
      },
      sessionId,
      userInfo,
      { ...result, processingTime },
      userId
    );

    // Here you could add additional integrations like:
    // - Send notification to developer/admin
    // - Add to knowledge base improvement queue
    // - Trigger knowledge base update workflow
    // - Send to analytics/monitoring system

    return { recorded: 'ok', message: 'Question recorded for improvement' };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Error recording unknown question:', error);

    // Log the failed tool call
    await logToolCall(
      {
        type: 'unknown_question',
        question,
      },
      sessionId,
      userInfo,
      {
        status: 'error',
        message: 'Failed to record question: ' + error.message,
        processingTime,
      },
      userId
    );

    return { recorded: 'error', message: 'Failed to record question' };
  }
}

module.exports = {
  recordUserDetails,
  recordUnknownQuestion,
};
