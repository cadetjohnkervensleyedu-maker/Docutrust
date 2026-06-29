// netlify/functions/verifier-signature.js

const { createClient } = require('@supabase/supabase-js');
const ed = require('@noble/ed25519');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { organisation_id, donnees, signature } = JSON.parse(event.body);

    if (!organisation_id || !donnees || !signature) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ erreur: 'Organisation ID, données et signature requis' }) 
      };
    }

    // Récupérer la clé publique de l'organisation
    const { data: orgData, error: orgError } = await supabase
      .from('organisations')
      .select('cle_publique')
      .eq('id', organisation_id)
      .single();

    if (orgError || !orgData) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Organisation non trouvée' }) };
    }

    // Convertir les données
    const donneesBytes = Buffer.from(donnees, 'utf-8');
    const clePublique = Buffer.from(orgData.cle_publique, 'base64');
    const signatureBytes = Buffer.from(signature, 'base64');

    // Vérifier la signature
    const estValide = await ed.verify(signatureBytes, donneesBytes, clePublique);

    return {
      statusCode: 200,
      body: JSON.stringify({
        valide: estValide,
        message: estValide ? 'Signature valide' : 'Signature invalide'
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ erreur: 'Erreur lors de la vérification', details: erreur.message }) 
    };
  }
};