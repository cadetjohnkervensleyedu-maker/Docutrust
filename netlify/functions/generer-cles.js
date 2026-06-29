// netlify/functions/generer-cles.js

const ed = require('@noble/ed25519');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    // Générer la clé privée (32 octets aléatoires)
    const clePrivee = ed.utils.randomPrivateKey();
    
    // Dériver la clé publique à partir de la clé privée
    const clePublique = await ed.getPublicKey(clePrivee);

    // Convertir en base64 pour le stockage
    const clePriveeBase64 = Buffer.from(clePrivee).toString('base64');
    const clePubliqueBase64 = Buffer.from(clePublique).toString('base64');

    return {
      statusCode: 200,
      body: JSON.stringify({
        cle_privee: clePriveeBase64,
        cle_publique: clePubliqueBase64
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ erreur: 'Erreur lors de la génération des clés', details: erreur.message }) 
    };
  }
};