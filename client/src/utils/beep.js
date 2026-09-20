// Shared Web-Audio beep. No asset needed.
// Browsers suspend the AudioContext until a user gesture; we unlock/resume it on
// the first interaction so scan-triggered beeps are reliable ("sometimes no sound").
let ctx = null;

export const resumeAudio = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

// Unlock audio on the first real user gesture (pointer/key/touch). Runs once.
const unlock = () => {
  const c = resumeAudio();
  if (c && c.state === 'suspended') c.resume();
};
if (typeof document !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, unlock, { once: true, passive: true })
  );
}

export const playBeep = ({ freq = 1320, volume = 1.0, type = 'square', duration = 0.18 } = {}) => {
  try {
    const c = resumeAudio() || ctx;
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // Smooth attack/release to avoid clicks/pops.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.setValueAtTime(volume, now + duration - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch {}
};
