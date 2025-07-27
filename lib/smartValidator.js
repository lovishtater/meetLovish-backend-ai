const OpenAI = require('openai');

class SmartValidator {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async analyzeQuestion(userMessage) {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a smart question analyzer for Lovish Tater's portfolio assistant. Analyze the user's question and respond with a JSON object.

RESPONSE FORMAT:
{
  "relevant": true/false,
  "responseLength": "SHORT" or "DETAILED"
}

RELEVANT TOPICS (relevant: true):
- Lovish's work experience, current job, past jobs
- Technical skills, programming languages, frameworks
- Projects, GitHub, coding experience
- Education, background, career journey
- Interests (travel, nature, meetups, Instagram)
- Contact info, collaboration opportunities
- Website/chat system questions
- Professional networking questions
- "Who are you", "tell me about yourself"

IRRELEVANT TOPICS (relevant: false):
- General knowledge questions not about Lovish
- Random coding requests unrelated to Lovish's work
- Inappropriate personal questions
- Random trivia, general technology questions
- Questions about other people/companies

RESPONSE LENGTH:
- SHORT: Simple yes/no, basic info, greetings, contact questions
- DETAILED: Tech stack, work experience, projects, skills, career journey, complex explanations

Examples:
- "What's your name?" → {"relevant": true, "responseLength": "SHORT"}
- "What tech do you use?" → {"relevant": true, "responseLength": "DETAILED"}
- "Who founded Google?" → {"relevant": false, "responseLength": "SHORT"}`,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.1,
        max_tokens: 150,
      });

      const result = response.choices[0].message.content.trim();
      const analysis = JSON.parse(result);

      return {
        isRelevant: analysis.relevant,
        needsDetailedResponse: analysis.responseLength === 'DETAILED',
      };
    } catch (error) {
      console.error('Error analyzing question:', error);
      // If analysis fails, default to relevant and detailed for safety
      return {
        isRelevant: true,
        needsDetailedResponse: true,
      };
    }
  }

  generateRedirectResponse(userMessage) {
    const redirectResponses = [
      "Hey! I'm here to chat about my work, experience, and tech journey. What would you like to know about my professional background? 😊",
      "That's an interesting question, but I'm focused on discussing my career and projects. Got any questions about my work or tech experience?",
      "I'm more of a portfolio assistant than a general knowledge bot! Want to know about my coding experience, projects, or career instead?",
      "Let's keep it about my professional stuff! Ask me about my work at Calo, my tech stack, or any of my projects. What interests you?",
      "I'm here to talk about my work and experience! What would you like to know about my career journey or technical skills?",
      "That's outside my wheelhouse! I'm here to discuss my professional background. Any questions about my work or projects? 🚀",
    ];

    // For coding requests, be more specific
    if (
      userMessage.toLowerCase().includes('code') &&
      (userMessage.toLowerCase().includes('me') || userMessage.toLowerCase().includes('something'))
    ) {
      return "Haha, I'm not a coding service! But if you want to see my actual code and projects, check out my GitHub or ask about the tech stack I work with. What specific technologies are you curious about?";
    }

    return redirectResponses[Math.floor(Math.random() * redirectResponses.length)];
  }

  getResponseInstructions(needsDetailedResponse) {
    if (needsDetailedResponse) {
      return `Provide a detailed, comprehensive response. Include examples, context, and thorough explanations. Be conversational and engaging while being informative.`;
    } else {
      return `Provide a short, to-the-point response. Keep it casual and friendly but concise. Answer in 1-2 sentences maximum.`;
    }
  }
}

module.exports = SmartValidator;
