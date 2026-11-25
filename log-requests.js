'use strict';
const crypto = require('crypto');
const { teamOf } = require('./work-team');
const { validLogQuantity, snapshot } = require('./call-workflow');
const { avatar } = require('./call-authors');

module.exports = function install({ app, Event, actor, bearer, ownerTeam, notify, callRow, calendar }) {
  const fail = (res, code, message) => res.status(code).json({ success: false, message });
  app.post('/api/calls/log-requests', async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    let id, user, quantity, requestId;
    try {
      user = await actor(bearer(req));
      if (!user) return fail(res, 401, 'Войди в Support Hub заново.');
      const team = await ownerTeam();
      if (!team) return fail(res, 409, 'Приём заявок временно недоступен.');
      if (teamOf(user) !== team) return fail(res, 403, 'Заявки доступны сотрудникам команды.');
      quantity = req.body.quantity;
      requestId = typeof req.body.requestId === 'string' ? req.body.requestId : '';
      if (!validLogQuantity(quantity) || !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId))
        return fail(res, 400, 'Укажи целое количество от 1 до 100000 и повтори отправку.');
      const username = user.username.toLowerCase();
      // The unique database id makes network retries and simultaneous clicks idempotent.
      id = crypto.createHash('sha256').update('log-request\0' + username + '\0' + requestId).digest('hex').slice(0, 24);
      const at = new Date();
      const data = {
        requestType: 'logs', requestId, requestOriginalQuantity: quantity, requestQuantity: quantity,
        callType: 'Запросить логов', serviceName: 'Запрос логов · ' + quantity,
        callLink: '', callNote: '', teamAtSubmission: team, submittedByTeam: teamOf(user),
        reviewStatus: 'pending', reviewReason: '', reviewVersion: 0
      };
      data.reviewHistory = [{ action: 'submitted', by: username, at, ...snapshot(data) }];
      // This is a quantity-only manual work ticket; it performs no data acquisition.
      const event = new Event({ _id: id, user: username, type: 'call', date: calendar().day, createdAt: at, data });
      await event.save();
      await notify(event).catch(() => {});
      return res.status(201).json({ success: true, call: { ...callRow(event), avatar: avatar(user.avatar) }, replayed: false });
    } catch (error) {
      if (error?.code === 11000 && id && user) {
        try {
          const event = await Event.findOne({ _id: id, type: 'call', user: user.username.toLowerCase(),
            'data.requestType': 'logs', 'data.requestId': requestId });
          if (event && event.data.requestOriginalQuantity === quantity)
            return res.json({ success: true, call: { ...callRow(event), avatar: avatar(user.avatar) }, replayed: true });
          return fail(res, 409, 'Эта отправка уже использована для другой заявки. Открой форму заново.');
        } catch {}
      }
      return fail(res, 503, 'Не удалось отправить заявку. Повтори попытку — копия не появится.');
    }
  });
};
