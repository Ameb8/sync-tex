import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import DashboardView from './views/DashboardView';
import EditorView from './views/EditorView';
import LoginView from './views/LoginView';
import JoinView from './views/JoinView';
import OAuthCallback from './views/OAuthCallback';

import ProtectedRoute from './components/ProtectedRoute';
import './App.css';



function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app">
          <Routes>
            <Route path="/login" element={<LoginView />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/join" element={<JoinView />} />
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
        </div>
      </Router>
    </AuthProvider>
  );
}

 
export default App;
