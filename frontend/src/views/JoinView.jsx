import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { acceptCollaboratorLink } from '../api/collaborators';

export default function JoinView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      navigate('/?join_error=missing_token');
      return;
    }

    acceptCollaboratorLink(token)
      .then(data => {
        navigate(`/project/${data.project_id}`);
      })
      .catch(() => {
        navigate('/?join_error=invalid_or_expired');
      });
  }, []);

  return <div style={{ padding: '2rem' }}>Joining project...</div>;
}