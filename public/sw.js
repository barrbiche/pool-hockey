self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const titre = data.titre || 'Pool de Hockey'
  const options = {
    body: data.corps || "C'est ton tour de choisir !",
    icon: '/logo.jpeg',
    badge: '/logo.jpeg',
  }
  event.waitUntil(self.registration.showNotification(titre, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/'))
})
