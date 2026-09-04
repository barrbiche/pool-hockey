self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const titre = data.titre || 'Pool de Hockey'
  const options = {
    body: data.corps || "C'est ton tour de choisir !",
    icon: '/logo-notif.png',
    // Pas de "badge": sur Android le badge est toujours transformé en
    // silhouette monochrome par le système peu importe l'image fournie
    // (limite du système, pas quelque chose qu'on peut styliser). En
    // omettant ce champ, Android utilise son icône par défaut à la place.
  }
  event.waitUntil(self.registration.showNotification(titre, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow('/'))
})
