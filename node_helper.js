'use strict';

const NodeHelper = require('node_helper');
const { AsyncDeviceDiscovery, Sonos, Helpers } = require('sonos');
const path = require('node:path');

module.exports = NodeHelper.create({
  start() {
    this.config = {};
    this.coordinator = null;
    this.updateTimer = null;
    this.isDiscovering = false;

    const fallback = this._readConfigFromFile();
    if (fallback) {
      this._configure(fallback).catch((err) => {
        this._logError('Failed to start MMM-OnSonos with fallback config', err);
      });
    }
  },

  async stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  },

  socketNotificationReceived(notification, payload) {
    if (notification === 'ONSONOS_CONFIG') {
      this._configure(payload || {});
    } else if (notification === 'ONSONOS_REQUEST') {
      this._refresh();
    }
  },

  async _configure(config) {
    this.config = Object.assign(
      {
        updateInterval: 5 * 1000,
        discoveryTimeout: 5 * 1000,
        hiddenSpeakers: [],
        hiddenGroups: [],
        knownDevices: [],
        maxGroups: 1,
        showWhenPaused: false,
        forceHttps: false,
        debug: false
      },
      config
    );

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    await this._discover();
    if (!this.updateTimer) {
      this.updateTimer = setInterval(() => this._refresh(), Math.max(this.config.updateInterval, 5000));
    }
    this._refresh();
  },

  async _discover() {
    if (this.isDiscovering) return;
    this.isDiscovering = true;

    try {
      if (this.config.discoveryTimeout !== 0) {
        const discovery = new AsyncDeviceDiscovery();
        const device = await discovery.discover({ timeout: this.config.discoveryTimeout });
        if (device) {
          this.coordinator = device;
        }
      }
    } catch (err) {
      this._logError('Discovery failed', err);
    }

    if (!this.coordinator && Array.isArray(this.config.knownDevices)) {
      for (const host of this.config.knownDevices) {
        if (!host) continue;
        try {
          const device = new Sonos(host);
          await device.getCurrentState().catch(() => device.deviceDescription());
          this.coordinator = device;
          break;
        } catch (_) {}
      }
    }
    this.isDiscovering = false;
  },

  async _refresh() {
    if (!this.coordinator) {
      await this._discover();
      if (!this.coordinator) return;
    }

    try {
      const groups = await this.coordinator.getAllGroups();
      const formatted = await this._mapGroups(groups);
      this.sendSocketNotification('ONSONOS_DATA', { groups: formatted, timestamp: Date.now() });
    } catch (err) {
      this._logError('Failed to fetch Sonos data', err);
    }
  },

  _pick(source, keys) {
    if (!source) return null;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
      const k = key.toLowerCase();
      if (source[k] !== undefined && source[k] !== null) return source[k];
    }
    return null;
  },

  async _mapGroups(groups) {
    if (!Array.isArray(groups)) return [];

    const hiddenGroups = new Set((this.config.hiddenGroups || []).map((s) => s.toLowerCase()));
    const hiddenSpeakers = new Set((this.config.hiddenSpeakers || []).map((s) => s.toLowerCase()));
    const result = [];

    for (const group of groups) {
      const id = this._pick(group, ['ID', 'Id', 'id', 'ZoneGroupID', 'GroupID']);
      const name = this._pick(group, ['Name', 'name', 'ZoneGroupName', 'GroupName']) ||
        this._pick(group?.Coordinator, ['roomName', 'name']);

      const coordinator = this._coordinator(group);
      if (!coordinator) continue;

      const membersRaw = group.ZoneGroupMembers || group.ZoneGroupMember || group.members || group.children || [];
      const memberList = Array.isArray(membersRaw) ? membersRaw : (typeof membersRaw === 'object' ? Object.values(membersRaw) : []);
      const members = [];
      let skip = false;
      for (const m of memberList) {
        const displayName = this._pick(m, ['roomName', 'name', 'ZoneName']);
        if (!displayName) continue;
        if (hiddenSpeakers.has(displayName.toLowerCase())) {
          skip = true;
          break;
        }
        members.push(displayName);
      }
      if (skip) continue;
      if (hiddenGroups.has((id || '').toLowerCase()) || hiddenGroups.has((name || '').toLowerCase())) continue;

      try {
        const stateRaw = await coordinator.getCurrentState();
        const state = typeof stateRaw === 'string' ? stateRaw.toLowerCase() : 'unknown';
        if (state !== 'playing' && !this.config.showWhenPaused) continue;

        const track = await coordinator.currentTrack();
        const albumArt = await this._resolveDisplayArt(track, coordinator);
        const coordinatorName = await this._coordinatorName(coordinator);
        const { positionSec, durationSec } = this._normalizePlayback(track);

        result.push({
          id: id || coordinator.uuid || coordinator.host,
          name: name || coordinatorName || 'Sonos',
          playbackState: state,
          title: track?.title || null,
          artist: track?.artist || null,
          album: track?.album || null,
          albumArt,
          positionSec,
          durationSec,
          members: members.length ? members : [coordinatorName || name || 'Sonos']
        });
      } catch (_) {}
    }

    const max = Math.max(1, this.config.maxGroups || 1);
    return result.slice(0, max).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },

  _coordinator(group) {
    if (!group) return null;
    if (typeof group.CoordinatorDevice === 'function') {
      try {
        return group.CoordinatorDevice();
      } catch (_) {}
    }
    const c = this._pick(group, ['Coordinator', 'coordinator', 'Leader']);
    if (c && typeof c.getCurrentState === 'function') return c;
    if (group.host) return new Sonos(group.host, group.port || 1400);
    return null;
  },

  async _coordinatorName(coordinator) {
    if (!coordinator) return null;
    try {
      const d = coordinator.deviceDescription || (await coordinator.deviceDescription());
      return d?.roomName || d?.displayName || coordinator.name || coordinator.host;
    } catch (_) {
      return coordinator.name || coordinator.host;
    }
  },

  /**
   * Sonos GetPositionInfo: duration may be 0 for live/radio; position may be missing.
   * @returns {{ positionSec: number|null, durationSec: number|null }}
   */
  _normalizePlayback(track) {
    if (!track || typeof track !== 'object') {
      return { positionSec: null, durationSec: null };
    }
    const rawPos = track.position;
    const rawDur = track.duration;
    let positionSec = null;
    let durationSec = null;
    if (rawPos !== undefined && rawPos !== null && rawPos !== '') {
      const p = Number(rawPos);
      if (Number.isFinite(p) && p >= 0) positionSec = p;
    }
    if (rawDur !== undefined && rawDur !== null && rawDur !== '') {
      const d = Number(rawDur);
      if (Number.isFinite(d) && d > 0) durationSec = d;
    }
    if (positionSec != null && durationSec != null && positionSec > durationSec) {
      positionSec = durationSec;
    }
    return { positionSec, durationSec };
  },

  _normalizeArt(uri, coordinator) {
    if (!uri || typeof uri !== 'string') return null;
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) return uri;
    const proto = this.config.forceHttps ? 'https' : 'http';
    const host = coordinator?.host;
    const port = coordinator?.port || 1400;
    if (!host) return uri;
    return `${proto}://${host}:${port}${uri.startsWith('/') ? uri : '/' + uri}`;
  },

  /**
   * Track metadata (GetPositionInfo) often has no cover for radio / live streams.
   * Station or stream artwork is frequently only present on the transport URI (GetMediaInfo).
   * @param {object|null} track from Sonos.currentTrack()
   * @param {object} coordinator Sonos device
   * @returns {Promise<string|null>}
   */
  async _resolveDisplayArt(track, coordinator) {
    const primaryRaw =
      track?.albumArtURL || track?.absoluteAlbumArtURI || track?.albumArtURI || null;
    const primary = this._normalizeArt(primaryRaw, coordinator);
    if (primary) return primary;

    return this._albumArtFromDidlString(
      (await this._safeGetMediaInfo(coordinator))?.CurrentURIMetaData,
      coordinator
    );
  },

  async _safeGetMediaInfo(coordinator) {
    if (!coordinator || typeof coordinator.avTransportService !== 'function') return null;
    try {
      return await coordinator.avTransportService().GetMediaInfo();
    } catch (err) {
      this._logError('GetMediaInfo failed', err);
      return null;
    }
  },

  /**
   * @param {string|null|undefined} raw DIDL-Lite XML
   * @param {object} coordinator Sonos device
   * @returns {Promise<string|null>}
   */
  async _albumArtFromDidlString(raw, coordinator) {
    if (!raw || typeof raw !== 'string' || raw === 'NOT_IMPLEMENTED') return null;
    try {
      const parsed = await Helpers.ParseXml(raw);
      return this._firstAlbumArtFromParsedDidl(parsed, coordinator);
    } catch (err) {
      this._logError('DIDL parse failed (GetMediaInfo CurrentURIMetaData)', err);
      return null;
    }
  },

  /**
   * @param {object} parsed result of Helpers.ParseXml on DIDL
   * @param {object} coordinator Sonos device
   * @returns {string|null}
   */
  _firstAlbumArtFromParsedDidl(parsed, coordinator) {
    const lite = parsed && parsed['DIDL-Lite'];
    if (!lite) return null;
    let items = lite.item;
    if (!items) return null;
    if (!Array.isArray(items)) items = [items];
    const host = coordinator?.host;
    const port = coordinator?.port || 1400;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const t = Helpers.ParseDIDLItem(item, host, port);
      const uri = t && t.albumArtURI;
      if (uri) {
        const normalized = this._normalizeArt(uri, coordinator);
        if (normalized) return normalized;
      }
    }
    return null;
  },

  _readConfigFromFile() {
    try {
      const configPath = path.resolve(__dirname, '..', '..', 'config', 'config.js');
      delete require.cache[configPath];
      const full = require(configPath);
      const entry = (full.modules || []).find((m) => m.module === 'MMM-OnSonos');
      return entry?.config ? { ...entry.config } : null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Logs only when config.debug is true. Does not notify the browser (no error overlay).
   */
  _logError(context, err) {
    if (!this.config.debug) return;
    const msg = err?.message || err || 'Unknown error';
    console.warn(`[MMM-OnSonos] ${context}:`, msg);
  }
});
