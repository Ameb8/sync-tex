import './TabBar.css';

const TabBar = ({ tabs, activeTabId, onTabSelect, onTabClose, unsavedFiles = new Set() }) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const isUnsaved = unsavedFiles.has(tab.id);
        return (
          <div
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'active' : ''} ${isUnsaved ? 'unsaved' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            title={isUnsaved ? `${tab.filename} (unsaved)` : tab.filename}
          >
            <span className="tab-name">
              {tab.filename}
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