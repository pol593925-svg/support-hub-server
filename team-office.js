'use strict';
const owner = 'fifflaren';
const teamOf = user => String(user?.team || '').trim().toLowerCase();
const nickOf = user => user.username.toLowerCase();
const clean = (v, limit) => typeof v === 'string' && v.trim().length <= limit ? v.trim() : '';
const id = v => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const games = new Set(['dust2', 'inferno']);
const hour = 3600000;

function install({ app, mongoose, authenticate, Event, User }) {
  const decision = new mongoose.Schema({
    team: String, callId: String, title: String, situation: String, solution: String
  }, {timestamps:true});
  decision.index({team:1, callId:1}, {unique:true});
  const gathering = new mongoose.Schema({
    team: String, host: String, map: String, start: Date, members: [String], expires: Date
  }, {timestamps:true});
  gathering.index({expires:1}, {expireAfterSeconds:0});
  gathering.index({team:1, start:1});
  const Decision = mongoose.model('OfficeDecision', decision);
  const Match = mongoose.model('OfficeGathering', gathering);
  function route(method, endpoint, action) {
    app[method]('/api/office' + endpoint, async (req, res) => {
      try {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        const user = await authenticate(token);
        if (!user || !teamOf(user)) return res.status(403).json({success:false,message:'Войди в аккаунт своей команды.'});
        await action(req, res, teamOf(user), nickOf(user));
      } catch {
        res.status(500).json({success:false,message:'Не удалось обновить штаб. Попробуй ещё раз.'});
      }
    });
  }
  const fail = (res, status, message) => res.status(status).json({success:false, message});

  route('get', '/decisions', async (req, res, team) => {
    const query = clean(req.query.q || '', 120);
    const filter = {team};
    if (query) {
      const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['title','situation','solution'].map(field => ({[field]:{$regex:literal,$options:'i'}}));
    }
    const docs = await Decision.find(filter, 'title situation solution').sort({updatedAt:-1}).limit(60).lean();
    res.json({success:true,items:docs});
  });
  route('post', '/decisions', async (req, res, team, nick) => {
    if (nick !== owner) return fail(res, 403, 'Публикует Fifflaren.');
    const {callId} = req.body;
    const title = clean(req.body.title,100), situation = clean(req.body.situation,1000), solution = clean(req.body.solution,1500);
    if (!id(callId) || !title || !situation || !solution) return fail(res,400,'Заполни название, ситуацию и решение.');
    const call = await Event.findOne({_id:callId,type:'call','data.reviewStatus':'done'}, 'data.teamAtSubmission user').lean();
    const callTeam = call?.data?.teamAtSubmission ?? (call ? teamOf(await User.findOne({username:call.user}, 'team')) : '');
    if (!call || callTeam !== team) return fail(res,404,'Выбери сделанный колл своей команды.');
    const update = {$set:{title,situation,solution}};
    try { await Decision.updateOne({team,callId},update,{upsert:true}); }
    catch (error) { if (error.code !== 11000) throw error; await Decision.updateOne({team,callId},update); }
    res.json({success:true});
  });
  route('get', '/matches', async (_req, res, team) => {
    const matches = await Match.find({team,expires:{$gt:new Date()}}, 'host map start members').sort({start:1}).limit(60).lean();
    res.json({success:true,matches,now:Date.now()});
  });
  route('post', '/matches', async (req, res, team, nick) => {
    const start = req.body.start, map = req.body.map, now = Date.now();
    if (!games.has(map) || !Number.isSafeInteger(start) || start < now - 60000 || start > now + 7*24*hour) {
      return fail(res,400,'Выбери карту и время в ближайшие семь дней.');
    }
    // A client generates the id once per form so a retry cannot create two gatherings.
    if (!id(req.body.id)) return fail(res,400,'Некорректный номер сбора.');
    const match = {_id:req.body.id,team,host:nick,map,start:new Date(start),members:[nick],expires:new Date(start+2*hour)};
    try { await Match.create(match); }
    catch (error) {
      if (error.code !== 11000) throw error;
      if (!await Match.exists({_id:match._id,team,host:nick,map,start:match.start})) return fail(res,409,'Сбор с таким номером уже существует.');
    }
    res.json({success:true});
  });
  route('patch', '/matches/:id', async (req,res,team,nick) => {
    const join = req.body.join;
    if (!id(req.params.id) || typeof join !== 'boolean') return fail(res,400,'Некорректный запрос.');
    const filter = {_id:req.params.id,team,expires:{$gt:new Date()}};
    const result = await Match.updateOne(filter, join ? {$addToSet:{members:nick}} : {$pull:{members:nick}});
    if (!result.matchedCount) return fail(res,404,'Сбор завершён.');
    res.json({success:true});
  });
  route('delete', '/matches/:id', async (req,res,team,nick) => {
    if (!id(req.params.id)) return fail(res,400,'Некорректный номер сбора.');
    const filter = {_id:req.params.id,team};
    if (nick !== owner) filter.host = nick;
    const result = await Match.deleteOne(filter);
    if (!result.deletedCount) return fail(res,404,'Сбор недоступен для отмены.');
    res.json({success:true});
  });
}
module.exports = install;
