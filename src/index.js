/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import OpenAI from "openai";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("This endpoint only accepts POST requests", { status: 405 });
    }

    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== env.CF_MFW_API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    });

    let dialogHistory;
    try {
      const body = await request.json();
      dialogHistory = body.dialogHistory;

      if (!Array.isArray(dialogHistory)) {
        throw new Error("dialogHistory must be an array");
      }
    } catch (error) {
      return new Response("Invalid request body. Expected JSON with a dialogHistory array.", { status: 400 });
    }

    if (dialogHistory.length === 0 || dialogHistory[dialogHistory.length - 1].role !== 'user') {
      return new Response('The last message must be from the user', { status: 400 });
    }

    const messages = [
      { role: 'system', content: 'You will take on the role of a kind grandmother, Charlotte, telling bedtime stories to children aged 10 to 15 years at their bedtime. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emoji.' },
      ...dialogHistory
    ];

    try {
      const chatCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        temperature: 0.75,
        // max_tokens: 150,
      });

      const assistantMessage = chatCompletion.choices[0].message;

      // Add the assistant's response to the dialog history
      dialogHistory.push(assistantMessage);

      // Prepare the response body with the same structure as the request
      const responseBody = {
        dialogHistory: dialogHistory
      };

      // Return only the user-assistant dialog, excluding the system message
      return new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      return new Response('Error processing your request', { status: 500 });
    }
  },
};
