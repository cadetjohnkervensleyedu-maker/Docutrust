// netlify/functions/envoyer-hedera.js

const { Client, TopicMessageSubmitTransaction, PrivateKey } = require('@hashgraph/sdk');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { hash_document, id_verification } = JSON.parse(event.body);

    if (!hash_document) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'Hash du document requis' }) };
    }

    // Déterminer le réseau
    const isMainnet = process.env.HEDERA_NETWORK === 'mainnet';
    let client;

    if (isMainnet) {
      client = Client.forMainnet();
    } else {
      client = Client.forTestnet();
    }

    // Configurer le compte
    const accountId = process.env.HEDERA_ACCOUNT_ID;
    const privateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
    client.setOperator(accountId, privateKey);

    // Préparer le message
    const message = JSON.stringify({
      hash: hash_document,
      id_verification: id_verification || 'non spécifié',
      timestamp: new Date().toISOString()
    });

    // Envoyer la transaction
    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(process.env.HEDERA_TOPIC_ID)
      .setMessage(message)
      .execute(client);

    // Récupérer le reçu pour avoir le sequenceNumber
    const receipt = await transaction.getReceipt(client);
    const transactionId = transaction.transactionId.toString();
    const sequenceNumber = receipt.topicSequenceNumber.toString();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        transaction_id: transactionId,
        sequence_number: sequenceNumber,
        reseau: isMainnet ? 'mainnet' : 'testnet',
        message: 'Hash enregistré sur Hedera avec succès'
      })
    };

  } catch (erreur) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        erreur: 'Erreur lors de l\'envoi sur Hedera',
        details: erreur.message
      })
    };
  }
};
