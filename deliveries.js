const express = require('express');
const router = express.Router();
const Family = require('../models/Family');
const Delivery = require('../models/Delivery');
const Agent = require('../models/Agent');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

// POST /scan
router.post('/scan', auth, async (req, res) => {
  try {
    const { barcode } = req.body;
    const family = await Family.findOne({ barcode });
    if (!family) return res.status(404).json({ status: 'error', message: 'العائلة غير موجودة' });
    res.json({ status: 'ok', family });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /deliver - معاملة ذرية
router.post('/deliver', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { family_id } = req.body;
    const agentId = req.user.agentId;
    if (!agentId) {
      throw new Error('هذا المستخدم ليس معتمداً');
    }

    // 1. جلب العائلة ضمن الجلسة
    const family = await Family.findById(family_id).session(session);
    if (!family) {
      throw new Error('العائلة غير موجودة');
    }

    // 2. جلب المعتمد ضمن الجلسة
    const agent = await Agent.findById(agentId).session(session);
    if (!agent) {
      throw new Error('المعتمد غير موجود');
    }
    if (agent.gas_stock <= 0) {
      throw new Error('لا يوجد مخزون كافٍ لدى المعتمد');
    }

    // 3. التحقق من أن العائلة لم تستلم بعد في الدورة الحالية
    if (family.last_received && family.last_received >= agent.cycle_start) {
      throw new Error('هذه العائلة قد استلمت بالفعل في الدورة الحالية');
    }

    // 4. تحديث العائلة (last_received وزيادة عدد مرات الاستلام)
    family.last_received = new Date();
    family.delivery_count += 1;
    await family.save({ session });

    // 5. إنشاء التوزيع
    const delivery = new Delivery({
      family: family._id,
      agent: agentId
    });
    await delivery.save({ session });

    // 6. إنقاص المخزون بشكل ذري (مع التأكد من أن المخزون لم ينفذ)
    const updateResult = await Agent.updateOne(
      { _id: agentId, gas_stock: { $gt: 0 } },
      { $inc: { gas_stock: -1 } },
      { session }
    );

    if (updateResult.modifiedCount === 0) {
      throw new Error('فشل تحديث المخزون، ربما نفد المخزون');
    }

    // 7. إنهاء المعاملة بنجاح
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'تم التسليم بنجاح', delivery });
  } catch (err) {
    // التراجع عن جميع التغييرات
    await session.abortTransaction();
    session.endSession();
    console.error('خطأ في /deliver:', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;