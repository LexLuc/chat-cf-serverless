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

    const elevenlabs_sk = env.ELEVEN_API_KEY;
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/transcribe") {
      return handleTranscription(request, openai);
    } else if (path === "/story") {
      return handleBedTimeStoryChat(request, openai, elevenlabs_sk);
    } else if (path === "/visual-qa") {
      return handleVisualQA(request, openai, elevenlabs_sk);
    } else {
      return new Response("Not Found", { status: 404 });
    }
  },
};

async function handleBedTimeStoryChat(request, openai, elevenlabs_sk) {
  console.log('Starting handleBedTimeStoryChat handler');

  if (request.method !== "POST") {
    console.log('Invalid request method:', request.method);
    return new Response("This endpoint only accepts POST requests", { status: 405 });
  }

  let dialogHistory;
  try {
    const body = await request.json();
    dialogHistory = body.dialogHistory;
    console.log('Received dialogHistory:', dialogHistory);

    if (!Array.isArray(dialogHistory)) {
      throw new Error("dialogHistory must be an array");
    }
  } catch (error) {
    console.error('Error parsing request body:', error);
    return new Response("Invalid request body. Expected JSON with a dialogHistory array.", { status: 400 });
  }

  if (dialogHistory.length === 0 || dialogHistory[dialogHistory.length - 1].role !== 'user') {
    console.log('Invalid dialogHistory: last message is not from user');
    return new Response('The last message must be from the user', { status: 400 });
  }

  const messages = [
    { role: 'system', content: 'You will take on the role of a kind storyteller, POPO, telling bedtime stories to children aged 10 to 15 years at their bedtime. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emoji.' },
    { role: 'assistant', content: 'Welcome to POPO\'s Storytime! What kind of magical adventure or heartwarming tale would you like to hear tonight?' },
    ...dialogHistory
  ];
  console.log('Prepared messages for OpenAI:', messages);

  let { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const streamResponse = async () => {
    try {
      console.log('Calling OpenAI API');
      const chatCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        temperature: 1.01,
        max_tokens: 60,
      });

      const assistantMessage = chatCompletion.choices[0].message;
      console.log('Received response from OpenAI:', assistantMessage);

      // Add the assistant's response to the dialog history
      dialogHistory.push(assistantMessage);

      // Split the text into paragraphs
      const paragraphs = assistantMessage.content.split('\n').filter(para => para.trim() !== '');
      console.log('Split response into paragraphs:', paragraphs);

      // Generate audio for each paragraph and stream it
      for (const [index, paragraphText] of paragraphs.entries()) {
        console.log(`Generating audio for paragraph ${index + 1}`);
        const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/text-to-speech/XB0fDUnXU5powFXDhCwa", {
          method: "POST",
          headers: {
            'xi-api-key': elevenlabs_sk,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: paragraphText,
            model_id: "eleven_turbo_v2_5",
            voice_settings: {
              stability: 0,
              similarity_boost: 1,
              style: 0,
              use_speaker_boost: true,
            }
          })
        });

        if (!elevenLabsResponse.ok) {
          const errorBody = await elevenLabsResponse.json();
          console.error(`Error calling ElevenLabs API for paragraph ${index + 1}:`, elevenLabsResponse.status, elevenLabsResponse.statusText, errorBody.detail.status);
          throw new Error(`ElevenLabs: ${elevenLabsResponse.status} - ${errorBody.detail.status}`);
        }

        const audioBuffer = await elevenLabsResponse.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        
        // Stream each audio segment with the full dialogHistory
        const responseChunk = {
          dialogHistory: dialogHistory,
          currentParagraph: [{
            index: index,
            text: paragraphText,
            audio: audioBase64,
          }]
        };
        await writer.write(encoder.encode(JSON.stringify(responseChunk) + '\n'));
        // Log a summary of the response body
        console.log(`Streamed audio for paragraph ${index + 1}`);
        console.log('Response summary:', {
          dialogHistoryLength: responseChunk.dialogHistory.length,
          lastMessageContent: responseChunk.dialogHistory[responseChunk.dialogHistory.length - 1].content.substring(0, 100) + '...',
          audioSegmentsIndex: responseChunk.currentParagraph[0].index,
          totalAudioSize: responseChunk.currentParagraph.reduce((total, segment) => total + segment.length, 0)
        });
      }

    } catch (error) {
      console.error('Error in request processing:', error);
      const errorResponse = {
        dialogHistory: dialogHistory,
        currentParagraph: [],
        error: error.message
      };
      await writer.write(encoder.encode(JSON.stringify(errorResponse) + '\n'));
    } finally {
      await writer.close();
    }
  };

  // Start the streaming process
  streamResponse();

  // Return the readable stream
  return new Response(readable, {
    headers: { 'Content-Type': 'application/json' }
  });
}


async function handleVisualQA(request, openai, elevenlabs_sk) {
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
    { role: 'system', content: 'You will act as a a early childhood educator, verbally responding to questions from of a curious child regarding the provided image in one sentence. Now let\'s begin.' },
    ...dialogHistory
  ];

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      temperature: 0.88,
      max_tokens: 50,
    });

    const assistantMessage = chatCompletion.choices[0].message;

    // Add the assistant's response to the dialog history
    dialogHistory.push(assistantMessage);

    // Split the text into paragraphs
    const paragraphs = assistantMessage.content.split('\n').filter(para => para.trim() !== '');

    // Generate audio for each paragraph
    const audioSegments = [];
    for (const paragraph of paragraphs) {
      const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/text-to-speech/XB0fDUnXU5powFXDhCwa", {
        method: "POST",
        headers: {
          'xi-api-key': elevenlabs_sk,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: paragraph,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0,
            similarity_boost: 1,
            style: 0,
            use_speaker_boost: true,
          }
        })
      });

      if (!elevenLabsResponse.ok) {
        const errorBody = await elevenLabsResponse.json();
        console.error(`Error calling ElevenLabs API: ${elevenLabsResponse.status}, ${elevenLabsResponse.statusText}, ${errorBody.detail.status}`);
        throw new Error(`ElevenLabs: ${elevenLabsResponse.status} - ${errorBody.detail.status}`);
      }

      const audioBuffer = await elevenLabsResponse.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');
      audioSegments.push(audioBase64);
    }

    // Prepare the response body with the same structure as the request
    const responseBody = {
      dialogHistory: dialogHistory,
      currentAudio: audioSegments,
    };

    // Return the response
    return new Response(JSON.stringify(responseBody), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in request processing:', error);
    
    // Handle specific OpenAI API errors
    if (error instanceof OpenAI.APIError) {
      return new Response(`OpenAI: ${error.status} - ${error.message}`, { status: 500 });
    }
    
    // Handle ElevenLabs API errors
    if (error.message.startsWith('ElevenLabs:')) {
      return new Response(error.message, { status: 500 });
    }
    
    // Handle other errors
    return new Response('An unexpected error occurred', { status: 500 });
  }
}


async function handleTranscription(request, openai) {
  if (request.method !== "POST") {
    return new Response("Please send a POST request with audio data", { status: 400 });
  }

  const contentType = request.headers.get('Content-Type');
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return new Response("Invalid Content-Type. Expected multipart/form-data", { status: 400 });
  }
  
  if (!contentType.includes('boundary=')) {
    return new Response("Invalid Content-Type. Missing boundary parameter", { status: 400 });
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
    // Handle specific OpenAI API errors
    if (error instanceof OpenAI.APIError) {
      return new Response(`OpenAI: ${error.status} - ${error.message}`, { status: error.status || 500 });
    }
    
    // Handle other errors
    return new Response('An unexpected error occurred', { status: 500 });
  }
}
