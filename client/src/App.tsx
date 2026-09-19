import { Route, Switch, Redirect } from "wouter";
import { useEffect, useState } from "react";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import DashboardPage from "./pages/Dashboard";
import DailyLogPage from "./pages/DailyLog";
import GoalsPage from "./pages/Goals";
import PatientsPage from "./pages/Patients";
import PatientDetailPage from "./pages/PatientDetail";
import TreatmentsPage from "./pages/Treatments";
import ReportsPage from "./pages/Reports";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import MfaVerifyPage from "./pages/MfaVerify";
import MfaEnrollPage from "./pages/MfaEnroll";
import AcceptInvitePage from "./pages/AcceptInvite";
import { api, type MeResponse } from "./lib/api";

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MeResponse>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-500">
        Loading…
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        {me ? <Redirect to="/" /> : <LoginPage onAuthed={setMe} />}
      </Route>
      <Route path="/register">
        {me ? <Redirect to="/" /> : <RegisterPage onAuthed={setMe} />}
      </Route>
      <Route path="/forgot-password">
        {me ? <Redirect to="/" /> : <ForgotPasswordPage />}
      </Route>
      <Route path="/reset-password">
        <ResetPasswordPage />
      </Route>
      <Route path="/mfa/verify">
        {me ? <Redirect to="/" /> : <MfaVerifyPage onAuthed={setMe} />}
      </Route>
      <Route path="/invite/accept">
        <AcceptInvitePage onAuthed={setMe} />
      </Route>
      <Route path="/mfa/enroll">
        {me ? <MfaEnrollPage /> : <Redirect to="/login" />}
      </Route>
      <Route path="/daily-log">
        {me ? (
          <DailyLogPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/goals">
        {me ? (
          <GoalsPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/patients/:id">
        {(params) =>
          me ? (
            <PatientDetailPage
              me={me}
              patientId={params.id}
              onLogout={() => setMe(null)}
            />
          ) : (
            <Redirect to="/login" />
          )
        }
      </Route>
      <Route path="/patients">
        {me ? (
          <PatientsPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/services">
        {me ? <Redirect to="/treatments" /> : <Redirect to="/login" />}
      </Route>
      <Route path="/treatments">
        {me ? (
          <TreatmentsPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/reports">
        {me ? (
          <ReportsPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/dashboard">
        {me ? (
          <DashboardPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route path="/">
        {me ? (
          <DashboardPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
      <Route>
        {me ? <Redirect to="/" /> : <Redirect to="/login" />}
      </Route>
    </Switch>
  );
}
