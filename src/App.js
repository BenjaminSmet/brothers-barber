import { useState, useEffect } from "react";
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import Login from "./components/Login";
import Navbar from "./components/Navbar";
import BookingPage from "./components/BookingPage";
import AdminPanel from "./components/AdminPanel";
import MyBookings from "./components/MyBookings";
import "./App.css";

const ADMIN_EMAIL = "benjamin.smet29@gmail.com";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [page, setPage] = useState("book");

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        if (u.email === ADMIN_EMAIL) {
          setAllowed(true);
        } else {
          // Query by email field, not document ID
          const q = query(
            collection(db, "allowedUsers"),
            where("email", "==", u.email.toLowerCase())
          );
          const snap = await getDocs(q);
          setAllowed(!snap.empty);
        }
      } else {
        setUser(null);
        setAllowed(false);
      }
      setLoading(false);
    });
  }, []);

  if (loading) return (
    <div className="splash">
      <div className="scissors-spin">✂</div>
    </div>
  );

  if (!user) return <Login />;

  if (!allowed) return (
    <div className="blocked">
      <div className="blocked-card">
        <span className="blocked-icon">🚫</span>
        <h2>Not on the list</h2>
        <p>Your account (<strong>{user.email}</strong>) hasn't been approved yet.<br />Ask Benjamin to add you!</p>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </div>
    </div>
  );

  const isAdmin = user.email === ADMIN_EMAIL;

  return (
    <div className="app">
      <Navbar user={user} page={page} setPage={setPage} isAdmin={isAdmin} />
      <main className="main-content">
        {page === "book" && <BookingPage user={user} />}
        {page === "mybookings" && <MyBookings user={user} />}
        {page === "admin" && isAdmin && <AdminPanel />}
      </main>
    </div>
  );
}
