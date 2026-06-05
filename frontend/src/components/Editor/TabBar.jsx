import './TabBar.css';

const TabBar = ({ tabs, activeTabId, onTabSelect, onTabClose, unsavedFiles = new Set() }) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isFileTab = tab.kind === 'file';
        const isChatTab = tab.kind === 'chat';
        const label = tab.title || tab.filename || 'Untitled';
        const isUnsaved = isFileTab && unsavedFiles.has(tab.resourceId);
        return (
          <div
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'active' : ''} ${isUnsaved ? 'unsaved' : ''} ${isChatTab ? 'chat-tab' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            title={isUnsaved ? `${label} (unsaved)` : label}
          >
            <span className="tab-name">
              {isChatTab && <span className="tab-kind-icon" aria-hidden="true">◇</span>}
              {label}
              {isUnsaved && <span className="unsaved-dot">●</span>}
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="tab-spacer"></div>
    </div>
  );
};

export default TabBar;
