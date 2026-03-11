import { useState, useEffect, useRef } from 'react';
import { Settings, FolderOpen, Image as ImageIcon, Play, FileDown, FileUp, Copy, Check, Trash2, StopCircle } from 'lucide-react';
import { saveImage, getImage, clearImages, saveState, loadState } from './services/storage';
import { generateGrokPrompt } from './services/api';
import { exportProjectToZip, importProjectFromZip } from './utils';
import './App.css';

function App() {
  const [images, setImages] = useState([]); // { id, name, url, file, prompt, status: 'pending' | 'processing' | 'done' | 'error' }
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-pro');
  const [contextPrompt, setContextPrompt] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const isCancelledRef = useRef(false);

  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);
  const zipInputRef = useRef(null);

  const [isStateLoaded, setIsStateLoaded] = useState(false);

  // Load state on mount
  useEffect(() => {
    const state = loadState();
    if (state) {
      if (state.apiKey) setApiKey(state.apiKey);
      if (state.model) setModel(state.model);
      if (state.contextPrompt) setContextPrompt(state.contextPrompt);
      if (state.images) {
        const resetImages = state.images.map(img =>
          img.status === 'processing' ? { ...img, status: 'pending' } : img
        );
        setImages(resetImages);
      }
    }
    setIsStateLoaded(true);
  }, []);

  // Save state on changes
  useEffect(() => {
    if (isStateLoaded) {
      saveState({ apiKey, model, contextPrompt, images: images.map(img => ({ ...img, file: null, url: null })) });
    }
  }, [apiKey, model, contextPrompt, images, isStateLoaded]);

  // Load images from IndexedDB when rendering and URL is missing
  const [base64Cache, setBase64Cache] = useState({});
  useEffect(() => {
    const loadCache = async () => {
      const cache = {};
      for (const img of images) {
        if (!cache[img.id]) {
          const data = await getImage(img.id);
          if (data) cache[img.id] = data;
        }
      }
      setBase64Cache(cache);
    };
    if (images.length > 0) loadCache();
  }, [images]);

  const handleFolderSelect = async (e) => {
    const files = Array.from(e.target.files);

    // Filter only images
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    // Clear old state
    await clearImages();

    // Sort files numerically e.g. 001, 002, 003
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const newImages = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const id = `img_${Date.now()}_${i}`;

      // Read to base64 for IDB and scale down to avoid Token Limit
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDim = 1024;

            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          };
          img.onerror = () => {
            // Fallback for non-standard formats like DNG
            resolve(e.target.result);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });

      await saveImage(id, base64);

      // Add to state
      newImages.push({
        id,
        name: file.name,
        prompt: '',
        status: 'pending',
        file: file, // ephemeral
        url: URL.createObjectURL(file) // ephemeral
      });
    }

    setImages(newImages);
    setIsCancelled(false);
    isCancelledRef.current = false;
  };

  const cancelProcessing = () => {
    setIsCancelled(true);
    isCancelledRef.current = true;
    setIsProcessing(false);
  };

  const processQueue = async () => {
    if (!apiKey) {
      alert("Please set your API Key in Settings first.");
      setShowSettings(true);
      return;
    }

    setIsProcessing(true);
    setIsCancelled(false);
    isCancelledRef.current = false;

    // Use a while loop with ref to make sure we always have fresh state
    for (let i = 0; i < images.length; i++) {
      if (isCancelledRef.current) break; // Check cancellation flag

      const img = images[i];
      if (img.status === 'done') continue;

      setImages(prev => {
        const next = [...prev];
        next[i].status = 'processing';
        return next;
      });

      try {
        const b64 = base64Cache[img.id] || await getImage(img.id);
        const prompt = await generateGrokPrompt(apiKey, model, b64, contextPrompt);

        setImages(prev => {
          const next = [...prev];
          next[i].status = 'done';
          next[i].prompt = prompt;
          return next;
        });

      } catch (error) {
        console.error("Error processing " + img.name, error);
        setImages(prev => {
          const next = [...prev];
          next[i].status = 'error';
          return next;
        });
      }

      // small delay to prevent rapid-fire blocking
      await new Promise(r => setTimeout(r, 500));
    }

    setIsProcessing(false);
  };

  const copyAllPrompts = () => {
    const text = images
      .map(img => img.prompt.trim())
      .filter(p => p.length > 0)
      .join('\n\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleZipUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsProcessing(true);
      const newState = await importProjectFromZip(file);
      if (newState.apiKey) setApiKey(newState.apiKey);
      if (newState.model) setModel(newState.model);
      if (newState.contextPrompt) setContextPrompt(newState.contextPrompt);
      if (newState.images) setImages(newState.images);

      if (zipInputRef.current) zipInputRef.current.value = '';
    } catch (err) {
      alert("Failed to load project: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearProject = async () => {
    if (confirm("Are you sure you want to clear all images and prompts?")) {
      await clearImages();
      setImages([]);
      setBase64Cache({});
    }
  };

  return (
    <div className="app-container">
      <header className="glass-header app-header">
        <div className="logo">
          <ImageIcon className="accent-icon" />
          <h1>Grok Director</h1>
        </div>
        <button className="btn" onClick={() => setShowSettings(!showSettings)}>
          <Settings size={18} /> Settings
        </button>
      </header>

      {showSettings && (
        <div className="settings-panel glass-panel animate-fade-in">
          <h2>Configuration</h2>
          <div className="form-group">
            <label>EzAI API Key</label>
            <input
              type="password"
              className="input-base"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div className="form-group">
            <label>Model</label>
            <select className="input-base" value={model} onChange={e => setModel(e.target.value)}>
              <option value="gemini-3-flash">Gemini 3 Flash (Fast & Vision)</option>
              <option value="gemini-3-pro">Gemini 3 Pro</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
              <option value="grok-code-fast-1">Grok Fast</option>
              <option value="gpt-5.4">GPT-5.4</option>
            </select>
          </div>
        </div>
      )}

      <main className="main-content">
        <aside className="sidebar glass-panel">
          <h3>Controls</h3>

          <input
            type="file"
            webkitdirectory="true"
            directory="true"
            ref={fileInputRef}
            onChange={handleFolderSelect}
            style={{ display: 'none' }}
          />
          <input
            type="file"
            accept=".zip"
            ref={zipInputRef}
            onChange={handleZipUpload}
            style={{ display: 'none' }}
          />

          <div className="action-buttons">
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Global Context (Tone, Motion, Emotion)</label>
              <textarea
                className="input-base"
                rows="4"
                style={{ resize: 'vertical' }}
                placeholder="E.g., Soft morning light, gentle breeze, calm atmosphere..."
                value={contextPrompt}
                onChange={(e) => setContextPrompt(e.target.value)}
              />
            </div>

            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <FolderOpen size={18} /> Load Folder
            </button>
            <button className="btn btn-primary" onClick={processQueue} disabled={isProcessing || images.length === 0}>
              <Play size={18} /> Generate Prompts
            </button>
            <button className="btn" onClick={cancelProcessing} disabled={!isProcessing} style={{ color: "var(--danger-color)" }}>
              <StopCircle size={18} /> Stop
            </button>

            <hr className="divider" />

            <button className="btn" onClick={copyAllPrompts} disabled={images.length === 0}>
              {copied ? <Check size={18} /> : <Copy size={18} />} Copy All
            </button>
            <button className="btn" onClick={() => exportProjectToZip({ apiKey, model, contextPrompt, images }, base64Cache)} disabled={images.length === 0}>
              <FileDown size={18} /> Save ZIP
            </button>
            <button className="btn" onClick={() => zipInputRef.current?.click()} disabled={isProcessing}>
              <FileUp size={18} /> Load ZIP
            </button>
            <button className="btn danger" onClick={clearProject} disabled={isProcessing || images.length === 0}>
              <Trash2 size={18} /> Clear Project
            </button>
          </div>

          {images.length > 0 && (
            <div className="stats">
              <p>Total: {images.length}</p>
              <p>Done: {images.filter(i => i.status === 'done').length}</p>
              <p>Pending: {images.filter(i => ['pending', 'processing', 'error'].includes(i.status)).length}</p>
            </div>
          )}
        </aside>

        <section className="gallery">
          {images.length === 0 ? (
            <div className="empty-state">
              <FolderOpen size={48} className="empty-icon animate-pulse" />
              <h3>No Images Loaded</h3>
              <p>Click "Load Folder" to select a folder containing images (001 - 00n).</p>
            </div>
          ) : (
            images.map(img => (
              <div key={img.id} className={`gallery-item glass-panel status-${img.status}`}>
                <div className="image-wrapper">
                  <img src={img.url || base64Cache[img.id]} alt={img.name} />
                  <div className="image-meta">
                    <span className="filename">{img.name}</span>
                    <span className={`status-badge ${img.status}`}>{img.status}</span>
                  </div>
                </div>
                <div className="prompt-wrapper">
                  <textarea
                    className="input-base prompt-area"
                    value={img.prompt}
                    onChange={(e) => {
                      const newImages = [...images];
                      const target = newImages.find(i => i.id === img.id);
                      if (target) target.prompt = e.target.value;
                      setImages(newImages);
                    }}
                    placeholder="Prompt will appear here..."
                  />
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
