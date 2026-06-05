import { useState, useRef, useEffect, useCallback } from 'react';
import { streamChat } from '../../../api/llm';
import MessageList from './MessageList';
import './AIPanel.css';

/**
 * ChatWindow
 *
 * Renders the top bar (sidebar toggle, chat title, new-chat button),
 * the message list, and the input row.
 *
 * Streaming is handled here: chunks are appended to a temporary "streaming"
 * message, then committed to the messages list on done.
 */
const ChatWindow = ({
  projectId,
  contextFile,
  chat,
  messages,
  messagesLoading,
  onNewChat,
  onMessagesUpdate,
  onChatTitleUpdate,
}) => {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState(''); // partial assistant text
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // auto-scroll on new messages or stream chunks
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  // auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  // build a system prompt that includes the active file name for context
  const buildSystemPrompt = useCallback(() => {
    if (!contextFile) return undefined;
    const filename = contextFile.filename || contextFile.name;
    if (!filename) return undefined;

    return (
      `You are a helpful LaTeX assistant embedded in SyncTeX, a collaborative LaTeX editor. ` +
      `The user is currently editing a file called "${filename}". ` +
      `Provide concise, accurate help. When showing LaTeX code, wrap it in code blocks.`
    );
  }, [contextFile]);

  // onDone captures stale streamBuffer via closure; use a ref workaround
  // Simpler: collect buffer in ref and read it in onDone
  const streamBufRef = useRef('');
  useEffect(() => { streamBufRef.current = streamBuffer; }, [streamBuffer]);

  // Re-implement handleSend with ref so onDone can read final buffer
  const handleSendStable = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !chat) return;

    setInput('');
    setError(null);
    streamBufRef.current = '';

    const userMsg = { id: `local-${Date.now()}`, role: 'user', content: text };
    onMessagesUpdate((prev) => [...prev, userMsg]);

    setStreaming(true);
    setStreamBuffer('');

    abortRef.current = streamChat(
      {
        chatId: chat.id,
        message: text,
        systemPrompt: buildSystemPrompt(),
        maxTokens: 2048,
      },
      {
        onChunk: (chunk) => {
          streamBufRef.current += chunk;
          setStreamBuffer(streamBufRef.current);
        },
        onDone: () => {
          const finalText = streamBufRef.current;
          setStreaming(false);
          setStreamBuffer('');
          streamBufRef.current = '';

          onMessagesUpdate((prev) => [
            ...prev,
            { id: `asst-${Date.now()}`, role: 'assistant', content: finalText },
          ]);

          if (chat && !chat.title) {
            onChatTitleUpdate(chat.id, text.slice(0, 60));
          }
        },
        onError: (err) => {
          setStreaming(false);
          setStreamBuffer('');
          streamBufRef.current = '';
          setError(err.message ?? 'Streaming failed');
        },
      }
    );
  }, [input, streaming, chat, buildSystemPrompt, onMessagesUpdate, onChatTitleUpdate]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendStable();
    }
  }, [handleSendStable]);

  const canSend = !!chat && input.trim().length > 0 && !streaming;

  return (
    <div className="ai-chat-main">
      {/* Top bar */}
      <div className="ai-chat-topbar">
        <span className={`ai-topbar-title${chat ? '' : ' placeholder'}`}>
          {chat ? (chat.title || 'Untitled chat') : 'Select or create a chat'}
        </span>

        <button className="ai-topbar-new-btn" onClick={onNewChat} title="New chat">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          New chat
        </button>
      </div>

      {/* Message area */}
      {!chat ? (
        <div className="ai-empty-state">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect x="4" y="8" width="32" height="22" rx="4" stroke="currentColor" strokeWidth="2"/>
            <path d="M13 32l7-4 7 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 17h16M12 22h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p>Select a chat from the list,<br/>or start a new one.</p>
          <button className="ai-empty-new-btn" onClick={onNewChat}>
            New chat
          </button>
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            loading={messagesLoading}
            streamBuffer={streamBuffer}
            streaming={streaming}
            bottomRef={bottomRef}
          />

          {error && (
            <div className="ai-error-banner">{error}</div>
          )}

          <div className="ai-input-area">
            <div className="ai-input-row">
              <textarea
                ref={textareaRef}
                className="ai-input-textarea"
                placeholder={chat ? 'Ask anything… (Enter to send, Shift+Enter for newline)' : 'Select a chat to start'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!chat || streaming}
                rows={1}
              />

              {streaming ? (
                <button
                  className="ai-send-btn ai-stop-btn"
                  onClick={handleStop}
                  title="Stop generation"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="2" y="2" width="10" height="10" rx="1" fill="currentColor"/>
                  </svg>
                </button>
              ) : (
                <button
                  className="ai-send-btn"
                  onClick={handleSendStable}
                  disabled={!canSend}
                  title="Send (Enter)"
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M13 7.5L2 2l2.5 5.5L2 13l11-5.5z" fill="currentColor"/>
                  </svg>
                </button>
              )}
            </div>

            <div className="ai-input-meta">
              <span className="ai-input-hint">Shift+Enter for newline</span>
              {contextFile && (
                <span className="ai-model-badge">{contextFile.filename || contextFile.name}</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatWindow;
