// netlify/functions/gerer-admins.js

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
    const { action, admin_id, organisation_id, email, nom_complet, role } = JSON.parse(event.body);

    // ========== AJOUTER UN ADMIN ==========
    if (action === 'ajouter') {
      if (!organisation_id || !email || !nom_complet) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Données manquantes' }) };
      }

      // Vérifier que l'email n'est pas déjà utilisé
      const { data: existant } = await supabase
        .from('administrateurs')
        .select('id')
        .eq('email', email)
        .single();

      if (existant) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Cet email est déjà utilisé' }) };
      }

      // Ajouter l'admin
      const { data: nouvelAdmin, error } = await supabase
        .from('administrateurs')
        .insert({
          organisation_id: organisation_id,
          email: email,
          nom_complet: nom_complet,
          role: role || 'secondaire'
        })
        .select()
        .single();

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur ajout admin' }) };
      }

      // Inviter l'utilisateur via Supabase Auth
      await supabase.auth.admin.inviteUserByEmail(email);

      // Journal d'audit
      await supabase.from('audit_logs').insert({
        organisation_id: organisation_id,
        action: 'admin_ajoute',
        details: { email: email, role: role || 'secondaire' },
        auteur: 'admin_principal',
        auteur_id: admin_id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, admin: nouvelAdmin })
      };
    }

    // ========== SUPPRIMER UN ADMIN ==========
    if (action === 'supprimer') {
      if (!admin_id) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Admin ID requis' }) };
      }

      // Vérifier que l'admin n'est pas principal
      const { data: adminData } = await supabase
        .from('administrateurs')
        .select('role, organisation_id')
        .eq('id', admin_id)
        .single();

      if (!adminData) {
        return { statusCode: 404, body: JSON.stringify({ erreur: 'Admin non trouvé' }) };
      }

      if (adminData.role === 'principal') {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Impossible de supprimer l\'admin principal' }) };
      }

      await supabase.from('administrateurs').update({ actif: false }).eq('id', admin_id);

      await supabase.from('audit_logs').insert({
        organisation_id: adminData.organisation_id,
        action: 'admin_supprime',
        details: { admin_id: admin_id },
        auteur: 'admin_principal'
      });

      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // ========== LISTER LES ADMINS ==========
    if (action === 'lister') {
      const { data, error } = await supabase
        .from('administrateurs')
        .select('*')
        .eq('organisation_id', organisation_id)
        .eq('actif', true);

      return { statusCode: 200, body: JSON.stringify({ admins: data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ erreur: 'Action inconnue' }) };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};