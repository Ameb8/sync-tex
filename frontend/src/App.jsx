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
const LandingView = lazy(() => import('./views/LandingView'));
const LegalView = lazy(() => import('./views/LegalView'));
const OAuthCallback = lazy(() => import('./views/OAuthCallback'));
const SettingsView = lazy(() => import('./views/SettingsView'));

function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

function AuthRoute({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function App() {
  return (
    <Router>
      <ThemeProvider>
        <div className="app">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingView />} />
              <Route
                path="/login"
                element={
                  <AuthRoute>
                    <LoginView />
                  </AuthRoute>
                }
              />
              <Route path="/privacy" element={<LegalView document="privacy" />} />
              <Route path="/terms" element={<LegalView document="terms" />} />
              <Route path="/tos" element={<LegalView document="terms" />} />
              <Route
                path="/oauth/callback"
                element={
                  <AuthRoute>
                    <OAuthCallback />
                  </AuthRoute>
                }
              />
              <Route
                path="/join"
                element={
                  <AuthRoute>
                    <JoinView />
                  </AuthRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <AuthRoute>
                    <ProtectedRoute>
                      <SettingsView />
                    </ProtectedRoute>
                  </AuthRoute>
                }
              />
              <Route
                path="/project/:projectId"
                element={
                  <AuthRoute>
                    <ProtectedRoute>
                      <EditorView />
                    </ProtectedRoute>
                  </AuthRoute>
                }
              />
              <Route
                path="/projects"
                element={
                  <AuthRoute>
                    <ProtectedRoute>
                      <DashboardView />
                    </ProtectedRoute>
                  </AuthRoute>
                }
              />
            </Routes>
          </Suspense>
        </div>
      </ThemeProvider>
    </Router>
  );
}

export default App;
