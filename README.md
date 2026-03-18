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
    debug: false
  }
}
```

- **albumArtSize**: e.g. `'15em'`, `80`, `'120px'` – same feel as OnSpotify when using `15em`.
- **fontScale**: overall text scale.
- **textAlignment**: `'center'`, `'left'`, or `'right'`.
- **showWhenPaused**: if `true`, show the card when playback is paused.
- **maxGroups**: number of groups to show (default `1` = single “now playing” card).

## Behaviour

- **Hide when nothing playing**: No message is shown when nothing is playing; the module area is hidden.
- **Single card**: By default only the first playing group is shown, in one card with album art, title, artist, and device name.
- **Discovery**: Uses Sonos discovery; optionally set `knownDevices` with speaker IPs for quicker startup.

## Credits

Based on [MMM-Sonos](https://github.com/matskkolstad/MMM-Sonos). Visual style inspired by [MMM-OnSpotify](https://github.com/Fabrizz/MMM-OnSpotify).
