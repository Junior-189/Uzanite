import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import BulkEmailImport from '../components/BulkEmailImport';

const TABS = [
  { key: 'inbox', label: 'email.tab_inbox', icon: 'fa-inbox' },
  { key: 'contacts', label: 'email.tab_contacts', icon: 'fa-address-book' },
  { key: 'compose', label: 'email.tab_compose', icon: 'fa-paper-plane' },
];

function Avatar({ name, email, icon }) {
  const letter = (name || email || '?').charAt(0).toUpperCase();
  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0 shadow-sm">
      {icon ? <i className={`fas ${icon}`}></i> : letter}
    </div>
  );
}

function Card({ className = '', children }) {
  return (
    <div className={`bg-white/80 backdrop-blur rounded-2xl shadow-sm ring-1 ring-gray-100 border border-gray-100 ${className}`}>
      {children}
    </div>
  );
}

function InboxTab({ t }) {
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/broadcast/sent').then((r) => {
      if (r.success) setLogs(r.logs || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100dvh-260px)] min-h-[400px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-full"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-5 h-[calc(100dvh-260px)] min-h-[420px]">
      <Card className="w-full md:w-80 min-w-0 md:min-w-[280px] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">{t('email.tab_inbox')}</h3>
          <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">{logs.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6 text-center">
              <i className="fas fa-inbox text-4xl mb-3 opacity-30"></i>
              <p className="text-sm">{t('email.inbox_empty')}</p>
            </div>
          ) : (
            logs.map((log) => {
              const active = selected && selected._id === log._id;
              return (
                <button
                  key={log._id}
                  onClick={() => setSelected(log)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors border-b border-gray-50 ${active ? 'bg-primary-50/70' : 'hover:bg-gray-50'}`}
                >
                  <Avatar email={log.subject} icon="fa-envelope" />
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold text-sm truncate ${active ? 'text-primary-800' : 'text-gray-900'}`}>{log.subject || '(no subject)'}</div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">{log.body}</div>
                    <div className="text-[11px] text-gray-400 mt-1">{new Date(log.sentAt).toLocaleDateString()} · {log.count} {t('broadcast.recipients')}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </Card>

      <Card className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6 text-center">
            <i className="fas fa-envelope-open-text text-5xl mb-3 opacity-20"></i>
            <p className="text-sm">{t('email.select_email')}</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              <Avatar email={selected.subject} icon="fa-envelope" />
              <div className="min-w-0">
                <strong className="text-sm text-gray-900 block truncate">{selected.subject || '(no subject)'}</strong>
                <p className="text-xs text-gray-400">{new Date(selected.sentAt).toLocaleString()} · {selected.count} {t('broadcast.recipients')}</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-gray-50/40">
              <div className="max-w-[80%]">
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow-sm bg-white text-gray-700 whitespace-pre-wrap">{selected.body}</div>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ContactsTab({ t }) {
  const { showToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => {
    api.get('/broadcast/contacts').then((r) => { if (r.success) setContacts(r.contacts || []); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    try {
      const res = await api.post('/broadcast/contacts', { email, name: newName.trim() });
      if (res.success) { showToast(t('broadcast.contact_added'), 'success'); setNewEmail(''); setNewName(''); load(); }
      else showToast(res.error || t('common.failed'), 'error');
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
    finally { setAdding(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{t('contacts.count', { count: contacts.length, optedIn: contacts.length })}</p>
      </div>

      <Card className="p-5 sm:p-6 border-l-4 border-l-primary-500">
        <h3 className="text-base font-semibold text-gray-900 mb-4">{t('broadcast.add_email')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('broadcast.email_placeholder')}</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-colors"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('broadcast.name_placeholder')}</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-colors"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('broadcast.name_placeholder')}
            />
          </div>
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !newEmail.trim()}
          className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className="fas fa-plus"></i> {t('broadcast.add_email')}
        </button>
      </Card>

      {contacts.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <i className="fas fa-address-book text-5xl text-gray-200 mb-4"></i>
          <h3 className="text-base font-semibold text-gray-600">{t('broadcast.no_contacts')}</h3>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map((c) => (
            <Card key={c._id} className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
              <Avatar name={c.name} email={c.email} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{c.name || c.email}</div>
                <div className="text-xs text-gray-500 truncate">{c.email}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BulkEmailImport onImported={() => { load(); }} />
    </div>
  );
}

function ComposeTab({ t }) {
  const { showToast } = useToast();
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.get('/broadcast/contacts').then((r) => { if (r.success) setCount((r.contacts || []).length); }).catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!message.trim()) return;
    if (!confirm(t('broadcast.confirm_send', { count }))) return;
    setSending(true);
    try {
      const res = await api.post('/broadcast/send', { message, channel: 'email', subject });
      if (res.success) { showToast(res.message || t('broadcast.confirmed_sent'), 'success'); setMessage(''); setSubject(''); }
    } catch (err) { showToast(err.error || t('broadcast.failed_send'), 'error'); }
    finally { setSending(false); }
  };

  return (
    <Card className="p-5 sm:p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-sm text-gray-500">{t('broadcast.recipients')}:</span>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary-50 text-primary-700 text-sm font-bold">{count}</span>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('broadcast.subject_label')}</label>
          <input
            type="text"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-colors"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('broadcast.subject_placeholder')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('broadcast.message_label')}</label>
          <textarea
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50/50 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-colors resize-none"
            rows={8}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('broadcast.message_placeholder')}
          />
        </div>
        <div className="flex justify-end pt-1">
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fas fa-paper-plane"></i> {sending ? t('broadcast.sending') : t('broadcast.send_to', { count })}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function Broadcast() {
  const { t } = useLang();
  const [tab, setTab] = useState('inbox');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center shadow-sm">
          <i className="fas fa-envelope"></i>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{t('broadcast.title')}</h1>
          <p className="text-sm text-gray-500">{t('broadcast.desc')}</p>
        </div>
      </div>

      <div className="inline-flex bg-gray-100/80 backdrop-blur rounded-xl p-1" role="tablist">
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              role="tab"
              aria-selected={active}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${active ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <i className={`fas ${item.icon} text-xs`}></i> {t(item.label)}
            </button>
          );
        })}
      </div>

      {tab === 'inbox' && <InboxTab t={t} />}
      {tab === 'contacts' && <ContactsTab t={t} />}
      {tab === 'compose' && <ComposeTab t={t} />}
    </div>
  );
}
