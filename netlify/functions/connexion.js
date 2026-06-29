// netlify/functions/connexion.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ erreur: 'Méthode non autorisée' })
    };
  }

  try {
    const { action, email, password, mfa_token, mfa_code } = JSON.parse(event.body);

    // ========== ACTION 1 : LOGIN ==========
    if (action === 'login') {
      if (!email || !password) {
        return {
          statusCode: 400,
          body: JSON.stringify({ erreur: 'Email et mot de passe requis' })
        };
      }

      // Vérifier email + mot de passe avec Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (authError) {
        // Journal d'audit : tentative échouée
        await supabase.from('audit_logs').insert({
          organisation_id: null,
          action: 'connexion_echouee',
          details: { email: email, raison: authError.message },
          auteur: email
        });

        return {
          statusCode: 401,
          body: JSON.stringify({ erreur: 'Email ou mot de passe incorrect' })
        };
      }

      // Envoyer le code MFA
      const { data: mfaData, error: mfaError } = await supabase.auth.mfa.challenge({
        factorId: 'email'
      });

      if (mfaError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ erreur: 'Erreur envoi code MFA' })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Code MFA envoyé par email',
          mfa_token: mfaData.id,
          etape: 'mfa_required'
        })
      };
    }

    // ========== ACTION 2 : VÉRIFIER LE CODE MFA ==========
    if (action === 'verify_mfa') {
      if (!mfa_token || !mfa_code) {
        return {
          statusCode: 400,
          body: JSON.stringify({ erreur: 'Code MFA requis' })
        };
      }

      // Vérifier le code MFA
      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId: 'email',
        code: mfa_code,
        challengeId: mfa_token
      });

      if (verifyError) {
        return {
          statusCode: 401,
          body: JSON.stringify({ erreur: 'Code MFA invalide ou expiré' })
        };
      }

      // Récupérer les infos de l'utilisateur
      const { data: userData } = await supabase.auth.getUser();

      // Trouver son organisation et son rôle
      const { data: adminData, error: adminError } = await supabase
        .from('administrateurs')
        .select('id, organisation_id, role, nom_complet')
        .eq('email', email)
        .single();

      if (adminError || !adminData) {
        return {
          statusCode: 403,
          body: JSON.stringify({ erreur: 'Accès non autorisé' })
        };
      }

      // Récupérer l'organisation
      const { data: orgData } = await supabase
        .from('organisations')
        .select('nom, sous_domaine')
        .eq('id', adminData.organisation_id)
        .single();

      // Créer la session
      const maintenant = new Date();
      const expireSession = new Date(maintenant.getTime() + 60 * 60 * 1000); // 1h max

      const { data: sessionData } = await supabase
        .from('sessions_admin')
        .insert({
          email: email,
          token: require('crypto').randomBytes(32).toString('hex'),
          derniere_activite: maintenant.toISOString(),
          expire_le: expireSession.toISOString(),
          ip_address: event.headers['client-ip'] || 'inconnue'
        })
        .select()
        .single();

      // Mettre à jour la dernière connexion
      await supabase
        .from('administrateurs')
        .update({ derniere_connexion: maintenant.toISOString() })
        .eq('id', adminData.id);

      // Journal d'audit
      await supabase.from('audit_logs').insert({
        organisation_id: adminData.organisation_id,
        action: 'connexion_reussie',
        details: {
          email: email,
          role: adminData.role,
          ip: event.headers['client-ip'] || 'inconnue'
        },
        auteur: email,
        auteur_id: adminData.id
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          token: sessionData.token,
          admin: {
            id: adminData.id,
            nom: adminData.nom_complet,
            email: email,
            role: adminData.role,
            organisation: {
              id: adminData.organisation_id,
              nom: orgData?.nom,
              sous_domaine: orgData?.sous_domaine
            }
          },
          expire_le: expireSession.toISOString()
        })
      };
    }

    // ========== ACTION INCONNUE ==========
    return {
      statusCode: 400,
      body: JSON.stringify({ erreur: 'Action inconnue. Utilisez "login" ou "verify_mfa"' })
    };

  } catch (erreur) {
    return {
      statusCode: 500,
      body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message })
    };
  }
};