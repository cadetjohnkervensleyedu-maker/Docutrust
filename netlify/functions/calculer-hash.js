// netlify/functions/calculer-hash.js

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { contenu_pdf, donnees_extraits } = JSON.parse(event.body);

    if (!contenu_pdf) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Contenu du PDF requis' }) };
    }

    // Créer le hash SHA-256
    const hash = crypto.createHash('sha256');
    
    // Ajouter le contenu du PDF
    hash.update(contenu_pdf);
    
    // Ajouter les données extraites (si disponibles)
    if (donnees_extraits) {
      hash.update(JSON.stringify(donnees_extraits));
    }

    // Obtenir le hash final
    const hashFinal = hash.digest('hex');

    return {
      statusCode: 200,
      body: JSON.stringify({
        hash: hashFinal,
        algorithme: 'SHA-256'
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ erreur: 'Erreur lors du calcul du hash', details: erreur.message }) 
    };
  }
};