import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "/api";
const teamMembers = [
  "Security Analyst",
  "Network Engineer",
  "System Administrator",
  "Incident Response Officer"
];
const emptyForm = {
  title: "",
  type: "System Failure",
  priority: "Medium",
  description: ""
};

async function request(path, options = {}) {
  const token = localStorage.getItem("irms-token");
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || "The request could not be completed");
    error.status = response.status;
    throw error;
  }
  return result;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("irms-token") || "");
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("irms-user") || "null");
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState("Dashboard");
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [taskStatus, setTaskStatus] = useState("Assigned");
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([
      request("/incidents"),
      request("/notifications"),
      request("/analytics"),
      request("/auth/me")
    ]).then(([incidentData, notificationData, analyticsData, profile]) => {
      if (!active) return;
      setIncidents(incidentData);
      setNotifications(notificationData);
      setAnalytics(analyticsData);
      setUser(profile.user);
      localStorage.setItem("irms-user", JSON.stringify(profile.user));
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError.message);
      if (loadError.status === 401) {
        localStorage.removeItem("irms-token");
        localStorage.removeItem("irms-user");
        setToken("");
        setUser(null);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  const visibleIncidents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      const matchesSearch = !needle || [
        incident.id, incident.title, incident.type, incident.description, incident.assignedTo
      ].some(value => String(value || "").toLowerCase().includes(needle));
      return matchesSearch
        && (!statusFilter || incident.status === statusFilter)
        && (!priorityFilter || incident.priority === priorityFilter);
    });
  }, [incidents, search, statusFilter, priorityFilter]);

  const openCount = incidents.filter(item => item.status === "Open").length;
  const progressCount = incidents.filter(item => item.status === "In Progress").length;
  const resolvedCount = incidents.filter(item => item.status === "Resolved").length;
  const unreadCount = notifications.filter(item => !item.readAt).length;

  function signOut() {
    localStorage.removeItem("irms-token");
    localStorage.removeItem("irms-user");
    setToken("");
    setUser(null);
    setIncidents([]);
    setNotifications([]);
    setPage("Dashboard");
  }

  async function authenticate(event) {
    event.preventDefault();
    setAuthError("");
    setError("");
    try {
      const result = await request(`/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(authForm)
      });
      localStorage.setItem("irms-token", result.token);
      localStorage.setItem("irms-user", JSON.stringify(result.user));
      setUser(result.user);
      setLoading(true);
      setToken(result.token);
    } catch (authRequestError) {
      setAuthError(authRequestError.message);
    }
  }

  async function refreshIncidents(preferredIncident = selectedIncident) {
    const data = await request("/incidents");
    setIncidents(data);
    if (preferredIncident) {
      setSelectedIncident(data.find(item => item.id === preferredIncident.id) || null);
    }
    return data;
  }

  async function createIncident(event) {
    event.preventDefault();
    const highestNumber = incidents.reduce((max, item) => Math.max(
      max,
      Number(item.id.split("-")[1]) || 0
    ), 0);
    const payload = {
      id: `INC-${String(highestNumber + 1).padStart(3, "0")}`,
      ...form,
      status: "Open"
    };
    try {
      const saved = await request("/incidents", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      let finalIncident = saved;
      if (evidenceFile) {
        const upload = new FormData();
        upload.append("evidence", evidenceFile);
        const result = await request(`/incidents/${saved.id}/evidence`, {
          method: "POST",
          body: upload
        });
        finalIncident = result.incident;
      }
      setForm(emptyForm);
      setEvidenceFile(null);
      await refreshIncidents(finalIncident);
      await refreshNotifications();
      setPage("Incidents");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function refreshNotifications() {
    setNotifications(await request("/notifications"));
  }

  async function updateStatus(id, status) {
    try {
      const result = await request(`/incidents/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
      await refreshIncidents(result.incident);
      await refreshNotifications();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function assignTask() {
    if (!selectedIncident || !assignedTo) return;
    setAssigning(true);
    try {
      const result = await request(`/incidents/${encodeURIComponent(selectedIncident.id)}/assign`, {
        method: "PUT",
        body: JSON.stringify({ assignedTo, assignedBy: user?.name || "Incident Manager", taskStatus })
      });
      setSelectedIncident(result.incident);
      await refreshIncidents(result.incident);
      await refreshNotifications();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAssigning(false);
    }
  }

  async function uploadEvidence() {
    if (!evidenceFile || !selectedIncident) return;
    setUploadingEvidence(true);
    try {
      const upload = new FormData();
      upload.append("evidence", evidenceFile);
      const result = await request(`/incidents/${encodeURIComponent(selectedIncident.id)}/evidence`, {
        method: "POST",
        body: upload
      });
      setSelectedIncident(result.incident);
      setEvidenceFile(null);
      await refreshIncidents(result.incident);
      await refreshNotifications();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function deleteIncident(incident) {
    if (!window.confirm(`Permanently delete ${incident.id}? Its evidence file will also be removed.`)) return;
    try {
      await request(`/incidents/${encodeURIComponent(incident.id)}`, { method: "DELETE" });
      setIncidents(items => items.filter(item => item.id !== incident.id));
      if (selectedIncident?.id === incident.id) {
        setSelectedIncident(null);
        setPage("Incidents");
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function viewDetails(incident) {
    setSelectedIncident(incident);
    setEditForm({
      title: incident.title || "",
      type: incident.type || "Other",
      priority: incident.priority || "Medium",
      description: incident.description || ""
    });
    setEvidenceFile(null);
    setAssignedTo(incident.assignedTo || "");
    setTaskStatus(incident.taskStatus || "Assigned");
    setPage("Incident Details");
  }

  async function saveIncidentDetails(event) {
    event.preventDefault();
    if (!selectedIncident) return;
    try {
      const result = await request(`/incidents/${encodeURIComponent(selectedIncident.id)}`, {
        method: "PUT",
        body: JSON.stringify(editForm)
      });
      setSelectedIncident(result.incident);
      await refreshIncidents(result.incident);
      await refreshNotifications();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function markNotificationRead(notification) {
    try {
      const updated = await request(`/notifications/${notification._id}/read`, { method: "PATCH" });
      setNotifications(items => items.map(item => item._id === updated._id ? updated : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function markAllRead() {
    try {
      await request("/notifications/read-all", { method: "PATCH" });
      await refreshNotifications();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function downloadEvidence(evidencePath, fileName) {
    try {
      const response = await fetch(`${API.replace(/\/api$/, "")}${evidencePath}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Unable to download evidence");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName || "incident-evidence";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (downloadError) {
      setError(downloadError.message);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={authenticate}>
          <div className="brand-mark">IR</div>
          <p className="eyebrow">INCIDENT RESPONSE MANAGEMENT</p>
          <h1>{authMode === "register" ? "Create your account" : "Welcome back"}</h1>
          <p className="muted">Securely manage and investigate incidents.</p>
          {authMode === "register" && (
            <>
              <label htmlFor="auth-name">Full name</label>
              <input id="auth-name" autoComplete="name" required maxLength="100" value={authForm.name}
                onChange={event => setAuthForm({ ...authForm, name: event.target.value })} />
            </>
          )}
          <label htmlFor="auth-email">Work email</label>
          <input id="auth-email" type="email" autoComplete="email" required value={authForm.email}
            onChange={event => setAuthForm({ ...authForm, email: event.target.value })} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"}
            minLength="8" maxLength="128" required value={authForm.password}
            onChange={event => setAuthForm({ ...authForm, password: event.target.value })} />
          {authError && <p className="error-message" role="alert">{authError}</p>}
          <button className="primary-btn auth-submit" type="submit">
            {authMode === "register" ? "Create account" : "Sign in"}
          </button>
          <p className="auth-switch">
            {authMode === "register" ? "Already registered?" : "New to IRMS?"}{" "}
            <button type="button" onClick={() => {
              setAuthError("");
              setAuthMode(authMode === "register" ? "login" : "register");
            }}>{authMode === "register" ? "Sign in" : "Create account"}</button>
          </p>
        </form>
      </div>
    );
  }

  const navItems = ["Dashboard", "Incidents", "Create Incident", "Reports", "Notifications"];
  return (
    <div className="app">
      <aside className="sidebar">
        <h2 className="brand"><span className="brand-mark">IR</span> IRMS</h2>
        <p className="side-label">WORKSPACE</p>
        {navItems.map(item => (
          <button key={item} className={page === item ? "active" : ""} onClick={() => setPage(item)}>
            <span className="nav-icon">{{
              Dashboard: "▦", Incidents: "◈", "Create Incident": "+",
              Reports: "▤", Notifications: "◉"
            }[item]}</span>
            <span>{item}</span>
            {item === "Notifications" && unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="profile-icon">{(user?.name || "U").slice(0, 1).toUpperCase()}</div>
          <div className="profile-name"><strong>{user?.name || "IRMS User"}</strong><small>{user?.email}</small></div>
          <button className="logout-btn" title="Sign out" onClick={signOut}>↗</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="header">
          <div>
            <p className="eyebrow">INCIDENT RESPONSE MANAGEMENT</p>
            <h1>{page}</h1>
            <p>Monitor, manage and respond to security incidents.</p>
          </div>
          <div className="header-actions">
            <button className="notification-button" aria-label={`${unreadCount} unread notifications`}
              onClick={() => setPage("Notifications")}>♧{unreadCount > 0 && <span>{unreadCount}</span>}</button>
            <span className="online"><i /> System online</span>
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
        {loading ? <div className="card"><p>Loading workspace…</p></div> : (
          <>
            {page === "Dashboard" && (
              <section>
                <div className="welcome">
                  <div><p className="eyebrow">YOUR RESPONSE CENTER</p><h2>Stay ahead of every incident.</h2>
                    <p>Track active investigations, coordinate responders and protect your organization.</p></div>
                  <button className="primary-btn" onClick={() => setPage("Create Incident")}>+ Report incident</button>
                </div>
                <div className="stats-container">
                  <StatCard label="Total incidents" value={incidents.length} detail="All recorded incidents" />
                  <StatCard label="Awaiting action" value={openCount} detail="Open incidents" tone="orange" />
                  <StatCard label="Investigating" value={progressCount} detail="Currently in progress" tone="purple" />
                  <StatCard label="Resolved" value={resolvedCount} detail="Successfully closed" tone="green" />
                </div>
                <div className="card">
                  <div className="panel-heading"><div><h2>Recent incidents</h2><p>Latest activity across your response team.</p></div>
                    <button className="text-button" onClick={() => setPage("Incidents")}>View all →</button></div>
                  <IncidentTable incidents={incidents.slice(0, 5)} updateStatus={updateStatus}
                    viewDetails={viewDetails} deleteIncident={deleteIncident} />
                </div>
              </section>
            )}

            {page === "Incidents" && (
              <div className="card">
                <div className="panel-heading">
                  <div><h2>Incident register</h2><p>Search, filter and manage reported incidents.</p></div>
                  <button className="primary-btn" onClick={() => setPage("Create Incident")}>+ New incident</button>
                </div>
                <div className="filters">
                  <input aria-label="Search incidents" placeholder="Search ID, title, type or assignee…" value={search}
                    onChange={event => setSearch(event.target.value)} />
                  <select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                    <option value="">All statuses</option><option>Open</option><option>In Progress</option><option>Resolved</option>
                  </select>
                  <select aria-label="Filter by priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
                    <option value="">All priorities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option>
                  </select>
                  <span className="result-count">{visibleIncidents.length} results</span>
                </div>
                <IncidentTable incidents={visibleIncidents} updateStatus={updateStatus}
                  viewDetails={viewDetails} deleteIncident={deleteIncident} />
              </div>
            )}

            {page === "Create Incident" && (
              <div className="card form-panel">
                <div className="panel-heading"><div><h2>Report a new incident</h2><p>Capture the details so your team can respond.</p></div></div>
                <form onSubmit={createIncident}>
                  <label htmlFor="incident-title">Incident title</label>
                  <input id="incident-title" required maxLength="160" placeholder="Example: Production API unavailable"
                    value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
                  <div className="form-row">
                    <div><label htmlFor="incident-type">Incident type</label>
                      <select id="incident-type" value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}>
                        <option>System Failure</option><option>Network Issue</option><option>Security Breach</option><option>Data Loss</option><option>Other</option>
                      </select></div>
                    <div><label htmlFor="incident-priority">Priority</label>
                      <select id="incident-priority" value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>
                        <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
                      </select></div>
                  </div>
                  <label htmlFor="incident-description">Description</label>
                  <textarea id="incident-description" required maxLength="5000" rows="5"
                    placeholder="What happened? Include impact, systems affected and response taken."
                    value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
                  <label htmlFor="incident-evidence">Evidence attachment <span className="optional">(optional · PDF, PNG, JPG, TXT or LOG · up to 10 MB)</span></label>
                  <input id="incident-evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.log"
                    onChange={event => setEvidenceFile(event.target.files?.[0] || null)} />
                  {evidenceFile && <p className="evidence-name">Selected: {evidenceFile.name}</p>}
                  <button className="primary-btn" type="submit">Submit incident</button>
                </form>
              </div>
            )}

            {page === "Incident Details" && selectedIncident && (
              <div className="card details-card">
                <button className="back-btn" onClick={() => setPage("Incidents")}>← Back to incidents</button>
                <div className="panel-heading detail-heading"><div><p className="eyebrow">{selectedIncident.id}</p><h2>{selectedIncident.title}</h2></div>
                  <button className="danger-btn" onClick={() => deleteIncident(selectedIncident)}>Delete incident</button></div>
                <div className="details-grid">
                  <Detail label="Type" value={selectedIncident.type} />
                  <Detail label="Priority" value={selectedIncident.priority} />
                  <Detail label="Status" value={selectedIncident.status} />
                  <Detail label="Reported" value={formatDate(selectedIncident.createdAt)} />
                  <Detail label="Assigned to" value={selectedIncident.assignedTo || "Not assigned"} />
                  <Detail label="Task status" value={selectedIncident.taskStatus || "Not assigned"} />
                </div>
                <form className="description-box edit-incident-form" onSubmit={saveIncidentDetails}>
                  <h3>Edit incident details</h3>
                  <label htmlFor="edit-title">Title</label>
                  <input id="edit-title" required maxLength="160" value={editForm.title}
                    onChange={event => setEditForm({ ...editForm, title: event.target.value })} />
                  <div className="form-row">
                    <div><label htmlFor="edit-type">Type</label><select id="edit-type" value={editForm.type}
                      onChange={event => setEditForm({ ...editForm, type: event.target.value })}>
                      <option>System Failure</option><option>Network Issue</option><option>Security Breach</option><option>Data Loss</option><option>Other</option>
                    </select></div>
                    <div><label htmlFor="edit-priority">Priority</label><select id="edit-priority" value={editForm.priority}
                      onChange={event => setEditForm({ ...editForm, priority: event.target.value })}>
                      <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
                    </select></div>
                  </div>
                  <label htmlFor="edit-description">Description</label>
                  <textarea id="edit-description" maxLength="5000" rows="4" value={editForm.description}
                    onChange={event => setEditForm({ ...editForm, description: event.target.value })} />
                  <button className="primary-btn" type="submit">Save incident details</button>
                </form>
                <div className="description-box"><h3>Description</h3><p>{selectedIncident.description || "No description provided."}</p></div>
                <div className="description-box">
                  <h3>Update incident status</h3>
                  <select aria-label="Update incident status" value={selectedIncident.status}
                    onChange={event => updateStatus(selectedIncident.id, event.target.value)}>
                    <option>Open</option><option>In Progress</option><option>Resolved</option>
                  </select>
                </div>
                <div className="description-box">
                  <h3>Assignment</h3>
                  <p>Assigned by {selectedIncident.assignedBy || "—"}{selectedIncident.assignedAt ? ` · ${formatDate(selectedIncident.assignedAt)}` : ""}</p>
                  <div className="form-row assignment-row">
                    <div><label htmlFor="assignee">Team member</label><select id="assignee" value={assignedTo} onChange={event => setAssignedTo(event.target.value)}>
                      <option value="">Select a team member</option>{teamMembers.map(member => <option key={member}>{member}</option>)}
                    </select></div>
                    <div><label htmlFor="task-status">Task status</label><select id="task-status" value={taskStatus} onChange={event => setTaskStatus(event.target.value)}>
                      <option>Assigned</option><option>In Progress</option><option>Completed</option>
                    </select></div>
                    <button className="primary-btn" disabled={!assignedTo || assigning} onClick={assignTask}>{assigning ? "Saving…" : "Save assignment"}</button>
                  </div>
                </div>
                <div className="description-box">
                  <h3>Evidence &amp; chain of custody</h3>
                  {selectedIncident.evidencePath ? (
                    <div className="evidence-record"><button className="text-button" onClick={() =>
                      downloadEvidence(selectedIncident.evidencePath, selectedIncident.evidence)}>
                      Download {selectedIncident.evidence || "evidence"}
                    </button><span>Uploaded {formatDate(selectedIncident.evidenceUploadedAt)}</span></div>
                  ) : <p>No evidence attached yet.</p>}
                  <label htmlFor="evidence-upload">Attach evidence</label>
                  <input id="evidence-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.log"
                    onChange={event => setEvidenceFile(event.target.files?.[0] || null)} />
                  <button className="secondary-btn" disabled={!evidenceFile || uploadingEvidence} onClick={uploadEvidence}>
                    {uploadingEvidence ? "Uploading…" : "Upload evidence"}
                  </button>
                  {selectedIncident.chainOfCustody?.length > 0 && <div className="timeline">
                    {[...selectedIncident.chainOfCustody].reverse().map((entry, index) => (
                      <TimelineItem key={`${entry.action}-${entry.date}-${index}`} title={entry.action}
                        description={[entry.fileName, entry.details].filter(Boolean).join(" · ")} date={entry.date} />
                    ))}
                  </div>}
                </div>
                <div className="description-box"><h3>Incident timeline</h3>
                  {selectedIncident.timeline?.length ? <div className="timeline">
                    {[...selectedIncident.timeline].reverse().map((entry, index) => (
                      <TimelineItem key={`${entry.action}-${entry.date}-${index}`} title={entry.action}
                        description={`${entry.details}${entry.actor ? ` · ${entry.actor}` : ""}`} date={entry.date} />
                    ))}
                  </div> : <p>No activity recorded yet.</p>}
                </div>
              </div>
            )}

            {page === "Notifications" && (
              <div className="card">
                <div className="panel-heading"><div><h2>Notifications</h2><p>Updates about incidents and assignments.</p></div>
                  {unreadCount > 0 && <button className="text-button" onClick={markAllRead}>Mark all as read</button>}</div>
                {notifications.length ? <div className="notification-list">{notifications.map(item => (
                  <article className={`notification-item ${item.readAt ? "" : "unread"}`} key={item._id}>
                    <span className="notification-dot" />
                    <div><h3>{item.title}</h3><p>{item.message}</p><small>{formatDate(item.createdAt)}</small></div>
                    {!item.readAt && <button className="text-button" onClick={() => markNotificationRead(item)}>Mark read</button>}
                    {item.incidentId && <button className="text-button" onClick={() => {
                      const incident = incidents.find(value => value.id === item.incidentId);
                      if (incident) viewDetails(incident);
                    }}>Open incident</button>}
                  </article>
                ))}</div> : <p className="empty">You're all caught up. No notifications yet.</p>}
              </div>
            )}

            {page === "Reports" && (
              <section>
                <div className="card">
                  <div className="panel-heading"><div><h2>Reports &amp; analytics</h2><p>Live breakdown from the incident register.</p></div>
                    <button className="primary-btn" disabled={!incidents.length} onClick={() => downloadIncidentReport(incidents)}>Download CSV report</button></div>
                  <div className="stats-container">
                    <StatCard label="Total incidents" value={analytics?.total ?? incidents.length} detail="All recorded incidents" />
                    <StatCard label="Open" value={openCount} detail="Awaiting action" tone="orange" />
                    <StatCard label="In progress" value={progressCount} detail="Under investigation" tone="purple" />
                    <StatCard label="Resolved" value={resolvedCount} detail="Closed successfully" tone="green" />
                  </div>
                </div>
                <div className="report-grid">
                  <ReportBreakdown title="Incidents by priority" items={analytics?.byPriority || countBy(incidents, "priority")} total={incidents.length} />
                  <ReportBreakdown title="Incidents by type" items={analytics?.byType || countBy(incidents, "type")} total={incidents.length} />
                  <ReportBreakdown title="Incidents by status" items={analytics?.byStatus || countBy(incidents, "status")} total={incidents.length} />
                </div>
                <div className="card"><div className="panel-heading"><div><h2>Incident report details</h2><p>Exportable register of reported incidents.</p></div></div>
                  <IncidentTable incidents={incidents} updateStatus={updateStatus} viewDetails={viewDetails} deleteIncident={deleteIncident} />
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, detail, tone = "blue" }) {
  return <div className={`stat-card ${tone}`}><div className="stat-icon">◈</div><h3>{label}</h3><h2>{value}</h2><p>{detail}</p></div>;
}

function Detail({ label, value }) {
  return <div><label>{label}</label><h3>{value}</h3></div>;
}

function TimelineItem({ title, description, date }) {
  return <div className="timeline-item"><div className="timeline-dot" /><div><h4>{title}</h4>
    {description && <p>{description}</p>}<small>{formatDate(date)}</small></div></div>;
}

function IncidentTable({ incidents, updateStatus, viewDetails, deleteIncident }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Incident</th><th>Type</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Actions</th></tr></thead>
    <tbody>{incidents.map(item => <tr key={item.id}>
      <td><button className="incident-link" onClick={() => viewDetails(item)}>{item.id}</button><strong className="incident-title">{item.title}</strong></td>
      <td>{item.type}</td><td><span className={`priority ${String(item.priority).toLowerCase()}`}>{item.priority}</span></td>
      <td><span className={`status ${String(item.status).toLowerCase().replace(" ", "-")}`}>{item.status}</span></td>
      <td>{item.assignedTo || <span className="muted">Unassigned</span>}</td>
      <td className="action-cell"><button className="view-btn" onClick={() => viewDetails(item)}>View</button>
        <select aria-label={`Set status for ${item.id}`} value={item.status} onChange={event => updateStatus(item.id, event.target.value)}>
          <option>Open</option><option>In Progress</option><option>Resolved</option>
        </select>
        <button className="icon-action danger-text" aria-label={`Delete ${item.id}`} title="Delete incident" onClick={() => deleteIncident(item)}>×</button>
      </td>
    </tr>)}</tbody>
  </table>{incidents.length === 0 && <p className="empty">No incidents match your filters.</p>}</div>;
}

function ReportBreakdown({ title, items, total }) {
  return <div className="card"><h2>{title}</h2>{items.length ? items.map(item => (
    <div className="breakdown-row" key={item._id}><div><strong>{item._id || "Other"}</strong><span>{item.count}</span></div>
      <div className="bar-track"><div style={{ width: `${total ? (item.count / total) * 100 : 0}%` }} /></div>
    </div>
  )) : <p className="empty">No incident data available.</p>}</div>;
}

function countBy(incidents, field) {
  const counts = incidents.reduce((result, incident) => {
    const key = incident[field] || "Other";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([_id, count]) => ({ _id, count }));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function downloadIncidentReport(incidents) {
  const headers = ["Incident ID", "Title", "Type", "Priority", "Status", "Assigned To", "Task Status", "Description", "Created At"];
  const escapeCsv = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = incidents.map(item => [
    item.id, item.title, item.type, item.priority, item.status,
    item.assignedTo || "Not Assigned", item.taskStatus || "Not Assigned", item.description,
    item.createdAt || ""
  ]);
  const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "IRMS_Incident_Report.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default App;
