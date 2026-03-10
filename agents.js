const express = require('express');
const router = express.Router();
const Agent = require('../models/Agent');
const User = require('../models/User');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// جميع الطرق تتطلب مصادقة المسؤول
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const agents = await Agent.find();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, isAdmin, async (req, res) => {
  try {
    const { name, area, gas_stock, username, password } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });

    // التحقق من صحة البيانات
    if (gas_stock !== undefined && (isNaN(gas_stock) || gas_stock < 0)) {
      return res.status(400).json({ error: 'المخزون يجب أن يكون رقماً غير سالب' });
    }

    const agent = await Agent.create({ name, area, gas_stock, username });
    await User.create({
      username,
      password,
      role: 'agent',
      agentId: agent._id
    });

    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, isAdmin, async (req, res) => {
  try {
    const { name, area, gas_stock, username, password } = req.body;
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'المعتمد غير موجود' });

    // التحقق من صحة البيانات
    if (gas_stock !== undefined && (isNaN(gas_stock) || gas_stock < 0)) {
      return res.status(400).json({ error: 'المخزون يجب أن يكون رقماً غير سالب' });
    }

    // إذا تم زيادة المخزون، نبدأ دورة جديدة (تلقائي)
    if (gas_stock !== undefined && gas_stock > agent.gas_stock) {
      agent.cycle_start = new Date();
    }

    agent.name = name || agent.name;
    agent.area = area || agent.area;
    agent.gas_stock = gas_stock !== undefined ? gas_stock : agent.gas_stock;
    agent.username = username || agent.username;
    await agent.save();

    const user = await User.findOne({ agentId: agent._id });
    if (user) {
      user.username = agent.username;
      if (password) {
        user.password = password; // سيتم تشفيرها تلقائياً في pre-save
      }
      await user.save();
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const agent = await Agent.findByIdAndDelete(req.params.id);
    if (!agent) return res.status(404).json({ error: 'المعتمد غير موجود' });

    await User.findOneAndDelete({ agentId: agent._id });
    res.json({ message: 'تم الحذف بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسار لجلب بيانات المعتمد الحالي
router.get('/me', auth, async (req, res) => {
  try {
    if (req.user.role !== 'agent') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const agent = await Agent.findById(req.user.agentId);
    if (!agent) return res.status(404).json({ error: 'المعتمد غير موجود' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسار لبدء دورة جديدة لمعتمد (يدوياً)
router.post('/:id/start-cycle', auth, isAdmin, async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'المعتمد غير موجود' });

    agent.cycle_start = new Date();
    await agent.save();

    res.json({ message: 'تم بدء دورة جديدة بنجاح', cycle_start: agent.cycle_start });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;