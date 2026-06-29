// netlify/functions/incruster-qrcode.js

const { PDFDocument } = require('pdf-lib');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ erreur: 'Méthode non autorisée' }) };
  }

  try {
    const { pdf_base64, qrcode_base64, position } = JSON.parse(event.body);

    if (!pdf_base64 || !qrcode_base64) {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'PDF et QR code requis' }) };
    }

    // Charger le PDF
    let pdfBytes;
    try {
      pdfBytes = Buffer.from(pdf_base64, 'base64');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ erreur: 'PDF base64 invalide' }) };
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    // Décoder le QR code
    const qrData = qrcode_base64.includes(',') ? qrcode_base64.split(',')[1] : qrcode_base64;
    const qrBuffer = Buffer.from(qrData, 'base64');

    // Embedder l'image (auto-détection PNG/JPEG)
    let qrImage;
    if (qrBuffer[0] === 0x89 && qrBuffer[1] === 0x50) {
      qrImage = await pdfDoc.embedPng(qrBuffer);
    } else if (qrBuffer[0] === 0xFF && qrBuffer[1] === 0xD8) {
      qrImage = await pdfDoc.embedJpg(qrBuffer);
    } else {
      try { qrImage = await pdfDoc.embedPng(qrBuffer); }
      catch { qrImage = await pdfDoc.embedJpg(qrBuffer); }
    }

    const pos = ['bottom-right','bottom-left','top-right','top-left','center'].includes(position)
      ? position
      : 'bottom-right';

    // Appliquer sur toutes les pages
    for (const page of pages) {
      const { width, height } = page.getSize();

      // Taille = 8% largeur, entre 40px et 120px
      const qrSize = Math.max(40, Math.min(120, Math.floor(width * 0.08)));
      const margin = Math.max(10, Math.floor(width * 0.02));
      const textHeight = 14;

      // Calculer la position
      let x, y;
      switch (pos) {
        case 'bottom-right':
          x = width - qrSize - margin;
          y = margin;
          break;
        case 'bottom-left':
          x = margin;
          y = margin;
          break;
        case 'top-right':
          x = width - qrSize - margin;
          y = height - qrSize - textHeight - margin;
          break;
        case 'top-left':
          x = margin;
          y = height - qrSize - textHeight - margin;
          break;
        case 'center':
          x = (width - qrSize) / 2;
          y = (height - qrSize - textHeight) / 2;
          break;
      }

      // Forcer dans les limites de la page
      x = Math.max(2, Math.min(x, width - qrSize - 2));
      y = Math.max(2, Math.min(y, height - qrSize - textHeight - 2));

      // Fond blanc semi-transparent
      page.drawRectangle({
        x: x - 5,
        y: y - 3,
        width: qrSize + 10,
        height: qrSize + textHeight + 6,
        color: { r: 1, g: 1, b: 1 },
        opacity: 0.95,
      });

      // QR code
      page.drawImage(qrImage, {
        x,
        y: y + textHeight - 2,
        width: qrSize,
        height: qrSize,
      });

      // Texte
      page.drawText('Vérifier', {
        x: x + (qrSize - 30) / 2,
        y: y + 2,
        size: Math.max(5, Math.min(8, qrSize * 0.08)),
        color: { r: 0.2, g: 0.2, b: 0.2 },
      });
    }

    const pdfModifieBytes = await pdfDoc.save();
    const pdfModifieBase64 = Buffer.from(pdfModifieBytes).toString('base64');

    return {
      statusCode: 200,
      body: JSON.stringify({
        pdf_signe: pdfModifieBase64,
        pages_traitees: pages.length,
        position: pos,
        message: 'QR code ajouté avec succès',
      }),
    };
  } catch (erreur) {
    return {
      statusCode: 500,
      body: JSON.stringify({ erreur: 'Erreur incrustation QR code', details: erreur.message }),
    };
  }
};
