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
import {
  handleVisualChat,
  handleTextualChat,
  handleTranscription,
  handleBedTimeStoryChatStream,
  handleBedTimeStoryChat
} from './handlers/chatHandlers.js';
import { handleUserRegistration } from './handlers/userHanders.js';

export default {
  async fetch(request, env, ctx) {
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== env.CF_MFW_API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    });

    const elevenlabs_sk = env.ELEVEN_API_KEY;
    const url = new URL(request.url);
    const path = url.pathname;

    const handlers = {
      "/transcribe": (req) => handleTranscription(req, openai),
      "/textual-chat": (req) => handleTextualChat(req, openai),
      "/visual-chat": (req) => handleVisualChat(req, openai),
      "/story": (req) => handleBedTimeStoryChat(req, openai, elevenlabs_sk),
      "/story/v0806": (req) => handleBedTimeStoryChatStream(req, openai),
      "/users": (req) => handleUserRegistration(req, env),
    };

    const handler = handlers[path]
    if (handler) {
      return handler(request);
    } else {
      console.warn(`No handler found for path: ${path}`);
      return new Response("Not Found", { status: 404 });    
    }
  },
};
