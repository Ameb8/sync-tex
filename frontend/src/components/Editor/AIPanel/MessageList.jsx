/**
 * MessageList
 *
 * Renders the conversation history with full markdown support.
 * Uses react-markdown for parsing and react-syntax-highlighter for code blocks.
 */
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';


const MessageList = ({ messages, loading, streamBuffer, streaming, bottomRef }) => {
  const prevBufferRef = useRef('');
  const scrollTimeout = useRef(null);
  const containerRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Detect scrolling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 100;

      setShouldAutoScroll(nearBottom);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!shouldAutoScroll) return;
    if (!streamBuffer) return;

    if (
      streamBuffer.includes('\n') &&
      !prevBufferRef.current.endsWith('\n')
    ) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }

    prevBufferRef.current = streamBuffer;
  }, [streamBuffer, shouldAutoScroll]);
  
  
  if (loading) {
    return (
      <div className="ai-panel-loading">
        <span className="ai-spinner" />
        Loading messages…
      </div>
    );
  }

  const allEmpty = messages.length === 0 && !streaming;

  return (
    <div className="ai-message-list" ref={containerRef}>
      {allEmpty && (
        <div className="ai-empty-state">
          <p style={{ opacity: 0.5, fontSize: 12 }}>Send a message to get started.</p>
        </div>
      )}

      {messages.map((msg) => (
        <Message key={msg.id} role={msg.role} content={msg.content} />
      ))}

      {/* Live streaming assistant bubble */}
      {streaming && streamBuffer && (
        <div className="ai-message assistant">
          <span className="ai-message-role">Assistant</span>
          <div className="ai-message-bubble ai-message-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {streamBuffer}
            </ReactMarkdown>
            <span className="ai-stream-cursor" />
          </div>
        </div>
      )}

      {/* Streaming spinner when waiting for first chunk */}
      {streaming && !streamBuffer && (
        <div className="ai-message assistant">
          <span className="ai-message-role">Assistant</span>
          <div className="ai-message-bubble" style={{ opacity: 0.5 }}>
            <span className="ai-stream-cursor" />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

/**
 * Single message bubble with markdown support.
 */
const Message = ({ role, content }) => {
  const isAssistant = role === 'assistant';

  return (
    <div className={`ai-message ${role}`}>
      <span className="ai-message-role">
        {isAssistant ? 'Assistant' : 'You'}
      </span>
      <div className={`ai-message-bubble ${isAssistant ? 'ai-message-markdown' : ''}`}>
        {isAssistant ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        ) : (
          // User messages: plain text, no markdown parsing needed
          <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
        )}
      </div>
    </div>
  );
};

/**
 * Custom markdown component overrides for styled rendering.
 * Integrates with your existing CSS design system.
 */
const markdownComponents = {
  // Code blocks with syntax highlighting
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';

    if (inline) {
      return (
        <code className="ai-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return (
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="pre"
        CodeTag="code"
        className="ai-code-block"
        showLineNumbers={false}
        wrapLines={false}
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    );
  },

  // Headings
  h1: ({ children }) => <h1 className="ai-md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="ai-md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="ai-md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="ai-md-h4">{children}</h4>,
  h5: ({ children }) => <h5 className="ai-md-h5">{children}</h5>,
  h6: ({ children }) => <h6 className="ai-md-h6">{children}</h6>,

  // Paragraphs
  p: ({ children }) => <p className="ai-md-p">{children}</p>,

  // Lists
  ul: ({ children }) => <ul className="ai-md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="ai-md-ol">{children}</ol>,
  li: ({ children }) => <li className="ai-md-li">{children}</li>,

  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="ai-md-blockquote">{children}</blockquote>
  ),

  // Links
  a: ({ href, children }) => (
    <a href={href} className="ai-md-link" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),

  // Horizontal rule
  hr: () => <hr className="ai-md-hr" />,

  // Tables (from remark-gfm)
  table: ({ children }) => <table className="ai-md-table">{children}</table>,
  thead: ({ children }) => <thead className="ai-md-thead">{children}</thead>,
  tbody: ({ children }) => <tbody className="ai-md-tbody">{children}</tbody>,
  tr: ({ children }) => <tr className="ai-md-tr">{children}</tr>,
  th: ({ children }) => <th className="ai-md-th">{children}</th>,
  td: ({ children }) => <td className="ai-md-td">{children}</td>,

  // Emphasis
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,

  // Strikethrough (from remark-gfm)
  del: ({ children }) => <del className="ai-md-del">{children}</del>,
};

export default MessageList;