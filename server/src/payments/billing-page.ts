/** 카드 등록 페이지 HTML. 앱 안 브라우저로 연다. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// <script> 안에 넣을 값. </script> 로 끊기지 않게 < 를 바꾼다.
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const shell = (title: string, body: string) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:#f6f5f2;color:#1b1f2a}
  main{max-width:420px;margin:0 auto;padding:48px 24px;text-align:center}
  h1{font-size:22px;margin:16px 0 8px} p{color:#5b6070;line-height:1.6}
  button{margin-top:24px;width:100%;padding:16px;border:0;border-radius:12px;background:#f5a524;color:#1b1f2a;font-size:17px;font-weight:700}
  .icon{font-size:48px}
</style></head><body><main>${body}</main></body></html>`;

export function billingPage(p: { pgEnabled: boolean; clientKey: string | null; customerKey: string; successUrl: string; failUrl: string }) {
  if (!p.pgEnabled) {
    // 결제사 키가 없을 때: 시연용 카드를 바로 등록한다
    const url = `${p.successUrl}&customerKey=${encodeURIComponent(p.customerKey)}&authKey=mock`;
    return shell('카드 등록', `
      <div class="icon">💳</div>
      <h1>시연용 카드 등록</h1>
      <p>결제사 연동 키가 아직 없어서 실제 카드 대신 시연용 카드를 등록해요. 돈은 나가지 않아요.</p>
      <button onclick="location.href=${esc(js(url))}">시연용 카드 등록하기</button>`);
  }
  return shell('카드 등록', `
    <div class="icon">💳</div>
    <h1>결제 카드 등록</h1>
    <p>작업이 끝나면 등록한 카드로 자동 결제돼요. 카드 정보는 토스페이먼츠가 안전하게 보관해요.</p>
    <button id="go">카드 등록하기</button>
    <script src="https://js.tosspayments.com/v2/standard"></script>
    <script>
      const P = ${js(p)};
      async function go() {
        try {
          const payment = TossPayments(P.clientKey).payment({ customerKey: P.customerKey });
          await payment.requestBillingAuth({ method: 'CARD', successUrl: P.successUrl, failUrl: P.failUrl });
        } catch (e) {
          if (e && e.code === 'USER_CANCEL') return;
          alert((e && e.message) || '카드 등록을 시작하지 못했어요');
        }
      }
      document.getElementById('go').onclick = go;
      go();
    </script>`);
}

export function billingDonePage(card: { cardCompany: string | null; cardNumber: string | null }) {
  return shell('카드 등록 완료', `
    <div class="icon">✅</div>
    <h1>카드를 등록했어요</h1>
    <p>${esc([card.cardCompany, card.cardNumber].filter(Boolean).join(' '))}</p>
    <p>이 창을 닫고 앱으로 돌아가 주세요.</p>
    <button onclick="window.close()">닫기</button>`);
}

export function billingFailPage(message: string) {
  return shell('카드 등록 실패', `
    <div class="icon">⚠️</div>
    <h1>카드를 등록하지 못했어요</h1>
    <p>${esc(message)}</p>
    <p>앱으로 돌아가 다시 시도해 주세요.</p>
    <button onclick="window.close()">닫기</button>`);
}
