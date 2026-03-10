const express = require('express');
const router = express.Router();
const Family = require('../models/Family');
const Agent = require('../models/Agent');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const excel = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// -------------------- مسارات ثابتة أولاً --------------------

// تحميل نموذج Excel لاستيراد العائلات (قبل المسار الديناميكي /:id)
router.get('/download-template', auth, isAdmin, async (req, res) => {
  try {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('نموذج استيراد العائلات');

    worksheet.columns = [
      { header: 'رقم الدفتر', key: 'book', width: 20 },
      { header: 'اسم رب الأسرة', key: 'name', width: 25 },
      { header: 'عدد الأفراد', key: 'members', width: 15 },
      { header: 'المنطقة', key: 'area', width: 20 },
      { header: 'الباركود (اختياري)', key: 'barcode', width: 25 }
    ];

    // إضافة صف مثال
    worksheet.addRow({
      book: '12345',
      name: 'محمد أحمد',
      members: 5,
      area: 'المنطقة الوسطى',
      barcode: 'FAM12345'
    });

    // تنسيق الصف الأول (العناوين)
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0D6EFD' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=families-template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('خطأ في تحميل النموذج:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إنشاء النموذج' });
  }
});

// تقرير توزيع العائلات على المعتمدين (HTML للطباعة) - بدون تكرار
router.get('/distribution-report', auth, isAdmin, async (req, res) => {
  try {
    // جلب المعتمدين الذين لديهم مخزون
    const agents = await Agent.find({ gas_stock: { $gt: 0 } }).sort('area');

    // تحديد أحدث دورة بدأت (كمرجع للعائلات المستحقة)
    const latestCycle = await Agent.findOne().sort('-cycle_start').select('cycle_start');
    const referenceDate = latestCycle ? latestCycle.cycle_start : new Date(0);

    // جميع العائلات المستحقة (لم تستلم منذ referenceDate)
    const allEligible = await Family.find({
      $or: [
        { last_received: null },
        { last_received: { $lt: referenceDate } }
      ]
    }).sort({ last_received: 1, _id: 1 });

    const distribution = [];
    const takenFamilyIds = new Set();

    for (const agent of agents) {
      // العائلات المستحقة لهذا المعتمد (حسب دورته) ولم تؤخذ بعد
      const eligibleForAgent = allEligible.filter(f => 
        !takenFamilyIds.has(f._id.toString()) &&
        (!f.last_received || f.last_received < agent.cycle_start)
      ).slice(0, agent.gas_stock);

      if (eligibleForAgent.length > 0) {
        distribution.push({
          agent: agent,
          families: eligibleForAgent
        });
        eligibleForAgent.forEach(f => takenFamilyIds.add(f._id.toString()));
      }
    }

    let html = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>تقرير توزيع العائلات على المعتمدين</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 20px; background: #f8f9fa; }
            h1 { color: #0d6efd; text-align: center; margin-bottom: 30px; }
            .agent-header { background-color: #0d6efd; color: white; padding: 10px; margin-top: 20px; border-radius: 5px; font-size: 1.2em; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 20px; background: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            th, td { border: 1px solid #dee2e6; padding: 8px; text-align: right; }
            th { background-color: #0d6efd; color: white; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            .no-print { margin-bottom: 20px; text-align: center; }
            .no-print button { margin: 0 5px; padding: 10px 20px; font-size: 1em; cursor: pointer; }
            .remaining { text-align: center; color: #0d6efd; margin-top: 20px; font-weight: bold; }
            @media print {
                .no-print { display: none; }
                body { background: white; }
                .agent-header { background-color: #0d6efd !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                th { background-color: #0d6efd !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
        <h1>تقرير توزيع العائلات على المعتمدين</h1>
        <div class="no-print">
            <button onclick="window.print()" style="background: #0d6efd; color: white; border: none; border-radius: 5px;">طباعة</button>
            <button onclick="window.close()" style="background: #6c757d; color: white; border: none; border-radius: 5px;">إغلاق</button>
        </div>
    `;

    if (distribution.length === 0) {
      html += '<p style="text-align: center; color: #dc3545;">لا توجد عائلات مستحقة للتوزيع حالياً.</p>';
    } else {
      for (const item of distribution) {
        html += `
          <div class="agent-header">المعتمد: ${item.agent.name} (المنطقة: ${item.agent.area}) - الجرار المتوفرة: ${item.agent.gas_stock}</div>
          <table>
            <thead>
              <tr>
                <th>رقم الدفتر</th>
                <th>اسم رب الأسرة</th>
                <th>المنطقة</th>
                <th>عدد الأفراد</th>
                <th>آخر استلام</th>
                <th>عدد مرات الاستلام</th>
              </tr>
            </thead>
            <tbody>
        `;
        item.families.forEach(f => {
          const lastReceived = f.last_received ? new Date(f.last_received).toLocaleDateString('ar-EG') : 'لم يستلم';
          html += `
            <tr>
              <td>${f.family_book_number}</td>
              <td>${f.head_name}</td>
              <td>${f.area}</td>
              <td>${f.members_count}</td>
              <td>${lastReceived}</td>
              <td>${f.delivery_count || 0}</td>
            </tr>
          `;
        });
        html += '</tbody></table>';
      }

      const remaining = allEligible.length - takenFamilyIds.size;
      if (remaining > 0) {
        html += `<div class="remaining">عدد العائلات المتبقية للدورة القادمة: ${remaining}</div>`;
      }
    }

    html += '</body></html>';
    res.send(html);
  } catch (err) {
    console.error('خطأ في تقرير التوزيع:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html dir="rtl">
      <head><meta charset="UTF-8"><title>خطأ</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #dc3545;">حدث خطأ أثناء إنشاء التقرير</h2>
        <p>${err.message}</p>
        <button onclick="window.close()">إغلاق</button>
      </body>
      </html>
    `);
  }
});

// تصدير تقرير التوزيع إلى Excel (بدون تكرار)
router.get('/distribution-excel', auth, isAdmin, async (req, res) => {
  try {
    const agents = await Agent.find({ gas_stock: { $gt: 0 } }).sort('area');

    const latestCycle = await Agent.findOne().sort('-cycle_start').select('cycle_start');
    const referenceDate = latestCycle ? latestCycle.cycle_start : new Date(0);

    const allEligible = await Family.find({
      $or: [
        { last_received: null },
        { last_received: { $lt: referenceDate } }
      ]
    }).sort({ last_received: 1, _id: 1 });

    const takenFamilyIds = new Set();
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('توزيع العائلات');

    worksheet.addRow(['تقرير توزيع العائلات على المعتمدين']).font = { size: 16, bold: true };
    worksheet.addRow([]);

    for (const agent of agents) {
      const eligibleForAgent = allEligible.filter(f => 
        !takenFamilyIds.has(f._id.toString()) &&
        (!f.last_received || f.last_received < agent.cycle_start)
      ).slice(0, agent.gas_stock);

      if (eligibleForAgent.length > 0) {
        const headerRow = worksheet.addRow([`المعتمد: ${agent.name} (المنطقة: ${agent.area}) - الجرار المتوفرة: ${agent.gas_stock}`]);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0d6efd' } };

        const columnsRow = worksheet.addRow(['رقم الدفتر', 'اسم رب الأسرة', 'المنطقة', 'عدد الأفراد', 'آخر استلام', 'عدد مرات الاستلام']);
        columnsRow.font = { bold: true };

        eligibleForAgent.forEach(f => {
          const lastReceived = f.last_received ? new Date(f.last_received).toLocaleDateString('ar-EG') : 'لم يستلم';
          worksheet.addRow([
            f.family_book_number,
            f.head_name,
            f.area,
            f.members_count,
            lastReceived,
            f.delivery_count || 0
          ]);
        });

        worksheet.addRow([]);
        eligibleForAgent.forEach(f => takenFamilyIds.add(f._id.toString()));
      }
    }

    const remaining = allEligible.length - takenFamilyIds.size;
    if (remaining > 0) {
      worksheet.addRow([`عدد العائلات المتبقية للدورة القادمة: ${remaining}`]).font = { italic: true, color: { argb: '0d6efd' } };
    }

    worksheet.columns = [{ width: 15 }, { width: 20 }, { width: 15 }, { width: 10 }, { width: 15 }, { width: 10 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=distribution-report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('خطأ في تصدير Excel:', err);
    res.status(500).json({ error: err.message });
  }
});

// استيراد ملف Excel لإضافة عائلات دفعة واحدة
router.post('/import-excel', auth, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'الرجاء رفع ملف Excel' });
    }

    const workbook = new excel.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];

    const results = {
      total: 0,
      added: 0,
      skipped: 0,
      errors: []
    };

    // قراءة البيانات للتحقق الأولي
    const familiesToInsert = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // تخطي العنوان

      const book = row.getCell(1).text?.trim();
      const name = row.getCell(2).text?.trim();
      const members = parseInt(row.getCell(3).text);
      const area = row.getCell(4).text?.trim();
      let barcode = row.getCell(5)?.text?.trim();

      if (!book || !name || !members || !area) {
        results.errors.push(`السطر ${rowNumber}: بيانات ناقصة`);
        results.skipped++;
        return;
      }

      if (isNaN(members) || members < 1) {
        results.errors.push(`السطر ${rowNumber}: عدد الأفراد غير صحيح`);
        results.skipped++;
        return;
      }

      if (!barcode) {
        barcode = 'FAM' + Math.floor(Math.random() * 1000000) + rowNumber;
      }

      familiesToInsert.push({
        family_book_number: book,
        head_name: name,
        members_count: members,
        area,
        barcode,
        delivery_count: 0
      });
      results.total++;
    });

    // إدراج العائلات باستخدام insertMany مع ordered: false لتخطي الأخطاء الفردية
    if (familiesToInsert.length > 0) {
      try {
        const inserted = await Family.insertMany(familiesToInsert, { ordered: false });
        results.added = inserted.length;
        results.skipped = results.total - inserted.length;
      } catch (err) {
        // insertMany قد يرمي خطأ واحداً فقط إذا كان ordered: true، لكن مع ordered: false سيتم إدراج الناجح ورمي خطأ جماعي
        // لتبسيط الأمور، سنقوم بإدراج كل عائلة على حدة (للحصول على تقارير أدق)
        // هذا أبطأ لكنه يعطي تفاصيل أفضل للمستخدم
        for (const fam of familiesToInsert) {
          try {
            await Family.create(fam);
            results.added++;
          } catch (insertErr) {
            results.errors.push(`رقم الدفتر ${fam.family_book_number}: ${insertErr.message}`);
            results.skipped++;
          }
        }
      }
    }

    res.json({
      message: 'تمت معالجة الملف',
      added: results.added,
      skipped: results.skipped,
      errors: results.errors.slice(0, 10)
    });

  } catch (err) {
    console.error('خطأ في استيراد Excel:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء معالجة الملف: ' + err.message });
  }
});

// -------------------- المسارات الديناميكية --------------------

// GET /families (للمسؤول فقط)
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = {
        $or: [
          { head_name: { $regex: search, $options: 'i' } },
          { family_book_number: { $regex: search, $options: 'i' } },
          { area: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const families = await Family.find(query).sort({ createdAt: -1 });
    res.json(families);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /families/:id (يجب أن يكون بعد المسارات الثابتة)
router.get('/:id', auth, isAdmin, async (req, res) => {
  try {
    const family = await Family.findById(req.params.id);
    if (!family) return res.status(404).json({ error: 'العائلة غير موجودة' });
    res.json(family);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, isAdmin, async (req, res) => {
  try {
    const { book, name, members, area, barcode } = req.body;

    if (!members || isNaN(members) || members < 1) {
      return res.status(400).json({ error: 'عدد الأفراد يجب أن يكون رقماً صحيحاً موجباً' });
    }

    const existing = await Family.findOne({
      $or: [{ family_book_number: book }, { barcode }]
    });
    if (existing) {
      return res.status(400).json({ error: 'رقم الدفتر أو الباركود موجود مسبقاً' });
    }

    const family = await Family.create({
      family_book_number: book,
      head_name: name,
      members_count: members,
      area,
      barcode,
      delivery_count: 0
    });
    res.status(201).json(family);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, isAdmin, async (req, res) => {
  try {
    const { book, name, members, area, barcode } = req.body;
    const family = await Family.findById(req.params.id);
    if (!family) return res.status(404).json({ error: 'العائلة غير موجودة' });

    if (members && (isNaN(members) || members < 1)) {
      return res.status(400).json({ error: 'عدد الأفراد يجب أن يكون رقماً صحيحاً موجباً' });
    }

    if (book && book !== family.family_book_number) {
      const conflict = await Family.findOne({ family_book_number: book });
      if (conflict) return res.status(400).json({ error: 'رقم الدفتر مستخدم بالفعل' });
    }
    if (barcode && barcode !== family.barcode) {
      const conflict = await Family.findOne({ barcode });
      if (conflict) return res.status(400).json({ error: 'الباركود مستخدم بالفعل' });
    }

    family.family_book_number = book || family.family_book_number;
    family.head_name = name || family.head_name;
    family.members_count = members || family.members_count;
    family.area = area || family.area;
    family.barcode = barcode || family.barcode;
    await family.save();

    res.json(family);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const family = await Family.findByIdAndDelete(req.params.id);
    if (!family) return res.status(404).json({ error: 'العائلة غير موجودة' });
    res.json({ message: 'تم الحذف بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;