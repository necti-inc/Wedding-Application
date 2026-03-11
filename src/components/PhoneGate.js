"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { setSessionPhone } from "@/lib/session";

export default function PhoneGate({ onContinue, title = "Enter your phone number", subtitle = "So you can upload photos and delete your own later if needed." }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState(null);

  const normalize = (v) => v.replace(/\D/g, "");

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setError(null);
      const digits = normalize(phone);
      if (digits.length < 10) {
        setError("Please enter a valid phone number (at least 10 digits).");
        return;
      }
      const toStore = phone.trim();
      setSessionPhone(toStore);
      onContinue(toStore);
    },
    [phone, onContinue]
  );

  return (
    <div className="phone-gate">
      <div className="phone-gate__card">
        <h2 className="phone-gate__title">{title}</h2>
        <p className="phone-gate__subtitle">{subtitle}</p>
        <form onSubmit={handleSubmit} className="phone-gate__form">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 555-123-4567"
            className="phone-gate__input"
            autoComplete="tel"
            aria-label="Phone number"
          />
          {error && <p className="phone-gate__error" role="alert">{error}</p>}
          <button type="submit" className="phone-gate__btn">
            Continue
          </button>
        </form>
        <Link href="/" className="phone-gate__back">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
