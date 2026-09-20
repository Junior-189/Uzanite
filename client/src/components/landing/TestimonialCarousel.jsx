import { useState, useEffect, useCallback, useRef } from 'react';
import { Star } from './Icons';

export default function TestimonialCarousel({ testimonials, t }) {
  const [current, setCurrent] = useState(0);
  const pausedRef = useRef(false);
  const intervalRef = useRef(null);

  const next = useCallback(() => {
    if (!pausedRef.current) {
      setCurrent((p) => (p + 1) % testimonials.length);
    }
  }, [testimonials.length]);

  useEffect(() => {
    intervalRef.current = setInterval(next, 5000);
    return () => clearInterval(intervalRef.current);
  }, [next]);

  const handleMouseEnter = useCallback(() => { pausedRef.current = true; }, []);
  const handleMouseLeave = useCallback(() => { pausedRef.current = false; }, []);

  return (
    <div
      className="relative overflow-hidden"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="flex transition-transform duration-500 ease-in-out"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {testimonials.map((t, i) => (
          <div key={i} className="w-full flex-shrink-0 px-2">
            <div className="bg-white dark:bg-gray-800/50 rounded-2xl p-8 shadow-sm border border-gray-200 dark:border-gray-700 max-w-2xl mx-auto text-center">
              <div className="flex justify-center gap-0.5 mb-4">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-gray-700 dark:text-gray-300 text-lg leading-relaxed mb-6 italic">"{t.quote}"</p>
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                  {t.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t.business}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Dots */}
      <div className="flex justify-center gap-2 mt-6">
        {testimonials.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${current === i ? 'bg-emerald-500 w-6' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={t ? t('landing.aria_testimonial', { n: i + 1 }) : `Testimonial ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
