// netlify/functions/validation.js

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
    const { action, soumission_id, token, admin_id, code_pin, motif_refus } = JSON.parse(event.body);

    if (!action || !soumission_id) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Action et ID soumission requis' }) };
    }

    // ========== ACTION "VOIR" ==========
    if (action === 'voir') {
      const { data: soumission, error } = await supabase
        .from('soumissions')
        .select('*, organisations(nom, sous_domaine)')
        .eq('id', soumission_id)
        .single();

      if (error || !soumission) {
        return { statusCode: 404, body: JSON.stringify({ erreur: 'Soumission non trouvée' }) };
      }

      if (token) {
        const tokenStocke = soumission.details?.token_validation;
        if (!tokenStocke || tokenStocke !== token) {
          return { statusCode: 403, body: JSON.stringify({ erreur: 'Token de validation invalide' }) };
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          soumission: {
            id: soumission.id,
            lot_id: soumission.lot_id,
            methode: soumission.methode,
            type_document: soumission.type_document,
            nombre_documents: soumission.nombre_documents,
            format_nommage: soumission.format_nommage,
            statut: soumission.statut,
            date_soumission: soumission.date_soumission,
            organisation: soumission.organisations
          }
        })
      };
    }

    // ========== ACTION "APPROUVER" ==========
    if (action === 'approuver') {
      if (!admin_id || !code_pin) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Admin ID et code PIN requis' }) };
      }

      const { data: soumission } = await supabase
        .from('soumissions')
        .select('details, organisation_id, lot_id, nombre_documents')
        .eq('id', soumission_id)
        .single();

      if (!soumission) {
        return { statusCode: 404, body: JSON.stringify({ erreur: 'Soumission non trouvée' }) };
      }

      if (token) {
        const tokenStocke = soumission.details?.token_validation;
        if (!tokenStocke || tokenStocke !== token) {
          return { statusCode: 403, body: JSON.stringify({ erreur: 'Token de validation invalide ou expiré' }) };
        }
      }

      const { data: adminData } = await supabase
        .from('administrateurs')
        .select('code_pin_hash, role, organisation_id')
        .eq('id', admin_id)
        .single();

      if (!adminData?.code_pin_hash) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Aucun code PIN défini' }) };
      }

      const pinValide = await bcrypt.compare(code_pin, adminData.code_pin_hash);
      if (!pinValide) {
        await supabase.from('audit_logs').insert({
          organisation_id: soumission.organisation_id,
          action: 'code_pin_invalide',
          details: { soumission_id, admin_id },
          auteur: 'system',
          auteur_id: admin_id
        });
        return { statusCode: 401, body: JSON.stringify({ erreur: 'Code PIN incorrect' }) };
      }

      if (adminData.role !== 'principal') {
        return { statusCode: 403, body: JSON.stringify({ erreur: 'Seul l\'admin principal peut approuver' }) };
      }

      const { error: updateError } = await supabase
        .from('soumissions')
        .update({
          statut: 'en_traitement',
          approuve_par: admin_id,
          code_pin_utilise: true,
          date_approbation: new Date().toISOString()
        })
        .eq('id', soumission_id);

      if (updateError) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur mise à jour soumission' }) };
      }

      await supabase.from('audit_logs').insert({
        organisation_id: soumission.organisation_id,
        action: 'soumission_approuvee',
        details: {
          soumission_id,
          lot_id: soumission.lot_id,
          approuve_par: admin_id,
          nombre_documents: soumission.nombre_documents
        },
        auteur: 'system',
        auteur_id: admin_id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Soumission approuvée. Traitement en cours...',
          soumission_id,
          statut: 'en_traitement'
        })
      };
    }

    // ========== ACTION "REFUSER" ==========
    if (action === 'refuser') {
      if (!motif_refus) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Motif de refus obligatoire' }) };
      }

      const { data: soumissionActuelle } = await supabase
        .from('soumissions')
        .select('details, organisation_id, lot_id')
        .eq('id', soumission_id)
        .single();

      if (!soumissionActuelle) {
        return { statusCode: 404, body: JSON.stringify({ erreur: 'Soumission non trouvée' }) };
      }

      const detailsActuels = soumissionActuelle.details || {};
      detailsActuels.motif_refus = motif_refus;
      detailsActuels.date_refus = new Date().toISOString();
      detailsActuels.refuse_par = admin_id;

      const { error: updateError } = await supabase
        .from('soumissions')
        .update({
          statut: 'refuse',
          approuve_par: admin_id,
          details: detailsActuels
        })
        .eq('id', soumission_id);

      if (updateError) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur mise à jour soumission' }) };
      }

      await supabase.from('audit_logs').insert({
        organisation_id: soumissionActuelle.organisation_id,
        action: 'soumission_refusee',
        details: {
          soumission_id,
          lot_id: soumissionActuelle.lot_id,
          refuse_par: admin_id,
          motif: motif_refus
        },
        auteur: 'system',
        auteur_id: admin_id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Soumission refusée',
          motif: motif_refus
        })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ erreur: 'Action inconnue. Utilisez "voir", "approuver" ou "refuser"' }) };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};
