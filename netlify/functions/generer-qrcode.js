// netlify/functions/generer-qrcode.js

const QRCode = require('qrcode');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { id_verification, donnees, hash, signature } = JSON.parse(event.body);

    if (!id_verification) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'ID de vérification requis' }) };
    }

    // Construire les données à inclure dans le QR code
    // S'adapte à TOUS les types de documents
    const donneesQR = {
      id: id_verification,
      hash: hash || null,
      signature: signature || null,
      donnees: donnees || {} // ← Stocke TOUT le JSON retourné par analyser-pdf.js
    };

    // Encoder les données en base64url pour l'URL
    const donneesEncodees = Buffer.from(JSON.stringify(donneesQR)).toString('base64url');

    // Créer l'URL complète
    const urlVerification = `https://docutrust.fr/v?id=${id_verification}&d=${donneesEncodees}`;

    // Générer l'image QR code en base64
    const qrcodeBase64 = await QRCode.toDataURL(urlVerification, {
      width: 300,
      margin: 2,
      color: {
        dark: '#0A1628',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        qrcode_image: qrcodeBase64,
        url: urlVerification,
        id_verification: id_verification,
        taille_donnees: donneesEncodees.length
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ erreur: 'Erreur lors de la génération du QR code', details: erreur.message }) 
    };
  }
};