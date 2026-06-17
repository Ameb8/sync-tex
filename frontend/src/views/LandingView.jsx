import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import './LandingView.css';

const landingImage = '/landing-image.png';

function SyncTeXMark({ as: Component = 'span', className = '' }) {
  return (
    <Component className={`synctex-mark ${className}`.trim()}>
      SyncTe<span className="synctex-mark-x">X</span>
    </Component>
  );
}

function FeatureIcon({ type }) {
  if (type === 'collab') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M11.5 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z" />
        <path d="M20.5 19.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" />
        <path d="M3.5 27c.7-4.4 3.5-6.7 8-6.7s7.3 2.3 8 6.7" />
        <path d="M18.5 23.2c1-.6 2.2-.9 3.5-.9 3.7 0 6 1.8 6.6 5.2" />
      </svg>
    );
  }

  if (type === 'ai') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M16 3.5 18.9 12l8.6 4-8.6 4L16 28.5 13.1 20l-8.6-4 8.6-4L16 3.5Z" />
        <path d="m24.5 3.5 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
      </svg>
    );
  }

  if (type === 'hosted') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M8 13.5a8 8 0 0 1 15.3-3.3A6.8 6.8 0 0 1 24 23.8H9.2A5.7 5.7 0 0 1 8 13.5Z" />
        <path d="M16 16.5v6" />
        <path d="M13.4 19.1 16 16.5l2.6 2.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M7 7.5h18" />
      <path d="M7 14h18" />
      <path d="M7 20.5h10" />
      <path d="M22.5 19.5 26 23l-6 6h-3.5v-3.5l6-6Z" />
    </svg>
  );
}

function FeatureCard({ icon, title, children }) {
  return (
    <article className="landing-feature-card">
      <div className="landing-feature-icon">
        <FeatureIcon type={icon} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function LandingView() {
  useEffect(() => {
    document.title = 'SyncTeX - Collaborative LaTeX Editor';

    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.appendChild(description);
    }
    description.setAttribute(
      'content',
      'Real-time collaborative LaTeX editing in your browser. Write and share documents with your team, hosted on your own server.'
    );

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', 'https://sync-tex.com/');
  }, []);

  return (
    <main className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <SyncTeXMark as="p" className="landing-logotype" />
            <h1 id="landing-title">Collaborative LaTeX editing, together.</h1>
            <p>
              Write and share LaTeX documents with your team, all in your browser, hosted on
              your own server.
            </p>
            <div className="landing-hero-actions">
              <Link className="landing-button landing-button-primary" to="/login">
                Get Started
              </Link>
              <a className="landing-button landing-button-secondary" href="#features">
                See how it works
              </a>
            </div>
          </div>

          <div className="landing-hero-visual" aria-label="SyncTeX editor preview">
            <img src={landingImage} alt="SyncTeX editor showing a LaTeX document and file tree" />
          </div>
        </div>
      </section>

      <section id="features" className="landing-section landing-section-surface">
        <div className="landing-feature-grid">
          <FeatureCard icon="collab" title="Real-Time Collaboration">
            Edit the same document simultaneously with your team. Changes appear instantly for
            everyone, with no refreshing and no conflicts.
          </FeatureCard>
          <FeatureCard icon="ai" title="AI Writing Assistant">
            An integrated AI assistant helps you draft, fix, and explain LaTeX inside the editor
            without switching tabs.
          </FeatureCard>
          <FeatureCard icon="hosted" title="Centrally Hosted">
            Your documents live on a dedicated server instead of scattered across personal
            machines. Access your work from anywhere with one account.
          </FeatureCard>
          <FeatureCard icon="latex" title="Full LaTeX Workspace">
            Keep source files, collaboration, and project structure together in a browser-based
            workspace built for serious documents.
          </FeatureCard>
        </div>
      </section>

      <section className="landing-section landing-showcase" aria-labelledby="showcase-title">
        <div className="landing-narrow">
          <h2 id="showcase-title">Everything you need, in one place.</h2>
          <p>
            SyncTeX brings together a full LaTeX editor, real-time collaboration, and an AI
            assistant without requiring any local installation.
          </p>
          <img src={landingImage} alt="Full SyncTeX editor interface" />
        </div>
      </section>

      <section className="landing-section landing-section-surface landing-audience" aria-labelledby="audience-title">
        <div className="landing-prose">
          <h2 id="audience-title">Built for researchers, academics, and teams.</h2>
          <p>
            If you have used Overleaf, SyncTeX will feel familiar. The difference is where your
            work lives: SyncTeX is hosted by your institution, lab, or team, not a third-party
            cloud service. Your documents, your server, your control.
          </p>
          <p>
            It is a good fit for research groups that collaborate on papers, students and advisors
            sharing thesis drafts, and anyone who prefers keeping their work on infrastructure
            they own.
          </p>
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Ready to start writing?</h2>
        <Link className="landing-button landing-button-inverse" to="/login">
          Log In to SyncTeX
        </Link>
      </section>

      <footer className="landing-footer">
        <span>© 2026 SyncTeX</span>
        <span aria-hidden="true">·</span>
        <Link to="/privacy">Privacy Policy</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms">Terms of Service</Link>
      </footer>
    </main>
  );
}

export default LandingView;
