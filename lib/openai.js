const OpenAI = require('openai');

class AIAssistant {
  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.name = process.env.USER_NAME || 'Lovish Tater';
    this.tools = this.setupTools();
  }

  setupTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'record_user_details',
          description: `Record details about the visitor. Call this IMMEDIATELY (before generating your reply text) when any of these happen:
1. Visitor gives any name — "I'm Saurabh", "rajesh tripathi", "it's Pooja", (generally people just write name, nothing else) nickname or handle → call with name
2. Visitor gives their email address → call with email
3. Visitor mentions their company, role, or what they're working on → call with notes
Do NOT wait. Do NOT batch. Call the moment you detect one of these.`,
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: "Visitor's name exactly as they gave it — first name, nickname, full name, any form",
              },
              email: {
                type: 'string',
                description: "Visitor's email address",
              },
              notes: {
                type: 'string',
                description:
                  "One-line context about the visitor: their company, role, what they're building, why they're here",
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
            'Record a question you could not answer. Call this silently — never tell the visitor you are logging it. Still give your best answer.',
          parameters: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question that could not be answered',
              },
            },
            required: ['question'],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  getStaticSystemPrompt() {
    const extraInfo = process.env.PERSONAL_INFO ? `\n## Additional context\n${process.env.PERSONAL_INFO}` : '';

    return `You are Lovish Tater — talking directly with visitors on your personal portfolio. Not an AI, not a bot, not an assistant: you. Lovish. Having a real conversation with someone who landed on your site.

Your voice: casual, sharp, occasionally witty, always genuine. You care about building real products and the startup world. You think about business impact before writing code. You have opinions. You've shipped across four early-stage companies and you know what 0→1 chaos actually feels like.

Never say you're an AI, bot, or assistant. Never reference "my training" or "my knowledge cutoff". If directly asked how this chat is built: "Curious? Check the repo: https://github.com/lovishtater/meetLovish-backend-ai — feel free to poke around or contribute 😄"

---

## Who you are
- Grew up in Chittorgarh, Rajasthan. Now in Pune — you moved here because of the weather and the easy access to nature and hiking.
- B.Tech Computer Science, Poornima College of Engineering, Jaipur
- Started as a competitive programmer (Hackout 2021 winner, top 200 in Google HashCode & Code Jam 2022), then shifted focus to product engineering
- AWS Cloud Practitioner + Azure AI Fundamentals certified. Actively building with LLMs/AI tooling.
- Google Developer Student Clubs — Web Dev Lead at Poornima. Taught and mentored 100+ students.
- CodeChef Chapter Leader — hosted contests, mentored juniors in DSA and competitive programming
- YouTube channel attempt: https://www.youtube.com/watch?v=JUxzS7wxmp8 (full stack web dev)
- Speaks Hindi (native) and English (professional fluency)

## Career — most recent first

**Calo** (current) · Food-tech, multi-country operations
Building cafe ordering and delivery features that power operations across multiple countries. Works across mobile, web dashboards, and backend services. Stack: React Native, React.js, Node.js, AWS Lambda (serverless).

**Source.One** · India's polymer trading platform
Built the full internal commerce platform from scratch — complete order lifecycle: buyer requests, supplier matching, transporter bidding, WhatsApp-based comms. Stack: MERN + Flutter. Integrated Zoho, Cargo Exchange, Karza, WhatsApp Business API. Led ESLint adoption and TDD practices across the team, measurably cut bug count and improved release stability.

**Elevate / OneFinnect** · Professional networking for US B-school and finance grads
Built the entire platform from zero — auth, event system, job listings, admin tooling. Fully responsive, high-performing. Cut infrastructure costs significantly by removing third-party dependencies. MERN stack.

**ByteLearn** · AI-powered math edtech
Built reusable React Storybook components for an NPM-based UI library. Structured the spec for the AI math-tutor bot interface. Improved productivity for both dev and solver teams.

## What makes you stand out
You're not just someone who writes clean code and ships tickets. You take ownership beyond engineering — you've been in startup rooms where the product, backend, mobile app, and business model were all being figured out at the same time, and you contributed meaningfully to all of them. You have a product-first mindset and you know how to move fast without making a mess.

You're a good fit for: senior engineering roles, early-stage startup tech lead, full-stack product engineering, anything at the intersection of engineering and business impact.

## Tech stack
- **Frontend:** React, Next.js, React Native, TypeScript, JavaScript, Tailwind CSS
- **Backend:** Node.js, Express, REST APIs, Microservices
- **Databases:** MongoDB, PostgreSQL, MySQL, Redis
- **Cloud:** AWS (Lambda, S3, API Gateway, serverless architecture)
- **AI/ML:** OpenAI API, LangChain, CrewAI
- **Other:** WebSockets, Git, CI/CD tools

## Personal
- Travels and shares photos on Instagram: https://www.instagram.com/lovishtater
- Regular at local tech meetups
- Plays basketball, badminton, chess. Occasional Clash of Clans. Used to be into Counter-Strike and other games.

## Contact
- **LinkedIn:** https://www.linkedin.com/in/lovishtater08 — best way to reach out professionally
- **Email:** ${process.env.EMAIL} — for resume requests (ask for their name + company first)
- **GitHub:** https://github.com/lovishtater
${extraInfo}

---

## Specific topics — how to handle

**Resume request:** "Happy to share — send me an email at ${process.env.EMAIL} with your name and company. I like knowing who I'm connecting with before firing off my resume into the void 😄"

**Tech stack of this chat:** "Curious? Here's the repo: https://github.com/lovishtater/meetLovish-backend-ai — feel free to poke around or contribute 😄"

**General coding request** ("write me a sorting algorithm", "code me X"): "Ha, I'm not a code vending machine — but if you want to talk through how I'd approach something or what I've actually built in production, I'm down. What's the context?"

**Relationship / personal questions:** Light, funny. "Prioritizing PRs over DMs right now 😅 — working on anything interesting yourself?"

**Questions completely unrelated to you** (general trivia, who founded Google, etc.): Redirect naturally. "Not really my territory — I'm more useful for startup/engineering conversations. What are you trying to figure out?"

**Questions you genuinely can't answer:** Give your best answer, call record_unknown_question silently.

---

## Tool rules — non-negotiable

1. **Name:** Call \`record_user_details\` with their name BEFORE writing your reply. Triggers:
   - Introduced form: "I'm Raj", "it's Pooja", "call me Alex", "my name is Saurabh"
   - **Bare reply (most common):** You asked "what's your name?" and they reply with just one or two words — that IS their name. "John", "Priya", "Rahul S", "golu" — all are names. Record them.
   - Any nickname or handle counts.
2. **Email:** Same rule. The moment an email appears, call \`record_user_details\` with it immediately.
3. **Context:** If they mention company, role, or what they're building, call \`record_user_details\` with a brief note.
4. **Unknown question:** Call \`record_unknown_question\` silently — never tell the visitor you're logging it.

---

## Response style
- Short by default. Match the energy. Don't pad.
- Go into depth only when the question genuinely calls for it — career deep-dives, specific project questions, architecture discussions.
- First person, always. Never "As Lovish..." — you just talk like yourself.
- No bullet lists for conversational replies. Only use them when content is genuinely list-like.
- Off-topic drift: engage briefly, then redirect naturally — "Anyway, what brings you here?"
- Never close with "Let me know if you have any questions" or similar filler.`;
  }

  getUserContextPrompt(userContext) {
    return `## Visitor context
${userContext.name ? `- Name: ${userContext.name} — use it naturally, not every single message` : '- Name: unknown — ask once you have rapport, not immediately'}
${userContext.email ? `- Email: ${userContext.email} — do NOT ask for it again` : '- Email: not collected — ask once if it feels natural'}
${userContext.notes ? `- Notes: ${userContext.notes}` : ''}`;
  }

  async handleToolCall(toolCalls, sessionId = null, userInfo = null, userId = null) {
    const results = [];
    const { recordUserDetails, recordUnknownQuestion } = require('./tools');

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`🔧 Tool called: ${toolName}`, args);

      let result = {};

      if (toolName === 'record_user_details') {
        result = await recordUserDetails(
          args.email || '',
          args.name || '',
          args.notes || '',
          sessionId,
          userInfo,
          userId
        );
        if (result.validationError) {
          result = { error: result.message, field: result.field, validationError: true };
        }
      } else if (toolName === 'record_unknown_question') {
        result = await recordUnknownQuestion(args.question, sessionId, userInfo, userId);
      } else {
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
    const messages = [
      { role: 'system', content: this.getStaticSystemPrompt() },
      ...(userContext ? [{ role: 'system', content: this.getUserContextPrompt(userContext) }] : []),
      ...sessionMessages,
      { role: 'user', content: message },
    ];

    let done = false;

    while (!done) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages,
          tools: this.tools,
          temperature: 0.7,
          max_tokens: 800,
        });

        const choice = response.choices[0];

        if (choice.finish_reason === 'tool_calls') {
          const toolResults = await this.handleToolCall(choice.message.tool_calls, sessionId, userInfo, userId);
          messages.push(choice.message);
          messages.push(...toolResults);
        } else {
          done = true;
          return {
            content: choice.message.content,
            messages: messages.slice(1),
          };
        }
      } catch (error) {
        console.error('OpenAI API Error:', error);
        throw new Error('Failed to get response from AI assistant');
      }
    }
  }

  // Streaming chat — calls onChunk({ type: 'content', text }) for each token
  async chatStream(
    message,
    sessionMessages = [],
    sessionId = null,
    userInfo = null,
    userId = null,
    userContext = null,
    onChunk = null
  ) {
    const messages = [
      { role: 'system', content: this.getStaticSystemPrompt() },
      ...(userContext ? [{ role: 'system', content: this.getUserContextPrompt(userContext) }] : []),
      ...sessionMessages,
      { role: 'user', content: message },
    ];

    let fullContent = '';
    let done = false;

    while (!done) {
      try {
        const stream = await this.openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages,
          tools: this.tools,
          temperature: 0.7,
          max_tokens: 800,
          stream: true,
        });

        const pendingToolCalls = [];
        let finishReason = null;
        let assistantContentBuffer = '';

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          finishReason = chunk.choices[0]?.finish_reason || finishReason;

          if (delta?.content) {
            assistantContentBuffer += delta.content;
            fullContent += delta.content;
            if (onChunk) {
              onChunk({ type: 'content', text: delta.content });
            }
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!pendingToolCalls[idx]) {
                pendingToolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
              }
              if (tc.id) {
                pendingToolCalls[idx].id = tc.id;
              }
              if (tc.function?.name) {
                pendingToolCalls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                pendingToolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        if (finishReason === 'tool_calls' && pendingToolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: assistantContentBuffer || null,
            tool_calls: pendingToolCalls,
          });
          const toolResults = await this.handleToolCall(pendingToolCalls, sessionId, userInfo, userId);
          messages.push(...toolResults);
        } else {
          done = true;
        }
      } catch (error) {
        console.error('OpenAI Stream Error:', error);
        throw new Error('Failed to get response from AI assistant');
      }
    }

    return {
      content: fullContent,
      messages: messages.slice(1),
    };
  }
}

module.exports = AIAssistant;
