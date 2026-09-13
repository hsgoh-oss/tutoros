/* TUTOR OS 서비스 워커 — 웹 푸시 수신 전용.
 *
 * 오프라인 캐시는 하지 않는다. 개인정보 처리방침 11절 "offline 기능에는 공개 정적 자산과 연결 안내만
 * 저장하며 계정·수업·성적·결제·파일 개인정보를 저장하지 않는다" — 캐시를 두지 않는 것이 가장 확실한
 * 이행이다. 이 파일이 하는 일은 둘뿐이다: 푸시를 받아 띄우고, 누르면 해당 화면을 연다.
 *
 * 페이로드(JSON): { title, body, url, tag } — lib/push/send.ts가 만든다. 본문에 로그인 링크는 없다.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "TUTOR OS", body: "", url: "/", tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // JSON이 아니면 본문 텍스트로 취급한다.
    data.body = event.data ? event.data.text() : "";
  }
  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // 같은 화면이 이미 열려 있으면 그 탭을 앞으로, 아니면 새 탭.
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
