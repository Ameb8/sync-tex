import './TabBar.css';

const TabBar = ({ tabs, activeTabId, onTabSelect, onTabClose }) => {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => onTabSelect(tab.id)}
        >
          <span className="tab-name">{tab.filename}</span>
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
      ))}
      <div className="tab-spacer"></div>
    </div>
  );
};

export default TabBar;