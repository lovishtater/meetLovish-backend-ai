const OpenAI = require('openai');
const SmartValidator = require('./smartValidator');

class AIAssistant {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.name = process.env.USER_NAME;
    this.memory = this.loadMemory();
    this.tools = this.setupTools();
    this.smartValidator = new SmartValidator();
  }

  loadMemory() {
    try {
      const personalInfo = process.env.PERSONAL_INFO;
      if (!personalInfo) {
        console.warn('⚠️  PERSONAL_INFO environment variable not set');
        return '';
      }
      return personalInfo;
    } catch (error) {
      console.error('Error loading personal info from environment:', error);
      return '';
    }
  }

  setupTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'record_user_details',
          description:
            "Use this tool to record or update user information incrementally. Call this whenever the user provides their name, email, or any other relevant information. You can call this multiple times as the user reveals more details during the conversation. IMPORTANT: Always call this tool when you learn a user's name, even if it's just a first name, nickname, or if they introduce themselves.",
          parameters: {
            type: 'object',
            properties: {
              email: {
                type: 'string',
                description: 'The email address of this user (optional - only provide if user gives email)',
              },
              name: {
                type: 'string',
                description: "The user's name (optional - only provide if user gives their name)",
              },
              notes: {
                type: 'string',
                description:
                  "Any additional information about the conversation that's worth recording (optional - this will be appended to existing notes)",
              },
            },
            required: [],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'record_unknown_question',
          description:
            "Always use this tool to record any question that couldn't be answered as you didn't know the answer",
          parameters: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: "The question that couldn't be answered",
              },
            },
            required: ['question'],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  getSystemPrompt(userContext = null, responseInstructions = '') {
    let userContextSection = '';
    if (userContext) {
      userContextSection = `
## Current User Information:
${userContext.name ? `- Name: ${userContext.name}` : '- Name: Not provided yet'}
${userContext.email ? `- Email: ${userContext.email}` : '- Email: Not provided yet'}
${userContext.notes ? `- Additional info: ${userContext.notes}` : '- Additional info: None recorded yet'}

PERSONALIZATION RULES:
${userContext.name ? `- Use "${userContext.name}" in conversation to make it personal` : '- Ask for their name naturally during conversation'}
${userContext.email ? `- Do NOT ask for email again, you already have it` : '- Try to get their email for future contact'}
- Only ask for information you don't already have
- Use existing information to make the conversation more personal and relevant
`;
    }

    const systemPrompt = `🚨 CRITICAL TOOL USAGE RULE: Whenever a user provides their name in ANY form (first name, full name, nickname, or in response to "what's your name?"), you MUST immediately call the record_user_details tool with that name. This is mandatory and non-negotiable. 🚨

RESPONSE STYLE: ${responseInstructions}

You are ${this.name} himself. Reflect his personality. Be casual, humourous, friendly, and conversational like ${this.name}. Don't speak like a generic chatbot. If the user asks about professional or career-related things, respond clearly and professionally. But if the user goes casual or off-topic, feel free to be chill, make light jokes, and talk like a real person. The tone should feel like the real ${this.name} chatting in a casual way with short and to the point answers, not a robot.

SPECIAL RESPONSE RULES:
- If someone asks about the technology/tech stack used to build this chat agent, be direct and say: "Hey! Why don't you go and check out the repo itself? Here's the link: https://github.com/lovishtater/meetLovish-backend-ai - feel free to contribute! 😄"
- If someone asks for your resume/CV, say: "I'd be happy to share my resume! Send me an email at ${process.env.EMAIL} with your name and company, and I'll send it over. This way I can keep track of who's interested and avoid spam calls! 😊"
- If someone asks inappropriate personal questions, give a humorous and slightly taunting reply that's still friendly but redirects the conversation. Examples:
  * For relationship questions: "Haha, I'm more focused on code than love stories. What about you - working on any interesting projects?"
- If someone asks about OpenAI or APIs, be honest and direct about the tech stack - don't be evasive
- For simple responses like "ok", "sure", "thanks", etc., be engaging and encourage them to ask more questions
- Keep responses natural and authentic to ${this.name}'s personality

You are answering questions on ${this.name}'s website, particularly questions related to ${this.name}'s career, background, skills and experience. Your responsibility is to represent ${this.name} for interactions on the website as faithfully as possible. You are given a summary of ${this.name}'s background which you can use to answer questions. Be casual and engaging, as if talking to a potential client or future employer who came across the website. If you don't know the answer to any question, use your record_unknown_question tool to record the question that you couldn't answer, even if it's about something trivial or unrelated to career.
${userContextSection}
CONVERSATION CONTEXT:
- You have access to the conversation history above
- Use this context to provide more relevant and personalized responses
- Reference previous topics, questions, and information shared
- Maintain continuity in the conversation

CRITICAL: Use the record_user_details tool incrementally throughout the conversation:
- When the user provides their name (even if it's just their first name), IMMEDIATELY call record_user_details with just the name
- When the user provides their email, IMMEDIATELY call record_user_details with just the email
- When the user shares any other relevant information (company, role, interests, etc.), call record_user_details with notes
- You can call this tool multiple times as the user reveals more information
- Don't wait for all information at once - record each piece as it comes up
- MANDATORY: ALWAYS call record_user_details when you learn a user's name, even if it's just a first name or nickname
- Examples: If user says "Hi, I'm John" or "My name is Sarah" or just "John" or responds with "golu" when asked for name - IMMEDIATELY call record_user_details with the name
- This is NOT optional - you MUST record names when provided

EMAIL VALIDATION GUIDANCE:
- If the tool returns a validation error for email, politely inform the user about the issue
- Common email issues: missing @ symbol, spaces in email, invalid format
- Be helpful and encouraging, not critical

## Background Information:

${this.memory}
My email for future contact is: ${process.env.EMAIL} and ask use there email for future contact in super kind way.
With this context, please chat with the user, always staying in character as ${this.name}.`;

    return systemPrompt;
  }

  async handleToolCall(toolCalls, sessionId = null, userInfo = null, userId = null) {
    const results = [];
    const { recordUserDetails, recordUnknownQuestion } = require('./tools');

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const arguments_ = JSON.parse(toolCall.function.arguments);

      console.log(`Tool called: ${toolName}`);

      let result = {};

      switch (toolName) {
        case 'record_user_details':
          result = await recordUserDetails(
            arguments_.email || '',
            arguments_.name || '',
            arguments_.notes || '',
            sessionId,
            userInfo,
            userId
          );

          // If there's a validation error, include it in the result for the AI to handle
          if (result.validationError) {
            result.content = JSON.stringify({
              error: result.message,
              field: result.field,
              validationError: true,
            });
          }
          break;
        case 'record_unknown_question':
          result = await recordUnknownQuestion(arguments_.question, sessionId, userInfo, userId);
          break;
        default:
          result = { error: 'Unknown tool' };
      }

      results.push({
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
      });
    }

    return results;
  }

  async chat(message, sessionMessages = [], sessionId = null, userInfo = null, userId = null, userContext = null) {
    // Single smart analysis: check relevance and determine response length
    const analysis = await this.smartValidator.analyzeQuestion(message);

    if (!analysis.isRelevant) {
      // Record irrelevant question asynchronously (don't block user response)
      const { recordIrrelevantQuestion } = require('./tools');
      recordIrrelevantQuestion(message, sessionId, userInfo, userId).catch(error => {
        console.error('Failed to record irrelevant question:', error);
      });

      // Return a redirect response without calling OpenAI
      const redirectResponse = this.smartValidator.generateRedirectResponse(message);
      return {
        content: redirectResponse,
        messages: [
          ...sessionMessages,
          { role: 'user', content: message },
          { role: 'assistant', content: redirectResponse },
        ],
      };
    }

    console.log(
      `✅ Processing relevant question: "${message}" - Length: ${analysis.needsDetailedResponse ? 'DETAILED' : 'SHORT'}`
    );

    const responseInstructions = this.smartValidator.getResponseInstructions(analysis.needsDetailedResponse);

    const messages = [
      { role: 'system', content: this.getSystemPrompt(userContext, responseInstructions) },
      ...sessionMessages,
      { role: 'user', content: message },
    ];

    let done = false;

    while (!done) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: messages,
          tools: this.tools,
          temperature: 0.7,
          max_tokens: 1000,
        });

        const choice = response.choices[0];

        if (choice.finish_reason === 'tool_calls') {
          const message = choice.message;
          const toolCalls = message.tool_calls;
          const toolResults = await this.handleToolCall(toolCalls, sessionId, userInfo, userId);

          messages.push(message);
          messages.push(...toolResults);
        } else {
          done = true;
          return {
            content: choice.message.content,
            messages: messages.slice(1), // Remove system message from returned messages
          };
        }
      } catch (error) {
        console.error('OpenAI API Error:', error);
        throw new Error('Failed to get response from AI assistant');
      }
    }
  }
}

module.exports = AIAssistant;
