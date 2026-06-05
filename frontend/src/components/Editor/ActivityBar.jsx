import { useNavigate } from 'react-router-dom';
import './ActivityBar.css';

/**
 * ActivityBar
 *
 * The narrow icon strip on the far left
 *
 * Each panel entry has a `type` field that controls where it renders:
 *
 *   type: 'sidebar'  — slides open to the left of the editor (file tree, search…)
 *                      Toggling the active sidebar panel closes it.
 *
 *   type: 'main'     — replaces the Monaco editor area entirely, filling the
 *                      full space between the activity bar and the right sidebar.
 *                      Toggling the active main panel returns to the editor.
 *
 * Props:
 *   activeSidebarPanel — string | null: which sidebar panel is open
 *   activeMainPanel    — string | null: which main panel is open (or null = editor)
 *   onPanelToggle      — (panelId: string, type: 'sidebar' | 'main') => void
 *
 */

const PANELS = [
  {
    id: 'files',
    type: 'sidebar',
    title: 'Explorer',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="9" y="6" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: 'ai',
    type: 'sidebar',
    title: 'AI Assistant',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {/* Chat bubble with a spark */}
        <path
          d="M3 4a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7l-4 3V4z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M10 6v1m0 3v1M8 8h1m3 0h1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'llm',
    type: 'main',
    title: 'API Keys',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="8" cy="9" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11.5 11.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M15 15.5V17h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'collaborators',
    type: 'sidebar',
    title: 'Collaborators',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="14" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M1 17c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M14 13c2 0 4 1 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// Inline home icon
const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7 18v-5h6v5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

const ActivityBar = ({ activeSidebarPanel, activeMainPanel, onPanelToggle }) => {
  const navigate = useNavigate();

  return (
    <div className="activity-bar" role="navigation" aria-label="Side panels">
      {PANELS.map(({ id, type, title, icon }) => {
        const isActive =
          type === 'sidebar' ? activeSidebarPanel === id :
          type === 'main'    ? activeMainPanel    === id :
          false;

        return (
          <button
            key={id}
            className={`activity-bar-btn ${isActive ? 'active' : ''}`}
            onClick={() => onPanelToggle(id, type)}
            title={title}
            aria-label={title}
            aria-pressed={isActive}
          >
            {icon}
          </button>
        );
      })}

      {/* Pushes home button to the bottom */}
      <div className="activity-bar-spacer" />

      <button
        className="activity-bar-btn"
        onClick={() => navigate('/')}
        title="Back to dashboard"
        aria-label="Back to dashboard"
      >
        <HomeIcon />
      </button>
    </div>
  );
};

export default ActivityBar;
