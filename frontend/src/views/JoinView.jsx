import { useEffect } from 'react';
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import { acceptCollaboratorLink } from '../api/collaborators';
import { useAuth } from '../contexts/AuthContext';

export default function JoinView() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { loading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAuthenticated) {
      const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
      navigate(`/login?redirect=${redirect}`, { replace: true });
      return;
    }

    const token = searchParams.get('token');

    if (!token) {
      navigate('/dashboard?join_error=missing_token');
      return;
    }

    acceptCollaboratorLink(token)
      .then(data => {
        navigate(`/project/${data.project_id}`);
      })
      .catch(() => {
        navigate('/dashboard?join_error=invalid_or_expired');
      });
  }, [loading, isAuthenticated, location.pathname, location.search, navigate, searchParams]);

  return <div style={{ padding: '2rem' }}>Joining project...</div>;
}
