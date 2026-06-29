// netlify/functions/creer-organisation.js

const { createClient } = require('@supabase/supabase-js');
const ed = require('@noble/ed25519');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function chiffrerClePrivee(clePrivee) {
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8');
  const iv = encryptionKey.slice(0, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  let chiffree = cipher.update(clePrivee);
  chiffree = Buffer.concat([chiffree, cipher.final()]);
  return chiffree.toString('base64');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { demande_id } = JSON.parse(event.body);

    // Récupérer la demande d'inscription
    const { data: demande, error: demandeError } = await supabase
      .from('demandes_inscription')
      .select('*')
      .eq('id', demande_id)
      .single();

    if (demandeError || !demande) {
      return { statusCode: 404, body: JSON.stringify({ erreur: 'Demande non trouvée' }) };
    }

    // Générer les clés Ed25519
    const clePrivee = ed.utils.randomPrivateKey();
    const clePublique = await ed.getPublicKey(clePrivee);
    const clePriveeBase64 = Buffer.from(clePrivee).toString('base64');
    const clePubliqueBase64 = Buffer.from(clePublique).toString('base64');
    const clePriveeChiffree = chiffrerClePrivee(Buffer.from(clePriveeBase64, 'base64'));

    // Déterminer la limite selon le plan
    const limites = { basic: 500, pro: 2000, enterprise: 999999 };

    // Créer l'organisation
    const { data: organisation, error: orgError } = await supabase
      .from('organisations')
      .insert({
        nom: demande.nom_organisation,
        type: demande.type,
        nif: demande.nif,
        adresse: demande.adresse,
        telephone: demande.telephone,
        email_officiel: demande.email_responsable,
        sous_domaine: demande.sous_domaine,
        cle_publique: clePubliqueBase64,
        cle_privee_chiffree: clePriveeChiffree,
        statut: 'actif',
        plan: 'basic',
        limite_docs: limites.basic
      })
      .select()
      .single();

    if (orgError) {
      return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur création organisation', details: orgError.message }) };
    }

    // Mettre à jour la demande
    await supabase
      .from('demandes_inscription')
      .update({
        statut: 'accepte',
        traite_le: new Date().toISOString(),
        traite_par: 'HaitianDev'
      })
      .eq('id', demande_id);

    // Journal d'audit
    await supabase.from('audit_logs').insert({
      organisation_id: organisation.id,
      action: 'organisation_creee',
      details: { nom: demande.nom_organisation, sous_domaine: demande.sous_domaine },
      auteur: 'HaitianDev'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        organisation: organisation,
        cle_publique: clePubliqueBase64,
        message: 'Organisation créée avec succès'
      })
    };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};