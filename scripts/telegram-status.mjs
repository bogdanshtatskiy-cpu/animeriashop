const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const adminChatId = process.env.ADMIN_TELEGRAM_ID?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const site = process.env.SHOP_URL?.trim() || 'https://animeriashop.vercel.app';
const webhookUrl = new URL('/api/telegram_webhook', site).href;
const configure = process.argv.includes('--configure-webhook');

if (!token || !adminChatId || !/^-?\d+$/.test(adminChatId)) {
  console.error('Set TELEGRAM_BOT_TOKEN and a numeric ADMIN_TELEGRAM_ID.');
  process.exit(1);
}
if (configure && (!secret || !/^[A-Za-z0-9_-]{24,256}$/.test(secret) || !webhookUrl.startsWith('https://'))) {
  console.error('Use an HTTPS SHOP_URL and a random TELEGRAM_WEBHOOK_SECRET of 24–256 allowed characters.');
  process.exit(1);
}

async function call(method, body) {
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error(method + ': Telegram did not respond.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) {
    const description = String(data?.description || 'Invalid Telegram response.').replaceAll(token, '[redacted]');
    throw new Error(method + ': ' + (data?.error_code || response.status) + ' ' + description);
  }
  return data.result;
}

try {
  const bot = await call('getMe');
  console.log('Bot: @' + bot.username);
  if (configure) {
    await call('setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: ['message'] });
    console.log('Webhook registered.');
  }
  const info = await call('getWebhookInfo');
  console.log('Webhook: ' + (info.url === webhookUrl ? 'expected URL' : info.url ? 'different URL' : 'missing'));
  console.log('Pending updates: ' + info.pending_update_count);
  if (info.last_error_message) console.log('Last Telegram error: ' + info.last_error_message.replaceAll(token, '[redacted]'));
  await call('getChat', { chat_id: adminChatId });
  console.log('Admin chat is visible to the bot.');
  if (process.env.REVIEWS_CHANNEL_ID) {
    const reviewChat = await call('getChatMember', { chat_id: process.env.REVIEWS_CHANNEL_ID, user_id: bot.id });
    if (reviewChat.status !== 'creator' && !(reviewChat.status === 'administrator' && reviewChat.can_post_messages)) {
      throw new Error('The bot needs permission to publish to the reviews channel.');
    }
    console.log('Reviews channel is writable.');
  }
  if (info.url !== webhookUrl) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
