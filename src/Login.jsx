import { useState } from 'react'
import { supabase } from './lib/supabase'
import Crest from './Crest'

// Message clair selon la vraie cause. Avant, TOUTE erreur (réseau, compte non
// confirmé, trop d'essais…) affichait « Email ou mot de passe incorrect »,
// ce qui rendait impossible de comprendre pourquoi quelqu'un ne rentre pas.
function messageErreur(error) {
  const msg = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  if (error?.status === 429 || msg.includes('rate limit') || code.includes('rate_limit')) {
    return 'Trop d’essais de suite. Attends 5 minutes et réessaie.'
  }
  if (msg.includes('not confirmed') || code === 'email_not_confirmed') {
    return 'Ce compte n’est pas encore confirmé. Dis-le à Eric, il va régler ça.'
  }
  if (msg.includes('banned') || code === 'user_banned') {
    return 'Ce compte est bloqué. Dis-le à Eric.'
  }
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    error?.status === 0
  ) {
    return 'Pas de connexion Internet. Vérifie ton réseau et réessaie.'
  }
  if (msg.includes('invalid login credentials') || code === 'invalid_credentials') {
    return 'Courriel ou mot de passe incorrect. Appuie sur « Voir » pour vérifier ce que tu écris (attention aux majuscules).'
  }
  return 'Connexion impossible : ' + (error?.message || 'erreur inconnue')
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [voir, setVoir] = useState(false)
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setErreur('')
    setChargement(true)
    // Sur cellulaire, le clavier met souvent une majuscule au début du
    // courriel et un espace à la fin : on nettoie avant d'envoyer.
    const courriel = email.trim().toLowerCase()
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: courriel, password })
      if (error) setErreur(messageErreur(error))
    } catch (err) {
      setErreur(messageErreur(err))
    }
    setChargement(false)
  }

  return (
    <div className="ecran-centre">
      <form onSubmit={handleLogin} className="carte-login">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <Crest taille={64} />
        </div>
        <h1>Pool de Hockey</h1>
        <input
          type="email"
          name="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Courriel"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div className="champ-mdp">
          <input
            type={voir ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="voir-mdp"
            onClick={() => setVoir((v) => !v)}
            aria-label={voir ? 'Cacher le mot de passe' : 'Voir le mot de passe'}
          >
            {voir ? 'Cacher' : 'Voir'}
          </button>
        </div>
        {erreur && <p className="erreur" role="alert">{erreur}</p>}
        <button type="submit" disabled={chargement}>
          {chargement ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
