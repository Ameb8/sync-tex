import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import DashboardView from './views/DashboardView';
import LoginView from './views/LoginView';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';



function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<DashboardView />} />
        </Routes>
      </div>
    </Router>
  );
}
 
export default App;

/*
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as idb from 'y-indexeddb';
import './App.css';

const API_HOST = import.meta.env.VITE_API_HOST || window.location.hostname;
const DOC_ID = import.meta.env.VITE_DOC_ID || 'collab-doc';

function App() {
  const [status, setStatus] = useState('connecting');
  const [editorValue, setEditorValue] = useState('');
  const [userCount, setUserCount] = useState(0);
  
  const ydocRef = useRef(null);
  const ytextRef = useRef(null);
  const providerRef = useRef(null);
  const editorRef = useRef(null);
  const isRemoteUpdateRef = useRef(false);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${API_HOST}/ws`;

  useEffect(() => {
    // Initialize Yjs document
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    // Setup IndexedDB persistence
    new idb.IndexeddbPersistence(DOC_ID, ydoc);

    // Setup WebSocket provider
    let provider;
    try {
      provider = new WebsocketProvider(wsUrl, DOC_ID, ydoc);
      providerRef.current = provider;

      // Track connection status
      provider.on('status', ({ status }) => {
        console.log('Provider status:', status);
        setStatus(status);
      });

      // Setup awareness for user presence
      if (provider.awareness) {
        const awareness = provider.awareness;
        
        awareness.setLocalState({
          user: {
            name: `User-${Math.random().toString(36).slice(2, 7)}`,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`
          }
        });

        awareness.on('change', () => {
          const states = Array.from(awareness.getStates().values()).filter(s => s?.user);
          setUserCount(states.length);
          console.log('Connected users:', states.length);
        });
      }

    } catch (err) {
      console.error('Failed to create provider:', err);
      setStatus('error');
    }

    // Observe CRDT updates
    const observer = () => {
      const text = ytext.toString();
      
      if (editorRef.current && editorRef.current.value !== text) {
        isRemoteUpdateRef.current = true;
        
        // Preserve cursor position
        const cursorPos = editorRef.current.selectionStart;
        setEditorValue(text);
        
        // Restore cursor after React updates
        setTimeout(() => {
          if (editorRef.current) {
            const newPos = Math.min(cursorPos, text.length);
            editorRef.current.selectionStart = newPos;
            editorRef.current.selectionEnd = newPos;
          }
          isRemoteUpdateRef.current = false;
        }, 0);
        
        console.log('Remote update:', text.length, 'chars');
      }
    };

    ytext.observe(observer);

    // Load initial state
    setEditorValue(ytext.toString());

    // Debug logging
    ydoc.on('update', (update, origin) => {
      console.log('CRDT update:', {
        origin: origin ? 'remote' : 'local',
        size: update.length,
        text: ytext.toString().slice(0, 50)
      });
    });

    console.log('Editor initialized. Connecting to:', wsUrl);
    console.log('API Host:', API_HOST);
    console.log('Doc ID:', DOC_ID);

    // Cleanup
    return () => {
      ytext.unobserve(observer);
      if (provider) {
        provider.destroy();
      }
      ydoc.destroy();
    };
  }, []);

  const handleEditorChange = (e) => {
    if (isRemoteUpdateRef.current) return;

    const newText = e.target.value;
    const ytext = ytextRef.current;
    const oldText = ytext.toString();

    if (newText !== oldText) {
      ydocRef.current.transact(() => {
        ytext.delete(0, oldText.length);
        ytext.insert(0, newText);
      });
      
      console.log('Local edit:', newText.length, 'chars');
    }

    setEditorValue(newText);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>SyncTex</h1>
        <p>Collaboration Mode</p>
        <div className={`status ${status === 'connected' ? 'connected' : 'disconnected'}`}>
          <div className="status-dot"></div>
          <span>
            {status === 'connected' ? '✓ Connected' : 
             status === 'connecting' ? 'Connecting...' : 
             '✗ Disconnected'}
          </span>
        </div>
        {userCount > 0 && (
          <div className="user-count">
            {userCount} {userCount === 1 ? 'user' : 'users'} online
          </div>
        )}
      </div>

      <div className="content">
        <div className="config">
          <div className="config-item">
            <span className="config-label">Server:</span>
            <span className="config-value">{wsUrl}/{DOC_ID}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Document:</span>
            <span className="config-value">{DOC_ID}</span>
          </div>
        </div>

        <div className="editor-wrapper">
          <label className="editor-label">Document Content</label>
          <textarea
            ref={editorRef}
            id="editor"
            value={editorValue}
            onChange={handleEditorChange}
            placeholder="Start typing... Changes will sync to other connected clients."
            disabled={status !== 'connected'}
            style={{ opacity: status === 'connected' ? '1' : '0.7' }}
          />
        </div>


      </div>
    </div>
  );
}

export default App;
*/