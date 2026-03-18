# MMM-OnSonos

A minimal MagicMirror² module that shows **what is currently playing on Sonos**.  
It only appears when something is playing; when nothing is playing, nothing is shown.

Styled to match **MMM-OnSpotify**: album art size (~15em), clear typography, and semi-transparent card background.

## Installation

```bash
cd ~/MagicMirror/modules
git clone <this-repo> MMM-OnSonos
cd MMM-OnSonos
npm install
```

## Configuration

Add to `config/config.js`:

```javascript
{
  module: 'MMM-OnSonos',
  position: 'bottom_right',
  config: {
    updateInterval: 15000,
    discoveryTimeout: 5000,
    knownDevices: ['192.168.1.100'],  // optional, for faster discovery
    albumArtSize: '15em',
    fontScale: 1,
    textAlignment: 'center',
    showWhenPaused: false,
    hiddenSpeakers: [],
    hiddenGroups: [],
    maxGroups: 1,
    showDeviceName: true,
    debug: false
  }
}
```

- **albumArtSize**: e.g. `'15em'`, `80`, `'120px'` – same feel as OnSpotify when using `15em`.
- **fontScale**: overall text scale.
- **textAlignment**: `'center'`, `'left'`, or `'right'`.
- **showWhenPaused**: if `true`, show the card when playback is paused.
- **showDeviceName**: if `false`, hide the speaker/room name (e.g. “Kitchen”) under the artist.
- **maxGroups**: number of groups to show (default `1` = single “now playing” card).

## Behaviour

- **Hide when nothing playing**: No message is shown when nothing is playing; the module area is hidden.
- **Single card**: By default only the first playing group is shown, in one card with album art, title, artist, and (optionally) device name.
- **Communication errors**: If the node helper reports an error (e.g. Sonos unreachable), the module keeps showing the last known track for **5 × updateInterval** (e.g. 75 seconds when `updateInterval` is 15 s). After that, the error message is shown.
- **Discovery**: Uses Sonos discovery; optionally set `knownDevices` with speaker IPs for quicker startup.

## Security

The `sonos` dependency pulls in `ip`, which has a known SSRF advisory ([GHSA-2p57-rm9w-gvfp](https://github.com/advisories/GHSA-2p57-rm9w-gvfp)). This module applies a **patch** (see `patches/ip+2.0.1.patch`) so that non-canonical IP formats are normalized before classification, fixing the issue. The patch is applied automatically after `npm install` via `patch-package`. `npm audit` may still list the advisory because it only checks package versions; the runtime code is patched.

**Do not run `npm audit fix --force`** in this module: it would downgrade `sonos` to 0.6.x, which uses a different API and will break the module. Use the patched `sonos@^1.14.1` and rely on the `ip` patch above.

## Credits

Based on [MMM-Sonos](https://github.com/matskkolstad/MMM-Sonos). Visual style inspired by [MMM-OnSpotify](https://github.com/Fabrizz/MMM-OnSpotify).
