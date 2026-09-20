import { useRef, useState, useEffect } from 'react';

const variants = {
  'fade-up': { opacity: 0, transform: 'translateY(40px)' },
  'fade-down': { opacity: 0, transform: 'translateY(-40px)' },
  'fade-left': { opacity: 0, transform: 'translateX(-40px)' },
  'fade-right': { opacity: 0, transform: 'translateX(40px)' },
  'zoom-in': { opacity: 0, transform: 'scale(0.85)' },
  'zoom-out': { opacity: 0, transform: 'scale(1.15)' },
  'scale-up': { opacity: 0, transform: 'scale(0.9) translateY(20px)' },
  'flip-up': { opacity: 0, transform: 'perspective(600px) rotateX(10deg) translateY(30px)' },
};

export default function AnimatedSection({ children, className = '', delay = 0, type = 'fade-up', duration = 700 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !shown.current) {
          shown.current = true;
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const start = variants[type] || variants['fade-up'];

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : start.opacity,
        transform: visible ? 'translateY(0) scale(1) rotateX(0)' : start.transform,
        transition: `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
