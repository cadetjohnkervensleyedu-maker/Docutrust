// netlify/functions/hacher-pin.js

const bcrypt = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { code_pin } = JSON.parse(event.body);

    if (!code_pin || code_pin.length < 4 || code_pin.length > 10) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Le code PIN doit faire entre 4 et 10 caractères' }) };
    }

    const hash = await bcrypt.hash(code_pin, 10);

    return {
      statusCode: 200,
      body: JSON.stringify({ hash: hash })
    };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};