import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import DashboardView from './views/DashboardView';
import LoginView from './views/LoginView';
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
            ß<Route path="/oauth/callback" element={<OAuthCallback />} />
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
