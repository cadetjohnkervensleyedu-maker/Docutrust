// netlify/functions/verifier-hedera.js

const { Client, TopicMessageQuery, PrivateKey } = require('@hashgraph/sdk');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { hash_document, transaction_id } = JSON.parse(event.body);

    if (!hash_document) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Hash du document requis' }) };
    }

    const isMainnet = process.env.HEDERA_NETWORK === 'mainnet';
    let client;
    
    if (isMainnet) {
      client = Client.forMainnet();
    } else {
      client = Client.forTestnet();
    }

    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
    client.setOperator(accountId, privateKey);

    const topicId = process.env.HEDERA_TOPIC_ID;

    let trouve = false;
    let dateTransaction = null;
    let transactionId = null;

    // Si on a déjà l'ID de transaction (stocké dans Supabase), on va directement
    if (transaction_id) {
      const sequenceNumber = parseInt(transaction_id);
      
      const messages = await new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .setLimit(sequenceNumber + 10)
        .execute(client);

      let compteur = 0;
      for await (const message of messages) {
        compteur++;
        if (compteur === sequenceNumber) {
          try {
            const contenu = JSON.parse(Buffer.from(message.contents).toString());
            if (contenu.hash === hash_document) {
              trouve = true;
              dateTransaction = message.consensusTimestamp;
              transactionId = message.sequenceNumber.toString();
            }
          } catch {}
          break;
        }
      }
    }

    // Fallback : chercher dans les 500 derniers messages
    if (!trouve) {
      const messages = await new TopicMessageQuery()
        .setTopicId(topicId)
        .setLimit(500)
        .execute(client);

      for await (const message of messages) {
        try {
          const contenu = JSON.parse(Buffer.from(message.contents).toString());
          if (contenu.hash === hash_document) {
            trouve = true;
            dateTransaction = message.consensusTimestamp;
            transactionId = message.sequenceNumber.toString();
            break;
          }
        } catch {}
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        trouve: trouve,
        date_transaction: dateTransaction ? new Date(dateTransaction).toISOString() : null,
        transaction_id: transactionId,
        reseau: isMainnet ? 'mainnet' : 'testnet',
        methode: transaction_id ? 'index' : 'recherche',
        message: trouve 
          ? 'Document trouvé sur la blockchain' 
          : 'Document non trouvé'
      })
    };

  } catch (erreur) {
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        erreur: 'Erreur lors de la vérification Hedera', 
        details: erreur.message 
      }) 
    };
  }
};