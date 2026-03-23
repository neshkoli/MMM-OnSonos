'use strict';

/**
 * MMM-OnSonos – Shows what is playing on Sonos. Only visible when something is playing.
 * Styled like MMM-OnSpotify: album art size, fonts, transparency.
 */
Module.register('MMM-OnSonos', {
  defaults: {
    updateInterval: 5 * 1000,
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
    showProgressBar: true,
    /** 'above' = title/artist over album art (default); 'below' = legacy layout under art */
    displayMode: 'above',
    /** 'glowBlue' (default) or 'classic' (warm neutral bar) */
    progressBarStyle: 'glowBlue',
    debug: false
  },

  start() {
    this.groups = [];
    this.lastGoodTimestamp = 0;
    this.updateTimer = null;
    this._playbackSync = null;
    this._playbackUiRefs = null;
    this._playbackTickTimer = null;
    this.sendSocketNotification('ONSONOS_CONFIG', this.config);
    this.scheduleRefresh();
    this._startPlaybackClock();
  },

  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this._stopPlaybackClock();
  },

  _startPlaybackClock() {
    this._stopPlaybackClock();
    this._playbackTickTimer = setInterval(() => this._refreshPlaybackUI(), 1000);
  },

  _stopPlaybackClock() {
    if (this._playbackTickTimer) {
      clearInterval(this._playbackTickTimer);
      this._playbackTickTimer = null;
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
        this.lastGoodTimestamp = Date.now();
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

    const sourceGroups = this.groups;
    const playing = (sourceGroups || []).filter((g) => {
      const state = (g.playbackState || '').toLowerCase();
      const isPlaying = ['playing', 'transitioning', 'buffering'].includes(state);
      return isPlaying || this.config.showWhenPaused;
    });

    if (!playing.length) {
      this._playbackSync = null;
      this._playbackUiRefs = null;
      wrapper.classList.add('onsonos--hidden');
      return wrapper;
    }

    const group = playing[0];
    const syncAtMs = this.lastGoodTimestamp || Date.now();
    this._playbackSync = this._snapshotFromGroup(group, syncAtMs);
    wrapper.classList.add('onsonos--playing');
    const textAbove = String(this.config.displayMode || 'above').toLowerCase() !== 'below';
    wrapper.classList.add(textAbove ? 'onsonos--text-above' : 'onsonos--text-below');
    if (String(this.config.progressBarStyle || 'glowBlue').toLowerCase() === 'classic') {
      wrapper.classList.add('onsonos--progress-classic');
    } else {
      wrapper.classList.add('onsonos--progress-glow');
    }

    wrapper.style.setProperty('--onsonos-art-size', this._normalizeSize(this.config.albumArtSize));
    wrapper.style.setProperty('--onsonos-font-scale', String(this.config.fontScale));
    wrapper.style.setProperty('--onsonos-frame-opacity', String(this.config.frameOpacity ?? 0.72));
    wrapper.style.textAlign = this.config.textAlignment || 'center';

    const card = document.createElement('div');
    card.className = 'onsonos__card';

    const content = this._buildTrackContent(group);

    if (textAbove) {
      const frameTop = document.createElement('div');
      frameTop.className = 'onsonos__frame onsonos__frame--top';
      frameTop.appendChild(content);
      card.appendChild(frameTop);

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

      const frameBottom = document.createElement('div');
      frameBottom.className = 'onsonos__frame onsonos__frame--bottom';
      const built = this._buildPlaybackSection(group);
      frameBottom.appendChild(built.section);
      this._playbackUiRefs = built.refs;
      card.appendChild(frameBottom);
    } else {
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
      const built = this._buildPlaybackSection(group);
      frame.appendChild(built.section);
      this._playbackUiRefs = built.refs;
      frame.appendChild(content);
      card.appendChild(frame);
    }

    wrapper.appendChild(card);
    this._refreshPlaybackUI();
    return wrapper;
  },

  _buildTrackContent(group) {
    const content = document.createElement('div');
    content.className = 'onsonos__content';

    const title = document.createElement('div');
    title.className = 'onsonos__title';
    const titleText = group.title || this.translate('UNKNOWN_TRACK');
    title.textContent = titleText;
    const titleLen = titleText.length;
    if (titleLen > 25) {
      const scale = Math.max(0.62, 1 - (titleLen - 25) * 0.014);
      title.style.setProperty('--onsonos-title-scale', String(scale));
    }
    content.appendChild(title);

    if (group.artist) {
      const artist = document.createElement('div');
      artist.className = 'onsonos__artist';
      artist.textContent = group.artist;
      content.appendChild(artist);
    }

    return content;
  },

  /**
   * Bookshelf / studio monitor: rounded cabinet, smaller tweeter + larger woofer (cutouts).
   * Filled white (#fff via CSS); holes show the panel behind.
   * @returns {SVGElement}
   */
  _createSpeakerIconSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 32');
    svg.setAttribute('class', 'onsonos__speaker-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute(
      'd',
      [
        'M 9 3 H 15 Q 18 3 18 6 V 26 Q 18 29 15 29 H 9 Q 6 29 6 26 V 6 Q 6 3 9 3 Z',
        'M 12 10.5 m -2.5 0 a 2.5 2.5 0 1 1 5 0 a 2.5 2.5 0 1 1 -5 0',
        'M 12 20.5 m -3.5 0 a 3.5 3.5 0 1 1 7 0 a 3.5 3.5 0 1 1 -7 0'
      ].join(' ')
    );
    svg.appendChild(path);
    return svg;
  },

  _normalizeSize(value) {
    if (value == null) return '15em';
    if (typeof value === 'number') return `${value}px`;
    if (typeof value === 'string' && /^\d*\.?\d+(px|rem|em|vw|vh|%)?$/i.test(value.trim())) return value.trim();
    return '15em';
  },

  /**
   * Progress bar + device / time row (under album art, top of frame).
   * @returns {{ section: HTMLElement, refs: { timeEl: HTMLElement, fillEl: HTMLElement|null, barEl: HTMLElement|null } }}
   */
  _buildPlaybackSection(group) {
    const disp = this._computeInterpolatedPlayback();
    const showBar = this.config.showProgressBar !== false;
    const dur = disp.durationSec;
    const pos = disp.positionSec;
    const hasDuration = dur != null && Number.isFinite(dur) && dur > 0;
    const hasPosition = pos != null && Number.isFinite(pos) && pos >= 0;
    const showProgressTrack = showBar && hasDuration;

    const section = document.createElement('div');
    section.className = 'onsonos__playback';

    let barEl = null;
    let fillEl = null;
    if (showProgressTrack) {
      barEl = document.createElement('div');
      barEl.className = 'onsonos__progress';
      barEl.setAttribute('role', 'progressbar');
      barEl.setAttribute('aria-valuemin', '0');
      barEl.setAttribute('aria-valuemax', '100');
      fillEl = document.createElement('div');
      fillEl.className = 'onsonos__progress-fill';
      let pct = 0;
      if (hasPosition) {
        pct = Math.min(100, Math.max(0, (pos / dur) * 100));
      }
      fillEl.style.width = `${pct}%`;
      barEl.setAttribute('aria-valuenow', String(Math.round(pct)));
      barEl.appendChild(fillEl);
      section.appendChild(barEl);
    }

    const meta = document.createElement('div');
    meta.className = 'onsonos__meta';

    if (this.config.showDeviceName && group.name) {
      const wrap = document.createElement('span');
      wrap.className = 'onsonos__meta-device-wrap';
      wrap.appendChild(this._createSpeakerIconSvg());
      const device = document.createElement('span');
      device.className = 'onsonos__meta-device';
      device.textContent = group.name;
      wrap.appendChild(device);
      meta.appendChild(wrap);
    } else {
      meta.classList.add('onsonos__meta--time-only');
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'onsonos__meta-time';
    timeEl.textContent = this._formatPlaybackLabelFromValues(disp.positionSec, disp.durationSec);
    meta.appendChild(timeEl);

    section.appendChild(meta);
    return { section, refs: { timeEl, fillEl, barEl } };
  },

  _snapshotFromGroup(group, syncAtMs) {
    return {
      positionSec: group.positionSec,
      durationSec: group.durationSec,
      playbackState: group.playbackState || '',
      syncAtMs: syncAtMs || Date.now()
    };
  },

  /**
   * Advances position between API polls while playing; freezes when paused.
   * @returns {{ positionSec: number|null, durationSec: number|null }}
   */
  _computeInterpolatedPlayback() {
    const s = this._playbackSync;
    if (!s) {
      return { positionSec: null, durationSec: null };
    }
    const state = (s.playbackState || '').toLowerCase();
    const isAdvancing = ['playing', 'transitioning', 'buffering'].includes(state);

    let pos = s.positionSec;
    if (pos != null && Number.isFinite(pos) && pos >= 0) {
      /* keep */
    } else {
      pos = null;
    }

    if (!isAdvancing) {
      return { positionSec: pos, durationSec: s.durationSec };
    }

    let elapsed = (Date.now() - s.syncAtMs) / 1000;
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;

    let next = pos != null ? pos + elapsed : null;
    const dur = s.durationSec;
    if (next != null && Number.isFinite(next)) {
      if (dur != null && Number.isFinite(dur) && dur > 0) {
        next = Math.min(dur, Math.max(0, next));
      } else if (next < 0) {
        next = 0;
      }
    }

    return { positionSec: next, durationSec: s.durationSec };
  },

  _refreshPlaybackUI() {
    const refs = this._playbackUiRefs;
    if (!refs || !refs.timeEl || !this._playbackSync) return;

    const disp = this._computeInterpolatedPlayback();
    refs.timeEl.textContent = this._formatPlaybackLabelFromValues(disp.positionSec, disp.durationSec);

    if (refs.fillEl) {
      const dur = disp.durationSec;
      const pos = disp.positionSec;
      if (dur != null && Number.isFinite(dur) && dur > 0 && pos != null && Number.isFinite(pos)) {
        const pct = Math.min(100, Math.max(0, (pos / dur) * 100));
        refs.fillEl.style.width = `${pct}%`;
        if (refs.barEl) {
          refs.barEl.setAttribute('aria-valuenow', String(Math.round(pct)));
        }
      }
    }
  },

  _formatPlaybackLabelFromValues(positionSec, durationSec) {
    const unknown = this.translate('TIME_UNKNOWN');
    const left = this._formatClock(positionSec);
    const right = this._formatClock(durationSec);
    if (!left && !right) return `${unknown} / ${unknown}`;
    if (left && !right) return `${left} / ${unknown}`;
    if (!left && right) return `${unknown} / ${right}`;
    return `${left} / ${right}`;
  },

  _formatClock(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
});
