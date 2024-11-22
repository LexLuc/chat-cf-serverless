/**
 * Chat Handlers with auth
 */

import OpenAI from "openai";
import { Buffer } from 'node:buffer';
import { withAuth } from "../middleware/authMiddleware";
import { getUserByEmail } from "../models/userModel";

const OPENAI_TTS_TEXT_LENGTH_MAX = 4096;

const THEMES = {
  ADVENTURE: {
    keywords: ['adventure', 'explore', 'quest', 'journey', 'discover', 'mission', 'expedition', 'treasure', 'map'],
    storyPrompt: 'Create an exciting adventure with thrilling discoveries and challenges that can be overcome through wit, courage, and determination. Keep the excitement high while ensuring all challenges and resolutions are age-appropriate.',
    qnaPrompt: 'Address questions about exploration, discovery, and adventure with enthusiasm, while emphasizing safety, preparation, and responsible decision-making.'
  },
  FAMILY: {
    keywords: ['family', 'parents', 'siblings', 'home', 'relatives'],
    storyPrompt: 'Focus on warm family relationships, understanding between generations, and the value of family bonds.',
    qnaPrompt: 'Address family-related questions with sensitivity, emphasizing positive family dynamics and healthy relationships.'
  },
  FRIENDSHIP: {
    keywords: ['friends', 'friendship', 'teamwork', 'loyalty'],
    storyPrompt: 'Emphasize the power of friendship, loyalty, and working together to overcome challenges.',
    qnaPrompt: 'Focus on developing and maintaining healthy friendships, resolving conflicts, and being a good friend.'
  },
  MAGIC: {
    keywords: ['magic', 'wizard', 'witch', 'spell', 'magical', 'enchanted'],
    storyPrompt: 'Weave magical elements naturally into the story while maintaining believability and wonder.',
    qnaPrompt: 'Discuss magical concepts in relation to imagination, creativity, and wonder, while distinguishing fantasy from reality.'
  },
  SCIFI: {
    keywords: ['space', 'future', 'robot', 'technology', 'science'],
    storyPrompt: 'Incorporate age-appropriate science fiction concepts that spark curiosity about science and technology.',
    qnaPrompt: 'Explain scientific and technological concepts in an engaging, age-appropriate way while encouraging curiosity.'
  },
  COMEDY: {
    keywords: ['funny', 'humor', 'laugh', 'joke', 'silly'],
    storyPrompt: 'Include light humor and fun situations while avoiding sarcasm or mean-spirited jokes.',
    qnaPrompt: 'Address questions with a touch of humor when appropriate, while maintaining educational value.'
  },
  GROWTH: {
    keywords: ['learn', 'grow', 'change', 'understand', 'realize'],
    storyPrompt: 'Focus on personal growth, self-discovery, and overcoming internal challenges.',
    qnaPrompt: 'Guide learning and personal development with encouraging, constructive responses.'
  }
};

function detectThemes(userMessage) {
  let messageText = '';
  if (typeof userMessage === 'string') {
    messageText = userMessage;
  } else if (typeof userMessage === 'object' && userMessage !== null) {
    // Handle array of content objects (for visual chat)
    if (Array.isArray(userMessage.content)) {
      messageText = userMessage.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join(' ');
    }
  }
  const detected = Object.entries(THEMES)
    .filter(([_, theme]) => 
      theme.keywords.some(keyword => 
        messageText.toLowerCase().includes(keyword)
      )
    )
    .map(([key, theme]) => ({ type: key, prompts: theme }));
  
  if (detected.length === 0) {
    const themeKeys = Object.keys(THEMES);
    const randomTheme = themeKeys[Math.floor(Math.random() * themeKeys.length)];
    console.log(`[${new Date().toISOString()}] detectThemes: Random a theme: "${randomTheme}"`);
    return [{ type: randomTheme, prompts: THEMES[randomTheme] }];
  }
  console.log(`[${new Date().toISOString()}] detectThemes: Detect a theme: "${detected.map(theme => theme.type).join('\n')}"`);
  return detected;
}

function generateSystemPrompt(user_age, currentLocalTime, isVisual, visualTask, detectedThemes, queryType) {
  const isStory = queryType === 'story';
  
  let prompt = `You are POPO, a ${isStory ? 'creative storyteller' : 'knowledgeable educator'} for a ${user_age}-year-old audience. Your ${isStory ? 'stories' : 'responses'} should be:
- Age-appropriate and positive
- ${isStory ? 'Imaginative yet relatable' : 'Educational and engaging'}
- Free of intense or frightening content
- Told in plain text without special formatting

${detectedThemes.map(theme => 
  isStory ? theme.prompts.storyPrompt : theme.prompts.qnaPrompt
).join('\n')}

${isStory ? `When crafting your story:
- Start in a unique, original way, avoiding common openings like "Once upon a time"
- Make the opening immediately engaging and relevant to the story's theme` : ''}

${currentLocalTime ? `Current local time: ${currentLocalTime}` : ''}`;

  if (isVisual) {
    prompt += `\nBased on the provided image${visualTask ? ` related to ${visualTask}` : ''}.`;
  }

  if (isStory) {
    const timeObj = currentLocalTime ? new Date(currentLocalTime) : null;
    if (timeObj) {
      const hour = timeObj.getHours();
      if (hour >= 19 || hour < 6) {
        prompt += '\nAs it\'s evening/night time, conclude with a calming, sleep-appropriate ending.';
      } else {
        prompt += '\nConclude with an energetic, day-appropriate ending.';
      }
    }
  }
  console.log(`[${new Date().toISOString()}] generateSystemPrompt: System prompt:\n${prompt}`);
  return prompt;
}

export const handleTextualChat = withAuth(async (request, env, openai, email) => {
  return handleChat(request, env, openai, false, email);
});

export const handleVisualChat = withAuth(async (request, env, openai, email) => {
  return handleChat(request, env, openai, true, email);
});

async function handleChat(request, env, openai, isVisual, email) {
  console.log(`[${new Date().toISOString()}] handleChat: Started processing ${isVisual ? 'visual' : 'textual'} chat request`);

  if (request.method !== "POST") {
    console.error(`[${new Date().toISOString()}] handleChat: Invalid method ${request.method}`);
    return new Response("This endpoint only accepts POST requests", { 
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getUserByEmail(env, email);
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), { 
        status: 404, 
        headers: { "Content-Type": "application/json" }
    });
  }
  const user_age = new Date().getFullYear() - user.yob;
  if (user_age < 0) {
    console.error(`[${new Date().toISOString()}] handleChat: Invalid yob: ${user.yob}`);
    return new Response(`Invalid year of birth: ${user.yob}`, { 
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  console.log(`[${new Date().toISOString()}] handleChat: User is of age ${user_age}`);

  const url = new URL(request.url);
  const queryType = url.searchParams.get('query_type') || 'qna';
  console.log(`[${new Date().toISOString()}] handleChat: Query type: ${queryType}`);
  const validQueryTypes = ['story', 'qna'];
  if (!validQueryTypes.includes(queryType)) {
    const errorMessage = `Invalid query_type: ${queryType}. Expected 'story' or 'qna'.`;
    console.error(`[${new Date().toISOString()}] handleChat: ${errorMessage}`);
    return new Response(errorMessage, { status: 400 });
  }

  const currentLocalTime = url.searchParams.get('current_time');
  console.log(`[${new Date().toISOString()}] handleChat: Current local time: ${currentLocalTime}`);
  if (currentLocalTime && isNaN(Date.parse(currentLocalTime))) {
    const errorMessage = `Invalid current_time: ${currentLocalTime}. Expected ISO 8601 format such as 2022-02-22T22:22:22+08:00.`;
    console.error(`[${new Date().toISOString()}] handleChat: ${errorMessage}`);
    return new Response(errorMessage, { status: 400 });
  }

  const visualTask = url.searchParams.get('visual_task');
  console.log(`[${new Date().toISOString()}] handleChat: Visual task: ${visualTask}`);

  if (visualTask) {
    const validVisualTasks = ['Micro', 'Plants', 'Animals', 'Insects', 'Daily', 'Translation'];
    if (!validVisualTasks.includes(visualTask)) {
      const errorMessage = `Invalid visual_task: ${visualTask}. Expected one of ${validVisualTasks.join(', ')}.`;
      console.error(`[${new Date().toISOString()}] handleChat: ${errorMessage}`);
      return new Response(errorMessage, { status: 400 });
    }
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
  const lastMessage = dialogHistory[dialogHistory.length - 1];
  const detectedThemes = detectThemes(lastMessage.content);
  
  const systemPrompt = generateSystemPrompt(
    new Date().getFullYear() - user.yob,
    currentLocalTime,
    isVisual,
    visualTask,
    detectedThemes,
    queryType
  );

  const messages = [
    { role: 'system', content: systemPrompt },
    ...dialogHistory
  ];

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
        if (paragraphs[i].length > OPENAI_TTS_TEXT_LENGTH_MAX) {
          console.warn(`[${new Date().toISOString()}] handleChat: Paragraph ${i + 1} exceeds the maximum length of ${OPENAI_TTS_TEXT_LENGTH_MAX} characters.`);
          continue;
        }
        console.log(`[${new Date().toISOString()}] handleChat: Generating audio for paragraph ${i + 1}`);
        const audioDataUri = await getOpenAIAudio(openai, paragraphs[i], user.preferred_voice);
        
        const chunk = {
          dialogHistory,
          currentParagraph: {
            index: i,
            text: paragraphs[i],
            audio: audioDataUri,
          }
        };
        await writer.write(encoder.encode(JSON.stringify(chunk) + '\n'));
        
        console.log(`[${new Date().toISOString()}] handleChat: Streamed audio for paragraph ${i + 1}`);
        console.log('Response summary:', {
          dialogHistoryLength: chunk.dialogHistory.length,
          lastMessageContent: chunk.dialogHistory[chunk.dialogHistory.length - 1].content.substring(0, 100) + '...',
          audioSegmentsIndex: chunk.currentParagraph.index,
          audioDataUriLength: chunk.currentParagraph.audio.length
        });
      }
  } catch (error) {
      const errorChunk = {
        dialogHistory,
        currentParagraph: null,
        error: error.message
      };
      await writer.write(encoder.encode(JSON.stringify(errorChunk) + '\n'));
    } finally {
      await writer.close();
    }
  };
  // Start the streaming process
  streamResponse();

  return new Response(readable, {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getOpenAIChatResponse(openai, messages, params) {
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    messages,
    ...params,
  });

  return chatCompletion.choices[0].message;
}

async function getOpenAIAudio(openai, text, preferred_voice) {
  console.log(`[${new Date().toISOString()}] getOpenAIAudio: Generating audio by ${preferred_voice} of text "${text.length <= 50 ? text : text.substring(0, 50) + '...' }"`);
  try {
    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice: preferred_voice,
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

export async function handleDialogHistoryTitle(request, openai) {
  console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Received request`);

  if (request.method !== 'POST') {
    console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Invalid method ${request.method}`);
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const requestData = await request.json();
    const { dialogHistory } = requestData;

    console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Validating dialog history with ${dialogHistory ? dialogHistory.length : 0} messages`);

    const validationResult = isValidDialogHistory(dialogHistory);
    if (!validationResult.isValid) {
      console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Invalid dialog history - ${validationResult.reason}`);
      return new Response(`Bad Request: Invalid dialog history - ${validationResult.reason}`, { status: 400 });
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a creative AI assistant tasked with generating a concise and engaging title for the following conversation. The title should capture the essence of the dialog without being too long. Respond only with the title, without any additional explanation or quotation marks.'
      },
      ...dialogHistory,
      {
        role: 'user',
        content: 'Based on this conversation, please generate a short, engaging title.'
      }
    ];

    const params = {
      temperature: 0.7,
      max_tokens: 50
    };

    console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Requesting title generation from OpenAI`);
    const response = await getOpenAIChatResponse(openai, messages, params);

    const title = response.content.trim();
    console.log(`[${new Date().toISOString()}] handleDialogHistoryTitle: Generated title "${title.length <= 50 ? title : title.substring(0, 50) + '...'}"`)

    return new Response(JSON.stringify({ title }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] handleDialogHistoryTitle: Error - ${error.message}`);
    return new Response('Internal Server Error', { status: 500 });
  }
}

function isValidDialogHistory(dialogHistory) {
  if (!dialogHistory) {
    return { isValid: false, reason: "Dialog history is missing" };
  }
  if (!Array.isArray(dialogHistory)) {
    return { isValid: false, reason: "Dialog history is not an array" };
  }
  if (dialogHistory.length === 0) {
    return { isValid: false, reason: "Dialog history is empty" };
  }

  const validRoles = ['user', 'assistant', 'system'];

  for (let i = 0; i < dialogHistory.length; i++) {
    const message = dialogHistory[i];
    if (typeof message !== 'object' || message === null) {
      return { isValid: false, reason: `Message at index ${i} is not an object` };
    }
    if (!validRoles.includes(message.role)) {
      return { isValid: false, reason: `Invalid role "${message.role}" at index ${i}` };
    }
    
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        continue;
      }
      if (Array.isArray(message.content)) {
        for (let j = 0; j < message.content.length; j++) {
          const item = message.content[j];
          if (item.type === 'text') {
            if (typeof item.text !== 'string') {
              return { isValid: false, reason: `Invalid text content at index ${i}, item ${j}` };
            }
          } else if (item.type === 'image_url') {
            if (!item.image_url || typeof item.image_url.url !== 'string') {
              return { isValid: false, reason: `Invalid image_url at index ${i}, item ${j}` };
            }
          } else {
            return { isValid: false, reason: `Invalid content type "${item.type}" at index ${i}, item ${j}` };
          }
        }
      } else {
        return { isValid: false, reason: `User message content at index ${i} is neither a string nor an array` };
      }
    } else {
      if (typeof message.content !== 'string') {
        return { isValid: false, reason: `Non-user message content at index ${i} is not a string` };
      }
    }
  }
  return { isValid: true };
}

export async function handleTranscription(request, openai) {
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


export async function handleBedTimeStoryChatStream(request, openai) {
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


export async function handleBedTimeStoryChat(request, openai, elevenlabs_sk) {
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
