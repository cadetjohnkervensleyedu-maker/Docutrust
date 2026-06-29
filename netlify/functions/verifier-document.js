// netlify/functions/verifier-document.js

const { createClient } = require('@supabase/supabase-js');
const ed = require('@noble/ed25519');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const id_verification = event.queryStringParameters?.id;

    if (!id_verification) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: 'erreur', message: 'ID de vérification requis' })
      };
    }

    // Chercher le document
    const { data: document, error } = await supabase
      .from('documents')
      .select('*, organisations(nom, cle_publique, sous_domaine, logo_url)')
      .eq('id_verification', id_verification)
      .single();

    if (error || !document) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statut: 'fraude',
          message: '❌ Aucun document trouvé avec cet ID',
          details: 'Ce document n\'existe pas dans le registre officiel. Il peut s\'agir d\'un faux document ou d\'un QR code falsifié.'
        })
      };
    }

    // Vérifier la signature
    let signatureValide = false;
    try {
      const donneesBytes = Buffer.from(
        document.hash_document + JSON.stringify(document.donnees_extraits || {}),
        'utf-8'
      );
      const clePublique = Buffer.from(document.organisations?.cle_publique || '', 'base64');
      const signatureBytes = Buffer.from(document.signature_base64 || '', 'base64');
      signatureValide = await ed.verify(signatureBytes, donneesBytes, clePublique);
    } catch {
      signatureValide = false;
    }

    // Incrémenter le compteur de vérifications
    await supabase
      .from('documents')
      .update({
        nombre_verifications: (document.nombre_verifications || 0) + 1,
        derniere_verif: new Date().toISOString()
      })
      .eq('id', document.id);

    // Déterminer le statut
    let statut = 'valide';
    let message = '✅ Document authentique';

    if (document.statut === 'revoque') {
      statut = 'revoque';
      message = '🚨 Document révoqué';
    } else if (!signatureValide) {
      statut = 'fraude';
      message = '❌ Signature invalide - Document falsifié';
    }

    // Construire la réponse complète
    const reponse = {
      statut: statut,
      message: message,
      document: {
        id_verification: document.id_verification,
        nom: document.nom,
        prenom: document.prenom,
        type_document: document.type_document,
        donnees_completes: document.donnees_extraits || {},
        date_emission: document.cree_le,
        institution: document.organisations?.nom || 'Institution',
        institution_logo: document.organisations?.logo_url || null
      },
      securite: {
        signature_valide: signatureValide,
        algorithme_signature: 'Ed25519',
        hash_document: document.hash_document,
        algorithme_hash: 'SHA-256',
        transaction_hedera: document.transaction_hedera || null,
        preuve_blockchain: !!document.transaction_hedera
      },
      verification: {
        nombre_verifications: (document.nombre_verifications || 0) + 1,
        derniere_verification: new Date().toISOString()
      },
      pdf_url: document.pdf_signe_url || null
    };

    // Ajouter les infos de révocation si nécessaire
    if (document.statut === 'revoque') {
      reponse.revocation = {
        date: document.revoque_date,
        motif: document.revoque_motif,
        message: `Ce document a été révoqué le ${new Date(document.revoque_date).toLocaleDateString('fr-FR')}.`
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reponse)
    };

  } catch (erreur) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut: 'erreur', message: 'Erreur serveur', details: erreur.message })
    };
  }
};