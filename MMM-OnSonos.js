'use strict';

/**
 * MMM-OnSonos – Shows what is playing on Sonos. Only visible when something is playing.
 * Styled like MMM-OnSpotify: album art size, fonts, transparency.
 */
Module.register('MMM-OnSonos', {
  defaults: {
    updateInterval: 15 * 1000,
    discoveryTimeout: 5 * 1000,
    hiddenSpeakers: [],
    hiddenGroups: [],
    knownDevices: [],
    maxGroups: 1,
    albumArtSize: '15em',
    fontScale: 1,
    textAlignment: 'center',
    showWhenPaused: false,
    forceHttps: false,
    frameOpacity: 0.72,
    showDeviceName: true,
    debug: false
  },

  start() {
    this.groups = [];
    this.lastGoodGroups = [];
    this.lastGoodTimestamp = 0;
    this.error = null;
    this.updateTimer = null;
    this.sendSocketNotification('ONSONOS_CONFIG', this.config);
    this.scheduleRefresh();
  },

  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  },

  scheduleRefresh() {
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.updateTimer = setInterval(() => {
      this.sendSocketNotification('ONSONOS_REQUEST');
    }, Math.max(this.config.updateInterval, 5000));
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case 'ONSONOS_DATA':
        this.groups = payload.groups || [];
        this.lastGoodGroups = this.groups.slice();
        this.lastGoodTimestamp = Date.now();
        this.error = null;
        this.updateDom();
        break;
      case 'ONSONOS_ERROR':
        this.error = payload;
        this.updateDom();
        break;
    }
  },

  getStyles() {
    return ['MMM-OnSonos.css'];
  },

  getTranslations() {
    return { en: 'translations/en.json' };
  },

  getDom() {
    const wrapper = document.createElement('div');
    wrapper.className = 'onsonos';

    const staleThreshold = 5 * this.config.updateInterval;
    const useStaleData = this.error && this.lastGoodGroups.length > 0 &&
      (Date.now() - this.lastGoodTimestamp) <= staleThreshold;

    if (this.error && !useStaleData) {
      wrapper.classList.add('onsonos--error');
      wrapper.innerText = `${this.translate('ERROR')}: ${this.error.message || this.error}`;
      return wrapper;
    }

    const sourceGroups = useStaleData ? this.lastGoodGroups : this.groups;
    const playing = (sourceGroups || []).filter((g) => {
      const state = (g.playbackState || '').toLowerCase();
      const isPlaying = ['playing', 'transitioning', 'buffering'].includes(state);
      return isPlaying || this.config.showWhenPaused;
    });

    if (!playing.length) {
      wrapper.classList.add('onsonos--hidden');
      return wrapper;
    }

    const group = playing[0];
    wrapper.classList.add('onsonos--playing');
    wrapper.style.setProperty('--onsonos-art-size', this._normalizeSize(this.config.albumArtSize));
    wrapper.style.setProperty('--onsonos-font-scale', String(this.config.fontScale));
    wrapper.style.setProperty('--onsonos-frame-opacity', String(this.config.frameOpacity ?? 0.72));
    wrapper.style.textAlign = this.config.textAlignment || 'center';

    const card = document.createElement('div');
    card.className = 'onsonos__card';

    if (group.albumArt) {
      const art = document.createElement('div');
      art.className = 'onsonos__art';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = group.albumArt;
      img.alt = (group.title || '').trim() || 'Album art';
      art.appendChild(img);
      card.appendChild(art);
    }

    const frame = document.createElement('div');
    frame.className = 'onsonos__frame';

    const content = document.createElement('div');
    content.className = 'onsonos__content';

    const title = document.createElement('div');
    title.className = 'onsonos__title';
    title.textContent = group.title || this.translate('UNKNOWN_TRACK');
    content.appendChild(title);

    if (group.artist) {
      const artist = document.createElement('div');
      artist.className = 'onsonos__artist';
      artist.textContent = group.artist;
      content.appendChild(artist);
    }

    if (this.config.showDeviceName && group.name) {
      const device = document.createElement('div');
      device.className = 'onsonos__device';
      device.textContent = group.name;
      content.appendChild(device);
    }

    frame.appendChild(content);
    card.appendChild(frame);
    wrapper.appendChild(card);
    return wrapper;
  },

  _normalizeSize(value) {
    if (value == null) return '15em';
    if (typeof value === 'number') return `${value}px`;
    if (typeof value === 'string' && /^\d*\.?\d+(px|rem|em|vw|vh|%)?$/i.test(value.trim())) return value.trim();
    return '15em';
  }
});
