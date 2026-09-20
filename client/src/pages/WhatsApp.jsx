import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import useOnlineStatus from '../hooks/useOnlineStatus';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import { fetchFromCacheOrApi, createOffline, deleteOffline } from '../db/helpers';
import { rowActivate } from '../utils/rowActivate';

function ChatTab({ t }) {
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const [connected, setConnected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [transport, setTransport] = useState('meta');
  const [metaAccount, setMetaAccount] = useState(null);
  const [metaForm, setMetaForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', displayPhoneNumber: '', verifyToken: '' });
  const [savingMeta, setSavingMeta] = useState(false);
  const pollRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    checkStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/whatsapp/status');
      setTransport(res.transport || 'meta');
      setConnected(res.connected);
      setBotPaused(!!res.botPaused);
      if (res.connected) fetchContacts();
      if ((res.transport || 'meta') === 'meta') fetchMeta();
    } catch { setConnected(false); }
    finally { setLoading(false); }
  };

  const fetchContacts = async () => {
    try { const res = await api.get('/contacts'); if (res.success) setContacts(res.contacts || []); } catch {}
  };

  const fetchMeta = async () => {
    try {
      const res = await api.get('/whatsapp/meta/credentials');
      if (res.success) setMetaAccount(res.account);
    } catch { /* ignore */ }
  };

  const saveMeta = async (e) => {
    e.preventDefault();
    setSavingMeta(true);
    try {
      const res = await api.post('/whatsapp/meta/credentials', metaForm);
      if (res.success) {
        showToast(t('whatsapp.meta_saved'), 'success');
        setMetaForm({ phoneNumberId: '', wabaId: '', accessToken: '', displayPhoneNumber: '', verifyToken: '' });
        await checkStatus();
      }
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const initiateConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.post('/whatsapp/connect', {});
      if (res.connected) { setConnected(true); showToast(t('whatsapp.already_connected'), 'success'); fetchContacts(); }
      else if (res.qr) { setQr(res.qr); setQrImage(res.qrImage || null); startPolling(); }
      else { showToast(t('whatsapp.failed_qr'), 'error'); }
    } catch (err) { showToast(err.error || t('whatsapp.connection_failed'), 'error'); }
    finally { setConnecting(false); }
  };

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get('/whatsapp/qr');
        if (res.connected) { clearInterval(pollRef.current); setConnected(true); setQr(null); setQrImage(null); showToast(t('whatsapp.connected'), 'success'); fetchContacts(); return; }
        if (res.qr) { setQr(res.qr); setQrImage(res.qrImage || null); }
      } catch {}
    }, 3000);
  }, []);

  const disconnect = async () => {
    if (!confirm(t('whatsapp.confirm_disconnect'))) return;
    try {
      const res = await api.post('/whatsapp/disconnect', {});
      if (res.success) { setConnected(false); setQr(null); setContacts([]); setSelectedContact(null); showToast(t('whatsapp.disconnected'), 'warning'); }
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const togglePause = async () => {
    try {
      const res = await api.post(`/whatsapp/${botPaused ? 'resume' : 'pause'}`, {});
      if (res.success) {
        setBotPaused(res.botPaused);
        showToast(res.botPaused ? t('whatsapp.bot_paused') : t('whatsapp.bot_resumed'), res.botPaused ? 'warning' : 'success');
      }
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const loadChat = async (phone) => {
    setSelectedContact(phone);
    try { const res = await api.get(`/chat/${phone}`); if (res.success) setMessages(res.messages || []); } catch { setMessages([]); }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedContact) return;
    try { await api.post('/chat/send', { phone: selectedContact, message: replyText }); setReplyText(''); loadChat(selectedContact); }
    catch (err) { showToast(err.error || t('whatsapp.failed_send'), 'error'); }
  };

  const filteredContacts = contacts.filter((c) =>
    !chatSearch || (c.phone || '').includes(chatSearch) || (c.name || '').toLowerCase().includes(chatSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-gray-500">{t('whatsapp.checking_status')}</p>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <div className="w-20 h-20 rounded-full bg-warning-50 flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-wifi-slash text-3xl text-warning-400"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('whatsapp.internet_required')}</h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">{t('whatsapp.internet_desc')}</p>
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-warning-100 text-warning-700 text-sm font-semibold border border-warning-200">
            <i className="fas fa-circle text-[6px] animate-pulse"></i> {t('whatsapp.waiting_connection')}
          </span>
        </div>
      </div>
    );
  }

  if (!connected && transport === 'meta') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 max-w-xl mx-auto">
        <div className="text-center mb-5">
          <i className="fab fa-whatsapp text-4xl text-[#25D366] mb-3 block"></i>
          <h2 className="text-lg font-bold text-gray-900">{t('whatsapp.meta_title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('whatsapp.meta_desc')}</p>
        </div>
        {metaAccount && (
          <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-0.5">
            <div><strong>Phone number ID:</strong> {metaAccount.phoneNumberId || '—'}</div>
            <div><strong>Status:</strong> {metaAccount.status}</div>
            <div><strong>Token:</strong> {metaAccount.hasToken ? 'configured' : 'missing'}</div>
          </div>
        )}
        <form onSubmit={saveMeta} className="space-y-3">
          <input required value={metaForm.phoneNumberId} onChange={(e) => setMetaForm({ ...metaForm, phoneNumberId: e.target.value })} placeholder={t('whatsapp.meta_phone_number_id')} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          <input value={metaForm.wabaId} onChange={(e) => setMetaForm({ ...metaForm, wabaId: e.target.value })} placeholder={t('whatsapp.meta_waba_id')} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          <input required value={metaForm.accessToken} onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })} placeholder={t('whatsapp.meta_access_token')} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          <input value={metaForm.displayPhoneNumber} onChange={(e) => setMetaForm({ ...metaForm, displayPhoneNumber: e.target.value })} placeholder={t('whatsapp.meta_display_number')} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          <input value={metaForm.verifyToken} onChange={(e) => setMetaForm({ ...metaForm, verifyToken: e.target.value })} placeholder={t('whatsapp.meta_verify_token')} className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          <button type="submit" disabled={savingMeta} className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
            <i className="fas fa-save mr-1.5"></i>{savingMeta ? t('common.saving') : t('whatsapp.meta_save')}
          </button>
        </form>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 max-w-lg mx-auto">
        <div className="text-center">
          {qr ? (
            <div className="inline-block p-4 bg-white rounded-2xl shadow-lg border border-gray-100">
              <img src={qrImage || `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr)}`} alt="QR Code" className="w-full max-w-[280px] h-auto aspect-square rounded-lg" />
              <div className="mt-3 text-xs text-gray-400"><i className="fas fa-clock mr-1"></i>{t('whatsapp.qr_refresh')}</div>
            </div>
          ) : (
            <div className="py-10">
              <i className="fab fa-whatsapp text-5xl text-[#25D366] mb-4 block"></i>
              <p className="text-gray-400 text-sm">{t('whatsapp.click_generate')}</p>
            </div>
          )}
          {qr && (
            <div className="mt-4 text-left bg-gray-50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <i className="fas fa-mobile-alt text-[#25D366]"></i> {t('whatsapp.how_to')}
              </h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>{t('whatsapp.step1')}</li>
                <li>{t('whatsapp.step2')}</li>
                <li>{t('whatsapp.step3')}</li>
                <li>{t('whatsapp.step4')}</li>
                <li>{t('whatsapp.step5')}</li>
              </ol>
            </div>
          )}
          <div className="mt-5 flex gap-2 justify-center">
            <button onClick={initiateConnect} disabled={connecting} className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50">
              <i className="fas fa-qrcode mr-1.5"></i>{connecting ? t('whatsapp.connecting') : qr ? t('whatsapp.refresh_qr') : t('whatsapp.generate_qr')}
            </button>
            <button onClick={checkStatus} className="px-5 py-2.5 rounded-xl bg-white text-gray-700 border border-gray-300 text-sm font-medium hover:bg-gray-50 transition-colors">
              <i className="fas fa-sync-alt mr-1.5"></i>{t('whatsapp.check_status')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100dvh-240px)] min-h-[400px]">
      <div className="w-full md:w-80 min-w-0 md:min-w-[280px] bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <i className="fas fa-comments text-gray-400"></i> {t('whatsapp.chats')} ({contacts.length})
            </h3>
            {botPaused && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-100 text-warning-700 text-[10px] font-semibold border border-warning-200">
                <i className="fas fa-pause"></i> {t('whatsapp.bot_paused_short')}
              </span>
            )}
            <div className="flex gap-1">
              <button onClick={togglePause} title={botPaused ? t('whatsapp.resume_bot') : t('whatsapp.pause_bot')} className={`text-[10px] px-2 py-1 rounded ${botPaused ? 'bg-success-600 text-white hover:bg-success-700' : 'bg-warning-500 text-white hover:bg-warning-600'}`}><i className={`fas ${botPaused ? 'fa-play' : 'fa-pause'}`}></i></button>
              <button onClick={disconnect} className="text-[10px] px-2 py-1 rounded bg-danger-600 text-white hover:bg-danger-700"><i className="fas fa-unlink"></i></button>
              <button onClick={checkStatus} className="text-[10px] px-2 py-1 rounded bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"><i className="fas fa-sync-alt"></i></button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><i className="fas fa-search text-xs text-gray-400"></i></div>
            <input type="text" placeholder={t('whatsapp.search')} value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredContacts.length === 0 ? (
            <div className="text-center py-10 text-gray-400"><i className="fas fa-comments text-3xl block mb-2 opacity-40"></i><p className="text-sm">{t('whatsapp.no_chats')}</p></div>
          ) : filteredContacts.map((c) => (
            <button key={c._id} onClick={() => loadChat(c.phone)} className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left transition-colors ${selectedContact === c.phone ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
              <div className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center font-semibold text-sm flex-shrink-0">{(c.phone || '?').slice(-2)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900 truncate">{c.phone}</div>
                <div className="text-xs text-gray-400 truncate">{c.lastMessage || t('whatsapp.no_messages')}</div>
              </div>
              <span className="text-[11px] font-bold bg-success-50 text-success-700 px-1.5 py-0.5 rounded-full flex-shrink-0">{c.messageCount || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#25D366] text-white flex items-center justify-center"><i className="fas fa-user text-sm"></i></div>
          <div>
            <strong className="text-sm text-gray-900">{selectedContact || t('whatsapp.select_chat')}</strong>
            <p className="text-xs text-gray-400">{selectedContact ? t('whatsapp.click_to_view') : t('whatsapp.pick_contact')}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2 bg-gray-50">
          {!selectedContact ? (
            <div className="text-center text-gray-400 py-16"><i className="fas fa-comments text-4xl block mb-3 opacity-30"></i><p className="text-sm">{t('whatsapp.select_contact')}</p></div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-400 py-10 text-sm">{t('whatsapp.no_messages_yet')}</div>
          ) : messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[70%]">
                <div className={`px-3.5 py-2.5 rounded-xl text-sm shadow-sm ${msg.fromMe ? 'bg-[#dcf8c6] rounded-br-sm' : 'bg-white rounded-bl-sm'}`}>
                  {msg.body || msg.message}
                </div>
                <div className={`text-[11px] text-gray-400 mt-0.5 ${msg.fromMe ? 'text-right' : 'text-left'}`}>
                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {selectedContact && (
          <form onSubmit={sendReply} className="px-4 py-3 border-t border-gray-100 flex items-center gap-3">
            <input type="text" value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={t('whatsapp.type_reply')} autoComplete="off" className="flex-1 px-4 py-2.5 rounded-full border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
            <button type="submit" className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center hover:bg-[#1da851] transition-colors flex-shrink-0">
              <i className="fas fa-paper-plane text-sm"></i>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ContactsTab({ t }) {
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const { lang } = useLang();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addPhone, setAddPhone] = useState('');
  const [addName, setAddName] = useState('');
  const [messages, setMessages] = useState(null);
  const [msgContact, setMsgContact] = useState(null);

  useEffect(() => { fetchContacts(); }, []);

  const fetchContacts = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const items = await fetchFromCacheOrApi('contacts', { forceRefresh });
      setContacts(items);
    } catch { showToast(t('contacts.failed'), 'error'); }
    finally { setLoading(false); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await createOffline('contacts', { phone: addPhone, name: addName });
      showToast(isOnline ? t('contacts.confirmed_added') : t('contacts.confirmed_offline'), 'success');
      setShowAdd(false); setAddPhone(''); setAddName('');
      fetchContacts(true);
    } catch (err) { showToast(err.error || t('contacts.failed'), 'error'); }
  };

  const handleDelete = async (phone) => {
    if (!confirm(t('contacts.confirm_delete', { phone }))) return;
    try { await deleteOffline('contacts', phone); showToast(t('contacts.confirmed_deleted'), 'success'); fetchContacts(true); }
    catch { showToast(t('contacts.failed'), 'error'); }
  };

  const loadMessages = async (phone, name) => {
    setMsgContact({ phone, name });
    try {
      const res = await api.get(`/contacts/${phone}/messages`);
      if (res.success) setMessages(res.messages || []);
    } catch { setMessages([]); }
  };

  const filtered = contacts.filter(
    (c) => !search || (c.name || '').toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );
  const optedIn = contacts.filter((c) => !c.unsubscribedAt).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <p className="text-sm text-gray-500">{t('contacts.count', { count: contacts.length, optedIn })}</p>
        <div className="flex gap-2">
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-3 py-1.5 rounded-lg text-xs font-semibold" onClick={() => setShowAdd(true)}>
            <i className="fas fa-plus mr-1"></i> {t('contacts.add_contact')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4 border-l-4 border-l-primary-500">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('contacts.add_contact')}</h3>
          <form onSubmit={handleAdd}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.phone_label')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder={t('contacts.phone_placeholder')} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.name_label')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={t('contacts.name_placeholder')} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">{t('common.add')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder')} />
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <i className="fas fa-address-book text-5xl text-gray-300 mb-4"></i>
              <h3 className="text-lg font-semibold text-gray-600">{t('contacts.no_contacts')}</h3>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_name')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_phone')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_messages')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_status')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_last_active')}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c._id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => loadMessages(c.phone, c.name)}>
                        <td className="px-4 py-3"><span className="font-semibold text-gray-900">{c.name || t('contacts.unknown')}</span></td>
                        <td className="px-4 py-3 text-sm text-gray-600">{c.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{c.messageCount || 0}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.unsubscribedAt ? 'rejected' : 'active'} /></td>
                        <td className="px-4 py-3 text-sm text-gray-500">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString() : 'N/A'}</td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors" onClick={(e) => { e.stopPropagation(); handleDelete(c.phone); }}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-gray-100">
                {filtered.map((c) => (
                  <div key={c._id} className="p-4 cursor-pointer hover:bg-gray-50/50 transition-colors" {...rowActivate(() => loadMessages(c.phone, c.name))}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-gray-900">{c.name || t('contacts.unknown')}</span>
                      <StatusBadge status={c.unsubscribedAt ? 'rejected' : 'active'} />
                    </div>
                    <div className="text-xs text-gray-400 mb-2">{c.phone} · {c.messageCount || 0} {t('contacts.messages')}</div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString() : 'N/A'}</span>
                      <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white" onClick={(e) => { e.stopPropagation(); handleDelete(c.phone); }}>{t('common.delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {msgContact && (
          <div className="w-full lg:w-[350px] min-w-0 lg:min-w-[300px] lg:flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">{msgContact.name || msgContact.phone}</h3>
              <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors" onClick={() => { setMsgContact(null); setMessages(null); }}><i className="fas fa-times"></i></button>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-3">
              {!messages ? (
                <p className="text-center text-gray-400 py-8">{t('contacts.loading')}</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-gray-400 py-8">{t('contacts.no_messages')}</p>
              ) : messages.map((m, i) => (
                <div key={i} className="mb-1.5">
                  <div className={`px-3 py-2 rounded-lg text-[0.82rem] shadow-sm break-words ${m.fromMe ? 'bg-green-100' : 'bg-white border border-gray-100'}`}>{m.body || m.message}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BroadcastTab({ t }) {
  const { showToast } = useToast();
  const { lang } = useLang();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [contactCount, setContactCount] = useState(0);

  useEffect(() => {
    api.get('/broadcast/contacts/count').then((r) => { if (r.success) setContactCount(r.count); }).catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!message.trim()) return;
    if (!confirm(t('broadcast.confirm_send', { count: contactCount }))) return;
    setSending(true);
    try {
      const res = await api.post('/broadcast/send', { message });
      if (res.success) showToast(res.message || t('broadcast.confirmed_sent'), 'success');
      setMessage('');
    } catch (err) { showToast(err.error || t('broadcast.failed_send'), 'error'); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <p className="text-sm text-gray-500">{t('broadcast.desc')}</p>
        <div className="flex items-center gap-2">
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-gray-500">{t('broadcast.recipients')}:</span>
          <span className="text-sm font-bold text-gray-900">{contactCount}</span>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('broadcast.message_label')}</label>
          <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors resize-none" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('broadcast.message_placeholder')} />
        </div>
        <div className="flex justify-end">
          <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleSend} disabled={sending || !message.trim()}>
            <i className="fas fa-paper-plane"></i> {sending ? t('broadcast.sending') : t('broadcast.send_to', { count: contactCount })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WhatsApp() {
  const { t } = useLang();
  const [tab, setTab] = useState('chat');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <i className="fab fa-whatsapp text-[#25D366]"></i> {t('whatsapp.title')}
        </h1>
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1 w-fit" role="tablist">
        {[
          { key: 'chat', label: t('whatsapp.tab_chat'), icon: 'fa-comments' },
          { key: 'contacts', label: t('whatsapp.tab_contacts'), icon: 'fa-address-book' },
          { key: 'broadcast', label: t('whatsapp.tab_broadcast'), icon: 'fa-bullhorn' },
        ].map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} role="tab" aria-selected={tab === item.key}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${tab === item.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <i className={`fas ${item.icon} text-xs`}></i> {item.label}
          </button>
        ))}
      </div>

      {tab === 'chat' && <ChatTab t={t} />}
      {tab === 'contacts' && <ContactsTab t={t} />}
      {tab === 'broadcast' && <BroadcastTab t={t} />}
    </div>
  );
}
