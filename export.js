const express = require('express');
const router = express.Router();
const Delivery = require('../models/Delivery');
const excel = require('exceljs');
const PDFDocument = require('pdfkit');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.get('/deliveries/excel', auth, isAdmin, async (req, res) => {
  try {
    const deliveries = await Delivery.find()
      .populate('family', 'head_name family_book_number area')
      .populate('agent', 'name')
      .sort('-date');

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('التوزيعات');

    worksheet.columns = [
      { header: 'التاريخ', key: 'date', width: 20 },
      { header: 'اسم العائلة', key: 'familyName', width: 25 },
      { header: 'رقم الدفتر', key: 'bookNumber', width: 15 },
      { header: 'المنطقة', key: 'area', width: 15 },
      { header: 'المعتمد', key: 'agentName', width: 20 }
    ];

    deliveries.forEach(d => {
      worksheet.addRow({
        date: d.date.toLocaleDateString('ar-EG'),
        familyName: d.family?.head_name,
        bookNumber: d.family?.family_book_number,
        area: d.family?.area,
        agentName: d.agent?.name
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=deliveries.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deliveries/pdf', auth, isAdmin, async (req, res) => {
  try {
    const deliveries = await Delivery.find()
      .populate('family', 'head_name family_book_number area')
      .populate('agent', 'name')
      .sort('-date')
      .limit(50);

    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=deliveries.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('تقرير التوزيعات', { align: 'center' }).moveDown();
    doc.fontSize(12);

    deliveries.forEach((d, i) => {
      doc.text(`${i + 1}. ${d.family?.head_name} - ${d.family?.area} - تاريخ: ${d.date.toLocaleDateString('ar-EG')} - معتمد: ${d.agent?.name}`);
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;