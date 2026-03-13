import { useState, useRef, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

export default function Navbar({ user, page, setPage, isAdmin }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  return (
    <>
      {/* ── Top header ── */}
      <header className="top-header">
        <div className="header-brand">
          <span className="header-scissors">✂</span>
          <span className="header-title">BARBER <em>BENJAMIN</em></span>
        </div>
        <div className="header-account" ref={dropdownRef}>
          <button
            className="avatar-btn"
            onClick={() => setDropdownOpen(o => !o)}
            aria-label="Account menu"
          >
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="avatar-img" />
              : <div className="avatar-fallback">{user.displayName?.[0] ?? "?"}</div>
            }
          </button>
          {dropdownOpen && (
            <div className="account-dropdown">
              <div className="dropdown-user-info">
                {user.photoURL && <img src={user.photoURL} alt="" className="dropdown-avatar" />}
                <div>
                  <div className="dropdown-name">{user.displayName}</div>
                  <div className="dropdown-email">{user.email}</div>
                </div>
              </div>
              <div className="dropdown-divider" />
              <button className="dropdown-signout" onClick={() => signOut(auth)}>
                <span>↩</span> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Bottom tab bar ── */}
      <nav className="bottom-nav">
        <button
          className={`tab-item ${page === "book" ? "active" : ""}`}
          onClick={() => setPage("book")}
        >
          <span className="tab-icon">✂️</span>
          <span className="tab-label">Book</span>
        </button>
        <button
          className={`tab-item ${page === "mybookings" ? "active" : ""}`}
          onClick={() => setPage("mybookings")}
        >
          <span className="tab-icon">📋</span>
          <span className="tab-label">My Bookings</span>
        </button>
        {isAdmin && (
          <button
            className={`tab-item ${page === "admin" ? "active" : ""}`}
            onClick={() => setPage("admin")}
          >
            <span className="tab-icon">⚙️</span>
            <span className="tab-label">Admin</span>
          </button>
        )}
      </nav>
    </>
  );
}
