// netlify/functions/verifier-pin.js

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { admin_id, code_pin } = JSON.parse(event.body);

    if (!admin_id || !code_pin) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Admin ID et code PIN requis' }) };
    }

    // Récupérer le hash du PIN depuis la base de données
    const { data: adminData, error } = await supabase
      .from('administrateurs')
      .select('code_pin_hash, role')
      .eq('id', admin_id)
      .single();

    if (error || !adminData) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Administrateur non trouvé' }) };
    }

    if (!adminData.code_pin_hash) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Aucun code PIN défini' }) };
    }

    // Comparer le PIN saisi avec le hash
    const valide = await bcrypt.compare(code_pin, adminData.code_pin_hash);

    // Journal d'audit
    await supabase.from('audit_logs').insert({
      action: valide ? 'code_pin_valide' : 'code_pin_invalide',
      details: { admin_id: admin_id },
      auteur: 'system',
      auteur_id: admin_id
    });

    // Si le PIN est invalide, compter les tentatives (optionnel)
    if (!valide) {
      return {
        statusCode: 401,
        body: JSON.stringify({ valide: false, erreur: 'Code PIN incorrect' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ valide: true, message: 'Code PIN vérifié avec succès' })
    };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};