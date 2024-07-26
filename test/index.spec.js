import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import worker from '../src';

// Mock OpenAI
vi.mock('openai', () => ({
	default: class {
	  constructor() {}
	  audio = {
		transcriptions: {
		  create: vi.fn().mockResolvedValue({ text: 'Mocked transcription' })
		}
	  };
	  chat = {
		completions: {
		  create: vi.fn().mockResolvedValue({
			choices: [{ message: { content: 'Mocked story response' } }]
		  })
		}
	  };
	}
}));


describe('OpenAI API Cloudflare Worker', () => {
  const mockApiKey = 'test-api-key';
  const mockEnv = {
    CF_MFW_API_KEY: mockApiKey,
    OPENAI_API_KEY: 'mock-openai-key',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
  };

  describe('Authentication', () => {
    it('should return 401 if API key is missing', async () => {
      const request = new Request('http://example.com/transcribe', { method: 'POST' });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(401);
    });

    it('should return 401 if API key is incorrect', async () => {
      const request = new Request('http://example.com/transcribe', {
        method: 'POST',
        headers: { 'X-API-Key': 'wrong-key' },
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(401);
    });
  });

  describe('Transcription endpoint', () => {
    it('should return 400 if no audio file is provided', async () => {
	  const formData = new FormData();
      const request = new Request('http://example.com/transcribe', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey, },
		body: formData,
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
    });

    it('should return 400 if audio file is too large', async () => {
      const largeFile = new File([new ArrayBuffer(26 * 1024 * 1024)], 'large.mp3', { type: 'audio/mpeg' });
      const formData = new FormData();
      formData.append('audio', largeFile);
      const request = new Request('http://example.com/transcribe', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey },
        body: formData,
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('File size exceeds the limit');
    });

    it('should call OpenAI API and return transcription', async () => {

      const audioFile = new File([new ArrayBuffer(1000)], 'test.mp3', { type: 'audio/mpeg' });
      const formData = new FormData();
      formData.append('audio', audioFile);
      const request = new Request('http://example.com/transcribe', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey },
        body: formData,
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody).toEqual({ text: 'Mocked transcription' });
    });
  });

  describe('Bedtime Story Chat endpoint', () => {
    it('should return 400 if dialogHistory is missing', async () => {
      const request = new Request('http://example.com/story', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
    });

    it('should return 400 if last message is not from user', async () => {
      const request = new Request('http://example.com/story', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dialogHistory: [
            { role: 'user', content: 'Tell me a story' },
            { role: 'assistant', content: 'Once upon a time...' },
          ],
        }),
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(400);
    });

    it('should call OpenAI API and return chat completion', async () => {
      const mockCompletion = {
        choices: [{ message: { role: 'assistant', content: 'Here\'s a bedtime story...' } }],
      };
      global.OpenAI = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockCompletion),
          },
        },
      };

      const request = new Request('http://example.com/story', {
        method: 'POST',
        headers: { 'X-API-Key': mockApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dialogHistory: [
            { role: 'user', content: 'Tell me a bedtime story' },
          ],
        }),
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, mockEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.dialogHistory).toHaveLength(2);
      expect(responseBody.dialogHistory[1].content).toBe('Mocked story response');
    });
  });
});