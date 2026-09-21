import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import Modal from '../components/Modal';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import { fetchFromCacheOrApi, createOffline, deleteOffline } from '../db/helpers';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { rowActivate } from '../utils/rowActivate';
import { useLoadMore } from '../hooks/useLoadMore';

export default function Contacts() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const [contacts, setContacts] = useState([]);
  const { nextCursor, setNextCursor, loadMore, loadingMore } = useLoadMore('contacts', (items) =>
    setContacts((prev) => [...prev, ...items])
  );
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addPhone, setAddPhone] = useState('');
  const [addName, setAddName] = useState('');
  const [messages, setMessages] = useState(null);
  const [msgContact, setMsgContact] = useState(null);
  const [editContact, setEditContact] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailContact, setEmailContact] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => { fetchContacts(); }, []);

  const fetchContacts = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const items = await fetchFromCacheOrApi('contacts', { forceRefresh });
      setContacts(items);
      // Capture the first-page cursor so older contacts can be loaded on demand.
      if (isOnline) {
        try {
          const res = await api.get('/contacts', { params: { limit: 50 } });
          if (res.success && Array.isArray(res.contacts)) {
            setContacts(res.contacts);
            setNextCursor(res.nextCursor || null);
          }
        } catch { /* keep cached list */ }
      }
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

  const openEdit = (c) => {
    setEditContact(c);
    setEditName(c.name || '');
    setEditEmail(c.email || '');
  };

  const handleEdit = async () => {
    if (!editContact) return;
    setSaving(true);
    try {
      const res = await api.put(`/contacts/${editContact.phone}`, { name: editName, email: editEmail });
      if (res.success) { showToast(t('contacts.confirmed_saved'), 'success'); setEditContact(null); fetchContacts(true); }
      else showToast(res.error || t('contacts.failed'), 'error');
    } catch (err) { showToast(err.error || t('contacts.failed'), 'error'); }
    finally { setSaving(false); }
  };

  const openEmail = (c) => {
    setEmailContact(c);
    setEmailSubject('');
    setEmailBody('');
  };

  const handleSendEmail = async () => {
    if (!emailContact) return;
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    try {
      const res = await api.post(`/contacts/${emailContact.phone}/email`, { subject: emailSubject, message: emailBody });
      if (res.success) { showToast(res.message || t('contacts.email_sent'), 'success'); setEmailContact(null); }
      else showToast(res.error || t('contacts.email_failed'), 'error');
    } catch (err) { showToast(err.error || t('contacts.email_failed'), 'error'); }
    finally { setSendingEmail(false); }
  };

  const loadMessages = async (phone, name) => {
    setMsgContact({ phone, name });
    try {
      const res = await api.get(`/contacts/${phone}/messages`);
      if (res.success) setMessages(res.messages || []);
    } catch {
      setMessages([]);
    }
  };

  const filtered = contacts.filter(
    (c) =>
      !search ||
      (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search)
  );
  const optedIn = contacts.filter((c) => !c.unsubscribedAt).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i className="fas fa-address-book text-primary-600"></i> {t('contacts.title')}
            {!isOnline && (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200"><i className="fas fa-wifi-slash"></i> {t('contacts.offline')}</span>)}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('contacts.count', { count: contacts.length, optedIn })}</p>
        </div>
        <div className="flex gap-3">
          <button
            className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold"
            onClick={() => setShowAdd(true)}
          >
            <i className="fas fa-plus mr-1"></i> {t('contacts.add_contact')}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4 border-l-4 border-l-primary-500">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('contacts.add_contact')}</h3>
          </div>
          <form onSubmit={handleAdd}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.phone_label')} *</label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder={t('contacts.phone_placeholder')}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.name_label')}</label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={t('contacts.name_placeholder')}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => setShowAdd(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold"
              >
                {t('common.add')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('search.placeholder')}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <i className="fas fa-address-book text-5xl text-gray-300 mb-4"></i>
              <h3 className="text-lg font-semibold text-gray-600">{t('contacts.no_contacts')}</h3>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_name')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_phone')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_email')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_messages')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_status')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('contacts.col_last_active')}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c._id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                        onClick={() => loadMessages(c.phone, c.name)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-semibold text-gray-900">{c.name || t('contacts.unknown')}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{c.phone}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{c.email || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{c.messageCount || 0}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.unsubscribedAt ? 'rejected' : 'active'} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-40"
                              disabled={!c.email}
                              title={c.email ? t('contacts.send_email') : t('contacts.no_email')}
                              onClick={(e) => { e.stopPropagation(); openEmail(c); }}
                            >
                              <i className="fas fa-envelope"></i>
                            </button>
                            <button
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                              onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                              title={t('contacts.edit')}
                            >
                              <i className="fas fa-pen"></i>
                            </button>
                            <button
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors"
                              onClick={(e) => { e.stopPropagation(); handleDelete(c.phone); }}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-gray-100">
                {filtered.map((c) => (
                  <div key={c._id} className="p-4 cursor-pointer hover:bg-gray-50/50 transition-colors" {...rowActivate(() => loadMessages(c.phone, c.name))}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-gray-900">{c.name || t('contacts.unknown')}</span>
                      <StatusBadge status={c.unsubscribedAt ? 'rejected' : 'active'} />
                    </div>
                     <div className="text-xs text-gray-400 mb-1">{c.phone}{c.email ? ` · ${c.email}` : ''} · {c.messageCount || 0} {t('contacts.messages')}</div>
                     <div className="flex items-center justify-between">
                       <span className="text-xs text-gray-400">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString() : 'N/A'}</span>
                       <div className="flex items-center gap-1.5">
                         <button
                           className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-primary-600 text-white disabled:opacity-40"
                           disabled={!c.email}
                           onClick={(e) => { e.stopPropagation(); openEmail(c); }}
                         ><i className="fas fa-envelope"></i></button>
                         <button
                           className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300"
                           onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                         ><i className="fas fa-pen"></i></button>
                         <button
                           className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white"
                           onClick={(e) => { e.stopPropagation(); handleDelete(c.phone); }}
                         >{t('common.delete')}</button>
                       </div>
                     </div>
                  </div>
                ))}
              </div>
              {nextCursor && (
                <div className="p-4 text-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 rounded-xl bg-white text-primary-700 border border-primary-200 text-sm font-semibold hover:bg-primary-50 disabled:opacity-50"
                  >
                    {loadingMore ? t('common.loading') : t('common.load_more')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {msgContact && (
          <div className="w-full lg:w-[350px] min-w-0 lg:min-w-[300px] lg:flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">{msgContact.name || msgContact.phone}</h3>
              <button
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                onClick={() => { setMsgContact(null); setMessages(null); }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-3">
              {!messages ? (
                <p className="text-center text-gray-400 py-8">{t('contacts.loading')}</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-gray-400 py-8">{t('contacts.no_messages')}</p>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className="mb-1.5">
                    <div
                      className={`px-3 py-2 rounded-lg text-[0.82rem] shadow-sm break-words ${
                        m.fromMe ? 'bg-green-100' : 'bg-white border border-gray-100'
                      }`}
                    >
                      {m.body || m.message}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit contact (name + email) */}
      <Modal
        open={!!editContact}
        onClose={() => setEditContact(null)}
        title={t('contacts.edit_title', { name: editContact?.name || editContact?.phone })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => setEditContact(null)}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50" onClick={handleEdit} disabled={saving}>{t('common.save')}</button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.name_label')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.email_label')}</label>
            <input type="email" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="name@email.com" />
          </div>
        </div>
      </Modal>

      {/* Send email to a specific contact */}
      <Modal
        open={!!emailContact}
        onClose={() => setEmailContact(null)}
        title={t('contacts.send_email_title', { name: emailContact?.name || emailContact?.email })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => setEmailContact(null)}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50" onClick={handleSendEmail} disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}>
              <i className="fas fa-paper-plane"></i> {sendingEmail ? t('contacts.sending') : t('contacts.send_email')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="text-xs text-gray-500">
            {t('contacts.send_email_to')}: <span className="font-medium text-gray-900">{emailContact?.email}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.email_subject')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder={t('contacts.email_subject_placeholder')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('contacts.email_message')}</label>
            <textarea className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none" rows={6} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder={t('contacts.email_message_placeholder')} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
