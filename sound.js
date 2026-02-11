/* Sound Manager using Web Audio API */
const SoundManager = {
    ctx: null,
    enabled: true,

    init() {
        if (this.ctx) return;
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        } catch (e) {
            console.warn('Web Audio API not supported');
            this.enabled = false;
        }
    },

    playTone(freq, type, duration, startTime = 0) {
        if (!this.enabled) return;
        if (!this.ctx) this.init();
        if (!this.ctx || this.ctx.state === 'suspended') {
            this.ctx?.resume();
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);

        // Envelope
        gain.gain.setValueAtTime(0, this.ctx.currentTime + startTime);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + startTime);
        osc.stop(this.ctx.currentTime + startTime + duration);
    },

    playClick() {
        // Gentle tick (Lower pitch, shorter)
        // 1200 -> 600Hz, slightly more "clicky"
        this.playTone(600, 'sine', 0.03);
    },

    playSuccess() {
        // Ascending major chime (C5, E5, G5)
        this.playTone(523.25, 'sine', 0.3, 0);
        this.playTone(659.25, 'sine', 0.3, 0.1);
        this.playTone(783.99, 'sine', 0.6, 0.2);
    },

    playError() {
        // Low descending buzz
        if (!this.enabled) return;
        if (!this.ctx) this.init();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    },

    playNotification() {
        // Bell-like (Sine with harmonics or simple high pitch)
        this.playTone(880, 'sine', 0.5);
    }
};

// Global click listener for general UI sounds
document.addEventListener('click', (e) => {
    // Play sound if clicked element is a button or link or input
    if (e.target.closest('button, a, input[type="submit"], input[type="button"], .nav-item, .quick-link-card')) {
        SoundManager.playClick();
    }
});
