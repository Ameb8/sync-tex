import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { checkAuth } = useAuth();

  useEffect(() => {
    // After GitHub redirects back, extract token from URL
    const handleCallback = async () => {
      const token = searchParams.get('token');
      const error = searchParams.get('error');

      if (error) {
        // OAuth failed
        navigate(`/login?error=${encodeURIComponent(error)}`);
        return;
      }

      if (token) {
        // Store the token
        localStorage.setItem('auth_token', token);
        
        // Fetch user data
        await checkAuth();
        
        // Redirect to original location or dashboard
        const redirectTo = localStorage.getItem('oauth_redirect') || '/';
        localStorage.removeItem('oauth_redirect');
        navigate(redirectTo);
      } else {
        // No token and no error - something went wrong
        navigate('/login?error=Authentication failed');
      }
    };

    handleCallback();
  }, [searchParams, checkAuth, navigate]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh' 
    }}>
      <div>Completing authentication...</div>
    </div>
  );
}

export default OAuthCallback;