// netlify/functions/revoquer-document.js

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
    const { action, document_id, admin_id, code_pin, motif, demande_par } = JSON.parse(event.body);

    if (!action || !document_id) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Action et ID document requis' }) };
    }

    // Récupérer le document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*, organisations(sous_domaine, nom)')
      .eq('id', document_id)
      .single();

    if (docError || !document) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Document non trouvé' }) };
    }

    if (document.statut === 'revoque') {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Ce document est déjà révoqué' }) };
    }

    // ========== ACTION "DEMANDER" ==========
    if (action === 'demander') {
      if (!motif) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Motif de révocation obligatoire' }) };
      }

      const { data: adminData } = await supabase
        .from('administrateurs')
        .select('role, organisation_id, email')
        .eq('id', admin_id)
        .single();

      if (!adminData || adminData.organisation_id !== document.organisation_id) {
        return { statusCode: 403, body: JSON.stringify({ erreur: 'Non autorisé' }) };
      }

      // Créer la demande de révocation
      const { data: demande, error: demandeError } = await supabase
        .from('soumissions')
        .insert({
          organisation_id: document.organisation_id,
          lot_id: `REV-${document.id_verification}-${Date.now()}`,
          soumis_par: admin_id,
          methode: 'revocation',
          type_document: document.type_document,
          nombre_documents: 1,
          statut: 'en_attente',
          details: {
            document_id: document_id,
            id_verification: document.id_verification,
            nom: document.nom,
            prenom: document.prenom,
            motif: motif,
            demande_par: admin_id
          }
        })
        .select()
        .single();

      if (demandeError) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur création demande' }) };
      }

      // Si demandé par un admin secondaire, envoyer email au Doyen
      if (adminData.role === 'secondaire') {
        const { data: doyen } = await supabase
          .from('administrateurs')
          .select('email, nom_complet')
          .eq('organisation_id', document.organisation_id)
          .eq('role', 'principal')
          .single();

        if (doyen) {
          await fetch(`${process.env.URL}/.netlify/functions/email-validation`, {
            method: 'POST',
            body: JSON.stringify({
              soumission_id: demande.id,
              organisation_id: document.organisation_id,
              email_doyen: doyen.email,
              nom_doyen: doyen.nom_complet,
              nombre_documents: 1,
              type_document: 'RÉVOCATION',
              echantillon: [{
                prenom: document.prenom,
                nom: document.nom,
                type_document: document.type_document
              }],
              sous_domaine: document.organisations?.sous_domaine
            })
          });
        }
      }

      await supabase.from('audit_logs').insert({
        organisation_id: document.organisation_id,
        action: 'demande_revocation',
        details: {
          document_id,
          id_verification: document.id_verification,
          motif,
          demande_par: admin_id
        },
        auteur: 'system',
        auteur_id: admin_id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Demande de révocation créée. En attente d\'approbation.',
          demande_id: demande.id
        })
      };
    }

    // ========== ACTION "APPROUVER" ==========
    if (action === 'approuver') {
      if (!admin_id || !code_pin) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Admin ID et code PIN requis' }) };
      }

      const { data: adminData } = await supabase
        .from('administrateurs')
        .select('role, organisation_id, code_pin_hash')
        .eq('id', admin_id)
        .single();

      if (!adminData || adminData.role !== 'principal') {
        return { statusCode: 403, body: JSON.stringify({ erreur: 'Seul l\'admin principal peut révoquer' }) };
      }

      if (adminData.organisation_id !== document.organisation_id) {
        return { statusCode: 403, body: JSON.stringify({ erreur: 'Non autorisé' }) };
      }

      const pinValide = await bcrypt.compare(code_pin, adminData.code_pin_hash);
      if (!pinValide) {
        await supabase.from('audit_logs').insert({
          organisation_id: document.organisation_id,
          action: 'code_pin_invalide_revocation',
          details: { document_id, admin_id },
          auteur: 'system',
          auteur_id: admin_id
        });
        return { statusCode: 401, body: JSON.stringify({ erreur: 'Code PIN incorrect' }) };
      }

      const maintenant = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('documents')
        .update({
          statut: 'revoque',
          revoque_par: admin_id,
          revoque_motif: motif || 'Non spécifié',
          revoque_date: maintenant
        })
        .eq('id', document_id);

      if (updateError) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur révocation' }) };
      }

      // Envoyer sur Hedera
      try {
        await fetch(`${process.env.URL}/.netlify/functions/envoyer-hedera`, {
          method: 'POST',
          body: JSON.stringify({
            hash_document: `REVOKE-${document.hash_document}-${maintenant}`,
            id_verification: document.id_verification
          })
        });
      } catch {}

      await supabase.from('audit_logs').insert({
        organisation_id: document.organisation_id,
        action: 'document_revoque',
        details: {
          document_id,
          id_verification: document.id_verification,
          nom: document.nom,
          prenom: document.prenom,
          motif: motif,
          revoque_par: admin_id,
          date_revocation: maintenant
        },
        auteur: 'system',
        auteur_id: admin_id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Document révoqué avec succès',
          document_id,
          date_revocation: maintenant
        })
      };
    }

    return { statusCode: 400, body: JSON.stringify({ erreur: 'Action inconnue. Utilisez "demander" ou "approuver"' }) };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};