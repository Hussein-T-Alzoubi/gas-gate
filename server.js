require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// استيراد المسارات
const authRoutes = require('./routes/auth');
const agentRoutes = require('./routes/agents');
const familyRoutes = require('./routes/families');
const deliveryRoutes = require('./routes/deliveries');
const statsRoutes = require('./routes/stats');
const exportRoutes = require('./routes/export');
const adminRoutes = require('./routes/admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// خدمة الملفات الثابتة من مجلد public (لـ css, الصور، إلخ)
app.use(express.static(path.join(__dirname, 'public')));

// خدمة مجلد templates كملفات ثابتة
app.use('/templates', express.static(path.join(__dirname, 'templates')));

// مسار الصفحة الرئيسية - يجب وضعه قبل المسارات الأخرى
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// تعريف المسارات
app.use('/', authRoutes);
app.use('/agents', agentRoutes);
app.use('/families', familyRoutes);
app.use('/', deliveryRoutes);
app.use('/stats', statsRoutes);
app.use('/export', exportRoutes);
app.use('/admin', adminRoutes);

// دالة إنشاء المستخدمين الافتراضيين
const createDefaultUsers = async () => {
  try {
    const User = require('./models/User');
    const Agent = require('./models/Agent');

    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        role: 'admin'
      });
      console.log('✅ تم إنشاء مستخدم admin');
    }

    const agentUserExists = await User.findOne({ username: 'agent' });
    if (!agentUserExists) {
      const agent = await Agent.create({
        name: 'المعتمد الأول',
        area: 'المنطقة الوسطى',
        gas_stock: 50,
        username: 'agent'
      });
      await User.create({
        username: 'agent',
        password: 'agent123',
        role: 'agent',
        agentId: agent._id
      });
      console.log('✅ تم إنشاء مستخدم agent');
    }
  } catch (err) {
    console.error('❌ خطأ في إنشاء المستخدمين الافتراضيين:', err);
  }
};

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ متصل بقاعدة البيانات');
    await createDefaultUsers();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`));
  })
  .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));