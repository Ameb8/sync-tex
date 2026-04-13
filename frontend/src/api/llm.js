/**
 * llm.js — API client for the assistant-service LLM endpoints.
 *
 * Uses authFetch from AuthContext (same pattern as other api/*.js files).
 * No getToken threading required.
 */

import { authFetch } from '../contexts/AuthContext';

const BASE = '/api/llm/v1'; // proxied through nginx

// Error helper function
async function throwIfError(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res;
}

// Key management

export async function upsertLLMKey(provider, apiKey) {
  const res = await authFetch(`${BASE}/keys`, {
    method: 'PUT',
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  return (await throwIfError(res)).json();
}

export async function listLLMKeys() {
  const res = await authFetch(`${BASE}/keys`);
  return (await throwIfError(res)).json(); // { keys: [...] }
}

export async function deleteLLMKey(provider) {
  const res = await authFetch(`${BASE}/keys/${provider}`, { method: 'DELETE' });
  await throwIfError(res);
}

// ---------- settings ----------

export async function getLLMSettings() {
  const res = await authFetch(`${BASE}/settings`);
  return (await throwIfError(res)).json();
}

export async function updateLLMSettings(patch) {
  const res = await authFetch(`${BASE}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return (await throwIfError(res)).json();
}

// Usage info

export async function getLLMUsage() {
  const res = await authFetch(`${BASE}/usage`);
  return (await throwIfError(res)).json();
}

// Chats 

export async function createChat(projectId, title = '') {
  const res = await authFetch(`${BASE}/chats`, {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, title }),
  });
  return (await throwIfError(res)).json();
}

export async function listChats(projectId) {
  const res = await authFetch(`${BASE}/chats?project_id=${projectId}`);
  return (await throwIfError(res)).json();
}

export async function getChatMessages(chatId) {
  const res = await authFetch(`${BASE}/chats/${chatId}/messages`);
  return (await throwIfError(res)).json();
}

export async function deleteChat(chatId) {
  const res = await authFetch(`${BASE}/chats/${chatId}`, { method: 'DELETE' });
  await throwIfError(res);
}


/**
 * streamChat — sends a user message and calls `onChunk(text)` for each SSE
 * chunk, then `onDone(meta)` when the server signals completion.
 *
 * Returns an AbortController so the caller can cancel.
 *
 * authFetch spreads options into fetch, so `signal` passes through correctly.
 */
export function streamChat(
  { chatId, message, systemPrompt, maxTokens = 2048 },
  { onChunk, onDone, onError }
) {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await authFetch(`${BASE}/chat/stream`, {
        method: 'POST',
        body: JSON.stringify({
          chat_id: chatId,
          message,
          system_prompt: systemPrompt,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name !== 'AbortError') onError?.(e);
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onError?.(new Error(body.detail ?? `HTTP ${res.status}`));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      let done, value;
      try {
        ({ done, value } = await reader.read());
      } catch (e) {
        if (e.name !== 'AbortError') onError?.(e);
        break;
      }
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.error) {
            onError?.(new Error(payload.error));
          } else if (payload.done) {
            onDone?.(payload);
          } else if (payload.chunk != null) {
            onChunk?.(payload.chunk);
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  })();

  return controller;
}

// Get list of available providers
export async function listProviders() {
  const res = await fetch(`${BASE}/providers`); // public endpoint, no auth needed
  return res.json(); // { providers: [...] }
}