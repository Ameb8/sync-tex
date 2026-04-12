import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { createChat, listChats, deleteChat, getChatMessages } from '../../../api/llm';
import ChatSidebar from './ChatSidebar';
import ChatWindow from './ChatWindow';
import './AIPanel.css';

/**
 * AIPanel
 *
 * Mounted when mainPanel === 'ai' in EditorView.
 * Owns the chat list and the active chat state.
 * Renders as: [ChatSidebar?] [ChatWindow]
 *
 * Props:
 *   projectId  — string
 *   activeTab  — current editor tab (passed to ChatWindow for context)
 */
const AIPanel = ({ projectId, activeTab }) => {
  const { getToken } = useAuth();

  // sidebar visibility
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // chats list
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);

  // active chat
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]); // { id, role, content }[]
  const [messagesLoading, setMessagesLoading] = useState(false);

  // load chat list on mount / projectId change
  useEffect(() => {
    let cancelled = false;
    setChatsLoading(true);
    setActiveChatId(null);
    setMessages([]);

    listChats(getToken, projectId)
      .then((list) => { if (!cancelled) setChats(list); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChatsLoading(false); });

    return () => { cancelled = true; };
  }, [projectId, getToken]);

  // load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) { setMessages([]); return; }
    let cancelled = false;
    setMessagesLoading(true);

    getChatMessages(getToken, activeChatId)
      .then((msgs) => { if (!cancelled) setMessages(msgs); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMessagesLoading(false); });

    return () => { cancelled = true; };
  }, [activeChatId, getToken]);

  // create a new chat and switch to it
  const handleNewChat = useCallback(async () => {
    try {
      const chat = await createChat(getToken, projectId);
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }, [getToken, projectId]);

  // delete a chat
  const handleDeleteChat = useCallback(async (chatId) => {
    try {
      await deleteChat(getToken, chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }, [getToken, activeChatId]);

  // called by ChatWindow when the title changes (auto-titled on first message)
  const handleChatTitleUpdate = useCallback((chatId, title) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, title } : c))
    );
  }, []);

  // called by ChatWindow to append messages without re-fetching
  const handleMessagesUpdate = useCallback((updater) => {
    setMessages(updater);
  }, []);

  return (
    <div className="ai-panel">
      <ChatSidebar
        visible={sidebarVisible}
        chats={chats}
        loading={chatsLoading}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onDeleteChat={handleDeleteChat}
        onNewChat={handleNewChat}
      />

      <ChatWindow
        projectId={projectId}
        activeTab={activeTab}
        chat={chats.find((c) => c.id === activeChatId) ?? null}
        messages={messages}
        messagesLoading={messagesLoading}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onNewChat={handleNewChat}
        onMessagesUpdate={handleMessagesUpdate}
        onChatTitleUpdate={handleChatTitleUpdate}
      />
    </div>
  );
};

export default AIPanel;