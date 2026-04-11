import { useState, useCallback } from 'react';

/**
 * Manages the open-tab list and which tab is active.
 *
 * Responsibilities:
 *   - openTabs list
 *   - activeTabId
 *   - Opening tabs (addTab)
 *   - Switching tabs (handleTabSelect)
 *   - Closing tabs (handleTabClose)
 *
 * Design note: onTabClose is a callback EditorView passes in so that closing
 * a tab can also trigger session teardown and content cleanup without this
 * hook needing to know about either of those systems.
 */
export function useTabManager({ onTabClose } = {}) {
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  /** Add a tab if not already open, then switch to it. */
  const addTab = useCallback((file) => {
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === file.id)) return prev;
      return [...prev, file];
    });
    setActiveTabId(file.id);
  }, []);

  /** Update metadata for an already-open tab (e.g. after rename). */
  const updateTab = useCallback((fileId, patch) => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.id === fileId ? { ...t, ...patch } : t))
    );
  }, []);

  const handleTabSelect = useCallback((tabId) => {
    setActiveTabId(tabId);
  }, []);

  const handleTabClose = useCallback((tabId) => {
    onTabClose?.(tabId); // caller handles session teardown + content cleanup

    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      // If we closed the active tab, activate the rightmost remaining tab
      setActiveTabId((current) => {
        if (current !== tabId) return current;
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      return remaining;
    });
  }, [onTabClose]);

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;

  return {
    openTabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    addTab,
    updateTab,
    handleTabSelect,
    handleTabClose,
  };
}