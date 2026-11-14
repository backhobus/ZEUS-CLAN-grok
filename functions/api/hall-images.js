/** 명예의 전당 조회 프록시. IP/국가/IP 차단 여부와 관계없이 조회를 허용합니다. */

export async function onRequestGet({ request, env }) {
  if (!env.GAS_ENDPOINT) {
    return new Response(JSON.stringify({ ok: false, message: 'GAS_ENDPOINT 설정이 필요합니다.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  try {
    const incomingUrl = new URL(request.url);
    const gasUrl = new URL(env.GAS_ENDPOINT);
    gasUrl.searchParams.set('action', 'hallImages');
    const callback = incomingUrl.searchParams.get('callback');
    if (callback) gasUrl.searchParams.set('callback', callback);

    const upstream = await fetch(gasUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': callback ? 'application/javascript, application/json' : 'application/json',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow'
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : 502,
      headers: {
        'Content-Type': callback ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('Hall of Fame proxy failed:', error);
    return new Response(JSON.stringify({ ok: false, message: '명예의 전당을 불러오지 못했습니다.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
