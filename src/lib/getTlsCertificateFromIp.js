// gettlscertificatefromip.js
import tls from 'tls';

export async function getTlsCertificateFromIp(ip, opts = {}) {
  const {
    port = 443,
    servername = null,         // ← SNI (kandidaat-domein) of null
    timeout = 3000
  } = opts;

  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: ip,
        port,
        servername: servername || undefined, // alleen meesturen als je er één hebt
        rejectUnauthorized: false,
        timeout
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          socket.end();

          // Geen bruikbare info? Geef null terug (caller logt dan NIET).
          const cn = cert?.subject?.CN || null;
          const san = cert?.subjectaltname || cert?.subjectAltName || null;
          if (!cn && !san) return resolve(null);

          resolve({
            commonName: cn,
            subjectAltName: san,
            port,                // handig voor logging
            sni: !!servername    // true als we SNI hebben gebruikt
          });
        } catch {
          resolve(null);
        }
      }
    );

    const bail = () => { try { socket.destroy(); } catch {} resolve(null); };
    socket.on('error', bail);
    socket.on('timeout', bail);
    socket.setTimeout(timeout, bail);
  });
}
