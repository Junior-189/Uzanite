const mockup = {
  en: {
    messages: [
      { from: 'customer', text: 'Hello, do you have Coca-Cola?' },
      { from: 'ai', text: 'Yes! 24 bottles available at 1,500 TZS each. Would you like to order?' },
      { from: 'customer', text: 'Order 5 bottles' },
      { from: 'ai', text: 'Done! Order #1247 placed. Total: 7,500 TZS. Pay via M-Pesa to 0712345678.' },
      { from: 'customer', text: 'Sent! Here is the screenshot' },
      { from: 'ai', text: 'Payment confirmed! Your order will be delivered tomorrow. Thank you!' },
    ],
    assistant: 'Shop Assistant',
    online: 'online',
    placeholder: 'Type a message...',
  },
  sw: {
    messages: [
      { from: 'customer', text: 'Hujambo, una Coca-Cola?' },
      { from: 'ai', text: 'Ndiyo! Chupa 24 zinapatikana kwa 1,500 TZS kila moja. Ungependa kuagiza?' },
      { from: 'customer', text: 'Ninaagiza chupa 5' },
      { from: 'ai', text: 'Imefanywa! Agizo #1247 limewekwa. Jumla: 7,500 TZS. Lipa kwa M-Pesa namba 0712345678.' },
      { from: 'customer', text: 'Nimetuma! Hii ni picha ya malipo' },
      { from: 'ai', text: 'Malipo yamethibitishwa! Agizo lako litafikishwa kesho. Asante!' },
    ],
    assistant: 'Msaidizi wa UZANITE',
    online: 'mtandaoni',
    placeholder: 'Andika ujumbe...',
  },
};

export default function PhoneMockup({ lang = 'en' }) {
  const data = mockup[lang] || mockup.en;
  return (
    <div className="relative mx-auto w-[200px] sm:w-[240px]">
      {/* Glow */}
      <div className="absolute -inset-4 bg-gradient-to-b from-emerald-500/15 to-indigo-500/15 rounded-[2.5rem] blur-xl" />

      {/* Phone frame */}
      <div className="relative bg-white dark:bg-gray-900 rounded-[2rem] p-1.5 shadow-2xl">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-3.5 bg-white dark:bg-gray-900 rounded-b-xl z-10" />

        {/* Screen */}
        <div className="bg-white dark:bg-gray-800 rounded-[1.5rem] overflow-hidden">
          {/* Status bar */}
          <div className="flex items-center justify-between px-4 pt-4 pb-1.5 bg-emerald-600">
            <span className="text-[8px] text-white/80 font-medium">9:41</span>
            <div className="flex items-center gap-0.5">
              <span className="text-[7px] text-white/80">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/></svg>
              </span>
              <span className="text-[7px] text-white/80">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>
              </span>
              <span className="text-[7px] text-white/80">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="16" height="10" x="2" y="7" rx="2"/><path d="M22 11v2"/></svg>
              </span>
            </div>
          </div>

          {/* Chat header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
            <div>
              <div className="text-[9px] font-semibold text-white">{data.assistant}</div>
              <div className="text-[7px] text-emerald-100 flex items-center gap-0.5">
                <span className="w-1 h-1 bg-emerald-300 rounded-full" />
                {data.online}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="p-2 space-y-1.5 bg-[#e5ddd5] dark:bg-gray-700 min-h-[200px]">
            {data.messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-2 py-1 text-[8px] leading-snug shadow-sm ${
                  msg.from === 'customer'
                    ? 'bg-[#dcf8c6] dark:bg-emerald-800 text-gray-800 dark:text-gray-100 rounded-br-sm'
                    : 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-bl-sm'
                }`}>
                  {msg.text}
                  <div className="text-[6px] text-gray-400 dark:text-gray-500 mt-0.5 text-right">9:4{i + 1} AM</div>
                </div>
              </div>
            ))}
            {/* Typing indicator */}
            <div className="flex justify-start">
              <div className="bg-white dark:bg-gray-600 rounded-lg rounded-bl-sm px-2 py-1 shadow-sm">
                <div className="flex gap-0.5">
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Input */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1 text-[7px] text-gray-400">
              {data.placeholder}
            </div>
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
