import { useCallback, useEffect, useState } from 'react'
import { api } from './utils'

export default function AuthorityComplaintInfo({ complaintId, token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await api(`/authority/complaints/${complaintId}/details`, { token })) }
    catch (err) { setError(err.message || 'Could not load reporter details.') }
  }, [complaintId, token])
  useEffect(() => { load() }, [load])
  if (error) return <section className="panel"><p className="muted small-note">{error}</p></section>
  if (!data) return <section className="panel"><p className="muted small-note">Loading reporter and department details…</p></section>
  return <section className="panel"><h2>Reporter and assigned department</h2><div className="info-grid">
    <div className="info-item"><span>Citizen name</span><strong>{data.citizen?.full_name || 'Not available'}</strong></div>
    <div className="info-item"><span>Citizen email</span><strong>{data.citizen?.email || 'Not available'}</strong></div>
    <div className="info-item"><span>Citizen phone</span><strong>{data.citizen?.phone || 'Not available'}</strong></div>
    <div className="info-item"><span>Citizen address</span><strong>{data.citizen?.address || 'Not available'}</strong></div>
    <div className="info-item"><span>Assigned department</span><strong>{data.department?.name || 'Not assigned'}</strong></div>
    <div className="info-item"><span>Department contact</span><strong>{data.department?.phone || data.department?.email || 'Not available'}</strong></div>
  </div></section>
}
