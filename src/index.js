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
import { Buffer } from 'node:buffer';

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

    const elevenlabs_sk = env.ELEVEN_API_KEY
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/transcribe") {
      return handleTranscription(request, openai);
    } else if (path === "/story") {
      return handleBedTimeStoryChat(request, openai, elevenlabs_sk);
    } else {
      return new Response("Not Found", { status: 404 });
    }
  },
};

async function handleBedTimeStoryChat(request, openai, elevenlabs_sk) {
  if (request.method !== "POST") {
    return new Response("This endpoint only accepts POST requests", { status: 405 });
  }

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
      temperature: 1.01,
      max_tokens: 10,
    });

    const assistantMessage = chatCompletion.choices[0].message;

    // Add the assistant's response to the dialog history
    dialogHistory.push(assistantMessage);

    // Generate audio from ElevenLabs TODO: streaming by paragraph
    const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/text-to-speech/XB0fDUnXU5powFXDhCwa", {
      method: "POST",
      headers: {
        'xi-api-key': elevenlabs_sk,
        'Content-Type': 'application/json'
      },
      body: `{"text":"${assistantMessage.content}","model_id":"eleven_turbo_v2_5","voice_settings":{"stability":0,"similarity_boost":1}}`
    });
    if (!elevenLabsResponse.ok) {
      console.error(`Error calling 11labs, ${elevenLabsResponse.status}, ${elevenLabsResponse.statusText}, ${elevenLabsResponse.responseBody}`)
      throw new Error('Failed to generate audio');
    }
    const audioBuffer = await elevenLabsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');

    // Prepare the response body with the same structure as the request
    const responseBody = {
      dialogHistory: dialogHistory,
      currentAudio: audioBase64,
    };

    // Return only the user-assistant dialog, excluding the system message
    return new Response(JSON.stringify(responseBody), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error calling API:', error);
    return new Response('Error processing your request', { status: 500 });
  }
}


async function handleTranscription(request, openai) {
  if (request.method !== "POST") {
    return new Response("Please send a POST request with audio data", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");

    if (!audioFile) {
      return new Response("No audio file found in the request", { status: 400 });
    }
    console.log('Received audio file:', audioFile.name, audioFile.type, audioFile.size);
    
    // Check file size (25MB = 25 * 1024 * 1024 bytes)
    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    if (audioFile.size > MAX_FILE_SIZE) {
      return new Response("File size exceeds the limit", { status: 400 });
    }
    
    // Convert the File to a Blob
    const arrayBuffer = await audioFile.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: audioFile.type });

    // Create a new File object from the Blob
    const file = new File([blob], audioFile.name, { type: audioFile.type });

    console.log('Created File object:', file.name, file.type, file.size);

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
    });

    console.log('Received transcription:', transcription.text);

    return new Response(JSON.stringify({ text: transcription.text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    if (error.response) {
      console.error("OpenAI API response:", await error.response.text());
    }
    return new Response('Error processing your request', { status: 500 });
  }
}
