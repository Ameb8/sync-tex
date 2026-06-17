import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import privacyMarkdown from '../../../docs/legal/privacy.md?raw';
import tosMarkdown from '../../../docs/legal/tos.md?raw';
import './LegalView.css';

const documents = {
  privacy: {
    markdown: privacyMarkdown,
  },
  terms: {
    markdown: tosMarkdown,
  },
};

function LegalView({ document }) {
  const legalDocument = documents[document] ?? documents.privacy;

  return (
    <div className="legal-view">
      <header className="legal-header">
        <Link to="/" className="legal-brand">
          SyncTeX
        </Link>
        <nav className="legal-nav" aria-label="Legal pages">
          <Link to="/privacy" className={document === 'privacy' ? 'active' : ''}>
            Privacy
          </Link>
          <Link to="/terms" className={document === 'terms' ? 'active' : ''}>
            Terms
          </Link>
          <Link to="/login" className="legal-login-link">
            Log In
          </Link>
        </nav>
      </header>

      <main className="legal-main">
        <article className="legal-document">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {legalDocument.markdown}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}

export default LegalView;
