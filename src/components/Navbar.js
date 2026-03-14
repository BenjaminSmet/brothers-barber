import { useState, useRef, useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

export default function Navbar({ user, page, setPage, isAdmin }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pillStyle, setPillStyle] = useState({});
  const dropdownRef = useRef(null);
  const tabRefs = useRef({});
  const navRef = useRef(null);

  // Slide the pill to the active tab
  useEffect(() => {
    const activeTab = tabRefs.current[page];
    const nav = navRef.current;
    if (!activeTab || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setPillStyle({
      left: tabRect.left - navRect.left,
      width: tabRect.width,
    });
  }, [page, isAdmin]);

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

  const tabs = [
    { key: "book",       icon: "✂️", label: "Book" },
    { key: "mybookings", icon: "📋", label: "Bookings" },
    ...(isAdmin ? [{ key: "admin", icon: "⚙️", label: "Admin" }] : []),
  ];

  return (
    <>
      <header className="top-header">
        <div className="header-brand">
          <span className="header-scissors">✂</span>
          <span className="header-title">BARBER <em>BENJAMIN</em></span>
        </div>

        <nav className="desktop-nav">
          {tabs.map(t => (
            <button key={t.key} className={`desktop-nav-btn ${page === t.key ? "active" : ""}`} onClick={() => setPage(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="header-account" ref={dropdownRef}>
          <button className="avatar-btn" onClick={() => setDropdownOpen(o => !o)} aria-label="Account menu">
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

      {/* Bottom tab bar with sliding pill */}
      <nav className="bottom-nav" ref={navRef}>
        {/* Sliding background pill */}
        {pillStyle.width && (
          <div className="tab-slider-pill" style={pillStyle} />
        )}
        {tabs.map(t => (
          <button
            key={t.key}
            ref={el => tabRefs.current[t.key] = el}
            className={`tab-item ${page === t.key ? "active" : ""}`}
            onClick={() => setPage(t.key)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
