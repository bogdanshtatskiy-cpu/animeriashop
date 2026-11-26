import { database, requireAdmin } from '../server/firebase.js';
import { documentId, post } from '../server/http.js';
import { deliverOrderNotification } from '../server/notifications.js';

export default post(async (request, response, body) => {
  await requireAdmin(request);
  const ref = database().collection('orders').doc(documentId(body.orderId));
  const result = await deliverOrderNotification(ref, 'adminNotice');
  return response.status(result.sent ? 200 : 502).json(result);
});
