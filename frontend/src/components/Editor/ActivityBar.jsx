import './ActivityBar.css';

/**
 * ActivityBar
 *
 * The narrow icon strip on the far left
 * Each button corresponds to a named panel in the left sidebar.
 *
 * Clicking the active panel's button toggles the sidebar closed.
 * Clicking an inactive panel's button opens that panel.
 *
 * Props:
 *   activePanel   — string | null: which panel is currently open
 *   onPanelToggle — (panelId: string) => void
 *                   EditorView calls this to toggle sidebarOpen and set activePanel
 */

const PANELS = [
  {
    id: 'files',
    title: 'Explorer',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="9" y="6" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
];

const ActivityBar = ({ activePanel, onPanelToggle }) => {
  return (
    <div className="activity-bar" role="navigation" aria-label="Side panels">
      {PANELS.map(({ id, title, icon }) => {
        const isActive = activePanel === id;
        return (
          <button
            key={id}
            className={`activity-bar-btn ${isActive ? 'active' : ''}`}
            onClick={() => onPanelToggle(id)}
            title={title}
            aria-label={title}
            aria-pressed={isActive}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
};

export default ActivityBar;