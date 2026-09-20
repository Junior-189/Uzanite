import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { useTheme } from '../components/landing/ThemeContext';
import AnimatedSection from '../components/landing/AnimatedSection';
import HeroAnimation from '../components/landing/HeroAnimation';
import PhoneMockup from '../components/landing/PhoneMockup';
import FAQAccordion from '../components/landing/FAQAccordion';
import { Globe, Sun, Moon, Check, MessageSquare, ShoppingCart, Package, BarChart3, Users, CreditCard, Send, Shield, Zap, Clock, TrendingUp, Building2, Bell, ArrowRight, ChevronRight, Download, Smartphone, ExternalLink, Monitor } from '../components/landing/Icons';
import UzerLogo from '../components/UzerLogo';

const features = [
  { icon: MessageSquare, color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400', titleKey: 'landing.feature_1_title', descKey: 'landing.feature_1_desc' },
  { icon: ShoppingCart, color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400', titleKey: 'landing.feature_2_title', descKey: 'landing.feature_2_desc' },
  { icon: Package, color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400', titleKey: 'landing.feature_3_title', descKey: 'landing.feature_3_desc' },
  { icon: BarChart3, color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400', titleKey: 'landing.feature_4_title', descKey: 'landing.feature_4_desc' },
  { icon: Users, color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400', titleKey: 'landing.feature_5_title', descKey: 'landing.feature_5_desc' },
  { icon: CreditCard, color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400', titleKey: 'landing.feature_6_title', descKey: 'landing.feature_6_desc' },
  { icon: Send, color: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400', titleKey: 'landing.feature_7_title', descKey: 'landing.feature_7_desc' },
  { icon: Zap, color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400', titleKey: 'landing.feature_8_title', descKey: 'landing.feature_8_desc' },
];

const benefits = [
  { icon: Clock, titleKey: 'landing.benefit_1_title', descKey: 'landing.benefit_1_desc', iconColor: 'bg-emerald-100 dark:bg-emerald-900/30', iconText: 'text-emerald-600 dark:text-emerald-400' },
  { icon: Shield, titleKey: 'landing.benefit_2_title', descKey: 'landing.benefit_2_desc', iconColor: 'bg-emerald-100 dark:bg-emerald-900/30', iconText: 'text-emerald-600 dark:text-emerald-400' },
  { icon: TrendingUp, titleKey: 'landing.benefit_3_title', descKey: 'landing.benefit_3_desc', iconColor: 'bg-purple-100 dark:bg-purple-900/30', iconText: 'text-purple-600 dark:text-purple-400' },
  { icon: Zap, titleKey: 'landing.benefit_4_title', descKey: 'landing.benefit_4_desc', iconColor: 'bg-amber-100 dark:bg-amber-900/30', iconText: 'text-amber-600 dark:text-amber-400' },
  { icon: Building2, titleKey: 'landing.benefit_5_title', descKey: 'landing.benefit_5_desc', iconColor: 'bg-cyan-100 dark:bg-cyan-900/30', iconText: 'text-cyan-600 dark:text-cyan-400' },
  { icon: Bell, titleKey: 'landing.benefit_6_title', descKey: 'landing.benefit_6_desc', iconColor: 'bg-pink-100 dark:bg-pink-900/30', iconText: 'text-pink-600 dark:text-pink-400' },
];

const faqItems = [
  { questionKey: 'landing.faq_1_q', answerKey: 'landing.faq_1_a' },
  { questionKey: 'landing.faq_2_q', answerKey: 'landing.faq_2_a' },
  { questionKey: 'landing.faq_3_q', answerKey: 'landing.faq_3_a' },
  { questionKey: 'landing.faq_4_q', answerKey: 'landing.faq_4_a' },
  { questionKey: 'landing.faq_5_q', answerKey: 'landing.faq_5_a' },
  { questionKey: 'landing.faq_6_q', answerKey: 'landing.faq_6_a' },
  { questionKey: 'landing.faq_7_q', answerKey: 'landing.faq_7_a' },
  { questionKey: 'landing.faq_8_q', answerKey: 'landing.faq_8_a' },
];

export default function Landing() {
  const { lang, t, toggleLanguage } = useLang();
  const { theme, toggleTheme, spin } = useTheme();
  const navigate = useNavigate();
  const isSw = lang === 'sw';
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  const SECTION_IDS = ['features', 'how-it-works', 'pricing', 'faq', 'downloads'];
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setActiveSection(e.target.id);
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const LOGIN_ROUTE = t('landing.login_route');
  const APK_PATH = t('landing.apk_path');
  const DESKTOP_PATH = 'https://drive.google.com/uc?export=download&id=13lv15mjwbsBi9uiMpR8LhSIXPb1HwFZi';
  const navigateLogin = () => navigate(LOGIN_ROUTE);
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth' }); setActiveSection(id); setMobileOpen(false); }
  };

  const plans = [
    { nameKey: 'landing.plan_starter', price: t('landing.plan_starter_price'), periodKey: 'landing.plan_starter_period', features: ['landing.pf_1', 'landing.pf_2', 'landing.pf_3', 'landing.pf_4'], ctaKey: 'landing.plan_starter_cta', popular: false },
    { nameKey: 'landing.plan_growth', price: t('landing.plan_growth_price'), currency: t('landing.plan_growth_currency'), periodKey: 'landing.plan_growth_period', features: ['landing.pf_5', 'landing.pf_6', 'landing.pf_7', 'landing.pf_8', 'landing.pf_9', 'landing.pf_10'], ctaKey: 'landing.plan_growth_cta', popular: true },
    { nameKey: 'landing.plan_enterprise', price: t('landing.plan_enterprise_price'), periodKey: '', features: ['landing.pf_11', 'landing.pf_12', 'landing.pf_13', 'landing.pf_14'], ctaKey: 'landing.plan_enterprise_cta', popular: false },
  ];

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'bg-gray-950 text-white' : 'bg-white text-gray-900'}`}>
      <style>{`
        @keyframes dash-flow {
          to { stroke-dashoffset: -100; }
        }
        .connector-path {
          stroke-dashoffset: 0;
          animation: dash-flow 1s linear infinite;
        }
      `}</style>

      {/* ── Navbar ──────────────────────────────────────────────── */}
      <nav className={`landing-nav fixed top-0 inset-x-0 z-50 ${scrolled ? 'scrolled' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <div className="flex items-center gap-3">
              <UzerLogo size={36} />
              <span className="text-lg font-bold">{t('landing.brand_name')}</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <button onClick={() => scrollTo('features')} className={`text-sm transition-all ${activeSection === 'features' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_features')}</button>
              <button onClick={() => scrollTo('how-it-works')} className={`text-sm transition-all ${activeSection === 'how-it-works' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_how_it_works')}</button>
              <button onClick={() => scrollTo('pricing')} className={`text-sm transition-all ${activeSection === 'pricing' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_pricing')}</button>
              <button onClick={() => scrollTo('faq')} className={`text-sm transition-all ${activeSection === 'faq' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_faq')}</button>
              <button onClick={() => scrollTo('downloads')} className={`text-sm transition-all ${activeSection === 'downloads' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_downloads')}</button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={toggleTheme} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${theme === 'dark' ? 'border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500' : 'border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-300'}`} aria-label={t('landing.toggle_theme')}>
                <span className="theme-toggle-icon" data-spin={spin ? 'true' : 'false'}>
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </span>
              </button>
              <button onClick={toggleLanguage} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${theme === 'dark' ? 'border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500' : 'border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-300'}`} aria-label={t('landing.toggle_lang')}>
                <Globe className="w-3.5 h-3.5 inline mr-1" />{isSw ? 'EN' : 'SW'}
              </button>
              <button onClick={navigateLogin} className="hidden sm:inline-flex px-5 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 shadow-lg shadow-emerald-400/15 transition-all btn-cta">
                {t('landing.sign_in')}
              </button>
              <button onClick={() => setMobileOpen(!mobileOpen)} className={`md:hidden w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${theme === 'dark' ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`} aria-label={t('landing.menu')}>
                {mobileOpen ? <span className="text-lg">&times;</span> : <span className="text-lg">&#9776;</span>}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className={`md:hidden border-t px-4 py-4 space-y-2 mobile-menu-enter ${theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
            <button onClick={() => scrollTo('features')} className={`block w-full text-left py-2 text-sm transition-all ${activeSection === 'features' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_features')}</button>
            <button onClick={() => scrollTo('how-it-works')} className={`block w-full text-left py-2 text-sm transition-all ${activeSection === 'how-it-works' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_how_it_works')}</button>
            <button onClick={() => scrollTo('pricing')} className={`block w-full text-left py-2 text-sm transition-all ${activeSection === 'pricing' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_pricing')}</button>
            <button onClick={() => scrollTo('faq')} className={`block w-full text-left py-2 text-sm transition-all ${activeSection === 'faq' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_faq')}</button>
            <button onClick={() => scrollTo('downloads')} className={`block w-full text-left py-2 text-sm transition-all ${activeSection === 'downloads' ? 'text-emerald-500 font-medium underline decoration-emerald-500 decoration-2 underline-offset-4' : `${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} nav-link hover:text-emerald-500`}`}>{t('landing.nav_downloads')}</button>
            <button onClick={() => { setMobileOpen(false); navigateLogin(); }} className="w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold">{t('landing.sign_in')}</button>
          </div>
        )}
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative pt-20 sm:pt-24 pb-16 sm:pb-20 min-h-[calc(100vh-4rem)] sm:min-h-[calc(100vh-5rem)] flex items-center overflow-hidden" style={{ background: 'var(--landing-hero-gradient)' }}>
        {/* Decorative floating elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl animate-float-rotate" style={{ animationDelay: '0s' }} />
          <div className="absolute -bottom-32 -left-32 w-[30rem] h-[30rem] bg-emerald-400/5 rounded-full blur-3xl animate-float-rotate" style={{ animationDelay: '-2s' }} />
          <div className="absolute top-1/3 left-1/4 w-2 h-2 rounded-full bg-emerald-400/30 animate-scale-pulse" style={{ animationDelay: '-0.5s' }} />
          <div className="absolute top-1/4 right-1/3 w-1.5 h-1.5 rounded-full bg-emerald-500/20 animate-scale-pulse" style={{ animationDelay: '-1.5s' }} />
          <div className="absolute bottom-1/3 right-1/4 w-1 h-1 rounded-full bg-emerald-400/40 animate-scale-pulse" style={{ animationDelay: '-1s' }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <AnimatedSection type="fade-left" duration={800}>
              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold leading-[1.1] tracking-tight mb-4">
                <span className="text-gray-900 dark:text-white">{t('landing.hero_title')} </span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 dark:from-emerald-400 dark:to-emerald-300 animate-gradient-shift">{t('landing.hero_title_highlight')}</span>
              </h1>
              <p className={`text-base sm:text-lg max-w-lg mb-6 leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('landing.hero_desc')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                <button onClick={navigateLogin} className="px-8 py-4 rounded-xl bg-emerald-500 text-white font-semibold text-base hover:bg-emerald-600 shadow-xl shadow-emerald-400/15 transition-all flex items-center justify-center gap-2 btn-cta animate-pulse-glow">
                  {t('landing.hero_cta_start')} <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={() => scrollTo('how-it-works')} className={`px-8 py-4 rounded-xl font-semibold text-base transition-all flex items-center justify-center gap-2 btn-cta ${theme === 'dark' ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'}`}>
                  {t('landing.hero_cta_how')} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-3 mb-10">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border ${theme === 'dark' ? 'bg-gray-800/60 border-gray-700 text-gray-300' : 'bg-emerald-50/80 border-emerald-200/60 text-emerald-800'}`}>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {t('landing.hero_free')}
                </div>
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border ${theme === 'dark' ? 'bg-gray-800/60 border-gray-700 text-gray-300' : 'bg-emerald-50/80 border-emerald-200/60 text-emerald-800'}`}>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {t('landing.hero_2min')}
                </div>
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border ${theme === 'dark' ? 'bg-gray-800/60 border-gray-700 text-gray-300' : 'bg-emerald-50/80 border-emerald-200/60 text-emerald-800'}`}>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {t('landing.hero_24_7')}
                </div>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={200} type="fade-right" duration={800}>
              <HeroAnimation lang={lang} />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className={`py-20 md:py-28 ${theme === 'dark' ? '' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up" className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-0">{t('landing.features_title')}</h2>
          </AnimatedSection>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {features.map((f, i) => {
              return (
                <AnimatedSection key={i} delay={i * 80} type="scale-up">
                  <div className={`group rounded-2xl p-6 border transition-all duration-500 hover:-translate-y-2 hover:shadow-xl h-full ${theme === 'dark' ? 'bg-gray-900/50 border-gray-800 hover:border-emerald-500/30 hover:shadow-emerald-500/5' : 'bg-white border-gray-200 hover:border-emerald-300 hover:shadow-emerald-200/30'}`}>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-all duration-500 group-hover:scale-110 group-hover:shadow-lg ${f.color} group-hover:shadow-emerald-500/10`}>
                      <f.icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-semibold mb-2">{t(f.titleKey)}</h3>
                    <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t(f.descKey)}</p>
                  </div>
                </AnimatedSection>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How It Works ───────────────────────────────────────── */}
      <section id="how-it-works" className={`py-20 md:py-28 ${theme === 'dark' ? 'bg-gray-900/30' : 'bg-gray-50'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up" className="text-center mb-16 md:mb-20">
            <p className={`font-serif italic text-2xl sm:text-3xl mb-1 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>{t('landing.how_line1')}</p>
            <h2 className="text-5xl sm:text-6xl font-bold tracking-tight">{t('landing.how_title')}</h2>
          </AnimatedSection>

          <div className="relative flex flex-col md:hidden items-center gap-10">
            {/* Step 1 */}
            <div className="flex flex-col items-center">
              <AnimatedSection delay={0} type="zoom-in">
                <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[110px] h-[110px] rounded-[18px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg relative ${theme === 'dark' ? 'bg-emerald-900/30 hover:shadow-emerald-500/10' : 'bg-emerald-100 hover:shadow-emerald-200/50'}`}>
                  <span className={`text-5xl font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>1</span>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_1')}</p>
                <p className={`text-sm text-center mt-1 max-w-[200px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_1_desc')}</p>
              </AnimatedSection>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center">
              <AnimatedSection delay={150} type="zoom-in">
                <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[110px] h-[110px] rounded-[18px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg relative ${theme === 'dark' ? 'bg-gray-100 hover:shadow-gray-500/10' : 'bg-gray-900 hover:shadow-gray-500/20'}`}>
                  <span className={`text-5xl font-bold ${theme === 'dark' ? 'text-gray-900' : 'text-white'}`}>2</span>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_2')}</p>
                <p className={`text-sm text-center mt-1 max-w-[200px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_2_desc')}</p>
              </AnimatedSection>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center">
              <AnimatedSection delay={300} type="zoom-in">
                <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[110px] h-[110px] rounded-[18px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg relative ${theme === 'dark' ? 'bg-emerald-900/30 hover:shadow-emerald-500/10' : 'bg-emerald-100 hover:shadow-emerald-200/50'}`}>
                  <span className={`text-5xl font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>3</span>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_3')}</p>
                <p className={`text-sm text-center mt-1 max-w-[200px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_3_desc')}</p>
              </AnimatedSection>
            </div>
          </div>

          {/* Desktop: 5-column grid for even distribution */}
          <div className="hidden md:grid grid-cols-5 gap-6 items-start">
            {/* Step 1 */}
            <div className="col-span-1 flex flex-col items-center">
              <AnimatedSection delay={0} type="zoom-in">
                <div className="relative">
                  <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[120px] h-[120px] rounded-[20px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg mx-auto ${theme === 'dark' ? 'bg-emerald-900/30 hover:shadow-emerald-500/10' : 'bg-emerald-100 hover:shadow-emerald-200/50'}`}>
                    <span className={`text-6xl font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>1</span>
                  </div>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_1')}</p>
                <p className={`text-sm text-center mt-1 max-w-[180px] mx-auto ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_1_desc')}</p>
              </AnimatedSection>
            </div>

            {/* Connector 1→2 */}
            <div className="col-span-1 flex items-center justify-center pt-10">
              <svg className="w-full max-w-[80px] h-12 text-emerald-400/60" viewBox="0 0 80 48" fill="none" aria-hidden="true">
                <path className="connector-path" d="M0 40 Q40 0 80 40" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" fill="none" />
              </svg>
            </div>

            {/* Step 2 */}
            <div className="col-span-1 flex flex-col items-center">
              <AnimatedSection delay={150} type="zoom-in">
                <div className="relative">
                  <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[120px] h-[120px] rounded-[20px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg mx-auto ${theme === 'dark' ? 'bg-gray-100 hover:shadow-gray-500/10' : 'bg-gray-900 hover:shadow-gray-500/20'}`}>
                    <span className={`text-6xl font-bold ${theme === 'dark' ? 'text-gray-900' : 'text-white'}`}>2</span>
                  </div>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_2')}</p>
                <p className={`text-sm text-center mt-1 max-w-[180px] mx-auto ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_2_desc')}</p>
              </AnimatedSection>
            </div>

            {/* Connector 2→3 */}
            <div className="col-span-1 flex items-center justify-center pt-10">
              <svg className="w-full max-w-[80px] h-12 text-emerald-400/60" viewBox="0 0 80 48" fill="none" aria-hidden="true">
                <path className="connector-path" d="M0 40 Q40 0 80 40" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" fill="none" />
              </svg>
            </div>

            {/* Step 3 */}
            <div className="col-span-1 flex flex-col items-center">
              <AnimatedSection delay={300} type="zoom-in">
                <div className="relative">
                  <div onClick={navigateLogin} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigateLogin(); }} className={`cursor-pointer w-[120px] h-[120px] rounded-[20px] flex items-center justify-center transition-all duration-500 hover:scale-110 hover:shadow-lg mx-auto ${theme === 'dark' ? 'bg-emerald-900/30 hover:shadow-emerald-500/10' : 'bg-emerald-100 hover:shadow-emerald-200/50'}`}>
                    <span className={`text-6xl font-bold ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>3</span>
                  </div>
                </div>
                <p className={`mt-5 text-lg font-bold text-center ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>{t('landing.step_label_3')}</p>
                <p className={`text-sm text-center mt-1 max-w-[180px] mx-auto ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.step_3_desc')}</p>
              </AnimatedSection>
            </div>
          </div>
        </div>
      </section>

      {/* ── WhatsApp Integration ───────────────────────────────── */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <AnimatedSection type="fade-left">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-8">{t('landing.wa_title')}</h2>
              <div className="space-y-4">
                {[
                  { key: 'landing.wa_check_1' },
                  { key: 'landing.wa_check_2' },
                  { key: 'landing.wa_check_3' },
                  { key: 'landing.wa_check_4' },
                ].map((item, i) => (
                  <AnimatedSection key={i} delay={i * 100} type="fade-left">
                    <div className="flex items-center gap-4 group">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-emerald-500/10">
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span className={`text-base sm:text-lg ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{t(item.key)}</span>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection delay={200} type="fade-right" className="flex justify-center">
              <PhoneMockup lang={lang} />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Benefits ───────────────────────────────────────────── */}
      <section className={`py-20 md:py-28 ${theme === 'dark' ? 'bg-gray-900/30' : 'bg-gray-50'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up" className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('landing.benefits_title')}</h2>
            <p className={`text-lg max-w-2xl mx-auto ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.benefits_desc')}</p>
          </AnimatedSection>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((b, i) => (
              <AnimatedSection key={i} delay={i * 80} type="scale-up">
                <div className={`flex items-start gap-4 p-6 rounded-2xl border transition-all duration-500 hover:-translate-y-1 group ${theme === 'dark' ? 'bg-gray-900/50 border-gray-800 hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/5' : 'bg-white border-gray-200 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-200/20'}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg ${b.iconColor}`}>
                    <b.icon className={`w-5 h-5 ${b.iconText}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold mb-1">{t(b.titleKey)}</h3>
                    <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t(b.descKey)}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <section id="pricing" className={`py-20 md:py-28 ${theme === 'dark' ? 'bg-gray-900/30' : 'bg-gray-50'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up" className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('landing.pricing_title')}</h2>
            <p className={`text-lg ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.pricing_desc')}</p>
          </AnimatedSection>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {plans.map((plan, i) => (
              <AnimatedSection key={i} delay={i * 120} type={i === 1 ? 'scale-up' : 'fade-up'}>
                <div className={`relative rounded-2xl p-7 border transition-all duration-500 hover:-translate-y-2 hover:shadow-xl h-full flex flex-col group ${plan.popular ? `border-emerald-400 shadow-lg shadow-emerald-400/10 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}` : `${theme === 'dark' ? 'bg-gray-900/50 border-gray-800 hover:border-emerald-500/30' : 'bg-white border-gray-200 hover:border-emerald-300 hover:shadow-emerald-200/20'}`}`}>
                  {plan.popular && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-emerald-500 text-white text-xs font-bold animate-pulse-glow">{t('landing.pricing_popular')}</div>}
                  <h3 className="text-lg font-bold mb-1">{t(plan.nameKey)}</h3>
                  <div className="mb-5">
                    <span className="text-3xl font-extrabold">{plan.price}</span>
                    {plan.currency && <span className={`text-sm font-medium ml-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{plan.currency}</span>}
                    <span className={`text-sm ml-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{t(plan.periodKey)}</span>
                  </div>
                  <ul className="space-y-2.5 mb-7 flex-1">
                    {plan.features.map((f, fi) => (
                      <li key={fi} className={`flex items-start gap-2.5 text-sm transition-all duration-300 ${theme === 'dark' ? 'text-gray-300 group-hover:text-gray-200' : 'text-gray-600'}`}>
                        <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />{t(f)}
                      </li>
                    ))}
                  </ul>
                  <button onClick={navigateLogin} className={`w-full py-3 rounded-xl text-sm font-semibold transition-all btn-cta ${plan.popular ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-400/15' : `${theme === 'dark' ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}`}>
                    {t(plan.ctaKey)}
                  </button>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up" className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">{t('landing.faq_title')}</h2>
            <p className={`text-lg ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.faq_desc')}</p>
          </AnimatedSection>
          <AnimatedSection type="zoom-in">
            <FAQAccordion items={faqItems.map((f) => ({ question: t(f.questionKey), answer: t(f.answerKey) }))} />
          </AnimatedSection>
        </div>
      </section>

      {/* ── Downloads ────────────────────────────────────────── */}
      <section id="downloads" className={`py-20 ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedSection type="fade-up">
            <div className="text-center mb-16">
              <h2 className={`text-3xl sm:text-4xl font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('landing.dl_title')}</h2>
              <p className={`text-lg max-w-2xl mx-auto ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.dl_subtitle')}</p>
            </div>
          </AnimatedSection>
          <div className="grid md:grid-cols-3 gap-8">
            <AnimatedSection delay={0} type="fade-up">
              <div className={`relative rounded-2xl p-8 transition-all duration-500 hover:scale-105 hover:-translate-y-2 ${theme === 'dark' ? 'bg-gray-800 border border-gray-700 hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/5' : 'bg-white border border-gray-200 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-200/20'} shadow-lg`}>
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110">
                  <Smartphone className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('landing.dl_android_title')}</h3>
                <p className={`text-sm mb-6 leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.dl_android_desc')}</p>
                <ul className="space-y-2 mb-8">
                  {[t('landing.dl_android_f1'), t('landing.dl_android_f2'), t('landing.dl_android_f3'), t('landing.dl_android_f4')].map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm transition-all duration-300 hover:translate-x-1"><Check className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>{f}</span></li>
                  ))}
                </ul>
                <a href={APK_PATH} download className="block w-full py-3 rounded-xl bg-emerald-500 text-white text-center font-semibold hover:bg-emerald-600 shadow-lg shadow-emerald-400/15 transition-all btn-cta">
                  <Download className="w-4 h-4 inline mr-2" />{t('landing.cta_download')}
                </a>
              </div>
            </AnimatedSection>
            <AnimatedSection delay={120} type="fade-up">
              <div className={`relative rounded-2xl p-8 transition-all duration-500 hover:scale-105 hover:-translate-y-2 ${theme === 'dark' ? 'bg-gray-800 border border-gray-700 hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/5' : 'bg-white border border-gray-200 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-200/20'} shadow-lg`}>
                <div className="absolute top-4 right-4"><span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wide">{t('landing.new_badge')}</span></div>
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110">
                  <Monitor className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('landing.dl_desktop_title')}</h3>
                <p className={`text-sm mb-6 leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.dl_desktop_desc')}</p>
                <ul className="space-y-2 mb-8">
                  {[t('landing.dl_desktop_f1'), t('landing.dl_desktop_f2'), t('landing.dl_desktop_f3'), t('landing.dl_desktop_f4')].map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm transition-all duration-300 hover:translate-x-1"><Check className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>{f}</span></li>
                  ))}
                </ul>
                <a href={DESKTOP_PATH} target="_blank" rel="noopener noreferrer" className="block w-full py-3 rounded-xl bg-emerald-500 text-white text-center font-semibold hover:bg-emerald-600 shadow-lg shadow-emerald-400/15 transition-all btn-cta">
                  <Download className="w-4 h-4 inline mr-2" />{t('landing.dl_download_desktop')}
                </a>
              </div>
            </AnimatedSection>
            <AnimatedSection delay={240} type="fade-up">
              <div className={`relative rounded-2xl p-8 transition-all duration-500 hover:scale-105 hover:-translate-y-2 ${theme === 'dark' ? 'bg-gray-800 border border-gray-700 hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/5' : 'bg-white border border-gray-200 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-200/20'} shadow-lg`}>
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110">
                  <Globe className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{t('landing.dl_web_title')}</h3>
                <p className={`text-sm mb-6 leading-relaxed ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{t('landing.dl_web_desc')}</p>
                <ul className="space-y-2 mb-8">
                  {[t('landing.dl_web_f1'), t('landing.dl_web_f2'), t('landing.dl_web_f3'), t('landing.dl_web_f4')].map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm transition-all duration-300 hover:translate-x-1"><Check className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>{f}</span></li>
                  ))}
                </ul>
                <button onClick={navigateLogin} className="block w-full py-3 rounded-xl bg-emerald-500 text-white text-center font-semibold hover:bg-emerald-600 shadow-lg shadow-emerald-400/15 transition-all btn-cta">
                  <ExternalLink className="w-4 h-4 inline mr-2" />{t('landing.cta_start')}
                </button>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className={`py-12 border-t ${theme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                <UzerLogo size={32} />
                <span className="text-sm font-bold">{t('landing.brand_name')}</span>
              </div>
              <p className={`text-sm leading-relaxed mb-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{t('landing.footer_desc')}</p>
              <button onClick={navigateLogin} className="px-5 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 shadow-lg shadow-emerald-400/15 transition-all btn-cta">
                {t('landing.cta_start')}
              </button>
              <p className={`text-sm mt-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}><span className="font-semibold">CONTACT:</span> +255671364144</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">{t('landing.footer_product')}</h4>
              <div className="space-y-2">
                <a href="#features" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.nav_features')}</a>
                <a href="#pricing" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.nav_pricing')}</a>
                <a href="#downloads" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.nav_downloads')}</a>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">{t('landing.footer_company')}</h4>
              <div className="space-y-2">
                <a href="#" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.footer_about')}</a>
                <a href="#" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.footer_contact')}</a>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">{t('landing.footer_legal')}</h4>
              <div className="space-y-2">
                <a href="#" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.footer_privacy')}</a>
                <a href="#" className={`block text-sm ${theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'} transition-colors`}>{t('landing.footer_terms')}</a>
              </div>
            </div>
          </div>
          <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t ${theme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}>
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>&copy; {new Date().getFullYear()} {t('landing.brand_name')}. {t('landing.footer_rights')}</p>
            <div className="flex items-center gap-4">
              <a href="#" className={`transition-colors ${theme === 'dark' ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'}`} aria-label={t('landing.aria_twitter')}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="#" className={`transition-colors ${theme === 'dark' ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'}`} aria-label={t('landing.aria_github')}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              </a>
              <a href="#" className={`transition-colors ${theme === 'dark' ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'}`} aria-label={t('landing.aria_linkedin')}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}