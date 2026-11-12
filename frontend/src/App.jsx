import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Catalog from './pages/Catalog.jsx';
import BookDetail from './pages/BookDetail.jsx';
import MyLoans from './pages/MyLoans.jsx';
import MyFines from './pages/MyFines.jsx';
import Notifications from './pages/Notifications.jsx';
import Status from './pages/Status.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Circulation from './pages/admin/Circulation.jsx';
import Books from './pages/admin/Books.jsx';
import Members from './pages/admin/Members.jsx';
import Fines from './pages/admin/Fines.jsx';
import Notices from './pages/admin/Notices.jsx';

function Protected({ role, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { ready } = useAuth();
  if (!ready) return <Spinner />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Layout />}>
        <Route index element={<Catalog />} />
        <Route path="books/:id" element={<BookDetail />} />
        <Route path="loans" element={<Protected><MyLoans /></Protected>} />
        <Route path="fines" element={<Protected><MyFines /></Protected>} />
        <Route path="notifications" element={<Protected><Notifications /></Protected>} />
        <Route path="status" element={<Protected role="librarian"><Status /></Protected>} />
        <Route path="admin" element={<Protected role="librarian"><Dashboard /></Protected>} />
        <Route path="admin/circulation" element={<Protected role="librarian"><Circulation /></Protected>} />
        <Route path="admin/books" element={<Protected role="librarian"><Books /></Protected>} />
        <Route path="admin/members" element={<Protected role="librarian"><Members /></Protected>} />
        <Route path="admin/fines" element={<Protected role="librarian"><Fines /></Protected>} />
        <Route path="admin/notices" element={<Protected role="librarian"><Notices /></Protected>} />
        <Route path="*" element={<div className="empty"><h3>Page not found</h3></div>} />
      </Route>
    </Routes>
  );
}
