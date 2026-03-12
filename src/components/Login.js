import { signInWithPopup } from "firebase/auth";
import { auth, provider } from "../firebase";

export default function Login() {
  const handleLogin = () => signInWithPopup(auth, provider);

  return (
    <div className="login-page">
      <div className="login-bg-text">✂</div>
      <div className="login-card">
        <span className="login-scissors">✂️</span>
        <h1>BARBER <span>BENJAMIN</span></h1>
        <p className="login-tagline">Book your next haircut. Family only.</p>
        <button className="google-btn" onClick={handleLogin}>
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
          />
          Sign in with Google
        </button>
        <p className="login-note">Only approved accounts can book 🔒</p>
      </div>
    </div>
  );
}
