// netlify/functions/signer-document.js

const { createClient } = require('@supabase/supabase-js');
const ed = require('@noble/ed25519');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Fonction pour déchiffrer la clé privée
function dechiffrerClePrivee(cleChiffreeBase64) {
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8');
  const iv = encryptionKey.slice(0, 16); // 16 premiers octets comme IV
  
  const cleChiffree = Buffer.from(cleChiffreeBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
  
  let dechiffree = decipher.update(cleChiffree);
  dechiffree = Buffer.concat([dechiffree, decipher.final()]);
  
  return dechiffree;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { organisation_id, donnees } = JSON.parse(event.body);

    if (!organisation_id || !donnees) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Organisation ID et données requis' }) };
    }

    // Récupérer la clé privée chiffrée depuis Supabase
    const { data: orgData, error: orgError } = await supabase
      .from('organisations')
      .select('cle_privee_chiffree, cle_publique')
      .eq('id', organisation_id)
      .single();

    if (orgError || !orgData) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Organisation non trouvée' }) };
    }

    // Déchiffrer la clé privée
    const clePrivee = dechiffrerClePrivee(orgData.cle_privee_chiffree);

    // Convertir les données en bytes
    const donneesBytes = Buffer.from(donnees, 'utf-8');

    // Signer avec Ed25519
    const signature = await ed.sign(donneesBytes, clePrivee);
    const signatureBase64 = Buffer.from(signature).toString('base64');

    return {
      statusCode: 200,
      body: JSON.stringify({
        signature: signatureBase64,
        cle_publique: orgData.cle_publique
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ erreur: 'Erreur lors de la signature', details: erreur.message }) 
    };
  }
};