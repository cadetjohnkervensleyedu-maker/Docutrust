// netlify/functions/audit.js

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
    const { action, organisation_id, filtre_action, filtre_date_debut, filtre_date_fin, page, limite } = JSON.parse(event.body);

    // ========== ACTION "ajouter" ==========
    if (action === 'ajouter') {
      const { org_id, action_nom, details, auteur, auteur_id, ip } = JSON.parse(event.body);

      if (!action_nom) {
        return { statusCode: 400, body: JSON.stringify({ erreur: 'Action requise' }) };
      }

      const { data, error } = await supabase
        .from('audit_logs')
        .insert({
          organisation_id: org_id || null,
          action: action_nom,
          details: details || {},
          auteur: auteur || 'system',
          auteur_id: auteur_id || null,
          ip_address: ip || event.headers['client-ip'] || 'inconnue'
        })
        .select()
        .single();

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur ajout audit' }) };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, entree: data })
      };
    }

    // ========== ACTION "consulter" ==========
    if (action === 'consulter') {
      let requete = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('cree_le', { ascending: false });

      // Appliquer les filtres
      if (organisation_id) {
        requete = requete.eq('organisation_id', organisation_id);
      }
      if (filtre_action) {
        requete = requete.eq('action', filtre_action);
      }
      if (filtre_date_debut) {
        requete = requete.gte('cree_le', filtre_date_debut);
      }
      if (filtre_date_fin) {
        requete = requete.lte('cree_le', filtre_date_fin);
      }

      // Pagination
      const pageActuelle = page || 1;
      const limiteParPage = limite || 50;
      const debut = (pageActuelle - 1) * limiteParPage;
      
      requete = requete.range(debut, debut + limiteParPage - 1);

      const { data, error, count } = await requete;

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur consultation audit' }) };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          entrees: data,
          total: count,
          page: pageActuelle,
          limite: limiteParPage,
          pages_total: Math.ceil(count / limiteParPage)
        })
      };
    }

    // ========== ACTION "exporter" ==========
    if (action === 'exporter') {
      let requete = supabase
        .from('audit_logs')
        .select('*')
        .order('cree_le', { ascending: false })
        .limit(10000); // Max 10 000 entrées

      if (organisation_id) {
        requete = requete.eq('organisation_id', organisation_id);
      }
      if (filtre_action) {
        requete = requete.eq('action', filtre_action);
      }
      if (filtre_date_debut) {
        requete = requete.gte('cree_le', filtre_date_debut);
      }
      if (filtre_date_fin) {
        requete = requete.lte('cree_le', filtre_date_fin);
      }

      const { data, error } = await requete;

      if (error) {
        return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur export audit' }) };
      }

      // Générer le CSV
      let csv = 'Date,Organisation ID,Action,Détails,Auteur,IP\n';
      
      data.forEach(entree => {
        const date = new Date(entree.cree_le).toISOString();
        const details = JSON.stringify(entree.details || {}).replace(/"/g, '""');
        csv += `"${date}","${entree.organisation_id || ''}","${entree.action}","${details}","${entree.auteur}","${entree.ip_address || ''}"\n`;
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=audit_docutrust.csv'
        },
        body: csv
      };
    }

    return { statusCode: 400, body: JSON.stringify({ erreur: 'Action inconnue. Utilisez "ajouter", "consulter" ou "exporter"' }) };

  } catch (erreur) {
    return { statusCode: 500, body: JSON.stringify({ erreur: 'Erreur serveur', details: erreur.message }) };
  }
};