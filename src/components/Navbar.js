import { signOut } from "firebase/auth";
import { auth } from "../firebase";

export default function Navbar({ user, page, setPage, isAdmin }) {
  return (
    <nav className="navbar">
      <div className="navbar-brand">✂ BROTHERS<span>CUT</span></div>
      <div className="navbar-nav">
        <button
          className={`nav-btn ${page === "book" ? "active" : ""}`}
          onClick={() => setPage("book")}
        >
          Book
        </button>
        <button
          className={`nav-btn ${page === "mybookings" ? "active" : ""}`}
          onClick={() => setPage("mybookings")}
        >
          My Bookings
        </button>
        {isAdmin && (
          <button
            className={`nav-btn admin-btn ${page === "admin" ? "active" : ""}`}
            onClick={() => setPage("admin")}
          >
            ⚙ Admin
          </button>
        )}
      </div>
      <div className="navbar-user">
        {user.photoURL && <img className="user-avatar" src={user.photoURL} alt="" />}
        <span className="user-name">{user.displayName?.split(" ")[0]}</span>
        <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
      </div>
    </nav>
  );
}
