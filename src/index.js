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
  handleTranscription as handleTranscriptionVer0910,
  handleVisualChat as handleVisualChatVer0910,
  handleTextualChat as handleTextualChatVer0910,
  handleDialogHistoryTitle as handleConcludeTitleViaDialogHistory,
} from './handlers/chatHandlersVer0910.js'

import { 
  handleUserRegistration, 
  handleUserLogin,
  handlePasswordReset,
  handleUserInfoRetrieval,
  handleUserInfoUpdate,
} from './handlers/userHandlers.js';

import {
  handleEmailVerification,
} from './handlers/emailHandlers.js'

import {
  handleMobileAppGetLatestAPK,
} from './handlers/mobileHandlers.js'

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
      "/transcribe": (req) => handleTranscriptionVer0910(req, openai),
      "/textual-chat/v0910": (req) => handleTextualChatVer0910(req, env, openai),
      "/visual-chat/v0910": (req) => handleVisualChatVer0910(req, env, openai),

      "/auth/register/verify": (req) => handleEmailVerification(req, env),
      "/auth/register": (req) => handleUserRegistration(req, env),
      "/auth/login": (req) => handleUserLogin(req, env),
      "/auth/reset-password/verify": (req) => handleEmailVerification(req, env),
      "/auth/reset-password": (req) => handlePasswordReset(req, env),
      "/users/me": (req) => handleUserInfoRetrieval(req, env),
      "/users/me/updated": (req) => handleUserInfoUpdate(req, env),

      "/apks/latest": (req) => handleMobileAppGetLatestAPK(req, env),
      "/chat/title": (req) => handleConcludeTitleViaDialogHistory(req, openai),
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
