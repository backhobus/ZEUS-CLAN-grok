/**
 * ZEUS CLAN 가입 신청 API
 * - IP와 국가코드는 Cloudflare가 제공하는 서버 측 요청 정보에서 가져옵니다.
 * - 비한국/IP 미확인/BLOCKED_APPLICATION_IPS 등록 IP는 신청 POST만 차단합니다.
 * - 홈페이지 및 명예의 전당 조회 API에는 이 차단을 적용하지 않습니다.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function parseBlockedIps(value) {
  return new Set(
    String(value || '')
      .split(/[\s,;]+/)
      .map((ip) => ip.trim().toLowerCase())
      .filter(Boolean)
  );
}

function safeText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength) || '확인 불가';
}

export async function onRequestPost({ request, env }) {
  // CF-Connecting-IP와 request.cf는 Cloudflare 엣지에서 제공되는 정보입니다.
  const ipAddress = (request.headers.get('CF-Connecting-IP') || '').trim();
  const country = String(
    (request.cf && request.cf.country) || request.headers.get('CF-IPCountry') || ''
  ).trim().toUpperCase();

  if (!ipAddress) {
    return json({
      result: 'blocked',
      code: 'IP_UNAVAILABLE',
      message: 'IP 주소를 확인할 수 없어 가입 신청을 진행할 수 없습니다.'
    }, 403);
  }

  if (country !== 'KR') {
    return json({
      result: 'blocked',
      code: 'COUNTRY_BLOCKED',
      message: '대한민국에서만 가입 신청을 할 수 있습니다.'
    }, 403);
  }

  const blockedIps = parseBlockedIps(env.BLOCKED_APPLICATION_IPS);
  if (blockedIps.has(ipAddress.toLowerCase())) {
    return json({
      result: 'blocked',
      code: 'IP_BLOCKED',
      message: '가입 신청이 제한된 IP 주소입니다. 관리자에게 문의해주세요.'
    }, 403);
  }

  let submitted;
  try {
    submitted = await request.json();
  } catch (_) {
    return json({ result: 'error', message: '신청 데이터 형식이 올바르지 않습니다.' }, 400);
  }

  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    return json({ result: 'error', message: '신청 데이터 형식이 올바르지 않습니다.' }, 400);
  }

  const requiredFields = ['nickname', 'gameUid', 'age', 'reason', 'tournament'];
  if (requiredFields.some((field) => !String(submitted[field] || '').trim())) {
    return json({ result: 'error', message: '신청서 필수 항목이 누락되었습니다.' }, 400);
  }

  if (!env.GAS_ENDPOINT || !env.GAS_SHARED_SECRET) {
    console.error('Missing GAS_ENDPOINT or GAS_SHARED_SECRET Pages environment variable.');
    return json({ result: 'error', message: '서버 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.' }, 500);
  }

  const userAgent = request.headers.get('User-Agent') || '';
  let os = safeText(submitted.os, 80);
  if (os === '확인 불가') {
    if (/Android/i.test(userAgent)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(userAgent)) os = 'iOS/iPadOS';
    else if (/Windows/i.test(userAgent)) os = 'Windows';
    else if (/Mac OS X|Macintosh/i.test(userAgent)) os = 'macOS';
    else if (/Linux/i.test(userAgent)) os = 'Linux';
  }

  const gasPayload = {
    nickname: String(submitted.nickname).trim().slice(0, 40),
    gameUid: String(submitted.gameUid).trim().toUpperCase().slice(0, 16),
    age: String(submitted.age).trim().slice(0, 40),
    reason: String(submitted.reason).trim().slice(0, 500),
    tournament: String(submitted.tournament).trim().slice(0, 20),
    submittedAt: submitted.submittedAt || new Date().toISOString(),
    ipAddress,
    country,
    os,
    deviceModel: safeText(submitted.deviceModel, 120),
    // 아래 값은 스프레드시트 열에는 기록하지 않고 필요 시 Apps Script 로그 등에서만 참고할 수 있습니다.
    userAgent,
    sharedSecret: env.GAS_SHARED_SECRET
  };

  try {
    const gasResponse = await fetch(env.GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gasPayload),
      redirect: 'follow'
    });

    const responseText = await gasResponse.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (_) {
      console.error('Unexpected Apps Script response:', responseText.slice(0, 500));
      return json({ result: 'error', message: '신청 저장 서버에서 올바르지 않은 응답을 받았습니다.' }, 502);
    }

    if (!gasResponse.ok || result.result !== 'success') {
      console.error('Apps Script rejected application:', result);
      return json({
        result: 'error',
        message: result.message || '가입 신청을 저장하지 못했습니다.'
      }, 502);
    }

    return json(result, 200);
  } catch (error) {
    console.error('Apps Script forwarding failed:', error);
    return json({
      result: 'error',
      message: '신청 저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'
    }, 502);
  }
}
