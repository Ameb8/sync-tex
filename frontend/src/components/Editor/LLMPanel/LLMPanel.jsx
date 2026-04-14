import { useState, useEffect, useCallback } from 'react';
import {
  listLLMKeys,
  upsertLLMKey,
  deleteLLMKey,
  listProviders,
} from '../../../api/llm';
import './LLMPanel.css';

/* ─── tiny icons ──────────────────────────────────────────── */
const IconKey = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
    <circle cx="8" cy="9" r="4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M11.5 11.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M15 15.5V17h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9.5h5L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconChevron = ({ open }) => (
  <svg
    width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
  >
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ─── provider meta ──────────────────────────────────────── */
const PROVIDER_META = {
  anthropic: { label: 'Anthropic', color: '#c97a4e', placeholder: 'sk-ant-api03-…' },
  openai:    { label: 'OpenAI',    color: '#19c37d', placeholder: 'sk-…' },
  gemini:    { label: 'Google Gemini', color: '#4285f4', placeholder: 'AIza…' },
  mistral:   { label: 'Mistral',   color: '#ff7000', placeholder: 'mis-…' },
  cohere:    { label: 'Cohere',    color: '#8b5cf6', placeholder: 'co-…' },
};

function getMeta(id) {
  return PROVIDER_META[id] ?? { label: id, color: '#6b7280', placeholder: 'Paste API key…' };
}

/* ─── ProviderRow ─────────────────────────────────────────── */
function ProviderRow({ provider, hasKey, onSaved, onDeleted }) {
  const meta = getMeta(provider);
  const [open, setOpen] = useState(false);
  const [keyVal, setKeyVal] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | saved | deleting | error
  const [errMsg, setErrMsg] = useState('');

  const handleSave = useCallback(async () => {
    if (!keyVal.trim()) return;
    setStatus('saving');
    setErrMsg('');
    try {
      await upsertLLMKey(provider, keyVal.trim());
      setStatus('saved');
      setKeyVal('');
      onSaved();
      setTimeout(() => { setStatus('idle'); setOpen(false); }, 1200);
    } catch (e) {
      setStatus('error');
      setErrMsg(e.message ?? 'Failed to save key');
    }
  }, [provider, keyVal, onSaved]);

  const handleDelete = useCallback(async () => {
    setStatus('deleting');
    try {
      await deleteLLMKey(provider);
      onDeleted();
    } catch (e) {
      setStatus('error');
      setErrMsg(e.message ?? 'Failed to delete key');
    }
  }, [provider, onDeleted]);

  const toggleOpen = () => {
    setOpen(o => !o);
    setStatus('idle');
    setErrMsg('');
    setKeyVal('');
  };

  return (
    <div className={`llm-provider-row ${hasKey ? 'has-key' : ''} ${open ? 'expanded' : ''}`}>
      <div className="llm-provider-header" onClick={toggleOpen} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && toggleOpen()}>
        <span className="llm-provider-dot" style={{ background: meta.color }} />
        <span className="llm-provider-label">{meta.label}</span>

        {hasKey && (
          <span className="llm-key-badge">
            <IconCheck /> key saved
          </span>
        )}

        <span className="llm-provider-actions" onClick={e => e.stopPropagation()}>
          {hasKey && (
            <button
              className="llm-icon-btn danger"
              title="Delete key"
              disabled={status === 'deleting'}
              onClick={handleDelete}
            >
              <IconTrash />
            </button>
          )}
        </span>

        <button className="llm-icon-btn chevron-btn" title={open ? 'Collapse' : (hasKey ? 'Update key' : 'Add key')}>
          {hasKey && !open ? <IconEdit /> : <IconChevron open={open} />}
        </button>
      </div>

      {open && (
        <div className="llm-provider-form">
          <label className="llm-form-label">
            {hasKey ? 'Replace API key' : 'Add API key'}
          </label>
          <div className="llm-key-input-row">
            <input
              type="password"
              className="llm-key-input"
              placeholder={meta.placeholder}
              value={keyVal}
              onChange={e => { setKeyVal(e.target.value); setStatus('idle'); }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              className={`llm-save-btn ${status}`}
              disabled={!keyVal.trim() || status === 'saving' || status === 'saved'}
              onClick={handleSave}
            >
              {status === 'saving' ? 'Saving…' :
               status === 'saved'  ? <><IconCheck /> Saved</> :
               hasKey ? 'Update' : 'Save'}
            </button>
          </div>
          {status === 'error' && (
            <p className="llm-form-error">{errMsg}</p>
          )}
          <p className="llm-form-hint">
            Keys are stored encrypted server-side and never returned in full.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── LLMPanel ────────────────────────────────────────────── */
export default function LLMPanel() {
  const [providers, setProviders] = useState([]);
  const [keyMap, setKeyMap]       = useState({}); // provider → true
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [pvRes, keyRes] = await Promise.all([listProviders(), listLLMKeys()]);
      setProviders(pvRes.providers ?? []);
      const km = {};
      for (const k of (keyRes.keys ?? [])) km[k.provider] = true;
      setKeyMap(km);
    } catch (e) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const savedCount = Object.keys(keyMap).length;

  return (
    <div className="llm-panel">
      {/* header */}
      <div className="llm-panel-header">
        <div className="llm-panel-title">
          <IconKey />
          <span>API Keys</span>
        </div>
        {!loading && (
          <span className="llm-panel-subtitle">
            {savedCount === 0
              ? 'No providers configured'
              : `${savedCount} provider${savedCount > 1 ? 's' : ''} configured`}
          </span>
        )}
      </div>

      {/* body */}
      <div className="llm-panel-body">
        {loading && (
          <div className="llm-loading">
            <div className="llm-spinner" />
            <span>Loading providers…</span>
          </div>
        )}

        {error && !loading && (
          <div className="llm-error-state">
            <p>{error}</p>
            <button className="llm-retry-btn" onClick={load}>Retry</button>
          </div>
        )}

        {!loading && !error && (
          <div className="llm-provider-list">
            <p className="llm-section-label">Available providers</p>
            {providers.map(p => (
              <ProviderRow
                key={p}
                provider={p}
                hasKey={!!keyMap[p]}
                onSaved={load}
                onDeleted={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}