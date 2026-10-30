import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { API_URL, api, formatDate, Icon, statusLabel } from './utils'
import { PhotoField, VoiceField, shrinkImage } from './MediaFields'
import { CivicMap, LocationPicker } from './MapComponents'
import AuthorityDepartmentPanel from './AuthorityDepartmentPanel'
import DepartmentApplicationForm from './DepartmentApplicationForm'
import ComplaintUpdates from './ComplaintUpdates'
import DepartmentDashboardPanel from './DepartmentDashboardPanel'
import AuthorityComplaintInfo from './AuthorityComplaintInfo'
import AuthorityLocationSetup from './AuthorityLocationSetup'

/* ------------------------------------------------------------------ */
/* Main app                                                            */
/* ------------------------------------------------------------------ */

const CATEGORIES = ['Roads', 'Streetlight', 'Water', 'Garbage', 'Drainage', 'Other']

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('citizenToken') || '')

  // auth
  const [isRegister, setIsRegister] = useState(false)
  const [showDepartmentApplication, setShowDepartmentApplication] = useState(false)
  const [authPortal, setAuthPortal] = useState('citizen')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [profileAddress, setProfileAddress] = useState('')
  const [profileLatitude, setProfileLatitude] = useState('')
  const [profileLongitude, setProfileLongitude] = useState('')
  const [registrationLocationMessage, setRegistrationLocationMessage] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsView, setSettingsView] = useState('')
  const [activeMenuView, setActiveMenuView] = useState('dashboard')
  const [authorityLocationRequired, setAuthorityLocationRequired] = useState(false)
  const [departmentProfile, setDepartmentProfile] = useState(null)
  const [mapComplaints, setMapComplaints] = useState([])
  const [departments, setDepartments] = useState([])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // data
  const [citizen, setCitizen] = useState(null)
  const [complaints, setComplaints] = useState([])
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const navigationPositionRef = useRef(0)
  const navigationLimitRef = useRef(0)

  // ui
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showComplaintForm, setShowComplaintForm] = useState(false)

  // form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Roads')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [photoMessage, setPhotoMessage] = useState('')
  const [audio, setAudio] = useState(null)
  const [audioMessage, setAudioMessage] = useState('')
  const recorderRef = useRef(null)

  useEffect(() => {
    window.history.replaceState(
      { app: 'smart-civic-system', view: 'dashboard', index: 0 },
      '',
      window.location.href
    )

    function restoreNavigation(event) {
      const entry = event.state
      if (entry?.app !== 'smart-civic-system') return

      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()

      const nextIndex = Number.isInteger(entry.index) ? entry.index : 0
      navigationPositionRef.current = nextIndex
      navigationLimitRef.current = Math.max(navigationLimitRef.current, nextIndex)
      setSelectedComplaint(entry.view === 'complaint' ? entry.complaint || null : null)
      setShowComplaintForm(entry.view === 'form')
    }

    window.addEventListener('popstate', restoreNavigation)
    return () => window.removeEventListener('popstate', restoreNavigation)
  }, [])

  function navigateTo(view, complaint = null, replace = false) {
    const index = replace
      ? navigationPositionRef.current
      : navigationPositionRef.current + 1
    const entry = {
      app: 'smart-civic-system',
      view,
      complaint: view === 'complaint' ? complaint : null,
      index,
    }

    window.history[replace ? 'replaceState' : 'pushState'](
      entry,
      '',
      window.location.href
    )
    navigationPositionRef.current = index
    if (!replace) navigationLimitRef.current = index
    setSelectedComplaint(view === 'complaint' ? complaint : null)
    setShowComplaintForm(view === 'form')
  }

  /* ---------- auth ---------- */

  async function login(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { email: email.trim(), password, portal: authPortal },
      })
      if (!data.access_token) throw new Error('The server did not return an access token.')
      localStorage.setItem('citizenToken', data.access_token)
      setToken(data.access_token)
      setActiveMenuView('dashboard')
      setPassword('')
      navigationPositionRef.current = 0
      navigationLimitRef.current = 0
      window.history.replaceState(
        { app: 'smart-civic-system', view: 'dashboard', index: 0 },
        '',
        window.location.href
      )
    } catch (err) {
      setError(err.message || 'Login failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  async function register(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await api('/auth/register', {
        method: 'POST',
        json: { full_name: fullName.trim(), email: email.trim(), password, phone: phone.trim(), address: profileAddress.trim(), latitude: citizen?.role === 'authority' ? citizen.latitude : (profileLatitude === '' ? null : Number(profileLatitude)), longitude: citizen?.role === 'authority' ? citizen.longitude : (profileLongitude === '' ? null : Number(profileLongitude)) },
      })

      // sign in automatically
      try {
        const loginData = await api('/auth/login', {
          method: 'POST',
          json: { email: email.trim(), password, portal: 'citizen' },
        })
        if (!loginData.access_token) throw new Error('no token')
        localStorage.setItem('citizenToken', loginData.access_token)
        setToken(loginData.access_token)
        setPassword('')
        setFullName('')
        navigationPositionRef.current = 0
        navigationLimitRef.current = 0
            window.history.replaceState(
          { app: 'smart-civic-system', view: 'dashboard', index: 0 },
          '',
          window.location.href
        )
      } catch {
        setIsRegister(false)
        setPassword('')
        setNotice('Account created. Sign in to continue.')
      }
    } catch (err) {
      setError(err.message || 'Registration failed. Check your details.')
    } finally {
      setLoading(false)
    }
  }

  function logout(message = 'You have logged out.') {
    localStorage.removeItem('citizenToken')
    setToken('')
    setActiveMenuView('dashboard')
    setAuthorityLocationRequired(false)
    setDepartmentProfile(null)
    setCitizen(null)
    setComplaints([])
    setSelectedComplaint(null)
    setShowComplaintForm(false)
    setSettingsView('')
    setMenuOpen(false)
    setProfileOpen(false)
    setEmail('')
    setPassword('')
    setFullName('')
    setPhone('')
    setProfileAddress('')
    setProfileLatitude('')
    setProfileLongitude('')
    setError('')
    setNotice(message)
    navigationPositionRef.current = 0
    navigationLimitRef.current = 0
    window.history.replaceState(
      { app: 'smart-civic-system', view: 'dashboard', index: 0 },
      '',
      window.location.href
    )
  }

  /* ---------- data ---------- */

  const loadComplaints = useCallback(
    async (currentToken) => {
      if (!currentToken) return
      setLoading(true)
      setError('')
      try {
        const data = await api('/complaints/', { token: currentToken })
        if (!Array.isArray(data)) throw new Error('Unexpected complaints response from the server.')
        setComplaints(data)
        setSelectedComplaint((current) =>
          current ? data.find((item) => item.id === current.id) || null : null
        )
        try {
          const me = await api('/auth/me', { token: currentToken })
          setCitizen(me)
          setAuthorityLocationRequired(me.role === 'authority' && (me.latitude == null || me.longitude == null))
          if (['department_staff', 'department'].includes(me.role)) {
            try { setDepartmentProfile(await api('/departments/mine', { token: currentToken })) } catch { setDepartmentProfile(null) }
          } else { setDepartmentProfile(null) }
          setFullName(me.full_name || '')
          setEmail(me.email || '')
          setPhone(me.phone || '')
          setProfileAddress(me.address || '')
          setProfileLatitude(me.latitude == null ? '' : String(me.latitude))
          setProfileLongitude(me.longitude == null ? '' : String(me.longitude))
        } catch {
          /* profile is optional for the dashboard */
        }
      } catch (err) {
        if (err.status === 401) {
          logout('Your session expired. Please sign in again.')
        } else {
          setError(err.message || 'Could not load complaints.')
        }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (token) loadComplaints(token)
  }, [token, loadComplaints])

  const loadMapComplaints = useCallback(async (currentToken) => {
    if (!currentToken) return
    try {
      const data = await api('/complaints/map', { token: currentToken })
      if (Array.isArray(data)) setMapComplaints(data)
    } catch {
      // The complaint list remains usable if map data is temporarily unavailable.
    }
  }, [])

  useEffect(() => {
    if (token) loadMapComplaints(token)
  }, [token, loadMapComplaints])

  useEffect(() => {
    if (!token) return
    api('/departments', { token })
      .then((data) => { if (Array.isArray(data)) setDepartments(data) })
      .catch(() => setDepartments([]))
  }, [token])

  async function updateComplaintStatus(complaintId, status) {
    setLoading(true); setError(''); setNotice('')
    try {
      const updated = await api(`/complaints/${complaintId}/status`, {
        token, method: 'PATCH', json: { status, note: `Status updated to ${status.replaceAll('_', ' ')}` },
      })
      setSelectedComplaint(updated)
      await Promise.all([loadComplaints(token), loadMapComplaints(token)])
      setNotice(`Complaint #${complaintId} is now ${status.replaceAll('_', ' ')}.`)
    } catch (err) {
      setError(err.message || 'Could not update complaint status.')
    } finally { setLoading(false) }
  }

  async function assignComplaint(complaintId) {
    if (!selectedDepartmentId) { setError('Choose a department first.'); return }
    setLoading(true); setError(''); setNotice('')
    try {
      const updated = await api(`/complaints/${complaintId}/assign`, {
        token, method: 'PATCH', json: { department_id: Number(selectedDepartmentId) },
      })
      setSelectedComplaint(updated)
      await Promise.all([loadComplaints(token), loadMapComplaints(token)])
      setNotice(`Complaint #${complaintId} assigned successfully.`)
    } catch (err) {
      setError(err.message || 'Could not assign complaint.')
    } finally { setLoading(false) }
  }

  /* ---------- location ---------- */

  function getDeviceLocation() {
    setLocationMessage('')
    if (!navigator.geolocation) {
      setLocationMessage('Location is not supported by this browser. You can still submit without it.')
      return
    }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude))
        setLongitude(String(position.coords.longitude))
        setLocationMessage(`Accurate to about ${Math.round(position.coords.accuracy)} metres.`)
        setLocationLoading(false)
      },
      (err) => {
        setLocationMessage(
          err.code === 1
            ? 'Location permission was denied. Allow location access in your browser and try again.'
            : err.code === 2
              ? 'Your device could not find its location. Turn on device location and try again.'
              : 'Location request timed out. Try again.'
        )
        setLocationLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  async function deleteComplaint(complaintId) {
    const confirmed = window.confirm(`Delete complaint #${complaintId}? This also removes its attached photo/audio and cannot be undone.`)
    if (!confirmed) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await api(`/complaints/${complaintId}`, { token, method: 'DELETE' })
      setSelectedComplaint(null)
      setShowComplaintForm(false)
      setSettingsView('')
      setNotice(`Complaint #${complaintId} deleted.`)
      window.history.replaceState({ app: 'smart-civic-system', view: 'dashboard', index: navigationPositionRef.current }, '', window.location.href)
      await Promise.all([loadComplaints(token), loadMapComplaints(token)])
    } catch (err) {
      setError(err.message || 'Could not delete this complaint.')
    } finally {
      setLoading(false)
    }
  }

  /* ---------- complaint form ---------- */

  function resetForm() {
    setTitle('')
    setDescription('')
    setCategory('Roads')
    setAddress('')
    setLatitude('')
    setLongitude('')
    setLocationMessage('')
    setLocationPickerOpen(false)
    setPhoto(null)
    setPhotoMessage('')
    setAudio(null)
    setAudioMessage('')
  }

  function toggleForm() {
    setError('')
    setNotice('')
    if (!showComplaintForm) {
      navigateTo('form')
      if (!latitude || !longitude) getDeviceLocation()
    } else {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      window.history.back()
    }
  }

  async function submitComplaint(event) {
    event.preventDefault()
    setError('')
    setNotice('')

    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      setError('Stop the recording before submitting.')
      return
    }

    const hasLatitude = latitude.trim() !== ''
    const hasLongitude = longitude.trim() !== ''
    if (!hasLatitude || !hasLongitude) {
      setError('Choose the issue location using device GPS or the map so the nearest matching department can receive it.')
      setLoading(false)
      return
    }
    if (hasLatitude !== hasLongitude) {
      setError('Enter both latitude and longitude, or clear both fields to submit without a map location.')
      return
    }
    if (hasLatitude) {
      const latValue = Number(latitude)
      const lngValue = Number(longitude)
      if (!Number.isFinite(latValue) || latValue < -90 || latValue > 90 || !Number.isFinite(lngValue) || lngValue < -180 || lngValue > 180) {
        setError('Please enter valid coordinates: latitude from -90 to 90 and longitude from -180 to 180.')
        return
      }
    }

    setLoading(true)
    try {
      // Offer support for a matching active complaint within 100 metres first.
      if (latitude.trim() !== '' && longitude.trim() !== '') {
        try {
          const nearbyData = await api(
            `/complaints/nearby?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&radius_m=100`,
            { token }
          )
          const normalizedCategory = category.trim().toLowerCase()
          const normalizedTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
          const candidate = (nearbyData.complaints || []).find((item) => {
            if (item.is_mine) return false
            if (['resolved', 'rejected'].includes((item.status || '').toLowerCase())) return false
            if ((item.category || '').trim().toLowerCase() !== normalizedCategory) return false
            const existingTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
            return existingTitle === normalizedTitle ||
              existingTitle.includes(normalizedTitle) ||
              normalizedTitle.includes(existingTitle)
          })
          if (candidate && window.confirm(
            `A similar ${candidate.category} complaint (#${candidate.id}) is already reported ${candidate.distance_m} metres away.\n\nChoose OK to support the existing complaint instead of creating a duplicate, or Cancel to submit a separate report.`
          )) {
            const result = await api(`/complaints/${candidate.id}/support`, { token, method: 'POST' })
            resetForm()
            navigateTo('dashboard', null, true)
            setNotice(`${result.message}. Existing complaint #${candidate.id} was updated.`)
            await Promise.all([loadComplaints(token), loadMapComplaints(token)])
            return
          }
        } catch (nearbyError) {
          if (nearbyError.status === 401) throw nearbyError
          // If nearby detection fails, do not block a legitimate report.
        }
      }

      const photoToSend = photo ? await shrinkImage(photo) : null

      const created = await api('/complaints/', {
        token,
        method: 'POST',
        json: {
          title: title.trim(),
          description: description.trim() || null,
          category,
          address: address.trim() || null,
          latitude: latitude.trim() === '' ? null : Number(latitude),
          longitude: longitude.trim() === '' ? null : Number(longitude),
        },
      })

      let mediaError = ''
      if (photoToSend || audio) {
        const formData = new FormData()
        if (photoToSend) formData.append('photo', photoToSend)
        if (audio) formData.append('audio', audio)
        try {
          const savedMedia = await api(`/complaints/${created.id}/media`, {
            token,
            method: 'POST',
            body: formData,
          })
          // Keep the media URLs returned by the backend in the local view immediately.
          setComplaints((current) => [savedMedia, ...current.filter((item) => item.id !== savedMedia.id)])
        } catch (err) {
          mediaError = err.message
        }
      }

      resetForm()
      navigateTo('dashboard', null, true)
      if (mediaError) {
        setError(
          `Complaint #${created.id} was submitted, but the photo or audio did not upload: ${mediaError}`
        )
      } else {
        setNotice(`Complaint #${created.id} submitted successfully.`)
      }
      await Promise.all([loadComplaints(token), loadMapComplaints(token)])
    } catch (err) {
      if (err.status === 401) logout('Your session expired. Please sign in again.')
      else setError(err.message || 'Could not submit the complaint.')
    } finally {
      setLoading(false)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Login / register                                                  */
  /* ---------------------------------------------------------------- */

  if (!token && showDepartmentApplication) {
    return <DepartmentApplicationForm onClose={() => setShowDepartmentApplication(false)} />
  }

  if (!token) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="hazard-bar" aria-hidden="true" />
          <div className="login-body">
            <div className="brand-mark">SC</div>
            <h1>{isRegister ? 'Create your account' : authPortal === 'citizen' ? 'Welcome back' : authPortal === 'authority' ? 'Authority sign in' : 'Department staff sign in'}</h1>
            <p className="muted">
              {isRegister
                ? 'Report problems in your area and follow them until they are fixed.'
                : authPortal === 'citizen'
                  ? 'Report local issues and follow them until they are resolved.'
                  : 'Authorized personnel only. Your account role is verified by the server.'}
            </p>

            {!isRegister && (
              <div className="portal-switch" role="group" aria-label="Sign-in portal">
                <button type="button" className={authPortal === 'citizen' ? 'active' : ''} onClick={() => { setAuthPortal('citizen'); setError('') }}>Citizen</button>
                <button type="button" className={authPortal === 'department_staff' ? 'active' : ''} onClick={() => { setAuthPortal('department_staff'); setError('') }}>Department staff</button>
                <button type="button" className={authPortal === 'authority' ? 'active' : ''} onClick={() => { setAuthPortal('authority'); setError('') }}>Authority</button>
              </div>
            )}
            <form onSubmit={isRegister ? register : login} className="login-form">
              {isRegister && (
                <>
                  <label htmlFor="fullName">Full name</label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                  />
                  <label htmlFor="phone">Phone number</label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Enter your phone number"
                    autoComplete="tel"
                    required
                    minLength={7}
                  />
                  <label htmlFor="profileAddress">Home address</label>
                  <textarea
                    id="profileAddress"
                    value={profileAddress}
                    onChange={(event) => setProfileAddress(event.target.value)}
                    placeholder="Enter your address"
                    autoComplete="street-address"
                    rows={2}
                    required
                    minLength={3}
                  />
                  <button type="button" className="secondary-button" onClick={() => {
                    setRegistrationLocationMessage('')
                    if (!navigator.geolocation) { setRegistrationLocationMessage('Location is not supported by this browser.'); return }
                    navigator.geolocation.getCurrentPosition(
                      (position) => { setProfileLatitude(String(position.coords.latitude)); setProfileLongitude(String(position.coords.longitude)); setRegistrationLocationMessage('Device location captured successfully.') },
                      (err) => setRegistrationLocationMessage(err.code === 1 ? 'Location permission was denied. You can enable it in browser settings.' : 'Could not get your location. Try again or continue without it.'),
                      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                    )
                  }}>Use my device location</button>
                  <p className="muted small-note">{profileLatitude && profileLongitude ? `Location captured: ${Number(profileLatitude).toFixed(5)}, ${Number(profileLongitude).toFixed(5)}` : 'Device location is optional and only saved if you grant permission.'}</p>
                  {registrationLocationMessage && <p className="muted small-note">{registrationLocationMessage}</p>}
                </>
              )}

              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
              />

              {error && <p className="error" role="alert">{error}</p>}
              {notice && <p className="notice">{notice}</p>}

              <button className="primary-button wide" disabled={loading}>
                {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
              </button>
            </form>

            {authPortal === 'citizen' && <p className="login-footnote">
              {isRegister ? 'Already have an account?' : 'New here?'}{' '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setIsRegister((current) => !current)
                  setError('')
                  setNotice('')
                  setPassword('')
                }}
              >
                {isRegister ? 'Sign in' : 'Create an account'}
              </button>
            </p>}
            {authPortal === 'department_staff' && !isRegister && <p className="login-footnote">Represent a civic department?{' '}
              <button type="button" className="text-link" onClick={() => { setShowDepartmentApplication(true); setError(''); setNotice('') }}>Request department access</button>
            </p>}
          </div>
        </section>
      </main>
    )
  }

  if (token && authorityLocationRequired && citizen?.role === 'authority') {
    return <AuthorityLocationSetup token={token} user={citizen} onSaved={(updated) => {
      setCitizen(updated); setProfileLatitude(String(updated.latitude)); setProfileLongitude(String(updated.longitude));
      setAuthorityLocationRequired(false); setNotice('Authority location saved and locked.');
    }} />
  }

  /* ---------------------------------------------------------------- */
  /* Complaint details                                                 */
  /* ---------------------------------------------------------------- */

  if (selectedComplaint) {
    const complaint = selectedComplaint
    const hasCoords =
      complaint.latitude !== null &&
      complaint.latitude !== undefined &&
      complaint.longitude !== null &&
      complaint.longitude !== undefined

    return (
      <main className="dashboard-page">
        <header className="topbar">
          <div className="brand-button">
            <span className="brand-mark small">SC</span>
            <span>Smart Civic System</span>
          </div>
          <div className="topbar-actions">
            <div className="profile-wrap">
              <button type="button" className="profile-trigger profile-trigger-icon" onClick={() => setProfileOpen((open) => !open)} aria-label="Open profile menu" title="Profile" aria-expanded={profileOpen}>
                <span className="profile-avatar"><Icon name="user" size={21} /></span>
              </button>
              {profileOpen && <div className="profile-menu">
                <strong>{citizen?.full_name || 'Account'}</strong><small>{citizen?.email || ''}</small>
                <button onClick={() => { setSettingsView('profile'); setProfileOpen(false); setSelectedComplaint(null) }}>Your details</button>
                <button onClick={() => { setSettingsView('password'); setProfileOpen(false); setSelectedComplaint(null) }}>Password settings</button>
                <button className="danger-text" onClick={() => logout()}>Log out</button>
              </div>}
            </div>
          </div>
        </header>

        <section className="content">
          {error && <p className="error banner" role="alert">{error}</p>}
          {notice && <p className="notice banner">{notice}</p>}
          <button className="back-button" onClick={() => window.history.back()}>
            <Icon name="back" /> My complaints
          </button>

          <div className="detail-heading">
            <div>
              <p className="complaint-id">Complaint #{complaint.id}</p>
              <h1>{complaint.title}</h1>
              {complaint.description && <p className="muted">{complaint.description}</p>}
            </div>
            <div className="detail-heading-actions">
              <span className={`status status-${complaint.status}`}>{statusLabel(complaint.status)}</span>
              {citizen?.role === 'citizen' && complaint.user_id === citizen.id && <button type="button" className="danger-button" onClick={() => deleteComplaint(complaint.id)} disabled={loading}><Icon name="trash" size={16} /> Delete complaint</button>}
              <button type="button" className="secondary-button detail-home-button" onClick={() => { setSelectedComplaint(null); setSettingsView(''); setShowComplaintForm(false); window.history.replaceState({ app: 'smart-civic-system', view: 'dashboard', index: navigationPositionRef.current }, '', window.location.href) }}><Icon name="home" size={16} /> Home</button>
            </div>
          </div>

          {citizen?.role === 'authority' && <AuthorityComplaintInfo complaintId={complaint.id} token={token} />}

          <section className="panel">
            <h2>Details</h2>
            <div className="info-grid">
              <Info label="Category" value={complaint.category} />
              <Info label="Location" value={complaint.address} />
              <Info label="Submitted" value={formatDate(complaint.created_at)} />
              <Info label="Last updated" value={formatDate(complaint.updated_at)} />
            </div>
            {hasCoords && (
              <a
                className="text-link map-link"
                href={`https://www.google.com/maps?q=${complaint.latitude},${complaint.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="pin" size={16} /> View on map
              </a>
            )}
          </section>

          {citizen?.role === 'authority' && (
            <section className="panel staff-actions-panel">
              <h2>Manage complaint</h2>
              <p className="muted small-note">Actions are checked against your account role and department by the server.</p>
              {citizen.role === 'authority' && (
                <div className="staff-action-row">
                  <label htmlFor="assign-department">Assign department</label>
                  <select id="assign-department" value={selectedDepartmentId} onChange={(e) => setSelectedDepartmentId(e.target.value)}>
                    <option value="">Choose a department</option>
                    {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                  <button className="secondary-button" onClick={() => assignComplaint(complaint.id)} disabled={loading || !selectedDepartmentId}>Assign</button>
                </div>
              )}
              <div className="staff-action-row">
                {complaint.status === 'submitted' && <button className="secondary-button" disabled={loading} onClick={() => updateComplaintStatus(complaint.id, 'assigned')}>Mark assigned</button>}
                {['assigned', 'in_progress'].includes(complaint.status) && <button className="secondary-button" disabled={loading} onClick={() => updateComplaintStatus(complaint.id, 'in_progress')}>Mark in progress</button>}
                {['assigned', 'in_progress'].includes(complaint.status) && <button className="primary-button" disabled={loading} onClick={() => updateComplaintStatus(complaint.id, 'resolved')}>Mark resolved</button>}
                {!['resolved', 'rejected'].includes(complaint.status) && <button className="danger-button" disabled={loading} onClick={() => updateComplaintStatus(complaint.id, 'rejected')}>Reject report</button>}
                {complaint.status === 'resolved' && <button className="secondary-button" disabled={loading} onClick={() => updateComplaintStatus(complaint.id, 'assigned')}>Reopen as assigned</button>}
              </div>
            </section>
          )}

          <div className="media-grid">
            <section className="panel">
              <h2>Photo</h2>
              {complaint.photo_url ? (
                <>
                  <img
                    className="complaint-photo"
                    src={`${API_URL}${complaint.photo_url}`}
                    alt={`Evidence for complaint ${complaint.id}`}
                  />
                  <a
                    className="text-link"
                    href={`${API_URL}${complaint.photo_url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full-size photo
                  </a>
                </>
              ) : (
                <p className="muted">No photo was submitted.</p>
              )}
            </section>

            <section className="panel">
              <h2>Voice note</h2>
              {complaint.audio_url ? (
                <audio className="audio-player" controls src={`${API_URL}${complaint.audio_url}`}>
                  Your browser does not support audio playback.
                </audio>
              ) : (
                <p className="muted">No audio was submitted.</p>
              )}
            </section>
          </div>
          <ComplaintUpdates complaint={complaint} token={token} role={citizen?.role} onSubmitted={() => Promise.all([loadComplaints(token), loadMapComplaints(token)])} />
        </section>
      </main>
    )
  }

  /* ---------------------------------------------------------------- */
  /* Dashboard                                                         */
  /* ---------------------------------------------------------------- */

  const counts = {
    total: complaints.length,
    submitted: complaints.filter((c) => c.status === 'submitted').length,
    inProgress: complaints.filter((c) => c.status === 'in_progress').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
  }

  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div className="topbar-brand">
          <button className="icon-button menu-trigger" onClick={() => setMenuOpen((open) => !open)} aria-label="Open navigation menu">☰</button>
          <div className="brand-button">
            <span className="brand-mark small">SC</span>
            <span>Smart Civic System</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="welcome-text">
            {citizen?.full_name ? `Hi, ${citizen.full_name}` : 'Civic dashboard'}
          </span>
          <div className="profile-wrap">
            <button type="button" className="profile-trigger profile-trigger-icon" onClick={() => setProfileOpen((open) => !open)} aria-label="Open profile menu" title="Profile" aria-expanded={profileOpen}>
              <span className="profile-avatar"><Icon name="user" size={21} /></span>
            </button>
            {profileOpen && <div className="profile-menu">
              <strong>{citizen?.full_name || 'Account'}</strong>
              <small>{citizen?.email || ''}</small>
              <button onClick={() => { setSettingsView('profile'); setProfileOpen(false); setError(''); setNotice('') }}>Your details</button>
              <button onClick={() => { setSettingsView('password'); setProfileOpen(false); setError(''); setNotice('') }}>Password settings</button>
              <button className="danger-text" onClick={() => logout()}>Log out</button>
            </div>}
          </div>
        </div>
      </header>

      {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)}>
        <nav className="side-menu" onClick={(event) => event.stopPropagation()}>
          <div className="side-menu-head"><strong>Navigation</strong><button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button></div>
          <button className="nav-home-item" onClick={() => { setActiveMenuView('dashboard'); setSettingsView(''); setShowComplaintForm(false); setSelectedComplaint(null); setMenuOpen(false); setProfileOpen(false); window.history.replaceState({ app: 'smart-civic-system', view: 'dashboard', index: navigationPositionRef.current }, '', window.location.href) }}><Icon name="home" size={18} /> Dashboard</button>
          {citizen?.role === 'authority' ? <>
            <button onClick={() => { setActiveMenuView('complaints'); setSettingsView(''); setSelectedComplaint(null); setMenuOpen(false) }}><Icon name="list" size={18} /> All complaints</button>
            <button onClick={() => { setActiveMenuView('management'); setSettingsView(''); setMenuOpen(false) }}><Icon name="building" size={18} /> Department management</button>
            <button onClick={() => { setActiveMenuView('reviews'); setSettingsView(''); setMenuOpen(false) }}><Icon name="check" size={18} /> Review queue</button>
            <button onClick={() => { setActiveMenuView('reminders'); setSettingsView(''); setMenuOpen(false) }}><Icon name="bell" size={18} /> Reminders</button>
            <button onClick={() => { setActiveMenuView('audit'); setSettingsView(''); setMenuOpen(false) }}><Icon name="history" size={18} /> Audit & archive</button>
          </> : <>
            <button onClick={() => { setActiveMenuView('complaints'); setSettingsView(''); setShowComplaintForm(false); setSelectedComplaint(null); setMenuOpen(false) }}><Icon name="list" size={18} /> {citizen?.role === 'citizen' ? 'My complaints' : 'Assigned complaints'}</button>
            {['department_staff', 'department'].includes(citizen?.role) && <button onClick={() => { setActiveMenuView('reminders'); setSettingsView(''); setMenuOpen(false) }}><Icon name="bell" size={18} /> Reminders</button>}
          </>}
          <button onClick={() => { setSettingsView('profile'); setMenuOpen(false); setError(''); setNotice('') }}><Icon name="user" size={18} /> Your details</button>
          <button onClick={() => { setSettingsView('password'); setMenuOpen(false); setError(''); setNotice('') }}><Icon name="shield" size={18} /> Password settings</button>
          <button className="danger-text" onClick={() => logout()}><Icon name="logout" size={18} /> Log out</button>
        </nav>
      </div>}

      <section className="content">
        {settingsView ? (
          <section className="panel settings-panel">
            <div className="settings-title"><div><p className="eyebrow">ACCOUNT SETTINGS</p><h1>{settingsView === 'profile' ? 'Your details' : 'Password settings'}</h1></div><button className="secondary-button" onClick={() => setSettingsView('')}>Back to dashboard</button></div>
            {settingsView === 'profile' ? (
              <>
              <section className="panel profile-details-card"><p className="eyebrow">PROFILE SUMMARY</p><h2>{citizen?.full_name || 'Account details'}</h2><div className="info-grid">
                <Info label="Role" value={citizen?.role === 'authority' ? 'Authority' : ['department_staff', 'department'].includes(citizen?.role) ? 'Department staff' : 'Citizen'} />
                <Info label="Email" value={citizen?.email} /><Info label="Phone" value={citizen?.phone} /><Info label="Address" value={citizen?.address} />
                {citizen?.role === 'authority' && <Info label="Authority location" value={citizen?.latitude != null && citizen?.longitude != null ? `${Number(citizen.latitude).toFixed(6)}, ${Number(citizen.longitude).toFixed(6)} (locked)` : 'Not set'} />}
                {citizen?.role !== 'authority' && citizen?.latitude != null && citizen?.longitude != null && <Info label="Saved location" value={`${Number(citizen.latitude).toFixed(6)}, ${Number(citizen.longitude).toFixed(6)}`} />}
                {departmentProfile && <><Info label="Department" value={departmentProfile.name} /><Info label="Department category" value={departmentProfile.category} /><Info label="Department contact" value={departmentProfile.phone} /><Info label="Department address" value={departmentProfile.address} /><Info label="Department location" value={departmentProfile.latitude != null && departmentProfile.longitude != null ? `${Number(departmentProfile.latitude).toFixed(6)}, ${Number(departmentProfile.longitude).toFixed(6)}` : 'Not set'} /></>}
              </div></section>
              <form className="settings-form" onSubmit={async (event) => {
                event.preventDefault(); setLoading(true); setError(''); setNotice('')
                try {
                  const updated = await api('/auth/me', { token, method: 'PATCH', json: { full_name: fullName.trim(), email: email.trim(), phone: phone.trim() || null, address: profileAddress.trim() || null, latitude: citizen?.role === 'authority' ? citizen.latitude : (profileLatitude === '' ? null : Number(profileLatitude)), longitude: citizen?.role === 'authority' ? citizen.longitude : (profileLongitude === '' ? null : Number(profileLongitude)) } })
                  setCitizen(updated); setNotice('Your details have been updated.'); setSettingsView('')
                } catch (err) { setError(err.message || 'Could not update profile.') } finally { setLoading(false) }
              }}>
                <label htmlFor="settings-name">Full name</label><input id="settings-name" value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} required />
                <label htmlFor="settings-email">Email address</label><input id="settings-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <label htmlFor="settings-phone">Phone number</label><input id="settings-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <label htmlFor="settings-address">Address</label><textarea id="settings-address" value={profileAddress} onChange={(e) => setProfileAddress(e.target.value)} rows={3} />
                {citizen?.role === 'authority' && <p className="muted small-note">Your authority location is set once during first sign-in and is locked to protect nearest-complaint routing.</p>}
                {error && <p className="error" role="alert">{error}</p>}
                <button className="primary-button" disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button>
              </form>
              </>
            ) : (
              <form className="settings-form" onSubmit={async (event) => {
                event.preventDefault(); setLoading(true); setError(''); setNotice('')
                try {
                  const result = await api('/auth/change-password', { token, method: 'POST', json: { current_password: currentPassword, new_password: newPassword } })
                  setCurrentPassword(''); setNewPassword(''); setNotice(result.message || 'Password updated.')
                  setSettingsView('')
                } catch (err) { setError(err.message || 'Could not change password.') } finally { setLoading(false) }
              }}>
                <label htmlFor="current-password">Current password</label><input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                <label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
                <p className="muted small-note">Use at least 8 characters.</p>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="primary-button" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>
              </form>
            )}
          </section>
        ) : (
        <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">SMART CIVIC SERVICE SYSTEM</p>
            <h1>{citizen?.role === 'authority' ? ({ dashboard: 'Authority dashboard', complaints: 'All complaints', management: 'Department management', reviews: 'Review queue', reminders: 'Reminders', audit: 'Audit & archive' }[activeMenuView] || 'Authority dashboard') : ['department_staff', 'department'].includes(citizen?.role) ? (activeMenuView === 'reminders' ? 'Department reminders' : 'Department dashboard') : 'My complaints'}</h1>
            <p className="muted">{citizen?.role === 'citizen' ? 'Track the issues you reported and follow their progress.' : citizen?.role === 'authority' ? 'Review reports, assign nearest-first, approve department updates, and manage civic services.' : activeMenuView === 'reminders' ? 'Review reminders sent by the authority.' : 'See community issues on the map and manage only complaints assigned to your department.'}</p>
          </div>
          <div className="heading-actions">
            {citizen?.role === 'citizen' && <button type="button" className="primary-button" onClick={toggleForm}>
              {showComplaintForm ? (
                'Cancel'
              ) : (
                <>
                  <Icon name="plus" /> Report an issue
                </>
              )}
            </button>}
            <button
              type="button"
              className="secondary-button"
              onClick={() => { loadComplaints(token); loadMapComplaints(token) }}
              disabled={loading}
            >
              <Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <p className="error banner" role="alert">{error}</p>}
        {notice && <p className="notice banner">{notice}</p>}

        <section className="map-panel panel">
          <div className="map-panel-heading">
            <div><p className="eyebrow">LIVE COMMUNITY VIEW</p><h2>Civic issues map</h2><p className="muted small-note">Location markers update as reports change.</p></div>
            <div className="map-legend">{citizen?.role === 'department_staff' || citizen?.role === 'department' ? <><span><i className="legend-dot dark-blue" /> Assigned to your department</span><span><i className="legend-dot red" /> Unresolved</span><span><i className="legend-dot orange" /> In progress</span><span><i className="legend-dot green" /> Resolved</span></> : <><span><i className="legend-dot red" /> Unresolved</span><span><i className="legend-dot orange" /> In progress</span><span><i className="legend-dot green" /> Resolved</span></>}</div>
          </div>
          <CivicMap complaints={mapComplaints} markerMode="status" onSelect={(mapped) => { const full = complaints.find((item) => item.id === mapped.id); if (full) navigateTo('complaint', full) }} />
          <p className="muted map-footnote">{mapComplaints.length} mapped issue{mapComplaints.length === 1 ? '' : 's'} · Markers show report status, not the reporter’s identity.</p>
        </section>

        {citizen?.role === 'authority' && ['management', 'reviews', 'reminders', 'audit'].includes(activeMenuView) && <AuthorityDepartmentPanel section={activeMenuView} token={token} complaints={complaints} onRefresh={() => Promise.all([loadComplaints(token), loadMapComplaints(token), api('/departments', { token }).then(data => { if (Array.isArray(data)) setDepartments(data) }).catch(() => {})])} />}
        {['department_staff', 'department'].includes(citizen?.role) && activeMenuView === 'reminders' && <DepartmentDashboardPanel section="reminders" token={token} />}

        {showComplaintForm && citizen?.role === 'citizen' && (
          <form className="panel complaint-form" onSubmit={submitComplaint}>
            <div>
              <h2>Report an issue</h2>
              <p className="muted">Describe the problem and add a photo or voice note if you can.</p>
            </div>

            <fieldset className="form-section">
              <legend>What is the problem?</legend>

              <label htmlFor="complaint-title">Title</label>
              <input
                id="complaint-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Large pothole near the bus stop"
                minLength={3}
                maxLength={150}
                required
              />

              <label htmlFor="complaint-category">Category</label>
              <select
                id="complaint-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                required
              >
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <label htmlFor="complaint-description">Description</label>
              <textarea
                id="complaint-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is wrong, and how long has it been like this?"
                rows={4}
              />
            </fieldset>

            <fieldset className="form-section">
              <legend>Where is it?</legend>

              <label htmlFor="complaint-address">Address or landmark</label>
              <input
                id="complaint-address"
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Street, area, or nearby landmark"
              />

              <div className="location-panel location-panel-updated">
                <span className="location-icon"><Icon name="pin" size={22} /></span>
                <div className="location-text">
                  <strong>{latitude && longitude ? `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}` : 'Location is required for department routing'}</strong>
                  <p className="muted small-note">{locationMessage || 'Use device GPS or choose the exact issue point on the map. This routes the complaint to the nearest matching department.'}</p>
                </div>
                <div className="location-actions">
                  <button type="button" className="secondary-button" onClick={getDeviceLocation} disabled={locationLoading}>{locationLoading ? 'Locating…' : 'Use device location'}</button>
                  <button type="button" className="secondary-button" onClick={() => setLocationPickerOpen(true)}>Choose on map</button>
                  <button type="button" className="text-link" onClick={() => { setLatitude(''); setLongitude(''); setLocationMessage('Location cleared. You can submit without coordinates.') }}>Clear</button>
                </div>
              </div>
              <div className="coordinate-fields">
                <div><label htmlFor="complaint-latitude">Latitude</label><input id="complaint-latitude" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => { setLatitude(event.target.value); setLocationMessage('Manual coordinates selected.') }} placeholder="e.g. 12.9716" /></div>
                <div><label htmlFor="complaint-longitude">Longitude</label><input id="complaint-longitude" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => { setLongitude(event.target.value); setLocationMessage('Manual coordinates selected.') }} placeholder="e.g. 77.5946" /></div>
              </div>
              {locationPickerOpen && <LocationPicker initialLatitude={latitude} initialLongitude={longitude} onClose={() => setLocationPickerOpen(false)} onChoose={(point) => { setLatitude(String(point.latitude)); setLongitude(String(point.longitude)); setLocationMessage('Map location selected.'); setLocationPickerOpen(false) }} />}
            </fieldset>

            <fieldset className="form-section">
              <legend>Evidence</legend>

              <PhotoField photo={photo} onChange={setPhoto} onMessage={setPhotoMessage} />
              {photoMessage && <p className="error small">{photoMessage}</p>}

              <VoiceField
                audio={audio}
                onChange={setAudio}
                recorderRef={recorderRef}
                onMessage={setAudioMessage}
              />
              {audioMessage && <p className="error small">{audioMessage}</p>}
            </fieldset>

            <button className="primary-button wide" type="submit" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit complaint'}
            </button>
          </form>
        )}

        {(citizen?.role === 'citizen' || activeMenuView === 'dashboard') && <div className="stats-strip">
          <Stat label="Total" value={counts.total} />
          <Stat label="Submitted" value={counts.submitted} tone="submitted" />
          <Stat label="In progress" value={counts.inProgress} tone="in_progress" />
          <Stat label="Resolved" value={counts.resolved} tone="resolved" />
        </div>}

        {(citizen?.role === 'citizen' || (['department_staff', 'department'].includes(citizen?.role) && ['dashboard', 'complaints'].includes(activeMenuView)) || (citizen?.role === 'authority' && activeMenuView === 'complaints')) && <>
        <div className="section-heading">
          <h2>{citizen?.role === 'authority' ? 'All active complaints' : ['department_staff', 'department'].includes(citizen?.role) ? 'Complaints assigned to your department' : 'Your reports'}</h2>
          <span className="muted">{counts.total} total</span>
        </div>

        {loading && complaints.length === 0 ? (
          <div className="empty-state">Loading your complaints…</div>
        ) : complaints.length === 0 ? (
          <div className="empty-state">
            <h3>No complaints yet</h3>
            <p className="muted">Report your first issue and it will show up here.</p>
          </div>
        ) : (
          <div className="complaint-list">
            {complaints.map((complaint) => (
              <button
                className={`complaint-card tone-${complaint.status}`}
                key={complaint.id}
                onClick={() => navigateTo('complaint', complaint)}
              >
                {complaint.photo_url ? (
                  <img
                    className="card-thumbnail"
                    src={`${API_URL}${complaint.photo_url}`}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="card-thumbnail placeholder">SC</div>
                )}

                <div className="complaint-card-text">
                  <span className="complaint-id">Complaint #{complaint.id}</span>
                  <h3>{complaint.title}</h3>
                  {complaint.description && <p>{complaint.description}</p>}
                  <span className="card-meta">
                    {complaint.category || 'Other'} • {complaint.address || 'Location not provided'}{citizen?.role === 'authority' && complaint.distance_km != null ? ` • ${Number(complaint.distance_km).toFixed(2)} km away` : ''}
                  </span>
                </div>

                <div className="complaint-card-side">
                  <span className={`status status-${complaint.status}`}>
                    {statusLabel(complaint.status)}
                  </span>
                  <span className="card-date">{formatDate(complaint.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        </>}
        </>
        )}
      </section>
    </main>
  )
}

function Info({ label, value }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value || 'Not available'}</strong>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export default App
