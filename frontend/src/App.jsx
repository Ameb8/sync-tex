import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginView from './views/LoginView';

import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

const DashboardView = lazy(() => import('./views/DashboardView'));
const EditorView = lazy(() => import('./views/EditorView'));
const JoinView = lazy(() => import('./views/JoinView'));
const LegalView = lazy(() => import('./views/LegalView'));
const OAuthCallback = lazy(() => import('./views/OAuthCallback'));
const SettingsView = lazy(() => import('./views/SettingsView'));

function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <ThemeProvider>
          <div className="app">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginView />} />
                <Route path="/privacy" element={<LegalView document="privacy" />} />
                <Route path="/terms" element={<LegalView document="terms" />} />
                <Route path="/tos" element={<LegalView document="terms" />} />
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/join" element={<JoinView />} />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <SettingsView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/project/:projectId"
                  element={
                    <ProtectedRoute>
                      <EditorView />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <DashboardView />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </Suspense>
          </div>
        </ThemeProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
