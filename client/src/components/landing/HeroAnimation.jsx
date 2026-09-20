import { useEffect } from 'react';
import PhoneDashboardMockup from './PhoneDashboardMockup';
import PhoneChatMockup from './PhoneChatMockup';

const EntranceKeyframes = () => {
  return (
    <style>{`
      @keyframes phoneEnterLeft {
        from {
          opacity: 0;
          transform: translateX(-30px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }

      @keyframes phoneEnterRight {
        from {
          opacity: 0;
          transform: translateX(30px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }

      .phone-enter-left {
        animation: phoneEnterLeft 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .phone-enter-right {
        animation: phoneEnterRight 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
      }

      @keyframes phoneHover {
        0% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
        100% {
          transform: translateY(0);
        }
      }

      .phone-hover:hover {
        transition: all 0.3s ease-out;
        transform: translateY(-12px);
        filter: drop-shadow(0 20px 25px rgba(0, 0, 0, 0.15));
      }
    `}</style>
  );
};

export default function HeroAnimation({ lang = 'en' }) {
  useEffect(() => {
    // Animation lifecycle hook
  }, [lang]);

  return (
    <>
      <EntranceKeyframes />
      <div className="relative w-full">
        {/* Two-phone layout: side-by-side on lg+, stacked on mobile */}
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-8 items-center justify-center">
          {/* Left phone - Dashboard */}
          <div className="phone-enter-left phone-hover">
            <PhoneDashboardMockup lang={lang} />
          </div>

          {/* Right phone - Chat */}
          <div className="phone-enter-right phone-hover">
            <PhoneChatMockup lang={lang} />
          </div>
        </div>
      </div>
    </>
  );
}
