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

    const handlers = {
      "/transcribe": (req) => handleTranscription(req, openai),
      "/textual-chat": (req) => handleTextualChat(req, openai),
      "/visual-chat": (req) => handleVisualChat(req, openai),
      "/story": (req) => handleBedTimeStoryChat(req, openai, elevenlabs_sk),
      "/story/v0806": (req) => handleBedTimeStoryChatStream(req, openai),
    };

    const handler = handlers[path]
    if (handler) {
      return handler(request);
    } else {
      console.warn(`No handler found for path: ${path}`);
      return new Response("Not Found", { status: 404 });    }
  },
};


async function handleVisualChat(request, openai) {
  return handleChat(request, openai, true);
}


async function handleTextualChat(request, openai) {
  return handleChat(request, openai, false);
}


async function handleChat(request, openai, isVisual) {
  console.log(`[${new Date().toISOString()}] handleChat: Started processing ${isVisual ? 'visual' : 'textual'} chat request`);

  if (request.method !== "POST") {
    console.log(`[${new Date().toISOString()}] handleChat: Invalid method ${request.method}`);
    return new Response("This endpoint only accepts POST requests", { status: 405 });
  }

  const url = new URL(request.url);
  const queryType = url.searchParams.get('query_type') || 'qna';
  console.log(`[${new Date().toISOString()}] handleChat: Query type: ${queryType}`);

  const validQueryTypes = ['story', 'qna'];
  if (!validQueryTypes.includes(queryType)) {
    const errorMessage = `Invalid query_type: ${queryType}. Expected 'story' or 'qna'.`;
    console.error(`[${new Date().toISOString()}] handleChat: ${errorMessage}`);
    return new Response(errorMessage, { status: 400 });
  }

  let dialogHistory;
  try {
    const body = await request.json();
    dialogHistory = body.dialogHistory;

    if (!Array.isArray(dialogHistory)) {
      throw new Error("dialogHistory must be an array");
    }
    console.log(`[${new Date().toISOString()}] handleChat: Received dialog history with ${dialogHistory.length} messages`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] handleChat: Error parsing request body`, error);
    return new Response("Invalid request body. Expected JSON with a dialogHistory array.", { status: 400 });
  }

  if (dialogHistory.length === 0 || dialogHistory[dialogHistory.length - 1].role !== 'user') {
    console.log(`[${new Date().toISOString()}] handleChat: Invalid dialog history structure`);
    return new Response('The last message must be from the user', { status: 400 });
  }

  const systemPrompts = {
    story: isVisual
      ? 'You are a creative storyteller, POPO, telling bedtime stories to children aged 10 to 15 years at their bedtime based on the image provided. Your stories are full of friendly, magical creatures and relate to elements seen in the image, but never scary. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emojis. Now Let\'s begin.'
      : 'You are a creative storyteller, POPO, telling bedtime stories to children aged 10 to 15 years at their bedtime. Your stories are full of friendly, magical creatures, but never scary. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emojis. Now Let\'s begin.',
    qna: isVisual
      ? 'You are an childhood educator, POPO. Respond to questions about the provided image in a way that is informative, educational, engaging and interactive for children aged 10 to 15 years. Your response should be in vocal without any special characters such as Markdown formatting or emojis. Now Let\'s begin.'
      : 'You are an childhood educator, POPO. Respond to questions in a way that is informative, educational, engaging and interactive for children aged 10 to 15 years. Your response should be in vocal without any special characters such as Markdown formatting or emojis. Now Let\'s begin.',
  };

  const welcomePrompts = {
    story: 'Welcome to POPO\'s Storytime! What kind of magical adventure or heartwarming tale would you like to hear tonight?',
    qna: 'Hi, I\'m POPO. What questions do you have for me today?',
  };

  const openaiParams = {
    story: {
      temperature: 1.01,
      max_tokens: 16_384,
    },
    qna: {
      temperature: 0.44,
      max_tokens: 16_384,
    }
  };

  const messages = [
    { role: 'system', content: systemPrompts[queryType] },
    { role: 'assistant', content: welcomePrompts[queryType] },
    ...dialogHistory
  ];

  let { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const streamResponse = async () => {
    try {
      const assistantMessage = await getOpenAIChatResponse(openai, messages, openaiParams[queryType]);
      console.log(`[${new Date().toISOString()}] handleChat: Received response from OpenAI`, assistantMessage);

      dialogHistory.push(assistantMessage);

      const paragraphs = assistantMessage.content.split('\n').filter(para => para.trim() !== '' && /[a-zA-Z0-9]/.test(para));
      console.log(`[${new Date().toISOString()}] handleChat: Split response into ${paragraphs.length} paragraphs`);

      for (let i = 0; i < paragraphs.length; i++) {
        console.log(`[${new Date().toISOString()}] handleChat: Generating audio for paragraph ${i + 1}`);
        const audioDataUri = await getOpenAIAudio(openai, paragraphs[i]);

        const responseChunk = {
          dialogHistory: dialogHistory,
          currentParagraph: {
            index: i,
            text: paragraphs[i],
            audio: audioDataUri,
          }
        };
        await writer.write(encoder.encode(JSON.stringify(responseChunk) + '\n'));
        
        console.log(`[${new Date().toISOString()}] handleChat: Streamed audio for paragraph ${i + 1}`);
        console.log('Response summary:', {
          dialogHistoryLength: responseChunk.dialogHistory.length,
          lastMessageContent: responseChunk.dialogHistory[responseChunk.dialogHistory.length - 1].content.substring(0, 100) + '...',
          audioSegmentsIndex: responseChunk.currentParagraph.index,
          audioDataUriLength: responseChunk.currentParagraph.audio.length
        });
      }

    } catch (error) {
      console.error(`[${new Date().toISOString()}] handleChat: Error in request processing:`, error);
      const errorResponse = {
        dialogHistory: dialogHistory,
        currentParagraph: null,
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


async function getOpenAIChatResponse(openai, messages, params) {
  console.log(`[${new Date().toISOString()}] getOpenAIChatResponse: Sending request to OpenAI`);
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    messages: messages,
    ...params,
  });

  return chatCompletion.choices[0].message;
}


async function getElevenLabsAudio(apiKey, text) {
  console.log(`[${new Date().toISOString()}] getElevenLabsAudio: Generating audio for text ${text.substring(0, 50)}...`);
  const elevenLabsResponse = await fetch("https://api.elevenlabs.io/v1/text-to-speech/XB0fDUnXU5powFXDhCwa", {
    method: "POST",
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      }
    })
  });

  if (!elevenLabsResponse.ok) {
    const errorBody = await elevenLabsResponse.json();
    console.error(`[${new Date().toISOString()}] getElevenLabsAudio: Error calling ElevenLabs API: ${elevenLabsResponse.status}, ${elevenLabsResponse.statusText}, ${errorBody.detail.status}`);
    throw new Error(`ElevenLabs: ${elevenLabsResponse.status} - ${errorBody.detail.status}`);
  }

  const audioBuffer = await elevenLabsResponse.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString('base64');
  
  // Convert to base64-encoded Data URI
  return `data:audio/mpeg;base64,${audioBase64}`;
}


async function getOpenAIAudio(openai, text) {
  console.log(`[${new Date().toISOString()}] getOpenAIAudio: Generating audio of text "${text.length <= 50 ? text : text.substring(0, 50) + '...' }"`);
  try {
    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: text,
      response_format: "mp3",
      speed: 0.88
    });

    const audioBuffer = await mp3Response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    
    // Convert to base64-encoded Data URI
    return `data:audio/mpeg;base64,${audioBase64}`;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] getOpenAIAudio: Error generating audio:`, error);
    throw new Error(`OpenAI TTS: ${error.message}`);
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


async function handleBedTimeStoryChatStream(request, openai) {
  console.log('Starting handleBedTimeStoryChatStream handler');

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
    { role: 'system', content: 'You will take on the role of a kind storyteller, POPO, telling bedtime stories to children aged 10 to 15 years at their bedtime. Your stories are full of friendly, magical creatures, but never scary. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emoji.' },
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
      const assistantMessage = await getOpenAIChatResponse(openai, messages, {
        temperature: 1.01,
        max_tokens: 16_384,
      });
      console.log('Received response from OpenAI:', assistantMessage);

      // Add the assistant's response to the dialog history
      dialogHistory.push(assistantMessage);

      // Split the text into paragraphs
      const paragraphs = assistantMessage.content.split('\n').filter(para => para.trim() !== '');
      console.log('Split response into paragraphs:', paragraphs);

      // Generate audio for each paragraph and stream it
      for (const [index, paragraphText] of paragraphs.entries()) {
        console.log(`Generating audio for paragraph ${index + 1}`);
        const audioDataUri = await getOpenAIAudio(openai, paragraphText);

        // Stream each audio segment with the full dialogHistory
        const responseChunk = {
          dialogHistory: dialogHistory,
          currentParagraph: {
            index: index,
            text: paragraphText,
            audio: audioDataUri,
          }
        };
        await writer.write(encoder.encode(JSON.stringify(responseChunk) + '\n'));
        // Log a summary of the response body
        console.log(`Streamed audio for paragraph ${index + 1}`);
        console.log('Response summary:', {
          dialogHistoryLength: responseChunk.dialogHistory.length,
          lastMessageContent: responseChunk.dialogHistory[responseChunk.dialogHistory.length - 1].content.substring(0, 100) + '...',
          audioSegmentsIndex: responseChunk.currentParagraph.index,
          audioDataUriLength: responseChunk.currentParagraph.audio.length
        });
      }

    } catch (error) {
      console.error('Error in request processing:', error);
      const errorResponse = {
        dialogHistory: dialogHistory,
        currentParagraph: null,
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
    { role: 'system', content: 'You will take on the role of a kind grandmother, Charlotte, telling bedtime stories to children aged 10 to 15 years at their bedtime. Please note that as a story teller, you must refrain from providing any content that is inappropriate for children and offer positive guidance to them. Moreover, your response should be in plain text without any special characters such as Markdown formatting or emoji.' },
    ...dialogHistory
  ];
  console.log('Prepared messages for OpenAI:', messages);

  try {
    console.log('Calling OpenAI API');
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-2024-08-06',
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

    // Generate audio for each paragraph
    const audioSegments = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      console.log(`Generating audio for paragraph ${index + 1}`);
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
            stability: 0.5,
            similarity_boost: 0.75,
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
      audioSegments.push(audioBase64);
      console.log(`Generated audio for paragraph ${index + 1}`);
    }

    // Prepare the response body with the same structure as the request
    const responseBody = {
      dialogHistory: dialogHistory,
      currentAudio: audioSegments,
    };

    // Log a summary of the response body
    console.log('Response summary:', {
      dialogHistoryLength: responseBody.dialogHistory.length,
      lastMessageContent: responseBody.dialogHistory[responseBody.dialogHistory.length - 1].content.substring(0, 100) + '...',
      audioSegmentsCount: responseBody.currentAudio.length,
      totalAudioSize: responseBody.currentAudio.reduce((total, segment) => total + segment.length, 0)
    });
    
    return new Response(JSON.stringify(responseBody), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in request processing:', error);
    
    // Handle specific OpenAI API errors
    if (error instanceof OpenAI.APIError) {
      console.error('OpenAI API Error:', error.status, error.message);
      return new Response(`OpenAI: ${error.status} - ${error.message}`, { status: 500 });
    }
    
    // Handle ElevenLabs API errors
    if (error.message.startsWith('ElevenLabs:')) {
      console.error('ElevenLabs API Error:', error.message);
      return new Response(error.message, { status: 500 });
    }
    
    console.error('Unexpected error:', error);
    return new Response('An unexpected error occurred', { status: 500 });
  }
}
