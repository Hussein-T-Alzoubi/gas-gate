const express = require('express');
const router = express.Router();
const Family = require('../models/Family');
const Agent = require('../models/Agent');
const Delivery = require('../models/Delivery');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const families = await Family.countDocuments();
    const agents = await Agent.countDocuments();
    const totalDeliveries = await Delivery.countDocuments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deliveriesToday = await Delivery.countDocuments({ date: { $gte: today } });

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const deliveriesThisMonth = await Delivery.countDocuments({ date: { $gte: startOfMonth } });

    const agentsWithStock = await Agent.find({ gas_stock: { $gt: 0 } }).countDocuments();
    const familiesReceivedThisMonth = await Family.countDocuments({ last_received: { $gte: startOfMonth } });

    const recentDeliveries = await Delivery.find()
      .populate('family', 'head_name')
      .populate('agent', 'name')
      .sort('-date')
      .limit(10);

    res.json({
      families,
      agents,
      deliveriesToday,
      totalDeliveries,
      deliveriesThisMonth,
      agentsWithStock,
      familiesReceivedThisMonth,
      recentDeliveries: recentDeliveries.map(d => ({
        date: d.date,
        head_name: d.family?.head_name || 'غير معروف',
        agent_name: d.agent?.name || 'غير معروف'
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deliveries-by-area', auth, isAdmin, async (req, res) => {
  try {
    const result = await Delivery.aggregate([
      { $lookup: { from: 'families', localField: 'family', foreignField: '_id', as: 'family' } },
      { $unwind: '$family' },
      { $group: { _id: '$family.area', count: { $sum: 1 } } },
      { $project: { area: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deliveries-over-time', auth, isAdmin, async (req, res) => {
  const { period } = req.query;
  let limit = parseInt(req.query.limit) || 0;

  try {
    let groupBy;
    let matchCondition = {};

    if (period === 'daily') {
      groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
      if (limit === 0) limit = 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - limit);
      matchCondition.date = { $gte: startDate };
    } else if (period === 'weekly') {
      groupBy = { $dateToString: { format: '%Y-%U', date: '$date' } };
      if (limit === 0) limit = 12;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (limit * 7));
      matchCondition.date = { $gte: startDate };
    } else if (period === 'monthly') {
      groupBy = { $dateToString: { format: '%Y-%m', date: '$date' } };
      if (limit === 0) limit = 12;
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - limit);
      matchCondition.date = { $gte: startDate };
    } else {
      return res.status(400).json({ error: 'period must be daily, weekly, or monthly' });
    }

    const result = await Delivery.aggregate([
      { $match: matchCondition },
      { $group: { _id: groupBy, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { label: '$_id', count: 1, _id: 0 } }
    ]);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إحصائيات أداء المعتمدين
router.get('/agents-performance', auth, isAdmin, async (req, res) => {
  try {
    const result = await Delivery.aggregate([
      { $group: { _id: '$agent', deliveries: { $sum: 1 } } },
      { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
      { $project: { 
          name: { $ifNull: ['$agent.name', 'معتمد محذوف'] }, 
          deliveries: 1, 
          _id: 0 
      } },
      { $sort: { deliveries: -1 } }
    ]);
    res.json(result);
  } catch (err) {
    console.error('خطأ في agents-performance:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب بيانات أداء المعتمدين' });
  }
});

module.exports = router;