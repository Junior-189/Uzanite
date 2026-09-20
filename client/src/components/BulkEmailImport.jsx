import { useState, useRef } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';

// Minimal CSV/JSON email parser for client-side preview (mirrors server logic).
function parseEntries(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let entries = [];
  const looksLikeJson = text.startsWith('[') || text.startsWith('{');
  if (looksLikeJson) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    entries = arr.map((e) => (e && typeof e === 'object' ? e : { email: e }))
      .map((e) => ({ email: String(e.email || e.Email || '').trim(), name: String(e.name || e.Name || '').trim() }));
  } else {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const emailIdx = header.indexOf('email');
    const nameIdx = header.indexOf('name');
    const hasHeader = emailIdx !== -1;
    const start = hasHeader ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const email = (emailIdx !== -1 ? cols[emailIdx] : cols[0]) || '';
      const name = nameIdx !== -1 ? (cols[nameIdx] || '') : (cols[1] || '');
      entries.push({ email: email.trim(), name: name.trim() });
    }
  }
  const seen = new Set();
  return entries
    .filter((e) => EMAIL_RE.test(e.email))
    .filter((e) => {
      const k = e.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export default function BulkEmailImport({ onImported }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [mode, setMode] = useState('paste'); // 'paste' | 'file'
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
    setPreview(null);
  };

  const handlePreview = () => {
    try {
      const entries = parseEntries(text);
      setPreview(entries);
    } catch {
      showToast(t('broadcast.import_invalid_json'), 'error');
    }
  };

  const handleImport = async () => {
    if (!text.trim()) return;
    if (!confirm(t('broadcast.import_confirm', { count: preview?.length || 0 }))) return;
    setImporting(true);
    try {
      const res = await api.post('/broadcast/import-emails', { data: text });
      if (res.success) {
        showToast(res.message || t('broadcast.imported'), 'success');
        setText('');
        setPreview(null);
        if (onImported) onImported();
      } else {
        showToast(res.error || t('broadcast.import_failed'), 'error');
      }
    } catch (err) {
      showToast(err.error || t('broadcast.import_failed'), 'error');
    } finally {
      setImporting(false);
    }
  };

  const sample = 'email,name\njohn@example.com,John\nmary@example.com,Mary';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-4 border-l-4 border-l-primary-500">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">
        <i className="fas fa-file-import text-primary-600 mr-2"></i>
        {t('broadcast.import_title')}
      </h3>
      <p className="text-sm text-gray-500 mb-4">{t('broadcast.import_desc')}</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
            mode === 'paste' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          <i className="fas fa-paste mr-1"></i> {t('broadcast.import_paste')}
        </button>
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
            mode === 'file' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          <i className="fas fa-upload mr-1"></i> {t('broadcast.import_file')}
        </button>
      </div>

      {mode === 'paste' ? (
        <textarea
          className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm font-mono focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors resize-none"
          rows={7}
          value={text}
          onChange={(e) => { setText(e.target.value); setPreview(null); }}
          placeholder={sample}
        />
      ) : (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json,.txt"
            onChange={handleFile}
            className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-primary-600 file:text-white file:cursor-pointer hover:file:bg-primary-700 mb-3"
          />
          {text && (
            <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap">
              {text.slice(0, 2000)}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          onClick={handlePreview}
          disabled={!text.trim()}
        >
          <i className="fas fa-eye"></i> {t('broadcast.import_preview')}
        </button>
        <button
          className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleImport}
          disabled={importing || !text.trim()}
        >
          <i className="fas fa-file-import"></i>
          {importing ? t('broadcast.importing') : t('broadcast.import_button')}
        </button>
      </div>

      {preview && (
        <div className="mt-4">
          <div className="text-sm text-gray-600 mb-2">
            {t('broadcast.import_preview_count', { count: preview.length })}
          </div>
          <div className="max-h-48 overflow-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
            {preview.slice(0, 50).map((e, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-gray-900 truncate">{e.email}</span>
                {e.name && <span className="text-gray-400 text-xs ml-2 truncate">{e.name}</span>}
              </div>
            ))}
            {preview.length > 50 && (
              <div className="px-3 py-2 text-xs text-gray-400">+{preview.length - 50} more…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
