// netlify/functions/upload-fichiers.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { action, bucket, fichier_base64, nom_fichier, dossier } = JSON.parse(event.body);

    if (!bucket || !fichier_base64 || !nom_fichier) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Bucket, fichier et nom requis' }) };
    }

    // Déterminer le chemin
    const chemin = dossier ? `${dossier}/${nom_fichier}` : nom_fichier;

    // Convertir base64 en buffer
    const buffer = Buffer.from(fichier_base64, 'base64');

    // Upload vers Supabase Storage
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .upload(chemin, buffer, {
        upsert: true,
        contentType: nom_fichier.endsWith('.pdf') ? 'application/pdf' : 'image/png'
      });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur upload', details: error.message }) };
    }

    // Obtenir l'URL publique
    const { data: urlData } = supabase
      .storage
      .from(bucket)
      .getPublicUrl(chemin);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        url: urlData.publicUrl,
        chemin: chemin
      })
    };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};