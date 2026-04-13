/**
 * MessageList
 *
 * Renders the conversation history plus a live streaming message if one is
 * in progress. Uses simple pre-wrap rendering; no markdown parser dependency.
 */
const MessageList = ({ messages, loading, streamBuffer, streaming, bottomRef }) => {
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
    <div className="ai-message-list">
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
          <div className="ai-message-bubble">
            {streamBuffer}
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
 * Single message bubble. Does a minimal pass to render code blocks as <pre>.
 */
const Message = ({ role, content }) => {
  const parts = renderContent(content);

  return (
    <div className={`ai-message ${role}`}>
      <span className="ai-message-role">
        {role === 'user' ? 'You' : 'Assistant'}
      </span>
      <div className="ai-message-bubble">
        {parts}
      </div>
    </div>
  );
};

/**
 * Very lightweight renderer: splits on ```...``` code fences and renders
 * them as <pre><code> blocks. Everything else is plain text.
 */
function renderContent(text) {
  const parts = [];
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  let key = 0;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    }
    parts.push(
      <pre key={key++}>
        <code>{match[2]}</code>
      </pre>
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  }

  return parts;
}

export default MessageList;