import tls from 'tls';

export async function getTlsCertificateFromIp(ip) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: ip,
      port: 443,
      rejectUnauthorized: false,
      timeout: 3000
    }, () => {
      const cert = socket.getPeerCertificate(true);
      socket.end();

      if (!cert || !cert.subject) return resolve(null);

      resolve({
        commonName: cert.subject.CN || null,
        subjectAltName: cert.subjectaltname || null
      });
    });

    socket.on('error', (err) => {
      resolve(null); // geen certificaat = geen probleem
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}
