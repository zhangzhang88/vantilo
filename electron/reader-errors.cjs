// Only fixed categories cross the Reader process boundary; never expose backend text.
const messages = Object.freeze({
  timeout: 'GPT 阅读任务超时，请检查网络后重试。',
  login: 'GPT 登录状态不可用，请在 Agent 中重新登录后重试。',
  network: '无法连接 GPT 服务，请检查网络后重试。',
  rate: 'GPT 服务当前繁忙或已达到使用限制，请稍后重试。',
  model: '所选 GPT 模型当前不可用，请重新选择模型后重试。',
  cancelled: '阅读任务未完成：已取消。',
  failed: 'Agent 阅读任务失败，请检查登录状态或稍后重试',
});
function readerErrorCode(error) {
  const text = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
  if (/timeout|timed out|超时/i.test(text)) return 'timeout';
  if (/cancelled|canceled|取消/i.test(text)) return 'cancelled';
  if (/rate.limit|quota|\b429\b|限额|使用限制/i.test(text)) return 'rate';
  if (/unauthorized|unauthenticated|\b401\b|请先登录|登录状态|authentication/i.test(text)) return 'login';
  if (/model.{0,80}(unavailable|not supported|ambiguous)|模型.{0,30}不可用/i.test(text)) return 'model';
  if (/network|connection|connect|dns|网络|无法连接/i.test(text)) return 'network';
  return 'failed';
}
function readerErrorMessage(code) { return Object.hasOwn(messages, code) ? messages[code] : messages.failed; }
module.exports = { readerErrorCode, readerErrorMessage };
