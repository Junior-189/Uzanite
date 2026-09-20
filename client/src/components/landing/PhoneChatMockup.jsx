import { useState, useEffect } from 'react';

const mockup = {
  en: {
    messages: [
      { from: 'customer', text: 'I need some groceries for the week' },
      { from: 'ai', text: 'Welcome! Here are our top items:\n🥚 Eggs (30pc) -\u00a012,000\u00a0TZS\n🥛 Fresh Milk (1L) -\u00a03,500\u00a0TZS\n🍞 Bread -\u00a02,000\u00a0TZS\n🍚 Rice (5kg) -\u00a015,000\u00a0TZS\n\nWhich items would you like?' },
      { from: 'customer', type: 'image', text: '📷 I want bread & milk' },
      { from: 'ai', text: 'I see you want Bread & Milk!\n2x\u00a0Bread\u00a0=\u00a04,000\u00a0TZS\n1x\u00a0Milk\u00a0=\u00a03,500\u00a0TZS\n\n🔥 Fresh mandazi just arrived!\nAdd 3 pieces for 1,500 TZS?' },
      { from: 'customer', text: 'Yes, add them!' },
      { from: 'ai', text: '✅ Order #1250\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n2x\u00a0Bread\u00a0\u00a0\u00a0\u00a0\u00a04,000\u00a0TZS\n1x\u00a0Milk\u00a0\u00a0\u00a0\u00a0\u00a0\u00a03,500\u00a0TZS\n3x\u00a0Mandazi\u00a0\u00a01,500\u00a0TZS\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nTotal:\u00a0\u00a0\u00a0\u00a0\u00a0\u00a09,000\u00a0TZS\n\nSend payment via M-Pesa to 0712345678' },
      { from: 'customer', text: 'Sent ✅' },
      { from: 'ai', text: '🎉 Payment confirmed!\nYour delivery arrives in 2 hours.\n\nThank you for choosing UZANITE!\nWe are here 24/7 for anything else 🙏' },
    ],
    assistant: 'Shop Assistant',
    online: 'online',
    placeholder: 'Type a message...',
  },
  sw: {
    messages: [
      { from: 'customer', text: 'Nahitaji mboga za wiki' },
      { from: 'ai', text: 'Karibu! Hivi ndivyo bidhaa zetu:\n🥚 Mayai (30pc) -\u00a012,000\u00a0TZS\n🥛 Maziwa (1L) -\u00a03,500\u00a0TZS\n🍞 Mkate -\u00a02,000\u00a0TZS\n🍚 Mchele (5kg) -\u00a015,000\u00a0TZS\n\nUngependa kuagiza nini?' },
      { from: 'customer', type: 'image', text: '📷 Nataka mkate na maziwa' },
      { from: 'ai', text: 'Nimeona unataka Mkate & Maziwa!\n2x\u00a0Mkate\u00a0=\u00a04,000\u00a0TZS\n1x\u00a0Maziwa\u00a0=\u00a03,500\u00a0TZS\n\n🔥 Mandazi mapya yamefika!\nOngeza 3 kwa 1,500 TZS?' },
      { from: 'customer', text: 'Ndiyo, ongeza!' },
      { from: 'ai', text: '✅ Agizo #1250\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n2x\u00a0Mkate\u00a0\u00a0\u00a0\u00a04,000\u00a0TZS\n1x\u00a0Maziwa\u00a0\u00a0\u00a03,500\u00a0TZS\n3x\u00a0Mandazi\u00a01,500\u00a0TZS\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nJumla:\u00a0\u00a0\u00a0\u00a0\u00a09,000\u00a0TZS\n\nTuma malipo kwa M-Pesa namba 0712345678' },
      { from: 'customer', text: 'Nimetuma ✅' },
      { from: 'ai', text: '🎉 Malipo yamethibitishwa!\nUtapokea ndani ya masaa 2.\n\nAsante kwa kuchagua UZANITE!\nTupo 24/7 kwa huduma zaidi 🙏' },
    ],
    assistant: 'Msaidizi wa UZANITE',
    online: 'mtandaoni',
    placeholder: 'Andika ujumbe...',
  },
};

const BG_LIGHT = '#e5ddd5';
const BG_DARK = 'rgb(31, 41, 55)';

const ChatKeyframes = () => {
  return (
    <style>{`
      @keyframes fadeInScale {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .phone-enter {
        animation: fadeInScale 0.6s ease-out;
      }

      @keyframes slideInLeft {
        from {
          opacity: 0;
          transform: translateX(-12px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes slideInRight {
        from {
          opacity: 0;
          transform: translateX(12px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      .msg-ai {
        animation: slideInLeft 0.3s ease-out;
      }

      .msg-customer {
        animation: slideInRight 0.3s ease-out;
      }
    `}</style>
  );
};

export default function PhoneChatMockup({ lang = 'en' }) {
  const data = mockup[lang] || mockup.en;
  const [currentMessageSet, setCurrentMessageSet] = useState(0);
  const [displayedMessages, setDisplayedMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    const messageSets = [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
    ];

    const cycleMessages = () => {
      const setIdx = currentMessageSet % messageSets.length;
      const [customerIdx, aiIdx] = messageSets[setIdx];

      setDisplayedMessages([]);
      setIsTyping(false);

      // Phase 1: Show customer message (right side)
      setTimeout(() => {
        setDisplayedMessages([data.messages[customerIdx]]);
      }, 200);

      // Phase 2: Typing indicator (AI is responding)
      setTimeout(() => {
        setIsTyping(true);
      }, 200 + 1000);

      // Phase 3: AI message appears (left side)
      setTimeout(() => {
        setDisplayedMessages([data.messages[customerIdx], data.messages[aiIdx]]);
        setIsTyping(false);
      }, 200 + 1000 + 1200);

      // Next cycle
      setTimeout(() => {
        setCurrentMessageSet((prev) => prev + 1);
      }, 200 + 1000 + 1200 + 3000);
    };

    cycleMessages();
  }, [currentMessageSet, data.messages]);

  // Determine background color based on theme
  const isDark = typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const bgColor = isDark ? BG_DARK : BG_LIGHT;

  return (
    <>
      <ChatKeyframes />
      <div className="relative mx-auto w-[180px] sm:w-[200px]">
        {/* Glow */}
        <div className="absolute -inset-4 bg-gradient-to-b from-emerald-500/15 to-indigo-500/15 rounded-[2.5rem] blur-xl" />

        {/* Phone frame */}
        <div className="relative bg-black rounded-[2rem] p-1.5 shadow-2xl">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-3.5 bg-black rounded-b-xl z-10" />

          {/* Screen */}
          <div
            className="bg-white dark:bg-gray-800 rounded-[1.75rem] overflow-hidden flex flex-col h-[360px]"
            style={{ backgroundColor: bgColor }}
          >
            {/* Status bar */}
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1 bg-emerald-600">
              <span className="text-[9px] text-white/80 font-medium">9:41</span>
              <div className="flex items-center gap-0.5">
                <span className="text-[8px] text-white/80">●●●●●</span>
                <span className="text-[8px] text-white/80">📶</span>
                <span className="text-[8px] text-white/80">🔋</span>
              </div>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-emerald-600 border-b border-emerald-700">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold">
                  S
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">
                    {data.assistant}
                  </div>
                  <div className="text-[7px] text-emerald-50 truncate">{data.online}</div>
                </div>
              </div>
              <div className="text-white text-xs flex-shrink-0">⋯</div>
            </div>

            {/* Chat area */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 flex flex-col justify-end">
              {displayedMessages.map((msg, idx) => {
                if (msg.from === 'customer' && msg.type === 'image') {
                  return (
                    <div key={idx} className="flex justify-end">
                      <div className="msg-customer bg-[#dcf8c6] text-gray-900 rounded-lg rounded-tr-none p-1 text-xs leading-tight max-w-[120px]">
                        <div className="bg-gradient-to-br from-blue-100 to-blue-200 rounded-md h-14 flex items-center justify-center text-2xl mb-1 border border-blue-300/50">
                          📸
                        </div>
                        <div className="px-1 pb-1 text-[8px] text-gray-500 truncate">{msg.text}</div>
                      </div>
                    </div>
                  );
                }
                if (msg.from === 'ai') {
                  return (
                    <div key={idx} className="flex justify-start">
                      <div className="msg-ai bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg rounded-tl-none px-2 py-1.5 text-[9px] leading-relaxed max-w-[140px] break-words whitespace-pre-line">
                        {msg.text}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="flex justify-end">
                    <div className="msg-customer bg-[#dcf8c6] text-gray-900 rounded-lg rounded-tr-none px-2 py-1.5 text-[9px] leading-relaxed max-w-[130px] break-words">
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-700 rounded-lg rounded-tl-none px-2.5 py-1.5 flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Input bar */}
            <div className="flex items-center gap-1 px-2 py-1.5 bg-emerald-600 border-t border-emerald-700">
              <input
                type="text"
                placeholder={data.placeholder}
                disabled
                className="flex-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded px-1.5 py-0.5 text-[7px] placeholder-gray-400"
              />
              <button className="text-white text-xs flex-shrink-0">📎</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
