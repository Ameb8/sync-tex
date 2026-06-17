import { FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { THEME_PREFERENCES, useTheme } from '../contexts/ThemeContext';
import './SettingsView.css';

const THEME_OPTIONS = {
  system: {
    label: 'System',
    Icon: FiMonitor,
  },
  light: {
    label: 'Light',
    Icon: FiSun,
  },
  dark: {
    label: 'Dark',
    Icon: FiMoon,
  },
};

function SettingsView() {
  const navigate = useNavigate();
  const { themePreference, setThemePreference } = useTheme();

  return (
    <main className="settings-view">
      <header className="settings-header">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/projects')}>
          Dashboard
        </button>
      </header>

      <section className="settings-panel">
        <div className="settings-title-group">
          <h1>Settings</h1>
        </div>

        <div className="settings-row">
          <div className="settings-row-copy">
            <h2>Appearance</h2>
          </div>

          <div className="theme-segmented-control" role="radiogroup" aria-label="Appearance">
            {THEME_PREFERENCES.map((preference) => {
              const { label, Icon } = THEME_OPTIONS[preference];
              const isActive = themePreference === preference;

              return (
                <button
                  key={preference}
                  type="button"
                  className={`theme-segment ${isActive ? 'active' : ''}`}
                  onClick={() => setThemePreference(preference)}
                  role="radio"
                  aria-checked={isActive}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

export default SettingsView;
