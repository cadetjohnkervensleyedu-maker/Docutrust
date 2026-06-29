// netlify/functions/analyser-pdf.js

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { texte_pdf, nom_fichier } = JSON.parse(event.body);

    if (!texte_pdf || texte_pdf.trim().length < 10) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Texte du PDF requis (min 10 caractères)' }) };
    }

    const modele = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const retryModele = 'gemini-2.0-flash';

    const prompt = `Tu es un extracteur de données de documents officiels. Ta tâche est d'analyser un document et d'en extraire TOUTES les informations pertinentes.

DOCUMENT À ANALYSER :
"""
${texte_pdf}
"""

Nom du fichier : ${nom_fichier || 'Inconnu'}

INSTRUCTIONS CRITIQUES :
1. IDENTIFIE d'abord le type de document
2. EXTRAIS TOUTES les informations possibles, sans exception
3. Si un champ est absent, mets null (ne l'omets pas)
4. Pour les listes (matières, notes), sois EXHAUSTIF

TYPES DE DOCUMENTS RECONNUS ET LEURS CHAMPS :

DIPLÔME → {nom, prenom, type_diplome, mention, filiere, specialite, session, date_emission, lieu, institution, signataire}
RELEVÉ DE NOTES → {nom, prenom, date_naissance, classe, annee, semestre, institution, matieres: [{nom_matiere, note, coefficient, appreciation, rang}], moyenne_generale, decision}
BULLETIN SCOLAIRE → {nom, prenom, date_naissance, classe, trimestre, annee_scolaire, institution, matieres: [{nom_matiere, note, coefficient, moyenne_classe, appreciation}], moyenne_generale, mention, decision_conseil}
CERTIFICAT → {nom, prenom, date_naissance, type_certificat, objet, date_debut, date_fin, duree_heures, institution, signataire}
ATTESTATION → {nom, prenom, date_naissance, type_attestation, objet, date_emission, institution, signataire}
LETTRE → {nom, prenom, destinataire, type_lettre, objet, date, entreprise, signataire}
CONTRAT → {nom, prenom, date_naissance, poste, salaire, date_debut, date_fin, type_contrat, entreprise, signataire}
FICHE DE PAIE → {nom, prenom, poste, salaire_brut, salaire_net, cotisations, periode, date_paiement, entreprise}
MÉDICAL → {nom, prenom, date_naissance, type_document, conclusions, aptitude, date_examen, medecin, etablissement}

DOCUMENT INCONNU :
Si le document ne correspond à AUCUN type ci-dessus, extrais QUAND MÊME :
- Toutes les personnes mentionnées (nom, prénom, rôle)
- Toutes les dates trouvées (avec leur contexte)
- Tous les lieux trouvés
- Tous les numéros/références/identifiants
- Tous les titres et en-têtes
- Toute information structurée (tableaux, listes)
- Résume le contenu en une phrase

FORMAT DE SORTIE OBLIGATOIRE - JSON STRICT (pas de markdown, pas de texte autour) :
{
  "type_document": "diplome|releve_notes|bulletin|certificat|attestation|lettre|contrat|fiche_paie|medical|inconnu",
  "description": "Description du document en 1 phrase",
  "donnees": {}
}

RÈGLES :
- JSON valide, pas de commentaires, pas de markdown
- Champs absents = null (pas de string vide)
- Nombres = numbers (pas de strings)
- Dates = format "JJ/MM/AAAA"`;

    // Première tentative avec le modèle configuré
    let resultat;
    try {
      const model = genAI.getGenerativeModel({ 
        model: modele,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        }
      });
      resultat = await model.generateContent(prompt);
    } catch (firstError) {
      // Fallback sur Flash si Pro échoue
      const fallbackModel = genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash',
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        }
      });
      resultat = await fallbackModel.generateContent(prompt);
    }

    const reponse = resultat.response.text();

    // Nettoyage robuste
    let jsonPropre = reponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^[\s\n]*/, '')
      .replace(/[\s\n]*$/, '')
      .trim();

    // Si la réponse commence par une accolade, la prendre telle quelle
    const firstBrace = jsonPropre.indexOf('{');
    const lastBrace = jsonPropre.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonPropre = jsonPropre.substring(firstBrace, lastBrace + 1);
    }

    const donnees = JSON.parse(jsonPropre);

    return {
      statusCode: 200,
      body: JSON.stringify({
        type_document: donnees.type_document || 'inconnu',
        description: donnees.description || 'Document analysé',
        donnees: donnees.donnees || {},
        modele_utilise: modele
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        erreur: 'Erreur lors de l\'analyse du PDF',
        details: erreur.message
      }) 
    };
  }
};