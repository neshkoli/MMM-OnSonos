'use strict';

/**
 * Minimal stub so `require('ip')` resolves after npm overrides.
 * The `sonos` package is patched to use `os.networkInterfaces()` instead.
 */
const os = require('os');

function address (name, family) {
  if (name === 'public' || name === 'private' || !name) {
    const ifaces = os.networkInterfaces();
    for (const nic of Object.keys(ifaces)) {
      for (const details of ifaces[nic]) {
        if (details.family !== 'IPv4' && details.family !== 4) continue;
        const addr = details.address;
        if (addr.startsWith('127.')) continue;
        if (name === 'public') {
          if (addr.startsWith('10.') || addr.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return addr;
        } else if (name === 'private') {
          if (!addr.startsWith('10.') && !addr.startsWith('192.168.') && !/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return addr;
        } else {
          return addr;
        }
      }
    }
  }
  return '127.0.0.1';
}

module.exports = {
  address,
  isPrivate: () => false,
  isPublic: () => true,
  isLoopback: () => false
};
