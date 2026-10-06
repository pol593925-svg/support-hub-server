const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// === ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ===
// Новая строка подключения MongoDB вставляется ниже (или через переменную окружения MONGO_URI на Render)
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://sashabriginets8_db_user:L0WmfQD7AfSRHYox@cluster0.swcowbh.mongodb.net/?appName=Cluster0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // картинки ленты и аватарки приходят base64 в JSON

mongoose.connect(MONGO_URI).then(() => {
  console.log("🟢 БАЗА ДАННЫХ ПОДКЛЮЧЕНА");
}).catch(err => {
  console.error("❌ Ошибка подключения к БД:", err);
});

// --- СХЕМЫ ---

// Схема пользователя
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }, // 'admin' или 'user'
  team: { type: String, default: '' },     // команда (из списка команд админа)
  position: { type: String, default: '' }, // должность (ставит админ в админке)
  avatar: { type: String, default: '' },   // аватарка (data URL, ставит сам)
  isMuted: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Схема команды (Штаб). Админ добавляет, при регистрации выбирают
const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true }
});
const Team = mongoose.model('Team', teamSchema);

// Схема записи справочника бирж
const exchangeSchema = new mongoose.Schema({
  section: { type: String, enum: ['yes', 'condition', 'no'], required: true },
  name: { type: String, required: true, trim: true },
  condition: { type: String, default: '' }
});
exchangeSchema.index({ section: 1, name: 1 }, { unique: true });
const Exchange = mongoose.model('Exchange', exchangeSchema);

// Схема события (логи, отпросы, колы, баги, овертаймы, уведомления)
const eventSchema = new mongoose.Schema({
  date: { type: String, required: true },        // YYYY-MM-DD (локальная дата отправителя)
  createdAt: { type: Date, default: Date.now },
  type: { type: String, required: true },        // 'log' | 'leave' | 'call' | 'bug' | 'overtime' | 'notify'
  user: { type: String, default: '' },           // кто отправил
  data: { type: Object, default: {} },           // поля формы (ссылки, комментарии и т.д.)
  durationMin: { type: Number, default: 0 }      // для овертаймов — автоматический расчёт
});
eventSchema.index({ date: 1, type: 1 });
eventSchema.index({ user: 1, date: 1 });
const Event = mongoose.model('Event', eventSchema);

// Схема дневной статистики (трюфеля / апрувы, вбивает админ вручную)
const dailyStatSchema = new mongoose.Schema({
  date: { type: String, required: true },        // YYYY-MM-DD
  username: { type: String, required: true, lowercase: true },
  truffles: { type: Number, default: 0 },
  approves: { type: Number, default: 0 }
});
dailyStatSchema.index({ date: 1, username: 1 }, { unique: true });
const DailyStat = mongoose.model('DailyStat', dailyStatSchema);

// Схема задачи чек-листа дня
const taskSchema = new mongoose.Schema({
  date: { type: String, required: true },   // YYYY-MM-DD
  text: { type: String, required: true },
  createdBy: { type: String, default: '' },
  done: { type: [String], default: [] }     // ники, кто отметил выполненным
});
const Task = mongoose.model('Task', taskSchema);

// Схема записи ленты картинок
const feedItemSchema = new mongoose.Schema({
  user: { type: String, required: true },
  dataUrl: { type: String, required: true },
  caption: { type: String, default: '' },
  likes: { type: [String], default: [] },
  dislikes: { type: [String], default: [] },
  comments: { type: [{ user: String, text: String, time: String }], default: [] },
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const FeedItem = mongoose.model('FeedItem', feedItemSchema);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Проверка, что запрос делает админ (передаём ?admin=username в GET или adminUsername в body)
async function verifyAdmin(req, res, next) {
  try {
    const adminName = (req.query.admin || req.body.adminUsername || '').trim().toLowerCase();
    if (!adminName) {
      return res.status(401).json({ success: false, message: 'Не указан админ' });
    }
    const admin = await User.findOne({ username: adminName });
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нет прав администратора' });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Автоматический расчёт длительности овертайма в минутах ("14:30" -> "16:00" = 90)
function calcDurationMin(from, to) {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  if (isNaN(fh) || isNaN(fm) || isNaN(th) || isNaN(tm)) return 0;
  let start = fh * 60 + fm;
  let end = th * 60 + tm;
  if (end < start) end += 24 * 60; // перешли через полночь
  return end - start;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- РОУТЫ АВТОРИЗАЦИИ И РЕГИСТРАЦИИ ---

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля!' });
    }

    username = username.trim().toLowerCase();

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Такой пользователь уже существует!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Если регистрируешься ты, автоматически даем права админа
    const role = (username === 'fifflaren') ? 'admin' : 'user';

    // Команда (проверяем, что она существует в списке команд)
    let team = '';
    if (req.body.team) {
      const teamName = String(req.body.team).trim();
      const teamDoc = await Team.findOne({ name: new RegExp(`^${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (!teamDoc) {
        return res.status(400).json({ success: false, message: 'Такой команды не существует!' });
      }
      team = teamDoc.name;
    }

    const newUser = new User({
      username,
      password: hashedPassword,
      role,
      team
    });

    await newUser.save();
    res.json({ success: true, message: 'Регистрация успешна!', role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Вход (Логин)
app.post('/api/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля!' });
    }

    username = username.trim().toLowerCase();

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль!' });
    }

    if (user.isBanned) {
      return res.status(403).json({ success: false, message: 'Ваш аккаунт заблокирован администратором!' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Неверный логин или пароль!' });
    }

    res.json({
      success: true,
      message: 'Успешный вход!',
      username: user.username,
      role: user.role,
      team: user.team || '',
      isMuted: user.isMuted
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- РОУТЫ МОДЕРАЦИИ (Мут / Бан) ---

// Мут / Размут пользователя
app.post('/api/moderate/mute', async (req, res) => {
  try {
    let { username, isMuted } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Не указан пользователь' });

    username = username.trim().toLowerCase();
    const user = await User.findOneAndUpdate(
      { username },
      { isMuted },
      { returnDocument: "after" }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

    io.emit('user_status_changed', { username: user.username, isMuted: user.isMuted, isBanned: user.isBanned });
    res.json({ success: true, isMuted: user.isMuted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Бан / Разбан пользователя
app.post('/api/moderate/ban', async (req, res) => {
  try {
    let { username, isBanned } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Не указан пользователь' });

    username = username.trim().toLowerCase();
    const user = await User.findOneAndUpdate(
      { username },
      { isBanned },
      { returnDocument: "after" }
    );

    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден в БД' });

    io.emit('user_status_changed', { username: user.username, isMuted: user.isMuted, isBanned: user.isBanned });
    res.json({ success: true, isBanned: user.isBanned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- АДМИН-РОУТЫ: ПОЛЬЗОВАТЕЛИ ---

// Список всех пользователей (для админки: мут/бан, счётчики)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ username: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СОБЫТИЯ (логи, отпросы, колы, баги, овертаймы) ---

// Приём события от приложения сотрудника
app.post('/api/events', async (req, res) => {
  try {
    const { user, type, date, ...fields } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, message: 'Не указан тип события' });
    }

    const eventDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : todayStr();
    let durationMin = 0;

    // Овертайм: считаем длительность автоматически из полей from/to
    if (type === 'overtime') {
      durationMin = calcDurationMin(fields.from, fields.to);
    }

    const event = new Event({
      date: eventDate,
      type: String(type),
      user: (user || '').trim().toLowerCase(),
      data: fields,
      durationMin
    });

    await event.save();

    // Уведомляем ТЛ команды: ТЛ — пользователь, чей ник совпадает с названием команды
    if (['call', 'leave', 'shift', 'bug'].includes(String(type))) {
      try {
        const sender = await User.findOne({ username: event.user });
        if (sender && sender.team) {
          const tlNick = sender.team.trim().toLowerCase();
          // ТЛ не получает уведомления о собственных действиях
          if (tlNick && tlNick !== event.user) {
            const payload = {
              type: String(type),
              user: event.user,
              data: fields,
              time: new Date().toLocaleTimeString('ru-RU'),
              date: eventDate
            };
            for (const [id, clientNick] of onlineUsers.entries()) {
              if (clientNick && clientNick.toLowerCase() === tlNick) {
                io.to(id).emit('tl_event', payload);
              }
            }
          }
        }
      } catch (e) {
        console.error('Ошибка уведомления ТЛ:', e.message);
      }
    }

    res.json({ success: true, id: event._id, durationMin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// События за конкретную дату (админ жмякает на дату — видит всё, что было)
app.get('/api/events', verifyAdmin, async (req, res) => {
  try {
    const { date, type, user } = req.query;
    const filter = {};
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) filter.date = date;
    if (type) filter.type = type;
    if (user) filter.user = user.trim().toLowerCase();

    const events = await Event.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// События команды ТЛ за дату (ТЛ = ник, совпадающий с названием команды). Только коллы, отпросы, смены, отписи.
app.get('/api/tl/events', async (req, res) => {
  try {
    const tl = (req.query.tl || '').trim().toLowerCase();
    if (!tl) return res.status(400).json({ success: false, message: 'Не указан ТЛ' });

    const team = await Team.findOne({ name: new RegExp('^' + tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!team) {
      return res.status(403).json({ success: false, message: 'Нет команды с таким ником — вы не ТЛ' });
    }

    const members = await User.find({ team: team.name }, { username: 1 });
    const memberNicks = members.map(m => m.username);
    if (!memberNicks.length) return res.json({ success: true, team: team.name, events: [] });

    const filter = {
      user: { $in: memberNicks },
      type: { $in: ['call', 'leave', 'shift', 'bug'] }
    };
    const date = req.query.date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) filter.date = date;

    const events = await Event.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, team: team.name, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- АДМИН-РОУТЫ: СЧЁТЧИКИ ТРЮФЕЛЕЙ / АПРУВОВ (вбиваются вручную) ---

// Сохранить (или обновить) цифры за день для сотрудника
app.post('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const { date, username, truffles, approves } = req.body;
    if (!username || !date) {
      return res.status(400).json({ success: false, message: 'Укажите дату и ник' });
    }

    const stat = await DailyStat.findOneAndUpdate(
      { date, username: username.trim().toLowerCase() },
      {
        truffles: Number(truffles) || 0,
        approves: Number(approves) || 0
      },
      { returnDocument: "after", upsert: true }
    );

    res.json({ success: true, stat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Цифры за один день (все сотрудники)
app.get('/api/admin/stats/day', verifyAdmin, async (req, res) => {
  try {
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
    const stats = await DailyStat.find({ date });
    res.json({ success: true, date, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Сводка за период (неделя/месяц): трюфеля, апрувы и овертаймы суммируются автоматически
app.get('/api/admin/stats/summary', verifyAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, message: 'Укажите период from/to в формате YYYY-MM-DD' });
    }

    // Суммы трюфелей и апрувов по сотрудникам
    const statAgg = await DailyStat.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: '$username', truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
    ]);

    // Суммы овертаймов (автоматически посчитанных) по сотрудникам
    const overtimeAgg = await Event.aggregate([
      { $match: { date: { $gte: from, $lte: to }, type: 'overtime' } },
      { $group: { _id: '$user', overtimeMin: { $sum: '$durationMin' } } }
    ]);

    const result = {};
    statAgg.forEach(s => {
      result[s._id] = { truffles: s.truffles, approves: s.approves, overtimeMin: 0 };
    });
    overtimeAgg.forEach(o => {
      if (!result[o._id]) result[o._id] = { truffles: 0, approves: 0, overtimeMin: 0 };
      result[o._id].overtimeMin = o.overtimeMin;
    });

    res.json({ success: true, from, to, summary: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Личная статистика сотрудника (без админки): неделя и месяц относительно даты
app.get('/api/stats/mine', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });

    // Календарные границы недели (пн–вс) и месяца от текущей даты
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const dayOfWeek = (now.getDay() + 6) % 7; // пн = 0
    const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const fmt = d => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD локально

    const weekFrom = fmt(monday), weekTo = fmt(sunday);
    const monthFrom = fmt(first), monthTo = fmt(last);

    async function sumFor(from, to) {
      const statAgg = await DailyStat.aggregate([
        { $match: { date: { $gte: from, $lte: to }, username } },
        { $group: { _id: null, truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
      ]);
      const overtimeAgg = await Event.aggregate([
        { $match: { date: { $gte: from, $lte: to }, type: 'overtime', user: username } },
        { $group: { _id: null, overtimeMin: { $sum: '$durationMin' } } }
      ]);
      return {
        truffles: statAgg[0]?.truffles || 0,
        approves: statAgg[0]?.approves || 0,
        overtimeMin: overtimeAgg[0]?.overtimeMin || 0
      };
    }

    const week = await sumFor(weekFrom, weekTo);
    const month = await sumFor(monthFrom, monthTo);

    res.json({
      success: true,
      username,
      week: { from: weekFrom, to: weekTo, ...week },
      month: { from: monthFrom, to: monthTo, ...month }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- КОМАНДЫ (ШТАБ) ---

// Список команд вместе с составом (публично — для регистрации и Штаба)
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await Team.find().sort({ name: 1 });
    const users = await User.find({ team: { $ne: '' } }, { username: 1, team: 1 });
    const roster = teams.map(t => ({
      name: t.name,
      users: users.filter(u => u.team === t.name).map(u => u.username)
    }));
    res.json({ success: true, teams: roster });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить команду (админ)
app.post('/api/admin/teams', verifyAdmin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Введите название команды' });

    await Team.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
    const teams = await Team.find().sort({ name: 1 });
    res.json({ success: true, teams: teams.map(t => t.name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить команду (админ). У сотрудников команда останется как текст, но из Штаба уйдёт
app.delete('/api/admin/teams', verifyAdmin, async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Не указано название' });

    await Team.deleteOne({ name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Сменить роль пользователя (админ): role = 'admin' | 'user'
app.post('/api/admin/role', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const role = req.body.role;
    if (!target) return res.status(400).json({ success: false, message: 'Не указан ник' });
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Роль должна быть admin или user' });
    }
    if (target === 'fifflaren' && role !== 'admin') {
      return res.status(400).json({ success: false, message: 'У fifflaren нельзя забрать админку' });
    }

    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    user.role = role;
    await user.save();
    res.json({ success: true, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СПРАВОЧНИК БИРЖ (на сервере) ---

// Весь справочник (публично)
app.get('/api/exchanges', async (req, res) => {
  try {
    const entries = await Exchange.find().sort({ name: 1 });
    res.json({ success: true, exchanges: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить запись (админ): section = 'yes' | 'condition' | 'no'
app.post('/api/admin/exchanges', verifyAdmin, async (req, res) => {
  try {
    const { section, name, condition } = req.body;
    if (!['yes', 'condition', 'no'].includes(section)) {
      return res.status(400).json({ success: false, message: 'Неверный раздел' });
    }
    const cleanName = (name || '').trim();
    if (!cleanName) return res.status(400).json({ success: false, message: 'Введите название биржи' });

    await Exchange.updateOne(
      { section, name: cleanName },
      { $setOnInsert: { section, name: cleanName, condition: (condition || '').trim() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить запись (админ)
app.delete('/api/admin/exchanges', verifyAdmin, async (req, res) => {
  try {
    const { section, name } = req.query;
    if (!section || !name) return res.status(400).json({ success: false, message: 'Не указаны раздел или название' });

    await Exchange.deleteOne({ section, name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ЧЕК-ЛИСТ ДНЯ ====================

// Задачи за дату (публично — все видят чек-лист)
app.get('/api/tasks', async (req, res) => {
  try {
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : todayStr();
    const tasks = await Task.find({ date }).sort({ _id: 1 });
    res.json({ success: true, date, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить задачу (админ)
app.post('/api/admin/tasks', verifyAdmin, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Введите текст задачи' });
    const date = (req.body.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) ? req.body.date : todayStr();
    const task = new Task({ date, text, createdBy: req.body.adminUsername || '' });
    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить задачу (админ)
app.delete('/api/admin/tasks', verifyAdmin, async (req, res) => {
  try {
    await Task.deleteOne({ _id: req.query.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Отметить/снять отметку «сделано» (сотрудник сам за себя)
app.post('/api/tasks/toggle', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const task = await Task.findById(req.body.id);
    if (!task) return res.status(404).json({ success: false, message: 'Задача не найдена' });
    const i = task.done.indexOf(username);
    if (i >= 0) task.done.splice(i, 1); else task.done.push(username);
    await task.save();
    res.json({ success: true, done: task.done });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ЛЕНТА КАРТИНОК ====================

// Лента: сначала закреплённые, потом свежие (до 100)
app.get('/api/feed', async (req, res) => {
  try {
    const items = await FeedItem.find().sort({ pinned: -1, createdAt: -1 }).limit(100);
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Добавить запись (любой сотрудник)
app.post('/api/feed', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const dataUrl = String(req.body.dataUrl || '');
    if (!username || !dataUrl) return res.status(400).json({ success: false, message: 'Нужен ник и картинка' });
    if (dataUrl.length > 14e6) return res.status(400).json({ success: false, message: 'Картинка слишком большая' });
    const item = new FeedItem({ user: username, dataUrl, caption: String(req.body.caption || '').slice(0, 300) });
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Лайк/дизлайк (переключение: повторное нажатие снимает)
app.post('/api/feed/react', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const kind = req.body.kind === 'dislike' ? 'dislikes' : 'likes';
    const other = kind === 'likes' ? 'dislikes' : 'likes';
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    const i = item[kind].indexOf(username);
    if (i >= 0) item[kind].splice(i, 1);
    else {
      item[kind].push(username);
      const j = item[other].indexOf(username);
      if (j >= 0) item[other].splice(j, 1); // нельзя лайкать и дизлайкать одновременно
    }
    await item.save();
    res.json({ success: true, likes: item.likes, dislikes: item.dislikes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Комментарий под записью
app.post('/api/feed/comment', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const text = String(req.body.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ success: false, message: 'Пустой комментарий' });
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    item.comments.push({ user: username, text, time: new Date().toLocaleTimeString('ru-RU') });
    await item.save();
    res.json({ success: true, comments: item.comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Удалить запись: автор сам, админ — любую
app.delete('/api/feed', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    const item = await FeedItem.findById(req.query.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    if (item.user !== username) {
      const admin = await User.findOne({ username });
      if (!admin || admin.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Удалить может автор или админ' });
      }
    }
    await FeedItem.deleteOne({ _id: item._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Закрепить/открепить (админ)
app.post('/api/admin/feed/pin', verifyAdmin, async (req, res) => {
  try {
    const item = await FeedItem.findById(req.body.id);
    if (!item) return res.status(404).json({ success: false, message: 'Запись не найдена' });
    item.pinned = !!req.body.pinned;
    await item.save();
    res.json({ success: true, pinned: item.pinned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== ПРОФИЛИ ====================

// Карточка пользователя: команда, должность, аватар, статистика месяца
app.get('/api/profile', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

    // Статистика за текущий месяц
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    const statAgg = await DailyStat.aggregate([
      { $match: { date: { $gte: from, $lte: to }, username } },
      { $group: { _id: null, truffles: { $sum: '$truffles' }, approves: { $sum: '$approves' } } }
    ]);
    const shiftCount = await Event.countDocuments({ date: { $gte: from, $lte: to }, type: 'shift', user: username });
    const likesReceived = await FeedItem.aggregate([
      { $match: { user: username } },
      { $group: { _id: null, n: { $sum: { $size: '$likes' } } } }
    ]);

    res.json({
      success: true,
      profile: {
        username: user.username,
        team: user.team || '',
        position: user.position || '',
        avatar: user.avatar || '',
        month: {
          truffles: statAgg[0]?.truffles || 0,
          approves: statAgg[0]?.approves || 0,
          shifts: shiftCount,
          likes: likesReceived[0]?.n || 0
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить/сменить свой аватар
app.post('/api/profile', async (req, res) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const dataUrl = String(req.body.avatar || '');
    if (!username) return res.status(400).json({ success: false, message: 'Укажите ник' });
    if (dataUrl.length > 400000) return res.status(400).json({ success: false, message: 'Аватар слишком большой (до ~300 КБ)' });
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.avatar = dataUrl;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Поставить должность (админ)
app.post('/api/admin/position', verifyAdmin, async (req, res) => {
  try {
    const target = (req.body.username || '').trim().toLowerCase();
    const user = await User.findOne({ username: target });
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    user.position = String(req.body.position || '').slice(0, 60);
    await user.save();
    res.json({ success: true, username: user.username, position: user.position });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- СЕРВЕР И СОКЕТЫ ---

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 25e6 // фото от админа приходят base64-пакетами
});

// Список активных пользователей в чате
let onlineUsers = new Map(); // socket.id -> nick

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Пользователь представился ником при входе в чат
  socket.on('join_chat', (nick) => {
    if (!nick) return;
    onlineUsers.set(socket.id, nick);
    broadcastOnlineUsers();
  });

  // Получаем сообщение от клиента и рассылаем всем (проверяем, не в муте ли)
  socket.on('chat_message', async (data) => {
    try {
      if (data && data.username) {
        const user = await User.findOne({ username: data.username.toLowerCase() });
        if (user && user.isMuted) {
          socket.emit('chat_error', { message: 'Вы получили мут и не можете писать в чат!' });
          return;
        }
        if (user && user.isBanned) {
          return;
        }
      }
      // Упоминания: @ник в сообщении → у упомянутого вылезает уведомление поверх окон
      if (data && data.message) {
        const mentions = String(data.message).match(/@([a-zA-Z0-9_]+)/g) || [];
        const from = (data.username || 'кто-то').toLowerCase();
        for (const m of mentions) {
          const nick = m.slice(1).toLowerCase();
          if (nick === from) continue; // себя не пинговать
          for (const [id, clientNick] of onlineUsers.entries()) {
            if (clientNick && clientNick.toLowerCase() === nick) {
              io.to(id).emit('show_notification', {
                text: `💬 ${data.username} упомянул тебя в чате: ${String(data.message).slice(0, 120)}`,
                from: 'упоминание',
                time: new Date().toLocaleTimeString('ru-RU')
              });
            }
          }
        }
      }

      io.emit('chat_message', data);
    } catch (err) {
      console.error('Ошибка при проверке прав сообщения:', err);
    }
  });

  // --- ТОЧЕЧНЫЙ ТРИГГЕР (старый формат) ---
  socket.on('admin_target_trigger', (data) => {
    for (let [id, clientNick] of onlineUsers.entries()) {
      if (clientNick && clientNick.toLowerCase() === data.targetNick.toLowerCase()) {
        io.to(id).emit('admin_trigger', { text: data.text });
        break;
      }
    }
  });

  // --- ГЛОБАЛЬНЫЙ ТРИГГЕР (старый формат) ---
  socket.on('admin_trigger', (data) => {
    io.emit('admin_trigger', data);
  });

  // --- УВЕДОМЛЕНИЕ ОТ АДМИНА (новое): всем или конкретному, поверх всех окон ---
  // data: { target: 'all' | 'ник', text: '...', from: 'Fifflaren' }
  socket.on('admin_notify', async (data) => {
    try {
      if (!data || !data.text) return;

      const payload = {
        text: String(data.text),
        from: data.from || 'Fifflaren',
        time: new Date().toLocaleTimeString('ru-RU')
      };

      // Рассылка: всем или одному конкретному нику
      if (data.target && data.target !== 'all') {
        for (let [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_notification', payload);
          }
        }
      } else {
        io.emit('show_notification', payload);
      }

      // Сохраняем в историю событий, чтобы админ видел, что отправлял
      const event = new Event({
        date: todayStr(),
        type: 'notify',
        user: (data.from || 'admin').toLowerCase(),
        data: { target: data.target || 'all', text: String(data.text) }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка отправки уведомления:', err);
    }
  });

  // --- ФОТО ОТ АДМИНА: открывается у сотрудника в отдельном окне ---
  socket.on('admin_image', async (data) => {
    try {
      if (!data || !data.dataUrl) return;

      const payload = {
        dataUrl: String(data.dataUrl),
        text: String(data.text || ''),
        from: data.from || 'admin',
        time: new Date().toLocaleTimeString('ru-RU')
      };

      if (data.target && data.target !== 'all') {
        for (const [id, clientNick] of onlineUsers.entries()) {
          if (clientNick && clientNick.toLowerCase() === String(data.target).toLowerCase()) {
            io.to(id).emit('show_image', payload);
          }
        }
      } else {
        io.emit('show_image', payload);
      }

      // В историю — без самого фото, только факт отправки
      const event = new Event({
        date: todayStr(),
        type: 'image',
        user: (data.from || 'admin').toLowerCase(),
        data: { target: data.target || 'all', text: payload.text }
      });
      await event.save();
    } catch (err) {
      console.error('Ошибка отправки фото:', err.message);
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

function broadcastOnlineUsers() {
  const uniqueNicks = Array.from(new Set(onlineUsers.values()));
  io.emit('update_chat_users', uniqueNicks);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер Support Hub v3 запущен на порту ${PORT}`);
});
