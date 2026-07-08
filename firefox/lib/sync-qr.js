(function(global) {
  'use strict';

  const QR_ERROR_CORRECTION = 'M';
  const QR_CELL_SIZE = 5;
  const QR_MARGIN = 20;

  function utf8ToBase64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function encodePairingPayload(payload) {
    return utf8ToBase64Url(JSON.stringify(payload));
  }

  function renderPairingSvg(payload) {
    if (typeof qrcode !== 'function') throw new Error('QR library is unavailable.');
    const qr = qrcode(0, QR_ERROR_CORRECTION);
    qr.addData(JSON.stringify(payload), 'Byte');
    qr.make();
    return qr.createSvgTag({
      cellSize: QR_CELL_SIZE,
      margin: QR_MARGIN,
      scalable: true,
      title: 'Magnetar Sync pairing QR',
      alt: 'Pairing code for Magnetar Mobile'
    });
  }

  global.MagnetarSyncQr = Object.freeze({
    encodePairingPayload,
    renderPairingSvg
  });
})(globalThis);