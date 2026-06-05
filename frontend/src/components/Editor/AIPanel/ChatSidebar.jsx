import './AIPanel.css';

/**
 * ChatSidebar
 *
 * Lists all chats for the project inside the normal editor side panel.
 */
const ChatSidebar = ({
  chats,
  loading,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  onNewChat,
}) => {
  return (
    <div className="ai-chat-sidebar">
      <div className="ai-sidebar-header">
        <h3>Chats</h3>
        <button className="ai-sidebar-new-btn" onClick={onNewChat} title="New chat">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          New
        </button>
      </div>

      <div className="ai-chat-list">
        {loading && (
          <div className="ai-chat-empty">Loading…</div>
        )}

        {!loading && chats.length === 0 && (
          <div className="ai-chat-empty">
            No chats yet.<br />Start a new one!
          </div>
        )}

        {!loading && chats.map((chat) => (
          <div
            key={chat.id}
            className={`ai-chat-item${chat.id === activeChatId ? ' active' : ''}`}
            onClick={() => onSelectChat(chat.id)}
          >
            <span className="ai-chat-item-title">
              {chat.title || 'Untitled chat'}
            </span>
            <button
              className="ai-chat-delete-btn"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(chat.id);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatSidebar;
