// netlify/functions/email-validation.js

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const {
      soumission_id,
      organisation_id,
      email_doyen,
      nom_doyen,
      nombre_documents,
      type_document,
      echantillon,
      sous_domaine
    } = JSON.parse(event.body);

    if (!soumission_id || !email_doyen || !organisation_id) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'soumission_id, email_doyen et organisation_id requis' }) };
    }

    const token = crypto.randomBytes(32).toString('hex');

    const { data: soumissionActuelle, error: lectureErreur } = await supabase
      .from('soumissions')
      .select('details')
      .eq('id', soumission_id)
      .single();

    if (lectureErreur) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Soumission introuvable' }) };
    }

    const detailsActuels = soumissionActuelle.details || {};
    detailsActuels.token_validation = token;
    detailsActuels.token_cree_le = new Date().toISOString();
    detailsActuels.token_expire_le = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await supabase
      .from('soumissions')
      .update({ details: detailsActuels })
      .eq('id', soumission_id);

    const lienValidation = `https://${sous_domaine || 'docutrust.fr'}/valider?id=${soumission_id}&token=${token}`;

    let echantillonHtml = '';
    if (Array.isArray(echantillon) && echantillon.length > 0) {
      echantillonHtml = echantillon
        .map(doc => `<li>${doc.prenom || ''} ${doc.nom || ''} - ${doc.type_document || type_document || 'Document'}</li>`)
        .join('');
    }

    const dateSoumission = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F8FAFC;">
  <div style="background-color: #0A1628; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: #FFFFFF; margin: 0; font-size: 20px;">DocuTrust</h1>
  </div>
  <div style="background-color: #FFFFFF; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <h2 style="color: #0A1628; margin-top: 0;">Documents en attente de validation</h2>
    <p style="color: #1E293B;">Bonjour ${nom_doyen || 'Admin'},</p>
    <p style="color: #1E293B;">Une soumission de documents est en attente de votre approbation.</p>
    <div style="background-color: #F1F5F9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>📄 Nombre :</strong> ${nombre_documents || 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>📋 Type :</strong> ${type_document || 'N/A'}</p>
      <p style="margin: 5px 0;"><strong>🕐 Soumis le :</strong> ${dateSoumission}</p>
    </div>
    ${echantillonHtml ? `
    <div style="background-color: #F1F5F9; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p><strong>👁️ Échantillon :</strong></p>
      <ul style="padding-left: 20px;">${echantillonHtml}</ul>
      ${nombre_documents > 3 ? `<p style="color: #64748B; font-style: italic;">... et ${nombre_documents - 3} autres</p>` : ''}
    </div>` : ''}
    <div style="text-align: center; margin: 30px 0;">
      <a href="${lienValidation}" style="display: inline-block; background-color: #0A1628; color: #FFFFFF; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">🔍 Voir et approuver</a>
    </div>
    <div style="border-top: 1px solid #E2E8F0; padding-top: 15px; margin-top: 20px;">
      <p style="color: #64748B; font-size: 12px; margin: 3px 0;">⚠️ Ce lien est personnel et expire dans 48 heures.</p>
      <p style="color: #64748B; font-size: 12px; margin: 3px 0;">🔐 L'approbation nécessite votre code PIN.</p>
    </div>
  </div>
</body>
</html>`;

    const brevoResponse = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'DocuTrust',
          email: 'soumission@docutrust.com'
        },
        to: [{
          email: email_doyen,
          name: nom_doyen || ''
        }],
        subject: `🔔 ${nombre_documents || ''} documents en attente - DocuTrust`,
        htmlContent: emailHtml
      })
    });

    const emailEnvoye = brevoResponse.ok;

    await supabase.from('audit_logs').insert({
      organisation_id,
      action: 'email_validation_envoye',
      details: {
        soumission_id,
        destinataire: email_doyen,
        nombre_documents,
        email_envoye: emailEnvoye
      },
      auteur: 'system'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: emailEnvoye ? 'Email envoyé avec succès' : 'Erreur envoi email',
        email_envoye: emailEnvoye,
        token: token
      })
    };

  } catch (erreur) {
    return {
      statusCode: 500,
      body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message })
    };
  }
};