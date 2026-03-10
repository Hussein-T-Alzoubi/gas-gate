const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Family = require('../models/Family');
const Agent = require('../models/Agent');
const Delivery = require('../models/Delivery');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// إعادة تعيين النظام بالكامل (مسح جميع البيانات)
router.post('/reset', auth, isAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    const adminId = req.user.id;

    // التحقق من كلمة مرور المسؤول
    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(404).json({ error: 'المسؤول غير موجود' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    // حذف جميع البيانات
    await Family.deleteMany({});
    await Agent.deleteMany({});
    await Delivery.deleteMany({});

    // إعادة إنشاء المعتمد الافتراضي (اختياري - يمكن تركه للمستخدم)
    const defaultAgent = await Agent.create({
      name: 'المعتمد الافتراضي',
      area: 'المنطقة الوسطى',
      gas_stock: 0,
      username: 'agent'
    });

    await User.create({
      username: 'agent',
      password: 'agent123',
      role: 'agent',
      agentId: defaultAgent._id
    });

    res.json({ message: 'تم إعادة تعيين النظام بنجاح' });
  } catch (err) {
    console.error('خطأ في إعادة التعيين:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;