// netlify/functions/inscription.js

const { createClient } = require('@supabase/supabase-js');

// Connexion à Supabase avec la clé service role (backend)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Vérifier que c'est bien une requête POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ erreur: 'Méthode non autorisée' })
    };
  }

  try {
    // Lire les données envoyées par le formulaire
    const formData = JSON.parse(event.body);

    // Vérifier que tous les champs obligatoires sont remplis
    if (!formData.nom_organisation || !formData.email_responsable || !formData.sous_domaine) {
      return {
        statusCode: 400,
        body: JSON.stringify({ erreur: 'Champs obligatoires manquants' })
      };
    }

    // Vérifier que le sous-domaine n'est pas déjà pris
    const { data: domaineExistant, error: erreurDomaine } = await supabase
      .from('organisations')
      .select('sous_domaine')
      .eq('sous_domaine', formData.sous_domaine)
      .single();

    if (domaineExistant) {
      return {
        statusCode: 400,
        body: JSON.stringify({ erreur: 'Ce sous-domaine est déjà utilisé' })
      };
    }

    // Vérifier aussi dans les demandes en attente
    const { data: demandeExistante } = await supabase
      .from('demandes_inscription')
      .select('sous_domaine')
      .eq('sous_domaine', formData.sous_domaine)
      .single();

    if (demandeExistante) {
      return {
        statusCode: 400,
        body: JSON.stringify({ erreur: 'Une demande avec ce sous-domaine est déjà en attente' })
      };
    }

    // Créer la demande dans la base de données
    const { data: demande, error } = await supabase
      .from('demandes_inscription')
      .insert({
        nom_organisation: formData.nom_organisation,
        type: formData.type,
        nif: formData.nif,
        adresse: formData.adresse,
        telephone: formData.telephone,
        nom_responsable: formData.nom_responsable,
        email_responsable: formData.email_responsable,
        fonction_responsable: formData.fonction_responsable,
        sous_domaine: formData.sous_domaine,
        doc_legal_url: formData.doc_legal_url,
        doc_identite_url: formData.doc_identite_url,
        doc_adresse_url: formData.doc_adresse_url,
        doc_lettre_url: formData.doc_lettre_url || null,
        statut: 'en_attente'
      })
      .select()
      .single();

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ erreur: 'Erreur lors de la création de la demande', details: error.message })
      };
    }

    // Envoyer un email à HaitianDev
    try {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: process.env.ADMIN_EMAIL }],
            subject: '🔔 Nouvelle demande d\'inscription - DocuTrust'
          }],
          from: { email: 'noreply@docutrust.fr', name: 'DocuTrust' },
          content: [{
            type: 'text/html',
            value: `
              <h2>Nouvelle demande d'inscription</h2>
              <p><strong>Organisation :</strong> ${formData.nom_organisation}</p>
              <p><strong>Type :</strong> ${formData.type}</p>
              <p><strong>Responsable :</strong> ${formData.nom_responsable}</p>
              <p><strong>Email :</strong> ${formData.email_responsable}</p>
              <p><strong>Sous-domaine :</strong> ${formData.sous_domaine}.docutrust.fr</p>
              <p><strong>Date :</strong> ${new Date().toLocaleDateString('fr-FR')}</p>
              <br>
              <p><a href="https://admin.docutrust.fr/demandes">Voir la demande</a></p>
            `
          }]
        })
      });
    } catch (emailError) {
      console.log('Email non envoyé (non bloquant) :', emailError.message);
    }

    // Retourner la confirmation
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Votre demande a été envoyée avec succès',
        details: 'Elle sera examinée sous 48h maximum. Vous recevrez un email de confirmation.',
        demande_id: demande.id
      })
    };

  } catch (erreur) {
    return {
      statusCode: 500,
      body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message })
    };
  }
};