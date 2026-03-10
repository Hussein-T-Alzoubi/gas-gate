const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Agent = require('../models/Agent');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// تسجيل الدخول
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role, agentId: user.agentId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إنشاء مستخدم افتراضي (لأول مرة)
router.get('/setup', async (req, res) => {
  try {
    // إنشاء مدير افتراضي
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        role: 'admin'
      });
      console.log('✅ تم إنشاء مستخدم admin');
    }

    // إنشاء معتمد افتراضي
    const agentExists = await User.findOne({ username: 'agent' });
    if (!agentExists) {
      // إنشاء المعتمد في جدول agents
      const agent = await Agent.create({
        name: 'المعتمد الأول',
        area: 'المنطقة الوسطى',
        gas_stock: 50,
        username: 'agent'
      });
      // إنشاء المستخدم المرتبط
      await User.create({
        username: 'agent',
        password: 'agent123',
        role: 'agent',
        agentId: agent._id
      });
      console.log('✅ تم إنشاء مستخدم agent');
    }

    res.json({ message: 'تم إنشاء المستخدمين الافتراضيين بنجاح' });
  } catch (err) {
    console.error('❌ خطأ في /setup:', err);
    res.status(500).json({ error: err.message });
  }
});

// جلب بيانات المستخدم الحالي (للمسؤول)
router.get('/admin/profile', auth, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('username');
    res.json({ username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تحديث بيانات المسؤول
router.put('/admin/profile', auth, isAdmin, async (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // التحقق من كلمة المرور الحالية
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    // تحديث اسم المستخدم إذا تم إرساله
    if (newUsername && newUsername !== user.username) {
      // التحقق من عدم وجود مستخدم آخر بنفس الاسم
      const existingUser = await User.findOne({ username: newUsername });
      if (existingUser) {
        return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
      }
      user.username = newUsername;
    }

    // تحديث كلمة المرور إذا تم إرسالها
    if (newPassword) {
      user.password = newPassword; // سيتم تشفيرها تلقائياً في pre-save
    }

    await user.save();
    res.json({ message: 'تم تحديث البيانات بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;