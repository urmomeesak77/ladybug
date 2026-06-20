import { useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// The logged-in user's profile (name + email) plus a Log out control. RequireAuth gates
// the route, so a user is always present by the time this renders; the null guard only
// satisfies the type narrowing.
function AccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  if (!user) {
    return null;
  }

  return (
    <section className="account">
      <h1>Your account</h1>
      <dl className="account__details">
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
      </dl>
      <button type="button" className="account__logout" onClick={() => void handleLogout()}>
        Log out
      </button>
    </section>
  );
}

export default AccountPage;
