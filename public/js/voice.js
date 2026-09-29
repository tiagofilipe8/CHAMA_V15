// Vos dicta et notificacoes por voz no navegador (Web Speech API)
const Voice = {
  enabled: true,
  newTicketVoice: true,
  speaking: false,

  init(settings) {
    this.enabled = settings['app.voice_enabled'] !== false;
    this.newTicketVoice = settings['app.voice_new_ticket'] !== false;
  },

  supported() {
    return 'speechSynthesis' in window;
  },

  // Emite um alerta sonoro curto (beep) mesmo sem voz customizada
  beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 660;
        gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.25);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.25);
        osc.stop(ctx.currentTime + i * 0.25 + 0.23);
      }
      setTimeout(() => ctx.close(), 900);
    } catch { /* ignore */ }
  },

  speak(text) {
    if (!this.enabled || !this.supported()) return;
    try {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'pt-BR';
      utter.rate = 1.05;
      // prefere uma voz pt-BR quando disponivel
      const voices = speechSynthesis.getVoices();
      const pt = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('pt'));
      if (pt) utter.voice = pt;
      speechSynthesis.speak(utter);
    } catch { /* ignore */ }
  },

  announceNewTicket(ticket) {
    this.beep();
    if (this.newTicketVoice) {
      this.speak(`Novo chamado ${ticket.number || ''} aberto por ${ticket.requester_name || ''}. ${ticket.title || ''}`);
    }
  },
};