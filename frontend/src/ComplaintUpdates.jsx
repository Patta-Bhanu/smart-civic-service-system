import { useCallback, useEffect, useState } from 'react'
import { API_URL, api, formatDate, statusLabel } from './utils'

export default function ComplaintUpdates({ complaint, token, role, onSubmitted }) {
  const [updates, setUpdates] = useState([])
  const [message, setMessage] = useState('')
  const [proposedStatus, setProposedStatus] = useState('')
  const [photo, setPhoto] = useState(null)
  const [audio, setAudio] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    try { const data = await api(`/complaints/${complaint.id}/updates`, { token }); setUpdates(Array.isArray(data) ? data : []) }
    catch (err) { setError(err.message || 'Could not load updates.') }
  }, [complaint.id, token])
  useEffect(() => { load() }, [load])

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const form = new FormData(); form.append('message', message)
      if (proposedStatus) form.append('proposed_status', proposedStatus)
      if (photo) form.append('photo', photo)
      if (audio) form.append('audio', audio)
      const response = await fetch(`${API_URL}/complaints/${complaint.id}/updates`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`)
      setMessage(''); setProposedStatus(''); setPhoto(null); setAudio(null)
      setNotice('Update submitted. The citizen will see it only after authority approval.')
      await load(); await onSubmitted?.()
    } catch (err) { setError(err.message || 'Could not submit update.') }
    finally { setBusy(false) }
  }
  return <section className="panel complaint-updates-panel"><h2>Progress updates</h2>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice">{notice}</p>}
    {role === 'department_staff' || role === 'department' ? <form className="settings-form" onSubmit={submit}>
      <p className="muted small-note">Submit progress and evidence for authority review. It will not change the citizen-visible status until approved.</p>
      <label>Progress message</label><textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} minLength={3} maxLength={3000} required placeholder="Describe the work completed or next steps"/>
      <label>Proposed status (optional)</label><select value={proposedStatus} onChange={e => setProposedStatus(e.target.value)}><option value="">Keep current status</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="rejected">Rejected / not actionable</option></select>
      <label>Photo evidence (optional)</label><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPhoto(e.target.files?.[0] || null)}/>
      <label>Audio evidence (optional)</label><input type="file" accept="audio/*" onChange={e => setAudio(e.target.files?.[0] || null)}/>
      <button className="primary-button" disabled={busy || message.trim().length < 3}>{busy ? 'Submitting…' : 'Submit for authority approval'}</button>
    </form> : null}
    {updates.length === 0 ? <p className="muted">No approved progress updates yet.</p> : <div className="approved-update-list">{updates.map(x => <article key={x.id} className="approved-update"><div><strong>{x.status === 'approved' ? 'Approved update' : 'Pending authority review'}</strong><small>{formatDate(x.created_at)}</small></div><p>{x.message}</p>{x.proposed_status && <p className="muted small-note">Proposed status: {statusLabel(x.proposed_status)}</p>}{x.photo_url && <a className="text-link" href={`${API_URL}${x.photo_url}`} target="_blank" rel="noreferrer">View update photo</a>}{x.audio_url && <audio controls src={`${API_URL}${x.audio_url}`} /> }{x.review_note && <p className="muted small-note">Review note: {x.review_note}</p>}</article>)}</div>}
  </section>
}
