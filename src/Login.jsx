import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setErreur('')
    setChargement(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErreur('Email ou mot de passe incorrect')
    setChargement(false)
  }

  return (
    <div className="ecran-centre">
      <form onSubmit={handleLogin} className="carte-login">
        <h1>Pool de Hockey 🏒</h1>
        <input
          type="email"
          placeholder="Courriel"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {erreur && <p className="erreur">{erreur}</p>}
        <button type="submit" disabled={chargement}>
          {chargement ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}
