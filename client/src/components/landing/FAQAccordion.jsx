import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from './Icons';

export default function FAQAccordion({ items }) {
  const [open, setOpen] = useState(null);
  const contentRefs = useRef({});
  const [heights, setHeights] = useState({});

  useEffect(() => {
    const newHeights = {};
    items.forEach((_, i) => {
      const el = contentRefs.current[i];
      if (el) newHeights[i] = el.scrollHeight;
    });
    setHeights(newHeights);
  }, [items]);

  const toggle = useCallback((i) => {
    setOpen((prev) => (prev === i ? null : i));
  }, []);

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/50">
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => toggle(i)}
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            aria-expanded={open === i}
          >
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 pr-4">{item.question}</span>
            <span className={`text-gray-400 transition-transform duration-300 flex-shrink-0 ${open === i ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-4 h-4" />
            </span>
          </button>
          <div
            ref={(el) => { contentRefs.current[i] = el; }}
            className="overflow-hidden transition-all duration-300 ease-in-out"
            style={{ maxHeight: open === i ? (heights[i] || 300) + 'px' : '0px' }}
          >
            <p className="px-6 pb-4 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.answer}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
