import { useCallback, useEffect, useState } from 'react';
import { createChat, deleteChat, getChatMessages, listChats } from '../api/llm';

/**
 * Owns the project chat list and per-chat message cache.
 *
 * The editor tab manager only tracks which resources are open. This hook owns
 * chat-specific loading and mutation state so chat tabs can behave like file
 * tabs without making the tab hook know about assistant-service APIs.
 */
export function useChatManager({ projectId }) {
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [messagesByChatId, setMessagesByChatId] = useState({});
  const [messagesLoadingByChatId, setMessagesLoadingByChatId] = useState({});

  useEffect(() => {
    let cancelled = false;

    setChatsLoading(true);
    setChats([]);
    setMessagesByChatId({});
    setMessagesLoadingByChatId({});

    listChats(projectId)
      .then((list) => {
        if (!cancelled) setChats(list);
      })
      .catch((err) => {
        console.error('Failed to load chats:', err);
      })
      .finally(() => {
        if (!cancelled) setChatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const ensureChatMessages = useCallback((chatId) => {
    if (
      !chatId ||
      messagesLoadingByChatId[chatId] ||
      Object.prototype.hasOwnProperty.call(messagesByChatId, chatId)
    ) {
      return;
    }

    setMessagesLoadingByChatId((prev) => ({ ...prev, [chatId]: true }));

    getChatMessages(chatId)
      .then((messages) => {
        setMessagesByChatId((prev) => ({ ...prev, [chatId]: messages }));
      })
      .catch((err) => {
        console.error('Failed to load chat messages:', err);
      })
      .finally(() => {
        setMessagesLoadingByChatId((prev) => ({ ...prev, [chatId]: false }));
      });
  }, [messagesByChatId, messagesLoadingByChatId]);

  const createNewChat = useCallback(async () => {
    const chat = await createChat(projectId);
    setChats((prev) => [chat, ...prev]);
    setMessagesByChatId((prev) => ({ ...prev, [chat.id]: [] }));
    return chat;
  }, [projectId]);

  const removeChat = useCallback(async (chatId) => {
    await deleteChat(chatId);

    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setMessagesByChatId((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    setMessagesLoadingByChatId((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
  }, []);

  const updateChatTitle = useCallback((chatId, title) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, title } : chat))
    );
  }, []);

  const updateChatMessages = useCallback((chatId, updater) => {
    setMessagesByChatId((prev) => {
      const current = prev[chatId] ?? [];
      const nextMessages = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [chatId]: nextMessages };
    });
  }, []);

  return {
    chats,
    chatsLoading,
    messagesByChatId,
    messagesLoadingByChatId,
    ensureChatMessages,
    createNewChat,
    removeChat,
    updateChatTitle,
    updateChatMessages,
  };
}
