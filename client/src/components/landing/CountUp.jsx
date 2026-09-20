import { useRef, useState, useEffect } from 'react';

export default function CountUp({ end, duration = 2000, suffix = '', prefix = '' }) {
  const ref = useRef(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStarted(true); obs.disconnect(); } },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    const num = typeof end === 'string' ? parseFloat(end.replace(/[^0-9.]/g, '')) : end;
    if (isNaN(num)) { setCount(end); return; }
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * num));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [started, end, duration]);

  const display = typeof end === 'string' && end.includes('+') ? `${count}+` : typeof end === 'string' && end.includes('%') ? `${count}%` : count;

  return <span ref={ref}>{prefix}{display}{suffix}</span>;
}
