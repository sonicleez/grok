import { useState, useEffect, useRef } from 'react';
import { Settings, FolderOpen, Image as ImageIcon, Play, FileDown, FileUp, Copy, Check, Trash2, StopCircle, RotateCcw, ChevronDown } from 'lucide-react';
import { saveImage, getImage, clearImages, saveState, loadState } from './services/storage';
import {
  DEFAULT_VISION_MODEL,
  VISION_MODEL_OPTIONS,
  generateGrokPrompt,
  isSupportedVisionModel,
  isVisionProviderConfigured
} from './services/api';
import { exportProjectToZip, importProjectFromZip } from './utils';
import { SKILL_TEMPLATES, DEFAULT_SKILL_ID, getTemplateById } from './skillTemplates';
import './App.css';

function App() {
  const [images, setImages] = useState([]); // { id, name, url, file, prompt, status: 'pending' | 'processing' | 'done' | 'error' }
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_VISION_MODEL);
  const [contextPrompt, setContextPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState(DEFAULT_SKILL_ID);
  const [systemPrompt, setSystemPrompt] = useState(getTemplateById(DEFAULT_SKILL_ID).systemPrompt);
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const isCancelledRef = useRef(false);
  const [queueError, setQueueError] = useState(null); // { message, retryAfter }

  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);
  const zipInputRef = useRef(null);

  const [isStateLoaded, setIsStateLoaded] = useState(false);

  // Load state on mount
  useEffect(() => {
    const state = loadState();
    if (state) {
      if (state.apiKey) setApiKey(state.apiKey);
      if (isSupportedVisionModel(state.model)) {
        setModel(state.model);
      } else {
        setModel(DEFAULT_VISION_MODEL);
      }
      if (state.contextPrompt) setContextPrompt(state.contextPrompt);
      if (state.negativePrompt) setNegativePrompt(state.negativePrompt);
      if (state.selectedSkillId) setSelectedSkillId(state.selectedSkillId);
      if (state.systemPrompt) setSystemPrompt(state.systemPrompt);
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
      saveState({ apiKey, model, contextPrompt, negativePrompt, selectedSkillId, systemPrompt, images: images.map(img => ({ ...img, file: null, url: null })) });
    }
  }, [images, apiKey, model, contextPrompt, negativePrompt, selectedSkillId, systemPrompt, isStateLoaded]);

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
    if (!isVisionProviderConfigured({ apiKey, model })) {
      setShowSettings(true);
      setQueueError({
        message: 'Ollama Cloud API key and vision model are required before generating prompts.',
        retryAfter: null
      });
      return;
    }

    setIsProcessing(true);
    setIsCancelled(false);
    setQueueError(null);
    isCancelledRef.current = false;

    for (let i = 0; i < images.length; i++) {
      if (isCancelledRef.current) break;

      const img = images[i];
      if (img.status === 'done') continue;

      setImages(prev => {
        const next = [...prev];
        next[i].status = 'processing';
        return next;
      });

      try {
        const b64 = base64Cache[img.id] || await getImage(img.id);
        const prompt = await generateGrokPrompt(apiKey, model, b64, contextPrompt, systemPrompt, negativePrompt);

        setImages(prev => {
          const next = [...prev];
          next[i].status = 'done';
          next[i].prompt = prompt;
          return next;
        });

      } catch (error) {
        console.error('Error processing ' + img.name, error);
        setImages(prev => {
          const next = [...prev];
          next[i].status = 'error';
          return next;
        });

        // Stop immediately for provider-level errors; retrying every image will fail the same way.
        if (error.isRateLimit || error.isUnsupportedImageInput || error.isProviderMissing || error.isAuthError) {
          isCancelledRef.current = true;
          setQueueError({
            message: error.userMessage || error.message,
            retryAfter: error.retryAfter,
          });
          break;
        }
      }

      // Delay between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
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

      {/* ── Error Banner ─────────────────────────────────── */}
      {queueError && (
        <div className="error-banner">
          <div className="error-banner-content">
            <span className="error-banner-icon">⚠️</span>
            <div className="error-banner-body">
              <strong>
                {queueError.retryAfter ? '429 — Rate Limited / Auth Failed' : 'API Request Failed'}
              </strong>
              <p>{queueError.message}</p>
              {queueError.retryAfter && (
                <p className="error-retry-hint">
                  Wait <strong>{queueError.retryAfter}s</strong> then verify the provider settings before retrying.
                </p>
              )}
            </div>
            <button className="error-banner-close" onClick={() => setQueueError(null)}>✕</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="settings-panel glass-panel animate-fade-in">
          <h2>Configuration</h2>

          {/* --- Provider --- */}
          <div className="settings-section">
            <div className="form-group">
              <label>Ollama Cloud API Key</label>
              <input
                type="password"
                className="input-base"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="ollama API key"
              />
            </div>
            <div className="form-group">
              <label>Vision Model</label>
              <select className="input-base" value={model} onChange={e => setModel(e.target.value)}>
                {VISION_MODEL_OPTIONS.map(option => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="provider-empty-state">
              <strong>Ollama Cloud</strong>
              <p>Uses Ollama's OpenAI-compatible cloud API. Gemini 3 Flash Preview passed live image-input testing; Kimi K2.6 and Qwen3.6 are shown only as unavailable notes.</p>
              <div className="provider-links">
                <a href="https://ollama.com/pricing" target="_blank" rel="noreferrer">
                  Buy directly from Ollama Cloud
                </a>
                <a href="https://t.me/+xeyMhj4X40dlYWM1" target="_blank" rel="noreferrer">
                  Buy 20% cheaper via Telegram group
                </a>
              </div>
            </div>
          </div>

          {/* --- Skill / Platform --- */}
          <div className="settings-divider" />
          <div className="settings-section">
            <div className="skill-header">
              <h3 className="settings-section-title">🎯 Skill Template</h3>
              <span className="skill-hint">Pick platform → edit prompt below</span>
            </div>
            <div className="skill-presets">
              {SKILL_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  className={`skill-btn ${selectedSkillId === tpl.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSkillId(tpl.id);
                    setSystemPrompt(tpl.systemPrompt);
                  }}
                >
                  {tpl.emoji} {tpl.label}
                </button>
              ))}
            </div>

            <div className="form-group" style={{ marginTop: '14px' }}>
              <div className="system-prompt-label-row">
                <label>System Prompt</label>
                <button
                  className="btn-icon-sm"
                  title="Reset to template default"
                  onClick={() => setSystemPrompt(getTemplateById(selectedSkillId).systemPrompt)}
                >
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
              <textarea
                className="input-base system-prompt-textarea"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
                placeholder="Enter system prompt for the AI model..."
              />
            </div>
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
                rows="3"
                style={{ resize: 'vertical' }}
                placeholder="E.g., Soft morning light, gentle breeze..."
                value={contextPrompt}
                onChange={(e) => setContextPrompt(e.target.value)}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Negative Context (Do NOT include)</label>
              <textarea
                className="input-base"
                rows="2"
                style={{ resize: 'vertical', border: '1px solid var(--danger-color)' }}
                placeholder="E.g., Morphing, moving camera, text, people..."
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </div>

            <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <FolderOpen size={18} /> Load Folder
            </button>
            <button className="btn btn-primary" onClick={processQueue} disabled={isProcessing || images.length === 0 || !isVisionProviderConfigured({ apiKey, model })}>
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
